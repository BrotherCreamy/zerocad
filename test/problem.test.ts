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
  await ensureKernelLoaded(bytes);
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

// ---------------------------------------------------------------------------
// Temporary residuals: `solve({ extra })`.
//
// These exist for dragging — each pointer move solves with a weak pull toward
// the cursor — but nothing here knows that, and nothing in problem.ts does
// either. The properties being pinned down are the ones a caller relies on:
// the extras act, they are not kept, and they are never allowed to accuse.

/** The soft pull a drag uses, as a residual block: (x - target) * w. */
function pull(varIndex: number, target: number, w = 0.12) {
  return { varIndices: [varIndex], fn: (l: Dual[]) => [l[0].sub(target).mul(w)], label: "pull" };
}

test("an extra residual pulls an otherwise-free variable to its target", async () => {
  await loadKernel();
  const p = new Problem();
  const x = p.addVar(0);
  p.addResidual([p.addVar(0)], (l) => [l[0].sub(0)], "unrelated"); // so the problem isn't empty

  const report = p.solve({ extra: [pull(x, 40)] });
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  // Nothing else touches x, so the pull's own minimum is the answer — the
  // weight scales the residual, not where it is zero.
  assert.ok(Math.abs(p.getVar(x) - 40) < 1e-6, `x = ${p.getVar(x)}`);
});

test("extras are gone when the solve returns — nothing was stored", async () => {
  await loadKernel();
  const p = new Problem();
  const x = p.addVar(0);
  p.addResidual([x], (l) => [l[0].sub(0)], "fix_x");

  p.solve({ extra: [pull(x, 100)] });
  assert.ok(p.getVar(x) > 0.5, `the pull should have dragged x off zero, got ${p.getVar(x)}`);

  // The same Problem, solved again with nothing extra: only the stored
  // residual is left, so x comes all the way home.
  const settled = p.solve();
  assert.equal(settled.solved, true);
  assert.ok(Math.abs(p.getVar(x)) < 1e-6, `x = ${p.getVar(x)} — an extra block outlived its solve`);
});

test("an unsatisfiable extra is not an offender", async () => {
  await loadKernel();
  const p = new Problem();
  const x = p.addVar(0);

  // Two extras pulling the same variable in opposite directions cannot both be
  // satisfied; they still must not paint a conflict, because a soft pull that
  // does not reach zero is doing exactly what it was asked to do.
  p.addResidual([p.addVar(0)], (l) => [l[0].sub(0)], "unrelated");
  const report = p.solve({ extra: [pull(x, -1000), pull(x, 1000)] });
  assert.deepEqual(report.offenders, []);
  assert.equal(report.solved, true);
  assert.ok(report.maxResidual < 1e-6, `maxResidual = ${report.maxResidual} — it counted an extra`);
});

test("a pull loses to a real constraint and settles on the nearest point of it", async () => {
  await loadKernel();
  const p = new Problem();
  const ax = p.addVar(0), ay = p.addVar(0);
  const bx = p.addVar(30), by = p.addVar(10);
  p.addResidual([ax], (l) => [l[0].sub(0)], "fix_a_x");
  p.addResidual([ay], (l) => [l[0].sub(0)], "fix_a_y");
  p.addResidual([ax, ay, bx, by], (l) => [dhypot(l[2].sub(l[0]), l[3].sub(l[1])).sub(50)], "dist_ab");

  // Drag b out along +x, to a cursor position a little off the circle. b lands
  // where the circle of radius 50 comes closest to where the cursor went, and
  // the constraint is what decides that.
  const report = p.solve({ extra: [pull(bx, 52), pull(by, 0)] });
  assert.equal(report.solved, true, JSON.stringify(report.offenders));
  const d = Math.hypot(p.getVar(bx) - p.getVar(ax), p.getVar(by) - p.getVar(ay));
  assert.ok(Math.abs(d - 50) < 0.05, `the constraint gave way: distance = ${d}`);
  assert.ok(Math.abs(p.getVar(bx) - 50) < 0.1 && Math.abs(p.getVar(by)) < 0.05,
    `b = (${p.getVar(bx)}, ${p.getVar(by)}), expected the near side of the circle at (50, 0)`);
  assert.deepEqual(report.offenders, []);
});

test("a pull held far past what the constraints allow bends them, and the settling solve undoes it", async () => {
  // Least squares weighs everything at once, so a pull that cannot be
  // satisfied does not simply stall against the constraints — it trades
  // against them, and a cursor dragged far past where a point can follow
  // leaves the model a couple of units out of true. That is arithmetic, not a
  // bug, and it is the reason the drag renders intermediate frames without
  // touching the status line and runs one ordinary solve on release.
  await loadKernel();
  const p = new Problem();
  const ax = p.addVar(0), ay = p.addVar(0);
  const bx = p.addVar(30), by = p.addVar(10);
  p.addResidual([ax], (l) => [l[0].sub(0)], "fix_a_x");
  p.addResidual([ay], (l) => [l[0].sub(0)], "fix_a_y");
  p.addResidual([ax, ay, bx, by], (l) => [dhypot(l[2].sub(l[0]), l[3].sub(l[1])).sub(50)], "dist_ab");

  const dragging = p.solve({ extra: [pull(bx, 200), pull(by, 0)] });
  assert.ok(p.getVar(ax) > 1, `a was pulled off its fix by ${p.getVar(ax)} — expected the trade to be visible`);
  // The stored blocks are entitled to say they are unhappy about it; the pull
  // that caused it is not on the list, which is the whole of the guarantee.
  assert.ok(dragging.offenders.some((o) => o.label === "fix_a_x"));
  assert.ok(!dragging.offenders.some((o) => o.label === "pull"),
    `an extra reached the offender report: ${JSON.stringify(dragging.offenders)}`);

  const settled = p.solve(); // release: the same model, no pull
  assert.equal(settled.solved, true);
  assert.ok(Math.abs(p.getVar(ax)) < 1e-6 && Math.abs(p.getVar(ay)) < 1e-6, "a came back to its fix exactly");
  const d = Math.hypot(p.getVar(bx) - p.getVar(ax), p.getVar(by) - p.getVar(ay));
  assert.ok(Math.abs(d - 50) < 1e-6, `distance settled to ${d}`);
});

// --- block handles ---------------------------------------------------------
//
// A block can now be taken back out again, which is what makes a constraint
// deletable one layer up. The handle is what makes that safe: it names one
// block for as long as that block exists, and never comes to mean another.

test("removeBlock takes a residual out of the problem for good", async () => {
  await loadKernel();
  const p = new Problem();
  const x = p.addVar(5);
  const toZero = p.addResidual([x], (l) => [l[0].sub(0)], "to_zero");
  assert.equal(p.solve().solved, true);
  assert.ok(Math.abs(p.getVar(x)) < 1e-9, "solved to the constraint");

  p.removeBlock(toZero);
  p.setVar(x, 42);
  const after = p.solve();
  assert.equal(after.solved, true);
  assert.equal(p.getVar(x), 42, "with nothing left to satisfy, the value is left where it is");
});

test("handles survive the removal of blocks added before them", async () => {
  await loadKernel();
  const p = new Problem();
  const x = p.addVar(0), y = p.addVar(0);
  const first = p.addResidual([x], (l) => [l[0].sub(3)], "x=3");
  const second = p.addResidual([y], (l) => [l[0].sub(7)], "y=7");
  // An index would now be stale; a handle is not. This is the whole reason
  // blocks are stored as { id, block } rather than as a bare list.
  p.removeBlock(first);
  assert.equal(p.blockCount, 1);
  p.solve();
  assert.ok(Math.abs(p.getVar(y) - 7) < 1e-9, "the surviving block is still the one it was");

  p.removeBlock(second);
  assert.equal(p.blockCount, 0);
});

test("a handle is never handed out twice, and an unknown one is an error", async () => {
  const p = new Problem();
  const a = p.addResidual([p.addVar(0)], (l) => [l[0]], "a");
  p.removeBlock(a);
  const b = p.addResidual([p.addVar(0)], (l) => [l[0]], "b");
  assert.notEqual(b, a, "a freed handle is not reissued");

  // Silence here would hide a bookkeeping bug above this file: the only way to
  // hold a handle is to have been given it, so one that names nothing means
  // something has lost track of which blocks belong to what.
  assert.throws(() => p.removeBlock(a), /no residual block/);
  assert.throws(() => p.removeBlock(9999), /no residual block/);
});

test("clear() does not let an old handle come back to life", async () => {
  const p = new Problem();
  const stale = p.addResidual([p.addVar(0)], (l) => [l[0]], "stale");
  p.clear();
  const fresh = p.addResidual([p.addVar(0)], (l) => [l[0]], "fresh");
  assert.notEqual(fresh, stale);
  assert.throws(() => p.removeBlock(stale), /no residual block/);
});
