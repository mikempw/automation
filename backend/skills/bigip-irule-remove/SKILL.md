---
name: bigip-irule-remove
description: >-
  Remove an iRule from a virtual server and optionally delete the iRule
  from the BIG-IP. Shows before/after state and preserves other iRules
  on the virtual server.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [configuration, irule, maintenance]
---

# bigip-irule-remove

Remove an iRule from a virtual server.

## Parameters

```yaml
- name: irule_name
  label: iRule Name
  type: string
  required: true
  description: "Name of the iRule to remove. Example: my_irule"
  placeholder: "my_irule"
- name: virtual_server
  label: Virtual Server
  type: string
  required: true
  description: "Virtual server to remove the iRule from. Example: /Common/my_vs"
  placeholder: "/Common/my_vs"
- name: delete_irule
  label: Also delete the iRule from BIG-IP?
  type: select
  required: true
  description: "If 'yes', the iRule object is deleted after removal from the VS. If 'no', only the VS assignment is removed."
  options:
    - "no"
    - "yes"
```

## Steps

```yaml
- name: show_before
  label: Show current state
  transport: ssh
  command_template: "echo '=== Current Rules on {{virtual_server}} ==='; tmsh list ltm virtual {{virtual_server}} rules 2>&1; echo ''; echo '=== iRule Code ==='; tmsh list ltm rule /Common/{{irule_name}} 2>&1 | head -20"
  timeout: 15
  description: "Shows current rules on the VS and the iRule code before removal."
- name: remove_from_vs
  label: Remove iRule from virtual server
  transport: ssh
  command_template: "remaining=$(tmsh list ltm virtual {{virtual_server}} rules 2>/dev/null | sed -n '/rules {/,/}/p' | grep -v 'rules {' | grep -v '}' | sed 's/^[ ]*//' | grep -v '^{{irule_name}}$' | grep -v '^/Common/{{irule_name}}$' | tr '\\n' ' '); echo \"Remaining rules: [$remaining]\"; if [ -z \"$(echo $remaining | tr -d ' ')\" ]; then output=$(tmsh modify ltm virtual {{virtual_server}} rules none 2>&1); else output=$(tmsh modify ltm virtual {{virtual_server}} rules { $remaining } 2>&1); fi; rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Failed to update VS rules (exit code $rc)\"; exit 1; else echo 'iRule removed from VS'; fi"
  timeout: 15
  description: "Removes the specified iRule from the VS while preserving other rules."
  rollback_command: "tmsh modify ltm virtual {{virtual_server}} rules add { /Common/{{irule_name}} }"
- name: delete_irule_obj
  label: Delete iRule object (if requested)
  transport: ssh
  command_template: "if [ '{{delete_irule}}' = 'yes' ]; then output=$(tmsh delete ltm rule /Common/{{irule_name}} 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Failed to delete iRule (exit code $rc)\"; exit 1; else echo 'iRule /Common/{{irule_name}} deleted'; fi; else echo 'Skipping iRule deletion (delete_irule=no)'; fi"
  timeout: 15
  continue_on_fail: true
  description: "Deletes the iRule object from BIG-IP if requested."
- name: save_config
  label: Save configuration
  transport: ssh
  command_template: "tmsh save sys config"
  timeout: 30
  description: "Persists the change to disk."
- name: show_after
  label: Verify final state
  transport: ssh
  command_template: "echo '=== Rules on {{virtual_server}} after removal ==='; tmsh list ltm virtual {{virtual_server}} rules 2>&1"
  timeout: 15
  description: "Confirms the iRule has been removed."
```

## Safety

```yaml
requires_approval: true
max_duration: 90
destructive: true
rollback_enabled: true
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing an iRule removal.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Confirm: 1) Was the iRule removed from the VS? 2) Were other rules on the VS preserved? 3) Was the iRule object deleted (if requested)? 4) Final state of the VS rules. Be concise.
```
