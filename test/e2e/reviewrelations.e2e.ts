// Many at once is one relation among equals, and a face is named by what it
// is swept from — in the real app, with a mouse and on an iPhone 13 by finger
// (docs/plans/review-relations.md). The owner's principle: *"correct
// relationships BETWEEN entities … bidirectional relationships everywhere by
// default"* — nothing privileged, nothing consumed.
//
// - four lines picked with the constrain tool and Parallel (all 4) pressed:
//   one relation, a `//` on each line and none wearing three; the first line
//   picked deleted by hand, and the other three still turn together under a
//   drag — which, when the relation was a star on the first pick, they did
//   not: the star went with its hub;
// - a wall of one block dimensioned to a wall of another with the dimension
//   tool: `fdist("e1:l2", "e2:l14", 50)`, each wall written by the line it is
//   swept from; then the first block's corner cut off with a line and two
//   trims, which puts a new wall in place 1 and moves l2's up one — and the
//   dimension is still on its two walls, still 50, and `set` still moves the
//   other block.
//
// The unit suite (test/reviewrelations.test.ts) holds the relations, the
// joins, the old files. What only a browser shows is whether a pick lands as
// the name the list reads, whether the marks read one a line, whether the
// drag is a hand's, and whether the dimension's label is still drawn between
// its walls after the profile changed under it. Set NEOCAD_E2E_SHOTS to keep
// the pictures (470–477); look at them.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetAutosave, openApp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

const built = existsSync(new URL("../../src/solids/smlib-gen/smlib.mjs", import.meta.url));
void built;

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.waitForTimeout(300);
  await app.page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

interface Probe {
  __neocad: {
    model: {
      relations: Map<string, { op: string; args: unknown[] }>;
      entities: Map<string, { kind: string }>;
      features: Map<string, { loops: (string | { name: string })[][] }>;
      coords(n: string): number[];
      line(n: string): { refs: [string, string] };
    };
    engine: {
      armed: { name: string } | null;
      active: { picks?: string[] } | null;
      glyphs(): { relation: string; op: string; symbol: string; screen: [number, number] }[];
    };
  };
}

const relations = (app: AppContext) => app.page.evaluate(() =>
  [...(window as never as Probe).__neocad.model.relations.entries()].map(([name, r]) => ({ name, op: r.op, args: r.args })));
const glyphs = (app: AppContext) => app.page.evaluate(() => (window as never as Probe).__neocad.engine.glyphs());
const coords = (app: AppContext, n: string): Promise<number[]> => app.page.evaluate((p) => (window as never as Probe).__neocad.model.coords(p), n);
const has = (app: AppContext, n: string) => app.page.evaluate((p) => (window as never as Probe).__neocad.model.entities.has(p), n);
const picks = (app: AppContext) => app.page.evaluate(() => [...((window as never as Probe).__neocad.engine.active?.picks ?? [])]);
const state = (app: AppContext) => app.page.evaluate(() => {
  const e = (window as never as Probe).__neocad.engine;
  return JSON.stringify({ armed: e.armed?.name ?? null, picks: e.active?.picks ?? null });
});
const rows = (app: AppContext) => app.page.$$eval("#constraints .ocmd", (els) => els.map((e) => ({
  label: e.querySelector(".olabel")?.textContent ?? "", command: (e as HTMLElement).dataset.command ?? "", more: e.classList.contains("more"),
})));

/** Each line's direction, as numbers. */
const directions = (app: AppContext, lines: string[]) => app.page.evaluate((ls) => {
  const m = (window as never as Probe).__neocad.model;
  return ls.map((l) => { const [a, b] = m.line(l).refs.map((p) => m.coords(p)); return b.map((v, i) => v - a[i]); });
}, lines);
/** |sin| of the angle between two directions. */
function sinBetween(u: number[], v: number[]): number {
  const dot = u.reduce((s, x, i) => s + x * v[i], 0);
  const c = dot / (Math.hypot(...u) * Math.hypot(...v));
  return Math.sqrt(Math.max(0, 1 - c * c));
}

/** A point along a line, `t` of the way from its first end, in canvas pixels. */
async function along(app: AppContext, line: string, t: number): Promise<[number, number]> {
  const [a, b] = await app.page.evaluate((l) => {
    const m = (window as never as Probe).__neocad.model;
    const refs = m.line(l).refs;
    return [m.coords(refs[0]), m.coords(refs[1])];
  }, line);
  return app.screenOf(a.map((v, i) => v + t * (b[i] - v)));
}

/** An element's middle, in canvas pixels — what a finger is given. */
const middleOf = (app: AppContext, selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
  return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
});

/** One way of working the app: a mouse on a desktop, or a finger on a phone. */
interface Hand {
  name: "desktop" | "iphone";
  app: AppContext;
  press(at: [number, number]): Promise<void>;
  drag(from: [number, number], to: [number, number]): Promise<void>;
  /** A press on the constraints palette's row with this label. */
  row(label: string): Promise<void>;
  /** The constrain tool, by its button. */
  armConstrain(): Promise<void>;
  /** Deletes what is at `at`, by hand: a click and the Delete key, or a held finger and the menu's Delete. */
  remove(at: [number, number]): Promise<void>;
}

let desk: AppContext, phone: AppContext, f: Fingers;
let mouse: Hand, finger: Hand;

before(async () => {
  desk = await openApp();
  phone = await openApp({ device: "iPhone 13" });
  mouse = {
    name: "desktop",
    app: desk,
    async press(at) {
      const p = await desk.at(...at);
      await desk.page.mouse.click(p.x, p.y);
      await desk.page.waitForTimeout(150);
    },
    async drag(from, to) {
      const p = await desk.at(...from), q = await desk.at(...to);
      await desk.page.mouse.move(p.x, p.y);
      await desk.page.mouse.down();
      await desk.page.mouse.move(q.x, q.y, { steps: 12 });
      await desk.page.mouse.up();
      await desk.page.waitForTimeout(300);
    },
    async row(label) {
      const box = await desk.page.locator("#constraints .ocmd", { has: desk.page.locator(".olabel", { hasText: new RegExp(`^${label.replace(/[()…]/g, "\\$&")}$`) }) }).boundingBox();
      assert.ok(box, `a row labelled ${label}: ${JSON.stringify(await rows(desk))}`);
      await desk.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
      await desk.page.waitForTimeout(300);
    },
    async armConstrain() {
      await desk.page.hover('#toolbar button[data-group="relate"]');
      await desk.page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
      await desk.page.click('#flyout button[data-tool="constrain"]');
      await desk.page.waitForTimeout(200);
    },
    async remove(at) {
      await mouse.press(at);
      await desk.page.keyboard.press("Delete");
      await desk.page.waitForTimeout(300);
    },
  };
  finger = {
    name: "iphone",
    app: phone,
    async press(at) {
      await phone.at(...at); // throws if a pane is there
      await f.tap(...at);
      await phone.page.waitForTimeout(250);
    },
    async drag(from, to) {
      await phone.at(...from);
      await f.drag(from, to, 12);
      await phone.page.waitForTimeout(300);
    },
    async row(label) {
      const at = await phone.page.evaluate((want) => {
        const row = Array.from(document.querySelectorAll<HTMLElement>("#constraints .ocmd")).find((r) => r.querySelector(".olabel")?.textContent === want);
        if (!row) return null;
        const r = row.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
        return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
      }, label);
      assert.ok(at, `a row labelled ${label}: ${JSON.stringify(await rows(phone))}`);
      await f.tap(...at!);
      await phone.page.waitForTimeout(300);
    },
    async armConstrain() {
      await f.hold(...await middleOf(phone, '#toolbar button[data-group="relate"]'), 700);
      await phone.page.waitForSelector('#flyout button[data-tool="constrain"]', { state: "visible", timeout: 3000 });
      await f.tap(...await middleOf(phone, '#flyout button[data-tool="constrain"]'));
      await phone.page.waitForTimeout(200);
    },
    async remove(at) {
      await phone.at(...at);
      await f.hold(...at, 700);
      await phone.page.waitForSelector("#ctxmenu .item", { state: "visible", timeout: 3000 });
      const item = await phone.page.evaluate(() => {
        const el = Array.from(document.querySelectorAll("#ctxmenu .item")).find((e) => e.firstElementChild?.textContent === "Delete");
        if (!el) return null;
        const r = el.getBoundingClientRect(), c = document.getElementById("cv")!.getBoundingClientRect();
        return [r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y] as [number, number];
      });
      assert.ok(item, "the menu has Delete");
      await f.tap(...item!);
      await phone.page.waitForTimeout(350);
    },
  };
});
after(async () => { await desk.close(); await phone.close(); });

async function fresh(hand: Hand): Promise<void> {
  const app = hand.app;
  await app.page.evaluate(() => localStorage.clear());
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  if (hand.name === "iphone") f = await fingers(phone);
}

/** Types a line, then lets go of the command line, as a hand does before it touches the drawing again. */
async function type(hand: Hand, line: string): Promise<void> {
  await hand.app.type(line);
  await hand.app.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await hand.app.page.waitForTimeout(150);
}

const FOUR = ["l1", "l2", "l3", "l4"];

for (const which of ["desktop", "iphone"] as const) {
  const hand = () => (which === "desktop" ? mouse : finger);
  const picture = (desktop: string, iphone: string) => (which === "desktop" ? desktop : iphone);

  test(`${which}: four lines, Parallel (all 4) — one relation, a mark on each; the first deleted, the other three still turn together under a drag`, async () => {
    const h = hand();
    await fresh(h);
    // Four lines fanned out from a column of points, each pinned at its left
    // end and held to its length — so what is left to each is its angle, and
    // parallel among them leaves the four one angle between them. Spaced for
    // the room an iPhone 13 has between its panes with the palette up
    // (relationscomplete.e2e.ts's five lines, which these sit inside).
    await type(h, "ln(pt(-45, 24), pt(-5, 28)); ln(pt(-45, 14), pt(-12, 21)); ln(pt(-45, 4), pt(-8, 1)); ln(pt(-45, -6), pt(-15, -12))");
    await type(h, 'fix("p1", [-45, 24]); fix("p3", [-45, 14]); fix("p5", [-45, 4]); fix("p7", [-45, -6])');
    await type(h, 'dist("p1", "p2", 40); dist("p3", "p4", 34); dist("p5", "p6", 37); dist("p7", "p8", 31)');
    assert.equal(await h.app.status(), "SOLVED");
    await h.armConstrain();
    for (const l of FOUR) await h.press(await along(h.app, l, 0.5));
    assert.deepEqual(await picks(h.app), FOUR, await state(h.app));
    let listed = await rows(h.app);
    const more = listed.find((r) => r.more);
    if (more && !listed.some((r) => r.label === "Parallel (all 4)")) { await h.row(more.label); listed = await rows(h.app); }
    const row = listed.find((r) => r.label === "Parallel (all 4)");
    assert.equal(row?.command, 'par("l1", "l2", "l3", "l4")', `one call, naming the four: ${JSON.stringify(listed)}`);
    await h.row("Parallel (all 4)");
    const made = (await relations(h.app)).filter((r) => r.op === "parallel");
    assert.deepEqual(made.map((r) => r.args), [FOUR], "one relation among the four");
    assert.equal(await h.app.status(), "SOLVED");
    const marks = (await glyphs(h.app)).filter((g) => g.relation === made[0].name);
    assert.deepEqual(marks.map((g) => g.symbol), ["//", "//", "//", "//"], "a // on each line, and none of them wearing three");
    let dirs = await directions(h.app, FOUR);
    for (const d of dirs) assert.ok(sinBetween(d, dirs[0]) < 1e-6, `parallel: ${JSON.stringify(dirs)}`);
    await type(h, "select");
    await shot(h.app, picture("470-four-lines-parallel-one-relation-a-mark-on-each", "474-iphone-four-lines-parallel-one-relation"));

    // The first pick, deleted by hand. Its relation stays, over the other three.
    await h.remove(await along(h.app, "l1", 0.5));
    assert.equal(await has(h.app, "l1"), false, `l1 is deleted: ${(await h.app.log()).split("\n").slice(-4).join(" / ")}`);
    const after = (await relations(h.app)).filter((r) => r.op === "parallel");
    assert.deepEqual(after.map((r) => [r.name, r.args]), [[made[0].name, ["l2", "l3", "l4"]]], "the same relation, over the rest");
    assert.match(await h.app.log(), /l1 left it, and it holds among the rest/);

    // Under a drag: l2's free end pulled round, and l3 and l4 turn with it.
    const before = await directions(h.app, ["l2", "l3", "l4"]);
    // To where a turn of 25° about its pinned end would put it, whatever the scale.
    const [pin, free] = [await coords(h.app, "p3"), await coords(h.app, "p4")];
    const [dx, dy] = [free[0] - pin[0], free[1] - pin[1]];
    const [c, s] = [Math.cos(-25 * Math.PI / 180), Math.sin(-25 * Math.PI / 180)];
    const target = [pin[0] + c * dx - s * dy, pin[1] + s * dx + c * dy, free[2] ?? 0];
    await h.drag(await h.app.screenOf(free), await h.app.screenOf(target));
    dirs = await directions(h.app, ["l2", "l3", "l4"]);
    assert.ok(sinBetween(dirs[0], before[0]) > 0.15, `l2 turned under the hand: ${JSON.stringify([before[0], dirs[0]])}`);
    for (const [i, d] of dirs.entries()) {
      assert.ok(sinBetween(d, dirs[0]) < 1e-6, `still parallel with the first pick gone: ${JSON.stringify(dirs)}`);
      assert.ok(sinBetween(d, before[i]) > 0.15, `l${i + 2} turned with it`);
    }
    assert.equal(await h.app.status(), "SOLVED");
    await shot(h.app, picture("471-the-first-pick-deleted-the-other-three-turn-together", "475-iphone-the-first-pick-deleted-the-rest-turn-together"));
  });

  test(`${which}: a wall of one block dimensioned to a wall of another, then the first block's corner trimmed off — the dimension is still on its walls`, { skip: built ? false : "no SMLib build — run `npm run build:solids`" }, async () => {
    const h = hand();
    await fresh(h);
    // Two blocks on the ground, their sides level and upright, each free to
    // slide: e1 60 × 40 × 20 with its +x wall at x = 60 (l2), e2 30 × 30 × 12
    // behind and to the right with its +x wall at x = 110.
    const block = (names: string, pts: [number, number][], depth: number, first: string) =>
      `${pts.map(([x, y], i) => `${names}${i} = pt(${x}, ${y}, 0)`).join("; ")}; `
      + `${pts.map((_, i) => `${names}l${i} = ln(${names}${i}, ${names}${(i + 1) % pts.length})`).join("; ")}; `
      + `${pts.map((_, i) => `onplane(${names}${i}); par(${names}l${i}, "origin.${i % 2 ? "y" : "x"}")`).join("; ")}; ${first} = extrude(${names}l0, ${depth})`;
    await type(h, "plane()");
    await type(h, block("a", [[0, 0], [60, 0], [60, 40], [0, 40]], 20, "ea"));
    await type(h, block("b", [[80, 50], [110, 50], [110, 80], [80, 80]], 12, "eb"));
    assert.equal(await h.app.status(), "SOLVED");
    const bWall = (await h.app.repl("bl1")).value as string;
    assert.match(bWall, /^l\d+$/);
    // From in front, to the right and above: both +x walls in sight.
    await type(h, `orbit(0, -0.9); orbit(-1.2, 0); ${which === "desktop" ? "zoom(1.6); pan(-150, 60)" : "zoom(0.8); pan(-60, 40)"}; arm("dimension")`);
    await h.press(await h.app.screenOf([60, 22, 10]));
    await h.press(await h.app.screenOf([110, 66, 6]));
    assert.deepEqual(await picks(h.app), ["e1:l2", `e2:${bWall}`], `each wall by the line it is swept from: ${await state(h.app)}`);
    await shot(h.app, picture("472-two-walls-of-two-blocks-picked-each-named-by-its-line", "476-iphone-two-walls-of-two-blocks-picked"));
    // Where the label goes: the ground between the two blocks, in front.
    await h.press(await h.app.screenOf([88, 18, 0]));
    await h.app.page.waitForTimeout(500);
    const dim = (await relations(h.app)).find((r) => r.op === "faceDistance");
    assert.deepEqual(dim?.args, ["e1:l2", `e2:${bWall}`, 50], `a driving distance between the two walls: ${(await h.app.log()).split("\n").slice(-4).join(" / ")}`);
    assert.ok((await glyphs(h.app)).some((g) => g.relation === dim!.name && g.symbol === "50"), "labelled 50");
    await type(h, "select");

    // The corner between l1 and l2 cut off: a line across it, and the two
    // stubs trimmed back to it. A new wall stands in place 1 of the profile,
    // and l2's — the one dimensioned — has moved from place 1 to place 2.
    await type(h, "ln(pt(45, -10, 0), pt(70, 15, 0))");
    await type(h, 'trim("l1", [58, 0, 0]); trim("l2", [60, 2, 0])');
    const loops = await h.app.page.evaluate(() => (window as never as Probe).__neocad.model.features.get("e1")!.loops[0].map((x) => (typeof x === "string" ? x : x.name)));
    assert.equal(loops.length, 5, `five sides now: ${loops}`);
    assert.equal(loops.indexOf("l2"), 2, `l2 has moved up a place: ${loops}`);
    assert.equal(await h.app.status(), "SOLVED");
    const still = (await relations(h.app)).find((r) => r.name === dim!.name);
    assert.deepEqual(still?.args, ["e1:l2", `e2:${bWall}`, 50], "the dimension names the walls it named");
    const gap = () => h.app.page.evaluate(async ([a, b]) => {
      const [measurePath] = ["/src/relations/measure.ts"];
      const { measured } = await import(measurePath);
      return measured((window as never as Probe).__neocad.model, ["fdist", a, b]) as number;
    }, ["e1:l2", `e2:${bWall}`]);
    assert.ok(Math.abs(await gap() - 50) < 1e-6, `and still measures 50 between them: ${await gap()}`);
    // The wall it is on is x = 60 still — not the cut's sloping wall, which is what stands in place 1 now.
    const wallX = async (line: string) => { const [a, b] = await Promise.all((await h.app.page.evaluate((l) => (window as never as Probe).__neocad.model.line(l).refs, line)).map((p) => coords(h.app, p))); return [a[0], b[0]]; };
    const [x0, x1] = await wallX("l2");
    assert.ok(Math.abs(x0 - x1) < 1e-6, `l2 is upright: ${x0}, ${x1}`);
    const label = (await glyphs(h.app)).find((g) => g.relation === dim!.name);
    assert.equal(label?.symbol, "50", "its label is still drawn");
    // The hand on the label: what it holds is lit — the two lines its walls
    // are swept from — and a mouse's tag says so in the relation's own words.
    if (which === "desktop") {
      const at = await desk.at(...label!.screen);
      await desk.page.mouse.move(at.x, at.y);
      await desk.page.waitForTimeout(250);
      assert.match(await desk.page.$eval("#hovertag", (el) => el.textContent ?? ""), new RegExp(`e1:l2 e2:${bWall} 50`), "the hover tag names the two walls");
    } else {
      await h.press(label!.screen);
    }
    await shot(h.app, picture("473-the-corner-trimmed-off-the-dimension-still-on-its-walls", "477-iphone-the-corner-trimmed-off-the-dimension-still-on-its-walls"));
    await type(h, "select()");

    // And it still drives: set to 30, the blocks close up by 20.
    const before = (await wallX(bWall))[0] - (await wallX("l2"))[0];
    await type(h, `set("${dim!.name}.value", 30)`);
    assert.equal(await h.app.status(), "SOLVED");
    assert.ok(Math.abs(await gap() - 30) < 1e-6, `set moves the walls it names: ${await gap()}`);
    const now = (await wallX(bWall))[0] - (await wallX("l2"))[0];
    assert.ok(Math.abs(before - 50) < 1e-6 && Math.abs(now - 30) < 1e-6, `x = 60 to x = 110, then 20 closer: ${before} → ${now}`);
  });
}

test("desktop: the palette lists a relation among many once, and a line's menu offers to leave it", async () => {
  const h = mouse;
  await fresh(h);
  await type(h, "ln(pt(-45, 24), pt(-5, 28)); ln(pt(-45, 14), pt(-12, 21)); ln(pt(-45, 4), pt(-8, 1)); ln(pt(-45, -6), pt(-15, -12))");
  // Each pinned at an end and held to its length, as in the first test: free lines made parallel are met by
  // shortening them as well as by turning them (the register's review item 1, not this package's), which the picture showed.
  await type(h, 'fix("p1", [-45, 24]); fix("p3", [-45, 14]); fix("p5", [-45, 4]); fix("p7", [-45, -6]); dist("p1", "p2", 40); dist("p3", "p4", 34); dist("p5", "p6", 37); dist("p7", "p8", 31)');
  await type(h, 'par("l1", "l2", "l3", "l4")');
  // A typed pair naming a member joins it: still one relation.
  await type(h, 'ln(pt(-45, -16), pt(-10, -24)); fix("p9", [-45, -16]); dist("p9", "p10", 36)');
  await type(h, 'par("l3", "l5")');
  const pars = (await relations(desk)).filter((r) => r.op === "parallel");
  assert.deepEqual(pars.map((r) => r.args), [["l1", "l2", "l3", "l4", "l5"]]);
  await type(h, 'ui({ show: "constraints" })');
  const held = await desk.page.$$eval('#constraints [data-section="all"] .crow', (els) => els.map((e) => ({
    name: (e as HTMLElement).dataset.name ?? "", text: e.querySelector(".cdesc")?.textContent ?? "", glyph: e.querySelector(".cglyph")?.textContent ?? "",
  })));
  assert.deepEqual(held.filter((r) => r.glyph === "//").map((r) => [r.name, r.text]), [[pars[0].name, "par l1 l2 l3 l4 l5"]], "one row for the five");
  assert.equal(held.length, 11, "beside the five pins and the five lengths");
  // A line's own menu: Leave r1.
  const at = await desk.at(...await along(desk, "l4", 0.5));
  await desk.page.mouse.move(at.x, at.y);
  await desk.page.mouse.down({ button: "right" });
  await desk.page.mouse.up({ button: "right" });
  await desk.page.waitForTimeout(200);
  const items = await desk.page.$$eval("#ctxmenu .item", (els) => els.map((el) => el.firstElementChild?.textContent ?? ""));
  const leave = items.find((t) => t.startsWith("Leave "));
  assert.equal(leave, `Leave ${pars[0].name} (// with l1, l2, l3, l5)`, items.join(" | "));
  await shot(desk, "478-the-palette-lists-the-relation-once-a-line-may-leave-it");
  const handle = await desk.page.evaluateHandle((want) =>
    Array.from(document.querySelectorAll("#ctxmenu .item")).find((el) => el.firstElementChild?.textContent === want) ?? null, leave);
  await handle.asElement()!.click();
  await desk.page.waitForTimeout(300);
  assert.deepEqual((await relations(desk)).filter((r) => r.op === "parallel").map((r) => r.args), [["l1", "l2", "l3", "l5"]], "l4 left; the line and the relation stay");
  assert.equal(await has(desk, "l4"), true);
});

test("desktop: the wall under the hand is named by its line before the click, and a point put on it stays on it when the profile's first corner is rounded", { skip: built ? false : "no SMLib build — run `npm run build:solids`" }, async () => {
  const h = mouse;
  await fresh(h);
  // A block held by two opposite corners with its sides level and upright, so
  // a corner between them can be rounded and the walls stand where they did.
  await type(h, "a0 = pt(0, 0, 0); a1 = pt(60, 0, 0); a2 = pt(60, 40, 0); a3 = pt(0, 40, 0); ln(a0, a1); ln(a1, a2); ln(a2, a3); ln(a3, a0)");
  await type(h, 'fix(a0, [0, 0, 0]); fix(a2, [60, 40, 0]); par("l1", "origin.x"); par("l2", "origin.y"); par("l3", "origin.x"); par("l4", "origin.y"); extrude("l1", 20)');
  // From behind and to the left: the x = 0 wall (l4's, the last in the profile) and the back wall in sight.
  await type(h, 'orbit(0, -0.9); orbit(2.2, 0); zoom(1.6); arm("point")');
  const at = await desk.at(...await desk.screenOf([0, 22, 9]));
  await desk.page.mouse.move(at.x, at.y, { steps: 3 });
  await desk.page.waitForTimeout(300);
  const chip = await desk.page.$eval("#mode", (el) => (el as HTMLElement).dataset.where ?? "");
  assert.equal(chip, "on e1:l4", "where the click will land, in the name the relation will hold");
  await shot(desk, "479-a-wall-under-the-hand-named-by-the-line-it-is-swept-from");
  await desk.page.mouse.click(at.x, at.y);
  await desk.page.waitForTimeout(300);
  const held = (await relations(desk)).filter((r) => r.op === "onPlane" && r.args[1] === "e1:l4");
  assert.equal(held.length, 1, `the point is held on the wall, by that name: ${JSON.stringify(await relations(desk))}`);
  const p = held[0].args[0] as string;
  const was = await coords(desk, p);
  assert.ok(Math.abs(was[0]) < 1e-6, `on x = 0: ${was}`);
  // The profile's first corner rounded: an arc joins it at place 1, and every
  // wall after it — l4's among them — is one place further on. The point
  // stays on l4's wall; held by the place, it went to the next wall's.
  await type(h, 'select; fillet("l1", "l2", 6)');
  assert.equal(await h.app.status(), "SOLVED");
  const loops = await desk.page.evaluate(() => (window as never as Probe).__neocad.model.features.get("e1")!.loops[0].map((x) => (typeof x === "string" ? x : x.name)));
  assert.equal(loops.indexOf("l4"), 4, `l4 is in place 4 now: ${loops}`);
  const now = await coords(desk, p);
  assert.ok(Math.abs(now[0]) < 1e-6 && Math.abs(now[1] - was[1]) < 1e-3, `still on x = 0, where it was put: ${was} → ${now}`);
});

test("no uncaught page errors", () => {
  assert.deepEqual(desk.pageErrors, []);
  assert.deepEqual(phone.pageErrors, []);
});
