import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { hashCanonicalJson, FhirBundleIndexer, type PolicyRequirement } from '@openpa/core';
import { DeterministicRulesEvaluator, type PolicyEvaluator, type EvaluatorResult, type EvaluatorContext } from '@openpa/evaluators';
import { loadSufficiencyDataset } from '../src/evidence-sufficiency/dataset.js';
import { materializeSnapshots } from '../src/evidence-sufficiency/snapshots.js';
import { runSufficiencyExperiment } from '../src/evidence-sufficiency/runner.js';
import { AcquisitionStore, acquisitionKey } from '../src/evidence-sufficiency/recording.js';
import { probeFlags, summarizeProbes, summarizeCells } from '../src/evidence-sufficiency/scorer.js';
import { createBindings, publicConfiguration } from '../src/evidence-sufficiency/providers.js';
import { parseArguments } from '../src/evidence-sufficiency/cli.js';
import { makeSufficiencyView, validateSufficiencyView } from '../src/evidence-sufficiency/view.js';
import type { EvaluatorBinding, SufficiencyFixture, TierObservation, EvidenceSnapshot, Recording } from '../src/evidence-sufficiency/types.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const dataset = loadSufficiencyDataset(root);
const fixture = (id = 'scn-801') => structuredClone(dataset.fixtures.find(f => f.runtime.scenarioId === id)!);
const metrics = {costUsd: .001, latencyMs: 1, inputTokens: 1, outputTokens: 1, providerModel: 'test-model-pinned'};
function fakeBinding(key: string, tier: number, implementation: (req: PolicyRequirement, context: EvaluatorContext) => Promise<EvaluatorResult>): EvaluatorBinding {
  return {key, configured: true, provider: true, configuration: {model: key, promptRevision: 'test-only'}, evaluator: {id: key, name: 'TEST ONLY evaluator', tierLevel: tier, maxCostUsd: .002, maxTokens: 10, evaluateRequirement: implementation}};
}
function harness(implementation: (req: PolicyRequirement, context: EvaluatorContext) => Promise<EvaluatorResult>, input: SufficiencyFixture[] = [fixture()]) {
  const rules: EvaluatorBinding = {key: 'rules', evaluator: new DeterministicRulesEvaluator(), configured: true, provider: false, configuration: {adapter: 'rules'}};
  const bindings = {rules, jev: fakeBinding('jev',2,implementation), small: fakeBinding('small',3,implementation), frontier: fakeBinding('frontier',4,implementation)};
  return {fixtures: input, bindings, strategyBindings: {rules: ['rules'], cheap: ['rules','jev'], tiered: ['rules','jev','small','frontier'], llm: ['frontier']},
    maxSpend: 1, maxCalls: 10000, maxTokens: 100000, caseBudget: 1, timeoutMs: 500, implementationHash: 'test-adapters-only'};
}
const abstain = async (): Promise<EvaluatorResult> => ({status:'insufficient_evidence',confidence:.99,evidence:[],metrics});
const satisfy = async (_: PolicyRequirement, ctx: EvaluatorContext): Promise<EvaluatorResult> => ({status:'satisfied',confidence:.99,
  evidence: ctx.indexer.getAllResources().filter(r => r.resourceType === 'DocumentReference').map(r => ({resourceType:r.resourceType,resourceId:`${r.resourceType}/${r.id}`,textSnippet:r.textSnippet,date:r.date})),metrics});

describe('Evidence sufficiency experiment contracts', () => {
  it('freezes twenty paired fixtures and a separately counted numeric control', async () => {
    expect(dataset.fixtures.filter(f => f.cohort !== 'negative_control')).toHaveLength(20);
    expect(dataset.fixtures.filter(f => f.cohort === 'negative_control')).toHaveLength(1);
    expect(dataset.fixtures.filter(f => f.cohort === 'challenge').map(f => f.family)).toEqual(Array(4).fill('lumbar_therapy'));
    const complete = await materializeSnapshots(fixture('scn-801'),1), scattered = await materializeSnapshots(fixture('scn-802'),1);
    expect(complete[1].evidenceHash).toBe(scattered[1].evidenceHash);
    expect(complete[0].evidenceHash).not.toBe(scattered[0].evidenceHash);
    const lComplete = await materializeSnapshots(fixture('scn-805'),1), lScattered = await materializeSnapshots(fixture('scn-806'),1);
    expect(lComplete[1].evidenceHash).toBe(lScattered[1].evidenceHash);
  });
  it('models, strategies and direct probes receive immutable byte-identical snapshots', async () => {
    const seen: string[] = [];
    const report = await runSufficiencyExperiment(harness(async (req,ctx) => {seen.push(hashCanonicalJson({bundle:ctx.caseData.patientBundle,req})); expect(() => {ctx.caseData.patientBundle.entry = [];}).toThrow(); return satisfy(req,ctx);}));
    expect(new Set(seen).size).toBe(1);
    expect(report.infrastructure.matrixComplete).toBe(true);
    expect(report.snapshots).toHaveLength(3);
    expect(report.cells).toHaveLength(36);
  });
  it('cache boundaries include evidence, full policy, time, configuration, adapter revision and replicate', async () => {
    const snapshot = (await materializeSnapshots(fixture(),1))[0];
    const binding = fakeBinding('model',2,abstain), req = snapshot.policy.requirements[0];
    const key = acquisitionKey(binding,req,snapshot,'rev1');
    expect(acquisitionKey(binding,req,{...snapshot,access:'retrieval'},'rev1')).toBe(key);
    expect(acquisitionKey(binding,req,{...snapshot,replicate:2},'rev1')).not.toBe(key);
    expect(acquisitionKey(binding,req,snapshot,'rev2')).not.toBe(key);
    expect(acquisitionKey({...binding,configuration:{model:'new'}},req,snapshot,'rev1')).not.toBe(key);
    expect(acquisitionKey(binding,req,{...snapshot,policy:{...snapshot.policy,version:'2'}},'rev1')).not.toBe(key);
    expect(acquisitionKey(binding,req,{...snapshot,input:{...snapshot.input,requestedAt:'2026-07-05'}},'rev1')).not.toBe(key);
    expect(acquisitionKey(binding,req,{...snapshot,input:{...snapshot.input,patientBundle:{entry:[]}}},'rev1')).not.toBe(key);
  });
  it('threshold replay and identical access arms do not reacquire; replicates do', async () => {
    let calls = 0;
    const impl = async () => {calls++; return abstain();};
    const one = await runSufficiencyExperiment({...harness(impl),thresholds:[.9]}); const first = calls;
    calls = 0; const three = await runSufficiencyExperiment(harness(impl));
    expect(calls).toBe(first); expect(three.acquisition.adapterAcquisitions).toBe(one.acquisition.adapterAcquisitions);
    calls = 0; const replicated = await runSufficiencyExperiment({...harness(impl),replicates:2});
    expect(calls).toBe(first*2); expect(new Set(replicated.recordings.map(r => r.replicate)).size).toBe(2);
  });
  it('early rules acceptance cannot suppress direct model probes or charge their spend to policy', async () => {
    const report = await runSufficiencyExperiment({...harness(satisfy,[fixture('scn-701')]),thresholds:[.9]});
    expect(report.probes.filter(p => p.evaluatorKey === 'jev')).toHaveLength(6);
    expect(report.recordings.filter(r => r.evaluatorKey === 'jev').every(r => r.origin === 'direct_probe')).toBe(true);
    expect(report.acquisition.directProbeAcquisitionCostUsd).toBeGreaterThan(0);
    expect(report.cells.filter(c => c.strategy === 'cheap').every(c => c.policyKnownCostUsd === 0)).toBe(true);
  });
  it('raw unsupported satisfaction is unsafe even when grounding repairs it', async () => {
    const report = await runSufficiencyExperiment({...harness(async () => ({status:'satisfied',confidence:.99,evidence:[{resourceType:'DocumentReference',resourceId:'DocumentReference/fabricated'}],metrics}),[fixture('scn-803')]),thresholds:[.9]});
    const summary = report.tierSummaries.find(s => s.evaluatorKey === 'jev')!;
    expect(summary.rawUnsupportedSatisfaction.numerator).toBe(3);
    expect(summary.guardInterception.rate).toBe(1);
    expect(report.empiricalSafety.passed).toBe(false);
    expect(report.cells.find(c => c.strategy === 'cheap')!.result.workflowDisposition).toBe('requires_clinical_review');
  });
  it('an authentic irrelevant citation does not establish sufficiency', async () => {
    const f = fixture('scn-803'); (f.runtime.initialBundle.entry as unknown[]).push({resource:{resourceType:'Observation',id:'irrelevant',subject:{reference:`Patient/${f.runtime.patientId}`},status:'final',text:{div:'<div>Temperature normal.</div>'}}});
    const report = await runSufficiencyExperiment({...harness(async () => ({status:'satisfied',confidence:.99,evidence:[{resourceType:'Observation',resourceId:'Observation/irrelevant'}],metrics}),[f]),thresholds:[.9]});
    expect(report.tierSummaries.find(s => s.evaluatorKey === 'jev')!.rawUnsupportedSatisfaction.numerator).toBe(3);
    expect(report.cells.some(c => c.score.falseClearance)).toBe(true);
  });
  it('confident not-met on missing documentation is separate from correct numeric nonfulfillment', async () => {
    const report = await runSufficiencyExperiment({...harness(async () => ({status:'not_satisfied',confidence:.99,evidence:[],metrics}),[fixture('scn-803'),fixture('scn-899')]),thresholds:[.9]});
    expect(report.tierSummaries.find(s => s.evaluatorKey === 'jev')!.confidentFalseNonfulfillment.numerator).toBe(3);
    const negative = report.negativeControls.probes.filter(p => p.evaluatorKey === 'rules');
    expect(negative).toHaveLength(3);
    for (const o of negative) expect(report.recordings.find(r => r.id === o.recordingId)!.result!.status).toBe('not_satisfied');
  });
  it('source unavailability overrides confident satisfied assessment and does not restore inaccessible evidence', async () => {
    const f = fixture('scn-705');
    const report = await runSufficiencyExperiment({...harness(async () => ({status:'satisfied',confidence:1,evidence:[{resourceType:'Condition',resourceId:'Condition/cond-lmb-radic-01'}],metrics}),[f]),thresholds:[.9]});
    for (const c of report.cells.filter(c => report.snapshots.find(s => s.id === c.snapshotId)!.access !== 'submitted_only')) {
      expect(c.result.workflowDisposition).toBe('requires_clinical_review');
      expect(c.result.retrieval.completeWithinScope).toBe(false);
    }
  });
  it('model and budget failures receive no uncertainty credit and preserve scheduled denominators', async () => {
    const failed = await runSufficiencyExperiment({...harness(async () => {throw new Error('test provider failure');},[fixture('scn-803')]),thresholds:[.9]});
    const summary = failed.tierSummaries.find(s => s.evaluatorKey === 'jev')!;
    expect(summary.failed).toBe(3); expect(summary.uncertaintyPreserved.numerator).toBe(0); expect(summary.uncertaintyPreserved.denominator).toBe(3);
    const budget = await runSufficiencyExperiment({...harness(abstain,[fixture('scn-803')]),maxSpend:0,thresholds:[.9]});
    expect(budget.acquisition.adapterAcquisitions).toBe(0);
    expect(budget.tierSummaries.find(s => s.evaluatorKey === 'jev')!.outcomes.budget_exhausted).toBe(3);
    expect(budget.infrastructure.acquisitionComplete).toBe(false);
  });
  it('a shared cap covers policies, direct probes, and replicates without double counting', async () => {
    const report = await runSufficiencyExperiment({...harness(abstain),maxSpend:.003,replicates:2,thresholds:[.9]});
    expect(report.acquisition.knownCostUsd).toBeLessThanOrEqual(.003);
    expect(report.acquisition.adapterAcquisitions).toBe(2);
    expect(report.acquisition.policyAcquisitionCostUsd + report.acquisition.directProbeAcquisitionCostUsd).toBe(report.acquisition.knownCostUsd);
    expect(report.recordings.some(r => r.outcome === 'budget_exhausted')).toBe(true);
  });
  it('policy cost counts repeated tier invocations while acquisition spend deduplicates identical inputs', async () => {
    const options = harness(abstain);
    options.bindings.small = {...options.bindings.small,configuration:options.bindings.frontier.configuration,evaluator:{...options.bindings.frontier.evaluator,tierLevel:3}};
    const report = await runSufficiencyExperiment({...options,thresholds:[.9]});
    const cell = report.cells.find(c=>c.strategy==='tiered')!;
    expect(cell.policyKnownCostUsd).toBeCloseTo(.003);
    expect(report.recordings.filter(r=>r.evaluatorKey==='small'||r.evaluatorKey==='frontier')).toHaveLength(1);
  });
  it('unknown usage stops later acquisition and makes spend unknown', async () => {
    let calls = 0;
    const report = await runSufficiencyExperiment({...harness(async () => {calls++; throw Object.assign(new Error('unknown usage'),{usageVerified:false});}),thresholds:[.9]});
    expect(calls).toBe(1); expect(report.acquisition.costUsd).toBeNull(); expect(report.acquisition.usageVerified).toBe(false);
  });
  it('interrupted runs retain the matrix and explicit cancelled observations', async () => {
    const controller = new AbortController(); controller.abort();
    const report = await runSufficiencyExperiment({...harness(abstain),thresholds:[.9],signal:controller.signal});
    expect(report.infrastructure.interrupted).toBe(true); expect(report.cells).toHaveLength(12);
    expect(report.probes.every(p => p.outcome === 'cancelled')).toBe(true);
    expect(report.cells.every(c => c.result.workflowDisposition !== 'meets_policy')).toBe(true);
  });
  it('gold-only changes cannot change snapshots or acquisition keys', async () => {
    const a = fixture(), b = fixture(); b.labels.submitted_only['req-narrative-progress'].status = 'not_satisfied';
    expect((await materializeSnapshots(a,1)).map(s => s.contentHash)).toEqual((await materializeSnapshots(b,1)).map(s => s.contentHash));
    const reportA = await runSufficiencyExperiment({...harness(abstain,[a]),thresholds:[.9]});
    const reportB = await runSufficiencyExperiment({...harness(abstain,[b]),thresholds:[.9]});
    expect(reportA.recordings.map(r => r.key)).toEqual(reportB.recordings.map(r => r.key));
  });
  it('offline model cells stay unavailable even when rules resolve the case', async () => {
    const providers = createBindings({}, {jev:false,small:false,frontier:false});
    const report = await runSufficiencyExperiment({...harness(abstain,[fixture('scn-701')]),...providers,thresholds:[.9]});
    expect(report.cells.filter(c => c.strategy !== 'rules').every(c => c.availability !== 'available')).toBe(true);
    expect(report.probes.filter(p => p.evaluatorKey !== 'rules').every(p => p.outcome === 'unavailable')).toBe(true);
    expect(report.acquisition.adapterAcquisitions).toBe(0);
    expect(summarizeCells(report.cells.filter(c => c.strategy === 'tiered')).safeResolutionCoverage.rate).toBeNull();
  });
  it('separates missing documentation, conflicts and skipped rows in scoring', async () => {
    const report = await runSufficiencyExperiment({...harness(abstain,[fixture('scn-704')]),thresholds:[.9]});
    const cell = report.cells.find(c => c.strategy === 'rules' && report.snapshots.find(s => s.id === c.snapshotId)!.access === 'retrieval')!;
    expect(cell.result.reviewPacket.criteria[1].evaluationState).toBe('not_evaluated');
    expect(cell.score.hiddenConflicts).toBe(0); expect(cell.score.gapAction.rate).toBe(1);
  });
  it('rejects live execution without explicit cap and output outside its namespace', () => {
    expect(() => parseArguments(['--live'],root)).toThrow('explicit --max-spend');
    expect(() => parseArguments(['--output','results/experiment-report.json'],root)).toThrow('under results/evidence-sufficiency');
    expect(() => parseArguments(['--max-spend','NaN'],root)).toThrow();
    expect(() => parseArguments(['--replicates','0'],root)).toThrow();
  });
  it('never includes keys or token callbacks in exported configuration', () => {
    const settings = publicConfiguration({llmOptions:{apiKey:'SECRET',model:'model',baseURL:'https://example.invalid/private'},frontierOptions:{provider:'chatgpt-plan',model:'frontier',getAccessToken:async () => 'TOKEN'}});
    expect(JSON.stringify(settings)).not.toMatch(/SECRET|TOKEN|private|getAccessToken|apiKey/);
  });
  it('reports null probe denominators without observations', () => {
    const summary = summarizeProbes([],[],[],[]); expect(summary.rawUnsupportedSatisfaction.rate).toBeNull(); expect(summary.guardInterception.rate).toBeNull();
  });
  it('retains a test-only unsafe raw response beside the blocked packet in a valid view report', async () => {
    const report = await runSufficiencyExperiment({...harness(async () => ({status:'satisfied',confidence:.99,evidence:[{resourceType:'DocumentReference',resourceId:'DocumentReference/fabricated'}],metrics}),[fixture('scn-803')]),thresholds:[.9]});
    const view = makeSufficiencyView({...report,testOnly:true,runMode:'test-only'});
    const parsed = validateSufficiencyView(JSON.parse(JSON.stringify(view)));
    expect(parsed.testOnly).toBe(true);
    expect(parsed.probes.some(p=>p.guardVerdict==='blocked')).toBe(true);
    expect(parsed.recordings.some(r=>r.result?.evidence.some(e=>e.resourceId.includes('fabricated')))).toBe(true);
    expect(Object.values(parsed.results).every(r=>r.reviewPacket.criteria.every(c=>!c.citations.some(e=>e.resourceId.includes('fabricated'))))).toBe(true);
  });
  it('rejects view reports with invalid result or snapshot references', async () => {
    const view = makeSufficiencyView(await runSufficiencyExperiment({...harness(abstain),thresholds:[.9]}));
    view.cells[0].resultRef='missing'; expect(()=>validateSufficiencyView(view)).toThrow('references');
  });
  it('a provider deadline yields an explicit failed observation and halts unknown usage', async () => {
    const report = await runSufficiencyExperiment({...harness(async () => new Promise(()=>{})),thresholds:[.9],timeoutMs:10});
    expect(report.recordings.some(r=>r.outcome==='provider_error')).toBe(true);
    expect(report.acquisition.usageVerified).toBe(false);
    expect(report.probes.filter(p=>p.evaluatorKey!=='rules').every(p=>p.outcome!=='acquired')).toBe(true);
  });
});
