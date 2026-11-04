// A tool's source riding in a saved file, in the app, across a page reload.
//
// The reload is the point. A tool registry is session state: reopen the app
// and everything authored at the command line is gone, which is exactly the
// situation the feature exists for. So this test authors a tool, saves the
// file, reloads the page into an app that has never heard of that tool, opens
// the file, and checks what the user is told and what they have to do about
// it — the source is text until they paste it, and then it is a tool they can
// arm and draw with.
//
// The unit suite proves nothing ran; this one proves the story is legible in
// front of a person.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_ENTITIES, axisFrame, openApp, type AppContext, forgetAutosave } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

// One line, because the command input is one line. A dot tool: click, and a
// point lands where the cursor was — enough to be armed and drawn with, small
// enough to read in a screenshot.
const SPOT = 'defineTool("spot", class extends Tool { name = "spot"; '
  + "onDown(p) { pt(p.world[0], p.world[1]); this.ctx.requestSolve(); this.ctx.finish(); } });";

/** The saved file, compacted so it fits the one-line command input. */
async function savedFile(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, `save() failed: ${r.error}`);
  return JSON.stringify(JSON.parse(r.value as string));
}

async function reload(): Promise<void> {
  await forgetAutosave(app.page); // a reload here means the app's first start
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(
    () => document.getElementById("status")?.textContent?.includes("ready"),
    null,
    { timeout: 20_000 },
  );
}

test("a saved file carries a tool's source, and the paste is what enables it", async () => {
  await axisFrame(app, [0, 400]);
  await app.type(SPOT);
  assert.ok((await app.log()).includes("> " + SPOT.slice(0, 30)), "the entry is in the log as typed");

  await app.type("tools()");
  assert.ok((await app.log()).includes("spot"), "registered like any built-in");

  const file = await savedFile();
  const parsed = JSON.parse(file) as { tools?: { name: string; source: string }[] };
  assert.deepEqual(parsed.tools, [{ name: "spot", source: SPOT }], "the file carries the entry, whole");

  // A fresh session: the registry is back to the built-ins and the drawing is
  // empty. Everything from here on is what a user opening a file tomorrow sees.
  await reload();
  const fresh = await app.model();
  assert.equal(fresh.size, 0, "a reloaded app has an empty drawing");
  assert.equal((await app.repl("tools()")).value as string[] === undefined, false);
  assert.equal(((await app.repl("tools()")).value as string[]).includes("spot"), false,
    "and has never heard of the tool");

  await app.type(`open(${JSON.stringify(file)})`);
  const afterOpen = await app.log();
  assert.ok(afterOpen.includes(
    'this file carries the source of tool "spot" — toolSource("spot") shows it; paste it to enable'),
    `the log should say what the file carries:\n${afterOpen}`);
  assert.equal((await app.model()).size, FIXTURE_ENTITIES, "the geometry replayed — the fixture frame and its points");

  // Carried, and honest about not being armable yet.
  const listed = (await app.repl("tools()")).value as string[];
  assert.ok(listed.includes('spot (source only — toolSource("spot") to see it)'));
  assert.equal(listed.includes("spot"), false);
  await app.type('arm("spot")');
  assert.ok((await app.log()).includes('no tool "spot"'), "arming it now is refused");

  // What the user reads, and then types back. The text comes out of the app,
  // not out of this file: it is the file's own source making the trip.
  await app.type('toolSource("spot")');
  assert.ok((await app.log()).includes("defineTool(\"spot\", class extends Tool"), "the source is printed");
  const printed = (await app.repl('toolSource("spot")')).value as string;
  assert.equal(printed, SPOT);

  // The paste: an ordinary entry, and only now does anything run.
  await app.type(printed);
  assert.ok(((await app.repl("tools()")).value as string[]).includes("spot"), "now it is a tool");

  await app.type("spot"); // a bare tool name arms it
  assert.ok((await app.log()).includes("armed: spot"));
  const before = await app.model();
  const at = await app.at(520, 220);
  await app.page.mouse.click(at.x, at.y);
  await app.page.waitForTimeout(200);

  const after = await app.model();
  assert.equal(after.byKind.point, (before.byKind.point ?? 0) + 1, "it drew");
  assert.equal(after.activeTool, null, "and stood down");
  assert.equal(await app.status(), "SOLVED");

  // And a save from here carries it forward, re-captured from the paste.
  const again = JSON.parse((await app.repl("save()")).value as string) as { tools?: unknown };
  assert.deepEqual(again.tools, [{ name: "spot", source: SPOT }]);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
