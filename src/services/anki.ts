import { loadSettings } from '../core/settings';
import type { SavedWord } from '../core/types';
import { ankiCard } from '../words/export';

async function invoke<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { ankiUrl } = await loadSettings();
  let res: Response;
  try {
    res = await fetch(ankiUrl, { method: 'POST', body: JSON.stringify({ action, version: 6, params }) });
  } catch {
    throw new Error('Cannot reach Anki. Is Anki open with the AnkiConnect add-on installed?');
  }
  if (res.status === 403) throw new Error('AnkiConnect refused this extension. Allow it in Anki (see Options).');
  if (!res.ok) throw new Error(`AnkiConnect error ${res.status}`);
  const body = (await res.json()) as { result: T; error: string | null };
  if (body.error) throw new Error(body.error);
  return body.result;
}

export async function ankiTest(): Promise<{ version: number; decks: string[]; models: string[] }> {
  // Newer AnkiConnect versions show an "allow this origin?" prompt inside Anki.
  try {
    await invoke('requestPermission');
  } catch {
    /* older versions don't have it */
  }
  const version = await invoke<number>('version');
  const [decks, models] = await Promise.all([invoke<string[]>('deckNames'), invoke<string[]>('modelNames')]);
  return { version, decks, models };
}

export async function ankiAdd(words: SavedWord[]): Promise<{ results: (number | null)[]; errors: (string | null)[] }> {
  const { ankiDeck, ankiModel } = await loadSettings();
  await invoke('createDeck', { deck: ankiDeck });
  const fields = await invoke<string[]>('modelFieldNames', { modelName: ankiModel });
  if (fields.length < 2) throw new Error(`Note type "${ankiModel}" needs at least two fields.`);
  const results: (number | null)[] = [];
  const errors: (string | null)[] = [];
  for (const w of words) {
    const { front, back } = ankiCard(w);
    try {
      const id = await invoke<number>('addNote', {
        note: {
          deckName: ankiDeck,
          modelName: ankiModel,
          fields: { [fields[0]]: front, [fields[1]]: back },
          options: { allowDuplicate: false, duplicateScope: 'deck' },
          tags: ['polyglot-player', w.lang.replace(/\s+/g, '_')],
        },
      });
      results.push(id);
      errors.push(null);
    } catch (e) {
      results.push(null);
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { results, errors };
}
