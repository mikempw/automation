# Deployment Guide

## Prerequisites

| Requirement | Minimum | Notes |
|-------------|---------|-------|
| Docker Engine | 24.0+ | `docker compose` (v2) required — not `docker-compose` (v1) |
| RAM | 4 GB | 2 GB for containers + headroom for SSH sessions |
| Disk | 10 GB | More if staging BIG-IP ISO images |
| Network | Outbound HTTPS | For LLM API calls (Anthropic/OpenAI) |
| Network | SSH to devices | Backend must reach BIG-IP/NGINX management IPs on port 22 |

### Optional for ECMP Autoscale

| Requirement | Notes |
|-------------|-------|
| Proxmox VE 8.x | For BIG-IP VE provisioning/deprovisioning |
| FRR router | For BGP ECMP path management |
| BIG-IP VE template | VM template with cloud-init support (template ID in cluster config) |
| BIG-IP license pool | Registration keys for auto-licensing |

## Installation

### 1. Clone and Configure

```bash
git clone https://github.com/YOUR-ORG/f5-insight-skills.git
cd f5-insight-skills
cp .env.sample .env
```

Edit `.env` and set your LLM provider. Only one is required:

```bash
# Option A: Anthropic (recommended)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-api03-your-key-here

# Option B: OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-key-here

# Option C: Local LLM (Ollama, vLLM, etc.)
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://host.docker.internal:11434/v1
LOCAL_LLM_MODEL=llama3:70b
```

### 2. Build and Launch

```bash
docker compose up -d --build
```

First launch takes 2-3 minutes. The `vault-init` sidecar automatically initializes and unseals OpenBao, enables the KV v2 secrets engine, and shares the root token with the backend via a Docker volume. No manual vault setup is needed.

### 3. Verify

```bash
# Check all containers are running
docker compose ps

# Check backend health
curl http://localhost:8000/api/health
```

Expected health response:

```json
{
  "status": "ok",
  "vault": "connected",
  "llm_provider": "anthropic",
  "llm_model": "claude-sonnet-4-20250514",
  "llm_configured": true
}
```

### 4. Open the UI

Navigate to **http://localhost:3000** in your browser.

## First-Run Walkthrough

### Add a Device

Go to **Devices** → **+ Add Device**:

- **Hostname**: Unique identifier (e.g., `bigip01.lab.local`)
- **Management IP**: Reachable from the Docker host
- **Device Type**: `bigip` or `nginx`
- **Auth Method**: Password or SSH key
- **SSH Credentials**: Username + password or private key
- **REST Credentials** (optional): For iControl REST transport on BIG-IP

Click **Test Connection** to verify SSH connectivity. Credentials are stored encrypted in OpenBao vault at `secret/data/devices/{hostname}`.

### Run a Skill

Go to **Skills** → pick any skill (e.g., `bigip-pool-status`) → **Run**:

1. Select your device from the dropdown
2. Fill in required parameters
3. Click **Execute**
4. Watch real-time streaming output via SSE
5. If an LLM is configured, AI analysis appears after execution

### Build a Workflow

Go to **Visual Editor** → **+ New Workflow**:

1. Drag skill nodes from the palette onto the canvas
2. Connect output ports to input ports
3. Add branch nodes for conditional logic
4. Set approval gates on destructive steps
5. Configure parameter forwarding between steps (e.g., `{{steps.step-1.output.mgmt_ip}}`)
6. Save and run from the **Automation** tab

## Container Details

### Frontend (insight-frontend)

The React app is built at image time and served by Nginx. The Nginx config proxies `/api/*` requests to the backend container, with SSE-compatible settings (no buffering, long timeouts).

**Port mapping**: Host `:3000` → Container `:80`

### Backend (insight-backend)

FastAPI with uvicorn, running with `--reload` for development. Connects to BIG-IP/NGINX devices via SSH (paramiko) and iControl REST (httpx). Stores execution history and automation state in JSON files under `/app/data`.

**Port mapping**: Host `:8000` → Container `:8000`

**Volumes**:
- `./backend/skills:/app/skills` — Skill definitions (SKILL.md files)
- `./backend/data:/app/data` — Execution history, automation runs, integrations DB
- `./backend/images:/app/images` — Staged BIG-IP ISO images
- `vault-init:/vault-init:ro` — Root token from vault init sidecar

### Vault (insight-vault)

OpenBao 2.1.0 with file-based storage. The `vault-init` sidecar runs once on first boot to initialize with a single unseal key, unseal the vault, and enable the KV v2 secrets engine. On subsequent restarts, it just unseals.

**Port mapping**: Host `:8200` → Container `:8200`

**Volumes**:
- `vault-data` — Persistent encrypted storage
- `vault-init` — Shared init keys/token (sidecar → backend)

### MCP Server (insight-mcp)

Standalone MCP server using the same backend image but with a different entrypoint. Exposes all skills as MCP tools via streamable-http transport at `/mcp`.

**Port mapping**: Host `:8100` → Container `:8100`

### Prometheus + Alertmanager

Pre-configured for ECMP autoscale alerting. Prometheus scrapes metrics and evaluates alert rules. Alertmanager routes fired alerts to Insight's webhook endpoint, triggering Scale-Out or Scale-In automation chains.

**Port mappings**: `:9090` (Prometheus), `:9093` (Alertmanager)

## ServiceNow Mock Setup

The `snow/` directory contains a ServiceNow-accurate mock for demonstrating webhook integration.

```bash
cp snow/.env.sample snow/.env
# Edit snow/.env — set ANTHROPIC_API_KEY and INSIGHT_WEBHOOK_URL
cd snow && docker compose up -d --build
```

Then in the Insight UI, create an incoming webhook integration and copy the token into `snow/.env`. See `snow/README.md` for the full demo flow.

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `anthropic` | LLM backend: `anthropic`, `openai`, or `local` |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-20250514` | Claude model for chat and analysis |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_MODEL` | `gpt-4o` | OpenAI model |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `LOCAL_LLM_BASE_URL` | `http://host.docker.internal:11434/v1` | Local LLM endpoint |
| `LOCAL_LLM_MODEL` | `gpt-oss:20b` | Local model name |
| `LOCAL_LLM_API_KEY` | `not-needed` | API key for local endpoint (if required) |

### Internal Variables (set in docker-compose.yml)

| Variable | Value | Description |
|----------|-------|-------------|
| `VAULT_ADDR` | `http://openbao:8200` | Vault address (internal Docker network) |
| `VAULT_TOKEN_FILE` | `/vault-init/root-token` | Path to auto-generated root token |
| `SKILLS_DIR` | `/app/skills` | Skill definitions mount point |
| `DATA_DIR` | `/app/data` | Persistent data directory |
| `IMAGES_DIR` | `/app/images` | BIG-IP ISO staging directory |

## Production Hardening

### Vault

The default deployment uses a single unseal key with file storage. For production:

1. **Increase key shares**: Edit `init-vault.sh` to use `secret_shares: 5, secret_threshold: 3`
2. **External storage**: Switch from file to Consul, PostgreSQL, or Raft in `openbao/config/config.hcl`
3. **TLS**: Set `tls_disable = false` in `config.hcl` and mount certificates
4. **Access policy**: Create scoped policies instead of using the root token

### Network

1. **Remove port bindings**: In production, remove `ports:` entries for vault (8200) and backend (8000) — let the frontend Nginx proxy handle external access
2. **TLS termination**: Place a reverse proxy (Nginx, Traefik, HAProxy) in front of port 3000 with TLS certificates
3. **Firewall**: Only expose port 443 (TLS proxy) externally. Backend, vault, MCP, Prometheus, and Alertmanager should only be accessible on the Docker network or from trusted management hosts

### Authentication

The current deployment has no user authentication. For production, add one of:
- **Reverse proxy auth**: Use Nginx basic auth, OAuth2 Proxy, or your SSO provider in front of port 3000
- **API gateway**: Place Kong, Traefik, or AWS ALB with OIDC in front of the stack

### Data Persistence

All persistent data lives in Docker volumes and bind mounts:
- `vault-data` — Credential storage (back up regularly)
- `./backend/data` — Execution history, automation runs, integrations SQLite DB
- `./backend/skills` — Skill definitions (version control these)
- `prometheus-data` — Metrics (expendable, rebuilds from scrape targets)

### Backup

```bash
# Stop containers
docker compose stop

# Back up vault data
docker run --rm -v insight-vault-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/vault-backup-$(date +%Y%m%d).tar.gz /data

# Back up application data
tar czf app-data-backup-$(date +%Y%m%d).tar.gz backend/data backend/skills

# Restart
docker compose start
```

## Troubleshooting

### Vault won't unseal

```bash
# Check vault-init logs
docker logs insight-vault-init

# If init volume is corrupted, reset:
docker volume rm insight-vault-init insight-vault-data
docker compose up -d
```

### Backend can't reach devices

```bash
# Test from inside the container
docker exec -it insight-backend ssh admin@192.168.1.20

# Check extra_hosts resolves
docker exec -it insight-backend ping host.docker.internal
```

### LLM analysis not working

```bash
# Verify API key is set
docker exec insight-backend env | grep -i api_key

# Check health endpoint
curl http://localhost:8000/api/health | jq .llm_configured
```

### Frontend shows blank page

```bash
# Check frontend build succeeded
docker logs insight-frontend

# Verify Nginx proxy is routing API calls
curl -I http://localhost:3000/api/health
```

## Updating

```bash
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

Vault data and application data persist across rebuilds. Skill definitions in `backend/skills/` are bind-mounted, so changes are immediate (no rebuild needed).
