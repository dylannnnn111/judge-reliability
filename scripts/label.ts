// Step 4: the blind labelling page. Run it, open http://localhost:3100, and pick the better answer for
// each pair. No model names anywhere, and which answer sits on the left is a seeded coin flip per pair.
//   npm run label            (needs the answers from npm run generate; no API key)
//
// The queue: all 120 pairs in a shuffled order, then 20 of them again with the sides swapped (to measure
// how consistent your own calls are), then 20 padded answers to spot-check that the padding added nothing.
// Every click saves to runs/<NAME>/labels.json straight away, so you can stop and come back any time.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { buildPairs, loadItems, requestText } from '../src/data.ts';
import type { Verdict } from '../src/judge.ts';
import { coin, rng, shuffle } from '../src/rng.ts';
import { MODELS, writeJson } from './common.ts';
import { LABELS_PATH, loadLabels, loadTexts } from './load.ts';

const PORT = Number(process.env.PORT ?? 3100);
const REPEATS = Number(process.env.REPEATS ?? 20);
const PAD_CHECKS = Number(process.env.PAD_CHECKS ?? 20);

const pairs = buildPairs(loadItems(), MODELS);
const texts = loadTexts(pairs);
const ready = pairs.filter((p) => texts.has(p.id));
if (!ready.length) {
  console.error('No answers yet - run npm run generate first.');
  process.exit(1);
}
if (ready.length < pairs.length) console.log(`Only ${ready.length} of ${pairs.length} pairs have both answers so far.`);

/** Left = answer A when the coin says so. The repeat pass shows the opposite way round. */
const leftIsA = (id: string) => coin(`show:${id}`);
const order = shuffle(ready, rng('label-order'));
const repeatIds = new Set(shuffle(ready, rng('repeat-pick')).slice(0, REPEATS).map((p) => p.id));
const padIds = shuffle(
  ready.filter((p) => texts.get(p.id)!.padded),
  rng('pad-pick'),
)
  .slice(0, PAD_CHECKS)
  .map((p) => p.id);

type Entry = { key: string; kind: 'label' | 'repeat' | 'pad'; pair: string };
const queue: Entry[] = [
  ...order.map((p) => ({ key: `label:${p.id}`, kind: 'label' as const, pair: p.id })),
  ...order.filter((p) => repeatIds.has(p.id)).map((p) => ({ key: `repeat:${p.id}`, kind: 'repeat' as const, pair: p.id })),
  ...padIds.map((id) => ({ key: `pad:${id}`, kind: 'pad' as const, pair: id })),
];

function view(e: Entry) {
  const p = pairs.find((x) => x.id === e.pair)!;
  const t = texts.get(p.id)!;
  const base = { key: e.key, kind: e.kind, pair: p.id, task: p.item.task, topic: p.item.topic, request: requestText(p.item), reference: p.item.reference };
  if (e.kind === 'pad') {
    const original = p.padSide === 'A' ? t.A : t.B;
    return { ...base, left: original, right: t.padded };
  }
  const aLeft = e.kind === 'label' ? leftIsA(p.id) : !leftIsA(p.id);
  return { ...base, left: aLeft ? t.A : t.B, right: aLeft ? t.B : t.A };
}

/** What's already been answered, as the page's choice keys (left/right/tie or ok/adds). */
function answered(): Record<string, string> {
  const l = loadLabels();
  const out: Record<string, string> = {};
  const back = (id: string, v: Verdict, flipped: boolean) => {
    if (v === 'TIE') return 'tie';
    const aLeft = flipped ? !leftIsA(id) : leftIsA(id);
    return (v === 'A') === aLeft ? 'left' : 'right';
  };
  for (const [id, v] of Object.entries(l.labels)) out[`label:${id}`] = back(id, v, false);
  for (const [id, v] of Object.entries(l.repeats ?? {})) out[`repeat:${id}`] = back(id, v, true);
  for (const [id, v] of Object.entries(l.padChecks ?? {})) out[`pad:${id}`] = v;
  return out;
}

function save(body: { key: string; choice: string; ms?: number; flag?: string }) {
  const e = queue.find((q) => q.key === body.key);
  if (!e) throw new Error(`unknown item ${body.key}`);
  const l = loadLabels();
  l.repeats ??= {};
  l.times ??= {};
  l.padChecks ??= {};
  l.flags ??= {};
  if (body.flag !== undefined) {
    if (body.flag.trim()) l.flags[e.pair] = body.flag.trim();
    else delete l.flags[e.pair];
  }
  if (body.choice) {
    if (e.kind === 'pad') {
      if (body.choice !== 'ok' && body.choice !== 'adds') throw new Error('pad check is ok or adds');
      l.padChecks[e.pair] = body.choice;
    } else {
      if (!['left', 'right', 'tie'].includes(body.choice)) throw new Error('choice is left, right or tie');
      const aLeft = e.kind === 'label' ? leftIsA(e.pair) : !leftIsA(e.pair);
      const v: Verdict = body.choice === 'tie' ? 'TIE' : (body.choice === 'left') === aLeft ? 'A' : 'B';
      (e.kind === 'label' ? l.labels : l.repeats)[e.pair] = v;
      if (body.ms && e.kind === 'label') l.times[e.pair] = Math.round(body.ms);
    }
  }
  writeJson(LABELS_PATH, l);
}

const page = readFileSync(new URL('../label/index.html', import.meta.url), 'utf8');

createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page);
    } else if (req.method === 'GET' && req.url === '/api/state') {
      const l = loadLabels();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items: queue.map(view), answered: answered(), flags: l.flags ?? {} }));
    } else if (req.method === 'POST' && req.url === '/api/save') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      save(JSON.parse(raw));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    } else res.writeHead(404).end('not found');
  } catch (e) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: (e as Error).message }));
  }
}).listen(PORT, '127.0.0.1', () => {
  const done = Object.keys(answered()).length;
  console.log(`Labelling page: http://localhost:${PORT}  (${done}/${queue.length} done; Ctrl+C to stop, progress is saved)`);
});
