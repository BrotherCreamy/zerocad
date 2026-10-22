# Plan: feature regeneration

**Status: built** (2026-10-22, branch `claude/feature-regeneration`; see
"As built" below for what differs from this text). Third of the register's "Next up" queue:
*"Feature regeneration when a profile is restructured after the feature
(today: documented no-op)."* Read `CLAUDE.md`, `docs/ARCHITECTURE.md`,
`docs/plans/3d-phase4-extrude.md`, `3d-phase5-revolve.md` and
`regions-split.md` (both "as built" sections), `src/operations.ts` end to end
(`fillet` — the one restructuring operation; `extrude`/`revolve` and their
expansions; `foundProfile`/`profileOf`; the feature records; the deletion
rules), `src/model.ts` (`ExtrudeFeature`, `RevolveFeature`, `retargetLine`,
`asOperation`, `deleteFeature`, the `REBUILD` machinery `set` uses), and the
register's 3D entries in `TODO.md`.

## The bug, measured first

Extrude a rectangle, then fillet one of its corners. `fillet` keeps the
corner point as leg one's tangent point (moved), re-targets leg two to a fresh
tangent point, and adds the arc. The feature's record still says the profile
is the four lines: leg two's twin still runs from the old corner's twin, there
is no twin for the new tangent point and no twin arc, and the wall still
stands on the corner. The lid is a rectangle over a rounded base — every
relation satisfied, visibly wrong. Reproduce it in a test and a screenshot
before fixing it; the CHANGELOG entry opens with that measurement.

*Corrected while building:* not quite a rectangle. The corner point is leg
one's tangent point after the fillet, and its twin is held over it, so the
lid's corner moves with it: measured on a 40 × 30 rectangle with a radius-8
fillet, the lid is a quadrilateral whose edge over leg two runs from over the
tangent point (32, 0) to the far corner (40, 30) — **leaning 14.9°** where the
leg is plumb. The wall at the corner stands on the tangent point, as the
corner does. Everything else above is as measured.

## The rule

**A feature's expansion is a function of its profile, and follows it.** When a
profile is restructured, the feature *regenerates*: its expansion is brought
back into step with the profile as it now is — **keeping every piece whose
identity survives**, so relations a user has put on a twin or a wall are kept
wherever the vertex or member they belong to still exists.

- **The profile is re-found the way the call found it**: the loop that now
  contains the feature's `member` in the feature's `frame`'s orientation, and
  every loop inside it (`foundProfile` with the frame; portions and
  materialised crossings exactly as a fresh call would resolve them). If no
  such loop exists any more, regeneration refuses by name and the feature is
  left as it was — a feature whose profile is gone is a deletion, not a
  regeneration, and `del` already does that.
- **Diff the old expansion against the new profile, per joined vertex class
  and per member:**
  - a vertex that survives keeps its twin point and its wall;
  - a member that survives with the same ends keeps its twin curve;
  - a member whose end was re-targeted (fillet's leg two) has its twin curve
    re-targeted to the new vertex's twin, mirroring the surgery with
    `retargetLine` — the twin line entity survives, so what refers to it does;
  - a new member (the fillet arc) gets a twin curve of its kind: an arc about
    the twin of its centre, between the twins of its ends; a new vertex gets
    a twin point and a wall;
  - a vertex that has left the profile loses its wall and its twin point, by
    the ordinary cascade (what referred to them goes with them, as deletion
    documents);
  - crossings the new profile runs through are materialised as PR 2 of the
    regions package does, and a materialised point the profile no longer
    runs through is released like a vanished vertex.
- **The depth (or angle) dimension keeps its name and value** and is rebuilt
  so it holds exactly the new twins — the `REBUILD` path `set` already uses,
  not a second mechanism. The lid frame keeps its name and points.
- **The record is rewritten** (loops, twins, walls, names, owns) and the
  feature keeps its name.

## When it happens

- **Automatically, as part of the restructuring operation.** `fillet` ends by
  regenerating every feature whose profile names either leg (or a portion of
  one), inside its own `asOperation`, so the journal stays *one call* —
  `fillet(...)` — and a replay regenerates by running the same code. This is
  Onshape's behaviour (a sketch edit regenerates the features on it) and the
  journal-as-the-call rule together. Today `fillet` is the only restructuring
  operation; write the hook so the next one (whatever re-points or replaces
  a profile member) calls the same function.
- **Explicitly: `regen(feature)`**, an operation and command (`asOperation`,
  journalled as itself, listed in `help()`), for anything that restructures
  a profile without going through an operation. Refuses an unknown or
  non-feature name.
- Not on a solve, a drag or a `set`: those move geometry, they do not
  restructure it, and a feature's faces are read off live geometry already.

## Verification

Unit: the measured bug, then fillet-after-extrude regenerates (five twins,
a twin arc, five walls, the dimension holding five, the record rewritten, the
feature name kept); a relation on a surviving twin survives, one on the
vanished corner's wall is gone (*corrected:* a fillet vanishes no corner — the
corner survives as leg one's tangent point, and its wall with it — so the
vanished wall is tested with `regen` after a line drawn across the plate); fillet of a corner that two features share
(a plate and a boss on its lid? — or two extrudes from one sketch, PR 2's
stepped block) regenerates both; a revolve regenerates likewise (end twins
for a partial turn); `regen` on an untouched feature is a no-op that journals
once and changes no names; regeneration when the profile has gone refuses;
journal replay of a save with a fillet-after-extrude reproduces the same
names; double-save byte-identity; undo of the fillet is one step and brings
the four-cornered lid back. E2e: extrude the rectangle tool's rectangle, fillet
a corner with the fillet tool, orbit — LOOK: the lid is rounded exactly as the
base; `set` the depth; undo; save/open. Full `npm run test:all`. Docs per
`CLAUDE.md`: CHANGELOG at the top; the queue item ticked; the "expanded once"
caveats in STATUS and the register's 3D entry replaced by the rule; this file
marked built.

## Delivery

Isolated worktree, branch `claude/feature-regeneration` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e` (two reviewable commits if
it outgrows one hand: the diff-and-rebuild, then the triggers). Do not merge;
the supervising session reviews.

## As built (2026-10-22)

Everything above, in one PR of reviewable commits (the diff and rebuild with
its explicit door `regen`; then `fillet`'s trigger and the file format; then
the docs), with these differences — each also in `TODO.md`'s queue entry and
the PR:

- **The journal carries what was regenerated, resolved.** "A replay
  regenerates by running the same code" is true of the diff and rebuild, but
  not of the *finding*: a replay runs on seeds, and a profile of free lines
  has no loop there — extrude's measured reason for journalling its profile
  resolved. So the call writes in what it found, as extrude does:
  `fillet(l1, l2, r, frame, [["e1", loops], …])` — the fifth argument only
  when a feature stood on a leg, so every other fillet's entry is the one it
  always was — and `regen("e1", [["e1", loops], …])`. A replay handed the list
  walks those profiles by their joins and finds nothing. A crossing the new
  profile runs through is materialised at the call and named in the list, as
  PR 2 of regions-split names its points. Still one entry, still the call.
  *Rejected:* splicing the arc into the old profile by structure (position-free,
  so the entry would not have had to change) — it cannot see a crossing the
  new arc makes or a hole drawn since, and `regen` needs the finder anyway;
  two ways to know a profile would one day disagree.
- **Format version 9.** `fillet` now means more, and a version-8 build would
  replay a version-9 fillet without the lid, silently, with every name the
  regeneration made missing from under the later entries. Going the other
  way, a version-8 file's fillet with a feature on a leg is translated to
  regenerate nothing — the empty list, what its build did; regenerating it
  would claim auto-names the file's later entries already hold.
- **`fillet` does not refuse when a feature cannot be regenerated.** By then
  it has rounded the sketch, and refusing after a change is what `asOperation`
  forbids. That feature is left as it was — the behaviour before this package,
  for that one feature — and `regen("e1")` says why, by name. `regen` itself
  finds and plans before it changes anything, so its refusal is clean.
- **The chain** (not in the text above): a feature whose profile names a twin
  line one of the regenerations re-pointed — a solid extruded on the lid — is
  regenerated next, in the same call, and named in the same list.
- **A twin arc or circle whose ends or centre change is made again**, not
  re-pointed: the model has no primitive for re-pointing an arc's end, and no
  operation has needed one. A line twin is re-pointed with `retargetLine`.
- **A member in several loops parallel to the frame** (an edge two regions
  share) takes the loop keeping most of the old outline; a tie is refused.
- **Loops keep the record's order**: a loop whose members are unchanged is the
  record's own, and a changed one starts at and walks the way of the record's
  first surviving member, so the record reads `l1,a1,l2,l3,l4` and a no-op
  `regen` moves no pair in the dimension.
- **`Model.rewriteFeature`** (new): a record replaced in place — same name,
  same position in the registry — checked as `addFeature` checks a new one.
- **The e2e** is its own file, `test/e2e/regen.e2e.ts`; screenshots 78 (the
  bug, taken on the code before the fix), 79 and 80.

*Found while building, left deliberately:*

- `fillet`'s tangent point solves about 2e-3 off its closed form (32.002 for 32,
  maxResidual ~1e-7): a point sliding along a tangent line leaves the circle
  by δ²/2r, so the residual is second order in the slide. Pre-existing, and
  not this package's; tests compare twins with their bases, which is linear.
- The chain follows re-pointed twin lines only, so a hole `regen` gives a lid
  reaches a solid already on that lid only when that solid is `regen`'d.
- A fillet on a *lid* corner regenerates what stands on the lid, not the
  feature that owns it — a lid is not a profile — and conflicts with that
  feature's depth, as it always did.
