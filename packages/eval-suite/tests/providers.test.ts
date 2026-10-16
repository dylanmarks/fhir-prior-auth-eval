import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FhirBundleIndexer } from '@openpa/core';
import { JevDecisionEvaluator, StructuredLlmEvaluator, TieredOrchestrator, cleanJsonOutput } from '@openpa/evaluators';

const c=JSON.parse(readFileSync('datasets/narrative/cases/dev-progress.json','utf8'));
const p=JSON.parse(readFileSync('datasets/narrative/policy.json','utf8'));
const context=()=>({caseData:c,indexer:new FhirBundleIndexer(c.patientBundle)});
const opts={apiKey:'test-key',model:'test-model',inputPricePerMillion:1,outputPricePerMillion:1,maxInputTokens:16000,maxOutputTokens:1024};
afterEach(()=>vi.unstubAllGlobals());
describe('Provider contract and accounting',()=>{
  it('marks a failed network response as unknown spend and does not retry blindly',async()=>{
    const fetch=vi.fn(async()=>{throw new Error('Connection closed');});vi.stubGlobal('fetch',fetch);
    await expect(new StructuredLlmEvaluator(opts).evaluateRequirement(p.requirements[0],context())).rejects.toMatchObject({usageVerified:false});
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('calls the Jev Decisions endpoint and builds citations from supplied record IDs',async()=>{
    let payload:any,url:any;
    vi.stubGlobal('fetch',vi.fn(async(u,b)=>{url=u;payload=JSON.parse(b.body);return new Response(JSON.stringify({model:'typesafe/jev-pinned',answers:{outcome:{type:'choice',choice:'satisfied',confidence:.96,probabilities:{satisfied:.96,not_satisfied:.01,insufficient_evidence:.01,ambiguous:.01,conflict:.01}},e0:{type:'choice',choice:'supports',confidence:.95,probabilities:{supports:.95,establishes_not_met:0,contradicts:.01,irrelevant:.02,ambiguous:.02}}},usage:{input_tokens:100,output_tokens:20,cost:.00012}}));}));
    const r=await new JevDecisionEvaluator(opts).evaluateRequirement(p.requirements[0],context());
    expect(url).toBe('https://openrouter.ai/api/alpha/decisions');expect(payload.state.expectedAssessment).toBeUndefined();expect(JSON.stringify(payload)).not.toContain('case-narrative-dev-progress');
    expect(r.status).toBe('satisfied');expect(r.confidence).toBe(.95);expect(r.evidence[0].resourceId).toBe('DocumentReference/note-0');expect(r.metrics.providerModel).toBe('typesafe/jev-pinned');
  });
  it('preserves Jev spend even if decision schema is invalid',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({model:'jev',answers:{},usage:{input_tokens:100,output_tokens:20,cost:.00012}}))));
    await expect(new JevDecisionEvaluator(opts).evaluateRequirement(p.requirements[0],context())).rejects.toMatchObject({metrics:{costUsd:.00012,inputTokens:100}});
  });
  it('marks omitted Jev usage unknown',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({answers:{}}))));
    await expect(new JevDecisionEvaluator(opts).evaluateRequirement(p.requirements[0],context())).rejects.toMatchObject({usageVerified:false});
  });
  it('accepts zero output pricing for Jev decisions',async()=>{
    const jev=new JevDecisionEvaluator({...opts,outputPricePerMillion:0,inputPricePerMillion:0.042});
    expect(jev.maxCostUsd).toBe((16000*0.042)/1e6);
  });
  it('offline Jev abstains without a network request',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect((await new JevDecisionEvaluator().evaluateRequirement(p.requirements[0],context())).confidence).toBe(0);expect(fetch).not.toHaveBeenCalled();
  });
  it('reserves all retry attempts before dispatch',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const e=new StructuredLlmEvaluator({...opts,maxRetries:2});
    expect(e.maxTokens).toBe((16000+1024)*3);
    const a=await new TieredOrchestrator([e],{budgetCapUsd:e.maxCostUsd*.5,maxTokensPerRun:100000}).evaluateCase(c,p);
    expect(a.disposition).toBe('requires_clinical_review');expect(a.executionTrace[0].status).toBe('budget_exceeded');expect(fetch).not.toHaveBeenCalled();
  });
  it('retains accumulated spend when cancelled in retry backoff',async()=>{
    const controller=new AbortController();
    vi.stubGlobal('fetch',vi.fn(async()=>{setTimeout(()=>controller.abort(),20);return new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20},choices:[{message:{content:'bad JSON'}}]}));}));
    await expect(new StructuredLlmEvaluator(opts).evaluateRequirement(p.requirements[0],{...context(),signal:controller.signal})).rejects.toMatchObject({metrics:{inputTokens:100,outputTokens:20,costUsd:.00012}});
  });
  it('rejects oversize input before a paid call',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const r=await new StructuredLlmEvaluator({...opts,maxInputTokens:10}).evaluateRequirement(p.requirements[0],context());expect(r.confidence).toBe(0);expect(fetch).not.toHaveBeenCalled();
  });
  it.each([402,413,422])('does not retry HTTP %s',async status=>{
    const fetch=vi.fn(async()=>new Response('',{status}));vi.stubGlobal('fetch',fetch);
    await expect(new StructuredLlmEvaluator(opts).evaluateRequirement(p.requirements[0],context())).rejects.toThrow(`HTTP ${status}`);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('parses structured LLM outputs wrapped in markdown code fences',async()=>{
    const content = '```json\n{"requirementId":"req-narrative-progress","status":"not_satisfied","confidence":0.85,"evidence":[],"evaluatorNotes":"No progress documented","contradictionDetected":false}\n```';
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({usage:{prompt_tokens:100,completion_tokens:20},choices:[{message:{content}}]}),{status:200})));
    const res = await new StructuredLlmEvaluator(opts).evaluateRequirement(p.requirements[0],context());
    expect(res.status).toBe('not_satisfied');
    expect(res.confidence).toBe(0.85);
    expect(res.notes).toBe('No progress documented');
  });
  it('cleans markdown fences and preamble text from json', ()=>{
    expect(cleanJsonOutput('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(cleanJsonOutput('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(cleanJsonOutput('Here is the JSON:\n```json\n{"a":1}\n```\nHope it helps!')).toBe('{"a":1}');
    expect(cleanJsonOutput('Analysis:\n{"a":1}\nDone.')).toBe('{"a":1}');
  });
});
