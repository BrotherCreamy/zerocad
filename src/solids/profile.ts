// Plain geometry over a kernel profile (kernel.ts's `Member`s in their own
// plane): what the naming needs to say which member a face was swept from, and
// what a caller needs to ask whether a point is inside a region. Numbers only —
// the layer rule's kernel edge, as for everything under src/solids/.

import type { Member, Profile, V2 } from "./kernel.ts";

const rad = (d: number) => (d * Math.PI) / 180;

/**
 * A `nurbs` member's point at parameter `t`, by de Boor's algorithm in
 * homogeneous coordinates — so a rational curve (an exact ellipse) is evaluated
 * exactly. `t` is clamped to the knot range.
 */
export function nurbsPoint(m: Extract<Member, { kind: "nurbs" }>, t: number): V2 {
  const knots = m.knots.flatMap((k, i) => Array<number>(m.mults[i]).fill(k));
  const p = m.degree;
  const [lo, hi] = [knots[p], knots[knots.length - p - 1]];
  const u = Math.min(hi, Math.max(lo, t));
  let span = p;
  while (span < knots.length - p - 2 && u >= knots[span + 1]) span++;
  const d = Array.from({ length: p + 1 }, (_, j) => {
    const [x, y, w] = m.points[span - p + j];
    return [x * w, y * w, w];
  });
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = span - p + j;
      const denom = knots[i + p - r + 1] - knots[i];
      const a = denom === 0 ? 0 : (u - knots[i]) / denom;
      d[j] = d[j].map((c, k) => (1 - a) * d[j - 1][k] + a * c);
    }
  }
  return [d[p][0] / d[p][2], d[p][1] / d[p][2]];
}

/** Distance from a point in the profile's plane to a member. */
export function distanceTo(m: Member, p: V2): number {
  if (m.kind === "line") {
    const [ax, ay] = m.from, [bx, by] = m.to;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2));
    return Math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy);
  }
  if (m.kind === "nurbs") {
    // No closed form: the nearest of a fine walk along it, enough to say which
    // member a face was swept from.
    return Math.min(...memberPoints(m, 256).map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
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

/**
 * A member as points along it, `n` pieces of an arc or circle (a line is its
 * two ends) — in its own direction: a line from `from`, an arc
 * counter-clockwise from `start`.
 */
export function memberPoints(m: Member, n = 32): V2[] {
  if (m.kind === "line") return [m.from, m.to];
  if (m.kind === "nurbs") {
    const [a, b] = [m.knots[0], m.knots[m.knots.length - 1]];
    const out = Array.from({ length: n + 1 }, (_, i) => nurbsPoint(m, a + ((b - a) * i) / n));
    // Closed when it starts where it ends, exactly — the circle's reason above.
    const [s, e] = [m.points[0], m.points[m.points.length - 1]];
    if (s[0] === e[0] && s[1] === e[1]) out[n] = out[0];
    return out;
  }
  const [a, b] = m.kind === "circle" ? [0, 360] : [m.start, m.end];
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = rad(a + ((b - a) * i) / n);
    out.push([m.centre[0] + m.radius * Math.cos(t), m.centre[1] + m.radius * Math.sin(t)]);
  }
  // A circle closes on itself exactly: cos(2π) is not quite cos(0), and a ray
  // through the gap between them crossed no edge at all (measured: a hole's
  // centre at the height of its circle's start read as outside).
  if (m.kind === "circle") out[n] = out[0];
  return out;
}

/**
 * Whether `p` is inside the profile's region, even-odd over every loop — the
 * rule the kernel's sweep and faces.ts's caps fill by: inside an odd number of
 * loops is material, so a hole is empty and an island in it solid. Each
 * member is crossed on its own (a ray to +x, half-open in y), so the order
 * and direction the members come in do not matter.
 */
export function insideProfile(profile: Profile, q: V2): boolean {
  // The ray is lifted off the point by a part in a billion of the profile's
  // size — no point a caller asks about lies there by design — so it never
  // passes exactly through a vertex, where two members' ends, rounded apart,
  // could both be missed or both be counted.
  let size = 0;
  for (const loop of profile.loops) for (const m of loop) for (const x of memberPoints(m, 4)) size = Math.max(size, Math.abs(x[0]), Math.abs(x[1]));
  const p: V2 = [q[0], q[1] + Math.PI * 1e-9 * Math.max(1, size)];
  let inside = false;
  for (const loop of profile.loops) {
    for (const m of loop) {
      const pts = memberPoints(m, 64);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        if ((a[1] > p[1]) === (b[1] > p[1])) continue;
        const x = a[0] + ((p[1] - a[1]) * (b[0] - a[0])) / (b[1] - a[1]);
        if (x > p[0]) inside = !inside;
      }
    }
  }
  return inside;
}
