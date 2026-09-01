// Browser entry point: the kernel, the model, the tool engine and the REPL
// wired to a canvas. The command line at the bottom is now the real thing —
// a scoped evaluator over the command surface in replenv.ts — rather than
// the tool-name-only stand-in it replaced. A bare tool name still arms that
// tool, because that shortcut is genuinely the most common entry and reads
// better than arm("rectangle"); anything else is evaluated.

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model } from "./model.ts";
import { open as openModelText } from "./persist.ts";
import { Repl, fmt } from "./repl.ts";
import { neocadScope } from "./replenv.ts";
import { ToolEngine, type View } from "./tools/engine.ts";
import { getToolCtor } from "./tools/tool.ts";
import "./tools/point.ts";
import "./tools/rectangle.ts";
import "./tools/circle.ts";
import "./tools/arc.ts";

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d")!;
const cmdEl = document.getElementById("cmd") as HTMLInputElement;

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
  cv.width = r.width * dpr;
  cv.height = r.height * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", sizeCanvas);

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

    g.strokeStyle = "#afc6d9";
    g.lineWidth = 1.4;
    for (const e of model.entities.values()) {
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

    g.fillStyle = "#afc6d9";
    g.font = "11px monospace";
    for (const e of model.entities.values()) {
      if (e.kind !== "point") continue;
      const [sx, sy] = engine.worldToScreen(model.coords(e.name));
      g.beginPath(); g.arc(sx, sy, 3.5, 0, Math.PI * 2); g.fill();
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

  const engine = new ToolEngine(model, cv, view, { onSolveRender: solveAndRender, onRenderOnly: render });

  function handles() {
    return {
      model,
      view,
      arm: (name: string) => engine.arm(name),
      cancel: () => engine.cancel(),
      refresh: () => { solveAndRender(); },
      solve: () => solveAndRender(),
      openModel: (json: string) => swapModel(openModelText(json)),
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
            swapModel(openModelText(await file.text()));
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

    const result = await repl.eval(src);
    for (const line of result.output) log(line, "out");
    if (!result.ok) log(`${result.error!.name}: ${result.error!.message}`, "err");
    else if (result.value !== undefined) log(fmt(result.value), "out");
    render();
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
