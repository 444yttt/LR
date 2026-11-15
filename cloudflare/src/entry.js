// Worker entry: the HTTP/cron handlers from worker.js plus an RPC entrypoint that only other
// Workers in this account can reach through a service binding (no public route exists).
import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { collect, ON_DEMAND_MIN_INTERVAL_S } from './worker.js';

export class Collector extends WorkerEntrypoint {
  /** Owner-triggered read of the same JLR endpoints as the daily job (read-only), rate limited. */
  async refresh() {
    try {
      const result = await collect(this.env, { minIntervalS: ON_DEMAND_MIN_INTERVAL_S });
      if (result.status === 'rate_limited') return { status: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds };
      return { status: result.status === 'complete' ? 'complete' : result.status === 'disabled' ? 'disabled' : 'error' };
    } catch {
      return { status: 'error' };
    }
  }
}

export default worker;
