//! Which columns of a Jacobian are *free* — and, asked of the transpose, which
//! rows are redundant — by a rank-revealing elimination.
//!
//! The solver only ever needs one damped step at a time, and the conjugate
//! gradient in solver.rs never learns the rank of anything. Diagnosis does:
//! "which variables can still move without disturbing any residual" is the
//! support of J's null space, and "which residuals say nothing the earlier
//! ones did not" is the set of rows that are combinations of earlier rows. Both
//! are one question asked of a matrix and of its transpose, so this file asks
//! it once and the caller transposes.
//!
//! Still nothing about geometry: columns are variables and rows residuals.
//!
//! **Dense, but per connected component.** Two variables are connected when a
//! row reads both; a sketch's rectangles that share nothing (frames are datums
//! and contribute no columns) are separate components, and each is eliminated
//! on its own. That keeps the dense cost to the largest component's
//! `rows × cols × rank`, not the whole drawing's.
//!
//! **Columns in order, pivot by row.** Gaussian elimination to reduced row
//! echelon form, taking columns left to right and the largest remaining entry
//! in each as its pivot. A column whose remaining part is below `tol` times its
//! own original norm is a *non-pivot*: a combination of the columns before it.
//! Taking columns in order is what gives "earlier" a meaning — asked of the
//! transpose, a non-pivot is a residual row that the rows before it already
//! imply, which is the one a user just added redundantly.

use crate::sparse::Triplets;

/// A pivot column no null vector moves: held.
pub const HELD: u8 = 0;
/// A pivot column some null vector still moves: free, though independent of the earlier ones.
pub const FREE_PIVOT: u8 = 1;
/// A combination of earlier columns (or an empty one): always in the null space's support.
pub const NON_PIVOT: u8 = 2;

fn find(parent: &mut [usize], mut x: usize) -> usize {
    while parent[x] != x {
        parent[x] = parent[parent[x]];
        x = parent[x];
    }
    x
}

/// The rank of `j`, and for each column whether it is held, a free pivot or a
/// non-pivot. `tol` is relative: to each column's own norm for the rank test,
/// and (times 100) for whether a pivot column takes part in a null vector.
pub fn null_support(j: &Triplets, tol: f64) -> (usize, Vec<u8>) {
    let (m, n) = (j.m, j.n);
    let mut flags = vec![NON_PIVOT; n];
    if n == 0 {
        return (0, flags);
    }
    // Union the columns each row reads.
    let mut parent: Vec<usize> = (0..n).collect();
    let mut row_first = vec![usize::MAX; m];
    let mut touched = vec![false; n];
    for k in 0..j.rows.len() {
        if j.vals[k] == 0.0 {
            continue;
        }
        let (r, c) = (j.rows[k] as usize, j.cols[k] as usize);
        touched[c] = true;
        if row_first[r] == usize::MAX {
            row_first[r] = c;
        } else {
            let (a, b) = (find(&mut parent, row_first[r]), find(&mut parent, c));
            if a != b {
                parent[a] = b;
            }
        }
    }
    // Components: their columns and rows, in ascending order, and each one's
    // local index.
    let mut comp_of_root = vec![usize::MAX; n];
    let mut comp_cols: Vec<Vec<usize>> = Vec::new();
    let mut local_col = vec![0usize; n];
    for c in 0..n {
        if !touched[c] {
            continue; // an empty column: a non-pivot of its own, rank nothing
        }
        let root = find(&mut parent, c);
        if comp_of_root[root] == usize::MAX {
            comp_of_root[root] = comp_cols.len();
            comp_cols.push(Vec::new());
        }
        let k = comp_of_root[root];
        local_col[c] = comp_cols[k].len();
        comp_cols[k].push(c);
    }
    let mut comp_rows: Vec<Vec<usize>> = vec![Vec::new(); comp_cols.len()];
    let mut local_row = vec![0usize; m];
    let mut comp_of_row = vec![usize::MAX; m];
    for r in 0..m {
        if row_first[r] == usize::MAX {
            continue; // an empty row reads nothing and adds no rank
        }
        let k = comp_of_root[find(&mut parent, row_first[r])];
        comp_of_row[r] = k;
        local_row[r] = comp_rows[k].len();
        comp_rows[k].push(r);
    }
    let mut dense: Vec<Vec<f64>> = comp_cols
        .iter()
        .zip(comp_rows.iter())
        .map(|(cs, rs)| vec![0.0; cs.len() * rs.len()])
        .collect();
    for k in 0..j.rows.len() {
        if j.vals[k] == 0.0 {
            continue;
        }
        let (r, c) = (j.rows[k] as usize, j.cols[k] as usize);
        let comp = comp_of_row[r];
        let nc = comp_cols[comp].len();
        dense[comp][local_row[r] * nc + local_col[c]] += j.vals[k];
    }

    let mut rank = 0;
    for (comp, a) in dense.iter_mut().enumerate() {
        let cols = &comp_cols[comp];
        let (mc, nc) = (comp_rows[comp].len(), cols.len());
        let norm: Vec<f64> = (0..nc)
            .map(|c| (0..mc).map(|r| a[r * nc + c] * a[r * nc + c]).sum::<f64>().sqrt())
            .collect();
        let mut pivot_col: Vec<usize> = Vec::new();
        let mut is_pivot = vec![false; nc];
        let mut r0 = 0;
        for c in 0..nc {
            if r0 == mc {
                break;
            }
            let (mut best, mut at) = (0.0f64, r0);
            for r in r0..mc {
                let v = a[r * nc + c].abs();
                if v > best {
                    best = v;
                    at = r;
                }
            }
            if !(norm[c] > 0.0) || best <= tol * norm[c] {
                continue;
            }
            if at != r0 {
                for x in 0..nc {
                    a.swap(at * nc + x, r0 * nc + x);
                }
            }
            let p = a[r0 * nc + c];
            for x in c..nc {
                a[r0 * nc + x] /= p;
            }
            for r in 0..mc {
                if r == r0 {
                    continue;
                }
                let f = a[r * nc + c];
                if f == 0.0 {
                    continue;
                }
                // Columns before `c` are already zero in row r0 (reduced form).
                for x in c..nc {
                    a[r * nc + x] -= f * a[r0 * nc + x];
                }
            }
            is_pivot[c] = true;
            pivot_col.push(c);
            r0 += 1;
        }
        rank += pivot_col.len();
        // A null vector per non-pivot f: 1 at f, minus row k's entry at the
        // pivot of row k. A pivot column is free when any of them reaches it by
        // more than rounding — measured as its share of f's own norm.
        for (k, &p) in pivot_col.iter().enumerate() {
            let free = (0..nc).any(|f| !is_pivot[f] && (a[k * nc + f] * norm[p]).abs() > 100.0 * tol * norm[f]);
            flags[cols[p]] = if free { FREE_PIVOT } else { HELD };
        }
    }
    (rank, flags)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(m: usize, n: usize, entries: &[(u32, u32, f64)]) -> (usize, Vec<u8>) {
        let rows: Vec<u32> = entries.iter().map(|e| e.0).collect();
        let cols: Vec<u32> = entries.iter().map(|e| e.1).collect();
        let vals: Vec<f64> = entries.iter().map(|e| e.2).collect();
        null_support(&Triplets { rows: &rows, cols: &cols, vals: &vals, m, n }, 1e-9)
    }

    #[test]
    fn identity_holds_everything() {
        let (rank, flags) = run(2, 2, &[(0, 0, 1.0), (1, 1, 3.0)]);
        assert_eq!(rank, 2);
        assert_eq!(flags, vec![HELD, HELD]);
    }

    #[test]
    fn an_untouched_column_is_free() {
        let (rank, flags) = run(1, 3, &[(0, 0, 2.0)]);
        assert_eq!(rank, 1);
        assert_eq!(flags, vec![HELD, NON_PIVOT, NON_PIVOT]);
    }

    // x0 - x1 = 0 alone: the pair moves together, so both are free, the
    // second as the non-pivot and the first as the pivot it reaches.
    #[test]
    fn a_difference_leaves_both_free() {
        let (rank, flags) = run(1, 2, &[(0, 0, 1.0), (0, 1, -1.0)]);
        assert_eq!(rank, 1);
        assert_eq!(flags, vec![FREE_PIVOT, NON_PIVOT]);
    }

    // x0 = c, x1 - x0 = 0, and x2 read by nothing: x0 and x1 held.
    #[test]
    fn a_chain_held_at_one_end_is_held() {
        let (rank, flags) = run(3, 3, &[(0, 0, 1.0), (1, 1, 1.0), (1, 0, -1.0), (2, 2, 0.0)]);
        assert_eq!(rank, 2);
        assert_eq!(flags, vec![HELD, HELD, NON_PIVOT]);
    }

    // Asked of the transpose: three rows over two variables, the third the
    // sum of the first two — the third is the non-pivot, the redundant one.
    #[test]
    fn the_later_of_two_dependent_rows_is_the_redundant_one() {
        // J = [[1,0],[0,1],[1,1]]; J^T = [[1,0,1],[0,1,1]] — 2 x 3.
        let (rank, flags) = run(2, 3, &[(0, 0, 1.0), (0, 2, 1.0), (1, 1, 1.0), (1, 2, 1.0)]);
        assert_eq!(rank, 2);
        assert_eq!(flags[2], NON_PIVOT);
        assert_eq!(flags[0], FREE_PIVOT);
        assert_eq!(flags[1], FREE_PIVOT);
    }

    // Scale must not matter: a column a million times larger than its
    // neighbour is still independent, and a tiny rounding remainder is not.
    #[test]
    fn rank_is_relative_to_each_column() {
        let (rank, flags) = run(2, 2, &[(0, 0, 1e6), (1, 1, 1e-6)]);
        assert_eq!(rank, 2);
        assert_eq!(flags, vec![HELD, HELD]);
        let (rank, _) = run(2, 2, &[(0, 0, 1.0), (0, 1, 1.0), (1, 0, 1.0), (1, 1, 1.0 + 1e-14)]);
        assert_eq!(rank, 1);
    }

    // Two components, one held and one not, analysed apart.
    #[test]
    fn components_are_independent() {
        let (rank, flags) = run(3, 4, &[(0, 0, 1.0), (1, 1, 1.0), (2, 2, 1.0), (2, 3, 1.0)]);
        assert_eq!(rank, 3);
        assert_eq!(flags, vec![HELD, HELD, FREE_PIVOT, NON_PIVOT]);
    }

    // Duplicate triplets for one entry are summed, as a sparse matrix would.
    #[test]
    fn duplicate_entries_add() {
        let (rank, flags) = run(1, 1, &[(0, 0, 1.0), (0, 0, -1.0)]);
        assert_eq!(rank, 0);
        assert_eq!(flags, vec![NON_PIVOT]);
    }
}
