# Plan: undo/redo

**Status: shipped, pending review** (branch `claude/undo-redo`, PR against
`claude/resume-tasks-o7q02e`). Built as specced; the deviations are listed at
the bottom under "As built".

Ctrl+Z is not optional in a CAD tool, and nothing here has it. The design
below is deliberately the boring one.

## Design: snapshots, not cleverness

The journal invites a clever design — undo a structural change by truncating
the journal and replaying — and it is the wrong one. Value-only changes (a
drag, a solve) are not journalled, so journal-truncation undo would need value
snapshots *as well*, and the hybrid is more machinery than either half. The
proven design is cellwork's: **whole-model snapshots on a stack**, and this
repo already owns the perfect snapshot format — `toSaved`/`fromSaved` from
`src/persist.ts`, which capture journal *and* values and round-trip
byte-for-byte. Restoring one is exactly what `open()` already does through
`swapModel` in `main.ts`, which is already tested for keeping the REPL's user
bindings alive.

So: `src/undo.ts` is a small pure stack of serialized models — `push(saved)`,
`undo(current)`, `redo(current)`, cap 100 (cellwork's), pushing clears redo.
Everything else is wiring.

## What is one undo step

A **user action**, not a mutation. One step each for:

- a command-line entry that changed the model (compare `save(model, false)`
  before and after the entry; push the before-image only when they differ —
  `ls()` and `help()` must not pollute the stack);
- a tool commit (the line tool's each-segment click is one step each, matching
  its each-click-commits shape);
- a completed drag (snapshot at drag start, pushed on release if it moved);
- `open()` (so opening the wrong file is one Ctrl+Z from harmless).

`undo()`/`redo()` themselves push nothing, and restoring must not re-hook.

## The engine hook

The engine must not know undo exists (layer rule: it is below `main.ts`). It
gains one optional callback — `onUserAction?: (phase: "before" | "after") =>
void` — fired around dispatching `down`/`up` to an armed tool and around the
drag lifecycle (start = before, settled release = after). `main.ts` implements
the snapshot-compare-push policy inside it. No other engine changes.

## Surface

- `undo()` / `redo()` as ordinary commands in `replenv.ts` (host-provided
  handles, like `open`), reported in `help()`.
- **Ctrl+Z / Cmd+Z** undoes and **Ctrl+Shift+Z / Ctrl+Y** redoes, bound on
  `window` — with one carve-out: when the command input holds uncommitted
  text, the browser's own text-editing undo keeps the keystroke. Model undo
  with a half-typed command on screen would be two kinds of confusing; an
  empty input is the signal the keystroke is for the model.

## Verification

Unit: stack semantics (push/undo/redo/cap/redo-cleared-on-push), and the
policy comparisons. E2E, the story that defines done: draw a rectangle, fillet
a corner, drag a point — three Ctrl+Z restore each state in turn (entity
counts and `save()` strings identical to the originals), three redos walk
forward again, and a fresh action after an undo truncates redo. Plus: Ctrl+Z
with text in the input edits the text, not the model; `undo()` from the
command line matches the keystroke; the stack survives nothing (it is not
saved — a reopened file starts with empty history, and the CHANGELOG says so).

Full `npm run test:all` green per commit; docs duties per `CLAUDE.md`;
screenshots that a reader can parse without having been there.

## Delivery

PR workflow: isolated worktree, branch `claude/undo-redo` from the tip of
`claude/resume-tasks-o7q02e` *after* PR #1 has merged, PR against the working
branch. Two commits: (1) `src/undo.ts` + policy wiring + unit tests;
(2) keybindings + e2e + docs.

## As built

Everything above, plus four things the spec did not decide:

- **The engine owns the pairing of `before`/`after`, not the host.** The spec
  named two fire sites (tool dispatch, drag start/settled release); there is a
  third, and it is the reason the balancing had to move into the engine — a
  drag can also end by being *abandoned*, when the model is swapped out from
  under it. A `cancel()` (Escape) closes the action too, because a cancelled
  drag is a settled drag and leaves the same geometry behind. An unpaired
  `before` would strand the host's bracket silently, so the engine closes in a
  `finally` and `test/engine.test.ts` checks all three exits.
- **The snapshot is the text of `save(model, false)`, not a `SavedModel`
  object.** One representation then serves both jobs the design needs — the
  before/after comparison is string equality, and the restore is the same
  `open()` path — and a stored snapshot shares no structure with the live
  model.
- **The host's bracket counts depth**, so only the outermost records a step.
  `open()` typed at the command line is a user action nested inside a command
  entry, and without this it would record two.
- **A fixed TypeError, in code this touches:** a drag whose model was swapped
  out from under it wrote to a cleared `idle` on the next pointer move.

Deliberate limitations, documented in `STATUS.md` and the CHANGELOG: the
history is per-session and not saved; restoring is a full replay, so undo costs
what opening the file costs; the view is not undoable.
