# Skill Authoring Guide

## Overview

Skills are the atomic units of work in F5 Insight. Each skill is a single `SKILL.md` file inside a named directory under `backend/skills/`. The file uses YAML frontmatter for metadata and YAML code blocks for parameters, steps, safety settings, and optional AI analysis prompts.

```
backend/skills/my-new-skill/
└── SKILL.md
```

No code to write. No deployments. Drop the folder in, and the skill appears in the UI immediately (skills are hot-loaded from the filesystem).

## SKILL.md Format

```markdown
---
name: bigip-pool-status
description: >-
  Check health status of all pool members for a specified pool.
  Shows member state, availability, and connection counts.
metadata:
  product: bigip
  version: "1.0"
  author: Your Name
  tags:
    - diagnostics
    - pool
    - health
---

# bigip-pool-status

Check pool member health and availability.

## Parameters

\```yaml
- name: pool_name
  label: Pool Name
  type: string
  required: true
  description: "Full path to the pool (e.g., /Common/my_pool)"
  placeholder: "/Common/web_pool"
  validation_regex: "^/\\w+/\\w+"
\```

## Steps

\```yaml
- name: check_pool
  label: Check pool member status
  transport: ssh
  command_template: "tmsh show ltm pool {{pool_name}} members"
  timeout: 15
  description: "Lists all pool members with their current state."
\```

## Safety

\```yaml
requires_approval: false
max_duration: 30
destructive: false
rollback_enabled: false
\```

## Analysis

\```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing pool health.

  **Output:**
  ~~~
  {{output}}
  ~~~

  Summarize the health of each pool member. Flag any members
  that are down or have zero connections. Recommend action if needed.
\```
```

## Frontmatter

The YAML frontmatter between `---` markers defines skill metadata:

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique identifier — must match the directory name |
| `description` | Yes | What the skill does (shown in the UI skill list) |
| `metadata.product` | Yes | `bigip` or `nginx` — used for UI grouping |
| `metadata.version` | No | Skill version string |
| `metadata.author` | No | Author name |
| `metadata.tags` | No | Array of tags for filtering and search |

## Parameters Section

Parameters are defined as a YAML list inside a fenced code block under `## Parameters`.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Variable name used in `{{name}}` template placeholders |
| `label` | Yes | Human-readable label shown in the UI |
| `type` | Yes | `string`, `number`, `boolean`, `select`, `device` |
| `required` | Yes | Whether the parameter must be provided |
| `default` | No | Default value if not specified |
| `description` | No | Help text shown below the input |
| `placeholder` | No | Placeholder text in the input field |
| `options` | No | Array of allowed values (for `select` type) |
| `validation_regex` | No | Regex pattern for input validation |

### Parameter Types

- **`string`**: Free text input
- **`number`**: Numeric input
- **`boolean`**: Toggle switch
- **`select`**: Dropdown with predefined `options` list
- **`device`**: Special — populates a dropdown with registered devices

### Template Variables

Parameters are available in command templates as `{{param_name}}`. They're also available to the analysis prompt as `{{params}}` (JSON-encoded).

For automation chains, additional variables are available:
- `{{chain.param}}` — Chain-level parameters
- `{{steps.step-id.output.field}}` — Output from a previous step
- Cluster parameters (e.g., `{{frr_peer_ip}}`, `{{local_asn}}`) are injected automatically when a cluster_id is provided

## Steps Section

Steps are the commands that get executed on the target device. Defined as a YAML list under `## Steps`.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Unique step identifier (used in parameter forwarding) |
| `label` | Yes | Human-readable step name shown in the UI |
| `transport` | Yes | `ssh`, `icontrol_bash`, `icontrol_rest`, or `proxmox` |
| `command_template` | Yes | Command with `{{param}}` placeholders |
| `timeout` | Yes | Maximum execution time in seconds |
| `description` | No | What this step does (shown in the UI) |
| `rollback_command` | No | Command to undo this step if rollback is triggered |
| `target` | No | `replica` to route SSH to `{{mgmt_ip}}` instead of the registered device |

### Multi-Step Skills

Steps execute sequentially. If any step fails (non-zero exit code), subsequent steps are skipped unless the automation chain is configured with `on_failure: continue`.

```yaml
- name: backup_config
  label: Backup current config
  transport: ssh
  command_template: "tmsh save sys ucs /var/local/ucs/pre-change-backup.ucs"
  timeout: 30

- name: apply_change
  label: Apply configuration change
  transport: ssh
  command_template: "tmsh modify ltm virtual {{vs_name}} destination {{new_destination}}"
  timeout: 15
  rollback_command: "tmsh modify ltm virtual {{vs_name}} destination {{old_destination}}"
```

### Transport Guide

**SSH** — Most common. Runs shell commands on the device. Use for tmsh, imish, tcpdump, file operations.
```yaml
transport: ssh
command_template: "tmsh show ltm pool {{pool_name}} members"
```

**iControl REST bash** — Runs bash commands via the BIG-IP REST API. Useful when SSH isn't available but REST is. Requires REST credentials on the device.
```yaml
transport: icontrol_bash
command_template: "tmsh list ltm virtual {{vs_name}}"
```

**iControl REST API** — Direct REST API calls. The command template is a JSON object with method, path, and optional body.
```yaml
transport: icontrol_rest
command_template: '{"method": "GET", "path": "/mgmt/tm/ltm/pool/{{pool_name}}/members"}'
```

**Proxmox API** — For BIG-IP VE lifecycle management. Command template is a JSON object with the Proxmox API operation.
```yaml
transport: proxmox
command_template: '{"action": "clone", "template_id": {{template_id}}, "name": "{{vm_name}}"}'
```

### Target Override

For ECMP autoscale, newly provisioned VEs aren't registered as devices yet. Use `target: replica` to route SSH to the `mgmt_ip` parameter instead of the registered device:

```yaml
- name: check_bgp
  label: Check BGP on new replica
  target: replica
  transport: ssh
  command_template: "imish -e 'show ip bgp summary'"
  timeout: 15
```

## Safety Section

Controls approval requirements and execution constraints. Defined as a YAML dict under `## Safety`.

| Field | Default | Description |
|-------|---------|-------------|
| `requires_approval` | `true` | Whether the skill needs explicit approval before execution |
| `max_duration` | `60` | Maximum total execution time in seconds |
| `destructive` | `false` | Whether the skill modifies device configuration |
| `rollback_enabled` | `false` | Whether rollback commands should be offered on failure |

Guidelines:
- **Read-only skills** (show, list, dump): `requires_approval: false, destructive: false`
- **Configuration changes** (modify, create, delete): `requires_approval: true, destructive: true`
- **Long-running operations** (tcpdump, upgrade): Increase `max_duration` accordingly

## Analysis Section

Optional LLM-powered analysis of the execution output. Defined as a YAML dict under `## Analysis`.

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `false` | Whether to run AI analysis after execution |
| `model` | `claude-sonnet-4-20250514` | LLM model to use (overridden by env var if set) |
| `prompt_template` | — | Analysis prompt with `{{output}}` and `{{params}}` placeholders |

### Prompt Template Variables

- `{{output}}` — Combined stdout from all steps (truncated to 15,000 chars)
- `{{params}}` — JSON-encoded parameters that were passed to the skill

### Prompt Writing Tips

1. **Set the role**: "You are an F5 BIG-IP engineer reviewing..."
2. **Include the output**: Always include `{{output}}` in triple-tilde fences (not backticks, which break the YAML block)
3. **Structure the ask**: Numbered list of specific things to check
4. **Request a verdict**: Ask for PASS/FAIL or a severity assessment
5. **Ask for remediation**: "If any check fails, explain what's wrong and suggest next steps"

## Creating Skills via the UI

The **Builder** tab provides a guided form for skill creation. Fill in metadata, add parameters with the visual editor, define steps with transport selection, configure safety settings, and write analysis prompts. The Builder generates a valid `SKILL.md` and saves it to the skills directory.

## Testing a Skill

1. **Add a test device** in the Devices tab
2. **Navigate to Skills** → find your skill → **Run**
3. **Fill parameters** and execute
4. **Check output** for expected results
5. **Verify analysis** (if enabled) provides useful interpretation

For automation chains, test individual skills first, then wire them together in the Visual Editor.

## Examples

### Minimal Diagnostic Skill

```markdown
---
name: bigip-uptime
description: Show device uptime and version info.
metadata:
  product: bigip
  version: "1.0"
---

# bigip-uptime

## Parameters

\```yaml
- name: device
  label: Device
  type: device
  required: true
\```

## Steps

\```yaml
- name: uptime
  label: Show uptime
  transport: ssh
  command_template: "tmsh show sys version; uptime"
  timeout: 10
\```

## Safety

\```yaml
requires_approval: false
max_duration: 15
destructive: false
rollback_enabled: false
\```
```

### Multi-Step with Rollback

```markdown
---
name: bigip-vs-toggle
description: Enable or disable a virtual server with connection drain.
metadata:
  product: bigip
  version: "1.0"
  tags:
    - configuration
    - virtual-server
---

# bigip-vs-toggle

## Parameters

\```yaml
- name: vs_name
  label: Virtual Server
  type: string
  required: true
  placeholder: "/Common/app-vs-443"
- name: state
  label: Target State
  type: select
  required: true
  options:
    - enabled
    - disabled
\```

## Steps

\```yaml
- name: toggle_vs
  label: Set virtual server state
  transport: ssh
  command_template: "tmsh modify ltm virtual {{vs_name}} {{state}}"
  timeout: 15
  rollback_command: "tmsh modify ltm virtual {{vs_name}} enabled"
- name: verify
  label: Verify new state
  transport: ssh
  command_template: "tmsh show ltm virtual {{vs_name}} | grep -E 'Availability|State'"
  timeout: 10
\```

## Safety

\```yaml
requires_approval: true
max_duration: 30
destructive: true
rollback_enabled: true
\```
```
