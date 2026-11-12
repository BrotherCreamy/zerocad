// Linked profiles (docs/plans/linked-profiles.md): an extrude's two profiles
// are peers, related as a mirror's two halves are. The owner: *"i mean kind of
// like mirror relations"*; *"after extrude, it should be impossible to tell
// which was the original and which is the derivative"*; *"The other side of an
// extrude profile is an identically linked profile/sketch entities. If you
// change one the other follows automatically."*
//
// **The link is the `extrusion`** — the one relation that holds every point of
// one profile at its partner plus one chord (relations/extrusion.ts), for an
// extrude and for an edge extrude alike. While it stands, with the record that
// makes a body of it, every relation *within* either profile has a **twin** on
// the other: the same relation over the partner entities, an ordinary entry in
// the registry with a name of its own (`r3_e1`: r3's twin across e1 — derived,
// so it claims no counter and an old file's later names stay theirs, the
// `e1_perp` trick), marked as half of a pair (`RelationEntry.twin`). The model
// treats the pair as one thing — one value, one deletion, and one statement to
// the solver: a linked twin holds no rows, since its partner's rows and the
// extrusion already say it, and is given its own when the link ends (model.ts).
// This file says only **which relations have twins and what a twin says**,
// and keeps that true.
//
// **Kept true by one idempotent pass** (`syncTwins`), run by the model after
// every relation made at the top level and every outermost operation — the
// points a replay reaches too, so a file needs no entry for a twin: replaying
// what made the relation makes its twin again, under the same name. Nothing
// here reads a position; a twin is decided by names and structure alone.
//
// **Which relations twin.** A relation's module entry says (`RelationDecl.twin`):
//
// - `"shape"` — it relates entities to each other and holds wherever the
//   entities are moved together: `dist`, `coin`, `mid`, `on`, `eq`, `sym`,
//   `col`, `spacing`, `coplanar`, `rad`, `dia`, `oncircle`, `conc`, `corad`,
//   `eqrad`, `tan`, `arcends`, `intersection`, `onellipse`, `major`, `minor`.
//   Twinned when **every** entity it names is in one profile.
// - `"direction"` — `par`, `perp`, `ang`: as a shape relation, and it may also
//   name a frame's axis (`par(l1, "origin.x")`), which is a direction: the
//   twin names the same axis, and a translation turns nothing.
// - nothing — it says **where**, and a twin would pin the lid where the base
//   is: `fix`, `onplane` (a picked plane or a face), `pierce`, a face
//   dimension (`fdist`), a `measure` (it holds nothing); and the relations
//   that are links or steps of their own (`extrusion`, `revolution`,
//   `translated`, `rotated`, `rotation`), and `onspline`, whose own variable
//   is one place on one curve.
//
// A relation that reaches **outside** the profile — a `dist` to another
// sketch's point, an `eq` with a line elsewhere — is not twinned, whatever its
// kind: its twin would hold the lid to something the base is held to, which is
// a position by another name.

import { ORIGIN, defineFollower, parseAxisRef, type Model, type RelationEntry } from "./model.ts";

/** How a relation takes part in a link: see the head of this file. */
export type TwinKind = "shape" | "direction";

type RelationFn = (model: Model, ...args: unknown[]) => string;

const twinnable = new Map<string, { fn: RelationFn; kind: TwinKind }>();

/** Says a relation has twins (modules.ts, from its module entry): the function that makes one, and its kind. */
export function defineTwin(op: string, fn: (model: Model, ...args: never[]) => string, kind: TwinKind): void {
  twinnable.set(op, { fn: fn as unknown as RelationFn, kind });
}

/** Whether relations of `op` are twinned across a link, and how — for the register's table and the tests. */
export function twinKind(op: string): TwinKind | null {
  return twinnable.get(op)?.kind ?? null;
}

/**
 * One link: the `extrusion` relation, the record that makes a body (or a
 * sheet) of it, and the entities it pairs — each way. `fwd` is from the
 * profile the record names to its partner, `back` the other way; neither is
 * "the original" to anything that reads a link, and every reader here asks
 * both.
 */
export interface Link {
  via: string;
  record: string;
  fwd: Map<string, string>;
  back: Map<string, string>;
}

/**
 * Every link in the model, in the order the extrusions were made: each
 * `extrusion` relation — an extrude's or an edge extrude's — that has not
 * been **unlinked**. `record` is what its twins are named for: the extrude or
 * edge extrude that makes a body of it, or, where that record has gone and
 * left the two profiles held together, the extrusion itself. Unlinked is what
 * a file from before linked profiles leaves an extrusion whose record went
 * (`Model.deleteFeature`): its lid had no relations of its own then, the
 * entries after it delete that lid piece by piece, and it must go on meaning
 * that.
 *
 * **What it pairs**: the extrusion's own pairs (points, and the curves whose
 * sizes it holds), less a sketch frame's own points — a datum, read and never
 * pushed — and then every line and spline both of whose ends are paired and
 * whose partner exists between the partners of its ends. A wall is not one
 * (its ends are a pair, not two bases), and nor is the piece of a longer line
 * a split region's profile runs along: its lid twin is a line between two
 * points the base line does not end at, so a `dist` on the one is not a `dist`
 * on the other.
 */
export function linksOf(model: Model): Link[] {
  const out: Link[] = [];
  for (const r of model.relations.values()) {
    if (r.op !== "extrusion" || r.unlinked) continue;
    let record = r.name;
    for (const f of model.features.values()) if (f.kind === "extrude" && f.depth === r.name) record = f.name;
    for (const s of model.surfaces.values()) if (s.kind === "extrude" && s.size === r.name) record = s.name;
    const frame = r.args[0] as string;
    const datum = new Set<string>();
    try {
      if (model.planeKind(frame) === "frame" && frame !== ORIGIN) for (const p of model.refsOf(model.frame(frame))) datum.add(p);
    } catch {
      // a frame that cannot be read holds no datum
    }
    const fwd = new Map<string, string>();
    const pairs = r.args.slice(2) as string[];
    for (let i = 0; i + 1 < pairs.length; i += 2) {
      const [b, t] = [pairs[i], pairs[i + 1]];
      if (!model.entities.has(b) || !model.entities.has(t) || datum.has(b) || fwd.has(b)) continue;
      fwd.set(b, t);
    }
    // Lines and splines, which own no variable the extrusion could pair: by their points.
    const key = (kind: string, pts: readonly string[]) => `${kind}:${kind === "line" ? [...pts].sort().join(",") : pts.join(",")}`;
    const byPoints = new Map<string, string>();
    const pointsOf = (e: { kind: string }): string[] | null =>
      (e.kind === "line" ? (e as unknown as { refs: string[] }).refs
        : e.kind === "spline" || e.kind === "bspline" ? (e as unknown as { points: string[] }).points : null);
    for (const e of model.entities.values()) {
      const pts = pointsOf(e);
      if (pts && !byPoints.has(key(e.kind, pts))) byPoints.set(key(e.kind, pts), e.name);
    }
    for (const e of [...model.entities.values()]) {
      const pts = pointsOf(e);
      if (!pts || fwd.has(e.name) || !pts.every((p) => fwd.has(p))) continue;
      const partner = byPoints.get(key(e.kind, pts.map((p) => fwd.get(p)!)));
      if (partner !== undefined && partner !== e.name) fwd.set(e.name, partner);
    }
    const back = new Map<string, string>();
    for (const [b, t] of fwd) if (!back.has(t)) back.set(t, b);
    out.push({ via: r.name, record, fwd, back });
  }
  return out;
}

/** The entity linked to `name` across any link — its partner on the other profile — each with the link it is across. */
export function partnersOf(model: Model, name: string, links: readonly Link[] = linksOf(model)): { partner: string; link: Link }[] {
  const out: { partner: string; link: Link }[] = [];
  for (const link of links) {
    const p = link.fwd.get(name) ?? link.back.get(name);
    if (p !== undefined && model.entities.has(p)) out.push({ partner: p, link });
  }
  return out;
}

/**
 * A relation's arguments carried across `map` — one way of one link — or null
 * when it has no twin that way: it names something the map does not hold (an
 * entity outside the profile, a frame, a plane, a face), or names nothing in
 * it, or two of its entities share a partner (a `coin` of two base corners,
 * whose lid has the one point for both).
 */
function carried(model: Model, kind: TwinKind, map: ReadonlyMap<string, string>, args: readonly unknown[]): unknown[] | null {
  const out: unknown[] = [];
  const from = new Set<string>();
  const to = new Set<string>();
  for (const a of args) {
    if (typeof a !== "string") {
      // Coordinates, a list, an options object: a position, or nothing a twin can carry.
      if (a !== null && typeof a === "object") return null;
      out.push(a);
      continue;
    }
    const partner = map.get(a);
    if (partner !== undefined) {
      from.add(a);
      to.add(partner);
      out.push(partner);
      continue;
    }
    if (model.has(a)) return null;
    // A solid's wall by the entity it is swept from (`"e1:l2"`): a face, which is outside any profile.
    if (a.includes(":")) return null;
    if (a.includes(".")) {
      let axis = false;
      try { axis = parseAxisRef(a) !== null; } catch { axis = false; }
      if (kind === "direction" && axis) { out.push(a); continue; }
      return null;
    }
    out.push(a); // a word that names nothing: a tangent's "end"
  }
  if (!from.size || to.size !== from.size) return null;
  return out;
}

/** What `r`'s twin across `link` says, or null when it has none — whichever of the two profiles `r` is on. */
export function twinCall(model: Model, link: Link, r: RelationEntry): unknown[] | null {
  const t = twinnable.get(r.op);
  if (!t) return null;
  return carried(model, t.kind, link.fwd, r.args) ?? carried(model, t.kind, link.back, r.args);
}

const same = (a: readonly unknown[], b: readonly unknown[]) => JSON.stringify(a) === JSON.stringify(b);

/** A name for `r`'s twin across `record` that nothing has: `r3_e1`, and `r3_e1_2` only where that is somehow taken. */
function twinName(model: Model, r: string, record: string): string {
  const base = `${r}_${record}`;
  if (!model.has(base)) return base;
  for (let n = 2; ; n++) if (!model.has(`${base}_${n}`)) return `${base}_${n}`;
}

/**
 * **Makes the twins true**: every twin still says what its partner says on the
 * other profile, and every relation that should have a twin has one.
 *
 * - A twin whose link is gone, whose partner no longer has a twin there (it
 *   was rebuilt onto other entities, or the profile was restructured under
 *   it), or which says something else now, is **forgotten** alone — its
 *   partner stays, and is twinned afresh below if it still should be. One a
 *   person made that had been adopted is only unlinked.
 * - A relation with no twin across a link it lies within gets one: made by its
 *   own function over the partner entities, under a name derived from its own,
 *   journalling nothing. Where a relation already says exactly that — an old
 *   file's lid dimension repeating its base's — nothing is made, and that one
 *   is **adopted** as the twin when neither is paired across the link yet.
 * - Twins of twins: a lid that is another extrude's profile carries the
 *   relation on to that extrude's lid, so the pass repeats until nothing is
 *   made.
 *
 * Idempotent, and decided by names alone, so a replay makes exactly these.
 * A twin that cannot be made (its function refuses the partner entities) is
 * left unmade: the pair's other end still says it, and the extrusion carries
 * it across.
 */
export function syncTwins(model: Model): void {
  if (![...model.relations.values()].some((r) => r.op === "extrusion" || r.twin || r.asleep)) return;
  const links = linksOf(model);
  for (const r of [...model.relations.values()]) {
    if (!r.twin || !model.relations.has(r.name)) continue;
    const of = model.relations.get(r.twin.of);
    const link = links.find((l) => l.via === r.twin!.via);
    const want = of && link && of.op === r.op ? twinCall(model, link, of) : null;
    if (want && same(want, r.args)) continue;
    if (r.twin.adopted) model.setTwin(r.name, null);
    else model.forgetRelation(r.name);
  }
  // A twin whose link has ended is an ordinary relation that owes its rows
  // (`RelationEntry.twin`): given them here, by its own function.
  for (const r of [...model.relations.values()]) {
    const t = twinnable.get(r.op);
    if (!r.asleep || r.twin || !t) continue;
    try {
      model.wake(r.name, () => void t.fn(model, ...r.args));
    } catch {
      // it stays asleep: a relation its own function refuses now holds nothing
    }
  }
  if (!links.length) return;
  const across = (name: string, via: string) => [...model.relations.values()].some((x) => x.twin?.of === name && x.twin.via === via);
  for (let pass = 0, grew = true; grew && pass < 8; pass++) {
    grew = false;
    for (const r of [...model.relations.values()]) {
      const t = twinnable.get(r.op);
      if (!t || !model.relations.has(r.name)) continue;
      for (const link of links) {
        if (r.twin?.via === link.via || across(r.name, link.via)) continue;
        const want = twinCall(model, link, r);
        if (!want) continue;
        const said = [...model.relations.values()].find((x) => x.name !== r.name && x.op === r.op && same(x.args, want));
        if (said) {
          if (!said.twin && !across(said.name, link.via)) model.setTwin(said.name, { of: r.name, via: link.via, adopted: true });
          continue;
        }
        const name = twinName(model, r.name, link.record);
        try {
          model.withoutRecording(() => {
            const made = model.namedRelation(name, () => t.fn(model, ...want));
            model.setTwin(made, { of: r.name, via: link.via });
          });
          grew = true;
        } catch {
          // no twin: see above
        }
      }
    }
  }
}

/**
 * What the model runs after every relation and every outermost operation
 * (`defineFollower`): `first` — operations.ts's, which closes an open extrude
 * and so may make a line's partner — and then the twins, which read it. After
 * an entity alone no relation has changed, so the twins are left unless
 * `first` says it changed something.
 */
export function followWith(first: (model: Model) => boolean): void {
  defineFollower((model, after) => {
    const changed = first(model);
    if (after === "entity" && !changed) return;
    syncTwins(model);
    // A twin just made may be what closes a profile — a `coin` typed on the
    // lid joins the base's two ends through its twin — so `first` is asked
    // once more, and the twins settled after it if it did anything.
    if (first(model)) syncTwins(model);
  });
}
