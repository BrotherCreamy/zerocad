// Saving and opening a model.
//
// A model cannot be serialised directly, and the reason is worth stating
// plainly: a residual block holds a *closure*, and closures do not survive a
// round trip through JSON. What does survive is the sequence of calls that
// produced them. So a saved file is the model's journal — what was done to
// it, in order — and opening one means doing all of it again.
//
// That is a happier answer than it first sounds, because those calls are
// exactly what the command line already takes. The save format is not a
// separate serialisation of the model's internals that has to be kept in
// step with them; it is a transcript of the public API, and anything you
// could type you can save.
//
// Solved coordinates are stored alongside the journal and restored after the
// replay. They are not strictly necessary — replaying and re-solving gets
// back to *a* valid configuration — but an under-constrained model has many,
// and reopening a drawing should give back the one that was saved rather
// than whichever the solver happens to find this time.

import { Model, type JournalEntry } from "./model.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";
import { fillet } from "./operations.ts";

export const FORMAT = "neocad-model";
export const VERSION = 1;

export interface SavedModel {
  format: typeof FORMAT;
  version: number;
  dim: number;
  journal: JournalEntry[];
  /** Solved coordinates, keyed by point name; radii keyed by circle/arc name. */
  values: { points: Record<string, number[]>; radii: Record<string, number> };
}

/**
 * Every call a journal entry can name. Model's own structural methods, plus
 * the relation vocabulary and the operations — deliberately a fixed list, so
 * that opening a file can only ever perform calls that were already part of
 * the public API. A saved file is data, not a script.
 *
 * A Map rather than an object, and not fussiness: a plain object would answer
 * a lookup for "constructor" or "toString" from Object.prototype, so a file
 * naming one of those would sail past a `table[op]` check and get something
 * called. A Map has no prototype chain to walk.
 */
function replayTable(model: Model): Map<string, (...args: unknown[]) => unknown> {
  const m = model as unknown as Record<string, (...a: unknown[]) => unknown>;
  const bound = (name: string) => (...args: unknown[]) => m[name](...args);
  const rel = (fn: (model: Model, ...args: never[]) => unknown) =>
    (...args: unknown[]) => (fn as (model: Model, ...a: unknown[]) => unknown)(model, ...args);

  return new Map<string, (...args: unknown[]) => unknown>(Object.entries({
    addPoint: bound("addPoint"),
    addLine: bound("addLine"),
    addCircle: bound("addCircle"),
    addArc: bound("addArc"),
    setCoords: bound("setCoords"),
    retargetLine: bound("retargetLine"),
    // Deletion is journalled as its *expansion* — one entry per name `del`
    // removed — rather than as the `del` call itself, so a replay removes
    // exactly what was removed rather than recomputing a cascade against a
    // model that may have been built differently since. Old files carry
    // neither op and open unchanged; there is nothing to version-bump.
    deleteEntity: bound("deleteEntity"),
    deleteRelation: bound("deleteRelation"),

    dist: rel(basic.dist),
    fix: rel(basic.fix),
    coincident: rel(basic.coincident),
    midpoint: rel(basic.midpoint),
    horizontal: rel(basic.horizontal),
    vertical: rel(basic.vertical),

    parallel: rel(geom.parallel),
    perpendicular: rel(geom.perpendicular),
    angle: rel(geom.angle),
    pointOnLine: rel(geom.pointOnLine),
    equalLength: rel(geom.equalLength),
    radius: rel(geom.radius),
    onCircle: rel(geom.onCircle),
    concentric: rel(geom.concentric),
    equalRadius: rel(geom.equalRadius),
    tangent: rel(geom.tangent),
    symmetric: rel(geom.symmetric),
    arcEndpoints: rel(geom.arcEndpoints),

    fillet: rel(fillet),
  }));
}

/** The model as a plain object, ready for JSON.stringify. */
export function toSaved(model: Model): SavedModel {
  const points: Record<string, number[]> = {};
  const radii: Record<string, number> = {};
  for (const e of model.entities.values()) {
    if (e.kind === "point") points[e.name] = model.coords(e.name);
    else if (e.kind === "circle" || e.kind === "arc") radii[e.name] = model.radius(e.name);
  }
  return {
    format: FORMAT,
    version: VERSION,
    dim: model.dim,
    journal: model.journal.map((e) => ({ op: e.op, args: e.args })),
    values: { points, radii },
  };
}

export function save(model: Model, pretty = true): string {
  return JSON.stringify(toSaved(model), null, pretty ? 2 : 0);
}

export function fromSaved(saved: SavedModel): Model {
  if (saved?.format !== FORMAT) throw new Error("not a neocad model");
  if (saved.version > VERSION) {
    throw new Error(`this file is version ${saved.version}, and this build only reads up to ${VERSION}`);
  }
  if (!Array.isArray(saved.journal)) throw new Error("model file has no journal");

  const model = new Model(saved.dim ?? 2);
  const table = replayTable(model);

  // Replay with recording off, then install the journal wholesale, so a model
  // that is opened and saved again round-trips to the same file.
  model.withoutRecording(() => {
    saved.journal.forEach((entry, i) => {
      const fn = table.get(entry.op);
      if (!fn) throw new Error(`step ${i + 1}: "${entry.op}" is not something a model file may do`);
      if (!Array.isArray(entry.args)) throw new Error(`step ${i + 1}: "${entry.op}" has no arguments`);
      try {
        fn(...entry.args);
      } catch (e) {
        throw new Error(`step ${i + 1}, ${entry.op}(${entry.args.map((a) => JSON.stringify(a)).join(", ")}): ${e instanceof Error ? e.message : e}`);
      }
    });
  });
  model.journal = saved.journal.map((e) => ({ op: e.op, args: e.args }));

  // Put the saved solution back — see the note at the top about why.
  const vals = saved.values ?? { points: {}, radii: {} };
  model.withoutRecording(() => {
    for (const [name, coords] of Object.entries(vals.points ?? {})) {
      if (model.entities.get(name)?.kind === "point") model.setCoords(name, coords);
    }
  });
  for (const [name, r] of Object.entries(vals.radii ?? {})) {
    const e = model.entities.get(name);
    if (e && (e.kind === "circle" || e.kind === "arc")) model.problem.setVar(e.radiusVar, r);
  }

  return model;
}

export function open(json: string): Model {
  let parsed: SavedModel;
  try {
    parsed = JSON.parse(json) as SavedModel;
  } catch (e) {
    throw new Error(`not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  return fromSaved(parsed);
}
