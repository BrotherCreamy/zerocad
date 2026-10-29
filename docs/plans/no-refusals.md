# Plan: no refusals — tools find their plane, and a miss is guidance

**Status: queued** (2026-10-29), first package under
[`effortless.md`](effortless.md). Read `CLAUDE.md`, `effortless.md`,
`extrude-makes-its-plane.md` (as built — the pattern to copy),
`src/toolavail.ts`, `src/menu.ts`, the curve tools (`circle`, `circle3`,
`arc`, `arc3`, `fillet` in `src/tools/`), `extrude`, `revolve`, `sketch`,
`src/tools/tool.ts` (`ToolContext.log`'s outcomes, `run`, `act`),
`src/tools/region.ts`, `src/replenv.ts` (`plane`, `circ`, `arc`, `frame`,
the curve commands' `curvePlane` refusal), `src/workplane.ts`, and the
e2e tests for each tool.

## 1. The curve tools make their plane

Today a fresh 3D model greys out circle, circle3, arc, arc3 and fillet until
a default frame exists — the very first thing a newcomer tries after a
rectangle. **Nobody should have to know what a frame is to draw a circle.**
The rule extrude now follows applies: when there is no default frame, the
tool makes one — the working plane the click already lands on (the
camera-parallel plane through the click, `workplane.ts`) — by typing
`plane(…, { look: false })` with three points *it makes for the purpose*
(origin at the click, x-ref and y-ref a span along the screen's axes, as
`frame()` seeds in a turned view), sets it default, and carries on in the
same gesture. The log shows the line. `toolUnavailable` then returns null
for the curve tools in every model; the greyed state and its tooltip reason
go (keep `toolavail.ts` as the one rule, now answering "never"; the menu's
disabled items go with it). Typed `circ()`/`arc()` with no default frame do
the same at the command line (a frame seeded at the view centre, as `frame()`
seeds), in one undo step. The "no default frame" refusal in the model stays
as the guard under the command layer.

## 2. A miss is guidance

Every tool refusal that is about *the click*, not the model, becomes a
guidance note: the tool stays armed; the sentence says what would work and
nothing else; it goes to the status note (the `"done"`-style outcome the
undo package added, in the header, muted) and to the log in the muted
`out` style, never red. Red (`err`) is reserved for the model's own
contradictions. Audit and rewrite each:
- extrude / revolve / sketch, no region: *"click inside a closed outline —
  the ones I can see are lit"* — and **light them**: while such a tool is
  armed, every closed region `findLoops` sees is drawn faintly (the hover
  outline's colour at low alpha), so the user sees where a click would land.
  The hovered one brightens as now.
- revolve, no axis: *"now click a line, or a frame's arm, to turn it about"*
  — and light the candidate lines and frame arms.
- fillet, lines do not meet / wrong kind: say which two things were clicked
  and what fillet wants ("two lines that share a corner").
- circle3 / arc3 collinear points: "those three are on one line — move one".
- any tool, a click on nothing where it needed something: the same shape.
Keep each sentence under ~12 words. The tool's name prefix ("extrude: ")
stays so the log reads.

## 3. The first-run script, end to end, as the test

E2e, a fresh model, nothing typed, pointer only: rectangle tool draws;
circle tool draws a circle inside it (the plane line appears in the log, no
greyed button, no red); extrude tool: a click *outside* any region shows
the guidance and lights the regions (read pixels), a click inside makes the
solid; fillet tool on a corner; revolve tool with a miss then a hit; sketch
tool on the lid; and the log holds **no red line** at the end. Each existing
tool e2e that asserted a red refusal is updated to the guidance. Unit: the
`toolUnavailable` rule; the curve commands' self-made frame and its undo;
the region-lighting derivation. Full `npm run test:all`. Docs per
`CLAUDE.md`: CHANGELOG at the top quoting the owner's direction; the
register's "no world frame" entry (a frame the tool makes for its own click
is the working plane, not a world datum), the toolbar-availability entry
struck, STATUS, `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/no-refusals` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`, in two reviewable commits (the
curve tools' plane; then the guidance audit and lighting). Do not merge; the
supervising session reviews. Do not touch `src/panels.ts`: another package
(`tool-options.md`) owns the options panel and runs after this one.
