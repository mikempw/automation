---
name: bigip-arp-table
description: >-
  Show the ARP table on a BIG-IP device. Optionally filter by IP address
  or VLAN to find MAC address mappings and troubleshoot L2 connectivity.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [network, troubleshooting, discovery]
---

# bigip-arp-table

Show ARP table entries with optional filtering.

## Parameters

```yaml
- name: filter
  label: Filter (optional)
  type: string
  required: false
  description: "Optional IP address or VLAN name to filter results. Leave empty to show all."
  placeholder: "10.1.1.100"
```

## Steps

```yaml
- name: show_arp
  label: Show ARP table
  transport: ssh
  command_template: "if [ -n '{{filter}}' ]; then echo '=== ARP entries matching {{filter}} ==='; tmsh show net arp 2>&1 | grep -i '{{filter}}' || echo 'No matching entries'; echo ''; echo '=== Full ARP detail ==='; tmsh show net arp {{filter}} 2>&1; else echo '=== Full ARP Table ==='; tmsh show net arp 2>&1; fi"
  timeout: 15
  continue_on_fail: true
  description: "Displays ARP table entries. If a filter is provided, shows only matching entries."
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
  You are an F5 BIG-IP engineer reviewing ARP table output.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Summarize: how many entries, any incomplete/pending entries (potential L2 issues), notable MAC-to-IP mappings. Be concise.
```
