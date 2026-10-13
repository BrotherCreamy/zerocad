# Plan: 3D phase 3 — closed loops, and clicking inside one

**Status: built** (2026-10-13) — see the register's 3D entry in `TODO.md`
for what was decided along the way, including the one deviation (arcs are
exact in the inside test rather than sampled). Third package of
[`3d-roadmap.md`](3d-roadmap.md); the owner's fork decided this package's
shape up front: **extrude profiles are auto-detected closed loops**, with
the Onshape gesture — click *inside* a region to pick it. Read the
roadmap, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `src/curveplane.ts` and
`src/arcgeom.ts` (phase 2's planar machinery), `src/intersect.ts`, and
`src/boxselect.ts` (the house pattern for a pure
question-about-the-drawing module).

Nothing in this package extrudes. It answers two questions exactly, so
phase 4 can consume the answers: **"what closed loops does this drawing
contain?"** and **"which loop is under this click?"**

## Design

### `src/loops.ts` — pure, like boxselect

- **A loop** is a cycle of lines and arcs in one plane, joined end to end.
  Joined means: consecutive curve endpoints are the SAME point entity, or
  two point entities held together by a `coin` relation (read the relation
  registry — a drawing made with the tools joins by coincidence
  inference, and ignoring `coin` would make most real sketches
  undetectable). Proximity alone joins nothing: two endpoints that merely
  sit on the same spot are not joined, because nothing holds them there —
  state this rule in the module header, it is the package's honesty line.
- **Coplanar** means: every segment endpoint and every arc's plane lies in
  one plane, within a stated tolerance; an arc's own frame must agree with
  the loop's plane (its +z parallel to the loop normal). A full circle is
  a loop by itself.
- `findLoops(model): Loop[]` where a `Loop` carries its plane (origin +
  unit normal + in-plane axes derived from a member or the matching
  frame), its ordered members with directions, and its signed area (for
  orientation and for inside-tests). Edge walk: build the adjacency graph
  of joined endpoints, then extract **minimal cycles** (a figure-eight is
  two loops, not one; an outer boundary with an inner island is two loops
  — do not try to classify holes in this package, just report every
  minimal cycle; phase 4 decides what nested loops mean for a profile,
  and the spec for it will say "a loop containing another is a face with
  a hole" — your data structure should make that determinable, i.e.
  report containment between coplanar loops).
- `loopAt(model, view, sx, sy): Loop | null` — the click-inside test:
  cast the pixel ray, intersect each loop's plane, point-in-polygon
  (arcs sampled, the curveplane machinery) in that plane, nearest-plane
  wins among hits (the camera-facing-most). Pure screen-space tolerance
  only for the degenerate edge-on case: a plane seen edge-on offers no
  inside and is skipped (state it).

### Surface

- `loops()` at the command line: lists loops (`loop of l1,l2,l3,l4 in f1,
  area 1200`) — read-only, no names claimed, no journal (a loop is a
  *question*, not an entity; phase 4's extrude will take a loop by its
  member names or a click).
- Picking integration, minimal: this package does NOT change click
  behaviour anywhere (a click inside a region currently picks nothing and
  must continue to — box select and the menu depend on empty-canvas
  presses). `loopAt` is exercised by tests and by phase 4's extrude tool,
  not wired to the idle click.
- Rendering: nothing. Loops are invisible until a feature consumes one.

## Verification

Unit (the bulk of the package): rectangle = one loop; filleted rectangle
(lines + arc) = one loop through the arc; two rectangles sharing an edge =
two minimal cycles, shared edge in both; figure-eight = two; circle = one;
rectangle with island circle = two loops with containment reported;
coincidence-joined versus merely-touching endpoints (the honesty line);
non-coplanar near-loop rejected; arcs with disagreeing frames rejected;
loop plane/area/orientation closed-form. `loopAt`: center click, hole
click (inner loop wins where contained — nearest wins is not enough, say
the rule), edge-on skip, miss. E2e: draw with the real tools (rectangle
tool, fillet) on a tilted frame, `loops()` reports the one loop; a probe
page call to `loopAt` under a real click position. Screenshots only if a
story needs one. Full `npm run test:all` per commit. Docs duties per
`CLAUDE.md`; roadmap phase 3 marked; register entry for the joined-means-
coincident rule.

## Delivery

Isolated worktree, branch `claude/3d-phase3-loops` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews. Expected footprint: `src/loops.ts` (new),
`replenv.ts` (the `loops()` listing), tests, docs — if you find yourself
editing the engine, picking or rendering, stop and say why in the PR.
