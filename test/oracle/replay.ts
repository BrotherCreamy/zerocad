// Replaying an oracle recipe headlessly and measuring what the kernel builds
// (docs/plans/oracle.md). A recipe is command lines — what the command line
// takes, `Repl` over `neocadScope`, as test/clauses.test.ts runs them — with
// one line form the command line has not got: `cut([x, y, z], depth, "through")`,
// the Cut tool pressed at a world point. The owner's lens is such a cut: the
// region under the finger shares every member with its neighbours, so no
// typed `extrude(member …)` can name it (the call refuses, listing three
// loops), and the journal's `region(member, frame, face)` resolves to the
// wrong loop (bug 87). The stand-in does exactly what the tool does: the
// innermost loop around the point, `cutWay` for the sign, `extrudeSteps` for
// the call — so a recipe is still readable by a person who knows the app.

import { readFile } from "node:fs/promises";
import { Model } from "../../src/model.ts";
import { Repl } from "../../src/repl.ts";
import { neocadScope } from "../../src/replenv.ts";
import { findLoops, loopAround } from "../../src/loops.ts";
import { cutWay, extrudeSteps } from "../../src/tools/extrude.ts";
import type { RegionHit } from "../../src/tools/tool.ts";
import type { FeatureOptions } from "../../src/operations.ts";
import { programOf } from "../../src/bodies.ts";
import { Evaluator } from "../../src/solids/evaluate.ts";
import type { SolidKernel, V3 } from "../../src/solids/kernel.ts";

/** A case's recipe, one command per line; blank lines and `#` comments left out. */
export async function recipeLines(name: string): Promise<string[]> {
  const text = await readFile(new URL(`./${name}/recipe.txt`, import.meta.url), "utf8");
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

const CUT = /^cut\((\[[^\]]*\]),\s*(-?[\d.]+)(?:,\s*"(through|symmetric|blind)")?\)$/;

/**
 * Runs a recipe against a fresh 3D model and solves it. Every line is typed
 * at the command line, except the Cut tool's press (see the header), which is
 * made the way the tool makes it and then typed as the line the tool types.
 */
export async function replay(lines: readonly string[], model = new Model(3)): Promise<{ model: Model; log: string[]; typed: string[] }> {
  const log: string[] = [];
  const typed: string[] = [];
  const repl = new Repl(neocadScope({ model, log: (s: string) => { log.push(s); } }));
  const type = async (src: string) => {
    typed.push(src);
    const r = await repl.eval(src);
    if (!r.ok) throw new Error(`${src} — refused: ${r.error?.message}`);
    return r.value;
  };
  for (const line of lines) {
    const m = CUT.exec(line);
    if (!m) { await type(line); continue; }
    const at = JSON.parse(m[1]) as number[];
    const depth = Number(m[2]);
    const end = m[3] && m[3] !== "blind" ? (m[3] as "through" | "symmetric") : undefined;
    model.solve();
    const all = findLoops(model);
    const loop = loopAround(model, at, all);
    if (!loop) throw new Error(`${line} — nothing closed around ${at}`);
    const hit: RegionHit = { loops: all, index: all.indexOf(loop), toward: loop.plane.normal, at };
    // The Cut tool's depth is how far into the material; which way that is
    // along the sketch's normal is read off the bodies (`cutWay`, bug 80).
    const way = cutWay(model, hit, depth, end).way;
    const options: FeatureOptions = end ? { mode: "cut", end } : { mode: "cut" };
    const step = extrudeSteps(hit, way * depth, true, [], options)[0](model);
    if (step && "text" in step && step.text) await type(step.text);
    else if (step && "call" in step) { typed.push(`${line}  (the tool made it directly: a profile through crossings no point marks yet)`); step.call(); }
    else throw new Error(`${line} — the tool planned nothing`);
  }
  model.solve();
  return { model, log, typed };
}

export interface Measured {
  /** Bodies the kernel built a solid for. */
  bodies: number;
  volume: number;
  area: number;
  bbox: [V3, V3];
  centroid: V3;
  faces: number;
  manifold: boolean;
  failures: number;
  /** Features the solids layer left out before the kernel saw them, and nodes the kernel refused. */
  skipped: string[];
  failed: string[];
  ms: number;
}

/**
 * Every body of the model through the kernel, single features too
 * (`programOf(model, true)`, as test/bodies.test.ts's `evaluateAll`): the
 * first body's measures. The area is the faces' areas summed — the kernel's
 * `faces` carry each one's — and the centroid is the mass-properties pass.
 */
export function measure(k: SolidKernel, model: Model): Measured {
  const t0 = performance.now();
  const prog = programOf(model, true);
  const ev = new Evaluator(k);
  try {
    const res = ev.run(prog.program);
    const built = res.bodies.filter((b) => b.solid);
    const first = built[0];
    if (!first?.solid) {
      throw new Error(`no body built: skipped ${JSON.stringify(prog.skipped)}, failed ${JSON.stringify(res.bodies.map((b) => b.failed))}`);
    }
    const s = first.solid;
    return {
      bodies: built.length,
      volume: s.volume,
      area: s.faces.reduce((a, f) => a + f.area, 0),
      bbox: s.box,
      centroid: ev.centroid(first.name) ?? [NaN, NaN, NaN],
      faces: s.faces.length,
      manifold: s.validity.manifold,
      failures: s.validity.failures,
      skipped: prog.skipped.map((x) => `${x.feature}: ${x.why}`),
      failed: res.bodies.flatMap((b) => b.failed.map((f) => `${b.name}#${f.node}: ${f.why}`)),
      ms: performance.now() - t0,
    };
  } finally {
    ev.clear();
  }
}
