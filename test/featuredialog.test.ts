// Pick → preview → confirm, headless (docs/plans/feature-dialog.md): the
// selection model — toggling, several, cleared, a preselection carried into
// arming; the preview built from the same steps as the commit and equal to
// what the commit builds, for extrude, revolve and fillet; and a confirm
// journalling exactly what the typed calls journal.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { save } from "../src/persist.ts";
import { ToolEngine } from "../src/tools/engine.ts";
import { ExtrudeTool, extrudeSteps } from "../src/tools/extrude.ts";
import { RevolveTool, revolveSteps } from "../src/tools/revolve.ts";
import { FilletTool, filletSteps } from "../src/tools/fillet.ts";
import "../src/tools/sketch.ts";
import { RegionSelection, refind } from "../src/tools/selection.ts";
import { regionKey } from "../src/tools/region.ts";
import { callText } from "../src/tools/feature.ts";
import { previewSteps } from "../src/featurepreview.ts";
import { regionNaming } from "../src/operations.ts";
import { findLoops } from "../src/loops.ts";
import { worldToScreen, type View } from "../src/view.ts";
import type { FeatureStep, RegionHit, ToolContext } from "../src/tools/tool.ts";
import { featureHost, regionAtFor } from "./featurectx.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** Square-on from above, the kernel's +z toward the viewer. */
const ABOVE: View = { ox: 400, oy: 300, scale: 4 };

/**
 * Two rectangles side by side, level at z = 0, on a frame of their own — and a
 * line beside the first, in its plane, to revolve it about. Built by typed
 * lines, so two models built by it are the same model.
 */
async function twoRectangles(): Promise<{ m: Model; repl: Repl }> {
  const m = new Model(3);
  const repl = new Repl(neocadScope({ model: m, view: ABOVE }));
  for (const line of [
    "setDefaultFrame(frame(pt(0, 0, 0), pt(1, 0, 0), pt(0, 1, 0)))",
    "r1 = [pt(-50, -10, 0), pt(-20, -10, 0), pt(-20, 10, 0), pt(-50, 10, 0)]",
    "for (let i = 0; i < 4; i++) ln(r1[i], r1[(i + 1) % 4])",
    "r2 = [pt(20, -10, 0), pt(50, -10, 0), pt(50, 10, 0), pt(20, 10, 0)]",
    "for (let i = 0; i < 4; i++) ln(r2[i], r2[(i + 1) % 4])",
    "ln(pt(-60, -20, 0), pt(-60, 20, 0))",
  ]) {
    const r = await repl.eval(line);
    assert.equal(r.ok, true, `${line}: ${r.error?.message}`);
  }
  m.solve();
  return { m, repl };
}

/** The region under a world point, as a click there from above finds it. */
function hitAt(m: Model, world: number[]): RegionHit {
  const hit = regionAtFor(m, ABOVE)(worldToScreen(ABOVE, world));
  assert.ok(hit, `a region at ${world}`);
  return hit;
}

/** Every point's coordinates, by name. */
const points = (m: Model) => Object.fromEntries([...m.entities.values()].filter((e) => e.kind === "point")
  .map((e) => [e.name, m.coords(e.name)]));

/** The preview's copy and the committed model agree: the same entities, every point within `tol`. */
function sameGeometry(preview: Model, built: Model, tol = 1e-6): void {
  assert.deepEqual([...preview.entities.keys()].sort(), [...built.entities.keys()].sort(), "the same entities, by the same names");
  assert.deepEqual([...preview.features.keys()].sort(), [...built.features.keys()].sort(), "the same features");
  const [a, b] = [points(preview), points(built)];
  for (const name of Object.keys(b)) {
    const d = Math.hypot(...a[name].map((c, i) => c - b[name][i]));
    assert.ok(d <= tol, `${name}: previewed ${a[name]}, built ${b[name]}`);
  }
}

// --- the selection --------------------------------------------------------------

test("the selection: a click toggles a region in, several may be picked, the last one picked again is 'again', another is dropped, clear empties it", async () => {
  await loadKernel();
  const { m } = await twoRectangles();
  const a = hitAt(m, [-35, 0, 0]), b = hitAt(m, [35, 0, 0]);
  assert.notEqual(regionKey(a), regionKey(b));
  const s = new RegionSelection();
  assert.equal(s.toggle(m, a), "added");
  assert.equal(s.toggle(m, b), "added");
  assert.equal(s.size, 2, "several");
  assert.equal(s.toggle(m, hitAt(m, [36, 1, 0])), "again", "anywhere inside the last one picked is it again");
  assert.equal(s.size, 2, "and 'again' drops nothing — the caller confirms");
  assert.equal(s.toggle(m, hitAt(m, [-30, 5, 0])), "dropped", "the other one, clicked again, is dropped");
  assert.deepEqual(s.regions.map(regionKey), [regionKey(b)]);
  assert.equal(s.flip(m, b), "dropped", "a shift-click drops one, never 'again'");
  assert.equal(s.flip(m, a), "added");
  s.only(b);
  assert.deepEqual(s.regions.map(regionKey), [regionKey(b)], "a plain click: that one alone");
  assert.equal(s.clear(), true);
  assert.equal(s.clear(), false, "nothing left to clear");
});

test("a pick is found again by the point it was picked at — after a neighbour's extrude has changed the loops under it", async () => {
  await loadKernel();
  const { m, repl } = await twoRectangles();
  const b = hitAt(m, [35, 0, 0]);
  const before = regionKey(b);
  assert.equal((await repl.eval('extrude("l1", 10)')).ok, true);
  const loops = findLoops(m);
  assert.notEqual(loops.length, b.loops.length, "the extrude made new loops (walls, a lid)");
  const again = refind(m, b, loops)!;
  assert.equal(regionKey(again), before, "the same region, at a new index");
  assert.equal(refind(m, { ...b, at: [200, 200, 0] }), null, "a point in no loop finds nothing");
});

test("with nothing armed a click inside a region selects it, shift adds, empty canvas clears — and arming extrude starts from it", async () => {
  await loadKernel();
  const { m } = await twoRectangles();
  const handlers: Record<string, (e: unknown) => void> = {};
  const canvas = {
    addEventListener: (k: string, f: (e: unknown) => void) => { handlers[k] = f; },
    getContext: () => ({}),
    getBoundingClientRect: () => ({ left: 0, top: 0, x: 0, y: 0, width: 800, height: 600 }),
    setPointerCapture() {}, releasePointerCapture() {},
  } as unknown as HTMLCanvasElement;
  const picked: string[] = [];
  const e = new ToolEngine(m, canvas, { ...ABOVE }, {
    onSolveRender: () => {}, onRenderOnly: () => {}, onPick: (p) => picked.push(p.name),
  });
  const click = (world: number[], shiftKey = false) => {
    const [clientX, clientY] = worldToScreen(ABOVE, world);
    const base = { clientX, clientY, pointerId: 1, shiftKey, preventDefault() {} };
    handlers.pointerdown({ ...base, button: 0, buttons: 1 });
    handlers.pointerup({ ...base, button: 0, buttons: 0 });
  };
  click([-35, 0, 0]);
  assert.equal(e.selected.size, 1, "a click inside a region selects it");
  assert.deepEqual(picked, [], "and picks no entity");
  click([35, 0, 0]);
  assert.equal(e.selected.size, 1, "a plain click: that one instead");
  click([-35, 0, 0], true);
  assert.equal(e.selected.size, 2, "shift adds");
  click([0, 40, 0]);
  assert.equal(e.selected.size, 0, "empty canvas clears");
  click([-20, 0, 0]);
  assert.deepEqual(picked, [], "a click on an edge with no command being written inserts nothing");
  assert.deepEqual(e.selection.names, ["l2"], "it selects the edge");
  assert.equal(e.selected.size, 0, "and no region");
  click([0, 40, 0]);

  click([-35, 0, 0]);
  click([35, 0, 0], true);
  e.arm("extrude");
  const tool = e.active as ExtrudeTool;
  assert.equal(tool.picks.size, 2, "arming extrude starts from the selection");
  assert.equal(e.selected.size, 0, "which is spent once taken");
  assert.deepEqual(e.dialog(), { ready: true }, "✓ would build");

  // Arming the same tool with a new depth keeps the picks; Escape drops them, and the tool stays.
  e.arm("extrude", { depth: 25 });
  assert.equal(e.active, tool, "the same tool, retuned");
  assert.equal(tool.picks.size, 2);
  assert.equal(tool.ctx.options.depth, 25);
  e.trial("depth", 0);
  assert.deepEqual(tool.ctx.trial, {}, "a trial the declaration refuses is not taken");
  e.trial("depth", 30);
  assert.deepEqual(tool.ctx.trial, { depth: 30 });
  assert.equal(e.escape(), "cleared");
  assert.equal(e.active, tool, "still armed");
  assert.equal(tool.picks.size, 0);
  assert.equal(e.escape(), "cancelled", "a second Escape releases it");
  assert.equal(e.active, null);
});

test("sketch armed with a face preselected sketches on it at once — typing the plane, as a click would", async () => {
  await loadKernel();
  const { m } = await twoRectangles();
  const typed: string[] = [];
  const e = new ToolEngine(m, { addEventListener() {}, getContext: () => ({}) } as unknown as HTMLCanvasElement, { ...ABOVE }, {
    onSolveRender: () => {}, onRenderOnly: () => {}, onRun: (c) => { typed.push(c); },
  });
  e.selected.only(hitAt(m, [35, 0, 0]));
  e.arm("sketch");
  assert.deepEqual(typed, [], "not inside the line that armed it");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(typed.length, 1);
  assert.match(typed[0], /^plane\("p\d+", "p\d+", "p\d+"\)$/);
  assert.equal(e.active, null, "and the sketch tool is done");
});

// --- the commit is typed --------------------------------------------------------

test("the line a region is named by: the shortest typed call that finds that very loop", async () => {
  await loadKernel();
  const { m, repl } = await twoRectangles();
  const loops = findLoops(m);
  const b = hitAt(m, [35, 0, 0]);
  assert.deepEqual(regionNaming(m, loops, b.index), { member: "l5", frame: null, loops: null });
  // Once extruded, the base's edges are walls' too: the frame narrows it.
  assert.equal((await repl.eval('extrude("l5", 10)')).ok, true);
  const after = findLoops(m);
  const base = refind(m, b, after)!;
  const n = regionNaming(m, after, base.index)!;
  assert.equal(n.frame, "f1", `narrowed by its frame: ${JSON.stringify(n)}`);
  assert.equal(callText("extrude", [n.member, 5, n.frame]), `extrude("${n.member}", 5, "f1")`);
});

test("a confirm journals exactly what the typed lines journal: two regions, two extrudes, one user action", async () => {
  await loadKernel();
  const tool = await twoRectangles();
  const typedByHand = await twoRectangles();
  const host = featureHost(tool.m, tool.repl, ABOVE);
  const ctx = {
    model: tool.m, options: { depth: 15 }, requestRender() {}, requestSolve() {}, finish() {},
    regionAt: regionAtFor(tool.m, ABOVE), perform: host.perform,
  } as unknown as ToolContext;
  const t = new ExtrudeTool(ctx);
  for (const x of [-35, 35]) t.onDown({ world: [x, 0, 0], screen: worldToScreen(ABOVE, [x, 0, 0]) });
  assert.equal(tool.m.features.size, 0, "picking builds nothing");
  t.confirm();
  await host.settled();
  assert.deepEqual(host.typed, ['extrude("l1", 15)', 'extrude("l5", 15)']);
  assert.equal(host.performs, 1);
  for (const line of host.typed) assert.equal((await typedByHand.repl.eval(line)).ok, true);
  assert.deepEqual(tool.m.journal, typedByHand.m.journal, "the same journal as the lines typed by hand");
  assert.equal(save(tool.m, false), save(typedByHand.m, false));
});

// --- the preview is the commit ----------------------------------------------------

/** Previews `steps` on one model, commits the same steps on its twin, and compares. */
async function previewEqualsCommit(steps: (m: Model) => FeatureStep[], build = twoRectangles): Promise<Model> {
  const a = await build(), b = await build();
  const p = await previewSteps(a.m, ABOVE, steps(a.m));
  assert.equal(p.error, null, `previewed: ${p.error}`);
  const host = featureHost(b.m, b.repl, ABOVE);
  assert.equal(await host.perform(steps(b.m)), true, `committed: ${host.refused}`);
  sameGeometry(p.model!, b.m);
  assert.deepEqual([...a.m.features.keys()], [], "and the model previewed is untouched");
  return p.model!;
}

test("extrude: the preview is the committed geometry, both regions, within a millionth", async () => {
  await loadKernel();
  const preview = await previewEqualsCommit((m) => [hitAt(m, [-35, 0, 0]), hitAt(m, [35, 0, 0])]
    .flatMap((r) => extrudeSteps(r, 25, true)));
  assert.equal(preview.features.size, 2);
});

test("revolve: the preview is the committed geometry, about the line beside it, a half turn", async () => {
  await loadKernel();
  const preview = await previewEqualsCommit((m) => revolveSteps(hitAt(m, [-35, 0, 0]), "l9", Math.PI, true));
  assert.equal(preview.features.size, 1);
});

test("fillet: the preview is the committed geometry — the arc and the trimmed legs", async () => {
  await loadKernel();
  const preview = await previewEqualsCommit(() => filletSteps("l5", "l6", 4, [0, 0, 1], true));
  assert.equal([...preview.entities.values()].filter((e) => e.kind === "arc").length, 1);
});

test("a frameless sketch: the preview types the plane too, and still equals the commit", async () => {
  await loadKernel();
  const frameless = async () => {
    const m = new Model(3);
    const repl = new Repl(neocadScope({ model: m, view: ABOVE }));
    await repl.eval("r = [pt(0, 0, 0), pt(30, 0, 0), pt(30, 20, 0), pt(0, 20, 0)]");
    await repl.eval("for (let i = 0; i < 4; i++) ln(r[i], r[(i + 1) % 4])");
    return { m, repl };
  };
  const preview = await previewEqualsCommit((m) => extrudeSteps(hitAt(m, [10, 10, 0]), 8, true), frameless);
  assert.equal(preview.defaultFrame, "f1", "the plane made in the copy");
});

test("a refused step previews nothing and says why", async () => {
  await loadKernel();
  const { m } = await twoRectangles();
  const p = await previewSteps(m, ABOVE, filletSteps("l5", "l6", 500, [0, 0, 1], true));
  assert.equal(p.model, null);
  assert.match(p.error!, /too large/);
});

test("the revolve and fillet tools say ✓ only once the picks are enough", async () => {
  await loadKernel();
  const { m } = await twoRectangles();
  const ctx = (): ToolContext => ({
    model: m, options: {}, requestRender() {}, requestSolve() {}, finish() {},
    regionAt: regionAtFor(m, ABOVE), pick: () => null,
  } as unknown as ToolContext);
  const r = new RevolveTool(ctx());
  assert.deepEqual(r.dialog(), { ready: false });
  r.onDown({ world: [-35, 0, 0], screen: worldToScreen(ABOVE, [-35, 0, 0]) });
  assert.deepEqual(r.dialog(), { ready: false }, "a region and no axis");
  const f = new FilletTool(ctx());
  assert.deepEqual(f.dialog(), { ready: false });
});
