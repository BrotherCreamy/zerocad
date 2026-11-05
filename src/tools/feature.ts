// Pick → preview → confirm: what every tool that makes a feature shares.
//
// The owner (2026-11-02): *"extrude and other tools should work like they do
// in other cad software. just click on the region or select the loop and hit
// the tickbox or enter or something"*. So a feature tool no longer commits on
// the click that picks. It collects a selection — regions toggled in, an axis,
// two lines — draws what a confirm would build, live, as the selection and the
// options change, and builds it on ✓, Enter, or a second click on the last
// thing picked. ✗ or Escape drops the selection and keeps the tool armed.
//
// **A confirm is typed.** What it builds is a list of steps (`FeatureStep`):
// each asked of the model as the steps before it left it, each answering the
// line a user could have typed — `plane(…, { look: false })` where a region
// has no frame, then `extrude("l1", 25)` — and the host types them through the
// command line as one user action (`ToolContext.perform`): the log shows every
// line, the journal holds what those lines journal, and one Ctrl+Z takes the
// lot. A tool driven with no host makes the same calls itself (`runDirect`),
// which is what the unit tests of the gestures exercise.
//
// **The preview is the commit, run on a copy.** The same steps go to the host
// again (`ToolContext.preview`), which runs them by the same command machinery
// on a throwaway copy of the model and hands the copy back; the tool draws the
// copy's new solids, translucent, and its new edges in the tools' green. So the
// preview cannot promise a lid the commit will not build: it *is* that lid,
// built once where nobody will keep it. The copy is asked for again only when
// the picks, the values or the model change, never per frame.

import { Tool, press, type FeatureDialog, type FeatureLine, type FeaturePreview, type FeatureStep, type Hand, type RegionHit, type RenderContext } from "./tool.ts";
import type { Model } from "../model.ts";
import { describeFeature } from "../picking.ts";
import { featureFaces, faceColour, type Face } from "../faces.ts";
import { curveFrame } from "../curveplane.ts";
import { arcSamples, arcSegments, frameReach } from "../arcgeom.ts";
import { REGION_GREEN } from "./region.ts";
import { refind } from "./selection.ts";
import { defaultMode, modeOf } from "../modes.ts";
import type { FeatureOptions } from "../operations.ts";

/**
 * The option every feature tool that makes a body takes (docs/plans/
 * solids-kernel.md): what its solid does to a body. `auto` lets the call
 * decide — add to a body it touches, else a new body — and is what every arm
 * starts from: a cut chosen for one hole is not the next feature's.
 */
export const MODE_OPTION = {
  default: "auto", choices: { auto: "auto", new: "New", add: "Add", cut: "Cut", intersect: "∩" }, buttons: true, remember: false,
} as const;

/** A tool's mode option as a call's options: nothing for `auto`, which leaves the call to decide. */
export function modeOptions(values: Record<string, unknown>): FeatureOptions | null {
  const m = values.mode;
  return m === "new" || m === "add" || m === "cut" || m === "intersect" ? { mode: m } : null;
}

/** A cut's previewed tool solid: a warm red, edge-on to square-on, as faceColour runs a body's tones. */
export function cutColour(shade: number): string {
  const [lo, hi] = [[110, 46, 42], [232, 128, 108]];
  const t = Math.max(0, Math.min(1, shade));
  return `rgb(${lo.map((c, i) => Math.round(c + (hi[i] - c) * t)).join(",")})`;
}

/** How opaque a previewed solid is: solid enough to read as one, see-through enough to read as not made yet. */
export const PREVIEW_ALPHA = 0.55;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** A typed call's text: the name and its arguments as JSON, which is the command line's own literal syntax for all of them. */
export function callText(op: string, args: readonly unknown[]): string {
  return `${op}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
}

/** `region` found in `model` as it stands — or refused, for a step planned on a region since rubbed out. */
export function foundRegion(model: Model, region: RegionHit): RegionHit {
  const r = refind(model, region);
  if (!r) throw new Error("a region picked is not there any more — pick it again");
  return r;
}

/**
 * Runs `steps` against `model`, each asked of the model as the ones before it
 * left it: a line handed to `type` (which runs it and answers its refusal, or
 * null), a call made here. Settles with the first refusal, in its own words —
 * and stops there, since every step after it was planned on the one that
 * failed — or null when every step ran. The host's commit and its preview
 * are both this, with a different `type`: the command line, and a command line
 * over a copy.
 */
export async function runSteps(model: Model, steps: readonly FeatureStep[],
                               type: (line: FeatureLine) => Promise<string | null> | string | null): Promise<string | null> {
  for (const step of steps) {
    let next;
    try {
      next = step(model);
    } catch (e) {
      return message(e);
    }
    if (next === null) continue;
    if ("call" in next) {
      try {
        next.call();
      } catch (e) {
        return message(e);
      }
      continue;
    }
    const refused = await type(next);
    if (refused !== null) return refused;
  }
  return null;
}

/**
 * `runSteps` for a tool with no command line to type into: each line's
 * `direct` call made in its place, synchronously, the first refusal thrown. A
 * line with no `direct` is one only a command line can run (a plane made with
 * `plane`, which turns no camera here because there is none) and is refused by
 * saying so.
 */
export function runDirect(model: Model, steps: readonly FeatureStep[]): void {
  for (const step of steps) {
    const next = step(model);
    if (next === null) continue;
    if ("call" in next) {
      next.call();
      continue;
    }
    if (!next.direct) throw new Error(`there is no command line here to type ${next.text} into`);
    next.direct();
  }
}

/**
 * A tool that picks, previews and confirms. A subclass says what it has picked
 * (`picksKey`, `dropPicks`), what a confirm would run (`plan`) and what to say
 * when that is not yet enough (`wanting`); this class keeps the preview in step,
 * confirms, cancels, and answers the options panel's ✓.
 */
export abstract class FeatureTool extends Tool {
  // It picks things, not places: a snap marker would promise a vertex the click does not go to.
  readonly snaps: boolean = false;
  /** The last preview the host built, and the picks and values it was built for. */
  private shown: FeaturePreview | null = null;
  private shownFor = "";
  /** What the preview in flight, or the last one asked for, was asked for. */
  private asked = "";
  /** The last refusal a preview said aloud, so a preview asked again does not say it again. */
  private told = "";
  /** Set while a confirm's lines go in: a second Enter must not type them twice. */
  private committing = false;
  /** What the mode left at auto comes to for the preview up — and a choice to offer — or null. */
  private hint: FeatureDialog["choice"] = null;

  /** The steps a confirm would run with `values`, or null while the picks are not enough. */
  protected abstract plan(values: Record<string, unknown>): FeatureStep[] | null;
  /** The picks, as text — what a preview is keyed by, beside the values. */
  protected abstract picksKey(): string;
  /** Drops every pick, answering whether there was one. */
  protected abstract dropPicks(): boolean;
  /** What to say when ✓ or Enter comes before the picks are enough; null when nothing is picked at all. */
  protected abstract wanting(): string | null;

  /** The values a preview and a confirm use: the armed options, with whatever the panel holds mid-edit laid over them. */
  protected values(): Record<string, unknown> {
    return { ...this.ctx.options, ...(this.ctx.trial ?? {}) };
  }

  /** The picks, the values and the model's shape, as one key — when any differs, the preview is stale. */
  private signature(): string {
    const m = this.ctx.model;
    return `${this.picksKey()}\n${JSON.stringify(this.values())}\n${m.journal.length}:${m.entities.size}`;
  }

  /**
   * Asks for the preview again if it is stale — from `render`, which every
   * change already reaches, so nothing has to remember to call it. The answer
   * arrives later (the copy is built by the command machinery, which is
   * asynchronous); until it does, the previous preview stays up rather than
   * flickering out, unless there is nothing left to preview at all.
   */
  private refreshPreview(): void {
    if (this.committing) return;
    const steps = this.ctx.preview ? this.plan(this.values()) : null;
    if (!steps) {
      this.shown = null;
      this.asked = this.shownFor = "";
      return;
    }
    const sig = this.signature();
    if (sig === this.asked) return;
    this.asked = sig;
    void this.ctx.preview!(steps).then((p) => {
      if (this.asked !== sig) return; // superseded while it was built
      this.shown = p;
      this.shownFor = sig;
      this.hint = this.modeHint(p);
      if (p.error && p.error !== this.told) this.guide(p.error);
      this.told = p.error ?? "";
      this.ctx.requestRender();
    }, () => { /* a copy that could not be made previews nothing; the commit will say why */ });
  }

  /** The preview's refusal for the picks and values as they are now, if it has one. */
  private refused(): string | null {
    return this.shown?.error && this.shownFor === this.signature() ? this.shown.error : null;
  }

  /**
   * The chip's words (docs/plans/mode-feedback.md): **"✓ to extrude"** once a
   * confirm would build something, else what the picks still want
   * (`picking`). A preview the call refuses is said by its guidance, not here:
   * the chip's third part shows that guidance while it is fresh.
   */
  next(hand: Hand): string | null {
    if (this.committing) return null;
    if (this.plan(this.values()) !== null && this.refused() === null) return `✓ to ${this.verb}`;
    return this.picking(hand);
  }

  /** What ✓ does, after "✓ to": the tool's name, which is its verb for extrude and revolve. */
  protected get verb(): string {
    return this.name;
  }

  /** What the picks still want, as the chip says it: a region, by default — the extrude tool's one stage. */
  protected picking(hand: Hand): string {
    return `${press(hand)} inside a closed shape`;
  }

  dialog(): FeatureDialog {
    const choice = this.values().mode === "auto" && this.shownFor === this.signature() ? this.hint : null;
    return { ready: !this.committing && this.plan(this.values()) !== null && this.refused() === null, ...(choice ? { choice } : {}) };
  }

  /**
   * What `mode: "auto"` comes to for a preview — read off the copy's new
   * features, which the same call made — and whether to offer Cut: when the
   * default adds and the solid runs into the body's material, an add would
   * change nothing, and the spec's "a negative depth into a body offers it".
   * Offered, not chosen: cut is always the user's choice (modes.ts). Said once
   * in the log when it first applies, as guidance.
   */
  private modeHint(p: FeaturePreview): FeatureDialog["choice"] {
    if (!p.model || !("mode" in this.values())) return null;
    let resolved: string | null = null;
    let offer: string | null = null;
    let body = "";
    for (const name of p.features) {
      const f = p.model.features.get(name);
      if (!f) continue;
      resolved = modeOf(f);
      if (resolved === "add") {
        try {
          const d = defaultMode(p.model, f);
          if (d.into_material) [offer, body] = ["cut", d.into ?? ""];
        } catch {
          // The hint is a courtesy; a profile it cannot read offers nothing.
        }
      }
    }
    const was = this.hint?.offer ?? null;
    if (offer && offer !== was && this.values().mode === "auto" && this.ctx.log) {
      this.ctx.log(`${this.name}: this runs into ${body} — choose Cut to take it away; as it is, it adds`, "guide");
    }
    return { option: "mode", resolved, offer };
  }

  /**
   * ✓, Enter, or the second click. Not enough picked says what is missing; a
   * preview that was refused says why, and builds nothing; otherwise the lines
   * are typed as one user action, and once they are in, the picks go and the
   * tool is released. Answers false only when nothing was picked at
   * all, so an Enter then is the host's to keep.
   */
  confirm(): boolean {
    if (this.committing) return true;
    const steps = this.plan(this.values());
    if (!steps) {
      const why = this.wanting();
      if (why === null) return false;
      this.guide(why);
      return true;
    }
    const refused = this.refused();
    if (refused) {
      this.guide(refused);
      return true;
    }
    const ctx = this.ctx;
    const model = ctx.model;
    const before = new Set(model.features.keys());
    const report = () => {
      for (const f of model.features.keys()) if (!before.has(f)) ctx.log?.(describeFeature(model, model.featureOf(f)), "done");
    };
    if (!ctx.perform) {
      try {
        runDirect(model, steps);
      } catch (e) {
        this.refuse(e);
        return true;
      }
      this.done();
      ctx.requestSolve();
      report();
      return true;
    }
    this.committing = true;
    void ctx.perform(steps).then((ok) => {
      this.committing = false;
      // Refused part-way, the host has said why in red (it is the command
      // line's refusal, of a line the user can read); the picks stay, so the
      // next click can change them.
      if (ok) this.done();
      report();
      ctx.requestRender();
    });
    return true;
  }

  /**
   * After a commit: nothing picked, nothing previewed, and **the tool
   * released**, as Onshape's ✓ closes its feature dialog. Kept armed, the tool
   * lit every region it could take next, and every face of the solid it had
   * just built is one, so a finished solid glowed like the preview it
   * replaced (seen in the browser after the opaque-solids merge). A refused
   * confirm never gets here: its picks stay for the next click.
   */
  private done(): void {
    this.dropPicks();
    this.shown = null;
    this.asked = this.shownFor = this.told = "";
    this.ctx.finish();
  }

  clear(): boolean {
    if (this.committing) return true;
    const had = this.dropPicks();
    this.shown = null;
    this.asked = this.shownFor = this.told = "";
    this.ctx.requestRender();
    return had;
  }

  retune(): void {
    this.ctx.requestRender();
  }

  retry(): void {
    this.ctx.requestRender();
  }

  onCancel(): void {
    this.dropPicks();
    this.hint = null;
    this.shown = null;
    this.asked = this.shownFor = this.told = "";
    this.ctx.requestRender();
  }

  /**
   * A click the tool cannot use: one line of guidance — muted, the tool still
   * armed, never red (docs/plans/effortless.md, rule 2) — or a throw headless,
   * where a caller is the only one listening.
   */
  protected guide(why: string): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw new Error(why);
    this.ctx.log(`${this.name}: ${why}`, "guide");
  }

  /** `guide` for a caught refusal: headless, the refusal itself is rethrown, as the tools always did. */
  protected refuse(e: unknown): void {
    this.ctx.requestRender();
    if (!this.ctx.log) throw e;
    this.ctx.log(`${this.name}: ${message(e)}`, "guide");
  }

  /** The preview as last built, if one is up — what a subclass draws more of its own from. */
  protected previewed(): FeaturePreview | null {
    return this.shown?.model ? this.shown : null;
  }

  /** The preview, if one is up — the subclass's `render` calls this last, over its picks. */
  protected renderPreview(r: RenderContext): void {
    this.refreshPreview();
    if (this.shown) drawPreview(r, this.shown, this.previewFeatures(this.shown));
  }

  /**
   * Which of the copy's features the preview draws: the new ones — what a
   * creating confirm adds. The edit dialog draws the one it edits, which the
   * original has too.
   */
  protected previewFeatures(p: FeaturePreview): readonly string[] {
    return p.features;
  }
}

/**
 * A preview, drawn: the copy's new solids in the solid look — the faces that
 * face the viewer, far to near, each in the shade a made solid's face would
 * have — at `PREVIEW_ALPHA`, so it reads as not made yet and the drawing shows
 * through; and the copy's new edges (a lid's, a wall's, a fillet's arc) over
 * them in the tools' green, which is what says "this is what ✓ builds".
 */
export function drawPreview(r: RenderContext, p: FeaturePreview, features: readonly string[] = p.features): void {
  const model = p.model;
  if (!model) return;
  const toward = r.toward ?? [0, 0, 1];
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
  const faces: { face: Face; shade: number; depth: number; cut: boolean }[] = [];
  for (const name of features) {
    let found: Face[];
    let cut = false;
    try {
      const f = model.featureOf(name);
      // What a cut takes away is shown as the solid it takes, in a warm tint —
      // the tool, not the result — so it reads at once as "this goes".
      cut = modeOf(f) === "cut" || modeOf(f) === "intersect";
      found = featureFaces(model, f, r.scale);
    } catch {
      continue;
    }
    for (const face of found) {
      const shade = dot(face.normal, toward);
      if (shade > 1e-9) faces.push({ face, shade: Math.min(1, shade), depth: dot(face.centroid, toward), cut });
    }
  }
  faces.sort((a, b) => a.depth - b.depth);
  const g = r.g;
  g.save();
  g.globalAlpha = PREVIEW_ALPHA;
  for (const { face, shade, cut } of faces) {
    g.beginPath();
    for (const o of face.outlines) {
      const pts = o.map((w) => r.worldToScreen(w));
      g.moveTo(...pts[0]);
      for (const q of pts.slice(1)) g.lineTo(...q);
      g.closePath();
    }
    g.fillStyle = cut ? cutColour(shade) : faceColour(shade);
    g.fill("evenodd");
  }
  g.restore();
  g.save();
  g.strokeStyle = REGION_GREEN;
  g.lineWidth = 1.8;
  g.lineJoin = "round";
  for (const name of p.entities) {
    const e = model.entities.get(name);
    let pts: number[][] | null = null;
    if (e?.kind === "line") pts = [model.coords(e.refs[0]), model.coords(e.refs[1])];
    else if (e?.kind === "arc" || e?.kind === "circle" || e?.kind === "ellipse") {
      const f = curveFrame(model, e);
      if (f) pts = arcSamples(f, arcSegments(f.sweep, frameReach(f) * r.scale));
    }
    if (!pts || pts.length < 2) continue;
    g.beginPath();
    g.moveTo(...r.worldToScreen(pts[0]));
    for (const q of pts.slice(1)) g.lineTo(...r.worldToScreen(q));
    g.stroke();
  }
  g.restore();
}
