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

import { Dual } from "./kernel/dual.ts";
import { Model, type Entity } from "./model.ts";
import { describeRelation } from "./picking.ts";
import type { SolveReport } from "./kernel/problem.ts";
import { Tool, defineTool, listTools } from "./tools/tool.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";
import { del, fillet } from "./operations.ts";
import { save as saveModel } from "./persist.ts";
import { clampScale, screenToWorld } from "./view.ts";

type Bag = Record<string, unknown>;

export interface EnvHandles {
  model: Model;
  /** Arms a registered tool by name, optionally with arm-time options. */
  arm?: (toolName: string, options?: Record<string, unknown>) => void;
  /** The name of whatever the cursor is currently over, if anything. */
  pick?: () => string | null;
  /** Turns cursor snapping on or off; reports the current state when given nothing. */
  snapping?: (on?: boolean) => boolean;
  /**
   * Turns the constraint glyphs on or off; reports the current state when given
   * nothing. Off empties the layer *and* stops glyphs being pickable, because a
   * mark you cannot see but can still click would be a trap.
   */
  glyphs?: (on?: boolean) => boolean;
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
  /** Prompts for a file and opens it. Browser only. */
  openFile?: () => void;
  /**
   * The host's own solve path, if it has one. `solve()` prefers this over
   * calling model.solve() directly so that a solve typed at the command line
   * refreshes the viewport and status readout exactly as one triggered by a
   * tool does — otherwise the REPL can silently leave the UI showing a stale
   * verdict from the previous solve.
   */
  solve?: () => SolveReport;
  /** The 2D view transform, so pan/zoom is an ordinary command like everything else. */
  view?: { ox: number; oy: number; scale: number };
  /**
   * The viewport's size in CSS pixels. Kept apart from `view` because a
   * `View` is only a transform — it has no idea how big the window showing
   * it is — and the two together are what "the middle of what the user is
   * looking at" needs. A function rather than a value: the log pane grows as
   * commands are typed and takes height from the canvas, so a size read once
   * at startup would drift.
   */
  viewSize?: () => [number, number];
}

/**
 * Curries a relation so REPL callers don't pass the model every time:
 * `dist("a", "b", 10)` rather than `dist(model, "a", "b", 10)`.
 */
function bind<A extends unknown[]>(model: Model, fn: (m: Model, ...args: A) => void) {
  return (...args: A) => fn(model, ...args);
}

// `describeRelation` and the short-name table it reads used to live here. They
// moved down to picking.ts when the hover tag started describing relations too
// — one table, so the canvas and the command line cannot end up calling the
// same relation two different things.

function describe(e: Entity, model: Model): string {
  switch (e.kind) {
    case "point": return `${e.name}  point  (${model.coords(e.name).map((v) => v.toFixed(3)).join(", ")})`;
    case "line": return `${e.name}  line   ${e.refs[0]}–${e.refs[1]}`;
    case "circle": return `${e.name}  circle  center ${e.center}, r=${model.radius(e.name).toFixed(3)}`;
    case "arc": return `${e.name}  arc    center ${e.center}, ${e.start}→${e.end}, r=${model.radius(e.name).toFixed(3)}`;
    case "frame": return `${e.name}  frame  origin ${e.origin}, +x toward ${e.xref}`
      + (model.defaultFrame === e.name ? "  (default)" : "");
  }
}

export function neocadScope(h: EnvHandles): Bag {
  const model = h.model;

  const relations: Bag = {
    // dimension-generic, from relations/basic.ts
    dist: bind(model, basic.dist),
    fix: bind(model, basic.fix),
    coin: bind(model, basic.coincident),
    coincident: bind(model, basic.coincident),
    mid: bind(model, basic.midpoint),
    midpoint: bind(model, basic.midpoint),
    // 2D-only, from relations/basic.ts
    hor: bind(model, basic.horizontal),
    horizontal: bind(model, basic.horizontal),
    ver: bind(model, basic.vertical),
    vertical: bind(model, basic.vertical),
    // relations/geometry.ts
    par: bind(model, geom.parallel),
    parallel: bind(model, geom.parallel),
    perp: bind(model, geom.perpendicular),
    perpendicular: bind(model, geom.perpendicular),
    ang: bind(model, geom.angle),
    angle: bind(model, geom.angle),
    on: bind(model, geom.pointOnLine),
    pointOnLine: bind(model, geom.pointOnLine),
    eq: bind(model, geom.equalLength),
    equalLength: bind(model, geom.equalLength),
    rad: bind(model, geom.radius),
    radius: bind(model, geom.radius),
    oncircle: bind(model, geom.onCircle),
    onCircle: bind(model, geom.onCircle),
    conc: bind(model, geom.concentric),
    concentric: bind(model, geom.concentric),
    eqrad: bind(model, geom.equalRadius),
    equalRadius: bind(model, geom.equalRadius),
    tan: bind(model, geom.tangent),
    tangent: bind(model, geom.tangent),
    sym: bind(model, geom.symmetric),
    symmetric: bind(model, geom.symmetric),
    arcends: bind(model, geom.arcEndpoints),
    arcEndpoints: bind(model, geom.arcEndpoints),
  };

  /**
   * Where a piece nobody placed should go: the middle of what is on screen.
   *
   * A free `circle()` materialising at the world origin is baffling — you
   * type it, nothing appears, and the drawing looks broken until you happen
   * to pan back. So the command layer decides the coordinate and passes it
   * down as an ordinary argument. The model stays where it was: it takes
   * coordinates, and has still never heard of a viewport.
   *
   * Undefined when there is nothing to ask (headless tests, a REPL with no
   * canvas) or when the model is not 2D, since a `View` is a 2D transform and
   * has no middle to offer a model of any other dimension. Both cases fall
   * back to the model's own plain defaults.
   */
  function viewSeed(): number[] | undefined {
    if (!h.view || !h.viewSize || model.dim !== 2) return undefined;
    const [width, height] = h.viewSize();
    return screenToWorld(h.view, width / 2, height / 2);
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

  const geometry: Bag = {
    // Creation returns the entity's *name*, because that is what every
    // relation takes — `dist(pt(0,0), pt(3,4), 10)` reads straight through.
    //
    // Every argument is optional, because none of them was ever a constraint
    // — see model.ts. `circle()` is a legal way to say "a circle, which the
    // relations I am about to type will define".
    pt: (...coords: number[]) => model.addPoint(coords.length ? coords : viewSeed()).name,
    ln: (a?: string | null, b?: string | null) =>
      model.addLine(a ?? (b == null ? anchor() : null), b ?? null).name,
    circ: (center?: string | null, r?: number | null) =>
      model.addCircle(center ?? anchor(), r ?? null).name,
    arc: (center?: string | null, start?: string | null, end?: string | null, r?: number | null) =>
      model.addArc(center ?? anchor(), start ?? null, end ?? null, r ?? null).name,
  };
  /**
   * Coordinate frames, as ordinary commands.
   *
   * Deliberately plain in this half of the package: `frame()` seeds its auto
   * points the way the model does, not at the middle of the view the way
   * `circle()` does, and nothing draws a frame yet. Those belong with the
   * tools, and putting them here first would mean the model half could not be
   * reviewed without the drawing half in the other hand.
   */
  geometry.frame = (origin?: string | null, xref?: string | null) =>
    model.addFrame(origin ?? null, xref ?? null).name;
  geometry.setDefaultFrame = (name: string | null) => {
    model.setDefaultFrame(name ?? null);
    return model.defaultFrame ?? "no default frame";
  };
  geometry.defaultFrame = () => model.defaultFrame;

  // Long names beside the short ones, the way every relation already has both.
  // The owner's examples are written `circle()`, and a creator function shares
  // a name with a tool without trouble: a bare word arms the tool, a call is
  // an expression — `arc` and `fillet` have both been doing this all along.
  geometry.point = geometry.pt;
  geometry.line = geometry.ln;
  geometry.circle = geometry.circ;

  // Operations change the model's structure rather than only adding
  // equations — see operations.ts for why that is worth keeping separate.
  const operations: Bag = {
    fillet: (l1: string, l2: string, r: number) => fillet(model, l1, l2, r),
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
  const persistence: Bag = {
    save: () => saveModel(model),
    open: (json: string) => {
      if (!h.openModel) throw new Error("open needs a host that can swap the model");
      if (typeof json !== "string") throw new Error("open takes the text of a saved model");
      h.openModel(json);
      return "opened";
    },
    download: (filename = "sketch.neocad.json") => {
      if (!h.download) throw new Error("no download in this environment");
      h.download(saveModel(model), filename);
      return filename;
    },
    openFile: () => {
      if (!h.openFile) throw new Error("no file picker in this environment");
      h.openFile();
      return "choose a file…";
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
    defineTool,
    tools: () => listTools(),

    solve: () => (h.solve ? h.solve() : model.solve()),
    ls: () => [...model.entities.values()].map((e) => describe(e, model)),
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
    coords: (name: string) => model.coords(name),

    arm: (name: string, options?: Record<string, unknown>) => {
      if (!h.arm) throw new Error("no viewport in this environment");
      h.arm(name, options);
      return `armed: ${name}`;
    },
    cancel: () => { h.cancel?.(); return "cancelled"; },
    hover: () => h.pick?.() ?? null,
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
    refresh: () => { h.refresh?.(); return "ok"; },

    // Viewport control as an ordinary command, per the brief's goal of having
    // the whole interface drivable the same way a tool is authored.
    view: h.view,
    zoom: (factor: number) => {
      if (!h.view) throw new Error("no viewport in this environment");
      h.view.scale = clampScale(h.view.scale * factor);
      h.refresh?.();
      return h.view.scale;
    },
    pan: (dx: number, dy: number) => {
      if (!h.view) throw new Error("no viewport in this environment");
      h.view.ox += dx;
      h.view.oy += dy;
      h.refresh?.();
      return [h.view.ox, h.view.oy];
    },
  };

  const scope: Bag = { ...relations, ...geometry, ...operations, ...persistence, ...commands };
  scope.help = () => help(scope);
  return scope;
}

function help(scope: Bag): string {
  return [
    "geometry   pt(x,y)  ln(a,b)  circ(center,r)  arc(center,start,end,r)",
    "           point()  line()  circle()  — the same three, long names",
    "           every argument is optional: what you leave out is created free",
    "           near the middle of the view, for your relations to define",
    "frames     frame(origin, xref)  setDefaultFrame(name)  defaultFrame()",
    "           there is no world frame: hor/ver/fix are relative to one",
    "relations  dist fix coin mid hor ver par perp ang on eq",
    "           rad oncircle conc eqrad tan sym arcends",
    "operations fillet(line1, line2, radius)  del(name, ...)",
    "files      save()  open(text)  download(name)  openFile()  journal()",
    "history    undo()  redo()          — ctrl+z, ctrl+shift+z (ctrl+y)",
    "viewport   arm(tool, opts)  cancel()  zoom(f)  pan(dx,dy)  refresh()",
    "inspect    ls()  rels(name?)  coords(name)  solve()  tools()  hover()",
    "           snapping(on)  glyphs(on)  model",
    "authoring  Tool  defineTool(name, ctor)  Dual",
    "",
    "A bare assignment persists between entries (box = class extends Tool {…});",
    "a const/let/class declaration does not.",
    "",
    `in scope: ${Object.keys(scope).sort().join(" ")}`,
  ].join("\n");
}
