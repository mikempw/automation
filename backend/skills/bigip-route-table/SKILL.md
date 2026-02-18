---
name: bigip-route-table
description: >-
  Show the routing table on a BIG-IP device including management, TMM,
  and kernel routes. Useful for troubleshooting connectivity and verifying
  next-hop paths.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [network, troubleshooting, discovery]
---

# bigip-route-table

Show routing table entries on a BIG-IP.

## Parameters

```yaml
- name: route_domain
  label: Route Domain (optional)
  type: string
  required: false
  description: "Route domain ID to filter. Leave empty for default (0)."
  placeholder: "0"
```

## Steps

```yaml
- name: tmm_routes
  label: Show TMM routes
  transport: ssh
  command_template: "echo '=== TMM Route Table ==='; tmsh list net route 2>&1"
  timeout: 15
  description: "Shows TMM-level configured routes."
- name: kernel_routes
  label: Show kernel routes
  transport: ssh
  command_template: "echo '=== Kernel Route Table ==='; ip route show 2>&1; echo ''; echo '=== Management Route ==='; tmsh list sys management-route 2>&1"
  timeout: 15
  description: "Shows Linux kernel routes and management routes."
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
  You are an F5 BIG-IP engineer reviewing routing tables.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Summarize: default gateway, notable routes, any asymmetric routing risks, management vs TMM route separation. Be concise.
```
