# Working in this repo

A general nonlinear least-squares solver (Rust/WASM kernel, automatic
differentiation for exact sparse Jacobians) with 2D CAD built on top as an
ordinary library, plus a command line that can extend that library at runtime.
No server: everything runs client-side in the browser.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything
structural, and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full version of
what's below. [`TODO.md`](TODO.md) is what's next.

## Commands

```sh
npm install && npm run build:kernel   # wasm-gen/ is gitignored, regenerate it
npm run typecheck   # tsc --noEmit
npm test            # unit, ~1s, no browser
npm run test:kernel # the Rust crate
npm run test:e2e    # real browser, real app, ~13s — starts its own dev server
npm run test:all    # all of the above
npm run dev         # vite on :5173
```

If `build:kernel` fails downloading binaryen, `npm run build:kernel:dev` skips
`wasm-opt` and produces a working (larger) kernel. Do **not** disable
`wasm-opt` in `Cargo.toml` to work around a local network problem.

## Things that fail silently if you get them wrong

- **Local imports must carry the literal `.ts` extension.** Tests run on Node's
  `--experimental-strip-types`, which does no module resolution.
- **No TypeScript parameter-property shorthand** (`constructor(private x)`) —
  same reason; it needs real transformation, not type-stripping.
- `npm run typecheck` works and should stay at zero errors. It is part of
  `npm run test:all`.
- A new relation must be registered in **both** `src/replenv.ts` (so it's
  callable) and `src/persist.ts`'s replay table (so it survives save/open).
  Nothing catches this but a test.
- `model.record(...)` as the first line of a relation is what puts it in the
  journal. Forget it and the relation silently vanishes on save/open.

## The layer rule

Each layer may only know about the ones below it:

```
main.ts → repl/replenv → tools, operations, persist → relations → model → kernel → kernel-rs
```

The sharpest edge: **nothing in `src/kernel/` may import anything that knows
what a point is.** The solver is meant to work for any nonlinear least-squares
problem; a `Point` import in `problem.ts` ends that.

`model.ts` holds structure and no equations. `relations/` holds equations and
no structure. Something that creates or re-points entities is an *operation*
(`operations.ts`), not a relation — a relation can only over- or
under-constrain, an operation can leave the model malformed.

## Verification

**Run `npm run test:e2e` for anything that touches the app.** Four bugs so far
passed the entire unit suite and were obvious within seconds in a browser: a
stale status readout, a fillet that satisfied every constraint to six decimals
while drawing a broken rectangle, an auto-naming loop that hung the tab, and a
pan that silently did nothing mid-gesture. The unit tests cover the
mathematics; they cannot see any of that.

If you take a screenshot to check something visual, actually look at it. Two of
those four were caught by looking at a picture that the numbers said was fine.

Don't claim a check passed without running it, and don't describe an
improvement without a measurement.

## When writing relations

- Take line variables **lazily** (`lineVars`), so the relation follows a line
  that an operation later re-points.
- Write it **dimension-generically** unless it genuinely isn't — through
  `dot()` and `wedge()` most "2D" definitions hold in any dimension. Prove it
  with a 3D test rather than a comment. Where it really is 2D-only, throw.
- **Never make a residual that is already a square** — its gradient vanishes at
  its own root and least-squares ends up minimising a fourth power.
- Prefer `hor(edge)` over `hor(cornerA, cornerB)` — the line form survives
  structural surgery, the point form doesn't.

## Documentation is part of the change

The repo is meant to be picked up cold, by a person or an agent, with no other
context. When you finish something:

- tick it in `TODO.md`, and add anything you discovered
- add a `CHANGELOG.md` entry **at the top** (logs here are newest-first)
- update `STATUS.md` if what-exists changed
- add reasoning to `CONVERSATION_LOG.md` if the *why* is not obvious from the
  diff — especially decisions you rejected

Write down limitations you left in place deliberately. A caveat that is
documented and tested is a decision; the same caveat undocumented is a bug
waiting to be rediscovered.

## Repo conventions

- Commit and push as you go, on the working branch. Don't open a PR unless
  asked.
- Commit messages explain reasoning, not just the change.
- Comments say *why*. The code already says *what*.
- Don't add a dependency without a reason that survives being asked twice.
