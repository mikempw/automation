"""MCP client connections — discovery and tool invocation.

Extracted from integrations.py to keep files under 500 lines.
Manages connections to external MCP servers, tool discovery,
and tool invocation via streamable-http transport.
"""
import json
import logging
import uuid
from datetime import datetime, timezone

import httpx

logger = logging.getLogger(__name__)


def _get_db():
    """Get DB connection — uses the same database as integrations."""
    from .integrations import _get_db as get_integration_db
    return get_integration_db()


# ── MCP Client Connections ───────────────────────────────────

def list_mcp_connections() -> list[dict]:
    conn = _get_db()
    try:
        rows = conn.execute("SELECT * FROM mcp_connections ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["tools"] = json.loads(d["tools"])
            d["enabled"] = bool(d["enabled"])
            result.append(d)
        return result
    finally:
        conn.close()


def add_mcp_connection(name: str, url: str, transport: str = "streamable-http") -> dict:
    conn_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO mcp_connections (id, name, url, transport, created_at) VALUES (?, ?, ?, ?, ?)",
            (conn_id, name, url, transport, now),
        )
        conn.commit()
        return {"id": conn_id, "name": name, "url": url, "transport": transport,
                "enabled": True, "status": "disconnected", "tools": [], "created_at": now}
    finally:
        conn.close()


def update_mcp_connection(conn_id: str, **kwargs) -> bool:
    conn = _get_db()
    try:
        updates, params = [], []
        for key in ("name", "url", "transport", "status", "last_connected"):
            if key in kwargs:
                updates.append(f"{key} = ?")
                params.append(kwargs[key])
        if "enabled" in kwargs:
            updates.append("enabled = ?")
            params.append(1 if kwargs["enabled"] else 0)
        if "tools" in kwargs:
            updates.append("tools = ?")
            params.append(json.dumps(kwargs["tools"]))
        if not updates:
            return False
        params.append(conn_id)
        conn.execute(f"UPDATE mcp_connections SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        return True
    finally:
        conn.close()


def delete_mcp_connection(conn_id: str) -> bool:
    conn = _get_db()
    try:
        cursor = conn.execute("DELETE FROM mcp_connections WHERE id = ?", (conn_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


async def discover_mcp_tools(conn_id: str) -> dict:
    """Connect to an MCP server and discover its available tools.

    Uses the MCP initialize handshake to get tool list.
    Stores tools in the database for the chat agent to reference.
    """
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM mcp_connections WHERE id = ?", (conn_id,)).fetchone()
        if not row:
            return {"error": "Connection not found", "success": False}

        mcp_url = row["url"]
        transport = row["transport"]

        if transport == "streamable-http":
            return await _discover_streamable_http(conn_id, mcp_url)
        else:
            return {"error": f"Unsupported transport: {transport}", "success": False}
    finally:
        conn.close()


async def _discover_streamable_http(conn_id: str, url: str) -> dict:
    """Discover tools from a streamable-http MCP server."""
    try:
        async with httpx.AsyncClient() as client:
            # MCP initialize
            init_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "f5-insight", "version": "0.1.0"},
                },
            }
            r = await client.post(url, json=init_payload, timeout=15,
                                  headers={"Content-Type": "application/json", "Accept": "application/json"})
            if r.status_code != 200:
                update_mcp_connection(conn_id, status="error")
                return {"error": f"Initialize failed: HTTP {r.status_code}", "success": False}

            # Extract session ID from response headers if present
            session_id = r.headers.get("mcp-session-id", "")
            headers = {"Content-Type": "application/json", "Accept": "application/json"}
            if session_id:
                headers["mcp-session-id"] = session_id

            # Send initialized notification
            notif = {"jsonrpc": "2.0", "method": "notifications/initialized"}
            await client.post(url, json=notif, headers=headers, timeout=10)

            # List tools
            tools_payload = {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/list",
                "params": {},
            }
            r = await client.post(url, json=tools_payload, headers=headers, timeout=15)
            if r.status_code != 200:
                update_mcp_connection(conn_id, status="error")
                return {"error": f"tools/list failed: HTTP {r.status_code}", "success": False}

            body = r.json()
            tools = body.get("result", {}).get("tools", [])
            tool_list = [{"name": t.get("name", ""), "description": t.get("description", ""),
                          "inputSchema": t.get("inputSchema", {})} for t in tools]

            now = datetime.now(timezone.utc).isoformat()
            update_mcp_connection(conn_id, status="connected", tools=tool_list, last_connected=now)

            return {"success": True, "tools": tool_list, "tool_count": len(tool_list)}

    except Exception as e:
        logger.error(f"MCP discovery failed: {e}")
        update_mcp_connection(conn_id, status="error")
        return {"error": str(e), "success": False}


async def call_mcp_tool(conn_id: str, tool_name: str, arguments: dict) -> dict:
    """Call a tool on an external MCP server."""
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM mcp_connections WHERE id = ?", (conn_id,)).fetchone()
        if not row:
            return {"error": "Connection not found", "success": False}

        mcp_url = row["url"]
    finally:
        conn.close()

    try:
        async with httpx.AsyncClient() as client:
            # Initialize session
            init_payload = {
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "f5-insight", "version": "0.1.0"},
                },
            }
            r = await client.post(mcp_url, json=init_payload, timeout=15,
                                  headers={"Content-Type": "application/json", "Accept": "application/json"})
            session_id = r.headers.get("mcp-session-id", "")
            headers = {"Content-Type": "application/json", "Accept": "application/json"}
            if session_id:
                headers["mcp-session-id"] = session_id

            # Initialized notification
            await client.post(mcp_url, json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                              headers=headers, timeout=10)

            # Call tool
            call_payload = {
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            }
            r = await client.post(mcp_url, json=call_payload, headers=headers, timeout=120)
            body = r.json()

            if "error" in body:
                return {"error": body["error"].get("message", str(body["error"])), "success": False}

            content = body.get("result", {}).get("content", [])
            text_parts = [c.get("text", "") for c in content if c.get("type") == "text"]
            return {"success": True, "output": "\n".join(text_parts)}

    except Exception as e:
        logger.error(f"MCP tool call failed: {e}")
        return {"error": str(e), "success": False}


def get_all_mcp_tools() -> list[dict]:
    """Get all tools from all connected MCP servers (for chat agent context)."""
    connections = list_mcp_connections()
    all_tools = []
    for conn in connections:
        if conn["enabled"] and conn["status"] == "connected":
            for tool in conn["tools"]:
                all_tools.append({
                    "mcp_connection_id": conn["id"],
                    "mcp_server_name": conn["name"],
                    "tool_name": tool["name"],
                    "description": tool.get("description", ""),
                })
    return all_tools
