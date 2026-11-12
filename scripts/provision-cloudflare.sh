#!/usr/bin/env bash
# Run in Codespaces only. Never paste keys/tokens into chat or commit them.
set -euo pipefail
cd /workspaces/LR/cloudflare
SECRET_DIR="$HOME/.jlr-secrets"
test -f "$SECRET_DIR/private.pem" || { echo "Missing local private key"; exit 1; }
test -f "$SECRET_DIR/tokens.json" || { echo "Missing authorized tokens.json"; exit 1; }
echo "Authenticate Wrangler to the same Cloudflare account as garage-monitor."
if ! npx --yes wrangler@latest whoami 2>&1 | grep -q 'Account ID'; then
  echo "Cloudflare login required. Execute: npx --yes wrangler@latest login --device --browser=false"
  echo "Then re-run this script after successful login."
  exit 1
fi
echo "Cloudflare authentication detected; verify the account shown by Wrangler:"
npx --yes wrangler@latest whoami
echo "Uploading secrets to existing garage-monitor Worker..."
npx --yes wrangler@latest secret put JLR_PRIVATE_KEY --name garage-monitor < "$SECRET_DIR/private.pem"
node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.jlr-secrets/device-flow.json","utf8")).clientId)' | npx --yes wrangler@latest secret put JLR_CLIENT_ID --name garage-monitor
node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.jlr-secrets/tokens.json","utf8")).refresh_token)' | npx --yes wrangler@latest secret put JLR_REFRESH_TOKEN --name garage-monitor
if [ ! -f "$SECRET_DIR/garage-vault-key.txt" ]; then
 node -e 'require("fs").writeFileSync(process.env.HOME+"/.jlr-secrets/garage-vault-key.txt",require("crypto").randomBytes(32).toString("base64"),{mode:0o600,flag:"wx"})'
fi
npx --yes wrangler@latest secret put JLR_VAULT_KEY --name garage-monitor < "$SECRET_DIR/garage-vault-key.txt"
if [ ! -f "$SECRET_DIR/garage-admin-token.txt" ]; then
 node -e 'require("fs").writeFileSync(process.env.HOME+"/.jlr-secrets/garage-admin-token.txt",require("crypto").randomBytes(32).toString("base64url"),{mode:0o600,flag:"wx"})'
fi
npx --yes wrangler@latest secret put GARAGE_API_TOKEN --name garage-monitor < "$SECRET_DIR/garage-admin-token.txt"
read -r -s -p "Range Rover VIN (hidden, never logged): " VIN
echo
if [[ ! "$VIN" =~ ^[A-HJ-NPR-Z0-9]{17}$ ]]; then echo "Invalid VIN"; exit 1; fi
printf '%s' "$VIN" | npx --yes wrangler@latest secret put JLR_VIN --name garage-monitor
unset VIN
echo "Secrets saved. DO NOT delete Codespaces yet. Ask for verification before enabling ingestion."
