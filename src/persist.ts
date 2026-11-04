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
import { isFullTurn } from "./relations/revolution.ts";
import { construction, extrude, featuresOnProfile, fillet, regen, revolve, set } from "./operations.ts";
import * as grouping from "./groups.ts";
import type { ToolSource } from "./toolsource.ts";
import { freshName, planeTranslation } from "./planetranslation.ts";

export const FORMAT = "neocad-model";
/**
 * 11 since **an extrude makes no lid frame** (docs/plans/no-lid-frame.md). It
 * made one "so a sketch on the cap has a plane", which sketch-on-face now
 * builds from the cap itself; a twin curve on the sketch frame names the sketch
 * frame, a translation turning nothing. Version 10's lid frame shared the
 * lid's corners where the sketch frame stood on the profile, but two
 * rectangles extruded at once share one sketch frame, and the second solid's
 * lid frame still laid three points on the first's lid corners — the owner's
 * *"i'm getting a lot of overlapping points"* again. No entry changed shape;
 * the expansion makes fewer points, so a version-10 build replaying a
 * version-11 extrude would hand out names every later entry disagrees with.
 * A revolve's end frames are unchanged: its end face is turned, and a curve on
 * it needs a turned frame.
 *
 * Going the other way **a version-10 file opens exactly as it was**:
 * `translate` writes `10` into every extrude from before 11 that carries no
 * expansion yet (a version-9 file's get `9`, as before), so its lid frame is
 * made again under the names the file's later entries hold, regenerates as it
 * did, and stays marked when the file is saved again. Kept rather than
 * migrated, for version 10's own reason below.
 *
 * 10 was **a frame a feature makes shares the feature's own points**
 * (docs/plans/lid-frame-shares-points.md). An extrude's lid frame, and a
 * partial revolve's end frames, used to make three points of their own; on a
 * frameless sketch, whose frame is three of the outline's corners, those
 * landed exactly on three lid corners — the owner's plate, 17 points with three
 * pairs on one spot each. Now a frame point over a profile vertex is that
 * vertex's twin. No entry changed shape: the call is the same, the code is
 * what changed. But the expansion makes fewer points, in a different order,
 * so a version-9 build replaying a version-10 extrude would hand out names
 * every later entry disagrees with — "this file is version 10" says what is
 * wrong.
 *
 * Going the other way **a version-9 file opens exactly as it was**: `translate`
 * writes `9` into every extrude and partial revolve from before 10 — the
 * expansion that build made (`Expansion` in operations.ts) — so its frames get
 * their own points again, under the names the file's later entries hold, and
 * the feature regenerates the old way too. The `9` stays in the entry when the
 * file is saved again, so the reopened file keeps meaning what it meant. Kept
 * rather than migrated: re-expanding an old extrude the new way would shift
 * every auto-name after it.
 *
 * 9 was **a feature regenerates when its profile is restructured**
 * (docs/plans/feature-regeneration.md): `fillet` now ends by bringing every
 * feature standing on either leg back into step with the rounded profile, and
 * when there was such a feature its entry carries a fifth argument — the
 * features it regenerated, each with its profile resolved — and there is a new
 * op, `regen`. The break is in `fillet`'s *meaning*: a version-8 build replaying
 * a version-9 fillet after an extrude would round the sketch and leave the lid
 * square, silently, and every name the regeneration made would be missing from
 * under the entries after it. "This file is version 9" says what is wrong.
 *
 * Going the other way **a version-8 file opens exactly as it was**: its
 * fillets regenerated nothing, so one whose leg a feature stood on is read as
 * a fillet that regenerated nothing — `translate` writes in the empty list,
 * which is what the build that saved it did. Otherwise the replay would make a
 * twin arc, two twin points and a wall under auto-names the file's later
 * entries may already hold — measured: a point drawn after the fillet fails at
 * its own step, `"p14" already exists` (test/regen.test.ts).
 *
 * 8 was **a feature's profile may carry portions** (regions split by a
 * crossing or a T — docs/plans/regions-split.md): an `extrude` or `revolve`
 * entry's loops, which were lists of member names, may now hold `{name, from,
 * to}` for the part of a member between two points, and name points the
 * expansion itself materialised at crossings (see `extrude` in
 * operations.ts). A bare name still means the whole member. This one *is* a
 * break, unlike the two notes at the bottom: an existing op's argument changed
 * shape, and a version-7 build handed the new shape would refuse it with "loops
 * are lists of member names" at the step — a riddle, where "this file is
 * version 8" says what is wrong. **A version-7 file reads exactly as it did**:
 * nothing in it can be a portion, and one that claims to be version 7 while
 * holding one is a hand edit, refused at its step rather than guessed at
 * (`translate`, keyed on the version as `addFrame`'s arity is).
 *
 * 7 was **circles and arcs carrying a plane** (3D phase 2): `addCircle(center,
 * radius, plane, name)`, `addArc(center, start, end, radius, plane, name)` and,
 * in 3D, `fillet(l1, l2, r, plane)` — the plane a frame's name in a 3D model
 * and null in a 2D one, sitting before the name as every constructor's
 * arguments do. A version-6 build would read the new `addCircle` entry's plane
 * as the circle's *name* — exactly the misreading the version is for. Older
 * files are translated on the way in, keyed on the version: in 2D the plane is
 * null and that is all; in 3D (a version-6 file, or a 2D file lifted) the
 * plane is *chosen* — nearest frame normal for an arc, the default for a
 * circle, a frame of the translation's own where none fits — by the rule
 * written out in planetranslation.ts.
 *
 * 6 was **the app becoming 3D** (3D phase 1, the camera half): it runs a `Model(3)`
 * and writes `dim: 3` files whose drawings have depth. Nothing in a version-6
 * journal would be *misparsed* by a version-5 build — every op and argument
 * shape was already there — but it would be misread all the same, which is
 * the break the version is for: a 2D-only build opens a 3D drawing as a 3D
 * model, draws it flattened onto its x–y shadow, and refuses every tool on it.
 * Better that it say "this file is version 6" than show a tilted sketch as a
 * squashed one with no hint that anything is missing.
 *
 * Going the other way, every older file is 2D, and so is any file of any
 * version that says `dim: 2`: opening one *into* a 3D model **lifts** it —
 * keyed on `dim`, not on the version, because a 2D file is 2D whoever wrote it
 * (see `lift2D`). The library still opens a file into its own dimension when
 * not asked otherwise; it is the app that asks for 3.
 *
 * 5 was frames gaining a y-ref for 3D: `addFrame`'s name moved from its third
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
 *
 * **Extrude did not bump it either** (3D phase 4). It adds two ops —
 * `extrude`, and `deleteFeature` for a feature's record — and changes the
 * meaning of none: no existing op's arguments moved, `values` is the same two
 * maps (a lid's twins are ordinary points, its rims ordinary radii), and the
 * feature registry is rebuilt by replay rather than saved. So an older file
 * opens here exactly as it did, and a newer file in an older build is refused
 * *at the step*, naming the op it does not know — not misread, which is the
 * break a version is for. The deletion ops set the precedent when they were
 * added the same way.
 *
 * **Nor did revolve** (3D phase 5), for the same reasons: one new op,
 * `revolve`, whose end face is ordinary points, curves and frames in `values`,
 * and whose surface is drawn, never saved.
 *
 * **Nor did groups and visibility** (docs/plans/groups.md): six new ops —
 * `group`, `addTo`, `removeFrom`, `ungroup`, `hide`, `show` — and no existing
 * op's arguments or meaning changed (a deletion's expansion may now carry a
 * `removeFrom` before its `deleteEntity`, which an older build refuses by name
 * at that step, as it refuses the rest). The registry and the hidden set are
 * rebuilt by replay, never saved.
 *
 * **Nor did construction geometry** (docs/plans/construction.md): one new op,
 * `construction`, journalled with the curves it flagged resolved; the flag is
 * on the entity and rebuilt by replay, never saved, so `values` is untouched
 * and an older build refuses the step by name.
 */
export const VERSION = 11;

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
    // A feature's record, as `del` journals it — see `delOne`. Added with
    // extrude, without a version bump, for the reason the two above were.
    deleteFeature: bound("deleteFeature"),

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
    // Journalled with its profile resolved (see `extrude`), so a replay walks
    // the loops it is handed and never looks for one among the seeds.
    extrude: rel(extrude),
    // The same, about an axis — and given its loops it asks no question about
    // positions either, so the geometric refusals the call made are not re-made
    // against seeds (see `revolve`).
    revolve: rel(revolve),
    // A feature brought back into step with its profile, journalled as the
    // call with what it found resolved (see `regen`), so a replay walks the
    // profiles it is handed and looks for nothing among the seeds. `fillet`'s
    // own regeneration rides in its entry, the same way.
    regen: rel(regen),
    // `set` is journalled as the one call the user made, like every operation,
    // so replaying it re-runs the edit rather than the dimension it rebuilt.
    set: rel(set),

    // Groups (see groups.ts). `group` and `addTo` are journalled with their
    // members resolved — the union as it was — and `removeFrom` is also what a
    // deletion's expansion writes for each group its name leaves.
    group: rel(grouping.group),
    addTo: rel(grouping.addTo),
    removeFrom: rel(grouping.removeFrom),
    ungroup: rel(grouping.ungroup),
    // Visibility is the document's: journalled as typed, and what a name stood
    // for at that step is what it stands for when the step is replayed.
    hide: rel(grouping.hide),
    show: rel(grouping.show),
    // Construction geometry (see operations.ts): journalled with the curves
    // it changed resolved, never the group or feature typed, so a replay flags
    // exactly the entities the call did.
    construction: rel(construction),
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
 * **An `extrude` from before version 11** made a lid frame, so it is given the
 * expansion that makes it again (see `VERSION`): `10` from a version-10 file,
 * whose lid frame stood on the lid's corners where it could, and `9` from
 * before that, whose lid frame had points all its own — as is a partial
 * `revolve` from before version 10, its end frames likewise. Every such entry,
 * not only the ones whose frame stood on the profile: a `regen` later in the
 * file can bring a sketch-frame point into the profile, and the expansions part
 * there too. A whole turn makes no frame and passes through untouched, and a
 * version-10 revolve is today's.
 *
 * **A `fillet` from before version 9** regenerated nothing, so one whose leg a
 * feature's profile names is given the empty list of regenerated features —
 * exactly what the build that wrote it did (see `VERSION`). Every other fillet
 * passes through untouched, so a file with none after a feature re-saves byte
 * for byte as it was, bar the version.
 *
 * **An `extrude` or `revolve` from before version 8** has a profile of whole
 * members, so one carrying a portion is refused at its step (see `VERSION`);
 * every other one passes through untouched.
 *
 * **`addFrame` from before version 5** names its frame third, where the name
 * is fourth now (see `VERSION`). Keyed on the file's version rather than on
 * how many arguments the entry happens to have, the way `relationRenamer` is:
 * a version-5 entry is written with all four, and one that turns up with three
 * is a hand edit that should fail at its own step — "a 2D frame takes no
 * y-ref" — rather than be guessed at.
 */
function translate(model: Model, entry: JournalEntry, version: number): JournalEntry {
  if (entry.op === "fillet" && version < 9 && entry.args.length <= 4) {
    const [l1, l2, r, plane] = entry.args;
    const legs = [l1, l2].filter((n): n is string => typeof n === "string");
    if (featuresOnProfile(model, legs).length) return { op: "fillet", args: [l1, l2, r, plane ?? null, []] };
  }
  if ((entry.op === "extrude" || entry.op === "revolve") && version < 8) {
    const loops = entry.args[entry.op === "extrude" ? 3 : 4];
    if (Array.isArray(loops) && loops.some((l) => Array.isArray(l) && l.some((m) => typeof m !== "string"))) {
      throw new Error(`a version-${version} file's profiles are whole members, named — a part of one ({name, from, to}) `
        + "is version 8's, so this entry was edited by hand");
    }
  }
  if (entry.op === "extrude" && version < 11 && entry.args.length === 4) {
    return { op: "extrude", args: [...entry.args, version < 10 ? 9 : 10] };
  }
  // A whole turn makes no frame, so it has no expansion to choose between.
  if (entry.op === "revolve" && version < 10 && entry.args.length === 5
      && !(typeof entry.args[2] === "number" && isFullTurn(entry.args[2]))) {
    return { op: "revolve", args: [...entry.args, 9] };
  }
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
 * What opening a 2D file into a 3D model does to it — **the lift**. Every
 * coordinate argument gains a zero, and every 2D frame gains the y-ref a 3D
 * frame cannot be without. Nothing else changes: the relation vocabulary was
 * written dimension-generically from the start (that is what `dot` and `wedge`
 * are for), so a `par`, a `tan` or a `dist` means in z = 0 of a 3D model
 * exactly what it meant in the 2D one.
 *
 *   `addPoint([x, y], n)`      → `addPoint([x, y, 0], n)` — the kernel's z = 0,
 *                                the plane the drawing always lived in;
 *   `setCoords(n, [x, y])`     → `setCoords(n, [x, y, 0])`;
 *   `fix(p, [x, y], f)`        → `fix(p, [x, y, 0], f)` — on the frame's plane;
 *   `addFrame(o, x, null, f)`  → `addPoint(seed, "f_y")` then
 *                                `addFrame(o, x, "f_y", f)`.
 *
 * The frame is the one that needs care, for two reasons. A 3D frame with no
 * y-ref given *creates* one, auto-named — and an auto-name claimed here, in the
 * middle of a replay, is a name some later entry of the file already holds for
 * something else, so the very next step would fail with "already exists". So
 * the lift names it outright, after its frame, choosing a name the file never
 * uses (see `freshName`). And a 2D frame's +y is +x turned a quarter turn, so
 * the y-ref belongs a quarter turn round from the x-ref in z = 0 — which only
 * the *saved* coordinates know, the replay running on seeds; so it is seeded
 * clear of the x axis here and put exactly in place after the saved values
 * are restored (see `fromSaved`). Seeded in the one spot that also leaves the
 * frame's own auto-created origin and x-ref, when the file had any, where the
 * 2D replay put them and under the names it gave them.
 *
 * Keyed on the file's `dim` and never on its version: version 4 and version 5
 * files are both 2D (the model half of 3D took version 5 without the app ever
 * writing a 3D file), and a 2D model saved by the library at version 6 is just
 * as 2D.
 */
function lift2D(model: Model, entry: JournalEntry, names: Set<string>, lifted: Map<string, string>): JournalEntry[] {
  const coords = (v: unknown) => (Array.isArray(v) && v.length === 2 ? [...v, 0] : v);
  const a = entry.args;
  switch (entry.op) {
    case "addPoint":
      return [{ op: "addPoint", args: [coords(a[0]), ...a.slice(1)] }];
    case "setCoords":
      return [{ op: "setCoords", args: [a[0], coords(a[1]), ...a.slice(2)] }];
    case "fix":
      return [{ op: "fix", args: [a[0], coords(a[1]), ...a.slice(2)] }];
    case "addFrame": {
      const [origin, xref, yref, name] = a as (string | null | undefined)[];
      if (yref != null) return [entry]; // a hand edit; let it fail at its own step
      const y = freshName(`${name ?? "frame"}_y`, names);
      names.add(y);
      lifted.set(name ?? "", y);
      const at = (n: string | null | undefined) => (n != null && model.entities.has(n) ? model.coords(n) : null);
      const o = at(origin), x = at(xref);
      // Clear of the x axis, and placed so a missing origin or x-ref is seeded
      // where the 2D replay seeded it: each is laid off along the kernel's x
      // from whichever of the three was given, exactly as `addFrame` does.
      const seed = o && x ? [o[0] - (x[1] - o[1]), o[1] + (x[0] - o[0]), 0]
        : o ? [o[0], o[1] + Model.FREE_SPAN, 0]
          : x ? [x[0], x[1] + Model.FREE_SPAN, 0]
            : [0, Model.FREE_SPAN, 0];
      return [
        { op: "addPoint", args: [seed, y] },
        { op: "addFrame", args: [origin ?? null, xref ?? null, y, name ?? null] },
      ];
    }
    default:
      return [entry];
  }
}

/** Every string anywhere in a journal's arguments — a superset of the names it uses. */
function namesIn(journal: JournalEntry[]): Set<string> {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") out.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  for (const e of journal) if (Array.isArray(e.args)) walk(e.args);
  return out;
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

/**
 * A model rebuilt from a saved file — in the file's own dimension, or `dim`
 * when given. The only conversion there is is 2D into 3D (see `lift2D`); the
 * app always asks for 3, and everything else asks for nothing and gets the
 * file's own.
 */
export function fromSaved(saved: SavedModel, dim?: number): Model {
  if (saved?.format !== FORMAT) throw new Error("not a neocad model");
  if (saved.version > VERSION) {
    throw new Error(`this file is version ${saved.version}, and this build only reads up to ${VERSION}`);
  }
  if (!Array.isArray(saved.journal)) throw new Error("model file has no journal");

  const fileDim = saved.dim ?? 2;
  const into = dim ?? fileDim;
  const lift = fileDim === 2 && into === 3;
  if (into !== fileDim && !lift) {
    throw new Error(`a ${fileDim}D file cannot open as a ${into}D model — only 2D files lift, into 3D`);
  }
  const model = new Model(into);
  const table = replayTable(model);
  const renamer = relationRenamer(model, saved.version);
  // For the lift: what the file calls things, so a y-ref it adds can be named
  // something the file never uses — and which frames got one, for the
  // after-restore step below.
  const taken = lift ? namesIn(saved.journal) : new Set<string>();
  const liftedFrames = new Map<string, string>();
  // For files from before circles and arcs carried a plane, and for any 2D
  // file lifted into 3D (whose circles never had one): see
  // planetranslation.ts. Passes everything else through.
  const planes = planeTranslation(model, saved.journal, saved.version, lift);

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
      let steps: JournalEntry[];
      try {
        const step = translate(model, renamer.rewrite(entry), saved.version);
        steps = lift ? lift2D(model, step, taken, liftedFrames) : [step];
      } catch (e) {
        throw where(e);
      }
      for (const lifted of steps) {
        // The plane is given per step, *after* the steps before it have run:
        // which frames exist, and where, is what it is chosen from.
        let given: JournalEntry[];
        try {
          given = planes.give(lifted);
        } catch (e) {
          throw where(e);
        }
        for (const step of given) {
          const fn = table.get(step.op);
          if (!fn) throw new Error(`step ${i + 1}: "${step.op}" is not something a model file may do`);
          try {
            fn(...step.args);
          } catch (e) {
            throw where(e);
          }
          replayed.push({ op: step.op, args: step.args });
        }
      }
      // After the step, so the relations it created are named while the order
      // they came out in is still the order the old scheme would have used.
      renamer.note();
    });
  });
  model.journal = replayed;

  // Put the saved solution back — see the note at the top about why. A lifted
  // file's coordinates gain their zero here too.
  const vals = saved.values ?? { points: {}, radii: {} };
  model.withoutRecording(() => {
    for (const [name, coords] of Object.entries(vals.points ?? {})) {
      const at = lift && Array.isArray(coords) && coords.length === 2 ? [...coords, 0] : coords;
      if (model.entities.get(name)?.kind === "point") model.setCoords(name, at);
    }
    // A lifted frame's y-ref, put exactly where the 2D frame's +y was: a
    // quarter turn counter-clockwise from its +x, in z = 0, measured from the
    // positions just restored. Only the plane and the side count (frameBasis
    // straightens the rest), so this makes the 3D frame's +y the 2D one's
    // exactly, and its +z the kernel's.
    for (const [frame, y] of liftedFrames) {
      const f = model.entities.get(frame);
      if (f?.kind !== "frame" || !model.entities.has(y)) continue;
      const o = model.coords(f.origin), x = model.coords(f.xref);
      model.setCoords(y, [o[0] - (x[1] - o[1]), o[1] + (x[0] - o[0]), o[2]]);
    }
  });
  // Arcs from before version 7 have their planes chosen from the geometry just
  // restored, and any frame the translation made goes where its curve is.
  planes.settle();
  for (const [name, r] of Object.entries(vals.radii ?? {})) {
    const e = model.entities.get(name);
    if (e && (e.kind === "circle" || e.kind === "arc")) model.problem.setVar(e.radiusVar, r);
  }

  return model;
}

/** Opens a saved file — into `dim` dimensions when given (see `fromSaved`). */
export function open(json: string, dim?: number): Model {
  let parsed: SavedModel;
  try {
    parsed = JSON.parse(json) as SavedModel;
  } catch (e) {
    throw new Error(`not valid JSON: ${e instanceof Error ? e.message : e}`);
  }
  return fromSaved(parsed, dim);
}
