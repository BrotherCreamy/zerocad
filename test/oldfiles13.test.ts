// Files from before curves carried their own normal (format 13,
// docs/plans/frameless-curves.md) open to the geometry they had.
//
// Proved with fixtures, not assertions about what the translation ought to do:
// each `test/fixtures/*-v12.neocad.json` was written by the build before this
// change (the format-12 build), and its `*.geometry.json` is what that build
// opened it to — every point, and every circle's and arc's radius, normal and
// sweep. `pre-explicit-regions` is the explicit-regions package's own fixture,
// a format-11 file, with its geometry recorded by the same build. Opened here,
// each must match it, solve without moving, regenerate every feature without
// moving, and re-save stably — and every curve that named a frame now follows
// that frame by an ordinary `par`, the frames all still there.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import type { Model } from "../src/model.ts";
import { open, save } from "../src/persist.ts";
import { regen } from "../src/operations.ts";
import { curveFrame } from "../src/curveplane.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

interface Geometry {
  points: Record<string, number[]>;
  curves: Record<string, { r: number; normal: number[]; sweep: number; u: number[] }>;
  kinds: Record<string, string>;
  features: string[];
  relations: string[];
}

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const near = (a: number[], b: number[], tol: number) => Math.hypot(...a.map((x, i) => x - b[i])) <= tol;

/** Every point where the old build had it, and every curve the same circle or arc. */
function sameGeometry(m: Model, want: Geometry, tol: number, what: string): void {
  for (const [p, at] of Object.entries(want.points)) {
    assert.ok(m.entities.get(p)?.kind === "point", `${what}: ${p} is still a point`);
    assert.ok(near(m.coords(p), at, tol), `${what}: ${p} at ${m.coords(p)}, was ${at}`);
  }
  for (const [c, was] of Object.entries(want.curves)) {
    const e = m.entities.get(c)!;
    const f = curveFrame(m, e)!;
    assert.ok(Math.abs(f.r - was.r) <= tol, `${what}: ${c}'s radius`);
    // The same normal, sign and all — for an arc the sign is which way round
    // it goes, and the sweep says the same arc was drawn.
    assert.ok(near(f.normal, was.normal, 1e-9), `${what}: ${c} faces ${f.normal}, was ${was.normal}`);
    assert.ok(Math.abs(f.sweep - was.sweep) <= 1e-9, `${what}: ${c} sweeps ${f.sweep}, was ${was.sweep}`);
  }
}

/** Which frame each curve follows, by its `par(curve, "f.z")`. */
function following(m: Model): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of m.relations.values()) {
    if (r.op === "parallel" && typeof r.args[1] === "string" && r.args[1].endsWith(".z")) {
      out.set(String(r.args[0]), r.args[1].slice(0, -2));
    }
  }
  return out;
}

for (const [name, lifted] of [["curves-v12", false], ["features-v12", false], ["flat2d-v12", true], ["pre-explicit-regions", false]] as const) {
  test(`${name}: opens to the geometry the format-12 build opened it to — solved, regenerated and re-saved without moving`, async () => {
    await loadKernel();
    const text = await fixture(`${name}.neocad.json`);
    const want = JSON.parse(await fixture(`${name}.geometry.json`)) as Geometry;
    // The one frame the old translation made for a lifted 2D drawing's curves
    // (`plane`, on points of its own), which the origin is now: not made.
    const translationFrame = new Set(lifted ? ["plane", "plane_o", "plane_x", "plane_y"] : []);
    for (const n of translationFrame) { delete want.points[n]; delete want.kinds[n]; }
    const m = open(text, 3);
    sameGeometry(m, want, 1e-9, "opened");

    const was = Object.entries(want.kinds);
    assert.deepEqual([...m.entities.keys()].sort(), was.map(([n]) => n).sort(), "the same entities");
    for (const [n, k] of was) assert.equal(m.entities.get(n)!.kind, k, n);
    assert.deepEqual([...m.features.keys()], want.features);
    // Every relation it had, under the name it had, and the pars after them.
    assert.deepEqual([...m.relations.keys()].slice(0, want.relations.length), want.relations, "no name shifted");

    // Every curve the file drew on a frame follows that frame now by a par.
    const kept = following(m);
    for (const [c, k] of Object.entries(want.kinds)) {
      if (k !== "circle" && k !== "arc") continue;
      const madeByFeature = [...m.features.values()].some((f) => f.owns.includes(c));
      if (madeByFeature) continue; // a twin: held to its base by the feature's dimension
      assert.ok(kept.has(c), `${c} follows a frame`);
      assert.ok(m.isFrame(kept.get(c)!), `${c} follows ${kept.get(c)}`);
    }

    assert.equal(m.solve().solved, true, "solved as it stands");
    sameGeometry(m, want, 1e-6, "solved");
    for (const f of [...m.features.keys()]) regen(m, f);
    assert.equal(m.solve().solved, true);
    sameGeometry(m, want, 1e-6, "regenerated");

    const once = save(m);
    assert.equal(JSON.parse(once).version, 13);
    const back = open(once);
    assert.equal(save(back), once, "re-saves stably as format 13");
    sameGeometry(back, want, 1e-6, "reopened");
  });
}

test("an old file's curve follows its frame: turn the frame, and the circle turns with it — through an ordinary par", async () => {
  await loadKernel();
  const m = open(await fixture("curves-v12.neocad.json"), 3);
  // c2 was drawn on f2, the tilted frame (p8, p9, p10). Turn f2 about its
  // origin by swinging its x-ref, and the circle comes round with it.
  const r = [...m.relations.values()].find((x) => x.op === "parallel" && x.args[0] === "c2")!;
  assert.deepEqual(r.args, ["c2", "f2.z"]);
  const o = m.coords("p8");
  m.setCoords("p9", [o[0] + 20, o[1] + 10, o[2]]);
  m.setCoords("p10", [o[0], o[1], o[2] + 20]);
  assert.equal(m.solve().solved, true);
  const f2z = [10 * 20, -20 * 20, 0].map((x) => x / Math.hypot(200, 400)); // (20,10,0) × (0,0,20)
  assert.ok(Math.abs(Math.abs(m.normalOf("c2").reduce((s, x, i) => s + x * f2z[i], 0)) - 1) < 1e-9, `${m.normalOf("c2")}`);
  // And deleting the frame takes the par, never the circle.
  const { del } = await import("../src/operations.ts");
  const gone = del(m, "f2");
  assert.ok(gone.includes(r.name) && !gone.includes("c2"));
});

test("a fresh document's file is format 13, its curves frameless, and it round-trips", async () => {
  await loadKernel();
  const { Model } = await import("../src/model.ts");
  const m = new Model(3);
  m.addCircle(m.addPoint([1, 2, 0]).name, 4);
  const text = save(m);
  const saved = JSON.parse(text);
  assert.equal(saved.version, 13);
  assert.deepEqual(saved.journal[1], { op: "addCircle", args: ["p1", 4, null, "c1"] });
  assert.deepEqual(saved.values.normals, { c1: [0, 0, 1] });
  assert.equal(save(open(text)), text);
});
