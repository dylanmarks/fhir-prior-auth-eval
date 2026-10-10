import type { PolicyEvaluator } from './types.js';
import { DeterministicRulesEvaluator } from './deterministic/rules-evaluator.js';
import { JevDecisionEvaluator, type JevEvaluatorOptions } from './jev/jev-evaluator.js';
import { StructuredLlmEvaluator, type StructuredLlmOptions } from './llm/structured-llm-evaluator.js';
import { MockLlmEvaluator, type MockLlmOptions } from './mock/mock-llm-evaluator.js';
import { TieredOrchestrator, type TieredOrchestratorOptions } from './tiered/tiered-orchestrator.js';
import { ChatGptPlanEvaluator, type ChatGptPlanOptions } from './llm/chatgpt-plan-evaluator.js';

export type EvaluationStrategyName = 'rules' | 'cheap' | 'tiered' | 'llm' | 'simulation';
export type StrategyName = EvaluationStrategyName;

export interface StrategyOptions {
  llmOptions?: StructuredLlmOptions;
  jevOptions?: JevEvaluatorOptions;
  frontierOptions?: StructuredLlmOptions | ChatGptPlanOptions;
  mockOptions?: MockLlmOptions;
  orchestratorOptions?: TieredOrchestratorOptions;
  budgetCapUsd?: number;
}

/**
 * Shared evaluation strategy factory used across CLI, Workbench UI, MCP server, and benchmarks.
 *
 * Ordinary evaluation strategies ('rules' and 'tiered') contain strictly real/abstaining components:
 * - 'rules': Tier 1 deterministic rules engine ($0.00 cost)
 * - 'tiered': Rules -> live typed Jev -> small LLM -> optional frontier (unconfigured tiers abstain)
 *
 * Synthetic mock fixtures are strictly isolated behind the explicit 'simulation' mode.
 */
export function createEvaluationStrategy(
  strategyName: EvaluationStrategyName = 'tiered',
  options?: StrategyOptions
): PolicyEvaluator[] {
  const frontier = (tierLevel?: number) => options?.frontierOptions && 'provider' in options.frontierOptions
    ? new ChatGptPlanEvaluator({...options.frontierOptions, tierLevel})
    : new StructuredLlmEvaluator({...options?.frontierOptions, tierLevel});
  switch (strategyName) {
    case 'rules':
      return [new DeterministicRulesEvaluator()];
    case 'tiered':
      return [
        new DeterministicRulesEvaluator(),
        new JevDecisionEvaluator(options?.jevOptions),
        new StructuredLlmEvaluator(options?.llmOptions),
        ...(options?.frontierOptions ? [frontier(4)] : []),
      ];
    case 'cheap':
      return [new DeterministicRulesEvaluator(), new JevDecisionEvaluator(options?.jevOptions)];
    case 'llm':
      return [options?.frontierOptions ? frontier(3) : new StructuredLlmEvaluator(options?.llmOptions)];
    case 'simulation':
      return [
        new DeterministicRulesEvaluator(),
        new JevDecisionEvaluator(),
        new MockLlmEvaluator('mock-tier-3', 'Mock LLM Simulation Fixture', options?.mockOptions),
      ];
    default:
      throw new Error(`Unknown evaluation strategy: '${strategyName}'.`);
  }
}

export function createEvaluationOrchestrator(
  strategyName: EvaluationStrategyName = 'tiered',
  options?: StrategyOptions
): TieredOrchestrator {
  const evaluators = createEvaluationStrategy(strategyName, options);
  const orchOpts: TieredOrchestratorOptions = {
    ...options?.orchestratorOptions,
    budgetCapUsd: options?.budgetCapUsd ?? options?.orchestratorOptions?.budgetCapUsd ?? 0.05,
  };
  return new TieredOrchestrator(evaluators, orchOpts);
}
