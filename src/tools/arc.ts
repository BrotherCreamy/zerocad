// The one arc tool — the circle tool's sibling, for the owner's same question:
// *"why are there multiple circle tools and arc tools? … surely just one tool,
// but different ways to set constraints."* (docs/plans/one-circle-one-arc.md).
// The gesture says which:
//
// | the hand does | the arc is |
// |---|---|
// | drags from one end to the other, then clicks where it bulges to | through the three (Onshape's 3 point arc) |
// | clicks first — a press held still — then clicks start and end | about that centre (the centre-point arc) |
// | …and, from the centre, drags from start to end | the same, in one stroke |
// | drags from the end of a line or arc, and bulges past where it would leave smoothly | tangent to it (`tan`), snapped there |
//
// The panel names what was read (`3 points`, `centre · ends`, `tangent`) and can
// lock it: `arm("arc", { method: "3pt" })` is what `arc3` now arms (tool.ts's
// `TOOL_ALIASES`). Each lock is the tool it replaces: `centre` the old
// centre-point arc (click, click, click — and a drag from the centre out to the
// start, which is the same three numbers), `3pt` the old arc3 (end, end,
// waypoint; or the drag for the ends), and `tangent` Onshape's tangent arc: from
// the end of a line or arc, smoothly on, to wherever the end is clicked.
//
// **The sweep.** An arc is drawn counter-clockwise about its own normal from
// `start` to `end` (arcgeom.ts), so the two ends are stored in whichever order
// makes the arc drawn the arc meant — swapping them is free, both arcs between
// two points being drawable. **The waypoint of a 3-point arc is kept as nothing**
// (Onshape's behaviour, and the arc3 tool's register entry): it says which arc
// and where to start the solver, and a point the user never asked for would be
// one more thing to clean up. The bulge is free afterwards — tools do not
// dimension what they draw — and `arcEndpoints` is what holds the ends on it.
//
// Clicks decide on the press and a drag on its release, as in the circle tool;
// nothing is made until the gesture completes, so it is one undo step. In 3D
// the arc lies on the first press's plane (`CurvePlane`, place.ts) and is held
// there by `onplane` and `par`.

import { Tool, defineTool, press, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { arcEndpoints, tangent } from "../relations/geometry.ts";
import { CurvePlane, DRAWING_OPTIONS, asArmed, placePoint, requirePlanar } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { circumcircle, PREVIEW_MAX_R } from "./circumcircle.ts";
import { AUTO, Sheet, curveEnd, guide, methodOf, methodOption, pressMoved, tangentArc } from "./curvemethod.ts";
import { arcFrame, arcSamples, arcSegments, sweepsAs } from "../arcgeom.ts";
import { cross3, dot3, lift3, sub3 } from "../vec3.ts";
import { liesOn, type Plane } from "../view.ts";

/** The locks, by the name `arm` takes, with the words the panel shows. */
export const ARC_METHODS: Readonly<Record<string, string>> = {
  "3pt": "3 points",
  centre: "centre · ends",
  tangent: "tangent",
};
const LOCKS = Object.keys(ARC_METHODS);

/**
 * Two clicks closer together than this (in world units) are one click — a
 * double-click, not a gesture — and one click is not two endpoints, nor a
 * radius. Swallowed in silence: nothing went wrong.
 */
const SAME_POINT_EPS = 1e-6;

/**
 * How near, in screen pixels, the bulge has to come to the arc that would
 * leave a line's end smoothly before it is pulled onto it — the snap's own
 * curve tolerance, as a snap is what this is: an inference offered while the
 * hand is near it, and taken only if the click lands there.
 */
const TANGENT_SNAP_PX = 8;

/**
 * Pulls `p` out to distance `r` from `c`, keeping its direction — onto the rim,
 * since a click and the centre both lie in the working plane.
 */
function ontoRim(p: number[], c: number[], r: number): number[] {
  const d = p.map((v, i) => v - c[i]);
  const len = Math.hypot(...d);
  if (len < 1e-9) return c.map((v, i) => (i === 0 ? v + r : v));
  return c.map((v, i) => v + (d[i] / len) * r);
}

/** The side a sweep is counter-clockwise *from*: the working plane's front, or +z in 2D. */
function facing(plane?: Plane): number[] {
  return plane ? cross3(lift3(plane.u), lift3(plane.v)) : [0, 0, 1];
}

/**
 * The endpoints in stored order: `[s, e]` if the arc drawn counter-clockwise
 * from `s` to `e` about `front` is the arc drawn counter-clockwise about
 * `side` (the arc's own normal), else `[e, s]` — the same arc, read from its
 * other end.
 */
function stored<T>(c: number[], s: T, e: T, sw: number[], ew: number[], front: number[], side: number[]): [T, T] {
  return sweepsAs(c, sw, ew, front, side) ? [s, e] : [e, s];
}

export interface Arc3 {
  /** As many coordinates as the clicks had. */
  center: number[];
  radius: number;
  /** Which of the two endpoint clicks the CCW sweep starts at: 0 or 1. */
  startIndex: 0 | 1;
}

/**
 * The arc through `a` and `b` that passes through `w`: its circle, and which
 * of the two endpoints the sweep starts at. Null when the three are collinear.
 *
 * The sweep runs counter-clockwise about `side` — +z for a 2D arc, the arc's
 * own normal in 3D — from `start` to `end`, which is how `arcFrame` lays every
 * arc out and, via `withinSweep`, what intersect.ts and picking.ts count as on
 * it. Both arcs between `a` and `b` are drawable; only one contains `w`, and
 * this picks it by asking whether `w` is reached before `b` going round from
 * `a`. Swapping the two costs the gesture nothing — both clicks are endpoints
 * either way, and only the label moves.
 */
export function arcThrough(a: number[], b: number[], w: number[], side: number[] = [0, 0, 1]): Arc3 | null {
  const found = circumcircle(a, b, w);
  if (!found) return null;
  const f = arcFrame(found.center, a, b, found.radius, side);
  if (!f) return null;
  const d = sub3(lift3(w), f.center);
  let toW = Math.atan2(dot3(d, f.v), dot3(d, f.u));
  if (toW < 0) toW += Math.PI * 2;
  return { center: found.center, radius: found.radius, startIndex: toW < f.sweep ? 0 : 1 };
}

/** Where the gesture is: what has been clicked, and so what the next press means. */
type Stage =
  | { kind: "start" } // nothing yet
  | { kind: "ends"; ends: PointerInfo[] } // 3 points: one end or both
  | { kind: "centre"; centre: PointerInfo; start: PointerInfo | null } // about a centre
  | { kind: "from"; start: PointerInfo; end: { curve: string; heading: number[] } }; // tangent lock: from a curve's end

/** A tangent arc found for the gesture: which curve it leaves, and the arc. */
interface Leaving { curve: string; at: 0 | 1; arc: Arc3 }

export class ArcTool extends Tool {
  static readonly options: OptionSpecs = { ...DRAWING_OPTIONS, method: methodOption(ARC_METHODS) };
  static readonly summary = "Draws an arc: drag end to end and click its bulge, or click its centre";
  readonly name = "arc";
  private stage: Stage = { kind: "start" };
  /** The press in progress — down, not yet up — and whether it has moved past a click. */
  private press: PointerInfo | null = null;
  private dragged = false;
  private hover: PointerInfo | null = null;
  /** Screen pixels per world unit along the ends' chord, for the tangent snap's tolerance. */
  private pxPerUnit = 1;
  private plane = new CurvePlane(this.ctx, this.name);

  private get method(): string {
    return methodOf(this.ctx, LOCKS);
  }

  /** The stage, in a few words: which end, the bulge, the centre's start and end, or the end of a tangent arc. */
  next(hand: Hand): string {
    const tap = press(hand);
    const s = this.stage;
    if (s.kind === "ends") return s.ends.length === 1 ? `${tap} the other end` : `${tap} the bulge`;
    if (s.kind === "centre") return s.start ? `${tap} the end` : `${tap} the start`;
    if (s.kind === "from") return `${tap} the end`;
    const method = this.method;
    if (this.press && this.dragged) return method === "centre" ? "drag to the start" : "drag to the other end";
    if (method === "centre") return "press at the centre";
    if (method === "tangent") return "press on the end of a line or arc";
    // Auto: a drag is the two ends, a click the centre.
    return method === "3pt" ? `${tap} one end` : `drag end to end, or ${tap} the centre`;
  }

  /** What the gesture has been read as so far, for the options panel — nothing until it is known. */
  read(): Readonly<Record<string, string>> {
    if (this.method !== AUTO) return {};
    const s = this.stage;
    if (s.kind === "centre") return { method: "centre" };
    if (s.kind === "ends" && s.ends.length === 2) return { method: this.hover && this.leaving(s.ends, this.hover) ? "tangent" : "3pt" };
    if (s.kind === "start" && this.press && this.dragged) return { method: "3pt" };
    return {};
  }

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
    if (this.press) this.still(this.press); // a press with no release before it was a click
    if (this.stage.kind === "start" && !this.plane.begin(p)) return;
    p = this.plane.settle(p);
    this.hover = p;
    const s = this.stage;
    // The presses that can only be clicks decide at once, as the click tools
    // always did: a second end, a bulge, the end of a centre-point arc's sweep.
    if (s.kind === "ends") {
      if (s.ends.length === 1) this.secondEnd(s.ends, p);
      else this.bulge(s.ends, p);
      return;
    }
    if (s.kind === "centre" && s.start) {
      this.aroundCentre(s.centre, s.start, p);
      return;
    }
    if (s.kind === "from") {
      this.leave(s.start, s.end, p);
      return;
    }
    if (s.kind === "centre" && Math.hypot(...p.world.map((v, i) => v - s.centre.world[i])) < SAME_POINT_EPS) return; // no radius yet
    if (s.kind === "start" && this.method === "tangent" && !curveEnd(this.ctx.model, p.snap)) {
      guide(this.ctx, `${this.name}: start on the end of a line or arc — it is locked to tangent`);
      return;
    }
    this.press = p;
    this.dragged = false;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (this.stage.kind === "start" && !this.press) return;
    this.hover = this.plane.settle(p);
    if (this.press && !this.dragged && pressMoved(this.press, p)) this.dragged = true;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    const pressed = this.press;
    if (!pressed) return;
    this.press = null;
    if (!(this.dragged || pressMoved(pressed, p))) {
      this.still(pressed);
      return;
    }
    this.dragged = false;
    const end = this.plane.settle(p);
    const s = this.stage;
    if (s.kind === "centre") {
      // From the centre, a stroke from start to end: the whole sweep at once.
      this.aroundCentre(s.centre, pressed, end);
      return;
    }
    if (Math.hypot(...end.world.map((v, i) => v - pressed.world[i])) < SAME_POINT_EPS) return;
    const method = this.method;
    if (method === "centre") {
      // Under the centre lock a first drag is the radius: centre, out to the start.
      this.stage = { kind: "centre", centre: pressed, start: end };
    } else if (method === "tangent") {
      this.leave(pressed, curveEnd(this.ctx.model, pressed.snap)!, end);
    } else {
      this.endsDragged(pressed, end);
    }
    this.ctx.requestRender();
  }

  /** A press that lifted where it landed: a click, by the method's lights. */
  private still(pressed: PointerInfo): void {
    this.press = null;
    this.dragged = false;
    const s = this.stage;
    if (s.kind === "centre") this.stage = { ...s, start: pressed };
    else if (this.method === "3pt") this.stage = { kind: "ends", ends: [pressed] };
    else if (this.method === "tangent") this.stage = { kind: "from", start: pressed, end: curveEnd(this.ctx.model, pressed.snap)! };
    // Auto and the centre lock: a first press held still is the centre.
    else this.stage = { kind: "centre", centre: pressed, start: null };
    this.ctx.requestRender();
  }

  private endsDragged(a: PointerInfo, b: PointerInfo): void {
    const [sa, sb] = [a.screen, b.screen];
    const world = Math.hypot(...b.world.map((v, i) => v - a.world[i]));
    const px = Math.hypot(sb[0] - sa[0], sb[1] - sa[1]);
    this.pxPerUnit = world > 0 && px > 0 ? px / world : 1;
    this.stage = { kind: "ends", ends: [a, b] };
  }

  private secondEnd(ends: PointerInfo[], p: PointerInfo): void {
    // A second press on top of the first is a double-click, not a second end.
    if (Math.hypot(...p.world.map((v, i) => v - ends[0].world[i])) < SAME_POINT_EPS) return;
    this.endsDragged(ends[0], p);
    this.ctx.requestRender();
  }

  // ---- 3 points ----------------------------------------------------------------

  /**
   * Whether the bulge at `w` is near enough the arc that leaves one of the two
   * ends smoothly — the end of a line or arc there — to be that arc: the
   * tangent arc, its curve, and which end it leaves. Auto only: a lock to
   * 3 points is the old arc3, which offered nothing of the kind.
   */
  private leaving(ends: PointerInfo[], w: PointerInfo): Leaving | null {
    if (this.method !== AUTO || w.snap) return null;
    const m = this.ctx.model;
    const sheet = this.sheet();
    const side = this.plane.normal() ?? [0, 0, 1];
    let best: { d: number; leaving: Leaving } | null = null;
    for (const at of [0, 1] as const) {
      const from = curveEnd(m, ends[at].snap);
      if (!from || !this.coplanar(from.curve)) continue;
      const s = sheet.to(ends[at].world), e = sheet.to(ends[1 - at].world);
      const t = tangentArc(s, sheet.dir(from.heading), e);
      if (!t) continue;
      const q = sheet.to(w.world);
      const off = Math.abs(Math.hypot(q[0] - t.center[0], q[1] - t.center[1]) - t.radius) * this.pxPerUnit;
      if (off > TANGENT_SNAP_PX || (best && best.d <= off)) continue;
      // The bulge pulled onto that circle: the arc through it is the tangent one,
      // and which of its two halves is the side the hand is on.
      const len = Math.hypot(q[0] - t.center[0], q[1] - t.center[1]) || 1;
      const onto = sheet.from([t.center[0] + ((q[0] - t.center[0]) / len) * t.radius, t.center[1] + ((q[1] - t.center[1]) / len) * t.radius]);
      const arc = arcThrough(ends[0].world, ends[1].world, onto, side);
      if (!arc) continue;
      best = { d: off, leaving: { curve: from.curve, at, arc: { ...arc, center: sheet.from(t.center), radius: t.radius } } };
    }
    return best?.leaving ?? null;
  }

  private bulge(ends: PointerInfo[], p: PointerInfo): void {
    const leaving = this.leaving(ends, p);
    const found = leaving?.arc ?? arcThrough(ends[0].world, ends[1].world, p.world, this.plane.normal() ?? [0, 0, 1]);
    if (!found) {
      // Refuse rather than build: three points on one line have no arc between
      // them, and committing one would leave a CONFLICT over a drawing that
      // should never have been made. Staying armed on the two ends means the
      // obvious next move — aim the bulge off the line — just works.
      guide(this.ctx, `${this.name}: those three are on one line — click the third off it`);
      this.ctx.requestRender();
      return;
    }
    this.stage = { kind: "start" };
    this.hover = null;
    const m = this.ctx.model;
    // The ends first, so their auto-names come before the arc's own centre and
    // a replay hands out the same ones. Placed in click order, *then* assigned
    // to start and end by the sweep.
    const placed = ends.map((info) => placePoint(this.ctx, info, undefined, this.plane.plane));
    // A *free* arc: the centre argument is null, so the model makes a real
    // named point for it; centre and radius are seeds at the circle the three
    // make, so the arc on the screen is the arc that was previewed.
    const arc = m.addArc(null, placed[found.startIndex], placed[1 - found.startIndex], found.radius, this.plane.normal());
    m.setCoords(arc.center, found.center);
    this.plane.hold(arc.name, arc.center);
    arcEndpoints(m, arc.name);
    if (leaving) tangent(m, leaving.curve, arc.name);
    asArmed(this.ctx, arc.name);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  // ---- about a centre ----------------------------------------------------------

  private aroundCentre(centre: PointerInfo, first: PointerInfo, p: PointerInfo): void {
    const c = centre.world, s = first.world;
    const r = Math.hypot(...s.map((v, i) => v - c[i]));
    if (!(r > SAME_POINT_EPS)) return;
    // Normally the end is pulled onto the rim so nothing jumps on solve. But if
    // it snapped to something, that geometry is what was meant: keep the
    // snapped position and let `arcends` and the inferred constraint settle the
    // radius between them.
    const end: PointerInfo = p.snap ? p : { ...p, world: ontoRim(p.world, c, r) };
    this.stage = { kind: "start" };
    this.hover = null;
    const m = this.ctx.model;
    const on = this.plane.plane;
    const ctr = placePoint(this.ctx, centre, undefined, on);
    const sp = placePoint(this.ctx, first, undefined, on);
    const ep = placePoint(this.ctx, end, undefined, on);
    const normal = this.plane.normal();
    const [startName, endName] = stored(c, sp, ep, first.world, end.world, facing(first.plane), normal ?? [0, 0, 1]);
    const arc = m.addArc(ctr, startName, endName, r, normal);
    arcEndpoints(m, arc.name);
    this.plane.hold(arc.name, ctr);
    asArmed(this.ctx, arc.name);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  // ---- tangent: leaving a curve's end ------------------------------------------

  /** The arc that leaves `start` — the end of `from.curve` — smoothly, to `p`; null when `p` is straight on. */
  private leavingTo(start: PointerInfo, from: { curve: string; heading: number[] }, p: PointerInfo): Arc3 | null {
    const sheet = this.sheet();
    const t = tangentArc(sheet.to(start.world), sheet.dir(from.heading), sheet.to(p.world));
    if (!t) return null;
    return { center: sheet.from(t.center), radius: t.radius, startIndex: t.ccw ? 0 : 1 };
  }

  private leave(start: PointerInfo, from: { curve: string; heading: number[] }, p: PointerInfo): void {
    if (Math.hypot(...p.world.map((v, i) => v - start.world[i])) < SAME_POINT_EPS) return;
    const found = this.coplanar(from.curve) ? this.leavingTo(start, from, p) : null;
    if (!found) {
      guide(this.ctx, this.coplanar(from.curve)
        ? `${this.name}: that is straight on from ${from.curve} — put the end off its line`
        : `${this.name}: ${from.curve} is not in the plane being drawn on — start on a curve in it`);
      this.ctx.requestRender();
      return;
    }
    this.stage = { kind: "start" };
    this.hover = null;
    const m = this.ctx.model;
    const placed = [start, p].map((info) => placePoint(this.ctx, info, undefined, this.plane.plane));
    const arc = m.addArc(null, placed[found.startIndex], placed[1 - found.startIndex], found.radius, this.plane.normal());
    m.setCoords(arc.center, found.center);
    this.plane.hold(arc.name, arc.center);
    arcEndpoints(m, arc.name);
    tangent(m, from.curve, arc.name);
    asArmed(this.ctx, arc.name);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  /** Whether `curve` lies in the gesture's plane — always, in 2D: a tangent across planes is no tangent. */
  private coplanar(curve: string): boolean {
    const plane = this.plane.surface;
    if (!plane) return true;
    const m = this.ctx.model;
    const e = m.entities.get(curve);
    if (e?.kind === "line") return e.refs.every((q) => liesOn(plane, m.coords(q)));
    if (e?.kind === "arc" || e?.kind === "circle") {
      return liesOn(plane, m.coords(e.center)) && Math.abs(Math.abs(dot3(this.plane.normal()!, m.normalOf(curve))) - 1) < 1e-6;
    }
    return false;
  }

  private sheet(): Sheet {
    return new Sheet(this.plane.surface, this.ctx.model.dim);
  }

  onCancel(): void {
    this.stage = { kind: "start" };
    this.press = null;
    this.dragged = false;
    this.hover = null;
    this.plane.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    const s = this.stage;
    if (s.kind === "start" && !this.press) return;
    const hover = this.hover;
    const side = this.plane.normal() ?? [0, 0, 1];
    // Every preview curve is sampled in the world and projected, as main.ts
    // draws a committed arc — on a plane seen at an angle, an ellipse's worth.
    const stroke = (pts: number[][]) => {
      const px = pts.map((w) => r.worldToScreen(w));
      r.g.beginPath();
      r.g.moveTo(...px[0]);
      for (const q of px.slice(1)) r.g.lineTo(...q);
      r.g.stroke();
    };
    const cross = (w: number[]) => {
      const [x, y] = r.worldToScreen(w);
      r.g.beginPath();
      r.g.moveTo(x - 4, y);
      r.g.lineTo(x + 4, y);
      r.g.moveTo(x, y - 4);
      r.g.lineTo(x, y + 4);
      r.g.stroke();
    };
    const arcOf = (a: Arc3 | null, ends: number[][]) => {
      if (!a || a.radius * r.scale > PREVIEW_MAX_R) return;
      const f = arcFrame(a.center, ends[a.startIndex], ends[1 - a.startIndex], a.radius, side);
      if (f) stroke(arcSamples(f, arcSegments(f.sweep, a.radius * r.scale)));
    };
    /** The whole circle about `c` through `at`, in the gesture's plane. */
    const ring = (c: number[], at: number[]) => {
      const rad = Math.hypot(...at.map((v, i) => v - c[i]));
      const plane = this.plane.surface;
      const u = plane ? lift3(plane.u) : [1, 0, 0], v = plane ? lift3(plane.v) : [0, 1, 0];
      const C = lift3(c);
      const n = Math.max(16, Math.min(720, Math.ceil(rad * r.scale)));
      stroke(Array.from({ length: n + 1 }, (_, k) => {
        const t = (2 * Math.PI * k) / n;
        return [0, 1, 2].map((i) => C[i] + rad * (Math.cos(t) * u[i] + Math.sin(t) * v[i])).slice(0, Math.max(2, c.length));
      }));
    };
    /** The sweep about a centre from `start` to the cursor, the end pulled onto the rim as the commit pulls it. */
    const sweep = (centre: PointerInfo, start: PointerInfo, to: number[]) => {
      const c = centre.world, a = start.world;
      const rad = Math.hypot(...a.map((v, i) => v - c[i]));
      const e = ontoRim(to, c, rad);
      const [x, y] = stored(c, a, e, a, e, facing(centre.plane), side);
      const f = arcFrame(c, x, y, rad, side);
      if (f) stroke(arcSamples(f, arcSegments(f.sweep, rad * r.scale)));
      stroke([c, a]);
    };

    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    if (s.kind === "start" && this.press) {
      cross(this.press.world);
      if (this.dragged && hover) {
        const method = this.method;
        if (method === "centre") { ring(this.press.world, hover.world); stroke([this.press.world, hover.world]); }
        else if (method === "tangent") arcOf(this.leavingTo(this.press, curveEnd(this.ctx.model, this.press.snap)!, hover), [this.press.world, hover.world]);
        else stroke([this.press.world, hover.world]); // the chord, end to end
      }
    } else if (s.kind === "ends") {
      for (const e of s.ends) cross(e.world);
      if (s.ends.length === 2 && hover) {
        // Two ends and a cursor already determine the arc — including which side
        // it bulges to, and whether it has been pulled onto the smooth one.
        const leaving = this.leaving(s.ends, hover);
        arcOf(leaving?.arc ?? arcThrough(s.ends[0].world, s.ends[1].world, hover.world, side), [s.ends[0].world, s.ends[1].world]);
      }
    } else if (s.kind === "centre") {
      cross(s.centre.world);
      const start = s.start ?? (this.press && this.dragged ? this.press : null);
      if (start && hover) sweep(s.centre, start, hover.world);
      else if (hover) {
        // The radius is still being chosen: the whole circle through the cursor,
        // which is the circle the arc will be cut from.
        ring(s.centre.world, hover.world);
        stroke([s.centre.world, hover.world]);
      }
    } else if (s.kind === "from") {
      cross(s.start.world);
      if (hover) arcOf(this.leavingTo(s.start, s.end, hover), [s.start.world, hover.world]);
    }
    r.g.restore();
  }
}

defineTool("arc", ArcTool);
