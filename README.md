# F5 Insight — Skills-Based Troubleshooting Agent

A framework for building, managing, and executing diagnostic skills against F5 BIG-IP and NGINX devices. Skills follow the [Agent Skills](https://agentskills.io) open specification.

## Quick Start

```bash
# Clone and start
cd f5-insight-skills
cp .env.example .env

# Optional: add your Anthropic API key for AI analysis
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# Launch all 3 containers
docker compose up --build
```

Open **http://localhost:3000** in your browser.

## Architecture

| Container | Port | Purpose |
|-----------|------|---------|
| `insight-frontend` | 3000 | React UI — Skill Builder, Runner, Inventory, Device Manager |
| `insight-backend` | 8000 | FastAPI — Skill execution, device transport, vault integration |
| `insight-vault` | 8200 | OpenBao — Credential storage (auto-initialized, dev mode) |

## First-Run Walkthrough

1. **Add a device** — Go to Devices → Add Device. Enter hostname, management IP, credentials. Credentials are stored in OpenBao vault.
2. **Test connectivity** — Click "Test Connection" on your device card.
3. **Browse skills** — Go to Skills to see the 7 pre-built skills.
4. **Run a skill** — Click "Run Skill" on any skill, select your device, fill parameters, execute.
5. **Build a skill** — Go to Builder to create your own skill with the guided form.

## Pre-Built Skills

| Skill | Product | Description |
|-------|---------|-------------|
| `bigip-tcpdump` | BIG-IP | Packet capture with F5-specific analysis |
| `bigip-pool-status` | BIG-IP | Pool member health check |
| `bigip-virtual-server-create` | BIG-IP | Guided VS creation with rollback |
| `bigip-connection-table` | BIG-IP | Active connection analysis |
| `nginx-tcpdump` | NGINX | Packet capture on NGINX |
| `nginx-log-analysis` | NGINX | Error and access log analysis |
| `nginx-upstream-health` | NGINX | Upstream backend health check |

## Creating Custom Skills

### Via the UI (Skill Builder)
The Skill Builder provides a guided form with tooltips for every field. Fill in metadata, parameters, steps, safety settings, and optional AI analysis prompts.

### Via SKILL.md files
Drop a folder with a `SKILL.md` file into `backend/skills/`:

```
backend/skills/my-new-skill/
└── SKILL.md
```

The SKILL.md follows the Agent Skills spec with additional sections for steps, safety, and analysis. See any existing skill for the format.

## Credential Management

Credentials are stored in OpenBao (HashiCorp Vault compatible):
- **Dev mode**: Auto-initialized, auto-unsealed, in-memory. Zero setup.
- **Production**: Swap to file storage and proper unseal process.
- **API compatible**: Uses standard Vault KV v2 API at `secret/data/devices/{hostname}`

## AI Analysis (Optional)

Set `ANTHROPIC_API_KEY` in `.env` to enable LLM-powered analysis of skill output. Without it, skills still execute and show raw output — analysis is skipped gracefully.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Health check + vault status |
| GET/POST/DELETE | `/api/devices/` | Device CRUD |
| POST | `/api/devices/{hostname}/test` | Test device connectivity |
| GET/POST/DELETE | `/api/skills/` | Skill CRUD |
| GET | `/api/skills/{name}` | Get full skill definition |
| POST | `/api/execute/` | Execute a skill |
| GET | `/api/execute/history` | Execution audit log |

## Development

```bash
# Backend only
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload

# Frontend only
cd frontend
npm install
npm run dev
```
