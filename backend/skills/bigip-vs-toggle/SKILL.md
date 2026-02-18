---
name: bigip-vs-toggle
description: >-
  Enable or disable a virtual server on a BIG-IP device. Shows status
  before and after the change. Use for maintenance windows or emergency
  traffic shutoff.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [configuration, maintenance, traffic]
---

# bigip-vs-toggle

Enable or disable a virtual server.

## Parameters

```yaml
- name: virtual_server
  label: Virtual Server
  type: string
  required: true
  description: "Full path of the virtual server. Example: /Common/my_vs"
  placeholder: "/Common/my_vs"
- name: state
  label: Desired State
  type: select
  required: true
  description: "enable = accept traffic, disable = stop accepting new connections"
  options:
    - enabled
    - disabled
```

## Steps

```yaml
- name: show_before
  label: Show current VS status
  transport: ssh
  command_template: "echo '=== Before ==='; tmsh show ltm virtual {{virtual_server}} 2>&1 | head -20"
  timeout: 15
  description: "Shows the current state of the virtual server."
- name: toggle_vs
  label: Toggle virtual server state
  transport: ssh
  command_template: "output=$(tmsh modify ltm virtual {{virtual_server}} {{state}} 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Failed (exit code $rc)\"; exit 1; else echo 'Virtual server set to {{state}}'; fi"
  timeout: 15
  description: "Changes the virtual server state."
  rollback_command: "tmsh modify ltm virtual {{virtual_server}} enabled"
- name: save_config
  label: Save configuration
  transport: ssh
  command_template: "tmsh save sys config"
  timeout: 30
  description: "Persists the change to disk."
- name: show_after
  label: Verify new status
  transport: ssh
  command_template: "echo '=== After ==='; tmsh show ltm virtual {{virtual_server}} 2>&1 | head -20"
  timeout: 15
  description: "Verifies the VS state after the change."
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
  You are an F5 BIG-IP engineer reviewing a virtual server state change.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Confirm: 1) What was the state before? 2) Was the change applied? 3) What is the state now? 4) Any active connections that may be affected? Be concise.
```
