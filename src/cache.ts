/**
 * Process-local document cache.
 *
 * Nothing here touches the disk. The map dies with the process, so a restart
 * always starts from the official source. Entries also expire after a short
 * TTL so a long session still sees new releases.
 */

interface Entry<T> {
  value: T;
  storedAt: number;
}

const TTL_MS = Number(process.env.FACT_TTL_MS ?? 5 * 60_000);
const MAX_ENTRIES = Number(process.env.FACT_CACHE_MAX ?? 200);

const store = new Map<string, Entry<unknown>>();

function evictIfNeeded(): void {
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next();
    if (oldest.done) return;
    store.delete(oldest.value);
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.storedAt > TTL_MS) {
    store.delete(key);
    return undefined;
  }
  // Refresh recency for the eviction order.
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T): void {
  store.set(key, { value, storedAt: Date.now() });
  evictIfNeeded();
}

export function cacheStats(): { entries: number; ttlMs: number; max: number } {
  return { entries: store.size, ttlMs: TTL_MS, max: MAX_ENTRIES };
}
