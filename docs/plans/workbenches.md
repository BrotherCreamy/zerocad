# Plan: workbenches — the app as modules, each a file that registers what it brings

**Status: queued** (2026-11-05), after `sketch-shapes.md` and
`sketch-relations.md` land, before `regions-as-operations.md`,
`sketch-edit.md` and `spline.md`, which are written as modules from the
start. The owner: *"the whole framework should be modular and extensible
(!). like onshape workbenches"*.

## What is true today

The solver knows nothing about points (the layer rule). Tools are a registry
(`defineTool`), the command line defines one at runtime, and a file carries
its tools' source (`tool-source-in-files.md`: the paste is the consent).
Relations are registered by name in `replenv.ts` and replayed by a table in
`persist.ts`; operations the same; the save format is a journal of typed
calls. The bodies kernel is a Worker behind one contract (`solids/kernel.ts`).

What is missing is the **unit**. A tool, its relations, its operation, its
menu item, its help, its replay entry, its icon and its toolbar group are
registered in five tables by hand (the ellipse and the polygon are being
added that way now). Entity kinds — point, line, circle, arc, frame — are
hard-wired in `model.ts` and switched on by name in drawing, picking,
snapping, loops, faces and STEP. There is one toolbar, so every workbench's
tools would share it.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` whole (the layer rule; "Tools are
not privileged"; "A file carries its tools' source"; "A saved file is a
journal"; "The REPL is scoped, not sandboxed"), `tool-source-in-files.md`,
`toolbar-groups.md`, `tool-options.md`, `sketch-shapes.md` as built (the
seams the ellipse touched, listed there), `solids-kernel.md`,
`src/tools/tool.ts`, `src/replenv.ts`, `src/persist.ts`, `src/menu.ts`,
`src/tools/icons.ts`, `src/main.ts`, `src/model.ts`, `src/loops.ts`,
`src/faces.ts`, `src/picking.ts`, `src/snapping.ts`, `src/step.ts`,
`src/organiser.ts`, and their tests.

## Design

- **A module is one file that registers everything it brings**, through one
  call:
  ```ts
  defineModule("sketch", {
    tools: [CircleTool, ArcTool, ...],        // each with its static group, icon, summary
    relations: { tan: ..., oncircle: ... },   // name → (model, ...args) and its slots
    operations: { fillet: ... },              // name → asOperation body
    entities: [ellipse],                      // entity kinds, see below
    menu: [...], help: "...",                 // what the menu and help() show
    replay: { ... },                          // what persist.ts needs, if not derivable
    groups: { shapes: [...], modify: [...] }, // toolbar groups this module owns or extends
  });
  ```
  Every table that exists today (`TOOL_ICONS`, `TOOL_GROUPS`, `TOOL_ITEMS`,
  the relation and operation registries, the replay table, help's text) is
  filled *from* modules at load, in module order, and is no longer written
  by hand. A module may extend another's group (the shapes group is the
  sketch module's; a later module adds to it).
- **Everything that exists is re-cut into modules**, with no visible change:
  `core` (point, line, frame; `dist fix onPlane coin mid par perp ang on eq
  sym`; `set del construction`), `sketch` (circle, arc, rectangle, polygon,
  slot, ellipse, fillet; the curve relations; `hole unhole`), `solids`
  (extrude, revolve, sketch-on-face, the kernel, bodies), `step` (export;
  later import), `files`, `organiser`. The proof is `npm run test:all` with
  the same counts and the same screenshots (the e2e suite as the oracle);
  the journal of every fixture file replays to the same model.
- **The entity extension point** — the hard part, and the one the owner's
  ask stands on. An entity kind declares:
  - its **variables** (how many, their seeds) and its **refs** (which other
    entities it names, so deletion cascades and relations follow);
  - how it is **drawn** (the curve sampled to a polyline at a resolution, in
    both views), **picked** (nearest point on it) and **snapped** (its
    snap points: ends, centre, quadrants, as it says);
  - how it is a **loop member** (its sampling for `loops.ts`, closed or not,
    its portion between two points on it), and so a face edge the kernel's
    profile takes (`solids/profile.ts`: line, arc, circle, or NURBS);
  - how it is written to **STEP** and to the **journal** (its `add` call).
  Point, line, circle, arc and frame become declarations too — the proof
  that the point is real is that the **ellipse moves out of `model.ts`**
  into the sketch module with no special case left behind: `grep ellipse
  src/model.ts src/loops.ts src/faces.ts src/picking.ts src/step.ts` is
  empty. `model.ts` keeps structure (names, refs, variables, relations,
  the journal) and asks the kind for everything else. The layer rule
  stands: the kernel sees variables and residuals, nothing more.
- **A workbench is a named set of modules with its own toolbar and menu**:
  `sketch` (core + sketch), `part` (core + sketch + solids + step), later
  `surfaces`, `assembly`, `drawing`. A switcher in the logo menu and typed
  (`workbench("part")`); the current one remembered per document (the
  journal's head, not a layout key) and in the organiser's heading. The
  tray shows the workbench's tools in its groups; typed names from any
  loaded module work in any workbench (a typed call is not a toolbar).
  Default workbench: `part`, which is today's toolbar exactly.
- **Loading.** Built-in modules ship with the app and are loaded at start.
  A module can also be loaded from a file or a URL from the command line
  (`loadModule(url)`), with the consent rule files use for tool source and
  the same scope (the REPL's: curated, not a sandbox, and said so). A
  document that uses a loaded module records it (name, source, hash) in the
  journal's head, as files record their tools, and says what is missing
  when opened without it — never a hung open. This is the door someone
  else's workbench comes in by.
- **The command line is the first client.** `defineTool` keeps working as
  it is (a tool with no module joins a `user` module); `defineRelation`,
  `defineOperation` and `defineEntity` join it, each documented in
  `help()`, each a typed call so the file carries it.
- Format version +1 (the head's module list). Old files open unchanged.

## Tests (the risky ones first)

- Every fixture file replays to the same model, and every e2e screenshot
  comparison (the golden pictures) holds, after the re-cut.
- The ellipse through the extension point only; the grep above is a test.
- A module defined at the command line with one tool, one relation and one
  entity kind: drawn, picked, saved, opened; opened without the module the
  file says what is missing and the rest of the model is intact.
- The workbench switcher: the tray and menu change, typed names do not;
  remembered on save/open; the default is today's toolbar (button list
  equal).
- Unit: the registries are filled from modules in order; a module that
  registers a name twice is refused with the name; a group extended by two
  modules keeps both in module order.
- E2E (mouse and iPhone 13): switch workbenches, draw in one, extrude in
  the other; load a module from a pasted source; everything fits still
  holds for each workbench's tray. LOOK at each.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE gets a section
("A module is the unit") and the layer diagram updated; the register
(modules, the workbench table, the entity declaration, loading and its
consent) as vetoable; STATUS; README; CONTRIBUTING (how to add a module —
the cold-start test is that a person can add one from the docs alone);
`help()`; the spec marked built with the deviations.
