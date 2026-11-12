// The **step** module (docs/plans/workbenches.md): STEP export — the logo
// menu's Export STEP… and `exportStep()` (src/step.ts writes it; the host hands
// the file over). Import, later.

import { defineModule } from "../modules.ts";

defineModule("step", {
  label: "STEP: export the shown solids for other CAD and CAM tools",
  // A copy for another CAD tool, not the document (docs/plans/step-export.md).
  files: [{ label: "Export STEP…", command: "exportStep()" }],
  help: [
    "           exportStep(name?)  exportStep({ curves: true }) — the shown",
    "           solids as <name>.step (STEP AP214, millimetres) for any other",
    "           CAD or CAM tool: exact faces — planes, cylinders, cones,",
    "           spheres, tori — one body per extrude or revolve, named e1, e2,",
    "           …; hidden solids and construction geometry left out. curves:",
    "           true adds the loose curves no solid is made of. The share",
    "           sheet on a phone, a download elsewhere; the app menu's Export",
    "           STEP… types it. With no solid it says so and writes nothing.",
  ],
});
