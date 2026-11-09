// The one relation an extrude is held by: every twin is its base moved by
// **one chord** — the edge extrude of every edge of the profile, sharing it —
// and the chord as long as the depth.
//
// It is a **dimension** — `d`-named, with a `.value` — because the depth is
// the one number a solid has that a user goes back and edits:
// `set("d9.value", 40)` re-runs this with the new depth, in place, under the
// same name (see `set` in operations.ts, and its REBUILD line). It is **one**
// relation with a block per pair rather than a relation per pair for the same
// reason: one depth, one name, one thing to set. Twenty `dist`s would be
// twenty numbers that ought always to agree and could be edited apart.
//
// Nothing calls this but the expansion inside `extrude`, `edgeExtrude` (and
// `set`, re-running it), so it is not on the command surface and never
// journals itself: the operation is the journal entry, and replaying it calls
// this again. A bare extrusion with no feature around it would be a `d` with
// nothing to draw.
//
// **The edge extrude is the primitive** (docs/plans/profiles-held.md, the
// owner: *"Edge extrude is a fundamental feature."*). An edge E and a chord c
// give its copy E′ = E + c: every point of the edge moved by the chord, and
// every size of it — a radius, a minor — the same, and every normal the same,
// a translation turning nothing. The end chords, base to twin, are walls; the
// surface between E and E′ is derived (drawn and built, never stored). A
// profile extrude is the edge extrude of every edge of the profile **sharing
// one chord**. Nothing here reads a direction: until 2026-11-08 the twins sat
// at base + depth along the sketch frame's +z, a datum, so a drag on a lid
// corner tilted the base while every wall kept the frame's z — a skewed prism,
// SOLVED. Which way the chord points is the user's to say, by an ordinary
// relation the operation makes and anyone can delete: `perp(chord, profile)`,
// square to the profile, or an `ang` for a drafted or oblique extrude.

import type { Model } from "../model.ts";
import type { Dual } from "../kernel/dual.ts";
import { curveNormal, joinVars, unitDuals } from "./refs.ts";
import { ORIGIN, lidReach } from "../model.ts";
import { norm, vecSub } from "./vec.ts";

/** Kinds a twin may be of, given its base's: the same, or (a whole circle's part) an arc for a circle. */
function sameFamily(a: string, b: string): boolean {
  const round = (k: string) => k === "circle" || k === "arc";
  return a === b || (round(a) && round(b));
}

/**
 * The pair whose twin minus base **is** the chord: the first pair of two
 * points whose base is no datum. Exported for whatever reads the chord — the
 * plane a solid is laid out in (curveplane.ts), the profile's perpendicular.
 */
export function chordPair(model: Model, frame: string, pairs: readonly string[]): { base: string; twin: string } | null {
  const datum = datumOf(model, frame);
  for (let i = 0; i < pairs.length; i += 2) {
    const [b, t] = [pairs[i], pairs[i + 1]];
    if (model.entities.get(b)?.kind === "point" && model.entities.get(t)?.kind === "point" && !datum.has(b)) return { base: b, twin: t };
  }
  return null;
}

/** A frame's own points: read as numbers, never pushed (`frameBasis`). An old file's lid frame stands over them. */
function datumOf(model: Model, frame: string): Set<string> {
  const kind = model.planeKind(frame);
  return new Set(kind === "frame" && frame !== ORIGIN ? model.refsOf(model.frame(frame)) : []);
}

/**
 * The chord of an extrusion as it stands — twin minus base of its chord pair —
 * or null for one that has none. What the depth's sign makes the direction
 * the lid stands along: `chord / reach`.
 */
export function extrusionChord(model: Model, relation: string): number[] | null {
  const r = model.relations.get(relation);
  if (!r || r.op !== "extrusion") return null;
  const pair = chordPair(model, r.args[0] as string, r.args.slice(2) as string[]);
  if (!pair) return null;
  const [b, t] = [model.coords(pair.base), model.coords(pair.twin)];
  return t.map((c, i) => c - b[i]);
}

/**
 * Holds each `twin` at its `base` plus the one chord, and the chord as long as
 * the lid stands off its sketch.
 *
 * `pairs` is flat — `base₁, twin₁, base₂, twin₂, …` — and every name sits at
 * the top level of the recorded arguments for a reason that is not tidiness:
 * `del`'s reference scan and the primitives' refusals read a relation's
 * arguments name by name (`relationsNaming`), so a twin buried in a nested
 * array could be deleted out from under the block still reading it. A pair is
 * two points, or two curves of one family:
 *
 * - **The chord pair** (the first pair of points, `chordPair`): one residual,
 *   `|t₀ − b₀| − |reach|` — a length, not its square, so its gradient is the
 *   chord's own direction all the way down. Its **sign** is where the twins
 *   are: seeded on the depth's side by the operation, and moved across by
 *   `set` when the depth's sign changes (operations.ts), so the side is the
 *   geometry's and no direction is read to keep it.
 * - **Every other pair of points**: three residuals, `(t − b) − (t₀ − b₀)` —
 *   moved as the chord's twin is. Linear, nothing squared, both ways: a drag
 *   on any twin pulls its base and the chord, a drag on any base the rest.
 * - **Two curves**: their sizes equal (`Model.sizesOf`: a circle's radius, an
 *   ellipse's minor, whatever a module's kind declares), and their normals
 *   equal, sign and all, since an arc's sign says which way round it goes.
 *   Their points are pairs of their own. Any kind with its sizes declared
 *   extrudes so; a spline, which is all points, needs nothing more.
 *
 * **A frame's own points are a datum**, read as numbers and never pushed, as
 * every relation written against a frame reads them (`frameBasis`): an old
 * file's lid-frame pairs, whose bases are its sketch frame's origin and refs,
 * so that lid frame follows the sketch frame and can never drag it. The frame
 * argument is otherwise only the plane the extrude was made on — the side
 * +depth was seeded, and what an old file named — and holds nothing.
 *
 * **The lid stands where the extrude's end condition says** (`lidReach`): at
 * the depth for a blind extrude, at half of it for a symmetric one, and past
 * everything made before it for a through-all one — read at every evaluation,
 * by the relation's own name, so a lid through all follows the body it goes
 * through.
 *
 * 3D only: in 2D there is no direction out of the plane to offset along.
 * Refuses a depth of zero (a lid on its base is no solid) and anything not a
 * finite number — and because `set` rebuilds through here, a refused value
 * leaves the old depth exactly as it was.
 */
export function extrusion(model: Model, frame: string, depth: number, ...pairs: string[]): string {
  if (model.dim !== 3) throw new Error("an extrusion needs a 3D model — in 2D there is no direction out of the plane");
  if (typeof depth !== "number" || !Number.isFinite(depth) || depth === 0) {
    throw new Error(`an extrusion needs a non-zero depth, got ${JSON.stringify(depth)}`);
  }
  if (pairs.length === 0 || pairs.length % 2 !== 0) throw new Error("an extrusion takes base/twin pairs");
  model.planeKind(frame); // fail now, not at the first solve
  for (let i = 0; i < pairs.length; i += 2) {
    const be = model.entities.get(pairs[i]), te = model.entities.get(pairs[i + 1]);
    const points = be?.kind === "point" && te?.kind === "point";
    const curves = be && te && be.kind !== "point" && be.kind !== "line" && be.kind !== "frame" && sameFamily(be.kind, te.kind);
    if (!points && !curves) {
      throw new Error(`"${pairs[i]}" and "${pairs[i + 1]}" are not a pair an extrusion can hold — two points, or two curves of one kind`);
    }
  }
  const chord = chordPair(model, frame, pairs);
  if (!chord) throw new Error("an extrusion needs a pair of points that is no frame's to be its chord");
  // The relation's own name, known once it is made: what the end condition is read by.
  let self = "";
  const reach = () => lidReach(model, self, depth);
  self = model.relation("extrusion", [frame, depth, ...pairs], () => {
    const datum = datumOf(model, frame);
    const c0 = [...model.point(chord.base).varIndices, ...model.point(chord.twin).varIndices];
    model.addResidual(c0, (l) => [norm(vecSub(l.slice(3, 6), l.slice(0, 3))).sub(Math.abs(reach()))], `extrusion(${chord.base},${chord.twin})`);
    /** The chord as Duals, from its pair's six locals at `at`. */
    const chordAt = (l: Dual[], at: number) => vecSub(l.slice(at + 3, at + 6), l.slice(at, at + 3));
    for (let i = 0; i < pairs.length; i += 2) {
      const [b, t] = [pairs[i], pairs[i + 1]];
      if (b === chord.base && t === chord.twin) continue;
      const be = model.entities.get(b), te = model.entities.get(t);
      if (be?.kind === "point" && te?.kind === "point") {
        const tv = te.varIndices;
        if (datum.has(b)) {
          model.addResidual([...c0, ...tv], (l) => {
            const c = chordAt(l, 0);
            const at = model.coords(b);
            return [0, 1, 2].map((k) => l[6 + k].sub(at[k]).sub(c[k]));
          }, `extrusion(${b},${t})`);
        } else {
          model.addResidual([...c0, ...be.varIndices, ...tv], (l) => {
            const c = chordAt(l, 0);
            return [0, 1, 2].map((k) => l[9 + k].sub(l[6 + k]).sub(c[k]));
          }, `extrusion(${b},${t})`);
        }
      } else if (be && te && be.kind !== "point" && be.kind !== "line" && be.kind !== "frame" && sameFamily(be.kind, te.kind)) {
        // An edge's twin is the same edge moved: every size the same…
        const [bs, ts] = [model.sizesOf(be), model.sizesOf(te)];
        bs.forEach((v, k) => {
          if (ts[k] === undefined) return;
          model.addResidual([v, ts[k]], (l) => [l[1].sub(l[0])], `extrusion(${b},${t}).${k === 0 ? "r" : `s${k}`}`);
        });
        // …and every normal: a translation turns nothing. Both declared: they
        // are both geometry, and the base is held where it is by relations of
        // its own.
        const [bn, tn] = [curveNormalOf(model, b), curveNormalOf(model, t)];
        if (bn && tn) {
          model.addResidual(joinVars(bn, tn), (l) => {
            const [u, w] = [unitDuals(l.slice(0, 3)), unitDuals(l.slice(3))];
            return [0, 1, 2].map((k) => w[k].sub(u[k]));
          }, `extrusion(${b},${t}).n`);
        }
      } else {
        throw new Error(`"${b}" and "${t}" are not a pair an extrusion can hold — two points, or two curves of one kind`);
      }
    }
  });
  return self;
}

/** A curve's normal's variables, or null for one with none (a spline, a 2D curve). */
function curveNormalOf(model: Model, name: string): (() => number[]) | null {
  try {
    const n = curveNormal(model, name);
    return n && model.oriented(name).normal !== undefined ? n : null;
  } catch {
    return null;
  }
}
