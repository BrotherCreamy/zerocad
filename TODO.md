# NeoCAD — todo

The working list. `STATUS.md` describes what exists and why; this file is
what's next. `CHANGELOG.md` is what already happened, newest first.

Checked items stay for one release's worth of history, then move out to
`CHANGELOG.md`.

## Next up

Roughly in the order that unblocks the most.

- [ ] **A picking / selection model.** Hit-test the entity under the cursor,
      a real `sel` / `desel` pair, and a way to render what's selected.
      Blocks most of what's below it, so it goes first.
      - *Decision needed:* cellwork already solved this and the ideas were
        validated there. Worth porting its model rather than inventing a
        second one — but that means deciding which parts carry over.
- [ ] **A pointer-driven fillet tool.** Click two lines, round the corner.
      The `fillet` operation is done and reachable from the command line;
      this is only waiting on picking.
- [ ] **Hover snaps.** Snap to endpoints, midpoints, centers and
      intersections while a tool is dragging. Needs picking.
- [ ] **Box-select.** Needs picking and `sel`.
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

- [x] Mouse navigation — wheel zooms about the cursor, drag pans
- [x] Save and open as ordinary commands
- [x] The `fillet` operation
- [x] Circle and arc drawing tools
- [x] The REPL — tools and relations authored at the command line
- [x] Viewport control as ordinary commands
- [x] Circle and arc entities
- [x] The rest of the sketch relation vocabulary
