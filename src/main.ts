// Interactive milestone: the tool-authoring layer wired to a real canvas.
// The text input here is a deliberately temporary stand-in for the real
// REPL (a scoped JS/TS evaluator) — it just type-switches the armed tool
// by name for now, so the pointer-event/render pipeline is testable before
// the REPL's own design gets its turn. See STATUS.md.

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model } from "./model.ts";
import { ToolEngine, type View } from "./tools/engine.ts";
import "./tools/point.ts";
import "./tools/rectangle.ts";

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const g = cv.getContext("2d")!;
const cmdEl = document.getElementById("cmd") as HTMLInputElement;

function log(msg: string) {
  const d = document.createElement("div");
  d.textContent = msg;
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

  const model = new Model(2);
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
      if (e.kind !== "line") continue;
      const [ax, ay] = engine.worldToScreen(model.coords(e.refs[0]));
      const [bx, by] = engine.worldToScreen(model.coords(e.refs[1]));
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
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
  }

  const engine = new ToolEngine(model, cv, view, { onSolveRender: solveAndRender, onRenderOnly: render });
  (window as unknown as { __neocad: unknown }).__neocad = { model, engine }; // debug hook, not for production use

  cmdEl.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const name = cmdEl.value.trim();
    cmdEl.value = "";
    if (!name) return;
    try {
      engine.arm(name);
      log(`armed: ${name}`);
    } catch (err) {
      log(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  render();
  statusEl.textContent = "ready — type a tool name (point, rectangle) + Enter, then use the canvas";
  cmdEl.focus();
}

main().catch((e) => {
  statusEl.textContent = "ERROR — see log";
  statusEl.className = "bad";
  log(String((e && e.stack) || e));
  console.error(e);
});
