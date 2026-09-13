# @ralfm/desktop

A custom desktop surface for Windows — a curated icon launcher, a game library, a wallpaper engine
and nineteen integrated modules (media and audio mixer, clock, calendar, system monitor, open
windows, notifications, clipboard history, notes and more) plus a command palette.

It is built as a **Seelen UI third-party widget** rather than a standalone app. Seelen 2.8.2 is
already installed and already owns the desktop layer, so a separate app would have to fight it for
Explorer's `WorkerW` window and duplicate a lot of infrastructure. As a widget it inherits Seelen's
autostart (so it "runs always" with no extra process, tray icon or registry key), its theming, its
per-monitor settings, and a large, already-tested API surface.

## What it provides

| Resource | Kind | Instances | Purpose |
| --- | --- | --- | --- |
| `@ralfm/desktop` | Widget, `Desktop` preset | `ReplicaByMonitor` | The surface: wallpaper, icon grid, module panels. One per display. |
| `@ralfm/palette` | Widget, `Popup` preset | `Single`, lazy | Command palette on `Win+Alt+Space`. Costs nothing until summoned. |
| `@ralfm/surface` | Theme | — | Dresses Seelen's *own* shell in the surface's chrome. See [The theme](#the-theme). |

- **Icon launcher** — starts empty and curated. Add applications from the Start Menu index, files and
  folders through a native picker, or web links; or drag items straight from Explorer onto the
  surface. Icons resolve through Seelen's icon packs, with per-item overrides.
- **Wallpaper engine** — per display, sourced from your existing Seelen wallpaper library or any
  local file. Images and video, with fit, blur, saturation, brightness, tint and a slideshow.
  Video pauses while a window covers the display.
- **Media and audio** — now playing (art, title, progress, transport, live waveform) for Spotify or
  any other source, plus a full mixer: master volume, per-application sliders, mute and
  output-device switching.
- **Game library** — finds what is installed by itself: every store's shortcuts (Steam, Epic, GOG,
  Battle.net, EA, Ubisoft, Riot, Rockstar, Amazon, itch.io), games downloaded from the web and
  recognised by the engine files that shipped with them, and anything seen running from a game
  library, which is how a Game Pass title with no shortcut is found. It lays them out as a grid, a
  shelf or a list with generated cover art, store badges, a live marker on whatever is running and
  the play time it measured. See [Game library](#game-library).
- **Nineteen modules**, each a draggable panel, each shown or hidden per display:

  | Group | Modules |
  | --- | --- |
  | Time | **Clock**; **Calendar** (month grid, ISO week numbers); **World clock** (any IANA zones, with the offset and day difference from here); **Timer** (focus/break phases, with a chime) |
  | System | **System monitor** (CPU, memory, disks, network); **Battery** (charge, draw, health, power mode); **Power** (lock, sign out, sleep, hibernate, restart, shut down — the last three confirm); **Quick settings** (per-monitor brightness, Wi-Fi and bluetooth radios, focus assist) |
  | Devices | **Network** (internet state, local address, a Wi-Fi scan you can join from, adapters); **Bluetooth** (paired and nearby devices, connect, disconnect, forget) |
  | Desktop | **Media**; **Games** (a detected library, with play time and cover art); **Open windows** (click to bring a window back - minimised or not - middle-click to close, group by app, this display only); **Workspaces** (Seelen's per-monitor virtual desktops: switch, add, rename, remove); **Notifications** (dismiss, clear, focus assist); **Clipboard history** (copy or paste an entry back, with image previews); **Files** (a small explorer over a known folder: breadcrumbs, subfolders, a filter, list or tiles, open or pin to the desktop); **Recycle bin**; **Notes/todo**; **Assistant** (an agent that can use this PC and the web, local model first; see [The assistant](#the-assistant)) |

  Only the first four — clock, media, system monitor and notes — are on to begin with. The rest are
  one click away in the surface's `Modules` menu, and cost nothing at all while they are off: a
  module that is not shown is never mounted, and it is mounting that subscribes it to the host.
- **Right-click any module** for its own menu: its options as one-click toggles, a settings
  dialog, reset size/position, and "hide this module" for this display or for all of them. The
  surface's own menu carries a `Modules` submenu that shows or hides each one and puts a
  customised display back in step with the others. Submenus open beside their row, flip when the
  display edge is close, and survive a diagonal move towards them; arrow keys walk the menus and
  open and close a flyout.
- Everything is draggable on a snap grid and resizable from its right, bottom and corner grips,
  saved per monitor.
- **A theme that carries the same chrome into Seelen's own shell** — the dock, the toolbar, the
  start menu, the app switcher and every popup, flyout and right-click menu. See
  [The theme](#the-theme).
- **Appearance settings that go the other way too** — fonts, density, panel material and tint, and
  a switch that makes the surface follow whichever Seelen theme is active. See
  [Making it yours](#making-it-yours).

### Game library

The Games module keeps its own library in `games.json`, beside the other widget data. It is shared
by every display — a library is not a property of a screen.

**Detection** is three passes, in `src/lib/detect.ts`. A widget cannot read `steamapps` or any other
launcher's manifests — the host exposes no directory listing, no process list, and an asset protocol
that serves only its own trees — so none of them can ask "what is installed". Each answers sideways
instead.

1. **The Start Menu index** (`get_start_menu_items`) carries the `target` of every shortcut, so a
   store's own link is visible: `steam://rungameid/...`, `com.epicgames.launcher://apps/...`,
   `uplay://launch/...`, `battlenet://`, `link2ea://`, `goggalaxy://`, `amazon-games://`, a folder
   under a store's name, or an executable inside its library. An executable under a folder called
   `Games` is the last, generic rule, for a library installed without a launcher at all.

2. **The folders a download lands in** — Downloads, the Desktop and Documents — are walked with
   `get_user_folder_content`, which recurses and returns the whole subtree flat. That is what finds
   a game that came from the web rather than a store, because the executable is in there *and so is
   everything beside it*: `UnityPlayer.dll` and a `*_Data` folder, a Godot `.pck`, GameMaker's
   `data.win`, Ren'Py's `.rpa`, an Unreal `-Win64-Shipping.exe`, `steam_api64.dll`, `galaxy64.dll`,
   the Epic and Discord SDKs, FMOD, SDL. One of those beside a program means it is a game, whatever
   it is called and wherever it came from. The name comes from the folder when the folder spells it
   better — `Vampire Survivors\VampireSurvivors.exe` is the former — with a version or platform tag
   trimmed off, but never a trailing number, because `Portal 2` and `Hades II` are names.

3. **The open windows** (`get_user_app_windows`) carry a `process.path`, which is the only sight of
   a game that lives where nothing else reaches: a Game Pass title under `C:\XboxGames`, a Steam
   library on a drive no known folder touches, anything started from a client that keeps no
   shortcut. Whatever runs from a recognisable game library is added the moment it is seen — and it
   arrives with its executable already known, so the play clock starts on the first session.

Each pass also rejects what sits beside a game without being one: the clients and their helpers
(`steam.exe`, `EpicWebHelper.exe`, `crashpad_handler.exe`), uninstallers, readmes, redistributables,
prerequisites, driver bundles and config tools.

**What it is unsure about it offers rather than adds.** A program in Downloads with no engine files
beside it looks exactly like any other download, so those go to the **Found** list in the panel's
`+` dialog — with the reason it was picked and the path it was found at — one click to add, one to
turn down for good. Anything named like an installer lands there too even when it does carry a
game's files, because an installer often ships beside the thing it installs.

**A rescan never loses your work.** Detected entries are matched by their key *and* by executable,
because two passes routinely find the same game under two names, so a rename, a cover image, a
hidden flag and an hour of play time all survive one; only the facts detection owns are refreshed.
An entry that has stopped appearing is marked uninstalled rather than deleted, because an uninstall
should not take its play time with it — and only the pass that found it can retire it, so turning
the folder walk off does not empty the library of what it found.

**Play time is measured, not reported.** No store tells a widget anything, so a game is timed from
its own window: the host already broadcasts every window change, and time is accumulated between the
window appearing and going away. An entry that points straight at an executable is matched from the
first launch. A `steam://rungameid/2050650` says nothing about the process it eventually produces,
so that one is *learned*: for three minutes after a launch from the panel, a window that was not
open before, does not belong to any client or helper, and is not already another game's, is bound to
that entry. It is a guess, and each entry's own menu offers to forget it again. Timing runs only
while the panel is shown, which is the same bargain every other module makes — a module that is off
holds nothing.

With the panel on two displays both replicas time the same window, and both write the same total,
because each adds its session to the same figure it loaded — the count is not doubled. What the two
do share is the whole-file, last-write-wins property every other shared file here has: an edit made
on one display while the other is holding an older copy can be overwritten by it.

**How it looks** is settable per display, like everything else: grid, shelf or list; tile size; art
as a square, box art or a wide capsule; generated gradient art, the app icon, or plain initials —
or a cover image you choose per game; titles always, on hover, or never; store badges, running
markers and play time on or off; ordered by recent, most played, name or store, favourites first,
and optionally grouped by store.

### The assistant

A chat panel that works as an agent. A message is a loop rather than a request: the model is given
the conversation and the tools, calls whichever it needs - look, act, check the result - and answers
once it has what it needs, for up to a configurable number of steps. Its reasoning, every tool step
(expandable to the exact arguments and result) and the answer stream into the panel as they happen.

- **What it can do** - read system status, battery, network, the focused app and notifications;
  find and launch apps, open files, folders and links, run a program; list, focus, minimise and
  close windows and switch workspaces; control playback, volume and mute (per app too) and the
  output device; set brightness, Wi-Fi and bluetooth radios, bluetooth devices and focus assist;
  browse and search the known folders; read clipboard history (off by default); read and add to
  notes and todos, and set reminders that chime; show and hide modules and change the surface's own
  settings; lock, sleep, restart, shut down and empty the bin; search the web, read pages, check the
  weather, calculate and convert time zones; and remember facts about you across chats.
- **When it asks first** - every tool is `read`, `act` or `danger` (`src/lib/tool.ts`). *Ask first*
  stops for every action, *Ask if risky* (the default) only for what cannot be undone, *Never ask*
  for nothing. Two cases stop regardless of `Always allow`: personal data (clipboard, file names,
  notifications) about to go to a cloud model, and any dangerous action once a web page has been
  read in the same turn - that combination is exactly what a prompt injection needs.
- **Models** - Ollama, LM Studio, any OpenAI-compatible endpoint (llama.cpp, vLLM, Jan, LocalAI),
  Gemini, OpenAI, Claude, OpenRouter and Groq. With routing on, questions about this PC and small
  talk go to a local model first, harder ones to the strongest service with a key, and a turn that
  hits a rate limit halfway through continues on the next service. *Local models only* never queues
  a cloud service at all.
- **Local models** - Ollama is spoken to through its native `/api/chat`, not its OpenAI shim,
  because the shim drops `num_ctx` (Ollama's default context is small enough for a tool list to
  push the system prompt out), `keep_alive` and `think`. What a model can do (tools, thinking,
  vision) is read from `/api/show`; models are downloaded, loaded, unloaded and deleted from the
  settings. The model starts loading when the message box gets focus: measured on `gemma4:12b`, 12
  of a cold reply's 14 seconds were loading.
- **Ollama refuses the widget out of the box.** Measured: `403` for `Origin: http://tauri.localhost`
  on `/api/tags`, `/api/chat` and `/v1/chat/completions` alike. A browser cannot tell that apart from
  a server that is not running, but a `no-cors` probe can, so the panel says which it is and offers
  **Allow this widget** - which appends the origin to your user `OLLAMA_ORIGINS` and restarts
  Ollama. By hand: set `OLLAMA_ORIGINS` to `http://tauri.localhost` and restart Ollama.
- **Web access without a key** - a widget's `fetch` needs CORS. `r.jina.ai` allows the widget's
  origin and fetches server-side, so it reads pages and DuckDuckGo's lite results page; Open-Meteo
  allows `*`. DuckDuckGo itself and Ollama's web search do not.
- **Settings** - the gear in the panel, or right-click -> *Assistant settings...*, with tabs for the
  model and keys, local models, the agent, tools and memory. Service, model, routing, streaming, tools,
  the status summary and your instructions stay Seelen settings (per display). Keys, local-model
  options, autonomy, tool groups, memory, reminders and conversations live in `chat.json` in the
  widget's data folder, which is re-read and merged on every write so two displays cannot erase
  each other's chats (`mergeFiles` in `src/lib/assistant-state.ts`).
- **In the panel** - pick any available model from the footer, keep several chats (☰), paste
  images for vision models, and use `/new`, `/clear`, `/remember <fact>` and `/help`.

`npm test` covers every wire's request shape, the stream assembler (including a real captured Ollama
stream), the Markdown reader, the file merge, the router and the approval rule. For the whole loop
against a real model, serve a preview over `http://localhost` - Ollama does allow that origin - and
open it with `?assistant=live`; the host tools answer from the preview's mock data. `?ui=assistant`
(or `assistant-local`, `-agent`, `-tools`, `-memory`) opens the settings on that tab.

### Per-display settings from the surface

Module settings live in the widget's own settings (the same keys Seelen's Settings window edits),
so the surface writes them back rather than keeping a second copy. Every write says where it lands:

- **All displays** writes the root value *and* drops that key from every monitor patch - a leftover
  override would otherwise keep the old value on the display that has it.
- **This display** writes a per-monitor patch, which the host merges over the root value for that
  replica only.
- A one-click toggle in a menu follows whichever the key already uses, so a single click never
  quietly detaches a display from the others nor discards a deliberate override. Anything set only
  here is marked `this display`, and clicking that badge puts it back.

Writes are debounced and applied to a freshly read copy of the settings, because the host rewrites
the whole file: dragging a slider produces one or two writes, not one per frame.

### Making it yours

The surface's appearance is driven from one place, `src/lib/appearance.ts`, which turns the
settings into the dozen custom properties every stylesheet in the package reads. Three groups of
them:

| | |
| --- | --- |
| **Typography** | Interface font and a separate **display font** for the clock, the timer and panel titles; a base text size everything else is a multiple of; and panel titles as small caps, plain, or hidden entirely. Both fonts use Seelen's native font picker, and an empty one inherits whatever the active theme sets. |
| **Material** | Panel opacity, blur, edge strength, corner radius, and a shadow from none to deep. **Frosted texture** adds the sheen and grain the shell theme uses, so a module panel and a dock read as the same pane of glass rather than two different tints. |
| **Colour and density** | A tint hue and strength of your own, an icon corner radius, an accent, and a **density** of compact, cosy or roomy. |

Density is one multiplier rather than three sets of measurements — every pad and gap in
`modules.css` is `calc(4px * var(--density))` — so a row cannot fall out of step with the list
around it the way a second hand-written set eventually would.

#### Following the active theme

Seelen injects an active theme's `sharedStyles` into *every* widget that opts into theming, this
surface included — so when `@ralfm/surface` is enabled its `--rs-*` tokens have always been sitting
in this document. Nothing in this package looked at them, which is why a theme preset could restyle
the dock and the start menu while the desktop stayed exactly as it was.

**Follow the active theme** closes that. The ground and the accent become `var(--rs-ground, <own>)`
and `var(--rs-accent, <own>)` — resolving to the theme's palette when one is active, falling back
to the widget's own settings when none is. No detection and no scripting, just a fallback chain;
switching the theme's preset now recolours the panels along with everything else. A tint of your
own still applies on top, and turning the switch off ignores the theme entirely.

Two things about *where* these properties are set are worth knowing, because both were wrong first:

- **They go on `body`, not on the surface element.** `base.css` composes `--panel-bg` out of
  `--panel-ground` and `--panel-alpha`, and a custom property's `var()`s are substituted *where the
  property is declared*, not where it is used. Set one level down and the composition never sees
  them — the panels simply kept the defaults.
- **`body` rather than `:root`, because that is where the theme's palette is.** `@ralfm/surface`
  has to declare its own tokens on `body`: its preset switch is a style query, and a style query
  cannot match the element carrying the value it tests. A `--panel-ground: var(--rs-ground, …)`
  resolved on `:root` looks one level above where the theme defines it and takes the fallback every
  time. `base.css` therefore declares its token block on `:root, body` — the `body` copy resolves
  against the theme, the `:root` copy is what the palette widget and the offline preview use.

`--accent` is now set once for the whole document too. Nineteen module components used to set it on
their own root from `cfg.accentColor`, which was nineteen duplicates and nineteen places for
`followTheme` to be quietly ignored.

#### ...and dressing the shell from here

**Apply these to the Seelen shell** sends the same choices the other way, so one set of settings
dresses the desktop and Seelen's own dock, start menu, switcher and popups together.

A theme is static CSS: it cannot read another widget's settings, and the shell widgets are separate
webviews, so nothing this surface computes can reach them directly. What *is* shared is the
settings file - a theme's variables live in `settings.byTheme[themeId]`, and the host pushes them
into every widget and re-applies on change. `src/lib/shellstyle.ts` writes there, debounced and
coalesced exactly as the widget's own settings writes are.

**Push on change, not on difference** - and that distinction is the whole of it. The obvious rule,
"write whenever the theme's value differs from ours", makes the theme's own settings unusable:
editing one changes the settings file, the host broadcasts the change, this widget's config store
re-reads and hands out a fresh object, the effect re-runs, and the rule writes the widget's value
straight back over the edit. The slider springs back the instant it is moved, and from inside the
loop there is nothing to distinguish a human's edit from the widget's own broadcast coming round.

So a variable is written only when *this surface's* setting for it has moved since the last push.
Two openings complete it: the first push of a session **seeds** rather than overwrites, filling in
only what the theme does not already have, so a restart never stomps a value tuned in the session
before it; and turning the switch **off and on** forces a full push, that being the one unambiguous
"apply these now" gesture the user has.

The state machine is `src/lib/shellplan.ts`, deliberately split out from the I/O so it can be
exercised directly. `npm test` runs ten scenarios over it - the spring-back itself, a widget change
still winning, untouched variables surviving a neighbour's change, a restart seeding nothing, an
off/on re-applying, and the second monitor replica finding the work already done, which is what
keeps the two from racing over the settings file for no gain.

**Shape travels out, colour travels in, and the two never meet.** Font, text size, density, corner
radius, blur, edge strength, the frosted texture and animations are mirrored into the theme; colour
is not, because
`followTheme` already brings the theme's palette the other way and syncing both directions would be
a loop - the widget writing back the accent the theme just gave it, forever. Panel and overlay
opacity stay separate too, for the reason the material note gives: a widget panel frosts its own
wallpaper and a shell panel cannot, so the same number does not describe the same material. The
dock's fill *is* synced, because a dock sits over the wallpaper exactly as a module panel does —
but *through a conversion*, not directly, and that turned out to matter more than anything else in
this section.

A blurred panel and a flat one at the same alpha do not hide the same amount of what is behind them.
On the desktop, 24% reads as glass because the 20px blur is what stops you reading the wallpaper
through it; the fill is only tinting. Copy that 24% onto a dock, which cannot blur anything, and you
get tinted cellophane with the wallpaper in full focus behind it. Turning the frosted texture up is
the obvious response and the wrong one: noise can only sit on top of detail, never hide it, so all it
does is add dirt over a sharp picture. Only density hides detail.

So `occludingFill` in `src/lib/shellplan.ts` pays for the missing blur in alpha instead.
`blur / (blur + 18)` estimates how much of the hiding the blur was doing — 18px is roughly where a
backdrop stops having legible edges in it — and that share becomes an exponent below 1, lifting the
middle of the range while leaving both ends alone, because "invisible" and "opaque" mean the same
thing in either material. At the surface's default 20px blur, 24% becomes 64% and 60% becomes 85%.

**The fill is what the blur slider actually does in the shell.** `backdrop-filter` reaches almost
nothing there, so for a while the blur setting was synced and then barely used — the bar took a flat
floor, and the popup and full-screen tiers were not synced at all. The visible result was a slider
that moved and a shell that did not change, because every value it produced fell under the floor and
was flattened to it. Now all three tiers are computed from it: blur 0 leaves the shell as
transmissive as the surface's own unblurred panels, and turning it up thickens dock, menus and
overlays together, the way it thickens the frost on the desktop. A menu still backs more than a bar
of icons — of whatever transparency the bar has left, a popup keeps 58% and a full-screen layer 39%,
which is the proportion the theme's own defaults set.

Changing any of those conversions changes what an already-stored value means, and the planner only
seeds at startup, so a value written by an older mapping survives until a widget setting moves.
Switching **Apply these to the Seelen shell** off and on re-derives the whole set, which is the
gesture that exists for exactly this.

The **frosted texture** is the exception among the material settings, and the reason is that same
fact read the other way: precisely *because* a shell panel cannot blur, the sheen and grain are the
whole of what makes one look like glass there. It is the one material choice worth carrying across,
and it now has its own strength in the theme (`--rs-frost`, 0-150%) rather than being hardcoded on.
The sheen scales continuously, because an alpha can be a `calc()`; the grain is switched at exactly
zero, because its opacity is baked into an inlined SVG and a data URI is opaque to CSS. One knob,
continuous where the medium allows it and binary where it does not. The grain itself has been both
too quiet (5%, the first pass) and too loud (9%, which was set while the fill under it was far too
thin); 7% is where it reads as a surface rather than as either.

One thing measured the hard way: CSS's `@property` grammar has **no `<family-name>`**. Seelen's
settings schema offers that syntax and the host duly emits it, but the browser rejects the
registration, the property computes to nothing, and a bare `var(--rs-font-family)` takes the whole
declaration down with it - every panel in the shell dropping to the browser's default serif. The
fallback inside `--rs-font` is what makes the setting safe to leave unset.

### The theme

The surface only owns the desktop layer. The dock, the toolbar, the start menu, the app switcher
and every popup Seelen opens are the host's own widgets, and they carry the host's own look — which
is how you end up with a hand-built glass surface sitting under a taskbar that shares none of its
vocabulary. `themes/surface/` is a Seelen **theme** that closes that gap: the same translucent
ground, the same corner, the same row that lights up grey on hover and accent when it is on.

It restyles twenty-one widget ids:

| Group | Widgets |
| --- | --- |
| Shell | `fancy-toolbar` (the taskbar), `weg` (the dock), `weg-preview` (its window thumbnails), `apps-menu` (the start menu), `task-switcher` ([Alt+Tab](#alttab-is-rebuilt-icon-first)) |
| Full-surface | `power-menu`, `workspaces-viewer`, `window-manager` (tiling borders and the stack bar) |
| Popups | `context-menu`, `tooltip`, `flyouts`, `notifications`, `quick-settings`, `media-popup`, `network-popup`, `bluetooth-popup`, `calendar-popup`, `system-tray`, `user-menu`, `keyboard-selector`, `dialog` |

It is a **skin over the default theme, not a replacement for it** — `@default/theme` supplies all
the layout (the grids, the sizes, the flex), and this paints over it. Keep the default enabled and
ordered *above* `@ralfm/surface` in Seelen's theme list; see the cascade-layer note under
[Notes learned from the running host](#notes-learned-from-the-running-host) for why the order is
not cosmetic.

##One thing worth knowing if you edit `task-switcher.css`: the switcher is
`.task-switcher-window` (the full-screen window) > `.task-switcher-monitor` (the centring grid) >
`.task-switcher` (the card strip), and it is the *monitor* layer that carries the sheet behind the
cards. This file spent several versions targeting a `.task-switcher-overlay` that does not exist
anywhere in the host, so the entrance never ran and the sheet was never dressed — Alt+Tab opened as
a bare card over a completely untouched desktop, which is exactly what "the switcher has no frost"
looks like. The default theme's own stylesheet is the reliable source for these names.

## Alt+Tab is icons

Seelen renders every switcher card as a header — `.task-icon`, `.task-title`, a close button — over
a `.task-preview-container`, and the default theme lays that header out as a `20px 1fr min-content`
grid above a 150px window preview. So the application's own logo, which Seelen has *already*
resolved through the active icon pack, ends up as a twenty-pixel afterthought on a card that is
mostly a screenshot.

Alt+Tab is read at a glance and under a held key. A logo is recognised in a fraction of the time a
title is, and a thumbnail of a text editor looks like a thumbnail of every other text editor — so
the preview is gone and the card *is* the icon: 78×92px, logo at 52px.

- The **title is not deleted, only quiet.** Every card reserves a 15px strip at the bottom that
  stays empty until that card is the selected one. Reserved rather than grown, because a card that
  changes height as the selection steps through it makes the whole row reflow under a held key —
  exactly the moment it has to stay still. Two windows of the same application are otherwise
  indistinguishable, and that is the case the strip exists for.
- The **close button** is lifted out of the flow into the card's corner and only appears on hover,
  so it cannot push the icon off-centre or be hit while tabbing past.
- The **selected card** takes the fill, the accent edge and a 6% lift, and its logo lifts and grows
  out of the card — which is what makes the selection findable without reading, given that the
  default theme's `!important` focus outline cannot be overridden.

#### The start menu and the power menu are tightened

Both ship laid out for a much larger scale than the rest of this shell.

The **start menu** had two faults, and the second one is the whole reason it looked nothing like
the rest of the shell.

The widget is a `preset: Overlay`, so its window covers the display, and the default theme gives
`.apps-menu` `width: 100%; height: 100%` inside it — in *both* modes. `data-fullscreen="false"`
does not produce a windowed menu; it adds ten pixels of padding and a corner to a panel that is
still the size of the screen. On top of that the grids are `repeat(var(--columns), 1fr)`, so a tile
is a fraction of the *display*: at seven columns on a 2560px screen that is a 360px tile with a
216px icon in it — one application's logo drawn larger than an entire module panel on the surface
behind it.

So the non-full-screen menu is given a real size and centred with
`position: absolute; inset: 0; margin: auto`, which centres on both axes in the viewport **without
touching its parent**. That detail is the difference between working and not: an earlier attempt
made `#root` a centring grid instead, which is one guess about the widget's mount point away from
doing nothing at all — and did. Every grid also moves from fractional tracks to fixed ones,
`repeat(auto-fill, 88px)` with `justify-content: center`, which lays down as many 88px columns as
the panel holds and splits the remainder evenly either side. Icons are pinned at 44px for the same
reason the tracks are: `width: 60%` of a tile that was a fraction of the display is how a 216px
icon happened.

Measured at 2560×1440: the panel is **860×560, centred to the pixel**, with **88px tiles and 44px
icons** in 7 columns, and a full-screen menu keeps the same 88px tiles rather than growing them.
Padding drops from 2rem to 12px and the gap from 1rem to 6px. The last piece is the label — the
default reserves `2.4em` for a two-line clamp, so every tile carries a blank second line unless its
application happens to have a long name, which is a ragged strip of empty space running through the
whole grid. One line with an ellipsis is shorter, straighter, and loses nothing that hovering does
not restore. The folder modal comes down from 70vw×70vh to 560×420.

It is also re-laid as **two columns: a rail down the left, applications to the right.** The footer
is what becomes the rail — not as a compromise, but because it already holds exactly the right
things (the user profile, the power and settings buttons) and the default theme merely spread them
along the bottom edge, which is the least reachable part of a panel and the furthest from where the
eye starts. What cannot move there is the pinned/all-applications switcher: Seelen renders it as a
native `<select>` in the header, and CSS can restyle a select but cannot relocate one into another
grid cell without `display: contents` on its parent — which would drop the search field and the
header's button into cells they would then have to fight over. So the switcher stays beside the
search, styled as the quiet control it should have been.

The **power menu** put six tiles in a 1200×500 grid with 25px gaps — six buttons the size of
playing cards for a decision that takes one glance. Capped to 520×260, which lands them at about
the size of a module panel. Its labels were also hidden until hover and then pulled up over the
icon with `margin-bottom: -2.2rem` to fake the centring, so at rest the menu was six unlabelled
glyphs and finding "Hibernate" meant sweeping the pointer across all of them; the label is simply
shown, and the hack undone. The 100px portrait comes down to 56px. What can't be changed is the
glyph: the default marks `.svg-icon`'s 40% height `!important`, so the tile is sized rather than
the icon.

#### Why the glass is rebuilt rather than copied

`backdrop-filter` cannot work on the outermost panel of a Seelen widget. Each one is its own
transparent, layered window, and the filter samples the backdrop *within the document* — the
wallpaper is a different window entirely, so there is nothing there to blur. The surface's own
panels are the exception that makes this confusing: `@ralfm/desktop` draws the wallpaper itself, in
the same document, so its `blur(12px)` produces real frost while the identical declaration on a
dock is a no-op. Seelen's own default theme gives the game away — across twenty-two stylesheets it
uses `backdrop-filter` exactly once, on `.weg-item-preview:hover`, which is the one surface that
does have page content behind it.

So the frost is reconstructed from what a layered window *can* draw. A frosted panel differs from a
flat tint in three measurable ways — it is denser, it catches light unevenly across its height, and
it has grain — which is why these panels carry a higher fill than the surface's own, a sheen
gradient, an inlined 120px noise tile and lit edges.

Each of those three was first shipped with the balance wrong, in the same direction: the fill was
too thin and the texture was turned up to compensate for it, which cannot work. The current sheen
has four stops rather than three, because light on glass is bright at the lit edge, drops away
quickly, runs flat through the middle and gathers weight at the far edge — a straight three-stop ramp
through that reads as a gradient painted on a rectangle. The grain is at 7% and one octave coarser
than it was, so it reads as matte rather than as static. The edge is three parts: a lit line along
the top, a much fainter one along the bottom where light wraps round the far face, and a short inner
shade under the top line — that shade is the part that reads as depth, and without it the lit line
just looks like a border.

### The part none of that fixed

All of the above is texture, and texture was never the difference. Put a dock and a desktop panel
side by side over a real wallpaper and what separates them is **colour**.

A desktop panel is 24% of a dark ground over a *blurred wallpaper*, so what you actually see is
mostly wallpaper, averaged: pale blue-grey over a moonlit scene, warm over a sunset, different again
when the wallpaper changes — because it is mostly made of wallpaper. A dock cannot blur, so its
colour is whatever ground the theme names, and that ground is a fixed near-black with the preset's
hue in it. At the density a non-blurring panel needs, that hue stops being a tint and becomes the
whole bar: **a solid brown bar next to blue-grey panels.** Raising the fill to hide the wallpaper
made the colour mismatch worse at exactly the rate it made the detail better, which is why every
round of tuning the frost came back as "still looks different".

So the colour is measured instead. `src/lib/glass.ts` averages the wallpaper the surface is already
displaying, composites the panel's own alpha over it, and sends the result to the theme as
`--rs-tint`; `--rs-glass` is that colour when it is set and the preset's ground when it is not. The
dock is then made of the same wallpaper the desktop panels are made of, and the two match by
construction rather than by tuning. With a colour in hand, the fill only has to suppress sharp
detail, which is what `TINTED_FILL` (78%) is: measured side by side, 56% still showed the moon
through the dock, 68% was close, 78% was indistinguishable from a blurred panel beside it, and 88%
started to look like paint.

Three things it deliberately does not do. It is **one colour for the whole wallpaper**, not one per
bar — `byTheme` holds a single value, a dock can sit on any edge, and two monitors would otherwise
fight over it; measured, the whole-image average matched *better* than per-bar sampling anyway,
because the desktop's own panels are scattered about and the average splits the difference the same
way. A **video wallpaper is sampled from its thumbnail**, not from a live frame, because every
change in this colour is a write to the settings file. And it is the **wallpaper's** colour, not the
screen's: a dock over a maximised window is tinted by the wallpaper behind that window rather than
by the window. Real acrylic samples what is actually there; nothing available to a widget can.

The canvas read is the one part that could have failed outright — the wallpaper is served from
`asset.localhost` while widgets run on `tauri.localhost`, so a tainted canvas would have made the
whole approach impossible. It loads `crossOrigin="anonymous"` first and retries plain, and every
attempt writes its outcome to the diagnostics file, so `npm run status` says which happened. `--rs-blur` is still applied to
the handful of layers that *do* have page content behind them (a folder opened over the start menu,
a card over a popup's own ground, the workspace shelf), where it is real — through `--rs-backdrop`.
That token used to be called `--rs-glass`, which is also the name of the glass *colour* on `body`;
every element using it inherited the colour, `backdrop-filter: <a colour>` is invalid, and none of
those layers had ever actually blurred. Measured after the rename: `blur(10px)` on `body`, beside a
`--rs-glass` of `rgb(30, 69, 124)`.

#### Presets

Five, in a dropdown. **Monochrome** is the surface's own neutral glass and the default; **Midnight**,
**Ember**, **Moss** and **Orchid** tint it. A preset changes two things and no more — the hue of the
glass and the colour a selection is tinted with — so it never undoes a density, corner, blur or
motion setting, and any preset can still be tuned from there.

A preset is a *hue and an amount of chroma*, not a colour to blend in, and that distinction is what
keeps the glass glass. `--color-gray-50` is Seelen's contrast-adaptive ground — light in a light
theme, dark in a dark one — so mixing any fixed colour into it moves lightness as well as hue.
Measured: blending 14% of a mid blue took the ground from L 0.204 to L 0.254, a quarter lighter,
which made every tinted preset look thinner than the neutral one. Relative colour syntax —
`oklch(from var(--color-gray-50) l calc(c + var(--rs-chroma)) var(--rs-hue))` — takes the ground's
own `l` untouched. All five presets now sit at exactly L 0.204 and differ only in hue:

| Preset | Hue | Accent |
| --- | --- | --- |
| Monochrome | the ground's own (`h`, not `0`) | `#000000` |
| Midnight | 264° | `#5b8dd9` |
| Ember | 58° | `#d99455` |
| Moss | 155° | `#6fae86` |
| Orchid | 310° | `#a98adb` |

Monochrome's hue is the *keyword* `h` rather than the number `0`, because custom properties
substitute as tokens: `0` would rotate whatever residual chroma the ground already carries round to
red, a faint warm cast on the one preset whose job is to have none.

Two mechanics are worth knowing before editing them, both measured in a browser against the SDK's
own registration rather than assumed:

- **The option values are quoted** (`'"midnight"'`). The host registers the setting as
  `syntax: "<string>"`, and a bare `midnight` is an ident, not a string — it fails to parse, falls
  back to the initial value, and every preset silently does nothing.
- **The switch is a style query.** The host writes the choice into `:root` in its own later cascade
  layer; `@container style(--rs-preset: 'midnight')` reads it from there and applies the palette to
  `body`. That is why the colour tokens live on `body` and the rest on `:root` — a style query
  cannot match the element carrying the value, only its descendants.

**Accent override** is the same trick used as an opt-out: it is registered with `transparent` as its
initial value, which is the one value a style query can tell apart from a colour someone actually
picked, so `@container style(--rs-accent: transparent)` falls through to the preset's accent and any
real colour wins instead. One knob, no second "use preset" switch beside it.

#### Settings

Thirty-two, in eight groups in Seelen's own settings window under the theme, so it can be retuned
without editing CSS:

| Setting | Initial | What it is |
| --- | --- | --- |
| **Palette** | | |
| Preset | Monochrome | One of the five palettes above |
| Accent override | transparent | Leave empty to follow the preset |
| Glass colour | transparent | Set by the Desktop widget to the colour its panels are showing; see above |
| **Glass** | | |
| Dock and toolbar fill | 62% | The bars. Higher than a desktop panel wants; below ~45% the wallpaper reads through in focus |
| Popup and menu fill | 78% | Flyouts, popups, tooltips, menus — these open over windows |
| Start menu and switcher fill | 85% | The full-surface layers, matching the command palette |
| _(all three)_ | | Overwritten by the widget's blur and opacity while shell styling is on |
| Frosted texture | 100% | Sheen and grain strength; 0 turns both off |
| Backdrop blur | 14px | Only the layers that have page content behind them; see above |
| **Shape and colour** | | |
| Corner radius | 20px | Panel corners; row and tile corners are derived from it |
| Edge line strength | 34% | The hairline around a panel |
| **Typography** | | Font, base size and density — usually written by the Desktop widget |
| **Motion** | | |
| Animation speed | 1 | Multiplies every duration and stagger; 0 stops motion entirely |
| Animation style | Fluid | Fluid, Spring, Snappy or Gentle — the curves and distances; see [Motion](#motion) |
| List stagger | 1 | The step between rows and tiles arriving; 0 brings a list in at once |
| Entrance blur | 3px | Panels come into focus as they arrive; lists and tiles never blur |
| **Dock** | | |
| Magnification | 14% | How much the hovered icon grows; neighbours follow two deep |
| Hover lift | 5px | How far it rises out of the bar |
| **Start button** | | See [The start button](#the-start-button) |
| Icon | Surface | Surface, Orbit, Petal, Spark, Windows, or Icon pack |
| Icon colour | transparent | Leave empty for the shell's ink |
| Icon finish | Glass | Flat, Glass or Duotone (into the preset's accent) |
| Icon size | 70% | Of the dock tile; the glyphs' own margin makes that level with an app icon |
| Glow | 40% | A light behind the icon, brighter on hover |
| Hover animation | Spin | Spin, Tilt, Pulse, Bloom or none |
| **Start menu** | | |
| Layout | Rail | Rail down the left, or Classic strip along the bottom |
| Position | Center | Center, or hung from the Bottom or Top edge |
| Edge offset | 96px | For Bottom and Top, the room left for the bar |
| Width × height | 860 × 560 | Capped at 94vw × 82vh |
| Tile size | 88px | The icon is always half of it |
| Entrance | Rise | Rise, Drop, Pop, Zoom or Fade; full screen always fades |

**The accent tints; the ink marks.** This split is worth understanding before changing either.

A translucent wash can afford to take the accent, because it sits over a known ground. Three solid
pixels cannot: at the near-black accent the surface itself is set to, a marker under a running dock
item simply is not there. The first version of this theme solved that by defaulting the accent to
the package's blue instead — which fixed the markers and introduced something worse, a colour the
surface never uses, most visibly as a blue ring around the start menu's search field.

So nothing structural is painted in the accent any more. Edges, markers, badges, slider fills,
checked switches and every focus ring take `--rs-mark`, which is the foreground ink and therefore
legible in both polarities at any accent. Selection is `color-mix(accent 24%, var(--rs-pressed))` —
the pressed grey *plus* a wash — so a selected thing is always at least as visible as a pressed
one, and tints rather than changes colour when the accent is a colour. That is also what makes the
presets safe: any of the five can set any accent without a marker going missing anywhere.

That includes overriding Seelen's own `*:focus-visible { outline-color: var(--system-accent-color) }`,
which is the *Windows* accent — blue on a default install. It is one global declaration needing one
global answer, so it lives in `sharedStyles`, where it lands in a later layer than the default
theme's and wins without `!important` (which is what keeps it harmless to this package's own two
widgets, whose unlayered CSS still outranks it).

Three tiers of fill rather than one, because the surface is not uniform either: its module panels
sit at the user's own opacity, its menus at 72% and its command palette at 82%. A bar of icons over
a wallpaper wants far less backing than a list of words over a window.

#### Motion

The shell animates on one set of tokens — four durations, four curves, a travel distance and a
stagger step. **Animation speed** scales the durations; **Animation style** swaps the curves and how
far things travel; **List stagger** scales the step. Fifteen `rs-`-prefixed keyframes live in
`sharedStyles`, which is what lets them be written once instead of twenty-one times; an unreferenced
keyframe costs nothing, which is what makes that safe.

The four styles:

| Style | Pace | Travel | Curves |
| --- | --- | --- | --- |
| **Fluid** (default) | 1× | 1× | Exponential ease-out; a bezier overshoot for things that appear |
| **Spring** | 1.6× | 1.15× | Real damped-spring `linear()` curves — ζ 0.72 for entrances, ζ 0.6 for pops and hover movement |
| **Snappy** | 0.65× | 0.6× | A sharper knee, less distance |
| **Gentle** | 1.45× | 1.3× | Longer and further, the overshoot all but gone |

Spring is not a bezier imitating one. `linear()` takes a list of progress values, which is enough to
draw a curve that passes 1 and comes back — something no `cubic-bezier` can do more than once. Each
list is the step response of a spring sampled at 41 points until it settles within 0.2%;
regenerate it rather than nudging a point by eye. Its pace is longer because a spring spends its tail
settling, and squeezed into the Fluid durations that tail becomes a shiver.

The motion tokens moved from `:root` to `body` to make this possible, for the palette's reason: a
style is a style query, and a style query cannot match the element carrying the value it tests. The
*composites* (`--rs-dur`, `--rs-tr`) had to move with them, not just the curves — a custom property's
`var()`s resolve where it is declared, so a `--rs-tr` composed on `:root` would have baked in the
Fluid curve and never seen the Spring one.

Transforms transition on their own curve, `--rs-ease-move`, separate from colour. That is what lets
Spring bounce a hover lift without a fill flickering past its target colour.

**Entrance blur** brings panels into focus as they arrive — the start menu, popups, the switcher,
the dock — from 3px by default. Lists and tiles never blur: a start menu deals forty tiles at once,
and forty animated filters is a cost a quarter-second flourish does not earn.

- **Bars** arrive from the edge they live on, and slide back into it when a maximised window takes
  them away; items grow into place as they are opened or pinned. A toolbar item is text on the bar
  and nothing else at rest — what marks the active one is a 2px accent rule that *sweeps out from
  its centre*, animated as a `background-size` rather than a `::after`, because a pseudo-element on
  a host element is a guess about markup this theme does not own (the toolbar already uses
  `::before` on its items) and `background-size` transitions without needing a keyframe.
- **Counters are counters.** The default draws 16px filled chips on dock items and 12px on toolbar
  ones; on a dock of 50px icons that is a second row of content competing with the icons. They come
  down to 13px and 9px, and the window-count badge — which matters once, when you are deciding
  whether a click will disambiguate — sits in muted ink and only comes up to full strength on
  hover.
- **The dock magnifies.** The item under the pointer lifts out of the bar and grows (14% and 5px by
  default, both settings), and *its neighbours follow it two deep*, at 45% and 15% of that — which is
  the whole difference between a dock and a row of buttons. It is pure CSS: `+` reaches the items
  after the hovered one and `:has(+ :hover)` the ones before it, there being no previous-sibling
  combinator. The siblings are the `.weg-item-drag-container` wrappers, not the items — every item
  is wrapped twice, which is why an earlier `.weg-item:hover + .weg-item` never matched anything and
  only half of the falloff ever ran. Which way "out" points is one set of `--rs-lift` tokens per
  orientation rather than twelve near-identical rules.
- **The dock hides on the theme's curve.** `hideMode: OnOverlap` slides `#root` off the edge on a
  fixed `0.2s ease-in-out`; the transition is restated (and only the transition, so the host still
  owns the geometry), which under Spring means the dock bounces back into place.
- **Icons move with what contains them.** Dock icons gain a shadow as they come forward, start menu
  logos grow a little further than their tile, toolbar glyphs scale inside the item that lifts, and
  every `.svg-icon` in every popup responds. Two transforms composing rather than one is what makes
  a tile read as having depth instead of just getting bigger.
- **Panels** that belong to a point (menus, popovers, the start menu) grow out of it; panels that
  belong to an edge (flyouts, the dock, the toolbar, the stack bar) slide from it; full-screen
  layers zoom, because the 4% that reads as a grow on a 300px popover is invisible across 2560px.
- **Lists** — start menu tiles, switcher cards, menu rows, notifications, scanned networks, tray
  items, power tiles, workspaces — deal in rather than appearing at once. CSS has no way to
  multiply a step by an element's index, so the delays are written out as `:nth-child` rules and
  capped once the tail stops being legible.
- **Controls** respond: sliders and the media scrubber thicken under the pointer, switch knobs
  overshoot, buttons scale down on press, transport and calendar cells grow on hover, a network's
  expanded fields arrive rather than appear.

`--rs-ease` is an exponential ease-out: almost all the distance is covered in the first third, then
it glides in. That is what reads as *fluid* rather than merely animated — the response feels
immediate even though the movement lasts longer than a linear curve would tolerate, which is why
these durations can be generous without the shell feeling slow. `--rs-ease-pop` overshoots, for
things that appear from nothing; `--rs-ease-smooth` is the only curve with any ease-in, for
movement that is continuous rather than triggered — the dock's open-marker travelling between two
window states, where an expo-out looks like it snapped and then drifted.

Colour settles faster than shape throughout (130ms against 220ms): a fill that lingers as long as
the movement reads as lag, while a transform that resolves as fast as the fill reads as a snap.

Two things turn it off without touching the knob: the system's `prefers-reduced-motion`, handled by
zeroing the durations (not `--rs-motion`, whose user value the host writes into a later cascade
layer that would win), and Seelen's own performance mode, which the host enforces with an unlayered
`!important` rule that outranks every theme.

#### The start button

The dock's start button is drawn by the theme: a mask for the shape, a gradient for the colour.
That is what lets one glyph take any colour, a finish and a glow — an icon pack's `<img>` can only
ever be the picture it is. Five glyphs ship, as inlined 24px SVGs: **Surface** (this theme's own mark,
three rounded panes and a circle), **Orbit**, **Petal**, **Spark** and **Windows**. **Icon pack**
hands the button back to whatever pack has an entry for `@seelen/weg::start-menu` — including a
picture set with the dock's own *Edit icon* menu, which lands in `__user_custom_icons` and is
otherwise hidden under the drawn glyph.

It has no class of its own, which is worth knowing before editing it. Earlier versions of
`weg.css` styled a `.weg-item-start` that Seelen 2.8.2 does not render, so the start button's hover
turn never ran. The button is the `@default/weg-start-menu` plugin, which `PluginItem.svelte`
renders as a plain `.weg-item[role=button]` around a `SpecificIcon`. So the theme finds it by what is
true of it and of nothing else on a normal dock — a tooltip beginning "Start" ("Start Menu",
"Startmenü"), or else the first plugin in the left group, which is where Seelen puts it — and in
both cases only a plugin holding an icon, so an app pinned first is never mistaken for it.

A `filter` glow is not possible on a masked element — the mask clips everything the filter drew
outside the shape — so the glow is a radial gradient on the tile's `::before`, under the glyph. The
Pulse hover animates the individual `scale` property rather than `transform`, so it multiplies with
the hover's own transform instead of replacing it.

#### The start menu's settings

Size, position, layout, tile size and entrance are all settings now. **Bottom** and **Top** hang
the panel from that edge by freeing the far inset (`inset: auto 0 <offset> 0`) and keep it centred
along the edge with `margin: 0 auto`; the panel then grows out of that edge. **Classic** undoes the
rail and puts the footer back as a strip along the bottom. The icon is always half the tile, the
44px-in-88px proportion the grid was drawn at. Full screen keeps its fade whatever entrance is
chosen, because a layer the size of the display that moves 28px reads as the screen lurching.

## Requirements

- Seelen UI **2.8.2** (`C:\Program Files\Seelen\Seelen UI`)
- Node 20+ (developed on 24)

`@seelen-ui/lib` is pinned to `2.8.2` to match the installed runtime. Bump both together.

## Development

```bash
npm install
npm run build      # bundle both widgets into widgets/<name>/index.{js,css}
npm run link       # register them, and the theme, with the running Seelen
npm run reload     # build + force the running widgets to restart (use this while iterating)
npm run status     # print what each running replica last reported
npm run check      # svelte-check
npm test           # the shell-sync state machine, in Node
npm run unlink     # remove them again
```

Every script takes resource names to narrow what it acts on: `desktop`, `palette`, `surface`.
`scripts/resources.mjs` holds the one list they all read, so a fourth resource is added once.
`npm run build` only ever touches the two with a Vite entry — the theme is hand-authored CSS that
its `metadata.yml` pulls in with `!include`, so there is nothing to compile:

```bash
npm run link -- surface     # register just the theme
npm run reload -- desktop   # rebuild and restart just the surface
```

`npm run link` registers each resource **by path** — the folder is not copied into Seelen's data
directory, so rebuilding in place is enough. A theme reloads live: re-running `npm run link --
surface` after editing a `.css` file under `themes/surface/styles/` repaints every widget it
touches without restarting anything.

**Use `npm run reload` while iterating.** `slu.exe resource load` on an already-registered widget
re-registers the definition but does not reliably recreate the running webview, so a rebuild's new
JavaScript can be silently ignored. `--reload` unloads first, which forces a fresh instance.

`npm run unlink` removes the dev registration again.

## Installing (and starting with Windows)

```bash
npm run deploy     # build, then install into Seelen's own widgets directory
npm run undeploy   # remove the installed copies again
```

`npm run link` is a **development** registration only. `slu.exe resource load` records the widget in
the running process and nowhere on disk, so once Seelen restarts — which is what happens at every
logon — the widget is gone, even though `settings.json` still lists it as enabled.

`npm run deploy` copies each resource into `%APPDATA%\com.seelen.seelen-ui\<kind>s\ralfm-<name>\`
- `widgets\ralfm-desktop`, `widgets\ralfm-palette` and `themes\ralfm-surface` - and Seelen scans
both of those directories on every launch. Seelen itself is started by the
`\Seelen\Seelen UI Service` scheduled task on a logon trigger, so the chain is:

```
logon -> "Seelen UI Service" task -> slu-service.exe -> seelen-ui.exe -> scans widgets/ -> desktop
```

Verified by stopping that task, killing both processes and starting the task again: the desktop
returned on both monitors about a second later with no manual step.

The installed copy is a **snapshot** — after changing the source, run `npm run deploy` again.

Nothing outside Seelen is touched: no `Winlogon\Shell`, no Explorer changes, no `Run` keys and no
scheduled task of our own. `npm run undeploy` fully reverses it.

### Seeing what a running surface did

The surface sits behind every window and has no visible console, so each replica writes a
diagnostics snapshot (geometry, theme state, what the webview itself provides, data counts,
recent actions and captured errors) to its data directory on startup. `npm run status` reads them
back and exits non-zero if any replica reported a problem.

The **actions** lines are what a click leaves behind. The surface answers a click by asking the host
to do something to a window somewhere else, so "the command was accepted and nothing happened" is
the failure that matters and the one with nothing to show for it. Activating a window from the Open
windows panel re-reads that window afterwards and records whether it actually came up:

```
  actions:
    - 2026-09-06T21:12:44.101Z windows: activate Downloads - up
```

Set `debug: true` in a `metadata.yml` to have Seelen open devtools for that widget. **Remove it
before packaging.**

## Layout

```
src/lib/          host access: seelen, monitors, geometry, persistence, stores, module registry,
                  and appearance.ts, which turns the look settings into the custom properties
                  every stylesheet reads (and reads the active theme's, when told to)
src/desktop/      the @ralfm/desktop widget
src/palette/      the @ralfm/palette widget
src/modules/      one folder per module, plus the shared chrome (panel, menus, dialogs)
                  and ModuleView.svelte, which says which component a panel kind holds.
                  A module that needs a menu or a dialog of its own opens it through
                  src/lib/overlay.svelte.ts, which the surface renders (see below)
src/styles/       base.css (shared), fill.css (full-display), fit.css (content-sized popups),
                  modules.css (the `m-` classes every module panel draws itself from)
widgets/<name>/   metadata.yml + i18n, and the built index.{html,js,css}
themes/surface/   the theme: metadata.yml + i18n, shared/tokens.css (variables only, because
                  sharedStyles reaches our own widgets too) and styles/<widget>.css, one file
                  per Seelen widget id plus popups.css, which a dozen of them share
scripts/          resources.mjs (the one list of what ships), build, link/reload, deploy, status,
                  and test/ - the one piece of logic here with enough state to be worth a test
```

## Cost

Measured on this machine with both displays active: **2 renderer processes, 94 MB private /
177 MB working set** for both desktop replicas — about 47 MB private per display, which is close to
WebView2's own floor. The palette is lazy and adds nothing until it is opened.

What keeps it there:

- **Nothing polls.** Every live value (media, audio, CPU, memory, disks, network, windows) has a host
  change event. Seelen already samples the system on one shared interval and broadcasts the result.
- The installed-application index is **reference-counted** and only loaded while the Add dialog or
  the palette is actually open — otherwise every replica would hold its own copy of ~440 entries.
- Video wallpaper stops decoding when a window covers the display, and the audio visualiser only
  subscribes while its tab is visible and the display is not covered.
- **Modules subscribe on mount, not at startup.** Everything a module needs from the host is
  reference-counted behind `src/lib/live.svelte.ts`, acquired by the panel and released when it
  goes away, so the fifteen modules that are off by default hold no subscriptions, no listeners
  and no copies of host state. The game library is the same bargain one level down: it holds the
  installed-application index only for the length of a scan, not for as long as the panel is open.
- One bundle per widget, no component libraries: 254 KB / 83 KB gzipped for the desktop with all
  nineteen modules compiled in.

## Notes learned from the running host

Verified against the installed Seelen rather than assumed — these are the non-obvious parts.

- **The Desktop preset applies no geometry.** `applyDesktopPreset()` is empty in the SDK, so a
  `preset: Desktop` widget opens at Tauri's default 800x600. `src/lib/surface.ts` sizes each replica
  to its own display and re-fits on `SystemMonitorsChanged`.
- **`saveAndRestoreLastRect` is unusable for per-monitor replicas.** It defaults to `true` for the
  Desktop preset but persists a single rect under plain `x`/`y`/`width`/`height` localStorage keys,
  which every replica shares. We disable it and own geometry instead.
- **Popup widgets must shrink-wrap.** The host autosizer measures `#root`, so a viewport-relative
  size anywhere inside it (`max-width: 92vw`) feeds back into the window size and shrinks the popup a
  little more on every trigger. `fit.css` and fixed pixel sizes avoid the loop; that is why the
  full-display rules live in `fill.css` and not in `base.css`.
- **Widget data directories are per widget, not per replica.** `write_data_file` resolves to
  `%APPDATA%\com.seelen.seelen-ui\data\<widget-slug>\`, and both monitor replicas share it, so
  per-monitor state carries the monitor id in its filename.
- **`backdrop-filter` is a no-op on a widget's outermost panel.** Every Seelen widget is its own
  transparent, layered window, and the filter samples the backdrop *within the document* — there is
  no wallpaper in there to blur. This surface is the exception and the reason the difference is
  easy to miss: `@ralfm/desktop` draws the wallpaper itself, so its panels frost for real while the
  same declaration on a dock does nothing at all. Confirmed three ways: Seelen's own default theme
  uses `backdrop-filter` exactly once across twenty-two stylesheets, on the one element that has
  page content behind it; the largest third-party theme on this machine carries the comment *"no
  backdrop-filter: nothing to blur behind a transparent window"*; and the visible result was a dock
  that read as a flat tint beside a frosted panel. Density, a sheen gradient and a noise tile are
  what stand in for it.
- **A theme's CSS is wrapped in a cascade layer, so a plain declaration cannot reach a widget's own
  styles.** The SDK emits `@layer theme-<id> { ... }` around every theme (`Theme.applyToDocument`),
  and unlayered CSS beats layered CSS at any specificity — so the widget's own bundled stylesheet
  wins every ordinary declaration a theme makes. That, not superstition, is why every theme in the
  store is `!important` throughout, and why `themes/surface/styles/` is too.
- **Layer order reverses for `!important`, which is why the default theme must stay on top.** Themes
  are applied in `activeThemes` order and each declares its layer as it goes, so a later theme wins
  every *normal* declaration — but for `!important` the earlier layer wins. `@ralfm/surface` is
  therefore a skin over `@default/theme` rather than a replacement: it overrides the default's
  layout and colour freely, and cannot touch the five declarations the default marks `!important`.
  One of those is visible — `.task:focus { outline: 3px solid var(--system-accent-color) }` in the
  app switcher — so that focus ring stays the Windows accent by design, not by omission.
- **`sharedStyles` is injected into *every* themed widget, ours included.** It is applied before the
  per-widget block and in its own layer, so an `!important` rule there would also outrank this
  package's own surface and palette. `themes/surface/shared/tokens.css` therefore declares custom
  properties and draws nothing.
- **Theme settings are real registered properties.** Each entry under `settings:` is emitted as an
  `@property` with its `syntax` and `initial-value`, and the user's value is written into `:root`,
  so `calc()` and `color-mix()` over them work and an unset knob still has a defined value. That is
  what lets one opacity number drive a `color-mix` ground without any script.
- **Theme tokens do reach third-party widgets.** With `useThemes: true`, Seelen's contrast-adaptive
  `--color-*` scale plus `--spacing-*` and `--shadow-*` resolve inside our document, so styling
  against those tokens makes the surface follow the user's active themes.
- **A per-monitor widget patch must carry `enabled`.** It reads like a key to leave out - the patch
  is merged over the root values, so an absent key should mean "inherit" - but the host loads a
  widget's monitor settings into a struct where `enabled` is a plain bool, so a patch written
  without it comes back as `enabled: false` and the entire surface disappears from that display.
  Measured: writing `{ moduleMedia: false }` for one monitor produced
  `{ enabled: false, moduleMedia: false }` on disk and killed that replica.
- **Seelen keeps settings in memory and rewrites the file.** Editing `settings.json` by hand while
  it is running changes nothing and is overwritten at the next write, so a bad value has to be
  repaired through `state_write_settings` - from a replica that is still alive, if the broken one
  will not start.
- **Two replicas writing settings at the same moment can lose one of the two changes.** Each write
  re-reads the settings first, but the host's write is whole-file, so a read that lands before
  another replica's save writes back the older value. One display's menu click is never affected;
  simultaneous edits on both are.
- **Third-party widgets may write settings.** `state_write_settings` is accepted from
  `@ralfm/desktop` with no permission prompt (`permissions.json` gates a different set of commands,
  `open_file` among them), and a read-modify-write round trip through `Settings.getAsync()` ->
  `save()` came back byte-identical, so nothing in the user's settings is reordered or dropped by
  editing one key. That is what makes the module menus possible.
- **A panel's stored size is its rendered size**, because `base.css` sets `box-sizing: border-box`
  for everything. Without that reset the panel's `width`/`height` were content-box, so reporting
  `offsetWidth` back at the end of a resize grew every panel by its 2px border on each pass - the
  resize action reports the size it computed instead, which is why it is unaffected by the change.
  The reset matters far more inside the panels: nearly every row is `width: 100%` *and* padded, so
  under `content-box` each one was its own padding wider than the list holding it. That is what put
  a horizontal scrollbar under the Quick settings sliders and cost the panel 12px of usable width.
- **`backdrop-filter` clips fixed-position descendants.** Like `filter`, it makes the element a
  containing block for `position: fixed` children *and* clips them to its own overflow — and every
  menu is a `.panel`, which carries one. A submenu nested inside its parent menu was therefore
  trapped in it: cut off at the edge, and wide enough to push a horizontal scrollbar onto the parent
  that had to be dragged sideways to reach the flyout at all. `ContextMenu` now keeps the open
  levels in a **flat list** and places each one in viewport coordinates, so a flyout is never a
  descendant of the box it hangs off.

  The same property is why a module cannot open a menu or a dialog of its own: a module renders
  *inside* a `.panel`, so both would be clipped to a box a couple of hundred pixels wide. The Games
  panel needs both - a per-game menu and two dialogs - so `src/lib/overlay.svelte.ts` holds the
  request and the surface renders it, outside every panel. The surface's own menus go through the
  same field, so only one can ever be open.
- **`overflow-y: auto` turns the other axis into a scroller too.** A computed `overflow` of
  `visible` alongside a non-`visible` value becomes `auto`, so every list written as "scroll
  vertically" also scrolls horizontally the moment anything inside is a pixel too wide. Both axes
  are now declared wherever one of them is.
- **`open_file` accepts `shell:` names.** `shell:RecycleBinFolder` resolves and opens Explorer;
  measured, it is not the source of the `0x8000FFFF` the Recycle bin module recorded.
- **Something under the Recycle bin returns a bare `0x8000FFFF`.** Two of them are in this
  machine's diagnostics file, and by elimination it is `trash_bin_empty`: reading the bin and
  opening it both answer cleanly when measured. Nothing on the panel changes either way, so the
  module now shows the message instead of leaving it in a file nobody opens - which is the only
  reason it was ever noticed.
- **`run` never settles.** `invoke(Run, ...)` starts the program but its promise stays pending
  forever, so it can only be used fire-and-forget — never `await`ed, and never as a step in a
  sequence that has to continue afterwards.
- **A display starts with exactly one workspace and there is no UI anywhere to add another**, which
  made a switcher-only panel a dead end: one unnamed row, and clicking it switched to the workspace
  already active. `create_workspace`/`rename_workspace`/`destroy_workspace` all take effect
  immediately and broadcast `virtual-desktops::changed`, so the module owns that now.
- **The offline preview could not test fixed positioning.** `scripts/preview.mjs` scaled its 1920x1080
  stage with a `transform`, and a transform — even an identity one — makes that stage the containing
  block for every fixed-position descendant, so the menus placed themselves against the stage while
  clamping themselves against the window. It now leaves the transform off entirely at natural size.
- **Percentage heights do not resolve inside the panels' flex column**, which let a wide album cover
  overflow its area. The media stage is a `container-type: size` container and the artwork frame is
  sized in `cq` units, which are real lengths.
- **Settings YAML uses lowercase type tags** — `switch`, `select`, `number`, `text`, `range`,
  `color`, `font` — not the capitalised names in the generated TypeScript. Ranges take
  `min`/`max`/`step`. Set `allowSetByMonitor: true` on anything overridable per display, and
  `dependencies: [otherKey]` to grey an option out until its parent is on.
- **Media transport commands target one player.** `media_toggle_play_pause`, `media_next` and
  `media_prev` each take `{ id }`, the session's `umid` — they do not act on "whatever is playing".
- **`get_icon` does not return an icon.** It requests extraction into the host's generated icon pack;
  `IconPackManager` is what resolves a usable URL afterwards.
- **`convertFileSrc` is the asset loader, but its scope is narrow.** It yields
  `http://asset.localhost/<encoded path>` and serves Seelen's own `AppData` trees plus `Temp` (so
  wallpapers and album art work). It **refuses** `Program Files` and `Downloads` with
  `asset protocol not configured to allow the path`, which is why an audio session's `iconPath`
  (an `.exe`) can never be loaded directly - route app icons through `IconPackManager` instead,
  which extracts them into Seelen's generated pack inside `AppData`. Directories return 403.
- **`get_media_devices` returns a pair of arrays whose order cannot be trusted.** On this machine
  the first array held a device whose own `type` was `"input"` (Stereo Mix, a loopback that still
  carries every playback session). Split the pair on each device's declared `type` rather than
  assuming `[outputs, inputs]`.
- **The waveform stream can be entirely silent.** `get_media_waveform` returns its 128 bins happily,
  but every bin sat at the -120 dBFS noise floor here, so a visualiser drawn from it renders an empty
  band. The media panel keeps its canvas collapsed until real signal arrives.
- **The Start Menu index can list one path twice**, which collides as a keyed-`{#each}` key and
  tears the list down at runtime (`each_key_duplicate`). Deduplicate on `path` when reading it.
- **Nothing in the host API lists installed games, and three things imply them.** There is no
  directory listing and no process list, and the asset protocol refuses everything outside its own
  trees, so `steamapps`, GOG Galaxy's database and the rest are all out of reach. What is reachable:
  `StartMenuItem.target` exposes each store's own protocol link; `get_user_folder_content` recurses,
  so a walk of Downloads returns a game's executable *and the engine files beside it*, which is what
  identifies a download as a game at all; and `UserAppWindow.process.path` places a running program
  inside a library. Packaged titles are the case that needs the third: a Game Pass game carries a
  `umid` like any other packaged app and nothing tells it apart from a calculator, but it runs from
  `C:\XboxGames`, and that is unambiguous. `src/lib/detect.ts` is all three passes.
- **Nothing says what a launcher started.** `run`/`open_file` on `steam://rungameid/2050650` hands
  the request to Steam and answers nothing about the process that eventually appears, and there is
  no process list in the host API - only `get_user_app_windows`. So play time is taken from the
  game's *window*, and the executable behind a store link has to be learned: the windows open at
  the moment of the launch are remembered, and the first new one that is not a client or a helper
  is bound to that game. It is the only route available, it is a guess, and the entry's menu can
  undo it.
- **`get_user_folder_content` is recursive**, which reads as a problem and is really the feature.
  It returned 2595 entries for `Desktop` on this machine because a `node_modules` tree lives there,
  so nothing can be shown without filtering - but a flat subtree is enough to rebuild the folders it
  came from, and there is no directory listing in the host API to do it any other way. A path with
  something under it is a directory; its children are the distinct next segments. That is what makes
  the Files module a browsable explorer rather than one long list.

- **There is no command that returns the nearby wireless networks.** `wlan_scan` starts a scan and
  answers as soon as it has *started* one; the results only ever arrive on the `wlan-scanned`
  event, so a panel has to hold the last set it was sent rather than read one on demand. A radio
  that is off never sends results at all, which is why the Network module's spinner gives up on a
  timer.
- **A wireless scan reports one entry per access point, not per network.** A mesh or a repeater
  puts the same SSID on screen several times, and keyed by name that tears the list down at
  runtime; the Network module keeps the strongest entry per SSID.
- **Bluetooth pairing cannot be completed from a widget.** `request_pair_bluetooth_device` and
  `confirm_bluetooth_device_pairing` both exist, but no event carries the pin request back, so
  there is nothing to confirm against. Connecting, disconnecting and forgetting already-paired
  devices all work; pairing stays in Windows Settings.
- **`Battery.percentage` has no documented scale**, so the Battery module derives charge from
  `energy / energyFull` and health from `energyFull / energyFullDesign`, which are unambiguous.
  Windows' own estimate of the time left comes from `PowerStatus.batteryLifeTime`, which is -1
  until it has one.
- **Monitor brightness is keyed by WMI instance name, not by `MonitorId`**, so a per-monitor
  replica cannot pick out its own display; the Quick settings module offers every panel that
  answers. Panels that report `availableLevels` only accept those values, so the slider snaps.
- **`get_user_folder_content` returns paths and nothing else** — no size, no timestamp, and not
  even the folder it read — so "Recent" cannot be ordered by recency, and there is no column to
  sort by but name and type. The folder it walked has to be inferred as well, and cannot be guessed
  from the `FolderType`, because Documents, Pictures and Desktop are commonly redirected into
  OneDrive: the walk always returns something at the top level, so the shortest path's parent is the
  root.
- **`iconSize` and `labelMode` were in the code but not in `metadata.yml`**, which meant neither
  could ever be changed from its default. Both are declared now; a settings key that only exists
  in TypeScript is invisible to the host.
- **Audio session ids are not unique.** `MediaDeviceSession.id` embeds the executable path plus an
  all-zero GUID, so two sessions from the same programme share one id and collide as a keyed-`{#each}`
  key. `instanceId` carries the process id and is safe to key on; commands still take `id`.

### Not available in the host API

- **No GPU metric.** The system monitor ships CPU, memory, disks, network and battery only.
- **No media seek.** Transport is previous/play-pause/next, so the progress bar is display-only.
- **Windows' "Show desktop" buries a Desktop-preset widget, and the host pins it there.** Clicking
  the taskbar's Show desktop button (or Win+D) focuses Explorer's `Progman` and raises it over
  Seelen's desktop-layer widgets, hiding this surface behind the stock wallpaper. Measured by walking
  the z-order across a real `Shell.Application.ToggleDesktop()`: normally `Progman` sits at the very
  bottom with both replicas just above it, and showing the desktop moves `Progman` to near the top
  with both replicas beneath it. Our windows stay visible and un-minimised; exactly one window moves
  above them.

  **No z-order request moved it, and the host is why.** `set_self_z_order` is accepted from a
  third-party widget and answers `ok` for `Top`, `TopMost` and `NoTopMost` alike, and the window does
  not move for any of them; `setPosition`, `setAlwaysOnTop` and `setFocus` do not move it either.
  Seelen creates every Desktop-preset window with Tauri's `always_on_bottom(true)`
  (`src/background/widgets/webview.rs` in Seelen 2.8.4), and tao enforces that flag in the window's
  own `WM_WINDOWPOSCHANGING` handler by overwriting `hwndInsertAfter` with `HWND_BOTTOM` on *every*
  position change while it is set. Each of those requests was rewritten into "bottom" before Windows
  acted on it.

  **It does not come back on its own.** It comes back when some *other* window takes the foreground,
  because that is when Explorer puts `Progman` back at the bottom - which is why opening any window
  and closing it again fixes it. Watch the foreground window alongside the z-order and the surface
  stays buried for exactly as long as `Progman` holds the foreground.

  What you are left looking at is *Explorer's* desktop, not this one: Windows' own wallpaper, and
  Windows' own right-click menu, because `Progman` is now the window under the pointer. Nothing on
  this surface can be clicked while that is true, which is the same fault reported as "I can't open
  anything" - it is one bug, not two.

  That last point is worth stating plainly, because it is easy to measure wrongly: polling the
  z-order alone on a machine somebody is using looks like the surface healing itself after a second
  or two, every time. It is not healing - the person clicked something. Every run here that appeared
  to show a fix working turned out, once the foreground window was logged next to the z-order, to be
  a real click landing mid-run. `hide`/`show` and `Widget.self.focus()` both looked like cures under
  the contaminated measurement and both leave the surface buried under the controlled one, even
  though `focus()` demonstrably does make this window the foreground window. Five levers were tried
  in total - `set_self_z_order` in all four orderings, `setPosition`, `setAlwaysOnTop`,
  `hide`+`show`, and `focus()` - and every one of them was issued with the bottom pin still in place.

  **So the pin comes off for exactly as long as `Progman` is up.** `DesktopLayer` in
  `src/lib/desktoplayer.svelte.ts` watches `global-focus-changed`, which the host sends for any
  foreground window, `Progman` included. When `Progman` (or, on older builds, the `WorkerW` holding
  the icons) takes the foreground, each replica calls `setAlwaysOnBottom(false)`,
  `setAlwaysOnTop(true)` and `setAlwaysOnTop(false)`: the release first, so tao has nothing left to
  rewrite, and topmost-then-not so the window lands at the top of the normal band rather than over
  the dock. Every window it now sits above is already behind `Progman`. Both window permissions are
  granted to every widget (`general_window.json`), and the calls share tao's own queue, so the raise
  cannot overtake the release.

  It sinks again with `setAlwaysOnBottom(true)` as soon as an application window comes up: one from
  the host's user-app-window list taking the foreground, or one appearing or being restored without
  it. The dock, the start menu, the shell's own flyouts and the surface asking for the keyboard do
  not count, because none of them ends Explorer's show-desktop state and sinking for them would bury
  the surface again. While it is raised the display is not treated as covered, so the wallpaper and
  the visualiser keep running on the surface that is actually on screen.

  **The surface's own "Show desktop" still minimises instead.** `showDesktop()` in
  `src/lib/windows.svelte.ts` minimises each window through the host's own
  `weg_toggle_window_state`, exactly as clicking its dock button would. That uncovers the same
  thing and never touches `Progman`, so the surface never has to move and the stock wallpaper never
  flashes up - confirmed by watching the z-order across it, where `Progman` never leaves the bottom.
  It is what `Win+Shift+D` triggers, what the surface's own menu offers, and what the palette's and
  Quick settings' "Show desktop" both run. The host's `show_desktop` is deliberately not used
  anywhere, and measured here it does nothing at all.
- **A desktop-preset widget is not given the keyboard.** The host gives it `WS_EX_NOACTIVATE`
  (`0x08040110` on both replicas, read back from `GetWindowLongW` on the running windows), so
  clicking it does not make it the foreground window. The click still reaches the page and still
  moves the caret into a field, so a text box looks completely usable and then discards every
  keystroke, because the keys go to whichever window really holds the foreground. That is what made
  the notes panel useless. `Widget.self.focus()` is the way out - the host's own `request_focus`
  does the foreground dance that `SetForegroundWindow` alone cannot - and `src/lib/input.ts` asks
  for it on a press or a tab into a field that is typed into, and only then, so touching the desktop
  does not otherwise pull the foreground off the user's own window.
- **`document.hasFocus()` does not answer "do we have the keyboard".** It was the guard that decided
  whether to ask for the foreground at all, and a probe build recorded it as `true` on every pointer
  event of its run, on a surface the host had not activated. A guard that reads `true` there never
  asks, and the fields go on swallowing keystrokes exactly as they did before the fix. Ownership now
  comes from
  the host's `global-focus-changed`, which names the window that really holds the foreground:
  `FocusedApp.hwnd` (or `ownerHwnd`) against `Widget.self.windowId`. The document flag is kept only
  as a second condition, so anything ambiguous asks for the keyboard rather than assuming it.
- **Clicking a window in the Open windows panel needs the restore, not just the focus.** The panel
  is only ever read while the surface is uncovered, which means the windows are down - so nearly
  every row in it is a minimised window, and `request_focus` on a minimised window is a click that
  does nothing. `weg_toggle_window_state` with `wasFocused: false` is the host's restoring half,
  the same call `showDesktop` puts windows back with. `activateWindow` re-reads the window first
  and only sends the toggle to one that is actually down - it *is* a toggle, so sending it blind
  would put away the window the user just asked for - then focuses it, then checks the list again
  and records whether it came up.
- **The webview is a secure context.** Widgets are served from `http://tauri.localhost`, so
  `isSecureContext` is true and `crypto.randomUUID` is defined (both read back from the running
  replicas and printed by `npm run status`). Ids for notes and desktop icons still go through
  `src/lib/ids.ts`, which carries its own fallback: `randomUUID` throws rather than degrading when
  it is absent, and it would throw from inside the click handler that was adding the row - an add
  button that silently does nothing is a bad thing to leave resting on an origin we do not choose.
- **`user-select: none` reaches inside text fields.** The surface sets it on `body` so the desktop
  does not select like a document, and it inherits all the way into every `input` and `textarea` in
  the panels - no drag-select, no double-click-a-word. They opt back in explicitly.

## Packaging

Ensure no `metadata.yml` has `debug: true`, then:

```bash
"C:\Program Files\Seelen\Seelen UI\slu.exe" resource bundle widget <abs path to widgets/desktop>
```

The theme bundles the same way, with `theme` as the kind:

```bash
"C:\Program Files\Seelen\Seelen UI\slu.exe" resource bundle theme <abs path to themes/surface>
```

Worth running even when you are not publishing: it is the only thing that validates
`metadata.yml` end to end — the settings schema, every `!include` and `!extend` path, and the
widget ids under `styles:` — and it prints the resolved result rather than failing silently the way
a mistyped key does at load time. It drops a `bundle <date>.yml` beside the folder it bundled;
`.gitignore` covers it.
