import type { PriorAuthCase, MedicalPolicy } from '@openpa/core';
import type { TieredOrchestrator } from '@openpa/evaluators';
import { CounterfactualMutator, type MutationType, type MutationApplicationResult } from './mutator.js';

export interface MutationTestResult {
  caseId: string;
  mutationType: MutationType;
  baselineCorrect: boolean;
  baselineDisposition: string;
  mutatedDisposition: string;
  expectedMutatedDisposition: string;
  targetRequirementId: string;
  mutatedRequirementStatus: string;
  expectedRequirementStatus: string;
  flippedCorrectly: boolean;
  status: 'passed' | 'failed' | 'skipped_baseline_deficient' | 'skipped_inapplicable_noop';
  explanation: string;
}

export interface SensitivityReport {
  totalMutationsEvaluated: number;
  totalCorrectlyFlipped: number;
  totalSkippedBaselineDeficient: number;
  totalSkippedInapplicable: number;
  counterfactualSensitivity: number; // Ratio in [0, 1] for applicable vectors
  results: MutationTestResult[];
}

export class CounterfactualSensitivityTester {
  private orchestrator: TieredOrchestrator;

  constructor(orchestrator: TieredOrchestrator) {
    this.orchestrator = orchestrator;
  }

  public async testMutation(
    originalCase: PriorAuthCase,
    policy: MedicalPolicy,
    mutationType: MutationType
  ): Promise<MutationTestResult> {
    // 1. Evaluate baseline case
    const baselineAssessment = await this.orchestrator.evaluateCase(originalCase, policy);
    const baselineMatchesExpected = baselineAssessment.disposition === originalCase.expectedAssessment.disposition;
    const isBaselineMeets = baselineAssessment.disposition === 'meets_policy';

    // 2. Prepare mutation
    const mutResult: MutationApplicationResult = CounterfactualMutator.applyMutation(originalCase, mutationType, baselineAssessment);

    // If expected baseline was 'meets_policy' but actual baseline did NOT meet policy,
    // this is a baseline accuracy regression and must be flagged as a failure, not silently skipped!
    if (originalCase.expectedAssessment.disposition === 'meets_policy' && !isBaselineMeets) {
      return {
        caseId: originalCase.id,
        mutationType,
        baselineCorrect: false,
        baselineDisposition: baselineAssessment.disposition,
        mutatedDisposition: baselineAssessment.disposition,
        expectedMutatedDisposition: mutResult.expectedDisposition,
        targetRequirementId: mutResult.expectedFlippedRequirementId,
        mutatedRequirementStatus: 'untested',
        expectedRequirementStatus: mutResult.expectedRequirementStatus,
        flippedCorrectly: false,
        status: 'failed',
        explanation: `Baseline case regression: expected 'meets_policy' but evaluated as '${baselineAssessment.disposition}'. Cannot test counterfactual sensitivity on an incorrect baseline.`,
      };
    }

    // If baseline does not meet policy (and was expected not to), this case cannot demonstrate a flip from meets_policy
    if (!isBaselineMeets) {
      return {
        caseId: originalCase.id,
        mutationType,
        baselineCorrect: baselineMatchesExpected,
        baselineDisposition: baselineAssessment.disposition,
        mutatedDisposition: baselineAssessment.disposition,
        expectedMutatedDisposition: mutResult.expectedDisposition,
        targetRequirementId: mutResult.expectedFlippedRequirementId,
        mutatedRequirementStatus: 'untested',
        expectedRequirementStatus: mutResult.expectedRequirementStatus,
        flippedCorrectly: false,
        status: 'skipped_baseline_deficient',
        explanation: 'Baseline case is deficient/non-compliant by design; cannot measure sensitivity flip away from approval.',
      };
    }

    // If mutation is a no-op or inapplicable to this clinical scenario
    if (!mutResult.isApplicable || mutResult.isNoOp) {
      return {
        caseId: originalCase.id,
        mutationType,
        baselineCorrect: baselineMatchesExpected,
        baselineDisposition: baselineAssessment.disposition,
        mutatedDisposition: baselineAssessment.disposition,
        expectedMutatedDisposition: mutResult.expectedDisposition,
        targetRequirementId: mutResult.expectedFlippedRequirementId,
        mutatedRequirementStatus: 'untested',
        expectedRequirementStatus: mutResult.expectedRequirementStatus,
        flippedCorrectly: false,
        status: 'skipped_inapplicable_noop',
        explanation: 'Mutation vector is not applicable to this scenario or produced no factual change.',
      };
    }

    // 3. Evaluate mutated case
    const mutatedAssessment = await this.orchestrator.evaluateCase(mutResult.mutatedCase, policy);

    // 4. Verify flip against expected disposition AND requirement status
    const targetReq = mutatedAssessment.requirements.find(
      r => r.requirementId === mutResult.expectedFlippedRequirementId
    );
    const actualReqStatus = targetReq?.status ?? 'unresolved';

    const dispositionFlipped = mutatedAssessment.disposition === mutResult.expectedDisposition;
    const requirementFlipped = actualReqStatus === mutResult.expectedRequirementStatus;
    const flippedCorrectly = dispositionFlipped && requirementFlipped;

    return {
      caseId: originalCase.id,
      mutationType,
      baselineCorrect: baselineMatchesExpected,
      baselineDisposition: baselineAssessment.disposition,
      mutatedDisposition: mutatedAssessment.disposition,
      expectedMutatedDisposition: mutResult.expectedDisposition,
      targetRequirementId: mutResult.expectedFlippedRequirementId,
      mutatedRequirementStatus: actualReqStatus,
      expectedRequirementStatus: mutResult.expectedRequirementStatus,
      flippedCorrectly,
      status: flippedCorrectly ? 'passed' : 'failed',
      explanation: mutResult.explanation,
    };
  }

  public async runSensitivitySuite(
    cases: PriorAuthCase[],
    policies: MedicalPolicy[],
    mutationTypes: MutationType[] = [
      'shorten_therapy_duration',
      'diagnosis_non_indicated',
      'temporal_expiry',
      'clinical_negation',
      'laterality_mismatch',
      'remove_supporting_evidence',
    ]
  ): Promise<SensitivityReport> {
    const policyMap = new Map<string, MedicalPolicy>();
    for (const p of policies) policyMap.set(p.id, p);

    const results: MutationTestResult[] = [];
    let skippedDeficient = 0;
    let skippedInapplicable = 0;

    for (const c of cases) {
      const policy = policyMap.get(c.policyId);
      if (!policy) {
        throw new Error(`Missing policy '${c.policyId}' for case '${c.id}'. Missing policies must not be silently skipped.`);
      }

      for (const mType of mutationTypes) {
        const res = await this.testMutation(c, policy, mType);
        results.push(res);
        if (res.status === 'skipped_baseline_deficient') skippedDeficient++;
        if (res.status === 'skipped_inapplicable_noop') skippedInapplicable++;
      }
    }

    const applicableResults = results.filter(
      r => r.status === 'passed' || r.status === 'failed'
    );
    const totalApplicable = applicableResults.length;
    const correctlyFlipped = applicableResults.filter(r => r.flippedCorrectly).length;
    // When 0 applicable vectors run, report 0 (or undefined ratio), never 1.0 (100%)
    const sensitivity = totalApplicable > 0 ? correctlyFlipped / totalApplicable : 0;

    return {
      totalMutationsEvaluated: totalApplicable,
      totalCorrectlyFlipped: correctlyFlipped,
      totalSkippedBaselineDeficient: skippedDeficient,
      totalSkippedInapplicable: skippedInapplicable,
      counterfactualSensitivity: Number(sensitivity.toFixed(4)),
      results,
    };
  }
}
