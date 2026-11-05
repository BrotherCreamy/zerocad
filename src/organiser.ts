// The organiser pane (docs/plans/organiser.md): the groups and the features,
// each a row that can be seen, hidden, selected and opened.
//
// The owner: *"there needs to be a group pane I think, and the ability to e.g.
// create a new group and "open" the group, which means any entities which get
// created become a part of that group."* The organisation method is the groups
// that exist (docs/plans/groups.md) — overlapping sets that own nothing — plus
// the one thing they lacked, an **open group** new geometry joins. So this pane
// adds no state of its own: every row is read off the model, and **every
// control types its command through `submit`**, as the context menu's items and
// the toolbar's buttons do — the eye `hide("g1")`, a row `select("g1")`, the ＋
// `opengroup(group())`. Nothing here can do what a typed line could not, and
// the log says what each press did.
//
// **A section is a title and rows built from the model** — Groups, Features —
// so the typed objects the next design conversation is about (regions, chains,
// solids) arrive as more sections of this pane rather than a new one.
//
// The split is menu.ts's: what the pane shows and what each control types is
// pure (`organiserSections`, `rowMenu`, `addCommand`), tested without a DOM;
// the DOM half is thin. It reads the model and imports nothing from the tools,
// and the panel it sits in is the panel manager's like any other — moved,
// docked, hidden from the app menu's Panes and sized by the interface size
// without either knowing it exists.

import { isBlendFeature, type BlendFeature, type FeatureEntry, type Model } from "./model.ts";
import { chainsOf, modeOf } from "./modes.ts";
import type { Menu, MenuItem } from "./menu.ts";
import { giveTip, type AttachTip, type Tip } from "./tooltip.ts";

/**
 * What a row's eye shows: everything in it drawn, everything hidden, some of
 * each, or nothing to hide (an empty group).
 */
export type Eye = "shown" | "hidden" | "partial" | "none";

export interface OrganiserRow {
  /** The group's or the feature's name — what every command it types names. */
  name: string;
  /** After the name: a feature's kind, nothing for a group. */
  detail: string;
  /** Its members: a group's, or what a feature made. */
  count: number;
  eye: Eye;
  /** What the eye types — `hide("g1")` or `show("g1")` — or null when there is nothing to hide. */
  eyeCommand: string | null;
  /** What a tap on the row types: `select("g1")`. */
  tapCommand: string;
  /** Every member is in the canvas's selection (and there is one). */
  selected: boolean;
  /** Whether it is the open group — null for a row that cannot be opened, a feature. */
  open: boolean | null;
  /** What the open marker types: `opengroup("g1")`, or `closegroup()` on the open one. */
  openCommand: string | null;
}

export interface OrganiserSection {
  /** `groups`, `features` — what the DOM keys a section by. */
  id: string;
  title: string;
  rows: OrganiserRow[];
  /**
   * What it says with no rows: the way to make one — or null, for a section
   * not shown at all until it has a row. Bodies: with no feature, Features
   * already says how to make one, and the line said twice pushed Groups out
   * of a phone's pane (found by organiser.e2e.ts under iPhone 13).
   */
  empty: string | null;
}

function quoted(name: string): string {
  return JSON.stringify(name);
}

/** The eye over a set of names, by what is hidden; a feature hidden by name counts as all of it. */
function eyeOf(model: Model, members: readonly string[], whole = false): Eye {
  if (whole) return "hidden";
  if (!members.length) return "none";
  const hid = members.filter((n) => model.hidden.has(n)).length;
  return hid === 0 ? "shown" : hid === members.length ? "hidden" : "partial";
}

/** What the eye types: anything hidden in it shows it all, a set wholly shown hides. */
function eyeCommand(name: string, eye: Eye): string | null {
  if (eye === "none") return null;
  return eye === "shown" ? `hide(${quoted(name)})` : `show(${quoted(name)})`;
}

/**
 * The pane's sections, read off the model — the canvas's `selection` only for
 * which rows are lit. Pure: a test asks it what the pane would show.
 */
export function organiserSections(model: Model, selection: readonly string[] = []): OrganiserSection[] {
  const chosen = new Set(selection);
  const lit = (members: readonly string[]) => members.length > 0 && members.every((m) => chosen.has(m));
  const groups: OrganiserRow[] = [...model.groups.values()].map((g) => {
    const eye = eyeOf(model, g.members);
    const open = model.openGroup === g.name;
    return {
      name: g.name, detail: "", count: g.members.length, eye, eyeCommand: eyeCommand(g.name, eye),
      tapCommand: `select(${quoted(g.name)})`, selected: lit(g.members),
      open, openCommand: open ? "closegroup()" : `opengroup(${quoted(g.name)})`,
    };
  });
  const features: OrganiserRow[] = [...model.features.values()].map((f) => {
    // `hide("e1")` hides the feature's own name with what it made (its faces
    // go with it), so the name is what says it is hidden.
    const eye = eyeOf(model, f.owns, model.hidden.has(f.name));
    const mode = modeOf(f);
    return {
      name: f.name, detail: mode === "new" ? f.kind : `${f.kind} · ${mode}`, count: f.owns.length, eye, eyeCommand: eyeCommand(f.name, eye),
      tapCommand: `select(${quoted(f.name)})`, selected: lit(f.owns.filter((n) => !model.hidden.has(n))),
      open: null, openCommand: null,
    };
  });
  // Fillets and chamfers are features too (docs/plans/solid-fillets.md), each
  // after the sweeps made before it: a row with its eye — hiding one leaves it
  // out of its body — and Edit and Delete on its menu.
  for (const b of model.blends.values()) {
    const eye = eyeOf(model, b.owns, model.hidden.has(b.name));
    const row: OrganiserRow = {
      // The kind alone: a phone's pane cut "chamfer · 1 edge" (seen); its menu's header says the edges.
      name: b.name, detail: b.kind, count: b.owns.length, eye,
      eyeCommand: eyeCommand(b.name, eye), tapCommand: `select(${quoted(b.name)})`,
      selected: lit(b.owns.filter((n) => !model.hidden.has(n))), open: null, openCommand: null,
    };
    const after = features.findIndex((f) => Number(f.name.slice(1)) > Number(b.name.slice(1)));
    if (after < 0) features.push(row);
    else features.splice(after, 0, row);
  }
  // A body is the result of its chain (modes.ts), named by its first feature:
  // hiding it is hiding that feature, which hides the body whole. Its detail
  // is the rest of the chain, each feature signed by what it does — +e3 −e2
  // after the name e1 (a phone's narrow pane cut "e1 e1 +e3 −e2" to "e…").
  const sign: Record<string, string> = { add: "+", cut: "−", intersect: "∩", new: "" };
  // A fillet signed ⌒ and a chamfer ⌔ in the chain, where they fall in it.
  const stepSign = (f: FeatureEntry | BlendFeature) => (isBlendFeature(f) ? (f.kind === "fillet" ? "⌒" : "⌔") : sign[modeOf(f)]);
  const bodies: OrganiserRow[] = chainsOf(model, { hidden: true }).bodies.map((c) => {
    const first = c.features[0];
    const members = c.steps.flatMap((f) => f.owns);
    const eye: Eye = model.hidden.has(first.name) ? "hidden" : "shown";
    return {
      name: c.name, detail: c.steps.slice(1).map((f) => `${stepSign(f)}${f.name}`).join(" "),
      count: c.steps.length, eye, eyeCommand: eyeCommand(first.name, eye),
      tapCommand: `select(${c.steps.map((f) => quoted(f.name)).join(", ")})`,
      selected: lit(members.filter((n) => !model.hidden.has(n))), open: null, openCommand: null,
    };
  });
  return [
    { id: "bodies", title: "Bodies", rows: bodies, empty: null },
    { id: "groups", title: "Groups", rows: groups, empty: "none — ＋ makes one, open to draw into" },
    { id: "features", title: "Features", rows: features, empty: "none — an extrude or a revolve makes one" },
  ];
}

/**
 * What the ＋ in the pane's header types: a group of the selection, or — with
 * nothing selected — a new empty group, opened at once, so what is drawn next
 * joins it (the owner's *"create a new group and "open" the group"*). One line,
 * so one undo step.
 */
export function addCommand(selection: readonly string[]): string {
  return selection.length ? `group(${selection.map(quoted).join(", ")})` : "opengroup(group())";
}

/**
 * A row's menu (a right-click, or a finger's long-press), each item typing its
 * command — for a group: Rename (put in the command line to finish, as *Set
 * value…* is), Add selection, Remove selection, Open or Close, Ungroup; for a
 * feature: *Edit e1* and Delete. An item that would do nothing is shown off,
 * with the reason, as the context menu shows one.
 */
export function rowMenu(model: Model, name: string, selection: readonly string[] = []): Menu | null {
  const g = model.groups.get(name);
  if (g) {
    const inIt = selection.filter((n) => g.members.includes(n));
    const out = selection.filter((n) => !g.members.includes(n));
    const args = (names: readonly string[]) => [quoted(name), ...names.map(quoted)].join(", ");
    const open = model.openGroup === name;
    const items: MenuItem[] = [
      { label: "Rename…", action: { do: "type", text: `rename(${quoted(name)}, "` } },
      out.length
        ? { label: "Add selection", action: { do: "run", command: `addTo(${args(out)})` } }
        : { label: "Add selection", action: { do: "disabled", why: selection.length ? `the selection is in ${name} already` : "select something to add first" } },
      inIt.length
        ? { label: "Remove selection", action: { do: "run", command: `removeFrom(${args(inIt)})` } }
        : { label: "Remove selection", action: { do: "disabled", why: selection.length ? `none of the selection is in ${name}` : "select members to remove first" } },
      open
        ? { label: "Close", action: { do: "run", command: "closegroup()" } }
        : { label: "Open", action: { do: "run", command: `opengroup(${quoted(name)})` } },
      { label: "Ungroup", action: { do: "run", command: `ungroup(${quoted(name)})` } },
    ];
    const count = `${g.members.length} member${g.members.length === 1 ? "" : "s"}`;
    return { header: `${name}  group of ${count}${open ? "  ·  open" : ""}`, items };
  }
  const f = model.features.get(name) ?? model.blends.get(name);
  if (f) {
    return {
      header: f.kind === "fillet" || f.kind === "chamfer"
        ? `${name}  ${f.kind} of ${f.edges.length} edge${f.edges.length === 1 ? "" : "s"} of ${f.into}`
        : `${name}  ${f.kind}, ${f.owns.length} made`,
      items: [
        { label: `Edit ${name}`, action: { do: "run", command: `edit(${quoted(name)})` } },
        { label: "Delete", action: { do: "run", command: `del(${quoted(name)})` } },
      ],
    };
  }
  return null;
}

// ---- the DOM ----------------------------------------------------------------

/** What the pane needs of its host. */
export interface OrganiserHost {
  /** The sections as they are now (`organiserSections` of the model and the selection). */
  sections(): OrganiserSection[];
  /** The canvas's selection now — what the ＋ groups. */
  selection(): readonly string[];
  /** A row's menu, or null for a row that has none. */
  menu(name: string): Menu | null;
  /** Shows a menu at a point in the drawing's box — the context menu's own element. */
  showMenu(menu: Menu, x: number, y: number): void;
  /** Types one line into the command machinery, as one user action — `submit`. */
  run(command: string): void;
  /** Gives the ＋, the eyes, the markers and the rows their tooltips (tooltip.ts); without it, each has a `title`. */
  tooltip?: AttachTip;
}

/** The ＋'s tooltip: what it would type with this selection. */
export function addTip(selection: readonly string[]): Tip {
  return {
    name: "New group",
    summary: selection.length ? "Groups what is selected"
      : "Makes an empty group and opens it, so what you draw next joins it",
    command: addCommand(selection),
  };
}

/** An eye's tooltip, by what it shows now. */
export function eyeTip(r: OrganiserRow): Tip {
  if (r.eyeCommand === null) return { name: r.name, summary: "Shows or hides it", off: `${r.name} is empty — nothing to hide` };
  return r.eye === "shown"
    ? { name: `Hide ${r.name}`, summary: "Stops drawing it; it is kept, and still solved", command: r.eyeCommand }
    : { name: `Show ${r.name}`, summary: r.eye === "partial" ? "Draws all of it again — some is hidden" : "Draws it again", command: r.eyeCommand };
}

/** A group's open marker's tooltip. */
export function openTip(r: OrganiserRow): Tip {
  return r.open
    ? { name: `Close ${r.name}`, summary: `${r.name} is open: what you draw joins it — this stops that`, command: r.openCommand }
    : { name: `Open ${r.name}`, summary: `What you draw next joins ${r.name}`, command: r.openCommand };
}

/** How long a finger holds a row before its menu opens — iOS's own long-press, about. */
export const LONG_PRESS_MS = 500;
/** How far a held finger may wander before it is a scroll, not a long-press. */
const LONG_PRESS_SLOP = 8;

const SVG = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
/** The eye: open for shown, struck through for hidden, half-lidded for partly hidden. */
const EYES: Readonly<Record<Eye, string>> = {
  shown: `<svg ${SVG}><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.9"/></svg>`,
  hidden: `<svg ${SVG}><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M2.5 13.5l11-11"/></svg>`,
  partial: `<svg ${SVG}><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><path d="M1.5 8h13"/></svg>`,
  none: `<svg ${SVG}><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" stroke-dasharray="1.5 2"/></svg>`,
};

/**
 * The pane's body: rebuilt when what it shows changes (`sync`, cheap to call
 * every frame), and only then — a rebuild mid-press would drop the row the
 * finger is on. The ＋ is a button in the panel's strip; its press is kept off
 * the strip, so pressing it never starts a drag of the pane.
 */
export class Organiser {
  private body: HTMLElement;
  private host: OrganiserHost;
  private shown = "";
  /** Set when a long-press opened a menu, so the click its release makes is not also a tap. */
  private swallow = false;

  constructor(body: HTMLElement, add: HTMLElement | null, host: OrganiserHost) {
    this.body = body;
    this.host = host;
    if (add) {
      // The strip drags the pane from a press anywhere on it; the ＋'s press
      // is its own. (The strip's mousedown still keeps the command line's focus.)
      add.addEventListener("pointerdown", (e) => e.stopPropagation());
      add.addEventListener("click", () => this.host.run(addCommand(this.host.selection())));
      giveTip(add, () => addTip(this.host.selection()), this.host.tooltip);
    }
    body.addEventListener("contextmenu", (e) => e.preventDefault());
    this.sync();
  }

  /** Rebuilds the body if the sections changed; returns whether it did. */
  sync(): boolean {
    const sections = this.host.sections();
    const key = JSON.stringify(sections);
    if (key === this.shown) return false;
    this.shown = key;
    this.body.textContent = "";
    for (const s of sections) if (s.rows.length || s.empty !== null) this.body.appendChild(this.sectionEl(s));
    return true;
  }

  private sectionEl(s: OrganiserSection): HTMLElement {
    const el = document.createElement("div");
    el.className = "osect";
    el.dataset.section = s.id;
    const head = document.createElement("div");
    head.className = "ohead";
    head.textContent = s.title;
    el.appendChild(head);
    if (!s.rows.length) {
      const none = document.createElement("div");
      none.className = "onone";
      none.textContent = s.empty ?? "";
      el.appendChild(none);
    }
    for (const r of s.rows) el.appendChild(this.rowEl(r));
    return el;
  }

  private rowEl(r: OrganiserRow): HTMLElement {
    const row = document.createElement("div");
    row.className = r.selected ? "orow on" : "orow";
    row.dataset.name = r.name;
    if (r.open) row.dataset.open = "";
    // A mouse's only: a finger's hold on a row is its menu, which says more.
    giveTip(row, () => ({ name: r.name, summary: "Selects it — right-click for its menu", command: r.tapCommand }),
      this.host.tooltip, { hold: false });

    // The open marker first, a radio's place: one group at a time is open. A
    // feature cannot be opened — its members follow its profile — and keeps
    // the slot empty so the names line up.
    if (r.openCommand !== null) {
      row.appendChild(this.button("oopen", r.open ? "●" : "○", r.openCommand, () => openTip(r)));
    } else {
      const slot = document.createElement("span");
      slot.className = "oopen slot";
      row.appendChild(slot);
    }
    const name = document.createElement("span");
    name.className = "oname";
    name.textContent = r.name;
    row.appendChild(name);
    if (r.detail) {
      const detail = document.createElement("span");
      detail.className = "odetail";
      detail.textContent = r.detail;
      row.appendChild(detail);
    }
    const count = document.createElement("span");
    count.className = "ocount";
    count.textContent = String(r.count);
    row.appendChild(count);
    const eye = this.button("oeye", "", r.eyeCommand, () => eyeTip(r));
    eye.innerHTML = EYES[r.eye];
    eye.dataset.eye = r.eye;
    row.appendChild(eye);

    row.addEventListener("click", () => {
      if (this.swallow) { this.swallow = false; return; }
      this.host.run(r.tapCommand);
    });
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      if (this.swallow) return; // the long-press already opened it
      this.openMenu(r.name, e.clientX, e.clientY);
    });
    this.longPress(row, r.name);
    return row;
  }

  private button(cls: string, text: string, command: string | null, tip: () => Tip): HTMLButtonElement {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    b.setAttribute("aria-label", tip().name);
    giveTip(b, tip, this.host.tooltip);
    if (command === null) b.disabled = true;
    else b.dataset.command = command;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      if (command !== null) this.host.run(command);
    });
    return b;
  }

  /**
   * A finger held on a row opens its menu, as a right-click does: iOS fires no
   * `contextmenu` for a long-press on something that is not a link, so the
   * pane times it itself. A finger that wanders is scrolling the list.
   */
  private longPress(row: HTMLElement, name: string): void {
    row.addEventListener("pointerdown", (e) => {
      // Every press starts clean: a long-press's menu swallows the click its
      // own release makes, and must not swallow the next tap's as well.
      this.swallow = false;
      if (e.pointerType !== "touch") return;
      // A hold on the row's marker or eye is that button's — its tooltip —
      // not the row's menu: one hold, one answer.
      if (e.target instanceof Element && e.target.closest("button")) return;
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
