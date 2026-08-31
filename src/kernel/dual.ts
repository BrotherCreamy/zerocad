// Forward-mode automatic differentiation via dual numbers.
//
// A Dual carries a value plus a *sparse* gradient (Map from a local variable
// slot -> partial derivative). Arithmetic propagates both the value and the
// derivative simultaneously, so evaluating a residual once with Duals gives
// its exact value AND its exact (sparse) Jacobian row — no finite-difference
// perturbation, no extra residual evaluations.
//
// The gradient is keyed by *local* slot indices (0..k-1 for a residual that
// depends on k variables), not global variable indices — Problem.ts remaps
// local -> global when assembling the sparse Jacobian. This keeps a Dual
// cheap regardless of how many variables the whole model has.

export class Dual {
  val: number;
  grad: Map<number, number>;
  constructor(val: number, grad: Map<number, number> = new Map()) {
    this.val = val;
    this.grad = grad;
  }

  static constant(v: number): Dual {
    return new Dual(v);
  }

  // A Dual seeded as "variable at local slot i" — d(val)/d(slot i) = 1.
  static variable(v: number, slot: number): Dual {
    return new Dual(v, new Map([[slot, 1]]));
  }

  add(o: Dual | number): Dual {
    if (typeof o === "number") return new Dual(this.val + o, this.grad);
    const g = new Map(this.grad);
    for (const [slot, d] of o.grad) g.set(slot, (g.get(slot) ?? 0) + d);
    return new Dual(this.val + o.val, g);
  }

  sub(o: Dual | number): Dual {
    if (typeof o === "number") return new Dual(this.val - o, this.grad);
    const g = new Map(this.grad);
    for (const [slot, d] of o.grad) g.set(slot, (g.get(slot) ?? 0) - d);
    return new Dual(this.val - o.val, g);
  }

  neg(): Dual {
    const g = new Map<number, number>();
    for (const [slot, d] of this.grad) g.set(slot, -d);
    return new Dual(-this.val, g);
  }

  mul(o: Dual | number): Dual {
    if (typeof o === "number") {
      const g = new Map<number, number>();
      for (const [slot, d] of this.grad) g.set(slot, d * o);
      return new Dual(this.val * o, g);
    }
    // product rule: d(uv) = u dv + v du
    const g = new Map<number, number>();
    for (const [slot, d] of this.grad) g.set(slot, (g.get(slot) ?? 0) + o.val * d);
    for (const [slot, d] of o.grad) g.set(slot, (g.get(slot) ?? 0) + this.val * d);
    return new Dual(this.val * o.val, g);
  }

  div(o: Dual | number): Dual {
    if (typeof o === "number") return this.mul(1 / o);
    // quotient rule: d(u/v) = (v du - u dv) / v^2
    const inv2 = 1 / (o.val * o.val);
    const g = new Map<number, number>();
    for (const [slot, d] of this.grad) g.set(slot, (g.get(slot) ?? 0) + o.val * d * inv2);
    for (const [slot, d] of o.grad) g.set(slot, (g.get(slot) ?? 0) - this.val * d * inv2);
    return new Dual(this.val / o.val, g);
  }

  private chain(newVal: number, dOuter: number): Dual {
    const g = new Map<number, number>();
    for (const [slot, d] of this.grad) g.set(slot, dOuter * d);
    return new Dual(newVal, g);
  }

  sin(): Dual { return this.chain(Math.sin(this.val), Math.cos(this.val)); }
  cos(): Dual { return this.chain(Math.cos(this.val), -Math.sin(this.val)); }
  sqrt(): Dual { const s = Math.sqrt(this.val); return this.chain(s, s > 1e-12 ? 0.5 / s : 0); }
  abs(): Dual { return this.chain(Math.abs(this.val), this.val >= 0 ? 1 : -1); }
  square(): Dual { return this.mul(this); }

  // atan2(this, other) — this = y, other = x
  atan2(x: Dual): Dual {
    const y = this;
    const denom = x.val * x.val + y.val * y.val || 1e-300;
    const val = Math.atan2(y.val, x.val);
    const g = new Map<number, number>();
    for (const [slot, d] of y.grad) g.set(slot, (g.get(slot) ?? 0) + (x.val / denom) * d);
    for (const [slot, d] of x.grad) g.set(slot, (g.get(slot) ?? 0) - (y.val / denom) * d);
    return new Dual(val, g);
  }

  static hypot(a: Dual, b: Dual): Dual {
    return a.mul(a).add(b.mul(b)).sqrt();
  }
}

export const dsin = (a: Dual) => a.sin();
export const dcos = (a: Dual) => a.cos();
export const dsqrt = (a: Dual) => a.sqrt();
export const dhypot = Dual.hypot;
