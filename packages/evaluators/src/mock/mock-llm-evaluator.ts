import type { PolicyRequirement, EvidenceCitation } from '@openpa/core';
import type { PolicyEvaluator, EvaluatorContext, EvaluatorResult } from '../types.js';

export interface MockLlmOptions {
  tierLevel?: number;
  costPer1kTokens?: number;
  simulatedLatencyMs?: number;
  confidenceToReturn?: number;
  forceStatus?: 'satisfied' | 'not_satisfied' | 'insufficient_evidence';
  produceUngroundedCitation?: boolean;
  simulateFailure?: boolean;
  hangMs?: number;
}

/**
 * Synthetic test mock adapter.
 *
 * NOTE: For unit testing cascade orchestration, timeout handling, budget exhaustion,
 * and UI demonstrations only. This adapter makes no clinical quality claims.
 */
export class MockLlmEvaluator implements PolicyEvaluator {
  public readonly id: string;
  public readonly name: string;
  public readonly tierLevel: number;
  private costPer1kTokens: number;
  private simulatedLatencyMs: number;
  private confidenceToReturn: number;
  private options: MockLlmOptions;

  constructor(id = 'mock-small-llm', name = 'Mock LLM Test Fixture (Tier 3)', options?: MockLlmOptions) {
    this.id = id;
    this.name = name;
    this.tierLevel = options?.tierLevel ?? 3;
    this.costPer1kTokens = options?.costPer1kTokens ?? 0.0015;
    this.simulatedLatencyMs = options?.simulatedLatencyMs ?? 10;
    this.confidenceToReturn = options?.confidenceToReturn ?? 0.92;
    this.options = options ?? {};
  }

  get maxTokens(): number {
    return 570;
  }
  get maxCostUsd(): number {
    return (570 / 1000) * this.costPer1kTokens;
  }

  public async evaluateRequirement(
    requirement: PolicyRequirement,
    context: EvaluatorContext
  ): Promise<EvaluatorResult> {
    const startTime = performance.now();

    if (this.options.hangMs && this.options.hangMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.options.hangMs));
    }

    if (this.options.simulateFailure) {
      throw new Error("Simulated mock provider API failure (500 Internal Error)");
    }

    if (this.simulatedLatencyMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.simulatedLatencyMs));
    }

    // Ungrounded citation injection test mode
    if (this.options.produceUngroundedCitation) {
      return {
        status: 'satisfied',
        confidence: 0.95,
        evidence: [
          {
            resourceType: 'Condition',
            resourceId: 'Condition/non-existent-hallucinated-id',
            textSnippet: 'Fabricated non-existent clinical snippet',
            date: '2026-01-01',
          },
        ],
        notes: 'Injected ungrounded citation for guardrail testing.',
        metrics: {
          costUsd: 0.0005,
          latencyMs: Math.max(0, performance.now() - startTime),
          inputTokens: 200,
          outputTokens: 50,
        },
      };
    }

    // Find actual matching resources matching acceptable codes or keywords
    const candidateEvidence: EvidenceCitation[] = [];
    const targetCodes = requirement.acceptableCodes ?? [];

    const types = requirement.category === 'diagnosis'
      ? ['Condition']
      : requirement.category === 'imaging_prerequisite'
      ? ['DiagnosticReport', 'Procedure']
      : ['Procedure', 'Condition', 'Observation'];

    const matches = types.flatMap(t => context.indexer.findByCode(t, targetCodes, requirement.acceptableCodeSystems));

    for (const match of matches) {
      candidateEvidence.push({
        resourceType: match.resourceType,
        resourceId: `${match.resourceType}/${match.id}`,
        date: match.date,
        textSnippet: match.textSnippet,
      });
    }

    const inputTokens = 450;
    const outputTokens = 120;
    const totalTokens = inputTokens + outputTokens;
    const costUsd = Number(((totalTokens / 1000) * this.costPer1kTokens).toFixed(6));

    if (this.options.forceStatus) {
      return {
        status: this.options.forceStatus,
        confidence: this.confidenceToReturn,
        evidence: this.options.forceStatus === 'satisfied' ? candidateEvidence : [],
        notes: `Simulated forced status: ${this.options.forceStatus}`,
        metrics: {
          costUsd,
          latencyMs: Math.max(0, performance.now() - startTime),
          inputTokens,
          outputTokens,
        },
      };
    }

    // Check for explicit clinical negation or contradictory narrative
    const hasContradiction = candidateEvidence.some(e => {
      const text = (e.textSnippet ?? '').toLowerCase();
      return /\b(denies|negative for|no history of|resolved|rule out|discontinued|stopped)\b/i.test(text);
    });

    if (hasContradiction) {
      return {
        status: 'insufficient_evidence',
        confidence: 0,
        evidence: candidateEvidence,
        notes: `Simulated LLM detected conflicting narrative or clinical negation for requirement ${requirement.id}; requires clinical review.`,
        contradictionDetected: true,
        escalateToClinicalReview: true,
        escalationReason: 'narrative_negation',
        metrics: {
          costUsd,
          latencyMs: Math.max(0, performance.now() - startTime),
          inputTokens,
          outputTokens,
        },
      };
    }

    if (candidateEvidence.length > 0) {
      return {
        status: 'satisfied',
        confidence: this.confidenceToReturn,
        evidence: candidateEvidence,
        notes: `Simulated LLM extracted supportive evidence for requirement ${requirement.id}.`,
        metrics: {
          costUsd,
          latencyMs: Math.max(0, performance.now() - startTime),
          inputTokens,
          outputTokens,
        },
      };
    }

    return {
      status: 'insufficient_evidence',
      confidence: this.confidenceToReturn,
      evidence: [],
      notes: `Simulated LLM determined that documentation is absent for ${requirement.id}.`,
      metrics: {
        costUsd,
        latencyMs: Math.max(0, performance.now() - startTime),
        inputTokens,
        outputTokens,
      },
    };
  }
}
