// A **driven dimension**: a number on the drawing that measures and never
// constrains — SolidWorks' "driven", Onshape's reference dimension, drawn in
// parentheses (docs/plans/sketch-relations.md).
//
// It is a relation with **no residual blocks**. That is the whole of the
// design: it goes through `model.relation`, so it is journalled, named (`d7` —
// it is a dimension, see `REFERENCE_OPS`), listed by `rels()`, drawn as a
// glyph, hovered, deleted and cascaded with what it measures exactly as every
// other relation is — and the solver never hears of it, because it adds
// nothing to the problem. The value is not stored; the glyph reads it off the
// geometry each time it is drawn (`measured`), so it is live through a drag.
//
// The kinds are the dimension tool's: `dist` (two points, a point and a line,
// two lines, or one line's length), `angle` (two lines), `radius` and
// `diameter` (a circle or an arc). `set` refuses one — a reference has no
// value to set, which is the point of it.
//
// Smart dimension (docs/plans/smart-dimension.md) added the rest of what the
// tool can measure: `along` (two points along a direction), `angle3` (at a
// vertex), `arclen`, `major` and `minor` (an ellipse's semi-axes), `fdist`
// (square to a flat face), `fangle` (between two flat faces) and `length`
// (an edge). Those last three, and `radius` and `diameter`, also read **a
// solid's faces and edges by name** — through the model where the face has a
// source (relations/solidref.ts), else through the solid kernel's answer,
// which only the host holds: it hands a reader in (`setSolidReader`), so this
// file, below the host, never learns where the kernel is. A face a fillet
// made is measured that way, and can only be measured — a driven dimension,
// never a driving one, since nothing in the model holds it.

import type { Model } from "../model.ts";
import { Dual } from "../kernel/dual.ts";
import { semiAxes } from "../kinds/ellipse.ts";
import { directionOf, frameBasis } from "./refs.ts";
import { arcLengthNow } from "./smartdim.ts";
import { edgeSource, faceDistanceNow, faceSource, isPlanarFace, planeNow, pointNow } from "./solidref.ts";

/** What a driven dimension can measure, and how many names each takes. */
export const MEASURE_KINDS: Readonly<Record<string, readonly number[]>> = {
  dist: [1, 2],
  angle: [2],
  radius: [1],
  diameter: [1],
  along: [3],
  angle3: [3],
  arclen: [1],
  major: [1],
  minor: [1],
  fdist: [2],
  fangle: [2],
  length: [1],
};

/**
 * A solid's face or edge as the kernel built it, in plain numbers — what the
 * host's reader answers for a name the model has no source for.
 */
export type SolidGeometry =
  | { kind: "plane"; point: number[]; normal: number[] }
  | { kind: "cylinder"; point: number[]; radius: number }
  | { kind: "edge"; length: number; ends: [number[], number[]] }
  | { kind: "other"; point: number[] };

let reader: ((name: string) => SolidGeometry | null) | null = null;

/** The host's way to the kernel's faces and edges by name (main.ts); null takes it away. */
export function setSolidReader(read: ((name: string) => SolidGeometry | null) | null): void {
  reader = read;
}

/**
 * A face or an edge, by name, as plain numbers: from the model where it has a
 * source — a flat face's plane, a round wall's member, an edge's entity —
 * else from the kernel through the host's reader. Null where neither knows it.
 */
export function solidGeometry(model: Model, name: string): SolidGeometry | null {
  const e = model.entities.get(name);
  if (e?.kind === "line") {
    const [p, q] = ends(model, name);
    return { kind: "edge", length: len(sub(q, p)), ends: [p, q] };
  }
  if (e) return null;
  if (isPlanarFace(model, name)) {
    const pl = planeNow(model, name)!;
    return { kind: "plane", point: pl.p, normal: pl.n };
  }
  const s = faceSource(model, name);
  if (s?.kind === "wall" && s.shape === "cylinder") {
    return { kind: "cylinder", point: model.coords(model.oriented(s.entity).center), radius: model.radius(s.entity) };
  }
  const edge = edgeSource(model, name);
  if (edge && model.entities.get(edge)?.kind === "line") return solidGeometry(model, edge);
  return reader?.(name) ?? null;
}

/** A place on whatever a name is: a point, a line's middle, a curve's centre, a face's own point, an edge's middle. */
export function placeOf(model: Model, name: string): number[] | null {
  if (model.entities.has(name)) {
    try {
      return pointNow(model, name);
    } catch {
      return null;
    }
  }
  const g = solidGeometry(model, name);
  if (!g) return null;
  return g.kind === "edge" ? g.ends[0].map((v, i) => (v + g.ends[1][i]) / 2) : g.point;
}

/** A direction reference now, unit length: a frame's axis, or a line's. */
export function directionNow(model: Model, ref: string): number[] {
  const d = directionOf(model, ref);
  const u = d.direction(d.vars().map((i) => Dual.constant(model.problem.getVar(i)))).map((x) => x.val);
  const l = len(u);
  return l > 0 ? u.map((x) => x / l) : u;
}

/**
 * `measure(kind, ...names)`: a reference dimension. Checks now what it will
 * read later, so a mistyped one refuses where it was typed rather than drawing
 * `?` on the canvas.
 */
export function measure(model: Model, kind: string, ...names: string[]): string {
  const counts = MEASURE_KINDS[kind];
  if (!counts) {
    throw new Error(`measure takes what to measure first — ${Object.keys(MEASURE_KINDS).map((k) => JSON.stringify(k)).join(", ")} — not ${JSON.stringify(kind)}`);
  }
  if (!counts.includes(names.length)) {
    throw new Error(`measure("${kind}", …) takes ${counts.join(" or ")} name${counts.at(-1) === 1 ? "" : "s"}, not ${names.length}`);
  }
  // Read it once now: whatever the arguments are, the reading must work.
  const v = measured(model, [kind, ...names]);
  if (!Number.isFinite(v)) throw new Error(`measure("${kind}", ${names.map((n) => JSON.stringify(n)).join(", ")}) has nothing to measure`);
  return model.relation("measure", [kind, ...names], () => {
    // No blocks: a reference dimension constrains nothing.
  });
}

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dotN = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = (a: number[]) => Math.sqrt(dotN(a, a));

/** How far `q` is from the infinite line through `a`, `b`. */
function offLine(q: number[], a: number[], b: number[]): number {
  const u = sub(b, a), w = sub(q, a);
  const uu = dotN(u, u);
  if (!(uu > 0)) return len(w);
  const t = dotN(w, u) / uu;
  return len(w.map((wi, i) => wi - t * u[i]));
}

/** A line's two ends, as coordinates. */
function ends(model: Model, line: string): [number[], number[]] {
  const l = model.line(line);
  return [model.coords(l.refs[0]), model.coords(l.refs[1])];
}

/**
 * What a driven dimension reads now, from its recorded arguments
 * (`[kind, ...names]`) — a length, or an angle in **radians** as `ang` stores
 * one. Also what the dimension tool measures to type a driving one, so a
 * reference and the dimension it would have been always agree.
 */
export function measured(model: Model, args: readonly unknown[]): number {
  const [kind, a, b] = args as [string, string, string | undefined];
  const kindOf = (n: string) => model.entities.get(n)?.kind;
  switch (kind) {
    case "dist": {
      if (b === undefined) {
        if (!model.entities.has(a)) return solidGeometry(model, a)?.kind === "edge" ? (solidGeometry(model, a) as { length: number }).length : NaN;
        const [p, q] = ends(model, a);
        return len(sub(q, p));
      }
      if (kindOf(a) === "line" && kindOf(b) === "line") {
        const [p, q] = ends(model, a), [c, d] = ends(model, b);
        return offLine(c.map((ci, i) => (ci + d[i]) / 2), p, q);
      }
      if (kindOf(a) === "line" || kindOf(b) === "line") {
        const [pt, line] = kindOf(a) === "line" ? [b, a] : [a, b];
        const [p, q] = ends(model, line);
        return offLine(model.coords(pt), p, q);
      }
      return len(sub(model.coords(b), model.coords(a)));
    }
    case "angle": {
      // A line or a frame's axis, either side — as `ang` takes them.
      const u = directionNow(model, a), v = directionNow(model, b!);
      const cos = dotN(u, v) / (len(u) * len(v));
      return Math.acos(Math.max(-1, Math.min(1, cos)));
    }
    case "radius":
    case "diameter": {
      // A curve's own radius; a round face's — its member's, or the kernel's cylinder.
      const g = model.entities.has(a) ? null : solidGeometry(model, a);
      const r = model.entities.has(a) ? model.radius(a) : g?.kind === "cylinder" ? g.radius : NaN;
      return kind === "radius" ? r : 2 * r;
    }
    case "along": {
      const [, p, q, axis] = args as string[];
      // `p` may be a frame: its origin (see `distAlong`).
      const from = model.isFrame(p) ? frameBasis(model, p)().origin.slice(0, model.dim) : model.coords(p);
      const d = sub(model.coords(q), from);
      return Math.abs(dotN(d, directionNow(model, axis)));
    }
    case "angle3": {
      const [, v, p, q] = args as string[];
      const u = sub(model.coords(p), model.coords(v)), w = sub(model.coords(q), model.coords(v));
      return Math.acos(Math.max(-1, Math.min(1, dotN(u, w) / (len(u) * len(w)))));
    }
    case "arclen": return arcLengthNow(model, a);
    case "major": return semiAxes(model, a).a;
    case "minor": return Math.abs(semiAxes(model, a).b);
    case "fdist": {
      const v = faceDistanceNow(model, a, b!);
      if (Number.isFinite(v)) return v;
      // A face only the kernel knows: square to its plane, from the other's place.
      const [ga, gb] = [solidGeometry(model, a), solidGeometry(model, b!)];
      const [plane, other] = ga?.kind === "plane" ? [ga, b!] : gb?.kind === "plane" ? [gb, a] : [null, null];
      const q = other === null ? null : placeOf(model, other);
      if (!plane || !q) return NaN;
      return Math.abs(dotN(sub(q, plane.point), plane.normal));
    }
    case "fangle": {
      const [ga, gb] = [solidGeometry(model, a), solidGeometry(model, b!)];
      if (ga?.kind !== "plane" || gb?.kind !== "plane") return NaN;
      // The angle between the two planes, not between their outward normals:
      // faces meeting square read 90°, a wedge's faces their sharp angle.
      return Math.acos(Math.min(1, Math.abs(dotN(ga.normal, gb.normal)) / (len(ga.normal) * len(gb.normal))));
    }
    case "length": {
      const g = solidGeometry(model, a);
      return g?.kind === "edge" ? g.length : NaN;
    }
    default: return NaN;
  }
}
