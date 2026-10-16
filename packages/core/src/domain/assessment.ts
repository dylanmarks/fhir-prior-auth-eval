import { z } from 'zod';
import { EvidenceCitationSchema } from './evidence.js';
import { StepTraceSchema } from './trace.js';

export const RequirementStatusSchema = z.enum([
  'satisfied',
  'not_satisfied',
  'insufficient_evidence',
  'not_applicable',
]);

export type RequirementStatus = z.infer<typeof RequirementStatusSchema>;

export const RequirementEvaluationSchema = z.preprocess((val: any) => {
  if (val && typeof val === 'object') {
    const copy = { ...val };
    // Handle notes aliases
    if (copy.evaluatorNotes === undefined) {
      if (typeof copy.notes === 'string') copy.evaluatorNotes = copy.notes;
      else if (typeof copy.rationale === 'string') copy.evaluatorNotes = copy.rationale;
      else if (typeof copy.reason === 'string') copy.evaluatorNotes = copy.reason;
    }
    // Handle evidence object vs array
    if (copy.evidence != null && !Array.isArray(copy.evidence)) {
      if (typeof copy.evidence === 'object') {
        if (copy.evidence.resourceType || copy.evidence.resourceId || copy.evidence.id) {
          copy.evidence = [copy.evidence];
        } else if (Object.keys(copy.evidence).length === 0) {
          copy.evidence = [];
        } else {
          copy.evidence = [copy.evidence];
        }
      } else {
        copy.evidence = [];
      }
    } else if (copy.evidence == null) {
      copy.evidence = [];
    }
    return copy;
  }
  return val;
}, z.object({
  requirementId: z.string(),
  status: RequirementStatusSchema,
  confidence: z.preprocess(v => {
    if (typeof v === 'string') {
      const num = parseFloat(v.replace('%', ''));
      return v.includes('%') ? num / 100 : num;
    }
    return v;
  }, z.number().min(0).max(1)),
  evidence: z.array(EvidenceCitationSchema),
  evaluatorNotes: z.string().optional(),
  contradictionDetected: z.preprocess(v => typeof v === 'string' ? v.toLowerCase() === 'true' : v, z.boolean().optional()),
  escalationReason: z.string().optional(),
}));

export type RequirementEvaluation = z.infer<typeof RequirementEvaluationSchema>;

export const DispositionSchema = z.enum([
  'meets_policy',
  'needs_information',
  'requires_clinical_review',
]);

export type Disposition = z.infer<typeof DispositionSchema>;

export const AssessmentResultSchema = z.object({
  caseId: z.string(),
  policyId: z.string(),
  disposition: DispositionSchema,
  requirements: z.array(RequirementEvaluationSchema),
  missingInformation: z.array(z.string()),
  executionTrace: z.array(StepTraceSchema),
  totalCostUsd: z.number(),
  totalLatencyMs: z.number(),
  totalTokens: z.number(),
  usageVerified: z.boolean().optional(),
  costVerified: z.boolean().optional(),
});

export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;
