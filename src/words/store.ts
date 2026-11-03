import type { SavedWord } from '../core/types';

const KEY = 'words';

export type WordMap = Record<string, SavedWord>;

export async function getAllWords(): Promise<WordMap> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as WordMap | undefined) ?? {};
}

let chain: Promise<unknown> = Promise.resolve();

/** Serialized read-modify-write so concurrent saves from several tabs don't drop words. */
function mutate(fn: (words: WordMap) => void): Promise<WordMap> {
  const next = chain.then(async () => {
    const words = await getAllWords();
    fn(words);
    await chrome.storage.local.set({ [KEY]: words });
    return words;
  });
  chain = next.catch(() => undefined);
  return next;
}

export function saveWord(word: Omit<SavedWord, 'createdAt' | 'updatedAt'> & Partial<SavedWord>): Promise<WordMap> {
  return mutate((words) => {
    const now = Date.now();
    const prev = words[word.key];
    words[word.key] = { ...prev, ...word, createdAt: prev?.createdAt ?? now, updatedAt: now } as SavedWord;
  });
}

export function updateWord(key: string, patch: Partial<SavedWord>): Promise<WordMap> {
  return mutate((words) => {
    if (words[key]) words[key] = { ...words[key], ...patch, key, updatedAt: Date.now() };
  });
}

export function deleteWords(keys: string[]): Promise<WordMap> {
  return mutate((words) => {
    for (const k of keys) delete words[k];
  });
}

export function importWords(list: SavedWord[]): Promise<WordMap> {
  return mutate((words) => {
    for (const w of list) {
      if (!w?.key || !w.word) continue;
      const prev = words[w.key];
      if (!prev || (w.updatedAt ?? 0) > (prev.updatedAt ?? 0)) words[w.key] = w;
    }
  });
}

export function onWordsChanged(cb: (words: WordMap) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb((changes[KEY].newValue as WordMap | undefined) ?? {});
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
