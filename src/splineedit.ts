// Editing a spline's points (docs/plans/spline.md): the context menu on the
// curve adds a through-point where it was clicked, or takes one out.
//
// Each **re-points** an entity — the spline goes through a different list of
// points afterwards — so each is an *operation*, never a relation (CLAUDE.md),
// journalled as its typed call with what it read off positions resolved beside
// it, as the sketch edits are (sketchedit.ts): a replay is handed where the new
// point goes in the list and where it was laid, and decides nothing from seeds.
// The spline keeps its name and every relation on it (relations/spline.ts's
// `respline`); its control points are re-seeded on the curve the new points
// make and solved again.

import type { Model } from "./model.ts";
import { domain, fewestPoints, knotsOf, layout, nearestParam, numericGaps, pointAt } from "./bspline.ts";
import { splineCurve, splineOf } from "./kinds/spline.ts";
import { respline } from "./relations/spline.ts";
import { onPlane } from "./relations/basic.ts";
import { del } from "./operations.ts";

/** Refuses an edit of a spline a feature's profile or twins name: its twin would no longer match it. */
function refuseUnderFeature(model: Model, op: string, name: string): void {
  const f = model.featuresNaming(name)[0];
  if (f) {
    throw new Error(`${op}: "${name}" is part of ${f.name}, whose lid is a spline through the twins of its points — `
      + `edit the spline before extruding it, or del("${f.name}") and extrude it again`);
  }
}

/** The plane every one of a spline's points is held on by `onplane`, if they share one — what a new point joins. */
function sharedPlane(model: Model, points: readonly string[]): string | null {
  let shared: string | null = null;
  for (const p of points) {
    const r = model.relationsNaming(p).find((x) => x.op === "onPlane" && x.args[0] === p);
    const plane = typeof r?.args[1] === "string" ? r.args[1] : null;
    if (plane === null || (shared !== null && plane !== shared)) return null;
    shared = plane;
  }
  return shared;
}

/**
 * `addThrough("sp1", [x, y])`: a new through-point on the curve where it is
 * nearest `at`, between the two points either side of it. The curve then goes
 * through it and stays near where it was — not exactly: an interpolating
 * spline through one more point re-spaces its knots and bends a little
 * differently (under 2 % of its length in the suite's case), the price of a
 * curve that passes through every point it is given. In 3D the new point is held on
 * the plane every other point of the spline is held on, if they share one.
 * Journalled as `addThrough(s, at, { index, at })`: where it went in the list,
 * and where it was laid. Answers the new point's name.
 */
export function addThrough(model: Model, name: string, at: unknown, resolved?: unknown): string {
  const s = splineOf(model, name);
  if (!Array.isArray(at) || !at.every((x) => typeof x === "number" && Number.isFinite(x)) || at.length < 2) {
    throw new Error(`addThrough("${name}", [x, y]) takes where on the curve to add a point, got ${JSON.stringify(at)}`);
  }
  refuseUnderFeature(model, "addThrough", name);
  const r = resolved as { index?: unknown; at?: unknown } | null | undefined;
  let index: number;
  let place: number[];
  if (r && Number.isInteger(r.index) && Array.isArray(r.at)) {
    index = r.index as number;
    place = r.at as number[];
  } else {
    const curve = splineCurve(model, name);
    const where = at.slice(0, model.dim).concat(new Array(Math.max(0, model.dim - at.length)).fill(0)) as number[];
    const u = nearestParam(curve, where, curve.closed);
    const L = layout(s.points.length, s.closed === true);
    const K = knotsOf(numericGaps(L, s.points.map((p) => model.coords(p))));
    // The through-point t_k is K[3 + k]: the new one goes after the last t_k at or before u.
    let k = 0;
    while (k + 1 < s.points.length && K[3 + k + 1] <= u) k++;
    const [lo, hi] = domain(curve);
    if (!s.closed && (u <= lo + 1e-9 * (hi - lo) || u >= hi - 1e-9 * (hi - lo))) {
      throw new Error(`addThrough: that is "${name}"'s end — a point added there would be no new point; drag the end instead`);
    }
    index = k + 1;
    place = pointAt(curve, u);
  }
  if (index < 1 || index > s.points.length || (!s.closed && index === s.points.length)) {
    throw new Error(`addThrough: no place ${index} between "${name}"'s points`);
  }
  const plane = sharedPlane(model, s.points);
  return model.asOperation("addThrough", () => [name, at, { index, at: place }], () => {
    const p = model.addPoint(place).name;
    const points = [...s.points.slice(0, index), p, ...s.points.slice(index)];
    respline(model, name, points);
    if (plane !== null && model.dim === 3) onPlane(model, p, plane);
    return p;
  });
}

/**
 * `removeThrough("sp1", "p3")`: the curve no longer goes through p3 — refused
 * where that would leave fewer points than a spline has (two open, three
 * closed: delete it instead). The point itself goes too when nothing else
 * uses it, with what named it, so no stray point is left where the curve was
 * (docs/plans/no-stranded-points.md). Journalled as the call.
 */
export function removeThrough(model: Model, name: string, point: unknown): string[] {
  const s = splineOf(model, name);
  if (typeof point !== "string" || !s.points.includes(point)) {
    throw new Error(`removeThrough: ${JSON.stringify(point)} is not one of "${name}"'s points (${s.points.join(", ")})`);
  }
  if (s.points.length <= fewestPoints(s.closed === true)) {
    throw new Error(`removeThrough: "${name}" goes through ${s.points.length} points, the fewest a${s.closed ? " closed" : "n open"} `
      + `spline can — del("${name}") removes it`);
  }
  refuseUnderFeature(model, "removeThrough", name);
  return model.asOperation("removeThrough", [name, point], () => {
    respline(model, name, s.points.filter((p) => p !== point));
    const used = [...model.entities.values()].some((e) => e.name !== point && model.refsOf(e).includes(point));
    return used ? [] : del(model, point);
  });
}
