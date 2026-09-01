// The command line, in a real page — where `document` actually exists and so
// the scoping claim can be tested rather than assumed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

test("help() reaches the whole command surface", async () => {
  await app.type("help()");
  const log = await app.log();
  for (const expected of ["defineTool", "oncircle", "fillet(line1, line2, radius)", "save()", "zoom(f)"]) {
    assert.ok(log.includes(expected), `help() should mention ${expected}`);
  }
});

test("an expression answers with its value", async () => {
  await app.type("2 + 40");
  assert.ok((await app.log()).includes("42"));
});

test("page globals are not in scope, on a page that has them", async () => {
  for (const name of ["document", "window", "fetch", "localStorage"]) {
    const r = await app.repl(name);
    assert.equal(r.ok, false, `${name} should not resolve`);
    assert.match(r.error!, new RegExp(`no such name: ${name}`));
  }
  const viaGlobal = await app.repl("globalThis.document");
  assert.equal(viaGlobal.ok, true);
  assert.equal(viaGlobal.value, undefined, "reaching through globalThis must not find the page either");
});

test("a bare assignment persists between entries", async () => {
  await app.type("kept = 4242");
  await app.type("kept + 1");
  assert.ok((await app.log()).includes("4243"));
});

test("geometry and relations build a solved model from the command line", async () => {
  await app.type('ctr = pt(0, 0); fix(ctr, [0, 0]); c = circ(ctr, 10)');
  await app.type('a = pt(-40, 30); b = pt(40, 30); fix(a, [-40, 30]); fix(b, [40, 30]); tan(ln(a, b), c)');
  await app.type("solve()");
  const m = await app.model();
  assert.equal(m.byKind.circle, 1);
  assert.ok(Math.abs(m.radii.c1 - 30) < 1e-6, `tangency should decide the radius, got ${m.radii.c1}`);
  assert.equal(await app.status(), "SOLVED");
});

test("a contradiction reports CONFLICT and names the offender", async () => {
  await app.type("rad(c, 5); solve()");
  const status = await app.status();
  assert.ok(status.startsWith("CONFLICT"), status);
  assert.ok(status.includes("rad(c1)"), status);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
