import { mount } from 'svelte';
import { Widget } from '$lib/seelen';
import { installErrorCapture, writeDiagnostics } from '$lib/diagnostics';
import Palette from './Palette.svelte';
import '../styles/base.css';
import '../styles/fit.css';

/**
 * Entry point for `@ralfm/palette`.
 *
 * A lazy Popup widget: the host does not create this webview until the
 * shortcut fires, and the preset hides it on focus loss and closes it after,
 * so an unused palette costs nothing.
 */
async function boot(): Promise<void> {
  installErrorCapture();

  const widget = Widget.self;

  await widget.init({
    // Grow to fit the result list rather than reserving a fixed window.
    autoSizeByContent: document.getElementById('root'),
    autoSizeFitOnScreen: true,
    useThemes: true,
  });

  const target = document.getElementById('root');
  if (!target) {
    throw new Error('#root missing: index.html must contain <div id="root"></div>');
  }

  mount(Palette, { target });

  await widget.ready();

  // Record what the popup actually did, including its resolved size - there is
  // no console to watch on a widget that only exists while it is on screen.
  void writeDiagnostics('@ralfm/palette', widget.decoded.monitorId, {
    rootWidth: target.offsetWidth,
    rootHeight: target.offsetHeight,
    visible: 1,
  });
}

boot().catch((err) => {
  console.error('[@ralfm/palette] failed to start', err);
});
