// One small marker per relation, drawn beside the geometry it constrains.
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

import type { Model, RelationEntry } from "./model.ts";
import { worldToScreen, type View } from "./view.ts";

/** How far a glyph sits from its anchor, in screen pixels. */
export const GLYPH_OFFSET = 15;
/** How far apart glyphs sharing one anchor sit, in screen pixels. */
export const GLYPH_STEP = 17;
/** Half the glyph's box — its drawn size and its pick region, in pixels. */
export const GLYPH_HALF_W = 9;
export const GLYPH_HALF_H = 8;

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
  horizontal: "—",
  vertical: "|",
  parallel: "∥",
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

/** Where a glyph belongs, and which way it is nudged off that spot. */
interface Anchor {
  /** World coordinates. */
  world: number[];
  /** A *screen*-space unit vector, so the nudge is constant under zoom. */
  dir: [number, number];
}

const DIAG = Math.SQRT1_2;
/**
 * Down and to the right of a point. Up-right is taken: main.ts draws a point's
 * own name there, and a glyph on top of the name helps nobody.
 */
const DOWN_RIGHT: [number, number] = [DIAG, DIAG];

/** The screen-space unit direction of a world-space one. Screen y is flipped. */
function screenDir(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9)) return DOWN_RIGHT;
  return [dx / len, -dy / len];
}

/** A quarter turn, so a glyph on an edge sits beside it rather than on it. */
function perp(d: [number, number]): [number, number] {
  return [d[1], -d[0]];
}

function atPoint(model: Model, name: string): Anchor {
  return { world: model.coords(name), dir: DOWN_RIGHT };
}

/** Midway between two points, nudged off to one side of the segment. */
function atSegmentMid(model: Model, aName: string, bName: string): Anchor {
  const a = model.coords(aName), b = model.coords(bName);
  return {
    world: a.map((ai, i) => (ai + b[i]) / 2),
    dir: perp(screenDir(b[0] - a[0], b[1] - a[1])),
  };
}

function atLineMid(model: Model, lineName: string): Anchor {
  const l = model.line(lineName);
  return atSegmentMid(model, l.refs[0], l.refs[1]);
}

/** A point on a circle's rim, at `theta` in world terms, nudged outward. */
function atRim(model: Model, circleName: string, theta: number): Anchor {
  const c = model.circular(circleName);
  const ctr = model.coords(c.center);
  const r = model.radius(circleName);
  const dir = screenDir(Math.cos(theta), Math.sin(theta));
  return { world: [ctr[0] + r * Math.cos(theta), ctr[1] + r * Math.sin(theta)], dir };
}

/**
 * The rim point nearest a line — where a tangency actually touches, or where it
 * is trying to. Found by dropping a perpendicular from the centre onto the
 * infinite line; if the centre is *on* the line (nothing tangent about it, but
 * a solve in progress can pass through that state) the direction is arbitrary
 * rather than NaN, because a renderer must not be able to throw.
 */
function atNearestRim(model: Model, lineName: string, circleName: string): Anchor {
  const c = model.circular(circleName);
  const ctr = model.coords(c.center);
  const l = model.line(lineName);
  const a = model.coords(l.refs[0]), b = model.coords(l.refs[1]);
  const ux = b[0] - a[0], uy = b[1] - a[1];
  const len2 = ux * ux + uy * uy;
  const t = len2 > 1e-12 ? ((ctr[0] - a[0]) * ux + (ctr[1] - a[1]) * uy) / len2 : 0;
  const foot = [a[0] + t * ux, a[1] + t * uy];
  return atRim(model, circleName, Math.atan2(foot[1] - ctr[1], foot[0] - ctr[0]));
}

/** The one string argument that names something the model still holds. */
function firstNamed(model: Model, r: RelationEntry): string | null {
  for (const a of r.args) if (typeof a === "string" && model.entities.has(a)) return a;
  return null;
}

/** Anchors an entity by its kind, for relations with no rule of their own. */
function atEntity(model: Model, name: string): Anchor {
  const e = model.entities.get(name)!;
  switch (e.kind) {
    case "point": return atPoint(model, name);
    case "line": return atLineMid(model, name);
    case "circle":
    case "arc": return atRim(model, name, Math.PI / 4);
  }
}

const str = (v: unknown): string => v as string;

/**
 * Where a relation's glyphs go — one anchor per glyph, so the relations that
 * are a claim about *two* things (parallel, equal length, symmetric) get a mark
 * on each of them. That is the whole reason `⊥` is worth drawing twice: one
 * mark on one line says a right angle exists somewhere, two marks say which
 * pair.
 */
function anchorsFor(model: Model, r: RelationEntry): Anchor[] {
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
      return [atSegmentMid(model, str(args[0]), str(args[1]))];
    case "horizontal":
    case "vertical":
      // Both forms exist — one line name, or two point names — and the glyph
      // goes beside the edge either way.
      return [args.length === 1
        ? atLineMid(model, str(args[0]))
        : atSegmentMid(model, str(args[0]), str(args[1]))];
    case "parallel":
    case "perpendicular":
    case "angle":
    case "equalLength":
      return [atLineMid(model, str(args[0])), atLineMid(model, str(args[1]))];
    case "equalRadius":
      return [atRim(model, str(args[0]), Math.PI / 4), atRim(model, str(args[1]), Math.PI / 4)];
    case "concentric":
      return [atPoint(model, model.circular(str(args[0])).center)];
    case "radius":
      return [atRim(model, str(args[0]), Math.PI / 4)];
    case "tangent":
      return [atNearestRim(model, str(args[0]), str(args[1]))];
    case "symmetric":
      return [atPoint(model, str(args[0])), atPoint(model, str(args[1]))];
    case "arcEndpoints": {
      const a = model.arc(str(args[0]));
      return [atPoint(model, a.start), atPoint(model, a.end)];
    }
    default: {
      const name = firstNamed(model, r);
      return name ? [atEntity(model, name)] : [];
    }
  }
}

/**
 * The entities a relation constrains — everything it named that the model still
 * holds. This is what a hovered glyph lights up, and it is the payoff of the
 * whole feature: hover `⊥` and see *which two* lines it means.
 */
export function constrainedBy(model: Model, relationName: string): string[] {
  const r = model.relations.get(relationName);
  if (!r) return [];
  return r.args.filter((a): a is string => typeof a === "string" && model.entities.has(a));
}

/**
 * Every glyph the drawing should be wearing, in relation order.
 *
 * A relation whose anchor cannot be computed is skipped rather than thrown
 * over. This runs inside the render loop, and the one thing a render loop must
 * never do is take the app down — a constraint naming an entity that is somehow
 * gone should cost its own glyph and nothing else.
 */
export function placeGlyphs(model: Model, view: View): Glyph[] {
  const out: Glyph[] = [];
  /** How many glyphs already claimed each anchor, for the stacking row. */
  const taken = new Map<string, number>();

  for (const r of model.relations.values()) {
    let anchors: Anchor[];
    try {
      anchors = anchorsFor(model, r);
    } catch {
      continue;
    }
    const symbol = GLYPH_SYMBOL[r.op] ?? fallbackSymbol(r.op);
    const highlights = constrainedBy(model, r.name);
    for (const a of anchors) {
      const anchor = worldToScreen(view, [a.world[0], a.world[1]]);
      // Rounded to the pixel, and keyed by direction too: two glyphs nudged
      // opposite ways from one spot are not in each other's way and should not
      // be pushed apart as though they were.
      const key = `${Math.round(anchor[0])}:${Math.round(anchor[1])}:${a.dir[0].toFixed(2)}:${a.dir[1].toFixed(2)}`;
      const nth = taken.get(key) ?? 0;
      taken.set(key, nth + 1);
      out.push({
        relation: r.name,
        op: r.op,
        symbol,
        highlights,
        anchor,
        screen: [anchor[0] + a.dir[0] * GLYPH_OFFSET + nth * GLYPH_STEP, anchor[1] + a.dir[1] * GLYPH_OFFSET],
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
    if (Math.abs(dx) > GLYPH_HALF_W || Math.abs(dy) > GLYPH_HALF_H) continue;
    const d = Math.hypot(dx, dy);
    if (d < bestD) { best = gl; bestD = d; }
  }
  return best;
}
