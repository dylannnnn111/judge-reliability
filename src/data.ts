// The study's material: 120 requests across three task types, and how they become pairs of answers.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coin } from './rng.ts';

export type TaskType = 'qa' | 'summary' | 'code';
export const TASK_TYPES: TaskType[] = ['qa', 'summary', 'code'];

export type Item = {
  id: string; // qa-01, sum-01, code-01
  task: TaskType;
  topic: string;
  input: string; // the question, source text or code
  reference: string; // what a good answer contains. Shown to the human labeller, never to the judges
  language?: string; // code only
};

/**
 * A pair: two models' answers to the same item. `authors[0]` is answer A and `authors[1]` is answer B
 * everywhere in the data. Which one a judge or the labeller sees first is decided separately, per showing.
 */
export type Pair = {
  id: string; // same as the item id: one pair per item
  item: Item;
  authors: [string, string]; // model aliases, e.g. ['sonnet', 'opus']
  padSide: 'A' | 'B'; // which answer gets padded in the verbosity test
};

export function loadItems(dir = 'data'): Item[] {
  return TASK_TYPES.flatMap((t) => JSON.parse(readFileSync(join(dir, `${t === 'summary' ? 'summary' : t}.json`), 'utf8')) as Item[]);
}

/** What every answering model is asked. Same words for every model, so only the model differs. */
export const AUTHOR_SYSTEM = 'You are a helpful assistant.';

export function requestText(item: Item): string {
  switch (item.task) {
    case 'qa':
      return `${item.input}\n\nAnswer in under 120 words.`;
    case 'summary':
      return `Summarise the text below for a busy manager who won't read the original. Keep it under 120 words.\n\n${item.input}`;
    case 'code':
      return `Review this code. List the bugs and problems that matter, most important first. Keep it under 200 words.\n\n${item.input}`;
  }
}

/** Every unordered pair of models: 3 models give 3 matchups, 4 give 6. */
export function matchups(models: string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < models.length; i++) for (let j = i + 1; j < models.length; j++) out.push([models[i], models[j]]);
  return out;
}

/**
 * One pair per item. Matchups rotate in one continuous cycle through the items, task by task, so every
 * matchup gets an equal share overall (40 each with 3 models and 120 items, 20 each with 4) and a near
 * equal share within each task. Which model is A, and which side gets
 * padded, are coin flips seeded by the item id - so they're random but never change between runs.
 */
export function buildPairs(items: Item[], models: string[]): Pair[] {
  const ms = matchups(models);
  if (ms.length === 0) throw new Error('Need at least two models');
  let k = 0;
  return TASK_TYPES.flatMap((task) =>
    items
      .filter((it) => it.task === task)
      .map((item): Pair => {
        const [x, y] = ms[k++ % ms.length];
        return {
          id: item.id,
          item,
          authors: coin(`authors:${item.id}`) ? [x, y] : [y, x],
          padSide: coin(`pad:${item.id}`) ? 'A' : 'B',
        };
      }),
  );
}
