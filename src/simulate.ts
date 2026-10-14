// Made-up judges with biases we choose, run through the real analysis. Two uses:
//  1. Tests: plant a bias, check the analysis finds it (and finds nothing where nothing was planted).
//  2. Power: how big a bias can 120 pairs detect, and would 200 be worth the extra labelling?
// Nothing here touches an API or ends up in the write-up as a finding.

import type { Cell, Labels, Order, Variant } from './analyse.ts';
import type { Item, Pair } from './data.ts';
import { TASK_TYPES, buildPairs } from './data.ts';
import type { Verdict } from './judge.ts';
import { rng } from './rng.ts';

export type FakeJudge = {
  noise: number; // how blurry its view of quality is (sd, in quality units)
  position: number; // added to whichever answer it sees first
  length: number; // added to a padded answer
  self: number; // added to its own model's answer
};

export type SimConfig = {
  n: number; // pairs
  models: string[];
  skill: Record<string, number>; // average answer quality per model
  judges: Record<string, FakeJudge>; // keys must be model names for self-preference to apply
  humanNoise?: number; // sd of the labeller's own noise
  tieBand?: number; // |difference| below this is a tie, for human and judges alike
  seed?: string;
};

const gauss = (r: () => number) => {
  const u = 1 - r();
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Fake items so the pair design (matchups, sides) is exactly the real one, at any size. */
export function fakeItems(n: number): Item[] {
  const per = Math.ceil(n / 3);
  return TASK_TYPES.flatMap((task) =>
    Array.from({ length: per }, (_, i) => ({ id: `${task}-${String(i + 1).padStart(3, '0')}`, task, topic: 'sim', input: '', reference: '' })),
  ).slice(0, n);
}

export function simulate(cfg: SimConfig): { pairs: Pair[]; cells: Cell[]; labels: Labels } {
  const r = rng(cfg.seed ?? 'sim');
  const tie = cfg.tieBand ?? 0.35;
  const pairs = buildPairs(fakeItems(cfg.n), cfg.models);
  const call = (d: number): Verdict => (d > tie ? 'A' : d < -tie ? 'B' : 'TIE');
  const labels: Labels = { labels: {}, repeats: {} };
  const cells: Cell[] = [];

  for (const p of pairs) {
    // true quality of each answer
    const q = { A: cfg.skill[p.authors[0]] + gauss(r), B: cfg.skill[p.authors[1]] + gauss(r) };
    const hn = cfg.humanNoise ?? 0.3;
    labels.labels[p.id] = call(q.A - q.B + hn * gauss(r));
    labels.repeats![p.id] = call(q.A - q.B + hn * gauss(r));

    for (const [judge, j] of Object.entries(cfg.judges)) {
      const own = (side: 'A' | 'B') => (p.authors[side === 'A' ? 0 : 1] === judge ? j.self : 0);
      for (const variant of ['orig', 'pad'] as Variant[]) {
        const pad = (side: 'A' | 'B') => (variant === 'pad' && side === p.padSide ? j.length : 0);
        const seen = { A: q.A + own('A') + pad('A'), B: q.B + own('B') + pad('B') };
        for (const format of ['plain', 'rubric'] as const) {
          for (const order of ['ab', 'ba'] as Order[]) {
            const firstIsA = order === 'ab';
            const d = seen.A - seen.B + (firstIsA ? j.position : -j.position) + j.noise * gauss(r);
            const verdict = call(d);
            const shown: Verdict = verdict === 'TIE' ? 'TIE' : firstIsA ? verdict : verdict === 'A' ? 'B' : 'A';
            cells.push({ kind: 'pair', judge, format, variant, pair: p.id, order, verdict, shown });
          }
        }
        // pointwise: scores on a 1-10 scale, rounded, so close answers often tie
        const sides: ('A' | 'B')[] = variant === 'orig' ? ['A', 'B'] : [p.padSide];
        for (const side of sides) {
          const s = Math.round(Math.min(10, Math.max(1, 6 + 1.2 * (seen[side] + j.noise * gauss(r) * 0.7))));
          cells.push({ kind: 'score', judge, variant, pair: p.id, side, score: s });
        }
      }
    }
  }
  return { pairs, cells, labels };
}

/** The setup the script and tests use: three models, three judges with very different planted biases. */
export const PLANTED: Omit<SimConfig, 'n'> = {
  models: ['opus', 'sonnet', 'haiku'],
  skill: { opus: 0.5, sonnet: 0.3, haiku: 0 },
  judges: {
    opus: { noise: 0.3, position: 0, length: 0, self: 0 }, // the clean control
    sonnet: { noise: 0.5, position: 0.3, length: 0.3, self: 0.4 },
    haiku: { noise: 0.8, position: 0.7, length: 0.6, self: 0 },
  },
};
