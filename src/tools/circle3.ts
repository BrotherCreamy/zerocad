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

import { Tool, defineTool, type PointerInfo, type RenderContext } from "./tool.ts";
import { onCircle } from "../relations/geometry.ts";
import { placePoint } from "./place.ts";

/**
 * Relative sine below which three points are one straight line.
 *
 * Scale-free, and deliberately the same form and the same number as
 * intersect.ts's parallel test: it is compared against the product of the two
 * side lengths, so it means "the angle subtended at the first point is under
 * ~1e-9 radians" at any zoom, in any unit. A *near*-collinear circle is a
 * legitimate thing to draw and the user's call to make; only the exactly
 * degenerate case is refused.
 */
export const COLLINEAR_EPS = 1e-9;

/**
 * Screen radius past which the preview is not drawn. A rim this far away sags
 * by well under a pixel across the whole window, so what would be drawn is a
 * straight line — and asking a canvas for an arc of radius 10^8 is a good way
 * to find out how slowly it can do that.
 */
const PREVIEW_MAX_R = 1e6;

export interface Circumcircle {
  center: [number, number];
  radius: number;
}

/**
 * The circle through three points, in closed form — or null when they are
 * collinear, because the "circle" through three points on a line is that
 * line, and a line is not a circle.
 *
 * Plain numbers in and out, with no idea which space it is being asked about,
 * exactly as intersect.ts is: the commit asks it in world coordinates because
 * that is where the model lives, and the preview asks it in screen pixels
 * because that is where it draws and a pixel radius needs no scale factor.
 * The view transform is affine with a uniform scale, so the two agree.
 *
 * Written about `a` as the origin rather than from the raw determinant: the
 * coordinates that go into it are then differences rather than absolute
 * positions, which is what stops a drawing far from the origin losing its
 * significant digits to cancellation.
 */
export function circumcircle(a: number[], b: number[], c: number[]): Circumcircle | null {
  const bx = b[0] - a[0], by = b[1] - a[1];
  const cx = c[0] - a[0], cy = c[1] - a[1];
  // |d| = 2 |b-a| |c-a| sin(theta), so dividing through by the two lengths is
  // what makes the test below an angle rather than an area — an area threshold
  // would call a large drawing collinear and a small one not.
  const d = 2 * (bx * cy - by * cx);
  if (Math.abs(d) <= 2 * COLLINEAR_EPS * Math.hypot(bx, by) * Math.hypot(cx, cy)) return null;

  const bb = bx * bx + by * by;
  const cc = cx * cx + cy * cy;
  const ux = (cy * bb - by * cc) / d;
  const uy = (bx * cc - cx * bb) / d;
  return { center: [a[0] + ux, a[1] + uy], radius: Math.hypot(ux, uy) };
}

export class Circle3Tool extends Tool {
  readonly name = "circle3";
  /** The clicks so far, kept whole so each one's snap survives to commit. */
  private clicks: PointerInfo[] = [];
  private hover: number[] | null = null;

  onDown(p: PointerInfo): void {
    if (this.ctx.model.dim !== 2) throw new Error("circle3 is a 2D tool");
    this.hover = p.world;

    if (this.clicks.length < 2) {
      this.clicks.push(p);
      this.ctx.requestRender();
      return; // nothing is committed until the third click — see the header
    }

    const [first, second] = this.clicks;
    const found = circumcircle(first.world, second.world, p.world);
    if (!found) {
      // Refuse rather than build. Three `onCircle`s on three collinear points
      // are a system with no solution, so committing would leave a CONFLICT
      // header over a drawing that should never have been made — and the user
      // would have to undo it to find out why. Staying armed on the first two
      // clicks means the obvious next move (aim the third somewhere else) just
      // works, which is the choice fillet.ts already made for a corner it
      // cannot round.
      const why = `${this.name}: those three points lie on one line — no circle passes through them`;
      // The log pane where there is one; the console's ear headless, where an
      // advisory (the gesture stays live) does not deserve a throw.
      if (this.ctx.log) this.ctx.log(why);
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
      const [a, b, c] = [this.clicks[0].world, this.clicks[1].world, this.hover]
        .map((w) => r.worldToScreen(w));
      const found = circumcircle(a, b, c);
      // Nothing at all when they are collinear, or when the rim is so far away
      // that what would be drawn is a straight line: a preview that lies about
      // what the next click will build is worse than no preview.
      if (found && found.radius < PREVIEW_MAX_R) {
        r.g.setLineDash([4, 3]);
        r.g.beginPath();
        r.g.arc(found.center[0], found.center[1], found.radius, 0, Math.PI * 2);
        r.g.stroke();
      }
    }
    r.g.restore();
  }
}

defineTool("circle3", Circle3Tool);
