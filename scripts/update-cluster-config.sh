#!/bin/bash
# Update ecmp-prod-01 cluster config with license pool and Proxmox SSH creds
# Run from the Docker host (192.168.3.48) or wherever the Insight API is reachable
#
# EDIT the regkeys below with your actual F5 registration keys before running!

INSIGHT_API="http://localhost:8000"
CLUSTER_ID="ecmp-prod-01"

echo "=== Updating cluster config: $CLUSTER_ID ==="

# First, get current config
echo "Fetching current config..."
CURRENT=$(curl -s "$INSIGHT_API/api/clusters/$CLUSTER_ID")
if echo "$CURRENT" | grep -q '"detail"'; then
    echo "ERROR: Cluster not found. Create it first."
    exit 1
fi

# Update with license pool and Proxmox SSH credentials
# EDIT THESE REGKEYS with your actual keys!
echo "Updating with license pool and Proxmox SSH creds..."
curl -s -X PUT "$INSIGHT_API/api/clusters/$CLUSTER_ID" \
    -H "Content-Type: application/json" \
    -d '{
  "license_pool": [
    {"regkey": "XXXXX-XXXXX-XXXXX-XXXXX-XXXXXXX", "status": "available"},
    {"regkey": "YYYYY-YYYYY-YYYYY-YYYYY-YYYYYYY", "status": "available"}
  ],
  "proxmox": {
    "host": "192.168.100.6",
    "port": 8006,
    "node": "threadripper",
    "token_id": "root@pam!insight",
    "token_secret": "015321a6-2d2b-46ab-95fe-d3d3c99c0ef7",
    "template_vmid": 198,
    "vmid_range_start": 110,
    "vmid_range_end": 128,
    "cores": 2,
    "memory_mb": 8192,
    "ssh_user": "root",
    "ssh_pass": "YOUR_PROXMOX_ROOT_PASSWORD"
  }
}' | python3 -m json.tool

echo ""
echo "=== Verify ==="
curl -s "$INSIGHT_API/api/clusters/$CLUSTER_ID/params" | python3 -m json.tool
echo ""
echo "=== License Pool Status ==="
curl -s "$INSIGHT_API/api/clusters/$CLUSTER_ID/license-pool" | python3 -m json.tool

echo ""
echo "REMINDERS:"
echo "  1. Edit this script with your actual regkeys before running"
echo "  2. Set the Proxmox root SSH password"
echo "  3. Update template_vmid to 198 after template cleanup"
echo "  4. Verify Proxmox SSH from backend container: docker compose exec backend ssh root@192.168.100.6 'hostname'"
