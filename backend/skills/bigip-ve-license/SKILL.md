---
name: bigip-ve-license
description: >-
  License a BIG-IP VE instance from the cluster's regkey pool. Allocates a
  registration key via the Insight API, installs it on the BIG-IP via SSH
  (tmsh), and waits for the license to activate. Used as step 2 of the ECMP
  Scale-Out automation chain. Requires target override (mgmt_ip from provision
  step) to reach the replica.
metadata:
  product: bigip
  version: "2.0"
  author: F5 Insight
  tags:
    - autoscale
    - licensing
    - ecmp
---

# bigip-ve-license

License a BIG-IP VE from a regkey pool managed by Insight.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition containing the license_pool array."
  placeholder: "ecmp-prod-01"
- name: mgmt_ip
  label: BIG-IP Management IP
  type: string
  required: true
  description: "Management IP of the BIG-IP to license. Forwarded from the provision step."
  placeholder: "192.168.100.240"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
```

## Steps

```yaml
- name: allocate_license
  label: Allocate regkey from pool
  transport: proxmox_api
  command_template: "POST /api/clusters/{{cluster_id}}/license-pool/allocate"
  timeout: 10
  description: "Requests the next available registration key from the cluster's license pool. Returns {regkey, index}."
- name: install_license
  label: Install license on BIG-IP
  target: replica
  transport: ssh
  command_template: "echo 'Installing license key...'; output=$(tmsh install sys license registration-key {{regkey}} 2>&1); echo \"$output\"; if echo \"$output\" | grep -qi 'license installed'; then echo 'LICENSE_INSTALL_OK'; exit 0; else echo 'LICENSE_INSTALL_FAILED'; exit 1; fi"
  timeout: 120
  description: "Installs the allocated registration key via tmsh. Handles warnings about invalid current license gracefully."
- name: wait_for_license
  label: Wait for license activation
  target: replica
  transport: ssh
  command_template: "echo 'Waiting for license to activate...'; for i in $(seq 1 30); do status=$(tmsh show sys license 2>&1); if echo \"$status\" | grep -qi 'Licensed version'; then echo 'LICENSE ACTIVE'; echo \"$status\" | head -20; exit 0; fi; echo \"  Attempt $i/30 — waiting 10s...\"; sleep 10; done; echo 'TIMEOUT: License not activated within 5 minutes'; tmsh show sys license 2>&1; exit 1"
  timeout: 330
  continue_on_fail: false
  description: "Polls tmsh every 10s until the license shows as active. Max 5 minutes."
- name: verify_modules
  label: Verify provisioned modules
  target: replica
  transport: ssh
  command_template: "tmsh show sys provision 2>&1 | grep -E 'ltm|asm|apm|afm' | head -10; echo ''; tmsh show sys license 2>&1 | grep -E 'Licensed|Registration|Platform' | head -5; exit 0"
  timeout: 15
  description: "Confirms which modules are licensed and provisioned."
```

## Safety

```yaml
requires_approval: false
max_duration: 420
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 licensing engineer reviewing a BIG-IP VE license assignment from a regkey pool.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Regkey Allocation** — Was a regkey allocated from the pool?
  2. **License Status** — Was the license successfully installed and activated?
  3. **Module Check** — Which modules are provisioned (LTM, ASM, etc.)?
  4. **Issues** — Any license warnings, evaluation mode, or activation failures?
  5. **Next Steps** — Device is licensed and ready for config sync.

  Be concise.
```
