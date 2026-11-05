// The **organiser** module (docs/plans/workbenches.md): groups, the open
// group, visibility — the operations a file replays for them (groups.ts) —
// and the Organiser pane's help. The pane itself is the host's (organiser.ts,
// main.ts), drawn from the model.

import { defineModule } from "../modules.ts";
import * as grouping from "../groups.ts";

defineModule("organiser", {
  label: "Organiser: groups, the open group, hide and show",
  operations: {
    // Groups (see groups.ts). `group` and `addTo` are journalled with their
    // members resolved — the union as it was — and `removeFrom` is also what a
    // deletion's expansion writes for each group its name leaves.
    group: grouping.group,
    addTo: grouping.addTo,
    removeFrom: grouping.removeFrom,
    ungroup: grouping.ungroup,
    // The open group (docs/plans/organiser.md): document state, journalled as
    // typed, so a replay opens it at the step it was opened at and every
    // constructor after joins it exactly as it did — the membership is made
    // again, never stored or re-inferred. `rename` renames a group in place.
    opengroup: grouping.opengroup,
    closegroup: grouping.closegroup,
    rename: grouping.rename,
    // Visibility is the document's: journalled as typed, and what a name stood
    // for at that step is what it stands for when the step is replayed.
    hide: grouping.hide,
    show: grouping.show,
  },
  help: [
    "groups     group(...names, { name? }) — a named set: g1, g2, … or yours.",
    "           A set, not a container: it owns nothing (ungroup(g) or del(g)",
    "           removes the grouping, never a member), an entity may be in any",
    "           number, and a group never holds a group — name one (or a",
    "           feature) and its members now are added: a union, not a link.",
    "           addTo(g, ...names)  removeFrom(g, ...names)  members(g)",
    "           groups(name) — the groups it is in; groups() — them all.",
    "           Deleting a member takes it out of its groups; a group may be",
    "           empty, and stays until ungroup(g). rename(g, name) renames one.",
    '           A feature is a read-only group: members("e1") is what it',
    '           made, select("e1") and hide("e1") work, addTo("e1", …) refuses.',
    "           The hover tag ends with · g1 g2; ls() lists the groups.",
    '           opengroup("g1") — everything made from now on joins g1: drawn,',
    "           typed, a fillet's arc, an extrude's twins; closegroup() ends it.",
    "           One at a time; journalled, saved, undone; Escape leaves it open.",
    "           opengroup(group()) is a new empty group, open. A feature's",
    "           regenerated pieces join the groups that held all it made.",
    "organiser  the Organiser pane: Groups and Features, a row each — tap",
    "           selects it (select), the eye hides and shows, ● opens or closes",
    "           a group; right-click or a long-press for Rename, Add or Remove",
    "           selection, Open/Close, Ungroup (Edit and Delete for a feature).",
    "           ＋ groups the selection, or with nothing selected types",
    "           opengroup(group()). Every control types its command; the app",
    "           menu's Panes shows and hides the pane.",
    "visibility hide(...names)  show(...names)  show() — groups and features",
    "           expand. Hidden is not drawn, picked, snapped to or boxed, and is",
    "           still solved; a hidden feature's faces go too. Part of the",
    "           drawing: journalled, saved, undone. The menu's Hide and, on",
    "           empty canvas, Show all type them.",
  ],
});
