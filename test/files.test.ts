// The document's rules (src/files.ts), with no browser: dirty read off the
// model, the file's name and type, which way a save or a share goes for what
// the platform offers, the shortcuts, and the autosave's debounce, restore,
// refusal of a newer file and storage that throws. The browser half — the
// pickers, the sheet, the input, a drop, a reload — is test/e2e/files.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { neocadScope } from "../src/replenv.ts";
import { VERSION, open as openModel, save } from "../src/persist.ts";
import { UndoStack } from "../src/undo.ts";
import {
  ACCEPT, AUTOSAVE_FORMAT, AUTOSAVE_KEY, Autosave, DocumentState, FILE_SUFFIX, FILE_TYPE, UNTITLED,
  cancelled, fileChord, fileNameFor, nameOfFile, openRoute, saveRoute, shareRoute,
  type AutosaveRecord, type AutosaveStore, type Timers,
} from "../src/files.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

const call = (scope: Record<string, unknown>, name: string, ...args: unknown[]) =>
  (scope[name] as (...a: unknown[]) => unknown)(...args);

// ---- dirty -------------------------------------------------------------------------

test("dirty: opened is clean, an edit is dirty, undoing back to the opened state is clean, a save is clean", async () => {
  await loadKernel();
  // The "file": a drawing made elsewhere and saved.
  const made = new Model(3);
  const s0 = neocadScope({ model: made });
  call(s0, "pt", 0, 0, 0);
  call(s0, "pt", 40, 0, 0);
  call(s0, "ln", "p1", "p2");
  const file = save(made);

  // Opened, as the host opens one: the model replaced, the document settled
  // on its snapshot under the file's name.
  let model = openModel(file, 3);
  const snap = () => save(model, false);
  const doc = new DocumentState(save(new Model(3), false));
  doc.settle(snap(), nameOfFile("plate.zerocad.json"));
  assert.deepEqual(doc.info(snap()), { name: "plate", dirty: false }, "opened: clean");

  // An edit, bracketed the way main.ts brackets one.
  const undo = new UndoStack<string>();
  const before = snap();
  call(neocadScope({ model }), "pt", 10, 10, 0);
  assert.equal(undo.pushIfChanged(before, snap()), true);
  assert.equal(doc.dirty(snap()), true, "an edit: dirty");

  // Undone: the snapshot is the opened one again, so the document is clean —
  // no flag was set that would need clearing.
  model = openModel(undo.undo(snap())!, 3);
  assert.equal(doc.dirty(snap()), false, "undone back to the opened state: clean");

  // Redone, then saved.
  model = openModel(undo.redo(snap())!, 3);
  assert.equal(doc.dirty(snap()), true);
  doc.settle(snap());
  assert.deepEqual(doc.info(snap()), { name: "plate", dirty: false }, "saved: clean, the name kept");

  // A tool's source is not the drawing: a snapshot never carries one.
  assert.equal(doc.dirty(save(model, false, [])), false);
});

test("dirty: a document restored dirty stays dirty until it is next opened, saved or made new", () => {
  const doc = new DocumentState("empty");
  doc.restore("drawing", "plate", true);
  assert.deepEqual(doc.info("drawing"), { name: "plate", dirty: true }, "what it was dirty against is not stored");
  doc.restore("drawing", "plate", false);
  assert.equal(doc.dirty("drawing"), false, "restored clean, it is clean against itself");
  assert.equal(doc.dirty("edited"), true);
});

// ---- the file --------------------------------------------------------------------------

test("the file: <name>.zerocad.json, application/json, and the name read back off it", () => {
  assert.equal(FILE_SUFFIX, ".zerocad.json");
  assert.equal(FILE_TYPE, "application/json");
  assert.equal(fileNameFor(UNTITLED), "Untitled.zerocad.json");
  assert.equal(fileNameFor("plate"), "plate.zerocad.json");
  assert.equal(fileNameFor("a/b:c"), "a-b-c.zerocad.json", "what no file system takes is replaced");
  assert.equal(fileNameFor("  "), "Untitled.zerocad.json");
  assert.equal(nameOfFile("plate.zerocad.json"), "plate");
  assert.equal(nameOfFile("Plate.ZEROCAD.JSON"), "Plate");
  assert.equal(nameOfFile("old.neocad.json"), "old.neocad", "a file written elsewhere loses only .json");
  assert.equal(nameOfFile("/Users/x/bracket.json"), "bracket");
  assert.equal(nameOfFile(".json"), UNTITLED);
  // The picker's filter is .json and its type: a .zerocad.json file is a .json file to iOS.
  assert.equal(ACCEPT, ".json,application/json");
});

// ---- which way ---------------------------------------------------------------------------

test("save: in place with a handle, the picker where there is one, the share sheet under a finger, else a download", () => {
  // Chromium, desktop or Android.
  assert.equal(saveRoute({ handle: true, savePicker: true }), "handle");
  assert.equal(saveRoute({ savePicker: true, shareFiles: true, phone: true }), "picker");
  // An iPhone: no picker, and the sheet's Save to Files is the save.
  assert.equal(saveRoute({ shareFiles: true, phone: true }), "share");
  assert.equal(saveRoute({ shareFiles: false, phone: true }), "download", "a phone that cannot share files downloads");
  // Desktop Safari can share files, but its sheet has no save: a download.
  assert.equal(saveRoute({ shareFiles: true, phone: false }), "download");
  // Firefox.
  assert.equal(saveRoute({}), "download");
  // A handle from a restored autosave counts as well as one from this session.
  assert.equal(saveRoute({ handle: true }), "handle");
});

test("share: the sheet where it takes files, else a download; open: the picker, else the input", () => {
  assert.equal(shareRoute({ shareFiles: true }), "share");
  assert.equal(shareRoute({ shareFiles: false, phone: true }), "download");
  assert.equal(shareRoute({}), "download");
  assert.equal(openRoute({ openPicker: true }), "picker");
  assert.equal(openRoute({}), "input");
});

test("a dismissed picker or sheet is a cancel, not an error", () => {
  assert.equal(cancelled(Object.assign(new Error("The user aborted a request."), { name: "AbortError" })), true);
  assert.equal(cancelled(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })), false);
  assert.equal(cancelled("nope"), false);
  assert.equal(cancelled(null), false);
});

test("the shortcuts: Ctrl/⌘+S is save, Ctrl/⌘+O is open — not shifted, not mid-composition, not a held key", () => {
  const k = (key: string, more: Partial<Parameters<typeof fileChord>[0]> = {}) =>
    fileChord({ key, code: `Key${key.toUpperCase()}`, ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...more });
  assert.equal(k("s"), "save");
  assert.equal(k("o"), "open");
  assert.equal(k("s", { ctrlKey: false, metaKey: true }), "save", "⌘S");
  assert.equal(k("S"), "save", "caps lock");
  assert.equal(k("s", { shiftKey: true }), null, "Ctrl+Shift+S is someone else's save-as");
  assert.equal(k("s", { altKey: true }), null, "AltGr");
  assert.equal(k("s", { ctrlKey: false }), null, "a plain s is typing");
  assert.equal(k("s", { isComposing: true }), null, "an input method's half-word owns the key");
  assert.equal(k("s", { repeat: true }), null, "a held key would stack dialogs");
  assert.equal(fileChord({ key: "ы", code: "KeyS", ctrlKey: true, metaKey: false, shiftKey: false, altKey: false }), "save",
    "a Cyrillic layout: by position");
  assert.equal(k("z"), null);
});

// ---- autosave ------------------------------------------------------------------------------

/** Timers stepped by hand: `run()` fires what is due, in order. */
function manualTimers(): Timers & { pending: number; run(): void } {
  const due = new Map<number, () => void>();
  let id = 0;
  return {
    set(fn) { due.set(++id, fn); return id; },
    clear(i) { due.delete(i as number); },
    get pending() { return due.size; },
    run() { const fns = [...due.values()]; due.clear(); for (const fn of fns) fn(); },
  };
}

function memoryStore(): AutosaveStore & { data: Map<string, unknown>; writes: number } {
  const data = new Map<string, unknown>();
  const s = {
    data,
    writes: 0,
    async read(key: string) { return data.get(key); },
    async write(key: string, value: unknown) { s.writes++; if (value === null) data.delete(key); else data.set(key, structuredClone(value)); },
  };
  return s;
}

const record = (text: string, more: Partial<AutosaveRecord> = {}): AutosaveRecord =>
  ({ format: AUTOSAVE_FORMAT, version: 1, name: "plate", dirty: true, text, at: 0, ...more });

test("autosave: a burst of changes is one write, after the quiet; flush writes now; an unchanged document writes nothing", async () => {
  const store = memoryStore();
  const timers = manualTimers();
  const lines: string[] = [];
  const a = new Autosave(store, { log: (l) => lines.push(l), timers, delay: 500, now: () => 7 });
  let text = "one";
  a.connect(() => ({ name: "Untitled", dirty: true, text }));

  a.schedule();
  text = "two";
  a.schedule();
  a.schedule();
  assert.equal(timers.pending, 1, "one timer, restarted by each change");
  assert.equal(store.writes, 0, "nothing written before the quiet");
  timers.run();
  await a.flush(); // settles the queued write
  assert.equal(store.writes, 1);
  assert.deepEqual(store.data.get(AUTOSAVE_KEY), { format: AUTOSAVE_FORMAT, version: 1, name: "Untitled", dirty: true, text: "two", at: 7 });

  a.schedule();
  timers.run();
  await a.flush();
  assert.equal(store.writes, 1, "the same document again is not written again");

  text = "three";
  a.schedule();
  await a.flush(); // hidden: now, not after the quiet
  assert.equal(timers.pending, 0, "the flush took the pending timer with it");
  assert.equal((store.data.get(AUTOSAVE_KEY) as AutosaveRecord).text, "three");
  assert.deepEqual(lines, []);
});

test("autosave: restore hands the stored record to the opener, and what it made comes back", async () => {
  await loadKernel();
  const m = new Model(3);
  call(neocadScope({ model: m }), "pt", 3, 4, 0);
  const text = save(m);
  const store = memoryStore();
  store.data.set(AUTOSAVE_KEY, record(text, { name: "plate", dirty: false }));
  const a = new Autosave(store, { log: () => {}, timers: manualTimers() });
  const got = await a.restore((r) => openModel(r.text, 3));
  assert.ok(got);
  assert.equal(got.record.name, "plate");
  assert.equal(got.record.dirty, false);
  assert.deepEqual(got.value.coords("p1"), [3, 4, 0], "the drawing, values and all");
  assert.equal(save(got.value), text, "and it is the file save() wrote");

  // Nothing stored: nothing restored, and nothing said.
  const lines: string[] = [];
  const empty = new Autosave(memoryStore(), { log: (l) => lines.push(l), timers: manualTimers() });
  assert.equal(await empty.restore(() => { throw new Error("not called"); }), null);
  assert.deepEqual(lines, []);
  assert.equal(empty.mode, "on");
});

test("autosave: a drawing from a newer build is refused, said why, and kept — not overwritten — until newFile or an open", async () => {
  await loadKernel();
  const m = new Model(3);
  call(neocadScope({ model: m }), "pt", 1, 1, 0);
  const newer = JSON.stringify({ ...JSON.parse(save(m)), version: VERSION + 1 });
  const store = memoryStore();
  store.data.set(AUTOSAVE_KEY, record(newer));
  const lines: string[] = [];
  const timers = manualTimers();
  const a = new Autosave(store, { log: (l) => lines.push(l), timers });
  a.connect(() => ({ name: "Untitled", dirty: false, text: "empty" }));

  assert.equal(await a.restore((r) => openModel(r.text, 3)), null, "the app starts empty");
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`this file is version ${VERSION + 1}`), "the persist layer's own reason");
  assert.match(lines[0], /It is kept/);
  assert.equal(a.mode, "held");

  a.schedule();
  timers.run();
  await a.flush();
  assert.equal(store.writes, 0, "held: nothing written over it");
  assert.equal((store.data.get(AUTOSAVE_KEY) as AutosaveRecord).text, newer);

  await a.replace(); // newFile(), or a file opened
  assert.equal(a.mode, "on");
  assert.equal((store.data.get(AUTOSAVE_KEY) as AutosaveRecord).text, "empty", "replaced on purpose, it is written");
});

test("autosave: a record of a newer autosave version, or something that is not one, is refused the same way", async () => {
  for (const stored of [record("{}", { version: 2 }), { hello: 1 }]) {
    const store = memoryStore();
    store.data.set(AUTOSAVE_KEY, stored);
    const lines: string[] = [];
    const a = new Autosave(store, { log: (l) => lines.push(l), timers: manualTimers() });
    assert.equal(await a.restore(() => "opened"), null);
    assert.equal(a.mode, "held");
    assert.equal(lines.length, 1);
  }
});

test("autosave: storage that throws — no store, a read refused, a write refused — is no autosave, said once", async () => {
  const none: string[] = [];
  const a = new Autosave(null, { log: (l) => none.push(l), timers: manualTimers() });
  assert.equal(a.mode, "off");
  assert.equal(await a.restore(() => "x"), null);
  a.connect(() => ({ name: "Untitled", dirty: true, text: "t" }));
  await a.flush();
  assert.equal(none.length, 1);
  assert.match(none[0], /autosave is off/);

  const reads: string[] = [];
  const refusingRead: AutosaveStore = {
    read: async () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
    write: async () => { throw new Error("not reached"); },
  };
  const b = new Autosave(refusingRead, { log: (l) => reads.push(l), timers: manualTimers() });
  assert.equal(await b.restore(() => "x"), null);
  b.connect(() => ({ name: "Untitled", dirty: true, text: "t" }));
  b.schedule();
  await b.flush();
  assert.equal(b.mode, "off");
  assert.equal(reads.length, 1, "said once");
  assert.match(reads[0], /The operation is insecure/);

  const writes: string[] = [];
  let attempts = 0;
  const refusingWrite: AutosaveStore = {
    read: async () => undefined,
    write: async () => { attempts++; throw new DOMException("quota", "QuotaExceededError"); },
  };
  const timers = manualTimers();
  const c = new Autosave(refusingWrite, { log: (l) => writes.push(l), timers });
  let text = "a";
  c.connect(() => ({ name: "Untitled", dirty: true, text }));
  await c.flush();
  text = "b";
  c.schedule();
  assert.equal(timers.pending, 0, "off: a change schedules nothing");
  await c.flush();
  assert.equal(attempts, 1, "one refusal, then no more tries");
  assert.equal(writes.length, 1, "said once");
  assert.match(writes[0], /quota/);
});

test("autosave: forget empties the slot and writes nothing more (automation's fresh start)", async () => {
  const store = memoryStore();
  const a = new Autosave(store, { log: () => {}, timers: manualTimers() });
  a.connect(() => ({ name: "Untitled", dirty: true, text: "t" }));
  await a.flush();
  assert.equal(store.data.has(AUTOSAVE_KEY), true);
  await a.forget();
  assert.equal(store.data.has(AUTOSAVE_KEY), false);
  await a.flush();
  assert.equal(store.data.has(AUTOSAVE_KEY), false);
});

// ---- the command surface ----------------------------------------------------------------

test("the commands: newFile, openFile, saveFile, shareFile, in help(); through the host, refused with a reason without one", async () => {
  const bare = neocadScope({ model: new Model(3) });
  const help = call(bare, "help") as string;
  for (const name of ["newFile", "openFile", "saveFile", "shareFile"]) {
    assert.ok(help.includes(`${name}()`), `help() lists ${name}()`);
    assert.equal(typeof bare[name], "function");
    assert.throws(() => call(bare, name), /in this environment/);
  }
  // The menu reads the host's document() itself; on the command line
  // `document` would read as the page's, which the scope never offers.
  assert.equal("document" in bare, false);

  const calls: string[] = [];
  const hosted = neocadScope({
    model: new Model(3),
    newFile: () => { calls.push("new"); return "new drawing: Untitled"; },
    openFile: () => { calls.push("open"); return "choose a file…"; },
    saveFile: async () => { calls.push("save"); return "saved plate.zerocad.json"; },
    shareFile: async () => { calls.push("share"); return "shared plate.zerocad.json"; },
    document: () => ({ name: "plate", dirty: true }),
    download: (_json, filename) => { calls.push(`download ${filename}`); },
  });
  assert.equal(call(hosted, "newFile"), "new drawing: Untitled");
  assert.equal(call(hosted, "openFile"), "choose a file…");
  assert.equal(await call(hosted, "saveFile"), "saved plate.zerocad.json");
  assert.equal(await call(hosted, "shareFile"), "shared plate.zerocad.json");
  assert.equal(call(hosted, "download"), "plate.zerocad.json", "download() is named for the document too");
  assert.deepEqual(calls, ["new", "open", "save", "share", "download plate.zerocad.json"]);
  // Acting on the document, never in it: nothing journalled.
  assert.deepEqual((hosted.model as Model).journal, []);
});
