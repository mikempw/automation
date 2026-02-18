---
name: bigip-topology
description: >-
  Collect topology data for a virtual server including iRule source code and
  cross-references (other VS/pools that share the same pool members). Used by
  the Traffic Flow Visualizer to show packet path, iRule processing stages,
  and node relationships. Requires the virtual_server name. Runs read-only
  tmsh commands only.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  chat_hidden: true
  tags:
    - discovery
    - topology
    - visualization
    - internal
---

# bigip-topology

Collect extended topology data for the traffic flow visualizer: iRule source code, pool LB method, and cross-references.

## Parameters

```yaml
- name: virtual_server
  label: Virtual Server Name
  type: string
  required: true
  description: "Name or full path of the virtual server. Example: luke or /Common/luke"
  placeholder: "/Common/my_vs"
```

## Steps

```yaml
- name: vs_overview
  label: Get VS destination, pool, profiles, rules, persistence, snat
  transport: ssh
  command_template: "tmsh list ltm virtual {{virtual_server}} 2>&1"
  timeout: 15
  description: "Full VS config dump — destination, pool, profiles, rules, persistence, SNAT."

- name: pool_detail
  label: Get pool LB method, monitor, member config
  transport: ssh
  command_template: "pool=$(tmsh list ltm virtual {{virtual_server}} pool 2>/dev/null | grep pool | awk '{print $2}'); if [ -n \"$pool\" ]; then echo \"POOL_NAME=$pool\"; tmsh list ltm pool $pool 2>&1; echo '---STATUS---'; tmsh show ltm pool $pool members 2>&1; else echo 'NO_POOL'; fi"
  timeout: 15
  description: "Pool config with LB method, monitor, all members, and member availability status."

- name: irule_source
  label: Get iRule source code for all attached rules
  transport: ssh
  command_template: "rules=$(tmsh list ltm virtual {{virtual_server}} rules 2>/dev/null | grep -v '{\\|}\\|rules' | awk '{print $1}' | tr -d ' '); if [ -n \"$rules\" ]; then for r in $rules; do echo \"===IRULE:${r}===\"; tmsh list ltm rule $r 2>&1; echo '===END===' ; done; else echo 'NO_IRULES'; fi"
  timeout: 15
  description: "Source code for every iRule attached to this VS."

- name: vs_stats
  label: Get VS and pool live statistics
  transport: ssh
  command_template: "echo '===VS_STATS==='; tmsh show ltm virtual {{virtual_server}} 2>&1 | head -30; pool=$(tmsh list ltm virtual {{virtual_server}} pool 2>/dev/null | grep pool | awk '{print $2}'); if [ -n \"$pool\" ]; then echo '===POOL_STATS==='; tmsh show ltm pool $pool 2>&1 | head -20; fi"
  timeout: 15
  description: "Live stats — availability, current connections, throughput."

- name: cross_references
  label: Find other VS that share pool members
  transport: ssh
  command_template: "pool=$(tmsh list ltm virtual {{virtual_server}} pool 2>/dev/null | grep pool | awk '{print $2}'); if [ -n \"$pool\" ]; then members=$(tmsh list ltm pool $pool members 2>/dev/null | grep -oE '([0-9]+\\.){3}[0-9]+' | sort -u); for addr in $members; do echo \"===NODE:${addr}===\"; tmsh list ltm pool members 2>/dev/null | grep -B1 \"$addr\" | grep 'ltm pool' | awk '{print $3}' | sort -u | head -10; done; echo '===ALL_VS_POOLS==='; tmsh list ltm virtual destination pool 2>&1 | grep -E 'ltm virtual|destination|pool' | paste - - - 2>/dev/null | head -100; else echo 'NO_POOL'; fi"
  timeout: 20
  description: "Finds other pools containing the same node addresses, then maps those pools to their VS."
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
  You are an F5 BIG-IP traffic flow analyst. You must produce a JSON topology structure from the raw tmsh output below.

  **Virtual Server:** {{params}}

  **Raw Output:**
  ~~~
  {{output}}
  ~~~

  Analyze ALL iRule TCL code carefully. For each iRule, trace every possible packet path through every event handler (when block). Identify conditions, branches, modifications, and terminal actions.

  Respond with ONLY a valid JSON object — no markdown, no backticks, no explanation. Use this exact structure:

  {
    "virtualServer": {
      "name": "vs-name",
      "destination": "ip:port",
      "ip": "1.2.3.4",
      "port": 80,
      "protocol": "tcp",
      "status": "available|offline|unknown",
      "statusReason": "",
      "profiles": ["http", "tcp", "clientssl"],
      "snat": "automap|none|snatpool-name",
      "persistence": "cookie|source_addr|etc or empty string",
      "connections": 0,
      "bitsIn": 0,
      "bitsOut": 0
    },
    "pool": {
      "name": "pool-name",
      "lbMethod": "round-robin",
      "monitor": "http",
      "status": "available|offline",
      "members": [
        {
          "address": "10.0.0.1",
          "port": 80,
          "name": "node-01",
          "status": "available|offline|forced-offline",
          "connections": 0,
          "priority": 0,
          "ratio": 1
        }
      ]
    },
    "irules": [
      {
        "name": "irule-name",
        "code": "full TCL source",
        "events": [
          {
            "event": "HTTP_REQUEST",
            "description": "What this event handler does overall",
            "conditions": [
              {
                "check": "Human-readable condition, e.g. URI starts with /api",
                "tcl": "The actual TCL expression",
                "trueBranch": {
                  "action": "pool_select|redirect|respond|header_modify|log|persist|forward",
                  "detail": "pool api_pool OR redirect https://... OR respond 429 OR insert header X-Foo",
                  "targetPool": "api_pool (if action is pool_select, else null)",
                  "responseCode": 302 (if redirect/respond, else null),
                  "modifiedHeaders": [{"op": "insert|replace|remove", "name": "X-Forwarded-For", "value": "[IP::client_addr]"}]
                },
                "falseBranch": {
                  "action": "forward|fallthrough",
                  "detail": "Falls through to next condition or default pool"
                }
              }
            ],
            "unconditionalActions": [
              {
                "action": "header_modify|log|persist",
                "detail": "Description of what happens unconditionally",
                "modifiedHeaders": []
              }
            ],
            "canBlock": true,
            "canRedirect": false,
            "canSelectPool": true,
            "packetModifications": ["Inserts X-Forwarded-For header", "May return 429 if rate exceeded"]
          }
        ]
      }
    ],
    "otherAttachments": {
      "10.0.0.1:80": [
        {"vs": "other-vs-name", "pool": "other-pool-name"}
      ]
    }
  }

  IMPORTANT RULES:
  - Parse the ACTUAL iRule TCL code. Do not guess or invent logic.
  - Every if/elseif/else/switch branch must be represented as a condition.
  - Port names like "http" = 80, "https" = 443.
  - If member status says "down" or "offline", set status to "offline".
  - If session is "user-disabled", set status to "forced-offline".
  - For cross_references: map node addresses to other pools and their parent VS.
  - Respond with ONLY the JSON. No other text.
```
