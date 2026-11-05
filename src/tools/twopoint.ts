// The first stage the shape tools share (docs/plans/sketch-shapes.md): two
// places on the gesture's plane, given as a drag — press at the first, let go
// at the second — or as two clicks, the circle tool's centre-then-rim
// (circle.ts). A polygon is centre then vertex, a slot its two centres, an
// ellipse its centre then its major end; what each does with the pair, and
// whether a second stage follows, is the tool's.
//
// Nothing is created here: it only reads the hand. Each place is kept whole —
// a `PointerInfo`, snap and all — so the commit's `placePoint` can infer from
// what the press and the release landed on (place.ts), exactly as the
// rectangle keeps its first press.

import type { PointerInfo, ToolContext } from "./tool.ts";
import { CurvePlane, requirePlanar } from "./place.ts";
import { pressMoved } from "./curvemethod.ts";
import { cross3, lift3 } from "../vec3.ts";

/** Two clicks closer than this, in world units, are one: a double-click, swallowed. */
const SAME_POINT_EPS = 1e-6;

export class TwoPoint {
  private ctx: ToolContext;
  private tool: string;
  /** The gesture's plane — where every place is read, and what holds the shape there. */
  readonly plane: CurvePlane;
  /** The first place, once it is known. */
  first: PointerInfo | null = null;
  /** Where the hand is now — the second place so far. */
  hover: PointerInfo | null = null;
  /** A press in progress, and whether it has moved past a click. */
  private press: PointerInfo | null = null;
  private dragged = false;

  constructor(ctx: ToolContext, tool: string) {
    this.ctx = ctx;
    this.tool = tool;
    this.plane = new CurvePlane(ctx, tool);
  }

  /** Whether the first place has been given, and the second is being chosen. */
  get active(): boolean {
    return this.first !== null;
  }

  /** A press: the first place, or the start of the second. */
  down(p: PointerInfo): void {
    requirePlanar(this.ctx.model, this.tool);
    if (!this.first) this.plane.begin(p);
    p = this.plane.settle(p);
    this.hover = p;
    this.press = p;
    this.dragged = false;
    if (!this.first) this.first = p;
    this.ctx.requestRender();
  }

  move(p: PointerInfo): void {
    if (!this.first) return;
    this.hover = this.plane.settle(p);
    if (this.press && !this.dragged && pressMoved(this.press, p)) this.dragged = true;
    this.ctx.requestRender();
  }

  /**
   * A release. Returns the pair when it completes the stage — a drag let go,
   * or the second of two clicks — and null while the first click waits for
   * its second.
   */
  up(p: PointerInfo): { from: PointerInfo; to: PointerInfo } | null {
    const pressed = this.press;
    if (!pressed || !this.first) return null;
    this.press = null;
    const to = this.plane.settle(p);
    this.hover = to;
    const moved = this.dragged || pressMoved(pressed, p);
    this.dragged = false;
    // The first press lifted where it landed: a click, and the second place
    // is the next one.
    if (pressed === this.first && !moved) return null;
    if (Math.hypot(...to.world.map((v, i) => v - this.first!.world[i])) < SAME_POINT_EPS) return null;
    return { from: this.first, to };
  }

  /** Back to nothing: the gesture done or abandoned. */
  reset(): void {
    this.first = null;
    this.hover = null;
    this.press = null;
    this.dragged = false;
  }

  cancel(): void {
    this.reset();
    this.plane.cancel();
  }
}

/** The world point a pixel lands on in the gesture's plane, ignoring what it snapped to — a length to read, not a place to put a point. */
export function unsnapped(plane: CurvePlane, p: PointerInfo): number[] {
  return p.snap ? plane.settle({ ...p, snap: undefined }).world : p.world;
}

/** How far `at` is from the line through `a` and `b` — a slot's half-width, an ellipse's minor: the second stage's length. */
export function halfWidth(a: number[], b: number[], at: number[]): number {
  const [A, B, P] = [lift3(a), lift3(b), lift3(at)];
  const d = B.map((x, i) => x - A[i]);
  const len = Math.hypot(...d);
  if (!(len > 0)) return 0;
  const w = P.map((x, i) => x - A[i]);
  return Math.hypot(...cross3(w, d)) / len;
}
