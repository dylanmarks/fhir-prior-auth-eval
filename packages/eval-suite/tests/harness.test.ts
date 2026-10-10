import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MedicalPolicySchema,
  PriorAuthCaseSchema,
  FhirBundleIndexer,
} from '@openpa/core';
import {
  DeterministicRulesEvaluator,
  JevDecisionEvaluator,
  MockLlmEvaluator,
  TieredOrchestrator,
  GroundingGuardrail,
} from '@openpa/evaluators';
import { BenchmarkHarness } from '../src/runner/harness.js';

describe('Benchmark Harness & Tiered Engine', () => {
  const rootDir = process.cwd();

  const lumbarPolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/lumbar-mri.json'), 'utf-8'))
  );
  const kneePolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/knee-mri.json'), 'utf-8'))
  );

  const caseLumbarMeets = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/lumbar-mri-001-meets.json'), 'utf-8'))
  );
  const caseLumbarDeficient = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/lumbar-mri-002-deficient.json'), 'utf-8'))
  );
  const caseLumbarConflicting = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/lumbar-mri-003-conflicting.json'), 'utf-8'))
  );
  const caseKneeMeets = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/knee-mri-001-meets.json'), 'utf-8'))
  );
  const caseKneeDeficient = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/knee-mri-002-deficient.json'), 'utf-8'))
  );
  const caseKneeLaterality = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/knee-mri-003-laterality.json'), 'utf-8'))
  );

  it('correctly resolves satisfied criteria on a fully documented lumbar case', async () => {
    const harness = new BenchmarkHarness();
    const result = await harness.runBenchmark([caseLumbarMeets], [lumbarPolicy]);

    expect(result.totalCases).toBe(1);
    expect(result.dispositionAccuracy).toBe(1.0);
    expect(result.meanRequirementAccuracy).toBe(1.0);
    expect(result.meanGroundingPrecision).toBe(1.0);
    expect(result.totalCostUsd).toBe(0);
    expect(result.caseScores[0].predictedDisposition).toBe('meets_policy');
  });

  it('correctly detects deficient therapy and flags missing evidence', async () => {
    const harness = new BenchmarkHarness();
    const result = await harness.runBenchmark([caseLumbarDeficient], [lumbarPolicy]);

    expect(result.totalCases).toBe(1);
    expect(result.dispositionAccuracy).toBe(1.0);
    expect(result.caseScores[0].predictedDisposition).toBe('needs_information');
    expect(result.missingEvidenceRecall).toBeGreaterThanOrEqual(0.5);
  });

  it('escalates to clinical review on conflicting narrative with symptom negation', async () => {
    const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const assessment = await orchestrator.evaluateCase(caseLumbarConflicting, lumbarPolicy);

    expect(assessment.disposition).toBe('requires_clinical_review');
    expect(assessment.requirements[0].status).toBe('insufficient_evidence');
  });

  it('detects laterality mismatch between requested knee and prerequisite radiograph', async () => {
    const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
    const assessment = await orchestrator.evaluateCase(caseKneeLaterality, kneePolicy);

    expect(assessment.disposition).toBe('needs_information');
    expect(assessment.requirements.find(r => r.requirementId === 'req-plain-radiograph')?.status).toBe(
      'insufficient_evidence'
    );
  });

  it('evaluates imaging prerequisites for knee MRI correctly', async () => {
    const harness = new BenchmarkHarness();
    const result = await harness.runBenchmark([caseKneeMeets, caseKneeDeficient], [kneePolicy]);

    expect(result.totalCases).toBe(2);
    expect(result.dispositionAccuracy).toBe(1.0);
    expect(result.caseScores[0].predictedDisposition).toBe('meets_policy');
    expect(result.caseScores[1].predictedDisposition).toBe('needs_information');
  });

  it('executes multi-tier cascade (Rules -> Jev -> Small LLM) and logs step traces', async () => {
    const orchestrator = new TieredOrchestrator([
      new DeterministicRulesEvaluator(),
      new JevDecisionEvaluator(),
      new MockLlmEvaluator(),
    ]);

    const assessment = await orchestrator.evaluateCase(caseLumbarMeets, lumbarPolicy);

    expect(assessment.disposition).toBe('meets_policy');
    expect(assessment.executionTrace.length).toBeGreaterThanOrEqual(2);
    expect(assessment.executionTrace[0].tierName).toBe('Deterministic Rules Engine');
    expect(assessment.totalLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('safely aborts and escalates when per-case cost budget is exceeded', async () => {
    const orchestrator = new TieredOrchestrator(
      [
        new MockLlmEvaluator('expensive-model', 'Expensive Model', {
          costPer1kTokens: 0.1,
          confidenceToReturn: 0.7,
        }),
      ],
      { budgetCapUsd: 0.00001 }
    );

    const assessment = await orchestrator.evaluateCase(caseLumbarMeets, lumbarPolicy);

    expect(assessment.disposition).toBe('requires_clinical_review');
    expect(assessment.executionTrace.some(t => t.status === 'budget_exceeded')).toBe(true);
  });

  it('permits zero-cost deterministic rules when budgetCapUsd is exactly zero but blocks paid tiers', async () => {
    const orchestrator = new TieredOrchestrator(
      [
        new DeterministicRulesEvaluator(),
        new MockLlmEvaluator('paid-model', 'Paid Model', { costPer1kTokens: 0.05 }),
      ],
      { budgetCapUsd: 0.0 }
    );

    const assessment = await orchestrator.evaluateCase(caseLumbarMeets, lumbarPolicy);
    expect(assessment.disposition).toBe('meets_policy');
    expect(assessment.totalCostUsd).toBe(0);
    // Rules resolved it; paid model was never invoked or blocked by admission control
    expect(assessment.executionTrace.every(t => t.costUsd === 0)).toBe(true);
  });

  it('catches ungrounded citations and prevents subsequent tiers from hiding the hallucination', async () => {
    // Degraded tier 2 produces an ungrounded hallucinated citation
    const orchestrator = new TieredOrchestrator([
      new MockLlmEvaluator('hallucinating-llm', 'Hallucinating LLM', {
        tierLevel: 2,
        produceUngroundedCitation: true,
      }),
      new MockLlmEvaluator('tier-3-backup', 'Tier 3 Backup', {
        tierLevel: 3,
        confidenceToReturn: 1.0,
      }),
    ]);

    const assessment = await orchestrator.evaluateCase(caseLumbarMeets, lumbarPolicy);
    // Hallucination MUST escalate to clinical review and NOT be masked by tier 3
    expect(assessment.disposition).toBe('requires_clinical_review');
    expect(assessment.executionTrace.some(t => t.status === 'escalated')).toBe(true);
  });

  it('handles hanging adapters cleanly via execution timeouts without unhandled rejections', async () => {
    const orchestrator = new TieredOrchestrator(
      [
        new MockLlmEvaluator('hanging-model', 'Hanging Model', {
          hangMs: 500,
        }),
      ],
      { timeoutMs: 50 } // Timeout after 50ms
    );

    const assessment = await orchestrator.evaluateCase(caseLumbarMeets, lumbarPolicy);
    expect(assessment.disposition).toBe('requires_clinical_review');
    expect(assessment.executionTrace.some(t => t.status === 'failed')).toBe(true);
  });

  it('GroundingGuardrail rigorously verifies types, dates, snippets, and paths', () => {
    const indexer = new FhirBundleIndexer(caseLumbarMeets.patientBundle);

    // 1. Valid citation
    const valid = GroundingGuardrail.verifyCitations(
      [
        {
          resourceType: 'Condition',
          resourceId: 'Condition/cond-lumbar-radic-01',
          date: '2026-05-10',
          textSnippet: 'right-sided lumbago with sciatica',
        },
      ],
      indexer
    );
    expect(valid.isValid).toBe(true);
    expect(valid.validCitations).toBe(1);

    // 2. Fabricated snippet
    const fabricatedSnippet = GroundingGuardrail.verifyCitations(
      [
        {
          resourceType: 'Condition',
          resourceId: 'Condition/cond-lumbar-radic-01',
          textSnippet: 'fabricated clinical claim about intracranial hemorrhage',
        },
      ],
      indexer
    );
    expect(fabricatedSnippet.isValid).toBe(false);
    expect(fabricatedSnippet.ungroundedCitations.length).toBe(1);

    // 3. Wrong resource type
    const wrongType = GroundingGuardrail.verifyCitations(
      [
        {
          resourceType: 'Procedure',
          resourceId: 'Condition/cond-lumbar-radic-01',
        },
      ],
      indexer
    );
    expect(wrongType.isValid).toBe(false);

    // 4. Wrong date
    const wrongDate = GroundingGuardrail.verifyCitations(
      [
        {
          resourceType: 'Condition',
          resourceId: 'Condition/cond-lumbar-radic-01',
          date: '1999-01-01',
        },
      ],
      indexer
    );
    expect(wrongDate.isValid).toBe(false);

    // 5. Non-existent resource ID
    const nonExistent = GroundingGuardrail.verifyCitations(
      [
        {
          resourceType: 'Condition',
          resourceId: 'Condition/fake-id-12345',
        },
      ],
      indexer
    );
    expect(nonExistent.isValid).toBe(false);
  });
});
