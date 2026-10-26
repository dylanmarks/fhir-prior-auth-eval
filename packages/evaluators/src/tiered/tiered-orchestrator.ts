import type { PriorAuthCase, UnlabeledPriorAuthCase, MedicalPolicy, AssessmentResult, RequirementEvaluation, StepTrace } from "@openpa/core";
import { FhirBundleIndexer, RequirementEvaluationSchema, sanitizeFhirBundle } from "@openpa/core";
import type { PolicyEvaluator, EvaluatorContext, EvaluatorResult } from "../types.js";
import { GroundingGuardrail } from "../guardrails/grounding-guard.js";

export interface TieredOrchestratorOptions {
  budgetCapUsd?: number;
  maxTokensPerRun?: number;
  timeoutMs?: number;
  minConfidenceThreshold?: number;
  tierConfidenceThresholds?: Record<number, number>;
  signal?: AbortSignal;
  onStep?: (step: StepTrace) => void;
}

export class TieredOrchestrator {
  private readonly evaluators: PolicyEvaluator[];
  private readonly options: Required<Omit<TieredOrchestratorOptions, "onStep" | "signal">> & Pick<TieredOrchestratorOptions, "onStep" | "signal">;

  constructor(evaluators: PolicyEvaluator[], options: TieredOrchestratorOptions = {}) {
    this.evaluators = [...evaluators].sort((a, b) => a.tierLevel - b.tierLevel);
    this.options = {
      budgetCapUsd: 0.05,
      maxTokensPerRun: 10000,
      timeoutMs: 15000,
      minConfidenceThreshold: 0.9,
      tierConfidenceThresholds: {},
      ...options,
    };

    for (const key of ["budgetCapUsd", "maxTokensPerRun", "timeoutMs", "minConfidenceThreshold"] as const) {
      if (!Number.isFinite(this.options[key]) || this.options[key] < 0) {
        throw new Error(`Invalid configuration: ${key} must be a non-negative finite number`);
      }
    }
    if (this.options.timeoutMs === 0 || this.options.minConfidenceThreshold > 1) {
      throw new Error("Invalid execution limits: timeoutMs must be > 0 and minConfidenceThreshold <= 1");
    }
    if (Object.values(this.options.tierConfidenceThresholds).some(v => !Number.isFinite(v) || v < 0 || v > 1)) {
      throw new Error('Tier confidence thresholds must be between 0 and 1.');
    }
  }

  async evaluateCase(priorAuthCase: PriorAuthCase | UnlabeledPriorAuthCase, policy: MedicalPolicy): Promise<AssessmentResult> {
    if (priorAuthCase.policyId !== policy.id || !policy.serviceCodes.includes(priorAuthCase.requestedService.code)) {
      throw new Error(
        `Case policy (${priorAuthCase.policyId}) or service code (${priorAuthCase.requestedService.code}) does not match policy ${policy.id}`
      );
    }

    if (!policy.requirements.length || new Set(policy.requirements.map(r => r.id)).size !== policy.requirements.length) {
      throw new Error("Policy must contain at least one requirement with unique IDs");
    }

    const started = performance.now();
    const { expectedAssessment: _gold, ...inputCase } = priorAuthCase as Partial<PriorAuthCase> & UnlabeledPriorAuthCase;
    const safeCase = {
      ...inputCase,
      patientBundle: sanitizeFhirBundle(inputCase.patientBundle),
      requestedService: { ...inputCase.requestedService, orderingProvider: undefined },
    };

    const indexer = new FhirBundleIndexer(safeCase.patientBundle);
    if (indexer.integrityIssues.length) {
      return {
        caseId: priorAuthCase.id, policyId: policy.id, disposition: 'requires_clinical_review',
        requirements: policy.requirements.map(req => ({requirementId: req.id, status: 'insufficient_evidence', confidence: 0, evidence: [], evaluatorNotes: indexer.integrityIssues.join('; ')})),
        missingInformation: policy.requirements.filter(r => r.required).map(r => `${r.id}: ${r.description}`),
        executionTrace: [{stepNumber: 1, tierLevel: 0, tierName: 'FHIR integrity check', model: 'input-validation', action: 'validate_bundle', decision: indexer.integrityIssues.join('; '), confidence: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, status: 'escalated'}],
        totalCostUsd: 0, totalTokens: 0, totalLatencyMs: Math.round(performance.now() - started),
      };
    }
    const context: EvaluatorContext = { caseData: safeCase, indexer };
    const requirements: RequirementEvaluation[] = [];
    const executionTrace: StepTrace[] = [];

    let totalCostUsd = 0;
    let totalTokens = 0;
    let usageVerified = true;
    let costVerified = true;
    let halted = false;
    let safetyFailure = false;
    const acceptedIds = new Set<string>();

    const emit = (step: Omit<StepTrace, "stepNumber">) => {
      const event: StepTrace = {
        ...step,
        stepNumber: executionTrace.length + 1,
        latencyMs: Math.max(0, Math.round(step.latencyMs)),
        costUsd: Number(step.costUsd.toFixed(6)),
      };
      executionTrace.push(event);
      this.options.onStep?.(event);
    };

    for (const req of policy.requirements) {
      let resolved: RequirementEvaluation | undefined;

      for (const evaluator of this.evaluators) {
        if (halted || safetyFailure) break;

        const base = {
          tierLevel: evaluator.tierLevel,
          tierName: evaluator.name,
          model: evaluator.id,
          requirementId: req.id,
          action: "evaluate_requirement",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          latencyMs: 0,
          confidence: 0,
        };

        // 1. Pre-dispatch Admission Control: check reserved cost and tokens
        const maxCost = evaluator.maxCostUsd ?? 0;
        const maxTok = evaluator.maxTokens ?? 0;
        if (totalCostUsd + maxCost > this.options.budgetCapUsd || totalTokens + maxTok > this.options.maxTokensPerRun) {
          halted = true;
          emit({
            ...base,
            decision: "Execution budget exhausted prior to evaluator dispatch (admission control). Update your configuration to increase case budget (CASE_BUDGET_USD).",
            status: "budget_exceeded",
          });
          break;
        }

        // 2. Dispatch with timeout and cancellation
        const controller = new AbortController();
        const cancel = () => controller.abort();
        this.options.signal?.addEventListener('abort', cancel, {once: true});
        if (this.options.signal?.aborted) controller.abort();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const stepStart = performance.now();
        let res: EvaluatorResult;

        try {
          res = await Promise.race([
            evaluator.evaluateRequirement(req, { ...context, signal: controller.signal }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => {
                controller.abort();
                reject(
                  new Error(
                    "Requirement timeout exceeded. (Note: Cancelling HTTP request does not guarantee upstream provider halted billing)."
                  )
                );
              }, this.options.timeoutMs);
            }),
          ]);

          const metrics = res.metrics;
          if (metrics.costVerified === false) costVerified = false;
          if (
            ![metrics.costUsd, metrics.latencyMs, metrics.inputTokens, metrics.outputTokens].every(
              n => Number.isFinite(n) && n >= 0
            )
          ) {
            throw new Error("Invalid evaluator usage metrics: values must be non-negative finite numbers");
          }

          totalCostUsd += metrics.costUsd;
          totalTokens += metrics.inputTokens + metrics.outputTokens;

          const parsed = RequirementEvaluationSchema.parse({
            requirementId: req.id,
            status: res.status,
            confidence: res.confidence,
            evidence: res.evidence,
            evaluatorNotes: res.notes,
            contradictionDetected: res.contradictionDetected,
            escalationReason: res.escalationReason,
          });

          // 3. Post-call budget overrun check
          if (totalCostUsd > this.options.budgetCapUsd || totalTokens > this.options.maxTokensPerRun) {
            halted = true;
            emit({
              ...base,
              ...metrics,
              decision: "Cumulative usage exceeded execution budget cap after call execution. Update your configuration to increase case budget (CASE_BUDGET_USD).",
              status: "budget_exceeded",
            });
            break;
          }

          // 4. Clinical contradiction or explicit escalation check (CANNOT be overridden by later tiers)
          if (res.contradictionDetected || res.escalateToClinicalReview || parsed.contradictionDetected) {
            safetyFailure = true;
            emit({
              ...base,
              ...metrics,
              confidence: parsed.confidence,
              modelCertainty: res.modelCertainty,
              decision: res.notes ?? `Clinical contradiction or negation detected (${res.escalationReason ?? 'conflict'}); escalating to clinical review`,
              status: "escalated",
            });
            resolved = parsed;
            // Stop cascade for this requirement immediately
            break;
          }

          // 5. Grounding and Evidence Verification Guardrail
          if ((parsed.status === 'satisfied' || parsed.status === 'not_satisfied') && parsed.evidence.length === 0) {
            safetyFailure = true;
            emit({
              ...base,
              ...metrics,
              confidence: 0,
              decision: 'Evaluator asserted a definitive judgment without evidence citations',
              status: "escalated",
            });
            resolved = {
              requirementId: req.id,
              status: "insufficient_evidence",
              confidence: 0,
              evidence: [],
              evaluatorNotes: 'Evaluator asserted a definitive judgment without evidence citations.',
            };
            break;
          }

          if (parsed.evidence.length > 0) {
            const grounding = GroundingGuardrail.verifyCitations(parsed.evidence, indexer);
            if (!grounding.isValid) {
              safetyFailure = true;
              const reasons = grounding.ungroundedCitations.map(u => u.reason).join("; ");
              emit({
                ...base,
                ...metrics,
                confidence: 0,
                decision: `Hallucinated or ungrounded citation detected: ${reasons}`,
                status: "escalated",
              });
              resolved = {
                requirementId: req.id,
                status: "insufficient_evidence",
                confidence: 0,
                evidence: parsed.evidence,
                evaluatorNotes: `Hallucinated or ungrounded citation detected: ${reasons}`,
              };
              break;
            }
          }

          // 6. Tier Acceptance or Cascade Fallback
          const threshold = this.options.tierConfidenceThresholds[evaluator.tierLevel] ?? this.options.minConfidenceThreshold;
          const accepted = parsed.confidence >= threshold && parsed.status !== 'not_applicable';

          emit({
            ...base,
            ...metrics,
            confidence: parsed.confidence,
            modelCertainty: res.modelCertainty ?? parsed.confidence,
            decision: parsed.evaluatorNotes ?? `Status: ${parsed.status}`,
            status: accepted ? "success" : "fallback",
          });

          if (accepted) {
            resolved = parsed;
            acceptedIds.add(req.id);
            break;
          }
        } catch (error) {
          if ((error as any)?.usageVerified === false || controller.signal.aborted) usageVerified = false;
          const errMetrics = (error as any)?.metrics;
          if (errMetrics?.costVerified === false) costVerified = false;
          if (errMetrics) {
            totalCostUsd += errMetrics.costUsd || 0;
            totalTokens += (errMetrics.inputTokens || 0) + (errMetrics.outputTokens || 0);
          }
          emit({
            ...base,
            latencyMs: performance.now() - stepStart,
            costUsd: errMetrics?.costUsd || 0,
            inputTokens: errMetrics?.inputTokens || 0,
            outputTokens: errMetrics?.outputTokens || 0,
            billingSource: errMetrics?.billingSource,
            costVerified: errMetrics?.costVerified,
            reasoningEffort: errMetrics?.reasoningEffort,
            decision: error instanceof Error ? error.message : "Evaluator execution error",
            status: "failed",
          });
          // If cancelled by caller, halt execution
          if (this.options.signal?.aborted) {
            safetyFailure = true;
            halted = true;
            break;
          }
          // If execution budget exceeded, halt cascade
          if (totalCostUsd > this.options.budgetCapUsd || totalTokens > this.options.maxTokensPerRun) {
            halted = true;
            break;
          }
          // Allow cascade to escalate to downstream tiers (e.g. SLM failure falls through to Frontier LLM)
          continue;
        } finally {
          if (timer) clearTimeout(timer);
          this.options.signal?.removeEventListener('abort', cancel);
        }
      }

      requirements.push(
        resolved ?? {
          requirementId: req.id,
          status: "insufficient_evidence",
          confidence: 0,
          evidence: [],
          evaluatorNotes: "Unresolved criterion across configured tiers; requires clinical review.",
        }
      );
    }

    const required = requirements.filter(
      r => policy.requirements.find(req => req.id === r.requirementId)?.required ?? true
    );

    let disposition: AssessmentResult["disposition"];
    if (
      halted ||
      safetyFailure ||
      required.some(r => r.contradictionDetected || !acceptedIds.has(r.requirementId))
    ) {
      disposition = "requires_clinical_review";
    } else if (required.some(r => r.status !== "satisfied")) {
      disposition = "needs_information";
    } else {
      disposition = "meets_policy";
    }

    const missingInformation = required
      .filter(r => r.status === "insufficient_evidence" || r.status === "not_satisfied")
      .map(r => `${r.requirementId}: ${policy.requirements.find(req => req.id === r.requirementId)?.description ?? ''}`);

    return {
      caseId: priorAuthCase.id,
      policyId: policy.id,
      disposition,
      requirements,
      missingInformation,
      executionTrace,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      totalTokens,
      usageVerified,
      costVerified,
      totalLatencyMs: Math.max(0, Math.round(performance.now() - started)),
    };
  }
}
