# Plan: workbenches — the app as modules, each a file that registers what it brings

**Status: built** (2026-11-05), on `claude/workbenches`; see *As built* at
the end for every deviation. Queued after `sketch-shapes.md` and
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
- **Loading — "Add workbench…" in the menu.** The owner: *"obv the concept
  is that I should be able to add a workbench simply by opening a file on my
  device, from the menu... should be some item like 'add workbench'"*.
  Built-in modules ship with the app and are loaded at start. The logo
  menu gets **Add workbench…**, which opens the device's file picker (the
  `files.md` host: the Files app on an iPhone, a file dialog on a desktop,
  drop onto the window too) for a **workbench file**: one JavaScript file
  whose source calls `defineModule` and, optionally, `defineWorkbench`
  (`.zerocad.js`; a `.zip` of several files later if ever needed). Before
  anything runs the app shows what the file registers — its name, its
  tools, relations, operations and entity kinds, by name, read from a
  manifest comment at the top of the file, not by running it — and asks;
  the paste rule of `tool-source-in-files.md` is the model: the consent is
  explicit, the scope is the REPL's (curated, not a sandbox, and said so).
  Accepted, it is loaded now, **kept on the device** (IndexedDB, beside the
  autosave) and loaded at every start until removed; the menu lists added
  workbenches under the built-in ones with a Remove and a Share (which
  hands the file back, so a workbench travels by AirDrop or mail like a
  document). Typed: `loadModule(url)` and `addWorkbench()` do the same with
  a URL or the picker. A document that uses an added module records it
  (name, source hash) in the journal's head, as files record their tools,
  and when opened on a device without it says which workbench is missing
  and offers the picker — never a hung open, and the rest of the model is
  intact. This is the door someone else's workbench comes in by.
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
- **Add workbench… end to end** (mouse and iPhone 13): a workbench file
  picked from the menu shows its manifest, is accepted, its tools appear in
  the tray under its workbench, it is there after a reload, Remove takes it
  away, Share hands the file back byte for byte; a file whose manifest and
  source disagree is refused and says so; a document that needs it opens on
  a fresh profile with the "missing workbench" offer.
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

## As built

Built on `claude/workbenches` (2026-11-05), in four proven steps, each its
own commit: the re-cut, the ellipse through the extension point (and the
diagnosis fix it turned up), then workbenches and Add workbench… together.

By file. **New:** `src/modules.ts` (`defineModule`, `checkModule`,
`extendModule`, `removeModule`, the tables' readers — `moduleRelations`,
`replayEntries`, `menuToolItems`, `fileMenuItems`, `moduleHelp`,
`moduleCommands` — workbenches, `activeWorkbench`, the manifest —
`readManifest`, `manifestDisagrees`, `loadingFile` — and `textHash`);
`src/modules/{core,sketch,solids,files,step,organiser,interface,builtin}.ts`;
`src/kinds/ellipse.ts` (the ellipse's structure, `addEllipse`,
`checkEllipse`, `ellipseOf`, `semiAxes`); `src/workbenchhost.ts` (the
picker, the question, the IndexedDB store, Remove, Share). **Changed:**
`model.ts` (`EntityTypes`, `EntityKindSpec` and its registry,
`defineDimension`, the kind asked in `refsOf`, `oriented`/`normalOf`,
`planeKind`, construction, `ownVars` and the diagnosis's gauges; the ellipse
gone), `loops.ts`, `faces.ts`, `picking.ts`, `step.ts`, `curveplane.ts` (each
asks a kind's facet), `projection.ts` (a conic frame by its second radius; a
sampled kind's polyline), `operations.ts` (`defineRebuild`), `persist.ts` (the
replay table from modules; format 16's head — `workbench`, `modules`,
`savedHead`, `modulesUsed`, the tolerant replay, `lastOpen`), `replenv.ts` (the
relation vocabulary, module commands, help, `defineModule`, `defineWorkbench`,
`defineRelation`, `defineOperation`, `defineEntity`, `modules()`,
`workbench()`, `workbenches()`, `addWorkbench()`, `loadModule()`,
`removeWorkbench()`, `shareWorkbench()`), `tools/tool.ts` (`TOOL_GROUPS` filled
by `defineGroup`, `undefineTool`, `toolbarButtons(on?)`), `tools/icons.ts`
(`TOOL_ICONS` filled by `defineIcon`; the glyphs moved into their modules),
every built-in tool file (no longer registers itself), `menu.ts` (tool items
from modules, by workbench), `appmenu.ts` (File items from the host; the
Workbench section), `filehost.ts` (a dropped `.js` goes to Add workbench…),
`main.ts` (the module import, the tray by workbench, the head on save and
open, the start-up load, the missing-workbench offer), `index.html` (the
question's and the offer's CSS, the organiser strip's tag). **Tests:**
`test/modules.test.ts` (10), `test/e2e/workbenches.e2e.ts` (9: mouse and
iPhone 13), the fixtures `test/fixtures/shapes-v15.neocad.json` (written by the
build before the re-cut) and `test/fixtures/workbenches/{pins,liar}.zerocad.js`.

**The module interface, as built** (`ModuleSpec` in `src/modules.ts`):

```ts
defineModule("pins", {
  label?: string,
  tools?:      { [name]: ToolCtor | { ctor, listed?: false } },   // tray order
  icons?:      { [tool]: svg },                                   // tools/icons.ts's svg()
  groups?:     { [group]: tool[] },                               // own or extend
  relations?:  { [journalOp]: { names: [short, long?], slots: ("a" | "#n")[],
                                fn(model, ...args), typed?, op?: false, dimension?: argIndex } },
  operations?: { [journalOp]: (model, ...args) => unknown },      // replayed; typed via asOperation if not built in
  replay?:     { [op]: (model) => (...args) => unknown },         // the model's own edits
  entities?:   EntityDecl[],                                      // below
  menu?:       { label, tool }[],                                 // empty-canvas menu
  files?:      { label, command }[],                              // logo menu's File section
  help?:       string[] | () => string[],
  commands?:   (kit: { model, clauses, anchor, facing }) => { [name]: fn },
});
defineWorkbench("pins", { label?: "Pins", modules: ["core", "sketch", "pins"] });
```

**The entity declaration** (`EntityKindSpec` + `EntityDecl`): `kind`,
`noun?`, `refs(e)`, `vars?(e)`, `curve?`, `closed?`, `plane?(e) → { center,
normal?, straighten? }`, `heldBy?: ops[]`, `bounds?(model, name)`; `add: { op,
fn(model, ...args) }`; `frame?(model, e) → ArcFrame` (drawn, boxed, looped,
picked by it — a frame with `rv` is a conic); `describe?(model, name, n)`;
`step?(writer, curve, name, spell)`; `samples?(model, name) → world polyline`
(a kind with no frame; drawn and picked, bounds no region, goes to no STEP).
The ellipse's: `refs [center, major]`, `vars [minor, …normal]`, curve, closed,
plane straightened against its major end, held by `onEllipse`, bounds while
`a, b > 0`, added by `addEllipse`, its frame `ellipseFrame`'s, its hover line
`el1  a 30  b 12`, its STEP `ELLIPSE`. **The grep** `grep -i ellipse
src/model.ts src/loops.ts src/faces.ts src/picking.ts src/step.ts` is empty
(held by a unit test); `src/curveplane.ts` is empty too.

**What each module registers:**

| module | tools | relations (typed names) | ops a file replays | other |
|---|---|---|---|---|
| core | point, line | dist fix onplane coin mid par perp ang on eq sym col horizontal vertical spacing measure | addPoint addLine addFrame setDefaultFrame setWorkPlane setCoords setNormal retargetLine deleteEntity deleteRelation deleteFeature, the relations, set construction | select/hand/point/line glyphs; Point, Line menu items; help: geometry, frames, relations, diagnosis, clauses, del/set |
| sketch | rectangle polygon slot circle arc ellipse fillet dimension constrain | rad oncircle conc eqrad tan arcends intersection pierce dia onellipse major minor | addCircle addArc addEllipse, the relations, fillet hole unhole | the ellipse kind; groups shapes, curves, modify; menu items; commands ellipse, polygon, slot; help: curves |
| solids | extrude revolve sketch (+ the unlisted edit dialogs) | — | extrude revolve regen | glyphs; help: features, bodies, regions |
| files | — | — | — | New, Open…, Save, Share…; help: files |
| step | — | — | — | Export STEP…; help: exportStep |
| organiser | — | — | group addTo removeFrom ungroup opengroup closegroup rename hide show | help: groups, organiser, visibility |
| interface | — | — | — | help: history, tools, workbench, modules, viewport, touch, selection, construction, inspect, authoring |

**The workbench table:** part (the default) = core, sketch, solids, files,
step, organiser, interface — 13 buttons, today's exactly; sketch = core,
sketch, files, organiser, interface — 10 buttons. A module no workbench names
is on every tray.

**Add workbench… end to end:** logo menu → Add workbench… types
`addWorkbench()` → a hidden `<input type=file>` (the Files app on an iPhone,
the dialog on a desktop; a dropped `.js` arrives the same way through
filehost.ts; `loadModule(url)` fetches) → `readManifest` reads the comment and
runs nothing → the question (`#wbconsent`) lists module, workbench, tools,
relations, operations, entity kinds and says it is not a sandbox → Add →
`loadingFile` runs the text once through the REPL; `defineModule` checks the
spec against the manifest first and refuses before registering anything →
the workbench's tray is one switch away, the scope has its names, the log says
what was added → stored in IndexedDB → at every start `WorkbenchFiles.start()`
loads each before the first picture → the menu lists it with Share… (the
stored text, through `exportFile`: the share sheet on a phone, a download on a
desktop) and Remove. A saved drawing records `modules: [{ name, hash, ops }]`;
opened without one, `fromSaved` leaves its steps out and `afterOpen` shows the
offer (`#wbmissing`).

**Deviations and additions — each a decision, vetoable:**

- **Point, line, circle, arc and frame are not declarations.** The layers
  know them by name and ask the registry for every other kind. The spec asked
  for them as declarations too; the ellipse leaving is the proof the point is
  real, and the five are what every fast path is written in.
- **The ellipse is still named outside the grep's five files** (and
  curveplane.ts): its relations, operations.ts's twin and refusals, solids.ts's
  exact B-rep, arcgeom's conic frame helper, glyphs, quiet, menu, boxselect,
  sketchface, dimensioning, persist's `values.minors`, `ls()`, a condition in
  main.ts's drawing pass. 31 files under `src/` mention it, from 37.
- **Typed operations with host wiring stay in replenv.ts** (`extrude`,
  `revolve`, `fillet`, `set`, `del`, …): the modules own their replay entries
  and vocabulary, and a module adds typed commands through `commands(kit)` —
  the sketch module's `ellipse`, `polygon` and `slot` moved there as the
  proof. A non-built-in module's operations and entity constructors are typed
  by their op.
- **An eighth module, `interface`,** holds help's sections every workbench
  shares; **files loads before step**, so the File items keep their order.
  `help()` keeps every line but orders its sections by module.
- **Tool files no longer register themselves**; a test that imported one for
  its registration now loads the built-in modules, and the menu test's
  expectation is the app's real menu (it had registered the rectangle without
  its group).
- **Found: the diagnosis never counted an ellipse's own variables**
  (`ownVars` knew a circle's by name). An ellipse whose minor nothing held read
  `0 free`; it now reads 1 in 2D and 2 in 3D, with the normal's part along the
  major axis taken as a gauge. A visible change, in its own commit.
- **The workbench is in the head, never the undo snapshot**; the organiser's
  heading names it only when it is not part; on a phone the word "organiser"
  ellipsises before the name does (found by looking: the strip wrapped).
- **`defineTool` at the command line joins no literal `user` module**: the
  tool stays outside every module and is on every tray, which is the same
  effect. `defineRelation`, `defineOperation` and `defineEntity` do join
  `user`; `defineModule` typed is its own module. Each entry is carried by a
  saved file as text under its name, as a tool's is.
- **The manifest names what it checks**: module name, tools, relations (by
  first typed name), operations, entity kinds; icons, groups, menu and help
  are not in it. A workbench the manifest names must be defined by the file.
- **Remove** takes the tools, glyphs, group members, relations, ops and
  workbench now; entity kinds, and typed names already in the live command
  line, stay until the next start.
- **A missing module**: its steps, every later step naming what they made,
  and any step that refuses while it is missing are left out. Saving before
  adding it writes the file without them (the log says so). Relation
  auto-names after a left-out relation shift, so a later `deleteRelation` by
  name can miss.
- **The source hash is FNV-1a, 64 bits** — "is this the same file", not
  security; the consent is the security.
- **No `.zip`** of several files.
- **Format 16**: a file of 15 opened and saved changes only its version.

**Verification as run.** Typecheck 0 errors throughout. Unit 1400 → 1410 (the
same 1400, plus 10 in `test/modules.test.ts`). Kernel 11. E2E: the base build 555 tests,
542 pass, 12 fail, 1 skipped; after the re-cut the identical 555 / 542 / 12 /
1, failure for failure; run alone on the base, 10 of the 12 still fail (a
finger aimed under the organiser pane on an iPhone — fixed on the base by its
relate group, 8f03383, merged here) and solidsphone's 2 pass. On 8f03383:
555 / 551 / 3 / 1. This branch merged with it: 564 / 563 / 1 / 0, the one a
touch test that passed with its file run alone (18/18). Fixtures: every
journal fixture, and `shapes-v15`, replay to the same model as under the
build before the re-cut (the same bytes but for the format's version).
Screenshots 135–143, each looked at.

Limitations left in place, deliberately:

- **Not tried on an iPhone**: the picker, IndexedDB and the share sheet are
  Chromium's emulation of one.
- A module loaded from a file runs with the command line's authority; a
  real sandbox (a Worker or an iframe) is a different feature.
