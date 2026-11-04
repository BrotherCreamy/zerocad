// The parts STEP export is checked against (docs/plans/step-export.md): every
// one the spec lists, and a few more that reach the surfaces and topologies
// the list does not — a sphere, a cavity, an island, a slanted revolve. Built
// as the tools build them (polygons and circles held on a frame, fillets,
// extrude and revolve), and solved.
//
// Shared by test/step.test.ts, which checks each export's structure and
// ZeroCAD's measures, and by the generator that writes the fixtures a real
// kernel read back (`NEOCAD_STEP_OUT=dir`; what read them, and what it said, is
// test/fixtures/step/validated.json).
//
// `volume` is the closed form where there is a short one, and null where the
// shape is only ever as exact as its solve (a fillet's arc inside a slanted
// profile): there ZeroCAD's own figure is checked against OpenCascade's.

import { Model } from "../src/model.ts";
import { construction, extrude, fillet, revolve } from "../src/operations.ts";
import { hide } from "../src/groups.ts";
import { onPlane } from "../src/relations/basic.ts";
import { arcEndpoints } from "../src/relations/geometry.ts";
import { axisFrame, tiltedFrame, type TiltedFrame } from "./frames.ts";
import { polygon, ring } from "./profiles.ts";

export interface Part {
  name: string;
  /** What the spec calls it, for the PR's table. */
  what: string;
  model: Model;
  /** Closed-form volume, or null where there is none worth writing. */
  volume: number | null;
  /** How many bodies the file holds — pinned. */
  bodies: number;
  /** Exported with the loose sketch curves (`curves: true`), and how many there are. */
  curves?: number;
}

/** A frame lined up with the kernel's axes, as a TiltedFrame — so `polygon` and `ring` draw on it. */
function square(m: Model): TiltedFrame {
  axisFrame(m, "f");
  return { name: "f", origin: [0, 0, 0], ux: [1, 0, 0], uy: [0, 1, 0], uz: [0, 0, 1], at: (u, v, w = 0) => [u, v, w] };
}

function solved(m: Model): Model {
  const r = m.solve();
  if (!r.solved) throw new Error("a test part did not solve");
  return m;
}

/** An arc on the frame from `from` to `to` about `c`, counter-clockwise about its +z, its ends held on it. */
function arcOn(m: Model, t: TiltedFrame, c: [number, number], from: [number, number], to: [number, number]): { arc: string; start: string; end: string } {
  const [cp, sp, ep] = [c, from, to].map(([u, v]) => m.addPoint(t.at(u, v)).name);
  for (const p of [cp, sp, ep]) onPlane(m, p, t.name);
  const r = Math.hypot(from[0] - c[0], from[1] - c[1]);
  const arc = m.addArc(cp, sp, ep, r, t.name).name;
  arcEndpoints(m, arc);
  return { arc, start: sp, end: ep };
}

export function parts(): Part[] {
  const out: Part[] = [];
  const part = (name: string, what: string, bodies: number, volume: number | null, build: (m: Model) => void, curves?: number) => {
    const m = new Model(3);
    build(m);
    out.push({ name, what, model: solved(m), volume, bodies, ...(curves === undefined ? {} : { curves }) });
  };

  part("box", "a box", 1, 40 * 20 * 10, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 20], [0, 20]]);
    extrude(m, lines[0], 10);
  });

  part("plate-hole", "a plate with a round hole", 1, (60 * 40 - Math.PI * 64) * 6, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[0, 0], [60, 0], [60, 40], [0, 40]]);
    ring(m, t, 30, 20, 8);
    extrude(m, lines[0], 6);
  });

  // A fillet of radius r takes r² − πr²/4 out of the corner.
  part("fillet", "an outline with a fillet (an arc wall)", 1, (50 * 30 - (64 - Math.PI * 16)) * 12, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[0, 0], [50, 0], [50, 30], [0, 30]]);
    fillet(m, lines[0], lines[1], 8);
    m.solve();
    extrude(m, lines[2], 12);
  });

  part("cylinder", "a cylinder (a circle profile)", 1, Math.PI * 100 * 25, (m) => {
    const t = square(m);
    extrude(m, ring(m, t, 0, 0, 10), 25);
  });

  // Pappus: the angle times ∫∫ρ dA = 20 · (30² − 10²)/2.
  part("partial-revolve", "a partial revolve (end caps)", 1, (Math.PI / 2) * 8000, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[10, 0], [30, 0], [30, 20], [10, 20]]);
    revolve(m, lines[0], "f.y", Math.PI / 2);
  });

  // A plane (the bottom), a cone (the slant), a torus (the fillet between the
  // slant and the top), a plane (the top) and a cylinder (the inside).
  part("cone-torus", "a full revolve with a line crossing the axis (a cone) and an arc (a torus)", 1, null, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[5, 0], [10, 0], [8, 6], [5, 6]]);
    fillet(m, lines[1], lines[2], 1.5);
    m.solve();
    revolve(m, lines[0], "f.y");
  });

  part("two-bodies", "two separate bodies", 2, 20 * 20 * 10 + Math.PI * 36 * 15, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[0, 0], [20, 0], [20, 20], [0, 20]]);
    extrude(m, lines[0], 10);
    extrude(m, ring(m, t, 50, 10, 6), 15);
  });

  part("tilted", "a tilted profile on a non-axis plane", 1, (30 * 20 - Math.PI * 25) * 8, (m) => {
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, [[0, 0], [30, 0], [30, 20], [0, 20]]);
    ring(m, t, 10, 10, 5);
    extrude(m, lines[0], 8);
  });

  // ---- beyond the spec's list ----

  // A semicircle and its diameter on the axis: two lunes of a sphere.
  part("sphere", "a sphere (a semicircle on the axis, turned whole)", 1, (4 / 3) * Math.PI * 1000, (m) => {
    const t = square(m);
    const { arc, start, end } = arcOn(m, t, [0, 0], [0, -10], [0, 10]);
    m.addLine(end, start);
    revolve(m, arc, "f.y");
  });

  // An arc whose circle reaches past the axis, though the arc stays clear of
  // it: a torus would turn itself inside out, so it is the general surface of
  // revolution. Half a disc of radius 6 right of ρ = 2 — area 18π, centroid at
  // ρ = 2 + 4·6/(3π) — turned whole: 2π · 18π · (2 + 8/π).
  part("spindle", "an arc whose circle crosses the axis, turned whole (a surface of revolution)", 1, 2 * Math.PI * 18 * Math.PI * (2 + 8 / Math.PI), (m) => {
    const t = square(m);
    const { arc, start, end } = arcOn(m, t, [2, 0], [2, -6], [2, 6]);
    m.addLine(end, start);
    revolve(m, arc, "f.y");
  });

  // A hole turned a whole turn is a cavity: a brep with a void.
  part("cavity", "a full revolve of a profile with a hole (a void)", 1, 2 * Math.PI * (8000 - Math.PI * 16 * 20), (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[10, 0], [30, 0], [30, 20], [10, 20]]);
    ring(m, t, 20, 10, 4);
    revolve(m, lines[0], "f.y");
  });

  // A hole with an island in it: the island is solid and the hole round it
  // is not, so one feature is two bodies.
  part("island", "an island inside a hole (one feature, two bodies)", 2, (3600 - Math.PI * 400 + Math.PI * 64) * 5, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[0, 0], [60, 0], [60, 60], [0, 60]]);
    ring(m, t, 30, 30, 20);
    ring(m, t, 30, 30, 8);
    extrude(m, lines[0], 5);
  });

  // The revolve e2e's poster: a filleted block turned 270° about the tilted
  // frame's +y — slanted surfaces, a torus off every kernel axis, and caps.
  part("tilted-revolve", "a filleted profile turned 270° on a tilted plane", 1, null, (m) => {
    const t = tiltedFrame(m);
    const { lines } = polygon(m, t, [[10, 0], [30, 0], [30, 20], [10, 20]]);
    fillet(m, lines[1], lines[2], 6);
    m.solve();
    revolve(m, lines[0], "t.y", (3 * Math.PI) / 2);
  });

  // The wireframe beside a solid: a loose line, arc and circle are written; a
  // construction line, a hidden solid and that solid's own sketch are not.
  part("wireframe", "loose sketch curves (curves: true) beside a box; a hidden solid and a construction line left out", 1, 8000, (m) => {
    const t = square(m);
    const { lines } = polygon(m, t, [[0, 0], [40, 0], [40, 20], [0, 20]]);
    extrude(m, lines[0], 10);
    const hidden = polygon(m, t, [[60, 0], [70, 0], [70, 10], [60, 10]]);
    extrude(m, hidden.lines[0], 5);
    hide(m, "e2");
    const [a, b] = [m.addPoint(t.at(0, 40)).name, m.addPoint(t.at(30, 50)).name];
    m.addLine(a, b);
    const [c, d] = [m.addPoint(t.at(0, 70)).name, m.addPoint(t.at(20, 70)).name];
    construction(m, m.addLine(c, d).name);
    ring(m, t, 50, 50, 6);
    arcOn(m, t, [80, 40], [90, 40], [80, 50]);
  }, 3);

  return out;
}
