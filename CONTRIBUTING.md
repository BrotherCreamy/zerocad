# Contributing

## Getting set up

```sh
npm install
npm run build:kernel    # cargo -> wasm-pack -> src/kernel/wasm-gen/ (gitignored)
npm run build:solids    # NVIDIA SMLib from pinned source -> src/solids/smlib-gen/ (gitignored)
npm run dev             # vite, on :5173
```

`build:solids` (`scripts/solids/build.sh`) is the solid kernel. It fetches
usd-brep and Emscripten at the commits it pins into `.solids-cache/` and
compiles SMLib to wasm: about 15 minutes on four cores cold (6 m 51 s on
GitHub's runner), and 16 s in CI with the cache warm and nothing changed.
`SMLIB_SRC`, `EMSDK` and `SOLIDS_OBJ` point it at a checkout you already have.
Without it the app still runs: bodies with a boolean are drawn as their
features, cuts left out, the log says why, and the kernel's tests skip and
say so. Never commit its output, and never vendor a prebuilt kernel; the
point of the recipe is that we can rebuild, patch and bisect it.

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
npm test            # unit — the mathematics. No browser; ~30 s with the solid kernel built.
npm run test:kernel # the Rust crate's own tests
npm run test:e2e    # end-to-end — a real browser driving the real app
npm run test:all    # all of the above
```

`npm run test:e2e` starts and stops its own dev server, or reuses one you
already have running. `test/e2e/pwa.e2e.ts` also runs `build:pwa` into a
temporary folder and serves it under a sub-path itself, so the hosted build
is tested on every run with nothing left in `dist-pwa/`.

**Anything for a phone goes in the app, not only in the hosted build.** The
viewport, the fixed page, the safe areas and `src/pagelock.ts` are in
`index.html` and `main.ts`, so the dev server and the single-file artifact
behave as the installed app does. Only the manifest, the icons' links and the
service worker are the hosted build's (`scripts/pwa-shell.ts`). A worker is
never registered on the dev server, which would otherwise serve yesterday's
code from its cache.

**Run the e2e suite for anything that touches the app**, not just when it
feels risky. Seventy-four bugs so far (the count is kept honest in docs/ARCHITECTURE.md) passed the entire unit suite and were obvious
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

Four things that are easy to get wrong:

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
- **A row that reads a line for its direction reads it at unit length, and
  says so.** A product with a raw `b − a` is a product with the line's
  length, and the solve will pay for the relation by shortening the line
  (`par` between two free 60-long lines left them 8.8 and 1.2 long;
  docs/plans/review-solver.md). Use `unit(vecSub(b, a), model.lengthFloor())`
  (vec.ts), prefer the angle (`turnToParallel`, `turnToSquare`,
  `angleBetween`) to a sine or a cosine, which are flat where they are
  largest, multiply by `rowLength(lengthBefore(model, vars))` so the row is a
  length again, and pass the lines' names as `model.addResidual`'s last
  argument (`turns`) so a solve that meets the row keeps their lengths. A
  test that the row's gradient along each of its lines is zero is ten lines
  (`test/directionrows.test.ts`'s `checkRows`).

Then register it in **its module's `relations`** (`src/modules/core.ts` or
`sketch.ts`, or your own module — see *Adding a module*), keyed by the op it
journals, with the names it is typed by (short first) and its slot list —
`{ names: ["rad", "radius"], slots: slots("circle", "#radius"), fn: radius }`.
That one entry is both what makes it typeable (`replenv.ts` binds every
module's relations) and what lets a file replay it (`persist.ts`'s table is
filled from the same entries); there is no second table to forget any more.
The slot list is what lets `_` stand in it as a clause and refuses `_` where a
number goes (`#`); see `src/clauses.ts`. (`CLAUDE.md` still says "both
`replenv.ts` and `persist.ts`" — the module entry is both now.)

**If it carries a single value the user would want to go back and change**, it
is a *dimension* rather than a constraint: give its module entry `dimension:
<the value's argument index>` (`major: { …, dimension: 1 }`) and it claims a
`d` name and `set` re-runs it. The built-in dimensions are still listed by hand
in `DIMENSION_OPS`, `VALUE_ARG` (`src/model.ts`) and `REBUILD`
(`src/operations.ts`); `test/dimensions.test.ts` checks that they agree.
A relation that carries *coordinates* is not a dimension — that is why `fix`
is `r`-named — and neither is one that carries no number at all.

### Adding a tool

Subclass `Tool` and list it in a module's `tools` — the built-ins are in
`src/modules/`; at the command line, `defineTool(name, ctor)` does the same for
one tool. See `src/tools/rectangle.ts` — that is the example the interface was
designed around. A tool file defines its class and **does not register
itself**: the module does, with its glyph (`icons`, drawn with `svg()` from
`src/tools/icons.ts`) and its group (`groups`). `onDown` should not touch the
model; commit in `onUp` and then call `ctx.requestSolve()` and `ctx.finish()`.
Draw previews from the tool's own state in `render()`.

Prefer constraining *edges* over corner points (`par(edge, xaxis())` over
`par(cornerA, cornerB, xaxis())`), so the result survives being filleted
later.

### Adding a module

A module is one call that registers everything it brings
(docs/plans/workbenches.md; the interface is `ModuleSpec` in
`src/modules.ts`). For a built-in, write `src/modules/<name>.ts` and import it
from `src/modules/builtin.ts` **where its tools should stand on the tray** —
load order is the order of every table. For someone else's, write the same
call in a workbench file (below). The minimum, a module with one tool, one
relation and one entity kind:

```js
defineModule("pins", {
  tools: { pin: class extends Tool { name = "pin"; onUp(p) { addPin(pt(...p.world)); this.ctx.requestSolve(); this.ctx.finish(); } } },
  icons: { /* pin: svg("pin", "<path …/>") — else it gets the generic glyph */ },
  groups: { /* shapes: ["pin"] — join a family's button */ },
  relations: {
    // keyed by the op a file journals; names typed by, short first; slots for `_`
    level: { names: ["level"], slots: ["a", "b"], fn: (model, a, b) => model.relation("level", [a, b], () => {
      const A = model.point(a), B = model.point(b);
      model.addResidual([A.varIndices[1], B.varIndices[1]], (l) => [l[0].sub(l[1])]);
    }) },
  },
  operations: { /* op: (model, ...args) => … — run inside model.asOperation when typed */ },
  entities: [{
    kind: "pin", refs: (e) => [e.at],                 // the points it is built of: del of one takes it
    add: { op: "addPin", fn: (model, at, name) => {  // its constructor, as a file replays it
      const [nm] = model.claimFirst("pin", name, () => null);
      const e = { kind: "pin", name: nm, at };
      model.place(e); model.record("addPin", [at, nm]); return e;
    } },
    samples: (model, name) => { /* the world polyline it is drawn and picked as */ },
  }],
  menu: [{ label: "Pin", tool: "pin" }],             // the empty-canvas menu
  help: ["pins       pin tool, level(a, b), addPin(point)"],
});
defineWorkbench("pins", { label: "Pins", modules: ["core", "sketch", "pins"] });
```

The rules that are easy to miss:

- **A name is one module's.** Defining a tool, glyph, relation spelling, op or
  entity kind another module has is refused with the name, and nothing of the
  module is registered. A group is the exception: extend it freely.
- **An entity kind declares its structure** (`refs`, `vars`, `curve`,
  `closed`, `plane`, `heldBy`, `bounds` — `EntityKindSpec` in `src/model.ts`)
  and, for the layers above, `frame` (a conic laid out as `arcgeom.ts`'s
  `ArcFrame`: drawn, boxed, looped, picked), `describe` (the hover line),
  `step` (its Part 42 curve) or `samples` (a polyline, for a kind with no
  frame). Its TypeScript type joins `Entity` by declaration merging — see
  `src/kinds/ellipse.ts`. Never add a kind's name to `model.ts`, `loops.ts`,
  `faces.ts`, `picking.ts` or `step.ts`: `test/modules.test.ts` greps them for
  the ellipse, and the rule is the same for every kind.
- **A relation's body is still one `model.relation(…)`**, with
  `model.addResidual` inside — the module entry does not change that.
- **Help, menu and File items** are the module's too (`help`, `menu`,
  `files`); `help()` and the menus read them in load order.

**A workbench file** is the same call in one `<name>.zerocad.js`, with a
manifest comment at its very top that names exactly what it registers — the
app shows this before anything runs, and refuses a file that registers
anything it does not list:

```js
/* zerocad-workbench
{ "name": "pins", "label": "Pins", "workbench": "pins",
  "tools": ["pin"], "relations": ["level"], "operations": [], "entities": ["pin"] }
*/
```

`test/fixtures/workbenches/pins.zerocad.js` is a whole one. Add it with the
logo menu's **Add workbench…**, `addWorkbench()`, or `loadModule(url)`; test it
with `test/modules.test.ts`'s pattern (`readManifest`, `loadingFile`).

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
