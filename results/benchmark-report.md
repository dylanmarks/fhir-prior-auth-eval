# OpenPA Eval Benchmark Report

**Execution Timestamp:** `2026-10-19T18:55:35.620Z`  
**Dataset Version:** `openpa-benchmark-v1.0`  
**Evaluation Mode:** `offline_deterministic`  
**Evaluator Configuration:** `Deterministic Rules Engine (Tier 1)`  
**Total Evaluated Cases:** `10`  

## 1. Executive Summary & KPIs

| Metric | Measured Result | CI Target Threshold |
| :--- | :--- | :--- |
| **Disposition Accuracy** | **100.0%** | $\ge 95.0\%$ |
| **Mean Requirement Accuracy** | **100.0%** | $\ge 95.0\%$ |
| **Balanced Requirement Accuracy** | **100.0%** | $\ge 90.0\%$ |
| **Macro Requirement F1** | **100.0%** | $\ge 90.0\%$ |
| **Mean Grounding Precision** | **100.0%** | $\ge 95.0\%$ |
| **Total Unsupported Citations** | **0** | **0 (Zero Tolerance)** |
| **Missing Evidence Recall** | **100.0%** | $\ge 85.0\%$ |
| **Counterfactual Sensitivity** | **100.0%** | $\ge 90.0\%$ |
| **Mean Cost Per Case** | **$0.0000 USD** | $\le \$0.05$ |
| **Cost per Safe Resolution** | **$0.0000 USD** | $\le \$0.05$ |
| **Mean Latency per Case** | **1 ms** | $\le 200\text{ ms}$ |

## 2. Case-by-Case Breakdown

| Case ID | Expected | Predicted | Status | Req Acc | Grounding | Unsupported | Cost | Latency |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `case-cgm-001-meets` | `meets_policy` | `meets_policy` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 2ms |
| `case-knee-001-meets` | `meets_policy` | `meets_policy` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 1ms |
| `case-knee-002-deficient` | `needs_information` | `needs_information` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 0ms |
| `case-knee-003-laterality` | `needs_information` | `needs_information` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 0ms |
| `case-lumbar-001-meets` | `meets_policy` | `meets_policy` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 1ms |
| `case-lumbar-002-deficient` | `needs_information` | `needs_information` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 0ms |
| `case-lumbar-003-conflicting` | `requires_clinical_review` | `requires_clinical_review` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 0ms |
| `case-pt-001-meets` | `meets_policy` | `meets_policy` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 0ms |
| `case-pt-002-plateau` | `needs_information` | `needs_information` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 0ms |
| `case-sleep-001-meets` | `meets_policy` | `meets_policy` | ✅ PASS | 100% | 100% | 0 | $0.0000 | 1ms |

## 3. Counterfactual Sensitivity (Adversarial Robustness)

*Sensitivity evaluates whether perturbing a clinically determinative fact correctly flips a baseline compliant case into a non-compliant or escalated state.*

Summary: 15 / 15 applicable vectors flipped (100.0%). Inapplicable/no-op: 15, Baseline deficient: 30.

| Case ID | Mutation Vector | Baseline | Mutated Result | Target Requirement | Vector Outcome |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `case-cgm-001-meets` | `shorten_therapy_duration` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-cgm-001-meets` | `diagnosis_non_indicated` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-cgm-001-meets` | `temporal_expiry` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-cgm-001-meets` | `clinical_negation` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-cgm-001-meets` | `laterality_mismatch` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-cgm-001-meets` | `remove_supporting_evidence` | `meets_policy` | `needs_information` | `req-diabetes-diagnosis` | ✅ PASS (FLIPPED) |
| `case-knee-001-meets` | `shorten_therapy_duration` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-knee-001-meets` | `diagnosis_non_indicated` | `meets_policy` | `needs_information` | `req-knee-condition` | ✅ PASS (FLIPPED) |
| `case-knee-001-meets` | `temporal_expiry` | `meets_policy` | `needs_information` | `req-plain-radiograph` | ✅ PASS (FLIPPED) |
| `case-knee-001-meets` | `clinical_negation` | `meets_policy` | `requires_clinical_review` | `req-knee-condition` | ✅ PASS (FLIPPED) |
| `case-knee-001-meets` | `laterality_mismatch` | `meets_policy` | `needs_information` | `req-plain-radiograph` | ✅ PASS (FLIPPED) |
| `case-knee-001-meets` | `remove_supporting_evidence` | `meets_policy` | `needs_information` | `req-knee-condition` | ✅ PASS (FLIPPED) |
| `case-knee-002-deficient` | `shorten_therapy_duration` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-002-deficient` | `diagnosis_non_indicated` | `needs_information` | `needs_information` | `req-knee-condition` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-002-deficient` | `temporal_expiry` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-002-deficient` | `clinical_negation` | `needs_information` | `needs_information` | `req-knee-condition` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-002-deficient` | `laterality_mismatch` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-002-deficient` | `remove_supporting_evidence` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-003-laterality` | `shorten_therapy_duration` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-003-laterality` | `diagnosis_non_indicated` | `needs_information` | `needs_information` | `req-knee-condition` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-003-laterality` | `temporal_expiry` | `needs_information` | `needs_information` | `req-plain-radiograph` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-003-laterality` | `clinical_negation` | `needs_information` | `needs_information` | `req-knee-condition` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-003-laterality` | `laterality_mismatch` | `needs_information` | `needs_information` | `req-plain-radiograph` | ⚪ SKIPPED (baseline deficient) |
| `case-knee-003-laterality` | `remove_supporting_evidence` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-001-meets` | `shorten_therapy_duration` | `meets_policy` | `needs_information` | `req-conservative-therapy` | ✅ PASS (FLIPPED) |
| `case-lumbar-001-meets` | `diagnosis_non_indicated` | `meets_policy` | `needs_information` | `req-radiculopathy` | ✅ PASS (FLIPPED) |
| `case-lumbar-001-meets` | `temporal_expiry` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-lumbar-001-meets` | `clinical_negation` | `meets_policy` | `requires_clinical_review` | `req-radiculopathy` | ✅ PASS (FLIPPED) |
| `case-lumbar-001-meets` | `laterality_mismatch` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-lumbar-001-meets` | `remove_supporting_evidence` | `meets_policy` | `needs_information` | `req-radiculopathy` | ✅ PASS (FLIPPED) |
| `case-lumbar-002-deficient` | `shorten_therapy_duration` | `needs_information` | `needs_information` | `req-conservative-therapy` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-002-deficient` | `diagnosis_non_indicated` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-002-deficient` | `temporal_expiry` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-002-deficient` | `clinical_negation` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-002-deficient` | `laterality_mismatch` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-002-deficient` | `remove_supporting_evidence` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-003-conflicting` | `shorten_therapy_duration` | `requires_clinical_review` | `requires_clinical_review` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-003-conflicting` | `diagnosis_non_indicated` | `requires_clinical_review` | `requires_clinical_review` | `req-radiculopathy` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-003-conflicting` | `temporal_expiry` | `requires_clinical_review` | `requires_clinical_review` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-003-conflicting` | `clinical_negation` | `requires_clinical_review` | `requires_clinical_review` | `req-radiculopathy` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-003-conflicting` | `laterality_mismatch` | `requires_clinical_review` | `requires_clinical_review` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-lumbar-003-conflicting` | `remove_supporting_evidence` | `requires_clinical_review` | `requires_clinical_review` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-pt-001-meets` | `shorten_therapy_duration` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-pt-001-meets` | `diagnosis_non_indicated` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-pt-001-meets` | `temporal_expiry` | `meets_policy` | `needs_information` | `req-pt-progress` | ✅ PASS (FLIPPED) |
| `case-pt-001-meets` | `clinical_negation` | `meets_policy` | `requires_clinical_review` | `req-pt-progress` | ✅ PASS (FLIPPED) |
| `case-pt-001-meets` | `laterality_mismatch` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-pt-001-meets` | `remove_supporting_evidence` | `meets_policy` | `needs_information` | `req-functional-deficit` | ✅ PASS (FLIPPED) |
| `case-pt-002-plateau` | `shorten_therapy_duration` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-pt-002-plateau` | `diagnosis_non_indicated` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-pt-002-plateau` | `temporal_expiry` | `needs_information` | `needs_information` | `req-pt-progress` | ⚪ SKIPPED (baseline deficient) |
| `case-pt-002-plateau` | `clinical_negation` | `needs_information` | `needs_information` | `req-pt-progress` | ⚪ SKIPPED (baseline deficient) |
| `case-pt-002-plateau` | `laterality_mismatch` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-pt-002-plateau` | `remove_supporting_evidence` | `needs_information` | `needs_information` | `N/A` | ⚪ SKIPPED (baseline deficient) |
| `case-sleep-001-meets` | `shorten_therapy_duration` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-sleep-001-meets` | `diagnosis_non_indicated` | `meets_policy` | `needs_information` | `req-suspected-osa` | ✅ PASS (FLIPPED) |
| `case-sleep-001-meets` | `temporal_expiry` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-sleep-001-meets` | `clinical_negation` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-sleep-001-meets` | `laterality_mismatch` | `meets_policy` | `meets_policy` | `N/A` | ⚪ SKIPPED (inapplicable/no-op) |
| `case-sleep-001-meets` | `remove_supporting_evidence` | `meets_policy` | `needs_information` | `req-suspected-osa` | ✅ PASS (FLIPPED) |

---
*Generated by fhir-prior-auth-eval benchmark runner. Evaluates clinical evidence verification for prior authorization workflows.*
