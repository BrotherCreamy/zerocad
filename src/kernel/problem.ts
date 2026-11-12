// The kernel's only public surface for "solve something": a flat variable
// vector plus a set of residual blocks. Nothing here knows what a point or
// a line is — geometry lives entirely above this file (see src/relations,
// src/tools). A residual block declares which global variable indices it
// reads and a function from Duals to Duals; evaluating it once with Dual
// arithmetic yields both its value and its exact (sparse) derivatives, which
// this file assembles into a sparse Jacobian and hands to the WASM kernel
// for the expensive part: one damped linear solve per Newton step.

import { Dual } from "./dual.ts";
import initWasm, { null_support, solve_step } from "./wasm-gen/neocad_kernel.js";

/**
 * Which variables a block reads, either as a fixed list or as a thunk
 * re-consulted at every evaluation.
 *
 * The thunk form exists because the entity a relation is *about* can be
 * restructured under it. A relation on a line means "this line", not "these
 * two points as they stood when I was written" — so when an operation
 * re-points that line at a different endpoint (a fillet trimming a corner
 * back, say), the relation has to follow. A captured index list cannot; a
 * thunk that reads the line's current refs can.
 */
export type VarRefs = number[] | (() => number[]);

export interface ResidualBlock {
  varIndices: VarRefs;
  fn: (locals: Dual[]) => Dual[];
  label?: string; // for diagnostics/offender reporting, optional
}

/**
 * A ticket for one stored residual block, handed out by `addResidual` and
 * spent by `removeBlock`.
 *
 * Monotonic and never reused, which is the whole point of it being a handle
 * rather than an index: something above this file has to remember which blocks
 * belong to which constraint, and an index would be invalidated by every
 * removal that happened to come earlier in the list. A number that is only
 * ever handed out once can be held indefinitely and is either still live or
 * definitely gone — never quietly someone else's.
 */
export type BlockHandle = number;

function resolve(refs: VarRefs): number[] {
  return typeof refs === "function" ? refs() : refs;
}

/**
 * Euclidean norm, as a loop rather than `Math.hypot(...r)`. Spreading the
 * residual vector into an argument list works fine until the model is big
 * enough to exceed the engine's argument limit, at which point it throws
 * rather than slowing down — a bad failure mode for something that scales
 * with the size of the drawing.
 */
function norm2(r: number[]): number {
  let sum = 0;
  for (const v of r) sum += v * v;
  return Math.sqrt(sum);
}

/** Largest magnitude in `r`, or 0 if it is empty. A loop, for norm2's reason. */
function maxAbs(r: number[]): number {
  let worst = 0;
  for (const v of r) {
    const mag = Math.abs(v);
    if (mag > worst) worst = mag;
  }
  return worst;
}

export interface SolveReport {
  solved: boolean;
  iterations: number;
  maxResidual: number;
  offenders: { label: string; residual: number }[];
  /**
   * The stored blocks whose residual stayed large — the rows `offenders` names
   * by label, named by handle instead, largest first. A handle is what the
   * layer above can map back to whatever added the block (a relation, in
   * model.ts); a label is only words.
   */
  blocks: BlockHandle[];
}

/**
 * A row the analysis adds that no block holds: `coeffs` over `vars`, a linear
 * statement "this combination does not count as a freedom". For a variable
 * direction that is a *gauge* — a length nothing reads, a scale every residual
 * is blind to — which would otherwise be reported free forever. Plain numbers
 * over plain indices: what a gauge means is the caller's business.
 */
export interface GaugeRow {
  vars: number[];
  coeffs: number[];
}

/** What `analyse` found. See there. */
export interface Analysis {
  /** The rank of the stored rows, with the gauge rows, over the columns analysed. */
  rank: number;
  /** Columns analysed minus that rank: how many independent ways the variables can still move. */
  dof: number;
  /** The variables some such motion moves, ascending. */
  free: number[];
  /**
   * The stored blocks with at least one row that the rows before it already
   * imply — `dependent` of their `rows` — in the order they were stored. A
   * block all of whose rows are dependent says nothing new: redundant.
   */
  dependent: { block: BlockHandle; rows: number; dependent: number }[];
  /**
   * For each block whose every row is dependent — asked for with `agreeing`
   * — the blocks it agrees with: those without any one of which it would no
   * longer be implied, or, where no single one is needed (a row said three
   * times), every block that takes part in a dependency with it. Who said it
   * first is not recorded: the set is what is said twice, not who to blame.
   */
  agreeing: { block: BlockHandle; with: BlockHandle[] }[];
}

/**
 * How many blocks the agreeing search tries per implied block, and how long
 * it may take in all. Past either, the implied block's set is every block in
 * the support — correct as "these take part in saying something twice",
 * wider than the least set. A drawing with hundreds of agreeing relations is
 * the one that would pay for exactness, and it is the one least able to read
 * the answer.
 */
export const AGREEING_TRIALS = 40;
export const AGREEING_MS = 150;

/** Relative rank tolerance for `analyse`: a column counts when its remainder is above this share of its norm. */
const RANK_TOL = 1e-9;

/** How far off a stored row must stay for a solve to call it an offender. */
const OFFENDING = 0.05;

/**
 * How the kernel can be handed to us: a URL to fetch (the browser path) or the
 * bytes directly (what the tests do, since Node has no fetch for a local file
 * worth bothering with). The type said `string` for a long time and every test
 * cast its way around it, which is exactly the sort of lie a typecheck is for.
 */
export type WasmSource = string | URL | Response | BufferSource | WebAssembly.Module;

let wasmReady: Promise<unknown> | null = null;
export function ensureKernelLoaded(wasm?: WasmSource): Promise<unknown> {
  if (!wasmReady) wasmReady = initWasm(wasm ? { module_or_path: wasm } : undefined);
  return wasmReady;
}

export class Problem {
  private values: number[] = [];
  /**
   * Stored blocks, each under the handle it was added with. Kept as
   * `{ id, block }` entries rather than a bare array so that removing one
   * cannot shift another block's identity — the handles a caller is holding
   * stay valid across any number of removals.
   */
  private blocks: { id: BlockHandle; block: ResidualBlock }[] = [];
  private nextHandle: BlockHandle = 1;

  addVar(initial: number): number {
    this.values.push(initial);
    return this.values.length - 1;
  }
  getVar(i: number): number { return this.values[i]; }
  setVar(i: number, v: number): void { this.values[i] = v; }
  get varCount(): number { return this.values.length; }
  get blockCount(): number { return this.blocks.length; }

  addResidual(varIndices: VarRefs, fn: (locals: Dual[]) => Dual[], label?: string): BlockHandle {
    const id = this.nextHandle++;
    this.blocks.push({ id, block: { varIndices, fn, label } });
    return id;
  }

  /**
   * Forgets the block `handle` names. An unknown handle throws rather than
   * being ignored: the only way to hold one is to have been given it, so a
   * handle that names nothing means whatever is keeping the books above this
   * file has lost track — and a removal that silently did nothing would leave
   * that constraint in the drawing with no sign of why.
   */
  /** The label a stored block was added with, or undefined (no label, or no such block). */
  labelOf(handle: BlockHandle): string | undefined {
    return this.blocks.find((e) => e.id === handle)?.block.label;
  }

  removeBlock(handle: BlockHandle): void {
    const i = this.blocks.findIndex((e) => e.id === handle);
    if (i < 0) throw new Error(`no residual block ${handle}`);
    this.blocks.splice(i, 1);
  }

  /** Every variable's value, copied: what `restore` takes back. */
  snapshot(): number[] {
    return this.values.slice();
  }

  /**
   * Puts values back from a `snapshot`: all of them, or only `vars`. A
   * variable made since the snapshot keeps its value, since the snapshot has
   * none for it.
   */
  restore(saved: readonly number[], vars?: Iterable<number>): void {
    if (vars === undefined) {
      for (let i = 0; i < saved.length && i < this.values.length; i++) this.values[i] = saved[i];
      return;
    }
    for (const i of vars) if (i >= 0 && i < saved.length && i < this.values.length) this.values[i] = saved[i];
  }

  /**
   * **The stored blocks not met at the current values**: those with a row
   * farther from zero than `tol`. One evaluation, no step; handles ascending.
   * What a caller asks before reading anything into a block's rank: a row
   * that is implied by others to first order says nothing new only if it
   * also holds.
   */
  unmet(tol: number): BlockHandle[] {
    const { r, storedRows, owners } = this.evaluate();
    const out = new Set<BlockHandle>();
    for (let i = 0; i < storedRows; i++) if (!(Math.abs(r[i]) <= tol)) out.add(owners[i]);
    return [...out].sort((a, b) => a - b);
  }

  /** Every stored block's handle, in the order they were stored. */
  handles(): BlockHandle[] {
    return this.blocks.map((e) => e.id);
  }

  /** The variables a stored block reads now (a thunk is asked again), or [] for no such block. */
  varsOf(handle: BlockHandle): number[] {
    const e = this.blocks.find((x) => x.id === handle);
    return e ? [...resolve(e.block.varIndices)] : [];
  }

  /**
   * How many rows a stored block gives **now** (its function is asked at the
   * current values), or 0 for no such block. A block may give a different
   * number from one evaluation to the next — a profile's edges change, a
   * length that another relation has taken over gives none — so the count is
   * asked, not remembered.
   */
  rowsOf(handle: BlockHandle): number {
    const e = this.blocks.find((x) => x.id === handle);
    if (!e) return 0;
    const vars = resolve(e.block.varIndices);
    return e.block.fn(vars.map((gi, li) => Dual.variable(this.values[gi], li))).length;
  }

  /**
   * **What can move with these variables**: the connected component of
   * `seed` in the graph whose edges are the stored blocks. A variable is
   * joined to every block reading it, and a block to every variable it reads.
   * A block outside the component shares no variable with it, so solving the
   * component alone (`solve({ only })`) settles it exactly as a whole solve
   * would. Variables and handles ascending; plain indices and handles, since
   * what the variables are is the caller's business.
   */
  connected(seed: Iterable<number>): { vars: number[]; blocks: BlockHandle[] } {
    const reads = this.blocks.map((e) => ({ id: e.id, vars: resolve(e.block.varIndices) }));
    const readers = new Map<number, number[]>();
    reads.forEach((b, k) => {
      for (const v of b.vars) {
        const list = readers.get(v);
        if (list) list.push(k);
        else readers.set(v, [k]);
      }
    });
    const vars = new Set<number>();
    const blocks = new Set<number>();
    const stack = [...seed];
    while (stack.length) {
      const v = stack.pop()!;
      if (vars.has(v)) continue;
      vars.add(v);
      for (const k of readers.get(v) ?? []) {
        if (blocks.has(k)) continue;
        blocks.add(k);
        for (const w of reads[k].vars) if (!vars.has(w)) stack.push(w);
      }
    }
    return {
      vars: [...vars].sort((a, b) => a - b),
      blocks: [...blocks].map((k) => reads[k].id).sort((a, b) => a - b),
    };
  }

  /**
   * **How far each block is from `seed`**, in blocks: 0 for a block reading a
   * seed variable, 1 for one reading a variable of those, and so on through
   * the same graph `connected` walks. A block out of reach is absent. What
   * orders a search by nearness to where something went wrong.
   */
  reach(seed: Iterable<number>): Map<BlockHandle, number> {
    const reads = this.blocks.map((e) => ({ id: e.id, vars: resolve(e.block.varIndices) }));
    const readers = new Map<number, number[]>();
    reads.forEach((b, k) => {
      for (const v of b.vars) {
        const list = readers.get(v);
        if (list) list.push(k);
        else readers.set(v, [k]);
      }
    });
    const out = new Map<BlockHandle, number>();
    const seen = new Set<number>(seed);
    let layer = [...seen];
    for (let d = 0; layer.length; d++) {
      const next: number[] = [];
      for (const v of layer) {
        for (const k of readers.get(v) ?? []) {
          if (out.has(reads[k].id)) continue;
          out.set(reads[k].id, d);
          for (const w of reads[k].vars) if (!seen.has(w)) { seen.add(w); next.push(w); }
        }
      }
      layer = next;
    }
    return out;
  }

  clear(): void {
    this.values = [];
    this.blocks = [];
    // The handle counter deliberately does *not* reset: a handle from before
    // the clear must not come back to life as some later block's.
  }

  /**
   * Evaluate all residual blocks at the current values, with full sparse
   * Jacobian. `extra` blocks are evaluated after the stored ones and are not
   * retained; `storedRows` is where they begin, which is all a caller needs to
   * tell an accusation from a nudge (see `solve`).
   */
  private evaluate(extra: ResidualBlock[] = [], only?: ReadonlySet<BlockHandle>): {
    r: number[]; rows: number[]; cols: number[]; vals: number[]; labels: (string | undefined)[]; storedRows: number;
    owners: BlockHandle[];
  } {
    const r: number[] = [];
    const rows: number[] = [];
    const cols: number[] = [];
    const vals: number[] = [];
    const labels: (string | undefined)[] = [];
    // The block each row came from (0 for an extra), so a row can be named by
    // the handle its owner was given.
    const owners: BlockHandle[] = [];
    const run = (block: ResidualBlock, owner: BlockHandle) => {
      const varIndices = resolve(block.varIndices);
      const locals = varIndices.map((gi, li) => Dual.variable(this.values[gi], li));
      const outs = block.fn(locals);
      for (const out of outs) {
        const rowIdx = r.length;
        r.push(out.val);
        labels.push(block.label);
        owners.push(owner);
        for (const [localSlot, deriv] of out.grad) {
          if (deriv === 0) continue;
          rows.push(rowIdx);
          cols.push(varIndices[localSlot]);
          vals.push(deriv);
        }
      }
    };
    // Stored blocks first, so the row count at the hand-over is the boundary
    // between what the problem *is* and what this one solve was also asked to
    // weigh. A row index, rather than a flag per block, because that is what
    // the report has to slice.
    for (const entry of this.blocks) if (!only || only.has(entry.id)) run(entry.block, entry.id);
    const storedRows = r.length;
    for (const block of extra) run(block, 0);
    return { r, rows, cols, vals, labels, storedRows, owners };
  }

  /**
   * Damped Gauss-Newton (Levenberg-Marquardt), warm-started from current
   * values.
   *
   * `extra` blocks take part in this solve and this solve only: they are
   * evaluated alongside the stored ones at every iteration and are gone when
   * it returns, having been added to nothing. That is what a caller wants for
   * a residual that expresses a momentary intention rather than a property of
   * the model — a soft pull toward wherever a cursor happens to be, say.
   *
   * They are also excluded from the report. A deliberately weak residual never
   * reaches zero (that is what makes it weak), so counting it as an offender
   * would report a conflict that is not one; and `maxResidual` is meant to say
   * how well the *model* is satisfied, which a transient nudge would spoil.
   *
   * `only`, when given, is the stored blocks that take part: the rest are
   * left out of this solve as though they were not there, and a variable only
   * they read stays where it is. What a caller asking "would these blocks
   * alone agree?" needs (the conflict search, model.ts's `conflicting`)
   * without removing anything it would then have to put back: a block is a
   * closure, and a removed one cannot be.
   *
   * `stall`, when given, ends the solve once an accepted step lowers the
   * residual's norm by less than that share of it. For a solve that is meant
   * to settle on a compromise (weak `extra` rows against stored ones): its
   * norm never reaches `tol`, and without this it creeps on to `maxIter` by
   * improvements that change nothing a caller would read.
   */
  solve(opts: { maxIter?: number; tol?: number; extra?: ResidualBlock[]; only?: ReadonlySet<BlockHandle>; stall?: number } = {}): SolveReport {
    const maxIter = opts.maxIter ?? 60;
    const tol = opts.tol ?? 1e-9;
    const stall = opts.stall ?? 0;
    const extra = opts.extra ?? [];
    const only = opts.only;
    const n = this.values.length;

    let { r, rows, cols, vals, labels, storedRows, owners } = this.evaluate(extra, only);
    let norm = norm2(r);
    if (n === 0 || r.length === 0) {
      return { solved: true, iterations: 0, maxResidual: 0, offenders: [], blocks: [] };
    }

    let lambda = 1e-3;
    let iterations = 0;
    for (; iterations < maxIter && norm > tol; iterations++) {
      let improved = false;
      const was = norm;
      for (let tries = 0; tries < 8 && !improved; tries++) {
        const dx = solve_step(
          new Uint32Array(rows), new Uint32Array(cols), new Float64Array(vals),
          new Float64Array(r), n, lambda,
        );
        const saved = this.values.slice();
        for (let i = 0; i < n; i++) this.values[i] += dx[i];
        const next = this.evaluate(extra, only);
        const nextNorm = norm2(next.r);
        if (isFinite(nextNorm) && nextNorm < norm) {
          r = next.r; rows = next.rows; cols = next.cols; vals = next.vals; labels = next.labels;
          storedRows = next.storedRows; owners = next.owners;
          norm = nextNorm;
          lambda = Math.max(1e-10, lambda / 3);
          improved = true;
        } else {
          this.values = saved; // revert the trial step
          lambda *= 8;
        }
      }
      if (!improved) break;
      if (was - norm < stall * was) { iterations++; break; }
    }

    // Only the stored rows may accuse, or report how far off the model is.
    const stored = r.slice(0, storedRows);
    const offenders: { label: string; residual: number }[] = [];
    const seen = new Map<string, number>();
    const byBlock = new Map<BlockHandle, number>();
    stored.forEach((v, i) => {
      const mag = Math.abs(v);
      if (mag > OFFENDING) {
        const label = labels[i] ?? `r${i}`;
        seen.set(label, Math.max(seen.get(label) ?? 0, mag));
        byBlock.set(owners[i], Math.max(byBlock.get(owners[i]) ?? 0, mag));
      }
    });
    for (const [label, residual] of seen) offenders.push({ label, residual });
    offenders.sort((a, b) => b.residual - a.residual);
    const blocks = [...byBlock].sort((a, b) => b[1] - a[1]).map(([id]) => id);

    return { solved: offenders.length === 0, iterations, maxResidual: maxAbs(stored), offenders, blocks };
  }

  /**
   * **What is still free, and what is said twice** — the rank of the Jacobian
   * at the current values, from the kernel (`null_support`), asked twice.
   *
   * Asked of J itself — the stored rows, then `gauge` — the support of its null
   * space: every variable some motion moves while no residual changes to first
   * order. Those are the free variables; `dof` counts the independent motions.
   * Asked of Jᵀ, the stored rows each implied by the rows stored before it: a
   * block whose every row is one of those says nothing the drawing did not
   * already say. The gauge rows take no part in that second question — they
   * are not the problem's, and a block must not be called redundant for
   * agreeing with a statement nobody made.
   *
   * `vars`, when given, are the only columns analysed: the caller's live
   * variables, since this file never forgets a variable, and one nothing owns
   * any more would otherwise count as a freedom. A block reading a column
   * outside them is read as though that column were constant.
   *
   * First-order, as every rank test is: a variable held only by a residual
   * whose gradient vanishes at its own root would read free — one more reason
   * no relation here is ever written as a square.
   *
   * Point-blind like the rest of this file: columns are variables and rows
   * residuals. What a variable *is* is the caller's to say.
   */
  analyse(opts: { vars?: number[]; gauge?: GaugeRow[]; agreeing?: boolean } = {}): Analysis {
    const { rows, cols, vals, storedRows, owners } = this.evaluate();
    const all = this.values.length;
    const live = opts.vars
      ? [...new Set(opts.vars)].filter((i) => i >= 0 && i < all).sort((a, b) => a - b)
      : Array.from({ length: all }, (_, i) => i);
    const at = new Int32Array(all).fill(-1);
    live.forEach((v, k) => { at[v] = k; });
    const n = live.length;
    // J over the live columns, then each gauge row under it.
    const jr: number[] = [], jc: number[] = [], jv: number[] = [];
    for (let k = 0; k < rows.length; k++) {
      const c = at[cols[k]];
      if (c < 0) continue;
      jr.push(rows[k]); jc.push(c); jv.push(vals[k]);
    }
    const stored = jr.length;
    let m = storedRows;
    for (const g of opts.gauge ?? []) {
      g.vars.forEach((v, i) => {
        const c = v >= 0 && v < all ? at[v] : -1;
        if (c < 0 || g.coeffs[i] === 0) return;
        jr.push(m); jc.push(c); jv.push(g.coeffs[i]);
      });
      m++;
    }
    const outJ = null_support(new Uint32Array(jr), new Uint32Array(jc), new Float64Array(jv), m, n, RANK_TOL);
    const rank = outJ[0];
    const free: number[] = [];
    for (let k = 0; k < n; k++) if (outJ[k + 1] !== 0) free.push(live[k]);

    // Jᵀ, stored rows only: a row is a column now, and a non-pivot (2) is one
    // the rows before it already imply.
    const outT = null_support(
      new Uint32Array(jc.slice(0, stored)), new Uint32Array(jr.slice(0, stored)), new Float64Array(jv.slice(0, stored)),
      n, storedRows, RANK_TOL,
    );
    const dependent: Analysis["dependent"] = [];
    let last: Analysis["dependent"][number] | null = null;
    // Every block with a row in the left null space's support — a pivot some
    // null vector moves (1) or a non-pivot (2): the blocks that take part in
    // saying something twice, whichever of them was said first.
    const support: BlockHandle[] = [];
    for (let i = 0; i < storedRows; i++) {
      const owner = owners[i];
      if (!last || last.block !== owner) {
        last = { block: owner, rows: 0, dependent: 0 };
        dependent.push(last);
      }
      if (outT[i + 1] !== 0 && support[support.length - 1] !== owner) support.push(owner);
      last.rows++;
      if (outT[i + 1] === 2) last.dependent++;
    }
    const implied = dependent.filter((d) => d.dependent > 0);
    const agreeing: Analysis["agreeing"] = [];
    if (opts.agreeing) {
      const t0 = performance.now();
      let trials = 0;
      const rowsOf = new Map<BlockHandle, number[]>();
      for (let i = 0; i < storedRows; i++) {
        const list = rowsOf.get(owners[i]);
        if (list) list.push(i); else rowsOf.set(owners[i], [i]);
      }
      // Whether `target`'s rows are all still implied with `without`'s rows
      // taken out of Jᵀ — its columns left empty, which the elimination reads
      // as non-pivots of their own and which cost the target nothing.
      const stillImplied = (target: BlockHandle, without: BlockHandle): boolean => {
        const gone = new Set(rowsOf.get(without) ?? []);
        const tc: number[] = [], tr: number[] = [], tv: number[] = [];
        for (let k = 0; k < stored; k++) {
          if (gone.has(jr[k])) continue;
          tc.push(jc[k]); tr.push(jr[k]); tv.push(jv[k]);
        }
        const out = null_support(new Uint32Array(tc), new Uint32Array(tr), new Float64Array(tv), n, storedRows, RANK_TOL);
        return (rowsOf.get(target) ?? []).every((i) => out[i + 1] === 2);
      };
      for (const d of implied) {
        if (d.dependent !== d.rows) continue;
        const candidates = support.filter((b) => b !== d.block);
        let needed: BlockHandle[] | null = [];
        for (const c of candidates) {
          if (trials >= AGREEING_TRIALS || performance.now() - t0 > AGREEING_MS) { needed = null; break; }
          trials++;
          if (!stillImplied(d.block, c)) needed.push(c);
        }
        agreeing.push({ block: d.block, with: needed === null || needed.length === 0 ? candidates : needed });
      }
    }
    return { rank, dof: n - rank, free, dependent: implied, agreeing };
  }
}
