// First real browser milestone: load the WASM kernel over fetch (the actual
// browser path, not the Node test's byte-buffer path), build a small 2D
// model, solve it, and render it. Deliberately minimal — this is here to
// prove the fetch/WASM/canvas path works end to end, not to be the REPL or
// tool-authoring layer (those are still ahead; see STATUS.md).

import { ensureKernelLoaded } from "./kernel/problem.ts";
import { Model } from "./model.ts";
import { dist, fix, midpoint } from "./relations/basic.ts";

const statusEl = document.getElementById("status")!;
const logEl = document.getElementById("log")!;
const cv = document.getElementById("cv") as HTMLCanvasElement;
const ctx = cv.getContext("2d")!;

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
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener("resize", sizeCanvas);

function render(model: Model, view: { ox: number; oy: number; scale: number }) {
  const r = cv.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  const w2s = (x: number, y: number): [number, number] => [view.ox + x * view.scale, view.oy - y * view.scale];

  // grid
  ctx.strokeStyle = "#131c26";
  ctx.beginPath();
  for (let x = view.ox % (view.scale * 10); x < r.width; x += view.scale * 10) { ctx.moveTo(x, 0); ctx.lineTo(x, r.height); }
  for (let y = view.oy % (view.scale * 10); y < r.height; y += view.scale * 10) { ctx.moveTo(0, y); ctx.lineTo(r.width, y); }
  ctx.stroke();

  ctx.fillStyle = "#afc6d9";
  ctx.font = "11px monospace";
  for (const [name, e] of model.entities) {
    if (e.kind !== "point") continue;
    const [x, y] = model.coords(name);
    const [sx, sy] = w2s(x, y);
    ctx.beginPath();
    ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(name, sx + 6, sy - 6);
  }
}

async function main() {
  statusEl.textContent = "loading kernel…";
  await ensureKernelLoaded();
  log("WASM kernel loaded (fetched, not a byte buffer this time — the real browser path)");

  const model = new Model(2);
  model.addPoint([0, 0], "a");
  model.addPoint([80, 20], "b");
  model.addPoint([0, 0], "mid");
  fix(model, "a", [0, 0]);
  dist(model, "a", "b", 120);
  midpoint(model, "mid", "a", "b");

  const report = model.solve();
  log(`solve: ${report.solved ? "solved" : "conflict"} in ${report.iterations} iterations, max residual ${report.maxResidual.toExponential(2)}`);
  log(`a=${model.coords("a").map((v) => v.toFixed(2))}  b=${model.coords("b").map((v) => v.toFixed(2))}  mid=${model.coords("mid").map((v) => v.toFixed(2))}`);

  statusEl.textContent = report.solved ? "SOLVED" : `CONFLICT: ${report.offenders.map((o) => o.label).join(", ")}`;
  statusEl.className = report.solved ? "solved" : "bad";

  sizeCanvas();
  render(model, { ox: cv.getBoundingClientRect().width / 2, oy: cv.getBoundingClientRect().height / 2, scale: 3 });
}

main().catch((e) => {
  statusEl.textContent = "ERROR — see log";
  statusEl.className = "bad";
  log(String(e && e.stack || e));
  console.error(e);
});
