// STEP export: the model's solids as an ISO 10303-21 ("Part 21") file — what
// SolidWorks, Fusion, Onshape, FreeCAD, Inventor and every CAM tool read
// (docs/plans/step-export.md). The owner: *"also, please add step export"*.
//
// A pure function from the model to text: no DOM, no dependency, written by
// hand. solids.ts says what the solids exactly are; this file only spells them
// in Part 21. Getting the text to a person — the share sheet on a phone, a
// download elsewhere — is the files package's (filehost.ts), through
// `exportStep()` in replenv.ts.
//
// **AP214 (`AUTOMOTIVE_DESIGN`), not AP242.** Both carry B-rep solids with the
// very same entities (ISO 10303-42's, through the advanced-B-rep class), so for
// a part that is only geometry AP242 adds nothing a reader would use. What
// differs is who reads them: AP214 has been read by every CAD and CAM tool for
// twenty years, AP242 only by the ones updated since 2014–2020, and a reader
// that takes AP242 takes AP214 too — it is what SolidWorks, Fusion and
// FreeCAD/OpenCascade write by default. The widest set of readers is AP214's.
//
// **The file**: one product (the document), one shape representation in
// millimetres and radians with a length uncertainty, and in it one
// `MANIFOLD_SOLID_BREP` per body (solids.ts: one per feature), named for the
// feature, so a receiving tool shows `e1`, `e2` as its bodies. Each is a
// `CLOSED_SHELL` of `ADVANCED_FACE`s whose every edge is one `EDGE_CURVE`,
// used by two faces in opposite senses. Optionally, the sketch curves no solid
// is made of, as a `GEOMETRIC_CURVE_SET` in a wireframe representation related
// to the solids' (`curves: true`).

import type { Model } from "./model.ts";
import { chainsOf } from "./modes.ts";
import { looseCurves, solidsOf, type Body, type Curve, type Edge, type Face, type LooseCurve, type Shell, type Surface, type Vertex } from "./solids.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";
import type { NurbsCurve, NurbsSurface } from "./solids/kernel.ts";

/** The file's media type: `model/step`, IANA-registered for ISO 10303-21 with the `.step` and `.stp` extensions. */
export const STEP_TYPE = "model/step";
export const STEP_SUFFIX = ".step";

/**
 * The schema: AP214's, as its readers and writers spell it — the ASN.1 object
 * identifier of the AP214 edition every reader recognises.
 */
export const STEP_SCHEMA = "AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }";

/**
 * The length uncertainty the file declares, in millimetres: how far apart two
 * things may be and still be one. OpenCascade writes the same; it is what a
 * reader sizes its vertex and edge tolerances from. The geometry is far closer
 * than this — a solve converges to a few parts in 10¹² — so nothing is near it.
 */
export const STEP_UNCERTAINTY = 1e-7;

/**
 * The uncertainty a file declares when it carries a curve the solid kernel
 * computed — where a boss's cylinder meets a curved wall, a B-spline that is
 * the intersection to SMLib's own tolerance, not exactly. Measured: OpenCascade
 * reading such a file widens those edges' tolerance to 3.1e-6 mm to fit them
 * to their surfaces; a file claiming 1e-7 there would be claiming more than
 * it holds. Every file with no such curve still declares 1e-7.
 */
export const KERNEL_CURVE_UNCERTAINTY = 1e-5;

export interface StepOptions {
  /** The document's name: the product's, and the file's. "Untitled" when not given. */
  name?: string;
  /** Also write the sketch curves no solid is made of, as wireframe. Off by default. */
  curves?: boolean;
  /** The time stamp in the header, ISO 8601 — now when not given; a test pins it. */
  timestamp?: string;
  /** What wrote it: the header's preprocessor and originating system. */
  system?: string;
}

export interface StepExport {
  text: string;
  /** The bodies written, in order. */
  bodies: Body[];
  /** Features left out, and why: hidden, or not something that could be laid out. */
  skipped: { feature: string; why: string }[];
  /** How many loose curves the wireframe has (zero without `curves`). */
  curves: number;
}

/**
 * A body the solid kernel built (bodies.ts, kernelbrep.ts): one solid for all
 * of its features, which are then not written one by one.
 */
export interface KernelSolid {
  body: Body;
  features: readonly string[];
}

/**
 * The model's shown solids as a STEP file. Throws, writing nothing, when there
 * is no solid to write: a file of nothing opens empty in every tool, which reads
 * as an export that failed.
 *
 * **One solid per body** (docs/plans/solids-kernel.md): a body of one feature
 * is solids.ts's, exactly as before the kernel shipped; a body the kernel
 * built — a plate with its holes and bosses — is handed in (`kernel`), its
 * features written as that one solid and not again on their own.
 */
export function stepExport(model: Model, options: StepOptions = {}, kernel: readonly KernelSolid[] = []): StepExport {
  const hidden = [...model.features.values()].filter((f) => model.hidden.has(f.name)).map((f) => f.name);
  // Every feature of a body of two or more is the kernel's to write — as that
  // body, never one by one (a cut written as a solid would be the opposite of
  // what it is). One the kernel did not hand in is left out and said.
  const given = new Set(kernel.flatMap((k) => k.features));
  const kernels = chainsOf(model, { hidden: true }).bodies.filter((c) => c.features.length > 1);
  const covered = new Set(kernels.flatMap((c) => c.features.map((f) => f.name)));
  const missing = kernels.filter((c) => !model.hidden.has(c.name) && !c.features.every((f) => given.has(f.name)));
  const rest = [...model.features.keys()].filter((n) => !covered.has(n) && !given.has(n));
  const own = solidsOf(model, rest);
  // In feature order: a body is where its first feature is.
  const order = [...model.features.keys()];
  const at = (b: Body) => order.indexOf(b.feature);
  const bodies = [...kernel.map((k) => k.body), ...own.bodies].sort((a, b) => at(a) - at(b));
  const skipped = [...own.skipped, ...missing.map((c) => ({ feature: c.name, why: "its body is the solid kernel's, which has not built it" }))];
  const left = [...skipped, ...hidden.map((feature) => ({ feature, why: "hidden" }))];
  if (bodies.length === 0) {
    if (model.features.size === 0) throw new Error("there is no solid to export — extrude or revolve a region first; a STEP file of nothing would open empty");
    throw new Error(`there is no solid to export — ${left.map((s) => `${s.feature}: ${s.why}`).join("; ")}`);
  }
  const loose = options.curves ? looseCurves(model) : [];
  return { text: write(bodies, loose, options), bodies, skipped: left, curves: loose.length };
}

/** The file a document called `name` is exported as: its name, cleaned as a drawing's is, and `.step`. */
export function stepFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return (clean || "Untitled") + STEP_SUFFIX;
}

// ---- Part 21's spelling -------------------------------------------------------------

/**
 * A REAL as Part 21 spells one: digits, a point, digits, and an exponent after
 * `E` — never JavaScript's bare `1` or `1e-7`. The shortest text that reads back
 * as the same double, so nothing is lost on the way out.
 */
export function real(x: number): string {
  if (!Number.isFinite(x)) throw new Error(`a STEP file cannot hold ${x}`);
  const [mantissa, exponent] = String(x === 0 ? 0 : x).split("e");
  const m = mantissa.includes(".") ? mantissa : `${mantissa}.`;
  return exponent === undefined ? m : `${m}E${exponent.replace("+", "")}`;
}

/**
 * A STRING as Part 21 spells one: in single quotes, a quote doubled, a
 * backslash doubled, and anything outside printable ASCII as `\X2\…\X0\`
 * (UTF-16 code units in hex) — a document called “Bracket–v2” is written as
 * itself rather than as mojibake.
 */
export function str(s: string): string {
  let out = "";
  let wide = "";
  const flush = () => { if (wide) out += `\\X2\\${wide}\\X0\\`; wide = ""; };
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0x20 && c <= 0x7e) {
      flush();
      const ch = s[i];
      out += ch === "'" ? "''" : ch === "\\" ? "\\\\" : ch;
    } else {
      wide += c.toString(16).toUpperCase().padStart(4, "0");
    }
  }
  flush();
  return `'${out}'`;
}

const list = (xs: (string | number)[]) => `(${xs.join(",")})`;
const ref = (n: number) => `#${n}`;
const bool = (b: boolean) => (b ? ".T." : ".F.");

/** The entity instances, numbered as they are added. */
class Data {
  readonly lines: string[] = [];

  add(entity: string): number {
    this.lines.push(entity);
    return this.lines.length;
  }

  point(p: number[]): number {
    return this.add(`CARTESIAN_POINT('',${list(p.map(real))})`);
  }

  direction(d: number[]): number {
    return this.add(`DIRECTION('',${list(d.map(real))})`);
  }

  placement(origin: number[], axis: number[], refDir: number[]): number {
    // The reference straightened against the axis, as Part 42 would, so a
    // reader never has to.
    const r = unit3(sub3(refDir, axis.map((c) => c * dot3(refDir, axis)))) ?? perpendicular(axis);
    return this.add(`AXIS2_PLACEMENT_3D('',${ref(this.point(origin))},${ref(this.direction(axis))},${ref(this.direction(r))})`);
  }

  circle(c: Extract<Curve, { kind: "circle" }>, name = ""): number {
    return this.add(`CIRCLE(${str(name)},${ref(this.placement(c.center, c.normal, c.ref))},${real(c.r)})`);
  }

  /** Part 42's ELLIPSE: placed at its centre, its first semi-axis along the placement's reference (docs/plans/sketch-shapes.md). */
  ellipse(c: Extract<Curve, { kind: "ellipse" }>, name = ""): number {
    return this.add(`ELLIPSE(${str(name)},${ref(this.placement(c.center, c.normal, c.ref))},${real(c.a)},${real(c.b)})`);
  }

  line(a: number[], b: number[], name = ""): number {
    const d = sub3(b, a);
    const len = Math.hypot(...d);
    const vector = this.add(`VECTOR('',${ref(this.direction(d.map((x) => x / len)))},${real(len)})`);
    return this.add(`LINE(${str(name)},${ref(this.point(a))},${ref(vector)})`);
  }
}

function perpendicular(n: number[]): number[] {
  const pick = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit3(cross3(n, cross3(pick, n)))!;
}

function surface(d: Data, s: Surface): number {
  switch (s.kind) {
    case "plane": return d.add(`PLANE('',${ref(d.placement(s.origin, s.axis, s.ref))})`);
    case "cylinder": return d.add(`CYLINDRICAL_SURFACE('',${ref(d.placement(s.origin, s.axis, s.ref))},${real(s.r)})`);
    case "cone": return d.add(`CONICAL_SURFACE('',${ref(d.placement(s.origin, s.axis, s.ref))},${real(s.r)},${real(s.semiAngle)})`);
    case "sphere": return d.add(`SPHERICAL_SURFACE('',${ref(d.placement(s.origin, s.axis, s.ref))},${real(s.r)})`);
    case "torus": return d.add(`TOROIDAL_SURFACE('',${ref(d.placement(s.origin, s.axis, s.ref))},${real(s.major)},${real(s.minor)})`);
    case "revolution": {
      const axis = d.add(`AXIS1_PLACEMENT('',${ref(d.point(s.origin))},${ref(d.direction(s.axis))})`);
      return d.add(`SURFACE_OF_REVOLUTION('',${ref(d.circle(s.curve))},${ref(axis)})`);
    }
    case "bspline": return bsplineSurface(d, s.nurbs);
    // An ellipse's wall: the ellipse swept along the extrude's direction —
    // exact, and what a receiving tool calls an elliptic cylinder.
    case "extrusion": {
      const vector = d.add(`VECTOR('',${ref(d.direction(s.axis))},${real(1)})`);
      return d.add(`SURFACE_OF_LINEAR_EXTRUSION('',${ref(d.ellipse(s.curve))},${ref(vector)})`);
    }
  }
}

/**
 * A kernel's NURBS surface, exactly: Part 42's B_SPLINE_SURFACE_WITH_KNOTS —
 * as the complex instance with RATIONAL_B_SPLINE_SURFACE when it has weights,
 * its parts listed alphabetically as Part 21 requires. Control points are the
 * kernel's own net, u-major (each inner list one u row), as Part 42 lists them.
 */
function bsplineSurface(d: Data, n: NurbsSurface): number {
  const [nu, nv] = n.count;
  const rows: string[] = [];
  const weights: string[] = [];
  for (let i = 0; i < nu; i++) {
    const row: number[] = [];
    const w: string[] = [];
    for (let j = 0; j < nv; j++) {
      const [x, y, z, wt] = n.points[i * nv + j];
      row.push(d.point([x, y, z]));
      w.push(real(wt));
    }
    rows.push(list(row.map(ref)));
    weights.push(list(w));
  }
  const [du, dv] = n.degree;
  const knots = `${list(n.mults[0])},${list(n.mults[1])},${list(n.knots[0].map(real))},${list(n.knots[1].map(real))},.UNSPECIFIED.`;
  if (!n.rational) {
    return d.add(`B_SPLINE_SURFACE_WITH_KNOTS('',${du},${dv},${list(rows)},.UNSPECIFIED.,.F.,.F.,.F.,${knots})`);
  }
  return d.add(`(BOUNDED_SURFACE()B_SPLINE_SURFACE(${du},${dv},${list(rows)},.UNSPECIFIED.,.F.,.F.,.F.)`
    + `B_SPLINE_SURFACE_WITH_KNOTS(${knots})GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE(${list(weights)})`
    + `REPRESENTATION_ITEM('')SURFACE())`);
}

/** A kernel's NURBS curve, exactly — B_SPLINE_CURVE_WITH_KNOTS, rational as a complex instance. */
function bsplineCurve(d: Data, n: NurbsCurve): number {
  const pts = list(n.points.map(([x, y, z]) => ref(d.point([x, y, z]))));
  const knots = `${list(n.mults)},${list(n.knots.map(real))},.UNSPECIFIED.`;
  if (!n.rational) return d.add(`B_SPLINE_CURVE_WITH_KNOTS('',${n.degree},${pts},.UNSPECIFIED.,.F.,.F.,${knots})`);
  return d.add(`(BOUNDED_CURVE()B_SPLINE_CURVE(${n.degree},${pts},.UNSPECIFIED.,.F.,.F.)B_SPLINE_CURVE_WITH_KNOTS(${knots})`
    + `CURVE()GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE(${list(n.points.map((q) => real(q[3])))})REPRESENTATION_ITEM(''))`);
}

/** One body's topology, each vertex and edge written once and referred to by every face that uses it. */
function body(d: Data, b: Body): number {
  const vertices = new Map<Vertex, number>();
  const edges = new Map<Edge, number>();
  const vertex = (v: Vertex) => {
    let id = vertices.get(v);
    if (id === undefined) vertices.set(v, id = d.add(`VERTEX_POINT('',${ref(d.point(v.at))})`));
    return id;
  };
  const edge = (e: Edge) => {
    let id = edges.get(e);
    if (id === undefined) {
      const curve = e.curve.kind === "line" ? d.line(e.start.at, e.end.at)
        : e.curve.kind === "circle" ? d.circle(e.curve)
          : e.curve.kind === "ellipse" ? d.ellipse(e.curve) : bsplineCurve(d, e.curve.nurbs);
      // Every line and circle runs the edge's way (solids.ts, kernelbrep.ts);
      // a kernel's B-spline is written as the kernel parametrised it, and says.
      const sense = e.curve.kind === "bspline" ? e.curve.sense : true;
      id = d.add(`EDGE_CURVE('',${ref(vertex(e.start))},${ref(vertex(e.end))},${ref(curve)},${bool(sense)})`);
      edges.set(e, id);
    }
    return id;
  };
  const face = (f: Face) => {
    const bounds = f.bounds.map((bound) => {
      const uses = bound.uses.map((u) => d.add(`ORIENTED_EDGE('',*,*,${ref(edge(u.edge))},${bool(u.forward)})`));
      const loop = d.add(`EDGE_LOOP('',${list(uses.map(ref))})`);
      return d.add(`${bound.outer ? "FACE_OUTER_BOUND" : "FACE_BOUND"}('',${ref(loop)},.T.)`);
    });
    return d.add(`ADVANCED_FACE('',${list(bounds.map(ref))},${ref(surface(d, f.surface))},${bool(f.sameSense)})`);
  };
  const shell = (s: Shell) => d.add(`CLOSED_SHELL('',${list(s.faces.map(face).map(ref))})`);
  const outer = shell(b.outer);
  if (b.voids.length === 0) return d.add(`MANIFOLD_SOLID_BREP(${str(b.name)},${ref(outer)})`);
  // A void is written as the cavity would be as a solid of its own — normals
  // out of it — and turned inside out by its `.F.`, so that in the solid they
  // point into it. Writing the shell already facing in, flagged `.T.`, means
  // the same in Part 42, and OpenCascade reads both alike; this is the way
  // OpenCascade itself writes one, which is the way readers have been tested.
  const voids = b.voids.map((v) => d.add(`ORIENTED_CLOSED_SHELL('',*,${ref(shell(insideOut(v)))},.F.)`));
  return d.add(`BREP_WITH_VOIDS(${str(b.name)},${ref(outer)},${list(voids.map(ref))})`);
}

/** A shell with every face turned over: each surface's sense flipped and each loop walked the other way. */
function insideOut(s: Shell): Shell {
  return {
    faces: s.faces.map((f) => ({
      surface: f.surface,
      sameSense: !f.sameSense,
      bounds: f.bounds.map((b) => ({ outer: b.outer, uses: b.uses.slice().reverse().map((u) => ({ edge: u.edge, forward: !u.forward })) })),
    })),
  };
}

/** A loose sketch curve, bounded: a trimmed line or arc, or a whole circle or ellipse. */
function loose(d: Data, c: LooseCurve): number {
  if (c.kind === "circle") return d.circle(c.curve, c.name);
  if (c.kind === "ellipse") return d.ellipse(c.curve, c.name);
  const trim = (p: number[]) => `(${ref(d.point(p))})`;
  const basis = c.kind === "line" ? d.line(c.a, c.b) : d.circle(c.curve);
  return d.add(`TRIMMED_CURVE(${str(c.name)},${ref(basis)},${trim(c.a)},${trim(c.b)},.T.,.CARTESIAN.)`);
}

function write(bodies: Body[], curves: LooseCurve[], o: StepOptions): string {
  const name = o.name ?? "Untitled";
  const system = o.system ?? "ZeroCAD";
  const stamp = o.timestamp ?? new Date().toISOString().replace(/\.\d+Z$/, "");
  const d = new Data();

  // The product a receiving tool files the shape under: AP214's minimum, as
  // its own writers lay it out.
  const app = d.add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  d.add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ref(app)})`);
  const productContext = d.add(`PRODUCT_CONTEXT('',${ref(app)},'mechanical')`);
  const product = d.add(`PRODUCT(${str(name)},${str(name)},'',(${ref(productContext)}))`);
  d.add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${ref(product)}))`);
  const formation = d.add(`PRODUCT_DEFINITION_FORMATION('','',${ref(product)})`);
  const definitionContext = d.add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ref(app)},'design')`);
  const definition = d.add(`PRODUCT_DEFINITION('design','',${ref(formation)},${ref(definitionContext)})`);
  const shape = d.add(`PRODUCT_DEFINITION_SHAPE('','',${ref(definition)})`);

  // Millimetres, radians, steradians, and how near is the same. Complex
  // instances list their parts alphabetically, as Part 21 requires.
  const mm = d.add("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const rad = d.add("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const sr = d.add("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const approximate = bodies.some((b) => [b.outer, ...b.voids].some((sh) => sh.faces.some((f) => f.bounds.some((bd) =>
    bd.uses.some((u) => u.edge.curve.kind === "bspline")))));
  const within = approximate ? KERNEL_CURVE_UNCERTAINTY : STEP_UNCERTAINTY;
  const uncertainty = d.add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(${real(within)}),${ref(mm)},'distance_accuracy_value','confusion accuracy')`);
  const context = d.add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${ref(uncertainty)}))`
    + `GLOBAL_UNIT_ASSIGNED_CONTEXT((${ref(mm)},${ref(rad)},${ref(sr)}))REPRESENTATION_CONTEXT('','3D'))`);

  const origin = d.placement([0, 0, 0], [0, 0, 1], [1, 0, 0]);
  const solids = bodies.map((b) => body(d, b));
  const rep = d.add(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(name)},${list([origin, ...solids].map(ref))},${ref(context)})`);
  d.add(`SHAPE_DEFINITION_REPRESENTATION(${ref(shape)},${ref(rep)})`);

  if (curves.length > 0) {
    // The sketch beside the solids: a wireframe representation in the same
    // context, related to the solids' so a reader that follows the product
    // finds both.
    const set = d.add(`GEOMETRIC_CURVE_SET('sketch',${list(curves.map((c) => ref(loose(d, c))))})`);
    const wire = d.add(`GEOMETRICALLY_BOUNDED_WIREFRAME_SHAPE_REPRESENTATION('sketch',${list([ref(origin), ref(set)])},${ref(context)})`);
    d.add(`SHAPE_REPRESENTATION_RELATIONSHIP('sketch','',${ref(rep)},${ref(wire)})`);
  }

  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION((${str(`${system} model`)}),'2;1');`,
    `FILE_NAME(${str(stepFileName(name))},${str(stamp)},(''),(''),${str(system)},${str(system)},'');`,
    `FILE_SCHEMA((${str(STEP_SCHEMA)}));`,
    "ENDSEC;",
    "DATA;",
    ...d.lines.map((line, i) => `#${i + 1}=${line};`),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
