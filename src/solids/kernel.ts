// What ZeroCAD asks of a solid kernel — the whole contract
// (docs/plans/solids-kernel.md; the spike that chose SMLib wrote it first).
//
// Kernel-neutral on purpose: the evaluator (evaluate.ts), the naming
// (naming.ts), the tests and the benchmarks are written once against this, so
// another kernel would be one more file like smlib.ts and nothing else.
//
// The layer rule's kernel edge applies here as it does to src/kernel/: this
// knows planar profiles, frames and solids, and nothing of a ZeroCAD point,
// entity or name. A profile is numbers; a tag is a number the caller chooses.
// Nothing under src/solids/ imports anything above it.

export type V2 = [number, number];
export type V3 = [number, number, number];

/** One curve of a profile, in the profile's own plane (local x, y). */
export type Member =
  | { kind: "line"; from: V2; to: V2 }
  /** Counter-clockwise from `start` to `end`, degrees. */
  | { kind: "arc"; centre: V2; radius: number; start: number; end: number }
  | { kind: "circle"; centre: V2; radius: number }
  /**
   * A curve exactly as a (rational) B-spline in the profile's plane — what an
   * ellipse is handed over as (docs/plans/sketch-shapes.md): its degree, its
   * unique knots and their multiplicities, and its control points, each
   * `[x, y, weight]`, Euclidean as `NurbsCurve`'s are.
   */
  | { kind: "nurbs"; degree: number; knots: number[]; mults: number[]; points: [number, number, number][] };

/**
 * A planar region: its loops, read even-odd (the outer boundary, then holes,
 * an island in a hole …) — the same rule `faces.ts` fills a cap by.
 */
export interface Profile {
  loops: Member[][];
}

/** Where a profile's plane is: its local x and y axes in the world, and its origin. */
export interface Placement {
  origin: V3;
  x: V3;
  y: V3;
}

export const XY: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };

/** A solid, held by the kernel. Opaque. */
export type Solid = number;

export type SurfaceKind = "plane" | "cylinder" | "cone" | "sphere" | "torus" | "revolution" | "bspline" | "other";

export interface FaceInfo {
  kind: SurfaceKind;
  /** The caller's tag, or -1 if the face has none (made by the operation). */
  tag: number;
  /** A point strictly inside the face. */
  point: V3;
  /**
   * Radius (cylinder, cone at v = 0, sphere), major radius (torus); for a
   * general surface of revolution, what its generating curve is (1 line,
   * 2 circle, 3 rational B-spline, 4 other).
   */
  radius: number;
  /** Minor radius (torus), half-angle in degrees (cone), generator's degree (revolution). */
  minor: number;
  area: number;
}

export interface EdgeInfo {
  /** The indices of the (up to) two faces the edge bounds; -1 for none. */
  faces: [number, number];
  start: V3;
  end: V3;
  mid: V3;
  /**
   * A sheet's boundary (docs/plans/surfaces.md): an edge of one face and no
   * seam — where a solid would have a second face. A closed surface's seam has
   * one face too, and is not lamina.
   */
  lamina: boolean;
  /** The caller's tag on the edge, -1 for none — what a sheet's boundary edges are named by (naming.ts). */
  tag: number;
}

export interface Mesh {
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  triangles: Uint32Array;
  /** The B-rep face each triangle lies on — what picking a face needs. */
  faceOf: Uint32Array;
}

export interface Validity {
  /** A closed, manifold solid by the kernel's own test. */
  manifold: boolean;
  /** Failed reports from the kernel's internal consistency checks (0 = none). */
  failures: number;
}

export type BooleanOp = "union" | "subtract" | "intersect";

/**
 * Every operation that makes a solid returns a new handle and spends the
 * handles it was given (`copy` first to keep one). A kernel that modifies in
 * place behind this is free to; one that returns new shapes is free to.
 */
export interface SolidKernel {
  readonly name: string;
  extrude(profile: Profile, depth: number, at?: Placement): Solid;
  /** About the line through `point` along `dir`, both in the profile's plane. */
  revolve(profile: Profile, point: V2, dir: V2, degrees: number, at?: Placement): Solid;
  boolean(op: BooleanOp, a: Solid, b: Solid): Solid;
  fillet(s: Solid, edges: number[], radius: number): Solid;
  chamfer(s: Solid, edges: number[], distance: number): Solid;
  /** Hollow inward to wall `thickness`, leaving `open` faces open; null if the kernel has no shell. */
  shell(s: Solid, open: number[], thickness: number): Solid | null;

  // ---- sheets (docs/plans/surfaces.md): a surface is a solid's kind of handle with lamina edges ----

  /** The profile's curves, open or closed, swept `depth` along its plane's +z with no caps. */
  sheetExtrude(profile: Profile, depth: number, at?: Placement): Solid;
  /** The profile's curves turned about an axis in their plane, with no caps. */
  sheetRevolve(profile: Profile, point: V2, dir: V2, degrees: number, at?: Placement): Solid;
  /** Face `face` of `s` on its own, as a sheet; `s` is kept. */
  extractFace(s: Solid, face: number): Solid;
  /** `s` trimmed by a curve (a profile's one member, where `at` places it) projected along `dir`, keeping the side `keep` projects onto. */
  trimByCurve(s: Solid, curve: Member, at: Placement, dir: V3, keep: V3): Solid;
  /** `s` trimmed where `by` crosses it, the crossing projected along `dir` (or `s`'s own normal, given [0, 0, 0]), keeping `keep`'s side; `by` is kept. */
  trimBySheet(s: Solid, by: Solid, dir: V3, keep: V3): Solid;
  /** The normal of the surface under the face of `s` nearest `p` (the surface's own way), or null. */
  normal(s: Solid, p: V3): V3 | null;
  /** Points along the curves where two sheets cross; empty where they do not. */
  crossing(s: Solid, by: Solid): V3[];
  /** `t` knitted into `s`: lamina edges within `tolerance` stitched into one. Spends `t`. */
  knit(s: Solid, t: Solid, tolerance: number): { solid: Solid; stitched: number; lamina: number };
  /** A closed sheet stitched into a solid, in place: whether it closed. */
  solidify(s: Solid): boolean;
  /** A sheet offset `distance` along its normals, as a new sheet; `s` is kept. */
  offsetSheet(s: Solid, distance: number): Solid;
  /** A solid from a sheet: it, its offset by `distance`, and ruled walls between; `s` is kept. */
  thicken(s: Solid, distance: number): Solid;
  /** Whether a handle is a sheet — every edge lamina or shared by two faces, one shell. */
  sheet(s: Solid): boolean;
  /** The kernel's own blend between two faces' whole surfaces (untrimmed): a new sheet. */
  faceBlend(a: Solid, fa: number, b: Solid, fb: number, size: number, chamfer: boolean): Solid;
  tagEdge(s: Solid, edge: number, tag: number): void;
  copy(s: Solid): Solid;
  free(s: Solid): void;

  volume(s: Solid): number;
  bbox(s: Solid): [V3, V3];
  validity(s: Solid): Validity;
  /** Just the manifold test of `validity` — cheap, where the consistency checks are not. */
  manifold(s: Solid): boolean;
  faces(s: Solid): FaceInfo[];
  edges(s: Solid): EdgeInfo[];
  tagFace(s: Solid, face: number, tag: number): void;
  /** Distance from a point to a (trimmed) face. */
  distanceToFace(s: Solid, face: number, p: V3): number;
  tessellate(s: Solid, chord: number, angleDeg: number): Mesh;
  /** Every edge sampled as a polyline, by edge index — what drawing and picking a solid's edges need. */
  edgePolylines(s: Solid, angleDeg: number): { edge: number; points: Float32Array }[];
  /** The exact boundary, for STEP. */
  topology(s: Solid): Topology;

  /** Bytes the kernel's allocator has handed out and not had back. */
  heapInUse(): number;
  /** Bytes of linear memory the module holds — what never shrinks. */
  heapReserved(): number;
}

/** A curve exactly, as NURBS — every SMLib curve is one; `kind` says which analytic curve it also is. */
export interface NurbsCurve {
  kind: "line" | "circle" | "bspline";
  degree: number;
  /** Unique knots, ascending, and how many times each repeats. */
  knots: number[];
  mults: number[];
  rational: boolean;
  /** Euclidean control points, each [x, y, z, weight]. */
  points: number[][];
}

/** A surface exactly, as NURBS, control points u-major (index iu·nv + iv). */
export interface NurbsSurface {
  degree: [number, number];
  knots: [number[], number[]];
  mults: [number[], number[]];
  count: [number, number];
  rational: boolean;
  points: number[][];
}

/** One use of an edge by a face's loop: the edge, and whether the loop runs it its own way. */
export interface EdgeUse {
  edge: number;
  forward: boolean;
}

/**
 * A solid's exact boundary, for an exporter: what STEP needs and a mesh
 * cannot say. Indices are into these arrays, which are in the kernel's own
 * face and edge order (the same as `faces` and `edges`).
 */
export interface Topology {
  vertices: V3[];
  edges: { start: number; end: number; range: [number, number]; curve: NurbsCurve | null }[];
  faces: {
    tag: number;
    kind: SurfaceKind;
    surface: NurbsSurface | null;
    /** The face's loops, each walked counter-clockwise about the surface's own normal for the outer one (the primary faceuse's). */
    loops: EdgeUse[][];
  }[];
}

/** A failure a kernel reports, rather than throws from inside wasm. */
export class KernelError extends Error {
  op: string;
  status: number;
  constructor(op: string, status: number) {
    super(`${op} failed (status ${status})`);
    this.op = op;
    this.status = status;
  }
}
