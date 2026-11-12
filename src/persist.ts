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

import { Model, ORIGIN, endRelation, memberName, parsePointTriple, type JournalEntry } from "./model.ts";
import { framePlaneAxes } from "./curveplane.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";
import { measure } from "./relations/measure.ts";
import { faceRef } from "./relations/solidref.ts";
import { isFullTurn } from "./relations/revolution.ts";
import { construction, extrude, featuresOnProfile, fillet, hole, regen, revolve, set, setEnd, unhole } from "./operations.ts";
import * as grouping from "./groups.ts";
import type { ToolSource } from "./toolsource.ts";
import { freshName, planeTranslation } from "./planetranslation.ts";
import { regionTranslation, type Ran } from "./regiontranslation.ts";
import { DEFAULT_WORKBENCH, getModule, loadedModules, moduleHash, replayEntries } from "./modules.ts";
// The app's vocabulary, so a file opens wherever persist.ts is imported — a
// test included — with the modules every start loads (modules/builtin.ts).
import "./modules/builtin.ts";

export const FORMAT = "neocad-model";
/**
 * 15 since **the ellipse** (docs/plans/sketch-shapes.md): a new entity kind,
 * `addEllipse(center, major, minor, normal, name)`, its relations
 * `onEllipse`, `majorAxis` and `minorAxis` (and `tangent` and `concentric`
 * taking one), and `values.minors` — each ellipse's minor semi-axis, keyed by
 * name, as `radii` keys a circle's radius — with its normal in `normals`
 * beside the circles'. The precedent below would have added the ops without a
 * bump, since an older build refuses `addEllipse` by name at its step; the
 * plan asked for one, and it is the honest thing for a file whose `values`
 * carry a map an older build would silently drop. A version-14 build opening a
 * version-15 file says "this file is version 15" instead of failing at the
 * first ellipse.
 *
 * Going the other way **a version-14 file opens exactly as it was**: nothing
 * in it is an ellipse, no op it uses changed meaning, and nothing is
 * translated. `test/shapes.test.ts` opens one.
 *
 * 14 was **an extrude or revolve says what it does to a body**
 * (docs/plans/solids-kernel.md): every new `extrude` and `revolve` entry ends
 * in its options, resolved — `{ mode: "add", into: "e1" }`, `{ mode: "cut",
 * into: "e1" }`, `{ mode: "new" }` — written even when the call typed none,
 * because the default is decided by where the solid stood when it was made
 * and a replay must not decide it again from seeds. A version-13 build
 * replaying a version-14 file would read the options as an old expansion and
 * refuse the step, which is the misreading a version is for.
 *
 * Going the other way **a version-13 file opens to the same solids**: its
 * entries carry no options, and an entry with none is a body of its own — as
 * every feature then was, two overlapping extrudes overlapping rather than
 * joining. Nothing is translated or written in; a feature from such a file
 * shows as "new" and draws as it always did (its single-feature body is drawn
 * from its live geometry, faces.ts, exactly as before the kernel shipped).
 * `test/solidsoldfiles.test.ts` opens every fixture and holds it to that.
 *
 * 13 was **a circle or arc carries its own normal** (docs/plans/
 * frameless-curves.md). `addCircle(center, radius, normal, name)` and
 * `addArc(center, start, end, radius, normal, name)` take three numbers — a
 * seed — where they named a frame, and a 3D `fillet`'s fourth argument is the
 * side its arc's normal is on, three numbers, where it was a frame too; a
 * today's partial `revolve` makes no end frames (expansion 11); and two ops are
 * new, `setNormal` and `setWorkPlane`. A version-12 build replaying a
 * version-13 file would read a normal as a frame's name and refuse it, which
 * is the misreading a version is for. The saved values gain `normals`.
 *
 * Going the other way **a version-12 file opens as it was**: a curve recorded
 * with a frame gets its normal from that frame — the frame's +z at its step as
 * the seed, and from the restored positions once they are back — **and an
 * ordinary `par(curve, "f.z")`**, so it still follows the frame. The pars are
 * written in **at the end of the replay**, not beside the curves: relations
 * are named by order, and a relation written in at a curve's step would push
 * every later `r` along, under the `deleteRelation("r5")`s and groups the
 * file's later entries hold. At the end they take names nothing in the file
 * uses, and a curve or frame the file deleted on the way gets none. A frame a
 * feature made (an auto-made sketch frame, an old lid or end frame) is kept: it
 * is real now, and other things may be constrained to it. A partial revolve
 * from before 13 is given its expansion, `10` (or `9`, before 10), and — where
 * its profile's curves stood on frames besides its sketch frame — the list of
 * frames it turned, read from the frames those curves named, which nothing
 * else now remembers. A whole turn passes through.
 *
 * 12 was **a group may be empty** (docs/plans/organiser.md). A group made to
 * be drawn into starts with nothing, so a group whose last member leaves — by
 * `removeFrom`, or by a deletion's cascade, which writes a `removeFrom` for
 * each group the name leaves — now stays, where version 11's went silently
 * with it. No entry changed shape; what changed is what an emptying
 * `removeFrom` *means*. A version-11 build replaying a version-12 file whose
 * group was emptied and then filled again, or opened, would say `"g1" is not a
 * group` at a step that names a group the file plainly has — the misreading a
 * version is for. Three new ops come with it — `opengroup`, `closegroup`,
 * `rename` — which alone would not have bumped it (an older build refuses them
 * by name, the groups precedent below), and `group()` with no names, which an
 * older build refuses at its step.
 *
 * Going the other way **a version-11 file opens exactly as it was**: each
 * `removeFrom` that empties a group is followed, on the way in, by the
 * `ungroup` that build did without saying (`fromSaved`) — so a later entry
 * that reused the name, a `group(…, { name: "g1" })` or an entity explicitly
 * called that, finds it free, as it did. Translated rather than marked, unlike
 * an old extrude's expansion: an `ungroup` makes no names, so writing it in
 * shifts nothing after it, and the re-saved file says in today's vocabulary
 * what the old one meant. The repository's own files — the fixtures, the
 * goldens — carry no group at all; only a file saved by the groups build
 * (2026-11-03) and then edited so could have relied on it.
 *
 * 11 was **an extrude makes no lid frame** (docs/plans/no-lid-frame.md). It
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
 *
 * **Nor did explicit regions** (docs/plans/explicit-regions.md): two new ops,
 * `hole` and `unhole`, journalled with what they rebuilt resolved. What changed
 * is how a *live* `regen` or `fillet` finds a profile — the recorded holes by
 * their members, never every loop inside — and a file never re-finds one: its
 * `extrude`, `regen` and `fillet` entries all carry the loops they were built
 * with, so an older file replays to exactly the solids it was saved with
 * (`test/explicitregions.test.ts` opens one written by the build before).
 */
export const VERSION = 23;
// 23 (docs/plans/through-all-relation.md): **through all is a relation, and an
// end is journalled with what it resolved to.** (22 is the fillets package's,
// built beside this one; a file of either is read here.) An extrude that ends
// through all holds its lid by `onplane(<far vertex>, "e2.lid")`, named
// `e2_through`, and one that ends up to a face by `onplane(<lid point>,
// "e1:l2")`, `e2_upto`. Neither relation has an entry of its own: the entry
// that set the end makes it, and **carries which** — `extrude(…, { end:
// "through", to: "p7" })`, `setEnd("e2", "through", "p7")`; a depth in `to`
// where the far side has no vertex and the lid is placed; `null` where
// nothing was met; `{ end: "upto", face: "e1:l2" }`; a `regen`'s or
// `fillet`'s regenerated list may hold `[feature, [], "end", to]` for an end
// it chose again; and `setEnd("e2", "blind", -10)` is what deleting
// `e2_through` journals. Resolved for `extrude`'s own reason — a replay runs
// on seeds, and the far side cannot be found among seeds. A version-21 build
// would refuse the options by name (`extrude has no option "to"`), which
// alone would not bump it; but it would also read `setEnd("e2", "through",
// "p7")` as the old through all — a lid a tenth past whatever was made
// before, held by no relation — and a later `deleteRelation("e2_through")`
// would name nothing: the misreading a version is for.
//
// Going the other way **a file of 22 or before opens to the same solid**:
// its `{ end: "through" }` carries no `to`, so the extrude replays as it did
// and holds nothing yet; once the saved values are back — the drawing as it
// was solved, not seeds — each such end's far side is found once and written
// at the journal's end as the `setEnd` it is (`fromSaved`, last). So the file
// re-saves in the new form and reopens without searching. The lid moves from
// a tenth past the far face to on it; the body cut is the same, since a
// through cut's tool is built past its lid now (solids.ts, `extrudeSpan`).
// test/throughrelation.test.ts opens a file the build before wrote and holds
// it to that, by volume.
// 21 (docs/plans/linked-profiles.md): **an extrude's two profiles are linked,
// and a feature owns nothing**. No entry changed shape, and none is added for
// a twin: the relations within a profile each gain a twin on the other
// profile when the entry that made them — or the extrude — is replayed, under
// a name derived from its partner's (`r3_e1`), which claims no counter. What
// changed is what the deletion entries *mean*. `deleteRelation("r3")` takes a
// linked pair as one. A deleted extrude's expansion is `deleteFeature`, then
// `deleteRelation` of its extrusion and its perpendicular, and **no
// `deleteEntity`**: the lid and the walls stay. An entity deleted from a
// profile is preceded by `unsweep` (a new op: the extrude stops sweeping it,
// and stays, open) and its partner's `deleteEntity` follows its own; a point
// held on a face of a record going is preceded by `rehold` (a new op). A
// version-20 build replaying a 21 file would refuse `unsweep` by name, which
// alone would not bump it; but it would also replay `deleteRelation("r3_e1")`
// or `set("d2_e1.value", …)` against a model with no such name, and read a
// deleted extrude's journal as one that left its lid behind by accident —
// the misreading a version is for.
//
// Going the other way **a file of 20 or before opens to the model it was, and
// is linked from then on**: every extrude that still stands replays into
// linked profiles (its relations twinned, names kept —
// `test/linkedprofiles.test.ts` opens a fixture a build before wrote). Its
// *deletions* mean what they meant: a `deleteFeature` from before 21 was
// followed by the lid's own deletions, or left the lid standing with no
// relations of its own, so `translate` writes `"unlinked"` into it — the twins
// this build made across that extrude go with the record, and its extrusion,
// where the file left it standing, links nothing again
// (`Model.deleteFeature`). The mark stays in the entry when the file is saved
// again, so it keeps meaning that.
// 20 (docs/plans/review-relations.md): **a relation may hold among many, and
// a solid's wall is written by the entity it is swept from.** Two changes to
// what an existing op's arguments are, which is what a version is for:
//
// - `parallel`, `equalLength`, `collinear`, `coincident`, `concentric`,
//   `coradial` and `equalRadius` may carry more than two members —
//   `parallel ["l1", "l2", "l3", "l4"]`, one relation among the four
//   (relations/among.ts); points level with each other end in the direction,
//   `parallel ["p1", "p2", "p3", "origin.x"]`. Two ops are new: `join` and
//   `leave` (among.ts), a relation's members changed in place — a deletion's
//   expansion writes a `leave` ahead of the `deleteEntity` of a member whose
//   relation stays over the rest. A version-19 build would refuse such a file
//   at its first set, by arity ("this takes two references, not three"), which
//   is a riddle where "this file is version 20" says what is wrong.
// - a wall in `onPlane`, `faceDistance`, `parallel`, `perpendicular` and
//   `measure` is `"e1:l2"`, the wall of `e1` swept from `l2`, where it was
//   `"e1.m3"`, the wall in place 3 of the profile. A version-19 build reads
//   `"e1:l2"` as an entity's name and says there is no such thing.
//
// Going the other way **a file of 19 or before opens to the relations it
// had**, name for name. Its many-at-once stars — `parallel ["l1", "l2"]`,
// `["l1", "l3"]`, `["l1", "l4"]` — replay as the separate relations they were:
// a replay never joins (only a typed relation does, and it journals the
// `join`), so nothing is migrated and the entries re-save as they are. Its
// walls are **rewritten at their own step** (`writtenFaces`): `"e1.m3"`
// becomes the entity in place 3 of the profile as it stood when the relation
// was made, which is the wall the relation was put on; a file in which a later
// fillet had moved every wall up a place — and with it what the old build
// held the relation to — therefore reopens holding the wall it was made on.
// That is a deliberate change of what such a file means, to what its author
// meant, and test/reviewrelations.test.ts holds a file of each kind, saved by
// the build before. Caps, kernel-only faces (`e3.f0`) and the kernel's edge
// names (`e1.lid|e1.m0`, a blend's edges and a driven `length`) are as they
// were. One relation is new without changing any, `cornerAngle`.
// 19 (docs/plans/profiles-held.md): **an offset's copy is held in its chain's
// plane, both ways**. In 3D, where no sketch plane holds the chain, `offset`'s
// resolved part carries `flat` — three of the chain's points, or none — and
// the expansion holds the copy by relations between it and the chain: a
// `coplanar` (a new relation, the point in the plane of three others, all four
// moving) on one vertex of each run nothing else puts there, and a `par` from
// each round copy nothing else turns to its original. A version-18 build
// replaying a 19 offset would ignore `flat` and make none of them, handing
// every later relation a name the file's later entries disagree with — the
// misreading a version is for. Going the other way **a version-18 file opens
// exactly as it was**: its offsets carry no `flat`, and an offset without one
// makes what it always made (its copy free to slide off along the normal, which
// is written down in TODO.md rather than changed under old files' names). A
// 2D offset, or one on a sketch plane, writes no `flat`, and its entry is the
// same as at 18. The revolve's and the circular pattern's holds changed no
// entry: they are rows of relations the entries already made (and a circular
// pattern's plane, always journalled, may now name three of its seed's points).
// **Nor did trim everything** (docs/plans/trim-everything.md): two new ops,
// `addEllipticArc` and `addBSpline` (the kinds a trim leaves, made inside the
// trim's own entry and journalled as themselves only when typed), and `trim`'s
// resolved part may carry a third element, the spline pieces it made. An older
// build refuses such a trim at its step by name — it refused an ellipse's or a
// spline's trim outright — and misreads nothing; an elliptical arc's minor and
// normal ride the maps an ellipse's always did.
// 18 (docs/plans/spline.md): **the spline**. A new entity kind,
// `addSpline(points, closed, name)` — the entity and the interpolation it
// owns, replayed together from that one entry — the relation `onSpline`, and
// `tangent` taking a spline with the end it holds (`tan("l1", "sp1", "end")`).
// Two value maps come with it, each absent from a file that has none:
// `values.splines`, each spline's solved control points (flat, as the entity
// holds them), and `values.params`, the variables a relation made for itself
// (`Model.relationVar`), keyed by the relation's name — an `onspline` point's
// place along its curve, which is a choice among the curve's branches that a
// fresh solve from seeds need not make again. The format's own precedent would
// have added the ops without a bump (an older build refuses `addSpline` by
// name at its step), but `params` is a map an older build would silently drop,
// as `minors` was for 15. A version-17 file opens exactly as it was: nothing
// in it is a spline, and no op it uses changed meaning.
// 17 (docs/plans/regions-as-operations.md): **regions**. A feature stands on a
// named region made by operations — `region`, `subtract`, `add`, `intersect`,
// and `deleteRegionSteps`/`deleteRegion` in a deletion's expansion — and a
// feature entry names its region (`extrude("rg1", 10, "f1", loops)`). A file
// of 16 or before is opened into that (regiontranslation.ts): each feature's
// outline a region, each of its holes a `subtract` (an island an `add`), each
// old `hole`/`unhole` the step it meant — every entry still carrying the
// profiles it rebuilt, so the model is the same, entity for entity, and only
// the vocabulary is new. A build of 16 refuses a 17 file at its first `region`
// step by name, rather than misreading a feature on a name it cannot find.
// 16 (docs/plans/workbenches.md): the head may carry `workbench` and `modules`
// — the workbench the document was in, and the modules not shipped with the
// app that its journal needs. No op or value changed meaning: a file of 15 or
// before opens exactly as it did, and a 16 file that names no added module and
// stayed in `part` differs from a 15 file only in its version number.

export interface SavedModel {
  format: typeof FORMAT;
  version: number;
  dim: number;
  journal: JournalEntry[];
  /** Solved coordinates, keyed by point name; radii keyed by circle/arc name. */
  values: {
    points: Record<string, number[]>;
    radii: Record<string, number>;
    /**
     * Solved normals, keyed by circle/arc name — a 3D model's curves only
     * (format 13). Absent in a file that has none, and in every older file,
     * whose curves take theirs from the frames they named.
     */
    normals?: Record<string, number[]>;
    /** Solved minor semi-axes, keyed by ellipse name (format 15). Absent in a file that has none. */
    minors?: Record<string, number>;
    /** Solved control points, keyed by spline name, flat as `SplineEntity.ctrl` (format 18). Absent in a file that has none. */
    splines?: Record<string, number[]>;
    /** A relation's own variables, keyed by relation name — an `onspline` point's parameter (format 18). Absent in a file that has none. */
    params?: Record<string, number[]>;
  };
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
  /**
   * The workbench the document was last in (docs/plans/workbenches.md, format
   * 16) — the head's, not the journal's: switching is no edit to the drawing.
   * Absent for the default (`part`), so a file that never left it is the file
   * this app has always written but for its version.
   */
  workbench?: string;
  /**
   * The modules the journal needs that the app does not ship — a workbench
   * file's, or one defined at the command line — by name, the hash of their
   * source, and the ops of theirs the journal uses, so a device without one
   * can say which is missing and replay everything else. Absent when none.
   */
  modules?: SavedModuleUse[];
}

/** A module a document needs, as its head records it. */
export interface SavedModuleUse { name: string; hash: string; ops: string[] }

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
 *
 * Not here, on purpose: the document's commands — `newFile`, `openFile`,
 * `saveFile`, `shareFile` (docs/plans/files.md) — and `download`. They act
 * on the document, never in it, and journal nothing, so a file has nothing
 * of theirs to replay.
 *
 * **Filled from the loaded modules** (modules.ts), in module order: each module
 * brings the ops its entity kinds, relations and operations are journalled as,
 * and core brings the model's own structural edits. Still a fixed list for any
 * one session — what was loaded — so a file is still data: it can only name a
 * call some module registered. `horizontal`/`vertical` (v2) are not here: they
 * are rewritten into `parallel` before the lookup happens (see `translate`).
 */
function replayTable(model: Model): Map<string, (...args: unknown[]) => unknown> {
  return new Map<string, (...args: unknown[]) => unknown>(replayEntries(model));
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
  // A record deleted before linked profiles (see `VERSION`, 21): its lid had
  // no relations of its own, and the entries after it are written for that.
  if (entry.op === "deleteFeature" && version < 21 && entry.args.length === 1) {
    return { op: "deleteFeature", args: [entry.args[0], "unlinked"] };
  }
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

/** The relations that take a solid's face by name — the ops a file from before version 20 may hold a wall's *place* in. */
const FACE_OPS: ReadonlySet<string> = new Set(["onPlane", "faceDistance", "parallel", "perpendicular", "measure"]);

/**
 * **A wall written by its place, before version 20** (`"e1.m3"`), rewritten
 * to the entity in that place **at this step** (`"e1:l4"`) — in place, in the
 * entry the journal installs, so the file re-saves in today's form
 * (docs/plans/review-relations.md; see `VERSION`). At this step and not
 * later: the profile is as it was when the relation was made, so the wall
 * found is the one the relation was put on, whatever a later fillet did to
 * the order. Caps (`e1.lid`), kernel-only faces (`e3.f0`) and an edge's two
 * faces (`e1.lid|e1.m0`) are themselves and pass through.
 */
function writtenFaces(model: Model, step: JournalEntry, version: number): void {
  if (version >= 20 || !FACE_OPS.has(step.op)) return;
  step.args.forEach((a, i) => {
    if (typeof a === "string") step.args[i] = faceRef(model, a);
  });
}

/**
 * The group an old file's `removeFrom` just emptied — which a build before
 * version 12 removed with its last member — or null. See `VERSION`.
 */
function emptiedBefore12(model: Model, step: JournalEntry, version: number): string | null {
  if (version >= 12 || step.op !== "removeFrom") return null;
  const g = step.args[0];
  return typeof g === "string" && model.groups.get(g)?.members.length === 0 ? g : null;
}

/** Every string anywhere in a journal's arguments — a superset of the names it uses. */
/**
 * A file from before the origin (format 13) may already call something
 * `origin` — a point typed `pt(0, 0, 0, "origin")` is the obvious one — and the
 * name is the built-in frame's now, which `Model.has` refuses to anything
 * else. Refusing the file would be the worst answer, and reading the old
 * `origin` as the new one would quietly give it another meaning. So the
 * file's own is renamed everywhere the file says it — as a name, as
 * `"origin.x"`, inside `"p1.origin.p3"` — to the first name the file does not
 * use (`origin2`, …), and re-saves so. Only for files older than 13, which
 * cannot have meant the built-in, and only into a model that has one.
 */
function renameOldOrigin(saved: SavedModel, model: Model): SavedModel {
  if (saved.version >= 13 || !model.isFrame(ORIGIN)) return saved;
  const names = namesIn(saved.journal);
  const mentions = (s: string) => s === ORIGIN || s.startsWith(`${ORIGIN}.`) || (parsePointTriple(s)?.includes(ORIGIN) ?? false);
  if (![...names].some(mentions)) return saved;
  const fresh = freshName(`${ORIGIN}2`, names);
  const one = (s: string): string => {
    if (s === ORIGIN) return fresh;
    const triple = parsePointTriple(s);
    if (triple?.includes(ORIGIN)) return triple.map((p) => (p === ORIGIN ? fresh : p)).join(".");
    return s.startsWith(`${ORIGIN}.`) ? fresh + s.slice(ORIGIN.length) : s;
  };
  const walk = (v: unknown): unknown => (typeof v === "string" ? one(v) : Array.isArray(v) ? v.map(walk) : v);
  const keyed = <T>(r: Record<string, T> | undefined): Record<string, T> | undefined =>
    r === undefined ? undefined : Object.fromEntries(Object.entries(r).map(([k, x]) => [one(k), x]));
  const values = saved.values;
  return {
    ...saved,
    journal: saved.journal.map((e) => (Array.isArray(e.args) ? { ...e, args: walk(e.args) as unknown[] } : e)),
    values: values && {
      ...values,
      points: keyed(values.points)!,
      radii: keyed(values.radii)!,
      ...(values.normals ? { normals: keyed(values.normals) } : {}),
    },
  };
}

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
export function toSaved(model: Model, tools: readonly ToolSource[] = [], head: SavedHead = {}): SavedModel {
  const points: Record<string, number[]> = {};
  const radii: Record<string, number> = {};
  const normals: Record<string, number[]> = {};
  const minors: Record<string, number> = {};
  const splines: Record<string, number[]> = {};
  for (const e of model.entities.values()) {
    if (e.kind === "point") points[e.name] = model.coords(e.name);
    else if (e.kind === "spline") splines[e.name] = e.ctrl.map((i) => model.problem.getVar(i));
    else if (e.kind === "ellipse" || e.kind === "earc") {
      minors[e.name] = model.problem.getVar(e.minorVar);
      if (e.normal) normals[e.name] = e.normal.map((i) => model.problem.getVar(i));
    }
    else if (e.kind === "circle" || e.kind === "arc") {
      radii[e.name] = model.radius(e.name);
      // The variables as they are, not normalised: their length is a gauge
      // nothing reads, and saving it exactly is what reopens the same solve.
      if (e.normal) normals[e.name] = e.normal.map((i) => model.problem.getVar(i));
    }
  }
  const saved: SavedModel = {
    format: FORMAT,
    version: VERSION,
    dim: model.dim,
    journal: model.journal.map((e) => ({ op: e.op, args: e.args })),
    // Absent where there are none, so a 2D file's values are the two maps they always were.
    values: Object.keys(normals).length ? { points, radii, normals } : { points, radii },
  };
  if (Object.keys(minors).length) saved.values.minors = minors;
  if (Object.keys(splines).length) saved.values.splines = splines;
  const params: Record<string, number[]> = {};
  for (const r of model.relations.values()) if (r.vars?.length) params[r.name] = r.vars.map((i) => model.problem.getVar(i));
  if (Object.keys(params).length) saved.values.params = params;
  // Absent, not empty: a file from a session that authored no tools is byte
  // for byte the file this app has always written.
  if (tools.length) saved.tools = tools.map((t) => ({ name: t.name, source: t.source }));
  if (head.workbench && head.workbench !== DEFAULT_WORKBENCH) saved.workbench = head.workbench;
  const used = modulesUsed(model.journal);
  if (used.length) saved.modules = used;
  return saved;
}

/**
 * What a document's head says beyond its journal: the workbench it is in. A
 * *parameter*, as `tools` is, so the undo snapshot (`save(model, false)`)
 * never sees it — switching workbench is no edit to the drawing.
 */
export interface SavedHead { workbench?: string }

/**
 * The modules a journal needs that the app does not ship, read off the ops it
 * uses: every loaded module that is not built in and registered one of them.
 * Derived at save time, so it is never stale and never stored anywhere else.
 */
export function modulesUsed(journal: readonly JournalEntry[]): SavedModuleUse[] {
  const ops = new Set(journal.map((e) => e.op));
  return loadedModules()
    .filter((m) => m.origin !== "builtin")
    .map((m) => ({ name: m.name, hash: moduleHash(m), ops: m.ops.filter((op) => ops.has(op)) }))
    .filter((m) => m.ops.length > 0);
}

export function save(model: Model, pretty = true, tools: readonly ToolSource[] = [], head: SavedHead = {}): string {
  return JSON.stringify(toSaved(model, tools, head), null, pretty ? 2 : 0);
}

/** A saved file's head, read as data: its workbench, and the modules it needs that are not loaded here. */
export function savedHead(saved: string | SavedModel): { workbench: string | null; missing: SavedModuleUse[] } {
  let parsed: unknown = saved;
  if (typeof saved === "string") {
    try { parsed = JSON.parse(saved); } catch { return { workbench: null, missing: [] }; }
  }
  const p = parsed as { workbench?: unknown; modules?: unknown } | null;
  const workbench = typeof p?.workbench === "string" ? p.workbench : null;
  return { workbench, missing: neededModules(p?.modules).filter((m) => !getModule(m.name)) };
}

/** The `modules` a head lists, shape-checked and copied; anything malformed is skipped. */
function neededModules(raw: unknown): SavedModuleUse[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedModuleUse[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const { name, hash, ops } = m as { name?: unknown; hash?: unknown; ops?: unknown };
    if (typeof name !== "string" || !Array.isArray(ops)) continue;
    out.push({ name, hash: typeof hash === "string" ? hash : "", ops: ops.filter((o): o is string => typeof o === "string") });
  }
  return out;
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
 * The translation of a file from before **curves carried their own normal**
 * (format 13, docs/plans/frameless-curves.md) — every 3D file, and every 2D
 * file lifted, once planetranslation.ts has given its curves the frames a
 * version-7-to-12 file names. Passes everything through for a 3D file of 13 or
 * after, and for a 2D model, whose curves never named a frame.
 *
 * - `give` rewrites a step **in place** before it runs — in place, because
 *   planetranslation.ts holds the very entry it gave, and settles an old arc's
 *   frame and ends in it after the values are back: a curve's frame becomes
 *   its +z at this step, as the curve's normal seed, and is remembered in
 *   `following`; a 3D fillet's frame likewise becomes the side its arc faces;
 *   a partial revolve gets the expansion it was made by and, where it turned
 *   more frames than its sketch frame, the list of them (`sweptFrames` in
 *   operations.ts), read from the frames its curves named.
 * - `made` hears what a step returned: the fillet's arc, which follows the
 *   fillet's frame; and the twins an old extrude or revolve made, whose frames
 *   a later revolve of them would have turned.
 * - `settle`, once every value is back, turns each curve to its frame's +z as
 *   the positions now put it and writes in `par(curve, "f.z")`, at the end —
 *   new names, under nothing the file's later entries hold. A curve or frame
 *   the file deleted on the way gets none.
 */
function framelessCurves(model: Model, version: number, lift: boolean, following: Map<string, string>) {
  // A 2D file lifted into 3D of any version, too: planetranslation.ts gives
  // its curves a frame — the origin, for a drawing that has none of its own.
  const active = (version < 13 || lift) && model.dim === 3;
  /** Old twin curves' frames: only ever asked by a later old revolve's turned-frame list. */
  const twinFrames = new Map<string, string>();
  let filletFrame: string | null = null;
  const plusZ = (frame: string): number[] => {
    if (!model.isFrame(frame)) throw new Error(`"${frame}" is not a frame`);
    return framePlaneAxes(model, frame)?.n ?? [0, 0, 1];
  };
  const legacyOf = (curve: string) => following.get(curve) ?? twinFrames.get(curve);
  return {
    give(step: JournalEntry): void {
      if (!active) return;
      const a = step.args;
      if (step.op === "addCircle" && typeof a[2] === "string") {
        following.set(String(a[3]), a[2]);
        a[2] = plusZ(a[2]);
      } else if (step.op === "addArc" && typeof a[4] === "string") {
        following.set(String(a[5]), a[4]);
        a[4] = plusZ(a[4]);
      } else if (step.op === "fillet" && typeof a[3] === "string") {
        filletFrame = a[3];
        a[3] = plusZ(a[3]);
      } else if (step.op === "revolve" && !(typeof a[2] === "number" && isFullTurn(a[2]))) {
        // A partial revolve: the expansion its build made, unless an earlier
        // translation wrote one in (9, before format 10) — and the frames it
        // turned, its sketch frame and each other frame a profile curve named.
        if (a.length === 5) a.push(10);
        const frame = a[3];
        const loops = a[4];
        if (typeof frame !== "string" || !Array.isArray(loops)) return;
        const swept = [frame];
        for (const loop of loops) {
          if (!Array.isArray(loop)) continue;
          for (const m of loop) {
            const n = typeof m === "string" ? m : (m as { name?: unknown })?.name;
            const f = typeof n === "string" ? legacyOf(n) : undefined;
            if (f !== undefined && !swept.includes(f)) swept.push(f);
          }
        }
        if (swept.length > 1 && a.length === 6) a.push(swept);
      }
    },
    made(step: JournalEntry, result: unknown): void {
      if (!active) return;
      if (step.op === "fillet" && filletFrame !== null && typeof result === "string") following.set(result, filletFrame);
      filletFrame = null;
      if ((step.op === "extrude" || step.op === "revolve") && typeof result === "string" && model.features.has(result)) {
        // Before 13 a twin curve named its base's frame — or, on an old lid,
        // the lid frame for a base on the sketch frame, and on an end face the
        // end frame for the sketch frame: what a later revolve of it turned.
        const f = model.featureOf(result);
        const lid = f.kind === "extrude" ? f.top : f.end ?? undefined;
        f.loops.forEach((loop, i) => loop.forEach((m, j) => {
          const twin = f.twins[i]?.[j];
          const base = legacyOf(memberName(m));
          if (twin === undefined || base === undefined) return;
          twinFrames.set(twin, lid !== undefined && base === f.frame ? lid : base);
        }));
      }
    },
    settle(): void {
      if (!active) return;
      const pairs = [...following].filter(([c, f]) => {
        const e = model.entities.get(c);
        return (e?.kind === "circle" || e?.kind === "arc") && model.isFrame(f);
      });
      model.withoutRecording(() => {
        for (const [c, f] of pairs) model.setNormal(c, plusZ(f));
      });
      for (const [c, f] of pairs) geom.parallel(model, c, `${f}.z`);
    },
  };
}

/**
 * A model rebuilt from a saved file — in the file's own dimension, or `dim`
 * when given. The only conversion there is is 2D into 3D (see `lift2D`); the
 * app always asks for 3, and everything else asks for nothing and gets the
 * file's own.
 */
export function fromSaved(saved: SavedModel, dim?: number, how: { regions?: boolean } = {}): Model {
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
  saved = renameOldOrigin(saved, model);
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
  // For files from before curves carried their own normal (format 13): which
  // frame each curve was recorded with, so it can be given its normal and its
  // `par` once the replay is done (see `VERSION`).
  const following = new Map<string, string>();
  const planes = planeTranslation(model, saved.journal, saved.version, lift, following);
  const frameless = framelessCurves(model, saved.version, lift, following);
  // Before format 17, a feature's holes were its record's: opened as regions
  // made by operations (regiontranslation.ts, see `VERSION`).
  // `how.regions` false replays a feature entry as written and makes no
  // regions: the build before's model, which is the oracle a test holds an
  // opened file to (test/regionsops.test.ts). Nothing else asks for it.
  const regions = regionTranslation(model, how.regions === false ? VERSION : saved.version);

  // Replay with recording off, then install the journal wholesale, so a model
  // that is opened and saved again round-trips to the same file. What is
  // installed is the *translated* journal rather than the file's own, which is
  // the one place those two can differ: an entry rewritten on the way in has
  // to be rewritten on the way out too, or the file would keep saying
  // `horizontal` forever and nothing would ever finish the migration.
  const replayed: JournalEntry[] = [];
  // **A module the file needs and this device lacks** (docs/plans/
  // workbenches.md): its steps are left out — and so is every later step that
  // names something one of them made — and everything else is replayed, so the
  // rest of the model is intact and the open never hangs or fails on them. A
  // step that refuses while one is missing is left out the same way, since it
  // may have been leaning on something the missing module made. What was left
  // out is said by the host (`lastOpen`).
  const missing = neededModules(saved.modules).filter((m) => !getModule(m.name));
  const missingOps = new Set(missing.flatMap((m) => m.ops));
  const gone = new Set<string>();
  let skipped = 0;
  const leaveOut = (step: JournalEntry) => {
    skipped++;
    const names = (v: unknown): void => {
      if (typeof v === "string") {
        if (!model.entities.has(v) && !model.relations.has(v) && !model.features.has(v) && !model.groups.has(v)) gone.add(v);
      } else if (Array.isArray(v)) v.forEach(names);
    };
    names(step.args);
  };
  const mentionsGone = (v: unknown): boolean =>
    typeof v === "string" ? gone.has(v) || v.split(".").some((part) => gone.has(part)) : Array.isArray(v) && v.some(mentionsGone);
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
        // One entry replayed and installed: what it returned, and the entry
        // as installed (null when it was left out).
        const exec = (step: JournalEntry): Ran => {
          if (missing.length && (missingOps.has(step.op) || mentionsGone(step.args))) { leaveOut(step); return { out: undefined, entry: null }; }
          const fn = table.get(step.op);
          if (!fn) throw new Error(`step ${i + 1}: "${step.op}" is not something a model file may do`);
          let out: unknown;
          try {
            frameless.give(step);
            writtenFaces(model, step, saved.version);
            out = fn(...step.args);
            frameless.made(step, out);
          } catch (e) {
            if (missing.length) { leaveOut(step); return { out: undefined, entry: null }; }
            throw where(e);
          }
          const installed = { op: step.op, args: step.args };
          replayed.push(installed);
          // A version-11 group went with its last member; today's stays. The
          // `ungroup` that build did silently, written in (see `VERSION`).
          const emptied = emptiedBefore12(model, step, saved.version);
          if (emptied !== null) {
            try {
              table.get("ungroup")!(emptied);
            } catch (e) {
              throw where(e);
            }
            replayed.push({ op: "ungroup", args: [emptied] });
          }
          return { out, entry: installed };
        };
        for (const step of given) regions.give(step, exec);
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
  for (const [name, n] of Object.entries(vals.normals ?? {})) {
    const e = model.entities.get(name);
    if (e && (e.kind === "circle" || e.kind === "arc" || e.kind === "ellipse" || e.kind === "earc") && e.normal && Array.isArray(n) && n.length === 3) {
      e.normal.forEach((gi, k) => model.problem.setVar(gi, n[k]));
    }
  }
  for (const [name, b] of Object.entries(vals.minors ?? {})) {
    const e = model.entities.get(name);
    if ((e?.kind === "ellipse" || e?.kind === "earc") && typeof b === "number" && Number.isFinite(b)) model.problem.setVar(e.minorVar, b);
  }
  // A spline's control points and a relation's own variables (format 18), each
  // only where the file's count is the model's: a mismatch is a file edited by
  // hand, whose seeds the first solve settles.
  const restore = (vars: readonly number[] | undefined, xs: unknown) => {
    if (!vars || !Array.isArray(xs) || xs.length !== vars.length || !xs.every((x) => typeof x === "number" && Number.isFinite(x))) return;
    vars.forEach((gi, k) => model.problem.setVar(gi, xs[k] as number));
  };
  for (const [name, xs] of Object.entries(vals.splines ?? {})) {
    const e = model.entities.get(name);
    if (e?.kind === "spline") restore(e.ctrl, xs);
  }
  for (const [name, xs] of Object.entries(vals.params ?? {})) restore(model.relations.get(name)?.vars, xs);
  // An old file's curves, facing their frames as the file drew them and held
  // there by a `par` each, written at the end (see `VERSION`).
  frameless.settle();
  // An old file's holes and islands, told apart where the saved drawing has them.
  regions.settle();
  // An old file's through-all ends (before 23, see `VERSION`): each far side
  // found once, on the drawing as it was saved, and journalled as the `setEnd`
  // it is. One that cannot be laid out any more stays as it replayed: blind
  // at its number, saying through.
  if (saved.version < 23 && model.dim === 3) {
    for (const f of [...model.features.values()]) {
      if (f.kind !== "extrude" || f.extent !== "through" || endRelation(model, f) || model.relations.get(f.depth)?.op !== "extrusion") continue;
      try {
        setEnd(model, f.name, "through");
      } catch {
        // left as it replayed
      }
    }
  }

  last = { missing, skipped };
  return model;
}

let last: { missing: SavedModuleUse[]; skipped: number } = { missing: [], skipped: 0 };

/**
 * What the last open left out: the modules the file needs that are not loaded
 * here, and how many of its steps were not replayed for want of them. Empty
 * for every file that needs nothing this device lacks.
 */
export function lastOpen(): { missing: SavedModuleUse[]; skipped: number } {
  return last;
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
