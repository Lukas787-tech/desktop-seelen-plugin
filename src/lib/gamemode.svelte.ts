import { Widget } from './seelen';
import { noteAction } from './diagnostics';
import { pad, type PadEvent } from './gamepad.svelte';
import { firstIn, nearestTo, pickNeighbour, type NavDirection, type NavRect } from './navgrid';
import { games } from './games.svelte';
import { activateWindow } from './windows.svelte';
import type { PadAction } from './gamepad';

/**
 * Game mode: the display, turned into a console.
 *
 * ## What it is
 *
 * One replica of the surface - the display the user picked - stops drawing
 * icons and module panels and draws a full-screen launcher instead. It is the
 * same surface, with the same wallpaper, theme, fonts and colour scheme
 * underneath, so it is the desktop's own look at ten feet rather than a second
 * application pretending to be one. Every other display carries on as it was.
 *
 * It stays on the desktop layer: it is the *desktop* of that display, revealed
 * by minimising what is over it exactly as the desktop always is, and a game
 * launched from it covers it like any other window. That was a deliberate
 * choice over a topmost takeover - a launcher that floats over a running game
 * is a launcher that has to be fought with.
 *
 * ## Why it holds the keyboard
 *
 * `navigator.getGamepads()` reports nothing unless the document has focus, and
 * a Desktop-preset widget never takes focus on its own (see `input.ts`). So
 * entering game mode asks for the keyboard, and keeps asking while it is open
 * if the user wants it to - that request is the whole reason a controller works
 * here at all, and letting it go is how leaving gives the desktop back.
 *
 * ## Navigation
 *
 * Every control registers its element with `register`, and a direction is
 * answered geometrically by `navgrid.ts` rather than by a tab order. That is
 * what lets a section rail, a shelf of covers and a column of settings share
 * one screen and still move the way they look like they should.
 */

export type GameSection = 'home' | 'library' | 'add' | 'running' | 'apps' | 'settings' | 'power';

export const SECTION_LABELS: Record<GameSection, string> = {
  home: 'Home',
  library: 'Library',
  add: 'Add games',
  running: 'Running',
  apps: 'Apps',
  settings: 'Settings',
  power: 'Power',
};

/** What happens to game mode when a game is started from it. */
export type LaunchBehaviour = 'stay' | 'leave';

interface NavItem {
  el: HTMLElement;
  group?: string;
  disabled?: boolean;
  /** Run instead of clicking the element, where a click is not what is meant. */
  onactivate?: () => void;
  /** The pad's "details" button, for a control that has a second action. */
  ondetails?: () => void;
  /**
   * Left and right change this control's *value* rather than moving off it.
   *
   * For the settings list, where a row is a slider or a choice and there is
   * nothing to either side of it anyway - which is what lets a console-style
   * screen edit a setting with the same four directions it browses with.
   */
  onadjust?: (by: 1 | -1) => void;
}

/** Registration options, as a component passes them. */
export interface NavOptions {
  group?: string;
  disabled?: boolean;
  onactivate?: () => void;
  ondetails?: () => void;
  onadjust?: (by: 1 | -1) => void;
  /** Take the selection on mount - the first tile of a freshly opened section. */
  autofocus?: boolean;
}

class GameModeStore {
  /** True while this replica is showing the launcher. */
  active = $state(false);
  section = $state<GameSection>('home');
  /** The control the pad is on. */
  focusId = $state<string | null>(null);
  /** The search text, typed on the screen keyboard or a real one. */
  query = $state('');
  /** The on-screen keyboard, for a controller with no keyboard beside it. */
  keyboard = $state(false);
  /** The game whose details pane is open, if any. */
  detailsFor = $state<string | null>(null);
  /** Shown briefly after an action that has no other visible result. */
  toast = $state<string | null>(null);

  /**
   * The last game the selection was actually on.
   *
   * The hero and the backdrop follow the selection, and the selection spends
   * plenty of time on things that are not games - the section rail, the search
   * button, a details sheet. Following it literally blanked the hero and
   * dropped the backdrop to black every time, which read as a flicker rather
   * than as information. So the last game stands until another one takes over.
   */
  lastGame = $state<string | null>(null);

  /** True while the surface is believed to hold the keyboard. */
  hasKeyboard = $state(false);

  /** Set from the surface: whether the user wants focus re-taken when lost. */
  keepFocus = true;
  /** Set from the surface: what a launch does to the launcher. */
  onLaunch: LaunchBehaviour = 'stay';

  #items = new Map<string, NavItem>();
  #offPad: (() => void) | null = null;
  #offKeys: (() => void) | null = null;
  #releasePad: (() => void) | null = null;
  #releaseGames: (() => void) | null = null;
  #toastTimer: ReturnType<typeof setTimeout> | undefined;
  /** Where the selection was, per section, so going back returns to it. */
  #lastFocus = new Map<GameSection, string>();

  /* ------------------------------------------------------------ opening -- */

  /**
   * Opens the launcher on this replica.
   *
   * Idempotent: the trigger that opens it reaches every replica and the menu
   * can be used twice, and neither should stack a second set of listeners.
   */
  enter(reason = 'asked'): void {
    if (this.active) return;
    this.active = true;
    this.section = 'home';
    this.query = '';
    this.detailsFor = null;
    this.keyboard = false;

    // The library is the whole point of the screen, and nothing else here holds
    // it open - the games panel may well be switched off on this display.
    this.#releaseGames = games.acquire();
    this.#releasePad = pad.acquire();
    this.#offPad = pad.listen((event) => this.#onPad(event));
    this.#listenKeys();
    this.takeKeyboard();
    noteAction(`game mode: entered (${reason})`);
  }

  leave(reason = 'asked'): void {
    if (!this.active) return;
    this.active = false;
    this.focusId = null;
    this.lastGame = null;
    this.detailsFor = null;
    this.keyboard = false;
    this.query = '';
    this.#items.clear();
    this.#lastFocus.clear();
    this.#offPad?.();
    this.#offPad = null;
    this.#offKeys?.();
    this.#offKeys = null;
    this.#releasePad?.();
    this.#releasePad = null;
    this.#releaseGames?.();
    this.#releaseGames = null;
    this.hasKeyboard = false;
    noteAction(`game mode: left (${reason})`);
  }

  toggle(reason = 'asked'): void {
    if (this.active) this.leave(reason);
    else this.enter(reason);
  }

  /**
   * Asks the host for the keyboard, which is also what turns the pad on.
   *
   * The same `request_focus` the text fields use: a desktop widget cannot take
   * the foreground with `SetForegroundWindow` alone.
   */
  takeKeyboard(): void {
    void Widget.self
      .focus()
      .then(() => {
        this.hasKeyboard = true;
      })
      .catch((err) => {
        this.hasKeyboard = false;
        console.error('[game mode] could not take the keyboard', err);
      });
  }

  /** Called by the surface when the host says the foreground moved elsewhere. */
  onForegroundLost(): void {
    if (!this.active) return;
    this.hasKeyboard = false;
    // Only when asked for: a user who alt-tabs to something else while the
    // launcher is open should be allowed to stay there.
    if (this.keepFocus) this.takeKeyboard();
  }

  onForegroundTaken(): void {
    if (this.active) this.hasKeyboard = true;
  }

  /* ----------------------------------------------------------- registry -- */

  /**
   * Registers one control for as long as it is on screen.
   *
   * Elements rather than rectangles: a shelf scrolls, a section changes height
   * as art loads, and a stored rectangle would be wrong by the time a direction
   * was pressed. They are measured at the moment of the press instead.
   */
  register(id: string, item: NavItem, autofocus = false): () => void {
    this.#items.set(id, item);
    if (autofocus || this.focusId === null) this.focus(id);
    return () => {
      this.#items.delete(id);
      // The selection cannot be left pointing at something that has gone -
      // the next direction would have nowhere to measure from.
      if (this.focusId === id) this.focusId = this.#fallbackNear(item.el);
    };
  }

  /**
   * Swaps in a control's handlers without disturbing the selection.
   *
   * The action's parameters are an inline object, so Svelte calls `update` on
   * every render of the row it is on. Unregistering and re-registering would be
   * correct but would move the selection off the very control being re-rendered
   * - which is exactly the control the user is holding a button on.
   */
  replace(id: string, item: NavItem): void {
    if (this.#items.has(id)) this.#items.set(id, item);
  }

  /** The rectangles, as they are right now. */
  #rects(): NavRect[] {
    const rects: NavRect[] = [];
    for (const [id, item] of this.#items) {
      const box = item.el.getBoundingClientRect();
      // A control scrolled out of its row, or collapsed, is not somewhere the
      // selection should be able to land.
      if (box.width < 1 || box.height < 1) continue;
      rects.push({ id, x: box.x, y: box.y, w: box.width, h: box.height, group: item.group, disabled: item.disabled });
    }
    return rects;
  }

  #fallbackNear(el: HTMLElement): string | null {
    const box = el.getBoundingClientRect();
    const rects = this.#rects();
    return nearestTo(rects, box.x + box.width / 2, box.y + box.height / 2) ?? firstIn(rects);
  }

  focus(id: string | null): void {
    if (id === this.focusId) return;
    this.focusId = id;
    if (!id) return;
    const game = gameOfNavId(id);
    if (game) this.lastGame = game;
    this.#lastFocus.set(this.section, id);
    const item = this.#items.get(id);
    // `nearest` rather than `center`: a shelf centred on every step slides the
    // whole row under the eye for a one-tile move, which reads as drift.
    item?.el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  /** Puts the selection somewhere sensible after a section change. */
  focusFirst(group?: string): void {
    const rects = this.#rects();
    const remembered = this.#lastFocus.get(this.section);
    if (remembered && rects.some((rect) => rect.id === remembered && !rect.disabled)) {
      this.focus(remembered);
      return;
    }
    this.focus(firstIn(rects, group));
  }

  /* --------------------------------------------------------- navigation -- */

  move(direction: NavDirection): void {
    const rects = this.#rects();
    if (!this.focusId) {
      this.focus(firstIn(rects));
      return;
    }

    // A slider or a choice takes left and right for itself; see `onadjust`.
    const item = this.#items.get(this.focusId);
    if (item?.onadjust && (direction === 'left' || direction === 'right')) {
      item.onadjust(direction === 'right' ? 1 : -1);
      pad.buzzPrimary(0.18, 25);
      return;
    }
    const next = pickNeighbour(this.focusId, rects, direction);
    if (next) {
      this.focus(next);
    } else {
      // Nothing that way. A short buzz says the edge was reached, which is what
      // a console does instead of silently ignoring the press.
      pad.buzzPrimary(0.2, 40);
    }
  }

  activate(): void {
    const item = this.focusId ? this.#items.get(this.focusId) : null;
    if (!item || item.disabled) return;
    pad.buzzPrimary(0.5, 70);
    if (item.onactivate) item.onactivate();
    else item.el.click();
  }

  details(): void {
    const item = this.focusId ? this.#items.get(this.focusId) : null;
    item?.ondetails?.();
  }

  /**
   * Back, one layer at a time.
   *
   * The order matters: a press should close whatever is most recently on top,
   * and only leave game mode when there is nothing left to close - so the
   * button that dismisses a details pane cannot also drop the user onto the
   * desktop if they press it once too often.
   */
  back(): void {
    if (this.keyboard) {
      this.keyboard = false;
      return;
    }
    if (this.detailsFor) {
      this.detailsFor = null;
      return;
    }
    if (this.query) {
      this.query = '';
      return;
    }
    if (this.section !== 'home') {
      this.go('home');
      return;
    }
    this.leave('back');
  }

  go(section: GameSection): void {
    if (this.section === section) return;
    this.section = section;
    this.detailsFor = null;
    this.focusId = null;
    // After the new section's controls have registered themselves.
    queueMicrotask(() => this.focusFirst());
  }

  /** The section rail, in order, for the shoulder buttons to step through. */
  sections: GameSection[] = ['home', 'library', 'running', 'apps', 'settings', 'power'];

  step(by: 1 | -1): void {
    const at = this.sections.indexOf(this.section);
    const next = this.sections[(at + by + this.sections.length) % this.sections.length];
    if (next) this.go(next);
  }

  /* -------------------------------------------------------------- games -- */

  /** Starts a game, or switches to it when it is already running. */
  play(id: string): void {
    const game = games.find(id);
    if (!game) return;
    const window = games.windowFor(game);
    if (window) {
      void activateWindow(window.hwnd, game.customName ?? game.name);
    } else {
      games.play(id);
    }
    pad.buzzPrimary(0.8, 180);
    this.say(window ? 'Switching to it' : 'Starting...');
    // A launch that leaves the launcher up means the game opens over it, which
    // is what most people want; leaving is offered for the other habit.
    if (this.onLaunch === 'leave') this.leave('a game was launched');
  }

  /** A one-line message on the launcher, for an action with no other result. */
  say(message: string): void {
    this.toast = message;
    clearTimeout(this.#toastTimer);
    this.#toastTimer = setTimeout(() => (this.toast = null), 2400);
  }

  /* ---------------------------------------------------------------- pad -- */

  #onPad(event: PadEvent): void {
    if (!this.active) return;
    if (event.phase === 'release') return;

    for (const action of event.actions) {
      // A repeat is only ever meaningful for movement; a held confirm must not
      // launch a game forty times.
      if (event.phase === 'repeat' && !isDirection(action)) continue;
      this.#run(action);
    }
  }

  #run(action: PadAction): void {
    switch (action) {
      case 'up':
      case 'down':
      case 'left':
      case 'right':
        this.move(action);
        return;
      case 'confirm':
        this.activate();
        return;
      case 'back':
        this.back();
        return;
      case 'details':
        this.details();
        return;
      case 'favourite': {
        const id = this.focusedGame();
        if (id) {
          games.toggleFavourite(id);
          const game = games.find(id);
          this.say(game?.favourite ? 'Added to favourites' : 'Removed from favourites');
          pad.buzzPrimary(0.4, 60);
        }
        return;
      }
      case 'search':
        this.keyboard = !this.keyboard;
        return;
      case 'menu':
        this.go(this.section === 'settings' ? 'home' : 'settings');
        return;
      case 'sectionPrev':
        this.step(-1);
        return;
      case 'sectionNext':
        this.step(1);
        return;
      case 'pageUp':
      case 'pageDown': {
        // A trigger jumps a screenful, which on a shelf of covers is what makes
        // a library of two hundred games crossable.
        const direction = action === 'pageUp' ? 'up' : 'down';
        for (let i = 0; i < 4; i++) this.move(direction);
        return;
      }
      case 'quit':
        this.leave('the quit button');
        return;
    }
  }

  /** The game the selection is on, if it is on one. */
  focusedGame(): string | null {
    return gameOfNavId(this.focusId);
  }

  /* ----------------------------------------------------------- keyboard -- */

  /**
   * The real keyboard, which works here too.
   *
   * Game mode holds the foreground while it is open, so the arrow keys, Enter
   * and Escape all arrive - and someone setting the thing up at their desk
   * should not have to reach for a controller to do it.
   */
  #listenKeys(): void {
    const onKey = (event: KeyboardEvent) => {
      if (!this.active) return;
      // A real text field - the search box - keeps its own keys.
      const target = event.target;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          if (typing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return;
          event.preventDefault();
          this.move(event.key.slice(5).toLowerCase() as NavDirection);
          return;
        }
        case 'Enter':
          if (typing) return;
          event.preventDefault();
          this.activate();
          return;
        case 'Escape':
          event.preventDefault();
          this.back();
          return;
        case 'Tab':
          event.preventDefault();
          this.step(event.shiftKey ? -1 : 1);
          return;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    this.#offKeys = () => window.removeEventListener('keydown', onKey, { capture: true });
  }
}

function isDirection(action: PadAction): boolean {
  return action === 'up' || action === 'down' || action === 'left' || action === 'right';
}

/**
 * A tile's navigation id.
 *
 * The row is part of it because the same game legitimately appears in two rows
 * at once - "continue playing" and "all games" both hold it - and two controls
 * sharing one id would make the selection ambiguous and the geometry wrong.
 */
export function gameNavId(gameId: string, row: string): string {
  return `game:${gameId}#${row}`;
}

/** The game a navigation id belongs to, if it belongs to one. */
export function gameOfNavId(navId: string | null): string | null {
  if (!navId?.startsWith('game:')) return null;
  const rest = navId.slice('game:'.length);
  const hash = rest.indexOf('#');
  return hash < 0 ? rest : rest.slice(0, hash);
}

export const gameMode = new GameModeStore();

/**
 * Registers a control with the launcher's navigation for as long as it exists.
 *
 * Used as `use:navItem={{ id, group }}` so a component says what it is and
 * nothing more; the store owns the measuring, the ordering and the selection.
 */
export function navItem(
  node: HTMLElement,
  options: NavOptions & { id: string },
): { update: (next: NavOptions & { id: string }) => void; destroy: () => void } {
  const itemFor = (options: NavOptions): NavItem => ({
    el: node,
    group: options.group,
    disabled: options.disabled,
    onactivate: options.onactivate,
    ondetails: options.ondetails,
    onadjust: options.onadjust,
  });

  let id = options.id;
  let release = gameMode.register(id, itemFor(options), options.autofocus);

  return {
    update(next) {
      // The common case by far: the same control, re-rendered. Swapping the
      // handlers in place keeps the selection where the user put it.
      if (next.id === id) {
        gameMode.replace(id, itemFor(next));
        return;
      }
      release();
      id = next.id;
      release = gameMode.register(id, itemFor(next));
    },
    destroy() {
      release();
    },
  };
}

/** Whether this replica is the one game mode belongs to. */
export function ownsGameMode(monitorId: string | null, setting: string, isPrimary: boolean): boolean {
  const wanted = setting.trim();
  if (!wanted) return isPrimary;
  return monitorId === wanted;
}
