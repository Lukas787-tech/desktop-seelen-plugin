import type { ProviderId } from './providers';
import type { Sensitivity } from './vad';
import type { SttEngineId, TtsEngineId } from './voice-engines';
import { repairTurns, type ToolCall, type Turn } from './wire';

/**
 * What the assistant keeps on disk, and how two copies of it are reconciled.
 *
 * One file, `chat.json`, beside the widget's other data. Conversations,
 * preferences, memory and reminders live here rather than in Seelen's settings
 * because they are structured - lists and maps a `metadata.yml` field cannot
 * express - and because the keys among them are secrets, which do not belong in
 * a settings file the host syncs and exports.
 *
 * Every display runs its own replica of the widget and every replica loads
 * this file, so two of them can hold different copies. A write therefore
 * re-reads the file and merges rather than overwriting (`mergeFiles`): the
 * conversation typed on the left display is not erased by the right display
 * saving an older list a minute later.
 */

export type ToolStatus = 'running' | 'done' | 'failed' | 'declined';

export type Part =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string; ms?: number }
  | {
      kind: 'tool';
      call: ToolCall;
      /** What happened, in words, for the step list. */
      label: string;
      status: ToolStatus;
      result?: unknown;
    };

export interface MessageUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  tokensPerSecond: number | null;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  /** The user's words; for a reply, its prose so far (kept in step with `parts`). */
  text: string;
  /** `data:` URLs the user pasted in. */
  images?: string[];
  /** A reply, in the order it happened: reasoning, prose and tool steps. */
  parts?: Part[];
  failed?: boolean;
  /** Which model produced this. */
  via?: string;
  /** The router's justification, when it chose rather than followed settings. */
  reason?: string;
  usage?: MessageUsage;
  /** A message the assistant posted on its own, such as a due reminder. */
  notice?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export type Autonomy = 'ask-all' | 'ask-risky' | 'auto';
export type ThinkMode = 'auto' | 'on' | 'off';
export type Privacy = 'normal' | 'local-only';

export type ToolGroup =
  | 'system'
  | 'apps'
  | 'windows'
  | 'media'
  | 'devices'
  | 'files'
  | 'clipboard'
  | 'notes'
  | 'desktop'
  | 'power'
  | 'web'
  | 'memory';

export const TOOL_GROUPS: readonly { id: ToolGroup; label: string; description: string }[] = [
  { id: 'system', label: 'System status', description: 'CPU, memory, disks, battery, network and the focused app.' },
  { id: 'apps', label: 'Apps and files', description: 'Find and open installed apps, files, folders and links.' },
  { id: 'windows', label: 'Windows and workspaces', description: 'List, focus, minimise and close windows; switch desktops.' },
  { id: 'media', label: 'Media and sound', description: 'What is playing, playback, volume, mute and output device.' },
  { id: 'devices', label: 'Devices', description: 'Brightness, Wi-Fi and bluetooth radios, bluetooth devices, focus assist.' },
  { id: 'files', label: 'Browse folders', description: 'List and search Downloads, Documents, Desktop and the other known folders.' },
  { id: 'clipboard', label: 'Clipboard history', description: 'Read recent clipboard entries and paste one back.' },
  { id: 'notes', label: 'Notes, todos and reminders', description: 'Read and add to the notes panel, and set reminders.' },
  { id: 'desktop', label: 'Desktop settings', description: 'Show or hide modules and change this surface’s own options.' },
  { id: 'power', label: 'Power', description: 'Lock, sleep, restart, shut down, and empty the recycle bin. Always asks unless set to never ask.' },
  { id: 'web', label: 'Web', description: 'Search the web, read pages, weather and a calculator. Requests go out through r.jina.ai and open-meteo.com.' },
  { id: 'memory', label: 'Memory', description: 'Remember things you tell it across conversations.' },
];

export interface AssistantPrefs {
  ollamaHost: string;
  lmstudioUrl: string;
  customUrl: string;

  /** `null` leaves the model's own default alone. */
  temperature: number | null;
  topP: number | null;
  maxTokens: number;
  /** Ollama's context window. Its default is small enough to cut tool schemas off. */
  numCtx: number;
  /** How long Ollama keeps the model loaded after a reply: `5m`, `2h`, `-1` for ever. */
  keepAlive: string;
  think: ThinkMode;

  autonomy: Autonomy;
  /** Model calls one message may make before it has to answer. */
  maxSteps: number;
  /** How many past messages are replayed each turn. */
  historyTurns: number;
  privacy: Privacy;
  toolGroups: Record<ToolGroup, boolean>;
  /** Tools the user chose "always allow" for. */
  allowedTools: string[];
  memoryEnabled: boolean;

  showThinking: boolean;
  showSteps: boolean;

  voice: VoicePrefs;
}

export interface VoicePrefs {
  /** Who listens; `auto` picks by what is set up and what privacy allows. */
  stt: SttEngineId | 'auto';
  /** Blank: the engine's default, or for Ollama the chat model when it can hear. */
  sttModel: string;
  /** ISO 639-1 the user speaks; blank lets the recogniser tell. */
  language: string;
  tts: TtsEngineId | 'auto';
  ttsModel: string;
  /** The voice chosen per language code; `''` is the voice for anything else. */
  voices: Record<string, string>;
  speed: number;
  /** OpenAI-compatible bases (`.../v1`) of local speech servers. */
  sttUrl: string;
  ttsUrl: string;
  /** Silence that ends what the user is saying. */
  pauseMs: number;
  sensitivity: Sensitivity;
  /** Talking over the assistant stops it and listens. */
  bargeIn: boolean;
  /** Read typed conversations' replies aloud too. */
  readReplies: boolean;
  /** Send dictation as soon as it is transcribed, rather than into the message box. */
  autoSend: boolean;
  /** Soft tones when it starts and stops listening. */
  cues: boolean;
}

export const DEFAULT_PREFS: AssistantPrefs = {
  ollamaHost: 'http://127.0.0.1:11434',
  lmstudioUrl: 'http://127.0.0.1:1234/v1',
  customUrl: '',
  temperature: null,
  topP: null,
  maxTokens: 8192,
  numCtx: 16384,
  keepAlive: '30m',
  think: 'auto',
  autonomy: 'ask-risky',
  maxSteps: 12,
  historyTurns: 30,
  privacy: 'normal',
  toolGroups: {
    system: true,
    apps: true,
    windows: true,
    media: true,
    devices: true,
    files: true,
    clipboard: false,
    notes: true,
    desktop: true,
    power: true,
    web: true,
    memory: true,
  },
  allowedTools: [],
  memoryEnabled: true,
  showThinking: true,
  showSteps: true,
  voice: {
    stt: 'auto',
    sttModel: '',
    language: '',
    tts: 'auto',
    ttsModel: '',
    voices: {},
    speed: 1,
    sttUrl: '',
    ttsUrl: 'http://127.0.0.1:8880/v1',
    pauseMs: 800,
    sensitivity: 'normal',
    bargeIn: true,
    readReplies: false,
    autoSend: false,
    cues: true,
  },
};

export interface MemoryFact {
  id: string;
  text: string;
  at: number;
}

export interface Reminder {
  id: string;
  text: string;
  dueAt: number;
  conversationId: string | null;
  fired: boolean;
}

export type KeyId = ProviderId | 'jina';

export interface AssistantFile {
  version: 2;
  keys: Partial<Record<KeyId, string>>;
  keysAt: number;
  prefs: AssistantPrefs;
  prefsAt: number;
  memory: MemoryFact[];
  reminders: Reminder[];
  conversations: Conversation[];
  activeId: string | null;
  /** Ids removed on purpose, so a merge does not bring them back. */
  deleted: string[];
}

export function emptyFile(): AssistantFile {
  return {
    version: 2,
    keys: {},
    keysAt: 0,
    prefs: structuredClone(DEFAULT_PREFS),
    prefsAt: 0,
    memory: [],
    reminders: [],
    conversations: [],
    activeId: null,
    deleted: [],
  };
}

/** Preferences from disk, with anything a newer build added filled in. */
export function withDefaults(prefs: Partial<AssistantPrefs> | undefined): AssistantPrefs {
  const merged = { ...structuredClone(DEFAULT_PREFS), ...(prefs ?? {}) };
  merged.toolGroups = { ...DEFAULT_PREFS.toolGroups, ...(prefs?.toolGroups ?? {}) };
  merged.allowedTools = Array.isArray(prefs?.allowedTools) ? [...prefs.allowedTools] : [];
  merged.voice = { ...DEFAULT_PREFS.voice, ...(prefs?.voice ?? {}), voices: { ...(prefs?.voice?.voices ?? {}) } };
  return merged;
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return 'New chat';
  return line.length > 48 ? `${line.slice(0, 47).trimEnd()}…` : line;
}

/**
 * Reads whatever was on disk into the current shape.
 *
 * Version 1 was one flat conversation beside the keys; it becomes the first
 * conversation, so nobody's history disappears with the upgrade.
 */
export function migrate(raw: unknown): AssistantFile {
  const file = emptyFile();
  if (!raw || typeof raw !== 'object') return file;
  const root = raw as Record<string, any>;

  if (root.keys && typeof root.keys === 'object') file.keys = { ...root.keys };
  file.keysAt = Number(root.keysAt) || 0;

  if (root.version !== 2) {
    const old = Array.isArray(root.messages) ? root.messages : [];
    if (old.length) {
      const now = Date.now();
      const messages: ChatMessage[] = old
        .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'))
        .map((m: any, i: number) => ({
          id: String(m.id ?? `msg-v1-${i}`),
          role: m.role,
          at: now,
          text: String(m.text ?? ''),
          ...(m.role === 'assistant' ? { parts: [{ kind: 'text', text: String(m.text ?? '') }] } : {}),
          ...(m.failed ? { failed: true } : {}),
          ...(m.via ? { via: m.via } : {}),
        }));
      const first = messages.find((m) => m.role === 'user');
      file.conversations = [
        { id: 'conv-v1', title: titleFrom(first?.text ?? ''), createdAt: now, updatedAt: now, messages },
      ];
      file.activeId = 'conv-v1';
    }
    return file;
  }

  file.prefs = withDefaults(root.prefs);
  file.prefsAt = Number(root.prefsAt) || 0;
  file.memory = Array.isArray(root.memory) ? root.memory : [];
  file.reminders = Array.isArray(root.reminders) ? root.reminders : [];
  file.conversations = Array.isArray(root.conversations) ? root.conversations : [];
  file.activeId = typeof root.activeId === 'string' ? root.activeId : null;
  file.deleted = Array.isArray(root.deleted) ? root.deleted : [];
  return file;
}

const MAX_TOMBSTONES = 400;

function unionById<T extends { id: string }>(
  a: readonly T[],
  b: readonly T[],
  gone: Set<string>,
  pick: (x: T, y: T) => T,
): T[] {
  const byId = new Map<string, T>();
  for (const item of a) if (!gone.has(item.id)) byId.set(item.id, item);
  for (const item of b) {
    if (gone.has(item.id)) continue;
    const existing = byId.get(item.id);
    byId.set(item.id, existing ? pick(existing, item) : item);
  }
  return [...byId.values()];
}

/**
 * Reconciles this replica's copy with the one on disk.
 *
 * Conversations and memory are unioned by id, newest edit winning; keys and
 * preferences are each taken whole from whichever copy changed them last; a
 * deletion recorded by either copy wins over the other still holding the item.
 * `activeId` is this replica's own view and always comes from `mine`.
 */
export function mergeFiles(disk: AssistantFile, mine: AssistantFile): AssistantFile {
  const deleted = [...new Set([...disk.deleted, ...mine.deleted])].slice(-MAX_TOMBSTONES);
  const gone = new Set(deleted);

  const conversations = unionById(disk.conversations, mine.conversations, gone, (x, y) =>
    y.updatedAt >= x.updatedAt ? y : x,
  ).sort((x, y) => y.updatedAt - x.updatedAt);

  return {
    version: 2,
    keys: mine.keysAt >= disk.keysAt ? mine.keys : disk.keys,
    keysAt: Math.max(mine.keysAt, disk.keysAt),
    prefs: mine.prefsAt >= disk.prefsAt ? mine.prefs : disk.prefs,
    prefsAt: Math.max(mine.prefsAt, disk.prefsAt),
    memory: unionById(disk.memory, mine.memory, gone, (_x, y) => y).sort((x, y) => x.at - y.at),
    reminders: unionById(disk.reminders, mine.reminders, gone, (x, y) => ({
      ...y,
      fired: x.fired || y.fired,
    })),
    conversations,
    activeId: mine.activeId && conversations.some((c) => c.id === mine.activeId) ? mine.activeId : (conversations[0]?.id ?? null),
    deleted,
  };
}

/**
 * The stored messages as a transcript a wire can send.
 *
 * A reply is rebuilt round by round: prose, then the calls it made with their
 * results, then the prose that followed. Reasoning is not replayed - it is the
 * model's scratch work, and replaying it costs context and confuses others.
 */
export function messagesToTurns(messages: readonly ChatMessage[], limit: number): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages.slice(-Math.max(1, limit))) {
    if (message.failed) continue;
    if (message.role === 'user') {
      if (message.text.trim() || message.images?.length) {
        turns.push({ role: 'user', text: message.text, ...(message.images?.length ? { images: message.images } : {}) });
      }
      continue;
    }

    let text = '';
    let calls: ToolCall[] = [];
    let results: { call: ToolCall; result: unknown }[] = [];
    const flush = () => {
      if (calls.length) {
        turns.push({ role: 'assistant', text, calls });
        turns.push({ role: 'tool', results });
      } else if (text.trim()) {
        turns.push({ role: 'assistant', text });
      }
      text = '';
      calls = [];
      results = [];
    };

    for (const part of message.parts ?? [{ kind: 'text' as const, text: message.text }]) {
      if (part.kind === 'text') {
        if (calls.length) flush();
        text += part.text;
      } else if (part.kind === 'tool') {
        calls.push(part.call);
        if (part.status === 'declined') results.push({ call: part.call, result: { error: 'The user declined this action.' } });
        else if (part.status !== 'running') results.push({ call: part.call, result: part.result ?? null });
      }
    }
    flush();
  }
  // A window that starts mid-reply would open on tool results with no call.
  while (turns[0] && turns[0].role !== 'user') turns.shift();
  return repairTurns(turns);
}
