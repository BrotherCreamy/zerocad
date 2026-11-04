# Plan: everything fits — a second toolbar row, the organiser shown, and nothing over anything

**Status: queued** (2026-11-04). The owner, asked whether a landscape phone's
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
