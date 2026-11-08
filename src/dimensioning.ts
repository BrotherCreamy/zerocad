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

import { entityKind, parseAxisRef, parsePointTriple, type FeatureEntry, type Model } from "./model.ts";
import { dist, coincident, fix, midpoint, onPlane } from "./relations/basic.ts";
import {
  angle, collinear, concentric, coradial, diameter, equalLength, equalSpacing, intersection, majorAxis, minorAxis,
  onEllipse, parallel, perpendicular, pierce, pointOnLine, radius, symmetric, tangent, onCircle,
} from "./relations/geometry.ts";
import { onSpline, tangentSplineRefusal } from "./relations/spline.ts";
import { frameBasis } from "./relations/refs.ts";
import { directionNow, measure, measured, solidGeometry } from "./relations/measure.ts";
import { angle3, arcLength, distAlong } from "./relations/smartdim.ts";
import { edgeSource, faceDistance, faceSource, planeNow } from "./relations/solidref.ts";
import { formatValue } from "./glyphs.ts";
import { dot3 } from "./vec3.ts";
import { loadedModules } from "./modules.ts";

const len3 = (v: number[]) => Math.hypot(...v);

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

const q = (s: string) => JSON.stringify(s);
const call = (op: string, args: (string | number | { raw: string })[]) =>
  `${op}(${args.map((a) => (typeof a === "number" ? String(a) : typeof a === "string" ? q(a) : a.raw)).join(", ")})`;

// The kinds this module tells apart. A sketch entity is its own kind; a frame's
// axis (`"f1.x"`) is a direction; a solid's flat face is `face`, its round
// wall the member it was swept from, its edge the entity it is (solidref.ts);
// what only the kernel knows is `kface` or `kedge` — measured, never held.
type Kind = "point" | "line" | "circle" | "arc" | "frame" | "ellipse" | "spline" | "earc" | "bspline";
const kindOf = (model: Model, n: string): Kind | undefined => model.entities.get(n)?.kind;
const isCurve = (k: Kind | undefined) => k === "circle" || k === "arc";

/** What one picked name is, for the table: an entity's kind, or what a solid's name resolves to. */
type Ref =
  | { kind: Kind; name: string }
  | { kind: "axis"; name: string; frame: string; axis: "x" | "y" | "z" }
  | { kind: "face"; name: string }
  | { kind: "kface"; name: string; shape: "plane" | "cylinder" | "other" }
  | { kind: "kedge"; name: string };

/**
 * A picked name read for the table — a solid's names resolved to what holds
 * them, where something does: a round wall to the circle or arc it was swept
 * from (so its radius is that curve's `rad`), an edge between two of one
 * extrude's faces to its entity (so its length is that line's). Null for a
 * name nothing knows.
 */
function refOf(model: Model, name: string): Ref | null {
  const k = kindOf(model, name);
  if (k) return { kind: k, name };
  let axis: ReturnType<typeof parseAxisRef> = null;
  try {
    axis = parseAxisRef(name);
  } catch {
    axis = null;
  }
  if (axis && model.isFrame(axis.frame)) return { kind: "axis", name, frame: axis.frame, axis: axis.axis };
  const s = faceSource(model, name);
  if (s?.kind === "cap" || (s?.kind === "wall" && s.shape === "plane")) return { kind: "face", name };
  if (s?.kind === "wall" && s.shape === "cylinder" && s.whole) return refOf(model, s.entity);
  const edge = edgeSource(model, name);
  if (edge) return refOf(model, edge);
  const g = solidGeometry(model, name);
  if (!g) return null;
  if (g.kind === "edge") return { kind: "kedge", name };
  return { kind: "kface", name, shape: g.kind === "plane" ? "plane" : g.kind === "cylinder" ? "cylinder" : "other" };
}

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

/** Where the dimension's label is put, on screen — what decides SolidWorks' horizontal, vertical or aligned. */
export interface Placement {
  /** A world point on screen, as the drawing is projected (the tool's `ctx.toScreen`). */
  toScreen(world: number[]): [number, number];
  at: [number, number];
}

/** The options the dimension tool is armed with that change what it types. */
export interface DimensionOptions {
  /**
   * A circle's or arc's size as its radius or its diameter. `auto`, the
   * default, is SolidWorks': a whole circle's diameter, an arc's radius.
   */
  radial?: "auto" | "radius" | "diameter";
  /** Older spelling of `radial: "diameter"`. */
  diameter?: boolean;
  /** A reference dimension: `measure(…)`, which measures and constrains nothing. */
  driven?: boolean;
  /**
   * Where the label goes. Two points (a line's ends, two centres) placed
   * beyond both along the drawing's y read their distance along its x — the
   * horizontal dimension — and beyond both along its x, along its y; between,
   * the true distance. An ellipse's label nearer its minor axis is its minor.
   * Absent: the true distance, the major.
   */
  place?: Placement;
}

/**
 * One thing a selection can be given: a label, the command it types, and the
 * call that command is — and, for a dimension, what it reads (`reading`, the
 * label's text), the driven one it becomes if it may not drive (`driven`),
 * and, where the picks are a dimension the drawing already has (an extrude's
 * lid to its own base is its depth), that dimension's name instead (`edits`).
 */
export interface Applicable {
  label: string;
  text: string;
  apply(model: Model): string;
  reading?: string;
  driven?: Applicable;
  edits?: string;
  /**
   * **When set, greys it**: the reason it cannot be applied as the drawing
   * stands (a spline whose end meets nothing, a face the solid kernel
   * computed), shown rather than left out so "why is there no Tangent here"
   * is answered where it is asked. A greyed one types nothing.
   */
  off?: string;
}

/** A driving dimension, with the driven one it becomes when it may not drive. */
function driving(label: string, text: string, apply: (m: Model) => string, reading: string,
  kind: string, names: string[]): Applicable {
  return { label, text, apply, reading, driven: reference(label, kind, names, reading) };
}

/** The driven dimension of `kind` over `names`: `measure(kind, …)`, its reading in parentheses. */
function reference(label: string, kind: string, names: string[], reading: string): Applicable {
  return {
    label: `${label} (driven)`, text: call("measure", [kind, ...names]), apply: (m) => measure(m, kind, ...names),
    reading: `(${reading})`,
  };
}

const deg = (rad: number) => (rad * 180) / Math.PI;

/** The drawing's x and y — the work plane's, else the default frame's, else the origin's — as `along` names them. */
function drawingAxes(model: Model): [string, string] | null {
  try {
    return [model.axisRef("x"), model.axisRef("y")];
  } catch {
    return null;
  }
}

/**
 * Which way a distance between world points `a` and `b` is read, by where its
 * label is put (SolidWorks'): beyond both along the drawing's y, along its x;
 * beyond both along its x, along its y; else the true distance. In the screen
 * coordinates of the drawing's two axes as they are drawn, so it reads the
 * same in a tilted 3D view as square-on. Null for the true distance, and when
 * the plane is seen edge-on or the reading would be the true one anyway.
 */
function placedAxis(model: Model, a: number[], b: number[], place: Placement | undefined): string | null {
  const axes = place ? drawingAxes(model) : null;
  if (!place || !axes) return null;
  const dirs = axes.map((ax) => directionNowOf(model, ax));
  const s = (w: number[]) => place.toScreen(w);
  const o = s(a);
  const ex = sub2(s(a.map((v, i) => v + (dirs[0][i] ?? 0))), o), ey = sub2(s(a.map((v, i) => v + (dirs[1][i] ?? 0))), o);
  const det = ex[0] * ey[1] - ex[1] * ey[0];
  if (Math.abs(det) < 1e-9 * Math.hypot(...ex) * Math.hypot(...ey) || Math.abs(det) < 1e-12) return null;
  // Screen offsets in the axes' own coordinates.
  const local = (p: [number, number]) => {
    const [dx, dy] = sub2(p, o);
    return [(dx * ey[1] - dy * ey[0]) / det, (ex[0] * dy - ex[1] * dx) / det];
  };
  const [pa, pb, pc] = [[0, 0], local(s(b)), local(place.at)];
  const within = (i: number) => pc[i] >= Math.min(pa[i], pb[i]) && pc[i] <= Math.max(pa[i], pb[i]);
  const d = b.map((v, i) => v - a[i]);
  const along = (k: number) => Math.abs(d.reduce((acc, v, i) => acc + v * (dirs[k][i] ?? 0), 0));
  const full = Math.hypot(...d);
  // Placed beyond both across the axis and between them along it: that axis.
  const pick = within(0) && !within(1) ? 0 : within(1) && !within(0) ? 1 : -1;
  if (pick < 0 || roundValue(along(pick)) === roundValue(full)) return null;
  return axes[pick as 0 | 1];
}

const sub2 = (p: [number, number], q: [number, number]): [number, number] => [p[0] - q[0], p[1] - q[1]];

const directionNowOf = directionNow;

/** A frame's origin, as numbers — `along`'s first side may be a frame. */
function frameOrigin(model: Model, frame: string): number[] {
  return frameBasis(model, frame)().origin.slice(0, model.dim);
}

/**
 * The distance between two points, as the placement reads it: `dist` the
 * true one, or `along` the drawing's x or y. `a` may be a frame (its origin).
 */
function pointDistance(model: Model, a: string, b: string, opts: DimensionOptions, label = "Distance"): Applicable {
  const at = (n: string) => (model.isFrame(n) ? frameOrigin(model, n) : model.coords(n));
  const axis = placedAxis(model, at(a), at(b), opts.place);
  if (axis) {
    const v = roundValue(measured(model, ["along", a, b, axis]));
    const which = axis.endsWith(".x") ? "Horizontal" : "Vertical";
    const plan = driving(`${which} ${label.toLowerCase()}`, call("along", [a, b, axis, v]), (m) => distAlong(m, a, b, axis, v), formatValue(v), "along", [a, b, axis]);
    return opts.driven ? plan.driven! : plan;
  }
  const v = roundValue(measured(model, ["dist", a, b]));
  const plan = driving(label, call("dist", [a, b, v]), (m) => dist(m, a, b, v), formatValue(v), "dist", [a, b]);
  return opts.driven ? plan.driven! : plan;
}

/** A point, a line or a curve's centre: what a distance is measured from. */
function anchorPoint(model: Model, r: Ref): string | null {
  if (r.kind === "point") return r.name;
  if (r.kind === "circle" || r.kind === "arc") return model.circular(r.name).center;
  return null;
}

/**
 * **The dimension the picks make**, holding what it measures now — or null for
 * picks that make none (yet). The whole table is in
 * docs/plans/smart-dimension.md ("As built"); in the order picked:
 *
 * - one line: its length (`dist` of its ends, or `along` placed beyond them);
 * - one circle: its diameter, one arc: its radius (`radial` says otherwise);
 * - one ellipse: its major semi-axis, or its minor placed nearer that axis;
 * - one spline: its ends' distance; one kernel edge: its length, driven;
 * - two points, a point and a curve's centre, two centres: the distance —
 *   true, horizontal or vertical by placement;
 * - a point and a line, a line and a curve's centre: the distance square to the line;
 * - two lines: the angle, or the distance when they are parallel;
 * - a line and a frame's axis: the angle; a point and an axis: its distance
 *   from it, along the frame's other axis;
 * - two faces of a solid, a face and a point, a face and an edge: the
 *   distance square to the face (`fdist`) when they are parallel, else the
 *   angle — through the lines they were swept from where one extrude made
 *   both (`dist`, `ang` on its sketch), and an extrude's lid to its own base
 *   is its depth (`edits`);
 * - three points: the angle at the first (`ang3`); a point and two lines:
 *   their angle; an arc and its two ends: its length (`arclen`).
 *
 * Driven, each is the `measure` of the same thing, which holds nothing; what
 * only the kernel knows (a fillet's face) is driven whatever was asked.
 */
export function dimensionFor(model: Model, names: readonly string[], opts: DimensionOptions = {}): Applicable | null {
  if (new Set(names).size !== names.length) return null;
  const refs = names.map((n) => refOf(model, n));
  if (refs.some((r) => r === null)) return null;
  const r = refs as Ref[];
  const driven = opts.driven === true;
  const pick = (plan: Applicable | null) => (plan && driven && plan.driven ? plan.driven : plan);
  if (r.length === 1) return pick(oneThing(model, r[0], opts));
  if (r.length === 2) return pick(twoThings(model, r[0], r[1], opts));
  if (r.length === 3) return pick(threeThings(model, r));
  return null;
}

function oneThing(model: Model, a: Ref, opts: DimensionOptions): Applicable | null {
  if (a.kind === "line") {
    const [p, q] = model.line(a.name).refs;
    return pointDistance(model, p, q, opts, "Length");
  }
  if (a.kind === "circle" || a.kind === "arc") {
    const radial = opts.radial ?? (opts.diameter ? "diameter" : "auto");
    const dia = radial === "diameter" || (radial === "auto" && a.kind === "circle");
    const c = a.name;
    const v = roundValue(dia ? 2 * model.radius(c) : model.radius(c));
    return dia
      ? driving("Diameter", call("dia", [c, v]), (m) => diameter(m, c, v), `⌀${formatValue(v)}`, "diameter", [c])
      : driving("Radius", call("rad", [c, v]), (m) => radius(m, c, v), `R${formatValue(v)}`, "radius", [c]);
  }
  if (a.kind === "ellipse") {
    const e = a.name;
    const minor = opts.place ? nearerMinor(model, e, opts.place) : false;
    const v = roundValue(measured(model, [minor ? "minor" : "major", e]));
    return minor
      ? driving("Minor semi-axis", call("minor", [e, v]), (m) => minorAxis(m, e, v), `b${formatValue(v)}`, "minor", [e])
      : driving("Major semi-axis", call("major", [e, v]), (m) => majorAxis(m, e, v), `a${formatValue(v)}`, "major", [e]);
  }
  if (a.kind === "spline") {
    const s = model.entities.get(a.name);
    if (s?.kind !== "spline" || s.closed || s.points.length < 2) return null;
    return pointDistance(model, s.points[0], s.points[s.points.length - 1], opts, "End to end");
  }
  if (a.kind === "kedge") {
    const v = measured(model, ["length", a.name]);
    return Number.isFinite(v) ? reference("Edge length", "length", [a.name], formatValue(v)) : null;
  }
  if (a.kind === "kface" && a.shape === "cylinder") {
    const radial = opts.radial ?? (opts.diameter ? "diameter" : "auto");
    const kind = radial === "radius" ? "radius" : "diameter";
    const v = measured(model, [kind, a.name]);
    return reference(kind === "radius" ? "Radius" : "Diameter", kind, [a.name], `${kind === "radius" ? "R" : "⌀"}${formatValue(v)}`);
  }
  return null;
}

/** Whether a label at `place` is nearer an ellipse's minor axis than its major. */
function nearerMinor(model: Model, e: string, place: Placement): boolean {
  const el = model.entities.get(e);
  if (el?.kind !== "ellipse") return false;
  const c = place.toScreen(model.coords(el.center));
  const m = place.toScreen(model.coords(el.major));
  const u = sub2(m, c), w = sub2(place.at, c);
  const lu = Math.hypot(...u), lw = Math.hypot(...w);
  if (!(lu > 0) || !(lw > 0)) return false;
  return Math.abs((u[0] * w[0] + u[1] * w[1]) / (lu * lw)) < Math.SQRT1_2;
}

function twoThings(model: Model, a: Ref, b: Ref, opts: DimensionOptions): Applicable | null {
  // A solid's faces first: what they hold is decided by what made them.
  if (a.kind === "face" || b.kind === "face" || a.kind === "kface" || b.kind === "kface") return faces(model, a, b);
  if (a.kind === "kedge" || b.kind === "kedge") return null;
  if (a.kind === "line" && b.kind === "line") {
    if (!parallelLines(model, a.name, b.name)) return lineAngle(model, a.name, b.name);
    const v = roundValue(measured(model, ["dist", a.name, b.name]));
    return driving("Distance", call("dist", [a.name, b.name, v]), (m) => dist(m, a.name, b.name, v), formatValue(v), "dist", [a.name, b.name]);
  }
  // A line and a frame's axis: the angle to it.
  if ((a.kind === "line" && b.kind === "axis") || (a.kind === "axis" && b.kind === "line")) {
    const [l, x] = a.kind === "line" ? [a.name, b.name] : [b.name, a.name];
    if (Math.sin(measured(model, ["angle", l, x])) < PARALLEL_SIN) return null;
    return lineAngle(model, l, x);
  }
  // A point (or a centre) and a frame's axis: how far from it, along the frame's other axis in its plane.
  if (a.kind === "axis" || b.kind === "axis") {
    const [ax, other] = (a.kind === "axis" ? [a, b] : [b, a]) as [Extract<Ref, { kind: "axis" }>, Ref];
    const p = anchorPoint(model, other);
    if (!p || ax.axis === "z") return null;
    const across = `${ax.frame}.${ax.axis === "x" ? "y" : "x"}`;
    const v = roundValue(measured(model, ["along", ax.frame, p, across]));
    const plan = driving("Distance from the axis", call("along", [ax.frame, p, across, v]), (m) => distAlong(m, ax.frame, p, across, v),
      formatValue(v), "along", [ax.frame, p, across]);
    return opts.driven ? plan.driven! : plan;
  }
  // A point and a line, either way round: square to the line.
  if ((a.kind === "point" && b.kind === "line") || (a.kind === "line" && b.kind === "point")) {
    const v = roundValue(measured(model, ["dist", a.name, b.name]));
    return driving("Distance", call("dist", [a.name, b.name, v]), (m) => dist(m, a.name, b.name, v), formatValue(v), "dist", [a.name, b.name]);
  }
  // A line and a curve: its centre square to the line.
  if ((a.kind === "line" && isCurve(b.kind as Kind)) || (isCurve(a.kind as Kind) && b.kind === "line")) {
    const [l, c] = a.kind === "line" ? [a.name, anchorPoint(model, b)!] : [b.name, anchorPoint(model, a)!];
    const v = roundValue(measured(model, ["dist", c, l]));
    return driving("Distance", call("dist", [c, l, v]), (m) => dist(m, c, l, v), formatValue(v), "dist", [c, l]);
  }
  // Points and centres: the distance between them, as the placement reads it.
  const [p, q] = [anchorPoint(model, a), anchorPoint(model, b)];
  if (p && q && p !== q) return pointDistance(model, p, q, opts, isCurve(a.kind as Kind) || isCurve(b.kind as Kind) ? "Centre distance" : "Distance");
  return null;
}

function lineAngle(model: Model, a: string, b: string): Applicable {
  const d = roundValue(angleDegrees(model, a, b));
  return driving("Angle", call("ang", [a, b, { raw: `deg(${d})` }]), (m) => angle(m, a, b, radiansOf(d)), `${formatValue(d)}°`, "angle", [a, b]);
}

/** Below this |sin| two faces (or a face and an edge) are parallel, and what is between them is a distance. */
const PARALLEL_FACE = 1e-6;

/**
 * Two things at least one of which is a solid's face. What it is decided by
 * what made the faces (smart-dimension.md, design 4):
 *
 * - an extrude's lid and its own base: its depth — the dimension the drawing
 *   already has, which a second one could only repeat or contradict;
 * - two walls one extrude swept from lines: those lines, on the sketch —
 *   `dist` when parallel, `ang` when not, which follow the sketch through
 *   any regeneration;
 * - two walls of extrudes going the same way: the angle between their lines;
 * - parallel otherwise: `fdist`, square to the first flat face; not
 *   parallel: the angle between the planes, driven;
 * - a face and a point or an edge: `fdist`, the edge when it lies parallel;
 * - anything only the kernel knows: the same readings, driven.
 */
function faces(model: Model, a: Ref, b: Ref): Applicable | null {
  const sa = a.kind === "face" ? faceSource(model, a.name) : null;
  const sb = b.kind === "face" ? faceSource(model, b.name) : null;
  if (sa && sb && sa.feature === sb.feature && sa.kind === "cap" && sb.kind === "cap" && sa.which !== sb.which && sa.feature.kind === "extrude") {
    const depth = sa.feature.depth;
    const v = model.relations.get(depth)?.args[1];
    const reading = typeof v === "number" ? formatValue(Math.abs(v)) : "?";
    return {
      label: `Depth of ${sa.feature.name} (${depth})`, text: `set(${q(`${depth}.value`)}, `, edits: depth, reading,
      apply: () => depth,
    };
  }
  if (sa?.kind === "wall" && sb?.kind === "wall" && sa.whole && sb.whole && sameDirection(model, sa.feature, sb.feature)) {
    const [la, lb] = [sa.entity, sb.entity];
    if (sa.feature === sb.feature && parallelLines(model, la, lb)) {
      const v = roundValue(measured(model, ["dist", la, lb]));
      return driving("Distance", call("dist", [la, lb, v]), (m) => dist(m, la, lb, v), formatValue(v), "dist", [la, lb]);
    }
    if (!parallelLines(model, la, lb)) {
      // Two walls meeting at an edge: the solid's angle there is the
      // profile's corner — a wedge's 30°, where the two lines' own
      // directions could read 150° — so it is the angle at that corner.
      const [ra, rb] = [model.line(la).refs, model.line(lb).refs];
      const corner = ra.find((p) => rb.includes(p));
      if (corner && sa.feature === sb.feature) {
        const [p, q] = [ra.find((x) => x !== corner)!, rb.find((x) => x !== corner)!];
        return threeThings(model, [corner, p, q].map((n) => ({ kind: "point" as const, name: n })));
      }
      return lineAngle(model, la, lb);
    }
  }
  const ga = solidGeometry(model, a.name), gb = solidGeometry(model, b.name);
  const plane = ga?.kind === "plane" ? ga : gb?.kind === "plane" ? gb : null;
  if (!plane) return null;
  const [face, other, otherGeom] = plane === ga ? [a, b, gb] : [b, a, ga];
  // Only the model's faces drive; a kernel face is read, and only read.
  const drives = face.kind === "face" && (other.kind === "face" || other.kind === "point" || other.kind === "line"
    || other.kind === "circle" || other.kind === "arc");
  const fd = (): Applicable | null => {
    const v = roundValue(measured(model, ["fdist", face.name, other.name]));
    if (!Number.isFinite(v)) return null;
    const names = [face.name, other.name];
    return drives
      ? driving("Distance to the face", call("fdist", [face.name, other.name, v]), (m) => faceDistance(m, face.name, other.name, v), formatValue(v), "fdist", names)
      : reference("Distance to the face", "fdist", names, formatValue(v));
  };
  if (otherGeom?.kind === "plane") {
    const s = Math.sqrt(Math.max(0, 1 - (dot3(plane.normal, otherGeom.normal) / (len3(plane.normal) * len3(otherGeom.normal))) ** 2));
    if (s < PARALLEL_FACE) return fd();
    const v = measured(model, ["fangle", face.name, other.name]);
    return reference("Angle between the faces", "fangle", [a.name, b.name], `${formatValue(roundValue(deg(v)))}°`);
  }
  if (otherGeom?.kind === "edge") {
    const [p, e] = otherGeom.ends;
    const u = p.map((x, i) => e[i] - x);
    const across = Math.abs(dot3(u, plane.normal)) / (len3(u) * len3(plane.normal));
    return across < PARALLEL_FACE ? fd() : null;
  }
  if (other.kind === "point" || other.kind === "circle" || other.kind === "arc") return fd();
  return null;
}

/** Whether two features sweep the same way — extrudes whose sketch planes are parallel. */
function sameDirection(model: Model, f: FeatureEntry, g: FeatureEntry): boolean {
  if (f.kind !== "extrude" || g.kind !== "extrude") return false;
  if (f === g) return true;
  const [n, m] = [planeNow(model, `${f.name}.base`), planeNow(model, `${g.name}.base`)];
  if (!n || !m) return false;
  return Math.abs(Math.abs(dot3(n.n, m.n)) - 1) < 1e-9;
}

function threeThings(model: Model, r: Ref[]): Applicable | null {
  const kinds = r.map((x) => x.kind);
  if (kinds.every((k) => k === "point")) {
    const [v, a, b] = r.map((x) => x.name);
    const d = roundValue(deg(measured(model, ["angle3", v, a, b])));
    return driving("Angle at a vertex", call("ang3", [v, a, b, { raw: `deg(${d})` }]), (m) => angle3(m, v, a, b, radiansOf(d)),
      `${formatValue(d)}°`, "angle3", [v, a, b]);
  }
  if (kinds.filter((k) => k === "point").length === 1 && kinds.filter((k) => k === "line").length === 2) {
    const [l1, l2] = r.filter((x) => x.kind === "line").map((x) => x.name);
    return lineAngle(model, l1, l2);
  }
  const arcs = r.filter((x) => x.kind === "arc");
  if (arcs.length === 1) {
    const arc = model.arc(arcs[0].name);
    const pts = r.filter((x) => x.kind === "point").map((x) => x.name);
    if (pts.length === 2 && pts.includes(arc.start) && pts.includes(arc.end)) {
      const v = roundValue(measured(model, ["arclen", arc.name]));
      return driving("Arc length", call("arclen", [arc.name, v]), (m) => arcLength(m, arc.name, v), `⌒${formatValue(v)}`, "arclen", [arc.name]);
    }
  }
  return null;
}

/**
 * Whether the picks so far could still become a dimension with one more —
 * what keeps the tool collecting a third pick (three points, an arc and its
 * ends, a point and two lines) rather than starting again from it.
 */
export function takesThird(model: Model, names: readonly string[], next: string): boolean {
  return names.length === 2 && dimensionFor(model, [...names, next]) !== null;
}

/**
 * **Why a dimension just added may not drive** — SolidWorks' "make this
 * dimension driven?", answered rather than asked (the owner: the house never
 * asks; it says so in the log): it is redundant (`Model.diagnose` names it —
 * the drawing already holds what it measures), or it conflicts (the solve
 * fails, and `Model.conflicting` names it among the set that disagrees). Null
 * when it drives. Asked of a model the dimension was added to — the tool's
 * throwaway copy (`ctx.preview`), or the drawing itself headless.
 */
export function drivenBecause(model: Model, made: string): string | null {
  const report = model.solve();
  if (!report.solved) {
    const c = model.conflicting(report);
    if (c.relations.includes(made) || report.collapsed.length) {
      const others = c.relations.filter((n) => n !== made);
      return `it would conflict${others.length ? ` with ${others.join(", ")}` : ""}`;
    }
    return null;
  }
  if (model.diagnose().redundant.includes(made)) return "what it measures is already held";
  return null;
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
  // Geometry a relation can move: not a reference, and not a frame — a frame is a
  // datum, picked by its arm as an axis, and nothing here fixes or chains one.
  const isEntity = (x: PickClass | undefined) => x !== undefined && x !== "axis" && x !== "face" && x !== "frame";
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
  // Symmetric: two of a kind about a line or a frame's x or y — picked in any
  // order, as SolidWorks takes them: the mirror is whichever pick is the line
  // when the other two are points or circles (found merging #84: two circles
  // then the line listed Symmetric, the line first listed nothing). Three
  // lines are the one ambiguous case, and there the third pick is the mirror.
  const mirrorAt = (i: number) => isLine(k[i]) || (isAxis(k[i]) && (!zAxis(uniq[i]) || threeD));
  const symmetricCell = (): Applicable | null => {
    if (n !== 3) return null;
    for (const i of [2, 0, 1]) {
      if (!mirrorAt(i)) continue;
      const [ia, ib] = [0, 1, 2].filter((j) => j !== i);
      const [ka, kb] = [k[ia], k[ib]];
      const both = (want: (x: PickClass | undefined) => boolean) => want(ka) && want(kb);
      const arcs = ka === "arc" || kb === "arc";
      const ok = both(isPoint) || (i === 2 && both(isLine))
        || (both(isCircular) && (!arcs || ka === kb || ka === "circle" || kb === "circle"));
      if (!ok) continue;
      const [a, b, mirror] = [uniq[ia], uniq[ib], uniq[i]];
      return { label: "Symmetric", text: call("sym", [a, b, mirror]), apply: (m) => symmetric(m, a, b, mirror) };
    }
    return null;
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
