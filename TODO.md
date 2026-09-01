# NeoCAD — todo

The working list, and the project's decision register. `STATUS.md` describes
what exists; `CHANGELOG.md` is what already happened, newest first.

**How work happens here:** the owner sets direction and can veto
anything in the register below. Fable (the managing session) writes the specs
in `docs/plans/`, reviews every diff, and pushes. Opus (the implementing
session) builds from those specs and commits locally. Nothing reaches the
remote unreviewed.

## In flight

- [ ] **Constraint inference** — Opus implementing now, from
      [`docs/plans/onshape-inference.md`](docs/plans/onshape-inference.md).
      A point placed on existing geometry gets the matching constraint
      applied automatically — `coin` on a point, point-on-curve on an edge,
      midpoint on a midpoint — exactly as Onshape/SolidWorks do.
- [ ] **A line tool** — same plan document. Click-click with Onshape-style
      chaining (shared vertices) and horizontal/vertical inference. Somehow
      the most basic sketch tool of all was never built.

## Decisions made so far — veto here if any are wrong

The guiding rule, set by the owner: **tools work like Onshape/SolidWorks, so
people arrive already knowing how to use them.** Deviations from that rule
are flagged as such.

- **Selection:** there is no selection set. Clicking geometry drops its name
  into the command line (cellwork's model — "the viewport is a selection
  portal"). Names are inserted quoted and comma-separated, because commands
  here are function calls: two clicks after `dist(` leave `dist("p1", "p2"`.
- **Mouse:** with a tool armed, the left button belongs to the tool; with
  nothing armed, left-drag pans and left-click picks. Wheel zooms about the
  cursor (scroll up = in). Middle- or right-drag pans; the right-click menu
  is suppressed. ⚠ *Deviation:* Onshape pans with middle only and uses
  right-click for a context menu. When a context menu exists, right-drag pan
  should yield to it; middle-drag stays.
- **Tools do not dimension what they draw.** A rectangle gets `hor`/`ver` on
  its edges but no size; a circle's radius stays free. Matches Onshape's
  undimensioned-sketch behaviour — the user adds `dist`/`rad` when they mean
  it, and undimensioned geometry stays draggable.
- **Snapping and inference share one switch.** Tiers: exact point beats
  midpoint beats along-a-curve (tolerances in screen pixels, cellwork's
  numbers). `snapping(false)` turns off snapping *and* inference, like
  Onshape's inferencing toggle. Inference never merges points — two points,
  one ordinary constraint.
- **Arc tool** is Onshape's *center point arc* (click centre, start, end).
  No 3-point arc yet.
- **Fillet** takes its radius when armed — `arm("fillet", { radius: 8 })`,
  default 10 — and reuses the shared corner as a tangent point so nothing is
  orphaned (there is no delete yet). A miss-click is a miss, not a cancel.
- **Constraints attach to edges, not corner points**, wherever the user means
  an edge (`hor("l1")` rather than `hor("a","b")`) — relations resolve their
  line's endpoints lazily, so they survive a fillet re-pointing the edge.
  Both forms exist; built-in tools use the line form.
- **A saved file is data.** It is the model's journal (the calls that built
  it), replayed on open, and `open()` only runs calls from a fixed table — a
  hostile file can at worst draw something odd. Solved coordinates ride
  along so an under-constrained model reopens exactly as saved.
- **The command line is curation, not a sandbox.** Typed code runs with the
  app's full authority; the scope exists for legibility and typo-catching,
  and says so honestly rather than claiming to be a security boundary.
- **Process:** direct commits to the working branch, pushed after review; no
  PRs (owner's instruction).

## Decisions needed from the owner

- [ ] **May a saved file carry code?** A tool authored at the command line is
      a live JS class; saving it means saving source text that `open()` would
      evaluate — so opening a file someone sent you would run their code.
      Today such tools are simply lost on save (the geometry they drew
      survives). Options: never; save as inert text to paste back by hand;
      or prompt before evaluating.

## Next up

Queue for Opus, in order. Each gets a spec in `docs/plans/` before work
starts.

- [ ] **Dragging geometry** — spec next. Onshape's defining interaction:
      with nothing armed, drag a point and the model follows it while every
      constraint holds (cellwork proved the mechanism: solve with temporary
      soft residuals pulling the point toward the cursor). Needs `Problem`
      to accept temporary residual blocks — a legitimate, geometry-free
      kernel-surface addition.
- [ ] **Undo/redo.** Ctrl+Z is not optional in a CAD tool and nothing has it
      yet. The journal changes the design space (an add can be undone by
      truncate-and-replay; a drag by restoring values) — needs a short
      design pass before speccing.
- [ ] **Constraint visibility and deletion.** Onshape shows constraint
      glyphs and lets you delete one you didn't want; inference makes this
      matter more, since tools now create constraints on the user's behalf.
      Deletion needs `Problem` to support removing residual blocks, and
      entity deletion needs variable compaction — the largest infrastructure
      item on the list, wants a real design doc.
- [ ] **Snap to intersections.** Points, midpoints and along-a-curve are
      done; where two curves cross needs real intersection maths.
- [ ] **Box-select.** With name-based selection this means dragging a box
      inserts several names at once. Wants to follow the drag work.
- [ ] **Saving user-authored tools** — blocked on the owner decision above.

## Smaller things

- [ ] `docs/plans/` specs that have shipped should gain a one-line "shipped"
      note at top rather than being deleted — they are the design record.

## Done

- [x] A working `npm run typecheck`, and three smaller fixes alongside it
- [x] Snapping — a tool's cursor is pulled onto points, midpoints and curves
- [x] The fillet tool — click two edges to round the corner
- [x] Picking and hover — click geometry to drop its name in the command line
- [x] Browser verification in the repo as `npm run test:e2e`
- [x] Contributor docs: CONTRIBUTING, docs/ARCHITECTURE, CLAUDE.md
- [x] Mouse navigation — wheel zooms about the cursor, drag pans
- [x] Save and open as ordinary commands
- [x] The `fillet` operation
- [x] Circle and arc drawing tools
- [x] The REPL — tools and relations authored at the command line
- [x] Viewport control as ordinary commands
- [x] Circle and arc entities
- [x] The rest of the sketch relation vocabulary
