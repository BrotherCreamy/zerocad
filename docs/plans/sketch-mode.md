# Plan: sketch on any plane or face, natively — on-plane relations as you draw, square to it when you start

> **The word "sketch" is retired** (2026-11-12, the owner: *"There is no such
> thing as a sketch"*): the tool is the Plane tool, the menu item "Draw on
> this face", the workbench "Drawing". This file keeps its name and its words
> as history; see [`no-sketch.md`](no-sketch.md).

**Status: built** (2026-11-08), branch `claude/sketch-mode`, PR against
`claude/resume-tasks-o7q02e`. The *Walkthrough* (what was measured before
anything changed) and *As built* (what was decided) are at the bottom.

The owner: *"Not sure how it works right
now but I need a way to natively sketch on a plane without it being a special
feature. It should just add 'on plane' relations to each entity as it gets
sketched. Also when I select this mode it should go normal to the plane/face."*

## What is true today (much of it already exists; the owner can't see it)

- **The sketch tool** (`src/tools/sketch.ts`): click inside a face and it
  types `workplane("a.b.c")`.
  - That sets the **work plane**, which is not a feature and makes nothing
    (`frameless-curves.md`), and turns the view square-on.
  - Drawing tools then hold what they make on it with `onPlane`
    (`src/tools/place.ts`).
  - `activeplane.ts` draws the plane and dims what is out of focus.
- So the owner's model is roughly the house's already. But:
  - **A face here means a loop.** It must be a closed outline the tool can
    find. A plain plane (the ground's XY, XZ, YZ, a frame's plane) or a solid
    face the kernel made (after a fillet or a boolean) may not be pickable.
    Check each.
  - **Every drawing tool must be checked**: point, line, rectangle, polygon,
    slot, circle, arc, ellipse, spline, and the copies offset, mirror and
    pattern make. Each point of each must get `onPlane` when drawn on the work
    plane. Some may hold only a centre, deliberately (see place.ts on curves),
    or nothing.
  - **Leaving the plane is unclear**: how you exit, and what the mode chip
    says.
  - **The owner doesn't know it exists**: "Not sure how it works right now".

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (the work plane, frames, why a
sketch is not a feature), `docs/plans/sketch-on-face.md`,
`frameless-curves.md`, `mode-feedback.md`, `coordinate-frames.md`,
`no-lid-frame.md`, `src/tools/sketch.ts`, `place.ts`, `src/sketchface.ts`,
`src/activeplane.ts`, `src/modechip.ts`, `src/modes.ts`, the `workplane`
command, and the sketch-on-face e2e files.

## First: walk it

1. Open the app fresh on an iPhone 13 and by mouse.
2. Try to sketch on:
   - the ground;
   - the front plane (XZ);
   - the side plane (YZ);
   - a block's top;
   - a block's side wall;
   - a filleted block's flat face;
   - a revolve's end;
   - a plane at an angle.
3. Draw one of every kind on each, and count the `onPlane` relations each made
   against the points it made.
4. Take pictures and look at them.
5. Write the findings into the spec's *Walkthrough*.

## Design

1. **Sketch mode is a mode, not a feature.** It means: the work plane is set,
   the view is square to it, and everything drawn is held on it by `onPlane`,
   one relation per point.
   - It is a relation like any other: deletable, shown as a glyph only when
     asked (glyph clutter is a known problem; keep it quiet).
   - A curve's own plane follows from its points' relations; don't add a
     second relation for a circle's normal unless one is needed, and say
     which.
   - Every tool (the list above, plus anything else that makes points)
     complies. Copies made by offset, mirror and pattern of on-plane geometry
     are held to the same plane.
2. **Pick what to sketch on**: any planar thing.
   - The ground's three planes, offered as named planes (Top, Front, Right),
     pickable in the view and from a short list in the sketch tool's options.
   - Any frame's plane.
   - Any planar face of a solid, including faces the kernel made (from the
     kernel's B-rep face and its plane). Today the tool takes only loops of
     model points.
   - Three picked points.
   - Hover lights the plane; the commit is still `workplane(…)`, typed, one
     undo step.
   - A kernel face has no model points. Say how its plane is held: by a
     frame made at the face (a "construction plane"), or by the feature's
     points if it maps to them. The owner said *"without it being a special
     feature"*, so a plane made for this must be a plain frame or reference,
     not a feature in the organiser's feature list.
3. **Normal to it, on entering.** The view turns square-on, animated briefly
   if the house animates view changes; otherwise snapped, said in the
   register. "Look at the plane" is also a button in sketch mode, as
   SolidWorks' Normal To is, for when you've orbited away.
4. **Leaving**:
   - An explicit **Exit sketch** (a ✓ in the mode chip or the tool's
     options), plus Escape with nothing armed.
   - Leaving returns the view to where it was before entering, or stays
     there; choose and say which.
   - The mode chip names the plane ("Sketch on e1's top").
5. **Discoverable**: the sketch button's tooltip and `help()` say this in a
   sentence. Read sketch-on-face.md's history, and don't undo a decision the
   owner made there without saying so.

## Tests

- **Unit**:
  - For every drawing tool, drawn on a work plane in 3D: every point it made
    is held by `onPlane` to that plane. Table-driven, so a new tool that
    forgets fails.
  - Copies by offset, mirror and pattern likewise.
  - Sketching on a kernel-made face, and on Front and Right.
  - Moving the solid moves the sketch held to its face (if the plane is held
    to the feature).
  - Save/open.
- **E2E, mouse and iPhone 13**:
  - Pick the Front plane: the view goes square, then draw a rectangle and a
    spline, then orbit. Both lie in the plane and the view shows it.
  - Pick a filleted block's side face, then draw a circle on it.
  - Normal To after orbiting.
  - Exit sketch.
  - LOOK at every picture.

## Docs

- CHANGELOG at the top, quoting the owner.
- STATUS.
- ARCHITECTURE: what sketch mode is.
- The register: the named planes, kernel-face planes, the view on exit.
- `help()`.
- The spec marked built, with its *Walkthrough*.

## Walkthrough

Walked 2026-11-08 before any change, by mouse in the app and by a
table-driven unit harness that drives every drawing tool on a work plane
(`test/sketchmode.test.ts` started as it). Pictures 380 and 381.

**Every tool already held every point.** On the ground (`workplane("origin")`),
a block's top, a block's side wall, a revolve's end, a cylinder's top (a
circle's plane), a tilted frame and three points at an angle, free clicks
gave exactly one `onPlane` per point made, every point on the plane, every
drawing solved:

| tool | points made | `onPlane`, before | after |
|---|---|---|---|
| point | 1 | 1 | 1 |
| line (two segments) | 3 | 3 | 3 |
| rectangle | 4 | 4 | 4 |
| polygon (hexagon) | 7 | 7 | 7 |
| slot | 6 | 6 | 6 |
| circle, centre | 1 | 1 | 1 |
| circle, 3 points | 4 | 4 | 4 |
| arc, centre | 3 | 3 | 3 |
| arc, 3 points | 3 | 3 | 3 |
| ellipse | 2 | 2 | 2 |
| spline (4 points) | 4 | 4 | 4 |
| on Front or Right | — | not possible: no name for the plane | as above |

Copies, on a tilted frame (a rectangle and a circle, every point held):

| operation | copied points | `onPlane`, before | held, pushed off the plane? | after |
|---|---|---|---|---|
| offset | 4 | 0 | **no — stayed off** | 4, held |
| mirror | 5 | 0 | yes, by `sym` | 5 |
| linear pattern | 10 | 0 (1 on a face plane) | yes, by `translated` | 10 |
| circular pattern | 10–15 | 0 | yes, by `rotated` | all |

The gaps were elsewhere:

- **The ground was not pickable, and Front and Right could not be named.**
  In a fresh document the sketch tool lit nothing and a click said "no
  closed outline yet". `workplane("origin")` worked typed; nothing named
  the x–z or y–z plane.
- **Offset copies floated**: `par` and `dist` hold a copied line at a
  distance from its original in any direction round it, so a copied
  rectangle could slide off along the normal.
- **Mirror and pattern copies were dimmed**: in the plane by their own
  relations, but held by no `onPlane`, which is what the focus reads.
- **A spline drawn on the plane was dimmed** — the focus had no rule for a
  spline (picture 381) — and **every spline point wore a ▱**, the onPlane
  glyph, drawn wherever a point was not quiet.
- **A filleted block's flat faces worked** — the wall and lid are still
  loops of the feature's points — but a **chamfer's face**, which no loop
  bounds, sketched on the lid behind it (the lid's loop still spans the
  corner the kernel cut away, and is nearer the eye).
- **Leaving was the chip's Done only.** Escape with nothing armed did
  nothing; the view stayed where it was.
- **Normal To was two taps away**, in the chip's plane menu.
- **The owner could not know any of it**: the tool's tooltip said "click
  inside the face", and help() described sketch on face but not a mode.

## As built

- **Front and Right are plane references**, `"origin.xz"` and `"origin.yz"`,
  like Top's `"origin"` — and any frame's `"f1.xz"`, `"f1.yz"` by the same
  rule (`parseFramePlane`, model.ts). Nothing is made when one is chosen.
  x–z runs +x, +z with its normal −y; y–z runs +y, +z with its normal +x, so
  each faces the way it is looked at from. On them `xaxis()`/`yaxis()` are
  the plane's own, so on Front `par(l, yaxis())` is upright.
- **The sketch tool picks**, nearest first: a face (a loop, held by the
  feature's points, as before); a flat kernel face no loop bounds, by a
  frame made at it (`kernelplane.ts`); Top, Front and Right as faint
  patches round the origin while it is armed, and as one-tap buttons in its
  options. Armed with a frame or three points selected, their plane. Every
  pick is one typed `workplane(…)`, one undo step.
- **Copies are held to the plane**: offset, mirror and both patterns add one
  `onPlane` per copied point, on every plane its original was held on that
  the operation maps onto itself.
- **The chip** names the ground's planes Top, Front, Right; gains ⊥ (Normal
  To, `lookAt(ref)`) beside Done. **Escape with nothing armed and nothing
  selected** types Done for a work plane. **The view stays** where it is on
  leaving.
- **The ▱ is quiet**: an `onPlane` mark is drawn only while its point is
  revealed (hovered, selected, just placed).
- **lookAt turns about the middle of a face's three points** and brings it
  on screen if it would land off it (found on the iPhone).
- **A spline, and any declared kind, is in focus** by the points it is
  built of.
- Every choice above is in TODO.md's register, vetoable.

Not built, and why:

- **No second relation for a curve's normal** beyond the `par` the curve
  tools already add: a circle's plane does not follow from its centre's
  `onPlane` (it can turn about it), so the `par` stays, one per curve. A
  spline's and a polygon's plane follow from their points' relations, and
  get nothing more.
- **A kernel-only face's frame does not follow the solid.** The face has no
  model points to hold a frame by. Sketching on a chamfer and then changing
  the chamfer leaves the sketch where the face was.
- **The view is snapped, not animated**: nothing in the house animates a view
  change.
- **Picking a solid's faces for anything but a sketch plane** is the smart
  dimension package's, and `kernelplane.ts` reads only a face's plane.
