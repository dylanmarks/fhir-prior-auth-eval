import { hashCanonicalJson, EvidenceWorkflowResultSchema, RetrievalResultSchema, MedicalPolicySchema, PriorAuthCaseSchema, type EvidenceWorkflowResult } from '@openpa/core';
import type { SufficiencyReport } from './runner.js';
import type { EvidenceSnapshot, PolicyReplay } from './types.js';

export interface SufficiencyViewReport {
  schemaVersion: '1.0.0';
  generatedAt: string;
  runMode: string;
  testOnly: boolean;
  matrix: SufficiencyReport['matrix'];
  thresholds: number[];
  acquisition: SufficiencyReport['acquisition'];
  empiricalSafety: SufficiencyReport['empiricalSafety'];
  summaries: SufficiencyReport['summaries'];
  tierSummaries: SufficiencyReport['tierSummaries'];
  contrasts: SufficiencyReport['contrasts'];
  snapshots: EvidenceSnapshot[];
  recordings: SufficiencyReport['recordings'];
  probes: SufficiencyReport['probes'];
  cells: Array<Omit<PolicyReplay, 'result' | 'phase6Score'> & {resultRef: string}>;
  results: Record<string, EvidenceWorkflowResult>;
  fingerprints: Record<string, unknown>;
  limitations: string[];
}
export function makeSufficiencyView(report: SufficiencyReport & {runMode?: string; testOnly?: boolean; fingerprints?: Record<string, unknown>; limitations?: string[]}): SufficiencyViewReport {
  const results: Record<string, EvidenceWorkflowResult> = {};
  const cells = report.cells.map(({result, phase6Score: _score, ...cell}) => {
    // Times are inspectable in the full report. The viewer deduplicates matching
    // semantic results across replays rather than bundling hundreds of copies.
    const semantic = {...result, timings: undefined, reviewPacket: {...result.reviewPacket, generatedAt: undefined},
      assessment: {...result.assessment,totalLatencyMs:undefined,executionTrace:result.assessment.executionTrace.map(s => ({...s,latencyMs:undefined}))}};
    const resultRef = hashCanonicalJson(semantic);
    results[resultRef] ??= result;
    return {...cell, resultRef};
  });
  return {schemaVersion:'1.0.0',generatedAt:report.generatedAt,runMode:report.runMode ?? 'offline',testOnly:report.testOnly ?? false,
    matrix:report.matrix,thresholds:report.thresholds,acquisition:report.acquisition,empiricalSafety:report.empiricalSafety,summaries:report.summaries,tierSummaries:report.tierSummaries,contrasts:report.contrasts,
    snapshots:report.snapshots,recordings:report.recordings,probes:report.probes,cells,results,fingerprints:report.fingerprints ?? {},limitations:report.limitations ?? []};
}

export function validateSufficiencyView(value: unknown): SufficiencyViewReport {
  const r = value as SufficiencyViewReport;
  if (r?.schemaVersion !== '1.0.0' || !Array.isArray(r.cells) || !r.cells.length || !Array.isArray(r.snapshots) || !r.snapshots.length || !Array.isArray(r.recordings) || !Array.isArray(r.probes) || !r.results || !r.matrix || !r.acquisition || !r.empiricalSafety || !Array.isArray(r.thresholds) || !r.thresholds.length || r.thresholds.some(t=>!Number.isFinite(t)||t<0||t>1) || !Array.isArray(r.summaries) || !Array.isArray(r.tierSummaries) || !Array.isArray(r.limitations)) throw new Error('Unsupported sufficiency view report');
  for (const snapshot of r.snapshots) {
    MedicalPolicySchema.parse(snapshot.policy); RetrievalResultSchema.parse(snapshot.retrieval);
    PriorAuthCaseSchema.omit({expectedAssessment:true}).parse(snapshot.input);
  }
  for (const result of Object.values(r.results)) EvidenceWorkflowResultSchema.parse(result);
  if (r.cells.some(c => !r.results[c.resultRef] || !r.snapshots.some(s => s.id === c.snapshotId) || !['rules','cheap','tiered','llm'].includes(c.strategy) || !r.thresholds.includes(c.threshold))) throw new Error('Report contains unresolved cell references');
  return r;
}
