# Phase 3: Tiered Evaluators, Guardrails & Execution Budgets

## Objectives
Implement model adapters, bounded decision classifiers (Jev), structured LLM evaluators, operational execution budgets, and citation guardrails.

## Deliverables

### 1. Unified Evaluator Interface
- `PolicyEvaluator` contract:
  ```typescript
  export interface PolicyEvaluator {
    readonly id: string;
    readonly tierLevel: number;
    evaluateRequirement(
      requirement: PolicyRequirement,
      context: EvaluationContext
    ): Promise<EvaluatorResult>;
  }
  ```
- Mock offline adapter for deterministic simulation in CI.

### 2. Bounded Decision Classifier Adapter (Jev)
- Implement adapter utilizing typed bounded decisions (choice, score, probability judgments) rather than freeform generation.
- Evaluates isolated clinical assertions (e.g., *"Does this clinical narrative document at least 6 weeks of conservative therapy?"*).
- Outputs typed verdict + calibrated confidence score.

### 3. Generative Model Adapters (Small & Frontier LLMs)
- Structured output adapters for OpenAI, Anthropic, and Gemini.
- Enforce strict JSON output matching `RequirementEvaluationSchema` with Zod validation.
- Exponential backoff retry handler (up to 2 retries on schema parse failure).
- Provider fallback circuit breaker (route to backup provider if 429/5xx received).

### 4. Operational Budget Caps
- Per-evaluation execution limits:
  - `budgetCapUsd`: Maximum dollar spend per case (default: $0.05 USD).
  - `maxTokensPerRun`: Maximum token usage budget.
  - `timeoutMs`: Hard execution timeout per requirement (default: 15 seconds).
- Exceeding any budget cleanly halts the pipeline and yields `requires_clinical_review` with a `budget_exceeded` status.

### 5. Tiered Cascade Orchestrator
- Ordered evaluation cascade:
  1. Tier 1: Deterministic rules (checks structured codes & dates).
  2. Tier 2: Bounded classifier (Jev) if structured data is absent but normalized notes exist (confidence threshold: 0.90).
  3. Tier 3: Small/distilled LLM for standard narrative extraction.
  4. Tier 4: Frontier reasoning LLM for complex multi-morbid narratives.
  5. Fallback: Human clinical escalation.
- Trace logger capturing step-level decisions, tokens, costs, and latencies (`StepTraceSchema`).

### 6. Citation Grounding Guardrail
- Post-evaluation verifier:
  - Confirms every cited `resourceId` exists in the input FHIR bundle.
  - Verifies cited snippets and timestamps match the underlying clinical record.
  - Ungrounded assertions or hallucinations immediately downgrade the assessment to `requires_clinical_review`.

## Verification Gate
- Mock cascade successfully routes through all 4 tiers and escalates to human review on injected uncertainty.
- Budget cap enforcement verified via synthetic test vector exceeding cost limit.
