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
import { ORIGIN, memberName, parseAxisRef, type FeatureEntry, type Model } from "../model.ts";
import { curveNormal, frameBasis, joinVars, unitDuals } from "./refs.ts";

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
        // The origin has no points to be datum: it never moves at all.
        if (ref.frame === ORIGIN) return [];
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
 *   a datum (below) without a second list to keep in step. **A twin frame's
 *   point that a point pair already holds is not held again**: an end frame
 *   stands on the end face's own corners wherever its frame stands on the
 *   profile's (`frameOver` in operations.ts), and a second block holding the
 *   same point at the same place would be a redundant equation, reported as
 *   one. A frame of points all its own — every frame before format 10 — is held
 *   whole, exactly as it was.
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
  // A pair of a thing with itself is a profile entity a whole turn takes onto
  // itself: what a full revolve names its profile by, with no end face to twin
  // it onto (see `profileFlat`). Only a pair of two is an end face's.
  let twinned = false;
  for (let i = 0; i < pairs.length; i += 2) if (pairs[i] !== pairs[i + 1]) twinned = true;
  if (!twinned && !isFullTurn(angle)) {
    throw new Error("a full revolve has no end face for an angle to swing — a partial revolve is a new feature, not "
      + `a new value: del the revolve, then revolve its profile again about ${axis} with the angle, in radians`);
  }
  if (twinned && isFullTurn(angle)) {
    throw new Error("a partial revolve's end face cannot be turned all the way round onto its start — a whole turn has "
      + "no end face: del the revolve and revolve again with no angle for a full one");
  }
  return model.relation("revolution", [axis, angle, ...pairs], () => {
    const datum = new Set(reader.points());
    for (let i = 0; i < pairs.length; i += 2) {
      const be = model.entities.get(pairs[i]);
      if (be?.kind === "frame") for (const p of model.refsOf(be)) datum.add(p);
    }
    profileFlat(model, reader, pairs, datum);
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
    // Which twins a point pair holds, so a frame pair can leave those to it.
    const held = new Set<string>();
    for (let i = 0; i < pairs.length; i += 2) {
      if (model.entities.get(pairs[i])?.kind === "point") held.add(pairs[i + 1]);
    }
    for (let i = 0; i < pairs.length; i += 2) {
      const [b, t] = [pairs[i], pairs[i + 1]];
      if (b === t) continue; // a full revolve's profile entity: held flat above, and twinned onto nothing
      const be = model.entities.get(b), te = model.entities.get(t);
      if (be?.kind === "point" && te?.kind === "point") {
        holdPoint(b, t);
      } else if ((be?.kind === "circle" || be?.kind === "arc") && (te?.kind === "circle" || te?.kind === "arc")) {
        model.addResidual([be.radiusVar, te.radiusVar], (l) => [l[1].sub(l[0])], `revolution(${b},${t}).r`);
        // A twin curve on the end face faces as its base does, turned: n̂_t =
        // M·n̂_b. What the end face's frame used to give a turned twin, before
        // curves carried their own normal (expansion 11 makes no end frame).
        const [bn, tn] = [curveNormal(model, b), curveNormal(model, t)];
        if (bn && tn) {
          model.addResidual(joinVars(bn, tn), (l) => {
            const m = turnMatrix(reader.read().dir, angle);
            const [u, w] = [unitDuals(l.slice(0, 3)), unitDuals(l.slice(3))];
            return [0, 1, 2].map((r) => {
              let res = w[r];
              for (let c = 0; c < 3; c++) res = res.sub(u[c].mul(m[r][c]));
              return res;
            });
          }, `revolution(${b},${t}).n`);
        }
      } else if (be?.kind === "frame" && te?.kind === "frame") {
        const [bp, tp] = [model.refsOf(be), model.refsOf(te)];
        if (bp.length !== tp.length) throw new Error(`"${b}" and "${t}" are not frames of one kind`);
        bp.forEach((p, k) => {
          if (held.has(tp[k])) return;
          held.add(tp[k]);
          holdPoint(p, tp[k]);
        });
      } else if ((be?.kind === "spline" && te?.kind === "spline") || (be?.kind === "bspline" && te?.kind === "bspline")) {
        // A spline is its points (docs/plans/spline.md): their pairs turn the
        // twin, and its control points follow by its own equations. A spline of
        // control points turned is its points turned (a B-spline is affine in them).
      } else {
        throw new Error(`"${b}" and "${t}" are not a pair a revolution can hold — two points, two circles or arcs, two frames or two splines`);
      }
    }
  });
}

/**
 * **The axis stays in the profile's plane** (docs/plans/profiles-held.md, the
 * audit). A revolve is only a solid of revolution of its profile while the
 * axis lies in the profile's plane, which `revolve` checks once, at the call;
 * nothing held it after. Measured before this: a corner of a free rectangle
 * pulled 8 off its plane took the plane 5.3 off the axis, partial or whole,
 * and the drawn surface was then of nothing the profile could sweep.
 *
 * The rows: every profile point `p` in the plane through the axis and one
 * profile point `r` — `(p − o)·n̂ = 0`, `n̂ = unit(k × (r − o))` — and every
 * profile curve with a normal square to that plane, `û × n̂ = 0`. `r` is the
 * profile point farthest from the axis when the relation is made, which is
 * the best-conditioned choice (the rows divide by its distance from the axis)
 * and changes nothing they say if a rebuild chooses another. Linear in each
 * point, nothing squared.
 *
 * **The profile is pushed, and the axis is not**: the axis is a datum, read as
 * numbers, as every row of the revolve reads it (`axisReader`) — a frame's axis
 * or the user's own line, which a feature built on it never moves. So with
 * nothing else holding it the profile may turn about the axis as a whole,
 * which is still the same solid turned, and never leave it. The axis's own
 * points (a profile edge on the axis) and a frame's points are a datum too,
 * and on the axis already, so they take no row. Vetoable (TODO.md's register).
 *
 * The profile is the bases of the pairs: an end face's bases for a partial
 * turn, and for a whole turn — which twins nothing — its entities paired with
 * themselves.
 */
function profileFlat(model: Model, reader: ReturnType<typeof axisReader>, pairs: readonly string[], datum: ReadonlySet<string>): void {
  const points: string[] = [], curves: string[] = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const b = pairs[i];
    const e = model.entities.get(b);
    if (e?.kind === "point") {
      if (!datum.has(b) && !points.includes(b)) points.push(b);
    } else if (e && (e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse" || e.kind === "earc") && !curves.includes(b)) {
      curves.push(b);
    }
  }
  const at = reader.read();
  const offAxis = (p: string) => {
    const v = model.coords(p).map((c, i) => c - at.origin[i]);
    const along = v.reduce((s, c, i) => s + c * at.dir[i], 0);
    return Math.hypot(...v.map((c, i) => c - along * at.dir[i]));
  };
  let ref: string | null = null;
  for (const p of points) if (offAxis(p) > (ref === null ? 1e-9 : offAxis(ref))) ref = p;
  if (ref === null) return; // every point on the axis: a profile already refused by `revolve`
  const r = ref;
  const rv = model.point(r).varIndices;
  /** n̂ = unit(k × (r − o)), the plane's normal, as Duals over r's three locals at `at0`. */
  const normal = (l: Dual[], at0: number): Dual[] => {
    const { origin: o, dir: k } = reader.read();
    const w = [0, 1, 2].map((i) => l[at0 + i].sub(o[i]));
    return unitDuals([
      w[2].mul(k[1]).sub(w[1].mul(k[2])),
      w[0].mul(k[2]).sub(w[2].mul(k[0])),
      w[1].mul(k[0]).sub(w[0].mul(k[1])),
    ]);
  };
  for (const p of points) {
    if (p === r) continue;
    model.addResidual([...rv, ...model.point(p).varIndices], (l) => {
      const n = normal(l, 0);
      const o = reader.read().origin;
      let s = n[0].mul(l[3].sub(o[0]));
      for (let i = 1; i < 3; i++) s = s.add(n[i].mul(l[3 + i].sub(o[i])));
      return [s];
    }, `revolution.flat(${p})`);
  }
  for (const c of curves) {
    const cn = curveNormal(model, c);
    if (!cn) continue;
    model.addResidual(joinVars(rv, cn), (l) => {
      const n = normal(l, 0);
      const u = unitDuals(l.slice(3, 6));
      return [
        u[1].mul(n[2]).sub(u[2].mul(n[1])),
        u[2].mul(n[0]).sub(u[0].mul(n[2])),
        u[0].mul(n[1]).sub(u[1].mul(n[0])),
      ];
    }, `revolution.flat(${c})`);
  }
}

/**
 * A revolve's profile plane **where the profile is**: the plane through its axis
 * and its profile (docs/plans/profiles-held.md). The angle holds the profile in
 * one plane with the axis, but not on its frame — a free profile may turn about
 * the axis as a whole — so the frame's plane is only where it started. Exactly
 * the frame's plane while the profile is still in it, which is every sketch-mode
 * revolve, so nothing already drawn is laid out anew; otherwise the frame's
 * axes carried into the profile's plane, its normal the side the frame's was
 * on. That side is read against the frame's normal, so a free profile turned
 * more than a right angle from its frame is read with its normal the other way
 * round. A revolve's solid does not depend on it — the kernel's plane is
 * right-handed either way, and the turn is about the axis in the world — but
 * which way its start cap is said to face does. Written down in TODO.md.
 * Read by the kernel's layout (curveplane.ts's `featurePlane`) and the caps' facing (solidref.ts).
 */
export function revolveProfilePlane(model: Model, f: Extract<FeatureEntry, { kind: "revolve" }>, frame: { u: number[]; v: number[]; n: number[] }):
  { u: number[]; v: number[]; n: number[] } {
  let axis;
  try {
    axis = axisReader(model, f.axis).read();
  } catch {
    return frame;
  }
  const k = axis.dir;
  if (k.every((c) => c === 0)) return frame;
  // The profile point farthest off the axis: the plane's best-conditioned witness, as `revolution` takes it.
  let side: number[] | null = null, far = 1e-9;
  for (const loop of f.loops) {
    for (const m of loop) {
      const e = model.entities.get(memberName(m));
      if (!e) continue;
      for (const p of model.refsOf(e)) {
        if (model.entities.get(p)?.kind !== "point") continue;
        const x = model.coords(p);
        const w = [0, 1, 2].map((i) => (x[i] ?? 0) - axis.origin[i]);
        const along = w.reduce((s, c, i) => s + c * k[i], 0);
        const off = w.map((c, i) => c - along * k[i]);
        const d = Math.hypot(...off);
        if (d > far) { far = d; side = off; }
      }
    }
  }
  if (!side) return frame;
  let n = unitOf(crossOf(k, side));
  if (!n) return frame;
  const agree = n.reduce((s, c, i) => s + c * frame.n[i], 0);
  if (agree < 0) n = n.map((c) => -c);
  if (1 - Math.abs(agree) < 1e-12) return frame;
  const along = frame.u.reduce((s, c, i) => s + c * n![i], 0);
  const u = unitOf(frame.u.map((c, i) => c - along * n![i])) ?? unitOf(side)!;
  return { u, v: crossOf(n, u), n };
}

const crossOf = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unitOf = (v: number[]): number[] | null => { const l = Math.hypot(...v); return l > 1e-12 ? v.map((c) => c / l) : null; };
