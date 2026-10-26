import type { EvidenceWorkflowResult, FhirBundleIndexer } from '@openpa/core';
import type { GoldSidecar, GoldPacketFactAssertion } from './types.js';

export interface CriterionScoringDetail {
  requirementId: string;
  expectedStatus: string;
  actualStatus?: string;
  statusMatch: boolean;
  expectedGapKind: string;
  actualGapKind: string;
  gapKindMatch: boolean;
  expectedNextActionType: string;
  actualNextActionType: string;
  nextActionMatch: boolean;
  goldRelevantCount: number;
  recoveredRelevantCount: number;
  mappingCorrect: boolean;
  missingConflictItems: string[];
  missingFactItems: GoldPacketFactAssertion[];
}

export interface CaseScoreReport {
  scenarioId: string;
  family: string;
  variant: string;
  arm: string;
  expectedDisposition: string;
  actualDisposition: string;
  dispositionMatch: boolean;
  expectedCompleteness: boolean;
  actualCompleteness: boolean;
  completenessMatch: boolean;
  stoppingReasonMatch: boolean;
  relevantRecall: number;
  incrementalSourceRecall: number;
  conflictRecall: number | null;
  evidenceSetCompleteness: number;
  citationAuthenticity: number;
  mappingAccuracy: number;
  criticalOmissions: number;
  gapActionAccuracy: number;
  unsupportedDefinitiveClaims: number;
  endToEndPassed: boolean;
  criteriaDetails: Record<string, CriterionScoringDetail>;
  effort: {
    queries: number;
    pages: number;
    reads: number;
    uniqueEligibleRecords: number;
    duplicateRecords: number;
    rejectedRecords: number;
    retrievalLatencyMs: number;
    packetLatencyMs: number;
    totalLatencyMs: number;
  };
}

export interface ArmAggregateScore {
  arm: string;
  caseCount: number;
  dispositionAccuracy: number;
  meanRelevantRecall: number;
  meanIncrementalSourceRecall: number;
  meanConflictRecall: number | null;
  evidenceSetCompleteness: number;
  meanCitationAuthenticity: number;
  meanMappingAccuracy: number;
  totalCriticalOmissions: number;
  gapActionAccuracy: number;
  totalUnsupportedDefinitiveClaims: number;
  endToEndCorrectnessRate: number;
  totalQueries: number;
  totalPages: number;
  totalReads: number;
  totalUniqueRecords: number;
  totalDuplicates: number;
  totalRejectedRecords: number;
  meanTotalLatencyMs: number;
}

export class RetrievalScorer {
  public scoreCase(
    result: EvidenceWorkflowResult,
    gold: GoldSidecar,
    arm: 'submitted_only' | 'retrieval' | 'full_corpus',
    indexer: FhirBundleIndexer
  ): CaseScoreReport {
    const isSubmittedArm = arm === 'submitted_only';
    const expectedDisp = isSubmittedArm
      ? gold.expectedDispositions.submittedOnly
      : arm === 'full_corpus'
      ? gold.expectedDispositions.fullCorpus
      : gold.expectedDispositions.retrieval;

    const expectedComplete = isSubmittedArm
      ? gold.expectedSearchCompleteness.submittedOnly
      : arm === 'full_corpus'
      ? gold.expectedSearchCompleteness.fullCorpus
      : gold.expectedSearchCompleteness.retrieval;

    const expectedStop = isSubmittedArm
      ? gold.expectedStoppingReason.submittedOnly
      : arm === 'full_corpus'
      ? gold.expectedStoppingReason.fullCorpus
      : gold.expectedStoppingReason.retrieval;

    const dispositionMatch = result.workflowDisposition === expectedDisp;
    const completenessMatch = result.retrieval.completeWithinScope === expectedComplete;
    const stoppingReasonMatch = result.retrieval.stoppingReason === expectedStop;

    let totalGoldRelevant = 0;
    let totalRecoveredRelevant = 0;
    let totalInitialRelevant = 0;
    let totalGoldConflict = 0;
    let totalRecoveredConflict = 0;
    let applicableCriteriaCount = 0;
    let completeCriteriaCount = 0;
    let totalEmittedCitations = 0;
    let totalAuthenticCitations = 0;
    let totalCorrectlyMappedCitations = 0;
    let criticalOmissionsCount = 0;
    let totalGapActionChecks = 0;
    let correctGapActionChecks = 0;
    let unsupportedDefinitiveClaims = 0;

    const criteriaDetails: Record<string, CriterionScoringDetail> = {};

    // Check packet assertion strength vs search completeness
    if (!result.retrieval.completeWithinScope) {
      if (result.workflowDisposition === 'meets_policy') {
        unsupportedDefinitiveClaims++;
      }
      for (const row of result.reviewPacket.criteria) {
        if (row.gapKind === 'not_found_in_searched_sources' && !isSubmittedArm) {
          // Incomplete external search asserting evidence not found
          unsupportedDefinitiveClaims++;
        }
      }
    }

    const allIndexedIds = new Set(indexer.getAllResources().map(r => `${r.resourceType}/${r.id}`));

    for (const [reqId, exp] of Object.entries(gold.criteria)) {
      applicableCriteriaCount++;
      const packetRow = result.reviewPacket.criteria.find(c => c.requirementId === reqId);
      const expectedStatus = isSubmittedArm
        ? exp.expectedStatusSubmitted
        : arm === 'full_corpus'
        ? exp.expectedStatusFullCorpus ?? exp.expectedStatusRetrieval
        : exp.expectedStatusRetrieval;

      const expectedGap = isSubmittedArm
        ? exp.expectedGapKindSubmitted
        : exp.expectedGapKindRetrieval;

      const expectedAction = isSubmittedArm
        ? exp.expectedNextActionTypeSubmitted
        : exp.expectedNextActionTypeRetrieval;

      const actualStatus = packetRow?.status;
      const actualGap = packetRow?.gapKind ?? 'none';
      const actualAction = packetRow?.nextAction.type ?? 'none';

      const statusMatch = actualStatus === expectedStatus;
      const gapMatch = actualGap === expectedGap;
      const actionMatch = actualAction === expectedAction;

      totalGapActionChecks += 2;
      if (gapMatch) correctGapActionChecks++;
      if (actionMatch) correctGapActionChecks++;

      const relevantGoldIds = exp.relevantResourceIds;
      const conflictGoldIds = exp.mandatoryConflictResourceIds ?? [];

      totalGoldRelevant += relevantGoldIds.length;
      totalGoldConflict += conflictGoldIds.length;

      // Check citations for this criterion
      const rowCitations = packetRow?.citations ?? [];
      const conflictCitations = packetRow?.conflictCitations ?? [];
      const allRowCitations = [...rowCitations, ...conflictCitations];

      let recoveredRelevantForCriterion = 0;
      let mappingCorrectForCriterion = true;

      for (const cite of allRowCitations) {
        totalEmittedCitations++;
        // Check authenticity: is it in the indexer and in provenance?
        const isIndexed = allIndexedIds.has(cite.resourceId);
        const hasProvenance = Array.isArray(result.retrieval.provenance[cite.resourceId]);
        const isAuthentic = isIndexed && hasProvenance;
        if (isAuthentic) {
          totalAuthenticCitations++;
        }

        // Check criterion mapping: does this citation belong to relevantGoldIds or conflictGoldIds?
        const isRelevant = relevantGoldIds.includes(cite.resourceId);
        const isConflict = conflictGoldIds.includes(cite.resourceId);
        if (isRelevant || isConflict) {
          totalCorrectlyMappedCitations++;
        } else {
          // Injected or irrelevant citation mapped to this criterion
          mappingCorrectForCriterion = false;
        }
      }

      // Check how many relevant gold IDs are retrieved / present
      for (const goldId of relevantGoldIds) {
        const isPresent = allIndexedIds.has(goldId);
        if (isPresent) {
          recoveredRelevantForCriterion++;
          totalRecoveredRelevant++;
          if (isSubmittedArm) totalInitialRelevant++;
        }
      }

      // Check conflict IDs
      const missingConflictItems: string[] = [];
      for (const cId of conflictGoldIds) {
        const isPresent = allIndexedIds.has(cId);
        if (isPresent) {
          totalRecoveredConflict++;
        } else {
          missingConflictItems.push(cId);
          criticalOmissionsCount++;
        }
      }

      // Check alternative evidence sets if defined
      let evidenceSetSatisfied = false;
      if (exp.alternativeEvidenceSets && exp.alternativeEvidenceSets.length > 0) {
        evidenceSetSatisfied = exp.alternativeEvidenceSets.some(set =>
          set.every(id => allIndexedIds.has(id))
        );
      } else {
        evidenceSetSatisfied = relevantGoldIds.every(id => allIndexedIds.has(id));
      }

      const allConflictRecovered = conflictGoldIds.every(id => allIndexedIds.has(id));
      if (evidenceSetSatisfied && allConflictRecovered) {
        completeCriteriaCount++;
      }

      // Check required packet facts
      const missingFactItems: GoldPacketFactAssertion[] = [];
      if (exp.requiredPacketFacts && exp.requiredPacketFacts.length > 0) {
        for (const fact of exp.requiredPacketFacts) {
          const excerpt = allRowCitations.map(c => c.excerpt ?? '').join(' ');
          if (!excerpt.includes(fact.expectedValue)) {
            missingFactItems.push(fact);
            criticalOmissionsCount++;
          }
        }
      }

      criteriaDetails[reqId] = {
        requirementId: reqId,
        expectedStatus,
        actualStatus,
        statusMatch,
        expectedGapKind: expectedGap,
        actualGapKind: actualGap,
        gapKindMatch: gapMatch,
        expectedNextActionType: expectedAction,
        actualNextActionType: actualAction,
        nextActionMatch: actionMatch,
        goldRelevantCount: relevantGoldIds.length,
        recoveredRelevantCount: recoveredRelevantForCriterion,
        mappingCorrect: mappingCorrectForCriterion,
        missingConflictItems,
        missingFactItems,
      };
    }

    const relevantRecall = totalGoldRelevant > 0 ? totalRecoveredRelevant / totalGoldRelevant : 1.0;
    const incrementalSourceRecall =
      totalGoldRelevant > 0 ? Math.max(0, totalRecoveredRelevant - totalInitialRelevant) / totalGoldRelevant : 0.0;
    const conflictRecall = totalGoldConflict > 0 ? totalRecoveredConflict / totalGoldConflict : null;
    const evidenceSetCompleteness =
      applicableCriteriaCount > 0 ? completeCriteriaCount / applicableCriteriaCount : 1.0;
    const citationAuthenticity =
      totalEmittedCitations > 0 ? totalAuthenticCitations / totalEmittedCitations : 1.0;
    const mappingAccuracy =
      totalEmittedCitations > 0 ? totalCorrectlyMappedCitations / totalEmittedCitations : 1.0;
    const gapActionAccuracy =
      totalGapActionChecks > 0 ? correctGapActionChecks / totalGapActionChecks : 1.0;

    const allCriteriaMatch = Object.values(criteriaDetails).every(
      c => c.statusMatch && c.gapKindMatch && c.nextActionMatch && c.mappingCorrect
    );

    const endToEndPassed =
      dispositionMatch &&
      completenessMatch &&
      stoppingReasonMatch &&
      allCriteriaMatch &&
      criticalOmissionsCount === 0 &&
      unsupportedDefinitiveClaims === 0;

    return {
      scenarioId: gold.scenarioId,
      family: gold.family,
      variant: gold.variant,
      arm,
      expectedDisposition: expectedDisp,
      actualDisposition: result.workflowDisposition,
      dispositionMatch,
      expectedCompleteness: expectedComplete,
      actualCompleteness: result.retrieval.completeWithinScope,
      completenessMatch,
      stoppingReasonMatch,
      relevantRecall,
      incrementalSourceRecall,
      conflictRecall,
      evidenceSetCompleteness,
      citationAuthenticity,
      mappingAccuracy,
      criticalOmissions: criticalOmissionsCount,
      gapActionAccuracy,
      unsupportedDefinitiveClaims,
      endToEndPassed,
      criteriaDetails,
      effort: {
        queries: result.retrieval.counts.queries,
        pages: result.retrieval.counts.pages,
        reads: result.retrieval.counts.reads,
        uniqueEligibleRecords: result.retrieval.counts.uniqueEligibleRecords,
        duplicateRecords: result.retrieval.counts.duplicateRecords,
        rejectedRecords: result.retrieval.counts.rejectedRecords,
        retrievalLatencyMs: result.timings.retrievalMs,
        packetLatencyMs: result.timings.packetMs,
        totalLatencyMs: result.timings.totalMs,
      },
    };
  }

  public aggregateScores(scores: CaseScoreReport[]): ArmAggregateScore {
    const caseCount = scores.length;
    if (caseCount === 0) {
      throw new Error('Cannot aggregate zero scores');
    }

    const arm = scores[0].arm;
    const dispositionAccuracy =
      scores.filter(s => s.dispositionMatch).length / caseCount;
    const meanRelevantRecall =
      scores.reduce((acc, s) => acc + s.relevantRecall, 0) / caseCount;
    const meanIncrementalSourceRecall =
      scores.reduce((acc, s) => acc + s.incrementalSourceRecall, 0) / caseCount;

    const conflictScores = scores.filter(s => s.conflictRecall !== null);
    const meanConflictRecall =
      conflictScores.length > 0
        ? conflictScores.reduce((acc, s) => acc + (s.conflictRecall ?? 0), 0) / conflictScores.length
        : null;

    const evidenceSetCompleteness =
      scores.reduce((acc, s) => acc + s.evidenceSetCompleteness, 0) / caseCount;
    const meanCitationAuthenticity =
      scores.reduce((acc, s) => acc + s.citationAuthenticity, 0) / caseCount;
    const meanMappingAccuracy =
      scores.reduce((acc, s) => acc + s.mappingAccuracy, 0) / caseCount;
    const totalCriticalOmissions =
      scores.reduce((acc, s) => acc + s.criticalOmissions, 0);
    const gapActionAccuracy =
      scores.reduce((acc, s) => acc + s.gapActionAccuracy, 0) / caseCount;
    const totalUnsupportedDefinitiveClaims =
      scores.reduce((acc, s) => acc + s.unsupportedDefinitiveClaims, 0);
    const endToEndCorrectnessRate =
      scores.filter(s => s.endToEndPassed).length / caseCount;

    const totalQueries = scores.reduce((acc, s) => acc + s.effort.queries, 0);
    const totalPages = scores.reduce((acc, s) => acc + s.effort.pages, 0);
    const totalReads = scores.reduce((acc, s) => acc + s.effort.reads, 0);
    const totalUniqueRecords = scores.reduce((acc, s) => acc + s.effort.uniqueEligibleRecords, 0);
    const totalDuplicates = scores.reduce((acc, s) => acc + s.effort.duplicateRecords, 0);
    const totalRejectedRecords = scores.reduce((acc, s) => acc + s.effort.rejectedRecords, 0);
    const meanTotalLatencyMs = Math.round(
      scores.reduce((acc, s) => acc + s.effort.totalLatencyMs, 0) / caseCount
    );

    return {
      arm,
      caseCount,
      dispositionAccuracy,
      meanRelevantRecall,
      meanIncrementalSourceRecall,
      meanConflictRecall,
      evidenceSetCompleteness,
      meanCitationAuthenticity,
      meanMappingAccuracy,
      totalCriticalOmissions,
      gapActionAccuracy,
      totalUnsupportedDefinitiveClaims,
      endToEndCorrectnessRate,
      totalQueries,
      totalPages,
      totalReads,
      totalUniqueRecords,
      totalDuplicates,
      totalRejectedRecords,
      meanTotalLatencyMs,
    };
  }
}
