import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyse } from '../src/analyse.ts';
import type { Cell } from '../src/analyse.ts';
import { buildPairs, loadItems, matchups } from '../src/data.ts';
import { FORMATS, pairPrompt, parseScore, parseVerdict, scorePrompt, unshow } from '../src/judge.ts';
import { PLANTED, fakeItems, simulate } from '../src/simulate.ts';
import { binomialP, bootstrap, cohenKappa, mean, quantile } from '../src/stats.ts';

test("Cohen's kappa matches a worked example", () => {
  // 50 items, 2 labels. Agree on 20 yes + 15 no = 0.7 observed. Rater 1 says yes 25 times, rater 2 30 times.
  // Chance agreement = 0.5*0.6 + 0.5*0.4 = 0.5, so kappa = (0.7 - 0.5) / 0.5 = 0.4
  const a = [...Array(20).fill('y'), ...Array(5).fill('y'), ...Array(10).fill('n'), ...Array(15).fill('n')];
  const b = [...Array(20).fill('y'), ...Array(5).fill('n'), ...Array(10).fill('y'), ...Array(15).fill('n')];
  assert.ok(Math.abs(cohenKappa(a, b) - 0.4) < 1e-12);
  assert.equal(cohenKappa(['A', 'B', 'TIE'], ['A', 'B', 'TIE']), 1);
});

test('binomial test and quantiles', () => {
  assert.ok(Math.abs(binomialP(9, 10) - 0.021484375) < 1e-9); // 2 * (10 + 1) / 1024
  assert.ok(Math.abs(binomialP(5, 10) - 1) < 1e-9);
  assert.ok(binomialP(600, 1000) < 1e-9);
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5);
});

test('bootstrap is seeded and brackets the estimate', () => {
  const xs = Array.from({ length: 200 }, (_, i) => (i % 4 === 0 ? 1 : 0));
  const stat = (idx: number[]) => mean(idx.map((i) => xs[i]));
  const a = bootstrap(xs.length, stat, { seed: 's' });
  const b = bootstrap(xs.length, stat, { seed: 's' });
  assert.deepEqual(a, b);
  assert.equal(a.est, 0.25);
  assert.ok(a.lo < 0.25 && a.hi > 0.25 && a.hi - a.lo < 0.15);
});

test('verdicts are read from the shapes judges actually write', () => {
  assert.equal(parseVerdict('plain', 'A'), 'A');
  assert.equal(parseVerdict('plain', '**B**'), 'B');
  assert.equal(parseVerdict('plain', 'TIE.'), 'TIE');
  assert.equal(parseVerdict('plain', 'Response B'), 'B');
  assert.equal(parseVerdict('plain', 'Both are fine, but I lean towards... Verdict: A'), 'A');
  assert.equal(parseVerdict('plain', 'Apples'), null); // "A" followed by more letters isn't a verdict
  assert.equal(parseVerdict('rubric', 'A is clearer.\nVerdict: B'), 'B');
  assert.equal(parseVerdict('rubric', 'Draft verdict: A\n...on reflection\n**Verdict:** TIE'), 'TIE');
  assert.equal(parseVerdict('rubric', 'Verdict - Response A'), 'A');
  assert.equal(parseVerdict('rubric', 'I prefer A.'), null);
  assert.equal(parseScore('Solid.\nScore: 7'), 7);
  assert.equal(parseScore('Score: 6/10 ... revised Score: **8**'), 8);
  assert.equal(parseScore('Score: 11'), null);
  assert.equal(parseScore('Seven out of ten'), null);
});

test('shown order maps back to canonical A/B', () => {
  assert.equal(unshow('A', 'ab'), 'A');
  assert.equal(unshow('A', 'ba'), 'B');
  assert.equal(unshow('B', 'ba'), 'A');
  assert.equal(unshow('TIE', 'ba'), 'TIE');
});

test('judge prompts never leak the reference or which model wrote what', () => {
  const [item] = loadItems();
  for (const r of [pairPrompt('plain', item, 'first', 'second'), pairPrompt('rubric', item, 'first', 'second'), scorePrompt(item, 'x')]) {
    assert.ok(!r.user.includes(item.reference));
    assert.ok(!/opus|sonnet|haiku|claude/i.test(r.user + r.system));
  }
  const p = pairPrompt('plain', item, 'FIRST', 'SECOND').user;
  assert.ok(p.indexOf('FIRST') < p.indexOf('SECOND'));
});

test('pair design: 120 items, every matchup 40 times, stable between runs', () => {
  const items = loadItems();
  assert.equal(items.length, 120);
  const models = ['opus', 'sonnet', 'haiku'];
  const pairs = buildPairs(items, models);
  for (const [x, y] of matchups(models)) assert.equal(pairs.filter((p) => p.authors.includes(x) && p.authors.includes(y)).length, 40);
  assert.deepEqual(buildPairs(items, models), pairs);
  // four models: six matchups, 20 each
  const four = buildPairs(items, [...models, 'gpt-x']);
  for (const [x, y] of matchups([...models, 'gpt-x'])) assert.equal(four.filter((p) => p.authors.includes(x) && p.authors.includes(y)).length, 20);
});

test('a hand-built case gives exactly the expected numbers', () => {
  const pairs = buildPairs(fakeItems(3), ['x', 'y', 'z']);
  const cells: Cell[] = [];
  // judge 'x' always picks whatever is shown first
  for (const p of pairs)
    for (const order of ['ab', 'ba'] as const) cells.push({ kind: 'pair', judge: 'x', format: 'plain', variant: 'orig', pair: p.id, order, shown: 'A', verdict: unshow('A', order) });
  const r = analyse({ pairs, cells, judges: ['x'], formats: ['plain'], labels: { labels: Object.fromEntries(pairs.map((p) => [p.id, 'A'])) } });
  const j = r.judges[0];
  assert.equal(j.position!.firstRate.est, 1);
  assert.equal(j.position!.consistent.est, 0);
  assert.equal(j.position!.flips, 1);
  assert.equal(j.agreement!.accuracy.est, 0); // order-dependent verdicts become ties, and ties never match a called pair
});

test('the analysis finds planted biases, and not ones that were never planted', () => {
  const sim = simulate({ ...PLANTED, n: 120, seed: 'unit' });
  const r = analyse({ ...sim, judges: Object.keys(PLANTED.judges), formats: FORMATS, seed: 'unit', reps: 1000 });
  const get = (judge: string, format: string) => r.judges.find((j) => j.judge === judge && j.format === format)!;

  // position: haiku strong, opus none; pointwise has no position result at all
  assert.ok(get('haiku', 'plain').position!.firstRate.lo > 0.6);
  assert.ok(Math.abs(get('opus', 'plain').position!.firstRate.est - 0.5) < 0.05);
  assert.equal(get('haiku', 'score').position, null);
  // length: planted for sonnet and haiku, not opus
  assert.ok(get('haiku', 'plain').verbosity!.lo > 0);
  assert.ok(get('sonnet', 'plain').verbosity!.lo > 0);
  assert.ok(Math.abs(get('opus', 'plain').verbosity!.est) < 0.1);
  // self-preference: planted for sonnet only
  assert.ok(get('sonnet', 'plain').selfPreference!.bias.lo > 0);
  // (none planted: the estimate sits near 0; an interval can still miss 0 by chance about 1 time in 20)
  assert.ok(Math.abs(get('opus', 'plain').selfPreference!.bias.est) < 0.12);
  assert.ok(Math.abs(get('haiku', 'plain').selfPreference!.bias.est) < 0.12);
  // the clean, sharp judge agrees with the human most
  assert.ok(get('opus', 'plain').agreement!.accuracy.est > get('haiku', 'plain').agreement!.accuracy.est);
  assert.ok(r.human!.repeat!.kappa > 0.5);
});
