---
name: bigip-virtual-server-create
description: >-
  Create a new virtual server on a BIG-IP device with pool, profiles, and
  associated configuration. Use for guided virtual server provisioning
  with best-practice defaults.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - configuration
    - virtual-server
    - provisioning
---

# bigip-virtual-server-create

Guided creation of a virtual server with pool, nodes, and profiles on a BIG-IP.

## Parameters

```yaml
- name: vs_name
  label: Virtual Server Name
  type: string
  required: true
  description: "Name for the new virtual server. Use a descriptive name like 'app1_https_vs'. Will be created in the specified partition."
  placeholder: "app1_https_vs"
- name: vs_destination
  label: Destination IP:Port
  type: string
  required: true
  description: "Listener address and port, e.g. 10.1.20.100:443. This is the IP clients connect to."
  placeholder: "10.1.20.100:443"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+:\\d+$"
- name: pool_name
  label: Pool Name
  type: string
  required: true
  description: "Name for the server pool. Pool members will be added to this pool."
  placeholder: "app1_pool"
- name: pool_members
  label: Pool Members
  type: string
  required: true
  description: "Comma-separated list of pool member IP:port pairs, e.g. '10.1.10.10:443,10.1.10.11:443'"
  placeholder: "10.1.10.10:443,10.1.10.11:443"
- name: lb_method
  label: Load Balancing Method
  type: select
  required: true
  default: "round-robin"
  description: "How traffic is distributed across pool members. Round-robin is the default; least-connections is better for varying request sizes."
  options:
    - "round-robin"
    - "least-connections-member"
    - "ratio-member"
    - "observed-member"
    - "predictive-member"
- name: http_profile
  label: HTTP Profile
  type: select
  required: true
  default: "http"
  description: "HTTP profile to apply. Use 'http' for standard, or a custom profile name."
  options:
    - "http"
    - "http-transparent"
    - "http-explicit"
- name: partition
  label: Partition
  type: string
  required: false
  default: "Common"
  description: "BIG-IP partition for the virtual server."
  placeholder: "Common"
- name: snat
  label: SNAT Mode
  type: select
  required: true
  default: "automap"
  description: "Source NAT mode. Automap uses self IPs for SNAT. None preserves client source IP (requires routing changes)."
  options:
    - "automap"
    - "none"
```

## Steps

```yaml
- name: create_pool
  label: Create pool with members
  transport: ssh
  command_template: "tmsh create ltm pool /{{partition}}/{{pool_name}} members add { {{pool_members}} } monitor gateway_icmp load-balancing-mode {{lb_method}}"
  timeout: 15
  description: "Creates the server pool and adds members."
  rollback_command: "tmsh delete ltm pool /{{partition}}/{{pool_name}}"
- name: create_virtual
  label: Create virtual server
  transport: ssh
  command_template: "tmsh create ltm virtual /{{partition}}/{{vs_name}} destination {{vs_destination}} pool /{{partition}}/{{pool_name}} ip-protocol tcp profiles add { {{http_profile}} } source-address-translation { type {{snat}} }"
  timeout: 15
  description: "Creates the virtual server pointing to the pool."
  rollback_command: "tmsh delete ltm virtual /{{partition}}/{{vs_name}}"
- name: save_config
  label: Save configuration
  transport: ssh
  command_template: "tmsh save sys config"
  timeout: 30
  description: "Persists the configuration to disk."
- name: verify
  label: Verify virtual server
  transport: ssh
  command_template: "tmsh show ltm virtual /{{partition}}/{{vs_name}}"
  timeout: 15
  description: "Confirms the virtual server is created and shows its status."
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
  You are an F5 BIG-IP engineer verifying a new virtual server deployment.

  **Configuration Applied:**
  {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Deployment Status** — Was the VS created successfully?
  2. **Configuration Review** — Any issues with the config (missing profiles, incorrect SNAT, etc.)?
  3. **Recommendations** — Additional profiles or settings to consider (SSL, persistence, etc.).

  Be concise.
```
