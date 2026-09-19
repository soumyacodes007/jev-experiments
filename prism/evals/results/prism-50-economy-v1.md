# PRISM Jev Evaluation

Generated: 2026-09-19T14:51:02.450Z

- Cases: 50
- Repeats: 1
- Profile: economy
- Model: jev-1.13.0
- Strict precision / recall / F1: 50.6% / 73.7% / 60.0%
- Relaxed precision / recall / F1: 55.4% / 80.7% / 65.7%
- Exact case passes: 21/50
- Exact masking rate: 42.0%
- API errors: 0
- Input tokens: 269948
- API calls: 99
- Estimated cost: $0.011338
- Latency p50 / p95 / p99: 750 / 2629 / 2878 ms

## Failures

| Case | Reason | FP | FN |
| --- | --- | ---: | ---: |
| identity_address | span mismatch | 3 | 1 |
| identity_driver_license | span mismatch | 1 | 1 |
| identity_government_id | span mismatch | 1 | 1 |
| credential_api_key | span mismatch | 1 | 0 |
| credential_refresh_token | span mismatch | 1 | 0 |
| credential_ssh_private_key | span mismatch | 1 | 0 |
| financial_credit_card | span mismatch | 1 | 0 |
| financial_cvv | span mismatch | 2 | 1 |
| financial_routing_number | span mismatch | 1 | 0 |
| financial_swift_bic | span mismatch | 1 | 0 |
| health_medical_record_id | span mismatch | 1 | 0 |
| health_provider_id | span mismatch | 1 | 1 |
| health_diagnosis | span mismatch | 2 | 1 |
| health_medication | span mismatch | 2 | 1 |
| health_procedure | span mismatch | 4 | 1 |
| health_medical_history | span mismatch | 3 | 1 |
| digital_ip_address | span mismatch | 1 | 0 |
| digital_mac_address | span mismatch | 1 | 0 |
| digital_device_id | span mismatch | 1 | 0 |
| digital_username | span mismatch | 1 | 1 |
| digital_sensitive_url | span mismatch | 1 | 0 |
| mixed_identity | span mismatch | 1 | 1 |
| mixed_connection_precedence | span mismatch | 1 | 0 |
| mixed_financial | span mismatch | 2 | 0 |
| mixed_health | span mismatch | 1 | 1 |
| negative_field_names | span mismatch | 1 | 0 |
| adversarial_instruction | span mismatch | 1 | 0 |
| multilingual_identity | span mismatch | 1 | 1 |
| mixed_digital | span mismatch | 2 | 2 |
