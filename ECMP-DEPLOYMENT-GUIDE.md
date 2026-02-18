# ECMP Autoscale — Deployment Guide (v3)

## Quick Start

1. Extract tar, overlay files onto your F5 Insight project
2. `docker compose up -d --build backend`
3. Ensure template VM 198 has clean cloud-init cache and is templated
4. Ensure `genisoimage` is installed on Proxmox
5. Update license pool with regkeys
6. Run chain: `POST /api/automations/52c582a5/run`

## File Mapping

### Backend Services → `backend/app/services/`
- `executor.py` — target: replica/proxmox routing
- `transport.py` — SSH keyboard-interactive auth fallback
- `clusters.py` — IP pool, license pool, members
- `automation.py` — Scale-Out + Scale-In chain templates
- `automation_engine.py` — JSON output parsing for step param forwarding

### Router → `backend/app/routers/`
- `clusters.py` — License pool API endpoints

### Skills → `backend/skills/<name>/SKILL.md`
- `bigip-ve-provision` — Clone + ConfigDrive + boot
- `bigip-ve-license` — Regkey install from pool
- `bigip-ve-license-revoke` — Revoke before destroy
- `bigip-config-sync` — VLANs + self-IP + BGP (heredoc)
- `bigip-bgp-verify` — Verify BGP peering
- `bigip-fleet-join` — Register + telemetry

## Key Design Decisions

- **ConfigDrive** over DHCP: VM boots at static IP, no discovery needed
- **Heredoc** for imish: `-e` flags silently fail for multi-command BGP config
- **Full clone**: local-lvm doesn't support linked clones
- **mcpd wait loop**: cloud-init runs before tmsh is ready (~25s into boot)
- **License revoke on scale-in**: Prevents burning regkeys
