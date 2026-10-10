import { z } from 'zod';
import { RequirementEvaluationSchema, DispositionSchema } from './assessment.js';

export const RequestedServiceSchema = z.object({
  codeSystem: z.string().default('http://www.ama-assn.org/go/cpt'),
  code: z.string(), // e.g. "72148"
  description: z.string(),
  diagnosisCodes: z.array(z.string()), // ICD-10 codes, e.g. ["M54.5", "M54.41"]
  laterality: z.enum(['left', 'right', 'bilateral', 'unspecified']).optional(),
  bodySite: z.string().optional(),
  placeOfService: z.string().optional(),
  orderingProvider: z.object({
    npi: z.string(),
    name: z.string(),
    specialty: z.string().optional(),
  }).optional(),
});

export type RequestedService = z.infer<typeof RequestedServiceSchema>;

export const ExpectedAssessmentSchema = z.object({
  disposition: DispositionSchema,
  requirements: z.array(RequirementEvaluationSchema),
  missingInformation: z.array(z.string()).default([]),
});

export type ExpectedAssessment = z.infer<typeof ExpectedAssessmentSchema>;

export const PriorAuthCaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  scenarioCategory: z.enum([
    'lumbar_mri',
    'knee_mri',
    'pt_extension',
    'sleep_study',
    'dme',
    'other',
  ]),
  patientBundle: z.record(z.unknown()), // FHIR R4 Bundle
  requestedService: RequestedServiceSchema,
  policyId: z.string(),
  requestedAt: z.string().refine(value => !Number.isNaN(Date.parse(value)), 'Invalid request date').optional(),
  expectedAssessment: ExpectedAssessmentSchema,
  tags: z.array(z.string()).default([]),
  source: z.string().optional(), // e.g. "synthetic_hospital:patient_102"
});

export type PriorAuthCase = z.infer<typeof PriorAuthCaseSchema>;
