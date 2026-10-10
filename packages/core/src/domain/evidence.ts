import { z } from 'zod';

export const EvidenceCitationSchema = z.object({
  resourceType: z.string(), // e.g. "Procedure", "Condition", "Observation"
  resourceId: z.string(),   // e.g. "Procedure/pt-therapy-102"
  jsonPath: z.string().optional(),
  textSnippet: z.string().optional(),
  date: z.string().optional(),
});

export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
