import { SeelenCommand, SeelenEvent, Settings, invoke, subscribe } from './seelen';
import { noteError } from './diagnostics';
import { THEME_ID, encodeKnob, type ThemeKnob } from './shell-theme';

/**
 * The parts of Seelen's own settings that decide how the shell looks: the
 * Desktop Surface theme's variables, whether that theme is on, and which icon
 * packs are active. What the Appearance dialog's Shell tab edits, so none of it
 * needs Seelen's Settings window.
 *
 * Written the way `config.svelte.ts` writes the widget's settings: coalesced,
 * debounced, applied to a freshly read copy of the file because the host
 * rewrites it whole, and kept on top of every re-read until it has landed so a
 * slider never springs back mid-drag.
 */

interface RawSettings {
  byTheme?: Record<string, Record<string, string> | undefined>;
  activeThemes?: string[];
  activeIconPacks?: string[];
}

export interface IconPackInfo {
  id: string;
  name: string;
  description: string;
}

/** A resource's display text, which is a plain string or a map of languages. */
function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const byLanguage = value as Record<string, string>;
    return byLanguage.en ?? Object.values(byLanguage)[0] ?? '';
  }
  return '';
}

class ShellSettings {
  /** The theme's stored variables; a name that is absent is at its default. */
  values = $state<Record<string, string>>({});
  /** Null until read. */
  themeActive = $state<boolean | null>(null);
  activePacks = $state<string[]>([]);
  packs = $state<IconPackInfo[]>([]);

  /** Edits not yet on disk, by variable; `null` removes it. */
  #knobs = new Map<string, string | null>();
  #themeActive: boolean | null = null;
  #packs: string[] | null = null;

  #timer: ReturnType<typeof setTimeout> | undefined;
  #inFlight: Promise<void> = Promise.resolve();
  #users = 0;
  #off: (() => void) | null = null;

  /**
   * Follows the settings file for as long as something is showing these.
   * Counted, so a dialog closing does not stop the one that opened after it.
   */
  start(): () => void {
    this.#users++;
    if (this.#users === 1) {
      void this.#refresh();
      void this.#loadPacks();
      void subscribe(SeelenEvent.StateSettingsChanged, () => void this.#refresh()).then((off) => {
        if (this.#users === 0) off();
        else this.#off = off;
      });
    }
    return () => {
      this.#users--;
      if (this.#users > 0) return;
      this.#off?.();
      this.#off = null;
      void this.flush();
    };
  }

  #loaded: Promise<void> | null = null;

  /** Reads the settings once, for a caller that needs the values without following them. */
  ensureLoaded(): Promise<void> {
    this.#loaded ??= this.#refresh();
    return this.#loaded;
  }

  set(knob: ThemeKnob, value: string | number): void {
    this.setStored(knob.name, encodeKnob(knob, value));
  }

  /** A value already in the stored format, from a pasted appearance. */
  setStored(name: string, stored: string): void {
    this.values = { ...this.values, [name]: stored };
    this.#knobs.set(name, stored);
    this.#schedule();
  }

  reset(name: string): void {
    const next = { ...this.values };
    delete next[name];
    this.values = next;
    this.#knobs.set(name, null);
    this.#schedule();
  }

  setThemeActive(on: boolean): void {
    this.themeActive = on;
    this.#themeActive = on;
    this.#schedule();
  }

  /**
   * An icon pack on or off. A pack switched on goes to the end of the list,
   * which is where Seelen puts what should win - the same order in which the
   * Desktop Surface theme sits after the default theme.
   */
  setPackActive(id: string, on: boolean): void {
    const rest = this.activePacks.filter((pack) => pack !== id);
    this.activePacks = on ? [...rest, id] : rest;
    this.#packs = this.activePacks;
    this.#schedule();
  }

  async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
      this.#write();
    }
    await this.#inFlight;
  }

  #schedule(delayMs = 250): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#write();
    }, delayMs);
  }

  #write(): void {
    const knobs = new Map(this.#knobs);
    const themeActive = this.#themeActive;
    const packs = this.#packs;
    if (!knobs.size && themeActive === null && packs === null) return;

    this.#inFlight = this.#inFlight
      .then(async () => {
        const settings = await Settings.getAsync();
        const raw = settings.inner as unknown as RawSettings;

        const theme = ((raw.byTheme ??= {})[THEME_ID] ??= {});
        for (const [name, stored] of knobs) {
          if (stored === null) delete theme[name];
          else theme[name] = stored;
        }

        if (themeActive !== null) {
          const list = raw.activeThemes ?? [];
          const has = list.includes(THEME_ID);
          if (themeActive && !has) raw.activeThemes = [...list, THEME_ID];
          if (!themeActive && has) raw.activeThemes = list.filter((id) => id !== THEME_ID);
        }

        if (packs !== null) raw.activeIconPacks = [...packs];

        await settings.save();
      })
      .then(() => {
        // Landed: stop laying these over what the file says - unless a newer
        // edit to the same thing arrived while this one was being written.
        for (const [name, stored] of knobs) if (this.#knobs.get(name) === stored) this.#knobs.delete(name);
        if (this.#themeActive === themeActive) this.#themeActive = null;
        if (this.#packs === packs) this.#packs = null;
      })
      .catch((err) => {
        noteError(`shell settings write failed: ${err instanceof Error ? err.message : String(err)}`);
        this.#knobs.clear();
        this.#themeActive = null;
        this.#packs = null;
        void this.#refresh();
      });
  }

  async #refresh(): Promise<void> {
    try {
      const settings = await Settings.getAsync();
      const raw = settings.inner as unknown as RawSettings;
      const stored = { ...(raw.byTheme?.[THEME_ID] ?? {}) };
      for (const [name, value] of this.#knobs) {
        if (value === null) delete stored[name];
        else stored[name] = value;
      }
      this.values = stored;
      this.themeActive = this.#themeActive ?? (raw.activeThemes ?? []).includes(THEME_ID);
      this.activePacks = this.#packs ?? [...(raw.activeIconPacks ?? [])];
    } catch (err) {
      console.warn('[shell] could not read the settings', err);
    }
  }

  async #loadPacks(): Promise<void> {
    try {
      const list = (await invoke(SeelenCommand.StateGetIconPacks)) as Array<{
        id: string;
        metadata?: { displayName?: unknown; description?: unknown };
      }> | null;
      this.packs = (list ?? []).map((pack) => ({
        id: String(pack.id),
        name: text(pack.metadata?.displayName) || String(pack.id),
        description: text(pack.metadata?.description),
      }));
    } catch (err) {
      console.warn('[shell] could not list the icon packs', err);
    }
  }
}

export const shell = new ShellSettings();
