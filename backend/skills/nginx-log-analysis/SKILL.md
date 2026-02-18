---
name: nginx-log-analysis
description: >-
  Grep and analyze NGINX access and error logs for troubleshooting.
  Use when investigating HTTP errors, upstream failures, slow responses,
  or specific request patterns.
metadata:
  product: nginx
  version: "1.0"
  author: F5 Insight
  tags:
    - troubleshooting
    - logs
---

# nginx-log-analysis

Analyze NGINX access and error logs for issues.

## Parameters

```yaml
- name: error_log_path
  label: Error Log Path
  type: string
  required: true
  default: "/var/log/nginx/error.log"
  description: "Path to the NGINX error log. Check your nginx.conf for the actual path."
  placeholder: "/var/log/nginx/error.log"
- name: access_log_path
  label: Access Log Path
  type: string
  required: true
  default: "/var/log/nginx/access.log"
  description: "Path to the NGINX access log."
  placeholder: "/var/log/nginx/access.log"
- name: grep_pattern
  label: Search Pattern
  type: string
  required: false
  description: "Optional grep pattern to filter logs. Examples: '502', 'upstream timed out', a specific URL path."
  placeholder: "502|503|upstream"
- name: lines
  label: Number of Lines
  type: integer
  required: true
  default: "100"
  description: "Number of recent log lines to retrieve."
  placeholder: "100"
```

## Steps

```yaml
- name: error_log
  label: Check error log
  transport: ssh
  command_template: "tail -n {{lines}} {{error_log_path}} | grep -iE '{{grep_pattern}}' 2>/dev/null || tail -n {{lines}} {{error_log_path}}"
  timeout: 15
  description: "Retrieves recent error log entries, optionally filtered."
- name: access_log_errors
  label: Check access log for errors
  transport: ssh
  command_template: "tail -n {{lines}} {{access_log_path}} | awk '$9 >= 400 {print}' | tail -50"
  timeout: 15
  description: "Shows recent 4xx and 5xx responses from the access log."
- name: status_summary
  label: HTTP status code summary
  transport: ssh
  command_template: "tail -n 1000 {{access_log_path}} | awk '{print $9}' | sort | uniq -c | sort -rn | head -20"
  timeout: 15
  description: "Counts HTTP status codes from recent access log entries."
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
  You are an NGINX engineer analyzing log output.

  **Parameters:** {{params}}

  **Log Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Error Summary** — What errors are occurring? How frequently?
  2. **Root Cause** — Most likely cause of the errors.
  3. **Upstream Issues** — Any upstream timeout, connection refused, or 502/503 patterns?
  4. **Recommendations** — NGINX config changes, upstream fixes, or further investigation.

  Be concise and actionable.
```
