"""Integrations service — Webhook framework + MCP client for external tool chaining.

Supports:
  - Incoming webhooks: External systems (ServiceNow, Jira, PagerDuty) POST events
    → parsed → fed to chat agent → skills chain → results POSTed back to callback URL
  - Outgoing webhooks: Skill execution events fire to configured endpoints
  - MCP client: Connect to external MCP servers and expose their tools to the chat agent
"""
import asyncio
import json
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

DATA_DIR = os.getenv("DATA_DIR", "/app/data")
DB_PATH = os.path.join(DATA_DIR, "integrations.db")


# ── Database ─────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    os.makedirs(DATA_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    conn = _get_db()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS integrations (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                type TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                config TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS webhook_logs (
                id TEXT PRIMARY KEY,
                integration_id TEXT NOT NULL,
                direction TEXT NOT NULL,
                payload TEXT,
                response TEXT,
                status TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS mcp_connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                transport TEXT NOT NULL DEFAULT 'streamable-http',
                enabled INTEGER NOT NULL DEFAULT 1,
                status TEXT NOT NULL DEFAULT 'disconnected',
                tools TEXT DEFAULT '[]',
                last_connected TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_webhook_logs_int ON webhook_logs(integration_id);
        """)
        conn.commit()
    finally:
        conn.close()


_init_db()


# ── Integration CRUD ─────────────────────────────────────────

def list_integrations() -> list[dict]:
    conn = _get_db()
    try:
        rows = conn.execute("SELECT * FROM integrations ORDER BY created_at DESC").fetchall()
        result = []
        for r in rows:
            d = dict(r)
            d["config"] = json.loads(d["config"])
            d["enabled"] = bool(d["enabled"])
            result.append(d)
        return result
    finally:
        conn.close()


def create_integration(name: str, int_type: str, config: dict) -> dict:
    """Create a webhook integration.

    Types: 'incoming_webhook', 'outgoing_webhook', 'bidirectional_webhook'

    Config for incoming:
      - secret: shared secret for HMAC validation (optional)
      - callback_url: URL to POST results back to
      - payload_mapping: dict mapping incoming fields to internal fields
        e.g. {"title": "$.issue.summary", "description": "$.issue.description", "device": "$.custom.device"}

    Config for outgoing:
      - url: endpoint to POST to
      - events: list of events to fire on ("skill_complete", "skill_failed", "approval_required")
      - headers: custom headers dict
      - payload_template: Jinja-style template for outgoing payload
    """
    int_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    # Generate a webhook token for incoming webhooks
    if int_type in ("incoming_webhook", "bidirectional_webhook"):
        config["webhook_token"] = str(uuid.uuid4())

    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO integrations (id, name, type, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
            (int_id, name, int_type, json.dumps(config), now, now),
        )
        conn.commit()
        return {"id": int_id, "name": name, "type": int_type, "config": config,
                "enabled": True, "created_at": now, "updated_at": now}
    finally:
        conn.close()


def get_integration(int_id: str) -> Optional[dict]:
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM integrations WHERE id = ?", (int_id,)).fetchone()
        if not row:
            return None
        d = dict(row)
        d["config"] = json.loads(d["config"])
        d["enabled"] = bool(d["enabled"])
        return d
    finally:
        conn.close()


def update_integration(int_id: str, name: str = None, config: dict = None, enabled: bool = None) -> bool:
    conn = _get_db()
    try:
        updates, params = [], []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if config is not None:
            updates.append("config = ?")
            params.append(json.dumps(config))
        if enabled is not None:
            updates.append("enabled = ?")
            params.append(1 if enabled else 0)
        if not updates:
            return False
        updates.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(int_id)
        conn.execute(f"UPDATE integrations SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
        return True
    finally:
        conn.close()


def delete_integration(int_id: str) -> bool:
    conn = _get_db()
    try:
        cursor = conn.execute("DELETE FROM integrations WHERE id = ?", (int_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# ── Webhook Processing ───────────────────────────────────────

def _log_webhook(integration_id: str, direction: str, payload: str,
                 response: str = None, status: str = "ok"):
    conn = _get_db()
    try:
        log_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO webhook_logs (id, integration_id, direction, payload, response, status, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (log_id, integration_id, direction, payload, response, status, now),
        )
        conn.commit()
    finally:
        conn.close()


def get_webhook_logs(integration_id: str, limit: int = 50) -> list[dict]:
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM webhook_logs WHERE integration_id = ? ORDER BY created_at DESC LIMIT ?",
            (integration_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


async def process_incoming_webhook(integration_id: str, payload: dict) -> dict:
    """Process an incoming webhook payload.

    1. Validate the integration exists and is enabled
    2. Extract fields using payload_mapping
    3A. If automation_id is configured: map params → execute_chain()
    3B. Otherwise: build prompt → feed to chat agent
    4. POST results back to callback_url if configured
    """
    from .chat import process_chat
    from .vault import list_devices, get_device_credentials

    integration = get_integration(integration_id)
    if not integration:
        return {"error": "Integration not found", "success": False}
    if not integration["enabled"]:
        return {"error": "Integration disabled", "success": False}

    config = integration["config"]
    _log_webhook(integration_id, "incoming", json.dumps(payload))

    # Extract fields via simple JSONPath-like mapping
    mapping = config.get("payload_mapping", {})
    extracted = {}
    for field, path in mapping.items():
        extracted[field] = _extract_jsonpath(payload, path)

    # ── Automation trigger mode ──
    # If the integration config has an automation_id, bypass the chat agent
    # and directly execute the automation chain with mapped parameters.
    automation_id = config.get("automation_id")
    if automation_id:
        from .automation_engine import execute_chain

        # Map extracted webhook fields to chain parameters
        chain_params_mapping = config.get("chain_parameters_mapping", {})
        mapped_params = {}
        for chain_param, payload_path in chain_params_mapping.items():
            mapped_params[chain_param] = _extract_jsonpath(payload, payload_path)

        # Also merge any directly extracted fields as fallback
        for field, value in extracted.items():
            if field not in mapped_params and value is not None:
                mapped_params[field] = value

        logger.info(f"Webhook triggering automation {automation_id} with params: {mapped_params}")
        try:
            run = await execute_chain(automation_id, mapped_params)
            run_id = run.get("id", "unknown")
            status = run.get("status", "unknown")
            response_text = (
                f"Automation triggered: {run.get('automation_name', automation_id)}\n"
                f"Run ID: {run_id}\n"
                f"Status: {status}\n"
                f"Steps: {run.get('current_step', 0)}/{run.get('total_steps', 0)}"
            )

            # POST results back to callback URL if configured
            callback_url = config.get("callback_url")
            if callback_url:
                callback_payload = {
                    "source": "f5-insight",
                    "integration_id": integration_id,
                    "mode": "automation",
                    "automation_id": automation_id,
                    "run_id": run_id,
                    "run_status": status,
                    "response": response_text,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                try:
                    async with httpx.AsyncClient() as client:
                        headers = config.get("callback_headers", {})
                        r = await client.post(callback_url, json=callback_payload,
                                              headers=headers, timeout=30)
                        _log_webhook(integration_id, "callback", json.dumps(callback_payload),
                                    response=r.text[:500], status=str(r.status_code))
                except Exception as e:
                    logger.error(f"Automation callback failed: {e}")

            return {
                "success": True,
                "mode": "automation",
                "run_id": run_id,
                "run_status": status,
                "response": response_text,
            }
        except Exception as e:
            logger.error(f"Webhook automation trigger failed: {e}")
            return {"error": str(e), "success": False, "mode": "automation"}

    # Build a natural language prompt from extracted fields
    # This prompt must be directive — the LLM is operating headlessly, not in a chat
    ticket_fields = []
    for field, value in extracted.items():
        if value:
            ticket_fields.append(f"  {field}: {value}")
    ticket_summary = "\n".join(ticket_fields) if ticket_fields else "  (no fields extracted)"

    # Also extract from raw payload for anything mapping missed
    issue = payload.get("issue", {})
    raw_title = issue.get("summary", extracted.get("title", ""))
    raw_desc = issue.get("description", extracted.get("description", ""))
    raw_device = issue.get("configuration_item", extracted.get("device", ""))

    prompt = f"""AUTOMATED TICKET PROCESSING — HEADLESS MODE

You are processing a ticket from an external ITSM system (ServiceNow). This is NOT an interactive chat.
You must respond with EXACTLY ONE skill execution JSON block. Do not deliberate, do not ask questions,
do not explain your reasoning at length. Pick the best skill and execute it.

TICKET:
  Title: {raw_title}
  Description: {raw_desc}
  Device/CI: {raw_device}

Extracted fields:
{ticket_summary}

RULES FOR HEADLESS MODE:
1. Identify the action requested in the ticket title/description.
2. Match it to ONE skill from your catalog.
3. Match the device — if a specific device/CI is mentioned, use it. If not, use the most likely device.
4. Output the skill execution JSON block immediately. No preamble, no discussion.
5. If the ticket mentions a virtual server name, use it exactly as given (prepend /Common/ if no partition specified).
6. If the action is destructive (disable, delete, modify), still propose it — the approval will be handled externally.
7. Keep your text response to 1-2 sentences maximum before the JSON block.
8. IMPORTANT: For bigip-vs-toggle, the 'state' parameter must be 'disabled' or 'enabled' (past tense, as tmsh expects). NOT 'disable' or 'enable'."""

    # Get device list for chat context
    device_list = []
    try:
        hostnames = await list_devices()
        for hostname in hostnames:
            creds = await get_device_credentials(hostname)
            if creds:
                device_list.append({
                    "hostname": hostname,
                    "device_type": creds.get("device_type", "bigip"),
                    "mgmt_ip": creds.get("mgmt_ip", ""),
                    "description": creds.get("description", ""),
                })
    except Exception as e:
        logger.warning(f"Could not load devices for webhook: {e}")

    # Process through chat agent
    messages = [{"role": "user", "content": prompt}]
    result = await process_chat(messages, device_list)

    # If the LLM proposed a skill, actually execute it
    skill_request = result.get("skill_request")
    execution_result = None
    if skill_request:
        from .executor import get_skill, execute_skill
        from ..models import ExecutionRequest

        skill_name = skill_request.get("skill_name", "")
        device_hostname = skill_request.get("device_hostname", "")
        parameters = skill_request.get("parameters", {})

        skill = get_skill(skill_name)
        if skill:
            is_destructive = skill.get("safety", {}).get("destructive", False)
            requires_approval = skill.get("safety", {}).get("requires_approval", True)

            if is_destructive and requires_approval:
                # Fire approval_required event instead of executing
                try:
                    await fire_outgoing_webhook("approval_required", {
                        "skill_name": skill_name,
                        "device_hostname": device_hostname,
                        "parameters": parameters,
                        "explanation": skill_request.get("explanation", ""),
                        "incident_number": payload.get("incident_number", ""),
                    })
                except Exception as e:
                    logger.warning(f"Failed to fire approval webhook: {e}")
                result["approval_required"] = True
                # Replace verbose LLM response with clean summary for ticket
                result["response"] = (
                    f"Identified action: {skill_name} on {device_hostname}\n"
                    f"Parameters: {json.dumps(parameters)}\n"
                    f"Reason: {skill_request.get('explanation', 'N/A')}\n\n"
                    f"⚠ This is a destructive action requiring approval."
                )
            else:
                # Auto-execute non-destructive skills
                try:
                    exec_req = ExecutionRequest(
                        skill_name=skill_name,
                        device_hostname=device_hostname,
                        parameters=parameters,
                    )
                    execution_result = await execute_skill(exec_req)
                    er_dict = execution_result.dict() if hasattr(execution_result, 'dict') else execution_result

                    # Build clean summary of results (replace LLM chatter)
                    steps_summary = []
                    for step in er_dict.get("steps", []):
                        status_icon = "✓" if step.get("status") == "complete" else "✗"
                        steps_summary.append(f"{status_icon} {step.get('step_name', '')}: {(step.get('output', '') or '')[:500]}")

                    result["response"] = (
                        f"Executed: {skill_name} on {device_hostname}\n"
                        f"Status: {er_dict.get('status', 'unknown')}\n\n"
                        + "\n".join(steps_summary)
                    )
                    if er_dict.get("analysis"):
                        result["response"] += f"\n\nAnalysis:\n{er_dict['analysis']}"
                    if er_dict.get("error"):
                        result["response"] += f"\n\nError: {er_dict['error']}"

                    result["execution_result"] = er_dict
                except Exception as e:
                    logger.error(f"Webhook skill execution failed: {e}")
                    result["response"] = f"Skill execution failed: {str(e)}"

    # POST results back to callback URL if configured
    callback_url = config.get("callback_url")
    if callback_url:
        callback_payload = {
            "source": "f5-insight",
            "integration_id": integration_id,
            "incident_number": payload.get("incident_number", ""),
            "response": result.get("response", ""),
            "skill_request": result.get("skill_request"),
            "execution_result": result.get("execution_result"),
            "approval_required": result.get("approval_required", False),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            async with httpx.AsyncClient() as client:
                headers = config.get("callback_headers", {})
                r = await client.post(callback_url, json=callback_payload,
                                      headers=headers, timeout=30)
                _log_webhook(integration_id, "callback", json.dumps(callback_payload),
                            response=r.text[:500], status=str(r.status_code))
        except Exception as e:
            logger.error(f"Callback failed: {e}")
            _log_webhook(integration_id, "callback", json.dumps(callback_payload),
                        response=str(e), status="error")

    return {"success": True, "response": result.get("response", ""), "skill_request": result.get("skill_request"), "approval_required": result.get("approval_required", False)}


async def execute_approved_skill(integration_id: str, body: dict) -> dict:
    """Execute a skill that was approved externally (e.g. from ServiceNow).

    1. Validate the integration
    2. Execute the skill
    3. POST results back to callback_url
    """
    from .executor import execute_skill
    from ..models import ExecutionRequest

    integration = get_integration(integration_id)
    if not integration:
        return {"error": "Integration not found", "success": False}

    config = integration["config"]
    skill_name = body.get("skill_name", "")
    device_hostname = body.get("device_hostname", "")
    parameters = body.get("parameters", {})
    incident_number = body.get("incident_number", "")
    approved_by = body.get("approved_by", "unknown")

    _log_webhook(integration_id, "incoming",
                 json.dumps({"action": "execute_approved", "skill": skill_name,
                             "device": device_hostname, "approved_by": approved_by,
                             "incident": incident_number}))

    logger.info(f"Executing approved skill: {skill_name} on {device_hostname} "
                f"(approved by {approved_by}, incident {incident_number})")

    # Execute the skill
    execution_result = None
    try:
        exec_req = ExecutionRequest(
            skill_name=skill_name,
            device_hostname=device_hostname,
            parameters=parameters,
        )
        exec_result = await execute_skill(exec_req)
        execution_result = exec_result.dict() if hasattr(exec_result, 'dict') else exec_result
    except Exception as e:
        logger.error(f"Approved skill execution failed: {e}")
        execution_result = {"status": "failed", "error": str(e), "steps": []}

    # Build human-readable summary
    steps_summary = []
    for step in execution_result.get("steps", []):
        icon = "✓" if step.get("status") == "complete" else "✗"
        output = (step.get("output", "") or "")[:800]
        steps_summary.append(f"{icon} {step.get('step_name', '')}: {output}")

    summary = f"Skill: {skill_name} on {device_hostname}\n"
    summary += f"Status: {execution_result.get('status', 'unknown')}\n"
    summary += f"Approved by: {approved_by}\n\n"
    summary += "Steps:\n" + "\n".join(steps_summary)

    if execution_result.get("analysis"):
        summary += f"\n\nAI Analysis:\n{execution_result['analysis']}"
    if execution_result.get("error"):
        summary += f"\n\nError: {execution_result['error']}"

    # Fire outgoing webhook event
    event = "skill_complete" if execution_result.get("status") == "complete" else "skill_failed"
    try:
        await fire_outgoing_webhook(event, {
            "skill_name": skill_name,
            "device_hostname": device_hostname,
            "incident_number": incident_number,
            "execution_result": execution_result,
        })
    except Exception as e:
        logger.warning(f"Outgoing webhook failed: {e}")

    # POST results back to callback URL
    callback_url = config.get("callback_url")
    if callback_url:
        callback_payload = {
            "source": "f5-insight",
            "integration_id": integration_id,
            "incident_number": incident_number,
            "action": "execution_complete",
            "approved_by": approved_by,
            "response": summary,
            "skill_request": {"skill_name": skill_name, "device_hostname": device_hostname, "parameters": parameters},
            "execution_result": execution_result,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            async with httpx.AsyncClient() as client:
                r = await client.post(callback_url, json=callback_payload,
                                      headers=config.get("callback_headers", {}), timeout=120)
                _log_webhook(integration_id, "callback", json.dumps(callback_payload)[:2000],
                            response=r.text[:500], status=str(r.status_code))
        except Exception as e:
            logger.error(f"Execution callback failed: {e}")
            _log_webhook(integration_id, "callback", json.dumps(callback_payload)[:2000],
                        response=str(e), status="error")

    return {
        "success": True,
        "execution_result": execution_result,
        "summary": summary,
    }


async def fire_outgoing_webhook(event: str, data: dict):
    """Fire outgoing webhooks for a given event."""
    integrations = list_integrations()
    for integration in integrations:
        if not integration["enabled"]:
            continue
        if integration["type"] not in ("outgoing_webhook", "bidirectional_webhook"):
            continue
        config = integration["config"]
        events = config.get("events", [])
        if event not in events:
            continue

        url = config.get("url")
        if not url:
            continue

        payload = {
            "event": event,
            "source": "f5-insight",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "data": data,
        }

        try:
            async with httpx.AsyncClient() as client:
                headers = config.get("headers", {})
                r = await client.post(url, json=payload, headers=headers, timeout=30)
                _log_webhook(integration["id"], "outgoing", json.dumps(payload),
                            response=r.text[:500], status=str(r.status_code))
        except Exception as e:
            logger.error(f"Outgoing webhook failed for {integration['name']}: {e}")
            _log_webhook(integration["id"], "outgoing", json.dumps(payload),
                        response=str(e), status="error")


def _extract_jsonpath(data: dict, path: str):
    """Simple JSONPath-like extraction. Supports $.field.subfield notation."""
    if not path or not path.startswith("$."):
        return path  # Treat as literal value
    parts = path[2:].split(".")
    current = data
    for part in parts:
        if isinstance(current, dict):
            current = current.get(part)
        elif isinstance(current, list) and part.isdigit():
            idx = int(part)
            current = current[idx] if idx < len(current) else None
        else:
            return None
        if current is None:
            return None
    return current


# ── MCP Client Connections (see mcp_client.py) ───────────────
from .mcp_client import (  # noqa: F401 — re-exported for backward compat
    list_mcp_connections, add_mcp_connection, update_mcp_connection,
    delete_mcp_connection, discover_mcp_tools, call_mcp_tool, get_all_mcp_tools,
)
