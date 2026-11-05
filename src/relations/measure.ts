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

import type { Model } from "../model.ts";

/** What a driven dimension can measure, and how many names each takes. */
export const MEASURE_KINDS: Readonly<Record<string, readonly number[]>> = {
  dist: [1, 2],
  angle: [2],
  radius: [1],
  diameter: [1],
};

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
      const [p, q] = ends(model, a), [c, d] = ends(model, b!);
      const u = sub(q, p), v = sub(d, c);
      const cos = dotN(u, v) / (len(u) * len(v));
      return Math.acos(Math.max(-1, Math.min(1, cos)));
    }
    case "radius": return model.radius(a);
    case "diameter": return 2 * model.radius(a);
    default: return NaN;
  }
}
