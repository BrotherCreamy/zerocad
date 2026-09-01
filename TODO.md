# NeoCAD — todo

The working list. `STATUS.md` describes what exists and why; this file is
what's next. `CHANGELOG.md` is what already happened, newest first.

Checked items stay for one release's worth of history, then move out to
`CHANGELOG.md`.

## Next up

Roughly in the order that unblocks the most.

- [ ] **Snap to intersections.** Points, midpoints and positions along a
      curve are done; where two curves cross is the obvious gap, and needs
      real intersection maths rather than a nearest-point projection.
- [ ] **Welding coincident points.** Snapping makes a click land on the
      *exact* coordinate of an existing point — but it still creates a **new**
      point there. Draw one rectangle starting on another's corner and you get
      two points at the same position that are not connected to each other:
      drag one and the other stays behind. They look joined and aren't.
      Making them genuinely one point — or adding `coin` between them — is
      usually what was meant.
      - *Decision needed:* usually, not always. A tool that welds
        automatically is guessing at intent, and a wrong guess leaves a
        constraint you never asked for and currently have no way to delete.
        Guessing the other way costs one command: `coin("p3", "p5")`. So:
        weld on snap, offer an explicit `weld` operation, or leave it manual?
- [ ] **Dragging a point with the mouse.** cellwork solves with soft
      residuals pulling the dragged point toward the cursor (weight ~0.12) so
      the rest of the model follows its constraints — a very natural
      interaction for a constraint solver. Needs `Problem.solve` to accept
      *temporary* residual blocks, which it currently cannot.
- [ ] **Box-select.** Now that picking is name-based rather than a selection
      set, this wants thought: dragging a box would naturally insert *several*
      names at once. Probably worth doing after the fillet tool shows how
      multi-pick should read.
- [ ] **Deleting entities.** No `remove` yet, and it isn't trivial:
      variables live in one flat vector, so removing a point means
      compacting it and remapping every residual block that refers to a
      later index. The lazy-`varIndices` change makes this more tractable —
      a block can resolve through an entity now instead of holding a raw
      index — but it is still real work.
- [ ] **Saving user-authored tools and relations.** A saved file is a list of
      calls — `addPoint([0,0],"p1")`, `fillet("l1","l2",8)` — replayed on
      open, and `open()` will only run calls from a fixed table. So a file is
      **data**: the worst a hostile one can do is draw something odd.
      A tool defined at the command line is a live JavaScript class, which
      cannot be written into JSON. Saving it means saving the **source text**
      and having `open()` evaluate it — at which point opening a file someone
      sent you runs their code in your browser, with the app's full authority
      (the REPL is curation, not a sandbox — see `docs/ARCHITECTURE.md`).
      Today such a tool is simply lost: the geometry it drew survives, because
      the geometry calls are journalled, but the tool itself is not in the
      file at all.
      - *Decision needed:* may a neocad file carry code? Middle grounds
        exist — save the source as inert text that has to be pasted in by
        hand, or ask before evaluating it.
- [ ] **Nested `(...)` sub-commands**, per cellwork.
- [ ] **The icon toolbox**, per cellwork.

## Smaller things

- [ ] **`Problem` has no way to remove a residual block.** Not needed yet, but
      dragging a point wants *temporary* ones (a soft pull toward the cursor,
      dropped when the drag ends), and deleting an entity will want real
      removal.

## Done

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
