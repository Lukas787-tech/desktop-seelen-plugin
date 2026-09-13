/**
 * When someone has started talking, and when they have finished.
 *
 * Fed one number per audio frame - its level in dBFS - so it is pure and
 * `npm test` can play it a made-up room. The noise floor is learned rather
 * than fixed: it follows the room down at once and up slowly, so a fan is
 * learned as the room and a voice is not. The browser's own noise suppression
 * and gain control run before any of this, which is what keeps a level-based
 * detector honest; a model-based one would cost a second copy of a neural
 * network per display for little gain after them.
 *
 * `strict` is for while the assistant is talking itself. Echo cancellation
 * removes most of its voice from the microphone, not all of it, so only a
 * clear and sustained voice may interrupt.
 */

export type Sensitivity = 'low' | 'normal' | 'high';

/**
 * `start`: speech began. `end`: it finished. `discard`: what started was too
 * short to be speech - a cough, a click, a chair. `cut`: speech has gone on as
 * long as a recogniser takes in one piece, and continues.
 */
export type VadEvent = 'start' | 'end' | 'discard' | 'cut';

export interface EndpointerOptions {
  /** Silence, in ms, that ends an utterance. */
  pauseMs: number;
  sensitivity: Sensitivity;
  /** Anything shorter is not a sentence. */
  minSpeechMs?: number;
  /** Gemma's audio encoder takes 30 seconds a clip. */
  maxSpeechMs?: number;
}

/** How far above the room's own noise a voice has to reach. */
const MARGIN: Record<Sensitivity, number> = { low: 16, normal: 11, high: 7 };
/** The quietest level that can ever count, so a dead-silent room does not make breathing a voice. */
const QUIETEST: Record<Sensitivity, number> = { low: -44, normal: -52, high: -60 };
const ONSET_MS = 100;
const STRICT_DB = 8;
const STRICT_ONSET_MS = 240;

export class Endpointer {
  floor = -65;
  speaking = false;
  #onset = 0;
  #quiet = 0;
  #length = 0;
  #last: number | null = null;

  constructor(public options: EndpointerOptions) {}

  /** How long the utterance under way has lasted, its onset included. */
  get length(): number {
    return this.#length;
  }

  update(db: number, now: number, strict = false): VadEvent | null {
    const dt = this.#last === null ? 20 : Math.min(250, Math.max(0, now - this.#last));
    this.#last = now;
    const level = Number.isFinite(db) ? db : -100;
    const { sensitivity } = this.options;
    const margin = MARGIN[sensitivity] + (strict ? STRICT_DB : 0);

    if (!this.speaking) {
      this.floor += (level - this.floor) * (level < this.floor ? 0.2 : 0.01);
      this.floor = Math.min(-30, Math.max(-90, this.floor));
      const onset = Math.max(this.floor + margin, QUIETEST[sensitivity] + (strict ? STRICT_DB : 0));
      this.#onset = level > onset ? this.#onset + dt : Math.max(0, this.#onset - dt * 2);
      if (this.#onset < (strict ? STRICT_ONSET_MS : ONSET_MS)) return null;
      this.speaking = true;
      this.#length = this.#onset;
      this.#onset = 0;
      this.#quiet = 0;
      return 'start';
    }

    // Released below where it started, so a voice trailing off at the end of a
    // sentence is still a voice.
    const release = Math.max(this.floor + margin * 0.5, QUIETEST[sensitivity] - 6);
    this.#length += dt;
    this.#quiet = level < release ? this.#quiet + dt : 0;
    if (this.#quiet >= this.options.pauseMs) {
      const voiced = this.#length - this.#quiet;
      this.reset();
      return voiced >= (this.options.minSpeechMs ?? 250) ? 'end' : 'discard';
    }
    if (this.#length >= (this.options.maxSpeechMs ?? 28_000)) {
      this.#length = 0;
      return 'cut';
    }
    return null;
  }

  /** Forgets the utterance under way; the learned room is kept. */
  reset(): void {
    this.speaking = false;
    this.#onset = 0;
    this.#quiet = 0;
    this.#length = 0;
  }
}
