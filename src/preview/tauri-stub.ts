/**
 * Stands in for Tauri's injected globals, so the SDK can be imported outside a
 * webview.
 *
 * Imported first by `main.ts`: ES modules evaluate imports in order, so this
 * runs before `@seelen-ui/lib` or `@tauri-apps/api` are loaded by anything
 * else. Nothing should ever reach these - the preview swaps `src/lib/seelen.ts`
 * for a mock - but a stray call must not take the page down with it.
 */
const internals = {
  invoke: () => Promise.resolve(undefined),
  convertFileSrc: (path: string) => path,
  transformCallback: () => 0,
  metadata: { currentWindow: { label: 'preview' }, currentWebview: { label: 'preview' } },
  plugins: {},
};

Object.defineProperty(globalThis, '__TAURI_INTERNALS__', {
  value: internals,
  writable: true,
  configurable: true,
});

export {};
