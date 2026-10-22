// Browser entry point: the kernel, the model, the tool engine and the REPL
// wired to a canvas, with the chrome — toolbar, log, command line — floating
// over it as panels (see panels.ts). The command line is the real thing —
// a scoped evaluator over the command surface in replenv.ts — rather than
// the tool-name-only stand-in it replaced. A bare tool name still arms that
// tool, because that shortcut is genuinely the most common entry and reads
// better than arm("rectangle"); anything else is evaluated.

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model } from "./model.ts";
import { open as openModelText, save as saveModel, savedTools } from "./persist.ts";
import { carryIntoSession, toolSources } from "./toolsource.ts";
import { UndoStack } from "./undo.ts";
import { Repl, fmt } from "./repl.ts";
import { neocadScope } from "./replenv.ts";
import { ToolEngine, type View } from "./tools/engine.ts";
import { describePick, type Pick } from "./picking.ts";
import { ContextMenu, menuFor } from "./menu.ts";
import { toolUnavailable } from "./toolavail.ts";
import { frameMarker } from "./framemarker.ts";
import { constrainedBy, type Glyph } from "./glyphs.ts";
import { getToolCtor, listTools } from "./tools/tool.ts";
import { Panels, Toolbar, browserStorage, defaultLayout } from "./panels.ts";
import { toolIcon } from "./tools/icons.ts";
import { depth } from "./view.ts";
import { arcSamples, arcSegments } from "./arcgeom.ts";
import { curveFrame } from "./curveplane.ts";
import { createFaceLayer, paintFaces } from "./facelayer.ts";
import type { Entity } from "./model.ts";
import "./tools/point.ts";
import "./tools/line.ts";
import "./tools/rectangle.ts";
import "./tools/circle.ts";
import "./tools/circle3.ts";
import "./tools/arc.ts";
import "./tools/arc3.ts";
import "./tools/fillet.ts";
import "./tools/extrude.ts";
import "./tools/revolve.ts";
import "./tools/sketch.ts";

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d")!;
const facesCanvas = document.getElementById("faces") as HTMLCanvasElement;
/**
 * How a solid's faces are drawn, chosen once and here only: by a depth buffer
 * on their own canvas under the drawing, or — where the browser has no WebGL —
 * by the painter's, into the drawing's own canvas before everything else.
 */
const faceLayer = createFaceLayer(facesCanvas);
const cmdEl = document.getElementById("cmd") as HTMLInputElement;
const hoverEl = document.getElementById("hovertag")!;
const menuEl = document.getElementById("ctxmenu")!;
const toolbarEl = document.getElementById("toolbar")!;

/**
 * The panels are placed before the kernel loads, so the page never shows the
 * chrome in a heap while the WASM downloads. The toolbar's default height is
 * sized to however many tools are registered *when it is asked* — the built-ins
 * are all registered by the imports above, and one defined later at the command
 * line grows an untouched toolbar through `syncToolbar` below. The toolbar is
 * the one tray: it turns between column and row against the edges it is
 * dragged to, sized to the same count.
 */
const panels = new Panels(
  document.getElementById("viewwrap")!,
  (area) => defaultLayout(area, listTools().length),
  browserStorage(),
  { toolbar: () => listTools().length },
);

function log(msg: string, cls?: string) {
  const d = document.createElement("div");
  d.textContent = msg;
  if (cls) d.className = cls;
  logEl.appendChild(d);
  logEl.scrollTop = logEl.scrollHeight;
}

function sizeCanvas() {
  const dpr = devicePixelRatio || 1;
  const r = cv.getBoundingClientRect();
  cv.width = Math.max(1, Math.round(r.width * dpr));
  cv.height = Math.max(1, Math.round(r.height * dpr));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // The faces' canvas is the drawing's twin, pixel for pixel, or the two
  // pictures drift apart by a fraction of a pixel at every edge.
  facesCanvas.style.width = `${r.width}px`;
  facesCanvas.style.height = `${r.height}px`;
  facesCanvas.width = cv.width;
  facesCanvas.height = cv.height;
}

/**
 * The dimension the app's model has. Every door a model comes in by — a new
 * one, an opened file, an undo — goes through this, so a 2D file opened here
 * is lifted into 3D (see persist.ts) rather than swapping the app into 2D.
 */
const APP_DIM = 3;

async function main() {
  statusEl.textContent = "loading kernel…";
  await ensureKernelLoaded();
  log("kernel loaded");

  // `let`, not `const`: opening a saved file replaces the model outright, and
  // everything below reads through this binding so the swap reaches all of it.
  //
  // **Always 3D** — the owner's one-model decision: there is no 2D mode and no
  // second model type, and a "sketch" is just geometry on a frame's plane. The
  // camera starts square-on, looking down −z with +x right and +y up, so until
  // something turns it the app looks and behaves exactly as the 2D one did,
  // with every point at z = 0.
  let model = new Model(APP_DIM);
  const view: View = { ox: 0, oy: 0, scale: 3 };
  sizeCanvas();
  const r0 = cv.getBoundingClientRect();
  view.ox = r0.width / 2;
  view.oy = r0.height / 2;

  function render() {
    const r = cv.getBoundingClientRect();
    g.clearRect(0, 0, r.width, r.height);
    // No grid, and no origin marker either — deliberately (owner's call,
    // 2026-09-01). A grid is a picture of a world lattice, and a drawn origin
    // is an invitation to relate geometry to a global frame that this app is
    // in the process of not having: geometry is defined by its relations to
    // other geometry, and a coordinate frame, where wanted, is an entity the
    // user creates. The *user's* frames are drawn below, in the entity pass,
    // because a frame is geometry rather than annotation — it is a thing in
    // the drawing that can be clicked, dragged and deleted, not a note about
    // one. What is absent is only the frame nobody made.
    //
    // The cost of that decision is that an empty model is a black rectangle,
    // which the owner opened cold and read as broken. So an empty model says
    // what to do — see `emptyHint`.
    if (model.entities.size === 0) emptyHint(r.width, r.height);

    // What the cursor is over lights up — and hovering a *constraint* lights up
    // everything that constraint is about. That spread is the payoff of drawing
    // glyphs at all: hover `⊥` and see which two lines it means, rather than
    // reading two names off a tag and hunting for them.
    const hov = engine.hover;
    const lit = new Set<string>(
      hov ? (hov.kind === "relation" ? constrainedBy(model, hov.name) : [hov.name]) : [],
    );
    const stroke = (name: string) => (lit.has(name) ? "#e8a33d" : "#afc6d9");
    const weight = (name: string) => (lit.has(name) ? 2.2 : 1.4);

    // A solid's faces first, so everything after is drawn over them: back
    // faces culled, lit from the eye (see faces.ts), and which face is in
    // front answered per pixel by the depth layer under this canvas. The
    // entities — edges, points, glyphs — then go on top, hidden ones included,
    // so the sketch stays legible on a shaded solid and nothing a hand aims at
    // is ever behind a face. Faces are display only: they never pick or snap.
    if (faceLayer) faceLayer.draw(model, view, r.width, r.height);
    else paintFaces(g, model, view);

    // Painter's order, far to near, one depth per entity, for the wireframe on
    // top. Curves and frames are one pass and points a second on top, as they
    // always were: a point's dot and name are what a hand aims at, and must
    // not be painted over by an edge running behind them.
    const byDepth = <T extends Entity>(es: T[]) =>
      es.map((e) => ({ e, d: entityDepth(e) })).sort((a, b) => a.d - b.d).map((x) => x.e);
    const all = [...model.entities.values()];

    for (const e of byDepth(all.filter((x) => x.kind !== "point"))) {
      g.strokeStyle = stroke(e.name);
      g.lineWidth = weight(e.name);
      if (e.kind === "line") {
        const [ax, ay] = engine.worldToScreen(model.coords(e.refs[0]));
        const [bx, by] = engine.worldToScreen(model.coords(e.refs[1]));
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      } else if (e.kind === "circle" || e.kind === "arc") {
        // In its plane (see curveplane.ts): a circle the full turn round its
        // centre in its frame's orientation, an arc counter-clockwise from
        // start to end about its plane's +z (for a 2D arc, about +z, as
        // always). Drawn as the projection of a fine polyline, a quarter-pixel
        // from the true curve, which seen square-on is the circle or circular
        // arc and seen at an angle is an ellipse, or part of one — the very
        // curve picking and snapping aim at. (A circle was drawn as a sphere's
        // silhouette until it carried a plane: round from every angle, which
        // was the phase-2 seam showing.)
        const f = curveFrame(model, e);
        if (f) {
          const pts = arcSamples(f, arcSegments(f.sweep, f.r * view.scale)).map((w) => engine.worldToScreen(w));
          g.beginPath();
          g.moveTo(...pts[0]);
          for (const pt of pts.slice(1)) g.lineTo(...pt);
          // A circle's last sample is its first; closing the path joins them
          // as a corner like any other rather than leaving two butt ends.
          if (e.kind === "circle") g.closePath();
          g.stroke();
        }
      } else if (e.kind === "frame") {
        drawFrame(e.name, lit.has(e.name));
      }
    }

    g.font = "11px monospace";
    for (const e of byDepth(all.filter((x) => x.kind === "point"))) {
      const [sx, sy] = engine.worldToScreen(model.coords(e.name));
      g.fillStyle = stroke(e.name);
      g.beginPath(); g.arc(sx, sy, lit.has(e.name) ? 5 : 3.5, 0, Math.PI * 2); g.fill();
      g.fillText(e.name, sx + 6, sy - 6);
    }

    // After the entities so a mark is never hidden by the drawing it describes,
    // and before the tool overlay so a gesture in progress stays on top of
    // everything — the geometry being placed is what the eye should be on.
    renderGlyphs(hov?.kind === "relation" ? hov.name : null);
    engine.renderOverlay();
    syncToolbar();
  }

  /**
   * Brings the toolbar up to date with the registry and the armed tool. Neither
   * announces a change — the registry is a plain map, and a tool finishing its
   * gesture simply clears `engine.active` — so this is called from everywhere a
   * change can have just happened: every redraw, every canvas press and
   * release, every entry, Escape. It does DOM work only when something differs.
   */
  function syncToolbar() {
    if (toolbar.sync()) panels.apply();
  }

  /**
   * The words on an empty canvas: what it is, and every way in that exists.
   *
   * **Read off the model in the draw pass, and nothing else** — no flag set by
   * a clear or cleared by a click — so a fresh page, an undo back to nothing,
   * opening an empty file and deleting the last entity all show it without any
   * of them knowing it exists, and the first entity of any kind, a frame
   * included, takes it away. Muted, in the status line's colours: it is the
   * page explaining itself, and should stop being noticed once read.
   *
   * Drawn first, so a tool's preview, should one be armed before anything
   * exists, goes over it rather than under it.
   */
  function emptyHint(width: number, height: number) {
    const lines: [string, string, string][] = [
      ["13px", "#7a8b9b", "Nothing drawn yet."],
      ["12px", "#56697b", "Pick a tool from the toolbar, right-click for the menu, or type help() in the command line."],
    ];
    g.save();
    g.textAlign = "center";
    g.textBaseline = "middle";
    // Wrapped at its commas if the window is too narrow for the long line, so
    // a phone-width view still reads every way in rather than the middle of one.
    const rows: [string, string, string][] = [];
    for (const [size, colour, text] of lines) {
      g.font = `${size} "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      if (g.measureText(text).width <= width - 40) rows.push([size, colour, text]);
      else for (const part of text.split(/(?<=,) /)) rows.push([size, colour, part]);
    }
    const step = 20;
    let y = height / 2 - ((rows.length - 1) * step) / 2;
    for (const [size, colour, text] of rows) {
      g.font = `${size} "IBM Plex Mono", ui-monospace, Menlo, monospace`;
      g.fillStyle = colour;
      g.fillText(text, width / 2, y);
      y += step;
    }
    g.restore();
  }

  /**
   * How near the viewer an entity is, for the painter's sort: a point's own
   * depth, the middle of a line, the centre of a circle or arc, a frame's
   * origin. One number per entity is coarse — a long edge crossing a short one
   * can sort the wrong way at the crossing — and is enough: strokes are never
   * opaque to each other in any way that matters, and the only opaque things,
   * a solid's faces, are drawn first, by depth (see facelayer.ts).
   */
  function entityDepth(e: Entity): number {
    const at = (name: string) => depth(view, model.coords(name));
    switch (e.kind) {
      case "point": return at(e.name);
      case "line": return (at(e.refs[0]) + at(e.refs[1])) / 2;
      case "circle":
      case "arc": return at(e.center);
      case "frame": return at(e.origin);
    }
  }

  /**
   * A coordinate frame: short arrows out of its origin, along +x and +y — and
   * +z for a 3D frame — lettered, with the frame's name beside it the way a
   * point's name sits beside the point.
   *
   * **The default frame is drawn brighter**, because that difference is the
   * whole of what the pointer means: a bare `hor` is level with *that* frame
   * and not with any other one on the canvas. It is the only ambient state in
   * the app that changes what a typed word does, so it had better be visible
   * without asking.
   *
   * Arms are a fixed pixel length when they lie flat to the screen, and
   * foreshorten as the frame turns away (see framemarker.ts) — the refs'
   * distance carries no meaning — and the letters are what make a *tilted*
   * frame readable at a glance, which is exactly the case the whole package
   * exists for. An axis pointing straight at the viewer has no arm to draw,
   * and draws only its letter. Drawn in the entity pass, not with the glyphs: a
   * frame is a thing in the drawing that can be clicked, dragged and deleted,
   * not a note about one.
   */
  function drawFrame(name: string, lit: boolean) {
    const marker = frameMarker(model, view, name);
    if (!marker) return; // collapsed onto its own origin: no axes to draw
    const isDefault = model.defaultFrame === name;
    const colour = lit ? "#e8a33d" : isDefault ? "#c9dcec" : "#7b93a8";
    g.save();
    g.strokeStyle = colour;
    g.fillStyle = colour;
    g.lineWidth = lit ? 2.2 : isDefault ? 1.6 : 1.2;
    g.font = "10px ui-monospace, Menlo, monospace";
    const arms: [[number, number], string][] = [[marker.x, "x"], [marker.y, "y"]];
    if (marker.z) arms.push([marker.z, "z"]);
    for (const [tip, letter] of arms) {
      const [dx, dy] = [tip[0] - marker.origin[0], tip[1] - marker.origin[1]];
      const len = Math.hypot(dx, dy);
      if (!(len > 0.5)) {
        // Pointing at the viewer: a dot of an arm. The letter alone, just off
        // the origin, still says the axis is there and which way it faces.
        g.fillText(letter, marker.origin[0] + 4, marker.origin[1] + 12);
        continue;
      }
      const [ux, uy] = [dx / len, dy / len];
      g.beginPath();
      g.moveTo(marker.origin[0], marker.origin[1]);
      g.lineTo(tip[0], tip[1]);
      // An arrowhead as two strokes rather than a filled triangle: at this size
      // a fill reads as a blob, and the open head is what a datum triad uses.
      for (const s of [1, -1]) {
        const a = Math.atan2(uy, ux) + s * 0.4;
        g.moveTo(tip[0], tip[1]);
        g.lineTo(tip[0] - Math.cos(a) * 6, tip[1] - Math.sin(a) * 6);
      }
      g.stroke();
      g.fillText(letter, tip[0] + ux * 8 - 3, tip[1] + uy * 8 + 3.5);
    }
    g.font = "11px monospace";
    // Away from both arms, not at a fixed corner: the arms turn with the frame,
    // and a label pinned below-right would sit on top of one of them as soon as
    // the frame was tilted — which is the case this package is about. Opposite
    // their bisector is the one direction that stays clear whatever the tilt.
    const bx = (marker.x[0] + marker.y[0]) / 2 - marker.origin[0];
    const by = (marker.x[1] + marker.y[1]) / 2 - marker.origin[1];
    const bl = Math.hypot(bx, by) || 1;
    g.fillText(name, marker.origin[0] - (bx / bl) * 14 - 3, marker.origin[1] - (by / bl) * 14 + 4);
    g.restore();
  }

  /**
   * The constraint marks, in the same visual family as the hover tag: a small
   * rounded box, dim until the cursor is on it. Dim on purpose — there is one
   * of these per constraint and a drawing has many, so they have to read as an
   * annotation layer rather than as geometry.
   */
  function renderGlyphs(hoveredRelation: string | null) {
    const marks = engine.glyphs();
    if (!marks.length) return;
    g.save();
    g.font = "12px ui-monospace, Menlo, monospace";
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const mark of marks) if (mark.ends) dimensionLines(mark, mark.relation === hoveredRelation);
    for (const mark of marks) {
      const on = mark.relation === hoveredRelation;
      const [x, y] = mark.screen;
      roundedBox(x - mark.halfW, y - mark.halfH, mark.halfW * 2, mark.halfH * 2, 3);
      g.fillStyle = on ? "#20303f" : "#0e141bee";
      g.fill();
      g.strokeStyle = on ? "#e8a33d" : "#2c3d4f";
      g.lineWidth = 1;
      g.stroke();
      // A dimension is brighter than an annotation on purpose: it states
      // something the user asked for, where `∥` states something they may only
      // have implied. Onshape draws its dimensions the same way — a value
      // reads as part of the drawing, an inferred mark as a note about it.
      g.fillStyle = on ? "#e8a33d" : mark.isLabel ? "#cfe0ee" : "#8fa7bb";
      // Nudged down a hair: several of these marks (— ∥ ⊥ ∴) sit high in their
      // em box, and centring by metrics leaves them looking as though they are
      // escaping upward out of the box.
      g.fillText(mark.symbol, x, y + 0.5);
    }
    g.restore();
  }

  /**
   * A `dist` label's witness and dimension lines: a stub out from each end of
   * what is being measured, and a line between them at the label's own level,
   * with an arrow into each end.
   */
  function dimensionLines(mark: Glyph, on: boolean) {
    const [a, b] = mark.ends!;
    const [lx, ly] = mark.screen;
    // How far out the dimension line sits: the label's own offset, projected
    // back onto the perpendicular so the line passes through the label.
    const px = b[1] - a[1], py = a[0] - b[0];
    const len = Math.hypot(px, py);
    if (!(len > 1e-6)) return;
    const [ux, uy] = [px / len, py / len];
    const off = (lx - a[0]) * ux + (ly - a[1]) * uy;
    const at = (p: [number, number], t: number): [number, number] => [p[0] + ux * t, p[1] + uy * t];

    g.save();
    g.strokeStyle = on ? "#e8a33d" : "#33485c";
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    // Witness lines start clear of the geometry, the way a draughtsman's do —
    // touching the point would make them read as part of the drawing.
    for (const end of [a, b]) {
      const gap = off >= 0 ? 4 : -4;
      g.moveTo(...at(end, gap));
      g.lineTo(...at(end, off + gap));
    }
    g.moveTo(...at(a, off));
    g.lineTo(...at(b, off));
    g.stroke();
    // Arrowheads, pointing outward into the witness lines.
    const dx = (b[0] - a[0]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dy = (b[1] - a[1]) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    g.fillStyle = on ? "#e8a33d" : "#40566b";
    for (const [end, s] of [[a, 1], [b, -1]] as const) {
      const tip = at(end, off);
      g.beginPath();
      g.moveTo(tip[0], tip[1]);
      g.lineTo(tip[0] + s * dx * 7 + ux * 2.5, tip[1] + s * dy * 7 + uy * 2.5);
      g.lineTo(tip[0] + s * dx * 7 - ux * 2.5, tip[1] + s * dy * 7 - uy * 2.5);
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  /** A rounded rectangle path. `ctx.roundRect` is newer than this needs to be. */
  function roundedBox(x: number, y: number, w: number, h: number, r: number) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  function solveAndRender() {
    const report = model.solve();
    statusEl.textContent = report.solved ? "SOLVED" : `CONFLICT: ${report.offenders.map((o) => o.label).join(", ")}`;
    statusEl.className = report.solved ? "solved" : "bad";
    render();
    return report;
  }

  /**
   * Clicking geometry drops its *name* into the command line rather than
   * accumulating a selection somewhere. cellwork's idea, and it fits here even
   * better: every relation takes entity names, so clicking two lines writes
   * most of `fillet(` for you. Nothing to clear, nothing to get out of sync.
   */
  function insertName(name: string) {
    const v = cmdEl.value;
    // Separate arguments with a comma, because these are function calls: two
    // clicks after `dist(` should leave `dist("p1", "p2"`, ready to finish,
    // rather than something that still needs punctuating by hand.
    const needsComma = /[\w"\]]\s*$/.test(v);
    cmdEl.value = v + (needsComma ? ", " : "") + `"${name}"`;
    cmdEl.focus();
    log(`${name} → command line`, "out");
  }

  /**
   * Puts an unfinished command in the line for the user to complete — what the
   * menu's Set value… does, since only the user knows the number.
   *
   * It **replaces** what is there rather than appending, which is the opposite
   * of `insertName` and right for the opposite reason. A name is another
   * argument to whatever is being composed; a partial command is a different
   * command, and `dist("p1", set("d4.value", ` is not a thing anyone was
   * typing. Nothing is submitted either way — the seam the menu's `run` goes
   * through is deliberately not this one.
   */
  function typeCommand(text: string) {
    cmdEl.value = text;
    cmdEl.focus();
    // The caret at the end, so the next keystroke is the number. Chrome puts it
    // where it last was on a programmatic value change, which for a line that
    // was previously empty is position 0 — i.e. in front of the whole command.
    cmdEl.setSelectionRange(text.length, text.length);
    log(`${text}… → command line`, "out");
  }

  // The canvas follows its own box. Since the chrome became floating panels
  // nothing inside the page reflows it any more — the log used to, taking
  // height as it filled — but the box still changes with the window, and a
  // bitmap left at its old aspect quietly squashes the drawing: circles come
  // out as ellipses, which no assertion catches and one glance does.
  new ResizeObserver(() => {
    sizeCanvas();
    render();
  }).observe(cv);

  // ---- undo ----------------------------------------------------------------
  //
  // The stack holds serialised models and nothing else (see undo.ts). All the
  // judgement lives here, in the host, because "what is one undo step" is a
  // question about the *interface* — a claim about what the user thinks they
  // just did — and nothing below this file is entitled to an opinion on it.
  //
  // The policy is one comparison: snapshot before the action, snapshot after,
  // and record a step only if the two differ. That is what keeps `ls()`,
  // `help()`, a click that picked nothing and a tool's first click out of the
  // history without any of them having to be enumerated. Being the same text
  // `save()` writes, a snapshot also compares by value for free.

  const undoStack = new UndoStack<string>();
  const snapshot = () => saveModel(model, false);

  let actionDepth = 0;
  let actionBefore = "";
  /** Set by undo()/redo(): they move through the history, they do not add to it. */
  let movedHistory = false;

  function beginUserAction() {
    // Only the outermost bracket counts. A command entry that opens a file, or
    // a pointer event that lands mid-`await` in the REPL, would otherwise
    // record the same edit twice.
    if (actionDepth++ === 0) {
      actionBefore = snapshot();
      movedHistory = false;
    }
  }

  /**
   * Closes the bracket, and **returns whether the model changed** — the same
   * comparison the undo stack is deciding on, handed back rather than computed
   * a second time somewhere else.
   *
   * That answer has a second customer: a command entry that changed the model
   * has to re-solve, or the header goes on reporting the verdict from before
   * whatever was just typed. Enumerating which commands are edits is exactly
   * what this file has been avoiding since undo was written, and there is no
   * reason to start now when the arithmetic is already here.
   *
   * `false` for a nested close (only the outermost bracket has an answer) and
   * for a history move, which restored a model that `swapModel` has already
   * solved and drawn.
   */
  function endUserAction(): boolean {
    if (actionDepth === 0) return false; // defensive: an unbalanced `after` records nothing
    if (--actionDepth > 0) return false;
    if (movedHistory) { movedHistory = false; return false; }
    return undoStack.pushIfChanged(actionBefore, snapshot());
  }

  /** Runs `fn` as one undoable step. */
  function asUserAction<T>(fn: () => T): T {
    beginUserAction();
    try {
      return fn();
    } finally {
      endUserAction();
    }
  }

  function step(direction: "undo" | "redo"): string {
    const target = direction === "undo" ? undoStack.undo(snapshot()) : undoStack.redo(snapshot());
    if (target === undefined) return `nothing to ${direction}`;
    // Flagged before the swap, not after: `swapModel` re-enters this file
    // (it cancels any gesture, which can close a user action), and the flag has
    // to already be set by the time it does.
    movedHistory = true;
    swapModel(openModelText(target, APP_DIM));
    return `${direction === "undo" ? "undid" : "redid"} — ${undoStack.depth} back, ${undoStack.redoDepth} forward`;
  }

  /**
   * The context menu, and the seam it goes through.
   *
   * **`run` is `submit` — the very function the Enter key calls** — and finding
   * that seam was the design question this package had to answer. A menu item is
   * specified as "a shortcut to a command the log shows", which is a statement
   * about *machinery*, not about outcome: it has to log the entry, push it onto
   * the recall history, bracket it as one undo step, and re-solve if it changed
   * anything. All four of those already live in `submit` and nowhere else, so
   * anything short of calling it would be a second, slightly different answer to
   * what typing a command means — and the two would drift.
   *
   * The alternative considered and rejected was writing the text into `#cmd` and
   * dispatching a synthetic Enter. That reaches the same function by pretending
   * to be a keyboard, which makes the seam invisible to a reader, destroys
   * whatever the user had half-typed, and would break the moment the input's
   * keydown handling changed. One named function passed to the menu is the
   * smaller and more honest hook.
   */
  const menu = new ContextMenu(menuEl, {
    run: (command) => void submit(command),
    insert: insertName,
    type: typeCommand,
  });

  /**
   * The toolbar goes through the same seam as the menu, for the same reasons:
   * a button types `arm("line")` into `submit`, so the log shows it, the
   * recall history has it, and arming by button is in every respect arming by
   * typing — journal and undo included, which for `arm` is nothing at all.
   *
   * Availability is the menu's rule too, read through `model` (the binding a
   * file open swaps) on every sync — so a curve tool greys out in the same
   * render that its Circle item would, for the same sentence.
   *
   * A glyph is a built-in's own, by name, and every other tool's the generic
   * one (see tools/icons.ts for why by name).
   */
  const toolbar = new Toolbar(toolbarEl, {
    tools: listTools,
    icon: toolIcon,
    active: () => engine.active?.name ?? null,
    unavailable: (tool) => toolUnavailable(model, tool),
    run: (command) => void submit(command),
  });

  const engine = new ToolEngine(model, cv, view, {
    onSolveRender: solveAndRender,
    onRenderOnly: render,
    onPick: (pick) => insertName(pick.name),
    onUserAction: (phase) => (phase === "before" ? beginUserAction() : endUserAction()),
    // A tool refusing a gesture ("those three points lie on one line") is the
    // user's business, not the console's — same channel an entry's error uses.
    onLog: (line) => log(line, "err"),
    // A tool whose commit is a command types it, as the menu does — the sketch
    // tool's `plane(a, b, c)` — so it is logged, recalled and undone as typed.
    onRun: (command) => void submit(command),
    onContextMenu: (pick, sx, sy) => {
      // The tag and the menu would otherwise sit on top of one another, both
      // naming the same thing — and the tag cannot update while the cursor is
      // over the menu, so it would go stale as well as redundant.
      hoverEl.hidden = true;
      // On empty canvas the menu is also told which region the click is
      // inside, for "Sketch on this face" — asked here, where the camera is,
      // so the menu stays a pure function of what it is handed.
      menu.show(menuFor(model, pick, pick ? null : engine.regionAt(sx, sy)), sx, sy);
    },
  });

  /**
   * **A press on the canvas keeps the canvas for the whole gesture.** The engine
   * captures the pointer for a drag, a box and a pan, but not while a tool is
   * armed — and with panels floating over the drawing, a tool's press-drag that
   * wandered over the log would otherwise hand its moves and its release to the
   * log, leaving the tool waiting for an up that never comes. Capturing here, on
   * every press, is what makes "a drag that starts on the canvas never crosses
   * to a panel" true for every gesture the engine has or will have, without the
   * engine having to know panels exist. The panels capture their own presses
   * (see panels.ts), which is the other half.
   *
   * Registered after the engine's listener, so it runs after the engine has
   * dispatched the press — and so does the toolbar sync on release, by which
   * time a tool that finished on that click has cleared `engine.active`.
   */
  cv.addEventListener("pointerdown", (e) => {
    if (!cv.hasPointerCapture(e.pointerId)) cv.setPointerCapture(e.pointerId);
    syncToolbar();
  });
  cv.addEventListener("pointerup", syncToolbar);

  // The hover tag follows the cursor and names whatever is under it.
  cv.addEventListener("pointermove", (e) => {
    const pick = engine.hover;
    // No tag while a tool is armed: the snap marker is saying the useful thing
    // by then, and a tag left over from before the gesture would follow the
    // cursor showing a name that is no longer under it.
    // `model.has`, not `model.entities.has`: a hovered glyph is a *relation*
    // pick, and the tag names it exactly as it names a point.
    if (!pick || engine.active || !model.has(pick.name)) {
      hoverEl.hidden = true;
      return;
    }
    const rect = cv.getBoundingClientRect();
    hoverEl.hidden = false;
    hoverEl.style.left = `${e.clientX - rect.left + 12}px`;
    hoverEl.style.top = `${e.clientY - rect.top + 12}px`;
    hoverEl.textContent = describePick(model, pick);
  });
  cv.addEventListener("pointerleave", () => { hoverEl.hidden = true; });

  function handles() {
    return {
      model,
      view,
      // The command surface captures the source of a tool defined at the
      // command line, and the entry text is something only the evaluator
      // knows. `repl` is initialised on the next line but this is only ever
      // called from inside an entry, by which time it exists.
      currentEntry: () => repl.entry,
      // The tool-voice channel, for `open()` mentioning what a file carries.
      log: (line: string) => log(line, "out"),
      toolSources,
      // Measured fresh on every ask, not cached: the window can be resized at
      // any time, and a size read once at startup would put "the middle of the
      // view" somewhere that is no longer the middle of what is on screen.
      viewSize: (): [number, number] => {
        const r = cv.getBoundingClientRect();
        return [r.width, r.height];
      },
      arm: (name: string, options?: Record<string, unknown>) => engine.arm(name, options),
      pick: () => engine.hover?.name ?? null,
      snapping: (on?: boolean) => {
        if (on !== undefined) engine.snapping = on;
        return engine.snapping;
      },
      glyphs: (on?: boolean) => {
        if (on !== undefined) {
          engine.glyphsOn = on;
          // A hover held on a glyph that has just been switched off would leave
          // the tag naming something no longer on screen, and the entities it
          // constrains lit with nothing to explain why.
          if (!on && engine.hover?.kind === "relation") engine.hover = null;
          render();
        }
        return engine.glyphsOn;
      },
      cancel: () => engine.cancel(),
      refresh: () => { solveAndRender(); },
      // The chrome's arrangement. Typed through `submit` like everything else,
      // and so bracketed as a user action — which records nothing, because the
      // model is untouched: layout is the viewer's, not the drawing's.
      layout: (command?: string) => {
        if (command === undefined) return panels.report();
        if (command === "reset") return panels.reset();
        throw new Error(`layout() reports and layout("reset") restores the defaults; "${command}" is neither`);
      },
      solve: () => solveAndRender(),
      // Opening a file is one undo step, so opening the wrong one is one Ctrl+Z
      // from harmless. (Typed at the command line this is already inside
      // `submit`'s bracket; the bracket here is what covers `openFile()`, whose
      // work happens in an event handler long after the entry returned.)
      openModel: (json: string) => asUserAction(() => swapModel(openModelText(json, APP_DIM))),
      undo: () => step("undo"),
      redo: () => step("redo"),
      download: (json: string, filename: string) => {
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      },
      openFile: () => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", async () => {
          const file = input.files?.[0];
          if (!file) return;
          try {
            const text = await file.text();
            asUserAction(() => swapModel(openModelText(text, APP_DIM)));
            log(`opened ${file.name}`, "out");
            // The picker is the other door to the same act, so it says the
            // same thing about tools the file carries — through the same
            // function `open()` uses, or the two would drift into two answers
            // to what opening a file means. Nothing here evaluates anything.
            for (const line of carryIntoSession(savedTools(text), toolSources)) log(line, "out");
          } catch (err) {
            log(`${err instanceof Error ? err.message : err}`, "err");
          }
        });
        input.click();
      },
    };
  }

  const repl = new Repl(neocadScope(handles()));

  /**
   * Points everything at a different model. The tool engine and the command
   * scope both hold their own reference, so both are re-pointed here — the
   * REPL's names are redefined rather than the whole REPL being rebuilt, so
   * anything the user bound at the command line survives opening a file.
   */
  function swapModel(next: Model) {
    model = next;
    // An open menu names entities of the model being replaced, so every command
    // on it is about to be a lie. Undo swaps the model, which is exactly the
    // case: Ctrl+Z with a menu open must not leave `del("l3")` offered for an
    // `l3` that no longer exists.
    menu.close();
    engine.cancel();
    engine.model = next;
    repl.define(neocadScope(handles()));
    exposeDebugHook();
    solveAndRender();
  }

  function exposeDebugHook() {
    (window as unknown as { __neocad: unknown }).__neocad = { model, engine, repl, render, faces: faceLayer ? "depth" : "painter's" }; // debug/automation hook
  }
  exposeDebugHook();

  const history: string[] = [];
  let historyAt = 0;

  async function submit(src: string) {
    log(`> ${src}`, "in");
    history.push(src);
    historyAt = history.length;

    // A bare tool name arms it — the one shortcut, and only when the whole
    // entry is an identifier that is actually a registered tool.
    if (/^[A-Za-z_$][\w$]*$/.test(src) && getToolCtor(src)) {
      try {
        engine.arm(src);
        log(`armed: ${src}`, "out");
      } catch (err) {
        log(String(err instanceof Error ? err.message : err), "err");
      }
      syncToolbar();
      return;
    }

    // One entry is one undo step — if it changed anything. The comparison is
    // what decides: `ls()` and `help()` leave the model identical and record
    // nothing, `pt(0,0)` does not and records one. An entry that draws four
    // points is deliberately one step too, because one thing was typed.
    beginUserAction();
    let changed = false;
    try {
      const result = await repl.eval(src);
      for (const line of result.output) log(line, "out");
      if (!result.ok) log(`${result.error!.name}: ${result.error!.message}`, "err");
      else if (result.value !== undefined) log(fmt(result.value), "out");
    } finally {
      changed = endUserAction();
    }

    // **An entry that changed the model re-solves**, the way a tool, a drag and
    // `del` already do. Without it `dist("a","b",50)` added its residual, redrew
    // and left the header reading `SOLVED` over a drawing that plainly violated
    // what had just been typed — the stale-readout family this project has been
    // bitten by before. Onshape's continuous solve, and cellwork's, both agree.
    //
    // Which entries those are is *not* enumerated anywhere: it is the undo
    // bracket's own snapshot comparison, reused. So `ls()` and `help()` cost
    // nothing, and any relation anyone ever adds is covered without being
    // listed. A redundant `solve()` typed afterwards is harmless, which is why
    // the specs that still type one were left alone.
    if (changed) solveAndRender();
    else render();
  }

  cmdEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && history.length) {
      e.preventDefault();
      historyAt = Math.max(0, historyAt - 1);
      cmdEl.value = history[historyAt] ?? "";
    } else if (e.key === "ArrowDown" && history.length) {
      e.preventDefault();
      historyAt = Math.min(history.length, historyAt + 1);
      cmdEl.value = history[historyAt] ?? "";
    } else if (e.key === "Enter") {
      const src = cmdEl.value.trim();
      cmdEl.value = "";
      if (src) void submit(src);
    }
  });

  /**
   * Escape abandons whatever gesture is in progress. **On `window`, not on the
   * command input**, for the reason the box select found: pressing the mouse on
   * the canvas blurs the input (a canvas is not focusable, so focus falls to
   * the body), so a binding on the input is deaf during exactly the gestures
   * Escape exists to abandon. It still fires while the command line has focus,
   * because keydown bubbles — this widens where the key works and narrows
   * nothing.
   *
   * No carve-out for text in the input, unlike Ctrl+Z below: Escape has never
   * meant anything to a text field here, so there is nothing to be ambiguous
   * with.
   */
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    // The menu first, and then nothing else. Escape means "undo the last thing
    // that appeared", and with a menu on screen that is the menu — cancelling
    // the gesture underneath it as well would abandon a half-drawn rectangle
    // that the user was only right-clicking to look away from.
    if (menu.close()) {
      log("menu closed", "out");
      return;
    }
    engine.cancel();
    syncToolbar();
    log("cancelled", "out");
  });

  /**
   * **Typing with nothing editable focused types into the command line.** A
   * press on the canvas, the toolbar or a panel's strip leaves the focus on the
   * body or where it was, and the first keystroke after it should not vanish.
   * Focusing the input during `keydown` is enough: the character is inserted
   * into whatever holds the focus once the keydown has been dispatched.
   *
   * Only printable keys without a modifier — Escape, Ctrl+Z and the arrows keep
   * their own meanings — and never when something editable already has the
   * focus, which is that thing's keystroke.
   */
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    const at = document.activeElement as HTMLElement | null;
    if (at && (at.isContentEditable || at instanceof HTMLInputElement || at instanceof HTMLTextAreaElement)) return;
    cmdEl.focus();
  });

  /**
   * Ctrl+Z / Cmd+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo. On `window` rather
   * than on the canvas, because the keystroke means the same thing wherever the
   * focus happens to be — and the focus is nearly always the command line,
   * which is the one place a canvas-scoped binding would never fire.
   *
   * The carve-out: **while the command input holds uncommitted text, Ctrl+Z is
   * the browser's**, and it edits the text. A half-typed command on screen makes
   * the keystroke ambiguous in a way nothing can resolve from the outside, and
   * undoing the model out from under someone mid-sentence is the worse of the
   * two wrong answers. An empty input is the signal that the keystroke is meant
   * for the drawing. This is deliberately about the text and not about the
   * focus: text left sitting in the box is visible, and what is visible is what
   * a user is reasoning from.
   */
  window.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const undoing = key === "z" && !e.shiftKey;
    const redoing = (key === "z" && e.shiftKey) || key === "y";
    if (!undoing && !redoing) return;
    if (cmdEl.value !== "") return; // the text's undo, not the model's
    e.preventDefault();
    log(step(undoing ? "undo" : "redo"), "out");
  });

  render();
  statusEl.textContent = "ready — type help(), a tool name, or any expression";
  log("type help() for the command surface");
  cmdEl.focus();
}

main().catch((e) => {
  statusEl.textContent = "ERROR — see log";
  statusEl.className = "bad";
  log(String((e && e.stack) || e), "err");
  console.error(e);
});
