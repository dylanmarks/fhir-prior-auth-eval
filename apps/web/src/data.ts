import {
  type PriorAuthCase,
  type MedicalPolicy,
  PriorAuthCaseSchema,
  MedicalPolicySchema,
} from '@openpa/core';

// Canonical policies imported directly from datasets/
import lumbarPolicyJson from '../../../datasets/policies/lumbar-mri.json';
import kneePolicyJson from '../../../datasets/policies/knee-mri.json';
import ptPolicyJson from '../../../datasets/policies/pt-extension.json';
import sleepPolicyJson from '../../../datasets/policies/sleep-study.json';
import cgmPolicyJson from '../../../datasets/policies/cgm-dme.json';

// Canonical cases imported directly from datasets/
import lumbarMeetsJson from '../../../datasets/cases/lumbar-mri-001-meets.json';
import lumbarDeficientJson from '../../../datasets/cases/lumbar-mri-002-deficient.json';
import lumbarConflictingJson from '../../../datasets/cases/lumbar-mri-003-conflicting.json';
import kneeMeetsJson from '../../../datasets/cases/knee-mri-001-meets.json';
import kneeDeficientJson from '../../../datasets/cases/knee-mri-002-deficient.json';
import kneeLateralityJson from '../../../datasets/cases/knee-mri-003-laterality.json';
import ptMeetsJson from '../../../datasets/cases/pt-extension-001-meets.json';
import ptPlateauJson from '../../../datasets/cases/pt-extension-002-plateau.json';
import sleepMeetsJson from '../../../datasets/cases/sleep-study-001-meets.json';
import cgmMeetsJson from '../../../datasets/cases/cgm-dme-001-meets.json';
import structuredBaselineJson from '../../../datasets/structured-baseline.json';
import narrativePolicyJson from '../../../datasets/narrative/policy.json';

export const BUNDLED_POLICIES: MedicalPolicy[] = [
  MedicalPolicySchema.parse(lumbarPolicyJson),
  MedicalPolicySchema.parse(kneePolicyJson),
  MedicalPolicySchema.parse(ptPolicyJson),
  MedicalPolicySchema.parse(sleepPolicyJson),
  MedicalPolicySchema.parse(cgmPolicyJson),
  MedicalPolicySchema.parse(narrativePolicyJson),
];

export const BUNDLED_CASES: PriorAuthCase[] = [
  PriorAuthCaseSchema.parse(lumbarMeetsJson),
  PriorAuthCaseSchema.parse(lumbarDeficientJson),
  PriorAuthCaseSchema.parse(lumbarConflictingJson),
  PriorAuthCaseSchema.parse(kneeMeetsJson),
  PriorAuthCaseSchema.parse(kneeDeficientJson),
  PriorAuthCaseSchema.parse(kneeLateralityJson),
  PriorAuthCaseSchema.parse(ptMeetsJson),
  PriorAuthCaseSchema.parse(ptPlateauJson),
  PriorAuthCaseSchema.parse(sleepMeetsJson),
  PriorAuthCaseSchema.parse(cgmMeetsJson),
];

// Measured benchmark results from runner
const generatedReports = import.meta.glob('../../../results/benchmark-report.json', {eager:true,import:'default'});
export const MEASURED_BENCHMARK_REPORT = (Object.values(generatedReports)[0] ?? structuredBaselineJson) as typeof structuredBaselineJson;

const narrativeModules = import.meta.glob('../../../datasets/narrative/cases/*.json', {eager:true,import:'default'});
export const NARRATIVE_CASES: PriorAuthCase[] = Object.values(narrativeModules).map(value => PriorAuthCaseSchema.parse(value));
BUNDLED_CASES.push(...NARRATIVE_CASES);
