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
// under the pixel or it is not. Named as the kernel names it (`e1.lid`,
// `e1.m3` — faces.ts's `Face.name`), whichever built the body. In the wire
// view no faces are drawn, so none pick.
//
// Pure: faces, an occlusion over them, a pixel — no canvas, no model state.

import type { Face } from "./faces.ts";
import { nearestFace, type Occlusion } from "./occlusion.ts";
import type { Pick } from "./picking.ts";

/** The faces drawn this frame and the occlusion answer built over them — in the same order. */
export interface DrawnFaces {
  faces: readonly Face[];
  occ: Occlusion;
}

/** The named face nearest the viewer under (sx, sy), or null. */
export function faceUnder(drawn: DrawnFaces | null, sx: number, sy: number): { name: string; feature: string; normal: number[] } | null {
  if (!drawn) return null;
  const hit = nearestFace(drawn.occ, sx, sy);
  if (!hit) return null;
  const f = drawn.faces[hit.index];
  return f?.name ? { name: f.name, feature: f.feature, normal: f.normal } : null;
}

/**
 * **What a hand on a solid picks**: `pick`'s answer (vertex, edge — a line,
 * a curve, a kernel edge — or a sketch's own geometry) where there is one,
 * else the face under the pixel as a `kind: "face"` pick, said by `describe`.
 * A glyph `pick` found is passed on as it is: whether a label under the hand
 * is a place to put another is the tool's question.
 */
export function pickSolid(pick: Pick | null, drawn: DrawnFaces | null, sx: number, sy: number,
  describe: (face: string) => string): Pick | null {
  if (pick) return pick;
  const f = faceUnder(drawn, sx, sy);
  return f ? { name: f.name, kind: "face", distance: 0, body: f.feature, tag: describe(f.name) } : null;
}
