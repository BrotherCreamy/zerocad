# Plan: the 3-point circle tool

**Status: shipped, pending review** (2026-09-01). Built as specified in one
commit on `claude/circle3-tool`, with one deliberate deviation: the circle's
centre is seeded at the **circumcentre** rather than at the three clicks'
centroid. The closed form was already in the file for the preview and the
collinearity test, so seeding at the exact answer serves the reason the spec
gave for the centroid — "the solver deserves to start near the answer" —
better than an approximation of it, and costs nothing. What else was decided
and discovered is in `TODO.md`'s Done entry; the behaviour is in `STATUS.md`.

The composition the free-entities package promised: Onshape's *3 point
circle* as a pointer tool. Three clicks on three positions; a circle through
them. No new model or solver work — the tool is `circle()` plus three
`onCircle`s, which is the entire point of having made that expressible.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`, then
`docs/plans/free-entities.md` (the enabler) and `src/tools/circle.ts` +
`src/tools/arc.ts` (the house patterns for a click-sequence tool).

## Design

- `arm("circle3")` — Onshape calls the tool *3 point circle*; `circle3` is
  the name that is also a legal identifier. New file `src/tools/circle3.ts`,
  registered with `defineTool` in-file plus the one import line in
  `main.ts`, exactly like every existing tool.
- **Each click places a real point** through `placePoint` — so snapping and
  constraint inference apply to every one of them, identically to the other
  tools: click on an existing point and the new rim point is coincident with
  it; click on a line and it is `on` it. This is what makes the tool
  compose: 3-point circle through two existing corners is just three clicks,
  no special case.
- After the third click: one `circle()` (free, per the free-entities
  package), three `onCircle`s, one solve, `ctx.finish()`. The circle's
  centre seed matters — seed it at the three clicks' centroid (pass it as
  the constructor's centre-point coordinates through the ordinary optional
  argument, or set it after; whichever reads cleaner) rather than letting it
  default to the view centre: the solver deserves to start near the answer,
  and a seed on the wrong side of three near-collinear points picks a wild
  first step.
- **The whole gesture is one user action** — the commit happens in one
  entry, so one undo removes circle, rim points and relations together, the
  same shape the rectangle tool set.
- Live preview: after two clicks, draw the dashed circumcircle through the
  two placed points and the cursor where one exists (the three points
  determine it unless collinear; fall back to nothing when they are —
  a preview that lies is worse than none). `intersect.ts` and the house
  closed-form style say how to write this; keep the circumcircle helper in
  the tool, it is preview-only.
- Collinear third click: refuse the commit (log why, stay armed) rather
  than solving a circle that cannot exist. A near-collinear commit is the
  user's to make; exact-degenerate (below the closed form's epsilon) is not.

## Verification

Unit: three clicks make one circle + three points + three `onCircle`s and
journal as those calls; the gesture is one undo step; collinear refusal.
E2e: three clicks on empty canvas → circle through all three to 1e-6
(compare against the closed-form circumcircle, the free-entities house
standard); a 3-point circle clicked through an existing snapped point picks
up the inferred coincidence (`rels()` shows it); undo removes the lot.
Screenshots at the next free `docs/images/` numbers with their own evidence.
Full `npm run test:all` per commit. Docs duties per `CLAUDE.md`; tick the
enabled-not-built entry in `TODO.md`'s queue and the free-entities Done note.

## Delivery

Isolated worktree, branch `claude/circle3-tool` off the working-branch tip,
PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews. Expected footprint: `src/tools/circle3.ts` (new), the one
import line in `src/main.ts`, tests, docs. If you find yourself editing
`engine.ts`, `replenv.ts` or `operations.ts`, stop and say why in the PR
instead: two sibling packages are in flight in those files.
