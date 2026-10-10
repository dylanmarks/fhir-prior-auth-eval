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

export const RequirementEvaluationSchema = z.object({
  requirementId: z.string(),
  status: RequirementStatusSchema,
  confidence: z.number().min(0).max(1),
  evidence: z.array(EvidenceCitationSchema),
  evaluatorNotes: z.string().optional(),
  contradictionDetected: z.boolean().optional(),
  escalationReason: z.string().optional(),
});

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
