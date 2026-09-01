// What is under the cursor.
//
// Ported from cellwork, whose answer to "how do you select things" is worth
// restating because it is not the obvious one: **there is no selection set.**
// Clicking geometry drops its *name* into the command line. The viewport is a
// selection portal, not a place where state accumulates — so there is nothing
// to get out of sync, nothing to clear, and no second way to refer to an
// entity. It suits this codebase even better than it suited cellwork, because
// every relation here already takes entity names as strings: click two lines
// and `fillet(` is most of the way written.
//
// Hit-testing is in *screen* space, not world space, so the pick tolerance is
// a constant number of pixels however far the view is zoomed — which is what
// a hand expects.
//
// The tiers matter as much as the tolerances. A point sitting on a line is
// under the cursor at the same time as the line, and it is almost always the
// point that was meant, so points win outright rather than by being nearer.

import type { Entity, Model } from "./model.ts";
import { worldToScreen, type View } from "./view.ts";

export interface Pick {
  name: string;
  kind: Entity["kind"];
  /** Screen-space distance in pixels, for choosing between candidates. */
  distance: number;
}

/** Pick radii in screen pixels, largest first — these are cellwork's. */
export const PICK_POINT = 8;
export const PICK_CURVE = 6;
export const PICK_LINE = 5;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/** Angle from a circle's centre to a point, in screen space (y-down). */
function screenAngle(cx: number, cy: number, sx: number, sy: number): number {
  return Math.atan2(sy - cy, sx - cx);
}

/** How far counter-clockwise (in world terms) `to` is from `from`, in [0, 2pi). */
function sweepFrom(from: number, to: number): number {
  let d = from - to; // screen angles run the other way from world angles
  while (d < 0) d += Math.PI * 2;
  while (d >= Math.PI * 2) d -= Math.PI * 2;
  return d;
}

/**
 * The entity under (sx, sy), or null. Screen coordinates are canvas-relative,
 * the same ones a PointerEvent gives after subtracting the bounding rect.
 *
 * Picking reads the first two coordinates of a point, so it is a 2D-viewport
 * operation by nature — in a 3D model it picks against the projection the
 * viewport is already drawing.
 */
export function hitTest(model: Model, view: View, sx: number, sy: number): Pick | null {
  const screenOf = (name: string) => {
    const c = model.coords(name);
    return worldToScreen(view, [c[0], c[1]]);
  };

  // Tier 1: points.
  let best: Pick | null = null;
  for (const e of model.entities.values()) {
    if (e.kind !== "point") continue;
    const [px, py] = screenOf(e.name);
    const d = dist(sx, sy, px, py);
    if (d < PICK_POINT && (!best || d < best.distance)) best = { name: e.name, kind: "point", distance: d };
  }
  if (best) return best;

  // Tier 2: circles and arcs — near the rim, not near the middle. An arc also
  // has to be within its own sweep, or every arc would pick as a whole circle.
  for (const e of model.entities.values()) {
    if (e.kind !== "circle" && e.kind !== "arc") continue;
    const [cx, cy] = screenOf(e.center);
    const r = model.radius(e.name) * view.scale;
    const d = Math.abs(dist(sx, sy, cx, cy) - r);
    if (d >= PICK_CURVE || (best && d >= best.distance)) continue;

    if (e.kind === "arc") {
      const a0 = screenAngle(cx, cy, ...screenOf(e.start));
      const a1 = screenAngle(cx, cy, ...screenOf(e.end));
      const here = screenAngle(cx, cy, sx, sy);
      // A small slack so the very ends of an arc are still pickable.
      const slack = r > 1 ? PICK_CURVE / r : 0.1;
      if (sweepFrom(a0, here) > sweepFrom(a0, a1) + slack) continue;
    }
    best = { name: e.name, kind: e.kind, distance: d };
  }
  if (best) return best;

  // Tier 3: lines — nearest point on the *segment*, so the infinite extension
  // of a short edge is not pickable halfway across the drawing.
  for (const e of model.entities.values()) {
    if (e.kind !== "line") continue;
    const [ax, ay] = screenOf(e.refs[0]);
    const [bx, by] = screenOf(e.refs[1]);
    const len = dist(ax, ay, bx, by);
    if (len < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (len * len)));
    const d = dist(sx, sy, ax + t * (bx - ax), ay + t * (by - ay));
    if (d < PICK_LINE && (!best || d < best.distance)) best = { name: e.name, kind: "line", distance: d };
  }
  return best;
}

/**
 * A short description of a pick, for the hover tag — and the whole of this
 * package's *visibility* story.
 *
 * The tag ends with the names of the relations constraining what is under the
 * cursor (`p5  12, 30 · r3 r7`). That is what makes an inferred constraint
 * answerable for: a tool that quietly made your new corner coincident with an
 * old one has now said so somewhere you will look, and the flow from noticing
 * to undoing it needs no new interaction model — hover to see `r7`, click to
 * put the name in the command line, type `del("r7")`.
 *
 * Constraint glyphs drawn on the canvas are the fuller answer and a follow-up;
 * they build on the same registry.
 */
export function describePick(model: Model, pick: Pick): string {
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
  return `${describeGeometry(model, pick, n)}${relationTag(model, pick.name)}`;
}

function relationTag(model: Model, name: string): string {
  const rs = model.relationsNaming(name);
  return rs.length ? `  ·  ${rs.map((r) => r.name).join(" ")}` : "";
}

function describeGeometry(model: Model, pick: Pick, n: (v: number) => string): string {
  switch (pick.kind) {
    case "point":
      return `${pick.name}  ${model.coords(pick.name).map(n).join(", ")}`;
    case "circle":
    case "arc":
      return `${pick.name}  r ${n(model.radius(pick.name))}`;
    case "line": {
      const l = model.line(pick.name);
      const [a, b] = [model.coords(l.refs[0]), model.coords(l.refs[1])];
      return `${pick.name}  ${l.refs[0]}–${l.refs[1]}  len ${n(Math.hypot(b[0] - a[0], b[1] - a[1]))}`;
    }
  }
}
