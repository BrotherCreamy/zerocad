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
import type { SolveReport } from "./kernel/problem.ts";
import { Tool, defineTool, listTools } from "./tools/tool.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";

type Bag = Record<string, unknown>;

export interface EnvHandles {
  model: Model;
  /** Arms a registered tool by name. Absent outside the browser. */
  arm?: (toolName: string) => void;
  /** Cancels whatever tool is armed. */
  cancel?: () => void;
  /** Re-solves and redraws. Absent outside the browser. */
  refresh?: () => void;
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
}

/**
 * Curries a relation so REPL callers don't pass the model every time:
 * `dist("a", "b", 10)` rather than `dist(model, "a", "b", 10)`.
 */
function bind<A extends unknown[]>(model: Model, fn: (m: Model, ...args: A) => void) {
  return (...args: A) => fn(model, ...args);
}

function describe(e: Entity, model: Model): string {
  switch (e.kind) {
    case "point": return `${e.name}  point  (${model.coords(e.name).map((v) => v.toFixed(3)).join(", ")})`;
    case "line": return `${e.name}  line   ${e.refs[0]}–${e.refs[1]}`;
    case "circle": return `${e.name}  circle  center ${e.center}, r=${model.radius(e.name).toFixed(3)}`;
    case "arc": return `${e.name}  arc    center ${e.center}, ${e.start}→${e.end}, r=${model.radius(e.name).toFixed(3)}`;
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

  const geometry: Bag = {
    // Creation returns the entity's *name*, because that is what every
    // relation takes — `dist(pt(0,0), pt(3,4), 10)` reads straight through.
    pt: (...coords: number[]) => model.addPoint(coords).name,
    ln: (a: string, b: string) => model.addLine(a, b).name,
    circ: (center: string, r: number) => model.addCircle(center, r).name,
    arc: (center: string, start: string, end: string, r: number) => model.addArc(center, start, end, r).name,
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
    coords: (name: string) => model.coords(name),

    arm: (name: string) => {
      if (!h.arm) throw new Error("no viewport in this environment");
      h.arm(name);
      return `armed: ${name}`;
    },
    cancel: () => { h.cancel?.(); return "cancelled"; },
    refresh: () => { h.refresh?.(); return "ok"; },

    // Viewport control as an ordinary command, per the brief's goal of having
    // the whole interface drivable the same way a tool is authored.
    view: h.view,
    zoom: (factor: number) => {
      if (!h.view) throw new Error("no viewport in this environment");
      h.view.scale *= factor;
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

  const scope: Bag = { ...relations, ...geometry, ...commands };
  scope.help = () => help(scope);
  return scope;
}

function help(scope: Bag): string {
  return [
    "geometry   pt(x,y)  ln(a,b)  circ(center,r)  arc(center,start,end,r)",
    "relations  dist fix coin mid hor ver par perp ang on eq",
    "           rad oncircle conc eqrad tan sym arcends",
    "viewport   arm(tool)  cancel()  zoom(f)  pan(dx,dy)  refresh()",
    "inspect    ls()  coords(name)  solve()  tools()  model",
    "authoring  Tool  defineTool(name, ctor)  Dual",
    "",
    "A bare assignment persists between entries (box = class extends Tool {…});",
    "a const/let/class declaration does not.",
    "",
    `in scope: ${Object.keys(scope).sort().join(" ")}`,
  ].join("\n");
}
