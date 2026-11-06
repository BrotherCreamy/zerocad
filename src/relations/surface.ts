// The numbers a surface's records are held by (docs/plans/surfaces.md): an
// extruded surface's depth, a revolved one's angle, and the distance of an
// offset, a thicken or an extend.
//
// **Dimensions with no equations**, as a fillet's radius is (blend.ts): a
// surface's shape is the solid kernel's, derived every rebuild and never
// solved; what is relational is the number a user goes back and edits. So
// each adds no residual — a named value-holder, `d`-named, with a `.value`
// that `set("d7.value", 4)` re-runs it with, in place, under the same name.
//
// Nothing calls these but the operations in surfaces.ts and `set`, re-running
// them; they never journal themselves — the operation is the journal entry.

import type { Model } from "../model.ts";

export type SurfaceDimension = "surfaceDepth" | "surfaceAngle" | "surfaceDistance";

const WHAT: Record<SurfaceDimension, string> = {
  surfaceDepth: "an extruded surface's depth",
  surfaceAngle: "a revolved surface's angle",
  surfaceDistance: "a surface's distance",
};

function size(model: Model, op: SurfaceDimension, value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    throw new Error(`${WHAT[op]} is a number other than 0, got ${JSON.stringify(value) ?? String(value)}`);
  }
  return model.relation(op, [value], () => {
    // Nothing to solve: the kernel reads the value off the record (surfaces.ts).
  });
}

/** An extruded surface's depth, signed along its plane's normal: `surfaceDepth(20)` → `d5`. */
export function surfaceDepth(model: Model, depth: number): string {
  return size(model, "surfaceDepth", depth);
}

/** A revolved surface's angle, radians, signed about its axis. */
export function surfaceAngle(model: Model, angle: number): string {
  return size(model, "surfaceAngle", angle);
}

/** An offset's, a thicken's or an extend's distance — signed where the record says which way. */
export function surfaceDistance(model: Model, distance: number): string {
  return size(model, "surfaceDistance", distance);
}
