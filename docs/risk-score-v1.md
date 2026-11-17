# Risk score v1

The versioned implementation is `backend/app/risk/engine.py` (`risk-v1`).
It is a transparent heuristic, not a calibrated probability, legal opinion,
or guarantee that an agreement is safe.

| Category | Weight |
| --- | ---: |
| Financial | 0.25 |
| Subscription | 0.20 |
| Cancellation | 0.20 |
| Refund | 0.10 |
| Privacy | 0.15 |
| Commitment | 0.10 |

Severity maps low/moderate/high/critical to 25/50/75/100. Findings below internal
confidence 0.6 do not contribute. Matching normalized evidence in the same
source section is deduplicated across categories by the largest weighted
impact, with deterministic tie-breaking. A category uses the maximum severity
of its selected findings, rather than summing repeated clauses.

Only categories with validated contributing findings are assessed. Weights are
renormalized across those assessed categories. The overall score is their
rounded weighted sum; empty evidence produces an unavailable score. Partial
category coverage is always disclosed. Complete coverage requires all six
categories to have evidence. No finding never implies zero risk.

Bands are 0–25 low, 26–50 moderate, 51–75 high and 76–100 very high. Tests cover
these boundaries, invalid values, absent evidence and duplicate clauses. Weights,
confidence and severities have not been calibrated against a representative
independently labelled corpus; any future change requires a new version and
re-evaluation. Scores in saved snapshots retain their original version.
