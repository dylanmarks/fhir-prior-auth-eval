import {
  type RetrievalInput, type RetrievalResult, type SourceRecordRef, type SourceRecord,
  type RetrievalStoppingReason, type RetrievalTraceEvent, FhirBundleIndexer,
  hashCanonicalJson, RetrievalInputSchema, RetrievalLimitsSchema, SearchPageSchema, SourceRecordSchema,
} from '@openpa/core';
import { type EvidenceSource, resourcePatientId } from './source.js';

const supportedTypes = new Set(['Condition', 'Procedure', 'Observation', 'DiagnosticReport', 'DocumentReference']);

/** Shared accumulator validates identity and quarantines canonical collisions. */
export class EvidenceAccumulator {
  readonly result: RetrievalResult = {
    scopeKind: 'configured_sources', scopeDescription: 'Configured synthetic sources and advertised types only; not the entire patient chart.',
    completeWithinScope: true, stoppingReason: 'completed', searchedSources: [], searchedResourceTypes: [],
    incompleteSources: [], retrievedRecords: [], provenance: {}, trace: [],
    counts: {queries: 0, pages: 0, reads: 0, uniqueEligibleRecords: 0, duplicateRecords: 0, rejectedRecords: 0, conflictRecords: 0},
    materializedBundle: {}, integrityIssues: [],
  };
  private resources = new Map<string, Record<string, unknown>>();
  private collisions = new Set<string>();
  constructor(readonly input: RetrievalInput) {
    const indexer = new FhirBundleIndexer(input.initialBundle);
    const initial = indexer.getAllResources();
    const issues = [...indexer.integrityIssues];
    if (initial.some(r => !/^[A-Za-z0-9.-]{1,64}$/.test(r.id))) issues.push('Malformed initial resource identity');
    if (indexer.bundlePatientId !== input.patientId) issues.push('Initial patient identity mismatch');
    if (initial.some(r => r.resourceType !== 'Patient' && resourcePatientId(r.raw) !== input.patientId)) issues.push('Initial resource patient identity mismatch');
    if (issues.length) {
      this.result.integrityIssues.push(...issues);
      this.stop('integrity_failure');
      return;
    }
    for (const r of initial) this.accept({sourceId: 'initial_submission', resourceType: r.resourceType, resourceId: `${r.resourceType}/${r.id}`, contentHash: hashCanonicalJson(r.raw)}, r.raw);
  }
  stop(reason: RetrievalStoppingReason, sourceId?: string) {
    const rank = {completed: 0, source_unavailable: 1, budget_exhausted: 2, integrity_failure: 3, cancelled: 4};
    if (rank[reason] > rank[this.result.stoppingReason]) this.result.stoppingReason = reason;
    this.result.completeWithinScope = false;
    if (sourceId && !this.result.incompleteSources.includes(sourceId)) this.result.incompleteSources.push(sourceId);
  }
  accept(ref: SourceRecordRef, resource: Record<string, unknown>, record?: SourceRecord) {
    if (typeof resource.resourceType !== 'string' || typeof resource.id !== 'string' || !/^[A-Za-z0-9.-]{1,64}$/.test(resource.id)) throw new Error('Malformed resource identity');
    const key = `${resource.resourceType}/${resource.id}`;
    if (key !== ref.resourceId || resource.resourceType !== ref.resourceType || hashCanonicalJson(resource) !== ref.contentHash) throw new Error('Record reference/content mismatch');
    const refs = this.result.provenance[key] ?? [];
    if (refs.length && refs[0].contentHash !== ref.contentHash) {
      this.collisions.add(key);
      this.resources.delete(key);
      this.result.retrievedRecords = this.result.retrievedRecords.filter(r => r.reference.resourceId !== key);
      this.result.counts.conflictRecords++;
      this.result.integrityIssues.push(`Conflicting canonical resource ID: ${key}`);
      this.stop('integrity_failure', ref.sourceId);
    } else if (refs.length) this.result.counts.duplicateRecords++;
    else if (!this.collisions.has(key)) {
      this.resources.set(key, resource);
      if (record) {this.result.retrievedRecords.push(record); this.result.counts.uniqueEligibleRecords++;}
    }
    if (!refs.some(r => r.sourceId === ref.sourceId && r.contentHash === ref.contentHash)) refs.push(ref);
    this.result.provenance[key] = refs;
  }
  finish() {
    this.result.materializedBundle = {resourceType: 'Bundle', type: 'collection', entry: [...this.resources.values()].map(resource => ({resource}))};
    return this.result;
  }
}

export class BoundedEvidenceRetriever {
  async retrieve(rawInput: RetrievalInput, sources: EvidenceSource[], signal?: AbortSignal): Promise<RetrievalResult> {
    const input = RetrievalInputSchema.parse(rawInput);
    const limits = RetrievalLimitsSchema.parse(input.limits ?? {});
    const accumulator = new EvidenceAccumulator(input);
    const result = accumulator.result;
    const completedSources = new Set<string>();
    if (!result.completeWithinScope) return accumulator.finish();
    const started = performance.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, {once: true});
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(cancel, limits.timeoutMs);
    const event = (sourceId: string, operation: 'search' | 'read', resourceType: string, outcome: RetrievalTraceEvent['outcome'], details: Partial<RetrievalTraceEvent> = {}) => {
      result.trace.push({sequence: result.trace.length + 1, sourceId, operation, resourceType, outcome, elapsedMs: performance.now() - started, ...details});
    };
    const check = () => {
      if (signal?.aborted) throw new Error('cancelled');
      if (controller.signal.aborted || performance.now() - started >= limits.timeoutMs) throw new Error('budget_exhausted');
    };
    const invoke = async <T>(call: () => Promise<T>): Promise<T> => {
      check();
      // Yield between operations so browser cancellation can interrupt in-process sources.
      await new Promise(resolve => setTimeout(resolve, 0));
      check();
      return new Promise<T>((resolve, reject) => {
        const abort = () => reject(new Error(signal?.aborted ? 'cancelled' : 'budget_exhausted'));
        controller.signal.addEventListener('abort', abort, {once: true});
        Promise.resolve().then(call).then(resolve, reject).finally(() => controller.signal.removeEventListener('abort', abort));
      });
    };
    try {
      check();
      if (new Set(input.sources.map(s => s.id)).size !== input.sources.length) throw new Error('Duplicate source descriptors');
      if (input.sources.length > limits.maxSources) {accumulator.stop('budget_exhausted'); result.incompleteSources = input.sources.map(s => s.id); return accumulator.finish();}
      for (const descriptor of [...input.sources].sort((a,b) => a.id.localeCompare(b.id))) {
        const source = sources.find(s => s.descriptor.id === descriptor.id);
        result.searchedSources.push(descriptor.id);
        if (!source || descriptor.availability === 'unavailable' || input.injectedFailures?.unavailableSourceIds?.includes(descriptor.id)) {
          accumulator.stop('source_unavailable', descriptor.id);
          event(descriptor.id, 'search', '*', 'source_unavailable');
          continue;
        }
        for (const resourceType of [...descriptor.supportedResourceTypes].sort()) {
          check();
          if (!supportedTypes.has(resourceType)) throw new Error(`Unsupported advertised resource type: ${resourceType}`);
          if (!result.searchedResourceTypes.includes(resourceType)) result.searchedResourceTypes.push(resourceType);
          let cursor: string | undefined;
          const seen = new Set<string>();
          do {
            check();
            if (result.counts.pages >= limits.maxSearchPages) throw new Error('budget_exhausted');
            if (cursor && (seen.has(cursor) || input.injectedFailures?.malformedCursorSourceIds?.includes(descriptor.id))) throw new Error('Malformed or repeated pagination cursor');
            if (cursor) seen.add(cursor);
            result.counts.queries++; result.counts.pages++;
            let rawPage;
            try {rawPage = await invoke(() => source.search({patientId: input.patientId, resourceType, cursor, pageSize: limits.pageSize, signal: controller.signal}));}
            catch {
              check(); accumulator.stop('source_unavailable', descriptor.id);
              event(descriptor.id, 'search', resourceType, 'error', {errorCode: 'SEARCH_FAILED'}); break;
            }
            const page = SearchPageSchema.parse(rawPage);
            if (page.references.length > limits.pageSize || page.references.some(ref => ref.sourceId !== descriptor.id || ref.resourceType !== resourceType)) throw new Error('Malformed search page references');
            event(descriptor.id, 'search', resourceType, 'success', {cursor, returnedCount: page.references.length, references: page.references});
            if (page.rejectedCount) {
              result.counts.rejectedRecords += page.rejectedCount;
              event(descriptor.id, 'search', resourceType, 'filtered_wrong_patient', {returnedCount: page.rejectedCount});
            }
            for (const ref of [...page.references].sort((a,b) => a.resourceId.localeCompare(b.resourceId))) {
              check();
              if (result.counts.reads >= limits.maxReads || (input.injectedFailures?.failAfterReadCount !== undefined && result.counts.reads >= input.injectedFailures.failAfterReadCount)) throw new Error('budget_exhausted');
              result.counts.reads++;
              let rawRecord;
              try {rawRecord = await invoke(() => source.read({patientId: input.patientId, reference: ref, signal: controller.signal}));}
              catch {
                check(); accumulator.stop('source_unavailable', descriptor.id);
                event(descriptor.id, 'read', resourceType, 'error', {errorCode: 'READ_FAILED'}); continue;
              }
              const record = SourceRecordSchema.parse(rawRecord);
              if (record.patientId !== input.patientId || resourcePatientId(record.resource) !== input.patientId) {
                result.counts.rejectedRecords++;
                event(descriptor.id, 'read', resourceType, 'filtered_wrong_patient'); continue;
              }
              if (hashCanonicalJson(record.reference) !== hashCanonicalJson(ref)) throw new Error('Returned record reference mismatch');
              accumulator.accept(ref, record.resource, record);
              event(descriptor.id, 'read', resourceType, 'success', {references: [ref], returnedCount: 1});
            }
            cursor = page.nextCursor;
          } while (cursor !== undefined);
        }
        if (!result.incompleteSources.includes(descriptor.id)) completedSources.add(descriptor.id);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Invalid retrieval response';
      const reason = message === 'cancelled' || message === 'budget_exhausted' ? message : 'integrity_failure';
      accumulator.stop(reason);
      if (reason === 'integrity_failure') result.integrityIssues.push(message);
      event(result.searchedSources.at(-1) ?? 'initial_submission', 'search', '*', reason === 'integrity_failure' ? 'error' : reason, {errorCode: reason});
    } finally {
      clearTimeout(timeout); signal?.removeEventListener('abort', cancel);
    }
    if (!result.completeWithinScope) for (const source of input.sources) if (!completedSources.has(source.id) && !result.incompleteSources.includes(source.id)) result.incompleteSources.push(source.id);
    return accumulator.finish();
  }
}

/** Harness reference bypasses search, pagination and read limits, retaining source availability. */
export function assembleAccessibleCorpus(input: RetrievalInput, corpus: Record<string, Record<string, unknown>[]>): RetrievalResult {
  const accumulator = new EvidenceAccumulator(input);
  if (!accumulator.result.completeWithinScope) return accumulator.finish();
  for (const source of input.sources) {
    if (source.availability === 'unavailable' || input.injectedFailures?.unavailableSourceIds?.includes(source.id)) {accumulator.stop('source_unavailable', source.id); continue;}
    for (const resource of corpus[source.id] ?? []) {
      if (!source.supportedResourceTypes.includes(String(resource.resourceType))) continue;
      if (resourcePatientId(resource) !== input.patientId) {accumulator.result.counts.rejectedRecords++; continue;}
      const reference = {sourceId: source.id, resourceType: String(resource.resourceType), resourceId: `${resource.resourceType}/${resource.id}`, contentHash: hashCanonicalJson(resource)};
      try {accumulator.accept(reference, resource, {reference, resource, patientId: input.patientId});}
      catch {accumulator.result.integrityIssues.push('Malformed reference corpus record'); accumulator.stop('integrity_failure', source.id);}
    }
  }
  accumulator.result.scopeDescription = 'Harness assembly of accessible patient-scoped corpus; bypasses search and read limits. Unavailable sources remain excluded.';
  return accumulator.finish();
}
