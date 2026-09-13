import { levelDb } from './pcm';

/**
 * The microphone and the speaker, for the voice mode.
 *
 * The microphone is asked for with the browser's echo cancellation, noise
 * suppression and gain control on. Echo cancellation is what lets the user
 * talk over the assistant: Chromium cancels what this page itself plays, so a
 * reply played through Web Audio is mostly gone from the microphone. A
 * Windows voice is spoken by the system, not by the page, and is not cancelled
 * - which is why interrupting is switched off while one is talking.
 */

/**
 * Collects 20 ms frames on the audio thread. Loaded from a Blob URL; a host
 * whose content security policy refuses that gets `ScriptProcessorNode`
 * instead, which runs on the main thread and can drop audio while the panel is
 * busy rendering a reply.
 */
const TAP = `class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.size = Math.round(sampleRate / 50); this.buffer = new Float32Array(this.size); this.fill = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.fill++] = channel[i];
        if (this.fill === this.size) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(this.size);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('ralfm-mic-tap', Tap);`;

function microphoneMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was refused.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  if (name === 'NotReadableError') return 'The microphone is in use by another app.';
  return `The microphone could not be opened${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
}

/** `samples` is only valid during the call; copy it to keep it. `at` is ms of audio heard so far. */
export type FrameHandler = (samples: Float32Array, db: number, at: number) => void;

export class Microphone {
  readonly sampleRate: number;
  #heard = 0;

  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly nodes: AudioNode[],
    readonly tap: 'worklet' | 'script',
  ) {
    this.sampleRate = context.sampleRate;
  }

  static async open(onFrame: FrameHandler): Promise<Microphone> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This webview offers no microphone.');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      throw new Error(microphoneMessage(err));
    }

    const context = new AudioContext({ latencyHint: 'interactive' });
    if (context.state === 'suspended') await context.resume().catch(() => {});
    const source = context.createMediaStreamSource(stream);
    // Nothing is played back, but a node that reaches no destination may not be pulled.
    const sink = context.createGain();
    sink.gain.value = 0;
    sink.connect(context.destination);

    let mic: Microphone;
    const deliver = (samples: Float32Array) => {
      const at = mic.#heard;
      mic.#heard += (samples.length / mic.sampleRate) * 1000;
      onFrame(samples, levelDb(samples), at);
    };

    try {
      const url = URL.createObjectURL(new Blob([TAP], { type: 'text/javascript' }));
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, 'ralfm-mic-tap', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
      node.port.onmessage = (event: MessageEvent<Float32Array>) => deliver(event.data);
      source.connect(node).connect(sink);
      mic = new Microphone(stream, context, [source, node, sink], 'worklet');
    } catch {
      const node = context.createScriptProcessor(1024, 1, 1);
      node.onaudioprocess = (event) => deliver(event.inputBuffer.getChannelData(0));
      source.connect(node).connect(sink);
      mic = new Microphone(stream, context, [source, node, sink], 'script');
    }
    return mic;
  }

  close(): void {
    for (const track of this.stream.getTracks()) track.stop();
    for (const node of this.nodes) {
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
    }
    void this.context.close().catch(() => {});
  }
}

/** Plays synthesised speech and the listening cues, and says how loud it is right now. */
export class Player {
  #context: AudioContext | null = null;
  #gain: GainNode | null = null;
  #analyser: AnalyserNode | null = null;
  #probe = new Float32Array(512);

  #ready(): { context: AudioContext; gain: GainNode } {
    if (!this.#context || this.#context.state === 'closed') {
      const context = new AudioContext({ latencyHint: 'interactive' });
      const gain = context.createGain();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      gain.connect(analyser).connect(context.destination);
      this.#context = context;
      this.#gain = gain;
      this.#analyser = analyser;
    }
    if (this.#context.state === 'suspended') void this.#context.resume().catch(() => {});
    return { context: this.#context, gain: this.#gain as GainNode };
  }

  /** Decodes and plays one clip; settles when it ends or `signal` stops it. */
  async play(bytes: ArrayBuffer | Uint8Array, signal: AbortSignal): Promise<void> {
    const { context, gain } = this.#ready();
    // A context the webview will not start never advances its clock, so a clip
    // started in it never ends - and the queue behind it would wait for ever.
    if (context.state !== 'running') {
      await Promise.race([context.resume().catch(() => {}), new Promise((done) => setTimeout(done, 1500))]);
      // Re-read after the wait; the narrowed type above does not know `resume` ran.
      if ((context.state as AudioContextState) !== 'running') throw new Error('This webview is not letting the assistant play sound.');
    }
    const copy = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    const buffer = await context.decodeAudioData(copy as ArrayBuffer);
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      const halt = () => {
        try {
          source.stop();
        } catch {
          /* not started, or already over */
        }
      };
      const finish = () => {
        clearTimeout(watchdog);
        signal.removeEventListener('abort', halt);
        source.disconnect();
        resolve();
      };
      // `ended` is the only signal a clip is over; if a device change swallows
      // it, the clip's own length is.
      const watchdog = setTimeout(finish, (buffer.duration + 2) * 1000);
      source.onended = finish;
      signal.addEventListener('abort', halt, { once: true });
      source.start();
    });
  }

  /** 0..1, for the orb. */
  level(): number {
    if (!this.#analyser) return 0;
    this.#analyser.getFloatTimeDomainData(this.#probe);
    return Math.max(0, Math.min(1, (levelDb(this.#probe) + 50) / 40));
  }

  /** Two soft notes: rising when it starts listening, falling when it stops. */
  cue(kind: 'listen' | 'stop' | 'error'): void {
    try {
      const { context, gain } = this.#ready();
      const notes = kind === 'listen' ? [660, 880] : kind === 'stop' ? [880, 587] : [330, 247];
      notes.forEach((hz, i) => {
        const at = context.currentTime + 0.02 + i * 0.09;
        const osc = context.createOscillator();
        const envelope = context.createGain();
        osc.type = 'sine';
        osc.frequency.value = hz;
        envelope.gain.setValueAtTime(0.0001, at);
        envelope.gain.exponentialRampToValueAtTime(0.06, at + 0.015);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(envelope).connect(gain);
        osc.start(at);
        osc.stop(at + 0.18);
      });
    } catch {
      /* no audio device is not worth failing over */
    }
  }

  close(): void {
    void this.#context?.close().catch(() => {});
    this.#context = null;
  }
}

/** Plays one piece; handed the signal that stops it. */
export type Playback = (signal: AbortSignal) => Promise<void>;

/**
 * Speaks pieces of a reply in order while the next ones are synthesised.
 *
 * Up to `ahead` pieces are prepared before they are needed, so the gap between
 * two sentences is the time to play one rather than the time to synthesise
 * one. `stop` drops everything - what is playing, what is prepared and what is
 * still being synthesised.
 */
interface QueueItem {
  text: string;
  abort: AbortController;
  ready?: Promise<Playback | null>;
}

export class SpeechQueue {
  #items: QueueItem[] = [];
  #running = false;
  #epoch = 0;
  #waiters: (() => void)[] = [];

  constructor(
    private readonly prepare: (text: string, signal: AbortSignal) => Promise<Playback>,
    private readonly onSpeaking: (text: string | null) => void,
    private readonly onError: (err: unknown) => void,
    private readonly ahead = 2,
  ) {}

  get busy(): boolean {
    return this.#running || this.#items.length > 0;
  }

  add(text: string): void {
    if (!text.trim()) return;
    this.#items.push({ text, abort: new AbortController() });
    this.#kick();
    void this.#pump();
  }

  stop(): void {
    this.#epoch++;
    for (const item of this.#items) item.abort.abort();
    this.#items = [];
    this.onSpeaking(null);
  }

  /** Settles once everything queued has been spoken, or stopped. */
  idle(): Promise<void> {
    return this.busy ? new Promise((resolve) => this.#waiters.push(resolve)) : Promise.resolve();
  }

  #kick(): void {
    for (const item of this.#items.slice(0, this.ahead + 1)) {
      item.ready ??= this.prepare(item.text, item.abort.signal).catch((err) => {
        if (!item.abort.signal.aborted) this.onError(err);
        return null;
      });
    }
  }

  async #pump(): Promise<void> {
    if (this.#running) return;
    this.#running = true;
    while (this.#items.length) {
      const epoch = this.#epoch;
      this.#kick();
      const item = this.#items[0] as QueueItem;
      const play = await item.ready;
      if (epoch !== this.#epoch) continue;
      if (play) {
        this.onSpeaking(item.text);
        try {
          await play(item.abort.signal);
        } catch (err) {
          if (!item.abort.signal.aborted) this.onError(err);
        }
      }
      if (epoch !== this.#epoch) continue;
      this.#items.shift();
    }
    this.#running = false;
    this.onSpeaking(null);
    for (const done of this.#waiters.splice(0)) done();
  }
}

/** Windows' voices, once the webview has listed them - which it does late. */
export function systemVoices(): Promise<SpeechSynthesisVoice[]> {
  const synth = globalThis.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => resolve(synth.getVoices());
    synth.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export function speakWithSystem(text: string, voice: SpeechSynthesisVoice | null, rate: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const synth = globalThis.speechSynthesis;
    if (!synth || signal.aborted) return resolve();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = rate;
    const finish = () => {
      signal.removeEventListener('abort', halt);
      resolve();
    };
    const halt = () => {
      synth.cancel();
      finish();
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    signal.addEventListener('abort', halt, { once: true });
    synth.speak(utterance);
  });
}
