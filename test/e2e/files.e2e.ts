// Files in the running app (docs/plans/files.md): save, open, share, drop,
// the shortcuts, the dirty prompt and the autosave — on a desktop viewport and
// in iPhone 13 emulation.
//
// **Chromium plays every platform here**, so each platform is what the page's
// APIs are made to be before the app loads (an init script): a desktop
// Chromium keeps its pickers, stubbed so a test can see what they were asked
// and what was written; "without the API" deletes them, as Firefox and
// Safari have none; the iPhone has no pickers and a share sheet, stubbed to
// record the file it is handed. What only iOS can show — the real Files
// picker, the real sheet — is the owner's to try (CHANGELOG).

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApp, type AppContext } from "./harness.ts";

const FIXTURE = fileURLToPath(new URL("../fixtures/bracket.zerocad.json", import.meta.url));
const FIXTURE_TEXT = readFileSync(FIXTURE, "utf8");
/** Where pictures go when NEOCAD_E2E_SHOTS names a folder, to be looked at. */
const SHOTS = process.env.NEOCAD_E2E_SHOTS;

/** What the page's file APIs are: `stub` records, `none` deletes, `native` leaves Chromium's own. */
interface Platform {
  pickers: "stub" | "none";
  share: "stub" | "none";
}

interface Recorded {
  savePicks: { suggestedName?: string }[];
  writes: { file: string; text: string }[];
  shares: { name: string; type: string; text: string; title?: string }[];
}

/**
 * Before the app's first line: the pickers stubbed or gone, the share sheet
 * stubbed or gone, and a record of all of it on `window.__files`.
 */
function platform(p: Platform) {
  const w = window as unknown as Record<string, unknown>;
  const rec = { savePicks: [] as unknown[], writes: [] as unknown[], shares: [] as unknown[], openWith: null as string | null };
  w.__files = rec;
  const handle = (name: string) => ({
    kind: "file",
    name,
    async getFile() {
      return new File([(w.__files as { openWith: string }).openWith ?? ""], name, { type: "application/json" });
    },
    async createWritable() {
      let text = "";
      return {
        async write(t: string) { text += t; },
        async close() { rec.writes.push({ file: name, text }); },
      };
    },
  });
  if (p.pickers === "none") {
    delete w.showSaveFilePicker;
    delete w.showOpenFilePicker;
  } else {
    w.showSaveFilePicker = async (o: { suggestedName?: string }) => {
      rec.savePicks.push({ suggestedName: o?.suggestedName });
      return handle(o?.suggestedName ?? "picked.zerocad.json");
    };
    w.showOpenFilePicker = async () => [handle("opened.zerocad.json")];
  }
  const nav = navigator as unknown as Record<string, unknown>;
  if (p.share === "none") {
    // Linux Chromium has no Web Share; nothing to take away, but say so.
    delete nav.share;
    delete nav.canShare;
  } else {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: (d: { files?: File[] }) => !!d?.files?.length });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (d: { files: File[]; title?: string }) => {
        for (const f of d.files) rec.shares.push({ name: f.name, type: f.type, text: await f.text(), title: d.title });
      },
    });
  }
}

const opened: AppContext[] = [];
after(async () => { for (const app of opened) await app.close(); });

async function start(p: Platform, device?: "iPhone 13"): Promise<AppContext> {
  const app = await openApp({ device, init: { fn: platform, arg: p } });
  opened.push(app);
  return app;
}

const recorded = (app: AppContext) => app.page.evaluate(() => (window as unknown as { __files: Recorded }).__files);
/** The host's `document()` — what the app menu's name line reads. */
const doc = (app: AppContext) => app.page.evaluate(() =>
  (window as unknown as { __neocad: { files: { document(): { name: string; dirty: boolean } } } }).__neocad.files.document());
const saved = async (app: AppContext) => (await app.repl("save()")).value as string;

async function reload(app: AppContext): Promise<void> {
  await app.page.reload({ waitUntil: "networkidle" });
  await app.page.waitForFunction(() => document.getElementById("status")?.textContent?.includes("ready"), null, { timeout: 20_000 });
}

/** Waits for the debounced autosave to have written what is on screen. */
async function autosaved(app: AppContext): Promise<void> {
  await app.page.evaluate(() => (window as unknown as { __neocad: { files: { flush(): Promise<void> } } }).__neocad.files.flush());
}

// ---- desktop Chromium -----------------------------------------------------------

test("saveFile() asks the save picker once, writes the file's text, and a second save writes in place", async () => {
  const app = await start({ pickers: "stub", share: "none" });
  assert.deepEqual(await doc(app), { name: "Untitled", dirty: false }, "a fresh start is an Untitled, clean document");
  await app.type("pt(0, 0, 0); pt(30, 0, 0)");
  assert.equal((await doc(app)).dirty, true, "an edit makes it dirty");

  await app.type("saveFile()");
  await app.page.waitForFunction(() => (window as unknown as { __files: Recorded }).__files.writes.length === 1);
  let r = await recorded(app);
  assert.deepEqual(r.savePicks, [{ suggestedName: "Untitled.zerocad.json" }]);
  assert.equal(r.writes[0].text, await saved(app), "the file holds exactly what save() writes");
  assert.equal((await doc(app)).dirty, false, "saving clears dirty");

  await app.type("pt(0, 20, 0)");
  assert.equal((await doc(app)).dirty, true);
  await app.type("saveFile()");
  await app.page.waitForFunction(() => (window as unknown as { __files: Recorded }).__files.writes.length === 2);
  r = await recorded(app);
  assert.equal(r.savePicks.length, 1, "no second dialog: the handle is written in place");
  assert.equal(r.writes[1].file, "Untitled.zerocad.json");
  assert.equal(r.writes[1].text, await saved(app));
  assert.equal((await doc(app)).dirty, false);
  assert.match(await app.log(), /saved Untitled\.zerocad\.json/);
  assert.deepEqual(app.pageErrors, []);
});

test("without the File System Access API, saveFile() downloads Untitled.zerocad.json", async () => {
  const app = await start({ pickers: "none", share: "none" });
  await app.type("pt(0, 0, 0); pt(10, 5, 0)");
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type("saveFile()")]);
  assert.equal(download.suggestedFilename(), "Untitled.zerocad.json");
  const path = await download.path();
  assert.equal(readFileSync(path, "utf8"), await saved(app), "the download is the file save() writes");
  assert.equal((await doc(app)).dirty, false, "handed over is saved, as far as the app can know");
  assert.deepEqual(app.pageErrors, []);
});

test("openFile() through the file input opens a fixture, names the document, and is one undo step", async () => {
  const app = await start({ pickers: "none", share: "none" });
  const [chooser] = await Promise.all([app.page.waitForEvent("filechooser"), app.type("openFile()")]);
  assert.equal(await chooser.element().getAttribute("accept"), ".json,application/json");
  await chooser.setFiles(FIXTURE);
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("opened bracket.zerocad.json"));
  const m = await app.model();
  assert.equal(m.byKind.line, 4, "the fixture's four lines");
  assert.deepEqual(await doc(app), { name: "bracket", dirty: false }, "named for the file, and clean");
  // The fixture's own text, re-saved, is what is open (pretty-printed the same).
  assert.equal(JSON.parse(await saved(app)).journal.length, JSON.parse(FIXTURE_TEXT).journal.length);

  await app.type("pt(80, 80, 0)");
  assert.equal((await doc(app)).dirty, true, "an edit after opening is dirty");
  await app.type("undo()");
  assert.equal((await doc(app)).dirty, false, "undone back to the opened state is clean again");
  await app.type("undo()");
  assert.equal((await app.model()).size, 0, "and the open itself was one step: one more undo is the empty start");
  assert.deepEqual(app.pageErrors, []);
});

test("shareFile() hands the share sheet one application/json file named for the document", async () => {
  const app = await start({ pickers: "stub", share: "stub" });
  await app.type("pt(1, 2, 0)");
  await app.type("shareFile()");
  await app.page.waitForFunction(() => (window as unknown as { __files: Recorded }).__files.shares.length === 1);
  const r = await recorded(app);
  assert.equal(r.shares.length, 1);
  assert.equal(r.shares[0].name, "Untitled.zerocad.json");
  assert.equal(r.shares[0].type, "application/json");
  assert.equal(r.shares[0].text, await saved(app));
  assert.equal((await doc(app)).dirty, true, "a shared copy is not a save");
  assert.deepEqual(app.pageErrors, []);
});

test("shareFile() where nothing can share downloads instead", async () => {
  const app = await start({ pickers: "stub", share: "none" });
  const [download] = await Promise.all([app.page.waitForEvent("download"), app.type("shareFile()")]);
  assert.equal(download.suggestedFilename(), "Untitled.zerocad.json");
});

test("a file dragged over the window shows the drop hint, and dropped it opens", async () => {
  const app = await start({ pickers: "none", share: "none" });
  const dt = await app.page.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], "bracket.zerocad.json", { type: "application/json" }));
    return d;
  }, FIXTURE_TEXT);
  await app.page.dispatchEvent("#cv", "dragenter", { dataTransfer: dt });
  await app.page.dispatchEvent("#cv", "dragover", { dataTransfer: dt });
  assert.equal(await app.page.isVisible("#drophint"), true, "the hint is up while a file is over the window");
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await app.page.screenshot({ path: join(SHOTS, "files-drophint.png") });
  }
  await app.page.dispatchEvent("#cv", "drop", { dataTransfer: dt });
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("opened bracket.zerocad.json"));
  assert.equal(await app.page.isVisible("#drophint"), false, "and gone once it is dropped");
  assert.equal((await app.model()).byKind.line, 4);
  assert.equal((await doc(app)).name, "bracket");

  // A drag that leaves again takes the hint with it.
  await app.page.dispatchEvent("#cv", "dragenter", { dataTransfer: dt });
  await app.page.dispatchEvent("#cv", "dragleave", { dataTransfer: dt });
  assert.equal(await app.page.isVisible("#drophint"), false);
  assert.deepEqual(app.pageErrors, []);
});

test("Ctrl+S types saveFile() and Ctrl+O types openFile(), the browser's own dialogs prevented", async () => {
  const app = await start({ pickers: "stub", share: "none" });
  await app.type("pt(0, 0, 0)");
  // From the command line, with text half-typed: the text stays.
  await app.page.fill("#cmd", "pt(9");
  await app.page.focus("#cmd");
  await app.page.keyboard.press("Control+s");
  await app.page.waitForFunction(() => (window as unknown as { __files: Recorded }).__files.writes.length === 1);
  assert.match(await app.log(), /> saveFile\(\)/, "typed, so the log shows it");
  assert.equal(await app.page.inputValue("#cmd"), "pt(9", "what was half-typed is still there");

  await app.page.evaluate((text) => { (window as unknown as { __files: { openWith: string } }).__files.openWith = text; }, FIXTURE_TEXT);
  await app.page.keyboard.press("Control+o");
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("opened opened.zerocad.json"));
  assert.match(await app.log(), /> openFile\(\)/);
  assert.equal((await app.model()).byKind.line, 4);
  assert.equal((await doc(app)).name, "opened");

  // And the default really was prevented: a listener after the app's sees it.
  const defaulted = await app.page.evaluate(() => new Promise<boolean>((resolve) => {
    addEventListener("keydown", (e) => resolve(e.defaultPrevented), { once: true });
    dispatchEvent(new KeyboardEvent("keydown", { key: "s", code: "KeyS", ctrlKey: true, bubbles: true, cancelable: true }));
  }));
  assert.equal(defaulted, true, "Ctrl+S's default (the browser's Save Page) is prevented");
  assert.deepEqual(app.pageErrors, []);
});

test("the drawing survives a reload by autosave, and newFile() replaces it", async () => {
  const app = await start({ pickers: "stub", share: "none" });
  await app.type("pt(0, 0, 0); pt(40, 0, 0); ln(\"p1\", \"p2\")");
  const before = await saved(app);
  await autosaved(app);
  await reload(app);
  assert.equal(await saved(app), before, "the same drawing, journal and values");
  assert.deepEqual(await doc(app), { name: "Untitled", dirty: true }, "and still unsaved");
  assert.match(await app.log(), /restored Untitled/);

  // newFile() on a dirty document asks; accepted, it is empty and so is the next start.
  app.page.once("dialog", (d) => void d.accept());
  await app.type("newFile()");
  assert.equal((await app.model()).size, 0);
  await autosaved(app);
  await reload(app);
  assert.equal((await app.model()).size, 0, "a reload after newFile() starts empty");
  assert.deepEqual(await doc(app), { name: "Untitled", dirty: false });
  assert.deepEqual(app.pageErrors, []);
});

test("the dirty prompt: new and open ask first, and No keeps the drawing", async () => {
  const app = await start({ pickers: "none", share: "none" });
  await app.type("pt(5, 5, 0)");
  let asked = "";
  app.page.once("dialog", (d) => { asked = d.message(); void d.dismiss(); });
  await app.type("newFile()");
  assert.match(asked, /unsaved changes to “Untitled”/);
  assert.equal((await app.model()).size, 1, "dismissed, nothing was replaced");
  assert.match(await app.log(), /kept Untitled/);

  const [chooser] = await Promise.all([app.page.waitForEvent("filechooser"), app.type("openFile()")]);
  const dialog = app.page.waitForEvent("dialog");
  await chooser.setFiles(FIXTURE);
  const d = await dialog;
  assert.match(d.message(), /Open bracket\.zerocad\.json\?/);
  await d.dismiss();
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("not opened"));
  assert.equal((await app.model()).size, 1, "not opened");

  // Clean, nothing is asked: a dialog here would be left unanswered and fail the wait.
  app.page.once("dialog", (dlg) => void dlg.accept());
  await app.type("newFile()");
  let more = false;
  app.page.once("dialog", (dlg) => { more = true; void dlg.dismiss(); });
  await app.type("newFile()");
  assert.equal(more, false, "an unchanged document is replaced without a question");
  app.page.removeAllListeners("dialog");
  assert.deepEqual(app.pageErrors, []);
});

test("a file the desktop launches the installed app with opens through the launch queue", async () => {
  const app = await openApp({
    init: {
      fn: (text: string) => {
        // The queue as Chromium has it for an installed app: launches wait
        // until a consumer is set, then are handed over.
        const handle = {
          kind: "file", name: "launched.zerocad.json",
          getFile: async () => new File([text], "launched.zerocad.json", { type: "application/json" }),
          createWritable: async () => ({ write: async () => {}, close: async () => {} }),
        };
        // Chromium has a real (read-only) one, empty outside an installed app.
        // The launch is handed over when the test says, so the start's own
        // "ready" is not raced by the file it opens.
        Object.defineProperty(window, "launchQueue", {
          configurable: true,
          value: {
            setConsumer(fn: (p: unknown) => void) {
              (window as unknown as { __launch: () => void }).__launch = () => fn({ files: [handle] });
            },
          },
        });
      },
      arg: FIXTURE_TEXT,
    },
  });
  opened.push(app);
  await app.page.evaluate(() => (window as unknown as { __launch: () => void }).__launch());
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("opened launched.zerocad.json"));
  assert.equal((await app.model()).byKind.line, 4);
  assert.equal((await doc(app)).name, "launched");
});

// ---- iPhone 13 ------------------------------------------------------------------

test("iPhone: no pickers, so saveFile() is the share sheet — one application/json file — and clears dirty", async () => {
  const app = await start({ pickers: "none", share: "stub" }, "iPhone 13");
  await app.repl("pt(0, 0, 0); pt(25, 0, 0)");
  await app.repl("solve()");
  assert.equal((await doc(app)).dirty, true);
  await app.type("saveFile()");
  await app.page.waitForFunction(() => (window as unknown as { __files: Recorded }).__files.shares.length === 1);
  const r = await recorded(app);
  assert.equal(r.shares[0].name, "Untitled.zerocad.json");
  assert.equal(r.shares[0].type, "application/json");
  assert.equal(r.shares[0].text, await saved(app));
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("through the share sheet"));
  assert.equal((await doc(app)).dirty, false, "a share that completed is the save");
  assert.deepEqual(app.pageErrors, []);
});

test("iPhone: openFile() is the file input, and a drawing survives the app being reloaded", async () => {
  const app = await start({ pickers: "none", share: "stub" }, "iPhone 13");
  const [chooser] = await Promise.all([app.page.waitForEvent("filechooser"), app.type("openFile()")]);
  await chooser.setFiles(FIXTURE);
  await app.page.waitForFunction(() => document.getElementById("log")?.textContent?.includes("opened bracket.zerocad.json"));
  assert.deepEqual(await doc(app), { name: "bracket", dirty: false });
  await app.type("pt(70, 70, 0)");
  const before = await saved(app);
  // Hidden is the last moment a phone's app may run: the write happens then.
  await app.page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await autosaved(app);
  await reload(app);
  assert.equal(await saved(app), before);
  assert.deepEqual(await doc(app), { name: "bracket", dirty: true });
  assert.deepEqual(app.pageErrors, []);
});

