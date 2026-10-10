# Phase 4: PA-Eval Metrics, Counterfactual Mutations & CI Gate

## Objectives
Build the statistical evaluation suite, programmatic adversarial perturbation engine, benchmark reporters, and CI regression gate.

## Deliverables

### 1. PA-Eval Metric Suite
- **Requirement Classification Accuracy:** Precision, Recall, F1, and Balanced Accuracy across `satisfied`, `not_satisfied`, and `insufficient_evidence`.
- **Evidence Grounding Precision & Recall:**
  - Citation Precision: $\frac{\text{Correctly Cited Resources}}{\text{Total Cited Resources}}$
  - Unsupported Citation Rate: Percentage of claims where cited resource ID does not exist or does not contain referenced clinical facts.
- **Missing Evidence Recall:**
  - Measures how reliably the engine flags `insufficient_evidence` when clinical data is missing, rather than inferring or hallucinating facts.
- **Path & Step-Level Scoring:**
  - Evaluates whether the engine selected the minimal necessary tier and followed valid reasoning steps.
- **Cost per Safe Resolution:**
  $$\text{Cost per Safe Resolution} = \frac{\sum \text{Total Inference Cost}}{\text{Count of Correct Non-Escalated Cases}}$$

### 2. Counterfactual Adversarial Mutation Engine
- Programmatically mutates synthetic FHIR records to test model sensitivity:
  - **Therapy Duration Mutation:** Shifts dates to reduce therapy period from 8 weeks to 3 weeks.
  - **Laterality Mismatch:** Modifies diagnosis to left knee when right knee MRI is requested.
  - **Temporal Expiry:** Shifts historical events beyond the policy's maximum lookback window.
  - **Clinical Negation:** Inverts symptom documentation (e.g., "denies radiculopathy").
- **Counterfactual Sensitivity Metric:** Verifies that changing a clinically relevant fact appropriately flips the model's recommendation.

### 3. Automated Benchmark Reporting
- CLI benchmark runner (`openpa benchmark` / `pnpm benchmark`).
- Outputs tabular terminal view, JSON summary, and formatted Markdown report.
- Plots cost-quality frontier comparing Rules vs. Jev vs. Small LLM vs. Frontier LLM vs. Tiered Architecture.

### 4. CI Evaluation Gate
- Headless Vitest action configured in GitHub Actions.
- Fails PR builds if:
  - Overall requirement accuracy drops below baseline.
  - Evidence Grounding Precision falls below 95%.
  - Any hallucinated citation is generated.
  - Cost per safe resolution exceeds threshold.

## Verification Gate
- Mutation engine successfully flips gold outcomes on 100% of mutation vectors.
- CI gate correctly fails when tested against a deliberately degraded mock evaluator.
