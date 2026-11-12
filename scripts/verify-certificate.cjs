const { execFileSync } = require('node:child_process');
const { join } = require('node:path');
const { homedir } = require('node:os');
const cert = join(homedir(), '.jlr-secrets', 'certificate.pem');
execFileSync('openssl', ['x509', '-in', cert, '-noout', '-text'], { stdio: 'inherit' });
