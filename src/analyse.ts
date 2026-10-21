// From judgments and human labels to the numbers in the write-up. Pure functions: no files, no API,
// so the tests and the simulation can feed it made-up judges with known biases and check it finds them.

import type { Pair, TaskType } from './data.ts';
import { TASK_TYPES } from './data.ts';
import type { Format, Verdict } from './judge.ts';
import { scoresToVerdict } from './judge.ts';
import type { Interval } from './stats.ts';
import { binomialP, bootstrap, cohenKappa, mean } from './stats.ts';

export type Variant = 'orig' | 'pad' | 'repeat'; // repeat = the same pair asked again in the same order (noise check)
export type Order = 'ab' | 'ba';

/** One pairwise judgment. `verdict` is in canonical A/B terms; `shown` is what the judge actually wrote. */
export type PairCell = {
  kind: 'pair';
  judge: string;
  format: 'plain' | 'rubric';
  variant: Variant;
  pair: string;
  order: Order;
  verdict: Verdict | null;
  shown: Verdict | null;
};

/** One pointwise score. Only the padded side is scored again in the 'pad' variant; the other side is reused. */
export type ScoreCell = { kind: 'score'; judge: string; variant: Variant; pair: string; side: 'A' | 'B'; score: number | null };

export type Cell = PairCell | ScoreCell;

export type Labels = {
  labels: Record<string, Verdict>; // pair id -> the labeller's choice, canonical A/B
  repeats?: Record<string, Verdict>; // a second, blind look at some pairs, for the labeller's own consistency
};

export type JudgeResult = {
  judge: string;
  format: Format;
  valid: number; // share of judgments with a verdict we could read
  position: null | {
    firstRate: Interval; // share of decisive verdicts that picked whichever answer was shown first
    p: number; // binomial test against 0.5
    consistent: Interval; // share of pairs where swapping the order gives the same verdict
    flips: number; // share of pairs where the decisive verdict changes with the order
    sameOrder: Interval | null; // share of repeated pairs where asking again in the SAME order gives the same verdict (the noise floor)
  };
  agreement: null | {
    kappa: Interval; // Cohen's kappa against the human labels, 3 classes (A, B, TIE)
    accuracy: Interval; // share of pairs the human called that the judge called the same way
    byTask: Record<TaskType, Interval>;
    called: number; // pairs the human called one way or the other (accuracy is over these)
    calledByTask: Record<TaskType, number>;
  };
  calls: { A: number; B: number; TIE: number }; // the judge's final verdicts on the original pairs (a split decision across orders = TIE)
  humanTies: null | { n: number; judgeTie: number }; // on pairs the human called about the same, share the judge also called a tie
  verbosity: null | Interval; // average swing towards an answer once it's padded, -2..2 (0 = no effect)
  selfPreference: null | {
    bias: Interval; // how much more this judge favours its own answers than neutral judges do, -2..2
    pickOwnWhenWorse: { own: number; others: number; n: number }; // on pairs the human says it lost
  };
};

export type Results = {
  pairs: number;
  labelled: number;
  human: null | { split: Record<Verdict, number>; repeat: null | { n: number; agree: number; kappa: number } };
  judges: JudgeResult[];
  crossAgreement: { a: string; b: string; same: number; n: number }[]; // judge/format vs judge/format: share of pairs with the same final verdict
};

const toward = (v: Verdict | null, side: 'A' | 'B'): number | null => (v === null ? null : v === 'TIE' ? 0 : v === side ? 1 : -1);
const other = (s: 'A' | 'B'): 'A' | 'B' => (s === 'A' ? 'B' : 'A');

/** Everything one judge said about one pair in one format and variant. */
type View = {
  combined: Verdict | null; // pairwise: both orders agree -> that verdict, they disagree -> TIE. score: higher wins
  pref: (side: 'A' | 'B') => number | null; // -1..1 towards that side, averaged over both orders
  orders?: { ab: PairCell | undefined; ba: PairCell | undefined };
};

function index(cells: Cell[]) {
  const pairCells = new Map<string, PairCell>();
  const scores = new Map<string, ScoreCell>();
  for (const c of cells) {
    if (c.kind === 'pair') pairCells.set(`${c.judge}|${c.format}|${c.variant}|${c.pair}|${c.order}`, c);
    else scores.set(`${c.judge}|${c.variant}|${c.pair}|${c.side}`, c);
  }
  return (judge: string, format: Format, variant: Variant, pair: Pair): View | null => {
    if (format === 'score') {
      const get = (side: 'A' | 'B') =>
        (variant === 'pad' && side === pair.padSide ? scores.get(`${judge}|pad|${pair.id}|${side}`) : scores.get(`${judge}|orig|${pair.id}|${side}`))?.score ?? null;
      const a = get('A');
      const b = get('B');
      if (a === null || b === null) return null;
      const v = scoresToVerdict(a, b);
      return { combined: v, pref: (s) => toward(v, s) };
    }
    const ab = pairCells.get(`${judge}|${format}|${variant}|${pair.id}|ab`);
    const ba = pairCells.get(`${judge}|${format}|${variant}|${pair.id}|ba`);
    if (!ab && !ba) return null;
    const vs = [ab?.verdict, ba?.verdict].filter((v): v is Verdict => v !== undefined && v !== null);
    const combined = !ab || !ba || ab.verdict === null || ba.verdict === null ? null : ab.verdict === ba.verdict ? ab.verdict : 'TIE';
    return {
      combined,
      pref: (s) => (vs.length ? mean(vs.map((v) => toward(v, s)!)) : null),
      orders: { ab, ba },
    };
  };
}

export function analyse(input: { pairs: Pair[]; cells: Cell[]; judges: string[]; formats: Format[]; labels?: Labels; seed?: string; reps?: number }): Results {
  const { pairs, cells, judges, formats } = input;
  const labels = input.labels?.labels ?? {};
  const view = index(cells);
  const seed = input.seed ?? 'analyse';
  const reps = input.reps;
  const labelled = pairs.filter((p) => labels[p.id]);

  const human: Results['human'] = labelled.length
    ? {
        split: { A: 0, B: 0, TIE: 0, ...Object.fromEntries((['A', 'B', 'TIE'] as Verdict[]).map((v) => [v, labelled.filter((p) => labels[p.id] === v).length])) },
        repeat: (() => {
          const rep = input.labels?.repeats ?? {};
          const ids = Object.keys(rep).filter((id) => labels[id]);
          if (!ids.length) return null;
          return {
            n: ids.length,
            agree: ids.filter((id) => rep[id] === labels[id]).length / ids.length,
            kappa: cohenKappa(
              ids.map((id) => labels[id]),
              ids.map((id) => rep[id]),
            ),
          };
        })(),
      }
    : null;

  const out: JudgeResult[] = [];
  for (const judge of judges) {
    for (const format of formats) {
      const tag = `${seed}|${judge}|${format}`;
      const views = pairs.map((p) => ({ p, v: view(judge, format, 'orig', p) })).filter((x): x is { p: Pair; v: View } => x.v !== null);
      if (!views.length) continue;

      // Readable verdicts
      let valid: number;
      if (format === 'score') {
        const sc = cells.filter((c): c is ScoreCell => c.kind === 'score' && c.judge === judge);
        valid = sc.length ? sc.filter((c) => c.score !== null).length / sc.length : NaN;
      } else {
        const pc = cells.filter((c): c is PairCell => c.kind === 'pair' && c.judge === judge && c.format === format);
        valid = pc.length ? pc.filter((c) => c.verdict !== null).length / pc.length : NaN;
      }

      // Position bias (pairwise formats only: a pointwise judge never sees two answers)
      let position: JudgeResult['position'] = null;
      if (format !== 'score') {
        const per = views.map(({ v }) => {
          const shown = [v.orders!.ab?.shown, v.orders!.ba?.shown].filter((s): s is Verdict => s === 'A' || s === 'B');
          return { first: shown.filter((s) => s === 'A').length, decisive: shown.length };
        });
        const both = views.filter(({ v }) => v.orders!.ab?.verdict && v.orders!.ba?.verdict);
        const k = per.reduce((s, x) => s + x.first, 0);
        const n = per.reduce((s, x) => s + x.decisive, 0);
        position = {
          firstRate: bootstrap(per.length, (idx) => {
            const d = idx.reduce((s, i) => s + per[i].decisive, 0);
            return d ? idx.reduce((s, i) => s + per[i].first, 0) / d : NaN;
          }, { seed: `${tag}|first`, reps }),
          p: binomialP(k, n),
          consistent: bootstrap(both.length, (idx) => mean(idx.map((i) => (both[i].v.orders!.ab!.verdict === both[i].v.orders!.ba!.verdict ? 1 : 0))), { seed: `${tag}|cons`, reps }),
          flips: both.length
            ? both.filter(({ v }) => {
                const a = v.orders!.ab!.verdict;
                const b = v.orders!.ba!.verdict;
                return a !== 'TIE' && b !== 'TIE' && a !== b;
              }).length / both.length
            : NaN,
          sameOrder: (() => {
            const reps = pairs
              .map((p) => {
                const a = cells.find((c): c is PairCell => c.kind === 'pair' && c.judge === judge && c.format === format && c.variant === 'orig' && c.pair === p.id && c.order === 'ab');
                const b = cells.find((c): c is PairCell => c.kind === 'pair' && c.judge === judge && c.format === format && c.variant === 'repeat' && c.pair === p.id && c.order === 'ab');
                return a?.verdict && b?.verdict ? (a.verdict === b.verdict ? 1 : 0) : null;
              })
              .filter((x): x is 0 | 1 => x !== null);
            return reps.length ? bootstrap(reps.length, (idx) => mean(idx.map((i) => reps[i])), { seed: `${tag}|same`, reps: input.reps }) : null;
          })(),
        };
      }

      // Agreement with the human labels
      let agreement: JudgeResult['agreement'] = null;
      const rated = views.filter(({ p, v }) => labels[p.id] && v.combined !== null);
      if (rated.length) {
        const hv = rated.map(({ p }) => labels[p.id]);
        const jv = rated.map(({ v }) => v.combined!);
        const accOn = (subset: number[]) => {
          const called = subset.filter((i) => hv[i] !== 'TIE');
          return called.length ? called.filter((i) => jv[i] === hv[i]).length / called.length : NaN;
        };
        const byTask = Object.fromEntries(
          TASK_TYPES.map((t) => {
            const ids = rated.map((_, i) => i).filter((i) => rated[i].p.item.task === t);
            return [t, bootstrap(ids.length, (idx) => accOn(idx.map((i) => ids[i])), { seed: `${tag}|acc|${t}`, reps })];
          }),
        ) as Record<TaskType, Interval>;
        agreement = {
          kappa: bootstrap(rated.length, (idx) => cohenKappa(idx.map((i) => hv[i]), idx.map((i) => jv[i])), { seed: `${tag}|kappa`, reps }),
          accuracy: bootstrap(rated.length, accOn, { seed: `${tag}|acc`, reps }),
          byTask,
          called: hv.filter((v) => v !== 'TIE').length,
          calledByTask: Object.fromEntries(TASK_TYPES.map((t) => [t, rated.filter(({ p }) => p.item.task === t && labels[p.id] !== 'TIE').length])) as Record<TaskType, number>,
        };
      }

      // Verbosity: same pair, one answer padded with words that add nothing. How far does the judge swing?
      let verbosity: Interval | null = null;
      const swings = pairs
        .map((p) => {
          const o = view(judge, format, 'orig', p)?.pref(p.padSide);
          const d = view(judge, format, 'pad', p)?.pref(p.padSide);
          return o === null || o === undefined || d === null || d === undefined ? null : d - o;
        })
        .filter((x): x is number => x !== null);
      if (swings.length) verbosity = bootstrap(swings.length, (idx) => mean(idx.map((i) => swings[i])), { seed: `${tag}|verb`, reps });

      // Self-preference: on pairs this judge's model wrote one answer for, how much more does it favour
      // that answer than a neutral judge (same format) does? Comparing on the same pairs cancels out how
      // good the answer is; what's left is the judge liking its own work. The neutral judges are the ones
      // whose model wrote neither answer - otherwise the opponent's own self-preference would leak in.
      let selfPreference: JudgeResult['selfPreference'] = null;
      const own = views.filter(({ p }) => p.authors.includes(judge));
      if (own.length) {
        const rows = own
          .map(({ p, v }) => {
            const side: 'A' | 'B' = p.authors[0] === judge ? 'A' : 'B';
            const mine = v.pref(side);
            const others = judges.filter((j) => !p.authors.includes(j));
            const theirs = others.map((o) => view(o, format, 'orig', p)?.pref(side)).filter((x): x is number => x !== null && x !== undefined);
            if (mine === null || !theirs.length) return null;
            const worse = labels[p.id] === other(side);
            const pickOwn = v.combined === side ? 1 : 0;
            const othersPick = mean(others.map((o) => view(o, format, 'orig', p)?.combined).filter((x) => x !== undefined && x !== null).map((x) => (x === side ? 1 : 0)));
            return { diff: mine - mean(theirs), worse, pickOwn, othersPick };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        if (rows.length) {
          const lost = rows.filter((r) => r.worse);
          selfPreference = {
            bias: bootstrap(rows.length, (idx) => mean(idx.map((i) => rows[i].diff)), { seed: `${tag}|self`, reps }),
            pickOwnWhenWorse: { own: mean(lost.map((r) => r.pickOwn)), others: mean(lost.map((r) => r.othersPick).filter((x) => !Number.isNaN(x))), n: lost.length },
          };
        }
      }

      const finals = views.map(({ v }) => v.combined).filter((x): x is Verdict => x !== null);
      const calls = { A: finals.filter((x) => x === 'A').length, B: finals.filter((x) => x === 'B').length, TIE: finals.filter((x) => x === 'TIE').length };
      const tiePairs = views.filter(({ p, v }) => labels[p.id] === 'TIE' && v.combined !== null);
      const humanTies = tiePairs.length ? { n: tiePairs.length, judgeTie: tiePairs.filter(({ v }) => v.combined === 'TIE').length / tiePairs.length } : null;

      out.push({ judge, format, valid, position, agreement, calls, humanTies, verbosity, selfPreference });
    }
  }
  const combos = out.map((j) => ({ key: `${j.judge}/${j.format}`, judge: j.judge, format: j.format }));
  const crossAgreement: Results['crossAgreement'] = [];
  for (let i = 0; i < combos.length; i++)
    for (let k = i + 1; k < combos.length; k++) {
      const both = pairs
        .map((p) => [view(combos[i].judge, combos[i].format, 'orig', p)?.combined, view(combos[k].judge, combos[k].format, 'orig', p)?.combined])
        .filter((x): x is [Verdict, Verdict] => !!x[0] && !!x[1]);
      if (both.length) crossAgreement.push({ a: combos[i].key, b: combos[k].key, same: both.filter(([x, y]) => x === y).length / both.length, n: both.length });
    }
  return { pairs: pairs.length, labelled: labelled.length, human, judges: out, crossAgreement };
}
