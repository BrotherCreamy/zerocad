// The on-screen keyboard (docs/plans/android.md): **the command bar rides above
// the keyboard, and the canvas does not shrink.**
//
// A phone's keyboard covers the bottom of the page without resizing it —
// Chrome on Android since 108 and iOS both shrink only the *visual* viewport
// (`interactive-widget=resizes-visual`, which index.html's viewport also asks
// for, so a browser that would resize the page instead does not). So the
// drawing keeps its size and nothing re-lays out; but the command line,
// docked to the bottom upright, is under the keyboard exactly while it is
// being typed into. This works out where the panel holding the focused field
// goes instead: its bottom on the keyboard's top, and — so that it lies over
// no other pane — only as wide as the free run of the band it is lifted into,
// the run its own span overlaps most. Put back when the keyboard goes.
//
// Pure, and imports nothing: the rectangles are the window's, handed in by
// main.ts, which reads `visualViewport`.

export interface Box { x: number; y: number; w: number; h: number }

/** Less than this covered is a bar settling, not a keyboard. */
export const KEYBOARD_MIN = 100;
/** A lifted panel narrower than this would be no command line: it goes over the others instead. */
export const LIFTED_MIN_W = 160;

/**
 * The keyboard's top edge in the page's coordinates, or null when there is
 * none: what the visual viewport leaves of the layout viewport's height.
 */
export function keyboardTop(layoutHeight: number, visual: { height: number; offsetTop: number } | null | undefined): number | null {
  if (!visual) return null;
  const bottom = visual.offsetTop + visual.height;
  return layoutHeight - bottom >= KEYBOARD_MIN ? bottom : null;
}

/**
 * Where `panel` goes while the keyboard's top is at `top`, or null where it
 * is clear of the keyboard already. Its bottom on the keyboard; its run
 * across the free stretch of that band — what `others` (every other shown
 * pane, the logo too) leave of the panel's own span — or the whole of its
 * span where that stretch is too short to type in.
 */
export function lifted(panel: Box, top: number, others: readonly Box[]): Box | null {
  if (panel.y + panel.h <= top + 0.5) return null;
  const y = Math.max(0, top - panel.h);
  const band = others.filter((o) => o.y < top && o.y + o.h > y && o.x < panel.x + panel.w && o.x + o.w > panel.x);
  // The panel's span less every pane in the band: what is left, as runs.
  let runs: [number, number][] = [[panel.x, panel.x + panel.w]];
  for (const o of band) {
    runs = runs.flatMap(([a, b]): [number, number][] => {
      if (o.x + o.w <= a || o.x >= b) return [[a, b]];
      return [[a, Math.min(b, o.x)], [Math.max(a, o.x + o.w), b]].filter(([p, q]) => q - p > 0) as [number, number][];
    });
  }
  const best = runs.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0]))[0];
  if (!best || best[1] - best[0] < LIFTED_MIN_W) return { x: panel.x, y, w: panel.w, h: panel.h };
  return { x: best[0], y, w: best[1] - best[0], h: panel.h };
}
