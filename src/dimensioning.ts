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

import { entityKind, parseAxisRef, parsePointTriple, type Model } from "./model.ts";
import { dist, coincident, fix, midpoint, onPlane } from "./relations/basic.ts";
import {
  angle, collinear, concentric, coradial, diameter, equalLength, equalSpacing, intersection, onEllipse, parallel,
  perpendicular, pierce, pointOnLine, radius, symmetric, tangent, onCircle,
} from "./relations/geometry.ts";
import { onSpline, tangentSplineRefusal } from "./relations/spline.ts";
import { frameBasis } from "./relations/refs.ts";
import { measure, measured } from "./relations/measure.ts";
import { loadedModules } from "./modules.ts";


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

/**
 * One thing a selection can be given: a label, the command it types, and the
 * call that command is. **`off`, when set, greys it**: the reason it cannot be
 * applied as the drawing stands (a spline whose end meets nothing, a face the
 * solid kernel computed), shown rather than left out so "why is there no
 * Tangent here" is answered where it is asked. A greyed one types nothing.
 */
export interface Applicable {
  label: string;
  text: string;
  apply(model: Model): string;
  off?: string;
}

const q = (s: string) => JSON.stringify(s);
const call = (op: string, args: (string | number | { raw: string })[]) =>
  `${op}(${args.map((a) => (typeof a === "number" ? String(a) : typeof a === "string" ? q(a) : a.raw)).join(", ")})`;

// The dimension tool offers nothing for an ellipse or a spline yet: an
// ellipse's `major` and `minor` are typed or taken from the context menu, and
// a spline's points are dimensioned as any points are. The constrain tool's
// list below takes both, and any kind a module adds (`constraintsFor`).
type Kind = "point" | "line" | "circle" | "arc" | "frame" | "ellipse" | "spline";
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


// ---- the relations a selection takes (docs/plans/relations-complete.md) ----------
//
// **The table is the spec's**, row for row, and `test/relationscomplete.test.ts`
// is the same table as a test: every selection of pickable kinds against the
// union of SolidWorks' and Onshape's sketch relations, each cell offered,
// greyed with a reason, or absent because it does not apply (the spec says
// why for each). What follows is that table written as rules over **kind
// predicates** rather than a switch over kind names, so a kind a module adds
// (an elliptical arc, a control-point spline) takes the cells its predicates
// earn — a point On it through the relation its kind declares holds a point
// on it (`EntityKindSpec.heldBy`), a Fix of its points through its `refs` —
// without a line here naming it.
//
// A pick is a name, and three kinds of name are not entities:
//
// - **a frame's axis**, `"f1.x"`: what the constrain tool makes of a click on
//   a frame's marker (the arm clicked). x and y are directions — Parallel,
//   Perpendicular, a mirror for Symmetric. In 3D the z arm stands for the
//   frame's **plane**, which it is the normal of: a point On it, a line Normal
//   to it or Parallel to it;
// - **a solid's face**, `"p1.p2.p3"`: three of its own points, the plane
//   reference sketch-on-face already writes (sketchface.ts) — what the
//   constrain tool makes of a click on a flat face whose edges are the
//   model's. A solid's vertices and edges need no name of their own: they are
//   the model's points and lines (a lid's twins), picked as any are;
// - **the kernel's own**, an edge `"e1.lid|e1.m0"` or a face `"e1.f4"` that no
//   points of the model's bound — a fillet's, a cut's. Nothing can hold to
//   them, and the list says so, greyed, rather than offering nothing.

/** What one pick is, for the table. An entity's kind, or one of the three references above. */
type PickClass = string;

/** A pick's class, or undefined for a name the table cannot read (dropped, as an unknown name always was). */
function classify(model: Model, n: string): PickClass | undefined {
  const e = model.entities.get(n);
  if (e) return e.kind;
  // `parseAxisRef` refuses a dotted name that is no axis ("e1.lid") rather
  // than answering no; here that only means it is something else.
  let axis: ReturnType<typeof parseAxisRef> = null;
  try { axis = parseAxisRef(n); } catch { /* not an axis */ }
  if (axis && model.isFrame(axis.frame)) return axis.axis !== "z" || model.dim === 3 ? "axis" : undefined;
  const triple = parsePointTriple(n);
  if (triple && triple.every((p) => model.entities.get(p)?.kind === "point")) return "face";
  // A name may not hold a dot or a bar (`Model.claimName`), so one that does
  // and is no reference is a pick of the kernel's.
  return /[.|]/.test(n) ? "kernel" : undefined;
}

/** The one greyed cell a pick of the kernel's own geometry gets, with why. */
function kernelCell(n: string): Applicable {
  const off = n.includes("|")
    ? `"${n}" is an edge the solid kernel computed (a fillet's, a chamfer's, a cut's) — no line of the model's lies along it, so there is nothing for a relation to hold`
    : `"${n}" is a face the solid kernel computed, or a curved one — a relation holds to a flat face through three of its own points, and the solid kernel's faces have none of the model's`;
  return { label: "Relate", text: "", apply: () => { throw new Error(off); }, off };
}

/**
 * The relation that holds a point on a curve, as `[the name it is typed by,
 * the call]`: the built-ins by name, and any other kind by the relation its
 * module says holds a point on it (`EntityKindSpec.heldBy`), looked up in
 * the module's own relations — which is how a kind this file has never heard
 * of gets its On cell.
 */
function onRelation(model: Model, curve: string): [string, (m: Model, p: string, c: string) => string] | null {
  const k = model.entities.get(curve)?.kind;
  if (k === "line") return ["on", pointOnLine];
  if (k === "circle" || k === "arc") return ["oncircle", onCircle];
  if (k === "ellipse") return ["onellipse", onEllipse];
  if (k === "spline") return ["onspline", onSpline];
  const op = entityKind(k)?.heldBy?.[0];
  if (!op) return null;
  for (const m of loadedModules()) {
    const decl = m.spec.relations?.[op];
    if (decl) return [decl.names[0], decl.fn as unknown as (m: Model, p: string, c: string) => string];
  }
  return null;
}

/** The kinds `pierce` and `intersection` take (geometry.ts's `onCurve`). */
const ON_CURVE = new Set(["line", "circle", "arc", "ellipse", "spline"]);

/**
 * Where a point sits in the default frame's coordinates — the origin's, when
 * no frame is the default — each rounded as a dimension is (`roundValue`);
 * or the reason there is no answer, the model's own message. What Fix types,
 * here and on the context menu (menu.ts).
 */
export function frameCoords(model: Model, name: string): number[] | string {
  let frame: string;
  try {
    frame = model.resolveFrame();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  const { origin, axes } = frameBasis(model, frame)();
  const rel = model.coords(name).map((v, i) => v - origin[i]);
  return axes.map((u) => roundValue(rel.reduce((s, r, i) => s + r * u[i], 0)));
}

/** "Fix", "Fix (both)", "Fix (all 5)". */
function counted(label: string, n: number): string {
  return n === 1 ? label : n === 2 ? `${label} (both)` : `${label} (all ${n})`;
}

/** The family a pick chains with for many-at-once: a circle and an arc are one; every other kind its own. */
function family(k: PickClass | undefined): string | undefined {
  return k === "circle" || k === "arc" ? "circular" : k;
}

/**
 * **The relations that apply to a selection** — the constrain tool's list and
 * the context menu's on a selection, one list, **most likely first** (the
 * register's ordering: the relation that is *about* the selection's mix —
 * Tangent for a line and a circle, Symmetric for two points and a line — then
 * what chains over many, then Fix, then the dimension). Each holds the
 * drawing as it stands where it has a number (a distance, an angle, Fix's
 * coordinates), and states a relation where it has none, which the solve then
 * makes true. Empty for a selection no relation takes.
 *
 * **Many at once** (n picks of one family): Equal, Parallel, Horizontal,
 * Vertical, Coincident, Concentric and Fix type one relation per pick against
 * the first — a star, not a chain, because a conflict among them then names
 * at most the two eqs that reach it, where a chain names every link between
 * (measured; the register) — as one line, which the command line makes one
 * undo step.
 */
export function constraintsFor(model: Model, names: readonly string[]): Applicable[] {
  const picked = [...new Set(names)].map((n) => ({ n, k: classify(model, n) })).filter((p) => p.k !== undefined);
  const kernel = picked.find((p) => p.k === "kernel");
  if (kernel) return [kernelCell(kernel.n)];
  const uniq = picked.map((p) => p.n);
  const k = picked.map((p) => p.k);
  const n = uniq.length;
  const out: Applicable[] = [];
  const add = (label: string, op: string, args: string[], apply: (m: Model) => string, off?: string) =>
    out.push({ label, text: call(op, args), apply, ...(off ? { off } : {}) });
  /** One line of several calls — many at once — and the names they made. */
  const addMany = (label: string, calls: [string, string[], (m: Model) => string][]) =>
    out.push({ label, text: calls.map(([op, args]) => call(op, args)).join("; "), apply: (m) => calls.map(([, , f]) => f(m)).join(", ") });
  const is = (want: string) => (x: PickClass | undefined) => x === want;
  const isPoint = is("point"), isLine = is("line"), isAxis = is("axis"), isFace = is("face");
  const isCircular = (x: PickClass | undefined) => x === "circle" || x === "arc";
  const isEntity = (x: PickClass | undefined) => x !== undefined && x !== "axis" && x !== "face";
  // A curve a point can be on: a line, or any kind that says what holds a point on it.
  const isCurve = (x: PickClass | undefined) => isLine(x) || isCircular(x) || (x !== undefined && !!entityKind(x)?.heldBy?.length);
  // Anything with a centre (`Model.oriented`): concentric takes it.
  const isCentred = (x: PickClass | undefined) => isCircular(x) || (x !== undefined && !!entityKind(x)?.plane);
  const count = (want: (x: PickClass | undefined) => boolean) => k.filter(want).length;
  const of = (want: (x: PickClass | undefined) => boolean) => uniq.filter((_, i) => want(k[i]));
  const zAxis = (ref: string) => parseAxisRef(ref)?.axis === "z";
  const frameOf = (ref: string) => parseAxisRef(ref)!.frame;
  const threeD = model.dim === 3;
  const dimension = k.every(isEntity) ? dimensionFor(model, uniq) : null;

  // --- what the mix is about -----------------------------------------------
  if (n === 1 && isLine(k[0])) {
    const l = uniq[0];
    add("Horizontal", "horizontal", [l], (m) => parallel(m, l, m.axisRef("x")));
    add("Vertical", "vertical", [l], (m) => parallel(m, l, m.axisRef("y")));
  }
  if (n === 2 && count(isPoint) === 2) {
    const [a, b] = uniq;
    add("Coincident", "coin", [a, b], (m) => coincident(m, a, b));
    add("Horizontal", "horizontal", [a, b], (m) => parallel(m, a, b, m.axisRef("x")));
    add("Vertical", "vertical", [a, b], (m) => parallel(m, a, b, m.axisRef("y")));
  }
  if (n === 2 && count(isPoint) === 1 && count(isCurve) === 1) {
    const [p] = of(isPoint), [c] = of(isCurve);
    const kc = model.entities.get(c)!.kind;
    const on = onRelation(model, c);
    if (on) add("On", on[0], [p, c], (m) => on[1](m, p, c));
    if (kc === "line" || kc === "arc") add("Midpoint", "mid", [p, c], (m) => midpoint(m, p, c));
    if (threeD && ON_CURVE.has(kc)) add("Pierce", "pierce", [p, c], (m) => pierce(m, p, c));
  }
  if (n === 2 && count(isPoint) === 1 && count(isAxis) === 1 && threeD) {
    const [p] = of(isPoint), [ax] = of(isAxis);
    const f = frameOf(ax);
    if (zAxis(ax)) add("On plane", "onplane", [p, f], (m) => onPlane(m, p, f));
  }
  if (n === 2 && count(isPoint) === 1 && count(isFace) === 1) {
    const [p] = of(isPoint), [face] = of(isFace);
    add("On face", "onplane", [p, face], (m) => onPlane(m, p, face));
  }
  if (n === 2 && count(isLine) === 2) {
    const [a, b] = uniq;
    add("Parallel", "par", [a, b], (m) => parallel(m, a, b));
    add("Perpendicular", "perp", [a, b], (m) => perpendicular(m, a, b));
    add("Equal", "eq", [a, b], (m) => equalLength(m, a, b));
    add("Collinear", "col", [a, b], (m) => collinear(m, a, b));
  }
  if (n === 2 && count(isLine) === 1 && (count(isAxis) === 1 || count(isFace) === 1)) {
    const [l] = of(isLine), [ref] = uniq.filter((x) => x !== l);
    // A plane's normal — a face's, or a frame's z — is what the line is
    // Normal to or square to; an x or y arm is a direction like any line's.
    const plane = isFace(k[uniq.indexOf(ref)]) ? "face" : zAxis(ref) ? "plane" : null;
    add(plane ? `Normal to ${plane}` : "Parallel", "par", [l, ref], (m) => parallel(m, l, ref));
    add(plane ? `Parallel to ${plane}` : "Perpendicular", "perp", [l, ref], (m) => perpendicular(m, l, ref));
  }
  if (n === 2 && count(isLine) === 1 && count((x) => isCircular(x) || x === "ellipse") === 1) {
    const [l] = of(isLine), [c] = uniq.filter((x) => x !== l);
    add("Tangent", "tan", [l, c], (m) => tangent(m, l, c));
    if (model.entities.get(c)?.kind === "arc") add("Equal length", "eq", [l, c], (m) => equalLength(m, l, c));
  }
  if (n === 2 && count(isCircular) === 2) {
    const [a, b] = uniq;
    add("Concentric", "conc", [a, b], (m) => concentric(m, a, b));
    add("Coradial", "corad", [a, b], (m) => coradial(m, a, b));
    add("Equal", "eq", [a, b], (m) => equalLength(m, a, b));
    for (const side of tangentSides(model, a, b)) {
      add(`Tangent (${side})`, "tan", [a, b, side], (m) => tangent(m, a, b, side));
    }
  }
  // Tangent at a spline's end: offered with a line, a circle or an arc, or
  // another spline — greyed with the relation's own words when no end meets.
  if (n === 2 && count(is("spline")) >= 1 && count((x) => isLine(x) || isCircular(x) || x === "spline") === 2) {
    const [a, b] = uniq;
    add("Tangent", "tan", [a, b], (m) => tangent(m, a, b), tangentSplineRefusal(model, a, b) ?? undefined);
  }
  if (n === 2 && count(isCentred) === 2 && !(count(isCircular) === 2)) {
    const [a, b] = uniq;
    add("Concentric", "conc", [a, b], (m) => concentric(m, a, b));
  }
  if (n === 3 && count(isPoint) === 3) {
    const [mid, a, b] = uniq;
    add("Midpoint", "mid", [mid, a, b], (m) => midpoint(m, mid, a, b));
  }
  if (n >= 3 && count(isPoint) === n) {
    add("Equal spacing", "spacing", [...uniq], (m) => equalSpacing(m, ...uniq));
  }
  // Symmetric: two of a kind about the third pick, a line or a frame's x or y.
  const mirror = n === 3 && (isLine(k[2]) || (isAxis(k[2]) && (!zAxis(uniq[2]) || threeD))) ? uniq[2] : null;
  const pair = (want: (x: PickClass | undefined) => boolean) => mirror !== null && want(k[0]) && want(k[1]);
  const symmetricCell = (): Applicable | null => {
    if (!mirror) return null;
    const [a, b] = uniq;
    const arcs = k[0] === "arc" || k[1] === "arc";
    if (!(pair(isPoint) || pair(isLine) || (pair(isCircular) && (!arcs || k[0] === k[1] || k[0] === "circle" || k[1] === "circle")))) return null;
    return { label: "Symmetric", text: call("sym", [a, b, mirror]), apply: (m) => symmetric(m, a, b, mirror) };
  };
  const sym = symmetricCell();
  // Three lines are Equal and Parallel as much as a pair and its mirror, so
  // the chain leads there and Symmetric stands after its first two.
  const lines3 = n === 3 && count(isLine) === 3;
  if (sym && !lines3) out.push(sym);
  if (n === 3 && count(isPoint) === 1 && count((x) => x !== undefined && ON_CURVE.has(x)) === 2) {
    const [p] = of(isPoint), [c1, c2] = uniq.filter((x) => x !== p);
    add("Intersection", "intersection", [p, c1, c2], (m) => intersection(m, p, c1, c2));
  }

  // --- many at once: one family, each against the first --------------------
  const fam = n >= 1 && k.every((x) => family(x) === family(k[0])) && isEntity(k[0]) ? family(k[0]) : undefined;
  if (fam) {
    const [first, ...rest] = uniq;
    const star = (op: string, f: (m: Model, a: string, b: string) => string): [string, string[], (m: Model) => string][] =>
      rest.map((b) => [op, [first, b], (m: Model) => f(m, first, b)]);
    const each = (op: string, f: (m: Model, a: string) => string): [string, string[], (m: Model) => string][] =>
      uniq.map((a) => [op, [a], (m: Model) => f(m, a)]);
    const level = (axis: "x" | "y") => (m: Model, a: string, b?: string) => b === undefined ? parallel(m, a, m.axisRef(axis)) : parallel(m, a, b, m.axisRef(axis));
    if (fam === "line" && n >= 3) {
      addMany(counted("Equal", n), star("eq", equalLength));
      addMany(counted("Parallel", n), star("par", parallel));
      if (sym) out.push(sym);
    }
    if (fam === "line" && n >= 2) {
      addMany(counted("Horizontal", n), each("horizontal", level("x")));
      addMany(counted("Vertical", n), each("vertical", level("y")));
    }
    if (fam === "point" && n >= 3) {
      addMany(counted("Coincident", n), star("coin", coincident));
      addMany(counted("Horizontal", n), star("horizontal", level("x")));
      addMany(counted("Vertical", n), star("vertical", level("y")));
    }
    if (fam === "circular" && n >= 3) {
      addMany(counted("Concentric", n), star("conc", concentric));
      addMany(counted("Coradial", n), star("corad", coradial));
      addMany(counted("Equal", n), star("eq", equalLength));
    }
    if (fam === "ellipse" && n >= 3) addMany(counted("Concentric", n), star("conc", concentric));
    out.push(...fixCells(model, uniq));
  }
  if (dimension) out.push(dimension);
  return out;
}

/**
 * Which ways two circles can be typed tangent, the nearer as the drawing
 * stands first — or one, read off the drawing, for two arcs sharing an end,
 * whose join decides the side (geometry.ts's `tangentCircles`). Each typed
 * with its side, so the command line shows which: Onshape's one Tangent
 * guesses, and a guess the other way round is a drawing that flips.
 */
function tangentSides(model: Model, a: string, b: string): string[] {
  const ca = model.circular(a), cb = model.circular(b);
  const d = Math.hypot(...model.coords(ca.center).map((v, i) => v - model.coords(cb.center)[i]));
  const ra = model.radius(a), rb = model.radius(b);
  const outside = Math.abs(d - (ra + rb)) <= Math.abs(d - Math.abs(ra - rb));
  const [ea, eb] = [model.entities.get(a), model.entities.get(b)];
  const joined = ea?.kind === "arc" && eb?.kind === "arc" && [ea.start, ea.end].some((p) => p === eb.start || p === eb.end);
  const near = outside ? "outside" : "inside", far = outside ? "inside" : "outside";
  return joined ? [near] : [near, far];
}

/**
 * **Fix**, for one pick or many (SolidWorks' Fix): one `fix` per point the
 * picks are built of (`Model.refsOf`; a point is its own), each where it
 * stands in the default frame — so a circle is pinned by its centre and an
 * arc by its centre and ends, and a circle's radius stays free (a radius is
 * no point; dimension it). Greyed with the model's own words where there is
 * no frame to pin in.
 */
function fixCells(model: Model, picks: string[]): Applicable[] {
  const points: string[] = [];
  for (const p of picks) {
    const e = model.entities.get(p);
    if (!e) continue;
    for (const q of e.kind === "point" ? [p] : model.refsOf(e)) if (!points.includes(q)) points.push(q);
  }
  if (!points.length) return [];
  const label = counted("Fix", picks.length);
  const at = points.map((p) => frameCoords(model, p));
  const refusal = at.find((a): a is string => typeof a === "string");
  if (refusal) return [{ label, text: "", apply: () => { throw new Error(refusal); }, off: refusal }];
  const coords = at as number[][];
  return [{
    label,
    text: points.map((p, i) => call("fix", [p, { raw: `[${coords[i].map(String).join(", ")}]` }])).join("; "),
    apply: (m) => points.map((p, i) => fix(m, p, coords[i])).join(", "),
  }];
}
