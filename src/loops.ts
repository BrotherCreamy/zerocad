// Closed loops: which regions a drawing has, and which one a click is inside.
//
// The fifth of the pure "question about the drawing" modules, beside
// `picking.ts`, `snapping.ts`, `glyphs.ts` and `boxselect.ts`: a function of
// the model (and, for `loopAt`, a view and a pixel), with no canvas, no pointer
// and no state. It answers two questions — **what regions does this drawing
// bound?** and **which one is under this click?** — the second asked by the
// extrude, revolve and sketch tools and the context menu. A click inside a
// region with nothing armed still picks nothing (box select and the menu depend
// on empty-canvas presses), and a loop is drawn only by a tool previewing it: it
// is a *question*, not an entity. Finding loops journals nothing, claims no
// names and moves nothing.
//
// **Joined means held, never near.** This is the module's honesty line. Two
// curve ends are joined when they are the *same point entity*, or two point
// entities a `coin` (coincident) relation holds together — directly, or through
// a chain of them. Proximity alone joins nothing: two endpoints that merely sit
// on the same spot are not joined, because nothing holds them there, and the
// next drag is free to pull them apart. A drawing made with the tools joins by
// coincidence inference (a click on a vertex makes a new point and a `coin`),
// so reading the relation registry is not optional — ignoring `coin` would make
// most real sketches undetectable.
//
// **A T is held, so it splits.** An end held *on* an edge is not proximity
// either: a relation keeps it there and the next drag cannot pull it off. So
// the edge is **cut at that point**, into the pieces either side, and the
// point's whole joined class is the vertex there — chains through `coin` count
// exactly as they do for a join. Three relations hold a point on a curve:
// `on` (`pointOnLine`) on a line, `oncircle` (`onCircle`) on an arc or circle,
// and the line form of `mid` (`midpoint(m, l)`), which holds it at the line's
// middle — what a midpoint snap infers. Each cuts only where the point lies
// *within* the edge: `on` holds a point on a line's infinite extension and
// `oncircle` on an arc's whole circle, and a point out there cuts nothing. The
// point-pair form of `mid` names two points, not an edge, and cuts nothing;
// nor does `tan`, which holds no point at all. An arc's own `arcends` are its
// ends, not cuts. Two held points of different classes on one spot of an edge
// cut it once, at the first: nothing holds them together, so the second's
// edges do not meet the first's there.
//
// **A crossing is geometry, not a join — and regions are a question asked of
// the geometry.** Nothing holds two edges where they pass through each other,
// so a crossing joins nothing: no class changes, and a profile that must keep
// it has to *materialise* it — a real point held `on` both edges, which is what
// `pt(on(_, "l1"), on(_, "l2"))` makes, and which an extrude or revolve over a
// crossing makes for itself before it twins anything (operations.ts), after
// which that crossing is a held point, a T, to every later question. Never
// this module: it journals nothing and makes nothing, and a crossing's key is
// a place along an edge that the next drag can renumber, so no feature may
// keep one. But the regions a drawing bounds are read off where its
// edges are now, as the region under a click is, and a crossing bounds regions
// just as Onshape says. So two coplanar edges that cross in both their
// interiors — line–line, line–arc, arc–arc and whole circles, each in closed
// form, nothing sampled — are cut there at a **virtual vertex**: a vertex that
// is no entity, named by the edges through it. A tangency is not a crossing,
// nor is an end resting on the other edge (that is a T if held, and nothing if
// not), nor two edges lying along each other. A crossing within tolerance of a
// held cut on either edge *is* that held point — a crossing already
// materialised is one vertex, not two — and crossings at one spot (three lines
// through a point) are one vertex.
//
// **A virtual vertex's key** is the names of the edges through it, in creation
// order, joined by `×`: `l1×l5`. When the same edges cross more than once (a
// line through a circle, two circles) the crossings are numbered along the
// first-named edge in its own direction: `c1×c2#1`, `c1×c2#2`. The model
// reserves only the dot (for `f1.x`), so `×` is a legal name character; a key
// that is already a name in the model gets a prime (′) until it is not. So a
// loop's vertex names a point entity exactly when the model has a point by
// that name, and is a crossing otherwise (`isVirtual`).
//
// **A member walks a portion of its entity.** `from` and `to` are the vertices
// it runs between and `span` the part of the entity walked, as fractions of it
// in its own direction — a line from its first point, an arc from its start, a
// circle from its frame's +x — with `span[0] < span[1]`, the second past 1 when
// a circle's portion runs across its seam. `span` is null when the member is
// the whole entity. **A member is as long as the loop lets it be**: consecutive
// pieces of one entity walked the same way are one member, so a cut that is no
// corner of the loop — a point held on an edge with nothing else there, a T
// whose stem leads nowhere, a crossing by a stray line on no cycle — is not
// listed, and a loop of whole entities reads exactly as it would if nothing had
// been cut.
//
// **A loop** is a cycle of those members in one plane, or a whole circle on its
// own. **One plane** means every line's ends, and every arc's centre and ends,
// lie in it — to `liesOn`'s tolerance, a millionth of the distance from the
// plane's origin — and every arc's *frame* agrees with it: the frame's +z
// parallel to the plane's normal (either way up), to within a sine of a
// millionth (`PARALLEL_SINE`, fillet's in-plane rule). An arc whose points
// happen to lie in a plane its frame does not is not in that plane: its frame
// says it is drawn in another, and its rim would be.
//
// **Minimal cycles**, found as the faces of the plane's drawing once it is cut:
// at every vertex the pieces are put in angular order (by tangent, then
// curvature, so an arc leaving tangent to another is ordered by which way it
// bends), and walking each face with the interior on the left traces every
// bounded face counter-clockwise and the unbounded one clockwise. Cut at every
// T and crossing, no two pieces cross, so the faces are the regions the drawing
// shows: a rectangle with a line across it is two loops, a bow-tie its two
// lobes, two crossing circles two crescents and a lens. A figure-eight is two
// loops, two rectangles sharing an edge are two (the edge in both, and the
// six-edge outline in neither), and an outline with an island is two. A face
// whose walk visits a vertex twice — an annulus whose island touches its
// outline at a point — is split there into the simple cycles it is made of.
// Pieces on no cycle (a stray line, a bridge between two loops, a stub poking
// past a crossing) are dropped first. A cycle enclosing no area (two lines
// between the same two points) is not a loop.
//
// **Holes are not classified here**; containment is reported. Every loop
// carries `parent` — the smallest coplanar loop that wholly contains it — and
// `children`, so a feature can say "a loop containing another is a face with a
// hole" without asking the geometry again.
//
// **A loop's plane** is a frame's when one lies in it (the default first, then
// the earliest): its origin and its +x, +y and +z. Failing that, the first arc
// or circle in it lends its frame's orientation, and failing that the plane's
// normal is the one whose largest component is positive and its +u runs along
// the first line. Members are listed **counter-clockwise about that normal**,
// from the earliest-made member (its earliest portion, if it has several), so
// `area` — the signed area of the members as listed, about `plane.normal` —
// comes out positive; a caller that walks a loop backwards negates it.
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
// **Construction geometry is not there at all.** A line, arc or circle flagged
// construction (`Model.setConstruction`; the owner: *"construction geometry
// should be a per entity flag"*) is no edge of any loop: it bounds no region,
// a point held on it cuts nothing, and where it crosses a real edge there is no
// crossing — a construction line across a rectangle leaves one region, a
// construction circle inside it no hole. It is an ordinary entity everywhere
// else (solved, picked, snapped to); only this question leaves it out.
//
// Loops live in a 2D or a 3D model; anything else has no planes to put them in.

import { ORIGIN, entityKind, isClosedEntity, spanOf, type Model } from "./model.ts";
import { arcSegments } from "./arcgeom.ts";
import { curveFrame, curvePath, curvePlaneOf, framePlaneAxes, hasCurvePath } from "./curveplane.ts";
import { areaSweep, derivs, domain, nearestParam, pointAt as pathPoint, sampleParams, type BSpline } from "./bspline.ts";
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

/** One line, arc or circle of a loop — or the part of one the loop runs along — as the loop walks it. */
export interface LoopMember {
  name: string;
  /**
   * Walked against its own direction: a line from its second point to its
   * first, an arc from its end to its start, a circle clockwise about its own
   * frame's +z.
   */
  reversed: boolean;
  /**
   * The vertices this member is walked from and to: a point entity's name, or
   * a crossing's key (`l1×l2` — see the top of the file and `isVirtual`).
   * Null for a whole circle.
   */
  from: string | null;
  to: string | null;
  /**
   * The part of the entity walked, as fractions of it in its own direction
   * (`span[0] < span[1]`; past 1 across a circle's seam), whichever way it is
   * walked — or null for the whole entity.
   */
  span: [number, number] | null;
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
 * this near an end is a touch at that end, a curve this near touching another
 * is tangent to it, two cuts this close are one, a point this near a boundary
 * is on it. `liesOn`'s millionth.
 */
const LENGTH_TOL = 1e-6;

/** Two tangents this close (radians) leave a vertex in one direction, and curvature orders them. */
const ANGLE_TIE = 1e-8;

/** A cycle enclosing less than this fraction of the drawing's size squared encloses nothing. */
const AREA_TOL = 1e-9;

/** What joins a crossing key's edge names. */
const CROSSING = "×";

/**
 * Whether a loop vertex is a crossing rather than a point entity — see the top
 * of the file for why the two can never be confused.
 */
export function isVirtual(model: Model, vertex: string): boolean {
  return model.entities.get(vertex)?.kind !== "point";
}

/** Whether a member is only part of its entity, or runs to or from a crossing. */
export function isPortion(model: Model, m: LoopMember): boolean {
  return m.span !== null || (m.from !== null && isVirtual(model, m.from)) || (m.to !== null && isVirtual(model, m.to));
}

/**
 * A member as `loops()` prints it: its name, and for a portion the vertices it
 * runs between **in the entity's own direction** — `l3[l3×l5→p4]`, whichever
 * way the loop walks it. Own direction because two vertices on a circle bound
 * two arcs of it, and only the direction says which: the crescents either side
 * of a lens both run along a circle between the same two crossings. So the
 * label names one part of one entity, and is also what a region is compared
 * by between two hovers (`regionKey`).
 */
export function memberLabel(m: LoopMember): string {
  if (m.span === null) return m.name;
  const [a, b] = m.reversed ? [m.to, m.from] : [m.from, m.to];
  return `${m.name}[${a}→${b}]`;
}

// --- the edges, and what joins them ------------------------------------------

/** A line or arc that can be part of a loop: its two ends, and which joined class each is in. */
interface Edge {
  name: string;
  /** `path`: a declared curve laid out by an exact B-spline (curveplane.ts's `curvePath`), open, with two ends. */
  kind: "line" | "arc" | "path";
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
 *
 * Exported for `extrude`, which gives each joined class one twin on the lid —
 * so the lid's corners are joined exactly where the profile's were, by the
 * same definition, and the top cap is itself a loop. It reads relations, never
 * positions, which is also what lets a replay ask it before anything is solved.
 */
export function joinClasses(model: Model): Map<string, number> {
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
    // Two points, or one relation among many (relations/among.ts): all one class.
    const [a, ...rest] = rel.args;
    if (!isPoint(a)) continue;
    for (const b of rest) {
      if (!isPoint(b)) continue;
      const [ra, rb] = [find(a), find(b)];
      if (ra !== rb) up.set(rb, ra);
    }
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
    // Construction geometry is left out here, at the one door every edge
    // comes in by, so it bounds nothing, cuts nothing and crosses nothing —
    // and every consumer of regions follows without being told.
    if (model.isConstruction(e.name)) continue;
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
    } else {
      // A declared closed curve (model.ts's `EntityKindSpec`) is a closed
      // member like a circle: a loop on its own, cut by what is held on it or
      // crosses it — when it bounds anything as it stands, and is laid out by a
      // frame or an exact B-spline (curveplane.ts) the pieces below can walk.
      // A declared open one with a B-spline is an edge between its two ends.
      const k = entityKind(e.kind);
      if (!k?.curve || !(k.bounds?.(model, e.name) ?? true)) continue;
      const laid = curveFrame(model, e) !== null || curvePath(model, e) !== null;
      if (isClosedEntity(e)) {
        if (laid) circles.push({ name: e.name, order });
      } else if (hasCurvePath(e.kind) && laid) {
        const ends = k.ends?.(e);
        if (!ends) continue;
        const at: [number, number] = [classOf.get(ends[0])!, classOf.get(ends[1])!];
        if (at[0] !== at[1]) edges.push({ name: e.name, kind: "path", order, ends: [ends[0], ends[1]], at });
      } else if (laid) {
        // A declared open curve laid out by a frame — an elliptical arc
        // (docs/plans/trim-everything.md) — is an edge between its two ends,
        // walked as an arc is, when it sweeps anything.
        const ends = k.ends?.(e);
        const f = curveFrame(model, e);
        if (!ends || !f || !(f.sweep > 1e-12)) continue;
        const at: [number, number] = [classOf.get(ends[0])!, classOf.get(ends[1])!];
        if (at[0] !== at[1]) edges.push({ name: e.name, kind: "arc", order, ends: [ends[0], ends[1]], at });
      }
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

/** Whether two unit directions agree, either way up, to `PARALLEL_SINE`. */
export function parallel(a: number[], b: number[]): boolean {
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
 * has at least one such corner — or that cross. Coplanar candidates are one plane.
 */
function candidatePlanes(model: Model, edges: Edge[], circles: CircleRef[]): Group[] {
  const groups: Group[] = [];
  const add = (origin: number[], n: number[]) => {
    for (const g of groups) if (parallel(g.normal, n) && liesOn(g.plane, origin)) return;
    groups.push({ normal: n, plane: planeThrough(origin, n) });
  };
  // A curve laid out by a B-spline offers the plane its control points span,
  // when they span one (a straight one does not, and takes the plane of what
  // it joins).
  const pathPlane = (name: string) => {
    const path = curvePath(model, model.entities.get(name)!);
    const n = path ? polygonNormal(path.curve.ctrl) : null;
    if (path && n) add(path.curve.ctrl[0], n);
  };
  for (const c of circles) {
    if (hasCurvePath(model.entities.get(c.name)!.kind)) { pathPlane(c.name); continue; }
    add(lift3(model.coords(model.oriented(c.name).center)), curvePlaneOf(model, c.name).n);
  }
  for (const e of edges) {
    if (e.kind === "arc") add(lift3(model.coords(model.oriented(e.name).center)), curvePlaneOf(model, e.name).n);
    if (e.kind === "path") pathPlane(e.name);
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
  // And the plane of every pair of lines that cross: three lines crossing one
  // another bound a triangle with no joined corner at all.
  // Asked on every hover move, so the pairs are swept along x and boxed, and a
  // plane is built only for a pair that does cross. Measured on a hundred
  // separate coplanar rectangles: all pairs, a plane each, took 81 ms a call;
  // swept, 3.6 ms, against 2.8 ms before crossings were looked for at all.
  const segs = edges.filter((e) => e.kind === "line").map((e) => {
    const [a, b] = e.ends.map((p) => lift3(model.coords(p)));
    return { a, b, lo: a.map((x, i) => Math.min(x, b[i])), hi: a.map((x, i) => Math.max(x, b[i])) };
  });
  segs.sort((p, q) => p.lo[0] - q.lo[0]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length && segs[j].lo[0] <= segs[i].hi[0]; j++) {
      const [p, q] = [segs[i], segs[j]];
      if (p.lo[1] > q.hi[1] || q.lo[1] > p.hi[1] || p.lo[2] > q.hi[2] || q.lo[2] > p.hi[2]) continue;
      const u = sub3(p.b, p.a), w = sub3(q.b, q.a);
      const n = cross3(u, w);
      const len = Math.hypot(...n);
      if (!(len > PARALLEL_SINE * Math.hypot(...u) * Math.hypot(...w))) continue;
      // a + s·u = c + t·w, solved by crossing both sides with w, then with u.
      const ac = sub3(q.a, p.a);
      const s = dot3(cross3(ac, w), n) / (len * len), t = dot3(cross3(ac, u), n) / (len * len);
      if (!(s > 0 && s < 1 && t > 0 && t < 1)) continue;
      const unit = n.map((x) => x / len);
      const plane = planeThrough(p.a, unit);
      if (liesOn(plane, q.a) && liesOn(plane, q.b)) add(p.a, unit);
    }
  }
  return groups;
}

/**
 * The unit normal of the plane a polygon's points span — Newell's sum about
 * the first, so a nearly straight run of points still gives the plane its
 * bend does — or null for points on a line.
 */
function polygonNormal(pts: number[][]): number[] | null {
  let n = [0, 0, 0];
  for (let i = 1; i + 1 < pts.length; i++) n = n.map((c, k) => c + cross3(sub3(pts[i], pts[0]), sub3(pts[i + 1], pts[0]))[k]);
  const len = Math.hypot(...n);
  const size = Math.max(...pts.map((p) => Math.hypot(...sub3(p, pts[0]))));
  return len > PARALLEL_SINE * size * size ? n.map((c) => c / len) : null;
}

/** Whether a line, arc or circle lies in a candidate plane. See the top of the file. */
function inPlane(model: Model, g: Group, name: string): boolean {
  const e = model.entities.get(name)!;
  const on = (p: string) => liesOn(g.plane, lift3(model.coords(p)));
  // A curve laid out by a B-spline: every point it runs through and every
  // control point it is solved for (the curve is in their hull).
  if (hasCurvePath(e.kind)) {
    const path = curvePath(model, e);
    return !!path && model.refsOf(e).every(on) && path.curve.ctrl.every((c) => liesOn(g.plane, c));
  }
  if (e.kind === "line") return on(e.refs[0]) && on(e.refs[1]);
  if (e.kind === "arc") return parallel(curvePlaneOf(model, name).n, g.normal) && on(e.center) && on(e.start) && on(e.end);
  if (e.kind === "circle") return parallel(curvePlaneOf(model, name).n, g.normal) && on(e.center);
  // A declared kind that carries a plane: its plane, and every point it is built of.
  if (entityKind(e.kind)?.plane) return parallel(curvePlaneOf(model, name).n, g.normal) && model.refsOf(e).every(on);
  return false;
}

/**
 * The frames to try as a plane's own, the default first and then in creation
 * order — and in 3D the origin last, so a loop drawn on the origin's plane
 * reports it (`in origin`) when no frame of the user's is there first. Not in
 * 2D, where every frame's plane is the drawing and a loop names a frame only
 * when the user made one, as it always did.
 */
function framesByPreference(model: Model): string[] {
  const all = model.frameNames().filter((f) => f !== ORIGIN);
  const d = model.defaultFrame;
  const mine = d != null && all.includes(d) ? [d, ...all.filter((f) => f !== d)] : all;
  return model.dim === 3 ? [...mine, ORIGIN] : mine;
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
    const origin = lift3(frameBasis(model, f)().origin);
    if (liesOn(g.plane, origin)) return { origin, u: axes.u, v: axes.v, normal: axes.n, frame: f };
  }
  if (curves.length) {
    const { u, v, n } = curvePlaneOf(model, curves[0]);
    return { origin: lift3(model.coords(model.oriented(curves[0]).center)), u, v, normal: n, frame: null };
  }
  if (!lines.length) {
    // Curves laid out by B-splines alone, and no frame: the plane's normal the
    // way its largest component is positive, as for lines, from the plane's
    // own point, its first direction the one `spanOf` gives.
    const big = g.normal.reduce((k, x, i) => (Math.abs(x) > Math.abs(g.normal[k]) + 1e-12 ? i : k), 0);
    const normal = g.normal[big] < 0 ? g.normal.map((x) => -x) : g.normal.slice();
    const [u, v] = spanOf(normal);
    return { origin: g.plane.origin, u, v, normal, frame: null };
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
 *
 * **A conic is an arc with a second radius**: a declared kind whose frame
 * (curveplane.ts) has one (`ArcFrame.rv`) is laid out as `b` its semi-axis
 * across `r`'s, and `dir` the unit direction of its `r` axis in the plane, so
 * a point is `c + R(dir)·(r cos s, b sin s)` — `s` the eccentric anomaly,
 * counter-clockwise in the plane. Absent for a circle or an arc, and every
 * function below reads `rb`/`dirOf` so the two are one case.
 */
type Piece =
  | { kind: "line"; p: P2; q: P2 }
  | { kind: "arc"; p: P2; q: P2; c: P2; r: number; t0: number; sweep: number; b?: number; dir?: P2 }
  /**
   * A curve laid out by an exact B-spline (curveplane.ts's `curvePath`), flat
   * in the plane: walked from its parameter `t0` to `t1` (either way round,
   * `t1 < t0` walking it backwards), a closed one's parameter wrapping
   * round its `period` — every question below answered on the curve itself:
   * its area exactly (Green's theorem by Gauss–Legendre, ../bspline.ts), its
   * crossings and nearest points by a fine walk refined by Newton.
   */
  | { kind: "path"; p: P2; q: P2; curve: BSpline; t0: number; t1: number; closed: boolean };

type ArcPiece = Extract<Piece, { kind: "arc" }>;
type PathPiece = Extract<Piece, { kind: "path" }>;

/** The semi-axis across `r`: `b` for a conic, `r` for a circle. */
const rb = (piece: ArcPiece): number => piece.b ?? piece.r;
/** The unit direction of the `r` axis: +u for a circle. */
const dirOf = (piece: ArcPiece): P2 => piece.dir ?? [1, 0];

/** The piece's curve at parameter `s` (an angle for a circle, the eccentric anomaly for a conic). */
function onCurve(piece: ArcPiece, s: number): P2 {
  if (piece.b === undefined) return onCircle(piece.c, piece.r, s);
  const [dx, dy] = dirOf(piece);
  const [x, y] = [piece.r * Math.cos(s), piece.b * Math.sin(s)];
  return [piece.c[0] + x * dx - y * dy, piece.c[1] + x * dy + y * dx];
}

/** `x` in the piece's own axes, each scaled to one: on the curve exactly when its length is 1. */
function normalised(piece: ArcPiece, x: P2): P2 {
  const [dx, dy] = dirOf(piece);
  const [ox, oy] = [x[0] - piece.c[0], x[1] - piece.c[1]];
  return [(ox * dx + oy * dy) / piece.r, (-ox * dy + oy * dx) / rb(piece)];
}

/** The parameter of the curve's point "toward" `x`: its angle about the centre, a conic's in its normalised axes. */
function paramOf(piece: ArcPiece, x: P2): number {
  if (piece.b === undefined) return Math.atan2(x[1] - piece.c[1], x[0] - piece.c[0]);
  const [nx, ny] = normalised(piece, x);
  return Math.atan2(ny, nx);
}

/** The same curve from `t0` through `sweep`. */
function arcLike(piece: ArcPiece, t0: number, sweep: number): Piece {
  const out: ArcPiece = { kind: "arc", p: [0, 0], q: [0, 0], c: piece.c, r: piece.r, t0, sweep };
  if (piece.b !== undefined) { out.b = piece.b; out.dir = piece.dir; }
  out.p = onCurve(out, t0);
  out.q = onCurve(out, t0 + sweep);
  return out;
}

const TAU = Math.PI * 2;
/** `n` steps along a piece, as fractions from 0 to 1. */
const arcSteps = (n: number): number[] => Array.from({ length: n + 1 }, (_, k) => k / n);
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
  if (piece.kind === "path") return { ...piece, p: piece.q, q: piece.p, t0: piece.t1, t1: piece.t0 };
  return arcLike(piece, piece.t0 + piece.sweep, -piece.sweep);
}

/** A whole circle: its two ends are one point, and that point is no end at all. */
const whole = (piece: Piece): boolean => (piece.kind === "arc" && Math.abs(piece.sweep) >= TAU - 1e-12)
  || (piece.kind === "path" && piece.closed && Math.abs(piece.t1 - piece.t0) >= period(piece) * (1 - 1e-12));

// --- a path's own geometry ------------------------------------------------------------

/** A path's parameter range, and how long it is. */
const span = (piece: PathPiece): [number, number] => domain(piece.curve);
const period = (piece: PathPiece): number => { const [lo, hi] = span(piece); return hi - lo; };

/** A parameter, wrapped into a closed path's range; an open one's as it is. */
function wrapped(piece: PathPiece, u: number): number {
  if (!piece.closed) return u;
  const [lo] = span(piece);
  return lo + mod(u - lo, period(piece));
}

/** The path's point at parameter `u`. */
function onPath(piece: PathPiece, u: number): P2 {
  const p = pathPoint(piece.curve, wrapped(piece, u));
  return [p[0], p[1]];
}

/** The path's first and second derivatives at parameter `u`. */
function pathDerivs(piece: PathPiece, u: number): [P2, P2] {
  const [, d1, d2] = derivs(piece.curve, wrapped(piece, u), 2);
  return [[d1[0], d1[1]], [d2[0], d2[1]]];
}

/** The parameter `t` of the piece's way along, as fractions of it. */
const pathParam = (piece: PathPiece, t: number): number => piece.t0 + t * (piece.t1 - piece.t0);

/** Parameters along the piece, as fractions, fine enough that a walk between them follows it. */
function pathSteps(piece: PathPiece): number[] {
  const spans = Math.max(1, piece.curve.ctrl.length - piece.curve.degree);
  const frac = Math.abs(piece.t1 - piece.t0) / period(piece);
  const n = Math.max(16, Math.ceil(64 * spans * Math.min(1, frac + 1e-9)));
  return Array.from({ length: n + 1 }, (_, k) => k / n);
}

/** The piece's own parameter ranges, in the curve's domain and in walking order: a closed path's run across its seam is two. */
function pathRanges(piece: PathPiece): [number, number][] {
  const [lo, hi] = span(piece);
  const T = hi - lo;
  if (!piece.closed) return [[piece.t0, piece.t1]];
  const fwd = piece.t1 >= piece.t0;
  const [a, b] = fwd ? [piece.t0, piece.t1] : [piece.t1, piece.t0];
  const out: [number, number][] = [];
  // Unwrap from the first turn the range starts in.
  let start = lo + mod(a - lo, T);
  let left = b - a;
  while (left > 1e-15 * T) {
    const take = Math.min(left, hi - start);
    out.push([start, start + take]);
    left -= take;
    start = lo;
  }
  return fwd ? out : out.reverse().map(([x, y]) => [y, x]);
}

/** Where on the piece, as a fraction of it, the curve's point nearest `x` is — or null when that is off the piece. */
function pathFraction(piece: PathPiece, x: P2, slack = 1e-9): number | null {
  const u = nearestParam(piece.curve, x, piece.closed);
  const d = piece.t1 - piece.t0;
  if (piece.closed) {
    const along = mod(Math.sign(d || 1) * (u - piece.t0), period(piece));
    if (whole(piece)) return along / period(piece);
    if (along <= Math.abs(d) * (1 + slack)) return Math.min(1, along / Math.abs(d));
    // Just short of its start, round the seam: its start.
    if (period(piece) - along <= Math.abs(d) * slack) return 0;
    return null;
  }
  const f = (u - piece.t0) / d;
  if (f < -slack || f > 1 + slack) return null;
  return Math.min(1, Math.max(0, f));
}

/** The piece's point nearest `x` within the piece, and how far: a walk along it, then Newton kept inside it. */
function nearestOnPath(piece: PathPiece, x: P2): { t: number; d: number } {
  let best = { t: 0, d: Infinity };
  for (const t of pathSteps(piece)) {
    const d = dist2(onPath(piece, pathParam(piece, t)), x);
    if (d < best.d) best = { t, d };
  }
  let t = best.t;
  const scale = piece.t1 - piece.t0;
  for (let k = 0; k < 20; k++) {
    const u = pathParam(piece, t);
    const c = onPath(piece, u);
    const [d1, d2] = pathDerivs(piece, u);
    const r = sub2(c, x);
    const g = (r[0] * d1[0] + r[1] * d1[1]) * scale;
    const h = (d1[0] * d1[0] + d1[1] * d1[1] + r[0] * d2[0] + r[1] * d2[1]) * scale * scale;
    if (!(h > 0)) break;
    const next = Math.min(1, Math.max(0, t - g / h));
    if (Math.abs(next - t) < 1e-15) { t = next; break; }
    t = next;
  }
  return { t, d: dist2(onPath(piece, pathParam(piece, t)), x) };
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
 * A line, arc or circle in its own direction, flat in `plane`. An arc or
 * circle is laid out by `curveFrame` — the very curve that is drawn — so its
 * sense in the plane is its frame normal's side of the plane's, and it starts
 * where it is drawn from: an arc at its start, a circle at its frame's +x. That
 * start is what a member's `span` is measured from, so the span means the same
 * here, in `faces.ts`'s outline and to anything else that reads it.
 */
function pieceOf(model: Model, name: string, plane: LoopPlane): Piece {
  const e = model.entities.get(name)!;
  if (e.kind === "line") return { kind: "line", p: toPlane(plane, model.coords(e.refs[0])), q: toPlane(plane, model.coords(e.refs[1])) };
  const path = curvePath(model, e);
  if (path) {
    // Its control points laid flat in the plane: the same curve, since a
    // B-spline's points are affine in its control points. In its own
    // direction, from the start of its parameter — what a span measures.
    const curve: BSpline = { ...path.curve, ctrl: path.curve.ctrl.map((c) => toPlane(plane, c)) };
    const [lo, hi] = domain(curve);
    const flat: PathPiece = { kind: "path", p: [0, 0], q: [0, 0], curve, t0: lo, t1: hi, closed: path.closed };
    flat.p = onPath(flat, lo);
    flat.q = path.closed ? flat.p : onPath(flat, hi);
    return flat;
  }
  const f = curveFrame(model, e)!;
  const c = toPlane(plane, f.center);
  const side = dot3(f.normal, plane.normal) < 0 ? -1 : 1;
  if (f.rv !== undefined) {
    // A conic (its frame has a second radius): from the end of its first axis,
    // its own way round: the plane's way when its normal
    // agrees, the other when not — so a span means the same fraction of the
    // curve here as it does in faces.ts's outline.
    const m = toPlane(plane, [0, 1, 2].map((i) => f.center[i] + f.u[i]));
    const len = Math.hypot(m[0] - c[0], m[1] - c[1]);
    const dir: P2 = [(m[0] - c[0]) / len, (m[1] - c[1]) / len];
    // An elliptical arc from its own start through its own sweep (`ArcFrame.t0`).
    return arcLike({ kind: "arc", p: c, q: c, c, r: f.r, t0: 0, sweep: 0, b: f.rv ?? f.r, dir },
      side * (f.t0 ?? 0), side * (isClosedEntity(e) ? TAU : f.sweep));
  }
  const s = toPlane(plane, [0, 1, 2].map((i) => f.center[i] + f.r * f.u[i]));
  return arcPiece(c, f.r, Math.atan2(s[1] - c[1], s[0] - c[0]), side * (e.kind === "circle" ? TAU : f.sweep));
}

/** The piece's point a fraction `t` of the way along it. */
function pointAt(piece: Piece, t: number): P2 {
  if (piece.kind === "line") return [piece.p[0] + t * (piece.q[0] - piece.p[0]), piece.p[1] + t * (piece.q[1] - piece.p[1])];
  if (piece.kind === "path") return onPath(piece, pathParam(piece, t));
  return onCurve(piece, piece.t0 + t * piece.sweep);
}

/**
 * The part of a piece from fraction `a` to fraction `b` of it, `a < b`, in its
 * own direction — `b` past 1 runs on round a whole circle. Its ends are the
 * piece's own ends exactly where they coincide, so an uncut end joins as it
 * always did.
 */
function slice(piece: Piece, a: number, b: number): Piece {
  if (piece.kind === "arc") return arcLike(piece, piece.t0 + a * piece.sweep, (b - a) * piece.sweep);
  if (piece.kind === "path") {
    return {
      ...piece, t0: pathParam(piece, a), t1: pathParam(piece, b),
      p: a === 0 ? piece.p : pointAt(piece, a), q: b === 1 ? piece.q : pointAt(piece, b),
    };
  }
  return { kind: "line", p: a === 0 ? piece.p : pointAt(piece, a), q: b === 1 ? piece.q : pointAt(piece, b) };
}

/**
 * How far along the piece the point of it nearest `x` is, as a fraction — a
 * line's foot of the perpendicular, an arc's angle about its centre. Null
 * when that is off the piece: past a line's ends, outside an arc's sweep. A
 * whole circle's answer is in [0, 1).
 */
function fractionAlong(piece: Piece, x: P2): number | null {
  if (piece.kind === "path") return pathFraction(piece, x);
  if (piece.kind === "line") {
    const d = sub2(piece.q, piece.p);
    const t = ((x[0] - piece.p[0]) * d[0] + (x[1] - piece.p[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
    return t >= 0 && t <= 1 ? t : null;
  }
  const t = paramOf(piece, x);
  const along = mod(piece.sweep >= 0 ? t - piece.t0 : piece.t0 - t, TAU);
  if (whole(piece)) return along / TAU;
  return along <= Math.abs(piece.sweep) ? along / Math.abs(piece.sweep) : null;
}

/**
 * ½∮(x dy − y dx) along the piece — Green's theorem, closed form for a line, an
 * arc and a conic's arc alike: about its centre a conic sweeps `r·b` per
 * unit of its parameter as a circle sweeps `r²`, and the centre's own share is
 * the chord's wedge with it.
 */
function pieceArea(piece: Piece): number {
  if (piece.kind === "line") return wedge2(piece.p, piece.q) / 2;
  if (piece.kind === "path") return pathRanges(piece).reduce((s, [a, b]) => s + areaSweep(piece.curve, a, b), 0);
  return (wedge2(piece.c, sub2(piece.q, piece.p)) + piece.r * rb(piece) * piece.sweep) / 2;
}

/** The piece's direction where it starts. */
function startTangent(piece: Piece): P2 {
  if (piece.kind === "line") return sub2(piece.q, piece.p);
  if (piece.kind === "path") {
    const [d] = pathDerivs(piece, piece.t0);
    const s = Math.sign(piece.t1 - piece.t0) || 1;
    return [s * d[0], s * d[1]];
  }
  const s = Math.sign(piece.sweep);
  if (piece.b === undefined) return [-s * Math.sin(piece.t0), s * Math.cos(piece.t0)];
  const [dx, dy] = dirOf(piece);
  const [x, y] = [-piece.r * Math.sin(piece.t0), piece.b * Math.cos(piece.t0)];
  return [s * (x * dx - y * dy), s * (x * dy + y * dx)];
}

/** Signed curvature where the piece starts: positive turns left (counter-clockwise), a line is zero. */
function curvature(piece: Piece): number {
  if (piece.kind === "line") return 0;
  if (piece.kind === "path") {
    // Walking it backwards turns the other way: the first derivative's sign flips, the second's does not.
    const [d1, d2] = pathDerivs(piece, piece.t0);
    const speed = Math.hypot(d1[0], d1[1]);
    return speed > 0 ? (Math.sign(piece.t1 - piece.t0) || 1) * wedge2(d1, d2) / (speed * speed * speed) : 0;
  }
  if (piece.b === undefined) return Math.sign(piece.sweep) / piece.r;
  const [a, b, t] = [piece.r, piece.b, piece.t0];
  return Math.sign(piece.sweep) * (a * b) / Math.pow(a * a * Math.sin(t) ** 2 + b * b * Math.cos(t) ** 2, 1.5);
}

/** Whether a point of the piece's circle is inside its sweep, clear of both ends — a whole circle has none. */
function withinArc(piece: Extract<Piece, { kind: "arc" }>, x: P2, tol: number): boolean {
  if (whole(piece)) return true;
  const t = paramOf(piece, x);
  const along = mod(piece.sweep >= 0 ? t - piece.t0 : piece.t0 - t, TAU);
  return along <= Math.abs(piece.sweep) && dist2(x, piece.p) > tol && dist2(x, piece.q) > tol;
}

/** Whether a point of a segment is strictly inside it, clear of both ends. */
function withinSegment(a: P2, b: P2, x: P2, tol: number): boolean {
  const d = sub2(b, a);
  const t = ((x[0] - a[0]) * d[0] + (x[1] - a[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
  return t > 0 && t < 1 && dist2(x, a) > tol && dist2(x, b) > tol;
}

/**
 * Where the segment a–b's line meets the circle, as two points — none for a
 * miss or a tangency. Tangent means the line passes within `tol` of touching:
 * measured as a distance, not as how far apart the two roots are, because a
 * tangency solved to a residual δ has roots √δ apart — far past any tolerance
 * a length can have — and would come back as a crossing.
 */
function lineCircle(a: P2, b: P2, c: P2, r: number, tol: number): P2[] {
  const d = sub2(b, a);
  const len = Math.hypot(d[0], d[1]);
  if (!(len > 0)) return [];
  const u: P2 = [d[0] / len, d[1] / len];
  const off = sub2(c, a);
  const along = off[0] * u[0] + off[1] * u[1];
  const across = wedge2(u, off);
  if (Math.abs(across) >= r - tol) return [];
  const half = Math.sqrt(r * r - across * across);
  return [along - half, along + half].map((s) => [a[0] + s * u[0], a[1] + s * u[1]]);
}

/**
 * Where two circles meet, as two points — none for a miss, a tangency (within
 * `tol` of touching, outside or in, measured as `lineCircle` measures it), or
 * the same circle.
 */
function circleCircle(c1: P2, r1: number, c2: P2, r2: number, tol: number): P2[] {
  const d = dist2(c1, c2);
  if (d <= tol || d >= r1 + r2 - tol || d <= Math.abs(r1 - r2) + tol) return [];
  const h = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const k2 = r1 * r1 - h * h;
  if (k2 <= 0) return [];
  const k = Math.sqrt(k2);
  const [ux, uy] = [(c2[0] - c1[0]) / d, (c2[1] - c1[1]) / d];
  const m: P2 = [c1[0] + h * ux, c1[1] + h * uy];
  return [[m[0] - k * uy, m[1] + k * ux], [m[0] + k * uy, m[1] - k * ux]];
}

/**
 * Where two pieces **cross**: pass through each other at a point clear of
 * every end of both. A touch is not a crossing — two pieces meeting at an end,
 * an end resting on the other piece (a T), a tangency, or two lines lying
 * along each other — and none of them bounds a region the other does not. Two
 * lines cross only when each one's ends lie clear of the other's line on
 * opposite sides: so a pair lying along each other, near enough, never cross
 * at whatever point noise in their directions would put it.
 */
function crossings(e: Piece, f: Piece, tol: number): P2[] {
  if (e.kind === "path" || f.kind === "path") return pathCrossings(e, f, tol);
  if (e.kind === "line" && f.kind === "line") {
    const side = (a: P2, b: P2, x: P2) => wedge2(sub2(b, a), sub2(x, a)) / dist2(a, b);
    const straddles = (a: P2, b: P2, x: P2, y: P2) => {
      const [sx, sy] = [side(a, b, x), side(a, b, y)];
      return (sx > tol && sy < -tol) || (sx < -tol && sy > tol);
    };
    if (!straddles(e.p, e.q, f.p, f.q) || !straddles(f.p, f.q, e.p, e.q)) return [];
    const u = sub2(e.q, e.p), v = sub2(f.q, f.p);
    const t = wedge2(sub2(f.p, e.p), v) / wedge2(u, v);
    const x: P2 = [e.p[0] + t * u[0], e.p[1] + t * u[1]];
    return withinSegment(e.p, e.q, x, tol) && withinSegment(f.p, f.q, x, tol) ? [x] : [];
  }
  if (e.kind === "arc" && f.kind === "line") return crossings(f, e, tol);
  if (e.kind === "line" && f.kind === "arc") {
    return lineConic(e.p, e.q, f, tol).filter((x) => withinSegment(e.p, e.q, x, tol) && withinArc(f, x, tol));
  }
  const [a, b] = [e as Extract<Piece, { kind: "arc" }>, f as Extract<Piece, { kind: "arc" }>];
  if (a.b !== undefined || b.b !== undefined) return conicConic(a, b, tol).filter((x) => withinArc(a, x, tol) && withinArc(b, x, tol));
  return circleCircle(a.c, a.r, b.c, b.r, tol).filter((x) => withinArc(a, x, tol) && withinArc(b, x, tol));
}

/**
 * Where a path crosses another piece, of any kind — none of which has a closed
 * form with a B-spline. Both walked as fine polylines (`pathSteps`; a line is
 * its own); where two of their segments cross, the crossing is refined by
 * Newton on the two exact curves, `A(s) = B(t)`. Kept when it is clear of
 * every end of both and is a **crossing**: the first piece passes from one side
 * of the second to the other there, read against the second's tangent a short
 * step either way — so a tangency, which changes no side, is no crossing, as
 * everywhere here. Crossings within `tol` of one another are one.
 */
function pathCrossings(e: Piece, f: Piece, tol: number): P2[] {
  const steps = (p: Piece) => (p.kind === "line" ? [0, 1] : p.kind === "path" ? pathSteps(p)
    : arcSteps(Math.max(16, Math.ceil(Math.abs(p.sweep) / (TAU / 256)))));
  const [se, sf] = [steps(e), steps(f)];
  const [pe, pf] = [se.map((t) => pointAt(e, t)), sf.map((t) => pointAt(f, t))];
  const tangent = (p: Piece, t: number): P2 => {
    if (p.kind === "line") return sub2(p.q, p.p);
    if (p.kind === "path") { const [d] = pathDerivs(p, pathParam(p, t)); const k = p.t1 - p.t0; return [d[0] * k, d[1] * k]; }
    const a = p.t0 + t * p.sweep;
    if (p.b === undefined) return [-p.r * Math.sin(a) * p.sweep, p.r * Math.cos(a) * p.sweep];
    const [dx, dy] = dirOf(p);
    const [x, y] = [-p.r * Math.sin(a) * p.sweep, p.b * Math.cos(a) * p.sweep];
    return [x * dx - y * dy, x * dy + y * dx];
  };
  const out: P2[] = [];
  for (let i = 0; i + 1 < pe.length; i++) {
    const [a, b] = [pe[i], pe[i + 1]];
    const lo = [Math.min(a[0], b[0]) - tol, Math.min(a[1], b[1]) - tol];
    const hi = [Math.max(a[0], b[0]) + tol, Math.max(a[1], b[1]) + tol];
    for (let j = 0; j + 1 < pf.length; j++) {
      const [c, d] = [pf[j], pf[j + 1]];
      if (Math.max(c[0], d[0]) < lo[0] || Math.min(c[0], d[0]) > hi[0] || Math.max(c[1], d[1]) < lo[1] || Math.min(c[1], d[1]) > hi[1]) continue;
      const u = sub2(b, a), v = sub2(d, c);
      const den = wedge2(u, v);
      if (Math.abs(den) < 1e-300) continue;
      const w = sub2(c, a);
      const s0 = wedge2(w, v) / den, t0 = wedge2(w, u) / den;
      if (s0 < -0.5 || s0 > 1.5 || t0 < -0.5 || t0 > 1.5) continue;
      // Newton on A(s) − B(t) = 0, from where the two segments cross.
      let s = se[i] + s0 * (se[i + 1] - se[i]);
      let t = sf[j] + t0 * (sf[j + 1] - sf[j]);
      for (let k = 0; k < 30; k++) {
        const r = sub2(pointAt(e, s), pointAt(f, t));
        const [A, B] = [tangent(e, s), tangent(f, t)];
        const det = -A[0] * B[1] + A[1] * B[0];
        if (Math.abs(det) < 1e-300) break;
        const ds = (-r[0] * -B[1] - -r[1] * -B[0]) / det;
        const dt = (A[0] * -r[1] - A[1] * -r[0]) / det;
        s += ds; t += dt;
        if (Math.abs(ds) + Math.abs(dt) < 1e-15) break;
      }
      if (!(s >= 0 && s <= 1 && t >= 0 && t <= 1)) continue;
      const x = pointAt(e, s);
      if (dist2(x, pointAt(f, t)) > tol) continue;
      if (!whole(e) && (dist2(x, e.p) <= tol || dist2(x, e.q) <= tol)) continue;
      if (!whole(f) && (dist2(x, f.p) <= tol || dist2(x, f.q) <= tol)) continue;
      // A crossing, not a touch: e is on opposite sides of f's tangent either side of it.
      const T = tangent(f, t);
      const step = Math.min(1e-3, 0.25 * Math.max(se[i + 1] - se[i], 1e-6));
      const side = (q: number) => wedge2(T, sub2(pointAt(e, Math.min(1, Math.max(0, q))), x));
      const [l, r] = [side(s - step), side(s + step)];
      const scale = Math.hypot(T[0], T[1]) * tol;
      if (!((l > scale && r < -scale) || (l < -scale && r > scale))) continue;
      if (!out.some((y) => dist2(x, y) <= tol)) out.push(x);
    }
  }
  return out;
}

/**
 * Where the segment a–b's line meets a circle or a conic: `lineCircle` in
 * the conic's own axes scaled to one — an affine map, so a line stays a line
 * and the conic becomes the unit circle — mapped back. The tangency
 * tolerance is scaled by the shorter semi-axis, the most a length shrinks.
 */
function lineConic(a: P2, b: P2, piece: ArcPiece, tol: number): P2[] {
  if (piece.b === undefined) return lineCircle(a, b, piece.c, piece.r, tol);
  const [A, B] = [normalised(piece, a), normalised(piece, b)];
  return lineCircle(A, B, [0, 0], 1, tol / Math.min(piece.r, piece.b)).map(([x, y]) => onCurve(piece, Math.atan2(y, x)));
}

/**
 * Where two curves at least one of which is a conic with two radii cross — the one pair
 * with no closed form (a quartic). Found by walking the first's whole curve in
 * small steps for a change of side of the second (inside its normalised unit
 * circle or out), and halving each step that changes to the crossing. A
 * tangency changes no side, so it is no crossing, as everywhere here; two
 * crossings closer than a step apart would be missed, which at 720 steps round
 * is two curves all but tangent.
 */
function conicConic(e: ArcPiece, f: ArcPiece, tol: number): P2[] {
  const STEPS = 720;
  const side = (s: number) => Math.hypot(...normalised(f, onCurve(e, s))) - 1;
  const out: P2[] = [];
  let [s0, g0] = [0, side(0)];
  for (let k = 1; k <= STEPS; k++) {
    const s1 = (TAU * k) / STEPS, g1 = side(s1);
    if ((g0 < 0) !== (g1 < 0)) {
      let [lo, hi, glo] = [s0, s1, g0];
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2, gm = side(mid);
        if ((gm < 0) === (glo < 0)) { lo = mid; glo = gm; } else hi = mid;
      }
      const x = onCurve(e, (lo + hi) / 2);
      if (!out.some((y) => dist2(x, y) <= tol)) out.push(x);
    }
    [s0, g0] = [s1, g1];
  }
  return out;
}

/**
 * How far round `x` the piece turns, as seen from `x`: the angle from its start
 * to its end. A line, or an arc whose circle `x` is outside, turns less than a
 * half-turn and the plain signed angle is the answer. Seen from inside its
 * circle an arc turns monotonically its own way, so the same angle is taken
 * the long way round when it has to be — and a whole circle is a whole turn.
 */
function turnAbout(piece: Piece, x: P2): number {
  if (piece.kind === "path") {
    // A fine walk along it, each step's turn about x small and signed.
    let sum = 0;
    let prev = sub2(piece.p, x);
    for (const t of pathSteps(piece).slice(1)) {
      const next = sub2(pointAt(piece, t), x);
      sum += Math.atan2(wedge2(prev, next), prev[0] * next[0] + prev[1] * next[1]);
      prev = next;
    }
    return sum;
  }
  const a = sub2(piece.p, x), b = sub2(piece.q, x);
  const base = Math.atan2(wedge2(a, b), a[0] * b[0] + a[1] * b[1]);
  if (piece.kind === "line" || Math.hypot(...normalised(piece, x)) >= 1) return base;
  if (whole(piece)) return Math.sign(piece.sweep) * TAU;
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
  if (piece.kind === "path") return nearestOnPath(piece, x).d;
  if (piece.kind === "line") {
    const d = sub2(piece.q, piece.p);
    const len2 = d[0] * d[0] + d[1] * d[1];
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((x[0] - piece.p[0]) * d[0] + (x[1] - piece.p[1]) * d[1]) / len2)) : 0;
    return dist2(x, [piece.p[0] + t * d[0], piece.p[1] + t * d[1]]);
  }
  if (piece.b !== undefined) {
    // A conic's nearest point has no closed form: a fine walk along it, as
    // drawn, is near enough for the one question asked of this — is a point on
    // the outline, to a millionth of the drawing.
    const n = 720;
    let best = Infinity;
    for (let k = 0; k <= n; k++) best = Math.min(best, dist2(x, pointAt(piece, k / n)));
    return best;
  }
  const t = Math.atan2(x[1] - piece.c[1], x[0] - piece.c[0]);
  const along = mod(piece.sweep >= 0 ? t - piece.t0 : piece.t0 - t, TAU);
  if (along <= Math.abs(piece.sweep)) return Math.abs(dist2(x, piece.c) - piece.r);
  return Math.min(dist2(x, piece.p), dist2(x, piece.q));
}

/** The piece's halfway point. */
function midpoint(piece: Piece): P2 {
  if (piece.kind === "line") return [(piece.p[0] + piece.q[0]) / 2, (piece.p[1] + piece.q[1]) / 2];
  if (piece.kind === "path") return pointAt(piece, 0.5);
  return onCurve(piece, piece.t0 + piece.sweep / 2);
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
    if (piece.kind === "arc") grow(piece.c, Math.max(piece.r, rb(piece)));
    // A B-spline lies in its control points' hull: all of them, generous for a part of one.
    if (piece.kind === "path") for (const c of piece.curve.ctrl) grow([c[0], c[1]]);
  }
  return b;
}

const overlaps = (a: Box, b: Box, tol: number): boolean =>
  a.x0 <= b.x1 + tol && b.x0 <= a.x1 + tol && a.y0 <= b.y1 + tol && b.y0 <= a.y1 + tol;

// --- cutting at Ts and crossings ---------------------------------------------------

/** A point a relation holds on a curve — see the top of the file for which relations those are. */
export interface Held {
  point: string;
  curve: string;
}

/**
 * Every point held on a line, arc or circle, read off the relation registry —
 * what cuts an edge at a T here, and what a feature's profile checks a
 * portion's ends against (operations.ts), so the two cannot disagree about
 * which points are on which edges.
 */
export function heldOnCurves(model: Model): Held[] {
  const out: Held[] = [];
  for (const rel of model.relations.values()) {
    const [point, curve] = rel.args;
    if (typeof point !== "string" || typeof curve !== "string") continue;
    if (model.entities.get(point)?.kind !== "point") continue;
    const kind = model.entities.get(curve)?.kind;
    // `midpoint` with two arguments is the line form; with three it names two
    // points and no edge.
    const onLine = (rel.op === "pointOnLine" || (rel.op === "midpoint" && rel.args.length === 2)) && kind === "line";
    const onRim = (rel.op === "onCircle" && (kind === "arc" || kind === "circle")) || (entityKind(kind)?.heldBy?.includes(rel.op) ?? false);
    if (onLine || onRim) out.push({ point, curve });
  }
  // A curve's own points on it (`EntityKindSpec.through`): a chord drawn
  // between two of a closed spline's points split nothing until they were
  // read here — no relation says they are on it; its definition does.
  for (const e of model.entities.values()) {
    for (const point of entityKind(e.kind)?.through?.(e) ?? []) out.push({ point, curve: e.name });
  }
  return out;
}

/** A line, arc or circle of one plane's drawing, flat, and where it is cut. */
interface Source {
  name: string;
  kind: "line" | "arc" | "circle";
  /** Creation order — what "earliest" means everywhere below. */
  order: number;
  /** In the entity's own direction. */
  piece: Piece;
  /** A line's or arc's two ends: their names, and their joined classes. Null for a circle. */
  ends: [string, string] | null;
  at: [number, number] | null;
  cuts: Cut[];
  /** How many parts the cuts make of it — what says a run of them is the whole entity. 0 for an uncut circle. */
  parts: number;
}

/** Where a source is cut. */
interface Cut {
  /** How far along the source, as a fraction of it in its own direction. */
  t: number;
  /** The source's own point there, flat. */
  x: P2;
  /** The vertex: a joined class, or a crossing, numbered from the first number no class has. */
  v: number;
  /** The held point's name; a crossing's key, once every crossing is known. */
  name: string | null;
}

/** One part of a source, between consecutive cuts or its ends: an edge of the cut drawing. */
interface Part {
  src: Source;
  /** Which part, counting along the source's own direction — from its start, or a circle's first cut. */
  k: number;
  /** From and to, as fractions of the source; `t1` passes 1 on the part of a circle across its seam. */
  t0: number;
  t1: number;
  /** The vertices it runs between, in the source's direction, and their names. */
  at: [number, number];
  names: [string, string];
  /** In the source's direction. */
  piece: Piece;
}

/**
 * The plane's drawing cut at every held point and every crossing — see the
 * top of the file — as its parts. An uncut line or arc is one part, the very
 * piece it was; an uncut circle is no part at all (it is a loop on its own,
 * and is found as one).
 */
function cutDrawing(model: Model, plane: LoopPlane, sources: Source[], held: Held[],
                    classOf: Map<string, number>, tol: number): Part[] {
  const byName = new Map(sources.map((s) => [s.name, s]));
  const near = (s: Source, x: P2) => s.cuts.find((c) => dist2(c.x, x) <= tol);
  const nearEnd = (s: Source, x: P2) => s.kind !== "circle" && (dist2(x, s.piece.p) <= tol || dist2(x, s.piece.q) <= tol);

  // Ts first, so a crossing at a held point finds it there.
  const heldName = new Map<number, string>();
  for (const { point, curve } of held) {
    const s = byName.get(curve);
    const v = classOf.get(point);
    if (!s || v === undefined || s.at?.includes(v)) continue;
    const t = fractionAlong(s.piece, toPlane(plane, model.coords(point)));
    if (t === null) continue;
    const x = pointAt(s.piece, t);
    if (nearEnd(s, x) || near(s, x)) continue;
    s.cuts.push({ t, x, v, name: point });
    if (!heldName.has(v)) heldName.set(v, point);
  }

  // Crossings. A vertex number below `base` is a joined class (classes number
  // the points, so there are fewer of them); one at or above it is a crossing.
  // Crossings at one spot are one vertex, and a crossing at a held point is
  // that point — but two held points of different classes are never made one:
  // nothing holds them together.
  const base = classOf.size;
  let next = base;
  const up = new Map<number, number>();
  const find = (v: number): number => { while (up.has(v)) v = up.get(v)!; return v; };
  const union = (a: number, b: number) => {
    const [ra, rb] = [find(a), find(b)];
    if (ra === rb || (ra < base && rb < base)) return;
    if (ra < base) up.set(rb, ra);
    else up.set(ra, rb);
  };
  // Swept along u, so only pairs whose boxes overlap there are looked at.
  const boxes = sources.map((s) => boxOf([s.piece]));
  const byU = sources.map((_, i) => i).sort((i, j) => boxes[i].x0 - boxes[j].x0 || i - j);
  for (let k = 0; k < byU.length; k++) {
    for (let l = k + 1; l < byU.length && boxes[byU[l]].x0 <= boxes[byU[k]].x1 + tol; l++) {
      const [i, j] = byU[k] < byU[l] ? [byU[k], byU[l]] : [byU[l], byU[k]];
      if (!overlaps(boxes[i], boxes[j], tol)) continue;
      const [a, b] = [sources[i], sources[j]];
      for (const x of crossings(a.piece, b.piece, tol)) {
        const [ca, cb] = [near(a, x), near(b, x)];
        if (ca && cb) { union(ca.v, cb.v); continue; }
        const v = ca?.v ?? cb?.v ?? next++;
        const name = ca?.name ?? cb?.name ?? null;
        if (!ca) a.cuts.push({ t: fractionAlong(a.piece, x) ?? 0, x, v, name });
        if (!cb) b.cuts.push({ t: fractionAlong(b.piece, x) ?? 0, x, v, name });
      }
    }
  }

  // Each cut's vertex as it finally is, and each crossing's sources.
  const through = new Map<number, { src: Source; t: number }[]>();
  for (const s of sources) {
    for (const c of s.cuts) {
      c.v = find(c.v);
      if (c.v < base) c.name ??= heldName.get(c.v)!;
      else through.set(c.v, [...(through.get(c.v) ?? []), { src: s, t: c.t }]);
    }
  }
  // Crossings named by the edges through them, numbered along the first when
  // the same edges cross more than once, and primed past any name the model has.
  const sameEdges = new Map<string, { v: number; t: number }[]>();
  for (const [v, list] of through) {
    const srcs = [...new Set(list.map((c) => c.src))].sort((p, q) => p.order - q.order);
    const key = srcs.map((s) => s.name).join(CROSSING);
    sameEdges.set(key, [...(sameEdges.get(key) ?? []), { v, t: list.find((c) => c.src === srcs[0])!.t }]);
  }
  const keyOf = new Map<number, string>();
  for (const [key, list] of sameEdges) {
    list.sort((a, b) => a.t - b.t);
    list.forEach(({ v }, i) => {
      let name = list.length > 1 ? `${key}#${i + 1}` : key;
      while (model.has(name)) name += "′";
      keyOf.set(v, name);
    });
  }

  const parts: Part[] = [];
  for (const s of sources) {
    // One cut per vertex, and none at a line's or arc's own end class — either
    // can follow from two vertices having been found to be one.
    s.cuts = s.cuts.sort((a, b) => a.t - b.t)
      .filter((c, i, all) => all.findIndex((d) => d.v === c.v) === i && !s.at?.includes(c.v));
    for (const c of s.cuts) if (c.v >= base) c.name = keyOf.get(c.v)!;
    const cuts = s.cuts;
    if (s.kind === "circle") {
      s.parts = cuts.length;
      cuts.forEach((c, k) => {
        const d = cuts[(k + 1) % cuts.length];
        const t1 = k + 1 < cuts.length ? d.t : d.t + 1;
        parts.push({ src: s, k, t0: c.t, t1, at: [c.v, d.v], names: [c.name!, d.name!], piece: slice(s.piece, c.t, t1) });
      });
      continue;
    }
    const stops = [
      { t: 0, v: s.at![0], name: s.ends![0] },
      ...cuts.map((c) => ({ t: c.t, v: c.v, name: c.name! })),
      { t: 1, v: s.at![1], name: s.ends![1] },
    ];
    s.parts = stops.length - 1;
    for (let k = 0; k + 1 < stops.length; k++) {
      const [a, b] = [stops[k], stops[k + 1]];
      parts.push({
        src: s, k, t0: a.t, t1: b.t, at: [a.v, b.v], names: [a.name, b.name],
        piece: cuts.length ? slice(s.piece, a.t, b.t) : s.piece,
      });
    }
  }
  return parts;
}

// --- faces --------------------------------------------------------------------------

/**
 * The parts that lie on no cycle — bridges, with every dangling tree among
 * them — by Tarjan's low-link, written for a multigraph: only the part just
 * come along is skipped, so two parts between the same two vertices are a
 * cycle, as a line and an arc between two points are, and a circle cut once
 * is a cycle on its own.
 */
function bridges(parts: Part[]): Set<number> {
  const adj = new Map<number, { id: number; to: number }[]>();
  parts.forEach(({ at }, id) => {
    for (const [a, b] of [[at[0], at[1]], [at[1], at[0]]]) {
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

/** The connected pieces of a plane's cut drawing, as lists of its parts. */
function components(parts: Part[]): Part[][] {
  const up = new Map<number, number>();
  const find = (v: number): number => { while (up.has(v)) v = up.get(v)!; return v; };
  for (const { at } of parts) {
    const [a, b] = [find(at[0]), find(at[1])];
    if (a !== b) up.set(b, a);
  }
  const by = new Map<number, Part[]>();
  for (const p of parts) {
    const root = find(p.at[0]);
    by.set(root, [...(by.get(root) ?? []), p]);
  }
  return [...by.values()];
}

/**
 * A half-edge: part `h >> 1`, walked in its own direction when `h` is even and
 * against it when odd, so `h ^ 1` is the same part the other way.
 */
type Half = number;

/**
 * The minimal cycles of one connected, bridgeless component of the cut
 * drawing — the bounded faces, each split at any vertex its walk visits twice
 * — as lists of half-edges, each counter-clockwise.
 */
function faceCycles(comp: Part[], size: number): Half[][] {
  const halves = comp.length * 2;
  const pieceOf = (h: Half): Piece => (h & 1 ? reversed(comp[h >> 1].piece) : comp[h >> 1].piece);
  const fromOf = (h: Half): number => comp[h >> 1].at[h & 1];
  const toOf = (h: Half): number => comp[h >> 1].at[1 - (h & 1)];

  // Each vertex's outgoing half-edges in counter-clockwise order. Ties in
  // direction go by curvature — the one bending left sits just
  // counter-clockwise of the one bending less — and two parts identical even
  // in that (the same line drawn twice) by a fixed imagined offset, larger
  // index to the left of the part's direction from its lower-numbered end,
  // which orders them one way at one end and the other way at the other, as
  // two parallel edges a hair apart would be.
  const around = new Map<number, Half[]>();
  for (let h = 0; h < halves; h++) around.set(fromOf(h), [...(around.get(fromOf(h)) ?? []), h]);
  const position = new Array<number>(halves);
  for (const [v, list] of around) {
    const keyed = list.map((h) => {
      const piece = pieceOf(h);
      const t = startTangent(piece);
      const { at } = comp[h >> 1];
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

  // Interior on the left: arriving along h, leave by the part just clockwise
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

// --- members -------------------------------------------------------------------------

/** Consecutive parts of one source, walked one way: one member. */
interface Run {
  src: Source;
  back: boolean;
  /** The first and last part walked, and how many. */
  first: number;
  last: number;
  count: number;
  /** The part of the source covered, as fractions of it — `lo < hi`, unwrapped across a circle's seam. */
  lo: number;
  hi: number;
  /** The vertices it is walked from and to, by name. */
  from: string;
  to: string;
}

/** Whether part `k` is the one walked straight after part `last` of `src`, going the way `back` says. */
function follows(src: Source, back: boolean, last: number, k: number): boolean {
  const step = back ? -1 : 1;
  return src.kind === "circle" ? k === mod(last + step, src.parts) : k === last + step;
}

/** A cycle of half-edges as its members: each the longest run of one entity the cycle walks. */
function runsOf(cycle: Half[], comp: Part[]): Run[] {
  const runs: Run[] = [];
  for (const h of cycle) {
    const part = comp[h >> 1];
    const back = (h & 1) === 1;
    const len = part.t1 - part.t0;
    const run = runs.at(-1);
    if (run && run.src === part.src && run.back === back && run.count < part.src.parts && follows(part.src, back, run.last, part.k)) {
      run.last = part.k;
      run.count++;
      if (back) run.lo -= len;
      else run.hi += len;
      run.to = part.names[back ? 0 : 1];
      continue;
    }
    runs.push({
      src: part.src, back, first: part.k, last: part.k, count: 1, lo: part.t0, hi: part.t1,
      from: part.names[back ? 1 : 0], to: part.names[back ? 0 : 1],
    });
  }
  // The walk may have started partway along a run, leaving its two halves at
  // the two ends of the list: they are one member.
  const [head, tail] = [runs[0], runs.at(-1)!];
  if (runs.length > 1 && tail.src === head.src && tail.back === head.back
      && tail.count + head.count <= head.src.parts && follows(head.src, head.back, tail.last, head.first)) {
    const len = (tail.hi - tail.lo) + (head.hi - head.lo);
    if (head.back) { head.hi = tail.hi; head.lo = tail.hi - len; }
    else { head.lo = tail.lo; head.hi = tail.lo + len; }
    head.first = tail.first;
    head.count += tail.count;
    head.from = tail.from;
    runs.pop();
  }
  return runs;
}

/** Whether a run is its whole entity. */
const wholeRun = (run: Run): boolean => run.count === run.src.parts;

/** A run as the loop lists it. */
function memberOf(run: Run): LoopMember {
  const { src, back } = run;
  if (wholeRun(run)) {
    if (src.kind === "circle") return { name: src.name, reversed: back, from: null, to: null, span: null };
    return { name: src.name, reversed: back, from: src.ends![back ? 1 : 0], to: src.ends![back ? 0 : 1], span: null };
  }
  // Sums of parts drift by an ulp or two; a cut is where it is, and a line's
  // ends are exactly 0 and 1.
  const snap = (x: number) => (Math.abs(x - Math.round(x)) < 1e-12 ? Math.round(x) : x);
  const shift = src.kind === "circle" ? Math.floor(snap(run.lo)) : 0;
  return { name: src.name, reversed: back, from: run.from, to: run.to, span: [snap(run.lo - shift), snap(run.hi - shift)] };
}

/** A run's outline, walked as the loop walks it. */
function runPiece(run: Run): Piece {
  const piece = wholeRun(run) ? run.src.piece : slice(run.src.piece, run.lo, run.hi);
  return run.back ? reversed(piece) : piece;
}

/** A counter-clockwise cycle's runs, started from the earliest-made member, at its earliest portion. */
function rotateToEarliest(runs: Run[]): Run[] {
  const rank = (r: Run) => [r.src.order, wholeRun(r) ? -1 : mod(r.lo, 1)];
  let k = 0;
  runs.forEach((r, i) => { if (before(rank(r), rank(runs[k]))) k = i; });
  return [...runs.slice(k), ...runs.slice(0, k)];
}

/** Lexicographic order on number lists, a shorter prefix first. */
function before(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a.length < b.length;
}

// --- finding them -------------------------------------------------------------------

/** A loop as it is being found: the public data, plus its outline and where it came from. */
interface Found {
  loop: Loop;
  outline: Piece[];
  group: number;
  /**
   * Its members' creation orders, each followed by where along its entity it
   * starts (−1 whole), ascending — what sorts the listing.
   */
  rank: number[];
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
  // A construction point cuts no edge it is held on (`Model.isConstruction`): reference, and no vertex of a region.
  const held = heldOnCurves(model).filter((h) => !model.isConstruction(h.point));

  const found: Found[] = [];
  const keys = new Set<string>();
  const rankOf = (list: [number, number][]) => list.sort((a, b) => a[0] - b[0] || a[1] - b[1]).flat();
  groups.forEach((g, gi) => {
    const lines = edges.filter((e) => inPlane(model, g, e.name));
    const rings = circles.filter((c) => inPlane(model, g, c.name));
    if (!lines.length && !rings.length) return;
    // The curves a plane can be oriented by: those laid out by a frame. A
    // B-spline has no centre or normal of its own to offer.
    const framed = rings.filter((c) => !hasCurvePath(model.entities.get(c.name)!.kind));
    const curves = [...lines.filter((e) => e.kind === "arc"), ...framed].sort((a, b) => a.order - b.order).map((c) => c.name);
    const plane = orientPlane(model, g, lines.filter((e) => e.kind === "line"), curves);

    const sources: Source[] = [
      // An open path walks, cuts and joins as an arc does: an edge with two ends.
      ...lines.map((e): Source => ({
        name: e.name, kind: e.kind === "path" ? "arc" : e.kind, order: e.order, piece: pieceOf(model, e.name, plane), ends: e.ends, at: e.at, cuts: [], parts: 1,
      })),
      ...rings.map((c): Source => ({
        name: c.name, kind: "circle", order: c.order, piece: pieceOf(model, c.name, plane), ends: null, at: null, cuts: [], parts: 0,
      })),
    ];
    const box = boxOf(sources.map((s) => s.piece));
    const size = Math.max(1, Math.hypot(box.x1 - box.x0, box.y1 - box.y0));
    const tol = LENGTH_TOL * size;

    const parts = cutDrawing(model, plane, sources, held, classOf, tol);
    const cut = bridges(parts);
    for (const comp of components(parts.filter((_, i) => !cut.has(i)))) {
      for (const cycle of faceCycles(comp, size)) {
        const runs = rotateToEarliest(runsOf(cycle, comp));
        const members = runs.map(memberOf);
        const outline = runs.map(runPiece);
        const key = members.map((m) => (m.span ? `${m.name}@${m.span[0].toFixed(9)}` : m.name)).sort().join(",");
        if (keys.has(key)) continue;
        keys.add(key);
        found.push({
          loop: { members, plane, area: outline.reduce((s, p) => s + pieceArea(p), 0), parent: null, children: [] },
          outline, group: gi, size,
          rank: rankOf(runs.map((r): [number, number] => [r.src.order, wholeRun(r) ? -1 : mod(r.lo, 1)])),
        });
      }
    }
    for (const s of sources) {
      // A circle nothing cuts is a loop on its own.
      if (s.kind !== "circle" || s.parts > 0 || keys.has(s.name)) continue;
      keys.add(s.name);
      // Counter-clockwise about the plane's normal: against the circle's own
      // way round when its frame faces the other way.
      const own = s.piece;
      // By its area's sign, which for a circle is its sweep's.
      const outline = [own.kind !== "line" && pieceArea(own) < 0 ? reversed(own) : own];
      found.push({
        loop: {
          members: [{ name: s.name, reversed: outline[0] !== own, from: null, to: null, span: null }],
          plane, area: pieceArea(outline[0]), parent: null, children: [],
        },
        outline, group: gi, rank: [s.order, -1], size,
      });
    }
  });

  found.sort((a, b) => (before(a.rank, b.rank) ? -1 : before(b.rank, a.rank) ? 1 : 0));
  relateContainment(found);
  return found.map((f) => f.loop);
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
  for (const p of inner.outline) for (const q of outer.outline) if (crossings(p, q, tol).length) return false;
  const probes = inner.outline.flatMap((piece) =>
    piece.kind === "arc" && Math.abs(piece.sweep) >= TAU - 1e-12
      ? [0, 1, 2, 3].map((k) => onCurve(piece, piece.t0 + (k * Math.PI) / 2))
      : whole(piece) ? [0, 0.25, 0.5, 0.75].map((t) => pointAt(piece, t))
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
  // counter-clockwise about its own frame — and `span` is measured the same
  // way, so a slice and then `reversed` is all it takes.
  return loop.members.map((m) => {
    const own = pieceOf(model, m.name, loop.plane);
    const piece = m.span ? slice(own, m.span[0], m.span[1]) : own;
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
    if (piece.kind === "path") {
      for (const u of sampleParams({ ...piece.curve, ctrl: piece.curve.ctrl.map((c) => toWorld(plane, [c[0], c[1]])) }, 0.25 / view.scale)) {
        take(onPath(piece, u));
      }
      continue;
    }
    const n = arcSegments(Math.abs(piece.sweep), Math.max(piece.r, rb(piece)) * view.scale);
    for (let k = 0; k < n; k++) take(onCurve(piece, piece.t0 + (piece.sweep * k) / n));
  }
  return hi - lo < EDGE_ON_PX;
}

// --- the listing ------------------------------------------------------------------------

/**
 * One line of `loops()`: `loop of l1,l4,l3,l2 in f1, area 1200`, and where it
 * lies inside another, `…, inside l5,l6,l7,l8` — a loop is named by its
 * members, since it has no name of its own. A member that is part of its
 * entity reads with the vertices it runs between, in the entity's own
 * direction (`memberLabel`): a rectangle with a line across it is
 * `loop of l1[p1→l1×l5],l5[l1×l5→l3×l5],l3[l3×l5→p4],l4 in f1, area 450` and
 * `loop of l1[l1×l5→p2],l2,l3[p3→l3×l5],l5[l1×l5→l3×l5] in f1, area 750`.
 */
export function describeLoop(loop: Loop, all: Loop[]): string {
  const names = (l: Loop) => l.members.map(memberLabel).join(",");
  const round = (x: number) => Number(x.toFixed(3)) + 0; // + 0 turns -0 into 0
  const where = loop.plane.frame !== null
    ? ` in ${loop.plane.frame}`
    : ` in the plane facing (${loop.plane.normal.map(round).join(", ")})`;
  const within = loop.parent === null ? "" : `, inside ${names(all[loop.parent])}`;
  return `loop of ${names(loop)}${where}, area ${round(loop.area)}${within}`;
}

/**
 * The loop a world point lies inside, or null: the innermost coplanar loop
 * whose outline holds `world` — `loopAt`'s question asked of a point rather
 * than a pixel. What a region picked earlier is found again by after the
 * drawing has changed under it: a feature tool keeps where each region was
 * clicked (`RegionHit.at`), and a loop found afresh has new indices, and after
 * a neighbour's extrude made its crossings points, new member labels too — a
 * key cannot follow that, a point inside it can. Coplanar to a millionth of
 * the loop's own size, so a lid straight above is not the same region.
 */
export function loopAround(model: Model, world: number[], loops: Loop[] = findLoops(model)): Loop | null {
  const hits: number[] = [];
  loops.forEach((loop, i) => {
    const off = Math.abs(dot3(sub3(lift3(world), loop.plane.origin), loop.plane.normal));
    if (off > 1e-6 * Math.max(1, Math.sqrt(Math.abs(loop.area)))) return;
    if (inside(outlineOf(model, loop), toPlane(loop.plane, world))) hits.push(i);
  });
  const holdsAHit = (i: number) => hits.some((h) => {
    for (let p = loops[h].parent; p !== null; p = loops[p].parent) if (p === i) return true;
    return false;
  });
  const left = hits.filter((h) => !holdsAHit(h)).sort((a, b) => loops[a].area - loops[b].area || a - b);
  return left.length ? loops[left[0]] : null;
}

/**
 * Whether a world point lies inside `loop` — in its plane, to `loopAround`'s
 * tolerance, and within its outline by winding. `loopAround`'s test for one
 * loop, which the containment tree cannot always answer: a loop inside an
 * outline that a third loop overlaps has that third loop, not the outline, as
 * its smallest container, or none at all (operations.ts's `featureRegion`).
 */
export function insideLoop(model: Model, loop: Loop, world: number[]): boolean {
  const off = Math.abs(dot3(sub3(lift3(world), loop.plane.origin), loop.plane.normal));
  if (off > 1e-6 * Math.max(1, Math.sqrt(Math.abs(loop.area)))) return false;
  return inside(outlineOf(model, loop), toPlane(loop.plane, world));
}
