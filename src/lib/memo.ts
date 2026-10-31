import "server-only";

/**
 * A short-lived in-memory cache for expensive reads that every page view repeats. Keys must include
 * everything that changes the answer (the user, the client, the period, the picked property...).
 * It lives per server instance and only saves repeated work; a cold instance simply reads again.
 */
const store = new Map<string, { at: number; value: Promise<unknown> }>();
const MAX = 300;

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as Promise<T>;
  const value = load();
  store.set(key, { at: Date.now(), value });
  // a failed read is never kept
  value.catch(() => { if (store.get(key)?.value === value) store.delete(key); });
  if (store.size > MAX) for (const k of [...store.keys()].slice(0, store.size - MAX)) store.delete(k);
  return value;
}

/** Drops everything, e.g. after an action that changes data (see lib/revalidate). */
export function forgetAll() {
  store.clear();
}
