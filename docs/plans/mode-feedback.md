# Plan: mode feedback — the app says what it is doing, where, and what comes next

**Status: queued** (2026-11-05), after `sketch-shapes.md` and
`sketch-relations.md` land, in parallel with `workbenches.md` (it touches the
status, the drawing and the panels; workbenches touches the registries).
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
