// The **solids** module (docs/plans/workbenches.md): extrude, revolve and
// sketch on a face; the feature edit dialog; and the operations a file replays
// for them — `extrude`, `revolve`, `regen`. The bodies kernel (src/solids/,
// the Worker) is the host's (main.ts constructs its client); this module is
// what the command line and the tray know of solids.

import { defineModule } from "../modules.ts";
import { extrude, regen, revolve } from "../operations.ts";
import { svg } from "../tools/icons.ts";
import { ExtrudeTool } from "../tools/extrude.ts";
import { RevolveTool } from "../tools/revolve.ts";
import { SketchTool } from "../tools/sketch.ts";
import { EditExtrudeTool, EditRevolveTool } from "../tools/edit.ts";

defineModule("solids", {
  label: "Solids: extrude, revolve, sketch on a face, bodies",
  tools: {
    extrude: ExtrudeTool,
    revolve: RevolveTool,
    sketch: SketchTool,
    // A dialog armed on a feature (`edit("e1")`), never from the tray.
    "edit extrude": { ctor: EditExtrudeTool, listed: false },
    "edit revolve": { ctor: EditRevolveTool, listed: false },
  },
  icons: {
    // A slab seen from above: the face raised off its base, the three vertical
    // edges that can be seen, and the base's two front edges — the back two are
    // behind the slab, and drawn they cross its front face.
    extrude: svg("extrude", `<path d="M2 7.5h7l5-3.5H7zM2 7.5v6h7l5-3.5V4M9 7.5v6"/>`),
    // A profile inside the turn that sweeps it: three quarters of a circle,
    // arrowed so it reads as a motion rather than a third shape. (An axis drawn
    // through it, and the turn as a foreshortened ellipse, were tried first: at
    // 16 px the two read as an anchor.)
    revolve: svg("revolve", `<rect x="5.75" y="6.75" width="4.5" height="3.5" rx="1"/>` +
      `<path d="M13.5 8.5A5.5 5.5 0 1 1 8 3"/><path d="M6.6 1.4 8.6 3 6.6 4.6"/>`),
    // A plane in perspective with a pencil on it: drawing on a face.
    sketch: svg("sketch", `<path d="M1.5 13.5h9l4-4h-3"/><path d="M1.5 13.5l4-4h1.5"/>` +
      `<path d="M6.5 10.5l1-3L13 2l2 2-5.5 5.5zM11.5 3.5l2 2"/>`),
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
  },
  help: [
    '           extrude(member, depth?, frame?) — a solid of the closed loop',
    "           the member is in, holes and all, along its sketch frame's +z:",
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
    "           Bodies: a solid touching or overlapping a body adds to it; one",
    '           touching none is a body of its own. Cut is chosen: extrude("c1",',
    '           -10, { mode: "cut" }) — a hole — and { mode: "add" | "new" |',
    '           "intersect", into: "e1" } names it all. The dialog has a mode',
    "           row (New Add Cut ∩): left alone it shows what it will do, and",
    "           offers Cut when the solid runs into a body. Bodies of two or",
    "           more features are built by the solid kernel (NVIDIA SMLib, in a",
    "           Worker): drawn when it answers, the last good body shown until",
    "           then, a refusal said in the log. The organiser lists Bodies;",
    "           hiding one hides its first feature, hiding a later one leaves",
    "           it out of the body. exportStep() writes one solid per body.",
    "           A region is its outline and the holes you confirmed: the click",
    "           (or a typed extrude) proposes every loop inside; in the dialog a",
    "           click on a hole takes it out of the proposal (and back), a click",
    "           on a solid island is a region of its own. Nothing joins later",
    '           by being drawn inside: hole("e1", "c1") cuts the loop c1 is in',
    '           through e1, unhole("e1", "c1") fills it (and its islands) —',
    "           the menu's Add as hole to e1 / Remove hole from e1. Deleting a",
    "           hole's circle, or making it construction, fills the hole.",
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
    "           a line drawn across it. Neither adds a hole; a recorded hole",
    "           whose loop has gone is filled, and the log says so.",
  ],
});
