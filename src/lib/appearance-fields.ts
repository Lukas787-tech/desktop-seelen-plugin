import type { ConfigKey, DesktopConfig } from './config.svelte';
import type { ModuleField } from './modules';
import { SCHEME_OPTIONS } from './schemes';

/**
 * The Appearance dialog's fields, in its tabs.
 *
 * The same settings are declared a second time in `metadata.yml` for Seelen's
 * own Settings window, which cannot read this file. `npm test` holds the two
 * together - every key, option and range here must match its declaration
 * there - so a scheme added to one and forgotten in the other fails a check
 * rather than a user. The shell theme's settings are in `shell-theme.ts`, held
 * to the theme's own `metadata.yml` the same way.
 */

export type AppearanceTab =
  | 'looks'
  | 'vibe'
  | 'colour'
  | 'panels'
  | 'text'
  | 'controls'
  | 'layout'
  | 'wallpaper'
  | 'motion'
  | 'shell'
  | 'css'
  | 'share';

export const APPEARANCE_TABS: readonly { id: AppearanceTab; label: string; section: string }[] = [
  { id: 'looks', label: 'Looks and presets', section: 'Desktop' },
  { id: 'vibe', label: 'AI designer', section: 'Desktop' },
  { id: 'colour', label: 'Colour', section: 'Desktop' },
  { id: 'panels', label: 'Panels', section: 'Desktop' },
  { id: 'text', label: 'Text and fonts', section: 'Desktop' },
  { id: 'controls', label: 'Controls', section: 'Desktop' },
  { id: 'layout', label: 'Icons and layout', section: 'Desktop' },
  { id: 'wallpaper', label: 'Wallpaper', section: 'Desktop' },
  { id: 'motion', label: 'Motion', section: 'Desktop' },
  { id: 'shell', label: 'Dock and start menu', section: 'Seelen shell' },
  { id: 'css', label: 'Custom CSS', section: 'More' },
  { id: 'share', label: 'Share and reset', section: 'More' },
];

export type FieldTab = Exclude<AppearanceTab, 'looks' | 'vibe' | 'shell' | 'css' | 'share'>;

const options = (...pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));

export const APPEARANCE_FIELDS: Record<FieldTab, readonly ModuleField[]> = {
  colour: [
    { key: 'colorScheme', label: 'Colour scheme', type: 'select', options: SCHEME_OPTIONS },
    {
      key: 'followTheme',
      label: 'Follow the active theme',
      description: "Take the panel colour and accent from the Seelen theme's preset.",
      type: 'switch',
    },
    {
      key: 'schemeAccent',
      label: "Use the scheme's accents",
      description: 'Off, the two accent colours below are used with any scheme.',
      type: 'switch',
    },
    { key: 'schemeGround', label: 'Custom ground', description: 'Every grey is mixed between these two.', type: 'color' },
    { key: 'schemeInk', label: 'Custom ink', type: 'color' },
    { key: 'accentColor', label: 'Accent', type: 'color' },
    {
      key: 'accentColor2',
      label: 'Second accent',
      description: 'The far end of gradient edges and gradient meters.',
      type: 'color',
    },
    { key: 'surfaceHue', label: 'Tint hue', type: 'range', min: 0, max: 360, step: 5, unit: '°' },
    {
      key: 'surfaceChroma',
      label: 'Tint strength',
      description: "Added on top of the theme's or the scheme's own colour.",
      type: 'range',
      min: 0,
      max: 20,
      step: 1,
    },
  ],
  panels: [
    { key: 'panelOpacity', label: 'Opacity', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'panelBlur', label: 'Backdrop blur', type: 'range', min: 0, max: 48, step: 1, unit: 'px' },
    {
      key: 'backdropSaturation',
      label: 'Backdrop saturation',
      description: 'Above 100% makes the wallpaper behind the glass more vivid.',
      type: 'range',
      min: 0,
      max: 250,
      step: 5,
      unit: '%',
    },
    { key: 'panelTexture', label: 'Frosted texture', type: 'switch' },
    {
      key: 'panelFill',
      label: 'Fill',
      type: 'select',
      options: options(['flat', 'Flat'], ['gradient', 'Light from above'], ['accent', 'Accent wash']),
    },
    { key: 'cornerRadius', label: 'Corner radius', type: 'range', min: 0, max: 36, step: 1, unit: 'px' },
    { key: 'panelPadding', label: 'Inner padding', type: 'range', min: 4, max: 32, step: 1, unit: 'px' },
    { key: 'panelBorderWidth', label: 'Edge width', type: 'range', min: 0, max: 6, step: 0.5, unit: 'px' },
    {
      key: 'panelBorderStyle',
      label: 'Edge style',
      type: 'select',
      options: options(
        ['solid', 'Solid'],
        ['dashed', 'Dashed'],
        ['dotted', 'Dotted'],
        ['double', 'Double'],
        ['groove', 'Groove'],
        ['ridge', 'Ridge'],
        ['inset', 'Inset'],
        ['outset', 'Outset (bevel)'],
      ),
    },
    {
      key: 'panelBorderColor',
      label: 'Edge colour',
      type: 'select',
      options: options(['neutral', 'Neutral'], ['ink', 'Ink'], ['accent', 'Accent'], ['gradient', 'Gradient']),
    },
    { key: 'panelBorder', label: 'Edge strength', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
    {
      key: 'borderAnimation',
      label: 'Turn gradient edges',
      description: 'Paused while windows cover the desktop.',
      type: 'switch',
    },
    {
      key: 'panelShadow',
      label: 'Shadow',
      type: 'select',
      options: options(
        ['none', 'None'],
        ['soft', 'Soft'],
        ['medium', 'Medium'],
        ['deep', 'Deep'],
        ['hard', 'Hard offset'],
        ['block', 'Accent block'],
        ['glow', 'Accent glow'],
      ),
    },
    { key: 'panelGlow', label: 'Pointer light', type: 'switch' },
  ],
  text: [
    { key: 'fontFamily', label: 'Interface font', description: 'Every label, row and menu.', type: 'font', placeholder: 'Theme default' },
    { key: 'displayFont', label: 'Display font', description: 'The clock, the timer and panel titles.', type: 'font', placeholder: 'Same as interface' },
    { key: 'monoFont', label: 'Monospace font', description: 'Code and other fixed-pitch text.', type: 'font', placeholder: 'Cascadia Code' },
    { key: 'fontSize', label: 'Base text size', type: 'range', min: 10, max: 18, step: 1, unit: 'px' },
    { key: 'fontWeight', label: 'Text weight', type: 'range', min: 300, max: 700, step: 100 },
    { key: 'displayWeight', label: 'Big number weight', type: 'range', min: 100, max: 900, step: 100 },
    { key: 'letterSpacing', label: 'Letter spacing', type: 'range', min: -4, max: 12, step: 1 },
    { key: 'textShadow', label: 'Text shadow', description: 'For clear or very transparent panels.', type: 'switch' },
    {
      key: 'titleStyle',
      label: 'Panel titles',
      type: 'select',
      options: options(['caps', 'Small caps'], ['plain', 'Plain'], ['lower', 'Lowercase'], ['hidden', 'Hidden']),
    },
    {
      key: 'titleDecor',
      label: 'Title decoration',
      type: 'select',
      options: options(
        ['none', 'None'],
        ['bracket', 'Brackets'],
        ['underline', 'Underline'],
        ['tab', 'Tab'],
        ['bar', 'Title bar'],
        ['dot', 'Accent dot'],
      ),
    },
    {
      key: 'titleAlign',
      label: 'Title alignment',
      type: 'select',
      options: options(['left', 'Left'], ['center', 'Centre'], ['right', 'Right']),
    },
    { key: 'titleWeight', label: 'Title weight', type: 'range', min: 300, max: 900, step: 100 },
  ],
  controls: [
    {
      key: 'controlShape',
      label: 'Control shape',
      description: 'Buttons, fields, chips, switches and meters.',
      type: 'select',
      options: options(
        ['square', 'Square'],
        ['subtle', 'Subtle'],
        ['rounded', 'Rounded'],
        ['round', 'Round'],
        ['pill', 'Pill'],
      ),
    },
    {
      key: 'density',
      label: 'Density',
      type: 'select',
      options: options(['compact', 'Compact'], ['cosy', 'Cosy'], ['roomy', 'Roomy']),
    },
    { key: 'barThickness', label: 'Meter thickness', type: 'range', min: 2, max: 14, step: 1, unit: 'px' },
    {
      key: 'barStyle',
      label: 'Meter style',
      type: 'select',
      options: options(['solid', 'Solid'], ['gradient', 'Gradient'], ['striped', 'Striped'], ['glow', 'Glowing']),
    },
    {
      key: 'scrollbars',
      label: 'Scrollbars',
      type: 'select',
      options: options(['thin', 'Thin'], ['hidden', 'Hidden'], ['auto', 'Windows default']),
    },
  ],
  layout: [
    { key: 'iconSize', label: 'Icon size', type: 'range', min: 24, max: 128, step: 4, unit: 'px' },
    {
      key: 'labelMode',
      label: 'Icon labels',
      type: 'select',
      options: options(['always', 'Always'], ['hover', 'On hover'], ['never', 'Never']),
    },
    {
      key: 'iconLabelStyle',
      label: 'Label style',
      type: 'select',
      options: options(['shadow', 'Shadowed'], ['pill', 'On a pill'], ['plain', 'Plain']),
    },
    { key: 'iconRadius', label: 'Icon corner radius', type: 'range', min: 0, max: 24, step: 1, unit: 'px' },
    { key: 'gridSize', label: 'Grid cell size', type: 'range', min: 48, max: 200, step: 4, unit: 'px' },
    { key: 'snapToGrid', label: 'Snap to grid', description: 'Turn off for pixel-precise placement.', type: 'switch' },
    { key: 'lockLayout', label: 'Lock layout', description: 'Prevents dragging icons and panels.', type: 'switch' },
  ],
  wallpaper: [
    {
      key: 'wallpaperEnabled',
      label: 'Wallpaper engine',
      description: "Off, the surface is clear and Windows' own wallpaper shows through.",
      type: 'switch',
    },
    {
      key: 'wallpaperFit',
      label: 'Fit',
      type: 'select',
      options: options(['cover', 'Cover'], ['contain', 'Contain'], ['fill', 'Fill'], ['none', 'None']),
    },
    { key: 'wallpaperBlur', label: 'Blur', type: 'range', min: 0, max: 40, step: 1, unit: 'px' },
    { key: 'wallpaperSaturation', label: 'Saturation', type: 'range', min: 0, max: 200, step: 5, unit: '%' },
    { key: 'wallpaperBrightness', label: 'Brightness', type: 'range', min: 10, max: 150, step: 5, unit: '%' },
    { key: 'wallpaperOverlayColor', label: 'Tint colour', type: 'color' },
    { key: 'wallpaperOverlayOpacity', label: 'Tint strength', type: 'range', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'wallpaperMuted', label: 'Mute video wallpapers', type: 'switch' },
    {
      key: 'wallpaperPauseWhenCovered',
      label: 'Pause video when covered',
      description: 'Stops decoding while a window hides the desktop.',
      type: 'switch',
    },
    { key: 'slideshowEnabled', label: 'Slideshow', type: 'switch' },
    { key: 'slideshowInterval', label: 'Change every', type: 'number', min: 5, step: 5, unit: 'seconds' },
    { key: 'slideshowRandomize', label: 'Shuffle', type: 'switch' },
  ],
  motion: [
    { key: 'animations', label: 'Animations', type: 'switch' },
    {
      key: 'motionScale',
      label: 'Animation length',
      description: '200% takes twice as long.',
      type: 'range',
      min: 25,
      max: 200,
      step: 5,
      unit: '%',
    },
    { key: 'staggerScale', label: 'List stagger', type: 'range', min: 0, max: 300, step: 10, unit: '%' },
    {
      key: 'entranceStyle',
      label: 'Panel entrance',
      type: 'select',
      options: options(
        ['rise', 'Rise'],
        ['fade', 'Fade'],
        ['zoom', 'Zoom'],
        ['drop', 'Drop'],
        ['slide', 'Slide'],
        ['blur', 'Into focus'],
        ['none', 'None'],
      ),
    },
  ],
};

/** Shown at the top of the Shell tab rather than among the desktop's motion settings. */
export const STYLE_SHELL_FIELD: ModuleField = {
  key: 'styleShell',
  label: 'Dress the shell like the desktop',
  description:
    "Sends the desktop's fonts, text size, density, corners, blur, edges, fills, motion and colour scheme to the settings below, which then follow it.",
  type: 'switch',
};

/**
 * Whether a field means anything with the settings as they stand.
 *
 * Hidden rather than disabled: a dialog of forty controls reads better when the
 * two custom-colour pickers only appear once a custom scheme is chosen than when
 * they sit greyed out under every other one.
 */
export function fieldVisible(key: ConfigKey, cfg: DesktopConfig): boolean {
  switch (key) {
    case 'schemeGround':
    case 'schemeInk':
      return cfg.colorScheme === 'custom';
    case 'followTheme':
      return cfg.colorScheme === 'theme';
    case 'schemeAccent':
      return cfg.colorScheme !== 'theme' && cfg.colorScheme !== 'custom';
    case 'borderAnimation':
      return cfg.panelBorderColor === 'gradient';
    case 'motionScale':
    case 'staggerScale':
    case 'entranceStyle':
      return cfg.animations;
    case 'iconLabelStyle':
      return cfg.labelMode !== 'never';
    case 'wallpaperFit':
    case 'wallpaperBlur':
    case 'wallpaperSaturation':
    case 'wallpaperBrightness':
    case 'wallpaperOverlayColor':
    case 'wallpaperOverlayOpacity':
    case 'wallpaperMuted':
    case 'wallpaperPauseWhenCovered':
    case 'slideshowEnabled':
      return cfg.wallpaperEnabled;
    case 'slideshowInterval':
    case 'slideshowRandomize':
      return cfg.wallpaperEnabled && cfg.slideshowEnabled;
    default:
      return true;
  }
}

/** Starting points for the CSS tab, each one self-contained. */
export const CSS_SNIPPETS: readonly { label: string; css: string }[] = [
  {
    label: 'Clear clock',
    css: `/* The clock floats on the wallpaper with no panel behind it. */
body .panel[data-module='clock'] {
  --panel-alpha: 0;
  border-color: transparent;
  box-shadow: none;
  backdrop-filter: none;
}`,
  },
  {
    label: 'Accent per module',
    css: `/* Each module in its own colour; meters, switches and glows follow. */
[data-module='media'] { --accent: #f38ba8; }
[data-module='sysmon'] { --accent: #a6e3a1; }
[data-module='notes'] { --accent: #f9e2af; }`,
  },
  {
    label: 'Monospace everything',
    css: `/* Tokens set by the settings live on body, so override them there with !important. */
body { --ui-font: var(--mono-font) !important; }`,
  },
  {
    label: 'Hide one title',
    css: `[data-module='clock'] header { display: none; }`,
  },
  {
    label: 'Uppercase buttons',
    css: `.m-btn, .m-chip { text-transform: uppercase; letter-spacing: 0.06em; }`,
  },
  {
    label: 'Dim on idle',
    css: `/* Panels fade back until the pointer is over them. */
.panel.module { opacity: 0.55; transition: opacity 300ms; }
.panel.module:hover { opacity: 1; }`,
  },
];
