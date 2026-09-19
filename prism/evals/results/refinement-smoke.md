# PRISM Jev Evaluation

Generated: 2026-09-19T14:58:58.036Z

- Cases: 6
- Repeats: 1
- Profile: economy
- Model: jev-1.13.0
- Strict precision / recall / F1: 50.0% / 50.0% / 50.0%
- Relaxed precision / recall / F1: 87.5% / 87.5% / 87.5%
- Exact case passes: 2/6
- Exact masking rate: 33.3%
- API errors: 0
- Input tokens: 105269
- API calls: 18
- Estimated cost: $0.004421
- Latency p50 / p95 / p99: 1242 / 3514 / 3514 ms

## Failures

| Case | Reason | FP | FN |
| --- | --- | ---: | ---: |
| identity_address | span mismatch | 1 | 1 |
| health_medication | span mismatch | 1 | 1 |
| health_medical_history | span mismatch | 1 | 1 |
| mixed_digital | span mismatch | 1 | 1 |
