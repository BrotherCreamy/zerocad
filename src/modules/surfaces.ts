// The **surfaces** module (docs/plans/surfaces.md): a surface is a thing the
// solid kernel builds as a sheet — extruded or revolved from curves, planar
// from a region, a body's face — and trim, extend, knit, offset, thicken and
// the fillet and chamfer between two are operations on it. The owner: *"please
// add solid and surface fillet tools if possible"*, *"also fillets and
// chamfers for surfaces"*.
//
// **The verbs are shared, told apart by what they are handed** (vetoable,
// TODO.md's register). The sketch already owns `trim`, `extend` and `offset`
// for curves, and the typed `fillet` and `chamfer` are the sketch's corner and
// the solid's edges: each of them, given a surface first (`s1`), is the
// surface's operation, and given anything else is exactly what it was — so a
// typed line can never reach the wrong one silently, and every old file's
// journal replays unchanged (a surface's operations journal under names of
// their own: `trimSurface`, `extendSurface`, `offsetSurface`, `filletSurfaces`,
// `chamferSurfaces`). The tools work the same way: the trim tool trims a
// surface when it is pressed on one, the round and chamfer tools fillet a
// surface's edge, or two surfaces picked in turn. One new button's worth of
// tool, the surface sweep, goes under the extrude button.

import { defineModule } from "../modules.ts";
import { defineDimension } from "../model.ts";
import { defineRebuild } from "../operations.ts";
import { surfaceAngle, surfaceDepth, surfaceDistance } from "../relations/surface.ts";
import {
  extendSurface, knit, offsetSurface, solidify, surface, surfaceBlend, surfaceExtrude, surfaceFace, surfacePlanar,
  surfaceRevolve, thicken, trimSurface,
} from "../surfaces.ts";
import { extend, offset, trim } from "../sketchedit.ts";
import { svg } from "../tools/icons.ts";
import { SurfaceTool } from "../tools/surface.ts";

// The numbers a surface is held by: dimensions with no equation, as a fillet's
// radius is — `set("d5.value", 30)` re-runs them, in place.
defineDimension("surfaceDepth", 0);
defineDimension("surfaceAngle", 0);
defineDimension("surfaceDistance", 0);
defineRebuild("surfaceDepth", (m, a) => void surfaceDepth(m, a[0] as number));
defineRebuild("surfaceAngle", (m, a) => void surfaceAngle(m, a[0] as number));
defineRebuild("surfaceDistance", (m, a) => void surfaceDistance(m, a[0] as number));

const isSurface = (model: { surfaces: Map<string, unknown> }, s: unknown) => typeof s === "string" && model.surfaces.has(s);

defineModule("surfaces", {
  label: "Surfaces: extruded, revolved, planar and face surfaces; trim, extend, knit, offset, thicken, and fillets and chamfers between them",
  tools: {
    // An open or closed chain of curves swept into a sheet: under the extrude
    // button, beside the extrude that sweeps a region into a solid — no button
    // of its own, so an iPhone's column keeps its thirteen.
    surface: SurfaceTool,
  },
  groups: {
    sweep: ["extrude", "surface"],
  },
  icons: {
    // A sheet standing on a curve: the curve's S, and the same S raised over
    // it, joined at the ends — open, so it reads as no slab.
    surface: svg("surface", `<path d="M2 13.5c2-3 4 0 6-2.5s3-3 6-2.5"/><path d="M2 7.5c2-3 4 0 6-2.5s3-3 6-2.5" stroke-dasharray="1.4 1.3"/><path d="M2 13.5v-6M14 8.5v-6"/>`),
  },
  operations: {
    // Each journalled as its typed call with what it read off positions
    // resolved beside it; a replay asks no kernel.
    surfaceExtrude: (model, curves: string | string[], depth: number, frame?: string | null, resolved?: unknown) =>
      surfaceExtrude(model, curves, depth, frame, resolved),
    surfaceRevolve: (model, curves: string | string[], axis: string, angle?: number | null, frame?: string | null, resolved?: unknown) =>
      surfaceRevolve(model, curves, axis, angle, frame, resolved),
    surfacePlanar: (model, member: string, frame?: string | null, loops?: unknown) => surfacePlanar(model, member, frame, loops),
    surfaceFace: (model, face: string) => surfaceFace(model, face),
    trimSurface: (model, s: string, by: string, keep: unknown, frame?: string | null) => trimSurface(model, s, by, keep, frame),
    extendSurface: (model, s: string, edge: string, d: number) => extendSurface(model, s, edge, d),
    knit: (model, s: string, ...rest: unknown[]) => knit(model, s, ...rest),
    offsetSurface: (model, s: string, d: number) => offsetSurface(model, s, d),
    thicken: (model, s: string, d: number) => thicken(model, s, d),
    solidify: (model, s: string) => solidify(model, s),
    filletSurfaces: (model, s: string, other: unknown, size: number, keeps?: unknown) => surfaceBlend(model, "fillet", s, other, size, keeps),
    chamferSurfaces: (model, s: string, other: unknown, size: number, keeps?: unknown) => surfaceBlend(model, "chamfer", s, other, size, keeps),
  },
  commands: (kit) => ({
    surface: (what: unknown, ...rest: unknown[]) => surface(kit.model, what, ...rest),
    knit: (s: unknown, ...rest: unknown[]) => knit(kit.model, s, ...rest),
    thicken: (s: unknown, d: unknown) => thicken(kit.model, s, d),
    solidify: (s: unknown) => solidify(kit.model, s),
    // The sketch's verbs, given a surface first, are the surface's; given
    // anything else, exactly the sketch's (forwarding every argument, so a
    // line copied out of a journal still types).
    trim: (first: unknown, second: unknown, third?: unknown, fourth?: unknown) => {
      if (isSurface(kit.model, first)) return trimSurface(kit.model, first, second, third, fourth as string | null | undefined);
      const notes: string[] = [];
      const out = trim(kit.model, first as string, second, third, fourth, notes);
      for (const n of notes) kit.log?.(n);
      return out;
    },
    extend: (first: unknown, second: unknown, third?: unknown, fourth?: unknown) =>
      isSurface(kit.model, first)
        ? extendSurface(kit.model, first, second, third)
        : extend(kit.model, first as string, second, third as string | null | undefined, fourth),
    offset: (first: unknown, d: unknown, options?: unknown, resolved?: unknown) =>
      isSurface(kit.model, first)
        ? offsetSurface(kit.model, first, d)
        : offset(kit.model, first as string | string[], d as number, options as { construction?: boolean } | null | undefined, resolved),
    // The journal's names, typed as they are journalled.
    surfaceExtrude: (curves: string | string[], depth: number, frame?: string | null, resolved?: unknown) =>
      surfaceExtrude(kit.model, curves, depth, frame, resolved),
    surfaceRevolve: (curves: string | string[], axis: string, angle?: number | null, frame?: string | null, resolved?: unknown) =>
      surfaceRevolve(kit.model, curves, axis, angle, frame, resolved),
    surfacePlanar: (member: string, frame?: string | null, loops?: unknown) => surfacePlanar(kit.model, member, frame, loops),
    surfaceFace: (face: string) => surfaceFace(kit.model, face),
    trimSurface: (s: string, by: string, keep: unknown, frame?: string | null) => trimSurface(kit.model, s, by, keep, frame),
    extendSurface: (s: string, edge: string, d: number) => extendSurface(kit.model, s, edge, d),
    offsetSurface: (s: string, d: number) => offsetSurface(kit.model, s, d),
    filletSurfaces: (s: string, other: unknown, size: number, keeps?: unknown) => surfaceBlend(kit.model, "fillet", s, other, size, keeps),
    chamferSurfaces: (s: string, other: unknown, size: number, keeps?: unknown) => surfaceBlend(kit.model, "chamfer", s, other, size, keeps),
  }),
  help: [
    "surfaces   A surface is a sheet the solid kernel builds — no inside, edges",
    "           bounding one face — named s1, s2, … and listed under Surfaces in",
    "           the organiser. Nothing is a negative surface: trim, extend,",
    "           knit, offset, thicken and the fillet between two are operations.",
    '           surface("l1", 20) sweeps the chain through l1 (open or closed)',
    '           20 along its plane\'s normal, no caps; surface(["l1", "a2"], 20)',
    '           just those. surface("l1", "l9", angle?) turns it about an axis',
    '           (a whole turn left out). surface("rg1") or surface("l1") alone',
    '           is the planar face a region or a loop bounds; surface("e1.lid")',
    "           a body's face on its own. The surface tool (the extrude",
    "           button's flyout): click curves, set the depth, ✓.",
    '           trim("s1", "l5", [x, y, z]) cuts s1 by a curve projected along',
    "           its plane's normal, or by another surface where it crosses,",
    "           keeping the side the point is on; the trim tool: press on the",
    "           surface where it is kept, then click the curve or surface.",
    '           extend("s1", "s1.m0|s1.lid", 5) lengthens a swept surface at a',
    "           boundary edge (hover an edge for its name): the sweep at its",
    "           base or lid, the curve at an open end.",
    '           knit("s1", "s2", …) — one sheet where their edges meet (within',
    "           a micron; { tolerance: 0.01 } says more); s2 is part of s1 then.",
    '           offset("s1", 3) a new surface along s1\'s normals.',
    '           thicken("s1", 2) a solid of it (negative: the other side);',
    '           solidify("s1") closes a closed knit into a solid.',
    '           fillet("s1", "s2", 3) rounds where they meet — knitted, their',
    "           shared edge; not yet, each trimmed back to the other where they",
    '           cross (the larger piece; or fillet("s1", "s2", 3, [p, q]) the',
    '           sides of p and q) and knitted first. chamfer("s1", "s2", 2) the',
    '           same with a flat. fillet("s1", ["s1.m0|s1.m1"], 3) rounds a',
    "           surface's own edges. The round and chamfer tools do all of it:",
    "           click an edge of a surface, or a surface and then another.",
    "           Given anything but a surface first, trim, extend, offset, fillet",
    "           and chamfer are the sketch's and the solid's, as ever.",
    "           SMLib does not extend a trimmed face, so extend acts on the",
    "           sweep; and a fillet between two surfaces is trim, knit and the",
    "           edge fillet, since its own face-face blend leaves both untrimmed.",
  ],
});
