"""Skill execution engine — resolves parameters, runs steps, streams results.

Skill CRUD and parsing: see skill_store.py
LLM analysis: see analysis.py
"""
import asyncio
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
import yaml

from ..models import (
    ExecutionRequest, ExecutionResult, ExecutionStatus,
    SkillInfo, SkillStep, StepResult, TransportType,
)
from .transport import execute_ssh, execute_icontrol_bash, execute_icontrol_rest, execute_proxmox_api
from .vault import get_device_credentials
from .skill_store import (  # noqa: F401 — re-exported for backward compat
    list_skills, get_skill, create_skill, delete_skill,
    parse_skill_info as _parse_skill_info,
    parse_skill_full as _parse_skill_full,
)
from .analysis import run_analysis as _run_analysis  # noqa: F401

logger = logging.getLogger(__name__)

SKILLS_DIR = os.getenv("SKILLS_DIR", "/app/skills")
DATA_DIR = os.getenv("DATA_DIR", "/app/data")
HISTORY_DIR = os.path.join(DATA_DIR, "history")


def _ensure_dirs():
    os.makedirs(SKILLS_DIR, exist_ok=True)
    os.makedirs(HISTORY_DIR, exist_ok=True)


# ── Execution ────────────────────────────────────────────────

def _resolve_template(template: str, params: dict, transport: str = "ssh") -> str:
    """Replace {{param}} placeholders with values.
    For icontrol_rest transport, JSON-escape values inside JSON payloads."""
    result = template
    for key, value in params.items():
        val_str = str(value)
        placeholder = f"{{{{{key}}}}}"
        if transport == "icontrol_rest" and placeholder in result:
            # Check if the placeholder is inside a JSON string (preceded by ")
            idx = result.find(placeholder)
            if idx > 0 and result[idx - 1] == '"':
                # JSON-escape: handle newlines, quotes, backslashes
                val_str = val_str.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r').replace('\t', '\\t')
        result = result.replace(placeholder, val_str)
    # Remove any remaining unresolved placeholders that are optional
    result = re.sub(r"\{\{[^}]+\}\}", "", result)
    # Clean up double spaces
    result = re.sub(r"  +", " ", result).strip()
    return result


async def _execute_proxmox_step(command: str, creds: dict, host: str,
                                timeout: int, params: dict = None) -> dict:
    """Route a proxmox_api transport step to Proxmox REST or Insight's own API.

    Parses the command_template as ``METHOD /endpoint {optional_json}``.
    If the endpoint starts with ``/api/``, it routes to Insight's local API
    (for cluster/IP pool management). Otherwise routes to Proxmox VE API.

    Proxmox credentials are looked up in order:
    1. Device creds from Vault (creds dict)
    2. Skill params (params dict — includes cluster params in chain mode)
    """
    params = params or {}
    proxmox_host = creds.get("proxmox_host") or params.get("proxmox_host") or host
    proxmox_port = int(creds.get("proxmox_port") or params.get("proxmox_port") or 8006)
    proxmox_token_id = creds.get("proxmox_token_id") or params.get("proxmox_token_id") or ""
    proxmox_token_secret = creds.get("proxmox_token_secret") or params.get("proxmox_token_secret") or ""

    # Parse: METHOD /endpoint {json}
    json_start = command.find('{')
    if json_start > 0:
        header = command[:json_start].strip()
        json_str = command[json_start:]
        header_parts = header.split(None, 1)
        method = header_parts[0] if len(header_parts) > 0 else "GET"
        endpoint = header_parts[1] if len(header_parts) > 1 else "/"
        try:
            payload = json.loads(json_str)
        except json.JSONDecodeError:
            payload = None
    else:
        parts = command.split(None, 1)
        method = parts[0] if len(parts) > 0 else "GET"
        endpoint = parts[1] if len(parts) > 1 else "/"
        payload = None

    # /api/ prefix → Insight's own cluster management API on localhost:8000
    if endpoint.startswith("/api/"):
        # Use direct HTTP call — Insight's backend is plain HTTP, not HTTPS
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                url = f"http://127.0.0.1:8000{endpoint}"
                if method == "GET":
                    r = await client.get(url)
                elif method == "POST":
                    r = await client.post(url, json=payload or {})
                elif method == "PUT":
                    r = await client.put(url, json=payload or {})
                elif method == "PATCH":
                    r = await client.patch(url, json=payload or {})
                elif method == "DELETE":
                    r = await client.delete(url)
                else:
                    return {"output": "", "error": f"Unsupported method: {method}",
                            "exit_code": -1, "success": False}

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
        except Exception as e:
            return {"output": "", "error": f"Local API error: {str(e)}",
                    "exit_code": -1, "success": False}
    else:
        return await execute_proxmox_api(
            host=proxmox_host, port=proxmox_port,
            token_id=proxmox_token_id, token_secret=proxmox_token_secret,
            endpoint=endpoint, method=method, payload=payload, timeout=timeout,
        )


async def execute_skill(request: ExecutionRequest) -> ExecutionResult:
    """Execute a skill against a device."""
    _ensure_dirs()
    execution_id = str(uuid.uuid4())[:8]
    started_at = datetime.now(timezone.utc).isoformat()

    result = ExecutionResult(
        execution_id=execution_id,
        skill_name=request.skill_name,
        device_hostname=request.device_hostname,
        status=ExecutionStatus.RUNNING,
        parameters=request.parameters,
        started_at=started_at,
    )

    # Load skill
    skill = get_skill(request.skill_name)
    if not skill:
        result.status = ExecutionStatus.FAILED
        result.error = f"Skill '{request.skill_name}' not found"
        _save_execution(result)
        return result

    # Get device credentials from vault
    creds = await get_device_credentials(request.device_hostname)
    if not creds:
        result.status = ExecutionStatus.FAILED
        result.error = f"No credentials found for device '{request.device_hostname}'"
        _save_execution(result)
        return result

    host = creds.get("mgmt_ip", request.device_hostname)
    port = creds.get("port", 22)
    ssh_username = creds.get("username", "")
    ssh_password = creds.get("password", "")
    ssh_private_key = creds.get("ssh_private_key") or None
    rest_username = creds.get("rest_username", "") or ssh_username
    rest_password = creds.get("rest_password", "") or ssh_password
    device_type = creds.get("device_type", "bigip")

    # Execute each step
    # Build a mutable params dict that accumulates step outputs for intra-skill forwarding
    running_params = dict(request.parameters)
    all_output = []
    for step_def in skill.get("steps", []):
        step_name = step_def.get("name", "unknown")
        transport = step_def.get("transport", "ssh")
        command_template = step_def.get("command_template", "")
        timeout = step_def.get("timeout", 30)

        # ── Target Override ──────────────────────────────────
        # If a step has "target: replica", route SSH and iControl transports
        # to the replica's mgmt_ip (from running_params) instead of the
        # Vault device host. This allows provision/config-sync skills to
        # target the newly cloned VM while proxmox_api steps still route
        # to Proxmox/Insight APIs.
        step_target = step_def.get("target", "")
        if step_target == "replica" and transport in ("ssh", "icontrol_rest", "icontrol_bash"):
            step_host = (running_params.get("target_host") or running_params.get("dhcp_ip") or running_params.get("mgmt_ip") or host)
            # Replica creds: check running_params first, fall back to Vault device creds
            if transport in ("icontrol_rest", "icontrol_bash"):
                step_rest_user = running_params.get("rest_user", rest_username)
                step_rest_pass = running_params.get("rest_pass", rest_password)
                username, password = step_rest_user, step_rest_pass
            else:
                step_ssh_user = running_params.get("ssh_user", ssh_username)
                step_ssh_pass = running_params.get("ssh_pass", ssh_password)
                username, password = step_ssh_user, step_ssh_pass
            logger.info(f"Step '{step_name}' targeting replica at {step_host}")
        elif step_target == "proxmox" and transport == "ssh":
            # Target the Proxmox host directly via SSH (for ARP discovery, etc.)
            step_host = running_params.get("proxmox_host", host)
            username = running_params.get("proxmox_ssh_user", "root")
            password = running_params.get("proxmox_ssh_pass", "")
            logger.info(f"Step '{step_name}' targeting Proxmox host at {step_host}")
        else:
            step_host = host
            # Pick credentials based on transport
            if transport in ("icontrol_rest", "icontrol_bash"):
                username, password = rest_username, rest_password
            else:
                username, password = ssh_username, ssh_password

        # Resolve command template with accumulated params
        command = _resolve_template(command_template, running_params, transport)

        step_result = StepResult(
            step_name=step_name,
            status=ExecutionStatus.RUNNING,
            command=command,
        )
        result.steps.append(step_result)

        try:
            import time
            t0 = time.time()

            if transport == "icontrol_rest":
                # Parse endpoint and method from command
                # Format: METHOD /endpoint {json_payload}
                # Find the JSON payload by looking for the first {
                json_start = command.find('{')
                if json_start > 0:
                    header = command[:json_start].strip()
                    json_str = command[json_start:]
                    header_parts = header.split(None, 1)
                    method = header_parts[0] if len(header_parts) > 0 else "GET"
                    endpoint = header_parts[1] if len(header_parts) > 1 else "/"
                    try:
                        payload = json.loads(json_str)
                    except json.JSONDecodeError:
                        payload = None
                else:
                    parts = command.split(None, 1)
                    method = parts[0] if len(parts) > 0 else "GET"
                    endpoint = parts[1] if len(parts) > 1 else "/"
                    payload = None
                exec_result = await execute_icontrol_rest(
                    host=step_host, port=443, username=username, password=password,
                    endpoint=endpoint, method=method, payload=payload, timeout=timeout,
                )
            elif transport == "icontrol_bash":
                exec_result = await execute_icontrol_bash(
                    host=step_host, port=443, username=username, password=password,
                    command=command, timeout=timeout,
                )
            elif transport == "proxmox_api":
                exec_result = await _execute_proxmox_step(
                    command, creds, host, timeout, running_params,
                )
            else:
                # Default SSH — use step_host for target override
                exec_result = await execute_ssh(
                    host=step_host, port=port, username=username, password=password,
                    command=command, timeout=timeout,
                    private_key=ssh_private_key if step_target not in ("replica", "proxmox") else None,
                )

            elapsed = int((time.time() - t0) * 1000)
            step_result.duration_ms = elapsed
            step_result.output = exec_result.get("output", "")
            step_result.error = exec_result.get("error")
            step_result.status = ExecutionStatus.COMPLETE if exec_result.get("success") else ExecutionStatus.FAILED

            all_output.append(f"=== {step_name} ===\n{step_result.output}")

            # Intra-skill step output forwarding: if step output is JSON,
            # merge its keys into running_params so subsequent steps can
            # reference them as {{key}}. e.g. allocate_ip returns
            # {"mgmt_ip": "...", "vmid": 110} → {{mgmt_ip}}, {{vmid}} available.
            if exec_result.get("success") and step_result.output:
                try:
                    parsed = json.loads(step_result.output)
                    if isinstance(parsed, dict):
                        # Also add with alternate names for compatibility
                        # e.g. "vmid" → also "new_vmid"
                        running_params.update(parsed)
                        if "vmid" in parsed and "new_vmid" not in running_params:
                            running_params["new_vmid"] = parsed["vmid"]
                except (json.JSONDecodeError, ValueError):
                    pass

            if not exec_result.get("success"):
                # Check if this step allows continuing on failure
                continue_on_fail = step_def.get("continue_on_fail", False)
                if continue_on_fail:
                    logger.warning(f"Step '{step_name}' failed but continue_on_fail is set, continuing...")
                    step_result.output = step_result.output + f"\n[Step failed but allowed to continue: {step_result.error}]"
                else:
                    result.status = ExecutionStatus.FAILED
                    result.error = f"Step '{step_name}' failed: {step_result.error}"
                    break

        except Exception as e:
            step_result.status = ExecutionStatus.FAILED
            step_result.error = str(e)
            result.status = ExecutionStatus.FAILED
            result.error = f"Step '{step_name}' exception: {str(e)}"
            break

    # If all steps passed, try LLM analysis
    if result.status != ExecutionStatus.FAILED:
        result.status = ExecutionStatus.COMPLETE
        combined_output = "\n\n".join(all_output)

        analysis_config = skill.get("analysis", {})
        if analysis_config.get("enabled") and analysis_config.get("prompt_template"):
            result.status = ExecutionStatus.ANALYZING
            analysis_text = await _run_analysis(
                combined_output, request.parameters, analysis_config
            )
            result.analysis = analysis_text
            result.status = ExecutionStatus.COMPLETE

    result.completed_at = datetime.now(timezone.utc).isoformat()
    _save_execution(result)
    return result



# ── Streaming Execution (SSE) ────────────────────────────────

async def execute_skill_streaming(request: ExecutionRequest):
    """Execute a skill yielding SSE events for each step. Used for real-time progress."""
    _ensure_dirs()
    execution_id = str(uuid.uuid4())[:8]
    started_at = datetime.now(timezone.utc).isoformat()

    # Load skill
    skill = get_skill(request.skill_name)
    if not skill:
        yield {"type": "error", "error": f"Skill '{request.skill_name}' not found"}
        return

    # Get device credentials
    creds = await get_device_credentials(request.device_hostname)
    if not creds:
        yield {"type": "error", "error": f"No credentials for '{request.device_hostname}'"}
        return

    host = creds.get("mgmt_ip", request.device_hostname)
    port = creds.get("port", 22)
    ssh_username = creds.get("username", "")
    ssh_password = creds.get("password", "")
    ssh_private_key = creds.get("ssh_private_key") or None
    rest_username = creds.get("rest_username", "") or ssh_username
    rest_password = creds.get("rest_password", "") or ssh_password

    steps = skill.get("steps", [])
    total_steps = len(steps)

    yield {
        "type": "execution_start",
        "execution_id": execution_id,
        "skill_name": request.skill_name,
        "device_hostname": request.device_hostname,
        "total_steps": total_steps,
    }

    all_output = []
    all_step_results = []
    failed = False
    running_params = dict(request.parameters)

    for i, step_def in enumerate(steps):
        step_name = step_def.get("name", "unknown")
        transport = step_def.get("transport", "ssh")
        command_template = step_def.get("command_template", "")
        timeout = step_def.get("timeout", 30)

        # ── Target Override (streaming path) ─────────────
        step_target = step_def.get("target", "")
        if step_target == "replica" and transport in ("ssh", "icontrol_rest", "icontrol_bash"):
            step_host = (running_params.get("target_host") or running_params.get("dhcp_ip") or running_params.get("mgmt_ip") or host)
            if transport in ("icontrol_rest", "icontrol_bash"):
                username = running_params.get("rest_user", rest_username)
                password = running_params.get("rest_pass", rest_password)
            else:
                username = running_params.get("ssh_user", ssh_username)
                password = running_params.get("ssh_pass", ssh_password)
        elif step_target == "proxmox" and transport == "ssh":
            step_host = running_params.get("proxmox_host", host)
            username = running_params.get("proxmox_ssh_user", "root")
            password = running_params.get("proxmox_ssh_pass", "")
        else:
            step_host = host
            if transport in ("icontrol_rest", "icontrol_bash"):
                username, password = rest_username, rest_password
            else:
                username, password = ssh_username, ssh_password

        command = _resolve_template(command_template, running_params, transport)

        yield {
            "type": "step_start",
            "step_index": i,
            "step_name": step_name,
            "step_label": step_def.get("label", step_name),
            "total_steps": total_steps,
        }

        import time
        t0 = time.time()
        try:
            if transport == "icontrol_rest":
                json_start = command.find('{')
                if json_start > 0:
                    header = command[:json_start].strip()
                    json_str = command[json_start:]
                    header_parts = header.split(None, 1)
                    method = header_parts[0] if len(header_parts) > 0 else "GET"
                    endpoint = header_parts[1] if len(header_parts) > 1 else "/"
                    try:
                        payload = json.loads(json_str)
                    except json.JSONDecodeError:
                        payload = None
                else:
                    parts = command.split(None, 1)
                    method = parts[0] if len(parts) > 0 else "GET"
                    endpoint = parts[1] if len(parts) > 1 else "/"
                    payload = None
                exec_result = await execute_icontrol_rest(
                    host=step_host, port=443, username=username, password=password,
                    endpoint=endpoint, method=method, payload=payload, timeout=timeout,
                )
            elif transport == "icontrol_bash":
                exec_result = await execute_icontrol_bash(
                    host=step_host, port=443, username=username, password=password,
                    command=command, timeout=timeout,
                )
            elif transport == "proxmox_api":
                exec_result = await _execute_proxmox_step(
                    command, creds, host, timeout, running_params,
                )
            else:
                exec_result = await execute_ssh(
                    host=step_host, port=port, username=username, password=password,
                    command=command, timeout=timeout,
                    private_key=ssh_private_key if step_target not in ("replica", "proxmox") else None,
                )

            elapsed = int((time.time() - t0) * 1000)
            step_ok = exec_result.get("success", False)
            output = exec_result.get("output", "")
            error = exec_result.get("error")

            all_output.append(f"=== {step_name} ===\n{output}")
            all_step_results.append({
                "step_name": step_name,
                "status": "complete" if step_ok else "failed",
                "output": output,
                "error": error,
                "duration_ms": elapsed,
            })

            yield {
                "type": "step_complete",
                "step_index": i,
                "step_name": step_name,
                "status": "complete" if step_ok else "failed",
                "output": output[:2000],
                "error": error,
                "duration_ms": elapsed,
                "total_steps": total_steps,
            }

            if not step_ok:
                continue_on_fail = step_def.get("continue_on_fail", False)
                if not continue_on_fail:
                    failed = True
                    break
            else:
                # Intra-skill step output forwarding (streaming path)
                if output:
                    try:
                        parsed = json.loads(output)
                        if isinstance(parsed, dict):
                            running_params.update(parsed)
                            if "vmid" in parsed and "new_vmid" not in running_params:
                                running_params["new_vmid"] = parsed["vmid"]
                    except (json.JSONDecodeError, ValueError):
                        pass

        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            all_step_results.append({
                "step_name": step_name,
                "status": "failed",
                "output": "",
                "error": str(e),
                "duration_ms": elapsed,
            })
            yield {
                "type": "step_complete",
                "step_index": i,
                "step_name": step_name,
                "status": "failed",
                "output": "",
                "error": str(e),
                "duration_ms": elapsed,
                "total_steps": total_steps,
            }
            failed = True
            break

    # Run analysis if all steps passed
    analysis = None
    if not failed:
        analysis_config = skill.get("analysis", {})
        if analysis_config.get("enabled") and analysis_config.get("prompt_template"):
            yield {"type": "analyzing"}
            combined_output = "\n\n".join(all_output)
            analysis = await _run_analysis(combined_output, request.parameters, analysis_config)

    # Build and save the full result
    result = ExecutionResult(
        execution_id=execution_id,
        skill_name=request.skill_name,
        device_hostname=request.device_hostname,
        status=ExecutionStatus.FAILED if failed else ExecutionStatus.COMPLETE,
        parameters=request.parameters,
        steps=[StepResult(
            step_name=s["step_name"], status=s["status"],
            output=s["output"], error=s.get("error"),
            duration_ms=s["duration_ms"],
        ) for s in all_step_results],
        analysis=analysis,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc).isoformat(),
    )
    _save_execution(result)

    yield {
        "type": "execution_complete",
        "execution_id": execution_id,
        "status": "failed" if failed else "complete",
        "result": result.model_dump(),
    }


# ── History ──────────────────────────────────────────────────

def _save_execution(result: ExecutionResult):
    """Save execution result to disk."""
    _ensure_dirs()
    filepath = os.path.join(HISTORY_DIR, f"{result.execution_id}.json")
    with open(filepath, "w") as f:
        json.dump(result.model_dump(), f, indent=2, default=str)


def list_executions(limit: int = 50) -> list[dict]:
    """List recent execution results."""
    _ensure_dirs()
    history_path = Path(HISTORY_DIR)
    files = sorted(history_path.glob("*.json"), key=os.path.getmtime, reverse=True)
    results = []
    for f in files[:limit]:
        try:
            with open(f) as fh:
                results.append(json.load(fh))
        except Exception:
            pass
    return results


def get_execution(execution_id: str) -> dict | None:
    """Get a specific execution result."""
    filepath = os.path.join(HISTORY_DIR, f"{execution_id}.json")
    if os.path.exists(filepath):
        with open(filepath) as f:
            return json.load(f)
    return None
