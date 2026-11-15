import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_RETRY_AFTER_SECONDS, DONE_VISIBLE_MS, canRequest, initialLiveRefresh, isRateLimited, liveRefreshLine,
  liveRefreshReducer, liveRefreshView, minutesLeft, nextChangeIn, refreshOutcome, retryAfterSeconds, type LiveRefresh,
} from '../src/liveRefresh.ts';
import { connectionState, offersUpdateNow, type GarageInput } from '../src/garageModel.ts';
import { parseSnapshot } from '../src/telemetry.ts';

const now = Date.parse('2026-11-15T03:00:00Z');
const min = 60_000;

test('reducer: start → success / rate limit / failure, and reset', () => {
  const started = liveRefreshReducer(initialLiveRefresh, { type: 'start', now });
  assert.deepEqual(started, { state: 'requesting', retryAt: null, at: now });
  // A second start while requesting is a no-op (keeps the original start time).
  assert.equal(liveRefreshReducer(started, { type: 'start', now: now + 5 }), started);
  assert.deepEqual(liveRefreshReducer(started, { type: 'success', now: now + 9000 }), { state: 'done', retryAt: null, at: now + 9000 });
  const limited = liveRefreshReducer(started, { type: 'rateLimited', now, retryAfterSeconds: 240 });
  assert.deepEqual(limited, { state: 'rateLimited', retryAt: now + 240_000, at: now });
  assert.deepEqual(liveRefreshReducer(started, { type: 'failed', now }), { state: 'failed', retryAt: null, at: now });
  // A failure does not forget an earlier rate-limit window.
  const failedWhileLimited = liveRefreshReducer(liveRefreshReducer(limited, { type: 'start', now }), { type: 'failed', now });
  assert.equal(failedWhileLimited.retryAt, now + 240_000);
  // Success clears it.
  assert.equal(liveRefreshReducer(limited, { type: 'success', now }).retryAt, null);
  assert.equal(liveRefreshReducer(limited, { type: 'reset' }), initialLiveRefresh);
});

test('reducer clamps nonsense retry hints', () => {
  const start = liveRefreshReducer(initialLiveRefresh, { type: 'start', now });
  for (const bad of [0, -5, NaN, Infinity]) {
    assert.equal(liveRefreshReducer(start, { type: 'rateLimited', now, retryAfterSeconds: bad }).retryAt, now + DEFAULT_RETRY_AFTER_SECONDS * 1000, String(bad));
  }
  assert.equal(liveRefreshReducer(start, { type: 'rateLimited', now, retryAfterSeconds: 99_999 }).retryAt, now + 3600_000);
  assert.equal(liveRefreshReducer(start, { type: 'rateLimited', now, retryAfterSeconds: 12.2 }).retryAt, now + 13_000);
});

test('retryAfterSeconds prefers the JSON hint, then the header (seconds or HTTP date), then 5 minutes', () => {
  assert.equal(retryAfterSeconds('100', { error: 'rate_limited', retryAfterSeconds: 182 }, now), 182);
  assert.equal(retryAfterSeconds('100', { error: 'rate_limited' }, now), 100);
  assert.equal(retryAfterSeconds(' 45 ', null, now), 45);
  assert.equal(retryAfterSeconds(new Date(now + 90_500).toUTCString(), null, now), 90);
  assert.equal(retryAfterSeconds(new Date(now - 10_000).toUTCString(), null, now), DEFAULT_RETRY_AFTER_SECONDS);
  assert.equal(retryAfterSeconds(null, { retryAfterSeconds: '60' }, now), DEFAULT_RETRY_AFTER_SECONDS);
  assert.equal(retryAfterSeconds('0', { retryAfterSeconds: -1 }, now), DEFAULT_RETRY_AFTER_SECONDS);
  assert.equal(retryAfterSeconds('soon', 'text', now), DEFAULT_RETRY_AFTER_SECONDS);
  assert.equal(retryAfterSeconds(undefined, undefined, now), DEFAULT_RETRY_AFTER_SECONDS);
});

test('response status → outcome', () => {
  assert.equal(refreshOutcome(200), 'success');
  assert.equal(refreshOutcome(429), 'rateLimited');
  assert.equal(refreshOutcome(401), 'expired');
  for (const status of [400, 403, 404, 500, 502, 503]) assert.equal(refreshOutcome(status), 'failed', String(status));
});

test('rate limit window gates new requests and re-opens when it passes', () => {
  const limited: LiveRefresh = { state: 'rateLimited', retryAt: now + 4 * min, at: now };
  assert.equal(isRateLimited(limited, now), true);
  assert.equal(canRequest(limited, now), false);
  assert.equal(canRequest(limited, now + 4 * min), true);
  assert.equal(liveRefreshView(limited, now + 4 * min), 'idle');
  assert.equal(canRequest({ state: 'requesting', retryAt: null, at: now }, now), false);
  assert.equal(canRequest(initialLiveRefresh, now), true);
  assert.equal(canRequest({ state: 'failed', retryAt: null, at: now }, now), true);
});

test('status copy and live minute countdown', () => {
  assert.equal(liveRefreshLine(initialLiveRefresh, now), null);
  assert.equal(liveRefreshLine({ state: 'requesting', retryAt: null, at: now }, now), 'Updating from vehicle…');
  assert.equal(liveRefreshLine({ state: 'failed', retryAt: null, at: now }, now), 'Couldn’t reach the vehicle. Showing the last saved data.');
  const done: LiveRefresh = { state: 'done', retryAt: null, at: now };
  assert.equal(liveRefreshLine(done, now + 1000), 'Updated just now');
  assert.equal(liveRefreshLine(done, now + DONE_VISIBLE_MS), null);
  const limited: LiveRefresh = { state: 'rateLimited', retryAt: now + 5 * min, at: now };
  assert.equal(liveRefreshLine(limited, now), 'Updated recently — try again in 5 min');
  assert.equal(liveRefreshLine(limited, now + 1), 'Updated recently — try again in 5 min');
  assert.equal(liveRefreshLine(limited, now + min), 'Updated recently — try again in 4 min');
  assert.equal(liveRefreshLine(limited, now + 4 * min + 59_000), 'Updated recently — try again in 1 min');
  assert.equal(liveRefreshLine(limited, now + 5 * min), null);
  assert.equal(minutesLeft(limited, now + 5 * min), 0);
});

test('next change: minute boundaries and the end of the window', () => {
  const limited: LiveRefresh = { state: 'rateLimited', retryAt: now + 5 * min, at: now };
  assert.equal(nextChangeIn(limited, now), 60_000);
  assert.equal(nextChangeIn(limited, now + 10_000), 50_000);
  assert.equal(nextChangeIn(limited, now + 4 * min + 30_000), 30_000);
  assert.equal(nextChangeIn(limited, now + 5 * min), null);
  // Countdown text changes exactly at the scheduled tick.
  const at = now + 10_000;
  assert.notEqual(liveRefreshLine(limited, at + nextChangeIn(limited, at)! - 1), liveRefreshLine(limited, at + nextChangeIn(limited, at)!));
  assert.equal(nextChangeIn({ state: 'done', retryAt: null, at: now }, now + 20_000), DONE_VISIBLE_MS - 20_000);
  assert.equal(nextChangeIn({ state: 'requesting', retryAt: null, at: now }, now), null);
  assert.equal(nextChangeIn(initialLiveRefresh, now), null);
});

test('"Update now" is offered when signed in with retryable state, and stays during a GET over existing values', () => {
  const snapshot = parseSnapshot({ status: 'fresh', fetchedAt: new Date(now - 5 * min).toISOString(), rangeKm: 500, trips: [] });
  const base: GarageInput = { phase: 'ready', snapshot, hasSession: true, discoveryFailed: false, lastSyncedAt: now - min };
  assert.equal(offersUpdateNow(connectionState(base, now)), true);
  assert.equal(offersUpdateNow(connectionState({ ...base, phase: 'loading' }, now)), true);
  assert.equal(offersUpdateNow(connectionState({ ...base, phase: 'failed' }, now)), true);
  assert.equal(offersUpdateNow(connectionState({ ...base, snapshot: null }, now)), true);
  assert.equal(offersUpdateNow(connectionState({ ...base, phase: 'loading', snapshot: null }, now)), false);
  assert.equal(offersUpdateNow(connectionState({ ...base, phase: 'expired', hasSession: false, snapshot: null }, now)), false);
  assert.equal(offersUpdateNow(connectionState({ ...base, phase: 'signedOut', hasSession: false, snapshot: null }, now)), false);
});
