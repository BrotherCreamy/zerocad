// The kernel's only public surface for "solve something": a flat variable
// vector plus a set of residual blocks. Nothing here knows what a point or
// a line is — geometry lives entirely above this file (see src/relations,
// src/tools). A residual block declares which global variable indices it
// reads and a function from Duals to Duals; evaluating it once with Dual
// arithmetic yields both its value and its exact (sparse) derivatives, which
// this file assembles into a sparse Jacobian and hands to the WASM kernel
// for the expensive part: one damped linear solve per Newton step.

import { Dual } from "./dual.ts";
import initWasm, { solve_step } from "./wasm-gen/neocad_kernel.js";

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

export interface SolveReport {
  solved: boolean;
  iterations: number;
  maxResidual: number;
  offenders: { label: string; residual: number }[];
}

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
  private blocks: ResidualBlock[] = [];

  addVar(initial: number): number {
    this.values.push(initial);
    return this.values.length - 1;
  }
  getVar(i: number): number { return this.values[i]; }
  setVar(i: number, v: number): void { this.values[i] = v; }
  get varCount(): number { return this.values.length; }

  addResidual(varIndices: VarRefs, fn: (locals: Dual[]) => Dual[], label?: string): void {
    this.blocks.push({ varIndices, fn, label });
  }

  clear(): void {
    this.values = [];
    this.blocks = [];
  }

  /** Evaluate all residual blocks at the current values, with full sparse Jacobian. */
  private evaluate(): { r: number[]; rows: number[]; cols: number[]; vals: number[]; labels: (string | undefined)[] } {
    const r: number[] = [];
    const rows: number[] = [];
    const cols: number[] = [];
    const vals: number[] = [];
    const labels: (string | undefined)[] = [];
    for (const block of this.blocks) {
      const varIndices = resolve(block.varIndices);
      const locals = varIndices.map((gi, li) => Dual.variable(this.values[gi], li));
      const outs = block.fn(locals);
      for (const out of outs) {
        const rowIdx = r.length;
        r.push(out.val);
        labels.push(block.label);
        for (const [localSlot, deriv] of out.grad) {
          if (deriv === 0) continue;
          rows.push(rowIdx);
          cols.push(varIndices[localSlot]);
          vals.push(deriv);
        }
      }
    }
    return { r, rows, cols, vals, labels };
  }

  /** Damped Gauss-Newton (Levenberg-Marquardt), warm-started from current values. */
  solve(opts: { maxIter?: number; tol?: number } = {}): SolveReport {
    const maxIter = opts.maxIter ?? 60;
    const tol = opts.tol ?? 1e-9;
    const n = this.values.length;

    let { r, rows, cols, vals, labels } = this.evaluate();
    let norm = norm2(r);
    if (n === 0 || r.length === 0) {
      return { solved: true, iterations: 0, maxResidual: 0, offenders: [] };
    }

    let lambda = 1e-3;
    let iterations = 0;
    for (; iterations < maxIter && norm > tol; iterations++) {
      let improved = false;
      for (let tries = 0; tries < 8 && !improved; tries++) {
        const dx = solve_step(
          new Uint32Array(rows), new Uint32Array(cols), new Float64Array(vals),
          new Float64Array(r), n, lambda,
        );
        const saved = this.values.slice();
        for (let i = 0; i < n; i++) this.values[i] += dx[i];
        const next = this.evaluate();
        const nextNorm = norm2(next.r);
        if (isFinite(nextNorm) && nextNorm < norm) {
          r = next.r; rows = next.rows; cols = next.cols; vals = next.vals; labels = next.labels;
          norm = nextNorm;
          lambda = Math.max(1e-10, lambda / 3);
          improved = true;
        } else {
          this.values = saved; // revert the trial step
          lambda *= 8;
        }
      }
      if (!improved) break;
    }

    const offenders: { label: string; residual: number }[] = [];
    const seen = new Map<string, number>();
    r.forEach((v, i) => {
      const mag = Math.abs(v);
      if (mag > 0.05) {
        const label = labels[i] ?? `r${i}`;
        seen.set(label, Math.max(seen.get(label) ?? 0, mag));
      }
    });
    for (const [label, residual] of seen) offenders.push({ label, residual });
    offenders.sort((a, b) => b.residual - a.residual);

    return { solved: offenders.length === 0, iterations, maxResidual: Math.max(0, ...r.map(Math.abs)), offenders };
  }
}
