# Plan: an oracle of parts with hand-derived answers

**Status: spec** (2026-11-26). The first of the SolidCraft pointers filed at
the top of TODO's *Next up*: tangency-labs/solidcraft replays ninety recipes
by command and checks each body's volume, area, centroid and bounding box
against a closed form worked out by hand, with the derivation beside the
number and the rule that **no expected value ever comes from the program's
own run**. Read there, not copied; their kernel is a port of the SMLib we
compile, so what their oracle catches is what ours would.

## Why

Bugs 80–86 all passed the unit suite. Three of them (80, 83, 84) left a body
the kernel built and the status called SOLVED that was simply the wrong
body: a boss where a hole was asked for, a cut leaning, a lens cut facing
the wrong way. Nothing in the repo asks *is this the solid the drawing
describes?* The walkthrough gate now asks it once (the hole's volume to
1e-3). The oracle asks it for a dozen parts, headlessly, in seconds, with
answers that cannot be wrong the same way the program is.

## What

`test/oracle/` holds one folder per case:

- `recipe.txt` — the commands, one per line, **the same ones the owner types
  at the command line** (`Repl` over `neocadScope`, as `test/clauses.test.ts`
  runs them headlessly): points, lines, `rect`, circles, relations,
  `extrude`, `revolve`, `fillet`, `shell`, cut and through-all. A recipe is
  readable by a person who knows the app and nothing else.
- `expected.json` — `volume`, `area`, `bbox` (`[min, max]`), `faces` where
  the geometry fixes the count, each with the tolerance the case states
  (relative for volume and area, absolute as a share of the part's size
  for the box), and a `derivation` string in words: the formula and the
  numbers that go into it.

`test/oracle/derive.ts` is one function per case that computes the expected
values **from the formula in code** (prisms, cylinders, Pappus for a revolve,
Steiner for a filleted box, the circular segment for the owner's lens,
`r²(1 − π/4)·L` for a fillet's spandrel). Running it regenerates every
`expected.json`; a unit test asserts the committed file equals what
`derive.ts` gives, so the derivation and the number can never drift apart.
`test/oracle.test.ts` then replays each recipe, waits for the kernel's
settled body (`settledBodies` as in `test/bodies.test.ts`), and compares.
Each case is also saved and opened again (`save`/`open` from `persist.ts`)
and measured a second time: the same body after a round trip, or bug 86's
family has a second net.

### The rule, stated in CONTRIBUTING.md under Tests

*An expected value needs a derivation. Never take one from the program's
own output, never loosen a tolerance to fit what the kernel now gives, and
never mark a failing case skipped: a case that fails names its bug in
TODO and stays red until the fix lands. A new case beside an old one is
always allowed.*

## The first dozen cases

Each with its closed form; the worker checks every formula, the spec is
not the derivation.

1. **box** — the walkthrough's plate, 80 × 80 × 10, by the Rectangle tool's
   commands and `extrude`. V = abc, A = 2(ab + bc + ca), 6 faces.
2. **box-through-hole** — the plate with a circle on its lid cut through all
   (the walkthrough). V = abc − πr²c, A = 2(ab + bc + ca) − 2πr² + 2πrc.
3. **box-blind-hole** — the same cut to depth h < c: V = abc − πr²h,
   A = 2(ab + bc + ca) − πr² + 2πrh + πr² (the floor).
4. **box-edge-lens** — the owner's file: the circle crossing the plate's
   edge, cut through all. The removed prism's section is the circular
   segment inside the plate: with d the centre's distance outside the edge
   line (negative inside), the segment area is
   r² acos(d/r) − d √(r² − d²); V = abc − (segment)·c; the area loses the
   two segments and the chord's strip (2√(r² − d²)·c) and gains the arc's
   wall (2r·acos(d/r)·c). Two recipes: centre inside the edge and centre
   outside (the D-notch of docs/images/564).
5. **cylinder** — a circle on the origin plane, extruded h: V = πr²h,
   A = 2πr² + 2πrh, 3 faces.
6. **boss-on-plate** — the owner's part (`ownersPart` in bodies.test.ts):
   plate plus a cylinder joined on a face. V and A by the union of
   disjoint-interior solids, the joined disc removed from both areas.
7. **tube by revolve** — a rectangle off the axis revolved 360°: annulus
   V = π(R² − r²)h, A = 2π(R² − r²) + 2π(R + r)h.
8. **vase by revolve** — a profile with one arc revolved: Pappus,
   V = 2π ∫x dA, A = 2π ∫x ds over the profile's edges (the arc's zone as a
   torus zone). The worker writes the integrals out in `derive.ts`.
9. **fillet-one-edge** — the box with one straight edge rounded r: the
   spandrel r²(1 − π/4)·L leaves; the area loses 2rL and gains (πr/2)·L.
10. **fillet-four-edges** — the plate's four vertical edges rounded: four
    spandrels, the perimeter 2(a + b) − 8r + 2πr.
11. **shell** — the box shelled inward t with the lid open: box minus the
    cavity, the rim counted. (If our `shell` keeps the lid, state which
    face is removed and derive for that.)
12. **cut-that-splits** — a slot cut right across the plate leaves two
    boxes: V = 2·(a′bc), A = 2·2(a′b + bc + ca′), body count 2 if the app
    reports two, else the case documents what it reports and asserts V.

A case whose operation the app refuses or builds wrong is a bug: number it
(the count is **eighty-six** today, in CLAUDE.md, CONTRIBUTING.md,
test/e2e/harness.ts and docs/ARCHITECTURE.md), list it in ARCHITECTURE,
keep the case red, file it in TODO, and go on with the others. Do not fix
the app in this package unless the fix is one line and obviously right;
the oracle's job is to find, this time.

## Measurements the report must carry

- What SMLib actually returns against each closed form, to the digit, so
  the tolerances are *chosen from the error*, not guessed: a box should be
  exact to 1e-12 relative; an analytic cylinder near it; a revolved arc
  (NURBS) will show the approximation's size. State each case's bar from
  its measured error with a margin of ten, never looser than 1e-6
  relative without saying why in the case.
- The suite's wall time (it belongs in `npm test`, so it must stay within
  seconds; if the kernel's settling makes it longer, say how long and why).
- One deliberate proof that the net holds: with `cutWay`'s sign flipped
  (bug 80's mistake) by hand, which cases go red; put the list in the
  CHANGELOG and revert the flip. Not committed as a mutant, just measured.

## Out of scope, filed not built

- A centroid: `SolidKernel` has `volume` and `bbox`, no centroid. If
  SM_API's mass-property call gives it and the glue export is a dozen lines
  (`scripts/solids/glue.cpp`, `exports.txt`) and `build:solids` rebuilds
  from its cache in minutes, add `centroid(s)` and assert it; otherwise
  file it in TODO with what it would take.
- Surface-distance against a reference mesh, FreeCAD as a second kernel,
  mutation testing proper (cargo-mutants has no TypeScript twin worth a
  dependency): filed in TODO as the oracle's next steps.

## Done means

`npm test` runs the oracle (skipped, as the other kernel tests are, when
the solid kernel is not built); every case has a derivation in code and in
words; CONTRIBUTING carries the rule; CHANGELOG at the top with the error
table and the flipped-sign proof; TODO's SolidCraft item 1 ticked with what
was found; STATUS names the suite; CONVERSATION_LOG says why recipes are
command lines and not journals (a person can read and retype them; a
journal is the program's own record and could carry the program's own
mistake).
