# Plan: an installable app on GitHub Pages

**Status: queued** (2026-11-04). The owner, verbatim: *"please make this
available via GitHub hosting, and it should be a PWA, non-scrolling/
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
