---
name: bigip-connection-drain
description: >-
  Monitor and wait for active connections to drain on a BIG-IP VE before
  deprovisioning. Polls the connection table at regular intervals until
  the connection count drops below a configurable threshold or a timeout
  is reached. Read-only — does not modify any configuration.
  Used as step 2 of the ECMP Scale-In chain.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - autoscale
    - drain
    - monitoring
    - ecmp
---

# bigip-connection-drain

Wait for active connections to drain below a threshold.

## Parameters

```yaml
- name: threshold
  label: Connection Threshold
  type: integer
  required: false
  default: "10"
  description: "Consider drained when connection count drops below this number. Default 10."
  placeholder: "10"
- name: timeout_minutes
  label: Drain Timeout (minutes)
  type: integer
  required: false
  default: "10"
  description: "Maximum time to wait for drain. After this, proceed anyway. Default 10 minutes."
  placeholder: "10"
- name: poll_interval
  label: Poll Interval (seconds)
  type: integer
  required: false
  default: "15"
  description: "How often to check connection count. Default 15 seconds."
  placeholder: "15"
```

## Steps

```yaml
- name: initial_count
  label: Check initial connection count
  transport: ssh
  command_template: "echo '=== Initial Connection State ==='; echo 'Server-side connections:'; tmsh show sys connection count 2>&1; echo ''; echo 'Active VS connections:'; tmsh show ltm virtual 2>&1 | grep -E 'Ltm::Virtual|Availability|Current' | head -30"
  timeout: 15
  description: "Captures the starting connection count before drain monitoring begins."
- name: wait_for_drain
  label: Monitor connection drain
  transport: ssh
  command_template: "threshold={{threshold}}; timeout_min={{timeout_minutes}}; interval={{poll_interval}}; max_checks=$(( (timeout_min * 60) / interval )); echo \"Monitoring drain: threshold=$threshold, timeout=${timeout_min}min, poll=${interval}s\"; echo \"Max checks: $max_checks\"; for i in $(seq 1 $max_checks); do count=$(tmsh show sys connection count 2>/dev/null | grep 'Server Connections' | awk '{print $NF}' || echo '0'); count=${count:-0}; echo \"  Check $i/$max_checks — connections: $count ($(date +%H:%M:%S))\"; if [ \"$count\" -lt \"$threshold\" ] 2>/dev/null; then echo \"DRAINED: Connection count ($count) below threshold ($threshold)\"; exit 0; fi; sleep $interval; done; final=$(tmsh show sys connection count 2>/dev/null | grep 'Server Connections' | awk '{print $NF}'); echo \"TIMEOUT: Drain did not complete within ${timeout_min} minutes. Current: $final connections.\"; echo 'Proceeding with remaining connections — new traffic is already going elsewhere via BGP withdrawal.'; exit 0"
  timeout: 660
  description: "Polls connection count every poll_interval seconds until below threshold or timeout. Exits 0 even on timeout since BGP withdrawal already diverted new traffic."
- name: final_state
  label: Final connection state
  transport: ssh
  command_template: "echo '=== Final Connection State ==='; tmsh show sys connection count 2>&1; echo ''; echo 'Remaining connections by VS:'; tmsh show ltm virtual 2>&1 | grep -E 'Ltm::Virtual|Current' | head -20"
  timeout: 15
  description: "Captures the final connection state after drain completes or times out."
```

## Safety

```yaml
requires_approval: false
max_duration: 720
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 operations engineer reviewing a connection drain operation for ECMP scale-in.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide:
  1. **Drain Result** — Did connections drop below the threshold? How long did it take?
  2. **Starting vs Ending** — Initial and final connection counts.
  3. **Timeout** — If drain timed out, how many connections remain? Is this safe to proceed?
  4. **Recommendation** — Safe to proceed with deprovisioning, or should we wait longer?

  Be concise.
```
