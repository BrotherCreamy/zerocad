// A plane to sketch on from a face the solid kernel made, which no loop of the
// model's entities bounds (docs/plans/sketch-mode.md).
//
// Most of a body's flat faces are loops of real points — a lid is its profile's
// twin, a wall a quad of an edge and its twin — and the engine maps a flat
// kernel face to that loop first (`ToolEngine.regionAt`), so a sketch on it is
// held by the feature's own points and follows the solid. **A chamfer's flat
// face has none**: the kernel made it, and nothing in the model is on it. This
// is the one question that face needs answered — where its plane is — read off
// the body's last answer (`BodyView`, bodies.ts): its triangles, outward.
//
// The sketch tool then makes a **frame there** (`frame(pt(o), pt(o + u),
// pt(o + v))`) and sets the work plane to it, in one typed line — a plain
// frame, not a feature, so it sits in no feature list. It does not follow the
// solid: the face has no model points to be held by, and that is written down
// in the register as the decision it is.
//
// Pure, beside kerneledges.ts at bodies.ts's height: a body view and a face
// index in, numbers out. Picking a solid's faces for anything else — a
// dimension, a selection — is not this file's.

import type { BodyView } from "./bodies.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

/** A kernel face's plane: a point on it, its in-plane axes, and its normal facing the viewer — unit, three coordinates each. */
export interface KernelPlane {
  origin: number[];
  u: number[];
  v: number[];
  n: number[];
}

/** How far a triangle's normal may turn from the face's and the face still be flat: a part in a million. */
const FLAT_COS = 1 - 1e-6;

/**
 * The plane of kernel face `face` of `body`, facing the side of `toward` (the
 * line of sight back at the viewer), or null when the face is not flat — a
 * fillet's round, a cone — or has no triangles in this answer.
 *
 * The origin is the face's middle by area, so the frame's marker stands on
 * the face; `u` runs along the face's **longest boundary edge** (an edge of
 * exactly one of its triangles), so looking at the plane square-on shows the
 * face level, as sketch on face shows a wall (sketchface.ts) — a chamfer's
 * strip comes up as a strip, not tipped; `v` is `n × u`.
 */
export function kernelFacePlane(body: BodyView, face: number, toward: number[]): KernelPlane | null {
  const tris = body.faces.filter((t) => t.face === face);
  if (!tris.length) return null;
  const n0 = tris[0].normal;
  if (tris.some((t) => dot3(t.normal, n0) < FLAT_COS)) return null;
  const n = dot3(n0, toward) >= 0 ? unit3(n0) : unit3(n0.map((c) => -c));
  if (!n) return null;

  const key = (p: number[]) => p.map((c) => c.toFixed(9)).join(",");
  const pts = new Map<string, number[]>();
  const edges = new Map<string, { a: number[]; b: number[]; count: number }>();
  for (const t of tris) {
    const [a, b, c] = t.outlines[0];
    for (const p of [a, b, c]) pts.set(key(p), p);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const k = [key(p), key(q)].sort().join("|");
      const e = edges.get(k);
      if (e) e.count++;
      else edges.set(k, { a: p, b: q, count: 1 });
    }
  }
  // The face's own middle, by area: its vertices crowd where it meets a round
  // (the kernel tessellates the round finely), so their mean would not be.
  let area = 0;
  const sum = [0, 0, 0];
  for (const t of tris) {
    const [a, b, c] = t.outlines[0];
    const w = Math.hypot(...cross3(sub3(b, a), sub3(c, a))) / 2;
    area += w;
    for (let i = 0; i < 3; i++) sum[i] += (w * (a[i] + b[i] + c[i])) / 3;
  }
  const origin = area > 0 ? sum.map((x) => x / area) : [...pts.values()][0];
  let longest: number[] | null = null, best = 0;
  for (const e of edges.values()) {
    if (e.count !== 1) continue;
    const d = sub3(e.b, e.a);
    const len = Math.hypot(...d);
    if (len > best) { best = len; longest = d; }
  }
  // The edge, made square to the normal (a triangle's own edge is in the plane already, to rounding).
  const along = longest ? longest.map((c, i) => c - dot3(longest!, n) * n[i]) : null;
  const u = along ? unit3(along) : null;
  if (!u) return null;
  const v = unit3(cross3(n, u))!;
  return { origin, u, v, n };
}

/** A number as a typed line carries it: to a part in a million, no trailing noise. */
const num = (x: number) => String(Math.round(x * 1e6) / 1e6);

/**
 * The line the sketch tool types for a kernel face's plane: a frame at it made
 * the work plane, `workplane(frame(pt(…), pt(…), pt(…)))` — one line, so one
 * undo step, and the camera turned square to it as `workplane` turns it. The
 * frame's arms are `arm` long, which is only where its points are seeded.
 */
export function kernelPlaneCommand(plane: KernelPlane, arm = 10): string {
  const at = (p: number[]) => `pt(${p.map(num).join(", ")})`;
  const o = plane.origin;
  const x = o.map((c, i) => c + arm * plane.u[i]);
  const y = o.map((c, i) => c + arm * plane.v[i]);
  return `workplane(frame(${at(o)}, ${at(x)}, ${at(y)}))`;
}
