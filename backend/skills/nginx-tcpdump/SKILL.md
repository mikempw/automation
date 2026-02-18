---
name: nginx-tcpdump
description: >-
  Run a tcpdump packet capture on an NGINX server to analyze traffic
  between clients and upstream backends. Use for troubleshooting
  connectivity, latency, connection resets, and SSL issues.
metadata:
  product: nginx
  version: "1.0"
  author: F5 Insight
  tags:
    - troubleshooting
    - network
    - packet-capture
---

# nginx-tcpdump

Capture and analyze network traffic on an NGINX server.

## Parameters

```yaml
- name: listen_ip
  label: NGINX Listen IP
  type: ip_address
  required: false
  description: "IP address NGINX is listening on. Filter captures to this address to focus on inbound traffic."
  placeholder: "0.0.0.0"
- name: upstream_ip
  label: Upstream Server IP
  type: ip_address
  required: false
  description: "Upstream backend server IP to filter on. Use when troubleshooting a specific backend."
  placeholder: "10.0.0.50"
- name: port
  label: Port
  type: port
  required: false
  default: "80"
  description: "Port to filter. Common: 80 (HTTP), 443 (HTTPS), 8080 (alt HTTP)."
  placeholder: "80"
- name: interface
  label: Network Interface
  type: string
  required: true
  default: "any"
  description: "Network interface to capture on. Use 'any' for all interfaces, or specify like 'eth0'."
  placeholder: "any"
- name: duration
  label: Capture Duration (seconds)
  type: integer
  required: true
  default: "10"
  description: "How long to capture packets."
  placeholder: "10"
- name: packet_count
  label: Max Packets
  type: integer
  required: true
  default: "100"
  description: "Maximum packets to capture."
  placeholder: "100"
```

## Steps

```yaml
- name: run_capture
  label: Run tcpdump capture
  transport: ssh
  command_template: "timeout {{duration}} tcpdump -nni {{interface}} -c {{packet_count}} -vvv host {{upstream_ip}} and port {{port}} 2>&1 | head -500"
  timeout: 45
  description: "Captures packets filtered by the specified host and port."
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
  You are an NGINX network engineer analyzing a tcpdump capture from an NGINX server.

  **Parameters:** {{params}}

  **Capture Output:**
  ~~~
  {{output}}
  ~~~

  Analyze and provide:
  1. **Traffic Summary** — Connections, source/dest pairs, request patterns.
  2. **Anomalies** — Resets, retransmissions, timeouts, failed handshakes.
  3. **NGINX-Specific** — Client vs upstream issues, proxy behavior, keep-alive patterns.
  4. **Diagnosis** — Likely root cause.
  5. **Next Steps** — NGINX config changes, log checks, additional captures.

  Be concise and direct.
```
