import {
  type RetrievalInput,
  type RetrievalResult,
  type RetrievalTraceEvent,
  type SourceRecord,
  type SourceRecordRef,
  type RetrievalCounts,
  type RetrievalLimits,
  type RetrievalStoppingReason,
  hashCanonicalJson,
} from '@openpa/core';
import type { EvidenceSource } from './source.js';

export class BoundedEvidenceRetriever {
  private readonly defaultLimits: RetrievalLimits = {
    maxSources: 4,
    maxSearchPages: 16,
    pageSize: 5,
    maxReads: 24,
    timeoutMs: 10000,
  };

  public async retrieve(
    input: RetrievalInput,
    sources: EvidenceSource[],
    signal?: AbortSignal
  ): Promise<RetrievalResult> {
    const startOverall = performance.now();
    const limits: RetrievalLimits = {
      ...this.defaultLimits,
      ...input.limits,
    };

    const trace: RetrievalTraceEvent[] = [];
    let sequence = 0;

    const addTrace = (
      sourceId: string,
      operation: 'search' | 'read',
      resourceType: string,
      outcome: RetrievalTraceEvent['outcome'],
      details: {
        cursor?: string;
        returnedCount?: number;
        references?: SourceRecordRef[];
        errorCode?: string;
        errorMessage?: string;
      } = {}
    ) => {
      sequence++;
      trace.push({
        sequence,
        sourceId,
        operation,
        resourceType,
        outcome,
        elapsedMs: Math.max(0, performance.now() - startOverall),
        cursor: details.cursor,
        returnedCount: details.returnedCount,
        references: details.references,
        errorCode: details.errorCode,
        errorMessage: details.errorMessage,
      });
    };

    const counts: RetrievalCounts = {
      queries: 0,
      pages: 0,
      reads: 0,
      uniqueEligibleRecords: 0,
      duplicateRecords: 0,
      rejectedRecords: 0,
      conflictRecords: 0,
    };

    const provenance: Record<string, SourceRecordRef[]> = {};
    const integrityIssues: string[] = [];
    const searchedSources: string[] = [];
    const searchedResourceTypes: string[] = [];
    const incompleteSources: string[] = [];
    const retrievedRecords: SourceRecord[] = [];
    const resourceContentHashes = new Map<string, string>();

    // 1. Validate initial submission bundle
    const initialEntries = Array.isArray(input.initialBundle?.entry) ? input.initialBundle.entry : [];
    const patientEntries = initialEntries.filter(
      (e: any) => e?.resource?.resourceType === 'Patient'
    );

    if (patientEntries.length !== 1) {
      integrityIssues.push(
        `Initial bundle must contain exactly one Patient resource; found ${patientEntries.length}`
      );
      return {
        scopeKind: 'configured_sources',
        scopeDescription: 'Configured synthetic sources and advertised types.',
        completeWithinScope: false,
        stoppingReason: 'integrity_failure',
        searchedSources: [],
        searchedResourceTypes: [],
        incompleteSources: [],
        retrievedRecords: [],
        provenance: {},
        trace,
        counts,
        materializedBundle: input.initialBundle,
        integrityIssues,
      };
    }

    const patientRes = patientEntries[0].resource;
    if (patientRes.id !== input.patientId) {
      integrityIssues.push(
        `Initial bundle patient ID (${patientRes.id}) does not match input patientId (${input.patientId})`
      );
      return {
        scopeKind: 'configured_sources',
        scopeDescription: 'Configured synthetic sources and advertised types.',
        completeWithinScope: false,
        stoppingReason: 'integrity_failure',
        searchedSources: [],
        searchedResourceTypes: [],
        incompleteSources: [],
        retrievedRecords: [],
        provenance: {},
        trace,
        counts,
        materializedBundle: input.initialBundle,
        integrityIssues,
      };
    }

    // Index initial bundle entries for provenance and collision checks
    for (const entry of initialEntries) {
      const res = (entry as { resource?: Record<string, unknown> })?.resource;
      if (res && typeof res.resourceType === 'string' && typeof res.id === 'string') {
        const canonicalKey = `${res.resourceType}/${res.id}`;
        const hash = hashCanonicalJson(res);
        resourceContentHashes.set(canonicalKey, hash);
        provenance[canonicalKey] = [
          {
            sourceId: 'initial_submission',
            resourceType: res.resourceType,
            resourceId: canonicalKey,
            contentHash: hash,
          },
        ];
      }
    }

    let stoppingReason: RetrievalStoppingReason = 'completed';
    const activeSources = sources.slice(0, limits.maxSources);

    // 2. Iterate configured sources
    sourceLoop: for (const source of activeSources) {
      searchedSources.push(source.descriptor.id);

      // Check injected unavailability
      const isInjectedUnavailable = input.injectedFailures?.unavailableSourceIds?.includes(
        source.descriptor.id
      );

      if (source.descriptor.availability === 'unavailable' || isInjectedUnavailable) {
        incompleteSources.push(source.descriptor.id);
        stoppingReason = 'source_unavailable';
        addTrace(source.descriptor.id, 'search', '*', 'source_unavailable', {
          errorCode: 'SOURCE_UNAVAILABLE',
          errorMessage: `Source ${source.descriptor.id} is marked unavailable`,
        });
        continue;
      }

      // Iterate advertised supported resource types
      typeLoop: for (const resourceType of source.descriptor.supportedResourceTypes) {
        if (!searchedResourceTypes.includes(resourceType)) {
          searchedResourceTypes.push(resourceType);
        }

        let cursor: string | undefined = undefined;
        const seenCursors = new Set<string>();

        // Pagination loop
        pageLoop: while (true) {
          // Check cancellation & timeout
          if (signal?.aborted) {
            stoppingReason = 'cancelled';
            addTrace(source.descriptor.id, 'search', resourceType, 'cancelled', {
              errorCode: 'OPERATION_ABORTED',
              errorMessage: 'Retrieval was cancelled by user',
            });
            break sourceLoop;
          }

          if (performance.now() - startOverall > limits.timeoutMs) {
            stoppingReason = 'budget_exhausted';
            addTrace(source.descriptor.id, 'search', resourceType, 'budget_exhausted', {
              errorCode: 'TIMEOUT_EXCEEDED',
              errorMessage: `Execution time exceeded limit of ${limits.timeoutMs}ms`,
            });
            break sourceLoop;
          }

          if (counts.pages >= limits.maxSearchPages) {
            stoppingReason = 'budget_exhausted';
            addTrace(source.descriptor.id, 'search', resourceType, 'budget_exhausted', {
              errorCode: 'PAGE_LIMIT_REACHED',
              errorMessage: `Page query limit of ${limits.maxSearchPages} reached`,
            });
            break sourceLoop;
          }

          // Cursor loop check
          if (cursor) {
            if (seenCursors.has(cursor)) {
              stoppingReason = 'integrity_failure';
              integrityIssues.push(`Duplicate pagination cursor detected: ${cursor}`);
              addTrace(source.descriptor.id, 'search', resourceType, 'error', {
                cursor,
                errorCode: 'CURSOR_LOOP',
                errorMessage: 'Pagination cycle detected',
              });
              break typeLoop;
            }
            seenCursors.add(cursor);
          }

          // Check injected malformed cursor failure
          if (
            cursor &&
            input.injectedFailures?.malformedCursorSourceIds?.includes(source.descriptor.id)
          ) {
            stoppingReason = 'integrity_failure';
            integrityIssues.push(`Malformed cursor encountered: ${cursor}`);
            addTrace(source.descriptor.id, 'search', resourceType, 'error', {
              cursor,
              errorCode: 'MALFORMED_CURSOR',
              errorMessage: 'Injected malformed cursor failure',
            });
            break typeLoop;
          }

          counts.queries++;
          counts.pages++;

          let page;
          try {
            page = await source.search({
              patientId: input.patientId,
              resourceType,
              cursor,
              pageSize: limits.pageSize,
              signal,
            });
          } catch (err) {
            incompleteSources.push(source.descriptor.id);
            stoppingReason = 'source_unavailable';
            addTrace(source.descriptor.id, 'search', resourceType, 'error', {
              cursor,
              errorCode: 'SEARCH_FAILED',
              errorMessage: err instanceof Error ? err.message : String(err),
            });
            break typeLoop;
          }

          addTrace(source.descriptor.id, 'search', resourceType, 'success', {
            cursor,
            returnedCount: page.references.length,
            references: page.references,
          });

          // Read references
          for (const ref of page.references) {
            if (signal?.aborted) {
              stoppingReason = 'cancelled';
              break sourceLoop;
            }

            if (counts.reads >= limits.maxReads) {
              stoppingReason = 'budget_exhausted';
              addTrace(source.descriptor.id, 'read', ref.resourceType, 'budget_exhausted', {
                errorCode: 'READ_LIMIT_REACHED',
                errorMessage: `Read limit of ${limits.maxReads} reached`,
              });
              break sourceLoop;
            }

            if (
              input.injectedFailures?.failAfterReadCount !== undefined &&
              counts.reads >= input.injectedFailures.failAfterReadCount
            ) {
              stoppingReason = 'budget_exhausted';
              addTrace(source.descriptor.id, 'read', ref.resourceType, 'budget_exhausted', {
                errorCode: 'INJECTED_READ_CEILING',
                errorMessage: 'Injected read limit reached',
              });
              break sourceLoop;
            }

            counts.reads++;

            let sourceRecord: SourceRecord;
            try {
              sourceRecord = await source.read({
                patientId: input.patientId,
                reference: ref,
                signal,
              });
            } catch (err) {
              addTrace(source.descriptor.id, 'read', ref.resourceType, 'error', {
                errorCode: 'READ_FAILED',
                errorMessage: err instanceof Error ? err.message : String(err),
              });
              continue;
            }

            // Verify patient identity: reject wrong-patient records immediately
            if (sourceRecord.patientId !== input.patientId) {
              counts.rejectedRecords++;
              addTrace(source.descriptor.id, 'read', ref.resourceType, 'filtered_wrong_patient', {
                errorCode: 'PATIENT_ID_MISMATCH',
                errorMessage: `Record patient (${sourceRecord.patientId}) did not match expected patient (${input.patientId})`,
              });
              continue;
            }

            // Verify content hash
            const computedHash = hashCanonicalJson(sourceRecord.resource);
            if (computedHash !== ref.contentHash) {
              stoppingReason = 'integrity_failure';
              integrityIssues.push(
                `Content hash mismatch for ${ref.resourceId}: reference hash ${ref.contentHash} vs computed ${computedHash}`
              );
              addTrace(source.descriptor.id, 'read', ref.resourceType, 'error', {
                errorCode: 'HASH_MISMATCH',
                errorMessage: 'Content hash verification failed',
              });
              continue;
            }

            // Deduplication and Collision Handling
            const canonicalKey = ref.resourceId;
            const existingHash = resourceContentHashes.get(canonicalKey);

            if (existingHash !== undefined) {
              if (existingHash === computedHash) {
                // Byte-equivalent identical duplicate: merge provenance
                counts.duplicateRecords++;
                provenance[canonicalKey].push(ref);
                addTrace(source.descriptor.id, 'read', ref.resourceType, 'success', {
                  returnedCount: 1,
                  references: [ref],
                });
              } else {
                // Different content sharing canonical ID: INTEGRITY FAILURE!
                counts.conflictRecords++;
                stoppingReason = 'integrity_failure';
                const conflictMsg = `Integrity failure: Conflicting content detected for canonical ID ${canonicalKey} across sources.`;
                integrityIssues.push(conflictMsg);
                if (!provenance[canonicalKey]) provenance[canonicalKey] = [];
                provenance[canonicalKey].push(ref);
                addTrace(source.descriptor.id, 'read', ref.resourceType, 'error', {
                  errorCode: 'CANONICAL_ID_COLLISION',
                  errorMessage: conflictMsg,
                });
              }
            } else {
              // New unique eligible record
              counts.uniqueEligibleRecords++;
              resourceContentHashes.set(canonicalKey, computedHash);
              provenance[canonicalKey] = [ref];
              retrievedRecords.push(sourceRecord);
              addTrace(source.descriptor.id, 'read', ref.resourceType, 'success', {
                returnedCount: 1,
                references: [ref],
              });
            }
          }

          if (!page.nextCursor) {
            break pageLoop;
          }
          cursor = page.nextCursor;
        }
      }
    }

    const completeWithinScope =
      stoppingReason === 'completed' && incompleteSources.length === 0 && integrityIssues.length === 0;

    // 3. Materialize assembled bundle
    const materializedEntries = [...initialEntries];
    for (const record of retrievedRecords) {
      materializedEntries.push({ resource: record.resource });
    }

    const materializedBundle: Record<string, unknown> = {
      resourceType: 'Bundle',
      type: 'collection',
      entry: materializedEntries,
    };

    return {
      scopeKind: 'configured_sources',
      scopeDescription: 'Configured synthetic sources and advertised types.',
      completeWithinScope,
      stoppingReason,
      searchedSources,
      searchedResourceTypes,
      incompleteSources,
      retrievedRecords,
      provenance,
      trace,
      counts,
      materializedBundle,
      integrityIssues,
    };
  }
}
