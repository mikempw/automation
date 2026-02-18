---
name: bigip-pool-status
description: >-
  Check pool member health status and monitor results on a BIG-IP device.
  Use when investigating pool member availability, health check failures,
  or load balancing distribution issues.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - troubleshooting
    - pool
    - health-check
---

# bigip-pool-status

Check pool member status and health monitor results on a BIG-IP.

## Parameters

```yaml
- name: pool_name
  label: Pool Name
  type: string
  required: true
  description: "Full path of the pool to check, e.g. /Common/my_pool. Use 'tmsh list ltm pool' to see available pools."
  placeholder: "/Common/app_pool"
- name: partition
  label: Partition
  type: string
  required: false
  default: "Common"
  description: "BIG-IP partition where the pool is located. Defaults to Common."
  placeholder: "Common"
```

## Steps

```yaml
- name: show_pool_members
  label: Show pool member status
  transport: ssh
  command_template: "tmsh show ltm pool {{pool_name}} members"
  timeout: 15
  description: "Shows the current availability and health status of all pool members."
- name: show_pool_config
  label: Show pool configuration
  transport: ssh
  command_template: "tmsh list ltm pool {{pool_name}}"
  timeout: 15
  description: "Shows the pool configuration including monitor, load balancing method, and member definitions."
- name: show_monitor_instances
  label: Show active monitor instances
  transport: ssh
  command_template: "tmsh show ltm pool {{pool_name}} members field-fmt | grep -E 'monitor-status|addr|port|status.enabled|status.availability'"
  timeout: 15
  description: "Shows monitor status per member in a condensed format."
```

## Safety

```yaml
requires_approval: false
max_duration: 30
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing pool member health status.

  **Pool:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Status Summary** — How many members are up/down? Overall pool health.
  2. **Issues Found** — Any members failing monitors? Disabled members?
  3. **Monitor Analysis** — Is the monitor appropriate for this pool type?
  4. **Recommendations** — Specific tmsh commands to fix issues found.

  Be concise and actionable.
```
