// Step 1: each model in a pair answers its item. 120 pairs -> 240 answers.
//   ANTHROPIC_API_KEY=... npm run generate        (or npm run generate:keychain)
// Saves runs/<NAME>/answers/<item>__<model>.json. Rerunning only fills in what's missing.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AUTHOR_SYSTEM, buildPairs, loadItems, requestText } from '../src/data.ts';
import { modelFor } from '../src/llm.ts';
import { DRY, MODELS, RUN, costOf, modelIds, money, pool, priceFor, tokensIn, writeJson } from './common.ts';

const pairs = buildPairs(loadItems(), MODELS);
const ids = await modelIds(MODELS);
const jobs = pairs.flatMap((p) => p.authors.map((alias) => ({ item: p.item, alias, path: join(RUN, 'answers', `${p.item.id}__${alias}.json`) })));
const todo = jobs.filter((j) => !existsSync(j.path));
console.log(`${jobs.length} answers, ${jobs.length - todo.length} already done, ${todo.length} to go. Models: ${MODELS.map((a) => `${a}=${ids[a]}`).join(', ')}`);

if (DRY) {
  const est = todo.reduce((s, j) => {
    const p = priceFor(ids[j.alias]);
    return s + (p ? (tokensIn(requestText(j.item)) * p.input + 250 * p.output) / 1e6 : 0);
  }, 0);
  console.log(`Rough cost: ${money(est)}`);
  process.exit(0);
}

await pool(
  todo,
  async ({ item, alias, path }) => {
    const model = ids[alias];
    const reply = await modelFor(model)({ system: AUTHOR_SYSTEM, user: requestText(item), maxTokens: 700 });
    if (reply.stop === 'max_tokens') console.warn(`  ${item.id} ${alias}: hit the token limit, answer is cut off`);
    writeJson(path, { item: item.id, alias, model, text: reply.text.trim(), stop: reply.stop, usage: reply.usage, cost: costOf(model, reply.usage), at: new Date().toISOString() });
  },
  'answers',
);
