// A feature tool's host, for the unit tests: `perform` and `preview` as
// main.ts wires them, minus the page — each line typed into a real command
// line over the model (or, for the preview, over a copy), in order, stopping
// at the first refusal. Shared so every test of a feature gesture drives the
// tool exactly the way the app does.

import type { Model } from "../src/model.ts";
import { screenToPlane, viewAxes, type View } from "../src/view.ts";
import { findLoops, loopAt } from "../src/loops.ts";
import type { FeaturePreview, FeatureStep, RegionHit } from "../src/tools/tool.ts";
import { runSteps } from "../src/tools/feature.ts";
import { previewSteps } from "../src/featurepreview.ts";
import type { Repl } from "../src/repl.ts";

/** The engine's `regionAt`, answered from `view`: the loop under a pixel, with where the pixel's ray met its plane. */
export function regionAtFor(model: Model, view: View): (screen: [number, number]) => RegionHit | null {
  return ([sx, sy]) => {
    const loops = findLoops(model);
    const loop = loopAt(model, view, sx, sy, loops);
    if (!loop) return null;
    const { origin, u, v } = loop.plane;
    const at = screenToPlane(view, sx, sy, { origin, u, v });
    return at ? { loops, index: loops.indexOf(loop), toward: viewAxes(view).toward, at } : null;
  };
}

export interface FeatureHost {
  perform(steps: FeatureStep[]): Promise<boolean>;
  preview(steps: FeatureStep[]): Promise<FeaturePreview>;
  /** Every line a confirm typed, in order. */
  typed: string[];
  /** Every refusal a confirm met, in its own words. */
  refused: string[];
  /** How many confirms there were — each one user action, one undo step, in the app. */
  performs: number;
  /** Settles once every confirm and preview asked for so far has. */
  settled(): Promise<void>;
}

export function featureHost(model: Model, repl: Repl, view?: View): FeatureHost {
  const pending: Promise<unknown>[] = [];
  const h: FeatureHost = {
    typed: [], refused: [], performs: 0,
    perform(steps) {
      h.performs++;
      const p = runSteps(model, steps, async (line) => {
        h.typed.push(line.text);
        const r = await repl.eval(line.text);
        return r.ok ? null : r.error!.message;
      }).then((err) => {
        if (err !== null) h.refused.push(err);
        model.solve();
        return err === null;
      });
      pending.push(p);
      return p;
    },
    preview(steps) {
      const p = previewSteps(model, view, steps);
      pending.push(p);
      return p;
    },
    async settled() {
      while (pending.length) await pending.shift();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
  return h;
}
