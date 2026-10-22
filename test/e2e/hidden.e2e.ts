// Hidden edges, dimmed, in a browser (docs/plans/hidden-edges.md).
//
// The rule: the drawing stays on top of the solid and still picks, snaps and
// drags as before; only the *ink* of the part of an edge behind a face changes,
// to a dimmed one. Points, names and glyphs are never dimmed.
//
// A plain sketch, with no solid, must draw exactly as it did before the pass
// existed — not "about the same": the pass is off when there are no faces. That
// is held against a picture the previous build drew of the same scene
// (`golden/hidden-plain-sketch.png`, recorded from the commit before this
// package with NEOCAD_E2E_GOLDEN_RECORD set; see `plainSketch`).
//
// Set NEOCAD_E2E_SHOTS to a directory to keep the screenshots; look at them.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { axisFrame, openApp, type AppContext } from "./harness.ts";
import { HELPERS, look } from "./scenes.ts";

const SHOTS = process.env.NEOCAD_E2E_SHOTS;
const GOLDEN = new URL("./golden/hidden-plain-sketch.png", import.meta.url).pathname;
const opened: AppContext[] = [];
after(async () => { for (const a of opened) await a.close(); });

async function fresh(): Promise<AppContext> {
  const app = await openApp();
  opened.push(app);
  return app;
}

async function shot(app: AppContext, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await app.page.screenshot({ path: join(SHOTS, `hidden-${name}.png`) });
}

/**
 * A sketch with no solid and every kind of mark the entity pass draws: lines
 * held by constraints (so glyphs), a circle, an arc, points and their names, and
 * the default frame's arms — turned, so the frame's +z arm is drawn too.
 */
const PLAIN = `ls = poly([[0,0,0],[40,0,0],[40,30,0],[0,30,0]], "f");
  par(ls[0], xaxis()); perp(ls[0], ls[1]);
  c = P([60,15,0]); onplane(c, "f"); model.addCircle(c, 10, "f");
  a = P([20,-20,0]); onplane(a, "f"); model.addArc(a, null, null, 8, "f");
  solve(); refresh(); "plain"`;

/** The drawing canvas, whole, as PNG bytes — the picture the entity pass made. */
const drawingPNG = async (app: AppContext): Promise<Buffer> => Buffer.from(
  (await app.page.$eval("#cv", (el) => (el as HTMLCanvasElement).toDataURL("image/png"))).split(",")[1], "base64");

test("a sketch with no solid draws pixel for pixel what the previous build drew", async () => {
  const app = await fresh();
  await axisFrame(app, [-20, 45]);
  for (const src of [HELPERS, PLAIN]) {
    const r = await app.repl(src);
    assert.equal(r.ok, true, `${src}\n→ ${r.error}`);
  }
  await look(app, 0.5, 0.4, 0.3, [140, -50]);
  const png = await drawingPNG(app);
  await shot(app, "plain-sketch");
  if (process.env.NEOCAD_E2E_GOLDEN_RECORD) {
    writeFileSync(GOLDEN, png);
    return;
  }
  // Decoded in the page, both, so the comparison is of pixels and not of how
  // two encoders happened to compress the same ones.
  const diff = await app.page.evaluate(async ([now, then]) => {
    const decode = async (b64: string) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const c = document.createElement("canvas");
      [c.width, c.height] = [img.width, img.height];
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height);
    };
    const [a, b] = [await decode(now), await decode(then)];
    if (a.width !== b.width || a.height !== b.height) return { size: `${a.width}×${a.height} against ${b.width}×${b.height}`, differing: -1, inked: 0 };
    let differing = 0, inked = 0;
    for (let k = 0; k < a.data.length; k += 4) {
      if (b.data[k + 3] > 0) inked++;
      if (a.data[k] !== b.data[k] || a.data[k + 1] !== b.data[k + 1] || a.data[k + 2] !== b.data[k + 2] || a.data[k + 3] !== b.data[k + 3]) differing++;
    }
    return { size: "", differing, inked };
  }, [png.toString("base64"), readFileSync(GOLDEN).toString("base64")]);
  assert.equal(diff.size, "", "the same canvas size as the recorded picture");
  assert.ok(diff.inked > 2000, `the recorded picture has a drawing in it (${diff.inked} inked pixels)`);
  assert.equal(diff.differing, 0, "not one pixel differs from the previous build's");
});

test("no uncaught page errors", () => {
  for (const a of opened) assert.deepEqual(a.pageErrors, []);
});
