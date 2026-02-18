"""Device transport layer - SSH and iControl REST."""
import asyncio
import io
import logging
import json
import httpx
import paramiko

logger = logging.getLogger(__name__)


def _load_private_key(key_pem: str):
    """Load a private key from PEM string. Returns pkey or error string."""
    key_pem = key_pem.strip()
    key_file = io.StringIO(key_pem)
    # Try each key type
    for key_class in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey):
        try:
            key_file.seek(0)
            return key_class.from_private_key(key_file)
        except Exception:
            continue
    return "Failed to load private key — unsupported key type or invalid PEM format"


async def execute_ssh(host: str, port: int, username: str, password: str = "",
                      command: str = "", timeout: int = 30,
                      private_key: str = None) -> dict:
    """Execute a command via SSH and return output. Supports password or key auth."""
    def _run():
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            connect_kwargs = {
                "hostname": host,
                "port": port,
                "username": username,
                "timeout": min(timeout, 10),
                "look_for_keys": False,
                "allow_agent": False,
            }
            if private_key:
                # Load private key from PEM string
                pkey = _load_private_key(private_key)
                if isinstance(pkey, str):
                    return {"output": "", "error": pkey, "exit_code": -1, "success": False}
                connect_kwargs["pkey"] = pkey
            else:
                connect_kwargs["password"] = password

            try:
                client.connect(**connect_kwargs)
            except paramiko.ssh_exception.BadAuthenticationType as e:
                # BIG-IP requires keyboard-interactive auth for some users.
                # Fall back to transport-level auth_interactive.
                if "keyboard-interactive" in str(e):
                    logger.debug(f"SSH to {host}: falling back to keyboard-interactive auth")
                    transport = client.get_transport()
                    if transport is None:
                        # Need to establish transport manually
                        import socket
                        sock = socket.create_connection((host, port), timeout=min(timeout, 10))
                        transport = paramiko.Transport(sock)
                        transport.connect()
                    def _ki_handler(title, instructions, prompt_list):
                        return [password] * len(prompt_list)
                    transport.auth_interactive(username, _ki_handler)
                else:
                    raise
            stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            exit_code = stdout.channel.recv_exit_status()
            # Merge stderr into output so errors are visible in step results
            combined = out
            if err:
                combined = out + ("\n" if out else "") + "STDERR: " + err
            return {
                "output": combined,
                "error": err if err else None,
                "exit_code": exit_code,
                "success": exit_code == 0,
            }
        except paramiko.AuthenticationException:
            return {"output": "", "error": "Authentication failed", "exit_code": -1, "success": False}
        except paramiko.SSHException as e:
            return {"output": "", "error": f"SSH error: {str(e)}", "exit_code": -1, "success": False}
        except Exception as e:
            return {"output": "", "error": f"Connection error: {str(e)}", "exit_code": -1, "success": False}
        finally:
            client.close()

    try:
        return await asyncio.wait_for(asyncio.to_thread(_run), timeout=timeout + 15)
    except asyncio.TimeoutError:
        return {"output": "Command timed out after {}s. The remote command may still be running.".format(timeout),
                "error": "Timeout", "exit_code": -1, "success": False}


async def execute_icontrol_rest(host: str, port: int, username: str,
                                 password: str, endpoint: str,
                                 method: str = "GET", payload: dict = None,
                                 timeout: int = 30) -> dict:
    """Execute an iControl REST API call against a BIG-IP."""
    base_url = f"https://{host}:{port}"
    url = f"{base_url}{endpoint}"

    try:
        async with httpx.AsyncClient(verify=False, timeout=timeout) as client:
            kwargs = {
                "auth": (username, password),
                "headers": {"Content-Type": "application/json"},
            }
            if method == "GET":
                r = await client.get(url, **kwargs)
            elif method == "POST":
                r = await client.post(url, json=payload or {}, **kwargs)
            elif method == "PATCH":
                r = await client.patch(url, json=payload or {}, **kwargs)
            elif method == "PUT":
                r = await client.put(url, json=payload or {}, **kwargs)
            elif method == "DELETE":
                r = await client.delete(url, **kwargs)
            else:
                return {"output": "", "error": f"Unsupported method: {method}", "exit_code": -1, "success": False}

            try:
                body = r.json()
                output = json.dumps(body, indent=2)
            except Exception:
                output = r.text

            return {
                "output": output,
                "error": None if r.is_success else f"HTTP {r.status_code}",
                "exit_code": 0 if r.is_success else r.status_code,
                "success": r.is_success,
            }
    except httpx.ConnectError as e:
        return {"output": "", "error": f"Connection failed: {str(e)}", "exit_code": -1, "success": False}
    except Exception as e:
        return {"output": "", "error": f"REST error: {str(e)}", "exit_code": -1, "success": False}


async def execute_icontrol_bash(host: str, port: int, username: str,
                                 password: str, command: str,
                                 timeout: int = 30) -> dict:
    """Execute a bash command on BIG-IP via iControl REST /mgmt/tm/util/bash."""
    payload = {
        "command": "run",
        "utilCmdArgs": f"-c '{command}'"
    }
    result = await execute_icontrol_rest(
        host=host, port=port, username=username, password=password,
        endpoint="/mgmt/tm/util/bash",
        method="POST", payload=payload, timeout=timeout,
    )
    # Parse the commandResult from the JSON response
    if result["success"]:
        try:
            body = json.loads(result["output"])
            result["output"] = body.get("commandResult", result["output"])
        except Exception:
            pass
    return result


async def execute_proxmox_api(host: str, port: int, token_id: str,
                              token_secret: str, endpoint: str,
                              method: str = "GET", payload: dict = None,
                              timeout: int = 30) -> dict:
    """Execute a Proxmox VE API call.

    Auth uses PVE API tokens: ``PVEAPIToken=<token_id>=<token_secret>``.
    Host should be the Proxmox node IP/hostname, port is typically 8006.
    """
    base_url = f"https://{host}:{port}"
    url = f"{base_url}{endpoint}"
    headers = {
        "Authorization": f"PVEAPIToken={token_id}={token_secret}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(verify=False, timeout=timeout) as client:
            if method == "GET":
                r = await client.get(url, headers=headers)
            elif method == "POST":
                r = await client.post(url, headers=headers, json=payload or {})
            elif method == "PUT":
                r = await client.put(url, headers=headers, json=payload or {})
            elif method == "DELETE":
                # Proxmox DELETE uses query params, not JSON body
                params = payload or {}
                r = await client.delete(url, headers=headers, params=params)
            else:
                return {"output": "", "error": f"Unsupported method: {method}",
                        "exit_code": -1, "success": False}

            try:
                body = r.json()
                # Proxmox wraps responses in {"data": ...}
                output = json.dumps(body, indent=2)
            except Exception:
                output = r.text

            return {
                "output": output,
                "error": None if r.is_success else f"HTTP {r.status_code}",
                "exit_code": 0 if r.is_success else r.status_code,
                "success": r.is_success,
            }
    except httpx.ConnectError as e:
        return {"output": "", "error": f"Proxmox connection failed: {str(e)}",
                "exit_code": -1, "success": False}
    except Exception as e:
        return {"output": "", "error": f"Proxmox API error: {str(e)}",
                "exit_code": -1, "success": False}


async def test_device_connectivity(host: str, port: int, username: str,
                                    password: str, device_type: str,
                                    rest_username: str = None,
                                    rest_password: str = None,
                                    private_key: str = None) -> dict:
    """Test connectivity to a device."""
    r_user = rest_username or username
    r_pass = rest_password or password
    if device_type == "bigip":
        # Try iControl REST first (with REST creds)
        result = await execute_icontrol_rest(
            host=host, port=443, username=r_user, password=r_pass,
            endpoint="/mgmt/tm/sys/version", timeout=10,
        )
        if result["success"]:
            try:
                body = json.loads(result["output"])
                entries = body.get("entries", {})
                for key, val in entries.items():
                    props = val.get("nestedStats", {}).get("entries", {})
                    version = props.get("Version", {}).get("description", "unknown")
                    build = props.get("Build", {}).get("description", "unknown")
                    return {
                        "connected": True,
                        "method": "icontrol_rest",
                        "version": version,
                        "build": build,
                    }
            except Exception:
                pass
            return {"connected": True, "method": "icontrol_rest", "version": "unknown"}

        # Fall back to SSH
        result = await execute_ssh(
            host=host, port=port, username=username, password=password,
            command="tmsh show sys version | grep Version", timeout=10,
            private_key=private_key,
        )
        if result["success"]:
            return {"connected": True, "method": "ssh" + (" (key)" if private_key else ""), "version": result["output"].strip()}

        return {"connected": False, "error": result.get("error", "Unknown error")}

    else:
        # NGINX - SSH only
        result = await execute_ssh(
            host=host, port=port, username=username, password=password,
            command="nginx -v 2>&1 || echo 'nginx not found'", timeout=10,
            private_key=private_key,
        )
        if result["success"]:
            return {"connected": True, "method": "ssh" + (" (key)" if private_key else ""), "version": result["output"].strip()}
        return {"connected": False, "error": result.get("error", "Unknown error")}
