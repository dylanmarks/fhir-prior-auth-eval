import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadRetrievalCohort, createSourcesForFixture } from '../src/retrieval/loader.js';
import { RetrievalScorer } from '../src/retrieval/scorer.js';
import {
  executeEvidenceWorkflow,
  TieredOrchestrator,
  DeterministicRulesEvaluator,
} from '@openpa/evaluators';
import { FhirBundleIndexer } from '@openpa/core';

const rootDir = fileURLToPath(new URL('../../../', import.meta.url));

describe('Phase 6 Retrieval and Review Handoff Scorer & Baseline', () => {
  const cohort = loadRetrievalCohort(rootDir);
  const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
  const scorer = new RetrievalScorer();

  it('runs complete/scattered pair recovering equivalent evidence and outcome', async () => {
    const scnComplete = cohort.cases.find(c => c.scenarioId === 'scn-701')!;
    const scnScattered = cohort.cases.find(c => c.scenarioId === 'scn-702')!;

    const resComplete = await executeEvidenceWorkflow({
      input: scnComplete,
      policy: cohort.policies[scnComplete.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnComplete),
      arm: 'retrieval',
    });

    const resScattered = await executeEvidenceWorkflow({
      input: scnScattered,
      policy: cohort.policies[scnScattered.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnScattered),
      arm: 'retrieval',
    });

    expect(resComplete.workflowDisposition).toBe('meets_policy');
    expect(resScattered.workflowDisposition).toBe('meets_policy');
    expect(resScattered.retrieval.counts.uniqueEligibleRecords).toBeGreaterThan(0);

    const indexerScattered = new FhirBundleIndexer(resScattered.retrieval.materializedBundle);
    const scoreScattered = scorer.scoreCase(
      resScattered,
      cohort.goldSidecars['scn-702'],
      'retrieval',
      indexerScattered
    );

    expect(scoreScattered.endToEndPassed).toBe(true);
    expect(scoreScattered.relevantRecall).toBe(1.0);
    expect(scoreScattered.criticalOmissions).toBe(0);
  });

  it('shows submitted-only scattered case is deficient and retrieval adds missing records', async () => {
    const scnScattered = cohort.cases.find(c => c.scenarioId === 'scn-702')!;

    const resSubmitted = await executeEvidenceWorkflow({
      input: scnScattered,
      policy: cohort.policies[scnScattered.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnScattered),
      arm: 'submitted_only',
    });

    expect(resSubmitted.workflowDisposition).toBe('needs_information');
    expect(resSubmitted.reviewPacket.criteria[1].gapKind).toBe('not_found_in_searched_sources');
    expect(resSubmitted.reviewPacket.criteria[1].nextAction.type).toBe('request_documentation');
  });

  it('handles truly missing cases without manufacturing records or false absence', async () => {
    const scnMissing = cohort.cases.find(c => c.scenarioId === 'scn-703')!;

    const resMissing = await executeEvidenceWorkflow({
      input: scnMissing,
      policy: cohort.policies[scnMissing.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnMissing),
      arm: 'retrieval',
    });

    expect(resMissing.workflowDisposition).toBe('needs_information');
    expect(resMissing.retrieval.completeWithinScope).toBe(true);
    expect(resMissing.retrieval.stoppingReason).toBe('completed');
    expect(resMissing.reviewPacket.criteria[1].gapKind).toBe('not_found_in_searched_sources');
  });

  it('retrieves contradictory evidence, escalates, and retains conflict in packet', async () => {
    const scnConflict = cohort.cases.find(c => c.scenarioId === 'scn-704')!;

    const resConflict = await executeEvidenceWorkflow({
      input: scnConflict,
      policy: cohort.policies[scnConflict.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnConflict),
      arm: 'retrieval',
    });

    expect(resConflict.workflowDisposition).toBe('requires_clinical_review');
    expect(resConflict.reviewPacket.purpose).toBe('clinical_review');
    const radRow = resConflict.reviewPacket.criteria[0];
    expect(radRow.gapKind).toBe('conflicting_evidence');
    expect(radRow.nextAction.type).toBe('reconcile_conflict');
    expect(radRow.conflictCitations?.length).toBeGreaterThan(0);
  });

  it('preserves incomplete status and clinical review when source is unavailable', async () => {
    const scnUnavailable = cohort.cases.find(c => c.scenarioId === 'scn-705')!;

    const resUnavailable = await executeEvidenceWorkflow({
      input: scnUnavailable,
      policy: cohort.policies[scnUnavailable.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnUnavailable),
      arm: 'retrieval',
    });

    expect(resUnavailable.workflowDisposition).toBe('requires_clinical_review');
    expect(resUnavailable.retrieval.completeWithinScope).toBe(false);
    expect(resUnavailable.retrieval.stoppingReason).toBe('source_unavailable');
    const ptRow = resUnavailable.reviewPacket.criteria[1];
    expect(ptRow.gapKind).toBe('source_unavailable');
    expect(ptRow.nextAction.type).toBe('restore_source_access');
  });

  it('preserves incomplete status when query budget is exhausted', async () => {
    const scnBudget = cohort.cases.find(c => c.scenarioId === 'scn-706')!;

    const resBudget = await executeEvidenceWorkflow({
      input: scnBudget,
      policy: cohort.policies[scnBudget.policyId],
      orchestrator,
      sources: createSourcesForFixture(scnBudget),
      arm: 'retrieval',
    });

    expect(resBudget.workflowDisposition).toBe('requires_clinical_review');
    expect(resBudget.retrieval.completeWithinScope).toBe(false);
    expect(resBudget.retrieval.stoppingReason).toBe('budget_exhausted');
    const ptRow = resBudget.reviewPacket.criteria[1];
    expect(ptRow.gapKind).toBe('search_incomplete');
    expect(ptRow.nextAction.type).toBe('continue_search');
  });

  it('filters wrong-patient distractor records before bundle or packet inclusion', async () => {
    const scn = cohort.cases.find(c => c.scenarioId === 'scn-702')!;

    const res = await executeEvidenceWorkflow({
      input: scn,
      policy: cohort.policies[scn.policyId],
      orchestrator,
      sources: createSourcesForFixture(scn),
      arm: 'retrieval',
    });

    expect(res.retrieval.counts.rejectedRecords).toBeGreaterThan(0);
    // Bundle must NOT have any resource with subject Patient/pat-wrong-999
    const bundleStr = JSON.stringify(res.retrieval.materializedBundle);
    expect(bundleStr).not.toContain('pat-wrong-999');

    // Trace entries must not contain raw resource bodies for rejected records
    const rejectedEvents = res.retrieval.trace.filter(e => e.outcome === 'filtered_wrong_patient');
    expect(rejectedEvents.length).toBeGreaterThan(0);
    for (const event of rejectedEvents) {
      expect((event as any).resource).toBeUndefined();
    }
  });

  // Negative Controls: proving the scorer detects errors
  describe('Negative controls', () => {
    it('detects injected irrelevant authentic citation via mapping accuracy', async () => {
      const scn = cohort.cases.find(c => c.scenarioId === 'scn-701')!;
      const res = await executeEvidenceWorkflow({
        input: scn,
        policy: cohort.policies[scn.policyId],
        orchestrator,
        sources: createSourcesForFixture(scn),
        arm: 'retrieval',
      });

      // Inject authentic citation for Observation/obs-lmb-bp-01 into req-radiculopathy
      const corruptedResult = structuredClone(res);
      corruptedResult.reviewPacket.criteria[0].citations.push({
        resourceType: 'Observation',
        resourceId: 'Observation/obs-lmb-bp-01',
        sourceId: 'initial_submission',
        excerpt: 'Routine blood pressure 120/80 mmHg.',
        provenance: [
          {
            sourceId: 'initial_submission',
            resourceType: 'Observation',
            resourceId: 'Observation/obs-lmb-bp-01',
            contentHash: 'somehash',
          },
        ],
      });

      const indexer = new FhirBundleIndexer(corruptedResult.retrieval.materializedBundle);
      const score = scorer.scoreCase(
        corruptedResult,
        cohort.goldSidecars['scn-701'],
        'retrieval',
        indexer
      );

      // Authentic citation passes authenticity check, but mapping accuracy fails!
      expect(score.citationAuthenticity).toBe(1.0);
      expect(score.mappingAccuracy).toBeLessThan(1.0);
      expect(score.endToEndPassed).toBe(false);
    });

    it('detects dropped conflict evidence', async () => {
      const scn = cohort.cases.find(c => c.scenarioId === 'scn-704')!;
      const res = await executeEvidenceWorkflow({
        input: scn,
        policy: cohort.policies[scn.policyId],
        orchestrator,
        sources: createSourcesForFixture(scn),
        arm: 'retrieval',
      });

      // Corrupt by stripping conflict citation and restoring meets_policy
      const corruptedResult = structuredClone(res);
      corruptedResult.reviewPacket.criteria[0].conflictCitations = [];
      // Remove conflict from materialized bundle to simulate retriever miss
      const filteredEntries = (corruptedResult.retrieval.materializedBundle as any).entry.filter(
        (e: any) => e.resource.id !== 'doc-lmb-contradict-01'
      );
      corruptedResult.retrieval.materializedBundle = {
        resourceType: 'Bundle',
        type: 'collection',
        entry: filteredEntries,
      };

      const indexer = new FhirBundleIndexer(corruptedResult.retrieval.materializedBundle);
      const score = scorer.scoreCase(
        corruptedResult,
        cohort.goldSidecars['scn-704'],
        'retrieval',
        indexer
      );

      expect(score.conflictRecall).toBe(0.0);
      expect(score.criticalOmissions).toBeGreaterThan(0);
      expect(score.endToEndPassed).toBe(false);
    });

    it('detects wrong next action type', async () => {
      const scn = cohort.cases.find(c => c.scenarioId === 'scn-702')!;
      const res = await executeEvidenceWorkflow({
        input: scn,
        policy: cohort.policies[scn.policyId],
        orchestrator,
        sources: createSourcesForFixture(scn),
        arm: 'submitted_only',
      });

      // Corrupt next action from request_documentation to none
      const corruptedResult = structuredClone(res);
      corruptedResult.reviewPacket.criteria[1].nextAction.type = 'none';

      const indexer = new FhirBundleIndexer(corruptedResult.retrieval.materializedBundle);
      const score = scorer.scoreCase(
        corruptedResult,
        cohort.goldSidecars['scn-702'],
        'submitted_only',
        indexer
      );

      expect(score.gapActionAccuracy).toBeLessThan(1.0);
      expect(score.endToEndPassed).toBe(false);
    });
  });
});
