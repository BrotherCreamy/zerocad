// The ellipse's **structure** (docs/plans/sketch-shapes.md), as the sketch
// module declares it through the entity extension point
// (docs/plans/workbenches.md). It sits at the model's height — it imports the
// model and nothing above it — so the relations that read an ellipse can import
// it, as they import the model. What the layers above ask of it (its frame,
// its hover line, its STEP spelling) is declared beside its tool in
// modules/sketch.ts. model.ts never names it: the proof the extension point is
// real is that `grep ellipse src/model.ts src/loops.ts src/faces.ts
// src/picking.ts src/step.ts` is empty (test/modules.test.ts holds it).

import { Model, spanOf, unitOf, entityKind, distanceMeasure, type EntityKindSpec, type Entity } from "../model.ts";

/**
 * An ellipse: a centre point, a **major end** point — the end of its first
 * axis, which gives that axis's direction and its semi-length `a` as the
 * distance from the centre — one variable for the **minor semi-axis** `b`, and
 * in a 3D model three normal variables, as a circle has. The first curve kind
 * that is not a circle.
 *
 * Why a point and not an angle: the major end is an ordinary point, so it can
 * be dragged, snapped to, `coin`ed and dimensioned like any other, and the
 * relations that read the ellipse need no trigonometry — the major direction
 * is `major − centre`, read through `dot`. `b` is a plain variable, as a
 * radius is, so `minor(e, 10)` is the one-variable dimension `rad` is.
 *
 * **The normal is straightened, not obeyed** — `frameBasis`'s y-ref rule. The
 * plane is the one through the centre containing the major axis and the
 * normal's part square to it (`ellipseNormal` in relations/refs.ts), so a
 * normal tipped toward the major axis turns nothing and no relation is needed
 * to keep the major end in the plane. A tool holds it on its sketch plane as a
 * circle is held (`onplane` on the centre and the major end, `par` on the
 * normal). In 2D it has no normal and its minor axis is the major turned a
 * quarter turn counter-clockwise.
 *
 * Nothing says `a ≥ b`: "major" names the axis the point is on, and a minor
 * dimensioned past it is an ellipse drawn the other way round, as legal as a
 * rectangle taller than it is wide.
 */
export interface EllipseEntity {
  kind: "ellipse";
  name: string;
  center: string;
  /** The end of the first (major) axis: a point name. */
  major: string;
  /** The minor semi-axis's variable. */
  minorVar: number;
  /** 3D only: the normal's three variables, read straightened against the major axis. Absent in 2D. */
  normal?: number[];
  /** Construction geometry: forms no regions. Absent when not. */
  construction?: true;
}

/**
 * **An elliptical arc** (docs/plans/trim-everything.md): the piece of an
 * ellipse a trim leaves — an ellipse's centre, major end, minor variable and
 * normal, and two **end points** it runs between, counter-clockwise about its
 * normal from `start` to `end`, as an arc runs. What a trimmed ellipse becomes
 * under its own name, as a trimmed circle becomes an arc, so every relation on
 * it (`major`, `minor`, `conc`, `tan`, `onellipse`) reads the same variables
 * and means what it meant.
 *
 * Like an arc, nothing in the entity holds its ends on its curve: that is the
 * two `onellipse` relations a trim adds, which a person can see and delete —
 * an arc's `arcends`, said twice. The ends run in its own direction, so a
 * region walks it as it walks an arc.
 */
export interface EllipticArcEntity {
  kind: "earc";
  name: string;
  center: string;
  major: string;
  minorVar: number;
  normal?: number[];
  /** Where it starts, and where it ends — counter-clockwise about its normal. */
  start: string;
  end: string;
  construction?: true;
}

/** Either conic: what every relation on an ellipse reads — a centre, a major end, a minor, a normal — which an elliptical arc has too. */
export type ConicEntity = EllipseEntity | EllipticArcEntity;

// The ellipse joins the model's `Entity` union by declaration merging, so every
// `switch (e.kind)` above the model narrows to it as it does to a circle —
// without model.ts naming it.
declare module "../model.ts" {
  interface EntityTypes {
    ellipse: EllipseEntity;
    earc: EllipticArcEntity;
  }
}

/** The ellipse's structure: what the model asks of the kind (`EntityKindSpec`). */
export const ELLIPSE_STRUCTURE: EntityKindSpec = {
  kind: "ellipse",
  noun: "an ellipse",
  refs: (e) => { const el = e as EllipseEntity; return [el.center, el.major]; },
  // Its minor and its normal: counted by the diagnosis as a circle's radius and
  // normal are (before the extension point they were not, and an ellipse whose
  // minor nothing held read as held).
  vars: (e) => { const el = e as EllipseEntity; return [el.minorVar, ...(el.normal ?? [])]; },
  // What a translation keeps equal beyond its points: the minor (profiles-held.md).
  sizes: (e) => [(e as EllipseEntity).minorVar],
  curve: true,
  closed: true,
  plane: (e) => { const el = e as EllipseEntity; return { center: el.center, normal: el.normal, straighten: el.major }; },
  heldBy: ["onEllipse"],
  bounds: (model, name) => { const { a, b } = semiAxes(model, name); return a > 0 && b > 0; },
  // Its two semi-axes: either at nothing is no ellipse (docs/plans/conflict-detection.md).
  measures: (model, e) => {
    const el = e as EllipseEntity;
    return [
      distanceMeasure(model.point(el.center).varIndices, model.point(el.major).varIndices),
      { vars: [el.minorVar], size: (l) => l[0].abs() },
    ];
  },
};

/**
 * The elliptical arc's structure: an ellipse's, with two ends — open, so a
 * region walks it end to end as it walks an arc, and `del` of an end takes it.
 */
export const EARC_STRUCTURE: EntityKindSpec = {
  kind: "earc",
  noun: "an elliptical arc",
  refs: (e) => { const el = e as EllipticArcEntity; return [el.center, el.major, el.start, el.end]; },
  vars: (e) => { const el = e as EllipticArcEntity; return [el.minorVar, ...(el.normal ?? [])]; },
  sizes: (e) => [(e as EllipticArcEntity).minorVar],
  curve: true,
  closed: false,
  ends: (e) => { const el = e as EllipticArcEntity; return [el.start, el.end]; },
  plane: (e) => { const el = e as EllipticArcEntity; return { center: el.center, normal: el.normal, straighten: el.major }; },
  heldBy: ["onEllipse"],
  bounds: (model, name) => { const { a, b } = semiAxes(model, name); return a > 0 && b > 0; },
  measures: (model, e) => ELLIPSE_STRUCTURE.measures!(model, e),
};

/** The refusals `addEllipse` makes about its own arguments, made first so a refused call leaves nothing behind. */
export function checkEllipse(model: Model, center?: string | null, major?: string | null, minor?: number | null): void {
  if (center != null) model.point(center);
  if (major != null) model.point(major);
  if (center != null && center === major) throw new Error("an ellipse needs its major end apart from its centre");
  if (minor != null && !(minor > 0)) throw new Error("an ellipse needs a positive minor semi-axis");
  if (model.dim !== 2 && model.dim !== 3) throw new Error(`an ellipse lies in a plane — a ${model.dim}D model has none to give it`);
  if (!entityKind("ellipse")) throw new Error("the ellipse is the sketch module's, and it is not loaded");
}

/**
 * An ellipse about `center` with its major axis ending at `major` and a
 * minor semi-axis of `minor` — and, in 3D, facing `normal` (seeded exactly
 * as `addCircle` seeds it). Missing pieces seed a non-degenerate ellipse: a
 * centre at the origin, a major end `FREE_SPAN` along the plane's first
 * direction, a minor of half the major. Seeds and nothing more, as every
 * constructor's are. Journalled as `addEllipse`.
 */
export function addEllipse(model: Model, center?: string | null, major?: string | null, minor?: number | null,
  normal?: number[] | string | null, name?: string | null): EllipseEntity {
  checkEllipse(model, center, major, minor);
  const seed = model.normalSeed("ellipse", normal);
  const [nm, [c, m]] = model.claimFirst("el", name, () => {
    const c = center ?? model.withoutRecording(() => model.addPoint()).name;
    if (major != null) return [c, major];
    const along = seed == null ? null : spanOf(unitOf(seed))[0];
    const m = along
      ? model.withoutRecording(() => model.addPoint(model.coords(c).map((v, i) => v + Model.FREE_SPAN * along[i]))).name
      : model.freePointOffset(model.coords(c), 0, Model.FREE_SPAN).name;
    return [c, m];
  });
  const a = Math.hypot(...model.coords(m).map((v, i) => v - model.coords(c)[i]));
  const ent: EllipseEntity = {
    kind: "ellipse", name: nm, center: c, major: m,
    minorVar: model.problem.addVar(minor ?? (a > 0 ? a / 2 : Model.FREE_SPAN / 2)),
  };
  if (seed != null) ent.normal = seed.map((v) => model.problem.addVar(v));
  model.place(ent as unknown as Entity);
  model.record("addEllipse", [center ?? null, major ?? null, minor ?? null, normal ?? null, nm]);
  return ent;
}

/**
 * The ellipse called `name` — or the elliptical arc, which every relation on
 * an ellipse reads the same way (its centre, major end, minor and normal) —
 * or a refusal saying it is neither.
 */
export function ellipseOf(model: Model, name: string): ConicEntity {
  const e = model.entities.get(name);
  if (!e || (e.kind !== "ellipse" && e.kind !== "earc")) throw new Error(`"${name}" is not an ellipse`);
  return e;
}

/** Whether `name` is an ellipse or an elliptical arc: what `onellipse`, `tan`, `major` and `minor` take. */
export function isConic(model: Model, name: string): boolean {
  const k = model.entities.get(name)?.kind;
  return k === "ellipse" || k === "earc";
}

/** The refusals `addEllipticArc` makes, before it makes anything. */
function checkEllipticArc(model: Model, center: string, major: string, start: string, end: string): void {
  checkEllipse(model, center, major, null);
  for (const p of [start, end]) model.point(p);
  if (start === end) throw new Error("an elliptical arc needs two different ends");
  if ([start, end].some((p) => p === center || p === major)) throw new Error("an elliptical arc's ends are its own points — not its centre or its major end");
  if (!entityKind("earc")) throw new Error("the elliptical arc is the sketch module's, and it is not loaded");
}

/**
 * An elliptical arc about `center` with its major axis ending at `major`, a
 * minor semi-axis of `minor`, from `start` round to `end` — and, in 3D,
 * facing `normal`, seeded as an ellipse's is. Holds nothing: its ends are put
 * on it by the relations its maker adds (`onellipse`), as an arc's are by
 * `arcends`. Journalled as `addEllipticArc`; named `ea1`, `ea2`, ….
 */
export function addEllipticArc(model: Model, center: string, major: string, minor: number, start: string, end: string,
  normal?: number[] | string | null, name?: string | null): EllipticArcEntity {
  checkEllipticArc(model, center, major, start, end);
  if (!(minor > 0)) throw new Error("an elliptical arc needs a positive minor semi-axis");
  const seed = model.normalSeed("earc", normal);
  const [nm] = model.claimFirst("ea", name, () => null);
  const ent: EllipticArcEntity = { kind: "earc", name: nm, center, major, minorVar: model.problem.addVar(minor), start, end };
  if (seed != null) ent.normal = seed.map((v) => model.problem.addVar(v));
  model.place(ent as unknown as Entity);
  model.record("addEllipticArc", [center, major, minor, start, end, normal ?? null, nm]);
  return ent;
}

/**
 * **An ellipse becomes an elliptical arc under its own name**, from `start`
 * round to `end` — what a trim of an ellipse leaves, as `circleToArc` is a
 * circle's. Its centre, major end, minor and normal are the ellipse's own
 * variables, so every relation on it goes on meaning what it meant; in place
 * in the registry, so its position and every name after it are unchanged. A
 * primitive inside the trim's own operation: it journals nothing.
 */
export function ellipseToArc(model: Model, name: string, start: string, end: string): void {
  const e = model.entities.get(name);
  if (e?.kind !== "ellipse") throw new Error(`"${name}" is not an ellipse`);
  checkEllipticArc(model, e.center, e.major, start, end);
  const arc: EllipticArcEntity = { kind: "earc", name, center: e.center, major: e.major, minorVar: e.minorVar, start, end };
  if (e.normal !== undefined) arc.normal = e.normal;
  if (e.construction) arc.construction = true;
  model.entities.set(name, arc);
}

/**
 * Points one end of an elliptical arc at a different point — `retargetArc` for
 * an elliptical arc, what a trim at one end does. Returns the point it ended
 * at before. A primitive inside the trim's own operation: it journals nothing.
 */
export function retargetEllipticArc(model: Model, name: string, which: "start" | "end", to: string): string {
  const e = model.entities.get(name);
  if (e?.kind !== "earc") throw new Error(`"${name}" is not an elliptical arc`);
  model.point(to);
  const other = which === "start" ? e.end : e.start;
  if (other === to) throw new Error("an elliptical arc needs two different ends");
  if (to === e.center || to === e.major) throw new Error(`"${to}" is ${name}'s ${to === e.center ? "centre" : "major end"}, not a point on it`);
  const from = e[which];
  e[which] = to;
  return from;
}

/** `ellipseToArc` taken back — for a trim that tried and refuses. Its ends are left as the points they are. */
export function arcToEllipse(model: Model, name: string): void {
  const e = model.entities.get(name);
  if (e?.kind !== "earc") throw new Error(`"${name}" is not an elliptical arc`);
  const el: EllipseEntity = { kind: "ellipse", name, center: e.center, major: e.major, minorVar: e.minorVar };
  if (e.normal !== undefined) el.normal = e.normal;
  if (e.construction) el.construction = true;
  model.entities.set(name, el);
}

/** An ellipse's semi-axes as they stand: `a` the centre-to-major-end distance, `b` its minor variable. */
export function semiAxes(model: Model, name: string): { a: number; b: number } {
  const e = ellipseOf(model, name);
  const a = Math.hypot(...model.coords(e.major).map((v, i) => v - model.coords(e.center)[i]));
  return { a, b: model.problem.getVar(e.minorVar) };
}
