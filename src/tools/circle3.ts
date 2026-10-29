// Three clicks, and a circle through all three — Onshape's *3 point circle*.
//
// This file adds nothing to the model and nothing to the solver, and that is
// the whole point of it: the tool is one free `circle()` plus three
// `onCircle`s, which is exactly what the free-entities package existed to
// make sayable. Before it, a circle had to be born holding a centre and a
// radius, so "the circle through these three points" could not be *stated* —
// only computed in a tool and then asserted, with the constraints thrown
// away. Now it is stated, the three relations survive as first-class
// constraints, and dragging any of the three rim points takes the circle with
// it. That last part is the difference a user can feel.
//
// Two house patterns it follows exactly. Like arc.ts it spans three clicks and
// keeps each one *whole* — a PointerInfo, not a coordinate — so the snap that
// click landed on survives to commit: click an existing corner and the rim
// point is coincident with it, click an edge and it stays on that edge (see
// place.ts). And like rectangle.ts every last thing is created inside the
// final click, so the engine's user-action bracket around that one event makes
// the entire gesture a single undo step — circle, rim points and relations go
// back together or not at all.
//
// In 3D the circle through three clicks lies in their plane — the sketch's —
// and is given the default frame's plane (see `CircleEntity`); with no default
// frame the first click makes one, the working plane it landed on, and the
// later clicks land on it (`CurvePlane`, in place.ts). Its centre is
// held on the sketch plane with the rim points (see place.ts). The preview is
// computed in the world, as the commit is, and drawn as the renderer will draw
// the result — sampled in its plane and projected, an ellipse seen at an angle
// — because the circle through three *projected* points is not the projection
// of anything the model will hold once the plane is seen at an angle.

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { onCircle } from "../relations/geometry.ts";
import { CurvePlane, holdOnSketchPlane, placePoint, requirePlanar } from "./place.ts";
// The closed form and its collinearity threshold left this file when the
// 3-point *arc* tool needed the same two, and needed them to agree — see the
// header of circumcircle.ts.
import { circumcircle, circumFrame, PREVIEW_MAX_R } from "./circumcircle.ts";
import { arcSamples, arcSegments } from "../arcgeom.ts";

export class Circle3Tool extends Tool {
  readonly name = "circle3";
  /** The clicks so far, kept whole so each one's snap survives to commit. */
  private clicks: PointerInfo[] = [];
  private hover: number[] | null = null;
  private plane = new CurvePlane(this.ctx, this.name);

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
    if (this.plane.typing) return; // the plane the first click typed is still going in
    if (!this.clicks.length && !this.plane.begin(p)) return;
    this.hover = p.world;

    if (this.clicks.length < 2) {
      this.clicks.push(p);
      this.ctx.requestRender();
      return; // nothing is committed until the third click — see the header
    }

    const [first, second] = this.clicks.map((c) => this.plane.settle(c));
    const found = circumcircle(first.world, second.world, p.world);
    if (!found) {
      // Refuse rather than build. Three `onCircle`s on three collinear points
      // are a system with no solution, so committing would leave a CONFLICT
      // header over a drawing that should never have been made — and the user
      // would have to undo it to find out why. Staying armed on the first two
      // clicks means the obvious next move (aim the third somewhere else) just
      // works, which is the choice fillet.ts already made for a corner it
      // cannot round.
      // Said as what would work, as guidance: the click missed, nothing is wrong.
      const why = `${this.name}: those three are on one line — click the third off it`;
      // The log pane where there is one; the console's ear headless, where an
      // advisory (the gesture stays live) does not deserve a throw.
      if (this.ctx.log) this.ctx.log(why, "guide");
      else console.warn(why);
      this.ctx.requestRender();
      return;
    }

    this.clicks = [];
    this.hover = null;

    const m = this.ctx.model;
    // The three rim points first, so their auto-names come before the circle's
    // own centre and a replay hands out the same ones.
    const rim = [first, second, p].map((info) => placePoint(this.ctx, info));
    // A *free* circle: nothing about its centre or radius is asserted here.
    // The three relations below are its entire definition, which is what lets
    // it follow the rim points afterwards instead of merely having matched
    // them once. The arguments are only seeds (a constructor argument in this
    // model never was a constraint) — but seeding them at the answer rather
    // than at the library defaults matters, because a circle seeded at radius
    // 10 with its centre at the origin gives the solver a first step chosen by
    // where the world happens to start rather than by where the drawing is.
    const circle = m.addCircle(null, found.radius);
    m.setCoords(circle.center, found.center);
    holdOnSketchPlane(m, circle.center);
    for (const name of rim) onCircle(m, name, circle.name);

    this.ctx.requestSolve();
    this.ctx.finish();
  }

  onMove(p: PointerInfo): void {
    if (!this.clicks.length) return;
    this.hover = p.world;
    this.ctx.requestRender();
  }

  onCancel(): void {
    this.clicks = [];
    this.hover = null;
    this.plane.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.clicks.length) return;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;

    // Where the clicks landed. A three-click tool that shows nothing after the
    // first click looks like a tool that ignored it — fillet.ts marks its first
    // edge for the same reason.
    for (const info of this.clicks) {
      const [x, y] = r.worldToScreen(info.world);
      r.g.beginPath();
      r.g.moveTo(x - 4, y);
      r.g.lineTo(x + 4, y);
      r.g.moveTo(x, y - 4);
      r.g.lineTo(x, y + 4);
      r.g.stroke();
    }

    // Two clicks and a cursor already determine the circle, so from here the
    // preview is the answer itself rather than a suggestion of it.
    if (this.clicks.length === 2 && this.hover) {
      const f = circumFrame(this.clicks[0].world, this.clicks[1].world, this.hover);
      const radius = f ? f.r * r.scale : Infinity;
      // Nothing at all when they are collinear, or when the rim is so far away
      // that what would be drawn is a straight line: a preview that lies about
      // what the next click will build is worse than no preview.
      if (f && radius < PREVIEW_MAX_R) {
        const pts = arcSamples(f, arcSegments(f.sweep, radius)).map((w) => r.worldToScreen(w));
        r.g.setLineDash([4, 3]);
        r.g.beginPath();
        r.g.moveTo(...pts[0]);
        for (const q of pts.slice(1)) r.g.lineTo(...q);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

defineTool("circle3", Circle3Tool);
