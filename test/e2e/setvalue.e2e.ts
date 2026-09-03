// Editing a dimension in the real app: `set("d1.value", 60)`.
//
// The unit suite proves the arithmetic and the bookkeeping. What only a browser
// can answer is whether the *assembly* is right — whether the geometry actually
// moves, whether the header tells the truth about it afterwards, whether one
// Ctrl+Z puts it back, and whether the menu item types what it says it types.
// This project has been bitten by a stale readout over a changed model twice,
// and `set` is the command most able to cause one: changing the answer is the
// entire thing it does.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, axisFrame, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app);
});
after(async () => { await app.close(); });

interface GlyphInfo {
  relation: string;
  op: string;
  symbol: string;
  screen: [number, number];
  halfW: number;
  halfH: number;
}

interface Probe {
  __neocad: { engine: { glyphs(): GlyphInfo[] } };
}

const glyphs = (): Promise<GlyphInfo[]> =>
  app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());

/** Distance between two named points, read out of the live model. */
async function span(a: string, b: string): Promise<number> {
  const pts = (await app.model()).points;
  return Math.hypot(...pts[a].map((c, i) => c - pts[b][i]));
}

async function rightClick(sx: number, sy: number) {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(120);
}

const items = () => app.page.$$eval("#ctxmenu .item span:first-child", (els) => els.map((e) => e.textContent ?? ""));
const commands = () =>
  app.page.$$eval("#ctxmenu .item", (els) => Object.fromEntries(els.map((e) => [
    e.querySelector("span:first-child")?.textContent ?? "",
    e.querySelector(".cmd")?.textContent ?? "",
  ])));

async function choose(label: string) {
  await app.page.$$eval("#ctxmenu .item", (els, want) => {
    (els.find((e) => e.querySelector("span:first-child")?.textContent === want) as HTMLElement)?.click();
  }, label);
  await app.page.waitForTimeout(180);
}

test("a dimension is named d1, and the drawing says so", async () => {
  await app.type('a = pt(0, 0); b = pt(40, 0); dist(a, b, 40)');
  assert.equal(await app.status(), "SOLVED");

  const rels = (await app.repl("rels()")).value as string[];
  assert.ok(rels.some((r) => r.startsWith("d1  dist ")), `expected a d1 in ${rels.join(" | ")}`);
  const label = (await glyphs()).find((g) => g.op === "dist");
  assert.ok(label, "the dimension is on the canvas");
  assert.equal(label!.relation, "d1");
  assert.equal(label!.symbol, "40");
});

test("set moves the geometry to the new value, and the header says so", async () => {
  assert.ok(Math.abs(await span("p1", "p2") - 40) < 1e-6, "sanity: the drawing starts at 40");

  await app.type('set("d1.value", 60)');

  // Closed form: two free points with one distance between them. The solve is
  // free to move either, but the span is pinned.
  const now = await span("p1", "p2");
  assert.ok(Math.abs(now - 60) < 1e-6, `the geometry should be 60 apart, it is ${now}`);
  assert.equal(await app.status(), "SOLVED", "and the verdict is not the one from before the edit");
  assert.match(await app.log(), /> set\("d1\.value", 60\)/, "one entry, as typed");
});

test("the dimension is still d1 afterwards, and its label reads the new number", async () => {
  const rels = (await app.repl("rels()")).value as string[];
  assert.deepEqual(rels.filter((r) => r.includes("dist")), ["d1  dist p1 p2 60"],
    "same name, one relation, updated args");
  const label = (await glyphs()).find((g) => g.op === "dist")!;
  assert.equal(label.relation, "d1");
  assert.equal(label.symbol, "60", "the glyph reads the registry, so it needed no telling");
});

test("one undo puts the old value back — set is one user action", async () => {
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(200);
  const back = await span("p1", "p2");
  assert.ok(Math.abs(back - 40) < 1e-6, `undo should return the drawing to 40, it is ${back}`);
  const rels = (await app.repl("rels()")).value as string[];
  assert.deepEqual(rels.filter((r) => r.includes("dist")), ["d1  dist p1 p2 40"]);

  await app.page.keyboard.press("Control+Shift+z");
  await app.page.waitForTimeout(200);
  assert.ok(Math.abs(await span("p1", "p2") - 60) < 1e-6, "and redo takes it forward again");
});

test("a set that cannot be made says why and changes nothing", async () => {
  const before = await span("p1", "p2");
  await app.type('set("d1.size", 10)');
  assert.match(await app.log(), /the only settable property is "d1\.value"/);
  await app.type('set("p1.value", 10)');
  assert.match(await app.log(), /"p1" is an entity, not a dimension/);
  assert.ok(Math.abs(await span("p1", "p2") - before) < 1e-9, "and the drawing did not move");
  assert.equal(await app.status(), "SOLVED");
});

test("the menu's Set value… types the command and leaves the number to the user", async () => {
  await app.page.fill("#cmd", "");
  const label = (await glyphs()).find((g) => g.op === "dist")!;
  await rightClick(...label.screen);

  assert.deepEqual(await items(), ["Set value…", "Delete"]);
  assert.equal((await commands())["Set value…"], 'set("d1.value", ',
    "the item shows exactly what it is about to type, unfinished and all");

  await choose("Set value…");
  assert.equal(await app.page.inputValue("#cmd"), 'set("d1.value", ',
    "inserted, not run — the number is the user's to supply");
  assert.equal(await app.status(), "SOLVED", "nothing was submitted");
  const stillAt = await span("p1", "p2");
  assert.ok(Math.abs(stillAt - 60) < 1e-6, "and the drawing is untouched");

  // Finishing it by hand is an ordinary entry, which is the whole claim the
  // menu makes about itself.
  await app.page.type("#cmd", "18)");
  await app.page.press("#cmd", "Enter");
  await app.page.waitForTimeout(200);
  assert.ok(Math.abs(await span("p1", "p2") - 18) < 1e-6, "the finished command ran as typed");
  assert.equal(await app.status(), "SOLVED");
});

test("a set survives save and open, at the value it was set to", async () => {
  const text = (await app.repl("save()")).value as string;
  assert.match(text, /"version": 4/);
  assert.match(text, /"op": "set"/);

  await app.type(`open(${JSON.stringify(text)})`);
  assert.ok(Math.abs(await span("p1", "p2") - 18) < 1e-6, "reopened at 18");
  const rels = (await app.repl("rels()")).value as string[];
  assert.deepEqual(rels.filter((r) => r.includes("dist")), ["d1  dist p1 p2 18"]);
  assert.equal(await app.status(), "SOLVED");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
