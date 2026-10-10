import { z } from 'zod';

export const NumericThresholdSchema = z.object({
  comparator: z.enum(['>=', '>', '<=', '<', '==']),
  value: z.number().finite(),
  unit: z.string().optional(),
});

export type NumericThreshold = z.infer<typeof NumericThresholdSchema>;

export const PolicyRequirementSchema = z.object({
  id: z.string(),
  description: z.string(),
  rationale: z.string().optional(),
  required: z.boolean(),
  timeWindowDays: z.number().finite().nonnegative().nullable().optional(),
  minimumDurationDays: z.number().finite().positive().optional(),
  requiresDocumentedAdherence: z.boolean().optional(),
  requiresPersistentSymptoms: z.boolean().optional(),
  acceptableCodeSystems: z.array(z.string()).optional(),
  acceptableCodes: z.array(z.string()).optional(),
  category: z.enum([
    'diagnosis',
    'conservative_therapy',
    'imaging_prerequisite',
    'functional_deficit',
    'contraindication',
    'other',
  ]).optional().default('other'),
  numericThreshold: NumericThresholdSchema.optional(),
  laterality: z.enum(['left', 'right', 'bilateral', 'unspecified']).optional(),
  bodySite: z.string().optional(),
  narrativeConcepts: z.array(z.string().min(1)).optional(),
});

export type PolicyRequirement = z.infer<typeof PolicyRequirementSchema>;

export const MedicalPolicySchema = z.object({
  id: z.string(),
  title: z.string(),
  version: z.string(),
  source: z.string().optional(), // e.g. "CMS LCD L34220", "Commercial Clinical Guideline"
  narrative: z.string(),
  serviceCodes: z.array(z.string()), // CPT/HCPCS codes, e.g. ["72148"]
  requirements: z.array(PolicyRequirementSchema),
});

export type MedicalPolicy = z.infer<typeof MedicalPolicySchema>;
