// Giving the circles and arcs of a file written before format version 7 the
// plane every 3D circle and arc now carries — persist.ts's one translation
// that has to *decide* something rather than only respell it.
//
// Before version 7 a circle was a centre and a radius (a sphere, in 3D) and an
// arc three points whose counter-clockwise side was the kernel's +z (then +y,
// then +x). Version 7 gives both a plane, a frame reference (see
// `CircleEntity`), and puts it before the name: `addCircle(c, r, plane, name)`,
// `addArc(c, s, e, r, plane, name)`, and a 3D `fillet(l1, l2, r, plane)`. In a
// 2D model the plane is null and that is the whole translation. In 3D — a
// version-6 file, or any 2D file lifted into the app — the plane is chosen by
// **the rule**:
//
//   * A **frame is a candidate** for a curve if it exists at the curve's step
//     of the journal and the file never deletes it (a version-6 file could
//     delete a frame a circle now stands on, and the deletion would be refused
//     at its step), and it has not collapsed.
//   * An **arc** takes the candidate whose +z is **nearest its own normal** —
//     the normal of the plane through its centre and ends, read from the
//     file's *saved* coordinates once they are restored, since the replay's
//     seeds can be anywhere (a three-point arc's centre is seeded at the
//     origin and only moved by a later step). Nearest in the sense of parallel
//     to within a millionth (`IN_PLANE_SINE`, `fillet`'s own test): ties go to
//     the default frame at that step, then to the earliest. Its endpoints are
//     then swapped if the version-6 rule and the chosen frame's +z disagree
//     about which way round it went, so it opens as the arc that was drawn.
//   * A **fillet** is an arc whose plane is the corner's, read at its step from
//     the legs as the replay has them — the geometry the fillet's own
//     expansion is about to read.
//   * A **circle** has no normal of its own to match, so it takes the default
//     frame at its step, else a candidate whose plane its centre lies on, else
//     the earliest candidate.
//   * When **no candidate fits** — a file with no frame at all, which a 2D
//     drawing may well be, or an arc in a plane no frame shares — the
//     translation makes one: a frame named `plane` (or `plane2`, …; never a
//     name the file uses), its points `plane_o`, `plane_x`, `plane_y`, lying in
//     the curve's plane (the kernel's x–y plane for a circle, which has nothing
//     better to say, and which is where every 2D drawing lived), with its
//     origin on the curve's centre. It goes into the journal just before the
//     curve, re-saves with it, and is an ordinary frame from then on: visible,
//     draggable, deletable (taking its curves, as any frame does).
//
// Every choice is about *orientation* only. A plane never pins a centre (see
// `CircleEntity`), so no translated curve moves on open — with one honest
// exception, an arc whose `arcends` held its ends somewhere off the plane the
// rule gives it, which cannot happen to a drawing made by the tools.
//
// A known gap, left in place: a version-6 *free* arc whose endpoints were
// auto-created (`arc()` typed bare) cannot have them swapped — the file names
// no endpoints to swap — so if its frame's +z faces the kernel's −z it opens
// as its complement. Only a typed bare `arc()` in a 3D drawing, on a frame
// turned upside down, and only for files from before this version.

import { Model, type JournalEntry } from "./model.ts";
import { arcNormal } from "./arcgeom.ts";
import { framePlaneAxes } from "./curveplane.ts";
import { IN_PLANE_SINE } from "./operations.ts";
import { cross3, dot3, lift3, sub3, unit3 } from "./vec3.ts";
import { liesOn } from "./view.ts";

/** Names already in use, and the first free variant of a base name. */
export function freshName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let k = 2; ; k++) if (!taken.has(`${base}${k}`)) return `${base}${k}`;
}

/**
 * The normal version 6 drew an arc about: the plane through its centre and
 * ends, on the kernel's +z side (then +y, then +x); a half-turn took the plane
 * through its diameter leaning most toward +z. **Retired everywhere else** —
 * kept here, and only here, so that a file drawn under it opens as the arcs it
 * showed.
 */
function v6ArcNormal(c: number[], s: number[], e: number[]): number[] | null {
  const [C, S, E] = [lift3(c), lift3(s), lift3(e)];
  const a = sub3(S, C), b = sub3(E, C);
  const la = Math.hypot(...a), lb = Math.hypot(...b);
  if (!(la > 1e-12) || !(lb > 1e-12)) return null;
  const raw = cross3(a, b);
  let n = Math.hypot(...raw) > 1e-12 * la * lb ? unit3(raw) : null;
  if (!n) {
    const u = unit3(a)!;
    for (const k of [[0, 0, 1], [0, 1, 0], [1, 0, 0]]) {
      const along = dot3(k, u);
      n = unit3([k[0] - along * u[0], k[1] - along * u[1], k[2] - along * u[2]]);
      if (n) break;
    }
  }
  if (!n) return null;
  for (const k of [2, 1, 0]) {
    if (n[k] > 1e-9) return n;
    if (n[k] < -1e-9) return n.map((x) => (x === 0 ? 0 : -x));
  }
  return n;
}

/** Whether two unit normals are parallel (either way round) to `IN_PLANE_SINE`. */
function parallel(n: number[], m: number[]): boolean {
  return Math.hypot(...cross3(n, m)) <= IN_PLANE_SINE;
}

/** Two unit directions spanning the plane normal to `n`, right-handed about it, the first as near the kernel's x as it can be. */
function spanOf(n: number[]): [number[], number[]] {
  for (const k of [[1, 0, 0], [0, 1, 0]]) {
    const along = dot3(k, n);
    const u = unit3([k[0] - along * n[0], k[1] - along * n[1], k[2] - along * n[2]]);
    if (u) return [u, cross3(n, u)];
  }
  return [[1, 0, 0], [0, 1, 0]];
}

/** What the translation made a frame for, so it can be put where its curve is once the saved values are back. */
interface Made {
  frame: string;
  points: [string, string, string];
  /** The circle or arc whose centre the frame's origin goes on. */
  owner: string | null;
  u: number[];
  v: number[];
}

/**
 * The plane translation for one file. `give` rewrites one replayed step (and
 * may put a new frame's entries in front of it); `settle` runs once the saved
 * coordinates are back, to choose arcs' planes from them and put the frames it
 * made where their curves are.
 *
 * Active for files from before version 7 — and for a **2D file of any version
 * lifted into 3D**, whose circles never had a plane to carry (a version-7 2D
 * file says `addCircle(c, r, null, name)`, and the null is exactly what a 3D
 * model cannot take). `lift` says which. Otherwise `give` passes every step
 * through.
 */
export function planeTranslation(model: Model, journal: JournalEntry[], version: number, lift = false) {
  const active = version < 7 || lift;
  // Where the name is in the entry as written: after the plane from 7 on.
  const v7 = version >= 7;
  const taken = new Set<string>();
  const doomed = new Set<string>();
  if (active) {
    const walk = (v: unknown) => {
      if (typeof v === "string") taken.add(v);
      else if (Array.isArray(v)) v.forEach(walk);
    };
    for (const e of journal) {
      if (Array.isArray(e.args)) walk(e.args);
      if (e.op === "deleteEntity" && typeof e.args?.[0] === "string") doomed.add(e.args[0]);
    }
  }
  const made: Made[] = [];
  const arcs: { entry: JournalEntry; name: string; candidates: string[] }[] = [];

  /**
   * A frame's +z — for one the translation made, the +z it *will* have once
   * `settle` has turned it, so a second arc in the plane a first one turned it
   * into is seen to fit it before the turn is applied.
   */
  const normalOf = (frame: string) => own3(made, frame) ?? framePlaneAxes(model, frame)?.n ?? null;

  /** The frames a curve made at this step may stand on — see the rule. */
  function candidates(): string[] {
    const out: string[] = [];
    for (const e of model.entities.values()) {
      if (e.kind === "frame" && !doomed.has(e.name) && normalOf(e.name)) out.push(e.name);
    }
    return out;
  }

  /** Among `among`, the frames parallel to `n` — the default first if it is one of them, then in creation order. */
  function nearest(n: number[] | null, among: string[]): string | null {
    if (!n) return null;
    const fits = among.filter((f) => parallel(n, normalOf(f)!));
    if (!fits.length) return null;
    return fits.includes(model.defaultFrame ?? "") ? model.defaultFrame : fits[0];
  }

  /** A frame of the translation's own, in the plane spanned by `u` and `v`, its origin at `at`. */
  function makeFrame(at: number[], u: number[], v: number[], owner: string | null): { name: string; entries: JournalEntry[] } {
    const name = freshName("plane", taken);
    taken.add(name);
    const pts = (["o", "x", "y"] as const).map((k) => {
      const n = freshName(`${name}_${k}`, taken);
      taken.add(n);
      return n;
    }) as [string, string, string];
    const span = Model.FREE_SPAN;
    const A = lift3(at);
    made.push({ frame: name, points: pts, owner, u, v });
    return {
      name,
      entries: [
        { op: "addPoint", args: [A, pts[0]] },
        { op: "addPoint", args: [A.map((x, i) => x + span * u[i]), pts[1]] },
        { op: "addPoint", args: [A.map((x, i) => x + span * v[i]), pts[2]] },
        { op: "addFrame", args: [pts[0], pts[1], pts[2], name] },
      ],
    };
  }

  const coordsOf = (name: unknown): number[] | null =>
    typeof name === "string" && model.entities.get(name)?.kind === "point" ? model.coords(name) : null;

  /** A circle's plane at its step: the default, else one its centre is on, else the earliest, else a new one. */
  function circlePlane(center: unknown, owner: string | null): { plane: string; entries: JournalEntry[] } {
    const cands = candidates();
    if (model.defaultFrame != null && cands.includes(model.defaultFrame)) return { plane: model.defaultFrame, entries: [] };
    const at = coordsOf(center);
    if (at) {
      const on = cands.find((f) => {
        const ax = framePlaneAxes(model, f)!;
        return liesOn({ origin: model.coords(model.frame(f).origin), u: ax.u, v: ax.v }, at);
      });
      if (on) return { plane: on, entries: [] };
    }
    if (cands.length) return { plane: cands[0], entries: [] };
    const made = makeFrame(at ?? [0, 0, 0], [1, 0, 0], [0, 1, 0], owner);
    return { plane: made.name, entries: made.entries };
  }

  /** The plane a fillet's corner lies in at this step, from its legs as the replay has them. */
  function cornerNormal(l1: unknown, l2: unknown): { n: number[]; at: number[] } | null {
    const a = typeof l1 === "string" ? model.entities.get(l1) : undefined;
    const b = typeof l2 === "string" ? model.entities.get(l2) : undefined;
    if (a?.kind !== "line" || b?.kind !== "line") return null;
    const shared = a.refs.find((r) => b.refs.includes(r));
    if (shared === undefined) return null;
    const p = model.coords(shared);
    const far = (l: typeof a) => model.coords(l.refs[0] === shared ? l.refs[1] : l.refs[0]);
    const n = unit3(cross3(sub3(lift3(far(a)), lift3(p)), sub3(lift3(far(b)), lift3(p))));
    return n ? { n, at: p } : null;
  }

  return {
    /** One step, rewritten into version 7 — with any frame it needs in front of it. */
    give(step: JournalEntry): JournalEntry[] {
      if (!active) return [step];
      const a = step.args;
      const three = model.dim === 3;
      if (step.op === "addCircle") {
        const [center, radius] = a;
        const name = v7 ? a[3] : a[2];
        if (!three) return [{ op: "addCircle", args: [center ?? null, radius ?? null, null, name ?? null] }];
        const { plane, entries } = circlePlane(center, typeof name === "string" ? name : null);
        return [...entries, { op: "addCircle", args: [center ?? null, radius ?? null, plane, name ?? null] }];
      }
      if (step.op === "addArc") {
        const [c, s, e, r] = a;
        const name = v7 ? a[5] : a[4];
        if (!three) return [{ op: "addArc", args: [c ?? null, s ?? null, e ?? null, r ?? null, null, name ?? null] }];
        // Provisional: the arc's ends and centre may still be seeds, or not
        // exist yet. `settle` chooses from the saved geometry.
        const { plane, entries } = circlePlane(c, typeof name === "string" ? name : null);
        const entry: JournalEntry = { op: "addArc", args: [c ?? null, s ?? null, e ?? null, r ?? null, plane, name ?? null] };
        if (typeof name === "string") arcs.push({ entry, name, candidates: candidates().concat(entries.length ? [plane] : []) });
        return [...entries, entry];
      }
      if (step.op === "fillet" && three && a.length === 3) {
        const [l1, l2, r] = a;
        const corner = cornerNormal(l1, l2);
        const fits = corner ? nearest(corner.n, candidates()) : null;
        if (fits || !corner) {
          // No corner to read is a step that will fail on its own terms; it is
          // handed the default (or nothing) and left to say why.
          return [{ op: "fillet", args: [l1, l2, r, fits ?? model.defaultFrame ?? null] }];
        }
        const [u, v] = spanOf(corner.n);
        const made = makeFrame(corner.at, u, v, null);
        return [...made.entries, { op: "fillet", args: [l1, l2, r, made.name] }];
      }
      return [step];
    },

    /**
     * After the saved coordinates are restored: each translated arc's plane
     * chosen from its saved geometry (switching, or making a frame, where the
     * provisional one does not fit), its ends swapped where the version-6
     * rule drew it the other way round, and every frame the translation made
     * moved onto its curve's centre.
     */
    settle(): void {
      if (!active || model.dim !== 3) return;
      const later: string[] = [];
      for (const rec of arcs) {
        const arc = model.entities.get(rec.name);
        if (arc?.kind !== "arc") continue;
        const [C, S, E] = [model.coords(arc.center), model.coords(arc.start), model.coords(arc.end)];
        const raw = unit3(cross3(sub3(lift3(S), lift3(C)), sub3(lift3(E), lift3(C))));
        let plane = arc.plane!;
        const now = normalOf(plane);
        if (raw && !(now && parallel(raw, now))) {
          const own = made.find((m) => m.frame === plane && m.owner === rec.name);
          const switched = nearest(raw, rec.candidates.filter((f) => f !== own?.frame).concat(later));
          if (switched) {
            plane = switched;
          } else if (own && model.dependents(own.frame).every((d) => d.name === rec.name)) {
            // The frame was made for this arc alone, on a guess: turn it into
            // the arc's plane rather than leave it and make another.
            [own.u, own.v] = spanOf(v6ArcNormal(C, S, E) ?? raw);
          } else {
            const [u, v] = spanOf(v6ArcNormal(C, S, E) ?? raw);
            const fresh = makeFrame(C, u, v, rec.name);
            model.withoutRecording(() => {
              for (const entry of fresh.entries) {
                const m = model as unknown as Record<string, (...x: unknown[]) => unknown>;
                m[entry.op](...entry.args);
              }
            });
            // Just before the arc's own entry — found by its argument list,
            // which the replay hands to the journal as it is.
            const at = model.journal.findIndex((j) => j.args === rec.entry.args);
            model.journal.splice(at < 0 ? model.journal.length : at, 0, ...fresh.entries);
            plane = fresh.name;
            later.push(fresh.name);
          }
          arc.plane = plane;
          rec.entry.args[4] = plane;
        }
        // Which way round: version 6's side against the chosen frame's +z.
        const was = v6ArcNormal(C, S, E);
        const side = normalOf(plane);
        const is = side && arcNormal(C, S, E, side);
        if (was && is && dot3(was, is) < 0) {
          [arc.start, arc.end] = [arc.end, arc.start];
          const args = rec.entry.args;
          if (args[1] != null && args[2] != null) [args[1], args[2]] = [args[2], args[1]];
        }
      }
      // Every frame the translation made, onto its curve's centre (its own
      // points are not among the saved values, so they are still where the
      // replay's seeds put them), turned to the plane it was made for.
      model.withoutRecording(() => {
        for (const m of made) {
          const owner = m.owner == null ? undefined : model.entities.get(m.owner);
          const centre = owner && (owner.kind === "circle" || owner.kind === "arc") ? model.coords(owner.center) : null;
          const o = centre ?? model.coords(m.points[0]);
          const span = Model.FREE_SPAN;
          model.setCoords(m.points[0], o);
          model.setCoords(m.points[1], o.map((x, i) => x + span * m.u[i]));
          model.setCoords(m.points[2], o.map((x, i) => x + span * m.v[i]));
        }
      });
    },
  };
}

/** The normal a frame the translation made is about to have, once `settle` turns it — or null for any other frame. */
function own3(made: Made[], frame: string): number[] | null {
  const m = made.find((x) => x.frame === frame);
  return m ? cross3(m.u, m.v) : null;
}
