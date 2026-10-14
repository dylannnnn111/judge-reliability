// Step 2: for the verbosity test, one answer in each pair is rewritten to about twice the length with
// nothing new in it. If a judge's preference moves towards an answer once it's padded, that's length bias.
//   ANTHROPIC_API_KEY=... npm run pad
// PAD_MODEL=haiku picks the rewriter. The labelling page lets you spot-check 20 of these for added content.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildPairs, loadItems } from '../src/data.ts';
import { modelFor } from '../src/llm.ts';
import { DRY, MODELS, RUN, costOf, modelIds, pool, readJson, writeJson } from './common.ts';

const PAD_MODEL = process.env.PAD_MODEL || 'haiku';
const pairs = buildPairs(loadItems(), MODELS);
const ids = await modelIds([...new Set([...MODELS, PAD_MODEL])]);
const model = ids[PAD_MODEL];

const PAD_SYSTEM = 'You rewrite text exactly as instructed.';
const padPrompt = (answer: string, harder = false) =>
  `Rewrite the response below so it is ${harder ? 'at least twice' : 'about twice'} as long, without changing what it says.\n\n` +
  'Rules:\n' +
  '- Add no new facts, numbers, claims, bugs, steps, caveats or recommendations.\n' +
  '- Remove nothing and fix nothing, even if something in it is wrong.\n' +
  '- Keep the same format: lists stay lists, code stays code.\n' +
  '- Make it longer only by restating, signposting, adding transitions and framing, and politer wording.\n\n' +
  'Reply with the rewritten response only.\n\n' +
  `[Response]\n${answer}\n[End of response]`;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

const todo = pairs.filter((p) => !existsSync(join(RUN, 'padded', `${p.id}.json`)));
console.log(`${pairs.length} pairs to pad, ${pairs.length - todo.length} done. Rewriter: ${model}`);
if (DRY) process.exit(0);

await pool(
  todo,
  async (p) => {
    const author = p.authors[p.padSide === 'A' ? 0 : 1];
    const ansPath = join(RUN, 'answers', `${p.id}__${author}.json`);
    if (!existsSync(ansPath)) throw new Error(`${p.id}: no answer from ${author} yet - run npm run generate first`);
    const original = readJson<{ text: string }>(ansPath).text;
    const call = modelFor(model);
    let reply = await call({ system: PAD_SYSTEM, user: padPrompt(original), maxTokens: 1500 });
    let usage = reply.usage;
    if (words(reply.text) / words(original) < 1.5) {
      // too short: one more go, asking harder
      reply = await call({ system: PAD_SYSTEM, user: padPrompt(original, true), maxTokens: 1500 });
      usage = { input: usage.input + reply.usage.input, output: usage.output + reply.usage.output };
    }
    const text = reply.text.trim();
    writeJson(join(RUN, 'padded', `${p.id}.json`), {
      pair: p.id,
      side: p.padSide,
      author,
      model,
      original,
      text,
      ratio: Math.round((words(text) / words(original)) * 100) / 100,
      usage,
      cost: costOf(model, usage),
    });
  },
  'padded answers',
);
