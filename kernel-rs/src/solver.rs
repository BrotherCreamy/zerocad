//! Matrix-free conjugate-gradient solve of the damped normal equations
//! (J^T J + lambda * diag(J^T J)) dx = -J^T r
//!
//! Never forms J^T J explicitly — CG only needs matvecs, and J is sparse and
//! usually has far fewer nonzeros than n^2, so this scales to large, sparse
//! constraint systems (the point of moving this off the JS main thread).

use crate::sparse::Triplets;

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

/// Applies (J^T J + lambda * diag) to v, matrix-free.
fn apply_damped_normal(j: &Triplets, diag: &[f64], lambda: f64, v: &[f64]) -> Vec<f64> {
    let jv = j.mul(v);
    let mut out = j.mul_t(&jv);
    for i in 0..out.len() {
        out[i] += lambda * (1.0 + diag[i]) * v[i];
    }
    out
}

/// Solves (J^T J + lambda*(1+diag)) dx = -J^T r via CG, starting from dx=0.
/// Returns dx (length n). `max_iter`/`tol` bound the CG inner loop; a sparse
/// least-squares system this size rarely needs more than n iterations, and
/// usually far fewer since J^T J is well-conditioned once damped.
pub fn solve_damped_step(j: &Triplets, r: &[f64], lambda: f64, max_iter: usize, tol: f64) -> Vec<f64> {
    let n = j.n;
    let diag = j.jtj_diag();
    let neg_jtr = {
        let mut v = j.mul_t(r);
        for x in v.iter_mut() {
            *x = -*x;
        }
        v
    };

    let mut x = vec![0.0; n];
    let mut res = neg_jtr.clone(); // residual b - A(x0), x0 = 0 so res = b
    let mut p = res.clone();
    let mut rs_old = dot(&res, &res);
    if rs_old.sqrt() < tol {
        return x;
    }

    let iters = max_iter.min(n.max(1)).max(1);
    for _ in 0..iters {
        let ap = apply_damped_normal(j, &diag, lambda, &p);
        let pap = dot(&p, &ap);
        if pap.abs() < 1e-300 {
            break;
        }
        let alpha = rs_old / pap;
        for i in 0..n {
            x[i] += alpha * p[i];
            res[i] -= alpha * ap[i];
        }
        let rs_new = dot(&res, &res);
        if rs_new.sqrt() < tol {
            break;
        }
        let beta = rs_new / rs_old;
        for i in 0..n {
            p[i] = res[i] + beta * p[i];
        }
        rs_old = rs_new;
    }
    x
}
