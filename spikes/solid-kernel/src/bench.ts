// The measurements, kernel-neutral: run in Node by bench/node.ts and in a
// Worker by worker.ts, so the two environments run the same code.

import type { Solid, SolidKernel, V3 } from "./kernel.ts";
import { nameAll } from "./naming.ts";
import { PARTS, type Dims, type Part } from "./parts.ts";

export interface PartReport {
  part: string;
  ok: boolean;
  error?: string;
  manifold?: boolean;
  failures?: number;
  volume?: number;
  expected?: number;
  /** |kernel − closed form| / closed form. */
  volumeError?: number;
  /** Largest coordinate difference between the kernel's tight box and the closed form's. */
  bboxError?: number;
  faces?: number;
  edges?: number;
  /** Milliseconds per kernel operation, summed by name. */
  ops?: Record<string, number>;
  buildMs?: number;
  tessMs?: number;
  triangles?: number;
  /** Triangles whose face id names no B-rep face. */
  unassigned?: number;
  heapDelta?: number;
  naming?: { untagged: number; shared: number; ambiguous: number };
  kinds?: Record<string, number>;
}

/** Wrap a kernel so every call is timed into `ops`. */
export function timed(k: SolidKernel, ops: Record<string, number>): SolidKernel {
  return new Proxy(k, {
    get(target, prop, recv) {
      const v = Reflect.get(target, prop, recv);
      if (typeof v !== "function") return v;
      return (...args: unknown[]) => {
        const t = performance.now();
        try {
          return v.apply(target, args);
        } finally {
          const key = String(prop);
          ops[key] = (ops[key] ?? 0) + performance.now() - t;
        }
      };
    },
  });
}

function bboxError(a: [V3, V3], b: [V3, V3]): number {
  let e = 0;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) e = Math.max(e, Math.abs(a[i][j] - b[i][j]));
  return e;
}

export function runPart(k: SolidKernel, part: Part, dims: Dims = part.dims, keep = false): PartReport & { solid?: Solid } {
  const ops: Record<string, number> = {};
  const tk = timed(k, ops);
  const heap0 = k.heapInUse();
  const t0 = performance.now();
  let s: Solid;
  try {
    s = part.build(tk, dims);
  } catch (e) {
    return { part: part.name, ok: false, error: String((e as Error).message ?? e), ops };
  }
  const buildMs = performance.now() - t0;
  const want = part.expect(dims);
  const v = k.volume(s);
  const box = k.bbox(s);
  const val = k.validity(s);
  const faces = k.faces(s);
  const t1 = performance.now();
  let triangles = -1, unassigned = -1;
  try {
    const mesh = k.tessellate(s, 0, 15);
    triangles = mesh.faceOf.length;
    unassigned = mesh.faceOf.filter((f) => f >= faces.length).length;
  } catch { /* reported as triangles = -1 */ }
  const tessMs = performance.now() - t1;
  const names = nameAll(k, s);
  const kinds: Record<string, number> = {};
  for (const f of faces) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
  const volumeError = Math.abs(v - want.volume) / want.volume;
  const r: PartReport & { solid?: Solid } = {
    part: part.name, ok: val.manifold && val.failures === 0 && volumeError < 1e-4 && bboxError(box, want.bbox) < 1e-3,
    manifold: val.manifold, failures: val.failures, volume: v, expected: want.volume, volumeError,
    bboxError: bboxError(box, want.bbox), faces: faces.length, edges: k.edges(s).length, ops, buildMs, tessMs,
    triangles, unassigned, heapDelta: k.heapInUse() - heap0,
    naming: { untagged: names.untagged, shared: names.shared, ambiguous: names.ambiguous }, kinds,
  };
  if (keep) r.solid = s;
  else k.free(s);
  return r;
}

/**
 * Every part twice: the first pass is what a user waits for on the first
 * build after load (the engine still compiling the wasm's hot paths up a
 * tier), the second is steady state. The report is the second, with the
 * first's times beside it.
 */
export function runAll(k: SolidKernel): (PartReport & { coldBuildMs?: number; coldTessMs?: number })[] {
  const cold = PARTS.map((p) => runPart(k, p));
  return PARTS.map((p, i) => ({ ...runPart(k, p), coldBuildMs: cold[i].buildMs, coldTessMs: cold[i].tessMs }));
}

/** One rebuild of every part, timed; solids freed. Returns ms. */
export function rebuildAll(k: SolidKernel, changed = false): number {
  const t = performance.now();
  for (const p of PARTS) {
    try {
      k.free(p.build(k, changed ? p.changed : p.dims));
    } catch { /* a failing part is reported by runAll; here only the time counts */ }
  }
  return performance.now() - t;
}

export interface HeapReport {
  rebuilds: number;
  inUseStart: number;
  inUseEnd: number;
  reservedStart: number;
  reservedEnd: number;
  /** In-use bytes after every 10th rebuild. */
  inUseCurve: number[];
  msFirst: number;
  msMedian: number;
}

export function heapOverRebuilds(k: SolidKernel, n = 100): HeapReport {
  const inUseStart = k.heapInUse(), reservedStart = k.heapReserved();
  const times: number[] = [];
  const curve: number[] = [];
  for (let i = 0; i < n; i++) {
    times.push(rebuildAll(k, i % 2 === 1));
    if (i % 10 === 9) curve.push(k.heapInUse());
  }
  const sorted = [...times].sort((a, b) => a - b);
  return {
    rebuilds: n, inUseStart, inUseEnd: k.heapInUse(), reservedStart, reservedEnd: k.heapReserved(),
    inUseCurve: curve, msFirst: times[0], msMedian: sorted[Math.floor(n / 2)],
  };
}

export interface IdentityReport {
  part: string;
  /** Every face and edge name of the original build is found again after the dimensions change. */
  sameNames: boolean;
  /** Names present in one build and not the other. */
  lost: string[];
  gained: string[];
  /** A named face keeps its surface kind across the rebuild. */
  kindsKept: boolean;
  untagged: number;
  shared: number;
  ambiguous: number;
  faces: number;
}

export function identity(k: SolidKernel, part: Part): IdentityReport | { part: string; error: string } {
  const look = (d: Dims) => {
    const s = part.build(k, d);
    const n = nameAll(k, s);
    const kinds = new Map(k.faces(s).map((f, i) => [n.faces[i], f.kind]));
    k.free(s);
    return { n, kinds };
  };
  try {
    const a = look(part.dims), b = look(part.changed);
    const setA = new Set([...a.n.faces, ...a.n.edges]), setB = new Set([...b.n.faces, ...b.n.edges]);
    const lost = [...setA].filter((x) => !setB.has(x));
    const gained = [...setB].filter((x) => !setA.has(x));
    const kindsKept = [...a.kinds].every(([name, kind]) => !b.kinds.has(name) || b.kinds.get(name) === kind);
    return {
      part: part.name, sameNames: lost.length === 0 && gained.length === 0, lost, gained, kindsKept,
      untagged: a.n.untagged, shared: a.n.shared, ambiguous: a.n.ambiguous, faces: a.n.faces.length,
    };
  } catch (e) {
    return { part: part.name, error: String((e as Error).message ?? e) };
  }
}
