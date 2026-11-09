# Plan: the app under fingers — an iPhone first

**Status: built** (2026-11-04, branch `claude/touch`; see *As built* at the
end, which lists every deviation). The owner, verbatim: *"it should work on a
multi-touch device. Specifically I have an iPhone. Think about how best to do
that."* Sibling of [`pwa-pages.md`](pwa-pages.md), which owns the document
head, viewport and no-scroll/no-zoom rules. Read `CLAUDE.md`,
`docs/plans/effortless.md`, `src/tools/engine.ts` (every pointer path: tool
gestures, drag, box, pan, orbit, right-press menu, hover, snapping),
`src/main.ts` (the keydown listeners, the command line's focus handling,
undo/redo, the status note), `src/panels.ts` (strips, grips, the tray, the
options panel), `src/menu.ts`, `src/picking.ts` and `src/snapping.ts` (their
pixel radii), `src/quiet.ts` (hover reveal), `index.html`'s CSS, and the e2e
harness.

## What a finger cannot do, and what replaces it

The app is built for a mouse and a keyboard: right-drag orbits, middle-drag
pans, the wheel zooms, a right-release opens the menu, hover reveals quiet
geometry, shift adds to a selection, and Enter, Escape, Delete and Ctrl+Z are
keys. The mapping, after Onshape and Shapr3D on iPhone and iPad:

| Mouse / keyboard | Finger |
|---|---|
| left click | **tap** (one finger, moves under a slop of ~8 px, lifts within ~350 ms) |
| left drag with a tool armed | **one-finger drag** — the tool's own gesture |
| left drag on an entity | **one-finger drag** on it — moves it |
| left drag on empty canvas (box) | **long-press, then drag** — the box |
| right drag (orbit) | **one-finger drag on empty canvas**, nothing armed |
| middle drag (pan) + wheel (zoom) | **two fingers**: the centroid pans, the spread zooms about it, both at once |
| right-click menu | **long-press** (~500 ms, still) — the menu at the finger |
| shift-click (add) | **tap toggles** an entity in or out once something is selected; tap on empty clears |
| hover (quiet geometry, the hover tag) | **while a finger is down** near it, and **selected** things |
| Enter / Escape | the options panel's ✓ / ✗, already there |
| Ctrl+Z / Ctrl+Y / Delete | **an action strip**: Undo, Redo, Delete selection, Cancel — a small panel like any other |

In 2D (no orbit), a one-finger drag on empty canvas pans. Two-finger twist is
ignored, not misread as anything. A third finger cancels the gesture in
progress. Mouse and keyboard keep working unchanged on the same build: the
paths branch on `pointerType`, never on a device guess.

## Design notes

- **One gesture recogniser** in the engine for touch pointers, tracking
  pointers by id, deciding tap / drag / long-press / two-finger within the
  slop and the times above, and feeding the engine's existing paths — so a
  tool sees the same `onDown`/`onMove`/`onUp` it sees from a mouse. Pointer
  capture per finger. A second finger arriving mid one-finger gesture cancels
  that gesture cleanly (a half-drawn rectangle is dropped, not committed) and
  becomes a pan/zoom.
- **A finger is coarse**: pick and snap radii scale up for touch (measure: a
  fingertip covers ~7–10 mm; Apple's HIG target is 44 pt), and the snap marker
  and the tool's preview stay visible under the finger — draw the snap marker
  and the active point offset above the contact when the finger covers it, or
  a small loupe; choose and say why.
- **Targets of 44 pt** under `@media (pointer: coarse)`: tray buttons, panel
  strips and grips, the options panel's fields and ✓/✗, menu items, the
  action strip.
- **The keyboard stays away until asked for**: on a touch device the command
  line is not focused on start or after a pick (iOS would raise the keyboard
  over the drawing); tapping it focuses it, as any field. Printable-key
  routing to the command line applies to a hardware keyboard only.
- **Layout on a phone** (portrait ~390×844, landscape): defaults that fit —
  the log collapsed to a one-line panel the user can enlarge, the command line
  at the top; per-viewer layout and pushing unchanged. Safe areas from
  `pwa-pages`. *Corrected as built:* this said "the tray as a row along the
  bottom above the home indicator, the action strip beside it", which fits
  **landscape only** — eleven tools at 44 px are a 556 px row, and the phone
  is 390 wide in portrait, where the tray is a column down the left and the
  strip a row at the bottom right.
- **Quiet geometry**: a finger down reveals what is under and near it, as
  hover does; lifting ends it, except for what is selected.

## Verification

Playwright Chromium with iPhone 13 emulation (`hasTouch`, `isMobile`, the
device's viewport and scale) and multi-touch through CDP
`Input.dispatchTouchEvent` (two touch points): tap selects; tap toggles; tap
on empty clears; one-finger drag draws a rectangle with the tool armed;
one-finger drag on empty orbits in 3D; two-finger pan and pinch move and zoom
the view about the centroid; a second finger mid-draw drops the rectangle;
long-press opens the menu at the finger; long-press-drag boxes; the action
strip's Undo, Redo, Delete and Cancel; the extrude dialog end to end by finger
(pick, ✓); the command line not focused after a tap on the canvas; targets at
least 44 px in coarse mode. **The real device is iOS Safari, which this
machine cannot run** (only Chromium is installed): say so in the PR and the
CHANGELOG, and list what the owner should try on his iPhone. LOOK at the
phone-sized screenshots in both orientations. Full `npm run test:all` with a
long timeout. Docs per `CLAUDE.md`: CHANGELOG at the top quoting the owner;
the register (the finger mapping as a decision he can veto); STATUS; README's
how-to-use section; `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/touch` off the working-branch tip, one PR
against `claude/resume-tasks-o7q02e`, in two reviewable commits (the gesture
recogniser and the action strip; then coarse sizing, layout and the keyboard).
Do not merge; the supervising session reviews. Stay out of the document head
and the no-scroll CSS (`pwa-pages` owns them).

## As built (2026-11-04)

Branch `claude/touch`. What differs from the text above, and why. The text
above was corrected where it was wrong about the code (the portrait tray).

- **The recogniser** is `src/tools/gestures.ts`: pure, an injected clock, no
  DOM. The engine routes every `pointerType === "touch"` event to it and feeds
  its gestures down the mouse's paths (`toolEvent`, `idlePress`/`idleMove`/
  `idleRelease`, `onContextMenu`, the view). **A tool's press is held** until
  the finger moves past the slop (and is then delivered where it landed) or
  lifts, so a pinch that starts as one finger never reaches the tool. A second
  finger mid-draw **re-arms the tool** (`arm` again, as undo does: a feature
  `retune`s and keeps its picks). A long-press that then moves withdraws the
  menu (`onContextMenuWithdrawn`) and boxes. A finger's box adds, as shift-box
  does.
- **Radii: one factor, `TOUCH_REACH` = 22/8 = 2.75**, on every pick and snap
  tier. A point is then a 44 pt target. Glyph boxes are not widened: they
  would cover the line they sit 7 px from.
- **Lifted mark, not a loupe.** The faces are WebGL with no copy of the last
  frame to magnify. A disc 56 px above the active point carries the snap's
  mark and name (or a cross), with a dotted leader down to the place.
- **Portrait: the tray is a column down the left, not a row along the
  bottom.** Eleven 44 px buttons are 556 px and the phone is 390 wide. The
  options panel has a portrait default above the action strip: beside the
  column it hung over the middle of the drawing. Landscape is as specced.
- **The action strip is a tray**, shown only under `(pointer: coarse)`. Its
  Cancel types `cancel()` (tool and selection together), since there is no
  typed Escape and a feature has ✗ for the step-at-a-time.
- **Sizes**: one `Metrics` value (`FINE`, `COARSE`) threaded through
  panels.ts's pure functions, picked once at load from `(pointer: coarse)`,
  the stylesheet's own query.
- **Two listeners the PWA package might have expected to own**, both on the
  canvas and both pointer handling: `touch-action: none`, which the engine
  sets, and a cancelled `touchend`, which stops the compatibility click. That
  click landed on the menu a long-press had just opened, and ran its first
  item.
- Tests: `test/gestures.test.ts` (15), `test/touch.test.ts` (16),
  `test/touchlayout.test.ts` (7), `test/e2e/touch.e2e.ts` (17), with iPhone 13
  emulation in the harness (`openApp({ device })`) and CDP multi-touch
  (`test/e2e/fingers.ts`). **Not run on iOS Safari**; the CHANGELOG lists what
  to try on the device.
