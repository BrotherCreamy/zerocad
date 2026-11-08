// What the sketch-edit tools draw over the drawing (docs/plans/sketch-edit.md):
// a piece of a curve, a stroke along points, a mark where a click will land.
// Plain canvas strokes through a `RenderContext`, so every edit tool draws its
// preview the one way, in the tools' colours: green for what a click makes,
// the cut's red for what it takes away.

import type { PointerInfo, RenderContext, ToolContext } from "./tool.ts";
import type { Entity, Model } from "../model.ts";
import { distanceToCurve, isSketchCurve, pointOn } from "../sketchgeom.ts";
import { heldOnCurves } from "../loops.ts";

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
  if (hit?.kind === "point" && sketched(hit.name)) {
    const held = new Set(heldOnCurves(model).filter((h) => h.point === hit.name).map((h) => h.curve));
    const through = [...model.entities.values()].filter((e) => takes(e) && !model.hidden.has(e.name) && sketched(e.name)
      && (model.refsOf(e).includes(hit.name) || held.has(e.name)) && !(e.kind !== "line" && "center" in e && e.center === hit.name));
    let best: string | null = null, d = Infinity;
    for (const e of through) {
      const here = distanceToCurve(model, e.name, p.world);
      if (here < d) [best, d] = [e.name, here];
    }
    if (best) return best;
  }
  // A solid's own edge won the pick — a lid's edge drawn over the sketch edge
  // under it, seen from above — or nothing did: the press read on the sketch
  // plane, and the sketch curve nearest it within a line's pick reach.
  return onSketchPlane(ctx, p.screen, takes);
}

/** What a feature made — a lid's edge, a wall — which a sketch edit never takes. */
export function ownedBySolid(model: Model, name: string): boolean {
  for (const f of model.features.values()) if (f.owns.includes(name)) return true;
  return false;
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
