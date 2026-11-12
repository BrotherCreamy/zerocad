// Who is in a relation among many: joining one, leaving one, and what a
// deletion does to one (docs/plans/review-relations.md). The owner's
// principle: *"correct relationships BETWEEN entities … bidirectional
// relationships everywhere by default"* — nothing privileged, nothing
// consumed.
//
// The relation itself is relations/among.ts: `par("l1", "l2", "l3", "l4")`,
// one entry whose rows are the pair relation's. This file is beside
// operations.ts and groups.ts, for their reason: changing a relation's
// members **replaces** its equations in place (`Model.rebuildRelation`, what
// `set` is built on) rather than adding one, which is structure-adjacent
// bookkeeping and an operation, journalled as the one edit it was:
//
// - **`relate(model, op, …names)`** — what a typed `par(…)`, a palette row and
//   a tool's pick run. Where one of the names is already in a relation of that
//   kind, the others **join it**: one relation, not two, whichever was made
//   first and whatever size it was. Nothing shared: the relation is made, as
//   the pair or the set it is.
// - **`join(model, "r3", …names)`** — the edit a joining is journalled as, and
//   typed as itself. Every other relation of the kind that the grown set now
//   shares a member with is merged into it, so there is never a second
//   relation saying what the first already says of the same member.
// - **`leave(model, "r3", …names)`** — the members go and the relation stays
//   over the rest, down to two; with one left it says nothing and goes. What a
//   deletion of a member does (`shrinkFor`, read by operations.ts's cascade),
//   so deleting the first line picked leaves the others exactly as related as
//   deleting any other would.
//
// **A replay never joins.** A file's `parallel ["l1", "l2"]` makes that pair
// whatever else names `l1`, so an old file's star reopens as the separate
// relations it was and re-saves the same; a joining is in the journal as
// `join`, which says which relation and which names.

import { referentsOf, type Model, type RelationEntry } from "./model.ts";
import { among, amongArgs, amongRows, amongSet, isAmongOp, membersOf, type AmongSet } from "./relations/among.ts";

const sameTail = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Whether a relation may be joined or left: a set of equals that is the
 * user's own. One a feature's record names (a pattern's, a solid's own) is
 * part of what that feature is, and is left as that feature made it.
 */
function joinable(model: Model, r: RelationEntry): AmongSet | null {
  const set = membersOf(model, r);
  if (!set) return null;
  const held = model.featuresNaming(r.name).length > 0 || model.blendsNaming(r.name).length > 0
    || [...model.surfaces.values()].some((s) => s.names.includes(r.name));
  return held ? null : set;
}

/** Every other open relation of `op` that shares a member with `members` — same family, relative to the same thing. */
function sharing(model: Model, op: string, set: AmongSet, but: string | null): { r: RelationEntry; set: AmongSet }[] {
  const out: { r: RelationEntry; set: AmongSet }[] = [];
  for (const r of model.relations.values()) {
    if (r.op !== op || r.name === but) continue;
    const s = joinable(model, r);
    if (s && s.family === set.family && sameTail(s.tail, set.tail) && s.members.some((m) => set.members.includes(m))) out.push({ r, set: s });
  }
  return out;
}

function relationOfKind(model: Model, name: unknown, who: string): { r: RelationEntry; set: AmongSet } {
  if (typeof name !== "string" || !model.relations.has(name)) {
    throw new Error(`${who} takes a relation by name first — ${who}("r3", "l5") — and ${JSON.stringify(name)} is not one`);
  }
  const r = model.relationOf(name);
  const set = joinable(model, r);
  if (!set) {
    throw new Error(isAmongOp(r.op)
      ? `${name} is held to a datum or is a feature's own — only a relation among equals (par, eq, col, coin, conc, corad of the drawing's own) is joined or left`
      : `${name} is a ${r.op}, which relates what it names in particular — only par, eq, col, coin, conc and corad hold among many`);
  }
  return { r, set };
}

function checkNames(model: Model, names: readonly unknown[], who: string): asserts names is string[] {
  if (!names.length) throw new Error(`${who} needs at least one name after the relation`);
  for (const n of names) {
    if (typeof n !== "string" || !model.entities.has(n)) throw new Error(`${who}: ${JSON.stringify(n)} is not an entity`);
  }
}

/**
 * **`join("r3", "l5")`** — the named entities join the relation: `r3` is
 * rebuilt in place over its members and them, under the same name. Every
 * other relation of the same kind that the grown set shares a member with is
 * merged in and goes, its members now `r3`'s — so two relations never say the
 * same thing of one member. Returns the relation's name, unchanged.
 *
 * The set is checked whole before anything changes (a line cannot join points),
 * and the new rows are built before the old are removed (`rebuildRelation`), so
 * a refusal leaves everything as it was.
 */
export function join(model: Model, relation: string, ...names: string[]): string {
  const { r, set } = relationOfKind(model, relation, "join");
  checkNames(model, names, "join");
  const members = [...set.members];
  for (const n of names) if (!members.includes(n)) members.push(n);
  // Whatever the grown set now touches, until nothing more does.
  const absorbed: string[] = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const other of sharing(model, r.op, { ...set, members }, r.name)) {
      if (absorbed.includes(other.r.name)) continue;
      absorbed.push(other.r.name);
      for (const m of other.set.members) if (!members.includes(m)) members.push(m);
      grew = true;
    }
  }
  const grown = { members, tail: set.tail };
  // Read as a set again: every member must be of the family, or it refuses here, before anything changes.
  const read = membersOf(model, { ...r, args: amongArgs(grown) });
  if (!read || read.family !== set.family || read.members.length !== members.length) {
    throw new Error(`join: ${names.join(", ")} cannot join ${relation} — it holds among ${set.members.join(", ")}, and they are not all of a kind with those`);
  }
  if (members.length === set.members.length && !absorbed.length) return relation;
  return model.asOperation("join", [relation, ...names], () => {
    model.rebuildRelation(relation, r.op, amongArgs(grown), () => amongRows(model, r.op, grown.members, grown.tail));
    for (const gone of absorbed) model.deleteRelation(gone);
    return relation;
  });
}

/**
 * The relation `relation` over what is left when `names` leave — rebuilt in
 * place, or deleted when fewer than two members would be left. No journal
 * entry of its own: `leave` and the deletion cascade each record what they did.
 */
function withdraw(model: Model, relation: string, names: readonly string[]): "shrunk" | "gone" {
  const r = model.relationOf(relation);
  const set = membersOf(model, r);
  if (!set) throw new Error(`${relation} is not a relation among equals`);
  const members = set.members.filter((m) => !names.includes(m));
  if (members.length < 2) {
    model.deleteRelation(relation);
    return "gone";
  }
  model.rebuildRelation(relation, r.op, amongArgs({ members, tail: set.tail }), () => amongRows(model, r.op, members, set.tail));
  return "shrunk";
}

/**
 * **`leave("r3", "l2")`** — the named members leave the relation, which stays
 * over the rest under the same name; with fewer than two left it says nothing
 * and is deleted. The entity itself is untouched. Returns the relation's name
 * — or null when it went.
 */
export function leave(model: Model, relation: string, ...names: string[]): string | null {
  const { set } = relationOfKind(model, relation, "leave");
  checkNames(model, names, "leave");
  const not = names.find((n) => !set.members.includes(n));
  if (not !== undefined) throw new Error(`leave: ${not} is not in ${relation} — it holds among ${set.members.join(", ")}`);
  return model.asOperation("leave", [relation, ...names], () => (withdraw(model, relation, names) === "gone" ? null : relation));
}

/**
 * **What a deletion does to a relation among many** — asked by
 * operations.ts's cascade of every relation naming something on its way out:
 * the members that are going, when the relation would still hold among two or
 * more without them; null when it goes whole (too few left, or what is going
 * is what the members are relative to, or it is no set of equals at all).
 */
export function shrinkFor(model: Model, r: RelationEntry, doomed: ReadonlySet<string>): string[] | null {
  const set = joinable(model, r);
  if (!set) return null;
  // What they are relative to going takes the relation: there is nothing left to be level with.
  if (set.tail.some((t) => referentsOf(t).some((n) => doomed.has(n)))) return null;
  const going = set.members.filter((m) => doomed.has(m));
  return going.length > 0 && set.members.length - going.length >= 2 ? going : null;
}

/** `shrinkFor`'s members leave, as a deletion's expansion writes it: a `leave` entry, then the deletions. */
export function leaveFor(model: Model, relation: string, going: readonly string[]): void {
  model.asOperation("leave", [relation, ...going], () => withdraw(model, relation, going));
}

/**
 * **The typed relation** — `par("l1", "l5")`, a palette row, a tool's pick —
 * of a kind that holds among many: made as the pair or the set it is where
 * none of the names is in such a relation already, and otherwise **joined to
 * the one that is** (the oldest, when the names bridge several: `join` merges
 * the rest). Returns the relation the names are now in — a new name, or the
 * one they joined.
 */
export function relate(model: Model, op: string, ...args: string[]): string {
  const set = amongSet(model, op, args);
  if (!set) return among(model, op, ...args);
  const twice = set.members.find((m, i) => set.members.indexOf(m) !== i);
  if (twice !== undefined) return among(model, op, ...args); // refused there, in the relation's words
  const hosts = sharing(model, op, set, null);
  if (!hosts.length) return among(model, op, ...args);
  const host = hosts[0];
  // The names the host has not got; or, where it has them all and they are in
  // other relations too (an old file's star), the names as given, so that
  // `join` merges those others into it.
  const added = set.members.filter((m) => !host.set.members.includes(m));
  return join(model, host.r.name, ...(added.length ? added : set.members));
}

/**
 * A relation that holds among many equals, as a module declares it: what a
 * file replays is the relation as written — a pair, or one entry over all its
 * members (relations/among.ts) — and what is typed joins a relation of the
 * kind one of the names is already in (`relate`).
 */
export function amongEntry(op: string): { fn: (model: Model, ...args: string[]) => string; typed: (model: Model, ...args: string[]) => string } {
  return { fn: (model, ...args) => among(model, op, ...args), typed: (model, ...args) => relate(model, op, ...args) };
}
