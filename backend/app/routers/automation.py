"""Automation API — chain definitions, execution, and run management."""
import logging
from fastapi import APIRouter, HTTPException

from ..services import automation as auto_service

logger = logging.getLogger(__name__)

automation_router = APIRouter(prefix="/api/automations", tags=["automations"])


# ── Static / Non-parameterized Routes (MUST be before /{auto_id}) ──

@automation_router.get("/")
async def list_automations():
    return auto_service.list_automations()


@automation_router.get("/templates")
async def list_templates():
    return auto_service.get_templates()


@automation_router.post("/")
async def create_automation(body: dict):
    name = body.get("name", "")
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    return auto_service.create_automation(body)


# ── Run Routes (MUST be before /{auto_id} to avoid "runs" matching as auto_id) ──

@automation_router.get("/runs/all")
async def list_all_runs(limit: int = 50):
    return auto_service.list_runs(limit=limit)


@automation_router.get("/runs/{run_id}")
async def get_run(run_id: str):
    result = auto_service.get_run(run_id)
    if not result:
        raise HTTPException(status_code=404, detail="Run not found")
    return result


@automation_router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, body: dict):
    """Resume a paused run. Body: { "action": "approve" | "reject" }"""
    action = body.get("action", "approve")
    result = await auto_service.resume_chain_run(run_id, action)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ── Parameterized Chain Routes ─────────────────────────────

@automation_router.get("/{auto_id}")
async def get_automation(auto_id: str):
    result = auto_service.get_automation(auto_id)
    if not result:
        raise HTTPException(status_code=404, detail="Automation not found")
    return result


@automation_router.put("/{auto_id}")
async def update_automation(auto_id: str, body: dict):
    result = auto_service.update_automation(auto_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Automation not found")
    return result


@automation_router.delete("/{auto_id}")
async def delete_automation(auto_id: str):
    if not auto_service.delete_automation(auto_id):
        raise HTTPException(status_code=404, detail="Automation not found")
    return {"deleted": auto_id}


@automation_router.post("/{auto_id}/duplicate")
async def duplicate_automation(auto_id: str):
    result = auto_service.duplicate_automation(auto_id)
    if not result:
        raise HTTPException(status_code=404, detail="Automation not found")
    return result


@automation_router.post("/{auto_id}/run")
async def run_automation(auto_id: str, body: dict):
    """Start an automation chain execution.

    Body: { "parameters": { "device": "bigip01", ... }, "auto_approve": false }
    """
    params = body.get("parameters", {})
    on_gate = "auto_approve" if body.get("auto_approve") else "pause"
    result = await auto_service.execute_chain(auto_id, params, on_gate)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@automation_router.get("/{auto_id}/runs")
async def list_runs(auto_id: str, limit: int = 20):
    return auto_service.list_runs(automation_id=auto_id, limit=limit)
