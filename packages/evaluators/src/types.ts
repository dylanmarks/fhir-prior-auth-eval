import type {
  PolicyRequirement,
  PriorAuthCase,
  RequirementStatus,
  EvidenceCitation,
  FhirBundleIndexer,
} from '@openpa/core';

export interface EvaluatorContext {
  caseData: Omit<PriorAuthCase, 'expectedAssessment'>;
  indexer: FhirBundleIndexer;
  signal?: AbortSignal;
}

export interface EvaluatorMetrics {
  costUsd: number;
  costVerified?: boolean;
  billingSource?: 'chatgpt-plan';
  reasoningEffort?: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  providerModel?: string;
}

export interface EvaluatorResult {
  status: RequirementStatus;
  confidence: number;
  modelCertainty?: number;
  evidence: EvidenceCitation[];
  notes?: string;
  metrics: EvaluatorMetrics;
  contradictionDetected?: boolean;
  escalateToClinicalReview?: boolean;
  escalationReason?: string;
}

export interface PolicyEvaluator {
  readonly billingSource?: 'chatgpt-plan';
  readonly id: string;
  readonly name: string;
  readonly tierLevel: number;
  /** Upper bound for admission control. Live adapters must declare one. */
  readonly maxCostUsd?: number;
  readonly maxTokens?: number;
  evaluateRequirement(
    requirement: PolicyRequirement,
    context: EvaluatorContext
  ): Promise<EvaluatorResult>;
}
