import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DeterministicRulesEvaluator, type PolicyEvaluator } from '@openpa/evaluators';
import { runExperiment, compareExperiments, wilsonInterval } from '../src/experiments.js';

const positive=JSON.parse(readFileSync('datasets/narrative/cases/dev-progress.json','utf8'));
const missing=JSON.parse(readFileSync('datasets/narrative/cases/dev-missing.json','utf8'));
const policy=JSON.parse(readFileSync('datasets/narrative/policy.json','utf8'));
const evaluator=(id:string,tierLevel:number,confidence:number,onCall:()=>void):PolicyEvaluator=>({
  id,name:id,tierLevel,maxTokens:20,maxCostUsd:.001,
  evaluateRequirement:async(req,ctx)=>{onCall();const resource=ctx.indexer.getResources('DocumentReference')[0];return {status:'satisfied',confidence,evidence:[{resourceType:resource.resourceType,resourceId:`${resource.resourceType}/${resource.id}`,textSnippet:resource.textSnippet}],metrics:{costUsd:.001,inputTokens:10,outputTokens:10,latencyMs:10}};},
});

describe('Selective routing experiments',()=>{
  it('replays one cheap judgment per case while escalating only below the chosen threshold',async()=>{
    let cheap=0,expensive=0;
    const report=await runExperiment([{caseData:positive,cohort:'challenge'}],[policy],[{id:'cascade',label:'Cascade',configured:true,evaluators:[new DeterministicRulesEvaluator(),evaluator('cheap',2,.8,()=>cheap++),evaluator('expensive',3,.99,()=>expensive++)]}],{thresholds:[.7,.9]});
    expect(cheap).toBe(1);expect(expensive).toBe(1);expect(report.acquisition.providerCalls).toBe(2);expect(report.acquisition.costUsd).toBe(.002);
    expect(report.runs[0].summary.totalCostUsd).toBe(.001);expect(report.runs[1].summary.totalCostUsd).toBe(.002);
    expect(report.runs[0].summary.tierStats['3']).toBeUndefined();expect(report.runs[1].summary.tierStats['3'].acceptedRequirements).toBe(1);
  });
  it('counts a confidently wrong grounded judgment as unsafe, rather than a safe resolution',async()=>{
    const report=await runExperiment([{caseData:missing,cohort:'challenge'}],[policy],[{id:'wrong',label:'Wrong',configured:true,evaluators:[evaluator('wrong',2,.99,()=>{})]}],{thresholds:[.9]});
    expect(report.runs[0].summary.safeResolutionCoverage).toBe(0);expect(report.runs[0].summary.selectiveRisk).toBe(1);expect(report.runs[0].summary.falseClearances).toBe(1);expect(report.runs[0].summary.unsupportedCitations).toBe(0);
  });
  it('reports undefined risk and cost per safe resolution when every case abstains',async()=>{
    const report=await runExperiment([{caseData:positive,cohort:'challenge'}],[policy],[{id:'rules',label:'Rules',configured:true,evaluators:[new DeterministicRulesEvaluator()]}],{thresholds:[.9]});
    expect(report.runs[0].summary.selectiveRisk).toBeNull();expect(report.runs[0].summary.costPerSafeResolution).toBeNull();expect(report.runs[0].summary.abstentionRate).toBe(1);
  });
  it('rejects unmatched datasets and catches challenge-cohort safety regressions',async()=>{
    const result=await runExperiment([{caseData:positive,cohort:'challenge'}],[policy],[{id:'cascade',label:'Cascade',configured:true,evaluators:[evaluator('cheap',2,.99,()=>{})]}],{thresholds:[.9]});
    const baseline={...result,datasetHash:'same',protocolHash:'protocol'};
    expect(compareExperiments(baseline,{...baseline,datasetHash:'different'}).passed).toBe(false);
    const candidate=structuredClone(baseline);candidate.runs[0].cohorts.challenge.unsafeResolutions=1;
    expect(compareExperiments(baseline,candidate).failures).toContain('cascade/0.9/challenge: safety regression');
  });
  it('zero observed errors retains statistical uncertainty',()=>{
    const ci=wilsonInterval(0,9)!;expect(ci[0]).toBeCloseTo(0);expect(ci[1]).toBeGreaterThan(.25);
  });
  it('halts before paid acquisition exceeds its admitted budget',async()=>{
    let calls=0;const report=await runExperiment([{caseData:positive,cohort:'challenge'}],[policy],[{id:'paid',label:'Paid',configured:true,evaluators:[evaluator('paid',2,.99,()=>calls++)]}],{thresholds:[.9],maxAcquisitionCostUsd:0});
    expect(calls).toBe(0);expect(report.runs[0].summary.abstentionRate).toBe(1);
  });
});
