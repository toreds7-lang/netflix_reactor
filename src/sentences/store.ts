import { mergeSentences } from '../core/sentences';
import type { PracticeSession, SavedSentence } from '../core/types';

const KEY = 'sentences';
const PRACTICE_KEY = 'sentencePractice';

export type SentenceMap = Record<string, SavedSentence>;

export async function getAllSentences(): Promise<SentenceMap> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as SentenceMap | undefined) ?? {};
}

let chain: Promise<unknown> = Promise.resolve();

/** Serialized read-modify-write so the Netflix tab and the practice page don't clobber each other's ratings. */
function mutate(fn: (all: SentenceMap) => void): Promise<SentenceMap> {
  const next = chain.then(async () => {
    const all = await getAllSentences();
    fn(all);
    await chrome.storage.local.set({ [KEY]: all });
    return all;
  });
  chain = next.catch(() => undefined);
  return next;
}

/** Save a new sentence; one saved before with the same id is kept as it is. */
export function addSentence(s: SavedSentence): Promise<SentenceMap> {
  return mutate((all) => {
    if (!all[s.id]) all[s.id] = s;
  });
}

export function updateSentence(id: string, patch: Partial<SavedSentence>): Promise<SentenceMap> {
  return mutate((all) => {
    if (all[id]) all[id] = { ...all[id], ...patch, id, updatedAt: Date.now() };
  });
}

export function deleteSentences(ids: string[]): Promise<SentenceMap> {
  return mutate((all) => {
    for (const id of ids) delete all[id];
  });
}

/** Sentences from a backup file: new ones and newer versions are kept. Returns how many were stored. */
export async function importSentences(list: unknown[]): Promise<number> {
  let taken = 0;
  await mutate((all) => {
    taken = mergeSentences(all, list);
  });
  return taken;
}

export function onSentencesChanged(cb: (all: SentenceMap) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb((changes[KEY].newValue as SentenceMap | undefined) ?? {});
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

export async function getPractice(): Promise<PracticeSession | null> {
  const got = await chrome.storage.local.get(PRACTICE_KEY);
  return (got[PRACTICE_KEY] as PracticeSession | undefined) ?? null;
}

/** Start, move on or (with null) end the practice session on Netflix. */
export function setPractice(p: PracticeSession | null): Promise<void> {
  return p ? chrome.storage.local.set({ [PRACTICE_KEY]: p }) : chrome.storage.local.remove(PRACTICE_KEY);
}

export function onPracticeChanged(cb: (p: PracticeSession | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[PRACTICE_KEY]) cb((changes[PRACTICE_KEY].newValue as PracticeSession | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
