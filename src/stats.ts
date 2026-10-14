// The statistics, written out by hand so every number in the write-up can be traced to a few lines here.

import { rng } from './rng.ts';

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/**
 * Cohen's kappa: agreement between two raters, corrected for the agreement you'd get by chance from how
 * often each rater uses each label. 1 = perfect, 0 = no better than chance, below 0 = worse than chance.
 */
export function cohenKappa<T>(a: T[], b: T[]): number {
  if (a.length !== b.length) throw new Error('kappa needs two lists of the same length');
  const n = a.length;
  if (n === 0) return NaN;
  const cats = [...new Set([...a, ...b])];
  const observed = a.filter((x, i) => x === b[i]).length / n;
  const expected = cats.reduce((s, c) => s + (a.filter((x) => x === c).length / n) * (b.filter((x) => x === c).length / n), 0);
  if (expected === 1) return observed === 1 ? 1 : NaN; // both raters used one label only: kappa is undefined
  return (observed - expected) / (1 - expected);
}

export type Interval = { est: number; lo: number; hi: number; n: number };

/** The p-th quantile (0-1) of sorted numbers, with linear interpolation. */
export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * Percentile bootstrap: resample the units (pairs) with replacement, recompute the statistic, and take
 * the middle 95% of the results. `stat` gets a list of unit indices (with repeats) and returns a number,
 * or NaN when the resample can't support it (e.g. no decisive pairs); those draws are skipped.
 * Seeded, so the same data always gives the same interval.
 */
export function bootstrap(n: number, stat: (idx: number[]) => number, opts: { reps?: number; seed?: string; level?: number } = {}): Interval {
  const reps = opts.reps ?? 2000;
  const level = opts.level ?? 0.95;
  const all = Array.from({ length: n }, (_, i) => i);
  const est = stat(all);
  if (n === 0 || Number.isNaN(est)) return { est, lo: NaN, hi: NaN, n };
  const r = rng(opts.seed ?? 'bootstrap');
  const draws: number[] = [];
  for (let k = 0; k < reps; k++) {
    const idx = Array.from({ length: n }, () => Math.floor(r() * n));
    const v = stat(idx);
    if (!Number.isNaN(v)) draws.push(v);
  }
  draws.sort((x, y) => x - y);
  return { est, lo: quantile(draws, (1 - level) / 2), hi: quantile(draws, 1 - (1 - level) / 2), n };
}

/** Two-sided exact binomial test against p = 0.5 (used for "does this judge pick the first answer more than half the time?"). */
export function binomialP(k: number, n: number): number {
  if (n === 0) return NaN;
  // log-space to stay accurate for n in the thousands
  const lgamma = (x: number): number => {
    // Lanczos approximation
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  };
  const logPmf = (i: number) => lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) - n * Math.log(2);
  const pk = logPmf(k);
  let p = 0;
  for (let i = 0; i <= n; i++) {
    const li = logPmf(i);
    if (li <= pk + 1e-9) p += Math.exp(li);
  }
  return Math.min(1, p);
}

export const round = (x: number, dp = 3) => (Number.isFinite(x) ? Math.round(x * 10 ** dp) / 10 ** dp : x);
