// The faces of a solid — read off its live geometry every frame, stored
// nowhere.
//
// An extrude is real geometry (see `extrude` in operations.ts): twins, walls
// and a depth dimension. Its *faces* are not. They are what is filled between
// those pieces, recomputed from wherever the pieces are now, so a face can
// never disagree with the edges drawn over it: drag a lid corner, `set` the
// depth, and the faces are simply where the geometry is on the next frame.
//
// A pure function of (model, view), glyphs.ts's kind: no canvas, no state, and
// so testable without a browser. **This file says what the faces are; it does
// not draw them.** facelayer.ts does — by WebGL with a depth test where the
// browser has it, which answers per pixel which face is in front, and by the
// painter's (`facesToDraw`, the one sort left here) where it has not.
//
// **What a solid's faces are.** Two caps — the profile and the lid — each one
// set of outlines, every loop in the profile, filled **even-odd**, so a hole
// is empty and an island in a hole is solid with no triangulation and no rule
// about nesting anywhere. And one wall per profile member: a quad between a
// line and its twin, and between an arc or circle and its twin a ruled strip,
// sampled at the resolution the curve is drawn at (`arcSegments`), one quad per
// piece — so a curved wall shades round, piece by piece, rather than as one
// flat slab. A member that is a *portion* of its entity (a region split by a
// crossing or a T) is drawn between its two points as they are now — never
// over a span found when the region was, which a drag would leave behind — so
// the base cap and its walls end exactly where the twins and wall lines stand.
// Every face is planar, which is all a depth buffer needs of it: a convex one
// is its own triangle fan, and anything else is filled by the stencil method
// with no triangulator (see facelayer.ts).
//
// **Which way a face faces** is computed, not assumed. A cap's outward normal
// is the sketch frame's +z, toward the lid for the lid and away for the
// profile. A wall's is in the sketch plane, square to its edge, on the side the
// solid is not — which side that is comes from the loop's own winding (signed
// area about +z) and how deep it is nested (inside an even number of the other
// loops, it bounds material on its inside; an odd number, a hole). Nothing
// about the order the members were found in is trusted.
//
// **Back faces culled, lit from the eye** (`visibleFaces`). A face whose
// outward normal points away from the viewer is behind its solid and is left
// out; the rest are shaded by a headlight: Lambert's cosine with the light
// along the line of sight (`toward`). Not a world light: there is no world
// frame to hang one in, and a light fixed to the kernel's axes would be the
// gauge showing through again. A face square to the viewer is brightest; one
// seen edge-on goes dark, which is what makes a turned solid read as one.
// Which of the visible faces is in front is not this file's question any more:
// a depth buffer answers it exactly, for interpenetrating solids and a sweep
// that wraps round in front of its own cap alike, which no order of whole
// faces could (measured: docs/plans/display-depth.md).
//
// **Faces are display only.** They never pick, snap, box or wear a glyph —
// the entities do all of that, drawn *over* the faces — but a face is opaque
// to them: in the default shaded view what is behind one is neither drawn nor
// aimed at (occlusion.ts, viewmode.ts). A click on a face is a click on
// whatever visible entity is near it, or on nothing.
//
// **A face says which of its sides are the solid's edges** (`Face.edges`): a
// cap's outlines all round, a wall's base and twin sides and its side at a
// profile vertex, a sweep's rims and its vertices' circles — never a seam
// between two pieces of one round surface. The face layer draws a fine dark
// line along them, as part of the solid, which is what outlines a body whose
// own edges the shaded view leaves quiet (quiet.ts).
//
// **A revolve's faces are the same machinery with more of them derived** (see
// `revolveFaces`). Its surface is not finitely many entities, so there is no
// twin to draw a wall between: each piece of the profile is swept round the
// axis in steps, a ring of quads, from the live profile and axis and the angle
// dimension's value. Caps only for a partial revolve, even-odd as an extrude's;
// normals the profile's own, turned; the same culling and headlight.

import type { FeatureEntry, Model, Portion, ProfileMember } from "./model.ts";
import { arcPoint, arcSamples, arcSegments, portionAngles } from "./arcgeom.ts";
import { curveFrame, planeAxes } from "./curveplane.ts";
import { axisReader, turnMatrix } from "./relations/revolution.ts";
import { depth, viewAxes, worldToScreen, type View } from "./view.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";

/** One face of a solid, in the world. */
export interface Face {
  feature: string;
  /**
   * `base` is the profile's own cap; `lid` an extrude's far cap and `end` a
   * partial revolve's; `wall` every piece of the surface between them.
   */
  kind: "base" | "lid" | "end" | "wall";
  /**
   * Closed outlines, world coordinates. A cap has one per profile loop and is
   * filled even-odd; a wall piece has one, a quad.
   */
  outlines: number[][][];
  /** Outward, unit length. */
  normal: number[];
  /** Where it is: the mean of its outline's points (a cap's, the outer loop's) — what the painter's fallback sorts by. */
  centroid: number[];
  /**
   * The parts of its outline that are **edges of the solid**, as open world
   * polylines — what the face layer draws its fine edge line along. A cap's
   * outlines are edges all the way round; a wall piece's are its base and twin
   * sides, and a side across the wall only at a profile vertex. The seams
   * between the pieces a curved wall or a sweep is drawn in are not edges:
   * they are where one flat piece of a round surface meets the next, and a
   * line there would draw the tessellation, not the solid. Nor is the line a
   * whole circle's wall would close on, or a full turn's profile: neither
   * has a vertex, so there is no edge for the line to be at.
   */
  edges: number[][][];
}

/** A face as the painter's fallback fills it this frame. */
export interface DrawnFace {
  feature: string;
  kind: Face["kind"];
  /** Screen outlines, one subpath each, filled even-odd. */
  outlines: [number, number][][];
  /** Its `edges` on screen, stroked over its fill in the solid's edge ink. */
  edges: [number, number][][];
  /** Lambert's cosine against the line of sight: 0 edge-on, 1 square to the viewer. */
  shade: number;
  /** Its centroid's depth, larger nearer — what the painter's sorts by; the list is ascending. */
  depth: number;
}

/**
 * A member's points in its own direction — a line's two ends, an arc or
 * circle sampled as it is drawn (`segments` forces the count, so a twin is
 * sampled piece for piece with its base). Null if it cannot be laid out.
 *
 * `span` draws only that part of it: fractions of the entity in its own
 * direction, as loops.ts measures a member's portion (a circle from its
 * frame's +x, so `curveFrame`'s parameter is the same one).
 */
function memberPath(model: Model, name: string, scale: number, segments?: number,
                    span: [number, number] | null = null): number[][] | null {
  const e = model.entities.get(name);
  if (!e) return null;
  if (e.kind === "line") {
    const [a, b] = [lift3(model.coords(e.refs[0])), lift3(model.coords(e.refs[1]))];
    if (!span) return [a, b];
    return span.map((t) => a.map((x, i) => x + t * (b[i] - x)));
  }
  const f = curveFrame(model, e);
  if (!f) return null;
  if (!span) return arcSamples(f, segments ?? arcSegments(f.sweep, f.r * scale));
  const [t0, t1] = span.map((t) => t * f.sweep);
  const n = segments ?? arcSegments(t1 - t0, f.r * scale);
  return Array.from({ length: n + 1 }, (_, k) => arcPoint(f, t0 + ((t1 - t0) * k) / n));
}

/** A loop member as `loopOutlines` takes it: a name for the whole entity, or loops.ts's member with its `span`. */
export type OutlineMember = string | { name: string; span: [number, number] | null };

const gap = (a: number[], b: number[]) => Math.hypot(...sub3(a, b));

/**
 * Which way to walk each path so the loop closes — by position, nearest end to
 * nearest end, trying the first path both ways and keeping the tighter
 * closure. Positional on purpose: this draws what is there, and a loop whose
 * join a deletion has since opened should still draw as nearly closed as it is,
 * rather than refuse to draw.
 */
function orient(paths: number[][][]): boolean[] {
  if (paths.length === 1) return [false];
  let best: { flips: boolean[]; total: number } | null = null;
  for (const first of [false, true]) {
    const flips = [first];
    const start = first ? paths[0][paths[0].length - 1] : paths[0][0];
    let end = first ? paths[0][0] : paths[0][paths[0].length - 1];
    let total = 0;
    for (let i = 1; i < paths.length; i++) {
      const p = paths[i];
      const [fwd, back] = [gap(p[0], end), gap(p[p.length - 1], end)];
      const flip = back < fwd;
      flips.push(flip);
      total += Math.min(fwd, back);
      end = flip ? p[0] : p[p.length - 1];
    }
    total += gap(end, start);
    if (!best || total < best.total) best = { flips, total };
  }
  return best!.flips;
}

/** Paths walked as `flips` says, joined into one closed outline (shared joints once). */
function joined(paths: number[][][], flips: boolean[]): number[][] {
  const out: number[][] = [];
  paths.forEach((p, i) => {
    const q = flips[i] ? p.slice().reverse() : p;
    for (let k = out.length ? 1 : 0; k < q.length; k++) out.push(q[k]);
  });
  // A closed walk ends where it began; the path closes itself.
  if (out.length > 1 && gap(out[0], out[out.length - 1]) < 1e-12) out.pop();
  return out;
}

/** An outline as a path that goes all the way round: its first point again at the end. */
const closedPath = (o: number[][]) => (o.length ? [...o, o[0]] : o);

/**
 * Whether a profile member has vertices at its ends — every member but a whole
 * circle, which closes on itself with no corner, so its wall has no wall line
 * and its sweep no edge but its rims.
 */
function hasVertices(model: Model, m: ProfileMember): boolean {
  return !(typeof m === "string" && model.entities.get(m)?.kind === "circle");
}

const mean = (pts: number[][]) => [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length);

/** Points of a plane as (u, v) — for winding and nesting, which are questions about a flat drawing. */
function flatten(pts: number[][], origin: number[], u: number[], v: number[]): [number, number][] {
  return pts.map((p) => { const d = sub3(p, origin); return [dot3(d, u), dot3(d, v)]; });
}

function signedArea(pts: [number, number][]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [a, b] = [pts[i], pts[(i + 1) % pts.length]];
    s += a[0] * b[1] - a[1] * b[0];
  }
  return s / 2;
}

/** Even-odd: whether a ray from `p` crosses `poly` an odd number of times. */
function inPolygon(poly: [number, number][], p: [number, number]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [a, b] = [poly[i], poly[j]];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * The outlines of a set of loops, as they are drawn: each loop's members
 * walked closed, arcs sampled at `scale`. What the extrude tool previews a
 * region with, as well as what a cap is filled with. A member that is part of
 * its entity is drawn as that part, so a region split by a crossing or a T
 * is outlined exactly — the outline stops where the region does.
 */
export function loopOutlines(model: Model, loops: OutlineMember[][], scale: number): number[][][] {
  return loops.map((members) => {
    const paths = members.map((m) => (typeof m === "string" ? memberPath(model, m, scale) : memberPath(model, m.name, scale, undefined, m.span)))
      .filter((p): p is number[][] => p !== null);
    return paths.length ? joined(paths, orient(paths)) : [];
  }).filter((o) => o.length > 2);
}

/**
 * Every face of one feature, in the world — or none, when its geometry cannot
 * be laid out (a collapsed sketch frame, a curve with an end on its centre):
 * a renderer must not throw, and a solid that cannot be drawn should cost its
 * own faces and nothing else.
 */
export function featureFaces(model: Model, f: FeatureEntry, scale: number): Face[] {
  return f.kind === "revolve" ? revolveFaces(model, f, scale) : extrudeFaces(model, f, scale);
}

/**
 * A portion of a feature's profile, in its entity's own direction: the line
 * between its two points, or the part of the arc or circle between them,
 * sampled as drawn. Read off where the two points are **now** — never off a
 * span found earlier, which is a snapshot (see loops.ts) — so the cap and the
 * walls stop exactly at the points the twins and walls stand on, however the
 * geometry has moved since. Null when it cannot be laid out.
 */
function portionPath(model: Model, p: Portion, scale: number): number[][] | null {
  const e = model.entities.get(p.name);
  const [a, b] = [p.from, p.to].map((v) => (model.entities.get(v)?.kind === "point" ? lift3(model.coords(v)) : null));
  if (!e || !a || !b) return null;
  if (e.kind === "line") return [a, b];
  const f = curveFrame(model, e);
  if (!f) return null;
  const [t0, t1] = portionAngles(f, a, b);
  const n = arcSegments(t1 - t0, f.r * scale);
  const path = Array.from({ length: n + 1 }, (_, k) => arcPoint(f, t0 + ((t1 - t0) * k) / n));
  // Its ends are the points themselves, not their shadows on a rim a solve
  // has not quite reached: the cap closes where the walls stand.
  path[0] = a;
  path[n] = b;
  return path;
}

/** A profile member's path: the whole entity, or the portion. */
function profileMemberPath(model: Model, m: ProfileMember, scale: number): number[][] | null {
  return typeof m === "string" ? memberPath(model, m, scale) : portionPath(model, m, scale);
}

/**
 * A profile's paths, loop by loop, member by member, each sampled as drawn —
 * and the same of the members' twins, sampled piece for piece with their
 * bases. Null when any of it cannot be laid out.
 */
function profilePaths(model: Model, loops: ProfileMember[][], twins: string[][] | null, scale: number,
                      moved: (p: number[]) => number[] = (p) => p):
  { base: number[][][][]; twin: number[][][][] | null } | null {
  const base: number[][][][] = [];
  const twin: number[][][][] = [];
  for (let i = 0; i < loops.length; i++) {
    const b: number[][][] = [];
    const t: number[][][] = [];
    for (let k = 0; k < loops[i].length; k++) {
      const bp = profileMemberPath(model, loops[i][k], scale);
      if (!bp) return null;
      b.push(bp);
      if (twins) {
        // The twin sampled piece for piece with its base, so a wall's quads pair up.
        const tp = wholeCircle(model, loops[i][k], twins[i][k])
          ? circleFrom(model, twins[i][k], moved(bp[0]), bp.length - 1)
          : memberPath(model, twins[i][k], scale, bp.length - 1);
        if (!tp || tp.length !== bp.length) return null;
        t.push(tp);
      }
    }
    base.push(b);
    twin.push(t);
  }
  return { base, twin: twins ? twin : null };
}

/** Whether a profile member and its twin are both whole circles — a rim with no ends to pair its samples by. */
function wholeCircle(model: Model, member: ProfileMember, twin: string): boolean {
  return typeof member === "string" && model.entities.get(member)?.kind === "circle" && model.entities.get(twin)?.kind === "circle";
}

/**
 * A whole circle sampled from the point of it nearest `start` — its base's
 * first sample moved as the feature moves it — so a twin rim's samples pair up
 * with its base's however each lays its own plane out. A circle carries its
 * own normal and starts from the first direction that normal spans its plane
 * with (`spanOf`), which a turn does not carry over: a revolve's twin rim
 * started elsewhere, and its last ring of quads twisted across the tunnel (the
 * suite's tunnel test found it). Its own sweep direction is kept.
 */
function circleFrom(model: Model, name: string, start: number[], segments: number): number[][] | null {
  const e = model.entities.get(name);
  const f = e ? curveFrame(model, e) : null;
  if (!f) return null;
  const d = sub3(lift3(start), f.center);
  const along = dot3(d, f.normal);
  const u = unit3([d[0] - along * f.normal[0], d[1] - along * f.normal[1], d[2] - along * f.normal[2]]) ?? f.u;
  return arcSamples({ ...f, u, v: cross3(f.normal, u) }, segments);
}

/**
 * Which way is out of the material at each loop's edges, read flat in the
 * sketch plane: +1 when a loop's outside is on its right as walked (edge ×
 * +z), −1 when on its left. From the loop's winding (signed area about +z) and
 * how deeply it is nested in the profile's other loops — inside an even number
 * it bounds material on its inside, an odd number and it is a hole. Nothing
 * about the order the members were found in is trusted.
 */
function outwardSigns(outlines: number[][][], plane: { u: number[]; v: number[] }): number[] {
  const origin = outlines[0][0];
  const flat = outlines.map((o) => flatten(o, origin, plane.u, plane.v));
  return outlines.map((_, i) => {
    const winding = signedArea(flat[i]) < 0 ? -1 : 1;
    // Nesting from a point *on* the loop (a segment's midpoint), so a loop
    // touching another at a vertex is not miscounted at the touch.
    const [a, b] = [flat[i][0], flat[i][1]];
    const probe: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const depthIn = flat.reduce((n, other, k) => n + (k !== i && inPolygon(other, probe) ? 1 : 0), 0);
    // Material on the loop's left (counter-clockwise, not a hole) puts the
    // outside on its right, which is edge × +z.
    return winding * (depthIn % 2 === 0 ? 1 : -1);
  });
}

/** An extrude's faces: the profile's cap, the lid's, and a wall per member piece. */
function extrudeFaces(model: Model, f: Extract<FeatureEntry, { kind: "extrude" }>, scale: number): Face[] {
  const axes = planeAxes(model, f.frame);
  if (!axes) return [];
  const z = axes.n;
  const paths = profilePaths(model, f.loops, f.twins, scale);
  if (!paths) return [];
  const [base, lid] = [paths.base, paths.twin!];
  const flips = base.map(orient);
  const baseOutlines = base.map((p, i) => joined(p, flips[i]));
  const lidOutlines = lid.map((p, i) => joined(p, flips[i]));
  if (baseOutlines.some((o) => o.length < 3)) return [];

  // Which way the lid went: its centre against the profile's, along +z.
  const [baseMid, lidMid] = [mean(baseOutlines[0]), mean(lidOutlines[0])];
  const up = dot3(sub3(lidMid, baseMid), z) < 0 ? -1 : 1;
  const faces: Face[] = [
    { feature: f.name, kind: "base", outlines: baseOutlines, normal: z.map((c) => -up * c), centroid: baseMid, edges: baseOutlines.map(closedPath) },
    { feature: f.name, kind: "lid", outlines: lidOutlines, normal: z.map((c) => up * c), centroid: lidMid, edges: lidOutlines.map(closedPath) },
  ];

  const signs = outwardSigns(baseOutlines, axes);
  base.forEach((loop, i) => loop.forEach((path, j) => {
    const flip = flips[i][j];
    const b = flip ? path.slice().reverse() : path;
    const t = flip ? lid[i][j].slice().reverse() : lid[i][j];
    const cornered = hasVertices(model, f.loops[i][j]);
    const last = b.length - 1;
    for (let k = 0; k + 1 < b.length; k++) {
      const quad = [b[k], b[k + 1], t[k + 1], t[k]];
      const n = unit3(cross3(sub3(b[k + 1], b[k]), z));
      if (!n) continue; // a piece of no length faces nowhere
      // The wall line at a profile vertex is an edge; a seam between two
      // pieces of one curved wall is not.
      const edges = [[b[k], b[k + 1]], [t[k], t[k + 1]]];
      if (cornered && k === 0) edges.push([b[0], t[0]]);
      if (cornered && k + 1 === last) edges.push([b[last], t[last]]);
      faces.push({ feature: f.name, kind: "wall", outlines: [quad], normal: n.map((c) => signs[i] * c), centroid: mean(quad), edges });
    }
  }));
  return faces;
}

/**
 * A revolve's faces: every piece of every profile member swept round the axis
 * in angular steps — a ring of quads per piece — and, for a partial revolve
 * only, the two caps (the profile, and the end face), each even-odd as an
 * extrude's are, so a hole in the profile turns into a tunnel and an island in
 * it into a ring inside the tunnel.
 *
 * **The steps are sized from the swept radius**: as many as `arcSegments` gives
 * the farthest point of the profile from the axis at this zoom, so the outer
 * rim of the sweep is drawn as finely as a circle of that radius would be and
 * everything nearer the axis — which turns through the same angle on a smaller
 * circle — more finely still. One step count for the whole solid, so the rings
 * of neighbouring members meet edge to edge with no crack between them.
 *
 * **Normals are the profile's, turned.** A surface of revolution's normal at a
 * point is the profile's own in-plane normal there, turned about the axis —
 * which is why the axis must lie in the profile's plane — so each quad faces
 * the way its piece of the profile faces (`outwardSigns`, extrude's rule),
 * turned to the middle of its step. A piece lying on the axis sweeps nothing
 * and is skipped; one meeting the axis at an end sweeps a fan whose quads close
 * to a point there — the solid closed on its axis, as a sphere or a cone is.
 *
 * **The caps**: the start cap faces back against the sweep, the end cap on along
 * it, turned through the angle. The angle is the dimension's; the end cap and
 * the last ring of every wall are read off the end face's live twins, so the
 * surface meets the edges drawn over it however the end face got where it is.
 */
function revolveFaces(model: Model, f: Extract<FeatureEntry, { kind: "revolve" }>, scale: number): Face[] {
  const plane = planeAxes(model, f.frame);
  if (!plane) return [];
  const theta = model.relations.get(f.angle)?.args[1];
  if (typeof theta !== "number" || !Number.isFinite(theta) || theta === 0) return [];
  const axis = axisReader(model, f.axis).read();
  const k = axis.dir;
  if (k.every((c) => c === 0)) return [];
  const partial = f.twins.length > 0;
  // A twin rim's samples start where its base's first one turns to.
  const whole = turnMatrix(k, theta);
  const turned = (p: number[]) => {
    const v = sub3(p, axis.origin);
    return [0, 1, 2].map((r) => axis.origin[r] + whole[r][0] * v[0] + whole[r][1] * v[1] + whole[r][2] * v[2]);
  };
  const paths = profilePaths(model, f.loops, partial ? f.twins : null, scale, turned);
  if (!paths) return [];
  const flips = paths.base.map(orient);
  const outlines = paths.base.map((p, i) => joined(p, flips[i]));
  if (outlines.some((o) => o.length < 3)) return [];
  const signs = outwardSigns(outlines, plane);

  // How far each point is from the axis, and so how many steps the sweep takes.
  const fromAxis = (p: number[]) => {
    const v = sub3(p, axis.origin);
    const along = dot3(v, k);
    return Math.hypot(v[0] - along * k[0], v[1] - along * k[1], v[2] - along * k[2]);
  };
  const reach = Math.max(...outlines.flat().map(fromAxis));
  const steps = arcSegments(Math.abs(theta), reach * scale);
  const turns = Array.from({ length: steps + 1 }, (_, s) => turnMatrix(k, (theta * s) / steps));
  const middles = Array.from({ length: steps }, (_, s) => turnMatrix(k, (theta * (s + 0.5)) / steps));
  const apply = (m: number[][], v: number[]) => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
  const place = (m: number[][], p: number[]) => {
    const v = apply(m, sub3(p, axis.origin));
    return [0, 1, 2].map((i) => axis.origin[i] + v[i]);
  };
  const onAxis = (p: number[]) => fromAxis(p) <= 1e-9 * Math.max(1, reach);
  const faces: Face[] = [];

  if (partial) {
    // Which way the material leaves the profile: the sweep's own direction at
    // its middle, sgn(θ)·(axis × the way out from the axis to it).
    const v = sub3(mean(outlines[0]), axis.origin);
    const along = dot3(v, k);
    const t0 = unit3(cross3(k, [0, 1, 2].map((i) => v[i] - along * k[i])));
    if (!t0) return [];
    const ahead = t0.map((c) => Math.sign(theta) * c);
    const endOutlines = paths.twin!.map((p, i) => joined(p, flips[i]));
    faces.push({ feature: f.name, kind: "base", outlines, normal: ahead.map((c) => -c), centroid: mean(outlines[0]), edges: outlines.map(closedPath) });
    faces.push({ feature: f.name, kind: "end", outlines: endOutlines, normal: apply(turns[steps], ahead), centroid: mean(endOutlines[0]), edges: endOutlines.map(closedPath) });
  }

  paths.base.forEach((loop, i) => loop.forEach((path, j) => {
    const flip = flips[i][j];
    const b = flip ? path.slice().reverse() : path;
    const tw = partial ? paths.twin![i][j] : null;
    const t = tw && flip ? tw.slice().reverse() : tw;
    // The member's rings: each step's turn of it, the last the end face's own twin.
    const rings = turns.map((m, s) => (s === steps && t ? t : b.map((p) => place(m, p))));
    const cornered = hasVertices(model, f.loops[i][j]);
    const last = b.length - 1;
    for (let q = 0; q + 1 < b.length; q++) {
      const n = unit3(cross3(sub3(b[q + 1], b[q]), plane.n));
      if (!n || (onAxis(b[q]) && onAxis(b[q + 1]))) continue; // no length, or on the axis: it sweeps nothing
      const out = n.map((c) => signs[i] * c);
      for (let s = 0; s < steps; s++) {
        const quad = [rings[s][q], rings[s][q + 1], rings[s + 1][q + 1], rings[s + 1][q]];
        // A vertex's sweep is an edge — the circle a box's corner turns
        // through is where two of the revolve's surfaces meet — and so are the
        // caps' outlines; a seam between two steps, or two pieces of a curve,
        // is the tessellation and is not.
        const edges: number[][][] = [];
        if (partial && s === 0) edges.push([rings[0][q], rings[0][q + 1]]);
        if (partial && s === steps - 1) edges.push([rings[steps][q], rings[steps][q + 1]]);
        if (cornered && q === 0 && !onAxis(b[0])) edges.push([rings[s][0], rings[s + 1][0]]);
        if (cornered && q + 1 === last && !onAxis(b[last])) edges.push([rings[s][last], rings[s + 1][last]]);
        faces.push({ feature: f.name, kind: "wall", outlines: [quad], normal: apply(middles[s], out), centroid: mean(quad), edges });
      }
    }
  }));
  return faces;
}

/**
 * Faces drawn in place of some features' own: a solid kernel's body
 * (bodies.ts), which is the boolean of its features and no longer any of
 * them alone. The faces are in the world, as `featureFaces` gives them.
 */
export interface SolidFaces {
  faces: readonly Face[];
  replaces: ReadonlySet<string>;
}

/** A face that faces the viewer, in the world, with its headlight shade. */
export interface VisibleFace extends Face {
  /** Lambert's cosine against the line of sight: 0 edge-on, 1 square to the viewer. */
  shade: number;
}

/**
 * Every face of every solid that faces the viewer, in the world, each with its
 * headlight shade — in no particular order, because nothing that draws them by
 * depth needs one. A face whose outward normal points away from the viewer is
 * behind its own solid and is left out. `skip` names features whose faces are
 * someone else's to draw just now — the edit dialog's preview stands in for the
 * feature it edits — and which so hide nothing either.
 */
export function visibleFaces(model: Model, view: View, skip: ReadonlySet<string> = new Set(),
                             solid: SolidFaces | null = null): VisibleFace[] {
  const { toward } = viewAxes(view);
  const out: VisibleFace[] = [];
  // A body the solid kernel built (bodies.ts) stands in for its features: its
  // faces are the kernel's triangles, culled and lit exactly as these are.
  for (const face of solid?.faces ?? []) {
    const shade = dot3(face.normal, toward);
    if (shade > 1e-9) out.push({ ...face, shade: Math.min(1, shade) });
  }
  for (const f of model.features.values()) {
    // A hidden feature has no faces on screen — and so hides nothing behind
    // them either, since occlusion is asked of these same faces.
    if (model.hidden.has(f.name) || skip.has(f.name) || solid?.replaces.has(f.name)) continue;
    let faces: Face[];
    try {
      faces = featureFaces(model, f, view.scale);
    } catch {
      continue; // the render loop's rule: one solid's trouble costs its own faces
    }
    for (const face of faces) {
      const shade = dot3(face.normal, toward);
      if (shade > 1e-9) out.push({ ...face, shade: Math.min(1, shade) });
    }
  }
  return out;
}

/**
 * The painter's: every visible face projected, far to near by its centroid —
 * what the fallback fills where there is no WebGL (facelayer.ts's
 * `paintFaces`). The plainest key, and a sort, so it is wrong where any sort
 * is: solids that pass through each other, a sweep that wraps round in front
 * of its own cap, a cap seen at a grazing angle past its own hole's far wall.
 * The depth layer is right in all three; this exists so a browser without
 * WebGL still sees solids.
 */
export function facesToDraw(model: Model, view: View, skip: ReadonlySet<string> = new Set(),
                            solid: SolidFaces | null = null): DrawnFace[] {
  return visibleFaces(model, view, skip, solid)
    .map((face) => ({ face, depth: depth(view, face.centroid) }))
    .sort((a, b) => a.depth - b.depth)
    .map(({ face, depth }) => ({
      feature: face.feature,
      kind: face.kind,
      outlines: face.outlines.map((o) => o.map((w) => worldToScreen(view, w))),
      edges: face.edges.map((e) => e.map((w) => worldToScreen(view, w))),
      shade: face.shade,
      depth,
    }));
}

/**
 * The surface tones a face is filled with, edge-on to square to the viewer: a
 * body tone from a mid slate to a light grey-blue, well clear of the
 * near-black background (#0a0e13) at both ends — the owner: "when you extrude
 * a solid, it should look like a solid". The faces used to be the panels' own
 * dark slate, kept under the edges' ink so the drawing read on top, which is
 * what made a solid read as tinted glass. Measured against the background
 * (WCAG contrast): 2.6:1 edge-on, 12.4:1 square-on, 5–9:1 for the faces of a
 * box seen from a corner — and those faces against each other 1.3–1.8:1,
 * where the old range gave 1.1–1.3:1 (CHANGELOG, 2026-11-02).
 */
export const FACE_DARK = [72, 86, 102];
export const FACE_LIGHT = [196, 208, 222];

/**
 * The ink a solid's own edges are drawn in over its faces — its profile, the
 * lid's twins, the walls — as Onshape draws a part's edges dark on a light
 * body, so the shape reads even where two faces shade alike. Chosen with the
 * face tones: 4:1 or better against every face of the corner view above.
 *
 * Drawn by the face layer, as part of the solid, along every face's `edges`
 * (facelayer.ts) — the solid's edges are quiet sketch geometry in the shaded
 * view (quiet.ts), so this line is what outlines the body there; the entity
 * pass inks an edge in it too where it draws one (the hidden view, or an edge
 * revealed but not lit).
 */
export const SOLID_EDGE = "#1b2530";

/**
 * How wide the face layer draws that line, in CSS pixels: fine — an outline of
 * the body, a little under the 1.4 px the entity pass strokes sketch geometry
 * at, so a hovered edge drawn over it covers it whole.
 */
export const SOLID_EDGE_PX = 1.2;

/**
 * The fill for a face of this shade, as three bytes — straight along the range,
 * so the whole of it goes to telling one plane from the next; the dark end is
 * itself well off the background, so an edge-on face is still a face. Whole
 * numbers on purpose: both renderers write exactly these, so a test can ask a
 * pixel for them.
 */
export function faceRGB(shade: number): number[] {
  const t = Math.max(0, Math.min(1, shade));
  return FACE_DARK.map((d, i) => Math.round(d + (FACE_LIGHT[i] - d) * t));
}

/** `faceRGB` as a canvas fill style. */
export function faceColour(shade: number): string {
  const [r, g, b] = faceRGB(shade);
  return `rgb(${r}, ${g}, ${b})`;
}
