// The entity graph sitting on top of the kernel. Deliberately thin: a Point
// is just a name plus one Problem variable per dimension. Everything about
// *how many* dimensions is a property of the model, not hardcoded here or
// in the kernel — a relation function reads `entity.varIndices.length` to
// find out how many coordinates it's working with, so the same relation
// code (see src/relations) works whether the model is 2D or 3D.

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

export type Entity = PointEntity | LineEntity;

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

  addPoint(coords: number[], name?: string): PointEntity {
    if (coords.length !== this.dim) {
      throw new Error(`point needs ${this.dim} coordinates, got ${coords.length}`);
    }
    const nm = name ?? this.autoName("p");
    if (this.entities.has(nm)) throw new Error(`"${nm}" already exists`);
    const varIndices = coords.map((c) => this.problem.addVar(c));
    const ent: PointEntity = { kind: "point", name: nm, varIndices };
    this.entities.set(nm, ent);
    return ent;
  }

  addLine(a: string, b: string, name?: string): LineEntity {
    this.point(a); this.point(b); // validates both exist and are points
    if (a === b) throw new Error("a line needs two different points");
    const nm = name ?? this.autoName("l");
    if (this.entities.has(nm)) throw new Error(`"${nm}" already exists`);
    const ent: LineEntity = { kind: "line", name: nm, refs: [a, b] };
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

  coords(name: string): number[] {
    const e = this.point(name);
    return e.varIndices.map((i) => this.problem.getVar(i));
  }

  solve(): SolveReport {
    return this.problem.solve();
  }
}
