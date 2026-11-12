// **One relation among many equals** (docs/plans/review-relations.md; the
// owner: *"correct relationships BETWEEN entities … bidirectional
// relationships everywhere by default"*).
//
// Four lines picked and Parallel pressed used to make `par(l1, l2)`,
// `par(l1, l3)`, `par(l1, l4)` — a star on the first pick, which made the
// first pick special: it wore three marks, and deleting it left the other
// three unrelated. Parallel among four lines is one statement, and here it is
// one relation: `par("l1", "l2", "l3", "l4")`, one name, one entry in the
// journal, every member standing in it as every other does.
//
// **The kinds are the ones that are the same thing said of any two members**
// — an equivalence, so that a set is well defined whatever order it was built
// in: parallel, equal (lines among lines, circles and arcs among themselves),
// collinear, coincident, concentric, coradial, equal radius, and points level
// or upright with each other (`par("p1", "p2", "p3", "origin.x")` — the points
// the members, the direction what they are relative to). Perpendicular,
// tangent, symmetric and midpoint are not: a tangent chain says a different
// thing of each neighbouring pair, so it stays one relation a pair.
//
// **The rows are the pair relation's own**, called once for each of n − 1
// pairs that span the set (`amongRows`) inside the one `model.relation` — so
// the entry owns them, a conflict names it once, and whatever is done to the
// pair's rows is done to these. Nothing here is equation: it is which pairs.
// Which pairs is not observable and not journalled — the entry holds the
// members and nothing else — and when a member goes the relation is rebuilt
// over the rest (../among.ts, `leave`), its rows formed afresh.
//
// A relation to a datum — `par("l1", "origin.x")`, `par("c1", "e1:l2")` — is
// not a set of equals: the datum is not a member of anything, each line is
// level on its own account, and it stays the two-sided relation it was.

import type { Model, RelationEntry } from "../model.ts";
import { coincident } from "./basic.ts";
import { collinear, concentric, coradial, equalLength, equalRadius, parallel } from "./geometry.ts";

/** A call's arguments read as a set of equals: the members, and what they are all relative to (a direction for points; nothing otherwise). */
export interface AmongSet {
  members: string[];
  tail: string[];
  /** What kind of thing the members are, where the relation means something different for each (`eq` of lines, `eq` of circles). */
  family: string;
}

interface AmongKind {
  /** The short name it is typed by, for a refusal's words. */
  word: string;
  /** The pair relation, exactly as it was: what two members journal as, and one row of many. */
  pair(model: Model, a: string, b: string, ...tail: string[]): string;
  /** The arguments as a set of equals, or null where they are not one (a datum among them, a line and an arc). */
  read(model: Model, args: readonly unknown[]): AmongSet | null;
}

const kindOf = (model: Model, n: unknown) => (typeof n === "string" ? model.entities.get(n)?.kind : undefined);
const isCircular = (k: string | undefined) => k === "circle" || k === "arc";
const strings = (args: readonly unknown[]): args is readonly string[] => args.every((a) => typeof a === "string");

/** Every argument an entity `want` accepts: a set of that family. */
function setOf(family: string, want: (kind: string | undefined) => boolean) {
  return (model: Model, args: readonly unknown[]): AmongSet | null =>
    strings(args) && args.length >= 2 && args.every((a) => want(kindOf(model, a))) ? { members: [...args], tail: [], family } : null;
}

const AMONG: Readonly<Record<string, AmongKind>> = {
  parallel: {
    word: "par",
    pair: (m, a, b, ...tail) => parallel(m, a, b, tail[0] ?? null),
    read: (model, args) => {
      if (!strings(args) || args.length < 2) return null;
      // Points: level or upright with each other — the last argument what
      // they are relative to, as the point form has always had it.
      if (kindOf(model, args[0]) === "point") {
        const members = args.slice(0, -1);
        return members.length >= 2 && members.every((a) => kindOf(model, a) === "point")
          ? { members: [...members], tail: [args[args.length - 1]], family: "points" } : null;
      }
      // Anything with a direction of its own that a relation can turn: a
      // line, a circle's normal. A frame's axis, a face, a plane are datums.
      const turns = (k: string | undefined) => k !== undefined && k !== "point" && k !== "frame";
      return args.every((a) => turns(kindOf(model, a))) ? { members: [...args], tail: [], family: "direction" } : null;
    },
  },
  equalLength: {
    word: "eq",
    pair: (m, a, b) => equalLength(m, a, b),
    // Lines among lines, circles and arcs among themselves. A line and an arc
    // (equal length along the arc) is its own pair: beside two arcs, which
    // `eq` reads as equal radius, it would not be one statement.
    read: (model, args) => setOf("line", (k) => k === "line")(model, args) ?? setOf("circular", isCircular)(model, args),
  },
  collinear: { word: "col", pair: (m, a, b) => collinear(m, a, b), read: setOf("line", (k) => k === "line") },
  coincident: { word: "coin", pair: (m, a, b) => coincident(m, a, b), read: setOf("point", (k) => k === "point") },
  // Anything with a centre: a circle, an arc, an ellipse and a module's own (`Model.oriented` says which, row by row).
  concentric: { word: "conc", pair: (m, a, b) => concentric(m, a, b), read: setOf("centred", (k) => k !== undefined && k !== "point" && k !== "line" && k !== "frame") },
  coradial: { word: "corad", pair: (m, a, b) => coradial(m, a, b), read: setOf("circular", isCircular) },
  equalRadius: { word: "eqrad", pair: (m, a, b) => equalRadius(m, a, b), read: setOf("round", (k) => k !== undefined && k !== "point" && k !== "line" && k !== "frame") },
};

/** The ops that can hold among many: what a file may journal with more than two members. */
export const AMONG_OPS: readonly string[] = Object.keys(AMONG);

/** Whether `op` is a relation that holds among many equals. */
export function isAmongOp(op: string): boolean {
  return Object.hasOwn(AMONG, op);
}

/**
 * A relation's arguments as a set of equals — its members, what they are
 * relative to, and their family — or null where it is not one: another op, or
 * a relation to a datum (`par("l1", "origin.x")`).
 */
export function amongSet(model: Model, op: string, args: readonly unknown[]): AmongSet | null {
  return isAmongOp(op) ? AMONG[op].read(model, args) : null;
}

/** An existing relation's members, or null where it is not a set of equals. */
export function membersOf(model: Model, r: RelationEntry): AmongSet | null {
  return amongSet(model, r.op, r.args);
}

/**
 * The rows of one relation among `members`: the pair relation n − 1 times, a
 * set of pairs that spans. Called inside a `model.relation` (or
 * `rebuildRelation`) body, where each pair's own `model.relation` is absorbed
 * into the entry being built — which is what makes them one relation's rows,
 * and why this file holds no equations.
 *
 * **Which spanning set is the solver's business, and it is each member with
 * the one listed first** — the equations the star of separate relations had,
 * so a set solves exactly as those did. Measured against each with the next:
 * three lines collinear in 3D from loose seeds (test/reviewrelations.test.ts)
 * solve by this set and, by the chain, fold the first line to a point — `col`
 * puts the second line's ends on the first's, and a line of no length has
 * every point on it; in a chain only one row knows the first line. Nothing
 * above the solver can tell: the entry holds members, a deletion of the one
 * listed first re-forms the rows on the next, and no mark, name or journal
 * entry says which pairs there are.
 */
export function amongRows(model: Model, op: string, members: readonly string[], tail: readonly string[]): void {
  const kind = AMONG[op];
  for (const other of members.slice(1)) kind.pair(model, members[0], other, ...tail);
}

/** The arguments an entry of `members` holds: the members, then what they are relative to. */
export function amongArgs(set: Pick<AmongSet, "members" | "tail">): string[] {
  return [...set.members, ...set.tail];
}

/** Refuses a member named twice: a set holds each once. */
function distinct(kind: AmongKind, members: readonly string[]): void {
  const twice = members.find((m, i) => members.indexOf(m) !== i);
  if (twice !== undefined) throw new Error(`${kind.word} among many takes each once: ${twice} is given twice`);
}

/**
 * **`par("l1", "l2", "l3", "l4")`** — the relation `op` among every argument,
 * as one relation: what a module's entry runs, and so what a file replays.
 *
 * Two members (and anything that is not a set of equals — a datum, a line and
 * an arc) is the pair relation itself, untouched, so every call and every file
 * from before this reads exactly as it did: a star an old file holds replays as
 * the separate relations it was. Three or more is one entry holding all of
 * them. **It never joins another relation**: a replay must make what the file
 * says, and joining is an edit of its own (../among.ts's `relate` and `join`).
 */
export function among(model: Model, op: string, ...args: string[]): string {
  const kind = AMONG[op];
  if (!kind) throw new Error(`"${op}" is not a relation that holds among many`);
  const set = kind.read(model, args);
  if (!set || set.members.length < 3) {
    // The pair's own refusals, in its own words — "l1 is not a point, so this takes two references, not three".
    if (args.length > 3 || (args.length === 3 && op !== "parallel")) {
      throw new Error(`${kind.word} among many takes ${amongNoun(op)} — ${args.map((a) => JSON.stringify(a)).join(", ")} are not all that`);
    }
    return (kind.pair as (model: Model, ...a: (string | undefined)[]) => string)(model, args[0], args[1], ...args.slice(2));
  }
  distinct(kind, set.members);
  return model.relation(op, amongArgs(set), () => amongRows(model, op, set.members, set.tail));
}

/** What a set of `op` is made of, for a refusal: "lines, or circles and arcs". */
function amongNoun(op: string): string {
  switch (op) {
    case "parallel": return "lines (or points, then the direction they are level along)";
    case "equalLength": return "lines, or circles and arcs — not a mix";
    case "collinear": return "lines";
    case "coincident": return "points";
    case "coradial": return "circles and arcs";
    default: return "circles, arcs and ellipses";
  }
}
