import { SeelenEvent, Widget, subscribe, type UnSubscriber } from './seelen';
import { noteAction, noteError } from './diagnostics';
import type { FocusedApp } from '@seelen-ui/lib/types';

/**
 * Input types that are typed into. A checkbox, a switch or a slider is worked
 * entirely with the mouse, and taking the foreground for one of those would
 * pull it off whatever the user was actually using.
 */
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'url',
  'email',
  'number',
  'password',
  'tel',
  'date',
  'time',
  'month',
  'week',
  'datetime-local',
]);

/** The field a pointer landed in, if it is one that is typed into. */
function fieldFor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const field = target.closest<HTMLElement>('input, textarea, [contenteditable]');
  if (!field) return null;
  if (field instanceof HTMLTextAreaElement) return field;
  if (field instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(field.type) ? field : null;
  return field.isContentEditable ? field : null;
}

/**
 * Lets the surface's text fields actually be typed into.
 *
 * The host gives a desktop-preset widget `WS_EX_NOACTIVATE`, so clicking the
 * surface never makes it the foreground window. The click still reaches the
 * page and still moves the caret into the field, so a text box looks perfectly
 * usable and then swallows every keystroke, because the keys go to whichever
 * window really holds the foreground. That is what made the notes panel, and
 * anything else with a field in it, useless.
 *
 * `Widget.self.focus()` gets around it: the host's own `request_focus` does the
 * foreground dance that `SetForegroundWindow` alone cannot.
 *
 * Who holds the keyboard is taken from the host's `global-focus-changed`
 * rather than from `document.hasFocus()`. The document flag answers for the
 * webview's own focus and was recorded as `true` on this surface while it was
 * not the foreground window - and a check that says "we already have it" when
 * we do not is the one failure that swallows the keystrokes again. The host
 * names the window that really holds the foreground, so the surface asks for
 * the keyboard unless that window is this one.
 *
 * It is asked for only on a press or a tab into a field that is typed into.
 * Doing it for every click would yank the foreground away from the user's own
 * window each time they touched the desktop.
 */
export function keepTextInputUsable(): () => void {
  const widget = Widget.self;
  const disposers: UnSubscriber[] = [];

  /** Null until the host reports a focus change; "not ours" until then. */
  let foreground: number | null = null;
  let asking = false;

  void subscribe(SeelenEvent.GlobalFocusChanged, ({ payload }) => {
    const app = payload as FocusedApp;
    foreground = app.hwnd === widget.windowId || app.ownerHwnd === widget.windowId ? app.hwnd : null;
  })
    .then((off) => disposers.push(off))
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      noteError(`input: focus tracking unavailable ${message}`);
    });

  function holdsKeyboard(): boolean {
    return foreground !== null && document.hasFocus();
  }

  function take(field: HTMLElement): void {
    if (asking) return;
    asking = true;
    void widget
      .focus()
      .then(() => {
        // Activation can move the caret elsewhere, or nowhere; put it back in
        // the field the click was meant for.
        if (document.activeElement !== field) field.focus({ preventScroll: true });
        noteAction(`input: asked for the keyboard for <${field.tagName.toLowerCase()}>`);
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[input] could not take the keyboard', err);
        noteError(`input: ${message}`);
      })
      .finally(() => {
        asking = false;
      });
  }

  const onPointerDown = (event: PointerEvent) => {
    const field = fieldFor(event.target);
    if (field && !holdsKeyboard()) take(field);
  };

  /** Covers a field reached with the keyboard, and a focus we did not ask for. */
  const onFocusIn = (event: FocusEvent) => {
    const field = fieldFor(event.target);
    if (field && !holdsKeyboard()) take(field);
  };

  // Capture, so a handler that stops propagation cannot cost the user their
  // keyboard - the drag actions on the panels stop plenty of pointer events.
  document.addEventListener('pointerdown', onPointerDown, { capture: true });
  document.addEventListener('focusin', onFocusIn, { capture: true });

  return () => {
    document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    document.removeEventListener('focusin', onFocusIn, { capture: true });
    for (const off of disposers.splice(0)) off();
  };
}
