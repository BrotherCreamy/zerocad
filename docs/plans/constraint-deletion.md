# Plan: relation identity, deletion, and cascade

**Status: queued.** The largest infrastructure item on the list, and the one
inference made urgent: tools now create constraints on the user's behalf, and
a constraint you cannot see or remove is a trap. Onshape shows its constraints
and lets you delete the one you didn't want; that is the behaviour being
matched, infrastructure first.

This package is the **infrastructure and command surface**. Constraint glyphs
drawn on the canvas are a follow-up spec, deliberately — they need this to
exist first.

Read `CLAUDE.md`, then `docs/ARCHITECTURE.md`. Two kernel-adjacent changes are
explicitly authorized below; nothing else in `src/kernel/` may change.

## The gap

A relation today is an anonymous closure: residual blocks with a label,
journal entry, and no identity. You cannot refer to "that coincident
constraint" after making it, so you cannot list it, inspect it, or remove it.
Entities have names; relations need them too.

## Design

### 1. Relations become first-class and named

`Model` gains a relation registry beside its entity map: auto-named `r1`,
`r2`, … (same `claimName` discipline as entities — counters bump past
explicit pattern-matching names, so replay is deterministic), each entry
holding `{ name, op, args, blocks }` where `blocks` are the handles of the
residual blocks that relation added.

Mechanism: a wrapper on `Model` — `model.relation(op, args, body)` — that
records the journal entry (as `model.record` does today), runs `body`,
collects the block handles created during it, registers the result, and
returns the name. Every function in `relations/` converts from
`model.record(...)` + bare `addResidual` calls to running inside this
wrapper; the conversion is mechanical and the diff should show it staying
mechanical. Relation functions now return their name (they returned `void`).

Relations created inside a suppressed-recording operation (`fillet`'s
internals) register in the registry but do not journal individually — exactly
like the entities fillet creates. Replaying `fillet(...)` recreates them with
the same auto-names because creation order is deterministic. A test must pin
that: save a model with a fillet, reopen, and the registry names match.

### 2. The kernel learns to remove a block *(authorized change #1)*

`Problem.addResidual` returns a numeric `BlockHandle` (monotonic, never
reused). `Problem.removeBlock(handle)` removes that block; removing an
unknown handle is an error (silence would hide a registry bug). Store blocks
as `{ id, block }` entries so removal never shifts another block's identity.
No geometry in the file, as ever.

*(Authorized change #2 — only if profiling of the entry list forces it:
nothing. There is no second change. Variable removal is deliberately NOT
this package — see tombstones below.)*

### 3. Deletion, with Onshape's cascade

`del(name)` deletes an entity **or** a relation by name, and it cascades the
way Onshape does:

- deleting a **relation** removes its blocks. Nothing else.
- deleting a **point** deletes every entity that references it (a line's
  endpoint, a circle's centre, an arc's centre/start/end — recursively), and
  every relation whose registered args name any deleted entity.
- deleting a **line/circle/arc** deletes the relations naming it; referenced
  points survive (they were the user's points first).

`del` returns the list of names it removed, so the log answers "what did
that just take with it" — and the confirmation story is undo, not a prompt:
`del` is one user action, one Ctrl+Z from harmless, which is exactly the
pattern `open()` already set.

**Variables are tombstoned, not compacted.** A deleted point's variables stay
in the flat vector, referenced by nothing; the damped solve leaves orphan
variables exactly where they are, so they cost memory, not correctness.
Compaction means remapping every captured index list in every closure — real
work with real risk, and the boring design ships first. Document the leak in
STATUS (bounded by session edits; a save/reopen does not shed it either,
since replay re-runs the same creates and deletes — say that too).

### 4. Journal and persistence

Two new journal ops, `deleteEntity(name)` and `deleteRelation(name)`, in
`persist.ts`'s replay table. Old files carry neither and open unchanged — no
format version bump. Round-trip tests: build → delete → save → open → save is
a fixed point; a deleted-then-recreated name replays correctly; deleting
something created inside a fillet replays correctly (creation is implicit in
the fillet's own journal line, deletion is explicit).

### 5. Command surface (and the hover tag)

- `rels()` lists relations (`r3  coin p5 p3`); `rels("p5")` lists those
  naming `p5`. In `help()`.
- `del(name)` as above. In `help()`.
- The hover tag gains the entity's relation names — `p5  12, 30 · r3 r7` —
  which is the whole of this package's *visibility* story. Cheap, already
  legible, and the glyph work builds on the same registry later.
- Clicking still inserts names, so the flow is: hover to see `r7`, type
  `del("r7")`. No new interaction model.

## Verification

The e2e that defines done: draw two rectangles sharing an inferred corner,
hover the corner and see the coincident relation's name in the tag, `del` it,
drag the corners apart (they separate now), Ctrl+Z twice and they are
attached again — geometry, registry and journal all restored to
byte-identical `save()` text. Plus the cascade story (delete a point of a
filleted rectangle; assert exactly what went with it), tombstone behaviour
(delete, then solve — nothing moves, no NaNs), replay determinism tests from
§1 and §4, and `del` of nonsense failing with a reason.

Full `npm run test:all` per commit; screenshots that carry their own
evidence (a before/after of a deleted constraint letting geometry pull
apart, with `rels()` output in frame); docs duties per `CLAUDE.md`.

## Delivery

PR workflow: isolated worktree, branch `claude/constraint-deletion` off the
tip of `claude/resume-tasks-o7q02e`, PR against the working branch. Three
commits: (1) relation registry + kernel `removeBlock` + unit tests;
(2) `del` with cascade + journal/replay + commands + unit tests;
(3) hover tag + e2e + docs.
