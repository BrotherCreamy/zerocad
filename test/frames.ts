// The one-line fixture frame the rest of the suite is written against.
//
// `fix` and every axis reference are relative to a coordinate frame now, and
// there is no world frame to fall back on — see docs/plans/coordinate-frames.md.
// A test written before frames existed still means what it meant, provided it
// says which frame it means; this is that line. Since 3D frames closed the
// gauge seam `fix` used to have above 2D, that is as true of a 3D test as of a
// 2D one.

import type { Model } from "../src/model.ts";

/**
 * Adds a frame lined up with the kernel's own axes and makes it the default,
 * so a bare `fix` (or `xaxis()`) in a test means exactly what it meant before
 * frames existed: the frame's coordinates and the flat vector's coincide.
 *
 * This is only a *fixture* because a frame is read and never pushed (see
 * `frameBasis` in src/relations/refs.ts) — nothing a test constrains can drag
 * this frame off the axes, so every coordinate the suite asserts still means
 * what it says. Were it otherwise, a fixture frame would be a slow leak rather
 * than a one-line change.
 *
 * The x-ref sits one unit out. Only its *direction* counts, so the distance is
 * arbitrary; one unit is the reading that makes frame coordinates and gauge
 * coordinates literally the same numbers. In a 3D model the y-ref sits one unit
 * out along the kernel's y, for the same reason, which makes the frame's +z the
 * kernel's z.
 *
 * The points are named rather than auto-named, so the `p` counter — which a
 * good many tests assert against by name — is left exactly where it was.
 *
 * `at` moves the whole frame, for the tests that drive the *snapping* code: a
 * frame's points are ordinary points and snapping does not know they are a
 * frame's, so a fixture sitting on the origin would be the nearest thing to
 * every click a line-tool test makes. Those tests park it out of reach and
 * write their `fix` coordinates relative to it, which is what `fix` has always
 * meant and now says out loud. It defaults to the origin in whatever dimension
 * the model has.
 */
export function axisFrame(model: Model, name = "f", at?: number[]): string {
  const o = at ?? new Array<number>(model.dim).fill(0);
  const offset = (axis: number) => o.map((v, i) => (i === axis ? v + 1 : v));
  const origin = model.addPoint(o, `${name}_o`).name;
  const xref = model.addPoint(offset(0), `${name}_x`).name;
  const yref = model.dim === 3 ? model.addPoint(offset(1), `${name}_y`).name : null;
  model.addFrame(origin, xref, yref, name);
  model.setDefaultFrame(name);
  return name;
}

/** A 3D frame's unit axes and a way to name points in its coordinates. */
export interface TiltedFrame {
  name: string;
  origin: number[];
  ux: number[];
  uy: number[];
  uz: number[];
  /** The world point at frame coordinates (u, v, w) — w = 0 is on its plane. */
  at(u: number, v: number, w?: number): number[];
}

/**
 * A 3D frame turned off every kernel axis, made the default — the sketch plane
 * a 3D test draws on when "it still works square to the kernel" would prove
 * nothing. Its +x is the kernel's x turned `spin` about z; the whole frame is
 * then tipped `tip` about that +x, so its plane is neither horizontal nor
 * vertical and its +z leans away from every axis.
 *
 * The refs sit one unit out along the frame's own axes, so the y-ref is already
 * square to the x-ref and `frameBasis` straightens nothing: the axes returned
 * here are exactly the ones every relation reads.
 */
export function tiltedFrame(model: Model, name = "t", origin = [5, -3, 2], spin = 0.4, tip = 0.7): TiltedFrame {
  const ux = [Math.cos(spin), Math.sin(spin), 0];
  const uy = [-Math.sin(spin) * Math.cos(tip), Math.cos(spin) * Math.cos(tip), Math.sin(tip)];
  const uz = [ux[1] * uy[2] - ux[2] * uy[1], ux[2] * uy[0] - ux[0] * uy[2], ux[0] * uy[1] - ux[1] * uy[0]];
  const at = (u: number, v: number, w = 0) => origin.map((o, i) => o + u * ux[i] + v * uy[i] + w * uz[i]);
  model.addPoint(origin, `${name}_o`);
  model.addPoint(at(1, 0), `${name}_x`);
  model.addPoint(at(0, 1), `${name}_y`);
  model.addFrame(`${name}_o`, `${name}_x`, `${name}_y`, name);
  model.setDefaultFrame(name);
  return { name, origin, ux, uy, uz, at };
}
