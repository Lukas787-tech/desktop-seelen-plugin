/**
 * Colour schemes for the surface, in the shape Linux desktops have used for a
 * decade: a handful of named palettes that every application reads the same
 * way, so one choice recolours the whole screen.
 *
 * ## Why they remap Seelen's scale instead of adding a second one
 *
 * Every stylesheet in this package already paints in Seelen's
 * contrast-adaptive `--color-gray-*` ramp - `gray-50` is the ground, `gray-900`
 * the ink, and the hundred-odd hovers, tracks and dividers in between are
 * `color-mix`es of `gray-300`. A scheme that introduced its own tokens would
 * have to be taught to every one of those declarations, in forty files. A
 * scheme that *redefines the ramp* on `body` reaches all of them for free,
 * because each is already a `var()` of it - which is exactly how a base16
 * theme reaches every program that reads its sixteen colours.
 *
 * So a palette here is the base16 set, trimmed to what the ramp needs: three
 * grounds, a comment tone, a dim and a full ink, and the named hues the
 * modules use for state (a red for a failure, a green for a charge). The ramp
 * between the named stops is mixed in OKLab, so a scheme never has to spell
 * out ten greys that would only be guesses at someone else's palette.
 */

export interface Palette {
  label: string;
  /** Light schemes flip `color-scheme`, so native controls and scrollbars follow. */
  dark: boolean;
  /** Ground, raised ground, selection - base00, base01, base02. */
  bg: string;
  bg1: string;
  bg2: string;
  /** Comments and disabled ink - base03. */
  comment: string;
  /** Secondary text - base04. */
  fgDim: string;
  /** Body text - base05. */
  fg: string;
  red: string;
  orange: string;
  yellow: string;
  green: string;
  cyan: string;
  blue: string;
  purple: string;
  /** The scheme's signature colour, and a second one for gradients. */
  accent: string;
  accent2: string;
}

export type SchemeId =
  | 'theme'
  | 'custom'
  | 'catppuccin-mocha'
  | 'catppuccin-latte'
  | 'nord'
  | 'gruvbox-dark'
  | 'gruvbox-light'
  | 'dracula'
  | 'tokyo-night'
  | 'rose-pine'
  | 'rose-pine-dawn'
  | 'everforest'
  | 'kanagawa'
  | 'one-dark'
  | 'solarized-dark'
  | 'solarized-light'
  | 'monokai'
  | 'synthwave'
  | 'catppuccin-frappe'
  | 'catppuccin-macchiato'
  | 'rose-pine-moon'
  | 'gruvbox-material'
  | 'everforest-light'
  | 'tokyo-day'
  | 'github-dark'
  | 'github-light'
  | 'ayu-dark'
  | 'ayu-mirage'
  | 'ayu-light'
  | 'night-owl'
  | 'palenight'
  | 'oxocarbon'
  | 'horizon'
  | 'nightfox'
  | 'moonlight'
  | 'poimandres'
  | 'cobalt2'
  | 'vesper';

/* Values are the palettes' own published colours, with two liberties noted
   where they are taken: a scheme whose base04 is nearly its body text gets a
   true mid-tone, or muted labels would not read as muted. */
export const PALETTES: Record<Exclude<SchemeId, 'theme' | 'custom'>, Palette> = {
  'catppuccin-mocha': {
    label: 'Catppuccin Mocha',
    dark: true,
    bg: '#1e1e2e',
    bg1: '#313244',
    bg2: '#45475a',
    comment: '#6c7086',
    fgDim: '#a6adc8',
    fg: '#cdd6f4',
    red: '#f38ba8',
    orange: '#fab387',
    yellow: '#f9e2af',
    green: '#a6e3a1',
    cyan: '#94e2d5',
    blue: '#89b4fa',
    purple: '#cba6f7',
    accent: '#cba6f7',
    accent2: '#89b4fa',
  },
  'catppuccin-latte': {
    label: 'Catppuccin Latte',
    dark: false,
    bg: '#eff1f5',
    bg1: '#ccd0da',
    bg2: '#bcc0cc',
    comment: '#9ca0b0',
    fgDim: '#6c6f85',
    fg: '#4c4f69',
    red: '#d20f39',
    orange: '#fe640b',
    yellow: '#df8e1d',
    green: '#40a02b',
    cyan: '#179299',
    blue: '#1e66f5',
    purple: '#8839ef',
    accent: '#8839ef',
    accent2: '#1e66f5',
  },
  nord: {
    label: 'Nord',
    dark: true,
    bg: '#2e3440',
    bg1: '#3b4252',
    bg2: '#434c5e',
    comment: '#4c566a',
    // Nord's base04 is snow storm, a step from its body text; this is the
    // brightened polar night its own editor themes use for comments.
    fgDim: '#9aa3b5',
    fg: '#e5e9f0',
    red: '#bf616a',
    orange: '#d08770',
    yellow: '#ebcb8b',
    green: '#a3be8c',
    cyan: '#8fbcbb',
    blue: '#81a1c1',
    purple: '#b48ead',
    accent: '#88c0d0',
    accent2: '#81a1c1',
  },
  'gruvbox-dark': {
    label: 'Gruvbox Dark',
    dark: true,
    bg: '#282828',
    bg1: '#3c3836',
    bg2: '#504945',
    comment: '#928374',
    fgDim: '#a89984',
    fg: '#ebdbb2',
    red: '#fb4934',
    orange: '#fe8019',
    yellow: '#fabd2f',
    green: '#b8bb26',
    cyan: '#8ec07c',
    blue: '#83a598',
    purple: '#d3869b',
    accent: '#fabd2f',
    accent2: '#fe8019',
  },
  'gruvbox-light': {
    label: 'Gruvbox Light',
    dark: false,
    bg: '#fbf1c7',
    bg1: '#ebdbb2',
    bg2: '#d5c4a1',
    comment: '#a89984',
    fgDim: '#7c6f64',
    fg: '#3c3836',
    red: '#9d0006',
    orange: '#af3a03',
    yellow: '#b57614',
    green: '#79740e',
    cyan: '#427b58',
    blue: '#076678',
    purple: '#8f3f71',
    accent: '#af3a03',
    accent2: '#076678',
  },
  dracula: {
    label: 'Dracula',
    dark: true,
    bg: '#282a36',
    bg1: '#343746',
    bg2: '#44475a',
    comment: '#6272a4',
    fgDim: '#b6b9c9',
    fg: '#f8f8f2',
    red: '#ff5555',
    orange: '#ffb86c',
    yellow: '#f1fa8c',
    green: '#50fa7b',
    cyan: '#8be9fd',
    blue: '#8be9fd',
    purple: '#bd93f9',
    accent: '#bd93f9',
    accent2: '#ff79c6',
  },
  'tokyo-night': {
    label: 'Tokyo Night',
    dark: true,
    bg: '#1a1b26',
    bg1: '#292e42',
    bg2: '#3b4261',
    comment: '#565f89',
    fgDim: '#a9b1d6',
    fg: '#c0caf5',
    red: '#f7768e',
    orange: '#ff9e64',
    yellow: '#e0af68',
    green: '#9ece6a',
    cyan: '#7dcfff',
    blue: '#7aa2f7',
    purple: '#bb9af7',
    accent: '#7aa2f7',
    accent2: '#bb9af7',
  },
  'rose-pine': {
    label: 'Rosé Pine',
    dark: true,
    bg: '#191724',
    bg1: '#26233a',
    bg2: '#403d52',
    comment: '#6e6a86',
    fgDim: '#908caa',
    fg: '#e0def4',
    red: '#eb6f92',
    orange: '#ebbcba',
    yellow: '#f6c177',
    // Rosé Pine has no green; foam is what its own ports use for success.
    green: '#9ccfd8',
    cyan: '#9ccfd8',
    blue: '#31748f',
    purple: '#c4a7e7',
    accent: '#c4a7e7',
    accent2: '#ebbcba',
  },
  'rose-pine-dawn': {
    label: 'Rosé Pine Dawn',
    dark: false,
    bg: '#faf4ed',
    bg1: '#f2e9e1',
    bg2: '#dfdad9',
    comment: '#9893a5',
    fgDim: '#797593',
    fg: '#575279',
    red: '#b4637a',
    orange: '#d7827e',
    yellow: '#ea9d34',
    green: '#56949f',
    cyan: '#56949f',
    blue: '#286983',
    purple: '#907aa9',
    accent: '#907aa9',
    accent2: '#d7827e',
  },
  everforest: {
    label: 'Everforest',
    dark: true,
    bg: '#2d353b',
    bg1: '#3d484d',
    bg2: '#475258',
    comment: '#7a8478',
    fgDim: '#9da9a0',
    fg: '#d3c6aa',
    red: '#e67e80',
    orange: '#e69875',
    yellow: '#dbbc7f',
    green: '#a7c080',
    cyan: '#83c092',
    blue: '#7fbbb3',
    purple: '#d699b6',
    accent: '#a7c080',
    accent2: '#83c092',
  },
  kanagawa: {
    label: 'Kanagawa',
    dark: true,
    bg: '#1f1f28',
    bg1: '#2a2a37',
    bg2: '#363646',
    comment: '#727169',
    fgDim: '#c8c093',
    fg: '#dcd7ba',
    red: '#e46876',
    orange: '#ffa066',
    yellow: '#e6c384',
    green: '#98bb6c',
    cyan: '#7aa89f',
    blue: '#7e9cd8',
    purple: '#957fb8',
    accent: '#7e9cd8',
    accent2: '#957fb8',
  },
  'one-dark': {
    label: 'One Dark',
    dark: true,
    bg: '#282c34',
    bg1: '#353b45',
    bg2: '#3e4451',
    comment: '#5c6370',
    fgDim: '#828997',
    fg: '#abb2bf',
    red: '#e06c75',
    orange: '#d19a66',
    yellow: '#e5c07b',
    green: '#98c379',
    cyan: '#56b6c2',
    blue: '#61afef',
    purple: '#c678dd',
    accent: '#61afef',
    accent2: '#c678dd',
  },
  'solarized-dark': {
    label: 'Solarized Dark',
    dark: true,
    bg: '#002b36',
    bg1: '#073642',
    bg2: '#0e4552',
    comment: '#586e75',
    fgDim: '#657b83',
    fg: '#93a1a1',
    red: '#dc322f',
    orange: '#cb4b16',
    yellow: '#b58900',
    green: '#859900',
    cyan: '#2aa198',
    blue: '#268bd2',
    purple: '#6c71c4',
    accent: '#268bd2',
    accent2: '#2aa198',
  },
  'solarized-light': {
    label: 'Solarized Light',
    dark: false,
    bg: '#fdf6e3',
    bg1: '#eee8d5',
    bg2: '#e3dcc6',
    comment: '#93a1a1',
    fgDim: '#839496',
    fg: '#586e75',
    red: '#dc322f',
    orange: '#cb4b16',
    yellow: '#b58900',
    green: '#859900',
    cyan: '#2aa198',
    blue: '#268bd2',
    purple: '#6c71c4',
    accent: '#268bd2',
    accent2: '#d33682',
  },
  monokai: {
    label: 'Monokai',
    dark: true,
    bg: '#272822',
    bg1: '#3e3d32',
    bg2: '#49483e',
    comment: '#75715e',
    fgDim: '#a59f85',
    fg: '#f8f8f2',
    red: '#f92672',
    orange: '#fd971f',
    yellow: '#e6db74',
    green: '#a6e22e',
    cyan: '#66d9ef',
    blue: '#66d9ef',
    purple: '#ae81ff',
    accent: '#f92672',
    accent2: '#a6e22e',
  },
  synthwave: {
    label: "Synthwave '84",
    dark: true,
    bg: '#241b2f',
    bg1: '#2a2139',
    bg2: '#34294f',
    comment: '#848bbd',
    fgDim: '#b6b1d1',
    fg: '#f4eee4',
    red: '#fe4450',
    orange: '#f97e72',
    yellow: '#fede5d',
    green: '#72f1b8',
    cyan: '#36f9f6',
    blue: '#03edf9',
    purple: '#ff7edb',
    accent: '#ff7edb',
    accent2: '#36f9f6',
  },
  'catppuccin-frappe': {
    label: 'Catppuccin Frappé',
    dark: true,
    bg: '#303446',
    bg1: '#414559',
    bg2: '#51576d',
    comment: '#737994',
    fgDim: '#a5adce',
    fg: '#c6d0f5',
    red: '#e78284',
    orange: '#ef9f76',
    yellow: '#e5c890',
    green: '#a6d189',
    cyan: '#81c8be',
    blue: '#8caaee',
    purple: '#ca9ee6',
    accent: '#ca9ee6',
    accent2: '#8caaee',
  },
  'catppuccin-macchiato': {
    label: 'Catppuccin Macchiato',
    dark: true,
    bg: '#24273a',
    bg1: '#363a4f',
    bg2: '#494d64',
    comment: '#6e738d',
    fgDim: '#a5adcb',
    fg: '#cad3f5',
    red: '#ed8796',
    orange: '#f5a97f',
    yellow: '#eed49f',
    green: '#a6da95',
    cyan: '#8bd5ca',
    blue: '#8aadf4',
    purple: '#c6a0f6',
    accent: '#c6a0f6',
    accent2: '#8aadf4',
  },
  'rose-pine-moon': {
    label: 'Rosé Pine Moon',
    dark: true,
    bg: '#232136',
    bg1: '#393552',
    bg2: '#44415a',
    comment: '#6e6a86',
    fgDim: '#908caa',
    fg: '#e0def4',
    red: '#eb6f92',
    orange: '#ea9a97',
    yellow: '#f6c177',
    green: '#9ccfd8',
    cyan: '#9ccfd8',
    blue: '#3e8fb0',
    purple: '#c4a7e7',
    accent: '#c4a7e7',
    accent2: '#ea9a97',
  },
  'gruvbox-material': {
    label: 'Gruvbox Material',
    dark: true,
    bg: '#292828',
    bg1: '#32302f',
    bg2: '#45403d',
    comment: '#7c6f64',
    fgDim: '#a89984',
    fg: '#d4be98',
    red: '#ea6962',
    orange: '#e78a4e',
    yellow: '#d8a657',
    green: '#a9b665',
    cyan: '#89b482',
    blue: '#7daea3',
    purple: '#d3869b',
    accent: '#d8a657',
    accent2: '#a9b665',
  },
  'everforest-light': {
    label: 'Everforest Light',
    dark: false,
    bg: '#fdf6e3',
    bg1: '#f4f0d9',
    bg2: '#e6e2cc',
    comment: '#a6b0a0',
    fgDim: '#829181',
    fg: '#5c6a72',
    red: '#f85552',
    orange: '#f57d26',
    yellow: '#dfa000',
    green: '#8da101',
    cyan: '#35a77c',
    blue: '#3a94c5',
    purple: '#df69ba',
    accent: '#8da101',
    accent2: '#35a77c',
  },
  'tokyo-day': {
    label: 'Tokyo Night Day',
    dark: false,
    bg: '#e1e2e7',
    bg1: '#d0d5e3',
    bg2: '#c4c8da',
    comment: '#848cb5',
    fgDim: '#6172b0',
    fg: '#3760bf',
    red: '#f52a65',
    orange: '#b15c00',
    yellow: '#8c6c3e',
    green: '#587539',
    cyan: '#007197',
    blue: '#2e7de9',
    purple: '#9854f1',
    accent: '#2e7de9',
    accent2: '#9854f1',
  },
  'github-dark': {
    label: 'GitHub Dark',
    dark: true,
    bg: '#0d1117',
    bg1: '#161b22',
    bg2: '#21262d',
    comment: '#6e7681',
    fgDim: '#8b949e',
    fg: '#e6edf3',
    red: '#ff7b72',
    orange: '#ffa657',
    yellow: '#d29922',
    green: '#3fb950',
    cyan: '#39c5cf',
    blue: '#58a6ff',
    purple: '#bc8cff',
    accent: '#58a6ff',
    accent2: '#bc8cff',
  },
  'github-light': {
    label: 'GitHub Light',
    dark: false,
    bg: '#ffffff',
    bg1: '#f6f8fa',
    bg2: '#d0d7de',
    comment: '#8c959f',
    fgDim: '#57606a',
    fg: '#1f2328',
    red: '#cf222e',
    orange: '#bc4c00',
    yellow: '#9a6700',
    green: '#1a7f37',
    cyan: '#1b7c83',
    blue: '#0969da',
    purple: '#8250df',
    accent: '#0969da',
    accent2: '#8250df',
  },
  'ayu-dark': {
    label: 'Ayu Dark',
    dark: true,
    bg: '#0d1017',
    bg1: '#131721',
    bg2: '#273747',
    comment: '#565b66',
    fgDim: '#8a9199',
    fg: '#bfbdb6',
    red: '#f07178',
    orange: '#ff8f40',
    yellow: '#e6b450',
    green: '#aad94c',
    cyan: '#95e6cb',
    blue: '#59c2ff',
    purple: '#d2a6ff',
    accent: '#e6b450',
    accent2: '#59c2ff',
  },
  'ayu-mirage': {
    label: 'Ayu Mirage',
    dark: true,
    bg: '#1f2430',
    bg1: '#242936',
    bg2: '#33415e',
    comment: '#707a8c',
    fgDim: '#a0a5ad',
    fg: '#cccac2',
    red: '#f28779',
    orange: '#ffa659',
    yellow: '#ffcc66',
    green: '#d5ff80',
    cyan: '#95e6cb',
    blue: '#73d0ff',
    purple: '#dfbfff',
    accent: '#ffcc66',
    accent2: '#73d0ff',
  },
  'ayu-light': {
    label: 'Ayu Light',
    dark: false,
    bg: '#fcfcfc',
    bg1: '#f3f4f5',
    bg2: '#d1e4f4',
    comment: '#adaeb1',
    fgDim: '#8a9199',
    fg: '#5c6166',
    red: '#f07171',
    orange: '#fa8d3e',
    yellow: '#eba400',
    green: '#86b300',
    cyan: '#4cbf99',
    blue: '#399ee6',
    purple: '#a37acc',
    // Ayu's own accent is a pale gold that does not carry on white; its orange does.
    accent: '#fa8d3e',
    accent2: '#399ee6',
  },
  'night-owl': {
    label: 'Night Owl',
    dark: true,
    bg: '#011627',
    bg1: '#0b2942',
    bg2: '#1d3b53',
    comment: '#637777',
    fgDim: '#8badc1',
    fg: '#d6deeb',
    red: '#ef5350',
    orange: '#f78c6c',
    yellow: '#ecc48d',
    green: '#addb67',
    cyan: '#7fdbca',
    blue: '#82aaff',
    purple: '#c792ea',
    accent: '#82aaff',
    accent2: '#c792ea',
  },
  palenight: {
    label: 'Palenight',
    dark: true,
    bg: '#292d3e',
    bg1: '#32374d',
    bg2: '#444267',
    comment: '#676e95',
    fgDim: '#8f95b8',
    fg: '#bfc7d5',
    red: '#f07178',
    orange: '#f78c6c',
    yellow: '#ffcb6b',
    green: '#c3e88d',
    cyan: '#89ddff',
    blue: '#82aaff',
    purple: '#c792ea',
    accent: '#c792ea',
    accent2: '#82aaff',
  },
  oxocarbon: {
    label: 'Oxocarbon',
    dark: true,
    bg: '#161616',
    bg1: '#262626',
    bg2: '#393939',
    comment: '#525252',
    fgDim: '#a8a8a8',
    fg: '#f2f4f8',
    red: '#ee5396',
    orange: '#ff7eb6',
    yellow: '#ffe97b',
    green: '#42be65',
    cyan: '#3ddbd9',
    blue: '#78a9ff',
    purple: '#be95ff',
    accent: '#78a9ff',
    accent2: '#ee5396',
  },
  horizon: {
    label: 'Horizon',
    dark: true,
    bg: '#1c1e26',
    bg1: '#232530',
    bg2: '#2e303e',
    comment: '#6c6f93',
    fgDim: '#a0a3b1',
    fg: '#e0e0e0',
    red: '#e95678',
    orange: '#fab795',
    yellow: '#fac29a',
    green: '#29d398',
    cyan: '#59e3e3',
    blue: '#26bbd9',
    purple: '#ee64ae',
    accent: '#e95678',
    accent2: '#fab795',
  },
  nightfox: {
    label: 'Nightfox',
    dark: true,
    bg: '#192330',
    bg1: '#212e3f',
    bg2: '#29394f',
    comment: '#738091',
    fgDim: '#aeafb0',
    fg: '#cdcecf',
    red: '#c94f6d',
    orange: '#f4a261',
    yellow: '#dbc074',
    green: '#81b29a',
    cyan: '#63cdcf',
    blue: '#719cd6',
    purple: '#9d79d6',
    accent: '#719cd6',
    accent2: '#9d79d6',
  },
  moonlight: {
    label: 'Moonlight',
    dark: true,
    bg: '#222436',
    bg1: '#2f334d',
    bg2: '#444a73',
    comment: '#636da6',
    fgDim: '#828bb8',
    fg: '#c8d3f5',
    red: '#ff757f',
    orange: '#ff966c',
    yellow: '#ffc777',
    green: '#c3e88d',
    cyan: '#86e1fc',
    blue: '#82aaff',
    purple: '#c099ff',
    accent: '#82aaff',
    accent2: '#c099ff',
  },
  poimandres: {
    label: 'Poimandres',
    dark: true,
    bg: '#1b1e28',
    bg1: '#252b37',
    bg2: '#303340',
    comment: '#767c9d',
    fgDim: '#a6accd',
    fg: '#e4f0fb',
    red: '#d0679d',
    orange: '#f087bd',
    yellow: '#fffac2',
    green: '#5de4c7',
    cyan: '#89ddff',
    blue: '#add7ff',
    purple: '#fcc5e9',
    accent: '#5de4c7',
    accent2: '#add7ff',
  },
  cobalt2: {
    label: 'Cobalt2',
    dark: true,
    bg: '#193549',
    bg1: '#1f4662',
    bg2: '#234e6d',
    // Cobalt2's comments are its bright blue; the ramp needs a quiet tone there.
    comment: '#5a7d96',
    fgDim: '#9eb3c2',
    fg: '#ffffff',
    red: '#ff628c',
    orange: '#ff9d00',
    yellow: '#ffc600',
    green: '#3ad900',
    cyan: '#80fcff',
    blue: '#0088ff',
    purple: '#fb94ff',
    accent: '#ffc600',
    accent2: '#0088ff',
  },
  vesper: {
    label: 'Vesper',
    dark: true,
    bg: '#101010',
    bg1: '#1c1c1c',
    bg2: '#282828',
    comment: '#505050',
    fgDim: '#a0a0a0',
    fg: '#ffffff',
    red: '#ff8080',
    orange: '#ffc799',
    yellow: '#ffc799',
    green: '#99ffe4',
    cyan: '#99ffe4',
    blue: '#a0c4ff',
    purple: '#c8b6ff',
    accent: '#ffc799',
    accent2: '#99ffe4',
  },
};

/** Every scheme in menu order, the two special ones first. */
export const SCHEME_OPTIONS: readonly { value: SchemeId; label: string }[] = [
  { value: 'theme', label: 'Follow Seelen theme' },
  { value: 'custom', label: 'Custom colours' },
  ...(Object.entries(PALETTES) as [SchemeId, Palette][]).map(([value, p]) => ({ value, label: p.label })),
];

export function paletteFor(id: string): Palette | null {
  return Object.hasOwn(PALETTES, id) ? PALETTES[id as keyof typeof PALETTES] : null;
}

/** The stops of Seelen's ramp that a scheme redefines. */
export const RAMP_STOPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const;

/** The hue families the modules use for state, and the stops they read. */
const HUES = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple'] as const;
const HUE_STOPS = [400, 500, 600, 700] as const;

const mix = (a: string, b: string, aShare: number) =>
  `color-mix(in oklab, ${a} ${aShare}%, ${b})`;

/**
 * The ramp, from six named stops.
 *
 * `50` is the ground and `900` the ink, as in Seelen's own scale, so the
 * contrast-adaptive rules - "a hover is 26% of gray-300" - keep meaning the
 * same thing in a light scheme as in a dark one without a media query.
 */
function ramp(bg: string, bg1: string, bg2: string, comment: string, fgDim: string, fg: string) {
  return {
    50: bg,
    100: bg1,
    200: bg2,
    300: mix(bg2, comment, 50),
    400: comment,
    500: mix(comment, fgDim, 50),
    600: fgDim,
    700: mix(fgDim, fg, 50),
    800: mix(fgDim, fg, 25),
    900: fg,
  } satisfies Record<(typeof RAMP_STOPS)[number], string>;
}

export interface SchemeInputs {
  colorScheme: string;
  schemeGround: string;
  schemeInk: string;
}

/**
 * The custom properties a scheme sets on `body`, or none for `theme`.
 *
 * A custom scheme is two colours and nothing else: the in-between grounds and
 * inks are mixed from them, which is what lets two pickers produce a whole
 * coherent ramp instead of ten pickers producing an incoherent one. Its state
 * hues are left to Seelen's own, which are already tuned for either polarity.
 */
export function schemeVars(input: SchemeInputs): Array<[string, string]> {
  if (input.colorScheme === 'custom') {
    const bg = input.schemeGround || '#1e1e2e';
    const fg = input.schemeInk || '#cdd6f4';
    const stops = ramp(bg, mix(fg, bg, 9), mix(fg, bg, 17), mix(fg, bg, 40), mix(fg, bg, 66), fg);
    return RAMP_STOPS.map((stop) => [`--color-gray-${stop}`, stops[stop]]);
  }

  const p = paletteFor(input.colorScheme);
  if (!p) return [];

  const stops = ramp(p.bg, p.bg1, p.bg2, p.comment, p.fgDim, p.fg);
  const vars: Array<[string, string]> = RAMP_STOPS.map((stop) => [`--color-gray-${stop}`, stops[stop]]);
  for (const hue of HUES) {
    for (const stop of HUE_STOPS) vars.push([`--color-${hue}-${stop}`, p[hue]]);
  }
  return vars;
}

/** The accent pair a scheme brings, or null when it brings none. */
export function schemeAccents(id: string): { accent: string; accent2: string } | null {
  const p = paletteFor(id);
  return p ? { accent: p.accent, accent2: p.accent2 } : null;
}

/** `light`, `dark`, or null to leave the document's own. */
export function schemePolarity(id: string, ground: string): 'light' | 'dark' | null {
  const p = paletteFor(id);
  if (p) return p.dark ? 'dark' : 'light';
  if (id !== 'custom') return null;
  const hex = /^#?([0-9a-f]{6})/i.exec(ground)?.[1];
  if (!hex) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
}

/* --------------------------------------------------------- colour maths -- */

type Rgb = [number, number, number];

function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec((value ?? '').trim());
  if (!m) return null;
  const digits = m[1]!.length === 3 ? [...m[1]!].map((c) => c + c).join('') : m[1]!.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255) as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklab([r, g, b]: Rgb): Rgb {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((c) => Math.min(1, Math.max(0, toGamma(c)))) as Rgb;
}

/**
 * `color-mix(in oklab, a <share>%, b)`, worked out here as a plain hex.
 *
 * The shell theme is sent finished colours rather than `color-mix()`
 * expressions: its variables are registered as `<color>` and edited in
 * Seelen's colour pickers, and a picker holding an expression is a picker
 * that cannot show what it holds.
 */
export function mixHex(a: string, b: string, aShare: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return ca ? a : b;
  const la = toOklab(ca);
  const lb = toOklab(cb);
  const t = Math.min(100, Math.max(0, aShare)) / 100;
  const mixed = fromOklab(la.map((v, i) => v * t + lb[i]! * (1 - t)) as Rgb);
  return `#${mixed.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;
}

/* ------------------------------------------------------------ the shell -- */

export interface ShellSchemeInputs extends SchemeInputs {
  schemeAccent: boolean;
  accentColor: string;
  accentColor2: string;
}

/**
 * The scheme, as the shell theme's variables.
 *
 * The dock, the start menu and the popups are other widgets, in other
 * webviews, and the one thing they share with this surface is the
 * `@ralfm/surface` theme - whose variables live in the settings file. So a
 * scheme reaches them the same way shape and motion already do: written into
 * those variables, from which the theme's `tokens.css` redefines the same
 * grey ramp in every shell widget that this surface redefines in its own.
 *
 * `--rs-scheme` says how much to take: `none`, `ramp` (a custom scheme - only
 * the greys, leaving Seelen's own state hues) or `full`. Every colour is
 * `transparent` when it is not being sent, so switching back to the theme's
 * own palette is a change the sync writes like any other, rather than stale
 * colours left behind in the file.
 */
export function shellSchemeVars(input: ShellSchemeInputs): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (name: string, value: string | null) => (out[`--rs-scheme-${name}`] = value ?? 'transparent');

  const palette = paletteFor(input.colorScheme);
  const custom = input.colorScheme === 'custom';

  if (!palette && !custom) {
    out['--rs-scheme'] = '"none"';
    for (const name of ['bg', 'bg1', 'bg2', 'comment', 'dim', 'fg', ...HUES, 'accent', 'accent2']) set(name, null);
    return out;
  }

  if (palette) {
    out['--rs-scheme'] = '"full"';
    set('bg', palette.bg);
    set('bg1', palette.bg1);
    set('bg2', palette.bg2);
    set('comment', palette.comment);
    set('dim', palette.fgDim);
    set('fg', palette.fg);
    for (const hue of HUES) set(hue, palette[hue]);
  } else {
    const bg = parseHex(input.schemeGround) ? input.schemeGround.slice(0, 7).toLowerCase() : '#1e1e2e';
    const fg = parseHex(input.schemeInk) ? input.schemeInk.slice(0, 7).toLowerCase() : '#cdd6f4';
    out['--rs-scheme'] = '"ramp"';
    set('bg', bg);
    set('bg1', mixHex(fg, bg, 9));
    set('bg2', mixHex(fg, bg, 17));
    set('comment', mixHex(fg, bg, 40));
    set('dim', mixHex(fg, bg, 66));
    set('fg', fg);
    for (const hue of HUES) set(hue, null);
  }

  const useScheme = palette && input.schemeAccent;
  set('accent', useScheme ? palette.accent : input.accentColor);
  set('accent2', useScheme ? palette.accent2 : input.accentColor2);
  return out;
}
