import type { Cue } from '../types';
import { mergeCues } from './clean';
import { parseTtml } from './ttml';
import { parseVtt } from './vtt';

/** Parse a downloaded subtitle file, picking the parser from the Netflix profile or the content. */
export function parseSubtitles(text: string, profile?: string): Cue[] {
  const looksXml = /^\s*(<\?xml|<tt[\s>])/i.test(text);
  const isVtt = profile ? profile.startsWith('webvtt') : /^﻿?WEBVTT/.test(text);
  const cues = isVtt && !looksXml ? parseVtt(text) : parseTtml(text);
  return mergeCues(cues);
}

export { mergeCues, prepareCues, stripSoundDescriptions, flatten } from './clean';
export { alignTranslation } from './align';
