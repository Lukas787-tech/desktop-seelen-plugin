#!/usr/bin/env node
/**
 * Registers (or removes) the source folders with the running Seelen UI.
 *
 * `slu.exe resource load <kind> <path>` is the documented dev entry point;
 * `--unload` reverses it, which is also the clean-uninstall path. The theme is
 * registered the same way as the widgets - it just carries no build output, so
 * it can be linked before anything has been compiled.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { select } from './resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLU = process.env.SLU_PATH ?? 'C:/Program Files/Seelen/Seelen UI/slu.exe';

const args = process.argv.slice(2);
const unload = args.includes('--unload');
// `resource load` on an already-registered resource re-registers the
// definition but does not reliably recreate the running webview, so a
// rebuild's new JS can be ignored. Unloading first forces the host to tear the
// instance down and build it again.
const reload = args.includes('--reload');
const resources = select(args);

if (!existsSync(SLU)) {
  console.error(`slu.exe not found at ${SLU}\nSet SLU_PATH to override.`);
  process.exit(1);
}

let failed = 0;
for (const resource of resources) {
  const dir = resolve(root, resource.dir);
  if (!existsSync(resolve(dir, 'metadata.yml'))) {
    console.log(`- skipping "${resource.name}" (no metadata.yml)`);
    continue;
  }
  const verb = unload ? 'unload' : 'load';

  if (reload && !unload) {
    spawnSync(SLU, ['resource', 'unload', resource.kind, dir], { encoding: 'utf8' });
  }

  const r = spawnSync(SLU, ['resource', verb, resource.kind, dir], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  const done = reload && !unload ? 'reloaded' : `${verb}ed`;
  const detail = out ? `: ${out.replace(/\s+/g, ' ')}` : '';
  if (r.status === 0) {
    console.log(`OK  ${done} ${resource.kind} ${resource.name}${detail}`);
  } else {
    failed++;
    console.error(`ERR ${verb} ${resource.name} failed (exit ${r.status})${detail}`);
  }
}
process.exit(failed ? 1 : 0);
