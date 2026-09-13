import type { ChatMessage, VoicePrefs } from './assistant-state';
import { Microphone, Player, SpeechQueue, speakWithSystem, systemVoices, type Playback } from './audio-io';
import { chat, type ReplyEvent, type SendOptions } from './chat.svelte';
import { noteAction, noteError } from './diagnostics';
import { encodePowerShell, local } from './local.svelte';
import { concat, encodeWav, normalise, resample } from './pcm';
import { isLocalUrl, trimUrl } from './providers';
import { SeelenCommand, invoke } from './seelen';
import { SpeechChunker, approvalAnswer, guessLanguage } from './speech';
import { Endpointer } from './vad';
import {
  audioModelFor,
  chooseStt,
  chooseTts,
  geminiAudio,
  pickSystemVoice,
  pickVoice,
  readTranscription,
  readVoices,
  speechRequest,
  sttEngine,
  transcriptionRequest,
  ttsEngine,
  type EngineContext,
  type SttEngineId,
  type TtsEngineId,
} from './voice-engines';

/**
 * The assistant's voice: dictation, reading replies aloud, and a hands-free
 * conversation.
 *
 * A conversation is a loop around the same agent turn the panel runs. The
 * microphone stays open; the end-of-speech detector (`vad.ts`) decides when the
 * user has finished; the clip goes to a recogniser; the words go to
 * `chat.send` as if typed; and the reply is read aloud sentence by sentence as
 * it streams in (`speech.ts`, `audio-io.ts`). Talking over it stops it and
 * listens. An approval card is read out too, and a spoken yes or no answers
 * it.
 *
 * What is going on right now is never stored as a phase of its own: it is
 * worked out from what is actually happening (`phase`), so no path through a
 * stop, a failure or an interruption can leave the panel saying "Speaking"
 * over silence.
 */

export type VoiceMode = 'off' | 'talk' | 'dictate';
export type VoicePhase = 'idle' | 'listening' | 'hearing' | 'transcribing' | 'thinking' | 'speaking';
export type SpeechServerState = 'unknown' | 'ready' | 'refused' | 'offline';

const PREROLL_MS = 450;
const SERVER_WAIT_MS = 25_000;

/**
 * Starts the voice server the installer left behind, if there is one.
 *
 * It lives in the user profile, not AppData: installed from a packaged app (a
 * terminal inside the Claude desktop app, for one), every AppData write is
 * redirected into that app's own container - measured, 4.8 GB of it - where
 * Seelen's PowerShell never looks.
 */
const START_SERVER = `$s = Join-Path $env:USERPROFILE '.ralfm-voice\start.ps1'
if (Test-Path $s) { & $s }`;

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function probe(url: string): Promise<{ state: SpeechServerState; payload: unknown }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return { state: 'offline', payload: null };
    return { state: 'ready', payload: await response.json().catch(() => null) };
  } catch {
    try {
      // Anything that answers without CORS headers is running and refusing us.
      await fetch(url, { mode: 'no-cors', signal: AbortSignal.timeout(2000) });
      return { state: 'refused', payload: null };
    } catch {
      return { state: 'offline', payload: null };
    }
  }
}

class VoiceStore {
  mode = $state<VoiceMode>('off');
  recording = $state(false);
  transcribing = $state(false);
  /** A spoken message is being answered. */
  turnActive = $state(false);
  /** An approval card was read out and a spoken answer is expected. */
  awaitingAnswer = $state(false);
  /** The piece being spoken right now. */
  speaking = $state<string | null>(null);
  /** The message being read aloud from its own button. */
  readingId = $state<string | null>(null);
  /** 0..1: the microphone while listening, the voice while speaking. */
  level = $state(0);
  heard = $state('');
  error = $state<string | null>(null);
  muted = $state(false);
  opening = $state(false);

  ttsServer = $state<{ state: SpeechServerState; voices: string[] }>({ state: 'unknown', voices: [] });
  sttServer = $state<SpeechServerState>('unknown');
  startingServer = $state(false);

  #mic: Microphone | null = null;
  #player = new Player();
  #queue = new SpeechQueue(
    (text, signal) => this.#prepare(text, signal),
    (text) => (this.speaking = text),
    (err) => this.#fail(err),
  );
  #vad = new Endpointer({ pauseMs: 800, sensitivity: 'normal' });
  #preroll: Float32Array[] = [];
  #clip: Float32Array[] = [];
  #chunker: SpeechChunker | null = null;
  #options: SendOptions | null = null;
  #onDictation: ((text: string) => void) | null = null;
  #following = false;
  #turn = 0;
  #pipeline: Promise<void> = Promise.resolve();
  #micLevel = 0;
  #levelTimer: ReturnType<typeof setInterval> | undefined;
  #systemVoices: SpeechSynthesisVoice[] = [];
  #serverStart: Promise<boolean> | null = null;
  #serverTriedAt = 0;
  #lastTts: TtsEngineId = 'system';

  get prefs(): VoicePrefs {
    return chat.prefs.voice;
  }

  get phase(): VoicePhase {
    if (this.mode === 'off') return this.speaking ? 'speaking' : 'idle';
    if (this.recording) return 'hearing';
    if (this.transcribing) return 'transcribing';
    if (this.speaking) return 'speaking';
    if (this.turnActive && !(this.awaitingAnswer && chat.pending)) return 'thinking';
    return 'listening';
  }

  setPrefs(patch: Partial<VoicePrefs>): void {
    chat.setPrefs({ voice: { ...$state.snapshot(this.prefs), ...patch } });
    if (patch.ttsUrl !== undefined || patch.sttUrl !== undefined) void this.refreshServers();
    if (patch.pauseMs !== undefined || patch.sensitivity !== undefined) {
      this.#vad.options = { ...this.#vad.options, sensitivity: this.prefs.sensitivity, pauseMs: this.mode === 'dictate' ? this.#dictationPause() : this.prefs.pauseMs };
    }
  }

  // --- engines -------------------------------------------------------------

  #chatModel(): string {
    const options = this.#options;
    if (!options || options.provider !== 'ollama') return chat.localModel('ollama') ?? '';
    return options.model.trim() || chat.localModel('ollama') || '';
  }

  context(): EngineContext {
    const models = local.state === 'ready' ? local.models.map((m) => ({ name: m.name, capabilities: local.info[m.name]?.capabilities ?? [] })) : [];
    return {
      privacy: chat.prefs.privacy,
      hasKey: (id) => !!chat.keyFor(id),
      ollamaAudioModel: audioModelFor(models, this.#chatModel()),
      sttServer: this.sttServer === 'ready',
      ttsServer: this.ttsServer.state === 'ready',
    };
  }

  /** Who would listen right now, or null. */
  listener(): SttEngineId | null {
    return chooseStt(this.prefs.stt, this.context());
  }

  /** Who would speak right now. */
  speaker(): TtsEngineId {
    return chooseTts(this.prefs.tts, this.context());
  }

  async refreshServers(): Promise<void> {
    const { ttsUrl, sttUrl } = this.prefs;
    const tts = trimUrl(ttsUrl);
    const stt = trimUrl(sttUrl);
    const [voices, models] = await Promise.all([
      tts ? probe(`${tts}/audio/voices`) : Promise.resolve(null),
      stt ? probe(`${stt}/models`) : Promise.resolve(null),
    ]);
    this.ttsServer = voices ? { state: voices.state, voices: readVoices(voices.payload) } : { state: 'unknown', voices: [] };
    this.sttServer = models?.state ?? 'unknown';
  }

  /**
   * Starts the local voice server when it is the one that would speak and it
   * is not up. A PowerShell `run` never reports back, so readiness is read
   * from the server itself.
   */
  startServer(force = false): Promise<boolean> {
    if (this.ttsServer.state === 'ready') return Promise.resolve(true);
    if (this.#serverStart) return this.#serverStart;
    const { tts, ttsUrl } = this.prefs;
    if (!force && (!['auto', 'server'].includes(tts) || !isLocalUrl(ttsUrl) || Date.now() - this.#serverTriedAt < 5 * 60_000)) {
      return Promise.resolve(false);
    }
    this.#serverTriedAt = Date.now();
    this.#serverStart = (async () => {
      this.startingServer = true;
      try {
        void invoke(SeelenCommand.Run, {
          program: 'powershell.exe',
          args: ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encodePowerShell(START_SERVER)],
          workingDir: null,
          elevated: false,
        }).catch(() => {});
        for (let i = 0; i < 30; i++) {
          await sleep(1000);
          await this.refreshServers();
          if (this.ttsServer.state === 'ready') {
            noteAction('voice: started the voice server');
            return true;
          }
        }
        return false;
      } finally {
        this.startingServer = false;
        this.#serverStart = null;
      }
    })();
    return this.#serverStart;
  }

  async #transcribe(samples: Float32Array, sampleRate: number): Promise<string> {
    const p = this.prefs;
    const context = this.context();
    const engine = chooseStt(p.stt, context);
    if (!engine) {
      throw new Error(
        chat.prefs.privacy === 'local-only'
          ? 'Nothing local can listen: install an Ollama model that lists “audio”, such as gemma4, or set up a speech server.'
          : 'Nothing can listen yet: add an Ollama model that can hear, a speech server, or a Groq, OpenAI or Gemini key.',
      );
    }
    const info = sttEngine(engine);
    const clip = normalise(resample(samples, sampleRate, 16_000));
    const chosenModel = p.stt === engine ? p.sttModel.trim() : '';
    const model = engine === 'ollama' ? chosenModel || context.ollamaAudioModel || '' : chosenModel || info.defaultModel;
    const request = transcriptionRequest({
      engine,
      base: engine === 'ollama' ? local.host : engine === 'server' ? trimUrl(p.sttUrl) : (info.base ?? ''),
      model,
      key: info.key ? chat.keyFor(info.key) : '',
      wav: encodeWav(clip, 16_000),
      language: p.language,
      seconds: clip.length / 16_000,
      numCtx: chat.prefs.numCtx,
      keepAlive: chat.prefs.keepAlive,
      think: engine === 'ollama' && local.supports(model, 'thinking') !== false ? false : null,
    });
    const started = Date.now();
    const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal: AbortSignal.timeout(90_000) });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      throw new Error(`${info.label} could not transcribe (${response.status})${raw ? `: ${raw.slice(0, 160)}` : '.'}`);
    }
    const text = readTranscription(engine, await response.json());
    noteAction(`voice: heard ${Math.round(clip.length / 1600) / 10}s via ${engine} in ${Date.now() - started}ms`);
    return text;
  }

  async #prepare(text: string, signal: AbortSignal): Promise<Playback> {
    const p = this.prefs;
    if (this.#serverStart) await Promise.race([this.#serverStart, sleep(SERVER_WAIT_MS)]);
    const engine = chooseTts(p.tts, this.context());
    this.#lastTts = engine;
    const language = guessLanguage(text, p.language || 'en');

    if (engine === 'system') {
      if (!this.#systemVoices.length) this.#systemVoices = await systemVoices();
      const voice = pickSystemVoice(this.#systemVoices, language);
      return (stop) => speakWithSystem(text, voice, p.speed, stop);
    }

    const info = ttsEngine(engine);
    const chosen = p.voices[language] || p.voices[''] || '';
    const voice =
      engine === 'server'
        ? pickVoice(this.ttsServer.voices, language, p.voices)
        : info.voices?.includes(chosen)
          ? chosen
          : (info.defaultVoice ?? '');
    const request = speechRequest({
      engine,
      base: engine === 'server' ? trimUrl(p.ttsUrl) : (info.base ?? ''),
      model: (p.tts === engine && p.ttsModel.trim()) || info.defaultModel,
      key: info.key ? chat.keyFor(info.key) : '',
      voice,
      text,
      speed: p.speed,
    });
    const response = await fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, signal });
    if (!response.ok) throw new Error(`${info.label} could not speak (${response.status}).`);
    const bytes = engine === 'gemini' ? geminiAudio(await response.json()) : new Uint8Array(await response.arrayBuffer());
    if (!bytes?.length) throw new Error(`${info.label} returned no audio.`);
    return (stop) => this.#player.play(bytes, stop);
  }

  // --- listening -----------------------------------------------------------

  #dictationPause(): number {
    return Math.max(1800, this.prefs.pauseMs * 2);
  }

  /**
   * Opens the microphone for a conversation (`talk`) or for dictation into the
   * message box, which hands each transcript to `onText`.
   */
  async start(mode: Exclude<VoiceMode, 'off'>, options: SendOptions, onText?: (text: string) => void): Promise<void> {
    if (this.mode !== 'off' || this.opening) {
      const same = this.mode === mode;
      this.stop();
      if (same) return;
    }
    const p = this.prefs;
    this.error = null;
    this.heard = '';
    this.#options = options;
    this.#onDictation = onText ?? null;
    this.#follow();
    this.opening = true;
    try {
      void this.refreshServers().then(() => this.startServer());
      chat.warmUp(options);
      this.#vad = new Endpointer({ pauseMs: mode === 'dictate' ? this.#dictationPause() : p.pauseMs, sensitivity: p.sensitivity });
      this.#mic = await Microphone.open((samples, db, at) => this.#onFrame(samples, db, at));
      this.mode = mode;
      this.#levelTimer = setInterval(() => {
        this.level = this.speaking && this.#lastTts !== 'system' ? this.#player.level() : this.#micLevel;
      }, 50);
      if (p.cues) this.#player.cue('listen');
      noteAction(`voice: ${mode} on (${this.#mic.tap}, ${this.#mic.sampleRate} Hz)`);
    } catch (err) {
      this.#teardown();
      this.#fail(err);
    } finally {
      this.opening = false;
    }
  }

  stop(): void {
    const was = this.mode;
    this.#teardown();
    if (was !== 'off' && this.prefs.cues) this.#player.cue('stop');
  }

  /** Dictation's button: transcribe what has been said so far, then close. */
  finishDictation(): void {
    if (this.mode !== 'dictate') return;
    if (this.recording) this.#end(false);
    else this.stop();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.muted && this.recording) this.#drop();
  }

  #teardown(): void {
    this.mode = 'off';
    this.#turn++;
    this.recording = false;
    this.#clip = [];
    this.#preroll = [];
    this.#mic?.close();
    this.#mic = null;
    this.#queue.stop();
    this.#chunker = null;
    this.turnActive = false;
    this.awaitingAnswer = false;
    this.muted = false;
    clearInterval(this.#levelTimer);
    this.level = 0;
    this.#micLevel = 0;
  }

  #onFrame(samples: Float32Array, db: number, at: number): void {
    this.#micLevel = this.#micLevel * 0.6 + Math.max(0, Math.min(1, (db + 55) / 40)) * 0.4;
    if (this.muted) return;
    const frame = samples.slice();
    const rate = this.#mic?.sampleRate ?? 48_000;
    if (this.recording) {
      this.#clip.push(frame);
    } else {
      this.#preroll.push(frame);
      while (this.#preroll.length * (frame.length / rate) * 1000 > PREROLL_MS) this.#preroll.shift();
    }

    // While it talks or works, only a clear voice may interrupt - and not at
    // all over a Windows voice, which echo cancellation cannot hear to remove.
    const busy = this.mode === 'talk' && (!!this.speaking || (this.turnActive && !(this.awaitingAnswer && chat.pending)));
    if (busy && (!this.prefs.bargeIn || this.#lastTts === 'system')) return;
    const event = this.#vad.update(db, at, busy);
    if (event === 'start') this.#begin(busy);
    else if (event === 'end') this.#end(false);
    else if (event === 'cut') this.#end(true);
    else if (event === 'discard') this.#drop();
  }

  /** The orb, while it talks or works: stop, and listen. */
  interrupt(): void {
    if (this.mode !== 'talk') return;
    this.#halt();
    if (this.prefs.cues) this.#player.cue('listen');
  }

  #halt(): void {
    this.#turn++;
    this.#queue.stop();
    this.#chunker = null;
    this.turnActive = false;
    this.awaitingAnswer = false;
    if (chat.streaming) chat.stop();
  }

  #begin(interrupting: boolean): void {
    if (interrupting) {
      this.#halt();
      noteAction('voice: interrupted by the user');
    }
    this.#clip = this.#preroll;
    this.#preroll = [];
    this.recording = true;
  }

  #drop(): void {
    this.recording = false;
    this.#clip = [];
    this.#vad.reset();
  }

  #end(cut: boolean): void {
    const samples = concat(this.#clip);
    const rate = this.#mic?.sampleRate ?? 48_000;
    this.#clip = [];
    if (!cut) this.recording = false;
    const mode = this.mode;
    // In order, so a long dictation cut into pieces arrives in the order it was said.
    this.#pipeline = this.#pipeline.then(async () => {
      this.transcribing = true;
      let text = '';
      try {
        text = await this.#transcribe(samples, rate);
      } catch (err) {
        this.#fail(err);
      } finally {
        this.transcribing = false;
      }
      if (mode === 'dictate') {
        if (text) this.#onDictation?.(text);
        if (!cut && this.mode === 'dictate') this.stop();
        return;
      }
      if (this.mode !== 'talk' || !text) return;
      this.heard = text;
      if (this.awaitingAnswer && chat.pending) {
        this.#answer(text);
        return;
      }
      void this.#converse(text);
    });
  }

  #answer(text: string): void {
    const answer = approvalAnswer(text);
    if (!answer) {
      this.#queue.add('Say yes or no.');
      return;
    }
    this.awaitingAnswer = false;
    if (answer === 'no') chat.deny();
    else chat.approve(answer === 'always');
  }

  // --- speaking ------------------------------------------------------------

  async #converse(text: string): Promise<void> {
    const options = this.#options;
    if (!options) return;
    const token = ++this.#turn;
    this.turnActive = true;
    this.#chunker = new SpeechChunker();
    try {
      await chat.send(text, { ...options, voice: true });
    } finally {
      if (token === this.#turn) {
        for (const piece of this.#chunker?.flush() ?? []) this.#queue.add(piece);
        this.#chunker = null;
        if (chat.error) this.#queue.add(chat.error);
        await this.#queue.idle();
        if (token === this.#turn) {
          this.turnActive = false;
          this.awaitingAnswer = false;
          if (this.mode === 'talk' && this.prefs.cues) this.#player.cue('listen');
        }
      }
    }
  }

  #follow(): void {
    if (this.#following) return;
    this.#following = true;
    chat.onReply((event) => this.#onReply(event));
  }

  #onReply(event: ReplyEvent): void {
    if (event.kind === 'ask') {
      if (this.mode === 'talk' && this.turnActive) {
        this.awaitingAnswer = true;
        this.#queue.add(`${event.approval.label}? ${event.approval.reason ? `${event.approval.reason} ` : ''}Yes or no?`);
      }
      return;
    }
    if (event.kind !== 'end') this.awaitingAnswer = false;
    const chunker = this.#chunker;
    if (!chunker) return;
    if (event.kind === 'text') {
      for (const piece of chunker.push(event.delta)) this.#queue.add(piece);
    } else if (event.kind === 'round') {
      // The model stopped writing to use a tool: say the half-sentence now
      // rather than holding it through the wait.
      for (const piece of chunker.flush()) this.#queue.add(piece);
    } else if (!this.turnActive) {
      // A typed message's reply, read aloud because the settings say so.
      for (const piece of chunker.flush()) this.#queue.add(piece);
      this.#chunker = null;
    }
  }

  /** Reads the next reply aloud as it streams, for a message that was typed. */
  readNextReply(): void {
    if (this.mode === 'talk') return;
    this.#follow();
    this.#queue.stop();
    this.readingId = null;
    this.#chunker = new SpeechChunker();
    void this.refreshServers().then(() => this.startServer());
  }

  /** The speaker button on a reply: reads it, or stops reading it. */
  speakMessage(message: ChatMessage): void {
    if (this.readingId === message.id) {
      this.stopSpeaking();
      return;
    }
    this.stopSpeaking();
    this.error = null;
    this.readingId = message.id;
    const chunker = new SpeechChunker();
    const pieces = [...chunker.push(message.text), ...chunker.flush()];
    void (async () => {
      if (this.ttsServer.state !== 'ready') {
        await this.refreshServers();
        void this.startServer();
      }
      if (this.readingId !== message.id) return;
      for (const piece of pieces) this.#queue.add(piece);
      await this.#queue.idle();
      if (this.readingId === message.id) this.readingId = null;
    })();
  }

  stopSpeaking(): void {
    this.#queue.stop();
    this.readingId = null;
    // The rest of a reply still streaming in is not read either.
    this.#chunker = null;
  }

  /** The settings' sample button. */
  async sample(text: string): Promise<void> {
    this.stopSpeaking();
    this.error = null;
    await this.refreshServers();
    this.#queue.add(text);
    await this.#queue.idle();
  }

  /** Transcribes a finished recording - the settings' microphone test, and the preview's fixtures. */
  transcribeClip(samples: Float32Array, sampleRate: number): Promise<string> {
    return this.#transcribe(samples, sampleRate);
  }

  #fail(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.error = message;
    noteError(`voice: ${message}`);
    if (this.prefs.cues) this.#player.cue('error');
  }
}

export const voice = new VoiceStore();
