import type { ModuleField } from './modules';
import { LAYOUT_OPTIONS } from './gamepad';
import { PRESET_OPTIONS } from './padkeys';

/**
 * The Game mode dialog's fields, in its tabs.
 *
 * The same settings are declared a second time in `widgets/desktop/metadata.yml`
 * for Seelen's own Settings window, which cannot read this file; `npm test`
 * holds the two together, exactly as it does for the Appearance dialog, so a
 * range changed in one place and forgotten in the other fails a check rather
 * than a user.
 *
 * `gameModeDisplay` is deliberately absent: it is a list of the displays
 * actually connected right now, which no static table can hold, so the dialog
 * draws it itself.
 */

export type GameModeTab = 'display' | 'library' | 'look' | 'controller' | 'bindings' | 'desktop';

export const GAME_MODE_TABS: readonly { id: GameModeTab; label: string; section: string }[] = [
  { id: 'display', label: 'Display and behaviour', section: 'Game mode' },
  { id: 'library', label: 'Library', section: 'Game mode' },
  { id: 'look', label: 'Look', section: 'Game mode' },
  { id: 'controller', label: 'Controller', section: 'Controller' },
  { id: 'bindings', label: 'Buttons', section: 'Controller' },
  { id: 'desktop', label: 'Drive the desktop', section: 'Controller' },
];

const options = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export const GAME_MODE_FIELDS: Record<GameModeTab, readonly ModuleField[]> = {
  display: [
    {
      key: 'gameModeAtStart',
      label: 'Open game mode at start-up',
      description: 'The chosen display comes up as the launcher rather than as a desktop.',
      type: 'switch',
    },
    {
      key: 'gameModeOnLaunch',
      label: 'When a game starts',
      description: 'The game covers the launcher either way; this is what is underneath it.',
      type: 'select',
      options: options(['stay', 'Leave the launcher open'], ['leave', 'Go back to the desktop']),
    },
    {
      key: 'gameModeKeepFocus',
      label: 'Keep the keyboard',
      description:
        'A controller is only readable while this display holds the keyboard, so letting go turns the pad off. Off, alt-tabbing away leaves the launcher up but idle.',
      type: 'switch',
    },
    {
      key: 'gameModeHideCursor',
      label: 'Hide the mouse pointer',
      description: 'While the launcher is open and the controller is the thing being used.',
      type: 'switch',
    },
    {
      key: 'gameModeAnimate',
      label: 'Animate',
      description: 'The lift on the selected cover, and the backdrop cross-fade.',
      type: 'switch',
    },
  ],

  library: [
    {
      key: 'gameModeSort',
      label: 'Order',
      type: 'select',
      options: options(
        ['recent', 'Recently played'],
        ['name', 'Name'],
        ['played', 'Most played'],
        ['launcher', 'Store'],
      ),
    },
    { key: 'gameModeFavouritesFirst', label: 'Favourites first', type: 'switch' },
    {
      key: 'gameModeRecentCount',
      label: 'Games on the home row',
      type: 'range',
      min: 4,
      max: 30,
      step: 1,
    },
    { key: 'gameModeShowSearch', label: 'Show the search row', type: 'switch' },
    {
      key: 'gameModeShowStats',
      label: 'Show play time',
      description: 'Under each tile, and in the details pane.',
      type: 'switch',
    },
    {
      key: 'gameModeShowBlurb',
      label: 'Show descriptions',
      description:
        'The one-line descriptions written by a model. Nothing is shown until you ask for them to be written, on this tab.',
      type: 'switch',
    },
    {
      key: 'gameModeShowApps',
      label: 'Show the Apps section',
      description: 'The desktop icons, as a grid that can be started from the sofa.',
      type: 'switch',
    },
    {
      key: 'gameModeShowPower',
      label: 'Show the Power section',
      description: 'Sleep, restart, shut down and lock, without leaving the launcher.',
      type: 'switch',
    },
  ],

  look: [
    {
      key: 'gameModeLayout',
      label: 'Layout',
      type: 'select',
      options: options(
        ['shelf', 'Shelves - rows that scroll sideways'],
        ['grid', 'Grid - everything at once'],
        ['wall', 'Wall - large covers, few of them'],
      ),
    },
    { key: 'gameModeTileSize', label: 'Tile size', type: 'range', min: 120, max: 400, step: 10, unit: 'px' },
    {
      key: 'gameModeArtShape',
      label: 'Tile shape',
      type: 'select',
      options: options(['square', 'Square'], ['portrait', 'Portrait'], ['wide', 'Wide']),
    },
    {
      key: 'gameModeArtStyle',
      label: 'On each tile',
      description:
        'Every tile is the same surface; this is what sits on it. Covers are only shown for games you gave one to.',
      type: 'select',
      options: options(
        ['icon', "The application's icon"],
        ['cover', 'A cover image, where there is one'],
        ['plain', 'The title only'],
      ),
    },
    {
      key: 'gameModeBackdrop',
      label: 'Backdrop',
      type: 'select',
      options: options(
        ['wallpaper', 'The wallpaper'],
        ['art', "The selected game's cover, if it has one"],
        ['plain', 'Plain'],
      ),
    },
    { key: 'gameModeBackdropDim', label: 'Backdrop dim', type: 'range', min: 0, max: 95, step: 1, unit: '%' },
    { key: 'gameModeBackdropBlur', label: 'Backdrop blur', type: 'range', min: 0, max: 120, step: 2, unit: 'px' },
    { key: 'gameModeShowHero', label: 'Show the details panel', type: 'switch' },
    { key: 'gameModeShowClock', label: 'Show the clock', type: 'switch' },
    { key: 'gameModeShowLegend', label: 'Show the button hints', type: 'switch' },
  ],

  controller: [
    {
      key: 'padEnabled',
      label: 'Read the controller',
      description:
        'Off, game mode still works with the keyboard and the mouse. A pad can only be read while this display holds the keyboard - see the note below.',
      type: 'switch',
    },
    {
      key: 'padLayout',
      label: 'Button glyphs',
      type: 'select',
      options: LAYOUT_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
    },
    {
      key: 'padDeadzone',
      label: 'Stick dead zone',
      description: 'How far a stick must move before it counts as moved at all.',
      type: 'range',
      min: 0,
      max: 60,
      step: 1,
      unit: '%',
    },
    {
      key: 'padCurve',
      label: 'Stick response',
      description: '100 is linear; higher gives finer control near the centre.',
      type: 'range',
      min: 100,
      max: 300,
      step: 5,
      unit: '%',
    },
    {
      key: 'padStickNavigates',
      label: 'The left stick moves the selection',
      description: 'As well as the d-pad, which always does.',
      type: 'switch',
    },
    {
      key: 'padStickThreshold',
      label: 'Stick step point',
      description: 'How far the stick goes before it counts as one step.',
      type: 'range',
      min: 20,
      max: 95,
      step: 1,
      unit: '%',
    },
    {
      key: 'padRepeatDelay',
      label: 'Hold before repeating',
      type: 'range',
      min: 150,
      max: 900,
      step: 10,
      unit: 'ms',
    },
    {
      key: 'padRepeatInterval',
      label: 'Repeat every',
      type: 'range',
      min: 40,
      max: 400,
      step: 5,
      unit: 'ms',
    },
    {
      key: 'padRepeatMin',
      label: 'Fastest repeat',
      description: 'A long hold accelerates from the rate above to this one.',
      type: 'range',
      min: 20,
      max: 300,
      step: 5,
      unit: 'ms',
    },
    {
      key: 'padTriggerThreshold',
      label: 'Trigger pull',
      description: 'How far a trigger must be pulled to read as a press.',
      type: 'range',
      min: 5,
      max: 95,
      step: 1,
      unit: '%',
    },
    { key: 'padRumble', label: 'Rumble', type: 'switch' },
    {
      key: 'padRumbleStrength',
      label: 'Rumble strength',
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      unit: '%',
    },
  ],

  bindings: [
    {
      key: 'padBindings',
      label: 'Button bindings',
      description:
        'One `action=button` per line or separated by commas, e.g. `confirm=south, back=east`. Buttons are named by position - south, east, west, north, l1, r1, l2, r2, select, start, l3, r3 - so one set works on every pad. Blank uses the console default.',
      type: 'text',
      placeholder: 'confirm=south, back=east',
    },
  ],

  desktop: [
    {
      key: 'padDesktop',
      label: 'Drive the desktop with the controller',
      description:
        'Outside game mode, turn the pad into keys, clicks and scrolling for the surface itself. It reaches this desktop only - not games and not other applications.',
      type: 'switch',
    },
    {
      key: 'padPreset',
      label: 'Button profile',
      type: 'select',
      options: PRESET_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
    },
    {
      key: 'padCustomKeys',
      label: 'Button overrides',
      description:
        'Applied over the profile: `north=f5, l3=click, r1=ctrl+tab`. A value may be a key, `click`, `rightclick`, `middleclick`, `scrollup`, `scrolldown`, or `none`.',
      type: 'text',
      placeholder: 'north=f5, r3=rightclick',
    },
    {
      key: 'padPointer',
      label: 'The right stick moves a pointer',
      type: 'switch',
    },
    {
      key: 'padPointerSpeed',
      label: 'Pointer speed',
      type: 'range',
      min: 200,
      max: 3000,
      step: 50,
      unit: 'px/s',
    },
    {
      key: 'padPointerAccel',
      label: 'Pointer ramp',
      description: '100 is constant speed; higher makes a small push crawl and a full push sprint.',
      type: 'range',
      min: 100,
      max: 400,
      step: 10,
      unit: '%',
    },
    { key: 'padPointerSize', label: 'Pointer size', type: 'range', min: 10, max: 60, step: 1, unit: 'px' },
    {
      key: 'padPointerHide',
      label: 'Fade the pointer after',
      description: '0 keeps it on screen.',
      type: 'range',
      min: 0,
      max: 20,
      step: 1,
      unit: 's',
    },
    { key: 'padStickScrolls', label: 'The left stick scrolls', type: 'switch' },
    {
      key: 'padScrollSpeed',
      label: 'Scroll speed',
      type: 'range',
      min: 2,
      max: 60,
      step: 1,
      unit: 'lines/s',
    },
  ],
};

/** Every key the dialog owns, for the "same as other displays" reset. */
export const GAME_MODE_KEYS = Object.values(GAME_MODE_FIELDS)
  .flat()
  .map((field) => field.key);
