#!/bin/bash
# Template Cleanup Script for BIG-IP VE Template (VM 199)
# Run this ON the BIG-IP template VM via SSH (root@<template-ip>)
# After running, shut down the VM and convert to template in Proxmox.
#
# Usage:
#   1. Clone VM 199 → VM 198 in Proxmox
#   2. Boot VM 198
#   3. SSH to VM 198: ssh root@<dhcp-ip>
#   4. Run this script
#   5. Power off: shutdown -h now
#   6. In Proxmox: convert VM 198 to template
#   7. Update cluster config: template_vmid: 198
#
# What this strips:
#   - All self-IPs (prevents IP conflicts with master)
#   - BGP config (prevents stale peering sessions)
#   - All non-default VLANs (replica creates its own)
#   - Hostname (reset to generic)
#   - Management IP (enable DHCP so clone gets a discoverable IP)

set -e
echo "=== BIG-IP Template Cleanup ==="

echo "1. Deleting all self-IPs..."
tmsh delete net self all 2>/dev/null || echo "   No self-IPs to delete"

echo "2. Removing BGP configuration..."
imish -e "enable" -e "configure terminal" -e "no router bgp 65001" -e "end" -e "write memory" 2>/dev/null || echo "   No BGP config to remove"

echo "3. Disabling BGP routing protocol on route-domain 0..."
tmsh modify net route-domain 0 routing-protocol delete { BGP } 2>/dev/null || echo "   BGP not in routing-protocol list"

echo "4. Deleting VLANs..."
tmsh delete net vlan bgp_peering 2>/dev/null || echo "   No bgp_peering VLAN"
tmsh delete net vlan client_vlan 2>/dev/null || echo "   No client_vlan VLAN"

echo "5. Resetting hostname..."
tmsh modify sys global-settings hostname localhost.localdomain

echo "6. Enabling DHCP on management..."
tmsh modify sys db dhclient.mgmt value enable

echo "7. Deleting management IP (will use DHCP on next boot)..."
tmsh delete sys management-ip all 2>/dev/null || echo "   No management IPs to delete"

echo "8. Deleting management routes..."
tmsh delete sys management-route all 2>/dev/null || echo "   No management routes to delete"

echo "9. Saving config..."
tmsh save sys config

echo ""
echo "=== Template cleanup complete ==="
echo "Next steps:"
echo "  1. Power off: shutdown -h now"
echo "  2. Convert to template in Proxmox UI"
echo "  3. Update cluster config template_vmid to this VM's ID"
