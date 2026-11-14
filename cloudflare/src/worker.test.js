import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildApiErrorCode, correlationId, dpopClaims, dpopNonce, jlrResourceHeaders, normaliseVin,
  safeContentType, sanitizeIngestionCode, scopeNames, shouldRetryDpop, wwwAuthenticateError,
} from './worker.js';

const SYNTHETIC_VIN = 'TESTVN00000000001';
const OTHER_SECRET = 'super-secret-refresh-token-value';
const PEM = '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----';

function jwt(payload) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

test('VIN normalisation trims, strips whitespace, uppercases, and rejects bad values without echoing them', () => {
  assert.equal(normaliseVin(`  ${SYNTHETIC_VIN.toLowerCase()}  `), SYNTHETIC_VIN);
  assert.equal(normaliseVin('testvn 000000\n00001'), SYNTHETIC_VIN);
  for (const value of ['', '   ', SYNTHETIC_VIN.slice(0, 16), `${SYNTHETIC_VIN}X`, 'TESTVIO0000000001', 'TESTVOQ0000000001', 'TESTVN0000000000!']) {
    assert.throws(() => normaliseVin(value), error => {
      assert.equal(error.ingestionCode, 'invalid_vin');
      assert.equal(error.message, 'invalid_vin');
      if (value.trim()) assert.equal(error.message.includes(value.trim().toUpperCase()), false);
      return true;
    });
  }
});

test('data-endpoint error codes keep diagnostics and drop secrets, VIN, URLs, and tokens', () => {
  const accessToken = jwt({
    scope: 'openid vehicle.status offline_access',
    vin: SYNTHETIC_VIN,
    refresh_token: OTHER_SECRET,
  });
  const code = buildApiErrorCode({
    status: 403,
    endpoint: 'journeys',
    correlation: 'corr-1234',
    wwwError: 'use_dpop_nonce',
    oauthError: 'insufficient_scope',
    contentType: 'application_json',
    scopes: scopeNames(accessToken),
  });
  assert.equal(code, 'api_http_403:journeys:corr-corr-1234:www-use_dpop_nonce:err-insufficient_scope:ct-application_json:scopes-openid.vehicle_status.offline_access');
  for (const secret of [SYNTHETIC_VIN, OTHER_SECRET, accessToken, PEM, 'https://data.jlr-vcdp.com', '35.6895']) {
    assert.equal(code.includes(secret), false);
  }
  const poisoned = buildApiErrorCode({
    status: 403,
    endpoint: SYNTHETIC_VIN,
    correlation: SYNTHETIC_VIN,
    wwwError: `use_${SYNTHETIC_VIN}`,
    contentType: safeContentType('text/html; charset=utf-8'),
    scopes: [SYNTHETIC_VIN, 'openid', 'not a scope', accessToken],
  });
  assert.equal(safeContentType('text/html; charset=utf-8'), 'text_html');
  assert.match(poisoned, /^api_http_403:unknown:ct-text_html:scopes-openid$/);
  assert.equal(poisoned.includes(SYNTHETIC_VIN), false);
  assert.equal(poisoned.includes(accessToken), false);
});

test('unstructured failures are redacted before they can be stored', () => {
  const leaked = sanitizeIngestionCode(`fetch failed ${ORIGIN_URL()} jwt ${jwt({ sub: 'owner' })} key ${OTHER_SECRET}`);
  assert.equal(leaked.includes(SYNTHETIC_VIN), false);
  assert.equal(leaked.includes('eyJ'), false);
  assert.equal(leaked.includes(OTHER_SECRET), false);
  assert.match(leaked, /^fetch_failed_https:_data\.jlr-vcdp\.com_v1_vehicles_redacted_journeys/);
});

test('resource proofs and headers match latest-journey.cjs', () => {
  const url = 'https://data.example/v1/vehicles/vehicle/journeys?page=0&size=20#fragment';
  const claims = dpopClaims('GET', url);
  assert.equal(claims.htm, 'GET');
  assert.equal(claims.htu, 'https://data.example/v1/vehicles/vehicle/journeys');
  assert.equal('ath' in claims, false);
  assert.equal('nonce' in claims, false);
  assert.equal(dpopClaims('GET', url, 'nonce-1').nonce, 'nonce-1');
  const headers = jlrResourceHeaders('access-token', 'proof');
  assert.deepEqual(headers, {
    Authorization: 'DPoP access-token',
    DPoP: 'proof',
    Accept: 'application/json',
    'User-Agent': 'node',
  });
  for (const name of ['X-API-Version', 'Api-Version', 'Accept-Version', 'x-api-key']) {
    assert.equal(name in headers, false);
  }
});

test('DPoP nonce retry runs only for a use_dpop_nonce challenge that includes a nonce', () => {
  const headers = new Headers({
    'DPoP-Nonce': 'server-nonce',
    'WWW-Authenticate': 'DPoP error="use_dpop_nonce", error_description="nonce required"',
    'x-correlation-id': 'req-123',
    'content-type': 'application/json; charset=utf-8',
  });
  assert.equal(wwwAuthenticateError(headers.get('www-authenticate')), 'use_dpop_nonce');
  assert.equal(dpopNonce(headers), 'server-nonce');
  assert.equal(correlationId(headers), 'req-123');
  assert.equal(shouldRetryDpop(0, 'use_dpop_nonce', dpopNonce(headers)), true);
  assert.equal(shouldRetryDpop(1, 'use_dpop_nonce', 'server-nonce'), false);
  assert.equal(shouldRetryDpop(0, 'invalid_token', 'server-nonce'), false);
  assert.equal(shouldRetryDpop(0, 'use_dpop_nonce', ''), false);
  assert.equal(wwwAuthenticateError('Bearer error="invalid_token"'), 'invalid_token');
});

function ORIGIN_URL() {
  return `https://data.jlr-vcdp.com/v1/vehicles/${SYNTHETIC_VIN}/journeys?page=0`;
}
