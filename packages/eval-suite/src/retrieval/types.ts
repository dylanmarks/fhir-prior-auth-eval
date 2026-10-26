import { z } from 'zod';
import {
  DispositionSchema,
  RequirementStatusSchema,
  RetrievalStoppingReasonSchema,
  GapKindSchema,
  NextActionTypeSchema,
  RetrievalInputSchema,
} from '@openpa/core';

export const GoldPacketFactAssertionSchema = z.object({
  field: z.string(),
  expectedValue: z.string(),
  resourceId: z.string().optional(),
  appliesTo: z.array(z.enum(['submitted_only', 'retrieval', 'full_corpus'])).optional(),
});
export type GoldPacketFactAssertion = z.infer<typeof GoldPacketFactAssertionSchema>;

export const GoldCriterionExpectationSchema = z.object({
  expectedStatusSubmitted: RequirementStatusSchema,
  expectedStatusRetrieval: RequirementStatusSchema,
  expectedStatusFullCorpus: RequirementStatusSchema.optional(),
  relevantResourceIds: z.array(z.string()),
  mandatoryConflictResourceIds: z.array(z.string()).optional(),
  alternativeEvidenceSets: z.array(z.array(z.string())).optional(),
  allowedCitationResourceIds: z.array(z.string()).optional(),
  expectedEvaluationStateRetrieval: z.enum(['evaluated', 'not_evaluated']).optional(),
  expectedGapKindSubmitted: GapKindSchema,
  expectedGapKindRetrieval: GapKindSchema,
  expectedNextActionTypeSubmitted: NextActionTypeSchema,
  expectedNextActionTypeRetrieval: NextActionTypeSchema,
  expectedGapKindFullCorpus: GapKindSchema.optional(),
  expectedNextActionTypeFullCorpus: NextActionTypeSchema.optional(),
  requiredPacketFacts: z.array(GoldPacketFactAssertionSchema).optional(),
});
export type GoldCriterionExpectation = z.infer<typeof GoldCriterionExpectationSchema>;

export const GoldSidecarSchema = z.object({
  scenarioId: z.string(),
  family: z.enum(['lumbar_mri', 'knee_mri']),
  variant: z.enum([
    'complete',
    'scattered',
    'missing',
    'contradictory',
    'unavailable',
    'budget_exhausted',
  ]),
  derivationSource: z.string(),
  syntheticProvenance: z.string(),
  goldReviewStatus: z.enum(['author_only', 'independently_reviewed', 'adjudicated']).default('author_only'),
  expectedDispositions: z.object({
    submittedOnly: DispositionSchema,
    retrieval: DispositionSchema,
    fullCorpus: DispositionSchema,
  }),
  expectedSearchCompleteness: z.object({
    submittedOnly: z.boolean(),
    retrieval: z.boolean(),
    fullCorpus: z.boolean(),
  }),
  expectedStoppingReason: z.object({
    submittedOnly: RetrievalStoppingReasonSchema,
    retrieval: RetrievalStoppingReasonSchema,
    fullCorpus: RetrievalStoppingReasonSchema,
  }),
  inaccessibleSources: z.array(z.string()).optional(),
  requiredButInaccessibleResourceIds: z.array(z.string()).optional(),
  criteria: z.record(GoldCriterionExpectationSchema),
});
export type GoldSidecar = z.infer<typeof GoldSidecarSchema>;

export const ScenarioFixtureSchema = RetrievalInputSchema.extend({
  sourceCorpus: z.record(z.array(z.record(z.unknown()))),
});
export type ScenarioFixture = z.infer<typeof ScenarioFixtureSchema>;

export const ScenarioManifestEntrySchema = z.object({
  scenarioId: z.string(),
  clinicalFactsFingerprint: z.string().optional(),
  family: z.enum(['lumbar_mri', 'knee_mri']),
  familyLabel: z.string(),
  variant: z.enum([
    'complete',
    'scattered',
    'missing',
    'contradictory',
    'unavailable',
    'budget_exhausted',
  ]),
  variantLabel: z.string(),
  title: z.string(),
  description: z.string(),
  expectedBehavior: z.string(),
});
export type ScenarioManifestEntry = z.infer<typeof ScenarioManifestEntrySchema>;
