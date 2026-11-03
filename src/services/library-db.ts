import { openDB, type IDBPDatabase } from 'idb';

/**
 * The 🔎 library's own IndexedDB, apart from `polyglot-cache` (src/services/cache.ts), whose stores are best-effort:
 * these are your saved episodes. `episodes` and `watched` are keyed by `libraryKey`; `vectors` holds each episode's
 * same-meaning numbers (src/services/meaning.ts). Only extension pages and the background can open it.
 */
export type LibraryStore = 'episodes' | 'watched' | 'vectors';

const STORES: LibraryStore[] = ['episodes', 'watched', 'vectors'];

/** An episode's sentences as the meaning model sees them: EMBED_DIMS 8-bit numbers per sentence, end to end. */
export interface EpisodeVectors {
  key: string;
  model: string;
  dims: number;
  /** `textsHash` of the sentences they were made from. */
  hash: string;
  data: Int8Array;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  // Bump the version when adding a store; upgrade() only creates the missing ones.
  dbPromise ??= openDB('polyglot-library', 1, {
    upgrade(database) {
      for (const s of STORES) if (!database.objectStoreNames.contains(s)) database.createObjectStore(s, { keyPath: 'key' });
    },
  });
  return dbPromise;
}

export async function libGet<T>(store: LibraryStore, key: string): Promise<T | undefined> {
  return (await (await db()).get(store, key)) as T | undefined;
}

export async function libGetAll<T>(store: LibraryStore): Promise<T[]> {
  return (await (await db()).getAll(store)) as T[];
}

export async function libKeys(store: LibraryStore): Promise<string[]> {
  return (await (await db()).getAllKeys(store)) as string[];
}

export async function libPut<T extends { key: string }>(store: LibraryStore, value: T): Promise<void> {
  await (await db()).put(store, value);
}

export async function libPutMany<T extends { key: string }>(store: LibraryStore, values: T[]): Promise<void> {
  if (!values.length) return;
  const tx = (await db()).transaction(store, 'readwrite');
  await Promise.all([...values.map((v) => tx.store.put(v)), tx.done]);
}

export async function libDelete(store: LibraryStore, keys: string[]): Promise<void> {
  const tx = (await db()).transaction(store, 'readwrite');
  await Promise.all([...keys.map((k) => tx.store.delete(k)), tx.done]);
}

export async function libClear(store: LibraryStore): Promise<void> {
  await (await db()).clear(store);
}
