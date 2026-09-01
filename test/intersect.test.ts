// The three closed forms, and — at least as important — the cases that must
// produce *nothing*. A snap that invents a crossing where two curves are
// merely tangent is worse than no snap at all: it puts a constraint pair on a
// place the drawing does not have.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  circleCircle, intersect, screenAngle, segmentCircle, segmentSegment,
  sweepFrom, withinSweep, TANGENT_EPS, type Curve, type Pt,
} from "../src/intersect.ts";

/** Sorted so a test can compare two crossings without caring which came first. */
const sorted = (ps: Pt[]) => ps.map(([x, y]) => [round(x), round(y)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
const round = (v: number) => Math.round(v * 1e9) / 1e9;

// --- segment x segment ------------------------------------------------------

test("two segments crossing meet at one point", () => {
  assert.deepEqual(sorted(segmentSegment([-10, 0], [10, 0], [0, -10], [0, 10])), [[0, 0]]);
});

test("the crossing is exact, not merely close", () => {
  // The answer is (1/2, 1/2) and it has to be that to the last bit, because a
  // snap that is merely near the crossing is the thing this feature replaces.
  const [p] = segmentSegment([0, 0], [1, 1], [0, 1], [1, 0]);
  assert.ok(Math.abs(p[0] - 0.5) < 1e-15 && Math.abs(p[1] - 0.5) < 1e-15, `got ${p}`);
  const [q] = segmentSegment([0, 0], [3, 3], [0, 1], [1, 0]);
  assert.ok(Math.abs(q[0] - 0.5) < 1e-15, `got ${q}`);
});

test("segments that would cross only if extended do not", () => {
  // Same infinite lines as above, but the second segment stops short.
  assert.deepEqual(segmentSegment([-10, 0], [10, 0], [0, 3], [0, 10]), []);
  assert.deepEqual(segmentSegment([2, 0], [10, 0], [0, -10], [0, 10]), []);
});

test("a crossing exactly on an endpoint counts", () => {
  assert.deepEqual(sorted(segmentSegment([-10, 0], [10, 0], [0, 0], [0, 10])), [[0, 0]]);
});

test("parallel segments produce nothing", () => {
  assert.deepEqual(segmentSegment([0, 0], [10, 0], [0, 5], [10, 5]), []);
  assert.deepEqual(segmentSegment([0, 0], [10, 10], [3, 0], [13, 10]), []);
});

test("collinear segments produce nothing, overlapping or not", () => {
  // They cross at infinitely many places, which is not a place.
  assert.deepEqual(segmentSegment([0, 0], [10, 0], [5, 0], [15, 0]), []);
  assert.deepEqual(segmentSegment([0, 0], [10, 0], [20, 0], [30, 0]), []);
});

test("a degenerate (zero-length) segment produces nothing", () => {
  assert.deepEqual(segmentSegment([5, 5], [5, 5], [0, 0], [10, 10]), []);
});

test("the parallel test is scale-free", () => {
  // Nearly-parallel but genuinely crossing inside both extents, at any size.
  for (const s of [1e-3, 1, 1e4]) {
    const hit = segmentSegment([-s, 0], [s, 0], [-s, -s * 1e-4], [s, s * 1e-4]);
    assert.equal(hit.length, 1, `scale ${s}`);
    assert.ok(Math.abs(hit[0][0]) < s * 1e-9, `scale ${s}: got ${hit[0]}`);
  }
});

// --- segment x circle -------------------------------------------------------

test("a chord through a circle crosses it twice", () => {
  assert.deepEqual(sorted(segmentCircle([-20, 0], [20, 0], [0, 0], 10)), [[-10, 0], [10, 0]]);
});

test("a segment ending inside the circle crosses it once", () => {
  assert.deepEqual(sorted(segmentCircle([-20, 0], [0, 0], [0, 0], 10)), [[-10, 0]]);
});

test("a segment entirely inside the circle crosses it nowhere", () => {
  assert.deepEqual(segmentCircle([-2, 0], [2, 0], [0, 0], 10), []);
});

test("a segment whose infinite line would cut the circle, but stops short, misses", () => {
  assert.deepEqual(segmentCircle([-40, 0], [-20, 0], [0, 0], 10), []);
});

test("a line missing the circle entirely produces nothing", () => {
  assert.deepEqual(segmentCircle([-20, 30], [20, 30], [0, 0], 10), []);
});

test("a tangent line produces nothing — a touch is not a crossing", () => {
  assert.deepEqual(segmentCircle([-20, 10], [20, 10], [0, 0], 10), []);
  // And still nothing when the tangency is only as exact as a solver leaves it.
  assert.deepEqual(segmentCircle([-20, 10 - 1e-9], [20, 10 - 1e-9], [0, 0], 10), []);
});

test("the tangent threshold is about the crossings, not the residual", () => {
  // Two crossings this far apart are one crossing by our definition...
  const doubled = segmentCircle([-20, 10 - 1e-5], [20, 10 - 1e-5], [0, 0], 10);
  assert.deepEqual(doubled, [], "roots ~0.03px apart are one point");
  // ...and this far apart they are two. (Half-separation is sqrt(2*10*h).)
  const grazing = segmentCircle([-20, 10 - 0.01], [20, 10 - 0.01], [0, 0], 10);
  assert.equal(grazing.length, 2);
  assert.ok(Math.hypot(grazing[0][0] - grazing[1][0], grazing[0][1] - grazing[1][1]) > TANGENT_EPS);
});

test("a zero-radius circle is not a curve to cross", () => {
  assert.deepEqual(segmentCircle([-20, 0], [20, 0], [0, 0], 0), []);
});

// --- circle x circle --------------------------------------------------------

test("two overlapping circles cross twice", () => {
  // Unit circles centred 1 apart: the classic vesica, crossings at x = 1/2.
  const hits = circleCircle([0, 0], 1, [1, 0], 1);
  assert.equal(hits.length, 2);
  for (const [x, y] of hits) {
    assert.ok(Math.abs(x - 0.5) < 1e-12, `x ${x}`);
    assert.ok(Math.abs(Math.abs(y) - Math.sqrt(3) / 2) < 1e-12, `y ${y}`);
  }
});

test("circles far apart, and one nested in the other, cross nowhere", () => {
  assert.deepEqual(circleCircle([0, 0], 10, [100, 0], 10), []);
  assert.deepEqual(circleCircle([0, 0], 50, [5, 0], 10), []);
});

test("externally tangent circles produce nothing", () => {
  assert.deepEqual(circleCircle([0, 0], 10, [20, 0], 10), []);
  assert.deepEqual(circleCircle([0, 0], 10, [20 - 1e-9, 0], 10), []);
});

test("internally tangent circles produce nothing", () => {
  assert.deepEqual(circleCircle([0, 0], 20, [10, 0], 10), []);
  assert.deepEqual(circleCircle([0, 0], 20, [10 + 1e-9, 0], 10), []);
});

test("coincident circles produce nothing", () => {
  assert.deepEqual(circleCircle([0, 0], 10, [0, 0], 10), []);
  assert.deepEqual(circleCircle([0, 0], 10, [0, 0], 4), [], "concentric, different radii");
});

// --- arcs: the same circles, gated by sweep ---------------------------------

// Screen angles run clockwise-negative from +x, and `sweepFrom` runs the other
// way from world angles — so this arc is the quadrant with x > 0 and screen
// y < 0, which is the upper right of the picture.
const quadrant: Curve = { kind: "arc", c: [0, 0], r: 10, a0: 0, a1: -Math.PI / 2, slack: 0 };

test("an arc crosses only within its sweep", () => {
  const through: Pt[] = [[6, -20], [6, 20]];
  assert.deepEqual(
    sorted(intersect({ kind: "segment", a: through[0], b: through[1] }, quadrant)),
    [[6, -8]],
    "the circle is cut twice; only the upper crossing is on the arc",
  );
});

test("a crossing outside the sweep is no crossing at all", () => {
  assert.deepEqual(intersect({ kind: "segment", a: [-6, -20], b: [-6, 20] }, quadrant), []);
  // The same segment against the whole circle does cross it, twice.
  assert.equal(intersect({ kind: "segment", a: [-6, -20], b: [-6, 20] },
    { kind: "circle", c: [0, 0], r: 10 }).length, 2);
});

test("both arcs' sweeps gate the result, not just the first", () => {
  // The two circles cross at (5, ±5√3). `quadrant` keeps only the negative-y
  // one; `other` is drawn to keep only the positive-y one. Each crossing is on
  // one arc and off the other, so together there is nothing.
  const other: Curve = { kind: "arc", c: [10, 0], r: 10, a0: 2.6, a1: 0.6, slack: 0 };
  const whole: Curve = { kind: "circle", c: [10, 0], r: 10 };
  const wholeQ: Curve = { kind: "circle", c: [0, 0], r: 10 };

  const viaQuadrant = intersect(quadrant, whole);
  assert.equal(viaQuadrant.length, 1);
  assert.ok(viaQuadrant[0][1] < 0, "the arc keeps the crossing above the centre line on screen");

  const viaOther = intersect(wholeQ, other);
  assert.equal(viaOther.length, 1);
  assert.ok(viaOther[0][1] > 0, "the other arc keeps the other one");

  assert.deepEqual(intersect(quadrant, other), [], "and no crossing survives both");
});

test("withinSweep is what picking asks and what intersection asks", () => {
  // The definition itself, pinned: it is asymmetric, and slack only extends
  // the far end.
  assert.equal(withinSweep(0, -Math.PI / 2, -Math.PI / 4, 0), true);
  assert.equal(withinSweep(0, -Math.PI / 2, Math.PI / 4, 0), false);
  assert.equal(withinSweep(0, -Math.PI / 2, -Math.PI / 2 - 0.05, 0), false);
  assert.equal(withinSweep(0, -Math.PI / 2, -Math.PI / 2 - 0.05, 0.1), true);
  assert.equal(sweepFrom(0, -Math.PI / 2), Math.PI / 2);
  assert.ok(Math.abs(screenAngle(0, 0, 1, -1) + Math.PI / 4) < 1e-12);
});

// --- the dispatcher ---------------------------------------------------------

test("intersect does not care which curve comes first", () => {
  const seg: Curve = { kind: "segment", a: [-20, 0], b: [20, 0] };
  const cir: Curve = { kind: "circle", c: [0, 0], r: 10 };
  assert.deepEqual(sorted(intersect(seg, cir)), sorted(intersect(cir, seg)));
  assert.deepEqual(sorted(intersect(seg, cir)), [[-10, 0], [10, 0]]);
});
