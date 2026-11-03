import type { AnalysisKind, AnalysisRecord, SavedAnalyses } from './analyses';
import type {
  LibraryListItem,
  LibraryMeaningRequest,
  LibraryMeaningResult,
  LibrarySaveRequest,
  LibrarySearchRequest,
  LibrarySearchResult,
  MeaningStatus,
} from './library';
import type { PatternRequest } from './patterns';
import type {
  BackupStatus,
  ClaudeCodeStatus,
  DictEntry,
  ExplainRequest,
  ExplainResult,
  KeyLinesRequest,
  KeyLinesResult,
  LineExplainRequest,
  LineExplainResult,
  SavedWord,
  SummaryRequest,
  SummaryResult,
} from './types';

/** Typed contract for content/options -> background requests. */
export interface RequestMap {
  fetchText: { req: { url: string }; res: string };
  translateLines: {
    req: { lines: string[]; from: string; to: string };
    res: { translations: (string | null)[] };
  };
  romanizeLines: {
    req: { lines: string[]; from: string };
    res: { romanizations: (string | null)[] };
  };
  lookup: { req: { text: string; from: string; to: string }; res: DictEntry };
  explainWord: { req: ExplainRequest; res: ExplainResult };
  explainLine: { req: LineExplainRequest; res: LineExplainResult };
  findKeyLines: { req: KeyLinesRequest; res: KeyLinesResult | null };
  summarize: { req: SummaryRequest; res: SummaryResult | null };
  /** Saved key lines and summaries, for the list in Options. */
  listAnalyses: { req: Record<string, never>; res: SavedAnalyses };
  deleteAnalyses: { req: { keys?: string[]; all?: boolean }; res: void };
  exportAnalyses: { req: Record<string, never>; res: AnalysisRecord[] };
  /** Records from a backup file; returns how many were stored. */
  importAnalyses: { req: { records: unknown[] }; res: number };
  /** Which results are saved for these episodes, for the toolbar popup. */
  savedKinds: { req: { videoIds: string[] }; res: Record<string, AnalysisKind[]> };
  claudeCodeStatus: { req: Record<string, never>; res: ClaudeCodeStatus };
  speak: { req: { text: string; lang: string; rate?: number }; res: void };
  /** Create the offscreen Kokoro reader if it isn't open; then connect a `KOKORO_PORT` port to it. */
  kokoroOpen: { req: Record<string, never>; res: void };
  /** Sent by the offscreen reader after a few idle minutes: close it to free the model's memory. */
  kokoroIdle: { req: Record<string, never>; res: void };
  /** Write a backup file now through the native helper (it also runs by itself after changes). */
  backupNow: { req: Record<string, never>; res: BackupStatus };
  ankiTest: { req: Record<string, never>; res: { version: number; decks: string[]; models: string[] } };
  ankiAdd: { req: { words: SavedWord[] }; res: { results: (number | null)[]; errors: (string | null)[] } };
  openOptions: { req: Record<string, never>; res: void };
  /** Open the ⭐ practice page (text-to-speech) in a new tab. */
  openPractice: { req: Record<string, never>; res: void };
  /** The content script just opened the floating sidebar window: put it on a monitor and fill it. */
  floatPlace: { req: { fullscreen: boolean; netflixFullscreen: boolean }; res: void };
  /** After a reload: whether this tab's floating window is still open, so the page can take it back. */
  floatExists: { req: Record<string, never>; res: boolean };
  /** Fullscreen or maximized for this tab's floating window. */
  floatState: { req: { fullscreen: boolean }; res: void };
  /** Fullscreen on / off for the Netflix tab's browser window; returns whether it is now fullscreen. */
  toggleTabFullscreen: { req: Record<string, never>; res: boolean };
  /** 🔎 Save the episode open now to the library (again, as more of its translations come in). */
  librarySave: { req: LibrarySaveRequest; res: void };
  /** 🔎 Parts of an episode just played. */
  libraryWatched: { req: { videoId: string; lang: string; ranges: [number, number][] }; res: void };
  /** 🔎 Lines with a word, phrase, pattern or Korean line; or a line's chunks found elsewhere. */
  librarySearch: { req: LibrarySearchRequest; res: LibrarySearchResult };
  /** 🔎 Lines with the same meaning, from the sentence model (slower: it may load the model first). */
  libraryMeaning: { req: LibraryMeaningRequest; res: LibraryMeaningResult };
  /** 🔎 How much of the library the sentence model has read; with `build`, read the rest now. */
  libraryMeaningStatus: { req: { build?: boolean }; res: MeaningStatus };
  /** 🔎 ✨ Pattern: the reusable frames in a line, from the key-lines provider. */
  libraryPattern: { req: PatternRequest; res: { frames: string[] } };
  /** 🔎 Saved episodes, for Options → Library. */
  libraryList: { req: Record<string, never>; res: LibraryListItem[] };
  libraryDelete: { req: { keys?: string[]; all?: boolean }; res: void };
  /** The library as a JSON file's text. */
  libraryExport: { req: Record<string, never>; res: string };
  /** A library file; returns how many episodes were stored. */
  libraryImport: { req: { json: string }; res: number };
  /** Write polyglot-library.json through the native helper now. */
  libraryBackupNow: { req: Record<string, never>; res: BackupStatus };
}

export type RequestType = keyof RequestMap;
export type Req<T extends RequestType> = RequestMap[T]['req'];
export type Res<T extends RequestType> = RequestMap[T]['res'];

export interface Envelope<T extends RequestType = RequestType> {
  type: T;
  payload: Req<T>;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

const RELOAD_PAGE = 'Polyglot Player was reloaded or updated. Refresh this page to reconnect.';

export async function send<T extends RequestType>(type: T, payload: Req<T>): Promise<Res<T>> {
  // A content script left behind by an extension reload loses chrome.runtime (or its id).
  if (!globalThis.chrome?.runtime?.id) throw new Error(RELOAD_PAGE);
  let reply: Reply<Res<T>> | undefined;
  try {
    reply = (await chrome.runtime.sendMessage({ type, payload } satisfies Envelope<T>)) as
      | Reply<Res<T>>
      | undefined;
  } catch (e) {
    if (/context invalidated/i.test(String(e))) throw new Error(RELOAD_PAGE);
    throw e;
  }
  if (!reply) throw new Error('No response from the extension background. Try reloading the page.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
