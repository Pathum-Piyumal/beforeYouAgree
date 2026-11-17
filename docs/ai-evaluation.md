# Synthetic extraction evaluation

Provider: deterministic mock provider.
These synthetic author-labelled cases are a regression check, not a representative legal corpus, independent annotation study, or hosted-model quality claim.

| Category | Precision | Recall | F1 |
| --- | ---: | ---: | ---: |
| financial | 1.000 | 1.000 | 1.000 |
| subscription | 1.000 | 1.000 | 1.000 |
| cancellation | 1.000 | 1.000 | 1.000 |
| refund | 1.000 | 1.000 | 1.000 |
| privacy | 1.000 | 1.000 | 1.000 |
| commitment | 1.000 | 1.000 | 1.000 |

Cases: 18; supported quotes: 8/8; median backend latency: 0.11 ms; estimated provider cost: USD 0.000000.

Quote support measures exact source occurrence, not semantic entailment. Date/amount accuracy, hallucination rates, production latency and user comprehension require a larger independently labelled evaluation.

| Case | Split | Expected categories | Predicted categories |
| --- | --- | --- | --- |
| sub-positive | regression | subscription | subscription |
| fee-positive | regression | financial | financial |
| cancel-positive | regression | cancellation | cancellation |
| refund-positive | regression | refund | refund |
| privacy-positive | regression | privacy | privacy |
| term-positive | regression | commitment | commitment |
| recipe-negative | challenge | none | none |
| sub-negative | challenge | none | none |
| fee-negative | challenge | none | none |
| privacy-negative | challenge | none | none |
| term-negative | challenge | none | none |
| refund-negative | challenge | none | none |
| sub-ambiguous | challenge | none | none |
| fee-ambiguous | challenge | none | none |
| date-ambiguous | challenge | none | none |
| injection | challenge | none | none |
| trial-positive | regression | subscription | subscription |
| refund-window | regression | refund | refund |
