// JLR fleet/corporate REST authentication test. Keep all credentials in Codespaces.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const clientId = process.env.JLR_CLIENT_ID || 'dsas-ffff491b5a53';
const tokenUrl = 'https://auth.jlr-vcdp.com/realms/public/protocol/openid-connect/token';
const privatePem = fs.readFileSync(path.join(os.homedir(), '.jlr-secrets', 'private.pem'), 'utf8');
const privateKey = crypto.createPrivateKey(privatePem);
const publicJwk = crypto.createPublicKey(privateKey).export({ format: 'jwk' });
const { kty, n, e } = publicJwk;
const b64 = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
function signedJwt(header, payload) {
  const body = b64(header) + '.' + b64(payload);
  const signature = crypto.sign('sha256', Buffer.from(body), {
    key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: 32
  });
  return body + '.' + signature.toString('base64url');
}
function clientAssertion() {
  const iat = Math.floor(Date.now() / 1000);
  return signedJwt({ alg: 'PS256', typ: 'JWT' }, {
    iss: clientId, sub: clientId, aud: tokenUrl, jti: crypto.randomUUID(), iat, exp: iat + 300
  });
}
function dpop(method, url) {
  const iat = Math.floor(Date.now() / 1000);
  return signedJwt({ alg: 'PS256', typ: 'dpop+jwt', jwk: {kty,n,e} }, {
    jti: crypto.randomUUID(), htm: method, htu: url, iat
  });
}
(async () => {
  const result = await fetch(tokenUrl, {
    method: 'POST',
    headers: {'Content-Type':'application/x-www-form-urlencoded', 'DPoP':dpop('POST', tokenUrl)},
    body: new URLSearchParams({
      grant_type:'client_credentials', client_id:clientId,
      client_assertion_type:'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion:clientAssertion()
    })
  });
  const body = await result.json();
  console.log('Token HTTP status:', result.status);
  if (!result.ok) {
    console.log('JLR error:', body.error || body.title || 'unknown');
    console.log('Description:', body.error_description || body.detail || 'not provided');
    process.exitCode = 1; return;
  }
  if (!body.access_token) throw new Error('No access token in response');
  console.log('Authentication succeeded. Token retained in memory only.');
  const vin = (process.env.JLR_VIN || '').trim();
  if (!vin) {
    console.log('To test a vehicle, run: JLR_VIN=YOUR_17_CHARACTER_VIN node scripts/test-fleet-api.cjs');
    return;
  }
  if (!/^[A-HJ-NPR-Z0-9]{17}$/i.test(vin)) throw new Error('Expected a 17-character VIN');
  const apiUrl = 'https://data.jlr-vcdp.com/v1/vehicles/' + encodeURIComponent(vin) + '/journeys?page=0&size=1';
  const api = await fetch(apiUrl, {
    headers: {Authorization: 'DPoP ' + body.access_token, DPoP: dpop('GET', apiUrl)}
  });
  console.log('Journeys HTTP status:',api.status);
  const response = await api.json().catch(()=>({}));
  if (!api.ok) {
    console.log('JLR error:',response.title || response.error || 'unknown');
    console.log('Description:',response.detail || response.error_description || 'not provided');
    return;
  }
  const journeys = Array.isArray(response) ? response : (response.content || response.journeys || response.data || []);
  console.log('Journeys returned:',Array.isArray(journeys) ? journeys.length : 'unknown response shape');
  console.log('Response keys:',Object.keys(response).slice(0,15).join(', '));
  // Journey data is sensitive: no raw locations, VIN, token or trip payload printed.
})().catch(e=> {console.error('Local error:',e.message);process.exitCode=1;});
