// Clauses: "make a thing, and here is what defines it" as one expression.
//
// The owner's ask: "pt(x,y,z) is just one possible constraint set — to have a
// function call based around just one possible constraint set is not
// efficient." The model already agreed (a constructor's arguments are seeds,
// never constraints); what was missing was a way to say the constraint set in
// the same breath as the constructor. So a relation called with `_` in an
// argument does not apply — it hands back a *clause*, inert data naming the
// relation and its arguments with the subject's slot left open — and the
// constructors (and `constrain`) fill that slot with a real name and apply it.
//
// **This is command-layer sugar and nothing else.** A clause applied is the
// relation called by name, exactly as if it had been typed on its own line, so
// it journals as itself, gets its own `rN`/`dN` and its own `del`. Nothing
// below this file learns that clauses exist: the model, the relations and the
// file format are untouched, which is what lets a drawing made with clauses
// save byte-for-byte the same as one made from the expanded lines.
//
// It sits beside `replenv.ts` (it is part of the command surface) and below
// `repl.ts`'s concerns: the evaluator only needs to know how to *show* a
// clause, which it learns through the display hook below, not by importing it.

import { parseAxisRef, parseFaceName, type Model } from "./model.ts";

/**
 * The display hook Node's REPL and `util.inspect` already honour, and the one
 * `repl.ts`'s `fmt` honours too. Using an established convention rather than a
 * private symbol is what lets the evaluator print a clause legibly while
 * knowing nothing about what one is.
 */
const SHOW = Symbol.for("nodejs.util.inspect.custom");

/**
 * The subject placeholder. One frozen instance, compared by identity.
 *
 * An object rather than a symbol so it can print as `_` everywhere — in the
 * log, in a template string, inside a clause's own display — where a symbol
 * would show as `Symbol(_)` and throw in a template string.
 */
class Subject {
  toString(): string { return "_"; }
  [SHOW](): string { return "_"; }
}
export const _ = Object.freeze(new Subject());

/** Whether `_` appears in an argument, at the top level or inside an array. */
function mentionsSubject(arg: unknown): boolean {
  return arg === _ || (Array.isArray(arg) && arg.some(mentionsSubject));
}

/** An argument as it would be typed: `_`, `"l1"`, `[10, 20]`, `4`. */
function show(arg: unknown): string {
  if (arg === _) return "_";
  if (Array.isArray(arg)) return `[${arg.map(show).join(", ")}]`;
  if (arg === undefined) return "undefined";
  return JSON.stringify(arg) ?? String(arg);
}

/**
 * A relation not yet applied: its command-line name and its arguments, with
 * `_` still standing where the subject goes.
 *
 * Plain data — it holds no model and no function — so a clause made before an
 * `open()` still means the same thing afterwards, and applying it is looking
 * the name up in whichever command surface applies it. It prints as the call
 * that made it, so a clause typed on its own is visible in the log rather than
 * a silent `{}`.
 */
export class Clause {
  readonly op: string;
  readonly args: readonly unknown[];

  constructor(op: string, args: unknown[]) {
    this.op = op;
    this.args = Object.freeze([...args]);
    Object.freeze(this);
  }

  toString(): string { return `${this.op}(${this.args.map(show).join(", ")})`; }
  [SHOW](): string { return this.toString(); }

  /** The arguments with `_` replaced by a real name — the call to make. */
  filled(name: string): unknown[] {
    return this.args.map((a) => (a === _ ? name : a));
  }

  /** That call as it would be typed: `oncircle("p1", "c1")`. */
  shownWith(name: string): string {
    return `${this.op}(${this.filled(name).map(show).join(", ")})`;
  }
}

export function isClause(v: unknown): v is Clause {
  return v instanceof Clause;
}

/**
 * One argument of a relation, as far as `_` is concerned: what to call it in
 * a refusal, and whether it takes a number (or numbers), where `_` — which
 * stands for an entity's name — can never go.
 */
export interface Slot {
  name: string;
  number?: boolean;
}

/**
 * A slot list from a compact spelling: `"circle"`, `"#radius"` for a number.
 * Optional slots need no marking — `_` in one is as good as in any other.
 */
export function slots(...spec: string[]): Slot[] {
  return spec.map((s) => (s.startsWith("#") ? { name: s.slice(1), number: true } : { name: s }));
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/**
 * Wraps a bound relation so that `_` in any argument makes a clause instead of
 * applying it.
 *
 * Where `_` may stand is checked **here, when the clause is made**, because the
 * slot is known now and the mistake is the call's: `rad("c1", _)` is wrong the
 * moment it is typed, and saying so at the constructor that later receives it
 * would point at the wrong expression.
 *
 * A clause given *as an argument* to a relation is refused in both modes. It
 * is always a misplaced clause — `dist(on(_, "l1"), "p2", 5)` — and letting it
 * through would meet the model's "is not a point" about a string nobody typed.
 */
export function subjectable<F extends (...args: never[]) => string>(op: string, sig: Slot[], apply: F) {
  return (...args: Parameters<F>): string | Clause => {
    const stray = (args as unknown[]).find(isClause);
    if (stray) {
      throw new Error(`${op} cannot take a clause (${stray}) as an argument — `
        + "a clause goes to a constructor (pt, ln, circ, arc, frame) or to constrain()");
    }
    if (!(args as unknown[]).some(mentionsSubject)) return apply(...args);
    (args as unknown[]).forEach((arg, i) => {
      if (!mentionsSubject(arg)) return;
      if (arg !== _) {
        throw new Error(`${op}: _ cannot go inside ${show(arg)} — that is numbers, and _ stands for an entity's name`);
      }
      const slot = sig[i];
      if (!slot) throw new Error(`${op} takes ${sig.length} arguments, and _ is the ${ordinal(i + 1)}`);
      if (slot.number) {
        throw new Error(`${op}: _ cannot be the ${slot.name} — that argument is a number, and _ stands for an entity's name`);
      }
    });
    return new Clause(op, args as unknown[]);
  };
}

/**
 * Says what a relation's name is doing where a clause was wanted. The commonest
 * way to get here is forgetting the `_`, so the relation applied on the spot to
 * whatever was named and handed back its `rN`.
 */
function strayRelation(model: Model, who: string, value: string): string | null {
  const r = model.relations.get(value);
  if (!r) return null;
  return `${who}: "${value}" is a relation that has already applied (${r.op} ${r.args.map(show).join(" ")}), `
    + "not a clause — a relation becomes a clause when _ stands where the new entity goes";
}

/**
 * Every check that can be made **before anything is made**: each clause is a
 * clause, mentions `_`, and names only entities that exist.
 *
 * The `del` batch rule, for the same reason: a refusal after the entity was
 * made would leave a half-defined thing behind. What this does *not* check is
 * whether each relation will accept its arguments — `on(_, "l1")` on a line is
 * the relation's own refusal to make, in the relation's own words, and second-
 * guessing it here would be a second copy of every relation's rules.
 */
export function checkClauses(model: Model, who: string, clauses: unknown[]): void {
  for (const c of clauses) {
    if (!isClause(c)) {
      const stray = typeof c === "string" ? strayRelation(model, who, c) : null;
      throw new Error(stray ?? `${who}: ${show(c)} is not a clause — a clause is a relation with _ `
        + `where the entity goes, as in on(_, "l1")`);
    }
    if (!c.args.some((a) => a === _)) {
      throw new Error(`${who}: ${c} has no _, so it would not constrain what ${who} is given`);
    }
    for (const a of c.args) {
      if (typeof a !== "string") continue;
      // A solid's face by name (`"e1.lid"`, `"e1:l2"`) is a feature's, not an
      // entity: whether there is such a face is the relation's own refusal.
      if (parseFaceName(a)) continue;
      const axis = parseAxisRef(a);
      const name = axis ? axis.frame : a;
      if (model.entities.has(name)) continue;
      throw new Error(model.has(name)
        ? `${who}: ${c} names "${name}", which is not an entity`
        : `${who}: ${c} names "${name}", and there is no "${name}"`);
    }
  }
}

/**
 * A constructor's own arguments, checked before it makes anything: `_` is
 * never one of them (it means something only inside a relation call), and a
 * relation's name is never one either — that is a clause whose `_` was left
 * out, which has already applied to whatever it named.
 */
export function checkOrdinary(model: Model, who: string, ordinary: unknown[]): void {
  for (const a of ordinary) {
    if (a === _) {
      throw new Error(`${who}: _ stands for the new entity inside a relation call, as in rad(_, 4) — `
        + `it is not one of ${who}'s own arguments`);
    }
    if (typeof a === "string") {
      const stray = strayRelation(model, who, a);
      if (stray) throw new Error(stray);
    }
  }
}

/** A constructor call split by type: its own arguments in order, and its clauses. */
export function splitClauses(args: unknown[]): { ordinary: unknown[]; clauses: Clause[] } {
  return { ordinary: args.filter((a) => !isClause(a)), clauses: args.filter(isClause) };
}
