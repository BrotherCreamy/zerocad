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

import { Problem, type SolveReport } from "./kernel/problem.ts";

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

export class Model {
  problem = new Problem();
  dim: number;
  entities = new Map<string, Entity>();
  private counters = new Map<string, number>();

  constructor(dim = 2) {
    this.dim = dim;
  }

  private autoName(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    let name = `${prefix}${n}`;
    while (this.entities.has(name)) {
      this.counters.set(prefix, n + 1);
      name = `${prefix}${this.counters.get(prefix)}`;
    }
    return name;
  }

  private claimName(prefix: string, name?: string): string {
    const nm = name ?? this.autoName(prefix);
    if (this.entities.has(nm)) throw new Error(`"${nm}" already exists`);
    return nm;
  }

  addPoint(coords: number[], name?: string): PointEntity {
    if (coords.length !== this.dim) {
      throw new Error(`point needs ${this.dim} coordinates, got ${coords.length}`);
    }
    const nm = this.claimName("p", name);
    const varIndices = coords.map((c) => this.problem.addVar(c));
    const ent: PointEntity = { kind: "point", name: nm, varIndices };
    this.entities.set(nm, ent);
    return ent;
  }

  addLine(a: string, b: string, name?: string): LineEntity {
    this.point(a); this.point(b); // validates both exist and are points
    if (a === b) throw new Error("a line needs two different points");
    const nm = this.claimName("l", name);
    const ent: LineEntity = { kind: "line", name: nm, refs: [a, b] };
    this.entities.set(nm, ent);
    return ent;
  }

  addCircle(center: string, radius: number, name?: string): CircleEntity {
    this.point(center);
    if (!(radius > 0)) throw new Error("a circle needs a positive radius");
    const nm = this.claimName("c", name);
    const ent: CircleEntity = { kind: "circle", name: nm, center, radiusVar: this.problem.addVar(radius) };
    this.entities.set(nm, ent);
    return ent;
  }

  addArc(center: string, start: string, end: string, radius: number, name?: string): ArcEntity {
    this.point(center); this.point(start); this.point(end);
    if (start === end) throw new Error("an arc needs two different endpoints");
    if (!(radius > 0)) throw new Error("an arc needs a positive radius");
    const nm = this.claimName("a", name);
    const ent: ArcEntity = { kind: "arc", name: nm, center, start, end, radiusVar: this.problem.addVar(radius) };
    this.entities.set(nm, ent);
    return ent;
  }

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

  radius(name: string): number {
    return this.problem.getVar(this.circular(name).radiusVar);
  }

  solve(): SolveReport {
    return this.problem.solve();
  }
}
