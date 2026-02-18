"""Skills listing + execution router (sync and SSE streaming)."""
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..models import SkillCreate, SkillInfo, ExecutionRequest, ExecutionResult
from ..services import executor

logger = logging.getLogger(__name__)

# ── Skill Router ─────────────────────────────────────────────
skill_router = APIRouter(prefix="/api/skills", tags=["skills"])


@skill_router.get("/", response_model=list[SkillInfo])
async def list_skills():
    return executor.list_skills()


@skill_router.get("/{name}")
async def get_skill(name: str):
    skill = executor.get_skill(name)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    return skill


@skill_router.post("/", response_model=dict)
async def create_skill(skill: SkillCreate):
    success = executor.create_skill(skill)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to create skill")
    return {"created": skill.name}


@skill_router.delete("/{name}")
async def delete_skill(name: str):
    success = executor.delete_skill(name)
    if not success:
        raise HTTPException(status_code=404, detail="Skill not found")
    return {"deleted": name}


# ── Execution Router ─────────────────────────────────────────
exec_router = APIRouter(prefix="/api/execute", tags=["execution"])


@exec_router.post("/", response_model=ExecutionResult)
async def execute(request: ExecutionRequest):
    return await executor.execute_skill(request)


@exec_router.post("/stream")
async def execute_stream(request: ExecutionRequest):
    """Execute a skill with SSE streaming for real-time progress updates."""
    async def event_generator():
        try:
            async for event in executor.execute_skill_streaming(request):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@exec_router.get("/history")
async def execution_history(limit: int = 50):
    return executor.list_executions(limit)


@exec_router.get("/history/{execution_id}")
async def get_execution(execution_id: str):
    result = executor.get_execution(execution_id)
    if not result:
        raise HTTPException(status_code=404, detail="Execution not found")
    return result
