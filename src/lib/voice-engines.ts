import { base64ToBytes, bytesToBase64, wrapPcm16 } from './pcm';
import { cleanTranscript, transcriptionPrompt } from './speech';

/**
 * Every engine the assistant can listen or speak with, and the requests they take.
 *
 * Two shapes cover almost all of them. OpenAI's `/audio/transcriptions` and
 * `/audio/speech` are spoken by OpenAI, Groq and nearly every local speech
 * server (Kokoro-FastAPI, Speaches, LocalAI, whisper.cpp given
 * `--inference-path`). The rest are chat models that happen to hear or speak:
 * an Ollama model that lists `audio` - gemma4 does, and on this machine it
 * transcribed English and German clips word for word in under three seconds
 * warm - and Gemini, for audio in and for its voices.
 *
 * Pure, like `wire.ts`: the store hands this what it knows and gets back a
 * request, so `npm test` can check every shape without a network.
 */

export type SttEngineId = 'ollama' | 'server' | 'groq' | 'openai' | 'gemini';
export type TtsEngineId = 'server' | 'system' | 'openai' | 'gemini';
export type CloudKey = 'openai' | 'groq' | 'gemini';

export interface VoiceEngine<Id extends string> {
  id: Id;
  label: string;
  /** Nothing said to it leaves this machine. */
  local: boolean;
  key?: CloudKey;
  base?: string;
  defaultModel: string;
  models: readonly string[];
  voices?: readonly string[];
  defaultVoice?: string;
  hint: string;
}

export const OPENAI_VOICES = ['coral', 'alloy', 'ash', 'ballad', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const;

export const GEMINI_VOICES = [
  'Kore', 'Puck', 'Zephyr', 'Charon', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;

export const STT_ENGINES: readonly VoiceEngine<SttEngineId>[] = [
  {
    id: 'ollama',
    label: 'Ollama audio model',
    local: true,
    defaultModel: '',
    models: [],
    hint: 'A local model that lists “audio”, such as gemma4. The chat model is used when it can hear, so nothing extra is loaded.',
  },
  {
    id: 'server',
    label: 'Local speech server',
    local: true,
    defaultModel: 'whisper-1',
    models: [],
    hint: 'Any OpenAI-compatible /audio/transcriptions: Speaches, whisper.cpp, LocalAI.',
  },
  {
    id: 'groq',
    label: 'Groq Whisper',
    local: false,
    key: 'groq',
    base: 'https://api.groq.com/openai/v1',
    defaultModel: 'whisper-large-v3-turbo',
    models: ['whisper-large-v3-turbo', 'whisper-large-v3'],
    hint: 'Whisper large-v3, very fast. Uses the Groq key.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    local: false,
    key: 'openai',
    base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-transcribe',
    models: ['gpt-4o-mini-transcribe', 'gpt-4o-transcribe', 'whisper-1'],
    hint: 'Uses the OpenAI key.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    local: false,
    key: 'gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'],
    hint: 'Uses the Gemini key.',
  },
];

export const TTS_ENGINES: readonly VoiceEngine<TtsEngineId>[] = [
  {
    id: 'server',
    label: 'Local voice server',
    local: true,
    defaultModel: 'kokoro',
    models: [],
    hint: 'Kokoro, or any OpenAI-compatible /audio/speech.',
  },
  {
    id: 'system',
    label: 'Windows voices',
    local: true,
    defaultModel: '',
    models: [],
    hint: 'Always there, and robotic next to a neural voice.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    local: false,
    key: 'openai',
    base: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini-tts',
    models: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    voices: OPENAI_VOICES,
    defaultVoice: 'coral',
    hint: 'Uses the OpenAI key.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    local: false,
    key: 'gemini',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash-preview-tts',
    models: ['gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts'],
    voices: GEMINI_VOICES,
    defaultVoice: 'Kore',
    hint: 'Uses the Gemini key. Slower to start than a local voice.',
  },
];

export function sttEngine(id: SttEngineId): VoiceEngine<SttEngineId> {
  return STT_ENGINES.find((e) => e.id === id) ?? (STT_ENGINES[0] as VoiceEngine<SttEngineId>);
}

export function ttsEngine(id: TtsEngineId): VoiceEngine<TtsEngineId> {
  return TTS_ENGINES.find((e) => e.id === id) ?? (TTS_ENGINES[0] as VoiceEngine<TtsEngineId>);
}

export interface EngineContext {
  privacy: 'normal' | 'local-only';
  hasKey: (id: CloudKey) => boolean;
  /** The Ollama model that would transcribe, if any is installed. */
  ollamaAudioModel: string | null;
  sttServer: boolean;
  ttsServer: boolean;
}

function available<Id extends string>(engine: VoiceEngine<Id>, ctx: EngineContext, ready: boolean): boolean {
  if (!engine.local && ctx.privacy === 'local-only') return false;
  return engine.key ? ctx.hasKey(engine.key) : ready;
}

/**
 * Who listens. A speech server the user has set up comes first - they set it
 * up to be used - then an Ollama model that can hear, then the cloud, which
 * *Local models only* rules out.
 */
export function chooseStt(preference: SttEngineId | 'auto', ctx: EngineContext): SttEngineId | null {
  const ready: Record<SttEngineId, boolean> = {
    server: ctx.sttServer,
    ollama: !!ctx.ollamaAudioModel,
    groq: true,
    openai: true,
    gemini: true,
  };
  if (preference !== 'auto') return available(sttEngine(preference), ctx, ready[preference]) ? preference : null;
  const order: SttEngineId[] = ['server', 'ollama', 'groq', 'openai', 'gemini'];
  return order.find((id) => available(sttEngine(id), ctx, ready[id])) ?? null;
}

/** Who speaks. Windows' own voices are always there to fall back on. */
export function chooseTts(preference: TtsEngineId | 'auto', ctx: EngineContext): TtsEngineId {
  const ready: Record<TtsEngineId, boolean> = { server: ctx.ttsServer, system: true, openai: true, gemini: true };
  if (preference !== 'auto') return available(ttsEngine(preference), ctx, ready[preference]) ? preference : 'system';
  const order: TtsEngineId[] = ['server', 'openai', 'gemini', 'system'];
  return order.find((id) => available(ttsEngine(id), ctx, ready[id])) ?? 'system';
}

/**
 * The Ollama model to transcribe with. The chat model when it can hear:
 * a second model would be loaded next to it, and on a 16 GB card a second
 * 12B model does not fit.
 */
export function audioModelFor(models: readonly { name: string; capabilities: readonly string[] }[], chatModel: string): string | null {
  const hears = models.filter((m) => m.capabilities.includes('audio'));
  return hears.find((m) => m.name === chatModel)?.name ?? hears[0]?.name ?? null;
}

export interface HttpRequest {
  url: string;
  headers: Record<string, string>;
  body: string | FormData;
}

export interface TranscriptionOptions {
  engine: SttEngineId;
  base: string;
  model: string;
  key: string;
  wav: Uint8Array;
  /** ISO 639-1, or blank to let the engine decide. */
  language: string;
  /** Length of the clip, which bounds how much text can come back. */
  seconds: number;
  /**
   * Ollama only. These must match the chat's own, or Ollama reloads the model
   * to change them - measured at 16 to 85 seconds for gemma4:12b, against
   * 2.3 seconds for the same clip with them matching.
   */
  numCtx?: number;
  keepAlive?: string;
  /** Ollama only: `false` for a model that thinks, which would otherwise reason about the audio first. */
  think?: boolean | null;
}

function bearer(key: string): Record<string, string> {
  return key ? { authorization: `Bearer ${key}` } : {};
}

export function transcriptionRequest(o: TranscriptionOptions): HttpRequest {
  const prompt = transcriptionPrompt(o.language);
  if (o.engine === 'ollama') {
    const body: Record<string, unknown> = {
      model: o.model,
      stream: false,
      options: {
        temperature: 0,
        ...(o.numCtx ? { num_ctx: o.numCtx } : {}),
        num_predict: Math.round(60 + o.seconds * 16),
      },
      // Ollama's native chat takes audio in `images`; its OpenAI shim's
      // `input_audio` works too, but cannot carry `num_ctx`, so it reloads.
      messages: [{ role: 'user', content: prompt, images: [bytesToBase64(o.wav)] }],
    };
    if (typeof o.think === 'boolean') body.think = o.think;
    if (o.keepAlive) body.keep_alive = o.keepAlive;
    return { url: `${o.base}/api/chat`, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  }

  if (o.engine === 'gemini') {
    return {
      url: `${o.base}/models/${o.model}:generateContent`,
      headers: { 'content-type': 'application/json', ...(o.key ? { 'x-goog-api-key': o.key } : {}) },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'audio/wav', data: bytesToBase64(o.wav) } }] }],
        generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
      }),
    };
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(o.wav)], { type: 'audio/wav' }), 'speech.wav');
  form.append('model', o.model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  if (o.language) form.append('language', o.language);
  return { url: `${o.base}/audio/transcriptions`, headers: bearer(o.key), body: form };
}

/** The words out of whatever the engine answered, cleaned of what it added. */
export function readTranscription(engine: SttEngineId, payload: any): string {
  const raw =
    engine === 'ollama'
      ? payload?.message?.content
      : engine === 'gemini'
        ? (payload?.candidates?.[0]?.content?.parts ?? []).map((p: any) => p?.text ?? '').join('')
        : payload?.text;
  return cleanTranscript(typeof raw === 'string' ? raw : '');
}

export interface SpeechOptions {
  engine: Exclude<TtsEngineId, 'system'>;
  base: string;
  model: string;
  key: string;
  voice: string;
  text: string;
  speed: number;
}

export function speechRequest(o: SpeechOptions): HttpRequest {
  if (o.engine === 'gemini') {
    return {
      url: `${o.base}/models/${o.model}:generateContent`,
      headers: { 'content-type': 'application/json', ...(o.key ? { 'x-goog-api-key': o.key } : {}) },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: o.text }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: o.voice || 'Kore' } } },
        },
      }),
    };
  }
  const body: Record<string, unknown> = {
    model: o.model,
    input: o.text,
    voice: o.voice,
    // Uncompressed, so a local server spends nothing encoding and the browser
    // nothing decoding.
    response_format: 'wav',
  };
  if (o.speed && Math.abs(o.speed - 1) > 0.01) body.speed = o.speed;
  return { url: `${o.base}/audio/speech`, headers: { 'content-type': 'application/json', ...bearer(o.key) }, body: JSON.stringify(body) };
}

/** Gemini answers with bare PCM inside JSON; this makes it a WAV a browser can decode. */
export function geminiAudio(payload: any): Uint8Array | null {
  const part = (payload?.candidates?.[0]?.content?.parts ?? []).find((p: any) => p?.inlineData?.data);
  if (!part) return null;
  const rate = Number(/rate=(\d+)/.exec(String(part.inlineData.mimeType ?? ''))?.[1]) || 24_000;
  return wrapPcm16(base64ToBytes(part.inlineData.data), rate);
}

/** Voice ids out of the shapes speech servers list them in. */
export function readVoices(payload: any): string[] {
  const list = Array.isArray(payload) ? payload : (payload?.voices ?? payload?.data ?? []);
  if (!Array.isArray(list)) return [];
  return list
    .map((v: any) => (typeof v === 'string' ? v : (v?.id ?? v?.voice_id ?? v?.name)))
    .filter((v: unknown): v is string => typeof v === 'string' && !!v);
}

const KOKORO_LANGUAGES: Record<string, string> = { a: 'en', b: 'en', d: 'de', e: 'es', f: 'fr', h: 'hi', i: 'it', j: 'ja', p: 'pt', z: 'zh' };

/**
 * The language a voice speaks, from its id. Kokoro's ids open with a language
 * letter and a sex (`af_heart`: American English, female); Piper's and most
 * others' with a locale (`de_DE-thorsten-high`).
 */
export function voiceLanguage(id: string): string | null {
  const kokoro = /^([a-z])[fm]_/.exec(id);
  if (kokoro) return KOKORO_LANGUAGES[kokoro[1] as string] ?? null;
  const locale = /^([a-z]{2})[_-][A-Za-z]{2}(?![a-z])/.exec(id);
  return locale ? (locale[1] as string) : null;
}

const ACCENTS: Record<string, string> = {
  a: 'American',
  b: 'British',
  d: 'German',
  e: 'Spanish',
  f: 'French',
  h: 'Hindi',
  i: 'Italian',
  j: 'Japanese',
  p: 'Brazilian',
  z: 'Mandarin',
};

/** `af_heart` as a person would name it: `Heart · American female`. Other ids are left as they are. */
export function voiceLabel(id: string): string {
  const match = /^([a-z])([fm])_([a-z0-9]+)$/i.exec(id);
  const accent = match && ACCENTS[(match[1] as string).toLowerCase()];
  if (!match || !accent) return id;
  const name = match[3] as string;
  return `${name[0]?.toUpperCase()}${name.slice(1)} · ${accent} ${match[2] === 'f' ? 'female' : 'male'}`;
}

/**
 * The voice for a piece of text in `language`: the user's choice for that
 * language if the server has it, otherwise the first voice that speaks it,
 * otherwise their general choice. A German reply read by an English voice is
 * worse than a plainer German one.
 */
export function pickVoice(voices: readonly string[], language: string, chosen: Readonly<Record<string, string>>): string {
  const preferred = chosen[language];
  if (preferred && (!voices.length || voices.includes(preferred))) return preferred;
  const speaks = voices.find((v) => voiceLanguage(v) === language);
  if (speaks) return speaks;
  return chosen[''] || voices[0] || '';
}

/**
 * A Windows voice for `language`: a natural one if Windows has one installed,
 * then any that speaks it, then the default. Only ever the fallback, so there
 * is no choosing between them.
 */
export function pickSystemVoice<V extends { name: string; lang: string; default?: boolean }>(voices: readonly V[], language: string): V | null {
  const speaks = voices.filter((v) => v.lang.toLowerCase().startsWith(language));
  return speaks.find((v) => /natural|online/i.test(v.name)) ?? speaks[0] ?? voices.find((v) => v.default) ?? voices[0] ?? null;
}
