# Architecture

Why the code is shaped the way it is. For *what exists* see
[`STATUS.md`](../STATUS.md); for *how to work on it* see
[`CONTRIBUTING.md`](../CONTRIBUTING.md).

The one-sentence version: a general nonlinear least-squares solver that knows
nothing about geometry, with 2D CAD built on top of it as an ordinary library,
and a command line that can extend that library at runtime.

## The layers

Each layer may only know about the ones below it. That constraint is the main
thing holding the design together, and most of the interesting decisions in
this document are consequences of it.

```
  ┌──────────────────────────────────────────────────────────────┐
  │ main.ts          the browser app: canvas, render loop, wiring│
  ├──────────────────────────────────────────────────────────────┤
  │ repl.ts          a scoped evaluator                          │
  │ replenv.ts       ...and the command surface it evaluates in  │
  ├───────────────────────┬──────────────────┬───────────────────┤
  │ tools/               │ operations.ts    │ persist.ts        │
  │ pointer gestures     │ structural edits │ journal + replay  │
  ├───────────────────────┴──────────────────┴───────────────────┤
  │ relations/       equations over entities. No structure.      │
  ├──────────────────────────────────────────────────────────────┤
  │ model.ts         entities: names, references, which vars     │
  │                  they own. No equations.                     │
  ├──────────────────────────────────────────────────────────────┤
  │ kernel/problem.ts   variables + residual blocks + solve()    │
  │ kernel/dual.ts      forward-mode automatic differentiation   │
  ├──────────────────────────────────────────────────────────────┤
  │ kernel-rs/       Rust → WASM. The only linear algebra.       │
  └──────────────────────────────────────────────────────────────┘
```

`view.ts` sits off to the side: the 2D screen↔world transform, used by the
tool engine and the renderer, depending on nothing. `undo.ts` sits beside it
for the same reason — a stack of snapshots, generic over what a snapshot is,
importing nothing at all.

## The kernel knows nothing about geometry

`Problem` is a flat vector of numbers plus a list of residual blocks. It has
never heard of a point. That is deliberate and worth protecting: the same
solver is meant to work for anything shaped like a nonlinear least-squares
problem, and the moment `problem.ts` grows a `Point` import that stops being
true.

A residual block is *which variables it reads* plus *a function from Duals to
Duals*. Evaluating that function once yields both the residual's value and its
exact derivatives, because `Dual` arithmetic propagates both at once — so
there is no finite-difference perturbation anywhere, and the Jacobian is
exact and sparse for free.

`addResidual` hands back a **block handle** — monotonic, never reused — and
`removeBlock` spends it. A handle rather than an index, because something
above this file has to remember which blocks belong to which constraint and an
index would be invalidated by every removal that happened to come earlier in
the list. Removing an unknown handle throws: the only way to hold one is to
have been given it, so one that names nothing means the bookkeeping above has
lost track, and a silent no-op would leave that constraint in the drawing with
no sign of why.

`solve()` runs Levenberg–Marquardt in TypeScript and calls into Rust once per
Newton step for the linear solve. The Rust side never forms `JᵀJ` explicitly —
it is a matrix-free conjugate gradient on the damped normal equations — so
memory stays proportional to the number of non-zeros rather than to n².

`solve()` also takes `extra?: ResidualBlock[]` — residuals that take part in
that one solve and are stored nowhere. The distinction they draw is between a
*constraint*, which is a claim about the drawing, and an *intention*, which is
a claim about the hand: "this point wants to be under the cursor" is true for
one frame and false by the next, and putting it in `blocks` would make the
model briefly contain something it does not mean. Extras are kept out of the
offender report and out of `maxResidual`, because a deliberately weak residual
never reaches zero and a report that counted it would call every drag a
conflict. This stays geometry-free: `problem.ts` has still never heard of a
point, and the blocks are built a layer up, in the engine.

**Why split it that way?** The expensive inner loop is the linear solve, and
that is the part worth having in WASM. The outer loop is bookkeeping —
damping, step acceptance, convergence — which is easier to read, change and
debug in TypeScript and is not where the time goes.

## Structure and equations are separate

`model.ts` holds structure: names, references between entities, and which
`Problem` variables each entity owns. It holds no equations at all.

`relations/` holds equations. A relation adds one residual block and changes
nothing else.

Both halves are **named**. Entities always were; relations are, now, because
a constraint you cannot refer to is a constraint you cannot inspect or
remove — survivable while every constraint is one you typed, and not
survivable once a tool infers them on your behalf. `Model` keeps a relation
registry beside its entity map, filled by one wrapper (`model.relation`) that
every function in `relations/` is written as a single call to: it journals the
call, gathers the residual-block handles the body adds, and registers them
under `r1`, `r2`, … Entities and relations share the namespace, because
`del("r3")` has to mean one thing.

A relation defined in terms of another — `concentric` via `coincident`,
`arcEndpoints` via two `onCircle`s — is **one** relation: the inner call's
blocks join the outer entry and it journals nothing. Two entries claiming the
same blocks could not both be right, since deleting either would leave the
other holding handles the kernel has forgotten.

This is why a `Line` owns no variables — it is two point references and
nothing more — and why an `Arc` does not automatically constrain its own
endpoints to lie on its own circle. That is the `arcends` relation's job. The
alternative (constructors that quietly add equations) makes it impossible to
tell, reading a model, where its constraints came from.

The split also gives a clean rule for reviewing: **a relation can only ever
over- or under-constrain; an operation can leave the model malformed.** Hence
`operations.ts` being its own file rather than another function in
`relations/`. `fillet` creates entities and re-points a line, so it is an
operation. Everything in `relations/` is not.

## Deleting cascades inward, and undo is the confirmation

`del(name)` removes an entity or a relation and takes with it whatever could
not survive without it. The cascade is Onshape's: a relation takes nothing
else, a point takes everything that references it (recursively) plus every
relation naming any of them, and a line, circle or arc takes the relations
naming it while leaving its points alone. The rule underneath is that the
closure follows references **inward** — who needs me — and never outward —
what do I need. That asymmetry is the whole of it: deleting a line reaches
nothing, deleting one of its endpoints reaches the line.

**There is no confirmation prompt, because undo is the confirmation.** `del`
is one user action, so a cascade that took more than was meant is one Ctrl+Z
from harmless — the pattern `open()` already set. It returns the names it
removed so the log can answer "what did that just take with it".

Deletion is journalled as its **expansion** — one `deleteEntity` or
`deleteRelation` per name — rather than as the `del` call, which is the
opposite of how an operation like `fillet` is journalled and for a good
reason: a `fillet` re-expands identically on replay, while a cascade is
computed against the model as it stood, and recomputing it later could remove
a different set. `Model`'s two primitives refuse to leave the model malformed
(they will not delete something still referenced or still constrained), so a
hand-edited file gets a reason rather than a line with no endpoint.

**Variables are tombstoned, not compacted.** A deleted point's variables stay
in the flat vector, referenced by nothing. The damped solve leaves orphans
exactly where they are, so they cost memory and not correctness. Compaction
means remapping every captured index list inside every closure — real work
with real risk — and a save/reopen does not shed the leak either, because
replay re-runs the same creates and the same deletes. Both facts are pinned by
tests rather than left to be rediscovered.

## Relations follow their entities, not their indices

`addResidual` takes either a list of variable indices or a **thunk**
re-consulted at every evaluation.

The thunk form exists because the thing a relation is *about* can be
restructured underneath it. `hor(l1)` means "this edge is level" — if a fillet
later re-points that edge at a new tangent point, the constraint has to follow.
A captured index list cannot; a thunk that reads the line's current refs can.

This was learned the hard way: the fillet's first version passed every
numerical check to six decimal places while visibly wrecking the rectangle it
was applied to, because the rectangle's edge constraints stayed behind on the
old corners.

`hor` and `ver` therefore take **either** two point names or one line name,
and the two are not interchangeable once a model starts changing shape:

| form | means | survives re-pointing? |
|---|---|---|
| `hor("a", "b")` | these two points share a y | no — it keeps constraining those points |
| `hor("l1")` | this edge is level | yes — it re-reads the line each solve |

Prefer the line form for anything that is a property of an edge. The built-in
tools use it.

## Tools are not privileged

A tool is a class with `onDown` / `onMove` / `onUp` / `onCancel` / `render`,
registered with `defineTool(name, ctor)`. The built-ins use exactly the API a
tool typed at the command line uses — there is no separate plugin surface,
and if there ever is, something has gone wrong.

A tool receives a `ToolContext` (the model, plus `requestRender`,
`requestSolve` and `finish`) and no ambient globals. It stays armed until it
calls `ctx.finish()`, which is why a three-click arc tool needed no engine
change: "multi-stage" is just "finishes later".

The engine keeps navigation and tool use on separate mouse buttons, so a
gesture can be panned through without the tool ever seeing it.

With no tool armed the left button has three meanings, decided by what it
landed on and whether it moved: press a point and move, and the point is
dragged with the model following it; press anything else and move, and the
view pans; press and do not move, and whatever is under the cursor has its name
put into the command line. The hit-test happens once, at press time — from the
first frame of a drag the geometry is moving under the cursor, so re-asking
what is beneath it would hand the drag to whatever the drawing swept past.

## The REPL is scoped, not sandboxed

An entry runs inside a `with` block over a Proxy whose `has` trap claims every
name. Nothing falls through to `globalThis`, and the `get` trap throws
`no such name: modle` rather than quietly returning `undefined`.

**This is curation, not a security boundary**, and the distinction matters
enough to repeat in the source. It exists so an entry sees a small documented
surface and so typos are caught. Code typed there still runs with the engine's
own authority. Genuinely untrusted code would need a worker or an iframe,
which is a different feature with a different threat model.

Two consequences of using `with`, documented rather than smoothed over:

- a bare assignment (`box = ...`) persists to later entries, because the
  Proxy's `set` trap catches it;
- a `const` / `let` / `class` declaration does **not**, because it binds to the
  entry's own function scope.

## A saved file is a journal

A model cannot be serialised directly: a residual block holds a closure, and
closures do not survive JSON.

What does survive is the sequence of calls that produced them. So `Model`
keeps a journal — every entity created, relation applied, operation run — and
a saved file is that journal, replayed on open.

The pleasant consequence is that the save format is a *transcript of the
public API* rather than a second description of the model's internals that has
to be kept in step with them. Anything you can type, you can save.

Two details:

- An operation is journalled as the single call the user made, not its
  expansion, so `fillet("l1","l2",8)` is one line and re-expands on replay.
- Solved coordinates are stored alongside and restored after the replay.
  Replay alone reaches *a* valid configuration, but an under-constrained model
  has many, and reopening a drawing should give back the one that was saved.

Opening only performs calls from a fixed table, so a file is data rather than
a script. That table is a `Map` — a plain object answers a lookup for
`"constructor"` from `Object.prototype`, which let a hostile file straight past
the guard.

## Undo is the save format, on a stack

Because a saved file is a journal *plus* the solved values, it is also a
complete description of a state to come back to — so undo is a stack of them,
and restoring one is the same code path as `open()`.

The clever alternative is worth naming so it is not rediscovered: undo a
structural change by truncating the journal and replaying. It cannot work on
its own, because the changes that are not journalled are exactly the ones a
user makes most often. A drag changes values and records nothing (deliberately
— see above), so a truncating undo would need value snapshots as well, and two
half-mechanisms cost more than one whole one.

**What counts as one undo step is a question about the interface**, so it is
answered in `main.ts` and nowhere lower. The answer is one comparison —
snapshot before the action, snapshot after, record a step only if they differ —
which means nothing has to enumerate which commands are edits. `ls()` stays out
of the history because it leaves the model identical.

This is also why the tool engine gained `onUserAction("before" | "after")`
rather than anything named after undo. The engine is below undo in the layering
and must not know it exists; what it reports is the neutral fact only it can
see, that a gesture began and a gesture ended. The engine does own the
*pairing*, because it alone knows every way a gesture can end — released,
cancelled, or abandoned when the model is swapped out mid-drag — and a `before`
without its `after` would strand the host's bracket with no visible symptom
until the next action went unrecorded.

## Why there is an end-to-end suite

Four bugs so far were invisible to the unit tests and obvious within seconds
of running the app:

1. a status readout that went stale, so a conflict could be introduced from
   the command line while the header still read `SOLVED`;
2. a fillet that satisfied every constraint to six decimals while drawing a
   visibly broken rectangle;
3. an auto-naming loop that had been able to spin forever since the beginning,
   and hung the tab the first time anything handed out names out of order;
4. a pan that silently did nothing mid-gesture, because a second mouse button
   pressed while one is held arrives as a `pointermove` and never as a
   `pointerdown`.

None of these are mathematics. They are all *assembly*. Hence `npm run
test:e2e`, and hence the expectation that anything touching the app is checked
in a browser before it is believed.
