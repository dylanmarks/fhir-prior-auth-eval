import { z } from 'zod';

export const StepTraceSchema = z.object({
  stepNumber: z.number(),
  tierLevel: z.number(), // 1 = rules, 2 = bounded/jev, 3 = small llm, 4 = frontier llm
  tierName: z.string(),
  model: z.string(),
  providerModel: z.string().optional(),
  billingSource: z.enum(['chatgpt-plan']).optional(),
  costVerified: z.boolean().optional(),
  reasoningEffort: z.string().optional(),
  action: z.string(),
  requirementId: z.string().optional(),
  inputSummary: z.string().optional(),
  decision: z.string(),
  confidence: z.number().min(0).max(1),
  modelCertainty: z.number().min(0).max(1).optional(),
  latencyMs: z.number(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().default(0),
  status: z.enum(['success', 'fallback', 'failed', 'budget_exceeded', 'escalated']),
});

export type StepTrace = z.infer<typeof StepTraceSchema>;
