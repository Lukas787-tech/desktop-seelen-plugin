/**
 * What this package ships, in one place.
 *
 * Three scripts need the same answer to "what is there, and of what kind":
 * `build.mjs` compiles the ones with a Vite entry, `link.mjs` registers the
 * source folders with a running Seelen, and `install.mjs` copies them where
 * Seelen looks at startup. Keeping the list here is what stops a fourth
 * resource being added to two of the three.
 *
 * `kind` is Seelen's own resource kind, which is also the `slu resource
 * load <kind> <path>` argument and (pluralised) the directory it scans.
 * `built` marks a folder whose `metadata.yml` pulls in Vite output, so it is
 * incomplete until `npm run build` has run; a theme is complete as authored.
 */
export const RESOURCES = [
  { name: 'desktop', kind: 'widget', dir: 'widgets/desktop', built: true },
  { name: 'palette', kind: 'widget', dir: 'widgets/palette', built: true },
  { name: 'surface', kind: 'theme', dir: 'themes/surface', built: false },
];

export const NAMES = RESOURCES.map((r) => r.name);

/**
 * Picks the resources named on the command line, or all of them when none
 * were. Exits with a usage error rather than silently doing nothing, which is
 * what a typo used to buy.
 */
export function select(args, { only } = {}) {
  const pool = only ? RESOURCES.filter((r) => only(r)) : RESOURCES;
  const names = args.filter((a) => !a.startsWith('--'));

  for (const name of names) {
    if (!pool.some((r) => r.name === name)) {
      console.error(`unknown resource "${name}" (expected one of: ${pool.map((r) => r.name).join(', ')})`);
      process.exit(1);
    }
  }

  return names.length ? pool.filter((r) => names.includes(r.name)) : pool;
}
