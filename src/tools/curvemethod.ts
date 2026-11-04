// What the one circle tool and the one arc tool share: the `method` option, how
// a press is told from a drag, what a click touched, and the closed forms (and
// one small numeric fit) their previews and seeds are made of. The owner:
// *"why are there multiple circle tools and arc tools? they all achieve the same
// thing. surely just one tool, but different ways to set constraints."*
// (docs/plans/one-circle-one-arc.md).
//
// So each curve is one tool, and **the gesture says which constraints the clicks
// make**: a press that drags is a centre and a radius, separate clicks are
// points on the rim, a click on a line or a circle is a tangency. The method the
// gesture was read as is shown in the options panel, and can be locked there —
// `arm("circle", { method: "3pt" })` — which is all `circle3` and `arc3` are now
// (`TOOL_ALIASES`, tool.ts).
//
// Like circumcircle.ts and place.ts, this registers no tool: importing it has no
// side effect. Plain numbers, a model to look things up in, and the snap a click
// carried; no camera.

import type { Model } from "../model.ts";
import type { Snap } from "../snapping.ts";
import type { Plane } from "../view.ts";
import type { OptionSpec } from "./options.ts";
import type { PointerInfo, ToolContext } from "./tool.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "../vec3.ts";

/** The method every curve tool starts in: read from the gesture. */
export const AUTO = "auto";

/**
 * The `method` option: `auto`, and the ways the tool can be locked to. A choice,
 * so the options panel shows it as one, and `arm` refuses anything else by name.
 */
export function methodOption(locks: Readonly<Record<string, string>>): OptionSpec {
  return { default: AUTO, label: "method", choices: { [AUTO]: "auto", ...locks } };
}

/** The method `ctx` was armed with — `auto` for anything else, as a tool driven by hand with `options: {}` is. */
export function methodOf(ctx: ToolContext, locks: readonly string[]): string {
  const m = ctx.options.method;
  return typeof m === "string" && locks.includes(m) ? m : AUTO;
}

/**
 * Past this many pixels a press is a drag. The engine's own DRAG_THRESHOLD, for
 * the engine's reason: a hand that clicks rolls a pixel or two, and a drag that
 * short means nothing. A finger's press reaches a tool only once the recogniser
 * has decided it (gestures.ts) — a tap as a down and an up in one place, a drag
 * as a down where it landed and moves already past its 8 px slop — so the same
 * number serves both hands.
 */
export const DRAG_PX = 3;

/**
 * Whether the pointer moved from `a` to `b` enough to be a drag. By the screen,
 * as the engine decides; where the screen did not change **at all** and the
 * world did, by the world — a host with no screen to report (a script, a test
 * driving the tool headless) still means what its coordinates say. In an app
 * the same pixel is the same place, so that branch never fires there.
 */
export function pressMoved(a: PointerInfo, b: PointerInfo): boolean {
  const px = Math.hypot(b.screen[0] - a.screen[0], b.screen[1] - a.screen[1]);
  if (px > DRAG_PX) return true;
  if (px > 0) return false;
  return Math.hypot(...b.world.map((v, i) => v - a.world[i])) > 1e-6;
}

/** Says `line` to the user as guidance (the click missed; nothing is wrong), or to the console headless. */
export function guide(ctx: ToolContext, line: string): void {
  if (ctx.log) ctx.log(line, "guide");
  else console.warn(line);
}

/**
 * The line, circle or arc a click landed somewhere along — a `curve` snap — or
 * null. Only that snap: a vertex, a midpoint or a crossing is a *place* the
 * click was aimed at, and a rim point there is the inference it always was.
 */
export function touchedCurve(model: Model, snap: Snap | undefined): string | null {
  if (!snap || snap.kind !== "curve") return null;
  const e = model.entities.get(snap.targets[0]);
  return e && (e.kind === "line" || e.kind === "circle" || e.kind === "arc") ? e.name : null;
}

/**
 * The line or arc whose end a click snapped to, and the way it was heading as
 * it got there — so an arc begun there can leave it smoothly. Null unless the
 * snap is a point that ends a line or an arc. A line first (the common case,
 * and the one with no ambiguity about its heading), then an arc.
 *
 * The heading is in the world: a line's from its other end; an arc's along its
 * own sweep (counter-clockwise about its normal, start to end), reversed at its
 * start, where leaving it means going back the way it came.
 */
export function curveEnd(model: Model, snap: Snap | undefined): { curve: string; heading: number[] } | null {
  if (!snap || snap.kind !== "point") return null;
  const p = snap.targets[0];
  if (model.entities.get(p)?.kind !== "point") return null;
  const at = model.coords(p);
  for (const e of model.entities.values()) {
    if (e.kind !== "line" || !e.refs.includes(p) || e.refs[0] === e.refs[1]) continue;
    const other = model.coords(e.refs[0] === p ? e.refs[1] : e.refs[0]);
    const heading = at.map((v, i) => v - other[i]);
    if (Math.hypot(...heading) > 1e-12) return { curve: e.name, heading };
  }
  for (const e of model.entities.values()) {
    if (e.kind !== "arc" || (e.start !== p && e.end !== p)) continue;
    const n = model.dim === 3 ? model.normalOf(e.name) : [0, 0, 1];
    const along = cross3(n, sub3(lift3(at), lift3(model.coords(e.center))));
    const heading = (e.end === p ? along : along.map((v) => -v)).slice(0, model.dim);
    if (Math.hypot(...heading) > 1e-12) return { curve: e.name, heading };
  }
  return null;
}

// ---- the gesture's plane, as two coordinates --------------------------------

/**
 * The gesture's plane as a flat sheet: world points to (x, y) on it and back,
 * so the closed forms below can be written once, in two coordinates. Its +z
 * (u × v) is the plane's own normal, the one the curve is seeded facing — so
 * counter-clockwise here is counter-clockwise about the curve's normal, which
 * is how arcgeom.ts lays every arc out. In 2D (no plane) it is the identity.
 */
export class Sheet {
  private o: number[] | null;
  private u: number[] = [1, 0, 0];
  private v: number[] = [0, 1, 0];
  private dim: number;

  constructor(plane: Plane | null, dim: number) {
    this.dim = dim;
    this.o = plane ? lift3(plane.origin) : null;
    if (plane) {
      // Made orthonormal, keeping u and the side v is on: a plane's axes are
      // meant to be, and a closed form that assumed it of one that was not
      // would be wrong by its skew.
      const u = unit3(lift3(plane.u)) ?? [1, 0, 0];
      const vRaw = lift3(plane.v);
      const v = unit3(sub3(vRaw, u.map((c) => c * dot3(vRaw, u)))) ?? unit3(cross3([0, 0, 1], u)) ?? [0, 1, 0];
      this.u = u;
      this.v = v;
    }
  }

  to(w: number[]): [number, number] {
    if (!this.o) return [w[0], w[1]];
    const d = sub3(lift3(w), this.o);
    return [dot3(d, this.u), dot3(d, this.v)];
  }

  /** A direction (not a place) on the sheet: no origin taken off. */
  dir(w: number[]): [number, number] {
    if (!this.o) return [w[0], w[1]];
    const d = lift3(w);
    return [dot3(d, this.u), dot3(d, this.v)];
  }

  from([x, y]: readonly number[]): number[] {
    if (!this.o) return this.dim === 2 ? [x, y] : [x, y, 0];
    return [0, 1, 2].map((i) => this.o![i] + x * this.u[i] + y * this.v[i]);
  }
}

// ---- tangency, in closed form and by a small fit ----------------------------

/** One thing a circle is asked to touch, on the sheet: pass through a point, or touch a line or a circle. */
export type Touch =
  | { kind: "through"; p: readonly number[] }
  | { kind: "line"; a: readonly number[]; b: readonly number[] }
  | { kind: "circle"; c: readonly number[]; r: number };

export interface Fit { center: [number, number]; radius: number }

/** The unit normal of a line on the sheet, and its signed distance to `p`. */
function lineSide(t: { a: readonly number[]; b: readonly number[] }, p: readonly number[]): number {
  const dx = t.b[0] - t.a[0], dy = t.b[1] - t.a[1];
  const len = Math.hypot(dx, dy) || 1;
  return ((p[0] - t.a[0]) * -dy + (p[1] - t.a[1]) * dx) / len;
}

/**
 * The circle that touches each of `touches`, found from `seed` — the circle
 * the clicks themselves make — or null where none is near it. **Preview and
 * seed only**: what holds the circle afterwards is the relations (`onCircle`,
 * `tan`), and the solver. This exists so the dashed circle on the screen is the
 * circle the click will build, and so the solver starts at the answer: the
 * circle through two points tangent to a line has two answers, and the one
 * nearer the clicks is the one meant.
 *
 * Each condition keeps the side the seed is on — of a line, the side its centre
 * is; of a circle, touching from outside or inside, whichever the seed is
 * nearer — so the fit never jumps to the answer across the line. Three
 * conditions and three unknowns (centre and radius), solved by damped Newton
 * with a numerical Jacobian: small enough to read, and it either lands within
 * a millionth of the drawing's own size or says it did not.
 */
export function fitCircle(touches: readonly Touch[], seed: Fit): Fit | null {
  const scale = Math.max(seed.radius, 1e-9);
  const sides = touches.map((t) => {
    if (t.kind === "line") return Math.sign(lineSide(t, seed.center)) || 1;
    if (t.kind === "circle") {
      const d = Math.hypot(seed.center[0] - t.c[0], seed.center[1] - t.c[1]);
      return Math.abs(d - (seed.radius + t.r)) <= Math.abs(d - Math.abs(seed.radius - t.r)) ? 1 : -1;
    }
    return 0;
  });
  const f = (x: number[]): number[] => touches.map((t, i) => {
    const [cx, cy, r] = x;
    if (t.kind === "through") return Math.hypot(cx - t.p[0], cy - t.p[1]) - r;
    if (t.kind === "line") return sides[i] * lineSide(t, [cx, cy]) - r;
    const d = Math.hypot(cx - t.c[0], cy - t.c[1]);
    return sides[i] > 0 ? d - (r + t.r) : d - Math.abs(r - t.r);
  });
  const size = (v: number[]) => Math.hypot(...v);
  let x = [seed.center[0], seed.center[1], seed.radius];
  let fx = f(x);
  for (let iter = 0; iter < 60 && size(fx) > 1e-10 * scale; iter++) {
    const h = 1e-7 * scale;
    const J = [0, 1, 2].map((k) => {
      const xp = x.slice(), xm = x.slice();
      xp[k] += h; xm[k] -= h;
      const a = f(xp), b = f(xm);
      return a.map((v, i) => (v - b[i]) / (2 * h));
    }); // J[k][i] = ∂f_i/∂x_k
    const step = solve3(J, fx);
    if (!step) return null;
    let t = 1;
    let next = x, fn = fx;
    for (; t > 1e-4; t /= 2) {
      next = x.map((v, k) => v - t * step[k]);
      fn = f(next);
      if (size(fn) < size(fx)) break;
    }
    if (t <= 1e-4) return null;
    x = next;
    fx = fn;
  }
  if (!(size(fx) <= 1e-6 * scale) || !(x[2] > 0) || !x.every(Number.isFinite)) return null;
  return { center: [x[0], x[1]], radius: x[2] };
}

/** Solves Σ_k J[k][i] s_k = r_i for s (J given column by column), or null when it is singular. */
function solve3(J: number[][], r: number[]): number[] | null {
  const A = [0, 1, 2].map((i) => [J[0][i], J[1][i], J[2][i], r[i]]);
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(A[i][c]) > Math.abs(A[p][c])) p = i;
    if (Math.abs(A[p][c]) < 1e-14) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let i = 0; i < 3; i++) {
      if (i === c) continue;
      const k = A[i][c] / A[c][c];
      for (let j = c; j < 4; j++) A[i][j] -= k * A[c][j];
    }
  }
  return [0, 1, 2].map((i) => A[i][3] / A[i][i]);
}

/**
 * The radius a circle centred at `c` needs to touch `t` — a line, or a circle
 * from outside or inside, whichever is nearer `dragged`, the radius the hand
 * dragged out. On the sheet.
 */
export function touchingRadius(c: readonly number[], t: Touch, dragged: number): number | null {
  if (t.kind === "through") return Math.hypot(c[0] - t.p[0], c[1] - t.p[1]);
  if (t.kind === "line") {
    const d = Math.abs(lineSide(t, c));
    return d > 1e-12 ? d : null;
  }
  const d = Math.hypot(c[0] - t.c[0], c[1] - t.c[1]);
  const options = [Math.abs(d - t.r), d + t.r].filter((r) => r > 1e-12);
  if (!options.length) return null;
  return options.reduce((best, r) => (Math.abs(r - dragged) < Math.abs(best - dragged) ? r : best));
}

/**
 * The circle through `s` and `e` that leaves `s` heading along `heading` — the
 * tangent arc's circle, on the sheet — with whether the arc from `s` round to
 * `e` that leaves along the heading runs counter-clockwise (so `s` is its
 * stored start). Null when `e` is straight on from `s`, where the "arc" is the
 * line carried on, with no radius at all.
 *
 * The centre is on the normal to the heading at `s`, as far along it as makes
 * `e` the same distance away: k = |e − s|² / 2 (e − s)·n.
 */
export function tangentArc(s: readonly number[], heading: readonly number[], e: readonly number[]):
  { center: [number, number]; radius: number; ccw: boolean } | null {
  const hl = Math.hypot(heading[0], heading[1]);
  if (!(hl > 1e-12)) return null;
  const t = [heading[0] / hl, heading[1] / hl];
  const n = [-t[1], t[0]];
  const d = [e[0] - s[0], e[1] - s[1]];
  const dd = d[0] * d[0] + d[1] * d[1];
  const dn = d[0] * n[0] + d[1] * n[1];
  if (!(Math.abs(dn) > 1e-9 * Math.sqrt(dd)) || !(dd > 0)) return null;
  const k = dd / (2 * dn);
  const center: [number, number] = [s[0] + k * n[0], s[1] + k * n[1]];
  // Counter-clockwise travel at s is the radius turned a quarter left.
  const ccwAtS = [-(s[1] - center[1]), s[0] - center[0]];
  return { center, radius: Math.abs(k), ccw: ccwAtS[0] * t[0] + ccwAtS[1] * t[1] > 0 };
}
