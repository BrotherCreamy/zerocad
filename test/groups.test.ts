// Groups, hide and show (docs/plans/groups.md, phase 1).
//
// The owner's concept: flat relational direct CAD — "there is no hierarchy …
// and entities can be grouped". So these hold a group to being a **set**: it
// owns nothing, membership overlaps, a group never holds a group (naming one
// adds its members, a union and not a link), and a feature is a read-only
// group. Deleting a member takes it out of its groups, journalled as part of
// the deletion's expansion — and an emptied group stays, empty, since
// docs/plans/organiser.md (a group made to be drawn into starts empty). Hidden is not drawn,
// picked, snapped or boxed — and still solved. All of it journalled, saved and
// replayed byte for byte.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { dist, fix } from "../src/relations/basic.ts";
import { parallel } from "../src/relations/geometry.ts";
import { del, extrude } from "../src/operations.ts";
import { addTo, group, groupsOf, hide, members, removeFrom, show, ungroup } from "../src/groups.ts";
import { open, save } from "../src/persist.ts";
import { describePick, hitTest } from "../src/picking.ts";
import { findSnap } from "../src/snapping.ts";
import { selectInBox } from "../src/boxselect.ts";
import { placeGlyphs } from "../src/glyphs.ts";
import { visibleFaces } from "../src/faces.ts";
import { menuFor, type Menu } from "../src/menu.ts";
import { Repl } from "../src/repl.ts";
import { neocadScope } from "../src/replenv.ts";
import { worldToScreen, type View } from "../src/view.ts";
import { axisFrame, tiltedFrame } from "./frames.ts";
import { polygon } from "./profiles.ts";

async function loadKernel() {
  const bytes = await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

/** A 2D rectangle p1..p4 / l1..l4 and a separate line l5 (p5–p6), with the fixture frame. */
async function sketch() {
  await loadKernel();
  const m = new Model(2);
  axisFrame(m);
  m.addPoint([0, 0], "p1");
  m.addPoint([40, 0], "p2");
  m.addPoint([40, 30], "p3");
  m.addPoint([0, 30], "p4");
  m.addLine("p1", "p2", "l1");
  m.addLine("p2", "p3", "l2");
  m.addLine("p3", "p4", "l3");
  m.addLine("p4", "p1", "l4");
  m.addPoint([80, 0], "p5");
  m.addPoint([80, 30], "p6");
  m.addLine("p5", "p6", "l5");
  return m;
}

/** A tilted 3D square extruded 20: the feature e1, on profile `lines`. */
async function solid() {
  await loadKernel();
  const m = new Model(3);
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [40, 0], [40, 30], [0, 30]]);
  extrude(m, lines[0], 20);
  return { m, points, lines };
}

const ops = (m: Model) => m.journal.map((e) => e.op);

// --- making and editing -------------------------------------------------------

test("group names a set — g1, g2, or a name given — and owns nothing", async () => {
  const m = await sketch();
  assert.equal(group(m, "l1", "l2"), "g1");
  assert.equal(group(m, "l2", "l3", { name: "walls" }), "walls");
  assert.deepEqual(members(m, "g1"), ["l1", "l2"]);
  assert.deepEqual(groupsOf(m, "l2"), ["g1", "walls"], "membership overlaps");
  assert.deepEqual(groupsOf(m), ["g1", "walls"]);
  assert.throws(() => group(m, "l1", { name: "g1" }), /already exists/, "the model's name rules: unique");
  assert.throws(() => group(m, "l1", { name: "a.b" }), /cannot contain a dot/, "and no dot");
  assert.throws(() => group(m, "l1", "nope"), /"nope" is not an entity, a relation, a group or a feature/);
  assert.equal(m.groups.size, 2, "a refused group made nothing");
  assert.equal(group(m, "l4"), "g2", "and claimed no name");
  assert.equal(group(m), "g3", "an empty group is a group (organiser.md: one made to draw into starts empty)");
  // Journalled with its members resolved and its name.
  assert.deepEqual(m.journal.at(-2), { op: "group", args: ["l4", { name: "g2" }] });
});

test("naming a group flattens it, there and then: a union, not a link — a group never holds a group", async () => {
  const m = await sketch();
  group(m, "l1", "l2");
  group(m, "g1", "l5");
  assert.deepEqual(members(m, "g2"), ["l1", "l2", "l5"], "g1's members, not g1");
  addTo(m, "g1", "l3");
  assert.deepEqual(members(m, "g2"), ["l1", "l2", "l5"], "g1 changing afterwards does not reach g2");
  assert.deepEqual(m.journal.at(-2), { op: "group", args: ["l1", "l2", "l5", { name: "g2" }] });
  assert.throws(() => m.addGroup(["g1"]), /holds entities and relations/, "not even through the primitive");
});

test("addTo and removeFrom: flattened, checked first, a no-op journals nothing, and an emptied group stays", async () => {
  const m = await sketch();
  const r = parallel(m, "l1", "f.x");
  group(m, "l1");
  assert.deepEqual(addTo(m, "g1", "l2", r), ["l1", "l2", r], "relations are members too");
  const n = m.journal.length;
  assert.deepEqual(addTo(m, "g1", "l1"), ["l1", "l2", r]);
  assert.equal(m.journal.length, n, "adding what is there changes nothing, so journals nothing");
  assert.throws(() => removeFrom(m, "g1", "l2", "l5"), /"l5" is not in g1/);
  assert.deepEqual(members(m, "g1"), ["l1", "l2", r], "refused before anything changed");
  assert.deepEqual(removeFrom(m, "g1", "l2"), ["l1", r]);
  assert.deepEqual(removeFrom(m, "g1", "l1", r), [], "emptied");
  assert.equal(m.groups.has("g1"), true, "a group may be empty (organiser.md reversed groups.md here)");
  assert.deepEqual(addTo(m, "g1", "l1"), ["l1"], "and filled again");
});

test("ungroup and del(g) take the grouping and never a member", async () => {
  const m = await sketch();
  group(m, "l1", "l2");
  group(m, "l3");
  assert.deepEqual(ungroup(m, "g1"), ["l1", "l2"]);
  assert.ok(m.entities.has("l1") && m.entities.has("l2"));
  assert.deepEqual(del(m, "g2"), ["g2"]);
  assert.ok(m.entities.has("l3"), "del of a group is ungroup");
  assert.deepEqual(m.journal.slice(-2), [{ op: "ungroup", args: ["g1"] }, { op: "ungroup", args: ["g2"] }]);
});

test("a feature is a read-only group: read as one anywhere, edited as one nowhere", async () => {
  const { m, lines } = await solid();
  const f = m.featureOf("e1");
  assert.deepEqual(members(m, "e1"), f.owns, "what the extrude made");
  assert.equal(group(m, "e1"), "g1");
  assert.deepEqual(members(m, "g1"), f.owns, "flattened like a group");
  assert.ok(!members(m, "g1").includes(lines[0]), "the profile is the sketch's, not the feature's");
  assert.throws(() => addTo(m, "e1", lines[0]), /"e1" is a feature — its members follow its profile/);
  assert.throws(() => removeFrom(m, "e1", f.owns[0]), /is a feature/);
  assert.throws(() => ungroup(m, "e1"), /is a feature, not a group — del\("e1"\)/);
});

// --- the deletion cascade -----------------------------------------------------

test("deleting a member takes it out of its groups, an emptied group stays, and the journal says so", async () => {
  const m = await sketch();
  group(m, "l1", "l2");
  group(m, "l5");
  // p5 takes l5 with it, which empties g2 — and g2 stays.
  const removed = del(m, "p5");
  assert.deepEqual(removed, ["l5", "p5"], "the emptied group is not among what went");
  assert.deepEqual(members(m, "g2"), []);
  del(m, "l1");
  assert.deepEqual(members(m, "g1"), ["l2"]);
  // The expansion: each group a name leaves is a `removeFrom` before the
  // primitive that deletes it.
  const tail = m.journal.slice(-5);
  assert.deepEqual(tail, [
    { op: "removeFrom", args: ["g2", "l5"] },
    { op: "deleteEntity", args: ["l5"] },
    { op: "deleteEntity", args: ["p5"] },
    { op: "removeFrom", args: ["g1", "l1"] },
    { op: "deleteEntity", args: ["l1"] },
  ]);
  const reopened = open(save(m));
  assert.deepEqual([...reopened.groups.values()], [...m.groups.values()], "and a replay agrees");
});

// A deleted feature used to take what it made, and so empty the group. It
// takes only its depth now (docs/plans/linked-profiles.md): the lid and the
// walls are plain geometry, and still grouped.
test("deleting a relation leaves its groups too; deleting a feature leaves what it made, still in its group", async () => {
  const { m } = await solid();
  const f = m.featureOf("e1");
  group(m, "e1");
  del(m, "e1");
  const made = f.owns.filter((n) => m.entities.has(n));
  assert.ok(made.length > 0 && made.length === f.owns.length - 1, "everything it made but its depth is still there");
  assert.deepEqual(members(m, "g1"), made, "and still grouped: only the depth, a relation deleted, left the group");
  assert.ok(ops(m).includes("removeFrom"));
  assert.equal(m.hidden.size, 0);
});

// --- hide and show --------------------------------------------------------------

/** The identity view, y flipped — a world (x, y) is drawn at (x, −y). */
const VIEW: View = { ox: 0, oy: 0, scale: 1 };

test("hidden is not picked, snapped to, boxed or glyphed — and is still solved", async () => {
  const m = await sketch();
  const r = dist(m, "p5", "p6", 50);
  group(m, "l5", "p5", "p6");
  assert.deepEqual(hide(m, "g1"), ["l5", "p5", "p6"]);
  assert.deepEqual(m.journal.at(-1), { op: "hide", args: ["g1"] }, "journalled as typed");
  const [sx, sy] = worldToScreen(VIEW, [80, 15]);
  assert.equal(hitTest(m, VIEW, sx, sy), null, "the hidden line does not pick");
  const [px, py] = worldToScreen(VIEW, [80, 0]);
  assert.equal(hitTest(m, VIEW, px, py), null, "nor its point");
  assert.equal(findSnap(m, VIEW, px, py), null, "nor snap");
  assert.deepEqual(selectInBox(m, VIEW, { x0: 60, y0: -60, x1: 100, y1: 20 }, "window"), [], "nor box");
  assert.equal(placeGlyphs(m, VIEW).some((g) => g.relation === r), false, "a mark on what is hidden is not drawn");
  m.solve();
  assert.ok(Math.abs(Math.hypot(...m.coords("p6").map((v, i) => v - m.coords("p5")[i])) - 50) < 1e-6,
    "the hidden dimension still holds: hidden is still solved");
  assert.deepEqual(show(m, "p5"), ["p5"]);
  const [qx, qy] = worldToScreen(VIEW, m.coords("p5")); // the solve moved it
  assert.equal(hitTest(m, VIEW, qx, qy)?.name, "p5", "shown, it picks again");
  assert.deepEqual(show(m).sort(), ["l5", "p6"], "show() shows everything");
  const n = m.journal.length;
  assert.deepEqual(show(m), [], "and with nothing hidden");
  assert.equal(m.journal.length, n, "journals nothing");
  assert.throws(() => hide(m), /hide needs a name/);
  assert.throws(() => hide(m, "nope"), /"nope" is not/);
});

test("a hidden feature's faces are not drawn; a hidden sketch leaves the solid's faces and its depth label alone", async () => {
  const { m, lines } = await solid();
  const view: View = { ox: 400, oy: 300, scale: 3 };
  const faces = visibleFaces(m, view).length;
  assert.ok(faces > 0);
  group(m, ...lines);
  hide(m, "g1");
  assert.equal(visibleFaces(m, view).length, faces, "the solid stays");
  assert.ok(placeGlyphs(m, view).some((g) => g.relation === m.featureOf("e1", "extrude").depth),
    "the feature's own dimension is the solid's, and is drawn while the solid is");
  hide(m, "e1");
  assert.equal(visibleFaces(m, view).length, 0, "the solid's faces go with it");
  assert.ok(m.hidden.has("e1") && m.featureOf("e1").owns.every((n) => m.hidden.has(n)));
  show(m, "e1");
  assert.equal(visibleFaces(m, view).length, faces);
});

test("deleting something hidden drops it from the hidden set, which replay agrees with", async () => {
  const m = await sketch();
  hide(m, "l5");
  del(m, "l5");
  assert.equal(m.hidden.size, 0);
  assert.equal(open(save(m)).hidden.size, 0);
});

// --- persistence ----------------------------------------------------------------

test("groups and hidden things in the history save and reopen byte for byte, through every op", async () => {
  const { m, lines } = await solid();
  group(m, lines[0], lines[1]);                    // group
  addTo(m, "g1", lines[2]);                        // addTo
  group(m, "e1", { name: "body" });                // a feature flattened
  removeFrom(m, "g1", lines[1]);                   // removeFrom
  group(m, lines[3]);
  ungroup(m, "g2");                                // ungroup
  hide(m, "g1");                                   // hide
  hide(m, "e1");
  show(m, lines[0]);                               // show
  del(m, m.featureOf("e1", "extrude").walls[0]);              // a deletion leaving a group
  m.solve();
  for (const op of ["group", "addTo", "removeFrom", "ungroup", "hide", "show"]) assert.ok(ops(m).includes(op), op);

  const once = save(m);
  const reopened = open(once);
  assert.deepEqual([...reopened.groups.entries()], [...m.groups.entries()]);
  assert.deepEqual([...reopened.hidden].sort(), [...m.hidden].sort());
  assert.equal(save(reopened), once, "byte for byte");
  assert.equal(save(open(save(reopened))), once, "and again");
});

// --- what the pointer layer reads -------------------------------------------------

test("the hover tag ends with the groups a thing is in", async () => {
  const m = await sketch();
  group(m, "l1");
  group(m, "l1", "l2", { name: "edges" });
  const tag = describePick(m, { name: "l1", kind: "line", distance: 0 });
  assert.match(tag, / {2}· {2}g1 edges$/);
});

const labels = (menu: Menu) => menu.items.map((i) => i.label);
const command = (menu: Menu, label: string) => {
  const a = menu.items.find((i) => i.label === label)?.action;
  return a?.do === "run" ? a.command : null;
};

test("the menu: Group, Delete and Hide on the selection; Select g1 on a member; Show all while anything is hidden", async () => {
  const m = await sketch();
  const sel = ["l1", "l2"];
  const on = menuFor(m, { name: "l1", kind: "line", distance: 0 }, null, null, null, sel);
  assert.deepEqual(labels(on).slice(0, 3), ["Group", "Delete", "Hide"]);
  assert.equal(command(on, "Group"), 'group("l1", "l2")');
  assert.equal(command(on, "Hide"), 'hide("l1", "l2")');
  group(m, "l1", "l3");
  const member = menuFor(m, { name: "l1", kind: "line", distance: 0 });
  assert.equal(command(member, "Select g1"), 'select("g1")');
  assert.ok(!labels(menuFor(m, null)).includes("Show all"));
  hide(m, "l5");
  assert.equal(command(menuFor(m, null), "Show all"), "show()");
  const single = menuFor(m, { name: "l2", kind: "line", distance: 0 }, null, null, null, ["l2"]);
  assert.deepEqual(labels(single).slice(0, 4), ["Insert name", "Delete", "Group", "Hide"],
    "the one thing selected: its own menu, with the selection's other items");
});

test("the command surface: ls lists groups and what is hidden; select expands a group and leaves hidden out", async () => {
  const m = await sketch();
  let held: readonly string[] = [];
  const said: string[] = [];
  const repl = new Repl(neocadScope({
    model: m,
    log: (line) => { said.push(line); },
    selection: (names) => {
      if (names !== undefined) held = [...names];
      return [...held];
    },
  }));
  const run = async (src: string) => {
    const r = await repl.eval(src);
    assert.equal(r.ok, true, `${src}: ${r.error?.message}`);
    return r.value;
  };
  assert.equal(await run('group("l1", "l2")'), "g1");
  assert.equal(await run('group("g1", "l3")'), "g2");
  assert.match(said.join("\n"), /g1 added as its members now/, "the flattening says so");
  await run('hide("l2")');
  assert.deepEqual(await run('select("g2")'), ["l1", "l3"], "g2's members, the hidden one left out");
  assert.match(said.at(-1)!, /l2 is hidden, so not selected/);
  const ls = (await run("ls()")) as string[];
  assert.ok(ls.includes("g1  group of l1 l2"));
  assert.ok(ls.some((l) => l.startsWith("l2") && l.endsWith("(hidden)")));
  assert.deepEqual(await run('members("g2")'), ["l1", "l2", "l3"]);
  assert.deepEqual(await run('groups("l1")'), ["g1", "g2"]);
  assert.deepEqual(await run('removeFrom("g1", "l1", "l2")'), []);
  assert.match(said.at(-1)!, /g1 is empty now — ungroup\("g1"\) removes it/);
  assert.deepEqual(await run("show()"), ["l2"]);
});

test("a fix on a hidden point still holds when the sketch is reopened", async () => {
  const m = await sketch();
  fix(m, "p1", [5, 5]);
  hide(m, "p1");
  const reopened = open(save(m));
  reopened.solve();
  assert.deepEqual(reopened.coords("p1").map((v) => Math.round(v * 1e6) / 1e6), [5, 5]);
  assert.ok(reopened.hidden.has("p1"));
});
