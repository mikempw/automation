---
name: bigip-ve-license-revoke
description: >-
  Revoke the license on a BIG-IP VE and release the regkey back to the
  cluster's license pool. Must be run before destroying the VM to avoid
  burning license keys. Used in the ECMP Scale-In chain.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - autoscale
    - licensing
    - ecmp
---

# bigip-ve-license-revoke

Revoke a BIG-IP license and return the regkey to the pool.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition containing the license pool."
  placeholder: "ecmp-prod-01"
- name: mgmt_ip
  label: BIG-IP Management IP
  type: string
  required: true
  description: "Management IP of the BIG-IP to revoke."
  placeholder: "192.168.100.240"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
```

## Steps

```yaml
- name: get_regkey
  label: Get current registration key
  target: replica
  transport: ssh
  command_template: "REGKEY=$(tmsh show sys license 2>&1 | grep 'Registration Key' | awk '{print $NF}'); if [ -n \"$REGKEY\" ]; then echo \"{\\\"regkey\\\": \\\"$REGKEY\\\"}\"; else echo 'No license found'; exit 1; fi"
  timeout: 15
  description: "Extracts the current registration key from the BIG-IP for pool release."
- name: revoke_license
  label: Revoke license from F5 server
  target: replica
  transport: ssh
  command_template: "echo 'Revoking license...'; tmsh revoke sys license 2>&1; echo 'License revoked'"
  timeout: 60
  description: "Revokes the license with the F5 license server so the regkey can be reused."
- name: release_to_pool
  label: Release regkey to pool
  transport: proxmox_api
  command_template: "POST /api/clusters/{{cluster_id}}/license-pool/release {\"regkey\": \"{{regkey}}\"}"
  timeout: 10
  continue_on_fail: true
  description: "Marks the regkey as available in the cluster license pool."
```

## Safety

```yaml
requires_approval: false
max_duration: 120
destructive: true
rollback_enabled: false
```

## Analysis

```yaml
enabled: false
```
