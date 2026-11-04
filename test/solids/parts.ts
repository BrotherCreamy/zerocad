// The spike's test parts — the shapes the owner cannot make today — each
// built through the kernel-neutral API and checked against a volume and a
// bounding box computed independently, in closed form (profiles.ts).
//
// Every part takes its dimensions as data, so the identity experiment can
// rebuild it with different numbers and compare names.

import { XY, type Placement, type Solid, type SolidKernel, type V3 } from "../../src/solids/kernel.ts";
import { edgesNamed, tagExtrude, tagOffsets, tagRevolve } from "../../src/solids/naming.ts";
import { circle, profile, profileArea, rect, revolvedVolume, roundedRect } from "./profiles.ts";

export type Dims = Record<string, number>;

export interface Part {
  name: string;
  /** What it exercises, in a phrase. */
  tests: string;
  dims: Dims;
  /** The same part with every dimension changed — for the rebuild. */
  changed: Dims;
  build(k: SolidKernel, d: Dims): Solid;
  expect(d: Dims): { volume: number; bbox: [V3, V3] };
}

const raised = (z: number): Placement => ({ origin: [0, 0, z], x: [1, 0, 0], y: [0, 1, 0] });

/** Extrude and tag in one: what a ZeroCAD extrude feature would do. */
function extrude(k: SolidKernel, feature: number, p: ReturnType<typeof profile>, depth: number, at: Placement = XY): Solid {
  const s = k.extrude(p, depth, at);
  tagExtrude(k, s, feature, p, depth, at);
  return s;
}

const plate: Part = {
  name: "plate-pocket-holes",
  tests: "profile with holes; pocket cut",
  dims: { L: 100, W: 60, T: 10, pw: 40, ph: 20, pd: 4, r: 5 },
  changed: { L: 110, W: 64, T: 12, pw: 44, ph: 22, pd: 5, r: 6 },
  build(k, d) {
    const body = extrude(k, 1, profile(
      rect(0, 0, d.L, d.W), circle(0.15 * d.L, d.W / 2, d.r), circle(0.85 * d.L, d.W / 2, d.r)), d.T);
    const x0 = (d.L - d.pw) / 2, y0 = (d.W - d.ph) / 2;
    // The tool overshoots the top, so the cut is not a coplanar case here (that is flush-cut's).
    const tool = extrude(k, 2, profile(rect(x0, y0, x0 + d.pw, y0 + d.ph)), d.pd + 2, raised(d.T - d.pd));
    return k.boolean("subtract", body, tool);
  },
  expect: (d) => ({
    volume: d.L * d.W * d.T - 2 * Math.PI * d.r * d.r * d.T - d.pw * d.ph * d.pd,
    bbox: [[0, 0, 0], [d.L, d.W, d.T]],
  }),
};

const overlap: Part = {
  name: "overlap-union",
  tests: "two overlapping extrudes unioned (box and cylinder, bottoms coplanar)",
  dims: { a: 40, h: 20, r: 15, H: 30 },
  changed: { a: 44, h: 22, r: 16, H: 33 },
  build(k, d) {
    const box = extrude(k, 1, profile(rect(0, 0, d.a, d.a)), d.h);
    const cyl = extrude(k, 2, profile(circle(d.a, d.a, d.r)), d.H);
    return k.boolean("union", box, cyl);
  },
  expect: (d) => ({
    volume: d.a * d.a * d.h + Math.PI * d.r * d.r * d.H - (Math.PI * d.r * d.r / 4) * d.h,
    bbox: [[0, 0, 0], [d.a + d.r, d.a + d.r, d.H]],
  }),
};

const filleted: Part = {
  name: "fillet-outline-and-top",
  tests: "outline with arcs extruded, then its top edges filleted",
  dims: { L: 60, W: 40, R: 8, T: 15, r: 3 },
  changed: { L: 66, W: 44, R: 9, T: 16, r: 3.5 },
  build(k, d) {
    const s = extrude(k, 1, profile(roundedRect(0, 0, d.L, d.W, d.R)), d.T);
    // The lid's edges, by name: every edge one of whose faces is the lid.
    const top = edgesNamed(k, s, (n) => n.split("|").includes("F1.lid"));
    return k.fillet(s, top, d.r);
  },
  expect: (d) => {
    const P = 2 * (d.L - 2 * d.R) + 2 * (d.W - 2 * d.R) + 2 * Math.PI * d.R;
    const area = profileArea(profile(roundedRect(0, 0, d.L, d.W, d.R)));
    // Pappus: the removed spandrel, area r²(1 − π/4), its centroid r(10 − 3π)/(12 − 3π) in from the wall.
    const cbar = (d.r * (10 - 3 * Math.PI)) / (12 - 3 * Math.PI);
    const removed = d.r * d.r * (1 - Math.PI / 4) * (P - 2 * Math.PI * cbar);
    return { volume: area * d.T - removed, bbox: [[0, 0, 0], [d.L, d.W, d.T]] };
  },
};

function revolveLoop(d: Dims) {
  return [
    { kind: "line" as const, from: [0, 0] as [number, number], to: [d.R, 0] as [number, number] },
    { kind: "line" as const, from: [d.R, 0] as [number, number], to: [d.R, d.h] as [number, number] },
    { kind: "arc" as const, centre: [d.R, d.h + d.t] as [number, number], radius: d.t, start: -90, end: 90 },
    { kind: "line" as const, from: [d.R, d.h + 2 * d.t] as [number, number], to: [d.rt, d.H] as [number, number] },
    { kind: "line" as const, from: [d.rt, d.H] as [number, number], to: [0, d.H] as [number, number] },
    { kind: "line" as const, from: [0, d.H] as [number, number], to: [0, 0] as [number, number] },
  ];
}

const turned: Part = {
  name: "revolve-cone-torus",
  tests: "full revolve: a line crossing the axis's direction (cone), an arc (torus), a member on the axis",
  dims: { R: 30, h: 10, t: 5, rt: 10, H: 40 },
  changed: { R: 32, h: 12, t: 6, rt: 11, H: 44 },
  build(k, d) {
    // The profile stands in the world's XZ plane; its local y (the axis) is world z.
    const at: Placement = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 0, 1] };
    const p = profile(revolveLoop(d));
    const s = k.revolve(p, [0, 0], [0, 1], 360, at);
    tagRevolve(k, s, 1, p, [0, 0], [0, 1], 360, at);
    return s;
  },
  expect: (d) => {
    const r = d.R + d.t;
    return { volume: revolvedVolume(revolveLoop(d)), bbox: [[-r, -r, 0], [r, r, d.H]] };
  },
};

const boss: Part = {
  name: "boss-on-face",
  tests: "coplanar union: a cylinder standing on a box's top face",
  dims: { a: 50, h: 10, r: 10, H: 15 },
  changed: { a: 54, h: 12, r: 11, H: 16 },
  build(k, d) {
    const base = extrude(k, 1, profile(rect(0, 0, d.a, d.a)), d.h);
    const post = extrude(k, 2, profile(circle(d.a / 2, d.a / 2, d.r)), d.H, raised(d.h));
    return k.boolean("union", base, post);
  },
  expect: (d) => ({
    volume: d.a * d.a * d.h + Math.PI * d.r * d.r * d.H,
    bbox: [[0, 0, 0], [d.a, d.a, d.h + d.H]],
  }),
};

const flush: Part = {
  name: "flush-cut",
  tests: "a slot cut exactly flush with two faces (coplanar subtract)",
  dims: { L: 50, W: 30, T: 20, sx: 10, sw: 30, sd: 10, sh: 10 },
  changed: { L: 54, W: 32, T: 22, sx: 11, sw: 32, sd: 11, sh: 11 },
  build(k, d) {
    const base = extrude(k, 1, profile(rect(0, 0, d.L, d.W)), d.T);
    const slot = extrude(k, 2, profile(rect(d.sx, 0, d.sx + d.sw, d.sd)), d.sh, raised(d.T - d.sh));
    return k.boolean("subtract", base, slot);
  },
  expect: (d) => ({ volume: d.L * d.W * d.T - d.sw * d.sd * d.sh, bbox: [[0, 0, 0], [d.L, d.W, d.T]] }),
};

const shelled: Part = {
  name: "shell-open-top",
  tests: "shell a box to a wall, its top face open",
  dims: { L: 40, W: 30, T: 20, t: 2 },
  changed: { L: 44, W: 32, T: 22, t: 2.5 },
  build(k, d) {
    const s = extrude(k, 1, profile(rect(0, 0, d.L, d.W)), d.T);
    const top = k.faces(s).findIndex((f) => f.tag === 1001);
    const before = k.copy(s);
    const r = k.shell(s, [top], d.t);
    if (r === null) throw new Error("no shell");
    tagOffsets(k, before, r);
    k.free(before);
    return r;
  },
  // Inward: the walls are inside the original box.
  expect: (d) => ({
    volume: d.L * d.W * d.T - (d.L - 2 * d.t) * (d.W - 2 * d.t) * (d.T - d.t),
    bbox: [[0, 0, 0], [d.L, d.W, d.T]],
  }),
};

const chamfered: Part = {
  name: "chamfer-top-edges",
  tests: "chamfer a cube's four top edges",
  dims: { a: 30, c: 3 },
  changed: { a: 33, c: 3.5 },
  build(k, d) {
    const s = extrude(k, 1, profile(rect(0, 0, d.a, d.a)), d.a);
    const top = edgesNamed(k, s, (n) => n.split("|").includes("F1.lid"));
    return k.chamfer(s, top, d.c);
  },
  // Equal setback c along both faces: four prisms of section c²/2, less the four corner overlaps of c³/3.
  expect: (d) => ({ volume: d.a ** 3 - (2 * d.a * d.c * d.c - (4 / 3) * d.c ** 3), bbox: [[0, 0, 0], [d.a, d.a, d.a]] }),
};

const touching: Part = {
  name: "touching-union",
  tests: "two boxes sharing a whole face unioned (every contact face coplanar)",
  dims: { a: 20, b: 20, h: 10 },
  changed: { a: 22, b: 21, h: 11 },
  build(k, d) {
    const l = extrude(k, 1, profile(rect(0, 0, d.a, d.b)), d.h);
    const r = extrude(k, 2, profile(rect(d.a, 0, 2 * d.a, d.b)), d.h);
    return k.boolean("union", l, r);
  },
  expect: (d) => ({ volume: 2 * d.a * d.b * d.h, bbox: [[0, 0, 0], [2 * d.a, d.b, d.h]] }),
};

const split: Part = {
  name: "split-face",
  tests: "a slot right across the top, splitting the lid into two faces with one tag",
  dims: { L: 50, W: 30, T: 20, sx: 20, sw: 10, sd: 10 },
  changed: { L: 54, W: 32, T: 22, sx: 21, sw: 11, sd: 11 },
  build(k, d) {
    const base = extrude(k, 1, profile(rect(0, 0, d.L, d.W)), d.T);
    const slot = extrude(k, 2, profile(rect(d.sx, -1, d.sx + d.sw, d.W + 1)), d.sd + 1, raised(d.T - d.sd));
    return k.boolean("subtract", base, slot);
  },
  expect: (d) => ({ volume: d.L * d.W * d.T - d.sw * d.W * d.sd, bbox: [[0, 0, 0], [d.L, d.W, d.T]] }),
};

/** A plane tilted `deg` about the world x axis, through `origin`. */
function tilted(origin: V3, deg: number): Placement {
  const t = (deg * Math.PI) / 180;
  return { origin, x: [1, 0, 0], y: [0, Math.cos(t), Math.sin(t)] };
}

const slanted: Part = {
  name: "tilted-cut",
  tests: "a profile on a plane off the axes, extruded, a hole cut square to it",
  dims: { L: 30, W: 20, T: 10, r: 4, tilt: 30 },
  changed: { L: 33, W: 22, T: 11, r: 4.5, tilt: 35 },
  build(k, d) {
    const at = tilted([5, 5, 5], d.tilt);
    const body = extrude(k, 1, profile(rect(0, 0, d.L, d.W)), d.T, at);
    // The tool starts 1 below the profile's plane and ends 1 above the lid.
    const n: V3 = [0, -Math.sin((d.tilt * Math.PI) / 180), Math.cos((d.tilt * Math.PI) / 180)];
    const below: Placement = { ...at, origin: [at.origin[0] - n[0], at.origin[1] - n[1], at.origin[2] - n[2]] };
    const hole = extrude(k, 2, profile(circle(d.L / 2, d.W / 2, d.r)), d.T + 2, below);
    return k.boolean("subtract", body, hole);
  },
  expect: (d) => {
    const at = tilted([5, 5, 5], d.tilt);
    const z: V3 = [0, -at.y[2], at.y[1]];
    const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
    for (const a of [0, d.L]) for (const b of [0, d.W]) for (const c of [0, d.T]) {
      for (let i = 0; i < 3; i++) {
        const v = at.origin[i] + a * at.x[i] + b * at.y[i] + c * z[i];
        lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v);
      }
    }
    return { volume: (d.L * d.W - Math.PI * d.r * d.r) * d.T, bbox: [lo, hi] };
  },
};

export const PARTS: Part[] = [plate, overlap, filleted, turned, boss, flush, shelled, chamfered, touching, split, slanted];
