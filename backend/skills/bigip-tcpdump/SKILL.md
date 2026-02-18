---
name: bigip-tcpdump
description: >-
  Run a tcpdump packet capture on a BIG-IP device and analyze the results.
  Use for troubleshooting connectivity issues, SSL/TLS handshake failures,
  connection resets, timeouts, and traffic flow analysis between clients,
  virtual servers, and pool members.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - troubleshooting
    - network
    - packet-capture
---

# bigip-tcpdump

Run a tcpdump packet capture on a BIG-IP device and analyze the results for connectivity, SSL/TLS, and traffic flow issues.

## Parameters

```yaml
- name: vip
  label: Virtual Server IP
  type: ip_address
  required: false
  description: "IP address of the virtual server to filter traffic on. Found via: tmsh list ltm virtual | grep destination"
  placeholder: "10.1.20.100"
- name: pool_member
  label: Pool Member IP
  type: ip_address
  required: false
  description: "IP address of a specific pool member to filter on. Use when troubleshooting a single backend server."
  placeholder: "10.1.10.10"
- name: port
  label: Port
  type: port
  required: false
  default: "443"
  description: "Port number to filter. Common values: 443 (HTTPS), 80 (HTTP), 53 (DNS)."
  placeholder: "443"
- name: interface
  label: Capture Interface
  type: select
  required: true
  default: "0.0:nnnp"
  description: "BIG-IP interface to capture on. Use 0.0:nnnp to see both client-side and server-side traffic with pseudo headers. Use a specific VLAN name to capture on that VLAN only."
  options:
    - "0.0:nnnp"
    - "0.0"
    - "external"
    - "internal"
- name: duration
  label: Capture Duration (seconds)
  type: integer
  required: true
  default: "10"
  description: "How long to capture packets. Keep short (5-15s) to avoid hangs. The capture stops when duration OR max packets is reached, whichever comes first."
  placeholder: "10"
- name: packet_count
  label: Max Packets
  type: integer
  required: true
  default: "100"
  description: "Maximum number of packets to capture. Acts as a safety limit. Lower values return faster."
  placeholder: "100"
- name: protocol
  label: Protocol Filter
  type: select
  required: false
  default: "tcp"
  description: "Protocol to filter. Use 'tcp' for most HTTP/HTTPS troubleshooting, 'udp' for DNS."
  options:
    - "tcp"
    - "udp"
    - "icmp"
```

## Steps

```yaml
- name: run_capture
  label: Run tcpdump capture
  transport: ssh
  command_template: "filter=''; [ -n '{{vip}}' ] && filter=\"host {{vip}}\"; [ -n '{{pool_member}}' ] && { [ -n \"$filter\" ] && filter=\"$filter or host {{pool_member}}\" || filter=\"host {{pool_member}}\"; }; [ -n '{{port}}' ] && { [ -n \"$filter\" ] && filter=\"$filter and port {{port}}\" || filter=\"port {{port}}\"; }; [ -n '{{protocol}}' ] && { [ -n \"$filter\" ] && filter=\"{{protocol}} and $filter\" || filter=\"{{protocol}}\"; }; echo \"Filter: $filter\"; echo \"Duration: {{duration}}s | Max packets: {{packet_count}}\"; echo '---'; timeout {{duration}} tcpdump -nni {{interface}} -c {{packet_count}} -vvs0 $filter 2>&1 | head -500; echo ''; echo 'Capture complete.'"
  timeout: 45
  description: "Executes tcpdump with filters on the BIG-IP. Output is limited to 500 lines to prevent excessive data."
  rollback_command: "pkill -f 'tcpdump' || true"
```

## Safety

```yaml
requires_approval: true
max_duration: 60
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an expert F5 BIG-IP network engineer analyzing a tcpdump packet capture.

  **User Parameters:**
  {{params}}

  **Raw Capture Output:**
  ~~~
  {{output}}
  ~~~

  Analyze this capture and provide:

  ## Traffic Summary
  What traffic patterns do you see? Connection counts, source/destination pairs, protocols.

  ## Anomalies Detected
  Any resets (RST), retransmissions, timeouts, half-open connections, TLS alerts, or unexpected flags.

  ## F5-Specific Observations
  - Client-side vs server-side: is the problem before or after the BIG-IP?
  - SNAT/NAT behavior — are source IPs what you'd expect?
  - Load balancing distribution across pool members
  - SSL/TLS handshake issues if applicable
  - Connection persistence patterns

  ## Diagnosis
  Based on the user's parameters and capture data, what's the likely root cause?

  ## Recommended Next Steps
  Specific actions: config changes, additional captures, log checks, tmsh commands to run.

  Be concise and direct. Lead with the most important finding.
```
