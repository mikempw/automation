---
name: bigip-ve-provision
description: >-
  Provision a new BIG-IP VE instance by cloning a Proxmox template VM,
  building a ConfigDrive ISO with the allocated static management IP,
  attaching it, and booting. The VM comes up at the correct IP with no
  DHCP discovery needed. Used as step 1 of the ECMP Scale-Out chain.
metadata:
  product: bigip
  version: "3.0"
  author: F5 Insight
  tags:
    - autoscale
    - provisioning
    - proxmox
    - ecmp
    - destructive
---

# bigip-ve-provision

Clone a BIG-IP VE template, inject static IP via ConfigDrive, and boot.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition ID containing template VMID, IP pool, BGP config, and Proxmox connection details."
  placeholder: "ecmp-prod-01"
- name: proxmox_node
  label: Proxmox Node
  type: string
  required: false
  default: ""
  description: "Target Proxmox node. If empty, uses cluster config."
  placeholder: "threadripper"
```

## Steps

```yaml
- name: allocate_ip
  label: Allocate IP from cluster pool
  transport: proxmox_api
  command_template: "POST /api/clusters/{{cluster_id}}/ip-pool/allocate"
  timeout: 10
  description: "Reserves the next available management IP and self-IP. Returns {mgmt_ip, self_ip, vmid}."
- name: clone_template
  label: Clone BIG-IP VE template
  transport: proxmox_api
  command_template: "POST /api2/json/nodes/{{proxmox_node}}/qemu/{{template_vmid}}/clone {\"newid\": {{vmid}}, \"name\": \"bigip-{{cluster_id}}-{{vmid}}\", \"full\": 1, \"target\": \"{{proxmox_node}}\"}"
  timeout: 300
  description: "Full-clone the BIG-IP VE template."
- name: wait_for_clone
  label: Wait for clone to complete
  target: proxmox
  transport: ssh
  command_template: "echo 'Waiting for clone of VM {{vmid}}...'; for i in $(seq 1 120); do STATUS=$(qm status {{vmid}} 2>&1); if echo \"$STATUS\" | grep -q 'status:'; then LOCK=$(qm config {{vmid}} 2>&1 | grep '^lock:'); if [ -z \"$LOCK\" ]; then echo 'Clone complete'; exit 0; fi; echo \"  Attempt $i/120 — cloning, waiting 5s...\"; else echo \"  Attempt $i/120 — not ready, waiting 5s...\"; fi; sleep 5; done; echo 'TIMEOUT'; exit 1"
  timeout: 660
  description: "Polls until clone lock is released."
- name: configure_vm
  label: Configure VM networking
  transport: proxmox_api
  command_template: "PUT /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/config {\"net0\": \"virtio,bridge=vmbr0\", \"net1\": \"virtio,bridge=vmbr0,tag=10\", \"net2\": \"virtio,bridge=vmbr0,tag=20\", \"cores\": {{cores}}, \"memory\": {{memory_mb}}}"
  timeout: 30
  description: "NICs on vmbr0: net0=mgmt, net1=BGP VLAN 10, net2=client VLAN 20."
- name: build_configdrive
  label: Build ConfigDrive ISO
  target: proxmox
  transport: ssh
  command_template: "mkdir -p /tmp/cd-{{vmid}}/openstack/latest && cat > /tmp/cd-{{vmid}}/openstack/latest/user_data << 'DCEOF'\n#!/bin/bash\nfor i in $(seq 1 60); do /usr/bin/tmsh show sys mcp-state field-fmt 2>/dev/null | grep -q running && break; sleep 5; done\n/usr/bin/tmsh modify sys global-settings mgmt-dhcp disabled\n/usr/bin/tmsh delete sys management-ip all\n/usr/bin/tmsh create sys management-ip {{mgmt_ip}}/24\n/usr/bin/tmsh create sys management-route default gateway 192.168.100.1\n/usr/bin/tmsh modify sys global-settings hostname bigip-{{cluster_id}}-{{vmid}}.local\n/usr/bin/tmsh save sys config\nDCEOF\necho '{\"uuid\": \"vm-{{vmid}}-'$(date +%s)'\"}' > /tmp/cd-{{vmid}}/openstack/latest/meta_data.json && genisoimage -o /var/lib/vz/template/iso/vm-{{vmid}}-configdrive.iso -volid config-2 -joliet -rock /tmp/cd-{{vmid}}/ 2>&1 && rm -rf /tmp/cd-{{vmid}} && echo 'ConfigDrive ISO created'"
  timeout: 30
  description: "Creates ConfigDrive ISO with user_data that waits for mcpd, sets static mgmt IP, disables DHCP, sets hostname. Unique UUID per build."
- name: attach_configdrive
  label: Attach ConfigDrive to VM
  transport: proxmox_api
  command_template: "PUT /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/config {\"ide2\": \"local:iso/vm-{{vmid}}-configdrive.iso,media=cdrom\"}"
  timeout: 15
  description: "Attaches the ConfigDrive ISO as CD-ROM."
- name: start_vm
  label: Start the VM
  transport: proxmox_api
  command_template: "POST /api2/json/nodes/{{proxmox_node}}/qemu/{{vmid}}/status/start"
  timeout: 30
  description: "Powers on the BIG-IP VE."
- name: wait_for_ready
  label: Wait for BIG-IP at static IP
  transport: ssh
  command_template: "echo 'Waiting for BIG-IP at {{mgmt_ip}}...'; for i in $(seq 1 60); do code=$(curl -sk -o /dev/null -w '%{http_code}' https://{{mgmt_ip}}:443/mgmt/tm/sys/version 2>/dev/null); if [ \"$code\" = \"200\" ] || [ \"$code\" = \"401\" ]; then echo '{\"target_host\": \"{{mgmt_ip}}\"}'; exit 0; fi; echo \"  Attempt $i/60 (HTTP $code) — waiting 10s...\"; sleep 10; done; echo 'TIMEOUT'; exit 1"
  timeout: 660
  description: "Polls iControl REST at the static IP until responsive. Outputs target_host for replica steps."
- name: record_provision
  label: Record provisioned instance
  transport: proxmox_api
  command_template: "POST /api/clusters/{{cluster_id}}/members {\"vmid\": {{vmid}}, \"mgmt_ip\": \"{{mgmt_ip}}\", \"self_ip\": \"{{self_ip}}\", \"status\": \"provisioned\"}"
  timeout: 10
  description: "Registers the instance in cluster membership."
```

## Safety

```yaml
requires_approval: true
max_duration: 1200
destructive: true
rollback_enabled: true
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 infrastructure engineer reviewing a BIG-IP VE provisioning operation.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Clone** — Was the VM cloned and lock released?
  2. **ConfigDrive** — Was the ISO built with correct management IP?
  3. **Networking** — NICs on vmbr0 with VLAN tags 10/20?
  4. **Boot** — Did BIG-IP come up at the static IP?
  5. **Allocation** — Management IP, self-IP, VMID assigned?
  6. **Next Steps** — Licensing, config sync, BGP setup needed.

  Be concise.
```
