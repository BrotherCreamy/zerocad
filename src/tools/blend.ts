// Fillet and chamfer a body's edges: click edges, see the body rounded, ✓.
//
// docs/plans/solid-fillets.md. The owner: *"please add solid and surface fillet
// tools if possible"*. Onshape's fillet: armed — from the modify button, typed,
// or with edges already selected, which it starts from — a click on an edge of
// a solid picks it (and, with tangent chains on, every edge running on
// smoothly from it: a rounded outline's whole rim), a click on a face picks
// every edge round it, and a second click on that face every edge of the
// body; a click on a picked edge, or on a face the preview rounded, drops it.
// The radius (a chamfer's setback) is in the options panel and on the drawing,
// a label on the first rounded face that a drag along it changes. The preview
// is the kernel's (`SolidsAccess.trial`): the body built with this blend in its
// chain, drawn in the body's place, shaded as it will be — the last good body
// standing until it arrives, as a drag's does. ✓ (or Enter) types one line,
// `fillet("e1", ["e1.lid|e1.m0", …], 3)`, as one undo step.
//
// **Edges are picked on the body as drawn**, the preview included: an edge the
// preview has rounded is gone from it, so its fillet face stands for it — a
// click there drops that edge — and the picks are names, which is what
// survives the preview being rebuilt under them.
//
// The edit dialog (`edit("e3")`, Edit on the organiser row) is the same tool
// opened on a blend that exists: its edges picked, its size in the panel, the
// preview the blend as edited, ✓ typing `setEdges` and `set` as one step.
//
// **One tool does solids and surfaces** (docs/plans/surfaces.md; the owner:
// *"also fillets and chamfers for surfaces"*). An edge of a surface — two
// knitted surfaces' join, or a crease of one — is picked as a solid's is, and ✓
// types `fillet("s1", ["s1.m0|s2.m0"], 3)`. A click on a surface where no edge
// of it is shared picks the surface; a click on another surface then picks the
// pair — where each was clicked is the side of it kept — and the preview is
// the two trimmed back to each other, knitted and rounded: ✓ types
// `fillet("s1", "s2", 3, [[…], […]])`. A surface's boundary edge (one face) is
// never picked: there is nothing on its other side to round to.

import { press, type FeatureDialog, type FeatureStep, type Hand, type PointerInfo, type RenderContext } from "./tool.ts";
import type { OptionSpecs } from "./options.ts";
import { FeatureTool, callText } from "./feature.ts";
import { REGION_GREEN } from "./region.ts";
import type { BlendFeature, Model } from "../model.ts";
import { blendSize, chamferEdges, filletEdges, setEdges } from "../blends.ts";
import { set } from "../operations.ts";
import { PREFIX, pairTrial, type BlendTrial, type BodyView } from "../bodies.ts";
import { bodyEdges, edgePoints, faceEdges, tangentChain } from "../kerneledges.ts";
import { featureLabel } from "../solids/naming.ts";
import { nextSurfaceId, surfaceBlend } from "../surfaces.ts";

export type BlendKind = "fillet" | "chamfer";

/** A new fillet's radius and chamfer's setback, when nothing was typed or remembered. */
export const DEFAULT_BLEND = 2;

const positive = (v: unknown) => ((v as number) > 0 ? null : "must be more than 0");

/** The option a blend's size is: a fillet's radius, a chamfer's setback. */
export function sizeOption(kind: BlendKind): "radius" | "setback" {
  return kind === "fillet" ? "radius" : "setback";
}

/** What the tool picked under a pixel: edges by name, of one body, and whether it was a face's. */
interface Hit {
  body: string;
  names: string[];
  face: boolean;
  /** A face's index in its body, for a second click on it taking the whole body. */
  faceIndex?: number;
  /** A surface picked whole — a face of it no edge of which is shared — and where on it: the side kept. */
  surface?: { at: number[] };
}

/** Rounded to four decimals: a place only says which side, as the trim's does. */
const place = (p: readonly number[]) => p.map((v) => Math.round(v * 1e4) / 1e4);

/** How far from the size label a press still grabs it, in pixels at 100 %. */
const HANDLE_REACH = 16;
/** How far the size label stands off the face it sits on, in pixels at 100 %. */
const HANDLE_OFFSET = 26;

abstract class BlendTool extends FeatureTool {
  readonly kernelEdges = true;
  protected abstract readonly kind: BlendKind;
  /** The body whose edges are picked — one at a time. */
  protected body: string | null = null;
  /** The edges picked, by name, in the order picked. */
  protected edges: string[] = [];
  /** A fillet between two surfaces: the second surface, once picked (`body` the first), and where each was clicked. */
  protected pair: string | null = null;
  protected keeps: [number[] | null, number[] | null] = [null, null];
  /** The pair's preview node, laid out once per pick and size — a program read is not free. */
  private pairCache: { key: string; trial: BlendTrial | null } | null = null;
  private under: Hit | null = null;
  /** The size label, where it was last drawn: its centre on screen and the way it stands off its face. */
  private handle: { at: [number, number]; dir: [number, number] } | null = null;
  /**
   * A drag of the label: where it was pressed, the size then, and **the way
   * the label stood off its face then** — fixed for the whole drag. The label
   * is placed again on every frame from the preview the kernel last sent
   * (`renderHandle`), and a preview of a new size can put it on another face
   * of the fillet, standing off another way: read live, that turned the same
   * finger's motion from "out" to "in" mid-drag, and the size fell to its
   * floor whenever a preview landed between two moves (found by recording the
   * phone test's gesture: docs/plans/touch-density.md, As built).
   */
  private drag: { from: [number, number]; start: number; dir: [number, number] } | null = null;
  /** The size a drag of the label has reached, laid over the options until it is let go. */
  private dragged: number | null = null;
  private scale = 1;
  private ui = 1;
  /** The kernel's refusal last said aloud, so it is said once. */
  private toldWhy = "";

  protected get option(): "radius" | "setback" {
    return sizeOption(this.kind);
  }

  protected values(): Record<string, unknown> {
    const v = super.values();
    return this.dragged === null ? v : { ...v, [this.option]: this.dragged };
  }

  protected sizeOf(values: Record<string, unknown>): number {
    const v = values[this.option];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : DEFAULT_BLEND;
  }

  /** The feature number the preview's faces are tagged with — what its fillet faces are named after. */
  protected abstract trialId(): number;
  /** The blend the trial stands in for (an edit), or none (a new one, appended). */
  protected abstract replaceId(): number | undefined;

  /** The preview to ask for, or null for none. */
  protected trialNow(): BlendTrial | null {
    if (this.body !== null && this.pair !== null) {
      const size = this.sizeOf(this.values());
      const key = `${this.body}:${this.pair}:${JSON.stringify(this.keeps)}:${size}:${this.trialId()}`;
      if (this.pairCache?.key !== key) {
        const node = pairTrial(this.ctx.model, {
          into: this.body, other: this.pair, kind: this.kind, size, keeps: [...this.keeps], id: this.trialId(),
        });
        this.pairCache = { key, trial: node ? { body: this.body, node, hides: [this.pair] } : null };
      }
      return this.pairCache.trial;
    }
    if (this.body === null || !this.edges.length) return null;
    const replace = this.replaceId();
    return {
      body: this.body,
      node: { id: this.trialId(), op: this.kind, edges: [...this.edges], size: this.sizeOf(this.values()) },
      ...(replace === undefined ? {} : { replace }),
    };
  }

  /** A face or edge the preview's blend made: the index of the picked edge it was made of, or null. */
  private ownIndex(name: string): number | null {
    const m = new RegExp(`(?:^|\\|)${featureLabel(this.trialId(), PREFIX)}\\.f(\\d+)(?:$|\\|)`).exec(name);
    return m ? Number(m[1]) : null;
  }

  /** Whether an edge of a view is a sheet's boundary: one face, nothing beyond it to round to. */
  private lamina(v: BodyView | null, name: string): boolean {
    return !!v?.result.solid?.edges.some((e) => e.name === name && e.lamina);
  }

  private viewOf(body: string): BodyView | null {
    return this.ctx.solids?.views().find((v) => v.name === body) ?? null;
  }

  /** What a press at `screen` would pick, or null. */
  private hitAt(screen: [number, number]): Hit | null {
    const s = this.ctx.solids;
    if (!s) return null;
    const tangent = this.values().tangent !== false;
    const e = s.edgeAt(screen);
    if (e && !this.lamina(this.viewOf(e.body), e.name)) {
      const v = this.viewOf(e.body);
      const own = this.ownIndex(e.name);
      if (own !== null) return this.edges[own] ? { body: e.body, names: [this.edges[own]], face: true } : null;
      const names = v && tangent ? tangentChain(v, e.name) : [e.name];
      return { body: e.body, names: names.filter((n) => this.ownIndex(n) === null), face: false };
    }
    const f = s.faceAt(screen);
    if (!f) return null;
    const own = this.ownIndex(f.name);
    if (own !== null) return this.edges[own] ? { body: f.body, names: [this.edges[own]], face: true } : null;
    const v = this.viewOf(f.body);
    const names = v ? faceEdges(v, f.face).filter((n) => this.ownIndex(n) === null && !this.lamina(v, n)) : [];
    if (names.length) return { body: f.body, names, face: true, faceIndex: f.face };
    // A surface's face with no edge shared: the surface itself, for a fillet to another.
    if (this.ctx.model.surfaces.has(f.body)) return { body: f.body, names: [], face: true, faceIndex: f.face, surface: { at: f.at } };
    return null;
  }

  onArmed(): void {
    // Edges selected before arming are where it starts: select, then Fillet.
    const given = this.ctx.preedges ?? [];
    if (!given.length) return;
    const views = this.ctx.solids?.views() ?? [];
    const v = views.find((x) => x.result.solid?.edges.some((e) => e.name === given[0]));
    if (!v) return;
    this.body = v.name;
    this.edges = given.filter((n) => v.result.solid!.edges.some((e) => e.name === n));
    this.ctx.requestRender();
  }

  protected picksKey(): string {
    return `${this.body ?? ""}:${this.edges.join(",")}:${this.pair ?? ""}:${JSON.stringify(this.keeps)}`;
  }

  protected dropPicks(): boolean {
    const had = this.edges.length > 0 || this.pair !== null || (this.body !== null && this.keeps[0] !== null);
    this.edges = [];
    this.pair = null;
    this.keeps = [null, null];
    this.pairCache = null;
    this.body = null;
    this.under = null;
    this.dragged = null;
    this.drag = null;
    this.ctx.solids?.trial(null);
    return had;
  }

  protected wanting(): string | null {
    return null;
  }

  protected picking(hand: Hand): string {
    if (this.pair) return `drag the ${this.option}, or ${press(hand)} either surface where it is kept`;
    if (this.body !== null && !this.edges.length && this.ctx.model.surfaces.has(this.body)) {
      return `${press(hand)} the surface to ${this.kind} ${this.body} to`;
    }
    return this.edges.length
      ? `${press(hand)} more edges, or drag the ${this.option}`
      : `${press(hand)} an edge of a solid or a surface (a face takes its edges), or a surface`;
  }

  protected get verb(): string {
    return this.kind;
  }

  dialog(): FeatureDialog {
    const d = super.dialog();
    const why = this.ctx.solids?.trialAnswer().why ?? null;
    return { ...d, ready: d.ready && why === null };
  }

  confirm(): boolean {
    const why = this.ctx.solids?.trialAnswer().why ?? null;
    if (why !== null && this.edges.length) {
      this.guide(why);
      return true;
    }
    return super.confirm();
  }

  onMove(p: PointerInfo): void {
    if (this.drag) {
      const d = [p.screen[0] - this.drag.from[0], p.screen[1] - this.drag.from[1]];
      const along = d[0] * this.drag.dir[0] + d[1] * this.drag.dir[1];
      // A length is never 0 or less; a hundredth of the start is the least a drag goes to.
      this.dragged = Math.max(this.drag.start / 100, this.drag.start + along / this.scale);
      this.dragged = Math.round(this.dragged * 1000) / 1000;
      this.ctx.requestRender();
      return;
    }
    // Over the size label nothing else is lit: a press there drags the size.
    const onHandle = this.handle !== null
      && Math.hypot(p.screen[0] - this.handle.at[0], p.screen[1] - this.handle.at[1]) < HANDLE_REACH * this.ui;
    const next = onHandle ? null : this.hitAt(p.screen);
    if (JSON.stringify(next) === JSON.stringify(this.under)) return;
    this.under = next;
    this.ctx.requestRender();
  }

  onDown(p: PointerInfo): void {
    if (this.handle && Math.hypot(p.screen[0] - this.handle.at[0], p.screen[1] - this.handle.at[1]) < HANDLE_REACH * this.ui) {
      this.drag = { from: p.screen, start: this.sizeOf(this.values()), dir: this.handle.dir };
      this.under = null;
      return;
    }
    const s = this.ctx.solids;
    if (s && !s.views().length) {
      this.guide("the solid kernel is still building the bodies — a moment, then click an edge");
      return;
    }
    const hit = this.hitAt(p.screen);
    if (!hit) {
      this.guide("pick an edge of a solid, or a face for its edges — what a pick takes is lit under the cursor");
      return;
    }
    if (hit.surface) {
      // A surface picked whole: the first of a pair, the second, or either one's kept side again.
      if (this.edges.length) {
        this.guide(`${this.body}'s edges are picked — ✓ them first, or ✗ to start again`);
        return;
      }
      if (this.body === null || (this.pair === null && hit.body === this.body)) {
        this.body = hit.body;
        this.keeps = [place(hit.surface.at), null];
      } else if (hit.body === this.body) {
        this.keeps = [place(hit.surface.at), this.keeps[1]];
      } else if (this.pair === null || hit.body === this.pair) {
        this.pair = hit.body;
        this.keeps = [this.keeps[0], place(hit.surface.at)];
      } else {
        this.guide(`${this.body} and ${this.pair} are picked — ✓ them, or ✗ to start again`);
        return;
      }
      this.ctx.requestRender();
      return;
    }
    if (this.pair !== null || (this.body !== null && !this.edges.length && this.keeps[0] !== null)) {
      this.guide(`${this.body} is picked as a surface — click another surface, or ✗ to pick edges instead`);
      return;
    }
    if (this.body !== null && hit.body !== this.body) {
      this.guide(`one body at a time — ${this.body}'s edges are picked; ✓ them first, or ✗ to start again`);
      return;
    }
    this.body = hit.body;
    let names = hit.names;
    const allIn = names.every((n) => this.edges.includes(n));
    // A second click on a face whose edges are all picked: every edge of the body.
    if (hit.face && allIn && hit.faceIndex !== undefined) {
      const v = this.viewOf(hit.body);
      const every = v ? bodyEdges(v).filter((n) => this.ownIndex(n) === null) : [];
      if (every.some((n) => !this.edges.includes(n))) names = every;
    }
    if (names.every((n) => this.edges.includes(n))) this.edges = this.edges.filter((n) => !names.includes(n));
    else for (const n of names) if (!this.edges.includes(n)) this.edges.push(n);
    if (!this.edges.length && this.replaceId() === undefined) this.body = null;
    this.ctx.requestRender();
  }

  onUp(): void {
    if (!this.drag) return;
    this.drag = null;
    const v = this.dragged;
    if (v === null) return;
    // Let go: the size becomes the option's — typed as the panel's field
    // types it, so it is remembered and the panel shows it — and the picks stay.
    const line = callText("arm", [this.name, { [this.option]: v }]);
    const done = () => { this.dragged = null; this.ctx.requestRender(); };
    if (this.ctx.run) void Promise.resolve(this.ctx.run(line)).then(done, done);
    else {
      this.ctx.options = { ...this.ctx.options, [this.option]: v };
      done();
    }
  }

  onCancel(): void {
    this.ctx.solids?.trial(null);
    super.onCancel();
  }

  render(r: RenderContext): void {
    this.scale = r.scale;
    this.ui = r.ui ?? 1;
    const s = this.ctx.solids;
    const trial = this.trialNow();
    s?.trial(trial ?? this.idleTrial());
    const why = s?.trialAnswer().why ?? null;
    // Recorded before it is said: saying it redraws, and the redraw is this.
    const fresh = why !== null && why !== this.toldWhy && this.edges.length > 0;
    this.toldWhy = why ?? "";
    if (fresh) this.guide(why!);
    const g = r.g;
    const stroke = (pts: number[][], colour: string, width: number) => {
      if (pts.length < 2) return;
      g.strokeStyle = colour;
      g.lineWidth = width * this.ui;
      g.beginPath();
      g.moveTo(...r.worldToScreen(pts[0]));
      for (const q of pts.slice(1)) g.lineTo(...r.worldToScreen(q));
      g.stroke();
    };
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    const v = this.body ? this.viewOf(this.body) : null;
    const sol = v?.result.solid ?? null;
    if (v && sol) {
      // What ✓ builds, in the tools' green: the edges of the faces the preview
      // made, once it is in; until then the edges picked.
      const made = sol.edges.map((e, i) => ({ e, i })).filter(({ e }) => this.ownIndex(e.name) !== null);
      const lines = made.length ? made : sol.edges.map((e, i) => ({ e, i })).filter(({ e }) => this.edges.includes(e.name));
      for (const { i } of lines) stroke(edgePoints(v, i), REGION_GREEN, 1.8);
    }
    // What a click would take, in the hover's amber.
    if (this.under) {
      const u = this.viewOf(this.under.body);
      const us = u?.result.solid;
      if (u && us) us.edges.forEach((e, i) => { if (this.under!.names.includes(e.name)) stroke(edgePoints(u, i), "#e8a33d", 2.2); });
    }
    // Where each surface of a pair was clicked: the side of it kept.
    for (const k of this.keeps) {
      if (!k) continue;
      const [x, y] = r.worldToScreen(k);
      g.strokeStyle = REGION_GREEN;
      g.lineWidth = 2 * this.ui;
      g.beginPath();
      g.arc(x, y, 7 * this.ui, 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
    this.renderHandle(r, v);
  }

  /** The trial while nothing is picked: none for a new blend; an edit's is the blend as it is. */
  protected idleTrial(): BlendTrial | null {
    return null;
  }

  /** The size on the drawing: a label on the first face the preview made (or the first edge picked), dragged along to change it. */
  private renderHandle(r: RenderContext, v: BodyView | null): void {
    this.handle = null;
    const sol = v?.result.solid;
    if (!v || !sol || !this.edges.length) return;
    let at: number[] | null = null;
    let normal: number[] | null = null;
    const fi = sol.faces.findIndex((f) => this.ownIndex(f.name) === 0);
    if (fi >= 0) {
      at = sol.faces[fi].point;
      normal = v.faces.find((t) => t.face === fi)?.normal ?? null;
    } else {
      const e = sol.edges.find((x) => x.name === this.edges[0]);
      if (e) {
        at = e.mid;
        const ns = e.faces.filter((f) => f >= 0).map((f) => v.faces.find((t) => t.face === f)?.normal).filter((n): n is number[] => !!n);
        if (ns.length) normal = [0, 1, 2].map((k) => ns.reduce((acc, n) => acc + n[k], 0));
      }
    }
    if (!at) return;
    const p = r.worldToScreen(at);
    let dir: [number, number] = [0, -1];
    if (normal) {
      const q = r.worldToScreen(at.map((c, k) => c + normal![k] / Math.max(r.scale, 1e-9) * 10));
      const d = [q[0] - p[0], q[1] - p[1]];
      const len = Math.hypot(d[0], d[1]);
      if (len > 1e-6) dir = [d[0] / len, d[1] / len];
    }
    const off = HANDLE_OFFSET * this.ui;
    const c: [number, number] = [p[0] + dir[0] * off, p[1] + dir[1] * off];
    this.handle = { at: c, dir };
    const size = this.sizeOf(this.values());
    const text = `${this.kind === "fillet" ? "R" : "C"}${Math.round(size * 1000) / 1000}`;
    const g = r.g;
    g.save();
    g.font = `${12 * this.ui}px ui-monospace, monospace`;
    const w = g.measureText(text).width + 10 * this.ui, h = 18 * this.ui;
    g.strokeStyle = REGION_GREEN;
    g.lineWidth = 1.2 * this.ui;
    g.beginPath();
    g.moveTo(p[0], p[1]);
    g.lineTo(c[0] - dir[0] * h / 2, c[1] - dir[1] * h / 2);
    g.stroke();
    g.fillStyle = this.drag ? "#2f6b45" : "#1d3a2a";
    g.fillRect(c[0] - w / 2, c[1] - h / 2, w, h);
    g.strokeRect(c[0] - w / 2, c[1] - h / 2, w, h);
    g.fillStyle = "#e6f4ea";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, c[0], c[1] + 0.5);
    g.restore();
  }
}

/** The number a new feature will most likely be given: one past every feature and blend there is. */
export function nextFeatureNumber(model: Model): number {
  let n = 0;
  for (const name of [...model.features.keys(), ...model.blends.keys()]) {
    const m = /^e(\d+)$/.exec(name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return n + 1;
}

/** The step a confirm of a new blend types: `fillet("e1", [...], 3)` or `chamfer(...)`. */
export function blendSteps(kind: BlendKind, body: string, edges: readonly string[], size: number): FeatureStep[] {
  const list = [...edges];
  return [(m) => ({
    text: callText(kind, [body, list, size]),
    direct: () => (m.surfaces.has(body) ? surfaceBlend(m, kind, body, list, size)
      : kind === "fillet" ? filletEdges(m, body, list, size) : chamferEdges(m, body, list, size)),
  })];
}

/** The step a confirm of a fillet between two surfaces types: `fillet("s1", "s2", 3, [[…], […]])` — the clicked sides kept. */
export function pairSteps(kind: BlendKind, body: string, other: string, size: number, keeps: (number[] | null)[]): FeatureStep[] {
  const k = [...keeps];
  return [(m) => ({ text: callText(kind, [body, other, size, k]), direct: () => surfaceBlend(m, kind, body, other, size, k) })];
}

abstract class NewBlendTool extends BlendTool {
  /**
   * The number the preview runs under, guessed once per pick set and kept: the
   * blend ✓ makes is then most likely that number, so its first answer is the
   * preview's own from the cache — and a guess made again after ✓ would be the
   * next feature's, previewing a second fillet of edges already rounded.
   */
  private frozen: number | null = null;
  /** Whether `frozen` was guessed for a surface's record or a feature's: a hover asks before a pick says which. */
  private frozenSurface = false;

  protected trialId(): number {
    // A surface's blend is a surface's record, numbered as surfaces are (surfaces.md).
    const surface = this.body !== null && this.ctx.model.surfaces.has(this.body);
    if (this.frozen === null || this.frozenSurface !== surface) {
      this.frozen = surface ? nextSurfaceId(this.ctx.model) : nextFeatureNumber(this.ctx.model);
      this.frozenSurface = surface;
    }
    return this.frozen;
  }

  protected dropPicks(): boolean {
    const had = super.dropPicks();
    this.frozen = null;
    return had;
  }

  protected replaceId(): number | undefined {
    return undefined;
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    if (this.body !== null && this.pair !== null) return pairSteps(this.kind, this.body, this.pair, this.sizeOf(values), this.keeps);
    if (this.body === null || !this.edges.length) return null;
    return blendSteps(this.kind, this.body, this.edges, this.sizeOf(values));
  }
}

export class EdgeFilletTool extends NewBlendTool {
  static readonly options: OptionSpecs = {
    radius: { default: DEFAULT_BLEND, unit: "length", check: positive },
    tangent: { default: true, label: "tangent" },
  };
  static readonly summary = "Fillets a solid's edges: click edges or a face, see it, then ✓";
  readonly name = "round";
  protected readonly kind = "fillet";
}

export class EdgeChamferTool extends NewBlendTool {
  static readonly options: OptionSpecs = {
    setback: { default: DEFAULT_BLEND, unit: "length", check: positive },
    tangent: { default: true, label: "tangent" },
  };
  static readonly summary = "Chamfers a solid's edges, one setback: click edges or a face, then ✓";
  readonly name = "chamfer";
  protected readonly kind = "chamfer";
}

/**
 * The steps an edit of a blend types: `setEdges` when the edges changed, then
 * `set` on its dimension when the size did — each asked of the model as the
 * one before left it. Empty when nothing changes.
 */
export function editBlendSteps(feature: string, edges: readonly string[], size: number | null): FeatureStep[] {
  const steps: FeatureStep[] = [];
  steps.push((m) => {
    const b = m.blendOf(feature);
    if (b.edges.length === edges.length && b.edges.every((e, i) => e === edges[i])) return null;
    const list = [...edges];
    return { text: callText("setEdges", [feature, list]), direct: () => setEdges(m, feature, list) };
  });
  if (size !== null) {
    steps.push((m) => {
      const b = m.blendOf(feature);
      if (Math.abs(blendSize(m, b) - size) <= 1e-12 * Math.max(1, size)) return null;
      const path = `${b.size}.value`;
      return { text: callText("set", [path, size]), direct: () => set(m, path, size) };
    });
  }
  return steps;
}

abstract class EditBlendTool extends BlendTool {
  private started = false;

  protected get verb(): string {
    return "apply";
  }

  protected get blend(): BlendFeature | null {
    const t = this.ctx.target;
    return t !== undefined && this.ctx.model.blends.has(t) ? this.ctx.model.blendOf(t) : null;
  }

  protected trialId(): number {
    const b = this.blend;
    return b ? Number(b.name.slice(PREFIX.length)) : -1;
  }

  protected replaceId(): number | undefined {
    return this.blend ? this.trialId() : undefined;
  }

  onArmed(): void {
    const b = this.blend;
    if (!b) {
      this.ctx.finish();
      this.guide(`${this.name} opens on a fillet or chamfer: edit("e3"), or Edit on its organiser row`);
      return;
    }
    this.body = b.into;
    this.edges = [...b.edges];
    this.started = true;
  }

  protected plan(values: Record<string, unknown>): FeatureStep[] | null {
    const b = this.blend;
    if (!b || !this.started) return null;
    if (!this.edges.length) return null;
    return editBlendSteps(b.name, this.edges, this.sizeOf(values));
  }

  protected wanting(): string | null {
    const b = this.blend;
    return b && !this.edges.length ? `${b.name} keeps at least one edge — del("${b.name}") removes it` : null;
  }

  protected dropPicks(): boolean {
    // ✗ puts the edges back as the record has them; a second ✗ releases the dialog.
    const b = this.blend;
    const changed = !!b && (b.edges.join() !== this.edges.join());
    super.dropPicks();
    if (b && changed) {
      this.body = b.into;
      this.edges = [...b.edges];
    }
    return changed;
  }

  /** With every edge dropped, the blend as the record has it stays previewed: nothing is left to preview of the edit. */
  protected idleTrial(): BlendTrial | null {
    return null;
  }
}

export class EditFilletTool extends EditBlendTool {
  static readonly options: OptionSpecs = {
    radius: { default: DEFAULT_BLEND, unit: "length", check: positive },
    tangent: { default: true, label: "tangent" },
  };
  readonly name = "edit fillet";
  protected readonly kind = "fillet";
}

export class EditChamferTool extends EditBlendTool {
  static readonly options: OptionSpecs = {
    setback: { default: DEFAULT_BLEND, unit: "length", check: positive },
    tangent: { default: true, label: "tangent" },
  };
  readonly name = "edit chamfer";
  protected readonly kind = "chamfer";
}
