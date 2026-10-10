import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createEvaluationOrchestrator, StructuredLlmEvaluator, TieredOrchestrator } from '../../packages/evaluators/dist/index.js';
import { FhirBundleIndexer } from '../../packages/core/dist/index.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const load = (path) => JSON.parse(readFileSync(`${root}/datasets/${path}`, 'utf8'));
const probes = [
  ['PT re-evaluation with no progress narrative', 'pt-extension', 'pt-extension-001-meets', c => { const r = c.patientBundle.entry.find(e => e.resource.code?.coding?.some(x => x.code === '97164')).resource; delete r.text; delete r.note; }],
  ['Sleep score 14 but denies fatigue', 'sleep-study', 'sleep-study-001-meets', c => { const r = c.patientBundle.entry.find(e => e.resource.resourceType === 'Observation').resource; r.text = {div:'<div>Patient denies daytime fatigue</div>'}; r.note = [{text:'Patient denies daytime fatigue'}]; }],
  ['Sleep numeric unit mismatch', 'sleep-study', 'sleep-study-001-meets', c => { const r = c.patientBundle.entry.find(e => e.resource.resourceType === 'Observation').resource; r.valueQuantity = {value:14,unit:'mg',system:'http://unitsofmeasure.org',code:'mg'}; }],
  ['Duplicate conflicting canonical resource', 'sleep-study', 'sleep-study-001-meets', c => { const r = structuredClone(c.patientBundle.entry.find(e => e.resource.resourceType === 'Observation')); r.resource.valueQuantity.value = 1; r.resource.note = [{text:'Epworth score: 1'}]; r.resource.text = {div:'<div>Epworth score: 1</div>'}; c.patientBundle.entry.push(r); }],
  ['Imaging invalid date with valid issued fallback', 'knee-mri', 'knee-mri-001-meets', c => { for (const e of c.patientBundle.entry) if (e.resource.resourceType === 'DiagnosticReport') {e.resource.effectiveDateTime='2026-02-30';e.resource.issued=c.requestedAt;} }],
  ['Diagnosis contradiction in separate DocumentReference', 'lumbar-mri', 'lumbar-mri-001-meets', c => { c.patientBundle.entry.push({resource:{resourceType:'DocumentReference',id:'refutation',status:'current',subject:{reference:'Patient/'+c.patientBundle.entry.find(e=>e.resource.resourceType==='Patient').resource.id},note:[{text:'Physician assessment: patient has no radiculopathy. Prior diagnosis is incorrect.'}]}}); }],
];
for (const [name, policyName, caseName, mutate] of probes) {
 const c=load(`cases/${caseName}.json`);const p=load(`policies/${policyName}.json`);mutate(c);
 if(name.includes('unit mismatch')) p.requirements.find(r=>r.numericThreshold).numericThreshold.unit='{score}';
 const a=await createEvaluationOrchestrator('rules').evaluateCase(c,p);
 console.log(JSON.stringify({probe:name,disposition:a.disposition,requirements:a.requirements.map(r=>({id:r.requirementId,status:r.status,notes:r.evaluatorNotes}))}));
}
const llm=new StructuredLlmEvaluator({apiKey:'not-a-real-key',model:'test',maxInputTokens:10,maxOutputTokens:10,inputPricePerMillion:1,outputPricePerMillion:1,maxRetries:2});
console.log(JSON.stringify({probe:'retry reservation',maxTokens:llm.maxTokens,maxCostUsd:llm.maxCostUsd,possibleAttempts:3}));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:5},choices:[{message:{content:'invalid json'}}]}),{status:200}); };
try {
 const c=load('cases/sleep-study-001-meets.json');const p=load('policies/sleep-study.json');
 const a=await new TieredOrchestrator([llm],{budgetCapUsd:0.000025}).evaluateCase(c,p);
 console.log(JSON.stringify({probe:'retries exceed admitted budget',calls,cap:0.000025,actualCost:a.totalCostUsd,disposition:a.disposition}));
 const controller=new AbortController();
 globalThis.fetch=async()=>{setTimeout(()=>controller.abort(),25);return new Response(JSON.stringify({usage:{prompt_tokens:10,completion_tokens:5},choices:[{message:{content:'invalid json'}}]}),{status:200});};
 try { await llm.evaluateRequirement(p.requirements[0],{caseData:c,indexer:new FhirBundleIndexer(c.patientBundle),signal:controller.signal}); } catch(e) {console.log(JSON.stringify({probe:'abort in retry backoff loses usage',message:e.message,metrics:e.metrics??null}));}
} finally {globalThis.fetch=originalFetch;}
