// The far side of what an extrude goes through, and where a face stands
// ahead of it (docs/plans/through-all-relation.md). **Asked once, by an
// operation** — `extrude` and `setEnd` when an end is set, `regen` when a
// body is restructured, the organiser when it says an end stops short — and
// never inside a solve: what holds a through-all lid is a relation between
// entities (`onplane("p7", "e2.lid")`), and this file only says *which*
// entity. The owner: *"correct relationships BETWEEN entities … bidirectional
// relationships everywhere by default."*
//
// Until 2026-11-12 the same measuring lived in solids.ts as `throughReach`,
// registered with the model through a hook and read as a constant inside the
// `extrusion` relation's residual at every evaluation.
//
// At the operations' height: it reads solids (solids.ts, modes.ts), which
// nothing in `relations/` or model.ts may.

import { memberName, type ExtrudeFeature, type FeatureEntry, type Model, type ProfileMember } from "./model.ts";
import { featureBuilds, insideFeature, modeOf } from "./modes.ts";
import { kernelSweep } from "./solids.ts";
import { faceRef, faceSource, planeNow } from "./relations/solidref.ts";
import { extrusionChord } from "./relations/extrusion.ts";
import { insideProfile, memberPoints } from "./solids/profile.ts";
import type { V2 } from "./solids/kernel.ts";
import { cross3, dot3, sub3, unit3 } from "./vec3.ts";

/**
 * What stands farthest along an extrude's way, of the bodies its swept
 * profile meets:
 *
 * - **point** — a vertex of one of them: the entity a through-all lid is held
 *   on. `off` is how far it is from the sketch along the way.
 * - **placed** — something stands farther than any vertex does: a revolve's
 *   side, a cylinder lying across. Nothing in the model is that far side, so
 *   nothing can be held to it; `off` is the measure, sampled off the sweep.
 * - **none** — the swept profile meets no body that way.
 */
export type FarSide =
  | { kind: "point"; point: string; feature: string; off: number }
  | { kind: "placed"; feature: string; off: number }
  | { kind: "none" };

/** A feature's sketch plane as a walk along its way needs it: where it is, its axes, and the unit way the lid stands. */
interface Way {
  origin: number[];
  x: number[];
  y: number[];
  way: number[];
  /** Interior points of the profile, on the sketch plane, in world coordinates. */
  starts: number[][];
  size: number;
}

/** `f`'s way, and (unless `walks` is false) where to walk from — null for a feature that cannot be laid out. */
function wayOf(model: Model, f: ExtrudeFeature, walks = true): Way | null {
  let sw: ReturnType<typeof kernelSweep>;
  try {
    sw = kernelSweep(model, f);
  } catch {
    return null;
  }
  if (sw.sweep.kind !== "extrude") return null;
  const z = unit3(cross3(sw.at.x, sw.at.y));
  if (!z) return null;
  const way = z.map((c) => Math.sign((sw.sweep as { depth: number }).depth) * c);
  const pts = sw.profile.loops.flat().flatMap((m) => memberPoints(m, 16));
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const world = (p: V2) => [0, 1, 2].map((i) => sw.at.origin[i] + p[0] * sw.at.x[i] + p[1] * sw.at.y[i]);
  // A grid over the profile's extent, kept where the profile is — as the
  // default mode's probes are laid (modes.ts) — finer where a coarse one
  // finds no inside (a thin profile).
  let starts: number[][] = [];
  for (const N of walks ? [9, 27] : []) {
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        const p: V2 = [x0 + ((i + 0.5) / N) * (x1 - x0), y0 + ((j + 0.5) / N) * (y1 - y0)];
        if (insideProfile(sw.profile, p)) starts.push(world(p));
      }
    }
    if (starts.length) break;
  }
  if (!starts.length && walks) starts = pts.map(world);
  // A symmetric extrude's placement starts behind its sketch; a through one's does not.
  return { origin: sw.at.origin, x: sw.at.x, y: sw.at.y, way, starts, size: Math.max(x1 - x0, y1 - y0, 1e-9) };
}

/** How many places along a walk a body is asked for: enough that a body a twentieth as deep as it is far is not stepped over. */
const WALK = 24;

/** How far `g`'s solid reaches along `w.way`, sampled off its own sweep: the least and the most, or null where it cannot be laid out. */
function extentAlong(model: Model, g: FeatureEntry, off: (p: number[]) => number, way: number[]): [number, number] | null {
  let sw: ReturnType<typeof kernelSweep>;
  try {
    sw = kernelSweep(model, g);
  } catch {
    return null; // a feature that cannot be laid out stands nowhere
  }
  const z = cross3(sw.at.x, sw.at.y);
  const world = (q: number[], h = 0) => [0, 1, 2].map((i) => sw.at.origin[i] + q[0] * sw.at.x[i] + q[1] * sw.at.y[i] + h * z[i]);
  const pts = sw.profile.loops.flat().flatMap((m) => memberPoints(m, 16));
  let lo = Infinity, hi = -Infinity;
  const take = (a: number, b = a) => { lo = Math.min(lo, a, b); hi = Math.max(hi, a, b); };
  if (sw.sweep.kind === "extrude") {
    for (const q of pts) take(off(world(q)), off(world(q, sw.sweep.depth)));
  } else {
    // A revolve: each profile point turns through a circle about the axis,
    // which stands as far along the way as its centre's foot does, give or
    // take its radius times how square the axis is to the way.
    const O = world(sw.sweep.point);
    const k = unit3(sub3(world([sw.sweep.point[0] + sw.sweep.dir[0], sw.sweep.point[1] + sw.sweep.dir[1]]), O));
    if (!k) return null;
    const across = Math.sqrt(Math.max(0, 1 - dot3(k, way) ** 2));
    for (const q of pts) {
      const p = world(q);
      const c = O.map((x, i) => x + dot3(sub3(p, O), k) * k[i]);
      const r = Math.hypot(...sub3(p, c)) * across;
      take(off(c) - r, off(c) + r);
    }
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** The points of a profile member — its ends as corners, a round one's centre as a centre. */
function memberVertices(model: Model, m: ProfileMember): { point: string; corner: boolean }[] {
  const e = model.entities.get(memberName(m));
  if (!e) return [];
  const pt = (p: string, corner: boolean) => (model.entities.get(p)?.kind === "point" ? [{ point: p, corner }] : []);
  if (typeof m !== "string") {
    const centre = e.kind === "arc" || e.kind === "circle" ? pt(e.center, false) : [];
    return [...pt(m.from, true), ...pt(m.to, true), ...centre];
  }
  if (e.kind === "line") return e.refs.flatMap((p) => pt(p, true));
  if (e.kind === "arc") return [...pt(e.start, true), ...pt(e.end, true), ...pt(e.center, false)];
  if (e.kind === "circle") return pt(e.center, false);
  return model.refsOf(e).flatMap((p) => pt(p, false));
}

/** Every point of a feature's two profiles: the entities its solid's vertices are. */
function verticesOf(model: Model, g: FeatureEntry): { point: string; corner: boolean }[] {
  const out = new Map<string, boolean>();
  const add = (v: { point: string; corner: boolean }) => out.set(v.point, (out.get(v.point) ?? false) || v.corner);
  for (const m of g.loops.flat()) for (const v of memberVertices(model, m)) add(v);
  for (const t of g.twins.flat()) for (const v of memberVertices(model, t)) add(v);
  return [...out].map(([point, corner]) => ({ point, corner }));
}

/** `p10` after `p9`, as a person reads names — the order ties are broken in, so a choice is the same wherever it is made. */
const byName = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/** The tolerance two heights along a way are one height to: a millionth of the larger of the reach and the profile. */
const same = (far: number, size: number) => 1e-6 * Math.max(1, Math.abs(far), size);

/**
 * **The far side of what `f` goes through.** The profile's interior is walked
 * along the way the lid stands; a feature is *met* when a walk passes inside
 * its own solid ahead of the sketch. **Not what was made first**: every
 * feature the swept profile meets, whenever it was made (the owner:
 * *"hierarchies do exist, but they are not timeline based"*). **Not a cut**:
 * a hole is nothing to go through — reading one as a solid is what made a
 * second through cut stand a tenth past the first one's tool. Nor a feature
 * that builds no body (open, unbuilt).
 *
 * Of the met features' vertices — the points of both their profiles — the
 * farthest along the way is the answer, **when nothing of a met solid stands
 * farther** (sampled off each sweep, `extentAlong`). However a flat-faced body
 * stands, its farthest reach is at a vertex, so for those there always is
 * one; where the far face is parallel to the sketch every vertex of it is as
 * far as the next, and the choice among them is by rule — a corner before a
 * centre, then the lower name — so it is the same wherever it is made.
 * `prefer` is kept when it is among the farthest: an end already held is not
 * re-pointed to an equal.
 */
export function farSide(model: Model, f: ExtrudeFeature, prefer?: string | null): FarSide {
  const w = wayOf(model, f);
  if (!w) return { kind: "none" };
  return farOf(model, w, metBy(model, f, w), prefer);
}

/**
 * The features `f`'s swept profile meets, by name, in the order they were
 * made: the walk, which is the dear half of the question (an insideness test
 * at every step of every walk).
 */
function metBy(model: Model, f: ExtrudeFeature, w: Way): string[] {
  const off = (p: number[]) => dot3(sub3(p, w.origin), w.way);
  const out: string[] = [];
  for (const g of model.features.values()) {
    if (g.name === f.name || featureBuilds(g) !== null || modeOf(g) === "cut") continue;
    const span = extentAlong(model, g, off, w.way);
    if (!span) continue;
    if (!(span[1] > same(span[1], w.size))) continue; // wholly behind the sketch
    let inside: (p: number[]) => boolean;
    try {
      inside = insideFeature(model, g);
    } catch {
      continue;
    }
    const [a, b] = [Math.max(span[0], 0), span[1]];
    let met = false;
    for (let k = 0; k < WALK && !met; k++) {
      const t = a + ((k + 0.5) / WALK) * (b - a);
      met = w.starts.some((s) => inside(s.map((c, i) => c + t * w.way[i])));
    }
    if (met) out.push(g.name);
  }
  return out;
}

/** The far side of the features named, along `w` — the cheap half: each one's reach and its vertices, measured. */
function farOf(model: Model, w: Pick<Way, "origin" | "way" | "size">, met: readonly string[], prefer?: string | null): FarSide {
  const off = (p: number[]) => dot3(sub3(p, w.origin), w.way);
  let far = -Infinity, farOf = "";
  const candidates: { point: string; corner: boolean; off: number; feature: string }[] = [];
  for (const name of met) {
    const g = model.features.get(name);
    if (!g) continue;
    const span = extentAlong(model, g, off, w.way);
    if (!span) continue;
    if (span[1] > far) { far = span[1]; farOf = g.name; }
    for (const v of verticesOf(model, g)) candidates.push({ ...v, off: off(model.coords(v.point)), feature: g.name });
  }
  if (!(far > 0)) return { kind: "none" };
  const tol = same(far, w.size);
  // A centre can stand outside its own solid (a concave arc's): nothing past the solid is a vertex of it.
  const on = candidates.filter((c) => c.off <= far + tol && c.off >= far - tol);
  if (!on.length) return { kind: "placed", feature: farOf, off: far };
  const kept = prefer != null ? on.find((c) => c.point === prefer) : undefined;
  const best = kept ?? on.sort((p, q) => Number(q.corner) - Number(p.corner) || byName(p.point, q.point))[0];
  return { kind: "point", point: best.point, feature: best.feature, off: best.off };
}

/** How far an extrude's lid stands from its sketch now, along its way: its chord's length. */
export function lidOff(model: Model, f: ExtrudeFeature): number {
  const chord = extrusionChord(model, f.depth);
  return chord ? Math.hypot(...chord) : 0;
}

/**
 * Whether a through-all extrude **no longer goes through**: something it
 * meets stands farther than its lid does — a slanted far side turned until
 * another corner is the far one, a body added beyond. Null when it still
 * does (or is no through extrude). What the organiser's row says, with the
 * one tap that chooses the far point again (`setEnd("e2", "through")`); the
 * relation is never re-pointed inside a solve.
 *
 * **Asked after every redraw** (the organiser's rows are), so the dear half
 * — which features the swept profile meets — is kept between askings: found
 * again when the journal has grown (an edit) or half a second has passed (a
 * drag carrying a body into or out of the cut's way), and otherwise only
 * measured, which is a dot product a vertex. A turn that leaves another
 * corner farther is therefore said on the frame it happens.
 */
export function stopsShort(model: Model, f: ExtrudeFeature, held: string | null): { past: string | null; by: number } | null {
  if (f.extent !== "through") return null;
  const w = wayOf(model, f, false);
  if (!w) return null;
  let cache = metCache.get(model);
  if (!cache) metCache.set(model, cache = new Map());
  let met = cache.get(f.name);
  const now = Date.now();
  if (!met || met.journal !== model.journal.length || now - met.at > MET_KEPT_MS) {
    const whole = wayOf(model, f);
    if (!whole) return null;
    met = { journal: model.journal.length, at: now, names: metBy(model, f, whole) };
    cache.set(f.name, met);
  }
  const far = farOf(model, w, met.names, held);
  if (far.kind === "none") return null;
  const by = far.off - lidOff(model, f);
  if (!(by > 1e-6 * Math.max(1, far.off))) return null;
  return { past: far.kind === "point" ? far.point : null, by };
}

const MET_KEPT_MS = 500;
const metCache = new WeakMap<Model, Map<string, { journal: number; at: number; names: string[] }>>();

/**
 * Where a face stands ahead of an extrude, for **up to face**:
 *
 * - **held** — a flat face the model has a source for (a cap, a line's
 *   wall), parallel to the sketch: `off` is how far along the way it is,
 *   negative when it is behind the sketch.
 * - **placed** — a round wall, where the profile's middle walked along the
 *   way meets its cylinder; or a face only the kernel knows, at the point
 *   `at` it was picked at.
 *
 * Throws, in words, for a face not parallel to the sketch (a lid on it would
 * not be this profile moved, and the kernel sweeps square), one of the
 * extrude's own, and one nothing says the place of.
 */
export function faceAhead(model: Model, f: ExtrudeFeature, given: string, at?: readonly number[] | null):
  { kind: "held" | "placed"; face: string; off: number } {
  const face = faceRef(model, given);
  const w = wayOf(model, f);
  if (!w) throw new Error(`${f.name} cannot be laid out — its profile's plane has collapsed`);
  const off = (p: readonly number[]) => dot3(sub3([...p], w.origin), w.way);
  const s = faceSource(model, face);
  if (s && s.feature.name === f.name) throw new Error(`"${face}" is ${f.name}'s own face — up to a face means a face of something else`);
  if (s && (s.kind === "cap" || s.shape === "plane")) {
    const plane = planeNow(model, face);
    if (!plane) throw new Error(`"${face}" has no plane to read`);
    const lean = Math.hypot(...cross3(plane.n, w.way));
    if (lean > 1e-6) {
      throw new Error(`"${face}" is not parallel to ${f.name}'s profile — a lid on it would not be this profile moved, and the kernel sweeps square (TODO.md: up to a slanted face)`);
    }
    return { kind: "held", face, off: off(plane.p) };
  }
  if (at != null && at.length === 3 && at.every((c) => typeof c === "number" && Number.isFinite(c))) return { kind: "placed", face, off: off(at) };
  if (s && s.kind === "wall" && s.shape === "cylinder" && s.feature.kind === "extrude") {
    // The cylinder a round wall is: its entity's centre, along its extrude's chord, its radius.
    const e = model.entities.get(s.entity);
    const axis = unit3(extrusionChord(model, s.feature.depth) ?? []);
    if (e && (e.kind === "circle" || e.kind === "arc") && axis) {
      const c = model.coords(e.center), r = model.radius(s.entity);
      const from = w.starts[Math.floor(w.starts.length / 2)];
      // |(from + t·way − c) × axis| = r, in t.
      const d = cross3(w.way, axis), o = cross3(sub3(from, c), axis);
      const [A, B, C] = [dot3(d, d), 2 * dot3(d, o), dot3(o, o) - r * r];
      const disc = B * B - 4 * A * C;
      if (A > 1e-12 && disc >= 0) {
        const roots = [(-B - Math.sqrt(disc)) / (2 * A), (-B + Math.sqrt(disc)) / (2 * A)];
        const ahead = roots.filter((t) => t > 1e-9);
        return { kind: "placed", face, off: ahead.length ? Math.min(...ahead) : Math.max(...roots) };
      }
    }
    throw new Error(`"${face}" is round and ${f.name} does not run into it — nothing says where it would end`);
  }
  throw new Error(`"${face}" is ${s ? "not flat" : "a face only the solid kernel knows"} — nothing in the model says where it is; pick it with the tool, or give the point: setEnd("${f.name}", "upto", "${face}", [x, y, z])`);
}
