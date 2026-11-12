// Fillets and chamfers of a body's edges, as operations (docs/plans/solid-fillets.md):
// `fillet("e1", ["e1.lid|e1.m0", …], 3)`, `chamfer("e1", [...], 2)`, and
// `setEdges("e3", [...])`, the edge list changed by the feature dialog.
//
// **An operation, because it makes structure**: a record in the model's
// registry of blends (`BlendFeature`) and the dimension that holds its size.
// It makes no entity and no equation of shape — the rounded body is the solid
// kernel's (src/solids/evaluate.ts), derived from the chain every rebuild — so
// it cannot over- or under-constrain anything, and its one way to leave the
// model malformed (a record naming nothing) is refused here.
//
// **Edges are names, checked for shape and never for presence.** Whether
// `e1.lid|e1.m0` is on the body is the kernel's to say, and asynchronously: a
// replay, a test with no kernel and a phone that has not loaded it yet all
// make the same record. An edge no longer there is said in the log and left
// out (bodies.ts); this file only refuses what could never be an edge.
//
// At the operations' height: it reads the model and its chains (modes.ts), and
// nothing of the kernel.

import type { BlendFeature, Model } from "./model.ts";
import { bodyNameOf } from "./modes.ts";
import { fillet } from "./operations.ts";
import { chamferSetback, filletRadius } from "./relations/blend.ts";
import { faceSource, parseEdgeName } from "./relations/solidref.ts";
import { chamfer } from "./sketchedit.ts";

/** What a kernel edge's name looks like: two faces' names, `e1.lid|e2.m0` (naming.ts). Never a seam. */
const EDGE_NAME = /^[^|\s]+\|[^|\s]+$/;

function checkEdges(op: string, edges: unknown): string[] {
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new Error(`${op} takes a list of edges, like ["e1.lid|e1.m0"] — the names a hover on an edge shows`);
  }
  for (const e of edges) {
    if (typeof e !== "string" || !EDGE_NAME.test(e)) {
      throw new Error(`${op}: ${JSON.stringify(e) ?? String(e)} is not an edge's name — an edge is named by its two faces, "e1.lid|e1.m0"`);
    }
  }
  // Each once, in the order given: the order names the faces it makes (`e3.f0` is the first edge's).
  return [...new Set(edges as string[])];
}

/** The body a feature is part of, for a blend to round: refused, in words, for anything else. */
function bodyFor(model: Model, op: string, feature: unknown): string {
  if (model.dim !== 3) throw new Error(`${op} rounds a solid's edges, and a ${model.dim}D model has no solid`);
  if (typeof feature !== "string" || !(model.features.has(feature) || model.blends.has(feature))) {
    throw new Error(`${op} takes the body first — a feature of it, as ls() lists them (e1, e2, …) — got ${JSON.stringify(feature) ?? String(feature)}`);
  }
  const body = bodyNameOf(model, feature);
  if (body === null) throw new Error(`"${feature}" is in no body now — it was left out of its own`);
  return body;
}

/**
 * **The corner of a profile a kernel edge is swept from**, as its two lines —
 * or null for any other edge. An edge between two walls of one extrude, each
 * the whole of a line, the two lines sharing an end: the solid's edge *is*
 * that corner, swept. Read off the record and the names, never the kernel.
 */
export function profileCorner(model: Model, edge: string): [string, string] | null {
  const parts = parseEdgeName(edge);
  if (!parts) return null;
  const [a, b] = parts.map((p) => faceSource(model, p));
  if (a?.kind !== "wall" || b?.kind !== "wall" || a.feature !== b.feature || a.feature.kind !== "extrude" || !a.whole || !b.whole) return null;
  const [la, lb] = [model.entities.get(a.entity), model.entities.get(b.entity)];
  if (la?.kind !== "line" || lb?.kind !== "line" || la.name === lb.name || !la.refs.some((p) => lb.refs.includes(p))) return null;
  return [la.name, lb.name];
}

/**
 * **A fillet is one thing** (docs/plans/fillets-one-thing.md). The owner:
 * *"adding a 2d fillet to the originating chain of a region of a body should
 * produce an identical outcome to 3d filleting that edge."* So an edge that
 * is a profile's corner swept (`profileCorner`) is not blended by the kernel:
 * it is the sketch's own `fillet` (or `chamfer`) of that corner — the same
 * call, the same journal entry, the same entities on both profiles, the same
 * body — and the two routes cannot be told apart afterwards. Every other
 * edge (a lid's rim, a base's, an edge between two features, a round wall's)
 * replaces no sketch entity and is the kernel's blend, one record for them
 * all, as it was.
 *
 * A list of both is both: the record for the kernel's edges is made first,
 * so that the corners cut after it move its walls' places with them
 * (`remapBlends`, operations.ts) rather than under it. Returns the record's
 * name where there is one, else what the last corner made (its arc, or the
 * chamfer's line).
 *
 * **Only a live call is read this way.** A journal's `filletEdges` entry is
 * the record it made — a new file's lists no corner, and a file from before
 * format 22 may list one that the kernel rounded then — so a replay (which
 * records nothing) makes exactly the record the entry names.
 */
function blend(model: Model, op: "fillet" | "chamfer", journal: string, feature: unknown, edges: unknown, size: unknown): string {
  const body = bodyFor(model, op, feature);
  const list = checkEdges(op, edges);
  const corners = list.map((e) => (model.journalling ? profileCorner(model, e) : null));
  const rest = list.filter((_, i) => corners[i] === null);
  let made = "";
  if (rest.length) {
    made = model.asOperation(journal, [feature, rest, size], () => {
      const d = op === "fillet" ? filletRadius(model, size as number) : chamferSetback(model, size as number);
      return model.addBlend({ kind: op, into: body, edges: rest, size: d, names: [d], owns: [d] }).name;
    });
  }
  let last = "";
  for (const c of corners) {
    if (c === null) continue;
    last = op === "fillet" ? fillet(model, c[0], c[1], size as number) : chamfer(model, c[0], c[1], size as number);
  }
  return made || last;
}

/**
 * Rounds a body's edges: `fillet("e1", ["e1.lid|e1.m0"], 3)` — a feature
 * (`e3`) after everything the body was made of so far, its radius a dimension
 * (`set("d7.value", 4)`). Typed as `fillet`, beside the sketch's corner
 * fillet (`fillet("l1", "l2", 3)`), told apart by its list of edges;
 * journalled as `filletEdges`. Returns the feature's name.
 */
export function filletEdges(model: Model, feature: string, edges: string[], radius: number): string {
  return blend(model, "fillet", "filletEdges", feature, edges, radius);
}

/**
 * Cuts a body's edges back by an equal setback along each face:
 * `chamfer("e1", ["e1.lid|e1.m0"], 2)`. Equal setback only (the spec's; two
 * distances, or a distance and an angle, later if asked). Journalled as
 * `chamferEdges`.
 */
export function chamferEdges(model: Model, feature: string, edges: string[], setback: number): string {
  return blend(model, "chamfer", "chamferEdges", feature, edges, setback);
}

/**
 * A fillet's or chamfer's edges, replaced: `setEdges("e3", [...])` — what the
 * feature dialog's ✓ types when edges were clicked in or out. In place, under
 * the same name, so the radius and every reference to `e3` stay.
 */
export function setEdges(model: Model, feature: string, edges: string[]): string {
  if (typeof feature !== "string" || !model.blends.has(feature)) {
    throw new Error(`setEdges takes a fillet or a chamfer first, got ${JSON.stringify(feature) ?? String(feature)}`);
  }
  const was: BlendFeature = model.blendOf(feature);
  const list = checkEdges("setEdges", edges);
  return model.asOperation("setEdges", [feature, list], () => {
    model.rewriteBlend(feature, { kind: was.kind, into: was.into, edges: list, size: was.size, names: was.names, owns: was.owns });
    return feature;
  });
}

/** A blend's size as its dimension holds it now. */
export function blendSize(model: Model, b: BlendFeature): number {
  const v = model.relationOf(b.size).args[0];
  return typeof v === "number" ? v : NaN;
}

/** One line for a fillet or chamfer — what `ls()` prints and the organiser's menu heads: `e3  fillet of 2 edges of e1, radius d7 = 3`. */
export function describeBlend(model: Model, b: BlendFeature): string {
  const v = blendSize(model, b);
  const n = b.edges.length;
  return `${b.name}  ${b.kind} of ${n} edge${n === 1 ? "" : "s"} of ${b.into}, ${b.kind === "fillet" ? "radius" : "setback"} ${b.size}`
    + `${Number.isFinite(v) ? ` = ${Math.round(v * 1000) / 1000}` : ""}`;
}
