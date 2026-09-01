# Plan: constraint glyphs on the canvas

**Status: shipped, pending review** — branch `claude/constraint-glyphs`, PR
against `claude/resume-tasks-o7q02e`. Built as specced; the symbol table was
re-judged in a browser as the spec asked, and the deviations are listed at the
bottom under "What shipped differently, and why".

The follow-up the relation registry (PR #3) exists to make
possible. Onshape shows every sketch constraint as a small glyph beside the
geometry it constrains; you hover one to see what it is and click it to act on
it. That is the behaviour being matched — it is how a user discovers the
constraints inference created on their behalf without knowing to hover the
right entity.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`. No kernel changes; no model
changes beyond reading the registry PR #3 added. This is a rendering and
picking package.

## Design

### What a glyph is

One small marker per relation, drawn near the geometry it constrains, in a
rounded box the same visual family as the hover tag. Content is a short
symbol; proposed table, but the implementer owns legibility and must judge it
from screenshots, not from the code:

| relation | symbol | anchored to |
|---|---|---|
| `coin` | `◦` | the constrained point, offset |
| `hor` / `ver` | `—` / `\|` | the line's midpoint, offset perpendicular |
| `par` / `perp` | `∥` / `⊥` | each line's midpoint (one glyph per line) |
| `ang` / `eq` | `∠` / `=` | each line's midpoint |
| `mid` | `∴` | the constrained point |
| `on` / `oncircle` | `◦` | the constrained point |
| `rad` | `r` | the rim, upper right |
| `eqrad` / `conc` | `=` / `◎` | each rim / the centre |
| `tan` | `⌒` | nearest rim point to the line |
| `fix` | `⚓` or `#` | the point, offset |
| `sym` | `⇋` | each mirrored point |

If a symbol renders poorly in the app's monospace stack, substitute a letter
and say so in the CHANGELOG — a crisp `H` beats a tofu box.

### Placement and crowding

Anchors are computed in world space, offset in *screen* space (constant pixel
offset at any zoom, like every tolerance in this codebase). Multiple glyphs
sharing an anchor stack in a row. This will still crowd on a busy drawing;
that is acceptable for v1 and `glyphs(false)` exists — do not build a layout
engine. Default is **on**, as in an Onshape sketch.

### Interaction

Glyphs join the existing model, inventing nothing:

- **Hover** a glyph → it highlights, the hover tag names the relation
  (`r5  coin p5 p3` — `describePick` for relations), and the entities it
  constrains highlight too. That last part is the payoff: hover `⊥` and see
  *which two* lines it means.
- **Click** a glyph → its name drops into the command line, exactly like
  clicking geometry. `del(` + click + `)` remains the whole deletion flow.
- Glyphs are the **top picking tier** (they are small and deliberate to aim
  at; a glyph you cannot click because a point is near it defeats the
  feature). They do not participate in snapping — they are UI, not geometry.

Mechanics: a `src/glyphs.ts` that, given model + view, yields
`{ relation, screen, symbol }[]`; the engine's hit-testing consults it ahead
of `hitTest` when glyphs are on; main.ts renders them after entities and
before the tool overlay. The engine's `hover` type widens to carry a relation
pick — follow the types, everything downstream is a switch.

### Command surface

`glyphs()` reports on/off; `glyphs(false)` / `glyphs(true)` sets. On
`help()`. Per-relation or per-kind hiding is not v1.

## Verification

E2e that defines done: draw two rectangles sharing an inferred corner; the
`coin` glyph is present; hovering it highlights **both** rectangles' shared
corner points and names `r-whatever coin`; clicking it puts the name in the
command line; `del` of that name makes the glyph disappear from the canvas
(assert via the glyph list, not pixels); Ctrl+Z brings it back. Plus:
`glyphs(false)` empties the layer and disables glyph picking (a click lands
on whatever is underneath); a `hor` glyph hover highlights its line; glyph
tier beats a nearby point.

Unit tests on `src/glyphs.ts` placement (anchor choice per relation kind,
stacking, screen-space offsets under zoom). Full `npm run test:all` per
commit. Screenshots (18+) that carry their own evidence — a constrained
drawing wearing its glyphs, and a hover frame showing the highlight spread.
Look at them; glyph legibility is precisely the kind of thing only looking
catches. Docs duties per `CLAUDE.md`.

## Delivery

PR workflow: isolated worktree, branch `claude/constraint-glyphs` off the tip
of `claude/resume-tasks-o7q02e`, PR against the working branch, three commits
((1) glyphs.ts + placement units; (2) engine/main wiring + picking; (3) e2e +
docs). Do not merge; the supervising session reviews.

## What shipped differently, and why

**The symbol table.** The spec said the implementer owns legibility and must
judge it from screenshots. Every candidate was rendered at the real 12px in a
headless Chromium and inspected enlarged, and every one of them was checked for
tofu by bitmap identity against `U+FFFF` (advance width is useless for this in
a monospace stack — everything present or absent measures the same). Four
changes came out of that:

1. **`coin` is `○`, not `◦`.** `◦` (U+25E6) is a *tiny* ring — at 12px it is
   two pixels across and reads as dirt on the screen. `coin` is far and away
   the most common relation, because it is the one inference produces, so it
   gets the crispest mark in the set.
2. **`on` / `oncircle` are `●`, not `◦`.** The spec's table gave `coin` and
   `on` the same symbol, which cannot be right — they are different claims and
   both are common. A point *lying on* something is a filled dot on that thing;
   a hollow ring is two points sharing one place.
3. **`fix` is `#`, not `⚓`.** The anchor does render (it is not tofu, which
   was the risk the spec named) but it is the densest mark in the set and
   turns to mush at 12px. `#` is crisp. The spec offered both.
4. **`sym` is `⇌`, the standard equilibrium arrow, rather than `⇋`.**

Two relations were missing from the spec's table and needed marks, since a
relation that drew nothing would look like a constraint that does not exist:
`dist` (`↔`, anchored between its two points) and `arcends` (`●` on each
endpoint — it is literally two `onCircle`s, so it takes their mark).

Everything else is as specced: `— | ∥ ⊥ ∠ = ◎ ⌒ r ∴` all render and all read.
`◎` for `conc` is the muddiest of the survivors — at 12px the inner dot is
barely a pixel — but it only ever appears at a circle's centre, where nothing
it could be confused with appears, and the hover tag names it regardless.

**A generic fallback for relations this file has never heard of.** Relations
are extensible at runtime, so an op with no entry in the table anchors on the
first entity it names and takes the op's first letter as its mark. Not in the
spec, but a user-authored relation drawing nothing would have been a hole in
the feature rather than a simplification of it.

**Glyphs are computed fresh every frame, not cached.** There is no moment at
which a cache could be invalidated honestly — a drag moves geometry without
touching the model's structure, and a solve moves it without calling into the
engine at all. It is a few arithmetic operations per relation next to a solve.

Not done, deliberately, and all of it already named as out of scope above:
per-relation or per-kind hiding, a leader line from a mark to its geometry, and
any kind of layout pass. Crowding is real on a busy drawing and `glyphs(false)`
is the v1 answer to it.
