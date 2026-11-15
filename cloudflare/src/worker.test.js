import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildApiErrorCode, claimRun, correlationId, describeShape, distanceKm, normaliseJlr, numFrom, retryAfterSeconds, dpopClaims, probeRecord, safeSchemaKey, dpopNonce, jlrResourceHeaders, normaliseVin,
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

test('schema probe records key paths and value types only, never values', () => {
  const secretValues = [SYNTHETIC_VIN, OTHER_SECRET, 'Tokyo', '35.6812', 139.7671, 412, 63.5, '2026-11-14T03:00:00Z', 'LOCKED'];
  const payload = {
    vin: SYNTHETIC_VIN,
    vehicle: {
      range: { value: 412, unit: 'km' },
      powertrain: { fuelSystem: { relativeLevel: 63.5 } },
      location: { lat: '35.6812', lon: 139.7671, city: 'Tokyo' },
      doors: 'LOCKED',
      lastUpdated: '2026-11-14T03:00:00Z',
    },
    signals: [{ name: 'x', value: OTHER_SECRET }, { name: 'y', value: null }],
    [SYNTHETIC_VIN]: { nested: true },
    '2026-11-14': 1,
    '12345678': 2,
  };
  const { paths, truncated } = describeShape(payload);
  assert.equal(truncated, false);
  const text = JSON.stringify(paths);
  for (const value of secretValues) assert.equal(text.includes(String(value)), false, 'leaked ' + value);
  assert.ok(paths.includes('$.vehicle.range.value:number'));
  assert.ok(paths.includes('$.vehicle.powertrain.fuelSystem.relativeLevel:number'));
  assert.ok(paths.includes('$.vehicle.location.city:string'));
  assert.ok(paths.includes('$.signals[].value:null|string'));
  assert.ok(paths.includes('$.<id-key>.nested:boolean'));
  assert.ok(paths.includes('$.<date-key>:number'));
  assert.ok(paths.includes('$.<n>:number'));
  assert.equal(safeSchemaKey('a'.repeat(65)), '<long-key>');
  assert.equal(safeSchemaKey('has space'), '<other-key>');
});

test('schema probe caps size and records error type for failed calls without values', () => {
  const wide = Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['k' + i.toString(36) + 'x', i]));
  const big = describeShape(wide);
  assert.equal(big.truncated, true);
  assert.ok(big.paths.length <= 400);
  const failed = probeRecord('diagnostics', { ok: false, errorCode: 'api_http_403:diagnostics:www-insufficient_scope:scopes-openid' });
  assert.deepEqual(failed, { endpoint: 'diagnostics', outcome: 'error', httpStatus: 403,
    errorCode: 'api_http_403:diagnostics:www-insufficient_scope:scopes-openid', paths: [], truncated: false });
  const ok = probeRecord('status', { ok: true, data: { vehicle: { range: 412 } } });
  assert.equal(ok.outcome, 'ok');
  assert.equal(JSON.stringify(ok).includes('412'), false);
});

test('rate limit: retry-after is derived from the last run start (SQLite UTC format)', () => {
  const now = Date.parse('2026-11-15T07:40:00Z');
  assert.equal(retryAfterSeconds('2026-11-15 07:38:00', 300, now), 180);
  assert.equal(retryAfterSeconds('2026-11-15T07:38:00.000Z', 300, now), 180);
  assert.equal(retryAfterSeconds('2026-11-15 07:44:59', 300, now), 300);
  assert.equal(retryAfterSeconds('2026-11-15 07:30:00', 300, now), 1);
  assert.equal(retryAfterSeconds(null, 300, now), 300);
});

test('rate limit: a run is claimed with one conditional INSERT, otherwise rate limited', async () => {
  const calls = [];
  const db = (changes, last) => ({ prepare(sql) {
    return { bind(...args) { calls.push({ sql, args }); return this; },
      run: async () => ({ meta: { changes } }), first: async () => last };
  } });
  assert.deepEqual(await claimRun(db(1), 'run-1', 300), { claimed: true });
  assert.match(calls[0].sql, /INSERT INTO ingestion_runs[\s\S]*WHERE NOT EXISTS/);
  assert.deepEqual(calls[0].args, ['run-1', '-300 seconds']);
  const limited = await claimRun(db(0, { started_at: new Date(Date.now() - 60000).toISOString() }), 'run-2', 300);
  assert.equal(limited.claimed, false);
  assert.ok(limited.retryAfterSeconds > 230 && limited.retryAfterSeconds <= 240);
});

test('JLR status mapping reads the real VSS-style string fields', () => {
  const status = { timestamp: '2026-11-15T08:00:00Z', Vehicle: {
    TraveledDistance: '12345',
    LowVoltageBattery: { CurrentVoltage: '12.6' },
    Powertrain: { FuelSystem: { Range: '512000', RelativeLevel: '63' } },
  } };
  const s = normaliseJlr(status, null, null);
  assert.equal(s.rangeKm, 512);
  assert.equal(s.fuelPercent, 63);
  assert.equal(s.odometerKm, 12345);
  assert.equal(s.battery12v, 12.6);
  assert.equal(s.health, 'unknown');
  assert.equal(normaliseJlr({ Vehicle: { Powertrain: { FuelSystem: { Range: '480', RelativeLevel: 'n/a' } } } }, null, null).rangeKm, 480);
  assert.equal(normaliseJlr({ Vehicle: { Powertrain: { FuelSystem: { RelativeLevel: '' } } } }, null, null).fuelPercent, null);
  assert.equal(normaliseJlr({ Vehicle: { Powertrain: { FuelSystem: { RelativeLevel: '140' } } } }, null, null).fuelPercent, null);
  assert.equal(numFrom('63 %'), 63);
  assert.equal(numFrom('512 km'), 512);
  assert.equal(numFrom('512000 m'), 512);
  assert.equal(numFrom('abc'), null);
  assert.equal(distanceKm('-5', 2000), null);
  assert.equal(distanceKm('9999999999', 2000), null);
});

test('schema probe classifies string formats without recording them', () => {
  const { paths } = describeShape({ a: '63', b: '12.6 V', c: 'true', d: '2026-11-15T08:00:00Z', e: 'LOCKED', f: '' });
  assert.deepEqual(paths, ['$.a:string(numeric)', '$.b:string(numeric+unit)', '$.c:string(bool)',
    '$.d:string(datetime)', '$.e:string', '$.f:string(empty)', '$:object']);
});
