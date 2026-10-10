import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { MedicalPolicySchema, PriorAuthCaseSchema } from '@openpa/core';
import type { ExperimentCase } from './experiments.js';

export function loadDataset(root: string) {
  const read=(path:string)=>JSON.parse(readFileSync(join(root,path),'utf8'));
  const structured=readdirSync(join(root,'datasets/cases')).filter(f=>f.endsWith('.json')).sort().map(f=>PriorAuthCaseSchema.parse(read(`datasets/cases/${f}`)));
  const policies=readdirSync(join(root,'datasets/policies')).filter(f=>f.endsWith('.json')).sort().map(f=>MedicalPolicySchema.parse(read(`datasets/policies/${f}`)));
  const manifest=read('datasets/narrative/manifest.json') as {development:string[];challenge:string[];version:string;labelProvenance:string};
  const narrative=readdirSync(join(root,'datasets/narrative/cases')).filter(f=>f.endsWith('.json')).sort().map(f=>PriorAuthCaseSchema.parse(read(`datasets/narrative/cases/${f}`)));
  const cases:ExperimentCase[]=[...structured.map(caseData=>({caseData,cohort:'structured' as const})),...narrative.map(caseData=>{
    const development=manifest.development.includes(caseData.id),challenge=manifest.challenge.includes(caseData.id);
    if(development===challenge) throw new Error(`Case must belong to exactly one narrative cohort: ${caseData.id}`);
    return {caseData,cohort:development?'development' as const:'challenge' as const};
  })];
  if(manifest.development.length+manifest.challenge.length!==narrative.length) throw new Error('Narrative manifest contains missing or duplicate case IDs');
  policies.push(MedicalPolicySchema.parse(read('datasets/narrative/policy.json')));
  return {cases,policies,manifest};
}
