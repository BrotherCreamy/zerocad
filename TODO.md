# ZeroCAD — todo

The working list, and the project's decision register. `STATUS.md` describes
what exists; `CHANGELOG.md` is what already happened, newest first.

**How work happens here:** the owner sets direction and can veto
anything in the register below. Fable (the managing session) writes the specs
in `docs/plans/` and reviews everything; Opus (the implementing session)
builds from those specs. As of the kinematic-drag package, each work package
runs in an **isolated worktree on its own branch and arrives as a PR against
the working branch** — Fable reviews on the PR (a review comment plus merge,
or plus close; GitHub does not allow formally approving a PR opened under
your own identity), so the review record is visible on GitHub rather than
buried in a chat log. Parallel workers only ever get disjoint specs; the e2e
runner claims a private port per run so a suite can never silently test
another worktree's code. `main` stays untouched until the owner says
otherwise.

## In flight

- **Standing duty**: after every merged PR, run `npm run build:single` and
  republish `dist-single/neocad.html` to the owner's review artifact
  (same URL each time).

## Decisions made so far — veto here if any are wrong

- **Tooltips on every control, long-press on touch; frames drawn in RGB**
  (the owner, 2026-11-04: *"when I hover over tools, I should see a
  tooltip"*; *"a frame should be coloured or something so I can tell the
  orientation. use rgb colours like solidworks"*). Spec:
  [`tooltips-rgb-frames.md`](docs/plans/tooltips-rgb-frames.md).
- **Under discussion with the owner (2026-11-04), not yet decided:** "region"
  retired in favour of **Face** (a bounded piece of one surface), **Surface**
  (faces joined edge to edge) and **Solid** (a closed surface), each a typed
  object that enforces its rules, generic groups kept only for organising;
  **circles that carry their own orientation**, so no frame is made
  automatically, with one origin always present; **one circle tool and one
  arc tool**, the method read from the gesture (*"why are there multiple
  circle tools and arc tools? they all achieve the same thing. surely just one
  tool, but different ways to set constraints"*).

- **A new version is offered, not imposed: "Update ready — tap to reload"**
  beside the logo (the owner, 2026-11-04, asking whether the pages update on
  the fly). The tap autosaves, then reloads into the new version; until it,
  the open app is untouched, and the next start still updates.

- **Each device has its own 100 %, and a finger's controls are drawn small
  and hit at 44** (the owner, 2026-11-04: *"is there any way you can figure
  out what interface scale to use for each device, so everything is
  appropriately sized? (and make that 100% zoom)"*). 100 % is form factor ×
  the person's text size — 1 under a mouse, 1.3 on a phone, 1.15 on a tablet
  (a short side of 600 CSS px or more), times Dynamic Type under a finger or
  the browser's font size; only the viewer's multiplier (the spin box) is
  stored, per device, never in a file. Under a coarse pointer every control
  answers a press over at least 44 px however small it is drawn; **reach to
  pick and snap is never scaled**. Built:
  [`chrome-logo-scale.md`](docs/plans/chrome-logo-scale.md).
- **No title bar; the logo is the one panel nothing moves, and opens the app
  menu; panels dock to the very edge, reaching under an inset they touch;
  a moved pane is stored as what it rests against, so docking survives a
  rotation; the installed app's status bar is `default`** (not
  `black-translucent`, which iOS 26 blurs over). Built, with every deviation
  in the spec's *As built*:
  [`chrome-logo-scale.md`](docs/plans/chrome-logo-scale.md).

- **Select and Hand tools head the toolbar** (the owner, 2026-11-04: *"there
  is no hand/selction tool. would be nice since a lot of people are used to
  that"*). Select is the "no tool" state made visible (`arm("select")`), lit
  whenever nothing is armed; the Hand pans from anywhere with one finger or a
  left-drag; Space is a temporary hand on a desktop. **Built** — veto any:
  Select and the Hand are the engine's, not registry tools (`defineTool`
  refuses the names); pressing Select, or arming the Hand, keeps the
  selection, where Escape and `cancel()` drop it with the tool or the Hand;
  Space is an overlay on the armed tool, which never goes anywhere, and is
  skipped while any field or button has the focus; a still click under Space
  reaches no one; the Hand survives an undo; bare `select` arms Select (it
  printed the `select(...)` function); an open-hand cursor. Spec, with every
  deviation in its *As built*: [`select-hand.md`](docs/plans/select-hand.md).

- **The organisation method: the groups that exist, plus an open group, in
  an organiser pane** (the owner, 2026-11-04: *"the group view or whatever
  organisation method you decided on. There needs to be a pane for that"*,
  and earlier *"create a new group and "open" the group, which means any
  entities which get created become a part of that group"*). Groups stay
  overlapping sets that imply nothing; `opengroup`/`closegroup` is journalled
  document state; a group may be empty. Typed objects that enforce rules
  (regions, chains, solids) are the next design conversation and would arrive
  as sections of the same pane. ✅ **Built** (2026-11-04):
  [`organiser.md`](docs/plans/organiser.md), every deviation in its *As
  built*. Vetoable as built:
  - **Every entity made while a group is open joins it**, in the entry that
    made it — a tool's, a typed constructor's, an operation's (a fillet's arc,
    an extrude's twins); relations do not. One group at a time; it stays open
    through Escape and in the saved file.
  - **A regeneration's new pieces join the groups that held all the feature
    had made, never the open group** (not the spec's recommended "the groups
    the entity they twin was in", which would file a lid's new arc with the
    sketch).
  - **A group may be empty** — reversing groups.md's "a group is never
    empty": `group()` makes one, and a group whose last member goes stays
    until `ungroup`. Format version 12; a version-11 file has each silent
    emptying `ungroup` written in on the way in.
  - **The pane starts hidden on a phone** (one tick in the app menu's Panes),
    shown on a tablet and a desktop — a desktop's in the bottom-right corner.
- **The app menu is a dropdown under the logo** with an interface-size spin
  box (`− 80% +`), a show/hide row per pane, and the File items; **a pane's
  docking (to an edge, or against another pane) survives rotation** (the
  owner, 2026-11-04, verbatim: *"if I push a toolbar right to one side, or up
  against another toolbar, that setting should persist if I change from
  landscape to portrait or vice versa"*). Folded into
  [`chrome-logo-scale.md`](docs/plans/chrome-logo-scale.md).

- **No title bar; a tiny logo over the drawing opens the app menu; the
  interface has a size setting; panels dock to the very edge; files open,
  save and share on a phone and a desktop** (the owner, 2026-11-04, after
  trying 0.1.0 on his iPhone, verbatim: *"rather than say zerocad, it should
  be a tiny logo in the top left corner, that is overlaid over the viewport
  … There should be no title bar"*; *"the interface elements are huge on my
  screen. there should be a settings menu that allows the user to change the
  zoom level of the interface"*; *"Please allow it to be dragged right to the
  bottom"*; *"I want to be able to open files on my phone, share files etc.
  Should also work for desktop."*). Specs:
  [`chrome-logo-scale.md`](docs/plans/chrome-logo-scale.md),
  [`files.md`](docs/plans/files.md).

- **Files: autosave is on by default; saving on a phone is the share
  sheet; Ctrl+S and Ctrl+O are the app's** (docs/plans/files.md, built
  2026-11-04). The drawing, its name and whether it is saved are kept on the
  device (IndexedDB) after every change and restored at start; `newFile()`
  replaces it. Under a finger `saveFile()` opens the share sheet — *Save to
  Files* is the save, there being no other way for a web app on iOS to put a
  file where a person finds it — and a completed share counts as saved.
  Chrome and Edge save back into the file in place; Firefox and desktop
  Safari download. Ctrl/⌘+S types `saveFile()` and Ctrl/⌘+O `openFile()`,
  the browser's Save Page and Open File prevented, wherever the focus is.
  Open asks about unsaved changes after the file is chosen, not before the
  picker. The installed desktop app is offered for `.json` files, not only
  `.zerocad.json`. Veto any.

- **The app is ZeroCAD; NeoCAD stays the internal code name** (the owner
  named the project and its public repository `zerocad`, 2026-11-04). What a
  person sees says ZeroCAD. Identifiers, the saved-file format tag
  `"neocad-model"` and the browser-storage keys keep the old name, because
  renaming them would make saved files and saved layouts unreadable for no
  visible gain. The public repository is `BrotherCreamy/zerocad`, its history
  carried over whole with author identities rewritten to noreply addresses;
  this repository stays private as the archive it came from.

- **A region's membership is its outline plus the loops confirmed as holes,
  never re-inferred from coplanarity; click-to-pick proposes the loops inside**
  (2026-11-04; **vetoable**). The owner, verbatim: *"there should be some kind
  of relationship between the loops > region > extrude"*, then *"I don't think
  coplanarity should be used as an automatic basis for deciding which entities
  to include in a region"*; on the proposal, *"do what you think is best"*.
  As built: a feature's record is the membership; `regen` and a fillet re-find
  each recorded hole by its own members and add none; `hole("e1", "c1")` /
  `unhole("e1", "c1")` (the menu's *Add as hole to e1* / *Remove hole from
  e1*, and the *Edit e1* dialog) are the only ways in and out; a hole whose
  loop goes — deleted, or a member made construction — is filled and the
  solid stays. The creating click proposes every loop inside, and a click on
  a proposed hole takes it out. *Rejected:* live binding — the region follows
  whatever is inside the outline (CONVERSATION_LOG). Spec:
  [`docs/plans/explicit-regions.md`](docs/plans/explicit-regions.md), built.
  **Also decided here, vetoable:** flagging a recorded hole's member as
  construction **fills that hole** (journalled as the `unhole` it is), where
  construction.md had refused it — the loop has gone either way, and `del`
  of the circle does the same.
- **The finger mapping** (2026-11-04, the owner: *"it should work on a
  multi-touch device. Specifically I have an iPhone."*) — veto any row. A tap
  is a click; one finger drags what it lands on (a tool's shape, a point, an
  edge) or, on empty canvas with nothing armed, **orbits** (a pan in 2D); two
  fingers pan by their centroid and zoom about it at once (twist ignored); a
  long-press (500 ms, still) is the right-click menu, and a long-press then
  drag is the box; a tap toggles once something is selected and a tap on
  empty canvas clears; a second finger drops a one-finger gesture (a
  half-drawn shape is not built), a third drops everything until the hand is
  off. A finger down reveals quiet geometry as hover does. Undo, Redo, Delete
  and Cancel are an **action strip** (a tray, shown only under a coarse
  pointer; each button types `undo()`, `redo()`, `del(...)`, `cancel()`).
  Numbers, each a constant: tap 8 px / 350 ms, long-press 500 ms, a finger
  reaches 2.75× a mouse (a point is a 44 pt target), the lifted mark 56 px
  above the finger. **Behaviour follows each event's `pointerType`**, never a
  device guess; only the chrome's *sizes and defaults* follow `(pointer:
  coarse)`, read once at load. Cancel types `cancel()` (tool and selection
  together) rather than Escape's one step at a time, because a feature's
  picks already have ✗. Spec: [`docs/plans/touch.md`](docs/plans/touch.md).
- **Hosted on GitHub Pages as an installable PWA, from a public repository
  of its own** (the owner, 2026-11-04, verbatim: *"please make this available
  via GitHub hosting, and it should be a PWA, non-scrolling/non-zooming, to
  enable use on a multi-touch device … Specifically I have an iPhone."*). The
  owner was told two facts: GitHub Pages from a private repository needs a
  paid plan, and **a Pages site is public** whatever the repository's
  visibility. Since then, the manager's direction is that the owner's
  repository goes back to private and the site is served from a new public
  repository, `BrotherCreamy/zerocad`, at
  `https://brothercreamy.github.io/zerocad/`. **Every URL in the build is
  relative**, so the repository's name is all that sets the address.
  **Pages must be switched on once by the owner** (Settings → Pages → Deploy
  from a branch → `gh-pages`, root); nothing here can change repository
  settings. **The page never scrolls or zooms, in every build**, not only the
  hosted one. **A new version applies on the next start, never under the
  hand.** ✅ **`pwa-pages.md` built** (2026-11-04); its deviations are under
  Next up below and in the spec's *As built*.

- **Construction geometry is a per-entity flag** (the owner, 2026-11-04,
  verbatim): *"construction geometry should be a per entity flag. at least
  based on the name "construction geometry" it implies per entity"*. Geometry
  flagged construction forms no regions and is otherwise an ordinary entity.
  Drawn thin and muted, never dashed (dashes mean selection). And, after the
  spec (verbatim): *"if it is a group based inherited thing, then geometry
  could be both construction geometry and not construction geometry
  simultaneously"* — so it is **never a group property**: `construction("g1")`
  sets it on each member at that moment, and later membership changes never
  alter it (hide/show's rule). Built; spec:
  [`docs/plans/construction.md`](docs/plans/construction.md).
- **No sketch object** (2026-11-04, the owner: *"there is no such thing as a
  "sketch" per se"*): what lies on a plane is the "sketch"; every job a sketch
  container does in hierarchical CAD has a flat answer (the working plane,
  coplanarity for regions, groups for a named set, one solve, construction
  flags). The cost — everything coplanar shares one space — is answered by
  construction flags, another plane, or (held in reserve) a feature bound to
  one group's regions.
- **Generated geometry stays named, but quiet** (2026-11-03, from the owner
  asking whether every generated edge and corner should be a named entity):
  yes. A lid corner being a real point is this design's answer to the
  topological naming problem — a relation on it holds *that* point, and
  regeneration keeps its identity — and it is what lets a sketch point and a
  solid's corner be related at all. What it costs is noise, so generated
  geometry is quiet: corners and solid edges show on hover
  ([`docs/plans/quiet-geometry.md`](docs/plans/quiet-geometry.md)). Lazy
  materialisation stays for what is fully determined by named entities (a
  crossing, as regions-split does). Held in reserve, not planned: a lid point
  as a computed value of its base and the depth rather than a solved
  variable, if the entity count ever hurts.
  ✅ **`quiet-geometry.md` built** (2026-11-03). **The quiet rule**: in the
  shaded view an end of a line or arc (no centre) is not drawn, and a solid's
  whole profile members, twins and walls are left to the face layer's fine
  `SOLID_EDGE` line while it has faces on screen — each drawn again while
  hovered, lit by a hovered glyph, selected, snapped to, under an armed tool's
  cursor or dragged, a line with its ends; glyphs follow their anchors,
  dimensions always drawn; hidden and wire draw everything. **Quiet is not
  hidden**: nothing of it reaches the pick, snap, box or drag (quiet glyphs
  included — see the spec's As built). **Decided by geometric role alone**
  (the owner's *"why is a 3D corner any different from a 2D corner"*, at the
  supervisor's direction mid-build): nothing is quiet because a feature made
  it, so the spec's "a feature's own names show on hover only" was dropped.
  **Generated geometry stays named** and `ls()` shows it as a count under the
  feature's line, `members("e1")` to expand. Deviations in the spec's As
  built and below (Smaller things).
- **Flat relational direct CAD: no hierarchy** (the owner's statement of the
  project's concept, 2026-11-03, verbatim): *"the concept of this project is
  flat relational direct cad. there is no hierarchy. a sketch entity exists in
  the same logical space as a solid entity. and entities can be grouped."*
  Read as rules: nothing owns a sketch or a solid; a feature's output is
  ordinary entities beside the sketch; **a group is a named, overlapping set
  that owns nothing and never nests**; a feature name works as a read-only
  group. Design: [`docs/plans/groups.md`](docs/plans/groups.md).
  ✅ **Phase 1 built** (2026-11-03): the selection (a click with the command
  line empty selects, with text it inserts; shift, box, Escape; `sel()`/
  `select()`; violet; the menu's Group/Delete/Hide and Select g1; the Delete
  key), groups (`group`, `addTo`, `removeFrom`, `ungroup`/`del`, `members`,
  `groups`, flattening, overlap, read-only features, the cascade), and
  `hide`/`show`. Deviations in the spec's status line and under Done. Phase 2
  (rigid groups) is next and needs its own spec.

- **Effortless to pick up, then insanely powerful** (owner's direction,
  2026-10-29, verbatim in [`docs/plans/effortless.md`](docs/plans/effortless.md)):
  a tool does the obvious thing with defaults and says what it chose; a
  refusal about a click is guidance, never red; every option is visible in
  a panel *and* typeable, and the panel types the command; the pointer
  layer never needs the terminal. Every package is judged by it from here.
  First packages: `no-refusals.md`, `tool-options.md`.
  ✅ **`no-refusals.md` built** (2026-10-29): the curve tools and `circ`/`arc`/
  `fillet` typed make their plane; every click refusal is a muted `"guide"`
  line (log and header note), the tool still armed; the regions extrude,
  revolve and sketch could take are lit while armed, and revolve's candidate
  axes once it has a profile. Deviations in the spec's status line.
  ✅ **`tool-options.md` built** (2026-10-29). **Options are declared**: a
  tool class's `static options = { depth: { default: 10, unit: "length" } }`
  (`src/tools/options.ts`) is the one source — `arm` (in `ToolEngine.arm`,
  which every way of arming reaches) fills what was left out and refuses an
  unknown option, a wrong type or a value the declaration's `check` refuses,
  in one line naming the options the tool has, before cancelling anything;
  `tools()` and `help()` list them; the options panel is built from them; a
  tool defined at the command line with a `static options` gets all of it.
  **Remembered values are viewer state**: the last value a tool was armed
  with is its next default, in `localStorage` under `neocad.toolOptions.v1`,
  every touch wrapped — never in the journal, a file or the undo history.
  **The options panel types**: an ordinary panel (movable, pushing, fixed
  grab, no grips, sized by its rows), beside the tray while a tool with
  options is armed, a field edit typing `arm("extrude", {depth: 25})`
  through `submit`. Deviations in the spec's status line and Done.

- **Features are pick → preview → confirm** (owner, 2026-11-02: *"extrude and
  other tools should work like they do in other cad software. just click on
  the region or select the loop and hit the tickbox or enter or something"*;
  [`docs/plans/feature-dialog.md`](docs/plans/feature-dialog.md), built). A
  feature tool (`FeatureTool`, `src/tools/feature.ts`) never builds on the
  click that picks: clicks toggle regions in (several), revolve then takes an
  axis, fillet two lines or a corner's point; the result is previewed as it
  will be built and follows the options panel as it is typed; **✓, Enter, or a
  second click on the last pick** confirms, as **one undo step** for the whole
  selection, the planes it needed included; **✗ or Escape** drops the picks
  and keeps the tool (a second Escape releases it). **A confirm is typed** —
  per region the shortest call that names it (`regionNaming`), through
  `submit` — so the journal holds what the typed calls hold; the typed
  commands themselves still build at once. **The preview is the commit on a
  copy** (`src/featurepreview.ts`): never a second account of the geometry.
  **Preselection**: with nothing armed a click inside a region selects it
  (shift adds or drops, empty canvas or Escape clears), and arming extrude,
  revolve or sketch starts from it — sketch sketching on it at once. A click on
  an entity, a drag, and the right button are unchanged. **The quick path**:
  click, click. Re-arming the armed tool (the panel's field typing `arm`)
  keeps its picks.

The guiding rule, set by the owner: **tools work like Onshape/SolidWorks, so
people arrive already knowing how to use them.** Deviations from that rule
are flagged as such.

- **3D — one constraint model, extrude and revolve** (owner's direction,
  2026-10-12; roadmap: [`docs/plans/3d-roadmap.md`](docs/plans/3d-roadmap.md)).
  Two forks the owner decided up front: **one `Model(3)`** rather than
  Onshape's sketch/part split — a "sketch" is coplanar geometry, and the
  purest continuation of the N-D kernel and dimension-generic relations —
  and **extrude profiles are auto-detected closed loops**. What follows
  from one-model, recorded here before any code: 3D frames (origin, x-ref,
  y-ref) are the sketch planes, closing the register's fix-above-2D gauge
  seam; the camera is orthographic with ray→working-plane pointing;
  extrude expands into real entities plus per-point offset relations with
  a `d`-named depth, so `set()` drives solids; revolve renders its sweep
  parametrically from a live, constrainable section. ⚠ *Mouse map changes
  in 3D (Onshape's):* right-DRAG orbits; middle pans; right-release keeps
  the menu. Phases and the rest of the design in the roadmap; phase 1
  (3D frames + fix/onPlane + camera + app on Model(3)) is built, both halves:
  [`docs/plans/3d-phase1.md`](docs/plans/3d-phase1.md). Phase 2 (planar
  discipline), phase 3 (loops), phase 4 (extrude) and phase 5 (revolve) are
  built too — see below. That is the whole roadmap, and the owner's original
  ask ("extrude, revolve etc") closed.
  ✅ **Phase 1, half 1 (model + relations) built.** 3D frames carry a
  y-ref; `frameBasis` straightens it (Gram–Schmidt) and takes +z = +x × +y;
  `fix` pins `[x, y, z]` in a frame and its frameless form is gone;
  `onPlane(p, frame?)`; `"f1.z"` and `zaxis()`. (At the time the app still
  ran `Model(2)`; half 2, below, moved it.)

  Decided while building half 1, and open to veto:

  - ⚠ **Format version 5 was taken by half 1, not half 2** (the spec put
    the bump in half 2). `addFrame`'s name moved from third to fourth
    argument so the y-ref sits with the other points, name last as on every
    constructor — and a v4-only build would read the new entry as an
    auto-named frame and lose an explicit name, which is exactly the kind of
    break `persist.ts` says the version is for. Older files translate
    (keyed on the version, not on arity). *Consequence for half 2:* its
    bump is 6, and its 2D→3D lift should key on the file's `dim` field —
    v4 *and* v5 files are 2D.
  - **No `fix` outside 2D and 3D.** The gauge form went in every dimension,
    not only 3D: a 1D or 4D model has no frames (two directions leave a
    rotation free again above 3D) and now says so, rather than keeping one
    corner of the vocabulary where the kernel's axes still show. Nothing in
    the app or the suite used such a model.
  - **Degenerate frames floor axis by axis**, not all at once: a y-ref on
    the origin or on the frame's own x axis floors +y and +z but keeps +x,
    which is still well defined; an x-ref on the origin floors +x and +z and
    leaves +y as the y-ref's raw direction. The 2D floor is the special case
    where +y is derived from +x and so goes with it.
  - **Auto seeds pick a clear axis.** With two of a 3D frame's three points
    given, "offset the missing one along the next kernel axis" can land on
    the line the given two already make; the seed instead goes along the
    first kernel axis not parallel to the arm already there.
  - **A 2D model refuses a y-ref, and `"f1.z"`, rather than ignoring them.**
    `zaxis()` refuses on the spot in 2D instead of handing back a string
    the next relation would refuse.
  - *Deferred to half 2:* `onPlane`'s glyph symbol (it would draw the
    fallback `o`, and only in a 3D drawing the app cannot yet show — a mark
    is chosen by looking at it), and line-tool axis inference in 3D (needs
    the camera's projection). ✅ *Both done in half 2:* the mark is `▱`, and
    the line tool infers against a 3D frame's axes in its plane.

  ✅ **Phase 1, half 2 (camera + app) built.** The app runs `Model(3)`, always.
  An orthographic camera (`view.ts`) starts square-on — the 2D transform
  exactly — and turns with a right-drag; a click lands on the **working plane**
  (`workplane.ts`: the default frame's plane, else the plane facing the viewer
  through the orbit target); everything is drawn through the projection and
  painter's-sorted; frames draw a three-arrow triad; 2D files open lifted at
  format version 6. `orbit(yaw, pitch)` and `lookAt(frame?)` are view
  commands. Screenshots 49–53; the story is `test/e2e/camera.e2e.ts`.

  Decided while building half 2, and open to veto:

  - ⚠ **The camera stores its screen axes, not azimuth/elevation** (the spec
    said "target, azimuth, elevation, scale"). Two angles cannot put a tilted
    frame square-on with its +x right — `lookAt` needs a roll — and an orbit
    about the kernel's z would make the gauge's z the drawing's "up". So the
    orbit is a **trackball** about the screen's own axes (Onshape's feel), and
    `orbit(yaw, pitch)` is **relative**, like `pan`/`zoom` and the mouse,
    rather than setting absolute angles measured from axes nobody chose.
  - **The orbit target is screen-anchored**: panning and zooming carry it so it
    stays on its pixel, so an orbit is always about the middle of the window.
    `lookAt(f)` makes the frame's origin the target, keeping its pixel.
  - ⚠ **The tools needed edits** — the spec hoped not. Rectangle, circle,
    circle3, arc and arc3 refused 3D outright; each now lays its shape out in
    the working plane (`PointerInfo.plane`, new, says which). A rectangle on a
    default frame is laid out along **the frame's** axes, where in the 2D app it
    followed the screen's — the same thing until a frame is turned in its own
    plane. `RenderContext` gained `scale`, so a circle preview can be the
    silhouette the commit will draw. `fillet` became dimension-generic, or
    every lifted 2D file with a fillet would have failed to open.
  - **`onPlane` inference is minimal**, as the spec asked: `placePoint` adds it
    only where the snap leaves the point free (none, or a curve) and only when
    the point is on the plane; a vertex, midpoint or crossing snap already pins
    it. A tool's unclicked points (a rectangle's derived corners, a 3-point
    centre) get it too, or a rectangle could fold about its own diagonal.
    Every sketch point therefore wears a `▱`, which looked acceptable in the
    screenshots; a per-kind glyph switch is the remedy if it is not.
  - ⚠ **An arc sweeps about its plane's normal on the kernel's +z side** (then
    +y, then +x). An arc names three points and no plane, so something has to
    say which side is counter-clockwise; this rule keeps every 2D and lifted
    arc exactly what it was. It is the gauge showing through — in rendering and
    picking only, never in a residual — and an arc whose plane is turned through
    the vertical draws as its complement. Tools and `fillet` store endpoints in
    the order that makes the drawn arc the one aimed at. Phase 2 retires it.
    ✅ *Closed by phase 2:* an arc turns about its frame's +z; the kernel rule
    survives only in the v6 translation.
  - **Circles are drawn as their silhouette** (the spec's choice): to every
    relation a circle is still a sphere, so on a plane seen obliquely it does
    not foreshorten, and it offers intersection snaps only square-on. The
    phase-2 seam, visible in screenshot 50 on purpose. ✅ *Closed by phase 2:*
    a circle lies in its frame's plane and is drawn and hit as its ellipse
    (screenshot 55).
  - **While sketching on a plane, snaps offer only places on it.** Found in the
    poster screenshot: square-on, a wall's corner snapped to a floor corner
    seventy units behind the pixel. Snapping to off-plane geometry and
    constraining its projection (Onshape's way) needs a relation this model
    lacks — phase 2's to decide. ✅ *Decided in phase 2:* an off-plane point is
    offered at its projection as a position aid that **infers nothing** — the
    relation is still missing, and a constraint to a projected ghost would be a
    lie. The on-sketch-only rule stands for everything else.
  - **A 2D coordinate in the 3D app means z = 0**: `pt(40, 30)` seeds at the
    kernel's z = 0 (a seed, the gauge every 2D drawing lived in), and
    `fix(p, [x, y])` is on the frame's plane, journalled lifted. The same rule
    the file lift uses.
  - ⚠ **Format version 6** although nothing in a v6 journal would be
    *misparsed* by a v5 build: such a build would open a 3D drawing as its
    flattened shadow with every tool refusing it — misread, which is the break
    the version is for. The lift is keyed on `dim`, never the version.
  - **A lifted frame's y-ref is named after its frame** (`base_y`, or the first
    free variant), because a y-ref auto-named mid-replay takes a name a later
    entry of the file holds, and the next step fails. It is placed from the
    *saved* coordinates, a quarter turn from the x-ref, so a frame the drawing
    had turned keeps its +y.
  - *Found, not fixed (phase 2):* `pt(x, y)` seeds at the kernel's z = 0 even
    with a tilted default frame (`pt()` with no arguments lands on it);
    `frame()` typed in a turned view seeds along the kernel's axes; the painter's
    sort is one depth per entity, so a long edge crossing a short one can sort
    the wrong way where they cross (nothing is opaque yet); a lifted file's
    points carry no `onPlane` (the file never said so), so dragging one in a
    turned view moves it parallel to the working plane, which is z = 0 anyway.
    (↻ Phase 2 closed the `frame()` one; the other three stand — see below.)

  ✅ **Phase 2 (planar discipline) built** (2026-10-12):
  [`docs/plans/3d-phase2.md`](docs/plans/3d-phase2.md). A 3D circle or arc
  names a frame — resolved like `fix`'s, refused in 2D — whose orientation its
  rim takes, through its own centre; `onCircle`/`tangent` are the planar rim in
  3D (a second block each, never emitted in 2D); arcs turn about their frame's
  +z; planar circles draw and hit as ellipses; an off-plane point snaps at its
  projection and infers nothing; `plane()`; "Sketch on this"; format version 7.
  Screenshots 54–58; the story is `test/e2e/planar.e2e.ts`.

  Decided while building phase 2, and open to veto:

  - ⚠ **A 3D circle needs a frame to exist, and the tools say so** (the spec's
    semantic change, carried through): in 3D with no default frame, the circle,
    3-point circle, arc and 3-point arc tools refuse their first click out loud
    and place nothing, and **the empty-canvas menu shows them — and Fillet —
    disabled, with the model's standing message** (Fix's precedent; the spec
    did not ask for the menu half). A fresh app therefore draws no circle until
    a frame exists — `plane()`, or the menu's Frame item.
  - **The plane pins nothing**, as the spec recommended: the rim is through the
    circle's own centre, parallel to the frame; a tool's `onPlane` holds a
    drawn centre on the sketch, as before.
  - **`tangent` in 3D holds both line ends on the rim's plane**, not only the
    contact: a tangent line lies in its circle's plane. `rad`, `conc` and
    `eqrad` do not read the plane (they are not claims about the rim).
  - **An arc is drawn in the plane through its centre and ends**, oriented by
    the frame's +z — not projected onto the frame-parallel plane. The two agree
    whenever `arcends` holds; the chosen one draws what the model has mid-solve.
  - **`fillet` takes a plane** (`fillet(l1, l2, r, plane?)`, the default in 3D,
    journalled) and refuses a corner out of that frame's orientation by name,
    rather than choosing a frame by nearest normal — one resolution rule for
    every new call. (Nearest normal is the *translation's* rule for old files.)
  - ⚠ **The v6 translation makes frames where none fits.** "Nearest-normal
    against the file's frames" has nothing to match in a file with no frame at
    all, which any 2D drawing may be. Refusing those files, or keeping a
    planeless legacy circle in 3D, were the alternatives; instead the
    translation adds a visible, ordinary frame named `plane` (never a name the
    file uses) in the curve's plane on its centre — the lift's y-ref discipline
    one size up. Also decided: arcs match by their **saved** geometry (a
    three-point arc's centre is a seed at the origin during replay), frames the
    file deletes are no candidates, ties go to the default then the earliest,
    and an arc v6 drew the other way round has its ends swapped. A v6 circle
    has no normal to match and takes the default at its step — a guess, said so.
  - **The projected snap ranks below every on-sketch point, crossing and
    midpoint, above a bare curve**, projects along the plane's normal (not the
    line of sight), and is drawn as a **dashed** hollow square with a leader
    back to its source — the existing point marker was already hollow, so
    hollow alone would not have been distinct. Points only.
  - **`plane()` sets the default** (the spec's recommendation): starting a
    sketch is what it is for. It and a bare `frame()` seed facing the viewer in
    a turned view (closing a phase-1 seam); an unturned view journals exactly
    what it always did.
  - **The hover tag and `ls()` name a circle's plane** (`c1  r 10  in f1`):
    nothing on screen says which frame a square-on circle is parallel to.
  - **Found and fixed: a refused operation used to stay in the journal.**
    `asOperation` recorded before its body, so a fillet refused for its radius
    (since fillets existed) left an entry that failed the saved file on reopen.
    It records after success now.
  - *Found, not fixed:* the last click's **snap marker lingers** after a tool
    finishes on that click, until the next redraw (the solve's render happens
    before `finish()` clears it) — cosmetic, older than this package, visible
    in a screenshot taken without moving the mouse. A v6 bare `arc()` with
    auto-created ends cannot have them swapped by the translation, so on a
    frame facing the kernel's −z it opens as its complement. Projecting
    *curves* into the sketch, and on-plane inference beyond phase 1's minimal
    one, are not done. `pt(x, y)` with a tilted default frame, the per-entity
    painter's sort and the lifted points' missing `onPlane` stand as above.

  ✅ **Phase 3 (loops) built** (2026-10-13):
  [`docs/plans/3d-phase3-loops.md`](docs/plans/3d-phase3-loops.md).
  `src/loops.ts`, pure: `findLoops(model)` — every closed loop of lines and
  arcs in one plane, and every whole circle, as minimal cycles with their plane,
  members (counter-clockwise, with directions and end points), signed area and
  containment (`parent`/`children`) — and `loopAt(model, view, sx, sy)`, the
  click-inside test. `loops()` lists them, read-only. No click behaviour
  changed and nothing is drawn: phase 4's extrude is the first consumer. The
  story is `test/e2e/loops.e2e.ts`.

  Decided while building phase 3, and open to veto:

  - **Joined means held, never near** (the spec's rule, recorded here as the
    register entry it asked for). Two curve ends are joined only when they are
    the same point entity or a `coin` holds them together, directly or through
    a chain. Ends that merely sit on the same spot are not joined.
    **Rewritten 2026-10-21 (regions split, PR 1) — a crossing and a T now
    split regions, as Onshape's do, and the sentence above still holds.** A
    **T** is held: an end held on an edge by `on`, `oncircle` or the line
    form of `mid` cuts the edge there, the point's joined class the vertex. A
    **crossing** joins nothing — no class changes, and a feature that needs
    it held will *materialise* it as a point held `on` both edges (PR 2) —
    but the regions of a drawing are a question asked of its geometry as it
    stands, as `loopAt` always was, so two coplanar edges crossing in their
    interiors are cut at a *virtual vertex* (`l1×l5`) for finding regions. A
    line drawn across a rectangle now cuts it in two. The ⚠ is gone: this was
    the loop policy's one deviation from Onshape. **Since PR 2 (2026-10-22)
    `extrude` and `revolve` build a split region**, and that is where a
    crossing finally becomes *held*: the feature materialises each crossing
    its profile runs through as a point held `on` the edges there, so "joined
    means held" is kept by the feature rather than bent by the finder. See
    [`docs/plans/regions-split.md`](docs/plans/regions-split.md).
  - ~~**A component whose joined edges cross reports no loops.**~~ *Retired
    with the above (2026-10-21).* Cut at every crossing, no two pieces cross,
    so the faces are the regions the drawing shows: the lopsided bow-tie this
    rule existed for is its two lobes (50 and 450), and two rectangles that
    overlap, joined nowhere, are three regions side by side.
  - **Minimal cycles are faces**, not a shortest-cycle basis: each vertex
    orders its edges by tangent, then curvature (an arc leaving tangent to
    another), then a mirrored index offset (the same line drawn twice), and the
    bounded faces are walked counter-clockwise. A face that revisits a vertex —
    an island touching its outline at a point — is split there, so both loops
    are reported. Bridges and dangling lines are dropped before anything else.
  - **Containment touching at a point counts; sharing an edge cannot** (faces
    sharing an edge are side by side). `parent` is the *smallest* coplanar
    container, indexing the array `findLoops` returned.
  - ⚠ **Arcs are exact in the inside test, not sampled** (the spec said
    "arcs sampled, the curveplane machinery"). An arc's winding about a point
    has a closed form, so `loopAt` and containment share one test with no
    resolution to choose. Arcs are still *laid out* by `curveFrame`, and the
    one sampled measure — how thick a loop looks on screen — uses
    `arcSegments`, as drawing does.
  - **`loopAt`: innermost, then nearest, then smaller area, then earlier.**
    Containment outranks depth: coplanar loops tie on depth exactly, and a
    container a hair nearer (noise) still loses to the loop it holds — tested
    apart from the area tie-break it otherwise coincides with. A loop under
    `EDGE_ON_PX` (one pixel) thick on screen is edge-on and skipped. It takes
    an optional fifth argument, the loops already found, so a caller holding
    them gets one of *those* back and its indices mean something.
  - **A loop's plane:** a frame's whose plane it is (default first, then
    earliest) — origin, +x, +y, +z; else the first arc's or circle's frame
    orientation through its centre; else the normal whose largest component is
    positive, +u along the first line. A 2D drawing names its default frame
    (or the earliest). Members are listed counter-clockwise about that normal
    from the earliest-made one, so `area` is positive as listed.
  - **Coplanar means `liesOn`'s millionth, and an arc's frame must agree**
    (+z parallel either way up, sine ≤ 1e-6 — fillet's `IN_PLANE_SINE`). An
    arc whose points lie in a plane its frame does not is not in that plane.
  - **`loops()` names a loop by its members** (`loop of l1,a1,l2,l3,l4 in f1,
    area 1186.265`, then `, inside …` for an island) — it has no name of its
    own, and claiming one would make a question into an entity. A plane with no
    frame reads `in the plane facing (0, 0, 1)`.
  - *Found, not fixed:* **face-on snapping offers an arc's whole circle**, as
    `snapping.ts` documents — so in the e2e a circle's radius dragged out near
    a fillet arc's *unseen* continuation snapped to it and became 8.86 instead
    of 9, with nothing visible there. Seen obliquely, only the drawn arc snaps;
    the two disagree. Worth deciding before phase 4 makes arcs common. Also:
    `loops()` is silent about near-misses (an end not quite joined, a corner
    not quite in plane), and regions from crossings — Onshape's behaviour —
    would need joins this model is never told about; both are left for a spec.
    *(2026-10-21: regions from crossings are built without joins — a crossing
    is a virtual vertex for finding regions only; see the rewritten entry
    above. Near-misses are still silent.)*

  ✅ **Phase 4 (extrude), half 1 — the expansion, the record, deletion, the
  file — built** (2026-10-13): [`docs/plans/3d-phase4-extrude.md`](docs/plans/3d-phase4-extrude.md).
  `extrude(member, depth?, frame?)` expands the loop the member is in into
  twins, twin members, corner walls, a lid frame and **one `extrusion`
  dimension** (`set` moves the lid); a feature record `e1` lists in `ls()`,
  tags its pieces' hover, and deletes with `del`. Half 2 (faces, the per-face
  painter's, the click-inside tool) is next. The story so far is
  `test/e2e/extrude.e2e.ts`; screenshot 59.

  Decided while building half 1, and open to veto:

  - ⚠ **The journal carries the profile resolved**, not only the call as
    typed: `extrude("l1", 20, "f1", [["l1","a1",…],["c1"]])`. The spec said
    journal-as-the-call; this is that call with what it resolved written in,
    `fix`/`fillet`'s rule for the default frame — because replay runs on
    seeds, and a profile made of free `ln()`s and relations has *no loop at
    all* at its seeds (measured, and pinned by a test). A re-found profile
    would fail that file and every undo after it. Given loops, a replay only
    walks them by their joins. The user types two arguments; the tool hands
    over the loop under the click the same way. *(2026-10-22, regions split
    PR 2: a member may be `{name, from, to}`, the part of an entity between two
    real points, in its own direction; the points the expansion materialised
    at crossings are named, and a replay makes them again under those names.
    Format version 8.)*
  - ⚠ **Deleting a piece of a feature takes its record and nothing more** —
    a profile edge, a wall, a lid corner, the depth itself. The spec's words
    ("takes the feature record with it"), read the way a relation is read: the
    record needs its pieces, the pieces do not need the record, so they stay as
    ordinary geometry and the faces go. Taking the whole solid instead was
    considered (deleting one wall would remove every other wall with it, which
    no relation does to its arguments). `del("e1")` is how a solid goes; it
    never takes the profile. The primitives refuse to delete what a record
    still names. A second extrude on the first's lid loses its record with the
    first (its profile was the lid) and its walls (they stand on the lid's
    corners), and keeps its own lid.
  - **Twins per joined class**, by loops.ts's own definition: corners joined by
    `coin` (as the line tool joins them) get one twin and one wall, so the lid's
    corners are shared points and **the top cap is itself a loop** (with the
    profile's area; parallel to the sketch frame, and in no frame's plane since
    an extrude makes no lid frame) — extrudable again, by `frame` or by click.
  - **The depth holds radii too**: one residual per curve pair, `r_twin −
    r_base`, in the same `extrusion`, so a twin circle (which has no ends to be
    held by) keeps its base's size and `set` touches one relation. An addition
    to the spec's "three components per pair", not a change to it.
  - **The sketch frame is a datum to the depth**: its +z, and any pair whose
    base is one of its points (an old file's lid frame's), are read as plain numbers. The
    profile's points are variables — so the lid can push the base, which is the
    point (the negotiation demo is a unit test).
  - **A twin curve keeps its base's frame — the sketch frame's, for a curve
    on the sketch** (replaced 2026-11-03; it said "a curve on the sketch frame
    twins onto the lid frame"). A curve's frame is an orientation, not a place,
    and an extrude translates without turning, so the same frame gives the same
    arc with no side to decide. Choosing by name rather than by which way a
    frame faces is still what keeps a replay on seeds from deciding it
    differently.
  - **An extrude makes no lid frame** (replaced 2026-11-03, twice: it said "the
    lid frame always has its own three points", then "a frame a feature makes
    reuses the points the feature already makes there"). The owner, on doubled
    point labels: *"i'm getting a lot of overlapping points. why is this
    happening?"* Sharing the lid's corners fixed a plate, but not two rectangles
    extruded at once: they share the first one's sketch frame, so the second
    lid frame laid three points on the *first* lid's corners. The lid frame
    was made "so a sketch on the cap has a plane", which sketch-on-face builds
    from the cap itself, and nothing else needed it; it was a derived datum on
    every solid, and fewer made datums is the flat model's direction. A circle's
    top, which has no three points of its own, gets a sketch plane made through
    its centre and held on its rim. **A partial revolve keeps its end frames**
    (its end face is turned, and its curves need a turned orientation), each
    standing on the end face's corners where its frame stands on the profile's.
    Format 11; files of 10 and below keep their old expansion (see the queue
    entry "An extrude makes no lid frame").
  - **No format bump** (version stays 7): two new ops, no changed meaning; an
    older build refuses a newer file at the step, by op name — the deletion
    ops' precedent. *(Version 8 came with regions split PR 2, 2026-10-22, when
    `extrude`'s and `revolve`'s profile argument did change shape.)*
  - **`frame` narrows the loop**: after an extrude every profile edge is also a
    wall face's edge, so a bare member is ambiguous; `extrude(m, d, "f2")` takes
    the loop parallel to that frame. A loop in no frame's orientation is refused
    (an extrude reads its direction off a frame; inventing one would be a datum
    nobody chose). A negative depth extrudes the other way; zero is refused.
    **↻ Revisited 2026-10-29** ([`extrude-makes-its-plane.md`](docs/plans/extrude-makes-its-plane.md)):
    the owner's first run was this refusal, eight times. A frame of three of
    the loop's *own* points is no invented datum — it is the sketch's plane,
    what "Sketch on this face" makes — so the layer above the operation makes
    it, as its own journalled call before the `extrude` entry: the tools type
    `plane(a, b, c, { look: false })` (or `frame(a, b, c)` beside a default),
    the typed `extrude`/`revolve` make the same model calls. The operation's
    refusal stays, as the guard.
  - *Found, not fixed:* **`fillet` leaves its tangent point and centre off the
    sketch's `onPlane`** — held only on the rim's plane, so a rounded corner can
    slide along +z as a whole; a `set` stirs it by a few millionths. And a
    tool-drawn sketch is undimensioned, so any solve may wander within its
    freedom (1e-5 seen during a `set`). Tests that claim "nothing else moves"
    use a fully defined sketch. *(2026-10-22, feature regeneration: a feature
    is no longer expanded once.* **A feature's expansion is a function of its
    profile, and follows it** — a fillet on a profile corner regenerates the lid,
    keeping every twin and wall whose corner survives, and `regen("e1")` does it
    for a profile changed by hand. See the queue entry below.)

  ✅ **Phase 4, half 2 — faces, the per-face painter's, the click-inside tool —
  built** (2026-10-13). `src/faces.ts` reads a solid's faces off its live
  geometry each frame (even-odd caps, a wall quad per line and a strip per
  curve), culls back faces, sorts per face and shades by a headlight; `main.ts`
  fills them before the entities. `arm("extrude", { depth })` outlines the
  region under the cursor and extrudes it on a click (`ToolContext.regionAt`,
  new). Screenshots 60–63; the story is `test/e2e/extrude.e2e.ts`.
  *(2026-10-22, display depth: faces are drawn by WebGL with a depth test, the
  sort below kept only as the fallback where there is no WebGL — see the depth
  rule after phase 5.)*

  Decided while building half 2, and open to veto:

  - ~~A cap sorts by its nearest point, a wall by its centroid~~ —
    **replaced by the depth rule** (2026-10-22, below). The grazing lid it
    fixed is drawn right by the depth layer (`test/e2e/depth.e2e.ts`); the
    painter's fallback sorts every face by its centroid again and is held to
    getting that lid wrong.
  - **Back faces are culled** (not in the spec): outward normals are computed
    from each loop's winding and nesting, so a convex solid can never sort
    wrong and a non-convex one has far fewer faces to sort.
  - **Curved walls are one face per drawn segment**, so a cylinder shades round
    rather than as one flat slab; each face is stroked a hair wide in its own
    colour, or anti-aliasing leaves a seam of background between neighbours
    (measured: 1–3 levels out of ~60 with the stroke, background without).
  - **Faces sit behind every entity, hidden edges included** — the spec's
    order, so the sketch stays legible. *(2026-10-22, hidden edges: the part
    of an edge behind a face is drawn in a dimmed ink — the hidden-edge rule
    after the depth rule below — so the profile no longer reads through a
    solid as if in front of it. 2026-11-02, opaque solids: shaded, the part
    behind a face is not drawn at all, and not aimable; the dimmed look is
    `view("hidden")`.)*
  - **`Tool.snaps`** (new, default true): the extrude tool opts out, since a
    snap marker would promise a vertex the click does not go to. Idle clicks
    are unchanged — the click-inside behaviour lives in the tool only.
  - **`ToolContext.regionAt(screen)`** (new, beside `pick`): the engine answers
    "which region is under this pixel" with `findLoops` + `loopAt`, so a tool
    never needs the camera.
  - *Found, not fixed:* ~~interpenetrating solids can sort wrong where they
    cross~~ — **fixed by the depth rule** (2026-10-22, below; measured wrong in
    39 of 40 views before); a face is not a pick target, so a solid's side face is
    extruded by clicking inside its loop — and a wall's loop lies in no frame's
    orientation, so that is refused until a frame is made on it. *(2026-10-29:
    no longer refused — the tool makes the frame on the wall's own points first,
    +z out of the solid; see the Done entry "Extrude on a frameless sketch".)*

  ✅ **Phase 5 (revolve) — built** (2026-10-13), one PR in two reviewable
  commits (model half, then display and tool):
  [`docs/plans/3d-phase5-revolve.md`](docs/plans/3d-phase5-revolve.md).
  `revolve(member, axis, angle?, frame?)` turns the loop a member is in about a
  frame axis or a line in its plane; the surface is drawn from the live profile
  (`faces.ts`), the angle is one `revolution` dimension, and a partial turn has
  a real end face held by it. `arm("revolve", { angle })`: click inside a
  region, then on a line or a frame marker's arm. Screenshots 64–67; the story
  is `test/e2e/revolve.e2e.ts`.

  Decided while building it, and open to veto:

  - ⚠ **A full revolve's angle cannot be `set` partial, nor a partial one to a
    whole turn** — both refuse, in the relation, with the old value standing.
    The spec's recommendation, taken: a full turn has no end face to swing, and
    growing twins inside `set` would be an operation pretending to be a
    dimension edit. Full-to-partial is `del` and a new revolve. A full
    revolve's dimension therefore holds **no blocks** — a label, `360°`.
  - ~~A cap is lowered under any overlapping wall of its own in front of its
    plane~~ — **replaced by the depth rule** (2026-10-22, below): the rule and
    its code are deleted, and the 321° views it was pinned on are a picture
    test the depth layer passes (`test/e2e/depth.e2e.ts`).
  - **The relation's pairs can be two frames** (the end frame held at the
    sketch frame turned), which also says which bases are a datum — the axis's
    own points and a twinned frame's — without a second list. Both datum rules
    are pinned by tests that fail when the rule is removed.
  - **A profile curve on a frame other than the sketch's gets that frame turned
    too** (extrude keeps it: a translated frame keeps its orientation, a turned
    one does not). Chosen by name, never by which way a frame faces, so a
    replay decides the same.
  - **The geometric refusals are the call's and the tool's, never a replay's**:
    given loops (the journal's form) nothing reads positions. A profile seeded
    across its own axis and fixed off it reopens; the test shows the re-asked
    check would have failed the file. A typed call that hands over loops skips
    them too — that form is the journal's, and never needs typing.
  - **Every joined class gets a twin, on the axis or not** — an on-axis corner's
    twin sits on it. Sharing it would need "is this on the axis", a position.
  - **`featureOf(name, kind?)`** — a typed lookup that names the other kind when
    it is wrong; `FeatureEntry` is a union now.
  - **`Pick.axis`** (new): which arm of a frame's marker a pick hit, so a tool
    choosing an axis gets `"f1.y"` from a click. Optional; nothing else reads it.
  - **The tool re-chooses on a click inside another region** at its second
    step, rather than refusing — the profile was the thing the user changed
    their mind about.
  - *Found, not fixed:* ~~a sweep within a few degrees of a whole turn can
    leave a wall over its cap — a true painter's limit~~ — **fixed by the
    depth rule** (2026-10-22, below; measured wrong in 13 of 40 views of a 355°
    revolve before). Deleting a piece of a
    full revolve takes its record and leaves its `360°` dimension holding
    nothing (the uniform record-only rule). The swept surface never picks;
    there are no seam edges drawn along it, so a revolve's silhouette comes
    from its shading alone. A revolve, like an extrude, follows its profile:
    a fillet on it rounds a partial turn's end face, and a whole turn's record
    *(2026-10-22, feature regeneration — it was expanded once)*.

  ✅ **The depth rule — built** (2026-10-22):
  [`docs/plans/display-depth.md`](docs/plans/display-depth.md). **Which face
  is in front is answered per pixel by a depth buffer**: `src/facelayer.ts`
  draws `faces.ts`'s faces by WebGL on `#faces`, a canvas under the 2D drawing,
  through the view's orthographic projection (`clipMatrix`), caps even-odd by
  the stencil method, the same flat headlight shades. Interpenetrating solids,
  a sweep wrapping round in front of its own cap and a lid past its hole's far
  wall are all simply right; there is no sort and no cap rule. **The painter's
  stays as the one fallback**, chosen only where `getContext("webgl")` gives
  nothing, sorting by centroid — wrong where any sort is, and a test says so.
  Faces still never pick, snap, box or wear a glyph (the faces canvas takes no
  pointer events), and the drawing stays over the solid — its hidden parts
  dimmed since (the next entry).
  Screenshots 81–84; the story is `test/e2e/depth.e2e.ts`, the numbers
  `npm run measure:depth`.

  ✅ **Hidden edges, dimmed — built** (2026-10-22):
  [`docs/plans/hidden-edges.md`](docs/plans/hidden-edges.md). ~~**The drawing
  stays on top of the solid, and what a hand aims at is never behind a face;
  the part of an edge behind a face is drawn in a dimmed ink.**~~ **Replaced
  by the opaque rule** (2026-11-02, the next entry): this is now what
  `view("hidden")` draws, not the default. As built then: every edge,
  point, name and glyph still draws over the faces and picks, snaps and drags
  exactly as before; only the ink of an edge's hidden runs changes. Points,
  names, a frame's letters and glyphs are never dimmed; a frame's arms are
  edges and dim. Which part is hidden is asked of the faces on the CPU
  (`src/occlusion.ts` — the same module the e2e oracle grades the depth layer
  with): a sample is hidden when a visible face covers its pixel and it is
  more than half a pixel behind that face's plane, **measured square to the
  plane**, not along the ray, so a face seen nearly edge-on never hides its own
  boundary. Samples at least every 4 px, seams half-way between disagreeing
  samples (≤ 2 px from the true crossing). The ink is the edge's colour 40%
  of the way from the faces' mid tone — no dashes. With no solid nothing is
  asked and the drawing is pixel for pixel what it was. Same on the painter's
  fallback. Decided while building it, and open to veto:
  - **The hidden ink is a solid colour, not transparency**: the same over any
    face, and a test can ask a pixel for it; amber (hover) stays amber.
  - **A grazing face hides only what is well behind it** — the price of
    measuring square to the plane: a face seen within a degree of edge-on, a
    sliver a few pixels wide, hides a point only once it is more than half a
    pixel behind its plane, which along the ray can be far behind. Tested.
  - **An edge on a turned-away face that meets the silhouette keeps a stub of
    full ink up to 2 px long at its end** — the seam's slack; e.g. the base's
    back edge at the corner where the right wall turns toward the viewer.

  ✅ **A solid is opaque — built** (2026-11-02):
  [`docs/plans/opaque-solids.md`](docs/plans/opaque-solids.md). The owner, two
  messages in a row: *"when you extrude a solid, it should look like a solid"*
  / *"It should be opaque"*. **Shaded, the default: what is behind a visible
  face is not drawn and cannot be picked, hovered, dragged, snapped to or
  boxed** — an edge or the part of one, a point and its name, a glyph (at its
  anchor; a dimension's witness lines go with its label), a frame's marker (at
  its origin). Faces still never pick. What is on the solid's visible faces
  and edges, or in front, is drawn and aimed at as before; turn the view to
  reach what was behind. **One `Occlusion` a frame** answers the draw pass and
  the engine's pick, snap, box and glyphs alike (`inSight` in `occlusion.ts`;
  `engine.occlusion`, set by `render`) — a pick between frames uses the last
  frame's, which is what is on screen. **View modes are viewer state**, like
  the camera and the layout: `view("shaded" | "hidden" | "wire")`, `view()`
  says which; `localStorage` (`neocad.viewMode.v1`), never the journal, a
  file or an undo step; a View row on the empty-canvas menu and in `help()`.
  `hidden` is the hidden-edge pass above, `wire` draws no faces. **It looks
  like a solid**: a light body tone (mid slate to light grey-blue), the
  headlight over the whole range, the solid's own edges in a dark ink.
  Decided while building it, and open to veto:
  - ⚠ **`view` is the command now; the camera object is `camera`.** `view`
    was the camera in the command scope (nothing typed it); the spec names
    the command `view(…)`, and one name cannot be both.
  - ⚠ **Light marks get a casing where faces are drawn** (not in the spec): a
    rim in the background's colour under every light line, dot, name and
    frame arm, drawn for all marks before any mark. Without it the sketch's
    `#afc6d9` on the new light faces measured 1.2–2.2:1 — a sketch on a lid
    and a name on a wall were nearly invisible. A plain sketch (no faces)
    skips it and is pixel-identical.
  - **The dark edge ink is for a solid's own edges only where faces are
    drawn**: in wire it would vanish on the background, so wire is sketch
    colours throughout. A profile member that is a *portion* of a longer line
    (a region split by a crossing) keeps its sketch colour — most of that line
    may be off the solid. Points keep their sketch colour on a solid: they are
    targets, not outline.
  - **The hidden mode draws the solid's edges dark too**, its hidden runs
    taken toward the faces' darkest tone like every hidden run — moved from their middle, which sat on a frame's grey — (so a dark edge
    behind goes lighter, a light one darker) — "today's look" with today's
    light faces would have put light edges on light faces.
  - **A frame's marker hides by its origin**, and an arm whose tip is hidden
    loses its head and letter; the rest of the arm is an edge.
  - **An edge picks where the place on it nearest the cursor is in sight**,
    so an edge half behind a box picks along its visible half only; a box
    takes an edge by its visible runs (`visibleRuns`) — a window needs the
    whole edge inside and some of it seen.
  - **A snap to a vertex's projection is refused when the vertex is hidden**,
    and when the projection itself is.

- **No world frame — coordinate frames are entities** (owner's direction,
  2026-09-01, chosen over "keep the frame but hide it" and "directions stay,
  origin goes"). The grid is gone; there is no drawn origin; and
  `hor`/`ver`/`fix` are frame-relative, erroring with a helpful message when
  no frame is given and no default is set. `frame(origin?, xref?)` makes one
  out of two ordinary points; `setDefaultFrame(name)` picks the one relations
  mean when unnamed. A drawing with no frame floats in the solver's gauge,
  which the damped solve already handles. ⚠ *Deviations from Onshape,
  veto-able:* Onshape HAS a sketch origin and frame — this deliberately does
  not; the rectangle tool goes intrinsic (par/perp, no hor/ver ever); H/V
  inference works only while a default frame is set. **Old saved files
  carrying frameless `hor`/`ver`/`fix` will not open** — accepted pre-release,
  said in the CHANGELOG. Format version is now 2.
  **A frame made from a sketch's own points is not a world frame**
  (2026-10-29, [`extrude-makes-its-plane.md`](docs/plans/extrude-makes-its-plane.md)):
  an extrude or revolve of a loop no frame orients makes one from three of the
  loop's points (`sketchFrameFor`'s rule) and carries on, and sets it the
  default only when there was none. Nothing about it is privileged: it is an
  ordinary journalled `frame(a, b, c)`, it moves with the sketch as a datum, and
  it is deleted like any other. What stays ruled out is a frame on no
  geometry anyone drew.
  **A frame a tool makes for its own click is the working plane, not a world
  datum** (2026-10-29, [`no-refusals.md`](docs/plans/no-refusals.md)): a
  circle or arc tool clicked in a 3D model with no default frame types
  `plane(pt(click), null, null, { look: false })` — the plane facing the
  viewer through the click, the one the click already landed on, seeded as a
  typed `frame()` seeds in that view — and the fillet tool a plane of the
  corner's own points; typed `circ()`/`arc()` make `plane()` at the view
  centre. Each is an ordinary journalled frame that exists because a click (or
  a call) asked for a plane where there was none, made the default only when
  there was none, and deleted like any other; nothing is made by asking
  (`toolUnavailable` answers null and creates nothing). The model's "no
  default frame" refusal stays as the guard under the command layer, and
  `fix`/`xaxis()` still refuse without a default — they name a frame, they
  do not need a plane to draw on.
  ✅ **Built, both halves** — model and relations, then the command surface,
  the drawn marker, picking/dragging/boxing, and the end-to-end story.
  *Spec:* [`docs/plans/coordinate-frames.md`](docs/plans/coordinate-frames.md).
  **↻ Extended by the owner (2026-09-02): `hor`/`ver` are retired outright.**
  The words themselves imply a privileged pair of directions — a world frame
  in vocabulary form. "Vertical" becomes `par("l1", yaxis())`: `par`/`perp`
  learn to take a frame-axis reference (`"f1.x"`/`"f1.y"`, direction only,
  datum semantics — read, never pushed), and `xaxis()`/`yaxis()` resolve the
  default frame at the command line. `fix` stays (frame-relative already,
  and it names no privileged direction). Old journals translate
  (`horizontal(l, f)` → `parallel(l, "f.x")`), format version 3.
  *Spec:* [`docs/plans/retire-hor-ver.md`](docs/plans/retire-hor-ver.md).
  ✅ **Built.** `par`, `perp` and `ang` take a frame-axis reference;
  `xaxis()`/`yaxis()` resolve the default at call time; `hor`/`ver` are gone
  from `relations/basic.ts`, from the command surface and from the glyph
  table; the line tool infers `par(l, "f.x")`; v2 files translate and
  re-save in the new vocabulary, format version 3.

  Decided while retiring them, and open to veto:

  - **The audit came out as a rule, not a list.** An axis reference is a
    *direction* — no length, no position — so exactly the relations that
    read an argument for its direction alone may take one: `par`, `perp`,
    `ang`. `eq` is out (an axis has no length to be equal to); `on`, `sym`
    and `tan` are out (each needs a *located* line, and reading `"f1.x"` as
    a line through the frame's origin would give one syntax two meanings —
    `fix(p, [t, 0])` already says "somewhere along the frame's x").
    ⚠ *Veto-able:* `ang` was included on the argument that "this edge at
    30° to the frame" is the commoner draughting intent; it is the one
    inclusion `hor`/`ver` did not already justify.
  - **`par`/`perp` kept the point-pair form** (`par("p1","p3","f.x")`),
    settled on the subject's kind exactly as `hor` settled it, so the
    two-forms distinction ARCHITECTURE.md documents survives the rename.
    `ang` deliberately has no point form: its trailing numeric target would
    have to be told from a third name by arity alone.
  - **Two frame axes on one relation is refused.** Both sides being datums
    means a residual declaring no variables — nothing the solver could
    move — so it is an error rather than a constraint that silently either
    holds already or never can.
  - **A dot is refused in every entity name**, at `claimName`, so a
    reference can never collide with a name. `relationsNaming` and `del`'s
    cascade read `f1.x` as naming `f1`, or a frame could be deleted out
    from under a relation still reading it.
  - **v2 files translate rather than being refused**, and a translated file
    re-saves in the new vocabulary — `save(open(x)) ≠ x` across this
    boundary, deliberately, since a file that opened as `par` and saved
    back as `hor` would keep the retired words alive in the format forever.
    v1 files are still refused by step.
  - *Found by looking at the picture:* **`∥` is not in the browser's
    monospace** and drew as a tofu slab — every other mark advances
    7.2246px in that font and `∥` advances 6. Invisible while `par` was
    rare; the commonest mark in the drawing the moment `hor`/`ver` retired
    into it. The mark is `//` now, and an e2e measures every symbol in the
    table against the monospace cell so the next one cannot rot quietly.

  Decided while building it, and open to veto:

  - **A frame is read, never pushed.** Its two points are not declared as
    variables of the residuals that read it, so an axis `par` turns the *line*
    and never the frame. Declaring them was tried and measured first: least
    squares then turns the frame instead (about 8° of a 9° error, on a
    40-unit line against a 20-unit frame arm) and, without normalising, also
    shrinks the frame's arm to make the residual smaller still. A frame the
    drawing pushes around is not a datum. The cost is one Jacobian that is
    exact for the block as declared rather than for every number its residual
    touches; the benefit is that "level against a tilted frame" settles at
    *exactly* the frame's tilt, which is the package's own acceptance test.
  - **`fix` above 2D keeps its old, gauge-relative meaning.** An origin plus
    one direction settles a frame in 2D and leaves a rotation free in 3D, so
    `addFrame` is 2D-only — and a `fix` that could not be written at all in a
    3D model would take the dimension-genericity of the relation vocabulary
    with it. This is the one place the kernel's own axes are still visible.
    Closing it needs a frame entity carrying a second reference direction,
    which is a package of its own.
    ✅ **Closed by 3D phase 1, half 1** (2026-10-12): a 3D frame carries
    that second direction (a y-ref), `fix` in 3D is frame-relative exactly as
    in 2D, and the gauge form is gone in every dimension. See the 3D entry
    at the top of this list.
  - **A frame's direction is normalised** where two ordinary lines' are taken
    raw — otherwise collapsing the frame satisfies the relation, and that is
    exactly what the solver does when given the chance. (Established for
    `hor`/`ver`, and carried into the axis references that replaced them: the
    residual is on the same |d|·sin scale it always was.)
  - **Dragging a point that a frame reads *moves* it, rather than pulling at
    it** — and this is the other face of read-never-pushed, not an exception
    to it. With the frame's points outside the Jacobian of the residuals that
    read them, the damped solve rejects every step that turns the frame
    (turning it raises a residual the step cannot see how to lower), λ runs
    away by a factor of eight per rejection, and the frame does not move:
    measured at 0.003° against a gesture asking for 26°. So the drag assigns
    the position and the same solve carries the drawing to it — one
    Gauss-Seidel sweep, exactly the cost `frameBasis` says this trade costs. A
    datum is moved by the user; the solver never votes on where it goes. The
    weak pull is still applied on top, so a frame's point that is also
    ordinary geometry keeps its relations' say.
  - **A frame's marker is a fixed pixel length, and that is what is picked and
    boxed.** How far the x-ref sits from the origin means nothing — only the
    direction does — so drawing to it would put a number on screen that
    carries no information. The origin *point* still out-ranks the marker in
    the pick tiers where they meet, which is what makes "drag the corner to
    turn it, drag the arm to move it" two different gestures.
  - ✅ *The half-1 gap is closed:* the line tool's aim, its dashed guide and
    the constraint it lands are one answer, read off the default frame's own
    axes. With no default frame there is now no aim and no guide either,
    where half 1 still pulled the preview onto the kernel's axes.
  - *Not built, and nobody has asked for it:* a frame has no rotate gesture of
    its own. You turn one by dragging its x-ref, which is the same gesture as
    dragging any other point. ⚠ *Deviation:* Onshape's sketch frame cannot be
    moved at all, so there is nothing to match here.
  - *Noted, not acted on:* an intrinsic rectangle's line-to-line `par`
    residual is a wedge — quadratic in the drawing's size, where `hor` was
    linear in a coordinate — so hurling a corner of a filleted rectangle a
    thousand units away no longer re-solves inside sixty iterations. (An axis
    `par` is *not* affected: its second side is a unit vector, so it is
    linear again, exactly as `hor` was.) Displacements on the drawing's
    own scale are unaffected.

- **Selection:** there is no selection set. Clicking geometry drops its name
  into the command line (cellwork's model — "the viewport is a selection
  portal"). Names are inserted quoted and comma-separated, because commands
  here are function calls: two clicks after `dist(` leave `dist("p1", "p2"`.
  **A box select is a multi-click** and nothing more — the names go down the
  same path, so this decision survives box select rather than being replaced
  by it.
- **Mouse:** with a tool armed, the left button belongs to the tool; with
  nothing armed, left-click picks, **left-drag on any geometry drags it** — a
  point, an edge, a rim, an arc — and left-drag on **empty canvas
  box-selects**. Wheel zooms about the cursor (scroll up = in). Middle-drag
  pans. **The right button splits the way the left one does:** past the same
  three-pixel threshold it **orbits** (the 3D app; it panned in 2D), released
  where it landed it opens the context menu; the browser's own menu stays
  suppressed either way.
  **⚠ Changed for 3D (2026-10-12), Onshape's 3D map:** right-*drag* orbits the
  view (a trackball about the screen's own axes, half a degree a pixel) where
  it used to pan; middle-drag is now the only pan button; the release still
  decides, so a right *click* is still the menu. A left press lands on the
  working plane (the default frame's, else the one facing you), so picking,
  dragging and boxing are unchanged in kind. A 2D model keeps right-drag pan,
  having nothing to turn. `orbit(yaw, pitch)` and `lookAt(frame?)` join
  `pan`/`zoom` at the command line. *Veto-able*, like everything here.
  **✔ The deviation noted here is resolved (2026-09-02).** It used to read
  "middle- or right-drag pans; the right-click menu is suppressed", flagged as
  a deviation because Onshape pans with the middle button only and spends the
  right one on a menu — with the standing promise that right-drag pan would
  yield to a menu once one existed. It has, and it cost nothing: the release
  decides, so a right-drag pans exactly as it always did and only a right press
  that never moved means anything new. Middle-drag stays purely navigational
  and never opens anything.
  **↺ Reversed in two steps (2026-09).** This entry used to read "left-drag
  pans", which was cellwork's habit. The box-select package took the empty-
  canvas half and the edge-drag package took the rest, both for the same
  reason: SolidWorks and Onshape box-select on empty canvas and drag the
  geometry everywhere else, and the guiding rule above — tools work like
  Onshape, so people arrive knowing them — outranks a register entry inherited
  from the prototype. Panning lost nothing by either change: middle-drag,
  right-drag and `pan()` all still pan (right-drag has since become the 3D
  orbit — see above). The one left-drag that still pans is a
  press that landed on a **constraint glyph**, which grabs nothing (a glyph is
  UI, with no position of its own) and is not empty canvas either.
  **Veto-able here**, like everything else in this list.
- **Box select follows the SolidWorks/Onshape direction convention**, exactly:
  left→right selects only what is fully contained and is drawn as a solid
  translucent rectangle; right→left selects anything it touches and is drawn
  dashed, in a different tint. Containment and touching are screen-space
  tests, and a rectangle wholly inside a circle touches nothing — the rim is
  the entity, the same rule picking follows. **Constraint glyphs are not
  box-selectable**: they are UI, and a box full of `r`-names nobody asked for
  would be noise, so the flow for relations stays hover-and-click.
- **Every constructor argument is optional, and a missing one is not a
  constraint.** `circle()`, `line()`, `arc()`, `point()` are all legal;
  whatever is left out is auto-created free, with a seed that is never
  degenerate, for the relations to define. This follows from what the
  arguments always were — `circ(centre, r)` seeds a radius variable, it does
  not constrain one — so no existing call changed meaning and old files replay
  untouched. Long names (`point`/`line`/`circle`) sit beside the short ones.
  **Where a free piece lands is a question about the window, not the model**:
  the command layer reads the middle of the view and passes it down as a
  coordinate, and the model still knows nothing about a viewport.
  **Ambiguity is answered by the seed**: tangent + through-point + radius
  admits up to four circles, and the solver returns the branch nearest where
  the piece started — Onshape's behaviour, and dragging flips branches. Said
  out loud in `CHANGELOG.md` so nobody reads branch choice as nondeterminism.
- **Clauses: `_` is required; omission deferred** (2026-10-21). The owner:
  *"please think about how to create a syntax that enables me to create
  elements with arbitrary constraints. pt(x,y,z) is just one possible
  constraint set — to have a function call based around just one possible
  constraint set is not efficient."* Answered by clauses — `pt(on(_, "l1"),
  on(_, "l2"))`, `circ(oncircle("p1", _), …)` — where a relation given the
  placeholder `_` returns an inert clause and a constructor applies it to what
  it made. **Decided, pending the owner's veto: `_` must be written.**
  `circ(oncircle("p1"))`, with the subject's slot inferred from what is
  missing, is deferred: it would make an arity-short relation call mean
  something other than an error, and `_` says exactly which slot the subject
  fills (`tan("l1", _)` and `tan(_, "c1")` are both unambiguous). **Omission
  can be added later without breaking anything**, since every call that would
  use it is an error today. Spec: [`docs/plans/clauses.md`](docs/plans/clauses.md).
- **A dimension is drawn as its value, and a dimension label is a glyph.**
  `dist`, `rad` and `ang` render their target (`50`, `R22`, `30°`) instead of
  a generic mark, because in Onshape the number *is* the dimension. It is the
  same glyph everything else uses — same hover, same click-inserts-the-name,
  same `glyphs(false)` — rather than a dimensions overlay beside it, so there
  is one annotation layer and one switch. Values are read from
  `RelationEntry.args`, formatted trimmed to at most 3 decimals. `dist` also
  draws **dashed** witness and dimension lines: solid ones were tried first
  and read as geometry (a `dist` across a diagonal drew what looked like an
  edge that is not there). ⚠ *Deviation, still open:* `ang` is typed in
  **radians** and labelled in **degrees**, so the label is not what you would
  retype — and `set("d3.value", …)` takes radians for the same reason, since a
  dimension stores what its relation stores. Deliberately left: guessing the
  unit from the size of the number would be worse than one honest unit, and
  degree input is the owner's to ask for.
  **No editing in place on the canvas**: clicking a value still inserts the
  relation's name. Editing itself is `set("d1.value", 60)` from the command
  line, or Set value… on the glyph's menu, which types that command for you.
- **Dimensions are the `d` namespace, and a dimension is the value-holder.**
  `dist`, `rad` and `ang` claim `d1`, `d2`, … and everything else claims
  `r1`, `r2`, …, because a dimension is a number you put on the drawing and a
  constraint is a statement about shape — Onshape's split, and the name now
  says which you are holding. **`fix` is not a dimension**: it carries
  coordinates rather than one value, and Onshape calls it a constraint too.
  The prefix is decided by the op inside `model.relation` rather than passed
  in by each relation, so a new relation cannot get it wrong by omission.
  **`set(path, value)` is an operation**, not a relation: it replaces an
  equation rather than adding one, rebuilding the relation **in place under
  the same name** so every reference to `d4` still means what it meant. The
  new blocks are built before the old ones are removed, so a refused value
  costs the drawing nothing. One user action, one undo step, and it re-solves
  through the host — the `del` precedent, sharpened by the fact that changing
  the verdict is the whole purpose of the call. `"d4.value"` is the only
  settable property; the syntax is `f1.x`'s, one property along.
- **Tools do not dimension what they draw.** A rectangle gets `hor`/`ver` on
  its edges but no size; a circle's radius stays free. Matches Onshape's
  undimensioned-sketch behaviour — the user adds `dist`/`rad` when they mean
  it, and undimensioned geometry stays draggable.
- **Snapping and inference share one switch.** Tiers: exact point beats
  midpoint beats along-a-curve (tolerances in screen pixels, cellwork's
  numbers). `snapping(false)` turns off snapping *and* inference, like
  Onshape's inferencing toggle. Inference never merges points — two points,
  one ordinary constraint.
- **Arc tools**: `arc` is Onshape's *center point arc* (click centre, start,
  end); `arc3` is its *3 point arc* (click the two **endpoints**, then a point
  the arc passes through — Onshape's order, not start-waypoint-end). The
  waypoint is not kept as geometry, so `arc3` leaves the arc's bulge free.
- **Fillet** takes its radius when armed — `arm("fillet", { radius: 8 })`,
  default 10 — and reuses the shared corner as a tangent point so nothing is
  orphaned. (That was originally because there was no delete; it is still the
  right shape, since a fillet that stranded points would leave stray dots for
  the user to clean up by hand.) A miss-click is a miss, not a cancel.
- **Deleting:** `del(name, …)` takes one name or several (a box-select's
      worth is the expected batch: every name is validated before anything is
      removed, a name an earlier cascade already took is skipped, the batch is
      one undo step) and cascades the way Onshape does
  — a relation takes nothing with it, a point takes what references it, a
  curve takes its relations but not its points. **No confirmation prompt:**
  `del` is one user action, so undo is the confirmation, which is the pattern
  `open()` already set. Deleted variables are tombstoned rather than
  compacted; the leak is documented in `STATUS.md`.
- **Constraints attach to edges, not corner points**, wherever the user means
  an edge (`hor("l1")` rather than `hor("a","b")`) — relations resolve their
  line's endpoints lazily, so they survive a fillet re-pointing the edge.
  Both forms exist; built-in tools use the line form.
- **A saved file is data.** It is the model's journal (the calls that built
  it), replayed on open, and `open()` only runs calls from a fixed table — a
  hostile file can at worst draw something odd. Solved coordinates ride
  along so an under-constrained model reopens exactly as saved.
  **A file may also carry the source of tools authored at the command line,
  and that changes nothing about the rule:** the source is inert text,
  `open()` evaluates none of it, `toolSource(name)` prints it, and pasting it
  back is an ordinary entry — the paste is the consent. Nothing in a file runs
  that the user did not themselves type, and no button, menu item or flag
  exists that would run it for them. Capture is the whole entry that called
  `defineTool`, is session state rather than model state (not journalled, not
  an undo step), and rides the file as an optional field that did not move
  `VERSION` off 4.
- **The chrome is panels, and their layout is the viewer's** (owner's
  direction, 2026-10-21: *"a moveable toolbar. actually everything should be
  moveable and resizable"*). The toolbar, the log and the command line are
  each a panel over a full-window canvas, dragged by a title strip and resized
  ~~by a corner grip~~ — the owner (2026-10-29): *"allow me to rescale the
  popup windows from any corner"* — **from any of its four corners**, the
  opposite corner fixed (all but the tray, which is never resized — below).
  **The header is the one fixed thing** — the title bar,
  where the solve status lives. **Layout is per-viewer UI state**: in
  `localStorage`, never in the journal, a saved file or the undo history, so
  two people opening one file keep their own arrangements, and a storage that
  throws costs the arrangement and nothing else. **Three defaults this entry
  shipped with were vetoed by the owner (2026-10-22)**, and the opposite is
  now the rule: ~~a panel may be parked mostly off an edge~~ — *"I shouldnt be
  able to slide the tooltrays off the edge. they should stay fully within the
  viewport borders"*: every panel is held **wholly inside**. ~~Labels are the
  tool names, not icons~~ — *"tools should be icons"*: each built-in has an
  inline-SVG glyph, a tool defined at the command line a generic one (a square
  with its first two letters), and **the name is the tooltip**. ~~A tray is
  always a column~~ — *"when I push a vertical tooltray against a top or bottom
  edge, it should become horizontal etc and vice versa. that includes pushing
  it up against a vertical/horizontal edge of another tooltray"*: the toolbar
  **turns** row/column live as it is dragged against the area's edges or a
  panel's facing edge (a corner keeps its way), and the orientation is stored
  with the layout. ~~A panel may be pushed over another~~ — overturned by the
  owner (2026-10-26): *"shouldn't be able to drag windows over other windows.
  they should collide and push one another around. not collide like physics,
  just push"*, and *"when i grab a window at a point on that window, then push
  it up against something, the grab point should kind of slip, so that when i
  push it back in the opposite direction, it doesnt have to get back to the
  original slip point"*. Two rules: **panels never overlap** — a dragged,
  resized, turned or grown panel pushes what it meets, in a chain, by exactly
  the overlap, and nothing springs back; the window's edge is the one
  immovable thing, and a panel blocked by a chain against it stops flush —
  and ~~the grab point slips~~, reversed by the owner (2026-10-27): *"actually
  the grasp point should stay the same"*. **The grab is fixed at the moment
  the panel is taken**: a panel stopped short stays where it stopped while
  the pointer goes on, and moves again only when the pointer comes back past
  where it left the panel behind — then exactly under the hand where it was
  grabbed, drag and grip alike. A tray that turns is a new shape, and the hand
  keeps the same point of it, the same fraction along its strip. One pure
  resolver, `pushed`, serves every arrangement. ~~A resized tray scrolls~~ —
  ~~*"the tool palette should wrap the icons also - i.e. if it is vertical and
  i decrease vertical size, it should create a second column"* (2026-10-29):
  the tray's buttons wrap in the way it runs, the run the viewer's and the
  depth the buttons'~~ — reversed by the owner the same day: *"actually get rid
  of resizing altogether on the tool palette. its just a straight line that
  fits the number of tools it has in it, and can either be vert or horiz"*.
  **A tray has no grips and is never resized**: it is exactly one line of its
  buttons (`traySize`), a column or a row, a button longer for every tool
  defined — moved or not, a stored size never read — and turned by dragging it
  against an edge. ~~The grips are drawn as diagonal marks~~ — *"you dont need
  those diag lines on every corner"*: **a grip draws nothing**; the log's and
  the command line's four are invisible corner hot-spots whose resize cursor
  is the affordance. A button types
  `arm("name")` through `submit`, the context menu's rule: it can do nothing a
  typed command cannot. An empty model says what to do (owner's report, *"i
  dont see anything in the artifact"*), drawn from the model, never a flag.
  ~~**A tool that cannot run is greyed, not hidden**, on the toolbar as on the
  menu, with the model's own reason as its hover text~~ — struck by the
  owner's "effortless" direction (2026-10-29, [`no-refusals.md`](docs/plans/no-refusals.md)):
  the only tools it ever greyed, the curve tools without a default frame, now
  make their plane, so **nothing is greyed**. The one rule
  (`src/toolavail.ts`) stays, answering null, read by the menu and an undo's
  re-arm; ~~the greyed button's machinery in `panels.ts` stays wired to it,
  unused~~ — removed by `tool-options.md`: the toolbar no longer asks it, and
  a tool that one day cannot run somewhere answers its click with guidance.
  **The options panel** is the one panel that comes and goes: shown beside the
  tray while a tool that declares options is armed, sized by its rows (no
  grips), placed after every other panel, its position the viewer's like the
  rest; a field edited types `arm(…)` through `submit`.
  Spec: [`docs/plans/panels.md`](docs/plans/panels.md),
  [`docs/plans/toolbar-availability.md`](docs/plans/toolbar-availability.md),
  [`docs/plans/toolbar-icons-docking.md`](docs/plans/toolbar-icons-docking.md),
  [`docs/plans/panels-push.md`](docs/plans/panels-push.md),
  [`docs/plans/panels-corners-wrap.md`](docs/plans/panels-corners-wrap.md),
  [`docs/plans/tray-fixed-line.md`](docs/plans/tray-fixed-line.md).
- **Ctrl+Z is the drawing's, everywhere** (owner's direction, 2026-10-29:
  *"why does ctrl+z and ctrl+y not work? should work and be bulletproof"*).
  Ctrl+Z / Cmd+Z always undoes the model and Ctrl+Y / Ctrl+Shift+Z / Cmd+⇧Z
  always redo it, whatever holds the focus and whatever is on screen: one
  capture-phase listener on `window` that stops those chords and nothing
  else. ~~While the command input holds uncommitted text, Ctrl+Z is the
  browser's text undo~~ — the undo package's carve-out, measured as the one
  case in which the key "did not work" (the box emptied, the drawing stayed),
  and retired: **the drawing undoes and the half-typed text stays in the
  box**, the browser's text undo prevented. A half-typed command is not
  otherwise protected; anything submitted is one ↑ away. An undo closes the
  menu and cancels the gesture in progress first, keeps the armed tool armed,
  and always answers — the log, and a note beside the status verdict, the
  empty stack included. Undo and Redo end every context menu. Layout and the
  camera are not steps, and `help()` says so.
  Spec: [`docs/plans/undo-bulletproof.md`](docs/plans/undo-bulletproof.md).
- **The command line is curation, not a sandbox.** Typed code runs with the
  app's full authority; the scope exists for legibility and typo-catching,
  and says so honestly rather than claiming to be a security boundary.
- **Process:** work packages arrive as PRs against the working branch, per
  the header above (owner approved the PR flow after originally asking for
  direct commits). Small items whose spec would be longer than the diff may
  be committed directly by the supervising session, with the same test gate.

## Decisions needed from the owner

- [x] **How a dimension's value is edited — DECIDED by the owner
      (2026-09-02), and shipped.** *"should be a `set(d4.value, 60)` where d4
      is the dimension."* The design is now a register entry above
      ("Dimensions are the `d` namespace"); spec:
      [`docs/plans/dimensions-are-named.md`](docs/plans/dimensions-are-named.md).
      **Still open underneath it**, and not this package's to answer: `ang`
      stores radians while its label reads degrees, so `set` on an angle takes
      radians. Degree input is a separate ask.
- [x] **May a saved file carry code? — DECIDED by the owner (2026-09-02):
      inert text, pasted back by hand — and BUILT (2026-09-03).** The file
      carries a REPL-authored tool's source as data; `open()` never evaluates
      it, and the paste is the consent. Shipped as specced in
      [`docs/plans/tool-source-in-files.md`](docs/plans/tool-source-in-files.md);
      the register entry above ("A saved file is data") now states it as
      standing behaviour.

- [ ] **Open, each shipped with a default you can veto** (2026-10-22). Say
      the word and the default flips; none blocks anything.
      1. **Clauses: `_` must be written.** `circ(oncircle("p1"))` with the slot
         inferred is deferred; adding it later breaks nothing. (Register:
         "An entity defined by any constraint set".)
      2. ~~**A boss's lid frame copies the sketch frame's points**, so a boss on
         a face gets a lid frame built from plate corners, floating off the
         boss.~~ **Moot (2026-11-03):** an extrude makes no lid frame
         ([`docs/plans/no-lid-frame.md`](docs/plans/no-lid-frame.md)), so a
         boss has nothing floating off it. (Register: sketch on a face.)
      3. **Deleting a feature takes what it owns, across features**: the first
         step of a stepped block owns the shared crossing points, so deleting
         it takes the second step's walls there; `regen` cascades the same
         way. The alternative is that a surviving feature inherits a shared
         crossing. (Register: regions split, PR 2.)
      4. **A clause in the wrong slot is refused only after the entity is
         made** (`circ(oncircle(_, "p1"))` makes the circle, then `onCircle`
         refuses). A kind check before anything is made is possible from the
         slot lists. (Smaller things.)
      5. **Face-on arcs snap as their whole circle** — the parked phase 3
         decision, below.
      6. ~~**Toolbar labels are the tool names, not icons.**~~ **Vetoed by the
         owner (2026-10-22): icons**, with two more directions on the tray
         (fully inside the viewport; turning column/row against the edge it
         meets). Spec: [`docs/plans/toolbar-icons-docking.md`](docs/plans/toolbar-icons-docking.md).
         **Built** (2026-10-22) — see Done.

## Next up

Queue for Opus, in order. Each gets a spec in `docs/plans/` before work
starts.

- [x] **Files — open, save, share, drop, autosave — BUILT (2026-11-04).**
      The owner: *"I want to be able to open files on my phone, share files
      etc. Should also work for desktop."* `newFile()`, `openFile()`,
      `saveFile()`, `shareFile()` and the host's `document()` (the seam the
      app menu types and reads); Ctrl/⌘+S and Ctrl/⌘+O; drop to open; an
      installed desktop app's `file_handlers`; autosave to IndexedDB,
      restored at start. Spec: [`docs/plans/files.md`](docs/plans/files.md),
      marked built, with the platform claims it corrected and every
      deviation: `document()` is the host's, not a command; Open's
      unsaved-changes question comes after the file is chosen; the share
      sheet is the save under a finger only; `file_handlers` claims `.json`.
      **Not tried on iOS** — the CHANGELOG lists what the owner should try.

- [x] **The app under fingers — BUILT (2026-11-04).** The owner: *"it should
      work on a multi-touch device. Specifically I have an iPhone."* One touch
      recogniser (`src/tools/gestures.ts`) feeding the engine's mouse paths:
      tap, one-finger drag (a tool's gesture, a drag of what it lands on, or an
      orbit on empty canvas), two-finger pan and pinch about the centroid,
      long-press for the menu, long-press-drag for the box, a second finger
      dropping a draw, a third dropping everything; tap-to-toggle selection;
      finger-down reveal; coarse pick and snap radii (×2.75) with the active
      point lifted 56 px above the finger; the action strip (Undo, Redo,
      Delete, Cancel); 44 px targets under `(pointer: coarse)`; the keyboard
      kept away; a phone's default layout both ways up. **Not tried on iOS
      Safari** — this machine has only Chromium; CHANGELOG lists what the owner
      should try first. Spec: [`docs/plans/touch.md`](docs/plans/touch.md).
      Deviations from the spec:
      - ⚠ **Portrait's tray is a column down the left**, not a row along the
        bottom: eleven 44 px buttons are 556 px of row on a 390 px phone. The
        landscape tray is the row.
      - ⚠ **The options panel has a phone default of its own in portrait** —
        above the action strip, right of the tray — because beside a column
        on the left it hung over the middle of the drawing (measured: it
        covered the rectangle an extrude test aimed at).
      - ⚠ **Cancel types `cancel()`**, not Escape's step-at-a-time: the strip
        has to type a command, there is no typed Escape, and a feature's picks
        have ✗ for the one step.
      - ⚠ **A finger's box adds to the selection** (as shift-box does): there
        is no shift on glass, and a tap on empty canvas is what clears.
      - ⚠ **The action strip is shown only under a coarse pointer**: a
        desktop has the keys, and showing it would have changed the mouse's
        layout.
      - ⚠ **The canvas's `touchend` is cancelled** (in the engine): the
        browser's compatibility click after a long touch landed on the menu
        the long-press had just opened, and ran its first item. Cancelling
        `touchend` is the only way to stop a touch's click. It overlaps the
        PWA package's gesture listeners only in effect, not in code.
      - ⚠ **The engine sets the canvas's `touch-action: none` itself** — the
        PWA package's stylesheet will say the same; without it a pinch is the
        page's zoom and the pointers are cancelled (measured in emulation).
      **Found while building, left deliberately:**
      - **Glyph boxes are not widened** for a finger: a glyph sits ~7 px off its
        line, and a fingertip-sized box would take the taps aimed at the line.
        Below 44 pt (about 18×16).
      - **The context menu is wider than a phone's room** either side of most
        fingers; menu.ts holds it inside the window, so it can sit under the
        finger (the lift no longer presses it).
      - **Landscape in Safari is cramped**: 342 px of viewport, 88 of it the
        command line (its 44 px strip and 44 px row).
      - **A tool's press-commit survives a dropped gesture** (a line's second
        click is committed on the press), as under a mouse; Undo takes it back.
      - **Chrome sizes are chosen at load** from `(pointer: coarse)`; plugging a
        mouse into an iPad keeps the large targets until reload (the mouse
        still behaves as a mouse).
      - **Until the PWA package lands there is no viewport meta**, so a real
        iPhone lays the page out 980 px wide. Under device emulation the e2e
        harness puts one first in `<head>`; a page's own, parsed after it, is
        the one that counts.
- [x] **An installable app on GitHub Pages — BUILT (2026-11-04).** The owner
      asked for GitHub hosting, a PWA, and a page that neither scrolls nor
      zooms, for his iPhone. `npm run build:pwa` → `dist-pwa/` (the
      single-file app with the PWA head, the manifest, the committed icons, a
      hand-written worker keyed by the build stamp, `.nojekyll`);
      `src/pagelock.ts` and `index.html`'s viewport, fixed page and safe areas
      in every build; `.github/workflows/pages.yml`. Spec:
      [`docs/plans/pwa-pages.md`](docs/plans/pwa-pages.md). Deviations from
      the spec:
      - ⚠ **The hosting target moved**, at the manager's direction: the site
        is to be served from `BrotherCreamy/zerocad`, not from this
        repository, and **nothing was pushed to any `gh-pages`**, including
        the spec's fallback. The workflow is in the PR and is
        repository-neutral. The e2e sub-path is `/zerocad/`.
      - ⚠ **The safe areas are tested through CDP's
        `Emulation.setSafeAreaInsetsOverride`.** Chromium's iPhone 13
        descriptor has zero insets, so without the override "nothing under the
        notch" could not fail.
      - **Controls for every negative check.** The same CDP touches scroll and
        zoom an ordinary page, and with the viewport's limits stripped the
        pinch zooms the app once the page lock's listeners are dropped. CDP's
        `synthesizePinchGesture` zoomed nothing even on the control, so the
        pinch is two raw touch points.
      - `touch-action: manipulation` is on `html, body`, which holds over all
        the chrome because a touch's action is the intersection over its
        ancestors. Inputs stay selectable as well as the command line and the
        log, because iOS will not edit a field under `user-select: none`.
      - Additions: `format-detection: telephone=no`, no tap highlight,
        `text-size-adjust: 100%`, an SVG favicon, the manifest's `id`, an
        automated manifest-and-icons check (the spec said by hand), and an e2e
        update test (a new build waits, then is the next start).
      - The workflow runs `npm ci` before the kernel, uses the runner's
        rustup, and fetches wasm-pack's installer from its current home
        (`wasm-bindgen.github.io`). **It has never run.**
- [x] **Rename the worker's cache prefix with the app** — done in 0.1.0: `zerocad-`, and `neocad-` caches are deleted too (`CACHE_PREFIX` in
      `scripts/pwa-shell.ts`, and the literal in `scripts/pwa-sw.js`). A
      worker deletes only caches under its own prefix. The release that
      renames it should delete `neocad-` caches too, or every phone that had
      the old app keeps one stale cache forever.
- [x] **A quick tap on a busy page was lost** — fixed: taps are timed by the
      events' timestamps, and a late long-press timer yields to queued input
      (`gestures.ts`, `LATE_MS`; see the CHANGELOG). This was the cause behind
      the touch tests two workers saw fail only under load.
- [ ] **A tap right after a flick may not click.** Chromium suppresses a tap
      that follows a fling within ~150 ms (the tap that stops a fling is not a
      click); a one-finger drag lifted mid-motion is a fling to it, so a strip
      tap 80 ms later was lost in emulation (`touch.e2e.ts`, measured, and the
      test now rests the finger before lifting, as a hand placing a corner
      does). iOS has its own rule for the same thing; check on the device
      whether a quick Undo after a flicked drag is ever swallowed.
- [ ] **Try the hosted build on the owner's iPhone**: the CHANGELOG entry's
      list. Only Chromium's emulation has run it so far.
- [ ] **Landscape phone layout**: the default panels overlap the tray's edge
      and the empty-canvas hint at 844×390 (seen in `pwa.e2e.ts`'s
      screenshot). This is the touch package's (`touch.md`, layout on small
      screens). Nothing sits under the notch.

- [x] **An extrude makes no lid frame — BUILT (2026-11-03).** The owner's
      *"i'm getting a lot of overlapping points. why is this happening?"*, in
      the case sharing could not fix: two rectangles extruded at once share the
      first one's sketch frame, so the second lid frame laid three points on
      the first lid's corners (19 points, three pairs, three frames; now 16,
      none, one). A twin curve on the sketch frame names the sketch frame; the
      depth holds corners, centres and radii; the record's `top` is absent; a
      circle's top gets a sketch plane made through its centre. A revolve keeps
      its end frames. Format 11; a version-10 file's extrudes are marked `10`.
      Spec: [`docs/plans/no-lid-frame.md`](docs/plans/no-lid-frame.md).
      Deviations from the spec:
      - ⚠ **The circle's plane has no new point at its centre.** The spec said
        "a point at the centre typed with `pt(...)`"; that point would lie
        exactly on the top's twin centre, a doubled point. The origin is the
        twin centre itself.
      - ⚠ **Its x-ref and y-ref are held on the rim** (`pt(…, oncircle(_,
        "cN"))`), not left free as the curve tools' refs are. A frame is a
        datum, so free refs never move: `set` the depth and the origin rises
        while the refs stay, which tips the plane. On the rim they rise with the
        top.
      - ⚠ **Seeded with every digit**, not the curve tools' three decimals:
        rounded, the holds pulled the refs onto the rim and the cylinder's free
        radius gave way by 5e-5 (measured).
      - ⚠ **`EXPANSION` is per op** (`{ extrude: 11, revolve: 10 }`), and a
        revolve refuses `11`: the spec left revolve unchanged, and one number
        meaning two expansions would not say which one a file means.
      - ⚠ **The refusal kept** is a circle whose frame has collapsed. The old
        "frame has no y-ref" refusal is gone: every 3D frame has a +z, and a
        made plane needs nothing more.
      **Found while building, left deliberately:**
      - **A plane made on a circle's top has two rim points of its own**, drawn
        (they end no line) with their `oncircle` glyphs. Deleting the cylinder
        takes the frame, since its origin is the twin centre, and leaves those
        two points, as deleting any frame leaves its points.
      - **A lid is in no frame's plane** now (`loops()` says `in the plane
        facing (…)`), until something is sketched on it; a stacked extrude is
        oriented by the sketch frame, which the lid is parallel to.
      - **Old open default 2 ("a boss's lid frame floats off the boss") is
        moot**: a boss makes no lid frame.
      - **`hidden.e2e.ts`'s stepped-block probe flipped** on anti-aliasing:
        the base's back line is both a sketch portion and the base cap's edge,
        so the dimmed sketch stroke and the dimmed solid line overlap there, and
        the probe took the most opaque pixel of the two. With the lids' frames
        gone the sketch stroke's core measured alpha 251 instead of 255 and the
        solid's 255 won. The probe now asks that the sketch's dimmed ink is
        drawn there. Why the stroke's anti-aliasing moved is not pinned down; a
        lid's loop plane is no longer a frame's (its u/v axes come from its
        first line), which changes the cap's triangulation and so the
        occlusion runs. That is the likely cause, but it is not measured.


- [x] **A lid frame shares the lid's own points — BUILT (2026-11-03).** The
      owner: *"i'm getting a lot of overlapping points. why is this
      happening?"* / *"of course it should."* An extrude's lid frame and a
      partial revolve's end frames take the twin of every point of the frame
      they copy that is a profile vertex; the depth (angle) holds each place
      once; regeneration and `del` own a shared point once, as a twin. The
      owner's plate: 17 points with three pairs on one spot, now 14 and none.
      Format 10; a version-9 file replays with the old expansion. Spec:
      [`docs/plans/lid-frame-shares-points.md`](docs/plans/lid-frame-shares-points.md).
      Deviations from the spec:
      - ⚠ **"…and its extrude counterpart"** of `twinFrame`: there is none. An
        extrude never twins a curve's other frame (a translated frame keeps its
        orientation, so an off-sketch curve's twin stays on its own frame).
        Only the lid frame and revolve's end frames make frames; the spec text
        is corrected.
      - ⚠ **The old expansion is said in the entry**, not chosen from the file's
        version at replay: `translate` writes `9` into every extrude and partial
        revolve from before 10 (`extrude(…, loops, 9)`), because a reopened old
        file is saved as version 10 and must still mean the old expansion. The
        fillet-8 pattern, one argument later. A whole turn makes no frame and is
        left alone. The record carries `expansion` so regeneration rebuilds the
        old way too.
      - ⚠ **Every** pre-10 extrude is marked, not only those whose frame stood
        on the profile: a later `regen` can bring a sketch-frame point into the
        profile, and the two expansions differ there.
      - ⚠ **The revolve's end frame stays a frame pair** in the angle's
        arguments, and the `revolution` relation skips any of its points a
        corner pair already holds — spelling out only the made points as point
        pairs would have stopped the sketch frame's points being read as a
        datum.
      - ⚠ **Regeneration merges the other way too** (not asked, follows from
        the rule): a sketch-frame point the profile comes to run through takes
        the lid point already above it as its twin.
      - ⚠ **The e2e asserts one doubled label left on the sketch** — see below.
      **Found while building, left deliberately:**
      - **The line tool's closing click doubles a point** (not this package's):
        a click snapped onto an existing point makes a point of its own there
        and `coin`s it, the chain's own first point included, so a triangle
        drawn with the line tool is four points, two of them one corner, and
        shows two names there (`test/e2e/lidframe.e2e.ts`'s first screenshot).
        The lid has one twin for it (per joined class). Likely part of what the
        owner saw; the remedy is the line tool reusing the point it snaps to
        when closing its own chain — a tool change, its own package.
      - **A sketch-frame point on a corner's spot but not joined to it** gets
        its own lid point, on top of the corner's twin: the rule reads joins,
        because a replay on seeds cannot read positions.
      - **A revolve about the sketch frame's own axis** leaves the end frame's
        origin and y-ref (on the axis) on the sketch frame's own points — not
        points the feature made, so outside the rule.
      - **Deleting a lid corner the lid frame stands on takes the lid frame**
        and whatever is drawn on it, as deleting any frame's point does; before,
        the lid frame had its own points and survived.
      - **A boss's lid frame on a face still floats** (open default 2 above): the
        face frame is the plate's corners, which are no vertices of the boss.

- [x] **Sketch on a solid's face — BUILT (2026-10-21).** The one-model design
      made it one step: `arm("sketch")` and a click inside a face, or
      right-click → **Sketch on this face**, types `plane(a, b, c)` on three of
      the face's own points, +z toward the viewer. Spec:
      [`docs/plans/sketch-on-face.md`](docs/plans/sketch-on-face.md).
      **The note that stood here was wrong, and what replaced it is worth
      keeping:** faces did *not* need to pick first. A face is not an entity,
      but every planar face of a solid is a closed loop of real entities — a
      lid its twin loop, a wall the quad of an edge, two side edges and the
      twin edge — and `loopAt` already finds the loop under a pixel, so a face
      is something a *tool asks about*, as the extrude tool asks about a
      region. Faces stay display only; nothing in `model.ts`, `faces.ts`, the
      journal or persistence changed. **Orientation is back-face culling for
      free:** the face a ray meets first is one it enters through, so its
      outward normal faces the viewer, and ordering the points so
      `(b − a) × (c − a)` faces the camera puts +z out of the solid — a
      positive extrude on a wall is a boss, never a bore (tested both ways:
      every face of a plate from its own outside, and the boss's lid outside).
      The frame's points are the solid's, so it follows the solid (`set` the
      depth and the wall's frame stays on the wall).
      Deviations from the spec, each also marked in it:
      - ⚠ **The tool types its command** (`ToolContext.run`, new — the host's
        `submit`, the menu's very seam), because `plane()`'s `lookAt` is the
        camera's and no tool holds the camera. The log, recall, journal and the
        one undo step are then the typed call's because it is one. Headless
        (no `run`) the tool refuses rather than half-commit.
      - ⚠ **`sketchFrameFor(model, loop, toward)`**, not `(…, view)`: the
        engine's `regionAt` now reports the line of sight it looked along
        (`RegionHit.toward`), so the tool still learns no camera.
      - ⚠ **A corner and its two neighbours**, not the first three vertices:
        that reading, swapped to face the viewer, put +x along the face's
        diagonal whenever it was seen from its back, and `lookAt` showed a wall
        tipped by its aspect ratio — caught in the e2e screenshot. Now +x runs
        along an edge (an e2e test asserts the wall comes up level). A point
        partway along an edge is no corner and is skipped; then any three
        vertices, then arc centres (a lens has two vertices).
      - ⚠ **A whole circle lying off its own frame's plane is refused** (a
        circle is held parallel to its frame, not on it, so the frame's points
        would not be on the face). *Superseded 2026-11-03* (no-lid-frame): every
        extruded circle's top is such a circle now, and it gets a plane made
        through its centre, its refs held on its rim.
      - ⚠ **The outward-boss assertion** measures the boss's lid frame across
        the wall's plane: its origin twins a plate *corner*, farther from the
        centroid than the wall's middle whichever way the boss goes, so the
        spec's straight-line distance could not tell out from in.
      **Found while building, left deliberately:**
      - **A boss's lid frame floats off the boss.** Extrude twins the sketch
        frame's three points for the lid frame, and a face's frame is the
        plate's corners — so a boss on a wall has its lid frame's marker and
        points out past the plate's corner, in empty space, `depth` off the
        wall (visible in the poster). Correct, and cluttered; the remedy would
        be extrude choosing its lid frame from the profile rather than twinning
        the sketch frame — an extrude change, not this package's. (Still so
        after the lid frame learned to share the lid's points, 2026-11-03: the
        face frame's points are the plate's corners, no vertices of the boss.
        Gone the same day: an extrude makes no lid frame.)
      - **The menu item and the tool make the frame default and look at it,
        always** (`plane()`'s contract). Sketching on a face you only meant to
        measure against means `frame(a, b, c)` typed.
      - **Which edge is +x is whichever the loop starts at** — a wall may come
        up portrait. Level or plumb, never tipped; choosing the longer edge is
        a nicety nobody has asked for.
- [x] **Regions under crossings and Ts — BUILT, both PRs (2026-10-21/22).** The two ⚠ loop policies (a
      crossing or an `on`-T splits nothing) deviate from Onshape, which
      subdivides regions; extrude is where a user will feel it. Wants a
      loops.ts extension, not a redesign. Spec:
      [`docs/plans/regions-split.md`](docs/plans/regions-split.md).
      **PR 1 BUILT (2026-10-21)** — `loops.ts` cuts every edge at held Ts and
      at crossings (virtual vertices, `l1×l5`), members walk portions (`span`),
      `loopAt` and the region preview see sub-regions, `loops()` lists them,
      and `extrude`/`revolve` refused a split region by name until PR 2.
      Deviations from the spec, each also in its "PR 1 as built":
      - ⚠ **A crossing key can collide with a name** — the spec thought the
        dot reservation prevented it; `×` is a legal name character. A key
        that is a name gets a prime (′); `isVirtual(model, v)` is the test.
      - ⚠ **Members are as long as the loop allows**: consecutive parts of one
        entity walked one way are one member, so a cut that is no corner of
        the loop is not listed. Without it a dangling T would have made a plain
        rectangle "split" and unextrudable.
      - ⚠ **The line form of `mid` holds a point on a line** too (a midpoint
        snap infers it); the spec named `on` and `oncircle`.
      - ⚠ **Portions are labelled in their entity's own direction**, not as
        walked: as walked, the two crescents of a lens had the same label and
        the hover did not redraw between them.
      - ⚠ **Tangency is measured as a distance from touching** (a solved
        tangency's roots are √(2rδ) apart, so the old root-gap test would call
        it a crossing); lines must straddle each other by more than the
        tolerance to cross.
      - **Crossing lines are candidate planes**, so three lines that only cross
        bound a triangle. Pair searches swept and boxed: 3.6 ms on 400 coplanar
        lines against 2.8 before; a 30 × 30 grid of crossing lines (841
        regions) is 31 ms, per hover move.
      - **`sketchface.ts` skips crossings** when choosing three points (a
        crossing is no point to hold a frame), falling back to the parted
        edges' own ends; a lens of circles takes a circle's frame.
      - **Two older tests used a line through a profile as a revolve axis**;
        that line now splits the profile, and the tests were reshaped (see the
        spec).
      **Found while building, left deliberately:**
      - A crossing's key is positional (numbered along the first edge) and can
        change under a drag; it is a question's answer, not a name to keep.
      - Two held points of different classes on one spot of an edge cut it
        once, at the first; the second's edges do not meet the first's there.
      - Edges lying along each other (collinear overlap, two arcs of one
        circle) are not crossings, and overlap still gives odd faces — as
        before this package.
      - `loopOutlines` draws a portion by re-reading the live entity over the
        span found at hover time, so mid-drag a preview can lag the crossing
        by one hover move.

      **PR 2 BUILT (2026-10-22)** — features over split regions. A region a
      crossing or a T cut out extrudes and revolves as the preview showed it:
      a plate with a line across it is a stepped block from one sketch, a lens
      of two crossing circles a lens-shaped solid (screenshots 76–77; the story
      is `test/e2e/regions.e2e.ts`, the matrix `test/regionfeatures.test.ts`).
      Every crossing the profile runs through is materialised — a point held
      `on`/`oncircle` its edges, owned by the feature — before twins per vertex
      and a twin line or arc per portion; the journal's members may be
      `{name, from, to}` between real points, and the format is version 8.
      Deviations from the spec, each also in its "PR 2 as built":
      - ⚠ **`{name, from, to}` runs in the entity's own direction**, not as
        walked (the spec did not say): two points on a circle bound two arcs.
      - ⚠ **`Model.asOperation` may take its arguments as a function**, read
        after the body: the entry names points only the body knows the names
        of.
      - ⚠ **A replay makes any vertex the model has no point by** under the
        journal's name, held on the edges that meet there, seeded at a
        placeholder the saved values replace. A vertex spelled `×` that is no
        point is refused, so a key is never kept, by hand or otherwise.
      - **A materialised point is held on every edge the profile bounds
        there** (usually two; three lines through a spot can need more).
      - **`extrudeProfile`** is the extrude tool's door (as `revolveProfile`
        was); a found `Profile` carries where its crossings are.
      - **The record names a portion's pre-existing ends** (a T's point, or
        another feature's crossing), so deleting one takes the record.
      - **One entity may be several portions of one profile** (a band across a
        circle); only a whole member twice, a portion twice, or a whole
        beside a part is refused.
      - **A whole-turn revolve materialises its crossings too** — its surface
        is swept between them.
      - **`checkRevolve` measures a portion over its own part**, so a half of
        a split rectangle revolves about the line that cut it (PR 1's test of
        that case now asserts the revolve).
      - **A version-7 file holding a portion is refused at its step**, as a
        hand edit; every real version-7 file reads exactly as before.
      **Found while building, left deliberately:**
      - **Deleting the first step of a stepped block takes the second's
        record** and its two walls on the shared crossings: the twin rule the
        spec asked for, applied. Undo is the confirmation.
      - **The two steps' walls along the shared line lie along each other**, so
        loops.ts reads overlap there and the riser between the steps is drawn
        but is no loop to sketch on or extrude from. Onshape merges the bodies;
        this model keeps two solids, and has no booleans.
      - The two steps' coplanar faces at the shared line sort as any
        interpenetrating solids do (the display-depth item below). *(Measured
        there: wrong in none of 40 views — the two faces are back to back and
        one is always culled. Drawn by depth now either way.)*
- [x] **Display depth done right — BUILT (2026-10-22).** The 355° cap limit
      and interpenetrating solids traced to painter's sorting; **faces are
      drawn by WebGL with a depth test now**, on a canvas under the 2D drawing,
      and the painter's is the fallback where there is no WebGL. Measured
      before choosing (`npm run measure:depth`, 40 seeded orbits a scene):
      the painter's wrong in 39 of 40 views of two interpenetrating extrudes
      (4 528 px mean, 14 647 worst), 13 of 40 of a 355° revolve (199 worst),
      none of a lone box or cylinder (the two agree there but for
      anti-aliasing); the app's own frames, depth against painter's, 45.9 /
      46.0 ms for the stepped block and 51.2 / 252.9 ms for a filleted full
      turn (headless Chromium, software WebGL). Spec:
      [`docs/plans/display-depth.md`](docs/plans/display-depth.md) (its "As
      built" has the detail); the story is `test/e2e/depth.e2e.ts`;
      screenshots 81–84. Deviations from the spec:
      - **The depth layer was written before the measurement**, unwired, in
        the first commit — the spec's "both renderers exist in the tree" was
        not yet so.
      - **Time per frame is the app's own frames**, `render()` each animation
        frame, not each renderer offscreen: forcing a 2D frame to finish needs
        a read back, and Chrome then moves that canvas into CPU memory, which
        timed a different canvas (0.6 against 12 ms, same faces).
      - **The fallback sorts by centroid**: deleting the nearest-point key as
        the spec asked brings back the grazing-lid error on the fallback only.
        Kept, documented, and held by a test.
      - **`regions` and `sketchface` read the drawing, not the faces**: their
        pixels are a tool's preview, which is on `#cv` (the spec listed them
        with the face-reading tests; corrected there).
      - **Walls skip the stencil** — a convex outline is its own fan, batched;
        only caps take the two stencil passes.
      **Found while building, left deliberately:**
      - ~~**Hidden edges show through**, as the spec said: the
        drawing-over-the-solid rule. Dimming them is still the follow-up.~~
        **Dimmed since** (hidden edges, the next item): the drawing stays on
        top, its hidden runs in a dimmed ink.
      - **The SwiftShader frame floor is ~45 ms** whichever renderer, at the
        e2e browser's 1100 × 768: rasterising and compositing two canvases in
        software. Not this package's to fix; a real GPU does not have it.
      - **No context-loss test**: a lost WebGL context is asked back and the
        next frame redraws, but nothing exercises it.
- [x] **Hidden edges, dimmed — BUILT (2026-10-22).** The follow-up every 3D
      package deferred. The drawing stays on top of the solid and picks as
      before; the part of an edge behind a face is stroked in a dimmed ink
      (the register's hidden-edge rule, after the depth rule). The e2e oracle
      became `src/occlusion.ts` and the harness imports it. Measured
      (`npm run measure:hidden`): the pass 1.2 ms a frame on the stepped
      block, 0.9 on a boss on a plate, 2.3 on a filleted full turn, against
      the faces' own 0.5 / 0.4 / 3.7 ms; `render()` 1.5 → 2.2, 1.3 → 1.8,
      4.3 → 7.5 ms; frame intervals unmoved beyond their noise. Spec:
      [`docs/plans/hidden-edges.md`](docs/plans/hidden-edges.md) (its "As
      built" has the detail); the story is `test/e2e/hidden.e2e.ts`;
      screenshots 85–88. 797 unit tests (nine new), 284 e2e (seven new). Deviations from the spec:
      - **"Behind" is measured square to the face's plane, not along the
        ray** — along it, a curve's quarter-pixel chord error is magnified by
        1/cos of the grazing angle and a strip seen edge-on hides its own
        boundary.
      - **Seams half-way between disagreeing samples** (≤ 2 px), not at a
        sample; curves' samples subdivided to ≤ 4 px like lines.
      - **Per-edge box culling** went in though the full turn was not slow.
      - **"The boss on a plate" is a new scene**; `appFrames` is shared from
        `scenes.ts`; frames were measured alternately against the previous
        build by swapping `main.ts`, the machine being shared.
      - **Pixel identity is held against a golden** the previous build drew,
        committed before the pass.
      **Found while building, left deliberately:**
      - **A hidden edge ending on the silhouette keeps ≤ 2 px of full ink** at
        that end — the seam's slack.
      - **A face within about a degree of edge-on hides only what is well
        behind it** — the price of measuring square to the plane.
      - **The golden picture is tied to the e2e browser** (pinned SwiftShader);
        a Chromium upgrade that changes Skia's rasterising fails that test, and
        the only honest re-record is from a build known to draw a plain sketch
        as before.
- [x] **A solid is opaque — BUILT (2026-11-02).** The owner: *"when you
      extrude a solid, it should look like a solid"* / *"It should be
      opaque"*. Shaded, the default, nothing behind a visible face is drawn,
      picked, hovered, dragged, snapped to or boxed; `view("hidden")` is the
      hidden-edge look, `view("wire")` no faces; the mode is viewer state;
      the body is light, its own edges dark. One `Occlusion` a frame answers
      the picture and the hand. Measured (WCAG, box from a corner, off the
      composed screenshot): faces 5.0–8.9:1 against the background (were
      1.7–2.2), 1.31–1.77:1 against each other (were 1.13–1.28). Spec:
      [`docs/plans/opaque-solids.md`](docs/plans/opaque-solids.md) (its "As
      built" has the detail); the story is `test/e2e/opaque.e2e.ts`;
      screenshots 94–97. 897 unit tests (13 new), 347 e2e (7 new).
      Deviations from the spec:
      - ⚠ **`view` is the command; the camera object is `camera`** (it was
        `view` in the scope).
      - ⚠ **A casing under light marks where faces are drawn** — not asked
        for; the sketch's ink on the light body measured 1.2–2.2:1.
      - ⚠ **Hidden ink mixes toward the faces' dark end**, not their middle,
        which with the light body sat on a frame's grey.
      - **The hidden mode draws the solid's edges dark too**; portions of
        longer lines and points keep sketch colours.
      - **`regen.e2e.ts` switches to the hidden view** before its fillet
        clicks a base corner now behind the lid.
      **Found while building, left deliberately:**
      - **`regionAt` does not consult occlusion**: a click inside a loop finds
        its region whatever is in front of or behind it. The tools that ask it
        (extrude, revolve, sketch) belong to the feature-dialog package; if a
        loop wholly behind a solid should not be clickable, that is where.
      - **The casing pass samples every edge a second time** (`inkRuns` is
        not cached between the passes). Not measured separately from the
        frame; the frame interval in the e2e browser is dominated by
        SwiftShader compositing.
      - **The regen fillet story now needs a mode switch** to reach a base
        corner from the view it was written for — the honest consequence of
        opacity; a user would orbit or switch.
- [x] **Feature regeneration — BUILT (2026-10-22).** A profile restructured
      after its feature used to leave the feature as it was (a documented
      no-op): fillet an extruded rectangle's corner and the lid stayed
      four-cornered, its edge over leg two leaning 14.9° where the leg is
      plumb, every relation satisfied. **A feature's expansion is now a
      function of its profile, and follows it**: `fillet` regenerates every
      feature on either leg inside its own call, and `regen("e1")` is the
      explicit door — a diff and rebuild that keeps every twin and wall whose
      vertex or member survives. Spec:
      [`docs/plans/feature-regeneration.md`](docs/plans/feature-regeneration.md);
      the story is `test/regen.test.ts` and `test/e2e/regen.e2e.ts`;
      screenshots 78 (before) – 80. Deviations from the spec, each also in its
      "As built":
      - ⚠ **The journal carries what was regenerated, resolved.** The spec said
        the entry stays `fillet(...)` and a replay regenerates "by running the
        same code". It does run the same diff and rebuild, but a replay runs on
        seeds, where finding a profile of free lines fails (extrude's measured
        reason) — so the call writes in what it found: `fillet(l1, l2, r,
        frame, [["e1", loops], …])`, only when a feature stood on a leg, and
        `regen("e1", [["e1", loops], …])`. Still one entry, still the call.
      - ⚠ **Format version 9**, not in the spec: `fillet` now *means* more,
        and a version-8 build would replay a version-9 fillet without the lid,
        silently. A version-8 file's fillet with a feature on a leg is
        translated to regenerate nothing (the empty list) — what its build did;
        regenerating it would claim auto-names the file's later entries hold.
      - ⚠ **`fillet` does not refuse when a feature cannot be regenerated** —
        it has already rounded the sketch, and an operation that refuses after
        changing things is the one shape `asOperation` forbids. That feature
        is left as it was (today's behaviour, for that one feature), and
        `regen("e1")` names why. `regen` itself refuses before changing
        anything.
      - **The chain** (not in the spec): a feature whose profile names a twin
        line a regeneration re-pointed — a solid extruded on the lid — is
        regenerated next, in the same call.
      - **A twin arc or circle whose ends or centre change is made again**, not
        re-pointed: the model has no primitive that re-points an arc, and no
        operation has needed one. Lines re-point (`retargetLine`), as the spec
        asked.
      - **A member in several loops parallel to the frame** takes the loop that
        keeps most of the old outline (ties refused) — the spec said only "the
        loop that now contains the feature's member".
      - **Loops keep the record's order**: an unchanged loop is the record's
        own; a changed one starts at, and walks the way of, the record's first
        surviving member (`l1,a1,l2,l3,l4`), so a no-op `regen` changes no
        pair's position.
      - **`Model.rewriteFeature`** (new primitive): a record replaced in place,
        same name and registry position, checked as `addFeature` checks.
      - *Spec text corrected:* the bug is not "a rectangle over a rounded
        base" — the lid's corner twin follows the corner to the tangent point,
        so the lid is a quadrilateral with one leaning edge; and a fillet has
        no "vanished corner" (the corner survives as leg one's tangent point,
        its wall with it), so the "relation on a vanished wall" case is tested
        with `regen` after a line drawn across a plate.
      **Found while building, left deliberately:**
      - **`fillet`'s tangent point solves ~2e-3 off its closed form** (32.002
        for 32 on a 40 × 30 rectangle, radius 8, maxResidual ~1e-7): a point
        sliding along a tangent line leaves the circle by δ²/2r, so the
        residual is second order in the slide — a pre-existing property of
        `tan` + `arcends`, not of regeneration. Tests compare twins with their
        bases (linear, exact) and absolute positions at 1e-2.
      - The chain follows re-pointed twin lines only: a hole `regen` adds to a
        lid does not reach a solid already on that lid until that solid is
        `regen`'d.
      - A fillet on a *lid* corner regenerates the features standing on the
        lid, not the feature that owns it (a lid is not a profile) — and
        conflicts with that feature's depth, as it always did.
      - Nothing regenerates on its own after a hand restructuring (a line
        drawn across, a coin added): that is `regen`'s, by the spec's rule —
        not on a solve, a drag or a `set`.
- [ ] **Face-on arcs snap as their whole circle** — parked decision from
      phase 3, measured consequence recorded there.
- [x] **Saving user-authored tools** — done (2026-09-03), on format version 4
      without bumping it: an optional `tools: {name, source}[]` beside the
      journal, captured by a wrapper around `defineTool` in `replenv.ts` from
      the entry the evaluator publishes as `repl.entry`. Spec:
      [`docs/plans/tool-source-in-files.md`](docs/plans/tool-source-in-files.md).
      **Found while building, left deliberately** (each documented in the plan
      and pinned by a test): a tool defined asynchronously *after* its entry
      returns is not captured, because there is no entry in flight to capture;
      a carried name that is already registered gets no "paste it" line, since
      that sentence would not be true of it; and re-defining a tool replaces
      its stored source rather than keeping a history. A source is stored per
      name, so two tools defined in one entry each store that whole entry —
      correct, and mildly surprising if you paste both.
- [ ] **~~Inference while dragging~~ — re-scoped down, near-wontfix.** Checked
      against the guiding rule before speccing: Onshape does *not* commit
      constraints during a drag — dragging moves geometry, and inference
      belongs to placement clicks. So the original framing was a deviation
      dressed as parity. What could still exist someday: a mid-drag *soft*
      snap of the drag target (position only, nothing committed). Low value
      next to everything else; parked.

With the context menu shipped, nothing else is queued — the next package needs
a direction from the owner. Discovered while building it, and worth a package
of its own someday: **the menu's items are hard-coded per pick kind**, so a
relation or tool added at the command line cannot put itself on one. That is
the same shape as "tools are not privileged", and a menu that could be
extended the way `defineTool` extends the tool registry would close it.

## Smaller things

- [ ] **Found while building `organiser.md`** (each deliberate, written down
      so it is a decision and not a rediscovery):
  - A group holding *most* of a solid gets none of a regeneration's new
    pieces — the rule asks for groups that held everything it made.
  - The organiser's rows are flat, in creation order: no sorting, no
    dragging a row, no nesting (that last on purpose). The typed objects
    (regions, chains, solids) are not sections yet.
  - The pane re-reads the model every redraw and rebuilds only on a change,
    compared as JSON — not measured past tens of groups.
  - `● g1` beside the status never fades; in a phone's landscape layout it
    lies over the left end of the command line's strip.
  - Whether iOS keeps its own long-press callout off a row is only an
    iPhone's to show (`-webkit-touch-callout: none` is set).
- [ ] **Found while building `select-hand.md`** (each documented in the
      spec's *As built*):
      - **Thirteen buttons do not fit beside a pane across a landscape
        iPhone.** A 599 px line (a finger's 44 px pitch) turned to a row on
        the right edge leaves 151 px of a 750 px area, less than a log's
        least width (160): docked so, the log overlaps the row by 9 px and
        nothing reports it (the resolver says no layout exists, which turns
        the dev build's overlap check off). Every new built-in tool makes
        this worse. A fold or a second line is the owner's call — he vetoed
        wrapping (`tray-fixed-line.md`); a shorter least width for the log
        would only move the edge.
      - **In Safari's page a phone's portrait column runs past where an
        edge-to-edge command line starts**; the default now starts the line
        right of the column there. The installed app is unchanged. Worth
        the owner's eye in Safari, not installed.
      - **The owner's iPhone list**: the Hand with one finger over a line
        (the drawing goes with the finger, the line does not move); Select
        lit after a finished point and after the strip's Cancel.

- [ ] **Found while building `chrome-logo-scale.md`** (each deliberate and
      documented in the spec's *As built*):
      - **The owner's iPhone list**: the drawing to the glass with nothing
        under the status bar blurred (after removing the icon and adding it
        again — iOS reads the status bar style when the app is added); the
        command line docked to the bottom, and the keyboard it raises not
        covering it (iOS should scroll the field into view; if not, drag it
        to the top); the interface's 100 % at his Dynamic Type setting;
        `layout()`'s window and insets read off the phone.
      - **A strip's 44 px hit box reaches up over the drawing** (~23 px at a
        phone's 100 %): a tap on geometry just above a panel's strip moves
        the panel. Into the panel would steal the log's scrolling and the
        command line's field. Revisit if it bites.
      - **The tablet factor (1.15) and its 600 px boundary** are reasoned,
        not measured on an iPad.
      - **The status sits over the command line's strip in landscape** until
        it fades (3 s); a conflict stays over it. A status that moved out of
        the way of panels would be the next step.
      - **A pane docked against a tray that turned in a rotation** keeps its
        side against it and is held overlapping it by a pixel at least — it
        can end up hanging off the tray's corner (the rotation e2e's
        landscape picture). A rule for re-aligning along a turned tray is
        not designed.

- [ ] **Found while building `files.md`** (each deliberate, documented and,
      where it can be, tested):
      - **The owner's iPhone list** (CHANGELOG, the files entry): the Files
        picker offering a `.zerocad.json`, Save to Files writing one file,
        AirDrop/Messages, a drawing back after the app is closed, Safari and
        home-screen storage apart or not, the dirty question in the
        home-screen app, a dismissed sheet.
      - **One autosave slot per device**: two windows both write it and the
        last change wins. A per-window slot would need a way to choose
        between them at start; not worth it until someone has two windows.
      - **Undo across an open or a new restores the drawing, not the name or
        the handle.** The document is then dirty against the file it names,
        which is honest; making the name an undo step would mean the undo
        stack holding more than the model.
      - **A refused restore (a newer build's drawing) pauses autosave for the
        session**, so that copy is not overwritten; work drawn meanwhile is
        not autosaved until `newFile()` or an open. Said in the log.
      - **`saveFile()` holds `submit`'s undo bracket open while it awaits a
        picker or the sheet.** Both are modal, so no pointer edit can land
        inside it; if a browser ever made one non-modal, an edit made during
        it would join that bracket's step.
      - **When the app menu lands**, its host object takes
        `document: () => files!.document()` in `main.ts`.
      - **Not done: `share_target`** (receiving shares) on Android Chrome,
        which has it — the owner's devices are an iPhone and a desktop.

- [ ] **Found while building `explicit-regions.md`** (each deliberate,
      documented and, where it can be, tested):
      - **"Inside the outline" is geometric, not only the containment tree**
        (`within` in operations.ts, `insideLoop` in loops.ts). The tree keeps
        a loop's smallest container, so in the fixture a revolve's end face
        overlapping the plate was a recorded hole's parent and the hole read
        as outside its own outline. Found by the older-file test, fixed.
      - **An island whose hole's loop has gone becomes a hole by even-odd**
        when `regen` drops the hole (its own loop still kept). `unhole`, `del`
        and a construction flag drop the islands inside a hole with it; a
        regeneration cannot tell what was inside a loop that is no longer
        there. `unhole` the island.
      - **A tie** — two loops inside the outline keeping as much of a recorded
        hole (a line drawn across a hole circle) — refuses the regeneration,
        as the outline's tie does. `unhole` and `hole` again.
      - **A fillet's regeneration fills a gone hole silently**: the note
        (`e1: hole c1 is gone, filled`) is printed by `regen`, `hole` and
        `unhole`; fillet's line says nothing of it.
      - **Deleting a hole's twin or wall** (something the feature made, on
        the lid) still takes the record, as deleting anything a feature made
        always has; deleting the hole's own sketch circle or corner fills it.
      - **The edit dialog's value is remembered** like any tool option, under
        `edit extrude` / `edit revolve` — harmless, since `edit("e1")` always
        arms with the feature's own value.
      - **Hovering a picked region's hole in the creating dialog outlines the
        hole's own region**, as if a click would pick it; the click toggles it.
      - **The creating dialog still lights loops under a solid's lid** as
        candidates (`regionAt` does not consult occlusion — construction.md's
        note).

- [ ] **Found while building `construction.md`** (each deliberate, documented
      and, where it can be, tested):
      - ~~**A profile member cannot be made construction**~~ — **revisited
        by explicit-regions (2026-11-04):** a *hole's* member made
        construction fills the hole (the loop has gone, as a deletion does);
        an *outline* member is still refused, because the outline's going is
        a deletion. Tested.
      - ~~**Clearing the flag regenerates nothing by itself**~~ — **and now
        it never will**: under explicit membership a circle made real inside
        an extruded outline joins nothing, `regen` included; `hole("e1",
        "c1")` (or *Add as hole to e1*) adds it. Tested, unit and e2e.
      - **`construction("e1")` flags the twins and walls the feature made
        *then*.** A later regeneration keeps the twins whose vertex survives
        (flag and all) and makes any new one real.
      - **A fillet with one construction leg makes a real arc**; with two,
        a construction one (tested).
      - **The typed constructors take no flag** (`circ`, `ln`, …): type
        `construction(c)` after, or arm a tool with the option.
      - **A tool's preview is drawn in the armed amber** whether or not the
        `construction` box is ticked; only the committed shape is muted.
      - **A drawing tool's options panel now always shows** (one checkbox),
        where before only feature tools had one.
      - **Construction geometry is quiet as any entity is**: a construction
        line's ends are quiet corners in the shaded view, like any line's.

- [ ] **Found while building `quiet-geometry.md`** (each deliberate unless it
      says otherwise; the spec's As built has the reasoning):
      - **Hidden outranks revealed** (`entityDrawn`): a reveal brings back
        what is quiet, never what the user hid. Nothing hidden picks, so the
        case is a selection, snap or drag made before a `hide`.
      - **A lid frame's own points are drawn** where the sketch frame stands
        off the profile (a fixture frame, a `plane()` elsewhere): they end no
        line, and nothing is quiet because a feature made it. A sketched
        outline's lid frame stands on its corner twins
        (`lid-frame-shares-points.md`), and its lid is clean — checked by the
        plate test, which no longer skips any corner for a loose point.
      - **A frame marker drawn from a corner** keeps its arms, letters and
        name there: frame markers stay. The plate test reads no dot or name at
        the two corners a frame stands on.
      - **A quiet glyph is still picked** (and drawn while hovered): reached
        from its line, it would otherwise be unreachable (5 px pick, box 7 px
        out). It is an invisible target until hovered, like a quiet corner.
      - **No silhouette lines** on curved walls (a cylinder's sides, a hole's
        wall seen obliquely), and **no line where two solids interpenetrate**:
        neither is any face's side. Shading carries both today.
      - **The face line is drawn in the hidden view too**, under the entity
        pass's own dark ink on the same edges: harmless, not needed.
      - **`engine.armedUnder` is a second `pickAt` per pointer move** while a
        tool is armed (the snap is the first). Not measured; it is the same
        work the unarmed hover does.

- [ ] **Found while building groups, phase 1** (`docs/plans/groups.md`; each
      deliberate unless it says otherwise):
      - **Hiding a solid's sketch takes the solid's base edges with it.** The
        profile lines *are* the solid's bottom outline — the flat model's
        point — so with the sketch hidden the faces stand without their dark
        edge along the base (look at `groups-3-sketch-hidden.png` from the
        e2e). Onshape draws a part's edges apart from its sketch; here they
        are one entity. Drawing a hidden profile member as a solid edge while
        its feature is shown would be the fix, if the owner wants it.
      - **`hide("e1")` flattens at the call**, like every set argument: a twin
        a later regeneration makes (a fillet on the profile) is not hidden.
        The faces follow the feature's name, so they stay hidden; only the new
        edge shows. `hide("e1")` again picks it up.
      - **A region bounded by anything hidden is not offered** — not lit by a
        click-inside tool, not clickable (`regionAt`), even when a visible loop
        further out holds the click. The innermost loop decides, as always.
      - **A constraint's mark is not drawn when anything it constrains is
        hidden**, except a feature's own dimension (an extrude's depth), which
        is the solid's and goes with `hide("e1")`.
      - **`sel()` lists names**; regions selected on the canvas are part of the
        selection (one highlight, one clear) but are not named, so
        `select(...sel())` drops them.
      - **Arming any tool spends the whole selection**, names as well as
        regions (it used to spend only regions, because there were only
        regions). A tool that could start from selected lines — the fillet —
        is a later package.
      - **A drag moves the entity grabbed, not the selection.** Rigid groups
        (phase 2) are how a set moves as one, and are a relation, not a drag.
      - **The Delete key is never taken from a focused text field, even an
        empty command line** — found when Playwright's `fill("")` sent a Delete
        to an empty line and deleted a test's geometry. A click on the canvas
        blurs the line, so the key is the drawing's exactly when the hand was
        just there; a selection made by typing `select()` is deleted by typing
        `del(...)`, or by clicking the canvas first.
      - **Group names share the namespace**, so a group cannot be called `p1`
        while there is a `p1`, and `has("g1")` is true — `del("g1")` meant
        nothing before, so nothing that worked changed meaning.

- [ ] **Found while building `feature-dialog.md`** (each deliberate unless it
      says otherwise):
      - **A region bounded by a crossing no point marks, every member of it
        shared, is not typed.** The confirm calls `extrudeProfile` /
        `revolveProfile` for it — the same journal entry, reported as
        `e1  extrude of …`, but no `> extrude(…)` line in the log. No typed
        line can name it: a typed profile names points and a crossing is a
        key until an extrude makes it one (the lens of two circles, both
        halves of a rectangle with a line drawn across it before either is
        extruded). Closing it needs a typed form for "the region at this
        point", which the spec ruled out by keeping the typed commands as
        they are. Tested (`regions.e2e.ts`'s lens).
      - **The preview rebuilds the whole model** (`save`, `open`, the lines,
        a solve) each time the picks, the values or the model change — never
        per frame. Measured at 6.5–10 ms for a 97-entity model (24 ms the
        first time); it grows with the journal, so a model of thousands of
        entities would feel it on every keystroke in the depth field. A cheaper copy (cloning the problem's variables rather than
        replaying the journal) is the fix if it ever shows.
      - **The preview is drawn over the drawing, not depth-tested against the
        solids already there**: a lid previewed behind an existing solid shows
        through it. Its faces are sorted far to near among themselves. The
        opaque-solids package owns occlusion; the preview should follow it.
      - **Enter confirms only with the command line empty** (or the focus on
        no text field): text there is an entry, and wins.
      - **Preselection is regions only.** A click on an entity with nothing
        armed still drops its name into the command line, as it always did;
        an entity selection for fillet (select two lines, then hit fillet) is
        not built.
      - **The fillet preview shows the arc, the trimmed legs and whatever is
        new** (the lid's twin arc, its new wall) — not the regenerated lid's
        faces, which belong to a feature that already exists.
      - **A preview refused (a radius too large for the corner, an axis that
        crosses the profile) is said once as guidance** and ✓ stays off; the
        picks stay, so the value can be changed instead.

- [ ] **Found while building `tool-options.md`** (each deliberate unless it
      says otherwise):
      - **No command forgets a remembered value.** Typing the default back
        (`arm("extrude", { depth: 10 })`) is the way; `layout("reset")` puts
        the panels back but leaves the values. A `resetOptions()` or a
        per-row "default" affordance would be small.
      - **Remembered on arm, not on use.** Arming with 25 and releasing the
        tool without extruding still makes 25 the next default. Onshape
        remembers what a feature was made with; the difference shows only
        when someone arms, changes their mind, and leaves.
      - **Editing a field mid-gesture drops the gesture.** The edit re-arms
        the tool (it types `arm`), and arming cancels: a fillet's first line,
        a revolve's chosen profile. Carrying the gesture across a re-arm of
        the same tool would need the engine to update `ctx.options` in place.
      - **An angle reads in radians** (`rad`, a whole turn 6.283185), as
        `revolve` and `set` take it; the dimension labels read degrees. The
        open degree-input question in "Decisions needed" covers this too.
      - **A tool armed with options it does not declare gets no panel** —
        `arm("point", { radius: 4 })` still hands them over unread, as before.
      - **A refused panel edit is red.** Typing 0 into the depth field types
        `arm("extrude", {depth: 0})`, which is refused like any typed line,
        in the log's red, and the field goes back to the armed value. The
        panel could check before typing, but then it would be a second
        answer to what `arm` accepts.

- [ ] **Found while building `no-refusals.md`** (each deliberate unless it
      says otherwise):
      - **Hidden faces are lit too.** The extrude/sketch tools light every
        loop `findLoops` sees; a box's far walls and base are lit through
        its lid, faintly. An occlusion test (occlusion.ts already has one)
        would light only the faces a click could actually land on.
      - **An abandoned curve gesture keeps its typed plane.** The plane is
        made at the first click so later clicks land on it across an orbit;
        Escape after that click leaves the frame (one Ctrl+Z, as a typed
        line would). A circle press with no drag likewise.
      - **The frame a curve tool makes shows its refs as points** beside the
        circle (`frame()`'s seeding: two free points a span along the screen
        axes). Honest — they are the frame's datum points — but clutter for
        a newcomer who never asked for a frame. The same for a typed `circ()`
        in a fresh model: three points and a marker appear at the view
        centre (picking.e2e.ts's box select had to move out of their way).
      - **The fillet tool still logs nothing on success**, where extrude and
        revolve log what they made (`"done"`).
      - ~~**`main.ts`'s toolbar-host comment** still says a curve tool greys
        out~~ — rewritten by `tool-options.md`, which removed the wiring too.
      - **Fillet lights nothing.** Revolve lights its candidate axes; fillet
        could light the lines that share a corner with the first one chosen.
      - **The operation's own words still reach a guidance line** where the
        tool cannot say it shorter: fillet's "radius 10 is too large for this
        corner (needs …)", extrude's "the loop … is edge-on to the view …",
        a profile no plane can be made of. Muted, but longer than ~12 words.
      - **Guidance repeats.** Five misses are five log lines; the header note
        shows only the last.
- [ ] **A held panel that slides clear of what stopped it jumps to the
      hand.** With the grasp point fixed (owner, 2026-10-27), a panel stopped
      short by a chain and then moved along the other axis past the chain's
      end catches up the whole lead in one event; likewise a tray turned
      against a bottom or right edge comes back under the hand on the next
      move. Both are the rule as asked for. If the owner finds the jump
      jarring, one way to soften it would be an easing in the DOM half,
      leaving the pure half saying where the panel belongs. Untried.
- [x] `docs/plans/` specs that have shipped gain a one-line "shipped" note
      at top rather than being deleted — they are the design record.
- [x] **A relation added from the command line leaves the header stale.**
      Fixed: **a command entry that changed the model re-solves through the
      host**, the way tools, drags and `del` already do. The worry that it
      would need an enumeration of which commands are edits turned out to be
      unfounded — the undo bracket already computes exactly that answer by
      comparing the snapshot before the entry with the snapshot after, so
      `endUserAction` now returns it instead of swallowing it. `ls()` and
      `help()` provably do not solve; a contradictory `rad()` flips the header
      to `CONFLICT` on the keystroke that caused it. Pinned by
      `test/e2e/livesolve.e2e.ts`, which counts solves in the page.
- [x] **A constructor refused for its name strands its auto-created points.**
      Found while building 3D frames, and older than them: `addLine`,
      `addCircle`, `addArc` and `addFrame` created their missing points
      (unjournalled, by design) *before* `claimName` checked the name, so
      `addLine(null, null, "a.b")` threw with `p1` and `p2` left in the
      model and nothing in the journal — points that vanished on save/open and
      advanced the `p` counter in a way a replay would not reproduce.
      **Fixed** (`docs/plans/no-stranded-points.md`): every refusal now runs
      before the first effect, and the name is claimed — `claimName` checks
      then claims in one call, refusing before it moves any counter — as the
      last refusal and the first effect, through one helper (`claimFirst`)
      all four share. **Measured**, a refused call by name, before → after:
      `addLine` 2 → 0 points, `addFrame` 2 (2D) / 3 (3D) → 0, `addCircle`
      1 → 0, `addArc` 3 → 0; a session and its own file now agree on every
      entity and on the next auto-name (they differed by 8 points in 2D and 9
      in 3D after one refusal of each). `test/stranded.test.ts`, 53 tests, 20
      of which fail on the old order; every successful call's journal entry
      is pinned by hand and unchanged, and `persist.ts` was not touched.
      *Deviation, deliberate:* a constructor given an explicit name in the
      `pN` pattern that one of its own auto-points would have taken —
      `addLine(null, null, "p2")` when the counter stands at 1 — used to be
      refused as `"p2" already exists`, for a point the user never made. The
      claimed name is now held aside while the points are made, so it
      succeeds with endpoints `p3`, `p4`, as auto-names step around any taken
      name. No call that succeeded before gets different names (the hold
      only moves an auto-name that would have landed on the claimed one, which
      is exactly the old refusal), and such a call replays identically.
      *Not touched:* anything above `model.ts`.
- [ ] *Noted, not caused by anything new:* **in 3D, a far-off point held by
      `on` to a line whose ends still have a long way to travel can stall**
      when one more constraint picks a single spot on that line. `on`'s
      residual is a wedge, whose scale grows with the point's distance, so
      least squares can settle for violating the line's `fix`es instead —
      measured at p ≈ 1800 units out with the fixes off by 2.5. Found writing
      `onPlane`'s intersection test, and **not `onPlane`'s doing**: with a
      second plain `on` (a fixed line through the same answer) in its place
      the system stalls too, from a seed `onPlane` survives — each fails from
      a seed the other converges from. The 2D analog converged from both
      seeds tried. Seeded with the line near its pins, it converges in 5–8
      iterations. Same family as the register's note that a wedge is
      quadratic in the drawing's size; normalising `on` (dividing by the
      line's length, as `tan` does) is the obvious thing to try, and would
      need its own measurement.

- [x] **The toolbar does not grey out the curve tools when they cannot run.**
      In a 3D model with no default frame the context menu shows circle, arc,
      circle3, arc3 and fillet disabled with `resolveFrame`'s reason; the
      toolbar arms them, and the first click is refused in the log ("no
      default frame — frame() then setDefaultFrame()…"). Loud and correct, but
      the menu's answer is better, and a newcomer following the empty-canvas
      hint is the person most likely to pick "circle" first. `curvesNeedAFrame`
      is private to `menu.ts`; sharing it is the natural shape.
      **Fixed** — the rule moved to `src/toolavail.ts`, the menu and the
      toolbar host both read it, and a disabled button carries the reason as
      its hover text. See Done.
- [x] **A moved or turned tray wraps a new tool rather than growing.** An
      untouched toolbar is sized from its defaults, so `defineTool` grows it;
      once the viewer has moved it — or turned it, which sizes it to its
      content at that moment — its stored rectangle is what is shown. ~~A new
      tool's button scrolls into view~~ — since the tray wraps (2026-10-29) it
      goes into the tray's lines instead, always shown: but a moved *one-line*
      tray gains a second line holding the one new button rather than growing
      a button longer. The fix, when it matters, is still storing whether the
      length was the viewer's (a grip) or the content's (a turn, the defaults)
      and re-sizing only the latter; the wrap spec kept the stored shape
      unchanged, so it was not done there.
      **Fixed** (2026-10-29, tray-fixed-line): a tray's length is never the
      viewer's any more, so there is nothing to tell apart — `arranged` ignores
      a stored tray size and re-sizes from the count on every `apply`, and a
      moved row gains a button's length, pushing what it reaches (unit and
      e2e).
- [x] **The resize grip sits over the last button's corner.** On a tray one
      button thick the 12 px grip covers the bottom-right of the last button
      (column) or its right end (row); the button's middle is still its own,
      and was before icons (the labelled column had the same overlap). A
      tray-specific grip, or a few px of room at the run's end, would clear it.
      **Fixed in passing** (2026-10-29, panels-corners-wrap): the four grips
      are clipped to the triangle in their corners, which over a corner
      button is a 4 px tip of its (rounded) corner.
- [x] ~~**A tray's grip cannot set its depth.**~~ Moot (2026-10-29,
      tray-fixed-line): a tray has no grips and no wrap — *"get rid of resizing
      altogether on the tool palette"*.
- [x] ~~**A tray against a wall cannot wrap toward it.**~~ Moot, the same
      way: nothing wraps.
- [ ] **A grip's triangle takes the corner of whatever it covers** — the first
      pixels of the log's "log" label, the corners of a strip. The strip keeps
      its middle, and nothing has been hard to grab in the e2e runs. Since
      2026-10-29 the grip draws nothing, so this is a corner whose cursor
      changes before anything there is seen to; and since the tray has no
      grips, only the log's and the command line's corners have one.
- [ ] **A grip is found by its cursor alone** (the owner: *"you dont need
      those diag lines on every corner"*). Nothing marks a corner as
      resizable until the pointer is on it — the owner's call, and the
      platform's own window corners work the same way. If it proves
      undiscoverable, a mark on hover only would be the smallest step back;
      not done, since he asked for none.
- [ ] **A tray longer than the window is clipped at its edge.** `constrain`
      holds it inside, shrunk to the window, and `#toolbar`'s
      `overflow: hidden` cuts off the buttons past the edge, which are out of
      reach until the window is taller (or the tray is turned the other way).
      Eleven tools need 264 px; a window that short is not one anyone draws in,
      so the spec said not to design for it, and nothing is. Unit-tested (the
      clip, still wholly inside).
- [ ] **A glyph is keyed by name, like availability.** A command-line tool
      that re-registers `circle` keeps the circle's glyph (and its
      availability rule, below); one under any new name gets the generic
      glyph. Deliberate — see `src/tools/icons.ts` for why a static on the
      class would be worse — and tested.
- [x] ~~**The tool-availability rule is keyed by name.**~~ Moot since
      `no-refusals.md`: the rule greys nothing, by name or otherwise. Kept
      below as it was, for when a rule comes back. `toolUnavailable`
      greys out whatever is registered as `circle`, `circle3`, `arc`, `arc3`
      or `fillet` — so a tool defined at the command line under one of those
      names (`defineTool("circle", …)`, replacing the built-in) is greyed
      without a frame on the toolbar and the menu alike, even if it builds
      nothing curved. A tool under any *new* name is never affected (unit
      test). Left deliberately: telling a built-in from its replacement would
      mean the rule knowing tool classes, and nobody has redefined a built-in.
      The natural fix, when it matters, is a tool declaring what it needs
      (`static needsPlane = true`) and the rule asking the registered class.
- [ ] **A free line held only by `par` and `on` collapses to zero length.**
      `l = ln(); par(l, xaxis()); on("p1", l)` (or its clause form) solves
      `SOLVED` with both endpoints on one spot: a zero direction satisfies a
      wedge trivially, and nothing pins a length. Measured while building
      clauses; pre-existing, and the same family as the register's notes on
      degenerate residuals. A length (`eq`, or `dist` on the ends) avoids it.
      Whether the solver should refuse a collapsed line, or `on`/`par` scale by
      the line's length, needs its own measurement.
- [ ] **A clause in the wrong slot is caught only after the entity is made.**
      `circ(oncircle(_, "p1"))` — the subject where the point goes — makes the
      circle and then `onCircle` refuses (the spec itself wrote it this way).
      The slot lists in `replenv.ts` already name each slot `point`, `line`,
      `circle`…; a pre-check comparing the subject's kind with its slot would
      refuse before anything is made. Left out deliberately: the spec says the
      relation's refusal is not second-guessed, and generic slots (`dist`'s
      `a`/`b`, `par`'s line-or-point-or-axis) would need a kind language of
      their own. The owner's call if the mistake turns out to be common.
- [ ] **`tan` from a seed through the circle's centre conflicts.** `line()`
      seeds at the middle of the view; with a circle centred exactly there,
      `tan(t, "c1"); tan(t, "c2")` ends in CONFLICT rather than choosing a side.
      Measured in the free-line e2e test (now moved off the seed). Same family
      as the register's notes on seed-sensitive residuals; a seed nudged off a
      centre, or `tan` picking a side at zero distance, would need its own
      measurement.
- [ ] **Panel positions are absolute pixels from the top-left.** A moved
      panel stays put when the window grows (an untouched one follows its
      default, which is anchored to the bottom edge). Anchoring a moved panel
      to its nearest edge would fix it; not needed until someone resizes often.
- [ ] **A window too small for every panel leaves one over another.** The
      resolver pushes and never shrinks, so when the panels at their sizes
      cannot sit side by side in the area (`settled` returns `ok: false`), the
      last one placed is left over its neighbour rather than pushed out of the
      window. Shrinking panels toward their minimums to make room would close
      it; the e2e window is far from it, and nobody has hit it.
- [ ] **A pushed tray keeps its way.** Only the dragged tray turns; one pushed
      flush against an edge by another panel stays a column (or row). Turning a
      pushed tray would mean a push changing a panel's shape mid-chain, which
      the resolver's flush arithmetic assumes does not happen.

## Done

- [x] **The organiser: groups you can see, open, and draw into** (2026-11-04).
      The owner: *"there needs to be a group pane I think, and the ability to
      e.g. create a new group and "open" the group, which means any entities
      which get created become a part of that group."* Spec:
      [`docs/plans/organiser.md`](docs/plans/organiser.md), marked built,
      every deviation in its *As built*. `src/organiser.ts` (new); the open
      group in `model.ts` (`openGroup`, `place`, `withoutOpenGroup`,
      `setOpenGroup`, `renameGroup`) and `groups.ts` (`opengroup`,
      `closegroup`, `rename`, `group()` empty); regeneration's group rule in
      `operations.ts`; format 12 and the version-11 translation in
      `persist.ts`; the commands, `ls()` and `help()` in `replenv.ts`;
      `Panels`' `hiddenAtFirst`; the pane in `index.html` and `main.ts`.
      1109 unit (1094 before; `test/organiser.test.ts` 15), 473 e2e (463
      before; `organiser.e2e.ts` 10), `npm run test:all` green.
      **Deviations, in short** (in full in the spec): old files are
      translated (an `ungroup` written in), not marked; the pane starts
      hidden on a phone, and a desktop's is bottom-right; a regeneration's
      new pieces join the groups that held the whole feature, not "the groups
      the entity they twin was in"; `rename(g, name)` is new and only for
      groups; the ＋ types `opengroup(group())`; only entities join; the
      status says `● g1`; the eye has a partial state; the long-press is the
      pane's own timer; the ＋ sits over the strip's corner grip; `del` lists
      no emptied group. One correction to `groups.md`: its cascade never
      journalled an emptied group's going.
- [x] **Select and Hand tools, first on the toolbar; Space a temporary
      hand** (2026-11-04). The owner: *"there is no hand/selction tool.
      would be nice since a lot of people are used to that"*. Spec:
      [`docs/plans/select-hand.md`](docs/plans/select-hand.md), marked built,
      every deviation in its *As built*. `tool.ts`'s `SELECT`/`HAND`/
      `toolbarTools()`; the engine's `putDown`, `hold`, `lit`, the Hand's
      press (mouse and finger) and its cursor; two glyphs in `icons.ts`;
      Space, the toolbar's list and lit button, the Hand through an undo in
      `main.ts`; `ActionState.hand` and the phone's portrait default in
      `panels.ts`; `tools()` and `help()`. Unit 1104 (1094 before;
      `test/selecthand.test.ts` 9, `touchlayout.test.ts` +1); e2e 471 (463
      before; `selecthand.e2e.ts` 8). **Deviations, in short**: the two are
      the engine's, not registry tools; Space overlays the armed tool rather
      than disarming it, and is skipped for any focused field or button, not
      only the command line; Select and the Hand keep the selection; the Hand
      survives an undo; a grab cursor; bare `select` arms Select; in Safari's
      shorter page the portrait command line starts right of the column;
      `chrome.e2e.ts`'s rotation test docks the action strip, since a
      13-button row and a log no longer fit across a landscape iPhone.

- [x] **No title bar: a logo over the drawing, each device's own interface
      size, panels to the very edge, docking through a rotation**
      (2026-11-04). The owner, from his iPhone, and three amendments (the
      dropdown and its spin box, panes shown and hidden, docking kept
      through a rotation, each device's 100 %) and the manager's status-bar
      item. Spec: [`docs/plans/chrome-logo-scale.md`](docs/plans/chrome-logo-scale.md),
      marked built, every deviation in its *As built*. `src/logo.ts`,
      `src/uiscale.ts`, `src/statusline.ts`, `src/appmenu.ts` (new);
      `panels.ts`'s `touchMetrics`, `bleed`, the fixed logo, `dockingOf`/
      `recorded`/`relaid`, storage v3 with the v2 migration, `setMetrics`/
      `panes`/`setShown`; `View.ui`; `ui()` in `replenv.ts` (not journalled,
      so nothing in `persist.ts`); `index.html`'s page, logo and hit areas;
      `scripts/icons.ts` writing `icon.svg` from the logo; the status bar
      `default`. 1094 unit (1056 before, the files package's among them;
      `test/chrome.test.ts` 21), 463 e2e (435 before; `chrome.e2e.ts` 16).
      **Deviations, in short** (in full in the spec): a tray's buttons are a
      44 px target apart, so the column is slim but as long as before; a
      strip's 44 px hit box reaches out over the drawing; fields keep 16 px
      type under a finger; phone menus drop the command hints; the logo is a
      fixed panel in the layout; a tray that no longer fits its edge after a
      rotation turns, keeping the edge; `-apple-system-body` is read only
      under a coarse pointer (macOS has it at 13 px).

- [x] **A feature's region is explicit — an outline and the holes you said**
      (2026-11-04). The owner: *"there should be some kind of relationship
      between the loops > region > extrude"*; *"I don't think coplanarity
      should be used as an automatic basis for deciding which entities to
      include in a region"*. Spec:
      [`docs/plans/explicit-regions.md`](docs/plans/explicit-regions.md),
      marked built. `featureRegion`, `refoundProfile`, `hole`, `unhole`,
      `holesGoing` (del and construction), `within`, `profileOfLoops`,
      `depthBelow`, `loopLabel` in `operations.ts`; `insideLoop` in
      `loops.ts`; `hole`/`unhole`/`edit` and the regen notes in `replenv.ts`;
      `hole`/`unhole` in `persist.ts`'s table (no format bump); the menu's
      *Add as hole* / *Remove hole* / *Edit e1*; `src/tools/edit.ts` (new);
      `RegionSelection.toggleHole`/`without`, `leftOut`; the extrude and
      revolve tools' toggle; `ToolContext.target`/`planeAt`,
      `Tool.replaces`, `defineTool(…, { listed: false })`, `engine.arm`'s
      target; the faces' `skip`. 1018 unit tests (1000 before; `test/explicitregions.test.ts` 17), 418 e2e (414 before; `explicitregions.e2e.ts` 4). **Deviations from the spec:**
      - ⚠ **The journal's list is `regen`'s shape**: `hole("e1", "c1",
        [["e1", loops], …])` — feature and loops pairs — not the bare loops
        list the spec's example shows, so a chained regeneration rides in the
        same entry exactly as it does in `regen`'s.
      - ⚠ **`hole` and `unhole` regenerate as `regen` does** (the outline
        re-found, the holes by their members) and then add or take the one
        loop, so a recorded hole since gone is filled on the way and said.
      - ⚠ **`unhole` takes the recorded islands inside the hole too** — with
        the hole filled, even-odd would have made them holes.
      - ⚠ **`del` of a hole's member is journalled as `unhole(…)` then the
        deletion's primitives** (the deletion is still its expansion); a
        hole's corner point, which takes its wall, fills it too.
      - ⚠ **A hole's member made construction fills the hole** — the decision
        the brief left open, in the register (vetoable). The outline's
        refusal now says *outline*, not *profile*.
      - ⚠ **`edit` is a command and not an operation**, like `arm`: it
        journals nothing, so it is in `replenv.ts` and not in the replay
        table; what it types (`hole`, `unhole`, `set`) is in both.
      - ⚠ **Two dialogs, `edit extrude` and `edit revolve`**, unlisted (off the
        toolbar, out of `tools()`), because a tool's options are declared per
        class and the panel's value is a depth for one, an angle for the
        other. The feature is the tool's **target** (`engine.arm(name,
        options, target)`, kept across an undo's re-arm), not an option:
        options are numbers and flags a viewer remembers.
      - ⚠ **In the edit dialog the "second click" is a click on the region
        itself** (outside every inner loop); a click on an inner loop toggles
        it. ✓ with nothing changed closes the dialog. The clicks are read on
        the feature's sketch plane (`ToolContext.planeAt`), under the lid —
        `regionAt` answers with the lid in front.
      - ⚠ **The solid steps aside for its edit preview** (`Tool.replaces`, a
        `skip` set through `visibleFaces`, `facesToDraw`, `paintFaces` and the
        face layer): drawn under the preview, the solid as it is hid a hole
        being cut.
      - ⚠ **Revolve's creating dialog toggles holes too**, by the same
        selection.
      - ⚠ **The e2e opens the circle's menu in `view("hidden")`**: under the
        opaque lid it cannot be picked shaded (construction.e2e.ts does the
        same).
      - Spec text corrected: none of its claims about the code were wrong;
        the `del` cascade it asked to check took the whole record (the solid
        lost its faces), as it suspected, and now fills the hole.

- [x] **Construction geometry — a per-entity flag** — the owner: *"construction
      geometry should be a per entity flag. at least based on the name
      "construction geometry" it implies per entity"*, and *"if it is a group
      based inherited thing, then geometry could be both construction geometry
      and not construction geometry simultaneously"*. Spec:
      [`docs/plans/construction.md`](docs/plans/construction.md), marked
      built. `construction?: true` on lines, arcs and circles with
      `isConstruction`/`setConstruction` in `model.ts`; the `construction`
      operation in `operations.ts`; `collect` in `loops.ts` leaves them out;
      the op in `replenv.ts` and `persist.ts` (no format bump); `ls()`'s
      `(construction)`; `help()`; the hover tag; *Construction* / *Not
      construction* on the menu (an entity, a selection's curves); thin muted
      teal in `main.ts`; `DRAWING_OPTIONS` on the six drawing tools. 992 unit
      tests (973 before; `test/construction.test.ts` 19), 405 e2e (398
      before; `construction.e2e.ts` 7). **Deviations from the spec:**
      - ⚠ **Journalled with the curves it changed resolved**, not as typed as
        `hide` is — the owner's second remark: the entry names entities, so
        no later reading of a group can enter into it.
      - ⚠ **`construction(...names, false)`** chosen over `real(...)`: the
        flag is a value, as the tools' `{ construction: false }` is.
      - ⚠ **Points, frames and relations are passed over**, not refused; only a
        call with no curve in it is refused. The log names a point or frame
        typed outright.
      - ⚠ **A fillet of two construction legs makes a construction arc.**
      - ⚠ **extrude/revolve refuse a construction member by name.**
      - ⚠ **A hairline casing (0.5px) on faces**, not the full 1.25px.
      - ⚠ **The e2e reaches the circle under the lid in `view("hidden")`**:
        shaded is opaque and picks nothing behind a face; the spec's text was
        fixed to say so.
      - ⚠ **Every drawing tool shows the options panel now**;
        `tooloptions.e2e.ts`'s tool-with-no-options became `point`, and
        `contextmenu.e2e.ts`'s edge menu gained *Construction*.

- [x] **Groups, phase 1 — the selection, groups, hide and show** — the owner:
      *"the concept of this project is flat relational direct cad. there is no
      hierarchy. a sketch entity exists in the same logical space as a solid
      entity. and entities can be grouped. think about this grouping, and
      implement also"*. Spec: [`docs/plans/groups.md`](docs/plans/groups.md),
      phase 1 marked built. `src/groups.ts` (new: the operations);
      `GroupEntry`, `groups`, `hidden`, `expand`, `membersOf`, the group
      primitives and the cascade's `leaveGroups` in `model.ts`; `Selection`
      and `SELECTION` in `tools/selection.ts`; the engine's `selection`,
      `composing`, `select`; the menu's selection items, Select g1, Show all;
      `del` of a group; hidden left out of `hitTest`, `findSnap`,
      `selectInBox`, `placeGlyphs` (`shownGlyph`), `visibleFaces`, the draw
      pass and `regionAt`/`lightRegions`; the hover tag's `· g1`; `ls()`;
      `help()`; six ops in `replenv.ts` and `persist.ts`, no format bump.
      936 unit tests (911 before; `test/groups.test.ts` 15,
      `test/selection.test.ts` 10), 381 e2e (358 before; `groups.e2e.ts` 12,
      `selection.e2e.ts` 9, two new cases in `picking` and `boxselect`).
      **Deviations from the spec:**
      - ⚠ **The Delete key works only with no text field focused** — not
        "with the command line empty" — for the reason under Smaller things.
      - ⚠ **`removeFrom` that empties a group removes it**, as the cascade
        does: one rule, a group is never empty.
      - ⚠ **The menu also offers *Select e1*** on a piece a feature made, a
        feature being a read-only group; the spec named groups only.
      - ⚠ **A feature's members are what it made** (`owns`), never its
        profile — "what the extrude made", read literally; the hover tag's
        `· e1` still names the feature on its profile too, as before.
      - ⚠ **`select()` leaves hidden names out and says so** in the log,
        rather than refusing.
      - ⚠ **A plain box that catches nothing clears the selection**, as a
        click on empty canvas does; the spec did not say.
      - **The spec was right about the code** — every seam it named was where
        it said — so its text is unchanged apart from the status line.

- [x] **Feature tools pick, preview, and confirm** — the owner: *"extrude
      and other tools should work like they do in other cad software. just
      click on the region or select the loop and hit the tickbox or enter or
      something"*. Spec: [`docs/plans/feature-dialog.md`](docs/plans/feature-dialog.md),
      marked built. `src/tools/feature.ts`, `src/tools/selection.ts`,
      `src/featurepreview.ts` (new); extrude, revolve, fillet and sketch;
      `regionNaming` (operations), `loopAround` (loops); the engine's
      `selected`/`confirm`/`escape`/`dialog`/`trial` and `arm`'s retune; the
      options panel's ✓ ✗ row; `perform`, Enter and Escape in `main.ts`;
      `help()`. 898 unit tests (884 before; `test/featuredialog.test.ts`, 12),
      351 e2e (340 before; `test/e2e/featuredialog.e2e.ts`, 11), every tool
      e2e and the first-run script moved to the new flow.
      **Deviations from the spec:**
      - ⚠ **The spec was wrong about the code: there is no `planExtrude`.**
        `planSweep` walks a profile's joins and computes no geometry. The
        preview is the throwaway clone — the confirm's own lines typed into a
        command line over a `save`/`open` copy, solved — so it is the commit's
        geometry by construction (unit-tested equal within a millionth for
        extrude, revolve, fillet and a frameless sketch).
      - ⚠ **One kind of region is built without a typed line**: bounded by a
        crossing no point marks, every member shared (the lens of two
        circles). It calls `extrudeProfile`/`revolveProfile`, the same entry
        a typed call journals. No typed line can name it without a new typed
        form, and the typed commands were not to change.
      - ⚠ **The planes a confirm types are in its one undo step.** Before,
        the extrude tool's plane was a step of its own; `extrudeplane.e2e.ts`
        now undoes both with one Ctrl+Z.
      - ⚠ **Re-arming the armed tool keeps its picks** (`Tool.retune`): the
        panel types `arm`, and `arm` used to start the tool over.
      - ⚠ **The preview follows the field as it is typed** (a trial value,
        checked against the declaration, never typed or remembered); the line
        is typed when the field commits. "Typing 25 moves the lid" needed it.
      - ⚠ **A pick is kept by a point inside it**, found again by
        `loopAround`, not by its loop's key: a neighbour's extrude relabels a
        split region's members.
      - ⚠ **Revolve with no axis yet**: the second click on the last region
        drops it, since there is nothing to confirm.
      - ⚠ **Fillet keeps an unroundable corner picked** (preview refused in
        the operation's words, ✓ off) instead of dropping the second line, so
        a smaller radius can be typed; a click on a corner's point takes both
        lines.
      - ⚠ **Preselection: a plain click selects only that region**, shift adds
        or drops; Escape with nothing armed clears it too. Arming any tool
        spends it.
      - ⚠ **Sketch on a preselected face** types its plane on the next task
        after the arming line, so the log reads `armed: sketch` first.
      - ⚠ **The first click on a frameless sketch types nothing**: the plane
        is typed at the confirm, with the extrude.

- [x] **Tool options: declared, visible, remembered** — the owner's
      standing direction (docs/plans/effortless.md): *"if the tool has
      options, there should also be some kind of e.g. pop-up menu that allows
      me to set them visually, or it happens in the terminal or whatever"*.
      Spec: [`docs/plans/tool-options.md`](docs/plans/tool-options.md), marked
      built. `src/tools/options.ts` (new); `Tool.options`, `defineTool`'s
      check; `ToolEngine.arm`; extrude/revolve/fillet declare `depth`,
      `angle`, `radius`; `OptionsPanel`, `optionsSize`, `besideTray`, `Fitted`
      and the fitted path through `arranged`/`apply` in `src/panels.ts`; the
      host in `src/main.ts`; `tools()`/`help()`. The toolbar's greyed-button
      wiring removed: `ToolbarHost.unavailable`, `buttonTitle`'s reason, the
      disabled state, `#toolbar button:disabled`. `toolUnavailable` itself
      kept — `menu.ts`'s empty-canvas items and `main.ts`'s `step` (an undo's
      re-arm) still ask it. 884 unit tests (866 before), 340 e2e (330
      before; `test/e2e/tooloptions.e2e.ts`, 10).
      **Deviations from the spec:**
      - ⚠ **Validation is in `ToolEngine.arm`, not the `arm` command.** The
        bare-name shortcut (`extrude` typed), a toolbar button and an undo's
        re-arm all reach the engine; only some pass through the command. One
        place, so every way of arming is checked and filled alike.
      - ⚠ **A declaration may carry `check`**, beyond the type: `depth: 0`, a
        revolve `angle` of 0 or past a whole turn and a `radius` ≤ 0 are
        refused by name. The tools used to swap such a value for their default
        in silence — exactly the "errors for no reason" inverse: a value
        typed and ignored.
      - ⚠ **A malformed `static options` is refused at `defineTool`**, so the
        line that defined the tool says what is wrong; nothing is registered.
      - ⚠ **A refused `arm` leaves the armed tool and its gesture as they
        were.** It used to cancel first and then look; a typo in an option
        now costs nothing. (An unknown tool name still cancels, as before.)
      - ⚠ **Remembered at arm time**, typed or by the panel — not when a
        feature is made (see Smaller things). And the spec's "in this
        session" was looser than its own verification ("reload, still 25"):
        it persists across reloads.
      - ⚠ **The panel types only the option edited**: the others are already
        what `arm` would fill (default, or remembered because they were
        typed), so `arm("extrude", {depth: 25})` is the whole truth.
      - ⚠ **A press outside a field being edited commits it first.** "Enter
        or blur commits" — but blur fires on `mousedown`, after the canvas's
        `pointerdown` has already handed the click to the tool armed with the
        old value. A capture-phase `pointerdown` on the document commits the
        field before anything else hears the press.
      - ⚠ **Escape in a field restores and does not release the tool**; the
        next Escape does.
      - ⚠ **Units:** a length shows no unit (the drawing's units have no
        name), an angle `rad`; any other declared text as written.
      - ⚠ **`tools()`'s lines changed** for a tool with options —
        `extrude  { depth: 10 }`, and `(default { … })` after a remembered
        value — so `panels.e2e.ts`'s "a button per registered tool" reads the
        first word.
      - **The strip names the armed tool**, and a row's hover text is the
        line it would type.
      - **`besideTray` reads the tray where it is shown**, so a tray turned
        into a row along the top puts the panel under it, and one on the
        right puts it to the left.
      **Left in place deliberately:** listed under Smaller things.

- [x] **The tool tray is one line, and the grips draw nothing** — the owner:
      *"you dont need those diag lines on every corner. also actually get rid
      of resizing altogether on the tool palette. its just a straight line
      that fits the number of tools it has in it, and can either be vert or
      horiz"*. Spec: [`docs/plans/tray-fixed-line.md`](docs/plans/tray-fixed-line.md),
      marked built. `.pgrip` has no background in any state (the held grip's
      `held` class went with it); `gripCorners(tray)` gives a tray none;
      `dragStep` returns a tray's resize grab untouched; `traySize` is the only
      size a tray has; `arranged` (pure, extracted from `apply`) keeps a stored
      tray's position and orientation and recomputes its size from the count;
      `trayFit` / `perLine` / `trayDepth`, `dragStep`'s wrap-refit loop and
      `same`, and `#toolbar`'s `flex-wrap` deleted. 850 unit tests (852
      before), e2e unchanged in number.
      **Deviations from the spec:**
      - ⚠ **The refusal is in `dragStep`, not `resized`.** The spec asks for
        "`resized` on it is refused or a no-op by construction", but `resized`
        is arithmetic on a bare rectangle and does not know what a tray is;
        `dragStep` is the one step every gesture goes through and is the only
        thing told a panel is a tray (its button count). So that is where a
        tray's resize grab comes back with nothing moved, and the DOM half
        never makes the grips to start one (`gripCorners`). Spec text
        corrected, marked *(as built)*.
      - ⚠ **New pure exports: `gripCorners`, `arranged`, `minSizeOf`.** So that
        "the tray has no grips" and "a stored size is ignored" are unit tests
        without a DOM, as the file's header promises, rather than e2e only.
        `apply` is now `arranged` plus `show`.
      - **The random walk still tries to resize the tray** — and asserts that
        nothing at all moves (1 675 refused steps at seed 11), rather than
        simply never trying. The spec said the walk "no longer resizes trays";
        this proves it rather than assuming it.
      - **The pixel check is against the same corner with the grips hidden**,
        not against one ground colour: the clip holds the border, the rounded
        corner, the strip and sometimes the log's text, so "the panel's
        ground" is read as the panel without its grip, pixel for pixel, hovered
        and held. A planted mark is shown to be seen, so it is not vacuous.
      - **The grip keeps its triangle clip.** "An invisible 12 px corner
        hot-spot" — the hot-spot is still the triangle in the corner, as built
        by the corners package, so a strip keeps its middle; only the drawing
        went ("nothing else about resizing changes").
      - **`pushed` still pushes the way a rectangle grows**, not the pointer's
        sign. That rule came in with the wrap (only a wrapped tray's depth grew
        against the pointer), but it is not idle wrap machinery: it runs on
        every move, agrees with the pointer for every gesture there now is, and
        is the better definition. Kept, its comment rewritten to say so.
      - **`toolbar-icons-docking.md` also annotated** (its "overturned: it
        wraps" note now points on to this spec), beside the two the spec named;
        and `docs/ARCHITECTURE.md`'s "a tray wraps rather than scrolls"
        paragraph rewritten.
      **Left in place deliberately:** a grip is found by its cursor alone; a
      tray too long for the window is clipped (both in Smaller things); the
      stored tray rectangle still carries a size, never read, under `v2`.

- [x] **Extrude on a frameless sketch makes its own plane** — the owner,
      with a screenshot of the log saying *"the loop of l1,l4,l3,l2 lies in no
      frame's plane, and no frame is parallel to it …"* eight times: *"how
      does extrude work? i don't really understand this"*. Spec:
      [`docs/plans/extrude-makes-its-plane.md`](docs/plans/extrude-makes-its-plane.md),
      marked built. A rectangle drawn in a fresh model, the extrude tool, one
      click inside: the tool types `plane(a, b, c, { look: false })` on three
      of the rectangle's corners (`sketchFrameFor`'s rule, +z toward the
      viewer), waits for it, and extrudes along it; the log reads the plane
      line, `f1`, then `e1  extrude of …`; the view does not turn; two Ctrl+Z
      bring the rectangle back frameless. Typed, `extrude("l1", 20)` makes the
      same frame itself (`addFrame`, `setDefaultFrame` if there was none, then
      `extrude`). Revolve likewise. `operations.ts` still refuses a frameless
      loop, as the guard.
      **Deviations from the spec:**
      - ⚠ **The tool waits for its plane.** A typed line runs asynchronously
        (`submit` awaits the REPL), so an extrude made as soon as `ctx.run`
        returned fell inside the typed line's undo bracket — one Ctrl+Z took
        both, and the log put `f1` after the solid (measured, by making it
        synchronous: the e2e fails exactly there). `ToolContext.run` now
        settles once the line has run, and the tool commits in
        `ToolContext.act` (new), the engine's own bracket.
      - ⚠ **Beside a default it keeps, the tool types `frame(a, b, c)`**, since
        `plane` always sets the default.
      - ⚠ **The tools log what they made** (`describeFeature`, shown as an
        answer: `ToolContext.log`'s new `"done"` outcome) — on every commit,
        not only after a plane, or one click would say `e1` and the next
        nothing. That is how `e1` gets into the log. It is also the first
        answer-not-error line a tool can say, which the STATUS "what's next"
        note about a tool saying something asked for.
      - ⚠ **A refused call makes no frame.** The command layer checks every
        refusal that needs no frame first (`extrudeNeedsFrame`,
        `revolveNeedsFrame`), revolve's geometry against the loop's own plane
        (`checkRevolveRegion`, which the revolve tool asks too before typing).
      - ⚠ **The headless normal is loops.ts's** — largest component positive,
        not "+z": a sketch standing in the x–z plane extrudes along +y. The
        spec's text corrected.
      **Left in place deliberately:**
      - **Typed, frame and solid are one undo step; by the tool, two.** One
        typed line is one step (the host's rule); the tool types one line and
        then commits, which is two things done. The owner's sequence asked for
        two.
      - **The sketch's +x is whichever edge `sketchFrameFor` starts at**, so in
        the owner's rectangle `f1`'s x-arrow points left and its y down (seen
        in the screenshot). Square to the sketch, never tipped; the view is not
        turned to it, so it shows only in the marker.
      - **Headless, with no command line, the extrude tool still refuses** a
        frameless region (the sketch tool's convention), rather than making the
        frame itself — a test driving a tool has no `run` to type into.
      - **A plane typed for a commit that then fails stays**, as typed, in its
        own undo step: the tool checks everything it can first (the depth is
        always valid; revolve's axis is checked), so this needs the operation
        to refuse something the checks did not foresee.
- [x] **Panels resize from any corner, and the tray wraps** — the owner:
      *"allow me to rescale the popup windows from any corner. the tool
      palette should wrap the icons also - i.e. if it is vertical and i
      decrease vertical size, it should create a second column."* Spec:
      [`docs/plans/panels-corners-wrap.md`](docs/plans/panels-corners-wrap.md),
      now marked built. Four grips per panel (`CORNERS`, made by the DOM
      half), `resized(…, corner)` pure with the opposite corner fixed,
      `grabbed(…, corner)`, `cornerOf`; `trayFit` / `perLine` / `trayDepth`
      for the wrap, applied by `dragStep` on a tray's resize and by `apply`;
      `#toolbar` flex-wraps with `overflow: hidden`. 840 unit tests (8 new
      plus the walk extended), 319 e2e (5 new plus the random run extended).
      **Deviations from the spec:**
      - ⚠ **The spec was wrong about where the caveat lived.** "The register's
        panels entry (the 'scrolls rather than grows' caveat replaced)" — the
        register entry above never carried it; STATUS's panels entry did (and
        the tray entry's "(it scrolls)"). Replaced there, struck through with
        a pointer, and the register entry gained the two new rules in the
        owner's words. Spec text corrected, marked *(as built)*.
      - ⚠ **A tray's depth is the buttons', not the viewer's.** The spec says
        a tray's grips "resize the tray like any panel" and that the wrap is
        "the panel's content box deciding". Taken literally, a corner moves
        both edges, and a column made shorter but not wider would wrap its
        second column out of sight — the scrollbar back, or buttons lost. So
        the run follows the hand and the depth is exactly the lines the wrap
        makes (`trayFit`, the stylesheet's flex-wrap in arithmetic). The
        consequence, a sideways drag of a column's corner doing nothing, is a
        Smaller-things entry above.
      - **A tray is never longer than one line of its buttons.** Not in the
        spec; a column dragged taller than its buttons would be a strip of
        nothing, and `traySize` already said what one line is.
      - **No room for another line stops the shortening**, as a minimum does;
        when a chain or the window edge allows part of a line, the tray takes
        the lines that fit and its run stops where they hold every button.
        This is "a resize stopped by a chain against the window edge stops
        flush" for a depth that comes in whole lines: flush to the last whole
        line, with less than a line's gap left (unit-tested, and the random
        walk asserts the reason for every such stop from the layout alone).
      - **The grips are made by `panels.ts`, not written in `index.html`**, and
        **clipped to their corner triangles** — the old grip's hit area was the
        whole 12 px square. Four squares on a 28 px tray would have left its
        strip a 4 px slot to drag by and covered most of the corner buttons'
        lower halves.
      - **`dragStep`'s last parameter is `buttons?: number`, not `content?`**:
        a tray's resize needs the count as much as its turn does.
      - **Two changes in the shared resolver**, which only a west or north grip
        exposed: the push direction along an axis is now the way the rectangle
        grows (it was the pointer's sign — wrong once a tray's derived depth
        grows against the pointer), and `pass` pulls back the leading edge
        with the trailing edge exact (the old interpolation left a panel grown
        west into a blocked chain 3·10⁻¹⁴ px into it). Drags and south-east
        resizes come out the same; every pre-existing panels test passes
        unchanged but for `content` → `buttons`.
      - **`apply` fits trays too**, so a window too short for the tray's one
        line wraps it rather than clipping it — not asked for, the same rule.
      *Discovered:* the random walk's "caught" count (a stopped panel
      back under the hand) is 24 against a threshold of 20 at seed 11 — the
      walk now spends many steps on tray resizes, which lag across the depth
      by design. Deterministic, but the closest of the walk's floors.

- [x] **Undo and redo, bulletproof** — the owner: *"why does ctrl+z and
      ctrl+y not work? should work and be bulletproof"*. Spec:
      [`docs/plans/undo-bulletproof.md`](docs/plans/undo-bulletproof.md), now
      marked built. The chord listener is one capture-phase listener on
      `window` that `preventDefault`s and `stopPropagation`s the undo and redo
      chords only; the matcher is `src/historykeys.ts`. The text carve-out is
      gone — the box keeps its text, the drawing undoes. `step` (every door:
      chord, menu, typed) closes the menu, cancels the gesture, moves, re-arms
      the tool, and notes the outcome beside the verdict. Undo / Redo at the
      bottom of every context menu; `help()` says layout and camera are not
      steps.
      **Deviations from the spec:**
      - ⚠ **The spec was wrong about the line tool.** Its matrix expected "the
        point it placed" on the first click to be undone; the line tool's
        first click places nothing (`src/tools/line.ts`: an abandoned chain
        leaves no stray point). The cell checks what does happen — the preview
        goes, the step *before* the gesture undoes, the next two clicks make a
        line between them — and a **mid-chain** cell was added, where the
        committed segment is what undoes. Spec text corrected, marked *(as
        built)*.
      - ⚠ **The note is beside the verdict, not in place of it.** The spec
        said the status readout "briefly shows" undid / redid / nothing to
        undo. It does — in a new `#stepnote` in the header next to `#status`,
        cleared after 1.6 s. Writing it into `#status` would hide SOLVED /
        CONFLICT on a timer (the stale-readout family, ARCHITECTURE's first
        browser-only bug) and every e2e test reading `#status` right after a
        Ctrl+Z would have had to wait it out.
      - **`code` is a fallback, not an alternative.** Accepted only when `key`
        is not a Latin letter: on QWERTZ the Z key reports `code: "KeyY"`, so
        accepting both outright would make one keystroke undo and redo.
      - **The tool is re-armed as a fresh instance** with its original
        options (the engine grew a read-only `armed`), and **left disarmed**
        with the toolbar's reason in the log when the restored model cannot
        run it (a curve tool whose default frame was undone). The spec said
        only "the tool stays armed". Before this package an undo disarmed the
        tool as a side-effect of `swapModel`.
      - **Mid-drag cell added**, and a behaviour change with it: cancelling
        the drag first settles it into a step, so Ctrl+Z mid-drag takes back
        the drag. The old code undid the step *before* the drag and pushed the
        dragged state onto redo.
      - **Undo / Redo are on the constraint glyph's menu too** — the third
        menu `menuFor` builds. `menuFor` takes the stack's two booleans as an
        optional fourth argument, so it stays pure and existing call sites
        and tests are unchanged.
      - **`e2e` helpers that cleared `#cmd` "because the model owns Ctrl+Z only
        with the box empty"** (contextmenu, deletion, glyphs, intersection,
        undo) no longer clear it; the comment was the carve-out. Other tests
        that clear the box before Ctrl+Z without saying why were left alone.
      - **Six existing e2e assertions on exact menu contents were updated**
        (contextmenu ×4, setvalue, and the disabled-item counts in panels and
        planar), since every real menu now ends Undo, Redo. Where a test
        counts *disabled* items to ask about tools or Fix, the history items
        are filtered out: whether they are off depends on the stack, not on
        what the test is about.
      - **The Cyrillic cell dispatches a synthetic event**; every other cell
        uses the real keyboard. No test machine can switch layouts.
      - **Commits carry the session's own model in the `Co-Authored-By`
        line**, not the one the package brief named — the same call the
        previous package made.
      Tests: 826 → 832 unit (4 chord matcher, 1 menu, 1 engine), 299 → 314
      e2e (15 in `test/e2e/undokeys.e2e.ts`; `undo.e2e.ts`'s carve-out test
      inverted in place). The new matrix run against the old code fails 10 of
      15 cells, the text-in-the-box cell on the drawing not moving.
      *Discovered, left alone:* no browser-only bug this time — the count in
      ARCHITECTURE stays at eight.

- [x] **The grasp point stays the same** — the owner, reversing the slip a
      day after asking for it: *"actually the grasp point should stay the
      same"*. Spec: the "Reversed by the owner (2026-10-27)" section of
      [`docs/plans/panels-push.md`](docs/plans/panels-push.md), now marked
      built. `dragStep` hands back the grab it was given — drag and grip alike
      — except when a tray turns, where `regrasped` carries the hand's point
      to the new shape as the same fraction along the strip and the same
      depth into it. Pushing is untouched.
      **Deviations from the spec:**
      - ⚠ **A turn that would turn straight back under the hand does not
        happen.** Nothing in the spec, and needed: with the grab fixed, a row
        just under the top edge held high on its strip and eased right onto
        the right edge turns into a column, which under the hand pokes over
        the top edge and turns into a row, which under the hand is on the
        right edge again — measured, 225 flips across one 600-move drag. The
        slip had hidden it by re-basing on wherever the turn put the tray. Now
        the turn is refused, the row waits against the right edge, and it
        turns once the hand itself reaches the corner (one flip; unit-tested).
      - **Where a turn puts the tray is unchanged** — `turned` still holds the
        edge it met. So a column eased onto the bottom edge (or a row onto the
        right) becomes a row lying along that edge, away from the hand, and
        the next move brings it back under the hand. Released before that
        move, it stays docked. Rejected: turning it in place round the hand,
        which `turned`'s own doc comment already rejects ("not a row floating
        where the column's top was"), breaks two e2e tests that release a
        one-step turn, and flip-flops in the same corner bands.
      - **`dragStep` asks `pushed` again, up to three rounds, when a move
        ends short of the hand.** `pushed` takes the motion's larger axis
        first, so a panel stopped by a neighbour along that axis and then
        slid clear of it along the other had not tried again from where it
        got to — short of the hand with nothing stopping it, for one event.
        The random walk's new assertion found it on drag 20. The slip had
        hidden this too, by forgetting the remainder. `pushed` itself, and so
        the push rule, is unchanged.
      - **The DOM half now hands `dragStep` the pointer in the canvas area's
        coordinates**, not the window's. Not in the spec, and the one thing
        the browser caught: with the grab re-based on every move the header's
        32 px cancelled out; held for the whole gesture, a turning tray
        carried them along its strip as if the hand were 32 px further down
        it, and the e2e turn against the log's right edge was refused. The
        area's origin is measured once at the press. Eighth entry in
        ARCHITECTURE's list of bugs only a browser saw; `CLAUDE.md` still
        says "Seven" — left for the owner, since this package does not edit
        `CLAUDE.md`.
      - **"Blocked" in the random walk is worked out from the layout**, not
        taken from the resolver: a panel short of the hand along an axis must
        have that face on the area's edge or flush against a chain of panels
        that ends there (or, a grip shrinking, be at its minimum). The step a
        tray turns is exempt, per the deviation above.
      - **The e2e asserts the hand is on the middle of the tray's strip**
        after stepping back past the lead, as the measure of "under the hand
        where it was grabbed" — the tray turned into a row on the log on the
        way down, so it is the row's strip, the column's middle carried over.
      - **Commits carry the session's own model in the `Co-Authored-By`
        line**, not the one the package brief named.
      Tests: 823 → 826 unit (3 new: the fraction along the strip, the
      bottom-edge turn coming back under the hand, no flip-flop; the slip test
      inverted and the random walk extended in place), e2e count unchanged
      (the slip half of the chain test rewritten in place).
      *Discovered:* a turn at the bottom or right edge leaves the tray away
      from the hand for one event (above); a panel stopped by a chain and then
      slid clear of it along the other axis catches up to the hand at once —
      a jump the size of the lead, the fixed grab working as specified, but a
      jump all the same (Smaller things, if the owner minds it).

- [x] **Panels push one another, and the grab point slips** (the slip since
      reversed — entry above) — spec:
      [`docs/plans/panels-push.md`](docs/plans/panels-push.md), now marked
      built; the owner's words and the two rules are in the register entry
      above. `pushed`, `settled`, `dragStep`, `grabbed` and `overlapping` in
      `panels.ts`, pure and unit-tested; the DOM half calls `dragStep` on every
      move and `settled` on every `apply`, stores every panel a gesture moved,
      and (dev server only) reports an overlap as a page error.
      **Deviations from the spec:**
      - ⚠ **Each axis of the motion is resolved in turn, the larger first —
        not everything along the dominant axis.** Literally, a tray resting on
        the log's top dragged right with one pixel of downward drift overlaps
        the log by a pixel, and "move that panel along the dominant axis by the
        amount that separates them" throws the log sideways by the tray's
        width — or, with no room, jams the drag. Per axis, the log is pushed
        down the pixel. Face-on the two agree: the spec's "diagonal motion
        pushes along the dominant axis only" test passes as written, and a
        second test pins the drift case. A panel pushed along x still never
        moves in y within that axis's pass.
      - **The flush stop is exact, not a binary search.** A chain's overshoot
        past the edge grows one for one with the mover's travel, so the travel
        pulled back by the overshoot is the largest that fits — to the pixel,
        where a bisection stops a fraction short. Re-checked in a loop in case
        the shorter travel meets a different chain; gives up to "stay put".
      - **The chain may revisit a panel.** "Breadth first, never revisiting"
        leaves a panel the mover reached first by a short push under another
        panel that then reaches it by a longer one (unit-tested). Pushes are
        all one way along one axis, so revisiting still terminates.
      - **What pushes is the mover's swept rectangle**, not its landing place:
        the random walk found a flick moving further in one event than a
        narrow panel is wide passing straight through it.
      - **Zero motion falls back.** The spec gives only "ties resolve along x";
        built as x away from the mover, x the other way, then y away and y
        the other way, first sound one wins, else `ok: false` and nothing
        moves — a turn that cannot make room does not happen.
      - **Load puts panels down in order with earlier ones holding their
        places**: each one that lands on an earlier one is pushed out of *its*
        way (the earlier panel is `pushed`'s mover). With the later one as
        the mover, a toolbar grown for a new tool would be knocked off the
        left edge by the log, then thrown to the log's far side.
      - **The grip slips too**, the same rule; the spec named only the drag.
        (Reversed with the drag's, 2026-10-27: the grip is held too.)
      - **The e2e chain test pushes the command line as well as the log**: the
        default layout has the command line under the log, so "until the log
        reaches the bottom edge" is "until the command line under it does".
        The spec text is corrected.
      - **The register's "overlaps it" caveat was in STATUS, not the
        register** (STATUS's tool-tray entry); struck there, and the register
        entry now carries the two rules.
      - The old e2e "cannot be dragged off an edge" drove the command line to
        the top-left through the log and toolbar, which now push; it parks the
        toolbar first and takes the log to the top-left instead.
      Tests: 811 → 823 unit, 293 → 299 e2e. Screenshots 92–93, looked at.
      *Discovered:* a window too small to hold every panel side by side leaves
      the last one over its neighbour — nothing shrinks a panel to make room
      (Smaller things); a pushed tray does not turn.

- [x] **The tool tray: icons, held inside, turning with the edge it meets** —
      spec: [`docs/plans/toolbar-icons-docking.md`](docs/plans/toolbar-icons-docking.md),
      now marked built; the owner's three lines and the three vetoes are in the
      register entry above. `constrain` holds a panel wholly inside (`KEEP`
      gone); `src/tools/icons.ts` (new) is the glyph table, keyed by registered
      name, with `genericIcon`/`toolIcon`, reached by the toolbar only through
      `ToolbarHost.icon`; `orientationFor`, `contacts` and `turned` in
      `panels.ts` are the turning rule, pure and unit-tested; `Panels` takes a
      `trays` map (id → button count) and turns those panels live on every
      move of a drag; the layout key is `neocad.panels.v2`.
      **Deviations from the spec:**
      - **The snap distance is 6 px, not "8, say"**: the defaults sit 8 px off
        every edge, and at 8 the untouched toolbar dragged along the top would
        turn on its first pixel. The spec text now says 6.
      - **A disabled button's tooltip is `name — reason`, not the reason alone**
        ("as now"): with no label on its face, the reason alone never says which
        tool is greyed. The spec text now says so. The menu's reason string is
        unchanged and the e2e test still compares the two.
      - **A row's strip runs down its left end**, so a row is one button high
        as the spec asks; the strip carries a grip of dots instead of the word
        "tools" (too narrow for it either way), with "tools" as its title.
      - **The old e2e test "a panel cannot be dragged where its strip is out of
        reach" was vacuous** — the log, grown by the test before it, covered the
        command line's strip, so the drag never moved anything. Rewritten to
        reset first and assert the panel moved; not a spec deviation, but the
        spec's "stops flush inside" test would have inherited the same blind
        spot.
      Tests: 788 → 802 unit, 277 → 286 e2e. Screenshots 85–87, looked at, at
      the toolbar's own size and magnified.
      *Discovered:* a moved or turned tray does not grow when a tool is
      defined; the grip overlaps the last button's corner (Smaller things).

- [x] **Clauses: an entity defined by any constraint set** — spec:
      [`docs/plans/clauses.md`](docs/plans/clauses.md), now marked built.
      `src/clauses.ts` (new) holds `_`, `Clause`, the per-relation slot lists
      and the pre-checks; `replenv.ts` binds every relation through
      `subjectable` and wraps the five constructors in `withClauses`;
      `constrain(name, ...clauses)` is in scope. No change to `model.ts`,
      `relations/`, `persist.ts` or the format — a unit test proves it by
      saving a clause expression and its expansion to the same bytes.
      **Deviations from the spec**, each small:
      - ⚠ **The three-point circle is `oncircle("p1", _)`, not the spec's
        `oncircle(_, "p1")`.** `oncircle` takes (point, circle), so the spec's
        form makes the new circle the *point* — and is refused by `onCircle`
        itself (`circ made c1, but oncircle("c1", "p1") refused: "c1" is not a
        point`), exactly the "relation's own refusal" case the spec describes.
        That its own author wrote it backwards says this mistake will be common;
        see the item under Smaller things.
      - **A refusal while applying names what was already made**: the relation's
        own message is passed on unchanged, prefixed `ln made l2, but on("l2",
        "l1") refused: …`. The spec asked that "the journal shows exactly what
        happened"; headless, the message is the only other account.
      - **`pt` refuses a non-number among its own arguments** (it used to pass
        it to the model as a coordinate) — a stray string there is now most
        likely a clause with its `_` forgotten.
      - **A clause given *as an argument* to a relation is refused**
        (`dist(on(_, "l1"), "p2", 5)`), at once, rather than meeting the
        model's `"on(_, "l1")" is not a point`.
      - `repl.ts`'s `fmt` honours `Symbol.for("nodejs.util.inspect.custom")`,
        which is how a clause prints legibly without the evaluator importing it.
      - The spec's `ln(par(_, xaxis()), on("p1", _))` collapses to a line of
        length zero when solved, so the tests add `eq(_, "l1")`. Not a clause
        problem — the expanded lines do the same, measured; see below.
      Tests: 652 → 673 unit, 242 → 247 e2e. Screenshot 72, looked at.

- [x] **The toolbar greys out a tool that cannot run** — spec:
      [`docs/plans/toolbar-availability.md`](docs/plans/toolbar-availability.md),
      now marked built. `src/toolavail.ts` holds the rule the menu used to
      keep privately (`CURVE_TOOLS`, `curvesNeedAFrame`, and
      `toolUnavailable(model, tool)` over them); `menu.ts` imports it with its
      output unchanged, and `ToolbarHost` grew `unavailable(tool)`, which
      `main.ts` answers through the same rule. `Toolbar.sync` re-reads it on
      every call and touches the DOM only when a reason changed. A disabled
      button has the `disabled` attribute, the reason as its `title`, and the
      menu's `.item.off` grey. **No deviation from the spec.** Two things it
      did not ask for, both small: a unit test that `panels.ts` still has no
      imports at all (the contract its header states, now enforced), and an
      e2e test that a tool *armed* when its frame is deleted greys out rather
      than staying amber — `arm` itself is untouched, so the tool stays armed
      and its click is refused in the log, as before.
      *Discovered:* the rule is keyed by tool name, so a command-line tool
      that re-registers a built-in curve tool's name inherits the rule
      (Smaller things, above).
- [x] **A toolbar, every piece of chrome a movable panel, and an empty-canvas
      hint** — spec: [`docs/plans/panels.md`](docs/plans/panels.md), now marked
      built. See the register entry above. One PR; the hint was added to its
      scope by the supervising session after the owner's *"i dont see
      anything"*. **Deviations:** `layout` needed a host handle and a help line
      in `replenv.ts` (the house pattern for viewport commands; nothing in the
      model, relations, tools or engine changed); the spec asked to *verify*
      that typing with nothing focused reaches the command line, and no such
      rule existed — focus only came back on a pick — so it was added; the
      canvas now captures every press in `main.ts`, because the engine did not
      capture an armed tool's gesture and a rectangle released over the log was
      never built.
      *Discovered while doing it:* the free-line tangent e2e test had a circle
      centred exactly where `line()` seeds from and passed only because the log
      pane shifted "the middle of the view" as it grew — so **`line()` seeded
      through a circle's centre then `tan`'d to it ends in CONFLICT** (below).
- [x] **Dimensions are named, and `set()` edits their value** — spec:
      [`docs/plans/dimensions-are-named.md`](docs/plans/dimensions-are-named.md),
      now marked shipped-pending-review. `dist`/`rad`/`ang` claim `d1`, `d2`, …
      and every other relation stays `r`-named; `set("d4.value", 60)` rebuilds
      the dimension in place under the same name, journals as the one call, is
      one undo step and re-solves through the host. The menu's **Set value…**
      types the unfinished command rather than running anything. Format version
      **4**, with v3 files translated: `deleteRelation` args are rewritten
      through a map built during the replay, since re-prefixing changes which
      relation a recorded name picks out.
      *Discovered while doing it:* the map has to come from the replay rather
      than from a scan of the journal, because `fillet` is one journal entry
      that creates four relations — and would be wrong again the next time an
      operation's expansion changed. Also worth knowing: nothing pins a bare
      rectangle's **orientation**, so a `set` that lengthens one edge lets the
      whole drawing rotate a little unless something levels it against a datum.
      That is the no-world-frame decision working as designed, not a bug, but it
      surprises on first sight — the package's screenshots level the drawing
      first so the picture shows the edit and not the rotation.
- [x] **The right-click context menu** — spec:
      [`docs/plans/context-menu.md`](docs/plans/context-menu.md), now marked
      shipped-pending-review. **Right-press and release without moving opens a
      menu; right-drag still pans** — the right button now makes the same
      click/drag split the left one always has, on the same three-pixel
      threshold, so the release decides and the press decides nothing. The
      menu is a `<div>` in the hover tag's visual family, and **every item is
      a shortcut to a command the log shows**: an entity gets Insert name /
      Delete / Dimension (and Fix, on a point), a constraint glyph gets its
      description and Delete, empty canvas gets the eight tool arms plus
      Frame. The register's mouse entry above is updated — the right-click
      deviation it carried is resolved.
      *Decided while doing it:* **the seam is `submit`**, the function the
      Enter key calls, handed to the menu as an explicit `run` hook. "A
      shortcut to a typed command" is a claim about machinery rather than
      outcome — logging, the recall history, one undo bracket and the re-solve
      all live in `submit` and nowhere else — so anything short of calling it
      would be a second, slightly different answer to what typing means.
      Writing into `#cmd` and dispatching a synthetic Enter was rejected: it
      reaches the same function by pretending to be a keyboard, makes the seam
      invisible to a reader, and destroys whatever was half-typed.
      *And:* **Fix types the point's coordinates in the default frame**, not
      its raw ones. The spec said "current coords", which means "hold it where
      it is"; against a frame that is turned or moved off the gauge's origin,
      raw numbers would yank the point somewhere else the moment the relation
      landed. There is a unit test with a frame turned 90° and moved, which
      fails on the raw form.
      *And, beyond the spec:* each item shows the command it is about to type
      beside its label. The menu exists to be a shortcut *to the command
      line*, and an item that hid what it was about to do would be a fourth
      way to edit the drawing rather than a faster way to type.
      *Left in place deliberately:* the items are hard-coded per pick kind, so
      nothing defined at the command line can add one (noted under "Next up");
      no submenus, icons or keyboard arrows, per the spec; a right-click with
      a tool armed opens the menu rather than doing something tool-specific,
      which is one rule instead of two; and a right press taken *during* a
      left drag opens nothing, because interrupting a gesture in progress is
      never what it means.

- [x] **The 3-point arc tool** — spec:
      [`docs/plans/arc3-tool.md`](docs/plans/arc3-tool.md), now marked
      shipped-pending-review. `arm("arc3")` (or the bare word), then **the two
      endpoints, then a point the arc passes through** — Onshape's click order
      for *3 point arc*, which is neither start-waypoint-end nor the
      centre-point arc's centre-start-end. What is committed is two
      `placePoint`s, one free `addArc` with its centre auto-created and seeded
      at the circumcentre, and one `arcEndpoints`. Footprint was the new file,
      one shared helper module, one import line in `main.ts`, tests and docs;
      `engine.ts`, `replenv.ts`, `persist.ts` and `operations.ts` were all
      untouched, and **no new journal op was needed** — which is the evidence
      that it is a composition rather than a new kind of thing.
      *Decided while doing it:* **the third click places nothing.** Onshape
      does not keep the waypoint as geometry and neither does this, so the arc
      is under-constrained on commit — seven unknowns against `arcEndpoints`'
      two equations, with the *bulge* free. That is the standing rule that
      tools do not dimension what they draw, and the same bargain `arc.ts`
      already strikes. The alternative, keeping the waypoint as a third point
      with an `onCircle` (exactly what `circle3` does), was rejected: it
      contradicts Onshape and leaves a point the user never asked for and
      would have to clean up by hand. The freedom is *asserted* — a
      unit test shoves the centre along the endpoints' perpendicular bisector
      and finds the system just as solved at a different radius.
      *And:* **the sweep is tested against `withinSweep`, not against a second
      opinion.** An arc bulging the wrong way satisfies every residual to
      machine precision and is still the wrong drawing, which is the fillet
      bug's shape; so the tool's world-space choice of which click is `start`
      is checked against `intersect.ts`'s own screen-space definition of what
      is on an arc. Flipping the choice in the source fails three tests.
      *And:* **`circumcircle` moved out of `circle3.ts`** into
      `src/tools/circumcircle.ts`, with `COLLINEAR_EPS` and the preview's
      radius cap. Two tools needing the same closed form is fine; two tools
      needing the same *epsilon* is not something to leave in two places, or
      one will eventually refuse a gesture the other accepts.
      *Left in place deliberately:* the bulge is free, as above — documented,
      tested, and `rad(...)` is the answer for anyone who wants it held. Also
      the same-place guard is in **world units** (`1e-6`), matching `arc.ts`:
      at a wild enough zoom-out two genuinely distinct clicks could fall
      inside it, and the failure mode is "the second click did nothing, click
      again".
      *Discovered:* the register's "no 3-point arc yet" line and the
      circle3 entry's `console.warn` gap were both stale; both corrected in
      `STATUS.md`.

- [x] **Dimension values on the canvas** — spec:
      [`docs/plans/dimension-labels.md`](docs/plans/dimension-labels.md), now
      marked shipped-pending-review. `dist`, `rad` and `ang` draw their target
      (`50`, `R22`, `30°`) as their glyph, read from `RelationEntry.args`, so
      nothing below the UI changed: no model change, no journal change, no new
      relation kind. A label hovers, picks, highlights and hides with
      `glyphs(false)` exactly as a mark does, because it is one.
      *Decided while doing it:* the spec left the witness/dimension lines to
      whichever read better in a browser — **kept, dashed**. Solid, they were
      indistinguishable from geometry (a `dist` across a rectangle's diagonal
      drew what looked like a diagonal edge that does not exist); dashed and
      dim they read as annotation, and they earn their pixels in exactly that
      diagonal case, where nothing else says which two points a floating
      number measures. `ang` gets **one** label at the shared corner rather
      than the two marks `∠` used to get: two marks answer "which pair", two
      copies of the same number answer nothing.
      *Discovered while doing it:* a stacking row that stepped by a fixed
      17px drew `—` touching `110`, which reads as *minus* 110 — the row now
      advances by each box's real edges. And `ang` takes radians while its
      label says degrees; drawing radians on a sketch would be the wrong fix,
      so the seam is flagged in the register and closes with retargeting.
      *Left in place deliberately:* no editing in place (owner decision
      below); `rad` gets no leader line back to its arc; a label sits on the
      side its relation's argument order puts it (`dist("p3","p4")` and
      `dist("p4","p3")` land on opposite sides of the same edge), which is
      the same hand-placement story every glyph has and is what the
      screenshots use to put the dimensions outside the shape.
- [x] **A tool can say something to the user** — `ToolContext.log`, filled in
      by the engine, routed to the log pane by `main.ts`. `fillet` no longer
      throws its refusals at the page and `circle3` no longer whispers to the
      console; headless, both keep their old behaviour (throw / warn), the
      `pick` convention. Direct commit by the supervising session, same
      test gate.
- [x] **The 3-point circle tool** — spec:
      [`docs/plans/circle3-tool.md`](docs/plans/circle3-tool.md), now marked
      shipped-pending-review. `arm("circle3")` (or the bare word), three
      clicks, and what is committed is one free `circle()`, three `oncircle`s
      and a solve. Every click goes through `placePoint`, so all three carry
      snapping and inference — a 3-point circle through two existing corners
      is three clicks and no special case. Nothing is created until the third
      click, so the engine's existing bracket makes the whole gesture one undo
      step; a dashed circumcircle previews after the second. Footprint was the
      new file, one import line in `main.ts`, tests and docs — `engine.ts`,
      `replenv.ts`, `operations.ts` and `persist.ts` were all untouched.
      *Decided while doing it:* **the centre is seeded at the circumcentre,
      not the spec's centroid.** The spec asked for the centroid so the solver
      would not start somewhere wild; the closed form was already in the file
      for the preview and the collinearity test, so seeding at the exact
      answer serves that reason better than an approximation of it and costs
      nothing. The circle is still free — a constructor argument here only
      ever seeded a variable.
      *And:* **the collinearity epsilon is a relative sine, not an area.** An
      area threshold would call a large drawing bent and a small copy of it
      straight; dividing through by the two side lengths makes the test an
      angle, scale-free at any zoom and in any unit. Same form and same number
      as `intersect.ts`'s parallel test, and there is a unit test at three
      scales that fails on the area form.
      *Left in place deliberately:* the refusal is a `console.warn`, not a
      line in the app's log pane. A `Tool` has no channel to that pane — it
      would take a new `ToolContext` field, which means editing `engine.ts`,
      which the spec ruled out because the edge-drag package is in flight
      there. Worth a follow-up: **tools have no way to say anything to the
      user**, and `fillet` currently *throws* to report a corner it cannot
      round, which reaches the page as an uncaught error.
      *And:* the preview is not drawn when the circumradius exceeds 1e6 screen
      pixels. What would be drawn there is a straight line (the sag is well
      under a pixel across the window), and asking a canvas for an arc of
      radius 1e8 is a good way to hang a tab. The *commit* is unaffected — a
      near-collinear circle is the user's to make.

- [x] **Dragging an edge** — spec:
      [`docs/plans/edge-drag.md`](docs/plans/edge-drag.md), now marked
      shipped-pending-review. Dragging an entity is dragging every point it is
      made of by the same offset, as a *target*: one soft pull per governing
      point, so the constraints still get their say. A circle's rim drags its
      centre and leaves the radius alone; an arc's rim drags centre, start and
      end. The register entry above is updated: the old mouse map is now gone
      entirely.
      *Decided while doing it:* the offset form replaced "pull to the cursor"
      for **single points too**, rather than keeping two code paths — a point
      grabbed a few pixels off-centre no longer jumps to the cursor as the drag
      starts, which nobody had asked for but everybody expects.
      *Left for later, deliberately:* **no rigid rotation** (translation only,
      as specified — Onshape's drag does the same and lets the solver resolve
      the rest); **no inference or snapping mid-drag**, still; and a press on a
      **constraint glyph** still pans, which is now the only left-drag that
      does. Making it inert instead was considered and rejected — see
      `CONVERSATION_LOG.md`.
- [x] **`del` of several names at once** — `del("p1", "l5", …)`, the batch a
      box select naturally produces. Validation of every name happens before
      the first removal (a typo mid-batch costs nothing), a name an earlier
      cascade already took is skipped silently, and the whole batch is one
      entry and therefore one undo step. Journalling was already per-removal
      (the expansion), so nothing about persistence had to change — pinned by
      a replay test anyway. Implemented directly by the supervising session:
      small enough that a spec would have been longer than the diff.
- [x] **Entities defined by constraints, not constructors** — spec:
      [`docs/plans/free-entities.md`](docs/plans/free-entities.md), now marked
      shipped-pending-review. Every constructor argument is optional, in
      `model.ts` and at the command line: `circle()` is a legal way to say "a
      circle, which the relations I am about to type will define", and the
      owner's two examples type verbatim. Auto-created pieces are real, named,
      first-class entities with seeds that are never degenerate; each
      constructor journals as the one call made and re-expands deterministically
      on replay. Long names `point`/`line`/`circle` sit beside `pt`/`ln`/`circ`.
      Shipped in two commits — model half first (it carried no conflict risk
      with box-select, which owned `replenv.ts`), command half after.
      *Decided while doing it:* **the view-centre seed is passed down as a
      coordinate, not learned by the model.** A free circle at the world origin
      is baffling — you type it and nothing appears — but "the middle of the
      window" is a fact about a window, so `replenv.ts` reads it and calls
      `addPoint(coords)` like any other caller. It needs the canvas's *size* as
      well as the transform, which a `View` has no business holding, hence a
      separate `viewSize` handle rather than a fatter `View`.
      *And:* the anchor is used only where the model would otherwise fall back
      to the origin for want of anything to derive a position from. Given any
      reference the model already seeds beside it, and hauling that to the
      middle of the window would be worse, not better.
      *And:* headless, the command layer passes `null` rather than the model's
      own default coordinates, so a journal written with no viewport is exactly
      what the model layer writes — one call, no expansion. On screen the
      journal records the coordinate actually used, so a drawing reopens where
      it was drawn. Both directions round-trip in tests.
      *Discovered while doing it:* **`circ("p1", 6)` only seeds a radius**, so
      "a line tangent to two circles" with unpinned radii is satisfied by
      shrinking a circle onto the line. Obvious in hindsight and exactly the
      distinction this package is built on; the test now says `rad()` too.
      *And:* **what counts as one undo step is decided around a submitted
      entry** — a `del()` pushed straight into the evaluator is not a step, and
      the next `undo()` undoes the entry before it. A test-harness trap, not a
      product bug, but it will catch the next person too.
      *Left in place deliberately:* tangent + through-point + radius admits up
      to four circles and the solver returns the branch nearest its seed;
      dragging flips branches. Onshape's behaviour, written into `CHANGELOG.md`
      as a property rather than left to be read as nondeterminism. And the
      pointer tools are untouched — a 3-point-circle *tool* is now trivial and
      is listed under "Next up" as enabled, not built. **↳ Built, one package
      later**, exactly as trivially as promised: `src/tools/circle3.ts` plus
      one import line, and nothing else.

- [x] **Box select, and live solve for typed edits** — spec:
      [`docs/plans/box-select.md`](docs/plans/box-select.md), now marked
      shipped-pending-review. Left-drag on empty canvas draws a selection box:
      left→right is a window (fully contained, solid translucent rectangle),
      right→left a crossing (anything touched, dashed, different tint). The
      predicates live in `src/boxselect.ts` — screen-space, no canvas, no
      state, on top of `intersect.ts` so a box and a click agree about where an
      arc stops. Names drop into the command line quoted and comma-separated,
      exactly as clicks do. Empty box inserts nothing; Escape cancels; glyphs
      are not selectable; a press on a point still drags and a press on other
      geometry still pans. **The register entry above was reversed by this
      package**, with the reversal noted there for the owner to veto.
      *Decided while doing it:* `boxselect.ts` is a fourth peer beside
      `picking.ts` rather than a function inside it, because picking is
      dominated by *choosing* (tiers, tolerances, nearest wins) and a box
      chooses nothing — it takes everything that qualifies. It projects
      entities to screen curves itself rather than borrowing snapping's
      private helper, which would have been a lateral import between peers;
      the piece that genuinely must not be duplicated, the arc-sweep test, is
      already below in `intersect.ts` and is what both use.
      *Discovered while doing it:* **Escape was bound to the command input,
      and a mouse press on the canvas blurs it** — a canvas is not focusable,
      so focus falls to the body — which made Escape deaf during exactly the
      gestures it exists to abandon. Never noticed because every earlier
      Escape test had picked something first, and `insertToken` re-focuses the
      input. It is on `window` now, the same reasoning that already put Ctrl+Z
      there. Found by writing the box-cancel browser story, not by reasoning.
      *Left for later, deliberately:* a box catches only what is on screen, by
      construction (the rectangle is pixels); there is no shift-to-add,
      because there is no selection set to add to; and edge-dragging is still
      a pan, which is now the only leftover from the old mouse map and is
      listed under "Next up".

- [x] **Snap to intersections** — spec:
      [`docs/plans/intersection-snap.md`](docs/plans/intersection-snap.md),
      now marked shipped-pending-review. Crossings slot between exact points
      and midpoints in the snap tiers; `src/intersect.ts` holds the three
      closed forms and the arc-sweep test, which moved down out of
      `picking.ts` so snapping and picking cannot disagree about where an arc
      stops. The point of the feature is the inference: a point placed on a
      crossing gets BOTH on-curve relations, so it rides the intersection when
      either curve moves. Marker is an ×; `Snap.target` became
      `Snap.targets: string[]`.
      *Decided while doing it:* the algebra is in **screen space**, not world
      space — every caller asks in pixels (the prefilter distance, the 8px
      tolerance, picking's screen-angle sweep test), the view transform is
      affine with a uniform scale so the exact screen crossing maps back to the
      exact world crossing, and world space would have meant a second angular
      convention for the one test that must not have two. And degeneracy is
      judged in **pixels between the two candidate roots** (`TANGENT_EPS`,
      0.05px) rather than on a zero discriminant: a tangency the solver
      actually holds has residual ~1e-11 but root separation ~1e-3 px, so an
      exact test never fires.
      *Rejected:* keeping a `target` field alongside `targets` as a
      compatibility shim. Four call sites, and two fields that can disagree is
      a worse trade than a rename.
      *Left in place deliberately:* the along-a-curve tier still treats an arc
      as its whole circle, as it always did — only crossings are gated by
      sweep. Snapping along a rim is more forgiving than picking one, and
      tightening it was not in this spec.

- [x] **Constraint glyphs** — spec:
      [`docs/plans/constraint-glyphs.md`](docs/plans/constraint-glyphs.md),
      now marked shipped-pending-review. One mark per relation beside the
      geometry it constrains (`src/glyphs.ts` computes the placements and
      nothing else — no canvas, no pointer, no state); hovering one names the
      relation on the hover tag *and* lights up every entity it constrains;
      clicking one drops its name into the command line exactly as clicking
      geometry does. Glyphs are the top picking tier, above points, and take
      no part in snapping. Anchors are world-space, offsets screen-space;
      marks sharing an anchor stack in a row and there is no layout engine.
      `glyphs()` / `glyphs(true|false)` on `help()`, default on.
      *Decided while doing it:* the spec's symbol table was re-judged in a
      browser at real size, as the spec asked — `coin` moved from `◦` to `○`
      (`◦` is two pixels across and reads as dirt), `on`/`oncircle` from `◦`
      to `●` (the spec gave them the same mark as `coin`, which cannot be
      right), `fix` from `⚓` to `#`, and `dist`/`arcends` gained marks they
      were never given. Tofu was ruled out by bitmap identity against a
      codepoint no font has; **advance width cannot detect it in a monospace
      stack**, where present and absent measure identically.
      *Discovered while doing it:* a relation typed at the command line does
      not re-solve, so the header can go on reading `SOLVED` while the drawing
      violates the constraint just added — the stale-readout family this
      project has been bitten by before. Pre-existing and untouched here (it
      is why `del` re-solves through the host), and it is listed under
      "Smaller things" below.
      *Left for later, deliberately:* per-relation and per-kind hiding, leader
      lines from a mark to its geometry, and any real layout pass. Crowding on
      a busy drawing is genuine and `glyphs(false)` is the v1 answer to it.
- [x] **Relation identity + deletion with cascade** — spec:
      [`docs/plans/constraint-deletion.md`](docs/plans/constraint-deletion.md),
      now marked shipped-pending-review. Relations are registry entries named
      `r1`, `r2`, … built by one wrapper (`model.relation`) that every
      function in `relations/` is a single call to; `Problem.addResidual`
      returns a monotonic `BlockHandle` and `removeBlock` spends it (the only
      kernel change); `del(name)` deletes an entity or a relation with
      Onshape's cascade and returns what it took; deletions journal as
      `deleteEntity` / `deleteRelation`, one per name; `rels()` and `del()`
      are on `help()`; the hover tag names the relations on whatever is under
      the cursor. Variables are tombstoned rather than compacted, and the leak
      is documented in `STATUS.md` and pinned by tests.
      *Discovered while doing it:* `concentric` and `arcEndpoints` are written
      in terms of `coincident` and `onCircle`, and **both** calls journalled —
      so reopening a file containing either quietly applied the inner
      constraint a second time. Nothing caught it because the round-trip tests
      compare entities and coordinates, and a duplicated identical residual
      only doubles a weight that is already satisfied. The registry made it
      unignorable (two entries cannot both own the same blocks), and the fix
      is that a relation defined in terms of another is *one* relation.
      Also found: a relation that throws part-way has to roll back its blocks
      *and* the name counter, or a replay — which performs only the calls that
      succeeded — names everything after it one step out.
      *Left for later, deliberately:* variable compaction (remapping every
      captured index list inside every closure is a different piece of work
      with a different risk profile); constraint glyphs on the canvas, which
      are the follow-up above; and `del` of several names at once, which wants
      box-select more than it wants a signature change.
- [x] **Undo/redo** — Ctrl+Z / Cmd+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo,
      `undo()`/`redo()` do the same through the same host handles. A stack of
      whole-model snapshots (`src/undo.ts`, cap 100, pushing clears redo),
      where a snapshot is the text `save()` writes — it already carries the
      journal *and* the values, already restores through `open()`, and compares
      as a string. Journal-truncation undo was considered and rejected: a drag
      is not journalled, so it would need value snapshots as well.
      One step is one *user action*, decided in `main.ts` by comparing the
      snapshot before and after — nothing lists which commands are edits, so
      `ls()` and `help()` stay out of the history by arithmetic rather than by
      enumeration. The engine gained one neutral callback,
      `onUserAction("before"|"after")`, and still has no idea undo exists.
      *Discovered while doing it:* the pairing of that callback has to be the
      engine's job, not the host's, because only the engine knows every way a
      gesture can end — released, cancelled with Escape, or abandoned because
      the model was swapped out mid-drag. An unpaired `before` strands the
      host's bracket with no symptom until the *next* action silently goes
      unrecorded, which is the kind of bug that is found weeks later. Also
      found while in there: a drag whose model is swapped out from under it
      wrote to a cleared `idle` on the next pointer move — a live TypeError,
      now fixed.
      *Left for later, deliberately:* history is per-session and is **not**
      saved, so a reopened file starts with an empty stack; restoring replays
      the whole model, so undo costs what opening the file costs (fine at
      present sizes — measure before optimising); a view change is not undoable,
      the view not being part of the model; and ~~while the command input
      holds uncommitted text Ctrl+Z belongs to the browser's text undo, not the
      model~~ — retired by the owner, 2026-10-29 (see "Undo and redo,
      bulletproof" above and the register entry).
- [x] **Dragging geometry** — with nothing armed, press a point and pull; the
      model follows the cursor while every constraint holds. `Problem.solve()`
      takes `extra?: ResidualBlock[]`, temporary residuals evaluated for one
      solve and stored nowhere, and each pointer move solves with a soft pull
      (w = 0.12) toward the cursor. Extras are kept out of the offender report,
      or every drag would read `CONFLICT`.
      *Discovered while doing it:* a pull that cannot be satisfied does not
      stall against the constraints, it trades against them — least squares
      weighs everything at once — so a cursor held far past where a point can
      go leaves the drawing a little out of true until release. Invisible at
      ordinary cursor distances, and the settling solve undoes it exactly; it
      is the reason mid-drag frames must not touch the status line.
      Abandoning a drag (Escape, or opening a file mid-gesture) settles it with
      one ordinary solve rather than dropping it, or the cursor's pull stays
      baked into the geometry and the status line is stale.
      *Left for later, deliberately:* only points drag (edges and rims still
      pan), nothing is inferred or snapped mid-drag, and there is no undo — for
      now a drag is undone by dragging back.
- [x] **The line tool** — click-click with Onshape's chaining: the committed
      end *is* the next segment's start, the same entity, so nothing needs
      joining. Nothing is committed until the second click, so an abandoned
      chain leaves no stray point. Horizontal/vertical inference within 3° of
      an axis, in the line form, with an endpoint snap taking precedence.
      Escape ends the chain and keeps what was drawn.
      *Discovered while doing it:* the chain is dimension-generic (it is only
      points and lines), so the tool works in a 3D model and simply infers no
      axis there — and writing that test caught a real bug, a degeneracy check
      that measured only the first two coordinates and so refused every
      segment that moved in z alone. (↻ Since 3D phase 1's camera half it
      *does* infer in 3D, against a 3D default frame's axes in its plane.)
- [x] **Constraint inference** — a tool that places a point on existing
      geometry applies the relation that implies (`coin` on a point, the line
      form of `mid` on a midpoint, `on`/`oncircle` on a curve), so a rectangle
      drawn from another's corner genuinely follows it. `snapping(false)`
      turns it off with snapping, one switch, as in Onshape. There is no
      "weld": two points stay two points, joined by an ordinary constraint.
      *Discovered while doing it:* `midpoint` was point-form only and now has
      the lazily-resolving line form `mid(m, "l1")` beside it, the same
      distinction `hor`/`ver` already drew. And a coincident constraint
      between two *free* points splits the difference on solve rather than one
      following the other — which is correct least-squares behaviour, and the
      reason the tests pin one end with `fix` before asking whether the other
      followed.
- [x] A working `npm run typecheck`, and three smaller fixes alongside it
- [x] Snapping — a tool's cursor is pulled onto points, midpoints and curves
- [x] The fillet tool — click two edges to round the corner
- [x] Picking and hover — click geometry to drop its name in the command line
- [x] Browser verification in the repo as `npm run test:e2e`
- [x] Contributor docs: CONTRIBUTING, docs/ARCHITECTURE, CLAUDE.md
- [x] Mouse navigation — wheel zooms about the cursor, drag pans
- [x] Save and open as ordinary commands
- [x] The `fillet` operation
- [x] Circle and arc drawing tools
- [x] The REPL — tools and relations authored at the command line
- [x] Viewport control as ordinary commands
- [x] Circle and arc entities
- [x] The rest of the sketch relation vocabulary
