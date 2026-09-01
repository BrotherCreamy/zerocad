# NeoCAD — todo

The working list, and the project's decision register. `STATUS.md` describes
what exists; `CHANGELOG.md` is what already happened, newest first.

**How work happens here:** the owner sets direction and can veto
anything in the register below. Fable (the managing session) writes the specs
in `docs/plans/` and reviews everything; Opus (the implementing session)
builds from those specs. As of the kinematic-drag package, each work package
runs in an **isolated worktree on its own branch and arrives as a PR against
the working branch** — Fable reviews on the PR (a review comment plus merge,
or plus close; GitHub does not allow formally approving a PR opened under
your own identity), so the review record is visible on GitHub rather than
buried in a chat log. Parallel workers only ever get disjoint specs; the e2e
runner claims a private port per run so a suite can never silently test
another worktree's code. `main` stays untouched until the owner says
otherwise.

## In flight

- **Box select + live solve** ([`docs/plans/box-select.md`](docs/plans/box-select.md))
  — an Opus worker was mid-implementation when it hit the account's monthly
  spend limit (2026-09-01, resets 11:50 UTC). Its partial work is intact in
  its worktree; Fable will resume the same worker after the reset rather
  than restart. Last state: implementation done through the drag register
  change, updating the picking e2e test that asserted the old behaviour.
- **Standing duty**: after every merged PR, run `npm run build:single` and
  republish `dist-single/neocad.html` to the owner's review artifact
  (same URL each time).

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
  orphaned. (That was originally because there was no delete; it is still the
  right shape, since a fillet that stranded points would leave stray dots for
  the user to clean up by hand.) A miss-click is a miss, not a cancel.
- **Deleting:** `del(name)` takes one name and cascades the way Onshape does
  — a relation takes nothing with it, a point takes what references it, a
  curve takes its relations but not its points. **No confirmation prompt:**
  `del` is one user action, so undo is the confirmation, which is the pattern
  `open()` already set. Deleted variables are tombstoned rather than
  compacted; the leak is documented in `STATUS.md`.
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

- [ ] **Box-select.** With name-based selection this means dragging a box
      inserts several names at once. Wants to follow the drag work.
- [ ] **Saving user-authored tools** — blocked on the owner decision above.

## Smaller things

- [x] `docs/plans/` specs that have shipped gain a one-line "shipped" note
      at top rather than being deleted — they are the design record.
- [ ] **A relation added from the command line leaves the header stale.**
      `dist("a","b",50)` adds the residual and redraws, but does not solve, so
      the status can still read `SOLVED` while the drawing plainly violates
      what was just typed until someone calls `solve()`. Found while setting
      up the glyph screenshots, and only by looking at the picture. The right
      fix is probably the one `del` already uses — re-solve through the host
      — but "which commands are edits" is exactly the enumeration `main.ts`
      has so far avoided having to write, so it wants a moment's thought
      rather than a reflex.

## Done

- [x] **Snap to intersections** — spec:
      [`docs/plans/intersection-snap.md`](docs/plans/intersection-snap.md),
      now marked shipped-pending-review. Crossings slot between exact points
      and midpoints in the snap tiers; `src/intersect.ts` holds the three
      closed forms and the arc-sweep test, which moved down out of
      `picking.ts` so snapping and picking cannot disagree about where an arc
      stops. The point of the feature is the inference: a point placed on a
      crossing gets BOTH on-curve relations, so it rides the intersection when
      either curve moves. Marker is an ×; `Snap.target` became
      `Snap.targets: string[]`.
      *Decided while doing it:* the algebra is in **screen space**, not world
      space — every caller asks in pixels (the prefilter distance, the 8px
      tolerance, picking's screen-angle sweep test), the view transform is
      affine with a uniform scale so the exact screen crossing maps back to the
      exact world crossing, and world space would have meant a second angular
      convention for the one test that must not have two. And degeneracy is
      judged in **pixels between the two candidate roots** (`TANGENT_EPS`,
      0.05px) rather than on a zero discriminant: a tangency the solver
      actually holds has residual ~1e-11 but root separation ~1e-3 px, so an
      exact test never fires.
      *Rejected:* keeping a `target` field alongside `targets` as a
      compatibility shim. Four call sites, and two fields that can disagree is
      a worse trade than a rename.
      *Left in place deliberately:* the along-a-curve tier still treats an arc
      as its whole circle, as it always did — only crossings are gated by
      sweep. Snapping along a rim is more forgiving than picking one, and
      tightening it was not in this spec.

- [x] **Constraint glyphs** — spec:
      [`docs/plans/constraint-glyphs.md`](docs/plans/constraint-glyphs.md),
      now marked shipped-pending-review. One mark per relation beside the
      geometry it constrains (`src/glyphs.ts` computes the placements and
      nothing else — no canvas, no pointer, no state); hovering one names the
      relation on the hover tag *and* lights up every entity it constrains;
      clicking one drops its name into the command line exactly as clicking
      geometry does. Glyphs are the top picking tier, above points, and take
      no part in snapping. Anchors are world-space, offsets screen-space;
      marks sharing an anchor stack in a row and there is no layout engine.
      `glyphs()` / `glyphs(true|false)` on `help()`, default on.
      *Decided while doing it:* the spec's symbol table was re-judged in a
      browser at real size, as the spec asked — `coin` moved from `◦` to `○`
      (`◦` is two pixels across and reads as dirt), `on`/`oncircle` from `◦`
      to `●` (the spec gave them the same mark as `coin`, which cannot be
      right), `fix` from `⚓` to `#`, and `dist`/`arcends` gained marks they
      were never given. Tofu was ruled out by bitmap identity against a
      codepoint no font has; **advance width cannot detect it in a monospace
      stack**, where present and absent measure identically.
      *Discovered while doing it:* a relation typed at the command line does
      not re-solve, so the header can go on reading `SOLVED` while the drawing
      violates the constraint just added — the stale-readout family this
      project has been bitten by before. Pre-existing and untouched here (it
      is why `del` re-solves through the host), and it is listed under
      "Smaller things" below.
      *Left for later, deliberately:* per-relation and per-kind hiding, leader
      lines from a mark to its geometry, and any real layout pass. Crowding on
      a busy drawing is genuine and `glyphs(false)` is the v1 answer to it.
- [x] **Relation identity + deletion with cascade** — spec:
      [`docs/plans/constraint-deletion.md`](docs/plans/constraint-deletion.md),
      now marked shipped-pending-review. Relations are registry entries named
      `r1`, `r2`, … built by one wrapper (`model.relation`) that every
      function in `relations/` is a single call to; `Problem.addResidual`
      returns a monotonic `BlockHandle` and `removeBlock` spends it (the only
      kernel change); `del(name)` deletes an entity or a relation with
      Onshape's cascade and returns what it took; deletions journal as
      `deleteEntity` / `deleteRelation`, one per name; `rels()` and `del()`
      are on `help()`; the hover tag names the relations on whatever is under
      the cursor. Variables are tombstoned rather than compacted, and the leak
      is documented in `STATUS.md` and pinned by tests.
      *Discovered while doing it:* `concentric` and `arcEndpoints` are written
      in terms of `coincident` and `onCircle`, and **both** calls journalled —
      so reopening a file containing either quietly applied the inner
      constraint a second time. Nothing caught it because the round-trip tests
      compare entities and coordinates, and a duplicated identical residual
      only doubles a weight that is already satisfied. The registry made it
      unignorable (two entries cannot both own the same blocks), and the fix
      is that a relation defined in terms of another is *one* relation.
      Also found: a relation that throws part-way has to roll back its blocks
      *and* the name counter, or a replay — which performs only the calls that
      succeeded — names everything after it one step out.
      *Left for later, deliberately:* variable compaction (remapping every
      captured index list inside every closure is a different piece of work
      with a different risk profile); constraint glyphs on the canvas, which
      are the follow-up above; and `del` of several names at once, which wants
      box-select more than it wants a signature change.
- [x] **Undo/redo** — Ctrl+Z / Cmd+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo,
      `undo()`/`redo()` do the same through the same host handles. A stack of
      whole-model snapshots (`src/undo.ts`, cap 100, pushing clears redo),
      where a snapshot is the text `save()` writes — it already carries the
      journal *and* the values, already restores through `open()`, and compares
      as a string. Journal-truncation undo was considered and rejected: a drag
      is not journalled, so it would need value snapshots as well.
      One step is one *user action*, decided in `main.ts` by comparing the
      snapshot before and after — nothing lists which commands are edits, so
      `ls()` and `help()` stay out of the history by arithmetic rather than by
      enumeration. The engine gained one neutral callback,
      `onUserAction("before"|"after")`, and still has no idea undo exists.
      *Discovered while doing it:* the pairing of that callback has to be the
      engine's job, not the host's, because only the engine knows every way a
      gesture can end — released, cancelled with Escape, or abandoned because
      the model was swapped out mid-drag. An unpaired `before` strands the
      host's bracket with no symptom until the *next* action silently goes
      unrecorded, which is the kind of bug that is found weeks later. Also
      found while in there: a drag whose model is swapped out from under it
      wrote to a cleared `idle` on the next pointer move — a live TypeError,
      now fixed.
      *Left for later, deliberately:* history is per-session and is **not**
      saved, so a reopened file starts with an empty stack; restoring replays
      the whole model, so undo costs what opening the file costs (fine at
      present sizes — measure before optimising); a view change is not undoable,
      the view not being part of the model; and while the command input holds
      uncommitted text Ctrl+Z belongs to the browser's text undo, not the model.
- [x] **Dragging geometry** — with nothing armed, press a point and pull; the
      model follows the cursor while every constraint holds. `Problem.solve()`
      takes `extra?: ResidualBlock[]`, temporary residuals evaluated for one
      solve and stored nowhere, and each pointer move solves with a soft pull
      (w = 0.12) toward the cursor. Extras are kept out of the offender report,
      or every drag would read `CONFLICT`.
      *Discovered while doing it:* a pull that cannot be satisfied does not
      stall against the constraints, it trades against them — least squares
      weighs everything at once — so a cursor held far past where a point can
      go leaves the drawing a little out of true until release. Invisible at
      ordinary cursor distances, and the settling solve undoes it exactly; it
      is the reason mid-drag frames must not touch the status line.
      Abandoning a drag (Escape, or opening a file mid-gesture) settles it with
      one ordinary solve rather than dropping it, or the cursor's pull stays
      baked into the geometry and the status line is stale.
      *Left for later, deliberately:* only points drag (edges and rims still
      pan), nothing is inferred or snapped mid-drag, and there is no undo — for
      now a drag is undone by dragging back.
- [x] **The line tool** — click-click with Onshape's chaining: the committed
      end *is* the next segment's start, the same entity, so nothing needs
      joining. Nothing is committed until the second click, so an abandoned
      chain leaves no stray point. Horizontal/vertical inference within 3° of
      an axis, in the line form, with an endpoint snap taking precedence.
      Escape ends the chain and keeps what was drawn.
      *Discovered while doing it:* the chain is dimension-generic (it is only
      points and lines), so the tool works in a 3D model and simply infers no
      axis there — and writing that test caught a real bug, a degeneracy check
      that measured only the first two coordinates and so refused every
      segment that moved in z alone.
- [x] **Constraint inference** — a tool that places a point on existing
      geometry applies the relation that implies (`coin` on a point, the line
      form of `mid` on a midpoint, `on`/`oncircle` on a curve), so a rectangle
      drawn from another's corner genuinely follows it. `snapping(false)`
      turns it off with snapping, one switch, as in Onshape. There is no
      "weld": two points stay two points, joined by an ordinary constraint.
      *Discovered while doing it:* `midpoint` was point-form only and now has
      the lazily-resolving line form `mid(m, "l1")` beside it, the same
      distinction `hor`/`ver` already drew. And a coincident constraint
      between two *free* points splits the difference on solve rather than one
      following the other — which is correct least-squares behaviour, and the
      reason the tests pin one end with `fix` before asking whether the other
      followed.
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
