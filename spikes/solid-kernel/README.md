# Solid-kernel spike

Throwaway measurement code for [`docs/plans/solid-kernel-spike.md`](../../docs/plans/solid-kernel-spike.md)
(the findings are there). **The app imports nothing from here**, and nothing
here is a dependency of the app: the kernel builds into a scratch directory
and is never committed.

- `smlib/` — the recipe: `build.sh` compiles NVIDIA's SMLib + SM_API sources
  (Apache-2.0) with Emscripten, with `glue.cpp`, our C ABI over SM_API.
- `src/kernel.ts` — the kernel-neutral contract the measurements are written
  against; `src/smlib.ts` implements it over the wasm build.
- `src/parts.ts` — the test parts, each with a closed-form volume and box
  (`src/profiles.ts`); `src/naming.ts` — the identity-across-rebuild scheme;
  `src/bench.ts` — the measurements; `src/worker.ts` — the kernel in a Worker.
- `bench/node.ts`, `bench/chromium.ts` — run them in Node and in headless
  Chromium (a module Worker); `bench/sizes.ts` — raw/gzip/brotli sizes;
  `bench/leak.ts` — heap kept per operation and per part.
- `test/` — the spike's own tests: `node --experimental-strip-types --test
  spikes/solid-kernel/test/*.test.ts`. The kernel tests skip, saying so,
  unless `SMLIB_DIR` names a build.

To reproduce, from a scratch directory:

```sh
git clone https://github.com/NVIDIA-Omniverse/usd-brep    # pin: see build.sh
git clone https://github.com/emscripten-core/emsdk && emsdk/emsdk install 4.0.15
bash <repo>/spikes/solid-kernel/smlib/build.sh usd-brep emsdk out -O2
SMLIB_DIR=out node --experimental-strip-types <repo>/spikes/solid-kernel/bench/node.ts out
```
