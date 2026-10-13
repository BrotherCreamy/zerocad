// The one relation a revolve is held by: every twin on the end face is its
// base turned through `angle` about an axis.
//
// extrusion.ts's sibling, and built the same way for the same reasons. It is a
// **dimension** — `d`-named, with a `.value` — because the angle is the one
// number a revolve has that a user goes back and edits: `set("d9.value", θ)`
// re-runs this with the new angle, in place, under the same name, and the end
// face swings. It is **one** relation with a block per pair, so one angle has
// one name. Nothing calls it but the expansion inside `revolve` (and `set`,
// re-running it), so it is not on the command surface and never journals
// itself.
//
// **The unit is radians**, as `ang`'s is — the label reads degrees (see
// glyphs.ts). One honest unit for what the relation stores, the documented
// seam, rather than a guess at the caller's intent from the size of a number.

import type { Dual } from "../kernel/dual.ts";
import { parseAxisRef, type Model } from "../model.ts";
import { frameBasis } from "./refs.ts";

/** A whole turn, and how close to one an angle must be to be one. */
export const FULL_TURN = 2 * Math.PI;
const TURN_TOL = 1e-9;

/** Whether `angle` is a whole turn either way round — a revolve with no end face. */
export function isFullTurn(angle: number): boolean {
  return Math.abs(Math.abs(angle) - FULL_TURN) <= TURN_TOL;
}

/** Where an axis is, as plain numbers: a point on it, and its direction at unit length (zero when it has none). */
export interface AxisValue {
  origin: number[];
  dir: number[];
}

/**
 * An axis a revolve turns about, read **lazily and as a value** — the datum
 * rule (`frameBasis`): the reading happens at every evaluation, so the solid
 * follows an axis that is dragged or re-pointed, and it is never declared as a
 * residual's variables, so nothing a revolve holds can push it.
 *
 * Either a frame-axis reference — `"f1.y"`: the frame's origin and that axis,
 * straightened as every relation reads it — or a line's name: its first point
 * and the direction to its second, re-read each time so a line a fillet later
 * re-points is followed. A collapsed axis (a line of no length, a frame folded
 * onto itself) floors its direction to the zero vector, as `frameBasis` does:
 * a residual against it degrades rather than filling the Jacobian with NaN.
 *
 * `points` is which point entities *are* the axis — the frame's three, or the
 * line's two, at the time of asking — so a relation can read those as datum
 * too. Throws now, not at the first solve, for a name that is neither.
 */
export function axisReader(model: Model, axis: string): { read: () => AxisValue; points: () => string[] } {
  if (model.dim !== 3) throw new Error("a revolve turns about an axis in a 3D model");
  if (typeof axis !== "string") throw new Error(`${JSON.stringify(axis)} is not an axis — a revolve turns about a line or a frame's axis ("f1.y")`);
  const ref = parseAxisRef(axis);
  if (ref) {
    model.requireAxis(ref.axis, axis);
    const basis = frameBasis(model, ref.frame);
    return {
      read: () => {
        const b = basis();
        const dir = ref.axis === "x" ? b.ux : ref.axis === "y" ? b.uy : b.uz!;
        return { origin: b.origin, dir: dir.slice() };
      },
      points: () => {
        const f = model.frame(ref.frame);
        return f.yref === undefined ? [f.origin, f.xref] : [f.origin, f.xref, f.yref];
      },
    };
  }
  const e = model.entities.get(axis);
  if (!e || e.kind !== "line") {
    throw new Error(`"${axis}" is not a line or a frame axis — a revolve turns about a line's name or "f1.y"`);
  }
  return {
    read: () => {
      const l = model.line(axis);
      const a = model.coords(l.refs[0]), b = model.coords(l.refs[1]);
      const d = b.map((v, i) => v - a[i]);
      const len = Math.hypot(...d);
      return { origin: a, dir: len < 1e-9 ? d.map(() => 0) : d.map((v) => v / len) };
    },
    points: () => [...model.line(axis).refs],
  };
}

/**
 * The rotation by `angle` about the unit direction `k`, as a 3×3 matrix —
 * Rodrigues': cos·I + sin·[k]× + (1 − cos)·k kᵀ. Rows, so `M[i]·v` is
 * component i of the turned vector.
 */
export function turnMatrix(k: number[], angle: number): number[][] {
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const [x, y, z] = k;
  return [
    [c + t * x * x, t * x * y - s * z, t * x * z + s * y],
    [t * y * x + s * z, c + t * y * y, t * y * z - s * x],
    [t * z * x - s * y, t * z * y + s * x, c + t * z * z],
  ];
}

/** `p` turned through `angle` about the axis — plain numbers, for seeds, glyphs and faces. */
export function turnPoint(p: number[], axis: AxisValue, angle: number): number[] {
  const m = turnMatrix(axis.dir, angle);
  const v = [0, 1, 2].map((i) => (p[i] ?? 0) - axis.origin[i]);
  return [0, 1, 2].map((i) => axis.origin[i] + m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
}

/**
 * Holds each twin at its base turned through `angle` about `axis`.
 *
 * `pairs` is flat — `base₁, twin₁, base₂, twin₂, …` — and at the top level of
 * the recorded arguments, for extrusion's reason: `del`'s reference scan reads
 * a relation's arguments name by name. A pair is:
 *
 * - **two points** — three residuals, `twin − o − M·(base − o)`, one per
 *   coordinate: the closed form of a rotation, **linear** in both points and
 *   nothing squared (the house rule — a norm-square has no gradient at its own
 *   root), and exact rather than a distance from the axis, so the end face can
 *   neither slide round the axis nor along it while keeping its radius.
 * - **two circles or arcs** — one residual, `r_twin − r_base`; their centres
 *   and ends are held by their own point pairs, and a twin circle has no ends.
 * - **two frames** — the end face's own frame held at the sketch frame turned:
 *   three residuals for each of the twin's origin, x-ref and y-ref. A frame
 *   rather than its points spelled out as pairs, because it says which bases are
 *   a datum (below) without a second list to keep in step.
 *
 * **The axis is a datum, read and never pushed** — the spec's line, and the rule
 * every relation written against a frame keeps. It reaches the residual as
 * numbers (`axisReader`), and so does every base that *is* a datum: the axis's
 * own points (a profile edge revolved about itself has its ends on the axis)
 * and a twinned frame's points (the sketch frame). For those the block declares
 * the twin alone, so the end frame follows the sketch frame and can never turn
 * it, and no twin can drag its own axis. Every other base is a variable, as an
 * extrude's profile is — the end face can push the profile, which is the
 * one-model negotiation.
 *
 * **A whole turn holds nothing.** With no pairs the angle must be a whole turn,
 * and the relation is a dimension with no blocks: the label on a full revolve,
 * which has no end face to hold. A partial angle with no pairs, or a whole turn
 * with pairs, is refused — and because `set` rebuilds through here, both
 * refusals are what a `set` across the boundary meets, with the old angle left
 * standing. Turning a full revolve partial, or a partial one full, is a
 * different feature, not a different value: a full turn has no end face to
 * swing, and a partial one closed on itself would be two faces in one place.
 *
 * 3D only. Refuses a zero angle, more than a whole turn, and anything not a
 * finite number.
 */
export function revolution(model: Model, axis: string, angle: number, ...pairs: string[]): string {
  if (model.dim !== 3) throw new Error("a revolution needs a 3D model — a 2D drawing has nothing to turn out of its plane into");
  if (typeof angle !== "number" || !Number.isFinite(angle) || angle === 0) {
    throw new Error(`a revolution needs a non-zero angle in radians, got ${JSON.stringify(angle)}`);
  }
  if (Math.abs(angle) > FULL_TURN + TURN_TOL) {
    throw new Error(`a revolve turns at most a whole turn (2π radians), got ${angle}`);
  }
  if (pairs.length % 2 !== 0) throw new Error("a revolution takes base/twin pairs");
  const reader = axisReader(model, axis);
  if (pairs.length === 0 && !isFullTurn(angle)) {
    throw new Error("a full revolve has no end face for an angle to swing — a partial revolve is a new feature, not "
      + `a new value: del the revolve, then revolve its profile again about ${axis} with the angle, in radians`);
  }
  if (pairs.length > 0 && isFullTurn(angle)) {
    throw new Error("a partial revolve's end face cannot be turned all the way round onto its start — a whole turn has "
      + "no end face: del the revolve and revolve again with no angle for a full one");
  }
  return model.relation("revolution", [axis, angle, ...pairs], () => {
    const datum = new Set(reader.points());
    for (let i = 0; i < pairs.length; i += 2) {
      const be = model.entities.get(pairs[i]);
      if (be?.kind === "frame") for (const p of model.refsOf(be)) datum.add(p);
    }
    // The turned position of a base, given it as Duals (a variable) or numbers (a datum).
    const turned = (base: (k: number) => Dual | number, l: Dual[], at: number): Dual[] => {
      const { origin: o, dir } = reader.read();
      const m = turnMatrix(dir, angle);
      const v = [0, 1, 2].map((k) => {
        const b = base(k);
        return typeof b === "number" ? b - o[k] : b.sub(o[k]);
      });
      return [0, 1, 2].map((r) => {
        let res = l[at + r].sub(o[r]);
        for (let c = 0; c < 3; c++) {
          const vc = v[c];
          res = typeof vc === "number" ? res.sub(m[r][c] * vc) : res.sub(vc.mul(m[r][c]));
        }
        return res;
      });
    };
    const holdPoint = (b: string, t: string) => {
      const tv = model.point(t).varIndices;
      if (datum.has(b)) {
        model.addResidual(tv, (l) => {
          const at = model.coords(b);
          return turned((k) => at[k], l, 0);
        }, `revolution(${b},${t})`);
      } else {
        model.addResidual([...model.point(b).varIndices, ...tv], (l) => turned((k) => l[k], l, 3), `revolution(${b},${t})`);
      }
    };
    for (let i = 0; i < pairs.length; i += 2) {
      const [b, t] = [pairs[i], pairs[i + 1]];
      const be = model.entities.get(b), te = model.entities.get(t);
      if (be?.kind === "point" && te?.kind === "point") {
        holdPoint(b, t);
      } else if ((be?.kind === "circle" || be?.kind === "arc") && (te?.kind === "circle" || te?.kind === "arc")) {
        model.addResidual([be.radiusVar, te.radiusVar], (l) => [l[1].sub(l[0])], `revolution(${b},${t}).r`);
      } else if (be?.kind === "frame" && te?.kind === "frame") {
        const [bp, tp] = [model.refsOf(be), model.refsOf(te)];
        if (bp.length !== tp.length) throw new Error(`"${b}" and "${t}" are not frames of one kind`);
        bp.forEach((p, k) => holdPoint(p, tp[k]));
      } else {
        throw new Error(`"${b}" and "${t}" are not a pair a revolution can hold — two points, two circles or arcs, or two frames`);
      }
    }
  });
}
