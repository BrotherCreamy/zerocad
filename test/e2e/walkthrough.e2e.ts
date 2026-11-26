// **The walkthrough gate** — the first ten minutes of the app, as the owner
// spends them, by finger on an iPhone and by mouse, from a blank canvas, and
// checked on the body afterwards (docs/plans/walkthrough-gate.md). It runs
// before anything else on every merge: `npm run gate:walkthrough`.
//
// The owner, 2026-11-26, after a hole in a block failed four different ways
// on the build he had: *"this is pretty basic stuff"*. Each of those four
// (bugs 80–84) passed the whole unit suite and was obvious within seconds in
// a browser. So this file is the sequence itself, every step asserted on the
// model and the log, never only on the screen:
//
//   blank canvas → Rectangle (tool) → Extrude (tool, ✓) → a circle drawn by a
//   press straight on the lid, no plane chosen → Cut (the Cut tool, from the
//   Extrude button's flyout) → ✓ → the hole is through: the circle and its
//   twin on the two faces, `extrude · cut` into e1, the log carries no refusal,
//   the kernel's body has the hole → the circle's centre nudged a little: the
//   hole stays, a further solve has nothing to do, the box's base is flat →
//   Undo back to the blank canvas one step at a time, each step's model as it
//   was → Redo to the hole → Save, as a person does it (the app menu) →
//   the page reloaded → New → Open the saved file → the same solids, by the
//   kernel's volume and the twins' places → the hole still nudges.
//
// Beside it, the Extrude button's own Cut mode, chosen before the pick and
// after (bugs 80 and 82's path, which the toolbar puts first), and the owner's
// lens: a circle crossing the plate's edge, Cut through all — the D-shaped
// notch — nudged by finger and by mouse: still built, no boolean failure in
// the log, settled exactly (bug 85: the finger's nudge used to leave the
// release stalled at 3.5e-7 and the kernel refusing a frame).
//
// NEOCAD_E2E_SHOTS keeps the pictures (docs/images/561–568); look at them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
/** The box: 80 × 80, T thick. The Cut tool's default depth is 10, which is why T is: a hole right through by ✓ alone, as the owner presses it. */
const T = 10;

type Device = "iPhone" | "mouse";

// ---- the platform's file APIs, stubbed (files.e2e.ts's `platform`) ------------------
//
// Chromium plays both platforms: the desktop keeps its pickers, stubbed so the
// test can read what was written and hand back what is opened; the iPhone has
// no pickers and a share sheet, stubbed to record the file it is handed. The
// person's gesture is the same either way: the app menu's Save and Open….

interface Recorded {
  writes: { file: string; text: string }[];
  shares: { name: string; type: string; text: string }[];
  openWith: string | null;
}

function platform(p: { pickers: "stub" | "none"; share: "stub" | "none" }) {
  const w = window as unknown as Record<string, unknown>;
  const rec = { writes: [] as unknown[], shares: [] as unknown[], openWith: null as string | null };
  w.__files = rec;
  const handle = (name: string) => ({
    kind: "file",
    name,
    async getFile() { return new File([(w.__files as { openWith: string }).openWith ?? ""], name, { type: "application/json" }); },
    async createWritable() {
      let text = "";
      return { async write(t: string) { text += t; }, async close() { rec.writes.push({ file: name, text }); } };
    },
  });
  if (p.pickers === "none") {
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  } else {
    w.showSaveFilePicker = async (o: { suggestedName?: string }) => handle(o?.suggestedName ?? "picked.zerocad.json");
    w.showOpenFilePicker = async () => [handle("opened.zerocad.json")];
  }
  const nav = navigator as unknown as Record<string, unknown>;
  if (p.share === "none") {
    delete nav.share;
    delete nav.canShare;
  } else {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (d: { files?: File[] }) => !!d?.files?.length });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: { files: File[] }) => { for (const f of d.files) rec.shares.push({ name: f.name, type: f.type, text: await f.text() }); },
    });
  }
}

// ---- a hand ------------------------------------------------------------------------

interface Hand {
  device: Device;
  /** A button of the chrome, pressed where it is. */
  button(selector: string): Promise<void>;
  /** A press at a world point, on the drawing. */
  click(world: number[]): Promise<void>;
  /** A press at one world point dragged to another. */
  drag(from: number[], to: number[]): Promise<void>;
  /** A drag that starts on a world point and moves the hand by pixels — a nudge, wherever the eye is. */
  nudge(from: number[], dx: number, dy: number): Promise<void>;
  /** A tool chosen from a group's flyout: the mouse hovers the group's button, the finger presses and slides. */
  flyout(group: string, tool: string): Promise<void>;
  /** A row of the app menu, by the command it types. */
  menu(command: string): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

/** A selector's middle, in page pixels (the mouse's) and in canvas pixels (the fingers'). */
async function middles(a: AppContext, selector: string): Promise<{ page: [number, number]; canvas: [number, number] }> {
  return a.page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    const c = document.getElementById("cv")!.getBoundingClientRect();
    return { page: [r.x + r.width / 2, r.y + r.height / 2] as [number, number], canvas: [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number] };
  });
}

const flyoutOpen = (a: AppContext) => a.page.$eval("#flyout", (el) => !(el as HTMLElement).hidden);
const menuOpen = (a: AppContext) => a.page.evaluate(() => { const el = document.getElementById("appmenu"); return !!el && !el.hidden; });

async function until(what: () => Promise<boolean>, why: string, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await what()) return;
    await new Promise((r) => setTimeout(r, 60));
  }
  assert.fail(`${why}: not within ${ms} ms`);
}

async function handOf(a: AppContext, device: Device): Promise<Hand> {
  if (device === "mouse") {
    const mouseDrag = async (p: { x: number; y: number }, q: { x: number; y: number }) => {
      await a.page.mouse.move(p.x, p.y, { steps: 3 });
      await a.page.waitForTimeout(80);
      await a.page.mouse.down();
      await a.page.mouse.move(q.x, q.y, { steps: 12 });
      await a.page.mouse.up();
      await a.page.waitForTimeout(600);
    };
    const key = async (combo: string) => { await a.page.keyboard.press(combo); await a.page.waitForTimeout(400); };
    return {
      device,
      button: async (sel) => { const [x, y] = (await middles(a, sel)).page; await a.page.mouse.click(x, y); await a.page.waitForTimeout(300); },
      click: async (w) => { const c = await a.at(...await a.screenOf(w)); await a.page.mouse.move(c.x, c.y, { steps: 3 }); await a.page.waitForTimeout(80); await a.page.mouse.click(c.x, c.y); await a.page.waitForTimeout(350); },
      drag: async (from, to) => mouseDrag(await a.at(...await a.screenOf(from)), await a.at(...await a.screenOf(to))),
      nudge: async (from, dx, dy) => { const p = await a.at(...await a.screenOf(from)); await mouseDrag(p, { x: p.x + dx, y: p.y + dy }); },
      flyout: async (group, tool) => {
        // A hover opens the group's flyout beside the column; a click on its item arms it.
        await a.page.mouse.move(700, 400);
        const [x, y] = (await middles(a, `#toolbar button[data-group="${group}"]`)).page;
        await a.page.mouse.move(x, y);
        await until(() => flyoutOpen(a), `the ${group} flyout opens on hover`);
        const [ix, iy] = (await middles(a, `#flyout button[data-tool="${tool}"]`)).page;
        await a.page.mouse.move(ix, iy);
        await a.page.mouse.click(ix, iy);
        await a.page.waitForTimeout(300);
      },
      menu: async (command) => {
        const [x, y] = (await middles(a, "#logo")).page;
        await a.page.mouse.click(x, y);
        await until(() => menuOpen(a), "the app menu opens");
        const [ix, iy] = (await middles(a, `#appmenu [data-command='${command}']`)).page;
        await a.page.mouse.click(ix, iy);
        await a.page.waitForTimeout(400);
      },
      undo: () => key("Control+z"),
      redo: () => key("Control+Shift+z"),
    };
  }
  const f: Fingers = await fingers(a);
  const tapOn = async (sel: string) => { const [x, y] = (await middles(a, sel)).canvas; await f.tap(x, y); await a.page.waitForTimeout(500); };
  return {
    device,
    button: tapOn,
    click: async (w) => { const s = await a.screenOf(w); await a.at(s[0], s[1]); await f.tap(s[0], s[1]); await a.page.waitForTimeout(500); },
    drag: async (from, to) => { const s = await a.screenOf(from), e = await a.screenOf(to); await a.at(s[0], s[1]); await f.drag(s, e, 12); await a.page.waitForTimeout(600); },
    nudge: async (from, dx, dy) => { const s = await a.screenOf(from); await a.at(s[0], s[1]); await f.drag(s, [s[0] + dx, s[1] + dy], 12); await a.page.waitForTimeout(900); },
    flyout: async (group, tool) => {
      // A press on the group's button slid past the slop opens its flyout under
      // the finger; the finger glides onto the item and lifts (toolbargroups.e2e.ts).
      const from = (await middles(a, `#toolbar button[data-group="${group}"]`)).canvas;
      await f.down(from);
      await f.move([from[0] + 12, from[1]]);
      await until(() => flyoutOpen(a), `the ${group} flyout opens under the finger`);
      const to = (await middles(a, `#flyout button[data-tool="${tool}"]`)).canvas;
      await f.glide(6, to);
      await f.up();
      await a.page.waitForTimeout(400);
    },
    menu: async (command) => {
      await tapOn("#logo");
      await until(() => menuOpen(a), "the app menu opens");
      await tapOn(`#appmenu [data-command='${command}']`);
    },
    // A finger has no Ctrl+Z: the action strip's buttons type undo() and redo().
    undo: () => tapOn('#actions button[data-action="undo"]'),
    redo: () => tapOn('#actions button[data-action="redo"]'),
  };
}

// ---- reading the app -----------------------------------------------------------------

async function shot(a: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await a.page.waitForTimeout(500);
  await a.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

async function say(a: AppContext, source: string): Promise<void> {
  await a.type(source);
  await a.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await a.page.waitForTimeout(250);
}

async function ready(a: AppContext): Promise<void> {
  await a.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await a.page.waitForTimeout(400);
}

/** The whole model as text — what the undo stack stores and a file carries. */
async function snapshot(a: AppContext): Promise<string> {
  const r = await a.repl("save()");
  assert.equal(r.ok, true, r.error ?? "");
  return r.value as string;
}

/** The face the app says is drawn under a canvas pixel, by its written name (clickonface.e2e.ts), or null. */
const faceAt = (a: AppContext, at: [number, number]) => a.page.evaluate(async (at) => {
  const [solidpickPath, solidrefPath] = ["/src/solidpick.ts", "/src/relations/solidref.ts"];
  const { faceUnder } = await import(solidpickPath);
  const { faceRef } = await import(solidrefPath);
  const { engine, model } = (window as never as { __neocad: { engine: { drawnFaces: unknown }; model: unknown } }).__neocad;
  const tag = faceUnder(engine.drawnFaces, at[0], at[1])?.name;
  return tag ? faceRef(model, tag) as string : null;
}, at);

interface Reading {
  features: [string, string | null, string | null][];
  /** The bodies layer's views: `e1[e1+e2]`. */
  views: string[];
  skipped: { feature: string; why: string }[];
  report: string[];
  status: string;
  warnRows: string[];
  /** The circles' centres, by name. */
  circles: Record<string, number[]>;
  radii: Record<string, number>;
  /** How far the base's fourth corner is off the plane of the other three. */
  baseOff: number;
  corners: number[][];
  /** What a further plain solve had to do. */
  settleIterations: number;
  settleMax: number;
  /** The kernel body's volume, when it has one. */
  volume: number | null;
  faces: number | null;
  /** The planes each point is held on by `onplane`, by the plane's name. */
  heldOn: Record<string, string[]>;
  pars: [string, string][];
  byKind: Record<string, number>;
}

async function read(a: AppContext): Promise<Reading> {
  return a.page.evaluate(() => {
    const N = (window as unknown as { __neocad: { model: any; bodies: any } }).__neocad; // eslint-disable-line @typescript-eslint/no-explicit-any
    const m = N.model, B = N.bodies;
    const P = (n: string): number[] => m.coords(n);
    const sub = (u: number[], v: number[]) => u.map((x, i) => x - v[i]);
    const cross = (u: number[], v: number[]) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dot = (u: number[], v: number[]) => u.reduce((s, x, i) => s + x * v[i], 0);
    const unit = (u: number[]) => { const l = Math.hypot(...u); return u.map((x) => x / l); };
    const has = (n: string) => m.entities.has(n);
    const off = (a: string, b: string, c: string, d: string) => (has(a) && has(b) && has(c) && has(d)) ? Math.abs(dot(sub(P(d), P(a)), unit(cross(sub(P(b), P(a)), sub(P(c), P(a)))))) : 0;
    const views = B.views();
    const circles: Record<string, number[]> = {}, radii: Record<string, number> = {}, heldOn: Record<string, string[]> = {}, byKind: Record<string, number> = {};
    for (const e of m.entities.values()) {
      byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
      if (e.kind === "circle") { circles[e.name] = P(e.center); radii[e.name] = m.radius(e.name); }
      if (e.kind === "point") {
        const planes = [...m.relations.values()].filter((r: any) => r.op === "onPlane" && r.args[0] === e.name).map((r: any) => r.args[1]); // eslint-disable-line @typescript-eslint/no-explicit-any
        if (planes.length) heldOn[e.name] = planes;
      }
    }
    const settle = m.problem.solve();
    const solid = views[0]?.result?.solid ?? null;
    return {
      features: [...m.features.values()].map((f: any) => [f.kind, f.mode ?? null, f.into ?? null]), // eslint-disable-line @typescript-eslint/no-explicit-any
      views: views.map((v: any) => `${v.name}[${v.features.join("+")}]`), // eslint-disable-line @typescript-eslint/no-explicit-any
      skipped: B.current?.skipped ?? [], report: B.report().lines,
      status: document.getElementById("status")?.textContent ?? "",
      warnRows: Array.from(document.querySelectorAll("#organiser .orow")).filter((r) => (r as HTMLElement).dataset.warn !== undefined).map((r) => r.querySelector(".oname")?.textContent ?? ""),
      circles, radii,
      baseOff: off("p1", "p2", "p3", "p4"),
      corners: ["p1", "p2", "p3", "p4"].filter(has).map(P),
      settleIterations: settle.iterations, settleMax: settle.maxResidual,
      volume: solid?.volume ?? null, faces: solid?.faces?.length ?? null,
      heldOn,
      pars: [...m.relations.values()].filter((r: any) => r.op === "parallel").map((r: any) => [r.args[0], r.args[1]] as [string, string]), // eslint-disable-line @typescript-eslint/no-explicit-any
      byKind,
    };
  });
}

/**
 * The kernel's answer is asynchronous (`Bodies.sync`: one request in flight,
 * the newest waiting), so a reading of the bodies layer right after ✓, an
 * undo or an open can be of the body before. Waits until the first body has a
 * volume that stops changing, then reads.
 */
async function readBuilt(a: AppContext, what: string): Promise<Reading> {
  await kernelVolume(a, what);
  return read(a);
}

/** Waits until the first body has a volume that stops changing, and gives it. */
async function kernelVolume(a: AppContext, what: string): Promise<number> {
  let last: number | null = null;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const v = await a.page.evaluate(() => {
      const B = (window as unknown as { __neocad: { bodies: any } }).__neocad.bodies; // eslint-disable-line @typescript-eslint/no-explicit-any
      return B.views()[0]?.result?.solid?.volume ?? null;
    });
    if (v !== null && last !== null && Math.abs(v - last) < 1e-9) return v;
    last = v;
    await a.page.waitForTimeout(250);
  }
  assert.fail(`${what}: the kernel gave no settled body within 15 s (last ${last})`);
}

const REFUSALS = ["cuts nothing", "does not reach", "nothing of the body would be left", "could not be applied", "subtract failed", "cannot be laid out", "not built"];

/** The cut made a hole right through the box, read off the model, the bodies layer and the log. */
async function assertHole(a: AppContext, r: Reading, what: string, lidZ: number, farZ: number): Promise<void> {
  const log = await a.log();
  for (const refusal of REFUSALS) assert.ok(!log.includes(refusal), `${what}: the log says "${refusal}" — ${log.slice(-500)}`);
  assert.deepEqual(r.features, [["extrude", null, null], ["extrude", "cut", "e1"]], `${what}: the box and a cut into it`);
  const zs = Object.values(r.circles).map((c) => Math.round(c[2] * 1e6) / 1e6 + 0).sort((x, y) => x - y);
  assert.deepEqual(zs, [farZ, lidZ].sort((x, y) => x - y), `${what}: the circle and its twin on the two faces — a hole right through`);
  assert.deepEqual(r.views, ["e1[e1+e2]"], `${what}: the kernel built the box with its cut`);
  assert.deepEqual(r.skipped, [], `${what}: nothing refused`);
  assert.deepEqual(r.report, [], `${what}: nothing to say against the bodies`);
  assert.deepEqual(r.warnRows, [], `${what}: no row in the warning ink`);
  assert.match(r.status, /SOLVED/, `${what}: ${r.status}`);
  const organiser = await a.page.$eval("#organiser", (el) => (el.textContent ?? "").replace(/\s+/g, " "));
  assert.match(organiser, /e1\s*−\s*e2/, `${what}: the body row says e1 − e2`);
}

/** The drawing is settled: a further solve has nothing to do, and the box's base is flat. */
function assertSettled(r: Reading, what: string): void {
  assert.equal(r.settleIterations, 0, `${what}: settled — a further solve has nothing to do (it left ${r.settleMax})`);
  assert.ok(r.baseOff < 1e-6, `${what}: the box's base coplanar to 1e-6: ${r.baseOff}`);
}

/** The closed form of the box less a hole of radius `r`: what the kernel's volume is held to. */
const holeVolume = (r: number) => 80 * 80 * T - Math.PI * r * r * T;

// ---- the steps -------------------------------------------------------------------------

/** The Rectangle tool: 80 × 80 about the origin. */
async function rectangle(a: AppContext, h: Hand): Promise<void> {
  await h.button('#toolbar button[data-tool="rectangle"]');
  await h.drag([-40, -40, 0], [40, 40, 0]);
  const m = await a.model();
  assert.equal(m.byKind.line, 4, `the rectangle: four lines (${JSON.stringify(m.byKind)})`);
  assert.equal(await a.status(), "SOLVED");
}

/** The Extrude tool, a press inside the rectangle, ✓: a box T thick. */
async function extrude(a: AppContext, h: Hand): Promise<void> {
  await h.button('#toolbar button[data-tool="extrude"]');
  await h.click([0, 0, 0]);
  await a.page.click("#options .oact button.ok");
  await a.page.waitForTimeout(700);
  const m = await a.model();
  assert.equal(m.byKind.line, 12, "a box: twelve edges");
  assert.match(await a.log(), /e1\s+extrude of l1,l2,l3,l4, depth d1 = 10/, "the log says what was built");
  // Looked at from a corner, as the owner's screenshots are.
  await say(a, "orbit(0, -1.0); orbit(-0.8, 0); zoom(1.1)");
}

/** The Circle tool with no plane chosen: a press straight on the lid, dragged out to its rim. */
async function circleOnTheLid(a: AppContext, h: Hand): Promise<void> {
  const centre = await a.screenOf([0, 0, T]);
  assert.equal(await faceAt(a, centre), "e1.lid", "the press is going to land on the lid, and the app says so");
  await h.button('#toolbar button[data-tool="circle"]');
  await h.drag([0, 0, T], [12, 0, T]);
  const r = await read(a);
  assert.equal(r.byKind.circle, 1, `one circle (${JSON.stringify(r.byKind)}) — log: ${(await a.log()).slice(-300)}`);
  const [name, c] = Object.entries(r.circles)[0];
  assert.ok(Math.abs(c[2] - T) < 1e-6 && Math.hypot(c[0], c[1]) < 1, `its centre on the lid near its middle (a hand lands on pixels): ${c}`);
  assert.ok(Math.abs(r.radii[name] - 12) < 1.5, `its radius about 12: ${r.radii[name]}`);
  const centrePoint = Object.keys(r.heldOn).find((p) => r.heldOn[p].includes("e1.lid"));
  assert.ok(centrePoint, `the centre is held on the lid by onplane: ${JSON.stringify(r.heldOn)}`);
  assert.ok(r.pars.some(([x, y]) => x === name && y === "e1.lid"), `and the circle's normal par to it: ${JSON.stringify(r.pars)}`);
  assert.match(r.status, /SOLVED/);
}

/** The Cut tool from the Extrude button's flyout, a press inside the circle, ✓. */
async function cutTheHole(a: AppContext, h: Hand): Promise<void> {
  await h.flyout("sweep", "cut");
  assert.equal((await a.model()).activeTool, "cut", "the Cut tool armed from the flyout");
  await h.click([0, 0, T]);
  await a.page.click("#options .oact button.ok");
  await a.page.waitForTimeout(900);
}

// ---- the walkthrough -----------------------------------------------------------------

for (const device of ["iPhone", "mouse"] as const) {
  const open = () => openApp({
    ...(device === "mouse" ? {} : { device: "iPhone 13" }),
    init: { fn: platform, arg: device === "mouse" ? { pickers: "stub", share: "none" } : { pickers: "none", share: "stub" } },
  });
  const n = device === "iPhone" ? { hole: 561, nudged: 562, reopened: 563, lens: 564 } : { hole: 565, nudged: 566, reopened: 567, lens: 568 };

  test(`${device}: the walkthrough — rectangle, extrude, a circle on the lid, Cut, the hole nudged, undone to blank and redone, saved, reopened the same, nudged again`, async () => {
    const a = await open();
    // New and Open ask before discarding unsaved changes; a person says yes.
    a.page.on("dialog", (d) => void d.accept());
    try {
      await ready(a);
      const h = await handOf(a, device);
      const steps: { label: string; saved: string; points: number; features: number }[] = [];
      const mark = async (label: string) => {
        const r = await read(a);
        const saved = await snapshot(a);
        assert.notEqual(saved, steps.at(-1)?.saved, `${label} changed the drawing`);
        steps.push({ label, saved, points: r.byKind.point ?? 0, features: r.features.length });
      };
      await mark("blank");
      const blank = await read(a);
      assert.equal(blank.byKind.line ?? 0, 0, `a blank canvas: ${JSON.stringify(blank.byKind)}`);

      await rectangle(a, h);
      await mark("rectangle");
      await extrude(a, h);
      await mark("extrude");
      await circleOnTheLid(a, h);
      await mark("circle");
      await cutTheHole(a, h);
      const hole = await readBuilt(a, "the Cut tool from the flyout");
      await assertHole(a, hole, "the Cut tool from the flyout", T, 0);
      const radius = Object.values(hole.radii)[0];
      const volume = await kernelVolume(a, "the hole");
      assert.ok(Math.abs(volume - holeVolume(radius)) / holeVolume(radius) < 1e-3, `the kernel's body has the hole: ${volume} against ${holeVolume(radius)}`);
      await mark("cut");
      await shot(a, `${n.hole}-${device.toLowerCase()}-the-walkthrough-the-hole`);

      // The nudge: forty pixels along, sixteen down, from the centre.
      await h.nudge([0, 0, T], 40, 16);
      const nudged = await readBuilt(a, "after the nudge");
      await assertHole(a, nudged, "after the nudge", T, 0);
      assertSettled(nudged, "after the nudge");
      const slid = Math.hypot(...Object.values(nudged.circles)[0].map((c, i) => c - Object.values(hole.circles)[0][i]));
      assert.ok(slid > 3, `the circle slid ${slid} along the lid`);
      assert.ok(nudged.corners.every((c, i) => Math.hypot(...c.map((x, k) => x - hole.corners[i][k])) < 1e-2), "the box stood still");
      const nudgedVolume = await kernelVolume(a, "after the nudge");
      assert.ok(Math.abs(nudgedVolume - volume) / volume < 1e-3, `the hole is the same hole, moved: ${nudgedVolume} against ${volume}`);
      await mark("nudge");
      await shot(a, `${n.nudged}-${device.toLowerCase()}-the-walkthrough-the-hole-nudged`);

      // Undo, one step at a time, back to the blank canvas: each step's model as it was.
      for (let k = steps.length - 1; k >= 1; k--) {
        await h.undo();
        const r = await read(a);
        const was = steps[k - 1];
        assert.equal(await snapshot(a), was.saved, `undo ${steps.length - k}: back to "${was.label}" exactly`);
        assert.equal(r.byKind.point ?? 0, was.points, `undo to "${was.label}": ${was.points} points`);
        assert.equal(r.features.length, was.features, `undo to "${was.label}": ${was.features} features`);
        assert.match(r.status, /SOLVED|ready/, r.status);
      }
      assert.equal((await read(a)).byKind.line ?? 0, 0, "the blank canvas again");
      // And redo, forward through the same states, to the hole.
      for (let k = 1; k < steps.length; k++) {
        await h.redo();
        assert.equal(await snapshot(a), steps[k].saved, `redo ${k}: forward to "${steps[k].label}" exactly`);
      }
      const redone = await readBuilt(a, "after redo");
      await assertHole(a, redone, "after redo", T, 0);
      assertSettled(redone, "after redo");
      const redoneVolume = await kernelVolume(a, "after redo");
      assert.ok(Math.abs(redoneVolume - nudgedVolume) / volume < 1e-6, `the kernel's body back: ${redoneVolume} against ${nudgedVolume}`);

      // Save, as a person does it: the app menu's Save. The desktop's picker
      // writes the file; the phone's share sheet is handed it.
      const before = { saved: steps.at(-1)!.saved, points: await a.page.evaluate(() => { const m = (window as unknown as { __neocad: { model: any } }).__neocad.model; return Object.fromEntries([...m.entities.values()].filter((e: any) => e.kind === "point").map((e: any) => [e.name, m.coords(e.name)])); }) }; // eslint-disable-line @typescript-eslint/no-explicit-any
      await h.menu("saveFile()");
      await a.page.waitForFunction(() => { const r = (window as unknown as { __files: Recorded }).__files; return r.writes.length + r.shares.length === 1; }, null, { timeout: 5000 });
      const rec = await a.page.evaluate(() => (window as unknown as { __files: Recorded }).__files);
      const file = device === "mouse" ? rec.writes[0] : rec.shares[0];
      assert.ok(file.text.includes('"neocad-model"'), "a model file");
      assert.equal(file.text, before.saved, "the file holds exactly what save() writes");
      assert.match(await a.log(), /saved|downloaded|shared/);

      // The page reloaded — the autosave brings the drawing back, as a phone's
      // app resumes — then New, and Open… of the saved file.
      await a.page.reload({ waitUntil: "networkidle" });
      await ready(a);
      const h2 = await handOf(a, device);
      assert.deepEqual((await read(a)).byKind, redone.byKind, "the drawing survives the reload by autosave");
      await h2.menu("newFile()");
      await a.page.waitForTimeout(400);
      assert.equal((await read(a)).byKind.line ?? 0, 0, `New: a blank canvas (${(await a.log()).slice(-200)})`);
      if (device === "mouse") {
        await a.page.evaluate((text) => { (window as unknown as { __files: Recorded }).__files.openWith = text; }, file.text);
        await h2.menu("openFile()");
      } else {
        const [chooser] = await Promise.all([a.page.waitForEvent("filechooser"), h2.menu("openFile()")]);
        await chooser.setFiles({ name: "walkthrough.zerocad.json", mimeType: "application/json", buffer: Buffer.from(file.text) });
      }
      await a.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("opened "), null, { timeout: 10_000 });
      await a.page.waitForTimeout(500);
      const reopened = await readBuilt(a, "the file reopened");
      await assertHole(a, reopened, "the file reopened", T, 0);
      assertSettled(reopened, "the file reopened");
      assert.deepEqual(reopened.byKind, redone.byKind, "the same entities, kind for kind");
      const after = await a.page.evaluate(() => { const m = (window as unknown as { __neocad: { model: any } }).__neocad.model; return Object.fromEntries([...m.entities.values()].filter((e: any) => e.kind === "point").map((e: any) => [e.name, m.coords(e.name)])); }); // eslint-disable-line @typescript-eslint/no-explicit-any
      for (const [name, at] of Object.entries(before.points)) {
        assert.ok(after[name], `${name} came back`);
        assert.ok(Math.hypot(...(at as number[]).map((x, i) => x - after[name][i])) < 1e-6, `${name} where it was: ${after[name]} against ${at}`);
      }
      const reopenedVolume = await kernelVolume(a, "the file reopened");
      assert.ok(Math.abs(reopenedVolume - nudgedVolume) / volume < 1e-6, `the same solid, by the kernel's volume: ${reopenedVolume} against ${nudgedVolume}`);
      assert.equal(reopened.faces, redone.faces, "and the same faces");
      await say(a, "orbit(0, -1.0); orbit(-0.8, 0); zoom(1.1)");
      await shot(a, `${n.reopened}-${device.toLowerCase()}-the-walkthrough-reopened-the-same-hole`);

      // And the hole still nudges, in the reopened file.
      const c = Object.values(reopened.circles)[0];
      await h2.nudge(c, -30, -10);
      const again = await readBuilt(a, "nudged after reopening");
      await assertHole(a, again, "nudged after reopening", T, 0);
      assertSettled(again, "nudged after reopening");
      const slid2 = Math.hypot(...Object.values(again.circles)[0].map((x, i) => x - c[i]));
      assert.ok(slid2 > 3, `the circle slid ${slid2} in the reopened file`);
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });

  test(`${device}: the Extrude button's Cut mode, chosen after the pick and before it — both make the hole (bugs 80 and 82's path)`, async () => {
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await rectangle(a, h);
      await extrude(a, h);
      await circleOnTheLid(a, h);
      const drawn = await snapshot(a);
      // After the pick.
      await h.button('#toolbar button[data-tool="extrude"]');
      await h.click([0, 0, T]);
      await a.page.click('#options button:has-text("Cut")');
      await a.page.waitForTimeout(400);
      await a.page.click("#options .oact button.ok");
      await a.page.waitForTimeout(900);
      await assertHole(a, await readBuilt(a, "Cut after the pick"), "Cut after the pick", T, 0);
      assert.match(await a.log(), /extrude\("c1", -10, \{"mode":"cut"\}\)/, "the call signs the depth into the material");
      // Undone to the circle, and before the pick.
      await h.undo();
      assert.equal(await snapshot(a), drawn, "undo takes the cut back, nothing more");
      await h.button('#toolbar button[data-tool="extrude"]');
      await a.page.click('#options button:has-text("Cut")');
      await a.page.waitForTimeout(400);
      await h.click([0, 0, T]);
      await a.page.click("#options .oact button.ok");
      await a.page.waitForTimeout(900);
      await assertHole(a, await readBuilt(a, "Cut before the pick"), "Cut before the pick", T, 0);
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });

  test(`${device}: the owner's lens — a circle across the edge, Cut through all, the notch nudged: built, no boolean failure, settled exactly (bug 85)`, async () => {
    const a = await open();
    try {
      await ready(a);
      const h = await handOf(a, device);
      await rectangle(a, h);
      await extrude(a, h);
      // The Plane tool on the lid; the circle's centre 10 in from the edge at
      // x = 40, its rim 18 up, clear of every edge; the Cut tool from the
      // flyout, through all, at a press inside the lens.
      await h.button('#toolbar button[data-tool="plane"]');
      await h.click([-30, 30, T]);
      await h.button('#toolbar button[data-tool="circle"]');
      await h.drag([30, 0, T], [30, 18, T]);
      await h.flyout("sweep", "cut");
      await h.click([36, 0, T]);
      await a.page.selectOption('#options select.obeside[data-option="end"]', "through");
      await a.page.waitForTimeout(300);
      await a.page.click("#options .oact button.ok");
      await a.page.waitForTimeout(900);
      await say(a, "workplane(null)");
      await say(a, "orbit(0, -1.0); orbit(-0.8, 0); zoom(1.1)");
      await say(a, 'arm("select")');
      const made = await readBuilt(a, "the lens cut");
      const log0 = await a.log();
      for (const refusal of REFUSALS) assert.ok(!log0.includes(refusal), `made: the log says "${refusal}"`);
      assert.deepEqual(made.features, [["extrude", null, null], ["extrude", "cut", "e1"]]);
      assert.deepEqual([made.views, made.skipped, made.report], [["e1[e1+e2]"], [], []], "built, nothing refused");
      const r = made.radii.c1, d = 40 - made.circles.c1[0];
      assert.ok(d > 0 && d < r, `the circle crosses the edge: centre ${made.circles.c1}, radius ${r}`);
      const segment = r * r * Math.acos(d / r) - d * Math.sqrt(r * r - d * d);
      const want = 80 * 80 * T - (Math.PI * r * r - segment) * T;
      const volume = await kernelVolume(a, "the lens cut");
      assert.ok(Math.abs(volume - want) / want < 1e-3, `the kernel's notch: ${volume}, the closed form ${want}`);

      await h.nudge([30, 0, T], -24, 8);
      const nudged = await readBuilt(a, "the lens nudged");
      const log = await a.log();
      // Bug 85: by finger the release's solve stalled at 3.5e-7 for sixty
      // iterations and the kernel refused a frame's boolean (subtract failed,
      // status 1001). Settled exactly now, both hands, nothing refused.
      for (const refusal of REFUSALS) assert.ok(!log.includes(refusal), `after the nudge: the log says "${refusal}" — ${log.slice(-400)}`);
      assert.deepEqual([nudged.views, nudged.skipped, nudged.report, nudged.warnRows], [["e1[e1+e2]"], [], [], []], "still built, nothing refused");
      assertSettled(nudged, "after the nudge");
      assert.match(nudged.status, /SOLVED/);
      const slid = Math.hypot(...nudged.circles.c1.map((c, i) => c - made.circles.c1[i]));
      assert.ok(slid > 2, `the circle moved ${slid} (0.02 by finger before)`);
      await shot(a, `${n.lens}-${device.toLowerCase()}-the-walkthrough-the-lens-nudged`);
      await h.undo();
      const undone = await read(a);
      assert.ok(Math.hypot(...undone.circles.c1.map((c, i) => c - made.circles.c1[i])) < 1e-6, "undo puts the circle back");
      assertSettled(undone, "after undo");
      assert.deepEqual(a.pageErrors, []);
    } finally {
      await a.close();
    }
  });
}
