"""F5 Insight Skills — Backend API."""
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routers import (
    device_router, skill_router, exec_router, health_router,
    chat_router, image_router, topology_router,
    history_router, integrations_router, mcp_client_router,
    automation_router, cluster_router,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

app = FastAPI(
    title="F5 Insight Skills API",
    description="Skill-based troubleshooting agent for F5 BIG-IP and NGINX",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(device_router)
app.include_router(skill_router)
app.include_router(exec_router)
app.include_router(chat_router)
app.include_router(history_router)
app.include_router(image_router)
app.include_router(topology_router)
app.include_router(integrations_router)
app.include_router(mcp_client_router)
app.include_router(automation_router)
app.include_router(cluster_router)


@app.on_event("startup")
async def startup():
    logging.getLogger(__name__).info("F5 Insight Skills API v0.2.0 starting up")
