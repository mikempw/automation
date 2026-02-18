"""F5 Insight Skills — MCP Server.

Exposes all skills as MCP tools and all devices as MCP resources.
Any MCP-compatible client (Claude Desktop, Claude Code, etc.) can
connect and manage F5 infrastructure through natural language.

Run: python mcp_server.py
Connect: http://localhost:8100/mcp
"""
import asyncio
import json
import logging
import os
import sys
import re
from pathlib import Path
from typing import Any

# Add backend app to path so we can reuse services
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "backend"))

from mcp.server.fastmcp import FastMCP

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("f5-insight-mcp")

# ── Initialize MCP Server ──────────────────────────────────
mcp = FastMCP(
    "F5 Insight Skills",
    instructions=(
        "This MCP server provides tools for managing F5 BIG-IP and NGINX devices. "
        "Use `list_devices` to see available devices, then run diagnostic or "
        "configuration skills against them. Destructive operations will be clearly "
        "marked — confirm with the user before executing."
    ),
)

# ── Paths ──────────────────────────────────────────────────
SKILLS_DIR = os.getenv("SKILLS_DIR", os.path.join(os.path.dirname(__file__), "backend", "skills"))
VAULT_ADDR = os.getenv("VAULT_ADDR", "http://localhost:8200")

# ── Skill Loader ───────────────────────────────────────────
import yaml
import frontmatter


def _load_all_skills() -> list[dict]:
    """Parse all SKILL.md files into dicts."""
    skills = []
    skills_path = Path(SKILLS_DIR)
    if not skills_path.exists():
        logger.warning(f"Skills directory not found: {SKILLS_DIR}")
        return skills

    for entry in sorted(skills_path.iterdir()):
        if entry.is_dir():
            skill_file = entry / "SKILL.md"
            if skill_file.exists():
                try:
                    post = frontmatter.load(str(skill_file))
                    meta = post.metadata.get("metadata", {})
                    content = post.content

                    skill = {
                        "name": post.metadata.get("name", entry.name),
                        "description": post.metadata.get("description", ""),
                        "product": meta.get("product", "unknown"),
                        "version": meta.get("version", "1.0"),
                        "parameters": [],
                        "steps": [],
                        "safety": {},
                        "analysis": {},
                    }

                    yaml_blocks = re.findall(r"```yaml\n(.*?)```", content, re.DOTALL)
                    for block in yaml_blocks:
                        try:
                            parsed = yaml.safe_load(block)
                            if isinstance(parsed, list) and len(parsed) > 0:
                                if "command_template" in parsed[0]:
                                    skill["steps"] = parsed
                                elif "label" in parsed[0]:
                                    skill["parameters"] = parsed
                            elif isinstance(parsed, dict):
                                if "requires_approval" in parsed:
                                    skill["safety"] = parsed
                                if "enabled" in parsed and "prompt_template" in parsed:
                                    skill["analysis"] = parsed
                        except Exception:
                            pass

                    skills.append(skill)
                except Exception as e:
                    logger.warning(f"Failed to parse {skill_file}: {e}")
    return skills


# ── Vault Client (direct HTTP, no backend dependency) ──────
import httpx


def _get_vault_token() -> str:
    token_file = os.getenv("VAULT_TOKEN_FILE", "")
    if token_file and os.path.exists(token_file):
        with open(token_file) as f:
            token = f.read().strip()
            if token:
                return token
    return os.getenv("VAULT_TOKEN", "insight-dev-token")


VAULT_TOKEN = _get_vault_token()


async def _vault_list_devices() -> list[str]:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.request(
                "LIST",
                f"{VAULT_ADDR}/v1/secret/metadata/devices",
                headers={"X-Vault-Token": VAULT_TOKEN},
                timeout=5,
            )
            if r.status_code != 200:
                return []
            return r.json().get("data", {}).get("keys", [])
    except Exception as e:
        logger.warning(f"Vault list failed: {e}")
        return []


async def _vault_get_device(hostname: str) -> dict | None:
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{VAULT_ADDR}/v1/secret/data/devices/{hostname}",
                headers={"X-Vault-Token": VAULT_TOKEN},
                timeout=5,
            )
            if r.status_code != 200:
                return None
            return r.json().get("data", {}).get("data", {})
    except Exception as e:
        logger.warning(f"Vault get failed: {e}")
        return None


# ── SSH/REST Execution (inline, no backend import) ─────────
import paramiko
import io


def _load_private_key(key_pem: str):
    key_pem = key_pem.strip()
    key_file = io.StringIO(key_pem)
    for key_class in (paramiko.Ed25519Key, paramiko.RSAKey, paramiko.ECDSAKey):
        try:
            key_file.seek(0)
            return key_class.from_private_key(key_file)
        except Exception:
            continue
    return None


async def _exec_ssh(host, port, username, password="", command="",
                    timeout=30, private_key=None) -> dict:
    def _run():
        client = paramiko.SSHClient()
        client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        try:
            kw = {"hostname": host, "port": port, "username": username,
                  "timeout": min(timeout, 10), "look_for_keys": False, "allow_agent": False}
            if private_key:
                pkey = _load_private_key(private_key)
                if pkey:
                    kw["pkey"] = pkey
                else:
                    return {"output": "", "error": "Invalid private key", "success": False}
            else:
                kw["password"] = password
            client.connect(**kw)
            stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
            out = stdout.read().decode("utf-8", errors="replace")
            err = stderr.read().decode("utf-8", errors="replace")
            exit_code = stdout.channel.recv_exit_status()
            combined = out + ("\nSTDERR: " + err if err else "")
            return {"output": combined, "error": err if err else None,
                    "exit_code": exit_code, "success": exit_code == 0}
        except Exception as e:
            return {"output": "", "error": str(e), "success": False}
        finally:
            client.close()
    return await asyncio.to_thread(_run)


async def _exec_rest(host, port, username, password, endpoint,
                     method="GET", payload=None, timeout=30) -> dict:
    url = f"https://{host}:{port}{endpoint}"
    try:
        async with httpx.AsyncClient(verify=False) as client:
            r = await client.request(
                method, url, auth=(username, password),
                json=payload, timeout=timeout,
            )
            return {"output": r.text, "success": r.status_code < 400,
                    "error": None if r.status_code < 400 else f"HTTP {r.status_code}"}
    except Exception as e:
        return {"output": "", "error": str(e), "success": False}


def _resolve_template(template: str, params: dict, transport: str = "ssh") -> str:
    """Replace {{param}} placeholders in command template."""
    result = template
    for key, value in params.items():
        result = result.replace("{{" + key + "}}", str(value))
    if transport == "icontrol_rest":
        result = result.replace("{{", "{").replace("}}", "}")
    return result


async def _execute_skill(skill: dict, device_hostname: str,
                         parameters: dict) -> dict:
    """Execute a skill's steps against a device."""
    creds = await _vault_get_device(device_hostname)
    if not creds:
        return {"success": False, "error": f"Device '{device_hostname}' not found in vault"}

    host = creds.get("mgmt_ip", device_hostname)
    port = creds.get("port", 22)
    ssh_user = creds.get("username", "")
    ssh_pass = creds.get("password", "")
    ssh_key = creds.get("ssh_private_key") or None
    rest_user = creds.get("rest_username", "") or ssh_user
    rest_pass = creds.get("rest_password", "") or ssh_pass

    results = []
    for step in skill.get("steps", []):
        transport = step.get("transport", "ssh")
        command = _resolve_template(step.get("command_template", ""), parameters, transport)
        timeout = step.get("timeout", 30)
        continue_on_fail = step.get("continue_on_fail", False)

        if transport in ("icontrol_rest",):
            json_start = command.find('{')
            if json_start > 0:
                header = command[:json_start].strip().split(None, 1)
                method = header[0] if header else "GET"
                endpoint = header[1] if len(header) > 1 else "/"
                try:
                    payload = json.loads(command[json_start:])
                except json.JSONDecodeError:
                    payload = None
            else:
                parts = command.split(None, 1)
                method = parts[0] if parts else "GET"
                endpoint = parts[1] if len(parts) > 1 else "/"
                payload = None
            r = await _exec_rest(host, 443, rest_user, rest_pass,
                                 endpoint, method, payload, timeout)
        elif transport == "icontrol_bash":
            payload = {"command": "run", "utilCmdArgs": f"-c '{command}'"}
            r = await _exec_rest(host, 443, rest_user, rest_pass,
                                 "/mgmt/tm/util/bash", "POST", payload, timeout)
            if r["success"]:
                try:
                    body = json.loads(r["output"])
                    r["output"] = body.get("commandResult", r["output"])
                except Exception:
                    pass
        elif transport == "proxmox_api":
            # Proxmox API calls — parse command and route
            pve_host = creds.get("proxmox_host", host)
            pve_token_id = creds.get("proxmox_token_id", "")
            pve_token_secret = creds.get("proxmox_token_secret", "")
            json_start = command.find('{')
            if json_start > 0:
                header = command[:json_start].strip().split(None, 1)
                pve_method = header[0] if header else "GET"
                pve_endpoint = header[1] if len(header) > 1 else "/"
                try:
                    pve_payload = json.loads(command[json_start:])
                except json.JSONDecodeError:
                    pve_payload = None
            else:
                parts = command.split(None, 1)
                pve_method = parts[0] if parts else "GET"
                pve_endpoint = parts[1] if len(parts) > 1 else "/"
                pve_payload = None
            if pve_endpoint.startswith("/api/"):
                r = await _exec_rest("127.0.0.1", 8000, "", "",
                                     pve_endpoint, pve_method, pve_payload, timeout)
            else:
                r = await _exec_rest_proxmox(pve_host, pve_token_id,
                                              pve_token_secret, pve_endpoint,
                                              pve_method, pve_payload)
                r = {"output": json.dumps(r.get("data", ""), indent=2),
                     "success": r.get("success", False),
                     "error": r.get("error")}
        else:
            r = await _exec_ssh(host, port, ssh_user, ssh_pass,
                                command, timeout, ssh_key)

        step_result = {
            "step": step.get("name", "unknown"),
            "label": step.get("label", ""),
            "success": r["success"],
            "output": r.get("output", ""),
            "error": r.get("error"),
        }
        results.append(step_result)

        if not r["success"] and not continue_on_fail:
            break

    all_success = all(s["success"] for s in results)
    output_text = "\n\n".join(
        f"--- {s['step']} ({s['label']}) ---\n{s['output']}"
        + (f"\nERROR: {s['error']}" if s['error'] else "")
        for s in results
    )

    return {
        "success": all_success,
        "steps": results,
        "output": output_text,
    }


# ── Register Tools Dynamically ─────────────────────────────
def _register_skills():
    """Load all skills and register each as an MCP tool."""
    skills = _load_all_skills()
    logger.info(f"Loaded {len(skills)} skills from {SKILLS_DIR}")

    # Always register the device listing tool
    @mcp.tool()
    async def list_devices() -> str:
        """List all registered F5 devices with their type, IP, and auth method. Run this first to see available targets."""
        hostnames = await _vault_list_devices()
        if not hostnames:
            return "No devices registered. Add devices through the F5 Insight UI."
        devices = []
        for h in hostnames:
            creds = await _vault_get_device(h)
            if creds:
                devices.append({
                    "hostname": h,
                    "device_type": creds.get("device_type", "unknown"),
                    "mgmt_ip": creds.get("mgmt_ip", ""),
                    "auth_method": creds.get("ssh_auth_method", "password"),
                    "description": creds.get("description", ""),
                })
        return json.dumps(devices, indent=2)

    # Register each skill as a tool
    for skill in skills:
        _register_skill_tool(skill)


def _register_skill_tool(skill: dict):
    """Register a single skill as an MCP tool with proper parameter schema."""
    name = skill["name"].replace("-", "_")
    description = skill["description"]
    safety = skill.get("safety", {})
    is_destructive = safety.get("destructive", False)
    needs_approval = safety.get("requires_approval", True)

    # Build description with safety info
    desc_parts = [description]
    if is_destructive:
        desc_parts.append("⚠️ DESTRUCTIVE: This tool modifies device configuration.")
    if needs_approval:
        desc_parts.append("Requires user confirmation before execution.")
    full_desc = " ".join(desc_parts)

    # Build the parameter list for the tool function
    params = skill.get("parameters", [])
    param_names = [p["name"] for p in params]
    param_descriptions = {p["name"]: p.get("description", "") for p in params}
    required_params = {p["name"] for p in params if p.get("required", True)}
    param_defaults = {p["name"]: p.get("default", "") for p in params}

    # Create the tool function dynamically
    async def skill_executor(device_hostname: str, **kwargs) -> str:
        """Execute the skill — this docstring is replaced dynamically."""
        # Merge defaults
        merged = {}
        for pn in param_names:
            if pn in kwargs and kwargs[pn]:
                merged[pn] = kwargs[pn]
            elif param_defaults.get(pn):
                merged[pn] = param_defaults[pn]

        # Check required params
        missing = [p for p in required_params if p not in merged or not merged[p]]
        if missing:
            return f"Missing required parameters: {', '.join(missing)}"

        result = await _execute_skill(skill, device_hostname, merged)

        if result["success"]:
            return result["output"]
        else:
            return f"EXECUTION FAILED\n\n{result['output']}"

    # We need to create a proper function signature for FastMCP
    # Since FastMCP uses type hints, we'll create a wrapper with explicit params
    # For simplicity, all skill params are strings passed via a JSON params field
    async def tool_fn(device_hostname: str, parameters: str = "{}") -> str:
        f"""Execute skill: {skill['name']}. {full_desc}

        Args:
            device_hostname: Target device hostname (use list_devices to see available devices)
            parameters: JSON object with skill parameters: {json.dumps({p['name']: p.get('description', p['name']) for p in params})}
        """
        try:
            parsed_params = json.loads(parameters) if parameters else {}
        except json.JSONDecodeError:
            return f"Invalid JSON in parameters: {parameters}"

        # Check required params
        missing = [p for p in required_params if p not in parsed_params or not parsed_params[p]]
        if missing:
            param_help = "\n".join(
                f"  - {p['name']} ({'required' if p.get('required', True) else 'optional'}): {p.get('description', '')}"
                for p in params
            )
            return f"Missing required parameters: {', '.join(missing)}\n\nExpected parameters:\n{param_help}"

        result = await _execute_skill(skill, device_hostname, parsed_params)

        if result["success"]:
            return result["output"]
        else:
            return f"EXECUTION FAILED\n\n{result['output']}"

    # Set the function name and docstring
    tool_fn.__name__ = name
    tool_fn.__qualname__ = name
    tool_fn.__doc__ = f"""{full_desc}

Args:
    device_hostname: Target device hostname (use list_devices to see available devices)
    parameters: JSON object with skill parameters: {json.dumps({p['name']: p.get('description', p['name']) for p in params}, indent=2)}
"""

    # Register with FastMCP
    mcp.tool()(tool_fn)
    logger.info(f"  Registered tool: {name} ({'destructive' if is_destructive else 'read-only'}, {len(params)} params)")


# ── Proxmox / FRR / BGP Tools ──────────────────────────────

@mcp.tool()
async def proxmox_clone_vm(proxmox_host: str, proxmox_token_id: str,
                           proxmox_token_secret: str, node: str,
                           template_vmid: int, new_vmid: int,
                           vm_name: str = "") -> str:
    """Clone a Proxmox VM template to create a new BIG-IP VE instance.

    Args:
        proxmox_host: Proxmox host IP/hostname
        proxmox_token_id: PVE API token ID (e.g. root@pam!insight)
        proxmox_token_secret: PVE API token secret
        node: Proxmox node name (e.g. pve01)
        template_vmid: Source template VMID to clone
        new_vmid: Target VMID for the new VM
        vm_name: Optional name for the new VM
    """
    payload = {"newid": new_vmid, "full": 1, "target": node}
    if vm_name:
        payload["name"] = vm_name
    r = await _exec_rest_proxmox(proxmox_host, proxmox_token_id,
                                  proxmox_token_secret,
                                  f"/api2/json/nodes/{node}/qemu/{template_vmid}/clone",
                                  "POST", payload)
    return json.dumps(r, indent=2)


@mcp.tool()
async def proxmox_configure_vm(proxmox_host: str, proxmox_token_id: str,
                                proxmox_token_secret: str, node: str,
                                vmid: int, config: str) -> str:
    """Configure a Proxmox VM's resources and networking.

    Args:
        proxmox_host: Proxmox host IP/hostname
        proxmox_token_id: PVE API token ID
        proxmox_token_secret: PVE API token secret
        node: Proxmox node name
        vmid: VM ID to configure
        config: JSON string of config parameters (cores, memory, net0, net1, etc.)
    """
    try:
        payload = json.loads(config) if isinstance(config, str) else config
    except json.JSONDecodeError:
        return "ERROR: Invalid JSON in config parameter"
    r = await _exec_rest_proxmox(proxmox_host, proxmox_token_id,
                                  proxmox_token_secret,
                                  f"/api2/json/nodes/{node}/qemu/{vmid}/config",
                                  "PUT", payload)
    return json.dumps(r, indent=2)


@mcp.tool()
async def proxmox_start_vm(proxmox_host: str, proxmox_token_id: str,
                            proxmox_token_secret: str, node: str,
                            vmid: int) -> str:
    """Start a Proxmox VM.

    Args:
        proxmox_host: Proxmox host IP/hostname
        proxmox_token_id: PVE API token ID
        proxmox_token_secret: PVE API token secret
        node: Proxmox node name
        vmid: VM ID to start
    """
    r = await _exec_rest_proxmox(proxmox_host, proxmox_token_id,
                                  proxmox_token_secret,
                                  f"/api2/json/nodes/{node}/qemu/{vmid}/status/start",
                                  "POST")
    return json.dumps(r, indent=2)


@mcp.tool()
async def proxmox_stop_vm(proxmox_host: str, proxmox_token_id: str,
                           proxmox_token_secret: str, node: str,
                           vmid: int, force: str = "false") -> str:
    """Stop a Proxmox VM (graceful shutdown or force stop).

    Args:
        proxmox_host: Proxmox host IP/hostname
        proxmox_token_id: PVE API token ID
        proxmox_token_secret: PVE API token secret
        node: Proxmox node name
        vmid: VM ID to stop
        force: "true" for immediate stop, "false" for graceful ACPI shutdown
    """
    if force.lower() == "true":
        endpoint = f"/api2/json/nodes/{node}/qemu/{vmid}/status/stop"
    else:
        endpoint = f"/api2/json/nodes/{node}/qemu/{vmid}/status/shutdown"
    r = await _exec_rest_proxmox(proxmox_host, proxmox_token_id,
                                  proxmox_token_secret, endpoint, "POST")
    return json.dumps(r, indent=2)


@mcp.tool()
async def proxmox_destroy_vm(proxmox_host: str, proxmox_token_id: str,
                              proxmox_token_secret: str, node: str,
                              vmid: int) -> str:
    """⚠️ DESTRUCTIVE: Permanently destroy a Proxmox VM and its disks.

    Args:
        proxmox_host: Proxmox host IP/hostname
        proxmox_token_id: PVE API token ID
        proxmox_token_secret: PVE API token secret
        node: Proxmox node name
        vmid: VM ID to destroy
    """
    r = await _exec_rest_proxmox(proxmox_host, proxmox_token_id,
                                  proxmox_token_secret,
                                  f"/api2/json/nodes/{node}/qemu/{vmid}",
                                  "DELETE", {"purge": 1,
                                             "destroy-unreferenced-disks": 1})
    return json.dumps(r, indent=2)


@mcp.tool()
async def frr_get_bgp_neighbors(frr_host: str, frr_user: str,
                                 frr_password: str = "",
                                 frr_ssh_key: str = "") -> str:
    """Get BGP neighbor summary from an FRR router via SSH.

    Args:
        frr_host: FRR router IP/hostname
        frr_user: SSH username
        frr_password: SSH password (optional if using key)
        frr_ssh_key: SSH private key PEM (optional)
    """
    r = await _exec_ssh(frr_host, 22, frr_user, frr_password,
                         'vtysh -c "show bgp summary"', 15,
                         frr_ssh_key or None)
    return r.get("output", r.get("error", "Connection failed"))


@mcp.tool()
async def frr_get_routes(frr_host: str, frr_user: str,
                          network: str = "",
                          frr_password: str = "",
                          frr_ssh_key: str = "") -> str:
    """Get IP routing table from an FRR router, optionally filtered to a specific network. Shows ECMP path count.

    Args:
        frr_host: FRR router IP/hostname
        frr_user: SSH username
        network: Optional network prefix to filter (e.g. 10.100.1.0/24). If empty, shows full table.
        frr_password: SSH password (optional if using key)
        frr_ssh_key: SSH private key PEM (optional)
    """
    if network:
        cmd = f'vtysh -c "show ip route {network}"'
    else:
        cmd = 'vtysh -c "show ip route"'
    r = await _exec_ssh(frr_host, 22, frr_user, frr_password,
                         cmd, 15, frr_ssh_key or None)
    output = r.get("output", "")
    if network and output:
        # Count ECMP paths
        path_count = output.count("via ")
        output += f"\n\nECMP path count: {path_count}"
    return output or r.get("error", "Connection failed")


@mcp.tool()
async def bigip_get_bgp_summary(device_hostname: str) -> str:
    """Get BGP neighbor summary from a BIG-IP device via imish.

    Args:
        device_hostname: BIG-IP device hostname (use list_devices to see available devices)
    """
    creds = await _vault_get_device(device_hostname)
    if not creds:
        return f"Device '{device_hostname}' not found in vault"
    host = creds.get("mgmt_ip", device_hostname)
    user = creds.get("username", "")
    passwd = creds.get("password", "")
    key = creds.get("ssh_private_key") or None
    r = await _exec_ssh(host, 22, user, passwd,
                         'imish -e "show ip bgp summary" 2>&1; echo ""; '
                         'imish -e "show ip bgp" 2>&1 | head -30',
                         15, key)
    return r.get("output", r.get("error", "Connection failed"))


@mcp.tool()
async def bigip_configure_bgp(device_hostname: str, local_asn: int,
                                neighbor_ip: str, remote_asn: int,
                                network: str, router_id: str = "") -> str:
    """⚠️ DESTRUCTIVE: Configure BGP peering on a BIG-IP via imish. Sets up neighbor and network advertisement.

    Args:
        device_hostname: BIG-IP device hostname
        local_asn: Local BGP AS number
        neighbor_ip: BGP neighbor IP address
        remote_asn: Remote BGP AS number
        network: Network to advertise (e.g. 10.100.1.0/24)
        router_id: BGP router ID (defaults to self-IP if empty)
    """
    creds = await _vault_get_device(device_hostname)
    if not creds:
        return f"Device '{device_hostname}' not found in vault"
    host = creds.get("mgmt_ip", device_hostname)
    user = creds.get("username", "")
    passwd = creds.get("password", "")
    key = creds.get("ssh_private_key") or None

    cmds = ['configure terminal', f'router bgp {local_asn}']
    if router_id:
        cmds.append(f'bgp router-id {router_id}')
    cmds.extend([
        f'neighbor {neighbor_ip} remote-as {remote_asn}',
        f'neighbor {neighbor_ip} ebgp-multihop 2',
        f'network {network}',
        'end', 'write memory',
    ])
    imish_args = " ".join(f'-e \'{c}\'' for c in cmds)
    cmd = f'imish {imish_args} 2>&1; echo ""; imish -e "show running-config" 2>&1 | grep -A 15 "router bgp"'
    r = await _exec_ssh(host, 22, user, passwd, cmd, 30, key)
    return r.get("output", r.get("error", "Connection failed"))


@mcp.tool()
async def bigip_withdraw_bgp_route(device_hostname: str, local_asn: int,
                                    network: str) -> str:
    """⚠️ DESTRUCTIVE: Remove a network advertisement from BGP on a BIG-IP. This withdraws the route from the ECMP group.

    Args:
        device_hostname: BIG-IP device hostname
        local_asn: Local BGP AS number
        network: Network to stop advertising (e.g. 10.100.1.0/24)
    """
    creds = await _vault_get_device(device_hostname)
    if not creds:
        return f"Device '{device_hostname}' not found in vault"
    host = creds.get("mgmt_ip", device_hostname)
    user = creds.get("username", "")
    passwd = creds.get("password", "")
    key = creds.get("ssh_private_key") or None

    cmd = (f'imish -e "configure terminal" -e "router bgp {local_asn}" '
           f'-e "no network {network}" -e "end" -e "write memory" 2>&1; '
           f'echo ""; imish -e "show running-config" 2>&1 | grep -A 10 "router bgp"')
    r = await _exec_ssh(host, 22, user, passwd, cmd, 15, key)
    return r.get("output", r.get("error", "Connection failed"))


async def _exec_rest_proxmox(host, token_id, token_secret,
                              endpoint, method="GET", payload=None):
    """Helper for Proxmox REST API calls in MCP tools."""
    url = f"https://{host}:8006{endpoint}"
    headers = {
        "Authorization": f"PVEAPIToken={token_id}={token_secret}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(verify=False, timeout=60) as client:
            if method == "GET":
                r = await client.get(url, headers=headers)
            elif method == "POST":
                r = await client.post(url, headers=headers, json=payload or {})
            elif method == "PUT":
                r = await client.put(url, headers=headers, json=payload or {})
            elif method == "DELETE":
                r = await client.delete(url, headers=headers, params=payload or {})
            else:
                return {"error": f"Unsupported method: {method}"}
            try:
                return {"success": r.status_code < 400, "status": r.status_code,
                        "data": r.json()}
            except Exception:
                return {"success": r.status_code < 400, "status": r.status_code,
                        "data": r.text}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ── Register Resources ─────────────────────────────────────
@mcp.resource("f5://skills")
def get_skills_catalog() -> str:
    """Complete catalog of available F5 Insight skills with their parameters and descriptions."""
    skills = _load_all_skills()
    catalog = []
    for s in skills:
        catalog.append({
            "name": s["name"],
            "description": s["description"],
            "product": s.get("product", "unknown"),
            "parameters": [
                {"name": p["name"], "required": p.get("required", True),
                 "description": p.get("description", ""), "type": p.get("type", "string")}
                for p in s.get("parameters", [])
            ],
            "destructive": s.get("safety", {}).get("destructive", False),
            "step_count": len(s.get("steps", [])),
        })
    return json.dumps(catalog, indent=2)


# ── Main ───────────────────────────────────────────────────
_register_skills()

if __name__ == "__main__":
    port = int(os.getenv("MCP_PORT", "8100"))
    logger.info(f"Starting F5 Insight MCP server on port {port}")
    logger.info(f"Connect at: http://localhost:{port}/mcp")
    mcp.settings.port = port
    mcp.settings.host = "0.0.0.0"
    mcp.run(transport="streamable-http")
