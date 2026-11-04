// The document: the drawing as a person opens, saves and shares it — its name,
// whether it has changed since it was last opened or saved, which way a save
// or a share can go on this platform, the shortcuts, and the autosave that
// keeps it when a phone throws the app away (docs/plans/files.md).
//
// Pure, and imports nothing, as undo.ts does: what a snapshot is, what the
// platform offers and where the autosave lives are all handed in, so every
// rule here is answerable in the unit suite with strings and fakes. The DOM
// half — pickers, the share sheet, a download, drag and drop, the launch
// queue, IndexedDB — is filehost.ts.

/** What a document is called before it has been opened from or saved to a file. */
export const UNTITLED = "Untitled";

/**
 * Every file this app writes ends so. **The extension that counts is
 * `.json`**: an iPhone's file picker and a desktop's file associations both
 * go by the last extension, and both know `.json` (see `ACCEPT`); the
 * `.zerocad` before it is for a person reading a folder.
 */
export const FILE_SUFFIX = ".zerocad.json";
export const FILE_TYPE = "application/json";

/**
 * What the file input and the pickers accept. `.json` and its type, and
 * nothing of our own: iOS turns `accept` into its own file types, and an
 * extension it does not know makes it grey out what it should offer (WebKit
 * bug 34442, where `.json` in the list is reported to narrow the picker to
 * `.json` files exactly). A `.zerocad.json` file is a `.json` file to it.
 */
export const ACCEPT = ".json,application/json";

/** The pickers' form of `ACCEPT` (showOpenFilePicker / showSaveFilePicker `types`). */
export const PICKER_TYPES = [{ description: "ZeroCAD drawing", accept: { [FILE_TYPE]: [".json"] } }];

/**
 * The file a document called `name` is saved as. Characters no file system
 * takes are replaced rather than refused: the name came from a file name, or
 * is "Untitled", so this only matters for one a later command sets by hand.
 */
export function fileNameFor(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
  return (clean || UNTITLED) + FILE_SUFFIX;
}

/**
 * The document's name for a file: its base name less `.zerocad.json`, or less
 * `.json` for one written elsewhere. A file called only `.json` is Untitled.
 */
export function nameOfFile(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, "");
  const stripped = /\.zerocad\.json$/i.test(base) ? base.slice(0, -FILE_SUFFIX.length) : base.replace(/\.json$/i, "");
  return stripped.trim() || UNTITLED;
}

// ---- the name and the dirty flag ---------------------------------------------

/** What the app menu shows for the document: its name, and whether it has unsaved changes. */
export interface DocumentInfo {
  name: string;
  dirty: boolean;
}

/**
 * The document's name and what it was when last opened or saved.
 *
 * **Dirty is read off the model, never kept as a flag.** A flag set by "an
 * edit happened" would stay set after undoing back to the opened state, and
 * would miss a change nobody remembered to report. The undo stack already
 * has the right comparison — a snapshot is the text `save()` writes, so two
 * models are the same drawing exactly when their snapshots are equal — so
 * the document keeps the snapshot from its last open or save, and dirty is
 * "the snapshot now is not that one". Like the undo stack it is generic over
 * nothing but strings, and the host decides what a snapshot is.
 */
export class DocumentState {
  name: string;
  /** The snapshot at the last open, save or new; null when it is not known (a restored dirty document). */
  private baseline: string | null;

  constructor(snapshot: string, name: string = UNTITLED) {
    this.baseline = snapshot;
    this.name = name;
  }

  /** The model is now what a file holds, under `name` — after an open, a save or a new. */
  settle(snapshot: string, name: string = this.name): void {
    this.baseline = snapshot;
    this.name = name;
  }

  /**
   * As the autosave left it. A document stored dirty has lost what it was
   * dirty *against* — the autosave keeps one drawing, not two — so it stays
   * dirty until the next open, save or new: undoing back to the file is not
   * possible across a restart anyway, since the undo history is not kept.
   */
  restore(snapshot: string, name: string, dirty: boolean): void {
    this.baseline = dirty ? null : snapshot;
    this.name = name;
  }

  dirty(current: string): boolean {
    return this.baseline === null || current !== this.baseline;
  }

  info(current: string): DocumentInfo {
    return { name: this.name, dirty: this.dirty(current) };
  }
}

// ---- which way a save, a share and an open go ---------------------------------

/** What this platform, and this document, offer — read by filehost.ts, decided on here. */
export interface Capabilities {
  /** A file handle the document was opened from or last saved to (File System Access). */
  handle?: boolean;
  /** `showSaveFilePicker` exists — Chromium, desktop and (since 132) Android. */
  savePicker?: boolean;
  /** `showOpenFilePicker` exists. */
  openPicker?: boolean;
  /** `navigator.canShare({ files: [file] })` said yes for this document's file. */
  shareFiles?: boolean;
  /** The pointer is a finger (`(pointer: coarse)`): a phone or a tablet. */
  phone?: boolean;
}

export type SaveRoute = "handle" | "picker" | "share" | "download";

/**
 * How `saveFile()` saves.
 *
 * - **Back into the file it came from** when there is a handle: no dialog
 *   (Chromium asks once for permission to write a file it only opened).
 * - **A save picker** where there is one, and its handle is kept for next time.
 * - **The share sheet, under a finger, where files can be shared**: on an
 *   iPhone there is no other way to put a file where a person can find it —
 *   the sheet's *Save to Files* is the save.
 * - **A download** otherwise.
 *
 * The share sheet is a finger's only. Desktop Safari can share files too, but
 * its sheet is Mail, Messages and AirDrop with no "save" among them, and a
 * download there lands in Downloads as a real file.
 */
export function saveRoute(c: Capabilities): SaveRoute {
  if (c.handle) return "handle";
  if (c.savePicker) return "picker";
  if (c.phone && c.shareFiles) return "share";
  return "download";
}

/** How `shareFile()` shares: the sheet where it takes files, else a download. */
export function shareRoute(c: Capabilities): "share" | "download" {
  return c.shareFiles ? "share" : "download";
}

/** How `openFile()` asks for a file: the picker (whose handle a save writes back to), else the file input. */
export function openRoute(c: Capabilities): "picker" | "input" {
  return c.openPicker ? "picker" : "input";
}

/**
 * Whether a rejection is the person changing their mind — a picker or a share
 * sheet dismissed — which is not an error and is not reported as one. Both
 * APIs say so with an `AbortError`.
 */
export function cancelled(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { name?: unknown }).name === "AbortError";
}

// ---- the shortcuts --------------------------------------------------------------

/** The fields of a `KeyboardEvent` the chord is read from (as historykeys.ts reads them). */
export interface FileChordKeys {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  repeat?: boolean;
}

/**
 * `"save"` for Ctrl+S / ⌘S and `"open"` for Ctrl+O / ⌘O; null for anything
 * else. `key` first and `code` only when the layout gave no Latin letter, for
 * historykeys.ts's reason (a Cyrillic layout's S is `ы`). Shift and Alt are
 * left alone — Ctrl+Shift+S is "save as" elsewhere, and AltGr is Ctrl+Alt on
 * Windows.
 *
 * **Not while a composition is open**: an input method holding half a word is
 * the one thing in the command line the key belongs to. And not a key held
 * down, which would stack a dialog per repeat.
 */
export function fileChord(e: FileChordKeys): "save" | "open" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.isComposing || e.repeat) return null;
  const letter = /^[a-z]$/i.test(e.key) ? e.key.toLowerCase()
    : e.code === "KeyS" ? "s"
    : e.code === "KeyO" ? "o"
    : null;
  return letter === "s" ? "save" : letter === "o" ? "open" : null;
}

// ---- autosave ---------------------------------------------------------------------

/**
 * How long after a change the autosave writes. Short, because an iPhone
 * evicts a backgrounded app without warning and whatever was not written is
 * gone; not zero, because a burst of edits (a typed line of four points, an
 * undo pressed repeatedly) is one write, not four.
 */
export const AUTOSAVE_DELAY_MS = 500;

/** The record's tag, so a stray value under the key is not mistaken for a drawing. */
export const AUTOSAVE_FORMAT = "zerocad-autosave";
export const AUTOSAVE_VERSION = 1;
/** The one slot there is: one device, one current document. */
export const AUTOSAVE_KEY = "current";

/** What is stored: the file's text, as `save()` writes it, and the document around it. */
export interface AutosaveRecord {
  format: typeof AUTOSAVE_FORMAT;
  version: number;
  name: string;
  dirty: boolean;
  text: string;
  /** When it was written, in ms since the epoch — for a person reading storage, not for any rule. */
  at: number;
  /**
   * The file handle a save writes back to, where the platform has one and can
   * store it (Chromium's handles survive in IndexedDB; nothing else has any).
   */
  handle?: unknown;
}

/** Where the record goes. IndexedDB in the app (filehost.ts); a Map in a test. Either may reject. */
export interface AutosaveStore {
  read(key: string): Promise<unknown>;
  /** `null` clears the slot. */
  write(key: string, value: unknown): Promise<void>;
}

/** Timers, injectable so a test can step the debounce by hand. */
export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export function isAutosaveRecord(x: unknown): x is AutosaveRecord {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return r.format === AUTOSAVE_FORMAT && typeof r.version === "number" && typeof r.name === "string"
    && typeof r.dirty === "boolean" && typeof r.text === "string";
}

/**
 * The autosave: the current document written to the device after every
 * change (debounced) and whenever the app is hidden, and read back on start.
 *
 * Three states. **On**, writing. **Held**, after a stored drawing could not be
 * restored (a file from a newer build): nothing is written, so the copy that
 * would not open is kept rather than overwritten with an empty drawing, until
 * the person replaces the document on purpose — `newFile()` or opening a file
 * (`replace`). **Off**, when storage refused (a private window, a sandbox,
 * full): said once, and the app carries on without it.
 */
export class Autosave {
  private readonly store: AutosaveStore | null;
  private readonly delay: number;
  private readonly timers: Timers;
  private readonly log: (line: string) => void;
  private state: "on" | "held" | "off" = "on";
  private timer: unknown = null;
  /** What was last written, so a change that changed nothing writes nothing. */
  private last: string | null = null;
  /** Writes in order: a slow write may not land after a newer one. */
  private queue: Promise<void> = Promise.resolve();
  private source: (() => Omit<AutosaveRecord, "format" | "version" | "at">) | null = null;
  private readonly now: () => number;

  constructor(store: AutosaveStore | null, options: {
    log: (line: string) => void; delay?: number; timers?: Timers; now?: () => number;
  }) {
    this.store = store;
    this.log = options.log;
    this.delay = options.delay ?? AUTOSAVE_DELAY_MS;
    this.timers = options.timers ?? realTimers;
    this.now = options.now ?? (() => Date.now());
    if (!store) this.off("this browser gives the app no storage");
  }

  /** "on", "held" or "off" — for a test, and for the log line that explains a pause. */
  get mode(): "on" | "held" | "off" {
    return this.state;
  }

  /** What to write: the host's document, read at the moment of writing. */
  connect(source: () => Omit<AutosaveRecord, "format" | "version" | "at">): void {
    this.source = source;
  }

  /**
   * Reads the stored document and hands it to `apply` — which turns its text
   * back into a model, and throws for one it cannot (a newer format). Settles
   * with the record and what `apply` made, or null when there was nothing to
   * restore, storage refused, or the drawing would not open; each of the last
   * two is said in the log.
   */
  async restore<T>(apply: (record: AutosaveRecord) => T): Promise<{ record: AutosaveRecord; value: T } | null> {
    if (!this.store || this.state === "off") return null;
    let raw: unknown;
    try {
      raw = await this.store.read(AUTOSAVE_KEY);
    } catch (e) {
      this.off(message(e));
      return null;
    }
    if (raw === null || raw === undefined) return null;
    try {
      if (!isAutosaveRecord(raw)) throw new Error("what is stored is not an autosaved drawing");
      if (raw.version > AUTOSAVE_VERSION) {
        throw new Error(`it was stored by a newer build (autosave version ${raw.version}; this build reads ${AUTOSAVE_VERSION})`);
      }
      const value = apply(raw);
      // What is stored is what is open: nothing to write until it changes.
      this.last = signature(raw);
      return { record: raw, value };
    } catch (e) {
      this.state = "held";
      this.log(`the drawing autosaved on this device could not be restored — ${message(e)}. It is kept, not `
        + "overwritten: autosave is paused until newFile() or opening a file replaces it.");
      return null;
    }
  }

  /** A change: write once things have been quiet for `delay`. */
  schedule(): void {
    if (this.state !== "on") return;
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => {
      this.timer = null;
      void this.write();
    }, this.delay);
  }

  /** Write now — the app is being hidden, or a document was just opened, saved or made. Settles when written. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clear(this.timer);
      this.timer = null;
    }
    return this.write();
  }

  /** The document was replaced on purpose (new, or a file opened): a held autosave resumes, and writes it now. */
  replace(): Promise<void> {
    if (this.state === "held") this.state = "on";
    return this.flush();
  }

  /**
   * Empties the slot and stops writing for the rest of this page's life. For
   * automation only — a test that reloads wanting the app's first start — and
   * on the debug hook, never in the command surface: a person's way to an
   * empty start is `newFile()`.
   */
  forget(): Promise<void> {
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    const wasOn = this.state !== "off";
    this.state = "off";
    if (!wasOn || !this.store) return Promise.resolve();
    const store = this.store;
    this.queue = this.queue.then(() => store.write(AUTOSAVE_KEY, null)).catch(() => {});
    return this.queue;
  }

  private write(): Promise<void> {
    if (this.state !== "on" || !this.source || !this.store) return this.queue;
    let record: AutosaveRecord;
    try {
      record = { format: AUTOSAVE_FORMAT, version: AUTOSAVE_VERSION, ...this.source(), at: this.now() };
    } catch (e) {
      // The host could not say what its document is (a model mid-swap). Not
      // storage's fault, so not a reason to stop: the next change tries again.
      this.log(`autosave skipped: ${message(e)}`);
      return this.queue;
    }
    const sig = signature(record);
    if (sig === this.last) return this.queue;
    this.last = sig;
    const store = this.store;
    this.queue = this.queue.then(() => store.write(AUTOSAVE_KEY, record)).catch((e) => {
      this.last = null;
      this.off(message(e));
    });
    return this.queue;
  }

  private off(why: string): void {
    if (this.state === "off") return;
    this.state = "off";
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = null;
    // Once, and in plain words: on a phone this is the line that says a
    // drawing will not survive the app being closed.
    this.log(`autosave is off — ${why}. A drawing lives only until the app closes: save it to keep it.`);
  }
}

function signature(r: Pick<AutosaveRecord, "name" | "dirty" | "text">): string {
  return `${r.name}\u0000${r.dirty}\u0000${r.text}`;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
