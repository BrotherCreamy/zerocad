# Plan: touch targets that follow the interface size, and less air between tools

**Status: queued** (2026-11-06), next. The owner, from his phone: *"for the
scaling, the text resizes but the spacing between e.g menu items and toolbar
items barely changes. Not sure why. There must be some scaling you're
missing. Also in general the white space between eg the tools on the tool
palettes is a bit too much"*.

## What is true today (measured)

Under a finger, every target has a fixed 44 px minimum that ignores `--ui`:

- **Tray pitch** is `max(button + gap, TOUCH_TARGET)` (`panels.ts`,
  `coarseMetrics`: `gap: max(m.gap, TOUCH_TARGET − m.button)`), so at a
  phone's 100 % a button is drawn 26 px with an 18 px gap — the 44 is made of
  air. Measured pitch by interface size: 80 % → 35, 100 % → 44, 130 % → 57.
- **Menu items, menu rows, choices, the spin box, organiser rows, strip hit
  boxes, the chip's buttons** carry `min-height:44px` (or `max(…,44px)`) in
  `index.html`'s coarse-pointer block — literal pixels, so shrinking the
  interface shrinks the type and leaves the rows where they were.
- `optionRow` and `line` are floored at 44 the same way (`coarseMetrics`).

Read `CLAUDE.md`, `chrome-logo-scale.md` (the per-device 100 % and why 44),
`everything-fits.md`, `toolbar-groups.md`, `mode-feedback.md` (the chip's
rule that the verdict is never cut), `android.md` and
`panels-overlay-lock.md` as built (Android rows; the see-through finger gap of
22 px, measured against Chromium's touch adjustment), `src/panels.ts`
(`FINE`, `COARSE`, `scaledMetrics`, `coarseMetrics`, `TOUCH_TARGET`),
`src/uiscale.ts`, `index.html`'s coarse-pointer block, `src/modechip.ts`,
`src/statusline.ts`, `test/devices.ts`, and the chrome, fits, touchlayout,
toolbargroups, tooltips and touch tests.

## Design

- **One target size, scaled.** `TOUCH_TARGET` becomes a function of the
  interface size: `target(m) = round(44 × m.scale ⁄ m.base)`, where `base`
  is the device's own 100 % (`deviceScale`, 1.3 on a phone, 1.15 on a
  tablet), so **at the device's 100 % it is still 44** (Apple's and
  Google's minimum is met where the owner hasn't chosen otherwise), at 80 %
  it is 35, at 130 % 57. Every literal 44 in `index.html`'s coarse block
  becomes `var(--target)`, set beside `--ui` in `main.ts`. A floor of 32 px
  holds at the small end (below it a fingertip misses), stated and tested.
- **Less air: draw the tool larger in its target.** Under a finger, a tray
  button is drawn at about 0.8 of the target (35 px at 100 %, icon 26),
  leaving a 9 px gap instead of 18; option rows and menu items keep their
  target height and their type stays the type it is. The whole tray gets
  shorter by nothing (the pitch is unchanged at 100 %) — what changes is
  that the tools fill it. Look at it at 1× and 3× and say whether 0.8 is
  right; 0.75 and 0.85 are the alternatives.
- **Desktop (`FINE`) unchanged** but for the gap: 2 px between 20 px buttons
  is right for a mouse; leave it.
- **The see-through tree's finger spacing** follows the target too (its 22 px
  gap was measured against Chromium's touch adjustment at 44; recheck it at
  80 % and at 100 %, and keep whatever clears the adjustment).
- **The verdict is never cut** (owner-visible, found in
  `panels-overlay-lock.md`'s iPhone picture 196: `SOLVED 36 free` a
  half-height third line under the chip on an upright iPhone). Mode feedback
  hides the chip's next step only for ~3 s after a solve; it must stay hidden
  for as long as the verdict needs the line. Assert on every device in the
  table that the verdict's box is wholly inside the corner after the 3 s.
- **The phone fillet file's two touch tests** (`solidfilletsphone.e2e.ts`,
  the held radius-label drag and the edge tap) now fail alone at load ~3 in
  2 of 4 runs on the branch and 1 of 4 on base — not load. Find out why
  (record the gesture recogniser's decisions and the engine's picks for the
  failing runs without changing their timing), fix the cause wherever it is
  (test or app), and say which. No retries.
- Everything-fits holds at every size on every device; the toolbar's button
  count on each device is whatever the new pitch gives, and the fits tests say
  so rather than hard-coding a count where the pitch changed.

## Tests

Unit: `target(m)` at 60–160 % on each form factor (44 at each device's 100 %,
the 32 floor); the tray pitch and drawn size; `optionRow` and `line` from the
target. E2E (iPhone 13, iPhone SE, Pixel 7, a tablet; portrait and
landscape; 80 %, 100 %, 130 %): every hit box equals the target; a menu
item's height follows the size (the owner's complaint, measured); the tray's
drawn button is the 0.8 share; the verdict wholly visible after the chip's
3 s; the fits suite; the fillet phone file 10 runs in a row alone, green.
LOOK at each picture at 1× and 3× — this package is about how dense the
chrome looks.

## Docs

CHANGELOG at the top quoting the owner; `chrome-logo-scale.md`'s 44 rule
amended (the target follows the size, 44 at the device's 100 %); the
register (the scaled target, the 32 floor, the 0.8 share) as vetoable;
STATUS; `help()`'s `ui()` paragraph; the spec marked built with the
deviations.
