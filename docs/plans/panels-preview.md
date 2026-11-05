# Plan: a dragged panel shows where everything will land, and nothing moves until it is dropped

**Status: queued** (2026-11-05), after `mode-feedback.md` (both are the
chrome's; this one touches the resolver and the panels' drawing). The owner:
*"the toolbars should push each other around, but they should show how they
will snap IF the user drops the grasped toolbar in that spot. but until they
actually drop it, the permanent position of any tool bar is not changed"*.

## What is true today

`panels-push.md` built pushing: dragging a panel into another moves the
other out of the way as the drag goes, and every pane is where the drag left
it the moment the finger lifts — the push is the layout, live. There is no
preview and no way back short of dragging things back.

Read `CLAUDE.md`, `panels.md`, `panels-push.md`, `panels-corners-wrap.md`,
`toolbar-icons-docking.md`, `everything-fits.md`, `chrome-logo-scale.md`,
`src/panels.ts` (`layout`, `placed`, `constrain`, the resolver, `arranged`),
`src/main.ts`'s panel dragging, `index.html`'s panel styles, and the panels,
fits, chrome and touchlayout tests.

## Design

- **The drag moves only the grasped panel**, drawn where the finger has it,
  lifted (a shadow, as a held card). Every other panel stays exactly where it
  is for the whole drag.
- **The preview**: at every move the resolver is asked what the layout would
  be if the panel were dropped here — the same `layout()` call that pushes
  today, on a copy — and the answer is drawn as **ghosts**: a translucent
  outline where each panel that would move will land, and the grasped
  panel's own outline where it will snap (docked to an edge, against a tray,
  wrapped to its lines). A panel the drop would not move shows no ghost. The
  ghosts update as the finger moves, cheaply (the resolver is pure; measure
  it per move on a phone and say the number).
- **A tray's turn is previewed too.** The owner: *"when I push a toolbar up
  against one side and it changes from horizontal to vertical layout. it
  should not actually change the toolbar between modes unless I let go"*. A
  tray dragged against an edge that would turn it (row to column, or back)
  keeps its orientation under the finger; its ghost shows the turned tray
  where it would dock, and the turn happens at the drop.
- **Every panel not in hand goes translucent for the drag** (the owner:
  *"when I am dragging toolbars, all the ungripped ones should go
  translucent"*): the grasped panel is drawn solid and lifted, the rest at
  half opacity with their ghosts at full line weight, so the picture reads
  as "this is where things will be", and they return to full opacity at the
  drop or the escape. Measure that the opacity change does not cost a frame
  on a phone (it is one class on the container).
- **The drop commits** the previewed layout in one step: panels move to
  their ghosts (a short settle, 120 ms, no spring). **Escape, or lifting
  back where the drag started, commits nothing**: every panel is where it
  was, the ghosts gone. A drop that fits nothing (the resolver's refusal)
  is the same as Escape, with a word in the status.
- **The rules of the push are unchanged**: what docks where, what wraps,
  what the logo stops, the device table — the preview only shows them before
  they happen. `everything-fits.md`'s claims hold for the committed layout
  and for every preview (nothing a ghost shows overlaps).
- Mouse and finger alike; on a phone the ghosts are drawn at the interface
  size's line weight so they read at 3×.

## Tests

Unit: the resolver's answer for a drag position equals the layout a drop
there commits; Escape leaves the layout equal to the start; a drag that
moves nothing draws no ghosts. E2E (mouse and iPhone 13, portrait and
landscape): drag the command line onto the log — the log's ghost moves,
the log does not; drop — it moves; drag and Escape — nothing moved; drag the
tray to an edge — its ghost turns, it does not until dropped; the fits
suite unchanged. LOOK at each picture: a ghost must read as a ghost.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE ("The chrome floats"
gains the preview); the register (ghosts; Escape; the settle) as vetoable;
STATUS; README's panels paragraph; `help()`; the spec marked built with the
deviations.
