# Plan: a touch harness that a loaded machine cannot fool

**Status: built** (2026-11-06), on `claude/touch-harness`; see *As built* at
the end for the load, the counts before and after, the cause as traced, the
candidate chosen and the two rejected. This one is the manager's, not the owner's.
A gate that is red by default stops telling anyone anything. The
`solidsphone.e2e.ts` drags (on an iPhone: Cut through the top; a boss on the
side) failed in the full gate after #75, #76, #77 and #78, four in a row. Each
time they passed alone (3/3). `overlaylock`'s tap between rows failed the same
way once (a press read as a long-press).

## What is true today

Read `CLAUDE.md`, `test/e2e/fingers.ts` (its header says what is already
stamped and why), `test/e2e/harness.ts`, the gesture recogniser (`LATE_MS`,
`LONG_PRESS_MS`, and how a press becomes a hold or a drag), and TODO.md's
entries near *"The cause for the drags: `fingers.ts` awaits each touch's
acknowledgement"* and *"Queued (2026-11-06): fix the touch harness"*.

- **Taps and holds are already safe.** They are stamped when they are sent,
  plus the pauses the test meant.
- **A drag's moves keep the browser's own stamps.** Stamping them 16 ms apart
  made every drag a fling, and Chromium then drops the next tap.
- So under load a drag's first move lands more than `LONG_PRESS_MS` after the
  landing, and the drag is read as a held press.
- Tried and dropped (2026-11-05): sending the first move unawaited, which
  broke every drag, and stamping it a frame after the landing, which fixed
  `onetool` but not the phone solids at load 15.

## Design

Find the fix that makes the phone tests mean the same thing at load 15 as
at load 2. Candidates; measure each before choosing:

- **Stamp a drag as the hand made it.** Each move gets the landing's stamp
  plus the intended gap. Keep the speed below Chromium's fling threshold, so
  no fling suppresses the next tap.
- **Drive the page's clock.** Playwright's `page.clock` (install, `runFor`),
  so the long-press timer cannot fire between two events the harness meant
  as one gesture.
- **Have the recogniser time a press by event stamps, not by a wall-clock
  timer**, if it doesn't already. A real phone stamps its events. That would
  be an app change, so say whether it is right for a real phone and not only
  for the harness. If it is not, don't make it.

## Requirements

- **Reproduce first, deterministically.** Put the box under a known load,
  e.g. N busy-loop processes, and show the drags failing before the fix and
  passing after. Report the load and the counts.
- No retries. No longer waits added to tests. Nothing skipped.

## Tests

- `solidsphone`, `solidfilletsphone`, `touch`, `overlaylock`, `android` and
  `surfacesphone`, each 5 runs alone under the induced load, all green, with
  the count reported.
- Then a full `npm run test:all`.

## Docs

- TODO's entries closed, with the cause and the fix.
- ARCHITECTURE's testing section if the harness's contract changed.
- `fingers.ts`'s header rewritten to say what is stamped and why.
- CHANGELOG at the top.
- The spec marked built.

## As built

Built on `claude/touch-harness` (2026-11-06). There are three changes. The
first is the harness (`test/e2e/fingers.ts`). The second is one rule in the
recogniser (`src/tools/gestures.ts`'s `move`, with its `at` passed by
`src/tools/engine.ts`) and three unit tests for it in `test/gestures.test.ts`.
The third is two of `overlaylock.e2e.ts`'s fixed sleeps against the page,
neither of them a touch, which now poll the condition they assert. No test was
skipped, retried or loosened, and none was given a longer wait.

**The load.** 20 busy loops, `node -e "for(;;);"`, on the 4-core box: a
1-minute load of 23–25 on its own. Another worker's full e2e suite ran beside
it for part of the time, which put the load at 27–36 for the later runs. The
before and after counts below are therefore not at one load, and the files
the extra load hurt were rerun interleaved (old, new, old, new…), so that each
pair saw the same machine.

**The cause, traced.** The page's pointer events (handled time and stamp)
were recorded against the harness's sends, and the recogniser's decisions
with them.

1. *The harness's (every `solidsphone` failure traced; the overlaylock tap by the counts).*
   Each `dispatchTouchEvent` was awaited, and every touch here is handled on
   the main thread: pagelock's non-passive `touchmove` listener is on the
   document, and the engine's `touchend` listener is on the canvas. A move
   cost 50–130 ms. The circle drag leaves `TAP_SLOP` on its 6th or 7th move
   of 12, sent at 475–518 ms. The timer fired on time (`LONGPRESS@506`), and
   the drag became a box. By the moves' own stamps it *was* a hold, so no
   change to the recogniser could fix this one.
2. *The recogniser's (android's Pixel 7 rectangle drag, once streamed).* The
   landing was handled at 67 ms, and every move was in the browser by 228. The
   page was busy until 568 and ran the timer 1 ms after it was due, so
   `LATE_MS` did not apply. The queued move, stamped 171, was dispatched only
   at the next frame, at 630, and became a box. Touch moves are rAF-aligned,
   and a timer can run before the frame that delivers them. That holds on a
   phone, whatever sends the events.

**The candidates, measured** (`solidsphone` at 20 loops, before: 1/5):

| Candidate | `solidsphone` | Kept? |
|---|---|---|
| Stamp a drag as the hand made it — streamed, every event stamped | 5/5 at 16 ms a move, 10/10 at 33 | yes |
| `page.clock` paused for a `drag()` | 3/3 | no |
| `page.clock` paused from the first landing to the last lift | 2/2, but `touch` 0/2 | no |
| The recogniser timing by stamps alone | — | not alone (cause 1); yes for cause 2 |

The page's clock freezes `performance.now()`. That breaks touch's *"a quick
tap while the page is busy is still a tap"*, the test of exactly the stamp
timing the recogniser relies on, and it fires the long-press by `runFor`
instead of in real time. It would make the tests mean something else at
every load.

**The harness's contract, as built.** Within one call, events go out at the
hand's pace and are not awaited one by one. The pace is a move every 33 ms
and a 40 ms tap, on the test process's own clock. Those are real-time gaps a
hand makes, and the only fixed sleeps in it. Each call waits for all of its
events before it returns, so a test reads the page with the finger where the
call left it. `hold` waits for its landing before it starts holding. Every
event is stamped with the hand's clock: the wall clock less the time spent
waiting for the browser.

**Why 33 ms, and the regression it fixed.** The first build sent a move every
16 ms, and the header said that was what an unloaded box sent before. It was
not. The full gate caught it in toolbargroups' iPhone-landscape slide: the
plain tap after the slide was lost, 0/3 alone on an unloaded box, a test that
had passed in every one of twelve earlier gates. Measured on that slide, the
old helper sent a move every 32–35 ms (its 16 ms settle, plus the
acknowledgement and Playwright's round trip). At 16 ms the same twelve steps
were a flick twice as fast, and Chromium dropped the tap 400 ms after its
fling. At 33 ms it is 3/3 alone, and the counts below were all taken again at
that pace.

**The recogniser's rule.** A held press whose move past the slop is stamped
before `LONG_PRESS_MS` (by the finger's clock, the landing's stamp) was a
drag. The long-press is abandoned, its menu withdrawn as a second finger
withdraws it, and the drag starts where the finger landed. With no stamp, or
a stamp after, it is the box, as before. That is right for a phone: a page
busy drawing at touchdown cannot turn a finger that moved at 171 ms into a
long-press. It is the reading `up` already uses for a tap's length.

**Counts, each file alone, 5 runs, 20 busy loops** (before: the old harness
and recogniser; after: everything on this branch, at 33 ms a move):

| File | Before | After |
|---|---|---|
| `solidsphone` | **1/5** (the two drags, 4 times; load 24) | **5/5** (load 10–20 as the loops warmed), then 5/5 again (23–24) |
| `solidfilletsphone` | 5/5 (24–26) | 5/5 (20–23) |
| `touch` | 5/5 (25–30) | 5/5 (23–25) |
| `overlaylock` | **3/5** (the tap between rows twice, the fade once; 28–36) | **5/5** (26–29) |
| `android` | **1/5** (2–5 tests a run; 25–27) | **5/5** (24–26) |
| `surfacesphone` | 5/5 (24–26) | 5/5 (22–23) |
| `toolbargroups` (the gate's catch, above) | — | 5/5 (23–24) |

The 1-minute load is in brackets.

**The runs on the way, and what each settled.** The 16 ms build, harness
only: `solidsphone`, `solidfilletsphone`, `touch` and `overlaylock` were 5/5.
`android` was 0/5 and `surfacesphone` 4/5, but at load 31–37, with another
worker's suite beside mine. Interleaved on one machine (old harness, new, old,
new…) at load 27–36, `android` was 0/5 against 1/5. That is 18 failed tests
against 4, and every one of the new harness's 4 was the Pixel rectangle drag
of cause 2. `surfacesphone` was 5/5 against 5/5. With both changes at 16 ms,
`overlaylock` was 3/5: both failures were the rotation's 400 ms sleep, which
is not a touch. With its two sleeps timed by the page it was 5/5. The
recogniser's rule against the timer alone, both with the streamed harness at
load 24–29, was 4/5 against 4/5: at that load the race did not come up in the
runs that would have told them apart. So the rule stands on the trace and on
its unit test, which fails without it, and not on a count.

**Left in place, deliberately** (TODO):

- At load 25 and up, a tap on a chrome button or the logo is now and then lost
  with either harness. The page took 400–1,400 ms to handle the touch, and
  the click is Chromium's own synthesis from the touch sequence; a busy page
  answers late whatever sends the events.
- A move stamped *after* `LONG_PRESS_MS` but handled before a late timer is
  still read as a drag, not as a hold and then a box. Nothing measured needs
  it.
- The long-press timer starts when the landing is *handled*. A hold made while
  the page is blocked at touchdown can lift before it is due and come to
  nothing. That is an app question; nothing in the suite hits it.
- Safari's `timeStamp` may be the time the web process made the event, not
  the touchscreen's. If so, the stamp rule changes nothing there (the stamp
  is late, so the press stays the box), which is no worse than before. It has
  not been tried on a device.

**The full gate** (`npm run test:all`, with my loops stopped, load 7–20):
green. Typecheck had 0 errors. The unit suite was 1675/1675 and the kernel
crate 11/11. The e2e suite was 699 passed and 0 failed, with 2 skipped (the
picture tests, which need `NEOCAD_E2E_SHOTS`). The gate before it, at 16 ms a
move, had failed on exactly one test, toolbargroups' slide, which is what found
the pace.
