import type { FindRun } from '../core/library';

/** A 🔎 Play all / Shadow all run, kept in storage so it carries on after the page opens another episode. */
const RUN_KEY = 'findRun';

export async function getFindRun(): Promise<FindRun | null> {
  const got = await chrome.storage.local.get(RUN_KEY);
  return (got[RUN_KEY] as FindRun | undefined) ?? null;
}

/** Start, move on or (with null) end the run. */
export function setFindRun(r: FindRun | null): Promise<void> {
  return r ? chrome.storage.local.set({ [RUN_KEY]: r }) : chrome.storage.local.remove(RUN_KEY);
}

export function onFindRunChanged(cb: (r: FindRun | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[RUN_KEY]) cb((changes[RUN_KEY].newValue as FindRun | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
