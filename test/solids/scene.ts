// The owner's part, built the way the app builds it: a plate on a tilted frame
// (so nothing is secretly on the kernel's axes), then sketches on its faces —
// three of the face's own points as the plane, as sketch on face sets it — and
// features on those. Shared by the modes, bodies and STEP suites.

import { readFile } from "node:fs/promises";
import { ensureKernelLoaded } from "../../src/kernel/problem.ts";
import type { Model } from "../../src/model.ts";
import { onPlane } from "../../src/relations/basic.ts";
import { parallel } from "../../src/relations/geometry.ts";
import { extrude } from "../../src/operations.ts";
import { tiltedFrame, type TiltedFrame } from "../frames.ts";
import { polygon } from "../profiles.ts";

export async function loadSolver(): Promise<void> {
  const bytes = await readFile(new URL("../../src/kernel/wasm-gen/neocad_kernel_bg.wasm", import.meta.url));
  await ensureKernelLoaded(bytes);
}

export const L = 100, W = 60, T = 10;

export interface Plate {
  t: TiltedFrame;
  feature: string;
  /** The lid's corners in the base's order — a plane on them faces out of the lid. */
  lid: string[];
  base: string[];
  lines: string[];
}

/** A 100 × 60 plate, 10 thick, on a tilted frame. */
export function plate(m: Model): Plate {
  const t = tiltedFrame(m);
  const { points, lines } = polygon(m, t, [[0, 0], [L, 0], [L, W], [0, W]]);
  const feature = extrude(m, lines[0], T);
  m.solve();
  const f = m.featureOf(feature, "extrude");
  const lid = f.twins[0].map((l) => {
    const e = m.entities.get(l)!;
    if (e.kind !== "line") throw new Error("a rectangle's twin is a line");
    return e.refs[0];
  });
  return { t, feature, lid, base: points, lines };
}

/** A whole circle on a plane reference, its centre at a world point held there and its normal held to the plane's. */
export function circleOn(m: Model, plane: string, at: number[], r: number, normal: number[]): string {
  const c = m.addPoint(at).name;
  onPlane(m, c, plane);
  const circle = m.addCircle(c, r, normal).name;
  // A frame is a plane by its +z; three points or a curve are planes themselves.
  parallel(m, circle, plane.includes(".") || m.entities.get(plane)?.kind !== "frame" ? plane : `${plane}.z`);
  return circle;
}

/** A point on the plate's top at (u, v) of the frame. */
export function onTop(p: Plate, u: number, v: number): number[] {
  return p.t.at(u, v, T);
}
