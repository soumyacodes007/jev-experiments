# PRISM Jev Evaluation

Generated: 2026-09-19T14:53:37.062Z

- Cases: 50
- Repeats: 1
- Profile: economy
- Model: jev-1.13.0
- Strict precision / recall / F1: 86.4% / 89.5% / 87.9%
- Relaxed precision / recall / F1: 93.2% / 96.5% / 94.8%
- Exact case passes: 44/50
- Exact masking rate: 88.0%
- API errors: 0
- Input tokens: 517314
- API calls: 98
- Estimated cost: $0.021727
- Latency p50 / p95 / p99: 788 / 2198 / 2892 ms

## Failures

| Case | Reason | FP | FN |
| --- | --- | ---: | ---: |
| identity_address | span mismatch | 1 | 1 |
| health_diagnosis | span mismatch | 1 | 1 |
| health_medication | span mismatch | 1 | 1 |
| health_procedure | span mismatch | 2 | 1 |
| health_medical_history | span mismatch | 2 | 1 |
| mixed_digital | span mismatch | 1 | 1 |
