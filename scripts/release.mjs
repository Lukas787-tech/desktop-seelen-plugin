#!/usr/bin/env node
/**
 * Builds the installer that goes on a GitHub release:
 *
 *   release/SeelenDesktopSurface-Setup-<version>.exe
 *   release/SeelenDesktopSurface-Setup-<version>.exe.sha256
 *
 * The widgets are built, staged beside the theme and the voice server scripts
 * exactly as Seelen and the installer expect them, zipped, and embedded in a
 * small Windows Forms program compiled from `installer/Setup.cs`.
 *
 * It is compiled with the C# compiler that ships inside .NET Framework 4, so
 * building it needs nothing installed, and running it needs nothing either:
 * .NET Framework 4.8 is part of every supported Windows 10 and 11.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOURCES } from './resources.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const windir = process.env.WINDIR ?? 'C:/Windows';
const CSC = process.env.CSC_PATH ?? join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
// Windows' own bsdtar writes zip archives; a Git Bash `tar` earlier on PATH does not.
const TAR = join(windir, 'System32', 'tar.exe');

const out = join(root, 'release');
const stage = join(out, 'payload');
const zip = join(out, 'payload.zip');
const exe = join(out, `SeelenDesktopSurface-Setup-${version}.exe`);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${basename(command)} exited ${result.status}`);
}

for (const tool of [CSC, TAR]) {
  if (!existsSync(tool)) throw new Error(`${tool} not found; the installer can only be built on Windows.`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

run(process.execPath, [join(root, 'scripts', 'build.mjs')]);

// Laid out as Seelen's own resource folders, under the names `install.mjs`
// gives them, so the installer copies each one straight across.
for (const resource of RESOURCES) {
  const from = join(root, resource.dir);
  const to = join(stage, `${resource.kind}s`, `ralfm-${resource.name}`);
  cpSync(from, to, { recursive: true, filter: (path) => !/bundle .*\.yml$/.test(path) });
}
mkdirSync(join(stage, 'voice'), { recursive: true });
for (const file of ['server.py', 'install.ps1', 'start.ps1']) {
  cpSync(join(root, 'scripts', 'voice', file), join(stage, 'voice', file));
}
cpSync(join(root, 'LICENSE'), join(stage, 'LICENSE'));
writeFileSync(join(stage, 'version.txt'), version);

run(TAR, ['-a', '-c', '-f', zip, '-C', stage, '.']);

// The version the installer shows and records, from package.json.
const assemblyInfo = join(out, 'AssemblyInfo.cs');
const numeric = `${version.split(/[-+]/)[0]}.0`;
writeFileSync(
  assemblyInfo,
  [
    'using System.Reflection;',
    '[assembly: AssemblyTitle("Seelen Desktop Surface Setup")]',
    '[assembly: AssemblyProduct("Seelen Desktop Surface")]',
    '[assembly: AssemblyCompany("Lukas787-tech")]',
    '[assembly: AssemblyCopyright("Copyright (c) 2026 Lukas787-tech. MIT License.")]',
    `[assembly: AssemblyVersion("${numeric}")]`,
    `[assembly: AssemblyFileVersion("${numeric}")]`,
    `[assembly: AssemblyInformationalVersion("${version}")]`,
    '',
  ].join('\n'),
);

run(CSC, [
  '/nologo',
  '/target:winexe',
  '/optimize+',
  '/platform:anycpu',
  `/out:${exe}`,
  `/win32manifest:${join(root, 'installer', 'app.manifest')}`,
  `/resource:${zip},payload.zip`,
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  '/reference:System.IO.Compression.dll',
  '/reference:System.IO.Compression.FileSystem.dll',
  join(root, 'installer', 'Setup.cs'),
  join(root, 'installer', 'SettingsJson.cs'),
  assemblyInfo,
]);

const hash = createHash('sha256').update(readFileSync(exe)).digest('hex');
writeFileSync(`${exe}.sha256`, `${hash}  ${basename(exe)}\n`);
rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });

const size = (readFileSync(exe).length / 1024 / 1024).toFixed(1);
console.log(`\n${basename(exe)}  ${size} MB\nsha256 ${hash}`);
