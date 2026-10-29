# Plan: undo and redo, bulletproof

**Status: built** (2026-10-29) — one PR against `claude/resume-tasks-o7q02e`
(branch `claude/undo-bulletproof`); every deviation is in `TODO.md`'s Done
entry, and the places this text was wrong about the code are corrected below
and marked *(as built)*.

**Originally queued** (2026-10-29). The owner, verbatim: *"why does ctrl+z and
ctrl+y not work? should work and be bulletproof"*. Read `CLAUDE.md`, the
undo machinery in `src/main.ts` (`beginUserAction`/`endUserAction`, `step`,
the `window` keydown listener for Ctrl+Z/Ctrl+Y and the one that sends
printable keys to the command line), `src/menu.ts`, `src/panels.ts`'s
gesture listeners, `src/tools/engine.ts`'s cancel path, and
`test/e2e/contextmenu.e2e.ts` (`undoKey`) plus every e2e test that presses
`Control+z`.

## What was measured

In headless Chromium against the single-file build, Ctrl+Z and Ctrl+Y undo
and redo the model with the focus on the empty command line, on the body
after a canvas click, and after a toolbar click; Cmd+Z and Ctrl+Shift+Z too.
**One case fails by design and reads as "does not work": text left in the
command box.** The handler's carve-out hands Ctrl+Z to the browser's text
undo, which empties the box and leaves the model alone. The owner's
direction retires that carve-out. The listener is also a bubble-phase one on
`window`, which any element that stops propagation could swallow, and a
tool's gesture in progress is not cancelled by an undo.

## The rule

**Ctrl+Z (Cmd+Z) always undoes the model; Ctrl+Y and Ctrl+Shift+Z (Cmd+⇧Z)
always redo it. Wherever the focus is, whatever is on screen.** A half-typed
command is not protected: the key is the drawing's, the box keeps its text
(the browser's text undo is prevented, so the keystroke cannot empty it), and
up/down history still recovers anything submitted. Specifically:

- The listener runs in the **capture phase** on `window`, first of all
  listeners, and calls `preventDefault` and `stopPropagation` for the undo
  and redo chords only, so nothing below (the input, a panel, a button, the
  menu) sees or swallows them. `e.key` is matched case-insensitively and
  `e.code` (`KeyZ`/`KeyY`) is accepted too, for layouts where the key name
  differs. *(As built: `code` only when `key` is not a Latin letter. On
  QWERTZ the key printed Z reports `key: "z"`, `code: "KeyY"`, so accepting
  either outright would read one keystroke as undo and redo at once; see
  `src/historykeys.ts`.)*
- **An armed tool's gesture in progress is cancelled first** (`engine.cancel`,
  as Escape does), the context menu is closed, then the step runs — an undo
  must never leave a preview of a gesture that no longer has a model under
  it. The tool stays armed. *(As built: re-armed as a fresh instance with the
  options it was armed with — the gesture is the tool instance's state — and
  left disarmed, with the toolbar's reason in the log, if the restored model
  cannot run it: a curve tool whose default frame the undo took away. A drag
  with nothing armed is cancelled the same way, which settles it into a step
  of its own; the same keystroke then undoes that step.)*
- **A visible answer every time**: the log line as now, and the status
  readout briefly shows "undid" / "redid" / "nothing to undo" (the empty-stack
  case must say so rather than do nothing silently). *(As built: in a note
  beside the verdict in the header, `#stepnote`, cleared after 1.6 s — not in
  place of the verdict. Replacing `SOLVED`/`CONFLICT` for a second and a half
  would be a stale readout by construction, and every e2e test that reads
  `#status` straight after a Ctrl+Z would have had to wait it out.)*
- **A mouse path**: Undo and Redo items at the bottom of both context menus
  (empty canvas and entity), typing `undo()` / `redo()`, disabled with "nothing
  to undo" / "nothing to redo" when the stack is empty on that side. *(As
  built: on a constraint glyph's menu too, which is the third menu `menuFor`
  makes; the stack's two booleans are handed in, so `menuFor` stays pure.)*
- Undo and redo are of the model only, as they were: panel layout and the
  camera are not steps. Say so in `help()` under undo, since "Ctrl+Z after an
  orbit does nothing" is the other way this reads as broken.

## Verification

E2e, the matrix, each pressing the chord with a real keyboard: focus on the
empty input; on the input with text (the model undoes, the text stays);
on the body after a canvas click; after a toolbar button; after dragging a
panel strip; with the context menu open (it closes, the undo happens); mid-
gesture with the line tool armed after its first click (the preview goes,
the point it placed is undone, the tool stays armed) — *(as built: wrong
about the code. The line tool's first click places nothing — "a chain that
is abandoned before its second click leaves no stray point behind",
`src/tools/line.ts` — so what that undo takes back is the step before the
gesture. The test checks that, and adds the case this sentence was reaching
for: mid-chain after a committed segment, where the segment is what undoes.
A mid-drag cell was added too.)*; Ctrl+Y and
Ctrl+Shift+Z and Meta+Z; the empty-stack message; the menu items. Also a
unit test that the chord matcher accepts `code` as well as `key`. Full
`npm run test:all`. Docs per `CLAUDE.md`: CHANGELOG at the top quoting the
owner and the measurement; the register (the text carve-out decision
replaced, with his words); STATUS; `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/undo-bulletproof` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews.
