//! Minimal sparse matrix support: triplets in, CSR-ish storage, matrix-free
//! matvecs. No CAD knowledge lives here — just linear algebra over an m x n
//! matrix built from (row, col, value) triplets.

pub struct Triplets<'a> {
    pub rows: &'a [u32],
    pub cols: &'a [u32],
    pub vals: &'a [f64],
    pub m: usize, // residual count (rows)
    pub n: usize, // variable count (cols)
}

impl<'a> Triplets<'a> {
    /// y = J * x   (length m)
    pub fn mul(&self, x: &[f64]) -> Vec<f64> {
        let mut y = vec![0.0; self.m];
        for k in 0..self.rows.len() {
            let r = self.rows[k] as usize;
            let c = self.cols[k] as usize;
            y[r] += self.vals[k] * x[c];
        }
        y
    }

    /// y = J^T * x   (length n)
    pub fn mul_t(&self, x: &[f64]) -> Vec<f64> {
        let mut y = vec![0.0; self.n];
        for k in 0..self.rows.len() {
            let r = self.rows[k] as usize;
            let c = self.cols[k] as usize;
            y[c] += self.vals[k] * x[r];
        }
        y
    }

    /// diagonal of J^T J, length n — used for Levenberg-Marquardt damping
    pub fn jtj_diag(&self) -> Vec<f64> {
        let mut d = vec![0.0; self.n];
        for k in 0..self.rows.len() {
            let c = self.cols[k] as usize;
            d[c] += self.vals[k] * self.vals[k];
        }
        d
    }
}
