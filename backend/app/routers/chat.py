"""Chat router — LLM chat, skill execution from chat, and conversation history."""
import json
import logging
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from ..models import ExecutionRequest
from ..services import vault, executor
from ..services import chat as chat_service
from ..services import chat_history

logger = logging.getLogger(__name__)

# ── Chat Router ─────────────────────────────────────────────
chat_router = APIRouter(prefix="/api/chat", tags=["chat"])


@chat_router.post("/")
async def chat_message(body: dict):
    messages = body.get("messages", [])
    device_list = await _get_device_list()
    result = await chat_service.process_chat(messages, device_list)
    return result


@chat_router.post("/execute")
async def chat_execute(body: dict):
    skill_request = body.get("skill_request", {})
    if not skill_request:
        raise HTTPException(status_code=400, detail="No skill_request provided")
    result = await chat_service.execute_approved_skill(skill_request)

    # Fire outgoing webhooks
    try:
        from ..services.integrations import fire_outgoing_webhook
        event = "skill_complete" if result.get("status") == "complete" else "skill_failed"
        await fire_outgoing_webhook(event, {
            "skill_name": skill_request.get("skill_name"),
            "device_hostname": skill_request.get("device_hostname"),
            "result": result,
        })
    except Exception as e:
        logger.warning(f"Outgoing webhook fire failed: {e}")

    return result


@chat_router.post("/execute/stream")
async def chat_execute_stream(body: dict):
    """Execute an approved skill from chat with SSE streaming progress."""
    skill_request = body.get("skill_request", {})
    if not skill_request:
        raise HTTPException(status_code=400, detail="No skill_request provided")

    async def event_generator():
        try:
            request = ExecutionRequest(
                skill_name=skill_request["skill_name"],
                device_hostname=skill_request["device_hostname"],
                parameters=skill_request.get("parameters", {}),
            )
            async for event in executor.execute_skill_streaming(request):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


async def _get_device_list() -> list[dict]:
    device_list = []
    try:
        hostnames = await vault.list_devices()
        for hostname in hostnames:
            creds = await vault.get_device_credentials(hostname)
            if creds:
                device_list.append({
                    "hostname": hostname,
                    "device_type": creds.get("device_type", "bigip"),
                    "mgmt_ip": creds.get("mgmt_ip", ""),
                    "description": creds.get("description", ""),
                })
    except Exception as e:
        logger.warning(f"Could not load devices for chat: {e}")
    return device_list


# ── Chat History Router ──────────────────────────────────────
history_router = APIRouter(prefix="/api/conversations", tags=["chat-history"])


@history_router.get("/")
async def list_conversations(limit: int = 50):
    return chat_history.list_conversations(limit)


@history_router.post("/")
async def create_conversation(body: dict = None):
    title = (body or {}).get("title", "New Conversation")
    return chat_history.create_conversation(title)


@history_router.get("/{conv_id}")
async def get_conversation(conv_id: str):
    conv = chat_history.get_conversation(conv_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@history_router.delete("/{conv_id}")
async def delete_conversation(conv_id: str):
    if not chat_history.delete_conversation(conv_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"deleted": conv_id}


@history_router.put("/{conv_id}")
async def rename_conversation(conv_id: str, body: dict):
    title = body.get("title", "")
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    if not chat_history.rename_conversation(conv_id, title):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"renamed": conv_id, "title": title}


@history_router.post("/{conv_id}/messages")
async def add_message(conv_id: str, body: dict):
    return chat_history.add_message(
        conv_id=conv_id,
        role=body.get("role", "user"),
        content=body.get("content", ""),
        skill_request=body.get("skill_request"),
        execution_result=body.get("execution_result"),
        status=body.get("status"),
    )


@history_router.patch("/messages/{msg_id}")
async def update_message(msg_id: str, body: dict):
    chat_history.update_message(
        msg_id=msg_id,
        execution_result=body.get("execution_result"),
        status=body.get("status"),
    )
    return {"updated": msg_id}
