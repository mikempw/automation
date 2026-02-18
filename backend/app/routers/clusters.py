"""Cluster API — ECMP cluster definitions, IP pool, and membership management."""
import logging
from fastapi import APIRouter, HTTPException

from ..services import clusters as cluster_service

logger = logging.getLogger(__name__)

cluster_router = APIRouter(prefix="/api/clusters", tags=["clusters"])


# ── Cluster Definitions ────────────────────────────────────

@cluster_router.get("/")
async def list_clusters():
    return cluster_service.list_clusters()


@cluster_router.post("/")
async def create_cluster(body: dict):
    name = body.get("name", "")
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    return cluster_service.create_cluster(body)


@cluster_router.get("/{cluster_id}")
async def get_cluster(cluster_id: str):
    result = cluster_service.get_cluster(cluster_id)
    if not result:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return result


@cluster_router.get("/{cluster_id}/params")
async def get_cluster_params(cluster_id: str):
    """Get flattened cluster params for skill template resolution."""
    result = cluster_service.get_cluster_params(cluster_id)
    if not result:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return result


@cluster_router.put("/{cluster_id}")
async def update_cluster(cluster_id: str, body: dict):
    result = cluster_service.update_cluster(cluster_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return result


@cluster_router.delete("/{cluster_id}")
async def delete_cluster(cluster_id: str):
    if not cluster_service.delete_cluster(cluster_id):
        raise HTTPException(status_code=404, detail="Cluster not found")
    return {"deleted": cluster_id}


# ── IP Pool ────────────────────────────────────────────────

@cluster_router.get("/{cluster_id}/ip-pool")
async def get_pool_status(cluster_id: str):
    result = cluster_service.get_pool_status(cluster_id)
    if not result:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return result


@cluster_router.post("/{cluster_id}/ip-pool/allocate")
async def allocate_ip(cluster_id: str):
    result = cluster_service.allocate_ip(cluster_id)
    if not result:
        raise HTTPException(status_code=409, detail="IP pool exhausted or cluster not found")
    return result


@cluster_router.post("/{cluster_id}/ip-pool/release")
async def release_ip(cluster_id: str, body: dict):
    mgmt_ip = body.get("mgmt_ip")
    self_ip = body.get("self_ip")
    if not mgmt_ip and not self_ip:
        raise HTTPException(status_code=400, detail="mgmt_ip or self_ip required")
    success = cluster_service.release_ip(cluster_id, mgmt_ip=mgmt_ip, self_ip=self_ip)
    if not success:
        raise HTTPException(status_code=404, detail="IP not found in allocated pool")
    return {"released": True, "mgmt_ip": mgmt_ip, "self_ip": self_ip}


# ── Membership ─────────────────────────────────────────────

# ── License Pool ──────────────────────────────────────────

@cluster_router.get("/{cluster_id}/license-pool")
async def get_license_pool(cluster_id: str):
    result = cluster_service.get_license_pool_status(cluster_id)
    if not result:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return result


@cluster_router.post("/{cluster_id}/license-pool/allocate")
async def allocate_license(cluster_id: str):
    result = cluster_service.allocate_license(cluster_id)
    if not result:
        raise HTTPException(status_code=409, detail="License pool exhausted or cluster not found")
    return result


@cluster_router.post("/{cluster_id}/license-pool/release")
async def release_license(cluster_id: str, body: dict):
    regkey = body.get("regkey")
    index = body.get("index")
    if regkey is None and index is None:
        raise HTTPException(status_code=400, detail="regkey or index required")
    success = cluster_service.release_license(cluster_id, regkey=regkey, index=index)
    if not success:
        raise HTTPException(status_code=404, detail="License not found in pool")
    return {"released": True}


# ── Membership ─────────────────────────────────────────────

@cluster_router.get("/{cluster_id}/members")
async def list_members(cluster_id: str):
    cluster = cluster_service.get_cluster(cluster_id)
    if not cluster:
        raise HTTPException(status_code=404, detail="Cluster not found")
    return list(cluster.get("members", {}).values())


@cluster_router.post("/{cluster_id}/members")
async def add_member(cluster_id: str, body: dict):
    result = cluster_service.add_member(cluster_id, body)
    if not result:
        raise HTTPException(status_code=404, detail="Cluster not found")

    # Option B: If register_in_vault is set, store device creds in Vault
    # with Proxmox credentials from the cluster config. This enables the
    # executor's _execute_proxmox_step() to find Proxmox creds directly
    # in the device's Vault entry without a fallback lookup.
    if body.get("register_in_vault"):
        from ..services.vault import store_device_credentials
        proxmox_creds = cluster_service.get_proxmox_creds_for_vault(cluster_id)
        cluster = cluster_service.get_cluster(cluster_id)
        master = cluster.get("master", {}) if cluster else {}
        hostname = result["hostname"]
        try:
            await store_device_credentials(
                hostname=hostname,
                username=body.get("username", master.get("user", "admin")),
                password=body.get("password", master.get("pass", "")),
                device_type="bigip",
                mgmt_ip=result.get("mgmt_ip", ""),
                rest_username=body.get("rest_username", body.get("username", master.get("user", "admin"))),
                rest_password=body.get("rest_password", body.get("password", master.get("pass", ""))),
                description=f"Autoscale member of {cluster_id}",
                extra=proxmox_creds,
            )
            result["vault_registered"] = True
        except Exception as e:
            logger.warning(f"Failed to register {hostname} in Vault: {e}")
            result["vault_registered"] = False
            result["vault_error"] = str(e)

    return result


@cluster_router.patch("/{cluster_id}/members/{hostname}")
async def update_member(cluster_id: str, hostname: str, body: dict):
    status = body.get("status")
    if not status:
        raise HTTPException(status_code=400, detail="status required")
    result = cluster_service.update_member_status(cluster_id, hostname, status)
    if not result:
        raise HTTPException(status_code=404, detail="Member or cluster not found")
    return result


@cluster_router.delete("/{cluster_id}/members/{hostname}")
async def remove_member(cluster_id: str, hostname: str):
    if not cluster_service.remove_member(cluster_id, hostname):
        raise HTTPException(status_code=404, detail="Member or cluster not found")
    return {"removed": hostname}
