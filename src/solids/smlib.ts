// SolidKernel over our own Emscripten build of NVIDIA's SMLib
// (scripts/solids/: the recipe and glue.cpp, our C ABI over SM_API).
//
// The module is handed in rather than imported, so the same adapter runs in
// Node (the tests) and in a Worker (worker.ts) — the module factory is the one
// thing that differs between them.

import {
  KernelError, XY,
  type BooleanOp, type EdgeInfo, type FaceInfo, type Member, type Mesh, type Placement, type Profile,
  type NurbsCurve, type NurbsSurface, type Solid, type SolidKernel, type SurfaceKind, type Topology, type V2, type V3, type Validity,
} from "./kernel.ts";

/** The exports glue.cpp makes, as Emscripten hands them over. */
export interface SmModule {
  HEAPF64: Float64Array;
  HEAP32: Int32Array;
  HEAPU8: Uint8Array;
  _malloc(n: number): number;
  _free(p: number): void;
  _sm_init(): number;
  _sm_profile_clear(): void;
  _sm_profile_line(x0: number, y0: number, x1: number, y1: number): number;
  _sm_profile_arc(cx: number, cy: number, r: number, a0: number, a1: number): number;
  _sm_profile_circle(cx: number, cy: number, r: number): number;
  _sm_extrude(d: number): number;
  _sm_revolve(px: number, py: number, pz: number, ax: number, ay: number, az: number, deg: number): number;
  _sm_place(h: number, ox: number, oy: number, oz: number, xx: number, xy: number, xz: number,
    yx: number, yy: number, yz: number): number;
  _sm_copy(h: number): number;
  _sm_delete(h: number): void;
  _sm_boolean(a: number, b: number, op: number): number;
  _sm_fillet(h: number, idx: number, n: number, r: number, xsect: number): number;
  _sm_shell(h: number, idx: number, n: number, d: number): number;
  _sm_volume(h: number): number;
  _sm_bbox(h: number, out: number): number;
  _sm_is_manifold(h: number): number;
  _sm_check(h: number): number;
  _sm_count(h: number, kind: number): number;
  _sm_faces(h: number, out: number, cap: number): number;
  _sm_tag_face(h: number, i: number, tag: number): number;
  _sm_face_distance(h: number, i: number, x: number, y: number, z: number): number;
  _sm_edges(h: number, out: number, cap: number): number;
  _sm_face_nurbs(h: number, i: number, out: number, cap: number): number;
  _sm_tessellate(h: number, chord: number, angle: number): number;
  _sm_mesh_positions(): number;
  _sm_mesh_vertex_count(): number;
  _sm_mesh_triangles(): number;
  _sm_edge_polylines(h: number, angle: number): number;
  _sm_edge_points(): number;
  _sm_edge_runs(): number;
  _sm_heap_in_use(): number;
  _sm_topology(h: number): number;
  _sm_topology_data(): number;
}

const KINDS: SurfaceKind[] = ["other", "plane", "cylinder", "cone", "sphere", "torus", "revolution", "bspline"];
const OPS: Record<BooleanOp, number> = { union: 1, intersect: 2, subtract: 3 };

export class SmlibKernel implements SolidKernel {
  readonly name = "SMLib";
  private m: SmModule;

  constructor(m: SmModule) {
    this.m = m;
    if (!m._sm_init()) throw new Error("SMLib: no context");
  }

  private ok(op: string, h: number): Solid {
    if (h < 0) throw new KernelError(op, -h - 1);
    return h;
  }

  /** Run `f` with a scratch block of `n` doubles; returns what `f` returns. */
  private doubles<T>(n: number, f: (ptr: number, view: () => Float64Array) => T): T {
    const p = this.m._malloc(n * 8);
    try {
      return f(p, () => this.m.HEAPF64.subarray(p >> 3, (p >> 3) + n));
    } finally {
      this.m._free(p);
    }
  }

  private ints<T>(xs: number[], f: (ptr: number) => T): T {
    const p = this.m._malloc(Math.max(1, xs.length) * 4);
    try {
      this.m.HEAP32.set(xs, p >> 2);
      return f(p);
    } finally {
      this.m._free(p);
    }
  }

  private loadProfile(p: Profile): void {
    const m = this.m;
    m._sm_profile_clear();
    for (const loop of p.loops) for (const c of loop) {
      const r = addMember(m, c);
      if (r < 0) throw new KernelError(`profile ${c.kind}`, -r - 1);
    }
  }

  private place(h: Solid, at: Placement | undefined): Solid {
    if (!at || at === XY) return h;
    const { origin: o, x, y } = at;
    const s = this.m._sm_place(h, o[0], o[1], o[2], x[0], x[1], x[2], y[0], y[1], y[2]);
    if (s !== 0) throw new KernelError("place", s);
    return h;
  }

  extrude(profile: Profile, depth: number, at?: Placement): Solid {
    this.loadProfile(profile);
    return this.place(this.ok("extrude", this.m._sm_extrude(depth)), at);
  }

  revolve(profile: Profile, point: V2, dir: V2, degrees: number, at?: Placement): Solid {
    this.loadProfile(profile);
    const h = this.m._sm_revolve(point[0], point[1], 0, dir[0], dir[1], 0, degrees);
    return this.place(this.ok("revolve", h), at);
  }

  boolean(op: BooleanOp, a: Solid, b: Solid): Solid {
    return this.ok(op, this.m._sm_boolean(a, b, OPS[op]));
  }

  fillet(s: Solid, edges: number[], radius: number): Solid {
    const st = this.ints(edges, (p) => this.m._sm_fillet(s, p, edges.length, radius, 1));
    if (st !== 0) throw new KernelError("fillet", st);
    return s;
  }

  chamfer(s: Solid, edges: number[], distance: number): Solid {
    const st = this.ints(edges, (p) => this.m._sm_fillet(s, p, edges.length, distance, 0));
    if (st !== 0) throw new KernelError("chamfer", st);
    return s;
  }

  shell(s: Solid, open: number[], thickness: number): Solid {
    // The contract's thickness is inward (the walls inside the solid). SMLib's
    // positive offset goes outward — measured: +2 on a 40×30×20 box grew its
    // box by 2 and its volume to the outward shell's — so the sign flips here.
    const h = this.ints(open, (p) => this.m._sm_shell(s, p, open.length, -thickness));
    this.m._sm_delete(s);
    return this.ok("shell", h);
  }

  copy(s: Solid): Solid { return this.ok("copy", this.m._sm_copy(s)); }
  free(s: Solid): void { this.m._sm_delete(s); }

  volume(s: Solid): number { return this.m._sm_volume(s); }

  bbox(s: Solid): [V3, V3] {
    return this.doubles(6, (p, v) => {
      const st = this.m._sm_bbox(s, p);
      if (st !== 0) throw new KernelError("bbox", st);
      const b = v();
      return [[b[0], b[1], b[2]], [b[3], b[4], b[5]]];
    });
  }

  manifold(s: Solid): boolean {
    return this.m._sm_is_manifold(s) === 1;
  }

  validity(s: Solid): Validity {
    return { manifold: this.m._sm_is_manifold(s) === 1, failures: this.m._sm_check(s) };
  }

  faces(s: Solid): FaceInfo[] {
    const n = this.m._sm_count(s, 0);
    return this.doubles(n * 8, (p, v) => {
      this.m._sm_faces(s, p, n * 8);
      const d = v();
      const out: FaceInfo[] = [];
      for (let i = 0; i < n; i++) {
        const o = i * 8;
        out.push({
          kind: KINDS[d[o]] ?? "other", tag: d[o + 1], point: [d[o + 2], d[o + 3], d[o + 4]],
          radius: d[o + 5], minor: d[o + 6], area: d[o + 7],
        });
      }
      return out;
    });
  }

  edges(s: Solid): EdgeInfo[] {
    const n = this.m._sm_count(s, 1);
    return this.doubles(n * 12, (p, v) => {
      this.m._sm_edges(s, p, n * 12);
      const d = v();
      const out: EdgeInfo[] = [];
      for (let i = 0; i < n; i++) {
        const o = i * 12;
        out.push({
          faces: [d[o], d[o + 1]], start: [d[o + 2], d[o + 3], d[o + 4]],
          end: [d[o + 5], d[o + 6], d[o + 7]], mid: [d[o + 8], d[o + 9], d[o + 10]],
        });
      }
      return out;
    });
  }

  tagFace(s: Solid, face: number, tag: number): void {
    const st = this.m._sm_tag_face(s, face, tag);
    if (st !== 0) throw new KernelError("tag", st);
  }

  distanceToFace(s: Solid, face: number, p: V3): number {
    return this.m._sm_face_distance(s, face, p[0], p[1], p[2]);
  }

  /** The exact surface as NURBS: degrees, control net and weights — what STEP needs. */
  faceNurbs(s: Solid, face: number): { degree: [number, number]; count: [number, number]; rational: boolean; points: number[] } {
    const need = this.m._sm_face_nurbs(s, face, 0, 0);
    if (need < 0) throw new KernelError("nurbs", -need);
    return this.doubles(need, (p, v) => {
      this.m._sm_face_nurbs(s, face, p, need);
      const d = v();
      return { degree: [d[0], d[1]], count: [d[2], d[3]], rational: d[4] === 1, points: Array.from(d.subarray(5)) };
    });
  }

  tessellate(s: Solid, chord: number, angleDeg: number): Mesh {
    const m = this.m;
    const nt = m._sm_tessellate(s, chord, angleDeg);
    if (nt < 0) throw new KernelError("tessellate", -nt - 1);
    const nv = m._sm_mesh_vertex_count();
    const pos = new Float32Array(m.HEAPU8.buffer, m._sm_mesh_positions(), nv * 3).slice();
    const raw = new Uint32Array(m.HEAPU8.buffer, m._sm_mesh_triangles(), nt * 4);
    const triangles = new Uint32Array(nt * 3);
    const faceOf = new Uint32Array(nt);
    for (let i = 0; i < nt; i++) {
      triangles[i * 3] = raw[i * 4]; triangles[i * 3 + 1] = raw[i * 4 + 1]; triangles[i * 3 + 2] = raw[i * 4 + 2];
      faceOf[i] = raw[i * 4 + 3];
    }
    return { positions: pos, triangles, faceOf };
  }

  /** Every edge sampled as a polyline, by edge index — what drawing and picking a solid's edges need. */
  edgePolylines(s: Solid, angleDeg: number): { edge: number; points: Float32Array }[] {
    const m = this.m;
    const n = m._sm_edge_polylines(s, angleDeg);
    if (n < 0) throw new KernelError("edge polylines", -n - 1);
    const runs = new Uint32Array(m.HEAPU8.buffer, m._sm_edge_runs(), n * 2).slice();
    let total = 0;
    for (let i = 0; i < n; i++) total += runs[i * 2 + 1];
    const pts = new Float32Array(m.HEAPU8.buffer, m._sm_edge_points(), total * 3).slice();
    const out: { edge: number; points: Float32Array }[] = [];
    let at = 0;
    for (let i = 0; i < n; i++) {
      const c = runs[i * 2 + 1];
      out.push({ edge: runs[i * 2], points: pts.subarray(at * 3, (at + c) * 3) });
      at += c;
    }
    return out;
  }

  topology(s: Solid): Topology {
    const n = this.m._sm_topology(s);
    if (n < 0) throw new KernelError("topology", -n);
    const d = new Float64Array(this.m.HEAPF64.buffer, this.m._sm_topology_data(), n).slice();
    let at = 0;
    const next = () => d[at++];
    const take = (k: number) => { const out = Array.from(d.subarray(at, at + k)); at += k; return out; };
    const [nv, ne, nf] = [next(), next(), next()];
    const vertices: V3[] = [];
    for (let i = 0; i < nv; i++) vertices.push(take(3) as V3);
    const knots = (): [number[], number[]] => { const k = next(); return [take(k), take(k)]; };
    const curve = (): NurbsCurve | null => {
      const kind = next();
      if (kind === 0) return null;
      const degree = next();
      const [ks, mults] = knots();
      const np = next();
      const rational = next() === 1;
      const points: number[][] = [];
      for (let i = 0; i < np; i++) points.push(take(4));
      return { kind: kind === 1 ? "line" : kind === 2 ? "circle" : "bspline", degree, knots: ks, mults, rational, points };
    };
    const surface = (): NurbsSurface | null => {
      if (next() === 0) return null;
      const degree: [number, number] = [next(), next()];
      const [ku, mu] = knots();
      const [kv, mv] = knots();
      const count: [number, number] = [next(), next()];
      const rational = next() === 1;
      const points: number[][] = [];
      for (let i = 0; i < count[0] * count[1]; i++) points.push(take(4));
      return { degree, knots: [ku, kv], mults: [mu, mv], count, rational, points };
    };
    const edges: Topology["edges"] = [];
    for (let i = 0; i < ne; i++) {
      const [start, end, lo, hi] = take(4);
      edges.push({ start, end, range: [lo, hi], curve: curve() });
    }
    const faces: Topology["faces"] = [];
    for (let i = 0; i < nf; i++) {
      const tag = next();
      const kind = KINDS[next()] ?? "other";
      const srf = surface();
      const loops: Topology["faces"][number]["loops"] = [];
      const nl = next();
      for (let k = 0; k < nl; k++) {
        const nu = next();
        const uses = [];
        for (let j = 0; j < nu; j++) uses.push({ edge: next(), forward: next() === 1 });
        loops.push(uses);
      }
      faces.push({ tag, kind, surface: srf, loops });
    }
    return { vertices, edges, faces };
  }

  heapInUse(): number { return this.m._sm_heap_in_use(); }
  heapReserved(): number { return this.m.HEAPU8.buffer.byteLength; }
}

function addMember(m: SmModule, c: Member): number {
  switch (c.kind) {
    case "line": return m._sm_profile_line(c.from[0], c.from[1], c.to[0], c.to[1]);
    case "arc": return m._sm_profile_arc(c.centre[0], c.centre[1], c.radius, c.start, c.end);
    case "circle": return m._sm_profile_circle(c.centre[0], c.centre[1], c.radius);
  }
}
