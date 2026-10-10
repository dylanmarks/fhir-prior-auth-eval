import type { StrategyOptions } from './strategies.js';
import { REASONING_EFFORTS, type ChatGptPlanOptions, type ReasoningEffort } from './llm/chatgpt-plan-evaluator.js';

/** Server/CLI only. Never return these options to a browser. */
export function providerOptionsFromEnv(env: Record<string, string | undefined> = process.env, chatgpt?: {getAccessToken: () => Promise<string>}): StrategyOptions {
  const number = (key: string, fallback?: number) => {
    if (env[key] == null || env[key] === '') return fallback;
    const value = Number(env[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative finite number`);
    return value;
  };
  const llm = (prefix: string) => env[`${prefix}_MODEL`] ? {
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: 'https://openrouter.ai/api/v1', model: env[`${prefix}_MODEL`],
    inputPricePerMillion: number(`${prefix}_INPUT_PRICE_PER_MILLION`),
    outputPricePerMillion: number(`${prefix}_OUTPUT_PRICE_PER_MILLION`),
    maxInputTokens: number(`${prefix}_MAX_INPUT_TOKENS`, 16000),
    maxOutputTokens: number(`${prefix}_MAX_OUTPUT_TOKENS`, 1024), maxRetries: 1,
  } : undefined;
  const provider = env.FRONTIER_LLM_PROVIDER ?? 'openrouter';
  if (!['openrouter', 'chatgpt-plan'].includes(provider)) throw new Error('FRONTIER_LLM_PROVIDER must be openrouter or chatgpt-plan');
  let frontierOptions: StrategyOptions['frontierOptions'] = provider === 'openrouter' ? llm('FRONTIER_LLM') : undefined;
  if (provider === 'chatgpt-plan') {
    if (!env.FRONTIER_LLM_MODEL) throw new Error('Select an explicit FRONTIER_LLM_MODEL for ChatGPT plan usage');
    const effort = env.FRONTIER_LLM_REASONING_EFFORT;
    if (effort && !REASONING_EFFORTS.includes(effort as ReasoningEffort)) throw new Error('Invalid FRONTIER_LLM_REASONING_EFFORT');
    frontierOptions = {provider: 'chatgpt-plan', model: env.FRONTIER_LLM_MODEL, reasoningEffort: effort as ReasoningEffort | undefined,
      getAccessToken: chatgpt?.getAccessToken ?? (async () => {throw new Error('ChatGPT authentication is unavailable in this runtime. Use the local evaluator or experiment CLI.');}),
      maxInputTokens: number('FRONTIER_LLM_MAX_INPUT_TOKENS', 16000), maxOutputTokens: number('FRONTIER_LLM_MAX_OUTPUT_TOKENS', 8192)} satisfies ChatGptPlanOptions;
  }
  return {
    jevOptions: {
      apiKey: env.OPENROUTER_API_KEY, model: env.JEV_MODEL ?? 'typesafe/jev-1.13',
      inputPricePerMillion: number('JEV_INPUT_PRICE_PER_MILLION'),
      outputPricePerMillion: number('JEV_OUTPUT_PRICE_PER_MILLION'),
      maxInputTokens: number('JEV_MAX_INPUT_TOKENS', 16000), maxOutputTokens: number('JEV_MAX_OUTPUT_TOKENS', 2048),
    },
    llmOptions: llm('SMALL_LLM'), frontierOptions,
    budgetCapUsd: number('CASE_BUDGET_USD', 0.1),
    orchestratorOptions: {maxTokensPerRun: number('CASE_TOKEN_BUDGET', 100000), timeoutMs: number('CASE_TIMEOUT_MS', 120000)},
  };
}

export function providerSummary(options: StrategyOptions, chatgptPlanEnabled = false) {
  const frontier = options.frontierOptions;
  const plan = frontier && 'provider' in frontier;
  return {
    jev: {configured: !!options.jevOptions?.apiKey, model: options.jevOptions?.model ?? 'typesafe/jev-1.13'},
    small: {configured: !!options.llmOptions?.apiKey, model: options.llmOptions?.model ?? null},
    frontier: {configured: plan ? chatgptPlanEnabled : !!frontier?.apiKey, model: frontier?.model ?? null, provider: plan ? 'chatgpt-plan' : 'openrouter', reasoningEffort: plan ? frontier.reasoningEffort ?? 'default' : null},
    budgetCapUsd: options.budgetCapUsd ?? 0.1,
  };
}
