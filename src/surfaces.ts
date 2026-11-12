// Surfaces, as operations (docs/plans/surfaces.md). The owner: *"please add
// solid and surface fillet tools if possible"*, *"also fillets and chamfers for
// surfaces"* — and the rule from regions-as-operations.md: there is no such
// thing as a negative face or a negative solid, only operations between things.
//
// **A surface is a thing; trim, extend, knit, offset, thicken and the fillet
// between two are operations on it.** Each is one record in the model's
// registry of surfaces (`SurfaceEntry`, `s1`, `s2`, …), journalled as its typed
// call, replayed as it, and chained as a body's booleans are (modes.ts): a
// surface is named by the record that made it, and every later record whose
// `into` names it changes it, in the order they were made. A knit takes the
// surfaces it names into this one; they are one sheet from then on.
//
// **What a surface is, is the kernel's.** Nothing here makes an entity or an
// equation of shape: the records are structure, their numbers are dimensions
// with no equations (relations/surface.ts), and the sheet is built by the
// solid kernel every rebuild from the program `surfacePrograms` reads off the
// model — numbers only, the layer rule's kernel edge (src/solids/evaluate.ts).
// So a record is checked for shape and for what it names, never for what the
// kernel will make of it: whether a curve crosses a surface is the kernel's to
// say, asynchronously, and a replay, a test with no kernel and a phone yet to
// load it all make the same records. A refusal is said by the body report
// (bodies.ts), as a failed boolean is.
//
// At the operations' height: it reads the model, its loops and its chains, and
// the kernel only as the program it hands it.

import { memberName, SURFACE_HEADS, valueArgIndex, type Model, type ProfileMember, type SurfaceEntry } from "./model.ts";
import { chainThrough, walkChain } from "./sketchedit.ts";
import { findLoops, isVirtual, type Loop } from "./loops.ts";
import { orientingPlane, profileOfLoops, regionProfile } from "./operations.ts";
import { chordPlane, planeAxes } from "./curveplane.ts";
import { extrusion } from "./relations/extrusion.ts";
import { perpendicular } from "./relations/geometry.ts";
import { addSpline } from "./relations/spline.ts";
import { kernelProfile, revolveSweep } from "./solids.ts";
import { chamferSetback, filletRadius } from "./relations/blend.ts";
import { surfaceAngle, surfaceDepth, surfaceDistance } from "./relations/surface.ts";
import { SURFACE_IDS } from "./solids/naming.ts";
import type { BlendNode, Node, PairBlendNode, SurfaceNode } from "./solids/evaluate.ts";
import { allNodes } from "./solids/evaluate.ts";
import type { V3 } from "./solids/kernel.ts";
import { isFullTurn } from "./relations/revolution.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

/** How near two edges must run for `knit` to stitch them, when the call says nothing: a micron in a model of millimetres. */
export const KNIT_TOLERANCE = 1e-3;

/** What a boundary edge of a surface's sweep is called (naming.ts): its face, then the sweep's start or end, or an open curve's. */
const SWEEP_EDGE = /^(\S+)\|(s\d+)\.(base|lid|start|end)$/;
/** What a kernel edge's name looks like: two names, `s1.m0|s2.m0`. */
const EDGE_NAME = /^[^|\s]+\|[^|\s]+$/;

const quoted = (v: unknown) => JSON.stringify(v) ?? String(v);

function need3d(model: Model, op: string): void {
  if (model.dim !== 3) throw new Error(`${op} makes a surface, and a ${model.dim}D model has none — surfaces are 3D`);
}

/**
 * The surface a name is, by any record of its chain — **the surface it is part
 * of now**, so `trim("s3", …)` after s3 was knitted into s1 is recorded as a
 * trim of s1, which is what it cuts. Recorded under the name typed, it would
 * leave s1's chain for s3's alone if the knit were deleted later: a trim done
 * to the joined sheet quietly moving to one piece of it. Refused, in words,
 * for anything else.
 */
function surfaceArg(model: Model, op: string, s: unknown, what = "a surface"): string {
  if (typeof s !== "string" || !model.surfaces.has(s)) {
    throw new Error(`${op} takes ${what} first — ${quoted(s)} is not one (surfaces are s1, s2, …; ls() lists them)`);
  }
  const now = surfaceNameOf(model, s);
  if (now === null) throw new Error(`${s} is part of no surface now — the surface it changed was deleted`);
  return now;
}

/**
 * The verbs a surface shares with the sketch (`trim`, `extend`, `offset`,
 * `fillet`, `chamfer`) go to the surface's when their first argument is a
 * surface, and to the sketch's otherwise. A name that reads as a surface's
 * (`s9`) but names nothing would reach the sketch's refusal ("takes a line"),
 * which says nothing of surfaces: this says it as a surface's, and how to find
 * the ones there are. Nothing else is named `s` + a number (`claimName("s")`
 * is the surfaces').
 */
export function noSuchSurface(model: Model, op: string, s: unknown): void {
  if (typeof s === "string" && /^s\d+$/.test(s) && !model.has(s)) {
    throw new Error(`${op}: there is no surface ${s} — ls() lists the surfaces (the curves' ${op} takes them by name)`);
  }
}

// ---- chains ---------------------------------------------------------------------

/** A surface: the record that made it, and every record that changed it since, in order. */
export interface SurfaceChain {
  /** Its name: its first record's. */
  name: string;
  steps: SurfaceEntry[];
}

export interface SurfaceChains {
  chains: SurfaceChain[];
  /** Records left out of every surface, and why — a trim whose surface was deleted. */
  left: { surface: string; why: string }[];
  /** Each record's surface, by name: the chain that holds it now (a knitted surface's is the one it was knitted into). */
  of: Map<string, string>;
}

/**
 * Every surface the records make, in order. A record whose `into` is gone is
 * left out, said. A knit (and a fillet between two surfaces not yet one)
 * takes the other surface's chain into this one: from then on that surface is
 * no surface of its own, and its later records — there can be none, since its
 * name now answers for this chain — are this one's. **Hidden** reads as for
 * bodies: a surface whose first record is hidden is left out whole (with
 * `hidden`, kept), a later record hidden is suppressed — left out of its chain.
 */
export function surfaceChains(model: Model, opts: { hidden?: boolean } = {}): SurfaceChains {
  const out: SurfaceChains = { chains: [], left: [], of: new Map() };
  const byHead = new Map<string, SurfaceChain>();
  const absorbed = new Set<string>();
  const hidden = (s: SurfaceEntry) => !opts.hidden && model.hidden.has(s.name);
  for (const s of model.surfaces.values()) {
    if (SURFACE_HEADS.includes(s.kind)) {
      const c: SurfaceChain = { name: s.name, steps: [s] };
      byHead.set(s.name, c);
      out.of.set(s.name, s.name);
      continue;
    }
    const head = s.into === undefined ? undefined : out.of.get(s.into);
    const chain = head === undefined ? undefined : byHead.get(head);
    if (!chain) {
      out.left.push({ surface: s.name, why: `it changes ${s.into ?? "a surface"}, which is no longer there` });
      continue;
    }
    out.of.set(s.name, chain.name);
    // A knit, or a fillet to a surface not yet part of this one, takes the other in.
    if (s.kind === "knit" || ((s.kind === "fillet" || s.kind === "chamfer") && s.with)) {
      for (const w of s.with ?? []) {
        const theirs = out.of.get(w);
        if (theirs === undefined || theirs === chain.name) continue;
        absorbed.add(theirs);
        for (const [n, h] of out.of) if (h === theirs) out.of.set(n, chain.name);
      }
    }
    if (!hidden(s)) chain.steps.push(s);
  }
  for (const c of byHead.values()) {
    if (absorbed.has(c.name)) continue;
    if (!opts.hidden && model.hidden.has(c.name)) continue;
    out.chains.push(c);
  }
  return out;
}

/** The surface a record is part of now, by its chain's name — null for one left out. */
export function surfaceNameOf(model: Model, record: string): string | null {
  return surfaceChains(model, { hidden: true }).of.get(record) ?? null;
}

/** A record's number to the kernel: `s3` is 500003 (naming.ts's `SURFACE_IDS`). */
export function surfaceId(name: string): number {
  const m = /^s(\d+)$/.exec(name);
  if (!m) throw new Error(`"${name}" is not a surface's name`);
  return SURFACE_IDS + Number(m[1]);
}

// ---- the program --------------------------------------------------------------------

export interface SurfacePrograms {
  bodies: { name: string; nodes: Node[] }[];
  /** The pair asked for, as a node (`PairAsk`), or null when it cannot be laid out. */
  trial?: PairBlendNode | null;
  /** Records that could not be laid out (a curve gone, a plane collapsed), and why. */
  skipped: { feature: string; why: string }[];
}

/**
 * The value a record's dimension holds now, or NaN. Where the dimension keeps
 * it (`valueArgIndex`): a surface's own sizes at 0, an edge extrude's
 * `extrusion` at 1, after its frame.
 */
function sizeOf(model: Model, s: SurfaceEntry): number {
  const r = s.size === undefined ? undefined : model.relations.get(s.size);
  const v = r ? r.args[valueArgIndex(r.op) ?? 0] : undefined;
  return typeof v === "number" ? v : NaN;
}

/** Whether a record is an edge extrude: its depth an `extrusion`, holding twins of its own (`edgeExtrude`). */
export function isEdgeExtrude(model: Model, s: SurfaceEntry): boolean {
  return s.kind === "extrude" && s.size !== undefined && model.relations.get(s.size)?.op === "extrusion";
}

/**
 * The kernel's program for every surface: one body per surface, its nodes in
 * chain order (src/solids/evaluate.ts's surface nodes). `bodyNodes` hands the
 * nodes of a body by its name — what a face taken from a body is built from.
 */
export function surfacePrograms(model: Model, bodyNodes: (feature: string) => Node[] | null, pair: PairAsk | null = null): SurfacePrograms {
  const sc = surfaceChains(model, { hidden: true });
  const order = [...model.surfaces.keys()];
  const skipped: SurfacePrograms["skipped"] = [];
  const shown = new Set(surfaceChains(model).chains.map((c) => c.name));
  const all = new Map(sc.chains.map((c) => [c.name, c]));
  const memoHead = new Map<string, string | null>();
  /** The surface a record was made part of: a head is its own; any other is its `into`'s — before any knit moved it. */
  const headAt = (name: string): string | null => {
    if (memoHead.has(name)) return memoHead.get(name)!;
    const s = model.surfaces.get(name);
    const h = !s ? null : SURFACE_HEADS.includes(s.kind) ? s.name : s.into ? headAt(s.into) : null;
    memoHead.set(name, h);
    return h;
  };
  const memoChain = new Map<string, string | null>();
  /** The chain a record is in as of record index upTo: its own head, followed through every knit made before then. */
  const chainAt = (name: string, upTo: number): string | null => {
    const key = name + "@" + upTo;
    if (memoChain.has(key)) return memoChain.get(key)!;
    let h = headAt(name);
    for (let i = 0; h !== null && i < upTo && i < order.length; i++) {
      const s = model.surfaces.get(order[i])!;
      const takes = s.kind === "knit" || ((s.kind === "fillet" || s.kind === "chamfer") && s.with);
      if (!takes || !(s.with ?? []).length) continue;
      const into = s.into ? chainAt(s.into, i) : null;
      if (into !== null && (s.with ?? []).some((w) => chainAt(w, i) === h)) h = into;
    }
    memoChain.set(key, h);
    return h;
  };
  /** The nodes of the surface name is in, as it stood just before record index upTo. */
  const nodesOf = (name: string, upTo: number, depth = 0): Node[] => {
    if (depth > 64) throw new Error("its surfaces name each other round in a circle");
    const head = chainAt(name, upTo);
    if (head === null) throw new Error(name + " is no surface now");
    // A record is in the chain it was in when it was made: a surface knitted
    // in later comes in as the knit's partner, not as steps of this chain.
    const records = [...model.surfaces.values()].filter((s, i) => i < upTo && chainAt(s.name, i) === head && !model.hidden.has(s.name));
    return build(records, depth);
  };
  const build = (records: SurfaceEntry[], depth: number): Node[] => {
    const nodes: Node[] = [];
    const extends_ = records.filter((s) => s.kind === "extend");
    for (const s of records) {
      const at = order.indexOf(s.name);
      const id = surfaceId(s.name);
      try {
        const n = nodeOf(s, id, at, extends_, depth);
        if (n) nodes.push(n);
      } catch (e) {
        skipped.push({ feature: s.name, why: e instanceof Error ? e.message : String(e) });
        // A surface whose first record cannot be made has nothing for the rest to change.
        if (SURFACE_HEADS.includes(s.kind)) return [];
      }
    }
    return nodes;
  };
  const nodeOf = (s: SurfaceEntry, id: number, at: number, extends_: SurfaceEntry[], depth: number): Node | null => {
    switch (s.kind) {
      case "extrude":
      case "revolve":
        return sweepNode(model, s, id, extends_.filter((x) => headAt(x.name) === s.name));
      case "planar": {
        const plane = planeAxes(model, s.frame!);
        const { at: place, profile } = kernelProfile(model, plane, s.loops ?? []);
        return { id, op: "planar", profile, at: place };
      }
      case "face": {
        const face = s.of!;
        const owner = face.slice(0, face.indexOf("."));
        const of = model.surfaces.has(owner) ? nodesOf(owner, at, depth + 1) : bodyNodes(owner);
        if (!of || !of.length) throw new Error(`${owner}, which ${face} is a face of, cannot be made`);
        return { id, op: "face", of, face };
      }
      case "offset":
        return { id, op: "offset", of: nodesOf(s.of!, at, depth + 1), distance: sizeOf(model, s) };
      case "trim": {
        const by = s.by!;
        if (model.surfaces.has(by)) return { id, op: "trim", by: nodesOf(by, at, depth + 1), keep: s.keep as V3 };
        const plane = planeAxes(model, s.frame!);
        if (!plane) throw new Error(`the plane ${by} lies in has collapsed`);
        const { at: place, profile } = kernelProfile(model, plane, [[by]]);
        const n = unit3(plane.n)!;
        return { id, op: "trim", curve: { member: profile.loops[0][0], at: place, dir: [n[0], n[1], n[2]] }, keep: s.keep as V3 };
      }
      case "extend":
        return null;
      case "knit":
        return {
          id, op: "knit", tolerance: s.tolerance ?? KNIT_TOLERANCE,
          with: (s.with ?? []).filter((w) => !model.hidden.has(w)).map((w) => nodesOf(w, at, depth + 1)),
        };
      case "thicken":
        return { id, op: "thicken", distance: sizeOf(model, s) };
      case "solidify":
        return { id, op: "solidify" };
      case "fillet":
      case "chamfer": {
        if (s.edges) {
          const b: BlendNode = { id, op: s.kind, edges: [...s.edges], size: sizeOf(model, s) };
          return b;
        }
        return pairNode(s.into!, (s.with ?? [])[0], at, s.kind, sizeOf(model, s), s.keeps ?? [null, null], id, depth);
      }
    }
  };
  /** A fillet or chamfer between `into`'s surface and `t`'s, as of record index `at`. */
  const pairNode = (into: string, t: string, at: number, kind: "fillet" | "chamfer", size: number,
    keeps: readonly (readonly number[] | null)[], id: number, depth: number): PairBlendNode => {
    const mine = chainAt(into, at);
    const theirs = chainAt(t, at);
    // Already one sheet: the edges between them. Not yet: the other comes in first.
    const together = mine !== null && mine === theirs;
    const theirNodes = together ? null : nodesOf(t, at, depth + 1);
    const ids = (nodes: Node[]) => allNodes(nodes).map((n) => n.id);
    // Their faces carry the numbers of their own chain's records.
    const b = together
      ? [...model.surfaces.values()].filter((x, i) => i < at && headAt(x.name) === headAt(t)).map((x) => surfaceId(x.name))
      : ids(theirNodes!);
    const a = ids(nodesOf(into, at, depth + 1)).filter((x) => !b.includes(x));
    return {
      id, op: kind === "fillet" ? "pairFillet" : "pairChamfer", a, b, with: theirNodes,
      keep: [(keeps[0] as V3 | null) ?? null, (keeps[1] as V3 | null) ?? null], size,
    };
  };
  const bodies: SurfacePrograms["bodies"] = [];
  for (const c of sc.chains) {
    if (!shown.has(c.name) || !all.has(c.name)) continue;
    const nodes = nodesOf(c.name, order.length);
    if (nodes.length) bodies.push({ name: c.name, nodes });
  }
  if (!pair) return { bodies, skipped };
  let trial: PairBlendNode | null = null;
  try {
    trial = pairNode(pair.into, pair.other, order.length, pair.kind, pair.size, pair.keeps, pair.id, 0);
  } catch {
    trial = null;
  }
  return { bodies, skipped, trial };
}

/** A fillet or chamfer between two surfaces asked of the program before it is made — the round tool's preview. */
export interface PairAsk {
  into: string;
  other: string;
  kind: "fillet" | "chamfer";
  size: number;
  keeps: (number[] | null)[];
  id: number;
}

/** The number the next surface record will most likely get, as the kernel numbers it: what a preview of it is tagged with. */
export function nextSurfaceId(model: Model): number {
  let n = 0;
  for (const name of model.surfaces.keys()) n = Math.max(n, Number(name.slice(1)));
  return SURFACE_IDS + n + 1;
}

/** An extruded or revolved surface's sheet, its extends applied: the profile lengthened at an end, the sweep at its start or end. */
function sweepNode(model: Model, s: SurfaceEntry, id: number, extends_: SurfaceEntry[]): SurfaceNode {
  const axes = planeAxes(model, s.frame!);
  const members: ProfileMember[] = (s.loops ?? [s.curves ?? []])[0];
  // An edge extrude's sheet runs along its chord, wherever its curves and the
  // chord have been turned to — the plane it was made on is only where it
  // started (as an extrude's, curveplane.ts's `featurePlane`); and, as an
  // extrude's, the kernel sweeps only square, so a chord let lean is drawn and
  // not built.
  const plane = axes && isEdgeExtrude(model, s) ? { ...axes, ...chordPlane(model, s.size!, axes) } : axes;
  if (plane && isEdgeExtrude(model, s)) refuseLeaning(model, members, plane.n);
  const { at, profile, local } = kernelProfile(model, plane, [members]);
  const value = sizeOf(model, s);
  if (!Number.isFinite(value) || value === 0) throw new Error(`its ${s.kind === "extrude" ? "depth" : "angle"} is ${value}`);
  let sweep: Extract<SurfaceNode, { op: "sheet" }>["sweep"] = s.kind === "extrude"
    ? { kind: "extrude", depth: value }
    : revolveSweep(model, s.axis!, value, local);
  let place = at;
  for (const x of extends_) {
    const m = SWEEP_EDGE.exec(x.edge ?? "");
    const d = sizeOf(model, x);
    if (!m || !Number.isFinite(d)) continue;
    const where = m[3];
    if (where === "start" || where === "end") {
      lengthen(profile, where, d);
    } else if (sweep.kind === "extrude") {
      const sign = Math.sign(sweep.depth);
      sweep = { kind: "extrude", depth: sweep.depth + sign * d };
      if (where === "base") {
        const z = cross3(place.x, place.y);
        place = { ...place, origin: [0, 1, 2].map((k) => place.origin[k] - z[k] * sign * d) as V3 };
      }
    } else {
      throw new Error(`${x.name} lengthens a revolved surface at its ${where}, which is its angle — set the angle's dimension instead`);
    }
  }
  return { id, op: "sheet", sweep, profile, at: place };
}

/** An open profile lengthened `d` at its start or end, along its end member: a line straight on, an arc round its circle. */
function lengthen(profile: { loops: import("./solids/kernel.ts").Member[][] }, where: "start" | "end", d: number): void {
  const ms = profile.loops[0];
  const m = where === "start" ? ms[0] : ms[ms.length - 1];
  const other = where === "start" ? ms[1] : ms[ms.length - 2];
  const near = (p: [number, number], q?: [number, number] | null) => !!q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7 * Math.max(1, Math.hypot(...p));
  const endsOf = (x: (typeof ms)[number] | undefined): [number, number][] => {
    if (!x) return [];
    if (x.kind === "line") return [x.from, x.to];
    if (x.kind === "arc") {
      const r = (a: number) => (a * Math.PI) / 180;
      return [[x.centre[0] + x.radius * Math.cos(r(x.start)), x.centre[1] + x.radius * Math.sin(r(x.start))],
        [x.centre[0] + x.radius * Math.cos(r(x.end)), x.centre[1] + x.radius * Math.sin(r(x.end))]];
    }
    return [];
  };
  const joined = endsOf(other);
  if (m.kind === "line") {
    // The free end: the one the neighbouring member does not share (either, for a lone line: the start is `from`).
    const freeIsFrom = joined.length ? !joined.some((q) => near(m.from, q)) : where === "start";
    const [a, b] = freeIsFrom ? [m.from, m.to] : [m.to, m.from];
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    const ext: [number, number] = [a[0] + ((a[0] - b[0]) / len) * d, a[1] + ((a[1] - b[1]) / len) * d];
    if (freeIsFrom) m.from = ext; else m.to = ext;
    return;
  }
  if (m.kind === "arc") {
    const [s0] = endsOf(m);
    const freeIsStart = joined.length ? !joined.some((q) => near(s0, q)) : where === "start";
    const turn = (d / m.radius) * (180 / Math.PI);
    if (freeIsStart) m.start -= turn; else m.end += turn;
    return;
  }
  throw new Error("only a line or an arc at an open end can be lengthened");
}

/** The record that made `s`'s surface a solid (a thicken or a solidify), or null while it is a sheet. */
function madeSolid(model: Model, s: string): SurfaceEntry | null {
  const head = surfaceNameOf(model, s);
  const chain = surfaceChains(model, { hidden: true }).chains.find((c) => c.name === head);
  return chain?.steps.find((x) => x.kind === "thicken" || x.kind === "solidify") ?? null;
}

/** Refuses a sheet's operation on a surface a thicken or solidify has made a solid. */
function stillSheet(model: Model, op: string, s: string): void {
  const solid = madeSolid(model, s);
  if (solid) throw new Error(`${s} is a solid now (${solid.name} ${solid.kind === "thicken" ? "thickened" : "closed"} it) — ${op} works on a sheet; del("${solid.name}") makes it one again`);
}

// ---- the operations ---------------------------------------------------------------

/**
 * The plane curves lie in, for a surface swept from them: a plane named, or
 * an arc's or circle's own, or the drawing plane, a frame, or three of their
 * points — the first that holds every one of them. Refused, saying which to
 * name, where none does (a lone line in no frame's plane).
 */
function curvesPlane(model: Model, curves: readonly string[], frame: string | null | undefined, op: string): string {
  return surfacePlane(model, curves, frame, op);
}

/** The plane a surface swept from `curves` runs along the normal of — what `surface` resolves, for a preview to draw it. */
export function surfacePlane(model: Model, curves: readonly string[], frame: string | null = null, op = "surface"): string {
  if (frame != null) {
    model.planeKind(frame);
    return frame;
  }
  const pts: number[][] = [];
  for (const c of curves) {
    const e = model.entities.get(c)!;
    if (e.kind === "line") pts.push(...e.refs.map((p) => model.coords(p)));
    else if (e.kind === "arc") pts.push(model.coords(e.start), model.coords(e.end), model.coords(e.center));
    else if (e.kind === "spline") pts.push(...e.points.map((p) => model.coords(p)));
    else if ("center" in e) pts.push(model.coords((e as { center: string }).center));
  }
  const holds = (ref: string) => {
    const p = planeAxes(model, ref);
    if (!p) return false;
    const size = Math.max(1, ...pts.map((q) => Math.hypot(...q)));
    return pts.every((q) => Math.abs(dot3(sub3(q, p.origin), p.n)) <= 1e-6 * size);
  };
  const round = curves.find((c) => { const k = model.entities.get(c)!.kind; return k === "arc" || k === "circle" || k === "ellipse"; });
  if (round && holds(round)) return round;
  const candidates = [model.drawingPlane(), ...model.frameNames()];
  for (const c of candidates) if (holds(c)) return c;
  // Three of their own points not in a line.
  const named = [...new Set(curves.flatMap((c) => {
    const e = model.entities.get(c)!;
    return e.kind === "line" ? e.refs : e.kind === "arc" ? [e.start, e.end] : e.kind === "spline" ? e.points : [];
  }))];
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) for (let k = j + 1; k < named.length; k++) {
    const [a, b, c] = [named[i], named[j], named[k]].map((p) => model.coords(p));
    if (unit3(cross3(sub3(b, a), sub3(c, a))) && holds(`${named[i]}.${named[j]}.${named[k]}`)) return `${named[i]}.${named[j]}.${named[k]}`;
  }
  throw new Error(`${op}: ${curves.join(", ")} lie in no one plane I can find — say which: ${op}(${quoted(curves.length === 1 ? curves[0] : curves)}, …, "f1")`);
}

/** The curves a surface is swept from: one curve's whole chain, or the curves named — in walk order, lines turned to follow it. */
function sweptCurves(model: Model, curves: unknown, op: string): { names: string[]; members: ProfileMember[] } {
  const list = typeof curves === "string" ? chainThrough(model, curves) : Array.isArray(curves) ? curves : null;
  if (!list || !list.length || list.some((c) => typeof c !== "string")) {
    throw new Error(`${op} takes a curve — or a list of curves, end to end — first: ${op}("l1", 20)`);
  }
  for (const c of list as string[]) {
    const e = model.entities.get(c);
    // A spline sweeps as its exact NURBS (docs/plans/spline.md).
    if (!e || !(e.kind === "line" || e.kind === "arc" || e.kind === "circle" || e.kind === "spline")) {
      throw new Error(`${op} sweeps lines, arcs, circles and splines — ${quoted(c)} is ${e ? `a ${e.kind}` : "not there"}`);
    }
    if (model.isConstruction(c)) throw new Error(`${c} is construction, which sweeps nothing — make it a real curve first`);
  }
  let walk;
  try {
    walk = walkChain(model, list as string[]).walk;
  } catch (e) {
    throw new Error((e instanceof Error ? e.message : String(e)).replace(/^offset /, `${op} `).replace(/ — offset it by itself/, ` — ${op} it by itself`));
  }
  // A line walked against its own way is handed over as the portion from its
  // walk-start to its walk-end, so every member runs the chain's way.
  const members = walk.map((w): ProfileMember => {
    const e = model.entities.get(w.name)!;
    return e.kind === "line" && w.reversed && w.from && w.to ? { name: w.name, from: w.from, to: w.to } : w.name;
  });
  return { names: walk.map((w) => w.name), members };
}

/**
 * An **extruded surface**: the curves — a chain, open or closed, or one
 * curve's whole chain — swept `depth` along their plane's normal, with no
 * caps: `surface("l1", 20)`. Journalled as `surfaceExtrude` with the chain and
 * the plane resolved. Returns the surface's name.
 */
export function surfaceExtrude(model: Model, curves: string | string[], depth: number, frame?: string | null, resolved?: unknown): string {
  need3d(model, "surface");
  const { names, members } = resolved != null && Array.isArray(resolved)
    ? { names: (resolved as ProfileMember[]).map(memberName), members: resolved as ProfileMember[] }
    : sweptCurves(model, curves, "surface");
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth === 0) {
    throw new Error(`surface sweeps its curves a depth — a number other than 0, got ${quoted(depth)}`);
  }
  const plane = curvesPlane(model, names, frame, "surface");
  return model.asOperation("surfaceExtrude", [curves, depth, plane, members], () => {
    const d = surfaceDepth(model, depth);
    return model.addSurface({ kind: "extrude", curves: names, loops: [members], frame: plane, size: d, names: [...names, d], owns: [d] }).name;
  });
}

/**
 * An **edge extrude** (docs/plans/profiles-held.md) — the primitive an extrude
 * is made of. The owner: *"extrude should create an identical copy of the
 * originating profile's geometry, with relations and all, then chord edges
 * connecting each corner of one profile to the other, and then the edges
 * become extruded surfaces. Edge extrude is a fundamental feature."*
 *
 * So, unlike every other record here, it **makes entities**: each curve's
 * copy E′ — every point of it moved by one chord, every size and normal the
 * same — and an end chord, base to copy, at every end of the chain (a wall,
 * as an extrude's). One `extrusion` holds them, the dimension `set` edits, and
 * beside it `s1_perp`, the chord square to the curves: the same pair an
 * extrude is held by, so a profile extrude is exactly the edge extrude of
 * every edge of its profile sharing one chord. The sheet between E and E′ is
 * derived — built by the kernel from the curves and the chord, stored nowhere.
 * Both ways, as everything is: a copy's corner dragged drags its base.
 *
 * A curve is twinned whole — lines, arcs, circles and splines, as the surface
 * sweep takes. A chain's ends joined by a shared point twin once; two ends
 * joined only by a `coin` each have a twin and a wall of their own, held
 * together by that coin's translation (written down in TODO.md, left).
 *
 * `edgeExtrude("l1", 20)` the chain through l1; `edgeExtrude(["l1", "a2"],
 * 20)` just those. Journalled as `edgeExtrude` with the chain and plane
 * resolved, replayed name for name. Returns the record's name.
 */
export function edgeExtrude(model: Model, curves: string | string[], depth: number, frame?: string | null, resolved?: unknown): string {
  need3d(model, "edgeExtrude");
  const { names, members } = resolved != null && Array.isArray(resolved)
    ? { names: (resolved as ProfileMember[]).map(memberName), members: resolved as ProfileMember[] }
    : sweptCurves(model, curves, "edgeExtrude");
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth === 0) {
    throw new Error(`edgeExtrude moves its curves a depth — a number other than 0, got ${quoted(depth)}`);
  }
  const plane = curvesPlane(model, names, frame, "edgeExtrude");
  return model.asOperation("edgeExtrude", [curves, depth, plane, members], () => {
    const axes = planeAxes(model, plane);
    if (!axes) throw new Error(`edgeExtrude: the plane ${plane} has collapsed`);
    const z = unit3(axes.n)!;
    const owns: string[] = [];
    const made = (n: string) => { owns.push(n); return n; };
    const twinOf = new Map<string, string>();
    const twin = (p: string) => {
      let t = twinOf.get(p);
      if (!t) { t = made(model.addPoint(model.coords(p).map((c, i) => c + depth * z[i])).name); twinOf.set(p, t); }
      return t;
    };
    const ends: string[] = [];
    const curvePairs: string[] = [];
    for (const c of names) {
      const e = model.entities.get(c)!;
      if (e.kind === "line") {
        const [a, b] = e.refs.map(twin);
        made(model.addLine(a, b).name);
        ends.push(...e.refs);
      } else if (e.kind === "arc") {
        const [s, x] = [twin(e.start), twin(e.end)];
        curvePairs.push(c, made(model.addArc(twin(e.center), s, x, model.radius(c), model.normalOf(c)).name));
        ends.push(e.start, e.end);
      } else if (e.kind === "circle") {
        curvePairs.push(c, made(model.addCircle(twin(e.center), model.radius(c), model.normalOf(c)).name));
      } else if (e.kind === "spline") {
        made(addSpline(model, e.points.map(twin), e.closed === true));
        if (e.closed !== true) ends.push(e.points[0], e.points[e.points.length - 1]);
      }
    }
    // An end chord at every end the chain has — once at a joint two curves share.
    for (const p of new Set(ends)) made(model.addLine(p, twinOf.get(p)!).name);
    const pairs = [...twinOf].flat();
    const held = made(extrusion(model, plane, depth, ...pairs, ...curvePairs));
    const record = model.addSurface({ kind: "extrude", curves: names, loops: [members], frame: plane, size: held, names: [...names, ...owns], owns }).name;
    // The chord square to the curves: its own relation, deletable, named for
    // the record so it claims no `r` (as an extrude's `e1_perp`).
    const [base, top] = pairs;
    model.namedRelation(`${record}_perp`, () => perpendicular(model, base, top, record));
    return record;
  });
}

/** The kernel sweeps square: an edge extrude whose curves stand off the plane square to its chord is drawn from its copies, not built. */
function refuseLeaning(model: Model, members: readonly ProfileMember[], n: number[]): void {
  const u = unit3(n);
  if (!u) return;
  const pts = [...new Set(members.flatMap((m) => {
    const e = model.entities.get(memberName(m));
    return e ? model.refsOf(e).filter((p) => model.entities.get(p)?.kind === "point") : [];
  }))].map((p) => model.coords(p));
  if (pts.length < 2) return;
  const size = Math.max(1, ...pts.map((p) => Math.hypot(...p)));
  const off = Math.max(...pts.map((p) => Math.abs(dot3(sub3(p, pts[0]), u))));
  if (off > 1e-6 * size) throw new Error("its chord is not square to its curves — an oblique edge extrude is drawn, and the kernel only sweeps square");
}

/**
 * A **revolved surface**: the curves turned about an axis in their plane — a
 * line, or a frame's axis — through `angle` radians (a whole turn left out):
 * `surface("l1", "l9")`, `surface("l1", yaxis(), Math.PI)`. Journalled as
 * `surfaceRevolve`.
 */
export function surfaceRevolve(model: Model, curves: string | string[], axis: string, angle?: number | null, frame?: string | null,
  resolved?: unknown): string {
  need3d(model, "surface");
  const { names, members } = resolved != null && Array.isArray(resolved)
    ? { names: (resolved as ProfileMember[]).map(memberName), members: resolved as ProfileMember[] }
    : sweptCurves(model, curves, "surface");
  if (typeof axis !== "string") throw new Error(`a revolved surface turns about an axis — a line, or "f1.y" — got ${quoted(axis)}`);
  const theta = angle ?? 2 * Math.PI;
  if (typeof theta !== "number" || !Number.isFinite(theta) || theta === 0) throw new Error(`a revolved surface's angle is radians other than 0, got ${quoted(angle)}`);
  const plane = curvesPlane(model, names, frame, "surface");
  const axisNames = axis.split(".")[0];
  const named = model.entities.has(axisNames) ? [axisNames] : [];
  return model.asOperation("surfaceRevolve", [curves, axis, theta, plane, members], () => {
    const d = surfaceAngle(model, isFullTurn(theta) ? 2 * Math.PI : theta);
    return model.addSurface({
      kind: "revolve", curves: names, loops: [members], frame: plane, axis, size: d, names: [...names, ...named, d], owns: [d],
    }).name;
  });
}

/**
 * A **planar surface**: the region a closed loop bounds — a region's chain
 * (`surface("rg1")`, its holes cut) or a face by a member of its loop
 * (`surface("l1")`, its whole inside, as `extrude("l1")` takes it). Journalled
 * as `surfacePlanar` with the loops resolved.
 */
export function surfacePlanar(model: Model, member: string, frame?: string | null, loops?: unknown): string {
  need3d(model, "surface");
  let plane: string, resolvedLoops: ProfileMember[][];
  if (Array.isArray(loops) && typeof frame === "string") {
    plane = frame;
    resolvedLoops = loops as ProfileMember[][];
  } else if (model.regions.has(member)) {
    const p = regionProfile(model, member, frame ?? null);
    plane = p.frame;
    resolvedLoops = p.loops;
  } else {
    const all = findLoops(model);
    const mine = all.map((l, i) => ({ l, i })).filter(({ l }) => l.members.some((m) => m.name === member));
    if (!mine.length) throw new Error(`${quoted(member)} is in no closed loop — a planar surface is the face a closed loop bounds`);
    const smallest = mine.reduce((b, x) => (Math.abs(x.l.area) < Math.abs(b.l.area) ? x : b));
    plane = frame ?? orientingPlane(model, smallest.l as Loop);
    resolvedLoops = profileOfLoops(model, all, [smallest.i], plane).loops;
  }
  for (const loop of resolvedLoops) for (const m of loop) {
    if (typeof m !== "string" && (isVirtual(model, m.from) || isVirtual(model, m.to))) {
      throw new Error(`the face runs through a crossing no point marks (${m.from} or ${m.to}) — put a point there first`);
    }
  }
  const curves = [...new Set(resolvedLoops.flat().map(memberName))];
  return model.asOperation("surfacePlanar", [member, plane, resolvedLoops], () =>
    model.addSurface({ kind: "planar", loops: resolvedLoops, frame: plane, curves, names: [...curves], owns: [] }).name);
}

/**
 * **A body's face as a surface** — `surface("e1.lid")` — or another surface's
 * (`surface("s1.m0")`): the face on its own, a surface of its own from then
 * on, following the body as it is rebuilt. Journalled as `surfaceFace`.
 */
export function surfaceFace(model: Model, face: string): string {
  need3d(model, "surface");
  const m = /^((?:e|s)\d+)\.([A-Za-z]+\d*'?)$/.exec(typeof face === "string" ? face : "");
  if (!m) throw new Error(`surface takes a face by its name, as a hover shows it — "e1.lid", "e2.m0" — got ${quoted(face)}`);
  const owner = m[1];
  if (!model.features.has(owner) && !model.blends.has(owner) && !model.surfaces.has(owner)) {
    throw new Error(`${face} is a face of ${owner}, and there is no ${owner}`);
  }
  return model.asOperation("surfaceFace", [face], () =>
    model.addSurface({ kind: "face", of: face, names: [owner], owns: [] }).name);
}

/** The typed `surface(…)`, told apart by what it is handed: a face's name, a region or a loop, curves and a depth, curves and an axis. */
export function surface(model: Model, what: unknown, ...rest: unknown[]): string {
  if (typeof what === "string" && /^(e|s)\d+\.[A-Za-z]/.test(what)) return surfaceFace(model, what);
  if (rest.length === 0 || (rest.length >= 1 && rest[0] == null && typeof rest[1] === "string")) {
    if (typeof what !== "string") throw new Error("surface takes curves and a depth, curves and an axis, a region, or a face");
    return surfacePlanar(model, what, (rest[1] as string | null | undefined) ?? null);
  }
  const [a, b, c, d] = rest;
  if (typeof a === "number") return surfaceExtrude(model, what as string | string[], a, b as string | null | undefined, c);
  if (typeof a === "string") return surfaceRevolve(model, what as string | string[], a, b as number | null | undefined, c as string | null | undefined, d);
  throw new Error(`surface: after the curves comes a depth (a number) or an axis (a line, "f1.y"), got ${quoted(a)}`);
}

/**
 * **Trims** a surface by a curve or by another surface, keeping the side the
 * point is on: `trim("s1", "l5", [x, y, z])`. A curve is projected along its
 * plane's normal (a sketch facing the surface cuts it where it is seen from
 * there); a surface cuts where it crosses. The cutter is kept. Typed as
 * `trim`, beside the sketch's `trim("l1", [x, y, z])`, told apart by its
 * first argument being a surface; journalled as `trimSurface`.
 */
export function trimSurface(model: Model, s: unknown, by: unknown, keep: unknown, frame?: string | null): string {
  const into = surfaceArg(model, "trim", s);
  stillSheet(model, "trim", into);
  if (typeof by !== "string" || !(model.surfaces.has(by) || model.entities.has(by))) {
    throw new Error(`trim("${into}", by, point): by is a curve or another surface — got ${quoted(by)}`);
  }
  if (!Array.isArray(keep) || keep.length !== 3 || keep.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new Error(`trim("${into}", ${quoted(by)}, point): the point is [x, y, z], on the side to keep — got ${quoted(keep)}`);
  }
  let plane: string | undefined;
  if (model.surfaces.has(by)) {
    if (surfaceNameOf(model, by) === surfaceNameOf(model, into)) throw new Error(`${by} is part of ${into} — a surface cannot trim itself`);
  } else {
    const e = model.entities.get(by)!;
    if (!(e.kind === "line" || e.kind === "arc" || e.kind === "circle")) throw new Error(`a surface is trimmed by a line, an arc or a circle — ${by} is a ${e.kind}`);
    plane = curvesPlane(model, [by], frame, "trim");
  }
  const point = (keep as number[]).map(Number);
  return model.asOperation("trimSurface", [into, by, point, plane ?? null], () =>
    model.addSurface({ kind: "trim", into, by, keep: point, ...(plane ? { frame: plane } : {}), names: [into, by], owns: [] }).name);
}

/**
 * **Extends** a swept surface at a boundary edge by `d`: the lid or base edge
 * of an extruded surface lengthens its sweep that way, an open curve's end
 * edge lengthens the curve — `extend("s1", "s1.m0|s1.lid", 5)`. SMLib extends
 * no trimmed face, so this acts on the sweep the surface was made by: what the
 * chain does after it applies to the longer sheet. Typed as `extend`, beside
 * the sketch's; journalled as `extendSurface`.
 */
export function extendSurface(model: Model, s: unknown, edge: unknown, d: unknown): string {
  const into = surfaceArg(model, "extend", s);
  stillSheet(model, "extend", into);
  const m = SWEEP_EDGE.exec(typeof edge === "string" ? edge : "");
  if (!m) {
    throw new Error(`extend("${into}", edge, distance): the edge is a boundary edge of the sweep, as a hover names it — "s1.m0|s1.lid", "…|s1.start" — got ${quoted(edge)}`);
  }
  const head = surfaceNameOf(model, into);
  const sweep = m[2];
  const rec = model.surfaces.get(sweep);
  if (!rec || (rec.kind !== "extrude" && rec.kind !== "revolve") || surfaceNameOf(model, sweep) !== head) {
    throw new Error(`${edge} is no edge of a sweep of ${into} — extend lengthens an extruded or revolved surface at its own edges`);
  }
  if (rec.kind === "revolve" && (m[3] === "base" || m[3] === "lid")) {
    throw new Error(`${sweep} is revolved, and its ${m[3]} is where its angle ends — set its angle's dimension (${rec.size}) instead`);
  }
  if (typeof d !== "number" || !Number.isFinite(d) || !(d > 0)) throw new Error(`extend: the distance is a length more than 0, got ${quoted(d)}`);
  return model.asOperation("extendSurface", [into, edge, d], () => {
    const dim = surfaceDistance(model, d);
    return model.addSurface({ kind: "extend", into, edge: edge as string, size: dim, names: [into, dim], owns: [dim] }).name;
  });
}

/**
 * **Knits** surfaces into one sheet where their edges meet, within
 * `tolerance`: `knit("s1", "s2", …)`. The others are part of `s1` from then
 * on — one surface, one sheet — and their chains with them. A knit that
 * closes (every edge stitched) is still a sheet: `solidify` or `thicken` makes
 * it a solid. Journalled as `knit`.
 */
export function knit(model: Model, s: unknown, ...rest: unknown[]): string {
  const into = surfaceArg(model, "knit", s);
  stillSheet(model, "knit", into);
  const options = rest.length && rest[rest.length - 1] !== null && typeof rest[rest.length - 1] === "object" && !Array.isArray(rest[rest.length - 1])
    ? rest.pop() as { tolerance?: number } : null;
  const others = rest.flat();
  if (!others.length) throw new Error(`knit("${into}", "s2", …) takes the surfaces to knit into ${into}`);
  const head = surfaceNameOf(model, into);
  for (const o of others) {
    if (typeof o !== "string" || !model.surfaces.has(o)) throw new Error(`knit: ${quoted(o)} is not a surface`);
    if (surfaceNameOf(model, o) === head) throw new Error(`${o} is part of ${into} already`);
    if (surfaceNameOf(model, o) !== o) throw new Error(`${o} is part of ${surfaceNameOf(model, o)} now — knit that`);
  }
  const tol = options?.tolerance ?? KNIT_TOLERANCE;
  if (typeof tol !== "number" || !(tol > 0)) throw new Error(`knit's tolerance is a length more than 0, got ${quoted(tol)}`);
  const list = [...new Set(others as string[])];
  return model.asOperation("knit", options ? [into, ...list, options] : [into, ...list], () =>
    model.addSurface({ kind: "knit", into, with: list, tolerance: tol, names: [into, ...list], owns: [] }).name);
}

/**
 * A **new surface offset** from another along its normals: `offset("s1", 3)`.
 * The original stays. Typed as `offset`, beside the sketch's offset of a
 * chain, told apart by a surface first; journalled as `offsetSurface`.
 */
export function offsetSurface(model: Model, s: unknown, d: unknown): string {
  const of = surfaceArg(model, "offset", s);
  if (typeof d !== "number" || !Number.isFinite(d) || d === 0) throw new Error(`offset("${of}", distance): a distance other than 0 — got ${quoted(d)}`);
  return model.asOperation("offsetSurface", [of, d], () => {
    const dim = surfaceDistance(model, d);
    return model.addSurface({ kind: "offset", of, size: dim, names: [of, dim], owns: [dim] }).name;
  });
}

/**
 * **Thickens** a surface into a solid: the sheet, its offset by `d` along its
 * normals (negative: the other way), and walls between — `thicken("s1", 2)`.
 * The surface is a solid from then on (drawn and exported as one). Journalled
 * as `thicken`.
 */
export function thicken(model: Model, s: unknown, d: unknown): string {
  const into = surfaceArg(model, "thicken", s);
  stillSheet(model, "thicken", into);
  if (typeof d !== "number" || !Number.isFinite(d) || d === 0) throw new Error(`thicken("${into}", thickness): a thickness other than 0 — got ${quoted(d)}`);
  return model.asOperation("thicken", [into, d], () => {
    const dim = surfaceDistance(model, d);
    return model.addSurface({ kind: "thicken", into, size: dim, names: [into, dim], owns: [dim] }).name;
  });
}

/** A closed knit made a solid: `solidify("s1")`. Refused by the kernel, said, while an edge is still open. Journalled as `solidify`. */
export function solidify(model: Model, s: unknown): string {
  const into = surfaceArg(model, "solidify", s);
  stillSheet(model, "solidify", into);
  return model.asOperation("solidify", [into], () => model.addSurface({ kind: "solidify", into, names: [into], owns: [] }).name);
}

/**
 * A **fillet or chamfer of surfaces**: between two — `fillet("s1", "s2", 3)`,
 * the edge they share once knitted rounded, or, where they are not yet one,
 * each trimmed back to the other where they cross (the larger piece of each,
 * or the side of each point in `keeps`) and knitted first — or of a
 * surface's own edges by name, as a solid's are: `fillet("s1", ["s1.m0|s1.m1"],
 * 3)`. Typed as `fillet` and `chamfer`, told from the sketch's and the solid's
 * by a surface first; journalled as `filletSurfaces` / `chamferSurfaces`.
 */
export function surfaceBlend(model: Model, kind: "fillet" | "chamfer", s: unknown, other: unknown, size: unknown, keeps?: unknown): string {
  const op = kind === "fillet" ? "filletSurfaces" : "chamferSurfaces";
  const into = surfaceArg(model, kind, s);
  let entry: Pick<SurfaceEntry, "with" | "edges" | "keeps">;
  const named: string[] = [];
  if (Array.isArray(other)) {
    if (!other.length || other.some((e) => typeof e !== "string" || !EDGE_NAME.test(e))) {
      throw new Error(`${kind}("${into}", [edges], size): an edge is named by its two faces, "s1.m0|s1.m1" — got ${quoted(other)}`);
    }
    entry = { edges: [...new Set(other as string[])] };
  } else {
    if (typeof other !== "string" || !model.surfaces.has(other)) {
      throw new Error(`${kind}("${into}", other, size): other is a surface (or a list of ${into}'s edges) — got ${quoted(other)}`);
    }
    stillSheet(model, kind, into);
    stillSheet(model, kind, other);
    if (surfaceNameOf(model, other) !== other && surfaceNameOf(model, other) !== surfaceNameOf(model, into)) {
      throw new Error(`${other} is part of ${surfaceNameOf(model, other)} now`);
    }
    if (other === into || (surfaceNameOf(model, other) === surfaceNameOf(model, into) && !isKnittedPartner(model, into, other))) {
      throw new Error(`${kind} between two surfaces takes two — ${other} is ${into}`);
    }
    const k = keeps === undefined || keeps === null ? null : keeps;
    if (k !== null && (!Array.isArray(k) || k.length !== 2 || k.some((p) => p !== null && (!Array.isArray(p) || p.length !== 3)))) {
      throw new Error(`${kind}("${into}", "${other}", size, keeps): keeps is [point on ${into}'s side, point on ${other}'s], each [x, y, z] or null`);
    }
    entry = { with: [other], ...(k ? { keeps: k as (number[] | null)[] } : {}) };
    named.push(other);
  }
  if (typeof size !== "number" || !Number.isFinite(size) || !(size > 0)) {
    throw new Error(`${kind}: the ${kind === "fillet" ? "radius" : "setback"} is a length more than 0, got ${quoted(size)}`);
  }
  const args = entry.edges ? [into, entry.edges, size] : entry.keeps ? [into, named[0], size, entry.keeps] : [into, named[0], size];
  return model.asOperation(op, args, () => {
    const d = kind === "fillet" ? filletRadius(model, size) : chamferSetback(model, size);
    return model.addSurface({ kind, into, ...entry, size: d, names: [into, ...named, d], owns: [d] }).name;
  });
}

/** Whether `other` was knitted into `s`'s surface (so a fillet between them names its own join). */
function isKnittedPartner(model: Model, s: string, other: string): boolean {
  const head = surfaceNameOf(model, s);
  return SURFACE_HEADS.includes(model.surfaceOf(other).kind) && other !== head && surfaceNameOf(model, other) === head;
}

// ---- words ------------------------------------------------------------------------

/** A record's sign in its surface's chain, as a body's are signed (+e3 −e2). */
const SIGN: Record<string, string> = {
  trim: "−", extend: "→", knit: "+", thicken: "▮", solidify: "■", fillet: "⌒", chamfer: "⌔", offset: "", face: "", planar: "", extrude: "", revolve: "",
};

/** The chain as a row says it: `extrude −s2 +s3 ⌒s4` (the knitted surface by its name, after the +). */
export function surfaceDetail(model: Model, chain: SurfaceChain): string {
  const head = chain.steps[0];
  const what = head.kind === "face" ? `face ${head.of}` : head.kind === "offset" ? `offset of ${head.of}` : head.kind;
  const steps = chain.steps.slice(1).map((s) => (s.kind === "knit" ? `+${(s.with ?? []).join("+")}` : `${SIGN[s.kind] ?? ""}${s.name}`));
  return [what, ...steps].join(" ");
}

/** One line for a record — what `ls()` prints and a menu heads: `s3  trim of s1 by l5`. */
export function describeSurface(model: Model, s: SurfaceEntry): string {
  const v = sizeOf(model, s);
  const n = Number.isFinite(v) ? ` = ${Math.round(v * 1000) / 1000}` : "";
  switch (s.kind) {
    case "extrude": return isEdgeExtrude(model, s)
      ? `${s.name}  edge extrude of ${(s.curves ?? []).join(" ")}, depth ${s.size}${n}`
      : `${s.name}  surface extruded from ${(s.curves ?? []).join(" ")}, depth ${s.size}${n}`;
    case "revolve": return `${s.name}  surface revolved from ${(s.curves ?? []).join(" ")} about ${s.axis}, angle ${s.size}${n}`;
    case "planar": return `${s.name}  planar surface of ${(s.curves ?? []).join(" ")}`;
    case "face": return `${s.name}  surface of the face ${s.of}`;
    case "offset": return `${s.name}  surface offset from ${s.of}, distance ${s.size}${n}`;
    case "trim": return `${s.name}  trim of ${s.into} by ${s.by}`;
    case "extend": return `${s.name}  extend of ${s.into} at ${s.edge}, by ${s.size}${n}`;
    case "knit": return `${s.name}  knit of ${(s.with ?? []).join(", ")} into ${s.into}`;
    case "thicken": return `${s.name}  ${s.into} thickened, ${s.size}${n}`;
    case "solidify": return `${s.name}  ${s.into} closed into a solid`;
    case "fillet":
    case "chamfer":
      return `${s.name}  ${s.kind} of ${s.into} ${s.edges ? `at ${s.edges.length} edge${s.edges.length === 1 ? "" : "s"}` : `to ${(s.with ?? []).join("")}`}, ${s.kind === "fillet" ? "radius" : "setback"} ${s.size}${n}`;
  }
}

/** Every surface that names `name` in its record, in order — what a deletion of `name` takes (`del`'s inward rule). */
export function surfacesNaming(model: Model, names: ReadonlySet<string>): string[] {
  const going = new Set(names);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of model.surfaces.values()) {
      if (going.has(s.name)) continue;
      if (s.names.some((n) => going.has(n)) || (s.into !== undefined && going.has(s.into))) {
        going.add(s.name);
        grew = true;
      }
    }
  }
  return [...model.surfaces.keys()].filter((n) => going.has(n) && !names.has(n));
}
