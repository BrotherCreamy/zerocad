# Plan: a touch harness that a loaded machine cannot fool

**Status: queued** (2026-11-06). This one is the manager's, not the owner's.
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
