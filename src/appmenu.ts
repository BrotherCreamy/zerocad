// The app menu: what the logo opens (docs/plans/chrome-logo-scale.md). The
// owner: *"Maybe if you click on the logo, that brings up settings"*, and then
// *"Clicking on the logo should bring up a dropdown menu, and that menu should
// include a zoom level little spin box like - 80% +, a show hide for the
// panes, and file open etc etc"*.
//
// A dropdown under the logo, in the context menu's family (same ground,
// border and type), in sections: **File** — the document's name and an
// unsaved dot, then New, Open…, Save, Share…, Export STEP…; **Interface size** — the spin
// box; **Panes** — a checkbox per panel the panel manager has; **View** —
// Shaded / Hidden / Wire; **About** — the build and the source.
//
// **Every control types its command through `submit`**, as every menu item
// and every button does: a File item types `newFile()`, the spin box
// `ui({ scale: 0.8 })`, a pane's box `ui({ hide: "log" })`, a view
// `view("wire")` — so the log shows what was done, the recall history has it,
// and the menu can do nothing a typed line could not. A File command that does
// not exist yet (the files package, docs/plans/files.md, brings them) is shown
// disabled with that reason rather than typed to be refused.
//
// The split is menu.ts's: what each control says and types is pure functions,
// tested without a DOM; the DOM half is thin. This file imports nothing from
// the model or the tools — the host hands it the document's name, the panes
// and the settings, and takes back command strings.

import { UI_MAX, UI_MIN, formatScale, stepScale } from "./uiscale.ts";
import { giveTip, type AttachTip, type Tip } from "./tooltip.ts";

/** A File item: what it is called and the command it types. */
export interface FileItem { label: string; command: string }

/** In the order the menu shows them — the seam with the files package, by exactly these names. */
export const FILE_ITEMS: readonly FileItem[] = [
  { label: "New", command: "newFile()" },
  { label: "Open…", command: "openFile()" },
  { label: "Save", command: "saveFile()" },
  { label: "Share…", command: "shareFile()" },
  // A copy for another CAD tool, not the document (docs/plans/step-export.md).
  { label: "Export STEP…", command: "exportStep()" },
];

/** The function a command calls: `newFile()` → `newFile`. */
export function commandName(command: string): string {
  return command.replace(/\(.*$/, "");
}

/**
 * Why a File item is disabled, or null when its command exists and it can be
 * typed. Asked of the command line's own scope (`defined`), so the item comes
 * alive the moment the command does — the files package, or one defined by
 * hand at the command line — with nothing here to change.
 */
export function fileItemOff(item: FileItem, defined: (name: string) => boolean): string | null {
  const name = commandName(item.command);
  return defined(name) ? null : `${name}() is not in this build yet`;
}

/** The document, as the File section names it: `{ name, dirty }`. */
export interface DocumentState { name: string; dirty: boolean }

/** The host's `document()` until the files package supplies the real one. */
export const UNTITLED: DocumentState = { name: "Untitled", dirty: false };

/** The line the spin box types: `ui({ scale: 0.8 })`, or for the device's default `ui({ scale: "default" })`. */
export function scaleCommand(scale: number | "default"): string {
  return `ui({ scale: ${scale === "default" ? '"default"' : String(scale)} })`;
}

/** What − and + type from `scale`, or null at the end of the range, where the button is off. */
export function spinCommands(scale: number): { down: string | null; up: string | null } {
  return {
    down: scale <= UI_MIN + 1e-9 ? null : scaleCommand(stepScale(scale, -1)),
    up: scale >= UI_MAX - 1e-9 ? null : scaleCommand(stepScale(scale, 1)),
  };
}

/**
 * A spin box button's tooltip: − and + say what they step to, or that the
 * end of the range is reached; the number says it puts the size back.
 */
export function spinTip(part: "dec" | "val" | "inc", scale: number, command: string | null): Tip {
  if (part === "val") {
    return { name: `Interface size ${formatScale(scale)}`, summary: "Back to 100 %, this device's own size", command };
  }
  const down = part === "dec";
  return {
    name: down ? "Smaller" : "Larger",
    summary: `${down ? "Shrinks" : "Grows"} the panels, type and marks by 10 %`,
    command,
    off: command ? null : `already the ${down ? "smallest" : "largest"}, ${formatScale(down ? UI_MIN : UI_MAX)}`,
  };
}

/** One pane as the Panes section lists it — `Panels.panes()`. */
export interface PaneState { id: string; label: string; shown: boolean }

/** The line a pane's box types to turn it the other way. */
export function paneCommand(id: string, show: boolean): string {
  return `ui({ ${show ? "show" : "hide"}: ${JSON.stringify(id)} })`;
}

/** What the menu needs of its host. */
export interface AppMenuHost {
  /** Types one line into the command machinery, as one user action — `submit`. */
  run(command: string): Promise<unknown> | void;
  /** The document's name and whether it has unsaved changes. */
  document(): DocumentState;
  /** Whether the command line's scope has a function of this name. */
  defined(name: string): boolean;
  /** The viewer's multiplier on this device's own 100 % (uiscale.ts) — what the spin box shows. */
  scale(): number;
  /** Every pane the panel manager has, in its order. */
  panes(): PaneState[];
  /** How solids are shown now, and the modes there are, as `view()` names them. */
  viewMode(): string;
  viewModes: readonly string[];
  /** The build stamp's element, moved into About (the single-file build fills it in). */
  stamp: HTMLElement | null;
  /** Where the source is. */
  repository: string;
  /** Gives the spin box's buttons their tooltips (tooltip.ts); without it, each has a `title`. */
  tooltip?: AttachTip;
}

/**
 * The menu's DOM: built afresh each time it opens, and again after each
 * control it keeps open has typed its line — the spin box and the pane boxes
 * stay open so a viewer can try a size or two; a File item and a view close
 * it, being something done rather than something set.
 *
 * **Opened by the logo** (a tap or a click), **closed** by the logo again,
 * by Escape (the host asks `close()` first, as it asks the context menu), or
 * by a press anywhere else — which is swallowed if it was a left press, so the
 * tap that dismisses the menu does not also draw on the canvas underneath, as
 * the context menu's does not.
 */
export class AppMenu {
  private el: HTMLElement;
  private logo: HTMLElement;
  private host: AppMenuHost;
  private outside: ((e: PointerEvent) => void) | null = null;

  constructor(el: HTMLElement, logo: HTMLElement, host: AppMenuHost) {
    this.el = el;
    this.logo = logo;
    this.host = host;
    el.addEventListener("contextmenu", (e) => e.preventDefault());
    // Focus stays where it was — a click in the menu must not raise a phone's
    // keyboard that a tap on the command line had put away, nor take the
    // focus off the command line on a desktop.
    el.addEventListener("mousedown", (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); });
    logo.addEventListener("mousedown", (e) => e.preventDefault());
    logo.addEventListener("contextmenu", (e) => e.preventDefault());
    logo.addEventListener("click", () => { if (!this.close()) this.open(); });
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  open(): void {
    this.render();
    this.el.hidden = false;
    this.logo.setAttribute("aria-expanded", "true");
    this.place();
    this.outside = (e: PointerEvent) => {
      const at = e.target as Node;
      if (this.el.contains(at) || this.logo.contains(at)) return;
      this.close();
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("pointerdown", this.outside, true);
  }

  /** Closes the menu. Returns whether there was one open to close. */
  close(): boolean {
    if (!this.isOpen) return false;
    this.el.hidden = true;
    this.logo.setAttribute("aria-expanded", "false");
    if (this.outside) window.removeEventListener("pointerdown", this.outside, true);
    this.outside = null;
    return true;
  }

  /** Under the logo, held inside the area, and no taller than the room below it — it scrolls past that. */
  private place(): void {
    const wrap = this.el.parentElement!;
    const left = this.logo.offsetLeft;
    const top = this.logo.offsetTop + this.logo.offsetHeight;
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
    this.el.style.maxHeight = `${Math.max(120, wrap.clientHeight - top - 8)}px`;
  }

  /** Types `command`, then — for a control that keeps the menu open — shows what it changed. */
  private type(command: string, keepOpen: boolean): void {
    if (!keepOpen) this.close();
    const ran = this.host.run(command);
    if (keepOpen) void Promise.resolve(ran).then(() => { if (this.isOpen) this.render(); });
  }

  private render(): void {
    const h = this.host;
    this.el.textContent = "";

    // File: the name line, then the document's commands and the export.
    const doc = h.document();
    const file = this.section("File");
    const name = document.createElement("div");
    name.className = "docname";
    name.textContent = doc.name;
    if (doc.dirty) {
      const dot = document.createElement("span");
      dot.className = "dirty";
      dot.title = "unsaved changes";
      dot.setAttribute("aria-label", "unsaved changes");
      dot.textContent = "•";
      name.appendChild(dot);
    }
    file.appendChild(name);
    for (const item of FILE_ITEMS) {
      const off = fileItemOff(item, (n) => h.defined(n));
      // Off, the reason is said where the command would be — on the item's
      // own line, so four of them do not double the menu's height on a
      // landscape phone — and in full as its title.
      const row = this.item(item.label, off === null ? item.command : "not in this build yet",
        off === null ? () => this.type(item.command, false) : null);
      row.dataset.command = item.command;
      if (off !== null) {
        row.dataset.why = off;
        row.title = off;
      }
      file.appendChild(row);
    }

    // Interface size: − 80% +, a multiplier on this device's own 100 %. The
    // number puts it back to 100 %.
    const scale = h.scale();
    const size = this.section("Interface size");
    const spin = document.createElement("div");
    spin.className = "spin";
    const { down, up } = spinCommands(scale);
    const button = (cls: string, face: string, label: string, command: string | null) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.setAttribute("aria-label", label);
      giveTip(b, () => spinTip(cls as "dec" | "val" | "inc", scale, command), h.tooltip);
      // The face is drawn small; the button around it is the hit area, which
      // the stylesheet holds at a finger's 44 px under a finger.
      const span = document.createElement("span");
      span.className = "face";
      span.textContent = face;
      b.appendChild(span);
      if (command) {
        b.dataset.command = command;
        b.addEventListener("click", () => this.type(command, true));
      } else {
        b.disabled = true;
      }
      return b;
    };
    const reset = scaleCommand("default");
    spin.append(
      button("dec", "−", "smaller", down),
      button("val", formatScale(scale), "back to 100 %, this device's own size", reset),
      button("inc", "+", "larger", up),
    );
    const sizeRow = document.createElement("div");
    sizeRow.className = "srow";
    sizeRow.appendChild(spin);
    size.appendChild(sizeRow);

    // Panes: a box each, built from the panes there are.
    const panes = this.section("Panes");
    for (const pane of h.panes()) {
      const row = document.createElement("label");
      row.className = "item check";
      row.dataset.pane = pane.id;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = pane.shown;
      const command = paneCommand(pane.id, !pane.shown);
      box.addEventListener("change", () => this.type(command, true));
      const text = document.createElement("span");
      text.textContent = pane.label;
      const hint = document.createElement("span");
      hint.className = "cmd";
      hint.textContent = command;
      row.append(box, text, hint);
      panes.appendChild(row);
    }

    // View: the context menu's row, the same three words.
    const view = this.section("View");
    const choices = document.createElement("div");
    choices.className = "choices";
    const now = h.viewMode();
    for (const mode of h.viewModes) {
      const c = document.createElement("span");
      c.className = mode === now ? "choice on" : "choice";
      c.textContent = mode[0].toUpperCase() + mode.slice(1);
      const command = `view(${JSON.stringify(mode)})`;
      c.dataset.command = command;
      c.title = command;
      c.addEventListener("click", () => this.type(command, false));
      choices.appendChild(c);
    }
    view.appendChild(choices);

    // About: the build, and where the source is.
    const about = this.section("About");
    const build = document.createElement("div");
    build.className = "about";
    if (h.stamp) {
      // The stamp's own element, moved here: the single-file build writes it
      // into the page, and the tests read it by its id.
      if (!h.stamp.textContent) h.stamp.textContent = "development build";
      h.stamp.hidden = false;
      build.appendChild(h.stamp);
    }
    about.appendChild(build);
    const link = document.createElement("a");
    link.href = h.repository;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = h.repository.replace(/^https:\/\//, "");
    const linkRow = document.createElement("div");
    linkRow.className = "about";
    linkRow.appendChild(link);
    about.appendChild(linkRow);
  }

  private section(title: string): HTMLElement {
    const s = document.createElement("div");
    s.className = "sect";
    s.dataset.section = title;
    const head = document.createElement("div");
    head.className = "head";
    head.textContent = title;
    s.appendChild(head);
    this.el.appendChild(s);
    return s;
  }

  private item(label: string, command: string, act: (() => void) | null): HTMLElement {
    const row = document.createElement("div");
    row.className = act ? "item" : "item off";
    const l = document.createElement("span");
    l.textContent = label;
    const hint = document.createElement("span");
    hint.className = "cmd";
    hint.textContent = command;
    row.append(l, hint);
    row.title = command;
    if (act) row.addEventListener("click", act);
    return row;
  }
}
