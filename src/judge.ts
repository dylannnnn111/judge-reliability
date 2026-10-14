// The judge prompts, and reading a verdict back out of what the judge wrote.
//
// Three formats, from least to most guarded:
//   plain  - "which is better?", answer with one token. What a lot of quick evals do.
//   rubric - the task's criteria, an explicit note that order and length don't matter, reasoning before
//            the verdict. The standard advice for making a judge fairer.
//   score  - each answer scored 1-10 on its own, the higher score wins. No order to be biased by,
//            but also no direct comparison.

import type { Item, TaskType } from './data.ts';
import { requestText } from './data.ts';
import type { Request } from './llm.ts';

export type Format = 'plain' | 'rubric' | 'score';
export const FORMATS: Format[] = ['plain', 'rubric', 'score'];
export type Verdict = 'A' | 'B' | 'TIE';

export const JUDGE_SYSTEM = 'You are an impartial judge of AI assistant responses.';

const CRITERIA: Record<TaskType, string> = {
  qa: 'correctness first (a wrong final answer loses to a right one, however well it is explained), then whether it gives the key reasoning, then clarity',
  summary:
    'accuracy first (nothing wrong or misleading, including dates, numbers, conditions and who decided what), then whether it keeps the points the reader needs, then concision',
  code: 'whether the issues it raises are real and the most important ones are found, then whether it ranks them sensibly and says how to fix them, then whether it avoids flagging things that are fine',
};

const LENGTH_NOTE = 'Length is not a merit in itself: a longer response is only better if the extra words add something correct and useful.';

const block = (label: string, text: string) => `[${label}]\n${text}\n[End of ${label}]`;

/** A pairwise prompt. `first` is shown as Response A, `second` as Response B. */
export function pairPrompt(format: 'plain' | 'rubric', item: Item, first: string, second: string): Request {
  const head = [block('User request', requestText(item)), block('Response A', first), block('Response B', second)].join('\n\n');
  if (format === 'plain') {
    return {
      system: JUDGE_SYSTEM,
      user: `${head}\n\nWhich response is better? Reply with exactly one of: A, B, TIE.`,
      maxTokens: 4000, // the reply is one token, but models that think first spend their thinking out of this
    };
  }
  return {
    system: JUDGE_SYSTEM,
    user:
      `${head}\n\nCompare the two responses on ${CRITERIA[item.task]}. ${LENGTH_NOTE} ` +
      'The order the responses are shown in has no meaning. Use TIE only if neither is better in any way that matters.\n\n' +
      'Think it through in a few sentences, then finish with a final line in exactly this form:\nVerdict: A\nor\nVerdict: B\nor\nVerdict: TIE',
    maxTokens: 8000,
  };
}

/** A pointwise prompt: one response, scored on its own. */
export function scorePrompt(item: Item, answer: string): Request {
  return {
    system: JUDGE_SYSTEM,
    user:
      `${block('User request', requestText(item))}\n\n${block('Response', answer)}\n\n` +
      `Score the response from 1 to 10 on ${CRITERIA[item.task]}. ${LENGTH_NOTE}\n\n` +
      'Think it through in a few sentences, then finish with a final line in exactly this form:\nScore: N',
    maxTokens: 8000,
  };
}

/** Read a pairwise verdict. Returns null when the judge didn't give one we can trust. */
export function parseVerdict(format: 'plain' | 'rubric', text: string): Verdict | null {
  const norm = (s: string): Verdict => (s.toUpperCase() === 'TIE' ? 'TIE' : (s.toUpperCase() as Verdict));
  if (format === 'plain') {
    // Only a bare verdict at the start counts: "A", "**B**", "TIE.", "Response A", "A is better: ...".
    // Not "A better answer would..." - there "A" is just the article.
    const m = text.trim().match(/^[\s*"'`(\[]*(?:response\s+)?(A|B|TIE)\b(?=[\s*"'`)\]]*(?:$|[.:,;!\-\n]|is\b|wins\b))/i);
    if (m) return norm(m[1]);
    // fall through: some judges still write "Verdict: A" when told not to
  }
  const all = [...text.matchAll(/verdict\s*[:\-]\s*[*_`"']*\s*(?:response\s+)?(A|B|TIE)\b/gi)];
  return all.length ? norm(all[all.length - 1][1]) : null;
}

/** Read a 1-10 score (the last one, in case the judge drafts and revises). */
export function parseScore(text: string): number | null {
  const all = [...text.matchAll(/score\s*[:\-]\s*[*_`"']*\s*(\d+(?:\.\d+)?)\s*(?:\/\s*10)?/gi)];
  if (!all.length) return null;
  const n = Number(all[all.length - 1][1]);
  return n >= 1 && n <= 10 ? n : null;
}

/** Two pointwise scores to a verdict. Equal scores are a tie. */
export const scoresToVerdict = (a: number, b: number): Verdict => (a > b ? 'A' : b > a ? 'B' : 'TIE');

/** A verdict about the shown order to one about the canonical A/B order. */
export const unshow = (v: Verdict, order: 'ab' | 'ba'): Verdict => (order === 'ab' || v === 'TIE' ? v : v === 'A' ? 'B' : 'A');
