# Plan: a dragged panel shows where everything will land, and nothing moves until it is dropped

**Status: built** (2026-11-06), on `claude/panels-preview`; see *As built*
at the end for what was measured and every deviation. Queued 2026-11-05,
after `mode-feedback.md` (both are the chrome's; this one touches the
resolver and the panels' drawing). The owner:
*"the toolbars should push each other around, but they should show how they
will snap IF the user drops the grasped toolbar in that spot. but until they
actually drop it, the permanent position of any tool bar is not changed"*.

## What is true today

`panels-push.md` built pushing: dragging a panel into another moves the
other out of the way as the drag goes, and every pane is where the drag left
it the moment the finger lifts — the push is the layout, live. There is no
preview and no way back short of dragging things back.

Read `CLAUDE.md`, `panels.md`, `panels-push.md`, `panels-corners-wrap.md`,
`toolbar-icons-docking.md`, `everything-fits.md`, `chrome-logo-scale.md`,
`src/panels.ts` (`layout`, `placed`, `constrain`, the resolver, `arranged`),
`src/main.ts`'s panel dragging, `index.html`'s panel styles, and the panels,
fits, chrome and touchlayout tests.

## Design

- **The drag moves only the grasped panel**, drawn where the finger has it,
  lifted (a shadow, as a held card). Every other panel stays exactly where it
  is for the whole drag.
- **The preview**: at every move the resolver is asked what the layout would
  be if the panel were dropped here — the same `layout()` call that pushes
  today, on a copy — and the answer is drawn as **ghosts**: a translucent
  outline where each panel that would move will land, and the grasped
  panel's own outline where it will snap (docked to an edge, against a tray,
  wrapped to its lines). A panel the drop would not move shows no ghost. The
  ghosts update as the finger moves, cheaply (the resolver is pure; measure
  it per move on a phone and say the number).
- **A tray's turn is previewed too.** The owner: *"when I push a toolbar up
  against one side and it changes from horizontal to vertical layout. it
  should not actually change the toolbar between modes unless I let go"*. A
  tray dragged against an edge that would turn it (row to column, or back)
  keeps its orientation under the finger; its ghost shows the turned tray
  where it would dock, and the turn happens at the drop.
- **Every panel not in hand goes translucent for the drag** (the owner:
  *"when I am dragging toolbars, all the ungripped ones should go
  translucent"*): the grasped panel is drawn solid and lifted, the rest at
  half opacity with their ghosts at full line weight, so the picture reads
  as "this is where things will be", and they return to full opacity at the
  drop or the escape. Measure that the opacity change does not cost a frame
  on a phone (it is one class on the container).
- **The drop commits** the previewed layout in one step: panels move to
  their ghosts (a short settle, 120 ms, no spring). **Escape, or lifting
  back where the drag started, commits nothing**: every panel is where it
  was, the ghosts gone. A drop that fits nothing (the resolver's refusal)
  is the same as Escape, with a word in the status.
- **The rules of the push are unchanged**: what docks where, what wraps,
  what the logo stops, the device table — the preview only shows them before
  they happen. `everything-fits.md`'s claims hold for the committed layout
  and for every preview (nothing a ghost shows overlaps).
- Mouse and finger alike; on a phone the ghosts are drawn at the interface
  size's line weight so they read at 3×.

## Tests

Unit: the resolver's answer for a drag position equals the layout a drop
there commits; Escape leaves the layout equal to the start; a drag that
moves nothing draws no ghosts. E2E (mouse and iPhone 13, portrait and
landscape): drag the command line onto the log — the log's ghost moves,
the log does not; drop — it moves; drag and Escape — nothing moved; drag the
tray to an edge — its ghost turns, it does not until dropped; the fits
suite unchanged. LOOK at each picture: a ghost must read as a ghost.

## Docs

CHANGELOG at the top quoting the owner; ARCHITECTURE ("The chrome floats"
gains the preview); the register (ghosts; Escape; the settle) as vetoable;
STATUS; README's panels paragraph; `help()`; the spec marked built with the
deviations.

## As built

Built on `claude/panels-preview` (2026-11-06). By file: `src/panels.ts` (the
preview's pure half — `Drag`, `beginDrag`, `heldAt`, `dragTo`, `ghostsOf`,
`backSlop`, `dropOf`, `SETTLE_MS` — and in `Panels` the gesture rewritten
round it, `draw` split from `place`, the ghosts' layer, `settle`, the
`onRefused` option); `src/main.ts` (the refusal into the status note);
`index.html` (`dragging`, the lifted held panel, `.pghost`, `settling`);
`src/modules/interface.ts` (`help()`). Tests: `test/panelspreview.test.ts`
(13, one of them the same spot by two paths), `test/e2e/panelspreview.e2e.ts` (14: a mouse, and an iPhone 13 portrait
and landscape), `test/e2e/panels.measure.ts` (`npm run measure:panels`, not
in the suite), `settled()` in the e2e harness, and the suites that read
panels after a drop (`panels`, `chrome`, `tooloptions`, `undokeys`) waiting
on it.

**The rule: the preview is the drop at this spot.** What the ghosts show — and
what a drop commits — is a function of where the hand is now, not of the
path it took: the held panel taken from where it was at the press straight
to here, from the layout as it was at the press. Back at the press there are
no ghosts; any spot shows the same ghosts however it was reached.

**How it works.** At the press a `Drag` takes the layout as it is (`start`).
Each move asks the resolver for **one step**: `dragStep` with the grab as
taken, from `start` to the pointer (`preview`) — its push along each axis of
the move in turn, the larger first, by the mover's swept rectangle, and its
turn and re-grasp, asked once. That is the resolver's own single step,
chosen over replaying the straight line from the press in small steps: as
free of the path, but a resolve per step for a difference only in which way
a panel crossed diagonally is pushed. *(Revised on review: the first build
ran `dragStep` move by move on the copy, keeping the push's memory along the
path — a ghost pushed on the way stayed pushed when the hand drew back. The
owner's "IF the user drops the grasped toolbar in that spot" rules that
out.)* It also puts the held panel where
the hand has it (`heldAt`: the grab taken at the press under the pointer,
held inside the area and against nothing else; by a grip, that corner under
the pointer). The DOM half draws the held panel there (`draw`, which touches
no layout), and a ghost for each panel `ghostsOf` names: every panel the
preview has somewhere other than at the start, and the held one where its
landing is not exactly under the hand. `layoutProblem` checks every preview
as it checks a placed layout, so under the dev server a preview that
overlapped would be a page error in every e2e test. The drop is `dropOf`:
back within the slop of the press, the start; a preview `layoutProblem`
rejects, the start and a status note; otherwise the preview, shown with
`show` and stored with `remember` — one step, exactly what the ghosts
showed. Escape (a window capture listener for the gesture's life) and a
pointercancel drop nothing.

**Measured** (`npm run measure:panels`, two runs each, Chromium as an iPhone
13 on a shared four-core box; the browser's clock is coarse to 0.1 ms). The
per-move table is of the build as it stands — one step from the press, load
average about 7.7; the opacity table is of the first build, at about 5 (the
class did not change; the new runs agree, below). Per move — the handler, timed between a window capture listener
and a window bubble listener, so the resolver, drawing the held panel and the
ghosts, and the dev server's check; and the resolver alone, the same moves
replayed through `dragTo` in the page:

| CPU | handler median | handler p95 | handler max | resolver median | resolver p95 |
|---|---|---|---|---|---|
| 1× | 0.5 ms | 0.8 ms | 1.8–4.4 ms | < 0.1 ms | 0.1 ms |
| 4× | 1.9 ms | 4.1–4.5 ms | 10.8–14.4 ms | < 0.1 ms | 0.6–0.7 ms |

Resolving from the press does more per move than the step from the last
answer did — the first build's handler was 1.4–1.8 ms median and 2.2–2.8 ms
p95 at 4×, its resolver p95 0.1–0.4 ms — and is still a small part of a
16.7 ms frame. (Under the new build the opacity class again flipped on frames
of 16.7 ms median and p95 at 4× in both runs.)

The opacity change — frame intervals, requestAnimationFrame to the next:

| CPU | flips the class | flips nothing | drag, translucent | drag, opaque |
|---|---|---|---|---|
| 1× | 16.7 / 16.7 / 16.7–16.8 | 16.7 / 16.7–16.8 / 16.8 | 16.7 / 16.8–49.9 / 117–167 | 16.7 / 16.8–33.3 / 33–67 |
| 4× | 16.7 / 16.8 / 33.3 | 16.7 / 16.7–16.8 / 16.8–33.2 | 16.7 / 33.4 / 50–83 | 16.7 / 33.3–33.4 / 50 |

(median / p95 / max, ms, across the two runs). The class costs no frame at
the median or the 95th percentile at 1×; at 4× one flip in 60 took two frames
in each run, and in the second run so did one frame that flipped nothing.
The long frames while dragging are the machine's — the CDP-driven input on
a loaded box — and come with the translucency off too. **4× is a crude
stand-in for an iPhone 13**, whose A15 is faster than one of these cores
divided by four on most work: these are a ceiling to hold against a frame,
not the phone's numbers.

Deviations and additions — each a decision, vetoable (also in `TODO.md`'s
register):

- **One step, not the path replayed** (see the rule above). A consequence: a
  tray turned in the preview keeps the grab it was taken by, the column's,
  so its ghost leaves a chain when that column would clear it, not when the
  turned row would.
- **The held panel and the ghosts are lifted over the logo and the corner's
  status** for the drag (`LIFTED_Z`: the ghosts 46, the held panel 47; the
  corner is 40, the logo 45, the hover tag 50). The first screenshot had a
  row's ghost along the top under the status text: a ghost may land in the
  logo's row, which the corner keeps clear of only once panes are placed.
  The held panel therefore covers the logo while it is over it.
- **Back where it started** is within 2 px of the press for a mouse and 8 px
  (`HOLD_SLOP`, the tap's) for a finger.
- **Escape is the drag's alone** while one is held — captured on window and
  stopped, so main.ts's Escape does not also put the armed tool down (the
  e2e checks a line tool stays armed).
- **A pointercancel commits nothing**; before, it ended the gesture like a
  lift.
- **The drag's look starts with the first move**, not the press, so a tap on
  a strip — to raise a panel, or to read its tooltip — does not flash every
  other panel to half and back. (The grip test, which compares a held grip's
  pixels with none, caught the press-time version.)
- **A resize by a grip is previewed the same way**: the panel grows under the
  hand, over its neighbour, and the neighbour's ghost is pushed. The spec
  spoke of dragging; one rule for every gesture.
- **The ghosts' line is 1.5 px × the interface size, rounded to the whole
  pixel** (`round()` in the stylesheet): 2 px at a desktop's 100 % and a
  phone's, 3 px from a phone's 140 %. Chromium floors a border to a whole
  CSS pixel — the unrounded 1.95 px of a phone's 100 % drew 1 — which the
  phone e2e found by reading the computed width.
- **The held panel's own ghost is brighter** than the others', and not drawn
  while it lies exactly under the hand (an unblocked drag shows no ghost at
  all).
- **The settle** is a CSS transition of the panels' boxes under `settling`,
  120 ms, eased out; the rectangles, the store and every rule are the new
  layout at once, only the drawing catches up. An Escape or a lift back
  glides the held panel home the same way. The e2e harness's `settled()`
  waits for no drag, no settle and no running transition — a fixed pause of
  the settle's own length read frames of the glide under load.
- **The refusal** says `no layout fits there — nothing moved` in the status
  note and the reason in the console. In 1 500 random gestures on a phone's
  defaults (both ways up) no preview was refused; the branch is tested with
  a constructed preview.
- **Tests changed their claim where it was the old rule**: `panels.e2e.ts`'s
  "turns into a row — live, before the release" now asserts the column in
  the hand and the row as its ghost, and its push-chain test reads the
  ghosts mid-drag (the log and the command line not moved under the hand),
  checks that the ghosts come back up with the hand (no memory of the push)
  and that the same spot gives the same ghosts, and that the drop lands each
  panel on its ghost. Its old "back by exactly the lead, under the hand"
  measurement held only while the preview carried a turned tray's re-grasp
  from move to move.

Limitations left in place, deliberately:

- **Not tried on an iPhone**: the glide, half opacity over a shaded solid,
  and a ghost's dashes at 3×; the phone numbers are an emulation's.
- **The strip's tooltip** still reads *"Drag to move it; pushed against an
  edge or a pane, it stays there"* — true, but silent about Escape.
- **A busy preview is busy**: the command line pushed into the log on a
  portrait phone moves the organiser and the log at once, and the picture
  (181) has three ghosts over three faint panes. Each reads as a ghost; the
  whole takes a look.
