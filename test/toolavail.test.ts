// The one rule the context menu and the toolbar both read: which tools cannot
// run in the model as it stands, and why. It answers "never" now — the curve
// tools that used to be greyed in a 3D model with no default frame make their
// plane at the click (test/curvetoolplane.test.ts) — and stays the one place
// the question is asked, so a future rule lands on both surfaces at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { toolUnavailable } from "../src/toolavail.ts";
import { menuFor } from "../src/menu.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const TOOLS = ["point", "line", "rectangle", "circle", "circle3", "arc", "arc3", "fillet", "extrude", "revolve", "sketch"];

test("no tool is unavailable in any model: 2D or 3D, a default frame or none", async () => {
  await loadKernel();
  for (const dim of [2, 3]) {
    const model = new Model(dim);
    for (const t of TOOLS) assert.equal(toolUnavailable(model, t), null, `${dim}D, no frame: ${t}`);
    axisFrame(model);
    for (const t of TOOLS) assert.equal(toolUnavailable(model, t), null, `${dim}D, a default frame: ${t}`);
    model.setDefaultFrame(null);
    for (const t of TOOLS) assert.equal(toolUnavailable(model, t), null, `${dim}D, a frame but no default: ${t}`);
  }
});

test("asking makes nothing — no frame nobody chose appears because a rule was asked", async () => {
  await loadKernel();
  const model = new Model(3);
  for (const t of TOOLS) toolUnavailable(model, t);
  assert.equal(model.entities.size, 0);
  assert.equal(model.journal.length, 0);
});

test("a fresh 3D model's menu offers every tool, disabled none — the greyed curve items are gone", async () => {
  await loadKernel();
  const model = new Model(3);
  const menu = menuFor(model, null);
  assert.deepEqual(menu.items.filter((i) => i.action.do === "disabled").map((i) => i.label), []);
  for (const label of ["Circle", "3 point circle", "Arc", "3 point arc", "Fillet"]) {
    const item = menu.items.find((i) => i.label === label);
    assert.ok(item && item.action.do === "run", label);
  }
});

test("panels.ts still imports nothing: the toolbar learns availability only from its host", async () => {
  const src = await readFile(new URL("../src/panels.ts", import.meta.url), "utf8");
  assert.deepEqual(src.match(/^import .*$/gm) ?? [], []);
});
