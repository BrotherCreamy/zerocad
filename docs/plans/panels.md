# Plan: a toolbar, and every piece of chrome movable and resizable

**Status: built** (2026-10-21) — one PR against
`claude/resume-tasks-o7q02e`, with an empty-canvas hint added to its scope
after the owner's report; deviations are in `TODO.md`'s Done entry.

**Caveats since overturned** (owner, 2026-10-22; built by
[`toolbar-icons-docking.md`](toolbar-icons-docking.md)): the constraint below
that only keeps a panel's *title strip* reachable is now **wholly inside**;
"no icons in v1" is now **icons, the name as tooltip**; and the toolbar,
always a column here, now **turns row/column** against the edge it is dragged
to. And (owner, 2026-10-26; built by [`panels-push.md`](panels-push.md))
panels that float freely over one another are now panels that **never
overlap**: a dragged one pushes the others, in a chain, the window edge the
one immovable thing; and (owner, 2026-10-27) a held panel's **grasp point
stays the same** — stopped short, it waits for the pointer to come back.
And (owner, 2026-10-29; built by
[`panels-corners-wrap.md`](panels-corners-wrap.md)) the one **corner grip** is
now **four, one per corner**, the opposite corner fixed; and the toolbar,
which scrolled when made shorter than its buttons, now ~~**wraps them** into
more columns (or rows), the scrollbar retired~~ — and then (owner, the same
day; built by [`tray-fixed-line.md`](tray-fixed-line.md)) **cannot be resized
at all**: it is exactly one line of its buttons, a button longer for each tool
defined, with no grips; and the grips the other panels keep **draw nothing**,
the resize cursor their only mark. The rest of this spec stands.
Owner's direction, verbatim: *"add the
buttons. but they should be a moveable toolbar. actually everything should
be moveable and resizable."* The original brief listed cellwork's icon
toolbox as a proven idea to port once the foundation existed; this is
that port, generalised the way the owner asked.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, `src/menu.ts` (the one rule a
clickable thing follows here: it types a command the log shows, through
the `submit` seam), `src/main.ts`'s layout and the e2e harness
(`test/e2e/harness.ts` — `at()` measures the canvas; the log pane
currently steals canvas height).

## Design

### Panels (`src/panels.ts`, new)

A small panel manager owns every piece of chrome: a panel is a DOM box
with a **title strip to drag by** and a **corner grip to resize by**,
floating over the canvas. The canvas becomes the whole window; nothing
reflows it any more.

- Drag/resize use pointer capture, constrained to the viewport so a panel
  cannot be lost off-screen (always keep its title strip reachable).
- Layout is **per-viewer UI state** — positions and sizes persist in
  `localStorage` wrapped in try/catch (private windows throw), with a
  sensible default layout when storage is empty or unreadable. It is NOT
  model state: not in the journal, not in the saved file, not an undo
  step. A `layout("reset")` command restores the defaults; `layout()`
  reports.
- Panels never eat canvas gestures and the canvas never eats theirs: a
  press on a panel is the panel's, a press on the canvas is the canvas's,
  and a drag that starts on one never crosses to the other. Test it both
  ways in e2e — this is the bug class a floating UI invites.
- Keyboard: typing while nothing editable has focus still goes to the
  command line (verify the existing rule survives the command line being
  a floating panel).

### The panels

1. **Toolbar** — one button per registered tool, built from the tool
   registry (`listTools()`) at render time, so a tool authored at the
   command line gets a button too (the extensibility brief, kept). Each
   button **types `arm("name")`** through `submit`, exactly as the
   context menu's items do, and shows the command on hover. The armed
   tool's button reads as pressed; Escape/finish clears it. Include the
   extrude and revolve tools. Reasonable default: a vertical strip on the
   left.
2. **Log pane** — the existing log, now a panel (resizable is the whole
   point: a long session wants a tall log, a drawing session wants it
   small). Default: bottom-left, wide.
3. **Command line** — its own panel, default docked under the log's
   position but independent (a user who wants the input top-centre can
   put it there). Keep the status readout and buildstamp in the header
   strip as today; the header is not a panel (it is the app's title bar,
   the one fixed thing — say so).
4. The context menu and hover tag are transient, not panels. Glyphs are
   canvas. Nothing else is a panel in this package — do not invent an
   entity list or a feature tree; those are future packages that will
   *use* the panel manager.

### Visual

In the app's existing family: dark surface, 1px border, the amber accent
only for the armed button; a title strip just tall enough to grab (the
hover-tag styling is the reference); no icons in v1 — the button labels
are the tool names, which is what the command line calls them (icons
would be a second vocabulary; the owner can veto). Keep the toolbar
narrow.

## Verification

Unit: the panel manager's geometry (drag delta, resize clamp, viewport
constraint, storage round-trip with a throwing storage) — pure functions
where possible, DOM-free. E2e: buttons arm tools and the log shows the
typed `arm(...)`; a REPL-defined tool appears as a button; drag the
toolbar and the log, reload, positions persist; resize the log; a drag
that starts on the toolbar does not pan/box the canvas and a canvas drag
does not move a panel; the full-window canvas — update the harness's
`at()`/bounds reasoning and remove the log-steals-height workaround and
its comment; the whole existing e2e suite stays green with the new
layout (expect coordinate assumptions to surface — fix them honestly, not
by shrinking the canvas back). Screenshots at the next free numbers (67
was last): default layout, and a rearranged one. Look at them. Full
`npm run test:all` per commit. Docs duties per `CLAUDE.md`; register
entry (panels are per-viewer state; labels not icons; the header is the
one fixed thing).

## Delivery

Isolated worktree, branch `claude/panels` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews. Footprint: `src/panels.ts` (new),
`src/main.ts`, `index.html` (markup/styles), the e2e harness, tests,
docs. The model, relations, tools and engine are untouched — if you find
yourself in them, stop and say why in the PR.
