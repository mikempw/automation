---
name: bigip-irule-install
description: >-
  Install an iRule on a BIG-IP device and apply it to a virtual server.
  Pre-checks for existing iRules, safely handles complex TCL code via
  REST API, and appends to existing rules on the virtual server without
  overwriting them.
metadata:
  product: bigip
  version: "1.1"
  author: F5 Insight
  tags:
    - configuration
    - irule
    - provisioning
---

# bigip-irule-install

Install an iRule on a BIG-IP and apply it to a virtual server. Checks for conflicts and appends to existing rules.

## Parameters

```yaml
- name: irule_name
  label: iRule Name
  type: string
  required: true
  description: "Name for the iRule (created in /Common/). If the iRule already exists, creation is skipped and only the VS assignment is applied."
  placeholder: "app_telemetry_irule"
- name: virtual_server
  label: Virtual Server
  type: string
  required: true
  description: "Full path of the virtual server. Example: /Common/my_vs"
  placeholder: "/Common/my_vs"
- name: irule_body
  label: iRule Code
  type: textarea
  required: true
  description: "Paste the full iRule TCL code here. If the iRule name already exists on the BIG-IP, this field is ignored."
```

## Steps

```yaml
- name: check_existing_irules
  label: Check for existing iRule
  transport: ssh
  command_template: "echo '=== Checking if iRule /Common/{{irule_name}} exists ==='; tmsh list ltm rule /Common/{{irule_name}} one-line 2>&1; echo ''; echo '=== All iRules on system ==='; tmsh list ltm rule one-line 2>&1 | awk '{print $3}'"
  timeout: 15
  continue_on_fail: true
  description: "Lists existing iRules and checks if the target name already exists. Informational only — execution continues regardless."
- name: check_vs_rules
  label: Check current VS rules
  transport: ssh
  command_template: "echo '=== Current rules on {{virtual_server}} ==='; tmsh list ltm virtual {{virtual_server}} rules 2>&1"
  timeout: 15
  continue_on_fail: true
  description: "Shows which iRules are currently assigned to the virtual server. Informational only."
- name: install_irule
  label: Create iRule (skip if exists)
  transport: icontrol_rest
  command_template: "POST /mgmt/tm/ltm/rule {\"name\":\"{{irule_name}}\",\"apiAnonymous\":\"{{irule_body}}\"}"
  timeout: 15
  continue_on_fail: true
  description: "Creates the iRule via REST API. If it already exists, this step will show as failed but execution continues to apply it to the VS."
  rollback_command: "tmsh delete ltm rule /Common/{{irule_name}}"
- name: apply_to_vs
  label: Append iRule to virtual server
  transport: ssh
  command_template: "existing=$(tmsh list ltm virtual {{virtual_server}} rules 2>/dev/null | sed -n '/rules {/,/}/p' | grep -v 'rules {' | grep -v '}' | sed 's/^[ ]*//' | tr '\\n' ' '); echo \"Existing rules: [$existing]\"; if echo \" $existing \" | grep -qw '{{irule_name}}'; then echo 'iRule already assigned to VS — skipping'; else output=$(tmsh modify ltm virtual {{virtual_server}} rules { $existing /Common/{{irule_name}} } 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Failed to apply iRule (exit code $rc)\"; exit 1; else echo 'iRule appended successfully'; fi; fi"
  timeout: 15
  description: "Appends the iRule to the VS without removing existing rules. If the iRule is already assigned, it skips. Captures and reports any BIG-IP validation errors."
- name: save_config
  label: Save configuration
  transport: ssh
  command_template: "tmsh save sys config"
  timeout: 30
  description: "Persists the configuration to disk."
- name: verify
  label: Verify final state
  transport: ssh
  command_template: "echo '=== iRule ==='; tmsh list ltm rule /Common/{{irule_name}} 2>&1 | head -5; echo ''; echo '=== Virtual Server Rules ==='; tmsh list ltm virtual {{virtual_server}} rules 2>&1"
  timeout: 15
  description: "Confirms the iRule exists and is attached to the virtual server."
```

## Safety

```yaml
requires_approval: true
max_duration: 120
destructive: true
rollback_enabled: true
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing an iRule installation.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Pre-Check Results** — Did the iRule already exist? What rules were on the VS before?
  2. **Installation Status** — Was the iRule created (or was it already present)? Was it applied to the VS?
  3. **iRule Review** — Any issues with the TCL code? Performance concerns?
  4. **Final State** — Confirm the iRule is listed on the VS along with any pre-existing rules.
  5. **Recommendations** — Anything to watch out for with multiple iRules on one VS (execution order, variable conflicts, etc).

  Be concise.
```
