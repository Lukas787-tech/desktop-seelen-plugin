import { writeJson } from './persist';

interface Diagnostics {
  startedAt: string;
  widget: string;
  monitorId: string | null;
  window: { width: number; height: number; dpr: number };
  /**
   * What the webview itself gives us. A widget does not choose the origin it is
   * served from, and half the platform - `crypto.randomUUID` among it - is
   * defined only in a secure context, so this is worth reading rather than
   * assuming.
   */
  runtime: { origin: string; secureContext: boolean; randomUUID: boolean };
  /**
   * What the voice mode can count on. WebView2 decides microphone access with
   * its own prompt (Seelen's wry build answers only clipboard requests), and
   * lists whichever Windows voices it chooses to - neither is knowable from
   * outside the running webview.
   */
  voice?: { getUserMedia: boolean; audioWorklet: boolean; microphone: string; systemVoices: string[] };
  themeTokensPresent: boolean;
  counts: Record<string, number>;
  actions: string[];
  errors: string[];
}

const MAX_ERRORS = 25;
const captured: string[] = [];

const MAX_ACTIONS = 25;
const actions: string[] = [];

/**
 * Records startup state and any uncaught error to a JSON file in the widget's
 * data directory.
 *
 * The surface has no visible console and sits behind every window, so when
 * something goes wrong there is otherwise nothing to inspect. This is the
 * supported way to find out what a running replica actually did.
 */
export function installErrorCapture(): void {
  globalThis.addEventListener('error', (event) => {
    record(`${event.message} (${event.filename}:${event.lineno})`);
  });
  globalThis.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    record(`unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

function record(message: string): void {
  if (captured.length >= MAX_ERRORS) captured.shift();
  captured.push(`${new Date().toISOString()} ${message}`);
}

/** The last snapshot written, so a later failure can be appended to it. */
let lastReport: Diagnostics | null = null;
let lastFilename: string | null = null;

/**
 * Records a failure the surface handled itself.
 *
 * Nothing here is fatal, so these would otherwise vanish into a console nobody
 * can open; appending them to the snapshot is what makes `npm run status`
 * report them.
 */
export function noteError(message: string): void {
  record(message);
  if (!lastReport || !lastFilename) return;
  lastReport.errors = captured.slice();
  void writeJson(lastFilename, lastReport).catch(() => {
    /* the surface must keep running whatever the disk says */
  });
}

/**
 * Records something the user asked for and what came of it.
 *
 * The surface answers clicks by asking the host to do something to a window
 * that is somewhere else entirely, so "nothing happened" is the failure mode
 * that matters and the one with nothing to show for it: the command is
 * accepted, and the window stays where it was. These lines are what
 * `npm run status` prints, and they are how a click gets checked at all.
 *
 * Debounced: a burst of clicks writes once, not once per click.
 */
export function noteAction(message: string): void {
  if (actions.length >= MAX_ACTIONS) actions.shift();
  actions.push(`${new Date().toISOString()} ${message}`);
  if (!lastReport || !lastFilename) return;
  lastReport.actions = actions.slice();
  scheduleWrite();
}

let writeTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = undefined;
    if (!lastReport || !lastFilename) return;
    void writeJson(lastFilename, lastReport).catch(() => {
      /* the surface must keep running whatever the disk says */
    });
  }, 750);
}

async function voiceRuntime(): Promise<Diagnostics['voice']> {
  const synth = globalThis.speechSynthesis;
  const voices = synth
    ? await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const now = synth.getVoices();
        if (now.length) return resolve(now);
        synth.addEventListener('voiceschanged', () => resolve(synth.getVoices()), { once: true });
        setTimeout(() => resolve(synth.getVoices()), 1500);
      })
    : [];
  let microphone = 'unknown';
  try {
    microphone = (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    /* not queryable in this webview */
  }
  return {
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === 'function',
    audioWorklet: typeof AudioWorkletNode === 'function',
    microphone,
    systemVoices: voices.map((v) => `${v.name} (${v.lang})`),
  };
}

/** Writes the current diagnostics snapshot. Failures here are never fatal. */
export async function writeDiagnostics(
  widget: string,
  monitorId: string | null,
  counts: Record<string, number>,
): Promise<void> {
  const token = getComputedStyle(document.documentElement)
    .getPropertyValue('--color-gray-500')
    .trim();

  const report: Diagnostics = {
    startedAt: new Date().toISOString(),
    widget,
    monitorId,
    window: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    runtime: {
      origin: location.origin,
      secureContext: window.isSecureContext,
      randomUUID: typeof globalThis.crypto?.randomUUID === 'function',
    },
    voice: await voiceRuntime().catch(() => undefined),
    themeTokensPresent: token.length > 0,
    counts,
    actions: actions.slice(),
    errors: captured.slice(),
  };

  const filename = `diagnostics-${(monitorId ?? 'primary').replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
  lastReport = report;
  lastFilename = filename;
  try {
    await writeJson(filename, report);
  } catch (err) {
    console.error('[diagnostics] could not write report', err);
  }
}
