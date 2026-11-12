// Sketch mode: choose a plane, and everything drawn after is held on it
// (docs/plans/sketch-mode.md; the owner: *"I need a way to natively sketch on a
// plane without it being a special feature. It should just add 'on plane'
// relations to each entity as it gets sketched. Also when I select this mode
// it should go normal to the plane/face."*).
//
// **Sketch mode is a mode, not a feature.** It is the work plane set — a plane
// reference held as document state, `workplane(…)`, which makes nothing
// (docs/plans/frameless-curves.md) — the view turned square to it, and every
// drawing tool holding each point it makes on it with one ordinary `onPlane`
// (tools/place.ts). The chip says where (`on e1's top`), its ⟂ looks at the
// plane again, its Done (or Escape with nothing in hand) leaves it.
//
// **What this tool picks**, nearest first, as the extrude tool's gesture is:
//
//   * **a face**: a loop under the cursor (`regionAt`: the innermost loop under
//     the click, then the nearest) — a solid's lid, a wall turned toward the
//     viewer, a revolve's end face and a plain sketch loop alike; three of its
//     own points, ordered so the plane's normal faces the viewer (out of a
//     solid, see ../sketchface.ts), or a round face's own circle. Held by the
//     feature's points, so it follows the solid;
//   * **a flat face the kernel made** that no loop bounds — a chamfer's — by a
//     frame made at it (../kernelplane.ts): a plain frame, not a feature, and
//     one that stays where the face was when it was picked;
//   * **the ground's named planes**, Top, Front and Right (workplane.ts's
//     `NAMED_PLANES`), drawn as faint patches while the tool is armed and
//     picked inside them — and offered as buttons in the options panel, since
//     in the view a fresh document starts in shows only Top face-on;
//   * armed **with a selection**: a face selected on the canvas, a frame, or
//     three points — at once, as there is nothing to preview or confirm.
//
// **The commit is `workplane(…)`, typed** — through the command machinery
// (`ctx.run`) rather than the model, because the camera is not the model's and
// `workplane` already knows how to turn it: so the log shows the call, the
// journal holds what the typed call journals, and it is one undo step, all
// because it *is* the typed call. The "Sketch on this face" menu item types the
// same line for a face.
//
// While it is armed every face it could take is lit faintly, as the extrude
// tool lights its regions, and so are the named planes; a click on none of them
// is answered with guidance, muted, never red — and the tool stays armed.

import { Tool, press, type Hand, type PointerInfo, type RegionHit, type RenderContext } from "./tool.ts";
import { REGION_GREEN, drawRegion, lightRegions, missedRegion, regionKey } from "./region.ts";
import type { OptionSpecs } from "./options.ts";
import type { Model } from "../model.ts";
import { sketchOnFaceCommand } from "../sketchface.ts";
import { refind } from "./selection.ts";
import { loopAround } from "../loops.ts";
import { kernelFacePlane, kernelPlaneCommand } from "../kernelplane.ts";
import { NAMED_PLANES } from "../workplane.ts";
import { cross3, dot3, lift3, sub3 } from "../vec3.ts";

type Named = keyof typeof NAMED_PLANES;

/** How far, at the least, a named plane's patch reaches from the origin each way, in pixels on screen — enough to aim at in any zoom. */
const PATCH_PX = 90;
/** How much further than the drawing's farthest point from the origin a patch reaches, so the patch is round the drawing, not under it. */
const PATCH_PAD = 1.15;
/**
 * A named plane seen more nearly edge-on than this (the cosine between its
 * normal and the line of sight) is not offered in the view: a sliver is not
 * something to aim at. Front and Right are edge-on in the top view a fresh
 * document opens in, which is why the options panel lists them too.
 */
const EDGE_ON = 0.2;

/** What is under the cursor, as this tool reads it. */
type Under =
  | { kind: "face"; hit: RegionHit }
  | { kind: "kernel"; command: string; outline: number[][] }
  | { kind: "named"; plane: Named };

export class SketchTool extends Tool {
  static readonly summary = "Sketch on a face or Top, Front, Right: all you draw stays on it";
  /**
   * The ground's planes, one tap each (docs/plans/sketch-mode.md): pressing
   * one sketches on it at once. Never remembered — the next sketch starts by
   * picking again, not on the last plane chosen.
   */
  static readonly options: OptionSpecs = {
    on: {
      default: "pick",
      label: "plane",
      choices: { pick: "pick a face", top: NAMED_PLANES.top.label, front: NAMED_PLANES.front.label, right: NAMED_PLANES.right.label },
      buttons: true,
      remember: false,
    },
  };
  readonly name = "sketch";
  // It chooses a plane, not a place: a snap marker would promise a vertex the
  // click does not go to.
  readonly snaps = false;
  private under: Under | null = null;
  /** The line of sight back at the viewer and the pixels per unit, as the last frame drew them — what a named plane is picked by. */
  private toward: number[] = [0, 0, 1];
  private scale = 1;

  next(hand: Hand): string {
    return `${press(hand)} a lit face or plane to sketch on it`;
  }

  onMove(p: PointerInfo): void {
    const next = this.at(p.screen);
    const changed = keyOf(next) !== keyOf(this.under);
    this.under = next;
    if (changed) this.ctx.requestRender();
  }

  /**
   * Armed with a choice already made, it sketches at once — there is nothing to
   * preview or confirm: a named plane from the options panel (`arm("sketch",
   * { on: "front" })`), a face selected on the canvas, a frame or three points
   * selected. After the line that armed it has run, not inside it: the plane
   * is typed as a line of its own, as a click would type it.
   */
  onArmed(): void {
    const on = this.ctx.options.on;
    const named = typeof on === "string" && Object.hasOwn(NAMED_PLANES, on) ? on as Named : null;
    const given = this.ctx.preselected?.[0];
    const picked = this.ctx.prenamed ?? [];
    if (!named && !given && !picked.length) return;
    // A task, not a microtask: the arming line's own answer ("armed: sketch")
    // is logged a few microtasks after it ran, and the plane belongs after it.
    setTimeout(() => {
      try {
        if (named) { this.type(workplaneLine(NAMED_PLANES[named].ref)); return; }
        if (given) {
          const hit = refind(this.ctx.model, given);
          if (hit) this.sketchOn(hit);
          return;
        }
        const line = selectedPlane(this.ctx.model, picked, this.toward);
        if (line) this.type(line);
      } catch {
        // Headless, with nobody to tell: nothing sketched, the tool armed.
      }
    }, 0);
  }

  onDown(p: PointerInfo): void {
    const under = this.at(p.screen);
    if (!under) {
      // A chamfer's own face: refused, saying why and what does work.
      const chamfer = this.chamferAt(p.screen);
      if (chamfer) {
        this.refuse(new Error(chamferFaceRefusal(chamfer)));
        return;
      }
      // In 3D the named planes are always there to take; a 2D drawing has only its loops.
      this.refuse(new Error(this.ctx.model.dim === 3
        ? "click inside a lit face, or a lit plane — or choose Top, Front or Right in the options"
        : missedRegion(this.ctx.model)));
      return;
    }
    if (under.kind === "face") this.sketchOn(under.hit);
    else if (under.kind === "kernel") this.type(under.command);
    else this.type(workplaneLine(NAMED_PLANES[under.plane].ref));
  }

  /** What a click at `screen` would sketch on: a face first, then a flat kernel face no loop bounds, then a named plane. */
  private at(screen: [number, number]): Under | null {
    let hit = this.ctx.regionAt?.(screen) ?? null;
    const solid = this.ctx.solids?.faceAt(screen) ?? null;
    // A loop made only of a body's skeleton — a lid the kernel chamfered or
    // filleted along an edge — still spans the corner the kernel cut away, so
    // the region answer there is the lid seen through a chamfer or a round
    // that is in front of it. Where the kernel's face under the pixel is not
    // in that loop's plane, the kernel's face is what is seen (found: a click
    // on a chamfer sketched on the lid).
    if (hit && solid && this.skeletonLoop(hit) && !inPlane(hit, solid)) {
      if (!solid.planar) return null; // a round: no plane to sketch on
      const around = loopAround(this.ctx.model, solid.at, hit.loops);
      hit = around ? { ...hit, index: hit.loops.indexOf(around), at: solid.at } : null;
    }
    if (hit) return { kind: "face", hit };
    const kernel = this.kernelAt(screen);
    if (kernel) return kernel;
    if (solid) return null; // on a body, and no plane there: not the ground behind it
    const named = this.namedAt(screen);
    return named ? { kind: "named", plane: named } : null;
  }

  /** Whether every member of the loop under a hit is a kernel body's skeleton, drawn by the kernel in its stead. */
  private skeletonLoop(hit: RegionHit): boolean {
    const s = this.ctx.solids;
    return !!s && hit.loops[hit.index].members.every((m) => s.skeleton(m.name));
  }

  /**
   * The chamfer whose own face is under the pixel — the kernel's cut of a
   * body's edge (`BlendFeature`), by its record's name — or null. That face is
   * **not sketched on** (the register's review item 7, docs/plans/
   * fillets-one-thing.md): nothing in the model lies on it, so a plane made
   * there was held by nothing and stayed behind when the solid moved. A
   * chamfer of a profile's corner is the sketch's now, its face a wall swept
   * from a line, and that is sketched on like any wall and follows.
   */
  private chamferAt(screen: [number, number]): string | null {
    const hit = this.ctx.solids?.faceAt(screen) ?? null;
    return hit ? chamferOfFace(this.ctx.model, hit.name) : null;
  }

  /** A flat face of a body under the pixel, as the frame the tool would make there — or null. */
  private kernelAt(screen: [number, number]): Under | null {
    const s = this.ctx.solids;
    const hit = s?.faceAt(screen) ?? null;
    if (!s || !hit || !hit.planar) return null;
    if (chamferOfFace(this.ctx.model, hit.name)) return null;
    const body = s.views().find((v) => v.name === hit.body);
    const plane = body ? kernelFacePlane(body, hit.face, hit.normal) : null;
    if (!body || !plane) return null;
    const outline = body.faces.filter((t) => t.face === hit.face).flatMap((t) => t.outlines[0]);
    return { kind: "kernel", command: kernelPlaneCommand(plane), outline };
  }

  /** The named plane whose patch the pixel's line of sight meets nearest, among those not edge-on — or null. */
  private namedAt(screen: [number, number]): Named | null {
    if (this.ctx.model.dim !== 3 || !this.ctx.planeAt) return null;
    let best: { name: Named; depth: number } | null = null;
    for (const [name, patch] of this.patches()) {
      const w = this.ctx.planeAt(screen, patch);
      if (!w) continue;
      const d = sub3(lift3(w), patch.origin);
      if (Math.abs(dot3(d, patch.u)) > patch.half || Math.abs(dot3(d, patch.v)) > patch.half) continue;
      const depth = dot3(lift3(w), this.toward);
      if (!best || depth > best.depth) best = { name, depth };
    }
    return best?.name ?? null;
  }

  /** The named planes offered in the view now, each as a square patch about the origin, sized to the drawing. */
  private patches(): [Named, { origin: number[]; u: number[]; v: number[]; half: number }][] {
    const m = this.ctx.model;
    let reach = 0;
    for (const e of m.entities.values()) {
      if (e.kind !== "point") continue;
      for (const c of m.coords(e.name)) reach = Math.max(reach, Math.abs(c));
    }
    const half = Math.max(PATCH_PX / this.scale, PATCH_PAD * reach);
    const out: [Named, { origin: number[]; u: number[]; v: number[]; half: number }][] = [];
    for (const name of Object.keys(NAMED_PLANES) as Named[]) {
      const pv = m.planeValues(NAMED_PLANES[name].ref);
      if (!pv || Math.abs(dot3(cross3(pv.u, pv.v), this.toward)) < EDGE_ON) continue;
      out.push([name, { origin: lift3(pv.origin), u: pv.u, v: pv.v, half }]);
    }
    return out;
  }

  private sketchOn(hit: RegionHit): void {
    let command: string;
    try {
      command = sketchOnFaceCommand(this.ctx.model, hit.loops[hit.index], hit.toward);
    } catch (e) {
      this.refuse(e);
      return;
    }
    this.type(command);
  }

  /** Types `command` — the plane chosen — and is done. */
  private type(command: string): void {
    if (!this.ctx.run) {
      // Not a miss: a host with no command line. A refusal, and headless it throws.
      if (!this.ctx.log) throw new Error("there is no command line here to type workplane(…) into");
      this.ctx.log("sketch: there is no command line here to type workplane(…) into");
      return;
    }
    this.under = null;
    // Finished first: the command turns the view, and the hover outline of a
    // tool that is done would otherwise be drawn once more in the new one.
    this.ctx.finish();
    this.ctx.run(command);
  }

  /** Guidance where there is a user to tell, a throw headless — the extrude tool's convention. */
  private refuse(e: unknown): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw e;
    this.ctx.log(`sketch: ${e instanceof Error ? e.message : e}`, "guide");
  }

  onCancel(): void {
    this.under = null;
    this.ctx.requestRender();
  }

  /**
   * Every face it could take lit, the named planes drawn faintly with their
   * names, and the one under the cursor outlined — exactly as the extrude tool
   * does regions.
   */
  render(r: RenderContext): void {
    if (r.toward) this.toward = r.toward;
    this.scale = r.scale;
    const under = this.under;
    lightRegions(this.ctx.model, r, under?.kind === "face" ? under.hit : null);
    for (const [name, patch] of this.patches()) {
      const at = (s: number, t: number) => r.worldToScreen(patch.origin.map((o, i) => o + s * patch.half * patch.u[i] + t * patch.half * patch.v[i]));
      const corners = [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
      const lit = under?.kind === "named" && under.plane === name;
      r.g.save();
      r.g.beginPath();
      r.g.moveTo(...corners[0]);
      for (const c of corners.slice(1)) r.g.lineTo(...c);
      r.g.closePath();
      r.g.fillStyle = `${REGION_GREEN}${lit ? "2e" : "0c"}`;
      r.g.fill();
      r.g.strokeStyle = `${REGION_GREEN}${lit ? "ff" : "60"}`;
      r.g.lineWidth = lit ? 1.6 : 1;
      r.g.setLineDash(lit ? [] : [5, 4]);
      r.g.stroke();
      r.g.setLineDash([]);
      // The name inside the corner nearest the top of the screen, so it reads upright.
      const top = corners.reduce((a, b) => (b[1] < a[1] ? b : a));
      const mid = at(0, 0);
      r.g.fillStyle = `${REGION_GREEN}${lit ? "ff" : "b0"}`;
      r.g.font = `${Math.round(11 * (r.ui ?? 1))}px ui-monospace, monospace`;
      r.g.textAlign = "center";
      r.g.textBaseline = "middle";
      r.g.fillText(NAMED_PLANES[name].label, top[0] + 0.18 * (mid[0] - top[0]), top[1] + 0.18 * (mid[1] - top[1]));
      r.g.restore();
    }
    if (under?.kind === "face") drawRegion(this.ctx.model, r, under.hit);
    else if (under?.kind === "kernel" && under.outline.length) {
      r.g.save();
      r.g.fillStyle = `${REGION_GREEN}2e`;
      for (let i = 0; i + 2 < under.outline.length; i += 3) {
        const [a, b, c] = under.outline.slice(i, i + 3).map((w) => r.worldToScreen(w));
        r.g.beginPath();
        r.g.moveTo(...a);
        r.g.lineTo(...b);
        r.g.lineTo(...c);
        r.g.closePath();
        r.g.fill();
      }
      r.g.restore();
    }
  }
}

/** The chamfer record a kernel face's name is a face of (`e3.f0`), or null: a face the kernel cut along a body's edge. */
export function chamferOfFace(model: Model, face: string): string | null {
  const record = face.split(".")[0];
  return model.blends.get(record)?.kind === "chamfer" ? record : null;
}

/** Why a chamfer's own face is not sketched on, and what is. */
export function chamferFaceRefusal(chamfer: string): string {
  return `that face is ${chamfer}'s — a chamfer the solid kernel cut along an edge. Nothing in the model lies on it, so a sketch there `
    + "would be held by nothing and left behind when the solid moves. Sketch on a face beside it, or on a plane you make "
    + "(three points on the solid: plane(p1, p2, p3)); a chamfer between two walls is the sketch's own, and its face is sketched on like any wall";
}

/** Whether a kernel face under the pixel lies in the plane of the loop a region hit found there. */
function inPlane(hit: RegionHit, solid: { at: number[]; normal: number[] }): boolean {
  const plane = hit.loops[hit.index].plane;
  const size = Math.max(1, Math.sqrt(Math.abs(hit.loops[hit.index].area)));
  return Math.abs(Math.abs(dot3(solid.normal, plane.normal)) - 1) < 1e-6
    && Math.abs(dot3(sub3(lift3(solid.at), plane.origin), plane.normal)) < 1e-6 * size;
}

/** The line that sketches on a plane reference. */
function workplaneLine(ref: string): string {
  return `workplane(${JSON.stringify(ref)})`;
}

/** A key for what is under the cursor, so a move that changes nothing draws nothing. */
function keyOf(u: Under | null): string {
  if (!u) return "";
  if (u.kind === "face") return `face:${regionKey(u.hit)}`;
  if (u.kind === "kernel") return `kernel:${u.command}`;
  return `named:${u.plane}`;
}

/**
 * The plane a selection names, as the line that sketches on it, or null: one
 * frame (its own plane), or three points not on one line — `"a.b.c"`, ordered
 * so its normal faces `toward` (the viewer), as a face's three are.
 */
export function selectedPlane(model: Model, names: readonly string[], toward: number[]): string | null {
  if (model.dim !== 3) return null;
  if (names.length === 1 && model.isFrame(names[0])) return workplaneLine(names[0]);
  if (names.length !== 3 || !names.every((n) => model.entities.get(n)?.kind === "point")) return null;
  const [a, b, c] = names.map((n) => lift3(model.coords(n)));
  const n = cross3(sub3(b, a), sub3(c, a));
  if (Math.hypot(...n) < 1e-9 * Math.max(1, Math.hypot(...sub3(b, a)) * Math.hypot(...sub3(c, a)))) return null;
  const order = dot3(n, toward) >= 0 ? names : [names[0], names[2], names[1]];
  return workplaneLine(order.join("."));
}

