import { pad, type PadEvent } from './gamepad.svelte';
import { buildTranslation, type KeyStroke, type PadTarget, type Translation } from './padkeys';
import { noteAction } from './diagnostics';

/**
 * The controller, driving the ordinary desktop.
 *
 * Game mode has its own navigation; this is the other half of the request - a
 * pad that works on the desktop *as it is*, so the notes panel, the calculator,
 * the assistant and every other module can be used from the sofa without each
 * one growing a controller path of its own. A button becomes a key press, a
 * click or a scroll, and the right stick becomes a pointer.
 *
 * ## What a synthetic event can and cannot do
 *
 * This is worth being exact about, because the limit is not obvious and it
 * shapes the whole design.
 *
 * A `KeyboardEvent` built in script carries `isTrusted: false`. Every handler
 * on the page still runs - which is the point, since that is what the modules
 * are made of - but the browser performs **no default action** for it: it does
 * not type a character into a text box, does not move focus for Tab, does not
 * scroll for Page Down. So:
 *
 * - keys are dispatched, and reach the surface's own handlers;
 * - **Tab is walked by hand**, because nothing else would move the focus;
 * - **scrolling is performed directly** on the element under the pointer;
 * - **clicks call `click()`** on the element rather than hoping a dispatched
 *   `mousedown` is honoured;
 * - **text is inserted into the field** by the on-screen keyboard rather than
 *   pressed into it.
 *
 * And none of it leaves this webview. Reaching another application means
 * `SendInput`, which the host exposes no command for; a game's own controls are
 * outside what this can do, and the settings say so plainly.
 */

export interface CursorTuning {
  /** Pixels per second at full stick deflection. */
  speed: number;
  /** How much faster a stick held to the edge becomes; 1 is constant speed. */
  accel: number;
  /** Lines per second at full deflection, for stick scrolling. */
  scrollSpeed: number;
  /** Diameter of the drawn pointer. */
  size: number;
  /** Seconds of stillness after which the pointer fades out. */
  hideAfter: number;
  /** The left stick scrolls whatever is under the pointer. */
  stickScrolls: boolean;
}

export const DEFAULT_CURSOR: CursorTuning = {
  speed: 1100,
  accel: 1.9,
  scrollSpeed: 14,
  size: 22,
  hideAfter: 3,
  stickScrolls: true,
};

/** Everything focusable, in document order - what Tab has to walk by hand. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => {
    if (el.hasAttribute('disabled') || el.getAttribute('aria-hidden') === 'true') return false;
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
}

/** The nearest ancestor that can actually scroll in the given direction. */
function scrollableAt(x: number, y: number, dx: number, dy: number): Element | null {
  let node: Element | null = document.elementFromPoint(x, y);
  while (node) {
    const style = getComputedStyle(node);
    const canY = /auto|scroll|overlay/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1;
    const canX = /auto|scroll|overlay/.test(style.overflowX) && node.scrollWidth > node.clientWidth + 1;
    if ((dy && canY) || (dx && canX)) return node;
    node = node.parentElement;
  }
  return null;
}

class PadControl {
  /** Where the drawn pointer is, in client pixels. */
  x = $state(0);
  y = $state(0);
  /** True while the pointer should be drawn; hidden when the stick is idle. */
  visible = $state(false);
  /** Lit while a click button is held, so the pointer shows the press. */
  pressing = $state(false);
  /** True while the pad is being read at all. */
  running = $state(false);

  cursor: CursorTuning = { ...DEFAULT_CURSOR };
  /** The button-to-key table in force, rebuilt when the settings change. */
  translation: Translation = {};
  /** The right stick moves a pointer. Off leaves the buttons working alone. */
  pointerEnabled = true;

  #release: (() => void) | null = null;
  #offPad: (() => void) | null = null;
  #frame: number | null = null;
  #lastFrame = 0;
  #movedAt = 0;
  /** Sub-pixel remainder, so a slow stick still moves rather than truncating. */
  #fraction = { x: 0, y: 0, scroll: 0 };

  /** Rebuilds the table from the widget's settings. */
  configure(options: {
    preset: Parameters<typeof buildTranslation>[0];
    overrides: string;
    cursor: Partial<CursorTuning>;
    pointer: boolean;
  }): void {
    this.translation = buildTranslation(options.preset, options.overrides);
    this.cursor = { ...DEFAULT_CURSOR, ...options.cursor };
    this.pointerEnabled = options.pointer;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2;
    this.#release = pad.acquire();
    this.#offPad = pad.listen((event) => this.#onPad(event));
    this.#lastFrame = performance.now();
    const tick = (now: number) => {
      this.#frame = requestAnimationFrame(tick);
      this.#drive(now);
    };
    this.#frame = requestAnimationFrame(tick);
    noteAction('pad control: driving the desktop');
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.visible = false;
    this.pressing = false;
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#offPad?.();
    this.#offPad = null;
    this.#release?.();
    this.#release = null;
  }

  /** The pointer and the stick scroll, once per frame. */
  #drive(now: number): void {
    const elapsed = Math.min(0.05, (now - this.#lastFrame) / 1000);
    this.#lastFrame = now;

    if (this.pointerEnabled) {
      const { x, y, magnitude } = pad.right;
      if (magnitude) {
        // The curve is already applied by the reader; this is the extra
        // gearing that makes a small push crawl and a full push cross the
        // screen, which is what a pointer on a stick needs to be usable.
        const speed = this.cursor.speed * Math.pow(magnitude, this.cursor.accel) * elapsed;
        const nextX = this.x + (x / magnitude) * speed + this.#fraction.x;
        const nextY = this.y + (y / magnitude) * speed + this.#fraction.y;
        const clampedX = Math.max(0, Math.min(window.innerWidth - 1, nextX));
        const clampedY = Math.max(0, Math.min(window.innerHeight - 1, nextY));
        this.#fraction.x = nextX - Math.round(nextX);
        this.#fraction.y = nextY - Math.round(nextY);
        this.x = Math.round(clampedX);
        this.y = Math.round(clampedY);
        this.visible = true;
        this.#movedAt = now;
        this.#hover();
      } else if (this.visible && this.cursor.hideAfter > 0 && now - this.#movedAt > this.cursor.hideAfter * 1000) {
        this.visible = false;
      }
    }

    if (this.cursor.stickScrolls) {
      const { y, magnitude } = pad.left;
      if (magnitude > 0) {
        const lines = y * this.cursor.scrollSpeed * 16 * elapsed + this.#fraction.scroll;
        const whole = Math.trunc(lines);
        this.#fraction.scroll = lines - whole;
        if (whole) this.#scroll(0, whole);
      }
    }
  }

  /**
   * Keeps the element under the pointer in its hover state.
   *
   * Without it the surface looks dead under a stick-driven pointer - no row
   * highlight, no button lift, none of the feedback that tells you what a
   * press would hit. `pointermove` is what the surface's own hover styles and
   * the panel glow both listen for.
   */
  #hover(): void {
    const el = document.elementFromPoint(this.x, this.y);
    if (!el) return;
    el.dispatchEvent(
      new PointerEvent('pointermove', {
        clientX: this.x,
        clientY: this.y,
        bubbles: true,
        pointerType: 'mouse',
      }),
    );
  }

  #onPad(event: PadEvent): void {
    const target = this.translation[event.button];
    if (!target) return;
    if (event.phase === 'release') {
      if (target.kind === 'click') this.pressing = false;
      if (target.kind === 'key') this.#key(target.stroke, 'keyup');
      return;
    }
    this.#fire(target, event.phase === 'repeat');
  }

  #fire(target: PadTarget, repeat: boolean): void {
    switch (target.kind) {
      case 'none':
        return;
      case 'click':
        if (!repeat) this.#click(target.button);
        return;
      case 'scroll':
        this.#scroll(target.dx * 90, target.dy * 90);
        return;
      case 'key':
        this.#key(target.stroke, 'keydown', repeat);
        return;
    }
  }

  /**
   * A key press into the document.
   *
   * Tab is handled rather than dispatched: a synthetic Tab moves no focus, and
   * the whole value of the navigation profile is that it walks the controls.
   */
  #key(stroke: KeyStroke, type: 'keydown' | 'keyup', repeat = false): void {
    if (stroke.key === 'Tab' && type === 'keydown') {
      this.#walkFocus(stroke.shiftKey ? -1 : 1);
      return;
    }

    const el = (document.activeElement as HTMLElement | null) ?? document.body;
    el.dispatchEvent(
      new KeyboardEvent(type, {
        key: stroke.key,
        code: stroke.code,
        keyCode: stroke.keyCode,
        which: stroke.keyCode,
        ctrlKey: stroke.ctrlKey,
        shiftKey: stroke.shiftKey,
        altKey: stroke.altKey,
        metaKey: stroke.metaKey,
        repeat,
        bubbles: true,
        cancelable: true,
        composed: true,
      } as KeyboardEventInit),
    );

    // Enter on a focused control is a default action, and a synthetic event
    // does not perform it - so the press is completed by hand.
    if (type === 'keydown' && (stroke.key === 'Enter' || stroke.key === ' ')) {
      const active = document.activeElement;
      if (active instanceof HTMLButtonElement || active instanceof HTMLAnchorElement) active.click();
    }
  }

  /** Focus, moved the way a real Tab would move it. */
  #walkFocus(by: 1 | -1): void {
    const list = focusables();
    if (!list.length) return;
    const at = list.indexOf(document.activeElement as HTMLElement);
    const next = list[(at + by + list.length) % list.length];
    next?.focus({ preventScroll: false });
    next?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** A click on whatever the pointer is over. */
  #click(button: 0 | 1 | 2): void {
    const el = document.elementFromPoint(this.x, this.y);
    if (!el) return;
    this.pressing = true;

    const init: MouseEventInit = {
      clientX: this.x,
      clientY: this.y,
      button,
      buttons: button === 0 ? 1 : button === 2 ? 2 : 4,
      bubbles: true,
      cancelable: true,
      composed: true,
    };

    if (button === 2) {
      // The surface's menus are opened from `contextmenu`, which is the event
      // to send rather than a right mouse-down nothing listens for.
      el.dispatchEvent(new MouseEvent('contextmenu', init));
      return;
    }

    el.dispatchEvent(new PointerEvent('pointerdown', { ...init, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mousedown', init));
    el.dispatchEvent(new PointerEvent('pointerup', { ...init, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseup', init));
    // `click()` rather than a dispatched `click`, so a button, a label and a
    // link each do what the platform makes them do.
    if (el instanceof HTMLElement) el.click();
    else el.dispatchEvent(new MouseEvent('click', init));
  }

  /** Scrolls whatever is under the pointer, falling back to the page. */
  #scroll(dx: number, dy: number): void {
    const target = scrollableAt(this.x, this.y, dx, dy);
    if (target) target.scrollBy({ left: dx, top: dy, behavior: 'auto' });
  }
}

export const padControl = new PadControl();
