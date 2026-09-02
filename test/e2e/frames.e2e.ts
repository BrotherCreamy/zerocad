// Coordinate frames in a real browser: made, drawn, hovered, picked, dragged,
// boxed, saved and deleted.
//
// The package's own story is the fourth test here, and it is the one that
// cannot be told anywhere else: a drawing levelled against a frame, and then
// the frame *tilted by hand* — grab its x-ref, pull, and the whole levelled
// sketch turns to follow. The unit suite proves the arithmetic of that with a
// frame it moved by fiat; only the app can show that the gesture reaches it.
//
// The assertions are closed-form throughout, deliberately. "It still solves"
// is exactly what a broken version of this would also report: a solver allowed
// to turn the frame instead of the drawing reports `solved: true` while doing
// the opposite of what was asked. So the checks here are on the exact angle,
// the exact offset, and the exact frame coordinate.
//
// These tests share one app and run in order, because the interesting states
// are cumulative — a fresh model has no frame, and that is itself the first
// thing to check.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openApp, type AppContext } from "./harness.ts";

let app: AppContext;
before(async () => { app = await openApp(); });
after(async () => { await app.close(); });

const cmd = () => app.page.$eval("#cmd", (el) => (el as HTMLInputElement).value);

/** Canvas-relative screen coordinates of a named point. */
async function screenOf(name: string): Promise<[number, number]> {
  return app.page.evaluate((n) => {
    const { model, engine } = (window as never as {
      __neocad: { model: { coords(x: string): number[] }; engine: { worldToScreen(w: number[]): [number, number] } };
    }).__neocad;
    return engine.worldToScreen(model.coords(n));
  }, name);
}

interface FrameInfo {
  origin: number[];
  xref: number[];
  originName: string;
  xrefName: string;
  isDefault: boolean;
  /** The frame's +x direction, as an angle in radians. */
  tilt: number;
}

async function frameInfo(name: string): Promise<FrameInfo> {
  const r = await app.repl(
    `(() => { const f = model.frame(${JSON.stringify(name)});` +
    ` const o = model.coords(f.origin), x = model.coords(f.xref);` +
    ` return { origin: o, xref: x, originName: f.origin, xrefName: f.xref,` +
    ` isDefault: model.defaultFrame === f.name,` +
    ` tilt: Math.atan2(x[1] - o[1], x[0] - o[0]) }; })()`,
  );
  assert.ok(r.ok, `could not read frame ${name}: ${r.error}`);
  return r.value as FrameInfo;
}

/** Press at (sx, sy), pull by (dx, dy) screen pixels, release. */
async function dragFrom(sx: number, sy: number, dx: number, dy: number) {
  const from = await app.at(sx, sy);
  const to = await app.at(sx + dx, sy + dy);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 10 });
  await app.page.waitForTimeout(80);
  await app.page.mouse.up();
  await app.page.waitForTimeout(250);
}

const angleOf = (a: number[], b: number[]) => Math.atan2(b[1] - a[1], b[0] - a[0]);
/** The difference between two directions, ignoring which way round each points. */
const modPi = (d: number) => {
  const x = ((d % Math.PI) + Math.PI) % Math.PI;
  return Math.min(x, Math.PI - x);
};

test("with no frame at all, hor says exactly what to do about it", async () => {
  await app.type("pt(-140,-70); pt(-80,-68)");
  await app.type('ln("p1","p2")');
  await app.type('hor("l1")');

  const log = await app.log();
  assert.match(log, /no default frame — frame\(\) then setDefaultFrame\(\), or say which frame/,
    "the refusal is the fix, spelled out, not a stack trace");
  const m = await app.model();
  assert.equal(m.journalOps.includes("horizontal"), false, "and nothing was added on the way out");

  await app.type('fix("p1",[0,0])');
  assert.match(await app.log(), /no default frame/, "fix refuses the same way, for the same reason");

  // Out of the way of everything below.
  await app.type('del("p1","p2")');
  assert.equal((await app.model()).size, 0, "a clean sheet again");
});

test("frame() puts a frame in the middle of the view, where you can see it", async () => {
  await app.page.fill("#cmd", "");
  // Panned first, so "the middle of the view" and "the kernel's origin" are
  // different places and the test can tell which one it got. That is the whole
  // point of the seeding: a frame is what `hor` and `ver` are measured against,
  // and one that materialised off-screen would leave the vocabulary pointing at
  // something nobody can see.
  await app.type("pan(-130, 45)");
  const centre = await app.page.evaluate(() => {
    const { engine } = (window as never as {
      __neocad: { engine: { view: { ox: number; oy: number; scale: number }; canvas: HTMLCanvasElement } };
    }).__neocad;
    const r = engine.canvas.getBoundingClientRect();
    const v = engine.view;
    return [(r.width / 2 - v.ox) / v.scale, (v.oy - r.height / 2) / v.scale];
  });

  await app.type("frame()");
  const f = await frameInfo("f1");
  const scale = (await app.model()).view.scale;
  // Within a few pixels, not exactly: the log pane grows by the line the
  // command itself logs, which takes that much height off the canvas between
  // the measurement above and this one. Nothing near the ~43 world units back
  // to the kernel's origin, which is what this is really telling apart.
  assert.ok(Math.hypot(f.origin[0] - centre[0], f.origin[1] - centre[1]) * scale < 12,
    `the origin landed at ${f.origin}, not at the middle of the view ${centre}`);
  assert.ok(Math.hypot(f.origin[0], f.origin[1]) > 20,
    `and it is nowhere near the kernel's origin, which is 43 units away: ${f.origin}`);
  assert.ok(f.xref[0] > f.origin[0], `the x-ref is to the origin's right: ${f.xref} vs ${f.origin}`);
  assert.ok(Math.abs(f.xref[1] - f.origin[1]) < 1e-9, "and level with it, so a new frame is square to the window");
  assert.equal(f.isDefault, false, "making a frame does not silently make it the default");
});

test("the marker is pickable, and the tag says whether it is the default", async () => {
  await app.page.fill("#cmd", "");
  const f = await frameInfo("f1");
  const [ox, oy] = await screenOf(f.originName);
  // Along the +x arm, clear of the origin point's own 8px pick radius.
  const on = await app.at(ox + 18, oy);

  await app.page.mouse.move(on.x, on.y);
  await app.page.waitForTimeout(120);
  assert.equal(await app.repl("hover()").then((r) => r.value), "f1",
    "the axes marker is what a frame is, as far as the cursor is concerned");
  const tag = await app.page.$eval("#hovertag", (el) => el.textContent ?? "");
  assert.match(tag, /^f1 {2}origin p\d+, \+x toward p\d+$/, `the hover tag reads "${tag}"`);

  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.waitForTimeout(120);
  assert.equal(await cmd(), '"f1"', "clicking it drops its name in the command line, like any other entity");

  await app.page.fill("#cmd", "");
  await app.type('setDefaultFrame("f1")');
  await app.page.mouse.move(on.x + 1, on.y);
  await app.page.waitForTimeout(120);
  assert.match(await app.page.$eval("#hovertag", (el) => el.textContent ?? ""), /\(default\)$/,
    "which frame is the default is the only ambient state that changes what a typed hor means");
});

test("tilting the frame by its x-ref turns the whole levelled drawing with it", async () => {
  await app.page.fill("#cmd", "");
  // A dimensioned, levelled quadrilateral, pinned to the frame at one corner —
  // levelled against the frame, so the frame is the only thing that decides
  // which way "level" points, and fixed to it, so it also decides where.
  await app.type("pt(-100,20); pt(-40,20); pt(-40,60); pt(-100,60)");
  const [a, b, c, d] = Object.keys((await app.model()).points).slice(-4);
  await app.type(`ln("${a}","${b}"); ln("${b}","${c}"); ln("${c}","${d}"); ln("${d}","${a}")`);
  const lines = (await app.model()).lines.slice(-4).map((l) => l.name);
  await app.type(`hor("${lines[0]}"); ver("${lines[1]}"); hor("${lines[2]}"); ver("${lines[3]}")`);
  await app.type(`dist("${a}","${b}",60); dist("${b}","${c}",40)`);
  await app.type(`fix("${a}",[-100,4])`);
  await app.type("solve()");
  assert.equal(await app.status(), "SOLVED", "the fixture is satisfied before anything is tilted");

  const was = await app.model();
  const wasFrame = await frameInfo("f1");
  const wasAngle = angleOf(was.points[a], was.points[b]);

  // Pull the x-ref upward. Nothing else constrains that point, so it goes
  // exactly where the cursor does and the frame turns by exactly that much.
  const [xx, xy] = await screenOf(wasFrame.xrefName);
  await dragFrom(xx, xy, 0, -30);

  const now = await app.model();
  const frame = await frameInfo("f1");
  const turned = frame.tilt - wasFrame.tilt;
  assert.ok(turned > 0.3, `the drag should have tilted the frame appreciably, got ${(turned * 180) / Math.PI}°`);

  // 1. Every levelled edge is *exactly* parallel to the frame's new +x, and
  //    every plumb one exactly across it. Exactly: this is the assertion a
  //    solver that turned the frame instead of the drawing would also pass,
  //    which is why the next two exist as well.
  const ux = [Math.cos(frame.tilt), Math.sin(frame.tilt)];
  const dirOf = (p: string, q: string) => {
    const [u, v] = [now.points[p], now.points[q]];
    const len = Math.hypot(v[0] - u[0], v[1] - u[1]);
    return [(v[0] - u[0]) / len, (v[1] - u[1]) / len];
  };
  for (const [p, q] of [[a, b], [c, d]]) {
    const e = dirOf(p, q);
    assert.ok(Math.abs(e[0] * ux[1] - e[1] * ux[0]) < 1e-6, `${p}${q} is not level with the tilted frame`);
  }
  for (const [p, q] of [[b, c], [d, a]]) {
    const e = dirOf(p, q);
    assert.ok(Math.abs(e[0] * ux[0] + e[1] * ux[1]) < 1e-6, `${p}${q} is not plumb to the tilted frame`);
  }

  // 2. The drawing turned by the frame's own tilt — not by some compromise
  //    between the frame's and its own, which is what a frame the drawing can
  //    push around settles at.
  const nowAngle = angleOf(now.points[a], now.points[b]);
  assert.ok(modPi(nowAngle - wasAngle - turned) < 1e-6,
    `the drawing turned ${(((nowAngle - wasAngle) * 180) / Math.PI).toFixed(4)}° where the frame turned ` +
    `${((turned * 180) / Math.PI).toFixed(4)}°`);

  // 3. It turned rather than deforming: the dimensions are what they were.
  const len = (mm: typeof now, p: string, q: string) =>
    Math.hypot(mm.points[q][0] - mm.points[p][0], mm.points[q][1] - mm.points[p][1]);
  assert.ok(Math.abs(len(now, a, b) - 60) < 1e-6, `the 60 dimension is now ${len(now, a, b)}`);
  assert.ok(Math.abs(len(now, b, c) - 40) < 1e-6, `the 40 dimension is now ${len(now, b, c)}`);

  // 4. And the fixed corner is still at its frame coordinate — which, the frame
  //    having turned, is a different place on the canvas than it was.
  const rel = [now.points[a][0] - frame.origin[0], now.points[a][1] - frame.origin[1]];
  const uy = [-ux[1], ux[0]];
  assert.ok(Math.abs(rel[0] * ux[0] + rel[1] * ux[1] + 100) < 1e-6, "still at -100 along the frame's x");
  assert.ok(Math.abs(rel[0] * uy[0] + rel[1] * uy[1] - 4) < 1e-6, "and 4 along its y");
  assert.ok(Math.hypot(now.points[a][0] - was.points[a][0], now.points[a][1] - was.points[a][1]) > 5,
    "which is a different place on the canvas — the drawing really did move");

  assert.equal(await app.status(), "SOLVED");
  assert.equal(await cmd(), "", "a drag is not a selection");
});

test("dragging the marker moves the frame rigidly, and the pinned drawing follows", async () => {
  await app.page.fill("#cmd", "");
  const was = await app.model();
  const wasFrame = await frameInfo("f1");
  const pinned = Object.keys(was.points).find((n) => n !== wasFrame.originName && n !== wasFrame.xrefName)!;

  const [ox, oy] = await screenOf(wasFrame.originName);
  // 18px along the +x arm: on the marker, clear of the origin point itself.
  const [ux, uy] = [Math.cos(wasFrame.tilt), -Math.sin(wasFrame.tilt)]; // screen y is flipped
  await dragFrom(ox + ux * 18, oy + uy * 18, 40, 25);

  const now = await app.model();
  const frame = await frameInfo("f1");
  const scale = now.view.scale;
  const expected = [40 / scale, -25 / scale];
  for (const [name, before, after] of [
    [wasFrame.originName, wasFrame.origin, frame.origin],
    [wasFrame.xrefName, wasFrame.xref, frame.xref],
  ] as [string, number[], number[]][]) {
    const moved = [after[0] - before[0], after[1] - before[1]];
    assert.ok(Math.abs(moved[0] - expected[0]) < 0.5 && Math.abs(moved[1] - expected[1]) < 0.5,
      `${name} moved by ${moved}, not by the drag offset ${expected}`);
  }
  assert.ok(Math.abs(frame.tilt - wasFrame.tilt) < 1e-9,
    "both points by the same offset, so the frame translated without turning");

  // The drawing is fixed *to the frame*, so it came along — which is the whole
  // claim of a datum: move the datum, move what is dimensioned from it.
  const moved = [now.points[pinned][0] - was.points[pinned][0], now.points[pinned][1] - was.points[pinned][1]];
  assert.ok(Math.abs(moved[0] - expected[0]) < 0.5 && Math.abs(moved[1] - expected[1]) < 0.5,
    `the pinned corner moved by ${moved}, not with the frame`);
  assert.equal(await app.status(), "SOLVED");
});

test("the line tool's aim, its guide and its constraint all read the tilted frame", async () => {
  await app.page.fill("#cmd", "");
  const frame = await frameInfo("f1");
  assert.ok(Math.abs(frame.tilt) > 0.3, "the frame is still tilted from the drag above");

  const before = await app.model();
  await app.type("line");
  // A short segment starting in empty canvas, aimed two degrees off the
  // *frame's* x — which is a good 25° off the canvas's, far outside the
  // 3-degree tolerance, so an answer that lands level can only have come from
  // reading the frame.
  const start = await app.at(760, 90);
  const aim = frame.tilt - (2 * Math.PI) / 180;
  const end = await app.at(760 + Math.cos(aim) * 90, 90 - Math.sin(aim) * 90);
  await app.page.mouse.move(start.x, start.y);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.mouse.move(end.x, end.y, { steps: 4 });
  await app.page.waitForTimeout(80);
  await app.page.mouse.down();
  await app.page.mouse.up();
  await app.page.waitForTimeout(200);
  await app.page.keyboard.press("Escape");

  const now = await app.model();
  const line = now.lines.at(-1)!;
  assert.equal(now.lines.length, before.lines.length + 1, "one segment was drawn");
  const rels = await app.repl(`rels("${line.name}")`);
  assert.ok((rels.value as string[]).some((r) => r.includes("hor")),
    `the constraint that landed is hor: ${JSON.stringify(rels.value)}`);

  // The segment lies along the frame's +x *as placed*, before any solving had
  // to correct it: the preview was pulled onto the same axis the constraint
  // means, so the constraint was already satisfied when it arrived.
  const [p, q] = line.refs.map((n) => now.points[n]);
  const e = [q[0] - p[0], q[1] - p[1]];
  const ux = [Math.cos(frame.tilt), Math.sin(frame.tilt)];
  const wedge = (e[0] * ux[1] - e[1] * ux[0]) / Math.hypot(e[0], e[1]);
  assert.ok(Math.abs(wedge) < 1e-6, `the committed segment is ${(Math.asin(wedge) * 180) / Math.PI}° off the frame's x`);
  // And it is the *aimed* length along that axis: the cursor's offset projected
  // onto the frame's x, not onto the canvas's.
  assert.ok(Math.abs(Math.hypot(e[0], e[1]) - 90 / now.view.scale) < 0.5,
    `the segment is ${Math.hypot(e[0], e[1])} long, not the ${90 / now.view.scale} the cursor travelled along the axis`);
  assert.equal(await app.status(), "SOLVED");
});

test("a framed drawing round-trips through save and open, default pointer and all", async () => {
  await app.page.fill("#cmd", "");
  const before = await app.model();
  const beforeFrame = await frameInfo("f1");
  const text = await app.repl("save()");
  assert.ok(text.ok);

  await app.repl(`open(${JSON.stringify(text.value)})`);
  await app.page.waitForTimeout(200);

  const after = await app.model();
  const afterFrame = await frameInfo("f1");
  assert.equal(after.size, before.size, "every entity came back");
  assert.ok(after.journalOps.includes("addFrame") && after.journalOps.includes("setDefaultFrame"),
    "including the frame and the pointer at it, which is a journal entry like any other");
  assert.equal(afterFrame.isDefault, true, "and the default is still the default");
  assert.ok(Math.abs(afterFrame.tilt - beforeFrame.tilt) < 1e-9,
    `the frame reopened at ${afterFrame.tilt} rather than the ${beforeFrame.tilt} it was saved at`);
  for (const name of Object.keys(before.points)) {
    assert.ok(Math.hypot(after.points[name][0] - before.points[name][0],
      after.points[name][1] - before.points[name][1]) < 1e-9,
      `${name} reopened at ${after.points[name]}, not ${before.points[name]}`);
  }
  assert.equal(await app.status(), "SOLVED");
  const again = await app.repl("save()");
  assert.equal(again.value, text.value, "and saving it again is the same file, byte for byte");
});

test("a box catches the frame by its marker, and del takes the frame's relations with it", async () => {
  await app.page.fill("#cmd", "");
  const frame = await frameInfo("f1");
  const [ox, oy] = await screenOf(frame.originName);

  // A crossing box (right → left) over the marker alone.
  const from = await app.at(ox + 45, oy - 45);
  const to = await app.at(ox + 8, oy - 8);
  await app.page.mouse.move(from.x, from.y);
  await app.page.mouse.down();
  await app.page.mouse.move(to.x, to.y, { steps: 6 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(150);
  assert.match(await cmd(), /"f1"/, `a box over the marker selects the frame: got ${await cmd()}`);

  await app.page.fill("#cmd", "");
  const removed = await app.repl('del("f1")');
  assert.ok(removed.ok, `del failed: ${removed.error}`);
  const names = removed.value as string[];
  assert.ok(names.includes("f1"), "the frame went");
  assert.ok(names.some((n) => n.startsWith("r")), `and the relations written against it: ${names.join(", ")}`);
  assert.equal(await app.repl("defaultFrame()").then((r) => r.value), null,
    "the default is a pointer at a frame, so it cannot outlive one");

  const m = await app.model();
  assert.ok(m.points[frame.originName], "its points are ordinary points and stay — the line rules");
  assert.ok(m.points[frame.xrefName]);
  // And the vocabulary that needed it says so again, rather than silently
  // meaning something else.
  await app.type(`hor("${m.lines[0].name}")`);
  assert.match(await app.log(), /no default frame/);
});

test("no uncaught page errors", () => {
  assert.deepEqual(app.pageErrors, []);
});
