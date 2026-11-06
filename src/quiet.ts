// Quiet geometry: what the drawing leaves out until the hand is on it.
//
// The owner, 2026-11-03: "I think points ought to disappear when they are the
// endpoint of a line or a corner (except when you hover over them), and lines
// ought to disappear when they form the edge of a solid (except when you hover
// over them)." Every corner of a rectangle was a dot and a name; an extruded
// box had twelve edges inked over the face layer and eight corners labelled —
// noise over the one thing the eye wants, the shape. The corners and edges stay
// real, named entities (the register: they are what a relation on a solid
// holds, and what survives regeneration); they are only quiet.
//
// **Quiet is not hidden.** Nothing here reaches the pick, the snapper, box
// select or the drag — a quiet corner is hovered, clicked, snapped to and
// dragged exactly as a drawn one is, and the moment the hand is on it it is
// drawn. That is the whole difference from `hide` (groups.md), which takes a
// thing out of reach as well as out of sight.
//
// **Decided by geometric role alone** — never by what made a thing. The owner,
// asked whether a solid's corners should be treated differently: "why is a 3D
// corner any different from a 2D corner". A lid's corner and a sketch's corner
// are both ends of lines, and both are quiet for that reason and no other; a
// point a feature made that is no end (a revolve's end-frame reference point,
// an old file's lid frame's) is drawn as any isolated point is.
//
// - A **point** is quiet when it is an end of a line or an arc — a corner is
//   two ends at one point. A circle's or arc's centre stays drawn even when a
//   line also ends there: it is the only mark a curve's middle has, and the
//   spec keeps centres. Isolated points stay drawn.
// - A **line, arc or circle** is quiet when it bounds a solid's face — a whole
//   profile member, a twin, a wall — and that solid has faces on screen this
//   frame. The face layer draws the solid's fine edge line in its place
//   (facelayer.ts); a solid that cannot be laid out has no faces, and its edges
//   are drawn as before. A profile member that is a *portion* of a longer line
//   is not quiet: most of that line may lie off the solid.
// - **Frames are never quiet**: a marker is what says which way a frame faces.
// - **Only in the shaded view.** `view("hidden")` and `view("wire")` are the
//   modes for seeing everything, and draw everything.
//
// A quiet thing is drawn while it is **revealed**: hovered, lit by a hovered
// glyph, selected, the armed tool's snap target or what is under its cursor,
// or being dragged — and a revealed line or arc reveals its ends with it ("on
// hover the entity is drawn highlighted as now, with its ends").
//
// Pure functions of the model and three facts about the frame — whether the
// view is shaded, which solids have faces on screen, what is revealed — at
// glyphs.ts's height, so the draw pass and a unit test read one answer.

import { entityKind, type Model } from "./model.ts";

/** What the rule needs to know about this frame beyond the model. */
export interface QuietScene {
  /** Whether the rule applies: the shaded view. The hidden and wire views draw everything. */
  shaded: boolean;
  /** The features with faces on screen this frame — whose edges the face layer draws. */
  faced: ReadonlySet<string>;
  /**
   * The features of bodies the solid kernel builds (bodies.ts). Their twins
   * and walls are no edge of the solid any more — a cut crossed the lid, a boss
   * stands where a wall was — so they are quiet in **every** view, drawn only
   * when the hand is on them: still there to hover, drag and constrain (a lid
   * edge held by a relation keeps working), but never drawn as an edge the
   * body does not have. The kernel's own edges are the body's edges.
   */
  kernel?: ReadonlySet<string>;
}

/**
 * The entities that are quiet this frame, before anything is revealed — empty
 * outside the shaded view.
 */
export function quietEntities(model: Model, scene: QuietScene): Set<string> {
  const out = new Set<string>();
  for (const f of model.features.values()) {
    if (!scene.kernel?.has(f.name)) continue;
    for (const loop of f.twins) {
      for (const t of loop) {
        out.add(t);
        // The twin's own points too (a lid's corners, a twin circle's centre):
        // the hidden view draws points, and a through-cut's lid floats past the body.
        const e = model.entities.get(t);
        if (e?.kind === "line") for (const p of e.refs) out.add(p);
        else if (e?.kind === "arc") { out.add(e.start); out.add(e.end); out.add(e.center); }
        else if (e?.kind === "circle") out.add(e.center);
        else if (e?.kind === "ellipse") { out.add(e.center); out.add(e.major); }
        // A declared kind's points (a lid's spline: every one it runs through).
        else if (e && entityKind(e.kind)) for (const p of model.refsOf(e)) out.add(p);
      }
    }
    if (f.kind === "extrude") for (const w of f.walls) out.add(w);
  }
  if (!scene.shaded) return out;
  const centres = new Set<string>();
  for (const e of model.entities.values()) {
    if (e.kind === "line") for (const p of e.refs) out.add(p);
    else if (e.kind === "arc") { out.add(e.start); out.add(e.end); }
    // An ellipse's major end is on its rim, as an arc's ends are: quiet with
    // the edge it sits on. Its centre is kept, as a circle's is.
    else if (e.kind === "ellipse") out.add(e.major);
    // A declared open curve's ends (a spline's first and last points) are ends,
    // as a line's are. The points it bends through stay drawn: they are what
    // shapes it, the handles a hand reaches for, and no corner.
    else { const ends = entityKind(e.kind)?.ends?.(e); if (ends) for (const p of ends) out.add(p); }
    if (e.kind === "arc" || e.kind === "circle" || e.kind === "ellipse") centres.add(e.center);
  }
  for (const c of centres) out.delete(c);
  for (const n of solidEdges(model, scene.faced)) {
    out.add(n);
    // A declared curve that is a solid's edge (a spline's, or its lid twin's)
    // takes its points with it: they lie on the edge the face layer draws, and
    // a lid's were dots and names along a smooth rim (looked at,
    // docs/plans/spline.md). Revealed with the curve, as a line's ends are.
    const e = model.entities.get(n);
    if (e && entityKind(e.kind)?.ends) for (const p of model.refsOf(e)) out.add(p);
  }
  return out;
}

/**
 * A solid's own edges: every whole profile member, every twin, every wall line
 * — of the features named, or of every feature. A member that is a portion of
 * its entity is left out.
 */
export function solidEdges(model: Model, features?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const f of model.features.values()) {
    if (features && !features.has(f.name)) continue;
    for (const loop of f.loops) for (const m of loop) if (typeof m === "string") out.add(m);
    for (const loop of f.twins) for (const t of loop) out.add(t);
    if (f.kind === "extrude") for (const w of f.walls) out.add(w);
  }
  return out;
}

/**
 * What `names` reveals: the names themselves, the ends (and centre) of every
 * line or arc among them, and a circle's centre — so a hovered edge is drawn
 * with its corners, and a hovered glyph's lines with theirs. A name the model
 * does not hold as an entity (a relation's) is kept and harmless: only entity
 * names are ever asked about.
 */
export function revealed(model: Model, names: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const n of names) {
    out.add(n);
    const e = model.entities.get(n);
    if (!e) continue;
    if (e.kind === "line") for (const p of e.refs) out.add(p);
    else if (e.kind === "arc") { out.add(e.start); out.add(e.end); out.add(e.center); }
    else if (e.kind === "circle") out.add(e.center);
    else if (e.kind === "ellipse") { out.add(e.center); out.add(e.major); }
    else if (entityKind(e.kind)) for (const p of model.refsOf(e)) out.add(p);
  }
  return out;
}

/** Whether an entity is drawn this frame, as far as quiet goes: not quiet, or revealed. */
export function drawn(name: string, quiet: ReadonlySet<string>, shown: ReadonlySet<string>): boolean {
  return !quiet.has(name) || shown.has(name);
}

/**
 * Whether the entity pass draws an entity this frame: not hidden (`hide`,
 * groups.ts), and then `drawn`. **Hidden outranks revealed** — a reveal brings
 * back what is quiet, never what the user hid. Nothing hidden picks, so it is
 * never hovered; but a selection, a snap or a drag made before the `hide` must
 * not bring it back for a frame either.
 */
export function entityDrawn(model: Model, name: string, quiet: ReadonlySet<string>, shown: ReadonlySet<string>): boolean {
  return !model.hidden.has(name) && drawn(name, quiet, shown);
}

/** What the glyph rule needs of a glyph — glyphs.ts's `Glyph` has it. */
export interface Anchored {
  relation: string;
  /** The entities its anchor is on. */
  about: string[];
  /** A dimension's value: always drawn. */
  isLabel: boolean;
}

/**
 * Whether a constraint glyph is drawn. **A glyph follows its anchor**: one on
 * quiet geometry is quiet with it, and drawn while any entity it is on is
 * drawn — revealed, or not quiet at all. **Dimensions are always drawn**: they
 * are the values the user edits (`set`, the menu's Set value). A glyph that is
 * itself hovered is drawn, because a quiet glyph is still picked, as a quiet
 * point is — and has to be: a line picks five pixels out and a glyph's box
 * starts seven out, so a glyph that could not be hovered while quiet could
 * never be reached from the line it is on.
 */
export function glyphDrawn(gl: Anchored, quiet: ReadonlySet<string>, shown: ReadonlySet<string>,
                           hovered: string | null): boolean {
  if (gl.isLabel || gl.relation === hovered || gl.about.length === 0) return true;
  return gl.about.some((n) => drawn(n, quiet, shown));
}
