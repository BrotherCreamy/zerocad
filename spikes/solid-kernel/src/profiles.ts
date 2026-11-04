// Profile builders and the independent arithmetic the test parts are checked
// against — closed forms over the profile, never a kernel's answer.

import type { Member, Profile, V2 } from "./kernel.ts";

/** A counter-clockwise rectangle. */
export function rect(x0: number, y0: number, x1: number, y1: number): Member[] {
  const p: V2[] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return p.map((a, i) => ({ kind: "line", from: a, to: p[(i + 1) % 4] }));
}

/** A counter-clockwise rectangle with every corner rounded to `r`: four lines, four arcs. */
export function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number): Member[] {
  return [
    { kind: "line", from: [x0 + r, y0], to: [x1 - r, y0] },
    { kind: "arc", centre: [x1 - r, y0 + r], radius: r, start: -90, end: 0 },
    { kind: "line", from: [x1, y0 + r], to: [x1, y1 - r] },
    { kind: "arc", centre: [x1 - r, y1 - r], radius: r, start: 0, end: 90 },
    { kind: "line", from: [x1 - r, y1], to: [x0 + r, y1] },
    { kind: "arc", centre: [x0 + r, y1 - r], radius: r, start: 90, end: 180 },
    { kind: "line", from: [x0, y1 - r], to: [x0, y0 + r] },
    { kind: "arc", centre: [x0 + r, y0 + r], radius: r, start: 180, end: 270 },
  ];
}

export function circle(cx: number, cy: number, r: number): Member[] {
  return [{ kind: "circle", centre: [cx, cy], radius: r }];
}

export function profile(...loops: Member[][]): Profile {
  return { loops };
}

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * ∮ along a member of (x dy) and of (x² dy)/2 — the two line integrals Green's
 * theorem turns area and the revolved volume into. Exact for lines and arcs.
 */
function integrals(m: Member): { area: number; half2: number } {
  if (m.kind === "line") {
    const [x0, y0] = m.from, [x1, y1] = m.to;
    const dy = y1 - y0;
    // x(t) linear: ∫x dy = dy·(x0+x1)/2; ∫x²/2 dy = dy·(x0²+x0x1+x1²)/6.
    return { area: (dy * (x0 + x1)) / 2, half2: (dy * (x0 * x0 + x0 * x1 + x1 * x1)) / 6 };
  }
  const [cx, cy] = m.centre, r = m.radius;
  const a = m.kind === "circle" ? 0 : rad(m.start);
  const b = m.kind === "circle" ? 2 * Math.PI : rad(m.end);
  // x = cx + r cos t, dy = r cos t dt.
  const I1 = (t: number) => Math.sin(t); // ∫cos
  const I2 = (t: number) => t / 2 + Math.sin(2 * t) / 4; // ∫cos²
  const I3 = (t: number) => Math.sin(t) - Math.sin(t) ** 3 / 3; // ∫cos³
  const area = r * (cx * (I1(b) - I1(a)) + r * (I2(b) - I2(a)));
  const half2 = (r / 2) * (cx * cx * (I1(b) - I1(a)) + 2 * cx * r * (I2(b) - I2(a)) + r * r * (I3(b) - I3(a)));
  void cy;
  return { area, half2 };
}

/** Signed area of a closed loop (counter-clockwise positive). */
export function loopArea(loop: Member[]): number {
  return loop.reduce((s, m) => s + integrals(m).area, 0);
}

/** Area of an even-odd profile whose first loop is the outer one and the rest holes in it. */
export function profileArea(p: Profile): number {
  return p.loops.reduce((s, l, i) => s + (i === 0 ? 1 : -1) * Math.abs(loopArea(l)), 0);
}

/**
 * Volume of the full turn of a closed loop about the local y axis (x = 0),
 * the loop lying in x ≥ 0: V = 2π ∬ x dA = 2π |∮ x²/2 dy|.
 */
export function revolvedVolume(loop: Member[]): number {
  return 2 * Math.PI * Math.abs(loop.reduce((s, m) => s + integrals(m).half2, 0));
}

/** Length of a member. */
export function memberLength(m: Member): number {
  if (m.kind === "line") return Math.hypot(m.to[0] - m.from[0], m.to[1] - m.from[1]);
  if (m.kind === "circle") return 2 * Math.PI * m.radius;
  return rad(m.end - m.start) * m.radius;
}

/** Distance from a point in the profile's plane to a member. */
export function distanceTo(m: Member, p: V2): number {
  if (m.kind === "line") {
    const [ax, ay] = m.from, [bx, by] = m.to;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy);
  }
  const d = Math.hypot(p[0] - m.centre[0], p[1] - m.centre[1]);
  if (m.kind === "circle") return Math.abs(d - m.radius);
  let a = (Math.atan2(p[1] - m.centre[1], p[0] - m.centre[0]) * 180) / Math.PI;
  while (a < m.start) a += 360;
  if (a <= m.end) return Math.abs(d - m.radius);
  const end = (t: number): V2 => [m.centre[0] + m.radius * Math.cos(rad(t)), m.centre[1] + m.radius * Math.sin(rad(t))];
  const [s, e] = [end(m.start), end(m.end)];
  return Math.min(Math.hypot(p[0] - s[0], p[1] - s[1]), Math.hypot(p[0] - e[0], p[1] - e[1]));
}
