// The oracle of parts (docs/plans/oracle.md): a dozen parts made by the
// commands the owner types, each measured by the real kernel — volume, area,
// bounding box, centroid, face count — against a closed form worked out by
// hand in test/oracle/derive.ts, with the derivation beside the number.
//
// The rule (CONTRIBUTING.md, Tests): an expected value needs a derivation.
// Never take one from the program's own output, never loosen a bar to fit what
// the kernel now gives, and never mark a failing case skipped — a case that
// fails names its bug in TODO and is declared `known_failure` with that number
// in its expected.json, which the suite then holds it to: it is replayed and
// measured like every other, and the comparison is asserted to fail, so the
// fix drops the line in the same change or this file says "bug N is fixed".
// Why not leave it red: a red `npm test` nobody can act on hides the next
// real failure, in every other worker's gate.
//
// Why this exists: bugs 80, 83 and 84 each left a body the kernel built and
// the status called SOLVED that was simply the wrong body. Every unit test
// passed. The oracle asks "is this the solid the drawing describes?" for every
// case here, headlessly, in seconds — and asks it again after a save/open
// round trip (bug 86's family).
//
// ORACLE_TABLE=1 prints each measure's error against its bar, the table the
// CHANGELOG carries.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { open, save } from "../src/persist.ts";
import { CASE_NAMES, derived, diag, type Expected } from "./oracle/derive.ts";
import { measure, recipeLines, replay, type Measured } from "./oracle/replay.ts";
import { loadSolver } from "./solids/scene.ts";
import { kernel, noKernel as skip } from "./solids/load.ts";

const TABLE = !!process.env.ORACLE_TABLE;

test("oracle: every committed expected.json is exactly what derive.ts gives — the number and its derivation cannot drift apart", async () => {
  for (const name of CASE_NAMES) {
    const file = JSON.parse(await readFile(new URL(`./oracle/${name}/expected.json`, import.meta.url), "utf8")) as Expected;
    assert.deepEqual(file, derived(name), `${name}: run \`node --experimental-strip-types test/oracle/derive.ts\` and commit the result`);
    assert.ok(file.derivation.length > 40, `${name}: a derivation in words`);
    if (file.known_failure) assert.match(file.known_failure, /^bug \d+: \S/, `${name}: a known failure names its bug's number`);
  }
});

test("oracle: every case has a recipe a person could retype — commands, comments, and the Cut tool's press", async () => {
  for (const name of CASE_NAMES) {
    const lines = await recipeLines(name);
    assert.ok(lines.length >= 3, `${name}: a recipe`);
    for (const l of lines) assert.match(l, /^(\w+ = )?\w+\(.*\)$/, `${name}: "${l}" is a command`);
  }
});

/** One measure's error, relative or as a share of the part's size, checked against the case's bar. */
function check(name: string, stage: string, got: Measured, want: Expected): void {
  const size = diag(want.bbox);
  const rel = (g: number, w: number) => Math.abs(g - w) / Math.abs(w);
  const rows: [string, number, number, number, number][] = [
    ["volume", got.volume, want.volume, rel(got.volume, want.volume), want.bars.volume],
    ["area", got.area, want.area, rel(got.area, want.area), want.bars.area],
    ["bbox", NaN, NaN, Math.max(...[0, 1].flatMap((k) => [0, 1, 2].map((i) => Math.abs(got.bbox[k][i] - want.bbox[k][i])))) / size, want.bars.box],
    ["centroid", NaN, NaN, Math.hypot(...[0, 1, 2].map((i) => got.centroid[i] - want.centroid[i])) / size, want.bars.centroid],
  ];
  if (TABLE) {
    for (const [what, g, w, err, bar] of rows) {
      console.log(`| ${name} | ${stage} | ${what} | ${Number.isNaN(w) ? "" : w} | ${Number.isNaN(g) ? "" : g} | ${err.toExponential(1)} | ${bar.toExponential(0)} |`);
    }
    console.log(`| ${name} | ${stage} | faces | ${want.faces ?? "—"} | ${got.faces} | | | bodies ${got.bodies}, kernel ${got.ms.toFixed(0)} ms |`);
  }
  assert.deepEqual(got.skipped, [], `${name} (${stage}): nothing left out before the kernel`);
  assert.deepEqual(got.failed, [], `${name} (${stage}): nothing the kernel refused`);
  assert.equal(got.bodies, want.bodies, `${name} (${stage}): bodies`);
  assert.ok(got.manifold && got.failures === 0, `${name} (${stage}): a valid solid (manifold ${got.manifold}, ${got.failures} failures)`);
  for (const [what, g, w, err, bar] of rows) {
    assert.ok(err <= bar, `${name} (${stage}): ${what} off by ${err.toExponential(2)} of the bar ${bar}${Number.isNaN(w) ? "" : ` — ${g} against ${w}`}\n${want.derivation}`);
  }
  if (want.faces !== undefined) assert.equal(got.faces, want.faces, `${name} (${stage}): faces`);
}

for (const name of CASE_NAMES) {
  test(`oracle: ${name}`, { skip }, async () => {
    await loadSolver();
    const k = await kernel();
    const want = derived(name);
    const lines = await recipeLines(name);
    const { model, log } = await replay(lines);
    assert.ok(model.solve().solved, `${name}: the recipe solves`);
    const built = measure(k, model);
    if (want.known_failure) {
      // Declared broken: the comparison must fail, and the day it does not,
      // the fix is in and the declaration comes out in the same change.
      assert.throws(() => check(name, "built", built, want), /off by|faces|bodies/,
        `${want.known_failure.split(":")[0]} is fixed: drop known_failure from test/oracle/${name}/expected.json (derive.ts) — the case passes now`);
      return;
    }
    check(name, "built", built, want);
    assert.ok(!log.some((l) => /refus|cannot|cuts nothing|not reach/.test(l)), `${name}: the log says nothing went wrong — ${log.join(" / ")}`);
    // And the same body after a save/open round trip: the file carries the
    // part, not only the drawing (bug 86's family has a second net here).
    const again = open(save(model));
    assert.ok(again.solve().solved, `${name}: the reopened file solves`);
    const reopened = measure(k, again);
    check(name, "reopened", reopened, want);
    assert.ok(Math.abs(reopened.volume - built.volume) <= 1e-9 * Math.abs(built.volume), `${name}: the same solid after the round trip, ${reopened.volume} against ${built.volume}`);
  });
}
