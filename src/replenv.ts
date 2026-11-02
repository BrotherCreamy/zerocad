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
import { Model, type Entity, type ProfileMember } from "./model.ts";
import { describeFeature, describeRelation } from "./picking.ts";
import type { SolveReport } from "./kernel/problem.ts";
import { Tool, defineTool, getToolCtor, listTools, type ToolCtor } from "./tools/tool.ts";
import { OptionMemory, declaredOptions, defaultsOf, describeValues, resolveOptions } from "./tools/options.ts";
import * as basic from "./relations/basic.ts";
import * as geom from "./relations/geometry.ts";
import {
  del, extrude, extrudeNeedsFrame, fillet, filletNeedsFrame, regen, revolve, revolveNeedsFrame, set,
} from "./operations.ts";
import { facingPoints, sketchFrameFor } from "./sketchface.ts";
import { cross3, lift3, sub3 } from "./vec3.ts";
import { save as saveModel, savedTools } from "./persist.ts";
import { carryIntoSession, toolSources, type ToolSourceStore } from "./toolsource.ts";
import { alignView, assignView, orbitBy, panBy, screenToWorld, viewAxes, zoomAbout, type View } from "./view.ts";
import { pointOnWorkingPlane } from "./workplane.ts";
import { frameBasis } from "./relations/refs.ts";
import { describeLoop, findLoops, type Loop } from "./loops.ts";
import { _, checkClauses, checkOrdinary, slots, splitClauses, subjectable, type Clause, type Slot } from "./clauses.ts";

type Bag = Record<string, unknown>;
type PlaneCall = (origin?: string | null, xref?: string | null, yref?: string | null,
  options?: { look?: boolean } | null) => string;

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
   * The viewer's last value of each tool option — the same memory the host's
   * tool engine arms from, so `tools()` lists what `arm` would use. Per-viewer
   * state, like the layout; a scope with none keeps its own for its lifetime.
   */
  optionMemory?: OptionMemory;
}

/**
 * Curries a relation so REPL callers don't pass the model every time:
 * `dist("a", "b", 10)` rather than `dist(model, "a", "b", 10)`.
 */
function bind<A extends unknown[]>(model: Model, fn: (m: Model, ...args: A) => string) {
  return (...args: A) => fn(model, ...args);
}

/**
 * Two coordinates where a 3D model wants three, made three with a zero — the
 * one rule the command line and an opened 2D file share (see persist.ts).
 *
 * The app is 3D now, and a hand that has typed `pt(40, 30)` for as long as the
 * app has existed should not be met with "point needs 3 coordinates". A 2D
 * coordinate in a 3D model reads as the 3D one with no depth: for `pt` that is
 * the kernel's z = 0 — a *seed*, the gauge every 2D drawing already lived in,
 * and no constraint — and for `fix` it is the frame's own z = 0, which is the
 * one thing `fix(p, [x, y])` can mean on a sketch plane: at (x, y) *on* it.
 *
 * Anything else is passed through untouched, so a wrong count still meets the
 * model's own message.
 */
function lifted(model: Model, coords: number[]): number[] {
  return model.dim === 3 && Array.isArray(coords) && coords.length === 2 ? [...coords, 0] : coords;
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
      + (e.plane === undefined ? "" : `, in ${e.plane}`);
    case "arc": return `${e.name}  arc    center ${e.center}, ${e.start}→${e.end}, r=${model.radius(e.name).toFixed(3)}`
      + (e.plane === undefined ? "" : `, in ${e.plane}`);
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
   * stand (see clauses.ts). A slot marked `#` takes a number, so `_` there is
   * refused when the clause is made. `relation` will not take a binding
   * without one, so a new relation cannot arrive here unsaid.
   */
  const relations: Bag = {};
  const relation = (names: [string, string] | [string], sig: Slot[], fn: (...args: never[]) => string) => {
    for (const op of names) relations[op] = subjectable(op, sig, fn);
  };
  // dimension-generic, from relations/basic.ts
  relation(["dist"], slots("a", "b", "#distance"), bind(model, basic.dist));
  relation(["fix"], slots("point", "#coordinates", "frame"),
    (name: string, at: number[], frame?: string | null) => basic.fix(model, name, lifted(model, at), frame));
  // 3D only: the point lies in the frame's plane. Frame-relative like `fix`.
  relation(["onplane", "onPlane"], slots("point", "frame"), bind(model, basic.onPlane));
  relation(["coin", "coincident"], slots("a", "b"), bind(model, basic.coincident));
  relation(["mid", "midpoint"], slots("midpoint", "a", "b"), bind(model, basic.midpoint));
  // relations/geometry.ts. `par`, `perp` and `ang` additionally take a
  // frame-axis reference — `par("l1", yaxis())` is what `ver("l1")` was;
  // see the helpers below and relations/geometry.ts for why those three.
  relation(["par", "parallel"], slots("a", "b", "c"), bind(model, geom.parallel));
  relation(["perp", "perpendicular"], slots("a", "b", "c"), bind(model, geom.perpendicular));
  relation(["ang", "angle"], slots("a", "b", "#angle"), bind(model, geom.angle));
  relation(["on", "pointOnLine"], slots("point", "line"), bind(model, geom.pointOnLine));
  relation(["eq", "equalLength"], slots("line", "line"), bind(model, geom.equalLength));
  relation(["rad", "radius"], slots("circle", "#radius"), bind(model, geom.radius));
  relation(["oncircle", "onCircle"], slots("point", "circle"), bind(model, geom.onCircle));
  relation(["conc", "concentric"], slots("circle", "circle"), bind(model, geom.concentric));
  relation(["eqrad", "equalRadius"], slots("circle", "circle"), bind(model, geom.equalRadius));
  relation(["tan", "tangent"], slots("line", "circle"), bind(model, geom.tangent));
  relation(["sym", "symmetric"], slots("a", "b", "line"), bind(model, geom.symmetric));
  relation(["arcends", "arcEndpoints"], slots("arc"), bind(model, geom.arcEndpoints));

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
   * Puts a frame's plane square to the screen — `lookAt`'s body, shared with
   * `plane()`. See `lookAt` below.
   */
  function lookAtFrame(frame?: string | null): string {
    if (!h.view) throw new Error("no viewport in this environment");
    const name = model.resolveFrame(frame);
    const { origin, ux, uy } = frameBasis(model, name)();
    if (ux.every((c) => c === 0) || uy.every((c) => c === 0)) {
      throw new Error(`"${name}" has collapsed — it has no plane to look at`);
    }
    assignView(h.view, alignView(h.view, ux, uy, origin));
    h.refresh?.();
    return `looking at ${name}`;
  }

  /**
   * The frame a typed `extrude` or `revolve` makes for a loop no frame orients:
   * three of the loop's own points by `sketchFrameFor`'s rule (a corner and its
   * neighbours), the default only if there was none, and the view left alone —
   * what the tools type as `plane(a, b, c, { look: false })` or `frame(a, b,
   * c)`, made here as the same model calls. +z toward the viewer where there
   * is one, so a positive depth comes out at them as it does from the tool;
   * with no view, the loop's own normal (loops.ts's: the side whose largest
   * component is positive, so up for anything drawn level).
   */
  function planeForFeature(loop: Loop): string {
    const toward = model.dim === 3 && h.view ? viewAxes(h.view).toward : loop.plane.normal;
    const name = model.addFrame(...sketchFrameFor(model, loop, toward)).name;
    if (model.defaultFrame == null) model.setDefaultFrame(name);
    return name;
  }

  /**
   * The frame a typed `circ()` or `arc()` makes in a 3D model with no default
   * frame and no plane named — the curve tools' rule at the command line:
   * nobody should have to know what a frame is to draw a circle. It is
   * `plane()` with nothing given, `{ look: false }`: a frame seeded at the
   * middle of the view on the working plane, its refs along the screen's right
   * and up, exactly as a typed `frame()` seeds — the plane facing the viewer —
   * made the default, the view left where it is. Its model calls are journalled
   * before the circle's, so a replay finds the frame there, and the whole line
   * is one entry and so one undo step. Asked only after the call's own
   * refusals (`check`), so a circle that would be refused makes no frame.
   * Headless there is no view, and the frame is the model's own seed: at the
   * origin, along the kernel's x and y.
   *
   * Said in the log, where there is one: the answer to the line is the
   * circle's name, and a frame nobody named appearing beside it unannounced
   * would be the surprise this exists to remove.
   */
  function planeForCurve(who: string, plane: string | null | undefined, check: () => void): void {
    if (model.dim !== 3 || plane != null || model.defaultFrame != null) return;
    check();
    const made = (geometry.plane as PlaneCall)(null, null, null, { look: false });
    h.log?.(`${who}: no default frame, so ${made} was made at the view centre, facing you`);
  }

  /**
   * `planeForCurve` for a typed `fillet` on a corner with no default frame to
   * give its arc: a frame of the corner's own three points (`filletNeedsFrame`
   * — asked after every refusal that needs no frame), the default, +z toward
   * the viewer where there is one; headless, the side of the corner's normal
   * whose largest component is positive (loops.ts's rule, so up for a corner
   * drawn level). The fillet tool types the same frame as `plane(…)`.
   */
  function planeForCorner(corner: [string, string, string]): string {
    const [o, a, b] = corner.map((p) => lift3(model.coords(p)));
    const n = cross3(sub3(a, o), sub3(b, o));
    const big = n.reduce((k, c, i) => (Math.abs(c) > Math.abs(n[k]) ? i : k), 0);
    const toward = h.view ? viewAxes(h.view).toward : n[big] < 0 ? n.map((c) => -c) : n;
    const name = model.addFrame(...facingPoints(model, corner, toward)).name;
    model.setDefaultFrame(name);
    h.log?.(`fillet: no default frame, so ${name} was made on the corner, facing you`);
    return name;
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
    // In 3D a circle or arc takes a plane — a frame, or the default — and with
    // neither it makes one first (`planeForCurve`). It is resolved here
    // *before* the view-centre anchor is made, so a refusal (a plane named in
    // 2D) leaves no stray point behind, and resolved again by the model
    // itself, which is what journals it.
    circ: withClauses("circ", (center?: string | null, r?: number | null, plane?: string | null) => {
      planeForCurve("circ", plane, () => model.checkCircle(center, r));
      model.curvePlane("circle", plane);
      return model.addCircle(center ?? anchor(), r ?? null, plane ?? null).name;
    }),
    arc: withClauses("arc", (center?: string | null, start?: string | null, end?: string | null, r?: number | null,
          plane?: string | null) => {
      planeForCurve("arc", plane, () => model.checkArc(center, start, end, r));
      model.curvePlane("arc", plane);
      return model.addArc(center ?? anchor(), start ?? null, end ?? null, r ?? null, plane ?? null).name;
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
    /**
     * Rounds the corner two lines meet at, and regenerates every feature
     * standing on either line, so an extruded corner rounds the lid as well as
     * the sketch. `regenerated` is what the journal carries — the features it
     * regenerated, profiles resolved — and never needs typing. See
     * operations.ts.
     */
    //
    // A corner with no default frame for its arc gets one first, on its own
    // points (`planeForCorner`), journalled before the fillet entry that names
    // it; one line, one undo step.
    fillet: (l1: string, l2: string, r: number, plane?: string | null, regenerated?: unknown) => {
      if (plane == null && regenerated == null) {
        const corner = filletNeedsFrame(model, l1, l2, r);
        if (corner) plane = planeForCorner(corner);
      }
      return fillet(model, l1, l2, r, plane, regenerated);
    },
    /**
     * Brings a feature back into step with its profile as it is now —
     * `regen("e1")` — keeping every twin and wall whose vertex or member is
     * still there, and returns its name. For a profile restructured by hand;
     * `fillet` does it by itself. See operations.ts.
     */
    regen: (feature: string, regenerated?: unknown) => regen(model, feature, regenerated),
    /**
     * Extrudes the closed loop a member is in — `extrude("l1", 20)` — and
     * returns the feature's name. `frame` picks the loop when the member is in
     * several (it is, once it is the edge of a wall too): the one parallel to
     * that frame's plane. `loops` is the profile as the journal carries it
     * resolved, and never needs typing. See operations.ts.
     *
     * A loop no frame orients gets one first (`planeForFeature`): a frame of
     * three of its own points, journalled as its own `addFrame` before the
     * `extrude` entry that names it — a replay has to find the frame there —
     * and the default if there was none. The operation itself still refuses a
     * frameless loop; this is the layer that is meant to have dealt with it.
     */
    extrude: (member: string, depth?: number | null, frame?: string | null, loops?: ProfileMember[][] | null) => {
      if (frame == null && loops == null) {
        const loop = extrudeNeedsFrame(model, member, depth ?? null);
        if (loop) frame = planeForFeature(loop);
      }
      return extrude(model, member, depth ?? null, frame ?? null, loops ?? null);
    },
    /**
     * Revolves the closed loop a member is in about an axis — `revolve("l1",
     * "f1.y", Math.PI)`, or `yaxis()` for the default frame's — through an angle
     * in radians, a whole turn when left out, and returns the feature's name.
     * The axis is a frame's axis or a line, read and never moved. `frame` and
     * `loops` are extrude's, and so is the frame made for a loop no frame
     * orients — after the axis has been checked against the loop's own plane,
     * so a revolve refused on its geometry makes no frame first.
     */
    revolve: (member: string, axis: string, angle?: number | null, frame?: string | null, loops?: ProfileMember[][] | null) => {
      if (frame == null && loops == null) {
        const loop = revolveNeedsFrame(model, member, axis, angle ?? null);
        if (loop) frame = planeForFeature(loop);
      }
      return revolve(model, member, axis, angle ?? null, frame ?? null, loops ?? null);
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
     *
     * A tool that declares options is listed with them as `arm` would fill
     * them now — `extrude  { depth: 10 }` — and, where a remembered value
     * differs, the declared defaults after: the line says both what you will
     * get and what you would type to have the default back.
     */
    tools: () => {
      const active = listTools();
      return [
        ...active.map((name) => {
          const specs = declaredOptions(getToolCtor(name), name);
          if (Object.keys(specs).length === 0) return name;
          const now = resolveOptions(name, specs, {}, memory.recall(name));
          const declared = describeValues(specs, defaultsOf(specs));
          const shown = describeValues(specs, now);
          return shown === declared ? `${name}  ${shown}` : `${name}  ${shown}  (default ${declared})`;
        }),
        ...sources.names()
          .filter((name) => !active.includes(name))
          .map((name) => `${name} (source only — toolSource(${JSON.stringify(name)}) to see it)`),
      ];
    },

    solve: () => (h.solve ? h.solve() : model.solve()),
    // Entities, then features — `e1  extrude of …`, `e2  revolve of …` —
    // since a feature is a named thing `del` takes as surely as an entity.
    ls: () => [
      ...[...model.entities.values()].map((e) => describe(e, model)),
      ...[...model.features.values()].map((f) => describeFeature(model, f)),
    ],
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
     * its place on screen and becomes what the next orbit turns about. The
     * default frame when none is named, resolved like everything else that
     * takes one.
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

  const scope: Bag = { ...relations, ...geometry, ...operations, ...persistence, ...clauses, ...commands };
  scope.help = () => help(scope);
  return scope;
}

function help(scope: Bag): string {
  return [
    "geometry   pt(x,y)  ln(a,b)  circ(center,r,plane?)  arc(center,start,end,r,plane?)",
    "           point()  line()  circle()  — the same three, long names",
    "           every argument is optional: what you leave out is created free",
    "           near the middle of the view, for your relations to define.",
    "           In 3D a circle or arc lies in a plane — a frame, or the default",
    "           one. Its rim is parallel to the frame through its own centre,",
    "           which the plane does not pin. With neither, one is made first:",
    "           typed, plane() at the view centre, facing you, the default now",
    "           (the log says so); the circle and arc tools type",
    "           plane(pt(x, y, z), null, null, { look: false }) at the click,",
    "           and the fillet tool and fillet() make one on the corner's points.",
    "frames     frame(origin, xref)  setDefaultFrame(name)  defaultFrame()",
    "           plane(origin?, xref?, yref?) — a frame, made the default and",
    "           looked at square-on: \"start sketching here\" in one call.",
    "           plane(a, b, c, { look: false }) — the same, the view left alone.",
    "           On a face: arm(\"sketch\") and click inside it (or right-click",
    "           it: Sketch on this face) — plane(a, b, c) on three of the",
    "           face's own points, +z toward you, so out of a solid.",
    "           xaxis(frame?)  yaxis(frame?)  — a frame's axis, by name",
    "           there is no world frame: fix and the axes are relative to one,",
    "           and say so if you have made none (a tool that needs a plane",
    "           makes the one under its click). There is no hor/ver either:",
    '           par(l, yaxis()) is vertical, par(l, xaxis()) is level, and',
    '           par/perp/ang take any axis by name — par("l1", "f2.x").',
    "           A frame draws as an axes marker at its origin, brighter when it",
    "           is the default; drag the marker to move it, or its x-ref to turn",
    "           it and everything levelled against it. The line tool infers an",
    "           axis par only against the default.",
    "           The app is 3D: frame(origin, xref, yref) is a plane (the y-ref",
    "           picks its side of +x, not its exact angle), zaxis(frame?) is its",
    "           normal, onplane(p, frame?) holds a point in it, and fix takes",
    "           [x, y, z] in the frame — or [x, y], on its plane. pt(x, y) is",
    "           pt(x, y, 0). Tools draw on the default frame's plane and hold",
    "           what they draw there with onplane. A point off that plane",
    "           snaps at its projection onto it (a dashed square) and infers",
    "           nothing.",
    "relations  dist fix coin mid par perp ang on eq",
    "           rad oncircle conc eqrad tan sym arcends onplane",
    "clauses    _ is the thing being made. A relation given _ does not apply:",
    "           it becomes a clause, and pt ln circ arc frame take clauses",
    "           after their own arguments, applying each to what they made —",
    '           circ(oncircle("p1", _), oncircle("p2", _), oncircle("p3", _))',
    '           pt(on(_, "l1"), on(_, "l2"))      — the intersection',
    "           constrain(name, ...clauses) applies them to what exists. All",
    "           are checked before anything is made; each journals as itself.",
    "operations fillet(line1, line2, radius, plane?)  del(name, ...)",
    '           set("d4.value", 60)  — a dimension is named d1, d2, … and its',
    "           value is the one thing you can set. ang stores radians (its",
    "           label reads degrees); dist and rad store what you typed.",
    '           extrude(member, depth?, frame?) — a solid of the closed loop',
    "           the member is in, holes and all, along its sketch frame's +z:",
    '           a feature e1, a lid of twins and walls held by one depth',
    '           dimension (set("d9.value", 40) moves the lid). frame picks the',
    "           loop when the member is in several. The extrude tool does it by",
    '           a click inside a region: arm("extrude", { depth: 20 }).',
    "           A sketch no frame lies in or along (a rectangle drawn in a fresh",
    "           model) gets one first, from three of its own corners, +z toward",
    "           you, the default if there was none: the tool types it as",
    "           plane(a, b, c, { look: false }) — or frame(a, b, c) beside a",
    "           default it keeps — and then extrudes; typed, extrude makes the",
    "           same frame itself. Revolve does the same.",
    '           del("e1") removes the solid and keeps its sketch; deleting any',
    "           piece of it takes only the feature's record (its faces).",
    "           revolve(member, axis, angle?, frame?) — the same loop turned",
    '           about an axis in its plane ("f1.y", yaxis(), or a line), angle',
    "           in radians, a whole turn when left out. A partial revolve has a",
    "           real end face, held by one angle dimension that set swings",
    "           (radians; its label reads degrees); a full one has none, and",
    "           turning it partial is a new revolve, not a set. The revolve tool:",
    '           arm("revolve", { angle }), click inside a region, then the axis.',
    "           A feature follows its profile: fillet a corner of an extruded",
    "           or revolved sketch and the lid (or end face) is rounded too,",
    "           keeping every twin and wall whose corner is still there.",
    '           regen("e1") does the same for a profile you changed by hand —',
    "           a line drawn across it, a hole drawn in it.",
    "files      save()  open(text)  download(name)  openFile()  journal()",
    "           a file carries the source of tools you defined here, as text:",
    "           open() never runs it, toolSource(name) prints it, and pasting",
    "           it back is an ordinary entry — the paste is the consent.",
    "history    undo()  redo()          — ctrl+z, ctrl+shift+z (ctrl+y)",
    "           or Undo / Redo at the bottom of the right-click menu. The",
    "           keys are the drawing's wherever the focus is: text half-typed",
    "           in the command line stays put, and the drawing undoes. Only",
    "           the drawing has steps — panel layout and the camera (orbit,",
    "           pan, zoom, lookAt) are not, so Ctrl+Z after an orbit undoes",
    "           the last edit, not the turn.",
    "viewport   arm(tool, opts)  cancel()  zoom(f)  pan(dx,dy)  refresh()",
    "           A tool's options are declared, and tools() lists them with",
    '           what arm would use now: extrude  { depth: 10 }. arm("extrude",',
    "           { depth: 25 }) sets one; one the tool does not have is refused,",
    "           naming those it does. Armed, a tool with options shows them in",
    "           a small panel beside the tray: edit a field (Enter, or click",
    '           away; Escape puts it back) and it types arm("extrude", {depth:',
    "           25}) here. The last value you armed a tool with is remembered",
    "           as its default — in this browser, like the layout, never in a",
    "           file; type the default to have it back.",
    "           orbit(yaw, pitch)  — turn the drawing, radians, like a right-drag",
    "           lookAt(frame?)     — a frame's plane square-on, +x right, +y up",
    '           view("shaded")  view("hidden")  view("wire")  view() — how',
    "           solids are shown. Shaded, the default, is opaque: nothing",
    "           behind a face is drawn, picked, snapped to or boxed — turn the",
    "           view to see it. Hidden draws it dimmed and keeps it all",
    "           pickable; wire draws no faces. Also the View row of the",
    "           right-click menu on empty canvas. Yours, in this browser, like",
    "           the layout: never in a file, never an undo step. The camera",
    "           object itself is camera (it was view).",
    '           layout()  layout("reset") — where the panels are; put them back.',
    "           Drag a panel by its strip, resize it by its corner; the",
    "           arrangement is yours, in this browser, and never in a file.",
    "           right-drag orbits, middle-drag pans, the wheel zooms; a click",
    "           lands on the default frame's plane (or the one facing you)",
    "inspect    ls()  rels(name?)  coords(name)  solve()  tools()  hover()",
    "           snapping(on)  glyphs(on)  model",
    "           loops() — the closed loops of lines and arcs (and whole circles),",
    "           each in one plane: ends join only at a shared point or a coin,",
    "           never by sitting on the same spot. Read-only; named by members.",
    "authoring  Tool  defineTool(name, ctor)  toolSource(name)  Dual",
    '           static options = { depth: { default: 10, unit: "length" } } on',
    "           a tool class declares what it can be armed with (a number, or",
    "           true/false; unit \"length\", \"angle\" in radians, or any text;",
    "           label?, check?) — and it gets arm's checks, the panel and the",
    "           remembered values with no more work.",
    "",
    "A bare assignment persists between entries (box = class extends Tool {…});",
    "a const/let/class declaration does not.",
    "",
    `in scope: ${Object.keys(scope).sort().join(" ")}`,
  ].join("\n");
}
