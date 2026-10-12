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
import { fillet, set } from "./operations.ts";
import type { ToolSource } from "./toolsource.ts";

export const FORMAT = "neocad-model";
/**
 * 5 since frames gained a y-ref for 3D: `addFrame`'s name moved from its third
 * argument to its fourth, so the y-ref could sit beside the other two points
 * with the name last, as it is on every constructor. Every older file says
 * `addFrame(origin, xref, name)`, and `translate` rewrites that to
 * `addFrame(origin, xref, null, name)` on the way in. Bumped rather than left
 * at 4 by the rule the `tools` note below states: a build that knew only v4
 * would read the new four-argument entry as `addFrame(origin, xref, null)` and
 * auto-name the frame, so a frame called anything but `f1`, `f2`, … would
 * vanish from under every later entry naming it. A break in that direction is
 * what the version is for. (3D phase 1's model half; the app is still 2D, so
 * a v5 file is as 2D as a v4 one — the `dim` field says which.)
 *
 * 4 was dimensions becoming `d`-named — see `relationRenamer` for what that
 * costs an older file and how it is paid.
 *
 * 3 was `hor`/`ver` being retired in favour of frame-axis references.
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
 * across any of these boundaries — the ops rewritten at 2→3, the
 * `deleteRelation` names rewritten at 3→4, the `addFrame` arity at 4→5. That
 * is deliberate and stated in the CHANGELOG: a
 * file that opened as `par` and saved back as `hor`, or that kept pointing a
 * deletion at a name the model no longer uses, would carry the old world
 * forward forever.
 *
 * **`tools` did not bump it.** An optional field that older code ignores and
 * newer code reads is not a format break in either direction: a v4 file with
 * tools opens in a build that has never heard of them (it drops them, which is
 * the same thing that build would have done with them anyway), and a v4 file
 * without tools opens here as a file that carries none. Bumping would have
 * refused the first case for no reason — and there are no third-party readers
 * of v4 to protect, since this app is the only one there has ever been.
 */
export const VERSION = 5;

export interface SavedModel {
  format: typeof FORMAT;
  version: number;
  dim: number;
  journal: JournalEntry[];
  /** Solved coordinates, keyed by point name; radii keyed by circle/arc name. */
  values: { points: Record<string, number[]>; radii: Record<string, number> };
  /**
   * The source of any tools authored at the command line, as **inert text**.
   * Absent when there are none, so a drawing with no tools saves exactly the
   * bytes it always did.
   *
   * A sibling of the journal rather than part of it, because it is not
   * something that was done to the model — see `toolsource.ts`. Nothing here
   * reads it back: `open()` replays the journal and never so much as looks at
   * this field. `savedTools` is the only reader, and all it does is hand the
   * strings to whoever asked, to render.
   */
  tools?: ToolSource[];
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
    onPlane: rel(basic.onPlane),
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
    // `set` is journalled as the one call the user made, like every operation,
    // so replaying it re-runs the edit rather than the dimension it rebuilt.
    set: rel(set),
  }));
}

/**
 * The names a **version-3** file's relations had, mapped to the ones they get
 * now that dimensions are `d`-named.
 *
 * This is the whole cost of the rename, and it is worth being precise about
 * where it lands. Relation names are handed out *by order of creation*, so
 * re-prefixing does not merely rename things — it changes which relation a
 * given string picks out. Almost nothing in a saved journal holds one: a
 * relation entry records the geometry it constrains, not its own name. The
 * exception is `deleteRelation`, which is nothing but a name, and a v3 file
 * that deleted its second relation says `deleteRelation("r2")` where the
 * rebuilt model may now call that same relation `d1`.
 *
 * So the map is computed **from the replay itself** rather than by scanning the
 * journal. It has to be: `fillet` is one journal entry that creates four
 * relations, and a scan would have to know that — and would be wrong again the
 * next time an operation's expansion changed. Watching the registry fill up
 * instead is exact by construction, since the old scheme's `r1`, `r2`, … came
 * out in exactly this order.
 *
 * The `while` loop reproduces the one wrinkle in the old naming: `autoName`
 * skipped a name an *entity* had already taken, so a drawing with a point
 * explicitly called `r2` pushed its second relation to `r3`. Entity names are
 * untouched by any of this and the replay reaches this point having made the
 * same ones, so consulting the live entity map here gives the old answer
 * exactly.
 *
 * Version 4 files run through none of it — `active` is false and every entry
 * passes through untouched — but a v3 file with no deletions still runs the
 * bookkeeping, which costs a few string comparisons and keeps one code path
 * instead of two.
 */
function relationRenamer(model: Model, version: number) {
  const active = version < 4;
  const map = new Map<string, string>();
  const seen = new Set<string>();
  let oldN = 0;
  return {
    /** Called after every replayed step, to name whatever it created. */
    note(): void {
      if (!active) return;
      for (const name of model.relations.keys()) {
        if (seen.has(name)) continue;
        seen.add(name);
        let was: string;
        do { oldN += 1; was = `r${oldN}`; } while (model.entities.has(was));
        map.set(was, name);
      }
    },
    /** Called before every replayed step, to point a deletion at the right thing. */
    rewrite(entry: JournalEntry): JournalEntry {
      if (!active || entry.op !== "deleteRelation") return entry;
      const [was] = entry.args;
      const now = typeof was === "string" ? map.get(was) : undefined;
      // A name with no mapping is left alone so it fails at the primitive with
      // its own message. Rewriting it into something plausible would turn a
      // hand-edited file's typo into a deletion of whatever happened to be
      // there.
      return now === undefined ? entry : { op: entry.op, args: [now] };
    },
  };
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
 *
 * **`addFrame` from before version 5** names its frame third, where the name
 * is fourth now (see `VERSION`). Keyed on the file's version rather than on
 * how many arguments the entry happens to have, the way `relationRenamer` is:
 * a version-5 entry is written with all four, and one that turns up with three
 * is a hand edit that should fail at its own step — "a 2D frame takes no
 * y-ref" — rather than be guessed at.
 */
function translate(model: Model, entry: JournalEntry, version: number): JournalEntry {
  if (entry.op === "addFrame" && version < 5) {
    const [origin, xref, name] = entry.args;
    return { op: "addFrame", args: [origin ?? null, xref ?? null, null, name ?? null] };
  }
  if (entry.op !== "horizontal" && entry.op !== "vertical") return entry;
  const axis = entry.op === "horizontal" ? "x" : "y";
  const [a, b, c] = entry.args as (string | null | undefined)[];
  const pointForm = model.entities.get(String(a))?.kind === "point";
  const ref = `${model.resolveFrame(pointForm ? c : b)}.${axis}`;
  return { op: "parallel", args: pointForm ? [a, b, ref] : [a, ref] };
}

/**
 * The model as a plain object, ready for JSON.stringify.
 *
 * `tools` is a parameter rather than something read from a global because it
 * is not the model's — the model has never heard of the command line. It
 * defaults to none, which is what keeps the undo stack honest: `main.ts`
 * snapshots with `save(model, false)` and therefore never sees a tool source,
 * so defining a tool cannot register as an edit to the drawing.
 */
export function toSaved(model: Model, tools: readonly ToolSource[] = []): SavedModel {
  const points: Record<string, number[]> = {};
  const radii: Record<string, number> = {};
  for (const e of model.entities.values()) {
    if (e.kind === "point") points[e.name] = model.coords(e.name);
    else if (e.kind === "circle" || e.kind === "arc") radii[e.name] = model.radius(e.name);
  }
  const saved: SavedModel = {
    format: FORMAT,
    version: VERSION,
    dim: model.dim,
    journal: model.journal.map((e) => ({ op: e.op, args: e.args })),
    values: { points, radii },
  };
  // Absent, not empty: a file from a session that authored no tools is byte
  // for byte the file this app has always written.
  if (tools.length) saved.tools = tools.map((t) => ({ name: t.name, source: t.source }));
  return saved;
}

export function save(model: Model, pretty = true, tools: readonly ToolSource[] = []): string {
  return JSON.stringify(toSaved(model, tools), null, pretty ? 2 : 0);
}

/**
 * The tool sources a file carries, as text. **Reading, and nothing else** —
 * this is where the "a saved file is data" rule is kept for the one field that
 * looks like code: entries are validated for shape, copied into fresh objects,
 * and handed back as strings. No caller of this function evaluates them, and
 * the test suite says so with a source that would announce itself if it ran.
 *
 * Anything malformed is skipped rather than refused, because a tool source is
 * not load-bearing: a drawing whose `tools` array a hand edit mangled should
 * still open as a drawing.
 */
export function savedTools(saved: string | SavedModel): ToolSource[] {
  let parsed: unknown = saved;
  if (typeof saved === "string") {
    try {
      parsed = JSON.parse(saved);
    } catch {
      return []; // `open` has already reported the same file as unparseable
    }
  }
  const raw = (parsed as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(raw)) return [];
  const out: ToolSource[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const { name, source } = entry as { name?: unknown; source?: unknown };
    if (typeof name !== "string" || typeof source !== "string") continue;
    out.push({ name, source });
  }
  return out;
}

export function fromSaved(saved: SavedModel): Model {
  if (saved?.format !== FORMAT) throw new Error("not a neocad model");
  if (saved.version > VERSION) {
    throw new Error(`this file is version ${saved.version}, and this build only reads up to ${VERSION}`);
  }
  if (!Array.isArray(saved.journal)) throw new Error("model file has no journal");

  const model = new Model(saved.dim ?? 2);
  const table = replayTable(model);
  const renamer = relationRenamer(model, saved.version);

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
        step = translate(model, renamer.rewrite(entry), saved.version);
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
      // After the step, so the relations it created are named while the order
      // they came out in is still the order the old scheme would have used.
      renamer.note();
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
