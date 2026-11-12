# Plan: a tool says how to use it — on hover, and on a phone when it is chosen

**Status: queued** (2026-11-12). The owner, asked to try the conflict fix:
*"I don't even know how to add a parallel relation. Maybe a little tooltip
should pop up when I hover over (desktop) or select (phone) a tool."*

## What is true today

`src/tooltip.ts` (`tooltips-rgb-frames.md`, built 2026-11-04): a control's
name, one line of what it does (`static summary`), and the command it types.
A mouse sees it after a short hover. **A finger sees it only by holding the
button** — which nobody discovers — and a tap arms the tool silently. The
tip says what a tool *is*, not what to *do*: the constrain tool's does not
say "tap two lines, then choose Parallel". There is no Parallel button; a
relation is reached by arming Constrain (or selecting and long-pressing),
then choosing from the constraints palette (#88), which on a phone shows the
likeliest row and "N more…".

Read `CLAUDE.md`, `docs/plans/tooltips-rgb-frames.md`, `mode-feedback.md` or
its successor (the chip that says the next step), `constraints-palette.md`,
`everything-fits.md` (room on a phone), `src/tooltip.ts`, `src/panels.ts`,
`src/tools/tool.ts` and every tool's `static summary`, `src/constraints.ts`.

## Design

1. **Every tool declares how it is used** (`static how`): the steps, in the
   words of someone doing it, three lines at most, by finger where that
   differs. Constrain: *"Tap the things to relate — two lines, a line and a
   circle… Then choose from the list: Parallel, Perpendicular, Equal,
   Tangent…"*. Dimension, trim, extrude, cut, edge, revolve, fillet,
   chamfer, sketch, every curve tool and its methods, select and the hand:
   all of them, written by reading what the tool actually does, each checked
   by doing it in the browser.
2. **On a phone, choosing a tool shows its tip**: name, what it does, how.
   It appears as the tool arms, clear of the finger and of the drawing's
   middle, takes no touch (taps pass through to what is under it), and goes
   at the first touch on the drawing or after a few seconds. Holding a
   button still shows it without arming. The second time in a session the
   same tool is chosen, only the how line shows, briefly; a setting
   (`ui({ tips: false })`, and a row in the app menu) turns the on-choose
   tip off. Decide the timings by trying them on the iPhone 13 profile and
   say them in the register.
3. **On a desktop, hover as today**, with the how lines added.
4. **The parallel case, end to end**: with the constrain tool armed and two
   lines tapped, Parallel is one tap away on an upright iPhone. Fix the
   wasted row filed in TODO (*The phone palette wastes a row*, review of
   #88: the fit budget in `src/constraints.ts` `sync` leaves a blank row, so
   one applicable row shows where two fit) as part of this.
5. **The empty palette teaches**: armed with nothing picked it already says
   "pick what to relate"; make it say what can be picked and what will be
   offered, in a line.

## Tests

- Unit: every registered tool has a `how`; the tip's text for a tool; the
  pass-through; the setting.
- E2E, iPhone 13 and mouse: tap Constrain, the tip is up and says how; tap
  two lines through it; Parallel pressed from the palette without opening
  "more…"; the lines are parallel. Hover on a desktop. The tip never covers
  the tapped tool's own options pane. LOOK at every picture, and read the
  how lines as someone who has never used the app.

## Docs

CHANGELOG top quoting the owner; STATUS; the register (timings, the
second-time rule, the setting); `help()`; the TODO item ticked; the spec
marked built.
