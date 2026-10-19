import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MedicalPolicySchema,
  PriorAuthCaseSchema,
  type PriorAuthCase,
} from '@openpa/core';
import {
  DeterministicRulesEvaluator,
  JevDecisionEvaluator,
  MockLlmEvaluator,
  TieredOrchestrator,
} from '@openpa/evaluators';

describe('Reproduced Failures & Regression Suite', () => {
  const rootDir = process.cwd();

  const lumbarPolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/lumbar-mri.json'), 'utf-8'))
  );
  const sleepPolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/sleep-study.json'), 'utf-8'))
  );
  const cgmPolicy = MedicalPolicySchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/policies/cgm-dme.json'), 'utf-8'))
  );

  const caseLumbarConflicting = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/lumbar-mri-003-conflicting.json'), 'utf-8'))
  );
  const caseSleepMeets = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/sleep-study-001-meets.json'), 'utf-8'))
  );
  const caseCgmMeets = PriorAuthCaseSchema.parse(
    JSON.parse(readFileSync(join(rootDir, 'datasets/cases/cgm-dme-001-meets.json'), 'utf-8'))
  );

  // Failure A: case-lumbar-003-conflicting in tiered cascade
  describe('Failure A: Contradiction preservation in tiered cascade', () => {
    it('preserves contradiction in DeterministicRules -> Jev -> Mock cascade without silent override', async () => {
      const orchestrator = new TieredOrchestrator([
        new DeterministicRulesEvaluator(),
        new JevDecisionEvaluator(),
        new MockLlmEvaluator(),
      ]);

      const assessment = await orchestrator.evaluateCase(caseLumbarConflicting, lumbarPolicy);

      // Must NOT be overridden by mock to 'satisfied', and final disposition MUST be requires_clinical_review
      expect(assessment.disposition).toBe('requires_clinical_review');
      const radiculopathyReq = assessment.requirements.find(r => r.requirementId === 'req-radiculopathy');
      expect(radiculopathyReq).toBeDefined();
      expect(radiculopathyReq?.status).not.toBe('satisfied');
    });

    it('preserves contradiction in rules-only evaluation', async () => {
      const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
      const assessment = await orchestrator.evaluateCase(caseLumbarConflicting, lumbarPolicy);

      expect(assessment.disposition).toBe('requires_clinical_review');
    });
  });

  // Failure B: sleep-study observation value thresholds & conflict handling
  describe('Failure B: Numeric thresholds and conflict handling in sleep study', () => {
    it('rejects low Observation value (score = 1) when policy requires Epworth >= 10', async () => {
      // Deep clone case and modify Observation value to 1
      const cloned: PriorAuthCase = JSON.parse(JSON.stringify(caseSleepMeets));
      const obsEntry = cloned.patientBundle.entry.find(
        (e: any) => e.resource?.resourceType === 'Observation'
      ) as any;
      expect(obsEntry).toBeDefined();
      obsEntry.resource.valueQuantity = { value: 1, unit: '{score}' };
      obsEntry.resource.text = { status: 'generated', div: '<div>Epworth Sleepiness Scale score: 1</div>' };
      if (obsEntry.resource.note?.[0]) {
        obsEntry.resource.note[0].text = 'Epworth Sleepiness Scale score: 1 (normal / mild)';
      }

      const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
      const assessment = await orchestrator.evaluateCase(cloned, sleepPolicy);

      // Score 1 does not meet >= 10 threshold, so disposition must be needs_information, NOT meets_policy
      expect(assessment.disposition).toBe('needs_information');
      const scoreReq = assessment.requirements.find(r => r.requirementId === 'req-epworth-score');
      expect(scoreReq?.status).toBe('not_satisfied');
    });

    it('escalates to clinical review when structured value (1) contradicts high narrative value (14)', async () => {
      const cloned: PriorAuthCase = JSON.parse(JSON.stringify(caseSleepMeets));
      const obsEntry = cloned.patientBundle.entry.find(
        (e: any) => e.resource?.resourceType === 'Observation'
      ) as any;
      expect(obsEntry).toBeDefined();
      // Structured value is 1, but narrative explicitly says 14
      obsEntry.resource.valueQuantity = { value: 1, unit: '{score}' };
      obsEntry.resource.text = { status: 'generated', div: '<div>Epworth Sleepiness Scale score: 14</div>' };
      if (obsEntry.resource.note?.[0]) {
        obsEntry.resource.note[0].text = 'Epworth Sleepiness Scale score: 14 (severe excessive daytime sleepiness)';
      }

      const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
      const assessment = await orchestrator.evaluateCase(cloned, sleepPolicy);

      // Conflicting low structured score vs high narrative score must escalate
      expect(assessment.disposition).toBe('requires_clinical_review');
    });
  });

  // Failure C: cgm-dme medication status validation and activity requirements
  describe('Failure C: Medication status and activity validation in CGM DME', () => {
    const testStatuses = ['stopped', 'completed', 'on-hold', 'unknown'] as const;

    for (const status of testStatuses) {
      it(`rejects medication with status '${status}' and returns needs_information`, async () => {
        const cloned: PriorAuthCase = JSON.parse(JSON.stringify(caseCgmMeets));
        const medEntry = cloned.patientBundle.entry.find(
          (e: any) => e.resource?.resourceType === 'MedicationStatement'
        ) as any;
        expect(medEntry).toBeDefined();
        medEntry.resource.status = status;

        const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
        const assessment = await orchestrator.evaluateCase(cloned, cgmPolicy);

        expect(assessment.disposition).toBe('needs_information');
        const insulinReq = assessment.requirements.find(r => r.requirementId === 'req-insulin-treatment');
        expect(insulinReq?.status).toBe('insufficient_evidence');
      });
    }

    it('accepts medication with status "active" when valid', async () => {
      const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
      const assessment = await orchestrator.evaluateCase(caseCgmMeets, cgmPolicy);

      expect(assessment.disposition).toBe('meets_policy');
      const insulinReq = assessment.requirements.find(r => r.requirementId === 'req-insulin-treatment');
      expect(insulinReq?.status).toBe('satisfied');
    });

    it('escalates to clinical review when medication has contradictory narrative', async () => {
      const cloned: PriorAuthCase = JSON.parse(JSON.stringify(caseCgmMeets));
      const medEntry = cloned.patientBundle.entry.find(
        (e: any) => e.resource?.resourceType === 'MedicationStatement'
      ) as any;
      expect(medEntry).toBeDefined();
      medEntry.resource.status = 'active';
      medEntry.resource.note = [
        { text: 'Patient discontinued insulin therapy against medical advice 3 weeks ago.' }
      ];

      const orchestrator = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
      const assessment = await orchestrator.evaluateCase(cloned, cgmPolicy);

      expect(assessment.disposition).toBe('requires_clinical_review');
    });
  });
});
