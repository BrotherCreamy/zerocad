// Where sketch curves meet, and where along a curve a place is — the questions
// trim and extend ask of the drawing (sketchedit.ts, and their tools).
//
// A question about the drawing, as loops.ts and picking.ts are: a function of
// the model, journalling nothing and making nothing. It sits at loops.ts's
// height and reads `heldOnCurves` from there, so "a point held on a curve" means
// the one thing everywhere.
//
// **A curve's carrier** is what it lies on: a line's infinite line, an arc's
// whole circle. Two carriers meet where they cross — line–line, line–circle and
// circle–circle in closed form, a line and an ellipse by scaling the ellipse to
// a circle (an affine map keeps a line a line) — and a tangency, within a
// millionth of the drawing, is no meeting: trim cuts where curves cross, and a
// curve touching another cuts nothing, as loops.ts says of a region. A circle
// and an ellipse, or two ellipses, have no closed form (a quartic) and are not
// asked here: neither cuts the other (written down, vetoable).
//
// **In 3D two curves meet only in a plane they share**: two lines that cross
// (not skew, not parallel), a line lying in a circle's plane, two circles in
// one plane. Coordinates go in and come out as the model's, lifted to three
// inside so one piece of arithmetic serves 2D and 3D.
//
// **Along a curve** is a fraction, in the curve's own direction (loops.ts's
// `span`): a line from its first point (0) to its second (1), unbounded either
// way; an arc from its start, the angle over its sweep, counter-clockwise about
// its normal, in [0, 2π/sweep); a circle from its frame's +x, the angle over a
// whole turn, in [0, 1).

import type { Entity, Model } from "./model.ts";
import { curveFrame } from "./curveplane.ts";
import { arcPoint, type ArcFrame } from "./arcgeom.ts";
import { heldOnCurves } from "./loops.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";

const TAU = Math.PI * 2;

type V = number[];

/** A curve's carrier, lifted to three coordinates. */
type Carrier =
  | { kind: "line"; p: V; q: V }
  | { kind: "round"; f: ArcFrame; closed: boolean };

/** The curve kinds trim and extend read: a line, an arc, a circle, and an ellipse as a cutter. */
export function isSketchCurve(e: Entity | undefined): boolean {
  return !!e && (e.kind === "line" || e.kind === "arc" || e.kind === "circle" || e.kind === "ellipse");
}

function carrierOf(model: Model, name: string): Carrier | null {
  const e = model.entities.get(name);
  if (!e) return null;
  if (e.kind === "line") return { kind: "line", p: lift3(model.coords(e.refs[0])), q: lift3(model.coords(e.refs[1])) };
  const f = curveFrame(model, e);
  if (!f) return null;
  return { kind: "round", f, closed: e.kind !== "arc" };
}

/** How big a curve is, for tolerances: a line's length, a round's radius. */
function sizeOf(c: Carrier): number {
  return c.kind === "line" ? Math.hypot(...sub3(c.q, c.p)) : Math.max(c.f.r, c.f.rv ?? 0);
}

/** A millionth of the larger of two curves (at least of one unit) — loops.ts's `LENGTH_TOL`, for a pair. */
function tolFor(a: Carrier, b: Carrier): number {
  return 1e-6 * Math.max(1, sizeOf(a), sizeOf(b), Math.hypot(...(a.kind === "line" ? a.p : a.f.center)));
}

/** A plane by its origin and two unit axes. */
interface Flat { o: V; u: V; v: V; n: V }

const toFlat = (pl: Flat, x: V): [number, number] => {
  const d = sub3(x, pl.o);
  return [dot3(d, pl.u), dot3(d, pl.v)];
};
const fromFlat = (pl: Flat, [x, y]: [number, number]): V => [0, 1, 2].map((i) => pl.o[i] + x * pl.u[i] + y * pl.v[i]);

const roundFlat = (f: ArcFrame): Flat => ({ o: f.center, u: f.u, v: f.v, n: f.normal });

/** Whether a point lies in a plane, to `tol`. */
const inPlane = (pl: Flat, x: V, tol: number) => Math.abs(dot3(sub3(x, pl.o), pl.n)) <= tol;

/**
 * Where two carriers meet, as world points (three coordinates) — none for
 * curves in no shared plane, parallel lines, a miss or a tangency.
 */
function carriersMeet(a: Carrier, b: Carrier, tol: number): V[] {
  if (a.kind === "line" && b.kind === "line") {
    const d1 = sub3(a.q, a.p), d2 = sub3(b.q, b.p);
    const raw = cross3(d1, d2);
    const l1 = Math.hypot(...d1), l2 = Math.hypot(...d2);
    if (!(l1 > 0) || !(l2 > 0) || Math.hypot(...raw) <= 1e-9 * l1 * l2) return [];
    const n = unit3(raw)!;
    if (Math.abs(dot3(sub3(b.p, a.p), n)) > tol) return []; // skew
    const u = d1.map((x) => x / l1);
    const pl: Flat = { o: a.p, u, v: cross3(n, u), n };
    const [p, q] = [toFlat(pl, b.p), toFlat(pl, b.q)];
    // a's line is the flat x axis: where b's crosses y = 0.
    if (Math.abs(q[1] - p[1]) < 1e-300) return [];
    const s = -p[1] / (q[1] - p[1]);
    return [fromFlat(pl, [p[0] + s * (q[0] - p[0]), 0])];
  }
  if (a.kind === "round" && b.kind === "line") return carriersMeet(b, a, tol);
  if (a.kind === "line" && b.kind === "round") {
    const pl = roundFlat(b.f);
    if (!inPlane(pl, a.p, tol) || !inPlane(pl, a.q, tol)) return [];
    const [p, q] = [toFlat(pl, a.p), toFlat(pl, a.q)];
    // An ellipse is a circle of radius 1 once its axes are scaled to one.
    const [sx, sy] = [b.f.r, b.f.rv ?? b.f.r];
    const P: [number, number] = [p[0] / sx, p[1] / sy], Q: [number, number] = [q[0] / sx, q[1] / sy];
    const hits = lineUnitCircle(P, Q, tol / Math.min(sx, sy));
    return hits.map(([x, y]) => fromFlat(pl, [x * sx, y * sy]));
  }
  const [A, B] = [a as Extract<Carrier, { kind: "round" }>, b as Extract<Carrier, { kind: "round" }>];
  if (A.f.rv !== undefined || B.f.rv !== undefined) return []; // a conic with a circle or a conic: not asked (above)
  if (Math.hypot(...cross3(A.f.normal, B.f.normal)) > 1e-6) return [];
  const pl = roundFlat(A.f);
  if (!inPlane(pl, B.f.center, tol)) return [];
  const c2 = toFlat(pl, B.f.center);
  const [r1, r2] = [A.f.r, B.f.r];
  const d = Math.hypot(c2[0], c2[1]);
  if (d <= tol || d >= r1 + r2 - tol || d <= Math.abs(r1 - r2) + tol) return [];
  const h = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const k2 = r1 * r1 - h * h;
  if (!(k2 > 0)) return [];
  const k = Math.sqrt(k2);
  const [ux, uy] = [c2[0] / d, c2[1] / d];
  const m: [number, number] = [h * ux, h * uy];
  return [fromFlat(pl, [m[0] - k * uy, m[1] + k * ux]), fromFlat(pl, [m[0] + k * uy, m[1] - k * ux])];
}

/** Where the infinite line through p and q meets the unit circle about the origin — none for a miss or a tangency. */
function lineUnitCircle(p: [number, number], q: [number, number], tol: number): [number, number][] {
  const d = [q[0] - p[0], q[1] - p[1]];
  const len = Math.hypot(d[0], d[1]);
  if (!(len > 0)) return [];
  const u = [d[0] / len, d[1] / len];
  const along = -(p[0] * u[0] + p[1] * u[1]);
  const across = -(u[0] * p[1] - u[1] * p[0]);
  if (Math.abs(across) >= 1 - tol) return [];
  const half = Math.sqrt(1 - across * across);
  return [along - half, along + half].map((s) => [p[0] + s * u[0], p[1] + s * u[1]] as [number, number]);
}

/** The angle of `x` round a round's frame, from its +u, counter-clockwise about its normal, in [0, 2π). */
function angleOn(f: ArcFrame, x: V): number {
  const d = sub3(x, f.center);
  const t = Math.atan2(dot3(d, f.v) / (f.rv ?? f.r), dot3(d, f.u) / f.r);
  return ((t % TAU) + TAU) % TAU;
}

/** How far along a carrier a world point (three coordinates) is — see the top of the file. */
function fractionAlong(c: Carrier, x: V): number {
  if (c.kind === "line") {
    const d = sub3(c.q, c.p);
    return dot3(sub3(x, c.p), d) / dot3(d, d);
  }
  return angleOn(c.f, x) / (c.closed ? TAU : c.f.sweep);
}

/** The model's coordinates of a lifted point. */
const own = (model: Model, x: V) => x.slice(0, model.dim);

/** How far along `name` a place is (the model's coordinates): see the top of the file. */
export function fractionOn(model: Model, name: string, world: number[]): number {
  const c = carrierOf(model, name);
  if (!c) throw new Error(`"${name}" is not a line, arc or circle`);
  return fractionAlong(c, lift3(world));
}

/** The place a fraction `t` along `name` is, in the model's coordinates. */
export function pointOn(model: Model, name: string, t: number): number[] {
  const c = carrierOf(model, name);
  if (!c) throw new Error(`"${name}" is not a line, arc or circle`);
  if (c.kind === "line") return own(model, c.p.map((pi, i) => pi + t * (c.q[i] - pi)));
  return own(model, arcPoint(c.f, t * (c.closed ? TAU : c.f.sweep)));
}

/** How long `name` is along itself, for turning a length into a fraction: a line's length, an arc's or circle's circumference. */
export function lengthOf(model: Model, name: string): number {
  const c = carrierOf(model, name);
  if (!c) return 0;
  if (c.kind === "line") return Math.hypot(...sub3(c.q, c.p));
  return c.f.r * (c.closed ? TAU : c.f.sweep);
}

/**
 * How far a place is from the curve itself — a line's segment, an arc's sweep,
 * a circle's rim — in the model's units. What a tool asks to choose between the
 * curves meeting at a point it was handed.
 */
export function distanceToCurve(model: Model, name: string, world: number[]): number {
  const c = carrierOf(model, name);
  if (!c) return Infinity;
  const x = lift3(world);
  if (c.kind === "line") {
    const t = Math.min(1, Math.max(0, fractionAlong(c, x)));
    return Math.hypot(...sub3(x, c.p.map((pi, i) => pi + t * (c.q[i] - pi))));
  }
  const th = angleOn(c.f, x);
  const sweep = c.closed ? TAU : c.f.sweep;
  const t = th <= sweep ? th : (th - sweep < TAU - th ? sweep : 0);
  return Math.hypot(...sub3(x, arcPoint(c.f, t)));
}

/** Whether a place on a carrier is on the curve itself — a line's segment, an arc's sweep — to `tol`. */
function onExtent(c: Carrier, x: V, tol: number): boolean {
  if (c.kind === "line") {
    const len = Math.hypot(...sub3(c.q, c.p));
    const t = fractionAlong(c, x);
    const e = tol / Math.max(len, 1e-300);
    return t >= -e && t <= 1 + e;
  }
  if (c.closed) return true;
  const th = angleOn(c.f, x);
  const e = tol / c.f.r;
  return th <= c.f.sweep + e || th >= TAU - e;
}

/** The end points of a curve, by name — a line's two, an arc's start and end; none for a closed curve. */
function endsOf(e: Entity): string[] {
  if (e.kind === "line") return [...e.refs];
  if (e.kind === "arc") return [e.start, e.end];
  return [];
}

/**
 * **Where `name` is cut**: every place another curve crosses it, or rests an
 * end on it (a T), strictly inside it — never at its own ends, which are where
 * it stops already — in order along it. Each with the cutting curve, the world
 * place, and the point already there when there is one: the cutter's own end
 * (a T), or a point a relation holds on `name` (a crossing a snap or an extrude
 * made real). Places within a millionth of each other are one cut, the one with
 * a point kept. Construction curves cut as any other: they are drawn, and a
 * trim to one is what a construction line is for.
 */
export interface CurveCut {
  t: number;
  at: number[];
  by: string;
  point: string | null;
}

export function cutsOf(model: Model, name: string): CurveCut[] {
  const me = model.entities.get(name);
  const mine = carrierOf(model, name);
  if (!me || !mine || me.kind === "ellipse") return [];
  const held = heldOnCurves(model).filter((h) => h.curve === name).map((h) => h.point);
  const ends = new Set(endsOf(me));
  const len = lengthOf(model, name);
  const cuts: CurveCut[] = [];
  for (const other of model.entities.values()) {
    if (other.name === name || !isSketchCurve(other)) continue;
    const them = carrierOf(model, other.name);
    if (!them) continue;
    const tol = tolFor(mine, them);
    for (const x of carriersMeet(mine, them, tol)) {
      if (!onExtent(them, x, tol)) continue;
      const t = fractionAlong(mine, x);
      const e = tol / Math.max(len, 1e-300);
      if (me.kind !== "circle" && !(t > e && t < 1 - e)) continue;
      if (me.kind === "arc" && !(angleOn((mine as Extract<Carrier, { kind: "round" }>).f, x) < (mine as Extract<Carrier, { kind: "round" }>).f.sweep)) continue;
      const near = (p: string) => Math.hypot(...sub3(lift3(model.coords(p)), x)) <= tol * 10;
      const point = endsOf(other).find((p) => !ends.has(p) && near(p)) ?? held.find((p) => !ends.has(p) && near(p)) ?? null;
      cuts.push({ t: me.kind === "circle" ? ((t % 1) + 1) % 1 : t, at: own(model, x), by: other.name, point });
    }
  }
  cuts.sort((a, b) => a.t - b.t);
  const out: CurveCut[] = [];
  for (const c of cuts) {
    const last = out[out.length - 1];
    const same = last && Math.hypot(...sub3(lift3(last.at), lift3(c.at))) <= 1e-6 * Math.max(1, len);
    if (!same) out.push(c);
    else if (last.point === null && c.point !== null) out[out.length - 1] = c;
  }
  // A circle's first and last cuts can be one place across its seam.
  if (me.kind === "circle" && out.length > 1) {
    const [first, last] = [out[0], out[out.length - 1]];
    if (Math.hypot(...sub3(lift3(first.at), lift3(last.at))) <= 1e-6 * Math.max(1, len)) {
      if (first.point === null && last.point !== null) out[0] = last;
      out.pop();
    }
  }
  return out;
}

/**
 * **Where extending an end of `name` reaches**: the first curve its carrier
 * meets past that end — a line on along its own direction, an arc on round its
 * circle — and the place, as a fraction along `name` and in the world. `to`
 * names the curve when one is wanted; null when nothing lies that way.
 */
export interface Reach {
  by: string;
  at: number[];
  /** How far past the end, along the curve: a length. */
  past: number;
}

export function reachOf(model: Model, name: string, end: "start" | "end", to?: string | null): Reach | null {
  const me = model.entities.get(name);
  const mine = carrierOf(model, name);
  if (!me || !mine || (me.kind !== "line" && me.kind !== "arc")) return null;
  let best: Reach | null = null;
  for (const other of model.entities.values()) {
    if (other.name === name || !isSketchCurve(other) || (to != null && other.name !== to)) continue;
    const them = carrierOf(model, other.name);
    if (!them) continue;
    const tol = tolFor(mine, them);
    for (const x of carriersMeet(mine, them, tol)) {
      if (!onExtent(them, x, tol)) continue;
      let past: number;
      if (mine.kind === "line") {
        const t = fractionAlong(mine, x);
        const len = Math.hypot(...sub3(mine.q, mine.p));
        past = (end === "end" ? t - 1 : -t) * len;
      } else {
        const th = angleOn(mine.f, x);
        if (th <= mine.f.sweep + tol / mine.f.r || th >= TAU - tol / mine.f.r) continue; // on the arc already
        past = (end === "end" ? th - mine.f.sweep : TAU - th) * mine.f.r;
      }
      if (!(past > tol)) continue;
      if (!best || past < best.past) best = { by: other.name, at: own(model, x), past };
    }
  }
  return best;
}
