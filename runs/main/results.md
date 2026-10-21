# Who Judges the Judge - results (main)

120 pairs, 120 labelled by hand, 4200 judge calls (0 unreadable). Spent $54.96 (answers $1.6, padding $0.08, judging $53.29).

Models: opus = claude-opus-5-5, sonnet = claude-sonnet-5-5, haiku = claude-haiku-5-5. 95% bootstrap intervals over pairs in brackets.

**Human labels:** A 22, B 26, tie 72.
 Re-labelled 20 pairs blind: same call 100% of the time, kappa 1.00. That's the ceiling for any judge.

## Agreement with the human labels

Accuracy = share of pairs the human called where the judge made the same call (judge ties and order-dependent verdicts count as misses).

| Judge | Format | Readable | Accuracy | Kappa | Acc qa | Acc summary | Acc code |
| --- | --- | --- | --- | --- | --- | --- | --- |
| opus | plain | 100% | 58% [44%, 73%] | 0.10 [0.01, 0.19] | 45% [17%, 77%] | 63% [38%, 87%] | 62% [40%, 83%] |
| opus | rubric | 100% | 65% [51%, 78%] | 0.12 [0.02, 0.22] | 45% [17%, 75%] | 69% [44%, 91%] | 71% [50%, 90%] |
| opus | score | 100% | 46% [32%, 60%] | 0.09 [-0.04, 0.21] | 18% [0%, 44%] | 56% [32%, 80%] | 52% [31%, 74%] |
| sonnet | plain | 100% | 50% [36%, 64%] | 0.07 [-0.02, 0.17] | 55% [25%, 86%] | 50% [25%, 75%] | 48% [26%, 68%] |
| sonnet | rubric | 100% | 56% [42%, 70%] | 0.14 [0.02, 0.24] | 55% [23%, 83%] | 44% [19%, 69%] | 67% [46%, 86%] |
| sonnet | score | 100% | 35% [22%, 50%] | 0.08 [-0.05, 0.20] | 9% [0%, 30%] | 44% [20%, 69%] | 43% [22%, 65%] |
| haiku | plain | 100% | 44% [31%, 58%] | 0.12 [0.01, 0.24] | 27% [0%, 57%] | 50% [25%, 75%] | 48% [26%, 70%] |
| haiku | rubric | 100% | 56% [42%, 70%] | 0.19 [0.07, 0.31] | 45% [15%, 78%] | 56% [32%, 80%] | 62% [41%, 81%] |
| haiku | score | 100% | 25% [13%, 38%] | 0.01 [-0.10, 0.12] | 9% [0%, 30%] | 31% [9%, 56%] | 29% [10%, 50%] |

Accuracy is over the pairs the human called one way or the other (48 of 120).

## Ties

Final verdicts on the original pairs (a split decision across the two orders counts as a tie), and on the pairs the human called about the same, how often the judge did too.

| Judge | Format | A | B | Tie | Ties on human ties |
| --- | --- | --- | --- | --- | --- |
| opus | plain | 49 | 58 | 13 | 14% of 72 |
| opus | rubric | 42 | 58 | 20 | 17% of 72 |
| opus | score | 34 | 46 | 40 | 35% of 72 |
| sonnet | plain | 45 | 53 | 22 | 21% of 72 |
| sonnet | rubric | 46 | 48 | 26 | 26% of 72 |
| sonnet | score | 32 | 38 | 50 | 46% of 72 |
| haiku | plain | 35 | 48 | 37 | 39% of 72 |
| haiku | rubric | 38 | 46 | 36 | 38% of 72 |
| haiku | score | 38 | 34 | 48 | 44% of 72 |

## Judges vs each other

Share of pairs where two judge setups give the same final verdict.

| Setup | Setup | Same | n |
| --- | --- | --- | --- |
| opus/plain | opus/rubric | 77% | 120 |
| opus/plain | opus/score | 63% | 120 |
| opus/plain | sonnet/plain | 80% | 120 |
| opus/plain | sonnet/rubric | 69% | 120 |
| opus/plain | sonnet/score | 54% | 120 |
| opus/plain | haiku/plain | 63% | 120 |
| opus/plain | haiku/rubric | 61% | 120 |
| opus/plain | haiku/score | 51% | 120 |
| opus/rubric | opus/score | 62% | 120 |
| opus/rubric | sonnet/plain | 66% | 120 |
| opus/rubric | sonnet/rubric | 70% | 120 |
| opus/rubric | sonnet/score | 48% | 120 |
| opus/rubric | haiku/plain | 55% | 120 |
| opus/rubric | haiku/rubric | 61% | 120 |
| opus/rubric | haiku/score | 44% | 120 |
| opus/score | sonnet/plain | 68% | 120 |
| opus/score | sonnet/rubric | 58% | 120 |
| opus/score | sonnet/score | 65% | 120 |
| opus/score | haiku/plain | 59% | 120 |
| opus/score | haiku/rubric | 45% | 120 |
| opus/score | haiku/score | 56% | 120 |
| sonnet/plain | sonnet/rubric | 73% | 120 |
| sonnet/plain | sonnet/score | 58% | 120 |
| sonnet/plain | haiku/plain | 72% | 120 |
| sonnet/plain | haiku/rubric | 59% | 120 |
| sonnet/plain | haiku/score | 47% | 120 |
| sonnet/rubric | sonnet/score | 57% | 120 |
| sonnet/rubric | haiku/plain | 63% | 120 |
| sonnet/rubric | haiku/rubric | 63% | 120 |
| sonnet/rubric | haiku/score | 48% | 120 |
| sonnet/score | haiku/plain | 61% | 120 |
| sonnet/score | haiku/rubric | 45% | 120 |
| sonnet/score | haiku/score | 52% | 120 |
| haiku/plain | haiku/rubric | 60% | 120 |
| haiku/plain | haiku/score | 52% | 120 |
| haiku/rubric | haiku/score | 42% | 120 |

## Position bias

Picks first = share of decisive verdicts that went to whichever answer was shown first (fair = 50%). Same both ways = share of pairs with the same verdict after swapping the order. Same, asked again = share with the same verdict when asked again in the same order - the models do not take a temperature, so this is how much changes by chance alone; the gap between the two is the order effect.

| Judge | Format | Picks first | p | Same both ways | Same, asked again | Flips |
| --- | --- | --- | --- | --- | --- | --- |
| opus | plain | 50% [48%, 53%] | 1.000 | 92% [87%, 96%] | 90% [80%, 98%] | 8% |
| opus | rubric | 46% [43%, 50%] | 0.295 | 86% [79%, 92%] | 78% [65%, 90%] | 13% |
| sonnet | plain | 47% [44%, 50%] | 0.462 | 86% [79%, 92%] | 90% [80%, 98%] | 9% |
| sonnet | rubric | 47% [44%, 50%] | 0.422 | 83% [76%, 89%] | 85% [73%, 95%] | 12% |
| haiku | plain | 47% [43%, 51%] | 0.372 | 77% [69%, 84%] | 85% [73%, 95%] | 15% |
| haiku | rubric | 50% [45%, 54%] | 1.000 | 75% [68%, 83%] | 70% [55%, 83%] | 20% |

## Length bias

One answer per pair padded to about twice the length with nothing new in it (median 1.7x; 0 of 20 spot-checked added content). Swing = change in preference towards the padded answer on a -2 to +2 scale (0 = no effect).

| Judge | Format | Swing to padded |
| --- | --- | --- |
| opus | plain | -0.89 [-1.07, -0.72] |
| opus | rubric | -0.85 [-1.00, -0.68] |
| opus | score | -0.83 [-0.97, -0.69] |
| sonnet | plain | -0.83 [-1.00, -0.67] |
| sonnet | rubric | -0.90 [-1.06, -0.75] |
| sonnet | score | -0.82 [-0.96, -0.69] |
| haiku | plain | -0.87 [-1.02, -0.72] |
| haiku | rubric | -0.81 [-0.96, -0.67] |
| haiku | score | -0.93 [-1.07, -0.80] |

## Self-preference

Bias = how much more the judge favours its own model's answers than neutral judges (whose model wrote neither answer) do on the same pairs (-2 to +2, 0 = none). Picks own when worse = on pairs where the human preferred the other answer, how often the judge still picked its own, vs how often neutral judges picked that same answer.

| Judge | Format | Bias | Picks own when worse | Neutral judges pick it | n |
| --- | --- | --- | --- | --- | --- |
| opus | plain | +0.26 [+0.13, +0.40] | 100% | 100% | 4 |
| opus | rubric | +0.23 [+0.06, +0.40] | 50% | 75% | 4 |
| opus | score | +0.25 [+0.10, +0.40] | 75% | 75% | 4 |
| sonnet | plain | -0.16 [-0.28, -0.04] | 9% | 18% | 11 |
| sonnet | rubric | -0.11 [-0.26, +0.04] | 27% | 9% | 11 |
| sonnet | score | +0.05 [-0.10, +0.23] | 9% | 36% | 11 |
| haiku | plain | +0.03 [-0.12, +0.18] | 39% | 39% | 33 |
| haiku | rubric | -0.04 [-0.21, +0.13] | 24% | 18% | 33 |
| haiku | score | -0.05 [-0.24, +0.14] | 36% | 30% | 33 |
