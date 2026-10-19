import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MedicalPolicySchema, PriorAuthCaseSchema } from '@openpa/core';
import {
  DeterministicRulesEvaluator,
  MockLlmEvaluator,
  TieredOrchestrator,
} from '@openpa/evaluators';
import {
  CounterfactualSensitivityTester,
  CiEvalGate,
  BenchmarkHarness,
  CounterfactualMutator,
} from '../src/index.js';

describe('Counterfactual Mutation & CI Gate Suite', () => {
  const rootDir = process.cwd();
  const lumbarPolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/lumbar-mri.json'), 'utf-8'))
  );
  const caseLumbarMeets = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/lumbar-mri-001-meets.json'), 'utf-8'))
  );
  const kneePolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/knee-mri.json'), 'utf-8'))
  );
  const caseKneeMeets = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/knee-mri-001-meets.json'), 'utf-8'))
  );

  it('removes exactly the sole cited resource without changing any other case data or inputs', async () => {
    const engine = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const before = structuredClone(caseLumbarMeets);
    const baseline = await engine.evaluateCase(caseLumbarMeets, lumbarPolicy);
    const mutation = CounterfactualMutator.applyMutation(caseLumbarMeets, 'remove_supporting_evidence', baseline);
    expect(mutation.isApplicable).toBe(true);
    expect(mutation.isNoOp).toBe(false);
    expect(mutation.expectedFlippedRequirementId).toBe('req-radiculopathy');
    expect(caseLumbarMeets).toEqual(before);
    const entries = before.patientBundle.entry as any[];
    const expected = structuredClone(before);
    expected.patientBundle.entry = entries.filter(e => e.resource.id !== 'cond-lumbar-radic-01');
    expect(mutation.mutatedCase).toEqual(expected);
    const actual = await engine.evaluateCase(mutation.mutatedCase, lumbarPolicy);
    expect(actual.disposition).toBe('needs_information');
    expect(actual.requirements.find(r => r.requirementId === mutation.expectedFlippedRequirementId)?.status).toBe('insufficient_evidence');
    expect((await new CounterfactualSensitivityTester(engine).testMutation(caseLumbarMeets, lumbarPolicy, 'remove_supporting_evidence')).status).toBe('passed');
  });

  it('skips removal with a deficient baseline, missing assessment, or only multiply supported requirements', async () => {
    const engine = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const baseline = await engine.evaluateCase(caseLumbarMeets, lumbarPolicy);
    expect(CounterfactualMutator.applyMutation(caseLumbarMeets, 'remove_supporting_evidence').isApplicable).toBe(false);
    const deficient = {...baseline, disposition: 'needs_information' as const};
    expect(CounterfactualMutator.applyMutation(caseLumbarMeets, 'remove_supporting_evidence', deficient).isApplicable).toBe(false);
    const multiple = structuredClone(caseLumbarMeets);
    const entries = multiple.patientBundle.entry as any[];
    const extra = structuredClone(entries.find(e => e.resource.resourceType === 'Condition'));
    extra.resource.id = 'second-support';
    entries.push(extra);
    const multiBaseline = await engine.evaluateCase(multiple, lumbarPolicy);
    const result = CounterfactualMutator.applyMutation(multiple, 'remove_supporting_evidence', multiBaseline);
    expect(result.isApplicable).toBe(false);
    expect(result.isNoOp).toBe(true);
    expect(result.mutatedCase.patientBundle).toEqual(multiple.patientBundle);
  });

  it('keeps documented numeric failure distinct from missing documentation', async () => {
    const c = PriorAuthCaseSchema.parse(JSON.parse(readFileSync('datasets/cases/sleep-study-001-meets.json', 'utf8')));
    const p = MedicalPolicySchema.parse(JSON.parse(readFileSync('datasets/policies/sleep-study.json', 'utf8')));
    const obs = (c.patientBundle.entry as any[]).find(e => e.resource.resourceType === 'Observation').resource;
    obs.valueQuantity.value = 1;
    delete obs.text;
    delete obs.note;
    const actual = await new TieredOrchestrator([new DeterministicRulesEvaluator()]).evaluateCase(c, p);
    expect(actual.requirements.find(r => r.evidence.some(e => e.resourceId === `Observation/${obs.id}`))?.status).toBe('not_satisfied');
    expect(actual.disposition).not.toBe('meets_policy');
  });

  it('mutates conservative therapy duration and appropriately flips disposition', async () => {
    const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const tester = new CounterfactualSensitivityTester(orchestrator);

    const testResult = await tester.testMutation(
      caseLumbarMeets,
      lumbarPolicy,
      'shorten_therapy_duration'
    );

    expect(testResult.baselineDisposition).toBe('meets_policy');
    expect(testResult.mutatedDisposition).toBe('needs_information');
    expect(testResult.targetRequirementId).toBe('req-conservative-therapy');
    expect(testResult.mutatedRequirementStatus).toBe('insufficient_evidence');
    expect(testResult.flippedCorrectly).toBe(true);
    expect(testResult.status).toBe('passed');
  });

  it('mutates diagnosis to non-indicated code and causes criteria to fail', async () => {
    const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const tester = new CounterfactualSensitivityTester(orchestrator);

    const testResult = await tester.testMutation(
      caseKneeMeets,
      kneePolicy,
      'diagnosis_non_indicated'
    );

    expect(testResult.baselineDisposition).toBe('meets_policy');
    expect(testResult.mutatedDisposition).toBe('needs_information');
    expect(testResult.targetRequirementId).toBe('req-knee-condition');
    expect(testResult.mutatedRequirementStatus).toBe('insufficient_evidence');
    expect(testResult.flippedCorrectly).toBe(true);
    expect(testResult.status).toBe('passed');
  });

  it('CI Gate passes when accuracy, grounding, and sensitivity meet thresholds', async () => {
    const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const harness = new BenchmarkHarness({ orchestrator });
    const metrics = await harness.runBenchmark([caseLumbarMeets, caseKneeMeets], [lumbarPolicy, kneePolicy]);

    const tester = new CounterfactualSensitivityTester(orchestrator);
    const sensitivity = await tester.runSensitivitySuite([caseLumbarMeets, caseKneeMeets], [lumbarPolicy, kneePolicy]);

    const gate = CiEvalGate.verifyGate(metrics, sensitivity);
    expect(gate.passed).toBe(true);
    expect(gate.failures.length).toBe(0);
  });

  it('CI Gate strictly fails if any unsupported or hallucinated citation exists', () => {
    const hallucinatedMetrics = {
      totalCases: 10,
      dispositionAccuracy: 1.0,
      meanRequirementAccuracy: 1.0,
      meanRequirementBalancedAccuracy: 1.0,
      meanRequirementMacroF1: 1.0,
      meanGroundingPrecision: 0.90,
      totalCitations: 10,
      totalUnsupportedCitations: 1, // Single hallucinated citation!
      missingEvidenceRecall: 1.0,
      meanPathScore: 1.0,
      totalCostUsd: 0.001,
      meanCostPerCase: 0.0001,
      meanLatencyMs: 15,
      safeResolutionsCount: 9,
      costPerSafeResolution: 0.0001,
      caseScores: [],
    };

    const gate = CiEvalGate.verifyGate(hallucinatedMetrics);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.includes('Grounding Safety Gate Failed'))).toBe(true);
  });

  it('CI Gate fails when metrics are non-finite or empty', () => {
    const emptyMetrics = {
      totalCases: 0,
      dispositionAccuracy: 0,
      meanRequirementAccuracy: 0,
      meanRequirementBalancedAccuracy: 0,
      meanRequirementMacroF1: 0,
      meanGroundingPrecision: 0,
      totalCitations: 0,
      totalUnsupportedCitations: 0,
      missingEvidenceRecall: 0,
      meanPathScore: 0,
      totalCostUsd: 0,
      meanCostPerCase: 0,
      meanLatencyMs: 0,
      safeResolutionsCount: 0,
      costPerSafeResolution: null,
      caseScores: [],
    };

    const gate = CiEvalGate.verifyGate(emptyMetrics);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some(f => f.includes('dataset is empty'))).toBe(true);
  });

  it('Meaningful degraded-evaluator test: degraded mock producing hallucinated citations causes CI failure', async () => {
    const degradedOrchestrator = new TieredOrchestrator([
      new MockLlmEvaluator('degraded-llm', 'Degraded LLM Fixture', {
        produceUngroundedCitation: true,
      }),
    ]);

    const harness = new BenchmarkHarness({ orchestrator: degradedOrchestrator });
    const metrics = await harness.runBenchmark([caseLumbarMeets], [lumbarPolicy]);

    // Evaluation escalated to clinical review due to hallucinated citation
    expect(metrics.caseScores[0].predictedDisposition).toBe('requires_clinical_review');
    expect(metrics.caseScores[0].unsupportedCitations).toBeGreaterThan(0);

    const gate = CiEvalGate.verifyGate(metrics);
    expect(gate.passed).toBe(false);
  });
});
