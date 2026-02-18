---
name: bigip-config-sync
description: >-
  Configure networking and BGP peering on a new BIG-IP VE replica. Creates
  VLANs, self-IPs (with BGP port allowed), enables the routing protocol on
  route-domain 0, configures BGP via imish with correct router-id and
  update-source, and saves config. All steps target the replica via mgmt_ip
  override. AS3 sync is skipped for PoC. Used as step 3 of the ECMP Scale-Out
  automation chain.
metadata:
  product: bigip
  version: "2.0"
  author: F5 Insight
  tags:
    - autoscale
    - configuration
    - bgp
    - ecmp
    - destructive
---

# bigip-config-sync

Configure VLANs, self-IPs, and BGP peering on a new ECMP replica.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition containing BGP template (ASN, neighbor IP, VIP network)."
  placeholder: "ecmp-prod-01"
- name: mgmt_ip
  label: Replica Management IP
  type: string
  required: true
  description: "Management IP of the replica BIG-IP to configure."
  placeholder: "192.168.100.240"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
- name: self_ip
  label: Replica Self-IP
  type: string
  required: true
  description: "Self-IP address allocated to this replica on the BGP peering VLAN."
  placeholder: "10.1.1.11"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
```

## Steps

```yaml
- name: create_vlans
  label: Create VLANs on replica
  target: replica
  transport: ssh
  command_template: "echo 'Creating VLANs...'; tmsh create net vlan bgp_peering interfaces add { 1.1 { untagged } } 2>&1 || echo 'bgp_peering VLAN may already exist'; tmsh create net vlan client_vlan interfaces add { 1.2 { untagged } } 2>&1 || echo 'client_vlan VLAN may already exist'; echo 'VLANs:'; tmsh list net vlan one-line 2>&1"
  timeout: 15
  description: "Creates the BGP peering and client-facing VLANs on the replica. Tolerates pre-existing VLANs."
  rollback_command: "tmsh delete net self all; tmsh delete net vlan bgp_peering; tmsh delete net vlan client_vlan"
- name: create_self_ip
  label: Create self-IP on BGP peering VLAN
  target: replica
  transport: ssh
  command_template: "echo 'Creating self-IP {{self_ip}}/24 on bgp_peering...'; tmsh create net self bgp_self address {{self_ip}}/24 vlan bgp_peering allow-service add { default tcp:179 } 2>&1; echo 'Self-IP created:'; tmsh list net self bgp_self 2>&1"
  timeout: 15
  description: "Assigns the allocated self-IP to the BGP peering VLAN with tcp:179 (BGP) explicitly allowed."
  rollback_command: "tmsh delete net self bgp_self"
- name: enable_routing
  label: Enable BGP routing protocol
  target: replica
  transport: ssh
  command_template: "echo 'Enabling BGP on route-domain 0...'; tmsh modify net route-domain 0 routing-protocol add { BGP } 2>&1; echo 'Route-domain 0 routing protocols:'; tmsh list net route-domain 0 routing-protocol 2>&1"
  timeout: 15
  description: "Enables the BGP routing protocol on the default route-domain. Required before imish BGP config will persist."
- name: configure_bgp
  label: Configure BGP via imish
  target: replica
  transport: ssh
  command_template: "echo 'Configuring BGP (AS {{local_asn}}, neighbor {{frr_peer_ip}}, router-id {{self_ip}})...'; imish << IMISHEOF\nenable\nconfigure terminal\nrouter bgp {{local_asn}}\nbgp router-id {{self_ip}}\nneighbor {{frr_peer_ip}} remote-as {{remote_asn}}\nneighbor {{frr_peer_ip}} update-source {{self_ip}}\nneighbor {{frr_peer_ip}} ebgp-multihop 2\nnetwork {{vip_network}}\nend\nwrite memory\nIMISHEOF\necho ''; echo '=== BGP Config Verify ==='; imish -e 'enable' -e 'show running-config' 2>&1 | grep -A 20 'router bgp'; exit 0"
  timeout: 30
  description: "Configures BGP with correct router-id matching self_ip, update-source to ensure BGP sources from the right IP, and advertises the VIP network."
  rollback_command: "imish << EOF\nenable\nconfigure terminal\nno router bgp {{local_asn}}\nend\nwrite memory\nEOF"
- name: save_config
  label: Save all configuration
  target: replica
  transport: ssh
  command_template: "echo 'Saving BIG-IP config...'; tmsh save sys config 2>&1; echo 'Saving imish config...'; imish -e 'enable' -e 'write memory' 2>&1; echo 'Configuration saved'"
  timeout: 30
  description: "Persists all tmsh and imish changes to disk."
```

## Safety

```yaml
requires_approval: true
max_duration: 180
destructive: true
rollback_enabled: true
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing a VLAN/self-IP/BGP configuration for an ECMP autoscale replica.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **VLAN Status** — Were bgp_peering and client_vlan VLANs created on the correct interfaces?
  2. **Self-IP** — Was the self-IP created on bgp_peering with tcp:179 in allow-service?
  3. **Routing Protocol** — Is BGP enabled on route-domain 0?
  4. **BGP Configuration** — Correct ASN, router-id, neighbor, update-source, and network statements?
  5. **Config Saved** — Were both tmsh and imish configs persisted?
  6. **Next Steps** — BGP session verification is next to confirm peering with FRR.

  Be concise and actionable.
```
