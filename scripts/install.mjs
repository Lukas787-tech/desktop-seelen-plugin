#!/usr/bin/env node
/**
 * Installs the built widgets, and the theme, into Seelen's own resource
 * directories.
 *
 * This is what makes the desktop survive a restart. `slu.exe resource load`
 * registers a resource by path in the *running* process only: nothing on disk
 * records where it came from, so after Seelen restarts (which is what happens
 * at every logon) the widget is simply gone, even though `settings.json` still
 * says it is enabled.
 *
 * Seelen scans `%APPDATA%\com.seelen.seelen-ui\{widgets,themes}\` at startup,
 * so a copy there is picked up on every launch - and Seelen itself is started
 * by a logon-triggered scheduled task, so the desktop comes back with Windows.
 *
 *   node scripts/install.mjs              install everything (and activate now)
 *   node scripts/install.mjs surface      install just one resource
 *   node scripts/install.mjs --uninstall  remove the installed copies
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { select } from './resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SLU = process.env.SLU_PATH ?? 'C:/Program Files/Seelen/Seelen UI/slu.exe';

const appData = process.env.APPDATA;
if (!appData) {
  console.error('APPDATA is not set; cannot locate the Seelen resource directories.');
  process.exit(1);
}

const args = process.argv.slice(2);
const uninstall = args.includes('--uninstall');
const selected = select(args);

/** Where Seelen scans for a resource of this kind at startup. */
const hostDir = (kind) => join(appData, 'com.seelen.seelen-ui', `${kind}s`);

/** Folder name under that directory; matches the widget's own data dir slug. */
const installedName = (resource) => `ralfm-${resource.name}`;

function slu(...cliArgs) {
  if (!existsSync(SLU)) return null;
  return spawnSync(SLU, cliArgs, { encoding: 'utf8' });
}

if (uninstall) {
  for (const resource of selected) {
    const dest = join(hostDir(resource.kind), installedName(resource));
    slu('resource', 'unload', resource.kind, dest);
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true });
      console.log(`removed ${dest}`);
    } else {
      console.log(`- ${resource.name} was not installed`);
    }
  }
  console.log('\nUninstalled. The desktop will not return after a restart.');
  process.exit(0);
}

let installed = 0;
let installedTheme = false;
for (const resource of selected) {
  const src = resolve(root, resource.dir);
  const required = resource.built
    ? ['metadata.yml', 'index.js', 'index.css', 'index.html']
    : ['metadata.yml'];
  const missing = required.filter((f) => !existsSync(join(src, f)));
  if (missing.length) {
    console.error(
      `! skipping ${resource.name}: missing ${missing.join(', ')}` +
        (resource.built ? ' - run "npm run build" first' : ''),
    );
    continue;
  }

  // The dev-path registration carries the same id as the installed copy, so
  // drop it first rather than leaving two claims on one id.
  slu('resource', 'unload', resource.kind, src);

  const dest = join(hostDir(resource.kind), installedName(resource));
  // And unload the installed copy too, for the same reason `npm run reload`
  // does: `resource load` on an already-registered resource re-registers the
  // definition without recreating the running webview, so redeploying over a
  // live install left the *old* JavaScript on screen and the new bundle
  // silently ignored.
  slu('resource', 'unload', resource.kind, dest);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });

  const r = slu('resource', 'load', resource.kind, dest);
  const ok = r && r.status === 0;
  console.log(`${ok ? 'OK ' : 'ERR'} installed ${resource.kind} ${resource.name} -> ${dest}`);
  if (!ok && r) console.error(`    ${`${r.stdout ?? ''}${r.stderr ?? ''}`.trim()}`);
  installed++;
  if (resource.kind === 'theme') installedTheme = true;
}

if (installed) {
  console.log('\nInstalled into Seelen. It now loads on every Seelen start, and Seelen itself');
  console.log('is launched by the "Seelen UI Service" logon task - so this starts with Windows.');
  console.log('\nNote: the installed copy is a snapshot. After changing the source, run');
  console.log('"npm run deploy" again to update it.');
}

if (installedTheme) {
  // Loading a theme registers it; it does not switch it on. `activeThemes`
  // lives in settings Seelen holds in memory and rewrites, so editing the file
  // from here would be overwritten at its next save - the toggle has to be
  // thrown in the UI, and it has to end up *after* `@default/theme`, which
  // supplies the layout these styles are painted over.
  console.log('\nThe theme is registered but not yet active. Turn it on in');
  console.log('  Seelen Settings -> Themes -> "Desktop Surface"');
  console.log('keeping the default theme enabled and ordered above it.');
}
