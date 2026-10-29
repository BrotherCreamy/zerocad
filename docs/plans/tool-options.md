# Plan: tool options — declared, visible, remembered

**Status: queued** (2026-10-29), second package under
[`effortless.md`](effortless.md); starts after `tray-fixed-line.md` and
`no-refusals.md` merge. Read `CLAUDE.md`, `effortless.md`,
`src/tools/tool.ts` (`Tool`, `defineTool`, `ToolContext.options`,
`listTools`), the three tools that read options today (`extrude` depth,
`revolve` angle, `fillet` radius), `src/panels.ts` (as built after
`tray-fixed-line`), `src/main.ts`'s toolbar host and `arm`, `src/replenv.ts`
(`arm`, `help()`), `test/panels.test.ts`, `test/e2e/panels.e2e.ts`.

## Design

- **A tool declares its options**: `static options = { depth: { default:
  10, unit: "length", label: "depth" }, … }` on the tool class — number
  options first (that is all three built-ins need); a boolean (`flip`) is
  allowed in the shape. `arm(name, opts)` validates against the declaration
  (an unknown option or a wrong type is a one-line refusal naming the
  options the tool has) and fills defaults. `tools()` / `help()` list each
  tool's options with their defaults.
- **Remembered values**: the last value used for an option in this session
  is the default next time the tool is armed (Onshape remembers the last
  extrude depth). Per viewer, not per file: kept with the layout in
  `localStorage` under its own key, never in the journal or a file.
- **The options panel**: when a tool with options is armed, a small panel
  (an ordinary panel in `panels.ts`: movable, pushes, fixed grab, no
  resize) appears beside the tray with one row per option — the label, a
  number field, the unit — and disappears when the tool is released. Editing
  a field re-arms the tool with the new value by **typing**
  `arm("extrude", {depth: 25})` through `submit`, so the log shows it and
  the terminal and the panel are one mechanism. Enter or blur commits;
  Escape in the field restores. The panel's position is per-viewer like
  every panel's; its default is next to the tray on the tray's free side.
- **Everything typed still works**: `arm("extrude", {depth: 25})` by hand
  shows in the panel; a tool defined at the command line with a `static
  options` gets the panel with no further work; one without options gets no
  panel.
- The dimension a feature makes still carries the value afterward
  (`set("d1.value", …)`, the menu's "Set value"); the panel is for *before*.

## Verification

Unit: declaration validation and defaults; remembered values round-trip
through the storage shim and survive a throwing storage; `arm` refusals name
the options. E2e: arm extrude, the panel shows depth 10; type 25 in the
field, the log shows `arm("extrude", {depth: 25})`, the next extrude is 25
deep; release the tool, the panel goes; re-arm, 25 is remembered; reload,
still 25; define a tool with options at the command line and see its panel;
the panel pushes and is pushed like any panel. LOOK at the screenshot. Full
`npm run test:all`. Docs per `CLAUDE.md`: CHANGELOG at the top quoting the
owner; the register (options are declared; remembered values are viewer
state); STATUS; README's tools paragraph; `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/tool-options` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews.
