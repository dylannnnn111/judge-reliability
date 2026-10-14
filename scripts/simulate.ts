// Fake judges with known, planted biases, run through the real analysis. No API calls.
//   npm run simulate            one run at 120 pairs: does the analysis find what was planted?
//   POWER=1 npm run simulate    many runs at 120 and 200 pairs: how often is each planted bias detected?
// Planted (see src/simulate.ts): opus judge clean; sonnet judge mild position, length and self-preference;
// haiku judge strong position and length bias, no self-preference.

import { analyse } from '../src/analyse.ts';
import type { JudgeResult } from '../src/analyse.ts';
import { FORMATS } from '../src/judge.ts';
import { PLANTED, simulate } from '../src/simulate.ts';
import type { Interval } from '../src/stats.ts';

const judges = Object.keys(PLANTED.judges);
const fmt = (x: Interval | null | undefined) => (x ? `${x.est.toFixed(2)} [${x.lo.toFixed(2)}, ${x.hi.toFixed(2)}]` : '-');

function once(n: number, seed: string, reps = 2000) {
  const s = simulate({ ...PLANTED, n, seed });
  return analyse({ ...s, judges, formats: FORMATS, seed, reps });
}

if (!process.env.POWER) {
  const res = once(120, 'sim-main');
  console.log('Planted biases:', JSON.stringify(PLANTED.judges), '\n');
  console.log('judge   format  picks-first        accuracy           swing-to-padded     self-bias');
  for (const j of res.judges) {
    console.log(
      `${j.judge.padEnd(7)} ${j.format.padEnd(7)} ${fmt(j.position?.firstRate).padEnd(18)} ${fmt(j.agreement?.accuracy).padEnd(18)} ${fmt(j.verbosity).padEnd(19)} ${fmt(j.selfPreference?.bias)}`,
    );
  }
  console.log(`\nHuman repeat agreement: ${res.human?.repeat?.agree.toFixed(2)}, kappa ${res.human?.repeat?.kappa.toFixed(2)}`);
} else {
  const SIMS = Number(process.env.SIMS ?? 40);
  // What counts as "detected": the 95% interval excludes the no-bias value
  const checks: { name: string; get: (r: JudgeResult[]) => Interval | null | undefined; none: number }[] = [
    { name: 'sonnet position (plain), planted mild', get: (r) => r.find((j) => j.judge === 'sonnet' && j.format === 'plain')?.position?.firstRate, none: 0.5 },
    { name: 'haiku position (plain), planted strong', get: (r) => r.find((j) => j.judge === 'haiku' && j.format === 'plain')?.position?.firstRate, none: 0.5 },
    { name: 'sonnet length (plain), planted mild', get: (r) => r.find((j) => j.judge === 'sonnet' && j.format === 'plain')?.verbosity, none: 0 },
    { name: 'sonnet self-pref (plain), planted mild', get: (r) => r.find((j) => j.judge === 'sonnet' && j.format === 'plain')?.selfPreference?.bias, none: 0 },
    { name: 'opus position (plain), none planted', get: (r) => r.find((j) => j.judge === 'opus' && j.format === 'plain')?.position?.firstRate, none: 0.5 },
    { name: 'opus self-pref (plain), none planted', get: (r) => r.find((j) => j.judge === 'opus' && j.format === 'plain')?.selfPreference?.bias, none: 0 },
    { name: 'opus accuracy (plain) - interval width', get: (r) => r.find((j) => j.judge === 'opus' && j.format === 'plain')?.agreement?.accuracy, none: NaN },
  ];
  for (const n of [120, 200]) {
    const runs = Array.from({ length: SIMS }, (_, k) => once(n, `power-${n}-${k}`, 500).judges);
    console.log(`\n${n} pairs, ${SIMS} simulated studies:`);
    for (const c of checks) {
      const iv = runs.map((r) => c.get(r)).filter((x): x is Interval => !!x);
      const width = iv.reduce((s, x) => s + (x.hi - x.lo), 0) / iv.length;
      const hit = Number.isNaN(c.none) ? '' : `detected in ${Math.round((100 * iv.filter((x) => x.lo > c.none || x.hi < c.none).length) / iv.length)}%`;
      console.log(`  ${c.name.padEnd(42)} avg interval width ${width.toFixed(3)}  ${hit}`);
    }
  }
}
