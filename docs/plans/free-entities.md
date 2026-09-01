# Plan: entities defined by constraints, not constructors

**Status: model layer shipped (commit 1 of 2); the command layer waits for
the box-select merge** — only the command layer touches `replenv.ts`, so the
model half carried no conflict risk and went first while Opus capacity was
limit-blocked (2026-09-01). Implemented directly by the supervising session
for that reason; the command layer follows the original worker/PR route.

Owner's direction, quoted because it is the whole requirement: *"need to be
able to define elements by constraints. E.g. the code equivalent of 'create a
circle with: perimeter passing through p1, p2, p3', or 'tangent to L1,
passing through p3, radius d4'. It's weird if you want a circle not defined
by a center and radius but the tool requires it."* And: plain `circle()`
returning a circle with no parameters is fine.

The acceptance examples are therefore literal:

```js
c = circle()
oncircle("p1", c); oncircle("p2", c); oncircle("p3", c)   // the 3-point circle
```
```js
c = circle(); tan("l1", c); oncircle("p3", c); rad(c, "d4-value")
```

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`. No kernel changes.

## The insight the design rides on

Constructor arguments here were never constraints — `circ(center, r)`'s
radius only *seeds* a variable, and `pt(x, y)` pins nothing. The misfit is
solely that the arguments are mandatory. So this package makes **every
constructor argument optional**; whatever is missing is auto-created free
with a sensible seed. Nothing about existing calls changes meaning, and old
files replay untouched.

## Design

### Model layer

- `addCircle(center?, radius?, name?)` — no center: auto-create a real,
  named point entity (visible, draggable, dimensionable — tools set this
  precedent with the rectangle's corners); no radius: seed a library default
  (10). Explicit radius keeps its `> 0` validation.
- `addPoint(coords?, name?)` — no coords: seed at the origin (the command
  layer improves this, below).
- `addLine(a?, b?, name?)` — missing endpoints auto-created, and seeded
  **apart** (e.g. 20 units): a zero-length line has no direction, and half
  the relation vocabulary (`tan`, `par`, `ang`) divides by that direction's
  length. A degenerate seed must be impossible, not discouraged. Test it.
- `addArc(center?, start?, end?, radius?, name?)` — auto pieces seeded as a
  non-degenerate quarter arc. `arcends` stays the caller's call, exactly as
  it is for the explicit form: structure vs equations is the house split.

**Journal discipline — the PR #3 trap, named:** each constructor journals as
*its own call with the args as given* and re-expands deterministically on
replay; the auto-created sub-entities must NOT journal individually
(suppress recording inside, the way operations already do). A round-trip
test proves a `circle()`-then-constrain model reopens byte-identical, and
that auto-names stay deterministic.

### Command layer (`replenv.ts`)

- All creator commands take their existing args optionally: `pt()`, `ln()`,
  `circ()`, `arc()`.
- **Long-name aliases**: `point()`, `line()`, `circle()` beside the short
  forms — the owner's examples use `circle()`, and `arc` already proves a
  creator function and a tool name coexist (bare word arms the tool, a call
  is an expression; both already true today).
- **Default seeds come from the view centre** when a view handle exists —
  a free circle materialising off-screen at the origin is baffling — with
  the model's plain defaults as the headless fallback. The model never
  learns about the view; the command layer passes coordinates down.

### What this does not change

The pointer tools. Drag-centre-to-rim is the right *pointer* gesture and is
Onshape's own. This package is command-surface freedom; a 3-point-circle
TOOL becomes a trivial composition afterwards and goes on TODO as enabled,
not built.

### Honesty about multiple solutions

Tangent+point+radius admits up to four circles; the solver lands on the
branch nearest its seed, and dragging flips branches — Onshape's behaviour.
Say this in the CHANGELOG rather than letting someone read branch choice as
nondeterminism. The 3-point circle is unique; test it against the
closed-form circumcircle, exactly, not "solved: true".

## Verification

E2e: both owner examples typed verbatim (modulo names) — the 3-point circle
landing on the closed-form circumcircle of three fixed points to 1e-6; the
tangent+point+radius circle satisfying all three (distance-to-line = r,
through-point on rim, r exact). A free `line()` made tangent to two circles.
Unit: every constructor's zero-arg and partial-arg forms; degenerate-seed
impossibility for lines/arcs; journal round-trips per above; view-centre
seeding (and headless fallback). Everything downstream — glyphs, hover,
`rels()`, `del` cascade, undo — must be *confirmed* to just work on
auto-created pieces, not assumed. Full `npm run test:all` per commit.
Screenshots (next free numbers) carrying their own evidence: the three fixed
points, `circle()` typed, the three `oncircle`s, the circle threading them —
with `rels()` in frame. Docs duties per `CLAUDE.md`; the decision register
gains this package's entry.

## Delivery

Two commits ((1) model layer + journal discipline + units; (2) command layer
+ e2e + docs). PR workflow: isolated worktree, branch `claude/free-entities`
off the working-branch tip after box-select merges, PR against the working
branch. Do not merge; the supervising session reviews.
