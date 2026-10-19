import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { DeterministicRulesEvaluator, type PolicyEvaluator } from '@openpa/evaluators';
import { runExperiment, compareExperiments, wilsonInterval, summarizeUncertainty } from '../src/experiments.js';
import { loadDataset } from '../src/dataset.js';
import { clinicalContext } from '../../evaluators/src/clinical-context.js';

const positive=JSON.parse(readFileSync('datasets/narrative/cases/dev-progress.json','utf8'));
const missing=JSON.parse(readFileSync('datasets/narrative/cases/dev-missing.json','utf8'));
const policy=JSON.parse(readFileSync('datasets/narrative/policy.json','utf8'));
const evaluator=(id:string,tierLevel:number,confidence:number,onCall:()=>void):PolicyEvaluator=>({
  id,name:id,tierLevel,maxTokens:20,maxCostUsd:.001,
  evaluateRequirement:async(req,ctx)=>{onCall();const resource=ctx.indexer.getResources('DocumentReference')[0];return {status:'satisfied',confidence,evidence:[{resourceType:resource.resourceType,resourceId:`${resource.resourceType}/${resource.id}`,textSnippet:resource.textSnippet}],metrics:{costUsd:.001,inputTokens:10,outputTokens:10,latencyMs:10}};},
});

describe('Selective routing experiments',()=>{
  it('measures uncertainty and confident errors at each threshold without crediting provider failures', () => {
    const row = {caseId:'probe',requirementId:'target',deferred:false};
    const rows = [
      {...row,status:'insufficient_evidence',confidence:1},
      {...row,status:'not_satisfied',confidence:.95},
      {...row,status:'satisfied',confidence:.8},
      {...row,status:'not_applicable',confidence:0,deferred:true},
      {...row,status:'unavailable',confidence:0,error:'Provider failed'},
    ];
    expect(summarizeUncertainty(rows,.9)).toMatchObject({applicableRuns:5,preserved:3,uncertaintyPreserved:.6,confidentNotMet:1,confidentSatisfied:0,errors:1});
    expect(summarizeUncertainty(rows,.7)).toMatchObject({preserved:2,confidentSatisfied:1});
    expect(summarizeUncertainty(rows,.99)).toMatchObject({preserved:4,confidentNotMet:0});
    expect(summarizeUncertainty(rows,.9).uncertaintyPreserved95Ci).toEqual(wilsonInterval(3,5));
    expect(summarizeUncertainty([],.9).uncertaintyPreserved).toBeNull();
  });

  it('reports the fixed evidence-removal applicability across all 22 fixtures and leaves model tiers unconfigured', async () => {
    const dataset = loadDataset(process.cwd());
    const report = await runExperiment(dataset.cases,dataset.policies,[
      {id:'rules',label:'Rules',configured:true,evaluators:[new DeterministicRulesEvaluator()]},
      {id:'unconfigured',label:'Unconfigured',configured:false,evaluators:[evaluator('unconfigured',2,1,()=>{throw new Error('must not acquire probes');})]},
    ],{thresholds:[.7,.9,.99],maxAcquisitionCostUsd:0});
    expect(report.evidenceRemoval).toHaveLength(22);
    expect(report.evidenceRemoval.filter(p=>p.isApplicable).map(p=>p.caseId)).toEqual([
      'case-cgm-001-meets','case-knee-001-meets','case-lumbar-001-meets','case-pt-001-meets','case-sleep-001-meets',
    ]);
    for (const run of report.runs.filter(r=>r.armId==='rules')) {
      expect(run.uncertaintyByTier[0].summary).toMatchObject({applicableRuns:5,uncertaintyPreserved:1,confidentNotMet:0,confidentSatisfied:0});
    }
    for (const run of report.runs.filter(r=>r.armId==='unconfigured')) expect(run.uncertaintyByTier[0].summary).toBeNull();
    expect(report.acquisition.providerCalls).toBe(0);
  });

  it('tests later tiers directly and gates uncertainty loss and confident satisfaction before guardrail repair', async () => {
    const c = JSON.parse(readFileSync('datasets/cases/lumbar-mri-001-meets.json','utf8'));
    const p = JSON.parse(readFileSync('datasets/policies/lumbar-mri.json','utf8'));
    const fixture = (status:'insufficient_evidence'|'not_satisfied'|'satisfied'):PolicyEvaluator => ({
      id:'probe-tier',name:'Probe tier',tierLevel:2,
      evaluateRequirement:async(req,ctx)=>{
        const providerInput = JSON.stringify({requirement:req,records:clinicalContext(ctx,req)});
        expect(providerInput).not.toContain('remove_supporting_evidence');
        expect(ctx.caseData).not.toHaveProperty('expectedAssessment');
        return {status,confidence:1,evidence:[],metrics:{costUsd:0,inputTokens:0,outputTokens:0,latencyMs:0}};
      },
    });
    const run = async(status:'insufficient_evidence'|'not_satisfied'|'satisfied') => ({
      ...await runExperiment([{caseData:c,cohort:'structured'}],[p],[{id:'cascade',label:'Cascade',configured:true,evaluators:[new DeterministicRulesEvaluator(),fixture(status)]}],{thresholds:[.9]}),
      datasetHash:'same',protocolHash:'same',
    });
    const baseline = await run('insufficient_evidence');
    const negative = await run('not_satisfied');
    expect(negative.runs[0].uncertaintyByTier[1].summary).toMatchObject({uncertaintyPreserved:0,confidentNotMet:1});
    expect(compareExperiments(baseline,negative).failures).toContain('cascade/0.9/tier-2: uncertainty preserved regression');
    const satisfied = await run('satisfied');
    expect(satisfied.runs[0].uncertaintyByTier[1].summary?.confidentSatisfied).toBe(1);
    expect(compareExperiments(satisfied,satisfied).failures.some(f=>f.includes('absolute evidence safety gate failed'))).toBe(true);
    expect(compareExperiments(baseline,baseline).passed).toBe(true);
  });
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
