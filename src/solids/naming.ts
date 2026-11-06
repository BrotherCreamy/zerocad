// Identity across rebuilds: what a face or an edge of a solid is called, so a
// pick, a hover and a sketch on a face refer to the same one after the solid
// is rebuilt (docs/plans/solids-kernel.md; the spike measured it).
//
// A sketch on a face, or a constraint to a solid's edge, holds a *name*. When
// the part is rebuilt after a dimension changes, every face and edge is new
// kernel topology; the name must find the one that plays the same part.
//
// The scheme (the generating feature and profile member): right after a sweep, each face is tagged with
// `feature·1000 + role`, where role 0 is the base cap, 1 the lid or end cap,
// and 2 + i the face swept from profile member i (members numbered loop by
// loop). A later boolean keeps those tags on whatever survives of each face —
// the kernel's attribute propagation, SmAttribute.h §5 — so a face's name is
// its tag's: `e1.lid`, `e3.m0`. A face a boolean **splits** is several faces
// with one tag, and they keep the one name: a reference to `e1.m1` means every
// piece of it, which is what survives a hole dragged across the wall (each
// piece is told apart by its neighbours, `piece`, for whoever needs one; that
// part of a name does not survive a change of topology, and is never stored).
// A face a fillet or chamfer *makes* comes out of the kernel with no tag; a
// blend feature tags each one after the edge it was made of (`e3.f0`, the face
// fillet e3 made of the first edge it names — docs/plans/solid-fillets.md), and
// a face no one tags is named by the faces it blends (`blend(e1.lid,e1.m0)`).
// An edge is named by its two faces' names.
//
// Measured through changes of topology (test/solidsidentity.test.ts): a pocket
// deepened until it breaks through loses its floor, `e2.lid`, and nothing
// else; a hole dragged out through a wall splits that wall into two pieces
// that still answer to its name. What vanished is reported as vanished,
// never re-attached to a neighbour.

import type { Placement, Profile, Solid, SolidKernel, V2, V3 } from "./kernel.ts";
import { distanceTo } from "./profile.ts";

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
  const starts: V2[] = profile.loops[0].map((m) => (m.kind === "line" ? m.from : m.kind === "nurbs" ? [m.points[0][0], m.points[0][1]] : m.centre));
  const side = Math.sign(starts.reduce((acc, p) => acc + (p[0] - point[0]) * n[0] + (p[1] - point[1]) * n[1], 0)) || 1;
  k.faces(s).forEach((f, i) => {
    const q = local(at, f.point);
    const rel: V3 = [q[0] - point[0], q[1] - point[1], q[2]];
    const along = rel[0] * u[0] + rel[1] * u[1];
    const across = rel[0] * n[0] + rel[1] * n[1];
    // Turn the point back into the profile's half-plane, keeping its distance from the axis.
    const r = Math.hypot(across, rel[2]);
    const p2: V2 = [point[0] + u[0] * along + n[0] * r * side, point[1] + u[1] * along + n[1] * r * side];
    // The kernel turns right-handed about +dir, which carries the profile's
    // side of the axis (side·n̂) toward z = side (dir × side·n̂ = side·ẑ): so
    // the angle reached is atan2(z·side, across·side). Reading it without the
    // side mirrored a profile on the axis's other side, and its end cap was
    // named for a member (found writing modes.ts's insideness).
    const angle = Math.atan2(rel[2] * side, across * side) * 180 / Math.PI;
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
  /** Each face's tag, -1 for none. */
  tags: number[];
  /** Each face's name: its tag's (`e1.lid`), or `blend(…)` for an untagged one. Shared by the pieces of a split face. */
  faces: string[];
  /** Each face's name with its neighbours, where it is one piece of several (`e1.lid[e1.m0,e2.m1]`); else its name. */
  pieces: string[];
  edges: string[];
  /** Faces with no tag after the operations. */
  untagged: number;
  /** Faces whose tag another face also carries (split by an operation). */
  shared: number;
  /** Names that still are not unique after disambiguation by neighbours. */
  ambiguous: number;
}

/**
 * A tag's feature number and its role's name: `base`, `lid`, `m3` (the face
 * swept from member 3), primed for an offset — or, for a feature in `blends`
 * (a fillet's or a chamfer's, docs/plans/solid-fillets.md), `f3`: the face it
 * made of the fourth edge it names. A blend makes no base, lid or member face,
 * so its faces take the member roles, counted over its edges instead.
 */
export function tagParts(t: number, blends: ReadonlySet<number> = NO_BLENDS): { feature: number; role: string; member: number | null } {
  const f = Math.floor(t / 1000), r0 = t % 1000;
  const r = r0 % ROLE_OFFSET;
  const member = r >= ROLE_MEMBER ? r - ROLE_MEMBER : null;
  if (member !== null && blends.has(f)) return { feature: f, role: `f${member}`, member };
  const role = r === ROLE_BASE ? "base" : r === ROLE_LID ? "lid" : `m${member}`;
  return { feature: f, role: `${role}${r0 >= ROLE_OFFSET ? "'" : ""}`, member };
}

const NO_BLENDS: ReadonlySet<number> = new Set();

/** A tag's name: the feature's (`prefix` and its number) and the role, `e1.lid` — or `e3.f0`, a blend's face. */
export function tagName(t: number, prefix = "F", blends: ReadonlySet<number> = NO_BLENDS): string {
  if (t < 0) return "?";
  const { feature, role } = tagParts(t, blends);
  return `${prefix}${feature}.${role}`;
}

/**
 * The tag of the face a blend made of its edge `edge` (its place in the
 * blend's list): the member role of that index, which `tagParts` names `f…`
 * for a blend. At most 498 edges a blend before the tag runs into the offset
 * roles — the evaluator refuses more rather than misname them.
 */
export function blendTag(feature: number, edge: number): number {
  return feature * 1000 + ROLE_MEMBER + edge;
}

/** How many edges one blend can name and tag apart (see `blendTag`). */
export const BLEND_EDGES = ROLE_OFFSET - ROLE_MEMBER;

/**
 * Name every face and edge of a solid from its tags: a tagged face by its tag,
 * a face split into pieces by its tag and its neighbours' tags, an untagged
 * one (a fillet's) by the faces it touches, an edge by its two faces.
 */
export function nameAll(k: SolidKernel, s: Solid, prefix = "F"): Names {
  return namesOf(k.faces(s), k.edges(s), prefix);
}

/** `nameAll` over faces and edges already asked for. */
export function namesOf(faces: readonly { tag: number }[], edges: readonly { faces: [number, number] }[], prefix = "F",
  blends: ReadonlySet<number> = NO_BLENDS): Names {
  const neighbours: Set<number>[] = faces.map(() => new Set());
  for (const e of edges) {
    const [a, b] = e.faces;
    if (a >= 0 && b >= 0 && a !== b) { neighbours[a].add(b); neighbours[b].add(a); }
  }
  const base = faces.map((f) => tagName(f.tag, prefix, blends));
  const count = new Map<string, number>();
  for (const n of base) count.set(n, (count.get(n) ?? 0) + 1);
  const untagged = faces.filter((f) => f.tag < 0).length;
  const shared = faces.filter((f, i) => f.tag >= 0 && (count.get(base[i]) ?? 0) > 1).length;
  const ring = (i: number) => [...neighbours[i]].map((j) => base[j]).filter((n) => n !== "?").sort();
  const names = faces.map((f, i) => (f.tag < 0 ? `blend(${[...new Set(ring(i))].join(",")})` : base[i]));
  const pieces = faces.map((f, i) => {
    if (f.tag >= 0 && (count.get(base[i]) ?? 0) > 1) return `${base[i]}[${[...new Set(ring(i))].join(",")}]`;
    return names[i];
  });
  const final = new Map<string, number>();
  for (const n of pieces) final.set(n, (final.get(n) ?? 0) + 1);
  const ambiguous = pieces.filter((n) => (final.get(n) ?? 0) > 1).length;
  // An edge with one face is the seam a closed surface is cut along (a whole
  // cylinder's): no edge of the solid's shape, and named so — it comes and
  // goes with the surface's closedness, and nothing should hold on to it.
  const edgeNames = edges.map((e) => {
    const on = e.faces.filter((j) => j >= 0);
    return on.length === 1 || (on.length === 2 && on[0] === on[1]) ? `${names[on[0]]}:seam` : on.map((j) => names[j]).sort().join("|");
  });
  return { tags: faces.map((f) => f.tag), faces: names, pieces, edges: edgeNames, untagged, shared, ambiguous };
}

/** Edge indices whose name is in `wanted` — how a feature names the edges it fillets, rebuild after rebuild. */
export function edgesNamed(k: SolidKernel, s: Solid, wanted: (name: string, index: number) => boolean, prefix = "F"): number[] {
  const { edges } = nameAll(k, s, prefix);
  return edges.flatMap((n, i) => (wanted(n, i) ? [i] : []));
}
