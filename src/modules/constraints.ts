// The **constraints** module (docs/plans/constraints-palette.md): the
// Constraints palette as a workbench module. The owner: *"the constraint list
// should not be on the features palette, it should be a separate constraints
// palette. although i think it should still be installed as a workbench."*
//
// It registers no tool, relation, operation or entity: the pane itself is the
// host's (constraints.ts, main.ts), drawn from the model and the selection,
// and this module is what puts it on a workbench — `part` and `sketch` name
// it (builtin.ts), and a workbench that does not has no palette, as one
// without `solids` has no extrude. The constrain tool (the sketch module's)
// stays the way to pick by clicking; its own options pane lists the relations
// only where this module is off the workbench.

import { defineModule } from "../modules.ts";

defineModule("constraints", {
  label: "Constraints: the palette of relations for what is selected",
  help: [
    "constraints the Constraints palette: for what is selected — or what the",
    "           constrain tool has picked — the relations that apply, most",
    "           likely first, one row each (a greyed row says why not; a press",
    "           types the line, par(\"l1\", \"l2\")), and under them the relations",
    "           the selection already has: its mark, its name, what it says, a",
    "           dimension's value in a field (Enter types set(\"d1.value\", 60))",
    "           and × (del). A row selects its relation. Nothing selected lists",
    "           the drawing's relations, newest first, and the agreeing sets —",
    "           relations that say one thing together, none of them wrong; the",
    "           status counts them (0 free · 4 agreeing). Where its rows do not",
    "           fit, the likeliest show and more… opens the rest. A pane like",
    "           the organiser: dragged, docked, remembered; the app menu's",
    "           Panes shows and hides it (ui({ show: \"constraints\" })). On a",
    "           phone it starts hidden and comes up with the constrain tool.",
    "           A module: a workbench that does not name it has no palette.",
  ],
});
