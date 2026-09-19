# PRISM Jev Evaluation

Generated: 2026-09-19T15:01:58.765Z

- Cases: 6
- Repeats: 3
- Profile: economy
- Model: jev-1.13.0
- Strict precision / recall / F1: 87.5% / 87.5% / 87.5%
- Relaxed precision / recall / F1: 100.0% / 100.0% / 100.0%
- Exact case passes: 15/18
- Exact masking rate: 83.3%
- API errors: 0
- Input tokens: 240177
- API calls: 54
- Estimated cost: $0.010087
- Latency p50 / p95 / p99: 1418 / 4479 / 4479 ms

## Failures

| Case | Reason | FP | FN |
| --- | --- | ---: | ---: |
| health_medical_history | span mismatch | 1 | 1 |
| health_medical_history | span mismatch | 1 | 1 |
| health_medical_history | span mismatch | 1 | 1 |
