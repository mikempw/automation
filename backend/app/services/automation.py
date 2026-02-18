"""Automation service — multi-skill chain definitions and storage.

Automations are predefined, repeatable workflows that chain multiple skills
together with parameter forwarding, approval gates, and conditional logic.

Storage: JSON files in DATA_DIR/automations/ and DATA_DIR/automation_runs/
Execution: Delegated to automation_engine.py
"""
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = os.getenv("DATA_DIR", "/app/data")
AUTOMATIONS_DIR = os.path.join(DATA_DIR, "automations")
RUNS_DIR = os.path.join(DATA_DIR, "automation_runs")


def _ensure_dirs():
    os.makedirs(AUTOMATIONS_DIR, exist_ok=True)
    os.makedirs(RUNS_DIR, exist_ok=True)


# ── Chain Definition Schema ────────────────────────────────
#
# {
#   "id": "uuid",
#   "name": "Troubleshoot Connectivity",
#   "description": "Run VS config, tcpdump, ARP, then analyze",
#   "tags": ["troubleshooting"],
#   "trigger": "manual" | "webhook" | "alert",
#   "steps": [ { "id", "skill_name", "label", "gate", "on_failure",
#                 "device_source", "device_param", "parameters", "parameter_map" } ],
#   "parameters": [ { "name", "label", "type", "required" } ]
# }


# ── CRUD ───────────────────────────────────────────────────

def list_automations() -> list[dict]:
    """List all automation chain definitions."""
    _ensure_dirs()
    automations = []
    for f in sorted(Path(AUTOMATIONS_DIR).glob("*.json")):
        try:
            data = json.loads(f.read_text())
            automations.append({
                "id": data["id"],
                "name": data["name"],
                "description": data.get("description", ""),
                "tags": data.get("tags", []),
                "trigger": data.get("trigger", "manual"),
                "step_count": len(data.get("steps", [])),
                "parameter_count": len(data.get("parameters", [])),
                "created_at": data.get("created_at"),
                "updated_at": data.get("updated_at"),
            })
        except Exception as e:
            logger.warning(f"Failed to parse automation {f}: {e}")
    return automations


def get_automation(automation_id: str) -> Optional[dict]:
    """Get full automation definition."""
    _ensure_dirs()
    path = Path(AUTOMATIONS_DIR) / f"{automation_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _normalize_steps(steps: list) -> list:
    """Assign step IDs and defaults."""
    for i, step in enumerate(steps):
        if not step.get("id"):
            step["id"] = f"step-{i+1}"
        step.setdefault("gate", "auto")
        step.setdefault("on_failure", "stop")
        step.setdefault("device_source", "parameter")
        step.setdefault("device_param", "device")
        step.setdefault("parameters", {})
        step.setdefault("parameter_map", {})
    return steps


def create_automation(data: dict) -> dict:
    """Create a new automation chain definition."""
    _ensure_dirs()
    auto_id = str(uuid.uuid4())[:8]
    now = datetime.now(timezone.utc).isoformat()

    automation = {
        "id": auto_id,
        "name": data.get("name", "Untitled"),
        "description": data.get("description", ""),
        "tags": data.get("tags", []),
        "trigger": data.get("trigger", "manual"),
        "steps": _normalize_steps(data.get("steps", [])),
        "parameters": data.get("parameters", []),
        "created_at": now,
        "updated_at": now,
    }

    path = Path(AUTOMATIONS_DIR) / f"{auto_id}.json"
    path.write_text(json.dumps(automation, indent=2))
    logger.info(f"Created automation '{automation['name']}' ({auto_id})")
    return automation


def update_automation(automation_id: str, data: dict) -> Optional[dict]:
    """Update an existing automation."""
    existing = get_automation(automation_id)
    if not existing:
        return None

    for key in ["name", "description", "tags", "trigger", "steps", "parameters"]:
        if key in data:
            existing[key] = data[key]

    existing["steps"] = _normalize_steps(existing.get("steps", []))
    existing["updated_at"] = datetime.now(timezone.utc).isoformat()

    path = Path(AUTOMATIONS_DIR) / f"{automation_id}.json"
    path.write_text(json.dumps(existing, indent=2))
    return existing


def delete_automation(automation_id: str) -> bool:
    """Delete an automation definition."""
    path = Path(AUTOMATIONS_DIR) / f"{automation_id}.json"
    if path.exists():
        path.unlink()
        return True
    return False


def duplicate_automation(automation_id: str) -> Optional[dict]:
    """Clone an automation with a new ID."""
    existing = get_automation(automation_id)
    if not existing:
        return None
    data = {**existing, "name": f"{existing['name']} (Copy)"}
    del data["id"]
    del data["created_at"]
    del data["updated_at"]
    return create_automation(data)


# ── Execution Run Storage ──────────────────────────────────

def _save_run(run: dict):
    _ensure_dirs()
    path = Path(RUNS_DIR) / f"{run['id']}.json"
    path.write_text(json.dumps(run, indent=2))


def list_runs(automation_id: Optional[str] = None, limit: int = 50) -> list[dict]:
    """List automation execution runs."""
    _ensure_dirs()
    runs = []
    for f in sorted(Path(RUNS_DIR).glob("*.json"), reverse=True):
        try:
            data = json.loads(f.read_text())
            if automation_id and data.get("automation_id") != automation_id:
                continue
            runs.append({
                "id": data["id"],
                "automation_id": data["automation_id"],
                "automation_name": data.get("automation_name", ""),
                "status": data["status"],
                "current_step": data.get("current_step", 0),
                "total_steps": data.get("total_steps", 0),
                "started_at": data.get("started_at"),
                "completed_at": data.get("completed_at"),
            })
            if len(runs) >= limit:
                break
        except Exception:
            continue
    return runs


def get_run(run_id: str) -> Optional[dict]:
    """Get full run details."""
    path = Path(RUNS_DIR) / f"{run_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


# ── Chain Execution (delegated to engine) ──────────────────
from .automation_engine import execute_chain, resume_chain_run  # noqa: E402, F401


# ── Template Automations ───────────────────────────────────

TEMPLATES = [
    {
        "name": "Troubleshoot Connectivity",
        "description": "Discover VS config, capture traffic, check ARP table, then analyze",
        "tags": ["troubleshooting", "network"],
        "trigger": "manual",
        "parameters": [
            {"name": "device", "label": "Target Device", "type": "device", "required": True},
            {"name": "virtual_server", "label": "Virtual Server", "type": "string", "required": True},
            {"name": "vip", "label": "VIP Address", "type": "string", "required": False},
        ],
        "steps": [
            {"skill_name": "bigip-vs-config", "label": "Discover VS Config",
             "parameters": {"virtual_server": "{{chain.virtual_server}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-tcpdump", "label": "Capture Traffic",
             "parameters": {"vip": "{{chain.vip}}", "duration": "10",
                            "interface": "0.0:nnnp", "max_packets": "100"},
             "gate": "auto", "on_failure": "skip"},
            {"skill_name": "bigip-arp-table", "label": "Check ARP Table",
             "parameters": {}, "gate": "auto", "on_failure": "skip"},
        ],
    },
    {
        "name": "Pool Member Maintenance",
        "description": "Check pool status, disable member, verify drain",
        "tags": ["maintenance", "pool"],
        "trigger": "manual",
        "parameters": [
            {"name": "device", "label": "Target Device", "type": "device", "required": True},
            {"name": "pool_name", "label": "Pool Name", "type": "string", "required": True},
            {"name": "member", "label": "Member to Disable", "type": "string", "required": True},
        ],
        "steps": [
            {"skill_name": "bigip-pool-status", "label": "Check Pool Health",
             "parameters": {"pool_name": "{{chain.pool_name}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-node-toggle", "label": "Disable Pool Member",
             "parameters": {"node_name": "{{chain.member}}", "action": "disable"},
             "gate": "approve", "on_failure": "stop"},
            {"skill_name": "bigip-connection-table", "label": "Monitor Drain",
             "parameters": {}, "gate": "auto", "on_failure": "skip"},
        ],
    },
    {
        "name": "ECMP Scale-Out",
        "description": "Provision VE, license, sync config, verify BGP, join fleet",
        "tags": ["autoscale", "bgp", "ecmp"],
        "trigger": "webhook",
        "parameters": [
            {"name": "device", "label": "Master BIG-IP", "type": "device", "required": True},
            {"name": "cluster_id", "label": "ECMP Cluster ID", "type": "string", "required": True},
        ],
        "steps": [
            {"skill_name": "bigip-ve-provision", "label": "Provision VE on Proxmox",
             "parameters": {"cluster_id": "{{chain.cluster_id}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-ve-license", "label": "License from Pool",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "mgmt_ip": "{{steps.step-1.output.mgmt_ip}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-config-sync", "label": "Sync Config + BGP",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "mgmt_ip": "{{steps.step-1.output.mgmt_ip}}",
                            "self_ip": "{{steps.step-1.output.self_ip}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-bgp-verify", "label": "Verify BGP Session",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "self_ip": "{{steps.step-1.output.self_ip}}",
                            "mgmt_ip": "{{steps.step-1.output.mgmt_ip}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-fleet-join", "label": "Join Fleet",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "mgmt_ip": "{{steps.step-1.output.mgmt_ip}}",
                            "hostname": "bigip-{{chain.cluster_id}}-{{steps.step-1.output.vmid}}"},
             "gate": "approve", "on_failure": "stop"},
        ],
    },
    {
        "name": "ECMP Scale-In",
        "description": "Withdraw BGP, drain connections, leave fleet, destroy VE",
        "tags": ["autoscale", "bgp", "ecmp"],
        "trigger": "webhook",
        "parameters": [
            {"name": "device", "label": "BIG-IP to Remove", "type": "device", "required": True},
            {"name": "cluster_id", "label": "ECMP Cluster ID", "type": "string", "required": True},
            {"name": "hostname", "label": "Device Hostname", "type": "string", "required": True},
            {"name": "vmid", "label": "Proxmox VMID", "type": "string", "required": True},
            {"name": "mgmt_ip", "label": "Management IP", "type": "string", "required": True},
            {"name": "self_ip", "label": "Self-IP", "type": "string", "required": True},
        ],
        "steps": [
            {"skill_name": "bigip-bgp-withdraw", "label": "Withdraw BGP Route",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "self_ip": "{{chain.self_ip}}"},
             "gate": "approve", "on_failure": "stop"},
            {"skill_name": "bigip-connection-drain", "label": "Drain Connections",
             "parameters": {"threshold": "10", "timeout_minutes": "10"},
             "gate": "auto", "on_failure": "skip"},
            {"skill_name": "bigip-ve-license-revoke", "label": "Revoke License",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "mgmt_ip": "{{chain.mgmt_ip}}"},
             "gate": "auto", "on_failure": "skip"},
            {"skill_name": "bigip-fleet-leave", "label": "Leave Fleet",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "hostname": "{{chain.hostname}}",
                            "mgmt_ip": "{{chain.mgmt_ip}}",
                            "self_ip": "{{chain.self_ip}}"},
             "gate": "auto", "on_failure": "stop"},
            {"skill_name": "bigip-ve-deprovision", "label": "Destroy VM",
             "parameters": {"cluster_id": "{{chain.cluster_id}}",
                            "vmid": "{{chain.vmid}}"},
             "gate": "approve", "on_failure": "stop"},
        ],
    },
]


def get_templates() -> list[dict]:
    """Return built-in automation templates."""
    return TEMPLATES
