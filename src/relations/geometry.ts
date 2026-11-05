// The rest of the sketch relation vocabulary, past the point/distance
// starter set in basic.ts. Same shape as everything there: each function
// takes the model plus some entity names, and adds one residual block whose
// value is zero exactly when the relation holds. Nothing here is privileged
// over a relation someone writes at the REPL — these are just the ones worth
// shipping in the box.
//
// Most of these are dimension-generic, and not by accident: written in terms
// of `dot` and `wedge` (see vec.ts) the definitions that people think of as
// 2D turn out to hold unchanged in any dimension. "Parallel" is "the wedge
// vanishes" whether that wedge has one component or three. Where a relation
// is genuinely 2D-only it says so and throws, rather than pretending. The
// frame-axis references below follow the frame they name: `"f1.x"` and
// `"f1.y"` in 2D or 3D, `"f1.z"` only in 3D, since a 2D frame has no z — while
// the relations taking them are generic, with the wedge simply growing from one
// component to three.

import type { Model } from "../model.ts";
import type { Dual } from "../kernel/dual.ts";
import { dot, norm, vecSub, wedge, wedgeNorm } from "./vec.ts";
import { chunk, curveNormal, directionOf, directionOfPoints, joinVars, lineVars, unitDuals, type DirectionRef } from "./refs.ts";
import { coincident, onPlane } from "./basic.ts";

// --- the direction relations -----------------------------------------------
//
// `par`, `perp` and `ang` are the relations that read their arguments for a
// *direction* and for nothing else, which is exactly the set that can take a
// **frame-axis reference** — `"f1.x"`, `"f1.y"`, and in 3D `"f1.z"` — beside an
// ordinary line.
// That is where `hor` and `ver` went: `par("l1", "f1.y")` is "vertical", and
// nothing in the vocabulary implies a privileged pair of directions any more.
//
// The rule is worth stating as a rule, because it is what settles the ones
// that do *not* take an axis reference. An axis is a direction and no more —
// it has no length and no position — so:
//
//   * `eq` is excluded: an axis has no length to be equal to.
//   * `on` and `sym` are excluded: both need a *located* line, not a
//     direction. "This point lies on the frame's x axis" is a real thing to
//     want, and `fix(p, [t, 0])` already says it against a frame that has an
//     origin; reading `"f1.x"` as a line through the origin here would give
//     one syntax two meanings.
//   * `tan` is excluded for the same reason `on` is — the line side of a
//     tangency is a place, not a heading.
//
// `ang` is *included*, and it is the strongest case of the three: "this edge
// at 30° to the frame" is what a draughtsman means by an angle far more often
// than "30° between these two edges", and the residual reads its second
// argument for a direction and a length that is 1 by construction.

/**
 * Which two directions a call meant, and the argument list to journal for it.
 *
 * One string argument after the subject is ambiguous on its face — second
 * point, or the other side? The model settles it on the subject's *kind*,
 * exactly as `hor`/`ver` used to: only the point form takes a second point, so
 * whatever follows a line name can only be the thing it is relative to.
 */
function directionSides(model: Model, op: string, a: string, b: string, c?: string | null):
  { u: DirectionRef; v: DirectionRef; args: string[] } {
  const sides = (): { u: DirectionRef; v: DirectionRef; args: string[] } => {
    if (model.entities.get(a)?.kind === "point") {
      if (b == null || c == null) {
        throw new Error(`"${a}" is a point: give the second point and what the pair is relative to`);
      }
      return { u: directionOfPoints(model, a, b), v: directionOf(model, c), args: [a, b, c] };
    }
    if (c != null) throw new Error(`"${a}" is not a point, so this takes two references, not three`);
    return { u: directionOf(model, a), v: directionOf(model, b), args: [a, b] };
  };
  const made = sides();
  // Two frame axes are two datums, and a datum is read and never pushed — so
  // the residual would declare no variables at all and the solver would have
  // nothing it could move to satisfy it. Refused rather than added as a
  // constraint that silently either holds already or never can.
  if (made.u.frame && made.v.frame) {
    throw new Error(`${op} needs something it can move: "${a}" and "${made.args.at(-1)}" are both datums (a frame's axis, a plane's normal)`);
  }
  return made;
}

/**
 * The shared body of `parallel` and `perpendicular`: read two directions and
 * say how they must relate.
 *
 * Parallel is "the wedge vanishes", perpendicular is "the dot vanishes" — both
 * linear in each input and well clear of being a square, whose gradient would
 * vanish at its own root.
 */
function directionRelation(
  model: Model, op: string, tag: string,
  a: string, b: string, c: string | null | undefined,
  residual: (u: Dual[], v: Dual[]) => Dual[],
): string {
  const { u, v, args } = directionSides(model, tag, a, b, c);
  return model.relation(op, args, () => {
    model.addResidual(joinVars(u.vars, v.vars), (l) =>
      residual(u.direction(l.slice(0, u.width)), v.direction(l.slice(u.width))),
    `${tag}(${args.join(",")})`);
  });
}

/**
 * Two directions point the same way (or exactly opposite): their wedge
 * vanishes. Each side is a line or a frame axis (`par("l1", "f1.x")`), and the
 * first may instead be a pair of points (`par("p1", "p3", "f1.x")`).
 */
export function parallel(model: Model, l1: string, l2: string, l3?: string | null): string {
  return directionRelation(model, "parallel", "par", l1, l2, l3, (u, v) => wedge(u, v));
}

/**
 * Two directions are at a right angle: their dot product vanishes. Same three
 * forms as `parallel`.
 */
export function perpendicular(model: Model, l1: string, l2: string, l3?: string | null): string {
  return directionRelation(model, "perpendicular", "perp", l1, l2, l3, (u, v) => [dot(u, v)]);
}

/**
 * The angle between two directions, in radians. Unsigned — this is the angle
 * between them as undirected lines would have it, because a *signed* angle
 * needs an orientation, which only exists in 2D. Stated as u·v = |u||v|cos(θ)
 * rather than by taking an arccos, so the residual stays smooth everywhere
 * including at 0 and π.
 *
 * Either side may be a frame axis, which is how "this edge sits at 30° to the
 * frame" is written. There is deliberately **no point-pair form**: the
 * trailing numeric target would have to be told apart from a third name by
 * arity alone, and `hor`/`ver` never offered an angle either — a form nobody
 * has asked for is not worth an ambiguity.
 */
export function angle(model: Model, l1: string, l2: string, radians: number): string {
  const u = directionOf(model, l1), v = directionOf(model, l2);
  if (u.frame && v.frame) {
    throw new Error(`ang needs something it can move: "${l1}" and "${l2}" are both frame axes`);
  }
  return model.relation("angle", [l1, l2, radians], () => {
    const target = Math.cos(radians);
    model.addResidual(joinVars(u.vars, v.vars), (l) => {
      const du = u.direction(l.slice(0, u.width)), dv = v.direction(l.slice(u.width));
      return [dot(du, dv).sub(norm(du).mul(norm(dv)).mul(target))];
    }, `ang(${l1},${l2})`);
  });
}

/** A point lies somewhere on the infinite line through a line's two endpoints. */
export function pointOnLine(model: Model, pointName: string, lineName: string): string {
  return model.relation("pointOnLine", [pointName, lineName], () => {
    const p = model.point(pointName);
    const dim = model.dim;
    model.addResidual(joinVars(p.varIndices, lineVars(model, lineName)), (l) => {
      const [q, a, b] = chunk(l, dim, 3);
      return wedge(vecSub(q, a), vecSub(b, a));
    }, `on(${pointName},${lineName})`);
  });
}

/**
 * Two things are the same size: two lines the same length — and, since the
 * sketch-relations package, two circles or arcs (any mix) the same radius,
 * which is `eqrad` under the name a person reaches for, and a line and an arc
 * the same length (the arc's length along its sweep, r·θ). Journalled as
 * `equalLength` whatever it relates, so one name replays every form.
 */
export function equalLength(model: Model, l1: string, l2: string): string {
  const kind = (n: string) => model.entities.get(n)?.kind;
  const curve = (n: string) => kind(n) === "circle" || kind(n) === "arc";
  if (curve(l1) && curve(l2)) {
    return model.relation("equalLength", [l1, l2], () => {
      const a = model.circular(l1), b = model.circular(l2);
      model.addResidual([a.radiusVar, b.radiusVar], (l) => [l[0].sub(l[1])], `eq(${l1},${l2})`);
    });
  }
  if ((kind(l1) === "arc" && kind(l2) === "line") || (kind(l1) === "line" && kind(l2) === "arc")) {
    return equalArcLength(model, l1, l2);
  }
  return model.relation("equalLength", [l1, l2], () => {
    const dim = model.dim;
    model.addResidual(joinVars(lineVars(model, l1), lineVars(model, l2)), (l) => {
      const [a, b, c, d] = chunk(l, dim, 4);
      return [norm(vecSub(b, a)).sub(norm(vecSub(d, c)))];
    }, `eq(${l1},${l2})`);
  });
}

/**
 * A line as long as an arc: |b − a| = r·θ, θ the arc's sweep from its start to
 * its end, counter-clockwise about its normal (arcgeom.ts's convention — about
 * +z in 2D), in (0, 2π].
 *
 * The sweep is `atan2` of the two radii's wedge along the normal against their
 * dot — smooth everywhere but where it wraps, which is an arc of nothing or of
 * a whole turn, neither of which has a length worth equalling. Dimension-
 * generic as far as an arc has an orientation: 2D reads +z, 3D the arc's own
 * normal (declared, so a free arc turns); above 3D there is no "counter-
 * clockwise" and it refuses.
 */
function equalArcLength(model: Model, l1: string, l2: string): string {
  const [lineName, arcName] = model.entities.get(l1)?.kind === "line" ? [l1, l2] : [l2, l1];
  if (model.dim > 3) throw new Error(`eq between a line and an arc needs an orientation, which a ${model.dim}D arc has not`);
  return model.relation("equalLength", [l1, l2], () => {
    const dim = model.dim;
    model.arc(arcName);
    const arcVars = () => {
      const a = model.arc(arcName);
      return [...model.point(a.center).varIndices, ...model.point(a.start).varIndices,
        ...model.point(a.end).varIndices, a.radiusVar, ...(a.normal ?? [])];
    };
    model.addResidual(joinVars(lineVars(model, lineName), arcVars), (l) => {
      const [p, q, c, s, e] = chunk(l, dim, 5);
      const r = l[5 * dim];
      const u = vecSub(s, c), v = vecSub(e, c);
      let across: Dual;
      if (dim === 2) {
        across = wedge(u, v)[0];
      } else {
        const n = unitDuals(l.slice(5 * dim + 1, 5 * dim + 4));
        const x = [u[1].mul(v[2]).sub(u[2].mul(v[1])), u[2].mul(v[0]).sub(u[0].mul(v[2])), u[0].mul(v[1]).sub(u[1].mul(v[0]))];
        across = dot(n, x);
      }
      let sweep = across.atan2(dot(u, v));
      if (sweep.val <= 0) sweep = sweep.add(2 * Math.PI);
      return [norm(vecSub(q, p)).sub(r.mul(sweep))];
    }, `eq(${l1},${l2})`);
  });
}

// --- the sketch relations (docs/plans/sketch-relations.md) ----------------

/**
 * Two lines lie on one infinite line: both of the second's ends on the first's
 * line — which is `par` plus an end `on`, said as one relation with one glyph.
 * Two blocks, the wedge of each of the second's ends against the first's
 * direction; both lazy, so the relation follows an edge a fillet re-points.
 * Every component is linear in each end and none is a square, in any
 * dimension.
 */
export function collinear(model: Model, l1: string, l2: string): string {
  if (l1 === l2) throw new Error(`collinear needs two lines: ${l1} twice is one`);
  return model.relation("collinear", [l1, l2], () => {
    const dim = model.dim;
    const vars = joinVars(lineVars(model, l1), lineVars(model, l2));
    for (const [end, tag] of [[2, "start"], [3, "end"]] as const) {
      model.addResidual(vars, (l) => {
        const pts = chunk(l, dim, 4);
        return wedge(vecSub(pts[end], pts[0]), vecSub(pts[1], pts[0]));
      }, `col(${l1},${l2})|${tag}`);
    }
  });
}

/** The relation that holds `p` on `curve` — `on` for a line, `oncircle` for a circle or an arc — nested. */
function onCurve(model: Model, p: string, curve: string): void {
  const k = model.entities.get(curve)?.kind;
  if (k === "line") pointOnLine(model, p, curve);
  else if (k === "circle" || k === "arc") onCircle(model, p, curve);
  else throw new Error(`"${curve}" is not a line, circle or arc`);
}

/**
 * A point held where two curves cross: on both — `on` for a line, `oncircle`
 * for a circle or an arc — as one relation. What the line tool's crossing snap
 * has always applied as two relations, said as one that can be typed, deleted
 * and seen as one glyph; the relation the trim and extend operations lean on.
 * Two curves cross at up to two points; the solve keeps the one the point is
 * nearer, as every relation with branches here does.
 */
export function intersection(model: Model, p: string, c1: string, c2: string): string {
  if (c1 === c2) throw new Error(`intersection needs two curves: ${c1} twice is one`);
  model.point(p);
  return model.relation("intersection", [p, c1, c2], () => {
    onCurve(model, p, c1);
    onCurve(model, p, c2);
  });
}

/**
 * A sketch point where a curve pierces the sketch plane: on the curve, and on
 * the plane (`onplane`) — the drawing plane when none is named, resolved now
 * and journalled resolved, as `onplane` is. 3D only: in 2D every curve lies in
 * the one plane there is, and the relation would be `on` with a lie attached.
 * A line through the plane pierces it once; a circle twice, and the solve
 * keeps the nearer.
 */
export function pierce(model: Model, p: string, curve: string, planeName?: string | null): string {
  if (model.dim !== 3) throw new Error("pierce needs a 3D model — in 2D every curve already lies in the sketch's plane");
  model.point(p);
  const plane = planeName ?? model.drawingPlane();
  model.planeKind(plane);
  return model.relation("pierce", [p, curve, plane], () => {
    onCurve(model, p, curve);
    onPlane(model, p, plane);
  });
}

/**
 * Three or more points evenly spaced: each gap |pᵢ₊₁ − pᵢ| equal to the first.
 * Distances minus distances, never a square; says nothing about the points
 * being in a line — that is `on`, or `collinear` of the lines between them.
 */
export function equalSpacing(model: Model, ...points: string[]): string {
  if (points.length < 3) throw new Error(`equalSpacing needs three points or more, not ${points.length}`);
  if (new Set(points).size !== points.length) throw new Error("equalSpacing needs each point once");
  return model.relation("equalSpacing", points, () => {
    const vars = points.map((p) => model.point(p).varIndices);
    const dim = model.dim;
    for (let i = 1; i + 1 < points.length; i++) {
      model.addResidual([...vars[0], ...vars[1], ...vars[i], ...vars[i + 1]], (l) => {
        const [a, b, c, d] = chunk(l, dim, 4);
        return [norm(vecSub(d, c)).sub(norm(vecSub(b, a)))];
      }, `spacing(${points[i]},${points[i + 1]})`);
    }
  });
}

/** Pins a circle's (or arc's) diameter to a number: 2r = target. A dimension, `d`-named and settable, drawn `⌀24`. */
export function diameter(model: Model, circleName: string, target: number): string {
  return model.relation("diameter", [circleName, target], () => {
    const c = model.circular(circleName);
    model.addResidual([c.radiusVar], (l) => [l[0].mul(2).sub(target)], `dia(${circleName})`);
  });
}

// --- circles and arcs ------------------------------------------------------
// Every one of these reads the entity through model.circular(), so it accepts
// a circle or an arc interchangeably — the two differ only in whether they
// also name a start and end point. In 3D both carry a plane (see
// `CircleEntity`), and the two relations that are claims about the *rim* —
// `onCircle` and `tangent` — read it; the ones about centre and radius alone
// (`rad`, `conc`, `eqrad`) have no reason to.

/** Pins a circle's (or arc's) radius to a number. */
export function radius(model: Model, circleName: string, target: number): string {
  return model.relation("radius", [circleName, target], () => {
    const c = model.circular(circleName);
    model.addResidual([c.radiusVar], (l) => [l[0].sub(target)], `rad(${circleName})`);
  });
}

/**
 * The signed distance of a point off a rim's plane — the plane through the
 * centre square to `n`, the curve's own normal, already normalised
 * (`unitDuals`). All three as Duals: the point, the centre and the normal are
 * all geometry the solver may move. Linear in the point and the centre and
 * scale-free in the normal, and not a square: its gradient is the normal
 * itself all the way down to the root.
 */
function offRim(q: Dual[], ctr: Dual[], n: Dual[]): Dual {
  let acc = q[0].sub(ctr[0]).mul(n[0]);
  for (let k = 1; k < q.length; k++) acc = acc.add(q[k].sub(ctr[k]).mul(n[k]));
  return acc;
}

/**
 * A point sits on a circle's rim: its distance from the center equals the
 * radius — and, in 3D, it lies in the rim's plane.
 *
 * In 3D a circle carries its own normal (see `CircleEntity`), and "on the
 * circle" without it would be "on the sphere": a whole surface where a
 * sketcher means a curve. So a 3D `onCircle` is **two** blocks: the distance,
 * exactly as ever, and the point's signed distance off the plane through the
 * centre square to the circle's normal, `(p − centre) · n̂`. The normal is
 * declared with the rest (`curveNormal`), so a circle nothing holds level
 * turns to meet the point — it used to be read off a frame as a datum, which
 * no circle has any more. The second block is its own block, not a second row
 * of the first, so an offender report names `oncircle(p,c)|plane` when that is
 * what fails.
 *
 * In 2D the second block would be trivially zero, and it is **not emitted**:
 * a 2D `onCircle` is exactly the one block it always was, value for value —
 * the suite pins that by block count.
 */
export function onCircle(model: Model, pointName: string, circleName: string): string {
  return model.relation("onCircle", [pointName, circleName], () => {
    const p = model.point(pointName);
    const c = model.circular(circleName);
    const center = model.point(c.center);
    const dim = model.dim;
    model.addResidual([...p.varIndices, ...center.varIndices, c.radiusVar], (l) => {
      const [q, ctr] = chunk(l, dim, 2);
      return [norm(vecSub(q, ctr)).sub(l[2 * dim])];
    }, `oncircle(${pointName},${circleName})`);
    const normal = curveNormal(model, circleName);
    if (normal) {
      model.addResidual(joinVars(p.varIndices, center.varIndices, normal), (l) => {
        const [q, ctr, n] = chunk(l, dim, 3);
        return [offRim(q, ctr, unitDuals(n))];
      }, `oncircle(${pointName},${circleName})|plane`);
    }
  });
}

/**
 * Two circles/arcs share a center.
 *
 * Defined in terms of `coincident`, and *one* relation all the same: the inner
 * call's blocks join this entry rather than registering separately, so `del`
 * on the concentricity takes exactly what the concentricity added. (It also
 * stops the inner call journalling itself, which used to make a reopened file
 * carry the coincidence twice.)
 */
export function concentric(model: Model, c1: string, c2: string): string {
  return model.relation("concentric", [c1, c2], () => {
    coincident(model, model.circular(c1).center, model.circular(c2).center);
  });
}

/** Two circles/arcs have the same radius. */
export function equalRadius(model: Model, c1: string, c2: string): string {
  return model.relation("equalRadius", [c1, c2], () => {
    const a = model.circular(c1), b = model.circular(c2);
    model.addResidual([a.radiusVar, b.radiusVar], (l) => [l[0].sub(l[1])], `eqrad(${c1},${c2})`);
  });
}

/**
 * Tangency: a line touches a circle, or two circles touch.
 *
 * **A line and a circle** (either order): the perpendicular distance from the
 * center to the infinite line equals the radius. That distance is the wedge
 * norm over the direction length — |(ctr-a) ^ u| / |u| — which is smooth here
 * because a tangent line never passes *through* the center (the wedge only
 * vanishes when the distance is 0, and the radius is positive).
 *
 * **Two circles** (or arcs, or one of each — `model.circular` reads both): the
 * distance between the centres is the sum of the radii when they touch from
 * outside, the difference when one is inside the other. Which of the two is
 * part of what was meant, so it is part of the relation — `side`, `"outside"`
 * or `"inside"` — and when it is left out it is read off the drawing as it
 * stands, whichever the two are nearer, and **journalled as read**: a file
 * replays the side that was chosen, not a fresh guess at a moment the values
 * may not yet be what they were. Both are distances minus distances, linear in
 * the radii and never a square; the difference is taken whole (|r₁ − r₂|), so
 * "inside" does not need to know which circle is the bigger, and is only
 * unsmooth where the two radii are equal — concentric equal circles, where an
 * inside tangency has no meaning to be smooth about.
 *
 * **In 3D a tangent line lies in the circle's plane.** It touches the rim at
 * one point and runs along the rim's own direction there, both of which are in
 * the plane — so a 3D `tangent` adds a second block holding both of the line's
 * ends on the plane through the centre square to the circle's own normal
 * (declared, as for `onCircle`, so a free circle turns with its tangents — a
 * fillet's arc follows its corner this way and needs no plane given). Without it the distance block alone would
 * describe a line tangent to a *sphere*, free to swing round the centre. **Two
 * tangent circles likewise share a plane**: the second's centre on the first's
 * plane, and their normals parallel (the wedge of the two unit normals, as
 * `par` says it) — without which two touching circles could be any two rings
 * that meet at a point, crossed like a gyroscope's. In 2D the plane block is
 * trivially zero and is not emitted; the 2D relation is the one block it always
 * was. The line is still read lazily, so the plane block follows an edge a
 * fillet re-points.
 */
export function tangent(model: Model, a: string, b: string, side?: string | null): string {
  const kind = (n: string) => model.entities.get(n)?.kind;
  const isCurve = (n: string) => kind(n) === "circle" || kind(n) === "arc";
  if (isCurve(a) && isCurve(b)) return tangentCircles(model, a, b, side);
  if (side != null) throw new Error(`tan takes a side ("outside" or "inside") only between two circles — ${a} and ${b} are not both`);
  // The line first or second, as typed: `tan("c1", "l1")` is the same relation,
  // journalled as it was called.
  const [lineName, circleName] = kind(a) === "line" || !isCurve(a) ? [a, b] : [b, a];
  return model.relation("tangent", [a, b], () => {
    const c = model.circular(circleName);
    const center = model.point(c.center);
    const dim = model.dim;
    // Which of the line's ends is one of the arc's, read at every evaluation
    // (the line can be re-pointed under it): 0 or 1, or -1 for none.
    const shared = (): number => {
      if (kind(circleName) !== "arc") return -1;
      const arc = model.arc(circleName), refs = model.line(lineName).refs;
      return refs.findIndex((r) => r === arc.start || r === arc.end);
    };
    model.addResidual(joinVars(lineVars(model, lineName), center.varIndices, [c.radiusVar]), (l) => {
      const [p, q, ctr] = chunk(l, dim, 3);
      const u = vecSub(q, p);
      // **At a shared end, the join**: the radius to that end square to the
      // line, (end − centre) · (q − p) = 0 — a smooth join, Onshape's tangent
      // arc. The distance form below is a *double* root there (the line
      // touches the circle where the arc's own end already holds it to the
      // rim), so its gradient vanishes at its own root: the solve crept to
      // within √tolerance of the join and the rank analysis read the joint
      // as free. This one crosses zero cleanly. Either way the arc is
      // tangent to the line; which side it leaves on is kept by the seed.
      const at = shared();
      if (at >= 0) return [dot(vecSub(at === 0 ? p : q, ctr), u)];
      return [wedgeNorm(vecSub(ctr, p), u).div(norm(u)).sub(l[3 * dim])];
    }, `tan(${a},${b})`);
    const normal = curveNormal(model, circleName);
    if (normal) {
      model.addResidual(joinVars(lineVars(model, lineName), center.varIndices, normal), (l) => {
        const [p, q, ctr, raw] = chunk(l, dim, 4);
        const n = unitDuals(raw);
        return [offRim(p, ctr, n), offRim(q, ctr, n)];
      }, `tan(${a},${b})|plane`);
    }
  });
}

/** The sides two circles can touch on. */
const SIDES = ["outside", "inside"] as const;

function tangentCircles(model: Model, a: string, b: string, given?: string | null): string {
  if (a === b) throw new Error(`tan needs two circles: ${a} twice is one`);
  const ca = model.circular(a), cb = model.circular(b);
  let side = given;
  if (side == null) {
    // Read off the drawing: whichever way of touching it is nearer now.
    const d = Math.hypot(...model.coords(ca.center).map((v, i) => v - model.coords(cb.center)[i]));
    const ra = model.radius(a), rb = model.radius(b);
    side = Math.abs(d - (ra + rb)) <= Math.abs(d - Math.abs(ra - rb)) ? "outside" : "inside";
  }
  if (!(SIDES as readonly string[]).includes(side)) {
    throw new Error(`tan's side between two circles is "outside" or "inside", not ${JSON.stringify(side)}`);
  }
  const inside = side === "inside";
  return model.relation("tangent", [a, b, side], () => {
    const pa = model.point(ca.center), pb = model.point(cb.center);
    const dim = model.dim;
    // The end two arcs share, read at every evaluation — or null.
    const joint = (): string | null => {
      if (dim > 3) return null;
      const ea = model.entities.get(a), eb = model.entities.get(b);
      if (ea?.kind !== "arc" || eb?.kind !== "arc") return null;
      return [ea.start, ea.end].find((n) => n === eb.start || n === eb.end) ?? null;
    };
    const normalA = curveNormal(model, a);
    const vars = () => {
      const s = joint();
      return [...pa.varIndices, ...pb.varIndices, ca.radiusVar, cb.radiusVar,
        ...model.point(s ?? ca.center).varIndices, ...(normalA ? normalA() : [])];
    };
    model.addResidual(vars, (l) => {
      const [p, q] = chunk(l, dim, 2);
      const ra = l[2 * dim], rb = l[2 * dim + 1];
      // **At a shared end, the join**: the two centres and the end in one line
      // — in 2D their wedge, in 3D its component along the first arc's normal
      // (the |plane block below puts both in one plane). The distance form is
      // a double root there, for `tan(line, arc)`'s reason: with the end
      // already on both rims, |p − q| = ra ± rb is the triangle inequality's
      // boundary, and its gradient vanishes at its own root. `side` is then
      // whichever way the arcs were drawn, held by the seed.
      if (joint() !== null) {
        const s = l.slice(2 * dim + 2, 3 * dim + 2);
        const u = vecSub(s, p), v = vecSub(q, p);
        if (dim === 2) return [wedge(u, v)[0]];
        const n = unitDuals(l.slice(3 * dim + 2, 3 * dim + 5));
        const x = [u[1].mul(v[2]).sub(u[2].mul(v[1])), u[2].mul(v[0]).sub(u[0].mul(v[2])), u[0].mul(v[1]).sub(u[1].mul(v[0]))];
        return [dot(n, x)];
      }
      const d = norm(vecSub(p, q));
      return [inside ? d.sub(ra.sub(rb).abs()) : d.sub(ra.add(rb))];
    }, `tan(${a},${b})`);
    const na = curveNormal(model, a), nb = curveNormal(model, b);
    if (na && nb) {
      model.addResidual(joinVars(pa.varIndices, pb.varIndices, na, nb), (l) => {
        const [p, q, rawA, rawB] = chunk(l, dim, 4);
        const ua = unitDuals(rawA), ub = unitDuals(rawB);
        return [offRim(q, p, ua), ...wedge(ua, ub)];
      }, `tan(${a},${b})|plane`);
    }
  });
}

// --- symmetry --------------------------------------------------------------

/**
 * Two points are mirror images across a line: their midpoint lies on the
 * line, and the segment joining them is perpendicular to it. Those two
 * conditions together are the mirror in 2D — and in 3D they are exactly a
 * half-turn about the line, which is the same relation one dimension up,
 * so this stays generic rather than being marked 2D-only.
 */
export function symmetric(model: Model, aName: string, bName: string, lineName: string): string {
  return model.relation("symmetric", [aName, bName, lineName], () => {
    const a = model.point(aName), b = model.point(bName);
    const dim = model.dim;
    const varIndices = joinVars(a.varIndices, b.varIndices, lineVars(model, lineName));

    model.addResidual(varIndices, (l) => {
      const [p, q, s, e] = chunk(l, dim, 4);
      const mid = p.map((pi, i) => pi.add(q[i]).div(2));
      return wedge(vecSub(mid, s), vecSub(e, s));
    }, `sym(${aName},${bName},${lineName})|mid`);

    model.addResidual(varIndices, (l) => {
      const [p, q, s, e] = chunk(l, dim, 4);
      return [dot(vecSub(q, p), vecSub(e, s))];
    }, `sym(${aName},${bName},${lineName})|perp`);
  });
}

// --- arcs ------------------------------------------------------------------

/**
 * What makes an arc's endpoints *its* endpoints: both lie on its circle.
 * Not applied by Model.addArc for the same reason a Line implies no relation
 * of its own — the model holds structure, relations hold equations — so a
 * tool that creates an arc calls this straight after.
 */
export function arcEndpoints(model: Model, arcName: string): string {
  return model.relation("arcEndpoints", [arcName], () => {
    const a = model.arc(arcName);
    onCircle(model, a.start, arcName);
    onCircle(model, a.end, arcName);
  });
}
