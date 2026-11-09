// An extrude's chord against its profile (docs/plans/profiles-held.md): the
// relation that says which way an edge extrude goes, **its own and
// deletable**. The owner: *"how could you have a relation inside an extrude?
// that doesnt really make sense to me"* — so the extrusion holds only the
// translation (every twin its base moved by one chord, the chord the depth
// long), and which way the chord points is an ordinary relation the operation
// makes beside it, under the feature's name (`e1_perp`), that anyone can
// delete and replace:
//
// - `perp(chord, e1)` — the chord square to every edge of e1's profile. Its
//   rows are `ĉ·ê = 0` for every straight edge (its two points), `ĉ × n̂ = 0`
//   for every edge with a normal of its own (an arc's, an ellipse's), and
//   `ĉ·(pᵢ₊₁ − pᵢ)` along a spline. Between them they hold the profile flat
//   and the chord square to it: a right prism, which way ever it is turned.
// - `ang(chord, e1, θ)` — a drafted or oblique extrude: the profile flat in a
//   plane of its own and the chord θ off that plane's normal.
//
// The chord is a line (a wall) or a pair of points — a wall's ends, which an
// extrude of a circle, having no wall, still has in its centre's pair. The
// profile is read **from the record at every evaluation** — `f.loops` for an
// extrude, the curves for an edge extrude's surface — so a regenerated
// profile (a fillet on a corner) is the one held. No row is a square.

import type { Dual } from "../kernel/dual.ts";
import { memberName, type Model, type ProfileMember } from "../model.ts";
import { curveNormal, unitDuals, type DirectionRef } from "./refs.ts";
import { dot, vecSub } from "./vec.ts";

/** The profile a record stands on, as members, or null for a name that is no extrude's or edge extrude's. */
export function profileMembers(model: Model, record: string): ProfileMember[] | null {
  const f = model.features.get(record);
  if (f?.kind === "extrude") return f.loops.flat();
  const s = model.surfaces.get(record);
  if (s && s.size !== undefined && model.relations.get(s.size)?.op === "extrusion") return (s.loops ?? [s.curves ?? []]).flat();
  return null;
}

/** One row's worth of a profile edge: the variables it reads, and the residual it gives against the chord's unit direction. */
interface EdgeRow {
  vars: number[];
  rows: (c: Dual[], own: Dual[]) => Dual[];
}

function edgeRows(model: Model, m: ProfileMember): EdgeRow[] {
  const e = model.entities.get(memberName(m));
  if (!e) return [];
  const pts = (a: string, b: string): EdgeRow => ({
    vars: [...model.point(a).varIndices, ...model.point(b).varIndices],
    // In lengths, not a cosine: the edge's run along the chord. A residual the
    // solve stops at is then a distance, as every other row's is — a cosine of
    // 1e-10 on a 40-long edge would leave its end 4e-9 off the plane.
    rows: (c, own) => [dot(c, vecSub(own.slice(3, 6), own.slice(0, 3)))],
  });
  if (e.kind === "line") return [typeof m === "string" ? pts(e.refs[0], e.refs[1]) : pts(m.from, m.to)];
  if (e.kind === "spline" || e.kind === "bspline") {
    const p = (e as { points: string[] }).points;
    return p.slice(1).map((q, i) => pts(p[i], q));
  }
  let normal: (() => number[]) | null = null;
  try { normal = model.oriented(e.name).normal !== undefined ? curveNormal(model, e.name) : null; } catch { normal = null; }
  if (!normal) return [];
  const n = normal;
  return [{
    vars: n(),
    rows: (c, own) => {
      const u = unitDuals(own.slice(0, 3));
      return [c[1].mul(u[2]).sub(c[2].mul(u[1])), c[2].mul(u[0]).sub(c[0].mul(u[2])), c[0].mul(u[1]).sub(c[1].mul(u[0]))];
    },
  }];
}

/**
 * The chord square to the record's profile: the body of `perp(chord, e1)`.
 * One block, its variables and its rows read off the profile as it stands at
 * every evaluation.
 */
export function squareToProfile(model: Model, chord: DirectionRef, record: string, label: string): void {
  let layout: { at: number; edge: EdgeRow }[] = [];
  model.addResidual(() => {
    const members = profileMembers(model, record) ?? [];
    const vars = [...chord.vars()];
    layout = [];
    for (const m of members) for (const edge of edgeRows(model, m)) { layout.push({ at: vars.length, edge }); vars.push(...edge.vars); }
    return vars;
  }, (l) => {
    const c = unitDuals(chord.direction(l.slice(0, chord.width)));
    return layout.flatMap(({ at, edge }) => edge.rows(c, l.slice(at, at + edge.vars.length)));
  }, label);
}

/**
 * The chord at `radians` off the normal of the record's profile, the profile
 * flat: the body of `ang(chord, e1, θ)` — a drafted or oblique extrude. The
 * profile's plane is three of its points, the three that make the largest
 * triangle when the relation is made (its conditioning is the triangle's);
 * every other point is held in it, and the chord's angle to its normal, read either way up (`|cos|`, the sign taken
 * at each evaluation from where the chord is: the angle is between lines).
 */
export function angleToProfile(model: Model, chord: DirectionRef, record: string, radians: number, label: string): void {
  const members = profileMembers(model, record) ?? [];
  const points = [...new Set(members.flatMap((m) => {
    const e = model.entities.get(memberName(m));
    return e ? model.refsOf(e).filter((p) => model.entities.get(p)?.kind === "point") : [];
  }))];
  const X = points.map((p) => model.coords(p));
  let best: [number, number, number] | null = null, area = 1e-12;
  for (let i = 0; i < X.length; i++) for (let j = i + 1; j < X.length; j++) for (let k = j + 1; k < X.length; k++) {
    const u = X[j].map((c, q) => c - X[i][q]), v = X[k].map((c, q) => c - X[i][q]);
    const a = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    if (a > area) { area = a; best = [i, j, k]; }
  }
  if (!best) throw new Error(`${record}'s profile has no three points that make a plane — an angle to it means nothing`);
  const plane = best.map((i) => points[i]);
  const others = points.filter((p) => !plane.includes(p));
  const pv = plane.flatMap((p) => model.point(p).varIndices);
  const normalOf = (own: Dual[]) => {
    const [a, b, c] = [own.slice(0, 3), own.slice(3, 6), own.slice(6, 9)];
    const u = vecSub(b, a), v = vecSub(c, a);
    return { a, n: unitDuals([u[1].mul(v[2]).sub(u[2].mul(v[1])), u[2].mul(v[0]).sub(u[0].mul(v[2])), u[0].mul(v[1]).sub(u[1].mul(v[0]))]) };
  };
  const target = Math.cos(radians);
  model.addResidual(() => [...chord.vars(), ...pv], (l) => {
    const c = unitDuals(chord.direction(l.slice(0, chord.width)));
    const { n } = normalOf(l.slice(chord.width));
    const cn = dot(c, n);
    return [cn.mul(cn.val < 0 ? -1 : 1).sub(target)];
  }, label);
  for (const p of others) {
    model.addResidual([...pv, ...model.point(p).varIndices], (l) => {
      const { a, n } = normalOf(l);
      return [dot(vecSub(l.slice(9, 12), a), n)];
    }, `${label}.flat(${p})`);
  }
}

/**
 * Seats a chord that stands exactly on its profile's normal at `radians` off
 * it, before `ang(chord, e1, θ)` is first solved. Not a convenience: an
 * unsigned angle is a function of the angle alone, so at 0 — the cone's apex,
 * which is exactly where a deleted `e1_perp` leaves the chord — its gradient
 * is zero by symmetry whichever way it is written (a cosine is stationary
 * there, a sine's norm has no derivative), and the solve would sit still and
 * report the angle unmet. Which way it leans is the one choice nobody made:
 * toward the profile's first edge, the way a draft is drawn, and anything that
 * says otherwise moves it. Only the chord's second end is moved; the
 * extrusion's translation rows carry every other twin with it in the solve.
 * Nothing is moved when the chord already leans (a replayed file, a lid that
 * was dragged) — a seed, never a relation.
 */
export function leanOffNormal(model: Model, a: string, b: string, record: string, radians: number): void {
  const X = [...new Set((profileMembers(model, record) ?? []).flatMap((m) => {
    const e = model.entities.get(memberName(m));
    return e ? model.refsOf(e).filter((p) => model.entities.get(p)?.kind === "point") : [];
  }))].map((p) => model.coords(p));
  const sub = (u: number[], v: number[]) => u.map((c, i) => c - v[i]);
  const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = (u: number[]) => Math.hypot(...u);
  let n: number[] | null = null, area = 1e-12, edge: number[] | null = null;
  for (let i = 0; i < X.length; i++) for (let j = i + 1; j < X.length; j++) {
    if (!edge && len(sub(X[j], X[i])) > 1e-9) edge = sub(X[j], X[i]);
    for (let k = j + 1; k < X.length; k++) {
      const c = cross(sub(X[j], X[i]), sub(X[k], X[i]));
      if (len(c) > area) { area = len(c); n = c.map((q) => q / len(c)); }
    }
  }
  if (!n || !edge) return;
  const [A, B] = [model.coords(a), model.coords(b)];
  const c = sub(B, A), L = len(c);
  if (L < 1e-12 || len(cross(c, n)) / L > 1e-9) return; // it leans already
  const along = Math.sign(c.reduce((s, q, i) => s + q * n![i], 0)) || 1;
  const t0 = n.map((q) => q * along);
  const inPlane = sub(edge, t0.map((q) => q * edge!.reduce((s, e, i) => s + e * t0[i], 0)));
  const u = inPlane.map((q) => q / len(inPlane));
  model.setCoords(b, A.map((q, i) => q + L * (Math.cos(radians) * t0[i] + Math.sin(radians) * u[i])));
}
