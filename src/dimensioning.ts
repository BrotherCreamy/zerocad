// What a set of picked names can be dimensioned or constrained by — the one
// answer the dimension tool, the constrain tool and the context menu all read
// (docs/plans/sketch-relations.md).
//
// **Pure, and every answer is a command.** Model and names in, the text to
// type out — `dist("p1", "p2", 40)`, `par("l1", "l2")` — with the call it
// stands for beside it (`apply`) for a host with no command line (a test, a
// tool driven headless). The text is what the app types through the command
// machinery, so the log, the journal and the undo step are the typed call's:
// the context menu's rule (menu.ts), kept by the tools as well.
//
// **One rounding.** A dimension holds what it measures *now*, rounded to the
// thousandth the hover tag and the menu print at (`roundValue`), so the
// command a click types is the one a person would have typed reading the tag.
// The menu's Dimension item reads the same function, which is what makes "the
// dimension tool's rounding equals the menu's" true by construction rather
// than by two copies agreeing. An angle is measured in degrees, rounded there,
// and typed as `deg(45)`, because `ang` stores radians and a thousandth of a
// radian is a seventeenth of a degree.

import type { Model } from "./model.ts";
import { dist, coincident, midpoint } from "./relations/basic.ts";
import {
  angle, collinear, concentric, diameter, equalLength, equalSpacing, intersection, parallel, perpendicular, pierce,
  pointOnLine, radius, symmetric, tangent, onCircle,
} from "./relations/geometry.ts";
import { measure, measured } from "./relations/measure.ts";


/**
 * A measurement as a dimension types it: to a thousandth, trailing zeros gone.
 * The rounding is a real, deliberate limit — a dimension can move what it
 * measures by up to half a thousandth — and below what a drawing shows at any
 * usable zoom; the alternative is a seventeen-digit literal in the log and in
 * the saved journal, for a difference nobody can see.
 */
export function roundValue(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** One thing a selection can be given: a label, the command it types, and the call that command is. */
export interface Applicable {
  label: string;
  text: string;
  apply(model: Model): string;
}

const q = (s: string) => JSON.stringify(s);
const call = (op: string, args: (string | number | { raw: string })[]) =>
  `${op}(${args.map((a) => (typeof a === "number" ? String(a) : typeof a === "string" ? q(a) : a.raw)).join(", ")})`;

type Kind = "point" | "line" | "circle" | "arc" | "frame";
const kindOf = (model: Model, n: string): Kind | undefined => model.entities.get(n)?.kind;
const isCurve = (k: Kind | undefined) => k === "circle" || k === "arc";

/** Degrees as `ang` stores them: the rounded degree value, as radians. */
function radiansOf(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** The unsigned angle between two lines, in degrees, as `ang` measures it. */
function angleDegrees(model: Model, a: string, b: string): number {
  return (measured(model, ["angle", a, b]) * 180) / Math.PI;
}

/** Below this the two lines are parallel, and the dimension between them is a distance. */
const PARALLEL_SIN = 1e-6;

function parallelLines(model: Model, a: string, b: string): boolean {
  return Math.sin(measured(model, ["angle", a, b])) < PARALLEL_SIN;
}

/** The options the dimension tool is armed with that change what it types. */
export interface DimensionOptions {
  /** A circle or arc gets its diameter, not its radius. */
  diameter?: boolean;
  /** A reference dimension: `measure(…)`, which measures and constrains nothing. */
  driven?: boolean;
}

/**
 * **The dimension the picks make**, holding what it measures now — or null for
 * picks that make none (yet). In the order picked:
 *
 * - a line: its length, `dist(end, end, len)` — the menu's Dimension;
 * - two points, or a point and a line (either order): the distance, `dist`;
 * - two lines: the angle between them, `ang(l1, l2, deg(θ))` — or, when they
 *   are parallel, the distance between them, `dist(l1, l2, d)`;
 * - a circle or an arc: its radius, `rad(c, r)` — or `dia(c, 2r)`.
 *
 * Driven, each is the `measure` of the same thing, which holds nothing.
 */
export function dimensionFor(model: Model, names: readonly string[], opts: DimensionOptions = {}): Applicable | null {
  const k = names.map((n) => kindOf(model, n));
  const driven = opts.driven === true;
  if (names.length === 1 && k[0] === "line") {
    const [a, b] = model.line(names[0]).refs;
    const v = roundValue(measured(model, ["dist", names[0]]));
    return driven
      ? { label: "Length (driven)", text: call("measure", ["dist", a, b]), apply: (m) => measure(m, "dist", a, b) }
      : { label: "Length", text: call("dist", [a, b, v]), apply: (m) => dist(m, a, b, v) };
  }
  if (names.length === 1 && isCurve(k[0])) {
    const c = names[0];
    const dia = opts.diameter === true;
    const v = roundValue(dia ? 2 * model.radius(c) : model.radius(c));
    const kind = dia ? "diameter" : "radius";
    if (driven) return { label: `${dia ? "Diameter" : "Radius"} (driven)`, text: call("measure", [kind, c]), apply: (m) => measure(m, kind, c) };
    return dia
      ? { label: "Diameter", text: call("dia", [c, v]), apply: (m) => diameter(m, c, v) }
      : { label: "Radius", text: call("rad", [c, v]), apply: (m) => radius(m, c, v) };
  }
  if (names.length !== 2) return null;
  const [a, b] = names;
  if (a === b) return null;
  if (k[0] === "line" && k[1] === "line" && !parallelLines(model, a, b)) {
    const deg = roundValue(angleDegrees(model, a, b));
    if (driven) return { label: "Angle (driven)", text: call("measure", ["angle", a, b]), apply: (m) => measure(m, "angle", a, b) };
    return { label: "Angle", text: call("ang", [a, b, { raw: `deg(${deg})` }]), apply: (m) => angle(m, a, b, radiansOf(deg)) };
  }
  const pointish = (x: Kind | undefined) => x === "point" || x === "line";
  if (!pointish(k[0]) || !pointish(k[1])) return null;
  const v = roundValue(measured(model, ["dist", a, b]));
  if (driven) return { label: "Distance (driven)", text: call("measure", ["dist", a, b]), apply: (m) => measure(m, "dist", a, b) };
  return { label: "Distance", text: call("dist", [a, b, v]), apply: (m) => dist(m, a, b, v) };
}

/**
 * **The relations that apply to a selection** — the constrain tool's list and
 * the context menu's on a selection, one list. Each holds the drawing as it
 * stands where it has a number (a distance, an angle), and states a relation
 * where it has none (parallel, tangent), which the solve then makes true.
 * Ordered as Onshape's constraint toolbar reads: shape relations first, then
 * the dimensions. Empty for a selection no relation takes.
 */
export function constraintsFor(model: Model, names: readonly string[]): Applicable[] {
  const uniq = [...new Set(names)].filter((n) => model.entities.has(n));
  const k = uniq.map((n) => kindOf(model, n));
  const count = (want: (x: Kind | undefined) => boolean) => k.filter(want).length;
  const of = (want: (x: Kind | undefined) => boolean) => uniq.filter((_, i) => want(k[i]));
  const out: Applicable[] = [];
  const add = (label: string, op: string, args: string[], apply: (m: Model) => string) =>
    out.push({ label, text: call(op, args), apply });
  const isPoint = (x: Kind | undefined) => x === "point";
  const isLine = (x: Kind | undefined) => x === "line";
  const n = uniq.length;
  const dim = dimensionFor(model, uniq);

  if (n === 1 && isLine(k[0])) {
    const l = uniq[0];
    add("Horizontal", "horizontal", [l], (m) => parallel(m, l, m.axisRef("x")));
    add("Vertical", "vertical", [l], (m) => parallel(m, l, m.axisRef("y")));
  }
  if (n === 2 && isLine(k[0]) && isLine(k[1])) {
    const [a, b] = uniq;
    add("Parallel", "par", [a, b], (m) => parallel(m, a, b));
    add("Perpendicular", "perp", [a, b], (m) => perpendicular(m, a, b));
    add("Equal", "eq", [a, b], (m) => equalLength(m, a, b));
    add("Collinear", "col", [a, b], (m) => collinear(m, a, b));
  }
  if (n === 2 && isPoint(k[0]) && isPoint(k[1])) {
    const [a, b] = uniq;
    add("Coincident", "coin", [a, b], (m) => coincident(m, a, b));
    add("Horizontal", "horizontal", [a, b], (m) => parallel(m, a, b, m.axisRef("x")));
    add("Vertical", "vertical", [a, b], (m) => parallel(m, a, b, m.axisRef("y")));
  }
  if (n === 2 && count(isPoint) === 1 && count(isLine) === 1) {
    const [p] = of(isPoint), [l] = of(isLine);
    add("On", "on", [p, l], (m) => pointOnLine(m, p, l));
    add("Midpoint", "mid", [p, l], (m) => midpoint(m, p, l));
  }
  if (n === 2 && count(isPoint) === 1 && count(isCurve) === 1) {
    const [p] = of(isPoint), [c] = of(isCurve);
    add("On", "oncircle", [p, c], (m) => onCircle(m, p, c));
    if (kindOf(model, c) === "arc") add("Midpoint", "mid", [p, c], (m) => midpoint(m, p, c));
  }
  if (n === 2 && count(isPoint) === 1 && (count(isLine) === 1 || count(isCurve) === 1) && model.dim === 3) {
    const [p] = of(isPoint), [c] = uniq.filter((x) => x !== p);
    add("Pierce", "pierce", [p, c], (m) => pierce(m, p, c));
  }
  if (n === 2 && count(isCurve) === 2) {
    const [a, b] = uniq;
    add("Concentric", "conc", [a, b], (m) => concentric(m, a, b));
    add("Equal", "eq", [a, b], (m) => equalLength(m, a, b));
    add("Tangent", "tan", [a, b], (m) => tangent(m, a, b));
  }
  if (n === 2 && count(isLine) === 1 && count(isCurve) === 1) {
    const [l] = of(isLine), [c] = of(isCurve);
    add("Tangent", "tan", [l, c], (m) => tangent(m, l, c));
    if (kindOf(model, c) === "arc") add("Equal length", "eq", [l, c], (m) => equalLength(m, l, c));
  }
  if (n === 3 && count(isPoint) === 2 && count(isLine) === 1) {
    const [a, b] = of(isPoint), [l] = of(isLine);
    add("Symmetric", "sym", [a, b, l], (m) => symmetric(m, a, b, l));
  }
  if (n === 3 && count(isPoint) === 1 && count((x) => isLine(x) || isCurve(x)) === 2) {
    const [p] = of(isPoint), [c1, c2] = uniq.filter((x) => x !== p);
    add("Intersection", "intersection", [p, c1, c2], (m) => intersection(m, p, c1, c2));
  }
  if (n >= 3 && count(isPoint) === n) {
    add("Equal spacing", "spacing", [...uniq], (m) => equalSpacing(m, ...uniq));
  }
  if (dim) out.push(dim);
  return out;
}
