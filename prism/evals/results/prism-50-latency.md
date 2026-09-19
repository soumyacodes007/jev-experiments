# PRISM Jev Evaluation

Generated: 2026-09-19T15:08:20.785Z

- Cases: 50
- Repeats: 1
- Profile: latency
- Model: jev-1.13.0
- Strict precision / recall / F1: 88.3% / 93.0% / 90.6%
- Relaxed precision / recall / F1: 91.7% / 96.5% / 94.0%
- Exact case passes: 46/50
- Exact masking rate: 92.0%
- API errors: 0
- Input tokens: 1337521
- API calls: 50
- Estimated cost: $0.056176
- Latency p50 / p95 / p99: 776 / 3382 / 4199 ms

## Failures

| Case | Reason | FP | FN |
| --- | --- | ---: | ---: |
| identity_address | span mismatch | 2 | 1 |
| health_procedure | span mismatch | 2 | 1 |
| health_medical_history | span mismatch | 2 | 1 |
| mixed_digital | span mismatch | 1 | 1 |
