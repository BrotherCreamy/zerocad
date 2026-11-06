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

import { addEllipse, checkEllipse, ellipseOf, semiAxes } from "./kinds/ellipse.ts";
import { ORIGIN, SETTABLE_PROPERTY, valueArgIndex, type Model } from "./model.ts";
import { describePick, type Pick } from "./picking.ts";
import { frameBasis } from "./relations/refs.ts";
import { toolUnavailable } from "./toolavail.ts";
import { sketchOnFaceCommand } from "./sketchface.ts";
import { toolGroup, toolbarButtons, type RegionHit } from "./tools/tool.ts";
import { findLoops, type Loop } from "./loops.ts";
import { featureRegion, holeIndex, holeLoop, type FeatureRegion } from "./operations.ts";
import { VIEW_MODES, type ViewMode } from "./viewmode.ts";
import { constraintsFor, roundValue } from "./dimensioning.ts";
import { activeWorkbench, menuToolItems, onWorkbench } from "./modules.ts";
import "./modules/builtin.ts";

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
 * the one case this exists for. `heading` does nothing: it names the toolbar
 * group the tool items under it share a button in (docs/plans/toolbar-groups.md).
 */
export type MenuAction =
  | { do: "run"; command: string }
  | { do: "insert"; name: string }
  | { do: "type"; text: string }
  | { do: "disabled"; why: string }
  | { do: "choose"; choices: MenuChoice[] }
  | { do: "heading" };

/**
 * One of a row of choices — the View row's three modes. Each types its own
 * command, like any item; `current` marks the one in force, so the row says
 * what the view is as well as how to change it.
 */
export interface MenuChoice {
  label: string;
  command: string;
  current: boolean;
}

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
  // The dimension tool's rounding, read from the one place both say it
  // (dimensioning.ts), so a menu-typed and a tool-typed dimension agree.
  return String(roundValue(v));
}

function quoted(name: string): string {
  return JSON.stringify(name);
}

/**
 * The menu for whatever a right-click landed on: an entity, a constraint glyph
 * (`pick.kind === "relation"`), or empty canvas (`pick === null`) — and, on
 * empty canvas, the closed region the click is inside, if any (the engine's
 * `regionAt`, asked by the host), which is what offers "Sketch on this face".
 * `history`, when given, adds Undo and Redo at the bottom (see `historyItems`);
 * left out, the menu is only about the pick, which is what most tests ask.
 * `viewMode`, when given, adds the View row to the empty-canvas menu (see
 * `viewItem`) — the host's to say, like the history, since how solids are
 * shown is the viewer's and not the model's. `selection` is the canvas's
 * selection (the engine's, UI state the model never hears of), which the menu
 * acts on when the right-click landed on part of it or on empty canvas — see
 * `selectionItems`.
 *
 * Pure, and deliberately so — it reads the model and returns strings. Nothing
 * here runs a command, touches the DOM or knows a menu can be on screen.
 */
export function menuFor(
  model: Model,
  pick: Pick | null,
  region: RegionHit | null = null,
  history: History | null = null,
  viewMode: ViewMode | null = null,
  selection: readonly string[] = [],
): Menu {
  const menu = menuOf(model, pick, region, selection);
  if (!pick && viewMode) menu.items.push(viewItem(viewMode));
  if (history) menu.items.push(...historyItems(history));
  return menu;
}

/** How many selected names a menu's header spells out before it counts the rest. */
const SELECTION_HEAD = 6;

/**
 * **The selection's items** — Group, Delete, Hide — each typing its command
 * over every selected name: `group("l1", "l2")`, `del(…)`, `hide(…)` — then
 * Construction / Not construction over its curves. On the menu when the right-click landed on something selected, or on empty canvas
 * with anything selected; never for a right-click on something *not*
 * selected, which is about that thing alone, as it always was.
 */
function selectionItems(model: Model, selection: readonly string[]): MenuItem[] {
  const args = selection.map(quoted).join(", ");
  return [
    { label: "Group", action: { do: "run", command: `group(${args})` } },
    { label: "Delete", action: { do: "run", command: `del(${args})` } },
    { label: "Hide", action: { do: "run", command: `hide(${args})` } },
    ...constructionItems(model, selection),
  ];
}

/**
 * **The relations a selection takes**, under a Constrain heading — the very
 * list the constrain tool shows (dimensioning.ts's `constraintsFor`), each
 * item typing its relation over the selection: `par("l1", "l2")`. Only for a
 * selection of two or more: one thing right-clicked has its own menu, with
 * its Dimension and Fix.
 */
function constrainItems(model: Model, selection: readonly string[]): MenuItem[] {
  const found = constraintsFor(model, selection);
  if (!found.length) return [];
  return [
    { label: "Constrain", action: { do: "heading" } },
    ...found.map((a): MenuItem => ({ label: a.label, action: { do: "run", command: a.text } })),
  ];
}

/**
 * **Construction** and **Not construction** over the lines, arcs and circles
 * among `names` — whichever would change something, both for a mix. Typed
 * over the curves only, so the log line names what it flags and not the
 * corners a box caught with them (which `construction` would pass over).
 */
function constructionItems(model: Model, names: readonly string[]): MenuItem[] {
  const curves = names.filter((n) => {
    const k = model.entities.get(n)?.kind;
    return k === "line" || k === "arc" || k === "circle" || k === "ellipse";
  });
  if (!curves.length) return [];
  const args = curves.map(quoted).join(", ");
  const items: MenuItem[] = [];
  if (curves.some((n) => !model.isConstruction(n))) {
    items.push({ label: "Construction", action: { do: "run", command: `construction(${args})` } });
  }
  if (curves.some((n) => model.isConstruction(n))) {
    items.push({ label: "Not construction", action: { do: "run", command: `construction(${args}, false)` } });
  }
  return items;
}

/**
 * **Select g1**, for each group the thing right-clicked is in — and each
 * feature that made it, a feature being a read-only group: the way from one
 * member to the whole set, typed as `select("g1")`.
 */
function selectGroupItems(model: Model, name: string): MenuItem[] {
  const sets = [
    ...model.groupsHolding(name).map((g) => g.name),
    ...[...model.features.values()].filter((f) => f.owns.includes(name)).map((f) => f.name),
  ];
  return sets.map((s) => ({ label: `Select ${s}`, action: { do: "run", command: `select(${quoted(s)})` } }));
}

/** The selection named for a menu's header: every name, or the first few and a count. */
function selectionHeader(selection: readonly string[]): string {
  const shown = selection.slice(0, SELECTION_HEAD);
  const more = selection.length - shown.length;
  return `${selection.length} selected  ${shown.join(" ")}${more ? ` +${more}` : ""}`;
}

/**
 * **View: Shaded · Hidden · Wire**, on empty canvas — the three ways of
 * showing solids (viewmode.ts) as one row, the one in force marked, each a
 * shortcut to the `view()` it types. On empty canvas only, beside the other
 * things that are about the drawing as a whole, because none of them is about
 * what a right-click on an entity landed on.
 */
function viewItem(current: ViewMode): MenuItem {
  return {
    label: "View",
    action: {
      do: "choose",
      choices: VIEW_MODES.map((m) => ({
        label: m[0].toUpperCase() + m.slice(1),
        command: `view(${quoted(m)})`,
        current: m === current,
      })),
    },
  };
}

function menuOf(model: Model, pick: Pick | null, region: RegionHit | null, selection: readonly string[]): Menu {
  const onSelection = selection.length > 0 && (pick === null || selection.includes(pick.name));
  if (!pick) {
    const menu = emptyCanvasMenu(model, region);
    if (!onSelection) return menu;
    const constrain = selection.length > 1 ? constrainItems(model, selection) : [];
    return { header: selectionHeader(selection), items: [...selectionItems(model, selection), ...constrain, ...menu.items] };
  }
  // Several selected, one of them right-clicked: the menu is about the set —
  // and about the sets the one clicked is in, the way to select one of those.
  if (onSelection && selection.length > 1) {
    return {
      header: selectionHeader(selection),
      items: [
        ...selectionItems(model, selection), ...constrainItems(model, selection),
        ...selectGroupItems(model, pick.name), ...editItems(model, selection),
      ],
    };
  }
  if (pick.kind === "edge") return edgeMenu(pick);
  const menu = pick.kind === "relation" ? relationMenu(model, pick) : entityMenu(model, pick);
  menu.items.push(...selectGroupItems(model, pick.name));
  // The one thing selected is the thing clicked: its own menu, whose Delete
  // is already the selection's, with the rest of the selection's items.
  if (onSelection) {
    const own = new Set(menu.items.map((i) => i.label));
    const extra = selectionItems(model, selection).filter((i) => !own.has(i.label));
    const at = menu.items.findIndex((i) => i.label === "Delete") + 1;
    menu.items.splice(at, 0, ...extra);
  }
  return menu;
}

/**
 * A kernel body's edge (docs/plans/solid-fillets.md): its hover line as the
 * header, and Fillet… and Chamfer…, each putting the call in the command line
 * up to its size, to finish as Set value… does — the menu only ever types.
 */
function edgeMenu(pick: Pick): Menu {
  const head = `${quoted(pick.body ?? "e1")}, [${quoted(pick.name)}], `;
  return {
    header: pick.tag ?? pick.name,
    items: [
      { label: "Fillet…", action: { do: "type", text: `fillet(${head}` } },
      { label: "Chamfer…", action: { do: "type", text: `chamfer(${head}` } },
    ],
  };
}

function relationMenu(model: Model, pick: Pick): Menu {
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

/**
 * Which way the undo history can move — the host's to say, since the stack
 * lives in main.ts and the model knows nothing of it. Passed in rather than
 * read, so `menuFor` stays a pure function of what it is handed.
 */
export interface History {
  canUndo: boolean;
  canRedo: boolean;
}

/**
 * **Undo and Redo, at the bottom of every menu** — the mouse's way to the one
 * thing that is otherwise only a chord or a typed `undo()`. Typed, like every
 * item, so the log shows `undo()` and the step is the same one Ctrl+Z takes.
 *
 * At the bottom because they are about the drawing as a whole, not about what
 * was right-clicked, and the items above them are. Shown disabled rather than
 * hidden when that side of the stack is empty, for Fix's reason: "why is there
 * no Undo here" is answered by the item saying there is nothing to undo — the
 * same words the chord writes in the log.
 */
function historyItems(history: History): MenuItem[] {
  const item = (label: string, can: boolean, command: string, why: string): MenuItem =>
    ({ label, action: can ? { do: "run", command } : { do: "disabled", why } });
  return [
    item("Undo", history.canUndo, "undo()", "nothing to undo"),
    item("Redo", history.canRedo, "redo()", "nothing to redo"),
  ];
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
 * **Frame is `frame()`**, always. It used to be `setDefaultFrame(frame())` for
 * a drawing's first frame, because with no world frame `fix`, `xaxis()` and
 * `yaxis()` did nothing at all until one was set. Every document now has the
 * origin, which they mean when no default is set (docs/plans/
 * frameless-curves.md), so a frame made from the menu is a datum the user
 * asked for and nothing more; making it the default is their next choice
 * (Sketch on this, on the frame).
 *
 * A tool that cannot run here would be **shown and disabled, not hidden**, for
 * Fix's reason: an item that simply vanished would leave "where did it go"
 * unanswered. Which tools those are is `toolUnavailable`'s to say, not this
 * menu's — and today it names none: the curve tools that used to be greyed
 * here without a default frame now make their plane at the click. (The
 * toolbar used to read the same rule; with nothing ever greyed it stopped
 * asking, docs/plans/tool-options.md.)
 */
/**
 * The menu's tool items: each loaded module's (modules.ts's `menuToolItems`, in
 * module order) that the current workbench's tray has, and where one of them
 * is in a toolbar group that has more than one member, **the whole group under
 * its name** (docs/plans/toolbar-groups.md) — every member as an item, in the
 * button's order, so a tool that joins the shapes group is on the menu without
 * this file knowing it exists. A group of one is its one item, as before
 * groups. A unit test checks every item resolves to a registered tool.
 */
function toolItems(model: Model): MenuItem[] {
  const item = (label: string, tool: string): MenuItem => {
    const why = toolUnavailable(model, tool);
    return { label, action: why !== null ? { do: "disabled", why } : { do: "run", command: `arm(${quoted(tool)})` } };
  };
  const bench = activeWorkbench();
  const items = menuToolItems().filter((i) => onWorkbench(bench, i.tool));
  const labelOf = (tool: string) => items.find((i) => i.tool === tool)?.label ?? (tool ? tool[0].toUpperCase() + tool.slice(1) : tool);
  const buttons = toolbarButtons((t) => onWorkbench(bench, t));
  const out: MenuItem[] = [];
  const done = new Set<string>();
  for (const { label, tool } of items) {
    const group = toolGroup(tool);
    const members = group ? buttons.find((b) => b.group === group)?.tools ?? [tool] : [tool];
    if (!group || members.length < 2) {
      out.push(item(label, tool));
      continue;
    }
    if (done.has(group)) continue;
    done.add(group);
    out.push({ label: group[0].toUpperCase() + group.slice(1), action: { do: "heading" } });
    for (const t of members) out.push(item(labelOf(t), t));
  }
  return out;
}

function emptyCanvasMenu(model: Model, region: RegionHit | null): Menu {
  return {
    header: null,
    items: [
      ...toolItems(model),
      {
        label: "Frame",
        action: { do: "run", command: "frame()" },
      },
      ...sketchOnFaceItem(model, region),
      ...faceEditItems(model, region),
      // Only while something is hidden: the way back from Hide, where there
      // is nothing on screen left to right-click.
      ...(model.hidden.size ? [{ label: "Show all", action: { do: "run", command: "show()" } } as MenuItem] : []),
    ],
  };
}

/**
 * **Sketch on this face**, when the right-click landed inside a closed region:
 * `workplane("a.b.c")` on three of its own points, facing the viewer — the very
 * line the sketch tool types for a click in the same place (see
 * ../sketchface.ts), so menu and tool cannot make different planes of one face.
 * The click is on empty canvas as far as picking goes — faces never pick — and
 * the region is what makes it more than that, as it is for the extrude tool.
 *
 * Only in a 3D model, where a sketch plane is a frame with a side to it; a 2D
 * drawing is one plane already. A face no plane can be made of — three points
 * on one line, a circle off its own frame — is shown disabled with the reason,
 * for Fix's reason: an item that vanished would leave "why not here" unanswered.
 */
function sketchOnFaceItem(model: Model, region: RegionHit | null): MenuItem[] {
  if (!region || model.dim !== 3) return [];
  const label = "Sketch on this face";
  try {
    return [{ label, action: { do: "run", command: sketchOnFaceCommand(model, region.loops[region.index], region.toward) } }];
  } catch (err) {
    return [{ label, action: { do: "disabled", why: err instanceof Error ? err.message : String(err) } }];
  }
}

function entityMenu(model: Model, pick: Pick): Menu {
  const items: MenuItem[] = [
    { label: "Insert name", action: { do: "insert", name: pick.name } },
    // The origin is part of every model and cannot be deleted (`ORIGIN`), so
    // it is offered no Delete to be refused.
    ...(pick.name === ORIGIN ? [] : [{ label: "Delete", action: { do: "run", command: `del(${quoted(pick.name)})` } } as MenuItem]),
  ];
  const dim = dimensionCommand(model, pick);
  if (dim) items.push({ label: "Dimension", action: { do: "run", command: dim } });
  // An ellipse has two numbers, so two items: its semi-axes as they stand.
  if (pick.kind === "ellipse") {
    const { a, b } = semiAxes(model, pick.name);
    items.push({ label: "Dimension major", action: { do: "run", command: `major(${quoted(pick.name)}, ${num(a)})` } });
    items.push({ label: "Dimension minor", action: { do: "run", command: `minor(${quoted(pick.name)}, ${num(b)})` } });
  }
  if (pick.kind === "point") items.push(fixItem(model, pick.name));
  if (pick.kind === "frame") items.push(sketchOnItem(model, pick.name));
  items.push(...constructionItems(model, [pick.name]));
  items.push(...holeItems(model, pick.name), ...editItems(model, [pick.name]));
  return { header: describePick(model, pick), items };
}

/**
 * **Add as hole to e1** on a member of a closed loop that lies inside a
 * feature's outline and is not a hole of it yet — one item per such feature —
 * and **Remove hole from e1** on a member of one of its holes. The menu
 * proposes from containment, which is a suggestion the user clicks and never
 * an inclusion (docs/plans/explicit-regions.md): the item types `hole("e1",
 * "c1")`, and only that call adds anything. Asked of each feature with the
 * operation's own question (`holeLoop`, `holeIndex`), so the menu offers
 * exactly what the call would take.
 */
function holeItems(model: Model, name: string): MenuItem[] {
  const k = model.entities.get(name)?.kind;
  if ((k !== "line" && k !== "arc" && k !== "circle" && k !== "ellipse") || model.isConstruction(name) || !model.features.size) return [];
  let all: Loop[];
  try {
    all = findLoops(model);
  } catch {
    return [];
  }
  if (!all.some((l) => l.members.some((m) => m.name === name))) return [];
  const add: MenuItem[] = [];
  const remove: MenuItem[] = [];
  for (const f of model.features.values()) {
    let r: FeatureRegion;
    try {
      r = featureRegion(model, f, all);
    } catch {
      continue;
    }
    const call = `(${quoted(f.name)}, ${quoted(name)})`;
    try {
      holeLoop(model, f, name, r);
      add.push({ label: `Add as hole to ${f.name}`, action: { do: "run", command: `hole${call}` } });
      continue;
    } catch {
      // not a loop it could cut
    }
    try {
      const at = r.holes[holeIndex(model, f, name, r) - 1];
      if (at !== null && r.all[at].members.some((m) => m.name === name)) {
        remove.push({ label: `Remove hole from ${f.name}`, action: { do: "run", command: `unhole${call}` } });
      }
    } catch {
      // no hole of this one
    }
  }
  return [...add, ...remove];
}

/**
 * **Edit e1**, typing `edit("e1")` — the feature dialog opened on a feature
 * (tools/edit.ts) — on anything a feature made or stands on, and on a set of
 * names every one of which is that feature's (`select("e1")` selects what it
 * made). One item per feature.
 */
function editItems(model: Model, names: readonly string[]): MenuItem[] {
  if (!names.length) return [];
  return [...model.features.values()]
    .filter((f) => names.every((n) => f.names.includes(n)))
    .map((f) => ({ label: `Edit ${f.name}`, action: { do: "run", command: `edit(${quoted(f.name)})` } }));
}

/**
 * **Edit e1** on empty canvas inside a region that is a face of a feature —
 * every member of the loop is something the feature names: its lid, a wall,
 * its base — which is what right-clicking a solid's face lands on, since faces
 * never pick.
 */
function faceEditItems(model: Model, region: RegionHit | null): MenuItem[] {
  if (!region) return [];
  return editItems(model, [...new Set(region.loops[region.index].members.map((m) => m.name))]);
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
 * `fix` is a position *in a frame's coordinates*: the default frame's, else
 * the origin's, which every model that holds frames has (`ORIGIN`,
 * docs/plans/frameless-curves.md) — so in a 2D or 3D model there is always
 * one, and the item is a command. A menu item that created a frame to make
 * itself work would still be the thing to prevent: a datum nobody chose,
 * quietly becoming what every later `par(l, xaxis())` is measured against.
 * Where `resolveFrame` refuses (a model with no frames at all), the item is
 * shown and disabled with the model's own message, read out rather than
 * copied, so the menu cannot drift from what the command line says — shown
 * rather than omitted, so "why can I not pin this point" is answered.
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
    case "choose": return action.choices.find((c) => c.current)?.command ?? "";
    case "heading": return "";
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

    if (item.action.do === "heading") {
      // A toolbar group's name over its tools: words, not a thing to choose.
      row.className = "sub";
      return row;
    }

    if (item.action.do === "choose") {
      // A row of its own: the label, then each choice as a clickable word,
      // the current one marked. Hovering a choice shows the command it types
      // in the row's hint, as every other item shows its own.
      row.className = "row";
      const choices = document.createElement("span");
      choices.className = "choices";
      const hint = document.createElement("span");
      hint.className = "cmd";
      const current = item.action.choices.find((c) => c.current);
      hint.textContent = current?.command ?? "";
      for (const choice of item.action.choices) {
        const el = document.createElement("span");
        el.className = choice.current ? "choice on" : "choice";
        el.textContent = choice.label;
        el.dataset.command = choice.command;
        el.addEventListener("pointerenter", () => { hint.textContent = choice.command; });
        el.addEventListener("pointerleave", () => { hint.textContent = current?.command ?? ""; });
        el.addEventListener("click", () => {
          this.close();
          this.host.run(choice.command);
        });
        choices.appendChild(el);
      }
      row.appendChild(choices);
      row.appendChild(hint);
      return row;
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
