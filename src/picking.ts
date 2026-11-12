// What is under the cursor.
//
// Ported from cellwork, whose answer to "how do you select things" was **no
// selection set**: clicking geometry dropped its *name* into the command line,
// and every relation here takes names, so clicking two lines after `fillet(`
// writes most of the call. That still holds while a command is being written.
// With the command line empty a click now selects (tools/selection.ts), which
// grouping needed — a set picked in one gesture — and which every CAD tool
// does. Either way a pick is a *name*: this file answers which one, and the
// engine decides where it goes.
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

import { ORIGIN, endLabel, endRelation, type AxisName, type Entity, type FeatureEntry, type Model, type ProfileMember, type RelationEntry } from "./model.ts";
import { screenAngle, withinSweep } from "./intersect.ts";
import { frameArmPx, frameArms, frameMarker } from "./framemarker.ts";
import { nearestOnPolyline, screenCurve, screenOf as projectPoint } from "./projection.ts";
import { inSight, type Occlusion } from "./occlusion.ts";
import { frameBasis } from "./relations/refs.ts";
import type { View } from "./view.ts";

/**
 * What a pick can be. `"relation"` is not an entity kind: it is a constraint
 * glyph, which the engine hit-tests ahead of everything here (see glyphs.ts).
 * It rides in the same envelope because everything downstream of a pick —
 * the hover tag, the highlight, dropping a name into the command line — wants
 * to do the same thing with it, and a second parallel type would mean writing
 * all of that twice.
 */
export type PickKind = Entity["kind"] | "relation" | "edge" | "face";

export interface Pick {
  name: string;
  /**
   * `"edge"` is a **kernel edge** (docs/plans/solid-fillets.md): an edge of a
   * body the solid kernel built, named by its two faces (`e1.lid|e1.m0`) — no
   * entity, so the host finds it (kerneledges.ts) and says it (`tag`).
   */
  kind: PickKind;
  /** Screen-space distance in pixels, for choosing between candidates. */
  distance: number;
  /** A kernel edge's body — its first feature's name. */
  body?: string;
  /** A kernel edge's hover line, written by the host that found it. */
  tag?: string;
  /** A kernel edge that bounds one face — a surface's boundary (docs/plans/surfaces.md). */
  lamina?: boolean;
  /**
   * The entity a kernel edge was picked in place of — the lid's twin line it
   * lies along — which a press still drags, so a body's edge is resized by
   * its relational skeleton exactly as before edges could be picked.
   */
  under?: Pick;
  /**
   * For a frame: which arm of its marker was nearest — what a tool choosing an
   * *axis* needs (the revolve tool turns it into `"f1.y"`). Absent for every
   * other kind; a frame is still the one thing picked, whichever arm it was.
   */
  axis?: AxisName;
}

/** Pick radii in screen pixels, largest first — these are cellwork's. */
export const PICK_POINT = 8;
export const PICK_CURVE = 6;
export const PICK_LINE = 5;

/**
 * How much further a finger reaches than a mouse: every pick and snap radius
 * is multiplied by this for a touch (the engine passes it; `reach` below).
 *
 * Measured, not guessed: a fingertip covers 7–10 mm of glass, and Apple's
 * smallest target is 44 pt — on an iPhone 13 a CSS pixel is a point, so 44 px,
 * about 7.3 mm. A point's pick radius of 8 px times 2.75 is 22 px, which makes
 * a point exactly a 44 pt target under a finger. One factor for every tier,
 * rather than a radius apiece, so the tiers keep their order — a point still
 * out-reaches the curve it ends, and a curve the line beside it — and a
 * finger landing on a corner still takes the corner.
 */
export const TOUCH_REACH = 22 / PICK_POINT;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * The entity under (sx, sy), or null. Screen coordinates are canvas-relative,
 * the same ones a PointerEvent gives after subtracting the bounding rect.
 *
 * Picking is against the drawing *as projected* — what the viewport is already
 * showing — so in a 3D model it is the same screen-space question it always
 * was, asked of each entity's shape on screen (see projection.ts). Among
 * strokes depth plays no part: a point behind a line is as pickable as one in
 * front of it, which is what a wireframe looks like.
 *
 * **A solid is another matter.** `occ`, when given, is the frame's answer to
 * "what is behind a face" (occlusion.ts) — the very one the draw pass used, so
 * what was not drawn cannot be picked: a point behind a visible face is
 * skipped, and an edge, rim or frame arm is near the cursor only where the
 * place on it nearest the cursor is in sight. Given in a shaded view; null (a
 * plain sketch, or the hidden and wire modes) picks everything, as it always
 * did. Faces themselves still never pick.
 *
 * **What is hidden (`Model.hidden`) never picks**: it is not drawn, and a
 * click on what is not there must not find it.
 */
export function hitTest(
  model: Model, view: View, sx: number, sy: number, occ: Occlusion | null = null, reach = 1,
): Pick | null {
  // A finger's radii (`TOUCH_REACH`) or a mouse's: every tier scaled together.
  const [rPoint, rCurve, rLine] = [PICK_POINT * reach, PICK_CURVE * reach, PICK_LINE * reach];
  const screenOf = (name: string) => projectPoint(model, view, name);
  const seen = (world: number[]) => inSight(occ, world);
  const shown = [...model.entities.values()].filter((e) => !model.hidden.has(e.name));
  // Does a curve at distance d beat the best so far? Within half a pixel it is
  // a tie, and a construction curve loses one to a real curve: a corner's line
  // set aside by a fillet lies along the shorter line made in its place
  // (docs/plans/fillets-one-thing.md), and a trim or an offset asked there is
  // after the real one. Two of a kind keep the first found, as before.
  const closer = (d: number, name: string): boolean => {
    if (!best) return true;
    if (Math.abs(d - best.distance) > 0.5) return d < best.distance;
    return model.isConstruction(best.name) && !model.isConstruction(name);
  };

  // Tier 1: points.
  let best: Pick | null = null;
  for (const e of shown) {
    if (e.kind !== "point") continue;
    const [px, py] = screenOf(e.name);
    const d = dist(sx, sy, px, py);
    if (d < rPoint && (!best || d < best.distance) && seen(model.coords(e.name))) {
      best = { name: e.name, kind: "point", distance: d };
    }
  }
  if (best) return best;

  // Tier 2: circles and arcs — near the rim, not near the middle. An arc also
  // has to be within its own sweep, or every arc would pick as a whole circle.
  // An arc seen obliquely is a polyline on screen, and is near wherever any
  // piece of it is.
  for (const e of shown) {
    if (e.kind === "point" || e.kind === "line" || e.kind === "frame") continue;
    const screen = screenCurve(model, view, e, rCurve);
    if (!screen) continue;
    const shape = screen.curve;
    let d: number;
    if (shape.kind === "polyline") {
      d = nearestOnPolyline(shape.pts, [sx, sy])?.d ?? Infinity;
    } else if (shape.kind === "circle" || shape.kind === "arc") {
      const [cx, cy] = shape.c;
      d = Math.abs(dist(sx, sy, cx, cy) - shape.r);
      // A small slack so the very ends of an arc are still pickable. The test
      // itself lives in intersect.ts, so snapping to a crossing and picking a
      // rim agree on where an arc stops.
      if (shape.kind === "arc" && d < rCurve
        && !withinSweep(shape.a0, shape.a1, screenAngle(cx, cy, sx, sy), shape.slack)) continue;
    } else {
      continue;
    }
    if (d >= rCurve || !closer(d, e.name)) continue;
    if (occ && !seen(screen.lift([sx, sy]))) continue;
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
  for (const e of shown) {
    if (e.kind !== "line") continue;
    const near = toSegment(sx, sy, screenOf(e.refs[0]), screenOf(e.refs[1]));
    if (!near || near.d >= rLine || !closer(near.d, e.name)) continue;
    if (occ) {
      // Orthographic projection is affine, so the fraction along the segment
      // on screen is the fraction along the edge in the world.
      const [A, B] = [model.coords(e.refs[0]), model.coords(e.refs[1])];
      if (!seen(A.map((a, i) => a + near.t * (B[i] - a)))) continue;
    }
    best = { name: e.name, kind: "line", distance: near.d };
  }
  // The origin is a frame with no entity behind it (`ORIGIN`), and picks by
  // its marker like any other — revolve about "origin.z", Set as default.
  // Last, so a frame the user made at the same place wins a tie: theirs is
  // the one they are more likely to be after.
  const frames = [...shown.filter((e) => e.kind === "frame"), ...(model.isFrame(ORIGIN) ? [{ name: ORIGIN }] : [])];
  for (const e of frames) {
    const marker = frameMarker(model, view, e.name);
    if (!marker) continue; // collapsed: nothing drawn, so nothing to hit
    // A marker hidden at its origin is not drawn at all (main.ts), so none of
    // it picks; otherwise an arm is its axis out of the origin for as far as
    // its fixed pixel length reaches (framemarker.ts), which says where in the
    // world the place under the cursor is.
    const basis = occ ? frameBasis(model, e.name)() : null;
    if (basis && !seen(basis.origin)) continue;
    const axes = basis ? [basis.ux, basis.uy, basis.uz ?? []] : [];
    frameArms(marker).forEach(([a, b], arm) => {
      const near = toSegment(sx, sy, a, b);
      if (!near || near.d >= rLine || (best && near.d >= best.distance)) return;
      if (basis) {
        const out = (near.t * frameArmPx(view)) / view.scale;
        if (!seen(basis.origin.map((c, i) => c + (axes[arm][i] ?? 0) * out))) return;
      }
      best = { name: e.name, kind: "frame", distance: near.d, axis: (["x", "y", "z"] as const)[arm] };
    });
  }
  return best;
}

/**
 * Distance from (sx, sy) to the segment a–b, and how far along it the nearest
 * place is (0 at a, 1 at b) — or null if the segment is a dot.
 */
function toSegment(sx: number, sy: number, [ax, ay]: [number, number], [bx, by]: [number, number]): { d: number; t: number } | null {
  const len = dist(ax, ay, bx, by);
  if (len < 1e-6) return null;
  const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (len * len)));
  return { d: dist(sx, sy, ax + t * (bx - ax), ay + t * (by - ay)), t };
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
  if (pick.kind === "edge" || pick.kind === "face") return pick.tag ?? pick.name;
  if (pick.kind === "relation") {
    const r = model.relations.get(pick.name);
    return r ? `${describeRelation(r)}${featureTag(model, pick.name)}${groupTag(model, pick.name)}` : pick.name;
  }
  const n = (v: number) => (Math.round(v * 1000) / 1000).toString();
  // Construction is said right after the geometry, as part of what the thing
  // is: thin and muted on screen is a look, and a look can be mistaken for a
  // hidden line or a far one; the word cannot.
  const kind = model.isConstruction(pick.name) ? "  construction" : "";
  return `${describeGeometry(model, pick.name, pick.kind, n)}${kind}${relationTag(model, pick.name)}`
    + `${featureTag(model, pick.name)}${groupTag(model, pick.name)}`;
}

/**
 * The groups a thing is in, for the very end of the hover tag — `· g1 g2`,
 * the way a feature's piece ends `· e1`: the sets it belongs to, said where
 * the eye already is. `members("g1")` and `select("g1")` take it from there.
 * The open group says so — `· g1 (open)` — which is how new geometry's tag
 * says where it went (docs/plans/organiser.md).
 */
function groupTag(model: Model, name: string): string {
  const gs = model.groupsHolding(name);
  return gs.length ? `  ·  ${gs.map((g) => (g.name === model.openGroup ? `${g.name} (open)` : g.name)).join(" ")}` : "";
}

/**
 * One line for a feature — what `ls()` prints and what the hover tag adds to
 * any piece of one: `e1  extrude of l1,a1,l2,l3,l4 + 1 inside, depth d9 = 20
 * along f1, lid f2`, or `e2  revolve of l5,l6,l7,l8, angle d10 = 270° about
 * f1.y, end f3`. A face is never under the cursor (faces do not pick — see
 * faces.ts), so a feature is reached through its pieces: hovering a wall, a
 * twin, a profile member or the depth's label ends the tag with `· e1`, and
 * `ls()` says what `e1` is.
 */
export function describeFeature(model: Model, f: FeatureEntry): string {
  const inner = f.loops.length - 1;
  const profile = `${f.loops[0].map(profileText).join(",")}${inner ? ` + ${inner} inside` : ""}`;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  if (f.kind === "revolve") {
    // Degrees, as the label on the drawing says it; `rels()` has the radians a
    // `set` takes. A full turn says so, since it is the one that has no end.
    const r = model.relations.get(f.angle);
    const value = r && typeof r.args[1] === "number" ? ` = ${round((r.args[1] * 180) / Math.PI)}°` : "";
    return `${f.name}  revolve of ${profile}, angle ${f.angle}${value} about ${f.axis}, `
      + (f.twins.length === 0 ? "a full turn" : f.end === null ? "partial" : `end ${f.end}`)
      + (f.unbuilt === undefined ? "" : ` — unbuilt: ${f.unbuilt}`);
  }
  const r = model.relations.get(f.depth);
  const value = r && typeof r.args[1] === "number" ? ` = ${round(r.args[1])}` : "";
  // Why it makes no body, when it makes none (docs/plans/linked-profiles.md):
  // open — an edge of its profile gone — or unbuilt, its depth deleted.
  const state = f.unbuilt !== undefined ? ` — unbuilt: ${f.unbuilt}`
    : f.open ? " — open: its profile no longer closes; draw or extend the missing edge back, on either profile, and it is a solid again" : "";
  // How it ends, when not at its depth — and whether a relation holds that
  // end or it is only placed (docs/plans/through-all-relation.md).
  const ends = endLabel(model, f);
  const held = endRelation(model, f);
  const end = ends === null ? "" : `, ${ends}${held ? ` (${held.name})` : ""}`;
  // Only an old file's extrude has a lid frame to name (see `Expansion`).
  return `${f.name}  extrude of ${profile}, depth ${f.depth}${ends === null ? value : ""}${end} along ${f.frame}${f.top === undefined ? "" : `, lid ${f.top}`}${state}`;
}

/**
 * A profile member as `loops()` labels a portion: `l1[p1→p9]`, the part of
 * `l1` from `p1` to `p9` in its own direction — the same text, now that the
 * crossing is a real point, as `loops()` gives for the region it was.
 */
function profileText(m: ProfileMember): string {
  return typeof m === "string" ? m : `${m.name}[${m.from}→${m.to}]`;
}

/** The features a piece belongs to, for the end of the hover tag. */
function featureTag(model: Model, name: string): string {
  const fs = model.featuresNaming(name);
  return fs.length ? `  ·  ${fs.map((f) => f.name).join(" ")}` : "";
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
  onPlane: "onplane",
  // docs/plans/sketch-relations.md
  collinear: "col", equalSpacing: "spacing", diameter: "dia",
};

export function describeRelation(r: RelationEntry): string {
  const arg = (a: unknown) => (typeof a === "string" ? a : JSON.stringify(a));
  // An extrude's depth names every twin it holds — dozens of names, and none
  // of them typed. What a reader wants is the number and the direction.
  if (r.op === "extrusion") {
    return `${r.name}  extrusion ${arg(r.args[1])} along ${arg(r.args[0])}.z, ${(r.args.length - 2) / 2} pairs`;
  }
  // A revolve's angle likewise — in the radians `set` takes, with the degrees
  // its label shows beside them, so the line answers "what do I type".
  if (r.op === "revolution") {
    const a = r.args[1];
    const deg = typeof a === "number" ? ` (${Math.round((a * 180) / Math.PI * 1000) / 1000}°)` : "";
    // A whole turn names its profile paired with itself (profiles-held.md): those are no end face's pairs.
    let pairs = 0;
    for (let i = 2; i + 1 < r.args.length; i += 2) if (r.args[i] !== r.args[i + 1]) pairs++;
    return `${r.name}  revolution ${arg(a)}${deg} about ${arg(r.args[0])}, ${pairs ? `${pairs} pairs` : "a full turn"}`;
  }
  // A linked twin says which relation it is the other end of (docs/plans/
  // linked-profiles.md): set or delete either, and it is both.
  const pair = r.twin ? `  ⇄ ${r.twin.of}` : "";
  return `${r.name}  ${SHORT_OP[r.op] ?? r.op} ${r.args.map(arg).join(" ")}`.trimEnd() + pair;
}

function relationTag(model: Model, name: string): string {
  const rs = model.relationsNaming(name);
  return rs.length ? `  ·  ${rs.map((r) => r.name).join(" ")}` : "";
}

/** The hover tag's line for an entity of a kind a module declares (../modules.ts): its name first, then what it is. */
export type Describer = (model: Model, name: string, n: (v: number) => string) => string;

const describers = new Map<string, Describer>();

export function defineDescriber(kind: string, describe: Describer): void {
  describers.set(kind, describe);
}

export function undefineDescriber(kind: string): void {
  describers.delete(kind);
}

function describeGeometry(model: Model, name: string, kind: Entity["kind"], n: (v: number) => string): string {
  const declared = describers.get(kind);
  if (declared) return declared(model, name, n);
  switch (kind) {
    case "point":
      return `${name}  ${model.coords(name).map(n).join(", ")}`;
    case "circle":
    case "arc": {
      // The way it faces, where it has its own normal (3D): not visible in a
      // view square to it, and what decides whether `onCircle` and `tan` mean
      // the rim you think they do.
      const facing = model.circular(name).normal === undefined ? "" : `  facing ${model.normalOf(name).map(n).join(", ")}`;
      return `${name}  r ${n(model.radius(name))}${facing}`;
    }
    case "line": {
      const l = model.line(name);
      const [a, b] = [model.coords(l.refs[0]), model.coords(l.refs[1])];
      // Over every coordinate: a 3D edge's length is not its shadow on x–y.
      return `${name}  ${l.refs[0]}–${l.refs[1]}  len ${n(Math.hypot(...a.map((ai, i) => b[i] - ai)))}`;
    }
    // A frame picks by its axes marker (see framemarker.ts). The tag says
    // whether it is the default, because that is the whole difference between
    // a frame a bare `hor` means and one it does not.
    case "frame": {
      if (name === ORIGIN) return `${name}  the fixed origin${model.defaultFrame === null ? "  (default)" : ""}`;
      const f = model.frame(name);
      const dflt = model.defaultFrame === name ? "  (default)" : "";
      const plane = f.yref === undefined ? "" : `, +y toward ${f.yref}`;
      return `${name}  origin ${f.origin}, +x toward ${f.xref}${plane}${dflt}`;
    }
    // A kind a module declared, with no hover line of its own: its name and kind.
    default: return `${name}  ${kind}`;
  }
}
