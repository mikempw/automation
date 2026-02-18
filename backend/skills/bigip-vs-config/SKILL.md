---
name: bigip-vs-config
description: >-
  Retrieve the full configuration of a BIG-IP virtual server including its
  VIP address, port, pool assignment, pool member IPs and ports, iRules,
  profiles, SNAT, and persistence settings. Use this skill when you need
  to look up IPs, ports, pool members, or any configuration detail for a
  virtual server before performing other actions like tcpdump or troubleshooting.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - discovery
    - configuration
    - troubleshooting
---

# bigip-vs-config

Look up the full configuration of a virtual server — VIP, pool, members, profiles, iRules, and more.

## Parameters

```yaml
- name: virtual_server
  label: Virtual Server Name
  type: string
  required: true
  description: "Name or full path of the virtual server. Example: luke or /Common/luke"
  placeholder: "/Common/my_vs"
```

## Steps

```yaml
- name: get_vs_config
  label: Get virtual server configuration
  transport: ssh
  command_template: "echo '=== Virtual Server ==='; tmsh list ltm virtual {{virtual_server}} 2>&1"
  timeout: 15
  description: "Retrieves the full virtual server configuration including destination IP:port, pool, profiles, rules, SNAT, and persistence."
- name: get_pool_members
  label: Get pool and member details
  transport: ssh
  command_template: "pool=$(tmsh list ltm virtual {{virtual_server}} pool 2>/dev/null | grep pool | awk '{print $2}'); if [ -n \"$pool\" ]; then echo \"=== Pool: $pool ===\"; tmsh list ltm pool $pool members 2>&1; echo ''; echo '=== Member Status ==='; tmsh show ltm pool $pool members 2>&1; else echo 'No pool assigned to this virtual server'; fi"
  timeout: 15
  description: "Looks up the pool assigned to the VS, then retrieves all pool members with their IPs, ports, and status."
- name: get_vs_stats
  label: Get virtual server statistics
  transport: ssh
  command_template: "echo '=== VS Statistics ==='; tmsh show ltm virtual {{virtual_server}} 2>&1 | head -40"
  timeout: 15
  description: "Shows current connection stats, throughput, and availability status for the virtual server."
```

## Safety

```yaml
requires_approval: false
max_duration: 60
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing a virtual server configuration.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide a concise summary:
  1. **Virtual Server** — VIP address, port, current state (enabled/disabled)
  2. **Pool & Members** — Pool name, each member IP:port and their status (up/down/disabled)
  3. **Traffic Policy** — Profiles, iRules, SNAT, persistence, and any other notable settings
  4. **Issues** — Any misconfigurations, down members, or concerns

  Format IPs and ports clearly — the user may need them for tcpdump or other follow-up actions.
```
