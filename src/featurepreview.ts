// A feature tool's preview: its commit, run on a copy nobody keeps.
//
// The plan said to derive the preview "from the same expansion the operation
// will run, without journalling" and offered two ways: a throwaway model clone,
// or a pure plan function. The plan function it named (`planExtrude`) does not
// exist — `planSweep` walks a profile's joins and computes no geometry; the
// geometry is the expansion itself, twins seeded and a dimension solved — and a
// preview drawn from a second account of where a lid goes is exactly the
// approximation the plan ruled out. So this is the clone: the model saved and
// opened again (the very round trip every undo step makes), the tool's steps
// typed into a command line over it — the same `neocadScope`, the same
// `Repl`, so the same frame-making and refusals the real command line has —
// solved, and handed back. Whatever the confirm will build, this built.
//
// The copy has a copy of the view, so a line that reads the camera reads the
// one on screen, and nothing a line does can turn it. It has no log: a line's
// output is the commit's to show, once.

import type { Model } from "./model.ts";
import type { View } from "./view.ts";
import type { FeaturePreview, FeatureStep } from "./tools/tool.ts";
import { runSteps } from "./tools/feature.ts";
import { open, save } from "./persist.ts";
import { Repl } from "./repl.ts";
import { neocadScope } from "./replenv.ts";

/**
 * `steps` run on a copy of `model`, through a command line of its own, and the
 * copy solved: what a confirm of the same steps would leave behind, and which
 * features and entities are new on it. A refused step answers its refusal and
 * no copy.
 */
export async function previewSteps(model: Model, view: View | undefined, steps: readonly FeatureStep[]): Promise<FeaturePreview> {
  const copy = open(save(model, false), model.dim);
  const repl = new Repl(neocadScope({ model: copy, ...(view ? { view: structuredClone(view) } : {}) }));
  const error = await runSteps(copy, steps, async (line) => {
    const r = await repl.eval(line.text);
    return r.ok ? null : r.error!.message;
  });
  if (error !== null) return { model: null, features: [], entities: [], error };
  copy.solve();
  return {
    model: copy,
    features: [...copy.features.keys()].filter((f) => !model.features.has(f)),
    entities: [...copy.entities.keys()].filter((e) => !model.entities.has(e)),
    error: null,
  };
}
