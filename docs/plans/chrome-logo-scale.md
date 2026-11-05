# Plan: no title bar — a logo over the drawing, an app menu, an interface size, and panels to the very edge

**Status: built** (2026-11-04), on `claude/chrome-logo-scale`, with three
amendments from the owner folded in below and one more from the manager (the
status bar's style); see *As built* at the end for what was measured and
every deviation. The owner, from his iPhone, with screenshots of 0.1.0 in
portrait and landscape:

> *rather than say zerocad, it should be a tiny logo in the top left corner,
> that is overlaid over the viewport. Be creative with the logo, but keep it
> simple. There should be no title bar.*
>
> *the interface elements are huge on my screen. there should be a settings
> menu that allows the user to change the zoom level of the interface (ie size
> of tool panes and other elements eg labels and icons which display in the
> viewport. Maybe if you click on the logo, that brings up settings.*
>
> *see in the portrait screenshot, the command bar is not at the bottom. That
> is as far as I can drag it down. Please allow it to be dragged right to the
> bottom.*

**Amended the same day** (2026-11-04), the owner again:

> *Clicking on the logo should bring up a dropdown menu, and that menu should
> include a zoom level little spin box like  - 80% +, a show hide for the
> panes, and file open etc etc*
>
> *Also, if I push a toolbar right to one side, or up against another
> toolbar, that setting should persist if I change from landscape to portrait
> or vice versa*

The amendment changes three things below, marked **(amended)**: the menu is a
dropdown with a spin box instead of a sheet with presets and a slider; the
menu shows and hides each pane; and docking — not pixel position — is what a
moved pane keeps through a rotation.

His portrait screenshot (iPhone, standalone, 0.1.0): the command panel dragged
as low as it goes stops roughly 60 pt above the bottom of the screen. The
header takes ~75 pt at the top.

Read `CLAUDE.md`, `docs/plans/effortless.md`, `touch.md` and `pwa-pages.md`
(both as built), `index.html` (the head, the header, `#app`, `#viewwrap` and
its safe-area margins), `src/panels.ts` (`Metrics`, `FINE`/`COARSE`,
`touchLayout`, `defaultLayout`, the clamp to the area), `src/main.ts` (the
status line, `#stepnote`, `#buildstamp`, the drawing pass's sizes), `src/menu.ts`,
`src/glyphs.ts`, `src/framemarker.ts`, `src/viewmode.ts` (a per-viewer setting
already stored), `src/tools/engine.ts` (pick and snap reach, the lifted mark),
`public/icons/icon.svg` and `scripts/icons.ts`, and the e2e harness with
`touch.e2e.ts` and `pwa.e2e.ts`.

A parallel package (`docs/plans/files.md`) adds the file commands. **This
package owns the menu; that one owns the commands.** The seam is below.

## Design

- **No title bar.** The drawing is the whole window — under the status bar
  and the home indicator too — and the chrome floats over it. The header
  element goes.
- **The logo**, tiny (about 22–28 px tall at the default size), top-left over
  the drawing, inside the safe area. Be creative and keep it simple. One
  suggestion: a zero drawn the way the app draws — a circle crossed by a
  construction-style line with a point at each end, which reads as "0" and as
  "∅" and is made of the app's own primitives. Make it in the app's inks
  (amber on the ground) as one SVG, and **regenerate the home-screen icons
  from it** (`scripts/icons.ts`) so the icon and the logo are one mark. LOOK
  at it at 1× and 3×, on the ground and over a light solid.
- **The status, beside the logo**: the readout that was in the header (`ready`,
  `SOLVED`, an error) and the step note (what an undo did, a tool's guidance),
  small, after the logo. A note or `SOLVED` fades after a few seconds; an
  error stays until the next action. Keep the element ids `#status`,
  `#stepnote` and `#buildstamp` (tests read them); the build stamp moves into
  the app menu. Nothing here may take pointer events except the logo itself,
  so a drag across the corner still reaches the drawing.
- **The logo opens the app menu** (tap or click; Escape or a tap outside
  closes it). **(amended)** A dropdown anchored under the logo, in the
  context menu's family, in sections:
  - **File**: the document's name and an unsaved dot, then *New*, *Open…*,
    *Save*, *Share…*. Each item **types its command through `submit`**, as
    every menu item does: `newFile()`, `openFile()`, `saveFile()`,
    `shareFile()` — the files package implements them. Until it lands, an
    item whose command is not defined is shown disabled with its reason. The
    name and dot come from a host function `document(): { name: string;
    dirty: boolean }`, defaulting to `{ name: "Untitled", dirty: false }`;
    the files package supplies the real one.
  - **Interface size** **(amended)**: a compact spin box, `− 80% +`, in 10 %
    steps clamped to 60 %–160 %, applied live; tapping the number resets it
    to the device's default. The − and + have a finger-sized hit area however
    small they are drawn. Typed as `ui({ scale: 0.8 })` — one command, so the
    command line and the menu say the same thing; it journals nothing (it is
    the viewer's, not the document's), like `view(...)`.
  - **Panes** **(amended)**: a checkbox row per pane — toolbar, command line,
    log, action strip, and any other panel the panel manager knows, the list
    built from the panels that exist (an "organisation" pane comes next and
    must appear with no edit to the menu). Per-device viewer state, saved with
    the layout; a hidden pane comes back where it was. The logo cannot be
    hidden, so the way back into the menu is never lost.
  - **View**: Shaded / Hidden / Wire, typing `view(...)` as the context
    menu's row does.
  - **About**: the build stamp, and a link to the repository.
- **The interface size scales everything drawn for a person to read or hit:**
  the panels' metrics (title strips, buttons, rows, the tray, the options
  panel, the action strip — `Metrics` multiplied), the command line and log
  type, the context menu, the hover tag, and **in the viewport** the
  constraint glyphs, dimension labels, point dots, frame markers, the snap
  marker and the lifted mark. One factor, read in one place; find every
  hard-coded size and route it through it. It is **per device**, in local
  storage beside the view mode, never in the document.
  - **Defaults** **(amended again, 2026-11-04)** — the owner: *"is there any
    way you can figure out what interface scale to use for each device, so
    everything is appropriately sized? (and make that 100% zoom)"*. This
    replaces "default a finger to about 32 px buttons":
    - **Drawn size is decoupled from hit size.** "Huge" was every control
      under a finger being *drawn* at its 44 px hit size. Controls are drawn
      at the interface size and, on a coarse pointer, answer a press over at
      least 44 CSS px however small they are drawn (an invisible `::before`,
      a row a target tall, a tray's button pitch a whole target) — the spin
      box's − and + included.
    - **100 % is computed per device**, and the spin box shows 100 % at that
      size; what is stored is only the viewer's multiplier, so a change in the
      OS text size still comes through. Device scale = form factor ×
      preferred text size. Form factor: a fine pointer 1.0 (today's desktop
      look); a coarse pointer on a phone 1.3 (iOS body text is 17 pt against
      macOS's 13 pt); on a tablet 1.15, between them — phone below a 600 CSS
      px short side, tablet from it. Preferred text size: under a coarse
      pointer where `font: -apple-system-body` applies (Safari, which follows
      Dynamic Type), its size ÷ 17; elsewhere the browser's default font
      size (`font-size: medium`) ÷ 16; held to 0.8–1.5.
    - **Correction to the amendment as given**: it said "in Safari, measure
      `-apple-system-body`". macOS Safari has the keyword too, at a fixed
      13 px (WebKit bugs 215279 and 230348: 13 px on macOS, 17 px on iOS at
      the default Dynamic Type; WebKit closed the second as intended,
      "matches platform conventions on macOS"), so dividing by 17 there would
      shrink every Mac by a quarter. It is read under a coarse pointer only.
      And the root's font size is the stylesheet's 13 px, not the person's,
      so the fallback reads `font-size: medium`.
  - **Reach stays a finger's.** Pick and snap radii (`TOUCH_REACH`) are about
    the finger, not the picture: scaling the interface down must not make
    things harder to hit. Glyph hit boxes follow their drawn size, as now.
- **Panels go to the very edge.** Find out why the command panel stopped
  ~60 pt short of the bottom on his phone (measure it in iPhone 13 emulation
  with `Emulation.setSafeAreaInsetsOverride` set to the device's real insets,
  standalone display mode) and fix it at the cause. The rule: a panel may be
  dragged until it touches the screen's edge; **a panel touching an edge that
  has a safe-area inset extends its ground under the inset and keeps its
  content clear of it** (padding by the inset), so the command line docks
  flush to the bottom with its text above the home indicator — iOS's own
  toolbar pattern — and likewise at a landscape notch's side, and at the top
  under the status bar where there is a top inset (Safari, not installed).
  **(amended: the status bar)** The owner: *"in PWA mode on iPhone, there is
  some blending at the top of the screen which is annoying. Any way to get
  rid of that?"* Since iOS 26, a home-screen app with a `black-translucent`
  status bar has Liquid Glass's scroll-edge blur drawn over its top (reported
  by several projects; Apple has said nothing). The installed app's status
  bar style is `default` now: the page starts below a solid band in
  `theme-color`, which is the drawing's ground, so in the installed app there
  is no top inset to reach under. The phone default layouts follow: the
  command line docks to the bottom in portrait.
- **Docking survives rotation** **(amended)**. When a pane is pushed against
  a screen edge, or up against another pane, that relation is what persists,
  not its pixel position. Rotating portrait↔landscape (or any resize)
  re-applies it: a pane docked to the right edge stays docked right, and a
  pane resting against the toolbar stays against it. A pane that was only
  floating keeps its position proportionally, clamped inside the area. Store
  each pane's edge and neighbour relations and recompute on resize; if the
  storage format changes, migrate the old one rather than dropping saved
  layouts.

## Tests

Unit: the metrics scale (every field, clamped); the scale setting's storage
and its defaults per pointer, and the spin box's steps; the edge-docking rule (a panel's rect and its
inset padding for each edge, with and without insets); the status fade rules.

E2E (iPhone 13 emulation with the real insets, and a desktop viewport):
no header element; the logo inside the safe area and the only chrome in the
corner taking pointer events; a drag starting beside the logo reaches the
canvas; tapping the logo opens the menu, Escape closes it; File items type
their commands (and are disabled with a reason while the commands do not
exist); `ui({scale})` changes a tool button's size, a glyph's drawn size and
a dimension label's font, and survives a reload; at a small scale a point is
still picked at the finger's reach; the command panel dragged down docks with
its bottom edge at the screen's bottom and its input above the inset; the
portrait default has the command line at the bottom. Every existing e2e test
passes (some read the header's status — keep the ids). LOOK at portrait and
landscape screenshots at three sizes and compare them with the owner's.
**(amended)** Also: the spin box steps by 10 % and its number resets; a pane
hidden from the menu is gone, survives a reload, and comes back where it was;
dock a pane to an edge and another against it in portrait, rotate to
landscape and back, and both relations hold each time, a floating pane
inside — with screenshots of each orientation. **(amended again)** Unit tests
of the device-scale computation for each form factor and text-size case; an
e2e at iPhone 13 emulation that the spin box reads 100 %, a tool button draws
at about 1.3 × the desktop's size and its hit area is at least 44 px; the same
at a desktop, where today's look is unchanged.

## Docs

CHANGELOG at the top, quoting the owner; the register (no title bar, the logo
opens the app menu, the interface size is per device and reach is not
scaled, panels dock to the very edge) as vetoable; STATUS; README (the phone
section's screenshots and words); `help()` for `ui`; the spec marked built.

## As built

Built on `claude/chrome-logo-scale`, with the three amendments above. By file:
`src/logo.ts` (the mark, the page's logo and the icon's SVG);
`src/uiscale.ts` (each device's 100 %, the viewer's multiplier, its storage);
`src/statusline.ts` (the status and its fade rules); `src/appmenu.ts` (the
dropdown); `src/panels.ts` (`touchMetrics`/`scaledMetrics`, `bleed`, the
fixed logo, `dockingOf`/`recorded`/`relaid`, storage v3 and the v2
migration, `Panels.setMetrics`/`panes`/`setShown`); `src/view.ts`'s
`View.ui`, read by glyphs, the frame marker, picking's and box select's frame
arms, revolve's axes, the engine's snap and lifted marks and `main.ts`'s
point dots, labels and dimension lines; `index.html` (no header, `#app` by its
four edges, the hit areas); `scripts/icons.ts` (writes `icon.svg` from the
logo); `scripts/singlefile.mjs` (the stamp into the About section); `ui()` in
`replenv.ts` and `help()`. Tests: `test/chrome.test.ts`,
`test/e2e/chrome.e2e.ts`, and the suites that knew the header updated.

**The ~60 pt gap, measured and fixed at the cause.** In iPhone 13 emulation
with iOS's real standalone insets the command line could be dragged only to
the drawing's bottom, 34 px (the home indicator's inset) above the glass —
`#viewwrap` was inset by it. The rest of the owner's ~96 pt does not happen
in Chromium: his screenshot is a 440×956 pt phone whose top inset is 62, and
the empty-canvas hint, which is centred on the canvas, puts the canvas's
bottom at 860 pt — so `#app`, at `100dvh`, was 894 pt tall, the screen less
the top inset. WebKit gives a home-screen app with a black-translucent status
bar a `100dvh` that excludes the status bar. Fixed: `#app` is
`position: fixed; inset: 0`, the drawing runs under both insets, and a panel
touching an inset edge reaches under it padded by it (`bleed`). Only an
iPhone can confirm the WebKit half; `layout()` now prints the window's size
and the insets the page measured, so the owner can read them off.

**The default phone size** (amendment 3 replaced "about 32 px"): a phone's
100 % is 1.3 × the desktop — a tool button drawn 26 px, its icon 21, a strip
21, the logo 26 — each hit over 44. 0.1.0 drew all of them at 44.

Deviations and additions — each a decision, vetoable:

- **Along a tray, buttons are a whole target apart** (pitch 44 at a phone's
  100 %): a hit box of 44 round each 26 px face needs it. So the column is
  34 px thick where 0.1.0's was 52, but as long as before for eleven tools
  (511 px against 556). A shorter column would mean overlapping hit boxes.
- **A strip's hit box reaches outward over the drawing**, never into the
  panel's content (the log's text, the command line's field). So a touch
  within ~23 px above a strip is the strip's; the portrait defaults keep the
  logo's row clear of it (measured: the log's strip took a drag that started
  on the status). And Chromium's touch adjustment sends a touch landing
  within ~16 px of the logo to the logo — the drag-beside-the-logo test
  starts 40 px off it.
- ~~**Fields keep 16 px type at least, under a finger**: below it iOS zooms
  the page into a focused field, and a zoomed page is the one thing the page
  lock cannot undo. At a phone's 100 % the command line's type is 17 px
  anyway; only the 60–70 % end is held.~~ **Retired (2026-11-05)**: the
  owner, from his iPhone, *"the cmd text does not scale... the title of
  this pane scales, but not the text itself"* — the floor held the command
  line at 16 px below 95 %, which is exactly where he was looking. The
  viewport meta's `maximum-scale=1` is what stops Safari's focus zoom (the
  page lock already relies on it); the floor is gone and the fields scale
  with everything else. **Vetoable by one check on the device**: if a
  focused field zooms the page, say so and the floor comes back as a
  per-viewer switch.
- **Phone menus drop the command hints** beside their items (no room at
  15 px type, no hover to read them by; the log shows what was typed), and
  both menus are held to the screen's width — the context menu came out
  420 px wide on a 390 px phone. An off item shows its reason where the
  command would be, and in full as its title.
- **The logo is in the layout as a panel nothing moves** (`Placed.fixed`): a
  push that reaches it stops flush, exactly as at the area's edge. Not in the
  spec; without it a panel could be dragged over the way into the menu.
- **The status is drawn over the panels**, on its own dark pill, taking no
  pointer events. In landscape it sits over the command line's strip until
  it fades. `ready`/`SOLVED` fade after 3 s; the step note keeps its 1.6 s
  and 5 s; a conflict or an error stays.
- **A tray whose line no longer fits along its edge after a rotation turns,
  keeping the edge** (a bottom row stood up becomes a column on the bottom
  edge). The spec was silent; clipping the row was the alternative.
- **A floating pane in the area it was put in stays exactly put**, even if
  its size changed (a tray re-measured); in another area it keeps its share
  of the free room.
- **Docking is recorded at the end of a gesture**, for the panels it moved
  and for any stored panel that rested on one of them; a rotation re-lays
  but never re-records, so turning a phone back and forth cannot drift.
- **Storage**: the layout is `neocad.panels.v3` (rectangle, area, scale,
  docking, hidden); a v2 layout is read once, docked where it lies in the
  first area there is, written as v3, and its key removed. The interface size
  is `neocad.uiScale.v1` and holds the viewer's multiplier only; 100 % is not
  stored, so a device follows its own default.
- **Every panel can be hidden**, the tool-options panel too; `layout("reset")`
  shows them all again. The logo cannot be hidden, so the menu is always
  there to bring one back.
- **The device's text size is read once, at load**: a changed Dynamic Type
  setting is picked up by the next start.
- **The amendment's platform claims, checked**: WebKit's `-apple-system-body`
  is 17 px on iOS at the default Dynamic Type and a fixed 13 px on macOS
  (bugs.webkit.org 215279, 230348 — the second closed by WebKit as matching
  macOS conventions), so it is read only under a coarse pointer, and the
  fallback is `font-size: medium` (the browser's default) because the page's
  root is the stylesheet's 13 px. Apple's body text is 17 pt on iOS and 13 pt
  on macOS, which is the 1.3.
- **The golden-picture test** (`hidden.e2e.ts`) now asks for a 1100×768
  window, the canvas it was recorded on when there was a title bar.
- **The installed app's status bar is `default`, not `black-translucent`**
  (the manager's item, after the owner's *"some blending at the top of the
  screen"*), and `theme-color` (and the manifest's) is the drawing's ground,
  `#0a0e13`, not the old header's. In the installed app the page now starts
  below the bar, so its top inset is 0 and nothing reaches under the bar;
  the bottom and the landscape sides are as built, and Safari (not
  installed) still has a top inset, which `bleed` serves. The `100dvh`
  diagnosis above was of the translucent style; `inset: 0` is right under
  both. **iOS reads the style when the app is added to the home screen**:
  the owner must remove the icon and add it again. The emulated-inset tests
  keep a top inset of 47, standing for Safari.

Limitations left in place, deliberately:

- **What only an iPhone can show**: that `inset: 0` is the whole screen in a
  home-screen app (the `100dvh` diagnosis is arithmetic on a screenshot);
  Dynamic Type through `-apple-system-body`; and the keyboard over a command
  line docked to the bottom — iOS scrolls a focused field into view, which
  Chromium's emulation does not reproduce. If it does not, the line can be
  dragged to the top, where 0.1.0 had it.
- **The tablet factor (1.15) and the 600 px boundary are reasoned, not
  measured on an iPad.**
- **A strip's outward hit box** can take a touch meant for geometry drawn
  just above a panel, within ~23 px. Measured only in emulation.
