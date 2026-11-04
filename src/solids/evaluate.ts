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
import { namesOf, tagExtrude, tagRevolve } from "./naming.ts";

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

export interface BodyProgram {
  /** The caller's name for it — returned with its result, never read. */
  name: string;
  nodes: SweepNode[];
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
export function nodeKeys(nodes: readonly SweepNode[]): string[] {
  const keys: string[] = [];
  let chain = "";
  for (const n of nodes) {
    chain = `${chain}|${JSON.stringify([n.id, n.op, n.sweep, n.profile, n.at])}`;
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
  /** The result as last extracted, for the last key. */
  result: BodyResult | null;
}

export class Evaluator {
  private k: SolidKernel;
  private chains = new Map<string, Chain>();
  /** Last tessellation settings, which a cached result is only good for. */
  private tess = "";

  constructor(k: SolidKernel) {
    this.k = k;
  }

  run(p: Program): ProgramResult {
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
  }

  private body(b: BodyProgram, p: Program): BodyResult {
    const keys = nodeKeys(b.nodes);
    let c = this.chains.get(b.name);
    if (!c) {
      c = { keys: [], solids: [], failed: [], idle: [], result: null };
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
      name: b.name, key, failed: [...c.failed], idle: [...c.idle], solid: null, ms: 0,
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
  private node(n: SweepNode, index: number, before: Solid | null, c: Chain): Solid | null {
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
    // measured: a lone line extrudes to one face, volume 0, not manifold.
    // (A volume the kernel could not integrate, NaN, is no evidence either way: the manifold test decides.)
    if (k.volume(tool) <= 0 || !k.validity(tool).manifold) {
      k.free(tool);
      c.failed.push({ node: index, id: n.id, why: `its ${n.sweep.kind} is not a solid — its profile does not close` });
      return null;
    }
    if (before === null || n.op === "new") {
      // The first node, or a body whose first node failed: whatever stands is the body.
      if (before !== null) k.free(tool);
      return before === null ? tool : null;
    }
    const was = k.volume(before);
    const a = k.copy(before);
    try {
      const out = k.boolean(n.op, a, tool);
      const now = k.volume(out);
      if (now <= 0) {
        // Nothing left: an intersect that misses, a cut that takes everything.
        k.free(out);
        c.failed.push({ node: index, id: n.id, why: n.op === "intersect" ? "it does not overlap the body, so nothing would be left" : "nothing of the body would be left" });
        return null;
      }
      if (Math.abs(now - was) <= 1e-9 * Math.max(1, Math.abs(was))) c.idle.push({ node: index, id: n.id });
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

  private extract(s: Solid, p: Program): NonNullable<BodyResult["solid"]> {
    const k = this.k;
    const faces = k.faces(s);
    const edges = k.edges(s);
    const names = namesOf(faces, edges, p.prefix);
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
