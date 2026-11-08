// The relations a pattern is held by (docs/plans/sketch-edit.md): a copy is its
// seed moved — along a step, or turned about a centre — and the move is the
// first copy's, so one dimension drives the lot and the pattern follows its
// seed wherever the seed is dragged.
//
// Three, each one block of linear components and none a square:
//
// - `translated(q, q2, p, p2)` — q2 − q = p2 − p: "q2 is q moved as p2 is p".
//   Any dimension.
// - `rotation(p, q, c, θ, plane?)` — q is p turned θ about c: the first copy
//   of a circular pattern, and its one dimension (`set` turns the pattern).
// - `rotated(q, q2, c, p, p2, plane?)` — q2 is q turned about c as p2 is p:
//   every other point of a circular pattern, read off the first step, so it
//   needs no number of its own.
//
// A turn needs an axis. In 2D it is the plane's own +z; in 3D it is the normal
// of a plane — the drawing plane when none is named, resolved at the call and
// journalled resolved, as `onplane` journals its plane — read as a datum
// (`planeBasis`), never pushed. Above 3D a turn has no single axis, and the two
// turning relations refuse.
//
// **Or the seed's own plane, pushed** (docs/plans/profiles-held.md): told so
// (`own`), a plane of three points, or a curve's, is read as the variables it
// is — the turn's axis is then the normal of the seed's own plane, through the
// centre, and a copy pulled out of that plane tilts the seed with it, as a
// seed tilted takes its copies. What a circular pattern drawn with no plane
// picked is held by: the owner's "bidirectional relationships everywhere by
// default", where the ground's z was an axis nobody chose.

import { parsePointTriple, type Model } from "../model.ts";
import { Dual } from "../kernel/dual.ts";
import { dot, norm, vecSub } from "./vec.ts";
import { chunk, curveNormal, planeBasis, unitDuals } from "./refs.ts";

/** Each point named, as a point — the refusal a relation makes before any block. */
function points(model: Model, names: readonly string[]): number[][] {
  return names.map((n) => model.point(n).varIndices);
}

/**
 * `q2 − q = p2 − p`: q2 is q moved as p2 is p. A linear pattern's copies, each
 * held to the first copy's step. `dim` components, each linear in every point.
 */
export function translated(model: Model, q: string, q2: string, p: string, p2: string): string {
  if (new Set([q, q2]).size < 2 || new Set([p, p2]).size < 2) throw new Error("translated needs two pairs of different points");
  return model.relation("translated", [q, q2, p, p2], () => {
    const vars = points(model, [q, q2, p, p2]).flat();
    const dim = model.dim;
    model.addResidual(vars, (l) => {
      const [a, b, c, d] = chunk(l, dim, 4);
      return a.map((_, i) => b[i].sub(a[i]).sub(d[i].sub(c[i])));
    }, `translated(${q},${q2},${p},${p2})`);
  });
}

/**
 * The axis a turn is about, and the variables a block reads it with: +z in 2D;
 * in 3D a plane's normal — a datum (`planeBasis`), or, `own`, the plane's own
 * points or curve read as Duals, pushed (see the top of the file). `names` are
 * the points the block reads anyway; the axis's points join them once each, so
 * no variable is declared twice. Refused above 3D, and `own` of a plane that is
 * neither three points nor a curve.
 */
function turnAxis(model: Model, op: string, plane: string | null | undefined, names: readonly string[], own: boolean):
  { ref: string | null; vars: () => number[]; read: (l: Dual[]) => { at: (name: string) => Dual[]; n: Dual[] } } {
  const dim = model.dim;
  const pointsOf = (all: readonly string[]) => () => all.flatMap((n) => model.point(n).varIndices);
  const reader = (all: readonly string[]) => (l: Dual[], n: (l: Dual[]) => Dual[]) => ({
    at: (name: string) => { const k = all.indexOf(name); return l.slice(k * dim, (k + 1) * dim); }, n: n(l),
  });
  if (dim === 2) {
    if (plane != null) throw new Error(`${op} in a 2D model turns about the one plane there is — it takes no plane`);
    if (own) throw new Error(`${op} in a 2D model turns about the one plane there is — it has no plane of its own to read`);
    const r = reader(names);
    return { ref: null, vars: pointsOf(names), read: (l) => r(l, () => [0, 0, 1].map((c) => Dual.constant(c))) };
  }
  if (dim !== 3) throw new Error(`${op} turns about an axis, which a ${dim}D model has none single of`);
  const ref = plane ?? model.drawingPlane();
  const kind = model.planeKind(ref);
  if (own && kind === "points") {
    const triple = parsePointTriple(ref)!;
    const all = [...names, ...triple.filter((p) => !names.includes(p))];
    const r = reader(all);
    return {
      ref, vars: pointsOf(all), read: (l) => r(l, (x) => {
        const [a, b, c] = triple.map((p) => { const k = all.indexOf(p); return x.slice(k * 3, k * 3 + 3); });
        const u = vecSub(b, a), v = vecSub(c, a);
        return unitDuals([u[1].mul(v[2]).sub(u[2].mul(v[1])), u[2].mul(v[0]).sub(u[0].mul(v[2])), u[0].mul(v[1]).sub(u[1].mul(v[0]))]);
      }),
    };
  }
  if (own && kind === "curve") {
    const normal = curveNormal(model, ref)!;
    const base = pointsOf(names);
    const r = reader(names);
    const width = names.length * 3;
    return { ref, vars: () => [...base(), ...normal()], read: (l) => r(l, (x) => unitDuals(x.slice(width, width + 3))) };
  }
  if (own) throw new Error(`${op} reads its own plane only from three points or a curve — "${ref}" is a ${kind}`);
  const basis = planeBasis(model, ref);
  const r = reader(names);
  return { ref, vars: pointsOf(names), read: (l) => r(l, () => basis().n.map((c) => Dual.constant(c))) };
}

/**
 * `x` turned about the unit axis `n` by the angle whose cosine and sine are
 * given — Rodrigues' formula, cos·x + sin·(n × x) + (1 − cos)(n·x)n, written
 * for Duals. In 2D (`x` two long) the plain quarter-turn form.
 */
function turn(x: Dual[], cos: Dual, sin: Dual, N: Dual[]): Dual[] {
  if (x.length === 2) return [cos.mul(x[0]).sub(sin.mul(x[1])), sin.mul(x[0]).add(cos.mul(x[1]))];
  const nx = [N[1].mul(x[2]).sub(N[2].mul(x[1])), N[2].mul(x[0]).sub(N[0].mul(x[2])), N[0].mul(x[1]).sub(N[1].mul(x[0]))];
  const along = dot(N, x);
  const k = Dual.constant(1).sub(cos);
  return x.map((xi, i) => cos.mul(xi).add(sin.mul(nx[i])).add(k.mul(along).mul(N[i])));
}

/**
 * `q` is `p` turned `angle` radians about `c` — counter-clockwise about +z in
 * 2D, about the plane's normal in 3D. A dimension (`d`-named; `set` turns it),
 * its value the fourth argument. `dim` linear components: (q − c) − R(p − c).
 */
export function rotation(model: Model, p: string, q: string, c: string, angle: number, plane?: string | null, own?: boolean | null): string {
  if (typeof angle !== "number" || !Number.isFinite(angle)) throw new Error(`rotation needs an angle in radians, got ${JSON.stringify(angle)}`);
  if (new Set([p, q, c]).size < 3) throw new Error("rotation needs three different points: from, to, and the centre");
  const axis = turnAxis(model, "rotation", plane, [p, q, c], own === true);
  points(model, [p, q, c]); // refused by name now, not at the first solve
  const args = axis.ref === null ? [p, q, c, angle] : own === true ? [p, q, c, angle, axis.ref, true] : [p, q, c, angle, axis.ref];
  return model.relation("rotation", args, () => {
    const [cos, sin] = [Dual.constant(Math.cos(angle)), Dual.constant(Math.sin(angle))];
    model.addResidual(axis.vars, (l) => {
      const { at, n } = axis.read(l);
      const [a, b, o] = [at(p), at(q), at(c)];
      const r = turn(vecSub(a, o), cos, sin, n);
      return vecSub(vecSub(b, o), r);
    }, `rotation(${p},${q},${c})`);
  });
}

/**
 * `q2` is `q` turned about `c` as `p2` is `p` — the turn read off the first
 * step, cos = a·b/|a||b| and sin = n·(a × b)/|a||b| with a = p − c, b = p2 − c,
 * so it carries no number: the pattern's one `rotation` decides it. `dim`
 * linear components in q and q2; smooth wherever p and p2 are off the centre,
 * which a pattern guarantees by choosing its first point so (sketchedit.ts).
 */
export function rotated(model: Model, q: string, q2: string, c: string, p: string, p2: string, plane?: string | null, own?: boolean | null): string {
  if (new Set([q, q2, c]).size < 3 || new Set([p, p2, c]).size < 3) {
    throw new Error("rotated needs two pairs of points off the centre and the centre itself");
  }
  const names = [...new Set([q, q2, c, p, p2])];
  const axis = turnAxis(model, "rotated", plane, names, own === true);
  points(model, names); // refused by name now, not at the first solve
  const args = axis.ref === null ? [q, q2, c, p, p2] : own === true ? [q, q2, c, p, p2, axis.ref, true] : [q, q2, c, p, p2, axis.ref];
  return model.relation("rotated", args, () => {
    const dim = model.dim;
    model.addResidual(axis.vars, (l) => {
      const read = axis.read(l);
      const [x0, x1, o, a0, b0] = [q, q2, c, p, p2].map(read.at);
      const n = read.n;
      // The turn is about n, so it is read in the plane square to it: a step
      // with a part along n (a centre lifted off the sketch) still turns by
      // exactly the angle `rotation` gave it.
      const flat = (v: Dual[]) => {
        if (dim === 2) return v;
        const along = dot(v, n);
        return v.map((vi, i) => vi.sub(along.mul(n[i])));
      };
      const a = flat(vecSub(a0, o)), b = flat(vecSub(b0, o));
      const ab = norm(a).mul(norm(b));
      const cos = dot(a, b).div(ab);
      const across = dim === 2
        ? a[0].mul(b[1]).sub(a[1].mul(b[0]))
        : dot(n, [a[1].mul(b[2]).sub(a[2].mul(b[1])), a[2].mul(b[0]).sub(a[0].mul(b[2])), a[0].mul(b[1]).sub(a[1].mul(b[0]))]);
      const sin = across.div(ab);
      return vecSub(vecSub(x1, o), turn(vecSub(x0, o), cos, sin, n));
    }, `rotated(${q},${q2},${c})`);
  });
}
