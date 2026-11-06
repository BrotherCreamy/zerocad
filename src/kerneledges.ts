// A kernel body's edges as things a hand aims at (docs/plans/solid-fillets.md):
// which edge is under a pixel, which a box holds, which run on smoothly from
// one, which bound a face — and what the hover tag says of one.
//
// **An edge is its name.** The kernel names an edge by the two faces it lies
// between (`e1.lid|e1.m0`, src/solids/naming.ts), and that name survives a
// rebuild that keeps those faces, so it is what a selection, a hover and a
// fillet's record hold. The pieces of a split face share a name, so an edge
// name can answer to several kernel edges; picking one picks the name, and a
// fillet of it rounds them all — one edge as far as anyone can tell.
//
// Pure, above the model beside bodies.ts: it reads a body's last answer
// (`BodyView`) and the view, and nothing of the Worker. Screen space, as every
// pick is (picking.ts), so the reach is pixels whatever the zoom; and asked
// through the frame's occlusion answer, so an edge behind a face is neither
// drawn nor picked (occlusion.ts) — on the surface is not behind.

import type { BodyView } from "./bodies.ts";
import { PICK_LINE } from "./picking.ts";
import { inSight, visibleRuns, type Occlusion } from "./occlusion.ts";
import type { BoxMode, ScreenRect } from "./boxselect.ts";
import { worldToScreen, type View } from "./view.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

export interface EdgeHit {
  /** The body's name — its first feature's. */
  body: string;
  /** The kernel edge's index in the body's answer, and its name. */
  edge: number;
  name: string;
  /** Screen pixels from the cursor. */
  distance: number;
  /** The place on it nearest the cursor, in the world. */
  at: number[];
}

/** An edge's samples, as world points. */
export function edgePoints(v: BodyView, edge: number): number[][] {
  const line = v.result.solid?.lines.find((l) => l.edge === edge);
  if (!line) return [];
  const out: number[][] = [];
  for (let i = 0; i < line.points.length / 3; i++) out.push([line.points[i * 3], line.points[i * 3 + 1], line.points[i * 3 + 2]]);
  return out;
}

/** Every edge of the shape — a seam is none (naming.ts) — with its samples. */
function shapeEdges(v: BodyView): { edge: number; name: string; pts: number[][] }[] {
  const s = v.result.solid;
  if (!s) return [];
  const out: { edge: number; name: string; pts: number[][] }[] = [];
  for (const line of s.lines) {
    const e = s.edges[line.edge];
    if (!e || e.name.endsWith(":seam")) continue;
    const pts = edgePoints(v, line.edge);
    if (pts.length > 1) out.push({ edge: line.edge, name: e.name, pts });
  }
  return out;
}

/**
 * The kernel edge under (sx, sy), nearest first, within a line's reach
 * (`PICK_LINE`, times a finger's `reach`) — or null. Only where the place on
 * it nearest the cursor is in sight, as `hitTest` asks of a line.
 */
export function edgeAt(views: readonly BodyView[], view: View, sx: number, sy: number,
  occ: Occlusion | null = null, reach = 1, hidden: ReadonlySet<string> = new Set()): EdgeHit | null {
  const r = PICK_LINE * reach;
  let best: EdgeHit | null = null;
  for (const v of views) {
    if (hidden.has(v.name)) continue;
    for (const e of shapeEdges(v)) {
      const scr = e.pts.map((p) => worldToScreen(view, p));
      for (let i = 0; i + 1 < scr.length; i++) {
        const [a, b] = [scr[i], scr[i + 1]];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len2 = dx * dx + dy * dy;
        const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((sx - a[0]) * dx + (sy - a[1]) * dy) / len2));
        const d = Math.hypot(sx - (a[0] + t * dx), sy - (a[1] + t * dy));
        if (d >= r || (best && d >= best.distance)) continue;
        // Orthographic: the fraction along the segment on screen is the fraction in the world.
        const at = e.pts[i].map((c, k) => c + t * (e.pts[i + 1][k] - c));
        if (!inSight(occ, at)) continue;
        best = { body: v.name, edge: e.edge, name: e.name, distance: d, at };
      }
    }
  }
  return best;
}

/**
 * The names of the kernel edges a selection box holds: in a window, every
 * edge whose seen part lies wholly inside; in a crossing, any edge whose seen
 * part touches it — box select's two rules (boxselect.ts), for edges.
 */
export function edgesInBox(views: readonly BodyView[], view: View, rect: ScreenRect, mode: BoxMode,
  occ: Occlusion | null = null, hidden: ReadonlySet<string> = new Set()): string[] {
  const inside = ([x, y]: [number, number]) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
  const out = new Set<string>();
  for (const v of views) {
    if (hidden.has(v.name)) continue;
    for (const e of shapeEdges(v)) {
      const runs = visibleRuns(occ, view, e.pts);
      if (!runs.length) continue;
      const pts = runs.flat();
      const hit = mode === "window" ? pts.every(inside) : runs.some((run) => crossesRect(run, rect));
      if (hit) out.add(e.name);
    }
  }
  return [...out];
}

function crossesRect(run: [number, number][], rect: ScreenRect): boolean {
  const inside = ([x, y]: [number, number]) => x >= rect.x0 && x <= rect.x1 && y >= rect.y0 && y <= rect.y1;
  if (run.some(inside)) return true;
  const corners: [number, number][] = [[rect.x0, rect.y0], [rect.x1, rect.y0], [rect.x1, rect.y1], [rect.x0, rect.y1]];
  for (let i = 0; i + 1 < run.length; i++) {
    for (let k = 0; k < 4; k++) if (segmentsCross(run[i], run[i + 1], corners[k], corners[(k + 1) % 4])) return true;
  }
  return false;
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const side = (p: [number, number], q: [number, number], r: [number, number]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const [d1, d2, d3, d4] = [side(c, d, a), side(c, d, b), side(a, b, c), side(a, b, d)];
  return d1 * d2 <= 0 && d3 * d4 <= 0;
}

// ---- tangent chains -------------------------------------------------------------

/**
 * The unit tangent of a sampled curve at one end, pointing into the curve:
 * from the circle through the end and the next two samples, which is exact for
 * a line and for an arc (every edge a sweep of lines and arcs makes) and within
 * a fraction of the sampling's turn for anything else; the chord where the
 * three are in line.
 */
function endTangent(pts: number[][], atStart: boolean): number[] | null {
  const seq = atStart ? pts : [...pts].reverse();
  if (seq.length < 2) return null;
  const [a, b] = [seq[0], seq[1]];
  const chord = unit3(sub3(b, a));
  if (seq.length < 3 || !chord) return chord;
  const c = seq[2];
  const u = sub3(b, a), w = sub3(c, a);
  const n = cross3(u, w);
  const nn = dot3(n, n);
  if (nn < 1e-18 * Math.max(1e-30, dot3(u, u) * dot3(w, w))) return chord;
  // The circle's centre through a, b, c, relative to a; the tangent at a is square to the radius, in the plane.
  const centre = [0, 1, 2].map((i) => (dot3(w, w) * cross3(n, u)[i] + dot3(u, u) * cross3(w, n)[i]) / (2 * nn));
  const t = unit3(cross3(n, centre));
  if (!t) return chord;
  // Pointing along the curve, toward b.
  return dot3(t, u) >= 0 ? t : t.map((x) => -x);
}

/** How far apart two tangents may be and still be one smooth run: half a degree. */
export const TANGENT_TOL = Math.sin((0.5 * Math.PI) / 180);

/**
 * The edges that run on smoothly from `start` — tangent where they meet, end
 * to end, across any number of edges — `start` first, by name. What a click
 * on one edge of a rounded outline takes when tangent chains are on: the
 * whole run, as every CAD tool's fillet does. A seam is never part of one.
 */
export function tangentChain(v: BodyView, start: string): string[] {
  const edges = shapeEdges(v);
  const s = v.result.solid;
  if (!s) return [start];
  const size = Math.hypot(...sub3(s.box[1], s.box[0])) || 1;
  const near = 1e-6 * size;
  interface End { e: number; p: number[]; t: number[] }
  const ends: End[] = [];
  edges.forEach((e, i) => {
    const t0 = endTangent(e.pts, true), t1 = endTangent(e.pts, false);
    if (t0) ends.push({ e: i, p: e.pts[0], t: t0 });
    if (t1) ends.push({ e: i, p: e.pts[e.pts.length - 1], t: t1 });
  });
  const taken = new Set<number>();
  const queue = edges.flatMap((e, i) => (e.name === start ? [i] : []));
  for (const i of queue) taken.add(i);
  while (queue.length) {
    const i = queue.shift()!;
    for (const mine of ends.filter((x) => x.e === i)) {
      for (const other of ends) {
        if (taken.has(other.e) || Math.hypot(...sub3(mine.p, other.p)) > near) continue;
        // Into each curve from the shared end: smooth when they point opposite ways.
        const c = cross3(mine.t, other.t);
        if (dot3(mine.t, other.t) < 0 && Math.hypot(...c) <= TANGENT_TOL) {
          taken.add(other.e);
          queue.push(other.e);
        }
      }
    }
  }
  const names = [start];
  for (const i of [...taken].sort((a, b) => a - b)) if (!names.includes(edges[i].name)) names.push(edges[i].name);
  return names;
}

/** Every edge of the shape that bounds the kernel face `face`, by name — what a click on a face takes. */
export function faceEdges(v: BodyView, face: number): string[] {
  const s = v.result.solid;
  if (!s) return [];
  const out: string[] = [];
  for (const e of s.edges) {
    if (e.name.endsWith(":seam") || !e.faces.includes(face)) continue;
    if (!out.includes(e.name)) out.push(e.name);
  }
  return out;
}

/** Every edge of the shape, by name — what a click on a body's row (or a body, typed) takes. */
export function bodyEdges(v: BodyView): string[] {
  return [...new Set(shapeEdges(v).map((e) => e.name))];
}

/** An edge's length, summed over every kernel edge with its name. */
export function edgeLength(v: BodyView, name: string): number {
  let len = 0;
  for (const e of shapeEdges(v)) {
    if (e.name !== name) continue;
    for (let i = 0; i + 1 < e.pts.length; i++) len += Math.hypot(...sub3(e.pts[i + 1], e.pts[i]));
  }
  return len;
}

/**
 * The hover tag for an edge: its name, whose edge it is, how long, and the
 * fillets and chamfers that round it — `e1.lid|e1.m0  edge of e1  len 100  ·  e3`.
 * The name is the thing to type: `fillet("e1", ["e1.lid|e1.m0"], 3)`.
 */
export function describeEdge(v: BodyView, name: string, roundedBy: readonly string[] = []): string {
  const n = Math.round(edgeLength(v, name) * 1000) / 1000;
  return `${name}  edge of ${v.name}  len ${n}${roundedBy.length ? `  ·  ${roundedBy.join(" ")}` : ""}`;
}
