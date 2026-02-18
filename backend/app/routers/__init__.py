"""Router re-exports — each router lives in its own file for maintainability."""

from .devices import device_router
from .skills import skill_router, exec_router
from .chat import chat_router, history_router
from .infra import health_router, image_router, topology_router
from .integrations_routes import integrations_router, mcp_client_router
from .automation import automation_router
from .clusters import cluster_router

__all__ = [
    "device_router",
    "skill_router",
    "exec_router",
    "chat_router",
    "history_router",
    "health_router",
    "image_router",
    "topology_router",
    "integrations_router",
    "mcp_client_router",
    "automation_router",
    "cluster_router",
]
