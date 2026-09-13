import { SeelenCommand, invoke } from './seelen';

/**
 * JSON state that outlives the webview.
 *
 * The host owns the location (`write_data_file` / `read_data_file` resolve a
 * per-widget data directory), which keeps our files beside Seelen's own and
 * means an uninstall cleans them up. Everything here is plain JSON so the user
 * can edit it by hand.
 */

/** Reads and parses a JSON file, returning `fallback` if absent or corrupt. */
export async function readJson<T>(filename: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await invoke(SeelenCommand.ReadFile, { filename });
  } catch {
    // Missing file is the normal first-run case, not an error worth surfacing.
    return fallback;
  }
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error(`[persist] ${filename} is not valid JSON; using defaults`, err);
    return fallback;
  }
}

export async function writeJson(filename: string, value: unknown): Promise<void> {
  await invoke(SeelenCommand.WriteFile, { filename, content: JSON.stringify(value, null, 2) });
}

/**
 * Coalesces bursts of writes to one file.
 *
 * Dragging an icon produces a write per frame; without this the surface would
 * hammer the disk during every drag.
 */
export function debouncedWriter(filename: string, delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: unknown;
  let inFlight: Promise<void> = Promise.resolve();

  const flush = () => {
    timer = undefined;
    const value = pending;
    inFlight = inFlight
      .then(() => writeJson(filename, value))
      .catch((err) => console.error(`[persist] failed writing ${filename}`, err));
  };

  return {
    queue(value: unknown): void {
      pending = value;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    /** Writes any pending value immediately; call before teardown. */
    async flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      await inFlight;
    },
  };
}
