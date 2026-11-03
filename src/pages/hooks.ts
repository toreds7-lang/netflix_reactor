import { useEffect, useState } from 'preact/hooks';
import { DEFAULT_SETTINGS, loadSettings, onSettingsChanged, saveSettings, type Settings } from '../core/settings';
import type { BackupStatus } from '../core/types';
import { getAllBookmarks, onBookmarksChanged, type BookmarkMap } from '../bookmarks/store';
import { getAllSentences, onSentencesChanged, type SentenceMap } from '../sentences/store';
import { getBackupStatus, onBackupStatusChanged } from '../services/backup-status';
import { getAllWords, onWordsChanged, type WordMap } from '../words/store';

export function useSettings(): [Settings, (patch: Partial<Settings>) => void, boolean] {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void loadSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
    return onSettingsChanged(setSettings);
  }, []);
  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    void saveSettings(patch);
  };
  return [settings, update, loaded];
}

export function useWords(): WordMap {
  const [words, setWords] = useState<WordMap>({});
  useEffect(() => {
    void getAllWords().then(setWords);
    return onWordsChanged(setWords);
  }, []);
  return words;
}

/** Saved sentences, and whether they have been read from storage yet. */
export function useSentences(): [SentenceMap, boolean] {
  const [all, setAll] = useState<SentenceMap>({});
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    void getAllSentences().then((s) => {
      setAll(s);
      setLoaded(true);
    });
    return onSentencesChanged(setAll);
  }, []);
  return [all, loaded];
}

/** The last backup to a file (src/services/backup.ts writes it). */
export function useBackupStatus(): BackupStatus | null {
  const [status, setStatus] = useState<BackupStatus | null>(null);
  useEffect(() => {
    void getBackupStatus().then(setStatus);
    return onBackupStatusChanged(setStatus);
  }, []);
  return status;
}

export function useBookmarks(): BookmarkMap {
  const [all, setAll] = useState<BookmarkMap>({});
  useEffect(() => {
    void getAllBookmarks().then(setAll);
    return onBookmarksChanged(setAll);
  }, []);
  return all;
}

/** The ⭐ practice page (entrypoints/practice), in a new tab. */
export function openPracticePage(): Promise<chrome.tabs.Tab> {
  return chrome.tabs.create({ url: chrome.runtime.getURL('/practice.html') });
}

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
