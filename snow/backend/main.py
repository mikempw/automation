"""ServiceNow Mock — ITSM Incident Management with LLM-powered ticket creation."""
import json, logging, os, sqlite3, uuid, httpx
from datetime import datetime, timezone
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="ServiceNow Mock — Incident Management", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

DB_PATH = "/app/data/snow.db"
INSIGHT_WEBHOOK_URL = os.getenv("INSIGHT_WEBHOOK_URL", "")  # e.g. http://insight-backend:8000/api/integrations/webhook/{token}
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")

# ── Database ─────────────────────────────────────────────────
def _get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def _init_db():
    conn = _get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS incidents (
            number TEXT PRIMARY KEY,
            short_description TEXT NOT NULL,
            description TEXT DEFAULT '',
            caller TEXT DEFAULT 'System',
            category TEXT DEFAULT 'Network',
            subcategory TEXT DEFAULT '',
            state TEXT DEFAULT 'New',
            impact TEXT DEFAULT '2 - Medium',
            urgency TEXT DEFAULT '2 - Medium',
            priority TEXT DEFAULT '3 - Moderate',
            assignment_group TEXT DEFAULT 'Network Operations',
            assigned_to TEXT DEFAULT '',
            configuration_item TEXT DEFAULT '',
            contact_type TEXT DEFAULT 'Self-service',
            opened_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            resolved_at TEXT,
            closed_at TEXT,
            close_notes TEXT DEFAULT '',
            work_notes TEXT DEFAULT '[]',
            insight_status TEXT DEFAULT '',
            insight_response TEXT DEFAULT '',
            insight_skill_results TEXT DEFAULT '[]',
            pending_skill TEXT DEFAULT ''
        );
        CREATE TABLE IF NOT EXISTS work_notes (
            id TEXT PRIMARY KEY,
            incident_number TEXT NOT NULL,
            author TEXT DEFAULT 'System',
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            note_type TEXT DEFAULT 'work_note',
            FOREIGN KEY (incident_number) REFERENCES incidents(number)
        );
    """)
    conn.commit()
    conn.close()

_init_db()

def _next_inc_number():
    conn = _get_db()
    try:
        row = conn.execute("SELECT number FROM incidents ORDER BY number DESC LIMIT 1").fetchone()
        if row:
            num = int(row["number"].replace("INC", "")) + 1
        else:
            num = 100001
        return f"INC{num:07d}"
    finally:
        conn.close()

# ── LLM Ticket Creation ─────────────────────────────────────
async def llm_create_ticket(natural_language: str) -> dict:
    """Use Claude to parse natural language into structured incident fields."""
    if not ANTHROPIC_API_KEY:
        # Fallback: just use the text as short_description
        return {
            "short_description": natural_language[:200],
            "description": natural_language,
            "category": "Network",
            "subcategory": "Connectivity",
            "impact": "2 - Medium",
            "urgency": "2 - Medium",
            "priority": "3 - Moderate",
            "assignment_group": "Network Operations",
            "configuration_item": "",
        }

    prompt = f"""You are a ServiceNow incident ticket creation assistant. Parse the following natural language description into structured incident fields. Return ONLY a JSON object with these fields:

- short_description: A concise 1-line summary (max 160 chars)
- description: Full detailed description
- category: One of: Network, Hardware, Software, Database, Inquiry/Help
- subcategory: Relevant subcategory (e.g., Connectivity, DNS, Load Balancer, VPN, Firewall, DHCP for Network)
- impact: "1 - High", "2 - Medium", or "3 - Low"
- urgency: "1 - High", "2 - Medium", or "3 - Low"
- priority: Derive from impact+urgency: "1 - Critical", "2 - High", "3 - Moderate", "4 - Low"
- assignment_group: Best guess from: "Network Operations", "Server Team", "Database Team", "Application Support", "Security Operations", "Service Desk"
- configuration_item: If a specific device/server/service is mentioned, extract it. Otherwise empty string.

User's description:
{natural_language}

Return ONLY valid JSON, no markdown, no explanation."""

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                json={"model": ANTHROPIC_MODEL, "max_tokens": 500, "messages": [{"role": "user", "content": prompt}]},
                timeout=30,
            )
            body = r.json()
            text = body.get("content", [{}])[0].get("text", "{}")
            # Clean markdown fences if present
            text = text.strip()
            if text.startswith("```"):
                text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
            return json.loads(text)
    except Exception as e:
        logger.error(f"LLM ticket creation failed: {e}")
        return {
            "short_description": natural_language[:200],
            "description": natural_language,
            "category": "Network",
            "subcategory": "",
            "impact": "2 - Medium",
            "urgency": "2 - Medium",
            "priority": "3 - Moderate",
            "assignment_group": "Network Operations",
            "configuration_item": "",
        }

# ── Webhook to Insight ───────────────────────────────────────
async def send_to_insight(incident: dict):
    """Send incident to F5 Insight via webhook."""
    if not INSIGHT_WEBHOOK_URL:
        logger.warning("INSIGHT_WEBHOOK_URL not configured, skipping webhook")
        return None

    payload = {
        "issue": {
            "number": incident["number"],
            "summary": incident["short_description"],
            "description": incident["description"],
            "category": incident["category"],
            "priority": incident["priority"],
            "configuration_item": incident.get("configuration_item", ""),
            "assignment_group": incident["assignment_group"],
        },
        "incident_number": incident["number"],
        "callback_url": "",  # Insight will use the integration's configured callback
    }

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(INSIGHT_WEBHOOK_URL, json=payload, timeout=120)
            result = r.json()
            logger.info(f"Insight webhook response: {r.status_code}")
            return result
    except Exception as e:
        logger.error(f"Insight webhook failed: {e}")
        return {"error": str(e)}

# ── API Routes ───────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "ServiceNow Mock", "llm_configured": bool(ANTHROPIC_API_KEY), "insight_configured": bool(INSIGHT_WEBHOOK_URL)}

@app.get("/api/incidents")
async def list_incidents(state: str = None, limit: int = 50):
    conn = _get_db()
    try:
        if state:
            rows = conn.execute("SELECT * FROM incidents WHERE state = ? ORDER BY updated_at DESC LIMIT ?", (state, limit)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM incidents ORDER BY updated_at DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@app.get("/api/incidents/{number}")
async def get_incident(number: str):
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM incidents WHERE number = ?", (number,)).fetchone()
        if not row:
            raise HTTPException(404, "Incident not found")
        inc = dict(row)
        # Get work notes
        notes = conn.execute("SELECT * FROM work_notes WHERE incident_number = ? ORDER BY created_at ASC", (number,)).fetchall()
        inc["work_notes_list"] = [dict(n) for n in notes]
        return inc
    finally:
        conn.close()

@app.post("/api/incidents")
async def create_incident(body: dict):
    """Create incident — can accept structured fields or natural language."""
    now = datetime.now(timezone.utc).isoformat()
    number = _next_inc_number()

    # If natural_language provided, use LLM to parse
    if "natural_language" in body and body["natural_language"]:
        fields = await llm_create_ticket(body["natural_language"])
    else:
        fields = body

    conn = _get_db()
    try:
        conn.execute("""
            INSERT INTO incidents (number, short_description, description, caller, category, subcategory,
                state, impact, urgency, priority, assignment_group, assigned_to, configuration_item,
                contact_type, opened_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            number,
            fields.get("short_description", "New Incident"),
            fields.get("description", ""),
            fields.get("caller", body.get("caller", "admin")),
            fields.get("category", "Network"),
            fields.get("subcategory", ""),
            "New",
            fields.get("impact", "2 - Medium"),
            fields.get("urgency", "2 - Medium"),
            fields.get("priority", "3 - Moderate"),
            fields.get("assignment_group", "Network Operations"),
            fields.get("assigned_to", ""),
            fields.get("configuration_item", ""),
            fields.get("contact_type", "Self-service"),
            now, now,
        ))
        conn.commit()
    finally:
        conn.close()

    inc = await get_incident(number)

    # Add creation work note
    await add_work_note_internal(number, "System", f"Incident created: {fields.get('short_description', '')}")

    # Auto-send to Insight if webhook configured
    if INSIGHT_WEBHOOK_URL:
        await add_work_note_internal(number, "F5 Insight", "Sending incident to F5 Insight for automated analysis...")
        _update_incident_field(number, "insight_status", "sent")
        result = await send_to_insight(inc)
        if result and not result.get("error"):
            response_text = result.get("response", "No response")
            skill_request = result.get("skill_request")
            approval_required = result.get("approval_required", False)

            if approval_required and skill_request:
                # Destructive skill needs approval
                _update_incident_field(number, "insight_status", "pending_approval")
                _update_incident_field(number, "pending_skill", json.dumps(skill_request))
                _update_incident_field(number, "insight_response", response_text)
                await add_work_note_internal(number, "F5 Insight",
                    f"⚠ Approval required for destructive action:\n"
                    f"Skill: {skill_request.get('skill_name', '')}\n"
                    f"Device: {skill_request.get('device_hostname', '')}\n"
                    f"Parameters: {json.dumps(skill_request.get('parameters', {}))}\n"
                    f"Reason: {skill_request.get('explanation', '')}\n\n"
                    f"Please approve or reject this action on the incident form.")
            else:
                _update_incident_field(number, "insight_status", "analyzed")
                _update_incident_field(number, "insight_response", response_text)
                await add_work_note_internal(number, "F5 Insight", f"Analysis complete:\n{response_text}")
                if skill_request:
                    await add_work_note_internal(number, "F5 Insight", f"Skill executed: {skill_request.get('skill_name','')} on {skill_request.get('device_hostname','')}")
        elif result:
            _update_incident_field(number, "insight_status", "error")
            await add_work_note_internal(number, "F5 Insight", f"Analysis failed: {result.get('error','Unknown error')}")

    return await get_incident(number)

@app.put("/api/incidents/{number}")
async def update_incident(number: str, body: dict):
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM incidents WHERE number = ?", (number,)).fetchone()
        if not row:
            raise HTTPException(404, "Incident not found")
        updates = []
        params = []
        for field in ["short_description", "description", "state", "impact", "urgency", "priority",
                       "assignment_group", "assigned_to", "category", "subcategory", "configuration_item",
                       "close_notes", "insight_status", "insight_response"]:
            if field in body:
                updates.append(f"{field} = ?")
                params.append(body[field])
        if "state" in body:
            if body["state"] == "Resolved":
                updates.append("resolved_at = ?")
                params.append(datetime.now(timezone.utc).isoformat())
            elif body["state"] == "Closed":
                updates.append("closed_at = ?")
                params.append(datetime.now(timezone.utc).isoformat())
        updates.append("updated_at = ?")
        params.append(datetime.now(timezone.utc).isoformat())
        params.append(number)
        conn.execute(f"UPDATE incidents SET {', '.join(updates)} WHERE number = ?", params)
        conn.commit()
    finally:
        conn.close()
    return await get_incident(number)

@app.delete("/api/incidents/{number}")
async def delete_incident(number: str):
    conn = _get_db()
    try:
        conn.execute("DELETE FROM work_notes WHERE incident_number = ?", (number,))
        cursor = conn.execute("DELETE FROM incidents WHERE number = ?", (number,))
        conn.commit()
        if cursor.rowcount == 0:
            raise HTTPException(404, "Not found")
        return {"deleted": number}
    finally:
        conn.close()

# Work Notes
@app.post("/api/incidents/{number}/notes")
async def add_work_note(number: str, body: dict):
    content = body.get("content", "")
    author = body.get("author", "admin")
    if not content:
        raise HTTPException(400, "Content required")
    return await add_work_note_internal(number, author, content)

async def add_work_note_internal(number: str, author: str, content: str, note_type: str = "work_note"):
    conn = _get_db()
    try:
        note_id = str(uuid.uuid4())[:12]
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO work_notes (id, incident_number, author, content, created_at, note_type) VALUES (?, ?, ?, ?, ?, ?)",
            (note_id, number, author, content, now, note_type),
        )
        conn.execute("UPDATE incidents SET updated_at = ? WHERE number = ?", (now, number))
        conn.commit()
        return {"id": note_id, "incident_number": number, "author": author, "content": content, "created_at": now}
    finally:
        conn.close()

def _update_incident_field(number: str, field: str, value: str):
    conn = _get_db()
    try:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(f"UPDATE incidents SET {field} = ?, updated_at = ? WHERE number = ?", (value, now, number))
        conn.commit()
    finally:
        conn.close()

# Callback endpoint for Insight to POST results back
@app.post("/api/callback")
async def insight_callback(body: dict):
    """Receive results from F5 Insight webhook callback."""
    logger.info(f"Received Insight callback: {json.dumps(body)[:500]}")

    response = body.get("response", "")
    skill_request = body.get("skill_request")
    incident_number = body.get("incident_number", "")
    action = body.get("action", "")
    execution_result = body.get("execution_result")
    approval_required = body.get("approval_required", False)
    approved_by = body.get("approved_by", "")

    # Find incident number if not provided
    if not incident_number:
        conn = _get_db()
        try:
            row = conn.execute(
                "SELECT number FROM incidents WHERE insight_status = 'sent' ORDER BY updated_at DESC LIMIT 1"
            ).fetchone()
            if row:
                incident_number = row["number"]
        finally:
            conn.close()

    if not incident_number:
        return {"received": True, "updated": None}

    if action == "execution_complete":
        # Skill was executed (approved and run)
        _update_incident_field(incident_number, "insight_status", "analyzed")
        _update_incident_field(incident_number, "insight_response", response)
        # Clear pending skill
        _update_incident_field(incident_number, "pending_skill", "")
        await add_work_note_internal(incident_number, "F5 Insight",
            f"✓ Skill executed (approved by {approved_by}):\n{response}")
        if execution_result:
            status = execution_result.get("status", "unknown")
            if status == "complete":
                await add_work_note_internal(incident_number, "F5 Insight",
                    f"Execution completed successfully. Moving incident to In Progress.")
                _update_incident_field(incident_number, "state", "In Progress")
    elif approval_required and skill_request:
        # Skill needs approval — store it on the incident
        _update_incident_field(incident_number, "insight_status", "pending_approval")
        _update_incident_field(incident_number, "pending_skill", json.dumps(skill_request))
        _update_incident_field(incident_number, "insight_response", response)
        await add_work_note_internal(incident_number, "F5 Insight",
            f"⚠ Approval required for destructive action:\n"
            f"Skill: {skill_request.get('skill_name', '')}\n"
            f"Device: {skill_request.get('device_hostname', '')}\n"
            f"Parameters: {json.dumps(skill_request.get('parameters', {}))}\n"
            f"Reason: {skill_request.get('explanation', '')}\n\n"
            f"Please approve or reject this action on the incident form.")
    else:
        # Normal analysis response (non-destructive or info only)
        _update_incident_field(incident_number, "insight_status", "analyzed")
        _update_incident_field(incident_number, "insight_response", response)
        await add_work_note_internal(incident_number, "F5 Insight", f"Analysis:\n{response}")
        if skill_request:
            await add_work_note_internal(incident_number, "F5 Insight",
                f"Skill executed: {skill_request.get('skill_name','')} on {skill_request.get('device_hostname','')}")

    return {"received": True, "updated": incident_number}


# Approve a pending skill — send back to Insight to execute
@app.post("/api/incidents/{number}/approve")
async def approve_skill(number: str, body: dict = {}):
    """Approve a pending skill execution. Sends approval to Insight to execute."""
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM incidents WHERE number = ?", (number,)).fetchone()
        if not row:
            raise HTTPException(404, "Incident not found")
        inc = dict(row)
    finally:
        conn.close()

    pending = inc.get("pending_skill", "")
    if not pending:
        raise HTTPException(400, "No pending skill to approve")

    try:
        skill_request = json.loads(pending)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid pending skill data")

    approved_by = body.get("approved_by", "admin")

    await add_work_note_internal(number, "admin",
        f"✓ Approved skill execution: {skill_request.get('skill_name', '')} "
        f"on {skill_request.get('device_hostname', '')} (approved by {approved_by})")

    _update_incident_field(number, "insight_status", "executing")

    # Send to Insight's execute endpoint
    if not INSIGHT_WEBHOOK_URL:
        raise HTTPException(400, "Insight webhook not configured")

    # Build execute URL from webhook URL: .../webhook/{token} → .../webhook/{token}/execute
    execute_url = INSIGHT_WEBHOOK_URL.rstrip("/") + "/execute"

    execute_payload = {
        "skill_name": skill_request.get("skill_name", ""),
        "device_hostname": skill_request.get("device_hostname", ""),
        "parameters": skill_request.get("parameters", {}),
        "incident_number": number,
        "approved_by": approved_by,
    }

    try:
        async with httpx.AsyncClient() as client:
            r = await client.post(execute_url, json=execute_payload, timeout=120)
            result = r.json()
            logger.info(f"Insight execute response: {r.status_code}")

            # If Insight responded inline (not via callback), process here
            if result.get("execution_result"):
                er = result["execution_result"]
                summary = result.get("summary", "")
                _update_incident_field(number, "insight_status", "analyzed")
                _update_incident_field(number, "insight_response", summary)
                _update_incident_field(number, "pending_skill", "")
                await add_work_note_internal(number, "F5 Insight",
                    f"Execution complete:\n{summary}")
                status = er.get("status", "unknown")
                if status == "complete":
                    _update_incident_field(number, "state", "In Progress")

            return await get_incident(number)
    except Exception as e:
        logger.error(f"Insight execute failed: {e}")
        await add_work_note_internal(number, "F5 Insight", f"Execution request failed: {str(e)}")
        _update_incident_field(number, "insight_status", "error")
        raise HTTPException(500, f"Failed to send to Insight: {str(e)}")


# Reject a pending skill
@app.post("/api/incidents/{number}/reject")
async def reject_skill(number: str, body: dict = {}):
    """Reject a pending skill execution."""
    rejected_by = body.get("rejected_by", "admin")
    reason = body.get("reason", "Rejected by operator")

    conn = _get_db()
    try:
        row = conn.execute("SELECT pending_skill FROM incidents WHERE number = ?", (number,)).fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        pending = row["pending_skill"]
        if not pending:
            raise HTTPException(400, "No pending skill")
        skill_request = json.loads(pending)
    finally:
        conn.close()

    _update_incident_field(number, "pending_skill", "")
    _update_incident_field(number, "insight_status", "rejected")

    await add_work_note_internal(number, "admin",
        f"✗ Rejected skill execution: {skill_request.get('skill_name', '')} "
        f"on {skill_request.get('device_hostname', '')} "
        f"(rejected by {rejected_by}: {reason})")

    return await get_incident(number)

# Stats for dashboard
@app.get("/api/stats")
async def stats():
    conn = _get_db()
    try:
        total = conn.execute("SELECT COUNT(*) as c FROM incidents").fetchone()["c"]
        by_state = {}
        for row in conn.execute("SELECT state, COUNT(*) as c FROM incidents GROUP BY state"):
            by_state[row["state"]] = row["c"]
        by_priority = {}
        for row in conn.execute("SELECT priority, COUNT(*) as c FROM incidents GROUP BY priority"):
            by_priority[row["priority"]] = row["c"]
        return {"total": total, "by_state": by_state, "by_priority": by_priority}
    finally:
        conn.close()

# Re-send to Insight
@app.post("/api/incidents/{number}/analyze")
async def reanalyze(number: str):
    """Manually trigger F5 Insight analysis for an incident."""
    inc = await get_incident(number)
    await add_work_note_internal(number, "F5 Insight", "Re-sending to F5 Insight for analysis...")
    _update_incident_field(number, "insight_status", "sent")
    result = await send_to_insight(inc)
    if result and not result.get("error"):
        response_text = result.get("response", "No response")
        skill_request = result.get("skill_request")
        approval_required = result.get("approval_required", False)

        if approval_required and skill_request:
            _update_incident_field(number, "insight_status", "pending_approval")
            _update_incident_field(number, "pending_skill", json.dumps(skill_request))
            _update_incident_field(number, "insight_response", response_text)
            await add_work_note_internal(number, "F5 Insight",
                f"⚠ Approval required:\nSkill: {skill_request.get('skill_name', '')}\n"
                f"Device: {skill_request.get('device_hostname', '')}\n"
                f"Parameters: {json.dumps(skill_request.get('parameters', {}))}")
        else:
            _update_incident_field(number, "insight_status", "analyzed")
            _update_incident_field(number, "insight_response", response_text)
            await add_work_note_internal(number, "F5 Insight", f"Analysis:\n{response_text}")
    else:
        _update_incident_field(number, "insight_status", "error")
        err = result.get("error", "Unknown") if result else "No response"
        await add_work_note_internal(number, "F5 Insight", f"Failed: {err}")
    return await get_incident(number)
