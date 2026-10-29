import type { MedicalPolicy, UnlabeledPriorAuthCase, RetrievalResult, RequirementStatus, GapKind, NextActionType, EvidenceWorkflowResult } from '@openpa/core';
import type { EvaluatorResult, PolicyEvaluator, ExperimentArmId } from '@openpa/evaluators';
import type { ScenarioFixture, GoldSidecar } from '../retrieval/types.js';

export const STRATEGIES = ['rules', 'cheap', 'tiered', 'llm'] as const;
export type Strategy = typeof STRATEGIES[number];
export const ACCESS = ['submitted_only', 'retrieval', 'full_corpus'] as const;
export type Adequacy = 'sufficient_support' | 'documented_nonfulfillment' | 'insufficient' | 'unresolved_conflict';
export interface CriterionLabel {
  adequacy: Adequacy;
  status: RequirementStatus;
  acceptableEvidenceSets: string[][];
  conflictIds: string[];
  allowedCitationIds: string[];
  gap: GapKind;
  action: NextActionType;
}
export interface SufficiencyFixture {
  runtime: ScenarioFixture;
  policy: MedicalPolicy;
  family: string;
  variant: string;
  cohort: 'development' | 'challenge' | 'regression' | 'negative_control';
  targetRequirementIds: string[];
  labels: Record<ExperimentArmId, Record<string, CriterionLabel>>;
  phase6Gold?: GoldSidecar;
}
export interface EvidenceSnapshot {
  id: string;
  fixtureId: string;
  access: ExperimentArmId;
  replicate: number;
  input: UnlabeledPriorAuthCase;
  policy: MedicalPolicy;
  policyHash: string;
  evidenceHash: string;
  contentHash: string;
  retrieval: RetrievalResult;
  retrievalMs: number;
  providerScopeFields: string[];
}
export type AcquisitionOutcome = 'acquired' | 'unavailable' | 'budget_exhausted' | 'provider_error' | 'cancelled' | 'input_rejected';
export interface Recording {
  id: string;
  key: string;
  replicate: number;
  evaluatorKey: string;
  requestedModel: string;
  resolvedModel?: string;
  requirementId: string;
  snapshotHash: string;
  providerInputHash: string;
  origin: 'policy' | 'direct_probe';
  outcome: AcquisitionOutcome;
  result?: EvaluatorResult;
  reason?: string;
  actualCall: boolean;
  usageVerified: boolean;
  costVerified: boolean;
  knownCostUsd: number;
  tokens: number;
}
export interface EvaluatorBinding {
  key: string;
  evaluator: PolicyEvaluator;
  configured: boolean;
  provider: boolean;
  configuration: Record<string, unknown>;
}
export interface TierObservation {
  snapshotId: string;
  snapshotHash: string;
  replicate: number;
  requirementId: string;
  tier: number;
  evaluatorKey: string;
  recordingId: string | null;
  outcome: AcquisitionOutcome;
  threshold: number;
  guardVerdict: 'accepted' | 'deferred' | 'blocked' | 'unacquired';
  guardReason: string;
}
export interface CellScore {
  rawResolved: boolean;
  workflowResolved: boolean;
  rawSafe: boolean;
  workflowSafe: boolean;
  falseClearance: boolean;
  unsupportedCitations: number;
  hiddenConflicts: number;
  wrongPatientLeakage: number;
  gapAction: {numerator: number; denominator: number; rate: number | null};
  requirementCorrect: number;
  requirementCount: number;
}
export interface PolicyReplay {
  snapshotId: string;
  fixtureId: string;
  replicate: number;
  family: string;
  variant: string;
  cohort: SufficiencyFixture['cohort'];
  strategy: Strategy;
  threshold: number;
  availability: 'available' | 'partial' | 'unavailable';
  observations: TierObservation[];
  result: EvidenceWorkflowResult;
  completenessOverride: boolean;
  score: CellScore;
  phase6Score?: unknown;
  policyCostUsd: number | null;
  policyKnownCostUsd: number;
  policyAdapterLatencySumMs: number;
  latencyBasis: string;
}
