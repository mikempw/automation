# Architecture

## System Design

F5 Insight Skills is built around three core concepts: **skills** (atomic operations), **automations** (skill chains), and **integrations** (external triggers). Everything runs in Docker containers communicating over an internal bridge network.

### Request Flow

```
User / Webhook / Alert
        │
        ▼
   ┌─────────┐     ┌──────────┐     ┌──────────┐
   │ Frontend │────→│ Backend  │────→│ OpenBao  │
   │ (Nginx)  │     │ (FastAPI)│     │ (Vault)  │
   └─────────┘     └────┬─────┘     └──────────┘
                        │
           ┌────────────┼────────────┐
           ▼            ▼            ▼
       SSH (22)   iControl REST  Proxmox API
           │            │            │
      ┌────┴────┐  ┌────┴────┐  ┌────┴────┐
      │ BIG-IP  │  │ BIG-IP  │  │ Proxmox │
      │  tmsh   │  │  REST   │  │   VE    │
      └─────────┘  └─────────┘  └─────────┘
```

### Execution Pipeline

1. **Skill resolution**: Backend loads `SKILL.md`, parses YAML blocks for parameters, steps, safety, and analysis config
2. **Credential fetch**: Retrieves device credentials from OpenBao vault via KV v2 API
3. **Parameter resolution**: Replaces `{{param}}` placeholders in command templates with user-supplied or chain-forwarded values
4. **Transport dispatch**: Routes each step to the appropriate transport — SSH, iControl REST bash, iControl REST API, or Proxmox API
5. **Target override**: Steps with `target: replica` route SSH to the `mgmt_ip` parameter instead of the registered device (used for newly provisioned VEs)
6. **Streaming output**: Results stream back to the UI via Server-Sent Events (SSE) in real time
7. **AI analysis**: If enabled, the combined step output is sent to the configured LLM with the skill's analysis prompt template
8. **History persistence**: Execution results are saved as JSON files to `data/history/`

### Automation Engine

Automation chains execute skills sequentially with parameter forwarding between steps:

```
Chain Start
    │
    ▼
┌──────────┐   {{chain.device}}   ┌──────────┐   {{steps.step-1.output.mgmt_ip}}
│  Step 1   │────────────────────→│  Step 2   │────────────────────────────────→ ...
│ provision │                      │  license  │
└──────────┘                      └──────────┘
    │
    ▼ (on approval gate)
  ⏸ Pause → webhook/UI approve → Resume
```

Template variables:
- `{{chain.param}}` — Chain-level parameters (e.g., device, cluster_id)
- `{{steps.step-id.output.field}}` — Output from a previous step (JSON parsed)
- `{{cluster_param}}` — Flattened cluster configuration (Proxmox, BGP, license pool)

## File Structure

```
f5-insight-skills/
├── .env.sample                    # Environment template
├── docker-compose.yml             # All 6 containers
├── mcp_server.py                  # Standalone MCP server entrypoint
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py                # FastAPI app + router registration
│   │   ├── models/
│   │   │   └── __init__.py        # Pydantic models (Device, Skill, Execution, etc.)
│   │   ├── routers/
│   │   │   ├── __init__.py        # Re-export hub
│   │   │   ├── automation.py      # Automation chain CRUD + execution
│   │   │   ├── chat.py            # Chat agent + conversation history
│   │   │   ├── clusters.py        # ECMP cluster management
│   │   │   ├── devices.py         # Device CRUD + connectivity test
│   │   │   ├── infra.py           # Health, images, topology
│   │   │   ├── integrations_routes.py  # Webhooks + MCP client endpoints
│   │   │   └── skills.py          # Skill CRUD + execution endpoints
│   │   └── services/
│   │       ├── analysis.py        # Multi-provider LLM analysis
│   │       ├── automation.py      # Chain definitions + templates
│   │       ├── automation_engine.py  # Chain execution + template resolution
│   │       ├── chat.py            # LLM chat agent with tool use
│   │       ├── chat_history.py    # Conversation persistence
│   │       ├── clusters.py        # ECMP cluster + IP pool + license pool
│   │       ├── executor.py        # Skill execution engine (sync + streaming)
│   │       ├── images.py          # ISO staging + device push
│   │       ├── integrations.py    # Webhook CRUD + processing
│   │       ├── mcp_client.py      # MCP client connections + tool discovery
│   │       ├── skill_store.py     # SKILL.md parsing + CRUD
│   │       ├── topology.py        # VS → pool → node discovery
│   │       ├── transport.py       # SSH, iControl REST, Proxmox transports
│   │       └── vault.py           # OpenBao KV v2 client
│   ├── data/                      # Runtime data (gitignored)
│   │   ├── automations/           # Saved automation chain definitions
│   │   ├── automation_runs/       # Execution run state
│   │   ├── conversations/         # Chat history
│   │   └── history/               # Skill execution results
│   ├── images/                    # Staged BIG-IP ISOs
│   └── skills/                    # 29 built-in skill directories
│       ├── bigip-arp-table/SKILL.md
│       ├── bigip-bgp-verify/SKILL.md
│       └── ... (29 total)
│
├── frontend/
│   ├── Dockerfile                 # Multi-stage: Node build → Nginx
│   ├── nginx.conf                 # API proxy + SSE support
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx               # React entrypoint
│       ├── App.jsx                # Main app — all 10 tabs
│       ├── api.js                 # Backend API client
│       ├── styles.js              # Shared design tokens
│       ├── AutomationTab.jsx      # Chain builder + runner
│       ├── VisualWorkflowEditor.jsx  # Drag-and-drop SVG workflow editor
│       └── TrafficFlowVisualizer.jsx # Topology visualization
│
├── openbao/
│   ├── config/config.hcl          # Vault server configuration
│   └── scripts/init-vault.sh      # Auto-init + auto-unseal sidecar
│
├── prometheus/
│   ├── prometheus.yml             # Scrape config
│   └── alert_rules.yml            # ECMP autoscale alert rules
│
├── alertmanager/
│   └── alertmanager.yml           # Alert routing to Insight webhooks
│
├── scripts/
│   ├── template-cleanup.sh        # Proxmox VM template prep
│   └── update-cluster-config.sh   # Cluster config updater
│
└── snow/                          # ServiceNow mock (separate compose)
    ├── README.md
    ├── docker-compose.yml
    ├── backend/                   # Flask API
    └── frontend/                  # ServiceNow Polaris UI clone
```

## Transport Layer

The executor dispatches each skill step to one of four transports:

| Transport | Protocol | Use Case |
|-----------|----------|----------|
| `ssh` | SSH (paramiko) | tmsh commands, imish, shell scripts, tcpdump |
| `icontrol_bash` | REST → `/mgmt/tm/util/bash` | Run bash on BIG-IP via REST (no SSH needed) |
| `icontrol_rest` | REST → `/mgmt/tm/*` | Declarative BIG-IP configuration via REST API |
| `proxmox` | REST → Proxmox API | VM clone, start, stop, delete for BIG-IP VE lifecycle |

SSH supports both password and key-based authentication, with keyboard-interactive fallback for BIG-IP devices that require it.

## Data Storage

| Data | Storage | Persistence |
|------|---------|-------------|
| Device credentials | OpenBao vault (KV v2) | Docker volume `vault-data` |
| Skill definitions | Filesystem (`backend/skills/`) | Bind mount (version-controlled) |
| Execution history | JSON files (`backend/data/history/`) | Bind mount |
| Automation chains | JSON files (`backend/data/automations/`) | Bind mount |
| Automation runs | JSON files (`backend/data/automation_runs/`) | Bind mount |
| Chat conversations | JSON files (`backend/data/conversations/`) | Bind mount |
| Integrations + MCP | SQLite (`backend/data/integrations.db`) | Bind mount |
| Prometheus metrics | Docker volume `prometheus-data` | 7-day retention |

## Integration Points

### Incoming

- **Webhooks**: External systems (ServiceNow, PagerDuty, custom) POST to `/api/integrations/webhook/{token}`. Payload mapping extracts fields, then either triggers an automation chain directly or feeds the ticket to the chat agent for skill selection.
- **Prometheus Alerts**: Alertmanager POSTs fired alerts to the webhook endpoint, triggering ECMP Scale-Out or Scale-In chains based on CPU thresholds.

### Outgoing

- **Callback URLs**: After processing an incoming webhook, results are POSTed back to a configurable callback URL (e.g., ServiceNow work notes API).
- **Outgoing Webhooks**: Skill completion/failure events fire to registered outgoing webhook endpoints.
- **MCP Tools**: Any MCP-compatible client can discover and invoke skills at `http://host:8100/mcp`.

### MCP Client

Insight can also act as an MCP **client**, connecting to external MCP servers to discover and invoke their tools. This is configured in the Integrations tab and allows the chat agent to use tools from other systems alongside built-in skills.

## Security Model

- **Credentials**: Stored in OpenBao vault, never exposed in API responses (only `has_password: true/false` flags)
- **Approval gates**: Destructive skills and automation steps can require explicit approval before execution
- **Execution logging**: Every skill run is persisted with full input/output for audit
- **Transport isolation**: Backend container has SSH access to devices; frontend only talks to backend API via Nginx proxy
- **No auth by default**: Production deployments should add authentication at the reverse proxy layer (see Deployment Guide)
