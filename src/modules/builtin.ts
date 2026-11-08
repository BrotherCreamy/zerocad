// The built-in modules, in load order — which is the order every table they
// fill is in: the tray's buttons, the menu's tool items, the File items, the
// replay table, help(). And the built-in workbenches over them.
//
// Imported by every host that reads those tables — main.ts, and below it
// persist.ts and replenv.ts, so a test that opens a file or builds a command
// scope has the app's vocabulary without knowing modules exist. An ES module
// runs once, so however many import it, each module is defined once.

import "./core.ts";
import "./sketch.ts";
import "./solids.ts";
import "./surfaces.ts";
import "./dimensions.ts";
import "./files.ts";
import "./step.ts";
import "./organiser.ts";
import "./interface.ts";
import { defineWorkbench, markBuiltin } from "../modules.ts";

// Built in: marked so neither they nor their workbenches can be removed.
for (const name of ["core", "sketch", "solids", "surfaces", "dimensions", "files", "step", "organiser", "interface"]) markBuiltin(name);

/**
 * The workbenches (docs/plans/workbenches.md): `part`, the default, is today's
 * toolbar exactly; `sketch` is the drawing alone. Files, the organiser and the
 * interface's help are in both — they bring no tools, and every document has
 * them.
 */
defineWorkbench("part", { label: "Part", modules: ["core", "sketch", "solids", "surfaces", "dimensions", "step", "files", "organiser", "interface"] }, "builtin");
defineWorkbench("sketch", { label: "Sketch", modules: ["core", "sketch", "dimensions", "files", "organiser", "interface"] }, "builtin");
// Surfaces (docs/plans/surfaces.md): the part's modules exactly — surfacing is
// done beside solids, and the round and chamfer tools that fillet surfaces are
// the solids module's — named for the owner to find it by. Vetoable (TODO.md).
defineWorkbench("surfaces", { label: "Surfaces", modules: ["core", "sketch", "solids", "surfaces", "dimensions", "step", "files", "organiser", "interface"] }, "builtin");
