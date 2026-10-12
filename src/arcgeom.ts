// Which way round an arc goes, in any dimension the app draws — the one answer
// the renderer, picking, snapping, box select, the arc tools and `fillet` all
// need, and must all give the same way.
//
// Plain numbers in and out, no Model and no View, like intersect.ts: an arc
// here is a centre, a radius and two endpoints.
//
// **An arc entity names three points and no plane**, so in 3D "counter-
// clockwise from start to end" needs a side to be counter-clockwise *from*.
// The plane is the one through the centre and both endpoints — the spec's
// definition, and the only one the entity can support until arcs carry a plane
// of their own (3D phase 2). The side is the one rule that keeps every 2D arc
// exactly what it was: **the normal on the kernel's +z side**, falling back to
// +y and then +x for a plane that contains the z axis. A 2D arc, or an arc in
// a lifted 2D file, lies in z = 0, so its normal is +z and it sweeps
// counter-clockwise exactly as main.ts always drew it.
//
// That is the gauge showing through, and it is said here rather than hidden:
// nothing *constrains* by it — no residual reads it — it only decides which of
// the two arcs between two endpoints is drawn and picked. The tools and
// `fillet` read the same rule and order their endpoints so the arc drawn is
// the one the user aimed at, whichever side of its plane they were looking
// from. Phase 2 gives an arc its plane and this rule becomes a fallback. Until
// then its one visible wrinkle is an arc whose plane is turned through the
// vertical: its reference side flips, and it is drawn as its complement.

import { cross3, dot3, lift3, unit3 } from "./vec3.ts";

/** Below this a normal's z (then y) component counts as zero — the plane contains that axis. */
const SIDE_EPS = 1e-9;

/** Relative sine below which the two arms are one line and give no plane. */
const COLLINEAR_EPS = 1e-12;

/**
 * The unit normal an arc sweeps counter-clockwise about: the normal of the plane
 * through `c`, `s` and `e`, on the kernel's +z side (then +y, then +x). Null
 * when an endpoint sits on the centre and there is no direction to speak of.
 *
 * A half-turn — the endpoints exactly opposite — has no plane of its own; it
 * takes the plane through its diameter that is nearest to containing +x and +y,
 * i.e. the normal perpendicular to the diameter that leans most toward +z. A
 * 2D semicircle therefore still turns about +z, as it always did.
 */
export function arcNormal(c: number[], s: number[], e: number[]): number[] | null {
  const [C, S, E] = [lift3(c), lift3(s), lift3(e)];
  const a = [S[0] - C[0], S[1] - C[1], S[2] - C[2]];
  const b = [E[0] - C[0], E[1] - C[1], E[2] - C[2]];
  const la = Math.hypot(a[0], a[1], a[2]), lb = Math.hypot(b[0], b[1], b[2]);
  if (!(la > 1e-12) || !(lb > 1e-12)) return null;
  const raw = cross3(a, b);
  let n = Math.hypot(raw[0], raw[1], raw[2]) > COLLINEAR_EPS * la * lb ? unit3(raw) : null;
  if (!n) {
    // Collinear arms: a half-turn (or a zero sweep). Any plane through the
    // diameter will do; take the one whose normal leans most toward +z.
    const u = unit3(a)!;
    for (const k of [[0, 0, 1], [0, 1, 0], [1, 0, 0]]) {
      const along = dot3(k, u);
      n = unit3([k[0] - along * u[0], k[1] - along * u[1], k[2] - along * u[2]]);
      if (n) break;
    }
  }
  return orientUp(n!);
}

/** `n` or its opposite, whichever is on the kernel's +z side (ties: +y, then +x). */
function orientUp(n: number[]): number[] {
  for (const k of [2, 1, 0]) {
    if (n[k] > SIDE_EPS) return n;
    // Flipped without minting a −0, which would make two equal normals compare unequal.
    if (n[k] < -SIDE_EPS) return n.map((c) => (c === 0 ? 0 : -c));
  }
  return n;
}

/**
 * An arc laid out in its own plane: `center + r·(cos t·u + sin t·v)` for t from
 * 0 at the start to `sweep` at the end. `u` points at the start, `v` is a
 * quarter turn on from it about `normal`, and `sweep` is in [0, 2π) — zero when
 * the two endpoint directions agree, which draws nothing, exactly as a canvas
 * arc from an angle to itself always drew nothing here.
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
}

/**
 * The frame of the arc of radius `r` about `c` from `s` to `e`, or null when
 * an endpoint sits on the centre.
 *
 * The radius is the arc's own (its variable), not the distance to the start:
 * the two agree whenever `arcends` holds, and while a solve is still pulling
 * them together the drawing shows the arc the model actually has.
 */
export function arcFrame(c: number[], s: number[], e: number[], r: number): ArcFrame | null {
  const n = arcNormal(c, s, e);
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

/** The point at angle `t` along the arc, from its start. */
export function arcPoint(f: ArcFrame, t: number): number[] {
  const c = Math.cos(t) * f.r, s = Math.sin(t) * f.r;
  return [0, 1, 2].map((i) => f.center[i] + c * f.u[i] + s * f.v[i]);
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

/** The arc as points along it, start to end inclusive, evenly spaced in angle. */
export function arcSamples(f: ArcFrame, segments: number): number[][] {
  const out: number[][] = [];
  for (let k = 0; k <= segments; k++) out.push(arcPoint(f, (f.sweep * k) / segments));
  return out;
}

/**
 * Whether the arc of `c`'s circle drawn counter-clockwise from `s` to `e` about
 * `facing` is the arc `arcFrame` will draw for those same endpoints — i.e.
 * whether a tool that meant "counter-clockwise as seen from `facing`'s side"
 * should store them in that order, or swap them.
 *
 * Swapping is free: both arcs between two endpoints are drawable, and which
 * one is meant only ever depended on the order. So a tool decides what the
 * user aimed at in its own terms and asks this, rather than every tool having
 * to know the reference-side rule.
 */
export function sweepsAs(c: number[], s: number[], e: number[], facing: number[]): boolean {
  const n = arcNormal(c, s, e);
  return !n || dot3(n, lift3(facing)) >= 0;
}
