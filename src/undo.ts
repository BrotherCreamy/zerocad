// Undo/redo: a stack of whole-model snapshots.
//
// The journal invites a cleverer design — undo a structural change by
// truncating the journal and replaying it — and it is the wrong one. Value-only
// changes (a drag, a solve) are never journalled, so journal-truncation undo
// would need value snapshots *as well*, and the hybrid is more machinery than
// either half of it. Whole-model snapshots are the boring design, and this repo
// already owns the perfect snapshot format: the text `save()` produces captures
// journal *and* values and round-trips byte for byte, and restoring one is
// exactly what `open()` already does.
//
// So there is nothing here but a stack. It is generic over what a snapshot is
// and imports nothing, which is the point: no model, no persistence, no DOM, so
// the semantics below can be tested on strings in a few microseconds. The host
// decides what a snapshot is (main.ts uses `save(model, false)`), when to take
// one, and how to put one back. This file only remembers them in order.

/**
 * How many undo steps are kept. cellwork's number. The cost of a step is one
 * serialised model, so a cap is about memory rather than about the interaction;
 * a hundred is far more than anyone reaches by hand and still small next to a
 * single bitmap.
 */
export const DEFAULT_LIMIT = 100;

export class UndoStack<T = string> {
  /** Snapshots of states we can go back to, oldest first. */
  private past: T[] = [];
  /** States undone out of, most recently undone last. */
  private future: T[] = [];
  readonly limit: number;

  constructor(limit: number = DEFAULT_LIMIT) {
    if (!Number.isFinite(limit) || limit < 1) throw new Error("an undo stack needs room for at least one step");
    this.limit = Math.floor(limit);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** How many undo steps are available. */
  get depth(): number {
    return this.past.length;
  }

  /** How many redo steps are available. */
  get redoDepth(): number {
    return this.future.length;
  }

  /**
   * Records the state a user action started from.
   *
   * **Pushing clears redo**, which is the one rule here that is a decision
   * rather than bookkeeping: once you undo twice and then draw something, the
   * states you had undone are no longer reachable by going forward — there is
   * no "forward" from where you now are. Every editor works this way, and the
   * alternative (a tree) is a different feature with a different interface.
   */
  push(before: T): void {
    this.past.push(before);
    // Drop from the far end rather than refusing the push: the steps worth
    // keeping are the recent ones.
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
    this.future.length = 0;
  }

  /**
   * Pushes `before` only if the action actually changed anything — the whole
   * of the policy that keeps `ls()` and `help()` out of the history. Returns
   * whether a step was recorded, which is the useful thing to assert about.
   *
   * Snapshot equality is doing the work, so a `T` that is compared by identity
   * (an object, rather than the text of a saved model) makes this method mean
   * something much weaker. Hosts pass strings.
   */
  pushIfChanged(before: T, after: T): boolean {
    if (before === after) return false;
    this.push(before);
    return true;
  }

  /**
   * Steps back. `current` is where the model is *now* — the caller passes it in
   * rather than the stack keeping a copy, because between one action and the
   * next the model is edited by things the stack never hears about, and a copy
   * kept here would be stale by exactly the amount that matters.
   *
   * Returns the snapshot to restore, or `undefined` if there is nothing to go
   * back to. Nothing is mutated in the `undefined` case, so a redundant Ctrl+Z
   * costs nothing and loses nothing.
   */
  undo(current: T): T | undefined {
    const target = this.past.pop();
    if (target === undefined) return undefined;
    this.future.push(current);
    return target;
  }

  /** Steps forward again. The mirror of `undo`, and it does not clear anything. */
  redo(current: T): T | undefined {
    const target = this.future.pop();
    if (target === undefined) return undefined;
    this.past.push(current);
    return target;
  }

  /** Forgets everything. */
  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
  }
}
