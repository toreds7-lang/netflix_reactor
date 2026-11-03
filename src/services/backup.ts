import { dueSentences } from '../core/sentences';
import { loadSettings } from '../core/settings';
import type { BackupStatus } from '../core/types';
import { getAllSentences } from '../sentences/store';
import { toBackup } from '../words/export';
import { getAllWords } from '../words/store';
import { exportAnalyses } from './analyses';
import { setBackupStatus } from './backup-status';
import { nativeRequest } from './native-host';

/**
 * Background jobs for saved sentences: the due count on the toolbar icon, and backup files written through the
 * native helper (a reinstall of the extension wipes its storage).
 */

const BACKUP_ALARM = 'backup';
const DAILY_ALARM = 'backup-daily';
const BADGE_ALARM = 'badge';
/** A change is backed up this long after the last one, so a burst of changes writes one file. */
const BACKUP_DELAY_MIN = 1;
const DAILY_PERIOD_MIN = 12 * 60;
/** Sentences become due as time passes, so the badge is counted again this often. */
const BADGE_PERIOD_MIN = 15;

/** Words, sentences and saved key lines and summaries, as Backup JSON does, written to a file by the helper. */
export async function runBackup(): Promise<BackupStatus> {
  let status: BackupStatus;
  try {
    const s = await loadSettings();
    const [words, sentences, analyses] = await Promise.all([getAllWords(), getAllSentences(), exportAnalyses()]);
    const json = toBackup(Object.values(words), analyses, Object.values(sentences));
    const dir = s.backupDir.trim() || undefined;
    const reply = await nativeRequest<{ path: string }>({ type: 'backup', json, dir });
    status = { ok: true, at: Date.now(), path: reply.path };
  } catch (e) {
    status = { ok: false, at: Date.now(), error: e instanceof Error ? e.message : String(e) };
  }
  await setBackupStatus(status);
  return status;
}

async function backupIfOn(): Promise<void> {
  if ((await loadSettings()).autoBackup) await runBackup();
}

/** Sentences due for practice, on the toolbar icon. */
export async function updateBadge(): Promise<void> {
  const n = dueSentences(await getAllSentences(), Date.now()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#e50914' });
  await chrome.action.setBadgeText({ text: n ? (n > 99 ? '99+' : String(n)) : '' });
  await chrome.action.setTitle({ title: n ? `Polyglot Player · ${n} ⭐ ${n === 1 ? 'sentence' : 'sentences'} to practise` : 'Polyglot Player' });
}

/** Create a repeating alarm unless it exists: creating it again on every service worker start would keep delaying it. */
async function ensureAlarm(name: string, periodInMinutes: number): Promise<void> {
  if (!(await chrome.alarms.get(name))) await chrome.alarms.create(name, { periodInMinutes, delayInMinutes: periodInMinutes });
}

/** Call once when the service worker starts. */
export function watchSentences(): void {
  void updateBadge().catch(() => undefined);
  void ensureAlarm(BADGE_ALARM, BADGE_PERIOD_MIN);
  void ensureAlarm(DAILY_ALARM, DAILY_PERIOD_MIN);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.sentences) void updateBadge().catch(() => undefined);
    // Creating the alarm again pushes it back, so a burst of changes is backed up once, after it.
    if (changes.sentences || changes.words) void chrome.alarms.create(BACKUP_ALARM, { delayInMinutes: BACKUP_DELAY_MIN });
  });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === BADGE_ALARM) void updateBadge().catch(() => undefined);
    else if (alarm.name === BACKUP_ALARM || alarm.name === DAILY_ALARM) void backupIfOn();
  });
}
