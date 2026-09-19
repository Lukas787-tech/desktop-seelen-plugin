import { DEFAULT_CONFIG, config, type ConfigKey, type DesktopConfig, type SettingScope } from './config.svelte';
import { resolveLook, type Look } from './looks';
import { THEME_KNOBS } from './shell-theme';
import { shell } from './shell-settings.svelte';

/**
 * Putting a whole appearance in place - a built-in look, a saved preset, a
 * design from the AI - and taking it back again.
 *
 * Everything goes through the ordinary stores, so the result is exactly as if
 * each slider had been moved by hand: one debounced write per file, and every
 * setting still what it says afterwards.
 */

export function applyValues(values: Partial<DesktopConfig>, scope: SettingScope = 'auto'): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || !Object.hasOwn(DEFAULT_CONFIG, key)) continue;
    config.set(key as never, value as never, scope);
  }
}

/** A look, in full: anything it does not mention goes back to its default. */
export function applyLook(look: Look, scope: SettingScope = 'auto'): void {
  applyValues(resolveLook(look, DEFAULT_CONFIG), scope);
}

/**
 * Sets the theme's settings named in `names` to exactly `stored`: a name with a
 * value takes it, a name without one goes back to the theme's default. Names
 * not listed are left alone.
 */
export function applyShell(stored: Record<string, string>, names: readonly string[]): void {
  for (const name of names) {
    const next = stored[name];
    const now = shell.values[name];
    if (next === undefined) {
      if (now !== undefined) shell.reset(name);
    } else if (next !== now) {
      shell.setStored(name, next);
    }
  }
}

/** Everything needed to put an appearance back as it was. */
export interface AppearanceSnapshot {
  desktop: Partial<DesktopConfig>;
  shell: Record<string, string>;
}

/** The current values of `keys` and of every theme setting. Needs the shell store started. */
export function snapshotAppearance(keys: readonly ConfigKey[]): AppearanceSnapshot {
  const current = config.current as unknown as Record<string, unknown>;
  return {
    desktop: Object.fromEntries(keys.map((key) => [key, current[key]])) as Partial<DesktopConfig>,
    shell: { ...shell.values },
  };
}

/**
 * A saved or AI-designed preset: its desktop values over the defaults, and its
 * shell settings - for exactly the shell settings a person owns while the shell
 * does or does not follow the desktop, so a preset never fights the sync.
 */
export async function applyPreset(
  preset: { id: string; label: string; values: Partial<DesktopConfig>; shell: Record<string, string> },
  scope: SettingScope = 'auto',
): Promise<void> {
  applyValues(resolveLook({ id: preset.id, label: preset.label, description: '', values: preset.values as Look['values'] }, DEFAULT_CONFIG), scope);
  await shell.ensureLoaded();
  const styleShell = config.current.styleShell;
  applyShell(
    preset.shell,
    THEME_KNOBS.filter((knob) => !knob.synced || !styleShell).map((knob) => knob.name),
  );
}

export function restoreAppearance(snapshot: AppearanceSnapshot, scope: SettingScope = 'auto'): void {
  applyValues(snapshot.desktop, scope);
  applyShell(
    snapshot.shell,
    THEME_KNOBS.map((knob) => knob.name),
  );
}
