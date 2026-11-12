# Plan: a fillet is one thing — on the sketch or on the solid's edge, the same result, the old corner kept as construction

**Status: built** (2026-11-12, branch `claude/fillets-one-thing`; *Design,
made exact* and *As built* at the end say what was made against the code,
what differs from the sketch below and what was left). Queued after
`linked-profiles.md`, which it stands on. The owner: *"adding them* [2D chamfers/fillets] *to the originating
chain/loop of a region of a body shouldn't break the body. The change should
propagate through the entire hierarchy (yes: hierarchies do exist, but they
are not timeline based). Also, adding a 2d fillet to the originating chain
of a region of a body should produce an identical outcome to 3d filleting
that edge. Also, the previous geometry should not be deleted - as in the two
lines and corner point on the two linked sketches which form the extrude -
it should be made into construction geometry. Note: anything can be
construction. Lines, points, planes, bodies. Anything is fair game."* And
earlier: *"of course it would be silly not to allow fillets on one end
only."*

## Design (the first sketch; made exact against the code below, once linked profiles had landed)

1. **A sketch fillet or chamfer never deletes or re-points**: the two lines
   and their corner point stay, exactly as they were with every relation,
   and become **construction**; the arc (or the chamfer's line) and two
   shortened lines are new entities, tangent / coincident to the
   construction lines. On a profile that has a twin, the same happens on the
   twin in the same step, and the body rebuilds from the profiles'
   non-construction loop: the body is not broken, and nothing downstream
   that named the old lines loses its referent (they still exist).
2. **A fillet on a solid's vertical edge is the same thing**: picking the
   edge between two walls and filleting it makes exactly the entities of
   (1) on both profiles — same names, same relations, same journal line, the
   same body — so the two routes are indistinguishable afterwards. A test
   compares the two models entity for entity and the two bodies face for
   face.
3. **Edges that are not a profile corner** (a lid's rim, an edge between
   features): the fillet is the kernel's blend as today, on one end or both;
   the profile's lines are untouched and nothing becomes construction,
   because no sketch entity is replaced. A fillet of a profile corner **on
   one end only** makes that end's profile the filleted one and the other
   the sharp one: the pair no longer corresponds edge for edge at that
   corner, and the body between them is a loft of the two — say what the
   kernel can build, and where it cannot, refuse with the reason and file
   it.
4. **Anything can be construction**: lines, arcs, circles, ellipses and
   splines (today), and now **points, planes / frames, and bodies**. A
   construction thing is drawn in the construction ink, can be related to
   and dimensioned like any other, and is left out of what is built from it:
   a construction point bounds nothing, a construction plane is reference,
   a construction body is not exported, not a tool or target of a boolean
   unless picked as one, and is drawn as reference. One flag, one command
   (`construction(name)`), one row in the context menu, on every kind.
5. **Review item 7**: a chamfer face's sketch plane follows the solid or is
   refused (TODO.md's register).

## Tests, docs

As the other packages: unit 2D and 3D; e2e by mouse and iPhone 13 with
pictures looked at; the equality test of (2); CHANGELOG, STATUS,
ARCHITECTURE ("hierarchies exist, but they are not timeline based": what
depends on what, and that it is the relations, not an order of creation),
the register, `help()`.

## Design, made exact against the code (2026-11-12, before building)

Linked profiles landed with these facts the sketch of the design above did
not have (its *As built*): the link is the `extrusion`; a twin is a registry
entry named for its partner; a corner's two lines pair with the lid's by
their points; a pair flagged construction stays a pair; the `construction`
operation refused a feature's outline member and flagged only what it was
given; `relinkOpen` gives a line drawn on either profile its partner;
`rebuildFeature` re-makes a lid from the loops it is handed, keeping every
piece whose identity survives; regions walk past construction already. So:

1. **`fillet(l1, l2, r)` and `chamfer(l1, l2, d)` set the corner aside.**
   The two lines and their corner point are not re-pointed or deleted: they
   stay with every relation on them and are flagged construction. New: a
   tangent point on each line, held `on` it; a shorter line from each far
   end to its tangent point; the arc (or the chamfer's line) between them,
   `tan` to the two construction lines — the join form, since the arc's
   end is held on the line (`relations/geometry.ts`), not the distance form,
   which is a double root there. A second cut at the far end of a line
   already set aside shortens the *shorter line* in place (`cornerCut`'s
   piece), so a rectangle rounded at four corners is four construction
   lines, four real ones and four arcs. A line set aside **stands for** the
   shorter line made in its place wherever a loop is named by it
   (`standsFor`: `extrude("l1")`, `revolve`, `region`). Where the two lie
   along each other, the real one is what is meant: a chain (`offset`,
   `trim`, `extend`; `chainThrough`) runs past a construction curve unless
   asked from it, and a pick within half a pixel of both (`hitTest`) takes
   the real curve.
2. **A record standing on the corner follows, and sets aside its half**
   (`regenerateRounded`): the twin lines and corner, and the chord between
   the two corners, go on the record's `aside` list — kept, construction, no
   longer swept — and the record is rebuilt on the profile as it stands,
   the new lines and arc given twins and walls as any member is. The
   corner's pair stays in the `extrusion` (`rebuildBody` carries it), which
   is what keeps the two construction lines a pair. Then **the same cut, as
   the other profile has it**, is the next job: a solid standing on this
   one's lid is cut at that corner too, and so on up — what depends on what
   is read off the records and the links, never off the order of creation.
   A kernel fillet or chamfer that named a wall by its place is re-pointed
   to the place that wall has now (`remapBlends`).
3. **A fillet of the solid's edge between two walls is this call**
   (`blends.ts`, `profileCorner`): `filletEdges("e1", ["e1.m0|e1.m1"], r)`
   typed live is `fillet(l1, l2, r)` of the two lines those walls are swept
   from — the same entities, relations, record, journal entry and body, so
   the two routes cannot be told apart afterwards. A fillet asked of the
   **lid's** two lines is made on the profile the record is rebuilt from
   (`baseCorner`) and is the same call too. Every other edge — a lid's rim,
   a base's, an edge between two features, a round wall's — is the kernel's
   blend, one record, as before; a list of both kinds is both, the record
   first.
4. **Fillets on one end only**: a lid's rim edge rounded is the kernel's
   blend on that end, as today. A fillet of a *profile corner* on one end
   only — the lid's two lines rounded and the base's kept sharp — is not
   offered: the kernel wrapper has no loft, and the design's loft is not
   built. Filed in the register.
5. **Anything can be construction**: one flag (`Model.setConstruction`) on
   curves, points, frames and features (a feature's is its body's, on the
   body's first feature), one operation (`construction`), one row on every
   kind's menu. A construction **point** cuts no edge it is held on (loops.ts
   leaves a T made by one out); a construction **frame** is never the plane
   a feature is laid out by unless named (`orientingPlane`,
   `framesByPreference`); a construction **body** is drawn in the
   construction ink's teal (`referenceRGB`), left out of a STEP export and
   never the body a new feature joins or cuts unless named (`defaultMode`).
   A linked profile's entity is flagged **with its partner**, and an outline
   edge flagged leaves its extrude **open** (as a deleted edge does) until
   it is cleared, when it closes again — where it used to be refused. The
   origin cannot be construction. A point a record's profile is cut at is
   refused.
6. **Review item 7**: the sketch tool refuses a kernel chamfer's own face
   (`chamferOfFace`, `chamferFaceRefusal`), saying why and what works; a
   chamfer of a profile corner is a wall swept from a line now, sketched on
   like any wall and following the solid. The frame made on a chamfer's face
   is gone with it.
7. **Format 22.** `fillet` and `chamfer` mean something else; a file from
   before is marked `"repointed"` on each (cut as that build cut it, its
   later names kept) and `{ alone: true }` on each `construction` (what it
   named, no partner) by `translate`, and the marks stay when the file is
   saved again. The fixture `test/fixtures/fillets-v21.*` was written by the
   build before this one.

## Status: built (2026-11-12, branch `claude/fillets-one-thing`)

### As built

Everything in *Design, made exact* above is built as written. What differs
from the first sketch of the design, and what was found:

- **The corner point is construction only when every curve at it is**: a
  fillet told to regenerate nothing (a version-8 file's) leaves a wall of
  the record standing on the corner, and the corner stays a real point. The
  two lines are construction either way.
- **A lid built after the cut has no construction corner**: `extrude` of a
  profile already filleted sweeps the rounded loop, and the lid gets twins
  of the loop's members only. The fillet's radius and arc ends twin; its
  tangencies and holds name the two lines set aside, which that lid has no
  partner for. Filleting *after* the extrude (either route) gives both
  profiles the construction corner. Filed.
- **The round tool's preview is the kernel's blend** while ✓ types the
  sketch's fillet for a profile-corner edge: the same rounded body, two
  routes to it between the press and the ✓. The fillet tool's own preview
  (a copy of the model, through the command line) is the cut itself.
- **The `tan` relation reads a touching point**, not only a shared end: an
  arc end held `on` the line by `pointOnLine` is where the line touches it,
  and the row is the join (radius square to the line). Measured first with
  the distance form: `r9` redundant on a sketch-mode profile's fillet, the
  `on` and the distance a double root at the tangent point.
- **A replayed `filletEdges` is the record it names** (`model.journalling`
  gates the reroute): a file from before 22 may list a profile corner the
  kernel rounded then, and keeps it the kernel's.
- **A construction flag's partner is found through `partnersOf`**: a curve or
  point of either profile; a frame and a body have no partner.
- **The context menu's row** is typed over the curves of a selection where
  it has any, else over its points, planes and bodies; a body's organiser
  row has the row too, typed over the body's first feature.
- **Pictures** 490–496 (desktop), 500–503 (iPhone 13) — the table in
  CHANGELOG.md's entry.

### Tests

`test/filletsonething.test.ts` (16 tests: the corner kept on both profiles
and the body's volume; the two routes compared entity for entity and face
for face, fillet and chamfer; a fillet asked of the lid; a rim edge still
the kernel's; a mixed list and the blend's edges re-pointed; the hierarchy
through a boss on the lid; four corners; the fillet tool's corner click; a
construction point, frame and body; the partner flagged; the kernel
chamfer's face refused; the format-21 fixture; the marks refused where they
do not belong; a line set aside standing for its piece). The suites that
asserted the re-pointing fillet now assert the kept corner
(`regen.test.ts`, `sketch.test.ts`, `deletion.test.ts`, `sketchedit.test.ts`,
`construction.test.ts`, …). `test/e2e/filletsonething.e2e.ts`, mouse and
iPhone 13.
