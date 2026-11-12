# Plan: a fillet is one thing — on the sketch or on the solid's edge, the same result, the old corner kept as construction

**Status: queued, after `linked-profiles.md`** (2026-11-12), which it stands
on. The owner: *"adding them* [2D chamfers/fillets] *to the originating
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

## Design (to be made exact against the code when linked profiles has landed)

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
