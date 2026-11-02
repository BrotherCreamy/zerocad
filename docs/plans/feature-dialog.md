# Plan: feature tools pick, preview, and confirm — like every other CAD tool

**Status: queued** (2026-11-02). The owner, verbatim:

> *also, extrude and other tools should work like they do in other cad
> software. just click on the region or select the loop and hit the tickbox
> or enter or something*

Today extrude commits on the first click inside a region, at whatever depth
was armed; revolve commits on the axis click; fillet commits on the second
line. There is no preview of the result and no moment to change your mind.
Onshape's flow is **pick → preview → confirm**: the feature dialog opens,
you click regions (several, toggling), the result previews live as you
change the depth, and ✓ or Enter commits, ✗ or Escape cancels. Read
`CLAUDE.md`, `docs/plans/effortless.md`, `tool-options.md`,
`no-refusals.md` and `extrude-makes-its-plane.md` (as built), every tool in
`src/tools/` (above all `extrude`, `revolve`, `fillet`, `sketch`,
`region.ts`, `options.ts`, `tool.ts`'s `ToolContext` — `run`, `act`, `log`
outcomes, `options`), `src/tools/engine.ts` (arming, cancel, keyboard),
`src/panels.ts`'s options panel, `src/main.ts`'s keydown listeners, `submit`
and undo bracketing, `src/operations.ts` (`extrude`, `revolve`, `fillet`
signatures and journal entries), and the e2e tests for those tools.

## The flow, for every tool that makes a feature

1. **Arm** (toolbar, typed, or menu). The options panel opens as now, and
   now carries **✓ (confirm) and ✗ (cancel)** buttons, ✓ disabled until the
   selection is enough.
2. **Pick**: a click inside a region **toggles** it in the selection (lit
   strongly when selected, faintly as a candidate — the no-refusals
   lighting); several regions may be selected. Revolve: regions, then a
   click on a line or frame arm sets the axis (clicking another replaces
   it). Fillet: click two lines that share a corner, or click near the corner
   to take both.
3. **Preview, live**: the result is drawn as it will be built, in the solid
   look, slightly translucent so it reads as not-yet-made, updated as the
   selection or any option changes (typing 25 in the depth field moves the
   lid). It must be the geometry the commit builds, not an approximation:
   derive it from the same expansion the operation will run, without
   journalling (state how: a throwaway model clone, or a pure "plan" function
   the operation already has — `planExtrude` is one).
4. **Confirm**: ✓, Enter, or a second click on the last-picked region (the
   quick path: click, click). Commits **one undo step** for the whole
   selection — several regions extrude as one action (one `extrude` call per
   region if the operation takes one profile, all inside one user action;
   say which), and the log shows each typed line. The tool stays armed with
   an empty selection, ready for the next.
5. **Cancel**: ✗ or Escape clears the selection and the preview (the tool
   stays armed; a second Escape releases it, as now).

**Preselection**: with nothing armed, a click inside a region selects it
(lit), shift-click adds; arming extrude, revolve or sketch then starts with
that selection — select the loop, then hit extrude, as the owner wrote. A
click on empty canvas clears it. This must not disturb box select (a drag
on empty canvas), picking an entity (a click on one), or the context menu.

**Sketch** stays one click (it has nothing to preview), but honours a
preselected region. **The typed commands do not change**: `extrude("l1",
20)` still commits at once; the dialog is the pointer path.

Enter while a text field in the options panel has focus commits the field
*and then* confirms (one key, both done), Escape in a field restores the
field (as now) and does not cancel the feature.

## Verification

Unit: the selection model (toggle, several, clear, preselection carried into
arming); the preview derived from the same plan as the commit, equal to the
committed geometry within tolerance for extrude, revolve and fillet;
confirm journals what the typed calls journal. E2e, pointer only: arm
extrude, click two regions, see both previewed (pixels on the would-be lids),
type 25 in depth and see the preview move, press Enter — two solids, one
undo step, `undo` takes both; ✓ button does the same; Escape cancels with
nothing built; the click-click quick path; preselect a region with nothing
armed, then the toolbar's extrude, then ✓; revolve with region, axis,
preview, Enter; fillet two lines, preview the arc, ✓; the first-run script
(`firstrun.e2e.ts`) updated to the new flow and still ending with no red.
LOOK at the preview screenshots. Full `npm run test:all`. Docs per
`CLAUDE.md`: CHANGELOG at the top quoting the owner; the register (features
are pick-preview-confirm; preselection; the quick path); STATUS; README's
tools paragraph; `help()`; this file marked built.

## Delivery

Isolated worktree, branch `claude/feature-dialog` off the working-branch tip,
one PR against `claude/resume-tasks-o7q02e` (two reviewable commits if it
outgrows one hand: selection and confirm, then the live preview). Do not
merge; the supervising session reviews. Another package (`opaque-solids.md`)
runs at the same time and owns the drawing pass's occlusion, picking,
snapping, face colours and view modes; call `hitTest` as it stands and stay
out of those.
