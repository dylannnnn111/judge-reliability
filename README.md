# Who Judges the Judge

A small, careful study of how far you can trust an LLM to grade other LLMs. Three Claude models answer 120 requests, I label the better answer in each pair by hand, and the same three models then judge every pair in three prompt formats. The question is how often the judges agree with a person, and how much of what they decide comes from things that shouldn't matter:

- **Position:** does the judge favour whichever answer it reads first?
- **Length:** does padding an answer with words that add nothing make the judge like it more?
- **Self-preference:** does a judge favour answers its own model wrote?

Plain TypeScript, no dependencies, plain `fetch` to the API.

## Design

**Items** (`data/`): 120 requests written for this study, 40 of each type.
- `qa.json` - short questions with one right answer and a common wrong one (base rates, harmonic means, percentage points, leap years, misconceptions), plus short "explain why" questions.
- `summary.json` - original 260-365 word texts (emails, minutes, incident reports, release notes...) to summarise for a busy manager. Most hide a trap: a late correction, a proposal that wasn't agreed, a condition that changes the meaning.
- `code.json` - 15-54 line snippets in Python, TypeScript/JavaScript, SQL, Go and Bash with 1-3 real bugs (each one confirmed by running the code), some with a decoy that looks wrong but isn't.

Each item has a reference: what a good answer contains. The labeller sees it; the judges never do.

**Pairs:** each item is answered by two of the three models, rotating so every matchup (Opus-Sonnet, Opus-Haiku, Sonnet-Haiku) gets 40 pairs. Which model is "A" is a seeded coin flip.

**Judging:** every judge sees every pair in three formats:

| Format | What the judge gets |
| --- | --- |
| `plain` | "Which response is better? Reply A, B or TIE." What a lot of quick evals do. |
| `rubric` | The task's criteria, an explicit note that length and order don't matter, and reasoning before a `Verdict:` line. The standard advice for a fairer judge. |
| `score` | One answer at a time, scored 1-10. The higher score wins. No order to be biased by, but no direct comparison either. |

Pairwise formats run twice per pair, A first then B first. Temperature 0, so an order effect is the judge, not sampling noise.

**The three biases:**
- Position = share of decisive verdicts that went to whichever answer was shown first (fair is 50%), plus how often the verdict survives swapping the order.
- Length = one answer per pair (seeded coin) is rewritten to about twice the length with no new content, then the pair is judged again. The swing is the change in preference towards the padded answer, from -2 to +2. I spot-check 20 padded answers to make sure nothing was added.
- Self-preference = on pairs a judge's model wrote one answer for, how much more it favours that answer than a neutral judge does on the same pair. The neutral judge is the model that wrote neither answer. Comparing with all other judges would let the opponent's own self-preference leak in: the simulation showed that gives false positives for a judge with no bias at all.

**Agreement with the human:** a judge's verdict on a pair counts only if it holds both ways round (otherwise it's a tie). Reported as accuracy on the pairs I called, and Cohen's kappa over A/B/tie. I also re-label 20 pairs blind, sides swapped, at the end - my own consistency is the ceiling for any judge.

Every interval is a 95% percentile bootstrap over pairs (2,000 resamples, seeded).

## Run it

Needs Node 22.6 or later. Nothing to install.

```sh
npm test               # unit tests + the whole pipeline end to end against a fake API (no key needed)
npm run check-data     # item counts, fields, lengths, matchup balance
npm run simulate       # fake judges with planted biases: does the analysis find them?
POWER=1 npm run simulate   # 40 simulated studies at 120 and 200 pairs: how often each bias is detected

# The study (each step is resumable - rerun to fill in anything that failed)
npm run smoke:keychain       # one tiny call per model with the judge settings, before spending anything
npm run generate:keychain    # 240 answers                       (~$1)
npm run pad:keychain         # 120 padded answers (Haiku)        (cents)
npm run label                # http://localhost:3100 - label 120 pairs, 20 repeats, 20 padding checks
DRY=1 npm run judge          # count the calls and estimate the cost
npm run judge:keychain       # 3,960 judge calls                 (~$15)
npm run analyse              # runs/main/results.md and results.json
```

`:keychain` reads the API key from the macOS Keychain (`aussie-data-mcp-anthropic`); otherwise set `ANTHROPIC_API_KEY`. Labelling and analysis need no key.

Options: `MODELS` (default `opus,sonnet,haiku`, resolved to the newest of each family on the first run and pinned in `runs/main/manifest.json`), `JUDGES`, `FORMATS`, `VARIANTS`, `CONCURRENCY`, `NAME`, `PAD_MODEL`, `TEMPERATURE`. To add a non-Anthropic model, put its id in `MODELS` (e.g. `gpt-...`) and set `OPENAI_API_KEY`; that client is written but hasn't been run against the real API yet, so run `npm run smoke` first.

## Files

- `src/data.ts` - items, the request each model gets, the pair design
- `src/judge.ts` - the judge prompts and verdict parsing
- `src/stats.ts` - kappa, bootstrap, binomial test, all written out
- `src/analyse.ts` - judgments + labels to the numbers, as pure functions
- `src/simulate.ts` - fake judges with planted biases, for the tests and the power check
- `scripts/` - generate, pad, label (+ `label/index.html`), judge, analyse, smoke, check-data, simulate
- `runs/main/` - everything a run produces: answers, padded answers, every judge reply in full, `labels.json`, results

## Limits

- One labeller (me), with a reference to hand. The labels are "which answer is better, knowing the right answer", which is the standard the judges are held to.
- All three judges are Claude models, so self-preference here is within one family; a cross-family judge would test it harder. The design takes more models without changes (four models give six matchups of 20 pairs).
- The padding is written by Haiku, which is also a judge. Self-preference is measured on unpadded pairs only, so this doesn't touch that number, but it's worth knowing.

## Licence

MIT
