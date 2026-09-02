# Plan: retire hor/ver — a frame's axes are things par/perp can take

**Status: queued — starts after the context-menu PR merges** (overlapping
files; serial keeps review clean).

Owner's direction, near-verbatim: *"horizontal/vertical implies a world
frame… should just be parallel and perpendicular. If they want a 'vertical'
constraint, they can just do `parallel(l1, *defaultframe.Y)` or similar."*

He is right about the implication: the no-world-frame package made
`hor`/`ver` frame-relative, but the *words* still carry the old idea — a
special pair of directions the universe hands you. With frames as entities
the pair is redundant vocabulary: "level" is parallel to an axis you can
name. So the relations `horizontal`/`vertical` (`hor`/`ver`) are removed,
not aliased.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/plans/coordinate-frames.md`
and the register's no-world-frame entry (including the read-only-datum
sub-decision — it governs this package too).

## Design

### Axis references

`par` and `perp` (and anything else that takes a line by name — audit:
`ang`, `sym`, `on`?, decide each honestly and document the ones you exclude)
additionally accept a **frame-axis reference**: the string `"f1.x"` or
`"f1.y"`. It denotes the direction of that frame's axis.

- Resolution lives in one place (a `directionOf(model, ref)` beside the
  existing lazy plumbing in `relations/refs.ts`): a plain name resolves to
  a line's direction as today; `name.x`/`name.y` resolves through
  `frameBasis`. Names cannot contain dots today — verify and, if nothing
  enforces that, make `claimName` refuse them so the reference syntax can
  never collide with an entity name.
- **Datum semantics carry over**: an axis reference contributes direction
  and is never pushed — `frameBasis` is read as a value, exactly as
  `hor`/`ver` did it. Two ordinary lines in `par` still push each other,
  as today. The asymmetry is the established datum decision, not a new
  one.
- `par("l1", "f1.y")` is "vertical"; `par("l1", "f1.x")` is "horizontal";
  `perp` works symmetrically. The residual forms already exist — this is
  plumbing, not mathematics. Keep the normalised-direction rule `hor`/`ver`
  established for the frame side (the collapse exploit is documented in the
  register).

### Command layer

- Helpers `xaxis(frame?)` and `yaxis(frame?)` return the axis reference
  string, resolving the default frame when unnamed (the same
  resolve-at-call-time rule, same helpful error when there is no default).
  So the owner's example reads `par("l1", yaxis())` — close to his
  `*defaultframe.Y` sketch without new syntax in the evaluator.
- `hor`/`ver`/`horizontal`/`vertical` are **gone** from the command
  surface and from `relations/basic.ts`. Not deprecated, gone — the
  helpful error for an unknown name already says `no such name: hor`.
- `help()` updated; the frame section shows the `par(l, yaxis())` idiom.

### Everything downstream

- **Line tool inference**: infers `par(l, xaxis-of-default)` /
  `par(l, yaxis-of-default)` instead of `hor`/`ver`. Same gating on a
  default frame existing; the aim/guide code is unchanged (it already uses
  the frame's axes).
- **`fix` stays.** It is already frame-relative and names no privileged
  direction; the owner has not asked for more, and pinning-to-a-frame is
  not the temptation the words hor/ver were.
- **Glyphs**: the `—` and `|` symbols go with their relations; `par`/`perp`
  marks already exist. A `par` whose other side is an axis reference
  anchors on the line (there is no second line to midpoint against) —
  extend the anchor logic and test it.
- **Persistence**: journal ops `horizontal`/`vertical` leave the replay
  table. **Translate, don't reject**: an entry `horizontal(l, f)` replays
  as `parallel(l, "f.x")`, `vertical(l, f)` as `parallel(l, "f.y")` (note:
  parallel to y, not perp to x, so the glyph and `rels()` read naturally),
  point-form entries likewise against the frame they name. v2 files are
  hours old and all ours, but the translation is two lines and keeps the
  register's own screenshots' files openable. Bump `VERSION` to 3; a
  translated file re-saves in the new vocabulary (save(open(x)) ≠ x across
  this boundary — say so in the CHANGELOG).
- **Tests/e2e**: the churn is mechanical (`hor("l1")` →
  `par("l1", "f1.x")` or the helper form); read each as you touch it. The
  tilted-frame closed-form tests must survive with identical assertions.

## Verification

Unit: axis-reference resolution (valid, unknown frame, unknown suffix, a
dot-named entity refused at claimName); par/perp against axes solving to
the frame's exact tilt (the closed forms from the frames package, re-run
through the new spelling); datum asymmetry (axis side never moves); journal
translation (a v2 file with hor/ver opens, means the same geometry, and
re-saves in the new vocabulary); glyph anchoring for axis-referenced
par/perp. E2e: the frames poster story retold in the new vocabulary; the
line tool inferring `par` with axis references (rels() shows them); help()
and the no-default error paths. Full `npm run test:all` per commit.
Screenshots only where the story changed visually (glyph anchoring). Docs
duties per `CLAUDE.md`: the register's no-world-frame entry gains this
package's note; CHANGELOG explains the removal in the owner's terms.

## Delivery

Isolated worktree, branch `claude/retire-hor-ver` off the working-branch
tip after context-menu merges, PR against `claude/resume-tasks-o7q02e`.
Do not merge; the supervising session reviews.
