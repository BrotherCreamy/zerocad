// The one rule the context menu and the toolbar both read: which tools cannot
// run in the model as it stands, and why. The toolbar's browser half — a
// greyed button, its hover text, a click that types nothing — is
// test/e2e/panels.e2e.ts; this is the rule, and the proof that the menu says
// exactly what it says.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { CURVE_TOOLS, toolUnavailable } from "../src/toolavail.ts";
import { menuFor } from "../src/menu.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const CURVES = ["circle", "circle3", "arc", "arc3", "fillet"];
const OTHERS = ["point", "line", "rectangle", "extrude", "revolve"];

test("the curve tools are exactly the five that build a circle or an arc", () => {
  assert.deepEqual([...CURVE_TOOLS].sort(), [...CURVES].sort());
});

test("a 2D model needs no plane: nothing is unavailable, frame or none", async () => {
  await loadKernel();
  const model = new Model(2);
  for (const t of [...CURVES, ...OTHERS]) assert.equal(toolUnavailable(model, t), null, t);
  axisFrame(model);
  for (const t of [...CURVES, ...OTHERS]) assert.equal(toolUnavailable(model, t), null, t);
});

test("a 3D model with no default frame: the curve tools carry the model's own reason, the rest nothing", async () => {
  await loadKernel();
  const model = new Model(3);
  let standing = "";
  try { model.resolveFrame(); } catch (err) { standing = (err as Error).message; }
  assert.match(standing, /no default frame/, "the sentence the rule is meant to repeat");
  for (const t of CURVES) assert.equal(toolUnavailable(model, t), standing, `${t} says the model's words, not a copy`);
  for (const t of OTHERS) assert.equal(toolUnavailable(model, t), null, `${t} is never affected`);
  assert.equal(model.entities.size, 0, "and asking made nothing — no frame nobody chose");
});

test("a 3D model with a default frame: everything runs; unset it and the curves go again", async () => {
  await loadKernel();
  const model = new Model(3);
  axisFrame(model);
  for (const t of [...CURVES, ...OTHERS]) assert.equal(toolUnavailable(model, t), null, t);
  model.setDefaultFrame(null);
  for (const t of CURVES) assert.match(toolUnavailable(model, t) ?? "", /no default frame/, t);
});

test("a tool defined under a new name is never a curve tool", async () => {
  await loadKernel();
  const model = new Model(3);
  for (const t of ["stamp", "gear", "Circle", "circle "]) assert.equal(toolUnavailable(model, t), null, t);
});

test("the menu's disabled items say exactly what the rule says", async () => {
  await loadKernel();
  const model = new Model(3);
  const menu = menuFor(model, null);
  const off = menu.items.filter((i) => i.action.do === "disabled");
  assert.deepEqual(off.map((i) => i.label), ["Circle", "3 point circle", "Arc", "3 point arc", "Fillet"]);
  for (const i of off) assert.equal(i.action.do === "disabled" ? i.action.why : "", toolUnavailable(model, "circle"));

  axisFrame(model);
  assert.deepEqual(menuFor(model, null).items.filter((i) => i.action.do === "disabled"), [], "a frame enables every one");
});

test("panels.ts still imports nothing: the toolbar learns availability only from its host", async () => {
  const src = await readFile(new URL("../src/panels.ts", import.meta.url), "utf8");
  assert.deepEqual(src.match(/^import .*$/gm) ?? [], []);
});
