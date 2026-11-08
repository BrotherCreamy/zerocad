// The **dimensions** module (docs/plans/smart-dimension.md): the dimensions
// the dimension tool needed to dimension virtually anything — the owner: *"Dim
// tool needs to be similar in functionality to Solidworks smart dimension. I
// should be able to use it to dimension virtually anything. Distance between
// two faces of a solid, or angle"*.
//
// Its relations are dimensions (`d`-named, `set` re-runs them): `fdist`, a
// distance square to a solid's flat face; `along`, a distance along one
// direction (SolidWorks' horizontal and vertical); `ang3`, the angle at a
// vertex; `arclen`, an arc's length. Its glyphs are placed and labelled here,
// beside them, through glyphs.ts's two registries — and so are the driven
// readings of the kinds it brought (`measure("fdist", …)` and the rest). One
// command, `measureOf`, answers what the tool would dimension without making
// anything. In every workbench: a sketch has `along`, `ang3` and `arclen`, and
// `fdist` refuses in 2D with its reason.

import { defineModule } from "../modules.ts";
import { slots } from "../clauses.ts";
import type { Model, RelationEntry } from "../model.ts";
import { defineGlyphAnchor, defineGlyphLabel, formatValue, type GlyphAnchor } from "../glyphs.ts";
import { worldToScreen, type View } from "../view.ts";
import { frameBasis } from "../relations/refs.ts";
import { angle3, arcLength, distAlong } from "../relations/smartdim.ts";
import { faceDistance, isPlanarFace, planeNow } from "../relations/solidref.ts";
import { directionNow, measured, placeOf, solidGeometry } from "../relations/measure.ts";
import { dimensionFor } from "../dimensioning.ts";

const str = (v: unknown) => v as string;
const deg = (r: number) => `${formatValue((r * 180) / Math.PI)}°`;

/** A unit screen direction square to the screen segment a→b — which way a label steps off what it measures. */
function across(view: View, a: number[], b: number[]): [number, number] {
  const [ax, ay] = worldToScreen(view, a), [bx, by] = worldToScreen(view, b);
  const l = Math.hypot(bx - ax, by - ay);
  return l > 1e-9 ? [(by - ay) / l, -(bx - ax) / l] : [Math.SQRT1_2, Math.SQRT1_2];
}

/** A label between two world places, witness lines to each. */
function between(view: View, a: number[], b: number[], about: string[]): GlyphAnchor {
  return { world: a.map((v, i) => (v + b[i]) / 2), dir: across(view, a, b), ends: [a, b], about };
}

/** Where a distance to a face runs: from the other side's place to its foot on the face's plane. */
function faceEnds(model: Model, face: string, other: string): [number[], number[]] | null {
  const plane = isPlanarFace(model, face) ? planeNow(model, face) : null;
  const g = plane ? { point: plane.p, normal: plane.n } : (() => {
    const s = solidGeometry(model, face);
    return s?.kind === "plane" ? { point: s.point, normal: s.normal } : null;
  })();
  const q = placeOf(model, other);
  if (!g || !q) return null;
  const off = q.reduce((s, x, i) => s + (x - g.point[i]) * g.normal[i], 0);
  return [q.map((x, i) => x - off * g.normal[i]), q];
}

/** The face of a pair: the first one that is flat. */
function faceFirst(model: Model, a: string, b: string): [string, string] {
  const flat = (n: string) => isPlanarFace(model, n) || solidGeometry(model, n)?.kind === "plane";
  return flat(a) ? [a, b] : [b, a];
}

function fdistAnchor(model: Model, view: View, a: string, b: string): GlyphAnchor[] {
  const [face, other] = faceFirst(model, a, b);
  const ends = faceEnds(model, face, other);
  return ends ? [between(view, ends[0], ends[1], model.entities.has(other) ? [other] : [])] : [];
}

/** Two points along an axis: from the first, to the second's shadow on the axis through the first. */
function alongAnchor(model: Model, view: View, r: RelationEntry, at: number): GlyphAnchor[] {
  const [a, b, axis] = [str(r.args[at]), str(r.args[at + 1]), str(r.args[at + 2])];
  const A = model.isFrame(a) ? frameBasis(model, a)().origin.slice(0, model.dim) : placeOf(model, a) ?? model.coords(b);
  const B = model.coords(b);
  const v = measured(model, ["along", a, b, axis]);
  const d = B.map((x, i) => x - A[i]);
  // The axis direction, read as the relation reads it, signed toward b.
  const u = directionNow(model, axis);
  const s = d.reduce((acc, x, i) => acc + x * (u[i] ?? 0), 0) < 0 ? -1 : 1;
  const end = A.map((x, i) => x + s * v * (u[i] ?? 0));
  return [between(view, A, end, model.entities.has(a) ? [a, b] : [b])];
}


function angle3Anchor(model: Model, view: View, v: string, a: string, b: string): GlyphAnchor[] {
  const V = model.coords(v);
  const toward = (n: string) => {
    const [px, py] = worldToScreen(view, V), [qx, qy] = worldToScreen(view, model.coords(n));
    const l = Math.hypot(qx - px, qy - py);
    return l > 1e-9 ? [(qx - px) / l, (qy - py) / l] : [0, 0];
  };
  const [ua, ub] = [toward(a), toward(b)];
  const bis = Math.hypot(ua[0] + ub[0], ua[1] + ub[1]);
  const dir: [number, number] = bis > 1e-9 ? [(ua[0] + ub[0]) / bis, (ua[1] + ub[1]) / bis] : [Math.SQRT1_2, Math.SQRT1_2];
  return [{ world: V, dir, about: [v] }];
}

/** Half-way round an arc, stepped outward. */
function arcAnchor(model: Model, view: View, name: string): GlyphAnchor[] {
  const a = model.arc(name);
  const c = model.coords(a.center), s = model.coords(a.start), e = model.coords(a.end);
  const u = s.map((x, i) => x - c[i]);
  const theta = measured(model, ["arclen", name]) / Math.max(1e-12, Math.abs(model.radius(name)));
  const n = model.dim === 3 ? model.normalOf(name) : [0, 0, 1];
  const u3 = [u[0], u[1], u[2] ?? 0];
  const w = [n[1] * u3[2] - n[2] * u3[1], n[2] * u3[0] - n[0] * u3[2], n[0] * u3[1] - n[1] * u3[0]];
  const h = theta / 2;
  const mid3 = u3.map((x, i) => x * Math.cos(h) + w[i] * Math.sin(h));
  const world = c.map((x, i) => x + mid3[i]);
  void e;
  const [cx, cy] = worldToScreen(view, c), [mx, my] = worldToScreen(view, world);
  const l = Math.hypot(mx - cx, my - cy);
  return [{ world, dir: l > 1e-9 ? [(mx - cx) / l, (my - cy) / l] : [Math.SQRT1_2, Math.SQRT1_2], about: [name] }];
}

/** A solid's face or edge, by name, with no entity to anchor at: its own place. */
function solidAnchor(model: Model, view: View, r: RelationEntry): GlyphAnchor[] {
  const names = r.args.slice(1).map(str);
  const places = names.map((n) => placeOf(model, n)).filter((p): p is number[] => p !== null);
  if (!places.length) return [];
  if (places.length === 1) return [{ world: places[0], dir: [Math.SQRT1_2, -Math.SQRT1_2], about: [] }];
  return [between(view, places[0], places[1], [])];
}

defineGlyphLabel("faceDistance", (_m, r) => (typeof r.args[2] === "number" ? formatValue(r.args[2]) : null));
defineGlyphLabel("distAlong", (_m, r) => (typeof r.args[3] === "number" ? formatValue(r.args[3]) : null));
defineGlyphLabel("angle3", (_m, r) => (typeof r.args[3] === "number" ? deg(r.args[3]) : null));
// An arc's length, as a draughtsman marks one: the arc over the number.
defineGlyphLabel("arcLength", (_m, r) => (typeof r.args[1] === "number" ? `⌒${formatValue(r.args[1])}` : null));
defineGlyphAnchor("faceDistance", (m, v, r) => fdistAnchor(m, v, str(r.args[0]), str(r.args[1])));
defineGlyphAnchor("distAlong", (m, v, r) => alongAnchor(m, v, r, 0));
defineGlyphAnchor("angle3", (m, v, r) => angle3Anchor(m, v, str(r.args[0]), str(r.args[1]), str(r.args[2])));
defineGlyphAnchor("arcLength", (m, v, r) => arcAnchor(m, v, str(r.args[0])));

// The driven readings of the same kinds, and of the kinds only `measure` has.
const reading = (kind: string, text: (v: number) => string) =>
  defineGlyphLabel(`measure:${kind}`, (m, r) => {
    const v = measured(m, r.args);
    return Number.isFinite(v) ? text(v) : null;
  });
reading("along", formatValue);
reading("fdist", formatValue);
reading("length", formatValue);
reading("angle3", deg);
reading("fangle", deg);
reading("arclen", (v) => `⌒${formatValue(v)}`);
reading("major", (v) => `a${formatValue(v)}`);
reading("minor", (v) => `b${formatValue(v)}`);
defineGlyphAnchor("measure:along", (m, v, r) => alongAnchor(m, v, r, 1));
defineGlyphAnchor("measure:fdist", (m, v, r) => fdistAnchor(m, v, str(r.args[1]), str(r.args[2])));
defineGlyphAnchor("measure:angle3", (m, v, r) => angle3Anchor(m, v, str(r.args[1]), str(r.args[2]), str(r.args[3])));
defineGlyphAnchor("measure:arclen", (m, v, r) => arcAnchor(m, v, str(r.args[1])));
defineGlyphAnchor("measure:fangle", solidAnchor);
defineGlyphAnchor("measure:length", solidAnchor);
defineGlyphAnchor("measure:solid", solidAnchor);
defineGlyphAnchor("measure:major", (m, v, r) => {
  const e = m.entities.get(str(r.args[1]));
  if (e?.kind !== "ellipse") return [];
  return [between(v, m.coords(e.center), m.coords(e.major), [e.name])];
});
defineGlyphAnchor("measure:minor", (m, v, r) => {
  const e = m.entities.get(str(r.args[1]));
  if (e?.kind !== "ellipse") return [];
  return [{ world: m.coords(e.center), dir: [Math.SQRT1_2, Math.SQRT1_2], about: [e.name] }];
});

defineModule("dimensions", {
  label: "Dimensions: to a solid's faces, along a direction, at a vertex, an arc's length",
  relations: {
    faceDistance: { names: ["fdist", "faceDistance"], slots: slots("face", "b", "#distance"), fn: faceDistance, dimension: 2 },
    distAlong: { names: ["along", "distAlong"], slots: slots("a", "b", "direction", "#distance"), fn: distAlong, dimension: 3 },
    angle3: { names: ["ang3", "angle3"], slots: slots("vertex", "a", "b", "#angle"), fn: angle3, dimension: 3 },
    arcLength: { names: ["arclen", "arcLength"], slots: slots("arc", "#length"), fn: arcLength, dimension: 1 },
  },
  commands: (kit) => ({
    // What the dimension tool would put on the drawing, said and not made —
    // its `measure` option, and the menu's Measure (docs/plans/smart-dimension.md).
    measureOf: (...names: unknown[]) => {
      if (!names.length || names.some((n) => typeof n !== "string")) {
        throw new Error('measureOf takes what to measure, by name — measureOf("e1.lid", "e1.base")');
      }
      const plan = dimensionFor(kit.model, names as string[], { driven: true });
      if (!plan?.reading) throw new Error(`${(names as string[]).join(" and ")} make no measurement — see help("dimension")`);
      const text = plan.reading.replace(/^\((.*)\)$/, "$1");
      kit.log?.(`${plan.label.replace(/ \(driven\)$/, "")}: ${text}`);
      return text;
    },
  }),
  help: [
    "dimension  The dimension tool is SolidWorks' smart dimension: click what to",
    "           dimension — one, two or three things — then where its label goes.",
    "           A line: its length; a circle: ⌀ (an arc: R; the radial option says",
    "           otherwise); two points, centres or a line's ends placed above or",
    "           below them: horizontal (along), beside them: vertical, between:",
    "           the true distance; two lines: the angle, or the distance if",
    "           parallel; three points: the angle at the first (ang3); an arc and",
    "           its two ends: its length (arclen). A solid's vertex, edge or face",
    "           (vertex before edge before face under the hand): two faces, a",
    "           face and a point or edge — square to the face (fdist), or the",
    "           angle; two walls of one extrude are their lines; a lid and its",
    "           own base is the depth, opened to set. A dimension that would",
    "           repeat or contradict what is held is made driven, and said.",
    "           Double-click (double-tap) a dimension to set its value.",
    '           fdist("e1.lid", "e2.lid", 15)  along("p1", "p2", "origin.x", 30)',
    '           ang3("p1", "p2", "p3", deg(40))  arclen("a1", 25)',
    '           measureOf("e1.lid", "e1.base") — the reading, nothing made.',
  ],
});
