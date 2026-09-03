# Plan: saved files carry tool source as inert text

**Status: in flight** (2026-09-03). Owner's decision: a REPL-authored
tool's source rides in the saved file as **inert text, pasted back by
hand** — `open()` never evaluates it, and the paste is the consent. This
closes the register's oldest open question and keeps the "a saved file is
data" decision fully intact: nothing in a file runs that the user did not
themselves type.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `src/repl.ts` (the evaluator —
what an "entry" is), `src/replenv.ts` (`defineTool` reaches the registry
through here), and `src/persist.ts` (SavedModel, VERSION 4).

## Design

### Capturing the source

The REPL is the only place a user authors a tool, and the REPL holds the
one honest artifact: **the entry text**. When an entry's evaluation calls
`defineTool`, record `{name, source}` where `source` is the *whole entry*
(an entry may build helpers around its class; slicing out the class
expression would be a parser project and a lie about what the user ran).
Re-defining a tool replaces its record; the capture lives in the command
layer (replenv wraps `defineTool` — the registry itself, in
`tools/tool.ts`, stays ignorant of persistence, and built-in tools are
never captured because they never pass through the wrapper).

This is UI-session state, not model state: it does NOT live in the
journal, does not touch `model.ts`, and is not an undo step. It rides in
the SavedModel as a sibling of the journal: `tools?: {name, source}[]`
(absent when empty, so files without tools are byte-identical to today's).
VERSION stays 4 — an additive optional field is not a format break, and
old readers of v4… do not exist; say so in a comment rather than bumping.

### Opening a file that carries tools

- `open()` replays geometry exactly as today, evaluating nothing. If the
  file carries tools, the result surfaces it: one log line per tool —
  `this file carries the source of tool "gear" — toolSource("gear") shows
  it; paste it to enable` — through the host log (the tool-voice channel's
  sibling; headless, the info is on the return value / a query, not a
  console.warn).
- New command `toolSource(name)` prints the stored source for pasting.
  `tools()` (or the existing listing — check what exists and extend it)
  marks stored-but-not-active tools distinctly from registered ones.
- Pasting the source and hitting Enter is just an ordinary entry: it
  defines the tool, the wrapper re-captures it, and a later `save()`
  carries it forward. **No shortcut that evaluates for you** — not a
  button, not a menu item that runs it. A menu item that *inserts* the
  source into the command line is acceptable if it falls out naturally
  (the insert-not-run pattern), but is not required; if you add it, the
  user still presses Enter having seen the text.

### Round-trip rules

- `save()` after authoring a tool carries it; `open(save())` surfaces it;
  pasting re-activates it; `save()` again carries the re-captured entry.
- A file's `tools` content is DATA everywhere: rendered as text, never
  string-concatenated into anything evaluated, never passed to
  `defineTool` by the app itself. Write the test that proves a hostile
  `source` string sits inert through open/list/print.
- Size: an entry is small; do not invent limits.

## Verification

Unit: capture on defineTool (whole entry, replace-on-redefine, built-ins
never captured); save carries/omits the field; open surfaces without
evaluating (a `source` with a side-effect marker proves nothing ran);
toolSource output; the hostile-string inertness test; round-trip through
paste (drive the repl with the stored source as an entry, tool works).
E2e: author a tiny tool at the command line, save(), open(text) in the
same session, see the log line, toolSource shows it, paste it, arm it,
draw with it. Screenshot at the next free number (47 was the latest) —
the log telling the story. Look at it. Full `npm run test:all` per
commit. Docs duties per `CLAUDE.md`: move the register's saved-file entry
to decided-and-built form; the "saving user-authored tools" queue item
ticks.

## Delivery

Isolated worktree, branch `claude/tool-source-in-files` off the
working-branch tip, PR against `claude/resume-tasks-o7q02e`. Do not
merge; the supervising session reviews. Expected footprint: `replenv.ts`
(wrapper + commands), `persist.ts` (the optional field), `main.ts` only
if the open-surfacing needs the host log, tests, docs. `model.ts` and the
journal stay untouched — if you find yourself in either, stop and say why
in the PR.
