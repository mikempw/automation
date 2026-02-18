---
name: bigip-bgp-withdraw
description: >-
  Withdraw BGP route advertisements from a BIG-IP VE before scale-in.
  Removes the VIP network statement from BGP config via imish, then verifies
  the FRR upstream router has dropped the path. This gracefully removes the
  device from the ECMP group before draining connections.
  Used as step 1 of the ECMP Scale-In chain.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - autoscale
    - bgp
    - ecmp
    - destructive
---

# bigip-bgp-withdraw

Withdraw BGP route advertisement to remove a BIG-IP from the ECMP group.

## Parameters

```yaml
- name: cluster_id
  label: ECMP Cluster ID
  type: string
  required: true
  description: "Cluster definition for BGP parameters (ASN, VIP network, FRR peer)."
  placeholder: "ecmp-prod-01"
- name: self_ip
  label: BIG-IP Self-IP
  type: string
  required: true
  description: "Self-IP of the BIG-IP being removed from ECMP."
  placeholder: "10.1.1.11"
  validation_regex: "^\\d+\\.\\d+\\.\\d+\\.\\d+$"
```

## Steps

```yaml
- name: pre_check_bgp
  label: Capture current BGP state
  transport: ssh
  command_template: "echo '=== Current BGP State ==='; imish -e 'show ip bgp summary' 2>&1; echo ''; echo '=== Advertised Networks ==='; imish -e 'show running-config' 2>&1 | grep -A 5 'router bgp'"
  timeout: 15
  description: "Snapshots the current BGP state before making changes."
- name: withdraw_route
  label: Remove VIP network from BGP
  transport: ssh
  command_template: "echo 'Withdrawing {{vip_network}} from BGP AS {{local_asn}}...'; imish -e 'configure terminal' -e 'router bgp {{local_asn}}' -e 'no network {{vip_network}}' -e 'end' -e 'write memory' 2>&1; echo ''; echo '=== Updated BGP Config ==='; imish -e 'show running-config' 2>&1 | grep -A 10 'router bgp'"
  timeout: 15
  description: "Removes the network statement so the BIG-IP stops advertising the VIP route."
  rollback_command: "imish -e 'configure terminal' -e 'router bgp {{local_asn}}' -e 'network {{vip_network}}' -e 'end' -e 'write memory'"
- name: verify_withdrawal
  label: Verify FRR dropped the path
  transport: ssh
  command_template: "echo 'Waiting 10s for BGP convergence...'; sleep 10; echo '=== FRR Route Check ==='; ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 {{frr_user}}@{{frr_ip}} 'vtysh -c \"show ip route {{vip_network}}\"' 2>&1; echo ''; path_count=$(ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 {{frr_user}}@{{frr_ip}} 'vtysh -c \"show ip route {{vip_network}}\"' 2>&1 | grep -c 'via'); echo \"ECMP paths remaining: $path_count\"; if echo \"$path_count\" | grep -qv '{{self_ip}}'; then echo 'VERIFIED: Route from {{self_ip}} withdrawn'; else echo 'WARNING: FRR may still have a route via {{self_ip}}'; fi"
  timeout: 30
  description: "Checks FRR to confirm the route via this BIG-IP's self-IP has been removed from the routing table."
```

## Safety

```yaml
requires_approval: true
max_duration: 90
destructive: true
rollback_enabled: true
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BGP engineer reviewing a route withdrawal for ECMP scale-in.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Withdrawal** — Was the network statement removed from BGP config?
  2. **FRR Verification** — Did the FRR router drop the path via this BIG-IP? How many ECMP paths remain?
  3. **Convergence** — Any signs of slow convergence or stale routes?
  4. **Safety** — Is there at least one ECMP path remaining? (Critical — zero paths = outage)
  5. **Next Steps** — Connections should now be draining to other ECMP members.

  Flag CRITICAL if ECMP path count drops to zero.
```
