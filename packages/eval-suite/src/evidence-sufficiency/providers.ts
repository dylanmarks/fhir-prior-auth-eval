import { createEvaluationStrategy, StructuredLlmEvaluator, type StrategyOptions } from '@openpa/evaluators';
import type { EvaluatorBinding, Strategy } from './types.js';

/** Export only whitelisted nonsecret settings to recordings and reports. */
export function publicConfiguration(options: StrategyOptions) {
  const safe = (setting: StrategyOptions['llmOptions'] | StrategyOptions['frontierOptions'] | StrategyOptions['jevOptions']) => {
    if (!setting) return {configured: false};
    const input = setting as unknown as Record<string, unknown>;
    return Object.fromEntries(['model','tierLevel','maxInputTokens','maxOutputTokens','maxRetries','inputPricePerMillion','outputPricePerMillion','provider','reasoningEffort'].filter(k => input[k] !== undefined).map(k => [k,input[k]]));
  };
  return {rules: {adapter: 'deterministic-rules'}, jev: {adapter:'jev-decisions',...safe(options.jevOptions)}, small: {adapter:'structured-chat-completions',...safe(options.llmOptions)}, frontier: {adapter:options.frontierOptions && 'provider' in options.frontierOptions ? 'chatgpt-plan' : 'structured-chat-completions',...safe(options.frontierOptions)}};
}

export function createBindings(options: StrategyOptions, availability: {jev: boolean; small: boolean; frontier: boolean}) {
  const configured = createEvaluationStrategy('tiered', options);
  if (!configured.some(e => e.tierLevel === 4)) configured.push(new StructuredLlmEvaluator({tierLevel: 4}));
  const frontierBaseline = options.frontierOptions ? createEvaluationStrategy('llm', options)[0] : new StructuredLlmEvaluator({tierLevel: 3});
  const settings = publicConfiguration(options);
  const bindings: Record<string, EvaluatorBinding> = {
    rules: {key: 'rules', evaluator: configured[0], configured: true, provider: false, configuration: settings.rules},
    jev: {key: 'jev', evaluator: configured[1], configured: availability.jev, provider: true, configuration: settings.jev},
    small: {key: 'small', evaluator: configured[2], configured: availability.small, provider: true, configuration: settings.small},
    frontier: {key: 'frontier', evaluator: configured[3], configured: availability.frontier, provider: true, configuration: settings.frontier},
    'frontier-baseline': {key: 'frontier-baseline', evaluator: frontierBaseline, configured: availability.frontier, provider: true, configuration: settings.frontier},
  };
  const strategyBindings: Record<Strategy, string[]> = {rules: ['rules'], cheap: ['rules','jev'], tiered: ['rules','jev','small','frontier'], llm: ['frontier-baseline']};
  return {bindings, strategyBindings, configuration: settings};
}
