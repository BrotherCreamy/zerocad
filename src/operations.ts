// Operations, as distinct from relations. A relation only ever *adds an
// equation* — the model's structure is untouched and the solver does the
// rest. An operation changes the structure itself: it creates entities,
// re-points references, trims things back. Fillet is the first, and the
// distinction is worth a file of its own because the two want reviewing
// with different eyes: a relation can only ever over- or under-constrain,
// while an operation can leave the model malformed.

import { addEllipse, checkEllipse, ellipseOf, semiAxes } from "./kinds/ellipse.ts";
import { splineOf } from "./kinds/spline.ts";
import { addSpline } from "./relations/spline.ts";
import {
  Model, ORIGIN, SETTABLE_PROPERTY, isCurveKind, memberName, parseValueRef, referentOf, referentsOf, valueArgIndex,
  FEATURE_MODES, type Entity, type Expansion, type FeatureEntry, type FeatureMode, type Portion, type ProfileMember,
  type RegionEntry, type RegionOp, type RegionStep,
} from "./model.ts";
import { defaultMode, resolveMode } from "./modes.ts";
import { dist } from "./relations/basic.ts";
import { angle, arcEndpoints, diameter, majorAxis, minorAxis, onCircle, onEllipse, pointOnLine, radius, tangent } from "./relations/geometry.ts";
import { extrusion } from "./relations/extrusion.ts";
import { FULL_TURN, axisReader, isFullTurn, revolution, turnPoint } from "./relations/revolution.ts";
import { arcPoint, portionAngles, sweepsAs } from "./arcgeom.ts";
import { curveFrame, framePlaneAxes, planeAxes } from "./curveplane.ts";
import { sketchFrameFor } from "./sketchface.ts";
import {
  describeLoop, findLoops, heldOnCurves, insideLoop, isVirtual, joinClasses, loopAround, memberLabel, parallel, type Held,
  type Loop, type LoopMember,
} from "./loops.ts";
import { cross3, dot3, lift3, sub3 } from "./vec3.ts";
import { ungroup } from "./groups.ts";

function unit(v: number[]): number[] {
  const len = Math.hypot(...v);
  if (len < 1e-12) throw new Error("cannot take the direction of a zero-length line");
  return v.map((c) => c / len);
}

/** The point both lines reference, plus each line's far end. */
function corner(model: Model, l1Name: string, l2Name: string) {
  const l1 = model.line(l1Name), l2 = model.line(l2Name);
  const shared = l1.refs.find((n) => l2.refs.includes(n));
  if (!shared) throw new Error(`"${l1Name}" and "${l2Name}" do not meet at a shared point`);
  const a = l1.refs[0] === shared ? l1.refs[1] : l1.refs[0];
  const b = l2.refs[0] === shared ? l2.refs[1] : l2.refs[0];
  return { l1, l2, shared, a, b };
}

/**
 * Rounds the corner where two lines meet, with an arc of the given radius
 * tangent to both.
 *
 * The whole thing composes out of the existing relation vocabulary, which is
 * the point worth noticing: `tan` on each leg, `arcends` to hold the arc's
 * ends on its own circle, and `rad` for the size. Nothing bespoke. Those four
 * are also *complete* — a tangent line touches its circle exactly once, so an
 * endpoint that lies on both the leg and the circle can only be the point of
 * tangency. There is no need to state that separately.
 *
 * Structurally: the shared corner point is *reused* as the tangent point on
 * the first leg rather than being replaced, so the operation leaves no
 * orphaned geometry behind (the model has no delete yet, so an operation that
 * stranded points would leave stray dots on the canvas forever). The second
 * leg is re-pointed at a new tangent point.
 *
 * The legs' *directions* are deliberately left alone. A fillet in a
 * parametric sketch does not pin the lines it rounds — whatever already
 * constrains them (an axis par, a dimension, another relation) still decides
 * where they point, and the fillet solves within that. On an otherwise
 * unconstrained pair of lines the result is therefore under-determined, and
 * the seeded starting positions are what pick a sensible answer.
 *
 * Which makes the *form* those constraints were written in matter. A relation
 * on a line ("this edge is level") resolves the line's endpoints at every
 * evaluation, so it follows the leg through this re-pointing. A relation on
 * two points ("these two share a y") keeps constraining the two points it
 * named — including the old corner, which is now leg one's tangent point —
 * and leaves the re-pointed leg free to swing. Both behaviours are pinned in
 * test/sketch.test.ts. Prefer the line form for anything that is a property
 * of an edge; it is what the built-in tools use.
 *
 * **In 3D the corner is a plane** — the one the two legs span — and every
 * step above is the same arithmetic in it: the bisector, the back-off along
 * each leg and the centre along the bisector are all lengths and dot products.
 * The arc it makes carries its own normal, as every 3D arc does (see
 * `ArcEntity`), and **needs no frame**: its two tangents hold both legs in its
 * plane (`tangent` in 3D), so the arc follows its corner wherever the corner
 * turns. It used to be given the default frame and refused a corner out of
 * that frame's orientation; a fillet in a fresh document then made a frame of
 * the corner's points first, which is the frame the owner asked why he never
 * wanted (docs/plans/frameless-curves.md).
 *
 * `side` says which of the corner's two normals the arc's is — which only
 * decides which endpoint it starts at, since the sweep is counter-clockwise
 * about the normal (arcgeom.ts) and the short arc between the tangent points is
 * drawn either way. Left out, the drawing plane's normal when the corner lies
 * square to it, else the corner's own normal on the side of its largest
 * component (loops.ts's rule, up for a corner drawn level); journalled only
 * where given — an old file's frame, translated into its +z (persist.ts), so
 * the arc starts where it did. In 2D the answer is the old one, and a 2D
 * model refuses the argument, like `addArc`.
 *
 * Returns the new arc's name.
 */
export function fillet(model: Model, l1Name: string, l2Name: string, r: number, side?: number[] | null,
                       regenerated?: unknown): string {
  if (model.dim !== 2 && model.dim !== 3) throw new Error("fillet rounds a corner in a 2D or 3D model");
  if (!(r > 0)) throw new Error("fillet needs a positive radius");
  if (model.dim === 2 && side != null) {
    throw new Error("a 2D fillet takes no side — its arc lies in the one plane a 2D model has");
  }
  if (side != null && typeof side === "string") {
    throw new Error(`fillet's fourth argument is the side its arc's normal is on, three numbers — "${side}" names a `
      + "frame, which a fillet no longer needs: its arc follows the corner");
  }
  const given = regenerated == null ? null : givenRegenerated(regenerated, "fillet");
  // Journalled as the one call the user made, not as the entities and
  // relations it expands into — replaying it re-expands them identically. The
  // side only where given, so a fillet's entry is the three arguments it
  // always was in 2D, and is now in 3D too. So is the regeneration — the
  // features standing on a leg, with what each profile became — and only where
  // there was such a feature, so a fillet that touched none journals exactly
  // what it always did.
  const args: unknown[] = side == null ? [l1Name, l2Name, r] : [l1Name, l2Name, r, side];
  let after: Regenerated[] | null = null;
  return model.asOperation("fillet", () => (after === null ? args : [l1Name, l2Name, r, side ?? null, after]), () => {
    const arc = filletBody(model, l1Name, l2Name, r, side ?? null);
    // A profile with a rounded corner is a restructured profile: every feature
    // standing on either leg follows it, inside this same call.
    after = regenerateAfter(model, [l1Name, l2Name], given);
    return arc;
  });
}

/**
 * How far out of a plane a corner, a loop or an axis may lean and still count
 * as in it: the sine of the angle between two normals. A millionth — far above
 * the solver's tolerance on legs held in a plane by `onPlane`, far below
 * anything a drawing would show.
 */
export const IN_PLANE_SINE = 1e-6;

/** A corner's lines and points, with the unit directions of its legs from the shared point. */
function cornerOf(model: Model, l1Name: string, l2Name: string) {
  const c = corner(model, l1Name, l2Name);
  const p = model.coords(c.shared);
  const u = unit(model.coords(c.a).map((x, i) => x - p[i]));
  const v = unit(model.coords(c.b).map((x, i) => x - p[i]));
  return { ...c, p, u, v };
}

/**
 * The interior angle at a corner and how far back each leg is cut for radius
 * `r` — refusing legs on one line, and a radius the legs are too short for.
 */
function cornerFits(model: Model, c: ReturnType<typeof cornerOf>, r: number): { theta: number; backoff: number } {
  const { p, u, v } = c;
  const cosTheta = Math.min(1, Math.max(-1, u.reduce((s, ui, i) => s + ui * v[i], 0)));
  const theta = Math.acos(cosTheta);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) {
    throw new Error("cannot fillet a corner whose legs are collinear");
  }
  const backoff = r / Math.tan(theta / 2); // corner -> each tangent point
  const legA = Math.hypot(...model.coords(c.a).map((x, i) => x - p[i]));
  const legB = Math.hypot(...model.coords(c.b).map((x, i) => x - p[i]));
  if (backoff > legA || backoff > legB) {
    throw new Error(`radius ${r} is too large for this corner (needs ${backoff.toFixed(3)} of leg, have ${Math.min(legA, legB).toFixed(3)})`);
  }
  return { theta, backoff };
}

/**
 * The side a new fillet's arc faces when none is given: the drawing plane's
 * normal where the corner lies square to it, else the corner's own normal on
 * the side of its largest component. Plain numbers, for a seed.
 */
function filletSide(model: Model, u: number[], v: number[]): number[] {
  const n = cross3(lift3(u), lift3(v));
  const len = Math.hypot(...n);
  const corner = len > 1e-12 ? n.map((x) => x / len) : [0, 0, 1];
  const drawing = model.planeValues(model.drawingPlane())?.n;
  if (drawing && Math.hypot(...cross3(corner, drawing)) <= IN_PLANE_SINE) return drawing;
  const big = corner.reduce((k, x, i) => (Math.abs(x) > Math.abs(corner[k]) + 1e-12 ? i : k), 0);
  return corner[big] < 0 ? corner.map((x) => -x) : corner;
}

function filletBody(model: Model, l1Name: string, l2Name: string, r: number, given: number[] | null): string {
  const c = cornerOf(model, l1Name, l2Name);
  const { l1, shared, p, u, v } = c;
  // The side the arc turns about: its own normal's, or the 2D drawing's.
  const side = model.dim === 2 ? [0, 0, 1] : given ?? filletSide(model, u, v);

  // The interior angle at the corner decides how far back the legs are cut.
  const { theta, backoff } = cornerFits(model, c, r);
  const toCenter = r / Math.sin(theta / 2); // corner -> arc center

  const bisector = unit(u.map((ui, i) => ui + v[i]));
  const t1 = p.map((pi, i) => pi + u[i] * backoff);
  const t2 = p.map((pi, i) => pi + v[i] * backoff);
  const ctr = p.map((pi, i) => pi + bisector[i] * toCenter);

  // Reuse the corner as leg one's tangent point; leg two gets a fresh one.
  model.setCoords(shared, t1);
  const t2p = model.addPoint(t2);
  const ctrp = model.addPoint(ctr);
  model.retargetLine(l2Name, shared, t2p.name);

  // Sweep counter-clockwise from start to end, so order the two ends by which
  // way round is the short way — otherwise the arc renders as the reflex one.
  // "Counter-clockwise" is about the arc's plane's +z; the short way from t1
  // to t2 is counter-clockwise about the normal t1 × t2 (taken from the
  // centre), so t1 starts exactly when that normal is on +z's side.
  const short = cross3(sub3(lift3(t1), lift3(ctr)), sub3(lift3(t2), lift3(ctr)));
  const [start, end] = sweepsAs(ctr, t1, t2, short, side) ? [shared, t2p.name] : [t2p.name, shared];

  const arc = model.addArc(ctrp.name, start, end, r, model.dim === 3 ? side : null);
  // A rounded construction corner is construction too: a real arc between two
  // construction legs would be a stray edge drawn as if it were the outline.
  // Only when both are — with one real leg there is no saying which it is.
  if (model.isConstruction(l1.name) && model.isConstruction(l2Name)) model.setConstruction(arc.name, true);
  radius(model, arc.name, r);
  arcEndpoints(model, arc.name);
  tangent(model, l1.name, arc.name);
  tangent(model, l2Name, arc.name);

  return arc.name;
}

// --- extrude ----------------------------------------------------------------

/**
 * The depth an extrude gets when it is not told one — a seed, by the
 * free-entities rule, and from then on the depth dimension's value, which
 * `set` edits like any other.
 */
export const DEFAULT_DEPTH = Model.DEFAULT_RADIUS;

/**
 * A profile **resolved**: the frame the lid is offset along, and the loops —
 * the one extruded first, then every loop inside it, each as its members in
 * walk order. A member is a whole entity's name, or a `Portion` of one between
 * two vertices. What `extrude` journals (with every vertex a real point by
 * then); see there for why.
 *
 * A profile **found** — by `profileOf`, for a typed member or a click — may
 * run through a crossing, whose vertex is no point but a key (`l1×l5`, see
 * loops.ts). `crossings` says where each such key is now, which is where the
 * point that materialises it is seeded. It is never journalled, and nor is a
 * key: a key names a crossing by its place along an edge, and a drag can
 * renumber it.
 */
export interface Profile {
  frame: string;
  loops: ProfileMember[][];
  crossings?: Map<string, number[]>;
}

/**
 * Extrudes the closed loop `member` is in — a solid of that region, `depth`
 * deep along its sketch frame's +z — and returns the new feature's name, `e1`.
 *
 * **An expansion into real geometry**, which is the one-model decision paying
 * out: nothing here is a mesh. For every corner of the profile a twin point on
 * the lid; for every member a twin member between the twins (an arc's or
 * circle's on the frame its base is on — the sketch frame, for a curve drawn
 * on the sketch, since a translation turns nothing and a curve's frame is an
 * orientation, not a place); for every corner a wall line from base to twin;
 * **no frame** (see `Expansion` for why there was one and why it went); and
 * **one dimension** — an `extrusion`,
 * `d`-named — holding every twin at its base plus the depth along the frame's
 * +z. So `set("d9.value", 40)` re-solves the solid like any dimension, and the
 * twins and walls are ordinary entities: draggable, constrainable,
 * dimensionable, with the solver negotiating between them and the depth. A
 * record (`e1`, see `FeatureEntry`) says which pieces are one solid, for the
 * renderer and for `del`; the faces are drawn from the live geometry and
 * stored nowhere.
 *
 * **A region split by a crossing or a T extrudes as itself** — Onshape's
 * rule, and what the preview showed. Its members are *portions*: the part of
 * an edge between two vertices. A T's vertex is a point already, held on the
 * edge. A crossing's is not — nothing holds two edges where they cross — so
 * before anything is twinned, every crossing the profile runs through is
 * **materialised**: a real point, held `on` each edge the profile bounds there
 * (`oncircle` on an arc or circle) — the clause idiom `pt(on(_, "l1"), on(_,
 * "l5"))`, made by the operation and owned by the feature, so `del("e1")`
 * takes it as it takes a twin. Then a portion of a line twins to a line
 * between the twins of its ends, and a portion of an arc or circle to an arc
 * about the twinned centre between them; walls stand at every vertex, as
 * ever. A second extrude of the region across the line finds that point held
 * on both edges — a T, now — and twins it without making another: a stepped
 * block from one sketch.
 *
 * **Holes come with the loop.** Every loop inside the one extruded is part of
 * the profile — a hole, and inside a hole an island — and gets twins and walls
 * exactly as the outline does. The caps are drawn even-odd, so an island in a
 * hole extrudes solid without anyone deciding so. A circle has no corners, so a
 * circle's walls are **display-only**: a tube is its two rims, their centres
 * and the depth, and the cylinder between them is drawn, not built — there is
 * no finite set of lines that is that surface, and a seam line drawn at an
 * arbitrary angle would be a lie about where the circle starts.
 *
 * **Which loop.** `member` names any line, arc or circle; the loop is the one
 * it is in (`findLoops`). A member in more than one — an edge two faces share,
 * a line across a rectangle, and after an extrude every profile edge, which is
 * also an edge of a wall — is refused with the loops listed, unless `frame`
 * narrows it to the loops parallel to that frame's plane. A member in none is
 * refused with what makes a loop. The extrude tool skips the question: it
 * hands over the region under the click (`extrudeProfile`).
 *
 * **Which way.** Along the normal of `frame` — any plane reference
 * (`Model.planeKind`): a frame's +z, a curve's own normal, or three points'
 * — given, or else `orientingPlane`'s: the drawing plane, the loop's frame, a
 * parallel frame (the origin last), or three of the loop's own points. None
 * is made (docs/plans/frameless-curves.md): it used to be a frame of those
 * three points, typed by the layer above before this call. The command line
 * and the tool hand over `orientingPlane` with the viewer's line of sight, so
 * a profile in no frame's plane comes out at the viewer. A negative depth
 * extrudes the other way.
 *
 * **Journalled as the call, with the profile resolved** — `extrude("l1", 20,
 * "f1", [["l1","a1","l2","l3","l4"],["c1"]])`, and over a split region
 * `[[{"name":"l1","from":"p1","to":"p9"},"l2",…]]` — the same rule by which
 * `fix`, `circ` and `fillet` journal the frame they resolved: a saved entry
 * must not change meaning with the drawing it is replayed into. Here that is
 * not hypothetical. Replay runs on *seeds* (nothing is solved until the saved
 * values are put back), and a profile built from free lines and relations has
 * no loop at all at its seeds — measured: a rectangle of four `ln()`s, coin'd
 * and fixed into place, has one loop solved and none at replay — so
 * re-finding the loop would fail the file and every undo after it. Given
 * `loops`, nothing is looked for: the members are walked by their joins
 * (relations, never positions) and checked closed, and that is all. A user
 * never needs to type them.
 *
 * **A vertex the model has no point by is one the call makes** — the rule
 * loops.ts reads a vertex by (`isVirtual`), carried into the journal. So the
 * entry names the points its expansion materialised (`p9` above), and a replay,
 * reaching the entry before `p9` exists, materialises it again under that name,
 * held on the edges that meet there. It is seeded where those edges' lines
 * come closest if both are lines, and between them otherwise: a placeholder,
 * which the saved values put right as they put back every twin. A key is
 * never a name here: a vertex spelled with `×` that is no point is refused.
 *
 * **`expansion` is for a replay, and only an old file's.** `9` re-expands the
 * call as a build of format 9 or below did — a lid frame with three points of
 * its own even where a lid corner already stands — and `10` as format 10 did,
 * a lid frame standing on the lid's corners, because the names a later entry
 * of that file holds were handed out by that expansion (see `Expansion`). A
 * typed call never passes it, and a new file never journals it.
 *
 * An operation, refusing before it changes anything (`asOperation` records only
 * on success). 3D only.
 */
export function extrude(model: Model, member: string, ...rest: unknown[]): string {
  if (model.dim !== 3) throw new Error("extrude needs a 3D model — a 2D drawing has no direction out of its plane");
  const { args, options } = peelOptions(rest, "extrude", 4);
  const [depth, frame, loops, expansion] = args as [number | null | undefined, string | null | undefined,
    ProfileMember[][] | null | undefined, number | null | undefined];
  const d = extrudeDepth(depth);
  const x = expansionOf(expansion, "extrude");
  if (typeof member === "string" && model.regions.has(member)) {
    checkOptions(model, options, "extrude");
    const profile = featureProfile(model, member, frame, loops, EXTRUDE);
    return extruded(model, member, d, profile, x, options, member);
  }
  checkMember(model, member, "extrude");
  checkOptions(model, options, "extrude");
  const profile = loops != null ? givenProfile(model, member, frame, loops, EXTRUDE) : foundProfile(model, member, frame ?? null, EXTRUDE);
  // A replay of a file from before regions: persist.ts gives the feature its
  // region in entries of its own, so the entry builds the feature and no more.
  if (!model.journalling) return extruded(model, member, d, profile, x, options, null);
  return onNewRegion(model, profile, member, (r) => extruded(model, r, d, profile, x, options, r));
}

/**
 * The member a feature on region `r` records — the one its region's first
 * face was named by, as a feature's member has always been the one its call
 * named, when the outline has it; else the outline's first.
 */
function regionMember(model: Model, r: string, profile: Profile): string {
  const named = model.regionEntry(r).steps[0].member;
  return profile.loops[0].some((m) => memberName(m) === named) ? named : memberName(profile.loops[0][0]);
}

/**
 * The profile of a feature on region `r`: the journal's loops, walked by their
 * joins — a replay finds nothing — or else the region's boundary as the
 * drawing stands (`regionProfile`), along `frame` or the region's own plane.
 */
function featureProfile(model: Model, r: string, frame: string | null | undefined, loops: ProfileMember[][] | null | undefined,
                        words: ProfileWords): Profile {
  const plane = frame ?? model.regionEntry(r).frame;
  if (loops != null) {
    const first = Array.isArray(loops) && Array.isArray(loops[0]) && loops[0].length ? memberName(loops[0][0]) : "";
    return givenProfile(model, first, plane, loops, words);
  }
  return regionProfile(model, r, plane);
}

/**
 * What a feature call says about the body it makes or changes
 * (docs/plans/solids-kernel.md): `{ mode: "cut" }`, `{ mode: "add", into:
 * "e1" }`. Typed as the call's last argument wherever it stands —
 * `extrude("l1", 10, { mode: "cut" })` — and journalled resolved, the mode
 * and the body both, like the frame and the loops.
 */
export interface FeatureOptions {
  mode?: FeatureMode;
  into?: string;
}

/**
 * A feature call's arguments with its options taken off the end: the first
 * plain object among them, which must be the last thing given. At most
 * `positional` arguments before it.
 */
export function peelOptions(rest: readonly unknown[], op: string, positional: number): { args: unknown[]; options: FeatureOptions } {
  let end = rest.length;
  while (end > 0 && rest[end - 1] === undefined) end--;
  const at = rest.findIndex((a) => a !== null && typeof a === "object" && !Array.isArray(a));
  if (at < 0) {
    if (end > positional) throw new Error(`${op} takes at most ${positional} arguments after the member, then its options — got ${end}`);
    return { args: rest.slice(0, end), options: {} };
  }
  if (at !== end - 1) throw new Error(`${op}'s options — { mode: "cut" } — come last`);
  const raw = rest[at] as Record<string, unknown>;
  for (const k of Object.keys(raw)) {
    if (k !== "mode" && k !== "into") throw new Error(`${op} has no option ${JSON.stringify(k)} — its options are { mode, into }`);
  }
  const options: FeatureOptions = {};
  if (raw.mode !== undefined && raw.mode !== null) {
    if (typeof raw.mode !== "string" || !(FEATURE_MODES as readonly string[]).includes(raw.mode)) {
      throw new Error(`${op}'s mode is one of ${FEATURE_MODES.map((m) => JSON.stringify(m)).join(", ")} — not ${JSON.stringify(raw.mode)}`);
    }
    options.mode = raw.mode as FeatureMode;
  }
  if (raw.into !== undefined && raw.into !== null) {
    if (typeof raw.into !== "string") throw new Error(`${op}'s into names a feature of the body — "e1" — not ${JSON.stringify(raw.into)}`);
    options.into = raw.into;
  }
  return { args: rest.slice(0, Math.min(at, positional)), options };
}

/** The refusals options can have before anything is made: a body that is no feature, a new body told one. */
function checkOptions(model: Model, o: FeatureOptions, op: string): void {
  if (o.into === undefined) return;
  if (o.mode === "new") throw new Error(`${op}'s mode "new" makes a body of its own — it has no "into"`);
  if (!model.features.has(o.into)) throw new Error(`${op}'s into names a feature of the body it changes — "${o.into}" is not a feature`);
}

/**
 * The mode the record gets, once the feature is made (so its solid can be
 * probed): what the options said, the body resolved; or, said nothing, the
 * default — add to a body it touches, else new (modes.ts). Never throws: the
 * body has run, and an operation refuses only before it changes anything. A
 * cut or intersect that touches no body is kept, with no body — the
 * evaluation leaves it out and says so — rather than refused after the fact.
 *
 * **A replay decides nothing** (`live` false): its entry carries the mode
 * resolved, or carries none and means new — as an entry from before modes
 * does. So what is journalled is the options for anything but a new body,
 * and nothing for a new one: a new file's new bodies journal exactly what an
 * old file's did. Returns what to journal.
 */
function chooseMode(model: Model, name: string, o: FeatureOptions, op: string, live: boolean): FeatureOptions[] {
  const f = model.featureOf(name);
  let choice: FeatureOptions;
  if (o.mode === undefined && !live) choice = { mode: "new" };
  else {
    try {
      choice = o.mode === undefined ? defaultMode(model, f) : resolveMode(model, f, o.mode, o.into, op);
    } catch {
      choice = { mode: o.mode };
    }
  }
  const mode = choice.mode ?? "new";
  // A new body's record carries no mode, exactly as an old file's does: one
  // record, one meaning, however it was made.
  if (mode === "new") {
    delete f.mode;
    delete f.into;
    return [];
  }
  f.mode = mode;
  if (choice.into === undefined) delete f.into;
  else f.into = choice.into;
  return [{ mode, ...(choice.into === undefined ? {} : { into: choice.into }) }];
}

/**
 * Which expansion a feature was made by — and so which a replay must make it
 * by again, since the auto-names every later entry holds were handed out by it.
 *
 * - **11**, today's extrude and revolve: **no frame at all**. An extrude made
 *   a lid frame "so a sketch on the cap has a plane", and sketch-on-face builds
 *   that plane from the cap itself now (sketchface.ts); what the lid frame
 *   still did was double points — two rectangles extruded at once share one
 *   plane, which for the second stands off its profile, so the second lid frame
 *   laid three points of its own on the *first* lid's corners, the owner's
 *   *"i'm getting a lot of overlapping points"* (docs/plans/no-lid-frame.md).
 *   A revolve made end frames because a curve on its turned end face needed a
 *   turned orientation; a curve carries its own normal now
 *   (docs/plans/frameless-curves.md), and the twin rim's is held to its base's
 *   turned by the revolution's own `.n` block, so a revolve makes none either.
 * - **10**, a format-12 file's partial revolve and a format-10 file's extrude:
 *   a frame the feature makes (an extrude's lid, a revolve's end frames)
 *   **reuses the twin of every point of the frame it copies that is a profile
 *   vertex**, and makes a point of its own only for one that is not
 *   (`frameOver`). Kept for those files: their later entries name the end
 *   frames' points.
 * - **9**, files of format 9 and below: every such frame has three points of
 *   its own, made before the twins.
 *
 * The old ones are kept rather than translated away because each makes a
 * different number of points in a different order: an old file re-expanded
 * today would hand every point after its first extrude another name, and its
 * later entries — a `dist` on `p14`, a `deleteEntity("p20")` — would land on
 * the wrong points or on none. persist.ts writes the old expansion into such an
 * entry on the way in, so the file goes on saying which expansion it means
 * after it is saved again.
 *
 * Today's is what every call makes, and what an entry with no expansion means.
 */
export const EXPANSION: Readonly<Record<"extrude" | "revolve", Expansion>> = { extrude: 11, revolve: 11 };

function expansionOf(x: number | null | undefined, op: "extrude" | "revolve"): Expansion {
  if (x == null || x === EXPANSION[op]) return EXPANSION[op];
  if (x === 9 || x === 10) return x;
  const old = op === "extrude"
    ? "9 or 10 (a file of version 9 or 10, whose lid frame had points of its own or stood on the lid's)"
    : "9 or 10 (a file of version 9 or below, whose end frames had points of their own, or 10 to 12, whose end frames stood on the end face's corners)";
  throw new Error(`${op}'s expansion is ${old} or left out — got ${JSON.stringify(x)}`);
}

/** The journal's tail for an expansion: nothing for today's, so a new entry is the call as it always was. */
function expansionArgs(x: Expansion, op: "extrude" | "revolve"): number[] {
  return x === EXPANSION[op] ? [] : [x];
}

/**
 * The extrude tool's door: the region it found under a click, crossings and
 * all, extruded — and journalled exactly as a typed call is.
 */
export function extrudeProfile(model: Model, profile: Profile, depth?: number | null, options: FeatureOptions = {}): string {
  if (model.dim !== 3) throw new Error("extrude needs a 3D model — a 2D drawing has no direction out of its plane");
  checkOptions(model, options, "extrude");
  const d = extrudeDepth(depth);
  return onNewRegion(model, profile, memberName(profile.loops[0][0]), (r) => extruded(model, r, d, profile, EXPANSION.extrude, options, r));
}

function extrudeDepth(depth: number | null | undefined): number {
  const d = depth ?? DEFAULT_DEPTH;
  if (typeof d !== "number" || !Number.isFinite(d) || d === 0) {
    throw new Error(`extrude needs a non-zero depth, got ${JSON.stringify(depth)}`);
  }
  return d;
}

/**
 * Plans, then expands and journals — the entry read after the body, since it
 * names what the body materialised. On a region, the entry names the region
 * (`extrude("rg1", 10, …)`) and the record its outline's first member, which
 * is what a feature's member has always been.
 */
function extruded(model: Model, head: string, d: number, profile: Profile, x: Expansion, options: FeatureOptions,
                  region: string | null): string {
  const member = region === null ? head : regionMember(model, region, profile);
  const plan = planSweep(model, profile);
  // The frame's +z when the call was made — where the twins are seeded, and nothing else.
  const z = planeAxes(model, profile.frame)!.n;
  const live = model.journalling;
  let chosen: FeatureOptions[] = [];
  // Options after the expansion: written out when there are options, so they do not land in its place.
  const tail = () => (chosen.length ? [x === EXPANSION.extrude ? null : x, ...chosen] : expansionArgs(x, "extrude"));
  return model.asOperation("extrude", () => [head, d, plan.frame, resolvedLoops(plan), ...tail()],
    () => {
      const name = extrudeBody(model, member, d, plan, z, x);
      if (region !== null) model.featureOf(name).region = region;
      chosen = chooseMode(model, name, options, "extrude", live);
      return name;
    });
}

/**
 * What a profile-taking operation says about itself in the refusals the two of
 * them share — so a revolve that cannot find its loop does not tell the user
 * how to call `extrude`.
 */
interface ProfileWords {
  op: "extrude" | "revolve" | "region";
  /** The call that narrows an ambiguous member to one loop, by its sketch frame. */
  narrowed: (member: string) => string;
  /** Why the operation needs a sketch frame at all. */
  needsFrame: string;
}

const EXTRUDE: ProfileWords = {
  op: "extrude",
  narrowed: (m) => `extrude(${JSON.stringify(m)}, depth, "f1")`,
  needsFrame: "an extrude runs along a sketch frame's +z",
};

const REVOLVE: ProfileWords = {
  op: "revolve",
  narrowed: (m) => `revolve(${JSON.stringify(m)}, axis, angle, "f1")`,
  needsFrame: "a revolve's end face lies on its sketch frame turned",
};

/**
 * The profile for the loop at `index` of `all` (what `findLoops` returned):
 * that loop, every loop inside it, and the frame it is extruded along. What the
 * extrude and revolve tools hand on for the region under a click. Throws when
 * no frame orients the loop — see `extrude`.
 *
 * A member that is part of its entity becomes a `Portion` between the
 * vertices it runs between, **in the entity's own direction** (loops.ts's
 * `memberLabel` order), whichever way the loop walks it; and each crossing
 * among those vertices is placed, from the span the loop found it at, so the
 * point that materialises it starts exactly there.
 */
export function profileOf(model: Model, all: Loop[], index: number, frame?: string | null,
                          words: ProfileWords = EXTRUDE): Profile {
  return profileOfLoops(model, all, [index], frame, words);
}

/**
 * `profileOf` for loops chosen one by one — `indices` into `all`, the outline
 * first — rather than for a loop and everything inside it: what a region is
 * once its membership is the record's and not containment's (`featureRegion`),
 * and what the creating dialog builds once a hole has been clicked out of the
 * proposal. The frame is the outline's when none is named.
 */
export function profileOfLoops(model: Model, all: Loop[], indices: readonly number[], frame?: string | null,
                               words: ProfileWords = EXTRUDE): Profile {
  const f = frame ?? orientingPlane(model, all[indices[0]]);
  void words;
  return { frame: f, ...regionMembers(model, all, indices) };
}

/** `profileOf` without the frame: the loops' members, portions resolved, and where their crossings are. */
function regionMembers(model: Model, all: Loop[], indices: readonly number[]): Pick<Profile, "loops" | "crossings"> {
  const crossings = new Map<string, number[]>();
  const loops = indices.map((i) => all[i].members.map((m): ProfileMember => {
    if (m.span === null) return m.name;
    const [from, to] = m.reversed ? [m.to!, m.from!] : [m.from!, m.to!];
    [from, to].forEach((v, k) => {
      if (isVirtual(model, v) && !crossings.has(v)) crossings.set(v, pointAlong(model, m.name, m.span![k]));
    });
    return { name: m.name, from, to };
  }));
  return { loops, crossings };
}

/** `profileOf`, for a revolve: the same region, and refusals that say "revolve". */
export function revolveProfileOf(model: Model, all: Loop[], index: number, toward?: number[]): Profile {
  return profileOf(model, all, index, orientingPlane(model, all[index], toward), REVOLVE);
}

/**
 * The point a fraction `t` along a line, arc or circle in its own direction —
 * loops.ts's measure of a span (a circle from its frame's +x, past 1 across
 * its seam).
 */
function pointAlong(model: Model, name: string, t: number): number[] {
  const e = model.entities.get(name)!;
  if (e.kind === "line") {
    const [a, b] = [model.coords(e.refs[0]), model.coords(e.refs[1])];
    return a.map((x, i) => x + t * (b[i] - x));
  }
  const f = curveFrame(model, e)!;
  return arcPoint(f, t * f.sweep);
}

/**
 * The region a loop bounds, as indices into `all`: the loop, then every loop
 * inside it in `findLoops` order. Every descendant, not only the children — a
 * hole's island is part of the region too, and even-odd decides it is solid.
 * What an extrude takes, and what the tool outlines before the click.
 */
export function regionOf(all: Loop[], index: number): number[] {
  const inner: number[] = [];
  const queue = [...all[index].children];
  while (queue.length) {
    const i = queue.shift()!;
    inner.push(i);
    queue.push(...all[i].children);
  }
  return [index, ...inner.sort((a, b) => a - b)];
}

/**
 * How many loops down from `outer` the loop `inner` lies — 1 for a child, 2
 * for a child's child — or 0 when it is not inside `outer` at all (itself
 * included). Odd is a hole of `outer`'s region by even-odd, even an island.
 */
export function depthBelow(all: Loop[], inner: number, outer: number): number {
  let d = 0;
  for (let p: number | null = inner; p !== null; p = all[p].parent, d++) if (p === outer) return d;
  return 0;
}

/** The frames to try, the default first, then in creation order, the origin last — loops.ts's preference. */
function framesByPreference(model: Model): string[] {
  const all = model.frameNames().filter((f) => f !== ORIGIN);
  const d = model.defaultFrame;
  return [...(d != null && all.includes(d) ? [d, ...all.filter((f) => f !== d)] : all), ORIGIN];
}

/**
 * The plane a loop is extruded along (or revolved in) when none is named — a
 * plane reference (`Model.planeKind`), always one, since **nothing makes a
 * frame for it** (docs/plans/frameless-curves.md):
 *
 * 1. the drawing plane — the work plane, the default frame or the origin —
 *    when the loop lies in it: a sketch on a face extrudes along that face, and
 *    follows it;
 * 2. else a frame the loop lies in, then one parallel to it — the default
 *    first and the origin last, so a loop drawn level runs along the origin's
 *    +z and a loop on a user's frame along that frame's, as they always did;
 * 3. else the loop's own plane (`sketchFrameFor`): three of its points, facing
 *    `toward` (the viewer, so a positive depth comes out at them; headless the
 *    loop's own normal, loops.ts's — up for anything drawn level), or a whole
 *    circle's own plane. It used to be a frame of those three points, made by
 *    the layer above before the call; the points are the same, and no frame is.
 */
export function orientingPlane(model: Model, loop: Loop, toward: number[] = loop.plane.normal): string {
  const drawing = model.drawingPlane();
  if (liesIn(model, loop, drawing)) {
    // A curve's plane cannot be turned over the way three points can be
    // chosen facing the viewer: sketch on a cylinder's base, and the work
    // plane is the base rim, whose normal points up into the solid. A
    // positive depth there must come out at the viewer, so a curve plane
    // facing away gives way to the loop's own, facing `toward`.
    const away = model.planeKind(drawing) === "curve" && dot3(planeAxes(model, drawing)!.n, toward) < 0;
    if (!away) return drawing;
    return sketchFrameFor(model, loop, toward);
  }
  if (loop.plane.frame !== null) return loop.plane.frame;
  for (const f of framesByPreference(model)) {
    const axes = framePlaneAxes(model, f);
    if (axes && parallel(axes.n, loop.plane.normal)) return f;
  }
  return sketchFrameFor(model, loop, toward);
}

/**
 * The entities a plane or axis reference stands on, for a feature's record to
 * name: a frame's name, a curve's, a face's three points, a line — and nothing
 * for the origin, which is no entity and can never be deleted out from under a
 * record (`ORIGIN`).
 */
function planeNames(model: Model, ref: string): string[] {
  return referentsOf(ref).filter((n) => model.entities.has(n));
}

/** Whether `loop` lies in the plane `ref` names: parallel to it, and on it. */
function liesIn(model: Model, loop: Loop, ref: string): boolean {
  const p = planeAxes(model, ref);
  if (!p || !parallel(p.n, loop.plane.normal)) return false;
  const off = Math.abs(dot3(sub3(loop.plane.origin, p.origin), p.n));
  return off <= 1e-6 * Math.max(1, Math.sqrt(Math.abs(loop.area)));
}
/** The loop `member` is in, found — and refused if it is in none, or in several. */
function foundProfile(model: Model, member: string, frame: string | null, words: ProfileWords): Profile {
  const { all, index } = foundLoop(model, member, frame, words);
  return profileOf(model, all, index, frame, words);
}

/** `foundProfile`'s search, without the profile: the loops there are, and which of them `member` is in. */
function foundLoop(model: Model, member: string, frame: string | null, words: ProfileWords): { all: Loop[]; index: number } {
  const all = findLoops(model);
  const mine = loopsWith(model, all, member, frame);
  if (mine.length === 0) {
    const where = frame === null ? "" : ` parallel to ${frame}`;
    throw new Error(`"${member}" is in no closed loop${where} — loops() lists the loops there are. A loop's ends join `
      + "only at a shared point or a coin (never by touching), and lie in one plane");
  }
  if (mine.length > 1) {
    const list = mine.map((i) => describeLoop(all[i], all)).join("; ");
    throw new Error(`"${member}" is in ${mine.length} loops — ${list}. Name the frame of the sketch it is in `
      + `(${words.narrowed(member)}), name a member only one of them has, or click inside the `
      + `region with the ${words.op} tool`);
  }
  return { all, index: mine[0] };
}

/** The loops of `all` that `member` is in — parallel to `frame`'s plane, if one is named. `foundLoop`'s search, and `regionNaming`'s. */
function loopsWith(model: Model, all: Loop[], member: string, frame: string | null): number[] {
  const mine = all.map((_, i) => i).filter((i) => all[i].members.some((m) => m.name === member));
  if (frame === null) return mine;
  model.planeKind(frame);
  const axes = planeAxes(model, frame);
  if (!axes) throw new Error(`"${frame}" has collapsed — it has no plane for a profile to lie in`);
  return mine.filter((i) => parallel(all[i].plane.normal, axes.n));
}

/**
 * The shortest typed call that means the region at `index` of `all` (what
 * `findLoops` returned) — what the feature tools type on a confirm, so the log
 * shows a line a user could have written and the journal holds what that line
 * journals. In order of preference:
 *
 * - a member only this loop has: `extrude("l1", 20)` — the form `help()`
 *   teaches, and a plain rectangle's every time;
 * - a member only this loop has among those parallel to the frame that
 *   orients it: `extrude("l9", 20, "f2")` — a lid, whose edges are walls' too;
 * - the profile resolved, as the journal carries it: `extrude("l1", 20, "f1",
 *   [["l1", {"name": "l5", "from": "p3", "to": "p9"}, …]])` — a region every
 *   member of which is shared with a neighbour.
 *
 * Each is the region the typed call would find — the same loop, so the same
 * holes with it — because each asks `foundLoop`'s own question of the same
 * loops. Null when none can be typed: no frame orients the loop (the tool types
 * the plane first, so only a host with no command line meets this), or the
 * profile runs through a crossing no point marks yet, which a typed profile
 * cannot name (a key is not a point, see `givenProfile`) — the tool then calls
 * the operation itself, which materialises the crossing as a short form would.
 */
export function regionNaming(model: Model, all: Loop[], index: number, toward?: number[]):
    { member: string; frame: string | null; loops: ProfileMember[][] | null } | null {
  const own = all[index];
  const wholes = [...new Set(own.members.filter((m) => m.span === null).map((m) => m.name))];
  const only = (member: string, frame: string | null) => {
    const found = loopsWith(model, all, member, frame);
    return found.length === 1 && found[0] === index;
  };
  // The plane the call would run along. Where the bare call would choose the
  // same one, it need not be said; where only the viewer's side settles it —
  // a loop no frame orients, its own points facing the one who clicked — it
  // is typed, so the line in the log means what the click did.
  const frame = orientingPlane(model, own, toward);
  const said = frame === orientingPlane(model, own) ? null : frame;
  for (const m of wholes) if (only(m, null)) return { member: m, frame: said, loops: null };
  for (const m of wholes) if (only(m, frame)) return { member: m, frame, loops: null };
  const profile = profileOf(model, all, index, frame);
  if (profile.crossings?.size) return null;
  return { member: memberName(profile.loops[0][0]), frame, loops: profile.loops };
}

/**
 * The loop a typed `extrude` or `revolve` of `member` would find — refused as
 * the call refuses, when it is in none or several. What the command layer asks
 * to give a typed call the viewer's side (`orientingPlane`'s `toward`), which
 * only it knows.
 */
export function loopOfMember(model: Model, member: string, op: "extrude" | "revolve"): Loop {
  checkMember(model, member, op);
  const { all, index } = foundLoop(model, member, null, op === "extrude" ? EXTRUDE : REVOLVE);
  return all[index];
}

/**
 * A revolve of an ellipse is **out of scope** (docs/plans/sketch-shapes.md): its
 * surface is a revolution of an ellipse, which neither the exact B-rep
 * (solids.ts) nor STEP writing has a spelling for yet. Refused by name, before
 * anything is planned, whichever member of the profile was named.
 */
function refuseEllipse(model: Model, member: string): void {
  const e = model.entities.get(member);
  if (e?.kind === "ellipse") throw new Error(`"${member}" is an ellipse — revolving an ellipse is not supported yet`);
}

/** The kinds a profile is made of: a line, an arc, a circle, an ellipse or a spline (docs/plans/spline.md). */
function isProfileKind(kind: string | undefined): boolean {
  return kind === "line" || kind === "arc" || kind === "circle" || kind === "ellipse" || kind === "spline";
}

/** How a refusal names what a profile is made of. */
const PROFILE_KINDS = "a line, arc, circle, ellipse or spline";

function checkMember(model: Model, member: string, op: "extrude" | "revolve"): void {
  const e = typeof member === "string" ? model.entities.get(member) : undefined;
  if (!e || !isProfileKind(e.kind)) {
    throw new Error(`${JSON.stringify(member)} is not ${PROFILE_KINDS} — ${op} names a member of the loop to ${op}`);
  }
  // Said by name rather than left to "in no closed loop", which would send the
  // reader looking for a gap in the outline that is not there.
  if (model.isConstruction(member)) throw new Error(constructionBoundsNothing(member, op));
}

/** Why a construction entity cannot be a profile's member, and the way out. */
function constructionBoundsNothing(name: string, op: string): string {
  return `"${name}" is construction geometry, which bounds no region — construction(${JSON.stringify(name)}, false) `
    + `makes it a boundary ${op} can use`;
}

/** A portion as `loops()` and the hover print it: `l1[p1→p9]`, in the entity's own direction. */
function memberText(m: ProfileMember): string {
  return typeof m === "string" ? m : `${m.name}[${m.from}→${m.to}]`;
}

/**
 * A profile handed over whole — the journal's, or typed — checked for shape: a
 * member is a name, or `{name, from, to}` naming two vertices. An entity may
 * be in a profile as several portions (a band across a circle runs along two
 * arcs of it), but whole only once, and no portion twice.
 */
function givenProfile(model: Model, member: string, frame: string | null | undefined, loops: unknown,
                      words: ProfileWords): Profile {
  if (typeof frame !== "string") throw new Error("a profile given as loops needs the frame it is sketched on");
  model.planeKind(frame);
  const isMember = (m: unknown) => typeof m === "string" || (m !== null && typeof m === "object" && !Array.isArray(m)
    && ["name", "from", "to"].every((k) => typeof (m as Record<string, unknown>)[k] === "string"));
  const ok = Array.isArray(loops) && loops.length > 0
    && loops.every((l) => Array.isArray(l) && l.length > 0 && l.every(isMember));
  if (!ok) {
    throw new Error(`${words.op}'s loops are lists of member names, the outer loop first — or {name, from, to} `
      + "for the part of a member between two points");
  }
  // Copied field by field, so nothing else a hand-written entry carried rides along into the journal.
  const given = (loops as ProfileMember[][]).map((l) => l.map((m): ProfileMember =>
    (typeof m === "string" ? m : { name: m.name, from: m.from, to: m.to })));
  const flat = given.flat();
  const wholes = flat.filter((m) => typeof m === "string");
  const parts = flat.filter((m): m is Portion => typeof m !== "string");
  const texts = parts.map(memberText);
  if (new Set(wholes).size !== wholes.length || new Set(texts).size !== texts.length
      || parts.some((p) => wholes.includes(p.name))) {
    throw new Error(`a member appears twice in ${words.op}'s loops`);
  }
  if (!flat.some((m) => memberName(m) === member)) throw new Error(`"${member}" is not in the loops given`);
  // A profile handed over whole is walked by its joins and never asks
  // findLoops, so it has to be told what findLoops would have left out. A
  // replay meets this only if the file was edited: the flag cannot be set on a
  // profile member (`construction`), so a journal never flags one first.
  const flagged = flat.map(memberName).find((n) => model.isConstruction(n));
  if (flagged !== undefined) throw new Error(constructionBoundsNothing(flagged, words.op));
  for (const p of parts) {
    for (const v of [p.from, p.to]) {
      if (!model.entities.has(v) && v.includes("×")) {
        throw new Error(`"${v}" is a crossing's key, not a point — a key names a crossing by where it lies along an `
          + `edge, and a drag can renumber it, so a profile names real points. ${words.op} by a member's name, or `
          + `click the region with the ${words.op} tool, and the crossing is made a point for you`);
      }
    }
  }
  return { frame, loops: given };
}

/** One member of a profile loop, walked. */
interface Walked {
  name: string;
  kind: "line" | "arc" | "circle" | "ellipse" | "spline";
  /** Its ends in walk order; null for a whole circle. */
  from: string | null;
  to: string | null;
  /**
   * Its ends in the entity's own direction — a whole line's points, a whole
   * arc's start and end, a portion's `from` and `to` — the direction its twin
   * is made in. Null for a whole circle.
   */
  ends: [string, string] | null;
  /** Whether it is part of its entity. */
  part: boolean;
}

/** A profile walked by its joins, ready to expand — what extrude and revolve both plan from. */
interface SweepPlan {
  frame: string;
  loops: ProfileMember[][];
  walked: Walked[][];
  classOf: Map<string, number>;
  /** Where a found profile's crossings are now — seeds for the points that materialise them. */
  crossings: Map<string, number[]> | null;
  /** The vertices that are no point yet, in walk order, each with the edges the profile bounds there. */
  toMake: { v: string; edges: string[] }[];
  /** The frames an old revolve turns for its end face (`sweptFrames`) — empty for everything today makes. */
  swept: string[];
  /** Each vertex the body materialised, to the point it made — filled by the body, read by the journal. */
  made: Map<string, string>;
}

/**
 * Everything an extrude or revolve checks before it makes anything: the frame
 * has a plane, and every loop walks closed by its joins. Read off relations
 * and names only — which is what lets a replay, running on seeds, plan exactly
 * what the call did.
 */
function planSweep(model: Model, profile: Profile): SweepPlan {
  if (!planeAxes(model, profile.frame)) throw new Error(`"${profile.frame}" has collapsed — it has no plane for a profile to lie in`);
  const classOf = joinClasses(model);
  const held = heldOnCurves(model);
  const walked = profile.loops.map((members) => walkLoop(model, classOf, held, members));
  const toMake: { v: string; edges: string[] }[] = [];
  for (const w of walked.flat()) {
    for (const v of [w.from, w.to]) {
      if (v === null || model.entities.has(v) || toMake.some((t) => t.v === v)) continue;
      const edges = [...new Set(walked.flat().filter((m) => m.ends?.includes(v)).map((m) => m.name))];
      if (edges.length < 2) {
        throw new Error(`"${v}" would be made where "${edges[0]}" meets only itself — a crossing is where two edges meet`);
      }
      toMake.push({ v, edges });
    }
  }
  return {
    frame: profile.frame, loops: profile.loops, walked, classOf,
    crossings: profile.crossings ?? null, toMake, made: new Map(), swept: [],
  };
}

/** The profile as the journal and the record carry it: every vertex a real point, those just made by their new names. */
function resolvedLoops(plan: SweepPlan): ProfileMember[][] {
  const real = (v: string) => plan.made.get(v) ?? v;
  return plan.loops.map((l) => l.map((m) => (typeof m === "string" ? m : { name: m.name, from: real(m.from), to: real(m.to) })));
}

/**
 * A loop's members walked end to end by their **joins** — the joined classes
 * loops.ts reads off the `coin` relations, never positions — starting forward
 * along the first unless its far end does not meet the second. The same walk at
 * the call and at every replay, so the twins come out in the same order under
 * the same names. Refuses a loop that does not close, naming where it breaks.
 *
 * A portion's ends are its `from` and `to`, and each must be on its entity *by
 * a relation*: one of its own ends (or joined to one), or a point held on it
 * as loops.ts reads a T (`heldOnCurves`). A vertex that is no point yet is one
 * the call will make, held on the edges that meet there, and is a class of its
 * own until then.
 */
function walkLoop(model: Model, classOf: Map<string, number>, held: Held[], members: ProfileMember[]): Walked[] {
  const names = members.map(memberName);
  const label = members.map(memberText).join(",");
  const entity = (n: string) => {
    const e = model.entities.get(n);
    if (!e || !isProfileKind(e.kind)) {
      throw new Error(`"${n}" is not ${PROFILE_KINDS} — it cannot be part of a loop`);
    }
    return e;
  };
  const cls = (p: string) => classKey(classOf, p);
  // An open spline runs between its first and last points; a closed one is a
  // loop on its own, as a circle is.
  const ownEnds = (e: Entity): [string, string] | null =>
    (e.kind === "line" ? [e.refs[0], e.refs[1]] : e.kind === "arc" ? [e.start, e.end]
      : e.kind === "spline" && !e.closed ? [e.points[0], e.points[e.points.length - 1]] : null);
  const closedOnItself = (e: Entity) => e.kind === "circle" || e.kind === "ellipse" || (e.kind === "spline" && e.closed === true);
  const onIt = (v: string, e: Entity): boolean => {
    const kind = model.entities.get(v)?.kind;
    if (kind === undefined) return true; // made by the call, on the edges that meet there
    if (kind !== "point") throw new Error(`"${v}" is a ${kind}, not a point — a part of an edge runs between two points`);
    if (ownEnds(e)?.some((q) => cls(q) === cls(v))) return true;
    return held.some((h) => h.curve === e.name && cls(h.point) === cls(v));
  };
  const resolved = members.map((m) => {
    const e = entity(memberName(m));
    if (typeof m === "string") return { e, own: ownEnds(e), part: false };
    // There is no elliptic arc to twin a part of an ellipse with, so a region
    // an ellipse bounds only in part is found (loops.ts) but not built: said
    // here, by name, before anything is made (docs/plans/sketch-shapes.md).
    if (e.kind === "ellipse") {
      throw new Error(`a part of the ellipse "${e.name}" bounds this region — an ellipse makes a solid only whole, `
        + "on its own or as a hole; nothing yet can make part of one");
    }
    // Nor a part of a spline (docs/plans/spline.md): its twin would be a spline
    // through points that are no through-points of it. A whole one extrudes.
    if (e.kind === "spline") {
      throw new Error(`a part of the spline "${e.name}" bounds this region — a spline makes a solid only whole, `
        + "an edge from its first point to its last or a loop on its own; nothing yet can make part of one "
        + "(a curve crossing it, or a point held on it, cuts it)");
    }
    if (m.from === m.to) throw new Error(`the part of "${m.name}" from "${m.from}" to itself is no part — name the whole member`);
    for (const v of [m.from, m.to]) {
      if (!onIt(v, e)) throw new Error(`"${v}" is not on "${m.name}" — a part of an edge runs between its own points, or points held on it`);
    }
    return { e, own: [m.from, m.to] as [string, string], part: true };
  });
  if (members.length === 1) {
    const { e, part } = resolved[0];
    if (!closedOnItself(e) || part) {
      throw new Error(`a loop of one member is a circle, an ellipse or a closed spline — "${names[0]}" is ${part ? "part of one" : e.kind === "arc" ? "an arc" : e.kind === "spline" ? "an open spline" : "a line"}`);
    }
    return [{ name: e.name, kind: e.kind as Walked["kind"], from: null, to: null, ends: null, part: false }];
  }
  const ends = (i: number): [string, string] => {
    const { e, own } = resolved[i];
    const noun = e.kind === "ellipse" ? "n ellipse" : e.kind === "spline" ? " closed spline" : " circle";
    if (!own) throw new Error(`a${noun} is a loop on its own — the whole of "${e.name}" cannot be part of the loop ${label}${e.kind === "circle" ? " (a part of it can)" : ""}`);
    return own;
  };
  const meets = (p: string, i: number) => ends(i).some((q) => cls(q) === cls(p));
  const apart = (a: string, b: string) => new Error(`"${a}" and "${b}" do not meet — the loop ${label} is not closed`);
  const walk = (i: number, from: string, to: string): Walked =>
    ({ name: names[i], kind: resolved[i].e.kind as Walked["kind"], from, to, ends: ends(i), part: resolved[i].part });

  const [a0, b0] = ends(0);
  const back = !meets(b0, 1);
  if (back && !meets(a0, 1)) throw apart(names[0], names[1]);
  const out: Walked[] = [walk(0, back ? b0 : a0, back ? a0 : b0)];
  for (let i = 1; i < members.length; i++) {
    const [a, b] = ends(i);
    const at = out[i - 1].to!;
    if (cls(a) === cls(at)) out.push(walk(i, a, b));
    else if (cls(b) === cls(at)) out.push(walk(i, b, a));
    else throw apart(names[i - 1], names[i]);
  }
  if (cls(out[out.length - 1].to!) !== cls(out[0].from!)) throw apart(names[names.length - 1], names[0]);
  return out;
}

/** A point's joined class — or, for a point no shared end or `coin` joins (one made since the classes were read), itself. */
function classKey(classOf: Map<string, number>, p: string): number | string {
  return classOf.get(p) ?? p;
}

/**
 * Makes every vertex of the profile that is no point yet a real one — a
 * crossing, at the call; at a replay, the point the journal names — held on
 * each edge the profile bounds there: `on` on a line, `oncircle` on an arc or
 * circle. In walk order, so a replay makes the same points and relations under
 * the same names. Everything made goes through `made` (the feature owns it).
 *
 * At the call each is auto-named and seeded where the loop found the crossing.
 * At a replay it takes the journal's name and a placeholder seed (see
 * `extrude`), which the saved values put right.
 */
function materialise(model: Model, plan: SweepPlan, made: (name: string) => string): void {
  for (const { v, edges } of plan.toMake) {
    const seed = plan.crossings?.get(v) ?? placeholderSeed(model, edges);
    const p = model.addPoint(seed, plan.crossings?.has(v) ? null : v).name;
    plan.made.set(v, made(p));
    for (const e of edges) made(model.entities.get(e)!.kind === "line" ? pointOnLine(model, p, e) : onCircle(model, p, e));
  }
}

/**
 * Where a replay seeds a materialised point before the saved values put it
 * back: where the first two edges' lines come closest, when both are lines,
 * else halfway between the edges' first points. Nothing reads it but the
 * solver's starting guess.
 */
function placeholderSeed(model: Model, edges: string[]): number[] {
  const [a, b] = edges.map((n) => model.entities.get(n)!);
  if (a.kind === "line" && b.kind === "line") {
    const [p, q] = [model.coords(a.refs[0]), model.coords(b.refs[0])];
    const [u, v] = [sub3(model.coords(a.refs[1]), p), sub3(model.coords(b.refs[1]), q)];
    // The closest approach of p + s·u to q + t·v.
    const w = sub3(p, q);
    const [uu, uv, vv, uw, vw] = [dot3(u, u), dot3(u, v), dot3(v, v), dot3(u, w), dot3(v, w)];
    const den = uu * vv - uv * uv;
    if (den > 1e-12 * uu * vv) {
      const s = (uv * vw - vv * uw) / den;
      return p.map((x, i) => x + s * u[i]);
    }
  }
  const first = (e: Entity) => model.coords(model.refsOf(e)[0]);
  const [x, y] = [first(a), first(b)];
  return x.map((c, i) => (c + y[i]) / 2);
}

/**
 * One twin per joined class, made the first time a point of the class is
 * asked for, at `place(point)`: an extrude's lid and a revolve's end face both
 * twin this way, so their corners are joined exactly where the profile's are —
 * one point where the profile had a shared point or a coin — and the twin
 * face is itself a loop.
 */
function twinner(model: Model, classOf: Map<string, number>, place: (p: string) => number[], made: (n: string) => string) {
  const byClass = new Map<number | string, { base: string; twin: string }>();
  const twinOf = (p: string): string => {
    const k = classKey(classOf, p);
    let t = byClass.get(k);
    if (!t) {
      t = { base: p, twin: made(model.addPoint(place(p)).name) };
      byClass.set(k, t);
    }
    return t.twin;
  };
  return { twinOf, byClass };
}

/**
 * The frame an expansion makes over `base` — an extrude's lid, a revolve's end
 * frame — its points at `place` of `base`'s. **A point of `base` that is a
 * profile vertex stands on that vertex's twin** (`shared`, the twinner's
 * classes), because the twin is already there: a frame of three of the
 * profile's corners, as a frameless sketch's is, would otherwise lay three
 * points of its own exactly on three of the lid's, held there by the depth —
 * doubled labels, and three places that are each two points. Any other point
 * of `base` (a frame floating off the profile, a user's `plane()` elsewhere)
 * gets one of the frame's own, as before.
 *
 * Returns the frame and, as base/twin pairs, only the points it made: a shared
 * point's pair is already its corner's, and a dimension holds each place once.
 * A version-9 expansion calls this before there are any twins, so nothing is
 * shared — which is exactly what it did then.
 */
function frameOver(model: Model, base: string, classOf: Map<string, number>,
                   shared: Map<number | string, { base: string; twin: string }>,
                   place: (p: string) => number[], made: (n: string) => string): { frame: string; own: string[] } {
  const f = model.frame(base);
  const own: string[] = [];
  const [o, x, y] = [f.origin, f.xref, f.yref!].map((p) => {
    const t = shared.get(classKey(classOf, p));
    if (t) return t.twin;
    const q = made(model.addPoint(place(p)).name);
    own.push(p, q);
    return q;
  });
  return { frame: made(model.addFrame(o, x, y).name), own };
}

/** Twins a member's points as the walk meets them — its from, its centre if it has one, its to — so they are named in that order. */
function twinPoints(model: Model, m: Walked, real: (v: string) => string, twinOf: (p: string) => string): void {
  const e = model.entities.get(m.name)!;
  if (e.kind === "circle" && !m.part) { twinOf(e.center); return; }
  if (e.kind === "ellipse") { twinOf(e.center); twinOf(e.major); return; }
  // A spline's every point, in the way the walk goes along it.
  if (e.kind === "spline") {
    const pts = m.from !== null && m.from !== e.points[0] ? [...e.points].reverse() : e.points;
    for (const p of pts) twinOf(real(p));
    return;
  }
  twinOf(real(m.from!));
  if (e.kind === "arc" || e.kind === "circle") twinOf(e.center);
  twinOf(real(m.to!));
}

/**
 * A member's twin, in the member's own direction, between the twins of its
 * ends: a line for a line or part of one; an arc about the twinned centre for
 * an arc, or for part of an arc or circle — the same sense about the same
 * normal, so the same part; a circle for a whole circle. A curve's twin is
 * seeded facing `normalFor` its base (its base's normal moved as the twin is:
 * as it is, for a translation; turned, for a turn) — a seed, which the
 * feature's dimension then holds (`extrusion`, `revolution`).
 */
function twinMember(model: Model, m: Walked, real: (v: string) => string, twinOf: (p: string) => string,
                    normalFor: (curve: string) => number[]): string {
  const e = model.entities.get(m.name)!;
  if (e.kind === "circle" && !m.part) return model.addCircle(twinOf(e.center), model.radius(e.name), normalFor(e.name)).name;
  // A whole ellipse's twin: its centre's and major end's twins, its minor, its
  // normal — the depth holds the minor and the normal to the base's (`extrusion`).
  if (e.kind === "ellipse") {
    const raw = e.normal ? e.normal.map((i) => model.problem.getVar(i)) : null;
    return addEllipse(model, twinOf(e.center), twinOf(e.major), semiAxes(model, e.name).b, raw ? normalFor(e.name) : null).name;
  }
  // A spline's twin is the spline through its points' twins, open or closed as
  // it is: a spline is its points, so the depth's point pairs hold all of it.
  if (e.kind === "spline") return addSpline(model, e.points.map((p) => twinOf(real(p))), e.closed === true);
  const [a, b] = m.ends!.map((v) => twinOf(real(v)));
  if (e.kind === "line") return model.addLine(a, b).name;
  if (e.kind === "arc" || e.kind === "circle") return model.addArc(twinOf(e.center), a, b, model.radius(e.name), normalFor(e.name)).name;
  throw new Error(`"${m.name}" is not a line, arc or circle`); // unreachable: walkLoop checked
}

/**
 * What a feature's record names as built on: every profile entity once, and
 * every point a portion runs to that was a point before the call (a T's, or a
 * crossing another feature made) — so deleting one takes the record, as
 * deleting a profile member does, and a record never names a point that is
 * gone.
 */
function builtOn(plan: SweepPlan): string[] {
  const out = new Set<string>();
  for (const loop of plan.loops) {
    for (const m of loop) {
      out.add(memberName(m));
      if (typeof m !== "string") for (const v of [m.from, m.to]) if (!plan.made.has(v)) out.add(v);
    }
  }
  return [...out];
}

/**
 * The expansion, in an order a replay reproduces name for name: the crossings
 * made points (each with its holds), one twin point per joined class in walk
 * order, the twin members, the walls, the depth, the record. An old file's
 * expansion also makes the lid frame it made (`Expansion`): version 10's after
 * the twins, standing on them where it can (`frameOver`); version 9's before
 * them, all three of its points its own.
 */
function extrudeBody(model: Model, member: string, depth: number, plan: SweepPlan, z: number[], x: Expansion): string {
  const { frame, walked, classOf } = plan;
  const owns: string[] = [];
  const made = (name: string) => { owns.push(name); return name; };
  materialise(model, plan, made);
  const real = (v: string) => plan.made.get(v) ?? v;
  // Seeds only: the depth relation is what holds them, and the solve after the
  // call settles any frame that has turned since the plan was made.
  const lifted = (p: string) => model.coords(p).map((c, i) => c + depth * z[i]);

  // An old file's lid frame: the sketch frame, moved. Its own points are held
  // there by the depth's pairs — read as a datum, so the lid can never turn the
  // sketch.
  const before = x === 9 ? frameOver(model, frame, classOf, new Map(), lifted, made) : null;
  const { twinOf, byClass } = twinner(model, classOf, lifted, made);
  for (const loop of walked) for (const m of loop) twinPoints(model, m, real, twinOf);
  const lid = before ?? (x === 10 ? frameOver(model, frame, classOf, byClass, lifted, made) : null);
  const top = lid?.frame;

  // A twin curve faces as its base does: a translation turns nothing, so it is
  // the same orientation and the same arc, with no side to decide — and the
  // depth holds the two normals together from here on (`extrusion`).
  const twins = walked.map((loop) => loop.map((m) => made(twinMember(model, m, real, twinOf, (c) => model.normalOf(c)))));

  // A wall at every corner, base to twin — once per joined class, so a corner
  // two loops share has one. A circle has none (see `extrude`).
  const walls: string[] = [];
  const walled = new Set<number | string>();
  for (const loop of walked) {
    for (const m of loop) {
      if (m.from === null) continue;
      const k = classKey(classOf, real(m.from));
      if (walled.has(k)) continue;
      walled.add(k);
      const { base, twin } = byClass.get(k)!;
      walls.push(made(model.addLine(base, twin).name));
    }
  }

  // The depth: corners and centres first (the label sits on the first wall),
  // then the curves' radii, then an old lid frame's own points.
  const pairs: string[] = [];
  for (const { base, twin } of byClass.values()) pairs.push(base, twin);
  walked.forEach((loop, i) => loop.forEach((m, j) => { if (m.kind !== "line") pairs.push(m.name, twins[i][j]); }));
  pairs.push(...(lid?.own ?? []));
  const held = made(extrusion(model, frame, depth, ...pairs));

  return model.addFeature({
    kind: "extrude", member, frame, ...(top === undefined ? {} : { top }), depth: held, expansion: x,
    loops: resolvedLoops(plan), twins, walls,
    names: [...new Set([...builtOn(plan), ...planeNames(model, frame), ...owns])], owns,
  }).name;
}

// --- revolve ----------------------------------------------------------------

/**
 * Revolves the closed loop `member` is in about `axis` — through `angle`
 * radians, a whole turn when not told one — and returns the new feature's name.
 *
 * **Extrude's sibling, and most of it is not geometry.** A sweep is not
 * finitely many entities, so the surface of revolution is drawn from the live
 * profile every frame (faces.ts) and stored nowhere, exactly as an extrude's
 * faces are, only more of them. What is real: the profile (the user's, as it
 * was); the **axis**, a frame-axis reference (`"f1.y"`) or a line's name, read
 * as a datum and never pushed; **one `revolution` dimension** carrying the
 * angle, `d`-named and `set`-able, in radians with degrees on its label (`ang`'s
 * seam); and, for a **partial** revolve, the **end face** — a twin of every
 * profile corner, member and frame, turned through the angle about the axis and
 * held there by the dimension's closed-form rotation residuals. So
 * `set("d9.value", θ)` swings the end face, and the end face is ordinary
 * geometry a sketch can be constrained against: the one-model payoff, as an
 * extrude's lid is.
 *
 * **A whole turn makes no twins.** Its end face would be its start face, so
 * there is nothing to hold and the dimension holds nothing. Turning a full
 * revolve partial is a new feature, not a new value — there is no end face to
 * swing, and growing one inside `set` would be an operation pretending to be a
 * dimension edit — so a `set` on a full revolve's angle refuses and says so;
 * a partial one `set` to a whole turn refuses too (see `revolution`).
 *
 * **A split region revolves as itself**, exactly as it extrudes: its crossings
 * materialised first, as points held on the edges through them and owned by
 * the feature — a whole turn included, since its surface is swept from the
 * profile between those points every frame — and, for a partial turn, a twin
 * per vertex and a twin line or arc per portion on the end face.
 *
 * **The axis lies in the profile's plane, and the profile on one side of it.**
 * An axis leaning out of the plane, or beside it, does not make a solid of
 * revolution of this profile; a profile crossing the axis would pass through
 * itself as it turned. Both are refused, naming the geometry. **Touching is
 * allowed**: a profile with an edge or a corner on the axis closes the surface
 * there — a semicircle on its diameter turns into a sphere, a right triangle on
 * a leg into a cone, and the half of a rectangle on one side of a line across
 * it, about that line, into a cylinder. A twin of a point on the axis sits
 * where its base does.
 *
 * **Which loop** — exactly `extrude`'s: the loop `member` is in, every loop
 * inside it riding along as holes (turned, a hole is a tunnel round the axis),
 * `frame` to narrow when the member is in several. The revolve tool skips the
 * question, handing over the region under its first click.
 *
 * **Journalled as the call, with the profile resolved** —
 * `revolve("l1", "f1.y", 4.712, "f1", [["l1","l2","l3","l4"]])`, portions and
 * materialised points as `extrude` journals them — for extrude's measured
 * reason (a replay runs on seeds, where a profile of free lines has no loop),
 * and with the axis as the string that names it, which is already resolved:
 * `yaxis()` typed at the call has become `"f1.y"` by the time the call sees
 * it. Given loops a replay only walks them by their joins. The **geometric
 * refusals** — the axis in the plane, the profile on one side — are the call's
 * and the tool's, never a replay's: they read positions, and a replay has only
 * seeds to read.
 *
 * **`expansion`** is extrude's: `9` for an entry from a file of version 9 or
 * below, whose end frames had three points of their own (see `Expansion`).
 *
 * An operation, refusing before it changes anything. 3D only.
 */
export function revolve(model: Model, member: string, axis: string, ...rest: unknown[]): string {
  if (model.dim !== 3) throw new Error("revolve needs a 3D model — a 2D drawing has nothing to turn out of its plane into");
  const { args, options } = peelOptions(rest, "revolve", 5);
  const [angle, frame, loops, expansion, swept] = args as [number | null | undefined, string | null | undefined,
    ProfileMember[][] | null | undefined, number | null | undefined, unknown];
  const a = revolveAngle(angle);
  const x = expansionOf(expansion, "revolve");
  if (typeof member === "string" && model.regions.has(member)) {
    axisReader(model, axis);
    checkOptions(model, options, "revolve");
    const profile = featureProfile(model, member, frame, loops, REVOLVE);
    if (loops == null) checkRevolve(model, profile, axis);
    return revolved(model, member, axis, a, profile, x, isFullTurn(a) ? [] : sweptFrames(model, profile.frame, x, swept), options, member);
  }
  checkMember(model, member, "revolve");
  refuseEllipse(model, member);
  axisReader(model, axis); // a name that is not an axis says so before anything is looked for
  checkOptions(model, options, "revolve");
  const profile = loops != null ? givenProfile(model, member, frame, loops, REVOLVE) : foundProfile(model, member, frame ?? null, REVOLVE);
  if (loops == null) checkRevolve(model, profile, axis);
  const turned = isFullTurn(a) ? [] : sweptFrames(model, profile.frame, x, swept);
  if (!model.journalling) return revolved(model, member, axis, a, profile, x, turned, options, null);
  return onNewRegion(model, profile, member, (r) => revolved(model, r, axis, a, profile, x, turned, options, r));
}

/**
 * The revolve tool's door: a profile it found under a click, refused on the
 * geometry exactly as a typed call is (`checkRevolve`), then revolved — so the
 * journal entry is the one a typed call makes.
 */
export function revolveProfile(model: Model, profile: Profile, axis: string, angle?: number | null, options: FeatureOptions = {}): string {
  if (model.dim !== 3) throw new Error("revolve needs a 3D model — a 2D drawing has nothing to turn out of its plane into");
  const a = revolveAngle(angle);
  axisReader(model, axis);
  checkOptions(model, options, "revolve");
  checkRevolve(model, profile, axis);
  return onNewRegion(model, profile, memberName(profile.loops[0][0]), (r) => revolved(model, r, axis, a, profile, EXPANSION.revolve, [], options, r));
}

function revolveAngle(angle: number | null | undefined): number {
  const a = angle ?? FULL_TURN;
  if (typeof a !== "number" || !Number.isFinite(a) || a === 0 || Math.abs(a) > FULL_TURN + 1e-9) {
    throw new Error(`revolve needs an angle in radians, more than 0 and at most a whole turn (2π), got ${JSON.stringify(angle)}`);
  }
  return a;
}

/** Plans, then expands and journals — as `extruded`, on a region as it is. */
function revolved(model: Model, head: string, axis: string, a: number, profile: Profile, x: Expansion,
                  swept: string[], options: FeatureOptions, region: string | null): string {
  const member = region === null ? head : regionMember(model, region, profile);
  const plan = { ...planSweep(model, profile), swept };
  // An ellipse anywhere in the profile — the outline or a hole — has no
  // surface of revolution this app can write (`refuseEllipse`).
  const oval = plan.walked.flat().find((w) => w.kind === "ellipse");
  if (oval) throw new Error(`"${oval.name}" is an ellipse — revolving an ellipse is not supported yet`);
  // An old revolve's turned frames ride in its entry only where they are more
  // than its sketch frame, so an old entry re-saves as it came in. Options,
  // when there are any, come after both, the two written out (null for
  // none) so neither lands in the other's place.
  const tail = swept.length > 1 ? [swept] : [];
  const live = model.journalling;
  let chosen: FeatureOptions[] = [];
  const end = () => (chosen.length
    ? [x === EXPANSION.revolve ? null : x, tail.length ? tail[0] : null, ...chosen]
    : [...expansionArgs(x, "revolve"), ...tail]);
  return model.asOperation("revolve", () => [head, axis, a, plan.frame, resolvedLoops(plan), ...end()],
  () => {
    const name = revolveBody(model, member, axis, a, plan, x);
    if (region !== null) model.featureOf(name).region = region;
    chosen = chooseMode(model, name, options, "revolve", live);
    return name;
  });
}

/**
 * How far a profile may stray across its axis, or the axis out of the
 * profile's plane, and still count as on one side and in the plane: a
 * millionth of the drawing's size — loops.ts's `liesOn` — and, for the axis's
 * lean, fillet's `IN_PLANE_SINE`.
 */
const SWEEP_TOL = 1e-6;

/**
 * The geometric refusals: the axis lies in the profile's plane (its direction
 * along it, a point of it on it), and the profile keeps to one side of it
 * (touching allowed). Reads positions, so only a live call asks it — see
 * `revolve`. A portion is measured over its own part, between where its ends
 * are now (a crossing's where `profileOf` found it): the half of a split
 * region that only touches the axis is on one side, though the edges it is
 * cut from run on across.
 */
export function checkRevolve(model: Model, profile: Profile, axis: string): void {
  const ax = axisReader(model, axis).read();
  if (ax.dir.every((c) => c === 0)) throw new Error(`the axis ${axis} has collapsed — it has no direction to turn about`);
  const plane = planeAxes(model, profile.frame);
  if (!plane) throw new Error(`"${profile.frame}" has collapsed — it has no plane for a profile to lie in`);
  checkRevolveIn(model, profile, axis, plane.n, ` (${profile.frame}'s)`);
}

/**
 * `checkRevolve` for a region no frame orients yet, asked of the loop's own
 * plane: what the revolve tool and the command line ask *before* they make the
 * frame a revolve of it needs, so an axis it refuses leaves no frame behind.
 * Which way round the loop's normal points does not matter — every question
 * is about lying in the plane, or keeping to one side of a line in it.
 */
export function checkRevolveRegion(model: Model, all: Loop[], index: number, axis: string): void {
  const ax = axisReader(model, axis).read();
  if (ax.dir.every((c) => c === 0)) throw new Error(`the axis ${axis} has collapsed — it has no direction to turn about`);
  checkRevolveIn(model, regionMembers(model, all, [index]), axis, all[index].plane.normal, "");
}

/** The two geometric refusals, about a plane of normal `n`; `whose` names it in the message, if anything does. */
function checkRevolveIn(model: Model, profile: Pick<Profile, "loops" | "crossings">, axis: string, n: number[],
                        whose: string): void {
  const ax = axisReader(model, axis).read();
  const plane = { n };
  const names = profile.loops[0].map(memberText).join(",");
  const lean = Math.abs(dot3(ax.dir, plane.n));
  if (lean > IN_PLANE_SINE) {
    const deg = Math.round((Math.asin(Math.min(1, lean)) * 180) / Math.PI * 1000) / 1000;
    throw new Error(`the axis ${axis} leans ${deg}° out of the plane of the profile ${names}${whose} — a `
      + "revolve turns a profile about an axis lying in its own plane, or it makes no solid of revolution");
  }
  const members = profile.loops.flat();
  const entities = [...new Set(members.map(memberName))].map((n) => model.entities.get(n)!);
  // The drawing's size, as far as this profile and axis are concerned: how far
  // any of it reaches from the axis's origin, a rim by its radius.
  const reach = (e: Entity) => model.refsOf(e).map((p) => Math.hypot(...sub3(model.coords(p), ax.origin))
    + (e.kind === "circle" || e.kind === "arc" ? model.radius(e.name) : 0));
  const tol = SWEEP_TOL * Math.max(1, ...entities.flatMap(reach));
  const first = entities[0];
  const onProfile = model.coords(first.kind === "line" ? first.refs[0] : model.refsOf(first)[0]);
  const off = Math.abs(dot3(sub3(ax.origin, onProfile), plane.n));
  if (off > tol) {
    throw new Error(`the axis ${axis} runs ${Math.round(off * 1000) / 1000} off the plane of the profile ${names}`
      + `${whose}, parallel to it — a revolve turns a profile about an axis lying in its own plane`);
  }
  // Which side of the axis, across the plane: the in-plane direction square to it.
  const w = cross3(plane.n, ax.dir);
  const at = (v: string) => profile.crossings?.get(v) ?? model.coords(v);
  let lo = Infinity, hi = -Infinity;
  for (const m of members) {
    const e = model.entities.get(memberName(m))!;
    const ends = typeof m === "string" ? null : [at(m.from), at(m.to)] as [number[], number[]];
    for (const s of sideRange(model, e, ax.origin, w, ends)) { lo = Math.min(lo, s); hi = Math.max(hi, s); }
  }
  if (lo < -tol && hi > tol) {
    throw new Error(`the profile ${names} crosses the axis ${axis} — turned about it, it would pass through itself. `
      + "Keep it to one side of the axis; touching it is fine, and closes the solid there");
  }
}

/**
 * How far across the axis a member reaches, both ways: its signed distances
 * along `w` from `origin` at its ends and — for an arc or circle — at the
 * extremes of its rim that it actually sweeps through, so a bulge over the axis
 * is caught as surely as a corner. `ends`, for a portion, are where its two
 * ends are, and only the part between them counts.
 */
function sideRange(model: Model, e: Entity, origin: number[], w: number[], ends: [number[], number[]] | null): number[] {
  const s = (p: number[]) => dot3(sub3(lift3(p), origin), w);
  if (e.kind === "line") return (ends ?? e.refs.map((p) => model.coords(p))).map(s);
  const f = curveFrame(model, e);
  if (!f) return model.refsOf(e).map((p) => s(model.coords(p)));
  const [t0, t1] = ends ? portionAngles(f, ends[0], ends[1]) : [0, f.sweep];
  const [a, b, c] = [f.r * dot3(f.u, w), f.r * dot3(f.v, w), s(f.center)];
  const at = (t: number) => c + a * Math.cos(t) + b * Math.sin(t);
  const out = [at(t0), at(t1)];
  const peak = Math.atan2(b, a);
  for (const t of [peak, peak + Math.PI]) {
    // The extreme's first turn at or after t0, if the part reaches it.
    const tt = t0 + ((((t - t0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI));
    if (tt <= t1) out.push(at(tt));
  }
  return out;
}

/**
 * The expansion, in an order a replay reproduces name for name. First the
 * crossings made points (each with its holds) — a whole turn's too, see
 * `revolve`. A whole turn then: the dimension and the record, nothing else. A
 * partial one: one twin point per joined class in walk order, the end frames
 * (each a point of its own for each of its frame's points that is no profile
 * vertex, then the frame — `frameOver` — the sketch frame's first, then any
 * other frame a profile curve is drawn on), the twin members, the angle, the
 * record. A version-9 expansion makes the end frames before the twins, every
 * point their own, as it did (`Expansion`).
 */
function revolveBody(model: Model, member: string, axis: string, angle: number, plan: SweepPlan, x: Expansion): string {
  const { frame, walked, classOf } = plan;
  const owns: string[] = [];
  const made = (name: string) => { owns.push(name); return name; };
  materialise(model, plan, made);
  const real = (v: string) => plan.made.get(v) ?? v;
  const loops = resolvedLoops(plan);
  const axisOn = referentOf(axis)!;
  // Built on: the profile, its sketch frame and the axis (a profile edge may be the axis — named once).
  const base = [...builtOn(plan), ...planeNames(model, frame), ...planeNames(model, axisOn)];

  if (isFullTurn(angle)) {
    const held = made(revolution(model, axis, angle));
    return model.addFeature({
      kind: "revolve", member, frame, axis, angle: held, loops, twins: [], end: null, expansion: x,
      names: [...new Set([...base, ...owns])], owns,
    }).name;
  }

  // Seeds only: the dimension is what holds them, and the solve after the call
  // settles anything that moved since the plan was made.
  const at = axisReader(model, axis).read();
  const turned = (p: string) => turnPoint(model.coords(p), at, angle);
  const turnedNormal = (c: string) => turnPoint(model.normalOf(c), { origin: [0, 0, 0], dir: at.dir }, angle);

  // An old file's end frames (`Expansion` 9 and 10): the sketch frame turned —
  // so a sketch on the end face had a plane — and any other frame a profile
  // curve was drawn on, turned too, so each twin curve lay in its base's plane
  // turned. Today's revolve makes none: a twin curve carries its own normal,
  // held at its base's turned by the dimension. Each stands on the end face's
  // own corners wherever its frame stands on the profile's.
  const twinFrame = new Map<string, string>();
  const endFrames = (shared: Map<number | string, { base: string; twin: string }>) => {
    for (const fr of plan.swept) {
      twinFrame.set(fr, frameOver(model, fr, classOf, shared, turned, made).frame);
    }
  };
  if (x === 9) endFrames(new Map());
  const { twinOf, byClass } = twinner(model, classOf, turned, made);
  for (const loop of walked) for (const m of loop) twinPoints(model, m, real, twinOf);
  if (x === 10) endFrames(byClass);

  // Each member's twin in its own direction, a curve facing its base turned:
  // the same arc, turned, with no side to decide.
  const twins = walked.map((loop) => loop.map((m) => made(twinMember(model, m, real, twinOf, turnedNormal))));

  // The angle: corners and centres first (the label sits on the first corner's
  // path), then the curves' radii and normals, then an old file's frames — as
  // frames, which is what tells the relation their bases are a datum; it holds
  // a frame's point only where no corner pair already does (see `revolution`).
  const pairs: string[] = [];
  for (const { base: b, twin } of byClass.values()) pairs.push(b, twin);
  walked.forEach((loop, i) => loop.forEach((m, j) => { if (m.kind !== "line") pairs.push(m.name, twins[i][j]); }));
  for (const [fr, tf] of twinFrame) pairs.push(fr, tf);
  const held = made(revolution(model, axis, angle, ...pairs));

  return model.addFeature({
    kind: "revolve", member, frame, axis, angle: held, loops, twins, end: twinFrame.get(frame) ?? null, expansion: x,
    ...(plan.swept.length ? { swept: plan.swept } : {}),
    names: [...new Set([...base, ...owns])], owns,
  }).name;
}

/**
 * The frames an old file's partial revolve turned for its end face, in order:
 * the sketch frame, then each other frame a profile curve was drawn on — given
 * by the entry, which persist.ts writes in from the frames those curves named
 * when the file was written (curves name no frame any more). Checked here, so
 * a hand edit fails at its own step. Empty for today's revolve, which turns
 * no frame (`Expansion`).
 */
function sweptFrames(model: Model, frame: string, x: Expansion, given: unknown): string[] {
  if (x === 11) {
    if (given != null) throw new Error("today's revolve turns no frames — only an old file's names the frames it turned");
    return [];
  }
  const list = given == null ? [frame] : given;
  if (!Array.isArray(list) || !list.length || list[0] !== frame || !list.every((f) => typeof f === "string")) {
    throw new Error(`an old revolve's turned frames are a list of frame names, its sketch frame "${frame}" first`);
  }
  for (const f of list) model.frame(f);
  return [...new Set(list as string[])];
}

// --- regeneration -----------------------------------------------------------

/**
 * One feature brought back into step with its profile, as the journal carries
 * it: the feature's name and the profile resolved — every vertex a real
 * point, portions as `{name, from, to}` — exactly as `extrude` journals the
 * profile it was built on, and for its measured reason: a replay runs on
 * seeds, where a profile of free lines has no loop to be found, so a replay is
 * handed the profile and walks it by its joins.
 */
export type Regenerated = [string, ProfileMember[][]];

/** Every feature whose profile names one of `names` — whole, or a portion of it — in creation order. */
export function featuresOnProfile(model: Model, names: readonly string[]): FeatureEntry[] {
  return [...model.features.values()].filter((f) => f.loops.some((l) => l.some((m) => names.includes(memberName(m)))));
}

/**
 * **The hook a restructuring operation ends with**: every feature whose profile
 * names one of `changed` is regenerated — and then every feature whose profile
 * names a piece one of those regenerations re-pointed (a solid standing on a
 * lid whose edge just moved its end), and so on. `fillet` is the one caller
 * today, with its two legs; the next operation that re-points or replaces a
 * profile member calls this with what it touched, inside its own
 * `asOperation`, so its journal entry stays the one call.
 *
 * At the call (`given` null) each profile is **found** (`refoundProfile`), and
 * a feature whose profile cannot be found any more is **left as it was** — the
 * operation has already changed the drawing, and refusing now could not put
 * that back; `regen("e1")` then says why, by name. What comes back is what the
 * operation journals beside its own arguments: which features were
 * regenerated, in order, with their profiles resolved — or null when no
 * feature's profile names anything that changed, so an operation that touched
 * no feature journals exactly what it always did. At a replay (`given`) the
 * features named are regenerated with the profiles named, and nothing is
 * looked for.
 */
export function regenerateAfter(model: Model, changed: readonly string[], given: Regenerated[] | null): Regenerated[] | null {
  if (given !== null) {
    regenerateGiven(model, given);
    return given;
  }
  const first = featuresOnProfile(model, changed);
  if (first.length === 0) return null;
  return regenerateFound(model, first.map((f) => f.name), null);
}

/**
 * Every feature a change to `names` reaches: those whose profile names one of
 * them (`featuresOnProfile`), and those standing on a region one of whose
 * faces names one — a face trimmed open, or closed again, is the region's
 * face changed. In creation order. What the sketch edits regenerate
 * (sketchedit.ts).
 */
export function featuresTouching(model: Model, names: readonly string[]): FeatureEntry[] {
  const set = new Set(names);
  const regions = [...model.regions.values()].filter((r) => r.steps.some((s) => stepNames(s, set))).map((r) => r.name);
  return [...model.features.values()].filter((f) => f.loops.some((l) => l.some((m) => set.has(memberName(m))))
    || (f.region !== undefined && regions.includes(f.region)));
}

/**
 * Whether each feature named can be brought into step with its profile as the
 * drawing now stands — the profile found and planned exactly as a
 * regeneration finds and plans it, nothing changed — and the first refusal,
 * named, when one cannot. What an operation that restructures a profile asks
 * *before* it keeps its change, so that it can refuse where `fillet` (which
 * predates the question) leaves the feature as it was.
 */
export function regenerationRefusal(model: Model, features: readonly string[]): string | null {
  for (const name of features) {
    if (!model.features.has(name)) continue;
    const f = model.featureOf(name);
    try {
      planRegen(model, f, refoundProfile(model, f));
    } catch (e) {
      return `${name}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return null;
}

/**
 * `regenerateAfter` for a list of features already chosen: at a replay
 * (`given`) those it names with the profiles it names; at the call each
 * found, the chain after it followed — or null when the list is empty, so the
 * caller's entry is the one it always was.
 */
export function regenerateNamed(model: Model, features: readonly string[], given: Regenerated[] | null,
                                notes: string[] = []): Regenerated[] | null {
  if (given !== null) {
    regenerateGiven(model, given);
    return given;
  }
  if (!features.length) return null;
  return regenerateFound(model, [...features], null, notes);
}

/** A journal's (or a typed call's) list of regenerated features, checked for shape and copied. */
export function givenRegenerated(list: unknown, op: string): Regenerated[] {
  const ok = Array.isArray(list)
    && list.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === "string" && Array.isArray(e[1]));
  if (!ok) throw new Error(`${op}'s regenerated features are [feature, loops] pairs — the profile each was brought into step with`);
  return (list as Regenerated[]).map(([name, loops]) => [name, loops]);
}

function regenerateGiven(model: Model, given: Regenerated[]): void {
  for (const [name, loops] of given) {
    const f = model.featureOf(name);
    const profile = givenProfile(model, f.member, f.frame, loops, f.kind === "extrude" ? EXTRUDE : REVOLVE);
    rebuildFeature(model, f, planSweep(model, profile));
  }
}

/**
 * Regenerates the features named, found, and every feature whose profile names
 * a piece one of them re-pointed, each once, in the order they come up.
 * `first`, when given, is the first feature's plan, already made — `regen`
 * makes it before anything changes, so its refusal is a refusal.
 */
function regenerateFound(model: Model, start: string[], first: SweepPlan | null, notes: string[] = []): Regenerated[] {
  const out: Regenerated[] = [];
  const queue = [...start];
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    // A cascade earlier in the chain may have taken this record (the inward rule).
    if (seen.has(name) || !model.features.has(name)) continue;
    seen.add(name);
    const f = model.featureOf(name);
    let plan: SweepPlan;
    if (first !== null && name === start[0]) plan = first;
    else {
      try {
        plan = planRegen(model, f, refoundProfile(model, f, notes));
      } catch {
        continue; // left as it was — see `regenerateAfter`
      }
    }
    const { loops, touched } = rebuildFeature(model, f, plan);
    out.push([name, loops]);
    for (const g of featuresOnProfile(model, touched)) if (!seen.has(g.name)) queue.push(g.name);
  }
  return out;
}

/**
 * Where a feature's region is in the drawing as it stands — **its membership
 * read off the record, never off containment.** The owner: *"I don't think
 * coplanarity should be used as an automatic basis for deciding which entities
 * to include in a region."* So:
 *
 * - `outline` is the loop that now contains the feature's `member`, parallel to
 *   its sketch frame. A member in several such loops (a line across the region,
 *   an edge two regions share) takes the one that keeps the most of the outline
 *   the feature was built on, and a tie is refused. No such loop refuses by
 *   name: a feature whose outline is gone is a deletion, not a regeneration.
 * - `holes[k]` is where the record's inner loop `k + 1` is now: **the loop
 *   inside that outline keeping the most of that hole's own recorded members**
 *   — found by its joins, as the outline is — or null when no loop inside the
 *   outline keeps any of them (its circle deleted, a line of it removed, moved
 *   out). Each found loop answers for one recorded loop at most, in record
 *   order; a tie is refused, as the outline's is.
 *
 * A loop inside the outline that the record does not name is in neither list:
 * it is not part of the region, however it got there. `all` is `findLoops`'s
 * answer, which a caller that has one passes so the indices agree.
 */
export interface FeatureRegion {
  all: Loop[];
  outline: number;
  holes: (number | null)[];
}

export function featureRegion(model: Model, f: FeatureEntry, all: Loop[] = findLoops(model)): FeatureRegion {
  const axes = planeAxes(model, f.frame);
  if (!axes) throw new Error(`"${f.frame}" has collapsed — ${f.name}'s profile has no plane to be found in`);
  const mine = all.map((_, i) => i)
    .filter((i) => parallel(all[i].plane.normal, axes.n) && all[i].members.some((m) => m.name === f.member));
  if (mine.length === 0) {
    throw new Error(`${f.name}'s profile is gone — "${f.member}" is in no closed loop parallel to ${f.frame} now, so there `
      + `is nothing to bring ${f.name} into step with. A feature whose profile is gone is deleted, not regenerated: `
      + `del("${f.name}"); or close the loop again and regen("${f.name}")`);
  }
  let pick = mine[0];
  if (mine.length > 1) {
    const was = new Set(f.loops[0].map(memberName));
    const kept = (i: number) => all[i].members.filter((m) => was.has(m.name)).length;
    const most = Math.max(...mine.map(kept));
    const best = mine.filter((i) => kept(i) === most);
    if (best.length > 1) {
      throw new Error(`${f.name}'s member "${f.member}" is in ${best.length} loops that keep as much of its profile — `
        + `${best.map((i) => describeLoop(all[i], all)).join("; ")} — and regenerating cannot tell which is ${f.name}'s now`);
    }
    pick = best[0];
  }
  const inner = all.map((_, i) => i).filter((i) => within(model, all, i, pick));
  const claimed = new Set<number>();
  const holes = f.loops.slice(1).map((rec): number | null => {
    const names = new Set(rec.map(memberName));
    const kept = (i: number) => all[i].members.filter((m) => names.has(m.name)).length;
    const scored = inner.filter((i) => !claimed.has(i) && kept(i) > 0);
    if (!scored.length) return null;
    const most = Math.max(...scored.map(kept));
    const best = scored.filter((i) => kept(i) === most);
    if (best.length > 1) {
      throw new Error(`${f.name}'s hole ${loopLabel(rec)} is in ${best.length} loops that keep as much of it — `
        + `${best.map((i) => describeLoop(all[i], all)).join("; ")} — and ${f.name} cannot tell which is its hole now`);
    }
    claimed.add(best[0]);
    return best[0];
  });
  return { all, outline: pick, holes };
}

/**
 * Whether the loop at `inner` lies inside the loop at `outer` (and is not it):
 * a descendant in the containment tree, or else every member's midpoint inside
 * `outer`'s outline in its plane. The second, because the tree keeps only the
 * smallest container — a circle in a plate that a revolve's end face overlaps
 * has the end face for its parent, or nothing where their edges cross — and a
 * hole is inside its outline whatever else is drawn on the plane.
 */
export function within(model: Model, all: Loop[], inner: number, outer: number): boolean {
  if (inner === outer) return false;
  if (depthBelow(all, inner, outer) > 0) return true;
  if (!parallel(all[inner].plane.normal, all[outer].plane.normal)) return false;
  return all[inner].members.every((m) =>
    insideLoop(model, all[outer], pointAlong(model, m.name, m.span ? (m.span[0] + m.span[1]) / 2 : 0.5)));
}

/**
 * A loop named for a sentence: its one member (`c1`), or its first and last
 * as walked (`l1–l4`) — enough to find it on the drawing, short enough to
 * read in a refusal.
 */
export function loopLabel(loop: readonly ProfileMember[]): string {
  const names = loop.map(memberText);
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(",");
  return `${names[0]}–${names[names.length - 1]}`;
}

/**
 * A feature's profile **found again**: its outline as the call found it, and
 * each recorded hole by its own members — never every loop inside the outline
 * (`featureRegion`). A recorded hole whose loop is gone is **dropped** — the
 * hole is filled, which is what the loop's going means — and said in `notes`
 * (`e1: hole c1 is gone, filled`), for the line the command prints. The
 * outline's going is a refusal, as ever. A revolve is asked its geometric
 * questions again (`checkRevolve`): this is a call, and reads positions as one.
 */
function refoundProfile(model: Model, f: FeatureEntry, notes: string[] = []): Profile {
  const words = f.kind === "extrude" ? EXTRUDE : REVOLVE;
  if (f.region !== undefined && model.regions.has(f.region)) {
    // A feature on a region is the region's: its chain, never containment.
    const profile = regionProfile(model, f.region, f.frame, notes);
    if (f.kind === "revolve") checkRevolve(model, profile, f.axis);
    return profile;
  }
  const r = featureRegion(model, f);
  const kept = r.holes.filter((i): i is number => i !== null);
  const profile = profileOfLoops(model, r.all, [r.outline, ...kept], f.frame, words);
  if (f.kind === "revolve") checkRevolve(model, profile, f.axis);
  // Said only once the profile stands: a refusal after this would be the line, not these.
  f.loops.slice(1).forEach((rec, k) => {
    if (r.holes[k] === null) notes.push(`${f.name}: hole ${loopLabel(rec)} is gone, filled`);
  });
  return profile;
}

/**
 * The sweep plan for a found profile — with each loop the feature already had,
 * member for member, **kept as the record wrote it**. findLoops may start a
 * loop at another member or walk it the other way round; the same members are
 * the same loop, and keeping the record's order keeps the twins, the
 * dimension's pairs and the journal exactly as they were when nothing
 * structural changed.
 */
function planRegen(model: Model, f: FeatureEntry, profile: Profile): SweepPlan {
  const key = (l: ProfileMember[]) => l.map(memberText).sort().join("|");
  const old = f.loops.map(key);
  const found = profile.loops.map(key);
  const same = old.length === found.length && old[0] === found[0]
    && [...old].sort().join("\n") === [...found].sort().join("\n");
  const loops = same ? f.loops : profile.loops.map((l, i) => {
    const j = old.indexOf(found[i]);
    return j >= 0 ? f.loops[j] : alignedTo(l, f.loops);
  });
  try {
    return planSweep(model, { ...profile, loops });
  } catch {
    return planSweep(model, profile); // the record's order no longer walks; the found one does
  }
}

/**
 * A found loop started and walked as the record's loop sharing members with it
 * was — from the first of those members, the same way round — so a rounded
 * corner reads `l1,a1,l2,l3,l4` where the record read `l1,l2,l3,l4`, rather
 * than wherever findLoops happened to begin. Order, not identity: the walk is
 * read off the joins either way.
 */
function alignedTo(loop: ProfileMember[], old: ProfileMember[][]): ProfileMember[] {
  const names = loop.map(memberName);
  const ref = old.find((o) => o.some((m) => names.includes(memberName(m))));
  if (!ref) return loop;
  const order = ref.map(memberName).filter((n) => names.includes(n));
  const start = names.indexOf(order[0]);
  const forward = [...loop.slice(start), ...loop.slice(0, start)];
  const back = [forward[0], ...forward.slice(1).reverse()];
  const rising = (l: ProfileMember[]) => {
    const at = order.map((n) => l.findIndex((m) => memberName(m) === n));
    return at.filter((x, i) => i > 0 && x > at[i - 1]).length;
  };
  return rising(back) > rising(forward) ? back : forward;
}

/**
 * **The diff and rebuild**: a feature's expansion brought into step with
 * `plan`, its profile as it is now, keeping every piece whose identity
 * survives — so a relation a user put on a twin or a wall is kept wherever the
 * vertex or member it belongs to still exists.
 *
 * - A joined class of vertices that survives keeps its twin and its wall; a
 *   new one gets both, made as the expansion makes them; one that has left the
 *   profile loses both.
 * - A member that survives with the same ends keeps its twin. A line whose end
 *   was re-pointed (fillet's leg two) has its twin re-pointed to match
 *   (`retargetLine`), so the twin entity — and what refers to it — survives. A
 *   twin arc or circle whose ends or centre changed is made again: the model
 *   has no primitive that re-points an arc, and no operation has needed one. A
 *   new member gets a twin of its kind; a member that has gone loses its twin.
 * - Crossings the profile now runs through are materialised, as `extrude`
 *   does; one the feature made that the profile no longer runs through is
 *   released with its holds.
 * - The dimension keeps its name and value and is rebuilt in place to hold
 *   exactly the new twins — `set`'s `REBUILD` path. Today's extrude has no
 *   frame to keep. A revolve's end frames (and an old file's lid frame) keep
 *   their names and points; an end frame no curve needs any more goes, and one
 *   a new curve needs is made. A frame point that is a corner's twin is owned
 *   once, as the twin; one whose corner has left the profile stays, held as the
 *   frame's own; and a sketch-frame point the profile now runs through takes
 *   the frame point already over it as its twin — the expansion's rule
 *   (`frameOver`), so regenerating never lays a second point where the frame
 *   has one. A version-9 feature is rebuilt as version 9 built it, its frames'
 *   points their own (`Expansion`).
 * - The record is rewritten in place (`rewriteFeature`), under the same name.
 *
 * What has gone goes **last, by the ordinary cascade** (`delOne`), once nothing
 * of the feature names it: whatever referred to it goes with it — a user's
 * relation on a vanished wall, the record of a feature built on it — as
 * deleting it by hand would take them. Everything new is made in the order the
 * expansion makes it, so a replay handed the same profile makes the same names,
 * and the record lists what it owns in the order a fresh expansion would.
 *
 * Returns the profile resolved, for the journal, and the twins it re-pointed —
 * pieces a feature built on this one's lid or end face may have in *its*
 * profile, which the hook regenerates next.
 */
function rebuildFeature(model: Model, f: FeatureEntry, plan: SweepPlan): { loops: ProfileMember[][]; touched: string[] } {
  // **The groups a regeneration's new pieces join** (docs/plans/organiser.md):
  // every group that held all the entities the feature had made — so a group
  // that held the whole solid still does — and not the open group. A fillet
  // drawn into the sketch's group regenerates the lid, and the lid's new arc
  // is the solid's, not the sketch's; the open group is what the person is
  // drawing, and a regeneration is not drawing. Read before the rebuild, as
  // the groups stood; deterministic, so a replay makes the same members.
  const made = f.owns.filter((n) => model.entities.has(n));
  const holding = made.length ? [...model.groups.values()].filter((g) => made.every((n) => g.members.includes(n))).map((g) => g.name) : [];
  const before = new Set(model.entities.keys());
  const out = model.withoutOpenGroup(() => rebuildBody(model, f, plan));
  const fresh = [...model.entities.keys()].filter((n) => !before.has(n));
  for (const g of holding) if (model.groups.has(g) && fresh.length) model.addMembers(g, fresh);
  return out;
}

/** `rebuildFeature`'s body: the rebuild itself, which knows nothing of groups. */
function rebuildBody(model: Model, f: FeatureEntry, plan: SweepPlan): { loops: ProfileMember[][]; touched: string[] } {
  const { frame, walked, classOf } = plan;
  const dimName = f.kind === "extrude" ? f.depth : f.angle;
  const dim = model.relationOf(dimName);
  const value = dim.args[1] as number;
  const kindOf = (n: string) => model.entities.get(n)?.kind;
  const owns: string[] = [];
  const made = (n: string) => { owns.push(n); return n; };
  const touched: string[] = [];

  // The points this feature materialised that the profile still runs through,
  // with their holds (every relation it owns but its dimension), in the
  // record's order; then whatever crossing is new.
  const wasVertex = new Set(f.loops.flat().flatMap((m) => (typeof m === "string" ? [] : [m.from, m.to])));
  const isVertex = new Set(plan.loops.flat().flatMap((m) => (typeof m === "string" ? [] : [m.from, m.to])));
  const still = new Set(f.owns.filter((n) => kindOf(n) === "point" && wasVertex.has(n) && isVertex.has(n)));
  for (const n of f.owns) {
    if (still.has(n)) owns.push(n);
    else if (n !== dimName && model.relations.has(n) && still.has(model.relationOf(n).args[0] as string)) owns.push(n);
  }
  materialise(model, plan, made);
  const real = (v: string) => plan.made.get(v) ?? v;
  const loops = resolvedLoops(plan);

  const twinned = f.kind === "extrude" || f.twins.length > 0;
  const twins: string[][] = [];
  const walls: string[] = [];
  const pairs: string[] = [];
  const framePairs: string[] = [];
  let end: string | null = null;

  if (twinned) {
    // Whether the feature's frames stand on its twins (see `Expansion`). A
    // version-9 feature is rebuilt the version-9 way, so a replay of its
    // file's `regen` or `fillet` makes the names that file's later entries hold.
    const shares = f.expansion !== 9;

    // The old expansion, read back off the dimension: one twin per joined
    // class, and for a revolve the end frame of each frame a curve was drawn
    // on. A version-9 lid frame's own pairs are not twins — its points are
    // always its own. A version-10 lid frame is in the pairs once a point, as
    // the corner it stands on or as a point of its own over a sketch-frame
    // point that is no vertex; read as a twin either way, so a sketch-frame
    // point the profile now runs through takes the lid point already over it,
    // rather than a second point in the same place. Today's has no lid frame.
    const lidFrame = new Set(f.kind === "extrude" && !shares && f.top !== undefined ? model.refsOf(model.frame(f.top)) : []);
    const oldClass = new Map<number | string, { base: string; twin: string }>();
    const oldFrames = new Map<string, string>();
    const was = dim.args.slice(2) as string[];
    for (let i = 0; i < was.length; i += 2) {
      const [b, t] = [was[i], was[i + 1]];
      if (kindOf(b) === "point" && kindOf(t) === "point" && !lidFrame.has(t)) {
        const k = classKey(classOf, b);
        if (!oldClass.has(k)) oldClass.set(k, { base: b, twin: t });
      } else if (kindOf(b) === "frame") oldFrames.set(b, t);
    }
    // An end frame's points the same way, after every corner's, so a corner
    // keeps its own twin.
    if (shares) {
      for (const [fr, tf] of oldFrames) {
        const tp = model.refsOf(model.frame(tf));
        model.refsOf(model.frame(fr)).forEach((p, k) => {
          const c = classKey(classOf, p);
          if (!oldClass.has(c)) oldClass.set(c, { base: p, twin: tp[k] });
        });
      }
    }

    // One twin per joined class, in walk order: the old one where the class
    // survives, else a new one where the expansion would put it.
    let place: (p: string) => number[];
    const byClass = new Map<number | string, { base: string; twin: string }>();
    const twinOf = (p: string): string => {
      const k = classKey(classOf, p);
      let t = byClass.get(k);
      if (!t) {
        t = oldClass.get(k) ?? { base: p, twin: model.addPoint(place(p)).name };
        byClass.set(k, t);
        owns.push(t.twin);
      }
      return t.twin;
    };
    const owned = (n: string) => { if (!owns.includes(n)) owns.push(n); };

    // Where a new twin goes — its base moved by the depth, or turned through
    // the angle, as the dimension holds it now — and which frame a curve's
    // twin lies on. The frames are owned (and a new end frame made) where the
    // expansion makes them: before the twins in a version-9 feature, after
    // them in today's, which is also when it is known which of their points
    // are twins.
    // A new twin curve's normal, seeded as the expansion seeds it: its base's,
    // moved as the twin is — and then held by the dimension, rebuilt below.
    let normalFor: (c: string) => number[];
    if (f.kind === "extrude") {
      const z = planeAxes(model, frame)!.n;
      place = (p) => model.coords(p).map((c, i) => c + value * z[i]);
      // Today's extrude has no lid frame; an old file's lid frame is kept as
      // that file made it.
      const top = f.top;
      normalFor = (c) => model.normalOf(c);
      const lid = () => {
        if (top === undefined) return;
        for (const p of model.refsOf(model.frame(top))) owned(p);
        owns.push(top);
      };
      if (!shares) lid();
      for (const loop of walked) for (const m of loop) twinPoints(model, m, real, twinOf);
      if (shares) lid();
      // A lid point that is no corner's twin now — over a sketch-frame point
      // that is no vertex, or one that has left the profile — is held as the
      // lid frame's own.
      if (top !== undefined) {
        const corner = new Set([...byClass.values()].map((t) => t.twin));
        const [b, t] = [model.refsOf(model.frame(frame)), model.refsOf(model.frame(top))];
        b.forEach((p, k) => { if (!corner.has(t[k])) framePairs.push(p, t[k]); });
      }
    } else {
      const at = axisReader(model, f.axis).read();
      place = (p) => turnPoint(model.coords(p), at, value);
      normalFor = (c) => turnPoint(model.normalOf(c), { origin: [0, 0, 0], dir: at.dir }, value);
      // An old file's end frames in revolveBody's order, the old one wherever
      // there was one; today's revolve has none.
      const twinFrame = new Map<string, string>();
      const endFrames = (shared: Map<number | string, { base: string; twin: string }>) => {
        for (const fr of f.swept ?? []) {
          const old = oldFrames.get(fr);
          if (old !== undefined) {
            for (const p of model.refsOf(model.frame(old))) owned(p);
            owns.push(old);
            twinFrame.set(fr, old);
          } else {
            twinFrame.set(fr, frameOver(model, fr, classOf, shared, place, made).frame);
          }
        }
      };
      if (!shares) endFrames(new Map());
      for (const loop of walked) for (const m of loop) twinPoints(model, m, real, twinOf);
      if (shares) endFrames(byClass);
      end = twinFrame.get(frame) ?? null;
      for (const [fr, tf] of twinFrame) framePairs.push(fr, tf);
    }

    // Each member's twin: the old one, matched by entity and then by ends —
    // kept as it is, or re-pointed where it is a line — else a new one.
    const oldTwins = f.twins.flat();
    const old = f.loops.flat().map((m, i) => ({ text: memberText(m), name: memberName(m), twin: oldTwins[i], used: false }));
    const matched = (m: ProfileMember): string | undefined => {
      const same = old.filter((o) => !o.used && o.name === memberName(m));
      const hit = same.find((o) => o.text === memberText(m)) ?? same[0];
      if (hit) hit.used = true;
      return hit?.twin;
    };
    walked.forEach((loop, i) => {
      twins.push(loop.map((m, j) => {
        const e = model.entities.get(m.name)!;
        const was = matched(loops[i][j]);
        const t = was === undefined ? undefined : model.entities.get(was);
        if (t?.kind === "line" && e.kind === "line") {
          const want = m.ends!.map((v) => twinOf(real(v)));
          // Re-pointed end by end; a twin wanted the other way round is made again.
          if (t.refs[0] === want[0] || t.refs[1] !== want[0]) {
            for (const k of [0, 1]) {
              if (t.refs[k] !== want[k]) {
                model.retargetLine(t.name, t.refs[k], want[k]);
                touched.push(t.name);
              }
            }
            return made(t.name);
          }
        } else if (t?.kind === "arc" && (e.kind === "arc" || (e.kind === "circle" && m.part))) {
          const [s, n] = m.ends!.map((v) => twinOf(real(v)));
          if (t.center === twinOf(e.center) && t.start === s && t.end === n) return made(t.name);
        } else if (t?.kind === "circle" && e.kind === "circle" && !m.part) {
          if (t.center === twinOf(e.center)) return made(t.name);
        } else if (t?.kind === "ellipse" && e.kind === "ellipse") {
          if (t.center === twinOf(e.center) && t.major === twinOf(e.major)) return made(t.name);
        } else if (t?.kind === "spline" && e.kind === "spline") {
          // The old twin while it still runs through the twins of its base's points, in order.
          if (t.points.length === e.points.length && t.points.every((p, k) => p === twinOf(real(e.points[k])))) return made(t.name);
        }
        return made(twinMember(model, m, real, twinOf, normalFor));
      }));
    });

    if (f.kind === "extrude") {
      // A wall at every corner, once per joined class — the old wall wherever
      // it still stands between the class's base and its twin.
      const oldWall = new Map<number | string, string>();
      for (const w of f.walls) {
        const k = classKey(classOf, model.line(w).refs[0]);
        if (!oldWall.has(k)) oldWall.set(k, w);
      }
      const walled = new Set<number | string>();
      for (const loop of walked) {
        for (const m of loop) {
          if (m.from === null) continue;
          const k = classKey(classOf, real(m.from));
          if (walled.has(k)) continue;
          walled.add(k);
          const { base, twin } = byClass.get(k)!;
          const w = oldWall.get(k);
          const stands = w !== undefined && model.line(w).refs[0] === base && model.line(w).refs[1] === twin;
          walls.push(made(stands ? w : model.addLine(base, twin).name));
        }
      }
    }

    // The pairs in the expansion's order: corners and centres, then the
    // curves' radii, then the frames.
    for (const { base, twin } of byClass.values()) pairs.push(base, twin);
    walked.forEach((loop, i) => loop.forEach((m, j) => { if (m.kind !== "line") pairs.push(m.name, twins[i][j]); }));
    pairs.push(...framePairs);
  }

  owns.push(dimName);
  const args = [dim.args[0], value, ...pairs];
  const rebuild = REBUILD[dim.op];
  model.rebuildRelation(dimName, dim.op, args, () => rebuild(model, args));

  const on = [...builtOn(plan), ...planeNames(model, frame), ...(f.kind === "revolve" ? planeNames(model, f.axis) : [])];
  const names = [...new Set([...on, ...owns])];
  if (f.kind === "extrude") {
    model.rewriteFeature(f.name, {
      kind: "extrude", member: f.member, frame, ...(f.top === undefined ? {} : { top: f.top }), depth: f.depth,
      loops, twins, walls, expansion: f.expansion, ...modeFields(f), names, owns,
    });
  } else {
    model.rewriteFeature(f.name, {
      kind: "revolve", member: f.member, frame, axis: f.axis, angle: f.angle, loops, twins, end, expansion: f.expansion,
      ...(f.swept ? { swept: f.swept } : {}), ...modeFields(f), names, owns,
    });
  }

  // What has gone, last: nothing of the feature names it now, so the ordinary
  // cascade takes it and whatever needed it, and leaves the feature be.
  const keep = new Set(owns);
  for (const n of f.owns) if (!keep.has(n) && model.has(n)) delOne(model, n);
  return { loops: resolvedLoops(plan), touched };
}

/**
 * A record's mode and body, carried through a rewrite: a regenerated cut is
 * still a cut of the same body. And its region: a regenerated feature still
 * stands on the region it was made from.
 */
function modeFields(f: FeatureEntry): Pick<FeatureEntry, "mode" | "into" | "region"> {
  return {
    ...(f.mode === undefined ? {} : { mode: f.mode }), ...(f.into === undefined ? {} : { into: f.into }),
    ...(f.region === undefined ? {} : { region: f.region }),
  };
}

/**
 * Regenerates a feature — `regen("e1")` — bringing its expansion back into
 * step with its profile as it is now, keeping every piece whose identity
 * survives (see `rebuildFeature`); then every feature built on a piece it
 * re-pointed. Returns the feature's name.
 *
 * `fillet` does this by itself, for every feature on a leg it rounds (see
 * `regenerateAfter`). This is the explicit door, for a profile restructured
 * any other way: a line drawn across a region after it was extruded, an end
 * re-pointed at the command line. Not on a solve, a drag or a `set`: those
 * move geometry and restructure nothing, and a feature's faces are read off
 * live geometry already. On an untouched feature it changes nothing — the same
 * twins, walls and names — and journals once.
 *
 * **It adds no hole.** A circle drawn inside an extruded outline is not part
 * of the region until `hole("e1", "c1")` says so (`featureRegion`); a recorded
 * hole whose loop has gone is filled, and `notes` — the command line's, never
 * the journal's — says so: `e1: hole c1 is gone, filled`.
 *
 * Refuses a name that is no feature, and a feature whose profile is gone (see
 * `featureRegion`), before it changes anything. A feature built on this one
 * whose profile can no longer be found is left as it was, as `fillet` leaves
 * one.
 *
 * **Journalled as the call, with what it found resolved** — `regen("e1",
 * [["e1", [["l1","a1","l2","l3","l4"]]]])`, each feature it regenerated with
 * its profile — `extrude`'s rule, for `extrude`'s reason. A replay handed the
 * list walks those profiles by their joins and looks for nothing.
 */
export function regen(model: Model, feature: string, regenerated?: unknown, notes: string[] = []): string {
  checkFeatureName(model, feature, "regen");
  if (regenerated != null) {
    const given = givenRegenerated(regenerated, "regen");
    return model.asOperation("regen", [feature, given], () => { regenerateGiven(model, given); return feature; });
  }
  const f = model.featureOf(feature);
  const plan = planRegen(model, f, refoundProfile(model, f, notes));
  let out: Regenerated[] = [];
  return model.asOperation("regen", () => [feature, out], () => {
    out = regenerateFound(model, [feature], plan, notes);
    return feature;
  });
}

/** A name that is a feature, or the refusal that says what it is instead. */
function checkFeatureName(model: Model, feature: unknown, op: string): asserts feature is string {
  if (typeof feature === "string" && model.features.has(feature)) return;
  const kind = typeof feature !== "string" ? null
    : model.entities.get(feature)?.kind ?? (model.relations.has(feature) ? "relation" : null);
  const what = kind === null ? "is not a feature" : `is a ${kind}, not a feature`;
  throw new Error(`${JSON.stringify(feature)} ${what} — ${op} takes a feature's name, as ls() lists them (e1, e2, …)`);
}

// --- regions: faces combined by named operations ------------------------------

/**
 * **A region is faces combined by named operations** (docs/plans/regions-as-
 * operations.md) — `rg1 = region("l1")`, then `subtract("rg1", "c1")`,
 * `add`, `intersect` — and nothing in it is negative. The owner: *"there
 * should be no such thing as a negative face. a face is just a face"*.
 *
 * **A face is a loop's area**: everything inside the closed loop a member is
 * in, the loops drawn inside it included — a loop inside is drawn as a loop
 * and nothing more until an operation names it. Faces are found (loops.ts),
 * never stored. What the region keeps is its chain (`RegionEntry`), each
 * step's face named by a member and kept as the member names it was resolved
 * to, which is what it is found again by: the loop through the member, in the
 * region's plane, keeping the most of them.
 *
 * **The algebra is of cells.** The faces of one plane nest (loops.ts's
 * containment tree) and never overlap otherwise — a crossing splits them — so
 * a face's area is its loop's *cell* (the inside less its children's) and the
 * cells of every loop inside it (`regionOf`). Subtract, add and intersect are
 * then set difference, union and intersection of cells: exact, nothing
 * sampled, and the area is the cells' areas summed (`cellsArea`).
 *
 * **What a feature takes** is the region's boundary: the loops whose cell is
 * in and whose parent's is not, or the other way round — which is exactly the
 * even-odd profile a feature has always been built from, outline first
 * (`regionBoundary`). Where two of those loops share an edge (a face added
 * beside the region), the shared pieces cancel and the rest are walked into
 * the merged outline (`mergedBoundary`).
 */
const REGION: ProfileWords = {
  op: "region",
  narrowed: (m) => `region(${JSON.stringify(m)}, "f1")`,
  needsFrame: "a region lies in one plane",
};

/** The symbol a step is written with in a region's row: `rg1 = l1–l4 − c1 + c3`. */
export const REGION_SYMBOL: Readonly<Record<RegionOp, string>> = { region: "", subtract: "−", add: "+", intersect: "∩" };

/** A line, arc, circle or ellipse, not construction — or the refusal that says what it is instead. */
function checkCurve(model: Model, member: unknown, op: string): asserts member is string {
  const e = typeof member === "string" ? model.entities.get(member) : undefined;
  if (!e || !isProfileKind(e.kind)) {
    throw new Error(`${JSON.stringify(member) ?? String(member)} is not ${PROFILE_KINDS} — ${op} names a face `
      + "by a member of the loop around it");
  }
  if (model.isConstruction(member as string)) throw new Error(constructionBoundsNothing(member as string, op));
}

/** A face as a step keeps it: the names of the members it runs along, once each. */
export function faceNames(loop: Loop): string[] {
  return [...new Set(loop.members.map((m) => m.name))];
}

/** A journal's (or a typed call's) face: member names, the step's own member among them. */
function givenFace(face: unknown, member: string, op: string): string[] {
  const names = Array.isArray(face) ? face.map((m) => (typeof m === "string" ? m : memberName(m as ProfileMember))) : null;
  if (!names || !names.length || names.some((n) => typeof n !== "string")) {
    throw new Error(`${op}'s face is the names of the members of its loop — ["l1", "l2", "l3", "l4"]`);
  }
  if (!names.includes(member)) throw new Error(`"${member}" is not in the face given to ${op}`);
  return [...new Set(names)];
}

/** Two loops in one plane: parallel, and either's origin on the other's plane — `loopAround`'s tolerance. */
function coplanarLoops(a: Loop, b: Loop): boolean {
  if (!parallel(a.plane.normal, b.plane.normal)) return false;
  const off = Math.abs(dot3(sub3(a.plane.origin, b.plane.origin), b.plane.normal));
  return off <= 1e-6 * Math.max(1, Math.sqrt(Math.abs(a.area)), Math.sqrt(Math.abs(b.area)));
}

/** The normal of a region's plane, or the refusal for a plane that has collapsed. */
function regionNormal(model: Model, r: RegionEntry): number[] {
  const axes = planeAxes(model, r.frame);
  if (!axes) throw new Error(`"${r.frame}" has collapsed — ${r.name} has no plane for its faces to lie in`);
  return axes.n;
}

/**
 * The loop of `all` a step's face is now: the loops through its member,
 * parallel to the region's plane (and in the plane of its first face, once
 * there is one), and of those the one keeping the most of the face as it was
 * resolved. Null when there is none — the face is gone. A tie refuses: the
 * region cannot tell which is its face.
 */
function faceLoop(all: Loop[], n: number[], r: RegionEntry, step: RegionStep, base: Loop | null): number | null {
  const mine = all.map((_, i) => i).filter((i) => parallel(all[i].plane.normal, n)
    && all[i].members.some((m) => m.name === step.member) && (base === null || coplanarLoops(all[i], base)));
  if (mine.length <= 1) return mine[0] ?? null;
  const was = new Set(step.face.map(memberName));
  const kept = (i: number) => all[i].members.filter((m) => was.has(m.name)).length;
  const most = Math.max(...mine.map(kept));
  const best = mine.filter((i) => kept(i) === most);
  if (best.length > 1) {
    throw new Error(`${r.name}'s face ${loopLabel(step.face)} is in ${best.length} loops that keep as much of it — `
      + `${best.map((i) => describeLoop(all[i], all)).join("; ")} — and ${r.name} cannot tell which is its face now`);
  }
  return best[0];
}

/**
 * A region as the drawing stands: where each step's face is (null for one
 * gone), how the faces it names nest, and the cells it covers.
 *
 * **Only the faces a region names are its cells.** A face's cell is its inside
 * less the faces named inside it — a loop drawn inside that no step names is
 * part of the cell, which is what "nothing more until an operation names it"
 * means — and the nesting is asked of the geometry (`within`), not only
 * findLoops's containment tree, which keeps one smallest container and so
 * hands a circle in a plate to a revolve's end face overlapping it (the
 * explicit-regions fixture has one).
 */
export interface RegionValue {
  all: Loop[];
  faces: (number | null)[];
  /** Each named face's smallest named container, or null for an outermost one. */
  parent: Map<number, number | null>;
  cells: Set<number>;
}

/** `cells` combined with a face's `area` by a step's operation. */
export function combineCells(op: RegionOp, cells: ReadonlySet<number>, area: ReadonlySet<number>): Set<number> {
  if (op === "region") return new Set(area);
  if (op === "add") return new Set([...cells, ...area]);
  if (op === "subtract") return new Set([...cells].filter((c) => !area.has(c)));
  return new Set([...cells].filter((c) => area.has(c)));
}

/** How a set of faces nest: each one's smallest container among them. */
export function faceTree(model: Model, all: Loop[], nodes: readonly number[]): Map<number, number | null> {
  const parent = new Map<number, number | null>();
  for (const i of nodes) {
    const around = nodes.filter((j) => j !== i && within(model, all, i, j));
    around.sort((a, b) => Math.abs(all[a].area) - Math.abs(all[b].area) || a - b);
    parent.set(i, around[0] ?? null);
  }
  return parent;
}

/** How many faces of a tree down from `outer` the face `inner` is — 0 when it is not inside it. */
export function treeDepth(parent: ReadonlyMap<number, number | null>, inner: number, outer: number): number {
  let d = 0;
  for (let p: number | null = inner; p !== null; p = parent.get(p) ?? null, d++) if (p === outer) return d;
  return 0;
}

/** A face's area as cells: itself and every named face inside it. */
function areaCells(parent: ReadonlyMap<number, number | null>, face: number): Set<number> {
  return new Set([...parent.keys()].filter((i) => i === face || treeDepth(parent, i, face) > 0));
}

/** A chain's faces folded by their operations, the nesting asked of the geometry. */
function foldFaces(model: Model, all: Loop[], ops: readonly RegionOp[], faces: readonly (number | null)[]):
    { parent: Map<number, number | null>; cells: Set<number> } {
  const nodes = [...new Set(faces.filter((f): f is number => f !== null))];
  const parent = faceTree(model, all, nodes);
  let cells = new Set<number>();
  faces.forEach((f, k) => { if (f !== null) cells = combineCells(ops[k], cells, areaCells(parent, f)); });
  return { parent, cells };
}

/**
 * Evaluates a region's chain against the drawing as it stands — `steps` in
 * place of its own when a caller asks what the region would be without some.
 * The first face gone is a refusal by name, as a feature's outline gone is; a
 * later face gone does nothing until it is back.
 */
export function regionValue(model: Model, name: string, all: Loop[] = findLoops(model),
                            steps?: readonly RegionStep[]): RegionValue {
  const r = model.regionEntry(name);
  const chain = steps ?? r.steps;
  const n = regionNormal(model, r);
  const base = faceLoop(all, n, r, chain[0], null);
  if (base === null) {
    throw new Error(`${r.name}'s first face ${loopLabel(chain[0].face)} is gone — "${chain[0].member}" is in no closed loop `
      + `parallel to ${r.frame} now. Close the loop again, or del("${r.name}")`);
  }
  const faces: (number | null)[] = [base, ...chain.slice(1).map((step) => faceLoop(all, n, r, step, all[base]))];
  return { all, faces, ...foldFaces(model, all, chain.map((s) => s.op), faces) };
}

/** The value a region would have with one more step, its face at `at`. */
function withStep(model: Model, r: string, v: RegionValue, op: RegionOp, at: number): RegionValue {
  const faces = [...v.faces, at];
  const ops = [...model.regionEntry(r).steps.map((s) => s.op), op];
  return { all: v.all, faces, ...foldFaces(model, v.all, ops, faces) };
}

/** The area of a region's cells: each face's area less the named faces just inside it. */
export function cellsArea(v: Pick<RegionValue, "all" | "parent" | "cells">): number {
  let a = 0;
  for (const c of v.cells) {
    a += Math.abs(v.all[c].area);
    for (const [k, p] of v.parent) if (p === c) a -= Math.abs(v.all[k].area);
  }
  return a;
}

/** A region's area, as the drawing stands. */
export function regionArea(model: Model, name: string): number {
  return cellsArea(regionValue(model, name));
}

/**
 * Whether a world point is in a region — the innermost of its faces that
 * holds the point decides. What a click inside asks of a region.
 */
export function regionHolds(model: Model, v: RegionValue, world: number[]): boolean {
  let best: number | null = null;
  for (const i of v.parent.keys()) {
    if (!insideLoop(model, v.all[i], world)) continue;
    if (best === null || Math.abs(v.all[i].area) < Math.abs(v.all[best].area)) best = i;
  }
  return best !== null && v.cells.has(best);
}

/** What the notes say of a region's faces that are gone: each does nothing until its loop is back. */
function goneFaces(model: Model, name: string, v: RegionValue): string[] {
  const r = model.regionEntry(name);
  return r.steps.flatMap((s, k) => (v.faces[k] === null ? [`${name}: ${loopLabel(s.face)} is gone, so its ${s.op} does nothing now`] : []));
}

/**
 * The loops a region's profile is made of — `all` with any merged outline
 * appended, and the indices into it, the outline first — or the refusal that
 * says why no feature can stand on it: empty, or more than one piece.
 */
export function regionBoundary(model: Model, name: string, v: RegionValue): { all: Loop[]; loops: number[] } {
  const { all, cells, parent } = v;
  if (!cells.size) throw new Error(`${name} is empty — its operations leave no area`);
  const up = (i: number) => parent.get(i) ?? null;
  const inB = (i: number) => cells.has(i) !== (up(i) !== null && cells.has(up(i)!));
  const B = [...parent.keys()].filter(inB).sort((a, b) => a - b);
  const counts = new Map<string, number>();
  for (const i of B) for (const nm of faceNames(all[i])) counts.set(nm, (counts.get(nm) ?? 0) + 1);
  const shared = [...counts.values()].some((k) => k > 1);
  const above = (i: number) => {
    for (let p = up(i); p !== null; p = up(p)) if (B.includes(p)) return true;
    return false;
  };
  const tops = B.filter((i) => !above(i));
  if (!shared && tops.length === 1) return { all, loops: [tops[0], ...B.filter((i) => i !== tops[0])] };
  const pieces = shared ? mergedBoundary(model, all, B, cells) : B.map((i) => ({ loop: all[i], outer: !above(i) }));
  const outers = pieces.filter((m) => m.outer);
  if (outers.length !== 1) {
    const said = outers.map((m) => loopLabel(m.loop.members.map((x) => x.name))).join("; ");
    throw new Error(`${name} is ${outers.length} separate pieces — ${said}. A feature stands on one outline and the loops `
      + "inside it: make a region of each piece, or add the face that joins them");
  }
  const ext = [...all];
  const at = (l: Loop) => {
    const i = all.indexOf(l);
    if (i >= 0) return i;
    ext.push(l);
    return ext.length - 1;
  };
  return { all: ext, loops: [at(outers[0].loop), ...pieces.filter((m) => !m.outer).map((m) => at(m.loop))] };
}

/**
 * The boundary of cells whose loops share edges: every boundary loop's pieces,
 * cut at every vertex any of them has, each walked the way its cell's inside
 * is on its left (a hole's loop backwards) — and a piece walked both ways is
 * an edge between two cells of the region, inside it, and cancels. What is
 * left is walked vertex to vertex into closed loops; counter-clockwise ones
 * are outlines, clockwise ones holes. Each is a `Loop` like findLoops's, its
 * members as long as the walk lets them be, so a profile is made of it as of
 * any other.
 */
function mergedBoundary(model: Model, all: Loop[], B: number[], cells: ReadonlySet<number>): { loop: Loop; outer: boolean }[] {
  const plane = all[B[0]].plane;
  const closed = (name: string) => {
    const e = model.entities.get(name);
    return !!e && (e.kind === "circle" || e.kind === "ellipse" || (e.kind === "spline" && e.closed === true));
  };
  const TOL = 1e-7;
  const norm = (name: string, t: number) => (closed(name) ? ((t % 1) + 1) % 1 : t);
  const near = (name: string, a: number, b: number) => {
    const d = Math.abs(norm(name, a) - norm(name, b));
    return d < TOL || (closed(name) && Math.abs(d - 1) < TOL);
  };
  // Every vertex along each entity, by its parameter.
  const marks = new Map<string, { t: number; v: string }[]>();
  const mark = (name: string, t: number, v: string | null) => {
    if (v === null) return;
    const list = marks.get(name) ?? [];
    if (!list.some((x) => near(name, x.t, t))) list.push({ t: norm(name, t), v });
    marks.set(name, list);
  };
  for (const i of B) {
    for (const m of all[i].members) {
      const [a, b] = m.span ?? [0, 1];
      const [start, end] = m.reversed ? [m.to, m.from] : [m.from, m.to];
      mark(m.name, a, start);
      mark(m.name, b, end);
    }
  }
  const vertexAt = (name: string, t: number): string | null => (marks.get(name) ?? []).find((x) => near(name, x.t, t))?.v ?? null;
  // Cut into atomic pieces, and count each piece's walks.
  interface Piece { name: string; t0: number; t1: number; v0: string | null; v1: string | null; n: number }
  const pieces = new Map<string, Piece>();
  for (const i of B) {
    const o = cells.has(i) ? 1 : -1;
    for (const m of all[i].members) {
      let [a, b] = m.span ?? [0, 1];
      const own = marks.get(m.name) ?? [];
      // A whole circle another loop cuts starts at a cut, so its pieces have vertices.
      if (m.span === null && closed(m.name) && own.length) [a, b] = [own[0].t, own[0].t + 1];
      const dir = (m.reversed ? -1 : 1) * o;
      const cuts = own.flatMap((x) => (closed(m.name) ? [x.t - 1, x.t, x.t + 1] : [x.t]))
        .filter((t) => t > a + TOL && t < b - TOL).sort((x, y) => x - y);
      const ts = [a, ...cuts, b];
      for (let k = 0; k + 1 < ts.length; k++) {
        const key = `${m.name}@${norm(m.name, ts[k]).toFixed(6)}`;
        const p = pieces.get(key) ?? { name: m.name, t0: ts[k], t1: ts[k + 1], v0: vertexAt(m.name, ts[k]), v1: vertexAt(m.name, ts[k + 1]), n: 0 };
        p.n += dir;
        pieces.set(key, p);
      }
    }
  }
  // What is left, walked: from its start vertex to its end the way its count says.
  interface Walk { name: string; t0: number; t1: number; dir: 1 | -1; from: string | null; to: string | null }
  const left: Walk[] = [...pieces.values()].filter((p) => p.n !== 0).map((p): Walk => (p.n > 0
    ? { name: p.name, t0: p.t0, t1: p.t1, dir: 1, from: p.v0, to: p.v1 }
    : { name: p.name, t0: p.t0, t1: p.t1, dir: -1, from: p.v1, to: p.v0 }));
  const used = new Set<number>();
  const cycles: Walk[][] = [];
  for (let s = 0; s < left.length; s++) {
    if (used.has(s)) continue;
    used.add(s);
    const cycle = [left[s]];
    if (left[s].from === null) { cycles.push(cycle); continue; } // a whole circle
    let at = left[s].to;
    while (at !== left[s].from) {
      const next = left.findIndex((w, k) => !used.has(k) && w.from === at);
      if (next < 0) throw new Error("a region's merged outline does not close — its faces meet where no vertex joins them");
      used.add(next);
      cycle.push(left[next]);
      at = left[next].to;
    }
    cycles.push(cycle);
  }
  // Consecutive pieces of one entity walked one way are one member.
  const follows = (prev: Walk, w: Walk) => prev.name === w.name && prev.dir === w.dir
    && (w.dir > 0 ? near(w.name, prev.t1, w.t0) : near(w.name, prev.t0, w.t1));
  const join = (prev: Walk, w: Walk) => {
    if (w.dir > 0) prev.t1 += w.t1 - w.t0;
    else prev.t0 -= w.t1 - w.t0;
    prev.to = w.to;
  };
  return cycles.map((cycle) => {
    const runs: Walk[] = [];
    for (const w of cycle) {
      const prev = runs.at(-1);
      if (prev && follows(prev, w)) join(prev, w);
      else runs.push({ ...w });
    }
    if (runs.length > 1 && follows(runs.at(-1)!, runs[0])) {
      const last = runs.pop()!;
      join(last, runs[0]);
      last.to = runs[0].to;
      runs[0] = last;
    }
    const members: LoopMember[] = runs.map((w) => {
      let [t0, t1] = [w.t0, w.t1];
      if (t0 < 0) [t0, t1] = [t0 + 1, t1 + 1];
      const whole = w.from === null || (closed(w.name) ? Math.abs(t1 - t0 - 1) < TOL : Math.abs(t0) < TOL && Math.abs(t1 - 1) < TOL);
      if (whole && closed(w.name)) return { name: w.name, reversed: w.dir < 0, from: null, to: null, span: null };
      return { name: w.name, reversed: w.dir < 0, from: w.from, to: w.to, span: whole ? null : [t0, t1] };
    });
    // Signed area about the plane's normal, from points along the walk.
    const pts: number[][] = [];
    for (const m of members) {
      const [a, b] = m.span ?? [0, 1];
      const k = 24;
      for (let j = 0; j < k; j++) {
        const t = m.reversed ? b - ((b - a) * j) / k : a + ((b - a) * j) / k;
        const d = sub3(lift3(pointAlong(model, m.name, t)), plane.origin);
        pts.push([dot3(d, plane.u), dot3(d, plane.v)]);
      }
    }
    let area = 0;
    for (let j = 0; j < pts.length; j++) {
      const [x0, y0] = pts[j], [x1, y1] = pts[(j + 1) % pts.length];
      area += x0 * y1 - x1 * y0;
    }
    area /= 2;
    return { loop: { members, plane, area, parent: null, children: [] }, outer: area > 0 };
  });
}

/**
 * The profile a feature on region `name` is built from, as the drawing stands
 * — its boundary (`regionBoundary`), resolved as a found region is
 * (`profileOfLoops`), along `frame` or the region's own. A face gone is said
 * in `notes`.
 */
export function regionProfile(model: Model, name: string, frame?: string | null, notes: string[] = []): Profile {
  const v = regionValue(model, name);
  const b = regionBoundary(model, name, v);
  const profile = profileOfLoops(model, b.all, b.loops, frame ?? model.regionEntry(name).frame);
  notes.push(...goneFaces(model, name, v));
  return profile;
}

/** A region as its organiser row and `ls()` write it: `rg1 = l1–l4 − c1 − c3`. */
export function regionText(model: Model, name: string): string {
  const r = model.regionEntry(name);
  return `${name} = ${r.steps.map((s, k) => (k === 0 ? "" : `${REGION_SYMBOL[s.op]} `) + loopLabel(s.face)).join(" ")}`;
}

/**
 * The region a world point is in — the latest made whose cells hold the loop
 * around the point — or null. What a feature tool asks of a click: inside a
 * region, the click takes the region; anywhere else, the face. A hidden
 * region is not on screen to be clicked, and one that cannot be found as the
 * drawing stands holds nothing.
 */
export function regionAtPoint(model: Model, world: number[], all: Loop[] = findLoops(model)): string | null {
  if (!model.regions.size) return null;
  for (const name of [...model.regions.keys()].reverse()) {
    if (model.hidden.has(name)) continue;
    try {
      if (regionHolds(model, regionValue(model, name, all), world)) return name;
    } catch {
      // a region whose first face is gone holds nothing
    }
  }
  return null;
}

/**
 * The shortest typed `region(…)` that means the face at `index` of `all` —
 * what the region tool types for a click, so the log shows a line a user
 * could have written: a member only this loop has; else one only it has
 * among the loops parallel to the plane that orients it (a lid, whose edges
 * are walls' too), with that plane; else its first member, with the plane
 * and the face resolved.
 */
export function faceNaming(model: Model, all: Loop[], index: number, toward?: number[]):
    { member: string; frame: string | null; face: string[] | null } {
  const own = all[index];
  const names = faceNames(own);
  const frame = orientingPlane(model, own, toward);
  const said = frame === orientingPlane(model, own) ? null : frame;
  const only = (m: string, f: string | null) => {
    const found = loopsWith(model, all, m, f);
    return found.length === 1 && found[0] === index;
  };
  for (const m of names) if (only(m, null)) return { member: m, frame: said, face: null };
  for (const m of names) if (only(m, frame)) return { member: m, frame, face: null };
  return { member: names[0], frame, face: names };
}

/**
 * The shortest typed step — `subtract("rg1", "c1")` — that names the face at
 * `index` of `all` for region `r`: a member that finds that very loop, or the
 * face resolved beside its first member where none does alone. What the
 * region tool types; the step's own refusals are asked separately.
 */
export function regionStepNaming(model: Model, op: Exclude<RegionOp, "region">, r: string, all: Loop[], index: number):
    { member: string; face: string[] | null } {
  const entry = model.regionEntry(r);
  const n = regionNormal(model, entry);
  const v = regionValue(model, r, all);
  const base = all[v.faces[0]!];
  const names = faceNames(all[index]);
  for (const m of names) {
    const level = all.map((_, i) => i).filter((i) => all[i].members.some((x) => x.name === m)
      && parallel(all[i].plane.normal, n) && coplanarLoops(all[i], base));
    if (level.length === 1 && level[0] === index) return { member: m, face: null };
  }
  void op;
  return { member: names[0], face: names };
}

/**
 * **Makes a region of one face** — `region("l1")`: the closed loop `l1` is
 * in, everything inside it included — and returns its name, `rg1`. A member
 * in several loops is refused with them listed unless `frame` narrows it to
 * the loops parallel to a plane, as `extrude` refuses, or `face` names which
 * (the region tool hands over the face it found under the click). The region
 * lies in `frame`'s plane, or the plane that orients the loop
 * (`orientingPlane`).
 *
 * Journalled with the face resolved — `region("l1", "f1", ["l1", "l2", "l3",
 * "l4"])` — which a replay is handed and finds nothing from. An operation: it
 * makes structure (a region is a named thing), so it is here and never a
 * relation.
 */
export function region(model: Model, member: string, frame?: string | null, face?: unknown): string {
  checkCurve(model, member, "region");
  if (frame != null) model.planeKind(frame);
  let plane: string, names: string[];
  if (face != null && !model.journalling) {
    if (typeof frame !== "string") throw new Error("a region given its face needs the plane it lies in");
    plane = frame;
    names = givenFace(face, member, "region");
  } else {
    const all = findLoops(model);
    let mine = loopsWith(model, all, member, frame ?? null);
    if (mine.length > 1 && face != null) {
      const was = new Set(givenFace(face, member, "region"));
      const kept = (i: number) => all[i].members.filter((m) => was.has(m.name)).length;
      const most = Math.max(...mine.map(kept));
      mine = mine.filter((i) => kept(i) === most);
    }
    if (mine.length === 0) {
      const where = frame == null ? "" : ` parallel to ${frame}`;
      throw new Error(`"${member}" is in no closed loop${where} — loops() lists the loops there are. A loop's ends join `
        + "only at a shared point or a coin (never by touching), and lie in one plane");
    }
    if (mine.length > 1) {
      throw new Error(`"${member}" is in ${mine.length} loops — ${mine.map((i) => describeLoop(all[i], all)).join("; ")}. `
        + `Name the plane (${REGION.narrowed(member)}), name a member only one of them has, or click the face with the region tool`);
    }
    plane = frame ?? orientingPlane(model, all[mine[0]]);
    names = faceNames(all[mine[0]]);
  }
  return model.asOperation("region", () => [member, plane, names],
    () => model.addRegion(plane, { op: "region", member, face: names }).name);
}

/**
 * **Subtracts a face from a region** — `subtract("rg1", "c1")`: the cells of
 * the face `c1` bounds taken out of `rg1`'s — and regenerates every feature
 * standing on `rg1`. Returns the region's name. Refused, before anything
 * changes, where it would take nothing away, leave nothing, or leave a
 * feature on the region with no single outline to stand on.
 */
export function subtract(model: Model, r: string, member: string, face?: unknown, regenerated?: unknown, notes: string[] = []): string {
  return regionStep(model, "subtract", r, member, face, regenerated, notes);
}

/** **Adds a face to a region** — `add("rg1", "c3")`: its cells joined to the region's. As `subtract`. */
export function add(model: Model, r: string, member: string, face?: unknown, regenerated?: unknown, notes: string[] = []): string {
  return regionStep(model, "add", r, member, face, regenerated, notes);
}

/** **Keeps only what a region and a face share** — `intersect("rg1", "l9")`. As `subtract`. */
export function intersect(model: Model, r: string, member: string, face?: unknown, regenerated?: unknown, notes: string[] = []): string {
  return regionStep(model, "intersect", r, member, face, regenerated, notes);
}

function checkRegionName(model: Model, r: unknown, op: string): asserts r is string {
  if (typeof r !== "string") throw new Error(`${op} takes a region's name first — ${op}("rg1", "c1")`);
  model.regionEntry(r);
}

/**
 * What a region step would do, found as the drawing stands — the face, the
 * cells after — or the refusal that says why it would do nothing. Asks
 * nothing of the model but loops: the region tool asks it of a hover.
 */
export function planRegionStep(model: Model, op: Exclude<RegionOp, "region">, r: string, member: string, face?: unknown):
    { before: RegionValue; after: RegionValue; at: number; names: string[] } {
  checkRegionName(model, r, op);
  checkCurve(model, member, op);
  const entry = model.regionEntry(r);
  const before = regionValue(model, r);
  const { all } = before;
  const base = all[before.faces[0]!];
  const n = regionNormal(model, entry);
  const mine = all.map((_, i) => i).filter((i) => all[i].members.some((m) => m.name === member));
  if (!mine.length) {
    throw new Error(`"${member}" is in no closed loop — loops() lists the loops there are. A loop's ends join only at a `
      + "shared point or a coin (never by touching), and lie in one plane");
  }
  const level = mine.filter((i) => parallel(all[i].plane.normal, n) && coplanarLoops(all[i], base));
  if (!level.length) {
    throw new Error(`"${member}"'s loop is not in ${r}'s plane — a region's faces lie in the plane of its first face, `
      + `${loopLabel(entry.steps[0].face)}: draw it there, or make a region of it on its own`);
  }
  let at: number;
  if (level.length === 1) at = level[0];
  else if (face != null) at = faceLoop(all, n, entry, { op, member, face: givenFace(face, member, op) }, base)!;
  else {
    throw new Error(`"${member}" is in ${level.length} loops in ${r}'s plane — ${level.map((i) => describeLoop(all[i], all)).join("; ")}. `
      + "Name a member only one of them has, or click the face with the region tool");
  }
  const names = faceNames(all[at]);
  const label = loopLabel(names);
  const after = withStep(model, r, before, op, at);
  // Compared by area: a cell's index names a face, and what the cell is —
  // the face less the faces named inside it — changes as faces are named.
  const [was, now] = [cellsArea(before), cellsArea(after)];
  if (Math.abs(now - was) <= 1e-9 * Math.max(1, was)) {
    throw new Error(op === "subtract" ? `${label} is not inside ${r} — subtracting it takes nothing away`
      : op === "add" ? `${label} is in ${r} already — adding it changes nothing`
        : `${r} is inside ${label} already — intersecting changes nothing`);
  }
  if (!after.cells.size || now <= 1e-9 * Math.max(1, was)) {
    throw new Error(op === "intersect" ? `${r} and ${label} share nothing — intersecting would leave ${r} empty`
      : `subtracting ${label} would leave ${r} empty — del("${r}") removes it`);
  }
  return { before, after, at, names };
}

/**
 * One step of a region's chain, made: where the face is, what it does to the
 * cells, the refusals, and the features on the region rebuilt. **Journalled
 * as the call with the face resolved and what it rebuilt** —
 * `subtract("rg1", "c1", ["c1"], [["e1", [[…], […]]]])`, `regen`'s rule for
 * `regen`'s reason — and a replay handed both looks for nothing.
 */
function regionStep(model: Model, op: Exclude<RegionOp, "region">, r: string, member: string, face: unknown,
                    regenerated: unknown, notes: string[]): string {
  checkRegionName(model, r, op);
  checkCurve(model, member, op);
  const entry = model.regionEntry(r);
  if (regenerated != null) {
    const given = givenRegenerated(regenerated, op);
    const names = givenFace(face, member, op);
    return model.asOperation(op, [r, member, names, given], () => {
      entry.steps.push({ op, member, face: names });
      regenerateGiven(model, given);
      return r;
    });
  }
  const { after, names } = planRegionStep(model, op, r, member, face);
  // Every feature on the region must stand on what it becomes: asked now, so
  // a refusal is a refusal and nothing has changed.
  const on = model.featuresOnRegion(r);
  if (on.length) {
    const b = regionBoundary(model, r, after);
    for (const f of on) {
      const p = profileOfLoops(model, b.all, b.loops, f.frame);
      if (f.kind === "revolve") checkRevolve(model, p, f.axis);
      planRegen(model, f, p);
    }
  }
  let out: Regenerated[] = [];
  return model.asOperation(op, () => [r, member, names, out], () => {
    entry.steps.push({ op, member, face: names });
    if (on.length) out = regenerateFound(model, on.map((f) => f.name), null, notes);
    return r;
  });
}

/**
 * **A region loses the faces a deletion takes** (the decision this package
 * made, docs/plans/regions-as-operations.md): the steps at `indices` come out
 * of `r`'s chain, and the features on it are rebuilt — a hole whose circle is
 * deleted is filled, as it was before regions (explicit-regions.md). What a
 * deletion's or a flag's expansion journals ahead of itself, with what it
 * rebuilt resolved: `deleteRegionSteps("rg1", [1], [["e1", [[…]]]])`. Never
 * typed: `del` decides it. The first face going takes the region instead
 * (`deleteRegion`), as a feature's outline going takes the feature.
 */
export function deleteRegionSteps(model: Model, r: string, indices: unknown, regenerated?: unknown): string {
  checkRegionName(model, r, "deleteRegionSteps");
  const entry = model.regionEntry(r);
  const ks = Array.isArray(indices) ? [...new Set(indices as number[])].sort((a, b) => b - a) : [];
  if (!ks.length || ks.some((k) => !Number.isInteger(k) || k < 1 || k >= entry.steps.length)) {
    throw new Error(`deleteRegionSteps takes the indices of steps after ${r}'s first face — 1 to ${entry.steps.length - 1}`);
  }
  const drop = () => { for (const k of ks) model.removeRegionStep(r, k); };
  const journalled = [...ks].reverse();
  if (regenerated != null) {
    const given = givenRegenerated(regenerated, "deleteRegionSteps");
    return model.asOperation("deleteRegionSteps", [r, journalled, given], () => { drop(); regenerateGiven(model, given); return r; });
  }
  const on = model.featuresOnRegion(r);
  let out: Regenerated[] = [];
  return model.asOperation("deleteRegionSteps", () => [r, journalled, out], () => {
    drop();
    if (on.length) out = regenerateFound(model, on.map((f) => f.name), null);
    return r;
  });
}

/** Whether a step's face names any of `names` — its member, or a member it was resolved to. */
function stepNames(s: RegionStep, names: ReadonlySet<string>): boolean {
  return names.has(s.member) || s.face.some((m) => names.has(memberName(m)));
}

/**
 * What a deletion (or a construction flag) of `names` does to the regions,
 * planned before anything changes: each region whose later step's face names
 * one of them loses that step (`deleteRegionSteps`) — runs returned, to be run
 * ahead of the deletion, so the features on it are rebuilt while the face is
 * still there to leave out. A region whose first face is named is left to the
 * cascade (`regionsGone`).
 */
function regionsLosing(model: Model, names: ReadonlySet<string>): (() => string[])[] {
  const runs: (() => string[])[] = [];
  for (const r of model.regions.values()) {
    if (stepNames(r.steps[0], names)) continue;
    const ks = r.steps.map((_, k) => k).filter((k) => k > 0 && stepNames(r.steps[k], names));
    if (!ks.length) continue;
    const name = r.name;
    runs.push(() => {
      const had = model.featuresOnRegion(name).flatMap((f) => f.owns);
      deleteRegionSteps(model, name, ks);
      return had.filter((n) => !model.has(n));
    });
  }
  return runs;
}

/**
 * The regions whose first face a deletion took, once the cascade has taken
 * the features on them: each deleted (`deleteRegion`), as a feature whose
 * outline goes is.
 */
function regionsGone(model: Model, gone: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const r of [...model.regions.values()]) {
    if (!stepNames(r.steps[0], gone) || model.featuresOnRegion(r.name).length) continue;
    model.deleteRegion(r.name);
    out.push(r.name);
  }
  return out;
}

/**
 * A new feature's region, made for it on the way — a bare face is a region of
 * one operation (`extrude("l1", 10)` makes `rg1`), and a profile given with
 * loops inside its outline is that face with each inner loop subtracted (a
 * hole, an odd number of loops down) or added back (an island, even) — so
 * the feature stands on a region like every other. `make` builds the feature
 * on it; the region's entries are journalled ahead of the feature's, and a
 * feature that refuses takes the region with it, so the call still refuses
 * before it changes anything.
 */
function onNewRegion(model: Model, profile: Profile, named: string, make: (r: string) => string): string {
  const at = model.journal.length;
  const loops = profile.loops;
  const member = loops[0].some((m) => memberName(m) === named) ? named : memberName(loops[0][0]);
  const names = (l: ProfileMember[]) => [...new Set(l.map(memberName))];
  const ops = innerOps(model, loops);
  const first: RegionStep = { op: "region", member, face: names(loops[0]) };
  const entry = model.addRegion(profile.frame, first);
  const rest: RegionStep[] = loops.slice(1).map((l, k) => ({ op: ops[k], member: memberName(l[0]), face: names(l) }));
  entry.steps.push(...rest);
  let out: string;
  try {
    out = make(entry.name);
  } catch (e) {
    model.forgetRegion(entry.name);
    throw e;
  }
  if (model.journalling) {
    model.journal.splice(at, 0, { op: "region", args: [member, profile.frame, first.face] },
      ...rest.map((s) => ({ op: s.op, args: [entry.name, s.member, s.face, []] })));
  }
  return out;
}

/**
 * For each loop after a profile's first, the region operation that gives it
 * the even-odd meaning the profile has: `subtract` for a hole (an odd number
 * of loops below the outline), `add` for an island (even) — read off the
 * drawing as it stands, each loop found by its members. One the drawing
 * cannot answer for is a hole, as most are. What a new feature given its
 * loops and an older file's feature with holes become (persist.ts).
 */
export function innerOps(model: Model, loops: readonly ProfileMember[][]): Exclude<RegionOp, "region">[] {
  const ops: Exclude<RegionOp, "region">[] = loops.slice(1).map(() => "subtract");
  if (loops.length < 2) return ops;
  let all: Loop[];
  try {
    all = findLoops(model);
  } catch {
    return ops;
  }
  const find = (l: readonly ProfileMember[]) => {
    const want = new Set(l.map(memberName));
    const hits = all.map((_, i) => i).filter((i) => {
      const has = faceNames(all[i]);
      return has.length === want.size && has.every((n) => want.has(n));
    });
    return hits.length === 1 ? hits[0] : null;
  };
  const outline = find(loops[0]);
  if (outline === null) return ops;
  const inner = loops.slice(1).map(find);
  const tree = faceTree(model, all, [outline, ...inner.filter((i): i is number => i !== null)]);
  return inner.map((i) => {
    const d = i === null ? 1 : treeDepth(tree, i, outline);
    return d > 0 && d % 2 === 0 ? "add" : "subtract";
  });
}

// --- a region's membership: hole and unhole -------------------------------------

/**
 * The loop of `all` that `hole(f, member)` would add — the loop `member` is in,
 * parallel to `f`'s sketch frame, inside its outline, and not a hole of it
 * already — or the refusal that says what would work. Asks nothing of the
 * model but loops: the menu asks it of every feature to offer *Add as hole*.
 */
export function holeLoop(model: Model, f: FeatureEntry, member: string, r: FeatureRegion): number {
  const e = typeof member === "string" ? model.entities.get(member) : undefined;
  if (!e || !isProfileKind(e.kind)) {
    throw new Error(`${JSON.stringify(member)} is not ${PROFILE_KINDS} — hole names a member of the loop to cut through ${f.name}`);
  }
  if (model.isConstruction(member)) throw new Error(constructionBoundsNothing(member, "hole"));
  const { all, outline } = r;
  const outlineText = loopLabel(f.loops[0]);
  const withIt = all.map((_, i) => i).filter((i) => all[i].members.some((m) => m.name === member));
  if (!withIt.length) {
    throw new Error(`${member} is in no closed loop — loops() lists the loops there are. A loop's ends join only at a `
      + "shared point or a coin (never by touching), and lie in one plane");
  }
  const n = planeAxes(model, f.frame)!.n;
  const level = withIt.filter((i) => parallel(all[i].plane.normal, n));
  if (!level.length) {
    throw new Error(`${member}'s loop is not parallel to ${f.name}'s sketch frame ${f.frame} — a hole lies in the plane `
      + `of the outline it is cut through: draw it on ${f.frame}, or extrude it on its own`);
  }
  const others = level.filter((i) => i !== outline);
  if (!others.length) throw new Error(`${member} is part of ${f.name}'s outline ${outlineText} — a hole is a loop inside it`);
  const inside = others.filter((i) => within(model, all, i, outline));
  if (!inside.length) {
    throw new Error(`${member} is not inside ${f.name}'s outline ${outlineText} — move it in, or extrude it on its own`);
  }
  const fresh = inside.filter((i) => !r.holes.includes(i));
  if (!fresh.length) throw new Error(`${member} is already a hole of ${f.name}`);
  if (fresh.length > 1) {
    throw new Error(`${member} is in ${fresh.length} loops inside ${f.name}'s outline — `
      + `${fresh.map((i) => describeLoop(all[i], all)).join("; ")}. Name a member only one of them has`);
  }
  return fresh[0];
}

/**
 * Which of `f`'s recorded inner loops `unhole(f, member)` would take out, as an
 * index into `f.loops` (1 or more) — the hole whose loop `member` is in now,
 * or whose record names it — or the refusal, which says which holes there are.
 */
export function holeIndex(model: Model, f: FeatureEntry, member: string, r: FeatureRegion): number {
  for (let k = 1; k < f.loops.length; k++) {
    const at = r.holes[k - 1];
    if (at !== null && r.all[at].members.some((m) => m.name === member)) return k;
  }
  for (let k = 1; k < f.loops.length; k++) if (f.loops[k].some((m) => memberName(m) === member)) return k;
  const holes = f.loops.slice(1).map(loopLabel);
  throw new Error(`${JSON.stringify(member) ?? String(member)} is not a hole of ${f.name} — `
    + (holes.length ? `its ${holes.length === 1 ? "hole is" : "holes are"} ${holes.join(", ")}` : `${f.name} has no holes`));
}

/**
 * The shortest member to type `hole(f, member)` with for the loop at `index`:
 * one whose loop `holeLoop` finds to be that very loop — a whole member if one
 * will do, the loop's own first member otherwise. Null when no member names it
 * alone (what the edit dialog then says rather than types).
 */
export function holeNaming(model: Model, f: FeatureEntry, r: FeatureRegion, index: number): string | null {
  const names = [...new Set(r.all[index].members.map((m) => m.name))];
  for (const n of names) {
    try {
      if (holeLoop(model, f, n, r) === index) return n;
    } catch {
      // not this one
    }
  }
  return null;
}

/** `holeNaming` for `unhole`: a member that names the recorded hole `k` (an index into `f.loops`). */
export function unholeNaming(model: Model, f: FeatureEntry, r: FeatureRegion, k: number): string | null {
  const at = r.holes[k - 1];
  const names = [...new Set([...(at === null ? [] : r.all[at].members.map((m) => m.name)), ...f.loops[k].map(memberName)])];
  for (const n of names) {
    try {
      if (holeIndex(model, f, n, r) === k) return n;
    } catch {
      // not this one
    }
  }
  return null;
}

/**
 * **Cuts the loop `member` is in through the feature** — `hole("e1", "c1")` —
 * adding it to the record, and regenerating: a twin and walls for it as the
 * expansion makes them, everything else kept. Returns the feature's name.
 *
 * The record is the region's membership (`featureRegion`): its outline, then
 * the loops the user confirmed — at the creating click, which proposes every
 * loop inside, or here. Nothing else adds to it: not drawing a circle inside,
 * not `regen`, not clearing a construction flag. A loop inside a hole is an
 * island, and even-odd makes it solid, so `hole` on a circle inside a hole is
 * how an island is put back. A revolve takes it the same way: turned, a hole
 * is a tunnel round the axis.
 *
 * Refuses, saying what would work, a member that is no line, arc or circle,
 * construction, in no closed loop, in a loop not parallel to the feature's
 * sketch frame, part of the outline, not inside it ("move it in, or extrude it
 * on its own"), or already a hole — before anything changes.
 *
 * An operation: it re-points a feature's structure. **Journalled as the call
 * with what it rebuilt resolved**, as `regen` is — `hole("e1", "c1", [["e1",
 * [[…], […]]]])` — and for `regen`'s reason: a replay handed the list walks
 * the profiles by their joins and finds nothing. It regenerates as `regen`
 * does, so a recorded hole since gone is filled on the way (`notes`).
 */
export function hole(model: Model, feature: string, member: string, regenerated?: unknown, notes: string[] = []): string {
  return membership(model, "hole", feature, member, regenerated, notes);
}

/**
 * **Fills a hole** — `unhole("e1", "c1")`: the recorded inner loop `member` is
 * in (or that names it) taken out of the record, and every recorded loop inside
 * it with it, since an island has no hole to be an island in once the hole is
 * filled. Then a regeneration, as `hole`'s. Refuses a member that is no hole of
 * the feature, naming the holes it has. Journalled as `hole` is.
 */
export function unhole(model: Model, feature: string, member: string, regenerated?: unknown, notes: string[] = []): string {
  return membership(model, "unhole", feature, member, regenerated, notes);
}

function membership(model: Model, op: "hole" | "unhole", feature: string, member: string,
                    regenerated: unknown, notes: string[]): string {
  checkFeatureName(model, feature, op);
  if (regenerated != null) {
    const given = givenRegenerated(regenerated, op);
    return model.asOperation(op, [feature, member, given], () => { regenerateGiven(model, given); return feature; });
  }
  const f = model.featureOf(feature);
  const r = featureRegion(model, f);
  if (f.region !== undefined && model.regions.has(f.region)) {
    // **An alias, now** (docs/plans/regions-as-operations.md): the feature's
    // region gets the step that gives the loop the meaning `hole` and
    // `unhole` always gave it by even-odd — a loop whose cell the region
    // holds is subtracted, one it does not (a hole's island, a hole being
    // filled) is added back — and the step regenerates every feature on the
    // region. Journalled as that step, in today's vocabulary.
    const at = op === "hole" ? holeLoop(model, f, member, r) : r.holes[holeIndex(model, f, member, r) - 1];
    if (at === null) {
      throw new Error(`${member}'s loop is gone — regen("${feature}") fills the hole it was`);
    }
    const v0 = regionValue(model, f.region, r.all);
    // The loop's own cell: named already, or else its smallest named container's.
    const around = v0.parent.has(at) ? at : faceTree(model, r.all, [...v0.parent.keys(), at]).get(at) ?? null;
    const step = around !== null && v0.cells.has(around) ? "subtract" : "add";
    const face = faceNames(r.all[at]);
    regionStep(model, step, f.region, face.includes(member) ? member : face[0], face, undefined, notes);
    return feature;
  }
  const said: string[] = [];
  let loops: number[];
  if (op === "hole") {
    const add = holeLoop(model, f, member, r);
    loops = [r.outline, ...r.holes.filter((i): i is number => i !== null), add];
  } else {
    const k = holeIndex(model, f, member, r);
    const at = r.holes[k - 1];
    loops = [r.outline, ...r.holes.filter((i, j): i is number => i !== null && j !== k - 1
      && (at === null || depthBelow(r.all, i, at) === 0))];
  }
  f.loops.slice(1).forEach((rec, k) => {
    if (r.holes[k] === null) said.push(`${f.name}: hole ${loopLabel(rec)} is gone, filled`);
  });
  const profile = profileOfLoops(model, r.all, loops, f.frame, f.kind === "extrude" ? EXTRUDE : REVOLVE);
  if (f.kind === "revolve") checkRevolve(model, profile, f.axis);
  const plan = planRegen(model, f, profile);
  let out: Regenerated[] = [];
  const done = model.asOperation(op, () => [feature, member, out], () => {
    out = regenerateFound(model, [feature], plan, said);
    return feature;
  });
  notes.push(...said);
  return done;
}

/**
 * **A recorded hole's loop going away fills the hole**, whichever way it goes:
 * its circle deleted (`del`), or one of its members made construction
 * (`construction`), which is the same thing as far as regions go. Each feature
 * that names one of `names` only in its holes — never its outline, never
 * anything it made, never its frame — has those holes taken out of its record,
 * every recorded loop inside them with them, and is rebuilt from the record
 * that is left. A feature that names one elsewhere is left to the caller: the
 * cascade takes its record, as deleting an outline member always has.
 *
 * The record's own loops are rebuilt, not loops found again: this is the
 * hole's going, not a regeneration. Each feature's rebuild is an `unhole`
 * entry in the journal — `unhole("e1", "c1", [["e1", loops]])`, the hole named
 * by its first member — journalled before what the caller journals next, so a
 * replay fills the hole and then deletes or flags as the call did. Planned in
 * full first and only then run, so a caller that must refuse before it changes
 * anything can. Returns, per feature, a function that runs it and answers the
 * names its rebuild removed.
 */
function holesGoing(model: Model, names: ReadonlySet<string>, flagging: boolean): (() => string[])[] {
  const loopNames = (l: ProfileMember[]) => l.flatMap((m) => (typeof m === "string" ? [m] : [m.name, m.from, m.to]));
  const runs: (() => string[])[] = [];
  for (const f of model.features.values()) {
    // A feature on a region is the region's to rebuild (`regionsLosing`).
    if (f.region !== undefined && model.regions.has(f.region)) continue;
    const hit = f.names.filter((n) => names.has(n));
    if (!hit.length) continue;
    const holed = f.loops.map((_, i) => i).filter((i) => i > 0 && loopNames(f.loops[i]).some((n) => names.has(n)));
    if (!holed.length) continue;
    // What the holes' own expansion is — their twins, and the walls standing
    // at their corners — goes with them anyway, so a deletion reaching it (a
    // hole's corner takes its wall) is still only the hole going.
    const corners = (l: ProfileMember[]) => l.flatMap((m) => {
      const e = model.entities.get(memberName(m));
      return e?.kind === "line" ? [...e.refs] : e?.kind === "arc" ? [e.start, e.end] : [];
    });
    const kept = f.loops.filter((_, i) => !holed.includes(i));
    const keptCorners = new Set(kept.flatMap(corners));
    const holeCorners = new Set(holed.flatMap((i) => corners(f.loops[i])).filter((p) => !keptCorners.has(p)));
    const holeMade = new Set([
      ...holed.flatMap((i) => f.twins[i] ?? []),
      ...(f.kind === "extrude" ? f.walls.filter((w) => holeCorners.has(model.line(w).refs[0])) : []),
    ]);
    const holeNames = new Set([...holed.flatMap((i) => loopNames(f.loops[i])), ...holeMade]);
    const elsewhere = new Set([
      ...kept.flatMap(loopNames),
      ...planeNames(model, f.frame), ...(f.kind === "revolve" ? planeNames(model, f.axis) : []),
      // A flag never reaches what the feature made (construction refuses an
      // owned twin of a profile no more than it does any curve); a deletion does.
      ...(flagging ? [] : f.owns.filter((n) => !holeMade.has(n))),
    ]);
    if (hit.some((n) => elsewhere.has(n) || !holeNames.has(n))) continue;
    // The loops inside a hole going go with it — read off the drawing while
    // the hole is still in it. A region that cannot be read leaves them.
    const drop = new Set(holed);
    try {
      const r = featureRegion(model, f);
      for (let k = 1; k < f.loops.length; k++) {
        const at = r.holes[k - 1];
        if (at === null) continue;
        if (holed.some((h) => r.holes[h - 1] !== null && depthBelow(r.all, at, r.holes[h - 1]!) > 0)) drop.add(k);
      }
    } catch {
      // only the holes named
    }
    const left = f.loops.filter((_, i) => !drop.has(i));
    const plan = planSweep(model, givenProfile(model, f.member, f.frame, left, f.kind === "extrude" ? EXTRUDE : REVOLVE));
    const name = f.name;
    const first = memberName(f.loops[holed[0]][0]);
    runs.push(() => {
      const had = [...model.featureOf(name).owns];
      model.asOperation("unhole", () => [name, first, [[name, resolvedLoops(plan)]]],
        () => rebuildFeature(model, model.featureOf(name), plan));
      return had.filter((n) => !model.has(n));
    });
  }
  return runs;
}

// --- construction geometry --------------------------------------------------

/** Whether `name` is something that can carry the construction flag: a line, an arc, a circle, or a declared curve (an ellipse, a spline). */
function takesConstruction(model: Model, name: string): boolean {
  return isCurveKind(model.entities.get(name)?.kind);
}

/**
 * `construction(...names)` flags lines, arcs and circles as **construction
 * geometry** — still constrained, solved, picked and snapped to, but forming no
 * regions (loops.ts) — and `construction(...names, false)` clears it. One word
 * with a value rather than a pair of words (`real(…)`), because the flag is a
 * value: it is what a drawing tool's `construction` option sets, and
 * `{ construction: false }` and `construction("c1", false)` should read alike.
 *
 * **Groups and features expand at the call, and the journal says what they
 * expanded to.** The owner, on why it is per entity: *"if it is a group based
 * inherited thing, then geometry could be both construction geometry and not
 * construction geometry simultaneously"*. So `construction("g1")` flags each
 * of g1's members now, and nothing g1 does later — gaining a line, losing one —
 * changes any entity's flag; the entry is `construction("l1", "l2", …)`, the
 * curves whose flag changed, so a replay cannot read the group any other way.
 * Points, frames and relations among the names (a box-selected batch, a
 * group's corners) are passed over — they bound nothing, so they have no flag
 * — and only a call that names no line, arc or circle at all is refused.
 *
 * **A feature's outline member is refused**, by name: the solid stands on that
 * boundary, and an outline flagged construction under it would be a feature
 * whose profile no longer exists — a deletion, as the outline's going is to
 * `regen`. **A hole's member fills the hole**: flagged, it bounds nothing, so
 * the hole's loop has gone, and a hole whose loop goes is filled however it
 * went (`holesGoing`, as `del` of the circle does). The fill is journalled as
 * the `unhole` it is, before this call's own entry, inside the same call and so
 * the same undo step. **Clearing adds no hole**: a circle made real inside an
 * outline is not part of the region until `hole("e1", "c1")` says so — the
 * owner's *"I don't think coplanarity should be used as an automatic basis for
 * deciding which entities to include in a region."*
 *
 * A call that changes nothing journals nothing, so it is no undo step — `hide`'s
 * rule. Returns the names whose flag changed.
 */
export function construction(model: Model, ...args: unknown[]): string[] {
  const on = typeof args.at(-1) === "boolean" ? (args.pop() as boolean) : true;
  for (const a of args) {
    if (typeof a !== "string") {
      throw new Error(`construction takes names, then true or false — and ${JSON.stringify(a) ?? String(a)} is neither`);
    }
  }
  const given = args as string[];
  if (!given.length) throw new Error("construction needs a name — of a line, arc or circle, a group or a feature");
  const curves = model.expand(given, "construction").filter((n) => takesConstruction(model, n));
  if (!curves.length) {
    const list = given.map((n) => `"${n}"`).join(", ");
    throw new Error(`${list} ${given.length === 1 ? "has" : "have"} no line, arc or circle in ${given.length === 1 ? "it" : "them"} — `
      + "only they bound regions, so only they can be construction");
  }
  const changed = curves.filter((n) => model.isConstruction(n) !== on);
  if (!changed.length) return [];
  let fills: (() => string[])[] = [];
  if (on) {
    for (const f of featuresOnProfile(model, changed)) {
      const held = changed.filter((n) => f.loops[0].some((m) => memberName(m) === n));
      if (!held.length) continue;
      throw new Error(`"${held[0]}" is part of ${f.name}'s outline — a solid's outline cannot stop being a boundary under it. `
        + `del("${f.name}") keeps the sketch and removes the solid; then it can be construction`);
    }
    fills = [...regionsLosing(model, new Set(changed)), ...holesGoing(model, new Set(changed), true)];
  }
  for (const fill of fills) fill();
  return model.asOperation("construction", on ? changed : [...changed, false], () => {
    for (const n of changed) model.setConstruction(n, on);
    return changed;
  });
}

// --- editing a dimension ----------------------------------------------------

/**
 * How each dimension is re-run from its recorded arguments. One line per op,
 * and deliberately not a lookup into `replenv`'s table or `persist`'s: both of
 * those sit *above* this file, and a dimension has to be rebuildable by the
 * layer that owns operations.
 */
const REBUILD: Record<string, (model: Model, args: unknown[]) => void> = {
  dist: (m, a) => void dist(m, a[0] as string, a[1] as string, a[2] as number),
  radius: (m, a) => void radius(m, a[0] as string, a[1] as number),
  diameter: (m, a) => void diameter(m, a[0] as string, a[1] as number),
  angle: (m, a) => void angle(m, a[0] as string, a[1] as string, a[2] as number),
  // An extrude's depth: the whole lid, one value. Without this line `set` on
  // one throws — `test/dimensions.test.ts` drives every dimension through here.
  extrusion: (m, a) => void extrusion(m, a[0] as string, a[1] as number, ...(a.slice(2) as string[])),
  // A revolve's angle: the whole end face, one value — and the refusals across
  // the full/partial line live in the relation, so a `set` meets them here.
  revolution: (m, a) => void revolution(m, a[0] as string, a[1] as number, ...(a.slice(2) as string[])),
};

/**
 * How a module's dimension is re-run (../modules.ts): the relation's own
 * function over its recorded arguments, which is all every row above is.
 */
export function defineRebuild(op: string, rebuild: (model: Model, args: unknown[]) => void): void {
  REBUILD[op] = rebuild;
}

/**
 * The half of every "that has no value" message that says what does. Written
 * in the *short* names, because those are what the user typed to make one —
 * being told about `radius` after typing `rad` is a small riddle to no purpose.
 */
const onlyDims = `only dist, rad, dia, ang, an ellipse's major and minor, an extrude's depth and a revolve's angle have a .${SETTABLE_PROPERTY}`;

/**
 * Changes a dimension's value: `set("d4.value", 60)`.
 *
 * This is the owner's answer to how a dimension is edited, and the shape of it
 * follows from his words — *"a `set(d4.value, 60)` where d4 is the dimension"*.
 * There is no parameter table anywhere: the dimension **is** the named
 * value-holder, which is why `dist`, `rad` and `ang` claim `d` names in the
 * first place (see `DIMENSION_OPS`).
 *
 * **An operation, not a relation.** It does not add an equation — it replaces
 * one, taking the relation's residual blocks out of the problem and putting
 * fresh ones in. That is structure-adjacent bookkeeping of exactly the kind
 * `operations.ts` exists to hold apart, and it is reviewable on the operation's
 * terms: it can leave the drawing over- or under-constrained (so can any
 * dimension), and it must not be able to leave it malformed. `rebuildRelation`
 * is where that last guarantee lives — a body that throws leaves the old blocks
 * in place, so a rejected value costs nothing.
 *
 * **In place, under the same name.** `d4` is still `d4` afterwards, still in
 * the same position in the registry, with its `args` updated — so `rels()`, the
 * glyph's label and `del`'s reference scan all tell the truth about it without
 * being told anything. That is the whole point of the dimension being named.
 *
 * **The unit is what the relation stores**, which for `ang` means radians. The
 * label on the drawing reads degrees, and that seam is documented rather than
 * papered over here: guessing at the caller's intent from the size of the
 * number would be worse than one honest unit. See `glyphs.ts`'s `labelFor`.
 *
 * Journalled as the one call the user made, so a replay re-runs `set` rather
 * than the relation it rebuilt — which keeps a saved file a transcript of what
 * was typed. One user action, so one undo step; the host re-solves afterwards
 * (see `replenv.ts`), for the reason `del` does: an edit whose entire purpose
 * is to change the answer must not leave a stale verdict on the header.
 *
 * Returns the dimension's name, unchanged — that being the claim worth making.
 */
export function set(model: Model, path: string, value: number): string {
  const { name } = parseValueRef(path);
  // One sentence for "there is nothing here to set", whatever the reason —
  // wrong kind of thing, or nothing of that name at all. What the reader needs
  // either way is which relations *do* have a value.
  if (!model.relations.has(name)) {
    const what = model.entities.has(name) ? `is an entity, not a dimension` : `is not a relation`;
    throw new Error(`"${name}" ${what} — ${onlyDims}`);
  }
  const entry = model.relationOf(name);
  const at = valueArgIndex(entry.op);
  if (at === null) {
    throw new Error(`"${name}" is a ${entry.op}, not a dimension — ${onlyDims}`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    // Radians named in the message rather than only in the docs: this is the
    // throw a user reaches while holding the wrong unit in their head.
    const unit = entry.op === "angle" || entry.op === "revolution"
      ? " of radians (the label reads degrees; the relation stores radians)" : "";
    throw new Error(`set needs a number${unit}, got ${JSON.stringify(value)}`);
  }
  const args = entry.args.slice();
  args[at] = value;
  const rebuild = REBUILD[entry.op];
  if (!rebuild) throw new Error(`"${entry.op}" cannot be rebuilt`); // unreachable: DIMENSION_OPS and REBUILD agree
  return model.asOperation("set", [path, value], () => {
    model.rebuildRelation(name, entry.op, args, () => rebuild(model, args));
    return name;
  });
}

// --- deletion ---------------------------------------------------------------

/**
 * Deletes an entity, a relation or a feature by name, taking with it whatever
 * could not survive without it. Returns the names it removed, deletion order
 * first.
 *
 * The cascade is Onshape's, and deliberately so — people arrive knowing it:
 *
 * - a **relation** takes nothing else. Removing a constraint is the one
 *   deletion that cannot break anything: the drawing is simply freer.
 * - a **point** takes everything that references it — a line's endpoint, a
 *   circle's centre, an arc's centre/start/end — recursively, and then every
 *   relation naming any of them. The alternative is a line whose endpoint
 *   does not exist, which is not an over-constrained model the solver can
 *   complain about but a model that throws the next time it is drawn.
 * - a **line, circle or arc** takes the relations naming it and nothing more.
 *   Its points were the user's points first, and are usually still wanted.
 * - a **feature** takes what it made and never what it was built on; and
 *   anything a feature's record names takes the record with it — see
 *   `delOne`. Both are the same inward rule, read from the record's side.
 *
 * **The confirmation is undo, not a prompt.** `del` is one user action, so a
 * cascade that took more than was meant is one Ctrl+Z from harmless — the
 * pattern `open()` already set. That is also why the removed names are
 * returned rather than merely logged: "what did that just take with it" is a
 * question worth being able to answer afterwards.
 *
 * **Variables are tombstoned, not compacted.** A deleted point's variables
 * stay in the flat vector, referenced by nothing; the damped solve leaves
 * orphans exactly where they are, so they cost memory and not correctness.
 * Compaction means remapping every captured index list inside every closure —
 * real work with real risk, and the boring design ships first. The leak is
 * bounded by how much a session deletes, and a save/reopen does not shed it
 * either: replay re-runs the same creates and the same deletes.
 *
 * This is an *operation*, not a relation: it changes structure rather than
 * adding equations, and it can leave the model malformed if the cascade is
 * wrong. It is journalled as its **expansion** — one `deleteEntity` or
 * `deleteRelation` per name — rather than as the single `del` call, so a
 * replay removes exactly what was removed rather than recomputing a cascade
 * against a model that may since have been built differently.
 *
 * **Several names at once are one call and one cascade each, in order.**
 * `del("p1", "l5", …)` is what a box select naturally produces. Every name is
 * checked before anything is removed — a typo in the middle of a batch costs
 * nothing rather than half the batch — and a name an earlier cascade already
 * took is skipped silently: handing over a point and the line that depends on
 * it is the normal shape of a box-selected batch, not a mistake.
 *
 * **A group named is ungrouped** — the grouping goes, its members stay, since
 * a group owns nothing (groups.ts). A group the cascade empties stays, empty
 * (docs/plans/organiser.md), so it is not among the names returned.
 */
export function del(model: Model, ...names: string[]): string[] {
  if (names.length === 0) throw new Error("del needs at least one name");
  // Validate every name before removing anything: a typo in the middle of a
  // box-selected batch should cost nothing, not leave half the batch gone.
  // (Undo would recover it, but an error that edits is still an error that
  // edits.)
  for (const n of names) {
    if (!model.has(n)) throw new Error(`"${n}" is not an entity or a relation (or a feature, or a group)`);
    // The origin answers to its name (`ORIGIN`) and is part of every model.
    if (n === ORIGIN) throw new Error("the origin is part of every model — it cannot be deleted");
  }
  const removed: string[] = [];
  for (const n of names) {
    // An earlier name's cascade may already have taken this one — a box
    // select hands over a point *and* the line on it, and deleting the point
    // deletes the line. Already-gone is the cascade working, not an error.
    if (!model.has(n)) continue;
    if (model.groups.has(n)) {
      ungroup(model, n);
      removed.push(n);
      continue;
    }
    removed.push(...delOne(model, n));
  }
  return removed;
}

/**
 * One name's cascade. A **feature** follows the same two rules, read the way a
 * relation reads them:
 *
 * - its record names everything it was built on and made (see `FeatureEntry`),
 *   so deleting any of those — a profile member, a twin, a wall, the depth —
 *   takes the **record**, exactly as deleting a point takes a relation naming
 *   it, and takes nothing else beyond the ordinary cascade. The lid, the walls
 *   and the depth are ordinary geometry and relations and stay as they are,
 *   drawn without faces; undo is the confirmation if that was not the intent.
 * - `del("e1")` takes the record **and what the feature made** — its twins,
 *   walls, depth (and an old file's lid frame), with whatever needs those — and never the
 *   profile it was built on, which was the user's sketch before the feature
 *   existed. Onshape's rule: deleting an extrude keeps its sketch.
 */
function delOne(model: Model, name: string): string[] {
  // A region named goes with the features standing on it — each as del("e1")
  // takes it, the sketch kept — since a feature on no region has nothing to
  // regenerate from.
  if (model.regions.has(name)) {
    const out: string[] = [];
    for (const f of model.featuresOnRegion(name)) if (model.features.has(f.name)) out.push(...cascade(model, f.name));
    model.deleteRegion(name);
    return [...out, name];
  }
  // A hole's circle deleted fills the hole; it never takes the solid. Done
  // first, so the record that is left names none of what goes next. On a
  // region, the region loses the face (`regionsLosing`).
  const filled: string[] = [];
  let going = new Set<string>();
  if (!model.features.has(name)) {
    going = model.entities.has(name) ? entityClosure(model, [name]) : new Set<string>();
    for (const run of regionsLosing(model, going)) filled.push(...run());
    for (const run of holesGoing(model, going, false)) filled.push(...run());
  }
  const rest = model.has(name) ? cascade(model, name) : [];
  // A region whose first face went goes too, once nothing stands on it.
  const regions = going.size ? regionsGone(model, new Set([...going, ...rest])) : [];
  return [...filled, ...rest, ...regions];
}

/** `delOne` once any hole it fills is filled: the inward rule, for records, relations and entities. */
function cascade(model: Model, name: string): string[] {
  // A fillet's or chamfer's record cascades as a feature's does (docs/plans/solid-fillets.md).
  // A surface's record too (docs/plans/surfaces.md): its dimension goes with it.
  const feature = model.features.get(name) ?? model.blends.get(name) ?? model.surfaces.get(name);
  const owned = (pred: (n: string) => boolean) => (feature ? feature.owns.filter(pred) : []);
  const seeds = feature ? owned((n) => model.entities.has(n)) : model.entities.has(name) ? [name] : [];
  const asked = new Set(feature ? owned((n) => model.relations.has(n)) : model.relations.has(name) ? [name] : []);

  const doomed = entityClosure(model, seeds);
  // Every relation that names anything on the way out, plus the relations
  // asked for. "Names" goes through `referentsOf`, so a frame referenced only by
  // an axis (`par("l1","f.x")`) still takes that relation with it, and so
  // does a face's `"p1.p2.p3"` any of its three points — see
  // `Model.relationsNaming`.
  const relations = [...model.relations.values()]
    .filter((r) => asked.has(r.name) || r.args.some((a) => referentsOf(a).some((n) => doomed.has(n))))
    .map((r) => r.name);
  // Every record naming anything on the way out — the inward rule — plus the
  // feature asked for.
  const going = new Set([...doomed, ...relations]);
  const features = [...model.features.values(), ...model.blends.values()]
    .filter((f) => f.name === name || f.names.some((n) => going.has(n)))
    .map((f) => f.name);
  // Surfaces naming anything on the way out — a curve swept, a feature a face
  // was taken from, a surface trimmed by or knitted — and the records changing
  // those, transitively; each with its own dimension.
  const gone = new Set([...going, ...features]);
  for (let grew = true; grew;) {
    grew = false;
    for (const sf of model.surfaces.values()) {
      if (gone.has(sf.name)) continue;
      if (sf.name === name || sf.names.some((n) => gone.has(n)) || (sf.into !== undefined && gone.has(sf.into))) {
        gone.add(sf.name);
        features.push(sf.name);
        for (const d of sf.owns) if (model.relations.has(d) && !relations.includes(d)) relations.push(d);
        grew = true;
      }
    }
  }

  const removed: string[] = [];
  // Records first, since they name relations and entities alike and the
  // primitives refuse while one does; then relations, since an entity cannot go
  // while something still constrains it.
  for (const f of features) {
    model.deleteFeature(f);
    removed.push(f);
  }
  for (const r of relations) {
    model.deleteRelation(r);
    removed.push(r);
  }
  // Then entities, dependents before the things they depend on. A pass at a
  // time rather than a hand-written order, so this stays right if an entity
  // kind that references another entity is ever added.
  const left = new Set(doomed);
  while (left.size) {
    const ready = [...left].filter((n) => model.dependents(n).length === 0);
    if (!ready.length) throw new Error(`cannot untangle the references around "${name}"`);
    for (const n of ready) {
      model.deleteEntity(n);
      removed.push(n);
      left.delete(n);
    }
  }
  return removed;
}

/**
 * The entities that cannot outlive `names`: themselves, whatever references
 * them, whatever references those, and so on. Several at once because a
 * feature's deletion starts from everything it made. In creation order, so the answer — and
 * therefore the journal a replay reads — does not depend on Set iteration
 * order of a worklist.
 *
 * Note the asymmetry that makes the cascade Onshape's rather than merely
 * transitive: it follows *references inward* (who needs me) and never outward
 * (what do I need). Deleting a line therefore reaches nothing, while deleting
 * one of its endpoints reaches the line.
 */
function entityClosure(model: Model, names: string[]): Set<string> {
  const found = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const n = queue.shift()!;
    if (found.has(n)) continue;
    found.add(n);
    for (const d of model.dependents(n)) queue.push(d.name);
  }
  const ordered = new Set<string>();
  for (const e of model.entities.values() as Iterable<Entity>) if (found.has(e.name)) ordered.add(e.name);
  return ordered;
}
