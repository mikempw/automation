---
name: nginx-upstream-health
description: >-
  Check NGINX upstream server health and connectivity. Tests backend
  servers from the NGINX host perspective using curl and connection checks.
  Use when investigating upstream failures or load balancing issues.
metadata:
  product: nginx
  version: "1.0"
  author: F5 Insight
  tags:
    - troubleshooting
    - upstream
    - health-check
---

# nginx-upstream-health

Check NGINX upstream backend health from the NGINX server.

## Parameters

```yaml
- name: upstream_host
  label: Upstream Host
  type: string
  required: true
  description: "Upstream server hostname or IP to check. This should match what's in your upstream block."
  placeholder: "10.0.0.50"
- name: upstream_port
  label: Upstream Port
  type: port
  required: true
  default: "80"
  description: "Port the upstream is listening on."
  placeholder: "80"
- name: health_path
  label: Health Check Path
  type: string
  required: false
  default: "/"
  description: "URL path to request for the health check. Use your app's health endpoint if available."
  placeholder: "/health"
- name: nginx_config_path
  label: NGINX Config Path
  type: string
  required: false
  default: "/etc/nginx/nginx.conf"
  description: "Path to the main NGINX config to inspect upstream definitions."
  placeholder: "/etc/nginx/nginx.conf"
```

## Steps

```yaml
- name: curl_upstream
  label: Test upstream with curl
  transport: ssh
  command_template: "curl -sv --connect-timeout 5 --max-time 10 http://{{upstream_host}}:{{upstream_port}}{{health_path}} 2>&1"
  timeout: 15
  description: "Makes an HTTP request to the upstream server to check if it's responding."
- name: tcp_check
  label: TCP connectivity check
  transport: ssh
  command_template: "timeout 5 bash -c 'echo > /dev/tcp/{{upstream_host}}/{{upstream_port}} && echo CONNECTED || echo FAILED' 2>&1"
  timeout: 10
  description: "Tests raw TCP connectivity to the upstream."
- name: show_upstream_config
  label: Show upstream configuration
  transport: ssh
  command_template: "grep -A 20 'upstream' {{nginx_config_path}} 2>/dev/null || grep -rA 20 'upstream' /etc/nginx/conf.d/ 2>/dev/null | head -60"
  timeout: 10
  description: "Shows the upstream block configuration from NGINX."
- name: nginx_status
  label: Check NGINX process status
  transport: ssh
  command_template: "nginx -t 2>&1 && systemctl status nginx --no-pager 2>/dev/null || service nginx status 2>/dev/null || echo 'Unable to check status'"
  timeout: 10
  description: "Validates NGINX config and checks process status."
```

## Safety

```yaml
requires_approval: false
max_duration: 30
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an NGINX engineer checking upstream health.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Connectivity Status** — Can NGINX reach the upstream?
  2. **Response Analysis** — HTTP status, response time, any errors.
  3. **Config Review** — Is the upstream config correct?
  4. **Recommendations** — Fixes for any issues found.

  Be concise.
```
