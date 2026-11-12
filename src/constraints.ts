// The constraints palette (docs/plans/constraints-palette.md): a pane of its
// own, like the organiser, for the relations of whatever is selected.
//
// The owner: *"the constraint list should not be on the features palette, it
// should be a separate constraints palette. although i think it should still
// be installed as a workbench."* The list used to be the constrain tool's
// options pane — up only while the tool was armed, and on an iPhone tall
// enough to cover what had been picked (TODO.md, 2026-11-08). Now it is a
// panel: titled, docked, dragged, remembered, shown and hidden from the app
// menu's Panes, and a module (modules/constraints.ts) a workbench names or
// does not.
//
// **What it shows, for the names it is about** — the constrain tool's picks
// while that tool is armed, else the canvas's selection:
// - the relations that **apply** (`constraintsFor`), most likely first, one
//   row each, a row greyed with the reason where one cannot; a press types
//   the line, as the options pane's row did and as every menu item does;
// - the relations those names **already have**, each by the mark it wears on
//   the drawing (`glyphText`), its name, what it says, a dimension's value in
//   a field that types `set("d1.value", 60)`, and × that types `del`. A press
//   on the row selects it.
// With nothing selected it lists every relation of the drawing, newest first,
// so it is also the place to see what holds a drawing — and under that the
// **agreeing sets** (`Diagnosis.agreeing`): relations that say one thing
// together, none of them wrong, which the status only counts.
//
// **Room on a phone.** Where its rows do not fit the pane, the likeliest
// relations show and a "more…" row opens the rest — measured against the
// pane's real height, so a pane the viewer made taller shows more.
//
// The split is the organiser's: what the pane shows is pure (`paletteFor`),
// tested without a DOM; the DOM half is thin, and **every control types its
// command through `submit`**. It reads the model, the selection and the last
// diagnosis, and imports nothing from the tools: the tool's picks arrive as
// names, through the host.

import type { Model, RelationEntry } from "./model.ts";
import { valueArgIndex, SETTABLE_PROPERTY } from "./model.ts";
import { constraintsFor } from "./dimensioning.ts";
import { describeRelation } from "./picking.ts";
import { constrainedBy, glyphSymbol, glyphText } from "./glyphs.ts";
import { fieldText, parseField } from "./panels.ts";
import type { Menu } from "./menu.ts";
import { giveTip, type AttachTip } from "./tooltip.ts";

/** A relation the names take: a row that types its line, or is greyed with why it cannot. */
export interface ApplyRow {
  label: string;
  command: string;
  off?: string;
}

/** A relation the drawing has, as a row. */
export interface HeldRow {
  name: string;
  /** The mark it wears on the drawing — a dimension's value, else its symbol. */
  glyph: string;
  /** What it says, after its name: `dist p1 p2 50`. */
  text: string;
  /** A dimension's value — the one thing `set` takes — or null for a relation with none. */
  value: number | null;
  /** `rad` for an angle; nothing for a length. */
  unit: string;
  /** What a tap on the row types. */
  tapCommand: string;
  /** What × types. */
  deleteCommand: string;
  /** Whether the canvas's selection holds it. */
  selected: boolean;
}

export interface PaletteSection {
  /** `apply`, `held`, `all`, `agreeing` — what the DOM keys a section by. */
  id: "apply" | "held" | "all" | "agreeing";
  title: string;
  /** A word after the title, muted: how many, or what the set is. */
  note: string;
  rows: ApplyRow[] | HeldRow[];
  /** What it says with no rows, or null for a section not shown without any. */
  empty: string | null;
}

function quoted(name: string): string {
  return JSON.stringify(name);
}

/** The line `set` takes for a dimension's new value. */
export function setCommand(name: string, value: number): string {
  return `set(${quoted(`${name}.${SETTABLE_PROPERTY}`)}, ${fieldText(value)})`;
}

/** The ops whose value is an angle, in the radians `set` takes. */
const ANGLE_OPS = new Set(["angle", "revolution"]);

/**
 * What the palette says while the constrain tool waits for its first pick
 * (docs/plans/tool-howto.md, the empty palette teaches): **what can be picked
 * and what will be offered**, in a line. It used to say only *pick what to
 * relate — the relations that apply are listed here*, which is true and told
 * the owner nothing he could do: *"I don't even know how to add a parallel
 * relation."* The pairs named are ones the list answers with the relations
 * named after them (`constraintsFor`; a test holds each to it).
 */
export const PICKING =
  "pick what to relate — two lines, a line and a circle, a point and a line… " +
  "Parallel, Perpendicular, Tangent, Midpoint and the others that fit are then listed here";

/** A relation as the palette shows it. */
export function heldRow(model: Model, r: RelationEntry, selection: readonly string[]): HeldRow {
  let glyph: string;
  try {
    glyph = glyphText(model, r);
  } catch {
    glyph = glyphSymbol(r);
  }
  const at = valueArgIndex(r.op);
  const v = at === null ? null : r.args[at];
  return {
    name: r.name,
    glyph,
    text: describeRelation(r).slice(r.name.length).trim(),
    value: typeof v === "number" ? v : null,
    unit: ANGLE_OPS.has(r.op) ? "rad" : "",
    tapCommand: `select(${quoted(r.name)})`,
    deleteCommand: `del(${quoted(r.name)})`,
    selected: selection.includes(r.name),
  };
}

/**
 * The palette's sections, read off the model — pure, so a test asks it what
 * the pane would show. `names` is what the palette is about (the tool's picks,
 * else the selection's entities); `selection` only lights rows; `agreeing` is
 * the last diagnosis's sets, listed with nothing selected.
 */
export function paletteFor(
  model: Model, names: readonly string[], selection: readonly string[] = [], agreeing: readonly (readonly string[])[] = [],
  picking = false,
): PaletteSection[] {
  // What the palette is about: the names given, less any relation's — a
  // selected glyph lights its row and is nothing to relate. A face's
  // `"p1.p2.p3"`, a frame's arm `"f1.y"` and the solid kernel's own names are
  // kept: `constraintsFor` reads them (On face, Normal to plane, a greyed cell).
  const about = [...new Set(names)].filter((n) => !model.relations.has(n));
  const newestFirst = (rs: RelationEntry[]) => rs.reverse().map((r) => heldRow(model, r, selection));
  // The constrain tool armed with nothing picked yet: the palette says what
  // the tool is waiting for, where the list will be, rather than listing the
  // drawing as though nothing were going on.
  if (!about.length && picking) {
    return [{ id: "apply", title: "relate", note: "", rows: [], empty: PICKING }];
  }
  if (about.length) {
    const apply: ApplyRow[] = constraintsFor(model, about).map((a) => ({ label: a.label, command: a.text, ...(a.off ? { off: a.off } : {}) }));
    // The relations any of the names has, newest first: those naming it, or
    // naming a point it is built of — a line's `dist` is between its ends and
    // a circle's `fix` is on its centre, and both are what the line or the
    // circle *has* to anyone looking at it.
    const own = new Set(about.flatMap((n) => [n, ...(model.entities.has(n) ? model.refsOf(model.entities.get(n)!) : [])]));
    const held = newestFirst([...model.relations.values()].filter((r) => constrainedBy(model, r.name).some((n) => own.has(n))));
    const list = about.join(", ");
    return [
      { id: "apply", title: `relate ${list}`, note: "", rows: apply, empty: about.length === 1 ? "pick another to relate it to — or Fix is below" : `nothing relates ${list} — pick another` },
      { id: "held", title: `${list} ${about.length === 1 ? "has" : "have"}`, note: held.length ? String(held.length) : "", rows: held, empty: "no relation yet" },
    ];
  }
  const all = newestFirst([...model.relations.values()]);
  const sections: PaletteSection[] = [
    { id: "all", title: "relations", note: all.length ? String(all.length) : "", rows: all, empty: "none — select something to relate it" },
  ];
  for (const set of agreeing) {
    const rows = set.filter((n) => model.relations.has(n)).map((n) => heldRow(model, model.relationOf(n), selection));
    // Short enough for the pane at its default width: "4 say one thing together — none is wrong" was cut at "no…".
    if (rows.length) sections.push({ id: "agreeing", title: "agreeing", note: `${rows.length} say one thing — none is wrong`, rows, empty: null });
  }
  return sections;
}

/** What the pane needs of its host. */
export interface PaletteHost {
  /** The sections as they are now (`paletteFor`). */
  sections(): PaletteSection[];
  /** Types one line into the command machinery, as one user action — `submit`. */
  run(command: string): void;
  /**
   * Types a relation's line (an apply row) and tells the armed tool it ran,
   * so its picks are spent. Absent: `run`, untold.
   */
  command?(text: string): Promise<unknown> | void;
  /** Says a line in the log, as guidance — what a greyed row says when pressed. */
  note?(text: string): void;
  /** A relation's menu, or null. */
  menu(name: string): Menu | null;
  /** Shows a menu at a point in the drawing's box — the context menu's own element. */
  showMenu(menu: Menu, x: number, y: number): void;
  /** Gives the rows and × their tooltips (tooltip.ts); without it, each has a `title`. */
  tooltip?: AttachTip;
}

/** How long a finger holds a row before its menu opens — the organiser's. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 8;

/**
 * The pane's body: rebuilt when what it shows changes (`sync`, cheap to call
 * every frame), and only then — a rebuild mid-press would drop the row the
 * finger is on. Measured after each build: where the rows overflow the pane,
 * the apply rows are cut to the likeliest that fit and a "more…" row, until
 * that row is pressed or the names change.
 */
export class ConstraintsPalette {
  private body: HTMLElement;
  private host: PaletteHost;
  private shown = "";
  /** The names the last build was about: a change puts "more…" back. */
  private about = "";
  private expanded = false;
  /** Set when a long-press opened a menu, so the click its release makes is not also a tap. */
  private swallow = false;

  constructor(body: HTMLElement, host: PaletteHost) {
    this.body = body;
    this.host = host;
    body.addEventListener("contextmenu", (e) => e.preventDefault());
    // A field left mid-edit commits before a press elsewhere is handled, as
    // the options panel's do: the value typed is the value the next thing sees.
    document.addEventListener("pointerdown", (e) => {
      const at = document.activeElement;
      if (at instanceof HTMLInputElement && this.body.contains(at) && e.target !== at) this.commit(at);
    }, true);
    this.sync();
  }

  /** Rebuilds the body if what it shows changed; returns whether it did. */
  sync(): boolean {
    const sections = this.host.sections();
    const about = sections.map((s) => s.id === "apply" ? s.title : "").join("|");
    if (about !== this.about) { this.about = about; this.expanded = false; }
    const key = `${JSON.stringify(sections)}|${this.expanded}|${this.body.clientHeight}`;
    if (key === this.shown) return false;
    this.shown = key;
    this.build(sections, null);
    // Overflowing, the apply rows give way to the likeliest that fit, with a
    // row that opens the rest — measured on the real rows, since a greyed one
    // is three rows tall. A hidden pane (height 0) is left whole.
    const applies = sections.find((s) => s.id === "apply");
    const overflows = () => this.body.scrollHeight > this.body.clientHeight + 1;
    if (!this.expanded && applies && this.body.clientHeight > 0 && overflows()) {
      // **A section with nothing in it gives way first.** "l1, l2 have — no
      // relation yet" is a heading and a line, 39 px of a phone's 164 px
      // pane: nine tenths of a row a finger could press, spent on saying
      // nothing — which is why one relation showed where two fit (TODO.md,
      // "The phone palette wastes a row": the budget below was right, the
      // room it was given was not). Where everything fits it stays, and it
      // is back once more… is opened or a relation is made.
      const lean = sections.filter((s) => s === applies || s.rows.length > 0);
      if (lean.length < sections.length) {
        this.build(lean, null);
        if (!overflows()) return true;
      }
      const rows = Array.from(this.body.querySelectorAll<HTMLElement>(".ocmd"));
      if (rows.length > 1) {
        const rest = this.body.scrollHeight - rows.reduce((h, r) => h + r.offsetHeight, 0);
        const room = this.body.clientHeight - rest - rows[0].offsetHeight; // the more row's own line
        let used = 0, keep = 0;
        for (const r of rows) {
          if (used + r.offsetHeight > room) break;
          used += r.offsetHeight;
          keep++;
        }
        keep = Math.max(1, Math.min(keep, rows.length - 1));
        this.build(lean, keep);
      }
    }
    return true;
  }

  private build(sections: PaletteSection[], keep: number | null): void {
    this.body.textContent = "";
    for (const s of sections) {
      if (!s.rows.length && s.empty === null) continue;
      this.body.appendChild(this.sectionEl(s, s.id === "apply" ? keep : null));
    }
  }

  private sectionEl(s: PaletteSection, keep: number | null): HTMLElement {
    const el = document.createElement("div");
    el.className = "csect";
    el.dataset.section = s.id;
    const head = document.createElement("div");
    head.className = "chead";
    head.textContent = s.title;
    if (s.note) {
      const note = document.createElement("span");
      note.className = "cnote";
      note.textContent = s.note;
      head.appendChild(note);
    }
    el.appendChild(head);
    if (!s.rows.length) {
      const none = document.createElement("div");
      none.className = "cnone";
      none.textContent = s.empty ?? "";
      el.appendChild(none);
    }
    if (s.id === "apply") {
      const rows = s.rows as ApplyRow[];
      const shown = keep === null ? rows : rows.slice(0, keep);
      for (const r of shown) el.appendChild(this.applyRow(r));
      if (shown.length < rows.length) el.appendChild(this.moreRow(rows.length - shown.length));
    } else {
      for (const r of s.rows as HeldRow[]) el.appendChild(this.heldEl(r));
    }
    return el;
  }

  /**
   * A relation that applies: a row-wide button, the label and, dim beside it,
   * the line it types — the context menu's rule, every item showing what it
   * does. Pressed, it types that line; it never takes the focus, so typing
   * after it still types. A greyed row shows why where its command would be,
   * and says it whole in the log when pressed, where a phone can read it.
   */
  private applyRow(c: ApplyRow): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = c.off ? "ocmd off" : "ocmd";
    b.dataset.command = c.command;
    const label = document.createElement("span");
    label.className = "olabel";
    label.textContent = c.label;
    const cmd = document.createElement("span");
    cmd.className = "ocmdtext";
    cmd.textContent = c.off ?? c.command;
    b.append(label, cmd);
    b.title = c.off ? `${c.label} — ${c.off}` : `${c.label} — ${c.command}`;
    if (c.off) b.setAttribute("aria-disabled", "true");
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => {
      if (c.off) {
        this.host.note?.(`${c.label}: ${c.off}`);
        return;
      }
      void (this.host.command ? this.host.command(c.command) : this.host.run(c.command));
    });
    return b;
  }

  /** The row that opens the rest of the apply rows. */
  private moreRow(n: number): HTMLElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ocmd more";
    b.dataset.more = String(n);
    const label = document.createElement("span");
    label.className = "olabel";
    label.textContent = `${n} more…`;
    b.appendChild(label);
    b.title = "shows every relation that applies";
    b.addEventListener("mousedown", (e) => e.preventDefault());
    b.addEventListener("click", () => { this.expanded = true; this.sync(); });
    return b;
  }

  /**
   * A relation the drawing has: its mark, its name, what it says, a
   * dimension's value in a field and ×. A tap selects it; a right-click or a
   * held finger opens its menu (Set value…, Delete — the glyph's own).
   */
  private heldEl(r: HeldRow): HTMLElement {
    const row = document.createElement("div");
    row.className = r.selected ? "crow on" : "crow";
    row.dataset.name = r.name;
    giveTip(row, () => ({ name: r.name, summary: `${r.text} — selects it; right-click for its menu`, command: r.tapCommand }),
      this.host.tooltip, { hold: false });
    const glyph = document.createElement("span");
    glyph.className = "cglyph";
    glyph.textContent = r.glyph;
    const name = document.createElement("span");
    name.className = "cname";
    name.textContent = r.name;
    const desc = document.createElement("span");
    desc.className = "cdesc";
    desc.textContent = r.text;
    row.append(glyph, name, desc);
    if (r.value !== null) {
      const field = document.createElement("input");
      field.type = "text";
      field.inputMode = "decimal";
      field.className = "cval";
      // The value as an attribute too (`defaultValue`): what `commit` puts
      // back for text that is not a number, and compares against. Set only
      // the property, a rebuilt field put back to nothing — "forty" typed
      // left the field blank (constraintspalette.e2e.ts found it).
      field.defaultValue = fieldText(r.value);
      field.value = field.defaultValue;
      field.dataset.relation = r.name;
      field.setAttribute("aria-label", `${r.name}'s value`);
      field.addEventListener("pointerdown", (e) => e.stopPropagation());
      field.addEventListener("click", (e) => e.stopPropagation());
      field.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); this.commit(field); field.blur(); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); field.value = fieldText(r.value!); field.blur(); }
      });
      field.addEventListener("blur", () => this.commit(field));
      row.appendChild(field);
      if (r.unit) {
        const unit = document.createElement("span");
        unit.className = "cunit";
        unit.textContent = r.unit;
        row.appendChild(unit);
      }
    }
    const del = document.createElement("button");
    del.type = "button";
    del.className = "cdel";
    del.textContent = "×";
    del.dataset.command = r.deleteCommand;
    del.setAttribute("aria-label", `delete ${r.name}`);
    giveTip(del, () => ({ name: `Delete ${r.name}`, summary: "Removes the relation; undo brings it back", command: r.deleteCommand }), this.host.tooltip);
    del.addEventListener("pointerdown", (e) => e.stopPropagation());
    del.addEventListener("click", (e) => { e.stopPropagation(); this.host.run(r.deleteCommand); });
    row.appendChild(del);
    row.addEventListener("click", () => {
      if (this.swallow) { this.swallow = false; return; }
      this.host.run(r.tapCommand);
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.swallow) return;
      this.openMenu(r.name, e.clientX, e.clientY);
    });
    this.longPress(row, r.name);
    return row;
  }

  /**
   * A field's text, committed: a number other than the value shown types
   * `set("d1.value", …)`; text that is not a number puts the field back. The
   * value it had is read off the field's own dataset, so a field rebuilt
   * under the hand still compares against what it was showing.
   */
  private commit(field: HTMLInputElement): void {
    const name = field.dataset.relation;
    if (!name) return;
    const was = field.defaultValue;
    const v = parseField(field.value);
    if (v === null) { field.value = was; return; }
    if (fieldText(v) === was) { field.value = was; return; }
    field.defaultValue = fieldText(v);
    this.host.run(setCommand(name, v));
  }

  /** A finger held on a row opens its menu, as a right-click does — the organiser's long-press. */
  private longPress(row: HTMLElement, name: string): void {
    row.addEventListener("pointerdown", (e) => {
      this.swallow = false;
      if (e.pointerType !== "touch") return;
      if (e.target instanceof Element && e.target.closest("button, input")) return;
      const [x0, y0] = [e.clientX, e.clientY];
      const timer = setTimeout(() => {
        done();
        this.swallow = true;
        this.openMenu(name, x0, y0);
      }, LONG_PRESS_MS);
      const move = (ev: PointerEvent) => {
        if (ev.pointerId === e.pointerId && Math.hypot(ev.clientX - x0, ev.clientY - y0) > LONG_PRESS_SLOP) done();
      };
      const up = (ev: PointerEvent) => { if (ev.pointerId === e.pointerId) done(); };
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        window.removeEventListener("pointercancel", up, true);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
      window.addEventListener("pointercancel", up, true);
    });
  }

  private openMenu(name: string, clientX: number, clientY: number): void {
    const menu = this.host.menu(name);
    if (menu) this.host.showMenu(menu, clientX, clientY);
  }
}
