---
name: bigip-persistence-records
description: >-
  Show active persistence records for a virtual server on BIG-IP.
  Displays source IP, cookie, SSL, or universal persistence entries
  to troubleshoot session stickiness and load balancing behavior.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [troubleshooting, traffic, discovery]
---

# bigip-persistence-records

Show active persistence records for a virtual server.

## Parameters

```yaml
- name: virtual_server
  label: Virtual Server
  type: string
  required: true
  description: "Name or full path of the virtual server. Example: /Common/my_vs"
  placeholder: "/Common/my_vs"
```

## Steps

```yaml
- name: show_persistence
  label: Show persistence records
  transport: ssh
  command_template: "echo '=== Persistence Records for {{virtual_server}} ==='; tmsh show ltm persistence persist-records virtual {{virtual_server}} 2>&1"
  timeout: 15
  continue_on_fail: true
  description: "Shows all active persistence records for the specified virtual server."
- name: show_persistence_profiles
  label: Show persistence profile on VS
  transport: ssh
  command_template: "echo '=== Persistence Profile ==='; tmsh list ltm virtual {{virtual_server}} persist 2>&1; echo ''; echo '=== Fallback Persistence ==='; tmsh list ltm virtual {{virtual_server}} fallback-persistence 2>&1"
  timeout: 15
  description: "Shows which persistence profile is assigned to the VS."
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
  You are an F5 BIG-IP engineer reviewing persistence records.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Summarize: persistence type in use, number of active records, any stuck or stale sessions, distribution across pool members. Be concise.
```
