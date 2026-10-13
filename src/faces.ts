// The faces of a solid — read off its live geometry every frame, stored
// nowhere.
//
// An extrude is real geometry (see `extrude` in operations.ts): twins, walls
// and a depth dimension. Its *faces* are not. They are what the renderer fills
// between those pieces, recomputed from wherever the pieces are now, so a face
// can never disagree with the edges drawn over it: drag a lid corner, `set` the
// depth, and the faces are simply where the geometry is on the next frame.
//
// A pure function of (model, view), glyphs.ts's kind: no canvas, no state, and
// so testable without a browser. main.ts fills what this returns.
//
// **What a solid's faces are.** Two caps — the profile and the lid — each one
// path of every loop in the profile, filled **even-odd**, so a hole is empty
// and an island in a hole is solid with no triangulation and no rule about
// nesting anywhere. And one wall per profile member: a quad between a line and
// its twin, and between an arc or circle and its twin a ruled strip, sampled
// at the resolution the curve is drawn at (`arcSegments`), one quad per piece —
// so a curved wall shades round, piece by piece, rather than as one flat slab.
//
// **Which way a face faces** is computed, not assumed. A cap's outward normal
// is the sketch frame's +z, toward the lid for the lid and away for the
// profile. A wall's is in the sketch plane, square to its edge, on the side the
// solid is not — which side that is comes from the loop's own winding (signed
// area about +z) and how deep it is nested (inside an even number of the other
// loops, it bounds material on its inside; an odd number, a hole). Nothing
// about the order the members were found in is trusted.
//
// **Drawn back to front, back faces culled, lit from the eye.** A face whose
// outward normal points away from the viewer is behind the solid and is not
// drawn; the rest are sorted far to near — the painter's algorithm per face,
// the roadmap's promised upgrade from one depth per entity: a wall by its
// centroid, a cap by its nearest point (see `facesToDraw` for why a cap cannot
// use its centroid) — and shaded by a headlight: Lambert's cosine with the light
// along the line of sight (`toward`). Not a world light: there is no world
// frame to hang one in, and a light fixed to the kernel's axes would be the
// gauge showing through again. A face square to the viewer is brightest; one
// seen edge-on goes dark, which is what makes a turned solid read as one.
//
// **Faces are display only.** They never pick, snap, box or wear a glyph —
// the entities do all of that, as before, and are drawn *over* the faces so
// the sketch stays legible on a shaded solid. A click on a face is a click on
// whatever entity is near it, or on nothing.

import type { FeatureEntry, Model } from "./model.ts";
import { arcSamples, arcSegments } from "./arcgeom.ts";
import { curveFrame, framePlaneAxes } from "./curveplane.ts";
import { depth, viewAxes, worldToScreen, type View } from "./view.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";

/** One face of a solid, in the world. */
export interface Face {
  feature: string;
  kind: "base" | "lid" | "wall";
  /**
   * Closed outlines, world coordinates. A cap has one per profile loop and is
   * filled even-odd; a wall piece has one, a quad.
   */
  outlines: number[][][];
  /** Outward, unit length. */
  normal: number[];
  /** Where it is, for the painter's sort: the mean of its outline's points (a cap's, the outer loop's). */
  centroid: number[];
}

/** A face as it is to be filled this frame. */
export interface DrawnFace {
  feature: string;
  kind: Face["kind"];
  /** Screen outlines, one subpath each, filled even-odd. */
  outlines: [number, number][][];
  /** Lambert's cosine against the line of sight: 0 edge-on, 1 square to the viewer. */
  shade: number;
  /**
   * What it sorts by, larger nearer; the list is ascending. A wall's centroid,
   * a cap's nearest point — see `facesToDraw`.
   */
  depth: number;
}

/**
 * A member's points in its own direction — a line's two ends, an arc or
 * circle sampled as it is drawn (`segments` forces the count, so a twin is
 * sampled piece for piece with its base). Null if it cannot be laid out.
 */
function memberPath(model: Model, name: string, scale: number, segments?: number): number[][] | null {
  const e = model.entities.get(name);
  if (!e) return null;
  if (e.kind === "line") return [lift3(model.coords(e.refs[0])), lift3(model.coords(e.refs[1]))];
  const f = curveFrame(model, e);
  if (!f) return null;
  return arcSamples(f, segments ?? arcSegments(f.sweep, f.r * scale));
}

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
 * region with, as well as what a cap is filled with.
 */
export function loopOutlines(model: Model, loops: string[][], scale: number): number[][][] {
  return loops.map((names) => {
    const paths = names.map((n) => memberPath(model, n, scale)).filter((p): p is number[][] => p !== null);
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
  // A revolve's surface is not finitely many entities, and is drawn from the
  // live profile — the display half, not yet built. Until then it draws as the
  // wireframe it is made of: the profile and, partway, the end face.
  if (f.kind !== "extrude") return [];
  const axes = framePlaneAxes(model, f.frame);
  if (!axes) return [];
  const z = axes.n;
  const base: number[][][][] = [];
  const lid: number[][][][] = [];
  for (let i = 0; i < f.loops.length; i++) {
    const b: number[][][] = [];
    const t: number[][][] = [];
    for (let k = 0; k < f.loops[i].length; k++) {
      const bp = memberPath(model, f.loops[i][k], scale);
      if (!bp) return [];
      // The twin sampled piece for piece with its base, so a wall's quads pair up.
      const tp = memberPath(model, f.twins[i][k], scale, bp.length - 1);
      if (!tp || tp.length !== bp.length) return [];
      b.push(bp);
      t.push(tp);
    }
    base.push(b);
    lid.push(t);
  }
  const flips = base.map(orient);
  const baseOutlines = base.map((paths, i) => joined(paths, flips[i]));
  const lidOutlines = lid.map((paths, i) => joined(paths, flips[i]));
  if (baseOutlines.some((o) => o.length < 3)) return [];

  // Which way the lid went: its centre against the profile's, along +z.
  const [baseMid, lidMid] = [mean(baseOutlines[0]), mean(lidOutlines[0])];
  const up = dot3(sub3(lidMid, baseMid), z) < 0 ? -1 : 1;
  const faces: Face[] = [
    { feature: f.name, kind: "base", outlines: baseOutlines, normal: z.map((c) => -up * c), centroid: baseMid },
    { feature: f.name, kind: "lid", outlines: lidOutlines, normal: z.map((c) => up * c), centroid: lidMid },
  ];

  // Each loop's winding about +z and its nesting, read flat in the sketch plane.
  const origin = baseOutlines[0][0];
  const flat = baseOutlines.map((o) => flatten(o, origin, axes.u, axes.v));
  baseOutlines.forEach((_, i) => {
    const winding = signedArea(flat[i]) < 0 ? -1 : 1;
    // Nesting from a point *on* the loop (a segment's midpoint), so a loop
    // touching another at a vertex is not miscounted at the touch.
    const [a, b] = [flat[i][0], flat[i][1]];
    const probe: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const depthIn = flat.reduce((n, other, k) => n + (k !== i && inPolygon(other, probe) ? 1 : 0), 0);
    // Material on the loop's left (counter-clockwise, not a hole) puts the
    // outside on its right, which is edge × +z.
    const outward = winding * (depthIn % 2 === 0 ? 1 : -1);
    base[i].forEach((path, j) => {
      const flip = flips[i][j];
      const b = flip ? path.slice().reverse() : path;
      const t = flip ? lid[i][j].slice().reverse() : lid[i][j];
      for (let k = 0; k + 1 < b.length; k++) {
        const quad = [b[k], b[k + 1], t[k + 1], t[k]];
        const n = unit3(cross3(sub3(b[k + 1], b[k]), z));
        if (!n) continue; // a piece of no length faces nowhere
        faces.push({ feature: f.name, kind: "wall", outlines: [quad], normal: n.map((c) => outward * c), centroid: mean(quad) });
      }
    });
  });
  return faces;
}

/**
 * Every face to fill this frame, far to near, back faces culled, each with its
 * headlight shade. See the top of the file.
 */
export function facesToDraw(model: Model, view: View): DrawnFace[] {
  const { toward } = viewAxes(view);
  const out: DrawnFace[] = [];
  for (const f of model.features.values()) {
    let faces: Face[];
    try {
      faces = featureFaces(model, f, view.scale);
    } catch {
      continue; // the render loop's rule: one solid's trouble costs its own faces
    }
    for (const face of faces) {
      const shade = dot3(face.normal, toward);
      if (!(shade > 1e-9)) continue;
      // A wall sorts by its centroid. A cap that survives culling is the
      // solid's *front* cap, and nothing of its own solid is in front of its
      // plane — every point of a prism is a cap point moved back along the
      // depth — so it sorts by its nearest point, which is never behind any of
      // its own walls. By centroid, a cap seen at a grazing angle sorted behind
      // the far wall of its own hole, and that wall painted over the cap
      // wherever it showed past the opening (seen in a screenshot, not a test).
      const key = face.kind === "wall"
        ? depth(view, face.centroid)
        : Math.max(...face.outlines.flat().map((w) => depth(view, w)));
      out.push({
        feature: face.feature,
        kind: face.kind,
        outlines: face.outlines.map((o) => o.map((w) => worldToScreen(view, w))),
        shade: Math.min(1, shade),
        depth: key,
      });
    }
  }
  return out.sort((a, b) => a.depth - b.depth);
}

/**
 * The surface tones a face is filled with, darkest (edge-on) to lightest
 * (square to the viewer): the slate the app's panels and borders are already
 * made of, kept well below the edges' `#afc6d9` and the labels' `#cfe0ee` so
 * the drawing stays the foreground on a shaded solid.
 */
export const FACE_DARK = [22, 31, 42];
export const FACE_LIGHT = [66, 88, 108];

/** The fill for a face of this shade — a quarter of the way up even edge-on, so a dark face is still a face. */
export function faceColour(shade: number): string {
  const t = 0.25 + 0.75 * Math.max(0, Math.min(1, shade));
  const [r, g, b] = FACE_DARK.map((d, i) => Math.round(d + (FACE_LIGHT[i] - d) * t));
  return `rgb(${r}, ${g}, ${b})`;
}
