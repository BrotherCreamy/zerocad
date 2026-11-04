// The closed forms the parts are graded against must themselves be right, or
// every "volume error" in the report is measured against a wrong number.
// Each is checked against a shape whose answer is known by other means.

import { test } from "node:test";
import assert from "node:assert/strict";
import { circle, distanceTo, loopArea, profile, profileArea, rect, revolvedVolume, roundedRect } from "../src/profiles.ts";
import { PARTS } from "../src/parts.ts";

const near = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} vs ${b}`);

test("a rectangle's area, both windings", () => {
  near(loopArea(rect(0, 0, 4, 3)), 12);
  near(Math.abs(loopArea(rect(0, 0, 4, 3).map((m) => (m.kind === "line" ? { ...m, from: m.to, to: m.from } : m)).reverse())), 12);
});

test("a circle's area, and a rounded rectangle's", () => {
  near(loopArea(circle(3, -2, 5)), Math.PI * 25);
  near(loopArea(roundedRect(0, 0, 60, 40, 8)), 60 * 40 - (4 - Math.PI) * 64);
});

test("a profile with holes subtracts them", () => {
  near(profileArea(profile(rect(0, 0, 10, 10), circle(5, 5, 2))), 100 - 4 * Math.PI);
});

test("Pappus: a rectangle turned about the y axis is a tube", () => {
  near(revolvedVolume(rect(2, 0, 5, 7)), Math.PI * (25 - 4) * 7);
});

test("Pappus: a half disc on the axis turned is a sphere", () => {
  const r = 3;
  const half = [
    { kind: "arc" as const, centre: [0, 0] as [number, number], radius: r, start: -90, end: 90 },
    { kind: "line" as const, from: [0, r] as [number, number], to: [0, -r] as [number, number] },
  ];
  near(revolvedVolume(half), (4 / 3) * Math.PI * r ** 3);
});

test("a torus by Pappus", () => {
  near(revolvedVolume(circle(10, 0, 2)), 2 * Math.PI * 10 * Math.PI * 4);
});

test("distance to an arc is to the arc, not to its circle, outside its sweep", () => {
  const a = { kind: "arc" as const, centre: [0, 0] as [number, number], radius: 1, start: 0, end: 90 };
  near(distanceTo(a, [2, 0]), 1);
  near(distanceTo(a, [-1, -1]), Math.min(Math.hypot(2, 1), Math.hypot(1, 2)));
});

test("the fillet part's closed form agrees with a numerical integral of the same solid", () => {
  // The rolling-ball fillet of a convex outline's top edge, integrated slice by
  // slice: at depth u below the lid (u < r) the section is the outline offset
  // inward by r − √(r² − (r − u)²), whose area is A − P·δ + π·δ² for a convex
  // outline with round corners (Steiner).
  const p = PARTS.find((x) => x.name === "fillet-outline-and-top")!;
  const d = p.dims;
  const A = profileArea(profile(roundedRect(0, 0, d.L, d.W, d.R)));
  const P = 2 * (d.L - 2 * d.R) + 2 * (d.W - 2 * d.R) + 2 * Math.PI * d.R;
  const N = 200000;
  let v = A * (d.T - d.r);
  for (let i = 0; i < N; i++) {
    const u = ((i + 0.5) / N) * d.r;
    const delta = d.r - Math.sqrt(d.r * d.r - (d.r - u) * (d.r - u));
    v += (A - P * delta + Math.PI * delta * delta) * (d.r / N);
  }
  near(p.expect(d).volume, v, 1e-7);
});

test("every part's rebuild changes every dimension it has", () => {
  for (const p of PARTS) {
    assert.deepEqual(Object.keys(p.changed).sort(), Object.keys(p.dims).sort(), p.name);
    for (const k of Object.keys(p.dims)) assert.notEqual(p.changed[k], p.dims[k], `${p.name}.${k}`);
  }
});
