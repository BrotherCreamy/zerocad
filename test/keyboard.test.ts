// The keyboard (docs/plans/android.md): the panel being typed into rides above
// it, over no other pane, and the page is never resized for it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYBOARD_MIN, LIFTED_MIN_W, keyboardTop, lifted } from "../src/keyboard.ts";

test("the keyboard's top is what the visual viewport leaves of the page — and a bar settling is not a keyboard", () => {
  assert.equal(keyboardTop(839, { height: 839, offsetTop: 0 }), null, "nothing covered");
  assert.equal(keyboardTop(839, { height: 839 - KEYBOARD_MIN + 1, offsetTop: 0 }), null, "less than a keyboard");
  assert.equal(keyboardTop(839, { height: 500, offsetTop: 0 }), 500);
  assert.equal(keyboardTop(839, { height: 480, offsetTop: 20 }), 500, "a visual viewport scrolled down is measured from the page's top");
  assert.equal(keyboardTop(839, null), null, "no visualViewport, no keyboard to see");
});

test("the command line docked at the bottom of an upright phone rides up onto the keyboard, beside the tray's column", () => {
  // A Pixel 7, installed: the tray a column down the left to y 640, the command line along the bottom.
  const cmd = { x: 0, y: 822, w: 412, h: 41 };
  const tray = { x: 8, y: 52, w: 34, h: 588 };
  const organiser = { x: 50, y: 70, w: 121, h: 183 };
  const at = lifted(cmd, 500, [tray, organiser]);
  assert.deepEqual(at, { x: 42, y: 459, w: 370, h: 41 }, "its bottom on the keyboard, right of the tray");
  // A keyboard lower than the tray's end: the band is clear, edge to edge.
  assert.deepEqual(lifted(cmd, 700, [tray, organiser]), { x: 0, y: 659, w: 412, h: 41 });
  // Above the keyboard already (the landscape default, in the top row): left where it is.
  assert.equal(lifted({ x: 140, y: 8, w: 400, h: 41 }, 160, [tray]), null);
});

test("where the free run is too short to type in, the line keeps its width and goes over — never a sliver", () => {
  const cmd = { x: 0, y: 700, w: 300, h: 41 };
  const wide = { x: 100, y: 400, w: 150, h: 300 };
  const at = lifted(cmd, 500, [wide])!;
  assert.ok(Math.max(100, 50) < LIFTED_MIN_W);
  assert.deepEqual(at, { x: 0, y: 459, w: 300, h: 41 });
  // Never above the top of the page.
  assert.equal(lifted({ x: 0, y: 100, w: 300, h: 41 }, 20, [])!.y, 0);
});
