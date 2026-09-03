# Plan: dimensions are named, and set() edits their value

**Status: shipped, pending review** (2026-09-03) — built as specified. Two
things worth reading the code for rather than this file: the v3 translation map
is computed *from the replay* rather than from a scan of the journal (a
`fillet` is one entry that makes four relations), and the menu needed a third
`MenuAction` — `type` — because a partial command replaces the command line
where `insert` appends to it.

Owner's decision, verbatim: editing a
dimension *"should be a `set(d4.value, 60)` where d4 is the dimension."*
This closes the register's open question — no separate parameter table: the
dimension **is** the named value-holder, exactly as his first-day example
("radius d4") already said.

Read `CLAUDE.md`, `docs/ARCHITECTURE.md`, the register's dimension-label
entry, and `src/relations/refs.ts` (the `f1.x` property-reference syntax
this extends to `d4.value`).

## Design

### The d namespace

The value-carrying relations — `dist`, `rad`, `ang` — are **dimensions**,
and they claim names `d1`, `d2`, … instead of `r1`, `r2`, …. Everything
else (`par`, `perp`, `coin`, `tan`, `on`, `eq`, `fix`, …) stays `r`-named.
The split is the one Onshape draws: a dimension is a number you put on the
drawing; a constraint is a shape statement. One registry as today — the
prefix is decided by the op, in `model.relation` (give it the prefix as an
argument or a lookup, whichever reads better; the throw-rollback logic must
restore whichever counter it used). `del`, `rels()`, glyphs, the journal,
hover all keep working because nothing but the prefix changed — but check
each and say so in tests, not comments.

`fix` is deliberately NOT a dimension: it carries coordinates, not one
value, and Onshape's fix is a constraint. Note it in the register.

### set()

`set("d4.value", 60)` — a new **operation** (operations.ts: it rebuilds
structure-adjacent state; it can over/under-constrain but never malform).

- The property path reuses the dot-reference machinery `f1.x` established:
  `parseAxisRef`-style parsing beside it in `model.ts`, which owns the
  namespace. `"d4.value"` is the only settable property in this package —
  an unknown property or a non-dimension name gets a helpful throw naming
  what IS settable.
- Semantics: rebuild the relation **in place under the same name** — remove
  its blocks, re-run its op with the same args except the new target, keep
  its position in the registry (order matters to nothing today, but the
  name mattering is the whole point). The relation's `args` update so
  `rels()`, glyph labels and `del`'s reference-scan tell the truth.
- `ang`'s stored unit is radians (the label shows degrees — the documented
  seam). `set("d3.value", x)` takes what the relation stores: radians for
  ang, and say so in the throw/help. Closing the seam fully (degree input?)
  is the owner's to ask for; do not invent it.
- Journal: `set` records as the one call, args as given. Replay is
  deterministic. One user action, so one undo step; the host re-solves
  after (the del precedent — an edit whose whole point is to change the
  verdict must not leave a stale header).

### The click surface

- A dimension label's click still inserts its name (`d4` now) — unchanged
  machinery, new name.
- The context menu on a dimension glyph gains **Set value…** which inserts
  `set("d4.value", ` into the command line (insert, not run — the user
  types the number; the house pattern for a command needing input). The
  Delete item stays.
- The menu's Dimension items now create relations that come back `d`-named;
  their shown commands are already correct since they type real commands.

### Persistence

Names are assigned by order, so re-prefixing changes what deletion entries
(`deleteRelation "r7"`) refer to in old files. Bump `VERSION` to 4 and
**translate**: replay a v3 journal computing the old-style name each
relation would have had and the new-style name it gets, and rewrite
`deleteRelation` args through that map. A v3 file with no deletions needs
no map but costs nothing to run through it. Round-trip tests both ways,
including a v3 file that deleted a dimension-between-constraints.
`set` registers in the replay table (and replenv — the double-registration
trap).

## Verification

Unit: d-vs-r naming per op (and the rollback restoring the right counter);
set() happy path (value changes, same name, same registry order, args
updated, old blocks gone — assert block count, not just behaviour);
set() on a non-dimension, unknown name, unknown property, wrong-type value;
ang radians; journal round-trip with a set in the history; v3 translation
with deletions. E2e: draw, dimension via the menu, `set` the value from the
command line, geometry moves to the new value (closed-form assertion),
header SOLVED, one undo returns the old value; the menu's Set value… item
inserts the partial command; labels read `d1` in hover/insert flows.
Screenshots at the next free numbers (check your tip; 45 was the latest) —
before/after a set, log in frame. Look at them. Full `npm run test:all`
per commit. Docs duties per `CLAUDE.md`: the owner decision moves from
"Decisions needed" to the register as decided, with this design recorded.

## Delivery

Isolated worktree, branch `claude/named-dimensions` off the working-branch
tip, PR against `claude/resume-tasks-o7q02e`. Do not merge; the supervising
session reviews. A sibling package (tool source in saved files) is queued
behind this one because both touch `persist.ts` — do not start it.
