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
- [ ] **Welding coincident points.** Snapping moves the cursor but never
      reuses an existing point — a rectangle drawn corner-to-corner on
      another lands two points at the same place rather than sharing one.
      Sharing is often what's wanted, but not always, and it is destructive
      to guess. Probably a `weld` operation, or `coin` applied on commit.
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
- [ ] **Saving user-authored tools and relations.**
      - *Decision needed:* a tool defined at the REPL is a closure, so
        saving it means saving its **source**. A file that carries code is a
        different kind of file, with different questions about what opening
        one is allowed to do. Worth deciding deliberately rather than
        drifting into.
- [ ] **Nested `(...)` sub-commands**, per cellwork.
- [ ] **The icon toolbox**, per cellwork.

## Smaller things

- [ ] **`tsconfig.json` doesn't actually typecheck the project.** `npx tsc
      --noEmit` fails on every local import, because the project uses the
      literal `.ts` extensions Node's strip-only mode requires and the
      config doesn't set `allowImportingTsExtensions`. Tests are the real
      safety net today; a working `tsc` would be a second one.
- [ ] **No `wasm-opt` fallback.** `npm run build:kernel` downloads binaryen
      for the release profile. On a machine that can't reach it, the build
      fails outright rather than falling back — `wasm-pack build --dev`
      works and skips the pass. Worth a documented escape hatch rather than
      turning `wasm-opt` off for everyone in `Cargo.toml`.
- [ ] **`Problem.solve` uses `Math.hypot(...r)`.** Spreading the residual
      vector is fine at today's sizes and will blow the stack at some point.
      A plain loop costs nothing.
- [ ] **`residualNormsOnly` is dead code** in `src/kernel/problem.ts` — it
      documents a plain-float fast path that was never wired up. Either wire
      it or delete it.

## Done

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
