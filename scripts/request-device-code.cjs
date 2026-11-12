// Request a JLR user code without printing or committing sensitive device_code or PKCE verifier.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const clientId = process.env.JLR_CLIENT_ID || 'dsas-ffff491b5a53';
  if (!/^[\w-]+$/.test(clientId)) throw new Error('Invalid client ID');
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const endpoint = 'https://auth.jlr-vcdp.com/realms/public/protocol/openid-connect/auth/device';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      response_type: 'device_code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.user_code || !payload.device_code) {
    console.error('Device code request failed:', response.status, payload.error || 'unknown_error');
    if (payload.error_description) console.error(payload.error_description);
    process.exitCode = 1;
    return;
  }
  const dir = path.join(os.homedir(), '.jlr-secrets');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const stateFile = path.join(dir, 'device-flow.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    clientId,
    deviceCode: payload.device_code,
    verifier,
    interval: payload.interval || 5,
    expiresAt: Date.now() + payload.expires_in * 1000,
  }), { mode: 0o600, flag: 'w' });
  fs.chmodSync(stateFile, 0o600);
  console.log('JLR USER CODE:', payload.user_code);
  console.log('Open:', payload.verification_uri_complete || payload.verification_uri);
  console.log('Expires in:', Math.round(payload.expires_in / 60), 'minutes');
  console.log('Do not share private keys, device codes, access tokens, or the state file.');
}
main().catch(error => { console.error('Request failed:', error.message); process.exitCode = 1; });
