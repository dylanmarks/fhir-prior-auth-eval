import { FhirBundleIndexer, EvidenceWorkflowResultSchema, RetrievalInputSchema, hashCanonicalJson, type EvidenceWorkflowResult } from '@openpa/core';
import { executeEvidenceWorkflow, TieredOrchestrator, DeterministicRulesEvaluator, type ExperimentArmId } from '@openpa/evaluators';
import { createSourcesForFixture, type RetrievalCohort } from './loader.js';
import { RetrievalScorer, type CaseScoreReport } from './scorer.js';

export const RETRIEVAL_ARMS: ExperimentArmId[] = ['submitted_only', 'retrieval', 'full_corpus'];

export async function runRetrievalExperiment(cohort: RetrievalCohort) {
  const scorer = new RetrievalScorer();
  const runs: Array<{arm: ExperimentArmId; result: EvidenceWorkflowResult; score: CaseScoreReport; evidenceFingerprint: string}> = [];
  for (const fixture of cohort.cases) {
    const policy = cohort.policies[fixture.policyId];
    const gold = cohort.goldSidecars[fixture.scenarioId];
    if (!policy || !gold) throw new Error(`Missing policy or gold: ${fixture.scenarioId}`);
    for (const arm of RETRIEVAL_ARMS) {
      // Explicit whitelist prevents corpus and scorer metadata entering assessment input.
      const input = RetrievalInputSchema.parse(fixture);
      const result = EvidenceWorkflowResultSchema.parse(await executeEvidenceWorkflow({
        input, policy, orchestrator: new TieredOrchestrator([new DeterministicRulesEvaluator()]),
        sources: createSourcesForFixture(fixture), arm, referenceCorpus: fixture.sourceCorpus,
      }));
      const score = scorer.scoreCase(result, gold, arm, new FhirBundleIndexer(result.retrieval.materializedBundle));
      runs.push({arm, result, score, evidenceFingerprint: hashCanonicalJson(result.retrieval.materializedBundle)});
    }
  }
  const aggregates = RETRIEVAL_ARMS.map(arm => scorer.aggregateScores(runs.filter(r => r.arm === arm).map(r => r.score)));
  return {runs, aggregates, passed: runs.every(r => r.score.endToEndPassed)};
}

export type RetrievalExperiment = Awaited<ReturnType<typeof runRetrievalExperiment>>;
