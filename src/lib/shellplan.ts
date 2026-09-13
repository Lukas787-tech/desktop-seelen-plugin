/**
 * Decides which theme variables a sync should write, and which of them are
 * allowed to overwrite a value already there.
 *
 * Separated from `shellstyle.ts` - which does the settings I/O - because this
 * is the part with the reasoning in it, and the part that was wrong twice. On
 * its own it is a pure state machine over strings, so it can be exercised
 * directly rather than through a live settings file.
 *
 * The rule it implements, and why, is documented on `syncShellStyle`. In
 * short: **push on change, not on difference.** A variable is written only
 * when this surface's own setting for it has moved since the last push, so a
 * value edited in the theme's own settings is left alone rather than sprung
 * back the instant the host broadcasts the edit.
 */

/**
 * The fill a *non-blurring* panel needs in order to hide as much of its
 * backdrop as a blurred one at `opacity` percent does.
 *
 * This exists because copying the surface's panel opacity to the shell
 * unchanged is wrong, and wrong in a way that looks bad rather than subtly
 * off. The two panels are not the same material: a module panel on the desktop
 * blurs the wallpaper behind it, so at 24% it still reads as glass - the blur,
 * not the fill, is what stops you reading the wallpaper through it. A dock
 * cannot blur anything (see the material note in `shared/tokens.css`), so the
 * same 24% is a sheet of tinted cellophane with your wallpaper in full focus
 * behind it, and no amount of sheen or grain hides detail that sharp. Only
 * density does.
 *
 * So the blur's contribution is estimated and paid for in alpha instead.
 * `blur / (blur + 18)` is how much of the hiding the blur was doing: 18px is
 * roughly where a backdrop stops having legible edges in it, so at 18px the
 * blur and the fill are each doing half the work, and beyond that the blur
 * does nearly all of it. That share becomes an exponent below 1, which lifts
 * the middle of the range - where the problem is - while leaving both ends
 * alone: 0 is still nothing and 100 is still solid, because "invisible" and
 * "opaque" mean the same thing in both materials. With the surface's default
 * 20px blur, 24% becomes 64%, 60% becomes 85%.
 *
 * The exponent floor is there because the formula would otherwise drive a
 * heavy blur to near-opaque for every fill; past about 20px the estimate has
 * nothing left to say.
 */
export function occludingFill(opacity: number, blur: number): number {
  const hiding = Math.max(0, blur) / (Math.max(0, blur) + 18);
  const gamma = Math.max(0.3, 1 - 1.3 * hiding);
  const fill = Math.min(100, Math.max(0, opacity)) / 100;
  return Math.round(100 * fill ** gamma);
}

/**
 * The fill a bar wants at the reference settings - 24% panels behind a 20px
 * blur - once its ground is the *measured* wallpaper colour.
 *
 * With the colour right, alpha has only one job left: suppressing the sharp
 * detail a blur would have smoothed. Compared side by side against a real
 * wallpaper, 56% still showed the moon through the dock, 68% was close, 78%
 * was indistinguishable from a blurred panel beside it, and 88% started to
 * look like paint.
 */
export const TINTED_FILL = 78;

/**
 * How much of the remaining transparency a full blur buys back.
 *
 * Derived, not picked: it is the value that makes the reference settings land
 * exactly on `TINTED_FILL`. Changing that anchor should change this with it.
 */
const TINTED_BOOST = 0.74;

/**
 * The bar fill to ask the theme for.
 *
 * Without a measured colour this is pure occlusion-matching, because the
 * ground is wrong and density is all that is hiding it.
 *
 * With one, the ground is already right and the fill is left standing in for
 * the blur itself - so it has to *scale with the blur*, which a flat floor did
 * not. That was a real bug and a visible one: the blur slider moved and the
 * shell did not change at all, because every value it produced was below the
 * floor and got flattened to it. Now blur 0 leaves the bar as transmissive as
 * the surface's own unblurred panels are, and turning the blur up thickens the
 * bar the way it thickens the frost on the desktop.
 */
export function barFill(opacity: number, blur: number, tinted: boolean): number {
  const base = occludingFill(opacity, blur);
  // Zero is not a thin panel, it is no panel, and nothing below should argue
  // with that - a surface asked to show nothing should not grow a solid dock.
  if (!tinted || opacity <= 0) return base;
  const hiding = Math.max(0, blur) / (Math.max(0, blur) + 18);
  return Math.round(base + (100 - base) * hiding * TINTED_BOOST);
}

/**
 * The popup and full-screen fills that go with a given bar fill.
 *
 * These used not to be synced at all, on the grounds that a widget panel and a
 * shell panel were not the same material and one number could not describe
 * both. Measuring the colour removed that objection - they are now made of the
 * same thing - and leaving them out had become the visible half of the blur
 * bug, since the start menu and the switcher ignored the slider entirely.
 *
 * A menu wants more backing than a bar of icons does, so the tiers keep the
 * proportion the theme's own defaults set: of whatever transparency the bar
 * has left, a popup keeps 58% and a full-screen layer 39%.
 */
export function tierFills(bar: number): { panel: number; overlay: number } {
  const clear = 100 - bar;
  return {
    panel: Math.round(100 - clear * 0.58),
    overlay: Math.round(100 - clear * 0.39),
  };
}

/** One sync's worth of work. Empty `writes` means there is nothing to do. */
export interface ShellPlan {
  writes: Array<[string, string]>;
  /**
   * The subset of `writes` that may replace an existing value. The rest are
   * seeds: written only where the theme has nothing yet.
   */
  overwrite: Set<string>;
}

export const NOTHING: ShellPlan = { writes: [], overwrite: new Set() };

export class ShellSyncPlanner {
  /** What was last pushed, to tell a real change from a re-read of the same. */
  #pushed: Record<string, string> | null = null;
  /**
   * Whether the switch has *ever* been on in this session.
   *
   * Deliberately not cleared when it is switched off: that is precisely the
   * state that distinguishes "switched back on" - which should re-apply - from
   * "the session just started" - which should only seed. Clearing it here made
   * the two indistinguishable and turned a re-enable into a no-op.
   */
  #everEnabled = false;

  /**
   * @param wanted  The variables this surface's settings currently imply.
   * @param enabled Whether the user has asked for the shell to follow them.
   */
  next(wanted: Record<string, string>, enabled: boolean): ShellPlan {
    if (!enabled) {
      // Forget what was pushed, so switching back on is a deliberate re-apply
      // rather than another seed. `#everEnabled` deliberately survives.
      this.#pushed = null;
      return NOTHING;
    }

    const first = this.#pushed === null;
    /*
     * Off-to-on is the user asking for these to be applied, so it overwrites.
     * A first call at startup is not - it only fills in what the theme does
     * not already have, which is what stops a restart stomping values tuned in
     * the session before it.
     */
    const reapply = first && this.#everEnabled;
    const previous = this.#pushed;

    this.#pushed = wanted;
    this.#everEnabled = true;

    const writes: Array<[string, string]> = [];
    const overwrite = new Set<string>();

    for (const [name, value] of Object.entries(wanted)) {
      if (first) {
        writes.push([name, value]);
        if (reapply) overwrite.add(name);
      } else if (previous?.[name] !== value) {
        writes.push([name, value]);
        overwrite.add(name);
      }
    }

    return { writes, overwrite };
  }
}

/**
 * Applies a plan to the theme's current variables, in place.
 *
 * Returns whether anything actually changed, which is what decides if the
 * settings file is written at all - both monitor replicas run the same sync
 * with the same values, and the second one finding nothing to do is what keeps
 * them from racing over the file.
 */
export function applyPlan(plan: ShellPlan, current: Record<string, string>): boolean {
  let changed = false;
  for (const [name, value] of plan.writes) {
    // A seed never replaces a value that is already there.
    if (!plan.overwrite.has(name) && current[name] !== undefined) continue;
    if (current[name] === value) continue;
    current[name] = value;
    changed = true;
  }
  return changed;
}
