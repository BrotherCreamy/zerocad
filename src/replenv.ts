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
import { Tool, defineTool, listTools, type ToolCtor } from "./tools/tool.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";
import { del, fillet, set } from "./operations.ts";
import { save as saveModel, savedTools } from "./persist.ts";
import { carryIntoSession, toolSources, type ToolSourceStore } from "./toolsource.ts";
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
  const sources = h.toolSources ?? toolSources;

  const relations: Bag = {
    // dimension-generic, from relations/basic.ts
    dist: bind(model, basic.dist),
    fix: bind(model, basic.fix),
    coin: bind(model, basic.coincident),
    coincident: bind(model, basic.coincident),
    mid: bind(model, basic.midpoint),
    midpoint: bind(model, basic.midpoint),
    // relations/geometry.ts. `par`, `perp` and `ang` additionally take a
    // frame-axis reference — `par("l1", yaxis())` is what `ver("l1")` was;
    // see the helpers below and relations/geometry.ts for why those three.

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
   */
  geometry.frame = (origin?: string | null, xref?: string | null) =>
    model.addFrame(origin ?? (xref == null ? anchor() : null), xref ?? null).name;
  geometry.setDefaultFrame = (name: string | null) => {
    model.setDefaultFrame(name ?? null);
    return model.defaultFrame ?? "no default frame";
  };
  geometry.defaultFrame = () => model.defaultFrame;

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
   */
  geometry.xaxis = (frame?: string | null) => `${model.resolveFrame(frame)}.x`;
  geometry.yaxis = (frame?: string | null) => `${model.resolveFrame(frame)}.y`;

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
  const persistence: Bag = {
    // The tools go in here and *only* here, not in `toSaved`'s default,
    // because the same function writes the undo stack's snapshots — see
    // persist.ts. A file the user asked for carries them; a snapshot does not,
    // so authoring a tool is not an edit to the drawing.
    save: () => saveModel(model, true, sources.all()),
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
    download: (filename = "sketch.neocad.json") => {
      if (!h.download) throw new Error("no download in this environment");
      h.download(saveModel(model, true, sources.all()), filename);
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
     */
    tools: () => {
      const active = listTools();
      return [
        ...active,
        ...sources.names()
          .filter((name) => !active.includes(name))
          .map((name) => `${name} (source only — toolSource(${JSON.stringify(name)}) to see it)`),
      ];
    },

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
    "           xaxis(frame?)  yaxis(frame?)  — a frame's axis, by name",
    "           there is no world frame: fix and the axes are relative to one,",
    "           and say so if you have made none. There is no hor/ver either:",
    '           par(l, yaxis()) is vertical, par(l, xaxis()) is level, and',
    '           par/perp/ang take any axis by name — par("l1", "f2.x").',
    "           A frame draws as an axes marker at its origin, brighter when it",
    "           is the default; drag the marker to move it, or its x-ref to turn",
    "           it and everything levelled against it. The line tool infers an",
    "           axis par only against the default.",
    "relations  dist fix coin mid par perp ang on eq",
    "           rad oncircle conc eqrad tan sym arcends",
    "operations fillet(line1, line2, radius)  del(name, ...)",
    '           set("d4.value", 60)  — a dimension is named d1, d2, … and its',
    "           value is the one thing you can set. ang stores radians (its",
    "           label reads degrees); dist and rad store what you typed.",
    "files      save()  open(text)  download(name)  openFile()  journal()",
    "           a file carries the source of tools you defined here, as text:",
    "           open() never runs it, toolSource(name) prints it, and pasting",
    "           it back is an ordinary entry — the paste is the consent.",
    "history    undo()  redo()          — ctrl+z, ctrl+shift+z (ctrl+y)",
    "viewport   arm(tool, opts)  cancel()  zoom(f)  pan(dx,dy)  refresh()",
    "inspect    ls()  rels(name?)  coords(name)  solve()  tools()  hover()",
    "           snapping(on)  glyphs(on)  model",
    "authoring  Tool  defineTool(name, ctor)  toolSource(name)  Dual",
    "",
    "A bare assignment persists between entries (box = class extends Tool {…});",
    "a const/let/class declaration does not.",
    "",
    `in scope: ${Object.keys(scope).sort().join(" ")}`,
  ].join("\n");
}
