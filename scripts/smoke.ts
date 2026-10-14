// Before spending real money: one call per model for each kind of call the study makes (an answer, and a
// verdict in each judge format), with the exact settings the real run uses. A model that rejects a setting
// fails here, not 2,000 calls in. It also measures how many output tokens each kind of call really takes
// (thinking included) and saves them to runs/<NAME>/smoke.json, which the DRY=1 cost estimates then use.
//   ANTHROPIC_API_KEY=... npm run smoke        (about 15 calls, a few cents)
import { join } from 'node:path';
import { AUTHOR_SYSTEM, loadItems, requestText } from '../src/data.ts';
import { pairPrompt, parseScore, parseVerdict, scorePrompt } from '../src/judge.ts';
import type { Request } from '../src/llm.ts';
import { modelFor } from '../src/llm.ts';
import { MODELS, RUN, list, modelIds, writeJson } from './common.ts';

const JUDGES = list(process.env.JUDGES, MODELS.join(','));
const aliases = [...new Set([...MODELS, ...JUDGES])];
const ids = await modelIds(aliases);

// A real item with one right and one wrong answer, so every judge should pick the right one (A).
const item = loadItems().find((i) => i.id === 'qa-02')!;
const right = '96 km/h. The trip out takes 2 hours and the trip back 1.33 hours, so 320 km in 3.33 hours is 96 km/h. It is not 100 km/h, because more time is spent at the slower speed.';
const wrong = '100 km/h. The average of 80 and 120 is 100, so the average speed for the round trip is 100 km/h.';

type Kind = 'answer' | 'plain' | 'rubric' | 'score';
const calls: { kind: Kind; req: Request; ok: (text: string) => boolean }[] = [
  { kind: 'answer', req: { system: AUTHOR_SYSTEM, user: requestText(item), maxTokens: 6000 }, ok: (t) => /96/.test(t) },
  { kind: 'plain', req: pairPrompt('plain', item, right, wrong), ok: (t) => parseVerdict('plain', t) === 'A' },
  { kind: 'rubric', req: pairPrompt('rubric', item, right, wrong), ok: (t) => parseVerdict('rubric', t) === 'A' },
  { kind: 'score', req: scorePrompt(item, right), ok: (t) => (parseScore(t) ?? 0) >= 6 },
];

const measured: Record<string, Partial<Record<Kind, number>>> = {};
let bad = 0;
for (const a of aliases) {
  const model = ids[a];
  measured[model] = {};
  for (const c of calls) {
    try {
      const r = await modelFor(model)(c.req);
      measured[model][c.kind] = r.usage.output;
      const good = c.ok(r.text) && r.stop !== 'max_tokens';
      if (!good) bad++;
      const shown = c.kind === 'answer' || c.kind === 'plain' ? JSON.stringify(r.text.trim().slice(0, 60)) : JSON.stringify(r.text.trim().split('\n').pop()?.slice(0, 40));
      console.log(`${(a + ' ' + c.kind).padEnd(14)} ${good ? 'ok ' : 'BAD'} ${String(r.usage.output).padStart(5)} out tokens, stop ${r.stop}, blocks [${(r.blocks ?? []).join(', ')}] ${shown}`);
    } catch (e) {
      bad++;
      console.log(`${(a + ' ' + c.kind).padEnd(14)} FAILED ${(e as Error).message.slice(0, 300)}`);
    }
  }
}
writeJson(join(RUN, 'smoke.json'), { at: new Date().toISOString(), outputTokens: measured });
console.log(bad ? `\n${bad} call(s) need a look before the full run.` : '\nAll good. Output token counts saved for the cost estimates.');
process.exitCode = bad ? 1 : 0;
