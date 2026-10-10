import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MedicalPolicySchema, PriorAuthCaseSchema, FhirBundleIndexer } from '@openpa/core';
import { createEvaluationOrchestrator, GroundingGuardrail } from '@openpa/evaluators';

const load=(path:string)=>JSON.parse(readFileSync(`datasets/${path}.json`,'utf8'));
async function evaluate(scenario:string,caseFile:string,mutate:(c:any,p:any)=>void){
  const c=load(`cases/${caseFile}`),p=load(`policies/${scenario}`);mutate(c,p);
  return createEvaluationOrchestrator('tiered').evaluateCase(PriorAuthCaseSchema.parse(c),MedicalPolicySchema.parse(p));
}
describe('Review safety regressions',()=>{
  it('does not assume a missing Condition clinical status means active disease',async()=>{
    const a=await evaluate('lumbar-mri','lumbar-mri-001-meets',c=>{delete c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='Condition').resource.clinicalStatus;});
    expect(a.disposition).toBe('requires_clinical_review');
  });
  it('does not infer therapy adherence from endpoint dates alone',async()=>{
    const a=await evaluate('lumbar-mri','lumbar-mri-001-meets',c=>{for(const e of c.patientBundle.entry)if(e.resource.resourceType==='Procedure'){delete e.resource.note;delete e.resource.text;}});
    expect(a.disposition).toBe('requires_clinical_review');
  });
  it('does not infer PT progress from a re-evaluation code',async()=>{
    const a=await evaluate('pt-extension','pt-extension-001-meets',c=>{const r=c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='Procedure').resource;delete r.note;delete r.text;});
    expect(a.disposition).toBe('requires_clinical_review');expect(a.requirements[1].status).toBe('insufficient_evidence');
  });
  it('preserves patient-linked refutation in a separate note',async()=>{
    const a=await evaluate('lumbar-mri','lumbar-mri-001-meets',c=>c.patientBundle.entry.push({resource:{resourceType:'DocumentReference',id:'refutation',subject:{reference:'Patient/pat-001'},note:[{text:'Physician refutes radiculopathy; prior diagnosis was incorrect.'}]}}));
    expect(a.disposition).toBe('requires_clinical_review');expect(a.requirements[0].contradictionDetected).toBe(true);
  });
  it('ignores unrelated negation and notes belonging to another patient',async()=>{
    const a=await evaluate('lumbar-mri','lumbar-mri-001-meets',c=>{
      c.patientBundle.entry.push({resource:{resourceType:'DocumentReference',id:'unrelated',subject:{reference:'Patient/pat-001'},note:[{text:'Denies headache and dizziness.'}]}});
      c.patientBundle.entry.push({resource:{resourceType:'DocumentReference',id:'other-patient',subject:{reference:'Patient/other'},note:[{text:'Physician refutes radiculopathy.'}]}});
    });expect(a.disposition).toBe('meets_policy');
  });
  it('escalates a sleepiness score accompanied by explicit fatigue negation',async()=>{
    const a=await evaluate('sleep-study','sleep-study-001-meets',c=>{const r=c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='Observation').resource;r.note=[{text:'Patient denies daytime fatigue.'}];r.text={div:'<div>Patient denies daytime fatigue.</div>'};});
    expect(a.disposition).toBe('requires_clinical_review');
  });
  it('does not accept numeric evidence in an incompatible unit',async()=>{
    const a=await evaluate('sleep-study','sleep-study-001-meets',c=>{c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='Observation').resource.valueQuantity.unit='mg';});
    expect(a.disposition).not.toBe('meets_policy');
  });
  it.each([false,true])('rejects conflicting duplicate canonical IDs regardless of order (reversed=%s)',async reverse=>{
    const a=await evaluate('sleep-study','sleep-study-001-meets',c=>{const e=structuredClone(c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='Observation'));e.resource.valueQuantity.value=1;c.patientBundle.entry.push(e);if(reverse)c.patientBundle.entry.reverse();});
    expect(a.disposition).toBe('requires_clinical_review');expect(a.executionTrace[0].tierLevel).toBe(0);
  });
  it('canonical grounding lookup rejects duplicate IDs',()=>{
    const c=load('cases/sleep-study-001-meets');const entry=c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='Observation');c.patientBundle.entry.push(structuredClone(entry));const indexer=new FhirBundleIndexer(c.patientBundle);
    expect(GroundingGuardrail.verifyCitations([{resourceType:'Observation',resourceId:`Observation/${entry.resource.id}`}],indexer).isValid).toBe(false);
  });
  it('does not substitute report issue time for an invalid examination date',async()=>{
    const a=await evaluate('knee-mri','knee-mri-001-meets',c=>{const r=c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='DiagnosticReport').resource;r.effectiveDateTime='2026-02-30';r.issued=c.requestedAt;});
    expect(a.disposition).toBe('requires_clinical_review');
  });
  it('preserves reversed periods as validation failures',async()=>{
    const a=await evaluate('knee-mri','knee-mri-001-meets',c=>{const r=c.patientBundle.entry.find((e:any)=>e.resource.resourceType==='DiagnosticReport').resource;delete r.effectiveDateTime;r.effectivePeriod={start:'2026-07-03',end:'2026-06-01'};r.issued=c.requestedAt;});
    expect(a.disposition).toBe('requires_clinical_review');
  });
});
