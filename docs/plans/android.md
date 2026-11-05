# Plan: Android — the same app, installed and at home on a Pixel or a Galaxy

**Status: queued** (2026-11-05), after `mode-feedback.md` (both touch the
chrome; this one follows so the chip and the tint are in place to test).
The owner: *"obv this whole platform should also work on android"*.

## What is true today

The app is a PWA served from Pages, tested in Chromium — the engine, the
touch recogniser and every e2e test already run on Chromium's input
pipeline, which is Android's. What is iPhone-shaped is everything around
that: the device table (`test/devices.ts`) is seven iPhones; the per-device
scale reads Dynamic Type through `-apple-system-body`; the status bar and
safe-area work was done against iOS 26; file open and save were tried in
Safari's and desktop Chromium's pickers (`files.ts` already notes Android
Chromium has `showSaveFilePicker` since 132); nothing handles the Android
back gesture; the install prompt is Safari's "Add to Home Screen".

Read `CLAUDE.md`, `pwa-pages.md`, `files.md`, `chrome-logo-scale.md`,
`everything-fits.md`, `touch.md`, `mode-feedback.md` (as built),
`scripts/pwa-shell.ts`, `scripts/pwa-sw.js`, `index.html`, `src/main.ts`
(the scale), `src/files.ts`, `src/filehost.ts`, `src/update.ts`,
`src/panels.ts`, `test/devices.ts`, and the pwa, fits, files and touch
tests.

## Design

- **The device table grows an Android column**: Pixel 7, 8 and 9 (and
  their Pro sizes), Galaxy S23/S24, a Pixel Fold / Galaxy Fold inner and
  outer screen, a Pixel Tablet and a Galaxy Tab — widths, heights, pixel
  ratios and insets (the display cutout: `env(safe-area-inset-*)` works in
  Chrome Android with `viewport-fit=cover`; the three-button bar vs the
  gesture bar; measure what Playwright's descriptors say and what the
  cutout reports). Everything-fits runs over the whole table: nothing
  overlaps on any of them, landscape included, with the keyboard up
  (`visualViewport`: the command bar rides above the keyboard, the canvas
  does not shrink).
- **Scale on Android**: `-apple-system-body` is absent; read the system
  font scale the way Chrome Android exposes it (the computed size of a
  `font: medium` element against 16 px with `text-size-adjust` left at its
  default — measure it; if Chrome applies the OS font scale to the page,
  that ratio is the Dynamic Type equivalent, else it is 1). The per-device
  100 % stays what `chrome-logo-scale.md` defined; say in the register what
  Android's factor is and how it was measured.
- **Back gesture.** Android's back (gesture or button) closes what is
  open — a flyout, the menu, a dialog, the context menu, a tooltip — and
  otherwise does nothing, never leaving the app or reloading the page:
  one `history` entry pushed when something opens, popped when it closes,
  `popstate` closing it (the pattern every PWA uses). Desktop's Escape and
  the back gesture are the same seam.
- **Install.** `beforeinstallprompt` is kept and the logo menu gets
  **Install app** on Android and desktop Chromium (hidden once installed
  or where the event never comes; iOS keeps its Add to Home Screen note).
  The manifest: `display: standalone`, maskable icon (already), `id`,
  `screenshots` and `description` so Chrome's richer install sheet shows,
  `launch_handler` so a second open focuses the running app,
  `file_handlers` for `.zerocad.json` and the workbench file. Theme colour
  for the Android status bar, and the three-button bar's colour where it
  applies.
- **Files on Android.** Open: `showOpenFilePicker` where it exists, else
  `<input type=file>` (the Files/Downloads picker). Save: `showSaveFilePicker`
  on 132+, else a download (Chrome's "save to Downloads" sheet) and say so
  in the log. Share: Web Share with files works on Android Chrome — the
  `.json` refusal is Safari's; test Android's path takes the file. Open
  from the OS: `file_handlers` and `launchQueue` as on desktop. Workbench
  files the same way (`workbenches.md`).
- **Touch**: nothing changes in the recogniser; verify the long-press does
  not raise Chrome's own context menu or text selection on the canvas
  (`contextmenu` prevented, `user-select: none` on the chrome), that the
  pinch does not zoom the page (`touch-action: none` holds; the viewport
  meta), and that a one-finger drag from the screen edge is the OS's back
  and not a pan (the edge is theirs; say so).
- **Other browsers**: Samsung Internet and Firefox Android get a smoke run
  of the touch suite under their user agents if Playwright can emulate
  them; where it cannot, the register says they are untested, not that
  they work.
- The service worker and the update button are unchanged; test the update
  path under Android's lifecycle (the app killed in the background and
  reopened: autosave restored).

## Tests

Unit: the device table's new rows; the scale factor's reading; the back
gesture's history bookkeeping (push on open, pop on close, popstate closes;
nothing left behind after open-close-open). E2E, over the Android rows of
the table (Playwright's Pixel 7 and Galaxy descriptors, portrait and
landscape): everything fits; a tap, drag, long-press and pinch as on the
iPhone; back closes a flyout and then the menu and then nothing; install
prompt wiring (the event simulated); open, save, share a file by each path
with the fallbacks; the keyboard and the command bar. LOOK at each picture;
the cutout and the bar insets above all.

## Docs

CHANGELOG at the top quoting the owner; the register (Android's scale
factor and how measured; the back-gesture rule; which browsers are tested)
as vetoable; STATUS; README's install paragraph for Android; `help()`; the
spec marked built with the deviations.
