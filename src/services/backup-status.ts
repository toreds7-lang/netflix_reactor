import type { BackupStatus } from '../core/types';

/** The last backup to a file, written by the background (backup.ts) and shown in Options. */
const KEY = 'backupStatus';

export async function getBackupStatus(): Promise<BackupStatus | null> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as BackupStatus | undefined) ?? null;
}

export function setBackupStatus(status: BackupStatus): Promise<void> {
  return chrome.storage.local.set({ [KEY]: status });
}

export function onBackupStatusChanged(cb: (status: BackupStatus | null) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb((changes[KEY].newValue as BackupStatus | undefined) ?? null);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
