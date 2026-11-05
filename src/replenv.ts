// What a REPL entry can actually see, assembled in one place. This is the
// app's public command surface: the model, the relation vocabulary, the tool
// registry, and a handful of conveniences. Splitting it out from repl.ts
// (which knows only how to scope and evaluate) means the same command
// surface can be exercised in tests with no browser, and means "what can I
// type?" has exactly one answer to read.
//
// Relations are bound under the short names the sketch vocabulary uses —
// `par`, `perp`, `tan` — with the long names alongside, so both
// `perp(l1, l2)` and `perpendicular(l1, l2)` work. Each takes the model
// implicitly, since a REPL entry always has one in hand.

import { addEllipse, checkEllipse, ellipseOf, semiAxes } from "./kinds/ellipse.ts";
import { Dual } from "./kernel/dual.ts";
import { Model, spanOf, unitOf, type Entity, type ProfileMember } from "./model.ts";
import * as shapes from "./tools/shapes.ts";
import { describeFeature, describeRelation } from "./picking.ts";
import type { SolveReport } from "./kernel/problem.ts";
import { ENGINE_TOOLS, TOOL_GROUPS, Tool, defineTool, getToolCtor, listTools, aliasCommand, armedLine, TOOL_ALIASES, toolAlias, toolSummary, toolbarButtons, type ToolCtor } from "./tools/tool.ts";
import { OptionMemory, declaredOptions, defaultsOf, describeValues, resolveOptions } from "./tools/options.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";
import { measure } from "./relations/measure.ts";
import {
  add, construction, del, extrude, fillet, hole, intersect, loopOfMember, orientingPlane, peelOptions, regen, region,
  regionText, revolve, set, subtract, unhole,
} from "./operations.ts";
import { planeAxes } from "./curveplane.ts";
import { save as saveModel, savedTools } from "./persist.ts";
import { fileNameFor } from "./files.ts";
import { STEP_TYPE, stepExport, stepFileName, type KernelSolid } from "./step.ts";
import { carryIntoSession, toolSources, type ToolSourceStore } from "./toolsource.ts";
import { alignView, assignView, orbitBy, panBy, screenToWorld, viewAxes, zoomAbout, type View } from "./view.ts";
import { pointOnWorkingPlane } from "./workplane.ts";
import { frameBasis } from "./relations/refs.ts";
import { describeLoop, findLoops, type Loop } from "./loops.ts";
import { _, checkClauses, checkOrdinary, slots, splitClauses, subjectable, type Clause, type Slot } from "./clauses.ts";
import {
  addTo, closegroup, group as groupOp, groupsOf, hide, members, opengroup, removeFrom, rename, show, ungroup,
} from "./groups.ts";
import {
  activeWorkbench, defineModule, defineWorkbench, describeModule, extendModule, fileLoading, getModule, listWorkbenches,
  loadedModules, moduleCommands, moduleHelp, moduleRelations, setActiveWorkbench, type EntityDecl, type ModuleKit, type ModuleSpec,
} from "./modules.ts";
import { lifted } from "./modules/core.ts";
// The app's vocabulary — every built-in module, loaded once — so a scope built
// anywhere, a test's included, has it (modules/builtin.ts).
import "./modules/builtin.ts";

type Bag = Record<string, unknown>;
type PlaneCall = (origin?: string | null, xref?: string | null, yref?: string | null,
  options?: { look?: boolean } | null) => string;

export interface EnvHandles {
  model: Model;
  /**
   * Arms a registered tool by name, optionally with arm-time options — and,
   * for a tool that works on one thing (the edit dialog, on a feature), what
   * that thing is: not an option, since options are numbers and flags a viewer
   * remembers, and a feature's name is neither.
   */
  arm?: (toolName: string, options?: Record<string, unknown>, target?: string) => void;
  /** The name of whatever the cursor is currently over, if anything. */
  pick?: () => string | null;
  /**
   * The canvas's selection: given nothing, the names selected; given names,
   * exactly those selected (already checked), and then the names. UI state the
   * model never hears of — not journalled, not in a file, not an undo step —
   * which is why it is a host handle, like the layout.
   */
  selection?: (names?: readonly string[]) => string[];
  /** Turns cursor snapping on or off; reports the current state when given nothing. */
  snapping?: (on?: boolean) => boolean;
  /**
   * Turns the constraint glyphs on or off; reports the current state when given
   * nothing. Off empties the layer *and* stops glyphs being pickable, because a
   * mark you cannot see but can still click would be a trap.
   */
  glyphs?: (on?: boolean) => boolean;
  /**
   * Whether free entities wear the free ink (docs/plans/sketch-relations.md):
   * on by default; off draws every entity in the sketch's own ink, the status
   * still counting what is free. A viewer's setting, never journalled.
   */
  freeink?: (on?: boolean) => boolean;
  /** Cancels whatever tool is armed. */
  cancel?: () => void;
  /** Re-solves and redraws. Absent outside the browser. */
  refresh?: () => void;
  /**
   * Replaces the whole model with one read from a saved file. Needs the host,
   * because everything pointed at the old model — the viewport, the tool
   * engine, the command scope — has to be pointed at the new one.
   */
  openModel?: (json: string) => void;
  /**
   * Steps the model back or forward through the host's undo history, reporting
   * what happened. Host-provided for the same reason `openModel` is: undoing
   * means replacing the whole model, which only the host can do — and the host
   * is also the only layer that knows what counted as one user action.
   */
  undo?: () => string;
  redo?: () => string;
  /** Hands the saved file to the user as a download. Browser only. */
  download?: (json: string, filename: string) => void;
  /**
   * The document's commands (docs/plans/files.md, src/filehost.ts): a fresh
   * document, a file asked for and opened, the document saved (in place, by
   * a picker, through the share sheet or as a download) and shared. Browser
   * only — the host owns the pickers, the sheet and which file the document
   * is. `openFile` returns at once; the file arrives in an event.
   */
  newFile?: () => string;
  openFile?: () => string;
  saveFile?: () => Promise<string>;
  shareFile?: () => Promise<string>;
  /**
   * Hands over a file that is not the document — `exportStep()`'s — the share
   * sheet under a finger, else a download (filehost.ts's `exportFile`).
   */
  exportFile?: (text: string, fileName: string, type: string) => Promise<string>;
  /**
   * The bodies the solid kernel built, exactly, for STEP (kernelbrep.ts) —
   * asked of its Worker, so a promise — or null when there are none, which
   * keeps an export with no kernel body exactly as synchronous as it was.
   */
  kernelSolids?: () => Promise<KernelSolid[]> | null;
  /**
   * The document's name and whether it has unsaved changes — what the app
   * menu shows, and what `download()` names its file for.
   */
  document?: () => { name: string; dirty: boolean };
  /**
   * The host's own solve path, if it has one. `solve()` prefers this over
   * calling model.solve() directly so that a solve typed at the command line
   * refreshes the viewport and status readout exactly as one triggered by a
   * tool does — otherwise the REPL can silently leave the UI showing a stale
   * verdict from the previous solve.
   */
  solve?: () => SolveReport;
  /**
   * The camera, so pan/zoom/orbit is an ordinary command like everything else.
   * Navigation changes the view and never the model, so none of it is
   * journalled — a saved drawing does not remember where it was looked at from.
   */
  view?: View;
  /**
   * The text of the entry being evaluated right now — `repl.entry`.
   *
   * This is the capture seam for tool sources, and it points *up* on purpose:
   * the REPL knows the entry text and nothing else does, this layer knows what
   * a tool is and the REPL must not. So the evaluator publishes the plain fact
   * and the host wires the two together, which is one line in `main.ts` and
   * one in a test. Absent means nothing is captured — which is exactly right
   * for a `defineTool` reached any way other than by someone typing it.
   */
  currentEntry?: () => string | null;
  /**
   * One line to the user, in the app's log pane — the same channel a tool
   * refusing a gesture speaks on (`ToolContext.log`). `open()` uses it to
   * mention the tools a file carries. Absent headless, where the return value
   * carries the same lines instead.
   */
  log?: (line: string) => void;
  /**
   * Where the session keeps the source of tools authored here. The module
   * singleton by default; a host (or a test) may hand over its own. Session
   * state, not model state — see toolsource.ts.
   */
  toolSources?: ToolSourceStore;
  /**
   * The viewport's size in CSS pixels. Kept apart from `view` because a
   * `View` is only a transform — it has no idea how big the window showing
   * it is — and the two together are what "the middle of what the user is
   * looking at" needs. A function rather than a value: the window can be
   * resized at any time, so a size read once at startup would drift.
   */
  viewSize?: () => [number, number];
  /**
   * The chrome's arrangement: given nothing, reports where each panel is;
   * given `"reset"`, puts them all back. Per-viewer UI state (see panels.ts),
   * which is why it is a host handle — the model never hears of it.
   */
  layout?: (command?: string) => string;
  /**
   * How solids are shown — `"shaded"`, `"hidden"` or `"wire"` (viewmode.ts):
   * given nothing, reports the mode; given one, switches to it and reports it;
   * given anything else, throws the guidance. Per-viewer UI state like the
   * layout, so a host handle the model never hears of.
   */
  viewMode?: (mode?: string) => string;
  /**
   * The interface size and which panes are shown — `ui({ scale: 0.8 })`,
   * `ui({ hide: "log" })`, `ui()` to report (docs/plans/chrome-logo-scale.md).
   * Per-viewer, per-device state like the layout: never journalled, so it has
   * no entry in persist.ts's replay table.
   */
  ui?: (options?: unknown) => string;
  /**
   * The viewer's last value of each tool option — the same memory the host's
   * tool engine arms from, so `tools()` lists what `arm` would use. Per-viewer
   * state, like the layout; a scope with none keeps its own for its lifetime.
   */
  optionMemory?: OptionMemory;
  /**
   * Switches the workbench (docs/plans/workbenches.md): the tray and the
   * menu follow, and the document remembers it in its head. The host's, since
   * the tray is; headless, `workbench(name)` sets the registry's own.
   */
  workbench?: (name: string) => string;
  /** A module or workbench was defined or removed: the tray and the menu are rebuilt. */
  modulesChanged?: () => void;
  /**
   * Hands the scope's names, a module's new relations and commands among
   * them, to the live evaluator (`Repl.define`) — which copied the scope when
   * it was made, so a name added after needs handing over.
   */
  rescope?: (names: Record<string, unknown>) => void;
  /**
   * Workbench files on this device (workbenchhost.ts): the picker and the
   * consent, a URL, Remove, Share. Browser only.
   */
  workbenchFiles?: {
    add(): string;
    load(url: string): Promise<string>;
    remove(name: string): Promise<string>;
    share(name: string): Promise<string>;
  };
}

// `describeRelation` and the short-name table it reads used to live here. They
// moved down to picking.ts when the hover tag started describing relations too
// — one table, so the canvas and the command line cannot end up calling the
// same relation two different things.

function describe(e: Entity, model: Model): string {
  switch (e.kind) {
    case "point": return `${e.name}  point  (${model.coords(e.name).map((v) => v.toFixed(3)).join(", ")})`;
    case "line": return `${e.name}  line   ${e.refs[0]}–${e.refs[1]}`;
    case "circle": return `${e.name}  circle  center ${e.center}, r=${model.radius(e.name).toFixed(3)}`
      + (e.normal === undefined ? "" : `, facing (${model.normalOf(e.name).map((v) => v.toFixed(3)).join(", ")})`);
    case "arc": return `${e.name}  arc    center ${e.center}, ${e.start}→${e.end}, r=${model.radius(e.name).toFixed(3)}`
      + (e.normal === undefined ? "" : `, facing (${model.normalOf(e.name).map((v) => v.toFixed(3)).join(", ")})`);
    case "ellipse": {
      const { a, b } = semiAxes(model, e.name);
      return `${e.name}  ellipse center ${e.center}, major end ${e.major}, a=${a.toFixed(3)}, b=${b.toFixed(3)}`
        + (e.normal === undefined ? "" : `, facing (${model.normalOf(e.name).map((v) => v.toFixed(3)).join(", ")})`);
    }
    case "frame": return `${e.name}  frame  origin ${e.origin}, +x toward ${e.xref}`
      + (e.yref === undefined ? "" : `, +y toward ${e.yref}`)
      + (model.defaultFrame === e.name ? "  (default)" : "");
  }
}

export function neocadScope(h: EnvHandles): Bag {
  const model = h.model;
  const sources = h.toolSources ?? toolSources;
  const memory = h.optionMemory ?? new OptionMemory(null);

  /**
   * The relation vocabulary, short name and long, each with where `_` may
   * stand (see clauses.ts) — every loaded module's, in module order
   * (modules.ts: core's `dist fix coin mid par perp ang on eq sym …`, the
   * sketch module's `rad oncircle conc eqrad tan arcends …`). A slot marked `#`
   * takes a number, so `_` there is refused when the clause is made. A module
   * cannot declare a relation without its slots, so a new relation cannot
   * arrive here unsaid. Re-read by `bindRelations` when a module loads later.
   */
  const relations: Bag = {};
  const bindRelations = () => {
    for (const { decl } of moduleRelations()) {
      const fn = (decl.typed ?? decl.fn) as (model: Model, ...args: never[]) => string;
      const bound = (...args: never[]) => fn(model, ...args);
      for (const name of decl.names) relations[name] = subjectable(name, decl.slots as Slot[], bound);
    }
  };
  bindRelations();

  /**
   * Applies clauses to an entity that exists, returning the relation names
   * they made — and the whole of what a constructor with clauses does once
   * it has made its entity. Nothing is special about creation.
   *
   * Each clause is applied by looking its name up in *this* surface's
   * vocabulary, never in the live scope: a user who assigns `on = 5` has
   * changed what they can type, not what a clause they made earlier means.
   */
  //
  // A relation refusing while it applies is the one failure the pre-check
  // leaves to the relation, and by then the entity (and any earlier clause) is
  // made. The refusal is passed on in the relation's own words, prefixed with
  // what already happened — so "c1 is not a point" arrives as "circ made c1,
  // but oncircle("c1", "p1") refused", and nobody is left guessing whether
  // there is now a c1 in the drawing. (At the command line the whole entry is
  // still one undo step; headless, this sentence is the only account.)
  function applyClauses(who: string, name: string, clauses: Clause[], made: boolean): string[] {
    const done: string[] = [];
    for (const c of clauses) {
      try {
        done.push((relations[c.op] as (...a: unknown[]) => string)(...c.filled(name)));
      } catch (e) {
        const what = made ? [name, ...done] : done;
        const before = what.length ? `made ${what.join(", ")}, but ` : "";
        throw new Error(`${who}${made ? " " : ": "}${before}${c.shownWith(name)} refused: `
          + `${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    return done;
  }

  /**
   * A constructor that also takes clauses, mixed with its own arguments by
   * type — a clause is never a number, a name or null, so `circ("p0",
   * rad(_, 4))` and `circ(rad(_, 4), "p0")` are the same call. Everything that
   * can be refused is refused before `make` runs, so a mistake in the third
   * clause leaves nothing behind; see `checkClauses` for the one deliberate
   * exception, a relation refusing while it applies.
   */
  function withClauses<F extends (...args: never[]) => string>(who: string, make: F,
    own?: (ordinary: unknown[]) => void) {
    return (...args: unknown[]): string => {
      const { ordinary, clauses } = splitClauses(args);
      checkOrdinary(model, who, ordinary);
      own?.(ordinary);
      checkClauses(model, who, clauses);
      const name = make(...(ordinary as Parameters<F>));
      applyClauses(who, name, clauses, true);
      return name;
    };
  }

  /**
   * Where a piece nobody placed should go: the middle of what is on screen.
   *
   * A free `circle()` materialising at the world origin is baffling — you
   * type it, nothing appears, and the drawing looks broken until you happen
   * to pan back. So the command layer decides the coordinate and passes it
   * down as an ordinary argument. The model stays where it was: it takes
   * coordinates, and has still never heard of a viewport.
   *
   * In a 3D model "the middle of the view" is a ray, so it is read where a
   * click there would land: on the working plane (see workplane.ts) — the
   * default frame's, so a free entity typed while sketching appears on the
   * sketch, or the plane facing the viewer through the orbit target.
   *
   * Undefined when there is nothing to ask (headless tests, a REPL with no
   * canvas) or when the model is neither 2D nor 3D, which no view can show.
   * Both cases fall back to the model's own plain defaults.
   */
  function viewSeed(): number[] | undefined {
    if (!h.view || !h.viewSize) return undefined;
    const [width, height] = h.viewSize();
    if (model.dim === 2) return screenToWorld(h.view, width / 2, height / 2);
    if (model.dim === 3) return pointOnWorkingPlane(model, h.view, width / 2, height / 2).world;
    return undefined;
  }

  /**
   * A free point at the view centre for a constructor to hang its auto-created
   * pieces off, or `null` to leave the model to seed its own.
   *
   * It is wanted in exactly the cases where the model would otherwise fall
   * back to the origin for lack of anything to derive a position from: a line
   * with neither endpoint, a circle or arc with no centre. Given *any*
   * reference the model already seeds beside it — a line's missing endpoint
   * lands 20 units from the one it was given — and dragging that to the middle
   * of the window instead would be worse, not better.
   *
   * Returning `null` rather than the model's own default coordinates is
   * deliberate: it keeps the headless journal exactly what the model layer
   * writes, one call with no expansion, while on screen the journal records
   * the coordinate actually used — so a drawing reopens where it was drawn
   * rather than wherever the window happens to be pointing next time.
   */
  function anchor(): string | null {
    const seed = viewSeed();
    return seed ? model.addPoint(seed).name : null;
  }

  /**
   * The screen's right and up in world terms, when there is a 3D view that has
   * been turned off the kernel's own axes — or null, when a frame seeded along
   * the kernel's x and y (the model's own seeding) is already facing the
   * viewer and nothing need be done differently. Null headless, too.
   */
  function turnedScreenAxes(): { right: number[]; up: number[] } | null {
    if (model.dim !== 3 || !h.view?.right || !h.view.up) return null;
    const { right, up } = h.view;
    const same = (a: number[], b: number[]) => a.every((v, i) => v === b[i]);
    return same(right, [1, 0, 0]) && same(up, [0, 1, 0]) ? null : { right, up };
  }

  /**
   * Puts a plane square to the screen — `lookAt`'s body, shared with `plane()`
   * and `workplane()`. Any plane reference: a frame (the origin included), a
   * curve's own plane, a face's three points. The drawing plane when none is
   * named. See `lookAt` below.
   */
  function lookAtFrame(frame?: string | null): string {
    if (!h.view) throw new Error("no viewport in this environment");
    const name = frame ?? model.drawingPlane();
    const axes = planeAxes(model, name);
    if (!axes) throw new Error(`"${name}" has collapsed — it has no plane to look at`);
    assignView(h.view, alignView(h.view, axes.u, axes.v, axes.origin));
    h.refresh?.();
    return `looking at ${name}`;
  }

  /**
   * The plane a typed `extrude` or `revolve` with no plane named runs along,
   * where there is a viewer to face: `orientingPlane` with the line of sight,
   * so a loop no frame orients comes out toward whoever typed it, as it does
   * from the tool. Null headless, where the operation asks the same question
   * with the loop's own normal.
   */
  function planeForFeature(member: string, op: "extrude" | "revolve"): string | null {
    // A region lies in its own plane already.
    if (model.dim !== 3 || !h.view || model.regions.has(member)) return null;
    return orientingPlane(model, loopOfMember(model, member, op), viewAxes(h.view).toward);
  }

  /**
   * A circle's or arc's typed plane: three numbers are its normal's seed, and
   * nothing more; a plane reference — a frame, a curve, `"p1.p2.p3"` — seeds the
   * normal from it **and holds it there** with `par`, since that is what
   * naming a plane asks for (it pins no centre: `onplane` does that, and is
   * the user's to add). Left out, the drawing plane seeds it and nothing holds
   * it — the free-entities rule: an argument is never a constraint, and none
   * was given.
   */
  function curveFacing(plane: unknown): { seed: number[] | null; hold: string | null } {
    if (plane == null || typeof plane !== "string") return { seed: (plane as number[] | null) ?? null, hold: null };
    if (model.dim !== 3) throw new Error(`a ${model.dim}D curve lies in the one plane a ${model.dim}D model has — it takes no plane`);
    const kind = model.planeKind(plane);
    const axes = planeAxes(model, plane);
    return { seed: axes?.n ?? null, hold: kind === "frame" ? `${plane}.z` : plane };
  }

  const geometry: Bag = {
    // Creation returns the entity's *name*, because that is what every
    // relation takes — `dist(pt(0,0), pt(3,4), 10)` reads straight through.
    //
    // Every argument is optional, because none of them was ever a constraint
    // — see model.ts. `circle()` is a legal way to say "a circle, which the
    // relations I am about to type will define".
    //
    // Each also takes clauses — `pt(on(_, "l1"), on(_, "l2"))` — after or
    // among its own arguments; see `withClauses` and clauses.ts.
    //
    // `pt` refuses anything but numbers among its own arguments, where it used
    // to hand them to the model as coordinates: a stray string is now most
    // likely a clause whose `_` was forgotten, and it deserves that answer
    // rather than a point with a name for a coordinate.
    pt: withClauses("pt", (...coords: number[]) =>
      model.addPoint(coords.length ? lifted(model, coords) : viewSeed()).name,
    (ordinary) => {
      const bad = ordinary.find((a) => typeof a !== "number");
      if (bad !== undefined) {
        throw new Error(`pt: ${JSON.stringify(bad) ?? String(bad)} is neither a number nor a clause — `
          + "pt takes a seed (numbers) and clauses");
      }
    }),
    ln: withClauses("ln", (a?: string | null, b?: string | null) =>
      model.addLine(a ?? (b == null ? anchor() : null), b ?? null).name),
    // In 3D a circle or arc carries its own normal: a seed from the drawing
    // plane when nothing is said, three numbers, or a plane named, which also
    // holds it there (`curveFacing`). Asked *before* the view-centre anchor is
    // made, so a refusal (a plane named in 2D) leaves no stray point behind.
    // Nothing makes a frame for it (docs/plans/frameless-curves.md).
    circ: withClauses("circ", (center?: string | null, r?: number | null, plane?: string | number[] | null) => {
      model.checkCircle(center, r);
      const { seed, hold } = curveFacing(plane);
      model.normalSeed("circle", seed);
      const name = model.addCircle(center ?? anchor(), r ?? null, seed).name;
      if (hold) geom.parallel(model, name, hold);
      return name;
    }),
    arc: withClauses("arc", (center?: string | null, start?: string | null, end?: string | null, r?: number | null,
          plane?: string | number[] | null) => {
      model.checkArc(center, start, end, r);
      const { seed, hold } = curveFacing(plane);
      model.normalSeed("arc", seed);
      const name = model.addArc(center ?? anchor(), start ?? null, end ?? null, r ?? null, seed).name;
      if (hold) geom.parallel(model, name, hold);
      return name;
    }),
  };
  /**
   * Coordinate frames, as ordinary commands.
   *
   * `frame()` seeds like every other free constructor: the origin lands in the
   * middle of what is on screen and the model puts the x-ref a span to its
   * right, so a frame you typed is a frame you can see. That matters more here
   * than for a circle — a frame is the thing `hor` and `ver` are measured
   * against, and one that materialised off-screen would leave the whole
   * vocabulary pointing at something invisible.
   *
   * An x-ref given without an origin is left alone, exactly as `ln` leaves a
   * line given one endpoint: the model seeds the missing point beside the one
   * it was handed, which is nearer what was meant than the middle of the
   * window is.
   *
   * The y-ref is 3D's, and a 2D model refuses it. It counts as "given" for the
   * anchoring rule too — and has to, or `frame(null, null, "p")` in a 2D model
   * would make the view-centre point, journal it, and *then* be refused, leaving
   * a stray point behind a call that failed.
   */
  geometry.frame = withClauses("frame", (origin?: string | null, xref?: string | null, yref?: string | null) => {
    if (xref == null && yref == null) {
      const axes = turnedScreenAxes();
      if (axes) {
        // A turned 3D view: the refs go along the screen's right and up, so a
        // frame typed while looking at the drawing from somewhere is a plane
        // *facing* the viewer — as it is, exactly, in a view nobody turned —
        // rather than one along the kernel's axes, which might be edge-on to
        // the screen. Made explicitly, so the journal says where they went.
        const o = origin ?? anchor() ?? model.addPoint().name;
        const at = model.coords(o);
        const x = model.addPoint(at.map((v, i) => v + Model.FREE_SPAN * axes.right[i])).name;
        const y = model.addPoint(at.map((v, i) => v + Model.FREE_SPAN * axes.up[i])).name;
        return model.addFrame(o, x, y).name;
      }
    }
    return model.addFrame(origin ?? (xref == null && yref == null ? anchor() : null), xref ?? null, yref ?? null).name;
  });
  /**
   * `plane(origin?, xref?, yref?)` — **"start sketching here"** in one call: a
   * frame (exactly `frame()`'s, seeded the same way), made the default, and,
   * where there is a view to turn, looked at square-on (`lookAt`). Sugar and
   * nothing more: it journals the two model calls it makes — the frame and
   * `setDefaultFrame` — and never the camera, which no saved drawing
   * remembers. Setting the default is the point of it: a plane you were not
   * then drawing on would be `frame()`.
   *
   * `{ look: false }` leaves the view where it is: what the extrude and revolve
   * tools type when they make the plane a frameless sketch needs, because the
   * camera swinging square-on at the moment of the click would be a jolt in
   * the middle of making a solid. Checked before anything is made.
   */
  geometry.plane = (origin?: string | null, xref?: string | null, yref?: string | null,
                    options?: { look?: boolean } | null) => {
    if (options != null && (typeof options !== "object" || Array.isArray(options)
        || (options.look !== undefined && typeof options.look !== "boolean"))) {
      throw new Error(`plane's fourth argument is its options — { look: false } makes the plane without turning the view, `
        + `got ${JSON.stringify(options)}`);
    }
    const name = (geometry.frame as (o?: string | null, x?: string | null, y?: string | null) => string)(origin, xref, yref);
    model.setDefaultFrame(name);
    if (h.view && model.dim === 3 && options?.look !== false) lookAtFrame(name);
    return name;
  };
  geometry.setDefaultFrame = (name: string | null) => {
    model.setDefaultFrame(name ?? null);
    return model.defaultFrame ?? "no default frame";
  };
  geometry.defaultFrame = () => model.defaultFrame;
  /**
   * `workplane(plane)` — **"sketch on this"** without making anything: the
   * work plane set to any plane reference — a face's three points
   * (`"p1.p2.p3"`), a circle's own plane, a frame — so what is drawn next lies
   * on it, and looked at square-on where there is a view (`{ look: false }`
   * leaves the view alone). What the sketch tool and "Sketch on this face"
   * type: a reference to the face, journalled as document state like the
   * default frame, and **not a frame** (docs/plans/frameless-curves.md).
   * `workplane(null)` clears it, back to the default frame's plane or the
   * origin's; `workplane()` says which plane things are drawn on now.
   */
  geometry.workplane = (...args: unknown[]) => {
    if (args.length === 0) return model.dim === 3 ? model.drawingPlane() : `a ${model.dim}D model is one plane`;
    const [ref, options] = args as [string | null, { look?: boolean } | null | undefined];
    if (options != null && (typeof options !== "object" || Array.isArray(options)
        || (options.look !== undefined && typeof options.look !== "boolean"))) {
      throw new Error(`workplane's second argument is its options — { look: false } sets the plane without turning the view, `
        + `got ${JSON.stringify(options)}`);
    }
    model.setWorkPlane(ref ?? null);
    if (ref != null && h.view && options?.look !== false) lookAtFrame(ref);
    return model.drawingPlane();
  };

  /**
   * A frame's axis, as the string `par`, `perp` and `ang` take:
   * `par("l1", yaxis())` is what `ver("l1")` used to be.
   *
   * These exist so the frame can be left out, the way it could be left out of
   * `hor` — and they resolve it the same way, through `resolveFrame` **at call
   * time**, so a drawing with no default gets the one standing message about
   * what to do instead of a reference to a frame called `null`. The answer is
   * baked into the string the relation then journals, which is why a saved
   * entry cannot change meaning when the default moves afterwards.
   *
   * A helper rather than new syntax in the evaluator: the owner's sketch was
   * `parallel(l1, *defaultframe.Y)`, and `par("l1", yaxis())` is as close as
   * that gets without the REPL learning a new kind of expression.
   *
   * `zaxis()` is the frame's normal, and exists only in a 3D model; in 2D it
   * refuses on the spot rather than handing back a `"f1.z"` that the next
   * relation would refuse instead. All three go through `model.axisRef`, so the
   * axis is checked and the frame resolved in the same order everywhere.
   */
  geometry.xaxis = (frame?: string | null) => model.axisRef("x", frame);
  geometry.yaxis = (frame?: string | null) => model.axisRef("y", frame);
  geometry.zaxis = (frame?: string | null) => model.axisRef("z", frame);
  /**
   * Degrees as radians — `ang("l1", "l2", deg(30))`. `ang` stores radians and
   * its label reads degrees; this is how the dimension tool types what it
   * measured in the unit the label shows (dimensioning.ts).
   */
  geometry.deg = (degrees: number) => {
    if (typeof degrees !== "number" || !Number.isFinite(degrees)) {
      throw new Error(`deg takes a number of degrees, got ${JSON.stringify(degrees)}`);
    }
    return (degrees * Math.PI) / 180;
  };

  // Long names beside the short ones, the way every relation already has both.
  // The owner's examples are written `circle()`, and a creator function shares
  // a name with a tool without trouble: a bare word arms the tool, a call is
  // an expression — `arc` and `fillet` have both been doing this all along.
  geometry.point = geometry.pt;
  geometry.line = geometry.ln;
  geometry.circle = geometry.circ;

  // Operations change the model's structure rather than only adding
  // equations — see operations.ts for why that is worth keeping separate.
  // What a regeneration noticed on the way — a recorded hole whose loop has
  // gone, filled — said in the log after the call returns its feature, so a
  // script reading the return value gets the name it always got.
  const said = (call: (notes: string[]) => string): string => {
    const notes: string[] = [];
    const out = call(notes);
    for (const n of notes) h.log?.(n);
    return out;
  };
  /**
   * A feature made on a bare face makes its region on the way — `extrude("l1",
   * 10)` makes `rg1` — and the log names it, so the region the next edit is
   * typed against is on screen.
   */
  const namingRegion = (call: () => string): string => {
    const had = new Set(model.regions.keys());
    const out = call();
    for (const r of model.regions.keys()) if (!had.has(r)) h.log?.(`${regionText(model, r)}  (made for ${out})`);
    return out;
  };
  /** `planeForFeature`'s question for a region: the plane facing the viewer, where only that settles it. */
  const planeForRegion = (member: string): string | null => {
    if (model.dim !== 3 || !h.view) return null;
    try {
      return orientingPlane(model, loopOfMember(model, member, "extrude"), viewAxes(h.view).toward);
    } catch {
      return null; // region() says why, in its own words
    }
  };
  const operations: Bag = {
    /**
     * Rounds the corner two lines meet at, and regenerates every feature
     * standing on either line, so an extruded corner rounds the lid as well as
     * the sketch. `regenerated` is what the journal carries — the features it
     * regenerated, profiles resolved — and never needs typing. See
     * operations.ts.
     */
    //
    // No frame is made for the arc: it carries its own normal and its two
    // tangents hold it in the corner (docs/plans/frameless-curves.md). `side`
    // is the journal's — an old file's frame, translated — and never needs typing.
    fillet: (l1: string, l2: string, r: number, side?: number[] | null, regenerated?: unknown) =>
      fillet(model, l1, l2, r, side ?? null, regenerated),
    /**
     * Brings a feature back into step with its profile as it is now —
     * `regen("e1")` — keeping every twin and wall whose vertex or member is
     * still there, and returns its name. For a profile restructured by hand;
     * `fillet` does it by itself. It adds no hole; a recorded hole whose loop
     * has gone is filled, and the log says so. See operations.ts.
     */
    regen: (feature: string, regenerated?: unknown) => said((notes) => regen(model, feature, regenerated, notes)),
    /**
     * Cuts the loop a member is in through a feature — `hole("e1", "c1")` —
     * or fills one of its holes — `unhole("e1", "c1")`. A region is its
     * outline and the holes you confirmed; nothing joins it by being drawn
     * inside. `regenerated` is the journal's, and never needs typing.
     */
    hole: (feature: string, member: string, regenerated?: unknown) =>
      said((notes) => hole(model, feature, member, regenerated, notes)),
    unhole: (feature: string, member: string, regenerated?: unknown) =>
      said((notes) => unhole(model, feature, member, regenerated, notes)),
    /**
     * Regions as operations (docs/plans/regions-as-operations.md): a face is a
     * closed loop, found; a region is faces combined by named operations —
     * `region("l1")` makes `rg1` of the face `l1` bounds, everything inside it
     * included; `subtract("rg1", "c1")`, `add("rg1", "c3")` and
     * `intersect("rg1", "l9")` change it, each one undo step, and regenerate
     * every feature on it. `frame`, `face` and `regenerated` are the
     * journal's, and never need typing.
     */
    region: (member: string, frame?: string | null, face?: unknown) =>
      said((notes) => { const r = region(model, member, frame ?? planeForRegion(member), face); notes.push(regionText(model, r)); return r; }),
    subtract: (r: string, member: string, face?: unknown, regenerated?: unknown) =>
      said((notes) => { subtract(model, r, member, face, regenerated, notes); notes.unshift(regionText(model, r)); return r; }),
    add: (r: string, member: string, face?: unknown, regenerated?: unknown) =>
      said((notes) => { add(model, r, member, face, regenerated, notes); notes.unshift(regionText(model, r)); return r; }),
    intersect: (r: string, member: string, face?: unknown, regenerated?: unknown) =>
      said((notes) => { intersect(model, r, member, face, regenerated, notes); notes.unshift(regionText(model, r)); return r; }),
    /**
     * Extrudes the closed loop a member is in — `extrude("l1", 20)` — and
     * returns the feature's name. `frame` picks the loop when the member is in
     * several (it is, once it is the edge of a wall too): the one parallel to
     * that frame's plane. `loops` is the profile as the journal carries it
     * resolved, and never needs typing. See operations.ts.
     *
     * `frame` is any plane (a frame, a curve, `"p1.p2.p3"`); a loop no frame
     * orients runs along its own plane — three of its points, facing you — and
     * **no frame is made for it** (`planeForFeature`, `orientingPlane`).
     *
     * Options come last, wherever that is: `extrude("c1", -10, { mode:
     * "cut" })` cuts a hole in the body the circle is on; `{ mode: "add",
     * into: "e1" }` names the body. Left out, the mode is add when the solid
     * touches or overlaps a body and new otherwise (docs/plans/solids-kernel.md).
     */
    extrude: (member: string, ...rest: unknown[]) => {
      const { args, options } = peelOptions(rest, "extrude", 3);
      const [depth, given, loops] = args as [number | null | undefined, string | null | undefined, ProfileMember[][] | null | undefined];
      const frame = given == null && loops == null ? planeForFeature(member, "extrude") : given;
      return namingRegion(() => extrude(model, member, depth ?? null, frame ?? null, loops ?? null, null, options));
    },
    /**
     * Revolves the closed loop a member is in about an axis — `revolve("l1",
     * "f1.y", Math.PI)`, or `yaxis()` for the default frame's — through an angle
     * in radians, a whole turn when left out, and returns the feature's name.
     * The axis is a frame's axis or a line, read and never moved. `frame` and
     * `loops` are extrude's, and so is the plane of a loop no frame orients.
     */
    revolve: (member: string, axis: string, ...rest: unknown[]) => {
      const { args, options } = peelOptions(rest, "revolve", 3);
      const [angle, given, loops] = args as [number | null | undefined, string | null | undefined, ProfileMember[][] | null | undefined];
      const frame = given == null && loops == null ? planeForFeature(member, "revolve") : given;
      return namingRegion(() => revolve(model, member, axis, angle ?? null, frame ?? null, loops ?? null, null, null, options));
    },
    /**
     * Changes a dimension's value — `set("d4.value", 60)` — rebuilding it in
     * place under the same name. See operations.ts for why it is an operation
     * and what the unit is (radians for `ang`).
     *
     * It re-solves through the host for exactly `del`'s reason, and a sharper
     * version of it: the entire purpose of the call is to change where the
     * geometry ends up, so a header still reading the old verdict — or a
     * drawing still at the old size — would be the stale-readout bug wearing a
     * different hat.
     */
    set: (path: string, value: number) => {
      const name = set(model, path, value);
      h.solve?.();
      return name;
    },
    /**
     * Deletes entities and relations — one name or a box-select's worth —
     * cascading the way Onshape does, and hands back the names it took, so
     * "what did that just remove" has an answer in the log rather than only
     * on the canvas. The whole batch is one entry and therefore one undo.
     *
     * It re-solves through the host afterwards, unlike the other editing
     * commands, because deleting a constraint is exactly the edit whose point
     * is to change the solver's verdict: leaving `CONFLICT` on the header
     * after removing the constraint that caused it is the stale-readout bug
     * this project has already been bitten by once. Nothing moves — the
     * drawing was already satisfying more than it now has to — so the solve
     * costs a frame and buys an honest header.
     */
    del: (...names: string[]) => {
      const removed = del(model, ...names);
      h.solve?.(); // once, after the whole batch — one edit, one verdict
      return removed;
    },
  };

  // Save and open, as ordinary commands like everything else. `save()` hands
  // back the file's text rather than writing it anywhere, which is the
  // command-line-shaped thing to do: it composes. `download`/`openFile` are
  // the browser conveniences on top.
  /** STEP's last step, once any kernel body is in hand: the file, handed to the host, and what it held. */
  const exportWith = (title: string, opts: Record<string, unknown>, solids: KernelSolid[]): Promise<string> => {
    const out = stepExport(model, { name: title, curves: opts.curves === true }, solids);
    if (!h.exportFile) throw new Error("no download or share sheet in this environment");
    const bodies = out.bodies.map((b) => b.name);
    const said = [`${bodies.join(", ")} (${bodies.length} ${bodies.length === 1 ? "body" : "bodies"})`];
    if (out.curves > 0) said.push(`${out.curves} sketch curve${out.curves === 1 ? "" : "s"}`);
    if (out.skipped.length) said.push(`left out ${out.skipped.map((x) => `${x.feature} (${x.why})`).join(", ")}`);
    return h.exportFile(out.text, stepFileName(title), STEP_TYPE).then((how) => `${how}: ${said.join("; ")}`);
  };

  const persistence: Bag = {
    // The tools go in here and *only* here, not in `toSaved`'s default,
    // because the same function writes the undo stack's snapshots — see
    // persist.ts. A file the user asked for carries them; a snapshot does not,
    // so authoring a tool is not an edit to the drawing.
    save: () => saveModel(model, true, sources.all(), { workbench: activeWorkbench() }),
    /**
     * Opens a file, and **evaluates nothing**.
     *
     * If the file carries tool sources they are taken into the session as text
     * and mentioned, one line each. That is the whole of it: the source sits
     * in a Map until the user pastes it back, at which point it is an ordinary
     * entry that they read before pressing Enter. There is deliberately no
     * button, menu item or flag that runs it for them — the paste is the
     * consent, and a shortcut past it would make a file a script.
     */
    open: (json: string) => {
      if (!h.openModel) throw new Error("open needs a host that can swap the model");
      if (typeof json !== "string") throw new Error("open takes the text of a saved model");
      h.openModel(json); // first, so a file that will not open carries nothing
      const notices = carryIntoSession(savedTools(json), sources);
      for (const line of notices) h.log?.(line);
      // With a host the lines are already on screen and repeating them in the
      // return value would print each one twice. With no host — a headless
      // REPL, a test — the return value is the only channel there is.
      return h.log ? "opened" : ["opened", ...notices].join("\n");
    },
    // Named for the document when there is one, as saveFile() names its file.
    download: (filename = h.document ? fileNameFor(h.document().name) : "sketch.zerocad.json") => {
      if (!h.download) throw new Error("no download in this environment");
      h.download(saveModel(model, true, sources.all()), filename);
      return filename;
    },
    // The document's commands — what the app menu's File items and Ctrl+S /
    // Ctrl+O type. (The menu's name line reads the host's `document()`
    // directly; it is not a command here, where `document` would read as the
    // page's, which the command line deliberately cannot reach.) **None of them journals anything, so none is in
    // persist.ts's replay table**: they act on the document — which file it
    // is, whether it is saved, whose share sheet it goes to — and never in
    // it, so a file has nothing of theirs to replay (as it has nothing of
    // `download`'s). Opening and starting afresh replace the model through the
    // host, as `open` does, each one undo step there.
    newFile: () => {
      if (!h.newFile) throw new Error("no document in this environment");
      return h.newFile();
    },
    openFile: () => {
      if (!h.openFile) throw new Error("no file picker in this environment");
      return h.openFile();
    },
    saveFile: () => {
      if (!h.saveFile) throw new Error("no file to save to in this environment — save() gives the text");
      return h.saveFile();
    },
    shareFile: () => {
      if (!h.shareFile) throw new Error("no share sheet in this environment — save() gives the text");
      return h.shareFile();
    },
    // STEP (docs/plans/step-export.md, src/step.ts): the shown solids as a
    // file every other CAD tool opens — `exportStep()`, `exportStep("name")`,
    // `exportStep({ curves: true })`. Like saveFile it acts on nothing in the
    // drawing, so it journals nothing and is not in persist.ts's replay table.
    // The solids are asked for before the host is, so a drawing without one
    // hears "there is no solid" wherever it is typed.
    exportStep: (name?: unknown, options?: unknown) => {
      const o = typeof name === "object" && name !== null ? name : options ?? {};
      if (typeof o !== "object" || o === null || Array.isArray(o)) {
        throw new Error('exportStep takes a name and { curves: true } — exportStep("bracket", { curves: true })');
      }
      const opts = o as Record<string, unknown>;
      const extra = Object.keys(opts).filter((k) => k !== "curves" && k !== "name");
      if (extra.length) throw new Error(`exportStep takes { curves: true } and a name, not ${extra.join(", ")}`);
      if (name != null && typeof name !== "string" && typeof name !== "object") throw new Error("exportStep's name is a string");
      const title = typeof name === "string" ? name : typeof opts.name === "string" ? opts.name : h.document?.().name ?? "Untitled";
      const kernel = h.kernelSolids?.() ?? null;
      if (kernel) return kernel.then((solids) => exportWith(title, opts, solids));
      return exportWith(title, opts, []);
    },
    journal: () => model.journal.map((e) => `${e.op}(${e.args.map((a) => JSON.stringify(a)).join(", ")})`),

    // The same thing Ctrl+Z does, and not a parallel implementation of it: both
    // go through the host handle, so a difference between the keystroke and the
    // command is not something this codebase can express.
    undo: () => {
      if (!h.undo) throw new Error("no undo history in this environment");
      return h.undo();
    },
    redo: () => {
      if (!h.redo) throw new Error("no undo history in this environment");
      return h.redo();
    },
  };

  const commands: Bag = {
    model,
    Model,
    Dual,
    Tool,
    /**
     * `defineTool`, plus the one thing the registry must not know about: the
     * entry that called it is remembered, so a `save()` can carry the tool's
     * source as text.
     *
     * The wrapper is here rather than in `tools/tool.ts` because this is the
     * only door a user comes through. A built-in registers itself from its own
     * module at import time and never touches this function, so "built-ins are
     * never captured" needs no check anywhere — it is a property of where the
     * wrapper sits. Same for a `defineTool` called later from inside a tool's
     * own callback: there is no entry in flight, so nothing is recorded.
     *
     * Registration first, capture second: a source is only stored for a tool
     * that is actually registered.
     */
    defineTool: (name: string, ctor: ToolCtor) => {
      defineTool(name, ctor);
      const entry = h.currentEntry?.();
      // The *whole* entry, deliberately — an entry may build helpers around
      // its class, and slicing the class expression out would be a parser
      // project and a lie about what ran.
      if (entry) sources.capture(name, entry);
    },
    /**
     * The stored source of a tool, for reading and for pasting back. Text in,
     * text out; this is the only way a carried source ever leaves the store,
     * and it hands it to the log rather than to the evaluator.
     */
    toolSource: (name: string) => {
      const source = sources.get(name);
      if (source === undefined) {
        throw new Error(`no source stored for ${JSON.stringify(name)} — only a tool defined at this `
          + "command line, or carried by a file you opened, has one");
      }
      return source;
    },
    /**
     * The tools, active ones first. A source carried by a file but never
     * pasted is listed too and marked, because "the file has a gear tool and
     * you cannot arm it" is precisely the state the user needs told; leaving
     * it out of the listing would make the notice `open()` printed look like a
     * message about nothing.
     *
     * A tool that declares options is listed with them as `arm` would fill
     * them now — `extrude  { depth: 10 }` — and, where a remembered value
     * differs, the declared defaults after: the line says both what you will
     * get and what you would type to have the default back.
     *
     * Select and the Hand head it, as they head the toolbar: `arm` takes them
     * by those names, and a list of what `arm` takes that left them out would
     * be a second answer to what the tools are.
     */
    tools: () => {
      const active = listTools();
      // Each line ends with what the tool does — its `static summary`, the
      // words its tooltip shows — after a dash, so a line still starts with
      // what you would type (docs/plans/tooltips-rgb-frames.md).
      const said = (name: string, line: string) => {
        const summary = toolSummary(name);
        return summary ? `${line}  — ${summary}` : line;
      };
      return [
        ...ENGINE_TOOLS.map((name) => said(name, name)),
        ...active.map((name) => {
          const specs = declaredOptions(getToolCtor(name), name);
          if (Object.keys(specs).length === 0) return said(name, name);
          const now = resolveOptions(name, specs, {}, memory.recall(name));
          const declared = describeValues(specs, defaultsOf(specs));
          const shown = describeValues(specs, now);
          return said(name, shown === declared ? `${name}  ${shown}` : `${name}  ${shown}  (default ${declared})`);
        }),
        // The old names, said as what they arm now: a line each, after the tools,
        // so `circle3` is still findable and never mistaken for a tool of its own.
        ...Object.keys(TOOL_ALIASES).filter((name) => toolAlias(name))
          .map((name) => `${name}  — ${TOOL_ALIASES[name].says}: ${aliasCommand(name)}`),
        ...sources.names()
          .filter((name) => !active.includes(name))
          .map((name) => `${name} (source only — toolSource(${JSON.stringify(name)}) to see it)`),
      ];
    },

    solve: () => (h.solve ? h.solve() : model.solve()),
    // Entities, then features — `e1  extrude of …`, `e2  revolve of …` —
    // since a feature is a named thing `del` takes as surely as an entity, then
    // groups with their members. Whatever is hidden says so.
    //
    // **A feature's output is a count under its line**, not a line per twin:
    // a box is a profile of four lines and seventeen things the extrude made,
    // and listing those seventeen buried the four the user drew. They stay
    // named entities (the register: a relation on a lid corner holds *that*
    // point), so `members("e1")` lists them — the count is of exactly what it
    // lists, the depth dimension included.
    ls: () => {
      const mark = (name: string, line: string) => {
        const said = model.isConstruction(name) ? `${line}  (construction)` : line;
        return model.hidden.has(name) ? `${said}  (hidden)` : said;
      };
      const made = new Set<string>();
      for (const f of model.features.values()) for (const n of f.owns) made.add(n);
      return [
        ...[...model.entities.values()].filter((e) => !made.has(e.name)).map((e) => mark(e.name, describe(e, model))),
        ...[...model.features.values()].flatMap((f) => {
          const own = model.membersOf(f.name) ?? [];
          const hid = own.filter((n) => model.hidden.has(n)).length;
          const count = `    ${own.length} made${hid ? `, ${hid} hidden` : ""} — members(${JSON.stringify(f.name)}) lists them`;
          return [mark(f.name, describeFeature(model, f)), ...(own.length ? [count] : [])];
        }),
        ...[...model.groups.values()].map((g) => `${g.name}  group of ${g.members.length ? g.members.join(" ") : "nothing yet"}`
          + (model.openGroup === g.name ? "  (open — new geometry joins it)" : "")),
      ];
    },
    /**
     * The constraints, by name — all of them, or (given a name) just the ones
     * that mention it. This is the other half of what makes an inferred
     * constraint answerable for: the hover tag says *that* `p5` is
     * constrained, `rels("p5")` says by what.
     */
    rels: (name?: string) => {
      const all = name === undefined ? [...model.relations.values()] : model.relationsNaming(name);
      return all.map(describeRelation);
    },
    /**
     * The closed loops the drawing contains, one line each — `loop of
     * l1,l4,l3,l2 in f1, area 1200` — the profiles `extrude` takes.
     * A question, not an entity: it journals nothing and claims no name, so a
     * loop is spoken of by its members. See loops.ts for what joins two ends
     * (a shared point or a `coin`, never mere proximity).
     */
    loops: () => {
      const all = findLoops(model);
      return all.map((loop) => describeLoop(loop, all));
    },
    coords: (name: string) => model.coords(name),

    arm: (name: string, options?: Record<string, unknown>) => {
      if (!h.arm) throw new Error("no viewport in this environment");
      h.arm(name, options);
      return armedLine(name);
    },
    /**
     * Opens the feature dialog on a feature that exists — `edit("e1")`, what
     * the menu's *Edit e1* types: its region lit, its depth (or angle) in the
     * options panel, every loop inside its outline shown, a click on one
     * toggling it in or out of the holes. ✓ types `hole`/`unhole` and `set`
     * as one undo step; ✗ leaves it as it was. Not an edit itself, as `arm`
     * is not: it journals nothing.
     */
    edit: (feature: unknown) => {
      if (typeof feature !== "string" || !model.features.has(feature)) {
        throw new Error(`${JSON.stringify(feature) ?? String(feature)} is not a feature — edit takes a feature's name, as ls() lists them (e1, e2, …)`);
      }
      if (!h.arm) throw new Error("no viewport in this environment");
      const f = model.featureOf(feature);
      const value = model.relationOf(f.kind === "extrude" ? f.depth : f.angle).args[1] as number;
      h.arm(`edit ${f.kind}`, { [f.kind === "extrude" ? "depth" : "angle"]: value }, feature);
      return `editing ${feature}`;
    },
    cancel: () => { h.cancel?.(); return "cancelled"; },
    hover: () => h.pick?.() ?? null,
    /**
     * The canvas's selection — what a click, a shift-click or a box picked with
     * the command line empty. `sel()` lists it; `select("l1", "l2")` sets it
     * and `select()` clears it. Not an edit: never journalled, never in a file,
     * never an undo step. (Regions picked on the canvas are part of it too, and
     * are not names; `sel()` lists the names.)
     */
    sel: () => {
      if (!h.selection) throw new Error("no viewport in this environment");
      return h.selection();
    },
    select: (...names: unknown[]) => {
      if (!h.selection) throw new Error("no viewport in this environment");
      return h.selection(selectable(names));
    },
    snapping: (on?: boolean) => {
      if (!h.snapping) throw new Error("no viewport in this environment");
      return h.snapping(on);
    },
    /**
     * The constraint glyphs, on by default as they are in an Onshape sketch —
     * the feature exists so that constraints you did not type announce
     * themselves, which they cannot do from behind a switch you have to know to
     * flick. Per-relation or per-kind hiding is deliberately not v1.
     */
    glyphs: (on?: boolean) => {
      if (!h.glyphs) throw new Error("no viewport in this environment");
      return h.glyphs(on);
    },
    /** The free ink, on by default; `freeink(false)` draws everything in the sketch's ink. */
    freeink: (on?: boolean) => {
      if (!h.freeink) throw new Error("no viewport in this environment");
      return h.freeink(on);
    },
    refresh: () => { h.refresh?.(); return "ok"; },
    /**
     * Where the panels are — `layout()` — or all of them back where they
     * started — `layout("reset")`. Not an edit: nothing here reaches the model,
     * the journal or the undo history, because where a viewer keeps their log
     * is not a fact about the drawing.
     */
    layout: (command?: string) => {
      if (!h.layout) throw new Error("no viewport in this environment");
      return h.layout(command);
    },

    /**
     * How solids are shown: `view("shaded")`, the default, opaque — nothing
     * behind a face drawn or aimable; `view("hidden")`, see-through, what is
     * behind dimmed and everything pickable; `view("wire")`, no faces.
     * `view()` says which. The viewer's, like the camera: never journalled,
     * never in a file, never an undo step.
     */
    view: (mode?: string) => {
      if (!h.viewMode) throw new Error("no viewport in this environment");
      return h.viewMode(mode);
    },

    /**
     * The interface size — `ui({ scale: 0.8 })`, 60 % to 160 %, or
     * `ui({ scale: "default" })` for this device's — and the panes —
     * `ui({ hide: "log" })`, `ui({ show: ["log", "cmd"] })`. `ui()` says what
     * is in force. What the app menu's spin box and pane boxes type. The
     * viewer's, on this device: never journalled, never in a file, never an
     * undo step.
     */
    ui: (options?: unknown) => {
      if (!h.ui) throw new Error("no interface in this environment");
      return h.ui(options);
    },
    // Viewport control as an ordinary command, per the brief's goal of having
    // the whole interface drivable the same way a tool is authored. The camera
    // object itself is `camera` — it was `view` until `view()` became the
    // command that says how solids are shown, which is the name a user reaches
    // for and the one the owner's spec gives it.
    camera: h.view,
    // About where the world origin is drawn, as it always was — through the
    // camera's own zoom, so the orbit target stays on its pixel.
    zoom: (factor: number) => {
      if (!h.view) throw new Error("no viewport in this environment");
      assignView(h.view, zoomAbout(h.view, h.view.ox, h.view.oy, factor));
      h.refresh?.();
      return h.view.scale;
    },
    pan: (dx: number, dy: number) => {
      if (!h.view) throw new Error("no viewport in this environment");
      assignView(h.view, panBy(h.view, dx, dy));
      h.refresh?.();
      return [h.view.ox, h.view.oy];
    },
    /**
     * Turns the drawing about the orbit target — `yaw` radians about the
     * screen's vertical, `pitch` about its horizontal — exactly as a right-drag
     * does, and relative, like `pan` and `zoom`: the screen's axes have names a
     * user can see, where an absolute azimuth would be measured from the
     * kernel's axes, which nobody chose. Positive yaw carries the near side of
     * the drawing right; positive pitch carries it down.
     */
    orbit: (yaw: number, pitch = 0) => {
      if (!h.view) throw new Error("no viewport in this environment");
      if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) throw new Error("orbit takes two angles, in radians");
      assignView(h.view, orbitBy(h.view, yaw, pitch));
      h.refresh?.();
      return "orbited";
    },
    /**
     * Puts a frame's plane square to the screen, its +x to the right and +y up
     * — Onshape's "normal to sketch", the gesture for going back to drawing on
     * a plane after looking at it from somewhere else. The frame's origin keeps
     * its place on screen and becomes what the next orbit turns about. Any
     * plane — a frame, the origin, a curve's plane, a face's "p1.p2.p3" — and
     * the drawing plane (the work plane, the default frame, the origin) when
     * none is named.
     */
    lookAt: (frame?: string | null) => lookAtFrame(frame),
  };

  /**
   * `_`, the subject placeholder, and `constrain(name, ...clauses)`, the
   * primitive every constructor with clauses is built from: `pt(on(_, "l1"))`
   * is `constrain(pt(), on(_, "l1"))`, which is `p = pt(); on(p, "l1")`.
   * Checked in full before the first clause applies, like a constructor's.
   */
  const clauses: Bag = {
    _,
    constrain: (name: unknown, ...given: unknown[]): string[] => {
      if (name === _) throw new Error("constrain needs the name of an entity that exists — _ stands for one only inside a relation call");
      if (typeof name !== "string" || !model.entities.has(name)) {
        throw new Error(`constrain needs the name of an entity that exists, and there is no entity ${JSON.stringify(name) ?? String(name)}`);
      }
      checkClauses(model, "constrain", given);
      return applyClauses("constrain", name, given as Clause[], false);
    },
  };

  /**
   * The names `select` was given, checked before the selection changes — each
   * an entity, a relation, a group or a feature, the last two standing for
   * their members — with what is hidden left out, and said: a hidden entity
   * is not on screen to be selected.
   */
  function selectable(names: unknown[]): string[] {
    for (const n of names) {
      if (typeof n !== "string") throw new Error(`select takes names, and ${JSON.stringify(n) ?? String(n)} is not one`);
    }
    const all = model.expand(names as string[], "select");
    const hidden = all.filter((n) => model.hidden.has(n));
    if (hidden.length) h.log?.(`${hidden.join(" ")} ${hidden.length === 1 ? "is" : "are"} hidden, so not selected — show() first`);
    return all.filter((n) => !model.hidden.has(n));
  }

  /**
   * Groups, hide and show (groups.ts). A group or a feature named where a set
   * is wanted stands for its members as they are now, and the log says so — a
   * union, not a link — because a reader expecting a nested group would
   * otherwise find out only when the two drifted apart.
   */
  const flattenedNote = (given: unknown[]) => {
    const sets = given.filter((n): n is string => typeof n === "string" && model.membersOf(n) !== null);
    for (const s of sets) {
      h.log?.(`${s} added as its members now (${model.membersOf(s)!.length}) — a union, not a link: a group never holds a group`);
    }
  };
  const grouping: Bag = {
    group: (...args: unknown[]) => {
      const name = groupOp(model, ...args);
      flattenedNote(args);
      return name;
    },
    addTo: (g: unknown, ...names: unknown[]) => {
      const left = addTo(model, g, ...names);
      flattenedNote(names);
      return left;
    },
    removeFrom: (g: unknown, ...names: unknown[]) => {
      const left = removeFrom(model, g, ...names);
      if (!left.length) h.log?.(`${String(g)} is empty now — ungroup(${JSON.stringify(g)}) removes it`);
      return left;
    },
    ungroup: (g: unknown) => ungroup(model, g),
    opengroup: (g?: unknown) => opengroup(model, g),
    closegroup: () => closegroup(model),
    rename: (g: unknown, name: unknown) => rename(model, g, name),
    members: (name: unknown) => members(model, name),
    groups: (name?: unknown) => groupsOf(model, name),
    hide: (...names: unknown[]) => hide(model, ...names),
    show: (...names: unknown[]) => show(model, ...names),
    /**
     * Construction geometry (operations.ts): `construction(...names)` sets the
     * flag, `construction(...names, false)` clears it. A point or a frame
     * named outright is passed over and the log says so; one a group brought
     * in is passed over quietly, since a group's corners are not a mistake.
     */
    construction: (...args: unknown[]) => {
      const changed = construction(model, ...args);
      const named = args.filter((a): a is string => typeof a === "string" && model.entities.has(a));
      const over = named.filter((n) => {
        const k = model.entities.get(n)!.kind;
        return k !== "line" && k !== "arc" && k !== "circle";
      });
      if (over.length) {
        h.log?.(`${over.join(" ")} passed over — only lines, arcs and circles bound regions, so only they take the flag`);
      }
      return changed;
    },
  };

  /**
   * What the modules' own typed commands are handed (modules.ts's `ModuleKit`):
   * this surface's helpers, so a module's constructor takes clauses and seeds
   * at the middle of the view exactly as `circ` does, without importing this
   * file.
   */
  const kit: ModuleKit = {
    model,
    clauses: (who, make) => withClauses(who, make),
    anchor,
    facing: curveFacing,
  };

  /**
   * After a module loads: its relations and commands join this scope at once,
   * and the host hears of it (the tray, the menu). A scope built later — the
   * next open, an undo — reads them from the registry like the built-ins'.
   */
  const joined = () => {
    bindRelations();
    Object.assign(scope, relations, moduleCommands(kit));
    addedCommands();
    h.rescope?.(scope);
    h.modulesChanged?.();
  };

  /**
   * A module that is not built in — typed, or from a workbench file — has its
   * operations typed by name, each one journalled call (`asOperation`), and its
   * entity kinds' constructors typed by their op (`addPin(…)`), answering the
   * name made. The built-ins type theirs through their own commands.
   */
  function addedCommands() {
    for (const m of loadedModules()) {
      if (m.origin === "builtin") continue;
      for (const [op, fn] of Object.entries(m.spec.operations ?? {})) {
        const f = fn as (model: Model, ...args: unknown[]) => unknown;
        if (!(op in scope) || m.name === "user") scope[op] = (...args: unknown[]) => model.asOperation(op, args, () => f(model, ...args));
      }
      for (const decl of m.spec.entities ?? []) {
        scope[decl.add.op] = (...args: unknown[]) => {
          const made = (decl.add.fn as (model: Model, ...a: unknown[]) => unknown)(model, ...args);
          return made && typeof made === "object" && "name" in made ? (made as { name: string }).name : made;
        };
      }
    }
  }

  /** Captures the entry that defined `name` as its source — a file carries it as it carries a tool's (toolsource.ts). */
  const capture = (name: string) => {
    const entry = h.currentEntry?.();
    if (entry && !fileLoading()) sources.capture(name, entry);
    return entry ?? undefined;
  };

  const moduleCmds: Bag = {
    /**
     * `defineModule(name, spec)` — one call that registers everything a module
     * brings (modules.ts). From a workbench file it is checked against the
     * file's manifest before anything is registered; typed, the entry is the
     * consent, as a pasted tool's is, and it is carried by a saved file as
     * text.
     */
    defineModule: (name: string, spec: ModuleSpec) => {
      const file = fileLoading();
      const m = defineModule(name, spec, file ? { file: file.fileName, hash: file.hash } : "typed");
      if (!file) { const src = capture(name); if (src) m.source = src; }
      joined();
      return `module ${name}: ${describeModule(m)}`;
    },
    defineWorkbench: (name: string, spec: { modules: string[]; label?: string }) => {
      defineWorkbench(name, spec, "added");
      h.rescope?.(scope);
      h.modulesChanged?.();
      return `workbench ${name}: ${spec.modules.join(", ")}`;
    },
    /**
     * `defineRelation(name, slots, fn)` — a relation of the `user` module, as
     * `defineTool` makes a tool: `name` a word or `[short, long]` (the long is
     * what a file journals), `slots` where `_` may stand (`["point", "#d"]`),
     * and `fn(model, ...args)`, whose body is one `model.relation(op, args, …)`
     * so it is named, journalled and deletable.
     */
    defineRelation: (name: string | string[], sig: string[], fn: (model: Model, ...args: never[]) => string) => {
      const names = Array.isArray(name) ? name : [name];
      if (!names.length || !names.every((n) => typeof n === "string")) throw new Error("defineRelation(name, slots, fn): name is a word or [short, long]");
      if (!Array.isArray(sig) || typeof fn !== "function") throw new Error('defineRelation(name, slots, fn): slots is a list like ["point", "#distance"], fn(model, ...args)');
      const op = names[names.length - 1];
      extendModule("user", { relations: { [op]: { names, slots: slots(...sig), fn } } }, capture(op));
      joined();
      return `relation ${names.join(" / ")} (user)`;
    },
    /**
     * `defineOperation(name, fn)` — an operation of the `user` module: typed,
     * it runs `fn(model, ...args)` as one journalled call (`asOperation`), and
     * a file replays it by name.
     */
    defineOperation: (name: string, fn: (model: Model, ...args: unknown[]) => unknown) => {
      if (typeof name !== "string" || typeof fn !== "function") throw new Error("defineOperation(name, fn): fn(model, ...args)");
      extendModule("user", { operations: { [name]: fn as (model: Model, ...args: never[]) => unknown } }, capture(name));
      scope[name] = (...args: unknown[]) => model.asOperation(name, args, () => fn(model, ...args));
      h.rescope?.(scope);
      h.modulesChanged?.();
      return `operation ${name} (user)`;
    },
    /**
     * `defineEntity(decl)` — an entity kind of the `user` module (modules.ts's
     * `EntityDecl`): its structure (`refs`, `vars`, `curve`, `closed`), its
     * constructor (`add: { op, fn }`), and how it is drawn and picked
     * (`samples(model, name)`, a world polyline). Typed, its constructor is
     * `add.op` with the model in hand.
     */
    defineEntity: (decl: EntityDecl) => {
      if (!decl || typeof decl.kind !== "string" || !decl.add || typeof decl.add.fn !== "function") {
        throw new Error('defineEntity({ kind, refs, add: { op, fn }, samples? }) — see help()');
      }
      extendModule("user", { entities: [decl] }, capture(decl.kind));
      scope[decl.add.op] = (...args: unknown[]) => {
        const made = (decl.add.fn as (model: Model, ...a: unknown[]) => unknown)(model, ...args);
        return made && typeof made === "object" && "name" in made ? (made as { name: string }).name : made;
      };
      h.rescope?.(scope);
      h.modulesChanged?.();
      return `entity kind ${decl.kind} (user)`;
    },
    /** `modules()` — what is loaded, in order, and what each registers. */
    modules: () => loadedModules().map((m) => `${m.name.padEnd(10)} ${describeModule(m)}`),
    /** `workbench()` names the current one; `workbench("sketch")` switches the tray and the menu to it. */
    workbench: (name?: string) => {
      if (name === undefined) return activeWorkbench();
      if (h.workbench) return h.workbench(name);
      setActiveWorkbench(name);
      return `workbench: ${name}`;
    },
    workbenches: () => listWorkbenches().map((w) =>
      `${w.name === activeWorkbench() ? "●" : " "} ${w.name.padEnd(10)} ${w.modules.join(", ")}${w.origin === "added" ? "  (added)" : ""}`),
    /** The logo menu's Add workbench…: the device's file picker, the manifest, the question. Browser only. */
    addWorkbench: () => {
      if (!h.workbenchFiles) throw new Error("addWorkbench() needs the app's file picker — a browser");
      return h.workbenchFiles.add();
    },
    /** `loadModule(url)` — the same, from a URL: fetched, its manifest shown, asked. */
    loadModule: (url: string) => {
      if (!h.workbenchFiles) throw new Error("loadModule(url) needs the app — a browser");
      if (typeof url !== "string") throw new Error('loadModule(url) takes the workbench file\'s URL, "…/gears.zerocad.js"');
      return h.workbenchFiles.load(url);
    },
    removeWorkbench: (name: string) => {
      if (!h.workbenchFiles) throw new Error("removeWorkbench(name) needs the app — a browser");
      return h.workbenchFiles.remove(name);
    },
    shareWorkbench: (name: string) => {
      if (!h.workbenchFiles) throw new Error("shareWorkbench(name) needs the app — a browser");
      return h.workbenchFiles.share(name);
    },
  };

  const scope: Bag = {
    ...relations, ...geometry, ...moduleCommands(kit), ...operations, ...grouping, ...persistence, ...clauses, ...commands,
    ...moduleCmds,
  };
  addedCommands();
  scope.help = () => help(scope);
  return scope;
}

/**
 * help(): every loaded module's lines, in module order (modules.ts) — core's
 * geometry, frames, relations and clauses, the sketch module's curves, the
 * solids', STEP's, files', the organiser's, then the interface's sections every
 * workbench shares — and what is in scope.
 */
function help(scope: Bag): string {
  return [
    ...moduleHelp(),
    "",
    "A bare assignment persists between entries (box = class extends Tool {…});",
    "a const/let/class declaration does not.",
    "",
    `in scope: ${Object.keys(scope).sort().join(" ")}`,
  ].join("\n");
}

