/**
 * In-memory TTL cache with single-flight coalescing.
 *
 * Two properties matter for the hot inventory/orchestrator endpoints where
 * ATLAS was 504-ing under Sentinel-induced DB load:
 *
 * 1. TTL: recent computations are served instantly from memory. A brief 30 s
 *    stale window is invisible to operators (Sentinel takes minutes, dossier
 *    extraction takes hours) and cuts the /tender/inventory p99 from a
 *    5-15 s findAll+facet on 5 400 rows to sub-ms.
 *
 * 2. Single-flight: a stampede of concurrent SSR renders (the home page
 *    fans out 8 endpoints in parallel) collapse to ONE underlying compute,
 *    not eight — precisely the case that pushed us over the nginx 60 s
 *    default and produced the 504 the user saw.
 *
 * Kept deliberately simple (no LRU eviction, no Redis) because ATLAS runs a
 * single core replica. If we ever horizontally scale core, swap the Map for
 * a Redis-backed impl — the interface stays identical.
 */
export class TtlCache<T> {
  private entries = new Map<string, { expiresAt: number; value: T }>();
  private inflight = new Map<string, Promise<T>>();

  async getOrCompute(
    key: string,
    ttlMs: number,
    factory: () => Promise<T>,
    now: () => number = Date.now,
  ): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = factory()
      .then((value) => {
        this.entries.set(key, { expiresAt: now() + ttlMs, value });
        return value;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  invalidateAll(): void {
    this.entries.clear();
  }
}
