import {
  type MedicalPolicy,
  type UnlabeledPriorAuthCase,
  type RetrievalInput,
  type RetrievalResult,
  type EvidenceWorkflowResult,
  type WorkflowTimings,
  FhirBundleIndexer,
} from '@openpa/core';
import { TieredOrchestrator } from '../tiered/tiered-orchestrator.js';
import { BoundedEvidenceRetriever, EvidenceAccumulator, assembleAccessibleCorpus } from '../retrieval/retriever.js';
import type { EvidenceSource } from '../retrieval/source.js';
import { buildReviewPacket } from '../handoff/build-review-packet.js';

export type ExperimentArmId = 'submitted_only' | 'retrieval' | 'full_corpus';

export interface ExecuteWorkflowOptions {
  input: RetrievalInput;
  policy: MedicalPolicy;
  orchestrator: TieredOrchestrator;
  sources: EvidenceSource[];
  arm: ExperimentArmId;
  signal?: AbortSignal;
  referenceCorpus?: Record<string, Record<string, unknown>[]>;
}

export async function executeEvidenceWorkflow(
  options: ExecuteWorkflowOptions
): Promise<EvidenceWorkflowResult> {
  const { input, policy, orchestrator, sources, arm, signal } = options;
  const startOverall = performance.now();

  let retrieval: RetrievalResult;
  let retrievalMs = 0;

  const retrievalStart = performance.now();
  if (arm === 'submitted_only') {
    retrieval = new EvidenceAccumulator(input).finish();
    retrieval.scopeKind = 'initial_submission';
    retrieval.scopeDescription = 'Initial submission only; outside sources have not been searched.';
  } else if (arm === 'full_corpus') {
    if (!options.referenceCorpus) throw new Error('Full corpus arm requires independent harness corpus');
    retrieval = assembleAccessibleCorpus(input, options.referenceCorpus);
  } else {
    retrieval = await new BoundedEvidenceRetriever().retrieve(input, sources, signal);
  }
  retrievalMs = performance.now() - retrievalStart;

  if (signal?.aborted) {
    retrieval.completeWithinScope = false;
    retrieval.stoppingReason = 'cancelled';
  }

  // Evaluate clinical rules on materialized bundle
  const assessmentStart = performance.now();
  const indexer = new FhirBundleIndexer(retrieval.materializedBundle);

  const unlabeledCase: UnlabeledPriorAuthCase = {
    id: input.scenarioId,
    title: `Scenario ${input.scenarioId}`,
    scenarioCategory: policy.id.includes('knee') ? 'knee_mri' : 'lumbar_mri',
    patientBundle: retrieval.materializedBundle,
    requestedService: input.requestedService,
    policyId: input.policyId,
    requestedAt: input.requestedAt,
    tags: [],
  };

  const assessment = await orchestrator.evaluateCase(unlabeledCase, policy);
  const assessmentMs = Math.max(0, performance.now() - assessmentStart);

  // Generate review packet
  const packetStart = performance.now();
  const reviewPacket = buildReviewPacket({
    scenarioId: input.scenarioId,
    patientId: input.patientId,
    policy,
    requestedService: input.requestedService,
    retrieval,
    assessment,
    indexer,
  });
  const packetMs = Math.max(0, performance.now() - packetStart);
  const totalMs = Math.max(0, performance.now() - startOverall);

  const timings: WorkflowTimings = {
    retrievalMs,
    assessmentMs,
    packetMs,
    totalMs,
  };

  return {
    scenarioId: input.scenarioId,
    workflowDisposition: reviewPacket.workflowDisposition,
    assessment,
    retrieval,
    reviewPacket,
    timings,
  };
}
