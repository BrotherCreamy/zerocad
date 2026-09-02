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
//
// The one piece of geometry this file does not own is the arc-sweep test —
// "is this angle inside the arc?" — which lives in intersect.ts because
// snapping to a crossing needs the same answer. Two copies of it would
// eventually disagree about an arc's last few pixels.
//
// There is one tier above everything here, and it is not in this file: the
// constraint glyphs (see glyphs.ts), which the engine consults before calling
// `hitTest` at all. They live a layer up because they are UI drawn over the
// drawing rather than part of it — the same reason snapping ignores them.

import type { Entity, Model, RelationEntry } from "./model.ts";
import { arcSlack, screenAngle, withinSweep } from "./intersect.ts";
import { frameArms, frameMarker } from "./framemarker.ts";
import { worldToScreen, type View } from "./view.ts";

/**
 * What a pick can be. `"relation"` is not an entity kind: it is a constraint
 * glyph, which the engine hit-tests ahead of everything here (see glyphs.ts).
 * It rides in the same envelope because everything downstream of a pick —
 * the hover tag, the highlight, dropping a name into the command line — wants
 * to do the same thing with it, and a second parallel type would mean writing
 * all of that twice.
 */
export type PickKind = Entity["kind"] | "relation";

export interface Pick {
  name: string;
  kind: PickKind;
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
      // A small slack so the very ends of an arc are still pickable. The test
      // itself lives in intersect.ts, so snapping to a crossing and picking a
      // rim agree on where an arc stops.
      if (!withinSweep(a0, a1, here, arcSlack(r, PICK_CURVE))) continue;
    }
    best = { name: e.name, kind: e.kind, distance: d };
  }
  if (best) return best;

  // Tier 3: lines — nearest point on the *segment*, so the infinite extension
  // of a short edge is not pickable halfway across the drawing — and frames,
  // which are the two arms of their axes marker and nothing else.
  //
  // Frames share the tier rather than out-ranking lines because there is
  // nothing deliberate about where a marker lands: unlike a constraint glyph
  // it sits wherever its origin does, so it has no claim to win a tie it is
  // not actually nearer. Its origin *point* still wins outright from tier 1,
  // which is the right answer — a click on the corner of the marker is a click
  // on the point the marker is drawn from, and dragging that turns the frame.
  for (const e of model.entities.values()) {
    if (e.kind !== "line") continue;
    const d = toSegment(sx, sy, screenOf(e.refs[0]), screenOf(e.refs[1]));
    if (d !== null && d < PICK_LINE && (!best || d < best.distance)) {
      best = { name: e.name, kind: "line", distance: d };
    }
  }
  for (const e of model.entities.values()) {
    if (e.kind !== "frame") continue;
    const marker = frameMarker(model, view, e.name);
    if (!marker) continue; // collapsed: nothing drawn, so nothing to hit
    for (const [a, b] of frameArms(marker)) {
      const d = toSegment(sx, sy, a, b);
      if (d !== null && d < PICK_LINE && (!best || d < best.distance)) {
        best = { name: e.name, kind: "frame", distance: d };
      }
    }
  }
  return best;
}

/** Distance from (sx, sy) to the segment a–b, or null if the segment is a dot. */
function toSegment(sx: number, sy: number, [ax, ay]: [number, number], [bx, by]: [number, number]): number | null {
  const len = dist(ax, ay, bx, by);
  if (len < 1e-6) return null;
  const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (len * len)));
  return dist(sx, sy, ax + t * (bx - ax), ay + t * (by - ay));
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
 * Constraint glyphs drawn on the canvas are the fuller answer, and they land in
 * the same tag: hovering one describes the *relation* rather than the geometry,
 * so `r5  coin p5 p3` appears under the cursor for the same reason `p5  12, 30`
 * does. One tag, one code path, no second way to say the same thing.
 */
export function describePick(model: Model, pick: Pick): string {
  if (pick.kind === "relation") {
    const r = model.relations.get(pick.name);
    return r ? describeRelation(r) : pick.name;
  }
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
  return `${describeGeometry(model, pick.name, pick.kind, n)}${relationTag(model, pick.name)}`;
}

/**
 * The short name each relation is called by at the command line, keyed by the
 * op the model records. Both `rels()` and the hover tag print through it, so a
 * relation reads back as something you could have typed — `r3  coin p5 p3` is
 * a line you can retype, `r3  coincident p5 p3` is not quite.
 *
 * It lives here rather than in replenv.ts, where it started, because the hover
 * tag needs it and picking sits below the command surface. One table, so the
 * canvas and the command line cannot drift into calling the same relation two
 * different things.
 */
export const SHORT_OP: Record<string, string> = {
  coincident: "coin", midpoint: "mid",
  parallel: "par", perpendicular: "perp", angle: "ang", pointOnLine: "on",
  equalLength: "eq", radius: "rad", onCircle: "oncircle", concentric: "conc",
  equalRadius: "eqrad", tangent: "tan", symmetric: "sym", arcEndpoints: "arcends",
};

export function describeRelation(r: RelationEntry): string {
  const arg = (a: unknown) => (typeof a === "string" ? a : JSON.stringify(a));
  return `${r.name}  ${SHORT_OP[r.op] ?? r.op} ${r.args.map(arg).join(" ")}`.trimEnd();
}

function relationTag(model: Model, name: string): string {
  const rs = model.relationsNaming(name);
  return rs.length ? `  ·  ${rs.map((r) => r.name).join(" ")}` : "";
}

function describeGeometry(model: Model, name: string, kind: Entity["kind"], n: (v: number) => string): string {
  switch (kind) {
    case "point":
      return `${name}  ${model.coords(name).map(n).join(", ")}`;
    case "circle":
    case "arc":
      return `${name}  r ${n(model.radius(name))}`;
    case "line": {
      const l = model.line(name);
      const [a, b] = [model.coords(l.refs[0]), model.coords(l.refs[1])];
      return `${name}  ${l.refs[0]}–${l.refs[1]}  len ${n(Math.hypot(b[0] - a[0], b[1] - a[1]))}`;
    }
    // A frame picks by its axes marker (see framemarker.ts). The tag says
    // whether it is the default, because that is the whole difference between
    // a frame a bare `hor` means and one it does not.
    case "frame": {
      const f = model.frame(name);
      const dflt = model.defaultFrame === name ? "  (default)" : "";
      return `${name}  origin ${f.origin}, +x toward ${f.xref}${dflt}`;
    }
  }
}
