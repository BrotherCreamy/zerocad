// Snapping: while a tool is drawing, pull the cursor onto whatever meaningful
// geometry is near it, so a rectangle started "on" a corner starts *exactly*
// on it rather than a pixel and a half away.
//
// The idea is cellwork's, though the mechanism differs. cellwork's pointer
// tools fill argument slots, so clicking an existing point simply used that
// point and clicking empty space auto-created one — the snap fell out of
// picking. neocad's tools are gesture-based (drag a rectangle) rather than
// slot-based, so the same idea lands here as: the *coordinate* a tool receives
// is snapped, and tools need to know nothing about it.
//
// Tolerances are in screen pixels and the tiers mirror picking's, for the same
// reason: an exact point beats a derived midpoint beats a point that merely
// lies somewhere along a curve.

import type { Model } from "./model.ts";
import { screenToWorld, worldToScreen, type View } from "./view.ts";

export type SnapKind = "point" | "midpoint" | "curve";

export interface Snap {
  /** Where the cursor should be treated as being. */
  world: number[];
  /** And where that is on screen, for drawing the marker. */
  screen: [number, number];
  kind: SnapKind;
  /** What it snapped to, for the marker's label. */
  target: string;
}

export const SNAP_POINT = 10;
export const SNAP_MIDPOINT = 8;
export const SNAP_CURVE = 6;

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by);
}

/**
 * The best snap for a cursor at (sx, sy), or null to use the raw position.
 *
 * Only ever *moves* the cursor — it never changes what a tool builds. A tool
 * that would have made a point at 3.02, 5.99 makes one at 3, 6 instead; it does
 * not silently reuse the existing point there. Welding coincident points is a
 * separate decision with different consequences, and conflating the two would
 * make snapping quietly destructive.
 */
export function findSnap(model: Model, view: View, sx: number, sy: number): Snap | null {
  const screenOf = (name: string) => {
    const c = model.coords(name);
    return worldToScreen(view, [c[0], c[1]]);
  };
  const make = (screen: [number, number], kind: SnapKind, target: string): Snap => ({
    screen,
    world: screenToWorld(view, screen[0], screen[1]),
    kind,
    target,
  });

  // Tier 1: an existing point. Exact, and almost always what was meant.
  let best: { snap: Snap; d: number } | null = null;
  for (const e of model.entities.values()) {
    if (e.kind !== "point") continue;
    const p = screenOf(e.name);
    const d = dist(sx, sy, p[0], p[1]);
    if (d < SNAP_POINT && (!best || d < best.d)) best = { snap: make(p, "point", e.name), d };
  }
  if (best) return best.snap;

  // Tier 2: the middle of an edge.
  for (const e of model.entities.values()) {
    if (e.kind !== "line") continue;
    const a = screenOf(e.refs[0]);
    const b = screenOf(e.refs[1]);
    const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(sx, sy, mid[0], mid[1]);
    if (d < SNAP_MIDPOINT && (!best || d < best.d)) best = { snap: make(mid, "midpoint", e.name), d };
  }
  if (best) return best.snap;

  // Tier 3: somewhere along a curve — the nearest point on it.
  for (const e of model.entities.values()) {
    if (e.kind === "line") {
      const [ax, ay] = screenOf(e.refs[0]);
      const [bx, by] = screenOf(e.refs[1]);
      const len = dist(ax, ay, bx, by);
      if (len < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / (len * len)));
      const on: [number, number] = [ax + t * (bx - ax), ay + t * (by - ay)];
      const d = dist(sx, sy, on[0], on[1]);
      if (d < SNAP_CURVE && (!best || d < best.d)) best = { snap: make(on, "curve", e.name), d };
    } else if (e.kind === "circle" || e.kind === "arc") {
      const [cx, cy] = screenOf(e.center);
      const r = model.radius(e.name) * view.scale;
      const away = dist(sx, sy, cx, cy);
      if (away < 1e-6) continue;
      const on: [number, number] = [cx + ((sx - cx) / away) * r, cy + ((sy - cy) / away) * r];
      const d = dist(sx, sy, on[0], on[1]);
      if (d < SNAP_CURVE && (!best || d < best.d)) best = { snap: make(on, "curve", e.name), d };
    }
  }
  return best?.snap ?? null;
}

/** A short label for the snap marker: what it caught and how. */
export function describeSnap(snap: Snap): string {
  switch (snap.kind) {
    case "point": return snap.target;
    case "midpoint": return `mid ${snap.target}`;
    case "curve": return `on ${snap.target}`;
  }
}
