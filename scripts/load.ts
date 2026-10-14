// Reading a run back off disk: the answers for each pair, the padded versions, the judgments and labels.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Cell, Labels } from '../src/analyse.ts';
import type { Pair } from '../src/data.ts';
import { RUN, readJson, walk } from './common.ts';

export type Texts = { A: string; B: string; padded: string | null; ratio: number | null };

/** Pair id -> its two answers (canonical A/B) and the padded one, for pairs whose answers both exist. */
export function loadTexts(pairs: Pair[]): Map<string, Texts> {
  const out = new Map<string, Texts>();
  for (const p of pairs) {
    const paths = p.authors.map((a) => join(RUN, 'answers', `${p.id}__${a}.json`));
    if (!paths.every(existsSync)) continue;
    const [A, B] = paths.map((x) => readJson<{ text: string }>(x).text);
    const padPath = join(RUN, 'padded', `${p.id}.json`);
    const pad = existsSync(padPath) ? readJson<{ text: string; ratio: number }>(padPath) : null;
    out.set(p.id, { A, B, padded: pad?.text ?? null, ratio: pad?.ratio ?? null });
  }
  return out;
}

export type SavedCell = Cell & { model: string; text: string; usage: { input: number; output: number }; cost: number | null };

export const loadCells = (): SavedCell[] => walk(join(RUN, 'judgments')).map((f) => readJson<SavedCell>(f));

export const LABELS_PATH = join(RUN, 'labels.json');

export type LabelFile = Labels & {
  times?: Record<string, number>; // ms spent on each pair
  padChecks?: Record<string, 'ok' | 'adds'>; // spot-check of padded answers: 'adds' = the padding added content
  flags?: Record<string, string>; // item id -> note, e.g. "reference is wrong"
};

export const loadLabels = (): LabelFile => readJson<LabelFile>(LABELS_PATH, { labels: {}, repeats: {}, times: {}, padChecks: {}, flags: {} });

/** Total $ spent so far in this run, by step. */
export function spend(): Record<string, number> {
  const sum = (dir: string) => walk(join(RUN, dir)).reduce((s, f) => s + (readJson<{ cost?: number | null }>(f).cost ?? 0), 0);
  return { answers: sum('answers'), padding: sum('padded'), judging: sum('judgments') };
}
