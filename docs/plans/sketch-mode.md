# Plan: sketch on any plane or face, natively — on-plane relations as you draw, square to it when you start

**Status: queued** (2026-11-08). The owner: *"Not sure how it works right
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
