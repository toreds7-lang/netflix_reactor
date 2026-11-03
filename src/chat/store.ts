import type { ChatMessage } from '../core/chat';

/** One storage key per episode, so a message writes only its own episode's chat. */
const PREFIX = 'chat:';
/** The newest messages kept per episode. */
const MAX_MESSAGES = 200;

interface StoredChat {
  messages: ChatMessage[];
  /** "Show · Episode". */
  title?: string;
  updatedAt: number;
}

export async function getChat(videoId: string): Promise<ChatMessage[]> {
  const key = PREFIX + videoId;
  const got = await chrome.storage.local.get(key);
  return (got[key] as StoredChat | undefined)?.messages ?? [];
}

/** Save an episode's chat; an empty one is removed. */
export async function saveChat(videoId: string, messages: ChatMessage[], title?: string): Promise<void> {
  const key = PREFIX + videoId;
  if (!messages.length) return chrome.storage.local.remove(key);
  const chat: StoredChat = { messages: messages.slice(-MAX_MESSAGES), title, updatedAt: Date.now() };
  await chrome.storage.local.set({ [key]: chat });
}
