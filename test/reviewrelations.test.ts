// Many-at-once is one relation among equals, and a face is named by what it
// is swept from (docs/plans/review-relations.md; items 5 and 6 of the register
// entry *Reviewed against the owner's principle*). The owner: *"correct
// relationships BETWEEN entities … bidirectional relationships everywhere by
// default"* — nothing privileged, nothing consumed.
//
// **5.** `par("l1", "l2", "l3", "l4")` is one relation: one name, one journal
// entry, rows that are the pair relation's own. Deleting a member — the first
// as much as any — leaves it over the rest; a typed pair naming a member joins
// it; a file replays it as written, and an old file's star as the separate
// relations it was.
//
// **6.** `e1:l2` is the wall of `e1` swept from `l2`, resolved when read, so
// `onplane`, `fdist`, `par` and a driven `fangle` stay on their wall through a
// fillet, a chamfer and a trim of the profile; `e1.m3`, the wall's *place*,
// still reads — typed, and in a file — as the wall then in that place, and is
// journalled by its line. Two meeting walls are dimensioned by `corner` of
// their lines.
//
// The three fixtures were saved by the build before this one (format 19).
// Headless; the browser half is test/e2e/reviewrelations.e2e.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model, parseFaceName, referentOf, referentsOf } from "../src/model.ts";
import { dist, fix, onPlane } from "../src/relations/basic.ts";
import { equalLength, parallel } from "../src/relations/geometry.ts";
import { among, amongSet, isAmongOp } from "../src/relations/among.ts";
import { join, leave, relate } from "../src/among.ts";
import { measure, measured } from "../src/relations/measure.ts";
import { cornerAngle } from "../src/relations/smartdim.ts";
import { faceDistance, faceKernelNames, faceRef, faceSource, planeNow } from "../src/relations/solidref.ts";
import { del, extrude, fillet, set } from "../src/operations.ts";
import { chamfer, trim } from "../src/sketchedit.ts";
import { open, save, VERSION } from "../src/persist.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { constraintsFor, dimensionFor } from "../src/dimensioning.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { joinClasses } from "../src/loops.ts";
import { faceShade, pickSolid } from "../src/solidpick.ts";
import { visibleFaces } from "../src/faces.ts";
import { occlusion } from "../src/occlusion.ts";
import { orbitBy, worldToScreen, type View } from "../src/view.ts";
import "../src/modules/builtin.ts";

await (async () => {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
})();

const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);
const dotN = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);
const close = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} against ${b}`);
const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

function solved(m: Model) {
  const r = m.solve();
  assert.equal(r.solved, true, JSON.stringify(r.offenders));
  return r;
}

/** A line's direction, as numbers. */
const dirOf = (m: Model, l: string) => {
  const [a, b] = m.line(l).refs;
  return sub(m.coords(b), m.coords(a));
};
/** |sin| of the angle between two lines: 0 when they are parallel, in any dimension. */
function sinBetween(m: Model, a: string, b: string): number {
  const [u, v] = [dirOf(m, a), dirOf(m, b)];
  const c = dotN(u, v) / (len(u) * len(v));
  return Math.sqrt(Math.max(0, 1 - c * c));
}
const lengthOf = (m: Model, l: string) => len(dirOf(m, l));

/** `n` loose lines, at seeds no relation among them holds yet. In 3D each leans out of the plane too. */
function lines(dim: 2 | 3, n: number): { m: Model; ls: string[] } {
  const m = new Model(dim);
  const ls: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = dim === 2 ? [0, i * 12] : [0, i * 12, i];
    const b = dim === 2 ? [20 + 3 * i, i * 12 + 2 * i + 1] : [20 + 3 * i, i * 12 + 2 * i + 1, 4 - i * 3];
    const [p, q] = [m.addPoint(a).name, m.addPoint(b).name];
    ls.push(m.addLine(p, q).name);
  }
  return { m, ls };
}

// ============================ 5: one relation among equals ============================

for (const dim of [2, 3] as const) {
  test(`par among four lines is one relation, and solves as the star did — ${dim}D`, () => {
    const { m, ls } = lines(dim, 4);
    const before = { relations: m.relations.size, journal: m.journal.length };
    const r = among(m, "parallel", ...ls);
    assert.equal(m.relations.size, before.relations + 1, "one relation");
    assert.equal(m.journal.length, before.journal + 1, "one journal entry");
    assert.deepEqual(m.journal.at(-1), { op: "parallel", args: ls }, "holding its members and nothing else — no pairs");
    assert.deepEqual(m.relationOf(r).args, ls);
    solved(m);
    for (const a of ls) for (const b of ls) assert.ok(sinBetween(m, a, b) < 1e-7, `${a} ∥ ${b}`);

    // The star it replaces: the same drawing, three pairs on the first.
    const star = lines(dim, 4);
    for (const l of star.ls.slice(1)) parallel(star.m, star.ls[0], l);
    solved(star.m);
    for (const a of star.ls) for (const b of star.ls) assert.ok(sinBetween(star.m, a, b) < 1e-7, `star: ${a} ∥ ${b}`);
    // As many equations either way: n − 1 pairs' worth.
    const rows = (model: Model, names: string[]) => names.reduce((s, n) => s + model.relationOf(n).blocks.length, 0);
    assert.equal(rows(m, [r]), rows(star.m, [...star.m.relations.keys()]), "a spanning set: n − 1 pairs' rows");
    assert.equal(m.diagnose().dof, star.m.diagnose().dof, "and the same freedom left");
  });

  test(`every kind that holds among many: eq, col, coin, conc, corad, eqrad, and points level with each other — ${dim}D`, () => {
    const at = (x: number, y: number, z = 0) => (dim === 2 ? [x, y] : [x, y, z]);
    // eq: five lines, one length.
    {
      const { m, ls } = lines(dim, 5);
      const r = among(m, "equalLength", ...ls);
      assert.equal(m.relationOf(r).op, "equalLength");
      solved(m);
      for (const l of ls) close(lengthOf(m, l), lengthOf(m, ls[0]), 1e-6, `eq ${l}`);
    }
    // col: three lines on one.
    {
      const { m, ls } = lines(dim, 3);
      among(m, "collinear", ...ls);
      solved(m);
      const [a, b] = m.line(ls[0]).refs.map((p) => m.coords(p));
      for (const l of ls.slice(1)) {
        for (const p of m.line(l).refs) {
          const w = sub(m.coords(p), a), u = sub(b, a);
          const t = dotN(w, u) / dotN(u, u);
          assert.ok(len(w.map((x, i) => x - t * u[i])) < 1e-6, `${p} of ${l} on ${ls[0]}`);
        }
      }
    }
    // coin: four points, one place.
    {
      const m = new Model(dim);
      const ps = [at(0, 0), at(3, 4, 1), at(-2, 5, 2), at(6, -1, -3)].map((c) => m.addPoint(c).name);
      const r = among(m, "coincident", ...ps);
      assert.deepEqual(m.relationOf(r).args, ps);
      solved(m);
      for (const p of ps) assert.ok(len(sub(m.coords(p), m.coords(ps[0]))) < 1e-7, `${p} on ${ps[0]}`);
    }
    // conc, corad, eq and eqrad: three circles.
    for (const op of ["concentric", "coradial", "equalLength", "equalRadius"]) {
      const m = new Model(dim);
      const cs = [[0, 0, 5], [12, 3, 8], [-7, 9, 11]].map(([x, y, r]) => m.addCircle(m.addPoint(at(x, y, x / 4)).name, r).name);
      const r = among(m, op, ...cs);
      assert.deepEqual(m.relationOf(r).args, cs, op);
      solved(m);
      const centre = (c: string) => m.coords(m.circular(c).center);
      for (const c of cs) {
        if (op === "concentric" || op === "coradial") assert.ok(len(sub(centre(c), centre(cs[0]))) < 1e-6, `${op}: ${c} about ${cs[0]}'s centre`);
        if (op !== "concentric") close(m.radius(c), m.radius(cs[0]), 1e-6, `${op}: ${c}'s radius`);
      }
    }
    // Points level with each other: par of them all against one direction.
    {
      const m = new Model(dim);
      const ps = [at(0, 0), at(9, 4, 1), at(21, -3, 2), at(30, 7, 5)].map((c) => m.addPoint(c).name);
      const r = among(m, "parallel", ...ps, "origin.x");
      assert.deepEqual(m.relationOf(r).args, [...ps, "origin.x"], "the points, then what they are level along");
      solved(m);
      for (const p of ps) for (const k of dim === 2 ? [1] : [1, 2]) close(m.coords(p)[k], m.coords(ps[0])[k], 1e-7, `${p} level with ${ps[0]}`);
    }
  });
}

test("which relations hold among many, and which do not", () => {
  for (const op of ["parallel", "equalLength", "collinear", "coincident", "concentric", "coradial", "equalRadius"]) assert.ok(isAmongOp(op), op);
  for (const op of ["perpendicular", "tangent", "symmetric", "midpoint", "pointOnLine", "angle", "dist"]) assert.ok(!isAmongOp(op), op);
  const { m, ls } = lines(2, 3);
  // A datum among them is no set of equals: each line is level on its own account.
  assert.equal(amongSet(m, "parallel", [ls[0], "origin.x"]), null);
  assert.throws(() => among(m, "parallel", ls[0], ls[1], "origin.x"), /not a point, so this takes two references, not three/);
  // A line and an arc are equal in length, two arcs in radius: not one statement of three.
  const c = m.addCircle(m.addPoint([40, 40]).name, 6).name;
  assert.throws(() => among(m, "equalLength", ls[0], ls[1], c), /lines, or circles and arcs — not a mix/);
  assert.throws(() => among(m, "parallel", ls[0], ls[1], ls[0]), /takes each once: l1 is given twice/);
  // Two members is the pair relation, exactly as it journalled before.
  const pair = among(m, "parallel", ls[0], ls[1]);
  assert.deepEqual(m.relationOf(pair).args, [ls[0], ls[1]]);
  assert.equal(m.relations.size, 1, "and nothing was left behind by the refusals above");
});

test("deleting a member — the first as much as any — leaves the relation over the rest; down to two; at one it is gone", () => {
  for (const which of [0, 2]) {
    const { m, ls } = lines(2, 4);
    const r = among(m, "parallel", ...ls);
    solved(m);
    const removed = del(m, ls[which]);
    assert.deepEqual(removed, [ls[which]], "only the line went");
    const rest = ls.filter((_, i) => i !== which);
    assert.deepEqual(m.relationOf(r).args, rest, `the same relation, over the rest (member ${which} deleted)`);
    // The journal says what happened, in order: the member left, then it was deleted.
    assert.deepEqual(m.journal.slice(-2), [{ op: "leave", args: [r, ls[which]] }, { op: "deleteEntity", args: [ls[which]] }]);
    // Still parallel under a pull: turn one of the rest and solve.
    const [, q] = m.line(rest[0]).refs;
    m.setCoords(q, m.coords(q).map((x, i) => x + (i === 1 ? 9 : 0)));
    solved(m);
    for (const a of rest) for (const b of rest) assert.ok(sinBetween(m, a, b) < 1e-7, `${a} ∥ ${b} after ${ls[which]} went`);
    // Down to two…
    del(m, rest[0]);
    assert.deepEqual(m.relationOf(r).args, rest.slice(1), "two left: still the relation");
    // …and at one it is gone.
    const last = del(m, rest[1]);
    assert.deepEqual(last, [r, rest[1]], "one member is no relation: it went with the third");
    assert.equal(m.relations.has(r), false);
    // A file of all that reopens to the same thing.
    const again = open(save(m));
    assert.deepEqual([...again.relations.keys()], [...m.relations.keys()]);
    assert.deepEqual(again.journal, m.journal);
  }
});

test("a point of a member deleted takes the member, and the relation stays over the rest; what the members are level along going takes it whole", () => {
  const { m, ls } = lines(2, 3);
  const r = among(m, "equalLength", ...ls);
  const end = m.line(ls[1]).refs[0];
  const removed = del(m, end);
  assert.ok(removed.includes(ls[1]) && !removed.includes(r), `${ls[1]} went with its end; ${r} did not: ${removed}`);
  assert.deepEqual(m.relationOf(r).args, [ls[0], ls[2]]);

  // Points level along a frame's axis: the frame going leaves nothing to be level with.
  const n = new Model(2);
  const [o, x] = [n.addPoint([50, 50]).name, n.addPoint([60, 50]).name];
  const f = n.addFrame(o, x).name;
  const ps = [[0, 0], [9, 4], [21, -3]].map((c) => n.addPoint(c).name);
  const level = among(n, "parallel", ...ps, `${f}.x`);
  assert.ok(del(n, f).includes(level), "the relation went with its frame");
});

test("a typed relation naming a member joins the relation it is in: one relation, not two", async () => {
  const { m, ls } = lines(2, 6);
  const repl = new Repl(neocadScope({ model: m, arm: () => {}, view: { ox: 0, oy: 0, scale: 3 }, refresh: () => {} }));
  const run = async (text: string) => {
    const r = await repl.eval(text);
    assert.equal(r.ok, true, `${text}: ${r.error?.message ?? ""}`);
    return r.value;
  };
  const q = (n: string) => JSON.stringify(n);
  const group = await run(`par(${ls.slice(0, 4).map(q).join(", ")})`);
  assert.equal(m.relations.size, 1);
  // A member and a new line: the new line joins.
  assert.equal(await run(`par(${q(ls[2])}, ${q(ls[4])})`), group, "the relation it joined, by name");
  assert.equal(m.relations.size, 1, "one relation, not two");
  assert.deepEqual(m.relationOf(group as string).args, ls.slice(0, 5));
  assert.deepEqual(m.journal.at(-1), { op: "join", args: [group, ls[4]] }, "journalled as the joining it was");
  // A pair is a relation among two, and is joined the same way.
  const other = lines(2, 3);
  const second = neocadScope({ model: other.m }) as Record<string, (...a: string[]) => string>;
  const pair = second.eq(other.ls[0], other.ls[1]);
  assert.equal(second.eq(other.ls[1], other.ls[2]), pair);
  assert.deepEqual(other.m.relationOf(pair).args, other.ls);
  // Two members already related: nothing to add, and nothing journalled.
  const entries = m.journal.length;
  assert.equal(await run(`par(${q(ls[0])}, ${q(ls[3])})`), group);
  assert.equal(m.journal.length, entries);
  // A relation to a datum is each line's own, and is never joined.
  await run(`par(${q(ls[5])}, "origin.x")`);
  await run(`par(${q(ls[0])}, "origin.x")`);
  assert.equal(m.relations.size, 3, "two pars to the axis, beside the one among the lines");
  // Each line's length held, so the solve turns them rather than shrinking one
  // (a `par` of raw vectors is met by a short line as well as a turned one:
  // the register's review item 1, not this package's).
  for (const l of ls.slice(0, 5)) dist(m, ...(m.line(l).refs as [string, string]), lengthOf(m, l));
  solved(m);
  for (const l of ls.slice(0, 5)) assert.ok(Math.abs(dirOf(m, l)[1]) < 1e-6, `${l} is level with the axis its relation's other member is level with`);
  assert.equal(m.relations.size, 8, "and the five lengths");

  // Saved and opened: the same relations under the same names, by replaying the joins.
  const again = open(save(m));
  assert.deepEqual([...again.relations.values()].map((r) => [r.name, r.op, r.args]), [...m.relations.values()].map((r) => [r.name, r.op, r.args]));
});

test("names that bridge two relations merge them; join and leave are typed as themselves and refuse what is not of a kind", () => {
  const { m, ls } = lines(2, 7);
  const a = among(m, "parallel", ls[0], ls[1], ls[2]);
  const b = among(m, "parallel", ls[3], ls[4]);
  assert.equal(relate(m, "parallel", ls[2], ls[4]), a, "into the older of the two");
  assert.equal(m.relations.has(b), false, "the other merged in and went");
  assert.deepEqual(m.relationOf(a).args, [ls[0], ls[1], ls[2], ls[4], ls[3]]);
  solved(m);
  for (const l of ls.slice(0, 5)) assert.ok(sinBetween(m, l, ls[0]) < 1e-7);

  assert.equal(join(m, a, ls[5]), a);
  assert.equal(m.relationOf(a).args.length, 6);
  assert.equal(leave(m, a, ls[5], ls[0]), a);
  assert.deepEqual(m.relationOf(a).args, [ls[1], ls[2], ls[4], ls[3]]);
  assert.ok(m.entities.has(ls[0]), "leaving deletes nothing");

  const p = m.addPoint([1, 2]).name;
  assert.throws(() => join(m, a, p), /cannot join r1.*not all of a kind/);
  assert.equal(m.relationOf(a).args.length, 4, "a refused join changed nothing");
  assert.throws(() => leave(m, a, ls[6]), /l7 is not in r1/);
  const d = dist(m, m.line(ls[1]).refs[0], m.line(ls[1]).refs[1], 20);
  assert.throws(() => join(m, d, ls[6]), /only par, eq, col, coin, conc and corad hold among many/);
  const axis = parallel(m, ls[6], "origin.x");
  assert.throws(() => leave(m, axis, ls[6]), /held to a datum/);
  // Leaving a pair is deleting it.
  const pair = equalLength(m, ls[5], ls[6]);
  assert.equal(leave(m, pair, ls[5]), null);
  assert.equal(m.relations.has(pair), false);
  // And the whole of it replays.
  const again = open(save(m));
  assert.deepEqual([...again.relations.values()].map((r) => [r.name, r.args]), [...m.relations.values()].map((r) => [r.name, r.args]));
});

test("a replay never joins: a star made of pairs stays the separate relations it is, through save and open", () => {
  const { m, ls } = lines(2, 4);
  // What the build before typed for Parallel (all 4): each against the first.
  const star = ls.slice(1).map((l) => parallel(m, ls[0], l));
  assert.equal(new Set(star).size, 3);
  const again = open(save(m));
  assert.deepEqual([...again.relations.values()].map((r) => r.args), ls.slice(1).map((l) => [ls[0], l]));
  // Deleting the first pick of a star is what the review found: the rest are no longer related.
  del(again, ls[0]);
  assert.equal(again.relations.size, 0, "a star hangs on its first pick");
  // A typed relation naming one of them now gathers the star into one relation.
  const fifth = m.addLine(m.addPoint([0, 80]).name, m.addPoint([30, 95]).name).name;
  const one = relate(m, "parallel", ls[0], fifth);
  assert.equal(one, star[0]);
  assert.equal(m.relations.size, 1, "the three pairs and the new line: one relation");
  assert.deepEqual([...m.relationOf(one).args].sort(), [...ls, fifth].sort());
  del(m, ls[0]);
  assert.deepEqual([...m.relationOf(one).args].sort(), [...ls.slice(1), fifth].sort(), "and now the first pick is like any other");
  solved(m);
  for (const l of ls.slice(1)) assert.ok(sinBetween(m, l, fifth) < 1e-7, `${l} ∥ ${fifth} with the first pick gone`);
});

test("a conflict names a relation among many once, and an agreeing one counts once", () => {
  const { m, ls } = lines(2, 5);
  const r = among(m, "equalLength", ...ls);
  const ends = (l: string) => m.line(l).refs as [string, string];
  const d1 = dist(m, ...ends(ls[1]), 10);
  const d2 = dist(m, ...ends(ls[4]), 20);
  m.searchMs = Infinity; // what is named is asked of the trials, not of a loaded box's clock
  const names = m.conflicting(m.solve()).relations;
  assert.deepEqual([...names].sort(), [d1, d2, r].sort(), "the relation, once, and the two lengths it cannot hold together");

  // Agreeing: the set already parallel to an axis, line by line, and then to each other.
  const flat = lines(2, 3);
  for (const l of flat.ls) parallel(flat.m, l, "origin.x");
  const both = among(flat.m, "parallel", ...flat.ls);
  solved(flat.m);
  const agreeing = flat.m.diagnose().agreeing.flat();
  assert.equal(agreeing.filter((n) => n === both).length, 1, `counted once: ${JSON.stringify(flat.m.diagnose().agreeing)}`);
});

test("the constrain list types one call for many at once, and a mark sits on each member", () => {
  const { m, ls } = lines(2, 4);
  const view: View = { ox: 200, oy: 200, scale: 3 };
  const cell = constraintsFor(m, ls).find((a) => a.label === "Parallel (all 4)")!;
  assert.equal(cell.text, `par(${ls.map((l) => JSON.stringify(l)).join(", ")})`);
  const r = cell.apply(m);
  assert.equal(m.relations.size, 1);
  const marks = placeGlyphs(m, view).filter((g) => g.relation === r);
  assert.equal(marks.length, 4, "a mark for every member");
  assert.deepEqual(marks.map((g) => g.about?.[0]).sort(), [...ls].sort(), "each on its own line");
  assert.ok(marks.every((g) => g.symbol === "//"));
  // Points level with each other, and coincident: one call each.
  const pts = [[0, 0], [9, 4], [21, -3]].map((c) => m.addPoint(c).name);
  const texts = Object.fromEntries(constraintsFor(m, pts).map((a) => [a.label, a.text]));
  const q = pts.map((p) => JSON.stringify(p)).join(", ");
  assert.equal(texts["Coincident (all 3)"], `coin(${q})`);
  assert.equal(texts["Horizontal (all 3)"], `horizontal(${q})`);
  // Lines level: each its own relation to the axis, as before.
  assert.equal(constraintsFor(m, ls).find((a) => a.label === "Horizontal (all 4)")!.text, ls.map((l) => `horizontal(${JSON.stringify(l)})`).join("; "));
});

test("coincident among three joins all three for a loop's corners", () => {
  const m = new Model(2);
  const ps = [[0, 0], [0.1, 0], [0, 0.1], [50, 50]].map((c) => m.addPoint(c).name);
  among(m, "coincident", ps[0], ps[1], ps[2]);
  const classes = joinClasses(m);
  assert.equal(classes.get(ps[0]), classes.get(ps[1]));
  assert.equal(classes.get(ps[0]), classes.get(ps[2]));
  assert.notEqual(classes.get(ps[0]), classes.get(ps[3]));
});

// ============================ 6: a face is named by what it is swept from ============================

/** A 60 × 40 × 20 block on the ground, its base fixed: l1 y = 0, l2 x = 60, l3 y = 40, l4 x = 0. */
function block() {
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [60, 0], [60, 40], [0, 40]].map(([x, y]) => s.pt(x, y, 0) as string);
  const ls = pts.map((p, i) => s.ln(p, pts[(i + 1) % 4]) as string);
  for (const p of pts) fix(m, p, m.coords(p), "origin");
  const e = extrude(m, ls[0], 20);
  solved(m);
  return { m, s, e, pts, ls };
}

const offFace = (m: Model, face: string, q: number[]) => {
  const pl = planeNow(m, face)!;
  return Math.abs(dotN(sub(q, pl.p), pl.n));
};

test("a face's name: a wall by the entity it is swept from, a cap by its word, a place still read", () => {
  assert.deepEqual(parseFaceName("e1:l2"), { feature: "e1", role: "member", member: -1, entity: "l2" });
  assert.deepEqual(parseFaceName("e1.m3"), { feature: "e1", role: "member", member: 3 });
  assert.deepEqual(parseFaceName("e12.lid"), { feature: "e12", role: "lid", member: -1 });
  // What follows the colon is the user's name, so an entity called m3 or lid is no collision.
  assert.deepEqual(parseFaceName("e1:m3"), { feature: "e1", role: "member", member: -1, entity: "m3" });
  assert.deepEqual(parseFaceName("e1:lid"), { feature: "e1", role: "member", member: -1, entity: "lid" });
  for (const no of ["e1:", "e1:l2.x", "e1:l2:l3", "e1:l2|e1.lid", "l1:l2", "e1.l2", "p1.p2.p3"]) assert.equal(parseFaceName(no), null, no);
  // The name is about its feature and its entity: it goes with either.
  assert.equal(referentOf("e1:l2"), "e1");
  assert.deepEqual(referentsOf("e1:l2"), ["e1", "l2"]);
  // No entity can be called that: the colon is the namespace's, as the dot is.
  const m = new Model(2);
  assert.throws(() => m.addPoint([0, 0], "a:b"), /cannot contain a colon — "e1:l2" names the wall of e1 swept from l2/);
});

test("faceRef writes a wall by the line now in its place; faceKernelNames finds the places a name is drawn as", () => {
  const { m, e, ls } = block();
  assert.equal(faceRef(m, `${e}.m3`), `${e}:${ls[3]}`);
  assert.equal(faceRef(m, `${e}:${ls[3]}`), `${e}:${ls[3]}`, "already written");
  assert.equal(faceRef(m, `${e}.lid`), `${e}.lid`);
  assert.equal(faceRef(m, `${e}.m9`), `${e}.m9`, "no such place: left to be refused in its own words");
  assert.equal(faceRef(m, "e7.f0"), "e7.f0", "the kernel's own");
  assert.equal(faceRef(m, ls[0]), ls[0], "not a face at all");
  assert.deepEqual(faceKernelNames(m, `${e}:${ls[3]}`), [`${e}.m3`]);
  assert.deepEqual(faceKernelNames(m, `${e}.lid`), [`${e}.lid`]);
  const s = faceSource(m, `${e}:${ls[3]}`);
  assert.ok(s?.kind === "wall" && s.entity === ls[3] && s.index === 3 && s.shape === "plane" && s.whole);
  assert.equal(faceSource(m, `${e}:nosuch`), null);
  // After a fillet of the first corner an arc stands in place 1, and every wall after it has moved up.
  fillet(m, ls[0], ls[1], 5);
  assert.deepEqual(faceKernelNames(m, `${e}:${ls[3]}`), [`${e}.m4`], "the same wall, another place");
  assert.equal(faceRef(m, `${e}.m3`), `${e}:${ls[2]}`, "and the place is another wall's now");
});

test("every relation that takes a face journals a wall by its line, however it was given", () => {
  const { m, s, e, ls } = block();
  const p = m.addPoint([-6, 22, 9]).name;
  const on = onPlane(m, p, `${e}.m3`);
  assert.deepEqual(m.relationOf(on).args, [p, `${e}:${ls[3]}`]);
  assert.deepEqual(m.journal.at(-1), { op: "onPlane", args: [p, `${e}:${ls[3]}`] });
  // A second block, free to slide.
  const B = [[100, 0], [140, 0], [140, 30], [100, 30]].map(([x, y]) => s.pt(x, y, 0) as string);
  const bl = B.map((q, i) => s.ln(q, B[(i + 1) % 4]) as string);
  parallel(m, bl[0], "origin.x"); parallel(m, bl[2], "origin.x"); parallel(m, bl[1], "origin.y"); parallel(m, bl[3], "origin.y");
  const e2 = extrude(m, bl[0], 12);
  solved(m);
  const gap = faceDistance(m, `${e}.m1`, `${e2}.m3`, 35);
  assert.deepEqual(m.relationOf(gap).args, [`${e}:${ls[1]}`, `${e2}:${bl[3]}`, 35]);
  const c = s.circ(s.pt(30, 44, 10), 4) as string;
  const held = parallel(m, c, `${e}.m2`);
  assert.deepEqual(m.relationOf(held).args, [c, `${e}:${ls[2]}`]);
  const driven = measure(m, "fangle", `${e}.m0`, `${e2}.lid`);
  assert.deepEqual(m.relationOf(driven).args, ["fangle", `${e}:${ls[0]}`, `${e2}.lid`]);
  solved(m);
  close(planeNow(m, `${e2}:${bl[3]}`)!.p[0], 95, 1e-6, "the gap of 35 moved the free block");
  // Typed with the new name it reads the same; a name that sweeps no wall refuses where it is typed.
  assert.doesNotThrow(() => onPlane(m, m.addPoint([70, 20, 5]).name, `${e}:${ls[1]}`));
  assert.throws(() => onPlane(m, p, `${e}:${bl[0]}`), /is no face of a feature this drawing holds — a face is named e1\.lid, e1\.base, or e1:l2/);
  // The dimension tool and the constrain list write it the same way, from the kernel's tag of a picked face.
  assert.equal(dimensionFor(m, [`${e}.m1`, `${e2}.m3`])?.text, `fdist("${e}:${ls[1]}", "${e2}:${bl[3]}", 35)`);
  assert.equal(constraintsFor(m, [p, `${e}.m1`]).find((a) => a.label === "On face")?.text, `onplane("${p}", "${e}:${ls[1]}")`);
  assert.equal(constraintsFor(m, [bl[0], `${e}.lid`]).find((a) => a.label === "Normal to face")?.text, `par("${bl[0]}", "${e}.lid")`);
  // Saved and opened, the same names.
  const again = open(save(m));
  assert.deepEqual([...again.relations.values()].map((r) => r.args), [...m.relations.values()].map((r) => r.args));
});

test("a point held on a wall stays on that wall through a fillet, a chamfer and a trim of the profile around it", () => {
  // The fillet that used to move it: the arc joins the profile at place 1.
  {
    const { m, e, ls } = block();
    const p = m.addPoint([-6, 22, 9]).name;
    onPlane(m, p, `${e}.m3`); // l4's wall, x = 0
    solved(m);
    fillet(m, ls[0], ls[1], 5);
    solved(m);
    close(m.coords(p)[0], 0, 1e-6, "still on x = 0");
    close(m.coords(p)[1], 22, 1e-3, "and where it was along it — it used to be taken to y = 40, l3's wall");
    assert.ok(offFace(m, `${e}:${ls[3]}`, m.coords(p)) < 1e-9);
  }
  // A chamfer splits the corner with a new line: one more member, the same wall.
  {
    const { m, e, ls } = block();
    const p = m.addPoint([-6, 22, 9]).name;
    const r = onPlane(m, p, `${e}:${ls[3]}`);
    chamfer(m, ls[1], ls[2], 5);
    solved(m);
    assert.deepEqual(m.relationOf(r).args, [p, `${e}:${ls[3]}`]);
    close(m.coords(p)[0], 0, 1e-6, "on x = 0 after the chamfer");
    assert.equal(faceKernelNames(m, `${e}:${ls[3]}`)[0], `${e}.m4`, "though its place moved up one");
  }
  // A trim of a neighbour: a line across the block, and the bottom edge trimmed back to it.
  {
    const { m, s, e, ls } = block();
    const p = m.addPoint([-6, 22, 9]).name;
    onPlane(m, p, `${e}:${ls[3]}`);
    s.ln(s.pt(30, -10, 0), s.pt(30, 50, 0));
    solved(m);
    trim(m, ls[0], [45, 0, 0]);
    solved(m);
    const f = m.features.get(e)!;
    assert.ok(f.loops[0].length === 4 && f.loops[0].some((x) => typeof x !== "string"), `the profile is the left half now, a portion of the new line in it: ${JSON.stringify(f.loops)}`);
    close(m.coords(p)[0], 0, 1e-6, "on x = 0 after the trim");
    close(m.coords(p)[1], 22, 1e-3, "where it was");
  }
});

test("a distance between two solids' walls survives a fillet of each profile, and set still moves the solid", () => {
  // A 60 × 40 block held by two opposite corners and its sides level and
  // upright — so the corner between them can be rounded (a fixed corner
  // cannot: it becomes a tangent point) and its walls still stand where they
  // did: l2's at x = 60.
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [60, 0], [60, 40], [0, 40]].map(([x, y]) => s.pt(x, y, 0) as string);
  const ls = pts.map((p, i) => s.ln(p, pts[(i + 1) % 4]) as string);
  for (const p of [pts[0], pts[2]]) fix(m, p, m.coords(p), "origin");
  ls.forEach((l, i) => parallel(m, l, i % 2 ? "origin.y" : "origin.x"));
  const e = extrude(m, ls[0], 20);
  solved(m);
  const B = [[100, 0], [140, 0], [140, 30], [100, 30]].map(([x, y]) => s.pt(x, y, 0) as string);
  const bl = B.map((q, i) => s.ln(q, B[(i + 1) % 4]) as string);
  parallel(m, bl[0], "origin.x"); parallel(m, bl[2], "origin.x"); parallel(m, bl[1], "origin.y"); parallel(m, bl[3], "origin.y");
  dist(m, B[0], B[1], 40); dist(m, B[1], B[2], 30);
  const e2 = extrude(m, bl[0], 12);
  solved(m);
  const gap = faceDistance(m, `${e}.m1`, `${e2}.m3`, 40);
  solved(m);
  fillet(m, ls[0], ls[1], 5); // e1's m1 is the arc now
  fillet(m, bl[0], bl[1], 4); // e2's m3 is the top edge now
  solved(m);
  assert.deepEqual(m.relationOf(gap).args, [`${e}:${ls[1]}`, `${e2}:${bl[3]}`, 40]);
  const wallX = () => planeNow(m, `${e2}:${bl[3]}`)!.p[0];
  close(wallX(), 100, 1e-6, "the gap held through both fillets");
  set(m, `${gap}.value`, 25);
  solved(m);
  close(wallX(), 85, 1e-6, "and set moves the free block");
  close(measured(m, ["fdist", `${e}:${ls[1]}`, `${e2}:${bl[3]}`]), 25, 1e-6, "as the dimension reads");
});

test("the line a wall is swept from deleted takes the relations on the wall, and the log says so", () => {
  const { m, e, ls } = block();
  const lines: string[] = [];
  const scope = neocadScope({ model: m, log: (line: string) => lines.push(line) }) as Record<string, (...a: unknown[]) => unknown>;
  const p = m.addPoint([-6, 22, 9]).name;
  const r = onPlane(m, p, `${e}:${ls[3]}`);
  const removed = scope.del(ls[3]) as string[];
  assert.ok(removed.includes(r) && removed.includes(ls[3]), `${removed}`);
  assert.ok(m.entities.has(p), "the point stays");
  assert.ok(lines.some((l) => l === `${r} went with ${ls[3]}: it was held to ${e}:${ls[3]}, the wall of ${e} that ${ls[3]} sweeps`), lines.join(" | "));

  // And a member leaving a relation among many is said too.
  const loose = [0, 1, 2].map((i) => scope.ln(scope.pt(0, 60 + i * 10, 0), scope.pt(30, 62 + i * 13, 0)) as string);
  const par = scope.par(...loose) as string;
  lines.length = 0;
  scope.del(loose[0]);
  assert.ok(lines.some((l) => l.includes(`${par}  par ${loose[1]} ${loose[2]}`) && l.includes(`${loose[0]} left it`)), lines.join(" | "));
});

test("a wall whose line has left the profile is still read — a solve never meets a name that reads nothing", () => {
  const { m, s, e, ls } = block();
  const p = m.addPoint([66, 22, 9]).name;
  const r = onPlane(m, p, `${e}:${ls[1]}`); // l2's wall, x = 60
  s.ln(s.pt(30, -10, 0), s.pt(30, 50, 0));
  solved(m);
  trim(m, ls[0], [45, 0, 0]); // the profile is the left half: l2 bounds it no longer
  assert.ok(m.entities.has(ls[1]) && !m.features.get(e)!.loops[0].includes(ls[1]));
  assert.equal(faceSource(m, `${e}:${ls[1]}`), null, "no face of the solid");
  assert.doesNotThrow(() => solved(m));
  assert.ok(m.relations.has(r));
  close(m.coords(p)[0], 60, 1e-6, "held to the plane the line would sweep");
  // But a relation is only ever made on a face the solid has.
  assert.throws(() => onPlane(m, m.addPoint([1, 1, 1]).name, `${e}:${ls[1]}`), /is no face of a feature this drawing holds/);
});

// ---- corner: the angle between two meeting walls, by their lines ----

for (const dim of [2, 3] as const) {
  test(`corner(l1, l2, θ) is the angle in the corner two lines make, whichever way round they were drawn — ${dim}D`, () => {
    const at = (x: number, y: number) => (dim === 2 ? [x, y] : [x, y * 0.8, y * 0.6]); // 3D: in a tilted plane
    for (const flip of [false, true]) {
      const m = new Model(dim);
      const [a, b, c] = [m.addPoint(at(0, 0)).name, m.addPoint(at(50, 0)).name, m.addPoint(at(30, 40)).name];
      fix(m, a, m.coords(a), "origin");
      fix(m, b, m.coords(b), "origin");
      // Head to tail (a → b, b → c) or both out of the corner (b → a, b → c).
      const l1 = flip ? m.addLine(b, a).name : m.addLine(a, b).name;
      const l2 = m.addLine(b, c).name;
      dist(m, b, c, 40);
      const d = cornerAngle(m, l1, l2, Math.PI / 6);
      assert.equal(m.relationOf(d).op, "cornerAngle");
      assert.ok(d.startsWith("d"), "a dimension");
      solved(m);
      const u = sub(m.coords(a), m.coords(b)), w = sub(m.coords(c), m.coords(b));
      close(Math.acos(dotN(u, w) / (len(u) * len(w))), Math.PI / 6, 1e-7, `the angle at ${b} (flip ${flip})`);
      close(measured(m, ["corner", l1, l2]), Math.PI / 6, 1e-7, "as it measures");
      set(m, `${d}.value`, Math.PI / 3);
      solved(m);
      close(measured(m, ["corner", l1, l2]), Math.PI / 3, 1e-7, "set re-runs it");
      // Its gradient is not zero at its root: a small pull is answered.
      assert.ok(m.diagnose().dof >= 0);
    }
  });
}

test("two meeting walls are dimensioned by corner of their lines — and the dimension outlives a fillet of that corner", () => {
  const m = new Model(3);
  const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => unknown>;
  const pts = [[0, 0], [50, 0], [0, 28.868]].map(([x, y]) => s.pt(x, y, 0) as string);
  const ls = pts.map((q, i) => s.ln(q, pts[(i + 1) % 3]) as string);
  fix(m, pts[0], [0, 0, 0], "origin");
  parallel(m, ls[0], "origin.x");
  const e = extrude(m, ls[0], 15);
  solved(m);
  // The sharp edge is over p2 (50, 0): l1 and l2 meet there at 30°.
  const plan = dimensionFor(m, [`${e}.m0`, `${e}.m1`])!;
  assert.equal(plan.text, `corner("${ls[0]}", "${ls[1]}", deg(30))`);
  assert.equal(plan.label, "Angle between the walls");
  assert.equal(plan.driven?.text, `measure("corner", "${ls[0]}", "${ls[1]}")`);
  const d = plan.apply(m);
  dist(m, pts[0], pts[1], 50);
  solved(m);
  // Rounded off, the corner is no point any more — and the two walls still make 30°.
  fillet(m, ls[0], ls[1], 3);
  solved(m);
  assert.ok(m.relations.has(d), "the dimension is still there");
  close((measured(m, ["corner", ls[0], ls[1]]) * 180) / Math.PI, 30, 1e-5, "and still reads the walls' angle");
  set(m, `${d}.value`, Math.PI / 4);
  solved(m);
  const [u, w] = [dirOf(m, ls[0]), dirOf(m, ls[1])];
  close(Math.acos(Math.abs(dotN(u, w)) / (len(u) * len(w))), Math.PI / 4, 1e-6, "set turns the wall, fillet and all");
  // The glyph is at the corner the lines make, about both.
  const mark = placeGlyphs(m, { ox: 200, oy: 200, scale: 3 }).find((g) => g.relation === d)!;
  assert.equal(mark.symbol, "45°");
  assert.deepEqual(mark.about, [ls[0], ls[1]], "about the two lines, not a corner point");
});

// ---- the hand: a picked face is its line's wall, and is lit wherever it is drawn ----

test("a face picked is handed on by its line, and lit by the places it is drawn as", () => {
  const { m, e, ls } = block();
  const view: View = orbitBy(orbitBy({ ox: 400, oy: 300, scale: 4 }, 0, -1.0), -0.8, 0);
  const faces = visibleFaces(m, view);
  const drawn = { faces, occ: occlusion(faces, view) };
  const [sx, sy] = worldToScreen(view, [60, 20, 10]);
  const raw = pickSolid(null, drawn, sx, sy, (f) => f);
  assert.equal(raw?.name, `${e}.m1`, "a drawn face carries the kernel's tag");
  const pick = pickSolid(null, drawn, sx, sy, (f) => `tag of ${f}`, (tag) => faceRef(m, tag));
  assert.equal(pick?.name, `${e}:${ls[1]}`);
  assert.equal(pick?.tag, `tag of ${e}:${ls[1]}`);
  const lit = faceShade(drawn, faceKernelNames(m, `${e}:${ls[1]}`), view);
  assert.ok(lit.cells.length > 20, "lit where it is in front");
  assert.deepEqual(faceShade(drawn, `${e}.m1`, view).cells.length, lit.cells.length, "the same cells as by its tag");
  assert.equal(faceShade(drawn, faceKernelNames(m, `${e}:nosuch`), view).cells.length, 0);
});

// ============================ old files ============================

interface Geometry {
  points: Record<string, number[]>;
  radii: Record<string, number>;
  relations: { name: string; op: string; args: unknown[] }[];
  features: string[];
}

test("a format-19 file's stars reopen as the separate relations they were, and its walls by their lines; re-saved in today's form, stably", async () => {
  const text = await fixture("review-relations-v19.neocad.json");
  const was = JSON.parse(await fixture("review-relations-v19.geometry.json")) as Geometry;
  assert.equal(JSON.parse(text).version, 19);
  assert.equal(VERSION, 21);
  const m = open(text);
  // Every point where that build had it, before and after a solve.
  const worst = () => Math.max(...Object.entries(was.points).map(([p, at]) => len(sub(m.coords(p), at))));
  assert.ok(worst() < 1e-12, "opened where it was saved");
  solved(m);
  assert.ok(worst() < 1e-6, `and a solve moves nothing: ${worst()}`);
  // Relation for relation, under the same names: nothing joined, nothing migrated but a wall's name.
  // (Beside them, each relation within an extrude's profile has its twin on the other profile now —
  // docs/plans/linked-profiles.md — under a name derived from its own, which claims none of these.)
  assert.deepEqual([...m.relations.values()].filter((r) => !r.twin).map((r) => r.name), was.relations.map((r) => r.name));
  assert.ok([...m.relations.values()].some((r) => r.twin), "the file's extrude is linked from the moment it opens");
  const now = new Map([...m.relations.values()].map((r) => [r.name, r]));
  let stars = 0, walls = 0;
  for (const old of was.relations) {
    const r = now.get(old.name)!;
    assert.equal(r.op, old.op, old.name);
    const place = old.args.some((a) => typeof a === "string" && /^e\d+\.m\d+$/.test(a));
    if (!place) {
      assert.deepEqual(r.args, old.args, `${old.name} as it was`);
      if (isAmongOp(old.op) && old.args.length === 2 && amongSet(m, old.op, old.args)) stars++;
      continue;
    }
    walls++;
    old.args.forEach((a, i) => {
      const p = parseFaceName(a);
      if (p?.role === "member") {
        const written = parseFaceName(r.args[i]);
        assert.ok(written?.entity !== undefined && written.feature === p.feature, `${old.name}: ${String(a)} is written ${String(r.args[i])}`);
        assert.equal(faceKernelNames(m, r.args[i] as string)[0], a, "the line in the place the file named");
      } else assert.deepEqual(r.args[i], a);
    });
  }
  assert.equal(stars, 12, "three pars and three eqs of lines, two coins, two concs and two eqs of circles: each a pair on a first pick");
  assert.equal(walls, 5, "onplane, fdist, onplane, par and fangle named a wall by its place");
  // The star is still a star: the first pick deleted takes the pairs on it.
  const copy = open(text);
  const first = was.relations.find((r) => r.op === "parallel" && r.args.length === 2 && r.args.every((a) => copy.entities.get(String(a))?.kind === "line"))!.args[0] as string;
  const gone = del(copy, first);
  assert.equal(gone.filter((n) => copy.relations.has(n) === false && /^r/.test(n)).length, 6, "three pars and three eqs went with the first line");
  // Re-saved: the current version, no place left in it, and the same again from there.
  const saved = save(m);
  assert.equal(JSON.parse(saved).version, 21);
  assert.ok(!/"e\d+\.m\d+"/.test(saved), "no wall is written by its place");
  assert.equal(save(open(saved)), saved, "stable");
  const twice = open(saved);
  assert.deepEqual([...twice.relations.values()].map((r) => [r.name, r.args]), [...m.relations.values()].map((r) => [r.name, r.args]));
});

test("a format-19 file whose wall a fillet had renumbered reopens on the wall the relation was made on", async () => {
  const text = await fixture("review-relations-drift-v19.neocad.json");
  const was = JSON.parse(await fixture("review-relations-drift-v19.geometry.json")) as Geometry & { heldPoint: string; madeOn: string; before: number[] };
  const old = was.relations.find((r) => r.op === "onPlane" && r.args[0] === was.heldPoint)!;
  assert.deepEqual(old.args, [was.heldPoint, "e1.m3"], "the file says a place");
  // That build made it on l4's wall (x = 0) and, the fillet done, held the point to l3's (y = 40).
  close(was.before[0], 0, 1e-6, "made on x = 0");
  close(was.points[was.heldPoint][1], 40, 1e-6, "saved on y = 40, where the renumbering took it");
  const m = open(text);
  const r = m.relationOf(old.name);
  assert.deepEqual(r.args, [was.heldPoint, `e1:${was.madeOn}`], "resolved at its own step: the line then in place 3");
  // Put back where it was first placed, it is held to the wall it was put on.
  m.setCoords(was.heldPoint, [-6, 22, 9]);
  solved(m);
  close(m.coords(was.heldPoint)[0], 0, 1e-6, "x = 0, l4's wall");
  close(m.coords(was.heldPoint)[1], 22, 1e-3, "and not dragged to y = 40");
  assert.equal(save(open(save(m))), save(m));
});

test("a format-19 wedge dimensioned by ang3 reopens with its ang3: three points a user may pick are still a dimension", async () => {
  const text = await fixture("review-relations-wedge-v19.neocad.json");
  const was = JSON.parse(await fixture("review-relations-wedge-v19.geometry.json")) as Geometry;
  const m = open(text);
  solved(m);
  const d = [...m.relations.values()].find((r) => r.op === "angle3")!;
  assert.deepEqual(d.args.slice(0, 3), was.relations.find((r) => r.op === "angle3")!.args.slice(0, 3));
  set(m, `${d.name}.value`, Math.PI / 4);
  solved(m);
  close(measured(m, ["angle3", ...(d.args.slice(0, 3) as string[])]), Math.PI / 4, 1e-6, "and still sets");
  // What the tool makes today for the same two walls names their lines.
  assert.match(dimensionFor(m, ["e1.m0", "e1.m1"])!.text, /^corner\("l1", "l2", deg\(45\)\)$/);
});
