import { z } from 'zod';
import { RequestedServiceSchema } from './case.js';
import { DispositionSchema, RequirementStatusSchema, AssessmentResultSchema } from './assessment.js';
import {
  RetrievalResultSchema,
  RetrievalScopeKindSchema,
  RetrievalStoppingReasonSchema,
  SourceRecordRefSchema,
} from './retrieval.js';

export const GapKindSchema = z.enum([
  'not_found_in_searched_sources',
  'source_unavailable',
  'search_incomplete',
  'conflicting_evidence',
  'documented_not_met',
  'interpretation_required',
  'not_evaluated',
  'none',
]);
export type GapKind = z.infer<typeof GapKindSchema>;

export const NextActionTypeSchema = z.enum([
  'request_documentation',
  'restore_source_access',
  'continue_search',
  'reconcile_conflict',
  'clinical_interpretation',
  'none',
]);
export type NextActionType = z.infer<typeof NextActionTypeSchema>;

export const ResponsibleRoleSchema = z.enum([
  'ordering_provider',
  'clinical_reviewer',
  'integration_administrator',
  'records_clerk',
  'none',
]);
export type ResponsibleRole = z.infer<typeof ResponsibleRoleSchema>;

export const NextActionSchema = z.object({
  type: NextActionTypeSchema,
  description: z.string(),
  proposedRole: ResponsibleRoleSchema,
  targetRequirementId: z.string().optional(),
});
export type NextAction = z.infer<typeof NextActionSchema>;

export const ReviewPacketCitationSchema = z.object({
  resourceType: z.string(),
  resourceId: z.string(),
  sourceId: z.string(),
  date: z.string().optional(),
  excerpt: z.string().optional(),
  provenance: z.array(SourceRecordRefSchema),
  contentHash: z.string().optional(),
  isContradiction: z.boolean().optional(),
});
export type ReviewPacketCitation = z.infer<typeof ReviewPacketCitationSchema>;

export const CriterionEvaluationStateSchema = z.enum(['evaluated', 'not_evaluated']);
export type CriterionEvaluationState = z.infer<typeof CriterionEvaluationStateSchema>;

export const CriterionReviewRowSchema = z.object({
  requirementId: z.string(),
  description: z.string(),
  evaluationState: CriterionEvaluationStateSchema,
  status: RequirementStatusSchema.optional(),
  confidence: z.number().min(0).max(1).optional(),
  citations: z.array(ReviewPacketCitationSchema),
  conflictCitations: z.array(ReviewPacketCitationSchema).optional(),
  evaluatorNotes: z.string().optional(),
  gapKind: GapKindSchema,
  nextAction: NextActionSchema,
});
export type CriterionReviewRow = z.infer<typeof CriterionReviewRowSchema>;

export const ReviewPacketPurposeSchema = z.enum([
  'assessment_summary',
  'documentation_follow_up',
  'clinical_review',
]);
export type ReviewPacketPurpose = z.infer<typeof ReviewPacketPurposeSchema>;

export const ReviewPacketScopeSchema = z.object({
  kind: RetrievalScopeKindSchema,
  completeWithinScope: z.boolean(),
  stoppingReason: RetrievalStoppingReasonSchema,
  description: z.string(),
});
export type ReviewPacketScope = z.infer<typeof ReviewPacketScopeSchema>;

export const ReviewPacketSchema = z.object({
  schemaVersion: z.string().default('1.0.0'),
  generatedAt: z.string(),
  contentFingerprint: z.string(),
  scenarioId: z.string(),
  patientId: z.string(),
  policyId: z.string(),
  policyVersion: z.string().optional(),
  requestedService: RequestedServiceSchema,
  purpose: ReviewPacketPurposeSchema,
  workflowDisposition: DispositionSchema,
  retrievalScope: ReviewPacketScopeSchema,
  criteria: z.array(CriterionReviewRowSchema),
  unresolvedItems: z.array(z.string()),
  integrityIssues: z.array(z.string()),
});
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;

export const WorkflowTimingsSchema = z.object({
  retrievalMs: z.number().nonnegative(),
  assessmentMs: z.number().nonnegative(),
  packetMs: z.number().nonnegative(),
  totalMs: z.number().nonnegative(),
});
export type WorkflowTimings = z.infer<typeof WorkflowTimingsSchema>;

export const EvidenceWorkflowResultSchema = z.object({
  scenarioId: z.string(),
  workflowDisposition: DispositionSchema,
  assessment: AssessmentResultSchema,
  retrieval: RetrievalResultSchema,
  reviewPacket: ReviewPacketSchema,
  timings: WorkflowTimingsSchema,
});
export type EvidenceWorkflowResult = z.infer<typeof EvidenceWorkflowResultSchema>;
