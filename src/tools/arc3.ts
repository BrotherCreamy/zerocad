// Two endpoints, then a point the arc passes through — Onshape's *3 point
// arc*, and the sibling of circle3.ts in every respect but one.
//
// **The click order is end, end, waypoint**, which is Onshape's and is worth
// saying out loud twice: it is not (start, waypoint, end), and it is not the
// centre-point arc's (centre, start, end). The first two clicks are the two
// ends of the arc; the third only says *which* of the two arcs between them
// was meant, and how far it bulges to start with.
//
// The one place it parts company with circle3 is what happens to that third
// click: **nothing**. In Onshape the waypoint is not kept as geometry, and it
// is not kept here either. A 3-point circle's three clicks are all rim points
// and all three `onCircle`s are the circle's definition; an arc's waypoint is
// a *choice*, not a claim, and keeping it would leave a point in the drawing
// that the user never asked for and would have to clean up by hand — the same
// reason the fillet reuses its shared corner rather than stranding it.
// So the arc is under-constrained afterwards — its bulge is free — which is
// the register's standing rule that tools do not dimension what they draw,
// and exactly the bargain the centre-point arc tool already strikes. Someone
// who wants the bulge held says `rad(...)` or drops a point on the rim.
//
// What *is* asserted is `arcEndpoints`: an arc's endpoints lying on its own
// circle is a relation in this model rather than a constructor fact (see
// ArcEntity in model.ts), so a tool that builds an arc has to say it. Without
// it the seeded numbers would be the only thing holding the arc together and
// the first drag would pull it apart.
//
// Everything else is circle3's shape: each endpoint click goes through
// `placePoint` so snapping and inference apply to it, nothing at all is
// created before the third click so the whole gesture is one undo step, and a
// degenerate third click is refused through `ctx.log` with the gesture left
// live rather than committed into a conflict.

//
// In 3D the arc lies in the plane of its three clicks — the sketch's — and is
// given the default frame's plane (see `ArcEntity`), whose +z it turns about;
// with no default frame the first click makes one, the working plane it
// landed on, and the later clicks land on it (`CurvePlane`, in place.ts).
// The tool works out which of the two arcs between the endpoints holds the
// waypoint, and orders the endpoints so that is the arc drawn about that +z.
// Its centre is held on the sketch plane with its endpoints. The preview is
// the same arc, sampled in the world and projected — on a plane seen at an
// angle it is part of an ellipse.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { arcEndpoints } from "../relations/geometry.ts";
import { CurvePlane, holdOnSketchPlane, placePoint, requirePlanar } from "./place.ts";
import { circumcircle, PREVIEW_MAX_R } from "./circumcircle.ts";
import { arcFrame, arcSamples, arcSegments } from "../arcgeom.ts";
import { sketchSide } from "../curveplane.ts";
import { dot3, lift3, sub3 } from "../vec3.ts";

/**
 * Two clicks closer together than this (in world units) are one click, and one
 * click is not two endpoints.
 *
 * Same number and same reason as the centre-point arc tool's zero-radius
 * guard: a second press this close to the first is a double-click, not a
 * gesture. It is in world units rather than pixels, which means at a wild
 * enough zoom-out two genuinely distinct clicks could fall inside it — that
 * is the same trade arc.ts already makes, and the failure mode (the second
 * click does nothing, click again) is self-explanatory.
 */
const SAME_POINT_EPS = 1e-6;

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
 * The sweep runs counter-clockwise in world space from `start` to `end` —
 * main.ts's rendering convention and, via `withinSweep`, intersect.ts's and
 * picking.ts's definition of what is *on* the arc. Both of the two arcs
 * between `a` and `b` are drawable; only one of them contains `w`, and this
 * picks it by asking whether `w` is reached before `b` going counter-clockwise
 * from `a`. Swapping the two costs the gesture nothing — both clicks are
 * endpoints either way, and only the label moves.
 *
 * Plain numbers in and out, in world coordinates, two or three of them. The
 * counter-clockwise sense is about `side` — +z for a 2D arc, which is the
 * world's y-up sense; the +z of the plane the arc will be given in 3D — which
 * is how `arcFrame` lays every arc out, so the arc this picks is the arc that
 * will be drawn.
 */
export function arcThrough(a: number[], b: number[], w: number[], side: number[] = [0, 0, 1]): Arc3 | null {
  const found = circumcircle(a, b, w);
  if (!found) return null;
  const f = arcFrame(found.center, a, b, found.radius, side);
  if (!f) return null;
  // How far round from `a` the waypoint is, in the same sense the sweep from
  // `a` to `b` is measured in: inside that sweep, `a` starts it; outside, the
  // other arc is the one through `w`, and it starts at `b`.
  const d = sub3(lift3(w), f.center);
  let toW = Math.atan2(dot3(d, f.v), dot3(d, f.u));
  if (toW < 0) toW += Math.PI * 2;
  return { center: found.center, radius: found.radius, startIndex: toW < f.sweep ? 0 : 1 };
}

export class Arc3Tool extends Tool {
  readonly name = "arc3";
  /** The endpoint clicks so far, kept whole so each one's snap survives to commit. */
  private ends: PointerInfo[] = [];
  private hover: number[] | null = null;
  private plane = new CurvePlane(this.ctx, this.name);

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
    if (this.plane.typing) return; // the plane the first click typed is still going in
    if (!this.ends.length && !this.plane.begin(p)) return;
    this.hover = p.world;

    if (this.ends.length < 2) {
      // A second press on top of the first is a double-click, not a second
      // endpoint. Swallowed rather than logged: nothing went wrong, and the
      // centre-point arc tool already ignores its own degenerate click in
      // silence.
      const first = this.ends[0];
      if (first && Math.hypot(...p.world.map((v, i) => v - first.world[i])) < SAME_POINT_EPS) return;
      this.ends.push(p);
      this.ctx.requestRender();
      return; // nothing is committed until the third click — see the header
    }

    const [first, second] = this.ends.map((e) => this.plane.settle(e));
    const found = arcThrough(first.world, second.world, p.world, sketchSide(this.ctx.model));
    if (!found) {
      // Refuse rather than build, circle3's shape exactly: three points on one
      // line have no arc between them either, and committing one would leave a
      // CONFLICT header over a drawing that should never have been made.
      // Staying armed on the two endpoint clicks means the obvious next move —
      // aim the waypoint off the line — just works.
      const why = `${this.name}: those three points lie on one line — no arc passes through them`;
      // The log pane where there is one; the console's ear headless, where an
      // advisory (the gesture stays live) does not deserve a throw.
      if (this.ctx.log) this.ctx.log(why);
      else console.warn(why);
      this.ctx.requestRender();
      return;
    }

    this.ends = [];
    this.hover = null;

    const m = this.ctx.model;
    // The endpoints first, so their auto-names come before the arc's own
    // centre and a replay hands out the same ones. Placed in click order,
    // *then* assigned to start/end by the sweep — so which end is "start"
    // never changes which point is which, only which way round the arc goes.
    const placed = [first, second].map((info) => placePoint(this.ctx, info));
    const start = placed[found.startIndex];
    const end = placed[1 - found.startIndex];
    // A *free* arc, free-entities style: the centre argument is null, so the
    // model makes a real named point for it. The radius and the centre
    // coordinates are seeds and nothing more (a constructor argument in this
    // model never was a constraint) — but seeding them at the circumcircle
    // rather than at the library defaults means the solver's first step is
    // chosen by where the drawing is rather than by where the world starts,
    // and it means the arc drawn on screen is the arc that was previewed.
    const arc = m.addArc(null, start, end, found.radius);
    m.setCoords(arc.center, found.center);
    holdOnSketchPlane(m, arc.center);
    arcEndpoints(m, arc.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onMove(p: PointerInfo): void {
    if (!this.ends.length) return;
    this.hover = p.world;
    this.ctx.requestRender();
  }

  onCancel(): void {
    this.ends = [];
    this.hover = null;
    this.plane.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.ends.length) return;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;

    // Where the endpoint clicks landed. A three-click tool that shows nothing
    // after the first click looks like a tool that ignored it.
    for (const info of this.ends) {
      const [x, y] = r.worldToScreen(info.world);
      r.g.beginPath();
      r.g.moveTo(x - 4, y);
      r.g.lineTo(x + 4, y);
      r.g.moveTo(x, y - 4);
      r.g.lineTo(x, y + 4);
      r.g.stroke();
    }

    // Two endpoints and a cursor already determine the arc — including which
    // side it bulges to — so from here the preview is the answer itself.
    if (this.ends.length === 2 && this.hover) {
      const worlds = [this.ends[0].world, this.ends[1].world];
      const side = sketchSide(this.ctx.model);
      const found = arcThrough(worlds[0], worlds[1], this.hover, side);
      const rad = found ? found.radius * r.scale : 0;
      // Nothing at all when the three are collinear, or when the rim is so far
      // away that what would be drawn is a straight line: a preview that lies
      // about what the next click will build is worse than no preview.
      const f = found && rad < PREVIEW_MAX_R
        ? arcFrame(found.center, worlds[found.startIndex], worlds[1 - found.startIndex], found.radius, side)
        : null;
      if (f) {
        // Sampled in the world and projected, exactly as main.ts draws the
        // committed arc — so the preview is that arc, at any angle of view.
        const pts = arcSamples(f, arcSegments(f.sweep, rad)).map((w) => r.worldToScreen(w));
        r.g.setLineDash([4, 3]);
        r.g.beginPath();
        r.g.moveTo(...pts[0]);
        for (const pt of pts.slice(1)) r.g.lineTo(...pt);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

defineTool("arc3", Arc3Tool);
