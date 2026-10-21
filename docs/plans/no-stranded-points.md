# Plan: a refused constructor leaves nothing behind

**Status: built** (2026-10-21) — one PR against `claude/resume-tasks-o7q02e`;
`claimFirst` in `src/model.ts`, tests in `test/stranded.test.ts`. The one
deviation (an explicit `pN` name its own auto-points would have taken now
succeeds instead of being refused) is on the register's Done entry in
`TODO.md`. The register's "Smaller things" item: *a
constructor refused for its name strands its auto-created points.* Read
`CLAUDE.md`, the register entry in `TODO.md`, and `src/model.ts`'s
`claimName`, `addPoint`, `addLine`, `addCircle`, `addArc`, `addFrame`,
`freePointOffset` and `withoutRecording`.

## The bug

`addLine`, `addCircle`, `addArc` and `addFrame` create their missing points
(unjournalled by design: the constructor's own journal entry recreates them
on replay) *before* `claimName` checks the name. So `addLine(null, null,
"a.b")` throws with `p1` and `p2` left in the model and nothing in the
journal — points that vanish on save/open, and that advance the `p` counter
in a way a replay does not reproduce, so names diverge between a session and
its file. Measured on the register: one refused `addLine` leaves 2 points; a
refused 2D `addFrame` 2 more; a 3D one would leave 3.

## The fix

**Everything that can refuse runs before anything is made**, uniformly across
the four constructors — the `del` batch rule, the clause rule, the rule the
command layer already follows for `circ`/`arc` (it resolves the plane before
the view-centre anchor is made, for exactly this reason). Concretely: the
name is validated (or claimed, if `claimName` is a check rather than a
reservation — read it and say which in the code) and every other refusal
(given refs exist and are of the right kind; the two line points differ; the
plane resolves) is raised *before* the first `freePointOffset`/`addPoint`.
If `claimName` both checks and consumes a counter, do not consume it before
the other checks can still throw; split the check from the claim, or order
the checks so the claim is last of the refusals and first of the effects.
Keep the journal entries byte-identical to today's for every successful call
(the replay table in `persist.ts` must not need to change; prove it with the
existing double-save tests). Nothing above `model.ts` changes.

## Verification

Unit (`test/model.test.ts` or a sibling): for each of the four constructors,
a refused call (bad name; nonexistent ref; a line with the same point twice;
a circle in 2D with a plane named; a 3D circle with no plane) leaves the
entity count, the point counter and the journal exactly as they were, in 2D
and in 3D; a successful call's journal entry is unchanged. A save/open
round-trip after a refusal names the next point the same in both. Full
`npm run test:all` green. Docs: CHANGELOG at the top; the register item
ticked with the measurement updated; this file marked built.

## Delivery

Isolated worktree, branch `claude/no-stranded-points` off the working-branch
tip, one PR against `claude/resume-tasks-o7q02e`. Do not merge; the
supervising session reviews.
