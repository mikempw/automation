---
name: bigip-node-toggle
description: >-
  Enable, disable, or force offline a pool member on a BIG-IP device.
  Use this to gracefully drain connections or take a node out of rotation
  for maintenance. Shows status before and after the change.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [configuration, maintenance, traffic]
---

# bigip-node-toggle

Enable, disable, or force offline a pool member.

## Parameters

```yaml
- name: pool_name
  label: Pool Name
  type: string
  required: true
  description: "Full path of the pool. Example: /Common/web_pool"
  placeholder: "/Common/web_pool"
- name: member
  label: Pool Member
  type: string
  required: true
  description: "Member address:port. Example: 10.1.1.10:80"
  placeholder: "10.1.1.10:80"
- name: state
  label: Desired State
  type: select
  required: true
  description: "enable = accept new connections, disable = drain existing (no new), force-offline = drop all immediately"
  options:
    - enable
    - disable
    - force-offline
```

## Steps

```yaml
- name: show_before
  label: Show current member status
  transport: ssh
  command_template: "echo '=== Before ==='; tmsh show ltm pool {{pool_name}} members {{member}} 2>&1"
  timeout: 15
  description: "Shows the current state of the pool member before making changes."
- name: toggle_member
  label: Toggle pool member state
  transport: ssh
  command_template: "output=$(tmsh modify ltm pool {{pool_name}} members modify { {{member}} { state user-{{state}} {{state}} } } 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Failed (exit code $rc)\"; exit 1; else echo 'Member state changed to {{state}}'; fi"
  timeout: 15
  description: "Changes the pool member state."
  rollback_command: "tmsh modify ltm pool {{pool_name}} members modify { {{member}} { state user-enabled enabled } }"
- name: save_config
  label: Save configuration
  transport: ssh
  command_template: "tmsh save sys config"
  timeout: 30
  description: "Persists the change to disk."
- name: show_after
  label: Verify new status
  transport: ssh
  command_template: "echo '=== After ==='; tmsh show ltm pool {{pool_name}} members {{member}} 2>&1"
  timeout: 15
  description: "Verifies the pool member state after the change."
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
  You are an F5 BIG-IP engineer reviewing a pool member state change.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Confirm: 1) What was the state before? 2) Was the change applied? 3) What is the state now? 4) Any impact on availability — is the pool still healthy with enough active members? Be concise.
```
