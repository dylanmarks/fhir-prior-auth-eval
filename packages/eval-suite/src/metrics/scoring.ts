import {
  type AssessmentResult,
  type PriorAuthCase,
  type RequirementStatus,
  FhirBundleIndexer,
} from '@openpa/core';
import { GroundingGuardrail } from '@openpa/evaluators';

export interface RequirementClassMetrics {
  status: RequirementStatus;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface CaseScoreResult {
  caseId: string;
  dispositionMatch: boolean;
  expectedDisposition: string;
  predictedDisposition: string;
  isSafelyResolved: boolean;
  requirementAccuracy: number;
  totalRequirements: number;
  matchedRequirements: number;
  duplicatePredictionsCount: number;
  extraPredictionsCount: number;
  requirementBalancedAccuracy: number;
  requirementMacroF1: number;
  groundingPrecision: number;
  totalCitations: number;
  validCitations: number;
  unsupportedCitations: number;
  missingEvidenceRecall: number;
  pathScore: number;
  costUsd: number;
  costVerified?: boolean;
  latencyMs: number;
}

export interface BenchmarkAggregateMetrics {
  totalCases: number;
  dispositionAccuracy: number;
  meanRequirementAccuracy: number;
  meanRequirementBalancedAccuracy: number;
  meanRequirementMacroF1: number;
  meanGroundingPrecision: number;
  totalCitations: number;
  totalUnsupportedCitations: number;
  missingEvidenceRecall: number;
  meanPathScore: number;
  totalCostUsd: number;
  meanCostPerCase: number;
  meanLatencyMs: number;
  safeResolutionsCount: number;
  costPerSafeResolution: number | null;
  caseScores: CaseScoreResult[];
}

export class ScoringEngine {
  public static scoreCase(
    priorAuthCase: PriorAuthCase,
    assessment: AssessmentResult
  ): CaseScoreResult {
    const exp = priorAuthCase.expectedAssessment;
    const dispositionMatch = exp.disposition === assessment.disposition;

    // 1. Requirement accuracy and multi-class classification metrics
    const totalRequirements = exp.requirements.length;
    let matchedRequirements = 0;

    // Check duplicate and unexpected extra requirement predictions
    const seenPredIds = new Set<string>();
    let duplicatePredictionsCount = 0;
    let extraPredictionsCount = 0;
    const expectedIds = new Set(exp.requirements.map(r => r.requirementId));

    for (const pred of assessment.requirements) {
      if (seenPredIds.has(pred.requirementId)) {
        duplicatePredictionsCount++;
      } else {
        seenPredIds.add(pred.requirementId);
      }
      if (!expectedIds.has(pred.requirementId)) {
        extraPredictionsCount++;
      }
    }

    const statuses: RequirementStatus[] = ['satisfied', 'not_satisfied', 'insufficient_evidence'];
    const classMetrics: Record<RequirementStatus, { tp: number; fp: number; fn: number; tn: number }> = {
      satisfied: { tp: 0, fp: 0, fn: 0, tn: 0 },
      not_satisfied: { tp: 0, fp: 0, fn: 0, tn: 0 },
      insufficient_evidence: { tp: 0, fp: 0, fn: 0, tn: 0 },
      not_applicable: { tp: 0, fp: 0, fn: 0, tn: 0 },
    };

    for (const expReq of exp.requirements) {
      const predReq = assessment.requirements.find(r => r.requirementId === expReq.requirementId);
      const expectedStatus = expReq.status;

      if (!predReq) {
        // Missing prediction: MUST NOT score as correct insufficient_evidence
        // Counts as a false negative for expectedStatus
        classMetrics[expectedStatus].fn++;
        continue;
      }

      const actualStatus = predReq.status;

      if (actualStatus === expectedStatus) {
        matchedRequirements++;
      }

      for (const s of statuses) {
        if (expectedStatus === s && actualStatus === s) {
          classMetrics[s].tp++;
        } else if (expectedStatus !== s && actualStatus === s) {
          classMetrics[s].fp++;
        } else if (expectedStatus === s && actualStatus !== s) {
          classMetrics[s].fn++;
        } else {
          classMetrics[s].tn++;
        }
      }
    }

    // Penalize missing predictions, duplicate predictions, and unprompted extra predictions
    const penaltyCount = duplicatePredictionsCount + extraPredictionsCount;
    const requirementAccuracy = totalRequirements > 0
      ? Math.max(0, (matchedRequirements - penaltyCount) / totalRequirements)
      : 1.0;

    // Compute Macro F1 and Balanced Accuracy across active classes
    let sumRecall = 0;
    let sumF1 = 0;
    let activeClasses = 0;

    for (const s of statuses) {
      const { tp, fp, fn } = classMetrics[s];
      if (tp + fn > 0 || tp + fp > 0) {
        activeClasses++;
        const prec = tp + fp > 0 ? tp / (tp + fp) : 0;
        const rec = tp + fn > 0 ? tp / (tp + fn) : 0;
        const f1 = prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0;
        sumRecall += rec;
        sumF1 += f1;
      }
    }

    const requirementBalancedAccuracy = activeClasses > 0 ? sumRecall / activeClasses : 1.0;
    const requirementMacroF1 = activeClasses > 0 ? sumF1 / activeClasses : 1.0;

    // 2. Real Grounding Verification via GroundingGuardrail against actual patient bundle
    const indexer = new FhirBundleIndexer(priorAuthCase.patientBundle);
    const allCitations = assessment.requirements.flatMap(r => r.evidence);
    const grounding = GroundingGuardrail.verifyCitations(allCitations, indexer);

    const totalCitations = grounding.totalCitations;
    const validCitations = grounding.validCitations;
    const unsupportedCitations = grounding.ungroundedCitations.length;

    const groundingPrecision = totalCitations > 0
      ? validCitations / totalCitations
      : 1.0;

    // 3. Missing Evidence Recall using stable requirement IDs
    const extractReqIds = (items: string[]): Set<string> => {
      const set = new Set<string>();
      for (const item of items) {
        const id = item.split(':')[0].trim();
        if (id) set.add(id);
      }
      return set;
    };

    const expectedMissingIds = extractReqIds(exp.missingInformation || []);
    const actualMissingIds = extractReqIds(assessment.missingInformation || []);

    let missingEvidenceRecall: number;
    if (expectedMissingIds.size === 0) {
      // If no missing evidence was expected: 1.0 if none was falsely flagged, 0.0 if false positive
      missingEvidenceRecall = actualMissingIds.size === 0 ? 1.0 : 0.0;
    } else {
      let foundCount = 0;
      for (const id of expectedMissingIds) {
        if (actualMissingIds.has(id)) {
          foundCount++;
        }
      }
      missingEvidenceRecall = foundCount / expectedMissingIds.size;
    }

    // 4. Path Scoring: check tier efficiency and valid progression
    let pathScore = 1.0;
    if (assessment.executionTrace.length > 0) {
      const failedSteps = assessment.executionTrace.filter(t => t.status === 'failed' || t.status === 'budget_exceeded').length;
      if (failedSteps > 0) {
        pathScore = Math.max(0, 1.0 - failedSteps * 0.5);
      }
    }

    // 5. Safe resolution criterion:
    // Requires matching expected disposition, not an escalation, zero unsupported citations,
    // 100% requirement accuracy, supported evidence for satisfied claims, and zero duplicates/extras.
    const satisfiedClaimsHaveEvidence = assessment.requirements
      .filter(r => r.status === 'satisfied')
      .every(r => r.evidence.length > 0);

    const isSafelyResolved =
      dispositionMatch &&
      assessment.disposition !== 'requires_clinical_review' &&
      unsupportedCitations === 0 &&
      requirementAccuracy === 1.0 &&
      satisfiedClaimsHaveEvidence &&
      duplicatePredictionsCount === 0 &&
      extraPredictionsCount === 0;
    const verifiedSafeResolution = isSafelyResolved && assessment.usageVerified !== false;

    return {
      caseId: priorAuthCase.id,
      dispositionMatch,
      expectedDisposition: exp.disposition,
      predictedDisposition: assessment.disposition,
      isSafelyResolved: verifiedSafeResolution,
      requirementAccuracy,
      totalRequirements,
      matchedRequirements,
      duplicatePredictionsCount,
      extraPredictionsCount,
      requirementBalancedAccuracy,
      requirementMacroF1,
      groundingPrecision,
      totalCitations,
      validCitations,
      unsupportedCitations,
      missingEvidenceRecall,
      pathScore,
      costUsd: assessment.totalCostUsd,
      costVerified: assessment.costVerified !== false && assessment.usageVerified !== false,
      latencyMs: assessment.totalLatencyMs,
    };
  }

  public static aggregateScores(caseScores: CaseScoreResult[]): BenchmarkAggregateMetrics {
    const totalCases = caseScores.length;
    if (totalCases === 0) {
      return {
        totalCases: 0,
        dispositionAccuracy: 0,
        meanRequirementAccuracy: 0,
        meanRequirementBalancedAccuracy: 0,
        meanRequirementMacroF1: 0,
        meanGroundingPrecision: 0,
        totalCitations: 0,
        totalUnsupportedCitations: 0,
        missingEvidenceRecall: 0,
        meanPathScore: 0,
        totalCostUsd: 0,
        meanCostPerCase: 0,
        meanLatencyMs: 0,
        safeResolutionsCount: 0,
        costPerSafeResolution: null,
        caseScores: [],
      };
    }

    const correctDispositions = caseScores.filter(s => s.dispositionMatch).length;
    const dispositionAccuracy = correctDispositions / totalCases;

    const meanRequirementAccuracy =
      caseScores.reduce((acc, s) => acc + s.requirementAccuracy, 0) / totalCases;

    const meanRequirementBalancedAccuracy =
      caseScores.reduce((acc, s) => acc + s.requirementBalancedAccuracy, 0) / totalCases;

    const meanRequirementMacroF1 =
      caseScores.reduce((acc, s) => acc + s.requirementMacroF1, 0) / totalCases;

    const meanGroundingPrecision =
      caseScores.reduce((acc, s) => acc + s.groundingPrecision, 0) / totalCases;

    const totalCitations = caseScores.reduce((acc, s) => acc + s.totalCitations, 0);
    const totalUnsupportedCitations = caseScores.reduce((acc, s) => acc + s.unsupportedCitations, 0);

    const missingEvidenceRecall =
      caseScores.reduce((acc, s) => acc + s.missingEvidenceRecall, 0) / totalCases;

    const meanPathScore =
      caseScores.reduce((acc, s) => acc + s.pathScore, 0) / totalCases;

    const totalCostUsd = caseScores.reduce((acc, s) => acc + s.costUsd, 0);
    const meanCostPerCase = totalCostUsd / totalCases;
    const meanLatencyMs = Math.round(
      caseScores.reduce((acc, s) => acc + s.latencyMs, 0) / totalCases
    );

    // Safe resolution accounting: exclude escalations and unsafe/hallucinated cases
    const safeResolutions = caseScores.filter(s => s.isSafelyResolved);
    const safeResolutionsCount = safeResolutions.length;

    // Represent undefined metrics honestly: if 0 resolved safely, do not report $0.0000
    const costPerSafeResolution = safeResolutionsCount > 0 && caseScores.every(s => s.costVerified !== false)
      ? Number((totalCostUsd / safeResolutionsCount).toFixed(6))
      : null;

    return {
      totalCases,
      dispositionAccuracy: Number(dispositionAccuracy.toFixed(4)),
      meanRequirementAccuracy: Number(meanRequirementAccuracy.toFixed(4)),
      meanRequirementBalancedAccuracy: Number(meanRequirementBalancedAccuracy.toFixed(4)),
      meanRequirementMacroF1: Number(meanRequirementMacroF1.toFixed(4)),
      meanGroundingPrecision: Number(meanGroundingPrecision.toFixed(4)),
      totalCitations,
      totalUnsupportedCitations,
      missingEvidenceRecall: Number(missingEvidenceRecall.toFixed(4)),
      meanPathScore: Number(meanPathScore.toFixed(4)),
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      meanCostPerCase: Number(meanCostPerCase.toFixed(6)),
      meanLatencyMs,
      safeResolutionsCount,
      costPerSafeResolution,
      caseScores,
    };
  }
}
