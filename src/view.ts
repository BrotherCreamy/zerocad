// The 2D view transform, kept as pure functions over a plain {ox, oy, scale}.
//
// Split out of the tool engine so the arithmetic can be tested without a
// canvas or a DOM — panning and zooming are exactly the sort of thing that
// looks right until you zoom out far enough for a sign error to show.
//
// The convention is cellwork's, and note that y is flipped: screen y grows
// downward, world y grows upward.
//
//     screen_x = ox + world_x * scale
//     screen_y = oy - world_y * scale

export interface View {
  ox: number;
  oy: number;
  scale: number;
}

/** How far the view may be zoomed, so a stray wheel event cannot wreck it. */
export const MIN_SCALE = 1e-3;
export const MAX_SCALE = 1e5;

export function worldToScreen(view: View, world: number[]): [number, number] {
  return [view.ox + world[0] * view.scale, view.oy - world[1] * view.scale];
}

export function screenToWorld(view: View, sx: number, sy: number): number[] {
  return [(sx - view.ox) / view.scale, (view.oy - sy) / view.scale];
}

export function clampScale(scale: number): number {
  // NaN carries no intent, so it falls back to the far-out end, where the
  // whole drawing is at least visible. Infinity does carry intent — "as far
  // in as it goes" — and is treated as such rather than lumped in with NaN.
  if (Number.isNaN(scale)) return MIN_SCALE;
  if (scale === Infinity) return MAX_SCALE;
  if (scale <= 0) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * Zooms by `factor` while keeping whatever is under (sx, sy) exactly where it
 * is — the behaviour that makes a wheel feel like it is pointing at something
 * rather than at the middle of the window.
 *
 * Solved directly rather than nudged: the world point under the cursor is
 * read first, and the origin is then placed so that same point lands back on
 * the same pixel at the new scale. No drift as the scale accumulates.
 */
export function zoomAbout(view: View, sx: number, sy: number, factor: number): View {
  const [wx, wy] = screenToWorld(view, sx, sy);
  const scale = clampScale(view.scale * factor);
  return { scale, ox: sx - wx * scale, oy: sy + wy * scale };
}

/** Zooms about a fixed point without moving the cursor anchor (command-line zoom). */
export function zoomBy(view: View, factor: number, sx: number, sy: number): View {
  return zoomAbout(view, sx, sy, factor);
}

export function panBy(view: View, dxScreen: number, dyScreen: number): View {
  return { ...view, ox: view.ox + dxScreen, oy: view.oy + dyScreen };
}

/** Copies `next` into `view` in place, so anything holding the object sees it. */
export function assignView(view: View, next: View): void {
  view.ox = next.ox;
  view.oy = next.oy;
  view.scale = next.scale;
}
