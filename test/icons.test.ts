// The toolbar's glyphs: every built-in tool has its own, nothing else does, and
// the generic one is built from a name safely. What the glyphs look like is a
// browser's question (test/e2e/panels.e2e.ts, and a person looking at it); this
// is the rule that decides which glyph a tool gets.

import { test } from "node:test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { TOOL_ICONS, genericIcon, toolIcon } from "../src/tools/icons.ts";
import { listTools } from "../src/tools/tool.ts";

/**
 * The built-ins are whatever main.ts imports from tools/ for its side effect of
 * registering — read from main.ts itself, so a tool added there and not here
 * cannot slip past this test.
 */
async function registerBuiltIns(): Promise<string[]> {
  const main = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const files = [...main.matchAll(/^import "\.\/(tools\/[a-z0-9]+\.ts)";$/gm)].map((m) => m[1]);
  assert.ok(files.length >= 11, `main.ts's tool imports: ${files.join(", ")}`);
  for (const f of files) await import(new URL(`../src/${f}`, import.meta.url).href);
  return listTools();
}

test("every built-in tool has a glyph of its own, and the table names nothing that is not one", async () => {
  const builtIns = await registerBuiltIns();
  assert.deepEqual([...builtIns].sort(), Object.keys(TOOL_ICONS).sort());
  for (const name of builtIns) {
    assert.equal(toolIcon(name), TOOL_ICONS[name]);
    assert.match(toolIcon(name), new RegExp(`data-glyph="${name}"`));
  }
});

test("the glyphs are one family: one box, one stroke, currentColor, no fill but a dot", () => {
  for (const [name, svg] of [...Object.entries(TOOL_ICONS), ["generic", genericIcon("stamp")]]) {
    assert.match(svg, /^<svg class="ico" data-glyph="[a-z0-9]+" viewBox="0 0 16 16" width="16" height="16"/, name);
    assert.equal(svg.match(/stroke-width=/g)?.length, 1, `${name}: the family's stroke width, and no other`);
    assert.doesNotMatch(svg, /#[0-9a-f]{3,8}|rgb\(/i, `${name}: no colour of its own — the button's colour is the glyph's`);
    // Every fill is either the root's "none" or currentColor on a dot (or the
    // generic glyph's letters, which are text and have to be filled).
    const fills = [...svg.matchAll(/<(\w+)[^>]*\sfill="([^"]+)"/g)].map((m) => [m[1], m[2]]);
    for (const [tag, fill] of fills) {
      if (tag === "svg") assert.equal(fill, "none", name);
      else assert.ok(fill === "currentColor" && (tag === "circle" || tag === "text"), `${name}: a ${tag} filled ${fill}`);
    }
  }
});

test("any other name gets the generic glyph: a square carrying its first two letters", () => {
  const g = toolIcon("stamp");
  assert.equal(g, genericIcon("stamp"));
  assert.match(g, /data-glyph="generic"/);
  assert.match(g, /<rect /, "the square");
  assert.match(g, />st<\/text>/, "and the letters");
  assert.match(toolIcon("x"), />x<\/text>/, "a one-letter name is its one letter");
  // Never guessed from a near name, and never read off Object.prototype.
  for (const name of ["Circle", "circles", "constructor", "__proto__", "toString"]) {
    assert.match(toolIcon(name), /data-glyph="generic"/, name);
  }
});

test("the generic glyph's letters are escaped: a name is whatever string defineTool was given", () => {
  assert.match(genericIcon("<b>bold"), />&#60;b<\/text>/);
  assert.match(genericIcon('"&'), />&#34;&#38;<\/text>/);
  assert.doesNotMatch(genericIcon("<script>"), /<script/);
  // A letter outside the BMP is one letter, not half of one.
  assert.match(genericIcon("𝑥y"), />𝑥y<\/text>/);
});
