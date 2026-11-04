// Identity across rebuilds — the experiment that decides whether a relational
// model can sit on a kernel.
//
// A sketch on a face, or a constraint to a solid's edge, holds a *name*. When
// the part is rebuilt after a dimension changes, every face and edge is new
// kernel topology; the name must find the one that plays the same part.
//
// The scheme tested (the generating feature and profile member, as the spec
// proposes): right after a sweep, each face is tagged with
// `feature·1000 + role`, where role 0 is the base cap, 1 the lid or end cap,
// and 2 + i the face swept from profile member i (members numbered loop by
// loop). Whether a later boolean or fillet keeps those tags on what survives
// of each face is the kernel's attribute propagation, and is what is measured.
// A face a fillet or chamfer *makes* has no tag; it is named by the faces it
// blends. An edge is named by its two faces.

import type { Placement, Profile, Solid, SolidKernel, V2, V3 } from "./kernel.ts";
import { distanceTo } from "./profiles.ts";

const ROLE_BASE = 0, ROLE_LID = 1, ROLE_MEMBER = 2;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A world point in a placement's local coordinates. */
function local(at: Placement, p: V3): V3 {
  const d = sub(p, at.origin);
  return [dot(d, at.x), dot(d, at.y), dot(d, cross(at.x, at.y))];
}

function nearestMember(profile: Profile, p: V2): number {
  let best = -1, bestD = Infinity, i = 0;
  for (const loop of profile.loops) for (const m of loop) {
    const d = distanceTo(m, p);
    if (d < bestD) { bestD = d; best = i; }
    i++;
  }
  return best;
}

/** Tag every face of a freshly extruded solid by what made it. */
export function tagExtrude(k: SolidKernel, s: Solid, feature: number, profile: Profile, depth: number, at: Placement): void {
  const tol = 1e-6 * Math.max(1, Math.abs(depth));
  k.faces(s).forEach((f, i) => {
    const q = local(at, f.point);
    let role: number;
    if (f.kind === "plane" && Math.abs(q[2]) < tol) role = ROLE_BASE;
    else if (f.kind === "plane" && Math.abs(q[2] - depth) < tol) role = ROLE_LID;
    else role = ROLE_MEMBER + nearestMember(profile, [q[0], q[1]]);
    k.tagFace(s, i, feature * 1000 + role);
  });
}

/** Tag every face of a freshly revolved solid: the face each member swept, and a partial turn's two caps. */
export function tagRevolve(k: SolidKernel, s: Solid, feature: number, profile: Profile, point: V2, dir: V2,
  degrees: number, at: Placement): void {
  const len = Math.hypot(dir[0], dir[1]);
  const u: V2 = [dir[0] / len, dir[1] / len];
  const n: V2 = [-u[1], u[0]];
  // Which side of the axis the profile lies on: a revolve's profile is all on
  // one, but some of its points may be on the axis itself, so sum them all.
  const starts: V2[] = profile.loops[0].map((m) => (m.kind === "line" ? m.from : m.centre));
  const side = Math.sign(starts.reduce((acc, p) => acc + (p[0] - point[0]) * n[0] + (p[1] - point[1]) * n[1], 0)) || 1;
  k.faces(s).forEach((f, i) => {
    const q = local(at, f.point);
    const rel: V3 = [q[0] - point[0], q[1] - point[1], q[2]];
    const along = rel[0] * u[0] + rel[1] * u[1];
    const across = rel[0] * n[0] + rel[1] * n[1];
    // Turn the point back into the profile's half-plane, keeping its distance from the axis.
    const r = Math.hypot(across, rel[2]);
    const p2: V2 = [point[0] + u[0] * along + n[0] * r * side, point[1] + u[1] * along + n[1] * r * side];
    const angle = Math.atan2(rel[2], across * side) * 180 / Math.PI;
    let role = ROLE_MEMBER + nearestMember(profile, p2);
    if (degrees < 360 && f.kind === "plane") {
      // A planar cap of a partial turn lies at angle 0 or `degrees`.
      const a = ((angle % 360) + 360) % 360;
      const atStart = Math.min(a, 360 - a) < 1e-3;
      const atEnd = Math.abs(a - degrees) < 1e-3;
      if (atStart) role = ROLE_BASE;
      else if (atEnd) role = ROLE_LID;
    }
    k.tagFace(s, i, feature * 1000 + role);
  });
}

/** Added to a role for the face an offset (a shell's inner wall) made from it. */
export const ROLE_OFFSET = 500;

/**
 * After a shell: a face whose tag another face shares and which does not lie
 * on the face of that tag in the solid before the shell is the offset copy —
 * the kernel copied the tag onto both — and is tagged as such.
 */
export function tagOffsets(k: SolidKernel, before: Solid, after: Solid, tol = 1e-6): void {
  const old = k.faces(before);
  const now = k.faces(after);
  const count = new Map<number, number>();
  for (const f of now) count.set(f.tag, (count.get(f.tag) ?? 0) + 1);
  now.forEach((f, i) => {
    if (f.tag < 0 || (count.get(f.tag) ?? 0) < 2) return;
    const j = old.findIndex((o) => o.tag === f.tag);
    if (j >= 0 && k.distanceToFace(before, j, f.point) > tol) k.tagFace(after, i, f.tag + ROLE_OFFSET);
  });
}

export interface Names {
  faces: string[];
  edges: string[];
  /** Faces with no tag after the operations. */
  untagged: number;
  /** Faces whose tag another face also carries (split by an operation). */
  shared: number;
  /** Names that still are not unique after disambiguation by neighbours. */
  ambiguous: number;
}

function tagName(t: number): string {
  if (t < 0) return "?";
  const f = Math.floor(t / 1000), r0 = t % 1000;
  const r = r0 % ROLE_OFFSET;
  const role = r === ROLE_BASE ? "base" : r === ROLE_LID ? "lid" : `m${r - ROLE_MEMBER}`;
  return `F${f}.${role}${r0 >= ROLE_OFFSET ? "'" : ""}`;
}

/**
 * Name every face and edge of a solid from its tags: a tagged face by its tag,
 * a face split into pieces by its tag and its neighbours' tags, an untagged
 * one (a fillet's) by the faces it touches, an edge by its two faces.
 */
export function nameAll(k: SolidKernel, s: Solid): Names {
  const faces = k.faces(s);
  const edges = k.edges(s);
  const neighbours: Set<number>[] = faces.map(() => new Set());
  for (const e of edges) {
    const [a, b] = e.faces;
    if (a >= 0 && b >= 0 && a !== b) { neighbours[a].add(b); neighbours[b].add(a); }
  }
  const base = faces.map((f) => tagName(f.tag));
  const count = new Map<string, number>();
  for (const n of base) count.set(n, (count.get(n) ?? 0) + 1);
  const untagged = faces.filter((f) => f.tag < 0).length;
  const shared = faces.filter((f, i) => f.tag >= 0 && (count.get(base[i]) ?? 0) > 1).length;
  const ring = (i: number) => [...neighbours[i]].map((j) => base[j]).filter((n) => n !== "?").sort();
  const names = faces.map((f, i) => {
    if (f.tag < 0) return `blend(${[...new Set(ring(i))].join(",")})`;
    if ((count.get(base[i]) ?? 0) > 1) return `${base[i]}[${[...new Set(ring(i))].join(",")}]`;
    return base[i];
  });
  const final = new Map<string, number>();
  for (const n of names) final.set(n, (final.get(n) ?? 0) + 1);
  const ambiguous = names.filter((n) => (final.get(n) ?? 0) > 1).length;
  const edgeNames = edges.map((e) => e.faces.filter((j) => j >= 0).map((j) => names[j]).sort().join("|"));
  return { faces: names, edges: edgeNames, untagged, shared, ambiguous };
}

/** Edge indices whose name is in `wanted` — how a feature names the edges it fillets, rebuild after rebuild. */
export function edgesNamed(k: SolidKernel, s: Solid, wanted: (name: string, index: number) => boolean): number[] {
  const { edges } = nameAll(k, s);
  return edges.flatMap((n, i) => (wanted(n, i) ? [i] : []));
}
