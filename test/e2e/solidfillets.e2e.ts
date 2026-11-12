// Fillets and chamfers of a body's edges, in a browser (docs/plans/solid-fillets.md):
// the owner's "please add solid and surface fillet tools". A plate drawn and
// extruded; an edge hovered (its name in the tag), clicked with the round tool
// armed, previewed by the kernel and confirmed — a feature in the body's chain,
// its radius a dimension; the radius dragged on the drawing; undo; a kernel
// edge hovered, clicked and boxed with nothing armed; save and open; STEP
// exported and read back; a chamfer the same. Every step looked at: set
// NEOCAD_E2E_SHOTS to a directory to keep the screenshots.
//
// What only the assembled app can say: that a body of one extrude has kernel
// edges to pick once the tool is armed (the Worker starts for it); that the
// preview is the kernel's body, shaded across the blend, standing in for the
// body until ✓; that the label on the drawing drags the radius; that ✓ types
// the line. Skips, saying so, without a kernel build.
//
// One app, tests in order: the states are cumulative.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext, confirmAndRelease } from "./harness.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
const skip = built ? false : "no SMLib build — run `npm run build:solids`";

let app: AppContext;
before(async () => { if (built) app = await openApp(); });
after(async () => { if (built) await app.close(); });

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(name: string, keepMouse = false): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  if (!keepMouse) await app.page.mouse.move(2, 2);
  await app.page.waitForTimeout(150);
  await app.page.screenshot({ path: join(SHOTS, `fillets-desktop-${name}.png`) });
}

async function leftDrag(a: [number, number], b: [number, number]): Promise<void> {
  const p = await app.at(...a), q = await app.at(...b);
  await app.page.mouse.move(p.x, p.y);
  await app.page.mouse.down();
  await app.page.mouse.move(q.x, q.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function clickAt(sx: number, sy: number, shift = false): Promise<void> {
  const at = await app.at(sx, sy);
  if (shift) await app.page.keyboard.down("Shift");
  await app.page.mouse.click(at.x, at.y);
  if (shift) await app.page.keyboard.up("Shift");
  await app.page.waitForTimeout(220);
}

async function hoverAt(sx: number, sy: number): Promise<void> {
  const at = await app.at(sx, sy);
  await app.page.mouse.move(at.x - 3, at.y - 3);
  await app.page.mouse.move(at.x, at.y, { steps: 3 });
  await app.page.waitForTimeout(200);
}

async function key(combo: string): Promise<void> {
  await app.page.fill("#cmd", "");
  await app.page.keyboard.press(combo);
  await app.page.waitForTimeout(250);
}

type Neo = {
  __neocad: {
    bodies: {
      settled: boolean;
      views(): { name: string; features: string[]; result: { solid: { volume: number; validity: { manifold: boolean; failures: number };
        faces: { name: string }[]; edges: { name: string }[] } } }[];
      madeViews(): { name: string; result: { solid: { volume: number; faces: { name: string }[] } } }[];
      trialAnswer(): { settled: boolean; why: string | null };
      report(): { lines: string[] };
    };
    model: { blends: Map<string, { name: string; kind: string; edges: string[]; size: string; into: string }> };
    engine: { hover: { name: string; kind: string; tag?: string } | null; selection: { edges: readonly string[] };
      active: { name: string; handle?: { at: [number, number] } } | null };
  };
};

/** The kernel's view of the bodies once it has answered for the model as it is. */
async function settled(): Promise<{ name: string; features: string[]; volume: number; valid: boolean; faces: string[]; edges: string[] }[]> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.settled, undefined, { timeout: 30_000 });
  return app.page.evaluate(() => (window as never as Neo).__neocad.bodies.views().map((v) => ({
    name: v.name, features: v.features, volume: v.result.solid.volume,
    valid: v.result.solid.validity.manifold && v.result.solid.validity.failures === 0,
    faces: [...new Set(v.result.solid.faces.map((f) => f.name))].sort(),
    edges: [...new Set(v.result.solid.edges.map((e) => e.name))].sort(),
  })));
}

/** The preview's answer: settled, and the kernel's refusal if it refused. */
async function previewed(): Promise<{ settled: boolean; why: string | null; volume: number | null }> {
  await app.page.waitForFunction(() => (window as never as Neo).__neocad.bodies.trialAnswer().settled, undefined, { timeout: 30_000 });
  await app.page.waitForTimeout(100);
  return app.page.evaluate(() => {
    const b = (window as never as Neo).__neocad.bodies;
    return { ...b.trialAnswer(), volume: b.views()[0]?.result.solid.volume ?? null };
  });
}

const blends = () => app.page.evaluate(() =>
  [...(window as never as Neo).__neocad.model.blends.values()].map((b) => ({ name: b.name, kind: b.kind, edges: b.edges, size: b.size, into: b.into })));

const hover = () => app.page.evaluate(() => {
  const h = (window as never as Neo).__neocad.engine.hover;
  return h ? { name: h.name, kind: h.kind, tag: h.tag ?? null } : null;
});

async function saved(): Promise<string> {
  const r = await app.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

// The plate: 80 × 50, 10 deep.
const W = 40, H = 25, T = 10, R = 3;
const plateVolume = 2 * W * 2 * H * T;
/** A filleted straight edge of length L removes (4 − π)/4 · r² · L. */
const filletCut = (r: number, len: number) => ((4 - Math.PI) / 4) * r * r * len;
/**
 * The plate's front edge on its lid (y = −H, z = T), its middle — and the
 * right one (x = W), off its middle: the rectangle's relations have their
 * twins on the lid now (docs/plans/linked-profiles.md), and a twin's mark
 * sits at the middle of the lid's right edge, where it would win the pick.
 */
const FRONT: [number, number, number] = [0, -H, T];
const RIGHT: [number, number, number] = [W, H * 0.45, T];
const BACK: [number, number, number] = [0, H, T];
const LEFT: [number, number, number] = [-W, H * 0.6, T];

test("a plate, extruded, and the round tool armed: the kernel builds the one-extrude body so its edges have names", { skip }, async () => {
  await app.type("plane()");
  await app.type("rectangle");
  await leftDrag(await app.screenOf([-W, -H, 0]), await app.screenOf([W, H, 0]));
  await app.type(`arm("extrude", { depth: ${T} })`);
  await clickAt(...await app.screenOf([0, 0, 0]));
  await confirmAndRelease(app);
  await app.type("orbit(-0.6, -1.0); zoom(1.6)");
  assert.deepEqual(await settled(), [], "a body of one feature is faces.ts's: nothing sent to the kernel");
  await app.type(`arm("round", { radius: ${R} })`);
  const s = await settled();
  assert.equal(s.length, 1, "armed, the kernel builds it");
  assert.ok(Math.abs(s[0].volume - plateVolume) < 1e-6);
  assert.ok(s[0].edges.includes("e1.lid|e1.m0"), `the lid's edges are named by their faces: ${s[0].edges}`);
});

let front = "";
test("an edge clicked: the kernel's preview, rounded and shaded, then ✓ — a fillet in the chain, its radius a dimension", { skip }, async () => {
  await hoverAt(...await app.screenOf(FRONT));
  await shot("1-edge-under-the-cursor", true);
  await clickAt(...await app.screenOf(FRONT));
  const p = await previewed();
  assert.equal(p.why, null);
  assert.ok(p.volume !== null && Math.abs(p.volume - (plateVolume - filletCut(R, 2 * W))) < 1e-3, `preview volume ${p.volume}`);
  assert.match((await app.page.textContent("#mode")) ?? "", /✓ to fillet/);
  await shot("2-preview");
  await confirmAndRelease(app);
  const b = await blends();
  assert.equal(b.length, 1);
  assert.equal(b[0].name, "e2");
  assert.equal(b[0].into, "e1");
  assert.equal(b[0].edges.length, 1);
  front = b[0].edges[0];
  assert.match(front, /^e1\.lid\|e1\.m\d$/);
  const s = await settled();
  assert.equal(s.length, 1);
  assert.deepEqual(s[0].features, ["e1"]);
  assert.ok(s[0].valid);
  assert.ok(Math.abs(s[0].volume - (plateVolume - filletCut(R, 2 * W))) < 1e-3, `volume ${s[0].volume}`);
  assert.ok(s[0].faces.includes("e2.f0"), `the fillet's face is named after its edge: ${s[0].faces}`);
  const log = (await app.page.textContent("#log")) ?? "";
  assert.ok(log.includes(`fillet("e1", ["${front}"], ${R})`), "the confirm typed the call");
  const rels = (await app.repl("rels()")).value as string[];
  assert.ok(rels.some((l) => l.startsWith(`${b[0].size}  filletRadius ${R}`)), `the radius is a dimension: ${rels.join(" / ")}`);
  await shot("3-filleted");
});

test("the radius dragged on the drawing (Edit e2): the preview follows; ✓ sets the dimension; one undo puts it back", { skip }, async () => {
  const before = await saved();
  await app.type('edit("e2")');
  await previewed();
  const handle = await app.page.evaluate(() => (window as never as Neo).__neocad.engine.active?.handle?.at ?? null);
  assert.ok(handle, "the radius label is on the drawing");
  const from = await app.at(handle[0], handle[1]);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(from.x + 20, from.y - 30, { steps: 6 });
  await app.page.waitForTimeout(400);
  const mid = await previewed();
  assert.equal(mid.why, null);
  assert.ok(mid.volume !== null && mid.volume < plateVolume - filletCut(R, 2 * W) - 1, `held, the preview is a bigger fillet: ${mid.volume}`);
  await shot("4-radius-dragged", true);
  await app.page.mouse.up();
  await app.page.waitForTimeout(400);
  const r = (await app.repl("model.relationOf(model.blendOf('e2').size).args[0]")).value as number;
  assert.equal(r, R, "nothing is set before ✓ — the drag is the dialog's");
  await confirmAndRelease(app);
  const now = (await app.repl("model.relationOf(model.blendOf('e2').size).args[0]")).value as number;
  assert.ok(now > R, `the dimension holds the dragged radius: ${now}`);
  const log = (await app.page.textContent("#log")) ?? "";
  assert.match(log, /set\("d\d+\.value", [\d.]+\)/, "✓ typed the set");
  const s = await settled();
  assert.ok(Math.abs(s[0].volume - (plateVolume - filletCut(now, 2 * W))) < 1e-3, `volume ${s[0].volume} at radius ${now}`);
  await key("Control+z");
  assert.equal(await saved(), before, "one undo takes the radius back");
  const back = await settled();
  assert.ok(Math.abs(back[0].volume - (plateVolume - filletCut(R, 2 * W))) < 1e-3);
});

test("nothing armed: a kernel edge hovers with its name, a click selects it, shift adds one, a box catches them", { skip }, async () => {
  await key("Escape");
  await hoverAt(...await app.screenOf(RIGHT));
  const h = await hover();
  assert.equal(h?.kind, "edge", `the edge is the pick: ${JSON.stringify(h)}`);
  // 50 less the 3 the front fillet took from its end.
  assert.match(h!.tag ?? "", /^e1\.lid\|e1\.m\d  edge of e1  len 47/);
  await shot("5-hover-names-the-edge", true);
  // Its menu: the hover's line, and Fillet… / Chamfer…, each typing the call up to its size.
  const at = await app.at(...await app.screenOf(RIGHT));
  await app.page.mouse.move(at.x, at.y);
  await app.page.mouse.down({ button: "right" });
  await app.page.mouse.up({ button: "right" });
  await app.page.waitForTimeout(150);
  const menu = await app.page.$eval("#ctxmenu", (el) => ({
    open: !(el as HTMLElement).hidden,
    head: el.querySelector(".head")?.textContent ?? "",
    items: Array.from(el.querySelectorAll(".item")).map((i) => i.firstElementChild?.textContent ?? ""),
  }));
  assert.ok(menu.open, "a right-click on an edge opens its menu");
  assert.match(menu.head, /^e1\.lid\|e1\.m\d  edge of e1/);
  assert.deepEqual(menu.items.slice(0, 2), ["Fillet…", "Chamfer…"]);
  await app.page.keyboard.press("Escape");
  await app.page.waitForTimeout(150);
  await clickAt(...await app.screenOf(RIGHT));
  let sel = await app.page.evaluate(() => [...(window as never as Neo).__neocad.engine.selection.edges]);
  assert.deepEqual(sel, [h!.name]);
  await clickAt(...await app.screenOf(LEFT), true);
  sel = await app.page.evaluate(() => [...(window as never as Neo).__neocad.engine.selection.edges]);
  assert.equal(sel.length, 2, `shift adds: ${sel}`);
  await shot("6-two-edges-selected");
  await key("Escape");
  // A window round the whole plate catches every edge it can see.
  const a = await app.screenOf([-W - 15, -H - 15, 0]);
  const b = await app.screenOf([W + 15, H + 15, T]);
  const [x0, x1] = [Math.min(a[0], b[0]) - 40, Math.max(a[0], b[0]) + 40];
  const [y0, y1] = [Math.min(a[1], b[1]) - 40, Math.max(a[1], b[1]) + 40];
  await leftDrag([x0, y0], [x1, y1]);
  sel = await app.page.evaluate(() => [...(window as never as Neo).__neocad.engine.selection.edges]);
  assert.ok(sel.length >= 9, `a window catches the visible edges: ${sel.length}`);
  await key("Escape");
});

test("a selected edge, then the round tool: it starts from it", { skip }, async () => {
  // The back edge: the right one meets the front fillet at a corner, which
  // SMLib will not fillet after it (test/solidfillets.test.ts pins that).
  await clickAt(...await app.screenOf(BACK));
  await app.type(`arm("round", { radius: 2 })`);
  const p = await previewed();
  assert.equal(p.why, null);
  await confirmAndRelease(app);
  const b = await blends();
  assert.equal(b.length, 2);
  assert.equal(b[1].edges.length, 1);
  const s = await settled();
  assert.ok(s[0].faces.includes("e3.f0"));
  assert.ok(s[0].valid);
});

test("save, open: the same rounded body; STEP exports it and reads back as one solid with B-spline blends", { skip }, async () => {
  const file = await saved();
  const was = (await settled())[0];
  await app.repl(`SAVED = ${JSON.stringify(file)}`);
  const opened = await app.repl("open(SAVED)");
  assert.equal(opened.ok, true, opened.error ?? "");
  await app.type('lookAt("f1"); orbit(-0.6, -1.0)');
  const now = (await settled())[0];
  assert.ok(Math.abs(now.volume - was.volume) < 1e-6);
  assert.deepEqual(now.faces, was.faces);
  await shot("7-reopened");
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type('exportStep("rounded")')]);
  const path = await download.path();
  assert.ok(path);
  const text = readFileSync(path, "utf8");
  assert.match(text, /^ISO-10303-21;/);
  assert.equal((text.match(/MANIFOLD_SOLID_BREP/g) ?? []).length, 1);
  assert.ok((text.match(/B_SPLINE_SURFACE_WITH_KNOTS/g) ?? []).length >= 2, "the fillet faces are the kernel's B-splines");
  assert.deepEqual(app.pageErrors, []);
});

test("a chamfer the same: an edge clicked, previewed, ✓ — its setback a dimension, its face planar", { skip }, async () => {
  // Tangent chains off: from the left lid edge one would run on through the
  // two fillets' end arcs and down the vertical edges, as Onshape's does.
  await app.type(`arm("chamfer", { setback: 2, tangent: false })`);
  await settled();
  // The left lid edge (x = −W), not yet rounded — a chamfer runs into a fillet where a fillet will not.
  await clickAt(...await app.screenOf(LEFT));
  const p = await previewed();
  assert.equal(p.why, null);
  await shot("8-chamfer-preview");
  await confirmAndRelease(app);
  const b = await blends();
  assert.equal(b.at(-1)!.kind, "chamfer");
  const s = await settled();
  assert.ok(s[0].valid);
  const chamferFace = s[0].faces.find((f) => f === `${b.at(-1)!.name}.f0`);
  assert.ok(chamferFace, `the chamfer's face is named: ${s[0].faces}`);
  const rels = (await app.repl("rels()")).value as string[];
  assert.ok(rels.some((l) => l.includes("chamferSetback 2")));
  await shot("9-chamfered");
  assert.deepEqual(app.pageErrors, []);
  // No refusal was ever said of a blend that took — a preview's answer
  // arriving after ✓ was once logged as the fillet's (found by looking).
  const log = (await app.page.textContent("#log")) ?? "";
  assert.doesNotMatch(log, /could not be applied/);
});

test("the shading across the blend, close: the fillet's faces turn smoothly from the lid into the wall", { skip }, async () => {
  await app.type('lookAt("f1"); orbit(0.5, -1.15); zoom(4)');
  await settled();
  await shot("10-blend-close");
  assert.deepEqual(app.pageErrors, []);
});
