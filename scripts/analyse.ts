// Step 5: the numbers. Reads everything in runs/<NAME>/ and writes results.json and results.md there.
// Works on a partial run (no labels yet -> no agreement numbers). No API key needed.
//   npm run analyse
// For the main run, once every pair is labelled, it also copies results.json to the repo root for the website.

import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JudgeResult, Results } from '../src/analyse.ts';
import { analyse } from '../src/analyse.ts';
import { TASK_TYPES, buildPairs, loadItems } from '../src/data.ts';
import type { Format } from '../src/judge.ts';
import { FORMATS } from '../src/judge.ts';
import type { Interval } from '../src/stats.ts';
import { round } from '../src/stats.ts';
import { MODELS, NAME, RUN, list, readJson, writeJson } from './common.ts';
import { loadCells, loadLabels, loadTexts, spend } from './load.ts';
import { writeFileSync } from 'node:fs';

const JUDGES = list(process.env.JUDGES, MODELS.join(','));
const pairs = buildPairs(loadItems(), MODELS);
const cells = loadCells();
const labels = loadLabels();
const formats = FORMATS.filter((f) => cells.some((c) => (f === 'score' ? c.kind === 'score' : c.kind === 'pair' && c.format === f))) as Format[];
const results: Results = analyse({ pairs, cells, judges: JUDGES, formats, labels });
const manifest = readJson<{ created: string; models: Record<string, string> }>(join(RUN, 'manifest.json'), { created: '', models: {} });
const texts = loadTexts(pairs);
const ratios = [...texts.values()].map((t) => t.ratio).filter((r): r is number => r !== null);
const cost = spend();
const padChecks = Object.values(labels.padChecks ?? {});

const ri = (x: Interval | null | undefined) => (x ? { est: round(x.est), lo: round(x.lo), hi: round(x.hi), n: x.n } : null);
const out = {
  study: 'Who Judges the Judge',
  run: NAME,
  date: manifest.created,
  models: manifest.models,
  judges: JUDGES,
  formats,
  pairs: results.pairs,
  labelled: results.labelled,
  judgeCalls: cells.length,
  invalidReplies: cells.filter((c) => (c.kind === 'pair' ? c.verdict === null : c.score === null)).length,
  padding: {
    pairs: ratios.length,
    medianRatio: ratios.length ? round([...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)], 2) : null,
    spotChecked: padChecks.length,
    addedContent: padChecks.filter((x) => x === 'adds').length,
  },
  costUsd: Object.fromEntries(Object.entries(cost).map(([k, v]) => [k, round(v, 2)])),
  totalCostUsd: round(Object.values(cost).reduce((a, b) => a + b, 0), 2),
  human: results.human && {
    split: results.human.split,
    repeat: results.human.repeat && { n: results.human.repeat.n, agree: round(results.human.repeat.agree), kappa: round(results.human.repeat.kappa) },
  },
  results: results.judges.map((j) => ({
    judge: j.judge,
    model: manifest.models[j.judge] ?? j.judge,
    format: j.format,
    valid: round(j.valid),
    position: j.position && { firstRate: ri(j.position.firstRate), p: round(j.position.p, 4), consistent: ri(j.position.consistent), sameOrder: ri(j.position.sameOrder), flips: round(j.position.flips) },
    agreement: j.agreement && {
      kappa: ri(j.agreement.kappa),
      accuracy: ri(j.agreement.accuracy),
      byTask: Object.fromEntries(TASK_TYPES.map((t) => [t, ri(j.agreement!.byTask[t])])),
      called: j.agreement.called,
      calledByTask: j.agreement.calledByTask,
    },
    calls: j.calls,
    humanTies: j.humanTies && { n: j.humanTies.n, judgeTie: round(j.humanTies.judgeTie) },
    verbosity: ri(j.verbosity),
    selfPreference: j.selfPreference && {
      bias: ri(j.selfPreference.bias),
      pickOwnWhenWorse: {
        own: round(j.selfPreference.pickOwnWhenWorse.own),
        others: round(j.selfPreference.pickOwnWhenWorse.others),
        n: j.selfPreference.pickOwnWhenWorse.n,
      },
    },
  })),
  crossAgreement: results.crossAgreement.map((x) => ({ ...x, same: round(x.same) })),
};
writeJson(join(RUN, 'results.json'), out);

// ---------- markdown ----------
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-');
const num = (x: number, dp = 2) => (Number.isFinite(x) ? x.toFixed(dp) : '-');
const ci = (x: Interval | null | undefined, f: (v: number) => string) => (x && Number.isFinite(x.est) ? `${f(x.est)} [${f(x.lo)}, ${f(x.hi)}]` : '-');
const signed = (v: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(2) : '-');
const row = (cols: string[]) => `| ${cols.join(' | ')} |`;
const table = (head: string[], rows: string[][]) => [row(head), row(head.map(() => '---')), ...rows.map(row)].join('\n');
const name = (j: JudgeResult) => [j.judge, j.format];

const md: string[] = [`# Who Judges the Judge - results (${NAME})`, ''];
md.push(
  `${results.pairs} pairs, ${results.labelled} labelled by hand, ${cells.length} judge calls (${out.invalidReplies} unreadable). ` +
    `Spent $${out.totalCostUsd} (answers $${out.costUsd.answers}, padding $${out.costUsd.padding}, judging $${out.costUsd.judging}).`,
  '',
  `Models: ${Object.entries(manifest.models).map(([a, id]) => `${a} = ${id}`).join(', ')}. 95% bootstrap intervals over pairs in brackets.`,
  '',
);
if (results.human) {
  const s = results.human.split;
  md.push(`**Human labels:** A ${s.A}, B ${s.B}, tie ${s.TIE}.`);
  if (results.human.repeat) md.push(` Re-labelled ${results.human.repeat.n} pairs blind: same call ${pct(results.human.repeat.agree)} of the time, kappa ${num(results.human.repeat.kappa)}. That's the ceiling for any judge.`);
  md.push('');
}
md.push('## Agreement with the human labels', '', 'Accuracy = share of pairs the human called where the judge made the same call (judge ties and order-dependent verdicts count as misses).', '');
md.push(table(['Judge', 'Format', 'Readable', 'Accuracy', 'Kappa', ...TASK_TYPES.map((t) => `Acc ${t}`)], results.judges.filter((j) => j.agreement).map((j) => [...name(j), pct(j.valid), ci(j.agreement!.accuracy, pct), ci(j.agreement!.kappa, num), ...TASK_TYPES.map((t) => ci(j.agreement!.byTask[t], pct))])));
md.push('', `Accuracy is over the pairs the human called one way or the other (${results.judges.find((j) => j.agreement)?.agreement?.called ?? '-'} of ${results.pairs}).`, '');
md.push('## Ties', '', 'Final verdicts on the original pairs (a split decision across the two orders counts as a tie), and on the pairs the human called about the same, how often the judge did too.', '');
md.push(table(['Judge', 'Format', 'A', 'B', 'Tie', 'Ties on human ties'], results.judges.map((j) => [...name(j), String(j.calls.A), String(j.calls.B), String(j.calls.TIE), j.humanTies ? `${pct(j.humanTies.judgeTie)} of ${j.humanTies.n}` : '-'])));
md.push('', '## Judges vs each other', '', 'Share of pairs where two judge setups give the same final verdict.', '');
md.push(table(['Setup', 'Setup', 'Same', 'n'], results.crossAgreement.map((x) => [x.a, x.b, pct(x.same), String(x.n)])));
md.push('', '## Position bias', '', 'Picks first = share of decisive verdicts that went to whichever answer was shown first (fair = 50%). Same both ways = share of pairs with the same verdict after swapping the order. Same, asked again = share with the same verdict when asked again in the same order - the models do not take a temperature, so this is how much changes by chance alone; the gap between the two is the order effect.', '');
md.push(table(['Judge', 'Format', 'Picks first', 'p', 'Same both ways', 'Same, asked again', 'Flips'], results.judges.filter((j) => j.position).map((j) => [...name(j), ci(j.position!.firstRate, pct), j.position!.p < 0.001 ? '<0.001' : num(j.position!.p, 3), ci(j.position!.consistent, pct), ci(j.position!.sameOrder, pct), pct(j.position!.flips)])));
md.push('', '## Length bias', '', `One answer per pair padded to about twice the length with nothing new in it (median ${out.padding.medianRatio ?? '-'}x; ${out.padding.addedContent} of ${out.padding.spotChecked} spot-checked added content). Swing = change in preference towards the padded answer on a -2 to +2 scale (0 = no effect).`, '');
md.push(table(['Judge', 'Format', 'Swing to padded'], results.judges.filter((j) => j.verbosity).map((j) => [...name(j), ci(j.verbosity, signed)])));
md.push('', '## Self-preference', '', 'Bias = how much more the judge favours its own model\'s answers than neutral judges (whose model wrote neither answer) do on the same pairs (-2 to +2, 0 = none). Picks own when worse = on pairs where the human preferred the other answer, how often the judge still picked its own, vs how often neutral judges picked that same answer.', '');
md.push(table(['Judge', 'Format', 'Bias', 'Picks own when worse', 'Neutral judges pick it', 'n'], results.judges.filter((j) => j.selfPreference).map((j) => [...name(j), ci(j.selfPreference!.bias, signed), pct(j.selfPreference!.pickOwnWhenWorse.own), pct(j.selfPreference!.pickOwnWhenWorse.others), String(j.selfPreference!.pickOwnWhenWorse.n)])));
md.push('');
writeFileSync(join(RUN, 'results.md'), md.join('\n'));
console.log(md.join('\n'));

if (NAME === 'main' && results.labelled === results.pairs && results.pairs > 0) {
  copyFileSync(join(RUN, 'results.json'), 'results.json');
  copyFileSync(join(RUN, 'results.md'), 'results.md');
  console.log('\nEvery pair is labelled: copied results.json and results.md to the repo root.');
}
