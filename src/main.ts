// Browser entry point: the kernel, the model, the tool engine and the REPL
// wired to a canvas. The command line at the bottom is now the real thing —
// a scoped evaluator over the command surface in replenv.ts — rather than
// the tool-name-only stand-in it replaced. A bare tool name still arms that
// tool, because that shortcut is genuinely the most common entry and reads
// better than arm("rectangle"); anything else is evaluated.

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model } from "./model.ts";
import { open as openModelText, save as saveModel } from "./persist.ts";
import { UndoStack } from "./undo.ts";
import { Repl, fmt } from "./repl.ts";
import { neocadScope } from "./replenv.ts";
import { ToolEngine, type View } from "./tools/engine.ts";
import { describePick, type Pick } from "./picking.ts";
import { ContextMenu, menuFor } from "./menu.ts";
import { frameMarker } from "./framemarker.ts";
import { constrainedBy, type Glyph } from "./glyphs.ts";
import { getToolCtor } from "./tools/tool.ts";
import "./tools/point.ts";
import "./tools/line.ts";
import "./tools/rectangle.ts";
import "./tools/circle.ts";
import "./tools/circle3.ts";
import "./tools/arc.ts";
import "./tools/arc3.ts";
import "./tools/fillet.ts";

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d")!;
const cmdEl = document.getElementById("cmd") as HTMLInputElement;
const hoverEl = document.getElementById("hovertag")!;
const menuEl = document.getElementById("ctxmenu")!;

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
}

async function main() {
  statusEl.textContent = "loading kernel…";
  await ensureKernelLoaded();
  log("kernel loaded");

  // `let`, not `const`: opening a saved file replaces the model outright, and
  // everything below reads through this binding so the swap reaches all of it.
  let model = new Model(2);
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

    for (const e of model.entities.values()) {
      g.strokeStyle = stroke(e.name);
      g.lineWidth = weight(e.name);
      if (e.kind === "line") {
        const [ax, ay] = engine.worldToScreen(model.coords(e.refs[0]));
        const [bx, by] = engine.worldToScreen(model.coords(e.refs[1]));
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
      } else if (e.kind === "circle") {
        const [cx, cy] = engine.worldToScreen(model.coords(e.center));
        g.beginPath(); g.arc(cx, cy, model.radius(e.name) * view.scale, 0, Math.PI * 2); g.stroke();
      } else if (e.kind === "arc") {
        // Screen y runs the other way from world y, so a world-space CCW
        // sweep is drawn clockwise here — hence the negated angles and the
        // `true` sweep flag.
        const ctr = model.coords(e.center);
        const [cx, cy] = engine.worldToScreen(ctr);
        const ang = (n: string) => {
          const p = model.coords(n);
          return Math.atan2(p[1] - ctr[1], p[0] - ctr[0]);
        };
        g.beginPath();
        g.arc(cx, cy, model.radius(e.name) * view.scale, -ang(e.start), -ang(e.end), true);
        g.stroke();
      } else if (e.kind === "frame") {
        drawFrame(e.name, lit.has(e.name));
      }
    }

    g.font = "11px monospace";
    for (const e of model.entities.values()) {
      if (e.kind !== "point") continue;
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
  }

  /**
   * A coordinate frame: two short arrows out of its origin, along +x and +y,
   * lettered, with the frame's name beside it the way a point's name sits
   * beside the point.
   *
   * **The default frame is drawn brighter**, because that difference is the
   * whole of what the pointer means: a bare `hor` is level with *that* frame
   * and not with any other one on the canvas. It is the only ambient state in
   * the app that changes what a typed word does, so it had better be visible
   * without asking.
   *
   * Arms are a fixed pixel length (see framemarker.ts) — the x-ref's distance
   * carries no meaning — and the letters are what make a *tilted* frame
   * readable at a glance, which is exactly the case the whole package exists
   * for. Drawn in the entity pass, not with the glyphs: a frame is a thing in
   * the drawing that can be clicked, dragged and deleted, not a note about one.
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
    for (const [tip, letter] of arms) {
      const [dx, dy] = [tip[0] - marker.origin[0], tip[1] - marker.origin[1]];
      const len = Math.hypot(dx, dy);
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

  // The canvas has to follow its own box, not just window resizes: the log
  // pane grows as commands are typed and takes height from the viewport. Left
  // to a resize listener the bitmap keeps its old aspect and the drawing is
  // quietly squashed — circles come out as ellipses, which is the sort of
  // thing no assertion catches and one glance does.
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
    swapModel(openModelText(target));
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

  const engine = new ToolEngine(model, cv, view, {
    onSolveRender: solveAndRender,
    onRenderOnly: render,
    onPick: (pick) => insertName(pick.name),
    onUserAction: (phase) => (phase === "before" ? beginUserAction() : endUserAction()),
    // A tool refusing a gesture ("those three points lie on one line") is the
    // user's business, not the console's — same channel an entry's error uses.
    onLog: (line) => log(line, "err"),
    onContextMenu: (pick, sx, sy) => {
      // The tag and the menu would otherwise sit on top of one another, both
      // naming the same thing — and the tag cannot update while the cursor is
      // over the menu, so it would go stale as well as redundant.
      hoverEl.hidden = true;
      menu.show(menuFor(model, pick), sx, sy);
    },
  });

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
      // Measured fresh on every ask, not cached: the log pane grows as
      // commands are typed and takes its height from the canvas, so a size
      // read once at startup would put "the middle of the view" steadily
      // below the middle of what is actually on screen.
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
      solve: () => solveAndRender(),
      // Opening a file is one undo step, so opening the wrong one is one Ctrl+Z
      // from harmless. (Typed at the command line this is already inside
      // `submit`'s bracket; the bracket here is what covers `openFile()`, whose
      // work happens in an event handler long after the entry returned.)
      openModel: (json: string) => asUserAction(() => swapModel(openModelText(json))),
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
            asUserAction(() => swapModel(openModelText(text)));
            log(`opened ${file.name}`, "out");
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
    (window as unknown as { __neocad: unknown }).__neocad = { model, engine, repl }; // debug/automation hook
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
    log("cancelled", "out");
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
