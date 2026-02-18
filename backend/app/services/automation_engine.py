"""Automation engine — executes multi-skill chains with parameter forwarding.

Split from automation.py for readability. This module handles:
- Template resolution ({{chain.xxx}}, {{steps.step-id.output}})
- Device resolution per step
- Sequential skill execution with gate/failure handling
- Run resume after approval gates
"""
import json
import logging
import re
import uuid
from datetime import datetime, timezone

from ..models import ExecutionRequest, ExecutionStatus

logger = logging.getLogger(__name__)


def _resolve_template(template: str, context: dict) -> str:
    """Resolve {{chain.xxx}} and {{steps.step-id.output.xxx}} templates.

    Context shape:
    {
        "chain": { "device": "bigip01", "virtual_server": "my_vs" },
        "steps": {
            "step-1": {
                "output": "raw output string",
                "status": "complete",
                "execution_id": "xxx"
            }
        }
    }
    """
    def replacer(match):
        path = match.group(1)
        parts = path.split(".")
        obj = context
        for part in parts:
            if isinstance(obj, dict):
                obj = obj.get(part, "")
            elif isinstance(obj, str):
                # Try parsing as JSON to access sub-fields
                # (e.g., steps.step-1.output.mgmt_ip where output is a string)
                try:
                    parsed = json.loads(obj)
                    if isinstance(parsed, dict):
                        obj = parsed.get(part, "")
                    else:
                        return match.group(0)
                except (json.JSONDecodeError, ValueError):
                    # Output may contain multiple JSON objects concatenated;
                    # try to find the first valid JSON object that has the key
                    found = False
                    for m in re.finditer(r'\{[^{}]+\}', obj):
                        try:
                            candidate = json.loads(m.group())
                            if isinstance(candidate, dict) and part in candidate:
                                obj = candidate.get(part, "")
                                found = True
                                break
                        except (json.JSONDecodeError, ValueError):
                            continue
                    if not found:
                        return match.group(0)
            else:
                return match.group(0)
        return str(obj) if obj else ""

    return re.sub(r"\{\{(.+?)\}\}", replacer, str(template))


def _resolve_device(step: dict, context: dict) -> str:
    """Determine the device hostname for a step."""
    source = step.get("device_source", "parameter")
    if source == "fixed":
        return step.get("device_hostname", "")
    elif source == "previous_step":
        ref = step.get("device_from_step", "")
        return context.get("steps", {}).get(ref, {}).get("device", "")
    else:
        param_name = step.get("device_param", "device")
        return context.get("chain", {}).get(param_name, "")


def _build_step_params(step: dict, context: dict) -> dict:
    """Build final parameter dict for a step by resolving templates.

    Starts with ALL chain context as defaults (so skills automatically
    get cluster params like proxmox_node, template_vmid, etc.), then
    overlays explicit parameter/parameter_map entries.
    """
    # Start with all chain params as defaults
    params = dict(context.get("chain", {}))
    # Overlay explicit parameter mappings (these take precedence)
    for key, val in step.get("parameters", {}).items():
        params[key] = _resolve_template(val, context)
    for key, val in step.get("parameter_map", {}).items():
        params[key] = _resolve_template(val, context)
    return params


def _make_step_result(step_id, step, status, **kwargs):
    """Build a step result dict."""
    return {
        "step_id": step_id,
        "skill_name": step["skill_name"],
        "label": step.get("label", step["skill_name"]),
        "status": status,
        "execution_id": kwargs.get("execution_id"),
        "output_preview": kwargs.get("output_preview", ""),
        "analysis": kwargs.get("analysis"),
        "duration_ms": kwargs.get("duration_ms", 0),
        "device": kwargs.get("device", ""),
        "error": kwargs.get("error"),
    }


async def _execute_step(step, step_id, device, params, run):
    """Execute a single skill step and return (step_result, context_entry)."""
    from . import executor

    req = ExecutionRequest(
        skill_name=step["skill_name"],
        device_hostname=device,
        parameters=params,
    )
    result = await executor.execute_skill(req)
    combined_output = "\n".join(s.output for s in result.steps if s.output)

    step_result = _make_step_result(
        step_id, step, result.status.value,
        execution_id=result.execution_id,
        output_preview=combined_output[:500],
        analysis=result.analysis,
        duration_ms=sum(s.duration_ms for s in result.steps),
        device=device,
    )
    context_entry = {
        "output": combined_output,
        "status": result.status.value,
        "execution_id": result.execution_id,
        "device": device,
        "analysis": result.analysis,
    }
    # Try to parse structured output for parameter forwarding.
    # If the output is valid JSON dict, store it as a dict so that
    # _resolve_template can traverse it via dot notation, e.g.
    # {{steps.step-1.output.mgmt_ip}}
    try:
        parsed = json.loads(combined_output)
        if isinstance(parsed, dict):
            context_entry["output"] = parsed
    except (json.JSONDecodeError, ValueError):
        pass  # keep as string
    return step_result, context_entry, result.status


async def _run_steps(automation, run, start_idx, on_gate, save_fn):
    """Execute steps from start_idx onwards. Modifies run in place."""
    for i in range(start_idx, len(automation["steps"])):
        step = automation["steps"][i]
        step_id = step.get("id", f"step-{i+1}")
        run["current_step"] = i + 1

        # Check gate (skip for the first step when resuming)
        if step.get("gate") == "approve" and on_gate == "pause":
            if i > start_idx or run["status"] != "running":
                run["status"] = "waiting_approval"
                run["waiting_step"] = i
                save_fn(run)
                logger.info(f"Run {run['id']} paused at step {i+1} ({step['skill_name']})")
                return

        device = _resolve_device(step, run["context"])
        params = _build_step_params(step, run["context"])

        if not device:
            sr = _make_step_result(step_id, step, "failed", error="Could not resolve device")
            run["step_results"].append(sr)
            if step.get("on_failure") == "stop":
                run["status"] = "failed"
                run["completed_at"] = datetime.now(timezone.utc).isoformat()
                save_fn(run)
                return
            continue

        logger.info(f"Run {run['id']} step {i+1}/{len(automation['steps'])}: "
                     f"{step['skill_name']} on {device}")
        try:
            step_result, ctx_entry, status = await _execute_step(
                step, step_id, device, params, run
            )
            run["step_results"].append(step_result)
            run["context"]["steps"][step_id] = ctx_entry

            if status in (ExecutionStatus.FAILED, ExecutionStatus.ROLLED_BACK):
                failure_action = step.get("on_failure", "stop")
                if failure_action == "stop":
                    run["status"] = "failed"
                    run["completed_at"] = datetime.now(timezone.utc).isoformat()
                    save_fn(run)
                    return
                elif failure_action == "skip":
                    logger.info(f"Step {step_id} failed, on_failure=skip")
                    continue
        except Exception as e:
            logger.error(f"Step {step_id} exception: {e}")
            sr = _make_step_result(step_id, step, "failed", error=str(e))
            run["step_results"].append(sr)
            if step.get("on_failure") == "stop":
                run["status"] = "failed"
                run["completed_at"] = datetime.now(timezone.utc).isoformat()
                save_fn(run)
                return

        save_fn(run)

    run["status"] = "complete"
    run["completed_at"] = datetime.now(timezone.utc).isoformat()
    save_fn(run)
    logger.info(f"Run {run['id']} complete — all steps finished")


async def execute_chain(automation_id: str, chain_params: dict, on_gate: str = "pause") -> dict:
    """Execute an automation chain. See automation.py for storage functions."""
    from . import automation as auto_mod
    from .clusters import get_cluster_params

    auto_mod._ensure_dirs()
    automation = auto_mod.get_automation(automation_id)
    if not automation:
        return {"error": "Automation not found", "success": False}

    run_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    # Build initial chain context from provided params
    chain_context = dict(chain_params)

    # If cluster_id is provided, merge flattened cluster params into chain context.
    # This gives every skill step access to {{chain.frr_peer_ip}}, {{chain.local_asn}},
    # {{chain.template_vmid}}, etc. without manually specifying every parameter.
    cluster_id = chain_params.get("cluster_id")
    if cluster_id:
        cluster_params = get_cluster_params(cluster_id)
        if cluster_params:
            # Cluster params are defaults — explicit chain_params take precedence
            merged = {**cluster_params, **chain_context}
            chain_context = merged

    run = {
        "id": run_id,
        "automation_id": automation_id,
        "automation_name": automation["name"],
        "status": "running",
        "chain_params": chain_params,
        "current_step": 0,
        "total_steps": len(automation["steps"]),
        "step_results": [],
        "started_at": now,
        "completed_at": None,
        "context": {"chain": chain_context, "steps": {}},
    }

    await _run_steps(automation, run, 0, on_gate, auto_mod._save_run)
    return run


async def resume_chain_run(run_id: str, action: str = "approve") -> dict:
    """Resume a paused chain run after approval gate."""
    from . import automation as auto_mod

    run = auto_mod.get_run(run_id)
    if not run:
        return {"error": "Run not found", "success": False}
    if run["status"] != "waiting_approval":
        return {"error": f"Run not waiting approval (status: {run['status']})", "success": False}

    if action == "reject":
        run["status"] = "cancelled"
        run["completed_at"] = datetime.now(timezone.utc).isoformat()
        auto_mod._save_run(run)
        return run

    automation = auto_mod.get_automation(run["automation_id"])
    if not automation:
        return {"error": "Automation definition not found", "success": False}

    start_idx = run.get("waiting_step", 0)
    run["status"] = "running"
    if "waiting_step" in run:
        del run["waiting_step"]

    await _run_steps(automation, run, start_idx, "pause", auto_mod._save_run)
    return run
