import type { PriorAuthCase, MedicalPolicy } from '@openpa/core';
import { TieredOrchestrator, createEvaluationOrchestrator, type StrategyName } from '@openpa/evaluators';
import { ScoringEngine, type BenchmarkAggregateMetrics } from '../metrics/scoring.js';

export interface HarnessRunOptions {
  orchestrator?: TieredOrchestrator;
  strategy?: StrategyName;
  budgetCapUsd?: number;
}

export class BenchmarkHarness {
  private orchestrator: TieredOrchestrator;

  constructor(options?: HarnessRunOptions) {
    if (options?.orchestrator) {
      this.orchestrator = options.orchestrator;
    } else {
      const strategyName = options?.strategy ?? 'rules';
      this.orchestrator = createEvaluationOrchestrator(strategyName, {
        budgetCapUsd: options?.budgetCapUsd ?? 0.05,
      });
    }
  }

  public async runBenchmark(
    cases: PriorAuthCase[],
    policies: MedicalPolicy[]
  ): Promise<BenchmarkAggregateMetrics> {
    const policyMap = new Map<string, MedicalPolicy>();
    for (const p of policies) {
      policyMap.set(p.id, p);
    }

    const caseScores = [];

    for (const c of cases) {
      const policy = policyMap.get(c.policyId);
      if (!policy) {
        throw new Error(`Policy not found for case ${c.id}: ${c.policyId}`);
      }

      const assessment = await this.orchestrator.evaluateCase(c, policy);
      const score = ScoringEngine.scoreCase(c, assessment);
      caseScores.push(score);
    }

    return ScoringEngine.aggregateScores(caseScores);
  }
}
