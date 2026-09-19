import {
  BUTTON_ORDER,
  DEFAULT_BINDINGS,
  TRIGGERS,
  actionsFor,
  buttonAt,
  detectLayout,
  repeatsBy,
  stickDirection,
  stickVector,
  type Bindings,
  type PadAction,
  type PadButton,
  type StickVector,
} from './gamepad';

/**
 * The live controller: what is plugged in, what is being pressed, and where the
 * sticks are.
 *
 * ## The focus caveat, stated once
 *
 * `navigator.getGamepads()` only reports while the document holds focus - that
 * is Chromium's rule, not a choice made here, and it is why a controller cannot
 * summon anything while a game is in the foreground. The surface is a
 * Desktop-preset widget carrying `WS_EX_NOACTIVATE`, so it does not hold focus
 * merely by being looked at; game mode asks for the keyboard when it opens
 * (`Widget.self.focus()`, the same call `input.ts` makes for a text field) and
 * that is what turns the pad on. Everything below therefore reads nothing at
 * all until game mode is entered by hand - from the desktop's own menu or from
 * the command palette - and stops the moment focus is lost.
 *
 * ## Why polling
 *
 * The Gamepad API has no press event of its own: a pad is a snapshot, re-read
 * per frame, and a press is the difference between two snapshots. So there is
 * one `requestAnimationFrame` loop, started on the first `acquire` and stopped
 * with the last release - while game mode is closed nothing here runs at all.
 */

export interface PadInfo {
  index: number;
  id: string;
  /** False for a pad the runtime could not fit to the standard mapping. */
  standard: boolean;
  layout: ReturnType<typeof detectLayout>;
  /** 0..1 where the runtime reports it, otherwise null. */
  battery: number | null;
}

/** What a handler is told. `repeat` only ever arrives for a held direction. */
export interface PadEvent {
  button: PadButton;
  phase: 'press' | 'repeat' | 'release';
  /** Every action bound to this button, in declaration order. */
  actions: PadAction[];
  /** The pad it came from, for a setup with more than one. */
  pad: number;
}

export type PadHandler = (event: PadEvent) => void;

/** Everything the reader's behaviour is tuned by; written from the config. */
export interface PadTuning {
  bindings: Bindings;
  /** 0..0.9. Below this a stick reads as centred. */
  deadzone: number;
  /** Above 1 gives finer control near the centre. */
  curve: number;
  /** How far a stick must go to count as a d-pad step. */
  stickThreshold: number;
  /** Let the left stick move the selection, as well as the d-pad. */
  stickNavigates: boolean;
  /** First repeat of a held direction, in milliseconds. */
  repeatDelayMs: number;
  /** And every repeat after that, closing to `repeatMinMs` on a long hold. */
  repeatIntervalMs: number;
  repeatMinMs: number;
  /** How far a trigger must be pulled to read as a press. */
  triggerThreshold: number;
  /** Buzz on a press. */
  rumble: boolean;
  rumbleStrength: number;
}

export const DEFAULT_TUNING: PadTuning = {
  bindings: DEFAULT_BINDINGS,
  deadzone: 0.25,
  curve: 1.6,
  stickThreshold: 0.55,
  stickNavigates: true,
  repeatDelayMs: 420,
  repeatIntervalMs: 140,
  repeatMinMs: 60,
  triggerThreshold: 0.5,
  rumble: true,
  rumbleStrength: 0.35,
};

/** A control that is down, and since when. */
interface Held {
  since: number;
  /** Repeats already delivered, so the loop only fires what it owes. */
  fired: number;
}

/** The directions are the only controls that auto-repeat. */
const REPEATING = new Set<PadButton>(['up', 'down', 'left', 'right']);

/**
 * Chromium hands out a frozen snapshot per call, and an unplugged pad leaves a
 * hole rather than shortening the list.
 */
function readPads(): (Gamepad | null)[] {
  const pads = navigator.getGamepads?.();
  return pads ? Array.from(pads) : [];
}

class PadReader {
  /** Every pad the runtime is reporting, newest state each frame. */
  pads = $state<PadInfo[]>([]);
  /** The sticks, dead-zoned and shaped, of whichever pad moved last. */
  left = $state<StickVector>({ x: 0, y: 0, magnitude: 0 });
  right = $state<StickVector>({ x: 0, y: 0, magnitude: 0 });
  /** The triggers, 0..1, for anything that wants them analogue. */
  triggers = $state<{ l2: number; r2: number }>({ l2: 0, r2: 0 });

  tuning: PadTuning = { ...DEFAULT_TUNING };

  #users = 0;
  #frame: number | null = null;
  #handlers = new Set<PadHandler>();
  /** Per pad index, per button, when it went down. */
  #held = new Map<string, Held>();
  /** The direction each stick is currently pushed, tracked like a button. */
  #stickDir = new Map<number, 'up' | 'down' | 'left' | 'right' | null>();

  /**
   * Starts the loop and keeps it running until every caller releases it.
   *
   * Returns its release synchronously so a component can hold one for exactly
   * as long as it is mounted - the same shape the rest of the stores use.
   */
  acquire(): () => void {
    this.#users++;
    if (this.#users === 1) this.#start();

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#users--;
      if (this.#users === 0) this.#stop();
    };
  }

  /** Adds a handler for as long as the returned function is not called. */
  listen(handler: PadHandler): () => void {
    this.#handlers.add(handler);
    return () => this.#handlers.delete(handler);
  }

  get connected(): boolean {
    return this.pads.length > 0;
  }

  /** The pad the hints should be drawn for: the first one plugged in. */
  get primary(): PadInfo | null {
    return this.pads[0] ?? null;
  }

  #start(): void {
    if (this.#frame !== null) return;
    const tick = () => {
      this.#frame = requestAnimationFrame(tick);
      this.#poll();
    };
    this.#frame = requestAnimationFrame(tick);
  }

  #stop(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#held.clear();
    this.#stickDir.clear();
    this.pads = [];
    this.left = { x: 0, y: 0, magnitude: 0 };
    this.right = { x: 0, y: 0, magnitude: 0 };
    this.triggers = { l2: 0, r2: 0 };
  }

  #poll(): void {
    const now = performance.now();
    const live = readPads();
    const present: PadInfo[] = [];

    for (const pad of live) {
      if (!pad || !pad.connected) continue;
      const standard = pad.mapping === 'standard';
      present.push({
        index: pad.index,
        id: pad.id,
        standard,
        layout: detectLayout(pad.id),
        // Non-standard in every runtime that has it; absent in most.
        battery: typeof (pad as { battery?: number }).battery === 'number'
          ? (pad as { battery?: number }).battery ?? null
          : null,
      });
      this.#readPad(pad, standard, now);
    }

    // Written only when the set actually changes: this runs sixty times a
    // second, and replacing the array each frame would re-render every hint.
    if (present.length !== this.pads.length || present.some((p, i) => p.index !== this.pads[i]?.index || p.id !== this.pads[i]?.id)) {
      this.pads = present;
      // A pad unplugged mid-hold must not leave the direction stuck down.
      if (!present.length) {
        this.#held.clear();
        this.#stickDir.clear();
      }
    }

    // Anything that stopped being reported (unplugged, or focus lost) is
    // released, so the surface never sits on a phantom press.
    if (this.#held.size) this.#releaseMissing(live);
  }

  #readPad(pad: Gamepad, standard: boolean, now: number): void {
    for (let i = 0; i < pad.buttons.length; i++) {
      const button = buttonAt(i, standard);
      if (!button) continue;
      const raw = pad.buttons[i];
      if (!raw) continue;
      // A trigger is analogue and its `pressed` flag trips far too early on
      // some pads, so it is read from the value against the user's threshold.
      const down = TRIGGERS.includes(button)
        ? raw.value >= this.tuning.triggerThreshold
        : raw.pressed || raw.value >= 0.5;
      this.#track(pad.index, button, down, now);
    }

    const { deadzone, curve, stickThreshold, stickNavigates } = this.tuning;
    const lx = pad.axes[0] ?? 0;
    const ly = pad.axes[1] ?? 0;
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;

    const left = stickVector(lx, ly, deadzone, curve);
    const right = stickVector(rx, ry, deadzone, curve);

    // Only the pad actually being moved writes the shared sticks, so a second
    // controller resting on a table cannot zero the one in use.
    if (left.magnitude || right.magnitude || !this.#anyHeld(pad.index)) {
      if (this.left.x !== left.x || this.left.y !== left.y) this.left = left;
      if (this.right.x !== right.x || this.right.y !== right.y) this.right = right;
    }

    const l2 = pad.buttons[6]?.value ?? 0;
    const r2 = pad.buttons[7]?.value ?? 0;
    if (this.triggers.l2 !== l2 || this.triggers.r2 !== r2) this.triggers = { l2, r2 };

    /*
     * The left stick, treated as a fifth d-pad.
     *
     * Tracked as one control with a direction rather than as four buttons: a
     * stick rolled from up to left must release `up` and press `left`, and
     * four independent booleans would leave both down through the roll.
     */
    if (stickNavigates) {
      const direction = stickDirection(lx, ly, stickThreshold);
      const before = this.#stickDir.get(pad.index) ?? null;
      if (direction !== before) {
        if (before) this.#track(pad.index, before, false, now, 'stick');
        this.#stickDir.set(pad.index, direction);
        if (direction) this.#track(pad.index, direction, true, now, 'stick');
      } else if (direction) {
        this.#track(pad.index, direction, true, now, 'stick');
      }
    }
  }

  #anyHeld(index: number): boolean {
    for (const key of this.#held.keys()) if (key.startsWith(`${index}:`)) return true;
    return false;
  }

  /**
   * One control's transition, and the repeats it owes.
   *
   * `source` keeps the d-pad and the stick apart in the held map, so holding
   * both at once is one press each rather than one press that the other one
   * cancels on release.
   */
  #track(
    index: number,
    button: PadButton,
    down: boolean,
    now: number,
    source: 'button' | 'stick' = 'button',
  ): void {
    const key = `${index}:${source}:${button}`;
    const held = this.#held.get(key);

    if (!down) {
      if (!held) return;
      this.#held.delete(key);
      this.#emit(button, 'release', index);
      return;
    }

    if (!held) {
      this.#held.set(key, { since: now, fired: 1 });
      this.#emit(button, 'press', index);
      this.#buzz(index);
      return;
    }

    if (!REPEATING.has(button)) return;

    const owed = repeatsBy(
      now - held.since,
      this.tuning.repeatDelayMs,
      this.tuning.repeatIntervalMs,
      this.tuning.repeatMinMs,
    );
    // A frame that ran long fires every step it owes rather than losing them,
    // which is what keeps a held direction moving at a steady rate.
    for (let i = held.fired; i < owed; i++) this.#emit(button, 'repeat', index);
    if (owed > held.fired) held.fired = owed;
  }

  /** Releases anything whose pad stopped answering between two frames. */
  #releaseMissing(live: (Gamepad | null)[]): void {
    const alive = new Set(live.filter((pad) => pad?.connected).map((pad) => pad?.index));
    for (const key of [...this.#held.keys()]) {
      const index = Number(key.slice(0, key.indexOf(':')));
      if (alive.has(index)) continue;
      const button = key.slice(key.lastIndexOf(':') + 1) as PadButton;
      this.#held.delete(key);
      this.#emit(button, 'release', index);
    }
  }

  #emit(button: PadButton, phase: PadEvent['phase'], pad: number): void {
    const event: PadEvent = {
      button,
      phase,
      actions: actionsFor(button, this.tuning.bindings),
      pad,
    };
    // Copied, so a handler that removes itself mid-press cannot skip the next.
    for (const handler of [...this.#handlers]) {
      try {
        handler(event);
      } catch (err) {
        console.error('[gamepad] handler failed', err);
      }
    }
  }

  /**
   * A short buzz on a press.
   *
   * Best-effort by design: `vibrationActuator` is absent on plenty of pads and
   * throws on others, and a controller that cannot rumble must not break the
   * button that asked it to.
   */
  #buzz(index: number): void {
    if (!this.tuning.rumble || !this.tuning.rumbleStrength) return;
    this.pulse(index, this.tuning.rumbleStrength * 0.6, 60);
  }

  /** A buzz anyone can ask for - a launch, a refusal, a boundary. */
  pulse(index: number, strength: number, durationMs: number): void {
    const pad = readPads().find((p) => p?.index === index);
    const actuator = (pad as { vibrationActuator?: { playEffect?: (type: string, options: unknown) => Promise<unknown> } } | null | undefined)
      ?.vibrationActuator;
    if (!actuator?.playEffect) return;
    void actuator
      .playEffect('dual-rumble', {
        startDelay: 0,
        duration: durationMs,
        weakMagnitude: Math.min(1, strength),
        strongMagnitude: Math.min(1, strength * 0.7),
      })
      .catch(() => {
        /* a pad that will not buzz is not an error worth reporting */
      });
  }

  /** The same, on whichever pad is in use. */
  buzzPrimary(strength: number, durationMs: number): void {
    const pad = this.primary;
    if (pad) this.pulse(pad.index, strength, durationMs);
  }

  /** Every button currently down, for the settings dialog's live tester. */
  pressed(): PadButton[] {
    const down = new Set<PadButton>();
    for (const key of this.#held.keys()) down.add(key.slice(key.lastIndexOf(':') + 1) as PadButton);
    return BUTTON_ORDER.filter((button) => down.has(button));
  }

}

export const pad = new PadReader();

/** Re-exported so a component needs one import to draw a hint. */
export { glyphFor, labelFor, resolveLayout } from './gamepad';
