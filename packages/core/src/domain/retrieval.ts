import { z } from 'zod';
import { RequestedServiceSchema } from './case.js';

export const SourceAvailabilitySchema = z.enum(['available', 'unavailable', 'degraded']);
export type SourceAvailability = z.infer<typeof SourceAvailabilitySchema>;

export const SourceDescriptorSchema = z.object({
  id: z.string(),
  name: z.string(),
  supportedResourceTypes: z.array(z.string()),
  availability: SourceAvailabilitySchema.default('available'),
});
export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;

export const SourceRecordRefSchema = z.object({
  sourceId: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/, 'Expected SHA-256 hash'),
});
export type SourceRecordRef = z.infer<typeof SourceRecordRefSchema>;

export const SourceRecordSchema = z.object({
  reference: SourceRecordRefSchema,
  patientId: z.string(),
  resource: z.record(z.unknown()),
});
export type SourceRecord = z.infer<typeof SourceRecordSchema>;

export const SearchPageSchema = z.object({
  references: z.array(SourceRecordRefSchema),
  rejectedCount: z.number().int().nonnegative().optional(),
  nextCursor: z.string().min(1).optional(),
  totalCount: z.number().int().nonnegative().optional(),
});
export type SearchPage = z.infer<typeof SearchPageSchema>;

export const RetrievalTraceOutcomeSchema = z.enum([
  'success',
  'filtered_wrong_patient',
  'source_unavailable',
  'rate_limited',
  'error',
  'budget_exhausted',
  'cancelled',
]);
export type RetrievalTraceOutcome = z.infer<typeof RetrievalTraceOutcomeSchema>;

export const RetrievalTraceEventSchema = z.object({
  sequence: z.number().int().nonnegative(),
  sourceId: z.string(),
  operation: z.enum(['search', 'read']),
  resourceType: z.string(),
  cursor: z.string().optional(),
  returnedCount: z.number().int().nonnegative().optional(),
  references: z.array(SourceRecordRefSchema).optional(),
  outcome: RetrievalTraceOutcomeSchema,
  elapsedMs: z.number().nonnegative(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});
export type RetrievalTraceEvent = z.infer<typeof RetrievalTraceEventSchema>;

export const RetrievalLimitsSchema = z.object({
  maxSources: z.number().int().positive().default(4),
  maxSearchPages: z.number().int().positive().default(16),
  pageSize: z.number().int().positive().default(5),
  maxReads: z.number().int().positive().default(24),
  timeoutMs: z.number().int().positive().default(10000),
});
export type RetrievalLimits = z.infer<typeof RetrievalLimitsSchema>;

export const RetrievalStoppingReasonSchema = z.enum([
  'completed',
  'source_unavailable',
  'budget_exhausted',
  'cancelled',
  'integrity_failure',
]);
export type RetrievalStoppingReason = z.infer<typeof RetrievalStoppingReasonSchema>;

export const RetrievalScopeKindSchema = z.enum(['initial_submission', 'configured_sources']);
export type RetrievalScopeKind = z.infer<typeof RetrievalScopeKindSchema>;

export const InjectedRetrievalFailuresSchema = z.object({
  unavailableSourceIds: z.array(z.string()).optional(),
  failAfterReadCount: z.number().int().nonnegative().optional(),
  malformedCursorSourceIds: z.array(z.string()).optional(),
});
export type InjectedRetrievalFailures = z.infer<typeof InjectedRetrievalFailuresSchema>;

export const RetrievalInputSchema = z.object({
  scenarioId: z.string(),
  patientId: z.string(),
  initialBundle: z.record(z.unknown()),
  requestedService: RequestedServiceSchema,
  requestedAt: z.string().refine(val => !Number.isNaN(Date.parse(val)), 'Invalid request date').optional(),
  policyId: z.string(),
  sources: z.array(SourceDescriptorSchema),
  limits: RetrievalLimitsSchema.partial().optional(),
  injectedFailures: InjectedRetrievalFailuresSchema.optional(),
});
export type RetrievalInput = z.infer<typeof RetrievalInputSchema>;

export const RetrievalCountsSchema = z.object({
  queries: z.number().int().nonnegative(),
  pages: z.number().int().nonnegative(),
  reads: z.number().int().nonnegative(),
  uniqueEligibleRecords: z.number().int().nonnegative(),
  duplicateRecords: z.number().int().nonnegative(),
  rejectedRecords: z.number().int().nonnegative(),
  conflictRecords: z.number().int().nonnegative(),
});
export type RetrievalCounts = z.infer<typeof RetrievalCountsSchema>;

export const RetrievalResultSchema = z.object({
  scopeKind: RetrievalScopeKindSchema,
  scopeDescription: z.string(),
  completeWithinScope: z.boolean(),
  stoppingReason: RetrievalStoppingReasonSchema,
  searchedSources: z.array(z.string()),
  searchedResourceTypes: z.array(z.string()),
  incompleteSources: z.array(z.string()),
  retrievedRecords: z.array(SourceRecordSchema),
  provenance: z.record(z.array(SourceRecordRefSchema)),
  trace: z.array(RetrievalTraceEventSchema),
  counts: RetrievalCountsSchema,
  materializedBundle: z.record(z.unknown()),
  integrityIssues: z.array(z.string()),
});
export type RetrievalResult = z.infer<typeof RetrievalResultSchema>;
