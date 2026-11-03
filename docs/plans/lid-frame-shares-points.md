# Plan: a lid frame shares the lid's own points

**Status: built** (2026-11-03, branch `claude/lid-frame-shares`) —
`frameOver`, `sweptFrames`, `Expansion` and the bodies of `extrudeBody`,
`revolveBody` and `rebuildFeature` in `src/operations.ts`; the frame-pair dedupe
in `src/relations/revolution.ts`; `expansion` on the records in `src/model.ts`;
`VERSION` 10 and `translate` in `src/persist.ts`; `test/lidframe.test.ts` and
`test/e2e/lidframe.e2e.ts`. Measured after: the plate below is 14 points, no
two on one spot. Deviations, each marked ⚠ below and listed in `TODO.md`'s
queue entry: the old expansion is written into the entry (`extrude(…, loops,
9)`), not chosen from the file's version at replay; every pre-10 extrude and
partial revolve is marked; a revolve keeps its end frame as a frame pair and the
relation skips points a corner holds; regeneration also merges a sketch-frame
point that comes into the profile; and the e2e found one doubled label that is
the line tool's, not the lid's, which it asserts and leaves.

**Status when written: queued** (2026-11-03). The owner, on a screenshot of doubled point
labels on an extruded plate: *"i'm getting a lot of overlapping points. why is
this happening?"* — and, told why and what the fix would be, *"of course it
should."*

## What was measured

A plate with a triangular hole, frameless, extruded by the tool: 17 points,
three pairs on one spot each, all on the lid — `p8 = p11`, `p9 = p12`,
`p10 = p14`. The lid frame (`f2`) always makes **its own three points**, the
sketch frame's three moved by the depth. Since `extrude-makes-its-plane`, a
frameless sketch's frame is built from three of the outline's own corners, so
the lid frame's three new points land exactly on three lid corner twins, held
there by the depth dimension. Revolve's end frames follow the same pattern
(their points are the sketch frame's turned), so a partial revolve doubles the
same way.

## The rule

**A frame a feature makes reuses an entity the feature already makes at the
same place.** For each of the sketch frame's three points: if it is a profile
vertex (it has a twin in the expansion), the lid frame takes that twin; if
not (a frame floating off the profile, a user's `plane()` elsewhere), it makes
its own point as now. Same for each revolve end frame and each extra frame a
profile curve lies on (`twinFrame` in the revolve body). ⚠ *Corrected: this
said "and its extrude counterpart", and there is none — an extrude never twins
a curve's other frame (a translated frame keeps its orientation, so an
off-sketch curve's twin stays on that frame); the lid frame is the only frame
an extrude makes.* The depth (angle) dimension then holds no duplicate pairs: a
shared point's pair is already in the corner pairs; add only the frame points
that were made. ⚠ *As built for revolve: the end frame stays in the angle's
arguments as a frame pair, since that is how `revolution` knows the sketch
frame's points are a datum, and the relation holds a frame point only where no
corner pair already does.* Regeneration (`rebuildFeature`), deletion (`owns`, the
cascade) and the "lid frame's own" exclusion in regeneration's pairing all
follow: a shared point is owned once, as a twin. ⚠ *As built, regeneration
also takes the rule the other way: a sketch-frame point the profile comes to
run through takes the lid point already above it as its twin; a lid point
whose corner leaves the profile stays as the frame's own.*

## Format

Fewer points means different auto-names for everything after an extrude in a
replay, so this is a **format bump to 10**. A file of version ≤ 9 replays
with the old expansion — the operation takes the version-dependent choice the
way the version-8 fillet translation does (read `persist.ts` and match its
pattern); a new file journals nothing new (the call is the same; the code is
what changed). Double-save byte-identity for both an old file reopened and a
new one. Say in the code why the old path is kept.

⚠ *As built: the choice is written into the entry, as the fillet translation
writes its empty list.* `translate` gives every `extrude`, and every partial
`revolve`, from a file of version ≤ 9 a last argument `9`; the operation reads
it as "expand as version 9 did", and the feature record keeps it so
regeneration does too. Choosing from the file's version at replay was not
enough: a reopened old file saves as version 10, and its extrudes must go on
meaning the old expansion. *Every* such entry is marked, not only those whose
frame stood on the profile, because a later `regen` can bring a sketch-frame
point into the profile and the expansions differ there. A whole turn makes no
frame and is untouched.

## Verification

Unit: the owner's plate with a hole — after the extrude no two point entities
share a position (the measurement above, inverted: zero pairs); a lid frame on
a floating sketch frame still has its own points; a partial revolve's end
frame shares the end twins; regeneration after a fillet keeps zero pairs;
`del("e1")` takes exactly what it made; a version-9 file with an extrude and a
relation on a later-named point reopens with the same names and solves; v10
round-trip. E2e: the owner's sequence (rectangle, triangle inside, extrude
tool, Enter), orbit, read the model for coincident point pairs (zero) and
LOOK at the screenshot: no doubled labels.
⚠ *As found: with the line tool, the triangle's closing click makes a point
of its own on the first and `coin`s it there, so the sketch has one joined pair
and shows two names at that corner. That is the line tool's, not the lid's
(the lid has one twin there); the e2e asserts no unjoined pair and exactly that
one join, and TODO.md records it.* Full `npm run test:all`. Docs per
`CLAUDE.md`: CHANGELOG at the top quoting the owner; the register's
"the lid frame always has its own three points" decision replaced, in his
words; STATUS; `persist.ts`'s version notes; this file marked built.

## Delivery

Isolated worktree, branch `claude/lid-frame-shares` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews. Another package (`groups.md`) runs at the same
time and adds new journal ops without a format bump; you own the bump to 10.
