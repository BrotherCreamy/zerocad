// Operations, as distinct from relations. A relation only ever *adds an
// equation* — the model's structure is untouched and the solver does the
// rest. An operation changes the structure itself: it creates entities,
// re-points references, trims things back. Fillet is the first, and the
// distinction is worth a file of its own because the two want reviewing
// with different eyes: a relation can only ever over- or under-constrain,
// while an operation can leave the model malformed.

import {
  SETTABLE_PROPERTY, argRefersTo, parseValueRef, valueArgIndex,
  type Entity, type Model,
} from "./model.ts";
import { dist } from "./relations/basic.ts";
import { angle, arcEndpoints, radius, tangent } from "./relations/geometry.ts";
import { sweepsAs } from "./arcgeom.ts";
import { cross3, lift3, sub3 } from "./vec3.ts";

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
 * The one 2D-shaped decision is which endpoint the arc starts at, and that is
 * asked of the rule every arc is drawn by (see arcgeom.ts) rather than of a 2D
 * cross product, so the short arc between the tangent points is the one drawn
 * however the corner's plane is turned. In 2D the answer is the old one.
 *
 * Returns the new arc's name.
 */
export function fillet(model: Model, l1Name: string, l2Name: string, r: number): string {
  if (model.dim !== 2 && model.dim !== 3) throw new Error("fillet rounds a corner in a 2D or 3D model");
  if (!(r > 0)) throw new Error("fillet needs a positive radius");
  // Journalled as the one call the user made, not as the entities and
  // relations it expands into — replaying it re-expands them identically.
  return model.asOperation("fillet", [l1Name, l2Name, r], () => filletBody(model, l1Name, l2Name, r));
}

function filletBody(model: Model, l1Name: string, l2Name: string, r: number): string {

  const { l1, shared, a, b } = corner(model, l1Name, l2Name);
  const p = model.coords(shared);
  const u = unit(model.coords(a).map((c, i) => c - p[i]));
  const v = unit(model.coords(b).map((c, i) => c - p[i]));

  // The interior angle at the corner decides how far back the legs are cut.
  const cosTheta = Math.min(1, Math.max(-1, u.reduce((s, ui, i) => s + ui * v[i], 0)));
  const theta = Math.acos(cosTheta);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) {
    throw new Error("cannot fillet a corner whose legs are collinear");
  }

  const backoff = r / Math.tan(theta / 2); // corner -> each tangent point
  const toCenter = r / Math.sin(theta / 2); // corner -> arc center
  const legA = Math.hypot(...model.coords(a).map((c, i) => c - p[i]));
  const legB = Math.hypot(...model.coords(b).map((c, i) => c - p[i]));
  if (backoff > legA || backoff > legB) {
    throw new Error(`radius ${r} is too large for this corner (needs ${backoff.toFixed(3)} of leg, have ${Math.min(legA, legB).toFixed(3)})`);
  }

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
  // "Counter-clockwise" is about the side every arc is laid out from; the
  // short way from t1 to t2 is counter-clockwise about the normal t1 × t2
  // (taken from the centre), so t1 starts exactly when that normal is on it.
  const short = cross3(sub3(lift3(t1), lift3(ctr)), sub3(lift3(t2), lift3(ctr)));
  const [start, end] = sweepsAs(ctr, t1, t2, short) ? [shared, t2p.name] : [t2p.name, shared];

  const arc = model.addArc(ctrp.name, start, end, r);
  radius(model, arc.name, r);
  arcEndpoints(model, arc.name);
  tangent(model, l1.name, arc.name);
  tangent(model, l2Name, arc.name);

  return arc.name;
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
  angle: (m, a) => void angle(m, a[0] as string, a[1] as string, a[2] as number),
};

/**
 * The half of every "that has no value" message that says what does. Written
 * in the *short* names, because those are what the user typed to make one —
 * being told about `radius` after typing `rad` is a small riddle to no purpose.
 */
const onlyDims = `only dist, rad and ang have a .${SETTABLE_PROPERTY}`;

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
    const unit = entry.op === "angle" ? " of radians (the label reads degrees; the relation stores radians)" : "";
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
 * Deletes an entity or a relation by name, taking with it whatever could not
 * survive without it. Returns the names it removed, deletion order first.
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
 */
export function del(model: Model, ...names: string[]): string[] {
  if (names.length === 0) throw new Error("del needs at least one name");
  // Validate every name before removing anything: a typo in the middle of a
  // box-selected batch should cost nothing, not leave half the batch gone.
  // (Undo would recover it, but an error that edits is still an error that
  // edits.)
  for (const n of names) {
    if (!model.has(n)) throw new Error(`"${n}" is not an entity or a relation`);
  }
  const removed: string[] = [];
  for (const n of names) {
    // An earlier name's cascade may already have taken this one — a box
    // select hands over a point *and* the line on it, and deleting the point
    // deletes the line. Already-gone is the cascade working, not an error.
    if (!model.has(n)) continue;
    removed.push(...delOne(model, n));
  }
  return removed;
}

function delOne(model: Model, name: string): string[] {
  const isEntity = model.entities.has(name);
  const isRelation = model.relations.has(name);

  const doomed = isEntity ? entityClosure(model, name) : new Set<string>();
  // Every relation that names anything on the way out, plus the relation
  // itself when that is what was asked for. "Names" goes through
  // `argRefersTo`, so a frame referenced only by an axis (`par("l1","f.x")`)
  // still takes that relation with it — see `Model.relationsNaming`.
  const relations = [...model.relations.values()]
    .filter((r) => (isRelation && r.name === name)
      || r.args.some((a) => [...doomed].some((d) => argRefersTo(a, d))))
    .map((r) => r.name);

  const removed: string[] = [];
  // Relations first: an entity cannot go while something still constrains it,
  // and the primitive says so rather than leaving a dangling residual.
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
 * The entities that cannot outlive `name`: itself, whatever references it,
 * whatever references those, and so on. In creation order, so the answer — and
 * therefore the journal a replay reads — does not depend on Set iteration
 * order of a worklist.
 *
 * Note the asymmetry that makes the cascade Onshape's rather than merely
 * transitive: it follows *references inward* (who needs me) and never outward
 * (what do I need). Deleting a line therefore reaches nothing, while deleting
 * one of its endpoints reaches the line.
 */
function entityClosure(model: Model, name: string): Set<string> {
  const found = new Set<string>();
  const queue = [name];
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
