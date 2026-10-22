// What an empty canvas says. The owner opened the published build cold and
// reported "i dont see anything": since the grid and origin went, a fresh model
// is a black rectangle with no cue, and the page loading and solving perfectly
// was no help to someone who could not tell it had.
//
// The hint is drawn on the canvas, so it is checked the only honest way: by
// reading the canvas's own pixels across the band where it is written. Ink
// there means the words are on screen; none means they are not. The model is
// what decides, not any flag, so each way back to an empty model is driven.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

/**
 * How many pixels carry ink in a box `dx`..`dx + width` across from the
 * canvas's centre and 30px either side of it vertically — by default the whole
 * band the hint is written in.
 */
async function inkInHintBand(dx = -300, width = 600): Promise<number> {
  const [w, h] = await app.page.$eval("#cv", (el) => [el.clientWidth, el.clientHeight]);
  const at: [number, number][] = [];
  for (let y = Math.round(h / 2 - 30); y < Math.round(h / 2 + 30); y++) {
    for (let x = Math.round(w / 2 + dx); x < Math.round(w / 2 + dx) + width; x++) at.push([x, y]);
  }
  // The hint is written on the 2D canvas; its ink is anything not transparent there.
  return (await app.pixels("drawing", at)).filter((d) => d[3] > 0).length;
}

/** The band's far left, where only the hint's long line reaches: a frame's marker at the centre never does. */
const inkFarLeft = () => inkInHintBand(-320, 150);

test("a fresh app says what to do", async () => {
  assert.equal((await app.model()).size, 0, "nothing in the model");
  assert.ok(await inkInHintBand() > 200, "and words across the middle of the canvas");
  assert.ok(await inkFarLeft() > 0, "reaching out to the band's far left");
});

test("the first point takes it away, and undoing that point brings it back", async () => {
  // Drawn the way the hint says to: a tool from the toolbar, then a click —
  // well clear of the band, so any ink left there could only be the hint.
  await app.page.click('#toolbar button[data-tool="point"]');
  const at = await app.at(950, 120);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(100);
  assert.equal((await app.model()).size, 1);
  assert.equal(await inkInHintBand(), 0, "gone the moment anything exists");

  await app.page.fill("#cmd", "");
  await app.page.keyboard.press("Control+z");
  await app.page.waitForTimeout(100);
  assert.equal((await app.model()).size, 0);
  assert.ok(await inkInHintBand() > 200, "back after the undo, with nothing to tell it to come back");
});

test("any entity counts — a frame alone is a drawing — and deleting the last one brings it back", async () => {
  await app.type("frame()");
  assert.ok((await app.model()).size > 0);
  // A frame at the middle of the view draws its marker in the band, so the
  // check is made where only the hint's words would reach.
  assert.equal(await inkFarLeft(), 0, "a frame alone takes the hint away");
  await app.type('del("f1")');
  assert.equal((await app.model()).byKind.frame, undefined);
  // The frame's refs are its own points and outlive it; clear them too.
  const left = Object.keys((await app.model()).points);
  if (left.length) await app.type(`del(${left.map((n) => JSON.stringify(n)).join(", ")})`);
  assert.equal((await app.model()).size, 0, "empty again");
  assert.ok(await inkInHintBand() > 200, "the hint is back");
  assert.ok(await inkFarLeft() > 0, "words and all");
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
