#!/usr/bin/env node
/**
 * Builds the offline module preview into one self-contained HTML file.
 *
 * The desktop surface sits behind every window, so it cannot simply be
 * screenshotted; this renders the same components, in the same panel chrome,
 * at the default 1920x1080 arrangement with every module on and mock host data
 * behind them. `src/preview/seelen-mock.ts` stands in for the host.
 *
 *   node scripts/preview.mjs [outDir]
 *
 * Writes `<outDir>/preview.html`, which opens in any browser - no server, no
 * Seelen, no Tauri.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, process.argv[2] ?? '.preview');
const buildDir = mkdtempSync(resolve(tmpdir(), 'ralfm-preview-'));

/** Same spawn shape as the widget build: Node runs Vite's JS entry directly. */
function build() {
  return new Promise((done, fail) => {
    const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, 'build'], {
      cwd: root,
      env: { ...process.env, WIDGET: 'preview', PREVIEW_OUT: buildDir },
      stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? done() : fail(new Error(`vite exited ${code}`))));
    child.on('error', fail);
  });
}

await build();

const js = readFileSync(resolve(buildDir, 'index.js'), 'utf8');
const css = readFileSync(resolve(buildDir, 'index.css'), 'utf8');
rmSync(buildDir, { recursive: true, force: true });

// Inlined rather than linked so the file can be moved, mailed or opened from
// anywhere on its own.
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>@ralfm/desktop - module preview</title>
<style>
  html, body { margin: 0; background: #07080c; }
  /* The stage is a fixed 1920x1080 surface; scale it down to fit a window. */
  #stage { width: 1920px; height: 1080px; transform-origin: top left; }
${css}
</style>
</head>
<body>
<div id="stage"><div id="root"></div></div>
<script>
${js}
</script>
<script>
  // Fit the fixed surface to whatever window it is opened in. ?x=&y=&scale=
  // frames one region instead, which is how the close-up screenshots are taken.
  const stage = document.getElementById('stage');
  const params = new URLSearchParams(location.search);
  const x = Number(params.get('x')) || 0;
  const y = Number(params.get('y')) || 0;
  const forced = Number(params.get('scale')) || 0;
  const fit = () => {
    const scale = forced || Math.min(window.innerWidth / 1920, window.innerHeight / 1080, 1);
    // A transform - even an identity one - makes the stage the containing block
    // for every fixed-position descendant, which is what the menus use. At
    // natural size there is nothing to transform, so leave it off and let them
    // resolve against the viewport exactly as they do on a real display.
    stage.style.transform =
      scale === 1 && !x && !y
        ? 'none'
        : 'scale(' + scale + ') translate(' + -x + 'px,' + -y + 'px)';
  };
  addEventListener('resize', fit);
  fit();
</script>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, 'preview.html');
writeFileSync(file, html);
console.log(`preview -> ${file}`);
