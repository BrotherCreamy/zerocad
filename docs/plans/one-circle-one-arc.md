# Plan: one Circle tool and one Arc tool — the method read from the gesture

**Status: queued** (2026-11-04), after `frameless-curves.md` (built). The
owner: *"why are there multiple circle tools and arc tools? they all achieve
the same thing. surely just one tool, but different ways to set
constraints. think about how to do this."*

Today there are four: `circle` (centre, drag the radius), `circle3` (three
points on the rim), `arc` (centre, start, end) and `arc3` (start, end, a point
on it). Each makes the same entity; they differ only in **which constraints
the clicks create**.

Read `CLAUDE.md`, `effortless.md`, `circle3-tool.md`, `arc3-tool.md`,
`frameless-curves.md`, `tool-options.md`, `onshape-inference.md` (as built),
`src/tools/circle.ts`, `circle3.ts`, `arc.ts`, `arc3.ts`, `place.ts`,
`src/tools/options.ts`, `src/snapping.ts`, and their tests.

## Design

- **One `circle` tool**, the gesture deciding:
  - **press and drag** — centre, then radius (today's `circle`);
  - **three separate clicks** — a circle through the three points
    (today's `circle3`); the first click is a provisional centre-or-rim
    point, and the second click (rather than a drag) settles it as a rim
    point;
  - **clicking on existing geometry** while placing a rim point makes the
    circle **tangent** to that line or circle (a tangent relation, visible and
    deletable) — the "different ways to set constraints" the owner named.
- **One `arc` tool**: **drag from start to end, then move to set the bulge and
  click** (three-point, today's `arc3`); or **press on a point first and hold
  still** to make it the centre, then start and end (today's `arc`). Tangent
  on existing geometry as for the circle — an arc starting at a line's end
  tangent to it is the common case; offer it by snapping.
- **The options panel shows the method it read** (`centre · radius`,
  `3 points`, `tangent`) as a choice the user can **lock** — typed as
  `arm("circle", { method: "3pt" })` — remembered like any option.
- `circle3` and `arc3` **stay as typed names** that arm the one tool locked
  to that method, so old habits, scripts and files keep working; the toolbar
  shows one of each (11 buttons, not 13).
- Drawn on the face under the cursor or the work plane, held by the
  frameless relations (`frameless-curves.md`).

## Tests

Unit: each gesture's constraints (centre+radius; three on-circle points;
tangent to a line; to a circle); the method lock; `circle3`/`arc3` arm the
locked tool. E2E (mouse and iPhone 13): each gesture draws the right circle or
arc with the right relations; the panel names the method; the toolbar has
one of each; every existing curve test passes (update counts and the tools
removed from the toolbar, keep claims). LOOK at each.

## Docs

CHANGELOG at the top quoting the owner; the register (one tool each, the
gesture decides, lockable; the old names stay as typed shortcuts) as
vetoable; STATUS; README; `help()`; the spec marked built.
