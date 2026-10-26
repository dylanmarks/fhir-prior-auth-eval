import { hashCanonicalJson, type EvidenceWorkflowResult, type FhirBundleIndexer } from '@openpa/core';
import type { GoldSidecar, GoldPacketFactAssertion } from './types.js';

export interface CriterionScoringDetail {
  requirementId: string;
  expectedStatus: string;
  actualStatus?: string;
  statusMatch: boolean;
  evaluationStateMatch: boolean;
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
  relevantRecall: number | null;
  incrementalSourceRecall: number | null;
  conflictRecall: number | null;
  evidenceSetCompleteness: number | null;
  citationAuthenticity: number | null;
  mappingAccuracy: number | null;
  criticalOmissions: number;
  gapActionAccuracy: number;
  unsupportedDefinitiveClaims: number;
  wrongPatientLeakageCount: number;
  requiredButInaccessibleCount: number;
  endToEndPassed: boolean;
  metricCounts: Record<string, {numerator: number; denominator: number}>;
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
  meanRelevantRecall: number | null;
  meanIncrementalSourceRecall: number | null;
  meanConflictRecall: number | null;
  evidenceSetCompleteness: number | null;
  meanCitationAuthenticity: number | null;
  meanMappingAccuracy: number | null;
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
    const ids = result.reviewPacket.criteria.map(row => row.requirementId);
    let criticalOmissionsCount = ids.length - new Set(ids).size + ids.filter(id => !gold.criteria[id]).length;
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
    const wrongPatientLeakageCount = indexer.getAllResources().filter(r => r.resourceType !== 'Patient' && r.subjectId !== result.reviewPacket.patientId).length;

    for (const [reqId, exp] of Object.entries(gold.criteria)) {
      const packetRow = result.reviewPacket.criteria.find(c => c.requirementId === reqId);
      const assessed = result.assessment.requirements.find(r => r.requirementId === reqId);
      if (packetRow && ['satisfied', 'not_satisfied'].includes(packetRow.status ?? '') &&
        (packetRow.status !== assessed?.status || packetRow.evaluationState !== 'evaluated')) unsupportedDefinitiveClaims++;
      const expectedStatus = isSubmittedArm
        ? exp.expectedStatusSubmitted
        : arm === 'full_corpus'
        ? exp.expectedStatusFullCorpus ?? exp.expectedStatusRetrieval
        : exp.expectedStatusRetrieval;

      const expectedGap = arm === 'full_corpus' && exp.expectedGapKindFullCorpus ? exp.expectedGapKindFullCorpus : isSubmittedArm
        ? exp.expectedGapKindSubmitted
        : exp.expectedGapKindRetrieval;

      const expectedAction = arm === 'full_corpus' && exp.expectedNextActionTypeFullCorpus ? exp.expectedNextActionTypeFullCorpus : isSubmittedArm
        ? exp.expectedNextActionTypeSubmitted
        : exp.expectedNextActionTypeRetrieval;

      const actualStatus = packetRow?.status;
      const actualGap = packetRow?.gapKind ?? 'none';
      const actualAction = packetRow?.nextAction.type ?? 'none';

      const statusMatch = actualStatus === expectedStatus;
      const expectedState = isSubmittedArm ? 'evaluated' : exp.expectedEvaluationStateRetrieval ?? 'evaluated';
      const evaluationStateMatch = packetRow?.evaluationState === expectedState;
      if (!packetRow) criticalOmissionsCount++;
      const gapMatch = actualGap === expectedGap;
      const actionMatch = actualAction === expectedAction;

      totalGapActionChecks++;
      if (gapMatch && actionMatch) correctGapActionChecks++;

      const relevantGoldIds = exp.relevantResourceIds;
      const conflictGoldIds = isSubmittedArm ? [] : exp.mandatoryConflictResourceIds ?? [];
      const evidenceSetApplicable = relevantGoldIds.length > 0 || conflictGoldIds.length > 0 || !!exp.alternativeEvidenceSets?.some(set => set.length > 0);
      if (evidenceSetApplicable) applicableCriteriaCount++;

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
        const actual = indexer.getResourceById(cite.resourceId);
        if (cite.excerpt && !actual?.textSnippet?.includes(cite.excerpt)) unsupportedDefinitiveClaims++;
        const isAuthentic = isIndexed && hasProvenance && !!actual && cite.provenance.length > 0 &&
          result.retrieval.provenance[cite.resourceId].some(ref => ref.sourceId === cite.sourceId) && cite.provenance.every(ref =>
          ref.contentHash === hashCanonicalJson(actual.raw) && result.retrieval.provenance[cite.resourceId].some(p => hashCanonicalJson(p) === hashCanonicalJson(ref)));
        if (isAuthentic) {
          totalAuthenticCitations++;
        }

        // Check criterion mapping: does this citation belong to relevantGoldIds or conflictGoldIds?
        const isRelevant = relevantGoldIds.includes(cite.resourceId) || !!exp.allowedCitationResourceIds?.includes(cite.resourceId);
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
          if (result.retrieval.provenance[goldId]?.some(ref => ref.sourceId === 'initial_submission')) totalInitialRelevant++;
        }
      }

      // Check conflict IDs
      const missingConflictItems: string[] = [];
      for (const cId of conflictGoldIds) {
        const isPresent = allIndexedIds.has(cId);
        if (isPresent) totalRecoveredConflict++;
        if (!isPresent || !conflictCitations.some(c => c.resourceId === cId)) {
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
      if (evidenceSetApplicable && evidenceSetSatisfied && allConflictRecovered) {
        completeCriteriaCount++;
      }

      // Check required packet facts
      const missingFactItems: GoldPacketFactAssertion[] = [];
      if (exp.requiredPacketFacts && exp.requiredPacketFacts.length > 0) {
        for (const fact of exp.requiredPacketFacts) {
          if (fact.appliesTo && !fact.appliesTo.includes(arm)) continue;
          const citedFacts = allRowCitations.filter(c => !fact.resourceId || c.resourceId === fact.resourceId);
          const faithfulFact = citedFacts.some(c => {
            const raw = indexer.getResourceById(c.resourceId)?.raw;
            const value = fact.field.replace(/^\//, '').split(/[./]/).reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined, raw);
            return typeof value === 'string' && value.includes(fact.expectedValue) && `${c.date ?? ''} ${c.excerpt ?? ''}`.includes(fact.expectedValue);
          });
          if (!faithfulFact) {
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
        evaluationStateMatch,
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

    const relevantRecall = totalGoldRelevant > 0 ? totalRecoveredRelevant / totalGoldRelevant : null;
    const incrementalSourceRecall =
      totalGoldRelevant > totalInitialRelevant ? Math.max(0, totalRecoveredRelevant - totalInitialRelevant) / (totalGoldRelevant - totalInitialRelevant) : null;
    const conflictRecall = totalGoldConflict > 0 ? totalRecoveredConflict / totalGoldConflict : null;
    const evidenceSetCompleteness =
      applicableCriteriaCount > 0 ? completeCriteriaCount / applicableCriteriaCount : null;
    const citationAuthenticity =
      totalEmittedCitations > 0 ? totalAuthenticCitations / totalEmittedCitations : null;
    const mappingAccuracy =
      totalEmittedCitations > 0 ? totalCorrectlyMappedCitations / totalEmittedCitations : null;
    const gapActionAccuracy =
      totalGapActionChecks > 0 ? correctGapActionChecks / totalGapActionChecks : 1.0;

    const allCriteriaMatch = Object.values(criteriaDetails).every(
      c => c.statusMatch && c.evaluationStateMatch && c.gapKindMatch && c.nextActionMatch && c.mappingCorrect
    );

    const endToEndPassed =
      dispositionMatch &&
      completenessMatch &&
      stoppingReasonMatch &&
      allCriteriaMatch &&
      criticalOmissionsCount === 0 &&
      (citationAuthenticity === null || citationAuthenticity === 1) &&
      unsupportedDefinitiveClaims === 0;
    const safeEndToEndPassed = endToEndPassed && wrongPatientLeakageCount === 0;

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
      endToEndPassed: safeEndToEndPassed,
      wrongPatientLeakageCount,
      requiredButInaccessibleCount: gold.requiredButInaccessibleResourceIds?.length ?? 0,
      metricCounts: {
        relevantRecall: {numerator: totalRecoveredRelevant, denominator: totalGoldRelevant},
        incrementalSourceRecall: {numerator: Math.max(0, totalRecoveredRelevant - totalInitialRelevant), denominator: totalGoldRelevant - totalInitialRelevant},
        conflictRecall: {numerator: totalRecoveredConflict, denominator: totalGoldConflict},
        evidenceSetCompleteness: {numerator: completeCriteriaCount, denominator: applicableCriteriaCount},
        citationAuthenticity: {numerator: totalAuthenticCitations, denominator: totalEmittedCitations},
        mappingAccuracy: {numerator: totalCorrectlyMappedCitations, denominator: totalEmittedCitations},
        gapActionAccuracy: {numerator: correctGapActionChecks, denominator: totalGapActionChecks},
      },
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

    const mean = (values: Array<number | null>) => {const applicable = values.filter((v): v is number => v !== null); return applicable.length ? applicable.reduce((a,b) => a+b, 0) / applicable.length : null;};
    const arm = scores[0].arm;
    const dispositionAccuracy =
      scores.filter(s => s.dispositionMatch).length / caseCount;
    const meanRelevantRecall =
      mean(scores.map(s => s.relevantRecall));
    const meanIncrementalSourceRecall =
      mean(scores.map(s => s.incrementalSourceRecall));

    const conflictScores = scores.filter(s => s.conflictRecall !== null);
    const meanConflictRecall =
      conflictScores.length > 0
        ? conflictScores.reduce((acc, s) => acc + (s.conflictRecall ?? 0), 0) / conflictScores.length
        : null;

    const evidenceSetCompleteness =
      mean(scores.map(s => s.evidenceSetCompleteness));
    const meanCitationAuthenticity =
      mean(scores.map(s => s.citationAuthenticity));
    const meanMappingAccuracy =
      mean(scores.map(s => s.mappingAccuracy));
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
