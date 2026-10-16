import { z } from 'zod';

export const EvidenceCitationSchema = z.preprocess((val: any) => {
  if (val && typeof val === 'object') {
    const copy = { ...val };
    if (!copy.resourceId && copy.id) copy.resourceId = copy.id;
    if (!copy.resourceType && copy.type) copy.resourceType = copy.type;
    return copy;
  }
  return val;
}, z.object({
  resourceType: z.string(), // e.g. "Procedure", "Condition", "Observation"
  resourceId: z.string(),   // e.g. "Procedure/pt-therapy-102"
  jsonPath: z.string().optional(),
  textSnippet: z.string().optional(),
  date: z.string().optional(),
}));

export type EvidenceCitation = z.infer<typeof EvidenceCitationSchema>;
