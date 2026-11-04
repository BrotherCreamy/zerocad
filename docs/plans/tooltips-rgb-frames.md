# Plan: tooltips on every control, and frames in RGB

**Status: queued** (2026-11-04). The owner, after trying the hosted app:
*"when I hover over tools, I should see a tooltip"* and *"a frame should be
coloured or something so I can tell the orientation. use rgb colours like
solidworks."*

Today each toolbar button has a native `title` (`buttonTitle` in
`src/panels.ts`: `rectangle — arm("rectangle")`), which a desktop browser
shows only after a long hover, styled by the OS, and **a phone never shows
at all** — there is no hover. A frame's axes (`drawFrame` in `src/main.ts`)
are all one ink: grey-blue, the default frame's lighter, amber when lit.

Read `CLAUDE.md`, `docs/plans/effortless.md`, `chrome-logo-scale.md` and
`select-hand.md` (as built), `src/panels.ts` (the toolbar, the action strip,
the options panel, the organiser's controls, the app menu), `src/menu.ts`,
`src/tools/icons.ts`, the tools' own descriptions (`src/tools/*.ts`, `help()`
in `src/replenv.ts`), `drawFrame` and `strokeEdge` in `src/main.ts`, and the
toolbar, touch and chrome e2e tests.

## Design

- **One tooltip component** for every control that is an icon or a short
  word: toolbar buttons, the action strip, the app menu's spin box, the
  organiser's ＋ and eyes, a panel's grip. It shows **the control's name, a
  one-line description of what it does, and its typed command** (and a key,
  where one exists: Delete, Ctrl+Z, Space for the Hand). Styled like the
  hover tag (`#hovertag`), scaled by the interface size, kept inside the
  window and clear of the finger.
  - **Mouse:** after a short hover (≈400 ms; immediately when moving from one
    tooltip-carrying control to the next, as native toolbars do), gone on
    leave or press.
  - **Finger:** a long-press on the control (the recogniser's 500 ms, or the
    panel's own timer) shows it, and lifting without moving does **not**
    trigger the control; a tap triggers as now. Do not break the touch tests'
    tap timing.
  - The native `title` goes from controls that get the tooltip, so two never
    show at once; `aria-label`/`aria-describedby` keep it accessible.
  - The descriptions live with the tools, once: each built-in tool declares a
    `summary` (one line, user words — "Draws a rectangle: drag from corner to
    corner"), which the tooltip, `help()` and `tools()` all read. A tool
    defined at the command line may declare one; without it, its name.
- **Frames in RGB, as SolidWorks draws them**: the x arm red, y green, z blue,
  with their letters in the same colour. Choose shades that read on the dark
  ground, over a light solid (the casing pass), and in the hidden view's
  dimmed ink (`hiddenInk` — keep the hue, dim the value); check for the
  common red–green colour-blindness by keeping the letters, and say what you
  chose. **Lit and selected still win**: a hovered or selected frame draws in
  amber or the selection colour as now, so state stays readable. The default
  frame is marked by weight, not by a different ink.

## Tests

Unit: every built-in tool has a summary; the tooltip's text for a tool, an
action and a key; its placement inside the window.

E2E, mouse and iPhone 13: hovering a toolbar button shows its tooltip within
half a second, with the name and command, and it goes on leave; moving to the
next button shows that one at once; a long-press on a phone's toolbar button
shows the tooltip and does not arm the tool, and a tap arms it; the action
strip's buttons have tooltips; a frame's x arm is drawn red, y green, z blue
(sample pixels), lit amber when hovered. LOOK at a tooltip at 70 % and 130 %,
and at a frame on the ground and over a solid.

## Docs

CHANGELOG at the top quoting the owner; the register (tooltips everywhere,
long-press on touch; frames in RGB) as vetoable; STATUS; README; the spec
marked built.
