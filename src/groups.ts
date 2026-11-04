// Groups and visibility: the operations that edit them.
//
// The owner's concept is flat relational direct CAD — "there is no hierarchy
// … and entities can be grouped" (docs/plans/groups.md). So a group is a
// **set**, never a container: it names entities and relations and owns none
// of them, an entity may be in any number of groups, and a group never holds a
// group. The registry itself is structure and lives in the model (`GroupEntry`);
// what is here is the editing of it, each edit journalled as one call
// (`asOperation`) and replayed by persist.ts's table.
//
// **A group or a feature named as an argument is flattened, there and then.**
// `group("g1", "l9")` is a group of g1's members as they stand plus l9 — a
// union, not a link — and the journal says so by recording the members
// resolved. A link would be a tree, which is the one thing the owner ruled out.
// A feature is the read-only case of the same idea: `e1` names what the
// extrude made, follows its profile when it regenerates, and so cannot be
// edited as a group — but it can be read as one anywhere a group is read.
//
// **Visibility is part of the document**, as it is in every CAD tool: `hide`
// and `show` are journalled, saved and undone. A hidden entity is not drawn,
// picked, snapped to or boxed — and is still solved; the solver has never
// heard of it (see `Model.hidden`).
//
// **One group may be open** (docs/plans/organiser.md): `opengroup("g1")`, and
// every entity made until `closegroup()` joins g1 — journalled document state,
// like visibility, so a replay opens it at the same step and the same entities
// join (see `Model.openGroup`). Which is also why **a group may be empty**: a
// group made to be drawn into starts with nothing. That reverses groups.md's
// "a group is never empty"; an old file that relied on an emptied group going
// is translated on the way in (persist.ts).

import type { Model } from "./model.ts";

/** What `group`'s last argument may carry. */
export interface GroupOptions {
  name?: string | null;
}

function isOptions(v: unknown): v is GroupOptions {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** The names a call was given, each checked to be a string. */
function namesOf(who: string, args: unknown[]): string[] {
  for (const a of args) {
    if (typeof a !== "string") throw new Error(`${who} takes names, and ${JSON.stringify(a) ?? String(a)} is not one`);
  }
  return args as string[];
}

/**
 * The group called `g`, for an edit — refusing a feature with the reason it is
 * read-only, which is the question a user asking `addTo("e1", …)` has.
 */
function editable(model: Model, g: unknown, who: string) {
  if (typeof g !== "string") throw new Error(`${who} takes the name of a group first`);
  if (model.features.has(g)) {
    throw new Error(`"${g}" is a feature — its members follow its profile, so it cannot be edited as a group; `
      + `group("${g}", …) makes a group of what it is now`);
  }
  return model.groupOf(g);
}

/**
 * `group(...names, { name? })` — a group of the named entities and relations,
 * groups and features flattened to their members now. Returns its name: `g1`,
 * `g2`, … or the one given, which follows the model's name rules (unique, no
 * dot). Journalled with its members resolved and its name, so the file says
 * what the union was. `group()` is an empty one — what the organiser's ＋
 * opens to draw into, `opengroup(group())`.
 */
export function group(model: Model, ...args: unknown[]): string {
  const opts = args.length && isOptions(args.at(-1)) ? (args.pop() as GroupOptions) : {};
  if (opts.name != null && typeof opts.name !== "string") throw new Error("a group's name is text");
  const members = model.expand(namesOf("group", args), "group");
  let made = "";
  return model.asOperation("group", () => [...members, { name: made }], () => {
    made = model.addGroup(members, opts.name ?? null).name;
    return made;
  });
}

/**
 * `addTo(g, ...names)` — the named things into a group, flattened as `group`
 * flattens. Names already in it are left where they are; a call that adds
 * nothing changes nothing and journals nothing, so it is no undo step either.
 * Returns the group's members.
 */
export function addTo(model: Model, g: unknown, ...names: unknown[]): string[] {
  const entry = editable(model, g, "addTo");
  const members = model.expand(namesOf("addTo", names), "addTo");
  if (!members.length) throw new Error("addTo needs at least one name to add");
  const fresh = members.filter((m) => !entry.members.includes(m));
  if (!fresh.length) return [...entry.members];
  return model.asOperation("addTo", [entry.name, ...fresh], () => {
    model.addMembers(entry.name, fresh);
    return [...entry.members];
  });
}

/**
 * `removeFrom(g, ...names)` — the named things out of a group (a group or
 * feature named is its members). Every name must be in the group, checked
 * before anything changes. A group emptied stays, empty, until `ungroup` —
 * and so does one a deletion's cascade empties. Returns the members left.
 */
export function removeFrom(model: Model, g: unknown, ...names: unknown[]): string[] {
  const entry = editable(model, g, "removeFrom");
  const members = model.expand(namesOf("removeFrom", names), "removeFrom");
  if (!members.length) throw new Error("removeFrom needs at least one name to remove");
  const stray = members.filter((m) => !entry.members.includes(m));
  if (stray.length) throw new Error(`${stray.map((s) => `"${s}"`).join(", ")} ${stray.length === 1 ? "is" : "are"} not in ${entry.name}`);
  return model.asOperation("removeFrom", [entry.name, ...members], () => {
    model.removeMembers(entry.name, members);
    return [...entry.members];
  });
}

/**
 * `ungroup(g)` — and `del(g)`: the grouping goes, the members stay. Returns
 * the members it had. A feature is refused: deleting one is `del("e1")`, which
 * takes the solid, and is not this.
 */
export function ungroup(model: Model, g: unknown): string[] {
  if (typeof g === "string" && model.features.has(g)) {
    throw new Error(`"${g}" is a feature, not a group — del("${g}") removes the solid and keeps its sketch`);
  }
  if (typeof g !== "string") throw new Error("ungroup takes the name of a group");
  const entry = model.groupOf(g);
  return model.asOperation("ungroup", [entry.name], () => {
    const had = [...entry.members];
    model.deleteGroup(entry.name);
    return had;
  });
}

/**
 * `opengroup(g)` — what is made from now on joins g: every entity, by a tool,
 * a typed constructor or an operation, in the entry that made it. One group is
 * open at a time, so opening another closes the first; opening the one that is
 * open changes nothing and journals nothing. A feature is refused — its
 * members follow its profile. Journalled as the call: document state, saved
 * and undone like visibility. Escape does not close it; it is not a tool.
 * Returns the group's name.
 */
export function opengroup(model: Model, g?: unknown): string {
  if (g === undefined || g === null) throw new Error("opengroup takes the name of a group — opengroup(group()) opens a new one");
  const entry = editable(model, g, "opengroup");
  if (model.openGroup === entry.name) return entry.name;
  return model.asOperation("opengroup", [entry.name], () => {
    model.setOpenGroup(entry.name);
    return entry.name;
  });
}

/**
 * `closegroup()` — nothing made joins a group any more. Returns the group it
 * closed, or null when none was open — which changes nothing and journals
 * nothing.
 */
export function closegroup(model: Model): string | null {
  const was = model.openGroup;
  if (was === null) return null;
  return model.asOperation("closegroup", [], () => {
    model.setOpenGroup(null);
    return was;
  });
}

/**
 * `rename(g, name)` — a group's new name, by the model's name rules (unique,
 * no dot). Only a group: an entity's or a relation's name is written into
 * every entry that uses it, a feature's is `eN`. The group keeps its members,
 * its place in the list and its being open. Journalled as the call; renaming
 * to the name it has journals nothing. Returns the new name.
 */
export function rename(model: Model, g: unknown, name: unknown): string {
  if (typeof g === "string" && !model.groups.has(g) && !model.features.has(g) && model.has(g)) {
    throw new Error(`"${g}" is not a group — only a group can be renamed: an entity's or a relation's name is in every line that uses it`);
  }
  const entry = editable(model, g, "rename");
  if (typeof name !== "string" || !name) throw new Error("rename takes the group's new name, as text");
  if (name === entry.name) return name;
  const from = entry.name;
  return model.asOperation("rename", [from, name], () => {
    model.renameGroup(from, name);
    return name;
  });
}

/** `members(g)` — a group's members, or a feature's (what it made). Reads; journals nothing. */
export function members(model: Model, name: unknown): string[] {
  if (typeof name !== "string") throw new Error("members takes the name of a group or a feature");
  const m = model.membersOf(name);
  if (!m) throw new Error(`"${name}" is not a group or a feature`);
  return [...m];
}

/**
 * `groups(name)` — the groups an entity or relation is in; `groups()` — every
 * group. Reads; journals nothing.
 */
export function groupsOf(model: Model, name?: unknown): string[] {
  if (name === undefined || name === null) return [...model.groups.keys()];
  if (typeof name !== "string" || !model.has(name)) throw new Error(`there is nothing called ${JSON.stringify(name) ?? String(name)}`);
  return model.groupsHolding(name).map((g) => g.name);
}

/**
 * `hide(...names)` — groups and features expand (a feature's faces go with
 * it). Journalled as typed: replay reads what the names mean at that step,
 * which is what they meant when typed. A call that hides nothing new journals
 * nothing. Returns what it hid.
 */
export function hide(model: Model, ...names: unknown[]): string[] {
  const given = namesOf("hide", names);
  if (!given.length) throw new Error("hide needs a name — of an entity, a relation, a group or a feature");
  const fresh = model.expand(given, "hide", true).filter((n) => !model.hidden.has(n));
  if (!fresh.length) return [];
  return model.asOperation("hide", given, () => {
    for (const n of fresh) model.hidden.add(n);
    return fresh;
  });
}

/**
 * `show(...names)`, and `show()` — everything. The inverse of `hide`, journalled
 * the same way. Returns what it showed.
 */
export function show(model: Model, ...names: unknown[]): string[] {
  const given = namesOf("show", names);
  const now = given.length ? model.expand(given, "show", true).filter((n) => model.hidden.has(n)) : [...model.hidden];
  if (!now.length) return [];
  return model.asOperation("show", given, () => {
    for (const n of now) model.hidden.delete(n);
    return now;
  });
}
