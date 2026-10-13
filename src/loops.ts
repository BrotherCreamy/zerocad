// Closed loops: which regions a drawing has, and which one a click is inside.
//
// The fifth of the pure "question about the drawing" modules, beside
// `picking.ts`, `snapping.ts`, `glyphs.ts` and `boxselect.ts`: a function of
// the model (and, for `loopAt`, a view and a pixel), with no canvas, no pointer
// and no state. It answers the two questions 3D phase 4's extrude will ask —
// **what closed loops does this drawing contain?** and **which loop is under
// this click?** — and nothing in the app asks the second one yet. A click
// inside a region still picks nothing (box select and the context menu depend
// on empty-canvas presses), and a loop is drawn nowhere: it is a *question*,
// not an entity. Finding loops journals nothing, claims no names and moves
// nothing.
//
// **Joined means held, never near.** This is the module's honesty line. Two
// curve ends are joined when they are the *same point entity*, or two point
// entities a `coin` (coincident) relation holds together — directly, or through
// a chain of them. Proximity alone joins nothing: two endpoints that merely sit
// on the same spot are not joined, because nothing holds them there, and the
// next drag is free to pull them apart. A drawing made with the tools joins by
// coincidence inference (a click on a vertex makes a new point and a `coin`),
// so reading the relation registry is not optional — ignoring `coin` would make
// most real sketches undetectable. The same rule settles two near-misses that
// look like joins and are not: a **crossing** (two edges passing through each
// other where neither has an end) splits nothing, and nor does a **T** (an end
// held *on* an edge by `on`, rather than at a point of it). Onshape splits
// regions at every intersection; this model only knows what it was told.
//
// **A loop** is a cycle of lines and arcs in one plane, joined end to end, or a
// whole circle on its own. **One plane** means every line's ends, and every
// arc's centre and ends, lie in it — to `liesOn`'s tolerance, a millionth of
// the distance from the plane's origin — and every arc's *frame* agrees with
// it: the frame's +z parallel to the plane's normal (either way up), to within
// a sine of a millionth (`PARALLEL_SINE`, fillet's in-plane rule). An arc whose
// points happen to lie in a plane its frame does not is not in that plane: its
// frame says it is drawn in another, and its rim would be.
//
// **Minimal cycles**, found as the faces of the plane's drawing: at every
// vertex the edges are put in angular order (by tangent, then curvature, so an
// arc leaving tangent to another is ordered by which way it bends), and walking
// each face with the interior on the left traces every bounded face
// counter-clockwise and the unbounded one clockwise. So a figure-eight is two
// loops, two rectangles sharing an edge are two (the edge in both, and the
// six-edge outline in neither), and an outline with an island is two. A face
// whose walk visits a vertex twice — an annulus whose island touches its
// outline at a point — is split there into the simple cycles it is made of.
// Edges on no cycle (a stray line, a bridge between two loops) are dropped
// first. **A component whose edges cross one another yields no loops**: with
// nothing joining them at the crossing, its faces are not the regions the
// drawing shows, and a self-crossing outline is no profile phase 4 could
// extrude. A cycle enclosing no area (two lines between the same two points)
// is not a loop.
//
// **Holes are not classified here**; containment is reported. Every loop
// carries `parent` — the smallest coplanar loop that wholly contains it — and
// `children`, so phase 4 can say "a loop containing another is a face with a
// hole" without asking the geometry again.
//
// **A loop's plane** is a frame's when one lies in it (the default first, then
// the earliest): its origin and its +x, +y and +z. Failing that, the first arc
// or circle in it lends its frame's orientation, and failing that the plane's
// normal is the one whose largest component is positive and its +u runs along
// the first line. Members are listed **counter-clockwise about that normal**,
// from the earliest-made member, so `area` — the signed area of the members as
// listed, about `plane.normal` — comes out positive; a caller that walks a loop
// backwards negates it.
//
// **`loopAt` is the click-inside test.** The pixel's ray meets each loop's
// plane; the hit is inside or not by winding number in that plane, with arcs
// exact (an arc's winding about a point has a closed form, so there is no
// resolution to choose). Among the loops hit, **the innermost wins**: a loop
// that contains another hit loop is dropped, so a click on an island picks the
// island and not the outline around it — nearest-wins could not say this,
// because coplanar loops tie on depth exactly. Of what remains the **nearest
// wins** (the plane met nearest the camera), then the smaller area, then the
// earlier loop. The one screen-space tolerance is for the degenerate case: a
// loop seen so nearly edge-on that it is less than `EDGE_ON_PX` thick on
// screen offers no inside, and is skipped.
//
// Loops live in a 2D or a 3D model; anything else has no planes to put them in.

import type { Model } from "./model.ts";
import { arcSegments } from "./arcgeom.ts";
import { curveFrame, curvePlaneOf, framePlaneAxes } from "./curveplane.ts";
import { frameBasis } from "./relations/refs.ts";
import { depth, liesOn, screenToPlane, viewAxes, worldToScreen, type Plane, type View } from "./view.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";

/** The plane a loop lies in. `u × v = normal`, all unit length, three coordinates each. */
export interface LoopPlane {
  origin: number[];
  u: number[];
  v: number[];
  /** The side the loop's members run counter-clockwise about. */
  normal: number[];
  /** The frame whose plane this is, if one is — see the top of the file. */
  frame: string | null;
}

/** One line, arc or circle of a loop, as the loop walks it. */
export interface LoopMember {
  name: string;
  /**
   * Walked against its own direction: a line from its second point to its
   * first, an arc from its end to its start, a circle clockwise about its own
   * frame's +z.
   */
  reversed: boolean;
  /** The point entities this member is walked from and to; null for a circle. */
  from: string | null;
  to: string | null;
}

export interface Loop {
  /** Counter-clockwise about `plane.normal`, starting from the earliest-made member. */
  members: LoopMember[];
  plane: LoopPlane;
  /** Signed area of the members as listed, about `plane.normal` — positive as listed. */
  area: number;
  /**
   * The smallest coplanar loop that wholly contains this one, as an index into
   * the array `findLoops` returned, or null. Touching at a point still counts
   * as contained; sharing an edge never can (two faces sharing an edge are
   * side by side).
   */
  parent: number | null;
  /** The loops whose `parent` this is. */
  children: number[];
}

/** Two normals agree when the sine between them is at most this — fillet's `IN_PLANE_SINE`. */
export const PARALLEL_SINE = 1e-6;

/** A loop less than this many pixels thick on screen is edge-on, and has no inside to click. */
export const EDGE_ON_PX = 1;

/**
 * Lengths below this fraction of the drawing's size are nothing: a crossing
 * this near an end is a touch at that end, two roots this close are a tangency,
 * a point this near a boundary is on it. `liesOn`'s millionth.
 */
const LENGTH_TOL = 1e-6;

/** Two tangents this close (radians) leave a vertex in one direction, and curvature orders them. */
const ANGLE_TIE = 1e-8;

/** A cycle enclosing less than this fraction of the drawing's size squared encloses nothing. */
const AREA_TOL = 1e-9;

// --- the edges, and what joins them ------------------------------------------

/** A line or arc that can be part of a loop: its two ends, and which joined class each is in. */
interface Edge {
  name: string;
  kind: "line" | "arc";
  /** Creation order — what "earliest" means everywhere below. */
  order: number;
  /** Point names in the entity's own direction: a line's refs, an arc's start and end. */
  ends: [string, string];
  /** Each end's joined class. Never equal: an edge whose own ends are joined encloses nothing. */
  at: [number, number];
}

interface CircleRef {
  name: string;
  order: number;
}

/**
 * Every point's joined class — the honesty line, in code. Points are classed
 * together only by `coin` relations (a union over the registry), never by
 * where they are. Classes are numbered in the order their first point was
 * made, so everything downstream is deterministic.
 */
function joinClasses(model: Model): Map<string, number> {
  const up = new Map<string, string>();
  const find = (p: string): string => {
    let r = p;
    while (up.has(r)) r = up.get(r)!;
    // Path compression, so a long coin chain is not walked twice.
    let q = p;
    while (up.has(q)) { const next = up.get(q)!; if (next !== r) up.set(q, r); q = next; }
    return r;
  };
  const isPoint = (a: unknown): a is string => typeof a === "string" && model.entities.get(a)?.kind === "point";
  for (const rel of model.relations.values()) {
    if (rel.op !== "coincident") continue;
    const [a, b] = rel.args;
    if (!isPoint(a) || !isPoint(b)) continue;
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) up.set(rb, ra);
  }
  const ids = new Map<string, number>();
  const classOf = new Map<string, number>();
  for (const e of model.entities.values()) {
    if (e.kind !== "point") continue;
    const root = find(e.name);
    if (!ids.has(root)) ids.set(root, ids.size);
    classOf.set(e.name, ids.get(root)!);
  }
  return classOf;
}

/** The lines and arcs that could be part of a loop, and the circles that are one each. */
function collect(model: Model, classOf: Map<string, number>): { edges: Edge[]; circles: CircleRef[] } {
  const edges: Edge[] = [];
  const circles: CircleRef[] = [];
  let order = 0;
  for (const e of model.entities.values()) {
    order++;
    if (e.kind === "line") {
      const at: [number, number] = [classOf.get(e.refs[0])!, classOf.get(e.refs[1])!];
      if (at[0] !== at[1]) edges.push({ name: e.name, kind: "line", order, ends: [e.refs[0], e.refs[1]], at });
    } else if (e.kind === "arc") {
      // An arc that draws nothing — an end on its centre, or no sweep at all
      // (see `arcFrame`) — bounds nothing either.
      const f = curveFrame(model, e);
      const at: [number, number] = [classOf.get(e.start)!, classOf.get(e.end)!];
      if (f && f.sweep > 1e-12 && f.r > 0 && at[0] !== at[1]) {
        edges.push({ name: e.name, kind: "arc", order, ends: [e.start, e.end], at });
      }
    } else if (e.kind === "circle") {
      if (model.radius(e.name) > 0) circles.push({ name: e.name, order });
    }
  }
  return { edges, circles };
}

// --- planes -------------------------------------------------------------------

/** A plane through `origin` with unit normal `n`, as `view.ts`'s Plane, for `liesOn`. */
function planeThrough(origin: number[], n: number[]): Plane {
  // Any in-plane pair will do for `liesOn`; take the kernel axis least along n.
  const axis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].reduce((best, a) =>
    Math.abs(dot3(a, n)) < Math.abs(dot3(best, n)) ? a : best);
  const along = dot3(axis, n);
  const u = unit3([axis[0] - along * n[0], axis[1] - along * n[1], axis[2] - along * n[2]])!;
  return { origin, u, v: cross3(n, u) };
}

function parallel(a: number[], b: number[]): boolean {
  return Math.hypot(...cross3(a, b)) <= PARALLEL_SINE;
}

interface Group {
  normal: number[];
  plane: Plane;
}

/**
 * Every plane a loop could lie in: each arc's and circle's own (its frame's
 * orientation through its centre), and the plane of every pair of lines that
 * meet at a joined vertex and are not parallel — a closed polygon with any area
 * has at least one such corner. Coplanar candidates are one plane.
 */
function candidatePlanes(model: Model, edges: Edge[], circles: CircleRef[]): Group[] {
  const groups: Group[] = [];
  const add = (origin: number[], n: number[]) => {
    for (const g of groups) if (parallel(g.normal, n) && liesOn(g.plane, origin)) return;
    groups.push({ normal: n, plane: planeThrough(origin, n) });
  };
  for (const c of circles) add(lift3(model.coords(model.circle(c.name).center)), curvePlaneOf(model, c.name).n);
  for (const e of edges) {
    if (e.kind === "arc") add(lift3(model.coords(model.arc(e.name).center)), curvePlaneOf(model, e.name).n);
  }
  const incident = new Map<number, { at: number[]; dir: number[] }[]>();
  for (const e of edges) {
    if (e.kind !== "line") continue;
    const [a, b] = e.ends.map((p) => lift3(model.coords(p)));
    for (const [k, from, to] of [[0, a, b], [1, b, a]] as const) {
      const list = incident.get(e.at[k]) ?? [];
      list.push({ at: from, dir: sub3(to, from) });
      incident.set(e.at[k], list);
    }
  }
  for (const list of incident.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const n = cross3(list[i].dir, list[j].dir);
        const len = Math.hypot(...n);
        const scale = Math.hypot(...list[i].dir) * Math.hypot(...list[j].dir);
        if (len > PARALLEL_SINE * scale) add(list[i].at, n.map((x) => x / len));
      }
    }
  }
  return groups;
}

/** Whether a line, arc or circle lies in a candidate plane. See the top of the file. */
function inPlane(model: Model, g: Group, name: string): boolean {
  const e = model.entities.get(name)!;
  const on = (p: string) => liesOn(g.plane, lift3(model.coords(p)));
  if (e.kind === "line") return on(e.refs[0]) && on(e.refs[1]);
  if (e.kind === "arc") return parallel(curvePlaneOf(model, name).n, g.normal) && on(e.center) && on(e.start) && on(e.end);
  if (e.kind === "circle") return parallel(curvePlaneOf(model, name).n, g.normal) && on(e.center);
  return false;
}

/** The frames to try as a plane's own, the default first and then in creation order. */
function framesByPreference(model: Model): string[] {
  const all = [...model.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);
  const d = model.defaultFrame;
  return d != null && all.includes(d) ? [d, ...all.filter((f) => f !== d)] : all;
}

/** The plane a group's loops are reported in, and measured in. See the top of the file. */
function orientPlane(model: Model, g: Group, lines: Edge[], curves: string[]): LoopPlane {
  if (model.dim === 2) {
    // Every 2D frame's plane is the drawing; the default (else the earliest)
    // names it. With none, the drawing's own x and y, as curveplane.ts reads a
    // 2D circle.
    const f = framesByPreference(model)[0];
    if (f === undefined) return { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], normal: [0, 0, 1], frame: null };
    const { origin, ux, uy } = frameBasis(model, f)();
    return { origin: lift3(origin), u: lift3(ux), v: lift3(uy), normal: [0, 0, 1], frame: f };
  }
  for (const f of framesByPreference(model)) {
    const axes = framePlaneAxes(model, f);
    if (!axes || !parallel(axes.n, g.normal)) continue;
    const origin = lift3(model.coords(model.frame(f).origin));
    if (liesOn(g.plane, origin)) return { origin, u: axes.u, v: axes.v, normal: axes.n, frame: f };
  }
  if (curves.length) {
    const { u, v, n } = curvePlaneOf(model, curves[0]);
    return { origin: lift3(model.coords(model.circular(curves[0]).center)), u, v, normal: n, frame: null };
  }
  // Lines only, and no frame to ask: the normal whose largest component is
  // positive (+z for anything drawn level), +u along the first line.
  const big = g.normal.reduce((k, x, i) => (Math.abs(x) > Math.abs(g.normal[k]) + 1e-12 ? i : k), 0);
  const normal = g.normal[big] < 0 ? g.normal.map((x) => -x) : g.normal.slice();
  const [a, b] = lines[0].ends.map((p) => lift3(model.coords(p)));
  const d = sub3(b, a);
  const along = dot3(d, normal);
  const u = unit3([d[0] - along * normal[0], d[1] - along * normal[1], d[2] - along * normal[2]])!;
  return { origin: a, u, v: cross3(normal, u), normal, frame: null };
}

// --- flat geometry, in a plane's own coordinates ----------------------------------

type P2 = [number, number];

/**
 * A line or arc walked in one direction, in a plane's (u, v) coordinates. An
 * arc runs from angle `t0` about `c` through the signed `sweep` (positive is
 * counter-clockwise about the plane's normal); `p` and `q` are exactly its two
 * ends at that radius, which is what keeps the area formula exact.
 */
type Piece =
  | { kind: "line"; p: P2; q: P2 }
  | { kind: "arc"; p: P2; q: P2; c: P2; r: number; t0: number; sweep: number };

const TAU = Math.PI * 2;
const sub2 = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const wedge2 = (a: P2, b: P2): number => a[0] * b[1] - a[1] * b[0];
const dist2 = (a: P2, b: P2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const onCircle = (c: P2, r: number, t: number): P2 => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
const mod = (x: number, m: number): number => ((x % m) + m) % m;

function arcPiece(c: P2, r: number, t0: number, sweep: number): Piece {
  return { kind: "arc", p: onCircle(c, r, t0), q: onCircle(c, r, t0 + sweep), c, r, t0, sweep };
}

function reversed(piece: Piece): Piece {
  if (piece.kind === "line") return { kind: "line", p: piece.q, q: piece.p };
  return arcPiece(piece.c, piece.r, piece.t0 + piece.sweep, -piece.sweep);
}

/** World → the plane's (u, v), measured from its origin. */
function toPlane(plane: LoopPlane, world: number[]): P2 {
  const d = sub3(lift3(world), plane.origin);
  return [dot3(d, plane.u), dot3(d, plane.v)];
}

/** The plane's (u, v) → world. */
function toWorld(plane: LoopPlane, [x, y]: P2): number[] {
  return [0, 1, 2].map((i) => plane.origin[i] + x * plane.u[i] + y * plane.v[i]);
}

/**
 * A line, arc or circle in its own direction, flat in `plane`. An arc is laid
 * out by `curveFrame` — the very arc that is drawn — so its sense in the plane
 * is its frame normal's side of the plane's. A circle starts at the plane's +u
 * and runs counter-clockwise about its own frame's +z.
 */
function pieceOf(model: Model, name: string, plane: LoopPlane): Piece {
  const e = model.entities.get(name)!;
  if (e.kind === "line") return { kind: "line", p: toPlane(plane, model.coords(e.refs[0])), q: toPlane(plane, model.coords(e.refs[1])) };
  const f = curveFrame(model, e)!;
  const c = toPlane(plane, f.center);
  const side = dot3(f.normal, plane.normal) < 0 ? -1 : 1;
  if (e.kind === "circle") return arcPiece(c, f.r, 0, side * TAU);
  const s = toPlane(plane, [0, 1, 2].map((i) => f.center[i] + f.r * f.u[i]));
  return arcPiece(c, f.r, Math.atan2(s[1] - c[1], s[0] - c[0]), side * f.sweep);
}

/** ½∮(x dy − y dx) along the piece — Green's theorem, closed form for a line and an arc. */
function pieceArea(piece: Piece): number {
  if (piece.kind === "line") return wedge2(piece.p, piece.q) / 2;
  return (wedge2(piece.c, sub2(piece.q, piece.p)) + piece.r * piece.r * piece.sweep) / 2;
}

/** The piece's direction where it starts. */
function startTangent(piece: Piece): P2 {
  if (piece.kind === "line") return sub2(piece.q, piece.p);
  const s = Math.sign(piece.sweep);
  return [-s * Math.sin(piece.t0), s * Math.cos(piece.t0)];
}

/** Signed curvature: positive turns left (counter-clockwise), a line is zero. */
function curvature(piece: Piece): number {
  return piece.kind === "line" ? 0 : Math.sign(piece.sweep) / piece.r;
}

/** Whether a point of the piece's circle is strictly inside its sweep, clear of both ends. */
function withinArc(piece: Extract<Piece, { kind: "arc" }>, x: P2, tol: number): boolean {
  const t = Math.atan2(x[1] - piece.c[1], x[0] - piece.c[0]);
  const along = mod(piece.sweep >= 0 ? t - piece.t0 : piece.t0 - t, TAU);
  return along <= Math.abs(piece.sweep) && dist2(x, piece.p) > tol && dist2(x, piece.q) > tol;
}

/** Whether a point of a segment is strictly inside it, clear of both ends. */
function withinSegment(a: P2, b: P2, x: P2, tol: number): boolean {
  const d = sub2(b, a);
  const t = ((x[0] - a[0]) * d[0] + (x[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  return t > 0 && t < 1 && dist2(x, a) > tol && dist2(x, b) > tol;
}

/** Where the segment a–b's line meets the circle, as two points — none for a miss or a tangency. */
function lineCircle(a: P2, b: P2, c: P2, r: number, tol: number): P2[] {
  const d = sub2(b, a), f = sub2(a, c);
  const A = d[0] * d[0] + d[1] * d[1];
  const B = 2 * (f[0] * d[0] + f[1] * d[1]);
  const C = f[0] * f[0] + f[1] * f[1] - r * r;
  const disc = B * B - 4 * A * C;
  if (!(A > 0) || disc <= 0) return [];
  const root = Math.sqrt(disc);
  // The roots are root/A apart in the parameter, root/|d| apart in length.
  if (root / Math.sqrt(A) <= tol) return [];
  return [(-B - root) / (2 * A), (-B + root) / (2 * A)].map((t) => [a[0] + t * d[0], a[1] + t * d[1]]);
}

/** Where two circles meet, as two points — none for a miss, a tangency, or the same circle. */
function circleCircle(c1: P2, r1: number, c2: P2, r2: number, tol: number): P2[] {
  const d = dist2(c1, c2);
  if (d <= tol || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const h = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const k2 = r1 * r1 - h * h;
  if (k2 <= 0 || 2 * Math.sqrt(k2) <= tol) return [];
  const k = Math.sqrt(k2);
  const [ux, uy] = [(c2[0] - c1[0]) / d, (c2[1] - c1[1]) / d];
  const m: P2 = [c1[0] + h * ux, c1[1] + h * uy];
  return [[m[0] - k * uy, m[1] + k * ux], [m[0] + k * uy, m[1] - k * ux]];
}

/**
 * Whether two pieces **cross**: pass through each other at a point clear of
 * every end of both. A touch is not a crossing — two pieces meeting at an end,
 * an end resting on the other piece (a T), a tangency, or two lines lying
 * along each other — and none of them leaves a face undefined.
 */
function cross(e: Piece, f: Piece, tol: number): boolean {
  if (e.kind === "line" && f.kind === "line") {
    const u = sub2(e.q, e.p), v = sub2(f.q, f.p);
    const den = wedge2(u, v);
    if (Math.abs(den) <= 1e-12 * Math.hypot(...u) * Math.hypot(...v)) return false;
    const w = sub2(f.p, e.p);
    const t = wedge2(w, v) / den;
    const x: P2 = [e.p[0] + t * u[0], e.p[1] + t * u[1]];
    return withinSegment(e.p, e.q, x, tol) && withinSegment(f.p, f.q, x, tol);
  }
  if (e.kind === "arc" && f.kind === "line") return cross(f, e, tol);
  if (e.kind === "line" && f.kind === "arc") {
    return lineCircle(e.p, e.q, f.c, f.r, tol).some((x) => withinSegment(e.p, e.q, x, tol) && withinArc(f, x, tol));
  }
  const [a, b] = [e as Extract<Piece, { kind: "arc" }>, f as Extract<Piece, { kind: "arc" }>];
  return circleCircle(a.c, a.r, b.c, b.r, tol).some((x) => withinArc(a, x, tol) && withinArc(b, x, tol));
}

/**
 * How far round `x` the piece turns, as seen from `x`: the angle from its start
 * to its end. A line, or an arc whose circle `x` is outside, turns less than a
 * half-turn and the plain signed angle is the answer. Seen from inside its
 * circle an arc turns monotonically its own way, so the same angle is taken
 * the long way round when it has to be — and a whole circle is a whole turn.
 */
function turnAbout(piece: Piece, x: P2): number {
  const a = sub2(piece.p, x), b = sub2(piece.q, x);
  const base = Math.atan2(wedge2(a, b), a[0] * b[0] + a[1] * b[1]);
  if (piece.kind === "line" || dist2(x, piece.c) >= piece.r) return base;
  if (Math.abs(piece.sweep) >= TAU - 1e-12) return Math.sign(piece.sweep) * TAU;
  if (piece.sweep > 0 && base < 0) return base + TAU;
  if (piece.sweep < 0 && base > 0) return base - TAU;
  return base;
}

/** Inside a closed outline: a non-zero winding number. */
function inside(outline: Piece[], x: P2): boolean {
  return Math.abs(outline.reduce((s, piece) => s + turnAbout(piece, x), 0)) > Math.PI;
}

/** The shortest distance from `x` to the piece. */
function distanceTo(piece: Piece, x: P2): number {
  if (piece.kind === "line") {
    const d = sub2(piece.q, piece.p);
    const len2 = d[0] * d[0] + d[1] * d[1];
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x[0] - piece.p[0]) * d[0] + (x[1] - piece.p[1]) * d[1]) / len2)) : 0;
    return dist2(x, [piece.p[0] + t * d[0], piece.p[1] + t * d[1]]);
  }
  const t = Math.atan2(x[1] - piece.c[1], x[0] - piece.c[0]);
  const along = mod(piece.sweep >= 0 ? t - piece.t0 : piece.t0 - t, TAU);
  if (along <= Math.abs(piece.sweep)) return Math.abs(dist2(x, piece.c) - piece.r);
  return Math.min(dist2(x, piece.p), dist2(x, piece.q));
}

/** The piece's halfway point. */
function midpoint(piece: Piece): P2 {
  if (piece.kind === "line") return [(piece.p[0] + piece.q[0]) / 2, (piece.p[1] + piece.q[1]) / 2];
  return onCircle(piece.c, piece.r, piece.t0 + piece.sweep / 2);
}

interface Box { x0: number; y0: number; x1: number; y1: number }

/** A box round the pieces — an arc's whole circle, which is generous and is all a prefilter needs. */
function boxOf(pieces: Piece[]): Box {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = ([x, y]: P2, r = 0) => {
    b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r);
    b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r);
  };
  for (const piece of pieces) {
    grow(piece.p); grow(piece.q);
    if (piece.kind === "arc") grow(piece.c, piece.r);
  }
  return b;
}

const overlaps = (a: Box, b: Box, tol: number): boolean =>
  a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;

// --- faces --------------------------------------------------------------------------

/** An edge of one plane's drawing, flat. */
interface FlatEdge {
  edge: Edge;
  /** In the edge's own direction. */
  piece: Piece;
}

/**
 * The edges that lie on no cycle — bridges, with every dangling tree among
 * them — by Tarjan's low-link, written for a multigraph: only the edge just
 * come along is skipped, so two edges between the same two vertices are a
 * cycle, as a line and an arc between two points are.
 */
function bridges(flat: FlatEdge[]): Set<number> {
  const adj = new Map<number, { id: number; to: number }[]>();
  flat.forEach(({ edge }, id) => {
    for (const [a, b] of [[edge.at[0], edge.at[1]], [edge.at[1], edge.at[0]]]) {
      const list = adj.get(a) ?? [];
      list.push({ id, to: b });
      adj.set(a, list);
    }
  });
  const disc = new Map<number, number>(), low = new Map<number, number>();
  const out = new Set<number>();
  let time = 0;
  const visit = (v: number, via: number) => {
    disc.set(v, time); low.set(v, time); time++;
    for (const { id, to } of adj.get(v)!) {
      if (id === via) continue;
      if (!disc.has(to)) {
        visit(to, id);
        low.set(v, Math.min(low.get(v)!, low.get(to)!));
        if (low.get(to)! > disc.get(v)!) out.add(id);
      } else {
        low.set(v, Math.min(low.get(v)!, disc.get(to)!));
      }
    }
  };
  for (const v of adj.keys()) if (!disc.has(v)) visit(v, -1);
  return out;
}

/** The connected pieces of a plane's drawing, as lists of its edges. */
function components(flat: FlatEdge[]): FlatEdge[][] {
  const up = new Map<number, number>();
  const find = (v: number): number => { while (up.has(v)) v = up.get(v)!; return v; };
  for (const { edge } of flat) {
    const [a, b] = [find(edge.at[0]), find(edge.at[1])];
    if (a !== b) up.set(b, a);
  }
  const by = new Map<number, FlatEdge[]>();
  for (const f of flat) {
    const root = find(f.edge.at[0]);
    by.set(root, [...(by.get(root) ?? []), f]);
  }
  return [...by.values()];
}

/**
 * A half-edge: edge `h >> 1`, walked in its own direction when `h` is even and
 * against it when odd, so `h ^ 1` is the same edge the other way.
 */
type Half = number;

/**
 * The minimal cycles of one connected, bridgeless, crossing-free component —
 * the bounded faces, each split at any vertex its walk visits twice — as lists
 * of half-edges, each counter-clockwise.
 */
function faceCycles(comp: FlatEdge[], size: number): Half[][] {
  const halves = comp.length * 2;
  const pieceOf = (h: Half): Piece => (h & 1 ? reversed(comp[h >> 1].piece) : comp[h >> 1].piece);
  const fromOf = (h: Half): number => comp[h >> 1].edge.at[h & 1];
  const toOf = (h: Half): number => comp[h >> 1].edge.at[1 - (h & 1)];

  // Each vertex's outgoing half-edges in counter-clockwise order. Ties in
  // direction go by curvature — the one bending left sits just
  // counter-clockwise of the one bending less — and two edges identical even
  // in that (the same line drawn twice) by a fixed imagined offset, larger
  // index to the left of the edge's direction from its lower-numbered end,
  // which orders them one way at one end and the other way at the other, as
  // two parallel edges a hair apart would be.
  const around = new Map<number, Half[]>();
  for (let h = 0; h < halves; h++) around.set(fromOf(h), [...(around.get(fromOf(h)) ?? []), h]);
  const position = new Array<number>(halves);
  for (const [v, list] of around) {
    const keyed = list.map((h) => {
      const piece = pieceOf(h);
      const t = startTangent(piece);
      const { at } = comp[h >> 1].edge;
      return { h, theta: Math.atan2(t[1], t[0]), kappa: curvature(piece), offset: (v === Math.min(...at) ? 1 : -1) * ((h >> 1) + 1) };
    }).sort((a, b) => a.theta - b.theta);
    const runs: (typeof keyed)[] = [];
    for (const k of keyed) {
      const run = runs.at(-1);
      if (run && k.theta - run.at(-1)!.theta <= ANGLE_TIE) run.push(k);
      else runs.push([k]);
    }
    // −π and π are one direction.
    if (runs.length > 1 && runs[0][0].theta + TAU - runs.at(-1)!.at(-1)!.theta <= ANGLE_TIE) runs[0].unshift(...runs.pop()!);
    const sameKappa = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
    const ordered = runs.flatMap((run) => run.sort((a, b) =>
      (sameKappa(a.kappa, b.kappa) ? 0 : a.kappa - b.kappa) || a.offset - b.offset)).map((k) => k.h);
    around.set(v, ordered);
    ordered.forEach((h, i) => { position[h] = i; });
  }

  // Interior on the left: arriving along h, leave by the edge just clockwise
  // of the way back. Bounded faces come out counter-clockwise.
  const next = (h: Half): Half => {
    const list = around.get(toOf(h))!;
    return list[(position[h ^ 1] - 1 + list.length) % list.length];
  };
  const area = (cycle: Half[]) => cycle.reduce((s, h) => s + pieceArea(pieceOf(h)), 0);
  const nothing = AREA_TOL * size * size;

  const cycles: Half[][] = [];
  const seen = new Uint8Array(halves);
  for (let h0 = 0; h0 < halves; h0++) {
    if (seen[h0]) continue;
    const walk: Half[] = [];
    let h = h0;
    do {
      // `next` is a permutation, so this returns to h0; the bound is a
      // tripwire, because a loop that never ends hangs the tab.
      if (walk.length > halves) throw new Error("loops: a face walk did not close");
      seen[h] = 1;
      walk.push(h);
      h = next(h);
    } while (h !== h0);
    // The unbounded face runs clockwise; a sliver between two copies of one
    // line encloses nothing. Neither is a region.
    if (!(area(walk) > nothing)) continue;
    for (const cycle of splitAtRepeats(walk, fromOf, toOf)) {
      const a = area(cycle);
      if (Math.abs(a) <= nothing) continue;
      // An island touching its outline at a point is walked clockwise as part
      // of the annulus round it; turned round, it is the island's own face.
      cycles.push(a > 0 ? cycle : cycle.slice().reverse().map((g) => g ^ 1));
    }
  }
  return cycles;
}

/** A closed walk as the simple cycles it is made of, split wherever it comes back to a vertex. */
function splitAtRepeats(walk: Half[], fromOf: (h: Half) => number, toOf: (h: Half) => number): Half[][] {
  const out: Half[][] = [];
  const path: Half[] = [];
  const at = new Map<number, number>([[fromOf(walk[0]), 0]]);
  for (const h of walk) {
    path.push(h);
    const v = toOf(h);
    const k = at.get(v);
    if (k === undefined) {
      at.set(v, path.length);
      continue;
    }
    const cycle = path.splice(k);
    for (const g of cycle) if (toOf(g) !== v) at.delete(toOf(g));
    out.push(cycle);
  }
  return out;
}

// --- finding them -------------------------------------------------------------------

/** A loop as it is being found: the public data, plus its outline and where it came from. */
interface Found {
  loop: Loop;
  outline: Piece[];
  group: number;
  /** Its members' creation orders, ascending — what sorts the listing. */
  orders: number[];
  size: number;
}

/**
 * Every closed loop in the drawing — see the top of the file for what counts.
 * In the order of their earliest-made members. Reads the model and nothing
 * else: journals nothing, names nothing, moves nothing.
 */
export function findLoops(model: Model): Loop[] {
  if (model.dim !== 2 && model.dim !== 3) {
    throw new Error(`loops lie in a plane, in a 2D or 3D model — this one is ${model.dim}D`);
  }
  const classOf = joinClasses(model);
  const { edges, circles } = collect(model, classOf);
  const groups = candidatePlanes(model, edges, circles);

  const found: Found[] = [];
  const keys = new Set<string>();
  groups.forEach((g, gi) => {
    const lines = edges.filter((e) => inPlane(model, g, e.name));
    const rings = circles.filter((c) => inPlane(model, g, c.name));
    if (!lines.length && !rings.length) return;
    const curves = [...lines.filter((e) => e.kind === "arc"), ...rings].sort((a, b) => a.order - b.order).map((c) => c.name);
    const plane = orientPlane(model, g, lines.filter((e) => e.kind === "line"), curves);

    const flat: FlatEdge[] = lines.map((edge) => ({ edge, piece: pieceOf(model, edge.name, plane) }));
    const box = boxOf([...flat.map((f) => f.piece), ...rings.map((c) => pieceOf(model, c.name, plane))]);
    const size = Math.max(1, Math.hypot(box.x1 - box.x0, box.y1 - box.y0));
    const tol = LENGTH_TOL * size;

    const cut = bridges(flat);
    for (const comp of components(flat.filter((_, i) => !cut.has(i)))) {
      if (crossesItself(comp, tol)) continue;
      for (const cycle of faceCycles(comp, size)) {
        const halves = rotateToEarliest(cycle, comp);
        const members = halves.map((h): LoopMember => {
          const { edge } = comp[h >> 1];
          const back = (h & 1) === 1;
          return { name: edge.name, reversed: back, from: edge.ends[back ? 1 : 0], to: edge.ends[back ? 0 : 1] };
        });
        const outline = halves.map((h) => (h & 1 ? reversed(comp[h >> 1].piece) : comp[h >> 1].piece));
        const key = members.map((m) => m.name).sort().join(",");
        if (keys.has(key)) continue;
        keys.add(key);
        found.push({
          loop: { members, plane, area: outline.reduce((s, p) => s + pieceArea(p), 0), parent: null, children: [] },
          outline, group: gi, orders: halves.map((h) => comp[h >> 1].edge.order).sort((a, b) => a - b), size,
        });
      }
    }
    for (const c of rings) {
      if (keys.has(c.name)) continue;
      keys.add(c.name);
      // Counter-clockwise about the plane's normal: against the circle's own
      // way round when its frame faces the other way.
      const own = pieceOf(model, c.name, plane);
      const outline = [own.kind === "arc" && own.sweep < 0 ? reversed(own) : own];
      found.push({
        loop: {
          members: [{ name: c.name, reversed: outline[0] !== own, from: null, to: null }],
          plane, area: pieceArea(outline[0]), parent: null, children: [],
        },
        outline, group: gi, orders: [c.order], size,
      });
    }
  });

  found.sort((a, b) => {
    for (let i = 0; i < Math.min(a.orders.length, b.orders.length); i++) {
      if (a.orders[i] !== b.orders[i]) return a.orders[i] - b.orders[i];
    }
    return a.orders.length - b.orders.length;
  });
  relateContainment(found);
  return found.map((f) => f.loop);
}

/** Whether any two edges of a component cross — see the top of the file for why that rules it out. */
function crossesItself(comp: FlatEdge[], tol: number): boolean {
  const boxes = comp.map((f) => boxOf([f.piece]));
  for (let i = 0; i < comp.length; i++) {
    for (let j = i + 1; j < comp.length; j++) {
      if (overlaps(boxes[i], boxes[j], tol) && cross(comp[i].piece, comp[j].piece, tol)) return true;
    }
  }
  return false;
}

/** A counter-clockwise cycle, started from its earliest-made member. */
function rotateToEarliest(cycle: Half[], comp: FlatEdge[]): Half[] {
  let k = 0;
  cycle.forEach((h, i) => { if (comp[h >> 1].edge.order < comp[cycle[k] >> 1].edge.order) k = i; });
  return [...cycle.slice(k), ...cycle.slice(0, k)];
}

/**
 * Fills in `parent` and `children`: for each loop, the smallest coplanar loop
 * that wholly contains it.
 */
function relateContainment(found: Found[]): void {
  const boxes = found.map((f) => boxOf(f.outline));
  for (let i = 0; i < found.length; i++) {
    const a = found[i];
    let best = -1;
    for (let j = 0; j < found.length; j++) {
      const b = found[j];
      if (i === j || a.group !== b.group) continue;
      if (!(a.loop.area < b.loop.area - AREA_TOL * b.size * b.size)) continue;
      if (!contains(b, a, boxes[j], boxes[i])) continue;
      if (best < 0 || b.loop.area < found[best].loop.area) best = j;
    }
    if (best < 0) continue;
    a.loop.parent = best;
    found[best].loop.children.push(i);
  }
}

/**
 * Whether `outer` wholly contains `inner`, both in one plane. Their outlines
 * must not cross; with that settled, `inner` is all on one side of `outer`'s
 * outline (touching it is allowed), so its ends and midpoints all being inside
 * or on it — and one of them clear inside — decides it.
 */
function contains(outer: Found, inner: Found, ob: Box, ib: Box): boolean {
  const tol = LENGTH_TOL * outer.size;
  if (ib.x0 < ob.x0 - tol || ib.y0 < ob.y0 - tol || ib.x1 > ob.x1 + tol || ib.y1 > ob.y1 + tol) return false;
  for (const p of inner.outline) for (const q of outer.outline) if (cross(p, q, tol)) return false;
  const probes = inner.outline.flatMap((piece) =>
    piece.kind === "arc" && Math.abs(piece.sweep) >= TAU - 1e-12
      ? [0, 1, 2, 3].map((k) => onCircle(piece.c, piece.r, piece.t0 + (k * Math.PI) / 2))
      : [piece.p, midpoint(piece)]);
  let clear = false;
  for (const x of probes) {
    if (outer.outline.some((piece) => distanceTo(piece, x) <= tol)) continue;
    if (!inside(outer.outline, x)) return false;
    clear = true;
  }
  return clear;
}

/** A loop's outline, re-read from the model in its plane — what `loopAt` tests a click against. */
function outlineOf(model: Model, loop: Loop): Piece[] {
  // `pieceOf` is each member in its own direction — a circle's being
  // counter-clockwise about its own frame — so `reversed` is all it takes.
  return loop.members.map((m) => {
    const piece = pieceOf(model, m.name, loop.plane);
    return m.reversed ? reversed(piece) : piece;
  });
}

// --- the click ------------------------------------------------------------------------

/**
 * The loop a click at (sx, sy) is inside, or null — see the top of the file
 * for the rule. `loops` is what `findLoops` returned, when the caller already
 * has it; the answer is one of its elements, so its `parent` and `children`
 * index that same array.
 */
export function loopAt(model: Model, view: View, sx: number, sy: number, loops: Loop[] = findLoops(model)): Loop | null {
  const hits: { i: number; depth: number }[] = [];
  loops.forEach((loop, i) => {
    const outline = outlineOf(model, loop);
    if (edgeOn(view, loop.plane, outline)) return;
    const { origin, u, v } = loop.plane;
    const w = screenToPlane(view, sx, sy, { origin, u, v });
    if (!w || !inside(outline, toPlane(loop.plane, w))) return;
    hits.push({ i, depth: depth(view, w) });
  });
  // Innermost first: a loop around another hit loop is not what was clicked.
  const holdsAHit = (i: number) => hits.some((h) => {
    for (let p = loops[h.i].parent; p !== null; p = loops[p].parent) if (p === i) return true;
    return false;
  });
  const left = hits.filter((h) => !holdsAHit(h.i));
  left.sort((a, b) => {
    const tie = 1e-9 * Math.max(1, Math.abs(a.depth), Math.abs(b.depth));
    if (Math.abs(a.depth - b.depth) > tie) return b.depth - a.depth;
    return (loops[a.i].area - loops[b.i].area) || a.i - b.i;
  });
  return left.length ? loops[left[0].i] : null;
}

/**
 * Whether the loop is too nearly edge-on to have an inside on screen: thinner
 * than `EDGE_ON_PX` across the line its plane is seen as. The one screen-space
 * tolerance in this file. Arcs are sampled the way they are drawn (a quarter-
 * pixel polyline, `arcSegments`); a plane seen square-on has no thin direction
 * at all.
 */
function edgeOn(view: View, plane: LoopPlane, outline: Piece[]): boolean {
  const { right, up } = viewAxes(view);
  // The screen direction the plane is foreshortened along: its normal, seen.
  const m = [dot3(plane.normal, right), -dot3(plane.normal, up)];
  const len = Math.hypot(m[0], m[1]);
  if (len < 1e-12) return false;
  let lo = Infinity, hi = -Infinity;
  const take = (p: P2) => {
    const [x, y] = worldToScreen(view, toWorld(plane, p));
    const s = (x * m[0] + y * m[1]) / len;
    lo = Math.min(lo, s); hi = Math.max(hi, s);
  };
  for (const piece of outline) {
    if (piece.kind === "line") { take(piece.p); continue; }
    const n = arcSegments(Math.abs(piece.sweep), piece.r * view.scale);
    for (let k = 0; k < n; k++) take(onCircle(piece.c, piece.r, piece.t0 + (piece.sweep * k) / n));
  }
  return hi - lo < EDGE_ON_PX;
}

// --- the listing ------------------------------------------------------------------------

/**
 * One line of `loops()`: `loop of l1,l4,l3,l2 in f1, area 1200`, and where it
 * lies inside another, `…, inside l5,l6,l7,l8` — a loop is named by its
 * members, since it has no name of its own.
 */
export function describeLoop(loop: Loop, all: Loop[]): string {
  const names = (l: Loop) => l.members.map((m) => m.name).join(",");
  const round = (x: number) => Number(x.toFixed(3)) + 0; // + 0 turns -0 into 0
  const where = loop.plane.frame !== null
    ? ` in ${loop.plane.frame}`
    : ` in the plane facing (${loop.plane.normal.map(round).join(", ")})`;
  const within = loop.parent === null ? "" : `, inside ${names(all[loop.parent])}`;
  return `loop of ${names(loop)}${where}, area ${round(loop.area)}${within}`;
}
