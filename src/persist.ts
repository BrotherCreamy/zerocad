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
/**
 * 3 since `hor`/`ver` were retired in favour of frame-axis references.
 *
 * Older files are still *read*, and the two older versions are read
 * differently on purpose, because what is wrong with each is different.
 *
 * A **version-2** file's `horizontal`/`vertical` entries name a frame and
 * therefore still say exactly what they meant; only the vocabulary they say it
 * in is gone. So they are **translated** rather than refused (see `translate`)
 * — two lines of code that keep every file this app has ever written openable,
 * including the ones behind the register's own screenshots.
 *
 * A **version-1** file's entries name no frame at all, and with no world frame
 * left there is nothing to resolve them against. Those are still refused, and
 * still refused *by step*, because the useful thing to say about one is not
 * "wrong version" but which line of it no longer means anything.
 *
 * A translated file re-saves in the new vocabulary, so `save(open(x)) !== x`
 * across this boundary. That is deliberate and stated in the CHANGELOG: a file
 * that opened as `par` and saved back as `hor` would keep the retired words
 * alive in the format forever.
 */
export const VERSION = 3;

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
    addFrame: bound("addFrame"),
    // The default frame is journalled because it changes what a *later*
    // relation call means. It never changes what an already-journalled one
    // means: `fix` and the axis helpers resolve it when they are called and
    // record the answer.
    setDefaultFrame: bound("setDefaultFrame"),
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
    // `horizontal`/`vertical` are not here: they are rewritten into `parallel`
    // before the lookup happens. See `translate`.

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

/**
 * A journal entry written in a vocabulary that no longer exists, rewritten
 * into the one that replaced it. Everything else passes straight through.
 *
 * `horizontal(l, f)` becomes `parallel(l, "f.x")` and `vertical(l, f)` becomes
 * `parallel(l, "f.y")` — parallel to +y rather than perpendicular to +x, which
 * is the same equation either way (the wedge with +y *is* the dot with +x) but
 * reads properly afterwards: `rels()` says `par l1 f.y` and the glyph says
 * `∥`, where a `perp` would have left the drawing claiming a right angle to an
 * axis it is square to. The point forms carry their extra name along.
 *
 * It needs the half-built model for two reasons. Which form an entry is comes
 * off the subject's *kind*, exactly as it did when `horizontal` decided it.
 * And a version-1 entry names no frame at all, so it reaches `resolveFrame`
 * here and is told what it is missing — the same message, at the same step, as
 * before this translation existed.
 */
function translate(model: Model, entry: JournalEntry): JournalEntry {
  if (entry.op !== "horizontal" && entry.op !== "vertical") return entry;
  const axis = entry.op === "horizontal" ? "x" : "y";
  const [a, b, c] = entry.args as (string | null | undefined)[];
  const pointForm = model.entities.get(String(a))?.kind === "point";
  const ref = `${model.resolveFrame(pointForm ? c : b)}.${axis}`;
  return { op: "parallel", args: pointForm ? [a, b, ref] : [a, ref] };
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
  // that is opened and saved again round-trips to the same file. What is
  // installed is the *translated* journal rather than the file's own, which is
  // the one place those two can differ: an entry rewritten on the way in has
  // to be rewritten on the way out too, or the file would keep saying
  // `horizontal` forever and nothing would ever finish the migration.
  const replayed: JournalEntry[] = [];
  model.withoutRecording(() => {
    saved.journal.forEach((entry, i) => {
      if (!Array.isArray(entry.args)) throw new Error(`step ${i + 1}: "${entry.op}" has no arguments`);
      // The step is reported with the *original* op and arguments, since that
      // is what is written in the file the reader is looking at.
      const where = (e: unknown) =>
        new Error(`step ${i + 1}, ${entry.op}(${entry.args.map((a) => JSON.stringify(a)).join(", ")}): ${e instanceof Error ? e.message : e}`);
      let step: JournalEntry;
      try {
        step = translate(model, entry);
      } catch (e) {
        throw where(e);
      }
      const fn = table.get(step.op);
      if (!fn) throw new Error(`step ${i + 1}: "${step.op}" is not something a model file may do`);
      try {
        fn(...step.args);
      } catch (e) {
        throw where(e);
      }
      replayed.push({ op: step.op, args: step.args });
    });
  });
  model.journal = replayed;

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
