# Plan: everything fits — a second toolbar row, the organiser shown, and nothing over anything

**Status: built** (2026-11-04), on `claude/everything-fits`; see *As built*
at the end for the device table, where the guarantee stops, and every
deviation. The owner, asked whether a landscape phone's
toolbar should wrap or fold: *"Second row.... everything has to fit"*; asked
whether the organiser should show from the start on a phone: *"show from
start"*. This **reverses** the earlier "no resizing, one line" rule for the
tray (`tray-fixed-line.md`) where a line does not fit — record that.

Known overlaps to remove (from the last four packages' reports and
screenshots): a 13-button landscape row and the log overlap by 9 px with no
report (`select-hand.md`, *Limitations*); the status pill covers the command
line's strip in landscape until it fades, and `● g1` permanently
(`chrome-logo-scale.md`, `organiser.md`); a held tooltip on a phone covers the
toolbar buttons below it (`tooltips-rgb-frames.md`); a pane docked against a
tray that turned in a rotation can hang off the tray's corner.

Read `CLAUDE.md`, `tray-fixed-line.md`, `panels-push.md`,
`chrome-logo-scale.md`, `select-hand.md`, `organiser.md`,
`tooltips-rgb-frames.md` (all as built), `src/panels.ts` (`traySize`,
`touchLayout`, `defaultLayout`, the resolver, docking), `src/statusline.ts`,
`src/tooltip.ts`, `src/organiser.ts`, `index.html`'s corner, and the panels,
touch, chrome, organiser and tooltips tests.

## Design

- **The tray wraps when a line does not fit.** A tray is one line when it
  fits along its edge; when it does not, it takes a **second line** (and a
  third, if the interface size makes even two too long), buttons in the same
  order, filling line by line. Its hit boxes stay 44 px apart under a finger.
  It never scrolls and never hides a tool. Typed (`layout()`) and saved like
  any layout; docking through rotation keeps working with the new size.
- **"Everything has to fit" is a rule the layout guarantees**, not a hope: at
  the default interface size, on every iPhone size from the SE (375 × 667)
  to the Pro Max (440 × 956), in both orientations, installed (no Safari
  bars) and in Safari, **the default panes overlap nothing** — no pane over
  another, none over the logo's row. Where the resolver finds no layout it
  must say so in development (an assertion the tests trip), never draw one
  pane over another silently. At larger interface sizes the same holds as
  far as the screen allows; say where it stops and what gives (the log
  shrinks to its least, a tray wraps again) — never an overlap.
- **The organiser shows from the start on a phone** (reverse
  `hiddenAtFirst`), in a place where it fits in both orientations by the rule
  above; still hideable from the app menu.
- **The corner never sits on a pane.** The status, the step note, the open
  group and *Update ready* are laid out as part of the layout — the logo's
  row is a region panes do not enter, or the corner's text wraps and stops
  short of the first pane — so in landscape the command line's strip is
  never covered.
- **A held tooltip never covers the control's own neighbours**: beside a
  vertical tray (on the drawing's side), above or below a horizontal one,
  clear of the finger; the action strip's top-right case included.
- **A pane docked against a tray keeps lying along it** after the tray turns
  or wraps in a rotation — no hanging off a corner.

## Tests

Unit: `traySize` wraps by available length (one, two, three lines) at every
interface size; the fit rule for every iPhone size and orientation at the
default size (a table-driven test over the device list — no overlaps, nothing
off screen, nothing in the logo's row); the resolver's failure is reported.

E2E (iPhone 13 and SE emulation, both orientations, with real safe-area
insets): no two visible panes' rectangles intersect, none covers the corner;
the landscape tray is two rows; the organiser is visible at first start; a
held tooltip on a tray button does not cover the next button; docking through
rotation still holds. Every existing test passes. LOOK at each device and
orientation.

## Docs

CHANGELOG at the top quoting the owner; the register (the tray wraps when a
line will not fit — revising `tray-fixed-line.md`; everything fits, enforced;
the organiser shown on a phone) as vetoable; STATUS; the spec marked built.

## As built

Built on `claude/everything-fits` (2026-11-04). By file: `src/panels.ts`
(`trayLines`, `traySize`'s room and floor of lines, `trayRoom`, `linesOf`,
`Placed.lines`, `cornerBox`, `cornerRoom`, `layoutProblem`, `fittedAt`, the
phone's defaults in `touchLayout`, `relaid` wrapping instead of turning and
keeping a pane along a tray, `Panels`' `onShow` and its report of a layout
it cannot find, `hiddenAtFirst` removed); `src/tooltip.ts` (`tipPlacement`'s
`line`, `AttachOptions.line`); `src/main.ts` (the corner placed from the
layout, the organiser no longer hidden on a phone); `index.html` (the tray a
grid of `--per` buttons a line, the corner clipped to its room). Tests:
`test/devices.ts` (the device table), `test/fits.test.ts` (34),
`test/e2e/fits.e2e.ts` (7), and the suites that knew the old layout.

**The device table** (`test/devices.ts`, every number's source there): the
SE (375 × 667), the 390 × 844 notch (13, 14, 16e, 17e), 393 × 852 (16, 15,
15 Pro, 14 Pro), 402 × 874 (17, 17 Pro, 16 Pro), the Air (420 × 912),
430 × 932 (16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max) and 440 × 956 (17 Pro
Max, 16 Pro Max). Points and insets from Use Your Loaf's iPhone 17, 16 and
14 posts (read off the simulator; iOS 26 gives the 17s a 20 pt landscape
status bar), Safari's page from Playwright's device descriptors — the SE's
estimated, Playwright having none that is Safari's.

**Where the guarantee stops** at larger interface sizes (the spin box's
steps, the device's 100 % times 1.0 … 1.6, `fits.test.ts` holds it to 120 %
everywhere): with no tool armed, nowhere up to 160 %. With an options panel
(1 row: a drawing tool; 2 rows: a feature), the SE in Safari to 120 % in
portrait and 130 % in landscape, the SE installed to 150 % / 160 % in
portrait and 140 % / 160 % in landscape; the 390, 393 and 402 pt phones
installed in portrait to 150 %, in Safari's landscape to 150 % with a
feature; every larger phone past 160 %. **What gives, in order:** the tray
takes another line (the trays wrap by the area's room, so a larger button
wraps sooner); the organiser shrinks to its least (its height in portrait is
what is left above the drawing's middle, in landscape what is left of the
right column); the log is always at its least on a phone. **What stops it**
is the options panel: at 150–160 % it is wider than the room right of the
tray, or taller than the room between the panes. Past that the resolver
finds no layout and `layoutProblem` says so — an error on the page in
development (which every e2e test's "no page errors" trips), a console
warning in a built page — and the panels are drawn where the resolver left
them.

Deviations and additions — each a decision, vetoable:

- **A tray's lines are a floor it asks for, `Placed.lines`, as well as what
  the room forces.** The spec says "one line when it fits along its edge".
  A landscape phone's tray *fits* along the bottom edge (599 of 750), but
  the default puts a column of panes down the right edge — the strip, the
  log and the organiser, which needs the height — and asks the tray for the
  fewest lines that fit *left of it*: two. Asked-for lines are stored with
  a tray the viewer moves, until it turns (a new shape, its fewest again),
  so a moved tray does not unwrap on the next layout and push its
  neighbours. Absent means one.
- **The room is the area's, less the logo's corner** (`trayRoom`), the same
  wherever the tray is, so a drag never wraps or unwraps a tray on the way —
  only a turn, a rotation, a new tool or a new interface size re-sizes it.
  On a desktop that is the window less 40 px; nothing changes there unless
  the window is under ~350 px tall.
- **"The logo's row" is the corner's box**: the logo and 120 px (at 100 %)
  of status beside it (`cornerBox`), which no default pane enters. In
  portrait the defaults leave the whole row empty (the strip moved down
  under it); in landscape, where height is what there is least of, the
  command line and the strip share the row beyond the corner's box. The
  corner's text wraps inside the room the panes leave it (`cornerRoom`) —
  the whole row in portrait, about 150 px in landscape — and is clipped
  rather than drawn past it; a pane the viewer drags into the row cuts it
  shorter still. Both of the spec's "or"s, then.
- **The phone's portrait default moved**: the action strip and the log
  under it are below the logo's row (52 px down at 100 %, was 8); the log
  is the strip's width, not the screen's; **the organiser sits beside them,
  right of the tray** (121 × 183 on a 390 pt phone installed, 121 × 150 in
  Safari), held in the top third of the height, above where a drawing starts
  (`UPPER`; at 40 % it lay over the corner of a rectangle the touch suite
  draws) — the touch suite's rectangle is
  drawn round the middle, and the organiser's old place, over the middle's
  right half, covered it. Where the screen is too narrow for it beside the
  strip (the SE, and any phone at a large interface size), it goes under the
  log instead, as wide as there is, at its least height (73 px: its strip
  and one row) — and on the SE in Safari that is over the top of the
  drawing's middle.
- **The phone's landscape default moved**: the command line out of the top
  left and into the top row beyond the corner's box; the strip, the log and
  the organiser a column down the right edge, the organiser to the bottom
  margin (176–230 px tall); the tray two rows along the bottom left (one on
  the Pro Max, whose 605 px room fits 599). The options panel goes above the
  tray, as before.
- **A tray wraps in a rotation where it used to turn** (`relaid`): a column
  down a portrait phone laid on its side is a column of two or three lines
  against the same edge, not a row. The old turn is what left the 151 px.
- **A pane beside a tray lies wholly along it after a rotation** when it is
  the shorter of the two, and covers it when it is the longer — not "held
  overlapping by a pixel". This also applies to a pane the viewer left
  partly past a neighbour's end: it is pulled back along it on the next
  rotation.
- **A held tooltip keeps off the whole tray**, every line of it, not only
  its own button: beside a column (the side with more room), above a row
  under a finger (below a row with no room above — the action strip at the
  top), below a row under a mouse. A mouse's tip beside a column is 4 px
  further out than before (the tray's padding and border).
- **`layout()` says a wrapped tray's lines** (`toolbar  8,291  335x78  row
  ×2`); the panel carries `data-lines` for the tests.
- **The resolver's failure is reported in a built page too**, as a console
  warning, not only in development.
- **`hiddenAtFirst` is gone**, not left idle: no pane starts hidden anywhere.
  A viewer who had ticked the organiser on (`hidden: false` stored) is
  simply shown it; one who hid it keeps it hidden.
- **The docking e2e here is about the rotation, not the gesture**: it stores
  a docked layout and rotates; the gestures that dock are `chrome.e2e.ts`'s,
  unchanged. It docks to the left edge: a tray docked to the right edge of a
  landscape phone meets the default right column, which the resolver pushes
  out of its way, and the log with it — sound, but not the docking under
  test.

- **Tests changed their fixture or their claim where the claim was the old
  rule**: `touch.e2e.ts`'s portrait defaults (the organiser among the panes,
  the strip under the logo's row instead of at y 8); `organiser.e2e.ts`'s
  phone test (shown at the start, hidden and shown again from the menu,
  where it asserted hidden at first); `selecthand.e2e.ts` starts its
  one-finger orbit at world (60, 40), not (60, 60), which is now under the
  strip-wide log; `touchlayout.test.ts`'s portrait and landscape defaults
  (rewritten for the new places); `chrome.test.ts`'s "a tray that no longer
  fits turns" is now "wraps", with a new test of a pane lying along a tray
  that wrapped; `panels.test.ts`'s "a tray too long is clipped" is now
  "wraps onto more lines"; `tooltips.test.ts`'s finger case split into a
  control on its own (above the finger, as before) and a tray's (beside a
  column, above or below a row, never over the tray).

**Where it stops, by phone** (`fits.test.ts` checks 120 % everywhere; the
largest step of the spin box at which the defaults fit — no tool armed / a
drawing tool's one-row options / a feature's two — and the tray's lines at
100 / 120 / 140 / 160 % with no tool armed):

| Phone | Way up | Page | Area | None | 1 row | 2 rows | Lines |
|---|---|---|---|---|---|---|---|
| iPhone SE (2nd, 3rd gen) | portrait | installed | 375×647 | 160%+ | 160%+ | 150% | 2/2/2/2 |
| iPhone SE (2nd, 3rd gen) | portrait | safari | 375×501 | 160%+ | 120% | 120% | 2/2/2/2 |
| iPhone SE (2nd, 3rd gen) | landscape | installed | 667×375 | 160%+ | 160%+ | 140% | 2/2/2/2 |
| iPhone SE (2nd, 3rd gen) | landscape | safari | 667×325 | 160%+ | 130% | 130% | 2/2/2/2 |
| iPhone 13, 14, 16e, 17e | portrait | installed | 390×763 | 160%+ | 150% | 150% | 1/1/1/1 |
| iPhone 13, 14, 16e, 17e | portrait | safari | 390×664 | 160%+ | 160%+ | 160%+ | 1/1/2/2 |
| iPhone 13, 14, 16e, 17e | landscape | installed | 750×369 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone 13, 14, 16e, 17e | landscape | safari | 750×321 | 160%+ | 160%+ | 150% | 2/2/2/2 |
| iPhone 16, 15, 15 Pro, 14 Pro | portrait | installed | 393×759 | 160%+ | 150% | 150% | 1/1/1/1 |
| iPhone 16, 15, 15 Pro, 14 Pro | portrait | safari | 393×659 | 160%+ | 160%+ | 160%+ | 1/2/2/2 |
| iPhone 16, 15, 15 Pro, 14 Pro | landscape | installed | 734×372 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone 16, 15, 15 Pro, 14 Pro | landscape | safari | 734×322 | 160%+ | 160%+ | 150% | 2/2/2/2 |
| iPhone 17, 17 Pro, 16 Pro | portrait | installed | 402×778 | 160%+ | 150% | 150% | 1/1/1/1 |
| iPhone 17, 17 Pro, 16 Pro | portrait | safari | 402×681 | 160%+ | 160%+ | 160%+ | 1/1/1/2 |
| iPhone 17, 17 Pro, 16 Pro | landscape | installed | 750×362 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone 17, 17 Pro, 16 Pro | landscape | safari | 756×332 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone Air | portrait | installed | 420×810 | 160%+ | 160%+ | 160%+ | 1/1/1/1 |
| iPhone Air | portrait | safari | 420×719 | 160%+ | 160%+ | 160%+ | 1/1/1/1 |
| iPhone Air | landscape | installed | 776×371 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone Air | landscape | safari | 794×341 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max | portrait | installed | 430×839 | 160%+ | 160%+ | 160%+ | 1/1/1/1 |
| iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max | portrait | safari | 430×739 | 160%+ | 160%+ | 160%+ | 1/1/1/1 |
| iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max | landscape | installed | 814×409 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone 16 Plus, 15 Plus, 15 Pro Max, 14 Pro Max | landscape | safari | 814×359 | 160%+ | 160%+ | 160%+ | 2/2/2/2 |
| iPhone 17 Pro Max, 16 Pro Max | portrait | installed | 440×860 | 160%+ | 160%+ | 160%+ | 1/1/1/1 |
| iPhone 17 Pro Max, 16 Pro Max | portrait | safari | 440×763 | 160%+ | 160%+ | 160%+ | 1/1/1/1 |
| iPhone 17 Pro Max, 16 Pro Max | landscape | installed | 832×400 | 160%+ | 160%+ | 160%+ | 1/2/2/2 |
| iPhone 17 Pro Max, 16 Pro Max | landscape | safari | 838×370 | 160%+ | 160%+ | 160%+ | 1/1/2/2 |

Limitations left in place, deliberately:

- **On an SE in Safari** (an estimated page) the organiser is at its least
  and lies over the top of the drawing's middle; the SE installed has 78 px
  of it. Small screens get a small organiser.
- **The corner's room in landscape is about 150 px**: "ready — type
  help(), a tool name, or any expression" wraps onto four lines (it fades in
  3 s), and a tool's guidance onto several. Where a pane the viewer has
  dragged leaves it less, the text is clipped.
- **Not tried on an iPhone**: the table's Safari pages are Playwright's
  measurements of older iOS versions, and iOS 26's floating tab bar may
  give a page more or less than that; the installed app's area is
  arithmetic from the insets.
- **Dynamic Type above the default** multiplies the device's 100 % (up to
  1.5×): at the largest text sizes the defaults are at the limits above.
