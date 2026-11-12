# Plan: there is no sketch — geometry, planes it is drawn on, and groups it belongs to

**Status: built** (2026-11-12), branch `claude/no-sketch`, PR against
`claude/resume-tasks-o7q02e`; see *As built* at the end for every decision
and deviation. The owner: *"There is no such thing as a
sketch. There are geometry groups (you can come up with a better name… reason
I don't want to use sketch is it implied exclusivity, but I want geometry to
be able to belong to multiple groups). A group is only fully defined when
every element within the group is fully defined."* Earlier: *"the default for
sketch entities is no plane. Every sketch is a 3D sketch, unless you enter into
active on-plane constraint."*

## What is true today

- The model already has no sketch. Geometry is entities in one flat registry;
  a **group** (`src/groups.ts`, `docs/plans/groups.md`) is a set that owns
  nothing, an entity may be in any number of groups, and a group never holds a
  group. A plane is only where a click lands (`drawingPlane`, `workPlane`) and
  an `onplane` relation if one is made. This is the owner's model exactly.
- **The word is everywhere the user looks.** A "sketch tool" (`src/tools/
  sketch.ts`) that picks a plane; "Sketch mode is the work plane, not a
  feature" in `help()`; "Sketch on this face" in the face's menu; a "Sketch"
  workbench; `sketchPlaneRef`, `sketchOnFaceCommand`, "sketch editing" in
  module and plan names (`sketch-edit.md`, `sketch-mode.md`, `sketch-on-face.md`,
  `sketch-relations.md`, `sketch-shapes.md`). Every one says to a person
  that there is a container called a sketch that geometry is inside, which
  the owner has now said twice is not so.
- Nothing says whether a group is defined. The status counts the whole
  drawing's freedoms (`N free`); the organiser's group row shows a count and
  an eye.

## Design

1. **The word goes from everything a person reads.** What the "sketch tool"
   does is choose **a plane to draw on**; it is the Plane tool (icon as now),
   its chip already reads `on f1` / `on e1.lid`. "Sketch on this face" →
   **"Draw on this face"**. `help()`'s "Sketch mode" → "drawing on a plane".
   The "Sketch" workbench → **"Drawing"** (or dropped: the Part bench has
   every tool). The module keeps its id `sketch` for files that name it
   (`ui({ modules })`), with the label changed; a rename of the id is a
   format change and not worth it.
2. **Code names follow where cheap**: `sketchPlaneRef` → `drawingPlaneRef`,
   `sketchOnFaceCommand` → `drawOnFaceCommand`, `sketchedit.ts` →
   `editdraw.ts` already exists for part of it. Plan files are history and
   keep their names; each gets one line at the top saying the word is
   retired and pointing here.
3. **A group's definedness is a reading, not a count of its own**: a group is
   fully defined when every member is — each member's freedoms, as
   `Model.diagnose()` already finds them per variable, are zero. The
   organiser's group row shows it (a filled dot for defined, hollow for not,
   with "3 free" on hover/tap), and a group's menu has *Select what is free*.
   No new solve, no new relation. The owner: *"Should be trivial to
   calculate this stuff but it's not a concern of mine now"* — so this is the
   last item, and it does not block the renaming.
4. **The drawing's own count stays as it is** (`N free`), including
   `gaugePlanes`' exclusion of the flat drawing's freedom to leave its plane.
   Asked on 2026-11-12 and answered "not a concern of mine now": left, and
   the question is closed in the register.

## Tests

- No user-facing string contains "sketch" (a test greps the tool names,
  summaries, how-lines, menu labels, `help()` text, status and chip text, and
  the workbench labels); the module id `sketch` is allowed and the only
  exception.
- The Plane tool, the face menu's "Draw on this face" and the chip, by mouse
  and by finger, in pictures.
- A group of a fully defined rectangle shows defined; drag one corner free
  (delete a relation) and the row shows "1 free"; *Select what is free*
  selects that point.
- Old files that saved `ui({ modules: ["sketch", …] })` or a workbench by
  name still open.

## Vetoable

- "Plane" for the tool and "Draw on this face" for the menu item (the owner
  invited a better name than "geometry group" too; "group" is kept, as it
  is already the organiser's word and the owner's own in `groups.md`).
- The "Sketch" workbench becomes "Drawing" rather than going.
- The module id `sketch` stays in files.

## As built (2026-11-12)

Pictures 525–536 in `docs/images`, by mouse and on an iPhone 13 by finger;
`test/nosketch.test.ts`, `test/organiser.test.ts`, `test/e2e/nosketch.e2e.ts`.

1. **The word is gone from everything a person reads.** The "sketch" tool is
   the **Plane** tool (`src/tools/plane.ts`, registered as `plane`, icon as
   it was): its summary *"Draw on a face or Top, Front, Right: all you draw
   stays on it"*, its how-lines ending *"Done … leaves the plane"*, its
   next-step *"click a lit face or plane to draw on it"*. The face menu's
   item is **Draw on this face**, first on the menu; the frame's is **Draw
   on this**; the chip's menu header reads *drawing on e1's top*; `help()`
   says a plane to draw on is the work plane, not a feature and not a
   container. Error messages say *profile* or *drawing* ("its profile's
   plane has collapsed"); the STEP export's wireframe set is named
   `'curves'`. A source-level test greps every string literal in `src/` for
   the word and a run-time one asks every tool name, summary and how-line,
   module and workbench label, `help()`, the face and frame menus and the
   chip's menu; the quoted module id `"sketch"` is the one exception, as
   the spec allowed.
2. **The old names still open what they did.** `arm("sketch")` is an alias
   in `TOOL_ALIASES` beside `circle3` and `arc3`: it arms the plane tool and
   the log says *armed: sketch — the plane tool, by its old name — a plane
   to draw on, arm("plane", {})*. The "Sketch" workbench is **Drawing**
   (id `drawing`); `workbench("sketch")` typed and a file whose head says
   `"workbench": "sketch"` open it, through `WORKBENCH_ALIASES`
   (`modules.ts`, read by `getWorkbench` and `setActiveWorkbench`), never
   listed and never written back: a save says `drawing`. The module keeps
   its id `sketch` with the label *"Drawing: curves, shapes, the curve
   relations and the fillet"*; `ui({ modules })` and a workbench file naming
   it are unchanged.
3. **Code names where cheap**: `sketchPlaneRef` → `drawingPlaneRef`,
   `sketchPlane` → `chosenPlane`, `sketchOnFaceCommand` →
   `drawOnFaceCommand`, `sketchFrameFor` → `facePlaneFor`,
   `holdOnSketchPlane` → `holdOnChosenPlane`, `SketchTool` → `PlaneTool`,
   `sketchface.ts` → `faceplane.ts`, `tools/sketch.ts` → `tools/plane.ts`.
   Not renamed: `sketchedit.ts`, `sketchgeom.ts`, `modules/sketch.ts` (the
   module id's file), the e2e files named for their history, and every
   comment that quotes the owner or names a plan file. The five plan files
   (`sketch-edit`, `sketch-mode`, `sketch-on-face`, `sketch-relations`,
   `sketch-shapes`) each carry one line at the top pointing here.
4. **A group's definedness is a reading of the last diagnosis.**
   `organiserSections(model, selection, free)` and `rowMenu(model, name,
   selection, free)` take `Model.diagnose()`'s `free` set (main.ts hands
   the one it draws the free ink from, so the dot and the canvas's blue
   agree). A group row wears a dot before its count (`.odef`): filled when
   no entity member is in `free`, hollow in the free ink when some are, a
   faint dotted ring before any solve has said. Its tooltip says the count
   — *1 of its 9 members can still move — Select what is free, on its menu,
   picks them* — and the row's menu has **Select what is free**, typing
   `select(<the members that move>)`, disabled with the reason when every
   member is held or before a solve. The menu's header says *fully defined*
   or *1 of 9 free* — which is also how a finger reads the count: a hold on
   the dot is the row's hold (on a phone the marker and the eye each take a
   finger's width, and the dot is what is left between them), and its
   tooltip is a hover's. A relation in a group is counted neither way; a group
   of relations alone has no reading. The see-through tree's group rows
   wear the same dot. No new solve, no new relation, no new kernel call.
5. **"N free" on the group is a count of members, not of freedoms.** The
   spec's *"3 free"* read either way; the count that is cheap and that the
   menu can act on is *how many members some motion still moves*, which is
   exactly what *Select what is free* selects, so the two cannot disagree.
   A count of a group's own degrees of freedom would need a rank with
   everything outside the group pinned — a kernel question per group per
   solve — and the owner said this is *"not a concern of mine now"*.
   Vetoable; one line in the register.
6. **The drawing's own count stays as it is**, `gaugePlanes` included (item
   4 of the design): nothing changed there.
7. **Guidance on a phone** (the package's second addition; picture 503): a
   tool's summary says `{tap}` where its how-lines do, and
   `toolSummary(name, hand)` fills it for the hand asking — the hover tip,
   the chosen tip's finger, `tools()` typed as a mouse. Every line a tool
   logs while running — a miss answered, a refusal — passes through the
   engine's `ctx.log`, which fills `{tap}` for the hand last on the canvas
   (`ToolEngine.pointing`), once, in the one place every tool's line goes.
   Headless, with a test's own ctx, the placeholder is what the tool said
   and the unit tests pin that form. A source scan refuses any literal in
   `src/tools` that says "click" on a line that does not also name the
   finger's word. **Picture 503 itself was a test artefact**: the hand was
   already seeded from the device (`engine.pointing = coarse ? "finger" :
   "mouse"`, main.ts, 2026-11-05), but that file's picture helper moves the
   *mouse* off the drawing before every screenshot, and a mouse move sets
   the hand to a mouse. Picture 531 is the same screen with no mouse: *tap
   a thing, or hold and drag to box*. On a real phone no mouse event
   arrives, so a person never saw 503's words.
8. **The empty status readout** (the third addition; pictures 515 and 521)
   **is the fade, by design.** `SOLVED` fades after `STATUS_FADE_MS` (3 s;
   `statusFade`, `src/statusline.ts` line 34) and so does the count when
   nothing agrees (`showDiagnosis`, `src/main.ts`, `line.fades`); the
   stylesheet makes a faded status `display:none` (`index.html`, the
   `#status[data-faded]` rule), text kept. Picture 510 shows SOLVED because
   *4 agreeing* keeps the count, and the picture was taken within the
   fade. Measured in `nosketch.e2e.ts`: shown as the operation lands, shown
   again at the next, text still `SOLVED` and `data-faded` set 3.6 s on.
   Nothing to fix; the test documents it.

Left, and filed under *Next up*: a group's degrees of freedom as a count
of its own; the picture helpers in `throughall.e2e.ts` and
`filletsonething.e2e.ts` moving the mouse on a phone; a headless host with
no engine reading `{tap}` raw.
