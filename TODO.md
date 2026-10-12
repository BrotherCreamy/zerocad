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

- **Standing duty**: after every merged PR, run `npm run build:single` and
  republish `dist-single/neocad.html` to the owner's review artifact
  (same URL each time).

## Decisions made so far — veto here if any are wrong

The guiding rule, set by the owner: **tools work like Onshape/SolidWorks, so
people arrive already knowing how to use them.** Deviations from that rule
are flagged as such.

- **3D — one constraint model, extrude and revolve** (owner's direction,
  2026-10-12; roadmap: [`docs/plans/3d-roadmap.md`](docs/plans/3d-roadmap.md)).
  Two forks the owner decided up front: **one `Model(3)`** rather than
  Onshape's sketch/part split — a "sketch" is coplanar geometry, and the
  purest continuation of the N-D kernel and dimension-generic relations —
  and **extrude profiles are auto-detected closed loops**. What follows
  from one-model, recorded here before any code: 3D frames (origin, x-ref,
  y-ref) are the sketch planes, closing the register's fix-above-2D gauge
  seam; the camera is orthographic with ray→working-plane pointing;
  extrude expands into real entities plus per-point offset relations with
  a `d`-named depth, so `set()` drives solids; revolve renders its sweep
  parametrically from a live, constrainable section. ⚠ *Mouse map changes
  in 3D (Onshape's):* right-DRAG orbits; middle pans; right-release keeps
  the menu. Phases and the rest of the design in the roadmap; phase 1
  (3D frames + fix/onPlane + camera + app on Model(3)) is in flight:
  [`docs/plans/3d-phase1.md`](docs/plans/3d-phase1.md).

- **No world frame — coordinate frames are entities** (owner's direction,
  2026-09-01, chosen over "keep the frame but hide it" and "directions stay,
  origin goes"). The grid is gone; there is no drawn origin; and
  `hor`/`ver`/`fix` are frame-relative, erroring with a helpful message when
  no frame is given and no default is set. `frame(origin?, xref?)` makes one
  out of two ordinary points; `setDefaultFrame(name)` picks the one relations
  mean when unnamed. A drawing with no frame floats in the solver's gauge,
  which the damped solve already handles. ⚠ *Deviations from Onshape,
  veto-able:* Onshape HAS a sketch origin and frame — this deliberately does
  not; the rectangle tool goes intrinsic (par/perp, no hor/ver ever); H/V
  inference works only while a default frame is set. **Old saved files
  carrying frameless `hor`/`ver`/`fix` will not open** — accepted pre-release,
  said in the CHANGELOG. Format version is now 2.
  ✅ **Built, both halves** — model and relations, then the command surface,
  the drawn marker, picking/dragging/boxing, and the end-to-end story.
  *Spec:* [`docs/plans/coordinate-frames.md`](docs/plans/coordinate-frames.md).
  **↻ Extended by the owner (2026-09-02): `hor`/`ver` are retired outright.**
  The words themselves imply a privileged pair of directions — a world frame
  in vocabulary form. "Vertical" becomes `par("l1", yaxis())`: `par`/`perp`
  learn to take a frame-axis reference (`"f1.x"`/`"f1.y"`, direction only,
  datum semantics — read, never pushed), and `xaxis()`/`yaxis()` resolve the
  default frame at the command line. `fix` stays (frame-relative already,
  and it names no privileged direction). Old journals translate
  (`horizontal(l, f)` → `parallel(l, "f.x")`), format version 3.
  *Spec:* [`docs/plans/retire-hor-ver.md`](docs/plans/retire-hor-ver.md).
  ✅ **Built.** `par`, `perp` and `ang` take a frame-axis reference;
  `xaxis()`/`yaxis()` resolve the default at call time; `hor`/`ver` are gone
  from `relations/basic.ts`, from the command surface and from the glyph
  table; the line tool infers `par(l, "f.x")`; v2 files translate and
  re-save in the new vocabulary, format version 3.

  Decided while retiring them, and open to veto:

  - **The audit came out as a rule, not a list.** An axis reference is a
    *direction* — no length, no position — so exactly the relations that
    read an argument for its direction alone may take one: `par`, `perp`,
    `ang`. `eq` is out (an axis has no length to be equal to); `on`, `sym`
    and `tan` are out (each needs a *located* line, and reading `"f1.x"` as
    a line through the frame's origin would give one syntax two meanings —
    `fix(p, [t, 0])` already says "somewhere along the frame's x").
    ⚠ *Veto-able:* `ang` was included on the argument that "this edge at
    30° to the frame" is the commoner draughting intent; it is the one
    inclusion `hor`/`ver` did not already justify.
  - **`par`/`perp` kept the point-pair form** (`par("p1","p3","f.x")`),
    settled on the subject's kind exactly as `hor` settled it, so the
    two-forms distinction ARCHITECTURE.md documents survives the rename.
    `ang` deliberately has no point form: its trailing numeric target would
    have to be told from a third name by arity alone.
  - **Two frame axes on one relation is refused.** Both sides being datums
    means a residual declaring no variables — nothing the solver could
    move — so it is an error rather than a constraint that silently either
    holds already or never can.
  - **A dot is refused in every entity name**, at `claimName`, so a
    reference can never collide with a name. `relationsNaming` and `del`'s
    cascade read `f1.x` as naming `f1`, or a frame could be deleted out
    from under a relation still reading it.
  - **v2 files translate rather than being refused**, and a translated file
    re-saves in the new vocabulary — `save(open(x)) ≠ x` across this
    boundary, deliberately, since a file that opened as `par` and saved
    back as `hor` would keep the retired words alive in the format forever.
    v1 files are still refused by step.
  - *Found by looking at the picture:* **`∥` is not in the browser's
    monospace** and drew as a tofu slab — every other mark advances
    7.2246px in that font and `∥` advances 6. Invisible while `par` was
    rare; the commonest mark in the drawing the moment `hor`/`ver` retired
    into it. The mark is `//` now, and an e2e measures every symbol in the
    table against the monospace cell so the next one cannot rot quietly.

  Decided while building it, and open to veto:

  - **A frame is read, never pushed.** Its two points are not declared as
    variables of the residuals that read it, so an axis `par` turns the *line*
    and never the frame. Declaring them was tried and measured first: least
    squares then turns the frame instead (about 8° of a 9° error, on a
    40-unit line against a 20-unit frame arm) and, without normalising, also
    shrinks the frame's arm to make the residual smaller still. A frame the
    drawing pushes around is not a datum. The cost is one Jacobian that is
    exact for the block as declared rather than for every number its residual
    touches; the benefit is that "level against a tilted frame" settles at
    *exactly* the frame's tilt, which is the package's own acceptance test.
  - **`fix` above 2D keeps its old, gauge-relative meaning.** An origin plus
    one direction settles a frame in 2D and leaves a rotation free in 3D, so
    `addFrame` is 2D-only — and a `fix` that could not be written at all in a
    3D model would take the dimension-genericity of the relation vocabulary
    with it. This is the one place the kernel's own axes are still visible.
    Closing it needs a frame entity carrying a second reference direction,
    which is a package of its own.
  - **A frame's direction is normalised** where two ordinary lines' are taken
    raw — otherwise collapsing the frame satisfies the relation, and that is
    exactly what the solver does when given the chance. (Established for
    `hor`/`ver`, and carried into the axis references that replaced them: the
    residual is on the same |d|·sin scale it always was.)
  - **Dragging a point that a frame reads *moves* it, rather than pulling at
    it** — and this is the other face of read-never-pushed, not an exception
    to it. With the frame's points outside the Jacobian of the residuals that
    read them, the damped solve rejects every step that turns the frame
    (turning it raises a residual the step cannot see how to lower), λ runs
    away by a factor of eight per rejection, and the frame does not move:
    measured at 0.003° against a gesture asking for 26°. So the drag assigns
    the position and the same solve carries the drawing to it — one
    Gauss-Seidel sweep, exactly the cost `frameBasis` says this trade costs. A
    datum is moved by the user; the solver never votes on where it goes. The
    weak pull is still applied on top, so a frame's point that is also
    ordinary geometry keeps its relations' say.
  - **A frame's marker is a fixed pixel length, and that is what is picked and
    boxed.** How far the x-ref sits from the origin means nothing — only the
    direction does — so drawing to it would put a number on screen that
    carries no information. The origin *point* still out-ranks the marker in
    the pick tiers where they meet, which is what makes "drag the corner to
    turn it, drag the arm to move it" two different gestures.
  - ✅ *The half-1 gap is closed:* the line tool's aim, its dashed guide and
    the constraint it lands are one answer, read off the default frame's own
    axes. With no default frame there is now no aim and no guide either,
    where half 1 still pulled the preview onto the kernel's axes.
  - *Not built, and nobody has asked for it:* a frame has no rotate gesture of
    its own. You turn one by dragging its x-ref, which is the same gesture as
    dragging any other point. ⚠ *Deviation:* Onshape's sketch frame cannot be
    moved at all, so there is nothing to match here.
  - *Noted, not acted on:* an intrinsic rectangle's line-to-line `par`
    residual is a wedge — quadratic in the drawing's size, where `hor` was
    linear in a coordinate — so hurling a corner of a filleted rectangle a
    thousand units away no longer re-solves inside sixty iterations. (An axis
    `par` is *not* affected: its second side is a unit vector, so it is
    linear again, exactly as `hor` was.) Displacements on the drawing's
    own scale are unaffected.

- **Selection:** there is no selection set. Clicking geometry drops its name
  into the command line (cellwork's model — "the viewport is a selection
  portal"). Names are inserted quoted and comma-separated, because commands
  here are function calls: two clicks after `dist(` leave `dist("p1", "p2"`.
  **A box select is a multi-click** and nothing more — the names go down the
  same path, so this decision survives box select rather than being replaced
  by it.
- **Mouse:** with a tool armed, the left button belongs to the tool; with
  nothing armed, left-click picks, **left-drag on any geometry drags it** — a
  point, an edge, a rim, an arc — and left-drag on **empty canvas
  box-selects**. Wheel zooms about the cursor (scroll up = in). Middle-drag
  pans. **The right button splits the way the left one does:** past the same
  three-pixel threshold it pans, released where it landed it opens the context
  menu; the browser's own menu stays suppressed either way.
  **✔ The deviation noted here is resolved (2026-09-02).** It used to read
  "middle- or right-drag pans; the right-click menu is suppressed", flagged as
  a deviation because Onshape pans with the middle button only and spends the
  right one on a menu — with the standing promise that right-drag pan would
  yield to a menu once one existed. It has, and it cost nothing: the release
  decides, so a right-drag pans exactly as it always did and only a right press
  that never moved means anything new. Middle-drag stays purely navigational
  and never opens anything.
  **↺ Reversed in two steps (2026-09).** This entry used to read "left-drag
  pans", which was cellwork's habit. The box-select package took the empty-
  canvas half and the edge-drag package took the rest, both for the same
  reason: SolidWorks and Onshape box-select on empty canvas and drag the
  geometry everywhere else, and the guiding rule above — tools work like
  Onshape, so people arrive knowing them — outranks a register entry inherited
  from the prototype. Panning lost nothing by either change: middle-drag,
  right-drag and `pan()` all still pan. The one left-drag that still pans is a
  press that landed on a **constraint glyph**, which grabs nothing (a glyph is
  UI, with no position of its own) and is not empty canvas either.
  **Veto-able here**, like everything else in this list.
- **Box select follows the SolidWorks/Onshape direction convention**, exactly:
  left→right selects only what is fully contained and is drawn as a solid
  translucent rectangle; right→left selects anything it touches and is drawn
  dashed, in a different tint. Containment and touching are screen-space
  tests, and a rectangle wholly inside a circle touches nothing — the rim is
  the entity, the same rule picking follows. **Constraint glyphs are not
  box-selectable**: they are UI, and a box full of `r`-names nobody asked for
  would be noise, so the flow for relations stays hover-and-click.
- **Every constructor argument is optional, and a missing one is not a
  constraint.** `circle()`, `line()`, `arc()`, `point()` are all legal;
  whatever is left out is auto-created free, with a seed that is never
  degenerate, for the relations to define. This follows from what the
  arguments always were — `circ(centre, r)` seeds a radius variable, it does
  not constrain one — so no existing call changed meaning and old files replay
  untouched. Long names (`point`/`line`/`circle`) sit beside the short ones.
  **Where a free piece lands is a question about the window, not the model**:
  the command layer reads the middle of the view and passes it down as a
  coordinate, and the model still knows nothing about a viewport.
  **Ambiguity is answered by the seed**: tangent + through-point + radius
  admits up to four circles, and the solver returns the branch nearest where
  the piece started — Onshape's behaviour, and dragging flips branches. Said
  out loud in `CHANGELOG.md` so nobody reads branch choice as nondeterminism.
- **A dimension is drawn as its value, and a dimension label is a glyph.**
  `dist`, `rad` and `ang` render their target (`50`, `R22`, `30°`) instead of
  a generic mark, because in Onshape the number *is* the dimension. It is the
  same glyph everything else uses — same hover, same click-inserts-the-name,
  same `glyphs(false)` — rather than a dimensions overlay beside it, so there
  is one annotation layer and one switch. Values are read from
  `RelationEntry.args`, formatted trimmed to at most 3 decimals. `dist` also
  draws **dashed** witness and dimension lines: solid ones were tried first
  and read as geometry (a `dist` across a diagonal drew what looked like an
  edge that is not there). ⚠ *Deviation, still open:* `ang` is typed in
  **radians** and labelled in **degrees**, so the label is not what you would
  retype — and `set("d3.value", …)` takes radians for the same reason, since a
  dimension stores what its relation stores. Deliberately left: guessing the
  unit from the size of the number would be worse than one honest unit, and
  degree input is the owner's to ask for.
  **No editing in place on the canvas**: clicking a value still inserts the
  relation's name. Editing itself is `set("d1.value", 60)` from the command
  line, or Set value… on the glyph's menu, which types that command for you.
- **Dimensions are the `d` namespace, and a dimension is the value-holder.**
  `dist`, `rad` and `ang` claim `d1`, `d2`, … and everything else claims
  `r1`, `r2`, …, because a dimension is a number you put on the drawing and a
  constraint is a statement about shape — Onshape's split, and the name now
  says which you are holding. **`fix` is not a dimension**: it carries
  coordinates rather than one value, and Onshape calls it a constraint too.
  The prefix is decided by the op inside `model.relation` rather than passed
  in by each relation, so a new relation cannot get it wrong by omission.
  **`set(path, value)` is an operation**, not a relation: it replaces an
  equation rather than adding one, rebuilding the relation **in place under
  the same name** so every reference to `d4` still means what it meant. The
  new blocks are built before the old ones are removed, so a refused value
  costs the drawing nothing. One user action, one undo step, and it re-solves
  through the host — the `del` precedent, sharpened by the fact that changing
  the verdict is the whole purpose of the call. `"d4.value"` is the only
  settable property; the syntax is `f1.x`'s, one property along.
- **Tools do not dimension what they draw.** A rectangle gets `hor`/`ver` on
  its edges but no size; a circle's radius stays free. Matches Onshape's
  undimensioned-sketch behaviour — the user adds `dist`/`rad` when they mean
  it, and undimensioned geometry stays draggable.
- **Snapping and inference share one switch.** Tiers: exact point beats
  midpoint beats along-a-curve (tolerances in screen pixels, cellwork's
  numbers). `snapping(false)` turns off snapping *and* inference, like
  Onshape's inferencing toggle. Inference never merges points — two points,
  one ordinary constraint.
- **Arc tools**: `arc` is Onshape's *center point arc* (click centre, start,
  end); `arc3` is its *3 point arc* (click the two **endpoints**, then a point
  the arc passes through — Onshape's order, not start-waypoint-end). The
  waypoint is not kept as geometry, so `arc3` leaves the arc's bulge free.
- **Fillet** takes its radius when armed — `arm("fillet", { radius: 8 })`,
  default 10 — and reuses the shared corner as a tangent point so nothing is
  orphaned. (That was originally because there was no delete; it is still the
  right shape, since a fillet that stranded points would leave stray dots for
  the user to clean up by hand.) A miss-click is a miss, not a cancel.
- **Deleting:** `del(name, …)` takes one name or several (a box-select's
      worth is the expected batch: every name is validated before anything is
      removed, a name an earlier cascade already took is skipped, the batch is
      one undo step) and cascades the way Onshape does
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
  **A file may also carry the source of tools authored at the command line,
  and that changes nothing about the rule:** the source is inert text,
  `open()` evaluates none of it, `toolSource(name)` prints it, and pasting it
  back is an ordinary entry — the paste is the consent. Nothing in a file runs
  that the user did not themselves type, and no button, menu item or flag
  exists that would run it for them. Capture is the whole entry that called
  `defineTool`, is session state rather than model state (not journalled, not
  an undo step), and rides the file as an optional field that did not move
  `VERSION` off 4.
- **The command line is curation, not a sandbox.** Typed code runs with the
  app's full authority; the scope exists for legibility and typo-catching,
  and says so honestly rather than claiming to be a security boundary.
- **Process:** work packages arrive as PRs against the working branch, per
  the header above (owner approved the PR flow after originally asking for
  direct commits). Small items whose spec would be longer than the diff may
  be committed directly by the supervising session, with the same test gate.

## Decisions needed from the owner

- [x] **How a dimension's value is edited — DECIDED by the owner
      (2026-09-02), and shipped.** *"should be a `set(d4.value, 60)` where d4
      is the dimension."* The design is now a register entry above
      ("Dimensions are the `d` namespace"); spec:
      [`docs/plans/dimensions-are-named.md`](docs/plans/dimensions-are-named.md).
      **Still open underneath it**, and not this package's to answer: `ang`
      stores radians while its label reads degrees, so `set` on an angle takes
      radians. Degree input is a separate ask.
- [x] **May a saved file carry code? — DECIDED by the owner (2026-09-02):
      inert text, pasted back by hand — and BUILT (2026-09-03).** The file
      carries a REPL-authored tool's source as data; `open()` never evaluates
      it, and the paste is the consent. Shipped as specced in
      [`docs/plans/tool-source-in-files.md`](docs/plans/tool-source-in-files.md);
      the register entry above ("A saved file is data") now states it as
      standing behaviour.

## Next up

Queue for Opus, in order. Each gets a spec in `docs/plans/` before work
starts.

- [x] **Saving user-authored tools** — done (2026-09-03), on format version 4
      without bumping it: an optional `tools: {name, source}[]` beside the
      journal, captured by a wrapper around `defineTool` in `replenv.ts` from
      the entry the evaluator publishes as `repl.entry`. Spec:
      [`docs/plans/tool-source-in-files.md`](docs/plans/tool-source-in-files.md).
      **Found while building, left deliberately** (each documented in the plan
      and pinned by a test): a tool defined asynchronously *after* its entry
      returns is not captured, because there is no entry in flight to capture;
      a carried name that is already registered gets no "paste it" line, since
      that sentence would not be true of it; and re-defining a tool replaces
      its stored source rather than keeping a history. A source is stored per
      name, so two tools defined in one entry each store that whole entry —
      correct, and mildly surprising if you paste both.
- [ ] **~~Inference while dragging~~ — re-scoped down, near-wontfix.** Checked
      against the guiding rule before speccing: Onshape does *not* commit
      constraints during a drag — dragging moves geometry, and inference
      belongs to placement clicks. So the original framing was a deviation
      dressed as parity. What could still exist someday: a mid-drag *soft*
      snap of the drag target (position only, nothing committed). Low value
      next to everything else; parked.

With the context menu shipped, nothing else is queued — the next package needs
a direction from the owner. Discovered while building it, and worth a package
of its own someday: **the menu's items are hard-coded per pick kind**, so a
relation or tool added at the command line cannot put itself on one. That is
the same shape as "tools are not privileged", and a menu that could be
extended the way `defineTool` extends the tool registry would close it.

## Smaller things

- [x] `docs/plans/` specs that have shipped gain a one-line "shipped" note
      at top rather than being deleted — they are the design record.
- [x] **A relation added from the command line leaves the header stale.**
      Fixed: **a command entry that changed the model re-solves through the
      host**, the way tools, drags and `del` already do. The worry that it
      would need an enumeration of which commands are edits turned out to be
      unfounded — the undo bracket already computes exactly that answer by
      comparing the snapshot before the entry with the snapshot after, so
      `endUserAction` now returns it instead of swallowing it. `ls()` and
      `help()` provably do not solve; a contradictory `rad()` flips the header
      to `CONFLICT` on the keystroke that caused it. Pinned by
      `test/e2e/livesolve.e2e.ts`, which counts solves in the page.

## Done

- [x] **Dimensions are named, and `set()` edits their value** — spec:
      [`docs/plans/dimensions-are-named.md`](docs/plans/dimensions-are-named.md),
      now marked shipped-pending-review. `dist`/`rad`/`ang` claim `d1`, `d2`, …
      and every other relation stays `r`-named; `set("d4.value", 60)` rebuilds
      the dimension in place under the same name, journals as the one call, is
      one undo step and re-solves through the host. The menu's **Set value…**
      types the unfinished command rather than running anything. Format version
      **4**, with v3 files translated: `deleteRelation` args are rewritten
      through a map built during the replay, since re-prefixing changes which
      relation a recorded name picks out.
      *Discovered while doing it:* the map has to come from the replay rather
      than from a scan of the journal, because `fillet` is one journal entry
      that creates four relations — and would be wrong again the next time an
      operation's expansion changed. Also worth knowing: nothing pins a bare
      rectangle's **orientation**, so a `set` that lengthens one edge lets the
      whole drawing rotate a little unless something levels it against a datum.
      That is the no-world-frame decision working as designed, not a bug, but it
      surprises on first sight — the package's screenshots level the drawing
      first so the picture shows the edit and not the rotation.
- [x] **The right-click context menu** — spec:
      [`docs/plans/context-menu.md`](docs/plans/context-menu.md), now marked
      shipped-pending-review. **Right-press and release without moving opens a
      menu; right-drag still pans** — the right button now makes the same
      click/drag split the left one always has, on the same three-pixel
      threshold, so the release decides and the press decides nothing. The
      menu is a `<div>` in the hover tag's visual family, and **every item is
      a shortcut to a command the log shows**: an entity gets Insert name /
      Delete / Dimension (and Fix, on a point), a constraint glyph gets its
      description and Delete, empty canvas gets the eight tool arms plus
      Frame. The register's mouse entry above is updated — the right-click
      deviation it carried is resolved.
      *Decided while doing it:* **the seam is `submit`**, the function the
      Enter key calls, handed to the menu as an explicit `run` hook. "A
      shortcut to a typed command" is a claim about machinery rather than
      outcome — logging, the recall history, one undo bracket and the re-solve
      all live in `submit` and nowhere else — so anything short of calling it
      would be a second, slightly different answer to what typing means.
      Writing into `#cmd` and dispatching a synthetic Enter was rejected: it
      reaches the same function by pretending to be a keyboard, makes the seam
      invisible to a reader, and destroys whatever was half-typed.
      *And:* **Fix types the point's coordinates in the default frame**, not
      its raw ones. The spec said "current coords", which means "hold it where
      it is"; against a frame that is turned or moved off the gauge's origin,
      raw numbers would yank the point somewhere else the moment the relation
      landed. There is a unit test with a frame turned 90° and moved, which
      fails on the raw form.
      *And, beyond the spec:* each item shows the command it is about to type
      beside its label. The menu exists to be a shortcut *to the command
      line*, and an item that hid what it was about to do would be a fourth
      way to edit the drawing rather than a faster way to type.
      *Left in place deliberately:* the items are hard-coded per pick kind, so
      nothing defined at the command line can add one (noted under "Next up");
      no submenus, icons or keyboard arrows, per the spec; a right-click with
      a tool armed opens the menu rather than doing something tool-specific,
      which is one rule instead of two; and a right press taken *during* a
      left drag opens nothing, because interrupting a gesture in progress is
      never what it means.

- [x] **The 3-point arc tool** — spec:
      [`docs/plans/arc3-tool.md`](docs/plans/arc3-tool.md), now marked
      shipped-pending-review. `arm("arc3")` (or the bare word), then **the two
      endpoints, then a point the arc passes through** — Onshape's click order
      for *3 point arc*, which is neither start-waypoint-end nor the
      centre-point arc's centre-start-end. What is committed is two
      `placePoint`s, one free `addArc` with its centre auto-created and seeded
      at the circumcentre, and one `arcEndpoints`. Footprint was the new file,
      one shared helper module, one import line in `main.ts`, tests and docs;
      `engine.ts`, `replenv.ts`, `persist.ts` and `operations.ts` were all
      untouched, and **no new journal op was needed** — which is the evidence
      that it is a composition rather than a new kind of thing.
      *Decided while doing it:* **the third click places nothing.** Onshape
      does not keep the waypoint as geometry and neither does this, so the arc
      is under-constrained on commit — seven unknowns against `arcEndpoints`'
      two equations, with the *bulge* free. That is the standing rule that
      tools do not dimension what they draw, and the same bargain `arc.ts`
      already strikes. The alternative, keeping the waypoint as a third point
      with an `onCircle` (exactly what `circle3` does), was rejected: it
      contradicts Onshape and leaves a point the user never asked for and
      would have to clean up by hand. The freedom is *asserted* — a
      unit test shoves the centre along the endpoints' perpendicular bisector
      and finds the system just as solved at a different radius.
      *And:* **the sweep is tested against `withinSweep`, not against a second
      opinion.** An arc bulging the wrong way satisfies every residual to
      machine precision and is still the wrong drawing, which is the fillet
      bug's shape; so the tool's world-space choice of which click is `start`
      is checked against `intersect.ts`'s own screen-space definition of what
      is on an arc. Flipping the choice in the source fails three tests.
      *And:* **`circumcircle` moved out of `circle3.ts`** into
      `src/tools/circumcircle.ts`, with `COLLINEAR_EPS` and the preview's
      radius cap. Two tools needing the same closed form is fine; two tools
      needing the same *epsilon* is not something to leave in two places, or
      one will eventually refuse a gesture the other accepts.
      *Left in place deliberately:* the bulge is free, as above — documented,
      tested, and `rad(...)` is the answer for anyone who wants it held. Also
      the same-place guard is in **world units** (`1e-6`), matching `arc.ts`:
      at a wild enough zoom-out two genuinely distinct clicks could fall
      inside it, and the failure mode is "the second click did nothing, click
      again".
      *Discovered:* the register's "no 3-point arc yet" line and the
      circle3 entry's `console.warn` gap were both stale; both corrected in
      `STATUS.md`.

- [x] **Dimension values on the canvas** — spec:
      [`docs/plans/dimension-labels.md`](docs/plans/dimension-labels.md), now
      marked shipped-pending-review. `dist`, `rad` and `ang` draw their target
      (`50`, `R22`, `30°`) as their glyph, read from `RelationEntry.args`, so
      nothing below the UI changed: no model change, no journal change, no new
      relation kind. A label hovers, picks, highlights and hides with
      `glyphs(false)` exactly as a mark does, because it is one.
      *Decided while doing it:* the spec left the witness/dimension lines to
      whichever read better in a browser — **kept, dashed**. Solid, they were
      indistinguishable from geometry (a `dist` across a rectangle's diagonal
      drew what looked like a diagonal edge that does not exist); dashed and
      dim they read as annotation, and they earn their pixels in exactly that
      diagonal case, where nothing else says which two points a floating
      number measures. `ang` gets **one** label at the shared corner rather
      than the two marks `∠` used to get: two marks answer "which pair", two
      copies of the same number answer nothing.
      *Discovered while doing it:* a stacking row that stepped by a fixed
      17px drew `—` touching `110`, which reads as *minus* 110 — the row now
      advances by each box's real edges. And `ang` takes radians while its
      label says degrees; drawing radians on a sketch would be the wrong fix,
      so the seam is flagged in the register and closes with retargeting.
      *Left in place deliberately:* no editing in place (owner decision
      below); `rad` gets no leader line back to its arc; a label sits on the
      side its relation's argument order puts it (`dist("p3","p4")` and
      `dist("p4","p3")` land on opposite sides of the same edge), which is
      the same hand-placement story every glyph has and is what the
      screenshots use to put the dimensions outside the shape.
- [x] **A tool can say something to the user** — `ToolContext.log`, filled in
      by the engine, routed to the log pane by `main.ts`. `fillet` no longer
      throws its refusals at the page and `circle3` no longer whispers to the
      console; headless, both keep their old behaviour (throw / warn), the
      `pick` convention. Direct commit by the supervising session, same
      test gate.
- [x] **The 3-point circle tool** — spec:
      [`docs/plans/circle3-tool.md`](docs/plans/circle3-tool.md), now marked
      shipped-pending-review. `arm("circle3")` (or the bare word), three
      clicks, and what is committed is one free `circle()`, three `oncircle`s
      and a solve. Every click goes through `placePoint`, so all three carry
      snapping and inference — a 3-point circle through two existing corners
      is three clicks and no special case. Nothing is created until the third
      click, so the engine's existing bracket makes the whole gesture one undo
      step; a dashed circumcircle previews after the second. Footprint was the
      new file, one import line in `main.ts`, tests and docs — `engine.ts`,
      `replenv.ts`, `operations.ts` and `persist.ts` were all untouched.
      *Decided while doing it:* **the centre is seeded at the circumcentre,
      not the spec's centroid.** The spec asked for the centroid so the solver
      would not start somewhere wild; the closed form was already in the file
      for the preview and the collinearity test, so seeding at the exact
      answer serves that reason better than an approximation of it and costs
      nothing. The circle is still free — a constructor argument here only
      ever seeded a variable.
      *And:* **the collinearity epsilon is a relative sine, not an area.** An
      area threshold would call a large drawing bent and a small copy of it
      straight; dividing through by the two side lengths makes the test an
      angle, scale-free at any zoom and in any unit. Same form and same number
      as `intersect.ts`'s parallel test, and there is a unit test at three
      scales that fails on the area form.
      *Left in place deliberately:* the refusal is a `console.warn`, not a
      line in the app's log pane. A `Tool` has no channel to that pane — it
      would take a new `ToolContext` field, which means editing `engine.ts`,
      which the spec ruled out because the edge-drag package is in flight
      there. Worth a follow-up: **tools have no way to say anything to the
      user**, and `fillet` currently *throws* to report a corner it cannot
      round, which reaches the page as an uncaught error.
      *And:* the preview is not drawn when the circumradius exceeds 1e6 screen
      pixels. What would be drawn there is a straight line (the sag is well
      under a pixel across the window), and asking a canvas for an arc of
      radius 1e8 is a good way to hang a tab. The *commit* is unaffected — a
      near-collinear circle is the user's to make.

- [x] **Dragging an edge** — spec:
      [`docs/plans/edge-drag.md`](docs/plans/edge-drag.md), now marked
      shipped-pending-review. Dragging an entity is dragging every point it is
      made of by the same offset, as a *target*: one soft pull per governing
      point, so the constraints still get their say. A circle's rim drags its
      centre and leaves the radius alone; an arc's rim drags centre, start and
      end. The register entry above is updated: the old mouse map is now gone
      entirely.
      *Decided while doing it:* the offset form replaced "pull to the cursor"
      for **single points too**, rather than keeping two code paths — a point
      grabbed a few pixels off-centre no longer jumps to the cursor as the drag
      starts, which nobody had asked for but everybody expects.
      *Left for later, deliberately:* **no rigid rotation** (translation only,
      as specified — Onshape's drag does the same and lets the solver resolve
      the rest); **no inference or snapping mid-drag**, still; and a press on a
      **constraint glyph** still pans, which is now the only left-drag that
      does. Making it inert instead was considered and rejected — see
      `CONVERSATION_LOG.md`.
- [x] **`del` of several names at once** — `del("p1", "l5", …)`, the batch a
      box select naturally produces. Validation of every name happens before
      the first removal (a typo mid-batch costs nothing), a name an earlier
      cascade already took is skipped silently, and the whole batch is one
      entry and therefore one undo step. Journalling was already per-removal
      (the expansion), so nothing about persistence had to change — pinned by
      a replay test anyway. Implemented directly by the supervising session:
      small enough that a spec would have been longer than the diff.
- [x] **Entities defined by constraints, not constructors** — spec:
      [`docs/plans/free-entities.md`](docs/plans/free-entities.md), now marked
      shipped-pending-review. Every constructor argument is optional, in
      `model.ts` and at the command line: `circle()` is a legal way to say "a
      circle, which the relations I am about to type will define", and the
      owner's two examples type verbatim. Auto-created pieces are real, named,
      first-class entities with seeds that are never degenerate; each
      constructor journals as the one call made and re-expands deterministically
      on replay. Long names `point`/`line`/`circle` sit beside `pt`/`ln`/`circ`.
      Shipped in two commits — model half first (it carried no conflict risk
      with box-select, which owned `replenv.ts`), command half after.
      *Decided while doing it:* **the view-centre seed is passed down as a
      coordinate, not learned by the model.** A free circle at the world origin
      is baffling — you type it and nothing appears — but "the middle of the
      window" is a fact about a window, so `replenv.ts` reads it and calls
      `addPoint(coords)` like any other caller. It needs the canvas's *size* as
      well as the transform, which a `View` has no business holding, hence a
      separate `viewSize` handle rather than a fatter `View`.
      *And:* the anchor is used only where the model would otherwise fall back
      to the origin for want of anything to derive a position from. Given any
      reference the model already seeds beside it, and hauling that to the
      middle of the window would be worse, not better.
      *And:* headless, the command layer passes `null` rather than the model's
      own default coordinates, so a journal written with no viewport is exactly
      what the model layer writes — one call, no expansion. On screen the
      journal records the coordinate actually used, so a drawing reopens where
      it was drawn. Both directions round-trip in tests.
      *Discovered while doing it:* **`circ("p1", 6)` only seeds a radius**, so
      "a line tangent to two circles" with unpinned radii is satisfied by
      shrinking a circle onto the line. Obvious in hindsight and exactly the
      distinction this package is built on; the test now says `rad()` too.
      *And:* **what counts as one undo step is decided around a submitted
      entry** — a `del()` pushed straight into the evaluator is not a step, and
      the next `undo()` undoes the entry before it. A test-harness trap, not a
      product bug, but it will catch the next person too.
      *Left in place deliberately:* tangent + through-point + radius admits up
      to four circles and the solver returns the branch nearest its seed;
      dragging flips branches. Onshape's behaviour, written into `CHANGELOG.md`
      as a property rather than left to be read as nondeterminism. And the
      pointer tools are untouched — a 3-point-circle *tool* is now trivial and
      is listed under "Next up" as enabled, not built. **↳ Built, one package
      later**, exactly as trivially as promised: `src/tools/circle3.ts` plus
      one import line, and nothing else.

- [x] **Box select, and live solve for typed edits** — spec:
      [`docs/plans/box-select.md`](docs/plans/box-select.md), now marked
      shipped-pending-review. Left-drag on empty canvas draws a selection box:
      left→right is a window (fully contained, solid translucent rectangle),
      right→left a crossing (anything touched, dashed, different tint). The
      predicates live in `src/boxselect.ts` — screen-space, no canvas, no
      state, on top of `intersect.ts` so a box and a click agree about where an
      arc stops. Names drop into the command line quoted and comma-separated,
      exactly as clicks do. Empty box inserts nothing; Escape cancels; glyphs
      are not selectable; a press on a point still drags and a press on other
      geometry still pans. **The register entry above was reversed by this
      package**, with the reversal noted there for the owner to veto.
      *Decided while doing it:* `boxselect.ts` is a fourth peer beside
      `picking.ts` rather than a function inside it, because picking is
      dominated by *choosing* (tiers, tolerances, nearest wins) and a box
      chooses nothing — it takes everything that qualifies. It projects
      entities to screen curves itself rather than borrowing snapping's
      private helper, which would have been a lateral import between peers;
      the piece that genuinely must not be duplicated, the arc-sweep test, is
      already below in `intersect.ts` and is what both use.
      *Discovered while doing it:* **Escape was bound to the command input,
      and a mouse press on the canvas blurs it** — a canvas is not focusable,
      so focus falls to the body — which made Escape deaf during exactly the
      gestures it exists to abandon. Never noticed because every earlier
      Escape test had picked something first, and `insertToken` re-focuses the
      input. It is on `window` now, the same reasoning that already put Ctrl+Z
      there. Found by writing the box-cancel browser story, not by reasoning.
      *Left for later, deliberately:* a box catches only what is on screen, by
      construction (the rectangle is pixels); there is no shift-to-add,
      because there is no selection set to add to; and edge-dragging is still
      a pan, which is now the only leftover from the old mouse map and is
      listed under "Next up".

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
