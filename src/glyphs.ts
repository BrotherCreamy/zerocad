// One small marker per relation, drawn beside the geometry it constrains — and
// for the three dimensioned relations, that marker is the dimension's *value*.
//
// `dist("p1","p2",50)` used to put a ↔ on the drawing and the 50 nowhere. In
// Onshape a dimension *is* its number, so `dist`, `rad` and `ang` draw theirs
// (`50`, `R12`, `45°`) in place of a generic mark. That is a label, not a
// second overlay: it hovers, picks, highlights and switches off through
// `glyphs(false)` exactly as every other mark does, because it *is* one. The
// only thing it needs that a mark did not is a box the width of its text —
// hence `halfW` per glyph. Editing a value *on the canvas* is deliberately not
// part of this: a click drops the relation's name in the command line like any
// other glyph. Editing itself is `set("d1.value", 60)` at the command line (see
// operations.ts), or Set value… on the glyph's right-click menu, which types
// that command and leaves the number to the user.
//
// This is the fuller answer to the question the hover tag only half answers.
// The tag says "something constrains this point, and it is called r7" — but
// only once you have thought to hover the right thing. A glyph says it without
// being asked, which is how a user discovers the constraints inference created
// on their behalf. Onshape draws them; people arrive already knowing what they
// are.
//
// This module computes *placements* and nothing else. It reads the model and
// the view and hands back a list; it does not draw (main.ts does), it does not
// hit-test the pointer (the engine does, through `glyphAt` below), and it holds
// no state at all. That keeps it testable without a canvas — the same reason
// view.ts and picking.ts are shaped this way.
//
// Two rules run through all of it:
//
//   * **Anchors are world-space, offsets are screen-space.** A glyph belongs to
//     a place in the drawing, so the anchor is computed from coordinates and
//     follows the geometry when it moves. How far the glyph sits *from* that
//     place is a constant number of pixels at any zoom — the same convention
//     every tolerance in this codebase uses, and the only one a hand agrees
//     with.
//   * **No layout engine.** Glyphs sharing an anchor stack in a row and that is
//     the whole of the crowding story. A busy drawing will crowd; `glyphs(false)`
//     is the answer to that in v1, deliberately, because a real layout pass is a
//     much larger piece of work with its own failure modes (labels that jump
//     about as the drawing solves being the obvious one).

import { parseAxisRef, referentOf, type Model, type RelationEntry } from "./model.ts";
import { viewAxes, worldToScreen, type View } from "./view.ts";
import { dot3, lift3, sub3 } from "./vec3.ts";
import { curvePlaneOf } from "./curveplane.ts";
import { axisReader, turnPoint } from "./relations/revolution.ts";
import { inSight, type Occlusion } from "./occlusion.ts";

/** How far a glyph sits from its anchor, in screen pixels. */
export const GLYPH_OFFSET = 15;
/** How far apart glyphs sharing one anchor sit, in screen pixels. */
export const GLYPH_STEP = 17;
/** Half the glyph's box — its drawn size and its pick region, in pixels. */
export const GLYPH_HALF_W = 9;
export const GLYPH_HALF_H = 8;

/**
 * One character's advance in the 12px monospace the renderer draws glyphs in.
 *
 * This file has no canvas and must not grow one — it is a pure function of
 * (model, view) and that is what lets it be tested without a browser. So a
 * dimension label's box is sized from a constant rather than from
 * `measureText`, which is honest only as long as the constant matches the font
 * main.ts actually sets. An e2e test measures the real advance in the browser
 * and fails if the two drift apart; that is the guard, not a comment.
 */
export const GLYPH_CHAR_W = 7.2;
/** Breathing room either side of a label's text, in pixels. */
const LABEL_PAD = 5;
/** And outside its box, when it shares an anchor with something else. */
const LABEL_MARGIN = 2;

export interface Glyph {
  /** The relation's name, `r5` — what a click drops into the command line. */
  relation: string;
  /** The op the model recorded, e.g. `coincident`. */
  op: string;
  /** The short mark drawn in the box. */
  symbol: string;
  /** Centre of the glyph box, in canvas-relative pixels. */
  screen: [number, number];
  /** The place in the drawing it belongs to, in the same pixels. */
  anchor: [number, number];
  /** The entities it constrains — what lights up when it is hovered. */
  highlights: string[];
  /**
   * Half the box's width and height, in pixels — its drawn size *and* its pick
   * region, which are the same rectangle on purpose. A generic mark is always
   * `GLYPH_HALF_W` × `GLYPH_HALF_H`; a dimension label is as wide as its text,
   * because aiming at `120.5` must not mean aiming at a 18px square that clips
   * it.
   */
  halfW: number;
  halfH: number;
  /** True for the dimensioned relations, which draw their value, not a mark. */
  isLabel: boolean;
  /**
   * The entities its anchor is on — the point it sits beside, the edge or rim
   * it is nudged off, the two points of a segment it is placed on. What a glyph
   * follows when geometry is quiet (quiet.ts): a mark on a quiet corner or a
   * solid's quiet edge is quiet with it; one anchored between two things (an
   * angle's corner, a tangency's touch) is drawn while either is.
   */
  about: string[];
  /**
   * For a `dist` label, the two points it measures between, in the same
   * pixels — what the witness and dimension lines are drawn from. Absent for
   * everything else, which is how the renderer knows there is nothing to draw.
   */
  ends?: [[number, number], [number, number]];
}

/**
 * The mark drawn for each relation.
 *
 * Chosen for legibility at 11px in the app's monospace stack, checked in a
 * browser rather than in the source. Where the obvious mathematical symbol was
 * either unavailable or muddy at that size it has been swapped for something
 * plainer — a crisp `#` beats a tofu box, and the hover tag carries the real
 * name anyway. See the CHANGELOG entry for which ones were substituted and why.
 *
 * `coincident` gets the cleanest mark on purpose: it is far and away the most
 * common relation, because it is the one inference produces.
 */
export const GLYPH_SYMBOL: Record<string, string> = {
  coincident: "○",
  // A point lying on something is a filled dot *on* that thing — the hollow
  // ring above is two points sharing one place, which is a different claim.
  pointOnLine: "●",
  onCircle: "●",
  arcEndpoints: "●",
  midpoint: "∴",
  // `—` and `|` went with `horizontal` and `vertical`. A level edge wears the
  // parallel mark now, because that is what it now is: parallel to a frame's
  // axis, with the frame's own marker on the canvas saying which direction.
  //
  // `//` rather than `∥` (U+2225), which is not in the browser's monospace and
  // draws as a tofu slab — measured: every other mark advances 7.2246px in
  // that font and `∥` advances 6, which is the substitution showing. It went
  // unnoticed while `par` was rare; it is the commonest mark in the drawing
  // now. `//` is also what a draughtsman writes, so this is the better mark
  // even where the font has the other one. `test/e2e/glyphs.e2e.ts` measures
  // every symbol in this table against the monospace cell, so the next one
  // cannot rot quietly.
  parallel: "//",
  perpendicular: "⊥",
  angle: "∠",
  equalLength: "=",
  equalRadius: "=",
  concentric: "◎",
  tangent: "⌒",
  radius: "r",
  dist: "↔",
  fix: "#",
  symmetric: "⇌",
  // A plane drawn the way a plane is always drawn — a parallelogram, a flat
  // thing seen at an angle. Deferred from the model half of 3D phase 1 until
  // there was a 3D drawing to look at it in.
  onPlane: "▱",
};

/**
 * A mark for a relation this file has never heard of — one authored at the
 * command line, say. Relations are extensible at runtime, so the glyph layer
 * has to be too: a user-defined relation that drew nothing would look like a
 * constraint that does not exist.
 */
function fallbackSymbol(op: string): string {
  return (op[0] ?? "?").toLowerCase();
}

/**
 * A dimension's number, as a draughtsman would write it: `50`, not `50.000`,
 * and `12.347` rather than `12.34657`.
 *
 * Three decimals is the precision the rest of the app already prints at
 * (`ls()`, the hover tag), so a label and the tag under it agree. Trailing
 * zeros go because a dimension reads as a *statement of intent* — someone
 * typed 50 — and `50.000` reads as a measurement.
 */
export function formatValue(v: number): string {
  if (!Number.isFinite(v)) return "?";
  const s = (Math.round(v * 1000) / 1000).toString();
  // Exponential notation for something absurd would be worse than useless in a
  // 30px box, but it is still better than "1e+21" being silently truncated by
  // the box — so it is left alone and the box is sized to it.
  return s;
}

/**
 * The text a dimensioned relation draws instead of its generic mark, or null
 * for every other relation.
 *
 * The value is read straight out of `RelationEntry.args` — the registry keeps
 * the call as it was made — so this is pure UI over data that already exists.
 * A relation whose target argument is not a number (a hand-edited file, a
 * user-defined op that happens to be called `dist`) falls back to the mark
 * rather than drawing `NaN`.
 */
export function labelFor(op: string, args: unknown[]): string | null {
  switch (op) {
    case "dist": {
      const v = args[2];
      return typeof v === "number" ? formatValue(v) : null;
    }
    case "radius": {
      const v = args[1];
      // Onshape's prefix. `R12` says which dimension it is without a leader
      // line having to say it.
      return typeof v === "number" ? `R${formatValue(v)}` : null;
    }
    case "angle": {
      const v = args[2];
      // The relation stores radians — `ang(l1,l2,Math.PI/4)` is how it is
      // typed — but a drawing says degrees, because that is what a drawing has
      // always said and what Onshape shows. The mismatch between the label and
      // what you would retype is filed as an owner decision (see TODO.md);
      // drawing radians on a sketch to paper over it would be the wrong fix.
      // `set("d3.value", …)` takes radians for the same reason — a dimension
      // stores what its relation stores, and guessing the caller's unit from
      // the size of the number would be a worse seam than this one.
      return typeof v === "number" ? `${formatValue((v * 180) / Math.PI)}°` : null;
    }
    case "extrusion": {
      // An extrude's depth is a length, written as `dist` writes one — it is
      // drawn beside a wall, with the wall's witness lines, so it needs no
      // prefix to say what it measures.
      const v = args[1];
      return typeof v === "number" ? formatValue(v) : null;
    }
    case "revolution": {
      // A revolve's angle, as `ang`'s is written and for `ang`'s reasons:
      // radians stored, degrees drawn.
      const v = args[1];
      return typeof v === "number" ? `${formatValue((v * 180) / Math.PI)}°` : null;
    }
    default:
      return null;
  }
}

/** Where a glyph belongs, and which way it is nudged off that spot. */
interface Anchor {
  /** World coordinates. */
  world: number[];
  /** A *screen*-space unit vector, so the nudge is constant under zoom. */
  dir: [number, number];
  /** The span a dimension line should reach across, in world coordinates. */
  ends?: [number[], number[]];
  /** The entities it is on — see `Glyph.about`. */
  about: string[];
}

const DIAG = Math.SQRT1_2;
/**
 * Down and to the right of a point. Up-right is taken: main.ts draws a point's
 * own name there, and a glyph on top of the name helps nobody.
 */
const DOWN_RIGHT: [number, number] = [DIAG, DIAG];

/**
 * The screen direction from one world point to another, as a unit vector — or
 * the default nudge when the two land on the same pixel (an edge seen end-on,
 * a collapsed one). Measured *on screen*, after projecting both ends, because
 * the nudge is a screen-space thing: in 3D a world direction says nothing about
 * which way a glyph should step off an edge until the camera has had its say.
 * For a view that has never been turned this is the old world direction with y
 * flipped.
 */
function dirBetween(view: View, from: number[], to: number[]): [number, number] {
  const [ax, ay] = worldToScreen(view, from);
  const [bx, by] = worldToScreen(view, to);
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return DOWN_RIGHT;
  return [dx / len, dy / len];
}

/** A quarter turn, so a glyph on an edge sits beside it rather than on it. */
function perp(d: [number, number]): [number, number] {
  return [d[1], -d[0]];
}

function atPoint(model: Model, name: string): Anchor {
  return { world: model.coords(name), dir: DOWN_RIGHT, about: [name] };
}

/** Midway between two points, nudged off to one side of the segment. */
function atSegmentMid(model: Model, view: View, aName: string, bName: string): Anchor {
  const a = model.coords(aName), b = model.coords(bName);
  return {
    world: a.map((ai, i) => (ai + b[i]) / 2),
    dir: perp(dirBetween(view, a, b)),
    ends: [a, b],
    about: [aName, bName],
  };
}

function atLineMid(model: Model, view: View, lineName: string): Anchor {
  const l = model.line(lineName);
  return { ...atSegmentMid(model, view, l.refs[0], l.refs[1]), about: [lineName] };
}

/**
 * A point on a circle's rim that appears `theta` round from the screen's right,
 * nudged outward. The rim is the planar one the circle has (see curveplane.ts),
 * which seen at an angle is an ellipse; the point is the one of the rim whose
 * screen direction from the centre is `theta` — so a mark sits off the
 * upper-right of a tilted circle as it does off a square-on one. For a view that
 * has never been turned and a 2D circle this is the old formula exactly: the
 * rim's two directions are the screen's, and the point is `theta` round.
 *
 * Seen edge-on a rim is a segment on screen and most directions miss it; the
 * mark then goes to the rim's own `theta`, which is on the rim and draws.
 */
function atRim(model: Model, view: View, circleName: string, theta: number): Anchor {
  const c = model.circular(circleName);
  const ctr = lift3(model.coords(c.center));
  const r = model.radius(circleName);
  const { u, v } = curvePlaneOf(model, circleName);
  const { right, up } = viewAxes(view);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  // How the rim's two directions land on screen (world-up convention): solve
  // for the in-plane direction whose projection points along theta.
  const [a, b, cc, d] = [dot3(u, right), dot3(v, right), dot3(u, up), dot3(v, up)];
  const det = a * d - b * cc;
  let [p, q] = [cos, sin];
  if (Math.abs(det) > 1e-9) {
    const [x, y] = [(d * cos - b * sin) / det, (a * sin - cc * cos) / det];
    const len = Math.hypot(x, y);
    [p, q] = [x / len, y / len];
  }
  return {
    world: [0, 1, 2].map((i) => ctr[i] + r * (p * u[i] + q * v[i])),
    dir: [cos, -sin],
    about: [circleName],
  };
}

/**
 * The rim point nearest a line — where a tangency actually touches, or where it
 * is trying to. Found by dropping a perpendicular from the centre onto the
 * infinite line, in however many dimensions the drawing has; if the centre is
 * *on* the line (nothing tangent about it, but a solve in progress can pass
 * through that state) the direction is arbitrary rather than NaN, because a
 * renderer must not be able to throw.
 */
function atNearestRim(model: Model, view: View, lineName: string, circleName: string): Anchor {
  const c = model.circular(circleName);
  const ctr = model.coords(c.center);
  const l = model.line(lineName);
  const a = model.coords(l.refs[0]), b = model.coords(l.refs[1]);
  const u = b.map((bi, i) => bi - a[i]);
  const len2 = u.reduce((s, ui) => s + ui * ui, 0);
  const t = len2 > 1e-12 ? ctr.reduce((s, ci, i) => s + (ci - a[i]) * u[i], 0) / len2 : 0;
  const out = a.map((ai, i) => ai + t * u[i] - ctr[i]);
  const len = Math.hypot(...out);
  if (!(len > 1e-12)) return atRim(model, view, circleName, 0);
  const r = model.radius(circleName);
  const world = ctr.map((ci, i) => ci + (r * out[i]) / len);
  return { world, dir: dirBetween(view, ctr, world), about: [lineName, circleName] };
}

/**
 * Where an angle's value goes: at the corner the two lines make, nudged along
 * the bisector into the wedge between them — which is where a draughtsman
 * writes it and where Onshape puts it.
 *
 * Two lines that share no endpoint still have an angle between them, and it is
 * still worth stating; there is simply no corner to write it at, so the label
 * goes midway between the two edges' middles. That is the honest placement for
 * a claim about two directions rather than about a corner.
 */
function atVertex(model: Model, view: View, l1Name: string, l2Name: string): Anchor {
  const l1 = model.line(l1Name), l2 = model.line(l2Name);
  const shared = l1.refs.find((r) => l2.refs.includes(r));
  if (shared === undefined) {
    const a = atLineMid(model, view, l1Name).world, b = atLineMid(model, view, l2Name).world;
    return { world: a.map((ai, i) => (ai + b[i]) / 2), dir: DOWN_RIGHT, about: [l1Name, l2Name] };
  }
  const v = model.coords(shared);
  const away = (l: { refs: [string, string] }) =>
    dirBetween(view, v, model.coords(l.refs[0] === shared ? l.refs[1] : l.refs[0]));
  const [ax, ay] = away(l1), [bx, by] = away(l2);
  const bis = Math.hypot(ax + bx, ay + by);
  // Anti-parallel lines (a straight angle) have no bisector — the two
  // directions cancel. A perpendicular to one of them is as good an answer as
  // any and, unlike NaN, it draws.
  const dir: [number, number] = bis > 1e-9
    ? [(ax + bx) / bis, (ay + by) / bis]
    : perp([ax, ay]);
  return { world: v, dir, about: [l1Name, l2Name] };
}

/**
 * Where a revolve's angle goes: halfway round the path the first profile
 * corner sweeps — the arc a draughtsman would dimension, though nothing draws
 * it but the faces — nudged outward, away from the axis. A full turn names no
 * corners (it holds nothing; see `revolution`), so its label sits beside the
 * axis it turns about: a frame axis at the frame's origin, a line at its middle.
 */
function atRevolution(model: Model, view: View, axis: string, angle: unknown, first: unknown): Anchor {
  const ax = axisReader(model, axis).read();
  if (typeof angle === "number" && typeof first === "string" && model.entities.get(first)?.kind === "point") {
    const p = model.coords(first);
    const world = turnPoint(p, ax, angle / 2);
    const v = sub3(lift3(world), ax.origin);
    const foot = ax.origin.map((o, i) => o + dot3(v, ax.dir) * ax.dir[i]);
    return { world, dir: dirBetween(view, foot, world), about: [first] };
  }
  const ref = parseAxisRef(axis);
  if (ref) return atPoint(model, model.frame(ref.frame).origin);
  return { ...atLineMid(model, view, axis), ends: undefined };
}

/** The one string argument that names something the model still holds. */
function firstNamed(model: Model, r: RelationEntry): string | null {
  for (const a of r.args) if (typeof a === "string" && model.entities.has(a)) return a;
  return null;
}

/** Anchors an entity by its kind, for relations with no rule of their own. */
function atEntity(model: Model, view: View, name: string): Anchor {
  const e = model.entities.get(name)!;
  switch (e.kind) {
    case "point": return atPoint(model, name);
    case "line": return atLineMid(model, view, name);
    case "circle":
    case "arc": return atRim(model, view, name, Math.PI / 4);
    // A frame is its origin, as far as a mark beside it is concerned.
    case "frame": return atPoint(model, e.origin);
  }
}

const str = (v: unknown): string => v as string;

/**
 * Whether an argument names something on the canvas, as opposed to a frame
 * axis (`"f1.x"`) or a number.
 *
 * An exact lookup is the whole test and no syntax knowledge is needed for it:
 * a name may not contain a dot (see `Model.claimName`), so an axis reference
 * can never be an entity's name.
 */
function isGeometry(model: Model, arg: unknown): boolean {
  return typeof arg === "string" && model.entities.has(arg);
}

/** That entity's own anchor, or nothing at all for a side with no geometry. */
function anchorIfGeometry(model: Model, view: View, arg: unknown): Anchor[] {
  return isGeometry(model, arg) ? [atEntity(model, view, str(arg))] : [];
}

/**
 * Where a relation's glyphs go — one anchor per glyph, so the relations that
 * are a claim about *two* things (parallel, equal length, symmetric) get a mark
 * on each of them. That is the whole reason `⊥` is worth drawing twice: one
 * mark on one line says a right angle exists somewhere, two marks say which
 * pair.
 */
function anchorsFor(model: Model, view: View, r: RelationEntry): Anchor[] {
  const args = r.args;
  switch (r.op) {
    case "coincident":
      return [atPoint(model, str(args[0]))];
    case "fix":
    case "midpoint":
    case "pointOnLine":
    case "onCircle":
      return [atPoint(model, str(args[0]))];
    case "dist":
      return [atSegmentMid(model, view, str(args[0]), str(args[1]))];
    case "parallel":
    case "perpendicular": {
      // A mark on each side that is real geometry. Three arguments is the
      // point-pair form (`par("p1","p3","f.x")`), whose first side is a
      // segment rather than an edge.
      //
      // **A frame axis gets no mark of its own**, which is what these two
      // needed over `equalLength` below. There is no second line to put one
      // beside, and inventing a place for it — the frame's origin, say — would
      // be a mark sitting on geometry the relation does not constrain. The
      // frame's own marker is already on the canvas saying where the direction
      // comes from, and hovering the mark on the line highlights it.
      const pointForm = args.length === 3;
      const first = pointForm
        ? [atSegmentMid(model, view, str(args[0]), str(args[1]))]
        : anchorIfGeometry(model, view, args[0]);
      return [...first, ...anchorIfGeometry(model, view, args[pointForm ? 2 : 1])];
    }
    case "equalLength":
      return [atLineMid(model, view, str(args[0])), atLineMid(model, view, str(args[1]))];
    // One label, not two. `∥` is drawn twice because a single mark would leave
    // "parallel to *what*" unanswered; `45°` written twice is just the same
    // number in two places, and Onshape writes it once, at the corner.
    case "angle": {
      if (isGeometry(model, args[0]) && isGeometry(model, args[1])) {
        return [atVertex(model, view, str(args[0]), str(args[1]))];
      }
      // Against a frame axis there is no corner to write it at: the angle is
      // to a *direction*, and the two never meet. It goes beside the edge.
      return anchorIfGeometry(model, view, isGeometry(model, args[0]) ? args[0] : args[1]);
    }
    case "equalRadius":
      return [atRim(model, view, str(args[0]), Math.PI / 4), atRim(model, view, str(args[1]), Math.PI / 4)];
    case "concentric":
      return [atPoint(model, model.circular(str(args[0])).center)];
    case "radius":
      return [atRim(model, view, str(args[0]), Math.PI / 4)];
    case "tangent":
      return [atNearestRim(model, view, str(args[0]), str(args[1]))];
    case "symmetric":
      return [atPoint(model, str(args[0])), atPoint(model, str(args[1]))];
    case "arcEndpoints": {
      const a = model.arc(str(args[0]));
      return [atPoint(model, a.start), atPoint(model, a.end)];
    }
    // One label for the whole lid, on the first pair it holds — the first
    // corner's wall, which the expansion lists first — measured base to twin
    // like a `dist`, so the depth reads as the length of an edge you can see.
    case "extrusion":
      return [atSegmentMid(model, view, str(args[2]), str(args[3]))];
    case "revolution":
      return [atRevolution(model, view, str(args[0]), args[1], args[2])];
    default: {
      const name = firstNamed(model, r);
      return name ? [atEntity(model, view, name)] : [];
    }
  }
}

/**
 * The entities a relation constrains — everything it named that the model still
 * holds. This is what a hovered glyph lights up, and it is the payoff of the
 * whole feature: hover `⊥` and see *which two* lines it means.
 *
 * An axis reference lights up its **frame**, which is what `hor(l1, f1)` did
 * when the frame was an ordinary argument. Hovering the `∥` on a levelled edge
 * should still answer "level with *what*", and the answer is a marker on the
 * canvas that can be highlighted.
 */
export function constrainedBy(model: Model, relationName: string): string[] {
  const r = model.relations.get(relationName);
  if (!r) return [];
  const out: string[] = [];
  for (const a of r.args) {
    const name = referentOf(a);
    if (name !== null && model.entities.has(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Every glyph the drawing should be wearing, in relation order.
 *
 * A relation whose anchor cannot be computed is skipped rather than thrown
 * over. This runs inside the render loop, and the one thing a render loop must
 * never do is take the app down — a constraint naming an entity that is somehow
 * gone should cost its own glyph and nothing else.
 *
 * `occ`, when given, is what a solid hides this frame (occlusion.ts — the
 * answer the draw pass and the pick share): a glyph whose anchor is behind a
 * visible face is left out, so it is neither drawn nor clicked, and a
 * dimension's label takes its witness and dimension lines with it. Asked of
 * the anchor, the place in the drawing a mark is about, rather than of the
 * box, which floats a fixed number of pixels off it and is in front of
 * nothing. Null — no solid, or the hidden and wire modes — places every glyph.
 */
export function placeGlyphs(model: Model, view: View, occ: Occlusion | null = null): Glyph[] {
  const out: Glyph[] = [];
  /**
   * How far along each anchor's row is already spoken for — the right-hand edge
   * of the last box placed there, relative to the first box's centre.
   *
   * An edge rather than a count, because a row can now hold boxes of different
   * widths: a `110` beside the `—` saying that edge is level. Counting would
   * step both by the same 17px and slide the wide one under its neighbour,
   * which is how `— 110` came to read as *minus* 110 in the first drawing this
   * was tried on.
   */
  const taken = new Map<string, number>();

  for (const r of model.relations.values()) {
    let anchors: Anchor[];
    try {
      anchors = anchorsFor(model, view, r);
    } catch {
      continue;
    }
    const label = labelFor(r.op, r.args);
    const symbol = label ?? GLYPH_SYMBOL[r.op] ?? fallbackSymbol(r.op);
    // Sized to the text, so the box a label is picked by is the box it is drawn
    // in. A generic mark keeps the square it always had.
    const halfW = label
      ? Math.max(GLYPH_HALF_W, ([...label].length * GLYPH_CHAR_W) / 2 + LABEL_PAD)
      : GLYPH_HALF_W;
    const highlights = constrainedBy(model, r.name);
    for (const a of anchors) {
      if (!inSight(occ, a.world)) continue;
      const anchor = worldToScreen(view, a.world);
      // Rounded to the pixel, and keyed by direction too: two glyphs nudged
      // opposite ways from one spot are not in each other's way and should not
      // be pushed apart as though they were.
      const key = `${Math.round(anchor[0])}:${Math.round(anchor[1])}:${a.dir[0].toFixed(2)}:${a.dir[1].toFixed(2)}`;
      // Where along the row this box's centre goes: hard against what is
      // already there, plus each box's own margin. Marks keep the half-pixel
      // *overlap* they have always had (two of them land GLYPH_STEP apart,
      // narrower than their boxes); a label asks for daylight instead, since a
      // number touching a neighbouring mark reads as one longer number.
      const margin = label ? LABEL_MARGIN : (GLYPH_STEP - GLYPH_HALF_W * 2) / 2;
      const edge = taken.get(key);
      const along = edge === undefined ? 0 : edge + margin + halfW;
      taken.set(key, along + halfW + margin);
      // A wide label nudged *sideways* has to travel the extra width it has
      // over a mark, or its near edge sits where a mark's centre would — on the
      // geometry. Nudged up or down it does not, because it is no taller.
      const push = GLYPH_OFFSET + (halfW - GLYPH_HALF_W) * Math.abs(a.dir[0]);
      out.push({
        relation: r.name,
        op: r.op,
        symbol,
        highlights,
        anchor,
        halfW,
        halfH: GLYPH_HALF_H,
        isLabel: label !== null,
        about: a.about,
        ...(label !== null && a.ends
          ? { ends: a.ends.map((w) => worldToScreen(view, w)) as [[number, number], [number, number]] }
          : {}),
        screen: [anchor[0] + a.dir[0] * push + along, anchor[1] + a.dir[1] * push],
      });
    }
  }
  return out;
}

/**
 * The glyph under (sx, sy), or null — nearest centre among those whose box
 * contains the cursor.
 *
 * Glyphs are the *top* picking tier, which the engine arranges by asking this
 * first. They are small and deliberate to aim at, and a glyph you cannot click
 * because a point happens to sit near it defeats the whole feature. They stay
 * out of snapping for the opposite reason: they are UI, not geometry, and
 * nothing should ever be placed at one.
 */
export function glyphAt(glyphs: Glyph[], sx: number, sy: number): Glyph | null {
  let best: Glyph | null = null;
  let bestD = Infinity;
  for (const gl of glyphs) {
    const dx = sx - gl.screen[0], dy = sy - gl.screen[1];
    if (Math.abs(dx) > gl.halfW || Math.abs(dy) > gl.halfH) continue;
    // Nearest *centre*, still — a wide label whose centre is further away than
    // a mark's loses the overlap, which is the same rule as before and keeps a
    // small mark clickable when a long dimension is drawn over it.
    const d = Math.hypot(dx, dy);
    if (d < bestD) { best = gl; bestD = d; }
  }
  return best;
}
