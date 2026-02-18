# F5 Insight Skills

A skill-based automation and troubleshooting platform for F5 BIG-IP and NGINX infrastructure. Combines a chat-driven agent, a visual workflow editor, ECMP autoscaling, and ITSM integration into a single Docker deployment.

## What It Does

**For network engineers**: Run diagnostic and configuration skills against F5 devices from a browser. Skills are defined as Markdown files with YAML blocks — no code to write. Chain skills into automation workflows with drag-and-drop, add approval gates, and trigger them from ServiceNow tickets or Prometheus alerts.

**For platform teams**: Provide self-service F5 operations with guardrails. Destructive actions require approval. All executions are logged. Credentials never leave the vault. The MCP server lets you plug F5 operations into any AI agent.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ Frontend  │  │ Backend  │  │ OpenBao  │  │  MCP   │ │
│  │ React     │→ │ FastAPI  │→ │ Vault    │  │ Server │ │
│  │ :3000     │  │ :8000    │  │ :8200    │  │ :8100  │ │
│  └──────────┘  └────┬─────┘  └──────────┘  └────────┘ │
│                     │                                    │
│  ┌──────────┐  ┌────┴─────┐                             │
│  │Prometheus│→ │Alertmgr  │  (ECMP autoscale alerting)  │
│  │ :9090    │  │ :9093    │                              │
│  └──────────┘  └──────────┘                             │
└─────────────────────────────────────────────────────────┘
         │ SSH / iControl REST
         ▼
   ┌──────────┐  ┌──────────┐
   │ BIG-IP   │  │ NGINX    │
   │ Devices  │  │ Devices  │
   └──────────┘  └──────────┘
```

| Container | Port | Role |
|-----------|------|------|
| `insight-frontend` | 3000 | React UI — 10-tab interface |
| `insight-backend` | 8000 | FastAPI — skill execution, automation engine, chat agent |
| `insight-vault` | 8200 | OpenBao — credential storage (auto-init, auto-unseal) |
| `insight-mcp` | 8100 | MCP server — exposes skills as tools for AI agents |
| `insight-prometheus` | 9090 | Metrics collection for autoscale alerting |
| `insight-alertmanager` | 9093 | Alert routing to webhook-triggered automations |

## Quick Start

```bash
git clone https://github.com/YOUR-ORG/f5-insight-skills.git
cd f5-insight-skills

# Configure
cp .env.sample .env
# Edit .env — set ANTHROPIC_API_KEY (or configure OpenAI/local LLM)

# Launch
docker compose up -d --build

# Open
open http://localhost:3000
```

Vault auto-initializes on first boot. No manual setup required.

## UI Tabs

| Tab | Purpose |
|-----|---------|
| **Chat** | Natural language interface — describe what you need, the agent picks the right skill |
| **Devices** | Add/edit BIG-IP and NGINX devices with SSH or key-based auth |
| **Images** | Stage and push BIG-IP ISO images to devices |
| **Topology** | Visual virtual server → pool → node topology discovery |
| **Skills** | Browse, inspect, and run the 29 built-in skills |
| **Builder** | Create new skills with a guided form |
| **Automation** | Build and run multi-step skill chains with templates |
| **Visual Editor** | Drag-and-drop workflow builder with branching and approval gates |
| **Integrations** | Incoming/outgoing webhooks and MCP client connections |
| **History** | Chat conversation history |

## Built-In Skills (29)

### Diagnostics (read-only)
`bigip-arp-table` · `bigip-bgp-verify` · `bigip-boot-locations` · `bigip-connection-drain` · `bigip-connection-table` · `bigip-persistence-records` · `bigip-pool-status` · `bigip-route-table` · `bigip-tcpdump` · `bigip-topology` · `bigip-vs-config` · `nginx-log-analysis` · `nginx-tcpdump` · `nginx-upstream-health`

### Configuration (approval required)
`bigip-bgp-withdraw` · `bigip-config-backup` · `bigip-config-sync` · `bigip-fleet-join` · `bigip-fleet-leave` · `bigip-irule-install` · `bigip-irule-remove` · `bigip-node-toggle` · `bigip-upgrade` · `bigip-ve-deprovision` · `bigip-ve-license` · `bigip-ve-license-revoke` · `bigip-ve-provision` · `bigip-virtual-server-create` · `bigip-vs-toggle`

## Automation Templates

Four built-in chain templates for common workflows:

| Template | Steps | Use Case |
|----------|-------|----------|
| **Troubleshoot Connectivity** | vs-config → tcpdump → arp-table | Debug traffic flow through a virtual server |
| **Pool Member Maintenance** | pool-status → node-toggle (⏸ approval) → connection-table | Safely disable a pool member |
| **ECMP Scale-Out** | ve-provision → ve-license → config-sync → bgp-verify → fleet-join (⏸ approval) | Add a BIG-IP VE to the ECMP cluster |
| **ECMP Scale-In** | bgp-withdraw (⏸ approval) → connection-drain → ve-license-revoke → fleet-leave → ve-deprovision (⏸ approval) | Gracefully remove a BIG-IP VE |

## LLM Support

Configure one provider in `.env`:

| Provider | Variables | Notes |
|----------|-----------|-------|
| **Anthropic** (default) | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | Claude powers chat agent and skill analysis |
| **OpenAI** | `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL` | GPT-4o or compatible |
| **Local** | `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_MODEL` | Any OpenAI-compatible endpoint (Ollama, vLLM, llama.cpp) |

Without an API key, skills still execute — AI analysis and chat are skipped gracefully.

## MCP Server

The MCP server at `http://localhost:8100/mcp` exposes all skills as tools via the Model Context Protocol. Connect any MCP-compatible client (Claude Desktop, Claude Code, custom agents) to manage F5 infrastructure through natural language.

## ServiceNow Mock

A separate ServiceNow-accurate mock is included in `snow/` for demonstrating end-to-end ITSM integration. See `snow/README.md` for setup.

## Documentation

| Document | Description |
|----------|-------------|
| [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) | Prerequisites, installation, configuration, production hardening |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data flow, file structure, extension points |
| [SKILL-AUTHORING.md](SKILL-AUTHORING.md) | How to write custom skills with the SKILL.md format |
| [API-REFERENCE.md](API-REFERENCE.md) | Complete REST API documentation |

## License

Proprietary — internal use only.
