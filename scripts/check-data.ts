// Checks the item files and the pair design: counts, fields, lengths, and that every matchup and
// side gets a fair share. No API calls.
//   npm run check-data
import { TASK_TYPES, buildPairs, loadItems, matchups } from '../src/data.ts';
import { MODELS } from './common.ts';

const items = loadItems();
const problems: string[] = [];
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const seen = new Set<string>();

for (const it of items) {
  if (seen.has(it.id)) problems.push(`${it.id}: duplicate id`);
  seen.add(it.id);
  for (const f of ['id', 'task', 'topic', 'input', 'reference'] as const) if (!it[f]?.trim()) problems.push(`${it.id}: missing ${f}`);
  if (/[\u2013\u2014]/.test(it.input + it.reference)) problems.push(`${it.id}: em or en dash`);
  if (it.task === 'summary' && (words(it.input) < 200 || words(it.input) > 450)) problems.push(`${it.id}: source is ${words(it.input)} words`);
  if (it.task === 'code') {
    const code = it.input.split('\n\n').slice(1).join('\n\n').split('\n');
    if (code.length < 10 || code.length > 70) problems.push(`${it.id}: ${code.length} lines of code`);
  }
}
for (const t of TASK_TYPES) {
  const n = items.filter((i) => i.task === t).length;
  console.log(`${t}: ${n} items`);
}

const pairs = buildPairs(items, MODELS);
console.log(`\n${pairs.length} pairs over ${MODELS.join(', ')}`);
for (const [x, y] of matchups(MODELS)) {
  const n = pairs.filter((p) => p.authors.includes(x) && p.authors.includes(y)).length;
  console.log(`  ${x} vs ${y}: ${n}`);
}
for (const m of MODELS) console.log(`  ${m} is answer A in ${pairs.filter((p) => p.authors[0] === m).length}, B in ${pairs.filter((p) => p.authors[1] === m).length}`);
console.log(`  padded side: A ${pairs.filter((p) => p.padSide === 'A').length}, B ${pairs.filter((p) => p.padSide === 'B').length}`);

if (problems.length) {
  console.log(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exitCode = 1;
} else console.log('\nAll items look fine.');
