// Which features make which bodies, and what a new feature does by default
// (docs/plans/solids-kernel.md).
//
// **A body is the result of its chain**: a feature of mode `new` (or one from
// a file older than modes) starts one, and every later feature whose `into`
// names a feature of it is unioned into it, cut from it or intersected with
// it, in the order the features were made. No timeline: the order is the
// features' own, and a feature can only name a body that existed when it was
// made, so that order is a dependency order. A body is called by its first
// feature's name.
//
// **A default, decided once, at the call** — Onshape's: an extrude or revolve
// whose solid touches a body or overlaps one **adds** to it; one that touches
// nothing is a **new** body. Cut and intersect are never a default; they are
// chosen (the dialog offers Cut when the depth runs into a body). Decided by
// the call and journalled with it, resolved, like the frame an extrude runs
// along — so dragging the profile off the body later does not quietly turn
// an add into a new body, and a replay reads no geometry to know.
//
// **Insideness is closed-form** — a point is in an extrude when its foot on
// the sketch plane is in the profile (even-odd) and its height is between the
// base and the lid; in a revolve when its turn back into the profile's half
// plane lands in the profile within the angle — over the live, solved
// geometry, the same numbers the kernel is handed (`kernelSweep`). So the
// default needs no kernel, and is the same in a replay-free unit test, before
// the kernel has loaded, and on a phone that never loads it. A body's inside is
// its chain's, union and cut in order; a body's chain is read approximately in
// one respect only — a sample point exactly on a face counts as outside — which
// is why the probes stand a little off the profile's plane.
//
// Pure: a function of the model, at the operations' height (operations.ts
// asks it inside `extrude` and `revolve`).

import type { BlendFeature, FeatureEntry, FeatureMode, Model, ProfileMember } from "./model.ts";
import { kernelProfile, kernelSweep } from "./solids.ts";
import { insideProfile, memberPoints } from "./solids/profile.ts";
import type { V2 } from "./solids/kernel.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

/**
 * Why a feature makes no body, or null when it does: **open** — an edge of
 * its profile deleted, from both linked profiles — or **unbuilt**, the
 * relation it is built from deleted (docs/plans/linked-profiles.md). What the
 * organiser's row says after the kind, and what the chain leaves it out for.
 */
export function featureBuilds(f: FeatureEntry): string | null {
  if (f.unbuilt !== undefined) return f.unbuilt;
  if (f.kind === "extrude" && f.open) return "it is open — an edge of its profile is gone; draw the edge again, on either profile, and it closes";
  return null;
}

/** A feature's mode as evaluation reads it: a record with none is from before modes, and a body of its own. */
export function modeOf(f: FeatureEntry): FeatureMode {
  return f.mode ?? "new";
}

export interface Chain {
  /** The body's name: its first feature's. */
  name: string;
  /** Its sweeps in evaluation order, the first making it. */
  features: FeatureEntry[];
  /**
   * Everything the body is built of, in evaluation order: its sweeps, and the
   * fillets and chamfers among them (docs/plans/solid-fillets.md) — each
   * blend where its number falls, so it rounds what the features made before
   * it left, and a cut made after it cuts the rounded body.
   */
  steps: (FeatureEntry | BlendFeature)[];
}

export interface Chains {
  bodies: Chain[];
  /** Features left out of every body, and why — a cut whose body is gone. */
  left: { feature: string; why: string }[];
  /** Features that fell back to a body of their own, and why — an add whose body is gone. */
  alone: { feature: string; why: string }[];
}

/**
 * Every body the model's features make, in order. **Hidden** follows the
 * organiser's two meanings: a body whose first feature is hidden is hidden
 * whole (left out here, as `solidsOf` leaves a hidden feature out); a later
 * feature hidden is **suppressed** — left out of its chain, so hiding a cut
 * shows the body uncut, which is what hiding a cut can usefully mean.
 */
export function chainsOf(model: Model, opts: { hidden?: boolean } = {}): Chains {
  const out: Chains = { bodies: [], left: [], alone: [] };
  const bodyOf = new Map<string, Chain>();
  const hidden = (f: FeatureEntry | BlendFeature) => !opts.hidden && model.hidden.has(f.name);
  // The blends, each taken in just before the first sweep numbered after it:
  // a blend applies to what was made before it. Merged rather than sorted, so
  // the sweeps' own order is the registry's, exactly as it always was.
  const blends = [...model.blends.values()];
  const number = (name: string) => Number(/^e(\d+)$/.exec(name)?.[1] ?? Number.POSITIVE_INFINITY);
  const takeBlends = (upTo: number) => {
    while (blends.length && number(blends[0].name) < upTo) {
      const b = blends.shift()!;
      const target = bodyOf.get(b.into);
      // Its dimension deleted (docs/plans/linked-profiles.md): the body is drawn without it, and it says why.
      if (b.unbuilt !== undefined) {
        out.left.push({ feature: b.name, why: b.unbuilt });
        continue;
      }
      if (!target) {
        out.left.push({ feature: b.name, why: `it ${b.kind === "fillet" ? "fillets" : "chamfers"} edges of ${b.into}, which is no longer there` });
        continue;
      }
      bodyOf.set(b.name, target);
      if (!hidden(b)) target.steps.push(b);
    }
  };
  for (const f of model.features.values()) {
    takeBlends(number(f.name));
    // **No body of an open or an unbuilt feature** (docs/plans/linked-profiles.md):
    // an extrude with an edge of its profile gone bounds no volume — its
    // surviving walls are drawn as open surfaces (faces.ts) — and one whose
    // depth or angle was deleted has nothing to be built from. Each is left
    // out and says why; what was added to or cut from it says its body is gone.
    const why = featureBuilds(f);
    if (why !== null) {
      out.left.push({ feature: f.name, why });
      continue;
    }
    const mode = modeOf(f);
    const target = mode === "new" ? undefined : f.into === undefined ? undefined : bodyOf.get(f.into);
    if (mode === "new" || !target) {
      if (mode !== "new" && mode !== "add") {
        out.left.push({ feature: f.name, why: `it ${mode === "cut" ? "cuts" : "intersects"} ${f.into ?? "a body"}, which is no longer there` });
        continue;
      }
      if (mode === "add") out.alone.push({ feature: f.name, why: `it adds to ${f.into ?? "a body"}, which is no longer there, so it is a body of its own` });
      const chain: Chain = { name: f.name, features: [f], steps: [f] };
      bodyOf.set(f.name, chain);
      if (!hidden(f)) out.bodies.push(chain);
      continue;
    }
    bodyOf.set(f.name, target);
    if (!hidden(f)) {
      target.features.push(f);
      target.steps.push(f);
    }
  }
  takeBlends(Number.POSITIVE_INFINITY);
  // A body hidden whole is gone from `bodies` already; its later features went into a chain nobody reads.
  return out;
}

/** The body a feature, a fillet or a chamfer is part of, by name — null for one left out. */
export function bodyNameOf(model: Model, feature: string): string | null {
  for (const c of chainsOf(model, { hidden: true }).bodies) if (c.steps.some((f) => f.name === feature)) return c.name;
  return null;
}

// ---- insideness, closed form ----------------------------------------------------

interface Inside {
  (p: number[]): boolean;
}

/** Whether a world point is strictly inside a feature's own solid (no booleans). */
export function insideFeature(model: Model, f: FeatureEntry): Inside {
  const { at, profile, sweep } = kernelSweep(model, f);
  const x = at.x, y = at.y, z = cross3(at.x, at.y);
  const local = (p: number[]) => { const d = sub3(p, at.origin); return [dot3(d, x), dot3(d, y), dot3(d, z)]; };
  if (sweep.kind === "extrude") {
    const [lo, hi] = sweep.depth > 0 ? [0, sweep.depth] : [sweep.depth, 0];
    return (p) => {
      const q = local(p);
      return q[2] > lo && q[2] < hi && insideProfile(profile, [q[0], q[1]]);
    };
  }
  const len = Math.hypot(sweep.dir[0], sweep.dir[1]);
  const u: V2 = [sweep.dir[0] / len, sweep.dir[1] / len];
  const nrm: V2 = [-u[1], u[0]];
  // The side of the axis the profile is on: its points, summed.
  const pts = profile.loops.flat().flatMap((m) => memberPoints(m, 8));
  const side = Math.sign(pts.reduce((s, q) => s + (q[0] - sweep.point[0]) * nrm[0] + (q[1] - sweep.point[1]) * nrm[1], 0)) || 1;
  const turn = (sweep.degrees * Math.PI) / 180;
  return (p) => {
    const q = local(p);
    const rel = [q[0] - sweep.point[0], q[1] - sweep.point[1]];
    const along = rel[0] * u[0] + rel[1] * u[1];
    const across = (rel[0] * nrm[0] + rel[1] * nrm[1]) * side;
    const r = Math.hypot(across, q[2]);
    // The kernel turns right-handed about +dir (measured), which carries the
    // profile's side of the axis toward z = side (dir × side·n̂ = side·ẑ).
    let a = Math.atan2(q[2] * side, across);
    if (a < 0) a += 2 * Math.PI;
    if (sweep.degrees < 360 && a >= turn) return false;
    const back: V2 = [sweep.point[0] + u[0] * along + nrm[0] * r * side, sweep.point[1] + u[1] * along + nrm[1] * r * side];
    return insideProfile(profile, back);
  };
}

/** Whether a world point is inside a body: its chain's features unioned, cut and intersected in order. */
export function insideBody(model: Model, chain: Chain): Inside {
  const tests: { mode: FeatureMode; inside: Inside }[] = [];
  for (const f of chain.features) {
    try {
      tests.push({ mode: tests.length === 0 ? "new" : modeOf(f), inside: insideFeature(model, f) });
    } catch {
      // A feature that cannot be laid out is no part of what the body is now.
    }
  }
  return (p) => {
    let yes = false;
    for (const t of tests) {
      if (t.mode === "new" || t.mode === "add") yes = yes || t.inside(p);
      else if (t.mode === "cut") yes = yes && !t.inside(p);
      else yes = yes && t.inside(p);
    }
    return yes;
  };
}

// ---- the default ------------------------------------------------------------------

/**
 * Points of a feature's solid to probe a body with: interior points of its
 * profile (a grid over its extent, kept where the profile is), each just
 * behind the profile's plane, just in front and half way along the sweep —
 * so a sketch on a body's face, extruded either way, finds the body.
 */
function probes(model: Model, f: FeatureEntry): { behind: number[][]; ahead: number[][] } {
  const { at, profile, sweep } = kernelSweep(model, f);
  const pts = profile.loops.flat().flatMap((m) => memberPoints(m, 16));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const size = Math.max(x1 - x0, y1 - y0, 1e-9);
  const inside: V2[] = [];
  const N = 9;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const p: V2 = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
      if (insideProfile(profile, p)) inside.push(p);
    }
  }
  const z = cross3(at.x, at.y);
  const world = (p: V2, h: number) => [0, 1, 2].map((i) => at.origin[i] + p[0] * at.x[i] + p[1] * at.y[i] + h * z[i]);
  const eps = 1e-4 * size;
  if (sweep.kind === "extrude") {
    const s = Math.sign(sweep.depth);
    return {
      behind: inside.map((p) => world(p, -s * eps)),
      ahead: inside.flatMap((p) => [world(p, s * eps), world(p, sweep.depth / 2)]),
    };
  }
  // A revolve: the profile itself sits on its start plane; ahead is a little
  // way round, and half way round.
  const solid = insideFeature(model, f);
  const offs = inside.flatMap((p) => [-eps, eps].map((h) => world(p, h)));
  return { behind: offs.filter((q) => !solid(q)), ahead: offs.filter((q) => solid(q)) };
}

/** A world point strictly inside a feature's profile, on its sketch plane — null for a profile with no inside. */
export function interiorPoint(model: Model, f: FeatureEntry): number[] | null {
  const { at, profile } = kernelSweep(model, f);
  const pts = profile.loops.flat().flatMap((m) => memberPoints(m, 16));
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (const N of [3, 9, 27]) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p: V2 = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
        if (insideProfile(profile, p)) return [0, 1, 2].map((k) => at.origin[k] + p[0] * at.x[k] + p[1] * at.y[k]);
      }
    }
  }
  return null;
}

export interface ModeChoice {
  mode: FeatureMode;
  /** The body's first feature, for anything but new. */
  into?: string;
  /** Whether the feature's solid runs into the body's material — where a dialog offers Cut. */
  into_material?: boolean;
}

/**
 * The mode a feature gets when its call names none: **add** to the first body
 * its solid touches or overlaps, else **new**. `into_material` says whether it
 * runs into that body's material, rather than out from a face — what makes a
 * dialog offer Cut. `f` is the feature as just made; it is left out of the
 * bodies it is tested against.
 */
export function defaultMode(model: Model, f: FeatureEntry): ModeChoice {
  let pr: ReturnType<typeof probes>;
  try {
    pr = probes(model, f);
  } catch {
    return { mode: "new" };
  }
  // Each body as it stood before `f`: the features made before it, so asking
  // again of a feature already made (the dialog does) is asking what it was
  // made onto, not what it made.
  const order = [...model.features.keys()];
  const before = (g: FeatureEntry) => order.indexOf(g.name) < order.indexOf(f.name);
  for (const whole of chainsOf(model).bodies) {
    const chain = { ...whole, features: whole.features.filter(before) };
    if (!chain.features.length || !before(whole.features[0])) continue;
    const inside = insideBody(model, chain);
    const ahead = pr.ahead.some(inside);
    if (ahead || pr.behind.some(inside)) return { mode: "add", into: chain.name, into_material: ahead };
  }
  return { mode: "new" };
}

/**
 * Checks a mode a call was given, and resolves its body: `into` named, or else
 * the body the feature touches. Throws, in words, for a mode that is none, a
 * body that is not one, and a cut or intersect with nothing to act on.
 */
export function resolveMode(model: Model, f: FeatureEntry, mode: FeatureMode, into: string | undefined, op: string): ModeChoice {
  if (mode === "new") {
    if (into !== undefined) throw new Error(`${op}'s mode "new" makes a body of its own — it has no "into"`);
    return { mode };
  }
  if (into !== undefined) {
    if (into === f.name || !model.features.has(into)) {
      throw new Error(`${op} ${mode === "cut" ? "cuts" : mode === "add" ? "adds to" : "intersects"} a body — "${into}" is not a feature of one`);
    }
    const body = bodyNameOf(model, into);
    if (body === null) throw new Error(`"${into}" is in no body — it was left out of its own`);
    return { mode, into: body };
  }
  const found = defaultMode(model, f);
  if (found.mode === "new") {
    if (mode === "add") return { mode: "new" };
    throw new Error(`${op} ${mode === "cut" ? "cuts from" : "intersects"} a body, and this one touches none — say which with { mode: "${mode}", into: "e1" }`);
  }
  return { mode, into: found.into };
}

// ---- which way is into the material -----------------------------------------

/** Where along a sweep a cut's probes stand, as fractions of its reach: just off the sketch, and on through it. */
const PROBE_ALONG = [0.02, 0.25, 0.5, 0.75, 0.98];

/**
 * Which way a cut of a profile goes **into the material** — the Cut tool's
 * default direction (docs/plans/solid-tools-intuitive.md, vetoable): `+1`
 * along the plane's normal `n`, `-1` against it, whichever has more of every
 * body's material along it, `reach` deep (interior points of the profile, a
 * grid as `probes` lays one, each walked along both ways). A profile on a
 * lid cuts down into its body, one on the ground under a body up into it,
 * with no minus sign to know about. `reaches` is false when neither way meets
 * any material — a profile beside every body — and the way is then `+1`, the
 * typed call's own default. Even, both ways inside material (a sketch plane
 * through the middle of a body): `-1`, away from the viewer when the plane
 * faces them, as a sketch on a face does.
 *
 * `loops` are the profile as a feature would take it, in `plane`; a profile
 * that cannot be laid out (a crossing not yet a point) is probed from `at`,
 * the point the click landed on, alone.
 */
export function materialWay(model: Model, plane: { u: number[]; n: number[] }, loops: readonly (readonly ProfileMember[])[],
                            at: number[], reach: number): { way: 1 | -1; reaches: boolean } {
  const bodies = chainsOf(model).bodies.map((c) => insideBody(model, c));
  const n = unit3(plane.n);
  if (!bodies.length || !n || !(reach > 0)) return { way: 1, reaches: false };
  let starts: number[][] = [];
  try {
    const { at: placed, profile } = kernelProfile(model, plane, loops);
    const pts = profile.loops.flat().flatMap((m) => memberPoints(m, 16));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const N = 7;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p: V2 = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
        if (insideProfile(profile, p)) starts.push([0, 1, 2].map((k) => placed.origin[k] + p[0] * placed.x[k] + p[1] * placed.y[k]));
      }
    }
  } catch {
    starts = [];
  }
  if (!starts.length) starts = [at];
  const along = (s: number) => {
    let hits = 0;
    for (const p of starts) {
      for (const t of PROBE_ALONG) {
        const q = p.map((c, k) => c + s * t * reach * n[k]);
        if (bodies.some((inside) => inside(q))) hits++;
      }
    }
    return hits;
  };
  const [up, down] = [along(1), along(-1)];
  if (up === 0 && down === 0) return { way: 1, reaches: false };
  return { way: up > down ? 1 : -1, reaches: true };
}

/** A unit direction, for callers that want the sweep's way without the rest. */
export function sweepDirection(model: Model, f: FeatureEntry): number[] | null {
  const { at } = kernelSweep(model, f);
  return unit3(cross3(at.x, at.y));
}
