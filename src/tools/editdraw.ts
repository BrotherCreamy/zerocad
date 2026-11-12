// What the sketch-edit tools draw over the drawing (docs/plans/sketch-edit.md):
// a piece of a curve, a stroke along points, a mark where a click will land.
// Plain canvas strokes through a `RenderContext`, so every edit tool draws its
// preview the one way, in the tools' colours: green for what a click makes,
// the cut's red for what it takes away.

import type { PointerInfo, RenderContext, ToolContext } from "./tool.ts";
import type { Entity, Model } from "../model.ts";
import { cutsOf, distanceToCurve, isSketchCurve, pointOn } from "../sketchgeom.ts";
import { heldOnCurves } from "../loops.ts";
import { sampledWorld } from "../projection.ts";
import { partnersOf } from "../twins.ts";

/** The kinds the edit tools take as a curve, unless a tool says otherwise. */
const CURVES = new Set(["line", "arc", "circle"]);
const usual = (e: Entity | undefined) => !!e && CURVES.has(e.kind);

/** Every sketch curve: what trim takes (docs/plans/trim-everything.md) — an ellipse, an elliptical arc, a spline and its piece too. */
export const anyCurve = (e: Entity | undefined): boolean => isSketchCurve(e);

/**
 * The curve a press means: the line, arc or circle under it — or, where a
 * point wins the pick (picking.ts puts points first, rightly, for every other
 * tool), the curve through that point nearest the place pressed, so a click
 * just off a corner still trims the edge it is on.
 */
export function curveUnder(ctx: ToolContext, p: PointerInfo, takes: (e: Entity | undefined) => boolean = usual): string | null {
  const model = ctx.model;
  const hit = ctx.pick?.(p.screen) ?? null;
  const sketched = (n: string) => !ownedBySolid(model, n);
  if (hit && hit.kind !== "point" && takes(model.entities.get(hit.name)) && sketched(hit.name)) return hit.name;
  // **A lid's edge that something cuts is an edge to edit** (docs/plans/
  // linked-profiles.md): it has a partner on the base, and the edit is made
  // on both. One nothing cuts falls through, as every solid's edge used to —
  // seen from above it lies over its sketch edge, and that is the one meant.
  const cut = (n: string) => linkedEdge(model, n) && cutsOf(model, n).length > 0;
  if (hit && hit.kind !== "point" && takes(model.entities.get(hit.name)) && cut(hit.name)) return hit.name;
  if (hit?.kind === "point") {
    // A sketch's point: its sketch curves, nearest the place pressed. A lid's
    // corner (a finger lands on one more often than on the edge beside it):
    // its cut edges, nearest the pixel — they are not on the plane the press was read on.
    const mine = sketched(hit.name) ? sketched : cut;
    const held = new Set(heldOnCurves(model).filter((h) => h.point === hit.name).map((h) => h.curve));
    const through = [...model.entities.values()].filter((e) => takes(e) && !model.hidden.has(e.name) && mine(e.name)
      && (model.refsOf(e).includes(hit.name) || held.has(e.name)) && !(e.kind !== "line" && "center" in e && e.center === hit.name));
    let best: string | null = null, d = Infinity;
    for (const e of through) {
      const on = placeOn(ctx, p, e.name);
      const here = mine === cut && ctx.toScreen ? Math.hypot(...ctx.toScreen(on).map((c, i) => c - p.screen[i])) : distanceToCurve(model, e.name, p.world);
      if (here < d) [best, d] = [e.name, here];
    }
    if (best) return best;
  }
  // A solid's own edge won the pick — a lid's edge drawn over the sketch edge
  // under it, seen from above — or nothing did: the press read on the sketch
  // plane, and the sketch curve nearest it within a line's pick reach.
  return onSketchPlane(ctx, p.screen, takes);
}

/** What a feature made — a lid's edge, a wall — which a sketch edit takes only where it is a profile's edge with a partner (`linkedEdge`). */
export function ownedBySolid(model: Model, name: string): boolean {
  for (const f of model.features.values()) if (f.owns.includes(name)) return true;
  return false;
}

/** Whether a curve a feature made is an edge of a linked profile: a lid's edge, with its partner on the base. */
export function linkedEdge(model: Model, name: string): boolean {
  return ownedBySolid(model, name) && partnersOf(model, name).length > 0;
}

/**
 * **Where on `curve` a press is**, in the world: the point of the curve drawn
 * under the pixel. A press is read on the drawing plane, which is where a
 * sketch's curves are; a lid's edge is a depth above it, and seen from one
 * side the ground under the pixel is nowhere near the edge. A line's is exact
 * (the view is parallel); a curve's is its nearest drawn sample. Falls back to
 * the press's own place where there is no view to project through.
 */
export function placeOn(ctx: ToolContext, p: PointerInfo, curve: string): number[] {
  const model = ctx.model;
  const e = model.entities.get(curve);
  if (!e || !ctx.toScreen || !linkedEdge(model, curve)) return p.world;
  const pts = e.kind === "line" ? e.refs.map((r) => model.coords(r)) : sampledWorld(model, e, 4);
  if (!pts || pts.length < 2) return p.world;
  let best = p.world, d = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [a, b] = [ctx.toScreen(pts[i]), ctx.toScreen(pts[i + 1])];
    const [vx, vy] = [b[0] - a[0], b[1] - a[1]];
    const span = vx * vx + vy * vy;
    const t = span > 1e-12 ? Math.max(0, Math.min(1, ((p.screen[0] - a[0]) * vx + (p.screen[1] - a[1]) * vy) / span)) : 0;
    const here = Math.hypot(a[0] + t * vx - p.screen[0], a[1] + t * vy - p.screen[1]);
    if (here < d) [best, d] = [pts[i].map((c, k) => c + t * (pts[i + 1][k] - c)), here];
  }
  return best;
}

/** The sketch curve nearest a press read on the drawing plane, within ten pixels there; null where there is none or no plane to read it on. */
function onSketchPlane(ctx: ToolContext, [sx, sy]: [number, number], takes: (e: Entity | undefined) => boolean): string | null {
  const model = ctx.model;
  if (!ctx.planeAt) return null;
  let plane: { origin: number[]; u: number[]; v: number[] } | null = null;
  try {
    plane = model.planeValues(model.drawingPlane());
  } catch {
    return null;
  }
  if (!plane) return null;
  const at = ctx.planeAt([sx, sy], plane), beside = ctx.planeAt([sx + 10, sy], plane);
  if (!at || !beside) return null;
  const reach = Math.hypot(...at.map((v, i) => v - beside[i]));
  let best: string | null = null, d = reach;
  for (const e of model.entities.values()) {
    if (!takes(e) || model.hidden.has(e.name) || ownedBySolid(model, e.name)) continue;
    const here = distanceToCurve(model, e.name, at.slice(0, model.dim));
    if (here < d) [best, d] = [e.name, here];
  }
  return best;
}

/** A stroke through world points. */
export function strokeWorld(r: RenderContext, pts: readonly number[][], colour: string, width = 3, dash: number[] = []): void {
  if (pts.length < 2) return;
  const g = r.g;
  const ui = r.ui ?? 1;
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = width * ui;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.setLineDash(dash.map((d) => d * ui));
  g.beginPath();
  g.moveTo(...r.worldToScreen(pts[0]));
  for (const p of pts.slice(1)) g.lineTo(...r.worldToScreen(p));
  g.stroke();
  g.restore();
}

/** The points of `name` from fraction `a` to `b` along it — `b` past 1 runs on round a circle. */
export function pieceSamples(model: Model, name: string, a: number, b: number, steps = 48): number[][] {
  const kind = model.entities.get(name)?.kind;
  // A spline's piece more finely: it bends where it likes.
  const n = kind === "line" ? 1 : kind === "spline" || kind === "bspline" ? Math.max(steps, 160) : steps;
  return Array.from({ length: n + 1 }, (_, k) => pointOn(model, name, a + ((b - a) * k) / n));
}

/** A small ring where a click will put an end — the place, not a point yet. */
export function ringAt(r: RenderContext, world: number[], colour: string): void {
  const g = r.g;
  const ui = r.ui ?? 1;
  const [x, y] = r.worldToScreen(world);
  g.save();
  g.strokeStyle = colour;
  g.lineWidth = 2 * ui;
  g.beginPath();
  g.arc(x, y, 5 * ui, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

/** Rounded for a typed line: four decimals, enough to land on the same piece, short enough to read in the log. */
export function rounded(v: readonly number[]): number[] {
  return v.map((x) => Math.round(x * 1e4) / 1e4 + 0);
}
