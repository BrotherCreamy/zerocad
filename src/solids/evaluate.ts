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

import type { BooleanOp, EdgeInfo, FaceInfo, Mesh, Placement, Profile, Solid, SolidKernel, Topology, V2, V3, Validity } from "./kernel.ts";
import { BLEND_EDGES, blendTag, namesOf, tagExtrude, tagRevolve } from "./naming.ts";

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

export type Node = SweepNode | BlendNode;

export function isBlend(n: Node): n is BlendNode {
  return n.op === "fillet" || n.op === "chamfer";
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
    chain = `${chain}|${JSON.stringify(isBlend(n) ? [n.id, n.op, n.edges, n.size] : [n.id, n.op, n.sweep, n.profile, n.at])}`;
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
  private prefix = "e";

  constructor(k: SolidKernel) {
    this.k = k;
  }

  run(p: Program): ProgramResult {
    this.blends = new Set(p.bodies.flatMap((b) => b.nodes.filter(isBlend).map((n) => n.id)));
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
    const names = namesOf(k.faces(before), edges, this.prefix, this.blends).edges;
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
      return fail(`the kernel could not ${verb} ${picked.length === 1 ? "that edge" : `those ${picked.length} edges`} at ${what} — `
        + `${n.op === "fillet" ? "a radius" : "a setback"} too big for a face next to it is the usual reason (${message(e)})`);
    }
    if (!k.manifold(out)) {
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
    return out;
  }

  private extract(s: Solid, p: Program): NonNullable<BodyResult["solid"]> {
    const k = this.k;
    const faces = k.faces(s);
    const edges = k.edges(s);
    const names = namesOf(faces, edges, p.prefix, this.blends);
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
