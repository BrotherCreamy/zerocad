# Contributing

## Getting set up

```sh
npm install
npm run build:kernel    # cargo -> wasm-pack -> src/kernel/wasm-gen/ (gitignored)
npm run dev             # vite, on :5173
```

Two things about the toolchain that will otherwise cost you an afternoon:

- **Install Rust with the official script from [rustup.rs](https://rustup.rs),
  not Homebrew.** Homebrew's `rustup` formula has no bottle for some macOS
  versions and falls back to compiling Rust, LLVM, cmake and Python *from
  source*. That filled a 92GB disk to 20MB free once already; the incident note
  is at the bottom of [`STATUS.md`](STATUS.md).
- **`npm run build:kernel` downloads binaryen** for the `wasm-opt` pass. If
  that download is blocked, `npm run build:kernel:dev` skips the pass and
  produces a working (larger) kernel. Don't disable `wasm-opt` in `Cargo.toml`
  to work around a local network problem — that would deoptimise everyone's
  build.

Node is pinned by `.nvmrc`. Playwright's browser comes from
`npx playwright install chromium`; the e2e harness also finds a chromium
already sitting under `PLAYWRIGHT_BROWSERS_PATH`, so a preinstalled image works
without a second download.

## Tests

```sh
npm run typecheck   # tsc --noEmit
npm test            # unit — the mathematics. Fast, no browser.
npm run test:kernel # the Rust crate's own tests
npm run test:e2e    # end-to-end — a real browser driving the real app
npm run test:all    # all of the above
```

`npm run test:e2e` starts and stops its own dev server, or reuses one you
already have running.

**Run the e2e suite for anything that touches the app**, not just when it
feels risky. Ten bugs so far (the count is kept honest in docs/ARCHITECTURE.md) passed the entire unit suite and were obvious
within seconds of opening the page — the list is in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). The unit tests cover the
mathematics; they cannot see a stale readout or an event that never fires.

Tests here try to assert the *property*, not the transcript: check that the
circle ends up tangent to the line, not that the radius is `29.999999`. When a
test exists because of a specific bug, say so in the test — it stops the
assertion being mistaken for boilerplate and deleted later.

## Where things go

| you want to add | put it in | it may |
|---|---|---|
| a constraint | `src/relations/` | add residual blocks. Nothing else. |
| something that creates or re-points entities | `src/operations.ts` | change structure |
| a pointer gesture | `src/tools/` | build geometry via relations |
| a command | `src/replenv.ts` | expose what already exists |
| linear algebra | `kernel-rs/` | — |

The layer rule is that each may only know about the ones below it, and the
sharpest edge of it is this: **nothing in `src/kernel/` may import anything
that knows what a point is.** The solver is meant to be usable for problems
that have nothing to do with CAD.

`model.ts` holds structure and no equations; `relations/` holds equations and
no structure. A relation can only over- or under-constrain a model; an
operation can leave it malformed. That difference is why they are separate
files and why operations deserve more scrutiny in review.

### Adding a relation

Write a function taking the model and some entity names, wrap the body in
`model.relation(...)`, add one residual block whose value is zero exactly when
the relation holds, and give it a label — the label is what a conflict names,
so make it read like the call. The wrapper journals the call, collects the
blocks, names the result `rN`, and hands that name back; a relation returns
its name.

```ts
export function equalLength(model: Model, l1: string, l2: string): string {
  return model.relation("equalLength", [l1, l2], () => {
    const dim = model.dim;
    model.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
      const [a, b, c, d] = chunk(l, dim, 4);
      return [norm(vecSub(b, a)).sub(norm(vecSub(d, c)))];
    }, `eq(${l1},${l2})`);
  });
}
```

Note `model.addResidual`, not `model.problem.addResidual`: the wrapper cannot
collect a handle it is never told about, and a block added straight to the
problem belongs to no relation and can never be deleted. (Outside a
`model.relation` body the two are identical, so `model.addResidual` is always
the safe one.)

A relation written in terms of another one — `concentric` calls `coincident`
— just calls it: the inner call's blocks join your entry, and it neither
journals nor takes a name of its own. One user-level call is one relation.

Three things that are easy to get wrong:

- **Take variables lazily** (`lineVars`) for anything expressed in terms of a
  *line*, so the relation follows that line if an operation re-points it.
- **Write it dimension-generically** unless it genuinely isn't. Expressed
  through `dot()` and `wedge()`, most "2D" definitions hold unchanged in any
  dimension. Where something really is dimension-specific — `fillet` and the
  sketch tools (2D), a frame (2D or 3D, nothing else), a frame's `"z"` axis
  and `onPlane` (3D) — throw for other dimensions rather than silently doing
  something wrong, and prove the generic ones with a 3D test rather than
  asserting it in a comment.
- **Never make a residual that is already a square.** Its gradient vanishes at
  its own root, so least-squares ends up minimising a fourth power and
  converges badly. Use the wedge's components, not their sum of squares.

Then register it in `src/replenv.ts` (short name and long) and in
`src/persist.ts`'s replay table, or it won't survive a save. The `replenv.ts`
line takes a slot list too — `slots("circle", "#radius")` — which is what lets
`_` stand in it as a clause and refuses `_` where a number goes (`#`); see
`src/clauses.ts`.

**If it carries a single value the user would want to go back and change**, it
is a *dimension* rather than a constraint: add its op to `DIMENSION_OPS` in
`src/model.ts` so it claims a `d` name, its value's argument index to
`VALUE_ARG` beside it, and a line to `REBUILD` in `src/operations.ts` so `set`
can re-run it. Miss the first and the relation is `r`-named and has no
`.value`; miss either of the others and `set` throws on something it should
have handled. `test/dimensions.test.ts` checks that the three tables agree.
A relation that carries *coordinates* is not a dimension — that is why `fix`
is `r`-named — and neither is one that carries no number at all.

### Adding a tool

Subclass `Tool`, call `defineTool`. See `src/tools/rectangle.ts` — that is the
example the interface was designed around. `onDown` should not touch the model;
commit in `onUp` and then call `ctx.requestSolve()` and `ctx.finish()`. Draw
previews from the tool's own state in `render()`.

Prefer constraining *edges* over corner points (`par(edge, xaxis())` over
`par(cornerA, cornerB, xaxis())`), so the result survives being filleted
later.

## Documentation

The repo is meant to be readable by someone — or something — arriving with no
context, so documentation is part of the change, not a follow-up:

| file | what it is |
|---|---|
| [`README.md`](README.md) | the pitch and a quick tour |
| [`TODO.md`](TODO.md) | what's next; flags which items need a decision first |
| [`CHANGELOG.md`](CHANGELOG.md) | what's been built, newest first, with screenshots |
| [`STATUS.md`](STATUS.md) | the itemised account of what exists |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | why the code is shaped this way |
| [`CONVERSATION_LOG.md`](CONVERSATION_LOG.md) | the long-form reasoning, newest first |

Logs are **newest first**. When you finish something, tick it in `TODO.md` and
add a `CHANGELOG.md` entry at the top.

Write down the decisions you *didn't* take and why, especially where you left
a limitation in place deliberately. A caveat that is documented and tested is
a decision; the same caveat undocumented is a bug waiting to be rediscovered
from a bad screenshot.

## Style

Match what's there. Some specifics that are load-bearing rather than taste:

- **Local imports need the literal `.ts` extension.** The test suite runs on
  Node's `--experimental-strip-types`, which strips types and does no module
  resolution beyond that.
- **No TypeScript parameter-property shorthand** (`constructor(private x)`) for
  the same reason — it needs real transformation, not just type-stripping.
- Comments should say *why*, not *what*. The code says what.
- Prefer a named constant with a sentence explaining it over a magic number.

## Commits

Explain the reasoning, not just the change — what was tried, what was
rejected, what a reader would otherwise have to reconstruct. If a bug is being
fixed, say what made it possible, not only what the fix was.
