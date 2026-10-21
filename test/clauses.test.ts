// Clauses: an entity defined by any constraint set, in one expression —
// `pt(on(_, "l1"), on(_, "l2"))`. See docs/plans/clauses.md.
//
// Everything here goes through the real evaluator over the real command
// surface, because the feature *is* syntax: what is being tested is that the
// line a user types means the lines it expands to, journal and all.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { Repl, fmt } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { save } from "../src/persist.ts";
import { Clause, _ as subject, checkClauses } from "../src/clauses.ts";
import { axisFrame } from "./frames.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

function makeRepl(model = new Model(2)) {
  if (!model.defaultFrame) axisFrame(model);
  return { repl: new Repl(neocadScope({ model })), model };
}

async function run(repl: Repl, src: string): Promise<unknown> {
  const r = await repl.eval(src);
  assert.equal(r.ok, true, `${src} failed: ${r.error?.message}`);
  return r.value;
}

async function refused(repl: Repl, src: string, message: RegExp): Promise<void> {
  const r = await repl.eval(src);
  assert.equal(r.ok, false, `${src} should have been refused, and answered ${fmt(r.value)}`);
  assert.match(r.error!.message, message);
}

const near = (a: number[], b: number[], tol = 1e-6) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tol);

/** Three points nailed down at (0,0), (8,0), (0,6): their circumcircle is centred (4,3), radius 5. */
const TRIANGLE = 'fix(pt(0,0), [0,0]); fix(pt(8,0), [8,0]); fix(pt(0,6), [0,6])';

/** Two fixed lines crossing at (3, 4): l1 level through y = 4, l2 upright through x = 3. */
const CROSS = 'fix(pt(-10,4), [-10,4]); fix(pt(10,4), [10,4]); ln("p1", "p2"); '
  + 'fix(pt(3,-10), [3,-10]); fix(pt(3,10), [3,10]); ln("p3", "p4")';

// --- the examples ------------------------------------------------------------

test("the three-point circle: circ(oncircle(p, _) ×3) lands on the circumcircle", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, TRIANGLE);
  const c = await run(repl, 'c = circ(oncircle("p1", _), oncircle("p2", _), oncircle("p3", _))');
  assert.equal(c, "c1", "a constructor with clauses still returns the entity's name");
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(model.circle("c1").center), [4, 3]), `centre at ${model.coords(model.circle("c1").center)}`);
  assert.ok(Math.abs(model.radius("c1") - 5) < 1e-6);
});

test("tangent to l1, through p3, radius 4: circ(tan(l1, _), oncircle(p3, _), rad(_, 4))", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, 'fix(pt(0,0), [0,0]); fix(pt(30,0), [30,0]); ln("p1", "p2"); fix(pt(10,8), [10,8])');
  await run(repl, 'c = circ(tan("l1", _), oncircle("p3", _), rad(_, 4))');
  assert.equal(model.solve().solved, true);
  const [cx, cy] = model.coords(model.circle("c1").center);
  assert.ok(Math.abs(model.radius("c1") - 4) < 1e-6);
  assert.ok(Math.abs(Math.abs(cy) - 4) < 1e-6, `tangent to y = 0 means |cy| = r, got ${cy}`);
  assert.ok(Math.abs(Math.hypot(cx - 10, cy - 8) - 4) < 1e-6, "p3 sits on the rim");
});

test("the intersection: pt(on(_, l1), on(_, l2)) is where the lines cross", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, CROSS);
  const p = await run(repl, 'pt(on(_, "l1"), on(_, "l2"))') as string;
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(p), [3, 4]), `landed at ${model.coords(p)}`);
});

test("coordinates as one constraint set among many: pt(fix(_, [10, 20]))", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  const p = await run(repl, "pt(fix(_, [10, 20]))") as string;
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(p), [10, 20]));
  assert.deepEqual(model.relationsNaming(p).map((r) => r.op), ["fix"]);
});

test("a line defined by what it does: ln(par(_, xaxis()), on(p1, _), eq(_, l1))", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, 'fix(pt(0, 0), [0, 0]); fix(pt(10, 0), [10, 0]); ln("p1", "p2"); fix(pt(5, 7), [5, 7])');
  // The spec's example is `ln(par(_, xaxis()), on("p1", _))`, which leaves the
  // length free — and par + on are both satisfied by a line of length zero, so
  // the solver collapses it (measured: the expanded lines do exactly the same;
  // see TODO.md). `eq` pins a length so the test asserts the geometry meant.
  const l = await run(repl, 'ln(par(_, xaxis()), on("p3", _), eq(_, "l1"))') as string;
  assert.equal(model.solve().solved, true);
  const [a, b] = model.line(l).refs.map((n) => model.coords(n));
  assert.ok(Math.abs(Math.hypot(b[0] - a[0], b[1] - a[1]) - 10) < 1e-6, "as long as l1");
  assert.ok(Math.abs(a[1] - b[1]) < 1e-6, "level with the frame's x axis");
  assert.ok(Math.abs(a[1] - 7) < 1e-6, "and through p3, so at its height");
});

// --- constrain, nesting, seeds --------------------------------------------------

test("constrain(name, ...clauses) applies to what already exists and returns the relation names", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, CROSS);
  const p = await run(repl, "pt()") as string;
  const made = await run(repl, `constrain("${p}", on(_, "l1"), on(_, "l2"))`) as string[];
  assert.equal(made.length, 2);
  for (const r of made) assert.equal(model.relations.get(r)?.args[0], p);
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(p), [3, 4]));
  assert.deepEqual(await run(repl, `constrain("${p}")`), [], "no clauses, nothing applied, nothing refused");
});

test("clauses nest: a constructor returns the name, so it can sit inside another clause", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, CROSS);
  // A line through a pinned point and the crossing, both made by clauses
  // inside its clauses — and as long as l1, so it cannot collapse to a point.
  const l = await run(repl,
    'ln(on(pt(fix(_, [-5, 4])), _), on(pt(on(_, "l1"), on(_, "l2")), _), eq(_, "l1"))') as string;
  assert.equal(model.solve().solved, true);
  const [a, b] = model.line(l).refs.map((n) => model.coords(n));
  // Both helper points are on y = 4 and distinct, so the line is that line.
  assert.ok(Math.abs(a[1] - 4) < 1e-6 && Math.abs(b[1] - 4) < 1e-6, `line at ${a} – ${b}`);
  // The fixture frame's two points, CROSS's four, and the two helpers — a free
  // line's own ends are part of its one `addLine` entry, nested or not.
  assert.equal(model.journal.filter((e) => e.op === "addPoint").length, 2 + 4 + 2);
});

test("seed and clauses mix by type, and the seed picks the branch", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  // A circle of radius 10 about the origin and the x axis meet twice, at ±10.
  await run(repl, 'fix(pt(0,0), [0,0]); circ("p1", 10, rad(_, 10)); fix(pt(-30,0), [-30,0]); fix(pt(30,0), [30,0]); ln("p2", "p3")');
  const left = await run(repl, 'pt(-9, 1, on(_, "l1"), oncircle(_, "c1"))') as string;
  const right = await run(repl, 'pt(oncircle(_, "c1"), 9, on(_, "l1"), 1)') as string;
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(left), [-10, 0]), `seeded left, landed at ${model.coords(left)}`);
  assert.ok(near(model.coords(right), [10, 0]), `seeded right, landed at ${model.coords(right)}`);
  // The seed is the call's own argument — journalled as the seed it always was.
  assert.deepEqual(model.journal.find((e) => e.op === "addPoint" && e.args[1] === left)?.args[0], [-9, 1]);
  // And the order is by type: a constructor's own arguments keep their order among themselves.
  const c = await run(repl, 'circ(rad(_, 4), "p1")') as string;
  assert.equal(model.circle(c).center, "p1");
});

test("in 3D the seed part is still lifted: pt(10, 20, clause) seeds at z = 0", async () => {
  await loadKernel();
  const { repl, model } = makeRepl(new Model(3));
  const p = await run(repl, 'pt(10, 20, onplane(_))') as string;
  assert.deepEqual(model.journal.find((e) => e.op === "addPoint" && e.args[1] === p)?.args[0], [10, 20, 0]);
  assert.ok(near(model.coords(p), [10, 20, 0]));
  // ...and a clause's fix in 3D gets fix's own lift, being fix itself.
  const q = await run(repl, "pt(fix(_, [1, 2]))") as string;
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(q), [1, 2, 0]));
  // A 3D circle from clauses lies in the default frame's plane like any other.
  await run(repl, "fix(pt(0,0), [0,0]); fix(pt(8,0), [8,0]); fix(pt(0,6), [0,6])");
  const c = await run(repl, `circ(oncircle("p3", _), oncircle("p4", _), oncircle("p5", _))`) as string;
  assert.equal(model.solve().solved, true);
  assert.ok(near(model.coords(model.circle(c).center), [4, 3, 0]));
});

// --- what a clause is ----------------------------------------------------------

test("a clause typed alone is a clause, and shows as the call that made it", async () => {
  const { repl, model } = makeRepl();
  const before = model.journal.length;
  const v = await run(repl, 'on(_, "l1")');
  assert.ok(v instanceof Clause);
  assert.equal(fmt(v), 'on(_, "l1")');
  assert.equal(String(v), 'on(_, "l1")');
  assert.equal(fmt(await run(repl, "fix(_, [10, 20])")), "fix(_, [10, 20])");
  assert.equal(fmt(await run(repl, 'pointOnLine("p9", _)')), 'pointOnLine("p9", _)',
    "the clause carries the name it was called by, long or short");
  assert.equal(fmt(await run(repl, "_")), "_");
  const logged = await repl.eval('console.log(tan("l1", _))');
  assert.deepEqual(logged.output, ['tan("l1", _)']);
  assert.equal(model.journal.length, before, "a clause is inert: nothing applied, nothing journalled");
});

test("a clause is plain data: one made against one model applies in another", async () => {
  await loadKernel();
  const first = makeRepl();
  const clause = await run(first.repl, 'on(_, "l1")');
  const second = makeRepl();
  await run(second.repl, CROSS);
  const p = await run(second.repl, "pt()") as string;
  (second.repl.scope.constrain as (n: string, c: unknown) => string[])(p, clause);
  assert.equal(second.model.relationsNaming(p)[0].op, "pointOnLine");
});

// --- refusals --------------------------------------------------------------------

/** Every refusal below must leave the model exactly as it was: nothing half-made. */
async function refusedCleanly(repl: Repl, model: Model, src: string, message: RegExp): Promise<void> {
  const before = save(model);
  await refused(repl, src, message);
  assert.equal(save(model), before, `${src} was refused but left something behind`);
}

test("_ in a numeric slot is refused when the clause is made, naming the slot", async () => {
  const { repl, model } = makeRepl();
  await refusedCleanly(repl, model, 'rad("c1", _)', /rad: _ cannot be the radius — that argument is a number/);
  await refusedCleanly(repl, model, 'dist("p1", "p2", _)', /dist: _ cannot be the distance/);
  await refusedCleanly(repl, model, 'ang("l1", "l2", _)', /ang: _ cannot be the angle/);
  await refusedCleanly(repl, model, "fix(_, _)", /fix: _ cannot be the coordinates/);
  await refusedCleanly(repl, model, "fix(_, [_, 2])", /fix: _ cannot go inside \[_, 2\]/);
  await refusedCleanly(repl, model, 'on(_, "l1", _)', /on takes 2 arguments, and _ is the 3rd/);
});

test("before anything is made: a clause that names something missing", async () => {
  const { repl, model } = makeRepl();
  await run(repl, "pt(); pt(); ln()");
  await refusedCleanly(repl, model, 'circ(oncircle("p1", _), oncircle("p9", _))',
    /circ: oncircle\("p9", _\) names "p9", and there is no "p9"/);
  await refusedCleanly(repl, model, 'pt(on(_, "l1"), on(_, "f9.x"))', /there is no "f9"/);
  await run(repl, 'dist("p1", "p2", 5)');
  await refusedCleanly(repl, model, 'pt(on(_, "d1"))', /names "d1", which is not an entity/);
  await refusedCleanly(repl, model, 'ln(par(_, "f.w"))', /"f.w" is not a frame axis/);
});

test("before anything is made: something that is not a clause where a clause goes", async () => {
  const { repl, model } = makeRepl();
  await run(repl, "pt(); ln()");
  await refusedCleanly(repl, model, 'constrain("p1", "l1")', /constrain: "l1" is not a clause/);
  await refusedCleanly(repl, model, 'constrain("p1", 5)', /constrain: 5 is not a clause/);
  // The commonest slip: the `_` left out, so the relation applied on the spot to
  // what it named. Its result is a relation name, and is called that.
  await run(repl, 'r = on("p1", "l1")');
  await refusedCleanly(repl, model, 'constrain("p1", r)', /constrain: "r1" is a relation that has already applied \(pointOnLine "p1" "l1"\), not a clause/);
  await refusedCleanly(repl, model, "pt(r)", /pt: "r1" is a relation that has already applied/);
  await refusedCleanly(repl, model, "ln(r)", /ln: "r1" is a relation that has already applied/);
  await refusedCleanly(repl, model, 'pt("p1")', /pt: "p1" is neither a number nor a clause/);
  await refusedCleanly(repl, model, 'constrain("p9", on(_, "l1"))', /there is no entity "p9"/);
  await refusedCleanly(repl, model, 'constrain(_, on(_, "l1"))', /_ stands for one only inside a relation call/);
  await refusedCleanly(repl, model, "circ(_, 4)", /circ: _ stands for the new entity inside a relation call/);
  await refusedCleanly(repl, model, 'dist(on(_, "l1"), "p1", 5)', /dist cannot take a clause \(on\(_, "l1"\)\) as an argument/);
  await refusedCleanly(repl, model, 'on(_, on(_, "l1"))', /on cannot take a clause/);
});

test("a clause without _ is refused (not constructible at the command line; checked anyway)", () => {
  const model = new Model(2);
  assert.throws(() => checkClauses(model, "pt", [new Clause("on", ["p1", "l1"])]), /pt: on\("p1", "l1"\) has no _/);
  assert.doesNotThrow(() => checkClauses(new Model(2), "pt", [new Clause("fix", [subject, [1, 2]])]));
});

test("a third clause's mistake means the first two never applied and nothing was made", async () => {
  const { repl, model } = makeRepl();
  await run(repl, TRIANGLE);
  await refusedCleanly(repl, model, 'circ(oncircle("p1", _), oncircle("p2", _), oncircle("nope", _))', /no "nope"/);
});

test("a relation's own refusal while applying is passed on, with what was already made", async () => {
  await loadKernel();
  const { repl, model } = makeRepl();
  await run(repl, 'ln(); pt()');
  const before = model.journal.length;
  // A line as the point of `on` — the clause is well-formed and every name
  // exists, so only the relation can say what is wrong with it.
  await refused(repl, 'ln(on(_, "l1"))', /^ln made l2, but on\("l2", "l1"\) refused: "l2" is not a point$/);
  assert.deepEqual(model.journal.slice(before).map((e) => e.op), ["addLine"],
    "the journal shows exactly what happened: the line, and no relation");
  // And with an earlier clause applied, both are named.
  await refused(repl, 'circ(rad(_, 3), on(_, "l1"))', /^circ made c1, d1, but on\("c1", "l1"\) refused: "c1" is not a point$/);
  assert.deepEqual(model.journal.slice(before).map((e) => e.op), ["addLine", "addCircle", "radius"]);
  await refused(repl, 'constrain("p3", on(_, "l1"), on(_, "p3"))', /^constrain: made r1, but on\("p3", "p3"\) refused/);
});

// --- sugar, provably --------------------------------------------------------------

/** The same drawing typed two ways must save to the same bytes. */
async function sameFile(clauses: string[], expanded: string[]): Promise<{ a: Model; b: Model; text: string }> {
  await loadKernel();
  const a = makeRepl(), b = makeRepl();
  for (const src of clauses) await run(a.repl, src);
  for (const src of expanded) await run(b.repl, src);
  a.model.solve();
  b.model.solve();
  const text = save(a.model);
  assert.equal(text, save(b.model));
  return { a: a.model, b: b.model, text };
}

test("a clause expression saves byte-for-byte as the lines it expands to", async () => {
  await sameFile(
    [TRIANGLE, 'circ(oncircle("p1", _), oncircle("p2", _), oncircle("p3", _))'],
    [TRIANGLE, 'c = circ(); oncircle("p1", c); oncircle("p2", c); oncircle("p3", c)'],
  );
  await sameFile(
    [CROSS, 'pt(on(_, "l1"), on(_, "l2"))', 'pt(10, 20, fix(_, [1, 2]))', 'c = circ(tan("l1", _), rad(_, 4))'],
    [CROSS, 'p = pt(); on(p, "l1"); on(p, "l2")', 'q = pt(10, 20); fix(q, [1, 2])', 'c = circ(); tan("l1", c); rad(c, 4)'],
  );
  // And with the file format untouched, the saved text is one any build opens.
  const { text } = await sameFile([CROSS, 'constrain(pt(), on(_, "l1"))'], [CROSS, 'on(pt(), "l1")']);
  assert.ok(!text.includes("clause") && !text.includes('"_"'));
});

test("del of an entity made with clauses cascades exactly as for the expanded form", async () => {
  const { a, b } = await sameFile(
    [CROSS, 'pt(on(_, "l1"), on(_, "l2"))'],
    [CROSS, 'p = pt(); on(p, "l1"); on(p, "l2")'],
  );
  const sa = neocadScope({ model: a }), sb = neocadScope({ model: b });
  const removed = (sa.del as (n: string) => string[])("p5");
  assert.deepEqual(removed, (sb.del as (n: string) => string[])("p5"));
  assert.ok(removed.length === 3, `the point and its two on-relations: ${removed}`);
  assert.equal(save(a), save(b));
});

test("_ and constrain are in scope, and help() shows two clause examples", async () => {
  const { repl } = makeRepl();
  const help = await run(repl, "help()") as string;
  assert.match(help, /circ\(oncircle\("p1", _\), oncircle\("p2", _\), oncircle\("p3", _\)\)/);
  assert.match(help, /pt\(on\(_, "l1"\), on\(_, "l2"\)\)/);
  assert.match(help, /constrain\(name, \.\.\.clauses\)/);
  assert.match(help, /in scope:.* _ /);
});

test("every relation in the vocabulary makes a clause from _ (short and long names)", () => {
  const scope = neocadScope({ model: new Model(2) });
  const names = ["dist", "fix", "onplane", "onPlane", "coin", "coincident", "mid", "midpoint", "par", "parallel",
    "perp", "perpendicular", "ang", "angle", "on", "pointOnLine", "eq", "equalLength", "rad", "radius",
    "oncircle", "onCircle", "conc", "concentric", "eqrad", "equalRadius", "tan", "tangent", "sym", "symmetric",
    "arcends", "arcEndpoints"];
  for (const n of names) {
    const c = (scope[n] as (...a: unknown[]) => unknown)(subject, "x", "y");
    assert.ok(c instanceof Clause && c.op === n, `${n}(_, …) should be a clause`);
  }
});
