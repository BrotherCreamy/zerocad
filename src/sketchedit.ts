// Sketch editing (docs/plans/sketch-edit.md): trim, extend, offset, mirror,
// chamfer and the two patterns. The owner: *"give me better sketch tools,
// relations, trim, slot... all the usual"*.
//
// **Every one is an operation, never a relation** — each creates or re-points
// entities, which is the line CLAUDE.md draws — so each is here, at
// operations.ts's height (as blends.ts is), journalled as the one call the
// user made (`asOperation`) and replayed as that call. Where the call reads
// positions — where a curve is cut, which end is nearer, which way a chain
// turns — it **journals what it found, resolved**, and a replay is handed it,
// because a replay runs on seeds (ARCHITECTURE: "A saved file is a journal").
//
// **Every one refuses before it changes anything**, with a reason that says
// what would do instead, and never leaves the model malformed. The one that
// cannot know in advance — whether a feature standing on a trimmed curve can
// still find its profile — tries the change, asks, and takes it back itself,
// name counters and all, before it refuses (`trim`).
//
// **Every one is held by relations a person can see, hover and delete**, so
// what it made follows what it was made from: a trimmed end by `on` the curve
// that cut it, an offset by `par` and `dist`, a mirror by `sym`, a chamfer by
// `dist` from the corner it replaced, a pattern by the step its first copy
// takes (relations/pattern.ts).

import {
  type ArcEntity, type Entity, type FeatureDraft, type Model, ORIGIN, parseAxisRef, spanOf, unitOf,
} from "./model.ts";
import { dist, onPlane } from "./relations/basic.ts";
import {
  angle as angleRel, arcEndpoints, collinear, equalRadius, equalSpacing, intersection, onCircle, onEllipse, parallel,
  perpendicular, pointOnLine, radius as radiusRel, symmetric, tangent,
} from "./relations/geometry.ts";
import { rotated, rotation, translated } from "./relations/pattern.ts";
import { addSpline, onSpline } from "./relations/spline.ts";
import {
  del, featuresTouching, givenRegenerated, regenerateAfter, regenerateNamed, regenerationRefusal, type Regenerated,
} from "./operations.ts";
import { cutsOf, fractionOn, reachOf, type CurveCut } from "./sketchgeom.ts";
import { heldOnCurves, joinClasses } from "./loops.ts";
import { curveFrame, sketchSide } from "./curveplane.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";

const TAU = Math.PI * 2;

// --- small pieces every edit shares ------------------------------------------

/** A curve's ends: a line's two points, an arc's start and end; none for a circle. */
function endsOf(e: Entity): string[] {
  if (e.kind === "line") return [...e.refs];
  if (e.kind === "arc") return [e.start, e.end];
  return [];
}

/** The relation that holds `p` on `curve` — `on`, `oncircle` or `onellipse` by its kind. */
function holdOn(model: Model, p: string, curve: string): string {
  const k = model.entities.get(curve)?.kind;
  if (k === "line") return pointOnLine(model, p, curve);
  if (k === "circle" || k === "arc") return onCircle(model, p, curve);
  if (k === "ellipse") return onEllipse(model, p, curve);
  // A spline cuts what it crosses (docs/plans/spline.md): the new end held on it, by its own parameter.
  if (k === "spline") return onSpline(model, p, curve);
  throw new Error(`"${curve}" is not a line, arc, circle, ellipse or spline`);
}

/**
 * Why a spline is refused by an edit that would cut, lengthen or offset it
 * (docs/plans/spline.md): a piece of a spline would be a spline through
 * points it does not go through, which nothing here makes yet. Said by name,
 * with what does work.
 */
function refuseSpline(model: Model, name: string, op: string): void {
  if (model.entities.get(name)?.kind !== "spline") return;
  const what = op === "trim" ? "trims nothing of one yet — a piece of a spline would be a spline through points it does not go through"
    : op === "extend" ? "does not lengthen one — drag its end out"
      : "does not offset one yet — an offset of a spline is no spline";
  throw new Error(`"${name}" is a spline, and ${op} ${what}. A spline does cut a line, an arc or a circle it crosses`);
}

/** Whether `p` is on `curve` already: one of its ends, or held there by a relation. */
function heldOn(model: Model, p: string, curve: string): boolean {
  const e = model.entities.get(curve);
  if (e && endsOf(e).includes(p)) return true;
  if (heldOnCurves(model).some((h) => h.point === p && h.curve === curve)) return true;
  return [...model.relations.values()].some((r) => r.op === "intersection" && r.args[0] === p && r.args.slice(1).includes(curve));
}

/** The feature that made `name`, when one did — a lid's edge, a wall: geometry a sketch edit must not reshape under it. */
function ownerOf(model: Model, name: string): string | null {
  for (const f of model.features.values()) if (f.owns.includes(name)) return f.name;
  return null;
}

function refuseOwned(model: Model, name: string, op: string): void {
  const f = ownerOf(model, name);
  if (f) throw new Error(`"${name}" is part of ${f}'s solid — ${op} the sketch it was made from, and ${f} follows it`);
}

/** A place, as the model's coordinates: a 3D model takes two (on z = 0) or three. */
function coordsOf(model: Model, at: unknown, op: string): number[] {
  const ok = Array.isArray(at) && at.every((v) => typeof v === "number" && Number.isFinite(v))
    && (at.length === model.dim || (model.dim === 3 && at.length === 2));
  if (!ok) throw new Error(`${op} takes a place as ${model.dim} numbers — [x, y${model.dim === 3 ? ", z" : ""}] — near the piece meant`);
  return model.dim === 3 && at.length === 2 ? [...at, 0] : [...at];
}

/** Whether a relation or a point may be taken by a sketch edit's tidying: nothing a feature's record names. */
function free(model: Model, name: string): boolean {
  return !model.featuresNaming(name).length && !model.blendsNaming(name).length;
}

/** `del` for the tidying after an edit — journalled as `del` journals, skipped where it would reach a feature. */
function tidy(model: Model, name: string): string[] {
  if (!model.has(name) || !free(model, name)) return [];
  try {
    return del(model, name);
  } catch {
    return [];
  }
}

/** The arcends relation of an arc, if it has one. */
function arcEndsOf(model: Model, arc: string): string | null {
  for (const r of model.relations.values()) if (r.op === "arcEndpoints" && r.args[0] === arc) return r.name;
  return null;
}

/** An arc's `arcends` re-made in place — same name — to hold the ends it has now. */
function rebuildEnds(model: Model, arc: string): void {
  const r = arcEndsOf(model, arc);
  if (r) model.rebuildRelation(r, "arcEndpoints", [arc], () => void arcEndpoints(model, arc));
}

// --- trim ---------------------------------------------------------------------

/** One end of a trimmed piece, as the journal keeps it: the curve that cut it there, the point already there (or null), and where. */
export type CutSpec = [string, string | null, number[]];

const specOf = (c: CurveCut): CutSpec => [c.by, c.point, c.at];

function checkTrimmable(model: Model, curve: unknown, op: "trim" | "extend"): Entity {
  const e = typeof curve === "string" ? model.entities.get(curve) : undefined;
  const takes = op === "trim" ? "a line, an arc or a circle" : "a line or an arc";
  if (!e) throw new Error(`${op} takes ${takes} by name — ${JSON.stringify(curve) ?? String(curve)} is none`);
  if (e.kind === "ellipse") throw new Error(`"${e.name}" is an ellipse, and there is no elliptical arc for a piece of one to be — ${op} takes ${takes}`);
  refuseSpline(model, e.name, op);
  if (op === "trim" ? !(e.kind === "line" || e.kind === "arc" || e.kind === "circle") : !(e.kind === "line" || e.kind === "arc")) {
    throw new Error(`"${e.name}" is a ${e.kind} — ${op} takes ${takes}`);
  }
  refuseOwned(model, e.name, op);
  return e;
}

/**
 * The piece of `curve` a place is on, between the cuts either side of it — the
 * curve's own end where there is no cut that way — or the refusal for a curve
 * nothing cuts. `lo` is the cut nearer the curve's start (a circle's: the one
 * the piece runs from, counter-clockwise), `hi` the other.
 */
export function trimPiece(model: Model, curve: string, at: number[]): { lo: CurveCut | null; hi: CurveCut | null } {
  const e = checkTrimmable(model, curve, "trim");
  const cuts = cutsOf(model, curve);
  if (e.kind === "circle") {
    if (cuts.length < 2) {
      throw new Error(`${curve} is cut ${cuts.length ? "only once" : "by nothing"} — a circle trims to an arc between two cuts. `
        + `del("${curve}") removes it whole`);
    }
    const tc = ((fractionOn(model, curve, at) % 1) + 1) % 1;
    let i = -1;
    for (let k = 0; k < cuts.length; k++) if (cuts[k].t <= tc) i = k;
    const lo = i < 0 ? cuts[cuts.length - 1] : cuts[i];
    const hi = cuts[(i + 1) % cuts.length];
    return { lo, hi };
  }
  if (!cuts.length) throw new Error(`nothing cuts ${curve} — there is no piece of it to trim back to. del("${curve}") removes it whole`);
  let tc = fractionOn(model, curve, at);
  if (e.kind === "arc") {
    // A place off the arc's sweep means the nearer end.
    const sweep = curveFrame(model, e)!.sweep;
    if (tc > 1) tc = (tc * sweep - sweep) < (TAU - tc * sweep) ? 1 : 0;
  } else {
    tc = Math.min(1, Math.max(0, tc));
  }
  let lo: CurveCut | null = null, hi: CurveCut | null = null;
  for (const c of cuts) {
    if (c.t < tc) lo = c;
    else if (hi === null) hi = c;
  }
  return { lo, hi };
}

/** A journal's (or a typed call's) resolved cuts, checked for shape. */
function givenCuts(model: Model, resolved: unknown): [CutSpec | null, CutSpec | null] {
  const spec = (s: unknown): s is CutSpec => Array.isArray(s) && s.length === 3 && typeof s[0] === "string"
    && (s[1] === null || typeof s[1] === "string") && Array.isArray(s[2]) && s[2].every((v) => typeof v === "number");
  if (!Array.isArray(resolved) || resolved.length !== 2 || !resolved.every((s) => s === null || spec(s)) || (resolved[0] === null && resolved[1] === null)) {
    throw new Error("trim's resolved cuts are [lo, hi], each null or [curve, point or null, [x, y…]] — and not both null");
  }
  for (const s of resolved as (CutSpec | null)[]) if (s && !model.entities.has(s[0])) throw new Error(`trim: "${s[0]}" is not there to cut at`);
  return [resolved[0] as CutSpec | null, resolved[1] as CutSpec | null];
}

/**
 * What a trim tidies once it is made, read before it is: the relations that
 * held a point on the piece that goes (that point has no subject now), a
 * crossing's `intersection` among them re-held `on` its other curve alone; the
 * relations holding a cut's existing point on the curve it now ends (that
 * says nothing any more); and the end the piece took with it, when nothing
 * else is built on it.
 */
interface TrimTidy {
  drop: string[];
  rehold: [string, string][];
  stranded: string | null;
}

function planTidy(model: Model, curve: string, lo: CutSpec | null, hi: CutSpec | null): TrimTidy {
  const e = model.entities.get(curve)!;
  const circle = e.kind === "circle";
  const t = (at: number[]) => {
    const f = fractionOn(model, curve, at);
    return circle ? ((f % 1) + 1) % 1 : f;
  };
  const [a, b] = [lo ? t(lo[2]) : 0, hi ? t(hi[2]) : 1];
  const eps = 1e-9;
  const inside = (p: string) => {
    const x = t(model.coords(p));
    if (circle) return a < b ? x > a + eps && x < b - eps : x > a + eps || x < b - eps;
    return x > a + eps && x < b - eps;
  };
  const cutPoints = new Set([lo?.[1], hi?.[1]].filter((p): p is string => typeof p === "string"));
  const drop: string[] = [];
  const rehold: [string, string][] = [];
  for (const r of model.relations.values()) {
    const p = r.args[0];
    if (typeof p !== "string" || model.entities.get(p)?.kind !== "point") continue;
    const gone = cutPoints.has(p) || inside(p);
    if (!gone) continue;
    if ((r.op === "pointOnLine" || r.op === "onCircle") && r.args[1] === curve) drop.push(r.name);
    else if (r.op === "intersection" && r.args.slice(1).includes(curve)) {
      drop.push(r.name);
      const other = r.args[1] === curve ? r.args[2] : r.args[1];
      if (typeof other === "string") rehold.push([p, other]);
    }
  }
  const stranded = circle || (lo && hi) ? null : lo === null ? endsOf(e)[0] : endsOf(e)[1];
  // Whether a feature names one is asked when it is taken, not now: a trim can
  // free a hold a feature owned (`adoptCutPoints`).
  return { drop, rehold, stranded };
}

/**
 * **Trims a curve back to where other curves cut it** — `trim("l1", [x, y])`:
 * the piece of `l1` the place is on, between the cuts either side of it (or
 * the curve's own end, where there is none that way), is removed. Returns the
 * curves left: `["l1"]`, or `["l1", "l9"]` where the piece came out of the
 * middle.
 *
 * - **A line or an arc trimmed at one end** keeps its name: that end is
 *   re-pointed at the cut, and the end it had — when nothing else is built on
 *   it — goes, with what named it, as `del` takes it.
 * - **A piece out of the middle** leaves two: the curve keeps the piece from
 *   its start; the rest is a new line held `col` with it (a new arc: its
 *   centre, held `eqrad`), so the two are still one line, or one circle.
 * - **A circle** becomes an arc under its own name — centre, radius and normal
 *   its own, so `rad`, `tan` and the rest still mean what they meant — from
 *   the cut after the piece round to the one before it, held `arcends`.
 *
 * **A cut is a relation, not a number**: a new end is held `on` the curve that
 * cut it (`oncircle` on a circle or arc), so it follows that curve; where a
 * point is there already — a T's own end, a crossing made real — the curve
 * ends at it. A point held on the piece that went loses that hold; one held on
 * what is left keeps it. **What refuses**: a curve nothing cuts (`del` takes
 * it whole), a circle cut only once, an ellipse, a feature's own edge. **A
 * feature on the profile** (or on a region whose face names the curve) is
 * regenerated inside this call — and where it could not find its profile any
 * more, the trim refuses, by name, having tried the change and taken it back.
 * A region with no feature on it follows the regions rule for a face changed
 * or gone (docs/plans/regions-as-operations.md): it is found again from its
 * members, or does nothing while its face is gone.
 *
 * Journalled as `trim("l1", [x, y], [lo, hi], regenerated?)` — the cuts found,
 * each `[curve, point or null, place]` — then the tidying as `del` journals
 * it, all one typed call and one undo step.
 */
export function trim(model: Model, curve: string, near: unknown, resolved?: unknown, regenerated?: unknown,
                     notes: string[] = []): string[] {
  checkTrimmable(model, curve, "trim");
  const at = coordsOf(model, near, "trim");
  const given = resolved != null;
  let lo: CutSpec | null, hi: CutSpec | null;
  if (given) [lo, hi] = givenCuts(model, resolved);
  else {
    const piece = trimPiece(model, curve, at);
    [lo, hi] = [piece.lo && specOf(piece.lo), piece.hi && specOf(piece.hi)];
  }
  const kind = model.entities.get(curve)!.kind;
  if (kind === "circle" && (lo === null || hi === null)) throw new Error("trim of a circle needs a cut either side of the piece");
  const regen = regenerated == null ? null : givenRegenerated(regenerated, "trim");
  const tidyPlan = given ? null : planTidy(model, curve, lo, hi);
  const touched = featuresTouching(model, [curve]).map((f) => f.name);
  let after: Regenerated[] | null = null;
  let made: string[] = [];
  model.asOperation("trim", () => (after === null ? [curve, at, [lo, hi]] : [curve, at, [lo, hi], after]), () => {
    const marks = model.nameCounters();
    const undo: (() => void)[] = [];
    try {
      made = applyTrim(model, curve, lo, hi, undo);
      if (!given) {
        const why = regenerationRefusal(model, touched);
        if (why) throw new Error(`trimming that piece of ${curve} leaves a feature nothing to stand on — ${why}`);
      }
    } catch (e) {
      for (const u of undo.reverse()) u();
      model.restoreNameCounters(marks);
      throw e;
    }
    after = given ? (regen ? regenerateNamed(model, [], regen) : null) : regenerateNamed(model, touched, null, notes);
    adoptCutPoints(model, [lo?.[1], hi?.[1]].filter((p): p is string => typeof p === "string"));
  });
  if (tidyPlan) {
    for (const r of tidyPlan.drop) tidy(model, r);
    for (const [p, other] of tidyPlan.rehold) {
      if (model.entities.has(p) && model.entities.has(other) && !heldOn(model, p, other)) holdOn(model, p, other);
    }
    const s = tidyPlan.stranded;
    if (s && model.entities.has(s) && !model.dependents(s).length && free(model, s)) tidy(model, s);
  }
  return [curve, ...made];
}

/**
 * **A point a feature made that a trimmed curve now ends at is the sketch's.**
 * An extrude over a crossing makes the crossing a real point held on both
 * curves (operations.ts, `materialise`) and owns it, with its holds; a trim
 * that cuts there ends the curve at that very point, so it is a corner of the
 * sketch now, and a feature owning it would take the sketch's edge with it
 * when deleted. So the record stops owning the point and its holds (it still
 * names the point it stands on, as it names every corner), and the hold on the
 * curve that now ends there — which says nothing any more — is free for the
 * trim's tidying to take. Inside the trim's own entry, so a replay does it too.
 */
function adoptCutPoints(model: Model, points: readonly string[]): void {
  for (const p of points) {
    for (const f of [...model.features.values()]) {
      if (!f.owns.includes(p)) continue;
      const holds = f.owns.filter((n) => model.relations.get(n)?.args[0] === p);
      const gone = new Set([p, ...holds]);
      const { name, ...draft } = f;
      model.rewriteFeature(name, { ...draft, owns: f.owns.filter((n) => !gone.has(n)), names: f.names.filter((n) => !holds.includes(n)) } as FeatureDraft);
    }
  }
}

/**
 * The structure of a trim, each change's inverse pushed on `undo` so a trim
 * that must refuse after trying can take itself back. Returns the new curve a
 * piece out of the middle leaves, if any.
 */
function applyTrim(model: Model, curve: string, lo: CutSpec | null, hi: CutSpec | null, undo: (() => void)[]): string[] {
  const pointFor = ([by, point, at]: CutSpec): string => {
    if (point !== null && model.entities.get(point)?.kind === "point") {
      if (!heldOn(model, point, by)) {
        const r = holdOn(model, point, by);
        undo.push(() => model.deleteRelation(r));
      }
      return point;
    }
    const p = model.addPoint(at.slice(0, model.dim)).name;
    undo.push(() => model.deleteEntity(p));
    const r = holdOn(model, p, by);
    undo.push(() => model.deleteRelation(r));
    return p;
  };
  const relate = (name: string) => undo.push(() => model.deleteRelation(name));
  const made = (name: string) => undo.push(() => model.deleteEntity(name));
  const e = model.entities.get(curve)!;
  if (e.kind === "circle") {
    const [P1, P2] = [pointFor(lo!), pointFor(hi!)];
    // What is kept runs from the cut after the piece round to the cut before it.
    model.circleToArc(curve, P2, P1);
    undo.push(() => model.arcToCircle(curve));
    relate(arcEndpoints(model, curve));
    return [];
  }
  const repoint = (from: string, to: string) => {
    if (e.kind === "line") {
      model.retargetLine(curve, from, to);
      undo.push(() => model.retargetLine(curve, to, from));
    } else {
      model.retargetArc(curve, from, to);
      rebuildEnds(model, curve);
      undo.push(() => { model.retargetArc(curve, to, from); rebuildEnds(model, curve); });
    }
  };
  const [S, E] = endsOf(e);
  if (lo === null) { repoint(S, pointFor(hi!)); return []; }
  if (hi === null) { repoint(E, pointFor(lo)); return []; }
  const [P1, P2] = [pointFor(lo), pointFor(hi)];
  repoint(E, P1);
  const construction = model.isConstruction(curve);
  if (e.kind === "line") {
    const l = model.addLine(P2, E).name;
    made(l);
    if (construction) model.setConstruction(l, true);
    relate(collinear(model, curve, l));
    return [l];
  }
  const a = model.arc(curve);
  const n = a.normal === undefined ? null : model.normalOf(curve);
  const na = model.addArc(a.center, P2, E, model.radius(curve), n).name;
  made(na);
  if (construction) model.setConstruction(na, true);
  relate(arcEndpoints(model, na));
  relate(equalRadius(model, curve, na));
  return [na];
}

// --- extend -------------------------------------------------------------------

/** Which end of a line or arc a call meant: a point's name, or the end nearer a place. */
function endMeant(model: Model, e: Entity, end: unknown): { point: string; which: "start" | "end" } {
  const ends = endsOf(e);
  if (typeof end === "string") {
    const i = ends.indexOf(end);
    if (i < 0) throw new Error(`"${end}" is not an end of ${e.name} — its ends are ${ends.join(" and ")}`);
    return { point: end, which: i === 0 ? "start" : "end" };
  }
  const at = coordsOf(model, end, "extend");
  const d = ends.map((p) => Math.hypot(...model.coords(p).map((v, i) => v - at[i])));
  const i = d[0] <= d[1] ? 0 : 1;
  return { point: ends[i], which: i === 0 ? "start" : "end" };
}

/**
 * Where `extend(curve, end, to?)` would take that end: the curve it reaches
 * and the place — or the refusal: an end something else is built on, nothing
 * that way. What the extend tool's hover draws.
 */
export function extendReach(model: Model, curve: string, end: unknown, to?: string | null): { point: string; by: string; at: number[] } {
  const e = checkTrimmable(model, curve, "extend");
  const { point, which } = endMeant(model, e, end);
  const shared = model.dependents(point).filter((d) => d.name !== curve).map((d) => d.name);
  if (shared.length) throw new Error(`${point} is also ${shared.join(" and ")}'s — extend lengthens a free end, and this one is a corner`);
  const joined = [...model.relations.values()].find((r) => r.op === "coincident" && r.args.includes(point));
  if (joined) throw new Error(`${point} is held to ${joined.args.find((a) => a !== point)} by ${joined.name} — extend lengthens a free end; del("${joined.name}") frees it`);
  if (to != null && !model.entities.has(to)) throw new Error(`extend: "${to}" is not there to reach`);
  const reach = reachOf(model, curve, which, to ?? null);
  if (!reach) {
    throw new Error(to != null ? `${curve} carried on past ${point} never meets ${to}`
      : `nothing lies past ${point} along ${curve} for it to reach`);
  }
  return { point, by: reach.by, at: reach.at };
}

/**
 * **Lengthens a line or an arc to the next curve along its direction** —
 * `extend("l1", "p2")`, or the end nearer a place, `extend("l1", [x, y])`, and
 * the curve to reach when not the first: `extend("l1", "p2", "c3")`. A line
 * carries on along itself, an arc round its circle. The end itself moves —
 * its name, and what names it, are kept — and is held `on` what it reached,
 * so it follows that curve. Refuses an end that is a corner (another curve's
 * too, or held to one by `coin`): pulling it would pull that curve as well.
 * Journalled resolved, `extend("l1", "p2", "c3", [x, y])`; returns the curve.
 */
export function extend(model: Model, curve: string, end: unknown, to?: string | null, at?: unknown): string {
  const e = checkTrimmable(model, curve, "extend");
  let point: string, by: string, place: number[];
  if (at != null) {
    if (typeof end !== "string" || typeof to !== "string") throw new Error("extend given its place needs the end and the curve reached, by name");
    point = endMeant(model, e, end).point;
    by = to;
    if (!model.entities.has(by)) throw new Error(`extend: "${by}" is not there to reach`);
    place = coordsOf(model, at, "extend");
  } else {
    ({ point, by, at: place } = extendReach(model, curve, end, to ?? null));
  }
  return model.asOperation("extend", [curve, point, by, place], () => {
    model.setCoords(point, place.slice(0, model.dim));
    holdOn(model, point, by);
    return curve;
  });
}

// --- chamfer ------------------------------------------------------------------

/**
 * **Cuts a corner with a line** — `chamfer("l1", "l2", 5)`, or two setbacks,
 * `chamfer("l1", "l2", 5, 3)` (along l1, then l2). The two lines must share
 * their corner point. Each leg is re-pointed at a new end the setback back
 * from the corner, and a line joins the two. **The corner point stays where
 * the corner is** — held there as the legs' `intersection`, no curve's end any
 * more — so every dimension on it still measures the sharp corner, and the
 * setbacks are `dist` from it: one setback is one dimension and an
 * `equalSpacing` (the second end as far from the corner as the first), two are
 * two dimensions. Lines are read lazily, so `par` on a leg still holds it.
 *
 * Refuses a setback that is not positive or that would run past a leg's far
 * end, and legs on one line. A feature standing on either leg is regenerated
 * inside the call, as `fillet` regenerates it (read `fillet` for the lid), and
 * the list journalled beside the call. Returns the new line's name.
 */
export function chamfer(model: Model, l1: string, l2: string, d1: number, d2?: number | null, regenerated?: unknown): string {
  if (typeof d1 !== "number" || !(d1 > 0) || (d2 != null && (typeof d2 !== "number" || !(d2 > 0)))) {
    throw new Error("chamfer needs positive setbacks — chamfer(\"l1\", \"l2\", 5), or two: chamfer(\"l1\", \"l2\", 5, 3)");
  }
  const [a, b] = [model.line(l1), model.line(l2)];
  if (l1 === l2) throw new Error(`chamfer needs two lines: ${l1} twice is one`);
  const C = a.refs.find((p) => b.refs.includes(p));
  if (!C) throw new Error(`"${l1}" and "${l2}" do not meet at a shared point — chamfer cuts the corner two lines share`);
  const A = a.refs[0] === C ? a.refs[1] : a.refs[0], B = b.refs[0] === C ? b.refs[1] : b.refs[0];
  const c = model.coords(C);
  const legA = model.coords(A).map((v, i) => v - c[i]), legB = model.coords(B).map((v, i) => v - c[i]);
  const [la, lb] = [Math.hypot(...legA), Math.hypot(...legB)];
  const [ua, ub] = [legA.map((v) => v / la), legB.map((v) => v / lb)];
  const cos = ua.reduce((s, v, i) => s + v * ub[i], 0);
  if (Math.abs(cos) > 1 - 1e-12) throw new Error(`${l1} and ${l2} lie on one line — there is no corner to chamfer`);
  const e2 = d2 ?? d1;
  if (d1 >= la || e2 >= lb) {
    throw new Error(`a setback of ${d1 >= la ? d1 : e2} runs past ${d1 >= la ? l1 : l2}'s far end (it is ${(d1 >= la ? la : lb).toFixed(3)} long)`);
  }
  const given = regenerated == null ? null : givenRegenerated(regenerated, "chamfer");
  const args: unknown[] = d2 == null ? [l1, l2, d1] : [l1, l2, d1, d2];
  let after: Regenerated[] | null = null;
  return model.asOperation("chamfer", () => (after === null ? args : [l1, l2, d1, d2 ?? null, after]), () => {
    const T1 = model.addPoint(c.map((v, i) => v + ua[i] * d1)).name;
    const T2 = model.addPoint(c.map((v, i) => v + ub[i] * e2)).name;
    model.retargetLine(l1, C, T1);
    model.retargetLine(l2, C, T2);
    const line = model.addLine(T1, T2).name;
    if (model.isConstruction(l1) && model.isConstruction(l2)) model.setConstruction(line, true);
    intersection(model, C, l1, l2);
    dist(model, C, T1, d1);
    if (d2 == null) equalSpacing(model, T1, C, T2);
    else dist(model, C, T2, d2);
    after = regenerateAfter(model, [l1, l2], given);
    return line;
  });
}

// --- the plane a set of curves is drawn in ----------------------------------

/** The normal of the plane `curves` lie in: +z in 2D; a curve's own normal, two lines' cross, else the drawing plane's. */
function planeNormal(model: Model, curves: readonly string[]): number[] {
  if (model.dim !== 3) return [0, 0, 1];
  for (const n of curves) {
    const e = model.entities.get(n);
    if (e && (e.kind === "arc" || e.kind === "circle")) return model.normalOf(n);
  }
  const dirs = curves.map((n) => model.entities.get(n)).filter((e): e is Extract<Entity, { kind: "line" }> => e?.kind === "line")
    .map((l) => unit3(sub3(lift3(model.coords(l.refs[1])), lift3(model.coords(l.refs[0])))))
    .filter((d): d is number[] => d !== null);
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const n = unit3(cross3(dirs[i], dirs[j]));
      if (n && Math.hypot(...cross3(dirs[i], dirs[j])) > 1e-6) {
        const side = sketchSide(model);
        return dot3(n, side) < 0 ? n.map((x) => -x) : n;
      }
    }
  }
  return sketchSide(model);
}

// --- offset -------------------------------------------------------------------

/** A chain member as walked: its name, whether against its own direction, and the vertex it is walked from and to. */
interface Walked {
  name: string;
  reversed: boolean;
  from: string | null;
  to: string | null;
}

/**
 * The members of a chain in walking order — joined end to end by a shared
 * point or a `coin` — and whether it closes. The walk starts at an open end
 * (the first member's own, when it is one) and runs the way the first member
 * named runs, so a positive offset of an open chain is on the left of the
 * first member as it is drawn. Refuses a branch and a member not joined to the
 * rest.
 */
export function walkChain(model: Model, names: readonly string[]): { walk: Walked[]; closed: boolean } {
  const ents = names.map((n) => model.entities.get(n));
  ents.forEach((e, i) => {
    if (!e || !(e.kind === "line" || e.kind === "arc" || e.kind === "circle" || e.kind === "spline")) {
      throw new Error(`offset takes lines, arcs and circles — "${names[i]}" is ${e ? `a ${e.kind}` : "not there"}`);
    }
  });
  // A circle, or a closed spline (a surface's sweep walks one; offset refuses
  // a spline before it gets here), is a chain on its own.
  const shut = (e: Entity) => e.kind === "circle" || (e.kind === "spline" && e.closed === true);
  if (ents.some((e) => shut(e!))) {
    const noun = ents.some((e) => e!.kind === "circle") ? "a circle" : "a closed spline";
    if (names.length > 1) throw new Error(`${noun} is a chain on its own — offset it by itself`);
    return { walk: [{ name: names[0], reversed: false, from: null, to: null }], closed: true };
  }
  const cls = joinClasses(model);
  const keyOf = (p: string) => cls.get(p) ?? p;
  const ends = (n: string) => chainEnds(model.entities.get(n)!);
  const at = new Map<number | string, string[]>();
  for (const n of names) for (const p of ends(n)) at.set(keyOf(p), [...(at.get(keyOf(p)) ?? []), n]);
  for (const [, list] of at) {
    if (list.length > 2) throw new Error(`offset takes a chain, and ${list.join(", ")} meet at one point — pick the members of one path`);
  }
  const first = names[0];
  // Walk from the first member, its own way, to the end of the chain that way; then from its start back.
  const step = (from: string, enter: string) => {
    const out: Walked[] = [];
    let cur = from, pt = enter;
    const seen = new Set([from]);
    for (;;) {
      const next = (at.get(keyOf(pt)) ?? []).find((n) => n !== cur && !seen.has(n));
      if (!next) break;
      const [s, e] = ends(next);
      const reversed = keyOf(e) === keyOf(pt);
      out.push({ name: next, reversed, from: reversed ? e : s, to: reversed ? s : e });
      seen.add(next);
      cur = next;
      pt = reversed ? s : e;
    }
    return out;
  };
  const [s0, e0] = ends(first);
  const forward = step(first, e0);
  const closed = forward.length > 0 && forward.length === names.length - 1
    && (at.get(keyOf(forward[forward.length - 1].to!)) ?? []).includes(first) && keyOf(forward[forward.length - 1].to!) === keyOf(s0);
  let walk: Walked[] = [{ name: first, reversed: false, from: s0, to: e0 }, ...forward];
  if (!closed) {
    const backward = step(first, s0).map((w) => ({ name: w.name, reversed: !w.reversed, from: w.to, to: w.from })).reverse();
    walk = [...backward, ...walk];
  }
  if (walk.length !== names.length) {
    const reached = new Set(walk.map((w) => w.name));
    const loose = names.filter((n) => !reached.has(n));
    throw new Error(`${loose.join(", ")} ${loose.length === 1 ? "is" : "are"} not joined to ${first} — offset takes one connected chain (offset each on its own)`);
  }
  return { walk, closed };
}

/**
 * The chain a curve is in: it, and on from each of its ends through every
 * vertex where exactly one other line or arc joins (a shared point or a
 * `coin`), stopping at a branch or a free end — what a click on one member
 * of an outline offsets. The curve clicked first, the rest in creation order.
 * A circle is a chain of one.
 */
/** The ends a chain is joined by: a line's, an arc's, an open spline's first and last points; none for a closed curve. */
function chainEnds(e: Entity): string[] {
  if (e.kind === "spline") return e.closed ? [] : [e.points[0], e.points[e.points.length - 1]];
  return endsOf(e);
}

export function chainThrough(model: Model, curve: string): string[] {
  const e = model.entities.get(curve);
  if (!e || e.kind === "circle" || (e.kind === "spline" && e.closed)) return [curve];
  const cls = joinClasses(model);
  const keyOf = (p: string) => cls.get(p) ?? p;
  const at = new Map<number | string, string[]>();
  const order = [...model.entities.keys()];
  for (const c of model.entities.values()) {
    if (c.kind !== "line" && c.kind !== "arc" && c.kind !== "spline") continue;
    for (const p of chainEnds(c)) at.set(keyOf(p), [...(at.get(keyOf(p)) ?? []), c.name]);
  }
  const found = new Set([curve]);
  const queue = [curve];
  while (queue.length) {
    const c = queue.shift()!;
    for (const p of chainEnds(model.entities.get(c)!)) {
      const here = at.get(keyOf(p)) ?? [];
      if (here.length !== 2) continue;
      const next = here.find((n) => n !== c);
      if (next && !found.has(next)) { found.add(next); queue.push(next); }
    }
  }
  return [curve, ...[...found].filter((n) => n !== curve).sort((a, b) => order.indexOf(a) - order.indexOf(b))];
}

/** What `offset` resolved, journalled: which side a positive distance went, each round member's new radius, and which joints are smooth. */
interface OffsetResolved {
  side: 1 | -1;
  radii: (number | null)[];
  smooth: boolean[];
}

/** A member's carrier, its direction of travel as walked, and the left normal (in the plane `n`) at a vertex. */
function travel(model: Model, w: Walked, n: number[], atStart: boolean): { pos: number[]; left: number[] } {
  const e = model.entities.get(w.name)!;
  if (e.kind === "line") {
    const [p, q] = [lift3(model.coords(w.from!)), lift3(model.coords(w.to!))];
    const d = unit3(sub3(q, p)) ?? [1, 0, 0];
    return { pos: atStart ? p : q, left: unit3(cross3(n, d)) ?? [0, 1, 0] };
  }
  const f = curveFrame(model, e)!;
  const ccw = dot3(f.normal, n) >= 0; // the arc's own sense, seen from the plane's side
  const ownWay = e.kind === "circle" ? ccw : (ccw !== w.reversed);
  const pt = e.kind === "circle" ? lift3(model.coords(e.center)).map((c, i) => c + f.r * f.u[i])
    : lift3(model.coords(atStart ? w.from! : w.to!));
  const radial = unit3(sub3(pt, f.center)) ?? [1, 0, 0];
  // Walking counter-clockwise about n, the left is toward the centre.
  return { pos: pt, left: ownWay ? radial.map((x) => -x) : radial };
}

/** The signed area a closed walk encloses about `n` — vertices joined straight, each arc's bulge added. */
function walkArea(model: Model, walk: Walked[], n: number[]): number {
  if (walk.length === 1) {
    const e = model.entities.get(walk[0].name)!;
    const f = curveFrame(model, e)!;
    return (dot3(f.normal, n) >= 0 ? 1 : -1) * Math.PI * f.r * f.r;
  }
  const [u, v] = spanOf(n);
  const flat = (p: number[]) => [dot3(lift3(p), u), dot3(lift3(p), v)];
  let area = 0;
  for (const w of walk) {
    const [a, b] = [flat(model.coords(w.from!)), flat(model.coords(w.to!))];
    area += (a[0] * b[1] - a[1] * b[0]) / 2;
    const e = model.entities.get(w.name)!;
    if (e.kind === "arc") {
      const f = curveFrame(model, e)!;
      const seg = (f.r * f.r * (f.sweep - Math.sin(f.sweep))) / 2;
      const ccw = (dot3(f.normal, n) >= 0) !== w.reversed;
      area += ccw ? seg : -seg;
    }
  }
  return area;
}

/** Where two carriers meet nearest `guess`, or null — two offset copies' corner. */
function corner(a: { kind: "line"; p: number[]; d: number[] } | { kind: "round"; c: number[]; r: number },
                b: { kind: "line"; p: number[]; d: number[] } | { kind: "round"; c: number[]; r: number },
                n: number[], guess: number[]): number[] | null {
  const [u, v] = spanOf(n);
  const o = guess;
  const flat = (p: number[]) => { const d = sub3(p, o); return [dot3(d, u), dot3(d, v)]; };
  const back = ([x, y]: number[]) => [0, 1, 2].map((i) => o[i] + x * u[i] + y * v[i]);
  const fd = (d: number[]) => [dot3(d, u), dot3(d, v)];
  const pts: number[][] = [];
  if (a.kind === "line" && b.kind === "line") {
    const [p, d] = [flat(a.p), fd(a.d)], [q, e] = [flat(b.p), fd(b.d)];
    const den = d[0] * e[1] - d[1] * e[0];
    if (Math.abs(den) < 1e-12) return null;
    const s = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
    pts.push([p[0] + s * d[0], p[1] + s * d[1]]);
  } else if (a.kind === "round" && b.kind === "round") {
    const [c1, c2] = [flat(a.c), flat(b.c)];
    const dd = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
    if (!(dd > 0)) return null;
    const h = (dd * dd + a.r * a.r - b.r * b.r) / (2 * dd);
    const k2 = a.r * a.r - h * h;
    if (k2 < 0) return null;
    const k = Math.sqrt(k2);
    const ux = (c2[0] - c1[0]) / dd, uy = (c2[1] - c1[1]) / dd;
    const m = [c1[0] + h * ux, c1[1] + h * uy];
    pts.push([m[0] - k * uy, m[1] + k * ux], [m[0] + k * uy, m[1] - k * ux]);
  } else {
    const [L, R] = a.kind === "line" ? [a, b as { kind: "round"; c: number[]; r: number }] : [b as { kind: "line"; p: number[]; d: number[] }, a];
    const [p, d] = [flat(L.p), fd(L.d)];
    const c = flat(R.c);
    const len = Math.hypot(d[0], d[1]);
    const ud = [d[0] / len, d[1] / len];
    const along = (c[0] - p[0]) * ud[0] + (c[1] - p[1]) * ud[1];
    const foot = [p[0] + along * ud[0], p[1] + along * ud[1]];
    const across = Math.hypot(c[0] - foot[0], c[1] - foot[1]);
    if (across > R.r) return null;
    const half = Math.sqrt(R.r * R.r - across * across);
    pts.push([foot[0] - half * ud[0], foot[1] - half * ud[1]], [foot[0] + half * ud[0], foot[1] + half * ud[1]]);
  }
  pts.sort((x, y) => Math.hypot(x[0], x[1]) - Math.hypot(y[0], y[1]));
  return back(pts[0]);
}

/**
 * An offset worked out and nothing made: each copy's carrier, its new
 * vertices (world, three coordinates), and what the journal resolves — or the
 * refusal. What `offset` builds from, and what the offset tool draws as its
 * preview, so the preview is the seed the call will lay down.
 */
export interface OffsetPlan {
  walk: Walked[];
  closed: boolean;
  normal: number[];
  /** The copy's vertices: one per joint (closed: one per member, before it), plus the two ends of an open chain. */
  vertices: number[][];
  resolved: OffsetResolved;
}

export function planOffset(model: Model, names: readonly string[], d: number, resolved?: OffsetResolved | null): OffsetPlan {
  if (typeof d !== "number" || !Number.isFinite(d) || d === 0) throw new Error(`offset needs a distance that is not 0, got ${JSON.stringify(d)}`);
  for (const n of names) refuseSpline(model, n, "offset");
  for (const n of names) refuseOwned(model, n, "offset");
  const { walk, closed } = walkChain(model, names);
  const n = planeNormal(model, names);
  let side: 1 | -1 = resolved?.side ?? 1;
  if (!resolved && closed && walk.length >= 1) side = walkArea(model, walk, n) > 0 ? -1 : 1; // positive is outward
  const s = side * d;
  type Car = { kind: "line"; p: number[]; d: number[] } | { kind: "round"; c: number[]; r: number };
  const radii: (number | null)[] = [];
  const cars: Car[] = walk.map((w, i) => {
    const e = model.entities.get(w.name)!;
    if (e.kind === "line") {
      const t = travel(model, w, n, true);
      const q = lift3(model.coords(w.to!));
      radii.push(null);
      return { kind: "line", p: t.pos.map((x, k) => x + s * t.left[k]), d: sub3(q, t.pos) };
    }
    const f = curveFrame(model, e)!;
    const t = travel(model, w, n, true);
    const toward = dot3(t.left, sub3(f.center, t.pos)) > 0; // the left is toward the centre
    const r = resolved?.radii[i] ?? (toward ? f.r - s : f.r + s);
    if (!resolved && !(r > 1e-9)) {
      throw new Error(`an offset of ${d} that way is more than ${w.name}'s radius (${f.r.toFixed(3)}) — it would turn the curve inside out`);
    }
    radii.push(r);
    return { kind: "round", c: f.center, r };
  });
  const vertices: number[][] = [];
  const smooth: boolean[] = [];
  const joints = closed ? walk.length : walk.length - 1;
  if (!closed) {
    const t = travel(model, walk[0], n, true);
    vertices.push(t.pos.map((x, k) => x + s * t.left[k]));
  }
  for (let j = 0; j < joints; j++) {
    if (walk.length === 1) break;
    const [i, k] = closed ? [(j + walk.length - 1) % walk.length, j] : [j, j + 1];
    const end = travel(model, walk[i], n, false), start = travel(model, walk[k], n, true);
    const tangentHere = resolved?.smooth[j] ?? (Math.hypot(...cross3(end.left, start.left)) < 1e-6 && dot3(end.left, start.left) > 0);
    smooth.push(tangentHere);
    const guess = end.pos.map((x, q) => x + s * end.left[q]);
    if (tangentHere) { vertices.push(guess); continue; }
    const avg = unit3(end.left.map((x, q) => x + start.left[q])) ?? end.left;
    const meet = corner(cars[i], cars[k], n, end.pos.map((x, q) => x + s * avg[q]));
    if (!meet) {
      if (!resolved) throw new Error(`an offset of ${d} is too large for the corner where ${walk[i].name} meets ${walk[k].name} — the copies do not meet`);
      vertices.push(guess);
    } else vertices.push(meet);
  }
  if (!closed) {
    const t = travel(model, walk[walk.length - 1], n, false);
    vertices.push(t.pos.map((x, k) => x + s * t.left[k]));
  }
  return { walk, closed, normal: n, vertices, resolved: { side, radii, smooth } };
}

/** A journal's resolved offset, checked for shape. */
function givenOffset(resolved: unknown, members: number): OffsetResolved {
  const r = resolved as OffsetResolved;
  const ok = r && typeof r === "object" && (r.side === 1 || r.side === -1) && Array.isArray(r.radii) && r.radii.length === members
    && r.radii.every((x) => x === null || typeof x === "number") && Array.isArray(r.smooth) && r.smooth.every((x) => typeof x === "boolean");
  if (!ok) throw new Error("offset's resolved part is { side: 1 or -1, radii: [...], smooth: [...] }");
  return { side: r.side, radii: [...r.radii], smooth: [...r.smooth] };
}

/** Options an offset takes. */
export interface OffsetOptions {
  construction?: boolean;
}

/**
 * **A parallel copy of a curve, or of a connected chain of them**, a distance
 * `d` away — `offset("l1", 5)`, `offset(["l1", "a1", "l2"], 5, { construction:
 * true })`. Positive is outward for a closed chain, and to the left of the
 * first member as it is drawn for an open one; negative, the other side.
 *
 * Held by relations, so the copy follows the original: a line's copy `par`
 * with it at a `dist`; an arc's copy about **the same centre point** (as
 * concentric as `conc` makes it, with nothing to hold), its ends on it
 * (`arcends`), `tan` to a neighbouring line's copy where the original met that
 * line smoothly, and a `rad` of r ± d where it did not; a circle's copy about
 * the same centre at `rad` r ± d. The copies meet where the originals did —
 * one point at each corner, the sharp corner where the copies cross, the
 * smooth one along the common normal — and an open chain's end is held square
 * across from the original's (`perp`). Every distance is its own dimension.
 *
 * Refuses a branch, a member not joined to the rest, an offset inward past a
 * radius, a corner the copies would not meet at, and a feature's own edge.
 * Journalled resolved — `offset(names, d, options, { side, radii, smooth })` —
 * the side a positive distance went, each round copy's radius and which
 * corners are smooth, all read off positions. Returns the copies' names, in
 * walking order.
 */
export function offset(model: Model, chain: string | string[], d: number, options?: OffsetOptions | null, resolved?: unknown): string[] {
  const names = typeof chain === "string" ? [chain] : Array.isArray(chain) ? chain.filter((x) => typeof x === "string") : [];
  if (!names.length) throw new Error('offset takes a curve, or a list of them: offset("l1", 5), offset(["l1", "a1", "l2"], 5)');
  const o = options ?? {};
  if (typeof o !== "object" || (o.construction !== undefined && typeof o.construction !== "boolean")) {
    throw new Error("offset's options are { construction: true or false }");
  }
  const given = resolved == null ? null : givenOffset(resolved, names.length);
  const plan = planOffset(model, names, d, given);
  const args = [names.length === 1 && typeof chain === "string" ? names[0] : names, d, o.construction ? { construction: true } : null, plan.resolved];
  return model.asOperation("offset", args, () => buildOffset(model, plan, Math.abs(d), !!o.construction));
}

function buildOffset(model: Model, plan: OffsetPlan, d: number, construction: boolean): string[] {
  const { walk, closed, vertices, resolved } = plan;
  const own = (x: number[]) => x.slice(0, model.dim);
  const pts = vertices.map((v) => model.addPoint(own(v)).name);
  // Member i runs from vertex a(i) to b(i), in walking order.
  const from = (i: number) => (closed ? pts[i] : pts[i]);
  const to = (i: number) => (closed ? pts[(i + 1) % walk.length] : pts[i + 1]);
  const copies: string[] = [];
  walk.forEach((w, i) => {
    const e = model.entities.get(w.name)!;
    let copy: string;
    if (e.kind === "line") {
      const [a, b] = w.reversed ? [to(i), from(i)] : [from(i), to(i)];
      copy = model.addLine(a, b).name;
    } else if (e.kind === "circle") {
      const n = e.normal === undefined ? null : model.normalOf(w.name);
      copy = model.addCircle(e.center, resolved.radii[i]!, n).name;
    } else {
      const arc = e as ArcEntity;
      const n = arc.normal === undefined ? null : model.normalOf(w.name);
      const [s, t] = w.reversed ? [to(i), from(i)] : [from(i), to(i)];
      copy = model.addArc(arc.center, s, t, resolved.radii[i]!, n).name;
    }
    if (construction) model.setConstruction(copy, true);
    copies.push(copy);
  });
  walk.forEach((w, i) => {
    const e = model.entities.get(w.name)!;
    const copy = copies[i];
    if (e.kind === "line") {
      parallel(model, copy, w.name);
      dist(model, w.name, copy, d);
      return;
    }
    if (e.kind === "circle") {
      radiusRel(model, copy, resolved.radii[i]!);
      return;
    }
    arcEndpoints(model, copy);
    // Smooth into a line's copy: tangent to it, which settles the radius.
    const joints = closed ? [(i + walk.length) % walk.length, (i + 1) % walk.length] : [i - 1, i];
    const neighbours = closed ? [(i + walk.length - 1) % walk.length, (i + 1) % walk.length] : [i - 1, i + 1];
    let held = false;
    joints.forEach((j, side) => {
      const k = neighbours[side];
      if (held || j < 0 || j >= resolved.smooth.length || k < 0 || k >= walk.length || k === i) return;
      if (!resolved.smooth[j] || model.entities.get(walk[k].name)?.kind !== "line") return;
      tangent(model, copies[k], copy);
      held = true;
    });
    if (!held) radiusRel(model, copy, resolved.radii[i]!);
  });
  if (!closed) {
    const ends: [Walked, string, boolean][] = [[walk[0], pts[0], true], [walk[walk.length - 1], pts[pts.length - 1], false]];
    for (const [w, p, atStart] of ends) {
      if (model.entities.get(w.name)?.kind !== "line") continue;
      const orig = atStart ? w.from! : w.to!;
      perpendicular(model, orig, p, w.name);
    }
  }
  return copies;
}

// --- mirror and the patterns: copies of a set of entities ---------------------

/** What a mirror or a pattern copies: the curves named, and every point they are built of or that was named, in creation order. */
function copySet(model: Model, names: readonly string[], op: string, skip: ReadonlySet<string> = new Set()): { curves: string[]; points: string[] } {
  if (!names.length) throw new Error(`${op} needs something to copy — names of lines, arcs, circles or points`);
  const expanded = model.expand(names, op).filter((n) => model.entities.has(n) && !skip.has(n));
  const curves = new Set<string>(), points = new Set<string>();
  for (const n of expanded) {
    const e = model.entities.get(n)!;
    if (e.kind === "point") points.add(n);
    // A spline is its points (docs/plans/spline.md): copied as the spline through their copies.
    else if (e.kind === "line" || e.kind === "arc" || e.kind === "circle" || e.kind === "spline") {
      refuseOwned(model, n, op);
      curves.add(n);
      for (const p of model.refsOf(e)) points.add(p);
    } else {
      throw new Error(`${op} copies points, lines, arcs, circles and splines — "${n}" is ${e.kind === "ellipse" ? "an ellipse" : `a ${e.kind}`}`);
    }
  }
  if (!curves.size && !points.size) throw new Error(`${op}: nothing among ${names.join(", ")} is a point or a curve to copy`);
  const order = [...model.entities.keys()];
  const sorted = (s: Set<string>) => [...s].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return { curves: sorted(curves), points: sorted(points) };
}

/** A curve made again over copied points: `map` gives each point's copy. Returns the copy's name. */
function copyCurve(model: Model, name: string, map: (p: string) => string, normal: number[] | null, swap: boolean, as?: string): string {
  const e = model.entities.get(name)!;
  let copy: string;
  if (e.kind === "line") copy = model.addLine(map(e.refs[0]), map(e.refs[1]), as ?? null).name;
  else if (e.kind === "circle") copy = model.addCircle(map(e.center), model.radius(name), normal, as ?? null).name;
  // The spline through the copies of its points, in its order: a mirror, a
  // translation or a turn is an isometry, so it is the original's image exactly.
  else if (e.kind === "spline") copy = addSpline(model, e.points.map(map), e.closed === true, as ?? null);
  else {
    const a = e as ArcEntity;
    const [s, t] = swap ? [map(a.end), map(a.start)] : [map(a.start), map(a.end)];
    copy = model.addArc(map(a.center), s, t, model.radius(name), normal, as ?? null).name;
  }
  if (model.isConstruction(name)) model.setConstruction(copy, true);
  return copy;
}

/** A curve's copy held as a copy: an arc's ends on its circle, a circle's radius its original's. */
function holdCopy(model: Model, name: string, copy: string, level: boolean): void {
  const k = model.entities.get(name)!.kind;
  if (k === "arc") arcEndpoints(model, copy);
  if (k === "circle") {
    equalRadius(model, name, copy);
    if (level && model.dim === 3) parallel(model, copy, name);
  }
}

/** The located line a mirror is about: its origin and unit direction (three coordinates), read now. */
function mirrorLine(model: Model, line: string): { o: number[]; u: number[] } {
  const axis = parseAxisRef(line);
  if (axis) {
    model.requireAxis(axis.axis, line);
    model.requireFrame(axis.frame);
    const pv = axis.frame === ORIGIN ? null : model.planeValues(axis.frame);
    const o = pv ? pv.origin : [0, 0, 0];
    const u = pv ? (axis.axis === "x" ? pv.u : axis.axis === "y" ? pv.v : pv.n) : [axis.axis === "x" ? 1 : 0, axis.axis === "y" ? 1 : 0, axis.axis === "z" ? 1 : 0];
    return { o: lift3(o), u: lift3(u) };
  }
  const e = model.entities.get(line);
  if (!e || e.kind !== "line") {
    throw new Error(`mirror is about a line or a frame's axis — "${line}" is ${e ? `a ${e.kind}` : "neither"}; say "l5", or "${ORIGIN}.y"`);
  }
  const [a, b] = [lift3(model.coords(e.refs[0])), lift3(model.coords(e.refs[1]))];
  const u = unit3(sub3(b, a));
  if (!u) throw new Error(`${line} has no length, so no direction to mirror about`);
  return { o: a, u };
}

/** What `mirror` resolved: the points that lie on the mirror line (their own mirrors), and the circles whose normals are held level. */
interface MirrorResolved {
  shared: string[];
  level: string[];
}

/**
 * **A mirrored copy** — `mirror(["l1", "l2", "a1"], "l5")`, or about a frame's
 * axis, `mirror(["l1"], "origin.y")` — held by `sym` about the line: every
 * point's copy is its mirror image (in 3D, its half-turn about the line), so
 * the copy follows the original and is the same shape without being told so:
 * two mirrored lines of equal length need no `eq`, the `sym` on their ends
 * does it. What the copies share the originals share (one copied corner for
 * two lines meeting at one); an arc's copy is held on its ends (`arcends`), a
 * circle's has its original's radius (`eqrad`) and, in 3D when the line lies
 * in its plane, its normal (`par`). **A point on the mirror line is its own
 * mirror** — not copied, and held `on` the line (when the line is a line) so
 * the copy stays joined to the original there.
 *
 * Refuses an ellipse or a frame among the names, a mirror line that is
 * neither a line nor an axis, and a feature's own edge. Journalled resolved —
 * `mirror(names, line, { shared, level })`, both read off positions. Returns
 * the copies' names, the curves first.
 */
export function mirror(model: Model, names: string | string[], line: string, resolved?: unknown): string[] {
  const list = typeof names === "string" ? [names] : Array.isArray(names) ? names : [];
  if (typeof line !== "string") throw new Error('mirror(names, line) — the line by name, or a frame\'s axis: mirror(["l1"], "origin.y")');
  const { o, u } = mirrorLine(model, line);
  const { curves, points } = copySet(model, list, "mirror", new Set([line]));
  const reflect = (x: number[]) => {
    const X = lift3(x);
    const along = dot3(sub3(X, o), u);
    return [0, 1, 2].map((i) => 2 * (o[i] + along * u[i]) - X[i]);
  };
  const scale = Math.max(1, ...points.map((p) => Math.hypot(...model.coords(p))));
  let r: MirrorResolved;
  if (resolved != null) {
    const g = resolved as MirrorResolved;
    if (!g || !Array.isArray(g.shared) || !Array.isArray(g.level)) throw new Error("mirror's resolved part is { shared: [...], level: [...] }");
    r = { shared: [...g.shared], level: [...g.level] };
  } else {
    const shared = points.filter((p) => Math.hypot(...sub3(reflect(model.coords(p)), lift3(model.coords(p)))) <= 1e-6 * scale);
    const level = curves.filter((c) => {
      const e = model.entities.get(c)!;
      return e.kind === "circle" && model.dim === 3 && Math.abs(dot3(model.normalOf(c), u)) < 1e-6;
    });
    r = { shared, level };
  }
  const shared = new Set(r.shared);
  // A curve whose every point is on the mirror line is its own mirror — a
  // line along it, a circle about a point on it — and is not copied.
  const own = (c: string) => {
    const e = model.entities.get(c)!;
    return e.kind === "circle" ? shared.has(e.center) : model.refsOf(e).every((p) => shared.has(p));
  };
  const copied = curves.filter((c) => !own(c));
  if (!copied.length && points.every((p) => shared.has(p))) {
    throw new Error(`everything given to mirror lies on ${line} — it is its own mirror image`);
  }
  return model.asOperation("mirror", [list, line, r], () => {
    const copyOf = new Map<string, string>();
    for (const p of points) copyOf.set(p, shared.has(p) ? p : model.addPoint(reflect(model.coords(p)).slice(0, model.dim)).name);
    const map = (p: string) => copyOf.get(p)!;
    const made: string[] = [];
    for (const c of copied) {
      const e = model.entities.get(c)!;
      let normal: number[] | null = null;
      if (model.dim === 3 && (e.kind === "arc" || e.kind === "circle")) {
        const nn = model.normalOf(c);
        const k = dot3(nn, u);
        normal = nn.map((x, i) => 2 * k * u[i] - x);
      }
      // A reflection in the plane turns an arc's sense round; a 3D half-turn
      // turns its normal instead, and keeps the order of its ends.
      made.push(copyCurve(model, c, map, normal, model.dim !== 3, undefined));
    }
    for (const p of points) {
      if (shared.has(p)) {
        if (!parseAxisRef(line) && !heldOn(model, p, line)) pointOnLine(model, p, line);
        continue;
      }
      symmetric(model, p, copyOf.get(p)!, line);
    }
    copied.forEach((c, i) => holdCopy(model, c, made[i], r.level.includes(c)));
    return [...made, ...points.filter((p) => !shared.has(p)).map(map)];
  });
}

/**
 * **The pattern naming**: copy k (2, 3, …) of `l1` is `l1_2`, `l1_3` — the
 * seed is instance 1 — for every entity a pattern copies, points included, so
 * a copy says what it is a copy of. A second pattern of the same seed takes a
 * letter, `l1_2b`, and the next `l1_2c`: the first letter none of its names
 * is taken under. Recorded in the register (TODO.md), vetoable.
 */
export function patternNames(model: Model, seed: readonly string[], n: number): (name: string, k: number) => string {
  const letters = ["", ..."bcdefghijklmnopqrstuvwxyz"];
  for (const s of letters) {
    const all = seed.flatMap((e) => Array.from({ length: n - 1 }, (_, k) => `${e}_${k + 2}${s}`));
    if (all.every((x) => !model.has(x))) return (name, k) => `${name}_${k}${s}`;
  }
  throw new Error("this seed has been patterned twenty-six times already — rename some copies, or pattern a copy");
}

function checkCount(n: unknown, op: string): number {
  if (typeof n !== "number" || !Number.isInteger(n) || n < 2 || n > 200) {
    throw new Error(`${op} needs a count, a whole number from 2 to 200 — the seed and its copies — got ${JSON.stringify(n)}`);
  }
  return n;
}

/** What a linear pattern resolved: the step in the world, the plane it is drawn on, and the axis its direction is held to. */
interface LinearResolved {
  step: number[];
  plane: string | null;
}

/**
 * **A linear pattern** — `linear(["l1", "l2", "l3", "l4"], 30, 0, 4)`: the
 * seed and n − 1 copies, each `dx`, `dy` on from the last along the drawing
 * plane's axes (2D: x and y). Copy k of `l1` is `l1_k` (`patternNames`).
 *
 * Held so the pattern follows its seed: a construction line from the seed's
 * first point to that point's first copy carries the step — a `dist` (the
 * spacing, one dimension) and its direction, `par` to the plane's axis when
 * the step lies along one, else an `ang` to its x axis (and, in 3D, `onplane`);
 * every other point of every copy is `translated` from the one before as that
 * first point is (relations/pattern.ts), so one `set` on the spacing moves
 * them all. An arc's copy is held on its ends, a circle's has the seed's
 * radius. **Deleting the seed deletes no copy**: what named the seed's points
 * goes with them, and the copies keep what holds them to one another.
 *
 * Journalled resolved — `linear(names, dx, dy, n, { step, plane })`. Returns
 * the copies' names.
 */
export function linear(model: Model, names: string | string[], dx: number, dy: number, n: number, resolved?: unknown): string[] {
  const list = typeof names === "string" ? [names] : Array.isArray(names) ? names : [];
  if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
    throw new Error("linear needs a step that is not nothing: linear(names, dx, dy, count)");
  }
  const count = checkCount(n, "linear");
  const { curves, points } = copySet(model, list, "linear");
  let r: LinearResolved;
  if (resolved != null) {
    const g = resolved as LinearResolved;
    if (!g || !Array.isArray(g.step) || g.step.length !== model.dim) throw new Error("linear's resolved part is { step: [...], plane }");
    r = { step: [...g.step], plane: g.plane ?? null };
  } else {
    const plane = model.dim === 3 ? model.drawingPlane() : null;
    const pv = plane ? model.planeValues(plane) : null;
    const step = pv ? [0, 1, 2].map((i) => dx * pv.u[i] + dy * pv.v[i]) : [dx, dy];
    r = { step, plane };
  }
  const name = patternNames(model, [...curves, ...points], count);
  return model.asOperation("linear", [list, dx, dy, count, r], () => {
    const made: string[] = [];
    const copies: Map<string, string>[] = [];
    for (let k = 2; k <= count; k++) {
      const map = new Map<string, string>();
      for (const p of points) map.set(p, model.addPoint(model.coords(p).map((v, i) => v + (k - 1) * r.step[i]), name(p, k)).name);
      copies.push(map);
      for (const c of curves) {
        const e = model.entities.get(c)!;
        const normal = model.dim === 3 && (e.kind === "arc" || e.kind === "circle") ? model.normalOf(c) : null;
        made.push(copyCurve(model, c, (p) => map.get(p)!, normal, false, name(c, k)));
      }
    }
    const p0 = points[0];
    const first = copies[0].get(p0)!;
    const lead = model.addLine(p0, first).name;
    model.setConstruction(lead, true);
    const len = Math.hypot(...r.step);
    dist(model, p0, first, len);
    holdDirection(model, lead, dx, dy, r.plane);
    for (let k = 0; k < copies.length; k++) {
      for (const p of points) {
        if (k === 0 && p === p0) continue;
        const prev = k === 0 ? p : copies[k - 1].get(p)!;
        translated(model, prev, copies[k].get(p)!, p0, first);
      }
    }
    let at = 0;
    for (let k = 0; k < copies.length; k++) for (const c of curves) holdCopy(model, c, made[at++], true);
    return [...made, ...copies.flatMap((m) => [...m.values()]), lead];
  });
}

/** A linear pattern's direction held: `par` to the plane's axis when the step lies along one, else an `ang` to its x axis. */
function holdDirection(model: Model, lead: string, dx: number, dy: number, plane: string | null): void {
  const frame = plane === null ? ORIGIN : model.planeKind(plane) === "frame" ? plane : null;
  if (frame === null) {
    // A face's plane has no axes to hold a direction to: the step keeps its
    // length and its plane, and turns freely in it (written down).
    onPlane(model, model.line(lead).refs[1], plane);
    return;
  }
  if (dy === 0) parallel(model, lead, `${frame}.x`);
  else if (dx === 0) parallel(model, lead, `${frame}.y`);
  else {
    // `ang` reads the cosine, so the step's side of the axis is the seed's.
    angleRel(model, lead, `${frame}.x`, Math.atan2(Math.abs(dy), dx));
    if (model.dim === 3 && plane !== null) onPlane(model, model.line(lead).refs[1], plane);
  }
}

/** What a circular pattern resolved: the first point it turns, and (3D) the plane it turns in. */
interface CircularResolved {
  first: string;
  plane: string | null;
}

/**
 * **A circular pattern** — `circular(["c1"], "p0", 2 * Math.PI, 6)`: the seed
 * and n − 1 copies turned about the centre point, counter-clockwise (about +z
 * in 2D, the drawing plane's normal in 3D) — evenly round a whole turn, or
 * from the seed to the last copy across a part of one (`angle`, in radians as
 * every typed angle is; a whole turn by default). Copy k of `l1` is `l1_k`.
 *
 * Held so the pattern follows its seed: the seed's first point off the centre
 * is turned to its first copy by a `rotation` — the pattern's one dimension,
 * the step's angle, which `set` edits — and every other point of every copy
 * is `rotated` from the one before as that first point is (relations/
 * pattern.ts). The centre is not copied. An arc's copy is held on its ends, a
 * circle's has the seed's radius and normal. Deleting the seed deletes no copy.
 *
 * Journalled resolved — `circular(names, centre, angle, n, { first, plane })`.
 * Returns the copies' names.
 */
export function circular(model: Model, names: string | string[], centre: string, angle?: number | null, n?: number,
                         resolved?: unknown): string[] {
  const list = typeof names === "string" ? [names] : Array.isArray(names) ? names : [];
  if (typeof centre !== "string" || model.entities.get(centre)?.kind !== "point") {
    throw new Error(`circular turns about a point — ${JSON.stringify(centre)} is none: circular(["c1"], "p0", 2 * Math.PI, 6)`);
  }
  if (model.dim !== 2 && model.dim !== 3) throw new Error("circular turns in a 2D or 3D model");
  const total = angle ?? TAU;
  if (typeof total !== "number" || !Number.isFinite(total) || total === 0 || Math.abs(total) > TAU + 1e-9) {
    throw new Error(`circular needs an angle in radians, not 0 and at most a whole turn (2π), got ${JSON.stringify(angle)}`);
  }
  const count = checkCount(n, "circular");
  const whole = Math.abs(Math.abs(total) - TAU) < 1e-9;
  const step = whole ? total / count : total / (count - 1);
  const { curves, points: all } = copySet(model, list, "circular", new Set([centre]));
  const points = all.filter((p) => p !== centre);
  const c0 = model.coords(centre);
  let r: CircularResolved;
  if (resolved != null) {
    const g = resolved as CircularResolved;
    if (!g || typeof g.first !== "string" || !points.includes(g.first)) throw new Error("circular's resolved part is { first: a seed point, plane }");
    r = { first: g.first, plane: g.plane ?? null };
  } else {
    const scale = Math.max(1, ...points.map((p) => Math.hypot(...model.coords(p))));
    const first = points.find((p) => Math.hypot(...model.coords(p).map((v, i) => v - c0[i])) > 1e-6 * scale);
    if (!first) throw new Error(`everything given to circular sits on ${centre} — there is nothing to turn about it`);
    r = { first, plane: model.dim === 3 ? model.drawingPlane() : null };
  }
  const axis = model.dim === 3 ? model.planeValues(r.plane!)!.n : [0, 0, 1];
  const turnBy = (x: number[], a: number) => {
    const v = sub3(lift3(x), lift3(c0));
    const k = unitOf(axis);
    const along = dot3(v, k);
    const kx = cross3(k, v);
    const out = v.map((vi, i) => vi * Math.cos(a) + kx[i] * Math.sin(a) + k[i] * along * (1 - Math.cos(a)));
    return lift3(c0).map((ci, i) => ci + out[i]).slice(0, model.dim);
  };
  const name = patternNames(model, [...curves, ...points], count);
  return model.asOperation("circular", [list, centre, total, count, r], () => {
    const made: string[] = [];
    const copies: Map<string, string>[] = [];
    for (let k = 2; k <= count; k++) {
      const map = new Map<string, string>([[centre, centre]]);
      for (const p of points) map.set(p, model.addPoint(turnBy(model.coords(p), (k - 1) * step), name(p, k)).name);
      copies.push(map);
      for (const c of curves) {
        const e = model.entities.get(c)!;
        const normal = model.dim === 3 && (e.kind === "arc" || e.kind === "circle") ? model.normalOf(c) : null;
        made.push(copyCurve(model, c, (p) => map.get(p)!, normal, false, name(c, k)));
      }
    }
    const p0 = r.first;
    const first = copies[0].get(p0)!;
    rotation(model, p0, first, centre, step, r.plane);
    for (let k = 0; k < copies.length; k++) {
      for (const p of points) {
        if (k === 0 && p === p0) continue;
        const prev = k === 0 ? p : copies[k - 1].get(p)!;
        rotated(model, prev, copies[k].get(p)!, centre, p0, first, r.plane);
      }
    }
    let at = 0;
    for (let k = 0; k < copies.length; k++) for (const c of curves) holdCopy(model, c, made[at++], true);
    return [...made, ...copies.flatMap((m) => [...m.values()].filter((p) => p !== centre))];
  });
}
