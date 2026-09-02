# Plan: the right-click context menu

**Status: shipped, pending review** (2026-09-02). Built as specified on
`claude/context-menu`. Two things the spec left to the build, both recorded
in `CONVERSATION_LOG.md`: the seam a menu item types through is `submit` in
`main.ts` — the function the Enter key already calls, passed to the menu as
an explicit `run` hook rather than reached by faking a keystroke — and `fix`
is given the point's coordinates **in the default frame**, not its raw ones,
because the spec's "current coords" means "hold it where it is" and raw
numbers would not. Two additions beyond the letter of the spec: every item
shows the command it is about to type, beside its label; and the header on
an entity is the hover tag's own sentence rather than a second spelling of
it. Screenshots 43 and 44.

The register's mouse entry has promised this since box select: "when a
context menu exists, right-drag pan should yield to it; middle-drag stays."
Onshape's most-used sketch actions live on right-click, and the standing
rule is that tools work like Onshape. This package builds the menu and
cashes that promise.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `src/tools/engine.ts`'s
pointer handling (the right-button pan and the suppressed `contextmenu`
event are what this package renegotiates).

## The gesture

- **Right-press and release without moving** (same moved-threshold the left
  button uses) **opens the menu** at the cursor, for whatever the press
  landed on — an entity, a constraint glyph, or empty canvas. **Right-drag
  still pans**, exactly as today: the press decides nothing, the release
  does, which is how the left button already splits pick from drag.
- Escape, a click elsewhere, or choosing an item closes it. While a menu is
  open, the next left press goes to the menu, not the canvas.
- The menu is DOM, not canvas (a `<div>` positioned over it, in the app's
  existing visual family — hover-tag styling is the reference). Keyboard:
  Escape closes; arrow keys are not v1.

## What is on it

Everything on the menu is a *shortcut to a command the log shows* — the
menu types into the same machinery the command line uses, and the log
records what it did, so the menu teaches the commands rather than hiding
them. No item does anything a typed command cannot.

On an **entity** (name it in a dim header row):
- **Insert name** — drops the quoted name into the command line (exactly
  what left-click does; here because it makes the menu self-describing).
- **Delete** — `del("name")`, through the same path the command takes
  (undo is the confirmation, per the register).
- **Dimension** — the natural dimension for the kind: a line gets
  `dist(end, end, current-length)`; a circle or arc gets
  `rad(name, current-radius)`; a point gets nothing (no natural single
  dimension; omit the item). Values are the *current* measurements, so the
  action reads as "hold it where it is", Onshape's own dimension-tool
  behaviour. The inserted relation appears in the log like any typed one.
- **Fix** (points only): `fix(name, current-coords)` — but only when a
  default frame exists; otherwise the item is disabled with the standing
  message as its tooltip/subtitle ("no default frame — frame() then
  setDefaultFrame()"). Never silently create a frame.

On a **constraint glyph**: the header names the relation (`r5 dist p1 p2
50`), and the one action is **Delete** (`del("r5")`).

On **empty canvas**: the tool arms — **Point, Line, Rectangle, Circle,
3 point circle, Arc, 3 point arc, Fillet** — each just `arm("name")`, plus
**Frame** (`setDefaultFrame(frame())` when no frame exists yet, `frame()`
otherwise — the one-click way into the frame world the no-world-frame
change requires).

## What this deliberately is not

- No submenus, no icons, no hover-delay flyouts. One flat list per target.
- No selection-set actions — there is no selection set.
- Not a place for anything that cannot be typed. If an item needs new
  machinery, the machinery is a separate package and the menu waits.

## Verification

Unit where the logic is pure (which items for which pick kind; the
dimension-for-kind mapping with current values; the fix-disabled rule).
E2e: right-click-release on an edge → menu visible → Dimension → a `dist`
with the edge's current length exists, log shows it, header SOLVED;
right-drag still pans (the register's promise, now with the menu
existing); Delete on a glyph removes the relation; empty-canvas menu arms
a tool; Escape and click-away close it; the whole Dimension action is one
undo step. Screenshots at the next free numbers (check your tip; 42 was
the latest taken) — menu open on an edge, and the drawing after Dimension,
log in frame. Look at them. Full `npm run test:all` per commit. Docs
duties per `CLAUDE.md`; update the register's mouse entry (the deviation
note about right-click resolves) and add this package's entry.

## Delivery

Isolated worktree, branch `claude/context-menu` off the working-branch
tip, PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews. Expected footprint: a new `src/menu.ts` (DOM
+ item logic), `src/main.ts` wiring, `src/tools/engine.ts` only for the
right-release hook, tests, docs. Nothing else is in flight.
