import { defineBackground } from 'wxt/utils/define-background';
import type { Envelope, Req, RequestType, Res } from '../src/core/messages';
import { deleteAnalyses, exportAnalyses, importAnalyses, listAnalyses, savedKinds } from '../src/services/analyses';
import { ankiAdd, ankiTest } from '../src/services/anki';
import { runBackup, watchSentences } from '../src/services/backup';
import { watchChat } from '../src/services/chat';
import { explainLine, explainWord } from '../src/services/claude';
import { claudeCodeStatus } from '../src/services/claude-code';
import { floatExists, placeFloatWindow, setFloatState, toggleTabFullscreen, watchFloatWindows } from '../src/services/floatwin';
import { lookup, romanizeLines, translateLines } from '../src/services/google-translate';
import { findKeyLines } from '../src/services/keylines';
import {
  deleteLibrary,
  exportLibrary,
  importLibrary,
  listLibrary,
  onLibraryChanged,
  recordWatched,
  runLibraryBackup,
  saveEpisode,
  searchLibrary,
  watchLibrary,
} from '../src/services/library';
import { forgetVectors, indexLibrary, meaningSearch, meaningStatus, scheduleIndexing } from '../src/services/meaning';
import { closeReader, openReader } from '../src/services/offscreen';
import { findPatterns } from '../src/services/patterns';
import { summarizeEpisode } from '../src/services/summary';
import { speak } from '../src/services/tts';

function isAllowedSubtitleUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      (u.hostname.endsWith('.nflxvideo.net') || u.hostname.endsWith('.netflix.com'))
    );
  } catch {
    return false;
  }
}

const handlers: {
  [T in RequestType]: (payload: Req<T>, sender: chrome.runtime.MessageSender) => Promise<Res<T>>;
} = {
  async fetchText({ url }) {
    if (!isAllowedSubtitleUrl(url)) throw new Error('Blocked subtitle URL');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Subtitle download failed (${res.status})`);
    return res.text();
  },
  async translateLines({ lines, from, to }) {
    return { translations: await translateLines(lines, from, to) };
  },
  async romanizeLines({ lines, from }) {
    return { romanizations: await romanizeLines(lines, from) };
  },
  lookup: ({ text, from, to }) => lookup(text, from, to),
  explainWord: (req) => explainWord(req),
  explainLine: (req) => explainLine(req),
  findKeyLines: (req) => findKeyLines(req),
  summarize: (req) => summarizeEpisode(req),
  listAnalyses: () => listAnalyses(),
  deleteAnalyses: (req) => deleteAnalyses(req),
  exportAnalyses: () => exportAnalyses(),
  importAnalyses: ({ records }) => importAnalyses(records),
  savedKinds: ({ videoIds }) => savedKinds(videoIds),
  claudeCodeStatus: () => claudeCodeStatus(),
  speak: ({ text, lang, rate }) => speak(text, lang, rate),
  kokoroOpen: () => openReader(),
  kokoroIdle: () => closeReader(),
  backupNow: () => runBackup(),
  ankiTest: () => ankiTest(),
  ankiAdd: ({ words }) => ankiAdd(words),
  async openOptions() {
    await chrome.runtime.openOptionsPage();
  },
  async openPractice() {
    await chrome.tabs.create({ url: chrome.runtime.getURL('/practice.html') });
  },
  floatPlace: (opts, sender) => placeFloatWindow(sender, opts),
  floatExists: (_, sender) => floatExists(sender),
  floatState: ({ fullscreen }, sender) => setFloatState(sender, fullscreen),
  toggleTabFullscreen: (_, sender) => toggleTabFullscreen(sender),
  librarySave: (req) => saveEpisode(req),
  libraryWatched: (req) => recordWatched(req),
  librarySearch: (req) => searchLibrary(req),
  libraryMeaning: (req) => meaningSearch(req),
  async libraryMeaningStatus({ build }) {
    if (build) void indexLibrary().catch(() => undefined);
    return meaningStatus();
  },
  libraryPattern: (req) => findPatterns(req),
  libraryList: () => listLibrary(),
  libraryDelete: (req) => deleteLibrary(req),
  libraryExport: () => exportLibrary(),
  libraryImport: ({ json }) => importLibrary(json),
  libraryBackupNow: () => runLibraryBackup(),
};

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((msg: Envelope, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const handler = handlers[msg?.type] as ((p: unknown, s: chrome.runtime.MessageSender) => Promise<unknown>) | undefined;
    if (!handler) return false;
    handler(msg.payload, sender).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  watchFloatWindows();
  // 💬 chat answers, streamed over a port.
  watchChat();
  // ⭐ sentences: the due count on the toolbar icon, and backup files after changes.
  watchSentences();
  // 🔎 library: a backup file after changes, and the same-meaning vectors of new episodes.
  watchLibrary();
  onLibraryChanged((keys, deleted) => {
    if (deleted) forgetVectors(keys);
    scheduleIndexing();
  });

  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') chrome.runtime.openOptionsPage();
  });
});
