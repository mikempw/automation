---
name: bigip-bgp-verify
description: >-
  Verify BGP session establishment and ECMP route propagation for a BIG-IP VE
  in an autoscale cluster. Checks BGP neighbor state on the BIG-IP via imish,
  then verifies the FRR upstream router has received the route and shows the
  correct number of ECMP paths. Read-only — no configuration changes.
  Used as step 4 of the ECMP Scale-Out chain.
metadata:
  product: bigip
  version: "2.0"
  author: F5 Insight
  tags:
    - autoscale
    - bgp
    - verification
    - ecmp
---

# bigip-bgp-verify

Verify BGP peering is established and ECMP routes are propagated.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition containing FRR router IP, expected ASN, and VIP network."
  placeholder: "ecmp-prod-01"
- name: self_ip
  label: BIG-IP Self-IP
  type: string
  required: true
  description: "Self-IP of the BIG-IP whose BGP session to verify."
  placeholder: "10.1.1.11"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
- name: mgmt_ip
  label: Replica Management IP
  type: string
  required: true
  description: "Management IP of the replica for target override."
  placeholder: "192.168.100.240"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
```

## Steps

```yaml
- name: check_bgp_summary
  label: Check BGP neighbor summary on BIG-IP
  target: replica
  transport: ssh
  command_template: "echo '=== BGP Summary on BIG-IP ==='; imish -e 'show ip bgp summary' 2>&1; echo ''; echo '=== BGP Neighbor Detail ==='; imish -e 'show ip bgp neighbors {{frr_peer_ip}}' 2>&1 | head -30"
  timeout: 15
  description: "Shows BGP neighbor table and session state. Look for 'Established' state and non-zero prefix counts."
- name: check_bgp_routes
  label: Check advertised routes on BIG-IP
  target: replica
  transport: ssh
  command_template: "echo '=== Advertised Routes ==='; imish -e 'show ip bgp neighbors {{frr_peer_ip}} advertised-routes' 2>&1; echo ''; echo '=== BGP RIB ==='; imish -e 'show ip bgp' 2>&1 | head -30"
  timeout: 15
  description: "Verifies the VIP network is being advertised to the FRR peer."
- name: check_frr_routes
  label: Verify ECMP routes on FRR router
  transport: ssh
  command_template: "echo '=== FRR BGP Summary ==='; ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 {{frr_user}}@{{frr_ip}} 'sudo vtysh -c \"show bgp summary\"' 2>&1; echo ''; echo '=== ECMP Routes for {{vip_network}} ==='; ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 {{frr_user}}@{{frr_ip}} 'sudo vtysh -c \"show ip route {{vip_network}}\"' 2>&1; echo ''; echo '=== ECMP Path Count ==='; path_count=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 {{frr_user}}@{{frr_ip}} 'sudo vtysh -c \"show ip route {{vip_network}}\"' 2>&1 | grep -c 'via'); echo \"Active ECMP paths: $path_count\""
  timeout: 30
  description: "SSHs from the master BIG-IP to the FRR router to verify ECMP routes. Runs on master (no target override) since FRR SSH is reachable from there."
- name: connectivity_test
  label: Test data-plane connectivity
  target: replica
  transport: ssh
  command_template: "echo '=== Ping FRR peer ==='; ping -c 3 -W 2 {{frr_peer_ip}} 2>&1; echo ''; echo '=== Self-IP reachability ==='; tmsh show net self bgp_self 2>&1 | grep -E 'address|vlan|traffic-group'"
  timeout: 15
  description: "Basic connectivity check from the replica to confirm the BGP peering network is reachable."
```

## Safety

```yaml
requires_approval: false
max_duration: 90
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BGP/ECMP engineer verifying a new BIG-IP VE has joined the ECMP cluster correctly.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **BGP Session** — Is the neighbor state "Established"? How many prefixes exchanged?
  2. **Route Advertisement** — Is the VIP network being advertised from this BIG-IP?
  3. **ECMP Verification** — How many ECMP paths does the FRR router show? Is this the expected count?
  4. **Data Plane** — Can the BIG-IP ping the FRR peer?
  5. **Verdict** — PASS/FAIL with specific reasons.

  If any check fails, explain what's wrong and suggest remediation.
```
