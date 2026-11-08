# Plan: solid tools a first-time user can use — a flip, a Cut you can find, and end conditions

**Status: built** (2026-11-08), branch `claude/solid-tools-intuitive`, PR
against `claude/resume-tasks-o7q02e` — except Up to face, a follow-up (see
*As built*). The owner: *"Flip button."* and *"I'm still
not clear on how to use the extrude cut tool. It doesn't make sense to me.
Make it more intuitive, along with the other solid tools."*

## What is true today (read it, then check it in a browser)

- **Direction is the sign of the depth.** There is no flip control: you type
  `-20`, or Set value… on the depth dimension.
- **Cut is not a tool.** It is a mode on the extrude: `extrude("c1", -10, {
  mode: "cut" })`, or the dialog's mode row (New Add Cut ∩). The row shows
  what it will do when left alone, and offers Cut only when the solid runs
  into a body (`src/tools/feature.ts` ~250). So to cut a hole you must:
  1. know the mode row exists;
  2. pick a depth whose sign goes *into* the material;
  3. pick Cut.
- **There are no end conditions.** It is blind only: no Through all, no Up to
  face, and no Symmetric (mid-plane).
- **Depth is changed only by typing.** There is no handle to drag.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md` (features, bodies, the solid kernel),
`docs/plans/3d-phase4-extrude.md`, `feature-dialog.md`, `tool-options.md`,
`solids-kernel.md`, `solid-fillets.md`, `src/tools/extrude.ts`, `feature.ts`,
`revolve.ts`, `fillet.ts`, `bevel.ts`, `blend.ts`, `options.ts`,
`src/featurepreview.ts`, `src/relations/extrusion.ts` and `revolution.ts`,
`src/modules/solids.ts`, and the extrude, revolve and solids e2e files.

## First: walk it as the owner would, and write down what confused you

Before changing anything, use each solid tool **as a first-time user, by
finger on an iPhone 13 and by mouse**:
- extrude;
- cut a hole;
- revolve;
- fillet and chamfer a solid edge;
- edit a feature afterwards.

Take a picture at every step and look at it. Write each place you had to know
something the screen did not tell you into the spec's *Walkthrough* section.
That list is what the rest of this plan must remove. Add to it; don't stop at
the items below.

## Walkthrough (2026-11-08, before any change)

Walked on an emulated iPhone 13 by finger (Chromium; `test/e2e/` harness,
the toolbar's buttons tapped, the options panel's fields and buttons tapped)
and checked by mouse where the phone and the desk differ. Every step was
pictured and looked at; four of the pictures are kept as 300–303. Each line
is a place the screen did not tell me something I had to know.

**Extrude**
- W1. Armed and tapped, a region seen square on — the default for a fresh
  rectangle, and what *sketch on a face* turns the view to — previews as a
  flat fill (300). Nothing says which way the solid goes or how far; you must
  orbit to find out, and on a phone that is a gesture nobody has told you.
- W2. The direction is the sign of a number. To flip it you raise the
  keyboard, find the minus key and type `-10`. There is no flip.
- W3. The mode row reads `New Add Cut ∩`; `∩` is a symbol, not a word.

**Cut a hole** (a circle on the lid of a 10-deep plate)
- W4. Nothing on the toolbar says Cut. Cut is the third button of a row in
  the extrude panel, which you only see once Extrude is armed.
- W5. Pressing Cut with the default depth (+10, *out* of the face) previews a
  red solid standing on the lid, in the air (301); ✓ is lit and the chip says
  "✓ to extrude"; ✓ builds `extrude("c1", 10, {"mode":"cut"})`, a feature that
  removes nothing, and only then does the log say "e2 cuts nothing from e1 —
  it does not reach it".
- W6. The hint "this runs into e1 — choose Cut to take it away" appears only
  after you have already typed the minus sign, and it stays in the chip after
  you have pressed Cut.
- W7. A hole right through needs you to know the plate is 10 deep and type
  at least that: blind is the only end condition.
- W8. The chip says "✓ to extrude" whether the extrude adds or cuts.

**Revolve** (a rectangle beside the origin's y axis)
- W9. **Bug: the origin's own axes cannot be picked.** With the profile
  tapped, nothing is lit (the origin's arms are not offered) and a tap on the
  origin's y arm says "origin.y is not in its plane, or crosses it — click a
  lit one" (302) — though `revolve("l1", "origin.y")` typed works. The tool
  asked only the frames that are entities, and the origin is not one. So a
  revolve about the obvious axis needed a line drawn first.
- W10. The angle is in radians: "6.283185 rad". A half turn is 3.14159 typed.
  The dimension it leaves reads degrees.
- W11. No flip for the sweep's direction, as W2.

**Fillet and chamfer a solid edge**
- W12. The solid's fillet and chamfer are the 8th and 9th of nine unlabelled
  icons in the modify flyout, and their two glyphs are near twins of each
  other and of the extrude's box. The tool is called "round" on the panel and
  in `arm`, "fillet" in the chip ("✓ to fillet").
- W13. A chamfer tapped on an edge that meets the fillet took three edges (the
  tangent chain, `tangent` ticked by default) and the kernel refused in its own
  words: "the kernel could not chamfer those 3 edges at setback 2 — … (chamfer
  failed (status 1001))" (303). The reason and the way out (untick tangent, or
  add the edge to the fillet) are not said.
- W14. The radius label (R2) can be dragged, but nothing says so until you
  read the chip.

**Edit a feature afterwards**
- W15. A long press on the plate's front face opened a menu for `r1 par l1 l3`
  — a constraint whose glyph is quiet (not drawn) but still within a finger's
  reach — with Delete, Undo and Redo; no Edit e1. Edit is reached from a press
  well inside a face, or the organiser.
- W16. The edit dialog has the depth field but no flip and no end condition.

What this plan removes: W1 (the depth handle's arrow shows the way, and the
preview of a cut is drawn inside the body), W2/W11 (Flip), W4–W8 (a Cut
tool, into the material by default, saying before ✓ when it reaches
nothing), W7 (Through all), W9 (fixed), W16 (Flip and the end row in the
dialog). What it leaves, written into TODO with a proposal: W3, W10, W12–W15.

## Design

1. **A flip control in the options panel** of extrude, cut and revolve
   (revolve: the sweep's direction).
   - It is one button, `⇅` or the house icon set's equivalent, with a tooltip
     of "Flip direction".
   - It negates the depth (angle), the preview follows at once, and the typed
     line is the negated call.
   - It is also offered in the feature dialog (`edit("e1")`), and as a "Flip
     direction" menu item on the depth dimension and on a feature's face.
   - Keyboard: a key the tool reads, written into the help, if one is free.
2. **Cut is a tool of its own**, beside Extrude in the toolbar (the solids
   group, `TOOL_GROUPS`), as SolidWorks' Extruded Cut and Onshape's Remove
   are.
   - Armed, it lights regions as extrude does, and its preview is the
     **volume to be removed**, drawn in the cut ink (red, translucent) inside
     the body.
   - **The direction defaults into the material**: from the region's plane,
     whichever side has the body. A region on a solid's face cuts down into
     it, with no minus sign to know about. Flip still flips.
   - What it types is the existing call, `extrude(…, { mode: "cut", into })`,
     so files, replay and undo are unchanged.
   - Revolve gets the same pair (revolve, revolve cut) if the walkthrough
     shows it needs one. Say what you chose.
   - The mode row in the dialog stays; it is the expert's way.
   - A cut that touches no body says so before ✓ (muted guidance, not a
     refusal), in words: "this cut doesn't reach any solid — flip it, or make
     it deeper".
3. **End conditions** on extrude and cut: **Blind** (today), **Through all**,
   **Up to face** (click a face; the depth follows that face if it later
   moves), and **Symmetric** (half each side).
   - They are an option row in the panel and the dialog, and part of the typed
     call, as `{ end: "through" | "symmetric" | { upTo: face } }`.
   - Through all and Up to face must survive regeneration. Up to face is
     relational: a relation between the lid and that face's plane, not a
     number captured once. If a face reference has no stable name to journal
     today, build what is needed, or ship Up to face as a follow-up and say
     why.
   - Each condition journals and replays, and is covered by a save/open test.
4. **A depth handle**: an arrow on the preview's lid, which a finger or mouse
   drags to set the depth (and through zero to flip). It snaps to round
   values as dimensions round, and the number in the panel follows.
   Onshape's manipulator is the model.
5. **The other solid tools**: fix what the walkthrough found for revolve
   (axis picking, angle, flip), fillet and chamfer on solids (edge picking by
   finger, the radius and distance, the preview), and feature editing. Each
   fix goes in a tested, pictured commit. Leave a large redesign as a written
   proposal in TODO rather than half-building it.
6. **Help and words**: `help()`'s solids text, the tooltips, and the status
   line's guidance say what the tool does in words a SolidWorks user would
   recognise (Extrude, Cut, Through all, Flip).

## Tests

- **Unit**:
  - Flip negates and round-trips.
  - Cut's default direction goes into the body, for a region on a lid, a
    region on the ground under a body, and a region beside a body.
  - Each end condition builds the right solid and survives save/open and
    regeneration (Up to face follows a moved face; Through all follows a
    deeper body).
  - The typed lines replay.
- **E2E, mouse and iPhone 13, by finger**:
  - Extrude a rectangle, then Flip: the preview and the result go the other
    way.
  - Draw a circle on the lid, arm Cut, ✓: a hole, with no minus sign typed.
  - Through all on a stepped body.
  - Drag the depth handle.
  - Revolve, then flip it.
  - LOOK at every picture, before and after.
- Add pictures to `docs/images/` with the next free numbers.

## Docs

- CHANGELOG at the top, quoting the owner.
- STATUS.
- The TODO register, with the decisions vetoable:
  - the cut's default direction;
  - the handle's snapping;
  - the key;
  - revolve cut, yes or no.
- `help()`, and the spec marked built with its *Walkthrough* and deviations.
- ARCHITECTURE if end conditions change what a feature is.

## As built (2026-11-08)

The walkthrough came first (above, W1–W16, pictures 300–303); then, each in
its own tested commit:

- **W9, a bug**: the revolve tool asked only the frames that are entities,
  and the origin is none — its arms are offered and taken now
  (`revolveAxes`), the walkthrough's case a unit test that failed before.
- **Flip** — an option may declare `flip: true` (tools/options.ts), and the
  panel draws ⇅ after its field ("Flip direction"), typing the value
  negated: `arm("extrude", {depth: -10})`. On the extrude's and cut's depth,
  the revolve's angle, and both edit dialogs'. The menu has **Flip
  direction** on an extrude's depth dimension and a partial revolve's angle
  (beside Set value…) and on any piece of a solid (beside Edit e1), running
  `set("d1.value", -10)`.
- **Cut** (`CutTool`, tools/extrude.ts) on the extrude's button, between
  Extrude and Surface. Its depth is how far into the material; the way is
  `materialWay` (modes.ts) on the profile the extrude would take. The
  preview is the extrude's, which draws a cut's solid in the cut's red over
  the body; the chip says "✓ to cut"; a cut that reaches nothing says so
  before ✓. It types `extrude("c1", -10, {"mode":"cut"})`.
- **End conditions**: `ExtrudeFeature.extent` ("through" | "symmetric"),
  the call's `{ end }`, `setEnd("e2", end)`; the depth dimension holds the
  lid at `lidReach` (model.ts), the solids layer's `throughReach` for through
  all (solids.ts); `extrudeSpan` for the kernel, the B-rep and insideness;
  faces.ts mirrors a symmetric base. Saved, opened, regenerated and set,
  each tested; the kernel's volumes checked.
- **The depth handle**: an arrow off the previewed lid, its depth on a
  label, dragged along its own line in round steps and through zero; ⊙ or
  ⊗ when the lid is seen square on (W1). None for through all.
- **Words**: help()'s solids text (Cut, Flip direction, the handle, Blind,
  Through all, Symmetric, setEnd), the tools' summaries, "through all" on a
  through depth's label, "✓ to cut".
- **On a face the menu's face items come first** — found by looking at the
  iPhone picture (the items were there, below a screenful of tools).

### Deviations

- **Up to face is not built**: a follow-up in TODO with a proposal. The
  relational half is the same shape as through all (a reach read live from
  a plane), and a face of entities already is a plane reference; what is
  missing is the tool's second pick stage, and a name for a kernel-only face.
- **Revolve cut: no.** The walkthrough did not show a need (TODO register).
- **No key for Flip**: none is free (TODO register).
- **The panel's number follows the handle when it is let go**, not during the
  drag; during it the number is on the handle's label.
- **W3, W10, W12–W15 are left as written proposals** in TODO, not
  half-built: the mode row's `∩`, radians in the angle field, the solid
  fillet's and chamfer's glyphs, names and refusal, and Edit e1 behind a
  quiet glyph under a finger.
- **A symmetric extrude's far cap has no entities** (drawn and built only).

