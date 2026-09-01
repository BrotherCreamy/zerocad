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

// A circle is a center point plus one variable of its own: the radius. That
// structure is dimension-generic — in 3D the identical entity is a sphere,
// and `rad`/`onCircle`/`concentric` read it without caring which it is.
export interface CircleEntity {
  kind: "circle";
  name: string;
  center: string; // a point name
  radiusVar: number; // the one variable a circle owns
}

// An arc is a circle that also names where it starts and ends. The endpoints
// are ordinary points, so they can be constrained (coincident with a line's
// end, say) like any other. What makes them *arc* endpoints — lying on the
// arc's own circle — is not automatic: it's the `arcEndpoints` relation, for
// the same reason a Line doesn't imply hor/ver. Tools that create arcs are
// expected to apply it (see relations/geometry.ts).
export interface ArcEntity {
  kind: "arc";
  name: string;
  center: string;
  start: string;
  end: string;
  radiusVar: number;
}

export type Entity = PointEntity | LineEntity | CircleEntity | ArcEntity;

/** Circles and arcs share a center + radius; relations that only need those two treat them alike. */
export interface CircularRef {
  name: string;
  center: string;
  radiusVar: number;
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
 * an entry here, named `r1`, `r2`, … exactly as entities are named.
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
   * Records `op` and then runs `body` with recording suppressed, so an
   * operation is journalled as the single call the user made rather than as
   * the handful of entities and relations it happened to expand into.
   * Replaying the call re-expands it identically.
   */
  asOperation<T>(op: string, args: unknown[], body: () => T): T {
    this.record(op, args);
    return this.withoutRecording(body);
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
      // Nested: absorbed into the relation already being built.
      body();
      return this.building.name;
    }
    const counterWas = this.counters.get("r");
    const name = this.claimName("r");
    const building = { name, blocks: [] as BlockHandle[] };
    this.building = building;
    try {
      // Suppressed, so an inner relation's own `record` does not double up.
      this.withoutRecording(body);
    } catch (e) {
      for (const h of building.blocks) this.problem.removeBlock(h);
      if (counterWas === undefined) this.counters.delete("r");
      else this.counters.set("r", counterWas);
      throw e;
    } finally {
      this.building = null;
    }
    this.relations.set(name, { name, op, args, blocks: building.blocks });
    this.record(op, args);
    return name;
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

  /** Every relation whose call named `name`, in creation order. */
  relationsNaming(name: string): RelationEntry[] {
    return [...this.relations.values()].filter((r) => r.args.some((a) => a === name));
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
    const span = 20;
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

  addCircle(center?: string | null, radius?: number | null, name?: string | null): CircleEntity {
    if (center != null) this.point(center);
    if (radius != null && !(radius > 0)) throw new Error("a circle needs a positive radius");
    const c = center ?? this.withoutRecording(() => this.addPoint()).name;
    const nm = this.claimName("c", name ?? undefined);
    const ent: CircleEntity = {
      kind: "circle", name: nm, center: c,
      radiusVar: this.problem.addVar(radius ?? Model.DEFAULT_RADIUS),
    };
    this.entities.set(nm, ent);
    this.record("addCircle", [center ?? null, radius ?? null, nm]);
    return ent;
  }

  addArc(center?: string | null, start?: string | null, end?: string | null,
         radius?: number | null, name?: string | null): ArcEntity {
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
    // Auto pieces seed as a non-degenerate quarter arc around the center.
    const c = center ?? this.withoutRecording(() => this.addPoint()).name;
    const s = start ?? this.freePointOffset(this.coords(c), 0, r).name;
    const e = end ?? this.freePointOffset(this.coords(c), 1, r).name;
    const nm = this.claimName("a", name ?? undefined);
    const ent: ArcEntity = { kind: "arc", name: nm, center: c, start: s, end: e, radiusVar: this.problem.addVar(r) };
    this.entities.set(nm, ent);
    this.record("addArc", [center ?? null, start ?? null, end ?? null, radius ?? null, nm]);
    return ent;
  }

  /** Seed for a radius nobody specified. A seed, not a constraint. */
  static readonly DEFAULT_RADIUS = 10;

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

  /** A circle or an arc, whichever `name` is — for relations that only need center + radius. */
  circular(name: string): CircularRef {
    const e = this.entities.get(name);
    if (!e || (e.kind !== "circle" && e.kind !== "arc")) throw new Error(`"${name}" is not a circle or arc`);
    return { name: e.name, center: e.center, radiusVar: e.radiusVar };
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
    }
  }

  /** Every entity that names `name` among its references, in creation order. */
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
