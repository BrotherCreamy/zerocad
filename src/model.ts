// The entity graph sitting on top of the kernel. Deliberately thin: entities
// hold *structure* (names, references, and which Problem variables they own);
// every residual/equation lives in src/relations. That split is why a Line
// owns no variables at all (it's purely referential) and why a Circle owns
// exactly one (its radius) — the relation vocabulary is what gives any of
// them meaning.
//
// Everything about *how many* dimensions is a property of the model, not
// hardcoded here or in the kernel — a relation function reads
// `entity.varIndices.length` to find out how many coordinates it's working
// with, so the same relation code (see src/relations) works whether the
// model is 2D or 3D.

import { Problem, type BlockHandle, type GaugeRow, type ResidualBlock, type SolveReport, type VarRefs } from "./kernel/problem.ts";
import { Dual } from "./kernel/dual.ts";

export interface PointEntity {
  kind: "point";
  name: string;
  varIndices: number[]; // one per dimension
}

export interface LineEntity {
  kind: "line";
  name: string;
  refs: [string, string]; // two point names — purely referential, owns no variables
  /** Construction geometry: forms no regions. Absent when not. See `Model.setConstruction`. */
  construction?: true;
}

/**
 * A circle: a center point, one variable for its radius and — in a 3D model —
 * three more for its **normal**, the direction its plane faces.
 *
 * In 2D every circle lies in the one plane there is, so it has no normal and
 * refuses one. In 3D a circle without an orientation would be a sphere, so a
 * 3D circle carries its own: three solver variables, like its radius, read as
 * a **direction** — normalised wherever it is read (`curveNormal` in
 * relations/refs.ts) — so their length is a gauge nothing pushes and no
 * residual holds (docs/plans/frameless-curves.md). It used to name a frame
 * instead, and every circle drawn in a fresh document made one; the owner:
 * *"why everything need frame? why can not just put circle right there?"*
 *
 * **What holds it there is relations, never the entity.** A constructor never
 * constrains (the free-entities rule), so a circle's normal is a seed — the
 * drawing plane's, when nothing is said — and a tool that draws a circle on a
 * plane holds it there with two ordinary relations it can see, hover and
 * delete: `onplane` on its centre and `par` between its normal and the plane's.
 * Delete the `par` and the circle is free to turn; constrain its normal to a
 * line instead (`par("c1", "l1")`) and it follows the line. The relations that
 * read the rim — `onCircle` and `tangent` in 3D — read this normal as the
 * variables it is, so a free circle turns to meet them.
 */
export interface CircleEntity {
  kind: "circle";
  name: string;
  center: string; // a point name
  radiusVar: number;
  /** 3D only: the normal's three variables — a direction, read normalised. Absent in 2D. */
  normal?: number[];
  /** Construction geometry: forms no regions. Absent when not. See `Model.setConstruction`. */
  construction?: true;
}

/**
 * An arc is a circle that also names where it starts and ends. The endpoints
 * are ordinary points, so they can be constrained (coincident with a line's
 * end, say) like any other. What makes them *arc* endpoints — lying on the
 * arc's own circle — is not automatic: it's the `arcEndpoints` relation, for
 * the same reason a Line implies no relation of its own. Tools that create
 * arcs are expected to apply it (see relations/geometry.ts).
 *
 * In 3D an arc carries its own normal exactly as a circle does, and the normal
 * is also what says which of the two arcs between its endpoints it is: the
 * sweep runs counter-clockwise from `start` to `end` about it (see arcgeom.ts),
 * so it needs no reference axis — it is measured from its own start. Before
 * arcs carried an orientation that side came from the kernel's axes, which was
 * the gauge showing through; files from then are translated on the way in
 * (see persist.ts).
 */
export interface ArcEntity {
  kind: "arc";
  name: string;
  center: string;
  start: string;
  end: string;
  radiusVar: number;
  /** 3D only: the normal's three variables, which the sweep is counter-clockwise about. Absent in 2D. */
  normal?: number[];
  /** Construction geometry: forms no regions. Absent when not. See `Model.setConstruction`. */
  construction?: true;
}

/**
 * A coordinate frame: an origin point plus a point fixing the +x direction —
 * and, in a 3D model, a third point fixing which way +y goes.
 *
 * There is one built-in frame, the **origin** (`ORIGIN`), which is no entity:
 * a fixed datum every model has, and what `fix` and the axis helpers mean when
 * nothing else is said. Every other frame exists only because a user made one —
 * nothing makes a frame unless asked (docs/plans/frameless-curves.md; a circle
 * carries its own normal and needs none).
 *
 * Like a line, a frame is purely *referential*: it owns no variables, and its
 * points are ordinary points that can be dragged, dimensioned and constrained
 * like any other. Only the x-ref's *direction* from the origin counts; how far
 * away it sits is irrelevant, which is why `frameBasis` hands every axis out
 * normalised.
 *
 * In 2D, +y is +x turned a quarter turn counter-clockwise, and that settles the
 * frame. In 3D it settles nothing — an origin and one direction leave a whole
 * rotation free about that direction — so a 3D frame carries a **y-ref** as
 * well, and the pair is what makes a 3D frame a *plane*: the one through the
 * origin containing both refs, which is what a sketch is drawn on. The y-ref
 * fixes that plane and which side of +x is +y; it does not fix the exact angle,
 * because `frameBasis` straightens it against +x (Gram–Schmidt), and +z is
 * then +x × +y. So a y-ref dragged anywhere in its half of the plane leaves
 * the frame exactly where it was.
 *
 * `yref` is absent in a 2D model and always present in a 3D one: `addFrame`
 * creates it when it is not given, the way it creates every missing piece.
 * Frames exist only in 2D and 3D models — above that, two directions leave a
 * rotation free again, and nobody has asked for a fourth axis.
 */
export interface FrameEntity {
  kind: "frame";
  name: string;
  origin: string; // a point name
  xref: string;   // a point name; its direction from the origin is +x
  /** 3D only: a point on the +y side of the frame's plane. Absent in 2D. */
  yref?: string;
}

/**
 * Every entity kind, by its `kind` — the built-ins here, and every kind a
 * module declares added to it by declaration merging from the module's own
 * file (`declare module "../model.ts" { interface EntityTypes { … } }`, as
 * a module's kind file does). So `Entity` is every kind the program knows, and a
 * `switch (e.kind)` above this layer narrows to a module's kind as it does to
 * a circle, while this file names none of them.
 */
export interface EntityTypes {
  point: PointEntity;
  line: LineEntity;
  circle: CircleEntity;
  arc: ArcEntity;
  frame: FrameEntity;
}

export type Entity = EntityTypes[keyof EntityTypes];

/** The kinds of curve a region can be bounded by and a drawing tool draws: line, arc, circle, and any kind declared a curve. */
export type CurveKind = string;

/** Whether `kind` is a curve — what the construction flag and the region questions accept. */
export function isCurveKind(kind: string | undefined): boolean {
  return kind === "line" || kind === "arc" || kind === "circle" || entityKind(kind)?.curve === true;
}

/**
 * **An entity kind's structure, declared** (docs/plans/workbenches.md: the
 * entity extension point). What this layer asks of a kind it does not know by
 * name: which points it is built out of (so `del` of one takes it), which
 * variables it owns, whether it is a curve (bounds regions, can be
 * construction), whether it is closed on itself (no vertex, so no wall line),
 * whether it carries a plane, and which relations hold a point on it. A module
 * declares the rest — how it is sampled, picked, written — to the layers that
 * ask those questions (../modules.ts). This layer stays structure: no kind's
 * equations, no kind's drawing.
 */
export interface EntityKindSpec {
  kind: string;
  /** How a refusal names one: "a spline". */
  noun?: string;
  /** The point names an entity of this kind is built out of. */
  refs(e: Entity): string[];
  /** The variables it owns — not its points'. */
  vars?(e: Entity): number[];
  /** A curve: bounds regions, and can be construction geometry. */
  curve?: boolean;
  /**
   * Closed on itself, with no vertex: a whole curve, as a circle is. A kind
   * whose entities may be either (a spline, open or closed) answers per
   * entity — read through `isClosedEntity`.
   */
  closed?: boolean | ((e: Entity) => boolean);
  /**
   * An open curve's two ends, in its own direction — the points it runs
   * between, as a line's refs are — or null for one closed on itself. What
   * the regions join it by. Absent for a kind that has no ends to offer.
   */
  ends?(e: Entity): [string, string] | null;
  /**
   * Points the curve passes through **by its own definition** — a spline's
   * through-points — as a relation like `onspline` holds a point on it. The
   * regions cut it at one another edge meets, as at a T (loops.ts's
   * `heldOnCurves`). Absent for a kind whose points are not on it.
   */
  through?(e: Entity): readonly string[];
  /**
   * The residual blocks an entity of this kind holds **itself** — equations
   * that are its definition, not relations on it (a spline's interpolation,
   * docs/plans/spline.md). This layer never reads them; it removes them with
   * the entity (`deleteEntity`), which is the whole of what owning means here.
   */
  owns?(e: Entity): readonly BlockHandle[];
  /**
   * The plane it carries, as a circle's: its centre, its normal's variables,
   * and the point whose direction from the centre the normal is straightened
   * against (`straighten`), when it is. Makes it a plane reference.
   */
  plane?(e: Entity): { center: string; normal?: number[]; straighten?: string };
  /** The relations (journal ops) that hold a point on it — what cuts it at a T. */
  heldBy?: readonly string[];
  /** Whether one bounds a region as it stands — a closed member of zero size bounds nothing. */
  bounds?(model: Model, name: string): boolean;
  /**
   * Its **non-degeneracy measures**, as they stand: the sizes that make one
   * what it is (a conic's two semi-axes, a spline's spacing between
   * consecutive through-points), each ≥ 0. A solve that takes one from above
   * ε·L to below it has **collapsed** it, and a collapse is a conflict, not a
   * solution (`Model.solve`, docs/plans/conflict-detection.md). Absent for a
   * kind that cannot fold.
   */
  measures?(model: Model, e: Entity): Measure[];
}

/**
 * One **non-degeneracy measure** of an entity (`EntityKindSpec.measures`,
 * `Model.measuresOf`): a size, ≥ 0, as a function of the variables it reads —
 * so it can be read at the state before a solve as well as after, and pulled
 * on to steer a solve off a collapse.
 */
export interface Measure {
  /** The variables it reads. */
  vars: number[];
  /** Its size, from those variables in that order. */
  size: (l: Dual[]) => Dual;
}

/** The length of a vector of Duals. */
export function dualNorm(v: Dual[]): Dual {
  return v.reduce((s, x) => s.add(x.mul(x)), Dual.constant(0)).sqrt();
}

/** The measure that is the distance between two points, by their variables: a line's length, a spline's spacing. */
export function distanceMeasure(a: number[], b: number[]): Measure {
  const d = a.length;
  return { vars: [...a, ...b], size: (l) => dualNorm(l.slice(d).map((v, i) => v.sub(l[i]))) };
}

const entityKinds = new Map<string, EntityKindSpec>();

/** Registers a kind's structure. A module's (../modules.ts); refused for a kind already declared. */
export function defineEntityKind(spec: EntityKindSpec): void {
  if (entityKinds.has(spec.kind)) throw new Error(`the entity kind "${spec.kind}" is already declared`);
  entityKinds.set(spec.kind, spec);
}

/** Drops a kind's declaration — for a module removed with no entity of the kind left. */
export function undefineEntityKind(kind: string): void {
  entityKinds.delete(kind);
}

/** "a, b, c or d" — a refusal's list of what would have done. */
export function orList(words: readonly string[]): string {
  return words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

/** The declared kinds that are curves, by name: what a refusal adds after "a line, arc, circle". */
export function curveNouns(): string[] {
  return [...entityKinds.values()].filter((k) => k.curve).map((k) => k.kind);
}

/** The declared kinds that carry a plane, by name. */
export function planeNouns(): string[] {
  return [...entityKinds.values()].filter((k) => k.plane).map((k) => k.kind);
}

/** Whether an entity is closed on itself — a circle, or a declared kind that says so (`EntityKindSpec.closed`). */
export function isClosedEntity(e: Entity): boolean {
  if (e.kind === "circle") return true;
  const c = entityKind(e.kind)?.closed;
  return typeof c === "function" ? c(e) : c === true;
}

/** A kind's declared structure, or undefined for a built-in this layer knows by name, or for nothing. */
export function entityKind(kind: string | undefined): EntityKindSpec | undefined {
  return kind === undefined ? undefined : entityKinds.get(kind);
}

/**
 * A **frame-axis reference**: the string `"f1.x"`, `"f1.y"` or — for a 3D
 * frame — `"f1.z"`, naming the direction of that frame's axis rather than any
 * entity.
 *
 * This is what replaced `hor`/`ver`. Those words implied a privileged pair of
 * directions — a world frame in vocabulary form — where what is actually meant
 * is "parallel to an axis I can name", so `par("l1", "f1.y")` says "vertical"
 * and there is no second spelling of it.
 *
 * The *syntax* lives here, in the layer that owns the namespace, for two
 * reasons that both come back to names. `claimName` refuses a dot precisely so
 * that no entity can ever be called `f1.x`, and `relationsNaming` has to know
 * that an argument reading `f1.x` is a reference *to* `f1` or deleting a frame
 * would leave relations reading one that is gone. Turning a reference into an
 * actual direction is a different job and lives one layer up, beside the rest
 * of the lazy plumbing, in `relations/refs.ts`.
 *
 * `"z"` is syntax everywhere and meaning only in 3D. Whether a model's frames
 * *have* a z axis is a question about the model, so it is asked by
 * `Model.requireAxis` rather than here — this function stays a pure reading of
 * a string, which is what lets `referentOf` and the deletion cascade lean on
 * the same syntax without a model in hand.
 */
export type AxisName = "x" | "y" | "z";

/**
 * The frame and axis a reference names, or null for an ordinary name.
 *
 * Throws on a dot followed by anything else, rather than falling back to
 * "ordinary name": a name with a dot in it cannot exist (see `claimName`), so
 * `par("l1", "f1.w")` is a typo with no other possible reading, and answering
 * `"f1.w" is not a line` would send the reader looking for the wrong mistake.
 */
export function parseAxisRef(ref: string): { frame: string; axis: AxisName } | null {
  const dot = ref.indexOf(".");
  if (dot < 0) return null;
  // Two dots is a plane through three points (`parsePointTriple`), not an axis.
  if (parsePointTriple(ref)) return null;
  const frame = ref.slice(0, dot);
  const axis = ref.slice(dot + 1);
  if (axis !== "x" && axis !== "y" && axis !== "z") {
    throw new Error(`"${ref}" is not a frame axis — say "${frame}.x" or "${frame}.y" (or "${frame}.z" in 3D)`);
  }
  return { frame, axis };
}

/**
 * Whether a model of this many dimensions can hold a frame at all. 2D, where
 * an origin and one direction settle it; 3D, where a second direction does.
 * Anywhere else a frame would leave a rotation free, so there are none — and
 * with no frames there is no `fix` either, since `fix` is a position *in* one.
 */
function framesExistIn(dim: number): boolean {
  return dim === 2 || dim === 3;
}

/** What a model with no frames says when asked for one. One wording, two callers. */
function noFramesIn(dim: number): string {
  return `a ${dim}D model has no frames — a frame lives in a 2D or 3D model`;
}

/**
 * The relations that are **dimensions**: a number you put on the drawing,
 * rather than a statement about shape. They are named `d1`, `d2`, … and
 * everything else is named `r1`, `r2`, ….
 *
 * The split is Onshape's, and it is worth having because the two are used
 * differently: a dimension is the thing you go back and *edit*
 * (`set("d4.value", 60)`), a constraint is the thing you add or delete. Naming
 * them apart means the name itself says which kind you are holding, which is
 * the whole reason the owner asked for `d4` rather than `r4`.
 *
 * `fix` is deliberately **not** here even though it carries numbers. It carries
 * *coordinates* — two or three of them, in a frame — not one value, so there is nothing
 * for `set("…​.value", x)` to mean; and Onshape's fix is a constraint too.
 *
 * The set lives in this file rather than in `relations/` because this layer
 * owns the namespace, and a relation authored at the command line gets `r`
 * without having to know any of this exists.
 */
export const DIMENSION_OPS: ReadonlySet<string> = new Set(["dist", "radius", "diameter", "angle", "extrusion", "revolution"]);

/**
 * **Reference dimensions** — `measure`, the driven dimension (relations/measure.ts):
 * `d`-named, because a person reads them as dimensions and Onshape names them
 * so, but not in `DIMENSION_OPS`, because they hold no value to `set`. They
 * measure and never constrain.
 */
export const REFERENCE_OPS: ReadonlySet<string> = new Set(["measure"]);

/**
 * Which index of a dimension's recorded `args` holds its value. An
 * `extrusion` is `[frame, depth, …pairs]` and a `revolution` `[axis, angle,
 * …pairs]`: the value sits second so that it is at a fixed place however many
 * pairs follow it.
 */
const VALUE_ARG: Record<string, number> = { dist: 2, radius: 1, diameter: 1, angle: 2, extrusion: 1, revolution: 1 };

/**
 * Declares `op` a dimension whose value is its recorded argument `valueArg` —
 * how a module's dimension joins the built-in ones (../modules.ts: a relation
 * declared with `dimension`). `d`-named and `set`-able from then on.
 */
export function defineDimension(op: string, valueArg: number): void {
  (DIMENSION_OPS as Set<string>).add(op);
  VALUE_ARG[op] = valueArg;
}

/** The name prefix a relation made by `op` claims. See `DIMENSION_OPS`. */
export function relationPrefix(op: string): string {
  return DIMENSION_OPS.has(op) || REFERENCE_OPS.has(op) ? "d" : "r";
}

/**
 * Where a dimension keeps its value, in its recorded argument list — or null if
 * `op` is not a dimension at all. `set` is the only caller; it is here beside
 * the set that decides what a dimension *is*, so the two cannot disagree about
 * which ops have a value to set.
 */
export function valueArgIndex(op: string): number | null {
  return DIMENSION_OPS.has(op) ? VALUE_ARG[op] : null;
}

/** The only settable property, and what `set` says when it is asked for another. */
export const SETTABLE_PROPERTY = "value";

/**
 * A **property reference**: the string `"d4.value"`, naming a dimension's value
 * rather than any entity.
 *
 * The syntax is the one `f1.x` established, and it lives here for the same
 * reason that one does — this layer owns the namespace, and `claimName` refuses
 * a dot precisely so that nothing can ever be *called* `d4.value`. Unlike
 * `parseAxisRef` it does not return null for a plain name: a bare `set("d4", …)`
 * is a mistake with exactly one likely intent, so it is told what to type
 * instead rather than being handed on to fail somewhere less helpful.
 */
export function parseValueRef(ref: string): { name: string; property: string } {
  if (typeof ref !== "string") throw new Error(`set takes a property like "d4.${SETTABLE_PROPERTY}"`);
  const dot = ref.indexOf(".");
  if (dot < 0) {
    throw new Error(`"${ref}" names no property — say "${ref}.${SETTABLE_PROPERTY}"`);
  }
  const name = ref.slice(0, dot);
  const property = ref.slice(dot + 1);
  if (property !== SETTABLE_PROPERTY) {
    throw new Error(`"${ref}" is not settable — the only settable property is "${name}.${SETTABLE_PROPERTY}"`);
  }
  return { name, property };
}

/**
 * Which entity a recorded argument is *about*: itself, or — for an axis
 * reference — the frame behind it. Null for an argument that is not a name at
 * all (a distance, a coordinate pair).
 *
 * Deliberately total and non-throwing, unlike `parseAxisRef`. This runs over
 * every argument of every relation whenever something is deleted or a glyph is
 * hovered, including a hand-edited file's nonsense, and neither of those is a
 * place to start validating syntax. It also does not check that the name
 * exists: the question here is what a string *refers to*, not what is there.
 */
export function referentOf(arg: unknown): string | null {
  if (typeof arg !== "string") return null;
  const dot = arg.indexOf(".");
  return dot < 0 ? arg : arg.slice(0, dot);
}

/**
 * Every entity a recorded argument is about — `referentOf`'s one, or for a
 * plane through three points (`"p1.p2.p3"`) all three. What the deletion
 * cascade and the hover read, so a relation held to a face's plane goes with
 * any of the face's points. Total and non-throwing, as `referentOf` is.
 */
export function referentsOf(arg: unknown): string[] {
  const pts = typeof arg === "string" ? parsePointTriple(arg) : null;
  if (pts) return pts;
  const one = referentOf(arg);
  return one === null ? [] : [one];
}

/** Whether one recorded argument refers to the entity called `name`. */
export function argRefersTo(arg: unknown, name: string): boolean {
  return referentsOf(arg).includes(name);
}

/**
 * The three point names of a plane reference written `"p1.p2.p3"`, or null for
 * any other string — exactly two dots and three non-empty names. See
 * `Model.planeKind`. An axis reference has one dot, so the two cannot be
 * confused, and `claimName` refuses a dot in any name.
 */
export function parsePointTriple(ref: unknown): [string, string, string] | null {
  if (typeof ref !== "string") return null;
  const parts = ref.split(".");
  return parts.length === 3 && parts.every((x) => x.length > 0) ? [parts[0], parts[1], parts[2]] : null;
}

/**
 * The name of the **origin**: the one fixed datum every model that can hold a
 * frame has — a point and three axes, the kernel's own — referable wherever a
 * frame is (`"origin"`, `"origin.x"`, `fix(p, at, "origin")`), and what `fix`,
 * `onplane` and the axis helpers mean when no frame is named and none is the
 * default (docs/plans/frameless-curves.md).
 *
 * **Built in, not journalled.** It is part of every model as the kernel's axes
 * are, so a new document and an old file agree about it without a replay step,
 * and nothing can delete it, move it or solve it. That revises
 * coordinate-frames.md's "there is no world frame": the owner asked twice why
 * drawing a circle made a frame, and one origin that is simply there is a
 * smaller surprise than a frame made at every click. What stays of that
 * decision is that nothing *else* makes a frame unless asked.
 */
export const ORIGIN = "origin";

/** A unit vector of plain numbers, or null for one too short to have a direction. */
function unitOrNull(v: number[]): number[] | null {
  const len = Math.hypot(...v);
  return len > 1e-12 ? v.map((x) => x / len) : null;
}

/** A unit vector of plain numbers — the kernel's +z for one with no direction, the floor a drawing needs. */
export function unitOf(v: number[]): number[] {
  return unitOrNull(v) ?? [0, 0, 1];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * Two unit directions spanning the plane square to the unit normal `n`,
 * right-handed about it — the first as near the kernel's x as it can be, so a
 * level plane's are x and y exactly. How a curve's plane is laid out when only
 * its normal says where it is: a free arc's auto-seeded ends, a circle drawn.
 */
export function spanOf(n: number[]): [number[], number[]] {
  for (const k of [[1, 0, 0], [0, 1, 0]]) {
    const along = k[0] * n[0] + k[1] * n[1] + k[2] * n[2];
    const u = unitOrNull([k[0] - along * n[0], k[1] - along * n[1], k[2] - along * n[2]]);
    if (u) return [u, cross(n, u)];
  }
  return [[1, 0, 0], [0, 1, 0]];
}

/** Circles and arcs share a center + radius (+ normal, in 3D); relations that only need those treat them alike. */
export interface CircularRef {
  name: string;
  center: string;
  radiusVar: number;
  /** The normal's variables, in a 3D model. See `CircleEntity`. */
  normal?: number[];
}

/** One recorded step in how a model was built. See `journal` below. */
export interface JournalEntry {
  op: string;
  args: unknown[];
}

/**
 * A relation, as the model remembers it: the call that made it, and the
 * residual blocks it put into the problem.
 *
 * Entities have had names since the beginning and relations have not, which
 * made a constraint something you could add and never again refer to. That is
 * survivable while every constraint is one you typed; it stops being
 * survivable the moment a *tool* infers one on your behalf, because a
 * constraint you did not ask for and cannot name is a trap. So a relation is
 * an entry here, named exactly as entities are named — `d1`, `d2`, … for the
 * dimensions and `r1`, `r2`, … for everything else (see `DIMENSION_OPS`).
 *
 * `args` is the call as it was made — the same list the journal stores — which
 * is what `del` reads to answer "does this relation name that entity".
 */
export interface RelationEntry {
  name: string;
  op: string;
  args: unknown[];
  blocks: BlockHandle[];
  /**
   * Variables the relation made for itself (`Model.relationVar`): a point's
   * parameter along the curve it is held on (docs/plans/spline.md's
   * `onspline`). Counted by the diagnosis as the relation's own, saved with
   * the file. Absent for a relation that made none — every one before it.
   */
  vars?: number[];
}

/**
 * The part of a line, arc or circle between two of the points on it — a
 * member of a profile whose region was split by a crossing or a T (see
 * loops.ts). `from` and `to` are **real points**, in the entity's **own
 * direction** (a line from its first point, an arc from its start, a circle
 * counter-clockwise about its frame's +z): own direction because two points on
 * a circle bound two arcs of it, and only the direction says which. The order
 * the loop walks it in is read off the joins, as a whole member's is.
 */
export interface Portion {
  name: string;
  from: string;
  to: string;
}

/**
 * One member of a feature's profile: an entity's name for the whole of it, or a
 * `Portion`. A bare name means the whole member — which is all a profile was
 * before regions split, so an older record (and an older file) reads as it did.
 */
export type ProfileMember = string | Portion;

/** The entity a profile member is all or part of. */
export function memberName(m: ProfileMember): string {
  return typeof m === "string" ? m : m.name;
}

/**
 * A **feature**: what an operation like `extrude` made, remembered as one named
 * thing — `e1`, `e2`, … — so it can be listed, drawn and deleted as one.
 *
 * Everything an extrude *is* lives in the ordinary registries: its twin points,
 * lines, arcs and circles are entities (and an old file's lid frame), and the depth that
 * holds them is a relation (`d`-named — see `DIMENSION_OPS`). The record adds
 * no geometry and no equation. What it adds is the one fact neither registry
 * can hold: *these pieces are one solid, on that profile*. The faces a solid is
 * drawn with are read off it (see faces.ts) and stored nowhere.
 *
 * A record is to its pieces what a relation is to its arguments, and the
 * deletion cascade treats it so (see operations.ts):
 *
 * - `names` is everything it refers to — the base profile it was built on and
 *   every piece it made. Deleting any of them takes the record (the inward
 *   rule: the record needs them), and nothing else beyond the ordinary cascade.
 *   The pieces left behind are what they always were: ordinary geometry.
 * - `owns` is the part of `names` the feature *made*. Deleting the feature
 *   itself — `del("e1")` — takes those, and never the profile, which was the
 *   user's before the feature existed (Onshape: deleting an extrude keeps its
 *   sketch).
 *
 * The model primitives refuse to delete an entity or relation a record still
 * names, for the reason they refuse one a relation still names: a record
 * pointing at nothing is a model the renderer throws on.
 *
 * Rebuilt on replay, never saved: the journal carries the operation that made
 * it, and re-running that makes the same record under the same name. Rewritten
 * in place (`rewriteFeature`) when its profile is restructured and the feature
 * regenerates — same name, same position — so it always describes the
 * expansion as it is, not as it was first made (see `regen` in operations.ts).
 */
export interface ExtrudeFeature {
  kind: "extrude";
  name: string;
  /** The member the call named — how the profile was asked for. */
  member: string;
  /** The frame whose +z the lid is offset along: the profile's sketch frame. */
  frame: string;
  /**
   * An old file's lid frame — `frame` moved by the depth — made by expansions 9
   * and 10 and by nothing since (docs/plans/no-lid-frame.md): a translated frame
   * keeps its orientation, so a twin curve names `frame` itself, and a sketch
   * on the cap builds its plane from the cap (sketchface.ts). Absent for a
   * feature of today's expansion, and every reader says what it does then.
   */
  top?: string;
  /** The `extrusion` dimension holding the lid — what `set("dN.value", …)` edits. */
  depth: string;
  /**
   * The profile: the loop that was extruded, then every loop inside it, each as
   * its members in walk order. A loop with children is a face with holes, and a
   * hole's child an island in it — drawn even-odd, so nesting needs no record.
   * A member is a whole entity by name, or the part of one between two real
   * points (`Portion`) when the region was split by a crossing or a T.
   */
  loops: ProfileMember[][];
  /**
   * Each base member's twin on the lid, loop by loop, parallel to `loops` — a
   * portion's twin is a line or an arc between the twins of its ends.
   */
  twins: string[][];
  /** The wall lines, one per profile vertex, base to twin. */
  walls: string[];
  /** Which expansion made it — whether there is a `top`, and whether it stands on the lid's own corners. See `Expansion`. */
  expansion: Expansion;
  /** What it does to a body, and which body. See `FeatureMode`. */
  mode?: FeatureMode;
  into?: string;
  /**
   * The region it stands on (`RegionEntry`, docs/plans/regions-as-operations.md):
   * what its profile is regenerated from when the region is edited. Every
   * feature made since format 17 has one, and an older file's are made at open;
   * absent only on a record built some other way, which then regenerates from
   * its own `loops` as before.
   */
  region?: string;
  /** Everything the record refers to. See above. */
  names: string[];
  /** The part of `names` the feature made, which deleting it takes. */
  owns: string[];
}

/**
 * A revolve: a closed profile turned about an axis lying in its plane.
 *
 * Unlike an extrude, most of a revolve is **not** geometry. There is no finite
 * set of entities that *is* a surface of revolution, so the swept surface is
 * drawn from the live profile every frame (see faces.ts) and stored nowhere.
 * What is real is what can be: the profile (the user's, untouched), the axis
 * (read as a datum — a revolve never pushes it), one `revolution` dimension
 * carrying the angle, and — for a partial revolve only — the **end face**: a
 * twin of every profile corner and member, turned through the angle about the
 * axis and held there by the dimension, so `set("dN.value", θ)` swings it and
 * a sketch can be constrained against it. A full turn has no end face, so it
 * makes no twins and its dimension holds nothing; see `revolve` in
 * operations.ts for why a `set` on it refuses.
 *
 * `names`/`owns` mean exactly what they mean for an extrude — the deletion
 * cascade reads only those two — and the axis's frame or line is among the
 * names, since the solid was built on it.
 */
export interface RevolveFeature {
  kind: "revolve";
  name: string;
  /** The member the call named — how the profile was asked for. */
  member: string;
  /** The profile's sketch frame: its plane holds the profile and the axis. */
  frame: string;
  /** What it turns about: a frame-axis reference (`"f1.y"`) or a line's name. Read as a datum. */
  axis: string;
  /** The `revolution` dimension carrying the angle (radians) — what `set("dN.value", …)` edits. */
  angle: string;
  /** The profile, as an extrude's: the loop turned, then every loop inside it, members in walk order. */
  loops: ProfileMember[][];
  /** Partial only: each base member's twin on the end face, parallel to `loops`. Empty for a full turn. */
  twins: string[][];
  /**
   * An old file's partial revolve only: the end face's frame — the sketch frame
   * turned through the angle. Null for a full turn, and for every revolve of
   * today's expansion, which turns no frame (a twin curve carries its own
   * normal). Whether a revolve is partial is whether it has `twins`.
   */
  end: string | null;
  /** An old file's partial revolve only: the frames it turned for its end face, its sketch frame first. */
  swept?: string[];
  /** Which expansion made it — whether its end frames stand on the end face's own corners. See `Expansion`. */
  expansion: Expansion;
  /** What it does to a body, and which body. See `FeatureMode`. */
  mode?: FeatureMode;
  into?: string;
  /**
   * The region it stands on (`RegionEntry`, docs/plans/regions-as-operations.md):
   * what its profile is regenerated from when the region is edited. Every
   * feature made since format 17 has one, and an older file's are made at open;
   * absent only on a record built some other way, which then regenerates from
   * its own `loops` as before.
   */
  region?: string;
  /** Everything the record refers to. See `ExtrudeFeature`. */
  names: string[];
  /** The part of `names` the feature made, which deleting it takes. */
  owns: string[];
}

/** Every kind of feature a profile is swept into. A blend (below) is the other kind of feature, and is kept apart. */
export type FeatureEntry = ExtrudeFeature | RevolveFeature;

/**
 * A **fillet** or a **chamfer** of a body's edges (docs/plans/solid-fillets.md):
 * a feature in the body's chain like an add or a cut, applied to the body as
 * the features made before it left it. It has no profile and makes no entity:
 * its edges are the *solid kernel's*, named by the two faces each lies between
 * (`e1.lid|e1.m0`, src/solids/naming.ts), and the shape it makes is the
 * kernel's — derived, every rebuild, never stored. What is relational is the
 * one number, a dimension (`filletRadius` / `chamferSetback`), so it is
 * `set`, driven and undone like any dimension.
 *
 * **Kept in a registry of its own** (`Model.blends`), not among `features`:
 * every reader of `features` — regeneration, holes, the twins, sketch on a
 * face, the faces drawn — reads a sweep's profile, and a blend has none. It
 * shares their names (`e3`), their organiser rows, `hide`, `del` and `edit`.
 *
 * **Identity is by name, so it follows the body's history.** A rebuild that
 * keeps an edge's two faces keeps the edge, whatever else moved; a change that
 * takes an edge (a cut through it) leaves that name out of the fillet, and the
 * log says so; a fillet none of whose edges is left is left out of the body.
 * `into` is the body's first feature, resolved at the call (as an add's is),
 * and not among `names`: deleting the body leaves the record, said, as a cut
 * whose body is gone is.
 */
export interface BlendFeature {
  kind: "fillet" | "chamfer";
  name: string;
  /** The body it rounds: its first feature's name. */
  into: string;
  /** The kernel's edges, by name, in the order picked — face `i` it makes is `e3.fi`. */
  edges: string[];
  /** The dimension holding the radius (a fillet) or the setback (a chamfer). */
  size: string;
  /** Everything the record refers to: its dimension. */
  names: string[];
  /** What deleting it takes: its dimension. */
  owns: string[];
}

/** Whether a step of a body's chain is a fillet or chamfer rather than a sweep. */
export function isBlendFeature(f: FeatureEntry | BlendFeature): f is BlendFeature {
  return f.kind === "fillet" || f.kind === "chamfer";
}

/**
 * What a feature does to a body (docs/plans/solids-kernel.md): **new** is a
 * body of its own; **add** is unioned into a body, **cut** subtracted from
 * it, **intersect** keeps only what the two share. The body is named by
 * `into` — any feature of it; a body is the result of its chain, in the order
 * the features were made (modes.ts). A record with no mode is a feature from
 * a file older than modes, and is a body of its own, as every feature then
 * was: old files open to the same solids.
 *
 * `into` is not among `names`: deleting the body's feature does not take this
 * record with it. The evaluation says what became of it instead — an add with
 * no body is a body of its own, a cut or intersect with none is left out and
 * said (bodies.ts) — because the cascade taking a cut's record whenever the
 * plate it cut was deleted would lose a sketch's worth of work silently.
 */
export type FeatureMode = "new" | "add" | "cut" | "intersect";
export const FEATURE_MODES: readonly FeatureMode[] = ["new", "add", "cut", "intersect"];

/**
 * Which expansion of an extrude or revolve call a feature was made by: `11`,
 * today's, which makes no frame at all — an extrude no lid frame, and a revolve
 * (since format 13, docs/plans/frameless-curves.md) no end frames, its turned
 * twin curves carrying their own normals; `10`, a format-10-to-12 file's
 * revolve and a format-10 file's extrude, whose frames reuse the twins of the
 * profile's vertices they copy; `9`, a file of format 9 or below's, whose
 * frames have points all their own.
 * Here rather than beside `EXPANSION` in operations.ts because the record
 * carries it, so regeneration rebuilds a feature the way it was made.
 */
export type Expansion = 9 | 10 | 11;

/**
 * A **group**: a named set of entities and relations — `g1`, `g2`, … or a
 * name of the user's — and nothing more (docs/plans/groups.md).
 *
 * The owner's concept is flat relational direct CAD: "there is no hierarchy …
 * and entities can be grouped". So a group is a set and never a container. It
 * **owns nothing**: deleting it deletes the grouping, never a member, and
 * deleting a member takes it out of every group it is in. **A group may be
 * empty** (docs/plans/organiser.md, reversing groups.md's "a group is never
 * empty"): one made to be drawn into starts with nothing, and a group whose
 * last member goes stays until `ungroup`. **Membership overlaps and never nests**:
 * an entity may be in any number of groups, and a group never holds a group or
 * a feature — naming one where members are wanted adds its members as they
 * are then (`expand`), a union and not a link, because a link would be a tree.
 *
 * A **feature is a group already** — `e1` names what the extrude made — so a
 * feature's name is read as a set wherever a group's is (`membersOf`), and is
 * read-only as one: its members follow its profile.
 *
 * Structure, so it lives here; every edit to it is an operation (groups.ts),
 * journalled as the call, and the registry is rebuilt by replay, never saved.
 * One group at a time may be **open** — `Model.openGroup`, which every entity
 * made joins.
 */
export interface GroupEntry {
  name: string;
  /** Entity and relation names, in the order they joined. */
  members: string[];
}

/**
 * A feature's record as an operation hands it over — everything but the name
 * `addFeature` gives it. Distributed over the kinds (`Omit` on a union keeps
 * only the fields every member shares, which would lose an extrude's walls).
 */
/**
 * A **region**: faces combined by named operations, under a name of its own —
 * `rg1`, `rg2`, … (docs/plans/regions-as-operations.md). The owner: *"there
 * should be no such thing as a negative face. a face is just a face. just like
 * there should be no such thing as a negative solid, only an operation which
 * subtracts one solid from another"*.
 *
 * A **face** is a closed loop of sketch curves, found (loops.ts) and never
 * stored: what the model's curves bound. A region is the chain of operations
 * that made it — `region(f)`, then `subtract`, `add`, `intersect` with other
 * faces — and its **membership is that chain, never re-inferred**: a loop
 * drawn inside a region's outline is a loop and nothing more until an
 * operation names it. Each step names its face by a member (as `extrude`
 * names a loop) and keeps the face as it was resolved when the step was made,
 * which is what the face is found again by (the loop keeping the most of it)
 * and what a replay is handed instead of finding anything.
 *
 * Structure, so it lives here; the operations that make and change it are in
 * operations.ts, and its area is a question loops.ts answers. Rebuilt by
 * replay, never saved. Its own namespace prefix is `rg`, not `r`: `r1` is a
 * relation's name, and `f1` a frame's.
 */
export type RegionOp = "region" | "subtract" | "add" | "intersect";
export const REGION_OPS: readonly RegionOp[] = ["region", "subtract", "add", "intersect"];

export interface RegionStep {
  op: RegionOp;
  /** The member the step named its face by. */
  member: string;
  /** The face as it was resolved when the step was made: its members in walk order. */
  face: ProfileMember[];
}

export interface RegionEntry {
  name: string;
  /** The plane the region lies in: the frame (any plane reference) its first face was found parallel to. */
  frame: string;
  /** The chain: `region` first, then each operation in the order it was made. */
  steps: RegionStep[];
}

/**
 * A **surface** (docs/plans/surfaces.md): a sheet the solid kernel builds — no
 * volume, edges that bound one face — named `s1`, `s2`, … in a namespace of
 * its own beside the features (`e`) and regions (`rg`). The owner's rule from
 * regions-as-operations.md, *"there should be no such thing as a negative
 * face … only an operation which subtracts"*, holds here as for faces and
 * solids: a surface is a thing, and trim, extend, knit, offset, thicken and
 * the fillet between two are **operations** on it, never a negative surface.
 *
 * **A surface is its chain**, as a body is (modes.ts): a record that makes it
 * (`extrude` of curves, `revolve`, `planar` of a region, a body's `face`, an
 * `offset` of another surface) and every later record whose `into` names it,
 * in the order they were made — each its own `sN`, as a body's booleans are
 * each an `eN`. A `knit` takes the surfaces in `with` into this one: they are
 * no longer surfaces of their own (a knitted pair is one sheet), and their
 * chains come with them. Its shape is the kernel's, derived every rebuild;
 * what is relational is the one number most records carry, a dimension (the
 * depth, the angle, a distance, a radius), `set` and undone like any.
 *
 * Structure, so it lives here; the operations that make them are in
 * surfaces.ts. Rebuilt by replay, never saved.
 */
export type SurfaceKind = "extrude" | "revolve" | "planar" | "face" | "offset"
  | "trim" | "extend" | "knit" | "thicken" | "solidify" | "fillet" | "chamfer";

/** The records that start a surface; every other kind changes one (`into`). */
export const SURFACE_HEADS: readonly SurfaceKind[] = ["extrude", "revolve", "planar", "face", "offset"];

export interface SurfaceEntry {
  kind: SurfaceKind;
  name: string;
  /** The surface it changes, by any record of its chain; absent for one that starts a surface. */
  into?: string;
  /** extrude, revolve: the curves swept, in walk order; planar: the region's loops. */
  curves?: string[];
  loops?: ProfileMember[][];
  /** extrude, revolve, planar, a trim by a curve: the plane the curves lie in (any plane reference). */
  frame?: string;
  /** revolve: the axis (a line, or a frame's axis). */
  axis?: string;
  /** face: the face's name on its body or surface (`e1.lid`); offset: the surface offset. */
  of?: string;
  /** trim: the curve or the surface it cuts by. */
  by?: string;
  /** trim: a point on the side kept. fillet, chamfer between two: a point on each kept side, or null. */
  keep?: number[];
  keeps?: (number[] | null)[];
  /** extend: the boundary edge lengthened, by name (`s1.m0|s1.lid`). */
  edge?: string;
  /** knit: the surfaces taken in; fillet, chamfer between two: the other. */
  with?: string[];
  /** fillet, chamfer of a surface's own edges, by name. */
  edges?: string[];
  /** knit: how near two edges must run to be stitched. */
  tolerance?: number;
  /** The dimension holding its number, where it has one. */
  size?: string;
  /** Everything the record refers to: curves, other surfaces and features, its dimension. */
  names: string[];
  /** What deleting it takes: its dimension. */
  owns: string[];
}

type WithoutName<F> = F extends unknown ? Omit<F, "name"> : never;
export type FeatureDraft = WithoutName<FeatureEntry>;

export class Model {
  problem = new Problem();
  dim: number;
  entities = new Map<string, Entity>();
  /** Named relations, in the order they were made. See `relation()`. */
  relations = new Map<string, RelationEntry>();
  /** Named features — `e1`, `e2`, … — in the order they were made. See `FeatureEntry`. */
  features = new Map<string, FeatureEntry>();
  /** Named fillets and chamfers — `e3` — in the order they were made, numbered with the features. See `BlendFeature`. */
  blends = new Map<string, BlendFeature>();
  /** Named groups — `g1`, `g2`, … — in the order they were made. See `GroupEntry`. */
  groups = new Map<string, GroupEntry>();
  /** Named regions — `rg1`, `rg2`, … — in the order they were made. See `RegionEntry`. */
  regions = new Map<string, RegionEntry>();
  /** Named surfaces' records — `s1`, `s2`, … — in the order they were made. See `SurfaceEntry`. */
  surfaces = new Map<string, SurfaceEntry>();
  /**
   * What is hidden: entity, relation and feature names. A hidden entity is not
   * drawn, picked, snapped to or boxed — and is **still solved**: nothing below
   * the drawing ever reads this, the kernel least of all. A hidden feature's
   * faces are not drawn; a hidden relation's glyph is not. Part of the document,
   * as visibility is in every CAD tool: changed only by `hide` and `show`
   * (groups.ts), journalled, saved by replay and undone like any edit.
   */
  hidden = new Set<string>();
  /**
   * The **open group**, if any: every entity made while it is open joins it —
   * a point, a line and the endpoints it made, a fillet's arc, an extrude's
   * twins — in the constructor that made it (`place`), so the joining is part
   * of that entry and needs none of its own (docs/plans/organiser.md; the
   * owner: *"create a new group and "open" the group, which means any
   * entities which get created become a part of that group"*). Document
   * state, like `hidden`: set only by `opengroup`/`closegroup` (groups.ts),
   * journalled, so a replay opens it at the same step and the same entities
   * join the same group — nothing re-infers the membership afterwards.
   * Relations made do not join: a group of what was drawn is entities.
   */
  openGroup: string | null = null;
  /** Set while an operation makes entities that must not join the open group (`withoutOpenGroup`). */
  private joining = true;
  /**
   * Which frame `fix`, `onPlane` and the `xaxis()`/`yaxis()`/`zaxis()` helpers
   * mean when they are not told which — the origin while this is null, which
   * it is in a new model and stays until someone makes a frame and says so
   * (`setDefaultFrame`).
   */
  defaultFrame: string | null = null;
  /**
   * The **work plane**, when one is set apart from the default frame: a plane
   * reference (`planeKind`) — in practice a face's three points, set by
   * sketch on face. What is drawn next lies on it (`drawingPlane`). Null in a
   * new model; cleared by `setDefaultFrame`, and by deleting anything it names.
   */
  workPlane: string | null = null;
  private counters = new Map<string, number>();
  /**
   * The name a constructor has claimed for an entity it has not put in
   * `entities` yet, because the points it refers to are still being made —
   * see `claimFirst`. Held here so that `autoName` steps around it.
   */
  private claimed: string | null = null;
  /**
   * The relation currently being built, if any — see `relation()`. Its
   * presence is also what tells a nested relation call that it is nested.
   */
  private building: { name: string; blocks: BlockHandle[]; vars: number[] } | null = null;
  /**
   * What each solve's report needs to be explained later: the state before
   * it, and what was collapsed and what was the user's own zero then. Keyed
   * by the report `solve` returned, so `conflicting(report)` searches from the
   * solve it was handed and a report it never made falls back to its blocks.
   */
  private solves = new WeakMap<SolveReport, SolveContext>();

  /**
   * How this model was built, in order — every entity created, every
   * relation applied, every operation run.
   *
   * This exists because a model cannot be serialised directly: a residual
   * block holds a *closure*, and closures do not survive a round trip
   * through JSON. What does survive is the sequence of calls that produced
   * them, so saving a model means writing down what was done to it and
   * loading means doing it again. See src/persist.ts.
   */
  journal: JournalEntry[] = [];
  private recording = true;

  constructor(dim = 2) {
    this.dim = dim;
  }

  /** Appends to the journal, unless recording is suppressed. */
  record(op: string, args: unknown[]): void {
    if (this.recording) this.journal.push({ op, args });
  }

  /**
   * Runs `body` with recording suppressed and then records `op`, so an
   * operation is journalled as the single call the user made rather than as
   * the handful of entities and relations it happened to expand into.
   * Replaying the call re-expands it identically.
   *
   * **Recorded only once the body has succeeded.** It used to record first,
   * which left an operation that *refused* — a fillet whose radius was too big
   * for its corner — sitting in the journal anyway, and a file saved after it
   * then failed to reopen at that step. Nothing else is journalled while the
   * body runs, so recording after it lands in the same place. An operation
   * must therefore refuse before it changes anything, which `fillet` and `set`
   * both do.
   */
  asOperation<T>(op: string, args: unknown[] | (() => unknown[]), body: () => T): T {
    const result = this.withoutRecording(body);
    // A function is read only now, after the body: an extrude over a crossing
    // journals the names of the points its body materialised, which no one
    // knows before it has made them.
    this.record(op, typeof args === "function" ? args() : args);
    return result;
  }

  /**
   * Puts a new entity in the registry — and in the open group, if one is open.
   * The one door every constructor goes through, so no way of making an
   * entity can forget the open group.
   */
  place(ent: Entity): void {
    this.entities.set(ent.name, ent);
    if (this.joining && this.openGroup !== null) this.groups.get(this.openGroup)?.members.push(ent.name);
  }

  /**
   * Runs `body` with the open group shut to it: what it makes joins nothing.
   * For a feature's regeneration, whose new pieces join the groups the
   * feature's pieces were in rather than whatever happens to be open
   * (operations.ts, `rebuildFeature`).
   */
  withoutOpenGroup<T>(body: () => T): T {
    const prev = this.joining;
    this.joining = false;
    try {
      return body();
    } finally {
      this.joining = prev;
    }
  }

  /**
   * Whether calls are being journalled — false while a file replays
   * (persist.ts) and inside an operation's own body. What tells an operation,
   * asked before its body runs, that it is being replayed: a replay is handed
   * everything resolved and decides nothing from positions (an extrude's
   * default mode, modes.ts).
   */
  get journalling(): boolean {
    return this.recording;
  }

  /** Runs `body` without journalling anything it does. Used by replay. */
  withoutRecording<T>(body: () => T): T {
    const prev = this.recording;
    this.recording = false;
    try {
      return body();
    } finally {
      this.recording = prev;
    }
  }

  /**
   * Whether anything already answers to `name`. Entities, relations, features
   * and groups share one namespace on purpose: `del("r3")` has to mean one
   * thing, and a model holding both a point and a relation called `r3` would
   * make it mean two.
   */
  has(name: string): boolean {
    // The origin answers too, so nothing can be made under its name.
    return (name === ORIGIN && framesExistIn(this.dim))
      || this.entities.has(name) || this.relations.has(name) || this.features.has(name) || this.blends.has(name)
      || this.groups.has(name) || this.regions.has(name) || this.surfaces.has(name);
  }

  /** Whether `name` is a frame: one a user made, or the origin. */
  isFrame(name: string): boolean {
    if (name === ORIGIN) return framesExistIn(this.dim);
    return this.entities.get(name)?.kind === "frame";
  }

  /** Refuses anything that is not a frame — the origin included as one, unlike `frame()`, which hands back an entity. */
  requireFrame(name: string): void {
    if (name === ORIGIN && framesExistIn(this.dim)) return;
    this.frame(name);
  }

  /** Every frame there is, the origin first. What picking, drawing and the planes ask after. */
  frameNames(): string[] {
    const made = [...this.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);
    return framesExistIn(this.dim) ? [ORIGIN, ...made] : made;
  }

  private autoName(prefix: string): string {
    let n = this.counters.get(prefix) ?? 0;
    let name: string;
    do {
      n += 1;
      name = `${prefix}${n}`;
    } while (this.has(name) || name === this.claimed);
    this.counters.set(prefix, n);
    return name;
  }

  /**
   * Checks the name and then claims it, in that order and in one call: every
   * way it can refuse comes before the one effect it has (moving `prefix`'s
   * counter), so a refused claim consumes nothing. That is what lets each
   * constructor make it the *last* of its refusals and the *first* of its
   * effects (see `claimFirst`) without a separate check.
   */
  private claimName(prefix: string, name?: string): string {
    if (name === undefined) return this.autoName(prefix);
    // A dot is reserved for the frame-axis reference syntax (see
    // `parseAxisRef`). Refused here rather than merely discouraged, because
    // this is the only place that can guarantee it: a point called `f1.x`
    // would make `par("l1", "f1.x")` mean two things, and which one it meant
    // would depend on the order the drawing happened to be built in.
    if (name.includes(".")) {
      throw new Error(`"${name}" cannot contain a dot — "f1.x" names a frame's axis`);
    }
    if (this.has(name)) throw new Error(`"${name}" already exists`);
    // An explicit name that looks like an auto-generated one moves the counter
    // past it, so a later auto-name cannot collide. This matters most when a
    // model is rebuilt from a saved file: every entity comes back under the
    // explicit name it was saved with, and without this the counters would
    // still read zero and the next auto-name would land on a taken name.
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(name);
    if (m) {
      const n = Number(m[1]);
      if (Number.isSafeInteger(n) && n > (this.counters.get(prefix) ?? 0)) this.counters.set(prefix, n);
    }
    return name;
  }

  /**
   * Runs `body` as one named relation: journals the call, collects every
   * residual block `body` adds, registers the lot under a fresh `rN`, and
   * returns that name.
   *
   * Every function in `relations/` is written as one call to this — which is
   * also what replaced the bare `record()` those functions used to open with,
   * so there is one place a relation can be forgotten rather than two.
   *
   * Two things it settles that were previously ambiguous:
   *
   * - **A relation written in terms of another is one relation.** `concentric`
   *   is defined as a `coincident` on two centres and `arcEndpoints` as two
   *   `onCircle`s; the inner calls contribute their blocks to the outer entry,
   *   take no name of their own, and journal nothing. (Before this they
   *   journalled *both*, so reopening such a file quietly added the inner
   *   constraint a second time.)
   * - **A relation that throws leaves no trace.** Whatever blocks the body got
   *   as far as adding are removed and the name counter is put back, so a
   *   mistyped relation cannot shift the names a replay will hand out.
   *
   * A relation authored at the command line that calls `problem.addResidual`
   * directly still works exactly as before — its blocks simply belong to no
   * relation, which is the same anonymity every relation had until now. Route
   * it through `model.relation` and `model.addResidual` to get a name and a
   * `del`.
   */
  relation(op: string, args: unknown[], body: () => void): string {
    if (this.building) {
      // Nested: absorbed into the relation already being built. Also the seam
      // `rebuildRelation` goes through, which is why the name comes from the
      // entry being built rather than from a fresh claim.
      body();
      return this.building.name;
    }
    // Dimensions are `d`-named and everything else `r`-named — see
    // `DIMENSION_OPS`. The prefix is read from the op rather than passed in by
    // each relation, so a new relation cannot get it wrong by omission, which
    // is the failure this codebase keeps meeting.
    const prefix = relationPrefix(op);
    // Whichever counter this claim is about to move is the one the rollback
    // below has to put back. Reading "r" here while claiming "d" would leave a
    // failed `dist` having quietly shifted every later dimension's name.
    const counterWas = this.counters.get(prefix);
    const name = this.claimName(prefix);
    const building = { name, blocks: [] as BlockHandle[], vars: [] as number[] };
    this.building = building;
    try {
      // Suppressed, so an inner relation's own `record` does not double up.
      this.withoutRecording(body);
    } catch (e) {
      for (const h of building.blocks) this.problem.removeBlock(h);
      if (counterWas === undefined) this.counters.delete(prefix);
      else this.counters.set(prefix, counterWas);
      throw e;
    } finally {
      this.building = null;
    }
    this.relations.set(name, building.vars.length
      ? { name, op, args, blocks: building.blocks, vars: building.vars }
      : { name, op, args, blocks: building.blocks });
    this.record(op, args);
    return name;
  }

  /**
   * Re-runs an existing relation **in place**: same name, same position in the
   * registry, new arguments and new residual blocks. What `set` is built on.
   *
   * The name is the whole point of the exercise — a dimension you edit is still
   * `d4` afterwards, so every reference to it (a glyph, a `rels()` line, a
   * `del`) keeps meaning what it meant. `Map.set` on a key that is already
   * there keeps its insertion position, so the registry order is untouched too.
   *
   * **The new blocks are built before the old ones are removed**, which is the
   * only ordering under which a body that throws leaves the relation exactly as
   * it was. The other way round, a bad value would delete a working constraint
   * and then fail — and the blocks are closures, so there would be nothing left
   * to put back.
   *
   * Journals nothing. The operation that calls this records itself as the one
   * call the user made, the way every operation does.
   */
  rebuildRelation(name: string, op: string, args: unknown[], body: () => void): void {
    const entry = this.relationOf(name);
    const outer = this.building;
    const building = { name, blocks: [] as BlockHandle[], vars: [] as number[] };
    this.building = building;
    try {
      this.withoutRecording(body);
    } catch (e) {
      for (const h of building.blocks) this.problem.removeBlock(h);
      throw e;
    } finally {
      this.building = outer;
    }
    for (const h of entry.blocks) this.problem.removeBlock(h);
    this.relations.set(name, building.vars.length
      ? { name, op, args, blocks: building.blocks, vars: building.vars }
      : { name, op, args, blocks: building.blocks });
  }

  /**
   * Adds a residual block, remembering it as part of the relation currently
   * being built. Identical to `problem.addResidual` outside a `relation()`
   * body, so it is always the safe one to call.
   */
  addResidual(varIndices: VarRefs, fn: (locals: Dual[]) => Dual[], label?: string): BlockHandle {
    const handle = this.problem.addResidual(varIndices, fn, label);
    this.building?.blocks.push(handle);
    return handle;
  }

  /**
   * A variable the relation being built makes for itself, seeded at `initial`
   * — a point's parameter along a spline (docs/plans/spline.md). Only inside a
   * `relation()` body: a variable no relation owns would be one nothing
   * counts, saves or deletes. Its value is the solver's, as any variable's is.
   */
  relationVar(initial: number): number {
    if (!this.building) throw new Error("relationVar is for a relation's body — a variable outside one belongs to nothing");
    const v = this.problem.addVar(initial);
    this.building.vars.push(v);
    return v;
  }

  relationOf(name: string): RelationEntry {
    const r = this.relations.get(name);
    if (!r) throw new Error(`"${name}" is not a relation`);
    return r;
  }

  /**
   * Registers a feature under a fresh `eN` and returns it. Called from inside
   * an operation's expansion and journalling nothing of its own: the operation
   * is the journal entry, and re-running it makes this record again (see
   * `FeatureEntry`).
   *
   * Every name the record gives must already answer to something, and `owns`
   * must be a part of `names` — checked here, in the one place that can
   * guarantee it, because a record naming nothing is a renderer that throws and
   * a deletion that cannot find what it was told to take.
   */
  addFeature(feature: FeatureDraft): FeatureEntry {
    this.checkFeature(feature);
    const name = this.claimName("e");
    const entry = { ...feature, name } as FeatureEntry;
    this.features.set(name, entry);
    return entry;
  }

  /**
   * Replaces a feature's record **in place** — same name, same position in the
   * registry — with what an operation has rebuilt it as. What regeneration is
   * built on (see `regen` in operations.ts): the record's `rebuildRelation`.
   * `e1` is still `e1` afterwards, and `ls()`, the hover tag and `del` read the
   * new record without being told anything.
   *
   * Checked exactly as a new record is, and refused across kinds: an extrude
   * rebuilt as a revolve would be a different feature under an old name.
   * Journals nothing — the operation that calls it is the entry.
   */
  rewriteFeature(name: string, feature: FeatureDraft): FeatureEntry {
    const was = this.featureOf(name);
    if (was.kind !== feature.kind) throw new Error(`"${name}" is ${was.kind === "extrude" ? "an extrude" : "a revolve"} — its record cannot become another kind's`);
    this.checkFeature(feature);
    const entry = { ...feature, name } as FeatureEntry;
    this.features.set(name, entry);
    return entry;
  }

  /**
   * Registers a fillet or chamfer under a fresh `eN` — the features' counter,
   * so the number says where it falls in its body's chain — and returns it.
   * Checked as a feature's record is. Journals nothing: the operation is the
   * entry (blends.ts).
   */
  addBlend(blend: Omit<BlendFeature, "name">): BlendFeature {
    this.checkFeature(blend);
    const name = this.claimName("e");
    const entry: BlendFeature = { ...blend, name };
    this.blends.set(name, entry);
    return entry;
  }

  /** Replaces a blend's record in place — same name, same place in its chain — as `rewriteFeature` does a sweep's. */
  rewriteBlend(name: string, blend: Omit<BlendFeature, "name">): BlendFeature {
    const was = this.blendOf(name);
    if (was.kind !== blend.kind) throw new Error(`"${name}" is a ${was.kind} — its record cannot become a ${blend.kind}`);
    this.checkFeature(blend);
    const entry: BlendFeature = { ...blend, name };
    this.blends.set(name, entry);
    return entry;
  }

  /**
   * Registers a surface's record under a fresh `sN` and returns it. Its names
   * are checked as a feature's are, except that a record may name another
   * surface or a feature (what it trims by, knits, offsets, takes a face of).
   * Journals nothing: the operation is the entry (surfaces.ts).
   */
  addSurface(entry: Omit<SurfaceEntry, "name">): SurfaceEntry {
    for (const n of entry.names) {
      if (!this.entities.has(n) && !this.relations.has(n) && !this.surfaces.has(n) && !this.features.has(n) && !this.blends.has(n)) {
        throw new Error(`a surface cannot name "${n}" — there is no such thing`);
      }
    }
    const named = new Set(entry.names);
    for (const n of entry.owns) if (!named.has(n)) throw new Error(`a surface cannot own "${n}" without naming it`);
    const name = this.claimName("s");
    const made: SurfaceEntry = { ...entry, name };
    this.surfaces.set(name, made);
    return made;
  }

  /** The surface record called `name`. */
  surfaceOf(name: string): SurfaceEntry {
    const s = this.surfaces.get(name);
    if (!s) throw new Error(`"${name}" is not a surface`);
    return s;
  }

  /** The fillet or chamfer called `name`. */
  blendOf(name: string): BlendFeature {
    const b = this.blends.get(name);
    if (!b) throw new Error(`"${name}" is not a fillet or a chamfer`);
    return b;
  }

  /** Every name a record gives answers to something, and it owns only what it names. */
  private checkFeature(feature: Pick<FeatureDraft, "names" | "owns">): void {
    for (const n of feature.names) {
      if (!this.entities.has(n) && !this.relations.has(n)) throw new Error(`a feature cannot name "${n}" — there is no such thing`);
    }
    const named = new Set(feature.names);
    for (const n of feature.owns) if (!named.has(n)) throw new Error(`a feature cannot own "${n}" without naming it`);
  }

  /**
   * The feature called `name` — of the given kind, when one is asked for, so a
   * caller that needs an extrude's walls or a revolve's axis is told plainly
   * when the name is the other kind, rather than reading a field that is not
   * there.
   */
  featureOf(name: string): FeatureEntry;
  featureOf<K extends FeatureEntry["kind"]>(name: string, kind: K): Extract<FeatureEntry, { kind: K }>;
  featureOf(name: string, kind?: FeatureEntry["kind"]): FeatureEntry {
    const f = this.features.get(name);
    if (!f) throw new Error(`"${name}" is not a feature`);
    if (kind !== undefined && f.kind !== kind) throw new Error(`"${name}" is ${f.kind === "extrude" ? "an extrude" : "a revolve"}, not ${kind === "extrude" ? "an extrude" : "a revolve"}`);
    return f;
  }

  /**
   * Every feature whose record names `name` — an entity it was built on or
   * made, or the dimension that holds it — in creation order. What the
   * primitives consult before letting something go, and what `del` reads to
   * find the records a deletion takes.
   */
  featuresNaming(name: string): FeatureEntry[] {
    return [...this.features.values()].filter((f) => f.names.includes(name));
  }

  /** Every fillet and chamfer whose record names `name` — its dimension. `featuresNaming`'s question of the blends. */
  blendsNaming(name: string): BlendFeature[] {
    return [...this.blends.values()].filter((f) => f.names.includes(name));
  }

  /**
   * Every relation whose call named `name`, in creation order — counting a
   * frame named through one of its axes (`par("l1", "f1.x")` names `f1`).
   *
   * That last clause is load-bearing rather than a nicety. This is what
   * `deleteEntity` consults before letting an entity go and what `del`'s
   * cascade reads, so a frame whose axis reference did not count as naming it
   * could be deleted out from under a relation still reading it — a residual
   * that then throws inside the next solve, which is the failure mode furthest
   * from where the mistake was made.
   */
  relationsNaming(name: string): RelationEntry[] {
    return [...this.relations.values()].filter((r) => r.args.some((a) => argRefersTo(a, name)));
  }

  /**
   * Every constructor argument below is optional, because none of them were
   * ever constraints — `addCircle`'s radius only seeds a variable, and
   * `addPoint`'s coords pin nothing. Whatever is missing is auto-created
   * free with a sensible seed, so `addCircle()` is a legal way to say "a
   * circle, to be defined by the relations I am about to apply".
   *
   * `null` means the same as absent everywhere: the journal round-trips
   * through JSON, which has no undefined, so a missing argument comes back
   * from a saved file as null.
   *
   * Auto-created sub-entities (a free circle's center, a free line's
   * endpoints) are real, named, first-class points — but they journal
   * nothing of their own. The constructor journals as the one call that was
   * made and re-expands identically on replay, the same discipline
   * operations follow. (The double-journal bug this avoids is documented on
   * `relation()`.)
   */
  addPoint(coords?: number[] | null, name?: string | null): PointEntity {
    if (coords != null && coords.length !== this.dim) {
      throw new Error(`point needs ${this.dim} coordinates, got ${coords.length}`);
    }
    const nm = this.claimName("p", name ?? undefined);
    const seed = coords ?? new Array<number>(this.dim).fill(0);
    const varIndices = seed.map((c) => this.problem.addVar(c));
    const ent: PointEntity = { kind: "point", name: nm, varIndices };
    this.place(ent);
    this.record("addPoint", [coords ?? null, nm]);
    return ent;
  }

  /**
   * The one order every constructor that auto-creates points keeps: claim the
   * entity's name, *then* make its missing points (`makeParts`), and only
   * after both does the caller put the entity itself in place.
   *
   * The constructor's other refusals all run before this is called. The name
   * used to be claimed after the points were made, so a call refused for its
   * name left them behind — real points, unjournalled because the
   * constructor's own entry is what recreates them, that a save/open dropped
   * and whose names a replay then handed out again to something else.
   * Claiming first closes that, and claiming is safe to do first because it
   * refuses before it consumes anything (see `claimName`).
   *
   * While the parts are made the claimed name is held aside, because the
   * entity is not in `entities` to be seen yet: without that, a line
   * explicitly called `p3` would have its own endpoint auto-named `p3` out
   * from under it. Such a call used to be *refused*, as "already exists",
   * naming a point the user never made; it now succeeds with the endpoints
   * stepping around the name, the way auto-names step around every taken
   * one. No call that succeeded before gets different names: the hold only
   * changes an auto-name that would have landed on the claimed one.
   */
  claimFirst<T>(prefix: string, name: string | null | undefined, makeParts: () => T): [string, T] {
    const nm = this.claimName(prefix, name ?? undefined);
    this.claimed = nm;
    try {
      return [nm, makeParts()];
    } finally {
      this.claimed = null;
    }
  }

  /** A point along axis `axis` from `from`, for seeding auto-created pieces. */
  freePointOffset(from: number[], axis: number, by: number): PointEntity {
    const seed = from.slice();
    seed[axis] += by;
    return this.withoutRecording(() => this.addPoint(seed));
  }

  addLine(aGiven?: string | null, bGiven?: string | null, name?: string | null): LineEntity {
    if (aGiven != null) this.point(aGiven); // validates it exists and is a point
    if (bGiven != null) this.point(bGiven);
    if (aGiven != null && aGiven === bGiven) throw new Error("a line needs two different points");
    // Missing endpoints are auto-created and seeded APART — a zero-length
    // line has no direction, and half the relation vocabulary (tan, par,
    // ang) divides by that direction's length. The offset guarantees the
    // seed is never degenerate; the solver is free to move it afterwards.
    const span = Model.FREE_SPAN;
    const [nm, [a, b]] = this.claimFirst("l", name, () => {
      let a = aGiven, b = bGiven;
      if (a == null && b == null) {
        a = this.withoutRecording(() => this.addPoint()).name;
        b = this.freePointOffset(this.coords(a), 0, span).name;
      } else if (b == null) {
        b = this.freePointOffset(this.coords(a!), 0, span).name;
      } else if (a == null) {
        a = this.freePointOffset(this.coords(b), 0, -span).name;
      }
      return [a!, b!];
    });
    const ent: LineEntity = { kind: "line", name: nm, refs: [a, b] };
    this.place(ent);
    this.record("addLine", [aGiven ?? null, bGiven ?? null, nm]);
    return ent;
  }

  /**
   * A circle about `center` — and, in a 3D model, facing `normal`. See
   * `CircleEntity` for what the normal is and what holds it (relations, never
   * this).
   *
   * `normal` is a **seed**, three numbers whose direction is all that counts,
   * exactly as `radius` and a point's coordinates are seeds: no relation holds
   * it. Left out, it is the drawing plane's normal at call time — the work
   * plane's, else the default frame's, else the origin's +z — so a circle typed
   * bare lies the way a click there would. A 2D model refuses the argument
   * rather than ignoring it: every 2D circle lies in the one plane there is.
   *
   * Journalled as given — null stays null, seeded again from the drawing plane
   * at replay, which is journalled state — and the solved normal is saved with
   * the file's values (persist.ts), as a radius is. Files older than format
   * version 13 named a frame here; they are translated on the way in.
   */
  addCircle(center?: string | null, radius?: number | null, normal?: number[] | string | null,
            name?: string | null): CircleEntity {
    this.checkCircle(center, radius);
    const seed = this.normalSeed("circle", normal);
    const [nm, c] = this.claimFirst("c", name, () => center ?? this.withoutRecording(() => this.addPoint()).name);
    const ent: CircleEntity = {
      kind: "circle", name: nm, center: c,
      radiusVar: this.problem.addVar(radius ?? Model.DEFAULT_RADIUS),
    };
    if (seed != null) ent.normal = seed.map((v) => this.problem.addVar(v));
    this.place(ent);
    this.record("addCircle", [center ?? null, radius ?? null, normal ?? null, nm]);
    return ent;
  }

  /**
   * An arc about `center` from `start` to `end` — counter-clockwise about its
   * own normal in 3D, about the 2D +z in 2D (see `ArcEntity`). `normal` is
   * seeded exactly as `addCircle` seeds it.
   *
   * Missing pieces seed as a non-degenerate quarter arc around the centre:
   * along the kernel's x and y in 2D, as they always did, and in 3D along two
   * directions square to the normal (`spanOf`), so that a free arc lies in the
   * plane it faces rather than in the gauge's x–y plane, which might be
   * edge-on to it. Seeds and nothing more — no relation holds them there.
   */
  addArc(center?: string | null, start?: string | null, end?: string | null,
         radius?: number | null, normal?: number[] | string | null, name?: string | null): ArcEntity {
    this.checkArc(center, start, end, radius);
    const r = radius ?? Model.DEFAULT_RADIUS;
    const seed = this.normalSeed("arc", normal);
    const [nm, [c, s, e]] = this.claimFirst("a", name, () => {
      // Auto pieces seed as a non-degenerate quarter arc around the center.
      const c = center ?? this.withoutRecording(() => this.addPoint()).name;
      const [along0, along1] = seed == null ? [null, null] : spanOf(unitOf(seed));
      const place = (axis: number, along: number[] | null) => along
        ? this.withoutRecording(() => this.addPoint(this.coords(c).map((v, i) => v + r * along[i]))).name
        : this.freePointOffset(this.coords(c), axis, r).name;
      return [c, start ?? place(0, along0), end ?? place(1, along1)];
    });
    const ent: ArcEntity = { kind: "arc", name: nm, center: c, start: s, end: e, radiusVar: this.problem.addVar(r) };
    if (seed != null) ent.normal = seed.map((v) => this.problem.addVar(v));
    this.place(ent);
    this.record("addArc", [center ?? null, start ?? null, end ?? null, radius ?? null, normal ?? null, nm]);
    return ent;
  }

  /**
   * The refusals `addCircle` makes about its own arguments. Public, with
   * `checkArc`, so the command line can ask before it makes a view-centre
   * anchor that a refused call would leave behind. Changes nothing.
   */
  checkCircle(center?: string | null, radius?: number | null): void {
    if (center != null) this.point(center);
    if (radius != null && !(radius > 0)) throw new Error("a circle needs a positive radius");
  }

  /** `checkCircle` for `addArc`. */
  checkArc(center?: string | null, start?: string | null, end?: string | null, radius?: number | null): void {
    if (center != null) this.point(center);
    if (start != null) this.point(start);
    if (end != null) this.point(end);
    if (start != null && start === end) throw new Error("an arc needs two different endpoints");
    if (radius != null && !(radius > 0)) throw new Error("an arc needs a positive radius");
    if ((start == null || end == null) && this.dim < 2) {
      // The quarter-arc seed needs two independent axes to be non-degenerate;
      // below 2D there is no second axis to offset along.
      throw new Error("an auto-seeded arc needs at least 2 dimensions");
    }
  }

  /**
   * The normal a new circle or arc is seeded with: in 3D the one given —
   * checked to be three finite numbers with a direction — or the drawing
   * plane's; anywhere else none, and an argument giving one is refused rather
   * than ignored. Changes nothing.
   */
  normalSeed(kind: string, normal: unknown): number[] | null {
    if (this.dim !== 3) {
      if (normal != null) {
        throw new Error(`a ${this.dim}D ${kind} takes no normal — it lies in the one plane a ${this.dim}D model has`);
      }
      return null;
    }
    if (normal == null) return this.planeValues(this.drawingPlane())?.n ?? [0, 0, 1];
    // A plane named — a frame, a curve, "p1.p2.p3" — seeds from that plane's
    // normal, as it stands at the call, and holds nothing: facing a plane once
    // is not being held to it, which is a `par` (the command line's `circ(c, r,
    // "f1")` adds one). Before format 13 this argument named a frame the
    // curve followed for ever; persist.ts gives those files their `par`.
    if (typeof normal === "string") return this.planeValues(normal)?.n ?? [0, 0, 1];
    if (!Array.isArray(normal) || normal.length !== 3 || !normal.every((v) => typeof v === "number" && Number.isFinite(v))
        || !(Math.hypot(...normal) > 1e-12)) {
      throw new Error(`a ${kind}'s normal is three numbers with a direction, got ${JSON.stringify(normal)}`);
    }
    return normal.slice();
  }

  /**
   * A circle's or arc's normal as a unit vector of plain numbers — its own
   * three variables, normalised; the 2D drawing's +z in a model whose curves
   * carry none. For seeding, drawing and the questions asked above the
   * relations; every residual reads the variables themselves
   * (`curveNormal` in relations/refs.ts).
   */
  normalOf(name: string): number[] {
    const c = this.oriented(name);
    if (c.normal === undefined) return [0, 0, 1];
    const n = unitOf(c.normal.map((i) => this.problem.getVar(i)));
    if (c.straighten === undefined) return n;
    // A kind that straightens its plane against an axis of its own (its
    // `plane` says which point): the normal's part along that axis is not its
    // plane's, as a frame's y-ref is straightened against its +x.
    const d = unitOf(this.coords(c.straighten).map((v, i) => v - this.coords(c.center)[i]));
    const along = n.reduce((s, x, i) => s + x * d[i], 0);
    const straight = n.map((x, i) => x - along * d[i]);
    return Math.hypot(...straight) > 1e-12 ? unitOf(straight) : n;
  }

  /**
   * A curve that carries a plane — a circle, an arc, or a kind whose
   * declaration says it carries one (`EntityKindSpec.plane`): its centre and
   * its normal's variables (and the point it is straightened against). What
   * `normalOf`, `setNormal` and the plane questions read, so such a kind is a
   * plane reference exactly as a circle is.
   */
  oriented(name: string): { center: string; normal?: number[]; straighten?: string } {
    const e = this.entities.get(name);
    const declared = e && entityKind(e.kind)?.plane;
    if (e && declared) return declared(e);
    if (!e || (e.kind !== "circle" && e.kind !== "arc")) {
      throw new Error(`"${name}" is not ${orList(["a circle", "arc", ...planeNouns()])}`);
    }
    return { center: e.center, normal: e.normal };
  }

  /**
   * Puts a circle's or arc's normal at `n` outright — a seed, as `setCoords`
   * is, which the next solve is free to move. What restoring a file's values
   * and seeding a twin use. Journalled as `setCoords` is.
   */
  setNormal(name: string, n: number[]): void {
    const c = this.oriented(name);
    if (c.normal === undefined) throw new Error(`"${name}" has no normal — a ${this.dim}D curve lies in the one plane there is`);
    if (!Array.isArray(n) || n.length !== 3 || !(Math.hypot(...n) > 1e-12)) {
      throw new Error(`a normal is three numbers with a direction, got ${JSON.stringify(n)}`);
    }
    c.normal.forEach((gi, i) => this.problem.setVar(gi, n[i]));
    this.record("setNormal", [name, n]);
  }

  // ---- planes ------------------------------------------------------------

  /**
   * Which of the three kinds of **plane reference** `ref` is, or a refusal
   * naming what it needed to be. A plane reference is one string:
   *
   * - a **frame**'s name — its x–y plane — `"origin"` included;
   * - a **circle's or arc's** name — the plane through its centre square to
   *   its own normal;
   * - **three points' names joined by dots** — `"p1.p2.p3"`, the plane through
   *   them, its normal (p2 − p1) × (p3 − p1). A face of a solid is one of these
   *   (sketchface.ts), which is how a sketch on a face is stored without a
   *   frame being made for it.
   *
   * One string rather than three arguments, so a plane goes wherever a frame
   * went — an extrude's journal entry, a feature's record, the work plane —
   * without changing any of their shapes; and its names stay visible to the
   * deletion cascade through `referentsOf`. `claimName` refuses a dot, so no
   * entity can be called `p1.p2.p3`.
   */
  planeKind(ref: unknown): "frame" | "curve" | "points" {
    const what = `name a frame, a circle or arc, or three points as "p1.p2.p3"`;
    if (typeof ref !== "string") throw new Error(`${JSON.stringify(ref)} is not a plane — ${what}`);
    const pts = parsePointTriple(ref);
    if (pts) {
      for (const p of pts) this.point(p);
      if (new Set(pts).size !== 3) throw new Error(`"${ref}" names a point twice — a plane through points needs three different ones`);
      return "points";
    }
    if (this.isFrame(ref)) return "frame";
    const e = this.entities.get(ref);
    if (e && (e.kind === "circle" || e.kind === "arc" || entityKind(e.kind)?.plane)) {
      if (this.dim !== 3) throw new Error(`"${ref}" lies in the one plane a ${this.dim}D model has — it gives no plane of its own`);
      return "curve";
    }
    throw new Error(`"${ref}" is not a plane — ${what}`);
  }

  /**
   * A plane reference read as plain numbers — an origin, two unit in-plane
   * directions and the unit normal, three coordinates each — or null for one
   * collapsed past having a plane. **For seeding and for the questions asked
   * above the relations only**: every residual reads a plane lazily through
   * `planeBasis` (relations/refs.ts), which reads a frame through
   * `frameBasis`; this is the same arithmetic in plain numbers, here because
   * this layer seeds new curves along the drawing plane and sits below them.
   */
  planeValues(ref: string): { origin: number[]; u: number[]; v: number[]; n: number[] } | null {
    const kind = this.planeKind(ref);
    const at = (p: string) => { const c = this.coords(p); return [c[0], c[1] ?? 0, c[2] ?? 0]; };
    if (kind === "frame") {
      if (ref === ORIGIN) return { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], n: [0, 0, 1] };
      const axes = this.frameAxes(ref);
      return axes ? { origin: at(this.frame(ref).origin), u: axes[0], v: axes[1], n: cross(axes[0], axes[1]) } : null;
    }
    if (kind === "curve") {
      const n = this.normalOf(ref);
      const [u, v] = spanOf(n);
      return { origin: at(this.oriented(ref).center), u, v, n };
    }
    const [a, b, c] = parsePointTriple(ref)!.map(at);
    const u = unitOrNull(b.map((x, i) => x - a[i]));
    if (!u) return null;
    const arm = c.map((x, i) => x - a[i]);
    const along = arm.reduce((s, x, i) => s + x * u[i], 0);
    const v = unitOrNull(arm.map((x, i) => x - along * u[i]));
    return v ? { origin: a, u, v, n: cross(u, v) } : null;
  }

  /**
   * The plane a click lands on and a curve is drawn in when nothing else is
   * said — **the drawing plane**: the work plane when one is set (a face, by
   * sketch on face), else the default frame's x–y plane, else the origin's,
   * which is always there.
   */
  drawingPlane(): string {
    return this.workPlane ?? this.defaultFrame ?? ORIGIN;
  }

  /**
   * Sets the **work plane** — what is drawn next lies on it — to a plane
   * reference, or clears it with null. Document state, journalled as typed,
   * like the default frame: what "Sketch on this face" does, with the face's
   * own three points (sketchface.ts) rather than a frame made of them — a
   * reference to the face, not a new entity. Setting the default frame clears
   * it, since that is the user choosing a frame to sketch on. 3D only.
   */
  setWorkPlane(ref: string | null): void {
    if (ref != null) {
      if (this.dim !== 3) throw new Error(`a ${this.dim}D model is one plane already — it has no work plane to set`);
      this.planeKind(ref);
    }
    this.workPlane = ref ?? null;
    this.record("setWorkPlane", [ref ?? null]);
  }

  /**
   * A 3D frame's +x and +y as unit vectors of plain numbers, or null for one
   * collapsed past having a plane — the same Gram–Schmidt `frameBasis` does,
   * here because this layer sits below the relations and only needs a
   * direction to put a seed along; no residual ever reads it.
   */
  private frameAxes(frame: string): [number[], number[]] | null {
    const f = this.frame(frame);
    const o = this.coords(f.origin);
    const ux = unitOrNull(this.coords(f.xref).map((v, i) => v - o[i]));
    const arm = f.yref === undefined ? null : this.coords(f.yref).map((v, i) => v - o[i]);
    if (!ux || !arm) return null;
    const along = arm.reduce((s, v, i) => s + v * ux[i], 0);
    const uy = unitOrNull(arm.map((v, i) => v - along * ux[i]));
    return uy ? [ux, uy] : null;
  }

  /**
   * A coordinate frame: an origin, a point giving it a +x direction, and — in
   * a 3D model — a point giving it a +y side, which together make it a plane.
   * See `FrameEntity`.
   *
   * Free-entities conventions throughout — every argument optional, `null`
   * the same as absent, missing points auto-created as real named points,
   * and the whole thing journalled as *this one call* so a replay re-expands
   * it identically rather than seeing stray points. A 2D model refuses a
   * y-ref outright rather than ignoring it: +y is already settled there, and
   * a third point the frame then never read would be a constraint-shaped
   * thing that constrains nothing.
   *
   * Auto-created pieces are seeded a span apart for the same reason a free
   * line's endpoints are, only more sharply: a frame whose points coincide
   * has no direction, and one whose y-ref lies on its own x axis has no
   * plane, so every relation written against either would be meaningless. A
   * degenerate seed has to be impossible, not merely discouraged — which in
   * 3D takes a little more than "offset along the next axis", because two of
   * the three points may have been *given*. A seed is laid along the first
   * kernel axis that is not parallel to the arm already there (see
   * `axisClearOf`), so `addFrame("o", "up")` with `up` straight along the
   * kernel's y still gets a y-ref off that line. Only when the given points
   * themselves coincide is there nothing a seed can do, and then the
   * degeneracy is the drawing's, floored by `frameBasis` like a dragged one.
   *
   * The name is the last argument, as it is on every constructor here. That
   * moved it from third to fourth; files older than format version 5 are
   * translated on the way in — see `persist.ts`.
   */
  addFrame(origin?: string | null, xref?: string | null, yref?: string | null,
           name?: string | null): FrameEntity {
    // Everything is checked before anything is created, so a refused call
    // leaves no auto-created point behind.
    if (!framesExistIn(this.dim)) throw new Error(noFramesIn(this.dim));
    if (origin != null) this.point(origin);
    if (xref != null) this.point(xref);
    if (yref != null) {
      if (this.dim === 2) {
        throw new Error("a 2D frame takes no y-ref — its +y is +x turned a quarter turn, already");
      }
      this.point(yref);
    }
    const given = [origin, xref, yref].filter((n) => n != null);
    if (new Set(given).size !== given.length) {
      throw new Error(`a frame needs ${this.dim === 2 ? "two" : "three"} different points`);
    }

    const span = Model.FREE_SPAN;
    const arm = (from: string, to: string) => {
      const [a, b] = [this.coords(from), this.coords(to)];
      return b.map((v, i) => v - a[i]);
    };
    const [nm, [o, x, y]] = this.claimFirst("f", name, () => {
      let o = origin ?? null, x = xref ?? null, y = yref ?? null;
      // The origin first, since both arms are seeded off it. Given an x-ref it
      // sits a span back along the kernel's x, as it always has — unless a
      // given y-ref lies on that very line, in which case the next axis along.
      if (o == null) {
        if (x != null) {
          const k = y == null ? 0 : Model.axisClearOf(arm(x, y), [0, 1, 2]);
          o = this.freePointOffset(this.coords(x), k, -span).name;
        } else if (y != null) {
          o = this.freePointOffset(this.coords(y), 1, -span).name;
        } else {
          o = this.withoutRecording(() => this.addPoint()).name;
        }
      }
      if (x == null) {
        const k = y == null ? 0 : Model.axisClearOf(arm(o, y), [0, 1, 2]);
        x = this.freePointOffset(this.coords(o), k, span).name;
      }
      if (y == null && this.dim === 3) {
        y = this.freePointOffset(this.coords(o), Model.axisClearOf(arm(o, x), [1, 2, 0]), span).name;
      }
      return [o, x, y] as const;
    });

    const ent: FrameEntity = { kind: "frame", name: nm, origin: o, xref: x };
    if (y != null) ent.yref = y;
    this.place(ent);
    this.record("addFrame", [origin ?? null, xref ?? null, yref ?? null, nm]);
    return ent;
  }

  /**
   * The first of the kernel axes in `order` that is not parallel to `avoid` —
   * where a seed laid along it from the end of `avoid` can neither land on
   * that line nor double back along it. With no direction to avoid (`avoid`
   * of zero length) nothing helps, and the first axis is as good as any.
   *
   * At most one kernel axis can be parallel to a non-zero vector, so with two
   * or more candidates this always finds a clear one.
   */
  private static axisClearOf(avoid: number[], order: number[]): number {
    const len = Math.hypot(...avoid);
    for (const k of order) {
      const off = Math.sqrt(Math.max(0, len * len - avoid[k] * avoid[k]));
      if (off > 1e-9 * len) return k;
    }
    return order[0];
  }

  /**
   * Which frame `fix`, `onPlane` and the axis helpers mean when not told. A model-level
   * pointer and nothing more: a new model has **no** default, and then they
   * mean the origin. `"origin"` given is the same as null.
   *
   * Journalled, because it changes what a later relation call *means*. What
   * it does not do is change what an *already journalled* relation means —
   * the relations resolve this at call time and record the answer, so a
   * saved file never depends on what the default happened to be later.
   *
   * It also clears the work plane: choosing a frame to sketch on is choosing
   * where the next thing is drawn, and a face left as the work plane would
   * quietly win over it (`drawingPlane`). Implied by the entry, so journalled
   * by it.
   */
  setDefaultFrame(name: string | null): void {
    if (name != null) this.requireFrame(name); // fail on a name that is not a frame
    this.defaultFrame = name === ORIGIN ? null : name ?? null;
    this.workPlane = null;
    this.record("setDefaultFrame", [name ?? null]);
  }

  /**
   * The frame a call meant: the one it named, or the default, or the origin,
   * resolved *now*. Relations call this and journal what comes back, so the
   * entry carries an explicit frame name whatever the caller typed.
   */
  resolveFrame(name?: string | null): string {
    if (!framesExistIn(this.dim)) throw new Error(noFramesIn(this.dim));
    const n = name ?? this.defaultFrame ?? ORIGIN;
    this.requireFrame(n);
    return n;
  }

  /**
   * Refuses an axis this model's frames do not have. A 2D frame has an x and a
   * y and nothing else: its "z" would be the normal to a plane every point
   * already lies in, so anything written against it could only be trivially
   * true or impossible. `ref`, when given, is what the caller wrote, so the
   * message can quote it back.
   */
  requireAxis(axis: AxisName, ref?: string): void {
    if (axis === "z" && this.dim !== 3) {
      const what = ref === undefined ? "" : `"${ref}": `;
      throw new Error(`${what}a 2D frame has no z axis — z is the normal to a 3D frame's plane`);
    }
  }

  /**
   * The written reference to one of a frame's axes — `"f1.z"` — with the frame
   * resolved **now**: the one named, or the default. What `xaxis()`, `yaxis()`
   * and `zaxis()` are at the command line, kept here so the axis check and the
   * frame resolution happen in one order everywhere. The axis is checked
   * first, because in a 2D model no frame you could make would have a z.
   */
  axisRef(axis: AxisName, frame?: string | null): string {
    this.requireAxis(axis);
    // A work plane that is a frame is the plane things are drawn on, so a bare
    // axis means its axis (docs/plans/frameless-curves.md). One that is a
    // curve or three points has no named x or y, and the default's (else the
    // origin's) is meant, as `fix`'s is.
    const wp = this.workPlane;
    if (frame == null && wp !== null && this.planeKind(wp) === "frame") return `${wp}.${axis}`;
    return `${this.resolveFrame(frame)}.${axis}`;
  }

  /** Seed for a radius nobody specified. A seed, not a constraint. */
  static readonly DEFAULT_RADIUS = 10;

  /**
   * How far apart an auto-created pair of points is seeded — a free line's
   * endpoints, a frame's origin and its refs. A seed, not a constraint; what
   * it buys is that the direction between them is never zero.
   */
  static readonly FREE_SPAN = 20;

  point(name: string): PointEntity {
    const e = this.entities.get(name);
    if (!e || e.kind !== "point") throw new Error(`"${name}" is not a point`);
    return e;
  }

  line(name: string): LineEntity {
    const e = this.entities.get(name);
    if (!e || e.kind !== "line") throw new Error(`"${name}" is not a line`);
    return e;
  }

  circle(name: string): CircleEntity {
    const e = this.entities.get(name);
    if (!e || e.kind !== "circle") throw new Error(`"${name}" is not a circle`);
    return e;
  }

  arc(name: string): ArcEntity {
    const e = this.entities.get(name);
    if (!e || e.kind !== "arc") throw new Error(`"${name}" is not an arc`);
    return e;
  }

  frame(name: string): FrameEntity {
    const e = this.entities.get(name);
    if (!e || e.kind !== "frame") throw new Error(`"${name}" is not a frame`);
    return e;
  }

  /** A circle or an arc, whichever `name` is — for relations that only need center + radius (+ normal). */
  circular(name: string): CircularRef {
    const e = this.entities.get(name);
    if (!e || (e.kind !== "circle" && e.kind !== "arc")) throw new Error(`"${name}" is not a circle or arc`);
    const ref: CircularRef = { name: e.name, center: e.center, radiusVar: e.radiusVar };
    if (e.normal !== undefined) ref.normal = e.normal;
    return ref;
  }

  coords(name: string): number[] {
    const e = this.point(name);
    return e.varIndices.map((i) => this.problem.getVar(i));
  }

  /**
   * Moves a point outright. This is a *starting guess*, not a constraint —
   * the next solve is free to move it again. Operations that build geometry
   * use it to seed the solver near the answer they intend, which is what
   * picks one solution out of several that all satisfy the constraints.
   */
  setCoords(name: string, coords: number[]): void {
    const e = this.point(name);
    if (coords.length !== e.varIndices.length) {
      throw new Error(`${name} needs ${e.varIndices.length} coordinates, got ${coords.length}`);
    }
    e.varIndices.forEach((gi, i) => this.problem.setVar(gi, coords[i]));
    this.record("setCoords", [name, coords]);
  }

  /**
   * Points one end of a line at a different point. Structural surgery, used
   * by operations that trim geometry back — a fillet moving a leg's endpoint
   * from the old corner to the new tangent point, for instance.
   */
  retargetLine(lineName: string, from: string, to: string): void {
    const l = this.line(lineName);
    this.point(to);
    const i = l.refs.indexOf(from);
    if (i < 0) throw new Error(`"${lineName}" does not reference "${from}"`);
    const other = l.refs[1 - i];
    if (other === to) throw new Error("a line needs two different points");
    l.refs[i] = to;
    this.record("retargetLine", [lineName, from, to]);
  }

  /**
   * Points one end of an arc at a different point — `retargetLine` for an arc,
   * which trim (sketchedit.ts) needs where a feature's regeneration made its
   * twin arcs again rather than re-point them. Structure only: the relation
   * holding an arc's ends on its circle (`arcends`) captured the old end when it
   * was made, so the operation that calls this rebuilds it in place.
   */
  retargetArc(arcName: string, from: string, to: string): void {
    const a = this.arc(arcName);
    this.point(to);
    const which = a.start === from ? "start" : a.end === from ? "end" : null;
    if (which === null) throw new Error(`"${arcName}" does not end at "${from}"`);
    if ((which === "start" ? a.end : a.start) === to) throw new Error("an arc needs two different endpoints");
    if (a.center === to) throw new Error(`"${to}" is ${arcName}'s centre, not a point on its rim`);
    a[which] = to;
    this.record("retargetArc", [arcName, from, to]);
  }

  /**
   * A circle becomes an arc **under the same name**, from `start` to `end`
   * (counter-clockwise about its normal, as every arc runs) — what a trim of a
   * circle leaves. The centre, the radius variable and the normal are the
   * circle's own, so every relation that reads it (`rad`, `oncircle`, `tan`,
   * `conc`) goes on reading the same variables and means what it meant; only
   * the ends are new. In place in the registry, so its position — and every
   * name after it — is unchanged.
   */
  circleToArc(name: string, start: string, end: string): void {
    const c = this.circle(name);
    this.point(start);
    this.point(end);
    if (start === end) throw new Error("an arc needs two different endpoints");
    if (start === c.center || end === c.center) throw new Error(`an end of ${name} cannot be its own centre`);
    const arc: ArcEntity = { kind: "arc", name, center: c.center, start, end, radiusVar: c.radiusVar };
    if (c.normal !== undefined) arc.normal = c.normal;
    if (c.construction) arc.construction = true;
    this.entities.set(name, arc);
    this.record("circleToArc", [name, start, end]);
  }

  /**
   * `circleToArc` taken back: the arc is a whole circle again under its name,
   * its ends left as the points they are. For an operation that tried a trim
   * and refuses it (sketchedit.ts) — never journalled by one, since a refusal
   * journals nothing.
   */
  arcToCircle(name: string): void {
    const a = this.arc(name);
    const c: CircleEntity = { kind: "circle", name, center: a.center, radiusVar: a.radiusVar };
    if (a.normal !== undefined) c.normal = a.normal;
    if (a.construction) c.construction = true;
    this.entities.set(name, c);
    this.record("arcToCircle", [name]);
  }

  /**
   * The auto-name counters as they stand, and putting them back — for an
   * operation that tries a change on the model to ask the drawing a question
   * and then takes the change back itself (trim, asking whether a feature on
   * the curve can still be regenerated). Without this the trial would leave
   * every later auto-name shifted, and a replay — which never runs a refused
   * call — would hand out different names from the session's: the rollback
   * rule `relation()` keeps for a relation that throws.
   */
  nameCounters(): ReadonlyMap<string, number> {
    return new Map(this.counters);
  }

  restoreNameCounters(saved: ReadonlyMap<string, number>): void {
    this.counters = new Map(saved);
  }

  radius(name: string): number {
    return this.problem.getVar(this.circular(name).radiusVar);
  }

  /** The point names an entity is built out of. A point is built out of none. */
  refsOf(e: Entity): string[] {
    switch (e.kind) {
      case "point": return [];
      case "line": return [...e.refs];
      case "circle": return [e.center];
      case "arc": return [e.center, e.start, e.end];
      // The y-ref is a reference like the other two, so deleting it takes the
      // frame — a 3D frame cannot outlive the point that gives it a plane.
      case "frame": return e.yref === undefined ? [e.origin, e.xref] : [e.origin, e.xref, e.yref];
      // Any other kind says what it is built out of (`EntityKindSpec.refs`).
      default: return entityKind((e as { kind: string }).kind)?.refs(e) ?? [];
    }
  }

  /**
   * Every entity that names `name` among its references, in creation order —
   * its points. A circle or arc names no frame any more (it carries its own
   * normal), so deleting a frame takes only the relations reading it — a
   * `par` holding a circle to it among them — and the circle stays, free to
   * turn.
   */
  dependents(name: string): Entity[] {
    return [...this.entities.values()].filter((e) => this.refsOf(e).includes(name));
  }

  /**
   * Removes one entity. A *primitive*: it will not tidy up after itself, and
   * refuses while anything still points at what is being removed, because the
   * alternative is a line whose endpoint does not exist — which is not an
   * over-constrained model the solver can complain about, it is a model that
   * throws when it is next drawn. Working out what else has to go is `del`'s
   * job (see operations.ts), and journalling the expansion rather than the
   * cascade is what lets a saved file replay the same deletions.
   *
   * The point's variables stay in the problem, referenced by nothing. See the
   * note on tombstones in operations.ts.
   */
  deleteEntity(name: string): void {
    if (name === ORIGIN && framesExistIn(this.dim)) {
      throw new Error("the origin is part of every model — it cannot be deleted");
    }
    const e = this.entities.get(name);
    if (!e) throw new Error(`"${name}" is not an entity`);
    const held = this.dependents(name);
    if (held.length) {
      throw new Error(`"${name}" is still used by ${held.map((d) => d.name).join(", ")}`);
    }
    const constrained = this.relationsNaming(name);
    if (constrained.length) {
      throw new Error(`"${name}" is still constrained by ${constrained.map((r) => r.name).join(", ")}`);
    }
    const featured = this.featuresNaming(name);
    if (featured.length) {
      throw new Error(`"${name}" is still part of ${featured.map((f) => f.name).join(", ")}`);
    }
    // The default is a pointer at a frame, so it cannot outlive one. Cleared
    // here in the primitive rather than up in `del`, because the primitive is
    // also what a replay calls — and journalled as its own expansion, the
    // same discipline the deletion itself follows, so reopening a file gets
    // the pointer the deletion left rather than one recomputed later.
    if (this.defaultFrame === name) this.setDefaultFrame(null);
    // The work plane is a pointer too, at up to three of the face's points.
    if (this.workPlane !== null && referentsOf(this.workPlane).includes(name)) this.setWorkPlane(null);
    this.leaveGroups(name);
    // The equations that are its own definition go with it (`EntityKindSpec.owns`).
    for (const h of entityKind(e.kind)?.owns?.(e) ?? []) this.problem.removeBlock(h);
    this.entities.delete(name);
    this.record("deleteEntity", [name]);
  }

  /**
   * Removes one relation and the residual blocks it added. Refuses while a
   * feature's record names it — an extrude's depth, a revolve's angle — for
   * `deleteEntity`'s reason: the record would be left naming nothing.
   */
  deleteRelation(name: string): void {
    const r = this.relationOf(name);
    const featured = [...this.featuresNaming(name), ...this.blendsNaming(name), ...[...this.surfaces.values()].filter((x) => x.names.includes(name))];
    if (featured.length) {
      throw new Error(`"${name}" is still part of ${featured.map((f) => f.name).join(", ")}`);
    }
    this.leaveGroups(name);
    for (const h of r.blocks) this.problem.removeBlock(h);
    this.relations.delete(name);
    this.record("deleteRelation", [name]);
  }

  /**
   * Removes one feature's record — and only the record. A primitive, like the
   * other two: what else goes with a feature is `del`'s decision (see
   * operations.ts), and a deletion is journalled as its expansion, one
   * primitive per name, so this is what a replay of one calls. Nothing names a
   * record, so nothing can refuse it.
   */
  deleteFeature(name: string): void {
    // A fillet's or chamfer's record goes by the same primitive: one name
    // space, one journal op for "this record, and only it" — and so does a
    // surface's (docs/plans/surfaces.md).
    if (this.blends.has(name)) this.blends.delete(name);
    else if (this.surfaces.has(name)) this.surfaces.delete(name);
    else this.featureOf(name);
    this.features.delete(name);
    this.hidden.delete(name);
    this.record("deleteFeature", [name]);
  }

  // ---- regions ------------------------------------------------------------

  /**
   * Registers a region under a fresh `rgN` and returns it. Journals nothing:
   * the operation that calls it is the entry (operations.ts's `region`).
   */
  addRegion(frame: string, first: RegionStep): RegionEntry {
    const name = this.claimName("rg");
    const entry: RegionEntry = { name, frame, steps: [{ ...first, face: [...first.face] }] };
    this.regions.set(name, entry);
    return entry;
  }

  /**
   * Takes back a region made for a feature that then refused — the record and
   * the name, so a refused call consumes nothing (`claimName`'s rule).
   */
  forgetRegion(name: string): void {
    this.regions.delete(name);
    const m = /^rg(\d+)$/.exec(name);
    if (m && this.counters.get("rg") === Number(m[1])) this.counters.set("rg", Number(m[1]) - 1);
  }

  /** The region called `name`, or a refusal that says what it is instead. */
  regionEntry(name: string): RegionEntry {
    const r = this.regions.get(name);
    if (r) return r;
    const kind = this.entities.get(name)?.kind ?? (this.features.has(name) ? "feature" : this.relations.has(name) ? "relation"
      : this.groups.has(name) ? "group" : null);
    throw new Error(`${JSON.stringify(name)} ${kind ? `is a ${kind}, not a region` : "is not a region"} — regions are named rg1, rg2, … (ls() lists them)`);
  }

  /** The features standing on a region, in creation order. */
  featuresOnRegion(name: string): FeatureEntry[] {
    return [...this.features.values()].filter((f) => f.region === name);
  }

  /**
   * Removes a region's record — a primitive, as `deleteFeature` is: what goes
   * with it is `del`'s decision, and `del` journals this as part of its
   * expansion. Refused while a feature stands on it, for the reason an entity
   * a record names is: a feature naming no region is one whose next
   * regeneration has nothing to read.
   */
  deleteRegion(name: string): void {
    this.regionEntry(name);
    const on = this.featuresOnRegion(name);
    if (on.length) throw new Error(`${name} is what ${on.map((f) => f.name).join(", ")} ${on.length === 1 ? "stands" : "stand"} on — delete ${on.length === 1 ? "it" : "them"} first`);
    this.regions.delete(name);
    this.hidden.delete(name);
    this.record("deleteRegion", [name]);
  }

  /**
   * Takes step `index` (1 or more — the first face is the region) out of a
   * region's chain. A primitive for a deletion's expansion; the operation
   * that calls it journals (operations.ts's `dropSteps`).
   */
  removeRegionStep(name: string, index: number): void {
    const r = this.regionEntry(name);
    if (!Number.isInteger(index) || index < 1 || index >= r.steps.length) {
      throw new Error(`${name} has no step ${index} — its steps are 1 to ${r.steps.length - 1} after its first face`);
    }
    r.steps.splice(index, 1);
  }

  // ---- construction geometry ---------------------------------------------

  /**
   * Whether `name` is **construction geometry**: a line, arc or circle that
   * forms no regions (loops.ts leaves it out) and is in every other way an
   * ordinary entity — constrained, solved, picked, snapped to, drawn (thin and
   * muted, never dashed). False for anything else, a name that is not there
   * included: a point or a frame bounds nothing, so it has no flag to carry.
   */
  isConstruction(name: string): boolean {
    const e = this.entities.get(name);
    return e !== undefined && isCurveKind(e.kind) && (e as { construction?: true }).construction === true;
  }

  /**
   * Sets or clears the flag on one line, arc or circle. **On the entity, not in
   * a set beside it** — the owner: *"construction geometry should be a per
   * entity flag"* — so it goes with the entity when it is deleted, stays with a
   * line an operation re-points, and can never be a group's property: a group
   * is only ever expanded into the entities this is called on, at the moment of
   * the call (operations.ts's `construction`). Absent rather than false when
   * cleared, so an entity that was never flagged and one flagged and cleared
   * are the same object. A primitive: journals nothing, and refuses nothing a
   * feature could object to — the operation asks that first.
   */
  setConstruction(name: string, on: boolean): void {
    const e = this.entities.get(name);
    if (!e || !isCurveKind(e.kind)) {
      throw new Error(`"${name}" is not ${orList(["a line", "arc", "circle", ...curveNouns()])} — only they bound regions, so only they can be construction`);
    }
    const flagged = e as { construction?: true };
    if (on) flagged.construction = true;
    else delete flagged.construction;
  }

  // ---- groups and visibility ---------------------------------------------

  /** The group called `name`. */
  groupOf(name: string): GroupEntry {
    const g = this.groups.get(name);
    if (!g) throw new Error(`"${name}" is not a group`);
    return g;
  }

  /** Every group `name` is a member of, in creation order. */
  groupsHolding(name: string): GroupEntry[] {
    return [...this.groups.values()].filter((g) => g.members.includes(name));
  }

  /**
   * What a group or a feature names, read as a set: a group's members, or what
   * a feature made (its `owns` — never the profile it stands on, which was the
   * user's sketch first). Null for anything else.
   */
  membersOf(name: string): readonly string[] | null {
    const g = this.groups.get(name);
    if (g) return g.members;
    const f = this.features.get(name) ?? this.blends.get(name) ?? this.surfaces.get(name);
    return f ? f.owns : null;
  }

  /**
   * Names as a flat set of entities and relations, in order and without
   * repeats: a group or a feature stands for its members **now** (the union
   * the owner's no-hierarchy rule asks for — a group never holds a group),
   * everything else for itself. `withFeatures` keeps a feature's own name too,
   * for `hide`, where a feature's faces go with it. Refuses a name that is
   * none of those, before anything is changed, with `who` in the message.
   */
  expand(names: readonly string[], who: string, withFeatures = false): string[] {
    const out = new Set<string>();
    for (const n of names) {
      const set = this.membersOf(n);
      if (set) {
        if (withFeatures && (this.features.has(n) || this.blends.has(n) || this.surfaces.has(n))) out.add(n);
        for (const m of set) out.add(m);
      } else if (this.entities.has(n) || this.relations.has(n)) {
        out.add(n);
      } else if (withFeatures && this.regions.has(n)) {
        // A region is hidden by its own name: it has no members to hide.
        out.add(n);
      } else {
        throw new Error(`${who}: "${n}" is not an entity, a relation, a group or a feature`);
      }
    }
    return [...out];
  }

  /**
   * Registers a group of `members` — entities and relations, already flattened
   * (`expand`) — under `name` or a fresh `gN`. Journals nothing: the operation
   * that calls it is the entry (groups.ts).
   */
  addGroup(members: readonly string[], name?: string | null): GroupEntry {
    this.checkMembers(members);
    const nm = this.claimName("g", name ?? undefined);
    const entry: GroupEntry = { name: nm, members: [...new Set(members)] };
    this.groups.set(nm, entry);
    return entry;
  }

  /** Adds members to a group, skipping any already in it. Journals nothing. */
  addMembers(group: string, members: readonly string[]): void {
    const g = this.groupOf(group);
    this.checkMembers(members);
    for (const m of members) if (!g.members.includes(m)) g.members.push(m);
  }

  /**
   * Takes members out of a group, which stays when none are left — a group
   * may be empty (`GroupEntry`). Journals nothing.
   */
  removeMembers(group: string, members: readonly string[]): void {
    const g = this.groupOf(group);
    g.members = g.members.filter((m) => !members.includes(m));
  }

  /**
   * Removes a group, and only the group: it owns nothing. An open group that
   * goes is closed, in the primitive, so a replay of the `ungroup` closes it
   * too. Journals nothing.
   */
  deleteGroup(name: string): void {
    this.groupOf(name);
    this.groups.delete(name);
    if (this.openGroup === name) this.openGroup = null;
  }

  /**
   * Opens group `name` — or, given null, closes whatever is open. Journals
   * nothing: `opengroup`/`closegroup` (groups.ts) are the entries.
   */
  setOpenGroup(name: string | null): void {
    if (name !== null) this.groupOf(name);
    this.openGroup = name;
  }

  /**
   * Gives group `from` the name `to`, by the model's name rules (unique, no
   * dot; a `gN` moves the counter past it), keeping its place in the
   * registry's order and its being open. Only a group's name can change: an
   * entity's or a relation's is written into every entry that names it, and a
   * group's only into the entries after this one. Journals nothing.
   */
  renameGroup(from: string, to: string): void {
    this.groupOf(from);
    if (from === to) return;
    const nm = this.claimName("g", to);
    const order = [...this.groups.entries()];
    this.groups.clear();
    for (const [k, v] of order) {
      if (k === from) {
        v.name = nm;
        this.groups.set(nm, v);
      } else this.groups.set(k, v);
    }
    if (this.openGroup === from) this.openGroup = nm;
  }

  /** A group holds entities and relations — never a group, never a feature: that would be a tree. */
  private checkMembers(members: readonly string[]): void {
    for (const m of members) {
      if (!this.entities.has(m) && !this.relations.has(m)) {
        throw new Error(`a group holds entities and relations, and "${m}" is neither`);
      }
    }
  }

  /**
   * What a deletion does to the groups and the visibility of what it deletes:
   * it leaves every group it was in — journalled, as `removeFrom`, the way the
   * default frame's clearing is journalled — and a group it leaves empty
   * stays, empty. Its hidden flag simply goes: a name that is not there has no
   * visibility for a replay to disagree about.
   */
  private leaveGroups(name: string): void {
    for (const g of this.groupsHolding(name)) {
      this.record("removeFrom", [g.name, name]);
      this.removeMembers(g.name, [name]);
    }
    this.hidden.delete(name);
  }

  /**
   * **Solves, and refuses a solution that collapses something**
   * (docs/plans/conflict-detection.md). The owner: *"I'm able to add a
   * parallel relation to a set of perpendicular relation lines. This is a
   * bug."* A rectangle's sides held perpendicular and then two of them
   * parallel solves to 1e-12, by shrinking a side to nothing: a line of zero
   * length is parallel and perpendicular to everything. Least squares cannot
   * tell that root from a real one, so the check is made here, where what a
   * line *is* is known.
   *
   * A **collapse** is a measure (`measuresOf`: a line's length, a radius, a
   * declared kind's own (a spline's spacing), a frame's axes) that was above ε·L
   * before the solve and is below it after, with L the drawing's size
   * (`extent`) — see `collapsedNow` for how a slow collapse is told from a
   * small size. A measure already ~0 before (a point drawn on another) is not
   * one; nor is a measure **the user's own relation sets to zero**,
   * `dist(p, q, 0)` or a `coin` of a line's ends: one relation alone does it
   * too (`ownZeros`).
   *
   * **A collapse is first given a second chance**, because the solver is
   * local: from a rectangle it will fold a side to meet a `par` and a `perp`
   * on *other* sides that a turn of one side meets as well. So the part that
   * folded is solved again from where it was, steered (`steered`): first with
   * every size pulled weakly toward what it was, then released. If that
   * finds a solution with nothing folded, it is the solution.
   *
   * Anything still collapsed makes the solve **fail**: `solved` is false,
   * `collapsed` names what would have folded, and every variable that can move
   * with it (`Problem.connected`) is put back where it was, so the drawing
   * does not visibly fold. The rest of the drawing keeps what the solve did:
   * a component shares no variable with another, so its answer is the same
   * either way. `conflicting(report)` then names the relations.
   */
  solve(): ModelSolveReport {
    const ctx: SolveContext = { before: this.problem.snapshot(), L: this.extent(), exempt: new Set() };
    let out: ModelSolveReport = { ...this.problem.solve(), collapsed: [] };
    let fell = this.collapsedNow(ctx);
    if (fell.length) {
      const part = this.problem.connected(this.varsOfKeys(fell));
      this.problem.restore(ctx.before, part.vars);
      this.steered(ctx, new Set(part.blocks), this.entitiesIn(new Set(part.vars)));
      // A whole solve from there: the parts already settled do not move, and
      // the report is the drawing's as it now stands.
      out = { ...this.problem.solve(), collapsed: [] };
      fell = this.collapsedNow(ctx);
    }
    if (fell.length) {
      this.ownZeros(ctx, fell);
      fell = fell.filter((k) => !ctx.exempt.has(k));
    }
    if (fell.length) {
      out.collapsed = [...new Set(fell.map(measureEntity))];
      out.solved = false;
      this.problem.restore(ctx.before, this.problem.connected(this.varsOfKeys(fell)).vars);
    }
    this.solves.set(out, ctx);
    return out;
  }

  /**
   * One frame of a drag: a solve with `extra` pulls (`Problem.solve`), and
   * **a frame that would collapse something stops where the last one was**,
   * so a drag folds nothing. Only what can move with the collapse is put back;
   * the rest of the frame stands. A drawing that already holds a conflict
   * does not move in that part while it does, which is what the conflict ink
   * is there to say.
   *
   * Cheaper than `solve`'s check, as a frame must be: a measure that shrank
   * past `SUSPECT`·L is enough to stop the frame, with no polish to tell a
   * slow collapse from a size that small (the hand goes on, and the next
   * frame is another chance), and nothing is exempted: a frame adds no
   * relation, so every zero of the user's own is already zero before it.
   */
  solveFrame(extra: ResidualBlock[]): SolveReport {
    const ctx: SolveContext = { before: this.problem.snapshot(), L: this.extent(), exempt: new Set() };
    const report = this.problem.solve({ extra });
    const fell = this.shrunk(ctx, SUSPECT);
    if (fell.length) this.problem.restore(ctx.before, this.problem.connected(this.varsOfKeys(fell)).vars);
    return report;
  }

  /**
   * An entity's **non-degeneracy measures**: a line's length, a circle's and
   * an arc's radius, a frame's x-ref's distance from its origin (and in 3D its
   * y-ref's off the x axis), and whatever a declared kind says
   * (`EntityKindSpec.measures`). A point has none. Each is a function of
   * variables, so it can be read at any state (`sizeAt`) and pulled on
   * (`steered`). The built-ins are answered here by name, as their refs and
   * variables are (`refsOf`, `ownVars`), since they are declared nowhere
   * else.
   */
  measuresOf(e: Entity): Measure[] {
    const pt = (n: string) => (this.entities.get(n) as PointEntity).varIndices;
    switch (e.kind) {
      case "point": return [];
      case "line": return [distanceMeasure(pt(e.refs[0]), pt(e.refs[1]))];
      case "circle":
      case "arc": return [{ vars: [e.radiusVar], size: (l) => l[0].abs() }];
      case "frame": {
        const axis = distanceMeasure(pt(e.origin), pt(e.xref));
        if (e.yref === undefined) return [axis];
        const [o, x, y] = [pt(e.origin), pt(e.xref), pt(e.yref)];
        const d = o.length;
        // The y-ref's distance off the x axis: what is left of it once its
        // part along +x is taken away.
        return [axis, {
          vars: [...o, ...x, ...y],
          size: (l) => {
            const u = l.slice(d, 2 * d).map((v, i) => v.sub(l[i]));
            const w = l.slice(2 * d).map((v, i) => v.sub(l[i]));
            const uu = u.reduce((s, v) => s.add(v.mul(v)), Dual.constant(0));
            if (!(uu.val > 0)) return dualNorm(w);
            const t = u.reduce((s, v, i) => s.add(v.mul(w[i])), Dual.constant(0)).div(uu);
            return dualNorm(w.map((v, i) => v.sub(t.mul(u[i]))));
          },
        }];
      }
      default: return entityKind((e as { kind: string }).kind)?.measures?.(this, e) ?? [];
    }
  }

  /** A measure's size at `values` (a `snapshot`, or the problem's own), where every variable it reads has one. */
  private sizeAt(m: Measure, values?: readonly number[]): number {
    return m.size(m.vars.map((v) => Dual.constant(values ? values[v] : this.problem.getVar(v)))).val;
  }

  /**
   * **L, the drawing's size**: the diagonal of the box round every point, or
   * the largest measure where that is larger (a lone circle's box is its
   * centre). What ε is a share of, so a collapse means the same in a drawing
   * of microns as in one of metres.
   */
  extent(): number {
    const lo: number[] = [], hi: number[] = [];
    let largest = 0;
    for (const e of this.entities.values()) {
      if (e.kind === "point") {
        e.varIndices.forEach((gi, i) => {
          const v = this.problem.getVar(gi);
          lo[i] = Math.min(lo[i] ?? v, v);
          hi[i] = Math.max(hi[i] ?? v, v);
        });
      } else if (e.kind === "circle" || e.kind === "arc") {
        largest = Math.max(largest, Math.abs(this.problem.getVar(e.radiusVar)));
      }
    }
    const diagonal = Math.hypot(...lo.map((v, i) => hi[i] - v));
    return Math.max(Number.isFinite(diagonal) ? diagonal : 0, largest);
  }

  /** Every variable an entity reads: its own and its points'. */
  private varsOfEntity(name: string): number[] {
    const e = this.entities.get(name);
    if (!e) return [];
    return [...this.ownVars(e), ...this.refsOf(e).flatMap((p) => (this.entities.get(p) as PointEntity | undefined)?.varIndices ?? [])];
  }

  /** The variables of the entities a list of `name#k` measure keys is of. */
  private varsOfKeys(keys: readonly string[]): number[] {
    return [...new Set(keys.map(measureEntity))].flatMap((n) => this.varsOfEntity(n));
  }

  /** The live entities with a measure that read any of `vars`. */
  private entitiesIn(vars: ReadonlySet<number>): string[] {
    const out: string[] = [];
    for (const e of this.entities.values()) {
      if (e.kind !== "point" && this.measuresOf(e).some((m) => m.vars.some((v) => vars.has(v)))) out.push(e.name);
    }
    return out;
  }

  /**
   * The measures (as `name#k` keys) of `names` — every entity, unspecified —
   * that were above ε·L before (`ctx`) and are now below `share`·L and less
   * than a tenth of what they were. Only an entity a variable of which moved
   * is read, so a solve that moved little costs little to check.
   */
  private shrunk(ctx: SolveContext, share: number, names?: Iterable<string>): string[] {
    const floor = COLLAPSE * ctx.L, ceiling = share * ctx.L;
    const out: string[] = [];
    if (!(floor > 0)) return out;
    const moved = (v: number) => v < ctx.before.length && ctx.before[v] !== this.problem.getVar(v);
    for (const n of names ?? this.entities.keys()) {
      const e = this.entities.get(n);
      if (!e || e.kind === "point") continue;
      this.measuresOf(e).forEach((m, k) => {
        if (!m.vars.some(moved) || m.vars.some((v) => v >= ctx.before.length)) return;
        const was = this.sizeAt(m, ctx.before);
        const now = this.sizeAt(m, undefined);
        // NaN, a size gone to nothing defined, counts as shrunk.
        if (was > floor && !(now >= was * SHRINK || now >= ceiling)) out.push(`${n}#${k}`);
      });
    }
    return out;
  }

  /**
   * **What has collapsed, told from what is merely small** (`names`, or
   * every entity). A collapse a residual meets linearly lands at the solver's
   * own precision, ~1e-12·L. One a residual meets quadratically — a
   * triangle's two perpendiculars, whose second row is the square of the
   * folding side once the first holds — stalls where the damped step can no
   * longer see it, measured at 4e-5·L, which is no smaller than a real
   * detail. So a measure that shrank below `SUSPECT`·L and to a tenth of
   * what it was is a **suspect**, and is **pushed**: pulled toward nothing
   * (with only the blocks of the solve being checked, `only`, or its whole
   * part), then released. A collapse has nothing holding it off zero, so it
   * goes there and stays; a real size is pulled back by the relation that set
   * it. What ends below ε·L has collapsed, and stays where the push put it; a
   * suspect cleared is put back exactly where the solve left it.
   */
  private collapsedNow(ctx: SolveContext, names?: readonly string[], only?: ReadonlySet<BlockHandle>): string[] {
    const suspects = this.shrunk(ctx, SUSPECT, names);
    if (!suspects.length) return [];
    const who = [...new Set(suspects.map(measureEntity))];
    const deep = new Set(this.shrunk(ctx, COLLAPSE, who));
    const shallow = suspects.filter((k) => !deep.has(k));
    if (!shallow.length) return [...deep];
    const solved = this.problem.snapshot();
    const part = this.problem.connected(this.varsOfKeys(shallow));
    const blocks = new Set(only ? part.blocks.filter((b) => only.has(b)) : part.blocks);
    const pushes: ResidualBlock[] = [];
    for (const k of shallow) {
      const m = this.measuresOf(this.entities.get(measureEntity(k))!)[Number(k.slice(k.lastIndexOf("#") + 1))];
      pushes.push({ varIndices: m.vars, fn: (l) => [m.size(l).mul(PUSH / ctx.L)] });
    }
    this.problem.solve({ only: blocks, extra: pushes });
    this.problem.solve({ only: blocks });
    const fell = this.shrunk(ctx, COLLAPSE, who);
    if (fell.some((k) => !deep.has(k))) return fell;
    // The push cleared every suspect it was given: a size that is small and
    // real is the solve's answer, not the push's, so the solve's state comes back.
    this.problem.restore(solved);
    return [...deep];
  }

  /**
   * **A steered solve** of the blocks `only`, from wherever the values stand:
   * first with every measure of `entities` that had a size before (`ctx`)
   * pulled toward that size, then released. The pull keeps the solver off a
   * collapse while it finds what else would do, and the release lets the
   * relations have the last word, so a size a relation really does change is
   * not held back. Returns the release's report.
   */
  private steered(ctx: SolveContext, only: ReadonlySet<BlockHandle>, entities: readonly string[]): SolveReport {
    const floor = COLLAPSE * ctx.L;
    const pulls: ResidualBlock[] = [];
    for (const n of entities) {
      const e = this.entities.get(n);
      if (!e) continue;
      for (const m of this.measuresOf(e)) {
        if (m.vars.some((v) => v >= ctx.before.length)) continue;
        const was = this.sizeAt(m, ctx.before);
        if (!(was > floor)) continue;
        // Relative, so a pull means the same on a long side as on a short one.
        pulls.push({ varIndices: m.vars, fn: (l) => [m.size(l).sub(was).mul(STEER / was)] });
      }
    }
    this.problem.solve({ only, extra: pulls });
    return this.problem.solve({ only });
  }

  /**
   * Which relations a person can delete, as opposed to one a feature holds
   * (an extrude's depth, which `deleteRelation` refuses): what a conflict is
   * named by. A held one is part of the feature, as its geometry is.
   */
  private removable(name: string): boolean {
    return !this.featuresNaming(name).length && !this.blendsNaming(name).length
      && ![...this.surfaces.values()].some((x) => x.names.includes(name));
  }

  /** The relation owning each block a relation owns. */
  private blockOwners(): Map<BlockHandle, string> {
    const owner = new Map<BlockHandle, string>();
    for (const r of this.relations.values()) for (const b of r.blocks) owner.set(b, r.name);
    return owner;
  }

  /**
   * **A trial**: whether `rels`, with the blocks of `background`, conflict in
   * `part` — solved alone from the state before (`ctx`), they fail, or
   * collapse a measure that is not the user's own zero even when steered off
   * it. What the conflict search asks (`conflicting`) and the exemption is
   * decided by (`ownZeros`). Leaves the part's values wherever the trial put
   * them; the caller puts them back.
   */
  private trial(ctx: SolveContext, part: Part, rels: readonly RelationEntry[], background: readonly BlockHandle[]): { fails: boolean; fell: string[] } {
    const only = new Set(background);
    for (const r of rels) for (const b of r.blocks) only.add(b);
    this.problem.restore(ctx.before, part.vars);
    let report = this.problem.solve({ only });
    let fell = this.collapsedNow(ctx, part.entities, only);
    if (fell.length) {
      this.problem.restore(ctx.before, part.vars);
      report = this.steered(ctx, only, part.entities);
      fell = this.collapsedNow(ctx, part.entities, only);
    }
    return { fails: !report.solved, fell };
  }

  /** A connected part of the drawing (`Problem.connected`), with the entities measured in it. */
  private partOf(seed: Iterable<number>): Part {
    const c = this.problem.connected(seed);
    const varSet = new Set(c.vars);
    return { vars: c.vars, varSet, blocks: c.blocks, entities: this.entitiesIn(varSet) };
  }

  /**
   * **The user's own zeros**: of the collapsed measures `fell`, those one
   * relation alone sets to zero — tried alone from the state before
   * (`trial`), with only what no one can delete beside it (an entity's own
   * equations, a feature's relations), it collapses the measure too, steered
   * or not. `dist(p, q, 0)` on a line's ends does; a `par` and a `perp` on two
   * lines each alone do not, and only together. Added to `ctx.exempt`. The
   * values are left as the solve left them.
   */
  private ownZeros(ctx: SolveContext, fell: string[]): void {
    const after = this.problem.snapshot();
    const owner = this.blockOwners();
    try {
      for (const name of new Set(fell.map(measureEntity))) {
        const keys = fell.filter((k) => measureEntity(k) === name);
        const own = new Set(this.varsOfEntity(name));
        const part = this.partOf(own);
        const background = part.blocks.filter((b) => { const r = owner.get(b); return r === undefined || !this.removable(r); });
        const touching = [...this.relations.values()].filter((r) => this.removable(r.name)
          && r.blocks.some((b) => this.problem.varsOf(b).some((v) => own.has(v))));
        for (const r of touching) {
          for (const k of this.trial(ctx, part, [r], background).fell) if (keys.includes(k)) ctx.exempt.add(k);
          if (keys.every((k) => ctx.exempt.has(k))) break;
        }
      }
    } finally {
      this.problem.restore(after);
    }
  }

  /** Which variables each entity owns — its own, not those of the points it refers to. */
  private ownVars(e: Entity): number[] {
    switch (e.kind) {
      case "point": return e.varIndices;
      case "circle":
      case "arc": return [e.radiusVar, ...(e.normal ?? [])];
      // A declared kind says what it owns (`EntityKindSpec.vars`); a line or a
      // frame owns nothing.
      default: return entityKind((e as { kind: string }).kind)?.vars?.(e) ?? [];
    }
  }

  /**
   * **What is free, and what is said twice** (docs/plans/sketch-relations.md):
   * the problem's rank analysis (`Problem.analyse`, which knows no entity)
   * mapped back to the names a person sees.
   *
   * **Free**: an entity is free when any variable it owns or refers to — a
   * point's coordinates, a line's two ends, a curve's centre, ends, radius
   * and normal, a frame's points — moves in some motion that leaves every
   * relation satisfied. `dof` counts those motions. Only live entities'
   * variables are asked about: the problem never forgets a variable, and a
   * deleted point's would otherwise count as a freedom.
   *
   * **Two gauges are not counted as freedoms**, and they are the only place
   * this is a choice rather than arithmetic:
   *
   * - **A curve's normal is a direction** (frameless-curves.md): every
   *   residual reads it normalised, so its length is free by construction
   *   and nothing could ever hold it. One gauge row along the normal itself.
   * - **A point lying on the drawing plane, or on the ground, is not free off
   *   it.** A sketch drawn on the ground in a fresh document holds no point
   *   there (`holdOnSketchPlane` only holds them on a plane the user chose),
   *   and the solver never moves one off it — so a fully dimensioned
   *   rectangle on the ground would otherwise read free forever in z, which
   *   is not what a sketcher means by free and not what Onshape says. A point
   *   *off* both planes — 3D geometry proper — is counted in full. Vetoable,
   *   in TODO.md.
   *
   * **Redundant**: a relation every row of which the rows stored before it
   * already imply — consistent, and saying nothing new. Reported, never
   * refused: the later of two ways of saying one thing is the one named, which
   * is the one just added. A relation with some rows new and some implied
   * (a 3D `par`'s third wedge component, an `oncircle`'s plane row beside an
   * `onplane`) is not redundant — only the whole relation is a thing a person
   * can delete.
   *
   * Asked after a solve, not during a drag: it costs one Jacobian and two
   * eliminations (`ms` says how long), which is several solves' worth.
   */
  diagnose(): Diagnosis {
    const t0 = performance.now();
    const live: number[] = [];
    const gauge: GaugeRow[] = [];
    const planes = this.dim === 3 ? this.gaugePlanes() : [];
    for (const e of this.entities.values()) {
      live.push(...this.ownVars(e));
      const normal = e.kind === "circle" || e.kind === "arc" ? e.normal : entityKind(e.kind)?.plane?.(e).normal;
      if (normal) {
        gauge.push({ vars: normal, coeffs: normal.map((i) => this.problem.getVar(i)) });
        // A plane straightened against an axis of its own reads nothing of the
        // normal's part along that axis — a second gauge, as the frame's y-ref
        // has one along +x.
        const along = e.kind === "circle" || e.kind === "arc" ? undefined : entityKind(e.kind)?.plane?.(e).straighten;
        const center = along === undefined ? undefined : entityKind(e.kind)!.plane!(e).center;
        if (along !== undefined && center !== undefined) {
          gauge.push({ vars: normal, coeffs: unitOf(this.coords(along).map((v, i) => v - this.coords(center)[i])) });
        }
      }
      if (e.kind === "point" && planes.length) {
        const p = e.varIndices.map((i) => this.problem.getVar(i));
        const on = planes.find((pl) => Math.abs(pl.n.reduce((s, c, k) => s + c * (p[k] - pl.origin[k]), 0)) < 1e-6);
        if (on) gauge.push({ vars: e.varIndices, coeffs: on.n });
      }
    }
    // A relation's own variables (a point's parameter along a spline) are
    // freedoms like any entity's: its rows hold them, or they are free.
    for (const r of this.relations.values()) if (r.vars) live.push(...r.vars);
    const a = this.problem.analyse({ vars: live, gauge });
    const freeVars = new Set(a.free);
    const pointFree = (name: string) => this.entities.get(name)?.kind === "point"
      && (this.entities.get(name) as PointEntity).varIndices.some((i) => freeVars.has(i));
    const free = new Set<string>();
    for (const e of this.entities.values()) {
      const own = this.ownVars(e).some((i) => freeVars.has(i));
      if (own || this.refsOf(e).some(pointFree)) free.add(e.name);
    }
    const dependent = new Map(a.dependent.map((d) => [d.block, d]));
    const redundant: string[] = [];
    // Redundant is said only of a state with nothing collapsed: at a line of
    // zero length every direction row on it vanishes, and a vanished row reads
    // as implied (docs/plans/conflict-detection.md). A relation reading a
    // folded entity is called neither; `solve` puts a collapse back, so this
    // is a drawing drawn folded, or one the user's own zero folded.
    const floor = COLLAPSE * this.extent();
    const folded = new Set<number>();
    for (const e of this.entities.values()) {
      if (e.kind !== "point" && this.measuresOf(e).some((m) => !(this.sizeAt(m) > floor))) for (const v of this.varsOfEntity(e.name)) folded.add(v);
    }
    for (const r of this.relations.values()) {
      if (!r.blocks.length) continue;
      if (folded.size && r.blocks.some((b) => this.problem.varsOf(b).some((v) => folded.has(v)))) continue;
      if (r.blocks.every((b) => { const d = dependent.get(b); return d !== undefined && d.dependent === d.rows; })) {
        redundant.push(r.name);
      }
    }
    return { dof: a.dof, free, redundant, ms: performance.now() - t0 };
  }

  /** The planes a point lying in is not counted free off: the drawing plane, and the ground. See `diagnose`. */
  private gaugePlanes(): { origin: number[]; n: number[] }[] {
    const out: { origin: number[]; n: number[] }[] = [{ origin: [0, 0, 0], n: [0, 0, 1] }];
    try {
      const pl = this.planeValues(this.drawingPlane());
      if (pl && pl.n.some((c) => c !== 0)) out.push({ origin: pl.origin, n: pl.n });
    } catch {
      // a plane that cannot be read is one nothing lies in
    }
    return out;
  }

  /**
   * **Which relations cannot all hold**, named minimally
   * (docs/plans/conflict-detection.md): for a failed or collapsing solve from
   * `solve`, an **irreducible conflicting set** in each part of the drawing
   * that failed. Every relation named is needed: without it the rest solve
   * from the state before with nothing collapsed. So a `par` and a `perp` on
   * one pair of lines are named, and nothing else on the rectangle; a loop of
   * three perpendiculars is named whole, however long the chain.
   *
   * **How**: QuickXplain (Junker, 2004) over the relations a person can delete
   * in the failed part (the connected component of what failed,
   * `Problem.connected`). Each question is a `trial`: that part alone, from
   * the state before, with only the relations asked about and what no one can
   * delete (an entity's own equations, a feature's relations, a block no
   * relation owns). A conflict of k relations among n costs about
   * 2k·log₂(n/k) + 2k trials, not n. Where a part holds more than one
   * irreducible conflict (a rectangle's par holds against the perp on its own
   * corner and, through the far corners, against the other two), the one named
   * is the one **nearest what failed**: candidates are ordered by how many
   * blocks away from the collapsed entity or the failing rows they are
   * (`Problem.reach`), then newest first, and QuickXplain keeps the earliest.
   *
   * Bounded by `SEARCH_TRIALS` and `SEARCH_MS`: past either, or if the part
   * alone does not reproduce the failure, the part is named as it was before
   * this search existed, by the relations whose blocks stayed large or touch
   * what collapsed.
   *
   * A report `solve` did not make (a bare `problem.solve()`) is named the old
   * way too. A block no relation owns (one added straight to the problem at
   * the command line) is named by its label in `unowned`. The values are left
   * exactly as the solve left them.
   */
  conflicting(report: SolveReport): { relations: string[]; unowned: string[] } {
    const owner = this.blockOwners();
    const unowned = [...new Set(report.blocks.filter((b) => !owner.has(b)).map((b) => this.problem.labelOf(b) ?? `block ${b}`))];
    const accused = (blocks: Iterable<BlockHandle>) => {
      const out: string[] = [];
      for (const b of blocks) {
        const name = owner.get(b);
        if (name !== undefined && !out.includes(name)) out.push(name);
      }
      return out;
    };
    const ctx = this.solves.get(report);
    const collapsed = (report as Partial<ModelSolveReport>).collapsed ?? [];
    if (!ctx || report.solved) return { relations: accused(report.blocks), unowned };
    const now = this.problem.snapshot();
    const t0 = performance.now();
    let trials = 0;
    const relations: string[] = [];
    const seeds = [...report.blocks.map((b) => this.problem.varsOf(b)), ...collapsed.map((n) => this.varsOfEntity(n))];
    try {
      for (const part of this.failedParts(seeds)) {
        const inPart = [...this.relations.values()].filter((r) => r.blocks.some((b) => part.blockSet.has(b)));
        // Nearest what failed first, then newest.
        const reach = this.problem.reach(seeds.filter((s) => s.some((v) => part.varSet.has(v))).flat());
        // A relation naming what folded is nearest of all: on a closed outline
        // every relation reads the folded side's corners, and only some are
        // about the side itself.
        const rank = (r: RelationEntry) => (collapsed.some((n) => r.args.some((a) => argRefersTo(a, n))) ? -1
          : Math.min(...r.blocks.map((b) => reach.get(b) ?? Infinity)));
        const order = new Map(inPart.map((r, i) => [r.name, i]));
        const byNearness = (rs: RelationEntry[]) => [...rs].sort((a, b) => rank(a) - rank(b) || order.get(b.name)! - order.get(a.name)!);
        const conflicts = (rels: readonly RelationEntry[], background: readonly BlockHandle[]): boolean => {
          if (++trials > SEARCH_TRIALS || performance.now() - t0 > SEARCH_MS) throw SEARCH_SPENT;
          const t = this.trial(ctx, part, rels, background);
          return t.fails || t.fell.some((k) => !ctx.exempt.has(k));
        };
        const outside = (rels: readonly RelationEntry[]) => {
          const mine = new Set(rels.flatMap((r) => r.blocks));
          return part.blocks.filter((b) => !mine.has(b));
        };
        let candidates = byNearness(inPart.filter((r) => this.removable(r.name)));
        let background = outside(candidates);
        let found: RelationEntry[] | null = null;
        try {
          // What no one can delete conflicting by itself is named among all of them.
          if (conflicts([], background)) {
            candidates = byNearness(inPart);
            background = outside(candidates);
          }
          if (conflicts(candidates, background)) found = quickXplain(candidates, (s) => conflicts(s, background));
        } catch (e) {
          if (e !== SEARCH_SPENT) throw e;
        }
        if (found) {
          for (const r of found) if (!relations.includes(r.name)) relations.push(r.name);
          continue;
        }
        // Past the bound, or not reproduced alone: named as before the search.
        const touching = new Set(collapsed.flatMap((n) => this.varsOfEntity(n)));
        const fallback = [
          ...accused(report.blocks.filter((b) => part.blockSet.has(b))),
          ...inPart.filter((r) => this.removable(r.name) && r.blocks.some((b) => this.problem.varsOf(b).some((v) => touching.has(v)))).map((r) => r.name),
        ];
        for (const n of fallback) if (!relations.includes(n)) relations.push(n);
      }
    } finally {
      this.problem.restore(now);
    }
    return { relations, unowned };
  }

  /**
   * The parts of the drawing a failed solve failed in: the connected
   * components (`Problem.connected`) of each seed (a block that stayed large,
   * an entity that collapsed), merged where they meet. An entity's points need
   * not be connected by any block (a line holds none of its own), so an
   * entity's part is the union of its variables' components.
   */
  private failedParts(seeds: readonly number[][]): (Part & { blockSet: Set<BlockHandle> })[] {
    const parts: (Part & { blockSet: Set<BlockHandle> })[] = [];
    for (const seed of seeds) {
      if (!seed.length || parts.some((p) => seed.every((v) => p.varSet.has(v)))) continue;
      const part = this.partOf(seed);
      // A component is whole or disjoint, so a part meeting another holds it.
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].vars.some((v) => part.varSet.has(v))) parts.splice(i, 1);
      parts.push({ ...part, blockSet: new Set(part.blocks) });
    }
    return parts;
  }
}
/**
 * **ε**: how small a measure must end, as a share of the drawing's size L, to
 * have collapsed (`Model.solve`). Measured (docs/plans/conflict-detection.md):
 * once pushed (`collapsedNow`), every collapse the plan's examples make ends
 * at or below 1e-9·L, and a size a relation sets stays where it is set. 1e-6
 * sits between with room each way: 0.1 µm on a 100 mm drawing.
 */
export const COLLAPSE = 1e-6;

/**
 * Below this share of L, and below a tenth of what it was, a measure is a
 * **suspect**: pushed to see whether it goes on to nothing (`collapsedNow`),
 * and enough by itself to stop a drag's frame (`solveFrame`). A collapse a
 * residual meets quadratically stalls near 4e-5·L before it is pushed.
 */
export const SUSPECT = 1e-2;

/** How far a suspect must have fallen, as a share of what it was. */
const SHRINK = 0.1;

/** How hard `collapsedNow` pushes a suspect toward nothing: a size of L weighs as a residual of 1. */
const PUSH = 1;

/** How hard `steered` pulls each size toward what it was: a relative change of 1 weighs as a residual of 1. */
const STEER = 1;

/** The conflict search's bounds: trial solves, and milliseconds, per `conflicting` call. */
export const SEARCH_TRIALS = 200;
export const SEARCH_MS = 500;
const SEARCH_SPENT = new Error("the conflict search ran out of trials");

/** The entity a `name#k` measure key is of. */
function measureEntity(key: string): string {
  return key.slice(0, key.lastIndexOf("#"));
}

/**
 * **QuickXplain** (Junker 2004): an irreducible subset of `items` for which
 * `conflicts` holds, given that it holds for all of them. Prefers the earlier
 * items: where the first half already conflicts, the second is never asked
 * about. `conflicts` must be monotone (a superset of a conflict conflicts),
 * which a trial solve is as nearly as a local solver can be.
 */
export function quickXplain<T>(items: readonly T[], conflicts: (set: T[]) => boolean): T[] {
  const go = (background: T[], asked: boolean, cands: readonly T[]): T[] => {
    if (asked && conflicts(background)) return [];
    if (cands.length === 1) return [cands[0]];
    const k = Math.floor(cands.length / 2);
    const [c1, c2] = [cands.slice(0, k), cands.slice(k)];
    const d2 = go([...background, ...c1], c1.length > 0, c2);
    const d1 = go([...background, ...d2], d2.length > 0, c1);
    return [...d1, ...d2];
  };
  return items.length ? go([], false, items) : [];
}

/** What a solve left behind for `conflicting` to explain. See `Model.solves`. */
interface SolveContext {
  /** Every variable's value before the solve. */
  before: number[];
  /** The drawing's size before the solve (`Model.extent`). */
  L: number;
  /** The measures (`name#k`) a relation of the user's own sets to zero (`Model.ownZeros`). */
  exempt: Set<string>;
}

/** A connected part of the drawing: its variables and blocks (`Problem.connected`), and the entities measured in it. */
interface Part {
  vars: number[];
  varSet: Set<number>;
  blocks: BlockHandle[];
  entities: string[];
}

/** What `Model.solve` found: the kernel's report, and what the solve would have collapsed. */
export interface ModelSolveReport extends SolveReport {
  /** The entities the solve would have collapsed, put back where they were: why `solved` is false. Empty when none. */
  collapsed: string[];
}

/** What `Model.diagnose` found. */
export interface Diagnosis {
  /** Independent ways the drawing can still move with every relation holding. */
  dof: number;
  /** The entities some such motion moves. */
  free: Set<string>;
  /** Relations every row of which the relations before them already imply. */
  redundant: string[];
  /** How long it took, in milliseconds. */
  ms: number;
}
