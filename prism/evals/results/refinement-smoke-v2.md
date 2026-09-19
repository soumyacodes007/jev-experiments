# PRISM Jev Evaluation

Generated: 2026-09-19T15:00:41.292Z

- Cases: 6
- Repeats: 1
- Profile: economy
- Model: jev-1.13.0
- Strict precision / recall / F1: 62.5% / 62.5% / 62.5%
- Relaxed precision / recall / F1: 100.0% / 100.0% / 100.0%
- Exact case passes: 3/6
- Exact masking rate: 50.0%
- API errors: 0
- Input tokens: 79812
- API calls: 18
- Estimated cost: $0.003352
- Latency p50 / p95 / p99: 1413 / 2636 / 2636 ms

## Failures

| Case | Reason | FP | FN |
| --- | --- | ---: | ---: |
| health_diagnosis | span mismatch | 1 | 1 |
| health_medication | span mismatch | 1 | 1 |
| health_medical_history | span mismatch | 1 | 1 |
