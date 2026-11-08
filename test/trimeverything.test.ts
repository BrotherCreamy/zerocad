// Trim every sketch curve (docs/plans/trim-everything.md). The owner: *"Also
// need trim for sketch entities"*.
//
// Each curve kind trimmed against the others: the right piece goes, and what
// is kept is the same curve it was — read back off the entity, against the
// curve as it stood before the trim, never through the relation that holds
// it. An ellipse's piece is an elliptical arc (`earc`); a spline's a spline of
// control points (`bspline`) — the piece of an interpolant is exactly a
// clamped B-spline, by knot insertion.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { trim } from "../src/sketchedit.ts";
import { open, save } from "../src/persist.ts";
import { addEllipse } from "../src/kinds/ellipse.ts";
import { curveFrame } from "../src/curveplane.ts";
import { arcPoint } from "../src/arcgeom.ts";
import "../src/modules/builtin.ts";

await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const near = (a: number[], b: number[], tol = 1e-6) => Math.hypot(...sub(a, b)) <= tol;

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  assert.ok(r.maxResidual < 1e-6, `max residual ${r.maxResidual}`);
  return r;
}

/** A line between two new points. */
function seg(m: Model, a: number[], b: number[]): string {
  const z = m.dim === 3 && a.length === 2 ? [0] : [];
  return m.addLine(m.addPoint([...a, ...z]).name, m.addPoint([...b, ...z]).name).name;
}

/** Save, open, save: the same text twice — the trim replays to the same model. */
function replays(m: Model): Model {
  const once = save(m);
  const back = open(once, m.dim);
  assert.equal(save(back), once, "the replay is the same model");
  return back;
}

/** How far `p` is from the ellipse with semi-axes a, b along x and y about `c` — zero on it. */
function offEllipse(p: number[], c: number[], a: number, b: number): number {
  return Math.abs(Math.hypot((p[0] - c[0]) / a, (p[1] - c[1]) / b) - 1);
}

test("an ellipse crossed by a line trims to an elliptical arc under its own name: the piece clicked goes, the rest is the same ellipse", () => {
  const m = new Model(2);
  const c = m.addPoint([0, 0]).name;
  const el = addEllipse(m, c, m.addPoint([20, 0]).name, 10).name;
  seg(m, [-30, 4], [30, 4]); // crosses the ellipse at y = 4, x = ±20·√(1 − 0.16)
  solved(m);
  const out = trim(m, el, [0, -10]); // the lower, larger piece goes
  assert.deepEqual(out, [el]);
  const e = m.entities.get(el)!;
  assert.equal(e.kind, "earc", "an elliptical arc, under the ellipse's name");
  const x = 20 * Math.sqrt(1 - 0.16);
  const arc = e as Extract<typeof e, { kind: "earc" }>;
  assert.ok(near(m.coords(arc.start), [x, 4]) && near(m.coords(arc.end), [-x, 4]), "kept: the top, start to end counter-clockwise");
  solved(m);
  // The kept piece is the same curve: every point along it on the old ellipse, and above the cut.
  const f = curveFrame(m, e)!;
  for (let k = 0; k <= 16; k++) {
    const p = arcPoint(f, (k / 16) * f.sweep);
    assert.ok(offEllipse(p, [0, 0], 20, 10) < 1e-9, `sample ${k} on the old ellipse`);
    assert.ok(p[1] >= 4 - 1e-9, `sample ${k} on the kept side: ${p}`);
  }
  replays(m);
});
