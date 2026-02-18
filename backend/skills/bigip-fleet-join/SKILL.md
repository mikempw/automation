---
name: bigip-fleet-join
description: >-
  Register a newly provisioned BIG-IP VE with the F5 Insight fleet. Adds the
  device to Vault with credentials, enables telemetry collection (iRule stats
  push), and updates the cluster membership. This is the final step of the
  ECMP Scale-Out chain that makes the device visible in the Insight UI.
metadata:
  product: bigip
  version: "2.0"
  author: F5 Insight
  tags:
    - autoscale
    - fleet
    - registration
    - ecmp
---

# bigip-fleet-join

Register a BIG-IP VE in the Insight fleet and enable telemetry.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster ID for membership tracking."
  placeholder: "ecmp-prod-01"
- name: mgmt_ip
  label: Management IP
  type: string
  required: true
  description: "Management IP of the BIG-IP to register."
  placeholder: "192.168.100.240"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
- name: hostname
  label: Device Hostname
  type: string
  required: true
  description: "Hostname for the device in Insight (e.g. bigip-ecmp-prod-01-110)."
  placeholder: "bigip-ecmp-prod-01-110"
```

## Steps

```yaml
- name: register_device
  label: Register device in Vault
  transport: proxmox_api
  command_template: "POST /api/devices {\"hostname\": \"{{hostname}}\", \"mgmt_ip\": \"{{mgmt_ip}}\", \"device_type\": \"bigip\", \"port\": 22, \"username\": \"root\", \"password\": \"{{ssh_pass}}\", \"rest_username\": \"admin\", \"rest_password\": \"{{rest_pass}}\", \"ssh_auth_method\": \"password\", \"description\": \"Autoscale replica - cluster {{cluster_id}}\", \"tags\": [\"autoscale\", \"ecmp\", \"{{cluster_id}}\"]}"
  timeout: 10
  description: "Registers the device in Vault via Insight's device API so skills can connect to it."
- name: test_connectivity
  label: Verify Insight can reach the device
  target: replica
  transport: ssh
  command_template: "echo '=== Version ==='; tmsh show sys version 2>&1 | grep -E 'Version|Build'; echo ''; echo '=== Hostname ==='; tmsh show sys global-settings 2>&1 | grep hostname"
  timeout: 15
  description: "Quick connectivity test to confirm Insight can SSH to the new device."
- name: install_telemetry_irule
  label: Install telemetry iRule
  target: replica
  transport: ssh
  command_template: "echo 'Installing Insight telemetry iRule...'; if tmsh list ltm rule /Common/insight_telemetry 2>/dev/null | grep -q 'rule'; then echo 'Telemetry iRule already exists'; else echo 'Fetching iRule from Insight server...'; curl -sf http://{{insight_host}}:8000/api/telemetry/irule > /tmp/insight_irule.tcl 2>&1 && tmsh load sys config merge file /tmp/insight_irule.tcl 2>&1 && echo 'iRule installed' || echo 'WARNING: iRule install failed — telemetry will need manual setup'; rm -f /tmp/insight_irule.tcl; fi"
  timeout: 30
  continue_on_fail: true
  description: "Installs the Insight telemetry collection iRule. Non-fatal if it fails."
- name: update_cluster_membership
  label: Update cluster membership to active
  transport: proxmox_api
  command_template: "PATCH /api/clusters/{{cluster_id}}/members/{{hostname}} {\"status\": \"active\", \"joined_at\": \"now\"}"
  timeout: 10
  description: "Marks the device as an active cluster member in Insight's cluster tracking."
```

## Safety

```yaml
requires_approval: true
max_duration: 120
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 Insight platform engineer reviewing a fleet join operation for an autoscale replica.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Registration** — Was the device registered in Vault successfully?
  2. **Connectivity** — Can Insight reach the device? What version is it running?
  3. **Telemetry** — Was the telemetry iRule installed?
  4. **Cluster Status** — Is the device marked active in the cluster?
  5. **Summary** — The device is now part of the ECMP cluster and visible in Insight.

  Be concise.
```
