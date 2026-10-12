// Three-vectors over plain numbers, for the code that works on *values* — the
// camera, arc layout, the working plane. (Residuals work on Duals, through
// relations/vec.ts, and are dimension-generic; this is the other side of that
// line: arithmetic on numbers already read out of the model, once the app has
// decided it is looking at a 3D scene.)
//
// Imports nothing, so view.ts can keep depending on nothing else.

/** A world point as three coordinates: a 2D model's points live at z = 0. */
export function lift3(w: number[]): number[] {
  return [w[0] ?? 0, w[1] ?? 0, w[2] ?? 0];
}

export function dot3(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross3(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function sub3(a: number[], b: number[]): number[] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** `v` at unit length, or null when it has none to speak of. */
export function unit3(v: number[]): number[] | null {
  const len = Math.hypot(v[0], v[1], v[2]);
  return len > 1e-12 ? [v[0] / len, v[1] / len, v[2] / len] : null;
}
