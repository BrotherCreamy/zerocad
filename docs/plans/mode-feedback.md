# Plan: mode feedback — the app says what it is doing, where, and what comes next

**Status: built** (2026-11-05), on `claude/mode-feedback`, in parallel with
`workbenches.md`. See *As built* at the end for every deviation, each
vetoable.
The owner: *"at the moment, it is not obvious how the UI works. like when
creating a sketch or a face or something - in active face mode or whatever,
it isnt obvious to me that is whats happening. needs clearer visual/contextual
feedback to the user."*

## What is true today

A sketch is a plane (`workplane("a.b.c")` sets `Model.workPlane`; see
`workplane.ts` and the owner's question answered in CONVERSATION_LOG: *"just
an active plane constraint"*). Nothing draws that plane. The camera turns
square to it when it is set, and that is the only sign; turn the view and
there is no trace of which face is being sketched on, or that one is. The
status line (`statusline.ts`) carries the verdict and one-line guidance
(*"extrude: this runs into e1 — choose Cut"*), the options panel is titled
with the armed tool, and a face lights under the sketch tool while it is
armed. There is no "Done" for a sketch plane, no sign of which stage a
gesture is in, and nothing that distinguishes "drawing on the ground" from
"drawing on e1's top".

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` ("The chrome floats", "In 3D a
pixel is a ray", "Constraints are drawn"), `sketch-on-face.md`,
`frameless-curves.md`, `quiet-geometry.md`, `tooltips-rgb-frames.md`,
`chrome-logo-scale.md`, `everything-fits.md`, `no-refusals.md` (guidance
instead of refusal), `src/workplane.ts`, `src/statusline.ts`, `src/draw.ts`
or wherever the drawing pass lives, `src/tools/engine.ts` (hover, guidance,
the armed tool), `src/tools/sketch.ts`, `extrude.ts`, `feature.ts`,
`src/panels.ts`, `src/main.ts`, `index.html`, and the chrome, sketchface,
touch and fits tests.

## Design

- **The active plane is drawn.** When a work plane is set: the face it was
  taken from is tinted in a translucent accent (the sketch tool's green,
  lighter), its outline in the accent ink, in every view and from behind
  (dimmed, as hidden edges are); a frame's plane or the ground plane as a
  bounded patch with a faint grid, sized to the drawing, that follows the
  zoom. Off when no plane is set (drawing on the ground is not a mode, and
  must not look like one — the owner's "just put the circle right there").
- **The mode chip**, beside the status line, structured, always the same
  three parts:
  `on e1's top · circle · drag the radius`
  — *where* (the plane: a face named by its feature and side, a frame by
  name, or nothing), *what* (the armed tool, or Select), *next* (the
  gesture's next step, from the tool: "press at the centre", "drag the
  radius", "tap the third point", "✓ to extrude"). Each part is a tap
  target: the plane part opens a small menu (**Done** — end the sketch
  plane, `workplane(null)`, typed; **Look at** — square-on; **Change…** —
  arm the sketch tool); the tool part opens the options panel; the next
  part is a hint only. On a phone the chip wraps under the logo, as the
  status does; it never covers a pane (`everything-fits.md`).
- **The stage is drawn on the canvas too**: the point about to be placed
  is a ghost at the cursor or finger (the lifted mark the touch package
  made, for every tool, in the accent); the entities a gesture has placed
  so far are in the accent until the gesture ends; a tool waiting for a
  pick lights what it can take (the extrude and sketch tools do; every
  picking tool should, through one engine seam).
- **What is in the plane is in focus.** With a plane set, entities held on
  it (and the solid it belongs to) are drawn in full ink; everything else
  one step dimmed (a new ink in the quiet-geometry family), so the sketch
  reads as a sketch. Vetoable; the dimming must not change picking.
- **Done.** `workplane(null)` ends the plane: the tint goes, the chip's
  first part empties, the camera stays. The sketch tool's face-lighting
  stays the way to start one. A phone gets the same chip; the Done is one
  tap.
- **Every guidance line goes through the chip's third part**, the status
  line keeping the verdict and the one-off notes (*"cut changed nothing"*),
  so the two never fight for the same text. `no-refusals.md`'s muted
  guidance is unchanged in wording, moved in place.
- Journalled: `workplane(null)` as a typed call. Format unchanged.

## Tests

Unit: the chip's three parts for each state (no plane; a face; a frame; a
tool mid-gesture); each tool's `next` text at each stage; `workplane(null)`
journals and replays; the dimmed-ink rule chooses by the plane relation.
E2E (mouse and iPhone 13, portrait and landscape): sketch on a face and see
the tint and the chip; orbit and still see the tint; Done clears both; the
ghost point under the finger; the lit picks under extrude; the chip never
over a pane on any device in the table. LOOK at each picture — this package
is about what is seen.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE ("A sketch is a plane,
and the plane is drawn"); the register (the chip's three parts; the tint;
the focus dimming; Done) as vetoable; STATUS; README's first paragraphs;
`help()`; the spec marked built with the deviations.

## As built (2026-11-05)

Branch `claude/mode-feedback`. By file:

- `src/activeplane.ts` (new, pure) holds `activePlane`, which finds the
  plane, its face, its name and its tint outlines, plus `planePatch`,
  `focusOf`, `outOfFocusInk` and `sideName`.
- `src/modechip.ts` (new) holds `chipParts`, `chipText`, `guideText`,
  `doneCommand`, `planeMenu`, and the `ModeChip` DOM class with its `fit`.
- `src/tools/tool.ts` gains the optional hooks `Tool.next(hand)`,
  `Tool.takes()` and `Tool.placed()`, plus `Hand`, `press` and `engineNext`.
- `src/tools/engine.ts` adds `engine.next()`, `takes()`, `placed()`,
  `pointing` (the hand), `cursorAt` and `renderGhost`.
- Every built-in tool gets a `next`. The `FeatureTool` base supplies
  `✓ to <verb>` and `picking`. The fillet tool gets `takes`, the line tool
  `placed`, and `TwoPoint` gets `step` and `twoPointNext`.
- `src/main.ts` draws the plane, applies the focus inks and the stage inks,
  places and fits the chip, routes guidance to the chip, and handles the
  options flash.
- `index.html` adds `#mode`, its styles, and its 44 px touch boxes.
- `src/replenv.ts`: `help()`.
- Tests: `test/modefeedback.test.ts` (25), `test/e2e/modefeedback.e2e.ts`
  (10), one device-table test in `test/e2e/fits.e2e.ts`, and
  `test/e2e/firstrun.e2e.ts`, which now reads guidance from the chip.
- Pictures: docs/images/135–147.

**The chip's three parts, for each state** (unit-tested, and read off
`#mode`'s `data-where`, `data-what` and `data-next` in the e2e tests):

| State | where | what | next |
|---|---|---|---|
| no plane, nothing armed | — (not shown) | `select` | `click a thing, or drag to box` (finger: `tap a thing, or hold and drag to box`) |
| the Hand | as set | `hand` | `drag anywhere to pan` |
| sketching on a lid | `on e1's top` + **Done** | the tool | the tool's step |
| on a base / wall / revolve cap | `on e1's bottom` / `on e1's side` / `on e2's start`, `on e2's end` | | |
| on a plain loop (no solid) | `on loop l1,l2,l3…` | | |
| on a round face | `on e1's top` (matched by its rim) | | |
| on a frame (the default) | `on f1` | | |
| circle, mid-drag | | `circle` | `drag the radius` |
| circle, auto, two clicks in | | `circle` | `tap the third point` |
| extrude with a region picked | | `extrude` | `✓ to extrude` |
| a miss | | | the guidance, italic, until the step changes or 5 s pass |

Each tool's words are in its `next`: rectangle, line, point, polygon, slot,
ellipse, circle (by method), arc (by method and stage), fillet, dimension,
constrain, extrude, revolve, sketch, and the edit dialogs. All are
unit-tested at each stage.

**How the plane is drawn, and from behind.**

- A face is tinted `rgba(143, 224, 168, 0.3)`, the tools' green made lighter,
  and outlined 1.8 px in the green `#55c07a`. It is drawn on the drawing
  canvas after the faces and before the entities, in every view mode.
- Where the face faces away, or the middle of its outline is behind a solid
  face (occlusion.ts), the tint drops to alpha 0.08. The outline is drawn run
  by run: where a face is in front of it, it is in `hiddenInk(green)`, as a
  hidden edge is. The lid seen from below is in docs/images/137.
- A frame made the work plane is a patch with tint alpha 0.06, a grid at alpha 0.16, and
  its edge at half the green. It is sized to the points held on it, a step
  past them and at least three steps from the frame's origin, and its step is
  the first 1·2·5×10ⁿ at least 32 px on screen.

**Done** types `workplane(null)` through `submit`. It is logged, journalled as
`setWorkPlane(null)`, replayed by open, and one undo brings the plane back.
The tint goes, the chip's first part empties, and the camera stays
(e2e-asserted, view equal).

**The focus rule** is `focusOf`, which chooses by relation. These are in focus:

- a point held by `onPlane(p, ref)`, and the plane's own points;
- a line whose two ends are in focus;
- a curve whose centre is, or which a `par(c, ref)` or `par(c, "f.z")`
  holds to the plane;
- the frame the plane is;
- for a face, everything its feature `owns` and its profile.

Everything else is drawn in `outOfFocusInk`: its colour taken 55 % of the way
to the canvas's ground (`#0a0e13`), its hue kept. Picking is unchanged
(e2e: a dimmed line is still picked).

### Deviations, each a decision, vetoable

- **What is drawn, and focused on, is the work plane** (`workplane(…)`,
  which sketch on face sets), **not a default frame on its own.** The spec
  says a frame's plane is drawn as a patch. That holds for a frame made the
  work plane (`workplane("f1")`, picture 147). The default frame alone is
  named in the chip with its Done, but not tinted, patched or focused on.
  Two reasons. It is already drawn heavier (ARCHITECTURE's frame marker).
  And a drawing typed under it with `pt()` is held by no relation, so the
  focus rule would dim all of it: the first full e2e run showed that in
  eighteen pixel tests whose suites set a default frame, which is what a
  user typing `plane()` and a sketch would see.
- **Done is a button of its own beside the plane's name**, as well as the
  plane menu's third item. The spec puts it in the menu and also asks for
  "one tap" on a phone; a menu item is two.
- **Done types `setDefaultFrame(null)` when the plane is the default frame's**,
  not `workplane(null)`, which cannot end it: the default frame's plane is
  the sketch plane whenever no work plane is set. `setDefaultFrame(null)`
  also clears a work plane, so one tap ends the mode either way.
- **The tool's part opens its options panel by showing it**, even if the
  viewer hid it from the app menu's Panes (`setShown`), and rings it in the
  green for a second (`.flash`). For a tool with no options panel (Select,
  the Hand, sketch, point) the part is a disabled button.
- **The ghost of the next point is the mouse's**: a translucent green dot
  with a ring, at the cursor. It shows only for tools that place points
  (`snaps`) and only while nothing is snapped, since the snap marker is the
  ghost then. Under a finger the touch package's lifted mark already is the
  ghost, in the same green, for every armed tool, and is unchanged.
- **"The entities a gesture has placed so far"** covers only the line tool's
  chain, the one gesture that commits entities before it ends
  (`Tool.placed`). Every other tool's gesture is a preview until it commits,
  and its preview colours are unchanged.
- **The lit-picks seam is `Tool.takes()`, used by the fillet tool** (its
  corners, then the lines that share a corner with the first pick). Extrude,
  sketch and revolve keep lighting their regions and axes in their own
  `render`, as before; moving them onto the seam would change nothing on
  screen. The dimension and constrain tools take any entity, and light
  nothing: everything lit says nothing.
- **Focus dims entities only**, not other solids' faces, glyphs, dimension
  labels or frame triads. A solid's dark edge ink (`SOLID_EDGE`) is never
  dimmed: the face layer draws those edges anyway. "The solid it belongs to"
  is the matched feature's own entities and profile. Another feature in the
  same kernel body is out of focus.
- **Chosen by relation has a visible consequence**: points typed with `pt()`
  while a frame is the default are not held on it (the command does not add
  `onPlane`), so they are drawn dimmed under that frame's plane. Points the
  tools place on a chosen plane are held, and in focus.
- **A face is matched against its feature's own faces** (`featureFaces`),
  so a hole a later feature cut through it (a kernel boolean) is tinted
  over. With no feature face, the plain loop is tinted. With no loop, the
  plane is a patch named by its reference. An ellipse's plane is always a
  patch.
- **From behind** is decided for the tint as a whole (the face faces away,
  or the middle of its outline is hidden), and run by run for the outline.
- **Guidance leaves the chip once the tool's next step changes** (or the
  tool), as well as after 5 s or once something is made. Without this, a
  miss's sentence stood over the region picked straight after it; the e2e
  test found it.
- **The chip says guidance without the `tool: ` prefix**, since the chip's
  second part names the tool. The log keeps the whole line.
- **The verdict is never cut for the chip** (`ModeChip.fit`). On an upright
  phone the chip's two lines pushed `SOLVED 8 free` past the corner's room,
  which clips it (found by looking at the screenshot). While the verdict,
  the diagnosis or a note is showing and would be cut, the chip's next step
  is hidden, then its tool name. Where and Done stay. The whole chip comes
  back when the verdict fades. So, for the 3 s after a solve on a phone held
  upright, a drag's stage is shown by the lifted mark alone.
- **On a phone, the plane's part is stacked over the tool's.** Wrapped onto
  two lines, the tool name's 44 px touch box on the line below took Done's
  tap on a landscape phone (found by the phone e2e test).
- **The chip is always shown**, even with no plane and nothing armed:
  `select · click a thing, or drag to box`. It is first in the corner, before
  the verdict.
- **The kernel's notes stay in the status's note** (`solid: …`, e.g. a cut
  that removed nothing), as the spec's "one-off notes". Only a tool's
  guidance moves to the chip.

### Left in place deliberately

- The status's `#stepnote.guide` class stays, now used only by the kernel's
  notes.
- The line tool's "Esc ends the chain" is honest but incomplete: Escape also
  puts the line tool down, as it always did.
- **Not tried on an iPhone**: Chromium's iPhone 13 emulation only, like
  every phone test here.
