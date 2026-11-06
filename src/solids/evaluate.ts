// Features into solids: the program a document's bodies are, evaluated by a
// kernel — in the solids Worker (worker.ts), or in-process for the tests.
//
// **A program is numbers.** Each body is a chain of sweeps, the first making
// it and each later one unioned into it, cut from it or intersected with it,
// in the order given — the caller's dependency order (bodies.ts reads it off
// the model). A sweep is a profile in its own plane, where that plane is, and
// a depth or an axis and an angle; a tag number per sweep, which names its
// faces (naming.ts). No point, entity or name of the model is here: the layer
// rule's kernel edge.
//
// **Cached per node by its inputs.** A body's node i is keyed by every node up
// to and including it, so a change to node k rebuilds k onward from the solid
// node k − 1 left, and a change to nothing rebuilds nothing. The solids each
// node left are kept (one body's chain at a time, the latest), and spent when
// a newer chain replaces them — so the kernel holds at most one chain's worth
// per body, whatever the history of edits.
//
// **A refusal is a result, never a throw.** A sweep or a boolean the kernel
// refuses is left out of the chain and said (`failed`), the rest of the chain
// goes on, and the caller decides what to draw (bodies.ts keeps the last good
// body). A node that changed nothing — a cut that reaches no material, an add
// wholly inside — is said too (`idle`): it is almost always a mistake, and the
// picture alone would not show it.

import type { BooleanOp, EdgeInfo, FaceInfo, Member, Mesh, Placement, Profile, Solid, SolidKernel, Topology, V2, V3, Validity } from "./kernel.ts";
import {
  BLEND_EDGES, blendTag, namesOf, roleOf, tagExtrude, tagNewBoundary, tagOffsets, tagPlanar, tagRevolve, tagSheetExtrude, tagSheetRevolve,
} from "./naming.ts";

export type NodeOp = "new" | BooleanOp;

export type Sweep =
  | { kind: "extrude"; depth: number }
  /** About the line through `point` along `dir`, both in the profile's plane. */
  | { kind: "revolve"; point: V2; dir: V2; degrees: number };

export interface SweepNode {
  /** The feature's number: its faces are tagged `id·1000 + role` (naming.ts). */
  id: number;
  /** What it does to the body: the first node makes it (`new`); every later one is a boolean. */
  op: NodeOp;
  sweep: Sweep;
  profile: Profile;
  at: Placement;
}

export type BlendOp = "fillet" | "chamfer";

/**
 * A fillet or a chamfer of edges of the body as the nodes before it left it
 * (docs/plans/solid-fillets.md). **Edges by name**, never by index: `e1.lid|e1.m0`
 * is the edge between those two faces in whatever topology the rebuild made,
 * and every edge answering to a name is taken (the pieces of a split face
 * share it). A name no edge answers to is said (`missing`) and left out; a
 * blend none of whose edges is there is refused and left out of the chain —
 * a cut that took the edge took its fillet, and the log says so.
 */
export interface BlendNode {
  id: number;
  op: BlendOp;
  edges: string[];
  /** The fillet's radius; the chamfer's setback along each face (the spike measured SMLib's meaning). */
  size: number;
}

// ---- surfaces (docs/plans/surfaces.md) --------------------------------------
//
// A surface is evaluated as a body is: a chain of nodes, the first making it,
// each later one changing it — a sheet (lamina edges, no volume) until a
// thicken or a solidify makes it a solid. A node that takes another chain (a
// knit's partner, a trim by another surface, a face of a body, an offset of a
// surface) carries that chain's nodes inline, so a program stays a list of
// numbers and a body's cache keys stay what they were: a change to the
// partner is a change to this node's inputs.

/** A surface swept from curves (open or closed) with no caps: an extruded or revolved surface. */
export interface SheetNode {
  id: number;
  op: "sheet";
  sweep: Sweep;
  profile: Profile;
  at: Placement;
}

/** A planar surface: the region a profile bounds, as one face. */
export interface PlanarNode {
  id: number;
  op: "planar";
  profile: Profile;
  at: Placement;
}

/** A face of another chain (a body's, or a surface's) taken on its own, by name: `surface("e1.lid")`. */
export interface FaceNode {
  id: number;
  op: "face";
  of: Node[];
  face: string;
}

/** A new surface: another chain's sheet offset along its normals. */
export interface OffsetNode {
  id: number;
  op: "offset";
  of: Node[];
  distance: number;
}

/**
 * A trim: by one curve projected along `dir` (`curve`, in its own plane as
 * `at` places it), or where another surface's chain crosses this one (`by`),
 * keeping the side `keep` is on.
 */
export interface TrimNode {
  id: number;
  op: "trim";
  curve?: { member: Member; at: Placement; dir: V3 };
  by?: Node[];
  keep: V3;
}

/** Other surfaces' chains knitted into this one where their edges meet. */
export interface KnitNode {
  id: number;
  op: "knit";
  with: Node[][];
  tolerance: number;
}

/** A solid from the sheet: it, its offset by `distance`, and walls between. */
export interface ThickenNode {
  id: number;
  op: "thicken";
  distance: number;
}

/** A closed sheet closed into a solid. */
export interface SolidifyNode {
  id: number;
  op: "solidify";
}

/**
 * A fillet or chamfer **between two surfaces** (`fillet("s1", "s2", 3)`):
 * the edges between this chain's faces of features `a` and its faces of
 * features `b`, rounded — after knitting `with` in first, where the other
 * surface is not part of this chain yet: the two knitted where their edges
 * meet, or, where they cross, each trimmed back to the other first, keeping
 * the side its `keep` point is on (null: the larger piece).
 */
export interface PairBlendNode {
  id: number;
  op: "pairFillet" | "pairChamfer";
  a: number[];
  b: number[];
  with: Node[] | null;
  keep: [V3 | null, V3 | null];
  size: number;
}

export type SurfaceNode = SheetNode | PlanarNode | FaceNode | OffsetNode | TrimNode | KnitNode | ThickenNode | SolidifyNode | PairBlendNode;

export type Node = SweepNode | BlendNode | SurfaceNode;

export function isBlend(n: Node): n is BlendNode {
  return n.op === "fillet" || n.op === "chamfer";
}

const SURFACE_OPS: readonly string[] = ["sheet", "planar", "face", "offset", "trim", "knit", "thicken", "solidify", "pairFillet", "pairChamfer"];

export function isSurfaceNode(n: Node): n is SurfaceNode {
  return SURFACE_OPS.includes(n.op);
}

/** Every node of a chain, those carried inside its nodes included (a knit's partners, a face's body). */
export function allNodes(nodes: readonly Node[]): Node[] {
  const out: Node[] = [];
  const walk = (ns: readonly Node[]) => {
    for (const n of ns) {
      out.push(n);
      if (!isSurfaceNode(n)) continue;
      if (n.op === "face" || n.op === "offset") walk(n.of);
      else if (n.op === "trim" && n.by) walk(n.by);
      else if (n.op === "knit") for (const w of n.with) walk(w);
      else if ((n.op === "pairFillet" || n.op === "pairChamfer") && n.with) walk(n.with);
    }
  };
  walk(nodes);
  return out;
}


export interface BodyProgram {
  /** The caller's name for it — returned with its result, never read. */
  name: string;
  nodes: Node[];
}

export interface Program {
  bodies: BodyProgram[];
  /** What face names are spelled with before a feature's number (`e` → `e3.lid`). */
  prefix: string;
  /** Tessellation: chord height as a fraction of the body's diagonal, and the angle between facets, degrees. */
  chord: number;
  angle: number;
}

export interface FaceRecord extends FaceInfo {
  /** Its name — shared by the pieces of a split face. */
  name: string;
  /** Its name told apart from the other pieces of its face, where it has any. */
  piece: string;
}

export interface EdgeRecord extends EdgeInfo {
  name: string;
}

export interface BodyResult {
  name: string;
  /** The inputs this result is of — equal hashes, equal results. */
  key: string;
  /** Nodes left out because the kernel refused them, by index, and why. */
  failed: { node: number; id: number; why: string }[];
  /** Nodes that changed nothing, by index. */
  idle: { node: number; id: number }[];
  /** Blends some of whose edges are not on the body they were applied to: those names, left out. */
  missing: { node: number; id: number; edges: string[] }[];
  /** Null when not even the first node could be made. */
  solid: {
    volume: number;
    box: [V3, V3];
    validity: Validity;
    faces: FaceRecord[];
    edges: EdgeRecord[];
    mesh: Mesh;
    /** Each edge as a polyline, by edge index. */
    lines: { edge: number; points: Float32Array }[];
  } | null;
  /** Set when nothing changed since the last run: `solid` is then null, and the last one stands. */
  cached?: true;
  /** Milliseconds the kernel spent on this body this time (0 when it came from the cache). */
  ms: number;
}

export interface ProgramResult {
  bodies: BodyResult[];
  /** Bytes the kernel's allocator holds, and the linear memory it has grown to. */
  heap: { inUse: number; reserved: number };
}

/** A key per node prefix: the same nodes give the same key, whatever object they were spelled in. */
export function nodeKeys(nodes: readonly Node[]): string[] {
  const keys: string[] = [];
  let chain = "";
  for (const n of nodes) {
    chain = `${chain}|${JSON.stringify(isBlend(n) ? [n.id, n.op, n.edges, n.size] : isSurfaceNode(n) ? n : [n.id, n.op, n.sweep, n.profile, n.at])}`;
    keys.push(hash(chain));
  }
  return keys;
}

/** FNV-1a, 52 bits: a cache key, not a defence against anyone. */
export function hash(s: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xfffffffffffffn;
  }
  return h.toString(36);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Chain {
  keys: string[];
  /** The body after each node; null where the node was left out and the one before carried on. */
  solids: (Solid | null)[];
  failed: BodyResult["failed"];
  idle: BodyResult["idle"];
  missing: BodyResult["missing"];
  /** The result as last extracted, for the last key. */
  result: BodyResult | null;
}

export class Evaluator {
  private k: SolidKernel;
  private chains = new Map<string, Chain>();
  /** Last tessellation settings, which a cached result is only good for. */
  private tess = "";
  /** The program's blend features, by number — whose faces are named `e3.f0` (naming.ts). */
  private blends: ReadonlySet<number> = new Set();
  private bare: ReadonlySet<number> = new Set();
  private prefix = "e";

  constructor(k: SolidKernel) {
    this.k = k;
  }

  run(p: Program): ProgramResult {
    const every = p.bodies.flatMap((b) => allNodes(b.nodes));
    // The features whose faces are named f0, f1 … after what they were made of:
    // fillets and chamfers, a pair blend's faces, a thicken's walls.
    this.blends = new Set(every.filter((n) => isBlend(n) || n.op === "pairFillet" || n.op === "pairChamfer" || n.op === "thicken").map((n) => n.id));
    // The features a sheet's boundary edges are named after alone (`s1.m0|s3`): every surface step but the sweeps.
    this.bare = new Set(every.filter((n) => isSurfaceNode(n) && n.op !== "sheet" && n.op !== "planar").map((n) => n.id));
    this.prefix = p.prefix;
    const tess = `${p.chord}:${p.angle}:${p.prefix}`;
    if (tess !== this.tess) {
      for (const c of this.chains.values()) c.result = null;
      this.tess = tess;
    }
    const seen = new Set<string>();
    const bodies = p.bodies.map((b) => {
      seen.add(b.name);
      return this.body(b, p);
    });
    // A body no longer in the program spends what it held.
    for (const [name, c] of this.chains) {
      if (!seen.has(name)) {
        this.spend(c, 0);
        this.chains.delete(name);
      }
    }
    return { bodies, heap: { inUse: this.k.heapInUse(), reserved: this.k.heapReserved() } };
  }

  /** The exact boundary of a body as last evaluated, for STEP; null if it has none. */
  topology(body: string): Topology | null {
    const c = this.chains.get(body);
    const s = c ? lastSolid(c) : null;
    return s === null ? null : this.k.topology(s);
  }

  /** Every solid held, spent — before the module is let go, or to start over. */
  clear(): void {
    for (const c of this.chains.values()) this.spend(c, 0);
    this.chains.clear();
  }

  private spend(c: Chain, from: number): void {
    for (let i = from; i < c.solids.length; i++) {
      const s = c.solids[i];
      if (s !== null) this.k.free(s);
    }
    c.solids.length = Math.min(c.solids.length, from);
    c.keys.length = Math.min(c.keys.length, from);
    c.failed = c.failed.filter((f) => f.node < from);
    c.idle = c.idle.filter((f) => f.node < from);
    c.missing = c.missing.filter((f) => f.node < from);
  }

  private body(b: BodyProgram, p: Program): BodyResult {
    const keys = nodeKeys(b.nodes);
    let c = this.chains.get(b.name);
    if (!c) {
      c = { keys: [], solids: [], failed: [], idle: [], missing: [], result: null };
      this.chains.set(b.name, c);
    }
    let same = 0;
    while (same < keys.length && same < c.keys.length && keys[same] === c.keys[same]) same++;
    const key = keys.length ? keys[keys.length - 1] : hash(b.name);
    if (same === keys.length && same === c.keys.length && c.result && c.result.key === key) {
      // Unchanged: said, without the solid — the caller has it from last time,
      // and its arrays were handed over (transferred) with that answer.
      return { ...c.result, solid: null, cached: true, ms: 0 };
    }
    const t0 = performance.now();
    this.spend(c, same);
    for (let i = same; i < b.nodes.length; i++) {
      c.keys.push(keys[i]);
      c.solids.push(this.node(b.nodes[i], i, lastSolid(c), c));
    }
    const result: BodyResult = {
      name: b.name, key, failed: [...c.failed], idle: [...c.idle], missing: [...c.missing], solid: null, ms: 0,
    };
    const s = lastSolid(c);
    if (s !== null) {
      try {
        result.solid = this.extract(s, p);
      } catch (e) {
        result.failed.push({ node: b.nodes.length - 1, id: b.nodes[b.nodes.length - 1].id, why: `the result could not be read back: ${message(e)}` });
      }
    }
    result.ms = performance.now() - t0;
    c.result = result;
    return result;
  }

  /** One node: its sweep, tagged, and its boolean with what came before. Null when it adds nothing to the chain. */
  private node(n: Node, index: number, before: Solid | null, c: Chain): Solid | null {
    if (isBlend(n)) return this.blend(n, index, before, c);
    if (isSurfaceNode(n)) return this.surface(n, index, before, c);
    const k = this.k;
    let tool: Solid;
    try {
      if (n.sweep.kind === "extrude") {
        tool = k.extrude(n.profile, n.sweep.depth, n.at);
        tagExtrude(k, tool, n.id, n.profile, n.sweep.depth, n.at);
      } else {
        const r = n.sweep;
        tool = k.revolve(n.profile, r.point, r.dir, r.degrees, n.at);
        tagRevolve(k, tool, n.id, n.profile, r.point, r.dir, r.degrees, n.at);
      }
    } catch (e) {
      c.failed.push({ node: index, id: n.id, why: `its ${n.sweep.kind} could not be made: ${message(e)}` });
      return null;
    }
    // A profile that is no closed region sweeps to a sheet, not a solid —
    // measured: a lone line extrudes to one face, volume 0, not manifold. The
    // manifold test alone says so, and costs nothing beside a volume's
    // integral, which was most of a rebuild's time (measured: 142 ms of 245
    // for the owner's part in Node, asked four times a node).
    if (!k.manifold(tool)) {
      k.free(tool);
      c.failed.push({ node: index, id: n.id, why: `its ${n.sweep.kind} is not a solid — its profile does not close` });
      return null;
    }
    if (before === null || n.op === "new") {
      // The first node, or a body whose first node failed: whatever stands is the body.
      if (before !== null) k.free(tool);
      return before === null ? tool : null;
    }
    const a = k.copy(before);
    try {
      const out = k.boolean(n.op, a, tool);
      const faces = k.faces(out);
      if (faces.length === 0) {
        // Nothing left: an intersect that misses, a cut that takes everything.
        k.free(out);
        c.failed.push({ node: index, id: n.id, why: n.op === "intersect" ? "it does not overlap the body, so nothing would be left" : "nothing of the body would be left" });
        return null;
      }
      // Changed nothing: no face of the result is the tool's — a cut that
      // reaches no material, an add wholly inside, an intersect wholly around.
      // Asked of the tags, which the kernel carries onto every piece of a face
      // that survives, rather than of two volumes' integrals.
      const ours = faces.some((f) => f.tag >= 0 && Math.floor(f.tag / 1000) === n.id);
      if (!ours) c.idle.push({ node: index, id: n.id });
      return out;
    } catch (e) {
      // On failure both operands are still the module's (glue.cpp's
      // sm_boolean), possibly changed; neither is used again, so both go.
      k.free(a);
      k.free(tool);
      c.failed.push({ node: index, id: n.id, why: `the ${n.op === "subtract" ? "cut" : n.op} failed: ${message(e)}` });
      return null;
    }
  }

  /**
   * A fillet or chamfer of the body as it stands: its edges found by name in
   * this topology, the kernel's blend on a copy (the solid before it stays the
   * cache's), and each face the kernel made tagged after the edge it was made
   * of — the one whose midpoint lies nearest it. The kernel's new faces come
   * back untagged, and every other face keeps its tag (measured in the spike),
   * so the untagged ones are exactly this blend's.
   */
  private blend(n: BlendNode, index: number, before: Solid | null, c: Chain): Solid | null {
    const k = this.k;
    const verb = n.op;
    const fail = (why: string) => { c.failed.push({ node: index, id: n.id, why }); return null; };
    if (before === null) return fail(`there is no body to ${verb}`);
    if (!(n.size > 0) || !Number.isFinite(n.size)) return fail(`its ${n.op === "fillet" ? "radius" : "setback"} is ${n.size}, and must be more than 0`);
    if (n.edges.length > BLEND_EDGES) return fail(`it names ${n.edges.length} edges, and one ${verb} can tell at most ${BLEND_EDGES} apart — make it two`);
    const edges = k.edges(before);
    const names = namesOf(k.faces(before), edges, this.prefix, this.blends, this.bare).edges;
    const wanted = new Map<string, number>();
    n.edges.forEach((e, i) => { if (!wanted.has(e)) wanted.set(e, i); });
    const picked: number[] = [];
    const of: number[] = [];
    names.forEach((name, i) => {
      const at = wanted.get(name);
      // A seam is no edge of the shape (naming.ts): there is nothing to round.
      if (at === undefined || name.endsWith(":seam")) return;
      picked.push(i);
      of.push(at);
    });
    const found = new Set(of);
    const missing = n.edges.filter((e, i) => !found.has(i) && wanted.get(e) === i);
    if (!picked.length) {
      return fail(`none of the edges it ${verb}s is on the body now (${n.edges.join(", ")}) — an edge it named was taken by a change before it`);
    }
    if (missing.length) c.missing.push({ node: index, id: n.id, edges: missing });
    const out = k.copy(before);
    try {
      if (n.op === "fillet") k.fillet(out, picked, n.size);
      else k.chamfer(out, picked, n.size);
    } catch (e) {
      k.free(out);
      const what = n.op === "fillet" ? `radius ${n.size}` : `setback ${n.size}`;
      const them = picked.length === 1 ? "that edge" : `those ${picked.length} edges`;
      // Measured (test/solidfillets.test.ts): SMLib refuses to fillet an edge
      // that runs into an earlier fillet's face at a corner, whatever the
      // radius — and fillets both in one call. Said as what to do.
      if (n.op === "fillet" && this.meetsBlend(edges, names, picked)) {
        return fail(`the kernel cannot fillet ${them} where it runs into an earlier fillet — add it to that fillet instead `
          + `(Edit it and click the edge), or fillet both in one (${message(e)})`);
      }
      return fail(`the kernel could not ${verb} ${them} at ${what} — `
        + `${n.op === "fillet" ? "a radius" : "a setback"} too big for a face next to it is the usual reason (${message(e)})`);
    }
    // A sheet stays a sheet (a surface's edge rounded, docs/plans/surfaces.md); a solid must stay closed.
    if (!k.manifold(out) && !(k.sheet(before) && k.sheet(out))) {
      k.free(out);
      return fail(`the ${verb} left the body open — try a smaller ${n.op === "fillet" ? "radius" : "setback"}`);
    }
    const mids = picked.map((i) => edges[i].mid);
    k.faces(out).forEach((f, i) => {
      if (f.tag >= 0) return;
      let best = 0, bestD = Infinity;
      mids.forEach((m, j) => {
        const d = k.distanceToFace(out, i, m);
        if (d < bestD) [best, bestD] = [j, d];
      });
      k.tagFace(out, i, blendTag(n.id, of[best]));
    });
    if (k.sheet(out)) tagNewBoundary(k, out, n.id);
    return out;
  }

  /** Whether any picked edge ends where an edge of an earlier blend's face does. */
  private meetsBlend(edges: readonly EdgeInfo[], names: readonly string[], picked: readonly number[]): boolean {
    const blendFace = new RegExp(`(?:^|\\|)${this.prefix}(\\d+)\\.f\\d+`);
    const ends = edges.flatMap((e, i) => {
      const m = blendFace.exec(names[i]);
      return m && this.blends.has(Number(m[1])) ? [e.start, e.end] : [];
    });
    const near = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6 * Math.max(1, Math.hypot(...a));
    return picked.some((i) => ends.some((p) => near(p, edges[i].start) || near(p, edges[i].end)));
  }

  // ---- surfaces (docs/plans/surfaces.md) ------------------------------------

  /**
   * A chain a node carries inline (a knit's partner, the surface a trim cuts
   * by, the body a face is taken from), run from nothing outside every cache.
   * Its refusals are said as this chain's, under their own numbers.
   */
  private runChain(nodes: readonly Node[], index: number, c: Chain): Solid | null {
    const scratch: Chain = { keys: [], solids: [], failed: [], idle: [], missing: [], result: null };
    for (let i = 0; i < nodes.length; i++) scratch.solids.push(this.node(nodes[i], i, lastSolid(scratch), scratch));
    const s = lastSolid(scratch);
    for (const x of scratch.solids) if (x !== null && x !== s) this.k.free(x);
    for (const f of scratch.failed) c.failed.push({ node: index, id: f.id, why: f.why });
    return s;
  }

  private area(s: Solid): number {
    return this.k.faces(s).reduce((a, f) => a + (Number.isFinite(f.area) ? f.area : 0), 0);
  }

  /** One surface node. Null, said in `failed`, when the kernel refuses it — the chain goes on with what stood before. */
  private surface(n: SurfaceNode, index: number, before: Solid | null, c: Chain): Solid | null {
    const k = this.k;
    const fail = (why: string) => { c.failed.push({ node: index, id: n.id, why }); return null; };
    const made: Solid[] = [];
    // Every handle this node makes goes through `own`, so a throw part way spends them all.
    const own = (s: Solid) => { made.push(s); return s; };
    const keep = (s: Solid) => { made.splice(made.indexOf(s), 1); return s; };
    try {
      switch (n.op) {
        case "sheet": {
          if (n.sweep.kind === "extrude") {
            const s = own(k.sheetExtrude(n.profile, n.sweep.depth, n.at));
            tagSheetExtrude(k, s, n.id, n.profile, n.sweep.depth, n.at);
            return keep(s);
          }
          const r = n.sweep;
          const s = own(k.sheetRevolve(n.profile, r.point, r.dir, r.degrees, n.at));
          tagSheetRevolve(k, s, n.id, n.profile, r.point, r.dir, r.degrees, n.at);
          return keep(s);
        }
        case "planar": {
          // The cap of a one-unit extrude of the region, on its own (glue.cpp's
          // sm_extract_face says why not SMLib's own planar faces).
          const solid = own(k.extrude(n.profile, 1, n.at));
          const z = cross(n.at.x, n.at.y);
          const bi = k.faces(solid).findIndex((f) => f.kind === "plane" && Math.abs(dot(sub(f.point, n.at.origin), z)) < 1e-9);
          if (bi < 0) return fail("its region has no face — it does not close");
          const s = own(k.extractFace(solid, bi));
          tagPlanar(k, s, n.id, n.profile, n.at);
          return keep(s);
        }
        case "face": {
          const src = this.runChain(n.of, index, c);
          if (src === null) return fail(`what ${n.face} is a face of could not be made`);
          own(src);
          const fs = k.faces(src), es = k.edges(src);
          const names = namesOf(fs, es, this.prefix, this.blends, this.bare).faces;
          let fi = -1;
          names.forEach((name, i) => { if (name === n.face && (fi < 0 || fs[i].area > fs[fi].area)) fi = i; });
          if (fi < 0) return fail(`there is no face ${n.face} now — a change took it`);
          // Each edge of it is named after the face across it in the body: `s5.m0|e1.m1`.
          const across = es.flatMap((e) => (e.faces.includes(fi) ? [{ mid: e.mid, tag: fs[e.faces[0] === fi ? e.faces[1] : e.faces[0]]?.tag ?? -1 }] : []));
          const s = own(k.extractFace(src, fi));
          k.faces(s).forEach((_, i) => k.tagFace(s, i, blendTag(n.id, 0)));
          k.edges(s).forEach((e, i) => {
            let best = -1, bestD = Infinity;
            across.forEach((a, j) => { const d = dist(a.mid, e.mid); if (d < bestD) [best, bestD] = [j, d]; });
            k.tagEdge(s, i, best >= 0 && across[best].tag >= 0 ? across[best].tag : n.id * 1000);
          });
          return keep(s);
        }
        case "offset": {
          const src = this.runChain(n.of, index, c);
          if (src === null) return fail("the surface it offsets could not be made");
          own(src);
          if (!k.sheet(src)) return fail("it offsets a surface, and what it names is a solid now");
          const s = own(k.offsetSheet(src, n.distance));
          // Its own names: the source's faces, in tag order, are s3.m0, s3.m1 …;
          // a boundary edge keeps its sweep's role (s3.lid), any other is s3's.
          const tags = [...new Set(k.faces(s).map((f) => f.tag))].sort((a, b) => a - b);
          k.faces(s).forEach((f, i) => k.tagFace(s, i, blendTag(n.id, tags.indexOf(f.tag))));
          k.edges(s).forEach((e, i) => {
            if (!e.lamina) return;
            const r = roleOf(e.tag);
            k.tagEdge(s, i, n.id * 1000 + (r === 0 || r === 1 || r === 490 || r === 491 ? r : 0));
          });
          return keep(s);
        }
        case "trim": {
          if (before === null) return fail("there is no surface to trim");
          const out = own(k.copy(before));
          const was = this.area(out);
          if (n.curve) {
            k.trimByCurve(out, n.curve.member, n.curve.at, n.curve.dir, n.keep);
          } else {
            const by = n.by ? this.runChain(n.by, index, c) : null;
            if (by === null) return fail("the surface it trims by could not be made");
            own(by);
            k.trimBySheet(out, by, [0, 0, 0], n.keep);
          }
          if (!k.faces(out).length) return fail("nothing of the surface would be left");
          if (Math.abs(this.area(out) - was) <= 1e-9 * Math.max(1, was)) c.idle.push({ node: index, id: n.id });
          tagNewBoundary(k, out, n.id);
          return keep(out);
        }
        case "knit": {
          if (before === null) return fail("there is no surface to knit into");
          const out = own(k.copy(before));
          let stitched = 0;
          for (const w of n.with) {
            const t = this.runChain(w, index, c);
            if (t === null) continue;
            stitched += k.knit(out, t, n.tolerance).stitched;
          }
          if (stitched === 0) {
            return fail(`their edges do not meet — no edge of one runs along an edge of the other within ${n.tolerance}; trim or extend one to the other first`);
          }
          return keep(out);
        }
        case "thicken": {
          if (before === null) return fail("there is no surface to thicken");
          let out: Solid;
          if (k.manifold(before)) {
            // A closed knit is a closed shell: thickened, it is the hollow between
            // it and its offset — outward the offset less it, inward it less the
            // offset (measured: the ruled thicken of a closed shell is two solids,
            // not one with a void).
            const off = own(k.offsetSheet(before, n.distance));
            const it = own(k.copy(before));
            keep(off);
            keep(it);
            out = own(n.distance > 0 ? k.boolean("subtract", off, it) : k.boolean("subtract", it, off));
          } else {
            if (!k.sheet(before)) return fail("it is no sheet the kernel can thicken");
            out = own(k.thicken(before, n.distance));
          }
          tagOffsets(k, before, out);
          // A wall is named after the boundary edge it stands on: s5.f0, s5.f1 … in the sheet's edge order.
          const rims = k.edges(before).filter((e) => e.lamina).map((e) => e.mid);
          k.faces(out).forEach((f, i) => {
            if (f.tag >= 0) return;
            let best = 0, bestD = Infinity;
            rims.forEach((m, j) => { const d = k.distanceToFace(out, i, m); if (d < bestD) [best, bestD] = [j, d]; });
            k.tagFace(out, i, blendTag(n.id, best));
          });
          return keep(out);
        }
        case "solidify": {
          if (before === null) return fail("there is no surface to close");
          const out = own(k.copy(before));
          if (!k.solidify(out) || !k.manifold(out)) {
            const open = k.edges(out).filter((e) => e.lamina).length;
            return fail(`it is not closed — ${open} edge${open === 1 ? " is" : "s are"} not knitted to another; knit the surfaces that close it first`);
          }
          return keep(out);
        }
        case "pairFillet":
        case "pairChamfer":
          return this.pair(n, index, before, c, own, keep, fail);
        default:
          return fail("it is no surface operation this build knows");
      }
    } catch (e) {
      return fail(message(e));
    } finally {
      for (const s of made) k.free(s);
    }
  }

  /** A surface trimmed in place where `by` crosses it, keeping `keep`'s side — or, given none, the larger piece. */
  private trimKeeping(s: Solid, by: Solid, keep: V3 | null): void {
    const k = this.k;
    if (keep) { k.trimBySheet(s, by, [0, 0, 0], keep); return; }
    const pts = k.crossing(s, by);
    if (!pts.length) throw new Error("they do not cross");
    const fs = k.faces(s);
    const big = fs.reduce((b, f, i) => (f.area > fs[b].area ? i : b), 0);
    const p = fs[big].point;
    const near = pts.reduce((b, q) => (dist(q, p) < dist(b, p) ? q : b), pts[0]);
    // The other side: p reflected through the crossing nearest it.
    const q: V3 = [2 * near[0] - p[0], 2 * near[1] - p[1], 2 * near[2] - p[2]];
    const tryOn = (r: V3) => {
      const t = k.copy(s);
      try {
        k.trimBySheet(t, by, [0, 0, 0], r);
        return this.area(t);
      } catch {
        return -1;
      } finally {
        k.free(t);
      }
    };
    const [ap, aq] = [tryOn(p), tryOn(q)];
    if (ap < 0 && aq < 0) throw new Error("the kernel could not trim either side");
    k.trimBySheet(s, by, [0, 0, 0], ap >= aq ? p : q);
  }

  private pair(n: PairBlendNode, index: number, before: Solid | null, c: Chain,
    own: (s: Solid) => Solid, keep: (s: Solid) => Solid, fail: (why: string) => null): Solid | null {
    const k = this.k;
    const verb = n.op === "pairFillet" ? "fillet" : "chamfer";
    // A handle this node made and no longer needs: spent now, not kept.
    const made = (s: Solid) => { keep(s); k.free(s); };
    if (before === null) return fail(`there is no surface to ${verb}`);
    if (!(n.size > 0) || !Number.isFinite(n.size)) return fail(`its ${n.op === "pairFillet" ? "radius" : "setback"} is ${n.size}, and must be more than 0`);
    let out = own(k.copy(before));
    if (n.with) {
      const t = this.runChain(n.with, index, c);
      if (t === null) return fail(`the surface it ${verb}s to could not be made`);
      own(t);
      const box = k.bbox(out);
      const tol = Math.max(1e-5, 1e-6 * dist(box[0], box[1]));
      // Meeting at an edge: knitted as they are. Crossing: each trimmed back to the other first.
      const trial = own(k.copy(out));
      if (k.knit(trial, own(k.copy(t)), tol).stitched > 0) {
        made(out);
        out = trial;
      } else {
        made(trial);
        const a0 = own(k.copy(out));
        try {
          this.trimKeeping(out, t, n.keep[0]);
          this.trimKeeping(t, a0, n.keep[1]);
        } catch (e) {
          return fail(`they neither meet at an edge nor cross where both can be trimmed back (${message(e)})`);
        }
        keep(t);
        if (k.knit(out, t, tol).stitched === 0) return fail("trimmed back to each other, their edges still do not meet");
      }
    }
    const fs = k.faces(out), es = k.edges(out);
    const feature = (i: number) => (i >= 0 && fs[i] && fs[i].tag >= 0 ? Math.floor(fs[i].tag / 1000) : -1);
    const A = new Set(n.a), B = new Set(n.b);
    const picked: number[] = [];
    es.forEach((e, i) => {
      if (e.lamina || e.faces[0] < 0 || e.faces[1] < 0) return;
      const [x, y] = [feature(e.faces[0]), feature(e.faces[1])];
      if ((A.has(x) && B.has(y)) || (A.has(y) && B.has(x))) picked.push(i);
    });
    if (!picked.length) return fail("no edge runs between the two — knit them first, or let this trim them to each other");
    const mids = picked.map((i) => es[i].mid);
    try {
      if (n.op === "pairFillet") k.fillet(out, picked, n.size);
      else k.chamfer(out, picked, n.size);
    } catch (e) {
      return fail(`the kernel could not ${verb} the edge between them at ${n.size} — a size too big for a face beside it is the usual reason (${message(e)})`);
    }
    k.faces(out).forEach((f, i) => {
      if (f.tag >= 0) return;
      let best = 0, bestD = Infinity;
      mids.forEach((m, j) => { const d = k.distanceToFace(out, i, m); if (d < bestD) [best, bestD] = [j, d]; });
      k.tagFace(out, i, blendTag(n.id, best));
    });
    tagNewBoundary(k, out, n.id);
    return keep(out);
  }


  private extract(s: Solid, p: Program): NonNullable<BodyResult["solid"]> {
    const k = this.k;
    const faces = k.faces(s);
    const edges = k.edges(s);
    const names = namesOf(faces, edges, p.prefix, this.blends, this.bare);
    const box = k.bbox(s);
    const diag = Math.hypot(box[1][0] - box[0][0], box[1][1] - box[0][1], box[1][2] - box[0][2]);
    return {
      volume: k.volume(s),
      box,
      validity: k.validity(s),
      faces: faces.map((f, i) => ({ ...f, name: names.faces[i], piece: names.pieces[i] })),
      edges: edges.map((e, i) => ({ ...e, name: names.edges[i] })),
      mesh: k.tessellate(s, p.chord * diag, p.angle),
      lines: k.edgePolylines(s, p.angle),
    };
  }
}

function lastSolid(c: Chain): Solid | null {
  for (let i = c.solids.length - 1; i >= 0; i--) if (c.solids[i] !== null) return c.solids[i];
  return null;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
