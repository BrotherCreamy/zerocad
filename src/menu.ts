// The right-click context menu: what is on it, and the small DOM that shows it.
//
// **Everything on this menu is a shortcut to a command the log shows.** An item
// does not call into the model; it types a line into the same command machinery
// the keyboard uses, and the log records what it typed. That is the whole design
// rule, and it buys three things at once. The menu teaches the command surface
// rather than hiding it behind a verb nobody can retype. Undo, journalling,
// re-solving and the status readout are already correct for a typed entry, so
// they are correct here without a second implementation. And no item can ever do
// something a typed command cannot — if one needs new machinery, the machinery
// is a separate package and the menu waits for it.
//
// So the interesting half of this file is `menuFor`, which is pure: model plus
// pick in, labels and command strings out, no DOM anywhere near it. That is what
// makes "which items for which pick kind" and "what does Dimension type for an
// arc" answerable in the unit suite rather than only in a browser.
//
// The values a dimension carries are the **current** measurements — a line's
// length as it stands, a circle's radius as it stands — so the action reads as
// "hold it where it is". That is what Onshape's dimension tool does, and it is
// the only reading under which the item is safe to click without looking: it
// adds a constraint the drawing already satisfies, and moves nothing.

import { SETTABLE_PROPERTY, valueArgIndex, type Model } from "./model.ts";
import { describePick, type Pick } from "./picking.ts";
import { frameBasis } from "./relations/refs.ts";

/**
 * What clicking an item does.
 *
 * `run` types a command; that is nearly all of them. `insert` drops a quoted
 * name into the command line, which is not a command but *is* exactly what a
 * left-click already does — it is on the menu so the menu describes itself
 * rather than to add a capability. `type` puts an **unfinished** command there
 * for the user to complete, which is what an item needing a number the menu
 * cannot know has to do — see Set value…, below. `disabled` is an item that is
 * shown and cannot be chosen, with the reason it cannot; see Fix, below, for
 * the one case this exists for.
 */
export type MenuAction =
  | { do: "run"; command: string }
  | { do: "insert"; name: string }
  | { do: "type"; text: string }
  | { do: "disabled"; why: string };

export interface MenuItem {
  label: string;
  action: MenuAction;
}

export interface Menu {
  /** A dim row naming what the menu is about, or null on empty canvas. */
  header: string | null;
  items: MenuItem[];
}

/**
 * The tool arms offered on empty canvas, in the order they appear. Labels are
 * the names the tools go by in the docs; the second element is the registered
 * tool name, which is what `arm` takes. A unit test checks every one of them
 * actually resolves, because a typo here would be a menu item that throws.
 */
const TOOL_ITEMS: [label: string, tool: string][] = [
  ["Point", "point"],
  ["Line", "line"],
  ["Rectangle", "rectangle"],
  ["Circle", "circle"],
  ["3 point circle", "circle3"],
  ["Arc", "arc"],
  ["3 point arc", "arc3"],
  ["Fillet", "fillet"],
];

/**
 * How a measurement is written into the command an item types. Three decimals,
 * the same as the hover tag's, because these two are read side by side and a
 * menu that typed `dist("p1","p2",39.99999999999999)` after a tag said `len 40`
 * would look like it had measured something else.
 *
 * The rounding is a real, deliberate limit: a dimension can move what it
 * measures by up to half a thousandth of a unit. That is below what the drawing
 * shows at any usable zoom, and the alternative — a full-precision literal in
 * the log and in the saved journal — trades a readable command for a difference
 * nobody can see.
 */
function num(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function quoted(name: string): string {
  return JSON.stringify(name);
}

/**
 * The menu for whatever a right-click landed on: an entity, a constraint glyph
 * (`pick.kind === "relation"`), or empty canvas (`pick === null`).
 *
 * Pure, and deliberately so — it reads the model and returns strings. Nothing
 * here runs a command, touches the DOM or knows a menu can be on screen.
 */
export function menuFor(model: Model, pick: Pick | null): Menu {
  if (!pick) return emptyCanvasMenu(model);
  if (pick.kind === "relation") {
    return {
      // The same sentence the hover tag writes for a glyph — `d1  dist p1 p2 50`
      // — because the menu is answering the question the tag just asked, and two
      // spellings of one relation would be two things to keep in step.
      header: describePick(model, pick),
      items: [
        ...setValueItem(model, pick.name),
        { label: "Delete", action: { do: "run", command: `del(${quoted(pick.name)})` } },
      ],
    };
  }
  return entityMenu(model, pick);
}

/**
 * **Set value…** on a dimension glyph, and nothing at all on any other
 * relation — a `par` has no value to set, and an item that existed only to
 * report that would be worse than no item.
 *
 * It **types an unfinished command** rather than running one: `set("d4.value", `
 * with the caret after the comma, for the user to finish with a number. That is
 * the house pattern for a command needing input the menu cannot know, and it is
 * the only shape available under the rule the menu is built on — every item is
 * a command the log shows, and a menu that popped its own number prompt would
 * be a fourth editing surface. The trailing ellipsis in the label is the
 * standing UI convention for "this asks you for something", so the item admits
 * up front that it does not finish the job.
 *
 * The dimension's *current* value is deliberately not typed in. It is already
 * on the drawing — the glyph you just right-clicked is the number — and
 * pre-filling it would leave the user editing a literal rather than stating
 * one, with a wrong keystroke silently re-committing the old value.
 */
function setValueItem(model: Model, name: string): MenuItem[] {
  const r = model.relations.get(name);
  if (!r || valueArgIndex(r.op) === null) return [];
  return [{
    label: "Set value…",
    action: { do: "type", text: `set(${quoted(`${name}.${SETTABLE_PROPERTY}`)}, ` },
  }];
}

/**
 * Empty canvas: the tools, plus the one-click way into the frame world.
 *
 * **Frame is `setDefaultFrame(frame())` when the drawing has no frame at all,
 * and `frame()` once it has one.** There is no world frame, so a drawing's first
 * frame is nearly always meant to be the default — `fix`, `xaxis()` and
 * `yaxis()` do nothing at all until one is set, and a first frame that was not
 * the default would leave the user with a marker on screen and the same error
 * message they had before. A *second* frame is a different intent: something
 * specific is being measured against it, and silently repointing the default
 * would move every bare `xaxis()` in the drawing. Neither case ever creates a frame the user
 * did not ask for, which is the rule the no-world-frame decision turns on.
 */
function emptyCanvasMenu(model: Model): Menu {
  const hasFrame = [...model.entities.values()].some((e) => e.kind === "frame");
  const noPlane = curvesNeedAFrame(model);
  return {
    header: null,
    items: [
      ...TOOL_ITEMS.map(([label, tool]): MenuItem => ({
        label,
        action: noPlane !== null && CURVE_TOOLS.has(tool)
          ? { do: "disabled", why: noPlane }
          : { do: "run", command: `arm(${quoted(tool)})` },
      })),
      {
        label: "Frame",
        action: { do: "run", command: hasFrame ? "frame()" : "setDefaultFrame(frame())" },
      },
    ],
  };
}

/**
 * The tools that build a circle or an arc — the ones a 3D model cannot run
 * without a default frame, since what they build is given that frame's plane
 * (see `CircleEntity`). The fillet is one: it makes an arc.
 */
const CURVE_TOOLS: ReadonlySet<string> = new Set(["circle", "circle3", "arc", "arc3", "fillet"]);

/**
 * Why the curve tools cannot run here, or null when they can — the model's own
 * standing message, read out of `resolveFrame` as Fix's is, so the menu and
 * the command line say the same thing. Only a 3D model asks: a 2D circle needs
 * no plane.
 *
 * **Shown and disabled, not hidden**, for Fix's reason: the absence of a frame
 * is exactly what a user needs told, and an item that simply vanished would
 * leave "where did Circle go" unanswered. Nor does the menu make the frame
 * itself — that is the Frame item, one row down, which a user chooses.
 */
function curvesNeedAFrame(model: Model): string | null {
  if (model.dim !== 3) return null;
  try {
    model.resolveFrame();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function entityMenu(model: Model, pick: Pick): Menu {
  const items: MenuItem[] = [
    { label: "Insert name", action: { do: "insert", name: pick.name } },
    { label: "Delete", action: { do: "run", command: `del(${quoted(pick.name)})` } },
  ];
  const dim = dimensionCommand(model, pick);
  if (dim) items.push({ label: "Dimension", action: { do: "run", command: dim } });
  if (pick.kind === "point") items.push(fixItem(model, pick.name));
  if (pick.kind === "frame") items.push(sketchOnItem(model, pick.name));
  return { header: describePick(model, pick), items };
}

/**
 * **Sketch on this**, on a frame: make it the default and look at it square-on
 * — Onshape's "new sketch on this plane", as the two commands it is. Typed,
 * like every item here, so the log teaches what it did and both halves can be
 * retyped on their own: `setDefaultFrame` is the edit (journalled, one undo
 * step), `lookAt` only moves the camera. In a 2D model there is nothing to
 * turn the view toward, and the item is only the first half.
 */
function sketchOnItem(model: Model, frame: string): MenuItem {
  const name = quoted(frame);
  const command = model.dim === 3 ? `setDefaultFrame(${name}); lookAt(${name})` : `setDefaultFrame(${name})`;
  return { label: "Sketch on this", action: { do: "run", command } };
}

/**
 * The natural dimension for a kind, holding it where it is — or null for a kind
 * that has none.
 *
 * A line gets its length, a circle or an arc its radius. **A point gets
 * nothing**, and that is the honest answer rather than a gap: a single point has
 * no measurement of its own, only measurements to other things, and there is no
 * second name to measure to. What a point wants is Fix, which is why the item
 * below it exists. A frame is likewise not a dimension: its arm's length is
 * drawn at a fixed pixel size and carries no meaning at all.
 */
export function dimensionCommand(model: Model, pick: Pick): string | null {
  if (pick.kind === "line") {
    const l = model.line(pick.name);
    const [a, b] = [model.coords(l.refs[0]), model.coords(l.refs[1])];
    const len = Math.hypot(...a.map((ai, i) => b[i] - ai));
    return `dist(${quoted(l.refs[0])}, ${quoted(l.refs[1])}, ${num(len)})`;
  }
  if (pick.kind === "circle" || pick.kind === "arc") {
    return `rad(${quoted(pick.name)}, ${num(model.radius(pick.name))})`;
  }
  return null;
}

/**
 * **Fix needs a frame, and the menu never quietly makes one.**
 *
 * There is no world frame here, so `fix` is a position *in a frame's
 * coordinates* and refuses to run without one. A menu item that created a frame
 * to make itself work would be the exact thing the no-world-frame decision
 * exists to prevent: a datum nobody chose, quietly becoming what every later
 * `par(l, xaxis())` is measured against. So the item is shown and disabled, carrying the
 * model's own standing message — read out of `resolveFrame` rather than copied,
 * so there is one wording of it in the codebase and the menu cannot drift from
 * what the command line says.
 *
 * Shown-and-disabled rather than omitted, because the absence of a frame is
 * exactly what a user needs told. An item that simply was not there would leave
 * "why can I not pin this point" unanswered.
 *
 * The coordinates are the point's position *in that frame* — its offset from the
 * origin along each unit axis — not its raw numbers. Raw numbers would be a
 * `fix` that yanks the point onto a tilted frame's coordinates the instant it is
 * added, which is not "hold it where it is" by any reading. That holds in 3D
 * exactly as in 2D, one axis more: there used to be a raw-coordinates branch
 * here for 3D, when `fix` up there was gauge-relative, and it went when 3D
 * frames closed that seam — a raw `[x, y, z]` would now be read in the default
 * frame and pull the point off to wherever those numbers land in it.
 */
function fixItem(model: Model, name: string): MenuItem {
  const at = frameCoords(model, name);
  if (typeof at === "string") return { label: "Fix", action: { do: "disabled", why: at } };
  return {
    label: "Fix",
    action: { do: "run", command: `fix(${quoted(name)}, [${at.map(num).join(", ")}])` },
  };
}

/**
 * Where a point sits in the default frame's coordinates, or the reason there is
 * no answer — the message the model itself gives, so the menu and the command
 * line say the same thing about a missing frame.
 */
function frameCoords(model: Model, name: string): number[] | string {
  let frame: string;
  try {
    frame = model.resolveFrame();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  const { origin, axes } = frameBasis(model, frame)();
  const rel = model.coords(name).map((v, i) => v - origin[i]);
  return axes.map((u) => rel.reduce((s, r, i) => s + r * u[i], 0));
}

/** What the menu needs of its host to be any use. */
export interface MenuHost {
  /** Types one line into the command machinery, as one user action. */
  run(command: string): void;
  /** Drops a quoted name into the command line, exactly as a left-click does. */
  insert(name: string): void;
  /**
   * Puts an unfinished command in the command line, ready to be completed and
   * submitted by hand. Separate from `insert` because it is not appending a
   * name to whatever is being composed — it is starting a different command,
   * and half a `dist(` in front of it would only be in the way.
   */
  type(text: string): void;
}

/** How close to the viewport's edge the menu may sit, in pixels. */
const EDGE_MARGIN = 4;

/**
 * What an item shows beside its label: the exact text it is about to put in the
 * command line. That is the feature and not decoration — an unfinished command
 * shows unfinished, so the item cannot look like it is going to do more than it
 * does.
 */
function hintFor(action: MenuAction): string {
  switch (action.do) {
    case "run": return action.command;
    case "type": return action.text;
    case "insert": return `"${action.name}"`;
    case "disabled": return "";
  }
}

/**
 * The menu on screen: a `<div>` over the canvas, in the hover tag's visual
 * family (see index.html, where its styling sits beside the tag's).
 *
 * DOM rather than canvas, for the reason the hover tag is: text, hit-testing,
 * hover states and keyboard focus are all free in the DOM and all have to be
 * built by hand on a canvas, and none of them is what this codebase is for.
 *
 * Every item shows the command it types beside its label. That is the feature
 * rather than decoration — the menu exists to be a shortcut *to the command
 * line*, and an item that hid what it was about to do would be a fourth way to
 * edit the drawing instead of a faster way to type.
 */
export class ContextMenu {
  private el: HTMLElement;
  private host: MenuHost;
  /** Installed while open, removed when closed. See `show`. */
  private outside: ((e: PointerEvent) => void) | null = null;

  constructor(el: HTMLElement, host: MenuHost) {
    this.el = el;
    this.host = host;
    // The canvas suppresses the browser's own menu; this element is a sibling of
    // it, so without this a right-click on the menu itself opens Chrome's.
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return !this.el.hidden;
  }

  /**
   * Shows `menu` at canvas-relative (sx, sy), flipped back inside the viewport
   * when it would hang off an edge — measured after the items are in the DOM,
   * because the width is the widest command in it and cannot be known before.
   */
  show(menu: Menu, sx: number, sy: number): void {
    this.el.textContent = "";
    if (menu.header) {
      const head = document.createElement("div");
      head.className = "head";
      head.textContent = menu.header;
      this.el.appendChild(head);
    }
    for (const item of menu.items) this.el.appendChild(this.itemEl(item));
    this.el.hidden = false;

    const wrap = this.el.parentElement!.getBoundingClientRect();
    const [w, h] = [this.el.offsetWidth, this.el.offsetHeight];
    const x = sx + w > wrap.width - EDGE_MARGIN ? Math.max(EDGE_MARGIN, sx - w) : sx;
    const y = sy + h > wrap.height - EDGE_MARGIN ? Math.max(EDGE_MARGIN, sy - h) : sy;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;

    // A press anywhere else closes the menu — and a *left* press is swallowed as
    // well, so the click that dismissed a menu does not also pick, drag or box
    // on the canvas underneath it. On window in the capture phase, which is the
    // only place that can take the event before the canvas sees it.
    //
    // The other buttons are deliberately let through: a right-click elsewhere
    // should close this menu and open the next one, which it does by falling
    // through to the engine exactly as if no menu had been open.
    this.outside = (e: PointerEvent) => {
      if (this.el.contains(e.target as Node)) return;
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
    this.el.textContent = "";
    if (this.outside) window.removeEventListener("pointerdown", this.outside, true);
    this.outside = null;
    return true;
  }

  private itemEl(item: MenuItem): HTMLElement {
    const row = document.createElement("div");
    const label = document.createElement("span");
    label.textContent = item.label;
    row.appendChild(label);

    if (item.action.do === "disabled") {
      row.className = "item off";
      // The reason sits under the item rather than in a `title` tooltip: a
      // tooltip needs a hover and a wait to find, and this one is the answer to
      // the question the greyed-out item has just raised.
      const why = document.createElement("div");
      why.className = "why";
      why.textContent = item.action.why;
      const wrap = document.createElement("div");
      wrap.appendChild(row);
      wrap.appendChild(why);
      return wrap;
    }

    row.className = "item";
    const hint = document.createElement("span");
    hint.className = "cmd";
    hint.textContent = hintFor(item.action);
    row.appendChild(hint);
    const action = item.action;
    // Closed before the command runs, so the log line the action writes is not
    // hidden behind the menu that asked for it.
    row.addEventListener("click", () => {
      this.close();
      if (action.do === "run") this.host.run(action.command);
      else if (action.do === "type") this.host.type(action.text);
      else if (action.do === "insert") this.host.insert(action.name);
    });
    return row;
  }
}
