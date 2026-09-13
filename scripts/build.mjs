#!/usr/bin/env node
/**
 * Builds each widget resource into `widgets/<name>/index.{js,css}`.
 *
 * Those land beside the hand-authored `metadata.yml`, which pulls them in with
 * `!include`. The result is a folder Seelen can load directly:
 *   slu.exe resource load widget <abs path to widgets/<name>>
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { select } from './resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const watch = args.includes('--watch');
// Only the resources with a Vite entry; the theme is hand-authored CSS that
// `metadata.yml` pulls in directly, so there is nothing here to compile.
const widgets = select(args, { only: (r) => r.built }).map((r) => r.name);

/** Runs one Vite build. Resolves true if it produced output, false if skipped. */
function run(widget) {
  return new Promise((done, fail) => {
    const entry = resolve(root, 'src', widget, 'main.ts');
    if (!existsSync(entry)) {
      console.log(`- skipping "${widget}" (no ${entry})`);
      return done(false);
    }

    // Spawn Vite's JS entry with the running Node binary. Going through
    // `npx.cmd` fails with EINVAL on Node 24 for Windows .cmd shims, and using
    // a shell would drag in quoting problems for paths with spaces.
    const vite = resolve(root, 'node_modules', 'vite', 'bin', 'vite.js');
    const child = spawn(process.execPath, [vite, 'build', ...(watch ? ['--watch'] : [])], {
      cwd: root,
      env: { ...process.env, WIDGET: widget },
      stdio: 'inherit',
    });

    child.on('exit', (code) =>
      code === 0 ? done(true) : fail(new Error(`${widget}: vite exited ${code}`)),
    );
    child.on('error', fail);
  });
}

/**
 * Seelen's loader injects our JS and CSS itself, so `index.html` must be body
 * content only - no document, script or link tags.
 */
function ensureHtml(widget) {
  const file = resolve(root, 'widgets', widget, 'index.html');
  const body = '<div id="root"></div>\n';
  if (!existsSync(file) || readFileSync(file, 'utf8') !== body) {
    writeFileSync(file, body);
  }
}

for (const widget of widgets) ensureHtml(widget);

if (watch) {
  // `vite build --watch` never exits, so the builds must run side by side
  // rather than one after another.
  await Promise.all(widgets.map(run));
} else {
  for (const widget of widgets) {
    if (await run(widget)) console.log(`built ${widget} -> widgets/${widget}/index.js`);
  }
}
