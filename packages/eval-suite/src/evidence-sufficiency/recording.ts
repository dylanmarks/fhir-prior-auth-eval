import { FhirBundleIndexer, hashCanonicalJson, RequirementEvaluationSchema, type PolicyRequirement } from '@openpa/core';
import { clinicalContext, type EvaluatorContext, type PolicyEvaluator, type EvaluatorResult } from '@openpa/evaluators';
import { deepFreeze } from './snapshots.js';
import type { EvaluatorBinding, EvidenceSnapshot, Recording, AcquisitionOutcome } from './types.js';

export function acquisitionKey(binding: EvaluatorBinding, requirement: PolicyRequirement, snapshot: EvidenceSnapshot, implementationHash: string) {
  // Include the complete evidence/policy and temporal context, even where an adapter
  // currently uses a smaller clinical projection. Gold, split, access labels and threshold are excluded.
  return hashCanonicalJson({implementationHash, configuration: binding.configuration, requestedModel: binding.evaluator.id,
    requirement, policy: snapshot.policy, bundle: snapshot.input.patientBundle, service: snapshot.input.requestedService,
    requestedAt: snapshot.input.requestedAt, replicate: snapshot.replicate});
}

export class AcquisitionStore {
  readonly recordings: Recording[] = [];
  private cache = new Map<string, Promise<Recording>>();
  private spent = 0;
  private tokens = 0;
  private calls = 0;
  private haltedUnknown = false;
  constructor(readonly options: {maxSpend: number; maxCalls: number; maxTokens: number; timeoutMs: number; implementationHash: string; signal?: AbortSignal}) {
    if (!Number.isFinite(options.maxSpend) || options.maxSpend < 0 || !Number.isInteger(options.maxCalls) || options.maxCalls < 1 || !Number.isInteger(options.maxTokens) || options.maxTokens < 1 || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid acquisition limits');
  }
  wrap(binding: EvaluatorBinding, snapshot: EvidenceSnapshot, origin: Recording['origin'], onRecording: (record: Recording) => void): PolicyEvaluator {
    const evaluator = binding.evaluator;
    return {id: evaluator.id, name: evaluator.name, tierLevel: evaluator.tierLevel,
      maxCostUsd: evaluator.maxCostUsd, maxTokens: evaluator.maxTokens, billingSource: evaluator.billingSource,
      evaluateRequirement: async (requirement, context) => {
        const key = acquisitionKey(binding, requirement, snapshot, this.options.implementationHash);
        let pending = this.cache.get(key);
        if (!pending) {pending = this.acquire(binding, snapshot, requirement, context, origin, key); this.cache.set(key, pending);}
        const record = await pending; onRecording(record);
        if (record.outcome !== 'acquired' || !record.result) {
          const error = new Error(`${record.outcome}: ${record.reason ?? 'No judgment acquired'}`);
          Object.assign(error, {metrics: {costUsd: record.knownCostUsd, inputTokens: record.tokens, outputTokens: 0, latencyMs: 0}, usageVerified: record.usageVerified});
          throw error;
        }
        return structuredClone(record.result);
      }};
  }
  private async acquire(binding: EvaluatorBinding, snapshot: EvidenceSnapshot, requirement: PolicyRequirement, context: EvaluatorContext, origin: Recording['origin'], key: string): Promise<Recording> {
    const evaluator = binding.evaluator;
    const record: Recording = {id: `acq-${this.recordings.length + 1}`, key, replicate: snapshot.replicate, evaluatorKey: binding.key,
      requestedModel: evaluator.id, requirementId: requirement.id, snapshotHash: snapshot.contentHash,
      providerInputHash: hashCanonicalJson({requirement, service: context.caseData.requestedService, requestedAt: context.caseData.requestedAt, clinicalContext: clinicalContext(context, requirement)}),
      origin, outcome: 'unavailable', actualCall: false, usageVerified: true, costVerified: true, knownCostUsd: 0, tokens: 0};
    this.recordings.push(record);
    const finish = (outcome: AcquisitionOutcome, reason?: string) => {record.outcome = outcome; record.reason = reason; return deepFreeze(record);};
    if (!binding.configured) return finish('unavailable', 'Provider unconfigured; no judgment acquired');
    if (this.options.signal?.aborted || context.signal?.aborted) return finish('cancelled', 'Run interrupted before dispatch');
    if (binding.provider) {
      if (evaluator.maxCostUsd === undefined || evaluator.maxTokens === undefined) return finish('input_rejected', 'Provider lacks reservation bounds');
      if (this.haltedUnknown || this.spent + evaluator.maxCostUsd > this.options.maxSpend || this.calls >= this.options.maxCalls || this.tokens + evaluator.maxTokens > this.options.maxTokens) return finish('budget_exhausted', this.haltedUnknown ? 'Prior usage is unverified; acquisition halted' : 'Shared acquisition cap prevents dispatch');
      this.calls++;
      record.actualCall = true; // Adapter invocation; corrected below if it returns a preflight deferral.
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.options.signal?.addEventListener('abort', abort, {once: true}); context.signal?.addEventListener('abort', abort, {once: true});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const caseData = deepFreeze(structuredClone(context.caseData));
      const indexer = new FhirBundleIndexer(caseData.patientBundle);
      deepFreeze(indexer.getAllResources());
      const result = await Promise.race([
        evaluator.evaluateRequirement(requirement, {caseData, indexer, signal: controller.signal}),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {controller.abort(); reject(Object.assign(new Error('Adapter deadline exceeded'), {usageVerified: !binding.provider}));}, this.options.timeoutMs);
          controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('Adapter cancelled'), {usageVerified: !binding.provider})), {once: true});
        }),
      ]);
      const m = result.metrics;
      if (![m.costUsd, m.inputTokens, m.outputTokens, m.latencyMs].every(n => Number.isFinite(n) && n >= 0)) throw Object.assign(new Error('Invalid acquisition usage'), {usageVerified: false});
      record.knownCostUsd = m.costUsd; record.tokens = m.inputTokens + m.outputTokens;
      record.costVerified = m.costVerified !== false; record.resolvedModel = m.providerModel ?? (binding.provider ? undefined : evaluator.id);
      this.spent += m.costUsd; this.tokens += record.tokens;
      if (binding.provider && record.tokens === 0) {
        record.actualCall = false; this.calls--;
        return finish('input_rejected', result.notes ?? 'Adapter returned without acquiring a provider judgment');
      }
      RequirementEvaluationSchema.parse({...result, requirementId: requirement.id});
      record.result = structuredClone(result);
      if (this.spent > this.options.maxSpend || (binding.provider && (record.knownCostUsd > evaluator.maxCostUsd! || record.tokens > evaluator.maxTokens!))) {
        this.haltedUnknown = true; return finish('budget_exhausted', 'Provider usage exceeded reservation; subsequent acquisition halted');
      }
      return finish('acquired');
    } catch (error) {
      const failure = error as Error & {usageVerified?: boolean; metrics?: EvaluatorResult['metrics']};
      if (!record.result && record.tokens === 0) {
        const m = failure.metrics;
        record.knownCostUsd = m?.costUsd ?? 0; record.tokens = (m?.inputTokens ?? 0) + (m?.outputTokens ?? 0);
        if (![record.knownCostUsd, record.tokens].every(n => Number.isFinite(n) && n >= 0)) {record.knownCostUsd = 0; record.tokens = 0; record.usageVerified = false;}
        this.spent += record.knownCostUsd; this.tokens += record.tokens;
        record.costVerified = m?.costVerified !== false;
      }
      record.usageVerified = record.usageVerified && failure.usageVerified !== false;
      if (!record.usageVerified) this.haltedUnknown = true;
      // Do not persist provider error bodies, which can contain request/account details.
      return finish(this.options.signal?.aborted ? 'cancelled' : 'provider_error', 'Adapter failed; inspect provider configuration and local diagnostics.');
    } finally {
      if (timer) clearTimeout(timer); this.options.signal?.removeEventListener('abort', abort); context.signal?.removeEventListener('abort', abort);
    }
  }
  summary() {
    const providerRecords = this.recordings.filter(r => r.actualCall);
    const usageVerified = providerRecords.every(r => r.usageVerified);
    const costVerified = usageVerified && providerRecords.every(r => r.costVerified);
    return {adapterAcquisitions: providerRecords.length, tokens: this.tokens, knownCostUsd: this.spent, costUsd: costVerified ? this.spent : null,
      usageVerified, costVerified, directProbeAcquisitionCostUsd: providerRecords.filter(r => r.origin === 'direct_probe').reduce((sum,r) => sum + r.knownCostUsd, 0),
      policyAcquisitionCostUsd: providerRecords.filter(r => r.origin === 'policy').reduce((sum,r) => sum + r.knownCostUsd, 0),
      spendBasis: 'Unique adapter acquisitions, including adapter-internal retries. Policy replays and cache references do not add acquisition spend.'};
  }
}
