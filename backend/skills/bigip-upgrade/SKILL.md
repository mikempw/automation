---
name: bigip-upgrade
description: >-
  Install a pre-staged software image to a boot volume and optionally reboot.
  The ISO must already be on the BIG-IP in /shared/images/. Run bigip-boot-locations
  first to identify the target volume and confirm the image is staged.
  This is a high-risk operation — always upgrade standby units first in HA pairs.
metadata:
  product: bigip
  version: "1.0"
  author: F5 Insight
  tags:
    - upgrade
    - maintenance
    - destructive
---

# bigip-upgrade

Install a software image and reboot to a new volume.

## Parameters

```yaml
- name: image_name
  label: Software Image Name
  type: string
  required: true
  description: "Name of the imported software image (not the ISO filename). Run 'tmsh list sys software image' to see available images. Example: BIGIP-17.5.2.0.0.3"
  placeholder: "BIGIP-17.5.2.0.0.3"
- name: target_volume
  label: Target Boot Volume
  type: string
  required: true
  description: "Volume to install to. Must be the INACTIVE volume. Example: HD1.2"
  placeholder: "HD1.2"
- name: reboot
  label: Reboot after install?
  type: select
  required: true
  description: "If 'yes', device reboots to the new volume after install completes. If 'no', image is installed but device stays on current version until manually rebooted."
  options:
    - "no"
    - "yes"
```

## Steps

```yaml
- name: preflight_version
  label: Verify current version and target volume
  transport: ssh
  command_template: "echo '=== Current Version ==='; tmsh show sys version 2>&1 | head -10; echo ''; echo '=== Software Status ==='; tmsh show sys software status 2>&1; echo ''; echo '=== Target Volume: {{target_volume}} ===';"
  timeout: 15
  description: "Confirms the current running version and shows all volume states."
- name: preflight_ha
  label: Check HA status
  transport: ssh
  command_template: "echo '=== Failover Status ==='; tmsh show cm failover-status 2>&1"
  timeout: 15
  continue_on_fail: true
  description: "Warns if this is the active unit in an HA pair."
- name: preflight_image
  label: Verify image is available
  transport: ssh
  command_template: "echo '=== Checking for image {{image_name}} ==='; tmsh list sys software image {{image_name}} 2>&1; rc=$?; if [ $rc -ne 0 ]; then echo 'ERROR: Image {{image_name}} not found. Stage the ISO in /shared/images/ and import it first.'; echo ''; echo '=== Available images ==='; tmsh list sys software image 2>&1; exit 1; fi"
  timeout: 15
  description: "Confirms the specified image exists in the software management system. Fails early if not found."
- name: create_backup
  label: Create UCS backup before upgrade
  transport: ssh
  command_template: "name=\"pre-upgrade-$(date +%Y%m%d-%H%M%S)\"; echo \"Creating backup: ${name}.ucs\"; output=$(tmsh save sys ucs ${name} 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Backup failed\"; exit 1; else echo \"Backup saved: /var/local/ucs/${name}.ucs\"; fi"
  timeout: 120
  description: "Creates a UCS backup before making any changes. This is your rollback safety net."
- name: install_image
  label: Install image to target volume
  transport: ssh
  command_template: "echo 'Installing {{image_name}} to volume {{target_volume}}...'; echo 'This may take 15-30 minutes.'; output=$(tmsh install sys software image {{image_name}} volume {{target_volume}} 2>&1); rc=$?; echo \"$output\"; if [ $rc -ne 0 ]; then echo \"ERROR: Install failed (exit code $rc)\"; exit 1; else echo 'Install command accepted. Monitoring progress...'; fi"
  timeout: 60
  description: "Initiates the software installation. The install runs in the background on the BIG-IP."
- name: wait_for_install
  label: Wait for installation to complete
  transport: ssh
  command_template: "echo 'Polling install status (this step waits up to 20 minutes)...'; for i in $(seq 1 60); do status=$(tmsh show sys software status 2>&1); echo \"--- Check $i/60 ($(date +%H:%M:%S)) ---\"; echo \"$status\" | grep '{{target_volume}}'; if echo \"$status\" | grep '{{target_volume}}' | grep -qi 'complete'; then echo 'INSTALL COMPLETE'; exit 0; fi; if echo \"$status\" | grep '{{target_volume}}' | grep -qi 'failed'; then echo 'INSTALL FAILED'; exit 1; fi; sleep 20; done; echo 'TIMEOUT: Install did not complete within 20 minutes. Check manually with: tmsh show sys software status'; exit 1"
  timeout: 1260
  description: "Polls the install status every 20 seconds for up to 20 minutes until the volume shows complete or failed."
- name: reboot_to_volume
  label: Reboot to new volume (if requested)
  transport: ssh
  command_template: "if [ '{{reboot}}' = 'yes' ]; then echo 'REBOOTING to volume {{target_volume}} in 5 seconds...'; echo 'Device will be unreachable for 5-10 minutes.'; sleep 5; tmsh reboot volume {{target_volume}} 2>&1; else echo 'Reboot skipped (reboot=no). Image installed to {{target_volume}} but device remains on current volume.'; echo 'To reboot manually: tmsh reboot volume {{target_volume}}'; fi"
  timeout: 30
  description: "Reboots to the new volume if requested. The SSH connection will drop during reboot — this is expected."
  rollback_command: "echo 'To rollback: reboot to previous volume with tmsh reboot volume HD1.1'"
```

## Safety

```yaml
requires_approval: true
max_duration: 1800
destructive: true
rollback_enabled: true
```

## Analysis

```yaml
enabled: true
model: claude-sonnet-4-20250514
prompt_template: |
  You are an F5 BIG-IP upgrade engineer reviewing an upgrade operation.

  **Parameters:** {{params}}

  **Output:**
  ~~~
  {{output}}
  ~~~

  Provide a status report:
  1. **Pre-flight** — Was the HA check clean? Was the image found? Was a backup created?
  2. **Installation** — Did the install complete successfully? How long did it take?
  3. **Reboot** — Was a reboot performed? If so, note that we lost SSH connection (expected).
  4. **Next steps** — If rebooted: user should verify the device came back up on the new version. If not rebooted: remind them the new version isn't active yet.
  5. **Rollback instructions** — If anything went wrong, provide the command to reboot back to the previous volume.
```
