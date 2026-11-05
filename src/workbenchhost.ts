// **Add workbench…** (docs/plans/workbenches.md). The owner: *"obv the concept
// is that I should be able to add a workbench simply by opening a file on my
// device, from the menu... should be some item like 'add workbench'"*.
//
// Host-level, like filehost.ts: the device's file picker (the Files app on an
// iPhone, a file dialog on a desktop; a dropped file arrives through
// filehost.ts), the question, IndexedDB beside the autosave, and the share
// sheet. Only main.ts constructs it.
//
// **The consent is the paste rule's** (docs/plans/tool-source-in-files.md):
// before anything in the file runs, the app shows what it says it registers —
// read from the manifest comment at its top, never by running it — and asks.
// Accepted, the file runs once in the command line's scope (curated, not a
// sandbox, and the question says so), and `defineModule` refuses a module that
// registers anything its manifest did not show, before registering any of it.
// A file kept on the device was accepted once and is loaded at every start
// without asking again, until it is removed.

import { describeModule, getModule, getWorkbench, loadingFile, readManifest, removeModule, textHash, type Manifest } from "./modules.ts";

/** One workbench file kept on this device. */
export interface StoredWorkbench {
  name: string;
  fileName: string;
  /** The file's text, byte for byte as read — what Share hands back. */
  source: string;
  hash: string;
  added: number;
}

/** The device's store of workbench files: IndexedDB in a browser, anything with these four in a test. */
export interface WorkbenchStore {
  all(): Promise<StoredWorkbench[]>;
  put(w: StoredWorkbench): Promise<void>;
  remove(name: string): Promise<void>;
}

/** The store in IndexedDB, beside the autosave's (`neocad.workbenches.v1`), or null where there is none. */
export function indexedDbWorkbenches(name = "neocad.workbenches.v1"): WorkbenchStore | null {
  if (typeof indexedDB === "undefined") return null;
  const db = () => new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore("files", { keyPath: "name" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async <T>(mode: IDBTransactionMode, act: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const d = await db();
    try {
      return await new Promise<T>((resolve, reject) => {
        const req = act(d.transaction("files", mode).objectStore("files"));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } finally {
      d.close();
    }
  };
  return {
    all: () => run("readonly", (s) => s.getAll() as IDBRequest<StoredWorkbench[]>),
    put: async (w) => { await run("readwrite", (s) => s.put(w)); },
    remove: async (n) => { await run("readwrite", (s) => s.delete(n)); },
  };
}

export interface WorkbenchHostOptions {
  /** Runs a workbench file's text in the command line's scope; throws its refusal. */
  evaluate(source: string): Promise<void>;
  log(line: string, cls?: "out" | "err"): void;
  /** Hands a file over: the share sheet under a finger, a download elsewhere (filehost.ts's `exportFile`). */
  exportFile(text: string, fileName: string, type: string): Promise<string>;
  /** The tray, the menu and the scope follow what was added or removed. */
  changed(): void;
  /** A workbench was just added: a document that was waiting for it may now open whole. */
  added?(name: string): void;
  store: WorkbenchStore | null;
}

/** The suffix a workbench file goes by, as a drawing is `.zerocad.json`. */
export const WORKBENCH_SUFFIX = ".zerocad.js";

export class WorkbenchFiles {
  private stored = new Map<string, StoredWorkbench>();
  private dialog: HTMLElement | null = null;
  private readonly o: WorkbenchHostOptions;

  constructor(o: WorkbenchHostOptions) {
    this.o = o;
  }

  /** Every workbench file kept on this device, loaded — at start, after the built-in modules. Nothing is asked: each was. */
  async start(): Promise<void> {
    let all: StoredWorkbench[] = [];
    try {
      all = (await this.o.store?.all()) ?? [];
    } catch (e) {
      this.o.log(`the workbenches kept on this device could not be read: ${e instanceof Error ? e.message : e}`, "err");
    }
    for (const w of all.sort((a, b) => a.added - b.added)) {
      try {
        await this.run(w.source, w.fileName, readManifest(w.source));
        this.stored.set(w.name, w);
      } catch (e) {
        this.o.log(`workbench ${w.name} (${w.fileName}) did not load: ${e instanceof Error ? e.message : e}`, "err");
      }
    }
    if (this.stored.size) this.o.changed();
  }

  /** The workbench files added on this device, by module name. */
  names(): string[] {
    return [...this.stored.keys()];
  }

  /** `addWorkbench()` — the device's file picker. Returns at once; the file arrives in an event. */
  add(): string {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".js,text/javascript,application/javascript";
    input.style.display = "none";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      input.remove();
      if (file) void file.text().then((text) => this.offer(text, file.name), (e) => this.o.log(String(e), "err"));
    });
    document.body.appendChild(input);
    input.click();
    return "choose a workbench file (.zerocad.js)";
  }

  /** `loadModule(url)` — the same, from a URL. */
  async load(url: string): Promise<string> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`loadModule: ${url} answered ${res.status}`);
    const text = await res.text();
    this.offer(text, decodeURIComponent(url.split("/").pop() || url));
    return `read ${url} — its manifest is shown; nothing has run`;
  }

  /**
   * A workbench file's text, from any door: its manifest read (not run) and
   * shown, and the question asked. A file with no manifest, or a malformed
   * one, is refused here and nothing runs.
   */
  offer(source: string, fileName: string): void {
    let manifest: Manifest;
    try {
      manifest = readManifest(source);
    } catch (e) {
      this.o.log(`${fileName}: ${e instanceof Error ? e.message : e}`, "err");
      return;
    }
    if (getModule(manifest.name)) {
      this.o.log(`${fileName}: a module called "${manifest.name}" is already loaded — remove it first`, "err");
      return;
    }
    this.ask(manifest, fileName, async () => {
      try {
        await this.run(source, fileName, manifest);
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e);
        // defineModule's refusal already says "refused — …"; anything else is said as one.
        this.o.log(why.startsWith("refused") ? `${fileName} ${why}` : `${fileName} refused: ${why}`, "err");
        return;
      }
      const w: StoredWorkbench = { name: manifest.name, fileName, source, hash: textHash(source), added: Date.now() };
      this.stored.set(w.name, w);
      try {
        await this.o.store?.put(w);
      } catch (e) {
        this.o.log(`added for now, but not kept on this device: ${e instanceof Error ? e.message : e}`, "err");
      }
      this.o.log(`added workbench ${manifest.workbench ?? manifest.name}: ${describeModule(getModule(manifest.name)!)} — kept on this device`, "out");
      this.o.changed();
      this.o.added?.(manifest.name);
    });
  }

  /** `removeWorkbench(name)` — off this device and out of the tray now; its entity kinds go at the next start. */
  async remove(name: string): Promise<string> {
    const w = this.stored.get(name) ?? [...this.stored.values()].find((s) => readManifest(s.source).workbench === name);
    if (!w) throw new Error(`no workbench "${name}" was added on this device — ${this.names().join(", ") || "none was"}`);
    removeModule(w.name);
    this.stored.delete(w.name);
    await this.o.store?.remove(w.name);
    this.o.changed();
    return `removed workbench ${w.name} from this device`;
  }

  /** `shareWorkbench(name)` — the file handed back, byte for byte as it was added. */
  async share(name: string): Promise<string> {
    const w = this.stored.get(name) ?? [...this.stored.values()].find((s) => readManifest(s.source).workbench === name);
    if (!w) throw new Error(`no workbench "${name}" was added on this device`);
    return this.o.exportFile(w.source, w.fileName, "text/javascript");
  }

  private async run(source: string, fileName: string, manifest: Manifest): Promise<void> {
    await loadingFile({ fileName, hash: textHash(source), manifest }, () => this.o.evaluate(source));
    if (manifest.workbench && !getWorkbench(manifest.workbench)) {
      throw new Error(`its manifest names workbench "${manifest.workbench}", which it does not define`);
    }
  }

  /**
   * The question, in the context menu's family: what the file is, what it
   * registers by name, what running it means, and Add / Cancel. Nothing has
   * run while it is open.
   */
  private ask(m: Manifest, fileName: string, yes: () => Promise<void>): void {
    this.dialog?.remove();
    const el = document.createElement("div");
    el.id = "wbconsent";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", `Add workbench ${m.label ?? m.name}?`);
    const row = (cls: string, text: string) => {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = text;
      el.appendChild(d);
    };
    row("wbhead", `Add workbench ${m.label ?? m.name}?`);
    row("wbfile", fileName);
    const said = (label: string, names: string[]) => row("wbrow", `${label}: ${names.length ? names.join(", ") : "none"}`);
    said("module", [m.name]);
    if (m.workbench) said("workbench", [m.workbench]);
    said("tools", m.tools);
    said("relations", m.relations);
    said("operations", m.operations);
    said("entity kinds", m.entities);
    row("wbnote", "Read from the file's manifest; nothing in it has run. Added, it runs with the command line's authority — "
      + "curated, not a sandbox — and is kept on this device until you remove it. A file that registers anything not "
      + "listed here is refused.");
    const buttons = document.createElement("div");
    buttons.className = "wbbuttons";
    const button = (label: string, act: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", act);
      buttons.appendChild(b);
      return b;
    };
    button("Cancel", () => { el.remove(); this.o.log(`${fileName}: not added`, "out"); });
    const add = button("Add", () => { el.remove(); void yes(); });
    add.className = "wbyes";
    el.appendChild(buttons);
    document.body.appendChild(el);
    this.dialog = el;
    add.focus();
  }
}
