//! NeoCAD numerical kernel.
//!
//! This crate is deliberately dumb about geometry: it knows "variables" and
//! "residuals" and nothing else. Points, lines, distances, robot joints —
//! all of that lives in TypeScript, which evaluates residuals using dual
//! numbers (forward-mode automatic differentiation) to get an exact sparse
//! Jacobian, then hands the triplets here for the expensive part: solving
//! the damped normal equations for one Levenberg-Marquardt step.
//!
//! The outer LM loop (try a step, accept/reject, adjust lambda, repeat)
//! lives in TypeScript too — this crate does one linear solve per call.

mod solver;
mod sparse;

use sparse::Triplets;
use wasm_bindgen::prelude::*;

/// One damped-least-squares step: solve (J^T J + lambda*(1+diag(J^T J))) dx = -J^T r.
///
/// `rows`/`cols`/`vals` are the sparse Jacobian in triplet (COO) form, shape m x n.
/// `r` is the residual vector, length m. `n` is the variable count (columns).
/// Returns dx, length n.
#[wasm_bindgen]
pub fn solve_step(
    rows: &[u32],
    cols: &[u32],
    vals: &[f64],
    r: &[f64],
    n: usize,
    lambda: f64,
) -> Vec<f64> {
    let j = Triplets { rows, cols, vals, m: r.len(), n };
    solver::solve_damped_step(&j, r, lambda, 200, 1e-10)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Solve a trivial diagonal system: J = I (2x2), r = [3, -4], lambda tiny.
    // (J^T J + lambda) dx = -J^T r  ~=  dx = -r  when lambda -> 0 and J = I.
    #[test]
    fn identity_system_recovers_negative_residual() {
        let rows = [0u32, 1u32];
        let cols = [0u32, 1u32];
        let vals = [1.0f64, 1.0f64];
        let r = [3.0f64, -4.0f64];
        let dx = solve_step(&rows, &cols, &vals, &r, 2, 1e-9);
        assert!((dx[0] - (-3.0)).abs() < 1e-6, "dx[0] = {}", dx[0]);
        assert!((dx[1] - 4.0).abs() < 1e-6, "dx[1] = {}", dx[1]);
    }

    // Overdetermined least squares: two residuals both depending on one variable x,
    // J = [[1],[1]], r = [x-2, x-4] at x=0 -> r=[-2,-4]. Normal equations: J^T J = 2,
    // -J^T r = 6, so dx = 3 -> the least-squares midpoint direction.
    #[test]
    fn overdetermined_least_squares_averages() {
        let rows = [0u32, 1u32];
        let cols = [0u32, 0u32];
        let vals = [1.0f64, 1.0f64];
        let r = [-2.0f64, -4.0f64];
        let dx = solve_step(&rows, &cols, &vals, &r, 1, 1e-9);
        assert!((dx[0] - 3.0).abs() < 1e-6, "dx[0] = {}", dx[0]);
    }

    // A genuinely sparse, decoupled system: two independent 1-variable residuals
    // should solve independently regardless of damping.
    #[test]
    fn decoupled_variables_solve_independently() {
        let rows = [0u32, 1u32];
        let cols = [0u32, 1u32];
        let vals = [2.0f64, 3.0f64]; // r0 = 2*x0 - 10 (say), r1 = 3*x1 - 9
        let r = [-10.0f64, -9.0f64];
        let dx = solve_step(&rows, &cols, &vals, &r, 2, 1e-9);
        // (2^2)*dx0 = -(2 * -10) = 20 -> dx0 = 5; (3^2)*dx1 = -(3*-9)=27 -> dx1=3
        assert!((dx[0] - 5.0).abs() < 1e-6, "dx[0] = {}", dx[0]);
        assert!((dx[1] - 3.0).abs() < 1e-6, "dx[1] = {}", dx[1]);
    }
}
