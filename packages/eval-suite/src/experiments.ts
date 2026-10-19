import type { AssessmentResult, MedicalPolicy, PriorAuthCase } from '@openpa/core';
import { DeterministicRulesEvaluator, TieredOrchestrator, type PolicyEvaluator, type EvaluatorResult } from '@openpa/evaluators';
import { ScoringEngine } from './metrics/scoring.js';
import { CounterfactualMutator } from './mutations/mutator.js';

export interface UncertaintyObservation {
  caseId: string;
  requirementId: string;
  status: string;
  confidence: number;
  deferred: boolean;
  error?: string;
}

/** Score raw tier judgments before guardrails can replace an unsupported definitive answer. */
export function summarizeUncertainty(rows: UncertaintyObservation[], threshold: number) {
  const preserved = rows.filter(r => !r.error && (r.status === 'insufficient_evidence' || r.deferred ||
    r.confidence < threshold)).length;
  return {
    applicableRuns: rows.length,
    preserved,
    uncertaintyPreserved: rows.length ? preserved / rows.length : null,
    uncertaintyPreserved95Ci: wilsonInterval(preserved, rows.length),
    confidentNotMet: rows.filter(r => r.status === 'not_satisfied' && r.confidence >= threshold).length,
    confidentSatisfied: rows.filter(r => r.status === 'satisfied' && r.confidence >= threshold).length,
    errors: rows.filter(r => r.error).length,
  };
}

export interface ExperimentArm {id: string; label: string; configured: boolean; evaluators: PolicyEvaluator[]}
export interface ExperimentCase {caseData: PriorAuthCase; cohort: 'structured' | 'development' | 'challenge'}
export interface ExperimentOptions {thresholds?: number[]; budgetCapUsd?: number; maxAcquisitionCostUsd?: number; maxTokensPerRun?: number; timeoutMs?: number; maxProviderCalls?: number; maxAcquisitionTokens?: number}

export function wilsonInterval(successes: number, n: number): [number, number] | null {
  if (!n) return null;
  const z=1.96, p=successes/n, divisor=1+z*z/n;
  const center=(p+z*z/(2*n))/divisor;
  const margin=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/divisor;
  return [Math.max(0,center-margin),Math.min(1,center+margin)];
}

function summarize(rows: Array<{caseId: string; cohort: string; assessment: AssessmentResult; score: ReturnType<typeof ScoringEngine.scoreCase>}>) {
  const n=rows.length;
  const resolved=rows.filter(r=>r.assessment.disposition!=='requires_clinical_review');
  const safe=resolved.filter(r=>r.score.isSafelyResolved);
  const unsafe=resolved.filter(r=>!r.score.isSafelyResolved);
  const falseClearances=rows.filter(r=>r.assessment.disposition==='meets_policy' && !r.score.isSafelyResolved);
  const spent=rows.reduce((sum,r)=>sum+r.assessment.totalCostUsd,0);
  const usageVerified=rows.every(r=>r.assessment.usageVerified!==false);
  const costVerified=usageVerified && rows.every(r=>r.assessment.costVerified!==false);
  const latencies=rows.map(r=>r.assessment.executionTrace.reduce((sum,s)=>sum+s.latencyMs,0)).sort((a,b)=>a-b);
  const tierStats: Record<string,{calls:number;acceptedRequirements:number;costUsd:number;tokens:number;costVerified?:boolean}>={};
  const calibration: Array<{confidence:number;correct:boolean}>=[];
  for(const r of rows) for(const step of r.assessment.executionTrace) {
    const key=String(step.tierLevel);
    const stat=tierStats[key]??={calls:0,acceptedRequirements:0,costUsd:0,tokens:0};
    stat.calls++;stat.costUsd+=step.costUsd;stat.tokens+=step.inputTokens+step.outputTokens;
    if(step.costVerified===false) stat.costVerified=false;
    if(step.status==='success') {
      stat.acceptedRequirements++;
      const predicted=r.assessment.requirements.find(q=>q.requirementId===step.requirementId);
      const expected=r.score; // Case-level correctness is deliberately stricter than status alone.
      calibration.push({confidence:step.confidence,correct:!!predicted && expected.isSafelyResolved});
    }
  }
  const bins=Array.from({length:5},(_,i)=>{
    const items=calibration.filter(p=>p.confidence>=i/5 && (i===4 ? p.confidence<=1 : p.confidence<(i+1)/5));
    return {lower:i/5,upper:(i+1)/5,count:items.length,meanConfidence:items.length?items.reduce((s,p)=>s+p.confidence,0)/items.length:null,empiricalSafeCaseRate:items.length?items.filter(p=>p.correct).length/items.length:null};
  });
  return {
    totalCases:n, dispositionAccuracy:n?rows.filter(r=>r.score.dispositionMatch).length/n:0,
    automationCoverage:n?resolved.length/n:0, safeResolutionCoverage:n?safe.length/n:0,
    abstentionRate:n?(n-resolved.length)/n:0, unsafeResolutions:unsafe.length, falseClearances:falseClearances.length,
    unsafeCaseIds:unsafe.map(r=>r.caseId),
    selectiveRisk:resolved.length?unsafe.length/resolved.length:null,
    selectiveRisk95Ci:wilsonInterval(unsafe.length,resolved.length), safeCoverage95Ci:wilsonInterval(safe.length,n),
    totalCostUsd:costVerified?spent:null, knownCostUsd:spent, usageVerified, costVerified,
    costPerSafeResolution:costVerified&&safe.length?spent/safe.length:null,
    p50AdapterLatencyMs:latencies[Math.floor(latencies.length*.5)]??null,
    p95AdapterLatencyMs:latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))]??null,
    unsupportedCitations:rows.reduce((s,r)=>s+r.score.unsupportedCitations,0), tierStats, reliabilityBins:bins,
  };
}

/** Cache judgments once, replay routing policies. Reported policy cost is hypothetical per-run cost. */
export async function runExperiment(cases: ExperimentCase[], policies: MedicalPolicy[], arms: ExperimentArm[], options: ExperimentOptions={}) {
  const thresholds=options.thresholds??[.7,.9,.99];
  if (!thresholds.length || thresholds.some(t=>!Number.isFinite(t)||t<0||t>1)) throw new Error('Invalid experiment thresholds');
  if (!cases.length || new Set(cases.map(c=>c.caseData.id)).size!==cases.length) throw new Error('Experiment requires nonempty unique case IDs');
  const cap=options.maxAcquisitionCostUsd??2;
  if(!Number.isFinite(cap)||cap<0) throw new Error('Invalid acquisition budget');
  const callCap=options.maxProviderCalls??200, tokenCap=options.maxAcquisitionTokens??1_000_000;
  if(!Number.isInteger(callCap)||callCap<=0||!Number.isInteger(tokenCap)||tokenCap<=0) throw new Error('Invalid acquisition call/token budget');
  const cache=new Map<string,Promise<EvaluatorResult>>();
  const recordings: Array<{model:string;caseId:string;requirementId:string;inputKind:'case'|'evidence_removal';result?:EvaluatorResult;error?:string}>=[];
  let acquisitionCostUsd=0, acquisitionUsageVerified=true, acquisitionCostVerified=true, providerCalls=0, acquisitionTokens=0;
  const wrap=(e:PolicyEvaluator,inputKind:'case'|'evidence_removal'='case'):PolicyEvaluator=>({
    id:e.id,name:e.name,tierLevel:e.tierLevel,maxCostUsd:e.maxCostUsd,maxTokens:e.maxTokens,billingSource:e.billingSource,
    evaluateRequirement:async(req,ctx)=>{
      const key=JSON.stringify([e.id,e.maxCostUsd,e.maxTokens,req,ctx.caseData.patientBundle,ctx.caseData.requestedService,ctx.caseData.requestedAt]);
      let result=cache.get(key);
      if(!result){
        if(!acquisitionUsageVerified) throw new Error('Prior provider usage is unknown; acquisition halted');
        const reserve=e.maxCostUsd??0;
        if(acquisitionCostUsd+reserve>cap) throw new Error('Experiment acquisition budget exhausted before provider dispatch');
        const provider=reserve>0||e.billingSource==='chatgpt-plan';
        if(provider&&(providerCalls>=callCap||acquisitionTokens+(e.maxTokens??0)>tokenCap)) throw new Error('Experiment acquisition call/token budget exhausted');
        result=(async()=>{
          if(provider) providerCalls++;
          try {const r=await e.evaluateRequirement(req,ctx);acquisitionCostUsd+=r.metrics.costUsd;acquisitionTokens+=r.metrics.inputTokens+r.metrics.outputTokens;if(r.metrics.costVerified===false) acquisitionCostVerified=false;recordings.push({model:e.id,caseId:ctx.caseData.id,requirementId:req.id,inputKind,result:r});return r;}
          catch(error){const m=(error as any).metrics;acquisitionCostUsd+=m?.costUsd??0;acquisitionTokens+=(m?.inputTokens??0)+(m?.outputTokens??0);if(m?.costVerified===false) acquisitionCostVerified=false;if((error as any).usageVerified===false||ctx.signal?.aborted) acquisitionUsageVerified=false;recordings.push({model:e.id,caseId:ctx.caseData.id,requirementId:req.id,inputKind,error:error instanceof Error?error.message:'Provider failure'});throw error;}
        })();
        cache.set(key,result);
      }
      return result;
    },
  });
  const policyMap=new Map(policies.map(p=>[p.id,p]));
  // Fix applicability once with the offline rules baseline, independent of the tier under test.
  const probeBaseline = new TieredOrchestrator([new DeterministicRulesEvaluator()]);
  const evidenceRemoval = [];
  for (const c of cases) {
    const policy = policyMap.get(c.caseData.policyId);
    if (!policy) throw new Error(`Missing policy ${c.caseData.policyId}`);
    const baseline = await probeBaseline.evaluateCase(c.caseData, policy);
    evidenceRemoval.push({caseId: c.caseData.id, ...CounterfactualMutator.applyMutation(c.caseData, 'remove_supporting_evidence', baseline)});
  }
  const runs=[];
  for(const arm of arms) for(const threshold of thresholds) {
    const orchestrator=new TieredOrchestrator(arm.evaluators.map(e=>wrap(e)),{
      minConfidenceThreshold:.9, tierConfidenceThresholds:{2:threshold,3:threshold,4:threshold},
      budgetCapUsd:options.budgetCapUsd??.1,maxTokensPerRun:options.maxTokensPerRun??100000,timeoutMs:options.timeoutMs??30000,
    });
    const rows: Parameters<typeof summarize>[0]=[];
    for(const c of cases){
      const p=policyMap.get(c.caseData.policyId);if(!p) throw new Error(`Missing policy ${c.caseData.policyId}`);
      const assessment=await orchestrator.evaluateCase(c.caseData,p);
      rows.push({caseId:c.caseData.id,cohort:c.cohort,assessment,score:ScoringEngine.scoreCase(c.caseData,assessment)});
    }
    const uncertaintyByTier = [];
    for (const evaluator of arm.evaluators) {
      const configured = evaluator.tierLevel === 1 || arm.configured;
      const observations: UncertaintyObservation[] = [];
      if (configured) for (const probe of evidenceRemoval.filter(p => p.isApplicable)) {
        const policy = policyMap.get(probe.mutatedCase.policyId)!;
        const requirement = policy.requirements.find(r => r.id === probe.expectedFlippedRequirementId)!;
        let raw: EvaluatorResult | undefined;
        let error: string | undefined;
        const cached = wrap(evaluator, 'evidence_removal');
        const isolated: PolicyEvaluator = {...cached, evaluateRequirement: async (req, ctx) => {
          try { raw = await cached.evaluateRequirement(req, ctx); return raw; }
          catch (failure) { error = failure instanceof Error ? failure.message : 'Evaluator failure'; throw failure; }
        }};
        // Test each tier directly: early rules acceptance must not hide later-tier uncertainty loss.
        const assessment = await new TieredOrchestrator([isolated], {
          minConfidenceThreshold: threshold, budgetCapUsd: options.budgetCapUsd ?? .1,
          maxTokensPerRun: options.maxTokensPerRun ?? 100000, timeoutMs: options.timeoutMs ?? 30000,
        }).evaluateCase(probe.mutatedCase, {...policy, requirements: [requirement]});
        const failure = assessment.executionTrace.find(s => s.status === 'failed' || s.status === 'budget_exceeded');
        observations.push({caseId: probe.caseId, requirementId: requirement.id,
          status: raw?.status ?? 'unavailable', confidence: raw?.confidence ?? 0,
          // A provider error or guardrail repair is not a successful abstention.
          deferred: !!raw && !error && (raw.escalateToClinicalReview === true || raw.contradictionDetected === true || raw.status === 'not_applicable'),
          error: error ?? (failure ? failure.decision : undefined),
        });
      }
      uncertaintyByTier.push({tierLevel: evaluator.tierLevel, evaluatorId: evaluator.id, configured,
        threshold, summary: configured ? summarizeUncertainty(observations, threshold) : null, observations});
    }
    runs.push({armId:arm.id,label:arm.label,configured:arm.configured,threshold,summary:summarize(rows),uncertaintyByTier,cohorts:Object.fromEntries(['structured','development','challenge'].map(cohort=>[cohort,summarize(rows.filter(r=>r.cohort===cohort))])),cases:rows});
  }
  return {
    schemaVersion:2, timestamp:new Date().toISOString(),
    methodology:'Recorded judgments replayed across thresholds. Routing confidence is not clinical calibration. Adapter latency excludes orchestration overhead. Synthetic labels are hand-authored; challenge is not independently validated.',
    acquisition:{providerCalls,tokens:acquisitionTokens,costUsd:acquisitionUsageVerified&&acquisitionCostVerified?acquisitionCostUsd:null,knownCostUsd:acquisitionCostUsd,usageVerified:acquisitionUsageVerified,costVerified:acquisitionCostVerified},
    recordings,
    evidenceRemoval: evidenceRemoval.map(({mutatedCase, ...probe}) => probe),
    runs,
  };
}

export type ExperimentReport = Awaited<ReturnType<typeof runExperiment>>;

/** Refuse incomparable snapshots; fail on safety, coverage, accuracy, or cost regressions. */
export function compareExperiments(baseline: ExperimentReport & {datasetHash?:string;protocolHash?:string}, candidate: ExperimentReport & {datasetHash?:string;protocolHash?:string}) {
  const failures:string[]=[];
  if(!baseline.datasetHash||baseline.datasetHash!==candidate.datasetHash) failures.push('Dataset fingerprint differs or is missing');
  if(!baseline.protocolHash||baseline.protocolHash!==candidate.protocolHash) failures.push('Evaluation protocol differs or is missing');
  if(failures.length) return {passed:false,failures};
  for(const b of baseline.runs){
    const c=candidate.runs.find(r=>r.armId===b.armId&&r.threshold===b.threshold);
    if(!c){failures.push(`Missing arm/threshold: ${b.armId}/${b.threshold}`);continue;}
    if(c.configured!==b.configured) failures.push(`${b.armId}: provider availability changed`);
    if(!c.summary.usageVerified) failures.push(`${b.armId}: unverified usage`);
    if(c.summary.falseClearances>0||c.summary.unsupportedCitations>0) failures.push(`${b.armId}: absolute evidence safety gate failed`);
    for (const tier of c.uncertaintyByTier ?? []) {
      if (tier.summary?.confidentSatisfied) failures.push(`${b.armId}/${b.threshold}/tier-${tier.tierLevel}: absolute evidence safety gate failed (confident satisfied after evidence removal)`);
    }
    for (const old of b.uncertaintyByTier ?? []) {
      const next = c.uncertaintyByTier?.find(t => t.tierLevel === old.tierLevel);
      if (!next || next.configured !== old.configured || next.summary?.applicableRuns !== old.summary?.applicableRuns) {
        failures.push(`${b.armId}/${b.threshold}/tier-${old.tierLevel}: uncertainty probe availability changed`);
      } else if (old.summary?.uncertaintyPreserved != null &&
        (next.summary?.uncertaintyPreserved == null || next.summary.uncertaintyPreserved < old.summary.uncertaintyPreserved)) {
        failures.push(`${b.armId}/${b.threshold}/tier-${old.tierLevel}: uncertainty preserved regression`);
      }
    }
    for(const cohort of ['structured','development','challenge']){
      const old=b.cohorts[cohort],next=c.cohorts[cohort];
      if(next.unsafeResolutions>old.unsafeResolutions||next.falseClearances>old.falseClearances||next.unsupportedCitations>old.unsupportedCitations) failures.push(`${b.armId}/${b.threshold}/${cohort}: safety regression`);
      if(next.unsafeCaseIds.some(id=>!old.unsafeCaseIds.includes(id))) failures.push(`${b.armId}/${b.threshold}/${cohort}: newly unsafe case`);
      if(next.safeResolutionCoverage<old.safeResolutionCoverage||next.dispositionAccuracy<old.dispositionAccuracy) failures.push(`${b.armId}/${b.threshold}/${cohort}: coverage or accuracy regression`);
      if(old.totalCostUsd!=null && next.totalCostUsd!=null && next.totalCostUsd>old.totalCostUsd*1.1+0.000001) failures.push(`${b.armId}/${b.threshold}/${cohort}: cost increased >10%`);
    }
  }
  return {passed:!failures.length,failures};
}
