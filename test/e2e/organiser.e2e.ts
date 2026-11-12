// The organiser pane (docs/plans/organiser.md), driven the way a user drives
// it: the pane lists the groups and the features; the eye hides and shows; a
// row tap selects; ＋ with nothing selected opens a new empty group, a
// rectangle drawn then joins it and the pane's count says 8; the row menu's
// items type their commands; the pane is in the app menu's Panes and hides and
// shows from there; and under a finger, in both orientations.
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the pictures — the desktop, and
// an iPhone 13 portrait and landscape — and look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { openApp, axisFrame, forgetAutosave, type AppContext } from "./harness.ts";
import { fingers } from "./fingers.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `organiser-${name}.png`) });
}

const PANE = '.panel[data-panel="organiser"]';
const row = (name: string) => `${PANE} .orow[data-name="${name}"]`;

/** Each row as the pane shows it: name, count, eye, open. */
async function rows(app: AppContext, section: string): Promise<[string, string, string, boolean][]> {
  return app.page.$$eval(`${PANE} .osect[data-section="${section}"] .orow`, (els) => els.map((el) => [
    el.querySelector(".oname")?.textContent ?? "",
    el.querySelector(".ocount")?.textContent ?? "",
    (el.querySelector(".oeye") as HTMLElement | null)?.dataset.eye ?? "",
    (el as HTMLElement).dataset.open !== undefined,
  ] as [string, string, string, boolean]));
}

/** The last line the log shows as typed — what a press of the pane typed through `submit`. */
async function lastTyped(app: AppContext): Promise<string> {
  const typed = await app.page.$$eval("#log .in", (els) => els.map((e) => e.textContent ?? ""));
  return (typed.at(-1) ?? "").replace(/^> /, "");
}

async function drag(app: AppContext, from: [number, number], to: [number, number]): Promise<void> {
  const a = await app.at(...from);
  const b = await app.at(...to);
  await app.page.mouse.move(a.x, a.y);
  await app.page.mouse.down();
  await app.page.mouse.move(b.x, b.y, { steps: 8 });
  await app.page.mouse.up();
  await app.page.waitForTimeout(220);
}

async function menuItems(app: AppContext): Promise<string[]> {
  return app.page.$$eval("#ctxmenu .item", (els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
}

async function choose(app: AppContext, label: string): Promise<void> {
  const handle = await app.page.evaluateHandle((want) =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === want) ?? null, label);
  const el = handle.asElement();
  assert.ok(el, `no item ${label} — had ${(await menuItems(app)).join(", ")}`);
  await el.click();
  await app.page.waitForTimeout(250);
}

const value = async (app: AppContext, src: string) => (await app.repl(src)).value;

/** An element's middle, in page pixels. */
async function centre(app: AppContext, selector: string): Promise<[number, number]> {
  return app.page.$eval(selector, (el) => {
    const r = el.getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2] as [number, number];
  });
}

// --- the desktop ----------------------------------------------------------------

let app: AppContext;
before(async () => {
  app = await openApp();
  await axisFrame(app, [-150, -110]);
});
after(async () => { await app.close(); });

test("the pane is there, bottom right, scaled with the interface, empty sections saying how to fill them", async () => {
  const box = await app.page.$eval(PANE, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, hidden: (el as HTMLElement).hidden };
  });
  assert.equal(box.hidden, false);
  assert.ok(box.x + box.w > 1000 && box.y + box.h > 760, `bottom right: ${JSON.stringify(box)}`);
  assert.deepEqual(await rows(app, "groups"), []);
  assert.match(await app.page.$eval(`${PANE} .osect[data-section="groups"] .onone`, (e) => e.textContent ?? ""), /＋ makes one/);
  const font = () => app.page.$eval(`${PANE} .ohead`, (e) => parseFloat(getComputedStyle(e).fontSize));
  const at100 = await font();
  await app.repl("ui({ scale: 1.5 })");
  await app.page.waitForTimeout(150);
  assert.ok(Math.abs(await font() - at100 * 1.5) < 0.6, "its type follows the interface size");
  await app.repl('ui({ scale: "default" })');
});

test("＋ with nothing selected opens a new empty group; a rectangle drawn joins it, and the count says 8", async () => {
  await app.page.click(`${PANE} .padd`);
  await app.page.waitForTimeout(200);
  assert.equal(await lastTyped(app), "opengroup(group())", "the ＋ typed its command");
  assert.deepEqual(await rows(app, "groups"), [["g1", "0", "none", true]], "empty, and open");
  assert.match(await app.page.$eval("#opengroup", (e) => e.textContent ?? ""), /g1/, "said beside the status, and it does not fade");
  await app.type("rectangle");
  await drag(app, [420, 240], [620, 400]);
  assert.deepEqual(await rows(app, "groups"), [["g1", "8", "shown", true]], "four corners and four edges");
  await app.page.keyboard.press("Escape");
  await app.page.keyboard.press("Escape");
  assert.equal(await value(app, "model.openGroup"), "g1", "Escape does not close it — it is not a tool");
  // The hover tag of new geometry names it.
  const m = await app.model();
  const l = m.lines[0];
  const [a, b] = await Promise.all(l.refs.map((p) => app.screenOf(m.points[p])));
  const at = await app.at(Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2));
  await app.page.mouse.move(at.x, at.y);
  await app.page.waitForTimeout(150);
  assert.match(await app.page.$eval("#hovertag", (e) => e.textContent ?? ""), /·  g1 \(open\)$/);
  await app.page.mouse.move(5, 790);
  await shot(app, "desktop-open-group");
});

test("the open marker closes it; the eye hides and shows; a row tap selects", async () => {
  await app.page.click(`${row("g1")} .oopen`);
  await app.page.waitForTimeout(150);
  assert.equal(await lastTyped(app), "closegroup()");
  assert.deepEqual(await rows(app, "groups"), [["g1", "8", "shown", false]]);
  assert.equal(await app.page.$eval("#opengroup", (e) => e.textContent ?? ""), "");

  await app.page.click(`${row("g1")} .oeye`);
  await app.page.waitForTimeout(150);
  assert.equal(await lastTyped(app), 'hide("g1")');
  assert.deepEqual((await rows(app, "groups"))[0].slice(2, 3), ["hidden"]);
  await app.page.click(`${row("g1")} .oeye`);
  await app.page.waitForTimeout(150);
  assert.equal(await lastTyped(app), 'show("g1")');

  await app.page.click(`${row("g1")} .oname`);
  await app.page.waitForTimeout(150);
  assert.equal(await lastTyped(app), 'select("g1")');
  assert.equal((await app.selection()).length, 8);
  assert.equal(await app.page.$eval(row("g1"), (e) => e.classList.contains("on")), true, "the row is lit while its members are selected");
});

test("an extrude is a Features row; its eye hides it; its menu offers Edit e1, Construction and Delete", async () => {
  await app.repl("select()");
  const m = await app.model();
  await app.type(`extrude("${m.lines[0].name}", 20)`);
  await app.page.waitForTimeout(200);
  const [e1] = await rows(app, "features");
  assert.equal(e1[0], "e1");
  assert.ok(Number(e1[1]) > 8, "what it made");
  await app.page.click(`${row("e1")} .oeye`);
  await app.page.waitForTimeout(150);
  assert.equal(await lastTyped(app), 'hide("e1")');
  await app.page.click(`${row("e1")} .oeye`);
  await app.page.waitForTimeout(150);
  assert.equal(await lastTyped(app), 'show("e1")');
  await app.page.click(`${row("e1")} .oname`, { button: "right" });
  await app.page.waitForTimeout(150);
  assert.deepEqual(await menuItems(app), ["Edit e1", "Construction", "Delete"], "one construction row on every kind: a body's too (docs/plans/fillets-one-thing.md)");
  await shot(app, "desktop-feature-menu");
  await app.page.keyboard.press("Escape");
  await app.page.mouse.click(5, 790);
});

test("the row menu's items type their commands: Add selection, Remove selection, Open, Rename, Ungroup", async () => {
  const m = await app.model();
  const edge = m.lines[0].name;
  await app.repl(`select("${edge}")`);
  await app.page.click(`${row("g1")} .oname`, { button: "right" });
  await app.page.waitForTimeout(150);
  assert.deepEqual(await menuItems(app), ["Rename…", "Add selection", "Remove selection", "Open", "Ungroup"]);
  await choose(app, "Remove selection");
  assert.equal(await lastTyped(app), `removeFrom("g1", "${edge}")`);
  assert.equal((await rows(app, "groups"))[0][1], "7");
  await app.page.click(`${row("g1")} .oname`, { button: "right" });
  await choose(app, "Add selection");
  assert.equal(await lastTyped(app), `addTo("g1", "${edge}")`);
  await app.page.click(`${row("g1")} .oname`, { button: "right" });
  await choose(app, "Open");
  assert.equal(await lastTyped(app), 'opengroup("g1")');
  await app.page.click(`${row("g1")} .oname`, { button: "right" });
  await choose(app, "Rename…");
  assert.equal(await app.page.inputValue("#cmd"), 'rename("g1", "', "put in the command line to finish");
  await app.page.keyboard.type('frame")');
  await app.page.keyboard.press("Enter");
  await app.page.waitForTimeout(200);
  assert.deepEqual((await rows(app, "groups")).map((r) => [r[0], r[3]]), [["frame", true]], "renamed, still open");
  await app.page.click(`${row("frame")} .oname`, { button: "right" });
  await choose(app, "Ungroup");
  assert.equal(await lastTyped(app), 'ungroup("frame")');
  assert.deepEqual(await rows(app, "groups"), []);
  assert.equal(await value(app, "model.openGroup"), null);
  await app.type("undo()");
  assert.deepEqual((await rows(app, "groups")).map((r) => r[0]), ["frame"], "one undo step, the pane follows");
});

test("the pane is in the app menu's Panes, and hides and shows from there", async () => {
  await app.page.click("#logo");
  const listed = await app.page.$$eval("#appmenu .item.check[data-pane]", (els) => els.map((e) => (e as HTMLElement).dataset.pane));
  assert.ok(listed.includes("organiser"), listed.join(", "));
  await app.page.click('#appmenu .item.check[data-pane="organiser"] input');
  await app.page.waitForTimeout(150);
  assert.equal(await app.page.$eval(PANE, (el) => (el as HTMLElement).hidden), true);
  assert.equal(await lastTyped(app), 'ui({ hide: "organiser" })');
  await app.page.click('#appmenu .item.check[data-pane="organiser"] input');
  await app.page.waitForTimeout(150);
  assert.equal(await app.page.$eval(PANE, (el) => (el as HTMLElement).hidden), false);
  await app.page.keyboard.press("Escape");
});

test("the open group survives a save and an open", async () => {
  const saved = (await value(app, "save()")) as string;
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  await app.page.evaluate((s) => (window as unknown as { __neocad: { repl: { eval(s: string): Promise<unknown> } } }).__neocad.repl.eval(`open(${JSON.stringify(s)})`), saved);
  await app.page.waitForTimeout(250);
  assert.deepEqual((await rows(app, "groups")).map((r) => [r[0], r[3]]), [["frame", true]]);
});

test("no uncaught page errors (desktop)", () => {
  assert.deepEqual(app.pageErrors, []);
});

// --- under a finger, both orientations ------------------------------------------

for (const device of ["iPhone 13", "iPhone 13 landscape"] as const) {
  // It started hidden on a phone until docs/plans/everything-fits.md — the
  // owner: "show from start".
  test(`${device}: shown from the start, it fits, and the app menu hides and shows it; ＋ is a finger's target, a tap selects, a long-press opens the row's menu`, async () => {
    const p = await openApp({ device });
    try {
      await axisFrame(p, [-150, -110]);
      const vp = p.page.viewportSize()!;
      assert.equal(await p.page.$eval(PANE, (el) => (el as HTMLElement).hidden), false, "shown from the start");
      const [lx, ly] = await centre(p, "#logo");
      for (const [command, hidden] of [['ui({ hide: "organiser" })', true], ['ui({ show: "organiser" })', false]] as const) {
        await p.page.touchscreen.tap(lx, ly);
        await p.page.waitForTimeout(200);
        // In landscape the menu is taller than the screen and scrolls.
        await p.page.$eval('#appmenu .item.check[data-pane="organiser"]', (el) => el.scrollIntoView({ block: "center" }));
        const [bx, by] = await centre(p, '#appmenu .item.check[data-pane="organiser"]');
        await p.page.touchscreen.tap(bx, by);
        await p.page.waitForTimeout(200);
        assert.equal(await lastTyped(p), command);
        await p.page.keyboard.press("Escape");
        await p.page.waitForTimeout(150);
        assert.equal(await p.page.$eval(PANE, (el) => (el as HTMLElement).hidden), hidden, command);
      }
      const box = await p.page.$eval(PANE, (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, hidden: (el as HTMLElement).hidden };
      });
      assert.equal(box.hidden, false);
      assert.ok(box.x >= 0 && box.right <= vp.width && box.bottom <= vp.height, `inside: ${JSON.stringify(box)}`);
      // The ＋ answers over a finger's 44 px however small it is drawn.
      const hit = await p.page.$eval(`${PANE} .padd`, (el) => {
        const b = getComputedStyle(el, "::before");
        return [parseFloat(b.width), parseFloat(b.height)];
      });
      assert.ok(hit[0] >= 44 && hit[1] >= 44, `＋ hit ${hit}`);
      const plus = await p.page.$eval(`${PANE} .padd`, (el) => {
        const r = el.getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
      });
      await p.page.touchscreen.tap(plus[0], plus[1]);
      await p.page.waitForTimeout(250);
      assert.equal(await lastTyped(p), "opengroup(group())");
      await p.repl("pt(10, 10)");
      const r = await p.page.$eval(row("g1"), (el) => {
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height };
      });
      assert.ok(r.h >= 44, `a row is a finger's target tall: ${r.h}`);
      const cv = await p.page.$eval("#cv", (el) => { const b = el.getBoundingClientRect(); return [b.x, b.y]; });
      const f = await fingers(p);
      const mid: [number, number] = [r.x + r.w / 2 - cv[0], r.y + r.h / 2 - cv[1]];
      await f.tap(...mid);
      await p.page.waitForTimeout(200);
      assert.equal(await lastTyped(p), 'select("g1")');
      await f.hold(...mid, 700);
      await p.page.waitForTimeout(150);
      assert.deepEqual(await menuItems(p), ["Rename…", "Add selection", "Remove selection", "Close", "Ungroup"],
        "a long-press is the right-click");
      assert.equal(await lastTyped(p), 'select("g1")', "and the release was not also a tap");
      await shot(p, `${device.replace(/ /g, "-")}-menu`);
      await p.page.keyboard.press("Escape");
      await p.page.waitForTimeout(150);
      await shot(p, `${device.replace(/ /g, "-")}`);
      assert.deepEqual(p.pageErrors, []);
    } finally {
      await p.close();
    }
  });
}
