// A constructor that refuses must leave nothing behind. `addLine`, `addCircle`,
// `addArc` and `addFrame` auto-create the points they were not given, and those
// points journal nothing of their own — the constructor's entry recreates them
// on replay. So a refusal that came *after* they were made left real points in
// the session that no save could carry, and a `p` counter a replay would not
// reproduce: the next auto-name differed between a session and its own file.
// These tests pin every refusal before the first effect, in 2D and 3D.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { save, open } from "../src/persist.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/**
 * A model with a frame `f` (the default), two points and a line — something for
 * a refusal to name, of every kind a constructor might be handed by mistake.
 * `withDefault: false` leaves a 3D model with no default frame, the one state
 * in which a circle or arc given no plane is refused.
 */
function setup(dim: number, withDefault = true): Model {
  const m = new Model(dim);
  if (withDefault) axisFrame(m);
  const at = (x: number) => [x, ...new Array<number>(dim - 1).fill(0)];
  m.addPoint(at(3), "a");
  m.addPoint(at(4), "b");
  m.addLine("a", "b", "ab");
  return m;
}

/** Everything a refusal could have changed, in a form `deepEqual` can compare. */
function snapshot(m: Model) {
  return {
    entities: [...m.entities.keys()],
    vars: m.problem.varCount,
    journal: JSON.stringify(m.journal),
  };
}

/**
 * Every refusal the spec names, per constructor, with the dimensions it
 * applies in and whether it needs the no-default model. `ab` is a line and
 * `f` a frame — names that exist but are the wrong kind.
 */
const refusals: { what: string; dims: number[]; noDefault?: boolean; call: (m: Model) => unknown; error: RegExp }[] = [
  // addLine
  { what: "addLine: a dotted name", dims: [2, 3], call: (m) => m.addLine(null, null, "a.b"), error: /cannot contain a dot/ },
  { what: "addLine: a taken name", dims: [2, 3], call: (m) => m.addLine(null, null, "a"), error: /"a" already exists/ },
  { what: "addLine: a taken name, one end given", dims: [2, 3], call: (m) => m.addLine("a", null, "ab"), error: /"ab" already exists/ },
  { what: "addLine: a ref that does not exist", dims: [2, 3], call: (m) => m.addLine("nope", null), error: /nope/ },
  { what: "addLine: a ref that is not a point", dims: [2, 3], call: (m) => m.addLine(null, "ab"), error: /ab/ },
  { what: "addLine: the same point twice", dims: [2, 3], call: (m) => m.addLine("a", "a"), error: /two different points/ },
  // addCircle
  { what: "addCircle: a dotted name", dims: [2, 3], call: (m) => m.addCircle(null, null, null, "c.x"), error: /cannot contain a dot/ },
  { what: "addCircle: a taken name", dims: [2, 3], call: (m) => m.addCircle(null, 2, null, "ab"), error: /"ab" already exists/ },
  { what: "addCircle: a centre that does not exist", dims: [2, 3], call: (m) => m.addCircle("nope"), error: /nope/ },
  { what: "addCircle: a centre that is not a point", dims: [2, 3], call: (m) => m.addCircle("ab"), error: /ab/ },
  { what: "addCircle: a radius that is not positive", dims: [2, 3], call: (m) => m.addCircle(null, -1), error: /positive radius/ },
  { what: "addCircle: a normal given in 2D", dims: [2], call: (m) => m.addCircle(null, null, "f"), error: /takes no normal/ },
  { what: "addCircle: a plane that is not a frame", dims: [3], call: (m) => m.addCircle(null, null, "a"), error: /"a"/ },
  { what: "addCircle: a normal with no direction", dims: [3], noDefault: true, call: (m) => m.addCircle(null, null, [0, 0, 0]), error: /three numbers with a direction/ },
  // addArc
  { what: "addArc: a dotted name", dims: [2, 3], call: (m) => m.addArc(null, null, null, null, null, "a.x"), error: /cannot contain a dot/ },
  { what: "addArc: a taken name", dims: [2, 3], call: (m) => m.addArc(null, null, null, null, null, "b"), error: /"b" already exists/ },
  { what: "addArc: a ref that does not exist", dims: [2, 3], call: (m) => m.addArc(null, "nope"), error: /nope/ },
  { what: "addArc: an end that is not a point", dims: [2, 3], call: (m) => m.addArc(null, null, "ab"), error: /ab/ },
  { what: "addArc: the same endpoint twice", dims: [2, 3], call: (m) => m.addArc(null, "a", "a"), error: /two different endpoints/ },
  { what: "addArc: a radius that is not positive", dims: [2, 3], call: (m) => m.addArc(null, null, null, 0), error: /positive radius/ },
  { what: "addArc: a normal given in 2D", dims: [2], call: (m) => m.addArc(null, null, null, null, "f"), error: /takes no normal/ },
  { what: "addArc: a plane that is not one", dims: [3], noDefault: true, call: (m) => m.addArc(null, null, null, null, "nope"), error: /"nope" is not a plane/ },
  // addFrame
  { what: "addFrame: a dotted name", dims: [2, 3], call: (m) => m.addFrame(null, null, null, "w.x"), error: /cannot contain a dot/ },
  { what: "addFrame: a taken name", dims: [2, 3], call: (m) => m.addFrame(null, null, null, "a"), error: /"a" already exists/ },
  { what: "addFrame: a ref that does not exist", dims: [2, 3], call: (m) => m.addFrame(null, "nope"), error: /nope/ },
  { what: "addFrame: a ref that is not a point", dims: [2, 3], call: (m) => m.addFrame("ab"), error: /ab/ },
  { what: "addFrame: the same point twice", dims: [2, 3], call: (m) => m.addFrame("a", "a"), error: /different points/ },
  { what: "addFrame: a y-ref in 2D", dims: [2], call: (m) => m.addFrame(null, null, "a"), error: /takes no y-ref/ },
];

for (const r of refusals) {
  for (const dim of r.dims) {
    test(`${dim}D ${r.what} — refused, and nothing left behind`, () => {
      const m = setup(dim, !r.noDefault);
      const before = snapshot(m);
      assert.throws(() => r.call(m), r.error);
      assert.deepEqual(snapshot(m), before, "the refusal changed the model");
      // The counters are private, so they are read the way a user meets them:
      // the next auto-names, against a twin that was never refused anything.
      const twin = setup(dim, !r.noDefault);
      if (r.noDefault) for (const x of [m, twin]) { x.addFrame(); x.setDefaultFrame("f1"); }
      assert.equal(m.addPoint().name, twin.addPoint().name, "the p counter moved");
      assert.equal(m.addLine().name, twin.addLine().name, "the l counter moved");
      assert.equal(m.addCircle().name, twin.addCircle().name, "the c counter moved");
      assert.equal(m.addArc().name, twin.addArc().name, "the a counter moved");
      assert.equal(m.addFrame().name, twin.addFrame().name, "the f counter moved");
      assert.deepEqual([...m.entities.keys()], [...twin.entities.keys()]);
    });
  }
}

test("a session and its own file agree after refusals — they used to differ by 8 points in 2D, 9 in 3D", async () => {
  await loadKernel();
  for (const dim of [2, 3]) {
    const m = setup(dim);
    assert.throws(() => m.addLine(null, null, "a.b"));
    assert.throws(() => m.addFrame(null, null, null, "w.x"));
    assert.throws(() => m.addCircle(null, null, null, "c.x"));
    assert.throws(() => m.addArc(null, null, null, null, null, "a.x"));
    const reopened = open(save(m));
    assert.deepEqual([...reopened.entities.keys()], [...m.entities.keys()], `${dim}D: the session and its file hold different entities`);
    assert.equal(m.addPoint().name, reopened.addPoint().name);
    assert.deepEqual(m.addLine().refs, reopened.addLine().refs);
    assert.equal(save(reopened), save(m), `${dim}D: the session and its file have drifted apart`);
  }
});

/**
 * What every successful free call journals — written out by hand rather than
 * captured, so that a change to any of them is a test failure and not a
 * silently regenerated expectation. These are the entries the calls wrote
 * before the reorder, and the names their points got; persist.ts's replay
 * table reads exactly these, and it did not change.
 */
test("a successful call journals exactly what it did before, and names its points the same", () => {
  for (const dim of [2, 3]) {
    const m = new Model(dim);
    const f = m.addFrame();
    const l = m.addLine();
    const frame = dim === 3 ? "f1" : null;
    m.setDefaultFrame(frame);
    const c = m.addCircle(null, 2);
    const a = m.addArc();
    const named = m.addLine("p1", null, "edge");
    assert.deepEqual(m.journal, [
      { op: "addFrame", args: [null, null, null, "f1"] },
      { op: "addLine", args: [null, null, "l1"] },
      { op: "setDefaultFrame", args: [frame] },
      // Since format 13 the slot is the normal's seed, null when not given:
      // the drawing plane (the default frame, here) seeds it.
      { op: "addCircle", args: [null, 2, null, "c1"] },
      { op: "addArc", args: [null, null, null, null, null, "a1"] },
      { op: "addLine", args: ["p1", null, "edge"] },
    ], `${dim}D`);
    const fp = dim === 3 ? ["p1", "p2", "p3"] : ["p1", "p2"];
    assert.deepEqual([f.origin, f.xref, ...(f.yref === undefined ? [] : [f.yref])], fp);
    let k = fp.length;
    const next = () => `p${++k}`;
    assert.deepEqual(l.refs, [next(), next()]);
    assert.equal(c.center, next());
    assert.deepEqual([a.center, a.start, a.end], [next(), next(), next()]);
    assert.deepEqual(named.refs, ["p1", next()]);
  }
});

/**
 * The one behaviour that changed on purpose. A constructor explicitly named
 * like an auto-point (`p2`) used to have its own endpoint auto-named `p2`
 * first and then be refused as "already exists", for a point the user never
 * made. The name is now claimed before the points, which step around it.
 */
test("an explicit p-style name is held aside while the points are made, and replays the same", async () => {
  await loadKernel();
  for (const dim of [2, 3]) {
    const m = new Model(dim);
    m.addPoint();
    const l = m.addLine(null, null, "p2");
    assert.equal(l.name, "p2");
    assert.deepEqual(l.refs, ["p3", "p4"]);
    const fr = m.addFrame(null, null, null, "p6");
    // In 3D the frame's three points are p5, p7, p8 — stepping over p6.
    assert.deepEqual([fr.origin, fr.xref, ...(fr.yref === undefined ? [] : [fr.yref])],
      dim === 3 ? ["p5", "p7", "p8"] : ["p5", "p7"]);
    if (dim === 3) m.setDefaultFrame("p6");
    const c = m.addCircle(null, null, null, dim === 3 ? "p9" : "p8");
    assert.equal(c.center, dim === 3 ? "p10" : "p9");
    assert.equal(m.addPoint().name, dim === 3 ? "p11" : "p10");
    const once = save(m);
    const reopened = open(once);
    assert.deepEqual([...reopened.entities.keys()], [...m.entities.keys()]);
    assert.equal(save(reopened), once, `${dim}D: not a fixed point`);
  }
});
