// On-demand vehicle refresh ("Update now"): POST /v1/range-rover/refresh. Pure state + copy so it runs under `node --test`.

export type LiveRefreshState = 'idle' | 'requesting' | 'rateLimited' | 'failed' | 'done';

export type LiveRefresh = {
  state: LiveRefreshState;
  /** Device clock time when the gateway accepts another vehicle read (rate limited only). */
  retryAt: number | null;
  /** Device clock time of the last transition; lets the UI tell a fresh outcome from an old one. */
  at: number | null;
};

export type LiveRefreshEvent =
  | { type: 'start'; now: number }
  | { type: 'success'; now: number }
  | { type: 'rateLimited'; now: number; retryAfterSeconds: number }
  | { type: 'failed'; now: number }
  /** Sign-out, expired session, or the request was abandoned: back to a clean slate. */
  | { type: 'reset' };

export const initialLiveRefresh: LiveRefresh = { state: 'idle', retryAt: null, at: null };

/** Backend limit: one vehicle read per 5 minutes. Used when a 429 carries no usable hint. */
export const DEFAULT_RETRY_AFTER_SECONDS = 300;
const MAX_RETRY_AFTER_SECONDS = 3600;
/** How long "Updated just now" stays on screen after a successful update. */
export const DONE_VISIBLE_MS = 60_000;
export const LIVE_REFRESH_TIMEOUT_MS = 30_000;

export function liveRefreshReducer(current: LiveRefresh, event: LiveRefreshEvent): LiveRefresh {
  switch (event.type) {
    case 'start':
      // A request in flight keeps its start time; a known rate limit is kept until the gateway answers again.
      if (current.state === 'requesting') return current;
      return { state: 'requesting', retryAt: current.retryAt, at: event.now };
    case 'success':
      return { state: 'done', retryAt: null, at: event.now };
    case 'rateLimited':
      return { state: 'rateLimited', retryAt: event.now + clampRetry(event.retryAfterSeconds) * 1000, at: event.now };
    case 'failed':
      // Keep an earlier rate-limit window: the gateway's limit does not reset because this attempt failed.
      return { state: 'failed', retryAt: current.retryAt, at: event.now };
    case 'reset':
      return initialLiveRefresh;
  }
}

function clampRetry(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_RETRY_AFTER_SECONDS;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(seconds));
}

/**
 * Seconds to wait after a 429. Prefers the JSON `retryAfterSeconds`, then the Retry-After header (delta seconds or an
 * HTTP date), then the backend's 5-minute window.
 */
export function retryAfterSeconds(header: string | null | undefined, body: unknown, now: number): number {
  const hint = body && typeof body === 'object' ? (body as Record<string, unknown>).retryAfterSeconds : undefined;
  if (typeof hint === 'number' && Number.isFinite(hint) && hint > 0) return clampRetry(hint);
  const value = header?.trim() ?? '';
  if (/^\d+$/.test(value) && Number(value) > 0) return clampRetry(Number(value));
  if (value && !/^\d+$/.test(value)) {
    const date = Date.parse(value);
    if (Number.isFinite(date) && date > now) return clampRetry((date - now) / 1000);
  }
  return DEFAULT_RETRY_AFTER_SECONDS;
}

export type LiveRefreshOutcome = 'success' | 'rateLimited' | 'failed' | 'expired';

/** What a refresh response status means for the app. 503 (gateway unavailable) is a plain failure. */
export function refreshOutcome(status: number): LiveRefreshOutcome {
  if (status >= 200 && status < 300) return 'success';
  if (status === 429) return 'rateLimited';
  if (status === 401) return 'expired';
  return 'failed';
}

/** True while the gateway is known to refuse another vehicle read. */
export const isRateLimited = (live: LiveRefresh, now: number) => live.retryAt !== null && now < live.retryAt;

/** Whether "Update now" can send a POST right now. */
export const canRequest = (live: LiveRefresh, now: number) => live.state !== 'requesting' && !isRateLimited(live, now);

/** The state as the UI should show it at `now`: a passed rate limit and an old success both read as idle. */
export function liveRefreshView(live: LiveRefresh, now: number): LiveRefreshState {
  if (live.state === 'rateLimited' && !isRateLimited(live, now)) return 'idle';
  if (live.state === 'done' && (live.at === null || now - live.at >= DONE_VISIBLE_MS)) return 'idle';
  return live.state;
}

/** Whole minutes left in the rate-limit window, rounded up (never 0 while limited). */
export function minutesLeft(live: LiveRefresh, now: number): number {
  return isRateLimited(live, now) ? Math.max(1, Math.ceil((live.retryAt! - now) / 60_000)) : 0;
}

/** Status line under the vehicle values, or null when there is nothing to say. */
export function liveRefreshLine(live: LiveRefresh, now: number): string | null {
  switch (liveRefreshView(live, now)) {
    case 'requesting': return 'Updating from vehicle…';
    case 'rateLimited': return 'Updated recently — try again in ' + minutesLeft(live, now) + ' min';
    case 'failed': return 'Couldn’t reach the vehicle. Showing the last saved data.';
    case 'done': return 'Updated just now';
    case 'idle': return null;
  }
}

/**
 * Milliseconds until the countdown text or the view state next changes (minute boundary, end of the rate limit, end
 * of "Updated just now"), or null when nothing is scheduled.
 */
export function nextChangeIn(live: LiveRefresh, now: number): number | null {
  const view = liveRefreshView(live, now);
  if (view === 'rateLimited') {
    const left = live.retryAt! - now;
    const toMinute = left % 60_000 || 60_000;
    return Math.max(1, Math.min(left, toMinute));
  }
  if (view === 'done') return Math.max(1, live.at! + DONE_VISIBLE_MS - now);
  return null;
}
