# Plan: tooltips on every control, and frames in RGB

**Status: built** (2026-11-04), on `claude/tooltips-rgb`; see *As built* at
the end for every deviation. The owner, after trying the hosted app:
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

## As built

Built on `claude/tooltips-rgb`. By file: `src/tooltip.ts` (new: `Tip`,
`tipText`, `tipPlacement`, `giveTip`, `Tooltips` — one element, listened for
once on the window and the document); `src/tools/tool.ts` (`Tool.summary`,
`ENGINE_SUMMARIES` for Select and the Hand, `toolSummary`, `defineTool`
refusing a summary that is not text); a `static summary` on each built-in in
`src/tools/*.ts`; `src/panels.ts` (`toolTip`, `displayName`, `actionTip`,
`actionKey`, `stripTip`; the toolbar's, the strip's, the options panel's ✓
and ✗ and every panel strip's tooltip, handed in as `tooltip`);
`src/organiser.ts` (`addTip`, `eyeTip`, `openTip`, the row's mouse-only tip;
a hold on a row's button is the button's, not the row's menu);
`src/appmenu.ts` (`spinTip`); `src/main.ts` (the `Tooltips` instance before
the panels, the logo's tip, the keys, `drawFrame` in RGB, `FRAME_NAME_INK`);
`src/framemarker.ts` (`AXIS_INKS`); `src/replenv.ts` (`tools()` ends each
line with the summary, `help()` lists the toolbar with them); `index.html`
(`#tooltip` and its style). Tests: `test/tooltips.test.ts` (10),
`test/e2e/tooltips.e2e.ts` (10: six with a mouse, four under fingers in
iPhone 13 portrait and landscape).

**The inks** (`AXIS_INKS`): x `#ee6040`, y `#60d658`, z `#5b9cff`. Measured:
on the ground `#0a0e13` they are 5.9, 10.4 and 7.0 : 1 (pure blue is 2.3,
unreadable); dimmed by `hiddenInk` they are rgb(138, 90, 87), rgb(82, 137, 96)
and rgb(80, 114, 163) — each still led by its own channel, within 25° of its
hue (a red with as much blue as green, `#f05a5a`, dims toward pink —
rgb(139, 88, 97) — which is why the red leans to vermilion); over a light solid each sits on its dark
casing exactly as on the ground. For red–green colour blindness the red and
the green are apart in lightness (relative luminance 0.27 against 0.51) and
every arm keeps its letter in its own ink. All distinct from the lit amber,
the selection violet, construction's teal and the regions' green `#55c07a`
(bluer and darker than y). Looked at on the ground, lit, over a solid shaded
and in the hidden view, and at 3× crops of each.

Deviations and additions — each a decision, vetoable:

- **More controls than the list**: the options panel's ✓ (Enter) and ✗
  (Esc), the organiser's open markers ● ○, the organiser's rows (a mouse's
  only — a finger's hold on a row is its menu, which says more), the logo,
  and **every panel's strip**, not only a tray's grip of dots: a word on a
  strip is "a short word". The corner grips that resize a panel draw nothing
  and have none. Text rows — an options field's label, an app-menu item, the
  context menu — keep what they had: they are words that say what they are,
  not icons, and the menus show their command beside them.
- **The name is capitalised** (`Rectangle`, `Circle3`); the command under it
  is the registered name as typed. **Keys**: the Hand `hold Space`, Select
  and Cancel `Esc`, Undo `⌘Z`/`Ctrl+Z`, Redo `⇧⌘Z`/`Ctrl+Y`, Delete
  `Delete`, ✓ `Enter`, ✗ `Esc` — ⌘ wherever the platform or the user agent
  is Apple's (so the iPhone emulation shows ⌘Z; an iPad keyboard has it).
- **A control that would do nothing says why** where the command would be
  (`nothing to undo`, `select something first`, `already the largest,
  160%`, an empty group's eye).
- **A finger's tooltip lingers 1.5 s after the lift**, so it can be read
  without the hand over it; any press puts it away. **The keyboard's focus
  shows one** (`:focus-visible`), as a hover does.
- **The summary is not inherited**: read from the class's own `static
  summary` (the icons' reason — `class extends CircleTool` registered as
  `stamp` must not say it draws a circle). `defineTool` refuses one that is
  not text, as it refuses malformed options.
- **`tools()` changed format**: each line ends `  — <summary>`, after what it
  always said, so it still starts with what you type. Four assertions that
  matched lines exactly were updated (`tooloptions.test.ts`,
  `tooloptions.e2e.ts`, `construction.e2e.ts`). **`help()`** gains a *tools*
  section, the toolbar's order, generated from the summaries.
- **`panels.ts` imports `tooltip.ts`** — its first import. The test that
  held it to none (`toolavail.test.ts`) now holds it to that one line and
  holds `tooltip.ts` to none, so "knows nothing of the model or the tools"
  stays true transitively.
- **The native `title` stays as the fallback** where a host hands no
  tooltip (and in the page's markup, for the logo and the strips): `attach`
  removes it, so the two never show together.
- **Frames**: the name beside the marker is one neutral ink for every frame
  (`#9fb4c7`), amber or violet when lit or selected; **the default is bold
  letters and name, and arms 2 px against 1.2** (lit 2.6 against 2.2). A
  dimmed arm's letter keeps its full ink, as letters always did.
- **Tests changed their fixture, not their claim**: `hidden.e2e.ts` samples
  the red x arm where it sampled the old grey (`X_ARM`); its golden picture
  is re-recorded — 346 pixels differ, every one inside the frame marker's
  box (523–576, 193–256); `panels.e2e.ts` and `selecthand.e2e.ts` assert a
  tooltip and no title where they asserted the title's text;
  `panels.test.ts` tests `toolTip` where it tested `buttonTitle`, which went.

Limitations left in place, deliberately:

- **Under a finger at the top-right action strip in portrait** there is room
  neither above nor beside, so the tooltip goes below the finger, partly
  under the hand while it is held; it lingers after the lift to be read.
- **The summaries say "click"** on a phone too ("drag", "click inside it"):
  one line for both, and a tap is a click everywhere else in the app's words.
- **Not tried on iOS Safari**: whether iOS sends a click after a long touch
  on a button (it is swallowed if it comes), and that `-webkit-touch-callout:
  none` keeps the callout away. Chromium's emulation sends none.
- **The hover delay is measured in Chromium only** (300–500 ms in the test,
  400 set).
