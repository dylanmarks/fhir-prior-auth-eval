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
  contentFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
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
}).superRefine((packet, ctx) => {
  const ids = packet.criteria.map(row => row.requirementId);
  if (new Set(ids).size !== ids.length) ctx.addIssue({code: 'custom', message: 'Duplicate criterion rows'});
  for (const row of packet.criteria) {
    if (row.nextAction.targetRequirementId && row.nextAction.targetRequirementId !== row.requirementId) ctx.addIssue({code: 'custom', message: 'Unknown action criterion reference'});
  }
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
}).superRefine((result, ctx) => {
  const assessmentIds = new Set(result.assessment.requirements.map(r => r.requirementId));
  for (const row of result.reviewPacket.criteria) {
    if (!assessmentIds.has(row.requirementId)) ctx.addIssue({code: 'custom', message: 'Unknown packet criterion reference'});
    for (const citation of [...row.citations, ...row.conflictCitations ?? []]) {
      const refs = result.retrieval.provenance[citation.resourceId] ?? [];
      if (!refs.some(ref => ref.sourceId === citation.sourceId) || !citation.provenance.length || citation.provenance.some(ref => !refs.some(p => p.sourceId === ref.sourceId && p.resourceId === ref.resourceId && p.contentHash === ref.contentHash))) {
        ctx.addIssue({code: 'custom', message: 'Unknown packet source or provenance reference'});
      }
    }
  }
});
export type EvidenceWorkflowResult = z.infer<typeof EvidenceWorkflowResultSchema>;
