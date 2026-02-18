"""Image management service — stage ISOs locally and push to BIG-IP devices."""
import asyncio
import hashlib
import logging
import os
import shutil
from pathlib import Path
from datetime import datetime

import httpx

from . import vault

logger = logging.getLogger(__name__)

# Local staging directory inside the container
IMAGES_DIR = os.getenv("IMAGES_DIR", "/app/images")
# Chunk size for REST upload to BIG-IP (1MB)
CHUNK_SIZE = 1024 * 1024


def _ensure_dir():
    Path(IMAGES_DIR).mkdir(parents=True, exist_ok=True)


async def list_staged_images() -> list[dict]:
    """List all ISO images staged locally."""
    _ensure_dir()
    images = []
    for f in sorted(Path(IMAGES_DIR).iterdir()):
        if f.is_file() and f.suffix.lower() == ".iso":
            stat = f.stat()
            images.append({
                "filename": f.name,
                "size_bytes": stat.st_size,
                "size_human": _human_size(stat.st_size),
                "staged_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
    return images


async def stage_image(filename: str, file_obj) -> dict:
    """Stage an uploaded ISO file to local storage.

    file_obj is a FastAPI UploadFile — we stream it to disk
    to avoid loading multi-GB files into memory.
    """
    _ensure_dir()

    # Sanitize filename
    safe_name = Path(filename).name
    if not safe_name.lower().endswith(".iso"):
        safe_name += ".iso"

    dest = Path(IMAGES_DIR) / safe_name
    total_bytes = 0
    md5 = hashlib.md5()

    try:
        with open(dest, "wb") as out:
            while True:
                chunk = await file_obj.read(CHUNK_SIZE)
                if not chunk:
                    break
                out.write(chunk)
                md5.update(chunk)
                total_bytes += len(chunk)
    except Exception as e:
        # Clean up partial file
        if dest.exists():
            dest.unlink()
        raise Exception(f"Failed to stage image: {e}")

    logger.info(f"Staged image: {safe_name} ({_human_size(total_bytes)}, md5={md5.hexdigest()})")

    return {
        "filename": safe_name,
        "size_bytes": total_bytes,
        "size_human": _human_size(total_bytes),
        "md5": md5.hexdigest(),
        "path": str(dest),
    }


async def delete_staged_image(filename: str) -> bool:
    """Delete a staged ISO from local storage."""
    path = Path(IMAGES_DIR) / Path(filename).name
    if path.exists() and path.is_file():
        path.unlink()
        logger.info(f"Deleted staged image: {filename}")
        return True
    return False


async def push_image_to_device(filename: str, device_hostname: str,
                                progress_callback=None) -> dict:
    """Push a staged ISO to a BIG-IP device via iControl REST file transfer API.

    Uses /mgmt/cm/autodeploy/software-image-uploads/ endpoint with
    chunked Content-Range uploads, same as Ansible bigip_software_image.
    """
    filepath = Path(IMAGES_DIR) / Path(filename).name
    if not filepath.exists():
        return {"success": False, "error": f"Image '{filename}' not found in staging"}

    # Get device credentials
    creds = await vault.get_device_credentials(device_hostname)
    if not creds:
        return {"success": False, "error": f"Device '{device_hostname}' not found in vault"}

    host = creds.get("mgmt_ip", device_hostname)
    rest_user = creds.get("rest_username", "") or creds.get("username", "")
    rest_pass = creds.get("rest_password", "") or creds.get("password", "")

    if not rest_user or not rest_pass:
        return {"success": False, "error": "No REST credentials configured for device"}

    file_size = filepath.stat().st_size
    upload_url = f"https://{host}:443/mgmt/cm/autodeploy/software-image-uploads/{filepath.name}"

    logger.info(f"Pushing {filepath.name} ({_human_size(file_size)}) to {device_hostname}")

    try:
        async with httpx.AsyncClient(verify=False, timeout=300) as client:
            offset = 0
            chunk_num = 0

            with open(filepath, "rb") as f:
                while offset < file_size:
                    chunk = f.read(CHUNK_SIZE)
                    if not chunk:
                        break

                    chunk_end = offset + len(chunk) - 1
                    content_range = f"{offset}-{chunk_end}/{file_size}"

                    headers = {
                        "Content-Type": "application/octet-stream",
                        "Content-Range": content_range,
                        "Content-Length": str(len(chunk)),
                    }

                    r = await client.post(
                        upload_url,
                        content=chunk,
                        headers=headers,
                        auth=(rest_user, rest_pass),
                    )

                    if r.status_code not in (200, 201):
                        return {
                            "success": False,
                            "error": f"Upload failed at chunk {chunk_num} (byte {offset}): HTTP {r.status_code} — {r.text[:500]}",
                            "bytes_uploaded": offset,
                        }

                    offset += len(chunk)
                    chunk_num += 1

                    if progress_callback and chunk_num % 50 == 0:
                        pct = int(offset / file_size * 100)
                        await progress_callback(pct, offset, file_size)

            logger.info(f"Upload complete: {filepath.name} → {device_hostname} ({chunk_num} chunks)")

            return {
                "success": True,
                "filename": filepath.name,
                "device": device_hostname,
                "size_bytes": file_size,
                "size_human": _human_size(file_size),
                "chunks": chunk_num,
            }

    except httpx.TimeoutException:
        return {"success": False, "error": "Upload timed out — device may be slow or unreachable"}
    except Exception as e:
        return {"success": False, "error": f"Upload failed: {str(e)}"}


async def list_device_images(device_hostname: str) -> dict:
    """List software images already on a BIG-IP device via REST."""
    creds = await vault.get_device_credentials(device_hostname)
    if not creds:
        return {"success": False, "error": f"Device '{device_hostname}' not found"}

    host = creds.get("mgmt_ip", device_hostname)
    rest_user = creds.get("rest_username", "") or creds.get("username", "")
    rest_pass = creds.get("rest_password", "") or creds.get("password", "")

    try:
        async with httpx.AsyncClient(verify=False, timeout=30) as client:
            r = await client.get(
                f"https://{host}:443/mgmt/tm/sys/software/image",
                auth=(rest_user, rest_pass),
            )
            if r.status_code != 200:
                return {"success": False, "error": f"HTTP {r.status_code}: {r.text[:300]}"}

            data = r.json()
            images = []
            for item in data.get("items", []):
                images.append({
                    "name": item.get("name", ""),
                    "version": item.get("version", ""),
                    "build": item.get("build", ""),
                    "fileSize": item.get("fileSize", ""),
                    "verified": item.get("verified", ""),
                })
            return {"success": True, "images": images}

    except Exception as e:
        return {"success": False, "error": str(e)}


def _human_size(size_bytes: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} PB"
