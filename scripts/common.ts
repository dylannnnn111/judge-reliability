// Shared plumbing for the scripts: run folder, model names, prices, a worker pool and file helpers.
//
// Every script reads these environment variables:
//   NAME=main                 folder under runs/ (resumable: finished calls are never repeated). Default: main
//   MODELS=opus,sonnet,haiku  the models that write answers, and by default also judge them
//   CONCURRENCY=4             API calls at the same time
//   DRY=1                     say what would run and roughly what it costs, then stop

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveModel } from '../src/llm.ts';
import type { Usage } from '../src/llm.ts';

export const list = (s: string | undefined, fallback: string) =>
  (s || fallback)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

export const NAME = process.env.NAME || 'main';
export const RUN = join('runs', NAME);
export const MODELS = list(process.env.MODELS, 'opus,sonnet,haiku');
export const CONCURRENCY = Number(process.env.CONCURRENCY ?? 4);
export const DRY = !!process.env.DRY;

export function readJson<T>(path: string, fallback?: T): T {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Write via a temp file and rename, so a crash mid-write never leaves half a file behind. */
export function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2) + '\n');
  renameSync(`${path}.tmp`, path);
}

/** All .json files under a folder, recursively. */
export function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.json') ? [join(dir, e.name)] : [],
  );
}

/**
 * The run's manifest pins each alias to an exact model id the first time it's used, so a run started
 * today keeps using the same models even after a newer one is released.
 */
type Manifest = { created: string; models: Record<string, string> };
export async function modelIds(aliases: string[]): Promise<Record<string, string>> {
  const path = join(RUN, 'manifest.json');
  const m = readJson<Manifest>(path, { created: new Date().toISOString().slice(0, 10), models: {} });
  let changed = false;
  for (const a of aliases) {
    if (m.models[a]) continue;
    if (DRY && !process.env.ANTHROPIC_API_KEY) {
      m.models[a] = a; // good enough for a dry run's cost estimate
      continue;
    }
    m.models[a] = await resolveModel(a);
    changed = true;
  }
  if (changed) writeJson(path, m);
  return m.models;
}

/** $ per million tokens, matched by substring of the model id. */
type Price = { input: number; output: number };
const prices = readJson<Record<string, Price>>('prices.json', {});
export const priceFor = (id: string): Price | null => {
  const hit = Object.keys(prices).find((k) => id.includes(k));
  return hit ? prices[hit] : null;
};
export const costOf = (id: string, u: Usage): number | null => {
  const p = priceFor(id);
  return p ? (u.input * p.input + u.output * p.output) / 1e6 : null;
};

/** Run jobs with a fixed number in flight, printing progress. A failed job is logged and skipped (rerun to retry it). */
export async function pool<T>(jobs: T[], work: (job: T) => Promise<void>, label = 'calls') {
  let next = 0;
  let done = 0;
  let failed = 0;
  const started = Date.now();
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await work(job);
      } catch (e) {
        failed++;
        console.error(`  failed: ${(e as Error).message.slice(0, 300)}`);
      }
      done++;
      if (done % 20 === 0 || done === jobs.length) {
        const mins = ((Date.now() - started) / 60000).toFixed(1);
        console.log(`  ${done}/${jobs.length} ${label} (${failed} failed, ${mins} min)`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  if (failed) console.log(`${failed} failed - run the same command again to retry just those.`);
}

/**
 * Output tokens one call of this kind takes for this model (thinking included), as measured by
 * npm run smoke. Falls back to a guess when smoke hasn't been run for that model.
 */
export function outTokens(modelId: string, kind: 'answer' | 'plain' | 'rubric' | 'score', fallback: number): number {
  const s = readJson<{ outputTokens: Record<string, Record<string, number>> }>(join(RUN, 'smoke.json'), { outputTokens: {} });
  return s.outputTokens[modelId]?.[kind] ?? fallback;
}

/** Rough token count for dry-run estimates (about 3.5 characters per token for English and code). */
export const tokensIn = (s: string) => Math.ceil(s.length / 3.5);

export const money = (x: number) => `$${x.toFixed(2)}`;
