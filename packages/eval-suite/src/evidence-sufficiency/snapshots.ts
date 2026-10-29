import { hashCanonicalJson, RetrievalInputSchema, type UnlabeledPriorAuthCase } from '@openpa/core';
import { BoundedEvidenceRetriever, EvidenceAccumulator, assembleAccessibleCorpus } from '@openpa/evaluators';
import { createSourcesForFixture } from '../retrieval/loader.js';
import { ACCESS, type EvidenceSnapshot, type SufficiencyFixture } from './types.js';

export function deepFreeze<T>(object: T): T {
  if (object && typeof object === 'object' && !Object.isFrozen(object)) {
    for (const value of Object.values(object)) deepFreeze(value);
    Object.freeze(object);
  }
  return object;
}

export async function materializeSnapshots(fixture: SufficiencyFixture, replicate: number, signal?: AbortSignal): Promise<EvidenceSnapshot[]> {
  const input = RetrievalInputSchema.parse(fixture.runtime);
  const snapshots: EvidenceSnapshot[] = [];
  for (const access of ACCESS) {
    const start = performance.now();
    const retrieval = access === 'retrieval'
      ? await new BoundedEvidenceRetriever().retrieve(input, createSourcesForFixture(fixture.runtime), signal)
      : access === 'full_corpus' ? assembleAccessibleCorpus(input, fixture.runtime.sourceCorpus) : new EvidenceAccumulator(input).finish();
    if (access === 'submitted_only') {
      retrieval.scopeKind = 'initial_submission'; retrieval.scopeDescription = 'Initial submission only; outside sources have not been searched.';
    }
    if (signal?.aborted) {retrieval.completeWithinScope = false; retrieval.stoppingReason = 'cancelled';}
    // Source placement must not change input ordering for equivalent evidence.
    const entries = retrieval.materializedBundle.entry as Array<{resource: {resourceType: string; id: string}}>;
    entries.sort((a,b) => `${a.resource.resourceType}/${a.resource.id}`.localeCompare(`${b.resource.resourceType}/${b.resource.id}`));
    const assessmentInput: UnlabeledPriorAuthCase = {
      id: input.scenarioId, title: `Scenario ${input.scenarioId}`, scenarioCategory: fixture.policy.serviceCodes.includes('72148') ? 'lumbar_mri' : fixture.policy.serviceCodes.includes('73721') ? 'knee_mri' : fixture.policy.serviceCodes.includes('95810') ? 'sleep_study' : 'pt_extension',
      requestedService: input.requestedService, requestedAt: input.requestedAt, policyId: input.policyId,
      patientBundle: retrieval.materializedBundle, tags: [],
    };
    const evidenceHash = hashCanonicalJson(retrieval.materializedBundle);
    const policyHash = hashCanonicalJson(fixture.policy);
    const contentHash = hashCanonicalJson({input: assessmentInput, policyHash, evidenceHash, scope: retrieval.scopeKind, complete: retrieval.completeWithinScope, stoppingReason: retrieval.stoppingReason, provenance: retrieval.provenance});
    snapshots.push(deepFreeze({id: `${input.scenarioId}/${access}/r${replicate}`, fixtureId: input.scenarioId, access, replicate,
      input: assessmentInput, policy: structuredClone(fixture.policy), policyHash, evidenceHash, contentHash, retrieval,
      retrievalMs: performance.now() - start, providerScopeFields: []}));
  }
  return snapshots;
}
