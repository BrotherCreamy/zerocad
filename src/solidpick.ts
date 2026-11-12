// What a hand on a solid is aiming at, SolidWorks' way — a vertex before an
// edge before a face (docs/plans/smart-dimension.md). The owner: *"I should
// be able to use it to dimension virtually anything. Distance between two
// faces of a solid, or angle"*.
//
// Faces have never picked (ARCHITECTURE.md: "Faces are display only"), and
// for everything that was built on that — the hover, the selection, the
// menu, a drag — they still do not. A tool that takes faces asks here
// instead, through `ToolContext.pickSolid`: the ordinary pick first (a point,
// a curve, a line, a kernel edge, each within its reach, a finger's included),
// and only where that finds nothing, the face the pixel lands on. One
// function, so the dimension tool and a relation to a face (the relations
// package's) pick the same face under the same pixel.
//
// **The face is the front one the pixel lands on**, asked of the faces the
// frame drew (main.ts hands them over each frame, with their occlusion
// answer, built once) — occlusion.ts's `nearestFace`, the e2e oracle's own
// question, so the face picked is the face shown. A face has no reach: it is
// under the pixel or it is not. A drawn face carries the kernel's tag (`e1.lid`,
// `e1.m3` — faces.ts's `Face.name`), whichever built the body; the pick is
// handed on under the face's **written** name, the entity a wall is swept from
// (`e1:l2`), by the function the host gives (`written`, the engine's:
// solidref.ts's `faceRef`), and a face is lit by the tags its name is this
// build (`faceShade`, handed `faceKernelNames`). In the wire view no faces
// are drawn, so none pick.
//
// Pure: faces, an occlusion over them, a pixel — no canvas, no model state.

import type { Face } from "./faces.ts";
import { nearestFace, visibleRuns, type Occlusion } from "./occlusion.ts";
import type { View } from "./view.ts";
import type { Pick } from "./picking.ts";

/** The faces drawn this frame and the occlusion answer built over them — in the same order. */
export interface DrawnFaces {
  faces: readonly Face[];
  occ: Occlusion;
}

/**
 * The named face nearest the viewer under (sx, sy), or null — with its outward
 * normal and a point of the piece drawn there (`at`, a corner of its outline),
 * which together are the piece's plane: where a click on a round face lands
 * (docs/plans/click-on-face.md).
 */
export function faceUnder(drawn: DrawnFaces | null, sx: number, sy: number): { name: string; feature: string; normal: number[]; at: number[] } | null {
  if (!drawn) return null;
  const hit = nearestFace(drawn.occ, sx, sy);
  if (!hit) return null;
  const f = drawn.faces[hit.index];
  return f?.name ? { name: f.name, feature: f.feature, normal: f.normal, at: f.outlines[0][0] } : null;
}

/**
 * **What a hand on a solid picks**: `pick`'s answer (vertex, edge — a line,
 * a curve, a kernel edge — or a sketch's own geometry) where there is one,
 * else the face under the pixel as a `kind: "face"` pick, said by `describe`.
 * A glyph `pick` found is passed on as it is: whether a label under the hand
 * is a place to put another is the tool's question. `written` turns the drawn
 * face's tag into the name a relation holds (a wall's entity, not its place).
 */
export function pickSolid(pick: Pick | null, drawn: DrawnFaces | null, sx: number, sy: number,
  describe: (face: string) => string, written: (tag: string) => string = (tag) => tag): Pick | null {
  if (pick) return pick;
  const f = faceUnder(drawn, sx, sy);
  if (!f) return null;
  const name = written(f.name);
  return { name, kind: "face", distance: 0, body: f.feature, tag: describe(name) };
}

/** How finely a lit face is filled, in screen pixels: the cell a face is asked whether it is in front at. */
export const SHADE_PX = 3;

/**
 * **A face lit as it is seen**: the screen cells (`SHADE_PX` square, by their
 * top-left corners) where it is the face in front, and the runs of its
 * outlines in sight. A face's whole outline filled would show through the
 * face in front of it — seen in the browser: the back wall of a step lit
 * across the front one — and a 2D canvas has no depth test to stop it, so the
 * same question the pick asks (`nearestFace`) is asked cell by cell, over the
 * face's own screen box only. `tags` is the drawn faces' own names — one, or
 * every place a wall named by its entity is drawn as this build.
 */
export function faceShade(drawn: DrawnFaces | null, tags: string | readonly string[], view: View): { cells: [number, number][]; runs: [number, number][][] } {
  if (!drawn) return { cells: [], runs: [] };
  const wanted = new Set(typeof tags === "string" ? [tags] : tags);
  const mine = new Set<number>();
  drawn.faces.forEach((f, i) => { if (f.name !== undefined && wanted.has(f.name)) mine.add(i); });
  if (!mine.size) return { cells: [], runs: [] };
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const i of mine) {
    const b = drawn.occ.faces[i]?.box;
    if (!b) continue;
    [x0, y0, x1, y1] = [Math.min(x0, b[0]), Math.min(y0, b[1]), Math.max(x1, b[2]), Math.max(y1, b[3])];
  }
  const cells: [number, number][] = [];
  if (Number.isFinite(x0)) {
    for (let y = Math.floor(y0); y < y1; y += SHADE_PX) {
      for (let x = Math.floor(x0); x < x1; x += SHADE_PX) {
        const hit = nearestFace(drawn.occ, x + SHADE_PX / 2, y + SHADE_PX / 2);
        if (hit && mine.has(hit.index)) cells.push([x, y]);
      }
    }
  }
  // Its edges as the solid draws them, in sight — the parts a face in front hides left out.
  const runs = [...mine].flatMap((i) => drawn.faces[i].edges.flatMap((e) => visibleRuns(drawn.occ, view, e)));
  return { cells, runs };
}
