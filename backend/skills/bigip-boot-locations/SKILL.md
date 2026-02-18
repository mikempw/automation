---
name: bigip-boot-locations
description: >-
  Show BIG-IP software boot locations, installed images, active volume,
  disk space, and HA status. Use before an upgrade to understand the
  current state and identify the target install volume.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - discovery
    - upgrade
    - maintenance
---

# bigip-boot-locations

Discover boot locations, installed software, and disk space before an upgrade.

## Parameters

```yaml
- name: placeholder
  label: No parameters needed
  type: string
  required: false
  description: "This skill takes no input. Leave empty."
  default: ""
```

## Steps

```yaml
- name: boot_locations
  label: Show boot locations and active volume
  transport: ssh
  command_template: "echo '=== Boot Locations ==='; tmsh show sys software status 2>&1"
  timeout: 15
  description: "Shows all volumes (HD1.1, HD1.2, etc.), which is active, and what version is installed on each."
- name: available_images
  label: List staged images
  transport: ssh
  command_template: "echo '=== Staged Images in /shared/images ==='; ls -lh /shared/images/*.iso 2>/dev/null || echo 'No ISO files staged'; echo ''; echo '=== Imported Software Images ==='; tmsh list sys software image 2>&1"
  timeout: 15
  description: "Shows ISO files on disk and images imported into the software management system."
- name: disk_space
  label: Check disk space
  transport: ssh
  command_template: "echo '=== Disk Usage ==='; df -h /shared/images 2>&1; echo ''; echo '=== Volume Sizes ==='; tmsh show sys disk logical-disk 2>&1"
  timeout: 15
  description: "Checks available disk space for image staging and installation."
- name: ha_status
  label: Check HA failover status
  transport: ssh
  command_template: "echo '=== HA Status ==='; tmsh show cm failover-status 2>&1; echo ''; echo '=== Sync Status ==='; tmsh show cm sync-status 2>&1"
  timeout: 15
  continue_on_fail: true
  description: "Shows HA pair status. Critical to know if this is the active or standby unit before upgrading."
- name: running_config_saved
  label: Check if config is saved
  transport: ssh
  command_template: "echo '=== Last Config Save ==='; ls -la /config/bigip.conf 2>&1; echo ''; echo '=== UCS Backups ==='; ls -lht /var/local/ucs/*.ucs 2>/dev/null | head -5 || echo 'No UCS backups found'"
  timeout: 15
  description: "Verifies config was recently saved and shows available UCS backups."
```

## Safety

```yaml
requires_approval: false
max_duration: 60
destructive: false
rollback_enabled: false
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP upgrade planning engineer.

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide an upgrade readiness assessment:
  1. **Current state** — Active volume, running version, standby volume availability
  2. **Target volume** — Which volume should the new image be installed to (the inactive one)
  3. **Staged images** — Are any upgrade ISOs already on the box? List them.
  4. **Disk space** — Enough room for a new image? (need ~4GB minimum)
  5. **HA status** — Is this active or standby? WARN if active — should upgrade standby first.
  6. **Backup status** — When was the last config save? Is there a recent UCS?
  7. **Recommendation** — Ready to upgrade or not? What needs to happen first?
```
