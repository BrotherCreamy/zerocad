# Plan: a tool says how to use it — on hover, and on a phone when it is chosen

**Status: built** (2026-11-12, `claude/tool-howto`; see *As built* at the
end for every tool's how in one table, and every deviation). The owner, asked
to try the conflict fix:
*"I don't even know how to add a parallel relation. Maybe a little tooltip
should pop up when I hover over (desktop) or select (phone) a tool."*

## What is true today

`src/tooltip.ts` (`tooltips-rgb-frames.md`, built 2026-11-04): a control's
name, one line of what it does (`static summary`), and the command it types.
A mouse sees it after a short hover. **A finger sees it only by holding the
button** — which nobody discovers — and a tap arms the tool silently. The
tip says what a tool *is*, not what to *do*: the constrain tool's does not
say "tap two lines, then choose Parallel". There is no Parallel button; a
relation is reached by arming Constrain (or selecting and long-pressing),
then choosing from the constraints palette (#88), which on a phone shows the
likeliest row and "N more…".

Read `CLAUDE.md`, `docs/plans/tooltips-rgb-frames.md`, `mode-feedback.md` or
its successor (the chip that says the next step), `constraints-palette.md`,
`everything-fits.md` (room on a phone), `src/tooltip.ts`, `src/panels.ts`,
`src/tools/tool.ts` and every tool's `static summary`, `src/constraints.ts`.

## Design

1. **Every tool declares how it is used** (`static how`): the steps, in the
   words of someone doing it, three lines at most, by finger where that
   differs. Constrain: *"Tap the things to relate — two lines, a line and a
   circle… Then choose from the list: Parallel, Perpendicular, Equal,
   Tangent…"*. Dimension, trim, extrude, cut, edge, revolve, fillet,
   chamfer, sketch, every curve tool and its methods, select and the hand:
   all of them, written by reading what the tool actually does, each checked
   by doing it in the browser.
2. **On a phone, choosing a tool shows its tip**: name, what it does, how.
   It appears as the tool arms, clear of the finger and of the drawing's
   middle, takes no touch (taps pass through to what is under it), and goes
   at the first touch on the drawing or after a few seconds. Holding a
   button still shows it without arming. The second time in a session the
   same tool is chosen, only the how line shows, briefly; a setting
   (`ui({ tips: false })`, and a row in the app menu) turns the on-choose
   tip off. Decide the timings by trying them on the iPhone 13 profile and
   say them in the register.
3. **On a desktop, hover as today**, with the how lines added.
4. **The parallel case, end to end**: with the constrain tool armed and two
   lines tapped, Parallel is one tap away on an upright iPhone. Fix the
   wasted row filed in TODO (*The phone palette wastes a row*, review of
   #88: the fit budget in `src/constraints.ts` `sync` leaves a blank row, so
   one applicable row shows where two fit) as part of this.
5. **The empty palette teaches**: armed with nothing picked it already says
   "pick what to relate"; make it say what can be picked and what will be
   offered, in a line.

## Tests

- Unit: every registered tool has a `how`; the tip's text for a tool; the
  pass-through; the setting.
- E2E, iPhone 13 and mouse: tap Constrain, the tip is up and says how; tap
  two lines through it; Parallel pressed from the palette without opening
  "more…"; the lines are parallel. Hover on a desktop. The tip never covers
  the tapped tool's own options pane. LOOK at every picture, and read the
  how lines as someone who has never used the app.

## Docs

CHANGELOG top quoting the owner; STATUS; the register (timings, the
second-time rule, the setting); `help()`; the TODO item ticked; the spec
marked built.

## As built (2026-11-12)

By file: `src/tools/tool.ts` (`Tool.how`, `HowLine`, `How`, `ENGINE_HOW`,
`howText`, `toolHow`, `HOW_MAX_LINES`, `defineTool`'s refusal); a `static
how` on every tool in `src/tools/*.ts`; `src/tooltip.ts` (`Tip.how`,
`Tip.also`, `chosenTip`, `readingMs`, `chosenPlacement`, `middleOf`,
`Tooltips.announce` / `dismiss` / `announced`, `recallTips`, `rememberTips`);
`src/panels.ts` (`toolTip`'s fourth argument, `groupAlso`, the toolbar
host's `how` and `chosen`, the ✓'s sentence); `src/main.ts` (`tipHand`,
`howOptions`, `showChosenTip`, `ui({ tips })`); `src/appmenu.ts` (the View
row); `src/constraints.ts` (`PICKING`, the fit); `index.html` (`#chosentip`,
`.thow`, `.talso`); `src/modules/interface.ts` (`help()`). Tests:
`test/toolhowto.test.ts` (15), `test/e2e/toolhowto.e2e.ts` (13). Pictures:
docs/images/480–487.

### Every tool's how

Read off the tools themselves (`toolHow`), so this is what the app says. The
finger's words are shown; a mouse's are the same with *click* for *tap*,
except where the last column says otherwise. **Each line was done in the
browser before it was written**, by mouse and by finger, on a desktop window
and the iPhone 13 profile.

| Tool | Button | What it does (the summary, unchanged) | How, by finger | By mouse, where it differs beyond click for tap |
|---|---|---|---|---|
| `select` | its own | Picks things: click one, or drag across empty space to box several | 1. Tap a thing to select it; tap more to add them.<br>2. Drag a thing to move it. Hold, then drag, to box several.<br>3. Hold still on a thing for its menu. | 1. Click a thing to select it; Shift-click adds more.<br>2. Drag a thing to move it; drag from empty space to box several.<br>3. Right-click a thing for its menu. |
| `hand` | its own | Pans the view: drag from anywhere, over the drawing too | 1. Drag anywhere to slide the view, over the drawing too.<br>2. A tap on a thing still selects it.<br>3. Two fingers pan and zoom with any tool. | 3. Holding Space is the hand, whatever tool is chosen. |
| `point` | its own | Places a point where you click | 1. Tap where the point goes.<br>2. On a line, a circle or a point, it is held there.<br>3. Choose the tool again for the next point. |  |
| `line` | its own | Draws lines: click the start, then the end of each in turn | 1. Tap the start, then the end of each line in turn.<br>2. Start or end on a point or a line to join it.<br>3. Cancel (✕) ends the chain. | 3. Esc ends the chain. |
| `rectangle` | shapes | Draws a rectangle: drag from corner to corner | 1. Press at one corner, drag to the opposite one, let go.<br>2. Its corners stay square; its size and angle are free. |  |
| `polygon` | shapes | Draws a regular polygon: drag from its centre to a corner | 1. Press at the centre, drag out to a corner.<br>2. The number of sides is in the options. |  |
| `slot` | shapes | Draws a slot: drag between its two centres, then click its width | 1. Press at one end's centre, drag to the other's.<br>2. Then tap to one side to set its width. |  |
| `slot` — a width set | shapes |  | 1. Press at one end's centre, drag to the other's.<br>2. Its width is the one set in the options. |  |
| `region` | shapes | Combines faces into a region: click a face, then faces to subtract | 1. Tap inside a closed outline to make a region of it.<br>2. Then tap outlines inside it to cut them out. |  |
| `circle` | its own | Draws a circle: drag out from its centre, or click 3 points or edges | 1. Press at the centre and drag out to the rim.<br>2. Or tap three points for it to pass through.<br>3. A tap along a line or circle makes it touch that. |  |
| `circle` — locked: centre · radius | its own |  | 1. Press at the centre and drag out to the rim.<br>2. Locked to centre · radius: the options unlock it. |  |
| `circle` — locked: 3 points | its own |  | 1. Tap three points for it to pass through.<br>2. Locked to 3 points: the options unlock it. |  |
| `circle` — locked: tangent | its own |  | 1. Tap three lines or circles for it to touch.<br>2. Locked to tangent: the options unlock it. |  |
| `arc` | its own | Draws an arc: drag end to end and click its bulge, or click its centre | 1. Drag from end to end, then tap where it bulges to.<br>2. Or tap its centre, then its start, then its end.<br>3. Start at a line's end and bulge it smoothly: it stays tangent. |  |
| `arc` — locked: 3 points | its own |  | 1. Tap one end, the other, then where it bulges to.<br>2. Locked to 3 points: the options unlock it. |  |
| `arc` — locked: centre · ends | its own |  | 1. Tap its centre, then its start, then its end.<br>2. Locked to centre · ends: the options unlock it. |  |
| `arc` — locked: tangent | its own |  | 1. Press on the end of a line or arc, then tap where this arc ends.<br>2. Locked to tangent: the options unlock it. |  |
| `ellipse` | curves | Draws an ellipse: drag out its major axis, then click its minor | 1. Press at the centre, drag out along the long axis.<br>2. Then tap where the short axis ends. |  |
| `spline` | curves | Draws a spline through the points you click; double-click to end it | 1. Tap each point for the curve to pass through.<br>2. ✓ in the options ends it.<br>3. Tap the first point again to close it. | 2. Double-click the last point, or press Enter, to end it. |
| `fillet` | modify | Rounds a corner: click two lines that meet, or their corner | 1. Tap a corner, or the two lines that meet at it.<br>2. Set the radius in the options, then ✓. |  |
| `bevel` | modify | Chamfers a sketch corner: click two lines that meet, or their corner | 1. Tap a corner, or the two lines that meet at it.<br>2. Set the setback in the options, then ✓. |  |
| `trim` | modify | Trims a curve back to where others cut it: click or drag across pieces | 1. Tap the piece of a curve to remove.<br>2. Or drag across several pieces at once. |  |
| `extend` | modify | Extends a line or arc to the next curve: click near the end | 1. Tap a line or an arc near the end to lengthen.<br>2. It grows to the next curve in its way. |  |
| `offset` | modify | Offsets a curve or chain: click it, choose a side, ✓ — or drag it | 1. Tap a curve: its whole chain comes with it.<br>2. Drag beside it to pull the copy out.<br>3. ✓ makes it. |  |
| `mirror` | modify | Mirrors a copy: select, then click the mirror line or an axis | 1. Tap what to mirror, then ✓.<br>2. Tap the mirror line: any line, or an axis arrow.<br>3. ✓ again makes the copy. |  |
| `pattern` | modify | Copies in a row or round a centre: select, then step and count | 1. Tap what to copy, then ✓.<br>2. Set the step and the count in the options.<br>3. ✓ again makes the copies. |  |
| `pattern` — circular | modify |  | 1. Tap what to copy, then ✓.<br>2. Tap the point to turn about; set the angle and count.<br>3. ✓ again makes the copies. |  |
| `dimension` | relate | Dimensions what you click, a solid's faces too; a click places it | 1. Tap what to measure: a line, a circle, two points…<br>2. Then tap empty space to place it.<br>3. Double-tap the number to edit it. |  |
| `constrain` | relate | Relates what you pick: choose from the relations that apply | 1. Tap the things to relate.<br>2. Then choose: Parallel, Tangent…<br>3. Pick several for one relation; hold a line for Leave. | 1. Click the things to relate: two lines, a line and a circle…<br>3. Pick several for one relation; right-click a line for Leave. |
| `extrude` | sweep | Pulls a closed shape into a solid: click inside it, then ✓ | 1. Tap inside a closed outline.<br>2. Set the depth in the options; ⇅ turns it the other way.<br>3. ✓ builds the solid. |  |
| `cut` | sweep | Cuts a hole or a pocket into a solid: click a closed shape, then ✓ | 1. Tap inside a closed outline drawn on a solid.<br>2. Set how deep in the options.<br>3. ✓ cuts it out. |  |
| `revolve` | its own | Spins a closed shape into a solid: click it, then the axis, then ✓ | 1. Tap inside a closed outline.<br>2. Then tap a lit line or axis arrow to spin it about.<br>3. Set the angle in the options. ✓ builds it. |  |
| `sketch` | its own | Sketch on a face or Top, Front, Right: all you draw stays on it | 1. Tap a lit face — or Top, Front or Right in the options.<br>2. The view turns to it; what you draw is held on it.<br>3. Done, at the top beside its name, leaves the sketch. |  |
| `round` | modify | Fillets a solid's edges: click edges or a face, see it, then ✓ | 1. Tap edges of a solid; a face takes all its edges.<br>2. Set the radius in the options.<br>3. ✓ rounds them. |  |
| `chamfer` | modify | Chamfers a solid's edges, one setback: click edges or a face, then ✓ | 1. Tap edges of a solid; a face takes all its edges.<br>2. Set the setback in the options.<br>3. ✓ cuts them back. |  |
| `surface` | sweep | Sweeps curves into a surface: click a curve, set the depth, ✓ | 1. Tap a curve — or inside a closed outline, for a flat sheet.<br>2. Set the depth in the options, then ✓. |  |
| `edge` | sweep | Extrudes an edge: a copy of the curve, chords to it, the surface | 1. Tap a curve: its whole chain comes with it.<br>2. Set the depth in the options, then ✓. |  |
| `edit extrude` | none: `edit("e1")`, or Edit in a feature's menu | Changes an extrude: holes in or out, its depth, its way, how it ends | 1. Change the depth and the end in the options.<br>2. Tap an outline inside it to make or fill a hole.<br>3. ✓ applies; ✗ leaves it as it was. |  |
| `edit revolve` | none: `edit("e1")`, or Edit in a feature's menu | Changes a revolve: click holes in or out, or change the angle | 1. Change the angle in the options.<br>2. Tap an outline inside it to make or fill a hole.<br>3. ✓ applies; ✗ leaves it as it was. |  |

A group's button adds one line to a chosen tip: `relate` — *Hold this button
for Constrain.* / *…for Dimension.*; `curves` — *…for Spline.* / *…for
Ellipse.*; `sweep` — *…for Cut, Surface, Edge.* (and so on); `shapes` —
*…for Polygon, Slot, Region.*; `modify`, whose eight would be three lines —
*Hold this button for 8 more tools.*

**After review-relations merged** (2026-11-12, the same day): the constrain
tool's steps gained a third — *Pick several for one relation; hold a line
for Leave.* (a mouse: *right-click a line*) — both done in the browser on
the merged code: four lines picked and one press type `eq("l1", "l2", "l3",
"l4")`, one relation; a held line's menu offers *Leave r1 (= with l1, l2,
l4)*, which types `leave("r1", "l3")`. To keep the tip at eight lines under
a finger, its first two steps are one line each there: what can be picked is
said by the palette's own empty line, up at the same moment; a mouse's
tooltip keeps the examples.

### What doing it in the browser changed

The first draft was written from the tools' own comments and their `next`
words, then each line was done. What came out differently:

- **A rectangle is a drag only.** Two clicks leave the chip at "press at a
  corner" and make nothing; the polygon, the slot and the ellipse do take
  clicks. The rectangle's how says press, drag, let go.
- **Most tools put themselves down after one use** — a point, every shape, a
  confirmed feature — and the line, trim, extend, dimension and constrain do
  not. The ✓'s tooltip said the opposite (bug 77).
- **A circle's third click along a line makes a tangent only off the line's
  middle**: at the middle the midpoint snap wins and the point is a rim
  point. The how says "along a line", which is true where a hand lands.
- **Constrain is not on the tray**: it is behind Dimension's button. The
  spec's "tap Constrain" has no button to tap until it has been chosen once.
  Hence the group's line.
- **A double-tap on a dimension's number** opens its value under a finger
  too (tried, with the tool armed and not).
- **`par` on two free lines shrank them** to a few pixels and read SOLVED
  — `review-solver.md`'s, already in picture 422 and unseen there. Fixed
  there; with it merged in, picture 482 (retaken) shows the two lines
  parallel at their own lengths.

### Deviations and additions — each a decision, vetoable (TODO.md's register)

1. **An element of its own for the chosen tip** (`#chosentip`), not the
   tooltip's. The spec says "its tip"; they look the same. The reason is in
   ARCHITECTURE ("A tip is handed in…"): a tooltip is asked for and closed, a
   status is neither. A consequence worth saying plainly:
   `tooltips.e2e.ts` asserts that a tap "shows no tooltip", reading
   `#tooltip`. It passes unchanged and is still true of the tooltip — but a
   tap does now show a tip, in the other element. The sentence in that test
   is narrower than it reads; left as it is, for the reviewer to reword or
   not.
2. **Any press puts it away**, not only "the first touch on the drawing".
3. **The line about the button's other tools** (`Tip.also`, `groupAlso`):
   not in the spec.
4. **Steps are of the tool as armed** (`How` may be a function of the
   options): not in the spec, which says "every curve tool and its methods".
5. **The placement is a cost, not a place** (`chosenPlacement`), and tips
   start at one line (`STAY`). On an upright iPhone 13 at 100 % every tip is
   at x 57, y 50 (66 where the chip's words wrap to two lines), 329 wide,
   86–187 tall (the steps alone 86–125). **A nine-line tip ends inside the
   middle third's top edge**: the third starts at y 221 and twelve tools'
   tips (Select, Rectangle, Circle, Arc, Spline, Offset, Chamfer, Extrude,
   Cut, Surface, Edge, Sketch) end at y 235–253. The constrain tool's and
   the dimension tool's, eight lines, end at 217 and are clear of it.
6. **It lies over the action strip** on an upright phone.
7. **The palette's fit**: the wasted row was the empty "have" section, not a
   margin; it gives way where the rows overflow.
8. **The empty palette's line keeps its first four words.**
9. **`ui()`'s refusal** reads *ui() takes scale, show and hide, and tips*,
   so `chrome.e2e.ts`'s match of the old words holds.
10. **The ✓'s sentence** (bug 77).

### Limitations left in place, deliberately

- **Landscape** (picture 487): the tip lies over the drawing's right. Filed.
- **Merged with the working branch at 93abd3d** (review-relations,
  review-solver, linked-profiles): the trim tool now also takes a lid's edge
  and an extrude can be typed `open`; neither changes a step said here
  (trim's "the piece of a curve" holds of a lid's edge; `open` has no
  control in the extrude tool's options). The browser bug is 77.
- **Timings are arithmetic** (25 characters a second), not a person's
  reading on a phone.
- **The guidance lines and the summaries still say "click" on a phone**,
  now beside steps that say "tap". Filed.
- **Chromium's iPhone 13 emulation only**, like every phone test here.
