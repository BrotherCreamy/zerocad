// Every operation that makes geometry from geometry holds what it means both
// ways (docs/plans/profiles-held.md, the audit table). The owner: *"Part of the
// concept of this CAD is to have bidirectional relationships everywhere by
// default."*
//
// Each row: the operation in a fresh 3D document (nothing picked to sketch on,
// so nothing holds anything to a plane — the owner's "every sketch is a 3D
// sketch"), then a drag of the copy and a drag of the original, in the plane
// and out of it, and the property the operation means checked after each.
// The property is the operation's own, in closed form; never "it solved".
//
// Measured before the fixes (2026-11-08): an offset's copy left its
// original's plane by 3.2–3.6 when either was pulled 9 out of it; a revolve's
// axis left its profile's plane by 5.3 when a profile corner was pulled 8 off;
// a circular pattern turned its copies about the ground's z, which nobody
// picked, so a tilted seed's copies stood 22–29 off the seed's plane. Mirror,
// linear pattern, sketch fillet and chamfer, trim and the lid's twins held.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../src/kernel/problem.ts";
import { Model } from "../src/model.ts";
import { onCircle, parallel, perpendicular } from "../src/relations/geometry.ts";
import { revolve, extrude } from "../src/operations.ts";
import { neocadScope } from "../src/replenv.ts";
import { pullTo } from "../src/tools/engine.ts";
import { baseOf } from "./profiles.ts";
import "../src/modules/builtin.ts";

async function loadKernel() {
  await ensureKernelLoaded(await readFile(new URL("../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url)));
}

const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]);
const add = (a: number[], b: number[]) => a.map((x, i) => x + b[i]);
const mul = (a: number[], k: number) => a.map((x) => x * k);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);
const len = (a: number[]) => Math.hypot(...a);
const unit = (a: number[]) => mul(a, 1 / len(a));

/** A drag as the engine does one: frames of pulls toward a moving target, then the release's solve. */
function drag(m: Model, p: string, by: number[]): boolean {
  const from = m.coords(p);
  for (let k = 1; k <= 12; k++) m.solveFrame(pullTo(m, p, from.map((c, i) => c + (by[i] * k) / 12)));
  return m.solve().solved;
}

/** A rectangle as the tool draws one with nothing picked: four free points, par, par, perp. */
function rect(m: Model, at = [0, 0, 0], w = 40, h = 30) {
  const P = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => m.addPoint([at[0] + x, at[1] + y, at[2]]).name);
  const L = P.map((p, i) => m.addLine(p, P[(i + 1) % 4]).name);
  parallel(m, L[0], L[2]); parallel(m, L[1], L[3]); perpendicular(m, L[0], L[1]);
  return { P, L };
}

const C = (m: Model, n: string) => m.coords(n);
const ends = (m: Model, l: string) => m.line(l).refs.map((p) => C(m, p));
/** The unit normal of the plane through three points. */
const planeOf = (a: number[], b: number[], c: number[]) => unit(cross(sub(b, a), sub(c, a)));

interface Row {
  /** What the operation leaves, and the copy and original points a hand would grab. */
  build(m: Model, s: Record<string, (...a: unknown[]) => any>): { check(): Record<string, number>; copy: string; orig: string };
}

const OUT = [3, -2, 9], IN = [4, -3, 0];

const ROWS: Record<string, Row> = {
  "offset: the copy parallel to its original, the distance away, in its plane": {
    build(m, s) {
      const { P, L } = rect(m);
      const copies: string[] = s.offset(L, 5);
      return {
        copy: m.line(copies[0]).refs[0], orig: P[2],
        check() {
          const n = planeOf(C(m, P[0]), C(m, P[1]), C(m, P[3]));
          let par = 0, dist = 0, flat = 0;
          copies.forEach((c, i) => {
            const [a, b] = ends(m, L[i]), [q, r] = ends(m, c);
            const u = unit(sub(b, a));
            par = Math.max(par, len(cross(u, unit(sub(r, q)))));
            const d = sub(q, a);
            dist = Math.max(dist, Math.abs(len(sub(d, mul(u, dot(d, u)))) - 5));
            flat = Math.max(flat, Math.abs(dot(sub(q, C(m, P[0])), n)), Math.abs(dot(sub(r, C(m, P[0])), n)));
          });
          return { parallel: par, distance: dist, "in the original's plane": flat };
        },
      };
    },
  },
  "mirror: each copy the original's half-turn about the line": {
    build(m, s) {
      const { P, L } = rect(m);
      const a = m.addPoint([-10, -20, 0]).name, b = m.addPoint([-10, 50, 0]).name;
      const ax = m.addLine(a, b).name;
      s.mirror(L, ax);
      const pairs = [...m.relations.values()].filter((r) => r.op === "symmetric" && P.includes(r.args[0] as string)).map((r) => r.args as string[]);
      assert.equal(pairs.length, 4);
      return {
        copy: pairs[0][1], orig: P[2],
        check() {
          const o = C(m, a), u = unit(sub(C(m, b), o));
          let e = 0;
          for (const [p, q] of pairs) {
            const foot = add(o, mul(u, dot(sub(C(m, p), o), u)));
            e = Math.max(e, len(sub(C(m, q), sub(mul(foot, 2), C(m, p)))));
          }
          return { "half-turn": e };
        },
      };
    },
  },
  "linear pattern: every copy the seed moved by its step": {
    build(m, s) {
      const { P, L } = rect(m);
      s.linear(L, 60, 0, 3);
      const tr = [...m.relations.values()].filter((r) => r.op === "translated").map((r) => r.args as string[]);
      return {
        copy: tr.at(-1)![1], orig: P[2],
        check() {
          let e = 0;
          for (const [q, q2, p, p2] of tr) e = Math.max(e, len(sub(sub(C(m, q2), C(m, q)), sub(C(m, p2), C(m, p)))));
          return { "moved by the step": e };
        },
      };
    },
  },
  "circular pattern: every copy the seed turned about the seed's own normal through the centre": {
    build(m, s) {
      const { P, L } = rect(m, [20, -15, 0]);
      const c = m.addPoint([0, 0, 0]).name;
      const made: string[] = s.circular(L, c, 2 * Math.PI, 3);
      // Each copy of each seed corner: the corners of the copies, matched by the copy's names (p1_2, p1_3, …).
      const copies = (p: string) => [...m.entities.keys()].filter((n) => n.startsWith(`${p}_`) && m.entities.get(n)!.kind === "point");
      assert.ok(made.length > 0 && copies(P[0]).length === 2, `copies named after their seeds: ${made}`);
      return {
        copy: copies(P[2])[0], orig: P[2],
        check() {
          const n = planeOf(C(m, P[0]), C(m, P[1]), C(m, P[3]));
          const o = C(m, c);
          let flat = 0, radius = 0, turn = 0;
          for (const p of P) {
            const v = sub(C(m, p), o);
            copies(p).forEach((q, k) => {
              const w = sub(C(m, q), o);
              flat = Math.max(flat, Math.abs(dot(w, n) - dot(v, n)));
              radius = Math.max(radius, Math.abs(len(w) - len(v)));
              // The turn about n, read in the plane square to it: 120° per copy.
              const [vf, wf] = [sub(v, mul(n, dot(v, n))), sub(w, mul(n, dot(w, n)))];
              const ang = Math.atan2(dot(cross(vf, wf), n), dot(vf, wf));
              const want = ((2 * Math.PI) / 3) * (k + 1);
              turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(ang - want), Math.cos(ang - want))));
            });
          }
          return { "in the seed's plane": flat, "as far from the centre": radius, "turned 120° a copy": turn };
        },
      };
    },
  },
  "sketch fillet: the arc tangent to both legs, in their plane, at its radius": {
    build(m, s) {
      const { P, L } = rect(m);
      const arc: string = s.fillet(L[0], L[1], 6);
      const e = m.entities.get(arc) as unknown as { center: string; start: string; end: string };
      return {
        copy: e.center, orig: P[2],
        check() {
          const ctr = C(m, e.center), n = unit(m.normalOf(arc));
          let tan = 0, inplane = 0;
          for (const l of [L[0], L[1]]) {
            const end = [e.start, e.end].find((p) => m.line(l).refs.includes(p))!;
            const [a, b] = ends(m, l);
            const u = unit(sub(b, a));
            tan = Math.max(tan, Math.abs(dot(unit(sub(C(m, end), ctr)), u)));
            inplane = Math.max(inplane, Math.abs(dot(u, n)));
          }
          return { tangent: tan, "in the legs' plane": inplane, radius: Math.abs(len(sub(C(m, e.start), ctr)) - 6) };
        },
      };
    },
  },
  "sketch chamfer: the corner at the legs' crossing, each end its setback along its leg": {
    build(m, s) {
      const { P, L } = rect(m);
      const line: string = s.chamfer(L[0], L[1], 5);
      const [T1, T2] = m.line(line).refs;
      const corner = P[1];
      return {
        copy: T1, orig: P[3],
        check() {
          const [a] = ends(m, L[0]), [, b] = ends(m, L[1]);
          const k = C(m, corner);
          return {
            "on leg 1": len(cross(unit(sub(k, a)), unit(sub(C(m, T1), a)))), "setback 1": Math.abs(len(sub(C(m, T1), k)) - 5),
            "on leg 2": len(cross(unit(sub(b, k)), unit(sub(b, C(m, T2))))), "setback 2": Math.abs(len(sub(C(m, T2), k)) - 5),
          };
        },
      };
    },
  },
  "trim: the kept piece's cut end stays on the curve that cut it": {
    build(m, s) {
      const a = m.addPoint([0, 0, 0]).name, b = m.addPoint([40, 0, 0]).name;
      const l = m.addLine(a, b).name;
      const c = m.addPoint([20, -10, 0]).name, d = m.addPoint([20, 10, 0]).name;
      const cutter = m.addLine(c, d).name;
      s.trim(l, [35, 0, 0]);
      const kept = [...m.entities.values()].find((e) => e.kind === "line" && e.name !== cutter && (e as { refs: string[] }).refs.includes(a))!.name;
      const cut = m.line(kept).refs.find((p) => p !== a)!;
      return {
        copy: cut, orig: d,
        check() {
          const [p, q] = ends(m, cutter);
          return { "on the cutter": len(cross(sub(C(m, cut), p), unit(sub(q, p)))) };
        },
      };
    },
  },
  "extrude's lid twins: a lid circle the size and facing of its base's, both ways": {
    build(m, s) {
      const o = m.addPoint([0, 0, 0]).name;
      const ring: string = s.circ(o, 8, [0, 0, 1]);
      const e = extrude(m, ring, 10);
      const f = m.featureOf(e, "extrude");
      const twin = f.twins[0][0];
      const rim = m.addPoint([8, 0, 10]).name; // a hand on the lid's rim: a point on it, dragged
      onCircle(m, rim, twin);
      return {
        copy: rim, orig: o,
        check() {
          return {
            "same radius": Math.abs(m.radius(twin) - m.radius(ring)),
            "same facing": len(sub(unit(m.normalOf(twin)), unit(m.normalOf(ring)))),
          };
        },
      };
    },
  },
};

for (const [name, row] of Object.entries(ROWS)) {
  test(`${name} — after a drag of the copy and of the original, in its plane and out of it`, async () => {
    await loadKernel();
    for (const [who, by] of [["copy", IN], ["copy", OUT], ["original", IN], ["original", OUT]] as const) {
      const m = new Model(3);
      const s = neocadScope({ model: m }) as Record<string, (...a: unknown[]) => any>;
      const built = row.build(m, s);
      assert.equal(m.solve().solved, true, `${who}: as made`);
      const p = who === "copy" ? built.copy : built.orig;
      const was = C(m, p);
      assert.equal(drag(m, p, [...by]), true, `${who} by ${by}: solves`);
      assert.ok(len(sub(C(m, p), was)) > 1, `${who} by ${by}: it moved`);
      const after = built.check();
      for (const [k, v] of Object.entries(after)) assert.ok(v <= 1e-7, `${who} pulled by ${JSON.stringify(by)}: ${k} off by ${v}`);
    }
  });
}

/** A rectangle beside the origin's y axis, to revolve about it. */
function besideAxis(m: Model) {
  return rect(m, [10, 0, 0], 20, 20);
}

/** How far the axis (origin.y: through the origin, along y) is out of the profile's plane. */
function axisOff(m: Model, P: string[]): number {
  const n = planeOf(C(m, P[0]), C(m, P[1]), C(m, P[3]));
  return Math.abs(dot(n, [0, 1, 0])) + Math.abs(dot(sub([0, 0, 0], C(m, P[0])), n));
}

test("revolve, partial and whole: the axis stays in the profile's plane when a profile corner is pulled off it — and, partial, when the end face is", async () => {
  await loadKernel();
  for (const angle of [Math.PI / 2, null]) {
    for (const grab of ["profile", "end face"] as const) {
      if (grab === "end face" && angle === null) continue; // a whole turn has no end face
      const m = new Model(3);
      const { P, L } = besideAxis(m);
      const e = revolve(m, L[0], "origin.y", ...(angle === null ? [] : [angle]));
      assert.equal(m.solve().solved, true);
      const f = m.featureOf(e, "revolve");
      const twinOf = new Map([...baseOf(m, f.angle)].map(([t, b]) => [b, t]));
      const p = grab === "profile" ? P[2] : twinOf.get(P[2])!;
      const was = C(m, p);
      assert.equal(drag(m, p, [0, 0, 8]), true);
      assert.ok(len(sub(C(m, p), was)) > 1, "it moved");
      const off = axisOff(m, P);
      assert.ok(off <= 1e-7, `${angle === null ? "whole" : "partial"}, ${grab} pulled: the axis ${off} off the profile's plane`);
    }
  }
});

test("a revolve of a sketch-mode profile — every corner onPlane its frame — reads nothing redundant, partial or whole, and a regenerated whole one keeps its profile held", async () => {
  await loadKernel();
  const { tiltedFrame } = await import("./frames.ts");
  const { polygon } = await import("./profiles.ts");
  const { fillet } = await import("../src/operations.ts");
  for (const angle of [1.2, null]) {
    const m = new Model(3);
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, [[4, 0], [24, 0], [24, 16], [4, 16]]);
    const e = revolve(m, lines[0], "t.y", ...(angle === null ? [] : [angle]));
    assert.equal(m.solve().solved, true);
    // The angle's rows say again what the onplanes say; the angle is the feature's, so it is never the one named.
    assert.deepEqual(m.diagnose().redundant, [], `${angle ?? "whole"}: nothing redundant`);
    // A corner filleted: the profile regenerates, and a whole turn names its new profile — the arc's points too.
    fillet(m, lines[1], lines[2], 3);
    assert.equal(m.solve().solved, true);
    const f = m.featureOf(e, "revolve");
    const named = new Set((m.relationOf(f.angle).args.slice(2) as string[]));
    const arc = [...m.entities.values()].find((x) => x.kind === "arc")!;
    assert.ok(named.has(arc.name) && named.has((arc as { center: string }).center), `${angle ?? "whole"}: the regenerated profile is named: ${[...named]}`);
    assert.deepEqual(m.diagnose().redundant, [], `${angle ?? "whole"}: still nothing redundant`);
  }
});

test("a whole revolve whose free profile has turned about its axis is laid out for the kernel where the profile is, not where its frame is", async () => {
  await loadKernel();
  const { kernelSweep } = await import("../src/solids.ts");
  const m = new Model(3);
  const { P, L } = besideAxis(m);
  const e = revolve(m, L[0], "origin.y");
  assert.equal(m.solve().solved, true);
  // Pulled off its plane: the profile turns about the axis as a whole (the axis held in its plane).
  assert.equal(drag(m, P[2], [0, 0, 12]), true);
  assert.ok(Math.abs(C(m, P[2])[2]) > 4, `it turned: ${C(m, P[2])}`);
  const { at, profile } = kernelSweep(m, m.featureOf(e, "revolve"));
  const world = (q: readonly number[]) => at.origin.map((o, i) => o + q[0] * at.x[i] + q[1] * at.y[i]);
  // Every corner the kernel is handed is a corner of the profile where it stands.
  const handed = profile.loops.flat().flatMap((mm) => (mm.kind === "line" ? [mm.from, mm.to] : []));
  assert.ok(handed.length >= 4);
  for (const q of handed) {
    const w = world(q);
    const nearest = Math.min(...P.map((p) => len(sub(C(m, p), w))));
    assert.ok(nearest <= 1e-7, `a corner the kernel is handed, ${w}, is ${nearest} from the profile's nearest`);
  }
});
