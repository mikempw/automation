# Changelog

## v0.2.0 — 2026-02-18

### Features
- **Visual Workflow Editor**: Drag-and-drop SVG-based workflow builder with branching, approval gates, undo/redo, auto-layout, and save/load
- **Automation Engine**: Multi-step skill chains with template resolution, parameter forwarding between steps (`{{steps.step-id.output.field}}`), and approval gates
- **ECMP Autoscale**: BIG-IP VE provisioning/deprovisioning on Proxmox with BGP ECMP route management, IP pool allocation, and license pool tracking
- **Prometheus + Alertmanager**: CPU-based autoscale alerting with alert routing to automation chains via webhooks
- **MCP Server**: Exposes all skills as Model Context Protocol tools at `/mcp` for AI agent integration
- **MCP Client**: Connect to external MCP servers, discover tools, invoke them from the Integrations tab
- **ServiceNow Mock**: Full ITSM incident dashboard with LLM-powered ticket creation and bi-directional webhook integration
- **Chat Streaming**: SSE-based real-time execution output in the chat interface
- **Multi-LLM Support**: Anthropic, OpenAI, and local LLM (Ollama/vLLM/llama.cpp) providers

### Skills Added (22 new, 29 total)
- ECMP lifecycle: `bigip-ve-provision`, `bigip-ve-license`, `bigip-ve-license-revoke`, `bigip-ve-deprovision`, `bigip-config-sync`, `bigip-bgp-verify`, `bigip-bgp-withdraw`, `bigip-fleet-join`, `bigip-fleet-leave`, `bigip-connection-drain`
- Operations: `bigip-arp-table`, `bigip-boot-locations`, `bigip-config-backup`, `bigip-irule-install`, `bigip-irule-remove`, `bigip-node-toggle`, `bigip-persistence-records`, `bigip-route-table`, `bigip-topology`, `bigip-upgrade`, `bigip-vs-config`, `bigip-vs-toggle`

### Architecture
- Routers split from monolithic `__init__.py` (614 lines) into 7 focused modules
- Executor split into `executor.py`, `skill_store.py`, and `analysis.py`
- Integrations split into `integrations.py` and `mcp_client.py`
- Fixed FastAPI route ordering bug (`/runs/all` unreachable behind `/{auto_id}`)
- Removed orphaned `VisualWorkflowComponents.jsx`

## v0.1.0 — Initial Release

### Features
- Skill execution engine with SSH and iControl REST transports
- 7 built-in skills (pool-status, tcpdump, virtual-server-create, connection-table, nginx-tcpdump, nginx-log-analysis, nginx-upstream-health)
- Device management with OpenBao vault credential storage
- Skill builder UI
- Chat agent for natural language skill selection
- Execution history and audit logging
