# Plan: Onshape-style constraint inference (and a line tool)

**Decision, made by the project owner:** there is no "weld" concept —
no mainstream CAD program has one. Tools behave like Onshape/SolidWorks so
people already know how to use them. When a sketch tool places a point on
existing geometry, it creates its own point *and applies a constraint* tying
it to what it snapped to. Two points remain two points, joined by an ordinary
`coin` — "you can make any two points coincident if you want" is already the
vocabulary; the tools just apply it automatically. Onshape calls this
**inferencing**; SolidWorks calls it **automatic sketch relations**. Use the
word *inference* everywhere; retire *weld* from the repo entirely.

This document is the implementation instruction. Before writing anything,
read `CLAUDE.md`, then `docs/ARCHITECTURE.md`. The verification rules there
are not optional; six of this project's bugs passed the whole unit suite and
were caught only by running the app and looking at it.

## The behaviour being matched

In Onshape, while sketching:

- Click an existing **point/vertex** → your new point gets a **coincident**
  constraint to it. Drag either later and they move together.
- Click on an **edge** → your new point gets a coincident-with-curve
  constraint (point stays on that line/circle).
- Click a line's **midpoint** marker → a **midpoint** constraint.
- Draw a line roughly horizontal or vertical → a dashed guide shows, and the
  committed line gets a **horizontal**/**vertical** constraint.
- The inference is visible *before* the click (markers/guides), and the
  resulting constraints are ordinary constraints the user could have applied
  by hand.

neocad already has the snap detection (`src/snapping.ts`, kinds `point` /
`midpoint` / `curve`, with on-screen markers) and all of the relations. What
is missing is the step where the tool *applies* the relation at commit.

## Part 1 — inference on commit

### Mechanism

1. **`PointerInfo` gains `snap?: Snap`** (`src/tools/tool.ts`). The engine
   already computes the snap and swaps the world coordinate
   (`src/tools/engine.ts`, in `dispatch`); it now also attaches the `Snap` it
   used. Tools that ignore it behave exactly as today.

2. **A placement helper** — `placePoint(ctx, info, name?)` in a new
   `src/tools/place.ts` (or beside `tool.ts`; your judgement). It creates the
   point at `info.world` and, if `info.snap` is present, applies the inferred
   relation:

   | snap kind | target entity | relation applied |
   |---|---|---|
   | `point` | a point | `coincident(new, target)` |
   | `midpoint` | a line | `midpoint(new, line)` — **line form, see below** |
   | `curve` | a line | `pointOnLine(new, target)` |
   | `curve` | a circle or arc | `onCircle(new, target)` |

   Inference is downstream of snapping, so `snapping(false)` turns both off —
   one switch, like Onshape. No separate toggle.

3. **`midpoint` needs a line form.** Today it is point-form only
   (`mid(m, a, b)`), which captures the endpoints' indices — the same trap
   `hor`/`ver` already escaped. Add the one-argument-after-the-subject form
   `midpoint(model, mName, lineName)` that resolves the line's endpoints
   lazily (`lineVars`/`joinVars` in `src/relations/geometry.ts` show the
   pattern; the relation itself lives in `basic.ts`). Keep the point form.
   Mirror how `horizontal` handles recording both arities so save/open
   replays the form that was called. Register nothing new in
   `src/persist.ts` — `midpoint` is already in the replay table — but **test
   the round trip for both forms**.

4. **Tools use the helper.** Point, rectangle, circle (its centre), and arc
   (centre, start, end — the end's `ontoRim` projection happens after
   inference-from-snap; if the third click snapped to something, prefer the
   snap). The rectangle keeps `PointerInfo` (or at least the snap) from
   `onDown` rather than only `p.world`, so the first corner's inference
   survives to commit in `onUp`. Its two *derived* corners get no inference —
   nothing was clicked there. The fillet tool picks entities rather than
   placing points; it is untouched.

### The acceptance test that defines done

Draw rectangle A. Draw rectangle B by dragging from A's corner (aim a few
pixels off; the snap catches it). Then move that corner of A and solve.
**B's corner must follow.** Before this change it demonstrably does not —
two points sit at the same coordinates, unconnected, and dragging one leaves
the other behind. Write this as an e2e test with a real mouse drag, and also
as its unit-level twin.

Also cover: inferred constraints appear in the journal and survive
save/open byte-for-byte re-save; `snapping(false)` produces no constraint;
each snap kind maps to the right relation (unit tests on `placePoint`);
a solve after inference reports SOLVED, not CONFLICT, for the plain
rectangle-on-rectangle case.

## Part 2 — a line tool

There is no plain line tool — point, rectangle, circle, arc, fillet, but not
the most basic tool in any sketcher. Add `src/tools/line.ts`, registered as
`line`, Onshape-shaped:

- **Click, click, chaining.** First click sets the pending start (commit
  nothing yet — an abandoned first click leaves no stray point). Second click
  commits: start point, end point, the line, and any inferred constraints for
  both ends. The chain continues — the committed end point *is* the next
  segment's start (the same entity; no constraint needed, it is literally
  shared, exactly like Onshape's chained vertices). `Escape` /
  `onCancel` ends the chain; committed segments stay.
- **Horizontal/vertical inference.** While the preview is within ~3° of an
  axis, draw the preview exactly on the axis with a dashed guide, and on
  commit apply `hor(line)` / `ver(line)` — the **line form**, so the
  constraint survives a later fillet. Precedence: an endpoint snap beats H/V —
  if the end lands on a snapped point, take the snap and drop H/V unless the
  snapped position happens to still satisfy it.
- Preview in the established style (dashed, `#e8a33d`, from the tool's own
  state in `render()` — see `rectangle.ts`).

Unit tests at the tool level (see `fakeCtx` in `test/sketch.test.ts`) and e2e
with real clicks: a chained L of two segments; H/V inference applying `hor`;
the chain sharing its middle vertex (drag it — both segments follow); Escape
ending the chain cleanly.

## Constraints on the work

- **No kernel changes.** Inference is relations being applied by tools;
  `src/kernel/` has no reason to change. If you find yourself in there, stop
  and reconsider.
- **No point merging.** Two points, one constraint. Merging entities is a
  different feature (deletion territory) and is not this.
- Relations record themselves (`model.record`) — the new `midpoint` line form
  must too, or it silently vanishes on save. `CLAUDE.md` lists the other
  silent traps; read it.
- Follow the docs rules in `CLAUDE.md` when done: tick `TODO.md`, add the
  `CHANGELOG.md` entry at the top (with a screenshot of inference visibly
  working — and *look* at the screenshot), update `STATUS.md`, add the
  reasoning to `CONVERSATION_LOG.md`'s Log section (newest first).

## Sequencing

Two commits, each fully verified (`npm run test:all`) before the next starts:

1. Inference: `PointerInfo.snap`, `placePoint`, the `midpoint` line form,
   existing tools converted, tests.
2. The line tool with H/V inference, tests.

Commit locally with messages that explain reasoning (see `git log` for the
house style). Do not push — the supervising session reviews and pushes.
