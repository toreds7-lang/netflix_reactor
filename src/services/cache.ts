import { openDB, type IDBPDatabase } from 'idb';

/**
 * `analyses` holds key lines and summaries per episode (src/services/analyses.ts). `keylines` and `summary` hold the
 * ones cached before that, keyed by a hash; they move to `analyses` when their episode is opened.
 */
export type CacheStore = 'mt' | 'rom' | 'dict' | 'explain' | 'keylines' | 'summary' | 'tts' | 'analyses';

const STORES: CacheStore[] = ['mt', 'rom', 'dict', 'explain', 'keylines', 'summary', 'tts', 'analyses'];

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  // Bump the version when adding a store; upgrade() only creates the missing ones.
  dbPromise ??= openDB('polyglot-cache', 5, {
    upgrade(database) {
      for (const s of STORES) if (!database.objectStoreNames.contains(s)) database.createObjectStore(s);
    },
  });
  return dbPromise;
}

export async function cacheGet<T>(store: CacheStore, key: string): Promise<T | undefined> {
  try {
    return (await (await db()).get(store, key)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function cacheGetMany<T>(store: CacheStore, keys: string[]): Promise<(T | undefined)[]> {
  try {
    const tx = (await db()).transaction(store, 'readonly');
    const out = await Promise.all(keys.map((k) => tx.store.get(k) as Promise<T | undefined>));
    await tx.done;
    return out;
  } catch {
    return keys.map(() => undefined);
  }
}

export async function cacheSetMany<T>(store: CacheStore, entries: [string, T][]): Promise<void> {
  if (!entries.length) return;
  try {
    const tx = (await db()).transaction(store, 'readwrite');
    await Promise.all(entries.map(([k, v]) => tx.store.put(v, k)));
    await tx.done;
  } catch {
    /* cache is best-effort */
  }
}

export function cacheSet<T>(store: CacheStore, key: string, value: T): Promise<void> {
  return cacheSetMany(store, [[key, value]]);
}

// The functions below throw instead of failing quietly: they back the list of saved results in Options.

const startingWith = (prefix: string) => (prefix ? IDBKeyRange.bound(prefix, `${prefix}￿`) : undefined);

/** Keys that start with `prefix` (all keys without one). Values aren't read. */
export async function cacheKeys(store: CacheStore, prefix = ''): Promise<string[]> {
  return (await (await db()).getAllKeys(store, startingWith(prefix))) as string[];
}

/** Values whose keys start with `prefix` (all values without one), in key order. */
export async function cacheValues<T>(store: CacheStore, prefix = ''): Promise<T[]> {
  return (await (await db()).getAll(store, startingWith(prefix))) as T[];
}

export async function cachePut<T>(store: CacheStore, key: string, value: T): Promise<void> {
  await (await db()).put(store, value, key);
}

export async function cacheDelete(store: CacheStore, keys: string[]): Promise<void> {
  const tx = (await db()).transaction(store, 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

export async function cacheClear(store: CacheStore): Promise<void> {
  await (await db()).clear(store);
}

export async function cacheCount(store: CacheStore): Promise<number> {
  return (await db()).count(store);
}

/** SHA-256 hex of the joined parts, for cache keys built from long text. */
export async function hashKey(parts: string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join('␞'));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
