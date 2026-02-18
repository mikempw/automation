---
name: bigip-ve-deprovision
description: >-
  Destroy a BIG-IP VE instance on Proxmox. Gracefully shuts down the VM,
  waits for it to stop, then destroys the VM and its disks. This is the
  final step of the ECMP Scale-In chain — only run after BGP withdrawal,
  connection drain, and fleet deregistration are complete.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - autoscale
    - proxmox
    - deprovisioning
    - ecmp
    - destructive
---

# bigip-ve-deprovision

Stop and destroy a BIG-IP VE on Proxmox.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition with Proxmox connection details."
  placeholder: "ecmp-prod-01"
- name: vmid
  label: Proxmox VMID
  type: integer
  required: true
  description: "VMID of the BIG-IP VE to destroy."
  placeholder: "101"
- name: proxmox_node
  label: Proxmox Node
  type: string
  required: false
  default: ""
  description: "Proxmox node where the VM is running. If empty, uses cluster config."
  placeholder: "pve01"
```

## Steps

```yaml
- name: check_vm_status
  label: Check current VM status
  transport: proxmox_api
  command_template: "GET /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/status/current"
  timeout: 15
  description: "Verifies the VM exists and checks its current power state."
- name: graceful_shutdown
  label: Graceful shutdown
  transport: proxmox_api
  command_template: "POST /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/status/shutdown {\"timeout\": 60}"
  timeout: 15
  continue_on_fail: true
  description: "Sends ACPI shutdown signal. If the VM doesn't respond, we'll force stop it."
- name: wait_for_stop
  label: Wait for VM to stop
  transport: ssh
  command_template: "echo 'Waiting for VMID {{vmid}} to stop...'; for i in $(seq 1 12); do status=$(curl -sk -H 'Authorization: PVEAPIToken={{proxmox_token}}' https://{{proxmox_host}}:8006/api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/status/current 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"data\"][\"status\"])' 2>/dev/null); echo \"  Attempt $i/12 — status: $status\"; if [ \"$status\" = 'stopped' ]; then echo 'VM stopped'; exit 0; fi; sleep 10; done; echo 'VM did not stop gracefully — force stopping...'; curl -sk -X POST -H 'Authorization: PVEAPIToken={{proxmox_token}}' https://{{proxmox_host}}:8006/api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/status/stop 2>&1; sleep 5; echo 'Force stop issued'"
  timeout: 150
  description: "Polls VM status until stopped. Force-stops after 2 minutes if graceful shutdown doesn't work."
- name: destroy_vm
  label: Destroy VM and disks
  transport: proxmox_api
  command_template: "DELETE /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}} {\"purge\": 1, \"destroy-unreferenced-disks\": 1}"
  timeout: 30
  description: "Permanently deletes the VM and all associated disk images."
- name: verify_destroyed
  label: Verify VM no longer exists
  transport: proxmox_api
  command_template: "GET /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/status/current"
  timeout: 10
  continue_on_fail: true
  description: "Confirms the VM is gone. This request should return 404/500."
```

## Safety

```yaml
requires_approval: true
max_duration: 300
destructive: true
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 infrastructure engineer reviewing a BIG-IP VE deprovisioning on Proxmox.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Shutdown** — Did the VM shut down gracefully, or was a force-stop needed?
  2. **Destruction** — Was the VM and its disks fully removed?
  3. **Verification** — Does the final check confirm the VM no longer exists?
  4. **Resource Recovery** — VMID, disk space, and compute resources are now freed.
  5. **Scale-In Complete** — Summarize: BGP withdrawn → connections drained → fleet left → VM destroyed.

  Be concise.
```
