import {
  type MedicalPolicy,
  type UnlabeledPriorAuthCase,
  type RetrievalInput,
  type RetrievalResult,
  type EvidenceWorkflowResult,
  type SourceRecordRef,
  type WorkflowTimings,
  FhirBundleIndexer,
  hashCanonicalJson,
} from '@openpa/core';
import { TieredOrchestrator } from '../tiered/tiered-orchestrator.js';
import { BoundedEvidenceRetriever } from '../retrieval/retriever.js';
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
}

export async function executeEvidenceWorkflow(
  options: ExecuteWorkflowOptions
): Promise<EvidenceWorkflowResult> {
  const { input, policy, orchestrator, sources, arm, signal } = options;
  const startOverall = performance.now();

  let retrieval: RetrievalResult;
  let retrievalMs = 0;

  if (arm === 'submitted_only') {
    const retrievalStart = performance.now();
    // Index initial bundle provenance
    const provenance: Record<string, SourceRecordRef[]> = {};
    const initialEntries = Array.isArray(input.initialBundle?.entry) ? input.initialBundle.entry : [];
    for (const entry of initialEntries) {
      const res = (entry as { resource?: Record<string, unknown> })?.resource;
      if (res && typeof res.resourceType === 'string' && typeof res.id === 'string') {
        const canonicalKey = `${res.resourceType}/${res.id}`;
        provenance[canonicalKey] = [
          {
            sourceId: 'initial_submission',
            resourceType: res.resourceType,
            resourceId: canonicalKey,
            contentHash: hashCanonicalJson(res),
          },
        ];
      }
    }

    retrievalMs = Math.max(0, performance.now() - retrievalStart);
    retrieval = {
      scopeKind: 'initial_submission',
      scopeDescription: 'Initial submission bundle records only.',
      completeWithinScope: true,
      stoppingReason: 'completed',
      searchedSources: [],
      searchedResourceTypes: [],
      incompleteSources: [],
      retrievedRecords: [],
      provenance,
      trace: [],
      counts: {
        queries: 0,
        pages: 0,
        reads: 0,
        uniqueEligibleRecords: 0,
        duplicateRecords: 0,
        rejectedRecords: 0,
        conflictRecords: 0,
      },
      materializedBundle: input.initialBundle,
      integrityIssues: [],
    };
  } else if (arm === 'full_corpus') {
    // Full available corpus reference: relaxes read & page limits so all accessible
    // candidate records across available sources are read and evaluated.
    // Inaccessible sources remain inaccessible.
    const retrievalStart = performance.now();
    const retriever = new BoundedEvidenceRetriever();
    const fullCorpusInput: RetrievalInput = {
      ...input,
      limits: {
        maxSources: 10,
        maxSearchPages: 50,
        pageSize: 10,
        maxReads: 100,
        timeoutMs: 15000,
      },
      // Remove artificial read ceiling for the reference arm
      injectedFailures: input.injectedFailures
        ? {
            ...input.injectedFailures,
            failAfterReadCount: undefined,
          }
        : undefined,
    };
    retrieval = await retriever.retrieve(fullCorpusInput, sources, signal);
    retrievalMs = Math.max(0, performance.now() - retrievalStart);
  } else {
    // Normal bounded retrieval arm
    const retrievalStart = performance.now();
    const retriever = new BoundedEvidenceRetriever();
    retrieval = await retriever.retrieve(input, sources, signal);
    retrievalMs = Math.max(0, performance.now() - retrievalStart);
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
