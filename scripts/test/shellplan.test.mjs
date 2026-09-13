/**
 * Exercises the real `src/lib/shellplan.ts` against the scenarios that produced
 * the "it always skips back to 100" report - a theme setting springing back to
 * the widget's value the instant it was moved, because the widget could not
 * tell a human's edit from its own broadcast coming back round.
 *
 * Run with `npm test`, which transpiles the module first: it is plain
 * TypeScript with one type-only import, so esbuild's output runs in Node
 * directly and the test exercises the shipped code rather than a copy of it.
 */
import {
  ShellSyncPlanner,
  applyPlan,
  occludingFill,
  barFill,
  tierFills,
  TINTED_FILL,
} from '../../.test/shellplan.mjs';

let failures = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) console.log(`        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};

const vars = (frost, radius = '20px') => ({ '--rs-frost': frost, '--rs-radius': radius });

// ---------------------------------------------------------------- scenario 1
// A fresh install: theme has nothing, so the first push seeds everything.
{
  const p = new ShellSyncPlanner();
  const theme = {};
  applyPlan(p.next(vars('100'), true), theme);
  check('fresh install is seeded', theme, { '--rs-frost': '100', '--rs-radius': '20px' });
}

// ---------------------------------------------------------------- scenario 2
// THE BUG. User edits the theme's frost to 60; the host broadcasts, the config
// store re-reads, the effect re-runs with UNCHANGED widget settings.
{
  const p = new ShellSyncPlanner();
  const theme = {};
  applyPlan(p.next(vars('100'), true), theme);
  theme['--rs-frost'] = '60'; // the human moves the slider
  applyPlan(p.next(vars('100'), true), theme); // re-read, nothing of ours moved
  applyPlan(p.next(vars('100'), true), theme); // and again
  check('a theme edit survives a re-read', theme['--rs-frost'], '60');
}

// ---------------------------------------------------------------- scenario 3
// A real widget-side change still wins.
{
  const p = new ShellSyncPlanner();
  const theme = {};
  applyPlan(p.next(vars('100'), true), theme);
  theme['--rs-frost'] = '60';
  applyPlan(p.next(vars('0'), true), theme); // user switches the texture off
  check('a widget change overwrites', theme['--rs-frost'], '0');
}

// ---------------------------------------------------------------- scenario 4
// A widget change must not disturb the OTHER variables the user has tuned.
{
  const p = new ShellSyncPlanner();
  const theme = {};
  applyPlan(p.next(vars('100', '20px'), true), theme);
  theme['--rs-radius'] = '34px'; // tuned by hand in the theme
  applyPlan(p.next(vars('0', '20px'), true), theme); // only the texture moved
  check('untouched variables are left alone', theme['--rs-radius'], '34px');
}

// ---------------------------------------------------------------- scenario 5
// Restarting Seelen must not stomp what was tuned in the last session.
{
  const theme = { '--rs-frost': '60', '--rs-radius': '34px' };
  const p = new ShellSyncPlanner(); // a brand new session
  applyPlan(p.next(vars('100', '20px'), true), theme);
  check('a restart seeds nothing over existing values', theme, {
    '--rs-frost': '60',
    '--rs-radius': '34px',
  });
}

// ---------------------------------------------------------------- scenario 6
// ...but a restart does fill in a variable the theme has never had.
{
  const theme = { '--rs-frost': '60' };
  const p = new ShellSyncPlanner();
  applyPlan(p.next(vars('100', '20px'), true), theme);
  check('a restart still fills a missing variable', theme, {
    '--rs-frost': '60',
    '--rs-radius': '20px',
  });
}

// ---------------------------------------------------------------- scenario 7
// Off and on again is the explicit "apply these now", and overwrites.
{
  const p = new ShellSyncPlanner();
  const theme = {};
  applyPlan(p.next(vars('100'), true), theme);
  theme['--rs-frost'] = '60';
  applyPlan(p.next(vars('100'), false), theme); // switch off
  check('switching off writes nothing', theme['--rs-frost'], '60');
  applyPlan(p.next(vars('100'), true), theme); // switch on
  check('switching back on re-applies', theme['--rs-frost'], '100');
}

// ---------------------------------------------------------------- scenario 8
// The second monitor replica finds the work already done and saves nothing.
{
  const a = new ShellSyncPlanner();
  const b = new ShellSyncPlanner();
  const theme = {};
  applyPlan(a.next(vars('100'), true), theme);
  check('the second replica writes nothing', applyPlan(b.next(vars('100'), true), theme), false);
}

// ---------------------------------------------------------------- scenario 9
// No spurious save when nothing at all has moved.
{
  const p = new ShellSyncPlanner();
  const theme = {};
  applyPlan(p.next(vars('100'), true), theme);
  check('an idle re-read reports no change', applyPlan(p.next(vars('100'), true), theme), false);
}

// --------------------------------------------------------------- scenario 10
// The fill conversion. A blurred panel and a flat one at the same alpha do not
// hide the same amount of backdrop; these are the properties that has to have.
{
  // No blur to replace means nothing to compensate for.
  check('a flat panel is carried across unchanged', occludingFill(24, 0), 24);

  // The report that prompted this: 24% behind a 20px blur is glass on the
  // desktop and cellophane on a dock.
  check('a thin blurred fill is lifted', occludingFill(24, 20), 64);
  check('a default fill is lifted', occludingFill(60, 20), 85);

  // Both ends mean the same thing in either material, so neither moves.
  check('invisible stays invisible', occludingFill(0, 20), 0);
  check('solid stays solid', occludingFill(100, 20), 100);

  // A heavy blur must saturate rather than drive everything opaque.
  check('a heavy blur does not run away', occludingFill(24, 48) < 70, true);

  // Compensation only ever adds density, and never reorders two fills.
  let monotonic = true;
  let never_less = true;
  for (let blur = 0; blur <= 48; blur += 4) {
    for (let a = 0; a <= 100; a += 1) {
      if (occludingFill(a, blur) < a) never_less = false;
      if (a && occludingFill(a, blur) < occludingFill(a - 1, blur)) monotonic = false;
    }
  }
  check('the conversion never thins a fill', never_less, true);
  check('the conversion preserves order', monotonic, true);
}

// --------------------------------------------------------------- scenario 11
// The fill conversion once a measured wallpaper colour is being sent. With the
// ground right, the fill is standing in for the blur itself - so it has to
// move when the blur moves, which a flat floor did not.
{
  check('without a colour, nothing is added', barFill(24, 20, false), 64);
  check('the reference settings land on the anchor', barFill(24, 20, true), TINTED_FILL);

  // THE BUG: the blur slider moved and the shell did not change, because every
  // value it produced was under the floor and got flattened to it.
  check('blur 0 leaves the bar transmissive', barFill(24, 0, true), 24);
  check('blur actually moves the fill', barFill(24, 8, true) > barFill(24, 0, true), true);
  check('more blur is never less fill', barFill(24, 30, true) >= barFill(24, 20, true), true);

  // Someone who asked for something denser still gets it.
  check('a dense fill is not pulled down', barFill(95, 20, true) >= occludingFill(95, 20), true);

  // Zero is not a thin panel, it is no panel.
  check('no panel stays no panel', barFill(0, 20, true), 0);
  check('no panel stays no panel at any blur', barFill(0, 48, true), 0);

  // Monotonic in both arguments, and never over 100.
  let ordered = true;
  let bounded = true;
  for (let blur = 0; blur <= 48; blur += 2) {
    for (let a = 0; a <= 100; a += 1) {
      const f = barFill(a, blur, true);
      if (f > 100 || f < 0) bounded = false;
      if (a && f < barFill(a - 1, blur, true)) ordered = false;
      if (blur && f < barFill(a, blur - 2, true) - 1) ordered = false;
    }
  }
  check('the conversion stays in range', bounded, true);
  check('the conversion preserves both orders', ordered, true);
}

// --------------------------------------------------------------- scenario 12
// The popup and full-screen tiers, which used not to be synced at all - the
// visible half of the same bug, since the start menu and the switcher ignored
// the blur slider entirely.
{
  const tiers = tierFills(barFill(24, 20, true));
  check('a popup backs more than a bar', tiers.panel > TINTED_FILL, true);
  check('a full-screen layer backs most', tiers.overlay > tiers.panel, true);

  // A transmissive bar gives transmissive menus, or the slider only half works.
  const thin = tierFills(barFill(24, 0, true));
  check('blur 0 reaches the menus too', thin.panel < tiers.panel, true);
  check('blur 0 reaches the overlays too', thin.overlay < tiers.overlay, true);

  // A solid bar cannot produce a more-than-solid menu.
  const solid = tierFills(100);
  check('solid stays solid across tiers', [solid.panel, solid.overlay], [100, 100]);
}

console.log(failures ? `\n${failures} FAILED` : '\nall scenarios passed');
process.exit(failures ? 1 : 0);
