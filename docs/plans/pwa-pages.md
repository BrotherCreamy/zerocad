# Plan: an installable app on GitHub Pages

**Status: built** (2026-11-04), on `claude/pwa-pages`; see *As built* at the
end for what changed, the hosting target above all. The owner, verbatim:
*"please make this available via GitHub hosting, and it should be a PWA, non-scrolling/
non-zooming, to enable use on a multi-touch device … Specifically I have an
iPhone."* This package is the hosting and the PWA shell; the touch interaction
is its sibling, [`touch.md`](touch.md). Read `CLAUDE.md`, `index.html`,
`vite.config.ts`, `package.json`, `scripts/singlefile.mjs` and
`scripts/single-entry.ts`, `src/main.ts`'s startup, and `kernel-rs/`'s build.

## Facts that shape it

- The repository is **private**. GitHub Pages from a private repository needs
  a paid plan, and **the published site is public** whatever the repository's
  visibility. The owner has been told both.
- Pages must be switched on in the repository's settings once, by the owner;
  nothing here can change repository settings. The source will be **Deploy
  from a branch → `gh-pages` / root**.
- The kernel is built by `wasm-pack` from `kernel-rs/`; `src/kernel/wasm-gen`
  is gitignored, so the deploy must build it (Rust stable, the
  `wasm32-unknown-unknown` target, wasm-pack via its official installer).

## Design

- **The app shell as a PWA**, built by a new `npm run build:pwa` into
  `dist-pwa/`:
  - `index.html` is the single-file build (`scripts/singlefile.mjs`'s output,
    so the kernel rides inside it as today and the app works with no other
    request), wrapped in a full document with the PWA head;
  - `manifest.webmanifest`: name "NeoCAD", short name, `display: standalone`,
    `orientation: any`, `start_url` and `scope` relative (`./`) so it works
    under `/neocad/`, the app's dark background and theme colours, icons;
  - **icons**: 192 and 512 PNG (and a maskable 512), and a 180 PNG
    `apple-touch-icon` — iOS needs PNG. Draw one SVG mark in the app's style
    and rasterise it once to the PNG sizes with the installed Chromium
    (Playwright, a script in `scripts/`), committing the PNGs under
    `public/icons/` so the deploy needs no browser;
  - **a service worker** (`sw.js`, no dependency): cache-first for the shell,
    the cache keyed by the build stamp so a new deploy replaces the old one
    on next launch; a new version waiting is applied on the next start (no
    reload under the user's hand);
  - **iOS head**: `apple-mobile-web-app-capable` and `mobile-web-app-capable`,
    `apple-mobile-web-app-status-bar-style: black-translucent`,
    `apple-mobile-web-app-title`, `theme-color`.
- **Non-scrolling, non-zooming**, in the app itself (so the single-file build
  and the dev server get it too, not only the PWA):
  - viewport `width=device-width, initial-scale=1, maximum-scale=1,
    user-scalable=no, viewport-fit=cover`;
  - `html, body` fixed to the viewport (`position: fixed; inset: 0;
    overflow: hidden; overscroll-behavior: none`), the app sized with `100dvh`
    and the safe-area insets (`env(safe-area-inset-*)`) so nothing sits
    under the notch or the home indicator;
  - iOS ignores `user-scalable=no` in Safari, so also: `touch-action: none` on
    the canvas, `touch-action: manipulation` on the chrome (no double-tap
    zoom), and `preventDefault` on WebKit's `gesturestart`/`gesturechange`/
    `gestureend` and on multi-finger `touchmove` at the document (non-passive
    listeners), with the reason in a comment;
  - `-webkit-user-select: none` and `-webkit-touch-callout: none` on the
    canvas and chrome (a long press must not raise iOS's callout), leaving the
    command line and the log selectable.
- **The deploy**: `.github/workflows/pages.yml`, on push to
  `claude/resume-tasks-o7q02e` and on manual dispatch: check out, set up Node
  and Rust, build the kernel with `npm run build:kernel` (falling back to
  `build:kernel:dev` if binaryen cannot be fetched, logged), `npm ci`,
  `npm run build:pwa`, and publish `dist-pwa/` as the only content of the
  `gh-pages` branch with a plain `git` push using `GITHUB_TOKEN`
  (`permissions: contents: write`) — no third-party action. Add
  `.nojekyll`. **If pushing a workflow file is refused** by the session's git
  credentials (a token without the `workflow` scope), do not work around it:
  commit the workflow anyway if possible, report the refusal, and as the
  fallback publish `dist-pwa/` once to `gh-pages` from here with plain git so
  the owner can test today (the owner asked for GitHub hosting, which is this
  branch's purpose).

## Verification

Unit: the manifest's fields and relative URLs; the service worker's cache key
follows the stamp. E2e: the PWA build served from a sub-path (`/neocad/`)
loads, solves and registers its service worker; offline after first load
(Playwright's `context.setOffline(true)`) it still loads and draws; the page
cannot scroll (`scrollY` stays 0 after a wheel and a touch drag on the chrome)
and its scale stays 1 under a scripted pinch (iPhone emulation with
`hasTouch`); Lighthouse-style checks by hand: `display: standalone`, icons
resolve. LOOK at a screenshot in iPhone 13 emulation (portrait and landscape):
nothing under the notch. Full `npm run test:all` with a long timeout. Docs per
`CLAUDE.md`: CHANGELOG at the top quoting the owner; README (the hosted URL
and how to install to the home screen on iPhone: Safari, Share, Add to Home
Screen); STATUS; the register (hosting and its two facts above); this file
marked built.

## Delivery

Isolated worktree, branch `claude/pwa-pages` off the working-branch tip, one
PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising session
reviews. The `gh-pages` push, if the fallback is needed, is the one push
outside the PR branch that is allowed. The touch package (`touch.md`) runs at
the same time: you own the document head, the viewport, the no-scroll/no-zoom
CSS and listeners; it owns pointer gestures and layout on small screens.

## As built

**The hosting target moved mid-build**, at the manager's direction: the
owner's repository goes back to private, and the site will be served from a
new public repository, `BrotherCreamy/zerocad`, at
`https://brothercreamy.github.io/zerocad/`. The two facts above about a
private repository's Pages no longer apply to the site. So:

- **Nothing was pushed to any `gh-pages` branch**, the fallback included;
  publishing is the manager's. The workflow is in the PR as specified and is
  repository-neutral (it pushes to `gh-pages` of whichever repository runs
  it); on the private repository it is harmless.
- The e2e sub-path is `/zerocad/`, the target's. Every URL in the build is
  relative, so the repository's name is the only thing that sets the address.
- The app is to be renamed ZeroCAD after merging; nothing was renamed here.
  ⚠ When it is: the worker's cache prefix (`CACHE_PREFIX`, `neocad-`) is what
  lets a new worker delete its old caches, so the release that changes it
  should delete caches under **both** prefixes, or one stale cache stays on
  every phone that had the old one.

What was built, by file: `scripts/pwa.ts` (`npm run build:pwa` → `dist-pwa/`);
`scripts/pwa-shell.ts` (the manifest, the head, the cache's name, the shell's
file list; pure, unit-tested); `scripts/pwa-sw.js` (the hand-written worker,
filled by the build); `scripts/singlefile.mjs` (now exports `singleFile()`,
which `build:pwa` wraps; `build:single` writes the same fragment as before);
`scripts/icons.ts` (`npm run build:icons`, rasterises `public/icons/icon.svg`
with the e2e harness's Chromium) and the four PNGs it made, committed;
`src/pagelock.ts`, called first thing by `main.ts`; `index.html`'s viewport,
format-detection meta, fixed page and safe areas;
`.github/workflows/pages.yml`. Tests: `test/pwa.test.ts` (8),
`test/e2e/pwa.e2e.ts` (9).

Deviations and additions:

- **The safe areas are checked with CDP's
  `Emulation.setSafeAreaInsetsOverride`.** Chromium's iPhone 13 descriptor
  reports zero insets, so without it "nothing under the notch" could only
  pass. The test sets iOS's standalone insets (portrait top 47 / bottom 34;
  landscape left and right 47 / bottom 21) at home-screen size (390×844 and
  844×390) and asserts the header's text, the drawing and every panel are
  inside; the header's ground runs to y = 0 under the status bar.
- **Every "it does not happen" check has a control that makes it happen** with
  the same driver: on a plain zoomable tall page a CDP swipe scrolls and a CDP
  two-finger spread zooms; and the app served with its viewport's limits
  stripped (as iOS ignores them) zooms under a pinch on the header once the
  page lock's listeners are dropped, and does not with them. CDP's
  `Input.synthesizePinchGesture` zoomed nothing even on the control page, so
  the pinch is two raw touch points.
- **`touch-action: manipulation` is on `html, body`**, not on each piece of
  chrome: touch-action is not inherited, but what a touch may do is the
  intersection over its target's ancestors, so it holds over all of the
  chrome, and the canvas's `none` narrows it further.
- **Inputs stay selectable** as well as the command line and the log
  (`#cmd,#log,input`): iOS will not edit a field under `user-select: none`,
  and the options panel's fields are inputs.
- **Additions in the head and CSS:** `format-detection: telephone=no` (iOS
  links digit runs, and the log is full of coordinates), no tap highlight,
  `text-size-adjust: 100%` (iOS enlarges text on rotation), an SVG favicon,
  and the manifest's `id`.
- **"Lighthouse-style checks by hand" are automated**: the e2e reads the
  manifest as an installer would and loads every icon it and the head name,
  checking each decodes at its declared size.
- **An e2e update test beyond the spec**: a second build under a new stamp
  installs beside the open app, fills its own cache, leaves the open window
  (and a second one opened meanwhile) on the old version, and is what the next
  start gets, the old cache then gone.
- **The workflow runs `npm ci` before the kernel**, and uses rustup as the
  runner has it (`rustup toolchain install stable --target
  wasm32-unknown-unknown`). wasm-pack's installer is at its current home,
  `wasm-bindgen.github.io/wasm-pack/installer/init.sh` (the `rustwasm`
  organisation was archived). It has never run; nothing here can run it.

Limitations left in place, deliberately:

- **The real device is iOS Safari, which this machine cannot run.** All of the
  above is Chromium's emulation. What only an iPhone can show: that a pinch on
  the chrome does not zoom, that a swipe on the header does not rubber-band,
  that a long press on the canvas raises no callout, that the status bar text
  sits over the header, and that the home-screen app opens standalone.
- **"The next start" on iOS means after the app is closed** from the app
  switcher, not merely sent to the background: a backgrounded app is still an
  open window, so the new version waits.
- **The cache is named for the build stamp, the commit and the day**: two
  builds of the same commit on the same day with different content (a dirty
  local tree) would share a name. A deploy builds a clean checkout, so this
  only matters locally.
- **In landscape the default panels overlap** (the log over the tray's edge
  and the empty-canvas hint). That is layout on small screens, the touch
  package's; nothing sits under the notch.
