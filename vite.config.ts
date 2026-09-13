import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * One Vite build per widget resource.
 *
 * Seelen's ThirdParty loader injects exactly one JS file and one CSS file
 * (declared as `js:`/`css:` in metadata.yml), so every build must emit a single
 * self-contained IIFE bundle with CSS collected into one file. No code
 * splitting, no dynamic import chunks, no external deps.
 *
 * `WIDGET=preview` is not a widget: it builds `src/preview`, the offline
 * harness that renders every module against mock host data (see
 * `scripts/preview.mjs`).
 */
const WIDGET = process.env.WIDGET ?? 'desktop';
const isPreview = WIDGET === 'preview';

/**
 * Serves the mock host in place of `src/lib/seelen.ts`.
 *
 * Done by file id rather than by import alias because the library modules
 * import it relatively (`./seelen`) and the components import it by alias
 * (`$lib/seelen`); both resolve to the same file, which is the one thing they
 * have in common. Nothing in `src/lib` or `src/modules` has to know.
 */
function seelenMock(): Plugin {
  const real = resolve('src/lib/seelen.ts').replaceAll('\\', '/');
  const mock = resolve('src/preview/seelen-mock.ts');
  return {
    name: 'ralfm-seelen-mock',
    enforce: 'pre',
    load(id) {
      return id.replaceAll('\\', '/') === real ? readFileSync(mock, 'utf8') : null;
    },
  };
}

export default defineConfig({
  plugins: isPreview ? [svelte(), seelenMock()] : [svelte()],
  resolve: {
    alias: {
      $lib: resolve('src/lib'),
      $modules: resolve('src/modules'),
    },
  },
  build: {
    outDir: isPreview ? (process.env.PREVIEW_OUT ?? '.preview') : `widgets/${WIDGET}`,
    // metadata.yml and i18n/ live in the same folder and must survive the build.
    emptyOutDir: isPreview,
    cssCodeSplit: false,
    cssMinify: true,
    sourcemap: false,
    // WebView2 152 is the verified runtime; no need for legacy transforms.
    target: 'chrome120',
    lib: {
      entry: resolve(`src/${WIDGET}/main.ts`),
      formats: ['iife'],
      name: `RalfmWidget_${WIDGET}`,
      fileName: () => 'index.js',
    },
    rollupOptions: {
      output: {
        // Force the single CSS asset to land as index.css, next to metadata.yml.
        assetFileNames: 'index.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
});
