// The browser half of files.ts: the document's four commands — newFile,
// openFile, saveFile, shareFile — over whatever this platform offers, and the
// ways a file arrives without a command (dropped on the window, or handed to
// an installed app by the desktop), and the autosave's storage and triggers
// (docs/plans/files.md).
//
// Knows nothing of models: the host hands in the text a file holds, the
// snapshot dirty compares, and how to replace the document. main.ts is that
// host; this file is only ever constructed there.
//
// What each platform allows, checked against MDN's compatibility data (8.1.8,
// 2026-11-02), Chromium's source and WebKit's notes — see the spec's "As
// built" for the sources:
//
// - **iOS and iPadOS, Safari or home screen**: no file pickers (WebKit has
//   only the origin-private file system), so no handle and nothing written
//   back in place. The file input opens the Files picker; Web Share with
//   files (Safari 15) opens the share sheet, whose *Save to Files* is how a
//   file is saved; a web app can neither register for files nor receive a
//   share. A download from a home-screen app silently did nothing until iOS
//   14.3 (WebKit bug 209407) — what it does now is the owner's to see.
// - **Chromium** (Chrome, Edge — desktop, and Android since 132): the pickers
//   and a handle written in place. An installed desktop app also takes files
//   from the OS (`file_handlers`, `launchQueue`, 102). Its Web Share refuses
//   a `.json` file: `canShare` says yes to any file, and `share` then rejects
//   with NotAllowedError, because `.json` and `application/json` are not on
//   Chromium's permitted list — so a refused share downloads instead.
// - **Firefox**: the input and a download (Web Share is behind a flag).
// - **Desktop Safari**: the input and a download; it can share files too,
//   which `shareFile()` uses, but `saveFile()` downloads (see `saveRoute`).

import {
  ACCEPT, FILE_TYPE, PICKER_TYPES, UNTITLED, cancelled, fileNameFor, nameOfFile, openRoute, saveRoute, shareRoute,
  type Autosave, type AutosaveRecord, type AutosaveStore, type DocumentInfo, DocumentState,
} from "./files.ts";

/** The part of a File System Access handle this file uses — so a test can hand in its own. */
export interface FileHandle {
  kind?: string;
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Blob): Promise<void>; close(): Promise<void> }>;
}

/** What the host gives: the document's text and snapshot, and how to replace it. */
export interface FileHostOptions {
  /** The text a file of this document holds: `save(model, true, tools)`. */
  text(): string;
  /** What dirty compares: the undo stack's snapshot, `save(model, false)`. */
  snapshot(): string;
  /**
   * Replaces the document by a file's text — one undo step, with what the
   * file carries said in the log. Throws, changing nothing, for a file that
   * will not open.
   */
  open(text: string): void;
  /** Replaces the document by an empty one — one undo step. */
  fresh(): void;
  log(line: string, cls?: "out" | "err"): void;
  /** Whether to go on with an unsaved document; `window.confirm` when not given. */
  confirm?(question: string): boolean;
  /** A finger is the pointer — under one, saving goes through the share sheet. */
  phone: boolean;
  autosave: Autosave;
  /** What the start restored, if anything: the name, the dirty flag and the handle carry on. */
  restored?: AutosaveRecord | null;
}

/** The window's file APIs, as far as this file needs them. Every one may be missing. */
interface FileWindow {
  showOpenFilePicker?(options: unknown): Promise<FileHandle[]>;
  showSaveFilePicker?(options: unknown): Promise<FileHandle>;
  launchQueue?: { setConsumer(consumer: (params: { files?: readonly FileHandle[] }) => void): void };
}

/** Whether `x` is a handle the platform made, which is the only kind storage can keep. */
function nativeHandle(x: unknown): boolean {
  const ctor = (globalThis as { FileSystemFileHandle?: new () => unknown }).FileSystemFileHandle;
  return typeof ctor === "function" && x instanceof ctor;
}

function looksLikeHandle(x: unknown): x is FileHandle {
  return !!x && typeof x === "object" && typeof (x as FileHandle).getFile === "function"
    && typeof (x as FileHandle).createWritable === "function";
}

export class Files {
  private readonly o: FileHostOptions;
  private readonly doc: DocumentState;
  /** The file a save writes back to, once opened from or saved to one. */
  private handle: FileHandle | null = null;
  private dropHint: HTMLElement | null = null;

  constructor(options: FileHostOptions) {
    this.o = options;
    this.doc = new DocumentState(options.snapshot());
    const r = options.restored;
    if (r) {
      this.doc.restore(options.snapshot(), r.name, r.dirty);
      if (looksLikeHandle(r.handle)) this.handle = r.handle;
    }
    options.autosave.connect(() => ({
      name: this.doc.name,
      dirty: this.doc.dirty(options.snapshot()),
      text: options.text(),
      // Only a handle the platform made can be stored (IndexedDB clones it);
      // anything else would make the write throw and switch autosave off.
      ...(this.handle && nativeHandle(this.handle) ? { handle: this.handle } : {}),
    }));
  }

  /** The document's name and whether it has unsaved changes — what the app menu shows. */
  document(): DocumentInfo {
    return this.doc.info(this.o.snapshot());
  }

  /** The drawing changed: autosave, once things are quiet. */
  changed(): void {
    this.o.autosave.schedule();
  }

  /**
   * Starts an empty document, named Untitled — after asking, when this one has
   * unsaved changes. One undo step, so a slip is one Ctrl+Z from harmless.
   */
  newFile(): string {
    if (!this.proceed("Start a new drawing")) return `kept ${this.doc.name} — it has unsaved changes`;
    this.o.fresh();
    this.handle = null;
    this.doc.settle(this.o.snapshot(), UNTITLED);
    void this.o.autosave.replace();
    return `new drawing: ${UNTITLED}`;
  }

  /**
   * Asks for a file and opens it. Returns at once: the file arrives in an event
   * long after the entry has returned, and opening it is then its own undo step.
   *
   * **The unsaved-changes question comes after the file is chosen**, not
   * before the picker. A picker needs the press that asked for it — the
   * browser's "transient activation", a few seconds in Chromium and Firefox —
   * and a `confirm` answered slowly would spend it, leaving a picker that
   * silently never opens. After the choice nothing is lost yet, and the
   * question names the file.
   */
  openFile(): string {
    const w = globalThis as unknown as FileWindow;
    if (openRoute({ openPicker: typeof w.showOpenFilePicker === "function" }) === "picker") {
      void (async () => {
        try {
          const [h] = await w.showOpenFilePicker!({ types: PICKER_TYPES, multiple: false });
          if (h) await this.openHandle(h);
        } catch (e) {
          if (!cancelled(e)) this.o.log(errorText(e), "err");
        }
      })();
    } else {
      this.chooseByInput();
    }
    return "choose a file…";
  }

  /**
   * Saves the document: back into its file, through a save picker, through the
   * share sheet (under a finger) or as a download — `saveRoute` says which.
   * Settles with what happened; a picker or sheet dismissed is "save
   * cancelled", not an error, and leaves the document dirty.
   */
  async saveFile(): Promise<string> {
    // Read before anything is awaited: the picker and the sheet must be asked
    // for inside the press that asked for them, and what is written is the
    // drawing as it was when Save was pressed.
    const text = this.o.text();
    const snap = this.o.snapshot();
    const fileName = fileNameFor(this.doc.name);
    const w = globalThis as unknown as FileWindow;
    const file = new File([text], fileName, { type: FILE_TYPE });
    const route = saveRoute({
      handle: this.handle !== null,
      savePicker: typeof w.showSaveFilePicker === "function",
      shareFiles: canShareFile(file),
      phone: this.o.phone,
    });

    if (route === "handle") {
      const h = this.handle!;
      try {
        await writeTo(h, text);
        return this.saved(snap, h.name, `saved ${h.name}`);
      } catch (e) {
        if (cancelled(e)) return "save cancelled";
        // Permission refused, or the file is gone: the handle is no use, so
        // this save goes the way a document with none would.
        this.handle = null;
        this.o.log(`could not write ${h.name} (${errorText(e)}) — choose where to save it`, "out");
        return this.saveFile();
      }
    }
    if (route === "picker") {
      let h: FileHandle;
      try {
        h = await w.showSaveFilePicker!({ suggestedName: fileName, types: PICKER_TYPES });
      } catch (e) {
        if (cancelled(e)) return "save cancelled";
        throw e;
      }
      await writeTo(h, text);
      this.handle = h;
      return this.saved(snap, h.name, `saved ${h.name}`);
    }
    if (route === "share") {
      const how = await this.share(file, text);
      if (how === "cancelled") return "save cancelled";
      return this.saved(snap, fileName, how === "shared" ? `saved ${fileName} — through the share sheet` : `downloaded ${fileName}`);
    }
    this.download(text, fileName);
    return this.saved(snap, fileName, `downloaded ${fileName}`);
  }

  /**
   * Hands the file to the share sheet — AirDrop, Messages, Mail, Save to Files
   * — or downloads it where nothing can share it. A copy: the document is not
   * thereby saved, and stays as dirty as it was.
   */
  async shareFile(): Promise<string> {
    const text = this.o.text();
    const fileName = fileNameFor(this.doc.name);
    const how = await this.share(new File([text], fileName, { type: FILE_TYPE }), text);
    return how === "cancelled" ? "share cancelled" : how === "shared" ? `shared ${fileName}` : `downloaded ${fileName}`;
  }

  /**
   * Opens a file's text as the document — the door every arrival goes
   * through: the input, the picker, a drop, the desktop's launch. Asks first
   * when the current document has unsaved changes. Settles with whether it
   * opened.
   */
  openText(text: string, fileName: string, handle: FileHandle | null): boolean {
    if (!this.proceed(`Open ${fileName}`)) {
      this.o.log(`${fileName} not opened — ${this.doc.name} has unsaved changes`, "out");
      return false;
    }
    try {
      this.o.open(text);
    } catch (e) {
      this.o.log(`${fileName}: ${errorText(e)}`, "err");
      return false;
    }
    this.handle = handle;
    this.doc.settle(this.o.snapshot(), nameOfFile(fileName));
    void this.o.autosave.replace();
    this.o.log(`opened ${fileName}`, "out");
    return true;
  }

  /**
   * The ways in that are not commands, and the autosave's triggers: a file
   * dropped on the window, a file the desktop hands an installed app, and the
   * app being hidden — which on a phone may be the last moment it runs.
   */
  install(): void {
    this.installDrop();
    const w = globalThis as unknown as FileWindow;
    // Files the OS opened the installed app with (file_handlers in the
    // manifest). Launches wait in the queue until a consumer is set, so
    // setting it after the start's restore loses none.
    w.launchQueue?.setConsumer((params) => {
      const h = params.files?.[0];
      if (h && (h.kind === undefined || h.kind === "file")) void this.openHandle(h);
    });
    const hidden = () => { if (document.visibilityState === "hidden") void this.o.autosave.flush(); };
    document.addEventListener("visibilitychange", hidden);
    addEventListener("pagehide", () => void this.o.autosave.flush());
    // An installed app asks the browser to keep its storage through pressure:
    // WebKit grants this by heuristics, a home-screen app among them, and
    // Chromium for an installed app. In a tab Firefox would prompt for it,
    // which is not worth an autosave, so only when installed.
    const standalone = matchMedia?.("(display-mode: standalone)")?.matches
      || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone) void navigator.storage?.persist?.().catch(() => false);
  }

  /** Writes the autosave now, rather than after the quiet. Settles when written. */
  flush(): Promise<void> {
    return this.o.autosave.flush();
  }

  /** For automation: the autosave's slot emptied and its writing stopped (see `Autosave.forget`). */
  forget(): Promise<void> {
    return this.o.autosave.forget();
  }

  // ---- inside -------------------------------------------------------------------

  private saved(snap: string, fileName: string, said: string): string {
    this.doc.settle(snap, nameOfFile(fileName));
    void this.o.autosave.flush();
    return said;
  }

  /** Whether to go on, asking only when there is something to lose. */
  private proceed(what: string): boolean {
    if (!this.doc.dirty(this.o.snapshot())) return true;
    const ask = this.o.confirm ?? ((q: string) => confirm(q));
    return ask(`${what}? The unsaved changes to “${this.doc.name}” will be lost.`);
  }

  private async openHandle(h: FileHandle): Promise<void> {
    try {
      const f = await h.getFile();
      this.openText(await f.text(), f.name || h.name, h);
    } catch (e) {
      this.o.log(errorText(e), "err");
    }
  }

  /**
   * The file input. In the page rather than detached, and invisible rather
   * than `display: none`: older iOS would not open a picker for an input it
   * was not laying out, and a detached one is a bet on every engine agreeing.
   */
  private chooseByInput(): void {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.style.cssText = "position:fixed;left:-1000px;top:0;width:1px;height:1px;opacity:0";
    const done = () => input.remove();
    input.addEventListener("cancel", done);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      done();
      if (!file) return;
      try {
        this.openText(await file.text(), file.name, null);
      } catch (e) {
        this.o.log(errorText(e), "err");
      }
    });
    document.body.append(input);
    input.click();
  }

  /** The share sheet, or a download where it will not take the file. Never throws for a refusal. */
  private async share(file: File, text: string): Promise<"shared" | "cancelled" | "downloaded"> {
    if (shareRoute({ shareFiles: canShareFile(file) }) === "share") {
      try {
        await navigator.share({ files: [file], title: this.doc.name });
        return "shared";
      } catch (e) {
        if (cancelled(e)) return "cancelled";
        // Chromium says yes to canShare and then refuses a .json file with
        // NotAllowedError (see the top of this file); a share also needs the
        // press that asked for it. Either way the file still has to go
        // somewhere the person can find it.
        this.o.log(`the share sheet would not take the file (${errorText(e)}) — downloading it instead`, "out");
      }
    }
    this.download(text, file.name);
    return "downloaded";
  }

  private download(text: string, fileName: string): void {
    const url = URL.createObjectURL(new Blob([text], { type: FILE_TYPE }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
    // Not revoked at once: Safari can still be reading the blob when the
    // click returns, and revoking under it cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /**
   * Drag and drop: a file over the window shows a hint, and dropped it opens
   * as Open does. The window takes every file drag, not only those over the
   * canvas, because a file dropped anywhere the page does not take it is
   * opened *by the browser* — navigating away from the drawing.
   */
  private installDrop(): void {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const show = (on: boolean) => {
      if (on && !this.dropHint) {
        const el = document.createElement("div");
        el.id = "drophint";
        // The words on a ground of their own: the empty canvas's hint is
        // drawn in the same middle, and the two would read as one muddle.
        const words = document.createElement("span");
        words.textContent = "Drop a .zerocad.json file to open it";
        words.style.cssText = "padding:8px 14px;background:#0e141b;border:1px solid #223041;border-radius:4px";
        el.append(words);
        // The app's inks: the ground dimmed, the amber of what is about to
        // happen. Takes no pointer events, so the drop lands on the window.
        el.style.cssText = "position:fixed;inset:8px;z-index:100;pointer-events:none;display:flex;align-items:center;"
          + "justify-content:center;border:2px dashed #e8a33d;border-radius:8px;background:#0a0e13c0;color:#e8a33d;"
          + "font:13px 'IBM Plex Mono',ui-monospace,Menlo,monospace";
        document.body.append(el);
        this.dropHint = el;
      }
      // By its style, not the `hidden` attribute, which its own display:flex would beat.
      if (this.dropHint) this.dropHint.style.display = on ? "flex" : "none";
    };
    addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      show(true);
    });
    addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = "copy";
    });
    addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) show(false);
    });
    addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      show(false);
      const item = Array.from(e.dataTransfer!.items).find((i) => i.kind === "file");
      if (!item) return;
      // Both asked for now: the items are readable only during the event.
      // Chromium's handle lets Save write back to the dropped file.
      const asHandle = (item as { getAsFileSystemHandle?: () => Promise<unknown> }).getAsFileSystemHandle?.();
      const file = item.getAsFile();
      void (async () => {
        try {
          const h = await asHandle?.catch(() => null);
          if (looksLikeHandle(h) && (h.kind === undefined || h.kind === "file")) {
            await this.openHandle(h);
          } else if (file) {
            this.openText(await file.text(), file.name, null);
          }
        } catch (err) {
          this.o.log(errorText(err), "err");
        }
      })();
    });
  }
}

/** `navigator.canShare({ files })`, as a yes or no — false where there is no Web Share at all. */
function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function"
      && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

async function writeTo(h: FileHandle, text: string): Promise<void> {
  const out = await h.createWritable();
  await out.write(text);
  await out.close();
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * The autosave's storage: one IndexedDB store, opened on first use. Null where
 * the browser will not give IndexedDB at all (reading the property throws in
 * some sandboxes); a store that opens and then refuses rejects instead, and
 * the autosave says so once.
 *
 * **IndexedDB, not local storage**, for three reasons. Local storage is a
 * few megabytes an origin, and this origin — brothercreamy.github.io — is
 * shared with every other site the account publishes, so the room left is
 * not ours to know; IndexedDB's quota is a share of the disk (WebKit: up to
 * 60 % for a browser app, a home-screen app the same). Local storage writes
 * synchronously on the main thread, after every change, a drawing's whole
 * text. And IndexedDB can keep a Chromium file handle, so Save after a
 * restart still writes back to the file it came from.
 */
export function indexedDbStore(name = "neocad.autosave.v1", storeName = "autosave"): AutosaveStore | null {
  let idb: IDBFactory | undefined;
  try {
    idb = globalThis.indexedDB;
  } catch {
    return null;
  }
  if (!idb) return null;
  const factory = idb;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB would not open"));
    req.onblocked = () => reject(new Error("IndexedDB is held by another window"));
  }).catch((e) => { db = null; throw e; });
  const run = <T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>) =>
    open().then((d) => new Promise<T>((resolve, reject) => {
      const tx = d.transaction(storeName, mode);
      const req = op(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB refused the write"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB abandoned the write"));
    }));
  return {
    read: (key) => run("readonly", (s) => s.get(key)),
    write: (key, value) => run<unknown>("readwrite", (s) => (value === null ? s.delete(key) : s.put(value, key)) as IDBRequest<unknown>).then(() => undefined),
  };
}
