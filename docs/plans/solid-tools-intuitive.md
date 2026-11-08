# Plan: solid tools a first-time user can use — a flip, a Cut you can find, and end conditions

**Status: queued** (2026-11-08). The owner: *"Flip button."* and *"I'm still
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
