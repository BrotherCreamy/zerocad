# Plan: clauses — an entity defined by any constraint set

**Status: built** (2026-10-21) — one PR against `claude/resume-tasks-o7q02e`;
the deviations (chiefly: the three-point circle below is `oncircle("p1", _)`,
since `oncircle` takes the point first) are in `TODO.md`'s Done entry. The owner's ask, verbatim: *"please think
about how to create a syntax that enables me to create elements with arbitrary
constraints. pt(x,y,z) is just one possible constraint set — to have a function
call based around just one possible constraint set is not efficient."* The
proposal was put to him with one open question (below); this spec ships the
recommended answer and records it on the register where he can veto it.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (the command layer, journal-as-the-
call, free entities), `src/replenv.ts` end to end (the `relations` bag, the
`geometry` bag's constructors `pt`/`ln`/`circ`/`arc`/`frame`, `del`'s batch
rule, `help`), `src/repl/` (how a line is evaluated and what `submit` brackets
as one undo step), and the register's "constructor arguments are seeds, never
constraints" decision in `TODO.md`.

## The idea

The model already agrees with the owner: `pt(10, 20)`'s arguments are a
*seed*, and the real way to define a point is `p = pt(); on(p, "l1"); on(p,
"l2")`. The vocabulary for arbitrary constraint sets exists. What is missing is
one expression that says "make a thing, and here is what defines it".

**A subject placeholder `_`, and constructors that take clauses.**

A relation called with `_` in an argument does not apply. It returns an inert
*clause* — plain data, `{ op, args }` with that slot open. Constructors accept
clauses after their ordinary arguments and fill the slot with the new entity's
name:

```js
c = circ(oncircle(_, "p1"), oncircle(_, "p2"), oncircle(_, "p3"))   // a 3-point circle
c = circ(tan("l1", _), oncircle(_, "p3"), rad(_, 4))                // "tangent to L1, through p3, radius 4"
p = pt(on(_, "l1"), on(_, "l2"))                                    // the intersection
p = pt(fix(_, [10, 20]))                                            // coordinates as what they are: one constraint set among many
l = ln(par(_, xaxis()), on("p1", _))                                // whatever defines it
```

`_` is explicit on purpose: it says exactly which slot the subject fills
(`tan("l1", _)` and `tan(_, "c1")` are both unambiguous) and it is the standard
partial-application spelling.

**The decision shipped, pending the owner's veto: `_` is required.** Omitting
it when unambiguous (`circ(oncircle("p1"))`) is deferred — it would make an
arity-short relation call mean something other than an error. Record this on
the register as a decision, quoting the owner's sentence, with "omission can be
added later without breaking anything" as the reason.

## Design

- **Pure command-layer sugar.** The expansion of `pt(on(_, "l1"), on(_,
  "l2"))` is literally `name = pt(); on(name, "l1"); on(name, "l2")`. Every
  relation journals as itself, with its own name and `del`; the constructor
  journals as itself. **No change to `model.ts`, `relations/`, `persist.ts` or
  the file format**: a saved file from a clause expression is byte-identical
  to one from the expanded lines — test that. Undo is one step because a
  submitted line is one step already.
- **`_` is one value** exported from the command layer (a unique symbol or a
  frozen sentinel object), in scope at the command line. A relation in the
  `relations` bag, given `_` in any argument, returns a clause instead of
  applying. The relation bindings are the one place to implement this (wrap
  `bind`; `fix` has its own binding — cover it). A clause carries the
  relation's *command-line name* (`op`), its arguments with `_` left in, and
  prints itself legibly (`toString`/log display: `on(_, "l1")`), so a clause
  typed alone is visible in the log, never silent.
- **Constructors take trailing clauses.** `pt`, `ln`, `circ`, `arc`, `frame`:
  ordinary arguments first (seeds, as now), then any number of clauses;
  arguments may also be mixed where types make it unambiguous (a clause is
  never a number, a name or null, so the split is by type, not position). A
  constructor with clauses: makes the entity exactly as it does today, then
  applies each clause with `_` replaced by the new name, in order. It returns
  the name, as now, so clauses nest: `ln(on(pt(on(_, "l1")), _), ...)`.
- **The primitive is `constrain(name, ...clauses)`**: applies clauses to an
  existing entity; a constructor with clauses is `constrain(pt(), ...)`.
  Nothing is special about creation. It returns the relation names it made.
- **A seed in clause form:** when the constraints admit several solutions,
  the seed picks the branch (the register's existing rule). `pt(10, 20,
  on(_, "l1"))` already covers it for points by the mixed-argument rule; make
  sure the 2D-in-3D lift (`lifted`) still applies to the seed part.
- **Legible mistakes, the `del` batch rule.** Before any clause applies, every
  clause is checked: it is a clause (not a stray relation result, not a
  string), every name it mentions exists, and `_` appears in it at least once.
  An error after the entity was made would leave a half-defined thing behind,
  so the check runs before the constructor makes anything; a clause that still
  throws while applying (the relation's own refusal, e.g. a 3D circle with no
  plane) propagates with the entity already made — document that as the
  deliberate limit (the relation's refusal is the model's own and is not
  second-guessed here) and make sure the journal shows exactly what happened.
  A relation given `_` in a slot that must be a number (e.g. `rad("c1", _)`)
  throws at clause-making time with a message naming the slot.
- **Help.** A short paragraph in `help()` with two of the examples above.
- **Not in scope:** no new relation vocabulary (no `through`: `oncircle`/`on`
  are the names), no change to the pointer tools, no omission of `_`.

## Verification

Unit (`test/clauses.test.ts` or in the replenv tests): each example above
builds and solves to the expected geometry; `constrain` on an existing entity;
nesting; the mixed seed+clauses form including the 2D-in-3D lift; a clause
typed alone evaluates to a clause whose string form is the call; every
refusal above with its message; `_` in a numeric slot refuses; a clause used
in a slot where the relation needs a point but the subject is a line (e.g.
`ln(on(_, "l1"))` — a line on a line) surfaces the relation's own refusal, not
a crash; journal/save of a clause expression equals the expanded lines
byte-for-byte; `del` of the entity cascades exactly as it does for the
expanded form. E2e: type the 3-point circle and the intersection point at the
command line, see them solve, undo in one step, save and open. LOOK at the
screenshot. Full `npm run test:all` green. Docs per `CLAUDE.md`: CHANGELOG
entry at the top quoting the owner's sentence; the register decision entry;
STATUS; README's command-line section gets the two examples; this file marked
built.

## Delivery

Isolated worktree, branch `claude/clauses` off the working-branch tip, one PR
against `claude/resume-tasks-o7q02e`. Do not merge; the supervising session
reviews.
