"""Device management router — CRUD + connectivity test."""
import logging
from fastapi import APIRouter, HTTPException

from ..models import DeviceCreate, DeviceInfo
from ..services import vault
from ..services.transport import test_device_connectivity

logger = logging.getLogger(__name__)

device_router = APIRouter(prefix="/api/devices", tags=["devices"])


@device_router.get("/", response_model=list[DeviceInfo])
async def list_devices():
    hostnames = await vault.list_devices()
    devices = []
    for hostname in hostnames:
        creds = await vault.get_device_credentials(hostname)
        if creds:
            devices.append(DeviceInfo(
                hostname=hostname,
                mgmt_ip=creds.get("mgmt_ip", ""),
                device_type=creds.get("device_type", "bigip"),
                port=creds.get("port", 22),
                ssh_auth_method=creds.get("ssh_auth_method", "password"),
                description=creds.get("description", ""),
                tags=creds.get("tags", []),
            ))
    return devices


@device_router.post("/", response_model=DeviceInfo)
async def add_device(device: DeviceCreate):
    await vault.store_device_credentials(
        hostname=device.hostname,
        username=device.username,
        password=device.password or "",
        device_type=device.device_type.value,
        mgmt_ip=device.mgmt_ip,
        port=device.port,
        description=device.description or "",
        tags=device.tags,
        rest_username=device.rest_username or "",
        rest_password=device.rest_password or "",
        ssh_auth_method=device.ssh_auth_method.value,
        ssh_private_key=device.ssh_private_key or "",
    )
    return DeviceInfo(
        hostname=device.hostname,
        mgmt_ip=device.mgmt_ip,
        device_type=device.device_type,
        port=device.port,
        ssh_auth_method=device.ssh_auth_method.value,
        description=device.description,
        tags=device.tags,
    )


@device_router.put("/{hostname}", response_model=DeviceInfo)
async def update_device(hostname: str, device: DeviceCreate):
    """Update an existing device's credentials and metadata."""
    existing = await vault.get_device_credentials(hostname)
    if not existing:
        raise HTTPException(status_code=404, detail="Device not found")

    # If hostname changed, delete old and create new
    if device.hostname != hostname:
        await vault.delete_device_credentials(hostname)

    await vault.store_device_credentials(
        hostname=device.hostname,
        username=device.username,
        password=device.password or "",
        device_type=device.device_type.value,
        mgmt_ip=device.mgmt_ip,
        port=device.port,
        description=device.description or "",
        tags=device.tags,
        rest_username=device.rest_username or "",
        rest_password=device.rest_password or "",
        ssh_auth_method=device.ssh_auth_method.value,
        ssh_private_key=device.ssh_private_key or "",
    )
    return DeviceInfo(
        hostname=device.hostname,
        mgmt_ip=device.mgmt_ip,
        device_type=device.device_type,
        port=device.port,
        ssh_auth_method=device.ssh_auth_method.value,
        description=device.description,
        tags=device.tags,
    )


@device_router.get("/{hostname}")
async def get_device(hostname: str):
    """Get device details for editing (credentials masked)."""
    creds = await vault.get_device_credentials(hostname)
    if not creds:
        raise HTTPException(status_code=404, detail="Device not found")
    return {
        "hostname": hostname,
        "mgmt_ip": creds.get("mgmt_ip", ""),
        "device_type": creds.get("device_type", "bigip"),
        "port": creds.get("port", 22),
        "ssh_auth_method": creds.get("ssh_auth_method", "password"),
        "username": creds.get("username", ""),
        "has_password": bool(creds.get("password")),
        "has_ssh_key": bool(creds.get("ssh_private_key")),
        "rest_username": creds.get("rest_username", ""),
        "has_rest_password": bool(creds.get("rest_password")),
        "description": creds.get("description", ""),
        "tags": creds.get("tags", []),
    }


@device_router.delete("/{hostname}")
async def remove_device(hostname: str):
    success = await vault.delete_device_credentials(hostname)
    if not success:
        raise HTTPException(status_code=404, detail="Device not found")
    return {"deleted": hostname}


@device_router.post("/{hostname}/test")
async def test_device(hostname: str):
    creds = await vault.get_device_credentials(hostname)
    if not creds:
        raise HTTPException(status_code=404, detail="Device not found in vault")
    result = await test_device_connectivity(
        host=creds["mgmt_ip"],
        port=creds.get("port", 22),
        username=creds["username"],
        password=creds.get("password", ""),
        device_type=creds.get("device_type", "bigip"),
        rest_username=creds.get("rest_username", ""),
        rest_password=creds.get("rest_password", ""),
        private_key=creds.get("ssh_private_key") or None,
    )
    return result
