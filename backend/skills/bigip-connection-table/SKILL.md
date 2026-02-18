---
name: bigip-connection-table
description: >-
  Show and analyze the BIG-IP connection table for a virtual server or
  pool member. Use when investigating active connections, connection
  counts, persistence, or connection distribution issues.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - troubleshooting
    - connections
---

# bigip-connection-table

Analyze the BIG-IP connection table for active connections and distribution.

## Parameters

```yaml
- name: virtual
  label: Virtual Server Name
  type: string
  required: false
  description: "Virtual server name to filter connections for. Leave empty to show all connections."
  placeholder: "/Common/app1_vs"
- name: client_ip
  label: Client IP
  type: ip_address
  required: false
  description: "Filter connections from a specific client IP address."
  placeholder: "192.168.1.100"
- name: pool_member
  label: Pool Member IP
  type: ip_address
  required: false
  description: "Filter connections to a specific pool member."
  placeholder: "10.1.10.10"
```

## Steps

```yaml
- name: show_connections
  label: Show connection table
  transport: ssh
  command_template: "tmsh show sys connection cs-server-addr {{pool_member}} cs-client-addr {{client_ip}} | head -200"
  timeout: 15
  description: "Shows active connections filtered by the specified criteria."
- name: connection_summary
  label: Connection count summary
  transport: ssh
  command_template: "tmsh show ltm virtual {{virtual}} | grep -E 'Bits|Packets|Connections|Current'"
  timeout: 15
  description: "Shows connection statistics and throughput for the virtual server."
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
  You are an F5 BIG-IP engineer analyzing connection table data.

  **Filters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Connection Summary** — Total connections, distribution across pool members.
  2. **Anomalies** — Any connection buildup, asymmetric distribution, or stuck connections?
  3. **Recommendations** — Actions to take if issues found.

  Be concise.
```
