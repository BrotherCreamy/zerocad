# Plan: tool options — declared, visible, remembered

**Status: built** (2026-10-29), second package under
[`effortless.md`](effortless.md) — `src/tools/options.ts` (new: `OptionSpec`,
`declaredOptions`, `resolveOptions`, `explicitOptions`, `OptionMemory` under
`neocad.toolOptions.v1`); `Tool.options` and `defineTool`'s check in
`src/tools/tool.ts`; `ToolEngine.arm` in `src/tools/engine.ts`; the
declarations on `extrude`, `revolve` and `fillet`; `optionsSize`,
`besideTray`, `Fitted`, `optionCommand`, `parseField`, `fieldText` and
`OptionsPanel` in `src/panels.ts`; the host, `optionMemory` and `syncToolbar`
in `src/main.ts`; `tools()`, `help()` and `EnvHandles.optionMemory` in
`src/replenv.ts`; the panel's markup and CSS in `index.html`;
`test/tooloptions.test.ts`, new tests in `test/panels.test.ts`,
`test/e2e/tooloptions.e2e.ts`. The toolbar's dead greyed-button wiring is
removed (`ToolbarHost.unavailable`, `buttonTitle`'s reason, the disabled
state and its CSS); `toolUnavailable` stays for `menu.ts` and `main.ts`'s
`step`, which still ask it. Deviations, each marked ⚠ below where the text
was written before the code: ⚠ **validation lives in `ToolEngine.arm`**, not
in the `arm` command, because the bare-name shortcut (`extrude` typed) and
an undo's re-arm reach the engine without passing through it; ⚠ a
declaration may carry a **`check`** (why a value of the right type will not
do), so `depth: 0`, a revolve angle past a whole turn and a radius ≤ 0 are
refused by name where the tools used to fall back to their defaults in
silence; ⚠ a malformed declaration is refused **at `defineTool`**; ⚠ a
refused `arm` **leaves the armed tool as it was** (it used to cancel first);
⚠ a value is remembered **when the tool is armed with it**, not when a
feature is made; ⚠ the panel types **only the option edited**; ⚠ a press
anywhere outside a field being edited **commits it before the press is
handled** (blur alone fires after the canvas has had the click); ⚠ Escape in
the field restores and **does not also release the tool**; ⚠ an angle reads
in radians (`rad`), a length with no unit; ⚠ the strip names the tool;
⚠ `tools()` lists a tool with options as `extrude  { depth: 10 }`, so the
toolbar e2e reads the first word. Read `CLAUDE.md`, `effortless.md`,
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
  tool's options with their defaults. *(As built: in `ToolEngine.arm`, which
  every way of arming reaches; a declaration may also carry `check`, and a
  malformed one is refused at `defineTool`. `tools()` shows what `arm` would
  use now, and the declared defaults after it where a remembered value
  differs.)*
- **Remembered values**: the last value used for an option in this session
  is the default next time the tool is armed (Onshape remembers the last
  extrude depth). Per viewer, not per file: kept with the layout in
  `localStorage` under its own key, never in the journal or a file. *(As
  built: remembered when the tool is armed with it, typed or by the panel —
  arming is the one moment every way of choosing goes through. "In this
  session" was looser than meant: it outlives a reload, as the verification
  below asks ("reload, still 25"); only a throwing storage limits it to the
  page's lifetime.)*
- **The options panel**: when a tool with options is armed, a small panel
  (an ordinary panel in `panels.ts`: movable, pushes, fixed grab, no
  resize) appears beside the tray with one row per option — the label, a
  number field, the unit — and disappears when the tool is released. Editing
  a field re-arms the tool with the new value by **typing**
  `arm("extrude", {depth: 25})` through `submit`, so the log shows it and
  the terminal and the panel are one mechanism. Enter or blur commits;
  Escape in the field restores. *(As built: a press elsewhere commits first,
  so a click straight into the drawing uses the new value; Escape in the
  field is the field's and leaves the tool armed; text that is not a number
  puts the field back and types nothing.)* The panel's position is per-viewer like
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
