import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FhirBundleIndexer } from '@openpa/core';
import { ChatGptPlanEvaluator, createEvaluationStrategy, providerOptionsFromEnv, providerSummary, TieredOrchestrator } from '@openpa/evaluators';
import { runExperiment } from '../src/experiments.js';

const c = JSON.parse(readFileSync('datasets/narrative/cases/dev-progress.json', 'utf8'));
const p = JSON.parse(readFileSync('datasets/narrative/policy.json', 'utf8'));
const requirement = p.requirements[0];
const context = () => ({caseData: c, indexer: new FhirBundleIndexer(c.patientBundle)});
const assessment = {requirementId: requirement.id, status: 'insufficient_evidence', confidence: .95, evidence: [], evaluatorNotes: 'Synthetic test', contradictionDetected: false};
const opts = {provider: 'chatgpt-plan' as const, model: 'gpt-6-luna', reasoningEffort: 'low' as const, getAccessToken: async () => 'synthetic-token', maxInputTokens: 16000, maxOutputTokens: 8192};
const frame = (event: unknown) => `data: ${JSON.stringify(event)}\r\n\r\n`;
function completed(overrides = {}) {return {type: 'response.completed', response: {status: 'completed', model: 'resolved-luna-snapshot', usage: {input_tokens: 100, output_tokens: 20}, output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: JSON.stringify(assessment)}]}], ...overrides}};}
function stream(events: unknown[], chunkSize = 7) {
  const bytes = new TextEncoder().encode(events.map(frame).join(''));
  let offset = 0;
  return new Response(new ReadableStream({pull(controller) {if (offset === bytes.length) return controller.close(); controller.enqueue(bytes.slice(offset, offset + chunkSize)); offset = Math.min(offset + chunkSize, bytes.length);}}), {headers: {'Content-Type': 'text/event-stream'}});
}
afterEach(() => vi.unstubAllGlobals());
describe('ChatGPT Responses provider', () => {
  it('streams chunked SSE, uses supported fields and preserves model/effort without fake dollar cost', async () => {
    let body: any;
    const fetch = vi.fn(async (url, init) => {expect(url).toBe('https://api.openai.com/v1/responses'); expect(init.headers.Authorization).toBe('Bearer synthetic-token'); body = JSON.parse(init.body); return stream([{type: 'response.output_text.delta', delta: 'partial'}, completed()]);});
    vi.stubGlobal('fetch', fetch);
    const result = await new ChatGptPlanEvaluator(opts).evaluateRequirement(requirement, context());
    expect(body).toMatchObject({model: opts.model, reasoning: {effort: 'low'}, stream: true, store: false, input: [{role: 'user'}]});
    expect(body.max_output_tokens).toBeUndefined(); expect(body.messages).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(c.id); expect(JSON.stringify(body)).not.toContain('expectedAssessment');
    expect(result.metrics).toMatchObject({providerModel: 'resolved-luna-snapshot', reasoningEffort: 'low', inputTokens: 100, outputTokens: 20, costVerified: false, billingSource: 'chatgpt-plan'});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('does not accept partial text or an interrupted stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => stream([{type: 'response.output_text.delta', delta: JSON.stringify(assessment)}])));
    await expect(new ChatGptPlanEvaluator(opts).evaluateRequirement(requirement, context())).rejects.toMatchObject({usageVerified: false, metrics: {costVerified: false}});
  });
  it.each(['response.failed', 'response.incomplete'])('rejects %s after streaming starts and never falls back', async type => {
    const fetch = vi.fn(async () => stream([{type: 'response.output_text.delta', delta: JSON.stringify(assessment)}, {type, response: {error: {code: 'subscription_sharing_usage_limit_exceeded'}}}]));
    vi.stubGlobal('fetch', fetch);
    await expect(new ChatGptPlanEvaluator(opts).evaluateRequirement(requirement, context())).rejects.toThrow('ChatGPT usage limit reached');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403, 429, 503])('does not retry or switch billing on HTTP %s', async status => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({error: {code: 'subscription_sharing_user_not_eligible', message: 'secret'}}), {status})); vi.stubGlobal('fetch', fetch);
    const result = new ChatGptPlanEvaluator(opts).evaluateRequirement(requirement, context());
    await expect(result).rejects.toThrow('No paid fallback'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects missing usage, invalid schema, and mismatched requirement IDs', async () => {
    for (const event of [completed({usage: undefined}), completed({output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: '{}'}]}]}), completed({output: [{type: 'message', role: 'assistant', content: [{type: 'output_text', text: JSON.stringify({...assessment, requirementId: 'other'})}]}]})]) {
      vi.stubGlobal('fetch', vi.fn(async () => stream([event])));
      await expect(new ChatGptPlanEvaluator(opts).evaluateRequirement(requirement, context())).rejects.toThrow();
    }
  });
  it('retains verified usage when rejecting a local reservation overrun', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => stream([completed({usage: {input_tokens: 100, output_tokens: 9000}})])));
    await expect(new ChatGptPlanEvaluator(opts).evaluateRequirement(requirement, context())).rejects.toMatchObject({usageVerified: true, metrics: {outputTokens: 9000, costVerified: false}});
  });
  it('rejects oversized input without accessing credentials or sending a request', async () => {
    const token = vi.fn(); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const result = await new ChatGptPlanEvaluator({...opts, maxInputTokens: 1, getAccessToken: token}).evaluateRequirement(requirement, context());
    expect(result.confidence).toBe(0); expect(result.metrics.costVerified).toBe(true); expect(token).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('marks an authentication failure before inference as no unverified usage', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(new ChatGptPlanEvaluator({...opts, getAccessToken: async () => {throw new Error('Reconnect');}}).evaluateRequirement(requirement, context())).rejects.toMatchObject({usageVerified: true, metrics: {costVerified: true}});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps model/effort selections distinct in the experiment cache and counts plan calls', async () => {
    const one = {...p, requirements: [requirement]};
    const fetch = vi.fn(async () => stream([completed()])); vi.stubGlobal('fetch', fetch);
    const report = await runExperiment([{caseData: c, cohort: 'development'}], [one], [
      {id: 'low', label: 'Luna low', configured: true, evaluators: [new ChatGptPlanEvaluator(opts)]},
      {id: 'xhigh', label: 'Sol extra high', configured: true, evaluators: [new ChatGptPlanEvaluator({...opts, model: 'gpt-6.1-sol', reasoningEffort: 'xhigh'})]},
    ], {thresholds: [.7, .9], maxProviderCalls: 2});
    expect(fetch).toHaveBeenCalledTimes(2); expect(report.acquisition.providerCalls).toBe(2);
    expect(report.acquisition.costUsd).toBeNull(); expect(report.acquisition.usageVerified).toBe(true);
    expect(report.runs.every(r => r.summary.costPerSafeResolution === null && r.summary.totalCostUsd === null)).toBe(true);
  });
  it('stops plan acquisition at the call limit', async () => {
    const fetch = vi.fn(async () => stream([completed()])); vi.stubGlobal('fetch', fetch);
    const report = await runExperiment([{caseData: c, cohort: 'development'}, {caseData: {...c, id: 'second-case', requestedAt: '2026-01-01T00:00:00Z'}, cohort: 'development'}], [p], [{id: 'llm', label: 'Frontier', configured: true, evaluators: [new ChatGptPlanEvaluator(opts)]}], {thresholds: [.9], maxProviderCalls: 1});
    expect(fetch).toHaveBeenCalledTimes(1); expect(report.acquisition.providerCalls).toBe(1); expect(report.runs[0].cases[1].assessment.disposition).toBe('requires_clinical_review');
  });
  it('keeps successful plan usage clinically scorable while marking billing unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => stream([completed()])));
    const result = await new TieredOrchestrator([new ChatGptPlanEvaluator(opts)], {maxTokensPerRun: 100000}).evaluateCase(c, {...p, requirements: [requirement]});
    expect(result.usageVerified).toBe(true); expect(result.costVerified).toBe(false); expect(result.executionTrace[0].billingSource).toBe('chatgpt-plan');
  });
  it('selects the optional frontier provider without requiring API pricing and preserves OpenRouter as default', () => {
    const plan = providerOptionsFromEnv({FRONTIER_LLM_PROVIDER: 'chatgpt-plan', FRONTIER_LLM_MODEL: 'gpt-6-luna', FRONTIER_LLM_REASONING_EFFORT: 'low'}, {getAccessToken: opts.getAccessToken});
    expect(createEvaluationStrategy('llm', plan)[0]).toBeInstanceOf(ChatGptPlanEvaluator);
    expect(providerSummary(plan, true).frontier.configured).toBe(true); expect(providerSummary(plan, false).frontier.configured).toBe(false);
    expect(providerSummary(providerOptionsFromEnv({})).frontier.provider).toBe('openrouter');
    expect(() => providerOptionsFromEnv({FRONTIER_LLM_PROVIDER: 'unknown'})).toThrow();
  });
});
