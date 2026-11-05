// The one circle tool. The owner: *"why are there multiple circle tools and arc
// tools? they all achieve the same thing. surely just one tool, but different
// ways to set constraints."* (docs/plans/one-circle-one-arc.md). Every circle
// is the same entity; what differs is **which constraints the clicks make**, and
// the gesture says which:
//
// | the hand does | the circle is |
// |---|---|
// | presses and drags | centred on the press, its radius where it lets go |
// | clicks once, then presses and drags | centred on the click, radius where it lets go |
// | clicks three times | through the three clicks (three `onCircle`s) |
// | clicks *along* a line or a circle as a rim point | tangent to it (`tan`), instead of a rim point on it |
// | lets go of a drag along a line or circle | tangent to it — on a point, through it |
//
// So the first click is a provisional point — a centre if a drag follows, a rim
// point if a second click does. The panel names what was read (`centre ·
// radius`, `3 points`, `tangent`) and can lock it: `arm("circle", { method:
// "3pt" })`, which is what `circle3` now arms (tool.ts's `TOOL_ALIASES`). Each
// lock is exactly the tool it replaces — `centre` is the old drag-out circle
// (a click then a click as well, centre then rim), `3pt` the old circle3, a
// click along an edge a rim point on it — and `tangent` takes only clicks on
// lines and circles: the circle touching three things.
//
// **Clicks decide on the press**, as circle3's did, and a drag on its release,
// as circle's did: each press is held until it moves past DRAG_PX (a drag) or
// lifts in place (a click), and a press that gets another press before any
// release — a script driving the tool with presses alone — was a click.
// Nothing is created until the gesture completes, so the whole of it — circle,
// rim points and relations — is one undo step (the engine's bracket around the
// one event that commits).
//
// The radius is left *unconstrained* by a drag: the circle keeps the size it
// was drawn at but is free to be driven later by a `rad` or a tangency —
// tools do not dimension what they draw. Tangency is the exception the owner
// asked for: a click aimed at an edge is a constraint said by the hand.
//
// In 3D the circle lies where the first press is (`CurvePlane`, place.ts: the
// plane sketched on, else the solid face under it, else the origin's ground),
// carries its own normal facing it and is held there by `onplane` and `par`.
// Previews are drawn as the circle will be — sampled in its plane and
// projected — and a tangent preview is the fitted circle itself
// (`fitCircle`), so what is on the screen is what the click builds.

import { Tool, defineTool, press, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import { onCircle, tangent } from "../relations/geometry.ts";
import { CurvePlane, DRAWING_OPTIONS, asArmed, placePoint, requirePlanar } from "./place.ts";
import type { OptionSpecs } from "./options.ts";
import { circumcircle, PREVIEW_MAX_R } from "./circumcircle.ts";
import { AUTO, Sheet, fitCircle, guide, methodOf, methodOption, pressMoved, touchedCurve, touchingRadius, type Fit, type Touch } from "./curvemethod.ts";
import { arcSamples, arcSegments, circleFrame } from "../arcgeom.ts";
import { liesOn } from "../view.ts";
import { dot3 } from "../vec3.ts";

/** The locks, by the name `arm` takes, with the words the panel shows. */
export const CIRCLE_METHODS: Readonly<Record<string, string>> = {
  centre: "centre · radius",
  "3pt": "3 points",
  tangent: "tangent",
};
const LOCKS = Object.keys(CIRCLE_METHODS);

/** Two clicks closer than this, in world units, are one click — a double-click, swallowed. */
const SAME_POINT_EPS = 1e-6;

export class CircleTool extends Tool {
  static readonly options: OptionSpecs = { ...DRAWING_OPTIONS, method: methodOption(CIRCLE_METHODS) };
  static readonly summary = "Draws a circle: drag out from its centre, or click 3 points or edges";
  readonly name = "circle";
  /** The clicks so far, kept whole so each one's snap survives to commit. */
  private clicks: PointerInfo[] = [];
  /** The press in progress — down, not yet up — and whether it has moved past a click. */
  private press: PointerInfo | null = null;
  private dragged = false;
  /** Where the pointer is now, as the commit would read it, snap and all. */
  private hover: PointerInfo | null = null;
  private plane = new CurvePlane(this.ctx, this.name);

  private get method(): string {
    return methodOf(this.ctx, LOCKS);
  }

  /** What the gesture has been read as so far, for the options panel — nothing until it is known. */
  read(): Readonly<Record<string, string>> {
    const m = this.method === AUTO ? this.reading() : null;
    return m ? { method: m } : {};
  }

  /**
   * The stage, in the method's words: a centre lock presses at the centre and
   * drags (or clicks) the rim; a three-click way counts its points; `auto`
   * offers both until the gesture has said which — a drag is a radius, a third
   * click a circle through three.
   */
  next(hand: Hand): string {
    const tap = press(hand);
    const n = this.clicks.length;
    const ordinal = ["first", "second", "third"][Math.min(n, 2)];
    const method = this.method;
    if (method === "centre") {
      if (this.press) return n ? `let go at the rim` : "drag the radius";
      return n ? `${tap} the rim` : "press at the centre";
    }
    if (method === "3pt") return `${tap} the ${ordinal} point`;
    if (method === "tangent") return `${tap} the ${ordinal} edge or point`;
    if (this.press && this.dragged) return "drag the radius";
    if (n === 0) return `press at the centre, or ${tap} 3 points`;
    if (n === 1) return `drag the radius, or ${tap} the second point`;
    return `${tap} the third point`;
  }

  private reading(): string | null {
    const m = this.ctx.model;
    if (this.press && this.dragged && this.clicks.length < 2) {
      return this.hover && this.tangible(touchedCurve(m, this.hover.snap)) ? "tangent" : "centre";
    }
    if (this.clicks.length < 2) return null; // one click: a centre or a rim point, not yet said
    const all = this.hover ? [...this.clicks, this.hover] : this.clicks;
    return this.roles(all).some(Boolean) ? "tangent" : "3pt";
  }

  onDown(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.name);
    // A press with no release before it was a click (a script's presses alone).
    if (this.press) this.still(this.press);
    if (!this.clicks.length && !this.press && !this.plane.begin(p)) return;
    p = this.plane.settle(p);
    this.hover = p;
    const method = this.method;
    // The three-click ways, and auto's third click, decide on the press — as
    // the 3-point tool always did: nothing about a third press can make it a
    // centre, so there is no reason to wait for its release.
    if (method === "3pt" || method === "tangent" || (method === AUTO && this.clicks.length === 2)) {
      this.rimClick(p);
      return;
    }
    this.press = p;
    this.dragged = false;
    this.ctx.requestRender();
  }

  onMove(p: PointerInfo): void {
    if (!this.clicks.length && !this.press) return;
    // The rim's snap is kept — a drag let go along an edge is a tangency, and
    // the preview has to show it — except under the centre lock, which is the
    // old drag-out circle exactly: a radius, nothing inferred at the rim.
    this.hover = this.plane.settle(this.method === "centre" ? { ...p, snap: undefined } : p);
    if (this.press && !this.dragged && pressMoved(this.press, p)) this.dragged = true;
    this.ctx.requestRender();
  }

  onUp(p: PointerInfo): void {
    const pressed = this.press;
    if (!pressed) return;
    this.press = null;
    if (this.dragged || pressMoved(pressed, p)) {
      this.dragged = false;
      const rim = this.plane.settle(this.method === "centre" ? { ...p, snap: undefined } : p);
      // A drag after one click is that click's radius: the click was the centre.
      this.radiusFrom(this.clicks.length ? this.clicks[0] : pressed, rim);
      return;
    }
    this.still(pressed);
  }

  /** A press that lifted where it landed: a click, by the method's lights. */
  private still(pressed: PointerInfo): void {
    this.press = null;
    this.dragged = false;
    if (this.method === "centre") {
      // Centre, then rim: Onshape's centre-point circle, two clicks.
      if (!this.clicks.length) this.clicks = [pressed];
      else this.radiusFrom(this.clicks[0], { ...pressed, snap: undefined });
      this.ctx.requestRender();
      return;
    }
    this.rimClick(pressed);
  }

  /** One click of the three-point ways: kept, or — the third — the circle through them all. */
  private rimClick(p: PointerInfo): void {
    const m = this.ctx.model;
    const last = this.clicks.at(-1);
    if (last && Math.hypot(...p.world.map((v, i) => v - last.world[i])) < SAME_POINT_EPS) return;
    if (this.method === "tangent") {
      const curve = this.tangible(touchedCurve(m, p.snap));
      if (!curve) {
        guide(this.ctx, `${this.name}: click on a line, circle or arc for it to touch — it is locked to tangent`);
        return;
      }
      if (this.clicks.some((c) => touchedCurve(m, c.snap) === curve)) {
        guide(this.ctx, `${this.name}: it already touches ${curve} — click another line or circle`);
        return;
      }
    }
    if (this.clicks.length < 2) {
      this.clicks.push(p);
      this.ctx.requestRender();
      return;
    }
    this.through(this.clicks[0], this.clicks[1], p);
  }

  /**
   * What each of three clicks says of the circle: through it, or — where it was
   * aimed along a line or circle, in auto or under the tangent lock — touching
   * that curve. A curve already touched by an earlier click is a rim point on it
   * the second time: touching one line twice says nothing more.
   */
  private roles(clicks: PointerInfo[]): (string | null)[] {
    if (this.method === "3pt") return clicks.map(() => null);
    const m = this.ctx.model;
    const seen = new Set<string>();
    return clicks.map((c) => {
      const curve = this.tangible(touchedCurve(m, c.snap));
      if (!curve || seen.has(curve)) return null;
      seen.add(curve);
      return curve;
    });
  }

  /** The circle three clicks make — on the sheet, exactly — or null with nothing to build. */
  private fitThrough(clicks: PointerInfo[]): { fit: Fit; circum: { center: number[]; radius: number } } | null {
    const circum = circumcircle(clicks[0].world, clicks[1].world, clicks[2].world);
    if (!circum) return null;
    const roles = this.roles(clicks);
    const sheet = this.sheet();
    const seed: Fit = { center: sheet.to(circum.center), radius: circum.radius };
    if (roles.every((r) => r === null)) return { fit: seed, circum };
    const touches = clicks.map((c, i): Touch => this.touch(roles[i], c, sheet));
    const fit = fitCircle(touches, seed);
    return fit ? { fit, circum } : null;
  }

  private through(first: PointerInfo, second: PointerInfo, p: PointerInfo): void {
    const clicks = [first, second, p];
    const found = this.fitThrough(clicks);
    if (!found) {
      // Refuse rather than build: three `onCircle`s on three collinear points
      // (or tangencies no circle near the clicks can meet) are a system with no
      // solution, and committing would leave a CONFLICT over a drawing that
      // should never have been made. Staying armed on the first two clicks
      // means the obvious next move — aim the third somewhere else — just
      // works. Said as guidance: the click missed, nothing is wrong.
      const collinear = !circumcircle(first.world, second.world, p.world);
      guide(this.ctx, collinear
        ? `${this.name}: those three are on one line — click the third off it`
        : `${this.name}: no circle near those touches them all — click somewhere else`);
      this.ctx.requestRender();
      return;
    }
    this.clicks = [];
    this.hover = null;
    const m = this.ctx.model;
    const roles = this.roles(clicks);
    const sheet = this.sheet();
    // The rim points first, so their auto-names come before the circle's own
    // centre and a replay hands out the same ones — the journal the 3-point
    // tool always wrote.
    const rim = clicks.map((info, i) => (roles[i] ? null : placePoint(this.ctx, info, undefined, this.plane.plane)));
    // A *free* circle: its centre and radius are seeds, the relations below its
    // whole definition — seeded at the answer (the circumcircle, or the fit
    // that touches), so the solver starts where the drawing is.
    const circle = m.addCircle(null, found.fit.radius, this.plane.normal());
    m.setCoords(circle.center, roles.some(Boolean) ? sheet.from(found.fit.center) : found.circum.center);
    this.plane.hold(circle.name, circle.center);
    clicks.forEach((_, i) => {
      const touches = roles[i];
      if (touches) tangent(m, touches, circle.name);
      else onCircle(m, rim[i]!, circle.name);
    });
    asArmed(this.ctx, circle.name);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  /** A centre and where a drag let go: the circle, touching or through what the rim was let go on. */
  private radiusFrom(centre: PointerInfo, rim: PointerInfo): void {
    const m = this.ctx.model;
    const on = this.rimTarget(centre, rim);
    const r = on ? on.radius : this.dragRadius(centre, rim);
    if (!(r > 1e-6)) {
      // A zero-radius drag: a click with nowhere to go. Nothing is built, and
      // the gesture starts over — as the drag-out circle always did.
      this.clicks = [];
      this.hover = null;
      this.ctx.requestRender();
      return;
    }
    this.clicks = [];
    this.hover = null;
    // Only the centre is a point the user placed; the rim is a radius.
    const ctr = placePoint(this.ctx, centre, undefined, this.plane.plane);
    const circle = m.addCircle(ctr, r, this.plane.normal()).name;
    this.plane.hold(circle, ctr);
    if (on?.tangent) tangent(m, on.tangent, circle);
    else if (on?.through) onCircle(m, on.through, circle);
    asArmed(this.ctx, circle);
    this.ctx.requestSolve();
    this.ctx.finish();
  }

  /**
   * What a drag's rim was let go on, outside the centre lock: along a line or
   * circle, a tangency and the radius that makes it; on a point, through that
   * point. Null for empty space.
   */
  private rimTarget(centre: PointerInfo, rim: PointerInfo): { radius: number; tangent?: string; through?: string } | null {
    if (this.method === "centre" || !rim.snap) return null;
    const m = this.ctx.model;
    const sheet = this.sheet();
    const c = sheet.to(centre.world);
    const dragged = this.dragRadius(centre, rim);
    const curve = this.tangible(touchedCurve(m, rim.snap));
    if (curve) {
      const r = touchingRadius(c, this.touch(curve, rim, sheet), dragged);
      return r ? { radius: r, tangent: curve } : null;
    }
    const target = rim.snap.kind === "point" ? rim.snap.targets[0] : null;
    if (target && m.entities.get(target)?.kind === "point" && !(centre.snap?.kind === "point" && centre.snap.targets[0] === target)) {
      return { radius: Math.hypot(...m.coords(target).map((v, i) => v - centre.world[i])), through: target };
    }
    return null;
  }

  /**
   * The radius a drag let go at `rim` means with nothing to touch: to where the
   * pointer is, on the plane — not to a midpoint or a crossing it happened to
   * snap to, which is a place to put a point and no radius anyone aimed at. (The
   * drag-out circle never read its rim's snap at all.)
   */
  private dragRadius(centre: PointerInfo, rim: PointerInfo): number {
    const at = rim.snap ? this.plane.settle({ ...rim, snap: undefined }).world : rim.world;
    return Math.hypot(...at.map((v, i) => v - centre.world[i]));
  }

  /**
   * `curve`, if a circle on this gesture's plane can be tangent to it — a line
   * or a circle in the same plane — else null, and the click is the rim point
   * on it that inference makes. In 3D a tangent line lies in the circle's plane
   * (relations/geometry.ts's `tangent`), so tangency to an edge standing out of
   * the sketch would be a contradiction the click never meant.
   */
  private tangible(curve: string | null): string | null {
    const plane = this.plane.surface;
    if (!curve || !plane) return curve;
    const m = this.ctx.model;
    const e = m.entities.get(curve);
    if (e?.kind === "line") return e.refs.every((p) => liesOn(plane, m.coords(p))) ? curve : null;
    if (e?.kind === "circle" || e?.kind === "arc") {
      const n = this.plane.normal()!;
      return liesOn(plane, m.coords(e.center)) && Math.abs(Math.abs(dot3(n, m.normalOf(curve))) - 1) < 1e-6 ? curve : null;
    }
    return null;
  }

  /** What a click says, on the sheet: through where it landed, or touching the curve it was aimed along. */
  private touch(curve: string | null, at: PointerInfo, sheet: Sheet): Touch {
    const m = this.ctx.model;
    const e = curve ? m.entities.get(curve) : undefined;
    if (e?.kind === "line") return { kind: "line", a: sheet.to(m.coords(e.refs[0])), b: sheet.to(m.coords(e.refs[1])) };
    if (e && (e.kind === "circle" || e.kind === "arc")) return { kind: "circle", c: sheet.to(m.coords(e.center)), r: m.radius(e.name) };
    return { kind: "through", p: sheet.to(at.world) };
  }

  private sheet(): Sheet {
    return new Sheet(this.plane.surface, this.ctx.model.dim);
  }

  onCancel(): void {
    this.clicks = [];
    this.press = null;
    this.dragged = false;
    this.hover = null;
    this.plane.cancel();
    this.ctx.requestRender();
  }

  render(r: RenderContext): void {
    if (!this.clicks.length && !this.press) return;
    r.g.save();
    r.g.strokeStyle = "#e8a33d";
    r.g.lineWidth = 1.3;
    const sheet = this.sheet();
    const stroke = (pts: number[][]) => {
      const px = pts.map((w) => r.worldToScreen(w));
      r.g.beginPath();
      r.g.moveTo(...px[0]);
      for (const q of px.slice(1)) r.g.lineTo(...q);
      r.g.stroke();
    };
    /** A circle on the sheet, drawn as main.ts will draw the committed one. */
    const ring = (center: number[], radius: number) => {
      if (!(radius > 0) || radius * r.scale > PREVIEW_MAX_R) return;
      const plane = this.plane.surface;
      const f = circleFrame(sheet.from(center), radius, plane ? plane.u : [1, 0, 0], plane ? plane.v : [0, 1, 0]);
      stroke(arcSamples(f, arcSegments(f.sweep, radius * r.scale)));
    };

    // Where the clicks landed. A click that shows nothing looks like one the
    // tool ignored — fillet.ts marks its first edge for the same reason.
    for (const info of this.clicks) {
      const [x, y] = r.worldToScreen(info.world);
      r.g.beginPath();
      r.g.moveTo(x - 4, y);
      r.g.lineTo(x + 4, y);
      r.g.moveTo(x, y - 4);
      r.g.lineTo(x, y + 4);
      r.g.stroke();
    }

    const hover = this.hover;
    const centreDrag = this.press && this.dragged && this.clicks.length < 2;
    const centreClicked = this.method === "centre" && this.clicks.length === 1 && !this.press;
    if (hover && (centreDrag || centreClicked)) {
      // A radius being chosen: the circle about the centre through the cursor —
      // or, let go along an edge, the circle that touches it.
      const centre = this.clicks.length ? this.clicks[0] : this.press!;
      const c = sheet.to(centre.world);
      const on = this.rimTarget(centre, hover);
      ring(c, on ? on.radius : this.dragRadius(centre, hover));
      stroke([centre.world, hover.world]); // the radius being dragged, so the gesture reads
    } else if (hover && this.clicks.length === 2) {
      // Two clicks and a cursor already determine the circle, so the preview is
      // the answer itself — the fit, where a click touches a curve. Nothing at
      // all when there is none: a preview that lies is worse than none.
      const found = this.fitThrough([...this.clicks, hover]);
      if (found) ring(found.fit.center, found.fit.radius);
    }
    r.g.restore();
  }
}

defineTool("circle", CircleTool);
