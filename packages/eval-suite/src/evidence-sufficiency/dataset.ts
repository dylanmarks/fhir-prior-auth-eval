import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashCanonicalJson, MedicalPolicySchema, type MedicalPolicy, type RequirementStatus } from '@openpa/core';
import { loadRetrievalCohort } from '../retrieval/loader.js';
import { ScenarioFixtureSchema } from '../retrieval/types.js';
import { ACCESS, type CriterionLabel, type SufficiencyFixture, type Adequacy } from './types.js';

const label = (status: RequirementStatus, evidence: string[], adequacy?: Adequacy): CriterionLabel => ({
  status, adequacy: adequacy ?? (status === 'satisfied' ? 'sufficient_support' : status === 'not_satisfied' ? 'documented_nonfulfillment' : 'insufficient'),
  acceptableEvidenceSets: evidence.length ? [evidence] : [], conflictIds: [], allowedCitationIds: evidence,
  gap: status === 'satisfied' ? 'none' : status === 'not_satisfied' ? 'documented_not_met' : 'not_found_in_searched_sources',
  action: status === 'satisfied' ? 'none' : status === 'not_satisfied' ? 'clinical_interpretation' : 'request_documentation',
});

export function authorSufficiencyDataset(root: string): SufficiencyFixture[] {
  const phase6 = loadRetrievalCohort(root);
  const fixtures: SufficiencyFixture[] = phase6.cases.map(runtime => {
    const gold = phase6.goldSidecars[runtime.scenarioId];
    const policy = phase6.policies[runtime.policyId];
    const labels = Object.fromEntries(ACCESS.map(access => [access, Object.fromEntries(policy.requirements.map((req, index) => {
      const criterion = gold.criteria[req.id];
      const status = access === 'submitted_only' ? criterion.expectedStatusSubmitted : access === 'full_corpus' ? criterion.expectedStatusFullCorpus ?? criterion.expectedStatusRetrieval : criterion.expectedStatusRetrieval;
      // After a conflict the rules skip later rows. Clinical labels describe the
      // snapshot's evidence, independently of that execution placeholder.
      const availableStatus = gold.variant === 'contradictory' && index > 0 ? 'satisfied' : status;
      const value = label(availableStatus, criterion.relevantResourceIds);
      value.allowedCitationIds = [...criterion.relevantResourceIds, ...criterion.allowedCitationResourceIds ?? []];
      if (gold.variant === 'contradictory' && index === 0 && access !== 'submitted_only') {
        value.adequacy = 'unresolved_conflict'; value.conflictIds = criterion.mandatoryConflictResourceIds ?? [];
        value.gap = 'conflicting_evidence'; value.action = 'reconcile_conflict';
      }
      if (availableStatus === 'insufficient_evidence' && gold.variant === 'unavailable' && access !== 'submitted_only') {value.gap = 'source_unavailable'; value.action = 'restore_source_access';}
      if (availableStatus === 'insufficient_evidence' && gold.variant === 'budget_exhausted' && access === 'retrieval') {value.gap = 'search_incomplete'; value.action = 'continue_search';}
      return [req.id, value];
    }))])) as SufficiencyFixture['labels'];
    return {runtime, policy, labels, family: gold.family, variant: gold.variant, cohort: 'regression', targetRequirementIds: policy.requirements.map(r => r.id), phase6Gold: gold};
  });
  const narrativePolicy = MedicalPolicySchema.parse(JSON.parse(readFileSync(join(root, 'datasets/narrative/policy.json'), 'utf8')));
  const lumbar = phase6.cases[0];
  const resources = (lumbar.initialBundle.entry as Array<{resource: Record<string, unknown>}>).map(e => e.resource);
  const variants = ['complete', 'scattered', 'missing', 'contradictory'];
  for (const family of ['pt_progress', 'lumbar_therapy']) for (const [index, variant] of variants.entries()) {
    const pt = family === 'pt_progress';
    const scenarioId = `scn-${(pt ? 801 : 805) + index}`;
    const patientId = pt ? 'patient-801' : lumbar.patientId;
    const policy: MedicalPolicy = structuredClone(pt ? narrativePolicy : phase6.policies[lumbar.policyId]);
    const target = pt ? 'req-narrative-progress' : 'req-conservative-therapy';
    const noteId = pt ? 'note-801' : 'note-805';
    const note = {
      resourceType: 'DocumentReference', id: noteId, status: 'current', subject: {reference: `Patient/${patientId}`}, date: '2026-07-01',
      text: {status: 'generated', div: pt
        ? '<div>Re-evaluation: walking distance increased from 80 to 160 meters. Goal is 250 meters without a rest; continue the current program.</div>'
        : '<div>Discharge review: she attended every scheduled weekly appointment from May 15 through July 15, completed the prescribed exercises at home every day, and still has pain shooting down the right leg despite completing this course. The end-of-course evaluation is dated July 15.</div>'},
    };
    if (!pt) note.date = '2026-07-15';
    const conflict = {...structuredClone(note), id: `${noteId}-b`, text: {status: 'generated', div: pt
      ? '<div>Same-episode re-evaluation dated July 1: walking distance remained 80 meters with no measurable gain. This contradicts the reported 160 meters; no correction is documented.</div>'
      : '<div>Same-episode attendance reconciliation: the patient missed every appointment after May 15, did not do the home exercises, and completed no therapy course. This conflicts with the discharge review; no reconciliation is documented.</div>'}};
    const initial = pt ? [{resourceType: 'Patient', id: patientId}] : resources.filter(r => r.resourceType !== 'Observation').map(r => {
      const copy = structuredClone(r); if (copy.resourceType === 'Procedure') delete copy.note; return copy;
    });
    const source = {id: 'source-81', name: pt ? 'Community Rehabilitation' : 'Outside Therapy Practice', supportedResourceTypes: ['DocumentReference'], availability: 'available' as const};
    const primary = {id: 'source-80', name: 'Submitting Practice', supportedResourceTypes: ['DocumentReference'], availability: 'available' as const};
    const runtime = ScenarioFixtureSchema.parse({scenarioId, patientId, policyId: policy.id, requestedAt: pt ? '2026-07-04' : lumbar.requestedAt,
      requestedService: pt ? {code: '97110', description: 'PT extension documentation assessment', diagnosisCodes: []} : lumbar.requestedService,
      initialBundle: {resourceType: 'Bundle', type: 'collection', entry: [...initial, ...(variant === 'complete' || variant === 'contradictory' ? [note] : [])].map(resource => ({resource}))},
      sources: [primary, source], sourceCorpus: {[source.id]: variant === 'scattered' ? [note] : variant === 'contradictory' ? [conflict] : []},
    });
    const labels = Object.fromEntries(ACCESS.map(access => {
      const sufficient = variant !== 'missing' && !(variant === 'scattered' && access === 'submitted_only');
      const conflicting = variant === 'contradictory' && access !== 'submitted_only';
      const targetLabel = label(sufficient && !conflicting ? 'satisfied' : 'insufficient_evidence', sufficient ? [`DocumentReference/${noteId}`, ...(!pt ? ['Procedure/proc-lmb-pt-start', 'Procedure/proc-lmb-pt-end'] : [])] : []);
      if (conflicting) {targetLabel.adequacy = 'unresolved_conflict'; targetLabel.conflictIds = [`DocumentReference/${noteId}-b`]; targetLabel.gap = 'conflicting_evidence'; targetLabel.action = 'reconcile_conflict';}
      return [access, {...(!pt ? {'req-radiculopathy': label('satisfied', ['Condition/cond-lmb-radic-01'])} : {}), [target]: targetLabel}];
    })) as SufficiencyFixture['labels'];
    fixtures.push({runtime, policy, labels, family, variant, cohort: pt ? 'development' : 'challenge', targetRequirementIds: [target]});
  }
  const numericPolicy: MedicalPolicy = MedicalPolicySchema.parse(JSON.parse(readFileSync(join(root, 'datasets/policies/sleep-study.json'), 'utf8')));
  const numericReq = numericPolicy.requirements.find(r => r.numericThreshold)!;
  const numericRuntime = ScenarioFixtureSchema.parse({scenarioId: 'scn-899', patientId: 'patient-899', policyId: numericPolicy.id, requestedAt: '2026-07-04', requestedService: {code: numericPolicy.serviceCodes[0], description: 'Sleep study documentation assessment', diagnosisCodes: []}, sources: [], sourceCorpus: {}, initialBundle: {resourceType: 'Bundle', type: 'collection', entry: [
    {resource: {resourceType: 'Patient', id: 'patient-899'}}, {resource: {resourceType: 'Observation', id: 'score-899', status: 'final', subject: {reference: 'Patient/patient-899'}, effectiveDateTime: '2026-07-01', code: {coding: [{system: numericReq.acceptableCodeSystems![0], code: numericReq.acceptableCodes![0]}]}, valueQuantity: {value: 2, ...(numericReq.numericThreshold?.unit ? {unit: numericReq.numericThreshold.unit} : {})}}},
  ]}});
  // Keep the inherited policy intact: the other required clinical evidence is absent.
  const numericLabels = Object.fromEntries(ACCESS.map(access => [access, Object.fromEntries(numericPolicy.requirements.map(req => [req.id, req.id === numericReq.id ? label('not_satisfied', ['Observation/score-899']) : label('insufficient_evidence', [])]))])) as SufficiencyFixture['labels'];
  fixtures.push({runtime: numericRuntime, policy: numericPolicy, labels: numericLabels, family: 'numeric_control', variant: 'below_threshold', cohort: 'negative_control', targetRequirementIds: [numericReq.id]});
  return fixtures;
}

export function writeSufficiencyDataset(root: string) {
  const fixtures = authorSufficiencyDataset(root);
  const directory = join(root, 'datasets/evidence-sufficiency');
  mkdirSync(join(directory, 'inputs'), {recursive: true}); mkdirSync(join(directory, 'gold'), {recursive: true});
  const manifest = fixtures.map(f => {
    const publicPath = `inputs/${f.runtime.scenarioId}.json`; const goldPath = `gold/${f.runtime.scenarioId}.json`;
    const publicInput = {runtime: f.runtime, policy: f.policy};
    const gold = {labels: f.labels, targetRequirementIds: f.targetRequirementIds, phase6Gold: f.phase6Gold};
    writeFileSync(join(directory, publicPath), JSON.stringify(publicInput, null, 2) + '\n');
    writeFileSync(join(directory, goldPath), JSON.stringify(gold, null, 2) + '\n');
    return {id: f.runtime.scenarioId, family: f.family, variant: f.variant, cohort: f.cohort, goldReviewStatus: 'author_only', publicPath, goldPath, publicHash: hashCanonicalJson(publicInput), goldHash: hashCanonicalJson(gold)};
  });
  const dependency = loadRetrievalCohort(root);
  const data = {schemaVersion: '1.0.0', phase6Revision: '383ab99', phase6InputsHash: hashCanonicalJson(dependency.cases), phase6GoldHash: hashCanonicalJson(dependency.goldSidecars), fixtures: manifest};
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(data, null, 2) + '\n');
}

export function loadSufficiencyDataset(root: string): {fixtures: SufficiencyFixture[]; manifest: Record<string, unknown>} {
  const directory = join(root, 'datasets/evidence-sufficiency');
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const fixtures = manifest.fixtures.map((entry: {publicPath: string; goldPath: string; publicHash: string; goldHash: string; family: string; variant: string; cohort: SufficiencyFixture['cohort']}) => {
    const input = JSON.parse(readFileSync(join(directory, entry.publicPath), 'utf8'));
    const gold = JSON.parse(readFileSync(join(directory, entry.goldPath), 'utf8'));
    if (hashCanonicalJson(input) !== entry.publicHash || hashCanonicalJson(gold) !== entry.goldHash) throw new Error('Dataset manifest fingerprint mismatch');
    return {runtime: ScenarioFixtureSchema.parse(input.runtime), policy: MedicalPolicySchema.parse(input.policy), ...gold, family: entry.family, variant: entry.variant, cohort: entry.cohort};
  });
  if (fixtures.length !== 21 || new Set(fixtures.map((f: SufficiencyFixture) => f.runtime.scenarioId)).size !== 21) throw new Error('Expected twenty primary fixtures and one numeric control');
  const dependency = loadRetrievalCohort(root);
  if (hashCanonicalJson(dependency.cases) !== manifest.phase6InputsHash || hashCanonicalJson(dependency.goldSidecars) !== manifest.phase6GoldHash) throw new Error('Phase 6 dependency changed; audit and refreeze explicitly');
  return {fixtures, manifest};
}
