// The **core** module (docs/plans/workbenches.md): what every workbench
// stands on — the point, the line and the frame; the relations between points
// and lines (`dist fix onPlane coin mid par perp ang on eq sym`, and the
// sketch relations' line forms); and the operations that are the model's own
// (`set`, `construction`) with the structural edits a file replays (deletion,
// the default frame, the work plane, seeds). Select and the Hand are the
// engine's, not tools, but their glyphs head the tray, so they are here too.

import { defineModule } from "../modules.ts";
import type { Model } from "../model.ts";
import { slots } from "../clauses.ts";
import * as basic from "../relations/basic.ts";
import * as geom from "../relations/geometry.ts";
import { measure } from "../relations/measure.ts";
import { construction, set } from "../operations.ts";
import { amongEntry, join, leave, relate } from "../among.ts";
import { svg, dot } from "../tools/icons.ts";
import { PointTool } from "../tools/point.ts";
import { LineTool } from "../tools/line.ts";

/**
 * Two coordinates where a 3D model wants three, made three with a zero — the
 * one rule the command line and an opened 2D file share (see persist.ts).
 *
 * The app is 3D now, and a hand that has typed `pt(40, 30)` for as long as the
 * app has existed should not be met with "point needs 3 coordinates". A 2D
 * coordinate in a 3D model reads as the 3D one with no depth: for `pt` that is
 * the kernel's z = 0 — a *seed*, the gauge every 2D drawing already lived in,
 * and no constraint — and for `fix` it is the frame's own z = 0, which is the
 * one thing `fix(p, [x, y])` can mean on a sketch plane: at (x, y) *on* it.
 *
 * Anything else is passed through untouched, so a wrong count still meets the
 * model's own message.
 */
export function lifted(model: Model, coords: number[]): number[] {
  return model.dim === 3 && Array.isArray(coords) && coords.length === 2 ? [...coords, 0] : coords;
}

/**
 * `horizontal("l1")` / `vertical("l1")`, and the two-point forms: `par`
 * against the default frame's x or y axis, resolved now (`axisRef`), so the
 * journal holds the `par` with the frame it meant. A line takes nothing more;
 * a point takes the second point — or more: `horizontal("p1", "p2", "p3")` is
 * one relation among the three, `par("p1", "p2", "p3", "origin.x")`, and a
 * point named with one already level with another joins that relation
 * (docs/plans/review-relations.md).
 */
function level(model: Model, axis: "x" | "y", word: string, a: string, ...more: (string | null | undefined)[]): string {
  const ref = model.axisRef(axis);
  const rest = more.filter((b): b is string => b != null);
  if (model.entities.get(a)?.kind === "point") {
    if (!rest.length) throw new Error(`${word}("${a}") needs a second point — or give it a line`);
    return relate(model, "parallel", a, ...rest, ref);
  }
  if (rest.length) throw new Error(`${word} takes a line, or two points or more — "${a}" is not a point, so nothing more`);
  return geom.parallel(model, a, ref);
}

/** A model method, as a replay entry: `bound("addPoint")`. */
const bound = (name: string) => (model: Model) => {
  const m = model as unknown as Record<string, (...a: unknown[]) => unknown>;
  return (...args: unknown[]) => m[name](...args);
};

defineModule("core", {
  label: "Core: points, lines, frames and the relations between them",
  tools: { point: PointTool, line: LineTool },
  icons: {
    // Select and the Hand (tool.ts's ENGINE_TOOLS): the pointer arrow and an
    // open hand, the two every drawing program puts first. Outlines like the
    // rest — a filled arrow was the obvious choice and would be the family's
    // only solid shape, as heavy as every other glyph together at 16 px.
    select: svg("select", `<path d="M3.5 2v11l2.9-2.6 2 4.2 1.9-.9-2-4.1 3.9-.2z"/>`),
    // Three fingers and a thumb: a fourth finger at 16 px merged with its
    // neighbours into a mitten (tried, and looked at at 1× and 3×).
    hand: svg("hand", `<path d="M6 8V3.5a1.25 1.25 0 0 1 2.5 0V7.5"/><path d="M8.5 7.5V2.75a1.25 1.25 0 0 1 2.5 0V8"/>` +
      `<path d="M11 8V4.25a1.25 1.25 0 0 1 2.5 0V10a4.5 4.5 0 0 1-4.5 4.5H8.4a3.6 3.6 0 0 1-2.7-1.2L2.5 9.8a1.2 1.2 0 0 1 1.8-1.6L6 9.8"/>`),
    point: svg("point", dot(8, 8, 2.6)),
    line: svg("line", `<path d="M3 13 13 3"/>`),
  },
  // Model's own structural methods: a file replays them as the calls they were.
  replay: {
    addPoint: bound("addPoint"),
    addLine: bound("addLine"),
    addFrame: bound("addFrame"),
    // The default frame is journalled because it changes what a *later*
    // relation call means. It never changes what an already-journalled one
    // means: `fix` and the axis helpers resolve it when they are called and
    // record the answer.
    setDefaultFrame: bound("setDefaultFrame"),
    // The work plane (sketch on face) is document state like the default
    // frame, journalled for the same reason: what is drawn after it lies on it.
    setWorkPlane: bound("setWorkPlane"),
    setCoords: bound("setCoords"),
    // A curve's normal put somewhere outright — a seed, as `setCoords` is.
    setNormal: bound("setNormal"),
    retargetLine: bound("retargetLine"),
    // Deletion is journalled as its *expansion* — one entry per name `del`
    // removed — rather than as the `del` call itself, so a replay removes
    // exactly what was removed rather than recomputing a cascade against a
    // model that may have been built differently since.
    deleteEntity: bound("deleteEntity"),
    deleteRelation: bound("deleteRelation"),
    // A feature's record, as `del` journals it.
    deleteFeature: bound("deleteFeature"),
  },
  relations: {
    // dimension-generic, from relations/basic.ts
    dist: { names: ["dist"], slots: slots("a", "b", "#distance"), fn: basic.dist },
    fix: {
      names: ["fix"], slots: slots("point", "#coordinates", "frame"), fn: basic.fix,
      typed: (model: Model, name: string, at: number[], frame?: string | null) => basic.fix(model, name, lifted(model, at), frame),
    },
    // 3D only: the point lies in the frame's plane. Frame-relative like `fix`.
    onPlane: { names: ["onplane", "onPlane"], slots: slots("point", "frame"), fn: basic.onPlane },
    // 3D only: the point in the plane of three others, all four moving — the
    // both-ways hold an offset keeps its copy in its chain's plane by (profiles-held.md).
    coplanar: { names: ["coplanar"], slots: slots("point", "a", "b", "c"), fn: basic.coplanar },
    // The relations that hold among many equals — `par("l1", "l2", "l3", "l4")`
    // is one relation, not a star on the first (docs/plans/review-relations.md).
    coincident: { names: ["coin", "coincident"], slots: slots("a", "b"), ...amongEntry("coincident") },
    midpoint: { names: ["mid", "midpoint"], slots: slots("midpoint", "a", "b"), fn: basic.midpoint },
    // relations/geometry.ts. `par`, `perp` and `ang` additionally take a
    // frame-axis reference — `par("l1", yaxis())` is what `ver("l1")` was.
    parallel: { names: ["par", "parallel"], slots: slots("a", "b", "c"), ...amongEntry("parallel") },
    perpendicular: { names: ["perp", "perpendicular"], slots: slots("a", "b", "c"), fn: geom.perpendicular },
    angle: { names: ["ang", "angle"], slots: slots("a", "b", "#angle"), fn: geom.angle },
    pointOnLine: { names: ["on", "pointOnLine"], slots: slots("point", "line"), fn: geom.pointOnLine },
    equalLength: { names: ["eq", "equalLength"], slots: slots("line", "line"), ...amongEntry("equalLength") },
    symmetric: { names: ["sym", "symmetric"], slots: slots("a", "b", "line"), fn: geom.symmetric },
    // The sketch relations (docs/plans/sketch-relations.md). `horizontal` and
    // `vertical` are the words an Onshape hand types, and they **expand to
    // par** against the default frame's axis — `par("l1", xaxis())` is what is
    // journalled and drawn (`—`), so there is still no hor/ver relation, only a
    // second spelling of the one that exists.
    collinear: { names: ["col", "collinear"], slots: slots("line", "line"), ...amongEntry("collinear") },
    horizontal: {
      names: ["horizontal"], slots: slots("a", "b"), op: false,
      fn: (model: Model, a: string, ...more: (string | null)[]) => level(model, "x", "horizontal", a, ...more),
    },
    vertical: {
      names: ["vertical"], slots: slots("a", "b"), op: false,
      fn: (model: Model, a: string, ...more: (string | null)[]) => level(model, "y", "vertical", a, ...more),
    },
    equalSpacing: { names: ["spacing", "equalSpacing"], slots: slots("point", "point", "point"), fn: geom.equalSpacing },
    measure: { names: ["measure"], slots: slots("#kind", "a", "b"), fn: measure },
  },
  operations: {
    // `set` is journalled as the one call the user made, like every operation,
    // so replaying it re-runs the edit rather than the dimension it rebuilt.
    set,
    // Construction geometry (see operations.ts): journalled with the curves
    // it changed resolved, never the group or feature typed, so a replay flags
    // exactly the entities the call did.
    construction,
    // Who is in a relation among many (../among.ts): each journalled as the
    // one edit it was, and written by a deletion that takes a member.
    join,
    leave,
  },
  menu: [
    { label: "Point", tool: "point" },
    { label: "Line", tool: "line" },
  ],
  help: () => [
    "geometry   pt(x,y)  ln(a,b)  circ(center,r,plane?)  arc(center,start,end,r,plane?)",
    "           point()  line()  circle()  — the same three, long names",
    "           every argument is optional: what you leave out is created free",
    "           near the middle of the view, for your relations to define.",
    "frames     origin — always there: a fixed point and three axes, drawn in",
    '           RGB, never solved or deleted. "origin.x" … "origin.z", fix and',
    "           onplane take it by name, and it is what they mean when no frame",
    "           is named and none is the default. The ground is its x–y plane.",
    "           frame(origin, xref)  setDefaultFrame(name)  defaultFrame()",
    "           plane(origin?, xref?, yref?) — a frame, made the default and",
    '           looked at square-on: "start sketching here" in one call.',
    "           plane(a, b, c, { look: false }) — the same, the view left alone.",
    '           workplane("p1.p2.p3") — draw on a plane without making a frame:',
    "           three points (a face's), a curve's own plane, or a frame; looked",
    "           at square-on ({ look: false } leaves the view). workplane(null)",
    "           clears it; workplane() says which plane things are drawn on.",
    "           The plane is drawn: its face tinted green (fainter, and its",
    "           outline dimmed, from behind the solid), a frame made the work",
    "           plane as a patch with a grid; what is not held on it is dimmed.",
    "           The chip beside the status says where · what · next —",
    "           on e1's top · circle · drag the radius — and its Done types",
    "           workplane(null) (setDefaultFrame(null) for a default frame);",
    "           a tap on the plane's name: Look at, Change…, Done.",
    "           Sketch mode is the work plane, not a feature: arm(\"sketch\") and",
    "           click a face, or Top, Front or Right (the options' buttons, or",
    "           their patches) — the view turns square to it, and every point",
    "           drawn is held on it by one onplane you can see and delete.",
    "           On a face (or right-click it: Sketch on this face) it is three",
    "           of the face's own points, facing you, so out of a solid; a",
    "           chamfer's face, which has none, gets a frame made there. The",
    "           ground's are workplane(\"origin\"), (\"origin.xz\"), (\"origin.yz\")",
    "           — any frame's x–z and y–z are \"f1.xz\", \"f1.yz\". Nothing else",
    "           is made. The chip's ⟂ looks at the plane again; its Done, or",
    "           Escape with nothing armed, leaves it, the view where it is.",
    "           xaxis(frame?)  yaxis(frame?)  — a frame's axis, by name; the",
    "           default frame's, else the origin's. There is no hor/ver:",
    '           par(l, yaxis()) is vertical, par(l, xaxis()) is level, and',
    '           par/perp/ang take any axis by name — par("l1", "f2.x").',
    '           perp("l9", "e1") holds a chord square to an extrude\'s profile;',
    '           ang("l9", "e1", θ) at θ off its normal. coplanar(p, a, b, c)',
    "           holds p in the plane of a, b and c, all four moving.",
    "           A frame draws as an axes marker at its origin, in SolidWorks'",
    "           colours — x red, y green, z blue, each lettered — heavier when",
    "           it is the default; drag the marker to move it, or its x-ref to turn",
    "           it and everything levelled against it. The line tool infers an",
    "           axis par only against the default.",
    "           The app is 3D: frame(origin, xref, yref) is a plane (the y-ref",
    "           picks its side of +x, not its exact angle), zaxis(frame?) is its",
    "           normal, onplane(p, plane?) holds a point in any plane, and fix",
    "           takes [x, y, z] in the frame — or [x, y], on its plane. pt(x, y)",
    "           is pt(x, y, 0). Tools draw on the work plane, else the default",
    "           frame's plane, else the face of a solid under the pointer, else",
    "           the ground, and hold the points they draw on a plane you chose,",
    "           or on the face, with onplane. A point off that plane snaps at",
    "           its projection onto it (a dashed square) and infers nothing.",
    "           A face: each click decides its own — the face under the pointer",
    "           is lit, named beside it (▱ e1:l2) and in the chip (on e1:l2)",
    '           before the click; the point is held by onplane(p, "e1:l2"). A',
    "           face is named by what it is swept from: e1.base and e1.lid the",
    "           caps, e1:l2 the wall of e1 swept from the line l2 — found again",
    "           every time it is read, so it follows a set of the depth and a",
    "           trim, split or fillet of the profile. Deleting l2 takes what is",
    "           held to its wall, and the log says so. (e1.m3, the wall's place",
    "           in the profile, still reads: it is written e1:l… the moment a",
    "           relation is made or an old file opened.) A curve drawn wholly",
    '           on one face gets par(c, "e1:l2") on its normal too.',
    "           A three-point circle may have a point on each of three faces.",
    "           Snaps on a face are the face's: its edges and corners, and what",
    "           lies in it. A round face places the point and holds nothing;",
    "           the ground holds nothing. With a sketch plane chosen, every",
    "           click lands on it, whatever is under the pointer.",
    "relations  dist fix coin mid par perp ang on eq",
    "           rad oncircle conc eqrad tan sym arcends onplane",
    "           col dia spacing intersection pierce horizontal vertical measure",
    "           corad onellipse onspline major minor",
    "           corad(c1, c2) one circle: concentric and equal radius, one glyph",
    "           (◎=). sym(a, b, l) mirrors two points, two lines, two circles",
    '           or two arcs about a line or a frame\'s axis — sym("l1", "l2", "f1.y").',
    "           intersection and pierce take an ellipse or a spline too.",
    '           dist(p, l, d) a point from a line; dist(l1, l2, d) two lines (the',
    "           second's middle from the first). eq takes two circles (equal",
    "           radius) or a line and an arc (equal length). mid(p, arc) halfway",
    '           round an arc. col(l1, l2) one line; intersection(p, c1, c2) on',
    "           both; pierce(p, curve, plane?) where a curve crosses the plane",
    "           (3D); spacing(p1, p2, p3, …) even gaps; dia(c, d) a diameter.",
    '           horizontal("l1") / vertical("p1", "p2") are par against the',
    "           default frame's axis — par(l, xaxis()) is what they journal, drawn",
    '           — and |. tan at a shared end is a smooth join. deg(30) is radians.',
    '           measure("dist", a, b) — or "angle", "radius", "diameter" — is a',
    "           driven dimension: drawn in parentheses, live, holding nothing.",
    "among many par eq col coin conc corad eqrad take any number: par(l1, l2,",
    "           l3, l4) is one relation among the four — one name, a mark on",
    "           each, and none of them first. Delete one, whichever, and the",
    "           relation stays over the rest (down to two; one left, it goes).",
    "           Type one naming a member and the other joins: par(l2, l9) adds",
    "           l9 to the relation l2 is in, and merges two it bridges. Points",
    '           level with each other: horizontal("p1", "p2", "p3"), which is',
    '           par("p1", "p2", "p3", "origin.x"). join("r3", "l9") and',
    '           leave("r3", "l2") change who is in one by name (a line\'s menu:',
    "           Leave r3). A line level with an axis, or held to a face, is its",
    "           own relation and joins nothing. A file's relations replay as",
    "           written: pairs made before this stay pairs until one is joined.",
    "diagnosis  After each solve: free entities are drawn blue (Onshape's), held",
    "           ones in the sketch's ink, and the status says SOLVED · 3 free —",
    "           how many ways the drawing can still move. A point on the drawing",
    "           plane or the ground is not counted free off it; a curve's normal",
    "           length is no freedom. CONFLICT names the relation that made it —",
    "           the one just added, or the dimension just set — and what it",
    "           cannot hold with: r7 par l1 l2 — against r1. Its mark is filled",
    "           red, what it is against outlined in a quieter ink, and the",
    "           constraints palette lists both first. Click a name in the status",
    "           to select it, Delete removes it. The drawing stays as it was: a",
    "           solve that fails, or could only hold by collapsing something — a",
    "           side to nothing, a radius to zero — is put back. What it is",
    "           against is the fewest that cannot hold with it. A file opened in",
    "           conflict names the set and singles out none. A size your own",
    "           relation sets to zero (dist(p, q, 0)) is no collapse. A relation",
    "           that reads a line for its direction (par, perp, ang, col, on,",
    "           sym) turns the line and leaves its length as it was.",
    "           Relations that say one thing together — a rectangle's four",
    "           right angles — agree: counted muted in the status (0 free ·",
    "           4 agreeing), none of them blamed, drawn in ordinary ink, never",
    "           refused; the constraints palette lists each agreeing set.",
    "           Not during a drag.",
    "           freeink(false) draws every entity in the sketch's ink.",
    "           arm(\"dimension\") clicks a line, two points, a point and a line,",
    "           two lines or a circle, then empty canvas to place: dist, ang, rad",
    "           (or dia, { diameter: true }; measure, { driven: true }), holding",
    "           what it measures. arm(\"constrain\") picks what to relate; the",
    "           constraints palette lists the relations what is picked — or",
    "           selected, with nothing armed — takes; one press types one.",
    "           It takes every standard one (docs/plans/relations-complete.md):",
    "           a frame's arm is its axis (in 3D the z arm its plane: On plane,",
    "           Normal to plane); a solid's flat face is On face / Normal to",
    "           face; five lines picked take Equal, Parallel or Collinear as",
    "           one relation among the five (see among many), Horizontal for",
    "           each, one undo step; Fix pins what is picked where it stands,",
    "           drawn as a padlock. A relation that",
    "           cannot apply here is greyed with why — a spline end that meets",
    "           nothing, a face the solid kernel made — and a press says it.",
    "clauses    _ is the thing being made. A relation given _ does not apply:",
    "           it becomes a clause, and pt ln circ arc frame take clauses",
    "           after their own arguments, applying each to what they made —",
    '           circ(oncircle("p1", _), oncircle("p2", _), oncircle("p3", _))',
    '           pt(on(_, "l1"), on(_, "l2"))      — the intersection',
    "           constrain(name, ...clauses) applies them to what exists. All",
    "           are checked before anything is made; each journals as itself.",
    "operations del(name, ...) — what it needs goes with it; undo is the confirmation",
    '           set("d4.value", 60)  — a dimension is named d1, d2, … and its',
    "           value is the one thing you can set. ang stores radians (its",
    "           label reads degrees); dist and rad store what you typed.",
  ],
});
