"""Health check, image management, and topology discovery routers."""
import logging
import os
import re
from fastapi import APIRouter, HTTPException, UploadFile, File

from ..services import vault
from ..services import images as image_service
from ..services import topology as topology_service
from ..services.transport import execute_ssh

logger = logging.getLogger(__name__)

# ── Health Router ────────────────────────────────────────────
health_router = APIRouter(tags=["health"])


@health_router.get("/api/health")
async def health():
    vault_ok = await vault.vault_health_check()
    llm_provider = os.getenv("LLM_PROVIDER", "anthropic")
    llm_configured = False
    llm_model = ""
    if llm_provider == "anthropic":
        llm_configured = bool(os.getenv("ANTHROPIC_API_KEY", ""))
        llm_model = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-20250514")
    elif llm_provider == "openai":
        llm_configured = bool(os.getenv("OPENAI_API_KEY", ""))
        llm_model = os.getenv("OPENAI_MODEL", "gpt-4o")
    elif llm_provider == "local":
        llm_configured = bool(os.getenv("LOCAL_LLM_BASE_URL", ""))
        llm_model = os.getenv("LOCAL_LLM_MODEL", "gpt-oss:20b")
    return {
        "status": "ok",
        "vault": "connected" if vault_ok else "unavailable",
        "llm_provider": llm_provider,
        "llm_model": llm_model,
        "llm_configured": llm_configured,
    }


# ── Image Router ────────────────────────────────────────────
image_router = APIRouter(prefix="/api/images", tags=["images"])


@image_router.get("/staged")
async def list_staged():
    return await image_service.list_staged_images()


@image_router.post("/upload")
async def upload_image(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")
    if not file.filename.lower().endswith(".iso"):
        raise HTTPException(status_code=400, detail="Only .iso files are accepted")
    try:
        result = await image_service.stage_image(file.filename, file)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@image_router.delete("/staged/{filename}")
async def delete_staged(filename: str):
    success = await image_service.delete_staged_image(filename)
    if not success:
        raise HTTPException(status_code=404, detail="Image not found")
    return {"deleted": filename}


@image_router.post("/push")
async def push_image(body: dict):
    filename = body.get("filename")
    device_hostname = body.get("device_hostname")
    if not filename or not device_hostname:
        raise HTTPException(status_code=400, detail="filename and device_hostname required")
    result = await image_service.push_image_to_device(filename, device_hostname)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


@image_router.get("/device/{hostname}")
async def device_images(hostname: str):
    result = await image_service.list_device_images(hostname)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])
    return result


# ── Topology Router ─────────────────────────────────────────
topology_router = APIRouter(prefix="/api/topology", tags=["topology"])


@topology_router.get("/{hostname}/{virtual_server}")
async def get_topology(hostname: str, virtual_server: str):
    result = await topology_service.get_vs_topology(hostname, virtual_server)
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result.get("error", "Topology discovery failed"))
    return result


@topology_router.get("/{hostname}")
async def list_virtual_servers(hostname: str):
    creds = await vault.get_device_credentials(hostname)
    if not creds:
        raise HTTPException(status_code=404, detail="Device not found")

    result = await execute_ssh(
        host=creds.get("mgmt_ip", hostname),
        port=creds.get("port", 22),
        username=creds.get("username", ""),
        password=creds.get("password", ""),
        private_key=creds.get("ssh_private_key") or None,
        command="tmsh list ltm virtual destination 2>&1",
        timeout=15,
    )
    if not result["success"]:
        raise HTTPException(status_code=500, detail=result.get("error", ""))

    vs_list = []
    current_vs = None
    for line in result["output"].split("\n"):
        m = re.match(r'ltm virtual (\S+)', line)
        if m:
            current_vs = m.group(1).split("/")[-1]
        dm = re.search(r'destination\s+(\S+)', line)
        if dm and current_vs:
            dest = dm.group(1).split("/")[-1]
            vs_list.append({"name": current_vs, "destination": dest})
            current_vs = None
    return vs_list
