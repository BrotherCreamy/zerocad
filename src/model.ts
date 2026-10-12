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

import { Problem, type BlockHandle, type SolveReport, type VarRefs } from "./kernel/problem.ts";
import type { Dual } from "./kernel/dual.ts";

export interface PointEntity {
  kind: "point";
  name: string;
  varIndices: number[]; // one per dimension
}

export interface LineEntity {
  kind: "line";
  name: string;
  refs: [string, string]; // two point names — purely referential, owns no variables
}

/**
 * A circle: a center point, one variable of its own (the radius) and — in a 3D
 * model — the **plane** it lies in, as a reference to a frame.
 *
 * In 2D every circle lies in the one plane there is, so it has no `plane` and
 * refuses one. In 3D a circle without a plane would be a sphere, and spheres
 * are not what a sketcher draws, so a 3D circle always carries one: the frame
 * named, or the default frame resolved **at call time and journalled
 * resolved** (`fix`'s rule), and no frame at all is refused with the standing
 * message.
 *
 * **What the plane means — and what it does not.** The frame is read for its
 * *orientation* and nothing else. The circle's rim is the circle of radius r
 * in the plane **through the circle's own centre, parallel to the frame's x–y
 * plane**. The centre is *not* held on the frame's plane: a constructor never
 * constrains (the free-entities rule — an argument is never a constraint), so
 * a circle whose centre is dragged off the frame's surface carries its rim with
 * it, parallel, rather than being pulled back. A tool that draws a circle *on*
 * a sketch holds its centre there with an ordinary `onPlane`, which can be
 * read, hovered and deleted like any other relation. The plane orients the
 * drawing (the rim projects as the ellipse it is), the picking and snapping,
 * and the relations that read the rim — `onCircle` and `tangent` in 3D are
 * claims about this planar rim, not about a sphere.
 *
 * Like a line's points the frame is a *reference*: deleting the frame takes
 * the circle with it, because the circle cannot be without one (see
 * `Model.dependents`). It is not a variable the circle owns — a frame is a
 * datum, read and never pushed (see `frameBasis`).
 */
export interface CircleEntity {
  kind: "circle";
  name: string;
  center: string; // a point name
  radiusVar: number; // the one variable a circle owns
  /** 3D only: the frame whose x–y plane the rim is parallel to. Absent in 2D. */
  plane?: string;
}

/**
 * An arc is a circle that also names where it starts and ends. The endpoints
 * are ordinary points, so they can be constrained (coincident with a line's
 * end, say) like any other. What makes them *arc* endpoints — lying on the
 * arc's own circle — is not automatic: it's the `arcEndpoints` relation, for
 * the same reason a Line implies no relation of its own. Tools that create
 * arcs are expected to apply it (see relations/geometry.ts).
 *
 * In 3D an arc carries a plane exactly as a circle does — same resolution,
 * same refusal, same reading — and the frame's +z is also what says which of
 * the two arcs between its endpoints it is: the sweep runs counter-clockwise
 * from `start` to `end` about that +z (see arcgeom.ts). Before arcs carried a
 * plane that side came from the kernel's axes, which was the gauge showing
 * through; files from then are translated on the way in (see persist.ts).
 */
export interface ArcEntity {
  kind: "arc";
  name: string;
  center: string;
  start: string;
  end: string;
  radiusVar: number;
  /** 3D only: the frame whose x–y plane the arc is parallel to, and whose +z it turns about. */
  plane?: string;
}

/**
 * A coordinate frame: an origin point plus a point fixing the +x direction —
 * and, in a 3D model, a third point fixing which way +y goes.
 *
 * There is no built-in world frame in this model, and that absence is the
 * point — an origin nobody made tempts every drawing into being related to
 * it. A frame exists only because a user made one, and `fix` — and every
 * reference to an axis — means nothing until one does.
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

export type Entity = PointEntity | LineEntity | CircleEntity | ArcEntity | FrameEntity;

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
export const DIMENSION_OPS: ReadonlySet<string> = new Set(["dist", "radius", "angle"]);

/** Which index of a dimension's recorded `args` holds its value. */
const VALUE_ARG: Record<string, number> = { dist: 2, radius: 1, angle: 2 };

/** The name prefix a relation made by `op` claims. See `DIMENSION_OPS`. */
export function relationPrefix(op: string): string {
  return DIMENSION_OPS.has(op) ? "d" : "r";
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

/** Whether one recorded argument refers to the entity called `name`. */
export function argRefersTo(arg: unknown, name: string): boolean {
  return referentOf(arg) === name;
}

/** Circles and arcs share a center + radius (+ plane, in 3D); relations that only need those treat them alike. */
export interface CircularRef {
  name: string;
  center: string;
  radiusVar: number;
  /** The frame the rim is parallel to, in a 3D model. See `CircleEntity`. */
  plane?: string;
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
}

export class Model {
  problem = new Problem();
  dim: number;
  entities = new Map<string, Entity>();
  /** Named relations, in the order they were made. See `relation()`. */
  relations = new Map<string, RelationEntry>();
  /**
   * Which frame `fix`, `onPlane` and the `xaxis()`/`yaxis()`/`zaxis()` helpers
   * mean when they are not told which. Null in a new model, and stays null
   * until someone makes a frame and says so — see `setDefaultFrame`.
   */
  defaultFrame: string | null = null;
  private counters = new Map<string, number>();
  /**
   * The relation currently being built, if any — see `relation()`. Its
   * presence is also what tells a nested relation call that it is nested.
   */
  private building: { name: string; blocks: BlockHandle[] } | null = null;

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
  asOperation<T>(op: string, args: unknown[], body: () => T): T {
    const result = this.withoutRecording(body);
    this.record(op, args);
    return result;
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
   * Whether anything already answers to `name`. Entities and relations share
   * one namespace on purpose: `del("r3")` has to mean one thing, and a model
   * holding both a point and a relation called `r3` would make it mean two.
   */
  has(name: string): boolean {
    return this.entities.has(name) || this.relations.has(name);
  }

  private autoName(prefix: string): string {
    let n = this.counters.get(prefix) ?? 0;
    let name: string;
    do {
      n += 1;
      name = `${prefix}${n}`;
    } while (this.has(name));
    this.counters.set(prefix, n);
    return name;
  }

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
    const building = { name, blocks: [] as BlockHandle[] };
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
    this.relations.set(name, { name, op, args, blocks: building.blocks });
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
    const building = { name, blocks: [] as BlockHandle[] };
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
    this.relations.set(name, { name, op, args, blocks: building.blocks });
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

  relationOf(name: string): RelationEntry {
    const r = this.relations.get(name);
    if (!r) throw new Error(`"${name}" is not a relation`);
    return r;
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
    this.entities.set(nm, ent);
    this.record("addPoint", [coords ?? null, nm]);
    return ent;
  }

  /** A point along axis `axis` from `from`, for seeding auto-created pieces. */
  private freePointOffset(from: number[], axis: number, by: number): PointEntity {
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
    let a = aGiven, b = bGiven;
    if (a == null && b == null) {
      a = this.withoutRecording(() => this.addPoint()).name;
      b = this.freePointOffset(this.coords(a), 0, span).name;
    } else if (b == null) {
      b = this.freePointOffset(this.coords(a!), 0, span).name;
    } else if (a == null) {
      a = this.freePointOffset(this.coords(b), 0, -span).name;
    }
    const nm = this.claimName("l", name ?? undefined);
    const ent: LineEntity = { kind: "line", name: nm, refs: [a!, b!] };
    this.entities.set(nm, ent);
    this.record("addLine", [aGiven ?? null, bGiven ?? null, nm]);
    return ent;
  }

  /**
   * A circle about `center` — and, in a 3D model, in `plane`'s orientation.
   * See `CircleEntity` for what the plane means and does not.
   *
   * `plane` follows `fix`'s rule exactly: the frame named, or the default
   * frame resolved **now** and journalled resolved, so a saved entry cannot
   * change meaning when the default moves afterwards; with neither, the
   * standing message. A 2D model refuses the argument outright rather than
   * ignoring it — every 2D circle already lies in the one plane there is, and
   * a reference the circle then never read would be a constraint-shaped thing
   * that constrains nothing (`addFrame`'s y-ref rule).
   *
   * The plane is resolved before anything is created, so a refused call leaves
   * no auto-created centre behind. The name moved from third argument to
   * fourth for the plane to sit before it, as it is on every constructor;
   * files older than format version 7 are translated on the way in.
   */
  addCircle(center?: string | null, radius?: number | null, plane?: string | null,
            name?: string | null): CircleEntity {
    if (center != null) this.point(center);
    if (radius != null && !(radius > 0)) throw new Error("a circle needs a positive radius");
    const frame = this.curvePlane("circle", plane);
    const c = center ?? this.withoutRecording(() => this.addPoint()).name;
    const nm = this.claimName("c", name ?? undefined);
    const ent: CircleEntity = {
      kind: "circle", name: nm, center: c,
      radiusVar: this.problem.addVar(radius ?? Model.DEFAULT_RADIUS),
    };
    if (frame != null) ent.plane = frame;
    this.entities.set(nm, ent);
    this.record("addCircle", [center ?? null, radius ?? null, frame, nm]);
    return ent;
  }

  /**
   * An arc about `center` from `start` to `end` — counter-clockwise about its
   * plane's +z in 3D, about the 2D +z in 2D (see `ArcEntity`). `plane` is
   * resolved exactly as `addCircle` resolves it.
   *
   * Missing pieces seed as a non-degenerate quarter arc around the centre:
   * along the kernel's x and y in 2D, as they always did, and along the
   * **plane's own** +x and +y in 3D, so that a free arc lies in the plane it
   * names rather than in the gauge's x–y plane, which might be edge-on to it.
   * Seeds and nothing more — no relation holds them there.
   */
  addArc(center?: string | null, start?: string | null, end?: string | null,
         radius?: number | null, plane?: string | null, name?: string | null): ArcEntity {
    if (center != null) this.point(center);
    if (start != null) this.point(start);
    if (end != null) this.point(end);
    if (start != null && start === end) throw new Error("an arc needs two different endpoints");
    if (radius != null && !(radius > 0)) throw new Error("an arc needs a positive radius");
    const r = radius ?? Model.DEFAULT_RADIUS;
    if ((start == null || end == null) && this.dim < 2) {
      // The quarter-arc seed below needs two independent axes to be
      // non-degenerate; below 2D there is no second axis to offset along.
      throw new Error("an auto-seeded arc needs at least 2 dimensions");
    }
    const frame = this.curvePlane("arc", plane);
    // Auto pieces seed as a non-degenerate quarter arc around the center.
    const c = center ?? this.withoutRecording(() => this.addPoint()).name;
    const [along0, along1] = frame == null ? [null, null] : this.seedAxes(frame);
    const seed = (axis: number, along: number[] | null) => along
      ? this.withoutRecording(() => this.addPoint(this.coords(c).map((v, i) => v + r * along[i]))).name
      : this.freePointOffset(this.coords(c), axis, r).name;
    const s = start ?? seed(0, along0);
    const e = end ?? seed(1, along1);
    const nm = this.claimName("a", name ?? undefined);
    const ent: ArcEntity = { kind: "arc", name: nm, center: c, start: s, end: e, radiusVar: this.problem.addVar(r) };
    if (frame != null) ent.plane = frame;
    this.entities.set(nm, ent);
    this.record("addArc", [center ?? null, start ?? null, end ?? null, radius ?? null, frame, nm]);
    return ent;
  }

  /**
   * The plane a new circle or arc gets: in 3D the frame named or the default,
   * resolved now (`resolveFrame`, with its standing message); anywhere else
   * none, and an argument naming one is refused rather than ignored. Public so
   * the command line can ask before it makes anything a refused call would
   * leave behind; it changes nothing.
   */
  curvePlane(kind: "circle" | "arc", plane: string | null | undefined): string | null {
    if (this.dim === 3) return this.resolveFrame(plane);
    if (plane != null) {
      throw new Error(`a ${this.dim}D ${kind} takes no plane — it lies in the one plane a ${this.dim}D model has`);
    }
    return null;
  }

  /**
   * A 3D frame's +x and +y as unit vectors, for *seeding* — laying a free
   * arc's auto-created ends out in the plane it names. The same Gram–Schmidt
   * `frameBasis` does, kept here in plain numbers because this layer sits
   * below the relations and only needs a direction to put a seed along; no
   * residual ever reads it. A collapsed frame falls back to the kernel's axes,
   * which is as good a seed as any for a plane that is not there.
   */
  private seedAxes(frame: string): [number[], number[]] {
    const f = this.frame(frame);
    const o = this.coords(f.origin);
    const unit = (v: number[]) => {
      const len = Math.hypot(...v);
      return len > 1e-9 ? v.map((x) => x / len) : null;
    };
    const ux = unit(this.coords(f.xref).map((v, i) => v - o[i]));
    const arm = f.yref === undefined ? null : this.coords(f.yref).map((v, i) => v - o[i]);
    if (!ux || !arm) return [[1, 0, 0], [0, 1, 0]];
    const along = arm.reduce((s, v, i) => s + v * ux[i], 0);
    const uy = unit(arm.map((v, i) => v - along * ux[i]));
    return uy ? [ux, uy] : [[1, 0, 0], [0, 1, 0]];
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
    let o = origin ?? null, x = xref ?? null, y = yref ?? null;
    // The origin first, since both arms are seeded off it. Given an x-ref it
    // sits a span back along the kernel's x, as it always has — unless a given
    // y-ref lies on that very line, in which case the next axis along.
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

    const nm = this.claimName("f", name ?? undefined);
    const ent: FrameEntity = { kind: "frame", name: nm, origin: o, xref: x };
    if (y != null) ent.yref = y;
    this.entities.set(nm, ent);
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
   * pointer and nothing more: a new model has **no** default, because a frame
   * exists only because a user made one.
   *
   * Journalled, because it changes what a later relation call *means*. What
   * it does not do is change what an *already journalled* relation means —
   * the relations resolve this at call time and record the answer, so a
   * saved file never depends on what the default happened to be later.
   */
  setDefaultFrame(name: string | null): void {
    if (name != null) this.frame(name); // fail on a name that is not a frame
    this.defaultFrame = name ?? null;
    this.record("setDefaultFrame", [name ?? null]);
  }

  /**
   * The frame a call meant: the one it named, or the default, resolved *now*.
   * Relations call this and journal what comes back, so the entry carries an
   * explicit frame name whatever the caller typed.
   */
  resolveFrame(name?: string | null): string {
    // Said first, because in a model that cannot hold a frame the standing
    // advice to go and make one would only lead to a second refusal.
    if (!framesExistIn(this.dim)) throw new Error(noFramesIn(this.dim));
    const n = name ?? this.defaultFrame;
    if (n == null) {
      throw new Error("no default frame — frame() then setDefaultFrame(), or say which frame");
    }
    this.frame(n);
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

  /** A circle or an arc, whichever `name` is — for relations that only need center + radius (+ plane). */
  circular(name: string): CircularRef {
    const e = this.entities.get(name);
    if (!e || (e.kind !== "circle" && e.kind !== "arc")) throw new Error(`"${name}" is not a circle or arc`);
    const ref: CircularRef = { name: e.name, center: e.center, radiusVar: e.radiusVar };
    if (e.plane !== undefined) ref.plane = e.plane;
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
    }
  }

  /**
   * The frame a 3D circle or arc lies parallel to, or undefined — for every
   * other kind, and for any circle in a model whose circles carry no plane.
   * Kept apart from `refsOf`, which is the *points* an entity is built of and
   * what a drag moves: a frame is not a point, and dragging a circle must not
   * try to drag the plane it is drawn on.
   */
  planeOf(e: Entity): string | undefined {
    return e.kind === "circle" || e.kind === "arc" ? e.plane : undefined;
  }

  /**
   * Every entity that names `name` among its references, in creation order —
   * its points, and a circle's or arc's plane. The plane counts because a 3D
   * circle cannot be without one: deleting a frame takes the circles and arcs
   * drawn on it (inward, like a point taking its lines), and the primitive
   * refuses to delete a frame they still stand on.
   */
  dependents(name: string): Entity[] {
    return [...this.entities.values()].filter((e) => this.refsOf(e).includes(name) || this.planeOf(e) === name);
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
    // The default is a pointer at a frame, so it cannot outlive one. Cleared
    // here in the primitive rather than up in `del`, because the primitive is
    // also what a replay calls — and journalled as its own expansion, the
    // same discipline the deletion itself follows, so reopening a file gets
    // the pointer the deletion left rather than one recomputed later.
    if (this.defaultFrame === name) this.setDefaultFrame(null);
    this.entities.delete(name);
    this.record("deleteEntity", [name]);
  }

  /** Removes one relation and the residual blocks it added. */
  deleteRelation(name: string): void {
    const r = this.relationOf(name);
    for (const h of r.blocks) this.problem.removeBlock(h);
    this.relations.delete(name);
    this.record("deleteRelation", [name]);
  }

  solve(): SolveReport {
    return this.problem.solve();
  }
}
