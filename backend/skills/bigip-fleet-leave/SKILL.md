---
name: bigip-fleet-leave
description: >-
  Deregister a BIG-IP VE from the F5 Insight fleet and release resources.
  Removes the device from Vault, revokes the license back to the BIG-IQ pool,
  releases the allocated IP back to the cluster's IP pool, and updates cluster
  membership. Used as step 3 of the ECMP Scale-In chain.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - autoscale
    - fleet
    - deregistration
    - ecmp
    - destructive
---

# bigip-fleet-leave

Deregister a BIG-IP VE from Insight fleet and release resources.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster ID for membership and IP pool tracking."
  placeholder: "ecmp-prod-01"
- name: hostname
  label: Device Hostname
  type: string
  required: true
  description: "Hostname of the device in Insight (as registered in Vault)."
  placeholder: "bigip-ecmp-prod-01-21"
- name: mgmt_ip
  label: Management IP
  type: string
  required: true
  description: "Management IP to release back to the pool."
  placeholder: "192.168.1.21"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
- name: self_ip
  label: Self-IP
  type: string
  required: true
  description: "Self-IP to release back to the pool."
  placeholder: "10.1.1.11"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
```

## Steps

```yaml
- name: revoke_license
  label: Revoke license to pool
  transport: icontrol_rest
  command_template: "POST /mgmt/cm/device/tasks/licensing/pool/member-management {\"licensePoolName\": \"{{license_pool}}\", \"command\": \"revoke\", \"address\": \"{{mgmt_ip}}\", \"assignmentType\": \"UNREACHABLE\", \"macAddress\": \"{{mac_address}}\"}"
  timeout: 60
  continue_on_fail: true
  description: "Revokes the license back to the BIG-IQ pool so it can be reused. Non-fatal if BIG-IQ is unreachable."
- name: remove_from_vault
  label: Remove device from Vault
  transport: icontrol_rest
  command_template: "DELETE /v1/secret/data/devices/{{hostname}}"
  timeout: 10
  description: "Removes the device credentials from Vault so Insight stops trying to connect."
- name: release_ips
  label: Release IPs back to pool
  transport: proxmox_api
  command_template: "POST /api/clusters/{{cluster_id}}/ip-pool/release {\"mgmt_ip\": \"{{mgmt_ip}}\", \"self_ip\": \"{{self_ip}}\"}"
  timeout: 10
  description: "Returns the allocated IPs to the cluster's available pool."
- name: update_membership
  label: Remove from cluster membership
  transport: proxmox_api
  command_template: "DELETE /api/clusters/{{cluster_id}}/members/{{hostname}}"
  timeout: 10
  description: "Removes the device from the cluster's active member list."
```

## Safety

```yaml
requires_approval: true
max_duration: 120
destructive: true
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 Insight platform engineer reviewing a fleet leave operation for ECMP scale-in.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **License** — Was the license revoked successfully? If not, note it for manual cleanup.
  2. **Vault** — Was the device removed from Vault?
  3. **IP Pool** — Were the management and self-IPs released?
  4. **Cluster Membership** — Was the device removed from the cluster?
  5. **Next Steps** — VM is now deregistered; safe to destroy the Proxmox VM.

  Be concise.
```
