// The one number a fillet or a chamfer is held by (docs/plans/solid-fillets.md):
// its radius, or its setback along each face.
//
// A **dimension with no equations**. A blend's shape is the solid kernel's
// (src/solids/), derived every rebuild and never solved; what is relational is
// the number a user goes back and edits. So this adds no residual — it is a
// named value-holder, `d`-named, with a `.value` that `set("d7.value", 4)`
// re-runs this with, in place, under the same name, and undone like any
// dimension. A full revolve's angle is the precedent: a dimension whose relation
// holds nothing.
//
// Nothing calls these but the expansion inside `fillet`/`chamfer` of edges
// (blends.ts) and `set`, re-running them; they never journal themselves — the
// operation is the journal entry.

import type { Model } from "../model.ts";

function size(model: Model, op: "filletRadius" | "chamferSetback", value: unknown): string {
  const what = op === "filletRadius" ? "a fillet's radius" : "a chamfer's setback";
  if (typeof value !== "number" || !Number.isFinite(value) || !(value > 0)) {
    throw new Error(`${what} is a length more than 0, got ${JSON.stringify(value) ?? String(value)}`);
  }
  return model.relation(op, [value], () => {
    // Nothing to solve: the kernel reads the value off the record (bodies.ts).
  });
}

/** A fillet's radius, as a dimension: `filletRadius(3)` → `d7`. */
export function filletRadius(model: Model, radius: number): string {
  return size(model, "filletRadius", radius);
}

/** A chamfer's setback along each face, as a dimension: `chamferSetback(2)` → `d8`. */
export function chamferSetback(model: Model, setback: number): string {
  return size(model, "chamferSetback", setback);
}
