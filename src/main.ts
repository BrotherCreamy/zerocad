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
import { getToolCtor } from "./tools/tool.ts";
import "./tools/point.ts";
import "./tools/line.ts";
import "./tools/rectangle.ts";
import "./tools/circle.ts";
import "./tools/arc.ts";
import "./tools/fillet.ts";

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d")!;
const cmdEl = document.getElementById("cmd") as HTMLInputElement;
const hoverEl = document.getElementById("hovertag")!;

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
    g.strokeStyle = "#131c26";
    g.beginPath();
    for (let x = view.ox % (view.scale * 10); x < r.width; x += view.scale * 10) { g.moveTo(x, 0); g.lineTo(x, r.height); }
    for (let y = view.oy % (view.scale * 10); y < r.height; y += view.scale * 10) { g.moveTo(0, y); g.lineTo(r.width, y); }
    g.stroke();

    const hovered = engine.hover?.name;
    const stroke = (name: string) => (name === hovered ? "#e8a33d" : "#afc6d9");
    const weight = (name: string) => (name === hovered ? 2.2 : 1.4);

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
      }
    }

    g.font = "11px monospace";
    for (const e of model.entities.values()) {
      if (e.kind !== "point") continue;
      const [sx, sy] = engine.worldToScreen(model.coords(e.name));
      g.fillStyle = stroke(e.name);
      g.beginPath(); g.arc(sx, sy, e.name === hovered ? 5 : 3.5, 0, Math.PI * 2); g.fill();
      g.fillText(e.name, sx + 6, sy - 6);
    }
    engine.renderOverlay();
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
  function insertToken(pick: Pick) {
    const v = cmdEl.value;
    // Separate arguments with a comma, because these are function calls: two
    // clicks after `dist(` should leave `dist("p1", "p2"`, ready to finish,
    // rather than something that still needs punctuating by hand.
    const needsComma = /[\w"\]]\s*$/.test(v);
    cmdEl.value = v + (needsComma ? ", " : "") + `"${pick.name}"`;
    cmdEl.focus();
    log(`${pick.name} → command line`, "out");
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

  function endUserAction() {
    if (actionDepth === 0) return; // defensive: an unbalanced `after` records nothing
    if (--actionDepth > 0) return;
    if (movedHistory) { movedHistory = false; return; }
    undoStack.pushIfChanged(actionBefore, snapshot());
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

  const engine = new ToolEngine(model, cv, view, {
    onSolveRender: solveAndRender,
    onRenderOnly: render,
    onPick: insertToken,
    onUserAction: (phase) => (phase === "before" ? beginUserAction() : endUserAction()),
  });

  // The hover tag follows the cursor and names whatever is under it.
  cv.addEventListener("pointermove", (e) => {
    const pick = engine.hover;
    // No tag while a tool is armed: the snap marker is saying the useful thing
    // by then, and a tag left over from before the gesture would follow the
    // cursor showing a name that is no longer under it.
    if (!pick || engine.active || !model.entities.has(pick.name)) {
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
      arm: (name: string, options?: Record<string, unknown>) => engine.arm(name, options),
      pick: () => engine.hover?.name ?? null,
      snapping: (on?: boolean) => {
        if (on !== undefined) engine.snapping = on;
        return engine.snapping;
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
    try {
      const result = await repl.eval(src);
      for (const line of result.output) log(line, "out");
      if (!result.ok) log(`${result.error!.name}: ${result.error!.message}`, "err");
      else if (result.value !== undefined) log(fmt(result.value), "out");
      render();
    } finally {
      endUserAction();
    }
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
    } else if (e.key === "Escape") {
      engine.cancel();
      log("cancelled", "out");
    } else if (e.key === "Enter") {
      const src = cmdEl.value.trim();
      cmdEl.value = "";
      if (src) void submit(src);
    }
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
