// A solid's faces and edges, by name, read off the model's own geometry —
// what a dimension or a relation to a solid holds (docs/plans/smart-dimension.md;
// the owner: *"Distance between two faces of a solid, or angle"*).
//
// **A face is named as the solid kernel names it** (src/solids/naming.ts):
// `e1.base`, `e1.lid`, and `e1.m3` for the face swept from the profile's
// fourth member (members counted loop by loop). The same names whether the
// body is drawn from its live geometry (faces.ts, one feature) or built by
// the kernel (a boolean): the kernel tags a face by the feature and role that
// made it, and those are the record's. An **edge** is the kernel's name too,
// its two faces: `e1.lid|e1.m0`.
//
// **A face maps to its source where it has one** — which is every face a
// sweep made, because a sweep is real geometry here (ARCHITECTURE.md, "A
// solid's faces are drawn, never stored"):
//
// - a cap (an extrude's base and lid, a partial revolve's base and end) is a
//   plane through the profile's points or their twins, facing the way the
//   sketch plane faces (turned through the angle, for a revolve's end);
// - an extrude's wall is its member swept: a line's wall the plane through
//   the line along the extrusion, an arc's or circle's the cylinder of its
//   radius — the member entity is what a dimension on it names;
// - an edge between two of one extrude's faces is an entity: a lid's edge
//   the member's twin, a base's the member, a side edge the wall line at the
//   corner the two members share.
//
// What has no source — a face or an edge a fillet or a boolean made, a
// revolve's swept surface — is the kernel's alone, and only a driven
// dimension can read it, through the reader the host hands `measure.ts`.
//
// **The names are read lazily**, every evaluation, through the feature's
// record, so a relation on `e1.lid` follows a lid a `set` moved and a profile
// a fillet regenerated. A wall named by its index is the kernel's caveat
// too: a regeneration that inserts a member (a fillet's arc) renumbers the
// walls after it, as it renumbers the kernel's faces. Same-feature walls are
// therefore dimensioned through their lines (dimensioning.ts), which follow
// any regeneration; `fdist` keeps a wall's index only between two features.

import type { Dual } from "../kernel/dual.ts";
import { Dual as D } from "../kernel/dual.ts";
import { memberName, type FeatureEntry, type Model, type ProfileMember } from "../model.ts";
import { planeBasis, unitDuals } from "./refs.ts";
import { axisReader, revolveProfilePlane, turnMatrix } from "./revolution.ts";
import { dot, vecSub } from "./vec.ts";

export type FaceRole = "base" | "lid" | "member";

/** A face's name, parsed: whose, and which. */
export interface FaceName {
  feature: string;
  role: FaceRole;
  /** The member's index, loop by loop, for a wall; -1 for a cap. */
  member: number;
}

const FACE = /^(e\d+)\.(base|lid|m(\d+))$/;

/** `e1.lid` → `{ feature: "e1", role: "lid" }`, or null for anything else. */
export function parseFaceName(name: unknown): FaceName | null {
  if (typeof name !== "string") return null;
  const m = FACE.exec(name);
  if (!m) return null;
  return m[2] === "base" || m[2] === "lid"
    ? { feature: m[1], role: m[2], member: -1 }
    : { feature: m[1], role: "member", member: Number(m[3]) };
}

/** A kernel edge's two face names (`e1.lid|e1.m0`), or null. */
export function parseEdgeName(name: unknown): [string, string] | null {
  if (typeof name !== "string") return null;
  const parts = name.split("|");
  return parts.length === 2 && parts.every((p) => p.includes(".")) ? [parts[0], parts[1]] : null;
}

/** A feature's members flattened loop by loop — the kernel's member numbering — each with its twin. */
function members(f: FeatureEntry): { base: ProfileMember; twin: string | null }[] {
  const out: { base: ProfileMember; twin: string | null }[] = [];
  f.loops.forEach((loop, i) => loop.forEach((m, k) => out.push({ base: m, twin: f.twins[i]?.[k] ?? null })));
  return out;
}

/** What a face is made of in the model: a cap of a feature, or the wall one member swept. */
export type FaceSource =
  | { kind: "cap"; feature: FeatureEntry; which: "base" | "lid" }
  | {
    kind: "wall";
    feature: FeatureEntry;
    index: number;
    /** The member's entity — the whole line, arc or circle the wall was swept from. */
    entity: string;
    /** Whether the member is the whole entity, or a portion of it (a region a crossing split). */
    whole: boolean;
    /** What surface it is: a line's wall a plane, an arc's or circle's a cylinder; a revolve's walls are other. */
    shape: "plane" | "cylinder" | "other";
  };

/** The source of a face named as the kernel names it, or null when the model has none (a fillet's face, a gone feature). */
export function faceSource(model: Model, name: string): FaceSource | null {
  const p = parseFaceName(name);
  if (!p) return null;
  const f = model.features.get(p.feature);
  if (!f) return null;
  if (p.role !== "member") {
    // A full turn has no caps: it closes on itself.
    if (f.kind === "revolve" && f.twins.length === 0) return null;
    return { kind: "cap", feature: f, which: p.role };
  }
  const m = members(f)[p.member];
  if (!m) return null;
  const entity = memberName(m.base);
  const kind = model.entities.get(entity)?.kind;
  const shape = f.kind === "revolve" ? "other" : kind === "line" ? "plane" : kind === "circle" || kind === "arc" ? "cylinder" : "other";
  return { kind: "wall", feature: f, index: p.member, entity, whole: typeof m.base === "string", shape };
}

/** Whether `name` is a face of a feature the model holds, and flat — a cap, or a line's wall. */
export function isPlanarFace(model: Model, name: unknown): boolean {
  if (typeof name !== "string") return false;
  const s = faceSource(model, name);
  return s !== null && (s.kind === "cap" || s.shape === "plane");
}

/** The points a member runs between — a line's ends, an arc's, a circle's centre (in its plane). */
function memberPoints(model: Model, m: ProfileMember): string[] {
  if (typeof m !== "string") return [m.from, m.to];
  const e = model.entities.get(m);
  if (!e) return [];
  if (e.kind === "line") return [...e.refs];
  if (e.kind === "arc") return [e.start, e.end];
  if (e.kind === "circle") return [e.center];
  const refs = model.refsOf(e);
  return refs.length ? [refs[0]] : [];
}

/** A cap's points: the outer loop's members' ends, or their twins' for the far cap. */
export function capPoints(model: Model, f: FeatureEntry, which: "base" | "lid"): string[] {
  const out: string[] = [];
  const loop = which === "base" ? f.loops[0] : f.twins[0] ?? [];
  for (const m of loop) for (const p of memberPoints(model, m)) if (!out.includes(p)) out.push(p);
  return out;
}

/**
 * Which way a cap faces, as plain numbers: the sketch plane's normal — the
 * way an extrude's lid went — turned through the angle for a revolve's end.
 * A datum, read and never pushed, as a frame's axes are (`frameBasis`): the
 * cap's points are what a relation on it moves.
 */
function capNormal(model: Model, f: FeatureEntry, which: "base" | "lid"): number[] {
  const frame = planeBasis(model, f.frame)();
  // A revolve's profile may have turned about its axis off its frame: its own plane, then (profiles-held.md).
  const n = f.kind === "revolve" ? revolveProfilePlane(model, f, frame).n : frame.n;
  if (f.kind === "extrude" || which === "base") return n;
  const theta = model.relations.get(f.angle)?.args[1];
  const ax = axisReader(model, f.axis).read();
  const r = turnMatrix(ax.dir, typeof theta === "number" ? theta : 0);
  return [0, 1, 2].map((i) => r[i][0] * n[0] + r[i][1] * n[1] + r[i][2] * n[2]);
}

/** A variable layout and what it reads: the plane's point and unit normal, as Duals. */
export interface PlaneRead {
  vars: number[];
  plane(l: Dual[]): { p: Dual[]; n: Dual[] };
}

/** A variable layout and the one point it reads, as Duals. */
export interface PointRead {
  vars: number[];
  at(l: Dual[]): Dual[];
}

const constants = (v: number[]) => v.map((x) => D.constant(x));
const cross = (a: Dual[], b: Dual[]): Dual[] => [
  a[1].mul(b[2]).sub(a[2].mul(b[1])), a[2].mul(b[0]).sub(a[0].mul(b[2])), a[0].mul(b[1]).sub(a[1].mul(b[0])),
];

/**
 * A planar face as a residual reads it, **now** — call it inside the
 * relation's variable thunk, so the layout follows the record: a cap is its
 * first point and the sketch plane's normal (a datum); a line's wall is the
 * line's two ends, its normal the line turned square to the extrusion, as
 * Duals — so a relation on a wall can turn the wall by turning its line.
 */
export function readPlane(model: Model, face: string): PlaneRead {
  const s = faceSource(model, face);
  if (!s) throw new Error(`"${face}" is no face of a feature this drawing holds`);
  if (s.kind === "cap") {
    const pts = capPoints(model, s.feature, s.which);
    if (!pts.length) throw new Error(`"${face}" has no point to stand on`);
    const n = constants(capNormal(model, s.feature, s.which));
    return { vars: [...model.point(pts[0]).varIndices], plane: (l) => ({ p: l, n }) };
  }
  if (s.shape !== "plane") throw new Error(`"${face}" is not flat — it is swept from ${s.entity}`);
  const l = model.line(s.entity);
  const d = constants(capNormal(model, s.feature, "base"));
  return {
    vars: [...model.point(l.refs[0]).varIndices, ...model.point(l.refs[1]).varIndices],
    plane: (v) => {
      const [a, b] = [v.slice(0, 3), v.slice(3, 6)];
      return { p: a, n: unitDuals(cross(vecSub(b, a), d)) };
    },
  };
}

/**
 * The one point of something a distance to a plane is measured from: a
 * point; a line's middle; a circle's or arc's centre; a planar face's own
 * point — a cap's first, a wall's line's middle.
 */
export function readPoint(model: Model, ref: string): PointRead {
  const e = model.entities.get(ref);
  if (e?.kind === "point") return { vars: [...e.varIndices], at: (l) => l };
  if (e?.kind === "line") {
    return {
      vars: [...model.point(e.refs[0]).varIndices, ...model.point(e.refs[1]).varIndices],
      at: (l) => l.slice(0, 3).map((x, i) => x.add(l[3 + i]).div(2)),
    };
  }
  if (e?.kind === "circle" || e?.kind === "arc") return readPoint(model, e.center);
  const s = faceSource(model, ref);
  if (s?.kind === "cap") return readPoint(model, capPoints(model, s.feature, s.which)[0]);
  if (s?.kind === "wall" && s.shape === "plane") return readPoint(model, s.entity);
  throw new Error(`"${ref}" is not a point, a line, a circle or a flat face`);
}

/** A planar face now, as numbers: a point on it and its unit normal. Null where the model has no source for it. */
export function planeNow(model: Model, face: string): { p: number[]; n: number[] } | null {
  if (!isPlanarFace(model, face)) return null;
  const r = readPlane(model, face);
  const { p, n } = r.plane(constants(r.vars.map((i) => model.problem.getVar(i))));
  return { p: p.map((x) => x.val), n: n.map((x) => x.val) };
}

/** The point `readPoint` reads, now. */
export function pointNow(model: Model, ref: string): number[] {
  const r = readPoint(model, ref);
  return r.at(constants(r.vars.map((i) => model.problem.getVar(i)))).map((x) => x.val);
}

/**
 * The entity an edge of a kernel body is, where one extrude made both its
 * faces: a lid's edge is the member's twin, a base's the member, a side edge
 * the wall line at the corner its two members share. Null where it has none
 * — an edge a boolean or a fillet made, or one along a portion of a line
 * (a region a crossing split), which is only part of an entity.
 */
export function edgeSource(model: Model, edge: string): string | null {
  const faces = parseEdgeName(edge);
  if (!faces) return null;
  const [a, b] = faces.map(parseFaceName);
  if (!a || !b || a.feature !== b.feature) return null;
  const f = model.features.get(a.feature);
  if (!f || f.kind !== "extrude") return null;
  const ms = members(f);
  const wall = a.role === "member" ? a : b.role === "member" ? b : null;
  const other = wall === a ? b : a;
  if (!wall) return null;
  const m = ms[wall.member];
  if (!m || typeof m.base !== "string") return null;
  if (other.role === "base") return m.base;
  if (other.role === "lid") return m.twin;
  const n = ms[other.member];
  if (!n) return null;
  const shared = memberPoints(model, m.base).find((p) => memberPoints(model, n.base).includes(p));
  if (!shared) return null;
  return f.walls.find((w) => model.entities.get(w)?.kind === "line" && model.line(w).refs.includes(shared)) ?? null;
}

/** A face's hover line: `e1.lid  lid of e1` — what it is, and what it was swept from. */
export function describeFace(model: Model, name: string): string {
  const s = faceSource(model, name);
  if (!s) return `${name}  face`;
  if (s.kind === "cap") {
    const what = s.which === "base" ? "base" : s.feature.kind === "revolve" ? "end" : "lid";
    return `${name}  ${what} of ${s.feature.name}`;
  }
  const shape = s.shape === "plane" ? "flat" : s.shape === "cylinder" ? `round, r ${Math.round(model.radius(s.entity) * 1000) / 1000}` : "swept";
  return `${name}  wall of ${s.feature.name} from ${s.entity}  ${shape}`;
}

/**
 * **`fdist(a, b, d)`** — a distance square to a flat face: from face `a` to
 * `b`, which is a point, a line (its middle), a circle (its centre) or
 * another flat face (its own point). Either side may be the face; the first
 * flat face named is the one measured square to. A dimension (`d`-named,
 * `set` re-runs it) for what a face's own `dist` cannot say: a lid of one
 * extrude to a lid of another, a corner of one solid to the face of
 * another.
 *
 * The residual is |(q − p) · n| − d: p a point of the face and n its unit
 * normal, q the other side's point. Linear in the points, so not a square;
 * and the absolute value has its kink only at 0, which a distance between two
 * faces is not. A cap's normal is the sketch plane's, read as a datum; a
 * wall's is its line turned square to the extrusion, as Duals, so a wall can
 * be turned to meet it.
 *
 * Read lazily (`readPlane`, `readPoint`), so it follows a lid `set` moved and
 * a profile a fillet regenerated. 3D only: a face is a solid's.
 */
export function faceDistance(model: Model, a: string, b: string, target: number): string {
  if (model.dim !== 3) throw new Error("fdist is a distance to a solid's face — a 3D model's");
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0) {
    throw new Error(`fdist needs a distance of 0 or more, got ${JSON.stringify(target)}`);
  }
  const [face, other] = isPlanarFace(model, a) ? [a, b] : isPlanarFace(model, b) ? [b, a] : [null, null];
  if (face === null || other === null) {
    throw new Error(`fdist measures square to a flat face of a solid — neither "${a}" nor "${b}" is one (e1.lid, e1.base, e1.m0)`);
  }
  // Read both now: a name that reads nothing refuses where it was typed.
  readPlane(model, face);
  readPoint(model, other);
  return model.relation("faceDistance", [a, b, target], () => {
    const layout = () => {
      const plane = readPlane(model, face);
      return { plane, point: readPoint(model, other) };
    };
    model.addResidual(() => {
      const { plane, point } = layout();
      return [...plane.vars, ...point.vars];
    }, (l) => {
      const { plane, point } = layout();
      const { p, n } = plane.plane(l.slice(0, plane.vars.length));
      const q = point.at(l.slice(plane.vars.length));
      const d = dot(vecSub(q, p), n);
      return [(d.val < 0 ? d.neg() : d).sub(target)];
    }, `fdist(${a},${b})`);
  });
}

/** How far `b` is square to face `a` (either may be the face), now — what `fdist` holds. NaN where neither is a flat face. */
export function faceDistanceNow(model: Model, a: string, b: string): number {
  const [face, other] = isPlanarFace(model, a) ? [a, b] : isPlanarFace(model, b) ? [b, a] : [null, null];
  if (!face || !other) return NaN;
  const pl = planeNow(model, face)!;
  const q = pointNow(model, other);
  return Math.abs(q.reduce((s, x, i) => s + (x - pl.p[i]) * pl.n[i], 0));
}
