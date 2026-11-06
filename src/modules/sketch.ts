// The **sketch** module (docs/plans/workbenches.md): the curves — circle, arc
// and the ellipse — and the composites drawn of them (rectangle, polygon,
// slot); the relations that read a curve's rim (`rad oncircle conc eqrad tan
// arcends`, and the ellipse's); the fillet; the dimension and constrain tools;
// regions — faces combined by named operations, `region`, `subtract`, `add`,
// `intersect`, and the region tool (docs/plans/regions-as-operations.md) —
// with the explicit regions' `hole` and `unhole` their aliases. With core it is the sketch
// workbench; with solids and step, the part workbench.

import { ELLIPSE_STRUCTURE, addEllipse, checkEllipse, ellipseOf, semiAxes } from "../kinds/ellipse.ts";
import { defineModule, type EntityDecl } from "../modules.ts";
import type { Entity, Model } from "../model.ts";
import { ellipseFrame, type ArcFrame } from "../arcgeom.ts";
import { cross3, lift3, unit3 } from "../vec3.ts";
import { spanOf, unitOf } from "../model.ts";
import { slots } from "../clauses.ts";
import * as geom from "../relations/geometry.ts";
import { add, deleteRegionSteps, fillet, hole, intersect, region, subtract, unhole } from "../operations.ts";
import { chamfer, circular, extend, linear, mirror, offset, trim } from "../sketchedit.ts";
import * as pattern from "../relations/pattern.ts";
import * as shapes from "../tools/shapes.ts";
import { svg } from "../tools/icons.ts";
import { RectangleTool } from "../tools/rectangle.ts";
import { PolygonTool } from "../tools/polygon.ts";
import { SlotTool } from "../tools/slot.ts";
import { CircleTool } from "../tools/circle.ts";
import { ArcTool } from "../tools/arc.ts";
import { EllipseTool } from "../tools/ellipse.ts";
import { FilletTool } from "../tools/fillet.ts";
import { DimensionTool } from "../tools/dimension.ts";
import { ConstrainTool } from "../tools/constrain.ts";
import { RegionTool } from "../tools/regiontool.ts";
import { BevelTool } from "../tools/bevel.ts";
import { TrimTool } from "../tools/trim.ts";
import { ExtendTool } from "../tools/extend.ts";
import { OffsetTool } from "../tools/offset.ts";
import { MirrorTool } from "../tools/mirror.ts";
import { PatternTool } from "../tools/pattern.ts";

/** A model method, as a replay entry. */
const bound = (name: string) => (model: Model) => {
  const m = model as unknown as Record<string, (...a: unknown[]) => unknown>;
  return (...args: unknown[]) => m[name](...args);
};

/**
 * An ellipse laid out in its plane (arcgeom.ts's `ellipseFrame`): from its
 * major end round toward its minor axis — counter-clockwise about its
 * straightened normal in 3D (`Model.normalOf`), about +z in 2D. Null for an
 * ellipse whose major end sits on its centre, which has no axis to lay out
 * along. What curveplane.ts's `curveFrame` answers for one, so everything that
 * draws, boxes, loops, shades and picks through a frame takes it as it takes
 * a circle — with the frame's second radius (`rv`) saying it is not one.
 */
function ellipseFrameOf(model: Model, e: Entity): ArcFrame | null {
  const el = ellipseOf(model, e.name);
  const c = lift3(model.coords(el.center));
  const u = unit3(lift3(model.coords(el.major)).map((x, i) => x - c[i]));
  if (!u) return null;
  const n = el.normal === undefined ? [0, 0, 1] : model.normalOf(e.name);
  const v = unit3(cross3(n, u)) ?? [-u[1], u[0], 0];
  const { a, b } = semiAxes(model, e.name);
  return ellipseFrame(c, a, Math.abs(b), u, v);
}

/**
 * **The ellipse, through the entity extension point** (docs/plans/
 * workbenches.md) — the proof the point is real: model.ts, loops.ts, faces.ts,
 * picking.ts and step.ts no longer name it. Its structure (kinds/ellipse.ts),
 * its constructor as the journal op a file replays, the frame it is drawn,
 * boxed, looped and picked by, its hover line, and its Part 42 spelling.
 */
const ELLIPSE: EntityDecl = {
  ...ELLIPSE_STRUCTURE,
  add: { op: "addEllipse", fn: addEllipse },
  frame: ellipseFrameOf,
  describe: (model, name, n) => {
    const { a, b } = semiAxes(model, name);
    const facing = ellipseOf(model, name).normal === undefined ? "" : `  facing ${model.normalOf(name).map(n).join(", ")}`;
    return `${name}  a ${n(a)}  b ${n(b)}${facing}`;
  },
  // Part 42's ELLIPSE: placed at its centre, its first semi-axis along the
  // placement's reference (docs/plans/sketch-shapes.md) — a lid's edge, a
  // loose sketch curve, and the directrix of an elliptic wall's
  // SURFACE_OF_LINEAR_EXTRUSION.
  step: (w, c, name, { real, str, ref }) => {
    const e = c as unknown as { center: number[]; normal: number[]; ref: number[]; a: number; b: number };
    return w.add(`ELLIPSE(${str(name)},${ref(w.placement(e.center, e.normal, e.ref))},${real(e.a)},${real(e.b)})`);
  },
};

defineModule("sketch", {
  label: "Sketch: curves, shapes, the curve relations and the fillet",
  // In the tray's order: the shapes group's members after the rectangle, whose
  // button they share; the curves group after the arc, so its button stands
  // where the table puts it (docs/plans/toolbar-groups.md, As built).
  tools: {
    rectangle: RectangleTool,
    polygon: PolygonTool,
    slot: SlotTool,
    // A region of faces (docs/plans/regions-as-operations.md): under the
    // shapes button, after the shapes it is made of.
    region: RegionTool,
    circle: CircleTool,
    arc: ArcTool,
    ellipse: EllipseTool,
    fillet: FilletTool,
    // Sketch editing (docs/plans/sketch-edit.md), on the modify button after
    // the fillet. `bevel` is the sketch's chamfer: `chamfer` is the solid's
    // edge tool, on the same button.
    bevel: BevelTool,
    trim: TrimTool,
    extend: ExtendTool,
    offset: OffsetTool,
    mirror: MirrorTool,
    pattern: PatternTool,
    dimension: DimensionTool,
    constrain: ConstrainTool,
  },
  // A group's members are in its button's order, the default first. A name no
  // module registers yet (spline, chamfer, …) is simply not on the button, and
  // a group none of whose members is registered shows no button at all.
  // Vetoable (TODO.md).
  groups: {
    shapes: ["rectangle", "polygon", "slot", "region"],
    curves: ["ellipse", "spline"],
    // The sketch's edits first, then (from the solids module) the solid's
    // round and chamfer: one family per half of the flyout
    // (docs/plans/sketch-edit.md). `bevel` is the sketch's two-line chamfer.
    modify: ["fillet", "bevel", "trim", "extend", "offset", "mirror", "pattern"],
    // Dimension and constrain share a button (docs/plans/sketch-relations.md
    // gave each its own): both make relations, and as the fourteenth button
    // the second ran an iPhone 13's column one pixel onto the command line at
    // the phone's 100 %, which sent the line to the right of the tray and put
    // its strip's hit box under the last button (measured, 2026-11-05). At
    // thirteen the column ends above the line, as it did when the relations
    // package passed its own gate. Vetoable (TODO.md).
    relate: ["dimension", "constrain"],
  },
  icons: {
    rectangle: svg("rectangle", `<rect x="2.5" y="4" width="11" height="8" rx="1"/>`),
    // A hexagon, the polygon tool's default — pointed left and right, so its
    // flat top and bottom sit level with the rectangle's beside it in the flyout.
    polygon: svg("polygon", `<path d="M13.5 8 10.75 12.75H5.25L2.5 8 5.25 3.25h5.5z"/>`),
    // A stadium: two straight sides and two round ends, as wide as the rectangle.
    slot: svg("slot", `<path d="M5.5 5h5a3 3 0 0 1 0 6h-5a3 3 0 0 1 0-6z"/>`),
    // A face with a face subtracted from it: an outline, and a circle inside
    // it drawn dashed — a face taken away, not a negative one.
    region: svg("region", `<rect x="2.5" y="3.5" width="11" height="9" rx="1"/><circle cx="8" cy="8" r="2.4" stroke-dasharray="1.6 1.2"/>`),
    circle: svg("circle", `<circle cx="8" cy="8" r="5.5"/>`),
    // Wider than tall by the circle's own width, so it is read as a circle's
    // cousin and not as a squashed slot.
    ellipse: svg("ellipse", `<ellipse cx="8" cy="8" rx="6" ry="3.75"/>`),
    // Half a turn, opening downward: anything shallower reads at 16 px as a bent
    // line. (The 3-point circle's and arc's dotted glyphs went with their buttons:
    // one circle tool and one arc tool, docs/plans/one-circle-one-arc.md.)
    arc: svg("arc", `<path d="M2.5 12A5.5 5.5 0 0 1 13.5 12"/>`),
    // Two edges meeting at a corner, the corner itself replaced by a quarter
    // circle on its inside — what a fillet does to the corner it is given.
    fillet: svg("fillet", `<path d="M3 13.5V8.5A5.5 5.5 0 0 1 8.5 3H13.5"/>`),
    // The sketch edits (docs/plans/sketch-edit.md). The bevel is the fillet's
    // corner cut straight; trim and extend are a line meeting a wall, the
    // piece past it gone (dotted) or the gap to it bridged (dotted, arrowed).
    bevel: svg("bevel", `<path d="M3 13.5V7.5L7.5 3H13.5"/>`),
    trim: svg("trim", `<path d="M9 2.5v11M2.5 8H9"/><path d="M9 8h4.5" stroke-dasharray="1.2 1.6"/>`),
    extend: svg("extend", `<path d="M13.5 2.5v11M2.5 8H7"/><path d="M7 8h4.5" stroke-dasharray="1.2 1.6"/><path d="M9.8 6.2 11.6 8 9.8 9.8"/>`),
    // A corner and its parallel copy inside it, dotted: what an offset adds.
    offset: svg("offset", `<path d="M2.5 13.5V6.5a4 4 0 0 1 4-4h7"/><path d="M5.5 13.5V8a2.5 2.5 0 0 1 2.5-2.5h5.5" stroke-dasharray="1.4 1.3"/>`),
    // Two halves either side of a dotted axis, each the other's mirror image.
    mirror: svg("mirror", `<path d="M8 1.5v13" stroke-dasharray="1.4 1.4"/><path d="M6 4 2.5 12H6zM10 4l3.5 8H10z"/>`),
    // A seed and its copies in a row.
    pattern: svg("pattern", `<rect x="1.8" y="5.5" width="3.4" height="5" rx=".6"/><rect x="6.3" y="5.5" width="3.4" height="5" rx=".6"/><rect x="10.8" y="5.5" width="3.4" height="5" rx=".6"/>`),
    // A draughtsman's dimension: two witness lines and the arrowed line between
    // them — what the tool puts on the drawing (docs/plans/sketch-relations.md).
    dimension: svg("dimension", `<path d="M2.5 3.5v9M13.5 3.5v9M2.5 8h11"/><path d="M5 6.2 2.5 8 5 9.8M11 6.2 13.5 8 11 9.8"/>`),
    // Two edges at a right angle with the square drawn in their corner: a
    // relation between two things, the commonest one there is.
    constrain: svg("constrain", `<path d="M3 13.5h10.5M3 13.5V2.5"/><path d="M3 9.5h4v4"/>`),
  },
  // The ellipse (docs/plans/sketch-shapes.md, format 15): an entity kind of
  // this module's, declared above.
  entities: [ELLIPSE],
  replay: {
    addCircle: bound("addCircle"),
    addArc: bound("addArc"),
    // A region's record going: a primitive of `del`'s expansion, as
    // `deleteFeature` is a feature's (docs/plans/regions-as-operations.md).
    deleteRegion: bound("deleteRegion"),
    // The trim's structure (docs/plans/sketch-edit.md): an arc's end
    // re-pointed, a circle made an arc under its name and back. Journalled
    // only where called outside an operation — a trim is its own entry.
    retargetArc: bound("retargetArc"),
    circleToArc: bound("circleToArc"),
    arcToCircle: bound("arcToCircle"),
  },
  relations: {
    radius: { names: ["rad", "radius"], slots: slots("circle", "#radius"), fn: geom.radius },
    onCircle: { names: ["oncircle", "onCircle"], slots: slots("point", "circle"), fn: geom.onCircle },
    concentric: { names: ["conc", "concentric"], slots: slots("circle", "circle"), fn: geom.concentric },
    equalRadius: { names: ["eqrad", "equalRadius"], slots: slots("circle", "circle"), fn: geom.equalRadius },
    tangent: { names: ["tan", "tangent"], slots: slots("line", "circle"), fn: geom.tangent },
    arcEndpoints: { names: ["arcends", "arcEndpoints"], slots: slots("arc"), fn: geom.arcEndpoints },
    intersection: { names: ["intersection"], slots: slots("point", "curve", "curve"), fn: geom.intersection },
    pierce: { names: ["pierce"], slots: slots("point", "curve", "plane"), fn: geom.pierce },
    diameter: { names: ["dia", "diameter"], slots: slots("circle", "#diameter"), fn: geom.diameter },
    // The ellipse's (docs/plans/sketch-shapes.md). `tan` and `conc` take one
    // under their own names; `major` and `minor` are its semi-axes, dimensions
    // as `rad` is.
    onEllipse: { names: ["onellipse", "onEllipse"], slots: slots("point", "ellipse"), fn: geom.onEllipse },
    majorAxis: { names: ["major", "majorAxis"], slots: slots("ellipse", "#semi-axis"), fn: geom.majorAxis, dimension: 1 },
    minorAxis: { names: ["minor", "minorAxis"], slots: slots("ellipse", "#semi-axis"), fn: geom.minorAxis, dimension: 1 },
    // What a pattern is held by (docs/plans/sketch-edit.md, relations/
    // pattern.ts): a copy is its seed moved as the first copy is. `rotation`
    // is a circular pattern's one dimension, the step's angle.
    translated: { names: ["translated"], slots: slots("point", "point", "point", "point"), fn: pattern.translated },
    rotated: { names: ["rotated"], slots: slots("point", "point", "point", "point", "point"), fn: pattern.rotated },
    rotation: { names: ["rotation"], slots: slots("point", "point", "point", "#angle"), fn: pattern.rotation, dimension: 3 },
  },
  operations: {
    fillet,
    // A region's membership changed by name (docs/plans/explicit-regions.md),
    // journalled as `regen` is: the call, and the profiles it rebuilt resolved.
    // `unhole` is also what a deletion's or a flag's expansion writes when the
    // loop of a recorded hole goes, ahead of the deletion or the flag itself.
    hole,
    unhole,
    // Regions as operations (docs/plans/regions-as-operations.md): a region is
    // a face combined with others by named operations, each journalled with
    // its face resolved and what it rebuilt. `hole`/`unhole` above are their
    // aliases now — kept as typed names, and replayed for a file that has
    // them — and `deleteRegionSteps` is what a deletion of a face a region
    // names journals ahead of itself.
    region,
    subtract,
    add,
    intersect,
    deleteRegionSteps,
    // Sketch editing (docs/plans/sketch-edit.md): each an operation, journalled
    // as its typed call with what it read off positions resolved beside it.
    // `chamfer` is the sketch's two-line chamfer; a solid's edges are
    // `chamferEdges` (the solids module), and the typed `chamfer` tells them
    // apart by its second argument, as `fillet` does.
    trim,
    extend,
    offset,
    mirror,
    chamfer,
    linear,
    circular,
  },
  menu: [
    { label: "Rectangle", tool: "rectangle" },
    // One circle and one arc: the gesture says which way (docs/plans/
    // one-circle-one-arc.md), and `circle3`/`arc3` are typed names, not tools.
    { label: "Circle", tool: "circle" },
    { label: "Arc", tool: "arc" },
    // The first curve that is not a circle (docs/plans/sketch-shapes.md): offered
    // where the circle and arc are, as the shapes group's polygon and slot are
    // under the rectangle's heading.
    { label: "Ellipse", tool: "ellipse" },
    { label: "Fillet", tool: "fillet" },
  ],
  commands: (kit) => ({
    // Sketch editing (docs/plans/sketch-edit.md). Each forwards every argument,
    // so a line copied out of a journal — its resolved part included — types.
    trim: (curve: string, near: unknown, resolved?: unknown, regenerated?: unknown) => {
      const notes: string[] = [];
      const out = trim(kit.model, curve, near, resolved, regenerated, notes);
      for (const n of notes) kit.log?.(n);
      return out;
    },
    extend: (curve: string, end: unknown, to?: string | null, at?: unknown) => extend(kit.model, curve, end, to, at),
    offset: (chain: string | string[], d: number, options?: { construction?: boolean } | null, resolved?: unknown) =>
      offset(kit.model, chain, d, options, resolved),
    mirror: (names: string | string[], line: string, resolved?: unknown) => mirror(kit.model, names, line, resolved),
    linear: (names: string | string[], dx: number, dy: number, n: number, resolved?: unknown) =>
      linear(kit.model, names, dx, dy, n, resolved),
    circular: (names: string | string[], centre: string, angle?: number | null, n?: number, resolved?: unknown) =>
      circular(kit.model, names, centre, angle, n, resolved),
    // An ellipse by its centre, its major end — a point, or a number: the
    // semi-major along the drawing plane's first direction — and the minor
    // semi-axis, every one optional and none a constraint, as `circ`'s. A
    // plane named holds it there, as a circle's does.
    ellipse: kit.clauses("ellipse", (center?: string | null, major?: string | number | null, minor?: number | null,
      plane?: string | number[] | null) => {
      const model = kit.model;
      checkEllipse(model, center, typeof major === "string" ? major : null, minor);
      if (major != null && typeof major !== "string" && !(typeof major === "number" && major > 0)) {
        throw new Error(`ellipse: the major end is a point's name or a positive semi-axis, got ${JSON.stringify(major)}`);
      }
      const { seed, hold } = kit.facing(plane);
      model.normalSeed("ellipse", seed);
      const c = center ?? kit.anchor();
      let end: string | null = typeof major === "string" ? major : null;
      if (typeof major === "number") {
        const at = c ? model.coords(c) : new Array<number>(model.dim).fill(0);
        const n = seed ?? model.planeValues(model.drawingPlane())?.n ?? null;
        const u = model.dim === 3 && n ? spanOf(unitOf(n))[0] : [1, 0];
        end = model.addPoint(at.map((v, i) => v + major * (u[i] ?? 0))).name;
      }
      const name = addEllipse(model, c, end, minor ?? null, seed).name;
      if (hold) geom.parallel(model, name, hold);
      return name;
    }),
    // The composites (docs/plans/sketch-shapes.md): the pieces a tool would
    // draw, each journalled as itself, so a file replays them as pieces. They
    // return what they made, by name, and take no clauses — there is no one
    // thing made for `_` to be.
    polygon: (centre?: unknown, vertex?: unknown, n?: unknown, circumscribed?: unknown) => {
      const model = kit.model;
      if (typeof centre !== "string" || typeof vertex !== "string") {
        throw new Error('polygon(centre, vertex, n?, circumscribed?) takes two points\' names — polygon("p1", "p2", 6)');
      }
      if (n != null && typeof n !== "number") throw new Error(`polygon: n is a number of sides, got ${JSON.stringify(n)}`);
      if (circumscribed != null && typeof circumscribed !== "boolean") {
        throw new Error(`polygon: circumscribed is true or false, got ${JSON.stringify(circumscribed)}`);
      }
      return shapes.polygon(model, centre, vertex, n ?? 6, circumscribed ?? true, model.dim === 3 ? model.drawingPlane() : null);
    },
    slot: (a?: unknown, b?: unknown, width?: unknown) => {
      const model = kit.model;
      if (typeof a !== "string" || typeof b !== "string" || typeof width !== "number") {
        throw new Error('slot(a, b, width) takes its two centres\' names and a width — slot("p1", "p2", 10)');
      }
      return shapes.slot(model, a, b, width, model.dim === 3 ? model.drawingPlane() : null);
    },
  }),
  help: [
    'regions    region("l1") — rg1, a region of the face l1 bounds: a face is a',
    "           closed loop, found, and its whole inside — a loop drawn inside",
    "           it is part of it until an operation names it. Nothing is",
    '           negative: subtract("rg1", "c1") takes c1\'s face out, add("rg1",',
    '           "c3") puts one in, intersect("rg1", "l9") keeps what both cover —',
    "           each one line, one undo step, journalled with its face resolved,",
    "           and every feature on rg1 regenerated. extrude(\"rg1\", 10) and",
    "           revolve take a region; extrude(\"l1\", 10) makes one on the way.",
    "           The region tool (under shapes): click a face to make a region,",
    "           then faces to Subtract (the default), Add or ∩ — the mode row —",
    "           or New for another; a click inside a region with none in hand",
    "           takes it in hand; Esc puts it down. The organiser lists Regions",
    '           (rg1 = l1–l4 − c1), hideable; edit("rg1") arms the tool on it,',
    '           del("rg1") removes it and the features on it. Deleting a face',
    "           a region subtracts, adds or intersects takes that step out of",
    "           its chain (the region loses it); deleting its first face takes",
    "           the region. hole/unhole are aliases of the step (solids).",
    "           Surfaces will be the same shape: trim, extend, knit are",
    "           operations between surfaces, nothing a negative surface.",
    "curves     ellipse(center, major, minor, plane?) — major a point (its major",
    "           end) or a number (the semi-major), minor the semi-minor: an",
    "           entity, centre and major end its points, minor its variable.",
    '           polygon("p1", "p2", n?, circumscribed?) — a regular polygon about',
    "           p1 with p2 a corner: n points and lines (6), each side eq to",
    "           the one before, a construction circle oncircle every corner; inscribed",
    "           (false) adds a second, inside, tan to the first side.",
    '           slot("p1", "p2", width) — two lines and two arcs about p1 and p2,',
    "           eqrad, arcends, each side perp to the radius at its ends (a",
    "           tangency said linearly), a construction line p1–p2 for the",
    "           length. Both leave ordinary pieces and replay as them; the",
    "           polygon, slot and ellipse tools draw them (shapes, curves).",
    "           In 3D a circle or arc carries its own normal, the way it faces —",
    "           solved like its radius. Left out, it faces the drawing plane",
    "           (below) and nothing holds it: free to turn. A plane named — a",
    '           frame, a curve, "p1.p2.p3" — faces it and holds it there with',
    '           par; three numbers are a seed and no more. par("c1", "l1") stands',
    "           a circle square to a line; par/perp/ang read a curve as its normal.",
    "           No frame is ever made for a curve. The circle and arc tools draw",
    "           where you click — on the plane you sketch on, else a solid's face",
    "           under the cursor, else the ground — and hold what they draw with",
    "           onplane on its centre and par on its normal, both deletable.",
    "           One circle tool and one arc tool; the gesture says how. Circle:",
    "           drag out from the centre (a click, then a drag: the click is the",
    "           centre), or click three points on it; a click along a line or",
    "           circle touches it (tan). Arc: drag end to end, then click its",
    "           bulge — near the smooth way on from a line's end it snaps",
    "           tangent — or click its centre, then both ends. The options panel",
    '           shows what it read, and locks it: arm("circle", { method: "3pt" }).',
    "           circle3 and arc3 typed arm that lock (not remembered). tan takes",
    '           two circles too: tan("c1", "c2"), outside or inside as drawn.',
    "           onellipse(p, e)  major(e, a)  minor(e, b) — an ellipse's: on it,",
    "           and its semi-axes, dimensions like rad (labelled a20, b10).",
    "           tan(line, e) and conc with circles and ellipses take one; tan",
    "           between an ellipse and a circle or another ellipse does not.",
    "           fillet(line1, line2, radius) — the arc follows its corner",
    'edit       trim("l1", [x, y]) — the piece of l1 the place is on, between the',
    "           curves that cut it there (or its own end), goes: an end re-pointed",
    "           and held on (on, oncircle) the curve that cut it; a middle piece",
    "           leaves two, held col (an arc's: eqrad); a circle becomes an arc,",
    "           same name. A feature on it regenerates, or the trim refuses.",
    '           extend("l1", "p2") — that end on to the next curve along l1 (an',
    '           arc: round its circle), held on it; extend("l1", "p2", "c3") to c3.',
    '           offset("l1", 5) or offset(["l1", "a1", "l2"], 5, { construction:',
    "           true }) — a parallel copy of a chain, outward (closed) or to the",
    "           left of the first member (open): par + dist, arcs about the same",
    "           centre, corners joined.",
    '           mirror(["l1", "l2"], "l5") — copies held by sym about l5, or about',
    '           a frame axis ("origin.y"); a point on the line is its own mirror.',
    '           chamfer("l1", "l2", 5) or (…, 5, 3) — the corner cut by a line, its',
    "           ends dist from the corner, which stays (held where the legs meet).",
    '           linear(names, dx, dy, n) — n instances a step apart (the drawing',
    '           plane\'s axes); circular(names, "p1", angle, n) — n about p1, over',
    "           angle radians (a whole turn: evenly round). Copy k of l1 is l1_k;",
    "           one dimension drives each (a dist, a rotation): set it. Deleting",
    "           the seed deletes no copy. Tools, under modify: trim (click the",
    "           piece), extend (click near an end), offset, mirror, bevel (the",
    "           sketch chamfer: two lines or a corner), pattern.",
  ],
});
