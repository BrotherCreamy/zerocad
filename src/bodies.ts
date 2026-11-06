// The bodies a model's features make, as the solid kernel builds them — the
// page's side of evaluation (docs/plans/solids-kernel.md).
//
// **What the kernel builds, and what it does not.** A body is a chain
// (modes.ts): its first feature and everything added to, cut from or
// intersected with it. A body of **one** feature — every body an old file has,
// and every new body until something is added to it — is drawn as it always
// was, from its live geometry (faces.ts): every frame, at the screen's
// resolution, following a drag with no lag and no kernel at all. A body of
// two or more is the kernel's: its faces are the kernel's tessellation, each
// triangle carrying the face it lies on, and its edges the kernel's edges.
// Only those are sent to the Worker. So old files draw pixel for pixel as they
// did, the app is whole before the kernel has loaded, and the kernel's cost is
// paid only where a boolean is.
//
// **Asynchronous, cached, and never a broken picture.** `sync` is called
// every frame; it reads the program off the model (cheap — the profiles as
// numbers) and sends it only when it differs from the last sent, one request
// in flight and the newest waiting. Until an answer arrives the last good body
// is drawn — a drag shows the body as it last was, then as it is. A body the
// kernel refuses (a boolean that fails), or that it cannot reach at all (no
// Worker, a crash), keeps its last good solid and says why (`report`). A body
// that has none yet is drawn as its features' own solids, cuts left out
// (`fallback`): a boss on a plate looks right, a hole is missing, and the
// status says the kernel is not there.
//
// Above the model, beside solids.ts: it reads the model, and the kernel only
// through the client's messages. Faces are faces.ts's `Face`, so the face
// layer, the painter's, the occlusion answer and the quiet set take a
// kernel's body exactly as they take an extrude's.

import { isBlendFeature, type FeatureEntry, type Model } from "./model.ts";
import { chainsOf, interiorPoint, modeOf, type Chain } from "./modes.ts";
import { insideProfile } from "./solids/profile.ts";
import { kernelSweep } from "./solids.ts";
import type { Face } from "./faces.ts";
import { depth, viewAxes, worldToScreen, type View } from "./view.ts";
import { allNodes, isBlend, nodeKeys, type BlendNode, type PairBlendNode, type BodyResult, type Node, type NodeOp, type Program, type ProgramResult } from "./solids/evaluate.ts";
import { featureLabel, tagParts } from "./solids/naming.ts";
import { surfacePrograms, type PairAsk } from "./surfaces.ts";
import type { SolidsClient } from "./solids/client.ts";
import type { Topology } from "./solids/kernel.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

/** What face names are spelled with: a feature's own name, `e3`. */
export const PREFIX = "e";
/** Tessellation: chord height a part in 2000 of the body's diagonal, ten degrees between facets. */
export const CHORD = 5e-4;
export const ANGLE = 10;

const OPS: Record<string, NodeOp> = { new: "new", add: "union", cut: "subtract", intersect: "intersect" };

/** A feature's number — its tag's (naming.ts). Features are named `e1`, `e2`, … by `addFeature`. */
export function featureId(name: string): number {
  const m = /^e(\d+)$/.exec(name);
  if (!m) throw new Error(`"${name}" is not a feature's name`);
  return Number(m[1]);
}

export interface ProgramOf {
  program: Program;
  /** Each kernel body's chain, by its name. */
  chains: Map<string, Chain>;
  /** Features that could not be laid out (no depth, a collapsed plane), and why. */
  skipped: { feature: string; why: string }[];
  /** The preview tried in it, if any. */
  trial?: BlendTrial;
}

/**
 * A fillet or chamfer **tried** in a body's chain and not made — what the
 * fillet tool and its edit dialog preview (docs/plans/solid-fillets.md): the
 * kernel builds the body with `node` in its chain, appended, or in place of
 * the blend numbered `replace` (an edit), and the answer is drawn in the
 * body's place until the trial ends. Its own key, so the body's cache keeps
 * everything before it and a drag of the radius rebuilds only the blend.
 */
export interface BlendTrial {
  body: string;
  /** A fillet or chamfer of edges — or, on a surface, one between two surfaces (surfaces.md). */
  node: BlendNode | PairBlendNode;
  /** Bodies the preview takes in and so stands for: the other surface of a fillet between two, not drawn on its own meanwhile. */
  hides?: string[];
  replace?: number;
}

/**
 * The program for the model's bodies of two or more features — or every body,
 * with `all` (the tests measure single features against solids.ts that way) —
 * with `trial` tried in its body's chain.
 */
export function programOf(model: Model, all = false, trial: BlendTrial | null = null): ProgramOf {
  const chains = new Map<string, Chain>();
  const skipped: ProgramOf["skipped"] = [];
  const bodies: Program["bodies"] = [];
  /** Every body's nodes, shown or not and of one sweep or more: what a surface taken from a body's face is built from. */
  const nodesOf = new Map<string, Node[]>();
  const lay = (chain: Chain, said: boolean): Node[] => {
    const nodes: Node[] = [];
    for (const f of chain.steps) {
      if (isBlendFeature(f)) {
        // Before the first sweep is laid out there is nothing to round: left
        // out with the sweep that could not be, which is said already.
        if (!nodes.length) continue;
        const size = model.relations.get(f.size)?.args[0];
        nodes.push({ id: featureId(f.name), op: f.kind, edges: [...f.edges], size: typeof size === "number" ? size : NaN });
        continue;
      }
      const sw = f;
      try {
        const { at, profile, sweep } = kernelSweep(model, sw);
        nodes.push({ id: featureId(f.name), op: nodes.length === 0 ? "new" : OPS[modeOf(sw)], sweep, profile, at });
      } catch (e) {
        if (said) skipped.push({ feature: f.name, why: e instanceof Error ? e.message : String(e) });
      }
    }
    return nodes;
  };
  for (const chain of chainsOf(model).bodies) {
    const tried = trial !== null && trial.body === chain.name;
    // A body of one sweep is faces.ts's — unless it is rounded: a fillet is
    // the kernel's alone, so one extrude and its fillet is a kernel body.
    if (!all && chain.steps.length < 2 && !tried) continue;
    const nodes = lay(chain, true);
    for (const f of chain.steps) nodesOf.set(f.name, [...nodes]);
    if (!nodes.length) continue;
    if (tried) {
      const at = trial.replace === undefined ? -1 : nodes.findIndex((n) => n.id === trial.replace);
      if (at >= 0) nodes[at] = trial.node;
      // A new blend's trial steps aside once the blend it previews is made:
      // between ✓ and the tool letting go, both would be in the chain, and the
      // second would find its edges already rounded (seen in the browser: a
      // refusal logged for a fillet that had just succeeded).
      else if (!nodes.some((n) => n.id === trial.node.id)) nodes.push(trial.node);
    }
    chains.set(chain.name, chain);
    bodies.push({ name: chain.name, nodes });
  }
  // Surfaces (docs/plans/surfaces.md): every one is the kernel's — a sheet has
  // no live drawing of its own — each a body of the program under its name.
  // A trial on a surface (the round tool's preview) is tried as a body's is.
  const sp = surfacePrograms(model, (feature) => {
    if (nodesOf.has(feature)) return nodesOf.get(feature)!;
    // A body of one sweep (faces.ts's), laid out only when a surface asks;
    // a body hidden whole still has faces a surface may have been taken from.
    const c = chainsOf(model).bodies.find((x) => x.steps.some((f) => f.name === feature))
      ?? chainsOf(model, { hidden: true }).bodies.find((x) => x.steps.some((f) => f.name === feature));
    return c ? lay(c, false) : null;
  });
  skipped.push(...sp.skipped);
  for (const b of sp.bodies) {
    const nodes = [...b.nodes];
    if (trial !== null && trial.body === b.name) {
      const at = trial.replace === undefined ? -1 : nodes.findIndex((n) => n.id === trial.replace);
      if (at >= 0) nodes[at] = trial.node;
      else if (!nodes.some((n) => n.id === trial.node.id)) nodes.push(trial.node);
    }
    chains.set(b.name, { name: b.name, features: [], steps: [] });
    bodies.push({ name: b.name, nodes });
  }
  return { program: { bodies, prefix: PREFIX, chord: CHORD, angle: ANGLE }, chains, skipped, ...(trial ? { trial } : {}) };
}

/**
 * A fillet or chamfer between two surfaces as the node its record would make
 * (docs/plans/surfaces.md) — what the round tool previews before ✓; null where
 * it cannot be laid out.
 */
export function pairTrial(model: Model, ask: PairAsk): PairBlendNode | null {
  const every = programOf(model, true).program.bodies;
  const byFeature = (feature: string) => {
    const c = chainsOf(model, { hidden: true }).bodies.find((x) => x.steps.some((f) => f.name === feature));
    return c ? every.find((b) => b.name === c.name)?.nodes ?? null : null;
  };
  return surfacePrograms(model, byFeature, ask).trial ?? null;
}

// ---- the kernel's answer, as faces --------------------------------------------------

/** One triangle of a kernel body, as faces.ts says a face — plus which kernel face it is a piece of. */
export interface KernelFace extends Face {
  /** Index of the kernel face it lies on, in the body's `faces`. */
  face: number;
}

export interface BodyView {
  name: string;
  /** The chain's features when this was built — a view of other features is not this body's. */
  features: string[];
  result: BodyResult;
  /** Every triangle, outward. */
  faces: KernelFace[];
}

/** The role a tag gives a face, in faces.ts's words: a cap is base or lid, everything else a wall. */
function kindOf(tag: number): Face["kind"] {
  if (tag < 0) return "wall";
  const { role } = tagParts(tag);
  return role === "base" ? "base" : role === "lid" ? "lid" : "wall";
}

function triangleDistance(p: number[], a: number[], b: number[], c: number[]): number {
  // Distance to the triangle's boundary is what matters for an edge lying on it.
  const seg = (x: number[], y: number[]) => {
    const d = sub3(y, x);
    const len2 = dot3(d, d);
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, dot3(sub3(p, x), d) / len2));
    return Math.hypot(...sub3(p, x.map((v, i) => v + t * d[i])));
  };
  return Math.min(seg(a, b), seg(b, c), seg(c, a));
}

/**
 * A body's triangles as faces, outward, each edge segment handed to the
 * triangle on either side it runs along — so the face layer draws an edge
 * exactly where one of its faces is drawn, as it does an extrude's. A seam
 * (a whole cylinder's) is no edge of the shape and is not drawn.
 */
export function bodyFaces(result: BodyResult): KernelFace[] {
  const s = result.solid;
  if (!s) return [];
  const { positions, triangles, faceOf } = s.mesh;
  const at = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const n = faceOf.length;
  // Outward: the kernel's winding, turned over whole if its volume reads negative.
  let vol = 0;
  for (let t = 0; t < n; t++) {
    const [a, b, c] = [at(triangles[t * 3]), at(triangles[t * 3 + 1]), at(triangles[t * 3 + 2])];
    vol += dot3(a, cross3(b, c));
  }
  const flip = vol < 0;
  const faces: KernelFace[] = [];
  const byFace = new Map<number, number[]>();
  for (let t = 0; t < n; t++) {
    let [a, b, c] = [at(triangles[t * 3]), at(triangles[t * 3 + 1]), at(triangles[t * 3 + 2])];
    if (flip) [b, c] = [c, b];
    const normal = unit3(cross3(sub3(b, a), sub3(c, a)));
    if (!normal) continue; // a sliver with no area draws nothing and hides nothing
    const face = faceOf[t];
    const record = s.faces[face];
    const tag = record?.tag ?? -1;
    const feature = tag >= 0 ? featureLabel(tagParts(tag).feature, PREFIX) : result.name;
    faces.push({
      feature, kind: kindOf(tag), outlines: [[a, b, c]], normal,
      centroid: [0, 1, 2].map((i) => (a[i] + b[i] + c[i]) / 3), edges: [], face,
    });
    if (!byFace.has(face)) byFace.set(face, []);
    byFace.get(face)!.push(faces.length - 1);
  }
  // A sheet (a surface, docs/plans/surfaces.md) has two sides and no inside:
  // each triangle is drawn and picked from both, so the face layer — which
  // shows a face from its outward side — shows a surface from either.
  const twin = new Map<number, number>();
  if (!s.validity.manifold) {
    const one = faces.length;
    for (let t = 0; t < one; t++) {
      const f = faces[t];
      const [a, b, c] = f.outlines[0];
      faces.push({ ...f, outlines: [[a, c, b]], normal: f.normal.map((x) => -x), edges: [] });
      twin.set(t, faces.length - 1);
    }
  }
  for (const line of s.lines) {
    const e = s.edges[line.edge];
    if (!e || e.name.endsWith(":seam")) continue;
    const pts: number[][] = [];
    for (let i = 0; i < line.points.length / 3; i++) pts.push([line.points[i * 3], line.points[i * 3 + 1], line.points[i * 3 + 2]]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const mid = pts[i].map((v, k) => (v + pts[i + 1][k]) / 2);
      for (const fi of new Set(e.faces.filter((f) => f >= 0))) {
        let best = -1, bestD = Infinity;
        for (const t of byFace.get(fi) ?? []) {
          const [a, b, c] = faces[t].outlines[0];
          const d = triangleDistance(mid, a, b, c);
          if (d < bestD) [best, bestD] = [t, d];
        }
        if (best >= 0) {
          faces[best].edges.push([pts[i], pts[i + 1]]);
          const other = twin.get(best);
          if (other !== undefined) faces[other].edges.push([pts[i], pts[i + 1]]);
        }
      }
    }
  }
  return faces;
}

// ---- picking ---------------------------------------------------------------------------

export interface SolidHit {
  body: string;
  /** Index of the kernel face, in the body's `faces`. */
  face: number;
  /** Its name — `e1.lid` — and its tag. */
  name: string;
  tag: number;
  /** Whether the face is flat (so a sketch can stand on it). */
  planar: boolean;
  /** Where the pixel's ray meets it, in the world, and how near that is (`depth`: larger nearer). */
  at: number[];
  depth: number;
  normal: number[];
}

/**
 * The cap of another feature a feature was sketched on, by name — `e2.lid`,
 * `e2.base` — or null. Asked of the geometry, not of the plane reference: a
 * point inside the feature's profile lies on that cap's plane, inside that
 * cap's profile — whichever plane the sketch was held to (three of the lid's
 * points, a twin circle, or a curve's own plane parallel to it). The first
 * feature made that holds it wins, as the face a sketch stands on was there
 * before the sketch.
 */
export function faceUnder(model: Model, g: FeatureEntry): string | null {
  let q: number[] | null;
  try {
    q = interiorPoint(model, g);
  } catch {
    return null;
  }
  if (!q) return null;
  for (const f of model.features.values()) {
    if (f.name === g.name) break;
    if (f.kind !== "extrude") continue;
    let sw;
    try {
      sw = kernelSweep(model, f);
    } catch {
      continue;
    }
    if (sw.sweep.kind !== "extrude") continue;
    const z = cross3(sw.at.x, sw.at.y);
    const d = sub3(q, sw.at.origin);
    const h = dot3(d, z);
    const size = Math.max(1, Math.abs(sw.sweep.depth));
    const local: [number, number] = [dot3(d, sw.at.x), dot3(d, sw.at.y)];
    if (!insideProfile(sw.profile, local)) continue;
    if (Math.abs(h - sw.sweep.depth) < 1e-6 * size) return `${f.name}.lid`;
    if (Math.abs(h) < 1e-6 * size) return `${f.name}.base`;
  }
  return null;
}

// ---- the state -------------------------------------------------------------------------

export interface Report {
  /** One line per thing worth saying: a refusal, a cut that removed nothing, a body left out, the kernel missing. */
  lines: string[];
  /** Whether every kernel body on screen is the one its features make now. */
  current: boolean;
}

/** What `drawn` hands the face layer: the kernel's faces, and the features they stand in for. */
export interface SolidFaces {
  faces: Face[];
  replaces: ReadonlySet<string>;
}

export class Bodies {
  private client: SolidsClient | null;
  private onChange: () => void;
  /** The last good view of each body, by name. */
  private good = new Map<string, BodyView>();
  /** The last answer for each body, good or not. */
  private latest = new Map<string, BodyResult>();
  private sent = "";
  private waiting: ProgramOf | null = null;
  private inflight = false;
  private failure: string | null = null;
  private current: ProgramOf | null = null;
  private model: Model | null = null;
  /** Milliseconds the last answer took, round trip, and the kernel's own share. */
  timing = { roundTrip: 0, kernel: 0 };
  /** Every answer's round trip, for a measurement to read (the e2e suite logs them). */
  readonly history: { roundTrip: number; kernel: number }[] = [];

  /** Milliseconds from starting the kernel's Worker to its module being ready, the last time one started. */
  get loadMs(): number {
    return this.client?.loadMs ?? 0;
  }
  /** How many answers have arrived — what a test waits on. */
  answers = 0;

  /** The fillet or chamfer being previewed, if any (`BlendTrial`). */
  private trying: BlendTrial | null = null;
  /**
   * The body as the trial last built it — drawn in the body's place while the
   * trial is up, and after it ends until the body's own next answer arrives,
   * so neither ✓ nor ✗ flashes the body as it was (the last good body stands
   * until the new one arrives, as a drag's does).
   */
  private tried: BodyView | null = null;
  /** The kernel's refusal of the trial's blend, as last answered; null when it took. */
  private triedWhy: string | null = null;

  /**
   * Tries a fillet or chamfer in its body's chain (the preview), or ends the
   * trial with null. Read by the next `sync`, which every frame calls.
   */
  trial(t: BlendTrial | null): boolean {
    if (JSON.stringify(t) === JSON.stringify(this.trying)) return false;
    this.trying = t;
    this.triedWhy = null;
    return true;
  }

  /**
   * Whether every body is the kernel's, a body of one sweep included — while a
   * tool that works on kernel edges is armed, so a plain extruded box has
   * edges to pick. Off, a body of one sweep is faces.ts's (and no Worker is
   * started for a drawing with no boolean in it).
   */
  everything = false;

  /** Whether the trial's answer is in, and the kernel's refusal of it if it refused. */
  trialAnswer(): { settled: boolean; why: string | null } {
    return { settled: this.trying !== null && this.settled, why: this.triedWhy };
  }

  constructor(client: SolidsClient | null, onChange: () => void) {
    this.client = client;
    this.onChange = onChange;
  }

  /**
   * Reads the program off the model and sends it if it is new. Called every
   * frame; costs a comparison when nothing changed.
   */
  sync(model: Model): void {
    this.model = model;
    const p = programOf(model, this.everything, this.trying);
    this.current = p;
    const text = JSON.stringify(p.program);
    if (text === this.sent) return;
    this.sent = text;
    // Nothing for the kernel to build — no body of two features: no Worker is
    // started for it. It was, on every page load, an empty program sent and
    // 4 MB of wasm fetched and compiled for nothing, which the spec's "loaded
    // only when a body needs it" never meant. Whatever an earlier program left
    // is let go here rather than by an answer.
    if (p.program.bodies.length === 0 && !this.inflight) {
      this.take(p, { bodies: [], heap: { inUse: 0, reserved: 0 } });
      return;
    }
    if (!this.client) return;
    if (this.inflight) {
      this.waiting = p;
      return;
    }
    void this.send(p);
  }

  /** Whether the program last read has its answer: every kernel body is the one its features make now. */
  get settled(): boolean {
    return !this.inflight && this.waiting === null && (this.current?.program.bodies ?? []).every((b) => {
      const keys = nodeKeys(b.nodes);
      return this.latest.get(b.name)?.key === keys[keys.length - 1];
    });
  }

  private async send(p: ProgramOf): Promise<void> {
    this.inflight = true;
    const t0 = performance.now();
    try {
      const r: ProgramResult = await this.client!.run(p.program);
      this.failure = null;
      this.timing = { roundTrip: performance.now() - t0, kernel: r.bodies.reduce((s, b) => s + b.ms, 0) };
      this.history.push(this.timing);
      this.take(p, r);
    } catch (e) {
      // The client restarted its Worker, or there is none: the last good bodies
      // stand, the report says why, and the next change asks again.
      this.failure = e instanceof Error ? e.message : String(e);
      this.sent = "";
    } finally {
      this.inflight = false;
      this.answers++;
      const next = this.waiting;
      this.waiting = null;
      if (next) {
        this.sent = JSON.stringify(next.program);
        void this.send(next);
      }
      this.onChange();
    }
  }

  private take(p: ProgramOf, r: ProgramResult): void {
    const names = new Set(p.program.bodies.map((b) => b.name));
    for (const b of r.bodies) {
      const prev = this.latest.get(b.name);
      // Unchanged since the last answer: the solid then is the solid now.
      const result = b.cached && prev ? { ...prev, ms: 0 } : b;
      this.latest.set(b.name, result);
      const features = p.chains.get(b.name)?.features.map((f) => f.name) ?? [];
      // The trial's body: its answer is the preview, kept apart from the last
      // good body. A blend the kernel refuses keeps the preview it had — the
      // body without it would read as the fillet vanishing — and says why.
      const trial = p.trial?.body === b.name ? p.trial : null;
      if (trial) {
        // An answer to a trial since ended or changed says nothing about the one up now.
        if (JSON.stringify(trial) !== JSON.stringify(this.trying)) continue;
        const refused = result.failed.find((f) => f.id === trial.node.id);
        this.triedWhy = refused ? refused.why : null;
        if (!refused && result.solid) this.tried = { name: b.name, features, result, faces: bodyFaces(result) };
        continue;
      }
      if (this.tried?.name === b.name) this.tried = null;
      // A body with a refusal keeps its last good solid — unless it has none,
      // when the best the kernel could do is better than nothing.
      const had = this.good.get(b.name);
      if (!result.solid) continue;
      // A fillet or chamfer refused is left out and the rest of the body
      // stands — the body without it is the body now (a cut that took its
      // edges is drawn cut). Any other refusal keeps the last good body.
      const blends = new Set(p.program.bodies.find((x) => x.name === b.name)?.nodes.filter(isBlend).map((n) => n.id) ?? []);
      const refused = result.failed.filter((f) => !blends.has(f.id));
      if (refused.length && had && had.features.join() === features.join()) continue;
      if (had && had.result.key === result.key) continue;
      this.good.set(b.name, { name: b.name, features, result, faces: bodyFaces(result) });
    }
    for (const n of [...this.good.keys()]) if (!names.has(n)) this.good.delete(n);
    if (this.tried && !names.has(this.tried.name)) this.tried = null;
    for (const n of [...this.latest.keys()]) if (!names.has(n)) this.latest.delete(n);
  }

  /** The views to draw: each kernel body's last good one, where it is of the body's features as they are now. */
  views(): BodyView[] {
    return this.viewsOf(true);
  }

  /**
   * The views without the trial's preview: the bodies as they are made — what
   * a fillet's edges are picked on, so a click lands on the body being
   * rounded and never on the preview of its rounding.
   */
  madeViews(): BodyView[] {
    return this.viewsOf(false);
  }

  private viewsOf(withTrial: boolean): BodyView[] {
    const out: BodyView[] = [];
    // A fillet's preview between two surfaces stands for both: the other is not drawn apart meanwhile.
    const hidden = new Set(withTrial ? this.trying?.hides ?? [] : []);
    for (const [name, chain] of this.current?.chains ?? []) {
      if (hidden.has(name)) continue;
      const v = withTrial && this.tried?.name === name ? this.tried : this.good.get(name);
      if (v && v.features.join() === chain.features.map((f) => f.name).join()) out.push(v);
    }
    return out;
  }

  /**
   * The kernel's faces for the face layer, and the features they stand in for
   * — every feature of every kernel body, drawn or not: a body still waiting
   * for its first answer is drawn from its features' own faces instead, but
   * never its cuts (`fallback`), which as solids would be the opposite of
   * what they are.
   */
  drawn(): SolidFaces {
    const faces: Face[] = [];
    const replaces = new Set<string>();
    const views = new Map(this.views().map((v) => [v.name, v]));
    for (const [name, chain] of this.current?.chains ?? []) {
      const v = views.get(name);
      if (v) {
        faces.push(...v.faces);
        for (const f of chain.features) replaces.add(f.name);
      } else {
        for (const f of chain.features.slice(1)) if (modeOf(f) !== "add") replaces.add(f.name);
      }
    }
    return { faces, replaces };
  }

  /** Every feature that is part of a body the kernel builds — whose twins and walls are not the solid's edges. */
  kernelFeatures(): Set<string> {
    const out = new Set<string>();
    for (const chain of this.current?.chains.values() ?? []) for (const f of chain.features) out.add(f.name);
    return out;
  }

  /** The body a feature is part of, as last answered, if the kernel builds it. */
  viewOf(feature: string): BodyView | null {
    return this.views().find((v) => v.features.includes(feature)) ?? null;
  }

  /**
   * The nearest kernel face under a pixel, or null — what sketch on face and a
   * click on a solid ask first, since a boolean's faces are no loop of
   * entities a click could otherwise find (a pocket's floor is the cut's lid
   * but the plate's lid is not there). `skip`: bodies not on screen.
   */
  faceAt(view: View, sx: number, sy: number, hidden: ReadonlySet<string> = new Set(), made = false): SolidHit | null {
    const { toward } = viewAxes(view);
    let best: SolidHit | null = null;
    for (const v of made ? this.madeViews() : this.views()) {
      if (hidden.has(v.name)) continue;
      for (const f of v.faces) {
        if (dot3(f.normal, toward) <= 1e-9) continue;
        const [a, b, c] = f.outlines[0];
        const [pa, pb, pc] = [worldToScreen(view, a), worldToScreen(view, b), worldToScreen(view, c)];
        // Barycentric weights of the pixel in the projected triangle.
        const det = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1]);
        if (Math.abs(det) < 1e-12) continue;
        const w1 = ((pb[1] - pc[1]) * (sx - pc[0]) + (pc[0] - pb[0]) * (sy - pc[1])) / det;
        const w2 = ((pc[1] - pa[1]) * (sx - pc[0]) + (pa[0] - pc[0]) * (sy - pc[1])) / det;
        const w3 = 1 - w1 - w2;
        if (w1 < -1e-9 || w2 < -1e-9 || w3 < -1e-9) continue;
        const at = [0, 1, 2].map((i) => w1 * a[i] + w2 * b[i] + w3 * c[i]);
        const d = depth(view, at);
        if (best && d <= best.depth) continue;
        const record = v.result.solid!.faces[f.face];
        best = {
          body: v.name, face: f.face, name: record.name, tag: record.tag, planar: record.kind === "plane",
          at, depth: d, normal: f.normal,
        };
      }
    }
    return best;
  }

  /** A body's exact boundary, for STEP — asked of the Worker, which holds the solid. */
  async topology(body: string): Promise<Topology | null> {
    if (!this.client) return null;
    if (!this.settled) throw new Error("the solid kernel is still building — try again in a moment");
    return this.client.topology(body);
  }

  /** What to say about the bodies: refusals, idle cuts, features left out, a kernel that is not there. */
  report(): Report {
    const lines: string[] = [];
    const p = this.current;
    if (!p) return { lines, current: true };
    const model = this.model;
    if (model) {
      const chains = chainsOf(model);
      for (const l of chains.left) lines.push(`${l.feature} is left out: ${l.why}`);
      for (const a of chains.alone) lines.push(`${a.feature}: ${a.why}`);
    }
    for (const s of p.skipped) lines.push(`${s.feature} cannot be laid out: ${s.why}`);
    if (p.program.bodies.length && !this.client) lines.push("the solid kernel is not available — cuts are not shown");
    else if (p.program.bodies.length && this.failure) lines.push(`the solid kernel: ${this.failure}`);
    for (const b of p.program.bodies) {
      const r = this.latest.get(b.name);
      if (!r) continue;
      // A feature sketched on a face the body no longer has: it stays where
      // the face was (its plane is the face's feature's own points, which
      // nothing removed), and that is said, not hidden.
      const chain = p.chains.get(b.name);
      const has = new Set((this.good.get(b.name)?.result.solid ?? r.solid)?.faces.map((f) => f.name) ?? []);
      if (model && chain && has.size) {
        // Not a cut's: a cut is sketched on the face it cuts, and taking that
        // face away is what it is for.
        for (const g of chain.features.filter((x) => modeOf(x) === "add" || modeOf(x) === "new")) {
          const on = faceUnder(model, g);
          if (on && chain.features.some((f) => on.startsWith(`${f.name}.`)) && !has.has(on)) {
            lines.push(`${g.name} is drawn on ${on}, which ${b.name} no longer has — it stays where that face was`);
          }
        }
      }
      const name = (id: number) => featureLabel(id, PREFIX);
      // A preview's refusal is the tool's to say (it does, as guidance), not
      // the body's — nor is one from a preview since ended, whose answer is
      // still the latest until the body's own arrives: only nodes the body has.
      const trial = p.trial?.body === b.name ? p.trial.node.id : null;
      // A surface's partners' nodes are carried inside its own (a knit's), and their refusals are its.
      const own = (id: number) => id !== trial && allNodes(b.nodes).some((n) => n.id === id);
      for (const f of r.failed) if (own(f.id)) lines.push(`${name(f.id)} could not be applied to ${b.name}: ${f.why}`);
      // A fillet some of whose edges a change took (docs/plans/solid-fillets.md): the rest are still rounded.
      for (const m of (r.missing ?? []).filter((x) => own(x.id))) {
        const what = model?.blends.get(name(m.id))?.kind ?? "fillet";
        lines.push(`${name(m.id)} no longer ${what === "fillet" ? "fillets" : "chamfers"} ${m.edges.join(", ")} — ${b.name} has no such edge now`);
      }
      for (const i of r.idle) {
        const mode = model?.features.get(name(i.id)) ? modeOf(model.features.get(name(i.id)) as FeatureEntry) : "add";
        if (model?.surfaces.has(name(i.id))) {
          lines.push(`${name(i.id)} trims nothing from ${b.name} — what it cuts by does not cross it`);
          continue;
        }
        lines.push(mode === "cut" ? `${name(i.id)} cuts nothing from ${b.name} — it does not reach it`
          : mode === "add" ? `${name(i.id)} adds nothing to ${b.name} — it is all inside it`
            : `${name(i.id)} changes nothing in ${b.name}`);
      }
    }
    return { lines, current: this.settled };
  }
}
