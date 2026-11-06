# ZeroCAD — status

A general nonlinear least-squares solver (Rust/WASM kernel, automatic
differentiation for exact sparse Jacobians) with a runtime-extensible
TypeScript tool-authoring layer on top. 2D CAD sketching is the first
"standard library" built on it — see the overnight brief below for the
full architectural intent (N-dimensional-capable kernel, tools defined
at the command line in the same language the app itself is written in,
etc).

## What's working right now

- **Version 0.1.0, hosted** at https://brothercreamy.github.io/zerocad/ — an
  installable app (manifest, icons, an offline cache) published from the
  public repository `BrotherCreamy/zerocad` by `.github/workflows/pages.yml`
  on every push to the working branch. Called NeoCAD until 0.1.0; the
  internal code name stays in identifiers, the file format tag and storage
  keys (see TODO.md's register).
- **The spline** (docs/plans/spline.md, built). The owner: *"give me better
  sketch tools, relations, trim, slot... all the usual"*. A cubic B-spline
  **through** points you click and drag (Onshape's, not a control polygon),
  open (natural ends) or closed (C² round the seam), centripetally spaced,
  named `sp1`, `sp2`, …: the **spline tool** under the **curves** button
  beside the ellipse (a second click on the last point, Enter or ✓ ends it;
  a click on the first closes it), or typed `spline("p1", "p2", [10, 5], {
  closed })`. Its points are ordinary points; the curve's control points are
  its own variables, held to pass through them by equations the entity
  **owns** — made, deleted and journalled with it (ARCHITECTURE.md).
  `onspline(p, sp1)` (a point sliding on it, by a parameter of the
  relation's own); `tan` at an end with a line, an arc or circle, or another
  spline. The menu on the curve: Add point here, Remove point pN
  (`addThrough`, `removeThrough`). It draws within a quarter pixel and no
  chord turning more than 2°, picks and snaps; cuts lines, arcs and circles
  it crosses; mirrors and patterns; is a whole profile edge, closed loop or
  hole for extrude and revolve (exact B-rep: surfaces of linear extrusion
  and of revolution over the spline's own `B_SPLINE_CURVE_WITH_KNOTS`; the
  solid kernel takes it as its exact NURBS); sweeps surfaces. Trim, extend
  and offset of a spline itself, and part of one in a region, are refused by
  name (the spec's table). STEP read valid by OpenCascade 8.0.1, volumes the
  closed forms to 3·10⁻¹¹ (`test/fixtures/step-spline/`). Format 18. Unit:
  `test/spline.test.ts` (12), `splinesolids` (9), `splineedit` (8),
  `stepspline` (6); browser: `test/e2e/spline.e2e.ts` (7, mouse and iPhone
  13). *Not tried on a phone.*
- **Surfaces** (docs/plans/surfaces.md, built). The owner: *"please add
  solid and surface fillet tools if possible"*, *"also fillets and chamfers
  for surfaces."* A surface is a thing — a sheet the solid kernel builds, no
  inside — named `s1`, `s2`, … in `model.surfaces`, listed under the
  organiser's Surfaces, hideable, drawn two-sided with the kernel's edges.
  Made by `surface(...)`: a curve chain extruded or revolved, the planar
  face a loop or region bounds, or a body's face (`surface("e1.lid")`), and
  by the **surface tool** under the extrude button (the **sweep** group).
  Changed only by operations, each a record in its chain: `trim(s, by,
  point)` (a curve projected along its plane's normal, or another surface;
  the side the point is on kept; the trim tool pressed on a surface),
  `extend(s, edge, d)` (the sweep lengthened), `knit(s, t, …)`, `offset(s,
  d)` (a new surface), `thicken(s, d)` and `solidify(s)` (a solid), and the
  **fillet and chamfer** of a surface's shared edges or between two surfaces
  (each trimmed back to the other, knitted, blended — the round and chamfer
  tools, one pick or two). `trim`, `extend`, `offset`, `fillet`, `chamfer`
  are shared with the sketch: a surface first is the surface's, journalled
  under its own op (`trimSurface`, `filletSurfaces`, …). Dimensions
  `surfaceDepth`, `surfaceAngle`, `surfaceDistance` (and the fillet's
  radius) are set like any. The context menu: Thicken…, Offset…, Knit with
  sN, Solidify, Delete; an open edge's Extend…. STEP writes a sheet as an
  open shell in a `SHELL_BASED_SURFACE_MODEL`, a thickened one as a solid —
  read valid by OpenCascade 8.0.1, areas and volume the closed forms to
  ~10⁻⁸. A surfaces workbench (the part's modules). Kernel: SMLib's caps-off
  sweeps, project-and-trim, intersect, stitch, offset and edge fillet on
  sheets; thicken, the planar face and extend built around what it does not
  do (the spec's *As built*). Unit: `test/surfaceskernel.test.ts` (12),
  `test/surfaces.test.ts` (16), `test/stepsurfaces.test.ts` (3); browser:
  `test/e2e/surfaces.e2e.ts` (8), `test/e2e/surfacesphone.e2e.ts` (6,
  iPhone 13). *Not tried on a phone.*

- **Touch targets that follow the interface size** (docs/plans/touch-density.md,
  built). The owner: *"the text resizes but the spacing between e.g menu
  items and toolbar items barely changes … the white space between eg the
  tools on the tool palettes is a bit too much"*. Under a finger every
  target is `target(m)` (`panels.ts`): 44 at the device's 100 %, in
  proportion to the spin box, never under 32 — `var(--target)` in every
  coarse-pointer rule, set by `main.ts`. A tray's tool is drawn at 0.8 of
  it (`TRAY_SHARE`; 35 px at 100 %, glyph 26). A pane bleeds only into the
  bottom inset (`bleed`). A stored layout a rotation cannot hold is
  re-fitted, said and not stored (`refit`), never drawn with panes over
  panes. The chip keeps the verdict's line until its fade has ended. The
  fillet label's drag keeps the direction it was pressed in (`blend.ts`).
  Unit: `test/touchdensity.test.ts` (7); browser:
  `test/e2e/touchdensity.e2e.ts` (14: four devices × both ways × three
  sizes, the verdict on all 36 ways, the side edges, the re-fit).
  *Not tried on a phone.*

- **Sketch editing** (docs/plans/sketch-edit.md, built). The owner: *"give
  me better sketch tools, relations, trim, slot... all the usual"*. Seven
  operations in `src/sketchedit.ts`, each journalled as its call with what it
  read off positions resolved, each one undo step, replayed: **`trim`** (the
  piece between the cuts either side of a place goes; an end re-pointed and
  held `on` the cutter, a middle piece leaving two held `col`, a circle an
  arc under its name; the features on it regenerated, or the trim refuses
  having tried and taken itself back — `Model.nameCounters`), **`extend`**
  (an end on to the next curve along it, held there), **`offset`** (a chain's
  parallel copy: `par` + `dist`, arcs about the same centre, corners joined),
  **`mirror`** (`sym` about a line or a frame axis), **`chamfer`** (the
  corner cut by a line, the corner point kept at the corner by
  `intersection`, the ends `dist` from it), **`linear`** and **`circular`**
  (copies `l1_2 …`, held by `translated`/`rotated`/`rotation`,
  relations/pattern.ts, one dimension driving each). Where curves cross is
  `src/sketchgeom.ts`. Six tools under modify — trim, extend, offset, mirror,
  **bevel** (the sketch's chamfer; `chamfer` is the solid's tool) and pattern
  (`src/tools/`). Unit: `test/sketchedit.test.ts`, `test/sketchedittools.test.ts`;
  browser: `test/e2e/sketchedit.e2e.ts` (mouse and iPhone 13). *Known and
  deliberate:* an ellipse is not trimmed and cuts only lines; an offset's
  distances are a dimension per piece, and a `rad` of r ± d does not follow
  the original's radius; a curve nothing cuts is `del`'s, not trim's. *Not
  tried on a phone.*
- **See-through panels and a lock** (docs/plans/panels-overlay-lock.md,
  built). The owner: *"a menu option to make the toolbars transparent to
  maximize visible viewport size. and also another option to lock the
  toolbars in place"*. `panels({ overlay: true })`, `panels({ locked: true })`,
  `panels()`, and the logo menu's View boxes; the viewer's, under
  `neocad.panels.switches.v1`, never journalled. See-through, every pane but
  the options panel keeps its rectangle and draws its content in a form of
  its own: the tray's buttons; the organiser a tree in its corner
  (`organiserTree`: a root per body with its chain, Groups and Regions,
  collapsed, ▸ to open); the log's last three lines (`logtail.ts`, gone at
  10 s); the command line's input on an underline. Only content takes a
  press. A halo in the ground's colour (10–16.5 : 1 over a light lid,
  measured). A mouse over a pane gives its box back; a press on its content
  shows it docked until a press outside. Locked: no strip or grip drawn, a
  locked `Drag` moves and pushes nothing, the chip says why; a rotation that
  needs a re-fit says so. Unit: `test/overlaylock.test.ts` (10); browser:
  `test/e2e/overlaylock.e2e.ts` (12), and the fits suite with each switch.
  *Not tried on a phone.*
- **Android** (docs/plans/android.md, built). The owner: *"obv this whole
  platform should also work on android"*. The device table
  (`test/devices.ts`) has eleven Android rows — Pixels 7, 8, 9 and their
  Pro sizes, Galaxy S23/S24, a Fold 7's two screens, two tablets — each
  installed with the gesture bar, with three buttons and in a Chrome tab;
  everything fits on all 66, with the keyboard up. The interface size reads
  Android's font scale from `env(preferred-text-scale)` (`uiscale.ts`).
  Android's **back** closes what is open, and at rest does nothing
  (`backstack.ts`; one seam with Escape). The panel being typed into rides
  above the keyboard (`keyboard.ts`). **Install app** in the logo menu
  (`install.ts`, `installApp()`), the manifest's screenshots and
  `launch_handler`. Every file path falls back and says which door it used;
  Chrome on Android refuses a `.json` share, so Share downloads there.
  Tested in Chromium under the Pixel 7 and Galaxy S24 descriptors and
  Samsung Internet's user agent; Firefox for Android and Samsung's browser
  untested. `npm run measure:android` measures the mode chip's
  `activePlane` and the Worker's start under round.
- **Regions as operations** (docs/plans/regions-as-operations.md, built). The
  owner: *"there should be no such thing as a negative face. a face is just a
  face"*. A **face** is a closed loop's whole inside, found; a **region**
  (`rg1`, `model.regions`, `RegionEntry`) is its chain: `region("l1")`, then
  `subtract`, `add`, `intersect` (operations.ts), each journalled with its
  face resolved and what it rebuilt, one undo step. The algebra is of the
  cells of the faces a region names (`regionValue`, nested by `within`); a
  face added beside merges into one outline (`mergedBoundary`). **A feature
  takes a region** (`extrude("rg1", 10)`, its record's `region`); a bare face
  makes one on the way; several may share one, and a step regenerates them
  all. **Nothing is proposed as a hole** any more: the extrude and revolve
  tools take the face a click is in, whole, or the named region it is
  inside. **The region tool** (`src/tools/regiontool.ts`, shapes button): a
  click makes a region, later clicks Subtract / Add / ∩ / New by the mode
  row, read on the region's plane. **The organiser's Regions**, *Edit rg1*
  (`edit("rg1")`), *Extrude rg1*, Delete; a standing region tinted violet.
  `hole`/`unhole` are aliases of the step. **Deleting a face a region names:
  the region loses it** (`deleteRegionSteps`); its first face going deletes
  the region (`deleteRegion`). **Format 17**: an older file's holes open as
  region steps (`src/regiontranslation.ts`), the model unchanged — proved
  per fixture against the file replayed with the translation off. Unit:
  `test/regionsops.test.ts` (22); browser: `test/e2e/regionsops.e2e.ts` (6,
  mouse and iPhone 13). *Known and deliberate* (TODO.md): see the spec's
  *As built*. *Not tried on an iPhone.*
- **Workbenches: the app as modules, and Add workbench…**
  (docs/plans/workbenches.md, built).
  - **Modules.** `src/modules.ts`'s `defineModule` fills every table — glyphs,
    groups, menu tool items, File items, the relation vocabulary, the replay
    table, `help()` — from eight built-in modules in `src/modules/` (core,
    sketch, solids, surfaces, files, step, organiser, interface), loaded by
    `modules/builtin.ts`. A name two modules register is refused, whole.
    `modules()` lists them.
  - **The entity extension point.** `EntityKindSpec` (`model.ts`) and its
    facets in `curveplane.ts` (frame), `picking.ts` (hover line), `step.ts`
    (curve writer), `projection.ts` (sampled polyline); the ellipse is
    declared by the sketch module (`src/kinds/ellipse.ts`) and named nowhere
    in `model.ts`, `loops.ts`, `faces.ts`, `picking.ts`, `step.ts`,
    `curveplane.ts`. Its minor and normal now count in the diagnosis.
  - **Workbenches**: part (default, today's tray), sketch and surfaces; the logo menu's
    Workbench section and `workbench(name)`; remembered in a file's head
    (format 16).
  - **Add workbench…**: a `.zerocad.js` from the device's picker, a drop or
    `loadModule(url)`; its manifest shown before anything runs; kept in
    IndexedDB and loaded at every start; Share… and Remove. A drawing records
    the added modules it needs; opened without one, it says so, opens the rest
    and offers Add workbench….
  - At the command line: `defineModule`, `defineWorkbench`, `defineRelation`,
    `defineOperation`, `defineEntity`.
- **Mode feedback** (docs/plans/mode-feedback.md, built). The plane being
  sketched on is drawn (`src/activeplane.ts`): the face it was taken from is
  tinted and outlined in the tools' green, fainter and dimmed from behind
  the solid, and a frame made the work plane is a patch with a grid that
  follows the zoom (a default frame alone is named, not drawn). What is held on the plane by relation is in full ink, and the rest
  is drawn one step dimmed. **The mode chip** (`src/modechip.ts`, `#mode`,
  first in the status's corner) says where · what · next — `on e1's top ·
  circle · drag the radius`. Every tool says its stage through `Tool.next`,
  and guidance is said in the chip rather than the status's note. **Done**
  (`workplane(null)`, typed) ends the plane and leaves the camera; the
  plane's name opens Look at, Change… and Done. A ghost dot sits at the
  mouse for placing tools, the line's chain is in the green until it ends,
  and the fillet lights its corners (`Tool.takes`, `Tool.placed`). The
  verdict is never cut for the chip, and the chip is over no pane on any
  iPhone in the table.
- **Sketch relations: diagnosis, a dimension tool, a constrain tool**
  (docs/plans/sketch-relations.md, built).
  - **Diagnosis.** `Problem.analyse` asks the kernel's `null_support`
    (kernel-rs/src/analysis.rs: per-component dense elimination) for the
    Jacobian's rank: free variables from J (with gauge rows), redundant rows
    from Jᵀ. `Model.diagnose` maps them to entities (`free`, `dof`) and
    relations (`redundant`); `Model.conflicting` maps a failed solve's large
    rows (`SolveReport.blocks`) to relations. Not counted free: a curve's
    normal length; a point lying on the drawing plane or the ground.
  - **In the app**, after each solve and never per drag frame: free
    entities in a blue ink, held ones in the sketch's; `#diagnosis` beside
    the verdict says `5 free`, `d1 · d2 cannot all hold` (red, names
    clickable to select, then Delete) or `· redundant r5` (orange); a
    conflicting or redundant relation's glyph wears that ink. 2.1 ms on the
    biggest fixture.
  - **Relations**: `col`, `intersection`, `pierce` (3D), `spacing`, `dia`
    (a dimension), `measure` (driven: no blocks, drawn in parentheses, live),
    `dist` point–line and line–line, `eq` circles and line–arc, `mid(p,
    arc)`, `horizontal`/`vertical` (journalled as `par` to the default
    frame's axis; an axis `par` wears `—`/`|`); `deg(x)`. `tan` at a shared
    end is a join form (exact, where the distance form was a double root).
  - **Tools**: `dimension` (pick, then empty canvas; options diameter,
    driven) and `constrain` (picks or the selection; the options panel lists
    `constraintsFor` as rows), each its own button — thirteen buttons. One
    rounding for the tool and the menu (`dimensioning.ts`). The selection's
    context menu has the same Constrain list.
- **Solids on SMLib: bodies that add, cut and intersect**
  (docs/plans/solids-kernel.md, built). NVIDIA's SMLib is built from pinned
  source (`npm run build:solids` runs `scripts/solids/build.sh`, output in the
  gitignored `src/solids/smlib-gen/`). It runs in a Worker behind
  `src/solids/client.ts`, which replaces it on a crash, after 30 s without an
  answer, or past 256 MB.
  - **Modes.** `extrude` and `revolve` take `{ mode: "new" | "add" | "cut" |
    "intersect", into }`; the tools have a mode row (New Add Cut ∩).
    - The default, decided at the call and journalled resolved
      (`src/modes.ts`), is Add when the solid touches or overlaps a body, and
      New otherwise.
    - Cut is offered, never defaulted.
    - Format 14; `new` is journalled as nothing, so a file with no boolean is
      unchanged.
  - **Bodies.** A body is its chain in creation order, named by its first
    feature, and listed in the organiser's Bodies section (`src/bodies.ts`).
    - A body of one feature is drawn by `faces.ts` as before.
    - A body of two or more is the kernel's: its tessellation becomes
      `faces.ts` faces with names and edges attached. It is picked from the
      kernel's triangles, and sketch on face works on any planar face.
    - The last good body is drawn until each answer arrives, and refusals and
      vanished faces are said in the log.
  - **Names.** Faces are named by the tag the kernel carries (`e3.lid`,
    `e2.m0`) and edges by their two faces (`src/solids/naming.ts`); they are
    measured stable through topology changes (`test/solidsidentity.test.ts`).
  - **What stays relational.** The twins stay solved entities, the skeleton
    the dimensions hold, and are quiet in a kernel body.
  - **STEP.** `exportStep` writes a kernel body as one solid
    (`src/kernelbrep.ts`). Its surfaces are analytic by tag, with B-splines
    elsewhere. Four boolean parts were read back by OpenCascade
    (`test/fixtures/step-kernel/validated.json`).
  - **Packaging.** The PWA carries the kernel as cached files of its own, the
    single file carries it inline, and About carries its Apache-2.0 notice.
  - **CI.** The Pages workflow and the `solids` workflow build the kernel,
    cached by the recipe's hash. A cold build takes 6 m 51 s, a warm one 16 s.
  - **Known gaps** are in TODO.md's Done entry. Among them: kernel edges are
    not constraint targets (they are hover, selection and fillet targets
    since solid-fillets.md), and a full revolve drilled through its seam
    fails OpenCascade's strict read.
- **Fillets and chamfers of a body's edges** (docs/plans/solid-fillets.md,
  built).
  - **Kernel edges pick.** Each is named by its two faces (`e1.lid|e1.m0`,
    `src/kerneledges.ts`). The hover names it; a click, shift and a box select
    edges (`Selection.edges`); a right-click offers Fillet… / Chamfer…. An edge
    outranks the skeleton it lies along, but a press still drags that skeleton.
  - **Blends are features in the body's chain.** `fillet("e1", [edges], r)`
    and `chamfer(...)` (`src/blends.ts`, journalled `filletEdges` /
    `chamferEdges`; `setEdges` to change the list) make a `BlendFeature` in
    `model.blends`. Its size is a dimension with no equation
    (`src/relations/blend.ts`). `Chain.steps` orders blends among the sweeps.
  - **Evaluation.** Edges are found by name in each rebuild. The faces made are
    tagged `e3.f0` … by the edge they came from. A missing edge is said and
    left out. A blend that the kernel refuses is left out, and the body without
    it stands.
  - **Tools.** `round` and `chamfer` are on the modify button, with edit
    dialogs `edit fillet` and `edit chamfer` (`src/tools/blend.ts`). The kernel
    previews the result (`Bodies.trial`), and the radius label on the drawing
    drags.
  - **STEP.** Blend faces are B-splines. Three parts are validated by
    OpenCascade, healed and strict.
  - **Memory.** 200 rebuilds peak at 46 MB of the 256 MB recycle threshold.
  - **Known gaps** (TODO.md):
    - SMLib will not fillet an edge that runs into an earlier fillet.
    - Facets show at a close zoom.
    - No variable radius, face fillets or two-distance chamfers.
- **No title bar** (docs/plans/chrome-logo-scale.md, built). The drawing is
  the whole window; the logo (`src/logo.ts`, also the home-screen icon's
  source) sits top-left inside the safe area as the one panel nothing moves,
  with the status beside it (`src/statusline.ts`: `ready`/`SOLVED` fade, a
  conflict stays), and opens the app menu (`src/appmenu.ts`: File, the
  interface size's spin box, a box per pane, View, About — every control
  typing through `submit`). **The interface size** (`src/uiscale.ts`) is each
  device's 100 % — 1 under a mouse, 1.3 on a phone, 1.15 on a tablet, times
  the person's text size — times the viewer's multiplier, stored per device;
  `touchMetrics` draws a finger's controls at that size and hits them at
  44 px; `View.ui` carries it to the glyphs, labels, points, frame markers
  and snap marks; picking's reach is never scaled. `ui({ scale })`,
  `ui({ hide })`, `ui({ show })`, `ui()`. **Panels to the edge**: the area is
  the safe area, and a panel touching an inset edge reaches under it, padded
  (`bleed`). **Docking**: a moved panel is stored (`neocad.panels.v3`, v2
  migrated) as what each side rests against, and re-laid by that in any area
  (`relaid`), so a rotation keeps it. The installed app's status bar is
  `default` (iOS 26 blurs a translucent one).
- **Everything fits** (docs/plans/everything-fits.md, built). A tray is one
  line where one fits the room along it (`trayRoom`: the area's, less the
  logo's corner) and wraps onto two or three where it does not
  (`trayLines`/`traySize`, a floor of lines in `Placed.lines`, the stylesheet
  a grid of `--per` buttons); a rotation wraps it rather than turning it,
  and a pane beside it stays along it (`relaid`). The phone's defaults
  (`touchLayout`) overlap nothing on every iPhone in `test/devices.ts`, both
  ways up, installed and in Safari, and keep out of the corner's box
  (`cornerBox`); the status wraps in the room the panes leave it
  (`cornerRoom`); a layout the resolver cannot find is reported
  (`layoutProblem`), an error in development. The organiser is shown from
  the start everywhere. A held tooltip keeps off its whole tray
  (`tipPlacement`'s `line`).
- **Panels reshuffle rather than push** (docs/plans/panels-reshuffle.md,
  built; the owner: *"reshuffle rather than push"*). A drag by the strip is
  resolved by `reshuffled`: each edge's panes are a sequence read from their
  positions at the press (`sequences`; on an edge = within `reachOf`, 16 px
  at a mouse's 100 %, 22 at a phone's; never both of an opposite pair). Along
  an edge it was on, the held pane past a neighbour's middle takes its slot
  (`reordered`: the stretch laid out again, ends and gaps kept); brought to
  another edge it is inserted between the two it lands between, those after
  making room (`inserted`), a tray turned in its ghost; with no room a second
  line (`wrapped`); on no edge, its middle on a floating pane, the two trade
  places; and **the others make room** — a pane any of those lies on goes to
  the nearest place on nothing (`madeRoom`, `nearestFree`), the old push's
  zero-motion search the fallback, then the unkept panes laid again
  (`relaidAround`); refused only where none finds room — the held pane's
  ghost at home saying *no room on this edge*, the status the same at the drop
  (`Drag.refused`, `NO_ROOM`, `NO_SWAP`): 5 % of random drops upright on a
  phone, 1 % on its side. Along the top the corner is `cornerBox`. Elsewhere
  it lands at the furthest point toward the hand on nothing (`landing`). A
  resize and `apply` keep `pushed`. Storage is unchanged. Tests:
  `test/panelsreshuffle.test.ts`, `test/e2e/panelsreshuffle.e2e.ts`.
- **A dragged panel previews; nothing moves until the drop**
  (docs/plans/panels-preview.md, built). **The preview is the drop at this
  spot**: at each move a gesture (`Drag` in `panels.ts`) asks the resolver
  for one step from the layout at the press straight to the hand
  (`dragTo` → `reshuffled` for a strip, one `dragStep` for a grip), so any spot shows the same ghosts however it
  was reached, and the press shows none. It draws the held panel where the hand has it
  (`heldAt`: under the grab, inside the area, over whatever it is over, a
  tray keeping the way it ran), and draws a solid, slightly translucent white **ghost** for each panel
  the drop would move and for the held one's landing where that is not under
  the hand (`ghostsOf`; the `.pghosts` layer, lifted with the held panel
  over the logo's row for the drag). From the first move every other panel
  is at half opacity (`dragging` on the area). The drop commits the preview
  (`dropOf`) and the panels glide onto it for 120 ms (`settling`, a CSS
  transition; the rectangles are final at once). Escape (the drag's alone),
  a pointercancel, a lift within 2 px (a mouse) or 8 px (a finger) of the
  press, and a refused preview commit nothing; a refusal says so in the
  status. Resizes by a grip preview the same way. Measured on an emulated
  iPhone 13 (`npm run measure:panels`): the move handler 0.5 ms median at
  1× CPU and 1.9 ms at 4× (p95 4.1–4.5), the resolver alone under 0.1 ms
  median (p95 0.6–0.7 at 4×); the class costs no frame at the median (16.7 ms
  either way).
- **Tooltips on every control; frames in RGB**
  (docs/plans/tooltips-rgb-frames.md, built). `src/tooltip.ts` is one
  tooltip element for every icon or short-word control — the toolbar, the
  action strip, the options panel's ✓ ✗, the spin box, the organiser's ＋,
  eyes and markers, every panel's strip, the logo — saying the name, what it
  does (`tipText`), the command it types and its key; after 400 ms of a
  mouse's hover (at once from one control to the next), or a finger's 500 ms
  hold, whose lift then presses nothing. Placed by `tipPlacement`: beside a
  column, below anything else, above a finger and clear of it, inside the
  safe area. Each piece of chrome is handed `tooltips.attach` by `main.ts`
  and knows nothing more; without it a control keeps a `title`. The words are
  the tools' own `static summary` (`toolSummary`, never inherited; Select's
  and the Hand's in `ENGINE_SUMMARIES`), read by the tooltip, `tools()` and
  `help()`. A frame's arms are drawn in `AXIS_INKS` — x `#ee6040`, y
  `#60d658`, z `#5b9cff` — lettered in the same ink, amber when lit, violet
  when selected; the default frame is heavier.
- **A circle is just a circle: curves carry their own normal, one origin, no
  frame made for you** (docs/plans/frameless-curves.md, built). A 3D
  `CircleEntity`/`ArcEntity` owns `normal`, three solver variables read
  normalised (`unitDuals`, `curveNormal` in `relations/refs.ts`) — no
  normalisation residual, the length a gauge; `addCircle(c, r, normal?, name)`
  and `addArc(…, r, normal?, name)` take a seed (three numbers, or a plane
  reference to face), `normalOf`/`setNormal` read and set it, `values.normals`
  saves it. `curveplane.ts` answers from the curve (`curvePlaneOf`, `spanOf`);
  `onCircle`, `tangent` and `arcEndpoints` declare the normal; `par`/`perp`/
  `ang` read a curve as its normal (`directionOf`). **`ORIGIN`** (`"origin"`)
  is a built-in fixed frame — no entity, not journalled, undeletable, drawn
  first in RGB, picked last — and what `fix`, `onplane` and `xaxis()` mean
  with no default. **Plane references** — a frame, a curve, or `"p1.p2.p3"` —
  are read by `Model.planeKind`/`planeValues`, `planeBasis` (a datum) and
  `referentsOf` (the cascade). **The work plane** (`Model.workPlane`,
  `setWorkPlane`, journalled; `workplane(ref?, {look})` at the command line)
  is what sketch on face sets; `drawingPlane()` is it, else the default, else
  the origin. **The curve tools** (`CurvePlane` in `tools/place.ts`) draw on
  the chosen plane, else the solid face under the first click, else the
  ground, and hold the curve there with `onPlane` and `par`. **Features**:
  `orientingPlane` picks extrude's and revolve's plane and makes nothing;
  extrusion and revolution pair twin rims' normals (a `.n` block); `fillet`
  takes a side vector, not a frame; a revolve makes no end frames (expansion
  11). **Format 13**: an old curve that named a frame gets that frame's normal
  and a `par(curve, "f.z")` at the end of the journal (`framelessCurves` in
  `persist.ts`), a lifted 2D file's circles face the origin, and an old
  `origin` name is renamed `origin2`. Proved by `test/oldfiles13.test.ts`
  against fixtures written by the format-12 build.
- **Toolbar groups** (docs/plans/toolbar-groups.md, built). A family of
  tools shares one button: `TOOL_GROUPS` in `tool.ts` (shapes: rectangle,
  polygon, slot; curves: ellipse, spline; modify: fillet, bevel, trim,
  extend, offset, mirror, pattern), a command-line tool's own `static group`
  joining one; `toolbarButtons()` is the button list (twelve since the sketch
  shapes: shapes has three members, curves its first). A group's button shows
  the member armed last (`GroupMemory` in `options.ts`, per viewer under
  `neocad.toolGroups.v1`, never in a file) and opens a **flyout** of the
  family once it has two (`Toolbar` in `panels.ts`: hover or press-and-hold
  under a mouse; press-and-slide or long-press under a finger, with the
  recogniser's 8 px and 500 ms; placed by `flyoutPlacement` beside the tray,
  clear of every pane on every iPhone in the device table). The context
  menu lists a group of two or more under its heading; `help()` says which
  tools share a button.
- **Sketch shapes** (docs/plans/sketch-shapes.md, built). **Polygon** and
  **slot** under the shapes button, the **ellipse** under curves (a button of
  its own after arc while it is the group's only member: twelve buttons).
  The polygon and the slot are composites (`src/tools/shapes.ts`, shared by
  the tools and the typed `polygon(c, v, n?, circumscribed?)` and `slot(a,
  b, width)`) that leave ordinary points, lines, arcs, construction curves
  and relations and journal nothing of their own; the first stage of all
  three gestures is `tools/twopoint.ts`. The **ellipse is an entity**
  (`EllipseEntity`: centre, major-end point, minor variable, 3D normal
  straightened against the major axis) with `onEllipse`, `tangent` of a line
  and an ellipse, `concentric`, and the `majorAxis`/`minorAxis` dimensions
  (typed `onellipse`, `major`, `minor`). Every seam reads it: drawing,
  picking, snapping and box select through `ArcFrame.rv` (arcgeom.ts) and a
  polyline lifted by Newton (projection.ts); loops (an arc piece with a
  second radius); extrude (a whole ellipse twins as centre, major end and
  minor); faces; the exact B-rep and STEP (`ELLIPSE`, `SURFACE_OF_LINEAR_
  EXTRUSION`); the solid kernel (a `nurbs` profile member,
  `sm_profile_nurbs` in the glue). Format 15 (`values.minors`). Refused by
  name: part of an ellipse extruded, an ellipse revolved, `tan` of an
  ellipse with a curve.
- **Select and the Hand head the toolbar** (docs/plans/select-hand.md,
  built). Select (`arm("select")`) is "no tool", lit whenever nothing is
  armed; pressing it puts the armed tool down and keeps the selection. The
  Hand (`arm("hand")`) makes a left-drag or one finger pan from wherever it
  starts, moving nothing, a still press still picking; Space held is a Hand
  over the armed tool (`ToolEngine.hold`). Both are the engine's
  (`tool.ts`'s `ENGINE_TOOLS`, `toolbarTools()`), not registry classes, and
  `defineTool` refuses their names; `ToolEngine.lit` is the button the
  toolbar lights.
- **`kernel-rs/`** — Rust crate, compiles to WASM via `npm run build:kernel`.
  Exposes one function: `solve_step(rows, cols, vals, r, n, lambda) -> dx`,
  a matrix-free conjugate-gradient solve of the damped normal equations
  `(JᵀJ + λ(1+diag(JᵀJ))) dx = -Jᵀr`. Never forms JᵀJ explicitly, so it
  scales to sparse systems. Has its own native unit tests (`npm run
  test:kernel`, no WASM/browser needed) covering an identity system, an
  overdetermined least-squares average, and independence of decoupled
  variables.
- **`src/kernel/dual.ts`** — forward-mode automatic differentiation via
  dual numbers. A residual written with `Dual` arithmetic (`.add/.mul/
  .sin/.sqrt/...`) yields its exact value *and* exact sparse gradient in
  one evaluation — no finite-difference perturbation. Verified against
  finite differences in `test/problem.test.ts`.
- **`src/kernel/problem.ts`** — the kernel's public surface: `Problem`,
  a flat variable vector plus `addResidual(varIndices, fn)` blocks. Knows
  *nothing* about points, lines, or CAD — geometry is meant to live
  entirely above this file. `solve()` runs Levenberg-Marquardt, calling
  into the WASM kernel once per Newton step for the linear solve, warm-
  started, with LM damping/trust-region step acceptance in TS.
- **`test/problem.test.ts`** — end-to-end: two points + a distance
  constraint solves to the exact target length; an intentionally
  contradictory system correctly reports `solved:false` with the
  offending residual named, not silently "solved." Run via
  `npm test` (uses Node's native `--experimental-strip-types`, no
  ts-node/tsx dependency).

Toolchain: Rust installed via the official rustup script (**not**
Homebrew — Homebrew's `rustup` formula has no bottle for this macOS
version and tries to compile Rust+LLVM+Python from source, which filled
the disk to 20MB free before I caught it; see the incident note below).
Node pinned via `.nvmrc` to LTS through nvm, installed alongside (not
replacing) the system Node other projects on this machine may depend on.

- **`src/model.ts`** — the entity graph on top of the kernel. A `Point`
  is a name plus one `Problem` variable per `model.dim` coordinate;
  nothing else is hardcoded to 2D.
- **`src/relations/basic.ts`** — `dist`/`fix`/`coincident`/`midpoint`,
  written generically over `model.dim`. `test/model.test.ts` proves this
  isn't just a claim: the *identical* relation code is run against a 2D
  model and a 3D model in separate tests, both solving correctly (7/7
  tests passing total, `npm test`).
- **First browser milestone** (`index.html` + `src/main.ts`, `npm run
  dev`): loads the WASM kernel over `fetch` (the real browser path, not
  the Node test's byte-buffer shortcut), builds a small solved model,
  renders it to canvas. Verified via headless Chrome — solves in 4
  iterations, exact distance and midpoint.

- **Tool-authoring layer** (`src/tools/tool.ts`): `abstract class Tool {
  onDown/onMove/onUp/onCancel/render }`, a `ToolContext` (model +
  requestRender/requestSolve/finish — no ambient globals reachable from
  inside a tool), and `defineTool(name, ctor)` for registration.
  `src/tools/engine.ts` wires real DOM pointer events to whichever tool
  is armed, with a 2D screen<->world transform (cellwork's convention:
  `screen = ox + x*scale, oy - y*scale`) and a one-shot-by-default
  lifecycle (a tool deactivates once it calls `ctx.finish()` — same
  "gesture completes, re-arm explicitly" shape cellwork's pointer tools
  already used).
- **`src/tools/point.ts`** and **`src/tools/rectangle.ts`** — two tools
  built with that API, nothing privileged. Point is the trivial case
  (click, place, finish). Rectangle is the concrete example from the
  brief: `onDown` remembers the first corner *without* touching the
  model, `onMove` just requests a preview redraw, `render()` draws a
  dashed preview from the tool's own in-progress state, and `onUp` is
  the only place anything is committed — four points, four lines,
  the relations that make it a rectangle, one solve. (Those were `hor`/`ver`
  until coordinate frames arrived; they are `par`/`par`/`perp` now — see the
  coordinate-frames entry below.)
- **Verified with a real mouse drag**, not just unit tests: armed the
  rectangle tool through the command input (a tool-name-only stand-in
  at that point; the real REPL landed later, see below),
  dispatched actual `mousePressed`/`mouseMoved`/`mouseReleased` events
  on the canvas via headless Chrome, and confirmed (a) mid-drag nothing
  exists in the model yet — 0 entities — only a live preview renders,
  (b) on release exactly 4 points + 4 lines commit, forming a precise
  axis-aligned rectangle matching the drag distance, (c) status flips to
  SOLVED, (d) the tool deactivates afterward. `test/tools.test.ts` also
  covers this at the unit level (10/10 tests passing overall) plus the
  no-real-drag-commits-nothing edge case.
- **`Line` entity** added to `model.ts` (two point refs, owns no
  variables — purely referential, like cellwork's lines) and
  **`horizontal`/`vertical`** added to `relations/basic.ts` — these are
  deliberately 2D-only (like a cross product is genuinely 3D-only),
  unlike `dist`/`fix`/`coincident`/`midpoint` which stay dimension-generic.

- **Circle and arc entities** (`model.ts`) — a `Circle` is a center point
  reference plus one variable of its own, the radius; an `Arc` is that plus
  a named start and end point. Both stay purely *structural*, the same way
  a `Line` owns no variables: what makes an arc's endpoints lie on its own
  circle is the `arcends` relation, not the constructor — for the same
  reason a `Line` doesn't imply `hor`/`ver`. `model.circular(name)` reads
  either one, so every radius-aware relation takes a circle or an arc
  interchangeably. (↻ In a 3D model both also name a **plane** — a frame — since
  3D phase 2; see the planar-discipline entry below.)
- **The rest of the sketch relation vocabulary** (`relations/geometry.ts`):
  `par`, `perp`, `ang`, `on`, `eq`, `rad`, `oncircle`, `conc`, `eqrad`,
  `tan`, `sym`, `arcends`. Most are dimension-generic, and not by
  coincidence — written through `dot()` and `wedge()` (`relations/vec.ts`)
  the definitions people think of as 2D hold unchanged in any dimension, so
  "parallel" is "the wedge vanishes" whether that wedge has one component
  or three. Symmetry about a line is generic for the same reason: the
  mirror in 2D and a half-turn in 3D are the same two conditions. Both
  claims are *checked against a real 3D model* in `test/geometry.test.ts`,
  not just asserted in a comment.
  The wedge is kept as its components rather than their summed square on
  purpose: a residual that is already a square has a vanishing gradient at
  its own root, which would leave least-squares minimising a fourth power.
- **The REPL** (`src/repl.ts` + `src/replenv.ts`) — the item the whole
  brief was pointed at, and no longer a stand-in. `repl.ts` is the scoped
  evaluator: an entry runs inside a `with` block over a Proxy whose `has`
  trap claims *every* name, so no identifier falls through to the page's
  globals, and whose `get` trap throws `no such name: modle` rather than
  silently yielding `undefined`. `replenv.ts` is the command surface that
  scope is filled with — geometry constructors, the relation vocabulary
  under its short names, viewport control, and `Tool`/`defineTool`.
  To be precise about what that is and isn't: it is *curation*, not a
  security boundary. It exists so an entry sees a small documented surface
  and so typos are caught; code typed there still runs with the engine's
  authority. Genuinely untrusted code would need a worker or an iframe —
  a different feature with a different threat model.
  Two consequences of the `with` scope worth knowing: a bare assignment
  (`box = class extends Tool {...}`) persists to later entries, a
  `const`/`let`/`class` declaration does not.
- **Viewport control as ordinary commands** — `zoom()`, `pan()`, `arm()`,
  `cancel()`, `refresh()`, `ls()`, `solve()`, `help()`, per the brief's
  goal of having the whole interface drivable the way a tool is authored.
- **The acceptance test the project was pointed at, met end to end.** A
  rectangle tool *typed at the command line* — a class plus one
  `defineTool` call, with its own dashed-preview `render()` — registers in
  the same registry the built-ins use, arms by bare name, and drags out
  with a real mouse in headless Chrome: mid-drag nothing is committed and
  only the preview draws, release commits exactly 4 points and 4 lines
  matching the drag, status flips to `SOLVED`, and the tool stands down.
  Verified alongside circle/tangency/arc construction from the command
  line, `document` being unreachable from an entry on a page that has one,
  and a contradictory constraint correctly reporting `CONFLICT` with the
  offending relation named. 42/42 unit tests, 19/19 browser checks.

- **Circle and arc tools** (`tools/circle.ts`, `tools/arc.ts`). Circle is a
  drag from center to rim. Arc is *three clicks* — center, then radius, then
  sweep — which made it the first tool to span more than one gesture, and
  needed no engine change at all: a tool stays armed until it calls
  `ctx.finish()`, so a multi-stage tool is simply one that finishes later.
  Both leave the radius unconstrained on commit, matching the rectangle
  tool's choice not to dimension what it draws: the shape keeps the size it
  was drawn at (nothing pulls on that variable, so the solver leaves it be)
  while staying free to be driven later by a `rad` or a tangency. **↳ The
  3-point arc is now built too** — see its own entry below; `arc.ts` remains
  the *centre point* arc.
- **`fillet`** (`src/operations.ts`) — the last item from cellwork's
  vocabulary. It composes entirely out of the existing relations, which is
  the part worth noticing: `tan` on each leg, `arcends`, and `rad`. Those
  four are also *complete*, because a tangent line touches its circle exactly
  once, so an endpoint lying on both the leg and the circle can only be the
  point of tangency — no separate statement needed.
  Structurally it reuses the shared corner as the tangent point on the first
  leg rather than replacing it, so nothing is left orphaned (the model has no
  delete yet, and an operation that stranded points would leave stray dots on
  the canvas forever). It refuses corners it cannot round — collinear legs, a
  radius larger than the legs — with a reason rather than a bad solve.
- **Operations vs. relations** is now a real distinction in the tree
  (`src/operations.ts`). A relation only ever adds an equation and can at
  worst over- or under-constrain; an operation changes the structure and can
  leave the model malformed. Worth reviewing with different eyes.
- **Relations on lines resolve their endpoints lazily.** `Problem.addResidual`
  now accepts either a fixed index list or a thunk re-consulted at each
  evaluation, and every line-taking relation uses the thunk. This came
  straight out of building the fillet: a relation on a line means "this
  line", not "these two points as they stood when I was written", and
  re-pointing a leg used to leave its constraints behind on the old corner.
  `hor`/`ver` accordingly take *either* two point names or one line name —
  both are real things a sketcher means — and the built-in tools use the line
  form. Filleting a drawn rectangle keeps the rectangle square; before this
  it visibly did not. Both behaviours are pinned in `test/sketch.test.ts`.

- **Save and open** (`src/persist.ts`), as ordinary commands: `save()` hands
  back the file's text, `open(text)` replaces the model, plus `download()`
  and `openFile()` in the browser and `journal()` to read back what a model
  is made of. That completes the brief's "tool up the whole interface" goal.
  A model cannot be serialised directly — a residual block holds a *closure*,
  and closures do not survive JSON — so a saved file is the model's
  **journal**: what was done to it, in order, replayed on open. Which is a
  happier answer than it sounds, because those calls are exactly what the
  command line already takes. The format is a transcript of the public API,
  not a second description of the model's internals that has to be kept in
  step with them.
  An operation is journalled as the single call the user made rather than
  its expansion, so a fillet reads as `fillet("l1","l2",5)` and re-expands on
  replay. Solved coordinates ride along and are restored afterwards: replay
  alone reaches *a* valid configuration, but an under-constrained model has
  many, and reopening a drawing should give back the one that was saved.
  Opening only ever performs calls from a fixed table, so a file is data
  rather than a script — and the table is a `Map`, because a plain object
  would have answered a lookup for `"constructor"` from `Object.prototype`.
  Round-tripping is a fixed point: open then save reproduces the file byte
  for byte.

- **A file also carries the source of tools authored at the command line**
  (`src/toolsource.ts`), as an optional `tools: {name, source}[]` field beside
  the journal — **inert text**. `open()` evaluates none of it: it says what
  the file carries (one line per tool, through the log), `toolSource(name)`
  prints a source, `tools()` marks a carried source as not armable, and
  pasting it back is an ordinary entry the user has read. The paste is the
  consent; there is no affordance that runs it for them.
  The capture is the *whole entry* that called `defineTool`, taken by a
  wrapper in `replenv.ts` — so built-ins, which register from their own
  modules, are never captured, and nothing has to check for them. This is
  **session state**: not journalled, unknown to `model.ts`, and not an undo
  step, because the undo bracket's snapshot is `save(model)` with the tools
  parameter left at its default of none. `VERSION` stays 4 — an additive
  optional field is not a break in either direction.
  The inertness is pinned by a test that opens, lists, prints and re-saves a
  source which would set a marker and throw if anything ever evaluated it.

- **Mouse navigation** (`src/view.ts` + the tool engine): the wheel zooms
  about the cursor, right- or middle-drag pans. Onshape's split, and the
  reason for it is that navigation and tool use stay on separate buttons —
  the left button belongs to whichever tool is armed and nothing else, so a
  drawing can be re-framed *during* a gesture. Start a rectangle, pan, finish
  it, and the tool never sees the pan.
  That last part turned on a detail of the pointer spec: pressing a second
  button while one is already down does not fire another `pointerdown`, it
  arrives as a `pointermove` with the `buttons` mask updated. Panning
  therefore watches the mask (what is held) rather than `button` (what just
  changed).
  The transform itself moved to `src/view.ts` as pure functions so it can be
  tested without a canvas — zoom-about-a-point is solved directly rather than
  nudged, so the anchor does not drift as zooms accumulate, and the scale is
  clamped at both ends.

- **Picking and hover** (`src/picking.ts`) — hit-testing in *screen* space, so
  the pick tolerance stays a constant number of pixels however far the view is
  zoomed. Tiered rather than nearest-wins: points beat curves beat lines, since
  a point sitting on a line is under the cursor at the same time as the line
  and is almost always what was meant. An arc is only pickable within its own
  sweep.
  The selection model is cellwork's, and it is not the obvious one: **there is
  no selection set.** Clicking geometry drops its *name* into the command line
  and that is all — the viewport is a selection portal, not somewhere state
  accumulates. It suits this codebase even better than it suited cellwork,
  because every relation here already takes entity names as strings: click two
  points after typing `dist(` and you have `dist("p1", "p2"` ready to finish.
  Hovering highlights the entity and shows a tag naming it. With no tool armed,
  a left-click picks and a left-drag depends on what it grabbed — geometry
  drags, empty canvas box-selects (see the box-select and edge-drag entries
  below); with one armed, the left button is the tool's, as before.

- **The fillet tool** (`src/tools/fillet.ts`) — click two edges that meet and
  the corner between them is rounded. The first tool built on picking, and the
  case that motivated picking: the `fillet` operation was perfectly usable from
  the command line, but only if you already knew both edges by name.
  It also added two things to the tool API that the next few tools want anyway.
  `ctx.pick(screen)` hit-tests from inside a tool, and `arm(name, options)`
  hands a tool a parameter it needs before it can do anything —
  `arm("fillet", { radius: 8 })` — rather than each such tool inventing its own
  way of being told. Clicking something that isn't an edge is a *miss*, not a
  cancelled gesture, and a corner the operation refuses keeps the first edge so
  the second pick can be retried.

- **Snapping** (`src/snapping.ts`) — while a tool is drawing, the cursor is
  pulled onto whatever meaningful geometry is near it: an existing point,
  **where two curves cross**, the middle of an edge, or the nearest position
  along a line or rim, in that order of precedence. Tolerances
  are in screen pixels and the tiers mirror picking's, for the same reason.
  The tool is handed a snapped world coordinate and **never learns that
  anything happened** — a tool should be about its own gesture, not about how
  precise the cursor is. A marker shows what was caught (square for an exact
  point, × for a crossing, triangle for a midpoint, circle for somewhere along
  a curve), drawn
  after the tool's own preview so it can never be hidden by it: if the cursor
  is not where it looks, that has to be the most visible thing on screen.
  On its own snapping makes the click *exact* but joins nothing; what joins
  things is inference, below.
  A `Snap` carries `targets: string[]` rather than one name, because an
  intersection is about *two* curves and that pairing is the feature; every
  other kind fills in exactly one. `describeSnap` reads `l1 × c2`.

- **Intersections** (`src/intersect.ts`) — three closed forms
  (segment–segment, segment–circle, circle–circle) over plain numbers in
  screen space, plus the **arc-sweep test**, which lives here rather than in
  `picking.ts` where it started. Both files ask the same question — "is this
  angle on the arc?" — and two copies of the answer would eventually disagree
  about an arc's last few pixels, giving a crossing you can snap to but not
  click, or the reverse. Screen space because every caller asks in pixels and
  the view transform is affine with a uniform scale, so the exact screen
  crossing maps back through `screenToWorld` to the exact world crossing;
  world space would have bought nothing and cost a second angular convention.
  **Degenerate cases return nothing**: parallel and collinear lines,
  coincident, nested and tangent circles, a tangent chord. A doubled root is a
  *tangency* — already its own relation — and manufacturing a crossing out of
  one would place two constraints where the drawing says two curves touch
  rather than cross. Doubling is judged on the two candidates being within
  `TANGENT_EPS` (0.05px) of each other rather than on an exactly-zero
  discriminant, because a tangency the solver actually holds leaves its roots a
  thousandth of a pixel apart: the residual is ~1e-11 but the root separation
  goes as its square root, so an exact test never fires on real numbers.
  Candidates are prefiltered on the distance the along-a-curve tier already
  computes (`nearestOnCurve`, now shared) and only the survivors are
  intersected pairwise. That cannot lose a candidate — a crossing within
  tolerance of the cursor lies on both its curves, so both curves are within
  tolerance too — and it keeps a per-cursor-move cost proportional to what is
  under the hand rather than to the drawing.
  **Known limitation:** the along-a-curve tier still treats an arc as its whole
  circle, as it always has; only the *crossings* are gated by sweep. Snapping
  along a rim is more forgiving than picking one, and changing it was not part
  of this package.

- **Constraint inference** (`src/tools/place.ts`) — a tool that places a point
  on existing geometry applies the relation that implies. Onshape calls it
  inferencing, SolidWorks calls it automatic sketch relations, and the mapping
  is theirs: a point snap becomes `coin`, a midpoint snap becomes the *line*
  form of `mid`, a curve snap becomes `on` for a line or `oncircle` for a
  circle or arc, and an **intersection snap becomes both at once** — the
  on-curve relation for each of the two curves it names. That last one is what
  makes a point clicked on a crossing *stay* the crossing when either curve
  moves; with one relation it would slide along that curve and off the other
  the instant anything moved. Two relations, two registry entries, two glyphs,
  two `del`s: nothing downstream treats the pair specially.
  So a rectangle drawn from another's corner genuinely follows
  that corner when it moves — which it demonstrably did not before.
  **Nothing is merged.** Two points stay two points, joined by an ordinary
  constraint the user could have typed themselves; merging entities is a
  different feature living in deletion territory. Inference is downstream of
  snapping rather than beside it, so `snapping(false)` turns off both — one
  switch, as in Onshape, not two.
  The mechanism is deliberately thin: `PointerInfo` carries the `Snap` the
  engine used alongside the coordinate it produced, and `placePoint` is the
  single place that turns one into a relation. A tool that ignores the field
  behaves exactly as before. The rectangle tool keeps the whole first
  `PointerInfo` from `onDown` rather than only its coordinate, because by
  `onUp` that snap is the only record of what the gesture was started on; its
  two *derived* corners get no inference, since nothing was clicked there.
  The arc tool prefers a snapped third click over its own rim projection —
  `arcends` then stretches the arc to reach it, rather than the click being
  quietly moved back onto the drawn rim.
  `midpoint` gained the line form it was missing (`mid(m, "l1")` beside
  `mid(m, "a", "b")`), resolving the line's endpoints lazily — the same
  distinction `hor`/`ver` already drew, for the same reason. Both forms
  round-trip through save/open as the form they were called in.
  Worth knowing, because it looks like a bug and is not: a coincident
  constraint between two *free* points does not make one follow the other on
  solve — least squares moves both and meets in the middle. Pin one and the
  other follows exactly, which is what the tests do.

- **The line tool** (`src/tools/line.ts`) — click, click, chaining, shaped
  like Onshape's, and the last obvious gap in the toolbox: point, rectangle,
  circle, arc and fillet all existed and the most basic tool of all did not.
  The chain **shares its vertices**: the end of a committed segment *is* the
  start of the next one, the same point entity rather than a copy joined by a
  constraint, so there is nothing to infer between them and dragging the
  vertex moves both segments because there is only one thing there. Nothing is
  committed until the second click, so an abandoned chain leaves no stray
  point; `Escape` ends the chain and keeps what was drawn.
  Within 3° of an axis the preview locks onto it, a dashed guide shows why,
  and the committed line gets `hor(line)`/`ver(line)` — the line form, so it
  survives a fillet. Past the tolerance nothing is inferred and nothing is
  straightened. An endpoint snap beats the axis guess, because a click that
  landed on real geometry is a deliberate aim and sliding it onto an axis
  would undo it; the axis constraint still comes along when the snapped
  position satisfies it anyway.
  The chain is dimension-generic — it is only points and lines — so it works
  unchanged in a 3D model and infers no axis there, `hor`/`ver` being
  genuinely 2D-only. That test paid for itself on the spot: it caught a
  degeneracy check measuring only the first two coordinates, which refused
  every segment that moved in z alone. (↻ Since 3D phase 1's camera half it
  infers in 3D too, against a 3D default frame's axes, in its plane.)

- **Kinematic drag** (`src/tools/engine.ts`, `src/kernel/problem.ts`) — with
  nothing armed, press on a point and pull: the model follows the cursor while
  every constraint holds. Drag the free corner of a constrained rectangle and
  it resizes as a rectangle; drag a point held at a distance from a fixed one
  and it swings round the circle.
  The mechanism is a **temporary residual**. `Problem.solve()` now takes
  `extra?: ResidualBlock[]` — blocks evaluated alongside the stored ones for
  that one solve, added to nothing, gone when it returns. Each pointer move
  solves with a soft pull toward the cursor (`(x - cursor.x) * 0.12`, one
  residual per coordinate, cellwork's weight) and renders; the release runs one
  ordinary solve through the host's solve path. `problem.ts` still has never
  heard of a point: the blocks are built in the engine, which is allowed to
  know what one is.
  Extras are **excluded from the offender report** and from `maxResidual`. A
  soft pull never reaches zero — that is what makes it soft — so counting it
  would paint `CONFLICT` across the header for the duration of every drag.
  Worth knowing, and tested: least squares weighs everything at once, so a
  cursor held far past where a point can follow does not stall politely against
  the constraints, it *trades* against them, and the drawing goes a little out
  of true until the button comes up. At w = 0.12 the displacement is roughly
  the overshoot over 71 — invisible when the cursor is a pixel or two from the
  point it is pulling, which is the ordinary case. It is why the intermediate
  frames render without touching the status line, and why release solves again
  with no pull: that solve puts everything back to 1e-6.
  A `fix`ed point needs no special case; the pull (0.12) loses to the fix
  residuals (1) and it effectively stays put, which falls out of the
  arithmetic. Nothing is journalled — a drag changes values, not structure, and
  solved coordinates already ride along in a saved file, which
  `test/e2e/drag.e2e.ts` round-trips.
  `cancel()` (Escape, or a file being opened mid-gesture) **settles** a drag
  rather than dropping it, for the same reason the release does: the last frame
  was solved with the pull applied, so abandoning it without a final solve
  leaves the cursor's influence baked into the geometry and the status line
  stale. It cannot undo the drag — nothing has undo — but it can decline to
  leave a compromise behind. `test/engine.test.ts` covers that and the three
  neighbouring cases, driving the engine with synthetic pointer events against
  a stand-in canvas: a press that never moved, a pan, and an ordinary release.
  Deliberately not in v1, each a known difference from Onshape: **only points
  drag** and **no inference or snapping while dragging** (Onshape infers
  mid-drag). A settled drag is now one undo step, so the note that used to
  stand here — that a drag is undone by dragging back — no longer applies.
  The first of those two is no longer true either: the edge-drag entry below
  generalised it to any geometry. The second still is.

- **Undo/redo** (`src/undo.ts`, policy in `src/main.ts`) — Ctrl+Z / Cmd+Z
  undoes, Ctrl+Shift+Z and Ctrl+Y redo, and `undo()` / `redo()` are ordinary
  commands over the same host handles, so the keystroke and the command cannot
  drift apart. The context menu's **Undo** and **Redo** (the bottom two items
  on every menu, disabled with "nothing to undo" / "nothing to redo") type
  those commands, so there are three doors and one step function behind them.
  The mechanism is a **stack of whole-model snapshots**, and the snapshot format
  is the text `save()` writes — which already carries the journal *and* the
  solved coordinates, already restores through `open()`, and compares for
  equality as a string. The alternative (truncate the journal and replay) was
  rejected because value-only changes — a drag, a solve — are never journalled,
  so it would need value snapshots as well and be strictly more machinery.
  `undo.ts` is a stack and nothing else: generic over what a snapshot is,
  importing nothing, cap 100 (cellwork's), pushing clears redo.
  **What counts as one step** is decided in `main.ts` by one comparison —
  snapshot before, snapshot after, record only if they differ. Nothing
  enumerates which commands are edits: `ls()` and `help()` stay out of the
  history because they leave the model identical. One step each for a command
  entry that changed something (an entry drawing four points is one step,
  because one thing was typed), a tool commit, a settled drag, and an `open()`.
  `undo()`/`redo()` push nothing themselves.
  The engine gained **one callback**, `onUserAction("before" | "after")`, fired
  around a press or release handed to an armed tool and around a drag from its
  first moving frame to its settling solve. It is deliberately neutral — the
  engine is below undo in the layering and must not learn undo exists — and the
  engine owns the *pairing*, because it is the only thing that knows every way a
  gesture can end (released, cancelled with Escape, or abandoned because the
  model was swapped out mid-gesture). An unpaired `before` would strand the
  host's bracket silently, so `test/engine.test.ts` covers all three exits.
  **The chord is the drawing's, everywhere** (owner, 2026-10-29: *"should work
  and be bulletproof"*). One capture-phase listener on `window` —
  the first thing any keydown reaches — matches the chord
  (`src/historykeys.ts`: `key` case-insensitively, `code` when the layout
  gives no Latin letter) and calls `preventDefault` and `stopPropagation` for
  those chords only, so no input, panel, button or menu below can see or
  swallow them. ~~While the command input holds uncommitted text, Ctrl+Z is
  the browser's~~ — retired: the drawing undoes and the half-typed text stays
  in the box, untouched, since the browser's text undo is prevented. A step
  closes the menu and cancels the gesture in progress first (a drag so
  cancelled settles into a step, which the same keystroke then undoes), and
  **the armed tool stays armed** as a fresh instance — unless the restored
  model cannot run it, when it is disarmed with the toolbar's reason in the
  log. Every step answers twice: its log line, and a note beside the status
  verdict (`#stepnote`: "undid", "redid", "nothing to undo") for 1.6 s — beside
  it, never over it, so the verdict cannot go stale behind it.
  Deliberate limitations: history is **per-session and not saved** — a reopened
  file starts with an empty stack; restoring is a full replay, so undo costs
  what opening the file costs (fine at present sizes, and the first thing to
  measure if it ever is not); and there is **no undo of a view change**, since
  the view is not part of the model — nor of panel layout, which is the
  viewer's. `help()` says both under undo, since "Ctrl+Z after an orbit does
  nothing" is the other way this reads as broken. A key-repeat of a held
  Ctrl+Z steps once per repeat, as in every editor.

- **Constraint glyphs on the canvas** (`src/glyphs.ts`, drawn by `main.ts`,
  hit-tested by `ToolEngine.pickAt`) — one small boxed mark per relation,
  beside the geometry it constrains, in the same visual family as the hover
  tag. This is the fuller half of the visibility story the hover tag began:
  the tag answers "what constrains *this*?" once you have thought to hover the
  right thing, and a drawing wearing its glyphs answers it before you ask.
  `placeGlyphs(model, view)` computes placements and nothing else — no canvas,
  no pointer, no state — so it is unit-testable, and it is the only thing that
  decides where a mark goes.
  **Anchors are world-space, offsets are screen-space:** a mark belongs to a
  place in the drawing and follows it through a solve or a drag, while sitting
  a constant number of pixels off it at any zoom, which is the convention
  every tolerance in this codebase uses. Marks sharing an anchor **stack in a
  row**, and that is the whole crowding story — deliberately no layout engine,
  whose own failure mode (labels jumping about as the model solves) would be
  worse than the crowding it fixed. A relation about two things gets a mark on
  *each* (`par`, `perp`, `eq`, `eqrad`, `sym`), because one mark says a right
  angle exists somewhere and two say which pair.
  **Interaction, inventing nothing:** hovering a mark names the relation on
  the hover tag (`r5  coin p5 p3`, through the same `describePick`) *and*
  lights up every entity that relation constrains; clicking one drops its name
  into the command line exactly as clicking geometry does, so `del(` + click +
  `)` is still the whole deletion flow. `Pick.kind` gained `"relation"` rather
  than a parallel type, since everything downstream of a pick does the same
  thing with it.
  **Glyphs are the top picking tier**, above points — a mark is small,
  deliberate to aim at, and only ever where it is because something put it
  there, so a mark you cannot click because a point wandered near it would
  defeat the feature. They take no part in **snapping**: they are UI, not
  geometry, and nothing should ever be placed at one. A press that lands on a
  glyph also grabs nothing, so a mark cannot be used to start dragging the
  geometry behind it.
  **Command surface:** `glyphs()` reports, `glyphs(true|false)` sets, on
  `help()`, default **on** as in an Onshape sketch. Off empties the layer and
  stops glyphs being picked, since a mark you cannot see but can still click
  would be a trap.
  **The symbols** were judged in a browser at the real 12px rather than in the
  source, as the spec required, and tofu was ruled out by bitmap identity
  against a codepoint no font has — advance width cannot detect it in a
  monospace stack, where a present and an absent glyph measure identically.
  `coin` is `○` (the spec's `◦` is two pixels across), `on`/`oncircle` `●`,
  `fix` `#` (`⚓` renders but muddies at 12px), `sym` `⇌`; `dist` (`↔`) and
  `arcends` (`●`) were given marks the spec's table omitted. An op with no
  entry — a relation authored at the command line — anchors on the first
  entity it names and takes the op's first letter, so runtime extensibility
  does not leave holes in the layer. Placements are recomputed each frame
  rather than cached, because no cache could be invalidated honestly: a drag
  and a solve both move geometry without touching the model's structure.

- **Dimension values are those glyphs** (`labelFor` in `src/glyphs.ts`) —
  `dist`, `rad` and `ang` draw their target instead of a generic mark: `50`
  midway along the span offset across it, `R22` just outside the rim toward
  the upper right, `30°` at the corner two lines share, nudged along the
  bisector into the wedge (or between the two edges' middles when they share
  no corner). In Onshape a dimension *is* its number, and a separate
  dimensions overlay would duplicate the hovering, the picking, the
  highlighting and the `glyphs(false)` switch and then drift from them.
  The value is read from `RelationEntry.args` — the relation registry keeps
  the call as it was made — so this is pure UI over data that already
  existed: no model change, no journal change, no new relation kind. Values
  are trimmed to at most three decimals (`50`, not `50.000`), and a target
  that is not a number falls back to the generic mark rather than drawing
  `NaN`.
  **The box is the text's box.** `halfW` is per glyph and `glyphAt` reads it,
  so aiming at the last digit of `120.5` is not a miss. `glyphs.ts` has no
  canvas and must not grow one, so widths come from `GLYPH_CHAR_W` (7.2px,
  the 12px monospace advance) — a constant that is a claim about the font
  `main.ts` sets, checked against the browser's own `measureText` by
  `test/e2e/dimensions.e2e.ts`. Rows of marks now advance by each box's real
  edges rather than by a fixed step, because a wide label stepping 17px sat
  under its neighbour: `—` beside `110` drew as *minus* 110.
  `ang` gets **one** label rather than the two marks a two-line relation
  usually gets — two marks answer "which pair", two copies of one number
  answer nothing.
  **`dist` draws dashed witness and dimension lines** with arrowheads, from
  the two points it measures between (`Glyph.ends`, drawn by `main.ts`).
  Solid ones were built first and read as geometry — a `dist` across a
  rectangle's diagonal drew what looked like an edge that is not there — and
  the dashed version is where the information (which two points is this
  number about?) survives without that. Which side of an edge a dimension
  sits on follows the argument order: `dist("p3","p4")` and `dist("p4","p3")`
  are the same constraint on opposite sides.
  Deliberate limitations: **a value still cannot be edited on the canvas.**
  Clicking one inserts the relation's name like any other glyph; editing is
  `set("d1.value", 60)` at the command line, or Set value… on the glyph's
  menu, which types that command for you (see the next entry). **`ang` takes
  radians and labels degrees**, so a label is not quite what you would
  retype — and `set` on an angle takes radians for the same reason. Drawing
  radians on a sketch would be the wrong fix and guessing the unit from the
  number would be worse; degree input is an open owner decision in `TODO.md`.
  `rad` has no leader line back to its arc, and nothing moves a label out of
  a crowded spot — that is still the no-layout-engine decision above, with
  `glyphs(false)` as the escape hatch.

- **Dimensions are named `d1`, `d2`, … and `set()` edits one**
  (`DIMENSION_OPS` / `relationPrefix` / `parseValueRef` / `rebuildRelation` in
  `src/model.ts`, `set` in `src/operations.ts`) — the owner's decision,
  verbatim: editing a dimension *"should be a `set(d4.value, 60)` where d4 is
  the dimension."* There is no parameter table: the dimension **is** the named
  value-holder.
  **The `d` namespace.** `dist`, `rad` and `ang` are dimensions — a number you
  put on the drawing — and claim `d` names; every other relation stays `r`.
  Onshape's split, and it earns its keep because the name says which kind of
  thing you are holding. **`fix` is not a dimension**: it carries coordinates
  rather than one value. The prefix is read from the op inside
  `model.relation` rather than passed in by each relation, so a new relation
  cannot get it wrong by omission — and the throw-rollback restores whichever
  counter the claim actually moved, or a failed `dist` would silently shift
  every later dimension's name and a replay would hand out different ones.
  **`set` is an operation, not a relation**: it replaces an equation rather
  than adding one. `Model.rebuildRelation` re-runs the dimension **in place
  under the same name** — same registry position, `args` updated — so
  `rels()`, the glyph's label and `del`'s reference scan all tell the truth
  afterwards with no code told anything. New blocks are built *before* the old
  ones are removed, which is the only ordering under which a refused value
  leaves the relation intact (blocks are closures; there would be nothing to
  put back). Journalled as the one call, one undo step, and it re-solves
  through the host — the `del` precedent, sharpened: changing the verdict is
  the whole purpose of the call.
  `"d4.value"` is the only settable property, parsed by `parseValueRef` beside
  `parseAxisRef` in the layer that owns the namespace. An unknown property, a
  non-dimension, or a value that is not a number each gets a throw naming what
  *is* settable.
  **Command surface:** `set(path, value)`, on `help()`, registered in both
  `replenv.ts` and `persist.ts`'s replay table. The menu's **Set value…** on a
  dimension glyph *types* `set("d4.value", ` into the command line rather than
  running anything — a third `MenuAction` (`type`), because a partial command
  replaces the line where Insert name appends to it.
  **Format version 4.** Names are handed out by creation order, so
  re-prefixing changes which relation a recorded name picks out. Only
  `deleteRelation` holds one, so a v3 journal replays through a map from old
  name to new and its `deleteRelation` args are rewritten. The map is built
  **from the replay** rather than from a scan, because `fillet` is one entry
  that creates four relations. As at 2→3 the rewritten journal is installed,
  so a v3 file re-saves pointing at names the model uses.
  Worth knowing and not a bug: nothing pins a bare rectangle's *orientation*,
  so lengthening one edge lets the whole drawing rotate slightly unless it is
  levelled against a datum — the no-world-frame decision working as designed.

- **Named relations, and deletion with cascade** (`Model.relation` +
  `Model.relations` in `src/model.ts`, `del` in `src/operations.ts`,
  `BlockHandle` / `removeBlock` in `src/kernel/problem.ts`) — relations are
  registry entries named beside the entities (`r1`, `r2`, … for constraints and
  `d1`, `d2`, … for dimensions — see the entry above), because a
  constraint you cannot refer to is one you cannot inspect or remove, which
  stopped being survivable the moment tools began inferring constraints on the
  user's behalf.
  Every function in `relations/` is one call to **`model.relation(op, args,
  body)`**: it journals the call (replacing the bare `model.record` each used
  to open with, so there is one place to forget rather than two), collects the
  residual-block handles the body adds, registers them, and returns the name.
  Relations return their name where they used to return `void`. Entities and
  relations share one namespace, since `del("r3")` has to mean one thing. A
  relation defined in terms of another — `concentric` via `coincident`,
  `arcEndpoints` via two `onCircle`s — is **one** relation: the inner call's
  blocks join the outer entry and it journals nothing. That last part fixed a
  real bug rather than only tidying: both used to journal, so reopening a file
  containing a `conc` or an `arcends` quietly applied the inner constraint
  twice. A relation that throws part-way is rolled back — blocks removed, name
  counter restored — because a replay performs only the calls that succeeded
  and would otherwise name everything after it one step out.
  **The kernel change**, the only one: `Problem.addResidual` returns a
  monotonic, never-reused `BlockHandle` and `Problem.removeBlock(handle)`
  removes that block. Blocks are stored as `{ id, block }` so a removal never
  shifts another block's identity, and an unknown handle throws rather than
  being ignored. `problem.ts` still has never heard of a point.
  **`del(name)`** deletes an entity or a relation with Onshape's cascade — a
  relation takes nothing else; a point takes everything referencing it,
  recursively, plus every relation naming any of them; a line, circle or arc
  takes the relations naming it and leaves its points. The closure follows
  references *inward* (who needs me), never outward (what do I need), which is
  what makes it Onshape's rather than merely transitive. It returns the names
  it removed. **There is no confirmation prompt: undo is the confirmation**,
  `del` being one user action and therefore one Ctrl+Z from harmless.
  Deletion is journalled as its **expansion** (`deleteEntity` /
  `deleteRelation`, one entry per name) rather than as the `del` call, because
  a cascade is computed against the model as it stood and recomputing it later
  could remove a different set. Old files carry neither op and open unchanged;
  no format version bump. `Model`'s two primitives refuse to remove something
  still referenced or still constrained, so a hand-edited file gets a reason
  rather than a line with no endpoint.
  **Command surface:** `del(name)` and `rels(name?)`, both on `help()`.
  `rels()` prints the short op name — `r3  coin p5 p3` — so a listed relation
  reads back as a line you could retype. The **hover tag** gained the relation
  names (`p5  12, 30 · r3 r7`), which was this package's whole visibility
  story; the constraint glyphs above are the follow-up that builds on the same
  registry. `del` re-solves through the host — as `set` now does, for the same
  reason — because these are the edits whose purpose is to change the solver's
  verdict, and a stale `CONFLICT` header is a bug this project has already been
  bitten by.
  **The documented leak:** variables are **tombstoned, not compacted**. A
  deleted point's variables stay in the flat vector referenced by nothing;
  they take part in no residual, so the damped solve leaves them exactly where
  they are and they cost memory rather than correctness. It is bounded by how
  much one session deletes — and **a save/reopen does not shed it**, since
  replay re-runs the same creates and the same deletes. Both are pinned by
  tests in `test/deletion.test.ts`. Compaction means remapping every captured
  index list inside every closure, which is real work with real risk and is
  deliberately a later package.
  Also deliberate: a relation authored at the command line that calls
  `model.problem.addResidual` directly still works and is still anonymous —
  the same anonymity every relation had until now. Route it through
  `model.relation` and `model.addResidual` to get a name and a `del`.
- **`scripts/singlefile.mjs`** (`npm run build:single`) — folds app, page
  and WASM kernel (base64) into one self-contained
  `dist-single/neocad.html` with a git-rev buildstamp in the header. This
  is what gets published as the owner's review artifact after each merge;
  the entry shim (`scripts/single-entry.ts`) feeds the embedded kernel
  bytes to `ensureKernelLoaded` before `main.ts` loads, so nothing fetches.
  In the artifact sandbox `download()` is inert (viewer downloads are
  blocked); `save()`/`open(text)` work.

- **Typed edits re-solve (`src/main.ts`).** A command entry that changed the
  model goes through `solveAndRender()`, so the status readout always
  describes the drawing on screen. Before this, `dist("a","b",50)` added its
  residual and redrew and the header went on reading `SOLVED` over geometry
  that violated it until someone typed `solve()` — the stale-readout family,
  third sighting. **Which entries count is not enumerated anywhere:** it is
  the undo bracket's own before/after snapshot comparison, which
  `endUserAction` now returns rather than swallowing. One consequence worth
  stating: the two customers cannot drift apart, because "this is one undo
  step" and "this needs re-solving" are now literally the same boolean.
  `ls()`, `help()`, a bare expression and an entry that throws all leave the
  model identical and therefore solve nothing;
  `test/e2e/livesolve.e2e.ts` wraps `model.solve` in the page and counts,
  because "it did not solve" is not otherwise assertable. A redundant
  `solve()` typed afterwards remains harmless, so the older specs that type
  one were left alone.

- **Box select (`src/boxselect.ts`, the gesture in `src/tools/engine.ts`).**
  Left-drag on empty canvas drags a rectangle; **the direction is the mode**,
  SolidWorks/Onshape convention exactly — left→right is a *window* (only what
  is fully contained, solid edge, translucent fill), right→left a *crossing*
  (anything touched, dashed, different tint). The file is a fourth peer beside
  `picking.ts`, `snapping.ts` and `glyphs.ts`: a pure function of (model, view,
  rectangle), no canvas and no state, so all of it is unit-tested. It sits on
  `intersect.ts` for segment–segment, segment–circle and the arc-sweep test, so
  **a box and a click cannot disagree about where an arc stops**.
  Per kind: a point by its position; a segment contained when both ends are and
  touched when either end is inside or it crosses the boundary; a circle
  contained when its whole extent is and touched when the rim passes through —
  **a rectangle wholly inside a circle touches nothing**, because the entity is
  the rim and not the disc, the same rule picking follows. An arc measures
  containment against its *own* extent (endpoints plus whichever cardinal
  points its sweep reaches), not its whole circle's, or a quarter arc in a
  corner would refuse a box three times its size.
  **A box is a multi-click**: each name goes through the same `onPick` path a
  single click's does, so "there is no selection set" survives the feature
  rather than being replaced by it. An empty box inserts nothing, Escape
  cancels, and a press that grabbed anything at all is not a box — geometry
  drags (a point since the kinematic-drag package, an edge or a rim since the
  edge-drag one), a glyph pans. **Relations are not selectable and no code
  says so**: they live in a registry beside the entity map, so a box never sees
  them.
  *Reverses a register entry* (left-drag on empty canvas used to pan, which was
  cellwork's habit); the reversal is recorded in `TODO.md` for the owner to
  veto. Panning keeps middle-drag, right-drag and `pan()`. (↻ In the 3D app
  right-drag orbits; middle-drag and `pan()` pan.)
  *Fixed on the way:* **Escape moved from the command input to `window`.** A
  mouse press on the canvas blurs the input — a canvas is not focusable, so
  focus falls to the body — so the old binding was deaf during exactly the
  gestures Escape exists to abandon. It had never shown up because every
  earlier Escape test picked something first, and picking re-focuses the input.
  *Known and deliberate:* a box only ever catches what is on screen, since the
  rectangle is pixels; there is no shift-to-add, there being no selection set
  to add to.

- **Entities defined by constraints, not constructors** (`src/model.ts`'s four
  constructors, the creator commands in `src/replenv.ts`). **Every constructor
  argument is optional**, in the model and at the command line alike:
  `circle()`, `line()`, `arc()` and `point()` are all legal, and whatever is
  missing is auto-created free for the relations to define. Long names sit
  beside the short ones — `point`/`line`/`circle` next to `pt`/`ln`/`circ` —
  which costs nothing, because a creator function and a tool have shared a name
  since `arc` and `fillet` did (a bare word arms the tool, a call is an
  expression). `null` means the same as absent everywhere, since a journal
  round-trips through JSON and JSON has no `undefined`.
  The design rests on one observation: **a constructor argument here was never
  a constraint.** `circ(centre, r)` only seeds a radius variable and `pt(x,y)`
  pins nothing, so making the arguments optional changes no existing call's
  meaning and old files replay untouched.
  *Auto-created pieces are first-class.* A free circle's centre is a real,
  named, visible, draggable point — the rectangle tool's corners set that
  precedent — and everything downstream needed no changes to handle it: `ls()`,
  `rels()`, hover, glyphs, `del` (which leaves the centre, as it does for any
  circle) and undo, all confirmed in the browser rather than assumed.
  *No seed is ever degenerate.* A free line's endpoints are 20 units apart, not
  coincident, because a zero-length line has no direction and `tan`/`par`/`ang`
  divide by that direction's length; a free arc seeds as a quarter arc; an
  auto-seeded arc below 2D throws rather than being built flat.
  *Journal discipline:* each constructor records as **the one call that was
  made**, never its expansion — the auto-created sub-entities journal nothing
  — and re-expands deterministically, so a `circle()`-then-constrain model
  reopens byte-identical with the same auto-names.
  *A refusal leaves nothing behind:* every check, the name included, runs
  before the first auto-created point is made (`claimFirst`), so a refused
  constructor strands no unjournalled points and moves no counter.
  *Where a free piece appears:* the middle of the window, decided in
  `replenv.ts` and passed down as an ordinary coordinate. The model never
  learns what a viewport is. This needs the canvas's **size** as well as the
  transform — a `View` is only a transform and has no business holding a window
  size — hence the separate `viewSize` handle in `EnvHandles`. Headless there
  is nothing to ask and the model's plain defaults stand; the anchor is used
  only where the model would otherwise fall back to the origin for want of
  anything to derive a position from (a line with neither endpoint, a circle or
  arc with no centre), since given any reference the model already seeds beside
  it.
  *Known and deliberate:* **tangent + through-point + radius admits up to four
  circles**, and the solver lands on the branch nearest its seed; dragging flips
  branches. That is Onshape's behaviour and every least-squares sketcher's, not
  nondeterminism — which is why the *three-point* circle is the case checked
  against a closed form (exact circumcentre and circumradius to 1e-6), and why
  the ambiguous one is checked by satisfying all three of its constraints
  rather than by expecting a particular circle.
  *Not changed:* the pointer tools. Drag-centre-to-rim is the right pointer
  gesture and is Onshape's own; a 3-point-circle *tool* is now a trivial
  composition and is listed on `TODO.md` as enabled, not built. **↳ Since
  built** — see the next entry, and it really was trivial.

- **One circle tool and one arc tool, the gesture choosing the method**
  (`src/tools/circle.ts`, `src/tools/arc.ts`, `src/tools/curvemethod.ts`;
  docs/plans/one-circle-one-arc.md). The owner: *"why are there multiple
  circle tools and arc tools? … surely just one tool, but different ways to
  set constraints."* There is one Circle button and one Arc button.
  - **Circle.** A press and drag is a centre and a radius. Three clicks make
    a circle through the three points (three `oncircle`s). A click and then a
    drag takes that click as the centre. A rim click *along* a line or
    circle (a `curve` snap) makes the circle tangent to it (`tan`). A drag let
    go along a curve makes it tangent; let go on a point, the circle passes
    through it.
  - **Arc.** Drag from one end to the other, then click the bulge (3 points).
    Or click the centre first, then the start and the end; from the centre,
    one stroke from start to end also works. When an end is on the end of a
    line or arc and the bulge comes within 8 px of the arc that carries on
    smoothly, the bulge is pulled onto it and held there with `tan`.
  - **How a press is read.** It is held until it moves 3 px (a drag) or
    lifts in place (a click). Clicks commit on the press and drags on the
    release, as the old tools did. **The options panel's method drop-down**
    shows, in amber, what the gesture was read as (`centre · radius`,
    `3 points`, `tangent`, `centre · ends`). The same drop-down locks it, which
    types `arm("circle", { method: "3pt" })`, and the lock is remembered.
  - **Each lock is the old tool**, proven against sixteen files the old tools
    wrote (`test/fixtures/curve-tools-v13.json`). The circle's `tangent` lock
    is the circle touching three lines or circles; the arc's is Onshape's
    tangent arc, from the end of a line or arc.
  - **`circle3` and `arc3` are typed names** (`TOOL_ALIASES` in tool.ts).
    They arm the one tool locked to 3 points, without remembering the lock.
  - Tangent previews are the fitted circle itself (`fitCircle`, a small
    Newton fit used only for the preview and the seed). `tan` also takes two
    circles: outside or inside, journalled as read, and coplanar in 3D.
  - What was decided, and every deviation from the spec, is in the spec's
    *As built*.

- **The 3-point circle tool** — **↳ since folded into the one circle tool**
  above: `circle3` now arms the Circle locked to 3 points, and what follows
  describes that lock, which behaves exactly as this tool did (the file it was
  in, `src/tools/circle3.ts`, is gone). `circle3` — bare word
  or `arm("circle3")` — then three clicks, and a circle passes through all
  three. Onshape calls it *3 point circle*; `circle3` is the name that is also
  a legal identifier.
  The tool adds nothing to the model and nothing to the solver: it commits one
  **free** `circle()`, three `onCircle`s and a solve. That is the whole
  implementation, and it is the free-entities package being spent rather than
  merely demonstrated. The difference from a tool that computed the
  circumcircle and called `addCircle(centre, r)` is not visible in the first
  frame and is the entire point: the constraints stay, so the circle *follows*
  its rim points when they move, each relation wears a glyph, `rels()` lists
  them, and any one can be deleted alone.
  *Every click goes through `placePoint`*, so all three carry snapping and
  inference like every other tool's clicks — which is why a 3-point circle
  through two existing corners is three clicks and no special case. The
  browser spec draws a rectangle, clicks two of its corners, and reads the two
  inferred coincidences out of `rels()` beside the three `oncircle`s.
  *One user action.* Nothing is created until the third click, so the bracket
  the engine already puts round a single pointer event covers circle, rim
  points and relations together — one Ctrl+Z. The rectangle tool set that
  shape; no engine change was needed for this one either.
  *Preview:* after the second click, the dashed circumcircle through the two
  clicks and the cursor, computed in **screen pixels** — the same closed form,
  and a pixel radius needs no scale factor, which is `intersect.ts`'s reason
  for living in screen space too.
  *Known and deliberate:* an **exactly** collinear third click is refused (the
  tool stays armed on the two good clicks) rather than committed, because
  three `oncircle`s on three collinear points have no solution and committing
  would leave a `CONFLICT` header over a drawing that should never have
  existed. Near-collinear goes through — it is the user's call. The threshold
  is a relative *sine*, i.e. an angle of ~1e-9 radians, not an area: an area
  threshold would call a large drawing bent and a small copy of it straight.
  Unit-tested at three scales.
  *Known gap:* the refusal is a `console.warn`. A `Tool` has no channel to the
  app's log pane — `fillet` reports a corner it cannot round by *throwing*,
  which reaches the page as an uncaught error — and giving tools one means a
  new `ToolContext` field, which is an `engine.ts` change this package was
  scoped out of. On `TODO.md` as a follow-up. **↳ Closed:** tools have a voice
  now (`ctx.log`), and the refusal goes to the pane.

- **The 3-point arc tool** — **↳ since folded into the one arc tool** above:
  `arc3` arms the Arc locked to 3 points, which behaves exactly as this did
  (`src/tools/arc3.ts` is gone). `arc3` — bare word or
  `arm("arc3")` — then three clicks: **the two endpoints first, then a point
  the arc passes through.** Onshape calls it *3 point arc*, and that click
  order is Onshape's; it is neither the natural guess (start, waypoint, end)
  nor `arc.ts`'s (centre, start, end), which is exactly why it is written down
  here.
  What it commits is two `placePoint`s, one **free** `addArc` with its centre
  auto-created and seeded at the circumcentre (radius at the circumradius),
  and one `arcEndpoints`. No new journal op was needed — `addArc`, `setCoords`
  and `arcEndpoints` were all already in the replay table, which is the
  evidence that it is a composition. `arcEndpoints` is not optional: an arc's
  endpoints lying on its own circle is a relation in this model rather than a
  constructor fact, so a tool that builds an arc has to say so.
  *The third click places nothing, and that is the design.* In Onshape the
  waypoint is not kept as geometry; keeping it here would leave a point the
  user never asked for and would have to clean up by hand — the fillet's
  reason for reusing its shared corner rather than stranding it. Its whole
  job is to choose which of the two arcs was meant and where the centre and
  radius start from. **So the arc is under-constrained afterwards — the bulge
  is free**: seven unknowns (two endpoints, a centre, a radius) against
  `arcEndpoints`' two equations. That is the same bargain `arc.ts` already
  strikes and the standing rule that tools do not dimension what they draw.
  The rejected alternative — the waypoint as a third point with an `onCircle`,
  which is exactly what `circle3` does — is in `CONVERSATION_LOG.md`. A unit
  test shoves the centre along the endpoints' perpendicular bisector and finds
  the system just as solved at a different radius, so the freedom is asserted
  rather than merely claimed. `rad(...)` is how a user pins it.
  *The sweep is chosen, not assumed.* `main.ts` draws an arc counter-clockwise
  in world space from `start` to `end`, so the two clicks are assigned to those
  roles in whichever order puts the waypoint inside the sweep — both are
  endpoints either way, only the label moves. An arc that bulges the wrong way
  satisfies every residual to machine precision and is still the wrong
  drawing (the fillet bug's shape), so the tests ask `withinSweep` and
  `screenAngle` themselves — `intersect.ts`'s one definition of what is *on*
  an arc — rather than a second opinion. Flipping the choice in the source
  fails three of them.
  *The rest is `circle3`'s shape:* both endpoint clicks carry snapping and
  inference, so an arc from one existing corner to another is three clicks and
  no special case; nothing is created before the third click, so the whole
  gesture is one Ctrl+Z with no engine change; the dashed preview after the
  second click shows the arc the next click will build, bulge and all; an
  exactly collinear third click is refused through `ctx.log` with the gesture
  left live, and near-collinear is the user's call. A second click on top of
  the first is swallowed as a double-click, the way `arc.ts` already swallows
  its zero-radius one.
  *One shared piece moved:* `circumcircle` and `COLLINEAR_EPS` now live in
  `src/tools/circumcircle.ts` rather than inside `circle3.ts`. Two tools need
  the same closed form and the same answer to "are these three points on one
  line"; two copies of a scale-free epsilon drift until one tool refuses a
  gesture the other accepts. The new file registers no tool, so importing it
  has no side effect — `place.ts` is the precedent.
  The pictures are in `CHANGELOG.md`, images 41 and 42.

- **Dragging an edge, a rim or an arc** (`src/tools/engine.ts`). With nothing
  armed, a left-drag that starts on *any* geometry drags it — the last leftover
  from the old mouse map, in which everything but a point panned. **Dragging an
  entity is dragging every point it is made of by the same offset**, and the
  offset is a *target* rather than a move: one soft pull per governing point,
  each toward that point's grab-time position plus however far the cursor has
  travelled. The machinery is exactly the point drag's — `Problem.solve({extra})`
  at weight 0.12 — so the constraints still win: an edge of a constrained
  rectangle carries the rectangle, an edge held by a `fix` strains toward the
  cursor and settles back legally.
  Which points govern which entity is one small exported function
  (`dragGoverns`): a line is its two endpoints, **a circle is its centre alone**
  — dragging a rim moves the circle and does not resize it, which is Onshape's
  behaviour and the only reading under which the gesture is a translation — and
  an arc is centre, start and end, its radius following from `arcends` rather
  than being dragged.
  The offset form replaced "pull the point to the cursor" for single points
  too, so there is one code path and not two, with the side benefit that a point
  grabbed a few pixels off-centre no longer jumps to the cursor as the drag
  starts. Settling, cancel and the undo bracket are untouched: a drag is one
  action whether it is released or escaped.
  **The only left-drag that still pans is one that started on a constraint
  glyph.** A glyph is UI: it grabs nothing, because it has no position of its
  own to move, and it is not empty canvas either, so it must not box. Leaving
  the pan there was preferred to making the press inert — the gesture does
  something rather than nothing, and it is the same press that has never
  dragged or boxed.
  *Known and deliberate:* **no rigid rotation** (translation only; the solver
  resolves the rest, which is what Onshape's drag does too), and still no
  inference or snapping mid-drag.

- *(Revised by frameless curves, above: one built-in origin now exists, and is what `fix` means with no default.)* **Coordinate frames, and no world frame** (`model.ts`, `relations/basic.ts`,
  `relations/refs.ts`, `framemarker.ts`, `picking.ts`, `boxselect.ts`,
  `main.ts`, `tools/engine.ts`, `tools/line.ts`, `replenv.ts`).
  A `Frame` is an origin point plus a point fixing +x, purely referential the
  way a `Line` is: it owns no variables and its two points are ordinary
  points. `addFrame(origin?, xref?, name?)` follows the free-entities
  conventions — everything optional, missing pieces auto-created and seeded a
  span apart so a frame with no direction cannot be constructed, journalled as
  the one call that was made. Frames were **2D-only** when this shipped: +y is
  +x turned a quarter turn, which settles a frame in 2D and leaves a whole
  rotation free above it. (*Superseded:* 3D frames carry a y-ref — see the
  3D-frames entry below.)
  `hor`, `ver` and `fix` are relative to a frame now — the one named, or
  `model.defaultFrame` at call time, and an error naming the fix when there is
  neither. The journal always carries the frame the call *resolved* to, so an
  entry cannot change meaning when the default changes later; old files
  carrying frameless entries are refused by the replay table with that same
  message, and the format version is 2.
  **A frame is read, not pushed.** `frameBasis` (`relations/refs.ts`) re-reads
  the frame's origin and unit axes at every evaluation and hands them to the
  residual as values; the frame's two points are not among the block's
  declared variables. Declaring them was tried first and measured: the solver
  then satisfies a `hor` by turning the frame rather than the line (≈8° of a
  9° error, on a 40-unit line against a 20-unit frame arm), and without
  normalising it shrinks the frame's arm as well. So a frame moves only when
  something moves *it*, and the drawing follows within the same solve because
  the basis is re-read. That is what makes "level against a tilted frame"
  settle at exactly the frame's tilt.
  Two tools bridged: **the rectangle tool is intrinsic** (`par`, `par`,
  `perp` — no `hor`/`ver`, so it works with no frame at all, and three
  relations rather than four because the fourth was redundant), and **the line
  tool's axis inference fires only when a default frame is set**, against that
  frame — its aim, its dashed guide and the constraint it lands are one answer
  read off that frame's axes, so a tilted frame tilts all three together. With
  no default frame there is no aim and no guide, rather than a preview pulled
  onto the kernel's axes promising a constraint that never arrives.
  **A frame is drawn, and behaves like the geometry it is.** A small axes
  marker at the origin — two lettered arrows of a fixed pixel length (the
  x-ref's *distance* means nothing, only its direction), the name beside it,
  and the default frame brighter, because which frame is default is the only
  ambient state in the app that changes what a typed `hor` means. It is drawn
  in the entity pass of `render()`, not with the glyphs. `framemarker.ts` owns
  the marker's screen geometry, because `main.ts` draws it, `picking.ts`
  hit-tests it and `boxselect.ts` catches it and three copies of "where are
  the arms" would drift. A frame therefore hovers, picks, box-selects, drags
  and `del`s with no new interaction model; its origin point still wins a pick
  at the marker's corner, which is the right answer — dragging that turns the
  frame, dragging the marker moves it.
  **A drag on a point a frame reads moves it outright**, then lets the same
  solve carry the drawing to it. That is the other face of read-never-pushed:
  with the frame's points outside the Jacobian of the residuals that read
  them, the damped solve rejects every step that turns the frame (turning it
  raises a residual the step cannot see how to lower), λ runs away, and the
  frame does not move — measured at 0.003° against a gesture asking for 26°.
  The weak pull is still applied on top, so a frame point that is also
  ordinary geometry keeps its relations' say. `frame()` seeds its origin at
  the middle of the view like every other free constructor.
  *Known and deliberate:* a frame has no rotation gesture of its own — you
  turn one by dragging its x-ref, which is the same gesture as dragging any
  other point, and there is no rigid-rotate anywhere in the app yet.

- **A right-click context menu** (`src/menu.ts`, wired in `src/main.ts`,
  styled in `index.html`). **Right-press and release without moving opens it;
  right-drag still pans** — the right button makes the same click/drag split
  the left one always has, on the same three-pixel threshold, so the release
  decides and the press decides nothing. Middle-drag stays purely
  navigational and never opens anything. The browser's own menu is still
  suppressed on the canvas, and now on the menu element too.
  **Every item is a shortcut to a command the log shows.** On an entity:
  *Insert name* (what a left-click already does), *Delete*, *Dimension* — and
  *Fix* on a point. On a constraint glyph: the relation's description as the
  header, and *Delete*. On empty canvas: the eight tool arms, plus *Frame*
  (`setDefaultFrame(frame())` when the drawing has no frame at all, `frame()`
  once it has one). Every menu ends with *Undo* and *Redo* (`undo()`,
  `redo()`), disabled with "nothing to undo" / "nothing to redo" — the host
  hands `menuFor` the stack's two booleans, so the menu stays pure. Each row
  shows the command beside its label.
  **The seam is `submit`** — the very function the Enter key calls, handed to
  the menu as an explicit `run` hook. Logging, the recall history, the one
  undo bracket and the re-solve all live there and nowhere else, so an item
  that went any other way would be a second answer to what typing a command
  means. Nothing about undo, journalling or the status readout is new: a
  menu-typed `dist` is one journal entry, one undo step and one solve because
  a typed `dist` already was.
  **A dimension carries the current measurement** — a line's length, a
  circle's or arc's radius — so the action means "hold it where it is" and
  moves nothing. A point gets no Dimension (no single natural measurement)
  and neither does a frame (its arm's length is drawn at a fixed pixel size).
  **Fix is shown disabled when there is no default frame**, with the model's
  own `resolveFrame` message beneath it, and never quietly makes one. Its
  coordinates are the point's position *in the frame*, not its raw numbers,
  or the relation would move what it claims to hold.
  `menuFor(model, pick)` is pure — model and pick in, labels and command
  strings out — which is what puts the item logic in the unit suite
  (`test/menu.test.ts`); the gesture and the whole browser story are in
  `test/engine.test.ts` and `test/e2e/contextmenu.e2e.ts`.
  *Known and deliberate:* the items are hard-coded per pick kind, so nothing
  defined at the command line can add one; no submenus, icons or arrow keys;
  a right-click with a tool armed opens the ordinary menu; and a right press
  taken during a left drag opens nothing.

- **`hor`/`ver` retired into frame-axis references.** The vocabulary no longer
  names a privileged pair of directions anywhere. `par`, `perp` and `ang`
  accept a **frame-axis reference** — the string `"f1.x"` or `"f1.y"` — beside
  an ordinary line, and `xaxis(frame?)`/`yaxis(frame?)` hand one back with the
  default resolved at call time. `par("l1", yaxis())` is what `ver("l1")` was;
  the residual is identical (the wedge with +y *is* the dot with +x), so the
  frames package's closed-form tilted-frame tests hold unchanged in the new
  spelling. `horizontal`/`vertical` are **removed, not aliased**: reaching for
  one gets the standing `no such name: hor`.
  **Resolution has one home** — `directionOf` in `relations/refs.ts`, beside
  `frameBasis` — while the *syntax* belongs to `model.ts`, which owns the
  namespace: `claimName` refuses a dot in any entity name so a reference can
  never collide with one, and `relationsNaming`/`del` read `f1.x` as naming
  `f1` so a frame cannot be deleted out from under a relation still reading it.
  **Datum semantics are now structural rather than remembered**: an axis
  contributes no variables and a direction built from `Dual.constant`, whose
  gradient is empty, so the frame is outside the Jacobian by construction. Two
  ordinary lines in `par` still push each other; two frame axes on one relation
  are refused, since that residual could declare no variables at all.
  **Which relations may take one is a rule**: an axis is a direction with no
  length and no position, so `eq` (no length), `on`, `sym` and `tan` (all need
  a *located* line) are excluded, and each exclusion is written into
  `relations/geometry.ts` rather than left to be rediscovered.
  `par`/`perp` keep the point-pair form (`par("p1","p3","f.x")`); `ang`
  deliberately has none, since its trailing numeric target would have to be
  told from a third name by arity alone. `fix` is untouched.
  **Downstream**: the line tool infers `par(line, "f.x")`/`par(line, "f.y")`;
  a `par` or `ang` whose other side is an axis wears **one** mark, on the line,
  since there is no second edge to put one beside — and hovering it still
  lights the frame, because the highlight resolves `f1.x` back to `f1`.
  The parallel mark is `//`: `∥` is not in the browser's monospace and drew as
  a tofu slab (every other mark advances 7.2246px, `∥` advances 6), which was
  invisible while `par` was rare and glaring the moment it became the drawing's
  commonest mark. An e2e now measures every symbol in the table against the
  monospace cell.
  **Format version 3**, and version-2 files **translate** rather than being
  refused: `horizontal(l, f)` replays as `parallel(l, "f.x")`, `vertical(l, f)`
  as `parallel(l, "f.y")`, point forms carrying their extra name. The
  *translated* journal is what gets installed, so such a file re-saves in the
  new vocabulary — `save(open(x)) ≠ x` across this boundary, deliberately, and
  byte-stable from there on. Version-1 files are still refused by step, with
  the same message, now raised by the translation that has to resolve the frame
  they lack.
  *Spec:* [`docs/plans/retire-hor-ver.md`](docs/plans/retire-hor-ver.md).

- **3D frames: a frame is a sketch plane** (`model.ts`, `relations/refs.ts`,
  `relations/basic.ts`, `persist.ts`, `replenv.ts`, `menu.ts`) — the model half
  of 3D phase 1. **The app still ran `Model(2)`** when this landed; nothing on
  screen changed, and everything here was reachable from a 3D model at the
  command line or in a test. (↻ The second half, the entry below, put the app
  on `Model(3)`.)
  `addFrame(origin?, xref?, yref?, name?)`: in a 3D model the **y-ref** is a
  third ordinary point, auto-created when absent like every free piece, and
  seeded so the frame can never start degenerate even when two of the three
  points were given (a seed goes along the first kernel axis not parallel to
  the arm already there). A 2D model refuses a y-ref; a model of any other
  dimension has no frames at all. **`frameBasis` straightens the y-ref**
  (Gram–Schmidt against +x) and takes +z = +x × +y, so the y-ref fixes the plane
  and its side, not the angle, and the axes are orthonormal and right-handed by
  construction. Collapse floors **axis by axis**: a y-ref on the origin or on
  the frame's own x axis floors +y and +z and keeps +x; an x-ref on the origin
  floors +x and +z. The y floor scales with the arm's length (measured: an
  absolute 1e-9 would let a billion-unit collinear arm's 1.3e-7 rounding
  remainder through as a direction).
  **`fix` in 3D pins `[x, y, z]` in a frame**, and the frameless form is
  **gone** — in every dimension — so the gauge is no longer visible anywhere in
  the vocabulary. **`onPlane(point, frame?)`** (`onplane`) holds a point in a
  frame's plane: `(p − origin) · +z = 0`, a signed distance, read-never-pushed,
  default resolved at call time and journalled resolved; refused in 2D.
  **`"f1.z"`** is a frame-axis reference in 3D (refused in 2D, by
  `Model.requireAxis`, before the frame is looked up), and `zaxis(frame?)`
  joins `xaxis`/`yaxis`, all three through `Model.axisRef`. The context menu's
  Fix item reads frame coordinates in either dimension (its raw-coordinates 3D
  branch only made sense while `fix` there was gauge-relative).
  **Format version 5**: `addFrame`'s name moved to its fourth argument, and every
  older file's three-argument `addFrame` is translated on the way in (keyed on
  the version, so a hand-edited v5 entry fails at its own step). A v4 *3D* file
  that used the gauge `fix` is refused by step with the standing no-frame
  message — the app has always been 2D, so only the command line or a test
  could have written one.
  *Known and deliberate (then):* `onPlane` had no glyph symbol of its own (it
  would draw the fallback `o`, but only in a 3D drawing, which the app could
  not show — choosing a mark is for when it can be looked at); the line tool
  inferred no axis in 3D (that needed the camera's projection). Both closed by
  the entry below.
  *Spec:* [`docs/plans/3d-phase1.md`](docs/plans/3d-phase1.md).

- **The app is 3D: camera, working plane, projected drawing, lifted files**
  (`view.ts`, `vec3.ts`, `arcgeom.ts`, `projection.ts`, `workplane.ts`,
  `intersect.ts`, `picking.ts`, `snapping.ts`, `boxselect.ts`, `glyphs.ts`,
  `framemarker.ts`, `tools/*`, `operations.ts`, `replenv.ts`, `persist.ts`,
  `main.ts`) — the camera half of 3D phase 1. **The app runs `Model(3)`,
  always**; every door a model comes in by (new, open, the file picker, undo)
  opens into 3D.
  **The camera** (`view.ts`) is orthographic: `{ox, oy, scale}` as before plus
  optional `right`/`up` screen axes in world terms and an orbit `target`. A
  view with no orientation is the top view, evaluated term for term as the old
  2D formula, so every 2D caller gets bit-identical numbers. `orbitBy` turns
  the drawing about the screen's own axes (a trackball) about the target,
  which `panBy`/`zoomAbout` keep on its pixel; `alignView` is `lookAt`'s
  primitive; `depth` orders a painter's sort; `screenToPlane` is the one
  pixel-to-place intersection, and `screenToWorld` stays the 2D inverse (the
  ray's crossing with z = 0) for 2D models; `liesOn` is the shared "is this on
  the sketch" test.
  **The working plane** (`workplane.ts`) is the default frame's plane when
  there is one, else the camera-parallel plane through the target (z = 0 in an
  unturned view); a frame seen exactly edge-on falls back to the latter. The
  engine reads every pointer event there, reports it as `PointerInfo.plane`,
  and does a drag's offset arithmetic on the plane the press landed on.
  **Mouse** (⚠ register): right-drag orbits in a 3D model (`ORBIT_PER_PIXEL`,
  half a degree), middle-drag pans, the wheel zooms about the cursor, a right
  press released in place opens the menu; a 2D model keeps right-drag pan.
  `orbit(yaw, pitch)` and `lookAt(frame?)` join `pan`/`zoom`, unjournalled.
  **Drawing** (`main.ts`): curves and frames depth-sorted, then points
  depth-sorted on top. A circle is its silhouette (still a sphere to every
  relation — the phase-2 seam). An arc is laid out in the plane through its
  centre and endpoints and swept counter-clockwise about that plane's normal
  on the kernel's +z side, then +y, then +x (`arcgeom.ts` — the gauge showing
  through, in rendering and picking only, keeping every 2D arc as it was),
  drawn as a quarter-pixel polyline. A frame draws a three-arrow triad from
  `frameBasis`, each arm foreshortened.
  **Picking, snapping, box select and glyphs** stay screen-space; what changed
  is what each entity looks like on screen and which world point a pixel on it
  stands for (`projection.ts`). A face-on arc is the exact screen arc it always
  was; an oblique one is a polyline (`intersect.ts` gained polylines). Snap
  world positions are lifted off the entity, never inverted from the pixel; a
  screen crossing counts only where both curves' lifts are one place; and with
  a sketch plane, only snaps on it are offered (a vertex merely *behind* a
  square-on sketch is no place on it — found in the poster screenshot).
  Glyph nudges are measured on screen; a circle's rim glyph sits on the
  silhouette. `onPlane` wears `▱`.
  **Tools** draw on the working plane: rectangle (derived corners along the
  plane's axes), circle (full 3D radius; silhouette preview via
  `RenderContext.scale`), circle3/arc3 (3D circumcircle, world-space previews),
  arc (endpoints stored so the drawn sweep is counter-clockwise *as seen*),
  line (axis inference against a 3D frame, in its plane). `placePoint` infers
  `onPlane` with the default frame where the snap leaves the point free and the
  point is on the plane; a tool's derived points get it too. `fillet` is
  dimension-generic.
  **Format version 6**; opening a 2D file into 3D (keyed on `dim`) lifts every
  coordinate to z = 0 and gives each frame a named y-ref (`<frame>_y`, never a
  name the file uses), placed from the saved coordinates. The library opens a
  file in its own dimension unless asked. At the command line `pt(x, y)` and
  `fix(p, [x, y])` take the same lift. 493 unit tests, 187 e2e.
  *Known and deliberate:* circles are spheres (silhouettes; intersection snaps
  only square-on); an arc turned through the vertical draws as its complement;
  `pt(x, y)` seeds at the kernel's z = 0 even with a tilted default frame; typed
  `frame()` seeds along kernel axes in a turned view; one depth per entity in
  the painter's sort; no snapping to off-plane geometry while sketching.
  (↻ The circle, arc, typed-`frame()` and off-plane-snap seams closed in 3D
  phase 2 — next entry.)
  *Spec:* [`docs/plans/3d-phase1.md`](docs/plans/3d-phase1.md).
- *(Superseded by frameless curves, above: a curve carries its own normal, not a frame name.)* **Planar discipline: circles and arcs carry a plane** (`model.ts`,
  `relations/refs.ts`, `relations/geometry.ts`, `curveplane.ts` (new),
  `arcgeom.ts`, `projection.ts`, `glyphs.ts`, `snapping.ts`, `tools/*`,
  `operations.ts`, `persist.ts`, `planetranslation.ts` (new), `replenv.ts`,
  `menu.ts`, `main.ts`) — 3D phase 2.
  **The plane.** A 3D `CircleEntity`/`ArcEntity` has `plane`, a frame name:
  `addCircle(center?, radius?, plane?, name?)` and `addArc(…, radius?, plane?,
  name?)` resolve it like `fix` (the one named, else the default **at call
  time**, journalled resolved; with neither, the standing message — and before
  any auto-created centre exists). A 2D model refuses the argument. The frame
  gives orientation only: the **rim is the circle through the circle's own
  centre parallel to the frame's x–y plane**; the centre is never pinned, so
  dragging it off the frame carries the rim with it, parallel. A free 3D arc's
  auto-created ends are seeded along the plane's own axes. `Model.dependents`
  counts the plane, so **deleting a frame takes the circles and arcs on it**
  (and the primitive refuses to orphan one).
  **Relations.** In 3D `onCircle` is two blocks — the distance, as ever, and
  `(p − centre) · +z` (`oncircle(p,c)|plane`) — and `tangent` gains a block
  holding both line ends on the rim's plane (`tan(l,c)|plane`); the frame's +z
  comes through `rimNormal` as a datum. In 2D neither extra block is emitted:
  the 2D relations are the blocks they always were, pinned by block count and
  by value. `arcends`, being two `onCircle`s, follows.
  **Orientation.** An arc turns counter-clockwise about its frame's +z
  (`arcFrame(c, s, e, r, side)`, `sweepsAs(…, side)`); the kernel-axis side rule
  is gone from everything but the v6 translation.
  **Drawing and hitting.** `curveplane.ts` answers "where is this rim" for
  everyone (`curveFrame`, `curvePlaneOf`, `sketchSide`); `circleFrame` lays a
  whole circle out for the arc machinery. A circle seen obliquely is a closed
  quarter-pixel polyline on its ellipse — drawn, picked, snapped, boxed, lifted
  by angle — and face-on the exact circle it always was. The silhouette is
  gone; a rim glyph sits on the planar rim where the screen says up-right; the
  hover tag and `ls()` name the plane (`c1  r 10  in f1`).
  **Tools.** circle/circle3/arc/arc3 refuse their first click in 3D with no
  default frame (`curveToolReady`: log, nothing placed; a throw headless), and
  the empty-canvas menu shows those four and Fillet **disabled with the
  model's own message**. Previews are sampled in their plane. `fillet(l1, l2,
  r, plane?)` takes the default in 3D (journalled `[l1, l2, r, frame]`; a 2D
  entry stays three arguments) and refuses a corner out of the frame's
  orientation (`IN_PLANE_SINE`, a millionth).
  **Off-plane snapping.** With a sketch plane, a point *off* it is offered at
  its projection onto it — `"projected"`, the foot of the perpendicular along
  the plane's normal — below every on-sketch point, crossing and midpoint and
  above a bare curve, drawn as a dashed hollow square with a dashed leader back
  to the point. It **infers nothing**; the placed point gets only the sketch's
  own `onPlane`. Points only: projecting curves is later.
  **Conveniences.** `plane(origin?, xref?, yref?)` = `frame()` +
  `setDefaultFrame` + `lookAt`, journalling only the first two. `frame()` with
  no refs in a *turned* view seeds them along the screen's right and up (an
  unturned view journals exactly what it did). A frame's menu gains **Sketch on
  this** → `setDefaultFrame("f"); lookAt("f")`.
  **Format version 7**: the plane before the name. Older files translate
  (`planetranslation.ts`): 2D → null planes; 3D → an arc takes the surviving
  frame nearest its normal read from the *saved* geometry (default, then
  earliest, on ties), a fillet its corner's, a circle the default (else one its
  centre is on, else the earliest); where none fits, a translation frame
  `plane` (never a name the file uses) in the curve's plane, on its centre; an
  arc whose v6 side disagrees with its frame's +z has its ends swapped.
  **Also:** `asOperation` journals after its body succeeds, so a refused
  operation (a fillet too big for its corner) no longer poisons the saved file.
  534 unit tests, 195 e2e.
  *Known and deliberate:* the plane never pins a centre (a tool's `onPlane`
  does); curves off the sketch are not projected (points only); a v6 *circle*
  cannot say which plane it was drawn in, so it takes the default; a v6 bare
  `arc()` with auto-created ends cannot be swapped and may open as its
  complement on an upside-down frame; `pt(x, y)` still seeds at the kernel's
  z = 0; one depth per entity in the painter's sort.
  *Spec:* [`docs/plans/3d-phase2.md`](docs/plans/3d-phase2.md).
- **Closed loops** (`src/loops.ts` (new), `replenv.ts`) — 3D phase 3. A pure
  question-about-the-drawing module, boxselect's kind, and nothing in the app
  calls it yet: a click inside a region still picks nothing, and loops are
  drawn nowhere.
  **`findLoops(model)`** returns every closed loop: a cycle of lines and arcs
  in one plane, joined end to end, or a whole circle. *Joined* means the same
  point entity or held by `coin` (a union over the relation registry, chains
  included) — never proximity, a crossing or a T (an `on`); the module header
  states it as the honesty line. *One plane* means every line end, arc centre
  and arc end within `liesOn`'s millionth, and every arc's frame +z parallel
  (sine ≤ 1e-6). Candidate planes come from each arc's and circle's frame and
  each non-parallel line pair at a joined vertex. Per plane: bridges dropped
  (Tarjan, multigraph-safe), any component whose edges cross is rejected, and
  the bounded faces are walked with edges ordered by tangent, curvature, then a
  mirrored index offset; a face revisiting a vertex is split there. Each `Loop`
  has `plane` (origin, u, v, normal, and the frame whose plane it is, if one
  is), `members` counter-clockwise about the normal from the earliest-made
  (name, `reversed`, `from`/`to` points), `area` (Green's theorem, arcs in
  closed form; positive as listed), and `parent`/`children` — the smallest
  coplanar container, touching at a point allowed, sharing an edge not.
  **`loopAt(model, view, sx, sy, loops?)`** casts the pixel's ray into each
  plane and tests by winding number (arcs exact); the innermost hit wins, then
  the nearest plane, then the smaller area; a loop under a pixel thick on
  screen is edge-on and skipped.
  **`loops()`** lists them — `loop of l1,a1,l2,l3,l4 in f1, area 1186.265`,
  `…, inside …` for an island — and journals nothing, claims no name, makes no
  undo step. 563 unit tests, 199 e2e.
  *Known and deliberate:* `loops()` says nothing about near-misses. (Until
  2026-10-21 a T or a crossing split nothing and a component whose edges
  crossed reported no loops; both changed — see "Regions split at Ts and
  crossings" below.)
  *Spec:* [`docs/plans/3d-phase3-loops.md`](docs/plans/3d-phase3-loops.md).
- **Extrude, the model half** (`extrude` in `src/operations.ts`,
  `src/relations/extrusion.ts` (new), the feature registry in `src/model.ts`,
  `persist.ts`, `replenv.ts`, `picking.ts`, `glyphs.ts`) — 3D phase 4, half 1.
  **`extrude(member, depth?, frame?)`** finds the loop the member is in —
  refusing none, or several (listed; `frame` narrows to the loop parallel to
  it), or a loop no frame orients — and expands it, with every loop inside it,
  into: a **lid frame** (the sketch frame's three points lifted by the depth,
  then the frame — as built then; see the note below); one **twin point per joined class** of the profile's points
  (corners and centres, joined by `loops.ts`'s own `joinClasses`); a **twin
  member** per member in its own direction (a curve on the sketch frame onto
  the lid frame, any other keeps its own); a **wall line** per corner class,
  base to twin (circles have none); and **one `extrusion` dimension**
  (`d`-named, `[frame, depth, base₁, twin₁, …]`): per point pair three linear
  residuals `twin − base − depth·ẑ`, per curve pair `r_twin − r_base`, the
  frame's +z and its own points read as a datum. It is in `DIMENSION_OPS` with
  its value at index 1 and has a `REBUILD` line, so **`set` moves the lid**.
  Default depth `DEFAULT_DEPTH` (10, a seed); zero refused, negative goes the
  other way. **Journalled as the call with its profile resolved** —
  `[member, depth, frame, loops]` — and a profile handed over is walked by its
  joins and checked closed, never re-found (replay runs on seeds, where a
  profile of free lines has no loop).
  **The record** (`FeatureEntry`, `model.features`, `e1`, `e2`, …, one
  namespace with entities and relations): `member`, `frame`, `top`, `depth`,
  `loops`, `twins`, `walls`, `names` (profile + frame + everything made) and
  `owns` (everything made). Made by `addFeature` (journals nothing; the
  operation is the entry), listed by `ls()` (`e1  extrude of l1,a1,… + 2
  inside, depth d2 = 20 along f1, lid f2`), named at the end of the hover tag
  of any piece (`· e1`). The depth's label is its value on the first wall,
  with `dist`'s witness lines; `rels()` writes it `d1  extrusion 20 along
  f1.z, 7 pairs` for a plain rectangle (four corners, three lid-frame points).
  **Deletion:** `del("e1")` takes the record and what it owns (with whatever
  needs those) and never the profile; deleting anything a record names takes
  the record and nothing else; `deleteEntity`/`deleteRelation` refuse while a
  record names the thing; `deleteFeature` is the journalled primitive. Format
  version unchanged (7). 584 unit tests, 207 e2e.
  *The rule now:* a feature's expansion is a function of its profile and
  follows it — a fillet on a profile corner regenerates the lid, keeping every
  twin and wall whose corner survives (see **Feature regeneration** below).
  *The lid frame now* is gone: a new extrude makes none, a twin curve names the
  sketch frame, and the record has no `top` (see **An extrude makes no lid
  frame** below; `rels()` on any rectangle says 4 pairs, and `ls()` drops
  `, lid f2`). Format 10's lid frame, on the lid's own corners where it could
  be (**A feature's frames share its own points** below), is what a version-10
  file still replays with. *Known and deliberate:* `fillet`'s new points are not held on the sketch, so a `set` can stir
  a rounded corner by a few millionths along +z.
  *Spec:* [`docs/plans/3d-phase4-extrude.md`](docs/plans/3d-phase4-extrude.md).
- **Extrude, the faces and the tool** (`src/faces.ts` (new),
  `src/tools/extrude.ts` (new), `main.ts`, `tools/engine.ts`, `tools/tool.ts`) —
  3D phase 4, half 2.
  **Faces** are a pure function of (model, view), glyphs.ts's kind, recomputed
  every frame from the live geometry and stored nowhere. `featureFaces` gives a
  feature's two caps — each one outline per profile loop, filled even-odd — and
  its walls: a quad per line, a strip of quads per arc or circle at
  `arcSegments`' drawing resolution, the twin sampled piece for piece with its
  base. Members are walked by position (so a profile whose join a deletion
  opened still draws). Outward normals: caps along ∓/± the sketch frame's +z by
  which way the lid went; walls `winding × (−1)^nesting × (edge × ẑ)`, the
  winding from the signed area about +z and the nesting from how many other
  loops contain a point of the loop. `facesToDraw` culls faces whose normal
  points away from the viewer, sorts far to near — a wall by its centroid, a
  cap by its nearest point — and shades each by `normal · toward` (a headlight);
  `faceColour` maps that onto the panel slates `FACE_DARK`…`FACE_LIGHT`, a
  quarter of the way up at worst. `main.ts` fills them (even-odd, plus a
  0.75px stroke in the same colour against anti-aliasing seams) **before** the
  entities, so every edge, point and glyph draws on top. A solid that cannot be
  laid out (a collapsed frame) costs its own faces and never throws.
  **The tool**: `arm("extrude", { depth })` (default `DEFAULT_DEPTH`). On move
  it asks `ctx.regionAt(screen)` — new on `ToolContext`, answered by the engine
  with `findLoops` + `loopAt` — and outlines the region (`regionOf`: the loop and
  every loop inside it), tinted even-odd; a click there runs `profileOf` and
  `extrude` with the profile resolved, solves and finishes; a click on nothing
  logs `extrude: no closed region under the click …` and stays armed (a throw
  headless). `Tool.snaps` (new, default true) is false for it, so the engine
  neither snaps nor draws a marker. Idle clicks are unchanged. 600 unit tests,
  210 e2e.
  *Known and deliberate:* the drawing stays over the faces, hidden edges
  included *(their hidden runs dimmed since 2026-10-22 — see "Hidden edges,
  dimmed" below; and since 2026-11-02 a shaded solid is opaque — what is behind it is neither drawn nor aimable, see "A solid is opaque" below)*; interpenetrating
  solids can sort wrong where they cross *(fixed 2026-10-22: faces are drawn
  by depth — see "Faces drawn by depth" below; the sort described here is now
  only the fallback's, by centroid)*; faces never pick, snap, box or wear a
  glyph; a solid's side face extrudes only once a frame is made on its plane
  *(since 2026-10-29 the tool makes that frame itself — see "Extrude on a
  frameless sketch" below)*.
- **Revolve** (`revolve` and `revolveProfile`/`checkRevolve` in
  `src/operations.ts`, `src/relations/revolution.ts` (new), `RevolveFeature` in
  `src/model.ts`, `revolveFaces` and `orderedFaces` in `src/faces.ts`,
  `src/tools/revolve.ts` (new), `Pick.axis` in `picking.ts`, `persist.ts`,
  `replenv.ts`, `glyphs.ts`) — 3D phase 5, the last of the roadmap.
  **`revolve(member, axis, angle?, frame?)`** finds the loop as `extrude` does
  (the shared refusals speak for whichever op asked) and turns it about `axis` —
  a frame-axis reference or a line's name, read through `axisReader` as a value
  at every evaluation, never a variable — through `angle` radians (a whole turn
  when left out; zero, NaN and more than a turn refused). Call-time refusals
  (`checkRevolve`): the axis leaning out of the profile's plane (`IN_PLANE_SINE`)
  or beside it, the profile — or an arc's or circle's rim, by its exact extremes —
  crossing the axis; touching it is allowed. **A whole turn** makes one
  `revolution` dimension with no pairs and no blocks, and the record. **A
  partial turn** expands, in a replayable order: an end frame per frame the
  profile is drawn on (the sketch frame's first — the record's `end`), each its
  three points turned and the frame; a twin point per joined class; a twin
  member per member (a curve on its frame's turned twin); and one
  **`revolution`** (`d`-named, `[axis, angle, base₁, twin₁, …]`): per point
  pair three linear Rodrigues residuals `twin − o − M·(base − o)`, per curve pair
  `r_twin − r_base`, per frame pair its three points; bases that are the axis's
  own points or a twinned frame's are read as a datum. In `DIMENSION_OPS`, value
  at index 1, a `REBUILD` line — **`set` swings the end face**; the relation
  refuses a partial angle with no pairs and a whole turn with pairs, so `set`
  cannot cross between full and partial. **Journalled as the call** `[member,
  axis, angle, frame, loops]`; given loops, nothing reads positions.
  **The record** (`kind: "revolve"`): `member`, `frame`, `axis`, `angle`,
  `loops`, `twins`, `end`, `names` (profile, sketch frame, the axis's frame or
  line, everything made) and `owns`; deletion is extrude's. `featureOf(name,
  kind?)` checks the kind. `ls()`: `e2  revolve of …, angle d3 = 270° about
  f1.y, end f3` (or `a full turn`); `rels()`: `d3  revolution 4.712… (270°)
  about f1.y, 8 pairs` for the filleted rectangle (six point classes, the arc's
  radius, the sketch frame); the label is degrees, halfway round the first corner's
  path (a full turn's beside the axis).
  **Faces** (`revolveFaces`): each member path swept in `arcSegments(|θ|,
  reach·scale)` steps (one count per solid, from its farthest point), a quad per
  piece per step, its normal the profile's in-plane normal turned to the step's
  middle, signed by the shared `outwardSigns`; a piece on the axis is skipped.
  Caps only when partial, even-odd, the start facing back along the sweep and
  the end on along it; the end cap and the last ring are the twins' live
  positions. **`orderedFaces`** (new, what `facesToDraw` projects): walls by
  centroid, caps by nearest point — then a cap that an overlapping wall of its
  own in front of its plane would sort before is lowered just under that wall
  (boxes, then an exact screen overlap; caps all but edge-on, shade < 1e-3, are
  left alone). An extrude never has such a wall. *(Deleted 2026-10-22 with the
  sort it served: `visibleFaces` culls and shades, a depth buffer orders.)*
  **The tool**: `arm("revolve", { angle })` — a click inside a region
  (`regionAt`), outlined as it moves; then a click on a line or a frame marker's
  arm (`Pick.axis`, new), the axis drawn dashed before the click; a click inside
  another region re-chooses; refusals logged as `revolve: …`, the tool keeping
  its state. Goes through `revolveProfile`. 634 unit tests, 218 e2e.
  *Known and deliberate:* within a few degrees of a whole turn, seen nearly along
  the axis, a wall can still draw over the start cap (no single key fits)
  *(fixed 2026-10-22 by drawing faces by depth)*; a
  deleted piece of a full revolve leaves its 360° dimension holding nothing; no
  seam edges are drawn along the surface; the surface never picks.
  *Spec:* [`docs/plans/3d-phase5-revolve.md`](docs/plans/3d-phase5-revolve.md).

- **A toolbar, the chrome as panels, and an empty-canvas hint**
  (`src/panels.ts` (new), `src/main.ts`, `index.html`, `layout` in
  `replenv.ts`). **The canvas is the whole window under the header**; the
  toolbar, the log and the command line float over it as **panels** — a title
  strip to drag by, a corner grip to resize by, both with pointer capture.
  `constrain` kept a panel's strip reachable (wholly inside top to bottom, at
  least `KEEP` = 40px of it sideways) *(since 2026-10-22: the whole panel
  wholly inside, `KEEP` gone — see "The tool tray" below)* and its size between
  its minimum and the area; the panel last pressed is raised (z-index from 10; the hover tag and
  menu sit at 50/60). **The header is not a panel** — the one fixed thing.
  **The toolbar** (`Toolbar`) builds one button per `listTools()` entry, in
  registration order, and `syncToolbar` in `main.ts` re-reads the registry and
  `engine.active` on every render, canvas press and release, entry and Escape,
  touching the DOM only on a change. A button **types `arm("name")` through
  `submit`** (hover text: that command); the armed one has `aria-pressed` and the
  amber outline. Buttons and strips prevent `mousedown`, so the command line
  keeps the focus. **Layout** (`Panels`): `stored` holds only panels the viewer
  touched, under `neocad.panels.v1` in `localStorage` (`loadLayout`/`saveLayout`
  never throw; `parseLayout` drops malformed entries one panel at a time);
  everything else is `defaultLayout(area, toolCount)` — toolbar top-left sized to
  its buttons, log and command line bottom-left, 560 wide — and what is shown is
  `constrain(stored ?? default)`, so a small window pulls panels in without
  forgetting where they were put. `layout()` reports, `layout("reset")` forgets.
  Never journalled, saved or an undo step. **The canvas captures every press**
  (in `main.ts`), so an armed tool's gesture released over a panel still ends on
  the canvas. **Typing with nothing editable focused focuses the command line**
  first. **An empty model draws a hint** in the render pass: *"Nothing drawn
  yet."* and the three ways in, wrapped at its commas on a narrow canvas.
  Unit: `test/panels.test.ts`; browser: `test/e2e/panels.e2e.ts`,
  `test/e2e/emptyhint.e2e.ts`; the harness's `at()` refuses a point under a
  panel. 645 unit tests, 237 e2e.
  *Known and deliberate:* positions are absolute pixels from the top-left (a
  moved panel does not follow a growing window); ~~a viewer-resized toolbar
  scrolls rather than grows when a tool is added~~ — overturned by the owner
  (2026-10-29), see "Panels resize from any corner" below: ~~the tray's
  buttons wrap into more lines and nothing scrolls~~ — and then, the same day,
  "The tool tray is one line" below: the tray is never resized, and grows a
  button for every tool whether or not it was moved; no icons, docking or
  panel-to-panel snapping *(icons and turning against an edge came with "The
  tool tray" below; there is still no positional snapping)*. (The toolbar not greying out the curve tools without
  a default frame was a caveat here; it went with the next entry.)
  *Spec:* [`docs/plans/panels.md`](docs/plans/panels.md).

- ~~**The toolbar greys out a tool that cannot run**~~ *(superseded by "No
  refusals" below: the rule now answers null and nothing greys; the machinery
  is kept)* (`src/toolavail.ts` (new),
  `src/menu.ts`, `src/panels.ts`, `src/main.ts`, `index.html`). One rule,
  `toolUnavailable(model, tool)`: in a 3D model with no default frame the five
  curve tools (`CURVE_TOOLS`: circle, circle3, arc, arc3, fillet) answer
  `resolveFrame`'s own message, everything else null. The context menu's
  disabled items and the toolbar's disabled buttons both come from it, so they
  say the same sentence the command line's refusal does. `ToolbarHost` has
  `unavailable(tool)`; `Toolbar.sync` re-reads it on every render and touches
  the DOM only on a change. A disabled button is shown, not hidden: `disabled`,
  its `title` the reason, in the menu's `.item.off` grey and never amber, even
  when it was armed before its frame was deleted. `arm` is unchanged — typing
  `arm("circle")` with no frame still arms it, and its click is still refused in
  the log. Unit: `test/toolavail.test.ts`; browser: `test/e2e/panels.e2e.ts`.
  652 unit tests, 242 e2e.
  *Known and deliberate:* the rule is keyed by name, so a command-line tool
  that re-registers `circle` (or another curve tool's name) is greyed with it.
  *Spec:* [`docs/plans/toolbar-availability.md`](docs/plans/toolbar-availability.md).

- **Clauses: an entity defined by any constraint set** (`src/clauses.ts` (new),
  `src/replenv.ts`, `fmt` in `src/repl.ts`). `_` is one frozen value in scope;
  a relation given `_` in any argument returns a `Clause` — `{ op, args }`, the
  name it was called by and its arguments with `_` left in, printing as the
  call (`on(_, "l1")`) — instead of applying. `pt`, `ln`, `circ`, `arc` and
  `frame` split their arguments by type (a clause is never a number, a name or
  null), make the entity exactly as before from the rest, then apply each
  clause with `_` filled in, and return the name. `constrain(name,
  ...clauses)` is the same on an existing entity, returning the relation names.
  Pure command-layer sugar: a clause applied *is* the relation called by name,
  so the model, relations, persist and the file format are unchanged — a unit
  test saves a clause expression and its expanded lines to the same bytes, and
  `del` cascades the same. **Checked before anything is made:** each is a
  clause (a relation's `rN` where a clause goes — the `_` forgotten — is named
  as such), mentions `_`, and names only entities that exist; a constructor's
  own arguments are never `_` or an `rN`, and `pt`'s are numbers. `_` in a
  numeric slot (`rad("c1", _)`, `fix(_, [_, 2])`) or past a relation's arity is
  refused when the clause is made, from a slot list every relation binding now
  carries. A clause given *to* a relation is refused too. `fmt` honours
  `Symbol.for("nodejs.util.inspect.custom")` (Node's own convention), which is
  how a clause prints without `repl.ts` knowing what one is. Unit:
  `test/clauses.test.ts`; browser: `test/e2e/clauses.e2e.ts`. 673 unit tests,
  247 e2e.
  *Known and deliberate:* a relation that refuses *while applying*
  (`ln(on(_, "l1"))` — a line is not a point) leaves the entity and any earlier
  clause made; the refusal is the relation's own, prefixed with what was made
  (`ln made l2, but on("l2", "l1") refused: …`), and at the command line the
  entry is still one undo step. `_` must be written; omitting it is deferred
  (register). `pt` now refuses a non-number argument it used to pass to the
  model as a coordinate.
  *Spec:* [`docs/plans/clauses.md`](docs/plans/clauses.md).
- *(Revised by frameless curves, above: it sets the work plane, `workplane("a.b.c")`, and makes no frame.)* **Sketch on a face** (`src/sketchface.ts` (new), `src/tools/sketch.ts` (new),
  `src/tools/region.ts` (new), `menu.ts`, `tools/tool.ts`, `tools/engine.ts`,
  `main.ts`, `replenv.ts`'s help). A face is not an entity and is not picked:
  every planar face of a solid — and every plain sketch loop — is a loop
  `loopAt` finds, so the face under a click is a *region*, as the extrude tool
  asks for one. **`sketchFrameFor(model, loop, toward)`** returns three of the
  loop's own points — the first corner (a vertex not on a straight run) and its
  two neighbours, so +x runs along an edge; failing that any three vertices off
  one line, then arc centres; a whole circle its frame's three points — ordered
  so `(b − a) × (c − a)` faces `toward`, the line of sight back at the viewer.
  The first surface a ray meets is one whose outward normal faces it, so that
  puts +z out of a solid: a positive extrude on a wall is a boss. Refusals by
  name: a 2D model, a loop seen exactly edge-on, no three points off one line (a
  semicircle closed by its diameter), a circle off its own frame's plane.
  `sketchOnFaceCommand` is the same as `plane("a", "b", "c")`.
  **The tool**, `arm("sketch")` (on the toolbar by registering): hover outlines
  the region (the extrude tool's preview, now shared in `tools/region.ts` with
  extrude and revolve), a click inside **types** `plane(a, b, c)` through
  `ToolContext.run` (new; `main.ts` hands it `submit`, the menu's seam) and
  finishes — so the log shows the call and its answer, the journal holds
  `addFrame` + `setDefaultFrame`, the view turns square to the face, and it is
  one undo step. A click on nothing logs `sketch: no face under the click …`
  and stays armed; headless with no `run` it throws. `regionAt` (now also a
  public `ToolEngine.regionAt`) reports `toward` with the region
  (`RegionHit`). **The menu**: `menuFor(model, pick, region?)` — on empty
  canvas inside a region of a 3D model, **Sketch on this face** runs the same
  line, or shows disabled with the helper's reason. The frame's points are the
  solid's, so it follows the solid (`set` the depth and the wall's frame stays
  on the wall); `del` of the frame takes what was drawn on it and the record of
  a feature built on it, never the solid. 686 unit tests, 254 e2e.
  *Known and deliberate:* a boss's lid frame twins the face frame's corner
  points, so its marker floats off the plate's corner; the plane is always
  made the default and looked at (it is `plane()`); which edge is +x is
  whichever the loop starts at.
  *Spec:* [`docs/plans/sketch-on-face.md`](docs/plans/sketch-on-face.md).
- **Regions split at Ts and crossings** (`src/loops.ts`, `faces.ts`'s
  `loopOutlines`, `tools/region.ts`, `sketchface.ts`, `operations.ts`'s
  `profileOf`) — the first half of `regions-split`. `findLoops` cuts every
  edge, per plane, at each point a relation holds within it (`on` on a line,
  `oncircle` on an arc or circle, `mid`'s line form; the point's joined class is
  the vertex) and at each crossing of two coplanar edges in their interiors
  (line–line, line–arc, arc–arc, whole circles; closed forms; a tangency — a
  curve within tolerance of touching — an end resting on an edge, and edges
  lying along each other are not crossings). A crossing is a **virtual vertex**
  keyed by the edges through it in creation order, `l1×l5`, numbered
  `c1×c2#1`/`#2` along the first when they cross twice, primed (′) past any name
  the model has (`isVirtual`); crossings at one spot are one vertex, and one at
  a held point is that point. Then the face walk as before. **`LoopMember`**
  gains `span` — `[start, end]` as fractions of the entity in its own direction
  (a circle from its frame's +x, past 1 across its seam), null for the whole —
  and `from`/`to` may be crossings; a member is the longest run of one entity
  the loop walks, so a cut that is no corner of the loop is not listed.
  Crossing lines are candidate planes (three lines crossing bound a triangle).
  `loopAt`, containment and areas use the portions. **`loops()`** prints a
  portion with its vertices in its entity's own direction —
  `loop of l1[p1→l1×l5],l5[l1×l5→l3×l5],l3[l3×l5→p4],l4 in f, area 450` — which
  is also the hover key (`memberLabel`), so the crescents of a lens differ.
  **The region preview** outlines portions (`loopOutlines` takes members), so
  the extrude, revolve and sketch tools outline exactly the sub-region under
  the cursor. Until PR 2 (next entry), `extrude`/`revolve` refused a split
  region by name, in `profileOf`.
  `sketchFrameFor` skips crossings, falls back to parted edges' own ends, and
  gives a lens of circles a circle's frame. 706 unit tests, 258 e2e.
  *Known and deliberate:* a crossing key is positional and may change under a
  drag; two held points of different classes on one spot cut once; collinear
  overlap is not a crossing; a 30 × 30 grid of crossing lines costs 31 ms a
  hover. *Spec:* [`docs/plans/regions-split.md`](docs/plans/regions-split.md).
- **Features over split regions** (`operations.ts`'s `extrude`, `revolve`,
  `profileOf`, `extrudeProfile` (new), `materialise`, `walkLoop`; `Portion` and
  `ProfileMember` in `model.ts`; `faces.ts`'s `portionPath`; `portionAngles` in
  `arcgeom.ts`; `persist.ts` `VERSION` 8) — the second half of
  `regions-split`. A region cut out by a crossing or a T extrudes and revolves
  as the preview outlined it: a plate with a line across it is a stepped block
  from one sketch, a lens of two crossing circles a lens-shaped solid. A
  profile member is a whole entity's name or a **`Portion`** `{name, from, to}`
  between two **real points** in the entity's own direction. Before anything
  is twinned, every crossing the profile runs through is **materialised**: a
  point seeded at the crossing and held `on` (`oncircle` on curves) every edge
  the profile bounds there, owned by the feature; a T's point is already real
  and the feature only names it, as does a later feature on the other side of
  the line, which finds the materialised point held on both edges. Twins per
  joined class, a twin line or arc per portion between the twins of its ends,
  walls per vertex; a revolve's end twins likewise, and a whole turn
  materialises too (its surface is swept between those points). Caps, walls
  and sweeps draw a portion between its two points **as they are now**, never
  over the span found at hover time. **The journal** names the points:
  `extrude("l4", 10, "f1", [[{"name":"l1","from":"p1","to":"p10"},…,"l4"]])`,
  read after the body (`asOperation` takes its args as a function), and a
  replay that meets a vertex the model has no point by makes it under that
  name; a vertex spelled with `×` that is no point is refused, so no key is
  ever kept. Bare names still mean whole members: a version-7 file reads as
  before, and one claiming 7 with a portion in it is refused at its step.
  `checkRevolve` measures a portion over its own part, so a half revolves
  about the line that cut it. `ls()` and the hover tag name portions as
  `loops()` does (`l1[p1→p10]`); `set`, `del` both ways and the hover `· eN`
  carry over, a materialised point deleting as a twin in its position does.
  772 unit tests, 263 e2e. *Known and deliberate:* deleting the first step of
  a stepped block takes the second's record and its walls on the shared
  crossings (the twin rule); the two steps' walls along the shared line
  overlap, which loops.ts reads as no region, so the riser between the steps is
  drawn but is no loop to sketch on; a replay seeds a materialised point at a
  placeholder that the saved values replace. *Spec:*
  [`docs/plans/regions-split.md`](docs/plans/regions-split.md).
- **Feature regeneration** (`operations.ts`'s `regenerateAfter`,
  `rebuildFeature`, `refoundProfile`, `regen` (new) and the end of `fillet`;
  `Model.rewriteFeature` (new); `persist.ts` `VERSION` 9, `regen` in the replay
  table and `translate`'s version-8 fillet; `replenv.ts`) — **a feature's
  expansion is a function of its profile, and follows it.** `fillet` ends, inside
  its own `asOperation`, by regenerating every feature whose profile names either
  leg, and then every feature whose profile names a twin line one of those
  re-pointed (a solid on a lid). Each profile is **found again the way the call
  found it** — the loop containing the record's `member` parallel to its sketch
  frame, with every loop inside it, crossings materialised (`profileOf`); a member
  in several such loops takes the one keeping most of the old outline. Then a
  **diff and rebuild**: per joined class, the old twin and wall where the class
  survives, new ones where it is new, released by the ordinary cascade where it
  has gone; per member, the old twin where its ends are the same, a line twin
  **re-pointed** (`retargetLine`) where an end moved, an arc or circle twin made
  again where its ends or centre changed, a new twin of its kind for a new
  member; materialised points no longer on the profile released with their
  holds; the dimension rebuilt in place (`rebuildRelation` with `REBUILD`), the
  record rewritten in place under its name, kept loops in the record's own order.
  **`regen(feature)`** does the same for a profile restructured by hand, refusing
  a non-feature name or a gone profile before it changes anything. Both journal
  what they found, resolved: `fillet(l1, l2, r, frame, [[e, loops], …])` (the
  fifth argument only when a feature stood on a leg) and `regen(e, [[e, loops],
  …])`; a replay is handed the profiles and finds nothing. A version-8 file's
  fillet with a feature on a leg is translated to regenerate nothing — what its
  build did. 787 unit tests, 270 e2e. *Known and deliberate:* a feature whose
  profile `fillet` leaves unfindable is left as it was (the fillet has already
  happened; `regen` says why); an arc twin whose ends move is remade, not
  re-pointed; the chain follows re-pointed twin lines only, so a hole `regen`
  adds to a lid does not reach a solid on that lid until it is `regen`'d; a
  fillet on a *lid* corner regenerates what stands on the lid, not the feature
  that owns it. *Spec:*
  [`docs/plans/feature-regeneration.md`](docs/plans/feature-regeneration.md).

- **Faces drawn by depth** (`src/facelayer.ts` (new), `visibleFaces` and the
  fallback `facesToDraw` in `src/faces.ts`, `clipMatrix` in `src/view.ts`,
  `#faces` in `index.html`, `main.ts`). A solid's faces are drawn by **WebGL
  with a depth test** on `#faces`, a canvas under the 2D `#cv`, sized as its
  twin, with `pointer-events: none`; `#cv` is transparent wherever it draws
  nothing. The projection is the view's: `clipMatrix(view, w, h, [far, near],
  anchor)` is `worldToScreen` and `depth` in clip coordinates, column-major,
  the depth range the visible faces' own each frame (padded), points sent
  relative to the world point at the middle of the screen. A face whose one
  outline is convex goes in one batched triangle-fan draw; any other (a cap,
  holes and all) is filled even-odd by the stencil method — fans invert a
  stencil bit with no colour, then the same fans write colour and depth where
  it is odd and clear it. Shade unchanged: `faceRGB(normal · toward)`, flat per
  face; `faceColour` is its fill style, so both renderers write the same
  bytes. Context `preserveDrawingBuffer: true` so a picture can be read back;
  a lost context is asked back and the next frame redraws. **The painter's
  fallback**: `createFaceLayer` returns null without WebGL (or a stencil
  buffer, or shaders), and `main.ts` fills `facesToDraw` — visible faces far
  to near by centroid — into `#cv` first, as before; nothing else branches on
  it; the debug hook says which (`__neocad.faces`). Deleted: the nearest-point
  cap key, the cap-lowering rule (`orderedFaces`, `overlaps`, the box tests),
  and the limits they had. **Measured** (`npm run measure:depth`,
  `test/e2e/depth.measure.ts`): the painter's wrong in 39 of 40 views of two
  interpenetrating extrudes (mean 4 528 px), 13 of 40 of a 355° revolve, none
  of a lone box or cylinder; frames 45.9 / 46.0 ms (stepped block) and 51.2 /
  252.9 ms (filleted full turn), depth / painter's, headless Chromium on
  SwiftShader. **Tests**: the e2e harness launches Chromium with SwiftShader
  WebGL by name, opens the app with WebGL taken away on request
  (`openApp({ webgl: false })`), reads `"faces"`, `"drawing"` or `"screen"`
  pixels (`app.pixels`), and checks a picture against an oracle casting each
  pixel's ray at the faces' planes (`nearestFaces`, `checkPicture`); scenes
  shared with the measurement in `test/e2e/scenes.ts`. 788 unit tests, 277
  e2e. *Known and deliberate:* the drawing stays over the solid (its hidden
  parts dimmed since — the next entry); the fallback's centroid sort is wrong where any
  sort is, a grazing lid past its own hole's far wall included, and a test
  holds it to that; nothing tests a lost context; in a browser with no GPU a
  frame is ~45 ms whichever renderer draws it. *Spec:*
  [`docs/plans/display-depth.md`](docs/plans/display-depth.md).

- **Hidden edges, dimmed** (`src/occlusion.ts` (new), `strokeEdge` and
  `drawFrame` in `src/main.ts`; `nearestFaces` in `test/e2e/harness.ts` now
  imports the module). *(Since 2026-11-02 this is `view("hidden")`; the default is opaque — see "A solid is opaque" below.)* The drawing stays on top of the faces and picks, snaps
  and drags as before; **the part of an edge behind a face is stroked in a
  dimmed ink**. `occlusion(faces, view)` projects every visible face once a
  frame with its screen box and plane; `hidden(occ, world)` asks whether a face
  covers the point's pixel (box, then even-odd over its outlines) with the
  point more than `SLACK_PX` (½ px) of world behind its plane, measured square
  to the plane; `inkRuns(occ, polyline, closed)` samples a polyline at its
  vertices and at least every `SAMPLE_PX` (4 px) between, first dropping the
  faces whose boxes miss the edge's, and returns runs of screen points, the
  seam half-way between disagreeing samples; `hiddenInk(css)` is the colour
  `HIDDEN_KEEP` (40%) of the way from `faceRGB(0.5)` (from `faceRGB(0)` since 2026-11-02). `nearestFace` and
  `outlineDistance` are the e2e oracle's two questions. `main.ts` asks only
  when the model has a feature with a visible face; an edge all one ink is
  stroked by the old calls. Frames' arms are edges; points, names, letters
  and glyphs are untouched. **Measured** (`npm run measure:hidden`): see the
  CHANGELOG. **Tests**: `test/occlusion.test.ts` (box from a corner, no faces,
  grazing, the slack at three zooms, three runs with bounded seams, 40 random
  lines' seams, a ring, the oracle, the ink) and `test/e2e/hidden.e2e.ts` (a
  plain sketch pixel for pixel against the previous build's recorded drawing,
  `test/e2e/golden/hidden-plain-sketch.png`; the stepped block's hidden and
  near edges and a hidden point's dot; frame arms; a lit line amber in front
  and dimmed amber under, picking where dimmed; the boss on a plate; the
  painter's fallback). 797 unit tests (nine new), 284 e2e (seven new). *Known and deliberate:* a face seen within
  about a degree of edge-on hides only what is more than half a pixel behind
  its plane; a hidden edge that ends on the silhouette keeps up to 2 px of
  full ink at that end; the golden picture is tied to the e2e browser (pinned
  SwiftShader) and is re-recorded only deliberately
  (`NEOCAD_E2E_GOLDEN_RECORD`). *Spec:*
  [`docs/plans/hidden-edges.md`](docs/plans/hidden-edges.md).

- **The tool tray: icons, held inside, turning with the edge it meets**
  (`src/tools/icons.ts` (new), `src/panels.ts`, the toolbar host in
  `src/main.ts`, `index.html`). **Wholly inside**: `constrain` clamps a panel to
  `0 ≤ x ≤ area.w − w`, `0 ≤ y ≤ area.h − h` after holding its size between its
  minimum and the area; only a minimum bigger than the area spills, off the
  right and bottom. **Icons**: `TOOL_ICONS`, keyed by registered name, holds a
  16-unit inline SVG per built-in (point, line, rectangle, circle, circle3, arc,
  arc3, fillet, extrude, revolve, sketch) in one family — 1.5 round strokes in
  `currentColor`, corner radius 1, no fill but a dot; `genericIcon(name)` is a
  square with the name's first two letters, escaped; `toolIcon` picks, never
  guessing (`Object.hasOwn`). The toolbar gets a glyph only through
  `ToolbarHost.icon`. A button is a 20px square holding the glyph, its `title`
  `name — arm("name")` or `name — <reason>` when disabled, its `aria-label` the
  name; armed amber and disabled grey are the button's `color`, so the glyph's.
  **Turning**: a tray (`Panels`' `trays`, id → button count; the toolbar is the
  one) has `orient` `column` or `row`; `traySize(n, o)` is one button (28px)
  thick and `16 + 6 + 22n` long, a row's strip down its left end.
  `contacts(r, area, others, SNAP)` says which edges are within `SNAP` = 6px of
  the area's edge or a panel's facing edge that it overlaps along;
  `orientationFor` is row for a horizontal contact only, column for a vertical
  only, unchanged for both or neither; `turned` re-sizes to the content and
  keeps the contacting edge, then constrains. On every move of a strip drag
  the DOM half calls `turned` and re-bases the drag where it turned; the grip
  never turns a tray. Stored as `orient` beside the rectangle under
  `neocad.panels.v2` (v1 not read); `layout()` prints it; `layout("reset")`
  is a column again. The log and command line never turn. Unit:
  `test/panels.test.ts`, `test/icons.test.ts` (the table against every tool
  `main.ts` imports, the family, escaping); browser:
  `test/e2e/panels.e2e.ts`. 802 unit tests, 286 e2e.
  *Known and deliberate:* ~~a moved or turned tray keeps its stored size when a
  tool is defined (it scrolls) (it wraps, since 2026-10-29)~~ *(since
  2026-10-29, "The tool tray is one line" below: its stored size is never read,
  and it grows a button)*; ~~the grip overlaps the last button's corner~~ *(a
  tray has no grips, since 2026-10-29)*; a
  glyph, like availability, is keyed by name, so a re-registered `circle`
  keeps the circle; no positional snapping. ~~A tray pushed past another
  panel's edge overlaps it~~ — overturned by the owner (2026-10-26), see the
  next entry: panels push one another and never overlap. *Spec:*
  [`docs/plans/toolbar-icons-docking.md`](docs/plans/toolbar-icons-docking.md).

- **Panels push one another; the grasp point stays the same** (`src/panels.ts`, one
  line of `src/main.ts`). **No two panels overlap** — during a drag, after a
  resize, when a tray turns or grows, on load — and **the window's edge is the
  one immovable thing**. `pushed(id, want, layout, area, minSizes, motion)` is
  the one resolver: `want` is constrained, then each axis of `motion` in turn,
  the larger first (ties x), moves the mover along that axis and `shove`s
  every panel its *swept* rectangle overlaps flush against its leading edge,
  chained (a panel reached again by a longer push moves again); if a pushed
  panel would leave the area the travel is pulled back by the overshoot,
  exactly, so the mover stops flush. With zero motion (a turn, a placement) the
  mover is put down and what it covers is pushed along x away from it, then x
  the other way, then y the same; the first sound result wins, else `ok:
  false` and nothing moves. `settled(layout, order, …)` puts panels down in
  order, earlier ones holding their places; `apply` runs it every time, and
  what it moves is not stored. `dragStep(grab, pointer, …)` is one pointer
  move: the wanted rectangle from the pointer minus the grab, `pushed`, the
  tray's turn (pushed with zero motion; refused if nothing can make room, or
  if under the hand the new shape would turn straight back), and the grab
  handed back as it came: **the grab is fixed at the moment the panel is
  taken** (the owner, 2026-10-27, reversing the slip he had asked for: *"actually
  the grasp point should stay the same"*). A panel stopped short stays put
  while the pointer goes on and moves again only when the pointer comes back
  past where it left the panel, then exactly under the hand where it was
  grabbed; the grip the same. A move that ends short of the hand with nothing
  stopping it (a panel slid clear of what stopped it along the other axis) asks
  `pushed` again, up to three rounds. A tray that turns is the one change to
  the grab: `regrasped` keeps the same point of the strip, the same fraction
  along it. At a
  gesture's end every panel it moved is stored (key still `v2`); an `apply`
  that arrives mid-gesture waits for the end. `overlapping(layout)` lists
  overlapping pairs; with `check` on (the dev server, from
  `import.meta.env.DEV`) the DOM half `reportError`s any after a placement
  the resolver called sound, which the e2e suite sees as a page error. Unit:
  `test/panels.test.ts` (12 new, including 2 000 seeded random drags and
  resizes over three panels asserting no overlap and no pixel outside after
  every step); browser: `test/e2e/panels.e2e.ts` (6 new: the chain to the
  bottom edge and, measured, the tray waiting for the hand to come back
  (reworked 2026-10-27), log into command line, resize into it,
  reload and reset, an overlapping stored layout, thirty random drags). 826
  unit tests (the random walk also asserting the panel under its grab whenever
  nothing blocks it), 299 e2e. *Known and deliberate:* a window too small to hold
  every panel side by side at its size leaves the last placed over its
  neighbour (nothing shrinks a panel to make room); only the dragged tray
  turns, a pushed one keeps its way; with zero motion the tie goes to x, so a
  toolbar grown onto the log nudges the log sideways by the tray's thickness;
  a tray turned against a bottom or right edge lies along it, away from the
  hand, until the next move brings it back under the hand.
  *Spec:* [`docs/plans/panels-push.md`](docs/plans/panels-push.md).
- *(Superseded by frameless curves, above: no plane is made; `orientingPlane` reads the profile's own.)* **Extrude on a frameless sketch makes its own plane** (`orientingFrame`,
  `extrudeNeedsFrame`, `revolveNeedsFrame`, `checkRevolveRegion` in
  `src/operations.ts`; `featurePlaneCommand` in `src/sketchface.ts`;
  `src/tools/extrude.ts`, `revolve.ts`; `ToolContext.run`/`act`/`log` in
  `tools/tool.ts` and `engine.ts`; `main.ts`'s `onRun`/`onLog`; `replenv.ts`'s
  `plane`, `extrude`, `revolve` and help). A loop no frame lies in or along —
  a rectangle drawn in a fresh model — is no longer refused by the tools or the
  typed calls: they make a frame of three of its own points first
  (`sketchFrameFor`: a corner and its neighbours, +z toward the viewer, or the
  loop's own normal headless) as its own journalled call, the default only if
  there was none. **The tools type it** — `plane(a, b, c, { look: false })`, or
  `frame(a, b, c)` beside a default they keep — through `ctx.run`, which now
  settles once the line has run; then commit along it in `ctx.act` (new), so
  it is a second undo step; and log what they made (`e1  extrude of …`,
  `ToolContext.log`'s new `"done"` outcome, shown as an answer). **Typed**,
  `extrude`/`revolve` check every refusal that needs no frame first (revolve's
  geometry against the loop's own plane), then `addFrame` (+ `setDefaultFrame`)
  and the operation, one undo step. `plane(…, { look: false })` makes the frame
  and default without turning the view. `operations.ts`'s `extrude`/`revolve`
  still refuse a frameless loop — the guard. Unit: `test/extrudeplane.test.ts`
  (12); browser: `test/e2e/extrudeplane.e2e.ts` (4: the owner's sequence, two
  undos to the frameless rectangle, typed, a turned view). 844 unit tests, 318
  e2e. *Known and deliberate:* typed is one undo step, the tool two; the
  sketch's +x is whichever edge `sketchFrameFor` starts at; headless with no
  `run` the tools still refuse.
  *Spec:* [`docs/plans/extrude-makes-its-plane.md`](docs/plans/extrude-makes-its-plane.md).
- *(Revised by frameless curves, above: the curve tools make no plane now.)* **No refusals: the curve tools make their plane, a miss is guidance, and
  what would work is lit** (`CurvePlane`/`clickPlaneCommand` in
  `src/tools/place.ts`; `circle`, `circle3`, `arc`, `arc3`, `fillet` in
  `src/tools/`; `filletNeedsFrame` in `src/operations.ts`;
  `cornerPlaneCommand`/`facingPoints` in `src/sketchface.ts`;
  `Model.checkCircle`/`checkArc`; `planeForCurve`/`planeForCorner` and help in
  `src/replenv.ts`; `src/toolavail.ts`; `ToolContext.log`'s `"guide"`;
  `litRegions`/`drawLit`/`lightRegions`/`missedRegion`/`edgeOn` in
  `src/tools/region.ts`; `revolveAxes` in `src/tools/revolve.ts`; `main.ts`'s
  `onLog`/`stepNote`/`endUserAction`; one line of header CSS in `index.html`).
  **The curve tools in a 3D model with no default frame make it** at their
  first click — `plane(pt(x, y, z), null, null, { look: false })`, typed
  through `ctx.run`: the click as origin, refs along the screen axes as
  `frame()` seeds, the default, the view unturned; later clicks land on it; a
  commit that beats the typed line waits and is its own step (`ctx.act`). The
  fillet tool types a plane of the corner's own points, +z toward the viewer,
  after every frameless refusal. Typed `circ()`/`arc()` make `plane()` at the
  view centre first (their own refusals asked first, one entry, said in the
  log); typed `fillet` makes a frame on the corner. `toolUnavailable` answers
  null always, so nothing greys on the menu or the toolbar. Headless with no
  `run` the tools still refuse in the model's words, and the model's "no
  default frame" stands under all of it. **Every click refusal is guidance**:
  one short sentence of what would work, `ctx.log(line, "guide")`, shown in
  the log's muted `out` and in `#stepnote.guide` for 5 s (cleared by the next
  recorded step), the tool still armed; red is left to the model. **While
  extrude, revolve or sketch is armed every loop's region is lit** faintly
  (even-odd, so a hole is clear in its outline's region and lit as its own;
  loops thinner on screen than they are long skipped); **revolve, holding a
  profile, lights every line and frame arm `checkRevolveRegion` accepts**.
  Unit: `test/curvetoolplane.test.ts` (12), `test/guidance.test.ts` (7),
  `test/toolavail.test.ts` (rewritten, 4); browser:
  `test/e2e/firstrun.e2e.ts` (8: the first run, pointer only, no red line at
  the end), the greyed-toolbar section of `panels.e2e.ts` rewritten, the
  refusal assertions of the tool e2e files updated. 868 unit tests, 330
  e2e. *Known and deliberate:* hidden faces lit too; an abandoned curve gesture
  keeps its plane; the made frame's ref points show; the operation's longer
  words still reach some guidance lines.
  *Spec:* [`docs/plans/no-refusals.md`](docs/plans/no-refusals.md).

- **Panels resize from any corner; the tray's buttons wrap** (`src/panels.ts`,
  `index.html`). *(The wrap, and with it every tray grip and every function
  named below that fitted a tray — `trayFit`, `perLine`, `trayDepth` — was
  removed the same day by the owner's reversal; see "The tool tray is one
  line" below. The grips on the log and the command line, `resized`,
  `grabbed` and `cornerOf` stand, drawn as nothing.)* The owner (2026-10-29): *"allow me to rescale the popup
  windows from any corner. the tool palette should wrap the icons also - i.e.
  if it is vertical and i decrease vertical size, it should create a second
  column."* **Four grips per panel**, made by the DOM half (`.pgrip
  [data-corner]`, `CORNERS`), each a 12 px square clipped to the triangle in its
  corner, the cursor of its diagonal. `resized(start, dx, dy, area, min,
  corner)`: that corner and its two edges follow the pointer, the opposite
  corner fixed, the moving edges stopped at the area's edges and the minimum;
  `grabbed(…, corner)` holds the grab as an offset from that corner, fixed for
  the gesture; `cornerOf(r, corner)`. **The wrap:** `trayFit(r, buttons, area,
  corner, room?)` keeps the run as asked (between `traySize(1)` and
  `traySize(n)`, one line), and makes the depth exactly `trayDepth(lines)` for
  the lines `perLine(run)` wraps into — the arithmetic of the stylesheet's
  `flex-wrap`, so every button is shown and `#toolbar` is `overflow: hidden`.
  Lines that would not fit in `room` (default: the area on the side the depth
  grows) are capped and the run lengthened to hold the buttons in them.
  `dragStep(…, buttons?)` (was `content?`) fits a tray's resize, and when a
  chain stops the depth part of a line deep asks again for the tray that fits
  what it got (or stays put). `apply` fits every tray to its current count, so
  a tool defined into a shortened tray wraps. `traySize` is now "the size a
  tray wants for n buttons in one line" — the defaults and a turn. In
  `pushed`, the push direction along an axis is the way the rectangle grows
  (not the pointer's sign) and `pass` pulls back the leading edge with the
  trailing edge exact. Storage unchanged (`v2`). Unit: `test/panels.test.ts`
  (8 new, and the 2 000-step walk extended to random corners, minimums and the
  tray's depth); browser: `test/e2e/panels.e2e.ts` (5 new; the random-drag run
  takes all four grips). 840 unit tests, 319 e2e. *Known and deliberate:* a
  tray's depth is not the viewer's (a sideways drag of a column's corner moves
  nothing); a tray is never longer than one line; a moved one-line tray that
  gains a tool wraps it into a new line rather than growing; a grip's
  triangle takes the corner of whatever it covers, a sliver of the log's label
  included. *Spec:* [`docs/plans/panels-corners-wrap.md`](docs/plans/panels-corners-wrap.md).

- **The tool tray is one line, and the grips draw nothing** (`src/panels.ts`,
  `src/main.ts`, `index.html`). The owner (2026-10-29): *"you dont need those
  diag lines on every corner. also actually get rid of resizing altogether on
  the tool palette. its just a straight line that fits the number of tools it
  has in it, and can either be vert or horiz"*. **Grips:** the log and the
  command line keep `.pgrip[data-corner]` on all four corners, still the 12 px
  square clipped to its corner's triangle with its diagonal's cursor, and
  resize exactly as before — but with no background idle, hovered or held: the
  cursor is the affordance. **The tray:** `gripCorners(tray)` is `[]` for a
  tray and `CORNERS` otherwise, and the DOM half makes only those; `dragStep`
  returns a resize grab on a tray (one it is given a button count for)
  untouched. Its size is only ever `traySize(n, orient)` — one line, 28 px
  thick, `16 + 6 + 22n` long. Placement is the pure `arranged(order, stored,
  defaults, trays, area)` (what `apply` was): each panel's stored-or-default
  rectangle held inside, except that a tray keeps only its stored position
  and orientation and takes `traySize` of its current count, then
  `settled` — so a tool defined at the command line lengthens a moved tray by
  one button and pushes whatever that reaches, and a layout stored while the
  tray could wrap comes up one line. `minSizeOf(id, orient, tray)` is the
  minimums, a tray's one button (what is left of a tray clipped by a window
  shorter than it). `#toolbar` is a single flex line, `overflow: hidden` for
  that clip. Storage unchanged (`v2`; a tray's size is written and never
  read). Unit: `test/panels.test.ts` (4 new; the wrap's 6 deleted; the walk
  asserts the tray is `traySize` on every step and that its resize grabs move
  nothing); browser: `test/e2e/panels.e2e.ts` (4 new, the wrap's 4 deleted:
  the log's corners pixel for pixel against the grips hidden, hovered and
  held; no tray grips; a stored size ignored; a moved row lengthened by a
  tool, pushing the log). 850 unit tests. *Known and deliberate:* a grip is
  found by its cursor alone; a tray longer than the window is clipped, its
  last buttons out of reach; the grip's triangle still takes what it covers.
  *Spec:* [`docs/plans/tray-fixed-line.md`](docs/plans/tray-fixed-line.md).

- **Tool options: declared, visible, remembered** (`src/tools/options.ts`
  (new); `Tool.options` and `defineTool` in `src/tools/tool.ts`;
  `ToolEngine.arm`; `extrude`/`revolve`/`fillet`; `OptionsPanel`,
  `optionsSize`, `besideTray`, `Fitted`, `optionCommand`, `parseField`,
  `fieldText` and `arranged`'s `fitted` in `src/panels.ts`; the host,
  `optionMemory` and `syncToolbar` in `src/main.ts`; `tools()`, `help()`,
  `EnvHandles.optionMemory` in `src/replenv.ts`; `index.html`). The owner's
  direction, *"if the tool has options, there should also be some kind of
  e.g. pop-up menu that allows me to set them visually, or it happens in the
  terminal"*. **Declared:** `static options = { name: { default, unit?,
  label?, check? } }` — a number or `true`/`false`; `unit` `"length"` (shown
  as nothing), `"angle"` (radians, shown `rad`) or any text; checked for
  shape at `defineTool`. Extrude declares `depth` (10, not 0), revolve
  `angle` (2π, not 0, within a whole turn), fillet `radius` (10, > 0).
  **Armed:** `ToolEngine.arm` resolves before cancelling anything — typed,
  else remembered, else the default; an undeclared option, a wrong type or a
  `check` refusal is one line naming the options (`extrude has no option
  "dpth" — its options are { depth: 10 }`), the armed tool untouched. A tool
  that declares nothing gets what it was given, the very object. **Remembered:**
  `OptionMemory` over `localStorage` key `neocad.toolOptions.v1`, written on
  every arm that names a declared option, read leniently, every touch
  wrapped; held in memory too, so a throwing storage remembers for the page.
  **Listed:** `tools()` gives `extrude  { depth: 10 }`, plus `(default { … })`
  where a remembered value differs; `help()` under viewport and authoring.
  **The panel:** `.panel[data-panel="options"]`, hidden until a tool with
  declared options is armed (read off `engine.armed`, the registered name);
  its strip names the tool; a row is label, field (a checkbox for a flag) and
  unit, 22 px; the panel is `optionsSize(rows)`, no grips, placed last by
  `apply` (so it is what moves out of the way) at its stored position or
  `besideTray` — the tray's free side, from where the tray is shown. A field
  commits on Enter, blur, or a press anywhere else (capture phase, before the
  canvas has the press), typing `arm("tool", {option: value})` through
  `submit`; Escape restores and keeps the tool; non-numbers restore. **The
  toolbar's greyed state is removed** (`ToolbarHost.unavailable`, the
  disabled buttons, the reason in `buttonTitle`, the CSS); `toolUnavailable`
  stays for the menu and `step`. Unit: `test/tooloptions.test.ts` (13),
  `test/panels.test.ts` (5 new); browser: `test/e2e/tooloptions.e2e.ts` (10).
  884 unit tests, 340 e2e. *Known and deliberate:* remembered on arm, not
  on use; no command to forget; a field edit mid-gesture drops the gesture;
  angles in radians; a refused edit is red in the log, like any typed line.
  *Spec:* [`docs/plans/tool-options.md`](docs/plans/tool-options.md).
  *(Since `feature-dialog.md`: a field edit keeps a feature tool's picks —
  re-arming the armed tool retunes it.)*

- **Feature tools: pick, preview, confirm** (`src/tools/feature.ts`,
  `src/tools/selection.ts`, `src/featurepreview.ts` (all new); the extrude,
  revolve, fillet and sketch tools; `regionNaming` in `src/operations.ts`,
  `loopAround` in `src/loops.ts`; `Tool`'s optional hooks and
  `ToolContext.preselected`/`trial`/`perform`/`preview` in `src/tools/tool.ts`;
  `ToolEngine.selected`/`confirm`/`escape`/`dialog`/`trial` and `arm`'s retune;
  `OptionsPanel`'s ✓ ✗ row; `perform`, Enter and Escape in `src/main.ts`). The
  owner: *"just click on the region or select the loop and hit the tickbox or
  enter or something"*. **Pick:** a click inside a region toggles it into the
  selection (`RegionSelection`, kept by the point picked at, `RegionHit.at`,
  found again by `loopAround`), several allowed, drawn a shade stronger than
  the lit candidates; revolve then a line or frame arm as the axis (another
  replaces it; only axes every picked region can turn about are lit and
  taken); fillet two lines that share a corner, or a click on the point
  where exactly two lines end. **Preview:** the confirm's own steps run on a
  copy (`previewSteps`: `save` → `open` → a `Repl` over `neocadScope` of the
  copy → solve), the copy's new features' visible faces filled in their solid
  shade at 0.55 alpha, far to near, and its new entities stroked in the tools'
  green; asked again only when the picks, the values (the armed options with
  the field's mid-edit trial over them) or the model's shape change; a refused
  step is said once as guidance and turns ✓ off. **Confirm:** ✓ (the options
  panel's new row), Enter with the command line empty or the focus on no text
  field, Enter in a panel field (commits the field, then confirms), or a
  second click on the last pick. The steps — per region its plane where none
  orients it (`featurePlaneCommand`) and the shortest typed call naming it
  (`regionNaming`: a member only it has, then one narrowed by its frame, then
  the resolved profile) — are typed through `submit` inside one bracket the
  host holds open (`perform`), one undo step, the first refusal stopping the
  rest; each new feature is then reported (`e1  extrude of …`). The tool stays
  armed with nothing picked. **Cancel:** ✗ or Escape drops picks and preview
  (`Tool.clear`); with nothing picked Escape releases the tool. **Preselection:**
  with nothing armed, a release that never moved and picked no entity selects
  the region under it (shift: adds or drops; none there: clears) —
  `ToolEngine.selected`, drawn like a pick, handed to the next tool armed
  (`ToolContext.preselected`, `Tool.onArmed`) and then spent; sketch armed on
  one types its plane at once. Headless (no `perform`) a confirm makes the
  same operation calls directly (`runDirect`). Unit:
  `test/featuredialog.test.ts` (12) and the tool tests moved to confirm;
  browser: `test/e2e/featuredialog.e2e.ts` (11), and every tool e2e moved to
  the new flow (`confirmAndRelease`). *Known and deliberate* (TODO.md, Smaller
  things): a region through an unmarked crossing with every member shared is
  built by calling the operation, not typed; the preview copies the whole
  model; it is not depth-tested against built solids; preselection is regions
  only. *Spec:* [`docs/plans/feature-dialog.md`](docs/plans/feature-dialog.md).

- **A solid is opaque; view modes** (`src/viewmode.ts` (new); `inSight` and
  `visibleRuns` in `src/occlusion.ts`; an `occ` argument to `hitTest`,
  `findSnap`, `selectInBox` and `placeGlyphs`; `engine.occlusion`; the draw
  pass, `view()` and the menu's View row in `main.ts`, `replenv.ts`,
  `menu.ts`; the body tones and `SOLID_EDGE` in `faces.ts`; `clear()` on the
  face layer). The owner: *"when you extrude a solid, it should look like a
  solid"* / *"It should be opaque"*. **Shaded, the default: nothing behind a
  visible face is drawn or aimable** — edges and parts of edges, points and
  their names, glyphs (by anchor), frame markers (by origin); faces still
  never pick. `render` builds one `Occlusion` a frame, draws with it and hands
  it to the engine, so the pick, the hover, a drag, the snapper, box select
  and the glyphs answer from the same frame as the picture. **`view("hidden")`**
  is the hidden-edge look (behind dimmed, all aimable); **`view("wire")`** no
  faces; `view()` reports. The mode is viewer state — `localStorage`
  (`neocad.viewMode.v1`), never the journal, a file or the undo history — on
  the empty-canvas menu as a View row and in `help()`. **`view` was the camera
  object in the scope; the camera is `camera` now.** The body runs mid slate to
  light grey-blue over the whole headlight range; a solid's own edges are in
  `SOLID_EDGE` wherever faces are drawn; light marks get a casing in the
  background colour where faces are drawn; hidden ink mixes toward the faces'
  dark end. The empty-canvas hint also goes while a preview is on screen.
  Unit: `test/opaque.test.ts` (10, new), plus `faces.test.ts`,
  `occlusion.test.ts`, `menu.test.ts`, `repl.test.ts`; browser:
  `test/e2e/opaque.e2e.ts` (7, new); `hidden.e2e.ts` now runs in the hidden
  view. 897 unit tests, 347 e2e. *Known and deliberate:* `regionAt` (a click
  inside a loop) does not consult occlusion; the casing pass runs the edge
  sampling twice; a profile member that is a portion of a longer line keeps
  its sketch colour on a solid. *Spec:*
  [`docs/plans/opaque-solids.md`](docs/plans/opaque-solids.md).

- **The selection, groups, hide and show** (`src/groups.ts` (new); `GroupEntry`,
  `groups`, `hidden`, `expand`, `membersOf`, `addGroup`/`addMembers`/
  `removeMembers`/`deleteGroup` and the cascade's `leaveGroups` in
  `src/model.ts`; `Selection` and `SELECTION` in `src/tools/selection.ts`; the
  engine's `selection`, `composing`, `select`; `menu.ts`'s selection items,
  Select g1 and Show all; the Delete key, the highlight and the `selection`
  handle in `main.ts`; `sel`/`select`/`group`/`addTo`/`removeFrom`/`ungroup`/
  `members`/`groups`/`hide`/`show`, `ls()` and `help()` in `replenv.ts`; six
  ops in `persist.ts`). The owner: *"flat relational direct cad. there is no
  hierarchy … and entities can be grouped"*. **A click selects** with the
  command line empty (shift toggles, a box selects, shift-box adds, empty
  canvas or Escape clears), drawn in violet `#c46cff`; **with text in the line
  it inserts the name**, as it always did. Region preselection is the same
  selection. UI state: not journalled, saved or undone. **A group is a set**:
  owns nothing, overlaps, never nests (a group or feature named is flattened to
  its members then, and the log says so), never empty *(until the organiser
  package: an emptied group stays now — see below)*; a feature is a
  read-only group of what it made. Deleting a member journals a `removeFrom`
  per group before the primitive; an emptied group went and `del` returned it.
  The hover tag ends `· g1 g2`. **Hidden** (`hide`/`show`, groups and features
  expanded) is not drawn, picked, snapped to, boxed or glyphed, is still
  solved; a hidden feature's faces are not drawn; journalled, saved, undone.
  No format bump. Unit: `test/groups.test.ts` (15), `test/selection.test.ts`
  (10), and the engine and feature-dialog tests; browser:
  `test/e2e/groups.e2e.ts` (12), `test/e2e/selection.e2e.ts` (9), and the
  picking, box, drag, edge-drag, frames, glyphs, dimensions, opaque and
  feature-dialog e2e read the selection where they read the command line.
  *Known and deliberate* (TODO.md, Smaller things): hiding a solid's sketch
  hides the solid's base edges (they are the same lines); `hide("e1")`
  flattens at the call; a region bounded by anything hidden is not offered;
  `sel()` lists names, not regions; arming a tool spends the whole
  selection; a drag moves the grabbed entity, not the selection; the Delete
  key is never a focused text field's. Phase 2, rigid groups, is not started.
  *Spec:* [`docs/plans/groups.md`](docs/plans/groups.md).

- **A feature's frames share its own points** (`frameOver`, `sweptFrames`,
  `Expansion`/`EXPANSION`, `extrudeBody`, `revolveBody` and `rebuildFeature` in
  `src/operations.ts`; the frame-pair dedupe in `src/relations/revolution.ts`;
  `expansion` on both feature records in `src/model.ts`; `persist.ts`'s
  `VERSION` 10 and `translate`). The owner, on doubled labels on an extruded
  plate: *"i'm getting a lot of overlapping points. why is this happening?"* /
  *"of course it should."* **A lid frame, and each partial revolve's end
  frame, takes the twin of every point of the frame it copies that is a profile
  vertex** (by joined class, never by position), and makes a point of its own
  only for one that is not; the twins are made first now, then the frame. The
  depth holds each place once: an extrude passes only the frame's own points as
  pairs; the revolution relation keeps the frame pair (it is what marks the
  sketch frame's points a datum) and skips any point a corner pair holds. The
  owner's frameless plate with a triangular hole: 17 points with three pairs on
  one spot before, 14 and none after. **Regeneration** owns a shared point once,
  as a twin; keeps a lid point whose corner has left the profile, held as the
  frame's own; and hands a sketch-frame point that comes into the profile the
  lid point already over it. **Format version 10**: every `extrude` and partial
  `revolve` from a file of version ≤ 9 is given the expansion `9` by
  `translate`, which rebuilds its frames with their own points first, as that
  build did, and regenerates it the old way; the `9` stays in the entry on
  re-save. A new entry is the call as it always was. Unit:
  `test/lidframe.test.ts` (12, new); version pins in `app3d`, `dimensions`,
  `frames`; the old-file fixtures in `regen` and `regionfeatures` now built with
  the old expansion. Browser: `test/e2e/lidframe.e2e.ts` (3, new); version pins
  in `camera`, `planar`, `regen`. 923 unit tests, 361 e2e. *Known and
  deliberate:* a sketch-frame point on a corner's spot but not joined to it
  still gets its own lid point; a revolve about the sketch frame's own axis
  leaves its end frame's origin and y-ref on the sketch frame's; deleting a lid
  corner the lid frame stands on takes the lid frame with it (and what is drawn
  on it); a boss's lid frame on a face still floats (the face frame's points
  are the plate's, not the boss's). *Since format 11* an extrude makes no lid
  frame at all, which settles the two of those that were an extrude's (see
  **An extrude makes no lid frame** below); a revolve's end frames are as
  described here. *Spec:*
  [`docs/plans/lid-frame-shares-points.md`](docs/plans/lid-frame-shares-points.md).

- **Quiet geometry** (`src/quiet.ts` (new); `Face.edges` and `SOLID_EDGE_PX`
  in `src/faces.ts`; the edge line in both renderers in `src/facelayer.ts`;
  `Glyph.about` in `src/glyphs.ts`; `engine.armedUnder` and
  `engine.dragging`; the draw pass in `main.ts`; `ls()` and `members()` in
  `replenv.ts`). The owner: points *"disappear when they are the endpoint of
  a line or a corner (except when you hover over them)"*, lines *"when they
  form the edge of a solid"*. **Shaded only:** an end of a line or arc that is
  no centre is not drawn, dot or name, and a solid's whole profile members,
  twins and walls are not drawn as sketch geometry while it has faces on
  screen — until revealed: hovered (or lit by a hovered glyph), selected (the
  groups selection, drawn violet), the snap's target, under an armed tool's
  cursor, or dragged; a revealed line or arc brings its ends. **Hidden
  outranks revealed** (`entityDrawn`). Glyphs follow their anchors;
  dimensions always drawn. **Quiet is not hidden** — the pick, snap, box and
  drag are untouched, quiet glyphs included. **By geometric role only**: a
  lid's corner and a sketch's are one case (the spec's feature-made rule was
  dropped at the supervisor's direction). The face layer draws a fine
  `SOLID_EDGE` line, 1.2 px, along every face's edges — caps, wall sides at
  vertices, a sweep's rims and vertex circles, never a seam — as depth-tested
  quads, or by the painter's after each fill. `ls()` folds a feature's output
  into `    14 made — members("e1") lists them` (the groups package's
  `members`, counted exactly). Hidden and wire draw everything. Unit:
  `test/quiet.test.ts` (12, new), `faces.test.ts` (+5); browser:
  `test/e2e/quiet.e2e.ts` (10, new), a shaded-against-hidden test in
  `hidden.e2e.ts` (the golden now held in the hidden view, unchanged).
  965 unit tests, 395 e2e, after merging groups and the lid frame fix. *Known and deliberate:* no silhouette lines on curved
  walls, no line where two solids interpenetrate; a lid frame's own points
  (where the sketch frame stands off the profile) are drawn, ending nothing
  (since format 11 only an old file's extrude has a lid frame; a partial
  revolve's end frame can still have points of its own); frame markers stay,
  so their letters sit at a corner a frame stands on.
  *Spec:* [`docs/plans/quiet-geometry.md`](docs/plans/quiet-geometry.md).

- **An extrude makes no lid frame** (`Expansion`/`EXPANSION`, `extrudeBody`,
  `rebuildFeature` in `src/operations.ts`; `ExtrudeFeature.top` optional in
  `src/model.ts`; `MadePlane`/`FacePlane`/`facePlaneArgs` and `circleFrame` in
  `src/sketchface.ts`; `frameOnFace` in `src/replenv.ts`; `describeFeature` in
  `src/picking.ts`; `VERSION` 11 and `translate` in `src/persist.ts`). The
  owner's report again — *"i'm getting a lot of overlapping points. why is this
  happening?"* — in the case sharing could not fix: two rectangles extruded at
  once share the first one's sketch frame, so the second lid frame made three
  points of its own on the first lid's corners (19 points, three pairs, three
  frames; now 16, none, one). **A new extrude makes no frame**: a twin curve on
  the sketch frame names the sketch frame (a translation keeps an orientation),
  a twin of a curve on any other frame keeps it, and the depth holds corners,
  centres and radii only. The record's `top` is absent; `ls()` drops
  `, lid fN`. A stacked extrude on a lid is oriented by the sketch frame, which
  the lid is parallel to. **Sketch on a circle's lid** (a whole circle off its
  frame's plane, which every twin circle now is) types a plane made through the
  circle's own centre, its x-ref and y-ref new points on the rim along the
  frame's axes, each held `oncircle` — so the plane follows the top when the
  depth is `set` — seeded with every digit so no free radius gives way; only a
  circle whose frame has collapsed is refused. **A revolve is unchanged** (its
  end face is turned and needs its end frames): `EXPANSION` is per op,
  `{ extrude: 11, revolve: 10 }`. **Format 11**: every `extrude` from a file of
  version ≤ 10 without an expansion is given one by `translate` — `10` from a
  version-10 file, `9` from older — so its lid frame is made again under the
  names the file's later entries hold, and regenerated the old way; the mark is
  saved with it. Unit: `test/nolidframe.test.ts` (7, new), a made-plane test
  in `sketchface`, the lid-frame cases in `lidframe` now asking for expansion
  `10`, counts and twin planes in `extrude`, `regen`, `regionfeatures`,
  `quiet`, version pins in `app3d`, `dimensions`, `frames`. Browser:
  `test/e2e/nolidframe.e2e.ts` (3, new); `extrude`, `extrudeplane`,
  `lidframe`, `quiet`, `regen`, `sketchface` read without `top`; `hidden`'s two
  sketch-ink probes ask that the ink is drawn, not that it out-inks the solid
  edge under it (an anti-aliasing coin toss that flipped); version pins
  in `camera`, `planar`, `regen`, `lidframe`. 973 unit tests, 398 e2e. *Known
  and deliberate:* a plane made on a circle's top has two rim points of its
  own, drawn (they end no line) with their `oncircle` glyphs; deleting the
  cylinder takes the frame (its origin is the twin centre) and leaves those two
  points, as deleting any frame leaves its points. *Spec:*
  [`docs/plans/no-lid-frame.md`](docs/plans/no-lid-frame.md).
- **The hosted PWA, and a page that never scrolls or zooms** (`scripts/pwa.ts`,
  `scripts/pwa-shell.ts`, `scripts/pwa-sw.js`, `scripts/icons.ts`,
  `public/icons/`, `src/pagelock.ts` (all new); `scripts/singlefile.mjs` now
  exports `singleFile()`; `index.html`'s head and first rules;
  `.github/workflows/pages.yml`).
  - **The build.** `npm run build:pwa` writes `dist-pwa/` (gitignored):
    `index.html` (the single-file app in a full document with the PWA head),
    `manifest.webmanifest`, `sw.js`, `icons/`, `.nojekyll`. Every URL in it is
    relative. The target is `https://brothercreamy.github.io/zerocad/`, served
    from the public repository `BrotherCreamy/zerocad`. The workflow publishes
    the folder as the whole of the running repository's `gh-pages` branch.
    Nothing has been published from here.
  - **The worker** (hand-written, no dependency) precaches the shell under
    `neocad-<stamp>` and serves cache first. A navigation anywhere in scope is
    the app. It deletes only `neocad-` caches other than its own, because the
    origin's caches are shared by every site the account publishes. There is
    no `skipWaiting`, `clients.claim` or reload: a new version is the next
    start's. It is registered from the hosted build's head only, never from
    `index.html`.
  - **Every build** carries the viewport (`user-scalable=no`,
    `viewport-fit=cover`) and `format-detection`; `singlefile.mjs` copies each
    `<meta name>` from `index.html`. The page is fixed (`position: fixed;
    inset: 0; overflow: hidden; overscroll-behavior: none`), the app is
    `100dvh`, and the safe areas pad the header and inset `#viewwrap`, which
    keeps every panel clear. `touch-action` is `manipulation` on the page and
    `none` on `#cv`. Selection and the callout are off except on `#cmd`,
    `#log` and inputs. `lockPage(document)` cancels `gesture*` and
    multi-finger `touchmove`, non-passive.
  - **Tests.** `test/pwa.test.ts` (8): the manifest, the icons' sizes and
    corner alpha, the cache's name, the worker run against a stand-in scope,
    the head, `index.html`'s rules, and the page lock. `test/e2e/pwa.e2e.ts`
    (9): the sub-path, the manifest as an installer reads it, offline, a
    waiting update, controls for the touch drivers, no scroll or zoom on the
    dev server and the hosted build, the pinch with the viewport's limits
    stripped (with and without the lock), and the safe areas in portrait and
    landscape through CDP's inset override. 981 unit tests, 407 e2e.
  - *Known and deliberate:* only Chromium's emulation has been tried, never
    iOS Safari. On iOS, a new version waits until the app is closed from the
    switcher. The cache prefix must change with care when the app is renamed:
    delete both prefixes for one release. *Spec:*
    [`docs/plans/pwa-pages.md`](docs/plans/pwa-pages.md).

- **Construction geometry** (`construction?: true` on `LineEntity`,
  `CircleEntity`, `ArcEntity` and `isConstruction`/`setConstruction` in
  `src/model.ts`; `construction`, `checkMember`/`givenProfile`'s refusals and
  fillet's arc in `src/operations.ts`; `collect` in `src/loops.ts`; the op,
  `ls()` and `help()` in `src/replenv.ts`; the replay table in
  `src/persist.ts`; `CONSTRUCTION`/`CONSTRUCTION_PX`/`CONSTRUCTION_CASING_PX`
  and `strokeEdge`'s casing in `src/main.ts`; `describePick` in
  `src/picking.ts`; `constructionItems` in `src/menu.ts`; `DRAWING_OPTIONS` and
  `asArmed` in `src/tools/place.ts`, declared by line, rectangle, circle,
  circle3, arc and arc3). The owner: *"construction geometry should be a per
  entity flag"*; *"if it is a group based inherited thing, then geometry could
  be both construction geometry and not construction geometry
  simultaneously"*. **A flag on the entity** — never in a set, never a
  group's — that **forms no regions**: loops.ts leaves it out at the one door
  edges come in by, so it bounds, cuts and crosses nothing, and extrude,
  revolve, sketch on a face, the region lighting and `loops()` follow.
  Otherwise ordinary: constrained, solved, picked, snapped to, quiet, hovered,
  selected. `construction(...names)` / `construction(...names, false)`; groups
  and features expand at the call and the journal names the curves changed;
  points, frames and relations passed over; a no-op journals nothing; one undo
  step; no format bump. **A solid's outline member is refused** by name, and
  extrude/revolve refuse a construction member by name. **Drawn thin (0.9px)
  in a muted teal `#679b91`, never dashed**, with a hairline casing on faces.
  The hover tag says `construction`; `ls()` `(construction)`; the menu has
  *Construction* / *Not construction* for an entity or a selection's curves;
  the drawing tools' options panel has a `construction` checkbox. A fillet of
  two construction legs is construction. Unit: `test/construction.test.ts`
  (19, new), `menu.test.ts`; browser: `test/e2e/construction.e2e.ts` (7, new),
  `contextmenu.e2e.ts`, `tooloptions.e2e.ts`. 992 unit tests, 405 e2e.
  *Known and deliberate* (TODO.md, Smaller things): an outline member is
  refused (a hole's fills the hole, and clearing the flag adds none — see
  explicit regions, below); a regenerated twin is real; typed
  constructors take no flag; a tool's preview is not muted. *Spec:*
  [`docs/plans/construction.md`](docs/plans/construction.md).

- **The app under fingers** (`src/tools/gestures.ts` (new); the touch paths,
  `reach`, `contact`, `renderLift` and `onContextMenuWithdrawn` in
  `src/tools/engine.ts`; `TOUCH_REACH` and a `reach` argument in
  `src/picking.ts` and `src/snapping.ts`; `Metrics`/`FINE`/`COARSE`,
  `touchLayout`, `inCorner` and `ActionStrip` in `src/panels.ts`; the `.tray`
  rules, the actions panel and the `(pointer: coarse)` block in `index.html`;
  `coarse`, the strip, the tag above a finger and the keyboard rules in
  `src/main.ts`; the touch section of `help()`). The owner: *"it should work on
  a multi-touch device. Specifically I have an iPhone."* **One recogniser**,
  pure, with an injected clock, decides tap (8 px, 350 ms), drag, long-press
  (500 ms), long-press-drag, pinch, abandon (a second finger) and spent (a
  third), and the engine feeds each down the mouse's paths. A busy page is
  read by the events' own stamps: a tap's length is the lift's stamp less the
  landing's, and a held press whose move past the slop is stamped before the
  long-press is a drag (docs/plans/touch-harness.md). A tool's press is
  held until the finger moves or lifts, so a pinch never reaches it. A second
  finger mid-draw re-arms the tool. One finger on empty canvas orbits (pans in
  2D). A tap toggles once something is selected, and a finger's box adds. A
  finger down reveals as a hover does. **Every pick and snap radius ×2.75**
  under a finger (a point is a 44 pt target); glyphs keep their size. With a
  tool armed, the active point is drawn **56 px above the finger** on a disc,
  with the snap's mark and name and a leader. The canvas takes
  `touch-action: none`, and its `touchend` is cancelled so a long-press's
  compatibility click cannot press the menu it opened. **The action strip**
  (Undo, Redo, Delete, Cancel) is a tray, typing `undo()`, `redo()`,
  `del(...)` and `cancel()`, and disabled when idle. It is shown only under
  `(pointer: coarse)`. Under that query every target is **44 px** (tray
  buttons, strips, grips, option rows and ✓/✗, menu items), and the panels'
  arithmetic takes the same numbers from `COARSE`. The phone's defaults:
  portrait has the command line on top, the tray a column at the left, a
  one-line log, the strip bottom right and the options panel above it;
  landscape has the tray a row along the bottom with the strip and log top
  right. **The keyboard stays away**: no focus at start under a coarse
  pointer, a finger on the drawing blurs the field, and a tapped name does not
  refocus the line. Unit: `test/gestures.test.ts` (15), `test/touch.test.ts`
  (16), `test/touchlayout.test.ts` (7), all new. Browser:
  `test/e2e/touch.e2e.ts` (17, new) in iPhone 13 emulation with CDP
  multi-touch (`test/e2e/fingers.ts`, and `openApp({ device })` in the
  harness). 1011 unit tests, 415 e2e. **Not run on iOS Safari** (only Chromium
  here). *Known and deliberate:* the portrait tray is a column (eleven 44 px
  buttons do not fit 390 px); glyph boxes are not widened; the menu can sit
  under the finger on a narrow phone; landscape in Safari is cramped; sizes are
  chosen at load; a tool's press-commit survives a dropped gesture.
  *Spec:* [`docs/plans/touch.md`](docs/plans/touch.md).
- **A feature's region is explicit** (`featureRegion`, `refoundProfile`,
  `hole`, `unhole`, `holesGoing`, `within`, `profileOfLoops` in
  `src/operations.ts`; `insideLoop` in `src/loops.ts`; `hole`/`unhole`/`edit`
  in `src/replenv.ts`; the replay table in `src/persist.ts`; *Add as hole to
  e1* / *Remove hole from e1* / *Edit e1* in `src/menu.ts`; `src/tools/edit.ts`
  (new); `RegionSelection.toggleHole` in `src/tools/selection.ts`; the faces'
  `skip`). The owner: *"there should be some kind of relationship between the
  loops > region > extrude"*; *"I don't think coplanarity should be used as an
  automatic basis for deciding which entities to include in a region."* **The
  record is the membership**: a feature's loops are its outline and the holes
  confirmed. Regeneration (`regen`, a fillet) re-finds each recorded hole by
  its own members and adds none; a recorded hole whose loop has gone is
  filled, and `regen` says so. `hole("e1", "c1")` / `unhole("e1", "c1")` are
  operations, one undo step, journalled with what they rebuilt; refusals say
  what would work; revolve takes them the same way. **A hole's loop going —
  its circle deleted, a member made construction — fills the hole**; the solid
  stays. The creating click proposes every loop inside, and a click on a
  proposed hole takes it out (extrude and revolve). *Edit e1* (`edit("e1")`)
  opens the dialog on a feature: loops inside the outline toggle, the depth or
  angle in the panel, ✓ types `hole`/`unhole`/`set` as one action, the solid
  steps aside for the preview. No format bump; an older file opens to its own
  solids (tested with one written by the build before). Unit:
  `test/explicitregions.test.ts` (17, new); browser:
  `test/e2e/explicitregions.e2e.ts` (4, new). 1018 unit tests, 418 e2e. *Known and
  deliberate* (TODO.md, Smaller things): an island whose hole `regen` dropped
  becomes a hole by even-odd; a tie refuses; fillet's fill is unsaid; a hole's
  twin deleted still takes the record. *Spec:*
  [`docs/plans/explicit-regions.md`](docs/plans/explicit-regions.md).
- **STEP export** (`src/solids.ts`, `src/step.ts`, both new;
  docs/plans/step-export.md). `exportStep(name?, { curves? })` — the app
  menu's *Export STEP…* — writes the shown solids as an AP214 Part 21 file,
  `<name>.step`, `model/step`: the share sheet under a finger, a download
  elsewhere (`Files.exportFile`, `exportRoute`). Exact B-rep: `solids.ts`
  makes one body per feature (a second, `e1.2`, for an island in a hole) of
  planes, cylinders, cones, spheres, tori and surfaces of revolution bounded
  by lines and circles, every vertex and edge once and every edge in two
  faces once each way, a whole circle as two halves and a full revolve as
  two half turns, a hole turned whole as a void; and ZeroCAD's own volume
  (Green, Pappus) and extent from the profile. Hidden features are left out
  and named; construction never bounds a profile; `curves: true` adds the
  loose sketch curves as a wireframe. Reads a curve only through
  `curveplane.ts`/`arcgeom.ts` and a feature's plane through `featurePlane`.
  Journals nothing. Validated: fourteen parts read back by OpenCascade 8.0.1
  valid and closed, volumes and boxes matching, committed as fixtures with
  `validated.json`.
- **Files — open, save, share, drop, and an autosave** (`src/files.ts`,
  `src/filehost.ts` (both new); `replenv.ts`, `main.ts`, `pwa-shell.ts`).
  - **The document**: a name (*Untitled*, or the file's less
    `.zerocad.json`) and a dirty flag that is a comparison, not a flag —
    `DocumentState` keeps the undo snapshot (`save(model, false)`) from the
    last open, save or new, and dirty is "the snapshot now differs". The
    host's `document(): { name, dirty }` (`files.document()` in `main.ts`) is
    what the app menu's name line reads; it is not a command (in the scope
    `document` would read as the page's).
  - **Commands** `newFile()`, `openFile()`, `saveFile()`, `shareFile()`, in
    `replenv.ts` and `help()`, over host handles; none journals, none is in
    persist's replay table. **Ctrl+S / Ctrl+O** type the first two through
    `submit` (capture phase, default prevented, not mid-composition or on
    repeat; `fileChord`). `download()` is named for the document.
  - **Routes** (`saveRoute`, `shareRoute`, `openRoute`, pure): save goes to
    a held handle, else the save picker (whose handle is kept), else the
    share sheet under a finger where it takes the file, else a download;
    share goes to the sheet where `canShare` says yes, and a share refused
    for anything but a cancel (Chromium refuses `.json`) downloads; open is
    the picker where there is one, else an in-page file input
    (`.json,application/json`). A cancelled picker or sheet is said as
    cancelled, never as an error. New asks before discarding unsaved changes;
    Open asks after the file is chosen (a picker needs the press's transient
    activation, which a slow `confirm` would spend). Open and New are one
    undo step each, through `open`'s path (tool sources carried as text).
  - **Drop**: a file over the window shows `#drophint` (made by
    `filehost.ts`, no `index.html` change); dropped, it opens, its Chromium
    handle kept. The window takes every file drag, so a stray drop never
    navigates the browser away from the drawing. **Installed desktop app**:
    `file_handlers` (`.json`, `application/json`, action `./`) and a
    `launchQueue` consumer.
  - **Autosave** (`Autosave`, IndexedDB `neocad.autosave.v1`, one record):
    500 ms after the last change, at once when hidden (`visibilitychange`,
    `pagehide`) and after an open, save or new; restored before the first
    model is made. A stored drawing that will not open is kept and autosave
    *held* until `newFile()` or an open; storage that refuses is *off*, said
    once. `navigator.storage.persist()` when installed. The record keeps a
    Chromium handle, so Save after a restart writes back to the same file.
  - Tests: `test/files.test.ts` (14), `test/pwa.test.ts` (+1),
    `test/e2e/files.e2e.ts` (12 — desktop and iPhone 13, the platform played
    by stubbing or deleting the pickers and the share sheet before load). The
    harness gained `init` (an init script) and `forgetAutosave`; five suites
    that reload for a first start now call the latter. 1071 unit tests, 447
    e2e. *Known and deliberate*: one autosave slot per device (two windows,
    last change wins); undo across an open restores the drawing, not the
    name; a refused restore pauses autosave for the session; nothing tried
    on iOS itself (CHANGELOG lists what to try). *Spec:*
    [`docs/plans/files.md`](docs/plans/files.md).

- **The organiser and the open group** (`src/organiser.ts` (new): the
  sections, a row's menu and the ＋'s command as pure functions, and the
  pane's DOM; `opengroup`/`closegroup`/`rename` in `src/groups.ts`;
  `Model.openGroup`, `place`, `withoutOpenGroup`, `setOpenGroup`,
  `renameGroup`; `rebuildFeature`'s group rule in `operations.ts`; version
  12 in `persist.ts`; `Panels`' `hiddenAtFirst`). The owner: *"create a new
  group and "open" the group, which means any entities which get created
  become a part of that group."* **The pane**: *Groups* and *Features*, a row
  each — open marker, name, count, eye; a tap types `select`, the eye
  `hide`/`show`, the marker `opengroup`/`closegroup`, a right-click or a
  long-press the row's menu (*Rename…*, *Add selection*, *Remove selection*,
  *Open*/*Close*, *Ungroup*; *Edit e1*, *Delete*); the ＋ groups the selection
  or types `opengroup(group())`. A panel like the others, in the app menu's
  Panes untouched; bottom-right on a desktop; on a phone ~~hidden at first~~
  shown from the start (everything-fits.md), beside the strip and the log in
  portrait and under them down the right edge in landscape. **The open group**: every
  entity made while it is open joins it in the constructor that made it
  (`place`, the one door), so a replay reproduces it; relations do not join;
  journalled, saved, undone; `● g1` beside the status, `· g1 (open)` on the
  hover tag. **A regeneration's new pieces join the groups that held all the
  feature had made**, never the open group. **A group may be empty**;
  `rename(g, name)` renames one in place. **Format 12**: a version-11
  `removeFrom` that emptied a group gets the `ungroup` that build did
  silently. Unit: `test/organiser.test.ts` (15); browser:
  `test/e2e/organiser.e2e.ts` (10, desktop and iPhone 13 both ways).
  1109 unit tests, 473 e2e. *Known and deliberate* (TODO.md, Smaller things): a
  group holding most of a solid gets no regenerated piece; rows are flat and
  in creation order; `● g1` lies over a landscape phone's command strip.
  *Spec:* [`docs/plans/organiser.md`](docs/plans/organiser.md).

## What's next

The working list lives in [`TODO.md`](TODO.md), so it has one home rather
than drifting between two. In short: saving user-authored tools, `del` of
several names at once, edge dragging, a way for a tool to say something to
the user that is neither a thrown error nor a console line, and the remaining
interaction ideas to carry over from `cellwork`.

several names at once, a 3-point circle tool (now a trivial composition),
and the remaining interaction ideas to carry over from `cellwork`.

## Incident note (disk space)

Early in this session `brew install rustup-init` (the old formula name,
since renamed) triggered Homebrew to compile Rust, LLVM, cmake, and
Python **from source** — this filled the disk to 20MB free on a 92GB
volume and briefly broke even basic shell commands. Recovered by
clearing `~/Library/Caches/vscode-cpptools` (7.2GB, VS Code's C++
IntelliSense cache — safe, fully regenerable) and `brew cleanup` (~1GB).
Disk is healthy now (8GB+ free). Lesson applied: Rust was then installed
via the official `rustup.rs` script instead, which downloads prebuilt
binaries rather than compiling — fast, and does not repeat the problem.
If disk space gets tight again, `~/Library/Caches/*` is generally safe
to prune selectively (regenerable app caches), `~/Downloads` and
anything under a project's own working files are not mine to touch.

## Repo

Separate repo from `cellwork` (sibling directory), per instruction —
this is meant to grow into the general-purpose kernel `cellwork` was a
single-file prototype of, not a subdirectory of it.
