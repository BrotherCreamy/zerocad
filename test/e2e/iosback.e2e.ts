// iOS has no back button, so in the installed app the only thing the
// session history is used for is iOS's own edge swipe: from the left edge it
// goes back, from the right edge forward. The owner, 2026-11-06: *"after
// installing as PWA, in the app if I swipe right from the left or right side,
// it takes me "back" or forward. How can I disable this kind of navigation"*.
//
// A page cannot turn the swipe off, but the swipe does nothing when the page
// has one entry and nothing either side of it. So on an iPhone the back stack
// (src/backstack.ts, built for Android's back) pushes nothing: no guard, and
// no entry for what opens. This drives the app as the owner does, by finger,
// and counts the entries. It is not marked installed: the guard went up for
// a coarse pointer *or* an installed app (main.ts), and an iPhone's finger is
// coarse in Safari too, where the same swipe navigates. (CDP's
// `display-mode` emulation does not reach `matchMedia` here.)
//
// The same session's Android back is android.e2e.ts's, and stays as it was.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { CDPSession } from "playwright";
import { forgetAutosave, openApp, timedCdp, type AppContext } from "./harness.ts";
import { fingers, type Fingers } from "./fingers.ts";

let app: AppContext;
let cdp: CDPSession;
let f: Fingers;

before(async () => {
  app = await openApp({ device: "iPhone 13" });
  cdp = timedCdp(await app.page.context().newCDPSession(app.page));
  await forgetAutosave(app.page);
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
  f = await fingers(app);
});
after(async () => { await app.close(); });

const middleOf = (selector: string) => app.page.$eval(selector, (el) => {
  const r = el.getBoundingClientRect();
  return [r.x + r.width / 2, r.y + r.height / 2] as [number, number];
});

/** Window points to canvas points, as `fingers` takes them. */
async function onScreen(at: [number, number]): Promise<[number, number]> {
  const box = await app.page.$eval("#cv", (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y }; });
  return [at[0] - box.x, at[1] - box.y];
}

async function until<T>(read: () => Promise<T>, want: (t: T) => boolean, what: string): Promise<T> {
  const deadline = Date.now() + 6000;
  for (;;) {
    const v = await read();
    if (want(v)) return v;
    if (Date.now() > deadline) assert.fail(`${what}: still ${JSON.stringify(v)}`);
    await app.page.waitForTimeout(60);
  }
}

const shown = (id: string) => app.page.$eval(`#${id}`, (el) => !(el as HTMLElement).hidden);
/** The session history: how many entries, and which one the page is on. */
const entries = async () => {
  const h = await cdp.send("Page.getNavigationHistory");
  return { length: h.entries.length, at: h.currentIndex };
};

test("on an iPhone: taps, the logo menu and a flyout opened and closed push no history — so the edge swipe has nowhere to go", async () => {
  assert.equal(await app.page.evaluate(() => matchMedia("(pointer: coarse)").matches), true, "a finger");
  const start = await entries();
  const canvas = await app.page.$eval("#cv", (el) => { const r = el.getBoundingClientRect(); return [r.width / 2, r.height / 2] as [number, number]; });

  // A tap on the drawing: on Android this is the press that puts the guard up.
  await f.tap(...canvas);
  // The logo's menu, opened by a finger and closed by a tap outside.
  await f.tap(...await onScreen(await middleOf("#logo")));
  await until(() => shown("appmenu"), Boolean, "the menu opened");
  await f.tap(...canvas);
  await until(() => shown("appmenu"), (s) => !s, "a tap outside closed it");
  // A group's flyout, opened by a held finger and closed by a tap outside.
  await f.hold(...await onScreen(await middleOf('#toolbar button[data-group="shapes"]')), 700);
  await until(() => shown("flyout"), Boolean, "the flyout opened");
  await f.tap(...canvas);
  await until(() => shown("flyout"), (s) => !s, "a tap outside closed it");

  const end = await entries();
  // The test's browser opens about:blank first, so the page starts on its
  // second entry here; the installed app starts with only its own. What
  // matters is that nothing was added either side of it.
  assert.deepEqual(end, start, "not one entry pushed: nothing new behind the page for a swipe from the left, nothing ahead for one from the right");
  assert.equal(end.at, end.length - 1, "and nothing ahead of it");
  assert.equal(await app.page.evaluate(() => history.state), null, "and no guard on it");
  assert.deepEqual(app.pageErrors, []);
});
