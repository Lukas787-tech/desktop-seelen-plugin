import type { TransitionConfig } from 'svelte/transition';
import { config } from './config.svelte';

/**
 * Svelte transitions for the moments CSS cannot animate: an element leaving.
 *
 * Everything that *arrives* on the surface animates from a CSS keyframe in
 * `src/styles/motion.css`, which the Animations setting and the system's
 * reduced-motion preference already reach. An element that is removed is gone
 * before any stylesheet can move it, so exits - and the few entrances that
 * have to be sequenced with one - go through here instead.
 *
 * Svelte plays these with the Web Animations API, which neither the surface's
 * `animation: none !important` rule nor the zeroed CSS durations touch. So
 * each one asks `motionEnabled()` first and collapses to an instant change
 * when motion is off.
 */

const reducedMotion =
  typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** Whether anything should move at all: the surface's setting, then the system's. */
export function motionEnabled(): boolean {
  return config.current.animations !== false && !(reducedMotion?.matches ?? false);
}

function ms(duration: number): number {
  if (!motionEnabled()) return 0;
  // Animation length reaches the exits too, or a panel would arrive at one
  // pace and leave at another.
  return (duration * Math.max(0, config.current.motionScale ?? 100)) / 100;
}

/** The JS twin of `--ease`: nearly all of the distance early, then a glide. */
export function expoOut(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

/** For exits: starts gently and leaves quickly, so it never looks reluctant. */
export function quadIn(t: number): number {
  return t * t;
}

interface MotionOptions {
  delay?: number;
  duration?: number;
  /** Vertical travel in pixels: positive comes from (or goes) below. */
  y?: number;
  /** The scale it starts from, or shrinks to. */
  scale?: number;
  /** Blur in pixels at the far end. Keep it off anything large or numerous. */
  blur?: number;
}

interface TransitionOptions {
  direction?: 'in' | 'out' | 'both';
}

/**
 * Svelte passes the direction as a third argument. An exit also stops taking
 * the pointer at once: an element fading out is already gone as far as the
 * user is concerned, and a menu row still catching hovers for 150ms after the
 * menu closed is a click landing on something invisible.
 */
function leaving(node: Element, options?: TransitionOptions): boolean {
  const out = options?.direction === 'out';
  if (out) (node as HTMLElement).style.pointerEvents = 'none';
  return out;
}

/** Grows out of a point, or shrinks back into it: menus, dialogs, panels. */
export function pop(
  node: Element,
  { delay = 0, duration = 260, y = 0, scale = 0.95, blur = 0 }: MotionOptions = {},
  options?: TransitionOptions,
): TransitionConfig {
  const out = leaving(node, options);
  return {
    delay: ms(delay),
    duration: ms(duration),
    easing: out ? quadIn : expoOut,
    css: (t, u) =>
      `opacity: ${t}; transform: translateY(${u * y}px) scale(${scale + (1 - scale) * t});` +
      (blur ? ` filter: blur(${u * blur}px);` : ''),
  };
}

/** Opacity alone, for layers that cover the screen. */
export function fadeLayer(
  node: Element,
  { delay = 0, duration = 220 }: MotionOptions = {},
  options?: TransitionOptions,
): TransitionConfig {
  const out = leaving(node, options);
  return {
    delay: ms(delay),
    duration: ms(duration),
    easing: out ? quadIn : expoOut,
    css: (t) => `opacity: ${t};`,
  };
}

/**
 * A wallpaper arriving: fades in while settling from slightly too close, the
 * way a photo drops onto a table. Scale only - a full-screen blur would make
 * every panel's backdrop re-blur on every frame of it.
 */
export function settle(
  _node: Element,
  { delay = 0, duration = 1400, scale = 1.06 }: MotionOptions = {},
): TransitionConfig {
  return {
    delay: ms(delay),
    duration: ms(duration),
    easing: expoOut,
    css: (t, u) => `opacity: ${t}; transform: scale(${1 + (scale - 1) * u});`,
  };
}

/**
 * The layer being replaced in a crossfade: fully there until the new one has
 * all but covered it, then gone. Whichever of the two is painted on top, the
 * picture never dips through to the ground between them.
 */
export function linger(
  _node: Element,
  { delay = 0, duration = 1400 }: MotionOptions = {},
): TransitionConfig {
  return {
    delay: ms(delay),
    duration: ms(duration),
    css: (t) => `opacity: ${Math.min(1, t * 3)};`,
  };
}
