# Plan: the toolbar greys out a tool that cannot run

**Status: built** (2026-10-21); **superseded** (2026-10-29) by [`no-refusals.md`](no-refusals.md) — the curve tools make their plane, so the rule now answers null and nothing greys (the machinery stays) — one PR against `claude/resume-tasks-o7q02e`;
what it added beyond this text is in `TODO.md`'s Done entry. Follow-up from the panels package
(`docs/plans/panels.md`), filed on the register by the worker who built it.
Read `CLAUDE.md`, the panels spec, `src/panels.ts`, `src/menu.ts` (in
particular `curvesNeedAFrame` and `CURVE_TOOLS`) and `src/main.ts`'s
`Toolbar` host before starting.

## The gap

In a 3D model with no default frame, the context menu shows circle, circle3,
arc, arc3 and fillet **disabled, with `resolveFrame`'s reason** — the model's
own standing message, so the menu and the command line say the same thing.
The toolbar arms them anyway, and the first click is refused in the log. That
is loud and correct, but the menu's answer is better, and the person most
likely to press "circle" first is the newcomer the empty-canvas hint just
told to pick a tool from the toolbar. The two surfaces must agree.

## Design

- **One rule, shared.** `curvesNeedAFrame` and `CURVE_TOOLS` are private to
  `menu.ts`. Move the rule to a small module both the menu and the toolbar
  host read — `src/toolavail.ts`, say: `toolUnavailable(model, tool): string |
  null` (the reason it cannot run, or null). The menu keeps its behaviour to
  the byte; it just imports the rule. Keep the reason text the model's own
  (read out of `resolveFrame`), as the menu does today: nothing here invents a
  second message.
- **`panels.ts` stays model-blind.** It imports nothing from the model
  (its header comment is the contract). The `ToolbarHost` interface grows one
  method — `unavailable(tool): string | null` — and `main.ts` implements it
  through the shared rule. `Toolbar.sync` re-reads availability on every call
  (it is already called on every render; `resolveFrame` in a try/catch is
  cheap) and does DOM work only when something changed, as it does now for the
  armed tool.
- **A disabled button is shown, not hidden** — Fix's reason, the menu's
  reason: the absence of a frame is what the user needs told, and a vanished
  button leaves "where did circle go" unanswered. It carries the `disabled`
  attribute, its title becomes the reason (so hovering explains it, exactly
  as the menu's `.why` row does), and it is styled like the menu's `.item.off`
  — muted, no hover lift, never amber. A disabled button types nothing.
- A tool defined at the command line is never a curve tool and is never
  disabled by this.
- Nothing else changes: no new state, no new command, no change to `arm()`
  itself (typing `arm("circle")` by hand still arms it and the click is still
  refused in the log — that is the command line's honest answer and stays).

## Verification

- Unit (`test/panels.test.ts` or a new `test/toolavail.test.ts`): the rule
  answers null in 2D, null in 3D with a default frame, a reason in 3D without
  one; the five curve tools are the set, `point`/`line`/`rectangle`/`extrude`/
  `revolve` are never affected.
- E2e (`test/e2e/panels.e2e.ts`, extend): fresh 3D app — the five curve
  buttons are disabled with the reason as their title, the rest enabled;
  clicking a disabled one arms nothing and logs nothing; `setDefaultFrame(frame())`
  enables them on the next render without any other action; `del` of that
  frame disables them again; the context menu and the toolbar give the same
  reason string. LOOK at a screenshot of the fresh page: a disabled button must
  read as disabled next to an enabled one, at the toolbar's size.
- Full `npm run test:all` green. Docs per `CLAUDE.md`: CHANGELOG entry at
  the top, the register's open item ticked, STATUS if it lists the toolbar's
  limits, this file marked built.

## Delivery

Isolated worktree, branch `claude/toolbar-availability` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews.
