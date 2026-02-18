"""OpenBao vault integration for credential storage."""
import httpx
import logging
import os

logger = logging.getLogger(__name__)

VAULT_ADDR = os.getenv("VAULT_ADDR", "http://openbao:8200")
VAULT_MOUNT = "secret"
DEVICE_PATH = "devices"


def _get_vault_token() -> str:
    """Load vault token from file (persistent mode) or env var (dev mode)."""
    token_file = os.getenv("VAULT_TOKEN_FILE", "")
    if token_file and os.path.exists(token_file):
        with open(token_file, "r") as f:
            token = f.read().strip()
            if token:
                return token
    return os.getenv("VAULT_TOKEN", "insight-dev-token")


# Cache token at module load
VAULT_TOKEN = _get_vault_token()


def _headers():
    return {"X-Vault-Token": VAULT_TOKEN, "Content-Type": "application/json"}


def _url(path: str) -> str:
    return f"{VAULT_ADDR}/v1/{VAULT_MOUNT}/data/{path}"


def _meta_url(path: str) -> str:
    return f"{VAULT_ADDR}/v1/{VAULT_MOUNT}/metadata/{path}"


async def vault_health_check() -> bool:
    """Check if vault is reachable and unsealed."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(f"{VAULT_ADDR}/v1/sys/health", timeout=5)
            return r.status_code in (200, 429, 472, 473)
    except Exception as e:
        logger.warning(f"Vault health check failed: {e}")
        return False


async def store_device_credentials(hostname: str, username: str, password: str = "",
                                    device_type: str = "bigip", mgmt_ip: str = "",
                                    port: int = 22, description: str = "",
                                    tags: list = None, rest_username: str = None,
                                    rest_password: str = None,
                                    ssh_auth_method: str = "password",
                                    ssh_private_key: str = None,
                                    extra: dict = None):
    """Store device credentials in OpenBao.

    The optional `extra` dict allows storing additional key-value pairs
    alongside the standard fields. Used for Proxmox API credentials
    (proxmox_host, proxmox_port, proxmox_token_id, proxmox_token_secret)
    on autoscale-managed devices.
    """
    data = {
        "username": username,
        "password": password or "",
        "device_type": device_type,
        "mgmt_ip": mgmt_ip,
        "port": port,
        "description": description or "",
        "tags": tags or [],
        "ssh_auth_method": ssh_auth_method,
    }
    if ssh_private_key:
        data["ssh_private_key"] = ssh_private_key
    if rest_username:
        data["rest_username"] = rest_username
    if rest_password:
        data["rest_password"] = rest_password
    if extra:
        data.update(extra)
    payload = {"data": data}
    async with httpx.AsyncClient() as client:
        r = await client.put(
            _url(f"{DEVICE_PATH}/{hostname}"),
            json=payload,
            headers=_headers(),
            timeout=10,
        )
        if r.status_code not in (200, 204):
            raise Exception(f"Vault write failed ({r.status_code}): {r.text}")
        logger.info(f"Stored credentials for {hostname}")
        return True


async def get_device_credentials(hostname: str) -> dict | None:
    """Retrieve device credentials from OpenBao."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                _url(f"{DEVICE_PATH}/{hostname}"),
                headers=_headers(),
                timeout=10,
            )
            if r.status_code == 404:
                return None
            if r.status_code != 200:
                raise Exception(f"Vault read failed ({r.status_code}): {r.text}")
            data = r.json()
            return data.get("data", {}).get("data", {})
    except Exception as e:
        logger.error(f"Failed to get credentials for {hostname}: {e}")
        return None


async def delete_device_credentials(hostname: str) -> bool:
    """Delete device credentials from OpenBao."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.delete(
                _meta_url(f"{DEVICE_PATH}/{hostname}"),
                headers=_headers(),
                timeout=10,
            )
            return r.status_code in (200, 204)
    except Exception as e:
        logger.error(f"Failed to delete credentials for {hostname}: {e}")
        return False


async def list_devices() -> list[str]:
    """List all device hostnames stored in vault."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.request(
                "LIST",
                _meta_url(DEVICE_PATH),
                headers=_headers(),
                timeout=10,
            )
            if r.status_code == 404:
                return []
            if r.status_code != 200:
                return []
            data = r.json()
            return data.get("data", {}).get("keys", [])
    except Exception as e:
        logger.warning(f"Failed to list devices: {e}")
        return []
