# Plan: an extrude makes no lid frame

**Status: built** (2026-11-03, branch `claude/no-lid-frame`): `Expansion`
(now `9 | 10 | 11`), the per-op `EXPANSION`, `extrudeBody` and
`rebuildFeature` in `src/operations.ts`; `ExtrudeFeature.top` optional in
`src/model.ts`; `MadePlane`, `FacePlane`, `facePlaneArgs` and `circleFrame` in
`src/sketchface.ts`; `frameOnFace` in `src/replenv.ts`; `describeFeature` in
`src/picking.ts`; `VERSION` 11 and `translate` in `src/persist.ts`;
`test/nolidframe.test.ts` and `test/e2e/nolidframe.e2e.ts`. Measured after: the
two rectangles are 16 points, none on another, one frame (19, three pairs and
three frames before). Deviations, each marked ⚠ below and listed in `TODO.md`'s
queue entry: the circle's plane has its origin on the twin centre, not a new
point; its refs are held on the rim and seeded with every digit; `EXPANSION` is
per operation; and one `hidden.e2e.ts` probe was loosened after it flipped on
anti-aliasing.

**Status when written: queued** (2026-11-03). Follow-up to the owner's report of
overlapping points (*"i'm getting a lot of overlapping points. why is this
happening?"* — *"of course it should"*) after `lid-frame-shares-points.md`:
that package made the lid frame reuse the lid's corner twins when the sketch
frame stands on the profile, but the common multi-region case still doubles.
Measured in the browser after the quiet-geometry merge: two rectangles,
extrude, a click in each, Enter — both share the first rectangle's sketch
frame, so for the second solid that frame stands off its profile, and its lid
frame makes three points of its own **on the first solid's lid corners**
(`p17`, `p18`, `p19` over the left box), each drawn, since a lid-frame point
ends no line.

## Why the lid frame can go

It was made "so a sketch on the cap has a plane". Sketch-on-face
(`sketchFrameFor`) now builds that plane from the cap's own points when the
user sketches there, so nothing about sketching needs it. What still reads
it: a twin circle or arc on the sketch frame is given the lid frame as its
plane (`planeFor` in `extrudeBody` and regeneration), and the depth
dimension pairs its points. A curve's frame is an *orientation*, not a
constraint (`CircleEntity`), and an extrude translates without turning, so the
twin can name **the sketch frame itself**. The lid frame is then a derived
datum nothing needs — clutter on every solid (a marker and up to three
points), and the source of this doubling. In the owner's flat model, fewer
made datums is the right direction.

**A revolve's end frames stay**: its end face is turned, so curves on it need
a turned orientation, and its end frames already share the end twins where
the sketch frame stands on the profile.

## Design

- New extrudes make **no lid frame**: twin curves on the sketch frame name
  the sketch frame; twins of curves on other frames keep their frame (as now);
  the depth dimension holds the corner, centre and radius pairs only. The
  feature record's `top` becomes absent for new features (optional in the
  type), and every reader handles that (`describeFeature` drops "lid fN",
  deletion, regeneration, `members`, quiet geometry, faces).
- **Sketch on a circular lid**: a whole circle whose frame's plane is not the
  circle's own (now true of every twin circle) has no three points on its
  face. `sketchFrameFor` then has the sketch command make the frame — a point
  at the centre typed with `pt(...)`, x-ref and y-ref seeded along the circle
  frame's axes, exactly as the curve tools make their plane — instead of
  refusing. Keep the refusal only where no orientation exists at all.
  ⚠ *As built:* `plane("pC", pt(…, oncircle(_, "cN")), pt(…, oncircle(_,
  "cN")))`. The origin is **the circle's own centre**, not a new point: one
  typed at the centre would lie exactly on the twin centre, which is a doubled
  point. The refs are **held on the rim**: a frame is a datum, so free refs
  never move, and when the depth is `set` the origin would rise without them
  and tip the plane. On the rim they rise with the top. They are **seeded with
  every digit**: seeded to three decimals as the curve tools type an origin,
  the holds pulled them back onto the rim and the cylinder's free radius gave
  way by 5e-5 (measured). `sketchFrameFor` returns the plane to make
  (`MadePlane`) alongside the three-names case. The only refusal left is a
  circle whose frame has collapsed; the old "no y-ref" refusal went, since
  every 3D frame has a +z.
- ⚠ *As built, not in the design:* **`EXPANSION` is per operation**,
  `{ extrude: 11, revolve: 10 }`, and a revolve refuses an expansion of `11`.
  A revolve is unchanged, and one number standing for two expansions would not
  say which one a file means.
- **Format 11.** Files of version 10 and below replay with the lid frame (the
  entry-marker pattern `lid-frame-shares-points` used: mark old extrude
  entries at translation so regeneration rebuilds them their way). Double-save
  byte-identity for old and new files.

## Verification

⚠ *As found:* `hidden.e2e.ts`'s stepped-block probe of the base's back line
read the most opaque pixel near it, where a sketch portion's dimmed stroke and
the base cap's dimmed solid line overlap. The sketch stroke's core went from
alpha 255 to 251 and the solid's won. The probe now asks that the sketch ink is
drawn there (see TODO.md).

Unit: a new extrude makes no frame; twin circles name the sketch frame and
draw and solve as before; depth `set` moves the lid exactly; regeneration
after a fillet; `del("e1")` takes exactly what it made; an old file reopens
with its lid frame and the same names; sketch on a circular lid works. E2e:
the measured case — two rectangles, extrude both, Enter — then read the model
for coincident point pairs (zero) and frames (only the sketch frame); a
cylinder's top sketched on with the sketch tool; LOOK at the screenshot: no
frame marker on either lid, no stray points. Full `npm run test:all` (give it
a two-hour limit; it takes 15+ minutes). Docs per `CLAUDE.md`: CHANGELOG at
the top quoting the owner; the register's lid-frame entries replaced (the
frame is gone and why); STATUS; this file marked built.

## Delivery

Isolated worktree, branch `claude/no-lid-frame` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews.
