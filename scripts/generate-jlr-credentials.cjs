// JLR certificate bootstrap; never commit private keys or output them to logs.
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const x509 = require('@peculiar/x509');

(async () => {
  x509.cryptoProvider.set(webcrypto);
  const alg = {
    name: 'RSA-PSS',
    hash: 'SHA-256',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    saltLength: 32,
  };
  const dir = path.join(os.homedir(), '.jlr-secrets');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  const privatePath = path.join(dir, 'private.pem');
  const certPath = path.join(dir, 'certificate.pem');
  if (fs.existsSync(privatePath) || fs.existsSync(certPath)) {
    throw new Error('Key material already exists: refusing to overwrite. Back up or rotate explicitly.');
  }
  const keys = await webcrypto.subtle.generateKey(alg, true, ['sign', 'verify']);
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=LR-Vehicle-Monitor',
    notBefore: new Date(),
    notAfter: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    signingAlgorithm: alg,
    keys,
    extensions: [new x509.BasicConstraintsExtension(false)],
  });
  const pkcs8 = Buffer.from(await webcrypto.subtle.exportKey('pkcs8', keys.privateKey));
  const pem = '-----BEGIN PRIVATE KEY-----\n' + pkcs8.toString('base64').match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n';
  fs.writeFileSync(privatePath, pem, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(certPath, cert.toString('pem'), { mode: 0o600, flag: 'wx' });
  pkcs8.fill(0);
  console.log('Created private key and PUBLIC certificate in ~/.jlr-secrets/');
  console.log('Use: cat ~/.jlr-secrets/certificate.pem');
  console.log('Never paste private.pem into chat, GitHub, or JLR portal.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
