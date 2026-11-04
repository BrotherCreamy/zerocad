# Plan: a Select tool and a Hand tool, first on the toolbar

**Status: queued** (2026-11-04), to start once `chrome-logo-scale.md` has
merged (it rebuilds the toolbar's sizing and the menu). The owner: *"there is
no hand/selction tool. would be nice since a lot of people are used to
that"*.

Today "no tool armed" *is* selection — a click selects, a drag on an entity
moves it, a drag on empty canvas boxes (2D) or orbits (3D), and under a
finger one finger on empty canvas orbits and two pan — but nothing on screen
says so, and panning needs a middle button or two fingers.

Read `CLAUDE.md`, `docs/plans/effortless.md`, `touch.md`, `box-select.md`,
`toolbar-icons-docking.md`, `chrome-logo-scale.md` (as built),
`src/tools/engine.ts` (idle gestures, `arm`, the finger recogniser's sink),
`src/tools/tool.ts`, the toolbar in `src/panels.ts`, `src/toolavail.ts`,
`src/main.ts` (keydown, the toolbar sync), and the toolbar e2e tests.

## Design

- **Select** — an arrow, the toolbar's first button. **Lit whenever no tool is
  armed**; a tap puts the armed tool down (a feature dialog's picks dropped,
  as Escape does) and leaves the selection alone. Typed as `arm("select")`,
  which means "no tool", so the button, the command line and the toolbar's
  lit state all read one thing. Everything it does is what "no tool" does
  now — no behaviour changes.
- **Hand** — the second button. Armed (`arm("hand")`), **a left-drag or a
  one-finger drag pans the view from anywhere**, over geometry too (nothing is
  moved); the wheel and a pinch still zoom; a tap still selects. It stays
  armed until another tool is chosen, like any tool. On a desktop, **holding
  Space** is a temporary hand (released, the previous tool is back) — skip it
  while the command line has focus.
- Icons in the toolbar's existing style (`toolbar-icons-docking.md`),
  checked at every interface size.
- Escape with a tool armed lights Select again; `cancel()` and the action
  strip's Cancel do too.

## Tests

Unit: `arm("select")` disarms and keeps the selection; the hand's drag
mapping (pan in 2D and 3D, the point under the cursor stays under it).

E2E, mouse and iPhone 13: Select is lit at start and after Escape; tapping it
puts a half-picked extrude down; with the Hand armed a drag starting on a
line pans and the line has not moved; one finger pans with the Hand and
orbits without it; Space-drag pans and gives the previous tool back; every
existing toolbar test passes with two more buttons (update counts where they
are asserted, and say where). LOOK at the toolbar in both orientations.

## Docs

CHANGELOG at the top quoting the owner; the register (Select is "no tool",
the Hand pans from anywhere, Space is a temporary hand) as vetoable; STATUS;
README; `help()`; the spec marked built.
