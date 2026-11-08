// The solids a model's features are, exactly: boundary representations of
// planes, cylinders, cones, spheres, tori and surfaces of revolution, bounded
// by lines and circles — what a STEP file carries (step.ts), and the volume
// and extent ZeroCAD says each one has.
//
// faces.ts answers a different question. It draws: every curved surface cut
// into flat pieces at the screen's resolution, every face a polygon. Nothing
// here is sampled. A cylinder wall is one cylindrical face bounded by two
// circles and two lines, whatever the zoom, so the part another CAD tool reads
// is the part, not a mesh of it.
//
// Pure: a function of the model and nothing else, no DOM, no view. It reads a
// curve's geometry only through curveplane.ts and arcgeom.ts (the plane, the
// centre, the radius, the sweep) and a feature's plane through
// `featurePlane`, so a change to how a curve records its orientation changes
// those accessors and not this file.
//
// **What a body is.** One per feature — there are no booleans, so each extrude
// and each revolve is a solid of its own — or one per connected piece of a
// feature, when its profile has an island inside a hole: the island is solid
// and the hole round it is not, so the island is a separate solid, which a
// single manifold B-rep cannot hold. Hidden features are left out (the caller
// asks for what is shown); construction geometry never bounds a region, so it
// is never in a profile to begin with.
//
// **Topology is shared, and orientation is computed, not assumed.** Every
// vertex is made once and every edge once, and each edge is used by exactly two
// faces, once each way. Each profile loop is walked with the material on its
// left as seen from the side the solid grows toward (the extrude direction, or
// the way a revolve sweeps), from its winding and how deeply it is nested —
// faces.ts's rule, with nothing trusted about the order members were found
// in. From that walk every face's loop follows the same way round its outward
// normal, and whether the surface's own normal agrees (`sameSense`) is asked
// of the geometry at a point inside the face.
//
// **A whole circle is two half circles**, and a full revolve is two half
// turns. A circle as one closed edge needs a seam edge that one face uses
// twice, on a periodic surface; that is legal and most readers take it, but it
// is the one place readers differ, and two halves are read by everything. So
// no face here has a seam and no edge is used twice by one face.

import { entityKind, isClosedEntity, memberName, type FeatureEntry, type Model, type ProfileMember } from "./model.ts";
import { portionAngles } from "./arcgeom.ts";
import { curveFrame, curvePath, featurePlane } from "./curveplane.ts";
import { derivs, domain, nearestParam, nurbsOf, pointAt as pathPoint, subCurve, type BSpline } from "./bspline.ts";
import { axisReader, isFullTurn, turnMatrix } from "./relations/revolution.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";
import type { Member, NurbsCurve, NurbsSurface, Placement as KernelPlacement, Profile as KernelProfile } from "./solids/kernel.ts";
import type { Sweep } from "./solids/evaluate.ts";

// ---- what a solid is made of ----------------------------------------------------

export interface Vertex {
  id: number;
  at: number[];
}

/**
 * The curve an edge lies on, run in the edge's own direction (start to end): a
 * line through its two vertices, or a circle counter-clockwise about `normal`
 * from `ref`.
 */
export type Curve =
  | { kind: "line" }
  | { kind: "circle"; center: number[]; normal: number[]; ref: number[]; r: number }
  /**
   * An ellipse, counter-clockwise about `normal` from `ref`, its major (`a`)
   * axis along `ref` and its `b` axis a quarter turn on — Part 42's ELLIPSE
   * (docs/plans/sketch-shapes.md).
   */
  | { kind: "ellipse"; center: number[]; normal: number[]; ref: number[]; a: number; b: number }
  /** The solid kernel's exact curve, as it gave it (a boolean's edge — kernelbrep.ts); `sense`: whether it runs the edge's way. */
  | { kind: "bspline"; nurbs: NurbsCurve; sense: boolean };

export interface Edge {
  id: number;
  start: Vertex;
  end: Vertex;
  curve: Curve;
}

/** An edge as one loop walks it: its own way (`forward`), or against it. */
export interface Use {
  edge: Edge;
  forward: boolean;
}

/** One closed loop of a face: its outer boundary, or a hole in it. Walked counter-clockwise about the face's outward normal when outer, clockwise when a hole. */
export interface Bound {
  outer: boolean;
  uses: Use[];
}

/** A surface, placed: `axis` is its normal (a plane) or the axis it is round; `ref` a unit direction square to it. */
export type Surface =
  | { kind: "plane"; origin: number[]; axis: number[]; ref: number[] }
  | { kind: "cylinder"; origin: number[]; axis: number[]; ref: number[]; r: number }
  /** Radius `r` at `origin`, widening along +axis at `semiAngle` (radians). */
  | { kind: "cone"; origin: number[]; axis: number[]; ref: number[]; r: number; semiAngle: number }
  | { kind: "sphere"; origin: number[]; axis: number[]; ref: number[]; r: number }
  | { kind: "torus"; origin: number[]; axis: number[]; ref: number[]; major: number; minor: number }
  /** `curve` turned about the line through `origin` along `axis`: a circle, or a B-spline (a spline's, docs/plans/spline.md). */
  | { kind: "revolution"; origin: number[]; axis: number[]; curve: Extract<Curve, { kind: "circle" | "bspline" }> }
  /** The solid kernel's exact surface, where no feature says what it is (kernelbrep.ts). */
  | { kind: "bspline"; nurbs: NurbsSurface }
  /**
   * `curve` swept along `axis` — an ellipse's wall, or a B-spline's (a
   * spline's, docs/plans/spline.md): Part 42's SURFACE_OF_LINEAR_EXTRUSION.
   */
  | { kind: "extrusion"; curve: Extract<Curve, { kind: "ellipse" | "bspline" }>; axis: number[] };

export interface Face {
  surface: Surface;
  /** Whether the surface's own normal is the face's outward one. */
  sameSense: boolean;
  bounds: Bound[];
}

/** A closed shell: faces whose outward normals point out of the material. */
export interface Shell {
  faces: Face[];
}

export interface Body {
  /** What a receiving tool calls it: the feature's name, and `e1.2`, … for a second piece of one. */
  name: string;
  feature: string;
  outer: Shell;
  /** Cavities wholly inside the material — a full revolve of a profile with a hole. Normals point into the cavity. */
  voids: Shell[];
  /** ZeroCAD's own measure of it, from the profile — not from these faces — so the two check each other. */
  volume: number;
  /** Its extent, `[min, max]`, each three coordinates. */
  box: [number[], number[]];
  /** A surface's sheet (docs/plans/surfaces.md): an open shell, no volume — written as a surface model, not a solid. */
  sheet?: true;
}

/** What could and could not be made. A feature that cannot be laid out costs its own body and is named. */
export interface Solids {
  bodies: Body[];
  skipped: { feature: string; why: string }[];
}

/**
 * Every shown feature's exact solids. `features` narrows it to some (by name);
 * hidden features are left out either way, because the export is of what is
 * shown.
 */
export function solidsOf(model: Model, features?: readonly string[]): Solids {
  const out: Solids = { bodies: [], skipped: [] };
  for (const f of model.features.values()) {
    if (model.hidden.has(f.name)) continue;
    if (features && !features.includes(f.name)) continue;
    try {
      out.bodies.push(...(f.kind === "revolve" ? revolveBodies(model, f) : extrudeBodies(model, f)));
    } catch (e) {
      out.skipped.push({ feature: f.name, why: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

// ---- profile pieces ---------------------------------------------------------------

/**
 * One piece of a profile loop, in its entity's own direction: a line from `a`
 * to `b`, or the arc `c + r(cos t·u + sin t·v)` for t from `t0` to `t1`.
 * `a` and `b` are where its ends really are — the points themselves where
 * there are any — so a vertex is where the sketch's point is.
 */
type Piece =
  | { kind: "line"; a: number[]; b: number[] }
  /** `rv`, when there is one, is an ellipse's semi-axis along `v` (arcgeom.ts's `ArcFrame.rv`). */
  | { kind: "arc"; c: number[]; r: number; rv?: number; u: number[]; v: number[]; t0: number; t1: number; a: number[]; b: number[] }
  /**
   * A curve laid out by an exact B-spline (curveplane.ts's `curvePath`; a
   * spline), the whole of the piece over its own domain, three coordinates.
   */
  | { kind: "path"; curve: BSpline; a: number[]; b: number[] };

const TAU = Math.PI * 2;

type ArcPiece = Extract<Piece, { kind: "arc" }>;

function onArc(p: Pick<ArcPiece, "c" | "r" | "u" | "v" | "rv">, t: number): number[] {
  const [c, s] = [Math.cos(t) * p.r, Math.sin(t) * (p.rv ?? p.r)];
  return [0, 1, 2].map((i) => p.c[i] + c * p.u[i] + s * p.v[i]);
}

/**
 * A profile member as pieces. A whole circle is two half circles (see the top
 * of this file), and so is a portion of one that goes all the way round from a
 * single point: an edge that starts where it ends needs the seam this file
 * never makes.
 */
function piecesOf(model: Model, m: ProfileMember): Piece[] {
  const name = memberName(m);
  const e = model.entities.get(name);
  if (!e) throw new Error(`its profile member ${name} is gone`);
  const at = (p: string) => lift3(model.coords(p));
  if (e.kind === "line") {
    const [p, q] = typeof m === "string" ? e.refs : [m.from, m.to];
    return [{ kind: "line", a: at(p), b: at(q) }];
  }
  const path = curvePath(model, e);
  if (path) {
    // A whole curve only — a part of one is refused where it is planned
    // (operations.ts) — and a closed one in two halves, as a circle is.
    if (typeof m !== "string") throw new Error(`a part of ${name} cannot be made — it bounds a solid only whole`);
    const [lo, hi] = domain(path.curve);
    const piece = (c: BSpline): Piece => ({ kind: "path", curve: c, a: pathPoint(c, domain(c)[0]), b: pathPoint(c, domain(c)[1]) });
    // Its ends are its first and last points exactly: the curve is clamped.
    if (!path.closed) return [piece(path.curve)];
    const mid = (lo + hi) / 2;
    return [piece(subCurve(path.curve, lo, mid)), piece(subCurve(path.curve, mid, hi))];
  }
  if (e.kind !== "arc" && e.kind !== "circle" && e.kind !== "ellipse" && e.kind !== "earc") throw new Error(`its profile member ${name} is a ${e.kind}, which bounds nothing`);
  const f = curveFrame(model, e);
  if (!f) throw new Error(`${name} cannot be laid out (an end on its centre)`);
  const circle: Pick<ArcPiece, "c" | "r" | "u" | "v" | "rv"> = { c: f.center, r: f.r, u: f.u, v: f.v };
  if (f.rv !== undefined) circle.rv = f.rv;
  const arc = (t0: number, t1: number, a: number[], b: number[]): ArcPiece => ({ kind: "arc", ...circle, t0, t1, a, b });
  const halves = (t0: number): Piece[] => {
    const [p0, p1] = [onArc(circle, t0), onArc(circle, t0 + Math.PI)];
    return [arc(t0, t0 + Math.PI, p0, p1), arc(t0 + Math.PI, t0 + TAU, p1, p0)];
  };
  // A whole ellipse is two half ellipses, from its major end, as a circle is two halves. An
  // elliptical arc (docs/plans/trim-everything.md) is one piece of its ellipse, from its own
  // start (`ArcFrame.t0`) through its sweep, between its two end points.
  if (typeof m === "string") {
    if (isClosedEntity(e)) return halves(0);
    const ends = e.kind === "arc" ? [e.start, e.end] : entityKind(e.kind)!.ends!(e)!;
    const t0 = f.t0 ?? 0;
    return [arc(t0, t0 + f.sweep, at(ends[0]), at(ends[1]))];
  }
  if (e.kind === "ellipse" || e.kind === "earc") throw new Error(`a part of the ellipse ${name} cannot be made — an ellipse bounds a solid only whole`);
  const [a, b] = [at(m.from), at(m.to)];
  const [t0, t1] = portionAngles(f, a, b);
  return t1 - t0 >= TAU - 1e-9 ? halves(t0) : [arc(t0, t1, a, b)];
}

/** The point a fraction `s` of the way along a piece, in its own direction. */
function pieceAt(p: Piece, s: number): number[] {
  if (p.kind === "line") return p.a.map((x, i) => x + s * (p.b[i] - x));
  if (p.kind === "path") { const [lo, hi] = domain(p.curve); return pathPoint(p.curve, lo + s * (hi - lo)); }
  return onArc(p, p.t0 + s * (p.t1 - p.t0));
}

/** The piece's direction of travel at fraction `s`, in its own direction. */
function pieceTangent(p: Piece, s: number): number[] {
  if (p.kind === "line") return sub3(p.b, p.a);
  if (p.kind === "path") { const [lo, hi] = domain(p.curve); return derivs(p.curve, lo + s * (hi - lo), 1)[1].map((c) => c * (hi - lo)); }
  const t = p.t0 + s * (p.t1 - p.t0);
  return [0, 1, 2].map((i) => -p.r * Math.sin(t) * p.u[i] + (p.rv ?? p.r) * Math.cos(t) * p.v[i]);
}

/** The curve a piece lies on, moved by `x`, in its own direction. */
function curveOf(p: Piece, x: Placement): Curve {
  if (p.kind === "line") return { kind: "line" };
  // A B-spline moved is its control points moved: exactly the curve, placed.
  if (p.kind === "path") {
    const n = nurbsOf({ ...p.curve, ctrl: p.curve.ctrl.map((c) => x.point(c)) });
    return { kind: "bspline", nurbs: { kind: "bspline", rational: false, ...n }, sense: true };
  }
  if (p.rv !== undefined) {
    return { kind: "ellipse", center: x.point(p.c), normal: x.vector(unit3(cross3(p.u, p.v))!), ref: x.vector(p.u), a: p.r, b: p.rv };
  }
  return {
    kind: "circle", center: x.point(p.c), normal: x.vector(unit3(cross3(p.u, p.v))!),
    ref: x.vector(p.u), r: p.r,
  };
}

/** A NURBS of unit weights (a B-spline curve as `curveOf` writes one) read back as the plain B-spline it is. */
function bsplineOf(n: NurbsCurve): BSpline {
  const knots = n.knots.flatMap((k, i) => new Array<number>(n.mults[i]).fill(k));
  return { degree: n.degree, knots, ctrl: n.points.map((q) => [q[0], q[1], q[2]]) };
}

/** A rigid motion: a translation, or a turn about an axis. */
interface Placement {
  point(p: number[]): number[];
  vector(v: number[]): number[];
}

const still: Placement = { point: (p) => p, vector: (v) => v };

function shifted(d: number[]): Placement {
  return { point: (p) => p.map((x, i) => x + d[i]), vector: (v) => v };
}

function turned(origin: number[], k: number[], angle: number): Placement {
  const m = turnMatrix(k, angle);
  const vector = (v: number[]) => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
  return { point: (p) => { const v = vector(sub3(p, origin)); return v.map((x, i) => origin[i] + x); }, vector };
}

/**
 * A loop's pieces walked closed, nearest end to nearest end — the first piece
 * tried both ways and the tighter closure kept, faces.ts's `orient` — with the
 * joints between them: joint k is where piece k ends and piece k+1 begins, at
 * the mean of the two ends (they are one point, or two held together). A gap
 * wider than `tol` is a profile that does not close, which is refused rather
 * than bridged.
 */
interface Walk {
  pieces: Piece[];
  /** Whether each piece is walked in its own direction. */
  forward: boolean[];
  /** Joint k: the end of piece k, the start of piece k + 1. */
  joints: number[][];
}

function walk(pieces: Piece[], tol: number, what: string): Walk {
  const ends = (p: Piece, fwd: boolean) => (fwd ? [p.a, p.b] : [p.b, p.a]);
  const gap = (a: number[], b: number[]) => Math.hypot(...sub3(a, b));
  let best: { forward: boolean[]; total: number; worst: number } | null = null;
  for (const first of [true, false]) {
    const forward = [first];
    let end = ends(pieces[0], first)[1];
    let total = 0, worst = 0;
    for (let i = 1; i < pieces.length; i++) {
      const [f, b] = [gap(pieces[i].a, end), gap(pieces[i].b, end)];
      const fwd = f <= b;
      forward.push(fwd);
      total += Math.min(f, b);
      worst = Math.max(worst, Math.min(f, b));
      end = ends(pieces[i], fwd)[1];
    }
    const close = gap(end, ends(pieces[0], first)[0]);
    total += close;
    worst = Math.max(worst, close);
    if (!best || total < best.total) best = { forward, total, worst };
  }
  if (best!.worst > tol) throw new Error(`${what} does not close — its ends are ${best!.worst.toPrecision(3)} apart at the worst joint`);
  const joints = pieces.map((p, k) => {
    const next = (k + 1) % pieces.length;
    const end = ends(p, best!.forward[k])[1];
    const start = ends(pieces[next], best!.forward[next])[0];
    return end.map((x, i) => (x + start[i]) / 2);
  });
  return { pieces, forward: best!.forward, joints };
}

/** The same loop walked the other way round. */
function reversedWalk(w: Walk): Walk {
  const n = w.pieces.length;
  const pieces = w.pieces.slice().reverse();
  const forward = w.forward.slice().reverse().map((f) => !f);
  // Reversed, piece k is old piece n-1-k, and it now ends where that one began:
  // at old joint n-2-k.
  const joints = pieces.map((_, k) => w.joints[(2 * n - 2 - k) % n]);
  return { pieces, forward, joints };
}

// ---- line integrals, for areas and volumes -----------------------------------------

/** Gauss–Legendre, eight points on [-1, 1]: exact for the polynomials a line's integrands are, to rounding for an arc's in short spans. */
const GL_X = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
  0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
const GL_W = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
  0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/**
 * ∫ f(p) · (dp · dir) along a piece in its own direction — the one integral
 * Green's theorem needs, `∮ x dy` for an area and `∮ x²/2 dy` for the first
 * moment Pappus turns into a volume. In closed-form pieces: a line is one span,
 * an arc one span per sixteenth of a turn, so the trigonometric integrands are
 * integrated to rounding.
 */
function integral(p: Piece, f: (q: number[]) => number, dir: number[]): number {
  if (p.kind === "path") {
    // Span by knot span, where the curve is one polynomial: eight points
    // integrate its area's degree-5 integrand and the moment's degree-8 exactly.
    const [lo, hi] = domain(p.curve);
    const breaks = [lo, ...p.curve.knots.filter((k) => k > lo && k < hi), hi].filter((k, i, all) => i === 0 || k !== all[i - 1]);
    let sum = 0;
    for (let i = 0; i + 1 < breaks.length; i++) {
      const [a, b] = [breaks[i], breaks[i + 1]];
      for (let g = 0; g < GL_X.length; g++) {
        const u = (a + b) / 2 + ((b - a) / 2) * GL_X[g];
        const [q, d] = derivs(p.curve, u, 1);
        sum += GL_W[g] * ((b - a) / 2) * f(q) * dot3(d, dir);
      }
    }
    return sum;
  }
  const spans = p.kind === "line" ? 1 : Math.max(1, Math.ceil((p.t1 - p.t0) / (TAU / 16)));
  let sum = 0;
  for (let s = 0; s < spans; s++) {
    for (let g = 0; g < GL_X.length; g++) {
      const frac = (s + (GL_X[g] + 1) / 2) / spans;
      sum += GL_W[g] / 2 / spans * f(pieceAt(p, frac)) * dot3(pieceTangent(p, frac), dir);
    }
  }
  // pieceTangent is d/dfraction for a line and d/dt for an arc: scale the arc's.
  return p.kind === "line" ? sum : sum * (p.t1 - p.t0);
}

/** A walked loop's ∮ f dy (dy along `dir`): each piece's integral, signed by which way it is walked. */
function loopIntegral(w: Walk, f: (q: number[]) => number, dir: number[]): number {
  return w.pieces.reduce((s, p, k) => s + (w.forward[k] ? 1 : -1) * integral(p, f, dir), 0);
}

// ---- orientation and nesting --------------------------------------------------------

/** Two unit directions spanning the plane square to `n`, with u × v = n. */
function planeAxes(n: number[], hint?: number[]): { u: number[]; v: number[] } {
  let u = hint ? unit3(sub3(hint, n.map((c) => c * dot3(hint, n)))) : null;
  if (!u) {
    const pick = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    u = unit3(sub3(pick, n.map((c) => c * dot3(pick, n))))!;
  }
  return { u, v: cross3(n, u) };
}

/** A loop as a flat polygon in (u, v), fine enough to say what is inside what. */
function polygon(w: Walk, origin: number[], u: number[], v: number[]): [number, number][] {
  const out: [number, number][] = [];
  w.pieces.forEach((p, k) => {
    const n = p.kind === "line" ? 1 : p.kind === "path" ? 32 * Math.max(1, p.curve.ctrl.length - p.curve.degree)
      : Math.max(8, Math.ceil((p.t1 - p.t0) / (TAU / 128)));
    for (let i = 0; i < n; i++) {
      const q = pieceAt(p, w.forward[k] ? i / n : 1 - i / n);
      const d = sub3(q, origin);
      out.push([dot3(d, u), dot3(d, v)]);
    }
  });
  return out;
}

function inside(poly: [number, number][], p: [number, number]): boolean {
  let yes = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) yes = !yes;
  }
  return yes;
}

/**
 * A feature's loops walked with the material on their left about `n` (the way
 * the solid grows), grouped into the connected pieces of material they bound:
 * each loop inside an even number of the others is an outline, and the loops
 * directly inside it (an odd number) are its holes. An island in a hole is an
 * outline again, of a piece of its own.
 */
interface Region {
  outline: number;
  holes: number[];
}

function orientAndGroup(walks: Walk[], n: number[]): { walks: Walk[]; regions: Region[]; areas: number[] } {
  const origin = walks[0].joints[0];
  const { u, v } = planeAxes(n);
  const polys = walks.map((w) => polygon(w, origin, u, v));
  // Nesting from a point on the loop, a piece's middle, so a loop touching
  // another at a vertex is not miscounted at the touch.
  const containers = walks.map((w, i) => {
    const d = sub3(pieceAt(w.pieces[0], 0.5), origin);
    const probe: [number, number] = [dot3(d, u), dot3(d, v)];
    return polys.map((poly, j) => j !== i && inside(poly, probe)).map((yes, j) => (yes ? j : -1)).filter((j) => j >= 0);
  });
  const depth = containers.map((c) => c.length);
  const oriented = walks.map((w, i) => {
    // ∮ x dy about n: positive counter-clockwise. Material on the left is
    // counter-clockwise for an outline (even depth), clockwise for a hole.
    const area = loopIntegral(w, (q) => dot3(sub3(q, origin), u), v);
    const wantCcw = depth[i] % 2 === 0;
    return (area > 0) === wantCcw ? w : reversedWalk(w);
  });
  const areas = oriented.map((w) => loopIntegral(w, (q) => dot3(sub3(q, origin), u), v));
  const regions: Region[] = [];
  depth.forEach((d, i) => { if (d % 2 === 0) regions.push({ outline: i, holes: [] }); });
  depth.forEach((d, i) => {
    if (d % 2 === 0) return;
    // A hole's outline is the deepest loop it is inside.
    const parent = containers[i].reduce((best, j) => (best < 0 || depth[j] > depth[best] ? j : best), -1);
    regions.find((r) => r.outline === parent)?.holes.push(i);
  });
  return { walks: oriented, regions, areas };
}

// ---- building ----------------------------------------------------------------------

/** Vertices and edges made once each, by key — what makes the topology shared rather than repeated. */
class Topology {
  private next = 1;
  private readonly vertices = new Map<string, Vertex>();
  private readonly edges = new Map<string, Edge>();

  vertex(key: string, at: () => number[]): Vertex {
    let v = this.vertices.get(key);
    if (!v) this.vertices.set(key, v = { id: this.next++, at: at() });
    return v;
  }

  edge(key: string, make: () => { start: Vertex; end: Vertex; curve: Curve }): Edge {
    let e = this.edges.get(key);
    if (!e) {
      const { start, end, curve } = make();
      this.edges.set(key, e = { id: this.next++, start, end, curve });
    }
    return e;
  }
}

/**
 * The surface's own normal at a point on it — Part 42's σu × σv for each kind,
 * which is what `same_sense` is measured against. A surface of revolution's
 * depends on which turn of its curve the point is on, so it is asked for at a
 * point given as that: `q` on the swept curve, turned through `angle`.
 */
export function surfaceNormal(s: Surface, p: number[], swept?: { q: number[]; angle: number }): number[] {
  const radial = (origin: number[], axis: number[]) => {
    const d = sub3(p, origin);
    return unit3(sub3(d, axis.map((c) => c * dot3(d, axis)))) ?? [0, 0, 0];
  };
  switch (s.kind) {
    case "plane": return s.axis;
    case "cylinder": return radial(s.origin, s.axis);
    case "cone": {
      // σ = o + (r + v·tan α)(cos u·x + sin u·y) + v·z, so σu × σv points out
      // from the axis and back down it: radial − tan α · z.
      const r = radial(s.origin, s.axis);
      return unit3(r.map((c, i) => c - Math.tan(s.semiAngle) * s.axis[i]))!;
    }
    case "sphere": return unit3(sub3(p, s.origin))!;
    case "torus": {
      const r = radial(s.origin, s.axis);
      return unit3(sub3(p, s.origin.map((c, i) => c + s.major * r[i])))!;
    }
    case "bspline": throw new Error("a kernel surface's normal is the kernel's own; ask it of the face's sense");
    case "extrusion": {
      // σ(t, v) = C(t) + v·axis, so σt × σv = C′(t) × axis, at the parameter
      // of the curve's point under p — a B-spline's nearest point to p moved
      // back along the axis onto the curve's plane; an ellipse's eccentric
      // anomaly in its own axes.
      if (s.curve.kind === "bspline") {
        const spline = bsplineOf(s.curve.nurbs);
        const base = pathPoint(spline, domain(spline)[0]);
        const back = p.map((c, i) => c - dot3(sub3(p, base), s.axis) * s.axis[i]);
        const u = nearestParam(spline, back);
        const d = derivs(spline, u, 1)[1];
        const dc = s.curve.sense ? d : d.map((c) => -c);
        return unit3(cross3(dc, s.axis)) ?? [0, 0, 0];
      }
      const c = s.curve;
      const across = cross3(c.normal, c.ref);
      const d = sub3(p, c.center);
      const t = Math.atan2(dot3(d, across) / c.b, dot3(d, c.ref) / c.a);
      const dc = [0, 1, 2].map((i) => -c.a * Math.sin(t) * c.ref[i] + c.b * Math.cos(t) * across[i]);
      return unit3(cross3(dc, s.axis)) ?? [0, 0, 0];
    }
    case "revolution": {
      if (!swept) throw new Error("a surface of revolution's normal is asked at a turned point of its curve");
      // σu: the way the turn carries p. σv: the curve's own direction at q,
      // counter-clockwise about its normal, carried round with it — a
      // B-spline's own derivative there (a spline, docs/plans/spline.md).
      const turn = turned(s.origin, s.axis, swept.angle);
      const du = cross3(s.axis, sub3(p, s.origin));
      const c = s.curve;
      const along = c.kind === "bspline"
        ? (() => { const sp = bsplineOf(c.nurbs); const d = derivs(sp, nearestParam(sp, swept.q), 1)[1]; return c.sense ? d : d.map((x) => -x); })()
        : cross3(c.normal, sub3(swept.q, c.center));
      const dv = turn.vector(along);
      return unit3(cross3(du, dv)) ?? [0, 0, 0];
    }
  }
}

/** A face from its surface, its loops and the way out of the material at a point inside it. */
function face(surface: Surface, bounds: Bound[], at: number[], out: number[], swept?: { q: number[]; angle: number }): Face {
  return { surface, sameSense: dot3(surfaceNormal(surface, at, swept), out) > 0, bounds };
}

/** A unit direction square to `n`, preferring `hint`'s direction — an axis placement's reference. */
function square(n: number[], hint?: number[]): number[] {
  return planeAxes(n, hint).u;
}

/** How far apart two things may be and still be one, for a model this size: a part in a billion. */
function tolerance(points: number[][]): number {
  const size = Math.max(1, ...points.flat().map(Math.abs));
  return 1e-9 * size;
}

/** Joints are vertices, keyed by where they are in which loop. */
const jointKey = (i: number, j: number) => `${i}:${j}`;

/** The vertices at each end of a walked piece k, in the piece's own direction: [start, end] joint indices. */
function ownEnds(w: Walk, k: number): [number, number] {
  const n = w.pieces.length;
  const [before, after] = [(k + n - 1) % n, k];
  return w.forward[k] ? [before, after] : [after, before];
}

function profileWalks(model: Model, f: FeatureEntry): Walk[] {
  const loops = f.loops.map((loop) => loop.flatMap((m) => piecesOf(model, m)));
  if (loops.length === 0 || loops.some((l) => l.length === 0)) throw new Error("its profile is empty");
  const tol = Math.max(1e-6, tolerance(loops.flat().flatMap((p) => [p.a, p.b])) * 1e3);
  return loops.map((pieces, i) => walk(pieces, tol, i === 0 ? "its outline" : `its loop ${i + 1}`));
}

// ---- extrude ------------------------------------------------------------------------

function extrudeBodies(model: Model, f: Extract<FeatureEntry, { kind: "extrude" }>): Body[] {
  const plane = featurePlane(model, f);
  if (!plane) throw new Error("its sketch plane has collapsed");
  const depth = model.relations.get(f.depth)?.args[1];
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth === 0) throw new Error("it has no depth");
  // The lid is the profile moved by the depth along the plane's normal — the
  // definition the extrusion dimension holds the twins to, so the lid is
  // exactly parallel and every wall exactly ruled, however nearly the solve
  // has got the twins there.
  const D = plane.n.map((c) => c * depth);
  const e = unit3(D)!;
  const { walks, regions, areas } = orientAndGroup(profileWalks(model, f), e);
  const lid = shifted(D);
  const name = (r: number) => (r === 0 ? f.name : `${f.name}.${r + 1}`);

  return regions.map((region, r) => {
    const t = new Topology();
    const loops = [region.outline, ...region.holes];
    const vb = (i: number, j: number) => t.vertex(`b${jointKey(i, j)}`, () => walks[i].joints[j]);
    const vt = (i: number, j: number) => t.vertex(`t${jointKey(i, j)}`, () => lid.point(walks[i].joints[j]));
    const edgeOf = (i: number, k: number, top: boolean) => t.edge(`${top ? "T" : "B"}${jointKey(i, k)}`, () => {
      const [s, en] = ownEnds(walks[i], k);
      const v = top ? vt : vb;
      return { start: v(i, s), end: v(i, en), curve: curveOf(walks[i].pieces[k], top ? lid : still) };
    });
    const wallLine = (i: number, j: number) => t.edge(`V${jointKey(i, j)}`, () => ({ start: vb(i, j), end: vt(i, j), curve: { kind: "line" } }));

    const faces: Face[] = [];
    const cap = (top: boolean): Bound[] => loops.map((i, n) => {
      const w = walks[i];
      const uses = w.pieces.map((_, k) => ({ edge: edgeOf(i, k, top), forward: top ? w.forward[k] : !w.forward[k] }));
      return { outer: n === 0, uses: top ? uses : uses.reverse() };
    });
    const o = walks[region.outline].joints[0];
    faces.push(face({ kind: "plane", origin: o, axis: e.map((c) => -c), ref: square(e) }, cap(false), o, e.map((c) => -c)));
    faces.push(face({ kind: "plane", origin: lid.point(o), axis: e, ref: square(e) }, cap(true), lid.point(o), e));

    for (const i of loops) {
      const w = walks[i];
      const n = w.pieces.length;
      w.pieces.forEach((p, k) => {
        const prev = (k + n - 1) % n;
        const uses: Use[] = [
          { edge: edgeOf(i, k, false), forward: w.forward[k] },
          { edge: wallLine(i, k), forward: true },
          { edge: edgeOf(i, k, true), forward: !w.forward[k] },
          { edge: wallLine(i, prev), forward: false },
        ];
        const tangent = pieceTangent(p, 0.5).map((c) => (w.forward[k] ? c : -c));
        const out = unit3(cross3(tangent, e))!;
        const mid = pieceAt(p, 0.5).map((c, x) => c + D[x] / 2);
        // An ellipse's wall is its curve swept along the depth, exactly
        // (docs/plans/sketch-shapes.md); a circle's a cylinder.
        // A B-spline's wall is its curve swept along the depth, exactly, as an ellipse's is.
        const surface: Surface = p.kind === "line"
          ? { kind: "plane", origin: p.a, axis: out, ref: unit3(sub3(p.b, p.a))! }
          : p.kind === "path"
            ? { kind: "extrusion", curve: curveOf(p, still) as Extract<Curve, { kind: "bspline" }>, axis: e }
            : p.rv !== undefined
              ? { kind: "extrusion", curve: curveOf(p, still) as Extract<Curve, { kind: "ellipse" }>, axis: e }
              : { kind: "cylinder", origin: p.c, axis: e, ref: p.u, r: p.r };
        faces.push(face(surface, [{ outer: true, uses }], mid, out));
      });
    }
    const area = loops.reduce((s, i) => s + areas[i], 0);
    return {
      name: name(r), feature: f.name, outer: { faces }, voids: [], volume: area * Math.abs(depth),
      box: extent(loops.flatMap((i) => walks[i].pieces), (p, dir) => Math.max(dot3(p, dir), dot3(lid.point(p), dir))),
    };
  });
}

// ---- revolve ------------------------------------------------------------------------

function revolveBodies(model: Model, f: Extract<FeatureEntry, { kind: "revolve" }>): Body[] {
  const plane = featurePlane(model, f);
  if (!plane) throw new Error("its sketch plane has collapsed");
  const theta = model.relations.get(f.angle)?.args[1];
  if (typeof theta !== "number" || !Number.isFinite(theta) || theta === 0) throw new Error("it has no angle");
  const axis = axisReader(model, f.axis).read();
  if (axis.dir.every((c) => c === 0)) throw new Error("its axis has no direction");
  // Turn the positive way about k' rather than a negative angle about k: one
  // case, not two.
  const k = axis.dir.map((c) => Math.sign(theta) * c);
  const O = lift3(axis.origin);
  const full = isFullTurn(theta);
  const sweep = Math.abs(theta);

  const raw = profileWalks(model, f);
  const tol = tolerance(raw.flatMap((w) => w.joints));
  const foot = (p: number[]) => { const d = sub3(p, O); return O.map((c, i) => c + dot3(d, k) * k[i]); };
  const reach = (p: number[]) => Math.hypot(...sub3(p, foot(p)));
  // On the axis to a part in a billion — or to 1e-8 mm whatever the size: a
  // vertex nearer than that would sweep a circle smaller than any reader's
  // tolerance (a STEP file declares 1e-7), an edge no reader would keep.
  const onAxis = (p: number[]) => reach(p) <= Math.max(tol, 1e-8);
  // Which side of the axis the profile is on, and so which way it sweeps.
  const all = raw.flatMap((w) => w.pieces.map((p) => pieceAt(p, 0.5)));
  const far = all.reduce((a, b) => (reach(b) > reach(a) ? b : a));
  const rhat = unit3(sub3(far, foot(far)));
  if (!rhat) throw new Error("its profile lies on its axis");
  const e0 = unit3(cross3(k, rhat))!;
  const { walks, regions } = orientAndGroup(raw, e0);

  // The angles the edges stand at: start and end for a partial turn; for a
  // whole one, 0 and a half turn, the next half turn coming back round to 0.
  const angles = full ? [0, Math.PI] : [0, sweep];
  const spans = full ? [[0, 1], [1, 0]] : [[0, 1]];
  const at = (a: number) => turned(O, k, angles[a]);
  /** Angle index `a` as a span's start or end: a whole turn's last span ends back at 0, which is 2π. */
  const angleOf = (a: number, end: boolean) => (end && full && a === 0 ? TAU : angles[a]);
  const name = (r: number) => (r === 0 ? f.name : `${f.name}.${r + 1}`);
  // Pappus: the volume is the angle times the first moment of the area about the axis.
  const v = cross3(e0, rhat);
  const moments = walks.map((w) => loopIntegral(w, (q) => { const x = dot3(sub3(q, O), rhat); return (x * x) / 2; }, v));

  return regions.map((region, r) => {
    const t = new Topology();
    const loops = [region.outline, ...region.holes];
    const vtx = (i: number, j: number, a: number) => {
      const p = walks[i].joints[j];
      return onAxis(p) ? t.vertex(`x${jointKey(i, j)}`, () => p) : t.vertex(`${jointKey(i, j)}@${a}`, () => at(a).point(p));
    };
    const pieceOnAxis = (p: Piece) => p.kind === "line" && onAxis(p.a) && onAxis(p.b);
    const profileEdge = (i: number, k: number, a: number) => {
      const p = walks[i].pieces[k];
      const key = pieceOnAxis(p) ? `P${jointKey(i, k)}@x` : `P${jointKey(i, k)}@${a}`;
      return t.edge(key, () => {
        const [s, en] = ownEnds(walks[i], k);
        return { start: vtx(i, s, a), end: vtx(i, en, a), curve: curveOf(p, at(a)) };
      });
    };
    /** The circle joint j sweeps through span s, or null when it is on the axis and sweeps nothing. */
    const sweepEdge = (i: number, j: number, s: number): Edge | null => {
      const p = walks[i].joints[j];
      if (onAxis(p)) return null;
      const [a0, a1] = spans[s];
      return t.edge(`S${jointKey(i, j)}#${s}`, () => {
        const start = vtx(i, j, a0);
        const c = foot(p);
        return {
          start, end: vtx(i, j, a1),
          curve: { kind: "circle", center: c, normal: k, ref: unit3(sub3(start.at, c))!, r: reach(p) },
        };
      });
    };

    const shells = loops.map(() => [] as Face[]);
    loops.forEach((i, n) => {
      const w = walks[i];
      const count = w.pieces.length;
      w.pieces.forEach((p, k2) => {
        if (pieceOnAxis(p)) return; // on the axis it sweeps nothing and bounds no face
        const prev = (k2 + count - 1) % count;
        spans.forEach(([a0, a1], s) => {
          const uses: Use[] = [{ edge: profileEdge(i, k2, a0), forward: w.forward[k2] }];
          const ahead = sweepEdge(i, k2, s);
          if (ahead) uses.push({ edge: ahead, forward: true });
          uses.push({ edge: profileEdge(i, k2, a1), forward: !w.forward[k2] });
          const behind = sweepEdge(i, prev, s);
          if (behind) uses.push({ edge: behind, forward: false });
          const mid = (angleOf(a0, false) + angleOf(a1, true)) / 2;
          const middle = turned(O, k, mid);
          const tangent = pieceTangent(p, 0.5).map((c) => (w.forward[k2] ? c : -c));
          const out = middle.vector(unit3(cross3(tangent, e0))!);
          const q = pieceAt(p, 0.5);
          shells[full ? n : 0].push(face(sweptSurface(p, O, k, rhat, tol), [{ outer: true, uses }], middle.point(q), out, { q, angle: mid }));
        });
      });
    });
    if (!full) {
      // The caps: the profile, facing back against the sweep, and its turn
      // through the angle, facing on.
      const cap = (a: number): Bound[] => loops.map((i, n) => {
        const w = walks[i];
        const uses = w.pieces.map((_, k2) => ({ edge: profileEdge(i, k2, a), forward: a === 0 ? !w.forward[k2] : w.forward[k2] }));
        return { outer: n === 0, uses: a === 0 ? uses.reverse() : uses };
      });
      const o = walks[region.outline].joints[0];
      const end = at(1);
      const back = e0.map((c) => -c), on = end.vector(e0);
      shells[0].push(face({ kind: "plane", origin: o, axis: back, ref: square(back, rhat) }, cap(0), o, back));
      shells[0].push(face({ kind: "plane", origin: end.point(o), axis: on, ref: square(on, end.vector(rhat)) }, cap(1), end.point(o), on));
    }
    const moment = loops.reduce((s, i) => s + moments[i], 0);
    const swing = (p: number[], dir: number[]) => sweptMax(p, dir, O, k, sweep);
    return {
      name: name(r), feature: f.name,
      outer: { faces: shells[0] },
      voids: full ? shells.slice(1).map((faces) => ({ faces })) : [],
      volume: sweep * moment,
      box: extent(loops.flatMap((i) => walks[i].pieces), swing),
    };
  });
}

/**
 * The surface a profile piece sweeps about the axis: a line along the axis a
 * cylinder, square to it a plane, slanted a cone; an arc centred on the axis a
 * sphere, one whose circle stays clear of the axis a torus, and any other —
 * whose circle reaches the axis or past it — the general surface of
 * revolution, which is exact for it where a torus would turn itself inside out.
 */
function sweptSurface(p: Piece, O: number[], k: number[], rhat: number[], tol: number): Surface {
  const foot = (q: number[]) => { const d = sub3(q, O); return O.map((c, i) => c + dot3(d, k) * k[i]); };
  const reach = (q: number[]) => Math.hypot(...sub3(q, foot(q)));
  const height = (q: number[]) => dot3(sub3(q, O), k);
  if (p.kind === "line") {
    const [ra, rb] = [reach(p.a), reach(p.b)];
    const [ha, hb] = [height(p.a), height(p.b)];
    if (Math.abs(ra - rb) <= tol) return { kind: "cylinder", origin: foot(p.a), axis: k, ref: rhat, r: (ra + rb) / 2 };
    if (Math.abs(ha - hb) <= tol) {
      // Square to the axis: a plane, its normal whichever way along the axis;
      // `face` settles which way is out.
      return { kind: "plane", origin: p.a, axis: k, ref: rhat };
    }
    // A cone: placed at the wider end, widening along whichever way of the
    // axis the piece widens toward.
    const [wide, narrow] = ra > rb ? [p.a, p.b] : [p.b, p.a];
    const up = Math.sign(height(wide) - height(narrow));
    const axis = k.map((c) => up * c);
    return {
      kind: "cone", origin: foot(wide), axis, ref: rhat, r: Math.max(ra, rb),
      semiAngle: Math.atan2(Math.abs(ra - rb), Math.abs(ha - hb)),
    };
  }
  // A B-spline turned: the general surface of revolution of its own curve, exact.
  if (p.kind === "path") return { kind: "revolution", origin: O, axis: k, curve: curveOf(p, still) as Extract<Curve, { kind: "bspline" }> };
  const R = reach(p.c);
  if (R <= tol) return { kind: "sphere", origin: foot(p.c), axis: k, ref: rhat, r: p.r };
  if (p.r < R - tol) return { kind: "torus", origin: foot(p.c), axis: k, ref: rhat, major: R, minor: p.r };
  return { kind: "revolution", origin: O, axis: k, curve: curveOf(p, still) as Extract<Curve, { kind: "circle" }> };
}

// ---- extent ---------------------------------------------------------------------------

/**
 * The farthest `p` turned through [0, sweep] about the axis reaches along
 * `dir`: the circle it turns on is `foot + ρ(cos φ·r̂ + sin φ·(k × r̂))`, whose
 * reach along `dir` is greatest at an end of the sweep or where its derivative
 * vanishes, if that is inside it.
 */
function sweptMax(p: number[], dir: number[], O: number[], k: number[], sweep: number): number {
  const d = sub3(p, O);
  const h = dot3(d, k);
  const radial = sub3(d, k.map((c) => c * h));
  const rho = Math.hypot(...radial);
  const base = dot3(O, dir) + h * dot3(k, dir);
  if (rho === 0) return base;
  const rh = radial.map((c) => c / rho);
  const [A, B] = [dot3(rh, dir), dot3(cross3(k, rh), dir)];
  let best = Math.max(A, A * Math.cos(sweep) + B * Math.sin(sweep));
  let phi = Math.atan2(B, A);
  if (phi < 0) phi += TAU;
  if (phi <= sweep) best = Math.max(best, Math.hypot(A, B));
  return base + rho * best;
}

/**
 * A solid's extent: along each axis, both ways, the most `reach` gives over
 * every boundary piece. Sampled finely along each piece and then refined by
 * golden section about the best sample, so a curve's extreme is found to
 * rounding, not to the sample spacing.
 */
function extent(pieces: Piece[], reach: (p: number[], dir: number[]) => number): [number[], number[]] {
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [1, -1]) {
      const dir = [0, 0, 0];
      dir[axis] = sign;
      let most = -Infinity;
      for (const p of pieces) {
        const n = p.kind === "line" ? 64 : 512;
        const g = (s: number) => reach(pieceAt(p, s), dir);
        let bestS = 0, bestV = -Infinity;
        for (let i = 0; i <= n; i++) {
          const v = g(i / n);
          if (v > bestV) [bestS, bestV] = [i / n, v];
        }
        let [a, b] = [Math.max(0, bestS - 1 / n), Math.min(1, bestS + 1 / n)];
        const phi = (Math.sqrt(5) - 1) / 2;
        for (let it = 0; it < 80; it++) {
          const [c, d] = [b - phi * (b - a), a + phi * (b - a)];
          if (g(c) > g(d)) b = d; else a = c;
        }
        most = Math.max(most, bestV, g((a + b) / 2));
      }
      if (sign > 0) hi[axis] = most; else lo[axis] = 0 - most; // 0 − most, not −most: no −0 in a box
    }
  }
  return [lo, hi];
}

// ---- for the solid kernel ------------------------------------------------------------

/**
 * A feature's sweep as the solid kernel takes it (src/solids/): its profile as
 * plain curves in its own plane, where that plane is, and the depth or the axis
 * and angle — every number read from the live, solved geometry through the
 * same accessors the exact B-rep above reads (`featurePlane`, `curveFrame`,
 * `portionAngles`), so the kernel's solid and this file's are of one profile.
 *
 * **Member i of the kernel's profile is member i of the record's loops**,
 * flattened loop by loop: a whole circle is one `circle` (not this file's two
 * halves — the kernel needs no seam rule), an arc or a portion of a curve one
 * `arc`, a line or a portion of one a `line`. The kernel names a wall by that
 * index (naming.ts), so `e3.m2` is the face swept from the record's third
 * member, wherever the loops put it.
 *
 * The plane's local +z is the way an extrude grows for a positive depth (the
 * sketch plane's normal), so the kernel's lid is at z = depth exactly as the
 * extrusion dimension holds the twins. A revolve turns the positive way about
 * its axis taken with the angle's sign, as `revolveBodies` does.
 */
export function kernelSweep(model: Model, f: FeatureEntry): { at: KernelPlacement; profile: KernelProfile; sweep: Sweep } {
  const { at, profile, local } = kernelProfile(model, featurePlane(model, f), f.loops);
  if (f.kind === "extrude") {
    const depth = model.relations.get(f.depth)?.args[1];
    if (typeof depth !== "number" || !Number.isFinite(depth) || depth === 0) throw new Error("it has no depth");
    return { at, profile, sweep: { kind: "extrude", depth } };
  }
  const theta = model.relations.get(f.angle)?.args[1];
  if (typeof theta !== "number" || !Number.isFinite(theta) || theta === 0) throw new Error("it has no angle");
  return { at, profile, sweep: revolveSweep(model, f.axis, theta, local) };
}

/**
 * A revolve's sweep in its profile's plane — the axis as a point and a
 * direction in the plane's own coordinates, the angle in degrees — from the
 * axis reference and the signed angle in radians: what `kernelSweep` hands
 * the kernel for a revolve, and a revolved surface (surfaces.ts) for its sheet.
 */
export function revolveSweep(model: Model, axisRef: string, theta: number, local: (p: number[]) => [number, number]): Sweep {
  const axis = axisReader(model, axisRef).read();
  const k = unit3(axis.dir.map((c) => Math.sign(theta) * c));
  if (!k) throw new Error("its axis has no direction");
  const O = lift3(axis.origin);
  // The axis's direction in the plane: where O + k lands, from where O does.
  const [o, ok] = [local(O), local(O.map((c, i) => c + k[i]))];
  const dir: [number, number] = [ok[0] - o[0], ok[1] - o[1]];
  return {
    kind: "revolve", point: local(O), dir,
    degrees: isFullTurn(theta) ? 360 : (Math.abs(theta) * 180) / Math.PI,
  };
}

/**
 * Profile loops as the kernel takes them — members in a plane's own
 * coordinates, and where that plane is — for any plane and any loops of
 * curves, closed or (a surface's, docs/plans/surfaces.md) open. The plane's
 * origin is the first member's first point; `local` maps a world point into it.
 */
export function kernelProfile(model: Model, plane: { u: number[]; n: number[] } | null, loops: readonly (readonly ProfileMember[])[]):
  { at: KernelPlacement; profile: KernelProfile; local: (p: number[]) => [number, number]; n: number[] } {
  const n = plane ? unit3(plane.n) : null;
  const x = plane && n ? unit3(sub3(plane.u, n.map((c) => c * dot3(plane.u, n)))) : null;
  if (!n || !x) throw new Error("its sketch plane has collapsed");
  const y = cross3(n, x);
  const first = loops[0]?.[0];
  if (first === undefined) throw new Error("its profile is empty");
  const origin = piecesOf(model, first)[0].a;
  const local = (p: number[]): [number, number] => { const d = sub3(p, origin); return [dot3(d, x), dot3(d, y)]; };
  const angle = (w: number[]) => (Math.atan2(dot3(w, y), dot3(w, x)) * 180) / Math.PI;
  const member = (m: ProfileMember): Member => {
    const pieces = piecesOf(model, m);
    const p = pieces[0];
    if (p.kind === "line") return { kind: "line", from: local(p.a), to: local(p.b) };
    // A B-spline as the kernel's exact curve in the plane (kernel.ts's `nurbs`),
    // whole — a closed one's two halves joined again — run its own way: a
    // kernel profile's open members are joined end to end, so their ways matter.
    if (p.kind === "path") {
      const path = curvePath(model, model.entities.get(memberName(m))!)!;
      const n = nurbsOf(path.curve);
      return { kind: "nurbs", degree: n.degree, knots: n.knots, mults: n.mults, points: path.curve.ctrl.map((c): [number, number, number] => [...local(c), 1]) };
    }
    if (p.rv !== undefined) {
      const u2 = local(p.c.map((c, i) => c + p.u[i]));
      const c2 = local(p.c);
      const ux: [number, number] = [u2[0] - c2[0], u2[1] - c2[1]];
      // An elliptical arc: the exact rational NURBS of that piece, run its own
      // way — the kernel joins a profile's open members end to end — its minor
      // axis as it lands in the plane, which way up that is.
      if (pieces.length === 1 && p.t1 - p.t0 < TAU - 1e-9) {
        const v2 = local(p.c.map((c, i) => c + p.v[i]));
        return ellipticArcMember(c2, ux, [v2[0] - c2[0], v2[1] - c2[1]], p.r, p.rv, p.t0, p.t1);
      }
      // A whole ellipse: the kernel's own NURBS of it (kernel.ts's `nurbs`),
      // exact — counter-clockwise in the plane's own axes, whichever way the
      // ellipse itself runs, as a kernel circle has no direction to keep.
      return ellipseMember(c2, ux, p.r, p.rv);
    }
    const centre = local(p.c);
    const sweep = pieces.reduce((s, q) => s + (q.kind === "arc" ? q.t1 - q.t0 : 0), 0);
    if (sweep >= TAU - 1e-9) return { kind: "circle", centre, radius: p.r };
    // Counter-clockwise about the plane's +z: the arc's own way if its normal
    // agrees, else from its end back to its start.
    const ccw = dot3(cross3(p.u, p.v), n) > 0;
    const from = sub3(ccw ? onArc(p, p.t0) : onArc(p, p.t1), p.c);
    const start = angle(from);
    return { kind: "arc", centre, radius: p.r, start, end: start + (sweep * 180) / Math.PI };
  };
  const profile: KernelProfile = { loops: loops.map((loop) => loop.map(member)) };
  const at: KernelPlacement = { origin: [origin[0], origin[1], origin[2]], x: [x[0], x[1], x[2]], y: [y[0], y[1], y[2]] };
  return { at, profile, local, n };
}

/**
 * The exact surface a feature's face lies on, by the face's role in the
 * feature — what the solid kernel tags a face with (naming.ts): `base` and
 * `lid` an extrude's caps (a revolve's start and end), member k the face swept
 * from the record's k-th member, loop by loop. The same planes, cylinders,
 * cones, spheres and tori the exact bodies above are made of, so a face a
 * boolean left untouched exports exactly as it did before booleans existed,
 * and a face it cut keeps its analytic surface with the kernel's new edges on
 * it. Null where the feature says no analytic surface (a general surface of
 * revolution), and the kernel's own NURBS is written instead.
 */
export function roleSurface(model: Model, f: FeatureEntry, role: "base" | "lid" | number): Surface | null {
  const members = f.loops.flat();
  if (f.kind === "extrude") {
    const plane = featurePlane(model, f);
    const depth = model.relations.get(f.depth)?.args[1];
    if (!plane || typeof depth !== "number" || depth === 0) return null;
    const n = unit3(plane.n);
    if (!n) return null;
    const e = n.map((c) => Math.sign(depth) * c);
    const D = n.map((c) => c * depth);
    const first = members[0];
    if (first === undefined) return null;
    const o = piecesOf(model, first)[0].a;
    if (role === "base") return { kind: "plane", origin: o, axis: e.map((c) => -c), ref: square(e) };
    if (role === "lid") return { kind: "plane", origin: o.map((c, i) => c + D[i]), axis: e, ref: square(e) };
    const m = members[role];
    if (m === undefined) return null;
    const p = piecesOf(model, m)[0];
    // An ellipse's wall: no analytic surface the kernel names a face by, so the
    // kernel's own NURBS of it is written (B_SPLINE_SURFACE_WITH_KNOTS) — what
    // the plan asks for where a body has one. A spline's likewise.
    if ((p.kind === "arc" && p.rv !== undefined) || p.kind === "path") return null;
    if (p.kind === "line") {
      const along = unit3(sub3(p.b, p.a));
      const out = along ? unit3(cross3(along, e)) : null;
      return along && out ? { kind: "plane", origin: p.a, axis: out, ref: along } : null;
    }
    return { kind: "cylinder", origin: p.c, axis: e, ref: p.u, r: p.r };
  }
  const plane = featurePlane(model, f);
  const theta = model.relations.get(f.angle)?.args[1];
  if (!plane || typeof theta !== "number" || theta === 0) return null;
  const axis = axisReader(model, f.axis).read();
  const k = unit3(axis.dir.map((c) => Math.sign(theta) * c));
  if (!k) return null;
  const O = lift3(axis.origin);
  const raw = profileWalks(model, f);
  const tol = tolerance(raw.flatMap((w) => w.joints));
  const foot = (q: number[]) => { const d = sub3(q, O); return O.map((c, i) => c + dot3(d, k) * k[i]); };
  const all = raw.flatMap((w) => w.pieces.map((q) => pieceAt(q, 0.5)));
  const reach = (q: number[]) => Math.hypot(...sub3(q, foot(q)));
  const far = all.reduce((a, b) => (reach(b) > reach(a) ? b : a));
  const rhat = unit3(sub3(far, foot(far)));
  if (!rhat) return null;
  const e0 = unit3(cross3(k, rhat))!;
  if (role === "base" || role === "lid") {
    const first = members[0];
    if (first === undefined) return null;
    const o = piecesOf(model, first)[0].a;
    if (role === "base") return { kind: "plane", origin: o, axis: e0.map((c) => -c), ref: square(e0, rhat) };
    const end = turned(O, k, Math.abs(theta));
    return { kind: "plane", origin: end.point(o), axis: end.vector(e0), ref: square(end.vector(e0), end.vector(rhat)) };
  }
  const m = members[role];
  if (m === undefined) return null;
  const s = sweptSurface(piecesOf(model, m)[0], O, k, rhat, tol);
  return s.kind === "revolution" ? null : s;
}

/**
 * An ellipse about `c` with its `a` axis along the unit `ux` and its `b` axis a
 * quarter turn counter-clockwise on, as the kernel's exact NURBS: the standard
 * nine-point rational quadratic circle (weights 1 and √2/2 at the corners,
 * knots at the quarters, each doubled) with its control square stretched by
 * `a` and `b` — an affine image of an exact circle is an exact ellipse, and a
 * rational B-spline's affine image is its control points' image. Counter-
 * clockwise from the `a` end.
 */
/**
 * A part of an ellipse as the kernel's exact curve: `c + a cos t·ux + b sin t·vy`
 * for t from `t0` to `t1` in the plane's own coordinates (`ux`, `vy` its axes'
 * unit directions as they land there), as rational quadratic pieces of at most
 * a quarter turn — each the affine image of a circular arc's, its middle point
 * where the end tangents meet and weighted the cosine of its half-sweep.
 */
export function ellipticArcMember(c: [number, number], ux: [number, number], vy: [number, number], a: number, b: number,
                                  t0: number, t1: number): Member {
  const k = Math.max(1, Math.ceil((t1 - t0) / (Math.PI / 2) - 1e-9));
  const step = (t1 - t0) / k;
  const w = Math.cos(step / 2);
  const at = (t: number, s = 1): [number, number, number] => {
    const [x, y] = [(a * Math.cos(t)) / s, (b * Math.sin(t)) / s];
    return [c[0] + x * ux[0] + y * vy[0], c[1] + x * ux[1] + y * vy[1], s === 1 ? 1 : w];
  };
  const points: [number, number, number][] = [at(t0)];
  for (let i = 0; i < k; i++) {
    const s0 = t0 + i * step;
    points.push(at(s0 + step / 2, w), at(s0 + step));
  }
  const knots = Array.from({ length: k + 1 }, (_, i) => i / k);
  const mults = knots.map((_, i) => (i === 0 || i === k ? 3 : 2));
  return { kind: "nurbs", degree: 2, knots, mults, points };
}

export function ellipseMember(c: [number, number], ux: [number, number], a: number, b: number): Member {
  const uy: [number, number] = [-ux[1], ux[0]];
  const w = Math.SQRT1_2;
  const square: [number, number, number][] = [
    [1, 0, 1], [1, 1, w], [0, 1, 1], [-1, 1, w], [-1, 0, 1], [-1, -1, w], [0, -1, 1], [1, -1, w], [1, 0, 1],
  ];
  const points = square.map(([x, y, wt]): [number, number, number] =>
    [c[0] + a * x * ux[0] + b * y * uy[0], c[1] + a * x * ux[1] + b * y * uy[1], wt]);
  return { kind: "nurbs", degree: 2, knots: [0, 0.25, 0.5, 0.75, 1], mults: [3, 2, 2, 2, 3], points };
}

// ---- for the wireframe -------------------------------------------------------------

/**
 * The sketch curves no solid is made of — not construction, not hidden, and
 * named by no feature — as plain geometry: a line's two ends, an arc's circle
 * and ends, a circle. What `exportStep({ curves: true })` writes beside the
 * solids.
 */
export type LooseCurve =
  | { name: string; kind: "line"; a: number[]; b: number[] }
  /** A curve laid out by an exact B-spline (a spline): written as one, from its first point to its last. */
  | { name: string; kind: "bspline"; curve: Extract<Curve, { kind: "bspline" }>; a: number[]; b: number[] }
  | { name: string; kind: "ellipse"; curve: Extract<Curve, { kind: "ellipse" }> }
  /** An arc of a circle — or of an ellipse: an elliptical arc (docs/plans/trim-everything.md) — between its two ends. */
  | { name: string; kind: "arc"; curve: Extract<Curve, { kind: "circle" }> | Extract<Curve, { kind: "ellipse" }>; a: number[]; b: number[] }
  | { name: string; kind: "circle"; curve: Extract<Curve, { kind: "circle" }> };

export function looseCurves(model: Model): LooseCurve[] {
  const taken = new Set<string>();
  for (const f of model.features.values()) for (const n of f.names) taken.add(n);
  const out: LooseCurve[] = [];
  for (const e of model.entities.values()) {
    const path = curvePath(model, e);
    if (path) {
      if (model.isConstruction(e.name) || model.hidden.has(e.name) || taken.has(e.name)) continue;
      const [lo, hi] = domain(path.curve);
      out.push({
        name: e.name, kind: "bspline", curve: curveOf({ kind: "path", curve: path.curve, a: [], b: [] }, still) as Extract<Curve, { kind: "bspline" }>,
        a: pathPoint(path.curve, lo), b: pathPoint(path.curve, hi),
      });
      continue;
    }
    if (e.kind !== "line" && e.kind !== "arc" && e.kind !== "circle" && e.kind !== "ellipse" && e.kind !== "earc") continue;
    if (e.construction || model.hidden.has(e.name) || taken.has(e.name)) continue;
    if (e.kind === "earc") {
      const f = curveFrame(model, e);
      if (!f || !(f.r > 0) || !((f.rv ?? 0) > 0) || !(f.sweep > 0)) continue;
      out.push({
        name: e.name, kind: "arc", curve: { kind: "ellipse", center: f.center, normal: unit3(cross3(f.u, f.v))!, ref: f.u, a: f.r, b: f.rv! },
        a: lift3(model.coords(e.start)), b: lift3(model.coords(e.end)),
      });
      continue;
    }
    if (e.kind === "ellipse") {
      const f = curveFrame(model, e);
      if (!f || !(f.r > 0) || !((f.rv ?? 0) > 0)) continue;
      out.push({ name: e.name, kind: "ellipse", curve: { kind: "ellipse", center: f.center, normal: unit3(cross3(f.u, f.v))!, ref: f.u, a: f.r, b: f.rv! } });
      continue;
    }
    if (e.kind === "line") {
      out.push({ name: e.name, kind: "line", a: lift3(model.coords(e.refs[0])), b: lift3(model.coords(e.refs[1])) });
      continue;
    }
    const f = curveFrame(model, e);
    if (!f || !(f.r > 0)) continue;
    const curve = { kind: "circle" as const, center: f.center, normal: unit3(cross3(f.u, f.v))!, ref: f.u, r: f.r };
    if (e.kind === "circle") out.push({ name: e.name, kind: "circle", curve });
    else out.push({ name: e.name, kind: "arc", curve, a: lift3(model.coords(e.start)), b: lift3(model.coords(e.end)) });
  }
  return out;
}
