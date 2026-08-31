import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Problem, ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Dual, dhypot } from "../src/kernel/dual.ts";

// Node has no fetch-a-local-file-as-Response by default the way a browser does;
// feed the wasm bytes straight in so the kernel loads the same way here as it
// eventually will in the browser (just a different transport for the bytes).
async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes as unknown as BufferSource);
}

test("two points, a distance constraint, one point fixed: solves to the target length", async () => {
  await loadKernel();
  const p = new Problem();
  const ax = p.addVar(0), ay = p.addVar(0);
  const bx = p.addVar(3), by = p.addVar(4); // start near, not exactly on the target

  // fix a at (0,0): two 1-variable residuals pin ax, ay to 0
  p.addResidual([ax], (l) => [l[0].sub(0)], "fix_a_x");
  p.addResidual([ay], (l) => [l[0].sub(0)], "fix_a_y");

  // distance(a,b) = 50
  p.addResidual([ax, ay, bx, by], (l) => {
    const [x1, y1, x2, y2] = l;
    const dx = x2.sub(x1), dy = y2.sub(y1);
    return [dhypot(dx, dy).sub(50)];
  }, "dist_ab");

  const report = p.solve();
  assert.equal(report.solved, true, `expected solved, offenders: ${JSON.stringify(report.offenders)}`);
  const bxv = p.getVar(bx), byv = p.getVar(by);
  const dist = Math.hypot(bxv - p.getVar(ax), byv - p.getVar(ay));
  assert.ok(Math.abs(dist - 50) < 1e-6, `distance = ${dist}`);
});

test("overconstrained system reports offenders instead of pretending to solve", async () => {
  await loadKernel();
  const p = new Problem();
  const ax = p.addVar(0), ay = p.addVar(0);
  const bx = p.addVar(10), by = p.addVar(0);
  p.addResidual([ax], (l) => [l[0].sub(0)], "fix_a_x");
  p.addResidual([ay], (l) => [l[0].sub(0)], "fix_a_y");
  p.addResidual([bx], (l) => [l[0].sub(10)], "fix_b_x");
  p.addResidual([by], (l) => [l[0].sub(0)], "fix_b_y");
  // both points fully fixed, then ALSO demand a distance that contradicts their fixed positions
  p.addResidual([ax, ay, bx, by], (l) => {
    const [x1, y1, x2, y2] = l;
    return [dhypot(x2.sub(x1), y2.sub(y1)).sub(999)];
  }, "dist_ab");

  const report = p.solve();
  assert.equal(report.solved, false);
  assert.ok(report.offenders.some((o) => o.label === "dist_ab"));
});

test("dual-number chain rule matches finite-difference on a nonlinear residual", async () => {
  // sanity-check the AD implementation itself, independent of the solver:
  // f(x,y) = sin(x)*y + sqrt(x*x+y*y); compare AD gradient to finite differences.
  const f = (x: Dual, y: Dual) => x.sin().mul(y).add(dhypot(x, y));
  const x0 = 1.3, y0 = -0.7;
  const xd = Dual.variable(x0, 0), yd = Dual.variable(y0, 1);
  const out = f(xd, yd);

  const h = 1e-6;
  const fPlain = (x: number, y: number) => Math.sin(x) * y + Math.hypot(x, y);
  const dfdx = (fPlain(x0 + h, y0) - fPlain(x0 - h, y0)) / (2 * h);
  const dfdy = (fPlain(x0, y0 + h) - fPlain(x0, y0 - h)) / (2 * h);

  assert.ok(Math.abs(out.val - fPlain(x0, y0)) < 1e-12);
  assert.ok(Math.abs((out.grad.get(0) ?? 0) - dfdx) < 1e-5, `d/dx: AD=${out.grad.get(0)} FD=${dfdx}`);
  assert.ok(Math.abs((out.grad.get(1) ?? 0) - dfdy) < 1e-5, `d/dy: AD=${out.grad.get(1)} FD=${dfdy}`);
});
