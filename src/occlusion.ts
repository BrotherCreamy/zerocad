// Which parts of the drawing lie behind a solid's faces — a question asked of
// the faces, on the CPU, one screen point at a time.
//
// The depth layer (facelayer.ts) answers "which face is in front" for every
// pixel, but it answers on the GPU, into a picture, and nothing on the 2D
// canvas can read that back without stalling the frame. So the 2D drawing —
// edges, points, names, glyphs, frame markers — asks here instead, and what it
// does with the answer is the view mode's (viewmode.ts). **Shaded**, the
// default, a solid is opaque — the owner: "when you extrude a solid, it should
// look like a solid" / "It should be opaque" — so what is behind a face is not
// drawn, and the pick, the snapper and box select ask the *same* `Occlusion`
// (`inSight`) so nothing invisible is ever under the hand. **Hidden** draws
// it all and dims the ink of what is behind, the way a drafting convention
// draws a hidden line (`inkRuns`, `hiddenInk`), with everything still
// aimable. A pure function of the faces and the view, as faces.ts is, so it is
// tested in Node — and it is also the e2e suite's oracle for the depth layer's
// picture (`nearestFace`, `outlineDistance`), so the app and the test that
// grades the renderer ask one implementation the same question.
//
// **The method** is the oracle's, lifted: every visible face's outlines
// projected once a frame with their screen box, so most (face, point) pairs
// are thrown out by four comparisons; then an even-odd inside test across all
// of a face's outlines (a cap's holes are holes here as on screen); then the
// plane.
//
// **"Behind" is measured square to the face's plane, not along the ray.** An
// edge lies *in* the faces it bounds — exactly, for a straight edge, and to
// within the quarter-pixel its curve is drawn to for a curved one (the face's
// outline and the drawn polyline sample the same curve at possibly different
// angles). Along the ray that small error is magnified by 1 / cos of the angle
// the face is seen at, so a face seen nearly edge-on would hide its own
// boundary; square to the plane it is the quarter-pixel it is, at any angle.
// So a point is hidden when some visible face covers its pixel and the point is
// behind that face's plane by more than `SLACK_PX` pixels' worth of world
// (twice the curves' quarter-pixel). For a visible face (n · toward > 0) the
// two measures have the same sign — depth along the ray is −distance / cos —
// so this is "a face is nearer the viewer", with the tolerance applied where
// it is well conditioned. What it gives up: a face seen within a hair of
// edge-on, a sliver a pixel wide, hides only what is well behind it.
//
// **Edges are sampled, not solved.** `inkRuns` walks a polyline in world
// coordinates — a line's two ends, a curve's drawn samples — at least every
// `SAMPLE_PX` pixels on screen, asks each sample, and joins consecutive samples
// with the same answer into one run. Where the answer changes, the seam is put
// half-way between the two samples on screen: within half a sample spacing of
// the true crossing, which is finer than the convention needs and bounded
// whatever the geometry (tested). No crossing is ever solved for, so nothing
// here needs to know what kind of curve it is walking.

import { faceRGB } from "./faces.ts";
import { dot3, lift3 } from "./vec3.ts";
import { viewAxes, worldToScreen, type View } from "./view.ts";

/** What occlusion needs of a face: closed planar outlines in the world, and its outward unit normal. */
export interface PlanarFace {
  outlines: number[][][];
  normal: number[];
}

/** A face as occlusion asks about it, projected for this frame. */
export interface Occluder {
  /** The outlines on screen. */
  screen: [number, number][][];
  /** Their screen box: left, top, right, bottom. */
  box: [number, number, number, number];
  normal: number[];
  /** `normal · x` for every point x of the plane. */
  offset: number;
  /** `normal · toward`: positive for a face that faces the viewer. */
  facing: number;
}

/** The faces of one frame, ready to be asked about: what `occlusion` builds. */
export interface Occlusion {
  view: View;
  /** In the order the faces were given, so an index names the same face as in that list. */
  faces: Occluder[];
}

/** Pixels on screen between an edge's samples, at most. */
export const SAMPLE_PX = 4;

/**
 * How far behind a face's plane, in pixels' worth of world, a point must be
 * before the face hides it: twice the quarter-pixel curves are drawn to, so a
 * curved edge's drawn polyline is never hidden by the strip it bounds.
 */
export const SLACK_PX = 0.5;

/**
 * The faces projected for `view`. Faces turned away from the viewer are left
 * out of what hides things — a back face is behind its own solid — but keep
 * their place in the list, so an index means the same face it meant to the
 * caller.
 */
export function occlusion(faces: readonly PlanarFace[], view: View): Occlusion {
  const { toward } = viewAxes(view);
  return {
    view,
    faces: faces.map((f) => {
      const screen = f.outlines.map((o) => o.map((w) => worldToScreen(view, w)));
      let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const o of screen) for (const [x, y] of o) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      const normal = lift3(f.normal);
      return { screen, box: [x0, y0, x1, y1], normal, offset: dot3(normal, lift3(f.outlines[0][0])), facing: dot3(normal, toward) };
    }),
  };
}

/** Even-odd across every outline of the face: inside an odd number of them. */
export function covers(f: Occluder, x: number, y: number): boolean {
  if (x < f.box[0] || x > f.box[2] || y < f.box[1] || y > f.box[3]) return false;
  let odd = false;
  for (const o of f.screen) {
    for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
      const [a, b] = [o[i], o[j]];
      if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) odd = !odd;
    }
  }
  return odd;
}

/**
 * How near the viewer the face's plane is under the pixel (x, y) — `depth`'s
 * measure, larger nearer: where the pixel's ray, through the depth-zero point
 * under it along `toward`, crosses the plane.
 */
export function depthAt(occ: Occlusion, f: Occluder, x: number, y: number): number {
  const { right, up } = viewAxes(occ.view);
  const [a, b] = [(x - occ.view.ox) / occ.view.scale, (occ.view.oy - y) / occ.view.scale];
  const q = [0, 1, 2].map((i) => a * right[i] + b * up[i]);
  return (f.offset - dot3(f.normal, q)) / f.facing;
}

/** The face nearest the viewer at the pixel (x, y), by its index, or null where the pixel's ray meets none. */
export function nearestFace(occ: Occlusion, x: number, y: number): { index: number; depth: number } | null {
  let best: { index: number; depth: number } | null = null;
  occ.faces.forEach((f, index) => {
    if (!(f.facing > 0) || !covers(f, x, y)) return;
    const depth = depthAt(occ, f, x, y);
    if (!best || depth > best.depth) best = { index, depth };
  });
  return best;
}

/** Distance from (x, y) to the segment a–b, on screen. */
function toSegment(x: number, y: number, a: [number, number], b: [number, number]): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / len2)) : 0;
  return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
}

/**
 * How far (x, y) is from the nearest outline of any face, in pixels — asked
 * only of faces whose screen box, `reach` pixels wider all round, holds the
 * point, so the answer is exact up to `reach` and Infinity beyond it. Where a
 * picture's anti-aliasing makes any colour fair.
 */
export function outlineDistance(occ: Occlusion, x: number, y: number, reach = 3): number {
  let d = Infinity;
  for (const f of occ.faces) {
    if (!(f.facing > 0)) continue;
    if (x < f.box[0] - reach || y < f.box[1] - reach || x > f.box[2] + reach || y > f.box[3] + reach) continue;
    for (const o of f.screen) for (let i = 0; i < o.length; i++) d = Math.min(d, toSegment(x, y, o[i], o[(i + 1) % o.length]));
  }
  return d;
}

/**
 * The face of `faces` that hides `world`, at its own pixel `at` — or null when
 * none does. `faces` may be any of the frame's faces: an edge passes only the
 * ones whose boxes meet its own (see `inkRuns`).
 */
function hiderOf(occ: Occlusion, faces: readonly Occluder[], world: number[], at: [number, number]): Occluder | null {
  const p = lift3(world);
  const pixel = SLACK_PX / occ.view.scale;
  for (const f of faces) {
    if (!(f.facing > 0)) continue;
    const [x, y] = at;
    if (x < f.box[0] || x > f.box[2] || y < f.box[1] || y > f.box[3]) continue;
    // Square to the plane (see the header). A millionth of a millionth of the
    // coordinates' size too, so far from the origin the plane's own rounding
    // is not read as "behind".
    const along = dot3(f.normal, p);
    if (along - f.offset >= -(pixel + 1e-12 * (Math.abs(along) + Math.abs(f.offset)))) continue;
    if (covers(f, x, y)) return f;
  }
  return null;
}

/** Whether a face is in front of the world point — what dims the ink there, or hides it in a shaded view. */
export function hidden(occ: Occlusion, world: number[]): boolean {
  return hiderOf(occ, occ.faces, world, worldToScreen(occ.view, world)) !== null;
}

/**
 * Whether the world point can be seen, and so drawn and aimed at — the one
 * question the draw pass, `hitTest`, the snapper and box select all ask of a
 * shaded view, with the same `Occlusion`. Null is "nothing hides anything":
 * no solid, or a mode in which faces are not opaque.
 *
 * A point on the surface is in sight: an edge of a face lies in that face's
 * plane, and `SLACK_PX` square to it is what tells "on" from "behind" (see the
 * header), so a box's near corners and edges are drawn and picked while its
 * far ones are not.
 */
export function inSight(occ: Occlusion | null, world: number[]): boolean {
  return !occ || !hidden(occ, world);
}

/**
 * The parts of a polyline that can be seen, as screen polylines — `inkRuns`
 * with the hidden runs dropped. What box select tests a partly hidden edge
 * against, so a box catches an edge by its visible part only. With no
 * occlusion, the whole polyline.
 */
export function visibleRuns(occ: Occlusion | null, view: View, world: number[][], closed = false): [number, number][][] {
  if (!occ) return [world.map((w) => worldToScreen(view, w))];
  return inkRuns(occ, world, closed).filter((r) => !r.hidden).map((r) => r.points);
}

/** A stretch of an edge inked one way: its screen polyline, and whether a face is in front of it. */
export interface Run {
  hidden: boolean;
  points: [number, number][];
}

/**
 * A polyline in the world — a line's two ends, a curve's drawn samples — cut
 * into runs of hidden and not, on screen. Sampled at every vertex and at least
 * every `SAMPLE_PX` pixels between; a run's points are the polyline's own
 * vertices plus its two seams, so a run drawn is the polyline drawn, only
 * shorter. `closed` (a circle, whose last sample is its first) joins a run that
 * crosses the start back into one.
 *
 * With no faces, or none in front of any sample, the answer is one run of the
 * whole polyline, not hidden.
 */
export function inkRuns(occ: Occlusion, world: number[][], closed = false): Run[] {
  const view = occ.view;
  const screen = world.map((w) => worldToScreen(view, w));
  // Only faces whose boxes meet the edge's can hide any of it — asked once an
  // edge, not once a sample: on a full turn of hundreds of strips most of them
  // are nowhere near any one edge.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of screen) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const near = occ.faces.filter((f) => f.facing > 0 && f.box[0] <= x1 && f.box[2] >= x0 && f.box[1] <= y1 && f.box[3] >= y0);
  const runs: Run[] = [];
  let run: Run | null = null;
  let prev: { at: [number, number]; hidden: boolean } | null = null;
  const visit = (w: number[], at: [number, number], vertex: boolean) => {
    const h = near.length > 0 && hiderOf(occ, near, w, at) !== null;
    if (!run) {
      run = { hidden: h, points: [at] };
      runs.push(run);
    } else if (h !== run.hidden) {
      // The seam, half-way between the two samples that disagree.
      const seam: [number, number] = [(prev!.at[0] + at[0]) / 2, (prev!.at[1] + at[1]) / 2];
      run.points.push(seam);
      run = { hidden: h, points: [seam] };
      runs.push(run);
      if (vertex) run.points.push(at);
    } else if (vertex) {
      run.points.push(at);
    }
    prev = { at, hidden: h };
  };
  for (let i = 0; i < world.length; i++) {
    if (i > 0) {
      // Between two vertices, enough samples that none is more than SAMPLE_PX
      // from the next on screen.
      const [a, b] = [screen[i - 1], screen[i]];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / SAMPLE_PX);
      const [wa, wb] = [lift3(world[i - 1]), lift3(world[i])];
      for (let k = 1; k < n; k++) {
        const t = k / n;
        visit(wa.map((x, c) => x + t * (wb[c] - x)), [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], false);
      }
    }
    visit(world[i], screen[i], true);
  }
  if (closed && runs.length > 1 && runs[0].hidden === runs[runs.length - 1].hidden) {
    const last = runs.pop()!;
    runs[0].points = [...last.points, ...runs[0].points.slice(1)];
  }
  return runs;
}

/**
 * The ink of an edge behind a face: its own colour taken most of the way down
 * to the faces' ground — the middle of their tones — so it reads as "behind"
 * whatever it was: a plain edge goes grey-blue, a lit (amber) one stays amber,
 * only duller. A solid colour rather than transparency, so a hidden run is the
 * same ink over any face and a test can ask a pixel for it.
 */
export function hiddenInk(css: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css);
  if (!m) return css;
  const rgb = [m[1], m[2], m[3]].map((h, i) => Math.round(HIDDEN_KEEP * parseInt(h, 16) + (1 - HIDDEN_KEEP) * GROUND[i]));
  return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
}

/** How much of its own colour a hidden edge keeps; the rest is the faces' ground. */
export const HIDDEN_KEEP = 0.4;

/** The faces' ground: the fill of a face seen half-on, the middle of their tones. */
const GROUND = faceRGB(0.5);
