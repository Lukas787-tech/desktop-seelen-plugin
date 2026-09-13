import { mount } from 'svelte';
import { Widget } from '$lib/seelen';
import { fitToOwnMonitor } from '$lib/surface';
import { installErrorCapture } from '$lib/diagnostics';
import Surface from './Surface.svelte';
import '../styles/base.css';
import '../styles/fill.css';
import '../styles/modules.css';

/**
 * Entry point for `@ralfm/desktop`.
 *
 * The host contract is init() -> render -> ready(). `ready()` is what actually
 * shows the window, so anything that must be correct before the surface appears
 * belongs before it. Rollup emits an IIFE here, so no top-level await.
 */
async function boot(): Promise<void> {
  // Installed first so failures during startup are still recorded.
  installErrorCapture();

  const widget = Widget.self;

  await widget.init({
    // The Desktop preset defaults this to true, since it is aimed at small,
    // user-movable desktop widgets. We cover a whole display instead, and the
    // SDK persists one shared rect for every monitor replica, so we opt out
    // and manage geometry ourselves.
    saveAndRestoreLastRect: false,
    // Let the user's active themes style this surface.
    useThemes: true,
  });

  // Size to the display before anything is shown. The Desktop preset applies no
  // geometry of its own, so without this the window opens at Tauri's default
  // 800x600.
  await fitToOwnMonitor();

  const target = document.getElementById('root');
  if (!target) {
    throw new Error('#root missing: index.html must contain <div id="root"></div>');
  }

  mount(Surface, { target });

  await widget.ready();
}

/** Surfaces startup failures on the surface itself, since there is no console to watch. */
function reportFailure(err: unknown): void {
  console.error('[@ralfm/desktop] failed to start', err);
  const target = document.getElementById('root');
  if (!target) return;
  target.textContent = `@ralfm/desktop failed to start: ${err instanceof Error ? err.message : String(err)}`;
  target.setAttribute(
    'style',
    'color:#fff;background:#a00;padding:12px;font:13px ui-monospace,monospace',
  );
}

boot().catch(reportFailure);
