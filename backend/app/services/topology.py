"""Topology service — runs bigip-topology skill and returns structured data for the visualizer."""
import json
import logging
import re

from .executor import execute_skill
from ..models import ExecutionRequest

logger = logging.getLogger(__name__)


async def get_vs_topology(device_hostname: str, virtual_server: str) -> dict:
    """Run bigip-topology skill and parse LLM analysis into structured topology data.
    
    The skill collects VS config, pool, iRule source, stats, and cross-references.
    The LLM analysis prompt produces structured JSON with iRule traffic impact analysis.
    """
    try:
        req = ExecutionRequest(
            skill_name="bigip-topology",
            device_hostname=device_hostname,
            parameters={"virtual_server": virtual_server},
        )
        result = await execute_skill(req)
    except Exception as e:
        logger.error(f"Topology skill execution failed: {e}")
        return {"success": False, "error": str(e)}

    if result.status not in ("complete", "analyzing"):
        error_msg = result.error or "Skill execution failed"
        for step in result.steps:
            if step.status != "complete":
                error_msg = f"Step '{step.step_name}' failed: {step.error or step.output or 'unknown'}"
                break
        return {"success": False, "error": error_msg}

    # ── Try to parse LLM analysis as JSON topology ────────
    if result.analysis:
        topology = _parse_analysis_json(result.analysis)
        if topology:
            topology["success"] = True
            return topology

    # ── Fallback: parse raw step outputs manually ─────────
    logger.warning("LLM analysis didn't produce valid JSON, falling back to raw parsing")
    raw_outputs = {}
    for step in result.steps:
        raw_outputs[step.step_name] = step.output or ""

    topology = _parse_raw_outputs(raw_outputs, virtual_server)
    topology["success"] = True
    return topology


def _parse_analysis_json(analysis_text: str) -> dict | None:
    """Try to extract JSON from the LLM analysis response."""
    if not analysis_text:
        return None

    text = analysis_text.strip()
    text = re.sub(r'^```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```$', '', text)
    text = text.strip()

    try:
        data = json.loads(text)
        if isinstance(data, dict) and "virtualServer" in data:
            if "irules" not in data:
                data["irules"] = []
            if "otherAttachments" not in data:
                data["otherAttachments"] = {}
            if "pool" not in data:
                data["pool"] = {"name": "", "lbMethod": "round-robin", "monitor": "", "status": "unknown", "members": []}
            return data
    except json.JSONDecodeError as e:
        logger.warning(f"Failed to parse analysis JSON: {e}")

    # Try to find JSON object within the text
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, dict) and "virtualServer" in data:
                return data
        except json.JSONDecodeError:
            pass

    return None


def _parse_raw_outputs(outputs: dict, virtual_server: str) -> dict:
    """Fallback parser for raw tmsh output when LLM analysis fails."""
    vs_text = outputs.get("vs_overview", "")
    pool_text = outputs.get("pool_detail", "")
    stats_text = outputs.get("vs_stats", "")
    irule_text = outputs.get("irule_source", "")
    xref_text = outputs.get("cross_references", "")

    vs_data = _parse_vs(vs_text, virtual_server)
    pool_data = _parse_pool(pool_text)
    stats = _parse_stats(stats_text)
    irules = _parse_irules(irule_text)
    xrefs = _parse_xrefs(xref_text, pool_data.get("name", ""), virtual_server)

    vs_data.update(stats)

    return {
        "virtualServer": vs_data,
        "pool": pool_data,
        "irules": irules,
        "otherAttachments": xrefs,
    }


def _parse_vs(text: str, default_name: str) -> dict:
    data = {"name": default_name, "destination": "", "ip": "", "port": 0,
            "protocol": "tcp", "status": "unknown", "statusReason": "",
            "profiles": [], "snat": "none", "persistence": "",
            "connections": 0, "bitsIn": 0, "bitsOut": 0}

    m = re.search(r'ltm virtual (\S+)', text)
    if m:
        data["name"] = m.group(1).split("/")[-1]

    m = re.search(r'destination\s+(\S+)', text)
    if m:
        dest = m.group(1).split("/")[-1]
        data["destination"] = dest
        parts = dest.rsplit(":", 1)
        data["ip"] = parts[0]
        data["port"] = _port(parts[1]) if len(parts) > 1 else 0

    m = re.search(r'ip-protocol\s+(\S+)', text)
    if m:
        data["protocol"] = m.group(1)

    prof_block = re.search(r'profiles\s*\{(.*?)\n\s*\}', text, re.DOTALL)
    if prof_block:
        data["profiles"] = [p.group(1).split("/")[-1] for p in re.finditer(r'(\S+)\s*\{', prof_block.group(1))]

    m = re.search(r'source-address-translation\s*\{[^}]*type\s+(\S+)', text, re.DOTALL)
    if m:
        data["snat"] = m.group(1)

    m = re.search(r'persist\s*\{[^}]*(\S+)\s*\{', text, re.DOTALL)
    if m:
        data["persistence"] = m.group(1).split("/")[-1]

    return data


def _parse_pool(text: str) -> dict:
    data = {"name": "", "lbMethod": "round-robin", "monitor": "default", "status": "unknown", "members": []}

    m = re.search(r'POOL_NAME=(\S+)', text)
    if m:
        data["name"] = m.group(1).split("/")[-1]
    else:
        m = re.search(r'ltm pool (\S+)', text)
        if m:
            data["name"] = m.group(1).split("/")[-1]

    m = re.search(r'load-balancing-mode\s+(\S+)', text)
    if m:
        data["lbMethod"] = m.group(1)

    m = re.search(r'monitor\s+(\S+)', text)
    if m:
        data["monitor"] = m.group(1).split("/")[-1]

    member_blocks = re.finditer(r'(\d+\.\d+\.\d+\.\d+):(\S+)\s*\{(.*?)\n\s{8}\}', text, re.DOTALL)
    members = []
    for i, mb in enumerate(member_blocks):
        addr, port_str, block = mb.group(1), mb.group(2), mb.group(3)
        member = {"address": addr, "port": _port(port_str), "name": f"node-{i+1:02d}",
                  "status": "unknown", "connections": 0, "priority": 0, "ratio": 1}
        pm = re.search(r'priority-group\s+(\d+)', block)
        if pm: member["priority"] = int(pm.group(1))
        pm = re.search(r'ratio\s+(\d+)', block)
        if pm: member["ratio"] = int(pm.group(1))
        pm = re.search(r'state\s+(\S+)', block)
        if pm:
            s = pm.group(1)
            member["status"] = "available" if s == "up" else "forced-offline" if s in ("user-down",) else "offline"
        pm = re.search(r'session\s+(\S+)', block)
        if pm and pm.group(1) == "user-disabled":
            member["status"] = "forced-offline"
        members.append(member)

    if "---STATUS---" in text:
        status_part = text.split("---STATUS---", 1)[1]
        for member in members:
            pattern = rf'{re.escape(member["address"])}:{member["port"]}.*?Availability\s*:\s*(\S+)'
            sm = re.search(pattern, status_part, re.DOTALL)
            if sm:
                member["status"] = "available" if sm.group(1).lower() == "available" else "offline"

    data["members"] = members

    m = re.search(r'Availability\s*:\s*(\S+)', text.split("---STATUS---", 1)[-1] if "---STATUS---" in text else text)
    if m:
        data["status"] = "available" if m.group(1).lower() == "available" else "offline"

    return data


def _parse_stats(text: str) -> dict:
    data = {}
    m = re.search(r'Availability\s*:\s*(\S+)', text)
    if m:
        data["status"] = "available" if m.group(1).lower() == "available" else "offline"
    m = re.search(r'Reason\s*:\s*(.+?)$', text, re.MULTILINE)
    if m:
        data["statusReason"] = m.group(1).strip()
    m = re.search(r'Current Connections\s+(\d+)', text)
    if m:
        data["connections"] = int(m.group(1))
    m = re.search(r'Bits In\s+(\d+)', text)
    if m:
        data["bitsIn"] = int(m.group(1))
    m = re.search(r'Bits Out\s+(\d+)', text)
    if m:
        data["bitsOut"] = int(m.group(1))
    return data


def _parse_irules(text: str) -> list:
    """Parse iRule source code blocks — basic structure without LLM analysis."""
    if "NO_IRULES" in text:
        return []
    irules = []
    blocks = text.split("===IRULE:")
    for block in blocks[1:] if len(blocks) > 1 else []:
        name_end = block.find("===")
        if name_end < 0:
            continue
        name = block[:name_end].strip().split("/")[-1]
        rest = block[name_end + 3:]
        end_marker = rest.find("===END===")
        code_block = rest[:end_marker].strip() if end_marker > 0 else rest.strip()

        code = ""
        cm = re.search(r'ltm rule \S+ \{(.*)\}', code_block, re.DOTALL)
        if cm:
            code = cm.group(1).strip()
        else:
            code = code_block

        events_found = re.findall(r'when\s+(\w+)', code)
        events = []
        for ev in events_found:
            events.append({
                "event": ev,
                "description": f"{ev} handler",
                "conditions": [],
                "unconditionalActions": [],
                "canBlock": "respond" in code.lower() or "reject" in code.lower(),
                "canRedirect": "redirect" in code.lower(),
                "canSelectPool": "pool " in code.lower(),
                "packetModifications": [],
            })

        irules.append({"name": name, "code": code, "events": events})

    return irules


def _parse_xrefs(text: str, current_pool: str, current_vs: str) -> dict:
    xrefs = {}
    if "NO_POOL" in text:
        return xrefs

    current_pool_clean = current_pool.split("/")[-1]
    current_vs_clean = current_vs.split("/")[-1]

    vs_pool_map = {}
    all_vs_section = text.split("===ALL_VS_POOLS===")[-1] if "===ALL_VS_POOLS===" in text else ""
    for line in all_vs_section.split("\n"):
        vm = re.match(r'ltm virtual (\S+)', line)
        if vm:
            vs_name = vm.group(1).split("/")[-1]
            pm = re.search(r'pool (\S+)', line)
            if pm:
                vs_pool_map[pm.group(1).split("/")[-1]] = vs_name

    node_blocks = text.split("===NODE:")
    for block in node_blocks[1:] if len(node_blocks) > 1 else []:
        addr_end = block.find("===")
        if addr_end < 0:
            continue
        addr = block[:addr_end].strip()
        rest = block[addr_end + 3:]
        section_end = rest.find("===")
        pool_section = rest[:section_end] if section_end > 0 else rest
        pools = [p.strip().split("/")[-1] for p in pool_section.strip().split("\n") if p.strip()]

        refs = []
        for pool_name in pools:
            if pool_name == current_pool_clean:
                continue
            vs_name = vs_pool_map.get(pool_name, "")
            if vs_name and vs_name != current_vs_clean:
                refs.append({"vs": vs_name, "pool": pool_name})

        if refs:
            for port in [80, 443, 8080, 8443]:
                xrefs[f"{addr}:{port}"] = refs

    return xrefs


def _port(s: str) -> int:
    PORT_MAP = {"http": 80, "https": 443, "ssh": 22, "dns": 53, "ftp": 21, "smtp": 25, "any": 0}
    try:
        return int(s)
    except ValueError:
        return PORT_MAP.get(s.lower(), 0)
