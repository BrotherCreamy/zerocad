// The one relation an extrude is held by: every twin on the lid is its base
// moved `depth` along a frame's +z.
//
// It is a **dimension** — `d`-named, with a `.value` — because the depth is
// the one number a solid has that a user goes back and edits:
// `set("d9.value", 40)` re-runs this with the new depth, in place, under the
// same name (see `set` in operations.ts, and its REBUILD line). It is **one**
// relation with a block per pair rather than a relation per pair for the same
// reason: one depth, one name, one thing to set. Twenty `dist`s would be
// twenty numbers that ought always to agree and could be edited apart.
//
// Nothing calls this but the expansion inside `extrude` (and `set`, re-running
// it), so it is not on the command surface and never journals itself: the
// operation is the journal entry, and replaying it calls this again. A bare
// extrusion with no feature around it would be a `d` with nothing to draw.

import type { Model } from "../model.ts";
import { curveNormal, joinVars, planeBasis, unitDuals } from "./refs.ts";
import { ORIGIN, referentsOf } from "../model.ts";

/**
 * Holds each `twin` at its `base` plus `depth` along `frame`'s +z.
 *
 * `pairs` is flat — `base₁, twin₁, base₂, twin₂, …` — and every name sits at
 * the top level of the recorded arguments for a reason that is not tidiness:
 * `del`'s reference scan and the primitives' refusals read a relation's
 * arguments name by name (`relationsNaming`), so a twin buried in a nested
 * array could be deleted out from under the block still reading it. A pair is
 * two points or two circular entities (circles or arcs):
 *
 * - **Two points**: three residuals, `twin − base − depth·ẑ`, one per
 *   coordinate. Linear in both points and in nothing squared — the house rule,
 *   since a squared distance has no gradient at its own root — and exact
 *   rather than merely a distance, so the lid cannot slide sideways along the
 *   plane while keeping its height.
 * - **Two circles or arcs**: one residual, `r_twin − r_base`. The twin's centre
 *   and ends are held by their point pairs; this is what keeps a twin circle,
 *   which has no ends, the size of the one it twins.
 *
 * **The frame is a datum, read and never pushed** — the rule every relation
 * written against a frame keeps (see `frameBasis`). Its +z reaches the
 * residual as plain numbers, so the solver cannot satisfy a stretched lid by
 * turning the sketch plane. And a `base` that is one of the frame's own points
 * — an old file's lid-frame pairs, whose bases are the sketch frame's origin
 * and refs (today's extrude makes no lid frame) — is read as plain numbers
 * too, so that lid frame follows the sketch frame and can never drag it.
 *
 * 3D only: in 2D there is no direction out of the plane to offset along.
 * Refuses a depth of zero (a lid on its base is no solid) and anything not a
 * finite number — and because `set` rebuilds through here, a refused value
 * leaves the old depth exactly as it was.
 */
export function extrusion(model: Model, frame: string, depth: number, ...pairs: string[]): string {
  if (model.dim !== 3) throw new Error("an extrusion needs a 3D model — in 2D there is no direction out of the plane");
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth === 0) {
    throw new Error(`an extrusion needs a non-zero depth, got ${JSON.stringify(depth)}`);
  }
  if (pairs.length === 0 || pairs.length % 2 !== 0) throw new Error("an extrusion takes base/twin pairs");
  // `frame` is any plane reference (`Model.planeKind`) — a frame, the origin, a
  // curve of the profile, or three of its points — since a frameless profile
  // is extruded along its own plane's normal and no frame is made for it
  // (docs/plans/frameless-curves.md). The name stays: it is the argument that
  // always said which way.
  const kind = model.planeKind(frame); // fail now, not at the first solve
  return model.relation("extrusion", [frame, depth, ...pairs], () => {
    const plane = planeBasis(model, frame);
    const basis = () => ({ uz: plane().n });
    // A base that is the plane's own point is a datum, as a frame's points
    // always were: the twin follows it and cannot drag it.
    const datum = new Set<string | undefined>(kind === "frame"
      ? (frame === ORIGIN ? [] : model.refsOf(model.frame(frame)))
      : kind === "points" ? referentsOf(frame) : []);
    const lift = (z: number[] | null) => z ?? [0, 0, 0];
    for (let i = 0; i < pairs.length; i += 2) {
      const [b, t] = [pairs[i], pairs[i + 1]];
      const be = model.entities.get(b), te = model.entities.get(t);
      if (be?.kind === "point" && te?.kind === "point") {
        const tv = te.varIndices;
        if (datum.has(b)) {
          model.addResidual(tv, (l) => {
            const uz = lift(basis().uz);
            const at = model.coords(b);
            return [0, 1, 2].map((k) => l[k].sub(at[k] + depth * uz[k]));
          }, `extrusion(${b},${t})`);
        } else {
          model.addResidual([...be.varIndices, ...tv], (l) => {
            const uz = lift(basis().uz);
            return [0, 1, 2].map((k) => l[3 + k].sub(l[k]).sub(depth * uz[k]));
          }, `extrusion(${b},${t})`);
        }
      } else if ((be?.kind === "circle" || be?.kind === "arc") && (te?.kind === "circle" || te?.kind === "arc")) {
        model.addResidual([be.radiusVar, te.radiusVar], (l) => [l[1].sub(l[0])], `extrusion(${b},${t}).r`);
        // A translation turns nothing, so a twin curve faces exactly as its
        // base does — the same normal, sign and all, since an arc's sign says
        // which way round it goes. Both declared: they are both geometry, and
        // the base is held to its sketch by relations of its own.
        const [bn, tn] = [curveNormal(model, b), curveNormal(model, t)];
        if (bn && tn) {
          model.addResidual(joinVars(bn, tn), (l) => {
            const [u, w] = [unitDuals(l.slice(0, 3)), unitDuals(l.slice(3))];
            return [0, 1, 2].map((k) => w[k].sub(u[k]));
          }, `extrusion(${b},${t}).n`);
        }
      } else {
        throw new Error(`"${b}" and "${t}" are not a pair an extrusion can hold — two points, or two circles or arcs`);
      }
    }
  });
}
