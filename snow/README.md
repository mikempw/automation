# ServiceNow Mock — ITSM Incident Management

A ServiceNow-accurate mock for demonstrating F5 Insight webhook integration. Features LLM-powered natural language ticket creation, incident dashboard, and bi-directional communication with F5 Insight.

## Features

- **ServiceNow Polaris UI** — Accurate recreation of ServiceNow's Next Experience theme
- **LLM Ticket Creation** — Describe issues in plain English → AI auto-fills all fields
- **Incident Dashboard** — Status tracking with priority, state, assignment groups
- **F5 Insight Integration** — Auto-sends tickets via webhook, displays analysis results inline
- **Work Notes** — Activity stream showing Insight responses alongside manual notes

## Quick Start

```bash
# Set your API key
export ANTHROPIC_API_KEY=sk-ant-...

# Build and start
docker-compose up --build -d

# Access at http://localhost:3001
```

## Connecting to F5 Insight

### 1. Create a webhook integration in F5 Insight

In the F5 Insight UI → Integrations tab → Webhooks → + Add:
- **Name**: ServiceNow Mock
- **Type**: Incoming Webhook
- **Callback URL**: `http://host.docker.internal:8001/api/callback`
- **Payload Mapping**:
```json
{
  "title": "$.issue.summary",
  "description": "$.issue.description",
  "device": "$.issue.configuration_item",
  "priority": "$.issue.priority",
  "category": "$.issue.category"
}
```

### 2. Copy the webhook token

After creating the integration, you'll see:
```
POST /api/integrations/webhook/abc12345-...
```

### 3. Set the webhook URL

```bash
export INSIGHT_WEBHOOK_URL=http://host.docker.internal:8000/api/integrations/webhook/abc12345-...
docker-compose up --build -d
```

## Demo Flow

1. Open http://localhost:3001
2. Click **+ New Incident** → **AI Create**
3. Type: *"The pool members behind the virtual server app-vs-443 on bigip01.lab.local are showing intermittent failures. Users report 502 errors."*
4. Click **Create Incident**
5. Watch as:
   - AI fills in all fields (category, priority, assignment group, CI)
   - Ticket auto-sends to F5 Insight
   - Insight chains skills (pool status check, VS config, etc.)
   - Results appear in the Work Notes and the Insight Analysis panel

## Architecture

```
┌─────────────────┐     webhook      ┌─────────────────┐
│  ServiceNow     │ ──────────────→  │  F5 Insight     │
│  Mock           │                  │  Skills Agent   │
│  (port 3001)    │ ←────────────── │  (port 3000)    │
│                 │    callback      │                 │
└─────────────────┘                  └─────────────────┘
```

## Ports

| Service | Port |
|---------|------|
| ServiceNow UI | 3001 |
| ServiceNow API | 8001 |
| F5 Insight UI | 3000 |
| F5 Insight API | 8000 |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Required for LLM ticket creation |
| `ANTHROPIC_MODEL` | Model for ticket parsing (default: claude-sonnet-4-20250514) |
| `INSIGHT_WEBHOOK_URL` | Full URL to F5 Insight incoming webhook endpoint |
