# API Reference

Base URL: `http://localhost:8000`

All endpoints accept and return JSON. The frontend proxies `/api/*` through Nginx, so from the browser everything is relative to port 3000.

## Health

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | System health check |

Returns vault connectivity, LLM provider status, and configured model.

## Devices

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices/` | List all devices |
| POST | `/api/devices/` | Add a device |
| GET | `/api/devices/{hostname}` | Get device details (credentials masked) |
| PUT | `/api/devices/{hostname}` | Update a device |
| DELETE | `/api/devices/{hostname}` | Remove a device |
| POST | `/api/devices/{hostname}/test` | Test SSH connectivity |

### Add Device Body

```json
{
  "hostname": "bigip01.lab.local",
  "mgmt_ip": "192.168.1.20",
  "device_type": "bigip",
  "port": 22,
  "username": "admin",
  "password": "secret",
  "ssh_auth_method": "password",
  "description": "Production BIG-IP",
  "tags": ["prod", "dc1"]
}
```

For SSH key auth, set `ssh_auth_method: "ssh_key"` and provide `ssh_private_key` (PEM-encoded string).

For iControl REST, additionally provide `rest_username` and `rest_password`.

## Skills

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/skills/` | List all skills (summary info) |
| GET | `/api/skills/{name}` | Get full skill definition |
| POST | `/api/skills/` | Create a new skill |
| DELETE | `/api/skills/{name}` | Delete a skill |

## Execution

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/execute/` | Execute a skill (synchronous) |
| POST | `/api/execute/stream` | Execute a skill (SSE streaming) |
| GET | `/api/execute/history` | List execution history |
| GET | `/api/execute/history/{id}` | Get specific execution result |

### Execute Body

```json
{
  "skill_name": "bigip-pool-status",
  "device_hostname": "bigip01.lab.local",
  "parameters": {
    "pool_name": "/Common/web_pool"
  }
}
```

### Streaming Response

The `/stream` endpoint returns Server-Sent Events:

```
data: {"type": "step_start", "step": "check_pool", "label": "Check pool status"}
data: {"type": "output", "step": "check_pool", "data": "Pool /Common/web_pool ..."}
data: {"type": "step_complete", "step": "check_pool", "status": "complete"}
data: {"type": "analysis", "content": "All 3 pool members are healthy..."}
data: {"type": "complete", "result": { ... }}
```

## Chat

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/` | Send a message to the chat agent |
| POST | `/api/chat/execute` | Execute a skill the agent proposed |
| POST | `/api/chat/execute/stream` | Execute with SSE streaming |

### Chat Message Body

```json
{
  "messages": [
    {"role": "user", "content": "Check the pool status on bigip01"}
  ]
}
```

The agent responds with a text explanation and optionally a `skill_request` object ready for execution.

## Conversations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/conversations/` | List conversations |
| POST | `/api/conversations/` | Create a conversation |
| GET | `/api/conversations/{id}` | Get conversation with messages |
| PUT | `/api/conversations/{id}` | Rename a conversation |
| DELETE | `/api/conversations/{id}` | Delete a conversation |
| POST | `/api/conversations/{id}/messages` | Add a message |
| PATCH | `/api/conversations/messages/{msg_id}` | Update a message |

## Automations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/automations/` | List all automations |
| GET | `/api/automations/templates` | Get built-in templates |
| POST | `/api/automations/` | Create an automation |
| GET | `/api/automations/{id}` | Get automation definition |
| PUT | `/api/automations/{id}` | Update an automation |
| DELETE | `/api/automations/{id}` | Delete an automation |
| POST | `/api/automations/{id}/duplicate` | Duplicate an automation |
| POST | `/api/automations/{id}/run` | Start an automation run |
| GET | `/api/automations/{id}/runs` | List runs for an automation |
| GET | `/api/automations/runs/all` | List all runs (across automations) |
| GET | `/api/automations/runs/{run_id}` | Get run details |
| POST | `/api/automations/runs/{run_id}/resume` | Approve/reject a paused run |

### Run Automation Body

```json
{
  "parameters": {
    "device": "bigip01.lab.local",
    "pool_name": "/Common/web_pool"
  },
  "auto_approve": false
}
```

### Resume Run Body

```json
{
  "action": "approve"
}
```

Action can be `"approve"` or `"reject"`.

## Clusters (ECMP Autoscale)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/clusters/` | List clusters |
| POST | `/api/clusters/` | Create a cluster |
| GET | `/api/clusters/{id}` | Get cluster config |
| GET | `/api/clusters/{id}/params` | Get flattened cluster parameters |
| PUT | `/api/clusters/{id}` | Update cluster config |
| DELETE | `/api/clusters/{id}` | Delete a cluster |
| GET | `/api/clusters/{id}/ip-pool` | Get IP pool status |
| POST | `/api/clusters/{id}/ip-pool/allocate` | Allocate next available IP |
| POST | `/api/clusters/{id}/ip-pool/release` | Release an IP back to pool |
| GET | `/api/clusters/{id}/members` | List cluster members |
| POST | `/api/clusters/{id}/members` | Add a member |
| PATCH | `/api/clusters/{id}/members/{hostname}` | Update member status |
| DELETE | `/api/clusters/{id}/members/{hostname}` | Remove a member |

## Integrations

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/` | List integrations |
| POST | `/api/integrations/` | Create an integration |
| GET | `/api/integrations/{id}` | Get integration details |
| PUT | `/api/integrations/{id}` | Update an integration |
| DELETE | `/api/integrations/{id}` | Delete an integration |
| GET | `/api/integrations/{id}/logs` | Get webhook logs |
| POST | `/api/integrations/webhook/{token}` | Incoming webhook endpoint |
| POST | `/api/integrations/webhook/{token}/execute` | Execute an approved skill via webhook |

### Create Integration Body

```json
{
  "name": "ServiceNow Prod",
  "type": "incoming_webhook",
  "config": {
    "callback_url": "http://servicenow.example.com/api/callback",
    "payload_mapping": {
      "title": "$.issue.summary",
      "description": "$.issue.description",
      "device": "$.issue.configuration_item"
    }
  }
}
```

Integration types: `incoming_webhook`, `outgoing_webhook`, `bidirectional_webhook`.

For automation-triggered integrations, add `automation_id` and `chain_parameters_mapping` to the config.

## MCP Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/mcp-clients/` | List MCP connections |
| POST | `/api/mcp-clients/` | Add an MCP connection |
| POST | `/api/mcp-clients/{id}/discover` | Discover tools on MCP server |
| POST | `/api/mcp-clients/{id}/call` | Call a tool on MCP server |
| DELETE | `/api/mcp-clients/{id}` | Delete an MCP connection |

### Add MCP Connection Body

```json
{
  "name": "External Agent",
  "url": "http://agent.example.com/mcp",
  "transport": "streamable-http"
}
```

### Call MCP Tool Body

```json
{
  "tool_name": "get_weather",
  "arguments": {"city": "Seattle"}
}
```

## Images

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/images/staged` | List staged ISO images |
| POST | `/api/images/upload` | Upload an ISO (multipart form) |
| DELETE | `/api/images/staged/{filename}` | Delete a staged image |
| POST | `/api/images/push` | Push an image to a device |
| GET | `/api/images/device/{hostname}` | List images on a device |

## Topology

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/topology/{hostname}` | List virtual servers on a device |
| GET | `/api/topology/{hostname}/{vs}` | Get full VS → pool → node topology |
