// Profiles drawn on a frame, as the tools draw them — and a way to read which
// base each twin was made for. Shared by the extrude and revolve suites, which
// build the same sketches and ask the same questions of what a feature made.

import type { Model } from "../src/model.ts";
import { onPlane } from "../src/relations/basic.ts";
import type { TiltedFrame } from "./frames.ts";

/** A closed polygon of fresh points held on the frame's plane, as the tools draw one. */
export function polygon(m: Model, t: TiltedFrame, corners: [number, number][]): { points: string[]; lines: string[] } {
  const points = corners.map(([u, v]) => m.addPoint(t.at(u, v)).name);
  const lines = points.map((p, i) => m.addLine(p, points[(i + 1) % points.length]).name);
  for (const p of points) onPlane(m, p, t.name);
  return { points, lines };
}

/** A circle on the frame, its centre held there. */
export function ring(m: Model, t: TiltedFrame, u: number, v: number, r: number): string {
  const c = m.addPoint(t.at(u, v)).name;
  onPlane(m, c, t.name);
  return m.addCircle(c, r, t.name).name;
}

/**
 * The base each twin was made for, read off a feature's dimension — an
 * `extrusion` (`[frame, depth, …pairs]`) or a `revolution` (`[axis, angle,
 * …pairs]`), whose pairs both start at the third argument and run base, twin.
 */
export function baseOf(m: Model, dimension: string): Map<string, string> {
  const args = m.relationOf(dimension).args.slice(2) as string[];
  const out = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) out.set(args[i + 1], args[i]);
  return out;
}
