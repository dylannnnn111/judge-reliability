// Before spending real money: one tiny call per model with the exact settings the judges use
// (a one-token reply, no temperature), so a model that rejects a parameter fails here and not 2,000 calls in.
//   ANTHROPIC_API_KEY=... npm run smoke
import { modelFor } from '../src/llm.ts';
import { parseVerdict } from '../src/judge.ts';
import { MODELS, list, modelIds } from './common.ts';

const JUDGES = list(process.env.JUDGES, MODELS.join(','));
const aliases = [...new Set([...MODELS, ...JUDGES, process.env.PAD_MODEL || 'haiku'])];
const ids = await modelIds(aliases);
let bad = 0;
for (const a of aliases) {
  try {
    const r = await modelFor(ids[a])({
      system: 'You are an impartial judge of AI assistant responses.',
      user: '[User request]\nWhat is 2 + 2?\n[End of User request]\n\n[Response A]\n4\n[End of Response A]\n\n[Response B]\n5\n[End of Response B]\n\nWhich response is better? Reply with exactly one of: A, B, TIE.',
      maxTokens: 10,
    });
    const v = parseVerdict('plain', r.text);
    console.log(`${a} = ${ids[a]}: replied ${JSON.stringify(r.text)} -> ${v ?? 'UNREADABLE'} (${r.usage.input} in / ${r.usage.output} out)`);
    if (v !== 'A') bad++;
  } catch (e) {
    bad++;
    console.log(`${a} = ${ids[a]}: FAILED ${(e as Error).message.slice(0, 300)}`);
  }
}
console.log(bad ? `\n${bad} model(s) need a look before the full run.` : '\nAll good.');
process.exitCode = bad ? 1 : 0;
