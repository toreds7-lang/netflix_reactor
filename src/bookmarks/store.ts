import { addLoop, bookmarksToPrune, sameLoop } from '../core/bookmarks';
import type { LineMark, SavedLoop, VideoBookmarks } from '../core/types';

const KEY = 'bookmarks';
const RESUME_KEY = 'resumeRequest';
/** Keep this many episodes; automatic positions are dropped before bookmarks. */
const MAX_VIDEOS = 300;
/** A Continue click in the toolbar popup is honored this long while the Netflix page loads. */
const RESUME_REQUEST_TTL_MS = 3 * 60_000;

export type BookmarkMap = Record<string, VideoBookmarks>;

interface ResumeRequest {
  videoId: string;
  at: number;
}

export async function getAllBookmarks(): Promise<BookmarkMap> {
  const got = await chrome.storage.local.get(KEY);
  return (got[KEY] as BookmarkMap | undefined) ?? {};
}

let chain: Promise<unknown> = Promise.resolve();

/** Serialized read-modify-write so the popup and several tabs don't clobber each other. */
function mutate(fn: (all: BookmarkMap) => void): Promise<BookmarkMap> {
  const next = chain.then(async () => {
    const all = await getAllBookmarks();
    fn(all);
    for (const id of bookmarksToPrune(all, MAX_VIDEOS)) delete all[id];
    await chrome.storage.local.set({ [KEY]: all });
    return all;
  });
  chain = next.catch(() => undefined);
  return next;
}

type Patch = Partial<VideoBookmarks> | ((prev: VideoBookmarks | undefined) => Partial<VideoBookmarks>);

function patchVideo(videoId: string, title: string | undefined, patch: Patch): Promise<BookmarkMap> {
  return mutate((all) => {
    const prev = all[videoId];
    const changes = typeof patch === 'function' ? patch(prev) : patch;
    const next: VideoBookmarks = { ...prev, ...changes, videoId, title: title ?? prev?.title, updatedAt: Date.now() };
    if (next.bookmark || next.last || next.loops?.length) all[videoId] = next;
    else delete all[videoId];
  });
}

/** Save lines to loop again later (a loop saved twice is kept once). */
export function saveLoop(videoId: string, loop: SavedLoop, title?: string): Promise<BookmarkMap> {
  return patchVideo(videoId, title, (prev) => ({ loops: addLoop(prev?.loops, loop) }));
}

export function deleteLoop(videoId: string, loop: SavedLoop): Promise<BookmarkMap> {
  return patchVideo(videoId, undefined, (prev) => ({ loops: prev?.loops?.filter((l) => !sameLoop(l, loop)) }));
}

/** Forget where to continue the episode (bookmark and last line), keeping its saved loops. */
export function forgetPosition(videoId: string): Promise<BookmarkMap> {
  return patchVideo(videoId, undefined, { bookmark: undefined, last: undefined });
}

/** Set (or with null, remove) the episode's bookmark. */
export function setBookmark(videoId: string, mark: LineMark | null, title?: string): Promise<BookmarkMap> {
  return patchVideo(videoId, title, { bookmark: mark ?? undefined });
}

/** Remember the last line played (null forgets it, e.g. when the episode is finished). */
export function setLastLine(videoId: string, mark: LineMark | null, title?: string): Promise<BookmarkMap> {
  return patchVideo(videoId, title, { last: mark ?? undefined });
}

export function deleteBookmarks(videoIds: string[]): Promise<BookmarkMap> {
  return mutate((all) => {
    for (const id of videoIds) delete all[id];
  });
}

export function onBookmarksChanged(cb: (all: BookmarkMap) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'local' && changes[KEY]) cb((changes[KEY].newValue as BookmarkMap | undefined) ?? {});
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** Ask the Netflix tab (open now or about to load) to continue this video. */
export function requestResume(videoId: string): Promise<void> {
  return chrome.storage.local.set({ [RESUME_KEY]: { videoId, at: Date.now() } satisfies ResumeRequest });
}

/** True, once, when the popup recently asked to continue this video. */
export async function takeResumeRequest(videoId: string): Promise<boolean> {
  const req = (await chrome.storage.local.get(RESUME_KEY))[RESUME_KEY] as ResumeRequest | undefined;
  if (!req || req.videoId !== videoId || Date.now() - req.at > RESUME_REQUEST_TTL_MS) return false;
  await chrome.storage.local.remove(RESUME_KEY);
  return true;
}

export function onResumeRequested(cb: (videoId: string) => void): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const req = area === 'local' ? (changes[RESUME_KEY]?.newValue as ResumeRequest | undefined) : undefined;
    if (req?.videoId) cb(req.videoId);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
