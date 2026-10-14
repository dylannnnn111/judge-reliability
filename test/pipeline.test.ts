// The whole pipeline end to end against a fake Messages API on localhost: generate, pad, judge, label, analyse.
// The fake judges have known habits, so the final numbers can be checked:
//   plain  - always picks whatever is shown first (pure position bias)
//   rubric - always picks the longer response (pure length bias)
//   score  - 8 for anything over 30 characters, 5 for shorter (so padding a short answer lifts it)

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';

const run = promisify(execFile);
const NAME = '__pipeline_test__';
let base = '';
let calls = 0;

const block = (text: string, label: string) => text.split(`[${label}]\n`)[1]?.split(`\n[End of ${label}]`)[0] ?? '';

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const c of req) raw += c;
  if (req.url?.startsWith('/v1/models')) {
    res.end(JSON.stringify({ data: [{ id: 'claude-opus-9' }, { id: 'claude-sonnet-9' }, { id: 'claude-haiku-9' }] }));
    return;
  }
  calls++;
  const body = JSON.parse(raw);
  const user: string = body.messages[0].content;
  let text: string;
  if (body.system === 'You are a helpful assistant.') {
    // answers: opus writes long, the others short
    text = body.model.includes('opus') ? 'A long and careful answer. '.repeat(12) : 'Short answer.';
  } else if (body.system === 'You rewrite text exactly as instructed.') {
    const original = block(user, 'Response');
    text = `${original} ${original} ${original}`;
  } else if (user.includes('Reply with exactly one of')) {
    assert.equal(body.temperature, undefined);
    text = 'A';
  } else if (user.includes('Verdict: TIE')) {
    const a = block(user, 'Response A');
    const b = block(user, 'Response B');
    text = `Thinking about it.\nVerdict: ${a.length > b.length ? 'A' : b.length > a.length ? 'B' : 'TIE'}`;
  } else {
    text = `Fine.\nScore: ${block(user, 'Response').length > 30 ? 8 : 5}`;
  }
  res.end(JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 100 } }));
});

const env = () => ({ ...process.env, ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: 'test', NAME, CONCURRENCY: '24' });
const step = (script: string, extra: Record<string, string> = {}) =>
  run('node', ['--experimental-strip-types', '--no-warnings', `scripts/${script}.ts`], { env: { ...env(), ...extra }, maxBuffer: 1 << 24 });

before(async () => {
  rmSync(`runs/${NAME}`, { recursive: true, force: true });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  rmSync(`runs/${NAME}`, { recursive: true, force: true });
});

test('generate, pad, judge, label and analyse, start to finish', { timeout: 120000 }, async () => {
  await step('generate');
  assert.equal(calls, 240);
  const manifest = JSON.parse(readFileSync(`runs/${NAME}/manifest.json`, 'utf8'));
  assert.deepEqual(manifest.models, { opus: 'claude-opus-9', sonnet: 'claude-sonnet-9', haiku: 'claude-haiku-9' });

  await step('generate'); // resumable: nothing left to do
  assert.equal(calls, 240);

  await step('pad');
  assert.equal(calls, 360);

  const dry = await step('judge', { DRY: '1' });
  assert.match(dry.stdout, /4200 judge calls/);
  assert.equal(calls, 360);
  await step('judge');
  assert.equal(calls, 360 + 4200);

  // label through the real labelling server: always pick the left answer, mark every padding check ok
  const port = String(4000 + Math.floor(Math.random() * 2000));
  const child = execFile('node', ['--experimental-strip-types', '--no-warnings', 'scripts/label.ts'], { env: { ...env(), PORT: port } });
  try {
    let state: { items: { key: string; kind: string }[] } | null = null;
    for (let k = 0; k < 50 && !state; k++) {
      await new Promise((r) => setTimeout(r, 100));
      state = await fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.json(), () => null);
    }
    assert.ok(state);
    assert.equal(state.items.length, 120 + 20 + 20);
    const page = await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
    assert.match(page, /Which answer is better/);
    for (const it of state.items) {
      const choice = it.kind === 'pad' ? 'ok' : 'left';
      const r = await fetch(`http://127.0.0.1:${port}/api/save`, { method: 'POST', body: JSON.stringify({ key: it.key, choice, ms: 1000 }) });
      assert.equal(r.status, 200);
    }
    const bad = await fetch(`http://127.0.0.1:${port}/api/save`, { method: 'POST', body: JSON.stringify({ key: state.items[0].key, choice: 'nonsense' }) });
    assert.equal(bad.status, 400);
  } finally {
    child.kill();
  }
  const labels = JSON.parse(readFileSync(`runs/${NAME}/labels.json`, 'utf8'));
  assert.equal(Object.keys(labels.labels).length, 120);
  // "left" on the repeat pass is the other answer, because the repeat shows the sides swapped
  const id = Object.keys(labels.repeats)[0];
  assert.notEqual(labels.repeats[id], labels.labels[id]);

  const out = await step('analyse');
  assert.match(out.stdout, /Position bias/);
  const res = JSON.parse(readFileSync(`runs/${NAME}/results.json`, 'utf8'));
  assert.equal(res.labelled, 120);
  assert.equal(res.invalidReplies, 0);
  assert.ok(Math.abs(res.totalCostUsd - (4560 * (1000 * 2 + 100 * 10)) / 1e6) < 3); // mixed prices, sanity bound only
  const r = (judge: string, format: string) => res.results.find((x: { judge: string; format: string }) => x.judge === judge && x.format === format);
  assert.equal(r('sonnet', 'plain').position.firstRate.est, 1); // always picks first
  assert.equal(r('sonnet', 'plain').position.consistent.est, 0);
  assert.equal(r('sonnet', 'plain').position.sameOrder.n, 40); // the noise check: same order, asked again
  assert.equal(r('sonnet', 'plain').position.sameOrder.est, 1); // a deterministic fake never changes its mind
  assert.equal(r('sonnet', 'rubric').position.firstRate.est > 0.4 && r('sonnet', 'rubric').position.firstRate.est < 0.6, true);
  // picks the longer answer: padding only changes the call on the 40 sonnet-vs-haiku pairs (equal length, a tie
  // until one side is padded); opus's answers are long enough to stay ahead padded or not. So 40/120 swing by +1.
  assert.ok(Math.abs(r('haiku', 'rubric').verbosity.est - 1 / 3) < 0.01);
  assert.ok(r('haiku', 'score').verbosity.est > 0);
  assert.equal(r('opus', 'plain').verbosity.est, 0); // order bias only: padding changes nothing
  assert.ok(!existsSync('results.json') || !readFileSync('results.json', 'utf8').includes(NAME)); // test runs never touch the root copy

  // smoke: runs every kind of call per model and saves the measured output tokens for the cost estimates.
  // The fake answers are wrong on purpose, so smoke flags them and exits non-zero; that's expected here.
  const before = calls;
  await step('smoke').catch(() => {});
  assert.equal(calls - before, 12);
  const smoke = JSON.parse(readFileSync(`runs/${NAME}/smoke.json`, 'utf8'));
  assert.deepEqual(Object.keys(smoke.outputTokens['claude-opus-9']).sort(), ['answer', 'plain', 'rubric', 'score']);
});
