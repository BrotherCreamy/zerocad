import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { getToolCtor, type ToolContext } from "../src/tools/tool.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/**
 * A REPL over a fresh model. `framed` adds the fixture frame that `fix` and
 * are relative to now — as a model call rather than a typed `frame()`, so the
 * auto-names the entries below assert against (`p1`, `l1`) still come out
 * where they always did. `frame()` as a typed command has its own test.
 */
function makeRepl(model = new Model(2), framed = true) {
  if (framed && model.dim === 2 && !model.defaultFrame) axisFrame(model);
  const armed: string[] = [];
  const view = { ox: 0, oy: 0, scale: 3 };
  const repl = new Repl(neocadScope({
    model,
    arm: (n) => { armed.push(n); },
    view,
    refresh: () => {},
  }));
  return { repl, model, armed, view };
}

async function run(repl: Repl, src: string) {
  const r = await repl.eval(src);
  assert.equal(r.ok, true, `entry failed: ${r.error?.message}`);
  return r;
}

// --- the evaluator itself --------------------------------------------------

test("an entry that is one expression answers with its value", async () => {
  const { repl } = makeRepl();
  assert.equal((await run(repl, "2 + 2")).value, 4);
  assert.equal((await run(repl, "Math.max(3, 9)")).value, 9);
});

test("an entry that is statements runs, and can still answer via a trailing expression", async () => {
  const { repl } = makeRepl();
  await run(repl, "counter = 0; for (let i = 0; i < 5; i++) counter += i;");
  assert.equal((await run(repl, "counter")).value, 10);
});

test("an unknown name gets a clear error instead of undefined", async () => {
  const { repl } = makeRepl();
  const r = await repl.eval("modle");
  assert.equal(r.ok, false);
  assert.match(r.error!.message, /no such name: modle/);
});

test("page globals are not in scope — the curated surface is the whole surface", async () => {
  const { repl } = makeRepl();
  for (const name of ["document", "window", "fetch", "localStorage", "setTimeout", "process"]) {
    const r = await repl.eval(name);
    assert.equal(r.ok, false, `${name} should not resolve`);
    assert.match(r.error!.message, new RegExp(`no such name: ${name}`));
  }
});

test("globalThis resolves to the curated scope, not the page", async () => {
  const { repl } = makeRepl();
  const r = await run(repl, "typeof globalThis.model");
  assert.equal(r.value, "object");
  const escaped = await repl.eval("globalThis.document");
  assert.equal(escaped.ok, true);
  assert.equal(escaped.value, undefined, "reaching through globalThis must not find the page");
});

test("a bare assignment persists between entries; a declaration does not", async () => {
  const { repl } = makeRepl();
  await run(repl, "kept = 41 + 1");
  assert.equal((await run(repl, "kept")).value, 42);

  await run(repl, "const gone = 1;");
  const r = await repl.eval("gone");
  assert.equal(r.ok, false);
  assert.match(r.error!.message, /no such name: gone/);
});

test("console output is captured rather than lost to the host console", async () => {
  const { repl } = makeRepl();
  const r = await run(repl, "console.log('hello', 1 + 1); console.warn('careful')");
  assert.deepEqual(r.output, ["hello 2", "warn: careful"]);
});

test("await works at the top level of an entry", async () => {
  const { repl } = makeRepl();
  const r = await run(repl, "await Promise.resolve(7) * 2");
  assert.equal(r.value, 14);
});

test("a syntax error is reported, not thrown at the caller", async () => {
  const { repl } = makeRepl();
  const r = await repl.eval("function (");
  assert.equal(r.ok, false);
  assert.ok(r.error instanceof Error);
});

// --- the command surface ---------------------------------------------------

test("geometry commands build real entities", async () => {
  const { repl, model } = makeRepl();
  const a = (await run(repl, "pt(0, 0)")).value;
  const b = (await run(repl, "pt(3, 4)")).value;
  await run(repl, `ln("${a}", "${b}")`);
  assert.equal(model.entities.size, 3 + 3, "two points, a line, and the fixture frame's three");
  assert.deepEqual(model.coords(String(b)), [3, 4]);
});

test("relations are curried against the model, and solve through the REPL", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, 'a = pt(0, 0); b = pt(3, 4); fix(a, [0, 0]); dist(a, b, 10);');
  const report = (await run(repl, "solve()")).value as { solved: boolean };
  assert.equal(report.solved, true);
  assert.ok(Math.abs(Math.hypot(...model.coords("p2")) - 10) < 1e-6);
});

test("circles and tangency are reachable from the command line", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, `
    c = circ(pt(0, 0), 1);
    fix("p1", [0, 0]);
    a = pt(-10, 8); b = pt(10, 8);
    fix(a, [-10, 8]); fix(b, [10, 8]);
    tan(ln(a, b), c);
  `);
  assert.equal(((await run(repl, "solve()")).value as { solved: boolean }).solved, true);
  assert.ok(Math.abs(model.radius("c1") - 8) < 1e-6, `radius = ${model.radius("c1")}`);
});

test("viewport control is an ordinary command", async () => {
  const { repl, view, armed } = makeRepl();
  await run(repl, "zoom(2)");
  assert.equal(view.scale, 6);
  await run(repl, "pan(10, -5)");
  assert.deepEqual([view.ox, view.oy], [10, -5]);
  await run(repl, 'arm("point")');
  assert.deepEqual(armed, ["point"]);
});

test("view() reports and switches how solids are shown through the host, refuses a mode that is not one, and the camera is camera", async () => {
  const model = new Model(2);
  axisFrame(model);
  let mode = "shaded";
  const view = { ox: 0, oy: 0, scale: 3 };
  const repl = new Repl(neocadScope({
    model,
    view,
    viewMode: (m?: string) => {
      if (m === undefined) return mode;
      if (!["shaded", "hidden", "wire"].includes(m)) throw new Error(`view() takes "shaded", "hidden", "wire" — not ${m}`);
      return (mode = m);
    },
  }));
  assert.equal((await run(repl, "view()")).value, "shaded");
  assert.equal((await run(repl, 'view("wire")')).value, "wire");
  assert.equal(mode, "wire");
  const bad = await repl.eval('view("glass")');
  assert.equal(bad.ok, false);
  assert.match(bad.error!.message, /"shaded", "hidden", "wire"/);
  assert.equal(mode, "wire", "a refusal changes nothing");
  assert.equal(model.journal.some((j) => /view/i.test(j.op)), false, "never journalled");
  assert.equal((await run(repl, "camera.scale")).value, 3, "the camera object, under its own name");
  const none = await new Repl(neocadScope({ model })).eval('view("wire")');
  assert.equal(none.ok, false);
  assert.match(none.error!.message, /no viewport/);
});

test("solve() goes through the host's solve path, so the viewport cannot go stale", async () => {
  await loadKernel();
  const model = new Model(2);
  axisFrame(model);
  let hostSolves = 0;
  const repl = new Repl(neocadScope({
    model,
    solve: () => { hostSolves++; return model.solve(); },
  }));
  await run(repl, 'a = pt(0, 0); fix(a, [0, 0]);');
  const report = (await run(repl, "solve()")).value as { solved: boolean };
  assert.equal(hostSolves, 1, "the host solve path must be the one that runs");
  assert.equal(report.solved, true, "and its report is what the caller gets back");
});

test("solve() still works with no host attached", async () => {
  await loadKernel();
  const { repl } = makeRepl();
  await run(repl, 'fix(pt(0, 0), [0, 0]);');
  assert.equal(((await run(repl, "solve()")).value as { solved: boolean }).solved, true);
});

test("frames are reachable from the command line, and an axis reference needs one", async () => {
  await loadKernel();
  // Deliberately unframed: a new model has no coordinate frame at all, and
  // this checks the command surface says so rather than quietly picking one.
  const { repl, model } = makeRepl(new Model(2), false);
  await run(repl, "l = ln()");
  const bare = await repl.eval("par(l, xaxis())");
  assert.equal(bare.ok, false);
  assert.match(bare.error!.message, /no default frame — frame\(\) then setDefaultFrame\(\)/);
  assert.equal((await run(repl, "defaultFrame()")).value, null);

  // `hor` and `ver` are gone rather than deprecated, so the standing
  // unknown-name message is what a hand reaching for them now gets.
  const gone = await repl.eval("hor(l)");
  assert.equal(gone.ok, false);
  assert.match(gone.error!.message, /no such name: hor/);
  assert.match((await repl.eval("ver(l)")).error!.message, /no such name: ver/);

  assert.equal((await run(repl, "frame()")).value, "f1", "the constructor hands back its name");
  assert.equal((await run(repl, 'setDefaultFrame("f1")')).value, "f1");
  assert.equal((await run(repl, "defaultFrame()")).value, "f1");
  // The helpers resolve the default *at call time* and bake the answer into
  // the reference, so the entry names a frame rather than a pointer.
  assert.equal((await run(repl, "yaxis()")).value, "f1.y");
  assert.equal((await run(repl, 'xaxis("f1")')).value, "f1.x");
  await run(repl, "par(l, xaxis())");
  assert.deepEqual(model.relations.get("r1")!.args, ["l1", "f1.x"], "and the entry names it");
  assert.match(String((await run(repl, "help()")).value), /setDefaultFrame\(name\)/);
});

test("ls() and help() describe what is there", async () => {
  const { repl } = makeRepl();
  await run(repl, "pt(1, 2)");
  const listing = (await run(repl, "ls()")).value as string[];
  assert.equal(listing.length, 4, "the point, and the fixture frame with its two");
  assert.match(listing.at(-1)!, /p1\s+point\s+\(1\.000, 2\.000\)/);
  assert.match(listing[2], /f\s+frame\s+origin f_o, \+x toward f_x\s+\(default\)/);
  assert.match(String((await run(repl, "help()")).value), /defineTool/);
});

// --- the acceptance test the whole project was pointed at ------------------

test("a tool authored at the REPL registers and drives like a built-in", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();

  // Exactly what a user would type: a class, and one registration call.
  // Nothing here is a built-in's privilege — same Tool, same defineTool.
  await run(repl, `
    defineTool("replbox", class extends Tool {
      name = "replbox";
      onDown(p) { this.start = p.world; this.current = p.world; this.ctx.requestRender(); }
      onMove(p) { if (this.start) { this.current = p.world; this.ctx.requestRender(); } }
      onUp(p) {
        if (!this.start) return;
        const [x0, y0] = this.start, [x1, y1] = p.world;
        this.start = null;
        const a = pt(x0, y0), b = pt(x1, y0), c = pt(x1, y1), d = pt(x0, y1);
        ln(a, b); ln(b, c); ln(c, d); ln(d, a);
        par(a, b, xaxis()); par(d, c, xaxis()); par(a, d, yaxis()); par(b, c, yaxis());
        this.ctx.requestSolve();
        this.ctx.finish();
      }
    });
  `);

  // It is in the same registry the engine arms from.
  assert.ok((((await run(repl, "tools()")).value) as string[]).includes("replbox"));

  const Ctor = getToolCtor("replbox");
  assert.ok(Ctor, "the REPL-defined tool should be retrievable from the registry");

  let finished = false, solves = 0, renders = 0;
  const ctx: ToolContext = {
    model,
    options: {},
    requestRender: () => { renders++; },
    requestSolve: () => { solves++; model.solve(); },
    finish: () => { finished = true; },
  };
  const tool = new Ctor(ctx);

  tool.onDown({ world: [0, 0], screen: [0, 0] });
  tool.onMove({ world: [40, 20], screen: [0, 0] });
  assert.equal(model.entities.size, 3, "mid-drag nothing is committed — only the fixture frame is there");
  assert.ok(renders >= 2);

  tool.onUp({ world: [40, 20], screen: [0, 0] });

  const points = [...model.entities.values()]
    .filter((e) => e.kind === "point" && !e.name.startsWith("f_"));
  const lines = [...model.entities.values()].filter((e) => e.kind === "line");
  assert.equal(points.length, 4, "four corners");
  assert.equal(lines.length, 4, "four edges");
  assert.equal(solves, 1);
  assert.equal(finished, true, "the gesture completed and the tool stood down");

  const xs = points.map((p) => model.coords(p.name)[0]).sort((a, b) => a - b);
  const ys = points.map((p) => model.coords(p.name)[1]).sort((a, b) => a - b);
  assert.ok(Math.abs(xs[0] - 0) < 1e-6 && Math.abs(xs[3] - 40) < 1e-6, `xs = ${xs}`);
  assert.ok(Math.abs(ys[0] - 0) < 1e-6 && Math.abs(ys[3] - 20) < 1e-6, `ys = ${ys}`);
});

test("a relation authored at the REPL is a residual like any other", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  // A user-written relation, straight against the kernel: keep a point on
  // the parabola y = x^2. Nothing in relations/ knows this exists.
  await run(repl, `
    onParabola = (name) => {
      const p = model.point(name);
      model.problem.addResidual(p.varIndices, (l) => [l[1].sub(l[0].mul(l[0]))], "parabola(" + name + ")");
    };
    q = pt(3, 0);
    fixX = (name, x) => model.problem.addResidual([model.point(name).varIndices[0]], (l) => [l[0].sub(x)], "fixX");
    fixX(q, 3);
    onParabola(q);
  `);
  assert.equal(((await run(repl, "solve()")).value as { solved: boolean }).solved, true);
  const [qx, qy] = model.coords("p1");
  assert.ok(Math.abs(qx - 3) < 1e-6 && Math.abs(qy - 9) < 1e-6, `expected (3, 9), got (${qx}, ${qy})`);
});

// --- listing and deleting constraints --------------------------------------

test("rels() lists the constraints under names you can retype", async () => {
  await loadKernel();
  const { repl } = makeRepl();
  await run(repl, `a = pt(0, 0); b = pt(10, 0); l = ln(a, b); coin(a, b); par(l, xaxis()); dist(a, b, 10)`);

  // The short name each relation is called by, not the internal op — so a
  // listed line reads back as something that could have been typed. The axis
  // reference reads back verbatim: `par("l1", "f.x")` is a line you could type.
  //
  // The `dist` reads `d1`, which is the listing's half of the dimension split:
  // scanning `rels()` for something to `set` means looking for a `d`.
  assert.deepEqual((await run(repl, "rels()")).value, [
    "r1  coin p1 p2",
    "r2  par l1 f.x",
    "d1  dist p1 p2 10",
  ]);
  assert.deepEqual((await run(repl, 'rels("l1")')).value, ["r2  par l1 f.x"]);
  assert.deepEqual((await run(repl, 'rels("p2")')).value, ["r1  coin p1 p2", "d1  dist p1 p2 10"]);
  assert.deepEqual((await run(repl, 'rels("nothing")')).value, []);
});

test("del() hands back what it took, so the log answers for the cascade", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, `a = pt(0, 0); b = pt(10, 0); l = ln(a, b); par(l, xaxis()); fix(a, [0, 0])`);

  assert.deepEqual((await run(repl, 'del("r1")')).value, ["r1"], "a relation takes nothing with it");
  assert.deepEqual((await run(repl, 'del("p1")')).value, ["r2", "l1", "p1"], "a point takes what needs it");
  assert.deepEqual([...model.entities.keys()], ["f_o", "f_x", "f", "p2"]);

  const bad = await repl.eval('del("l9")');
  assert.equal(bad.ok, false);
  assert.match(bad.error!.message, /"l9" is not an entity or a relation/);
});

test("del and rels are on the help card, since neither is guessable", async () => {
  const { repl } = makeRepl();
  const help = (await run(repl, "help()")).value as string;
  assert.match(help, /del\(name, \.\.\.\)/);
  assert.match(help, /rels\(name\?\)/);
});
