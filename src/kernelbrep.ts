// A body the solid kernel built, as the exact B-rep STEP writes
// (solids.ts's `Body`, step.ts): the kernel's topology — its vertices, its
// edges and every face's loops, which no feature can say once a boolean has
// cut across them — with each face's surface the analytic one its feature
// says it is, where the feature says (`roleSurface`: a plane, a cylinder, a
// cone …), and the kernel's own NURBS where none does.
//
// **Edges are the kernel's**, spelt as plainly as they can be: a line as a
// LINE between its vertices, a circle (the kernel's, or a rational quadratic
// that is one) as a CIRCLE run the way the kernel runs it, anything else — the
// curve where a boss's cylinder meets a curved wall — as the kernel's B-spline,
// exactly, with the sense it runs.
//
// **Orientation is asked of the geometry, as solids.ts asks it.** Each face's
// outward normal comes from the kernel's tessellation (its triangles enclose
// the volume outward; bodies.ts checks the sign), and its loops are walked so
// the face is on their left about that normal — tested on an edge of the outer
// loop by stepping off it either way and asking which step lands on the face
// — never assumed from which faceuse the kernel handed over. `same_sense` is
// then the analytic surface's own normal against the outward one.
//
// Above the model like solids.ts, which it reads the features' surfaces from,
// and below step.ts, which only spells what this says.

import type { Model } from "./model.ts";
import { roleSurface, surfaceNormal, type Body, type Bound, type Curve, type Edge, type Face, type Surface, type Vertex } from "./solids.ts";
import type { BodyResult } from "./solids/evaluate.ts";
import type { NurbsCurve, Topology } from "./solids/kernel.ts";
import { tagParts } from "./solids/naming.ts";
import { curvePoint } from "./solids/nurbs.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

const dist = (a: number[], b: number[]) => Math.hypot(...sub3(a, b));

/** A circle through three points: centre and radius, or null when they are on a line. */
function circumcircle(a: number[], b: number[], c: number[]): { centre: number[]; r: number; normal: number[] } | null {
  const ab = sub3(b, a), ac = sub3(c, a);
  const n = cross3(ab, ac);
  const nn = dot3(n, n);
  if (nn < 1e-24) return null;
  const t1 = cross3(n, ab).map((x) => x * dot3(ac, ac));
  const t2 = cross3(ac, n).map((x) => x * dot3(ab, ab));
  const centre = a.map((x, i) => x + (t1[i] + t2[i]) / (2 * nn));
  return { centre, r: dist(centre, a), normal: unit3(n)! };
}

/**
 * The curve an edge lies on, run the edge's way — from its start vertex at the
 * low end of its parameter range to its end at the high: a line, a circle
 * found by sampling (every sample on one circle, to a part in a billion), or
 * the kernel's B-spline as it is.
 */
function edgeCurve(e: Topology["edges"][number], at: (i: number) => number[], size: number): Curve {
  const c = e.curve;
  if (!c || c.kind === "line") return { kind: "line" };
  const [lo, hi] = e.range;
  const ts = [0, 0.17, 0.41, 0.63, 0.89].map((f) => lo + f * (hi - lo));
  const pts = ts.map((t) => curvePoint(c, t));
  const circle = circumcircle(pts[0], pts[2], pts[3]);
  const tol = 1e-9 * Math.max(1, size);
  if (circle && pts.every((p) => Math.abs(dist(p, circle.centre) - circle.r) < tol
    && Math.abs(dot3(sub3(p, circle.centre), circle.normal)) < tol)) {
    // The normal the way the edge turns: counter-clockwise about it from start to end.
    const turn = cross3(sub3(pts[0], circle.centre), sub3(pts[1], circle.centre));
    const normal = dot3(turn, circle.normal) >= 0 ? circle.normal : circle.normal.map((x) => -x);
    return { kind: "circle", center: circle.centre, normal, ref: unit3(sub3(pts[0], circle.centre))!, r: circle.r };
  }
  // A B-spline as the kernel gave it; whether it runs the edge's way is where its start is.
  const start = curvePoint(c, lo);
  void at;
  return { kind: "bspline", nurbs: c, sense: dist(start, at(e.start)) <= dist(start, at(e.end)) || e.start === e.end };
}

/** A point along an edge, a fraction `f` of the way from start to end, and the way it is going there. */
function along(e: Topology["edges"][number], f: number, a: number[], b: number[]): { p: number[]; t: number[] } {
  const c: NurbsCurve | null = e.curve;
  if (!c || c.kind === "line") return { p: a.map((x, i) => x + f * (b[i] - x)), t: sub3(b, a) };
  const [lo, hi] = e.range;
  const u = lo + f * (hi - lo), du = 1e-4 * (hi - lo);
  const p = curvePoint(c, u);
  return { p, t: sub3(curvePoint(c, u + du), curvePoint(c, u - du)) };
}

function pointTriangle(p: number[], a: number[], b: number[], c: number[]): number {
  // Distance from p to the triangle: to its plane if the foot is inside, else to its nearest side.
  const n = unit3(cross3(sub3(b, a), sub3(c, a)));
  if (n) {
    const h = dot3(sub3(p, a), n);
    const q = p.map((x, i) => x - h * n[i]);
    const inside = [[a, b], [b, c], [c, a]].every(([u, v]) => dot3(cross3(sub3(v, u), sub3(q, u)), n) >= -1e-12);
    if (inside) return Math.abs(h);
  }
  const seg = (u: number[], v: number[]) => {
    const d = sub3(v, u);
    const l2 = dot3(d, d);
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot3(sub3(p, u), d) / l2));
    return dist(p, u.map((x, i) => x + t * d[i]));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

/** A body the kernel built, exactly, for STEP. `name` is the body's (its first feature's). */
export function kernelBody(model: Model, name: string, topo: Topology, result: BodyResult): Body {
  const s = result.solid;
  if (!s) throw new Error(`${name} has no solid to export`);
  const size = Math.hypot(...sub3(s.box[1], s.box[0]));
  const vertices: Vertex[] = topo.vertices.map((at, i) => ({ id: i + 1, at }));
  const at = (i: number) => vertices[i].at;
  const edges: Edge[] = topo.edges.map((e, i) => ({
    id: vertices.length + i + 1, start: vertices[e.start], end: vertices[e.end], curve: edgeCurve(e, at, size),
  }));

  // The tessellation, outward, by face: what the outward normal and the face's own surface are read from.
  const { positions, triangles, faceOf } = s.mesh;
  const P = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const tris: number[][][][] = topo.faces.map(() => []);
  let vol = 0;
  for (let t = 0; t < faceOf.length; t++) {
    const tri = [P(triangles[t * 3]), P(triangles[t * 3 + 1]), P(triangles[t * 3 + 2])];
    vol += dot3(tri[0], cross3(tri[1], tri[2]));
    tris[faceOf[t]]?.push(tri);
  }
  const outwardSign = vol < 0 ? -1 : 1;
  const onFace = (fi: number, p: number[]) => Math.min(...tris[fi].map(([a, b, c]) => pointTriangle(p, a, b, c)));

  const features = new Map([...model.features.values()].map((f) => [f.name, f]));
  const faces: Face[] = topo.faces.map((kf, fi) => {
    // The outward normal, and a point, from the face's largest triangle.
    let best: number[][] | null = null, area = -1;
    for (const tri of tris[fi]) {
      const a2 = Math.hypot(...cross3(sub3(tri[1], tri[0]), sub3(tri[2], tri[0])));
      if (a2 > area) [best, area] = [tri, a2];
    }
    if (!best) throw new Error(`a face of ${name} has no triangles to say which way it faces`);
    const out = unit3(cross3(sub3(best[1], best[0]), sub3(best[2], best[0])).map((x) => x * outwardSign))!;
    const point = [0, 1, 2].map((i) => (best![0][i] + best![1][i] + best![2][i]) / 3);

    // The surface: the feature's own, by the face's tag, else the kernel's.
    let surface: Surface | null = null;
    if (kf.tag >= 0) {
      const { feature, member, role } = tagParts(kf.tag);
      const f = features.get(`e${feature}`);
      if (f && !role.endsWith("'")) {
        try {
          surface = roleSurface(model, f, member ?? (role === "base" ? "base" : "lid"));
        } catch {
          surface = null;
        }
      }
    }
    if (!surface && kf.surface) surface = { kind: "bspline", nurbs: kf.surface };
    if (!surface) throw new Error(`a face of ${name} has no surface the file can say`);

    // The loops, walked with the face on their left about the outward normal.
    let bounds: Bound[] = kf.loops.map((loop, k) => ({ outer: k === 0, uses: loop.map((u) => ({ edge: edges[u.edge], forward: u.forward })) }));
    const outer = kf.loops[0] ?? [];
    const once = outer.find((u) => outer.filter((v) => v.edge === u.edge).length === 1);
    let ccw = true;
    if (once) {
      const e = topo.edges[once.edge];
      const { p, t } = along(e, 0.5, at(e.start), at(e.end));
      const dir = unit3(once.forward ? t : t.map((x) => -x));
      // The outward normal *there*: on a curved face it is the nearest
      // triangle's, not the largest one's (measured: a hole's wall read its
      // loop the wrong way round with the normal from across the hole).
      let near = tris[fi][0], nearD = Infinity;
      for (const tri of tris[fi]) {
        const d = pointTriangle(p, tri[0], tri[1], tri[2]);
        if (d < nearD) [near, nearD] = [tri, d];
      }
      const here = unit3(cross3(sub3(near[1], near[0]), sub3(near[2], near[0])).map((x) => x * outwardSign));
      if (dir && here) {
        const left = cross3(here, dir);
        const eps = 2e-3 * Math.max(1, size);
        const plus = onFace(fi, p.map((x, i) => x + eps * left[i]));
        const minus = onFace(fi, p.map((x, i) => x - eps * left[i]));
        ccw = plus <= minus;
      }
    }
    if (!ccw) {
      bounds = bounds.map((b) => ({ outer: b.outer, uses: b.uses.slice().reverse().map((u) => ({ edge: u.edge, forward: !u.forward })) }));
    }
    // A kernel surface's own normal is outward exactly when its loops came counter-clockwise.
    const sameSense = surface.kind === "bspline" ? ccw : dot3(surfaceNormal(surface, point), out) > 0;
    return { surface, sameSense, bounds };
  });

  let next = vertices.length + edges.length + 1;
  return { name, feature: name, outer: { faces: splitSeams(faces, () => next++) }, voids: [], volume: s.volume, box: s.box };
}

/** `p` turned through half a turn about the line through `c` along unit `k`. */
function halfTurn(p: number[], c: number[], k: number[]): number[] {
  const d = sub3(p, c);
  const h = dot3(d, k);
  return c.map((x, i) => x + 2 * h * k[i] - d[i]);
}

/**
 * **No face has a seam, and no edge is closed** — solids.ts's rule, and the
 * reason for it measured again here: OpenCascade's read with its healing off
 * (test/fixtures/step-kernel/validated.json, "strict") rejected every kernel
 * body with a whole cylinder in it, and took the same bodies split. The kernel
 * closes a whole cylinder (a hole's wall, a boss's) or a full revolve's face
 * along a seam edge it uses twice, between two closed circles. Here each such
 * circle becomes two half circles, meeting at the point opposite its own, and
 * the face two halves, joined by the seam turned half way round the circles'
 * axis — a line for a cylinder, a cone or a plane, a circle for a torus or a
 * sphere. A seam this cannot split (one whose far end is on the axis, or on a
 * face with holes) is left, and the healed read still takes it.
 */
function splitSeams(faces: Face[], id: () => number): Face[] {
  const halves = new Map<Edge, [Edge, Edge]>();
  const half = (c: Edge): [Edge, Edge] | null => {
    if (c.curve.kind !== "circle" || c.start !== c.end) return null;
    let h = halves.get(c);
    if (!h) {
      const opposite: Vertex = { id: id(), at: c.curve.center.map((x, i) => 2 * x - c.start.at[i]) };
      h = [
        { id: id(), start: c.start, end: opposite, curve: c.curve },
        { id: id(), start: opposite, end: c.start, curve: c.curve },
      ];
      halves.set(c, h);
    }
    return h;
  };
  // First, which faces can be split, and the circles they need halved.
  const plans: { face: Face; seam: Edge; circles: [Edge, Edge] }[] = [];
  for (const f of faces) {
    if (f.bounds.length !== 1) continue;
    const uses = f.bounds[0].uses;
    const seam = uses.find((u) => uses.filter((v) => v.edge === u.edge).length === 2)?.edge;
    if (!seam || (seam.curve.kind !== "line" && seam.curve.kind !== "circle")) continue;
    const circles = uses.filter((u) => u.edge !== seam).map((u) => u.edge);
    if (circles.length !== 2 || circles.some((c) => c.curve.kind !== "circle" || c.start !== c.end)) continue;
    const [a, b] = circles.map((c) => c.curve as Extract<Curve, { kind: "circle" }>);
    // Coaxial, so half a turn about the one axis carries each circle onto itself.
    const axis = a.normal;
    if (Math.hypot(...cross3(a.normal, b.normal)) > 1e-9) continue;
    const off = sub3(b.center, a.center);
    if (Math.hypot(...cross3(off, axis)) > 1e-9 * Math.max(1, a.r, b.r)) continue;
    plans.push({ face: f, seam, circles: [circles[0], circles[1]] });
  }
  if (!plans.length) return faces;
  for (const p of plans) for (const c of p.circles) half(c);
  // Every use of a halved circle, in every face, becomes its two halves in order.
  const relaid = (uses: Bound["uses"]): Bound["uses"] => uses.flatMap((u) => {
    const h = halves.get(u.edge);
    if (!h) return [u];
    return u.forward ? [{ edge: h[0], forward: true }, { edge: h[1], forward: true }] : [{ edge: h[1], forward: false }, { edge: h[0], forward: false }];
  });
  const planned = new Map(plans.map((p) => [p.face, p]));
  const out: Face[] = [];
  for (const f of faces) {
    const bounds = f.bounds.map((b) => ({ outer: b.outer, uses: relaid(b.uses) }));
    const plan = planned.get(f);
    if (!plan) {
      out.push({ ...f, bounds });
      continue;
    }
    // The loop from the first use of the seam: s, one circle's halves, s back, the other's.
    let loop = bounds[0].uses;
    const i = loop.findIndex((u) => u.edge === plan.seam);
    loop = [...loop.slice(i), ...loop.slice(0, i)];
    const j = loop.findIndex((u, k) => k > 0 && u.edge === plan.seam);
    const [s1, x0, x1, s2, y0, y1] = [loop[0], loop[1], loop[2], loop[j], loop[j + 1], loop[j + 2]];
    if (j !== 3 || loop.length !== 6) {
      out.push({ ...f, bounds });
      continue;
    }
    const start = (u: Bound["uses"][number]) => (u.forward ? u.edge.start : u.edge.end);
    const end = (u: Bound["uses"][number]) => (u.forward ? u.edge.end : u.edge.start);
    const [mx, my] = [end(x0), end(y0)];
    const c = plan.circles[0].curve as Extract<Curve, { kind: "circle" }>;
    // The seam turned half way round: from where one circle's half ends to where the other's does.
    const seamCurve: Curve = plan.seam.curve.kind === "line" ? { kind: "line" } : (() => {
      const sc = plan.seam.curve as Extract<Curve, { kind: "circle" }>;
      const centre = halfTurn(sc.center, c.center, c.normal);
      const turn = (v: number[]) => sub3(halfTurn(v.map((x, k) => x + c.center[k]), c.center, c.normal), c.center);
      // The seam's direction is s1's; the new edge runs from mx to my, which
      // the half turn carries s1's end and start onto — so its turn is s1's
      // reversed when s1 runs from y's side to x's.
      const normal = turn(sc.normal).map((x) => (s1.forward ? -x : x));
      return { kind: "circle", center: centre, normal, ref: unit3(sub3(mx.at, centre))!, r: sc.r };
    })();
    const n: Edge = { id: id(), start: mx, end: my, curve: seamCurve };
    void start;
    out.push({ surface: f.surface, sameSense: f.sameSense, bounds: [{ outer: true, uses: [s1, x0, { edge: n, forward: true }, y1] }] });
    out.push({ surface: f.surface, sameSense: f.sameSense, bounds: [{ outer: true, uses: [s2, y0, { edge: n, forward: false }, x1] }] });
  }
  return out;
}
