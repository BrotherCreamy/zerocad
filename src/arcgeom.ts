// Which way round an arc goes, and where a circle's rim is, in any dimension
// the app draws — the one answer the renderer, picking, snapping, box select,
// the arc tools and `fillet` all need, and must all give the same way.
//
// Plain numbers in and out, no Model and no View, like intersect.ts: an arc
// here is a centre, a radius, two endpoints and a **side** — the direction its
// sweep is counter-clockwise about — and a circle is a centre, a radius and
// the two directions spanning its plane.
//
// **The side is the arc's plane's +z** (see `ArcEntity`): the +z of the frame
// it names in 3D, and the 2D drawing's +z for a 2D arc, which is the
// convention main.ts always drew by. The plane the arc is laid out in is the
// one through its centre and both endpoints — the geometry says that much on
// its own — and the side only decides which of its two normals the sweep is
// counter-clockwise about, i.e. which of the two arcs between the endpoints is
// meant. Before arcs carried a plane, that side was the kernel's +z (then +y,
// then +x): the gauge showing through, and an arc whose plane was turned past
// the vertical drew as its complement. That rule is retired; the one place it
// survives is the translation of files written under it (persist.ts), so they
// open as the arcs they were.

import { cross3, dot3, lift3, unit3 } from "./vec3.ts";

/** Relative sine below which the two arms are one line and give no plane. */
const COLLINEAR_EPS = 1e-12;

/**
 * The unit normal an arc sweeps counter-clockwise about: the normal of the plane
 * through `c`, `s` and `e`, on `side`'s side. Null when an endpoint sits on the
 * centre and there is no direction to speak of.
 *
 * A half-turn — the endpoints exactly opposite — has no plane of its own; it
 * takes the plane through its diameter nearest to the side's own plane, i.e.
 * `side` with its component along the diameter taken out. A 2D semicircle
 * therefore still turns about +z, as it always did.
 *
 * A plane exactly edge-on to the side (the arc's normal square to it) has no
 * side to be on, and keeps the normal the endpoints give, start to end — which
 * draws the short way round. So does an arc whose side is the zero vector (a
 * frame collapsed onto its own origin; see `frameBasis`). Both are a drawing
 * pulled far out of its own plane, and the rule only has to be something that
 * draws.
 */
export function arcNormal(c: number[], s: number[], e: number[], side: number[]): number[] | null {
  const [C, S, E] = [lift3(c), lift3(s), lift3(e)];
  const a = [S[0] - C[0], S[1] - C[1], S[2] - C[2]];
  const b = [E[0] - C[0], E[1] - C[1], E[2] - C[2]];
  const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
  if (!(la > 1e-12) || !(lb > 1e-12)) return null;
  const k = lift3(side);
  const raw = cross3(a, b);
  const n = Math.hypot(raw[0], raw[1], raw[2]) > COLLINEAR_EPS * la * lb ? unit3(raw) : null;
  if (n) return dot3(n, k) < 0 ? n.map((x) => (x === 0 ? 0 : -x)) : n;
  // Collinear arms: a half-turn (or a zero sweep). The plane through the
  // diameter nearest the side's: the side with its along-diameter part removed.
  const u = unit3(a)!;
  const along = dot3(k, u);
  const toward = unit3([k[0] - along * u[0], k[1] - along * u[1], k[2] - along * u[2]]);
  if (toward) return toward;
  // The side is along the diameter, or is nothing: any normal to the diameter
  // will draw. The first kernel axis clear of it, made square to it.
  for (const axis of [[0, 0, 1], [0, 1, 0], [1, 0, 0]]) {
    const d = dot3(axis, u);
    const m = unit3([axis[0] - d * u[0], axis[1] - d * u[1], axis[2] - d * u[2]]);
    if (m) return m;
  }
  return null;
}

/**
 * An arc laid out in its own plane: `center + r·(cos t·u + sin t·v)` for t from
 * 0 at the start to `sweep` at the end. `u` points at the start, `v` is a
 * quarter turn on from it about `normal`, and `sweep` is in [0, 2π) — zero when
 * the two endpoint directions agree, which draws nothing, exactly as a canvas
 * arc from an angle to itself always drew nothing here. A whole circle is the
 * same shape with a sweep of 2π (`circleFrame`).
 *
 * Coordinates are always three, a 2D arc lying at z = 0.
 */
export interface ArcFrame {
  center: number[];
  r: number;
  u: number[];
  v: number[];
  normal: number[];
  sweep: number;
  /**
   * An **ellipse**'s semi-axis along `v`, when it is one (`ellipseFrame`): the
   * frame is then `center + r·cos t·u + rv·sin t·v`, `t` the eccentric anomaly,
   * and every function below reads it so. Absent for a circle or an arc, whose
   * radius is `r` both ways — so nothing that only ever meets those changes.
   */
  rv?: number;
}

/** The frame's larger semi-axis — the radius a circle has both ways, an ellipse's longer one. */
export function frameReach(f: ArcFrame): number {
  return Math.max(f.r, f.rv ?? f.r);
}

/**
 * The frame of the arc of radius `r` about `c` from `s` to `e`, counter-
 * clockwise about `side`, or null when an endpoint sits on the centre.
 *
 * The radius is the arc's own (its variable), not the distance to the start:
 * the two agree whenever `arcends` holds, and while a solve is still pulling
 * them together the drawing shows the arc the model actually has.
 */
export function arcFrame(c: number[], s: number[], e: number[], r: number, side: number[]): ArcFrame | null {
  const n = arcNormal(c, s, e, side);
  if (!n) return null;
  const C = lift3(c);
  const S = lift3(s), E = lift3(e);
  const u = unit3([S[0] - C[0], S[1] - C[1], S[2] - C[2]])!;
  const v = cross3(n, u);
  const b = [E[0] - C[0], E[1] - C[1], E[2] - C[2]];
  let sweep = Math.atan2(dot3(b, v), dot3(b, u));
  if (sweep < 0) sweep += Math.PI * 2;
  return { center: C, r, u, v, normal: n, sweep };
}

/**
 * A whole circle of radius `r` about `c`, in the plane spanned by the unit
 * directions `u` and `v` — the frame's +x and +y for a 3D circle, x and y for
 * a 2D one. Laid out from `u` round toward `v`, a full turn, so the arc
 * machinery (`arcPoint`, `arcSamples`) draws, picks and lifts it exactly as it
 * does an arc: a planar circle seen at an angle is the ellipse it projects to.
 */
export function circleFrame(c: number[], r: number, u: number[], v: number[]): ArcFrame {
  const U = lift3(u), V = lift3(v);
  return { center: lift3(c), r, u: U, v: V, normal: cross3(U, V), sweep: Math.PI * 2 };
}

/**
 * A whole ellipse about `c`: semi-axis `a` along the unit direction `u`, `b`
 * along `v`, laid out from `u` (its major end) round toward `v` — the circle's
 * frame with a second radius, so the arc machinery draws, picks, lifts and
 * samples it as it does a circle. Counter-clockwise about `u × v`.
 */
export function ellipseFrame(c: number[], a: number, b: number, u: number[], v: number[]): ArcFrame {
  const U = lift3(u), V = lift3(v);
  return { center: lift3(c), r: a, rv: b, u: U, v: V, normal: cross3(U, V), sweep: Math.PI * 2 };
}

/** The point at angle `t` along the arc, from its start — an ellipse's eccentric anomaly. */
export function arcPoint(f: ArcFrame, t: number): number[] {
  const c = Math.cos(t) * f.r, s = Math.sin(t) * (f.rv ?? f.r);
  return [0, 1, 2].map((i) => f.center[i] + c * f.u[i] + s * f.v[i]);
}

/** The direction of travel at angle `t` — d/dt of `arcPoint`, so not unit length. */
export function arcTangent(f: ArcFrame, t: number): number[] {
  const c = -Math.sin(t) * f.r, s = Math.cos(t) * (f.rv ?? f.r);
  return [0, 1, 2].map((i) => c * f.u[i] + s * f.v[i]);
}

/**
 * How many straight pieces to draw an arc of this sweep with, so that no piece
 * strays more than a quarter of a pixel from the true curve at a screen radius
 * of `pixelRadius`. The sagitta of a chord spanning θ is r(1 − cos θ/2), so a
 * step of 2·acos(1 − ¼/r) keeps every one under a quarter-pixel — invisible,
 * and fine enough that picking a drawn arc and the arc itself cannot disagree
 * by a hand's worth. Capped either way: a tiny arc still gets a shape, a huge
 * one does not get ten thousand segments.
 */
export function arcSegments(sweep: number, pixelRadius: number): number {
  const r = Math.max(pixelRadius, 1);
  const step = 2 * Math.acos(Math.max(-1, 1 - 0.25 / r));
  return Math.min(720, Math.max(8, Math.ceil(sweep / step)));
}

/**
 * The angles along `f` of the part of it from `a` to `b`, two points on its
 * rim, going the way the arc goes — `[t0, t1]` with `t1 > t0`, `t1` past 2π
 * when the part runs across a circle's seam. What a portion of an arc or circle
 * is drawn, swept and side-checked over (see `Portion` in model.ts): read off
 * where its two ends are now, never off a span found earlier, so it is the
 * part between those points however the geometry has moved.
 *
 * An end within a hair of the start reads as the start rather than a whole
 * turn past it, so a portion that begins at an arc's own start is not taken
 * to be the long way round.
 */
export function portionAngles(f: ArcFrame, a: number[], b: number[]): [number, number] {
  const tau = Math.PI * 2;
  const angle = (p: number[]) => {
    const P = lift3(p);
    const d = [P[0] - f.center[0], P[1] - f.center[1], P[2] - f.center[2]];
    // An ellipse's angle is its eccentric anomaly: each axis scaled to one.
    const t = Math.atan2(dot3(d, f.v) / (f.rv ?? 1), dot3(d, f.u) / (f.rv === undefined ? 1 : f.r));
    return ((t % tau) + tau + 1e-9) % tau - 1e-9;
  };
  const t0 = angle(a);
  let t1 = angle(b);
  if (t1 <= t0) t1 += tau;
  return [t0, t1];
}

/** The arc as points along it, start to end inclusive, evenly spaced in angle. */
export function arcSamples(f: ArcFrame, segments: number): number[][] {
  const out: number[][] = [];
  for (let k = 0; k <= segments; k++) out.push(arcPoint(f, (f.sweep * k) / segments));
  return out;
}

/**
 * Whether the arc of `c`'s circle drawn counter-clockwise from `s` to `e` about
 * `facing` is the arc `arcFrame` will draw for those same endpoints about
 * `side` — i.e. whether a tool that meant "counter-clockwise as seen from
 * `facing`'s side" should store them in that order, or swap them.
 *
 * Swapping is free: both arcs between two endpoints are drawable, and which
 * one is meant only ever depended on the order. So a tool decides what the
 * user aimed at in its own terms and asks this, rather than every tool having
 * to know the reference-side rule.
 */
export function sweepsAs(c: number[], s: number[], e: number[], facing: number[], side: number[]): boolean {
  const n = arcNormal(c, s, e, side);
  return !n || dot3(n, lift3(facing)) >= 0;
}
