// Operations, as distinct from relations. A relation only ever *adds an
// equation* — the model's structure is untouched and the solver does the
// rest. An operation changes the structure itself: it creates entities,
// re-points references, trims things back. Fillet is the first, and the
// distinction is worth a file of its own because the two want reviewing
// with different eyes: a relation can only ever over- or under-constrain,
// while an operation can leave the model malformed.

import {
  Model, SETTABLE_PROPERTY, parseValueRef, referentOf, valueArgIndex,
  type Entity,
} from "./model.ts";
import { dist } from "./relations/basic.ts";
import { angle, arcEndpoints, radius, tangent } from "./relations/geometry.ts";
import { extrusion } from "./relations/extrusion.ts";
import { sweepsAs } from "./arcgeom.ts";
import { framePlaneAxes } from "./curveplane.ts";
import { describeLoop, findLoops, joinClasses, parallel, type Loop } from "./loops.ts";
import { cross3, lift3, sub3 } from "./vec3.ts";

function unit(v: number[]): number[] {
  const len = Math.hypot(...v);
  if (len < 1e-12) throw new Error("cannot take the direction of a zero-length line");
  return v.map((c) => c / len);
}

/** The point both lines reference, plus each line's far end. */
function corner(model: Model, l1Name: string, l2Name: string) {
  const l1 = model.line(l1Name), l2 = model.line(l2Name);
  const shared = l1.refs.find((n) => l2.refs.includes(n));
  if (!shared) throw new Error(`"${l1Name}" and "${l2Name}" do not meet at a shared point`);
  const a = l1.refs[0] === shared ? l1.refs[1] : l1.refs[0];
  const b = l2.refs[0] === shared ? l2.refs[1] : l2.refs[0];
  return { l1, l2, shared, a, b };
}

/**
 * Rounds the corner where two lines meet, with an arc of the given radius
 * tangent to both.
 *
 * The whole thing composes out of the existing relation vocabulary, which is
 * the point worth noticing: `tan` on each leg, `arcends` to hold the arc's
 * ends on its own circle, and `rad` for the size. Nothing bespoke. Those four
 * are also *complete* — a tangent line touches its circle exactly once, so an
 * endpoint that lies on both the leg and the circle can only be the point of
 * tangency. There is no need to state that separately.
 *
 * Structurally: the shared corner point is *reused* as the tangent point on
 * the first leg rather than being replaced, so the operation leaves no
 * orphaned geometry behind (the model has no delete yet, so an operation that
 * stranded points would leave stray dots on the canvas forever). The second
 * leg is re-pointed at a new tangent point.
 *
 * The legs' *directions* are deliberately left alone. A fillet in a
 * parametric sketch does not pin the lines it rounds — whatever already
 * constrains them (an axis par, a dimension, another relation) still decides
 * where they point, and the fillet solves within that. On an otherwise
 * unconstrained pair of lines the result is therefore under-determined, and
 * the seeded starting positions are what pick a sensible answer.
 *
 * Which makes the *form* those constraints were written in matter. A relation
 * on a line ("this edge is level") resolves the line's endpoints at every
 * evaluation, so it follows the leg through this re-pointing. A relation on
 * two points ("these two share a y") keeps constraining the two points it
 * named — including the old corner, which is now leg one's tangent point —
 * and leaves the re-pointed leg free to swing. Both behaviours are pinned in
 * test/sketch.test.ts. Prefer the line form for anything that is a property
 * of an edge; it is what the built-in tools use.
 *
 * **In 3D the corner is a plane** — the one the two legs span — and every
 * step above is the same arithmetic in it: the bisector, the back-off along
 * each leg and the centre along the bisector are all lengths and dot products.
 * The arc it makes needs a plane of its own, as every 3D arc does (see
 * `ArcEntity`): `plane`, or the default frame resolved now and journalled
 * resolved — `fix`'s rule. The corner has to *lie* in that frame's
 * orientation, or the arc's own `arcends` and `tan` would pull the legs into a
 * plane they are not in; a corner turned out of it is refused, naming the
 * frame, rather than rounded into a conflict. (A 2D model refuses the argument,
 * like `addArc`.) Which endpoint the arc starts at is asked of the rule every
 * arc is drawn by (see arcgeom.ts), about that plane's +z, so the short arc
 * between the tangent points is the one drawn however the corner is turned. In
 * 2D the answer is the old one.
 *
 * Returns the new arc's name.
 */
export function fillet(model: Model, l1Name: string, l2Name: string, r: number, plane?: string | null): string {
  if (model.dim !== 2 && model.dim !== 3) throw new Error("fillet rounds a corner in a 2D or 3D model");
  if (!(r > 0)) throw new Error("fillet needs a positive radius");
  if (model.dim === 2 && plane != null) {
    throw new Error("a 2D fillet takes no plane — its arc lies in the one plane a 2D model has");
  }
  const frame = model.dim === 3 ? model.resolveFrame(plane) : null;
  // Journalled as the one call the user made, not as the entities and
  // relations it expands into — replaying it re-expands them identically. The
  // plane is journalled resolved, and only where there is one: a 2D fillet's
  // entry is the three arguments it always was.
  const args: unknown[] = frame == null ? [l1Name, l2Name, r] : [l1Name, l2Name, r, frame];
  return model.asOperation("fillet", args, () => filletBody(model, l1Name, l2Name, r, frame));
}

/**
 * How far out of a frame's orientation a corner may be and still be rounded in
 * it: the sine of the angle between the corner's normal and the frame's +z. A
 * millionth — far above the solver's tolerance on legs held in a plane by
 * `onPlane`, far below anything a drawing would show.
 */
export const IN_PLANE_SINE = 1e-6;

function filletBody(model: Model, l1Name: string, l2Name: string, r: number, frame: string | null): string {

  const { l1, shared, a, b } = corner(model, l1Name, l2Name);
  const p = model.coords(shared);
  const u = unit(model.coords(a).map((c, i) => c - p[i]));
  const v = unit(model.coords(b).map((c, i) => c - p[i]));
  // The side the arc turns about: its plane's +z, or the 2D drawing's.
  const side = frame == null ? [0, 0, 1] : framePlaneAxes(model, frame)?.n;
  if (!side) throw new Error(`"${frame}" has collapsed — it has no plane to round a corner in`);
  if (frame != null) {
    const n = cross3(lift3(u), lift3(v));
    const nl = Math.hypot(...n);
    const sine = nl > 1e-12 ? Math.hypot(...cross3(n.map((x) => x / nl), side)) : 0;
    if (sine > IN_PLANE_SINE) {
      throw new Error(`the corner between "${l1Name}" and "${l2Name}" is not in "${frame}"'s plane — `
        + `fillet in the frame it is drawn on: fillet("${l1Name}", "${l2Name}", ${r}, "<frame>")`);
    }
  }

  // The interior angle at the corner decides how far back the legs are cut.
  const cosTheta = Math.min(1, Math.max(-1, u.reduce((s, ui, i) => s + ui * v[i], 0)));
  const theta = Math.acos(cosTheta);
  if (theta < 1e-6 || Math.PI - theta < 1e-6) {
    throw new Error("cannot fillet a corner whose legs are collinear");
  }

  const backoff = r / Math.tan(theta / 2); // corner -> each tangent point
  const toCenter = r / Math.sin(theta / 2); // corner -> arc center
  const legA = Math.hypot(...model.coords(a).map((c, i) => c - p[i]));
  const legB = Math.hypot(...model.coords(b).map((c, i) => c - p[i]));
  if (backoff > legA || backoff > legB) {
    throw new Error(`radius ${r} is too large for this corner (needs ${backoff.toFixed(3)} of leg, have ${Math.min(legA, legB).toFixed(3)})`);
  }

  const bisector = unit(u.map((ui, i) => ui + v[i]));
  const t1 = p.map((pi, i) => pi + u[i] * backoff);
  const t2 = p.map((pi, i) => pi + v[i] * backoff);
  const ctr = p.map((pi, i) => pi + bisector[i] * toCenter);

  // Reuse the corner as leg one's tangent point; leg two gets a fresh one.
  model.setCoords(shared, t1);
  const t2p = model.addPoint(t2);
  const ctrp = model.addPoint(ctr);
  model.retargetLine(l2Name, shared, t2p.name);

  // Sweep counter-clockwise from start to end, so order the two ends by which
  // way round is the short way — otherwise the arc renders as the reflex one.
  // "Counter-clockwise" is about the arc's plane's +z; the short way from t1
  // to t2 is counter-clockwise about the normal t1 × t2 (taken from the
  // centre), so t1 starts exactly when that normal is on +z's side.
  const short = cross3(sub3(lift3(t1), lift3(ctr)), sub3(lift3(t2), lift3(ctr)));
  const [start, end] = sweepsAs(ctr, t1, t2, short, side) ? [shared, t2p.name] : [t2p.name, shared];

  const arc = model.addArc(ctrp.name, start, end, r, frame);
  radius(model, arc.name, r);
  arcEndpoints(model, arc.name);
  tangent(model, l1.name, arc.name);
  tangent(model, l2Name, arc.name);

  return arc.name;
}

// --- extrude ----------------------------------------------------------------

/**
 * The depth an extrude gets when it is not told one — a seed, by the
 * free-entities rule, and from then on the depth dimension's value, which
 * `set` edits like any other.
 */
export const DEFAULT_DEPTH = Model.DEFAULT_RADIUS;

/**
 * A profile **resolved**: the frame the lid is offset along, and the loops —
 * the one extruded first, then every loop inside it, each as its members in
 * walk order. What `extrude` journals; see there for why.
 */
export interface Profile {
  frame: string;
  loops: string[][];
}

/**
 * Extrudes the closed loop `member` is in — a solid of that region, `depth`
 * deep along its sketch frame's +z — and returns the new feature's name, `e1`.
 *
 * **An expansion into real geometry**, which is the one-model decision paying
 * out: nothing here is a mesh. For every corner of the profile a twin point on
 * the lid; for every member a twin member between the twins (an arc's or
 * circle's on the lid's own frame, so a sketch on the top cap means what it
 * says); for every corner a wall line from base to twin; one frame for the lid,
 * the sketch frame moved by the depth; and **one dimension** — an `extrusion`,
 * `d`-named — holding every twin at its base plus the depth along the frame's
 * +z. So `set("d9.value", 40)` re-solves the solid like any dimension, and the
 * twins and walls are ordinary entities: draggable, constrainable,
 * dimensionable, with the solver negotiating between them and the depth. A
 * record (`e1`, see `FeatureEntry`) says which pieces are one solid, for the
 * renderer and for `del`; the faces are drawn from the live geometry and
 * stored nowhere.
 *
 * **Holes come with the loop.** Every loop inside the one extruded is part of
 * the profile — a hole, and inside a hole an island — and gets twins and walls
 * exactly as the outline does. The caps are drawn even-odd, so an island in a
 * hole extrudes solid without anyone deciding so. A circle has no corners, so a
 * circle's walls are **display-only**: a tube is its two rims, their centres
 * and the depth, and the cylinder between them is drawn, not built — there is
 * no finite set of lines that is that surface, and a seam line drawn at an
 * arbitrary angle would be a lie about where the circle starts.
 *
 * **Which loop.** `member` names any line, arc or circle; the loop is the one
 * it is in (`findLoops`). A member in more than one — an edge two faces share,
 * and after an extrude every profile edge, which is also an edge of a wall — is
 * refused with the loops listed, unless `frame` narrows it to the loops
 * parallel to that frame's plane. A member in none is refused with what makes a
 * loop. The extrude tool skips the question: it hands over the loop under the
 * click.
 *
 * **Which way.** Along `frame`'s +z — the frame given, or else the frame the
 * loop lies in (the default first), or else one parallel to it. A loop in no
 * frame's orientation is refused: an extrude reads its direction off a frame,
 * as `fix` reads its coordinates off one, and inventing a frame would be a
 * datum nobody chose. A negative depth extrudes the other way.
 *
 * **Journalled as the call, with the profile resolved** — `extrude("l1", 20,
 * "f1", [["l1","a1","l2","l3","l4"],["c1"]])` — the same rule by which `fix`,
 * `circ` and `fillet` journal the frame they resolved: a saved entry must not
 * change meaning with the drawing it is replayed into. Here that is not
 * hypothetical. Replay runs on *seeds* (nothing is solved until the saved
 * values are put back), and a profile built from free lines and relations has
 * no loop at all at its seeds — measured: a rectangle of four `ln()`s, coin'd
 * and fixed into place, has one loop solved and none at replay — so re-finding
 * the loop would fail the file and every undo after it. Given `loops`, nothing
 * is looked for: the members are walked by their joins (relations, never
 * positions) and checked closed, and that is all. A user never needs to type
 * them.
 *
 * An operation, refusing before it changes anything (`asOperation` records only
 * on success). 3D only.
 */
export function extrude(model: Model, member: string, depth?: number | null, frame?: string | null,
                        loops?: string[][] | null): string {
  if (model.dim !== 3) throw new Error("extrude needs a 3D model — a 2D drawing has no direction out of its plane");
  const d = depth ?? DEFAULT_DEPTH;
  if (typeof d !== "number" || !Number.isFinite(d) || d === 0) {
    throw new Error(`extrude needs a non-zero depth, got ${JSON.stringify(depth)}`);
  }
  const e = typeof member === "string" ? model.entities.get(member) : undefined;
  if (!e || (e.kind !== "line" && e.kind !== "arc" && e.kind !== "circle")) {
    throw new Error(`${JSON.stringify(member)} is not a line, arc or circle — extrude names a member of the loop to extrude`);
  }
  const profile = loops != null ? givenProfile(model, member, frame, loops) : foundProfile(model, member, frame ?? null);
  const plan = planExtrude(model, profile);
  return model.asOperation("extrude", [member, d, profile.frame, profile.loops],
    () => extrudeBody(model, member, d, plan));
}

/**
 * The profile for the loop at `index` of `all` (what `findLoops` returned):
 * that loop, every loop inside it, and the frame it is extruded along. What the
 * extrude tool hands to `extrude` for the region under a click. Throws when no
 * frame orients the loop — see `extrude`.
 */
export function profileOf(model: Model, all: Loop[], index: number, frame?: string | null): Profile {
  const f = frame ?? sketchFrameOf(model, all[index]);
  return { frame: f, loops: regionOf(all, index).map((i) => all[i].members.map((m) => m.name)) };
}

/**
 * The region a loop bounds, as indices into `all`: the loop, then every loop
 * inside it in `findLoops` order. Every descendant, not only the children — a
 * hole's island is part of the region too, and even-odd decides it is solid.
 * What an extrude takes, and what the tool outlines before the click.
 */
export function regionOf(all: Loop[], index: number): number[] {
  const inner: number[] = [];
  const queue = [...all[index].children];
  while (queue.length) {
    const i = queue.shift()!;
    inner.push(i);
    queue.push(...all[i].children);
  }
  return [index, ...inner.sort((a, b) => a - b)];
}

/** The frames to try, the default first and then in creation order — loops.ts's preference. */
function framesByPreference(model: Model): string[] {
  const all = [...model.entities.values()].filter((e) => e.kind === "frame").map((e) => e.name);
  const d = model.defaultFrame;
  return d != null && all.includes(d) ? [d, ...all.filter((f) => f !== d)] : all;
}

/** The frame a loop is extruded along when none is named. See `extrude`. */
function sketchFrameOf(model: Model, loop: Loop): string {
  if (loop.plane.frame !== null) return loop.plane.frame;
  for (const f of framesByPreference(model)) {
    const axes = framePlaneAxes(model, f);
    if (axes && parallel(axes.n, loop.plane.normal)) return f;
  }
  throw new Error(`the loop of ${loop.members.map((m) => m.name).join(",")} lies in no frame's plane, and no frame is `
    + "parallel to it — an extrude runs along a sketch frame's +z: make one on its plane (plane(…), or Sketch on this) "
    + "and extrude again");
}

/** The loop `member` is in, found — and refused if it is in none, or in several. */
function foundProfile(model: Model, member: string, frame: string | null): Profile {
  const all = findLoops(model);
  let mine = all.map((_, i) => i).filter((i) => all[i].members.some((m) => m.name === member));
  if (frame !== null) {
    model.frame(frame);
    const axes = framePlaneAxes(model, frame);
    if (!axes) throw new Error(`"${frame}" has collapsed — it has no +z to extrude along`);
    mine = mine.filter((i) => parallel(all[i].plane.normal, axes.n));
  }
  if (mine.length === 0) {
    const where = frame === null ? "" : ` parallel to ${frame}`;
    throw new Error(`"${member}" is in no closed loop${where} — loops() lists the loops there are. A loop's ends join `
      + "only at a shared point or a coin (never by touching), lie in one plane, and do not cross one another");
  }
  if (mine.length > 1) {
    const list = mine.map((i) => describeLoop(all[i], all)).join("; ");
    throw new Error(`"${member}" is in ${mine.length} loops — ${list}. Name the frame of the sketch it is in `
      + `(extrude(${JSON.stringify(member)}, depth, "f1")), name a member only one of them has, or click inside the `
      + "region with the extrude tool");
  }
  return profileOf(model, all, mine[0], frame);
}

/** A profile handed over whole — the journal's, or the tool's — checked for shape. */
function givenProfile(model: Model, member: string, frame: string | null | undefined, loops: unknown): Profile {
  if (typeof frame !== "string") throw new Error("a profile given as loops needs the frame it is extruded along");
  model.frame(frame);
  const ok = Array.isArray(loops) && loops.length > 0
    && loops.every((l) => Array.isArray(l) && l.length > 0 && l.every((n) => typeof n === "string"));
  if (!ok) throw new Error("extrude's loops are lists of member names, the extruded loop first");
  const given = (loops as string[][]).map((l) => l.slice());
  const flat = given.flat();
  if (new Set(flat).size !== flat.length) throw new Error("a member appears twice in extrude's loops");
  if (!flat.includes(member)) throw new Error(`"${member}" is not in the loops given`);
  return { frame, loops: given };
}

/** One member of a profile loop, walked: its ends in walk order, null for a circle. */
interface Walked {
  name: string;
  kind: "line" | "arc" | "circle";
  from: string | null;
  to: string | null;
}

interface ExtrudePlan {
  frame: string;
  loops: string[][];
  walked: Walked[][];
  classOf: Map<string, number>;
  /** The frame's +z when the call was made — where the twins are seeded, and nothing else. */
  z: number[];
}

/**
 * Everything an extrude checks before it makes anything: the frame has a +z,
 * and every loop walks closed by its joins. Read off relations and names only —
 * which is what lets a replay, running on seeds, plan exactly what the call did.
 */
function planExtrude(model: Model, profile: Profile): ExtrudePlan {
  const axes = framePlaneAxes(model, profile.frame);
  if (!axes) throw new Error(`"${profile.frame}" has collapsed — it has no +z to extrude along`);
  const classOf = joinClasses(model);
  const walked = profile.loops.map((names) => walkLoop(model, classOf, names));
  return { frame: profile.frame, loops: profile.loops, walked, classOf, z: axes.n };
}

/**
 * A loop's members walked end to end by their **joins** — the joined classes
 * loops.ts reads off the `coin` relations, never positions — starting forward
 * along the first unless its far end does not meet the second. The same walk at
 * the call and at every replay, so the twins come out in the same order under
 * the same names. Refuses a loop that does not close, naming where it breaks.
 */
function walkLoop(model: Model, classOf: Map<string, number>, names: string[]): Walked[] {
  const entity = (n: string) => {
    const e = model.entities.get(n);
    if (!e || (e.kind !== "line" && e.kind !== "arc" && e.kind !== "circle")) {
      throw new Error(`"${n}" is not a line, arc or circle — it cannot be part of a loop`);
    }
    return e;
  };
  if (names.length === 1) {
    const e = entity(names[0]);
    if (e.kind !== "circle") throw new Error(`a loop of one member is a circle — "${names[0]}" is ${e.kind === "arc" ? "an arc" : "a line"}`);
    return [{ name: e.name, kind: "circle", from: null, to: null }];
  }
  const ends = (n: string): [string, string] => {
    const e = entity(n);
    if (e.kind === "circle") throw new Error(`a circle is a loop on its own — "${n}" cannot be part of the loop ${names.join(",")}`);
    return e.kind === "line" ? [e.refs[0], e.refs[1]] : [e.start, e.end];
  };
  const cls = (p: string) => classOf.get(p);
  const meets = (p: string, n: string) => ends(n).some((q) => cls(q) === cls(p));
  const apart = (a: string, b: string) => new Error(`"${a}" and "${b}" do not meet — the loop ${names.join(",")} is not closed`);
  const kind = (n: string) => entity(n).kind as "line" | "arc";

  const [a0, b0] = ends(names[0]);
  const back = !meets(b0, names[1]);
  if (back && !meets(a0, names[1])) throw apart(names[0], names[1]);
  const out: Walked[] = [{ name: names[0], kind: kind(names[0]), from: back ? b0 : a0, to: back ? a0 : b0 }];
  for (let i = 1; i < names.length; i++) {
    const [a, b] = ends(names[i]);
    const at = out[i - 1].to!;
    if (cls(a) === cls(at)) out.push({ name: names[i], kind: kind(names[i]), from: a, to: b });
    else if (cls(b) === cls(at)) out.push({ name: names[i], kind: kind(names[i]), from: b, to: a });
    else throw apart(names[i - 1], names[i]);
  }
  if (cls(out[out.length - 1].to!) !== cls(out[0].from!)) throw apart(names[names.length - 1], names[0]);
  return out;
}

/**
 * The expansion, in an order a replay reproduces name for name: the lid's frame
 * (its three points, then the frame), one twin point per joined class in walk
 * order, the twin members, the walls, the depth, the record.
 */
function extrudeBody(model: Model, member: string, depth: number, plan: ExtrudePlan): string {
  const { frame, walked, classOf, z } = plan;
  // Seeds only: the depth relation is what holds them, and the solve after the
  // call settles any frame that has turned since the plan was made.
  const lifted = (p: string) => model.coords(p).map((c, i) => c + depth * z[i]);
  const owns: string[] = [];
  const made = (name: string) => { owns.push(name); return name; };

  // The lid's frame: the sketch frame, moved. Held there by the depth's own
  // pairs — read as a datum, so the lid can never turn the sketch.
  const f = model.frame(frame);
  const [o, x, y] = [f.origin, f.xref, f.yref!];
  const [to, tx, ty] = [o, x, y].map((p) => made(model.addPoint(lifted(p)).name));
  const top = made(model.addFrame(to, tx, ty).name);

  // One twin per *joined class*, so the lid's corners are joined exactly where
  // the profile's are — one point where the profile had a shared point or a
  // coin — and the top cap is itself a loop.
  const byClass = new Map<number, { base: string; twin: string }>();
  const twinOf = (p: string): string => {
    const k = classOf.get(p)!;
    let t = byClass.get(k);
    if (!t) {
      t = { base: p, twin: made(model.addPoint(lifted(p)).name) };
      byClass.set(k, t);
    }
    return t.twin;
  };
  for (const loop of walked) {
    for (const m of loop) {
      const e = model.entities.get(m.name)!;
      if (e.kind === "circle") { twinOf(e.center); continue; }
      twinOf(m.from!);
      if (e.kind === "arc") twinOf(e.center);
      twinOf(m.to!);
    }
  }

  // Each member's twin, in the member's *own* direction. A curve on the sketch
  // frame goes on the lid's frame; one on any other frame keeps its own — same
  // orientation, so the twin arc is the same arc, with no side to decide.
  const planeFor = (p: string | undefined) => (p === frame ? top : p);
  const twins = walked.map((loop) => loop.map((m) => {
    const e = model.entities.get(m.name)!;
    if (e.kind === "line") return made(model.addLine(twinOf(e.refs[0]), twinOf(e.refs[1])).name);
    if (e.kind === "arc") {
      return made(model.addArc(twinOf(e.center), twinOf(e.start), twinOf(e.end), model.radius(e.name), planeFor(e.plane)).name);
    }
    if (e.kind === "circle") return made(model.addCircle(twinOf(e.center), model.radius(e.name), planeFor(e.plane)).name);
    throw new Error(`"${m.name}" is not a line, arc or circle`); // unreachable: walkLoop checked
  }));

  // A wall at every corner, base to twin — once per joined class, so a corner
  // two loops share has one. A circle has none (see `extrude`).
  const walls: string[] = [];
  const walled = new Set<number>();
  for (const loop of walked) {
    for (const m of loop) {
      if (m.from === null) continue;
      const k = classOf.get(m.from)!;
      if (walled.has(k)) continue;
      walled.add(k);
      const { base, twin } = byClass.get(k)!;
      walls.push(made(model.addLine(base, twin).name));
    }
  }

  // The depth: corners and centres first (the label sits on the first wall),
  // then the curves' radii, then the lid frame.
  const pairs: string[] = [];
  for (const { base, twin } of byClass.values()) pairs.push(base, twin);
  walked.forEach((loop, i) => loop.forEach((m, j) => { if (m.kind !== "line") pairs.push(m.name, twins[i][j]); }));
  pairs.push(o, to, x, tx, y, ty);
  const held = made(extrusion(model, frame, depth, ...pairs));

  return model.addFeature({
    kind: "extrude", member, frame, top, depth: held,
    loops: plan.loops.map((l) => l.slice()), twins, walls,
    names: [...plan.loops.flat(), frame, ...owns], owns,
  }).name;
}

// --- editing a dimension ----------------------------------------------------

/**
 * How each dimension is re-run from its recorded arguments. One line per op,
 * and deliberately not a lookup into `replenv`'s table or `persist`'s: both of
 * those sit *above* this file, and a dimension has to be rebuildable by the
 * layer that owns operations.
 */
const REBUILD: Record<string, (model: Model, args: unknown[]) => void> = {
  dist: (m, a) => void dist(m, a[0] as string, a[1] as string, a[2] as number),
  radius: (m, a) => void radius(m, a[0] as string, a[1] as number),
  angle: (m, a) => void angle(m, a[0] as string, a[1] as string, a[2] as number),
  // An extrude's depth: the whole lid, one value. Without this line `set` on
  // one throws — `test/dimensions.test.ts` drives every dimension through here.
  extrusion: (m, a) => void extrusion(m, a[0] as string, a[1] as number, ...(a.slice(2) as string[])),
};

/**
 * The half of every "that has no value" message that says what does. Written
 * in the *short* names, because those are what the user typed to make one —
 * being told about `radius` after typing `rad` is a small riddle to no purpose.
 */
const onlyDims = `only dist, rad, ang and an extrude's depth have a .${SETTABLE_PROPERTY}`;

/**
 * Changes a dimension's value: `set("d4.value", 60)`.
 *
 * This is the owner's answer to how a dimension is edited, and the shape of it
 * follows from his words — *"a `set(d4.value, 60)` where d4 is the dimension"*.
 * There is no parameter table anywhere: the dimension **is** the named
 * value-holder, which is why `dist`, `rad` and `ang` claim `d` names in the
 * first place (see `DIMENSION_OPS`).
 *
 * **An operation, not a relation.** It does not add an equation — it replaces
 * one, taking the relation's residual blocks out of the problem and putting
 * fresh ones in. That is structure-adjacent bookkeeping of exactly the kind
 * `operations.ts` exists to hold apart, and it is reviewable on the operation's
 * terms: it can leave the drawing over- or under-constrained (so can any
 * dimension), and it must not be able to leave it malformed. `rebuildRelation`
 * is where that last guarantee lives — a body that throws leaves the old blocks
 * in place, so a rejected value costs nothing.
 *
 * **In place, under the same name.** `d4` is still `d4` afterwards, still in
 * the same position in the registry, with its `args` updated — so `rels()`, the
 * glyph's label and `del`'s reference scan all tell the truth about it without
 * being told anything. That is the whole point of the dimension being named.
 *
 * **The unit is what the relation stores**, which for `ang` means radians. The
 * label on the drawing reads degrees, and that seam is documented rather than
 * papered over here: guessing at the caller's intent from the size of the
 * number would be worse than one honest unit. See `glyphs.ts`'s `labelFor`.
 *
 * Journalled as the one call the user made, so a replay re-runs `set` rather
 * than the relation it rebuilt — which keeps a saved file a transcript of what
 * was typed. One user action, so one undo step; the host re-solves afterwards
 * (see `replenv.ts`), for the reason `del` does: an edit whose entire purpose
 * is to change the answer must not leave a stale verdict on the header.
 *
 * Returns the dimension's name, unchanged — that being the claim worth making.
 */
export function set(model: Model, path: string, value: number): string {
  const { name } = parseValueRef(path);
  // One sentence for "there is nothing here to set", whatever the reason —
  // wrong kind of thing, or nothing of that name at all. What the reader needs
  // either way is which relations *do* have a value.
  if (!model.relations.has(name)) {
    const what = model.entities.has(name) ? `is an entity, not a dimension` : `is not a relation`;
    throw new Error(`"${name}" ${what} — ${onlyDims}`);
  }
  const entry = model.relationOf(name);
  const at = valueArgIndex(entry.op);
  if (at === null) {
    throw new Error(`"${name}" is a ${entry.op}, not a dimension — ${onlyDims}`);
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    // Radians named in the message rather than only in the docs: this is the
    // throw a user reaches while holding the wrong unit in their head.
    const unit = entry.op === "angle" ? " of radians (the label reads degrees; the relation stores radians)" : "";
    throw new Error(`set needs a number${unit}, got ${JSON.stringify(value)}`);
  }
  const args = entry.args.slice();
  args[at] = value;
  const rebuild = REBUILD[entry.op];
  if (!rebuild) throw new Error(`"${entry.op}" cannot be rebuilt`); // unreachable: DIMENSION_OPS and REBUILD agree
  return model.asOperation("set", [path, value], () => {
    model.rebuildRelation(name, entry.op, args, () => rebuild(model, args));
    return name;
  });
}

// --- deletion ---------------------------------------------------------------

/**
 * Deletes an entity, a relation or a feature by name, taking with it whatever
 * could not survive without it. Returns the names it removed, deletion order
 * first.
 *
 * The cascade is Onshape's, and deliberately so — people arrive knowing it:
 *
 * - a **relation** takes nothing else. Removing a constraint is the one
 *   deletion that cannot break anything: the drawing is simply freer.
 * - a **point** takes everything that references it — a line's endpoint, a
 *   circle's centre, an arc's centre/start/end — recursively, and then every
 *   relation naming any of them. The alternative is a line whose endpoint
 *   does not exist, which is not an over-constrained model the solver can
 *   complain about but a model that throws the next time it is drawn.
 * - a **line, circle or arc** takes the relations naming it and nothing more.
 *   Its points were the user's points first, and are usually still wanted.
 * - a **feature** takes what it made and never what it was built on; and
 *   anything a feature's record names takes the record with it — see
 *   `delOne`. Both are the same inward rule, read from the record's side.
 *
 * **The confirmation is undo, not a prompt.** `del` is one user action, so a
 * cascade that took more than was meant is one Ctrl+Z from harmless — the
 * pattern `open()` already set. That is also why the removed names are
 * returned rather than merely logged: "what did that just take with it" is a
 * question worth being able to answer afterwards.
 *
 * **Variables are tombstoned, not compacted.** A deleted point's variables
 * stay in the flat vector, referenced by nothing; the damped solve leaves
 * orphans exactly where they are, so they cost memory and not correctness.
 * Compaction means remapping every captured index list inside every closure —
 * real work with real risk, and the boring design ships first. The leak is
 * bounded by how much a session deletes, and a save/reopen does not shed it
 * either: replay re-runs the same creates and the same deletes.
 *
 * This is an *operation*, not a relation: it changes structure rather than
 * adding equations, and it can leave the model malformed if the cascade is
 * wrong. It is journalled as its **expansion** — one `deleteEntity` or
 * `deleteRelation` per name — rather than as the single `del` call, so a
 * replay removes exactly what was removed rather than recomputing a cascade
 * against a model that may since have been built differently.
 *
 * **Several names at once are one call and one cascade each, in order.**
 * `del("p1", "l5", …)` is what a box select naturally produces. Every name is
 * checked before anything is removed — a typo in the middle of a batch costs
 * nothing rather than half the batch — and a name an earlier cascade already
 * took is skipped silently: handing over a point and the line that depends on
 * it is the normal shape of a box-selected batch, not a mistake.
 */
export function del(model: Model, ...names: string[]): string[] {
  if (names.length === 0) throw new Error("del needs at least one name");
  // Validate every name before removing anything: a typo in the middle of a
  // box-selected batch should cost nothing, not leave half the batch gone.
  // (Undo would recover it, but an error that edits is still an error that
  // edits.)
  for (const n of names) {
    if (!model.has(n)) throw new Error(`"${n}" is not an entity or a relation (or a feature)`);
  }
  const removed: string[] = [];
  for (const n of names) {
    // An earlier name's cascade may already have taken this one — a box
    // select hands over a point *and* the line on it, and deleting the point
    // deletes the line. Already-gone is the cascade working, not an error.
    if (!model.has(n)) continue;
    removed.push(...delOne(model, n));
  }
  return removed;
}

/**
 * One name's cascade. A **feature** follows the same two rules, read the way a
 * relation reads them:
 *
 * - its record names everything it was built on and made (see `FeatureEntry`),
 *   so deleting any of those — a profile member, a twin, a wall, the depth —
 *   takes the **record**, exactly as deleting a point takes a relation naming
 *   it, and takes nothing else beyond the ordinary cascade. The lid, the walls
 *   and the depth are ordinary geometry and relations and stay as they are,
 *   drawn without faces; undo is the confirmation if that was not the intent.
 * - `del("e1")` takes the record **and what the feature made** — its twins,
 *   walls, top frame and depth, with whatever needs those — and never the
 *   profile it was built on, which was the user's sketch before the feature
 *   existed. Onshape's rule: deleting an extrude keeps its sketch.
 */
function delOne(model: Model, name: string): string[] {
  const feature = model.features.get(name);
  const owned = (pred: (n: string) => boolean) => (feature ? feature.owns.filter(pred) : []);
  const seeds = feature ? owned((n) => model.entities.has(n)) : model.entities.has(name) ? [name] : [];
  const asked = new Set(feature ? owned((n) => model.relations.has(n)) : model.relations.has(name) ? [name] : []);

  const doomed = entityClosure(model, seeds);
  // Every relation that names anything on the way out, plus the relations
  // asked for. "Names" goes through `referentOf`, so a frame referenced only by
  // an axis (`par("l1","f.x")`) still takes that relation with it — see
  // `Model.relationsNaming`.
  const relations = [...model.relations.values()]
    .filter((r) => asked.has(r.name) || r.args.some((a) => {
      const n = referentOf(a);
      return n !== null && doomed.has(n);
    }))
    .map((r) => r.name);
  // Every record naming anything on the way out — the inward rule — plus the
  // feature asked for.
  const going = new Set([...doomed, ...relations]);
  const features = [...model.features.values()]
    .filter((f) => f.name === name || f.names.some((n) => going.has(n)))
    .map((f) => f.name);

  const removed: string[] = [];
  // Records first, since they name relations and entities alike and the
  // primitives refuse while one does; then relations, since an entity cannot go
  // while something still constrains it.
  for (const f of features) {
    model.deleteFeature(f);
    removed.push(f);
  }
  for (const r of relations) {
    model.deleteRelation(r);
    removed.push(r);
  }
  // Then entities, dependents before the things they depend on. A pass at a
  // time rather than a hand-written order, so this stays right if an entity
  // kind that references another entity is ever added.
  const left = new Set(doomed);
  while (left.size) {
    const ready = [...left].filter((n) => model.dependents(n).length === 0);
    if (!ready.length) throw new Error(`cannot untangle the references around "${name}"`);
    for (const n of ready) {
      model.deleteEntity(n);
      removed.push(n);
      left.delete(n);
    }
  }
  return removed;
}

/**
 * The entities that cannot outlive `names`: themselves, whatever references
 * them, whatever references those, and so on. Several at once because a
 * feature's deletion starts from everything it made. In creation order, so the answer — and
 * therefore the journal a replay reads — does not depend on Set iteration
 * order of a worklist.
 *
 * Note the asymmetry that makes the cascade Onshape's rather than merely
 * transitive: it follows *references inward* (who needs me) and never outward
 * (what do I need). Deleting a line therefore reaches nothing, while deleting
 * one of its endpoints reaches the line.
 */
function entityClosure(model: Model, names: string[]): Set<string> {
  const found = new Set<string>();
  const queue = [...names];
  while (queue.length) {
    const n = queue.shift()!;
    if (found.has(n)) continue;
    found.add(n);
    for (const d of model.dependents(n)) queue.push(d.name);
  }
  const ordered = new Set<string>();
  for (const e of model.entities.values() as Iterable<Entity>) if (found.has(e.name)) ordered.add(e.name);
  return ordered;
}
