# Plan: Android — the same app, installed and at home on a Pixel or a Galaxy

**Status: built** (2026-11-06), on `claude/android`; see *As built* at the
end for what was measured, what the platforms really do (two claims below
are corrected there) and every deviation. Queued 2026-11-05, after
`mode-feedback.md`.
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

## As built

Built on `claude/android` (2026-11-06). By file. **New:** `src/backstack.ts`
(the back's history entries, pure), `src/keyboard.ts` (where the panel being
typed into goes, pure), `src/install.ts` (the browser's install offer kept and
made), `scripts/screenshots.ts` (`npm run build:screenshots`) and
`public/screenshots/{phone,desktop}.png`, `test/e2e/android.e2e.ts` (14),
`test/e2e/android.measure.ts` (`npm run measure:android`),
`test/backstack.test.ts` (8), `test/keyboard.test.ts` (3),
`test/install.test.ts` (3). **Changed:** `test/devices.ts` (the Android rows,
`androidWindowOf`, `everyAndroidWay`), `src/uiscale.ts` (`textScale`,
`textSource`), `src/main.ts` (the scale's probe, the back's wiring and the
`closeTop` it shares with Escape, the keyboard's lift, the installer, the
page-wide `contextmenu`), `src/appmenu.ts` (the App section), `src/replenv.ts`
(`installApp()`), `src/filehost.ts` and `src/workbenchhost.ts` (the pickers'
fallbacks, each result naming its door, the launch queue's workbench route),
`scripts/pwa-shell.ts` (`screenshots`, `launch_handler`, the workbench's
`file_handlers`), `scripts/pwa.ts`, `index.html` (the viewport's
`interactive-widget=resizes-visual`), `src/modules/interface.ts` (`help()`'s
`android`), `test/fits.test.ts` (+68), `test/chrome.test.ts` (+1),
`test/pwa.test.ts` (+1), `test/e2e/fits.e2e.ts` (+1: the whole Android table),
`test/e2e/harness.ts` (six phones, a user agent, browser flags). Pictures:
docs/images/177–183, each looked at.

**The device table's Android rows** (CSS px; status bar upright / on its side;
the cutout's depth, a left inset on its side; every number's source in
`test/devices.ts`). Each is laid out three ways: installed with the gesture bar
(24, the bottom inset), installed with three buttons (48: a phone's column at
the right on its side, a large screen's taskbar along the bottom), and in a
Chrome tab.

| Row | Screen | Scale | Status | Cutout | Chrome's tab, upright / on its side |
|---|---|---|---|---|---|
| Pixel 9 | 360×808 | 3 | 58 / 28 | 58 | 360×732 / 756×308 |
| Galaxy S23, S24 | 360×780 | 3 | 40 / 24 *est.* | 40 *est.* | 360×704 / 728×308 *est.* |
| Galaxy Z Fold 7 cover | 360×840 | 3 | 40 / 24 *est.* | 40 *est.* | 360×764 / 788×308 |
| Pixel 7, 7a, 8, 8a | 412×915 | 2.625 | 52 / 28 | 52 | 412×839 / 863×360 |
| Pixel 7 Pro | 412×892 | 3.5 | 42 / 28 | 42 | 412×816 / 840×360 |
| Pixel 9 Pro | 427×952 | 3 | 68 / 28 | 68 | 427×876 / 900×375 |
| Pixel 8 Pro | 448×997 | 3 | 51 / 28 | 51 | 448×921 / 945×396 |
| Pixel 9 Pro XL | 448×997 | 3 | 67 / 28 | 67 | 448×921 / 945×396 |
| Galaxy Tab S9 | 640×1024 | 2.5 | 24 *est.* | — | 640×948 / 972×588 *est.* |
| Pixel Tablet | 800×1280 *derived* | 2 | 24 *est.* | — | 800×1204 / 1228×748 *est.* |
| Galaxy Z Fold 7 inner | 984×1092 | 2 | 32 *est.* | — | 984×1016 / 1040×932 |

Screens are Playwright's descriptors (DevTools' list); the Pixels' status bars
and cutouts are their AOSP device overlays (`status_bar_height_portrait`, the
cutout's rect approximation; 28 dp on their side), the bars AOSP's dimens.
Samsung publishes no overlay, so its bars are estimated, as is the Pixel
Tablet's screen (Google's 2560×1600 at xhdpi). **Everything fits on all 66
ways** at each device's own 100 % (a phone 1.3, a short side of 600 or more
1.15) and to 120 % (`fits.test.ts`), and in the browser on all 66 with the
keyboard up (`fits.e2e.ts`), with no change to the layout code. The Pixel 9 is
the narrowest phone either table has (360), and its Chrome tab on its side the
shortest page (308).

**Android's scale factor, and how it was measured.** Chromium 141, Playwright's
Pixel 7, the system's font scale stood in for by Blink's own setting for it
(`--blink-settings=accessibilityFontScaleFactor=1.3`, the setting Chrome on
Android fills from the system's). Read three ways:

| Read | At 1.0 | At 1.3 |
|---|---|---|
| `env(preferred-text-scale)` | 1 | **1.3** |
| `font-size: medium` on a lone probe, computed (text-size-adjust auto or 100 %) | 16 px | **16 px** |
| `font-size: medium` among four lines of text, text-size-adjust auto | 16 px | 20.8 px |
| the same, `text-size-adjust: 100%` (this page's) | 16 px | 16 px |

So Chrome applies the system's scale to type only by **text autosizing**, a
heuristic over runs of text that never acts on a probe — the spec's suggested
reading would always say 1. The variable is the API (Chrome on Android since
138, per its intent to ship). **Android's factor is `env(preferred-text-scale)`
times the browser's own default font size over 16**, read under a finger only;
where there is no variable (older Chrome, Firefox), the old rule: the browser's
font size over 16. The device's 100 % is form factor × that, the text factor
held to 0.8–1.5: 1.3 on a Pixel at the default, 1.69 at 130 % (e2e: a tool
button drawn 1.3 × larger). `ui()` says which it read: *text size 1.30 (the
system's font scale)*. No `<meta name="text-scale">`: it would scale `medium`
too and the factor would be counted twice. Not measured on a phone: that a real
Pixel's variable follows Settings → Display → Font size.

**Chromium 153 tells only a page that asks** (measured 2026-11-12, when the
browser under the suite became 153.0.8010.12 and the e2e above read *text
size 1.00* under a scale of 1.3 on every run; browser-only bug 78). The same
flag, Pixel 7, the page's `text-size-adjust: 100%`:

| Read, Chromium 153 | scale 1.0 | scale 1.3 | scale 1.3, browser font 20 px | scale 1.3, font 13 px |
|---|---|---|---|---|
| `env(preferred-text-scale)`, the page as it stands | 1 | **1** | 1 | 1 |
| the same, with `<meta name="text-scale" content="scale">` in the document | 1 | **1.3** | **1.625** | **1.05625** |
| `font-size: medium`, the page as it stands | 16 px | 16 px | 20 px | 13 px |
| the same, with the meta in | 16 px | 21 px | 26 px | 17 px |
| `env(preferred-text-scale)` once the meta is taken out again | 1 | 1 | 1 | 1 |

So the variable is the meta's: without it the page is told 1, and with it
the page is told **the system's scale × the browser's own font size ÷ 16**
(`scaleAllFontsIfNoMetaTextScaleTag`, `TextScaleMetaTag` in the binary's
strings) and `medium` moves too — which is why the page cannot simply carry
the meta. CDP's `Emulation.setEmulatedOSTextScale` sets the same scale and
is told to the same pages. What the app does (`measureDevice`, main.ts;
`systemTextScale`, uiscale.ts): reads the variable as the page stands; where
that is exactly 1 on Android under a finger, appends the meta, reads again,
and takes it out in the same task, before anything is drawn (measured:
`medium` back to 16 px and the variable to 1); divides what the asked
reading says by the browser's own font size over 16, so the rule above —
the system's scale × the browser's own — counts the browser's once. Chromium
141 is unchanged by this: its first reading is not 1, and nothing is asked.
The e2e says which reading this browser gives, by version, and fails saying
so if neither does — rather than at the `ui()` string further down. Also
checked there: 1.15 with a 20 px browser font reads *text size 1.44*, not
1.80 held to 1.50. Still not measured on a phone.

**The back-gesture rule** (`backstack.ts`). Back closes the top-most open
thing — the tooltip, Add workbench…'s question or the missing-workbench offer,
the context menu, a flyout, the app menu — through the same `closeTop` Escape
uses (so Escape now closes the question too). One `history` entry is pushed
when something opens **by a press** (user activation), taken off with
`history.back()` when it closes any other way, its `popstate` expected and
ignored; nothing is left behind (e2e: five opens and closes leave the history
where it was). **At rest, a guard entry** makes a back with nothing open do
nothing — never leaving or reloading the app — under a finger or installed.
Driven in the e2e as the browser's own Back (CDP's history navigation), which
is what the system's gesture becomes in Chrome.

**Install.** `beforeinstallprompt` is kept from load (`preventDefault`, so
Chrome's mini-infobar does not offer it unasked), and the logo menu's new
**App** section shows **Install app**, typing `installApp()`, which raises the
browser's own sheet. Gone once installed (`appinstalled`, or opened standalone)
and wherever the event never comes; on an iPhone in Safari the section says
*Safari's Share, then Add to Home Screen*. The manifest gains `screenshots` (a
Pixel 7 installed and a desktop, made from the real app), `launch_handler:
{ client_mode: ["focus-existing", "auto"] }` and the workbench file in
`file_handlers`; `display`, `id`, `description`, the maskable icon and
`theme_color` (the drawing's ground, which the status bar takes) were there.

**The file paths and their fallbacks**, each logged with the door it used:

| Action | Chrome on Android 132+ | Fallback | Said |
|---|---|---|---|
| Open | `showOpenFilePicker` | the picker failing (not a cancel), or none: the file input, Android's Files / Downloads chooser | `choose a file… (the file picker)` / `(the browser's file chooser)` |
| Save | into its handle, else `showSaveFilePicker` | the picker or its write refusing: a download; no picker: the share sheet under a finger, which refuses a `.json`, so a download | `downloaded X — the save picker refused (…)` / `— this browser has no save picker` |
| Share | `navigator.share` with the file | refused (`.json`): a download | `the share sheet would not take the file (Permission denied) — downloading it instead` |
| From the OS | `file_handlers` + `launchQueue` | — | a `.js` goes to Add workbench…'s question |
| Add workbench… | `showOpenFilePicker` (`.js`, both JS types) | the input | `— the file picker` / `— the browser's file chooser` |

**Touch.** Nothing changed in the recogniser. On the Pixel 7 a tap selects, a
drag draws, a long-press opens the menu and a pinch zooms the drawing, both ways
up, `visualViewport.scale` staying 1. The checks: every `contextmenu` a
long-press raises is cancelled (one surface was not — found, below); nothing
selects but the command line and the log; the canvas has `touch-action: none`,
the page `manipulation`; a pinch over the chrome zooms nothing. **A one-finger
drag from the screen's edge is the system's back**: Android takes it before the
page sees anything, so it is never a pan. The edge is theirs, and nothing here
can test it.

**Browsers.** Tested: Chromium 141 under Playwright's Pixel 7 and Galaxy S24
descriptors — on Android, the browser's own engine and input pipeline.
Smoke-run: **Samsung Internet's user agent** on the Galaxy S24 (tap, drag,
long-press, pinch) — Chromium with Samsung's string, not Samsung's browser.
**Untested: Firefox for Android** (no Gecko on this machine, and Playwright's
Firefox has no mobile emulation) **and Samsung Internet itself.**

**The update path under Android's lifecycle**: the service worker and the
update button are unchanged. e2e: the app hidden (`visibilitychange`), its page
closed at once inside autosave's 500 ms quiet, and opened again — the drawing
is restored by the hidden-flush alone.

**The two costs earlier reviews left unmeasured** (`npm run measure:android`:
Pixel 7, unthrottled and under CDP's 4× CPU throttle; two runs on a shared
machine, so ranges):

- **`activePlane` per frame with a work plane on a face**: 0.9 ms on the
  three-feature fixture (pre-explicit-regions, the plane e2's end), 2.0–2.7 ms
  at 4×; on the stepped-boss scene 0.1–0.4 ms; `focusOf` under 0.2 ms.
  **Not cached**: under the brief's "more than a few ms a frame", and the model
  keeps no revision to key a cache on short of fingerprinting the solved
  values every frame. It grows with features × faces (it asks every feature
  for its faces), so it is the one to cache when a drawing makes it cross —
  TODO.md.
- **`Bodies.everything` starting the Worker when round is armed** on a
  one-sweep box (no Worker until then): the arming frame 15 ms (47 ms at 4×);
  the kernel's bodies in after 1.2–1.7 s; meanwhile the page drew 8–10
  frames, the longest gap 0.6–0.8 s, one long task of about 0.9 s. A
  main-thread profile of the same shows the page's own JavaScript idle for
  1.2 s of it (0.1 s native), so the stall is not the app's code; most likely
  the Worker's 4 MB wasm compile and the software compositor sharing this
  machine's cores — not proven. Recorded, not fixed: starting the Worker when
  the first feature is made would take it off the arming.

### Deviations and corrections — each a decision, vetoable

- **Corrected: the `.json` share refusal is Chromium's on Android too**, not
  Safari's. Chromium's Android share service
  (`components/browser_ui/webshare/android/…/ShareServiceImpl.java`) permits a
  fixed list of extensions and types with no `json` or `js`. Share on Android
  downloads and says so; the e2e tests that refusal, not a share that takes
  the file, which Chrome never does.
- **Corrected: the scale is not read off `font: medium`** (measured above).
- **The guard is only under a finger or installed.** In a desktop's tab, Back
  with nothing open leaves the page as it always has; trapping it there would
  be hostile. Open things get their entry everywhere.
- **Entries only for a press's opening.** A mouse's hover opens a flyout with
  no entry — no history churn along the tray, and Chromium marks entries made
  without activation as ones Back skips. A back still closes it: the guard's
  pop closes the top-most open thing.
- **Escape now closes the workbench question and the offer**, as back does.
- **The keyboard is the page's to dodge, not the layout's.** No re-layout: the
  page asks for `interactive-widget=resizes-visual` (Chrome's default since
  108), so the drawing keeps its size, and the panel holding the focused field
  is moved onto the keyboard's top and narrowed to the free run beside the
  other panes (the whole command line where that run is under 160 px). The e2e
  keyboard is a stand-in `visualViewport`, Gboard taken as 40 % of the window
  upright and 55 % on its side.
- **A page-wide `contextmenu` cancel**, except on the command line, the log and
  fields — found because a tray button's long-press let one through.
- **Install app is an App section of its own, first**, shown only while there
  is something to say; on an iPhone in Safari, the Add to Home Screen note
  (the spec said iOS "keeps" its note, which lived only in the README).
- **The workbench `.js` in `file_handlers`** is offered for every `.js` file
  (the OS keys on the last extension, as for `.json`); one that is not a
  workbench is refused at its manifest, before anything runs.
- **The Pixel 9 row is Playwright's 360 × 808** — the panel at a scale of 3;
  Android's default for it is 411 wide. Kept: it is the narrowest phone either
  table has.
- **No colour for the three-button bar**: no manifest member sets it; Chrome
  draws it, and with gestures the page runs under the bar.
- **The Android suites re-send the safe-area override after a reload** and
  assert the page reports it: after a run of other window sizes the first
  sending was sometimes not in force (a landscape picture had the logo in the
  cutout). The iPhone fits suite sends it the same way and checks no insets —
  TODO.md.

### Limitations left in place, deliberately

- **Not tried on an Android device.** What only one can show: that Chrome
  reports the gesture bar as the bottom inset in an installed app, and a
  landscape cutout as a side inset rather than letterboxing it (the same area
  either way); that Install app's sheet is the richer one with the pictures;
  that the pickers' quirks reported on blink-dev (MIME filters ignored,
  save-as only over an existing file) are met by the fallbacks; that
  `file_handlers` registers for a WebAPK at all (Chromium's docs disagree);
  that a back at rest stays in the app after two backs with no tap between
  (Chromium may skip a guard re-armed without one); and that Samsung Internet
  and Firefox work.
- **Above 120 %** the Android ways are held only to "the resolver says so"
  (`fits.test.ts`), not tabulated step by step as the iPhones' are.
