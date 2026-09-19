import { noteError } from './diagnostics';
import { SeelenCommand, Settings, Widget, invoke } from './seelen';

/**
 * Telling two of this widget's own global shortcuts apart.
 *
 * A widget declares its shortcuts in `metadata.yml` and the user rebinds them
 * in Seelen's own settings, which is where "custom hotkeys" for this package
 * live. What a shortcut *runs*, though, is a CLI command, and the only one that
 * reaches a widget is `widget trigger <id>` - which takes no arguments. So two
 * shortcuts declared by one widget fire the same trigger, carrying nothing that
 * says which of them the user pressed.
 *
 * `get_key_state` is the way out. The trigger arrives a millisecond or two
 * after the key went down and the user is still holding it, so asking the host
 * which of the declared combinations is *currently* down answers the question
 * the payload does not. It is a guess about timing, and it is treated as one:
 * when the answer is ambiguous - nothing down, or two combinations down at once
 * - this says so, and the caller does whatever it did before shortcuts were
 * told apart at all.
 *
 * The other way to get a second global hotkey is a second widget, which is what
 * `@ralfm/overlay` is: its shortcut is unambiguous because the trigger is
 * addressed to a different widget. This file is for the ones that have to share
 * one.
 */

/** Keys that are held with something else and so cannot distinguish anything. */
const MODIFIERS = new Set(['win', 'meta', 'super', 'ctrl', 'control', 'alt', 'shift']);

/** Set once the host turns out not to answer, so it is asked once and not per press. */
let unavailable = false;

/**
 * The key that makes a combination that combination.
 *
 * `Win+Shift+D` and `Win+Shift+G` differ by their last key and nothing else,
 * and it is the last key in every combination Seelen writes.
 */
export function distinguishingKey(keys: readonly string[]): string | null {
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]?.trim();
    if (key && !MODIFIERS.has(key.toLowerCase())) return key;
  }
  return null;
}

/**
 * Picks the one combination whose key is down, if exactly one is.
 *
 * Two shortcuts bound to keys that are both held - `Win+Shift+D` pressed while
 * G happens to be down - is not an answer, and neither is nothing at all. Pure,
 * so the awkward cases are checked by `npm test`.
 */
export function pickPressed(
  combos: ReadonlyMap<string, readonly string[]>,
  isDown: (key: string) => boolean,
): string | null {
  const hits: string[] = [];
  for (const [id, keys] of combos) {
    const key = distinguishingKey(keys);
    if (key && isDown(key)) hits.push(id);
  }
  return hits.length === 1 ? hits[0]! : null;
}

/**
 * This widget's shortcuts, as they are actually bound.
 *
 * The declaration carries the defaults; the user's rebinds live in the widget's
 * own settings entry under `$shortcuts`, which is the one part of that entry
 * this package does not own - so it is read, never written.
 */
export async function boundShortcuts(): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const declared = Widget.self.def?.shortcuts ?? [];
  for (const one of declared) out.set(one.id, [...one.defaultKeys]);

  try {
    const settings = await Settings.getAsync();
    const raw = settings.inner as unknown as {
      byWidget?: Record<string, { $shortcuts?: Record<string, string[]> | null } | undefined>;
    };
    const overrides = raw.byWidget?.[Widget.self.id as unknown as string]?.$shortcuts;
    for (const [id, keys] of Object.entries(overrides ?? {})) {
      if (Array.isArray(keys) && keys.length) out.set(id, keys);
    }
  } catch {
    // Unreadable settings only means the defaults are the best answer here.
  }
  return out;
}

/**
 * Which of this widget's shortcuts the user just pressed, or null if unclear.
 *
 * Null is a real answer and not a failure: an older host with no `get_key_state`
 * gives it, and so does a user who rebound one of the combinations to something
 * that is down for another reason. The caller is expected to have a default.
 */
export async function firedShortcut(): Promise<string | null> {
  if (unavailable) return null;

  const combos = await boundShortcuts();
  if (combos.size < 2) return null;

  const keys = [...new Set([...combos.values()].map(distinguishingKey).filter(Boolean))] as string[];
  const down = new Map<string, boolean>();

  try {
    await Promise.all(
      keys.map(async (key) => {
        down.set(key, await invoke(SeelenCommand.GetKeyState, { key }));
      }),
    );
  } catch (err) {
    // Asked once. A host that cannot answer will not start being able to.
    unavailable = true;
    noteError(`hotkeys: get_key_state unavailable (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }

  return pickPressed(combos, (key) => down.get(key) === true);
}
