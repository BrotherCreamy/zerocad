# Plan: touch targets that follow the interface size, and less air between tools

**Status: built** (2026-11-06), on `claude/touch-density`; see *As built* at
the end for what was measured, the share chosen and why, the two follow-ups'
causes, the bleed rule added on the way, and every deviation. The owner, from his phone: *"for the
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
- **Bleed only downward** (the owner, iPhone landscape, 2026-11-06: *"when I
  move something up against the left or right edge, it hits an invisible
  edge, but then the padding of the palette expands out to touch the edge
  of the screen. Strange behaviour"*). A pane bleeds only into the bottom
  inset (home indicator, gesture bar); against a side cutout's inset it is
  drawn at its rectangle, the drawing visible beside it. A bled pane never
  draws over another's rectangle — his picture showed the log drawn over
  the command line; find whether that is the bleed or the layout and fix
  it either way.
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

## As built

Built on `claude/touch-density` (2026-11-06), with one item the manager
added from the owner's landscape iPhone (the bleed, below). By file:
`src/panels.ts` (`target`, `TARGET_FLOOR`, `TRAY_SHARE`, `ICON_SHARE`,
`Metrics.base`, `touchMetrics(s, base)`; `bleed` at the bottom only; `refit`
and `REFIT_UNLOCKED_NOTE`, used by `Panels.apply`; the portrait log's width
in `touchLayout`); `src/main.ts` (the base, `--target`, `fitChip` counting a
fading verdict, `ui()` saying the target); `index.html` (every 44 in the
coarse block `var(--target)`, the tree's gap, a faded status out of the
corner's flow); `src/modechip.ts` (the rule, in `fit`'s words);
`src/tools/blend.ts` (the fillet flake's cause); `src/modules/interface.ts`
(`help()`'s `ui()`). Tests: `test/touchdensity.test.ts` (7),
`test/e2e/touchdensity.e2e.ts` (14, and a pictures test under
`NEOCAD_E2E_SHOTS`), one more in `test/solidfillets.test.ts`, two more in
`test/e2e/overlaylock.e2e.ts`, the recorder in
`test/e2e/solidfilletsphone.e2e.ts`, and the suites that knew the old
pixels. Pictures: docs/images/216–223, each looked at.

**The target and the tray, by interface size** (the same on a phone and a
tablet at the default text size: the target is measured against the form
factor, so 100 % is 44 on both; px):

| Size | Target | Tool drawn | Gap | Glyph | Air between glyphs | Option row | Tray thick |
|---|---|---|---|---|---|---|---|
| 60 % | 32 (floor) | 21 | 11 | 16 | 16 | 32 | 29 |
| 70 % | 32 (floor) | 25 | 7 | 19 | 13 | 32 | 33 |
| 80 % | 35 | 28 | 7 | 21 | 14 | 35 | 36 |
| 90 % | 40 | 32 | 8 | 24 | 16 | 40 | 40 |
| **100 %** | **44** | **35** | **9** | **26** | **18** | **44** | **43** |
| 110 % | 48 | 39 | 9 | 29 | 19 | 48 | 47 |
| 120 % | 53 | 42 | 11 | 32 | 21 | 53 | 50 |
| 130 % | 57 | 46 | 11 | 35 | 22 | 57 | 54 |
| 140 % | 62 | 49 | 13 | 37 | 25 | 62 | 57 |
| 150 % | 66 | 53 | 13 | 40 | 26 | 66 | 61 |
| 160 % | 70 | 56 | 14 | 42 | 28 | 70 | 64 |

Before, on a phone: the target 44 at every size; the tool 21 / 26 / 34 px
at 80 / 100 / 130 % in a 44 pitch, its glyph 17 / 21 / 27, so the air
between glyphs was 27 / 23 / 17 px — the tray as long at 80 % as at 100 %,
which is what the owner saw. Now the glyph is 0.6 of the pitch at every
size: the tray keeps its look as it grows and shrinks.

**Menu items, measured** (the owner's complaint; `touchdensity.e2e.ts` on
an iPhone 13, an iPhone SE, a Pixel 7 and a Pixel Tablet, both ways up — the
same on all eight): the long-press menu's item **35 px at 80 %, 44 at 100 %,
57 at 130 %** (it was 44 at all three); the app menu's rows and the spin
box's buttons the target too; every tray button, strip, grip, option row,
✓/✗ and chip part hit over exactly the target.

**The share: 0.8, looked at against 0.75 and 0.85** (iPhone 13, both ways
up, 1× and 3×, the tray with a tool armed). The share moves the tool's
*face* — which shows only on the armed tool, a flyout's current member and a
press — not the glyph, which is 0.75 of the face in all three; what the eye
reads as air between tools is pitch less glyph. At 0.85 (a 37 px face in a
44 pitch) the armed tool's face comes within about 2 px of the tray's
border and two lit faces stand 7 px apart; at 0.75 (33 px) they are 11 px
apart and the tray reads as loose as before. 0.8 is between, and is the
spec's. **What made the tray denser is the glyph growing with the face**
(26 px at 100 % where it was 21); the pitch at 100 % is unchanged, as
specified, so the air between glyphs went from 23 to 18 px there. At 80 %
it is 14 where it was 27.

**The see-through tree's finger gap, rechecked**: half a target, never under
22 px — 22 at 80 % and 100 %, 28.5 at 130 %. The 22 holds at 80 %, where
half a target is 17: the reach of Chromium's touch adjustment is the
fingertip's, not the picture's (every gap to 18 px went to a row, measured
before). Rechecked on an iPhone 13 and a Pixel 7: a finger's tap midway made
a point at all three sizes (`overlaylock.e2e.ts`).

**The verdict is never cut — the cause and the fix.** Picture 196's
`SOLVED 36 free`, half under the chip, was the 0.6 s of its fade:
`ModeChip.fit` counted the verdict as gone the moment it was marked faded,
so the chip took its next step back while the verdict was still drawn,
pushed past the corner's room. Now what is drawn at all (opacity above
nothing) counts, and the chip is fitted again when the fade ends
(`transitionend`). Asserted on **every device in the table, both ways up
(36 ways)**, sampled every frame from the solve until 4.2 s after: the
verdict and its count wholly inside the corner whenever drawn, the chip
whole again after. Also: a faded status now leaves the corner's flow once
its fade is over, so an invisible two-line `ready — …` no longer cuts a
note after it (found by looking at the re-fit picture, 223).

**The phone fillet file's flake — the cause was the app's**, with a second
failure that was the test's. Recorded (wrappers round the recogniser's sink
and the tool's handlers, a push per call, the gesture's timing unchanged;
the recorder stays in the file and prints on failure): in the failing runs
the recogniser made a clean drag, and the tool's drag direction flipped
mid-gesture — `(-0.78, -0.62)` to `(-0.93, 0.38)` — because it was read from
the radius label, which `renderHandle` places again every frame from the
latest kernel preview, and a preview of the new radius can stand it off
another face of the fillet. The same finger's motion turned from "out" to
"in" and the radius fell to its floor (0.02). Whether a preview landed
between two moves is the kernel's timing, so it came and went: 3 failures in
16 runs on the base at load 1.5–2.6. **Fixed by taking the direction at the
press** (`blend.ts`; a unit test reproduces the 0.02 on the old code). The
edge-tap test failed after it because the first test threw with its finger
still on the glass: the next tap was a second finger, a pinch, abandoned.
The finger now comes off in a `finally`. After: 10 runs of the file in a row,
alone, all green (load 1.5–2.6), and again on the final tree (below).

**The bleed — the manager's addition.** The owner, on his iPhone on its
side: *"when I move something up against the left or right edge, it hits an
invisible edge, but then the padding of the palette expands out to touch the
edge of the screen. Strange behaviour"*. Built: a pane bleeds **only into the
bottom inset**; at the sides and the top it is drawn exactly at its
rectangle (`bleed`; `chrome-logo-scale.md` amended). Tested on an iPhone 13
and a Pixel 7 on their sides: the toolbar and the action strip pushed to
each side edge are drawn at the safe area's line, a log in the bottom corner
reaches down only, and no drawn box is over another (pictures 221, 222).

**His first picture's log over the command line's body was not the bleed.**
A bleed reaches only into an inset, where no pane's rectangle is, under the
old rule as under the new; it cannot draw over a neighbour. It was a real
overlap: the places he had left the panes in, re-laid through a rotation,
could not all be had, the resolver found no layout, and `Panels` drew what
it left, with only a console warning. Measured (a scratch fuzz, the
pipeline `Panels.apply` runs): over 2,796 random stored layouts on a
440 × 956 phone, 850 of 5,592 re-layouts found no layout and 844 of those
were drawn with panes over panes. **`refit`**: when the stored places
cannot all be had, those of the panes the failed layout has overlapping are
given up (731 of the 850 fit so), then all — the defaults, which
everything-fits guarantees (the other 119); none was left unfitted. Said
once (*"panels re-fitted to this screen"*), never stored: turning back puts
every pane where it was left (`touchdensity.e2e.ts`, on the fuzz's own
case; unit-tested on it and on a seeded 300).

**Where everything-fits stops now.** With the target growing above 100 %,
option rows and tray pitches are longer there, so the guarantee is shorter:
**120 % everywhere with no tool armed or a drawing tool's options; 110 %
everywhere with a feature's two rows** (`fits.test.ts` holds both). At
120 % a feature's options do not fit an SE in Safari, the 390 and 393 pt
iPhones in Safari's landscape, or a 360 px Android on its side. The largest
step at which the defaults fit (no tool / one row / two rows; the tray's
lines at 100 / 120 / 140 / 160 %):

| Phone | Way up | Page | Area | None | 1 row | 2 rows | Lines |
|---|---|---|---|---|---|---|---|
| iPhone SE | portrait | installed | 375×647 | 120% | 120% | 120% | 1/2/2/2 |
| iPhone SE | portrait | safari | 375×501 | 120% | 120% | 110% | 2/2/2/3 |
| iPhone SE | landscape | installed | 667×375 | 150% | 120% | 120% | 2/2/3/3 |
| iPhone SE | landscape | safari | 667×325 | 130% | 120% | 110% | 2/2/3/3 |
| iPhone 13, 14, 16e, 17e | portrait | installed | 390×763 | 130% | 130% | 130% | 1/1/2/2 |
| iPhone 13, 14, 16e, 17e | portrait | safari | 390×664 | 130% | 130% | 120% | 1/2/2/2 |
| iPhone 13, 14, 16e, 17e | landscape | installed | 750×369 | 150% | 140% | 130% | 2/2/2/3 |
| iPhone 13, 14, 16e, 17e | landscape | safari | 750×321 | 140% | 140% | 110% | 2/2/2/3 |
| iPhone 16, 15, 15 Pro, 14 Pro | portrait | installed | 393×759 | 130% | 130% | 130% | 1/1/2/2 |
| iPhone 16, 15, 15 Pro, 14 Pro | portrait | safari | 393×659 | 130% | 130% | 120% | 1/2/2/2 |
| iPhone 16, 15, 15 Pro, 14 Pro | landscape | installed | 734×372 | 150% | 130% | 130% | 2/2/2/3 |
| iPhone 16, 15, 15 Pro, 14 Pro | landscape | safari | 734×322 | 140% | 130% | 110% | 2/2/2/3 |
| iPhone 17, 17 Pro, 16 Pro | portrait | installed | 402×778 | 130% | 130% | 130% | 1/1/2/2 |
| iPhone 17, 17 Pro, 16 Pro | portrait | safari | 402×681 | 130% | 130% | 130% | 1/2/2/2 |
| iPhone 17, 17 Pro, 16 Pro | landscape | installed | 750×362 | 150% | 140% | 130% | 2/2/2/3 |
| iPhone 17, 17 Pro, 16 Pro | landscape | safari | 756×332 | 140% | 140% | 120% | 2/2/2/3 |
| iPhone Air | portrait | installed | 420×810 | 140% | 140% | 140% | 1/1/2/2 |
| iPhone Air | portrait | safari | 420×719 | 140% | 140% | 130% | 1/2/2/2 |
| iPhone Air | landscape | installed | 776×371 | 150% | 140% | 130% | 2/2/2/3 |
| iPhone Air | landscape | safari | 794×341 | 150% | 150% | 120% | 1/2/2/3 |
| iPhone 16 Plus … 14 Pro Max | portrait | installed | 430×839 | 140% | 140% | 140% | 1/1/2/2 |
| iPhone 16 Plus … 14 Pro Max | portrait | safari | 430×739 | 140% | 140% | 140% | 1/1/2/2 |
| iPhone 16 Plus … 14 Pro Max | landscape | installed | 814×409 | 160%+ | 150% | 150% | 1/2/2/2 |
| iPhone 16 Plus … 14 Pro Max | landscape | safari | 814×359 | 160%+ | 150% | 130% | 1/2/2/2 |
| iPhone 17 Pro Max, 16 Pro Max | portrait | installed | 440×860 | 150% | 150% | 150% | 1/1/1/2 |
| iPhone 17 Pro Max, 16 Pro Max | portrait | safari | 440×763 | 150% | 150% | 140% | 1/1/2/2 |
| iPhone 17 Pro Max, 16 Pro Max | landscape | installed | 832×400 | 160%+ | 160%+ | 140% | 1/2/2/2 |
| iPhone 17 Pro Max, 16 Pro Max | landscape | safari | 838×370 | 160%+ | 160%+ | 130% | 1/2/2/2 |

Android: every way to 120 % with no tool or one row, to 110 % with two;
the 360 px phones on their sides (Pixel 9, Galaxy S23/S24, the Fold 7's
cover) stop at 110 % with a feature. At 100 % everything fits everywhere,
as before. The toolbar's button count per device is unchanged (it is the
tools'); its lines are what the new pitch gives, and the tests read them
rather than hard-coding them.

Deviations and additions — each a decision, vetoable:

- **The target is measured against the form factor, not the whole of
  `deviceScale`.** The spec says `base` is the device's own 100 %
  (`deviceScale`); that includes the person's text size, so a Pixel at a
  130 % system font drew its tray tools no larger than at 100 % —
  `android.e2e.ts`'s "a tool button drawn 1.3 × larger" caught it. Measured
  against the form factor (1.3 phone, 1.15 tablet) the rule is the spec's at
  the default text size, and a larger text size grows targets as it grows
  type, as iOS's own rows do under Dynamic Type.
- **The tool is drawn from the target before its floor**, so at 60 % and
  70 % the tray still shrinks (21 and 25 px) while its hit boxes hold at 32.
  Its glyph is 0.75 of the face (`ICON_SHARE`): a mouse's 16 in 20 would
  crowd the face's border at 35.
- **A layout that does not fit is never drawn while one that does exists**
  (`refit`, above) — the manager's "fix it either way", where the cause was
  not the bleed.
- **A faded status leaves the corner's flow** after its fade (`display` with
  `transition-behavior: allow-discrete`), so a note after it is not cut by
  an invisible verdict. A new verdict appears at once rather than fading in.
- **The portrait log under the action strip takes its own least width** where
  the strip is shorter (below about 80 %, now that the strip's pitch
  follows the size), rather than the layout dropping the organiser under a
  full-width log.
- **`ui()` says the finger's target in force** (`a finger's target 35 px`).
- **The owner's spin box at 60 % and 70 % is held at 32**, as specified; the
  spin box's − and + are 32 there.
- **Left literal, deliberately**: the workbench question's buttons'
  `min-width: 72px` (a word's width, not a target) and the menus' 14 px side
  padding (across, not between items).
- **Tests moved their fixture where the wider tray now stands**: the
  Samsung smoke test's drag started 9 px off the tray's hit boxes at world
  x −40 on a 360 px Galaxy, and Chromium's touch adjustment moved it onto a
  tool; it starts a fingertip clear. The claim is unchanged.
- **The fillet fix is in `blend.ts`**, outside the files this package was
  given; the cause was there.

**Verification as run.** Typecheck 0 before and after. Unit 1622 → 1630
(the base's 1622 after sketch-edit; `touchdensity.test.ts` 7, the fillet
drag 1; the chrome, fits, touch-layout, toolbar-groups and panels-preview
suites' numbers changed claim for claim). Kernel 11/11. E2E 645 → 662
(`touchdensity.e2e.ts` 15 — one of them the pictures, skipped without
`NEOCAD_E2E_SHOTS` — and the two finger-gap rechecks), the files that measure
the chrome run in sets of two or three while building. The full gate
(`npm run test:all`) after merging the working branch, with another
worker's suite on the same four cores (load 8–18): 655 passed, 2 skipped, 5
failed. Each failing file rerun alone: `android.e2e.ts` 14/14 (its Pixel 7
drags, the register's load flake), `solidsphone.e2e.ts` 3/3 (likewise), and
`overlaylock.e2e.ts`, whose failure was the new Pixel gap recheck: its
recorder showed the press going down and up on the canvas with the point
tool armed and no point made — the tap read as a long-press under load, the
register's harness item, whose menu then lay over the next size's midpoint.
The test now asserts what it is about, where the finger's press lands after
Chromium's touch adjustment, and closes a menu a tap opened; 14/14 twice
alone. The phone fillet file passed inside the gate and 10/10 alone on the
final tree (load 2.7–4.7).

Limitations left in place, deliberately:

- **Not tried on a phone.** Every measurement is Chromium's emulation; iOS
  adjusts a touch differently from Chromium, and the tree's 22 px and the
  9 px of drawing beside the tray that now go to a tool are Chromium's.
- **The drawing beside the tray**: a finger landing within about 9 px of it
  is moved onto a tool by Chromium's touch adjustment — 4.5 px further out
  than before, the face being wider in the same pitch.
- **At 130 % and up there is more air between glyphs than before** (22 px at
  130 %, 17 before), because the pitch now grows with the size; the glyph's
  share of the pitch is constant (0.6).
- **The fillet's size label still moves between faces** while its radius is
  dragged — the next preview places it — only the drag's direction is fixed.
- **A larger system text size grows every target**, so at Dynamic Type's
  largest the defaults reach the table's limits sooner.
- **`refit` gives up whole panes' places**, the overlapping ones first; it
  does not search for the largest set of stored places that fits.
