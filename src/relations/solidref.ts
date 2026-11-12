// A solid's faces and edges, by name, read off the model's own geometry —
// what a dimension or a relation to a solid holds (docs/plans/smart-dimension.md;
// the owner: *"Distance between two faces of a solid, or angle"*).
//
// **A face is named by what it is swept from** (docs/plans/review-relations.md):
// `e1.base` and `e1.lid` for the caps, and **`e1:l2`** for the wall of `e1`
// swept from the profile entity `l2` — the name every relation journals, and
// the one a tool is handed for the face under the hand. It is **resolved when
// read**, here and nowhere else: `faceSource` finds the wall the entity sweeps
// in the profile as it stands, so a trim, a split or a fillet of the profile
// leaves the name meaning the wall it meant.
//
// The solid kernel names a face of one build by its *place* in the profile
// (src/solids/naming.ts: `e1.m3`, the fourth member, members counted loop by
// loop), whether the body is drawn from its live geometry (faces.ts, one
// feature) or built by the kernel (a boolean), and that is what a drawn face
// carries. The two meet in two functions below: `faceRef` turns a place into
// the entity now in it — where a picked face, a typed `e1.m3` or an old file's
// becomes the written form — and `faceKernelNames` turns a name back into the
// places it is drawn as this build, to light it. A place is never journalled:
// a fillet of the profile's first corner puts an arc in place 1 and moves
// every wall after it up one, which is what `onplane(p, "e1.m3")` used to
// follow from one wall to the next (test/reviewrelations.test.ts holds a file
// that build saved). An **edge** is still the kernel's name, its two faces:
// `e1.lid|e1.m0` — it maps to an entity where it has one (`edgeSource`) and
// is otherwise only measured.
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
// a fillet regenerated, and one on `e1:l2` follows `l2` wherever a
// regeneration puts it. A wall whose line has left the profile altogether (a
// trim that took the region's edge elsewhere) is still read, as the plane
// that line would sweep, so a solve never meets a name that reads nothing;
// one whose line is deleted goes with the line (`referentsOf`, model.ts).

import type { Dual } from "../kernel/dual.ts";
import { Dual as D } from "../kernel/dual.ts";
import { memberName, parseFaceName, wallName, type FaceName, type FeatureEntry, type Model, type ProfileMember } from "../model.ts";
import { extrusionChord } from "./extrusion.ts";
import { planeBasis, unitDuals, type DirectionRef } from "./refs.ts";
import { axisReader, revolveProfilePlane, turnMatrix } from "./revolution.ts";
import { dot, vecSub } from "./vec.ts";

export type FaceRole = FaceName["role"];

// The name's shape is the model's (`parseFaceName`, model.ts — the namespace's
// owner, so `parseAxisRef` can tell a face from a mistyped axis); re-exported
// here, where everything that reads what a face is made of imports it from.
export { parseFaceName, type FaceName };

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

/** The places in `f`'s profile — the kernel's numbering — whose member is all or part of `entity`. */
function placesOf(f: FeatureEntry, entity: string): number[] {
  const out: number[] = [];
  members(f).forEach((m, k) => { if (memberName(m.base) === entity) out.push(k); });
  return out;
}

/** The surface an entity sweeps along `f`: a line's a plane, an arc's or circle's a cylinder; a revolve's are other. */
function sweptShape(model: Model, f: FeatureEntry, entity: string): "plane" | "cylinder" | "other" {
  const kind = model.entities.get(entity)?.kind;
  return f.kind === "revolve" ? "other" : kind === "line" ? "plane" : kind === "circle" || kind === "arc" ? "cylinder" : "other";
}

/**
 * The source of a face by name — **the one place a face's name is resolved**
 * — or null when the model has none (a fillet's face, a gone feature, an
 * entity that sweeps no wall of that feature). A wall named by its entity
 * (`e1:l2`) is found in the profile as it stands; one named by its place
 * (`e1.m3`, the kernel's tag, or an old file's) is the member there now.
 */
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
  const all = members(f);
  if (p.entity !== undefined) {
    // One entity may bound a region in several portions; every one of them
    // sweeps the same surface, so the first stands for the wall.
    const places = placesOf(f, p.entity);
    if (!places.length) return null;
    return {
      kind: "wall", feature: f, index: places[0], entity: p.entity,
      whole: places.every((k) => typeof all[k].base === "string"), shape: sweptShape(model, f, p.entity),
    };
  }
  const m = all[p.member];
  if (!m) return null;
  const entity = memberName(m.base);
  return { kind: "wall", feature: f, index: p.member, entity, whole: typeof m.base === "string", shape: sweptShape(model, f, entity) };
}

/**
 * A wall as a residual reads it once its relation is made: `faceSource`'s
 * answer, or — where the line a relation names has since left the profile (a
 * trim moved the region's edge to another line) and both it and the feature
 * are still there — the plane that line would sweep, `index` -1. A relation
 * is only ever *made* on a face the solid has (`faceSource`); this is what
 * keeps one from throwing inside a solve after the profile changed under it.
 */
function heldSource(model: Model, name: string): FaceSource | null {
  const s = faceSource(model, name);
  if (s) return s;
  const p = parseFaceName(name);
  const f = p?.entity !== undefined ? model.features.get(p.feature) : undefined;
  if (!p || p.entity === undefined || !f || !model.entities.has(p.entity)) return null;
  return { kind: "wall", feature: f, index: -1, entity: p.entity, whole: true, shape: sweptShape(model, f, p.entity) };
}

/**
 * **A face's written name** — what a relation journals and a tool is handed:
 * a wall by its place (`e1.m3`: the kernel's tag of a drawn face, a typed
 * one, an old file's) becomes the wall of the entity **now** in that place
 * (`e1:l4`); everything else — a cap, a wall already named by its entity, a
 * face only the kernel knows (`e3.f0`), a name that is no face — is itself.
 * Resolved once, here, when the relation is made or replayed; never again.
 */
export function faceRef(model: Model, name: string): string {
  const p = parseFaceName(name);
  if (!p || p.role !== "member" || p.entity !== undefined) return name;
  const f = model.features.get(p.feature);
  const m = f ? members(f)[p.member] : undefined;
  return m ? wallName(p.feature, memberName(m.base)) : name;
}

/**
 * The solid kernel's tags for the faces a name is **this build** — what a
 * drawn face carries (`Face.name`), so a face named by its entity can be found
 * among the faces on screen and lit: every place its entity bounds the profile
 * in. A cap, a place and a kernel-only name are their own tag.
 */
export function faceKernelNames(model: Model, name: string): string[] {
  const p = parseFaceName(name);
  if (!p || p.entity === undefined) return [name];
  const f = model.features.get(p.feature);
  return f ? placesOf(f, p.entity).map((k) => `${p.feature}.m${k}`) : [];
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
  const n = f.kind === "revolve" ? revolveProfilePlane(model, f, frame).n : extrudeNormal(model, f.depth, frame.n);
  if (f.kind === "extrude" || which === "base") return n;
  const theta = model.relations.get(f.angle)?.args[1];
  const ax = axisReader(model, f.axis).read();
  const r = turnMatrix(ax.dir, typeof theta === "number" ? theta : 0);
  return [0, 1, 2].map((i) => r[i][0] * n[0] + r[i][1] * n[1] + r[i][2] * n[2]);
}

/**
 * An extrude's way, as numbers: its chord over its reach (relations/extrusion.ts),
 * which way ever the solid has turned off its frame — the frame's own normal
 * while the chord is still along it, so nothing already dimensioned reads anew.
 */
function extrudeNormal(model: Model, depth: string, frameN: number[]): number[] {
  const chord = extrusionChord(model, depth);
  const d = model.relations.get(depth)?.args[1];
  if (!chord || typeof d !== "number") return frameN;
  // The depth's sign, never the reach: a through-all reach reads the bodies, which read this.
  const len = Math.hypot(...chord);
  if (!(len > 1e-12) || d === 0) return frameN;
  const n = chord.map((c) => (Math.sign(d) * c) / len);
  return Math.hypot(...n.map((c, i) => c - frameN[i])) < 1e-9 ? frameN : n;
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
  const s = heldSource(model, face);
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
  const s = heldSource(model, ref);
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
  // An edge is the kernel's name, so its walls are places; one written by its entity reads too.
  const place = (w: FaceName) => (w.entity !== undefined ? placesOf(f, w.entity)[0] ?? -1 : w.member);
  const m = ms[place(wall)];
  if (!m || typeof m.base !== "string") return null;
  if (other.role === "base") return m.base;
  if (other.role === "lid") return m.twin;
  const n = ms[place(other)];
  if (!n) return null;
  const shared = memberPoints(model, m.base).find((p) => memberPoints(model, n.base).includes(p));
  if (!shared) return null;
  return f.walls.find((w) => model.entities.get(w)?.kind === "line" && model.line(w).refs.includes(shared)) ?? null;
}

/** A face's hover line: `e1.lid  lid of e1`, `e1:l2  wall of e1 from l2  flat` — what it is, and what it was swept from. */
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
 *
 * **Journalled by the entities the walls are swept from** (`faceRef`): a wall
 * given by its place — `fdist("e1.m1", "e2.m3", 40)`, typed or in an old file
 * — is the wall of the line then in that place, and is held as
 * `fdist("e1:l2", "e2:l8", 40)` from then on, whatever a trim, a split or a
 * fillet does to either profile's order.
 */
export function faceDistance(model: Model, aGiven: string, bGiven: string, target: number): string {
  if (model.dim !== 3) throw new Error("fdist is a distance to a solid's face — a 3D model's");
  if (typeof target !== "number" || !Number.isFinite(target) || target < 0) {
    throw new Error(`fdist needs a distance of 0 or more, got ${JSON.stringify(target)}`);
  }
  const [a, b] = [faceRef(model, aGiven), faceRef(model, bGiven)];
  const [face, other] = isPlanarFace(model, a) ? [a, b] : isPlanarFace(model, b) ? [b, a] : [null, null];
  if (face === null || other === null) {
    throw new Error(`fdist measures square to a flat face of a solid — neither "${aGiven}" nor "${bGiven}" is one (e1.lid, e1.base, e1:l2)`);
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

/**
 * **`onplane(p, "e1:l2")`** — a point held on a solid's flat face
 * (docs/plans/click-on-face.md; the owner: *"if i am hovering over a face
 * without an active on-plane constraint, it should constrain to the plane i
 * am hovering over"*). The same op, journal entry, glyph (▱) and `del` as an
 * `onplane` on a frame or three points — `basic.onPlane` hands a face name
 * here — so a point a click put on a face is held exactly as a point drawn in
 * sketch mode is, by a relation the user can see and delete.
 *
 * The residual is (q − p) · n̂: q the point, p and n̂ the face read **lazily**
 * through the feature's record (`readPlane`), as `fdist` reads it, so the hold
 * follows a lid a `set` of the depth moved and a profile a fillet regenerated.
 * A cap's normal is a datum and its point one of the profile's; a wall's
 * normal is its line turned square to the extrusion, as Duals — so pulling a
 * point held on a wall can turn the wall, and the solid with it: a relation
 * between entities, both ways (profiles-held.md). Linear in q and not a
 * square. Refuses a face that is not flat, or that the model has no source
 * for (a fillet's), with the reason: nothing in the model holds such a face,
 * so nothing could hold a point to it.
 *
 * A wall is journalled by the entity it is swept from (`faceRef`): given by
 * its place (`"e1.m3"`), it is the wall of the line then there, from then on.
 */
export function onFace(model: Model, pointName: string, given: string): string {
  if (model.dim !== 3) throw new Error("onplane on a solid's face needs a 3D model");
  const p = model.point(pointName);
  const face = faceRef(model, given);
  const s = faceSource(model, face);
  if (!s) throw new Error(`"${given}" is no face of a feature this drawing holds — a face is named e1.lid, e1.base, or e1:l2 for the wall swept from l2`);
  if (!(s.kind === "cap" || s.shape === "plane")) {
    throw new Error(`"${face}" is not flat — it is swept from ${s.entity}, and no relation holds a point on a round face yet (TODO.md: onsurface)`);
  }
  readPlane(model, face); // refuses now, where it was typed, a face with no point to stand on
  return model.relation("onPlane", [pointName, face], () => {
    model.addResidual(() => [...p.varIndices, ...readPlane(model, face).vars], (l) => {
      const plane = readPlane(model, face);
      const q = l.slice(0, 3);
      const { p: at, n } = plane.plane(l.slice(3));
      return [dot(vecSub(q, at), n)];
    }, `onplane(${pointName},${face})`);
  });
}

/**
 * A flat face as a **direction** — its normal — for `par` and `perp`:
 * `par("c1", "e1:l2")` holds a circle's normal to a wall's, which is how a
 * curve drawn on a face is kept in it (tools/place.ts's `holdCurve`), as
 * `par("c1", "p1.p2.p3")` keeps one on three points' plane. Null for anything
 * that is not a flat face of a feature the model holds. A cap's normal is a
 * datum (`frame` set, so two datums are refused as they are for axes); a
 * wall's is its line's two ends as variables, read through `readPlane` at
 * every evaluation, so the wall can turn to meet the curve as well.
 */
export function faceDirection(model: Model, ref: string): DirectionRef | null {
  if (!isPlanarFace(model, ref)) return null;
  const s = faceSource(model, ref)!;
  if (s.kind === "cap") {
    return { width: 0, vars: () => [], direction: () => readPlane(model, ref).plane([]).n, frame: ref };
  }
  // A wall: the line's two ends, six variables, and nothing else is read.
  return {
    width: 6,
    vars: () => readPlane(model, ref).vars,
    direction: (own) => readPlane(model, ref).plane(own).n,
    frame: null,
  };
}

/** How far `b` is square to face `a` (either may be the face), now — what `fdist` holds. NaN where neither is a flat face. */
export function faceDistanceNow(model: Model, a: string, b: string): number {
  const [face, other] = isPlanarFace(model, a) ? [a, b] : isPlanarFace(model, b) ? [b, a] : [null, null];
  if (!face || !other) return NaN;
  const pl = planeNow(model, face)!;
  const q = pointNow(model, other);
  return Math.abs(q.reduce((s, x, i) => s + (x - pl.p[i]) * pl.n[i], 0));
}
