import { mount } from 'svelte';
import { Widget } from '$lib/seelen';
import { installErrorCapture, writeDiagnostics } from '$lib/diagnostics';
import Overlay from './Overlay.svelte';
import '../styles/base.css';
import '../styles/motion.css';

/**
 * Entry point for `@ralfm/overlay`.
 *
 * The in-game overlay: a lazy `Overlay`-preset widget, so the host does not
 * create this webview until its shortcut fires, and its window then covers the
 * display and holds the keyboard - which is the whole reason it exists. Game
 * mode cannot be summoned by a controller while a game is in front, because a
 * Desktop-preset widget is never focused and `navigator.getGamepads()` answers
 * nothing without focus. This can be, because a global shortcut is the host's
 * and lands wherever you are; from there the pad drives it.
 */
async function boot(): Promise<void> {
  installErrorCapture();

  const widget = Widget.self;
  await widget.init({ useThemes: true });

  const target = document.getElementById('root');
  if (!target) {
    throw new Error('#root missing: index.html must contain <div id="root"></div>');
  }

  mount(Overlay, { target });

  await widget.ready();

  void writeDiagnostics('@ralfm/overlay', widget.decoded.monitorId, { visible: 1 });
}

boot().catch((err) => {
  console.error('[@ralfm/overlay] failed to start', err);
});
