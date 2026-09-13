#!/usr/bin/env node
/**
 * Prints what the running widgets last reported.
 *
 * The desktop surface sits behind every window and has no visible console, so
 * each replica writes a diagnostics snapshot on startup. This reads them back.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(
  process.env.APPDATA ?? '',
  'com.seelen.seelen-ui',
  'data',
  'ralfm-desktop',
);

if (!existsSync(DATA_DIR)) {
  console.error(`No widget data directory at ${DATA_DIR}\nHas the widget been loaded and enabled?`);
  process.exit(1);
}

const files = readdirSync(DATA_DIR);
const reports = files.filter((f) => f.startsWith('diagnostics-') && f.endsWith('.json'));

if (!reports.length) {
  console.error('No diagnostics reports yet. Load the widget and wait a few seconds.');
  process.exit(1);
}

let problems = 0;

for (const file of reports.sort()) {
  const full = join(DATA_DIR, file);
  const report = JSON.parse(readFileSync(full, 'utf8'));
  const ageSec = Math.round((Date.now() - statSync(full).mtimeMs) / 1000);

  console.log(`\n${report.monitorId ?? '(no monitor id)'}`);
  console.log(`  started       ${report.startedAt}  (${ageSec}s ago)`);
  console.log(`  window        ${report.window.width}x${report.window.height} @dpr ${report.window.dpr}`);
  console.log(`  theme tokens  ${report.themeTokensPresent ? 'injected' : 'MISSING'}`);
  if (report.runtime) {
    const { origin, secureContext, randomUUID } = report.runtime;
    console.log(
      `  webview       ${origin}  secure=${secureContext}  crypto.randomUUID=${randomUUID}`,
    );
  }
  if (report.voice) {
    const { getUserMedia, audioWorklet, microphone, systemVoices } = report.voice;
    console.log(`  voice         microphone=${microphone}  getUserMedia=${getUserMedia}  audioWorklet=${audioWorklet}`);
    console.log(`  windows voices ${systemVoices.length ? systemVoices.join(', ') : 'none listed'}`);
  }
  const counts = Object.entries(report.counts)
    .map(([k, v]) => `${k}=${v}`)
    .join('  ');
  console.log(`  counts        ${counts}`);

  // What the surface was last asked to do, and what came of it. A click that
  // the host accepted and that changed nothing on screen looks identical to a
  // working one from here; these lines are where the difference shows.
  if (report.actions?.length) {
    console.log('  actions:');
    for (const action of report.actions) console.log(`    - ${action}`);
  }

  if (report.errors.length) {
    problems += report.errors.length;
    console.log('  errors:');
    for (const err of report.errors) console.log(`    - ${err}`);
  } else {
    console.log('  errors        none');
  }
  if (!report.themeTokensPresent) problems++;
}

console.log(`\n${problems === 0 ? 'All replicas healthy.' : `${problems} problem(s) reported.`}`);
process.exit(problems === 0 ? 0 : 1);
