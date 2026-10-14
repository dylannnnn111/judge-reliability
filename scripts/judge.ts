// Step 3: every judge looks at every pair, in every format, both ways round, padded and not.
//   ANTHROPIC_API_KEY=... npm run judge          (npm run judge:keychain reads the key from the Keychain)
//   DRY=1 npm run judge                          count the calls and estimate the cost first
//
// Options (environment variables, plus NAME/MODELS/CONCURRENCY from common.ts):
//   JUDGES=opus,sonnet,haiku   default: the same models that wrote the answers (needed for self-preference)
//   FORMATS=plain,rubric,score default: all three
//   VARIANTS=orig,pad,repeat   default: all three. 'pad' is the verbosity test. 'repeat' asks the pairwise
//                              judges about REPEAT_PAIRS pairs again in the same order, to measure how much
//                              verdicts change by chance alone (current models don't accept a temperature)
//   REPEAT_PAIRS=40            how many pairs the repeat variant covers
//   TEMPERATURE=0              only for models that still accept it. Default: not sent
// Pairwise calls happen twice per pair (A first, then B first). Pointwise scores each answer once.
// Saves runs/<NAME>/judgments/<judge>/<format>/<variant>/<pair>__<order or side>.json. Resumable.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Order, Variant } from '../src/analyse.ts';
import { buildPairs, loadItems } from '../src/data.ts';
import type { Format } from '../src/judge.ts';
import { FORMATS, pairPrompt, parseScore, parseVerdict, scorePrompt, unshow } from '../src/judge.ts';
import type { Request } from '../src/llm.ts';
import { modelFor } from '../src/llm.ts';
import { rng, shuffle } from '../src/rng.ts';
import { DRY, MODELS, RUN, costOf, list, modelIds, money, pool, priceFor, tokensIn, writeJson } from './common.ts';
import { loadTexts } from './load.ts';

const JUDGES = list(process.env.JUDGES, MODELS.join(','));
const formats = list(process.env.FORMATS, FORMATS.join(',')) as Format[];
const variants = list(process.env.VARIANTS, 'orig,pad,repeat') as Variant[];
const REPEAT_PAIRS = Number(process.env.REPEAT_PAIRS ?? 40);
for (const f of formats) if (!FORMATS.includes(f)) throw new Error(`Unknown format ${f}`);
const TEMPERATURE = process.env.TEMPERATURE ? Number(process.env.TEMPERATURE) : undefined;

const pairs = buildPairs(loadItems(), MODELS);
const repeatIds = new Set(shuffle(pairs, rng('judge-repeat')).slice(0, REPEAT_PAIRS).map((p) => p.id));
const texts = loadTexts(pairs);
const ids = await modelIds(JUDGES);

type Job = { path: string; judge: string; req: Request; save: (text: string) => Record<string, unknown> };
const jobs: Job[] = [];
let missing = 0;

for (const p of pairs) {
  const t = texts.get(p.id);
  if (!t) {
    missing++;
    continue;
  }
  for (const variant of variants) {
    if (variant === 'pad' && !t.padded) {
      missing++;
      continue;
    }
    if (variant === 'repeat' && !repeatIds.has(p.id)) continue;
    const answer = (side: 'A' | 'B') => (variant === 'pad' && side === p.padSide ? t.padded! : t[side]);
    for (const judge of JUDGES) {
      for (const format of formats) {
        const dir = join(RUN, 'judgments', judge, format, variant);
        if (format === 'score' && variant === 'repeat') continue; // the noise check is for pairwise verdicts
        if (format === 'score') {
          // In the pad variant only the padded side changes, so only that side is scored again
          const sides: ('A' | 'B')[] = variant === 'orig' ? ['A', 'B'] : [p.padSide];
          for (const side of sides) {
            jobs.push({
              path: join(dir, `${p.id}__${side}.json`),
              judge,
              req: scorePrompt(p.item, answer(side)),
              save: (text) => ({ kind: 'score', judge, variant, pair: p.id, side, score: parseScore(text) }),
            });
          }
        } else {
          for (const order of (variant === 'repeat' ? ['ab'] : ['ab', 'ba']) as Order[]) {
            const [first, second] = order === 'ab' ? [answer('A'), answer('B')] : [answer('B'), answer('A')];
            jobs.push({
              path: join(dir, `${p.id}__${order}.json`),
              judge,
              req: pairPrompt(format, p.item, first, second),
              save: (text) => {
                const shown = parseVerdict(format, text);
                return { kind: 'pair', judge, format, variant, pair: p.id, order, shown, verdict: shown && unshow(shown, order) };
              },
            });
          }
        }
      }
    }
  }
}

const todo = jobs.filter((j) => !existsSync(j.path));
console.log(
  `${jobs.length} judge calls (${JUDGES.length} judges x ${formats.join('/')} x ${variants.join('/')}), ${jobs.length - todo.length} done, ${todo.length} to go.` +
    (missing ? ` ${missing} pair-variants skipped: answers or padding not generated yet.` : ''),
);

if (DRY) {
  const outTokens = (r: Request) => (r.maxTokens <= 10 ? 3 : r.maxTokens >= 800 ? 300 : 250); // plain / rubric / score
  const byJudge: Record<string, number> = {};
  for (const j of todo) {
    const p = priceFor(ids[j.judge]);
    if (p) byJudge[j.judge] = (byJudge[j.judge] ?? 0) + (tokensIn(j.req.system + j.req.user) * p.input + outTokens(j.req) * p.output) / 1e6;
  }
  const total = Object.values(byJudge).reduce((a, b) => a + b, 0);
  console.log(`Rough cost: ${money(total)} (${Object.entries(byJudge).map(([k, v]) => `${k} ${money(v)}`).join(', ')})`);
  process.exit(0);
}

let unreadable = 0;
await pool(
  todo,
  async (j) => {
    const model = ids[j.judge];
    const reply = await modelFor(model)({ ...j.req, temperature: TEMPERATURE });
    const cell = j.save(reply.text);
    if (cell.verdict === null || cell.score === null) unreadable++;
    writeJson(j.path, { ...cell, model, text: reply.text, usage: reply.usage, cost: costOf(model, reply.usage) });
  },
  'judge calls',
);
if (unreadable) console.log(`${unreadable} replies had no readable verdict (kept, counted as invalid in the analysis).`);
