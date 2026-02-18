"""Integrations (webhooks) and MCP client routers."""
import logging
from fastapi import APIRouter, HTTPException

from ..services import integrations as int_service

logger = logging.getLogger(__name__)

# ── Integrations Router ──────────────────────────────────────
integrations_router = APIRouter(prefix="/api/integrations", tags=["integrations"])


@integrations_router.get("/")
async def list_integrations():
    return int_service.list_integrations()


@integrations_router.post("/")
async def create_integration(body: dict):
    name = body.get("name", "")
    int_type = body.get("type", "incoming_webhook")
    config = body.get("config", {})
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    return int_service.create_integration(name, int_type, config)


@integrations_router.get("/{int_id}")
async def get_integration(int_id: str):
    result = int_service.get_integration(int_id)
    if not result:
        raise HTTPException(status_code=404, detail="Integration not found")
    return result


@integrations_router.put("/{int_id}")
async def update_integration(int_id: str, body: dict):
    if not int_service.update_integration(
        int_id, name=body.get("name"), config=body.get("config"), enabled=body.get("enabled")
    ):
        raise HTTPException(status_code=404, detail="Integration not found")
    return int_service.get_integration(int_id)


@integrations_router.delete("/{int_id}")
async def delete_integration(int_id: str):
    if not int_service.delete_integration(int_id):
        raise HTTPException(status_code=404, detail="Integration not found")
    return {"deleted": int_id}


@integrations_router.get("/{int_id}/logs")
async def integration_logs(int_id: str, limit: int = 50):
    return int_service.get_webhook_logs(int_id, limit)


@integrations_router.post("/webhook/{token}")
async def incoming_webhook(token: str, body: dict):
    """Public incoming webhook endpoint. Token validates against integration config."""
    for integration in int_service.list_integrations():
        if integration["config"].get("webhook_token") == token:
            result = await int_service.process_incoming_webhook(integration["id"], body)
            return result
    raise HTTPException(status_code=404, detail="Invalid webhook token")


@integrations_router.post("/webhook/{token}/execute")
async def execute_approved_skill(token: str, body: dict):
    """Execute a skill that was approved in an external system (e.g. ServiceNow).

    Expects: { skill_name, device_hostname, parameters, incident_number, approved_by }
    """
    integration = None
    for i in int_service.list_integrations():
        if i["config"].get("webhook_token") == token:
            integration = i
            break
    if not integration:
        raise HTTPException(status_code=404, detail="Invalid webhook token")

    result = await int_service.execute_approved_skill(integration["id"], body)
    return result


# ── MCP Client Router ────────────────────────────────────────
mcp_client_router = APIRouter(prefix="/api/mcp-clients", tags=["mcp-clients"])


@mcp_client_router.get("/")
async def list_mcp_connections():
    return int_service.list_mcp_connections()


@mcp_client_router.post("/")
async def add_mcp_connection(body: dict):
    name = body.get("name", "")
    url = body.get("url", "")
    transport = body.get("transport", "streamable-http")
    if not name or not url:
        raise HTTPException(status_code=400, detail="Name and URL required")
    return int_service.add_mcp_connection(name, url, transport)


@mcp_client_router.post("/{conn_id}/discover")
async def discover_mcp_tools(conn_id: str):
    result = await int_service.discover_mcp_tools(conn_id)
    if not result.get("success"):
        raise HTTPException(status_code=500, detail=result.get("error", "Discovery failed"))
    return result


@mcp_client_router.post("/{conn_id}/call")
async def call_mcp_tool(conn_id: str, body: dict):
    tool_name = body.get("tool_name", "")
    arguments = body.get("arguments", {})
    if not tool_name:
        raise HTTPException(status_code=400, detail="tool_name required")
    return await int_service.call_mcp_tool(conn_id, tool_name, arguments)


@mcp_client_router.delete("/{conn_id}")
async def delete_mcp_connection(conn_id: str):
    if not int_service.delete_mcp_connection(conn_id):
        raise HTTPException(status_code=404, detail="Connection not found")
    return {"deleted": conn_id}
