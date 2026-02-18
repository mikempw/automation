#!/bin/sh
set -e

INIT_FILE="/vault-init/init-keys.json"
TOKEN_FILE="/vault-init/root-token"
UNSEAL_FILE="/vault-init/unseal-key"

echo "=== Vault Init Script ==="
echo "Waiting for vault to be reachable..."

# Wait for vault API
for i in $(seq 1 30); do
  if wget -q -O /dev/null http://openbao:8200/v1/sys/health?standbyok=true\&sealedcode=200\&uninitcode=200 2>/dev/null; then
    echo "Vault API is reachable."
    break
  fi
  echo "  Attempt $i/30..."
  sleep 2
done

# Check if vault is already initialized
INIT_STATUS=$(wget -q -O - http://openbao:8200/v1/sys/init 2>/dev/null || echo '{"initialized":false}')

if echo "$INIT_STATUS" | grep -q '"initialized":true'; then
  echo "Vault already initialized."

  # Unseal if sealed
  SEAL_STATUS=$(wget -q -O - http://openbao:8200/v1/sys/seal-status 2>/dev/null || echo '{"sealed":true}')
  if echo "$SEAL_STATUS" | grep -q '"sealed":true'; then
    echo "Vault is sealed. Unsealing..."
    if [ -f "$UNSEAL_FILE" ]; then
      UNSEAL_KEY=$(cat "$UNSEAL_FILE")
      wget -q -O /dev/null --post-data="{\"key\":\"$UNSEAL_KEY\"}" \
        --header="Content-Type: application/json" \
        http://openbao:8200/v1/sys/unseal 2>/dev/null
      echo "Unseal command sent."
    else
      echo "ERROR: No unseal key found at $UNSEAL_FILE"
      exit 1
    fi
  else
    echo "Vault is already unsealed."
  fi

else
  echo "Vault not initialized. Initializing with 1 key share, 1 threshold..."

  # Initialize with single key for simplicity
  INIT_RESPONSE=$(wget -q -O - --post-data='{"secret_shares":1,"secret_threshold":1}' \
    --header="Content-Type: application/json" \
    http://openbao:8200/v1/sys/init 2>/dev/null)

  echo "$INIT_RESPONSE" > "$INIT_FILE"

  # Extract unseal key and root token
  UNSEAL_KEY=$(echo "$INIT_RESPONSE" | sed 's/.*"keys":\["//' | sed 's/".*//')
  ROOT_TOKEN=$(echo "$INIT_RESPONSE" | sed 's/.*"root_token":"//' | sed 's/".*//')

  echo "$UNSEAL_KEY" > "$UNSEAL_FILE"
  echo "$ROOT_TOKEN" > "$TOKEN_FILE"

  echo "Root token saved to $TOKEN_FILE"
  echo "Unseal key saved to $UNSEAL_FILE"

  # Unseal
  echo "Unsealing vault..."
  wget -q -O /dev/null --post-data="{\"key\":\"$UNSEAL_KEY\"}" \
    --header="Content-Type: application/json" \
    http://openbao:8200/v1/sys/unseal 2>/dev/null

  # Wait for unseal
  sleep 2

  # Enable KV v2 secrets engine
  echo "Enabling KV v2 secrets engine at secret/..."
  wget -q -O /dev/null --post-data='{"type":"kv","options":{"version":"2"}}' \
    --header="Content-Type: application/json" \
    --header="X-Vault-Token: $ROOT_TOKEN" \
    http://openbao:8200/v1/sys/mounts/secret 2>/dev/null || echo "(may already exist)"

  echo "Vault initialized and configured."
fi

# Verify vault is healthy
sleep 1
HEALTH=$(wget -q -O - http://openbao:8200/v1/sys/health 2>/dev/null || echo "unhealthy")
echo "Vault health: $HEALTH"
echo "=== Vault Init Complete ==="
