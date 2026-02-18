---
name: bigip-config-backup
description: >-
  Create a UCS (User Configuration Set) backup archive on a BIG-IP device.
  Saves the full running configuration including certs, keys, and license.
  Use before making major changes or for disaster recovery.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags: [configuration, backup, maintenance]
---

# bigip-config-backup

Save a UCS configuration backup archive.

## Parameters

```yaml
- name: backup_name
  label: Backup Name
  type: string
  required: false
  description: "Name for the UCS file. Defaults to hostname-timestamp. Do not include .ucs extension."
  placeholder: "pre-change-backup"
```

## Steps

```yaml
- name: list_existing
  label: List existing backups
  transport: ssh
  command_template: "echo '=== Existing UCS Archives ==='; ls -lh /var/local/ucs/ 2>&1 || echo 'No existing backups'"
  timeout: 15
  continue_on_fail: true
  description: "Shows existing UCS files before creating a new one."
- name: create_backup
  label: Create UCS backup
  transport: ssh
  command_template: "name='{{backup_name}}'; if [ -z \"$name\" ]; then name=\"backup-$(date +%Y%m%d-%H%M%S)\"; fi; echo \"Creating UCS: ${name}.ucs\"; output=$(tmsh save sys ucs ${name} 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Backup failed (exit code $rc)\"; exit 1; else echo \"Backup saved: /var/local/ucs/${name}.ucs\"; fi"
  timeout: 120
  description: "Creates the UCS archive. Can take a minute on large configs."
- name: verify_backup
  label: Verify backup file
  transport: ssh
  command_template: "echo '=== Backup Verification ==='; ls -lh /var/local/ucs/*.ucs 2>&1 | tail -5"
  timeout: 15
  description: "Confirms the backup file was created and shows its size."
```

## Safety

```yaml
requires_approval: true
max_duration: 180
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP engineer reviewing a configuration backup.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Confirm: 1) Was the backup created successfully? 2) File name and size. 3) How many backups exist now — recommend cleanup if excessive. Be concise.
```
