// The **solids** module (docs/plans/workbenches.md): extrude, revolve and
// sketch on a face; the feature edit dialog; and the operations a file replays
// for them — `extrude`, `revolve`, `regen`. The bodies kernel (src/solids/,
// the Worker) is the host's (main.ts constructs its client); this module is
// what the command line and the tray know of solids.

import { defineModule } from "../modules.ts";
import { defineDimension } from "../model.ts";
import { defineRebuild, extrude, regen, revolve, setEnd } from "../operations.ts";
import { chamferEdges, filletEdges, setEdges } from "../blends.ts";
import { chamferSetback, filletRadius } from "../relations/blend.ts";

// A fillet's radius and a chamfer's setback are dimensions — `d`-named, `set`
// re-runs them — but not typed relations: one with no fillet round it would be
// a number holding nothing. So they are declared here, as `extrusion` is in
// model.ts, rather than as a module relation, which would put them on the
// command line.
defineDimension("filletRadius", 0);
defineDimension("chamferSetback", 0);
defineRebuild("filletRadius", (m, a) => void filletRadius(m, a[0] as number));
defineRebuild("chamferSetback", (m, a) => void chamferSetback(m, a[0] as number));
import { svg } from "../tools/icons.ts";
import { CutTool, ExtrudeTool } from "../tools/extrude.ts";
import { RevolveTool } from "../tools/revolve.ts";
import { SketchTool } from "../tools/sketch.ts";
import { EditExtrudeTool, EditRevolveTool } from "../tools/edit.ts";
import { EdgeChamferTool, EdgeFilletTool, EditChamferTool, EditFilletTool } from "../tools/blend.ts";

defineModule("solids", {
  label: "Solids: extrude, revolve, sketch on a face, bodies, fillets and chamfers of their edges",
  tools: {
    extrude: ExtrudeTool,
    // Extrude's cut, a tool of its own (docs/plans/solid-tools-intuitive.md): into
    // the material by default, typed as the extrude it is.
    cut: CutTool,
    revolve: RevolveTool,
    sketch: SketchTool,
    // A dialog armed on a feature (`edit("e1")`), never from the tray.
    "edit extrude": { ctor: EditExtrudeTool, listed: false },
    "edit revolve": { ctor: EditRevolveTool, listed: false },
    // A body's edges rounded or bevelled (docs/plans/solid-fillets.md), on the
    // modify button beside the sketch's corner fillet — no button of their own,
    // so an iPhone's column keeps its thirteen.
    round: EdgeFilletTool,
    chamfer: EdgeChamferTool,
    "edit fillet": { ctor: EditFilletTool, listed: false },
    "edit chamfer": { ctor: EditChamferTool, listed: false },
  },
  groups: {
    modify: ["round", "chamfer"],
    // Cut beside Extrude on one button, as SolidWorks puts Extruded Cut beside
    // Extruded Boss — no button of its own, so an iPhone's column keeps its
    // thirteen. The surfaces module adds its surface after them.
    sweep: ["extrude", "cut"],
  },
  icons: {
    // A slab seen from above: the face raised off its base, the three vertical
    // edges that can be seen, and the base's two front edges — the back two are
    // behind the slab, and drawn they cross its front face.
    extrude: svg("extrude", `<path d="M2 7.5h7l5-3.5H7zM2 7.5v6h7l5-3.5V4M9 7.5v6"/>`),
    // The same slab, lower, with a hole in its top and an arrow going down into
    // it — what Cut takes away. (The hole's rim alone, at 16 px, read as the
    // extrude's box: looked at in the flyout beside it.)
    cut: svg("cut", `<path d="M2 9.5h7l5-3H7zM2 9.5v4h7l5-3v-4M9 9.5v4"/><ellipse cx="8" cy="8" rx="2.3" ry="0.9"/>` +
      `<path d="M8 1.5v5M6.3 4.9 8 6.6l1.7-1.7"/>`),
    // A profile inside the turn that sweeps it: three quarters of a circle,
    // arrowed so it reads as a motion rather than a third shape. (An axis drawn
    // through it, and the turn as a foreshortened ellipse, were tried first: at
    // 16 px the two read as an anchor.)
    revolve: svg("revolve", `<rect x="5.75" y="6.75" width="4.5" height="3.5" rx="1"/>` +
      `<path d="M13.5 8.5A5.5 5.5 0 1 1 8 3"/><path d="M6.6 1.4 8.6 3 6.6 4.6"/>`),
    // A plane in perspective with a pencil on it: drawing on a face.
    sketch: svg("sketch", `<path d="M1.5 13.5h9l4-4h-3"/><path d="M1.5 13.5l4-4h1.5"/>` +
      `<path d="M6.5 10.5l1-3L13 2l2 2-5.5 5.5zM11.5 3.5l2 2"/>`),
    // A block's end seen a little from the side, its top front edge rounded
    // (the edge chamfer's bevelled): the solid's fillet, told from the
    // sketch's flat quarter-round corner beside it by the depth.
    round: svg("round", `<path d="M2 14h8V8.5A4 4 0 0 0 6 4.5H2z"/><path d="M6 4.5l3-2.5h1A4 4 0 0 1 14 6v5.5L10 14"/><path d="M10 8.5l4-2.5"/>`),
    chamfer: svg("chamfer", `<path d="M2 14h8V8L6.5 4.5H2z"/><path d="M6.5 4.5 9.5 2h1L14 5.5v6L10 14"/><path d="M10 8l4-2.5"/>`),
  },
  operations: {
    // Journalled with its profile resolved (see `extrude`), so a replay walks
    // the loops it is handed and never looks for one among the seeds.
    extrude,
    // The same, about an axis — and given its loops it asks no question about
    // positions either, so the geometric refusals the call made are not re-made
    // against seeds (see `revolve`).
    revolve,
    // A feature brought back into step with its profile, journalled as the
    // call with what it found resolved (see `regen`), so a replay walks the
    // profiles it is handed and looks for nothing among the seeds. `fillet`'s
    // own regeneration rides in its entry, the same way.
    regen,
    // A body's edges rounded or cut back (docs/plans/solid-fillets.md): the
    // typed `fillet` with a list of edges, `chamfer`, and the dialog's
    // `setEdges`. Edges are journalled by name; a replay asks no kernel.
    filletEdges,
    chamferEdges,
    setEdges,
    // How an extrude ends, changed afterwards (docs/plans/solid-tools-intuitive.md):
    // the edit dialog's end row types it.
    setEnd,
  },
  help: [
    'solids     extrude(region, depth?, frame?) — a solid of a region (see',
    '           regions), or of the face a member bounds — its whole inside, a',
    "           region made for it on the way (rg1) — along its sketch frame's +z:",
    '           a feature e1, a lid of twins and walls held by one depth',
    '           dimension (set("d9.value", 40) moves the lid). frame picks the',
    "           loop when the member is in several. The extrude tool does it by",
    '           pointing: arm("extrude", { depth: 20 }), click inside regions',
    "           (several), see the solids, then ✓ or Enter — it types one",
    '           extrude("l1", 20) here a region, the shortest line naming it.',
    "           A sketch on the ground runs along the origin's +z; one on the work",
    "           plane along it; one in no frame's plane along its own, three of",
    '           its corners facing you ("p1.p2.p4"). No frame is made for any of',
    "           them. Revolve does the same.",
    "           The lid is held to its base, both ways: every twin its base moved",
    "           by one chord, as long as the depth; e1_perp holds that chord",
    "           square to the profile, an ordinary relation — drag any corner and",
    "           the solid moves or turns, never skews. Delete e1_perp, or put",
    '           ang("l9", "e1", θ) in its place (l9 a wall), to lean it: drawn,',
    "           not built — the kernel sweeps square. edgeExtrude is the same for",
    "           any curves (see surfaces).",
    "           Bodies: a solid touching or overlapping a body adds to it; one",
    "           touching none is a body of its own. Cut — the Cut tool, beside",
    "           Extrude on its button (hold it) — takes material away: click a",
    "           closed shape on or beside a solid, ✓; it goes into the material",
    '           by default, and types extrude("c1", -10, { mode: "cut" }) — a',
    "           hole, no minus sign to know about; it says so before ✓ when it",
    '           reaches no solid. { mode: "add" | "new" | "intersect", into:',
    '           "e1" } names it all; the extrude\'s mode row (New Add Cut ∩) is',
    "           the same, the expert's way: left alone it shows what it will do,",
    "           and offers Cut when the solid runs into a body.",
    "           Flip direction: the ⇅ beside the depth (a revolve's angle) in the",
    "           panel turns it the other way — the depth negated, typed as arm;",
    '           on a solid, the menu\'s Flip direction types set("d1.value", -10).',
    "           Or drag the arrow on the preview's lid: the depth follows, in",
    "           round steps, and through zero it flips. Square on, the lid shows",
    "           ⊙ (towards you) or ⊗ (away). End conditions, the drop-down",
    "           in the depth's row of the panel:",
    "           Blind (none pressed, the depth), Through all (past everything",
    '           made before — { end: "through" }; it follows the body made',
    '           deeper), Symmetric (half each side — { end: "symmetric" }).',
    '           setEnd("e2", "through" | "symmetric" | "blind") changes it',
    "           afterwards — the edit dialog's row types it. Bodies of two or",
    "           more features are built by the solid kernel (NVIDIA SMLib, in a",
    "           Worker): drawn when it answers, the last good body shown until",
    "           then, a refusal said in the log. The organiser lists Bodies;",
    "           hiding one hides its first feature, hiding a later one leaves",
    "           it out of the body. exportStep() writes one solid per body.",
    "           A click inside a region takes the region; anywhere else, the",
    "           face it is in, whole — a loop drawn inside is no hole until a",
    "           region's operation says so (regions). Several features may",
    "           stand on one region, and editing it regenerates them all.",
    '           hole("e1", "c1") and unhole("e1", "c1") are aliases now: the',
    "           step on e1's region that cuts the loop c1 is in, or fills it",
    "           (its islands too) — journalled as that subtract or add. The",
    "           menu's Add as hole to e1 / Remove hole from e1 type them.",
    "           Deleting a hole's circle, or making it construction, fills the",
    "           hole: the region loses the face.",
    '           edit("e1") — the menu\'s Edit e1 on a face — opens the dialog on',
    "           e1: click loops inside the outline to toggle them, change the",
    "           depth, ✓ types hole/unhole and set as one undo step.",
    '           del("e1") removes the solid and keeps its sketch; deleting any',
    "           other piece of it takes only the feature's record (its faces).",
    "           revolve(member, axis, angle?, frame?) — the same loop turned",
    '           about an axis in its plane ("f1.y", yaxis(), or a line), angle',
    "           in radians, a whole turn when left out. A partial revolve has a",
    "           real end face, held by one angle dimension that set swings",
    "           (radians; its label reads degrees); a full one has none, and",
    "           turning it partial is a new revolve, not a set. The revolve tool:",
    '           arm("revolve", { angle }), click inside regions, then the axis,',
    "           then ✓ or Enter. The fillet tool: two lines, or their corner.",
    "           A feature follows its profile: fillet a corner of an extruded",
    "           or revolved sketch and the lid (or end face) is rounded too,",
    "           keeping every twin and wall whose corner is still there.",
    '           regen("e1") does the same for a profile you changed by hand —',
    "           a line drawn across it. Neither adds a hole: a feature on a",
    "           region is found again by the region's chain; a face of it",
    "           whose loop has gone does nothing, and the log says so.",
    "           A solid's edges: a kernel body's edges are named by their two",
    '           faces (e1.lid|e1.m0) — hover one for its name; a click selects',
    "           it, shift adds one, a box selects every edge it holds.",
    '           fillet("e1", ["e1.lid|e1.m0", …], 3) rounds them: a feature',
    "           (e3) in e1's chain, after what it rounds; its faces are e3.f0,",
    "           e3.f1 … (one per edge named); its radius a dimension",
    '           (set("d7.value", 4)). chamfer("e1", [...], 2) cuts them back by',
    "           one setback along each face. The round and chamfer tools (the",
    '           modify button): arm("round", { radius: 3 }), click edges — a',
    "           face for all its edges, again for the body's; tangent chains",
    "           take a rounded rim whole — see it rounded, drag the R label to",
    '           change it, ✓. edit("e3") opens it again: click an edge in, a',
    '           rounded face out. setEdges("e3", [...]) types that. A cut that',
    "           takes an edge leaves it out of its fillet, said. The kernel",
    "           will not fillet an edge that runs into an earlier fillet: add",
    "           it to that fillet instead. Equal setback only; no variable",
    "           radius or face fillets yet.",
  ],
});
