import { FhirBundleIndexer, hashCanonicalJson, type AssessmentResult, type EvidenceWorkflowResult } from '@openpa/core';
import { TieredOrchestrator, buildReviewPacket, GroundingGuardrail } from '@openpa/evaluators';
import { RetrievalScorer } from '../retrieval/scorer.js';
import { AcquisitionStore } from './recording.js';
import { materializeSnapshots } from './snapshots.js';
import { scoreCell, summarizeCells, summarizeProbes, pairedContrast, probeFlags } from './scorer.js';
import { STRATEGIES, type EvaluatorBinding, type EvidenceSnapshot, type Recording, type PolicyReplay, type TierObservation, type SufficiencyFixture, type Strategy } from './types.js';

export interface SufficiencyOptions {
  fixtures: SufficiencyFixture[];
  bindings: Record<string, EvaluatorBinding>;
  strategyBindings: Record<Strategy, string[]>;
  thresholds?: number[];
  replicates?: number;
  maxSpend: number;
  maxCalls?: number;
  maxTokens?: number;
  caseBudget?: number;
  caseTokens?: number;
  timeoutMs?: number;
  implementationHash: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

function observation(snapshot: EvidenceSnapshot, binding: EvaluatorBinding, reqId: string, threshold: number, recording: Recording | undefined, assessment: AssessmentResult): TierObservation {
  const steps = assessment.executionTrace.filter(step => step.requirementId === reqId && step.tierLevel === binding.evaluator.tierLevel);
  const step = steps.at(-1);
  const outcome = recording?.outcome ?? 'budget_exhausted';
  const raw = recording?.result;
  let guardVerdict: TierObservation['guardVerdict'] = outcome !== 'acquired' ? 'unacquired' : step?.status === 'success' ? 'accepted' : step?.status === 'escalated' ? 'blocked' : 'deferred';
  let guardReason = step?.decision ?? 'Policy admission or earlier safety stop prevented dispatch';
  if (guardVerdict === 'accepted' && !snapshot.retrieval.completeWithinScope && raw?.status === 'satisfied') {guardVerdict = 'blocked'; guardReason = `Workflow completeness gate: ${snapshot.retrieval.stoppingReason}; assessment retained separately.`;}
  return {snapshotId: snapshot.id, snapshotHash: snapshot.contentHash, replicate: snapshot.replicate, requirementId: reqId, tier: binding.evaluator.tierLevel, evaluatorKey: binding.key,
    recordingId: recording?.id ?? null, outcome, threshold, guardVerdict, guardReason};
}

export async function runSufficiencyExperiment(options: SufficiencyOptions) {
  const thresholds = options.thresholds ?? [.7, .9, .99], replicates = options.replicates ?? 1;
  if (!thresholds.length || thresholds.some(t => !Number.isFinite(t) || t < 0 || t > 1) || new Set(thresholds).size !== thresholds.length) throw new Error('Invalid threshold plan');
  if (!Number.isInteger(replicates) || replicates < 1) throw new Error('Replicates must be a positive integer');
  const store = new AcquisitionStore({maxSpend: options.maxSpend, maxCalls: options.maxCalls ?? 500, maxTokens: options.maxTokens ?? 2_000_000, timeoutMs: options.timeoutMs ?? 30000, implementationHash: options.implementationHash, signal: options.signal});
  const snapshots: EvidenceSnapshot[] = [], cells: PolicyReplay[] = [], probes: TierObservation[] = [];
  const orchestratorOptions = (threshold: number) => ({minConfidenceThreshold: .9, tierConfidenceThresholds: {2: threshold, 3: threshold, 4: threshold},
    budgetCapUsd: options.caseBudget ?? .1, maxTokensPerRun: options.caseTokens ?? 100000, timeoutMs: (options.timeoutMs ?? 30000) + 1000, signal: options.signal});
  for (let replicate = 1; replicate <= replicates; replicate++) for (const fixture of options.fixtures) {
    const frozen = await materializeSnapshots(fixture, replicate, options.signal);
    snapshots.push(...frozen);
    for (const snapshot of frozen) {
      const before = hashCanonicalJson(snapshot);
      const indexer = new FhirBundleIndexer(snapshot.input.patientBundle);
      for (const strategy of STRATEGIES) for (const threshold of thresholds) {
        const bindings = options.strategyBindings[strategy].map(key => options.bindings[key]);
        if (!bindings.length || bindings.some(b => !b)) throw new Error('Missing strategy binding');
        const used: Array<{binding: EvaluatorBinding; record: Recording}> = [];
        const orchestrator = new TieredOrchestrator(bindings.map(binding => store.wrap(binding, snapshot, 'policy', record => used.push({binding, record}))), orchestratorOptions(threshold));
        const started = performance.now();
        const assessment = await orchestrator.evaluateCase(snapshot.input, snapshot.policy);
        const assessmentMs = performance.now() - started;
        // The existing guard preserves rejected citations in the raw assessment.
        // They remain inspectable there, while packet content only admits verified sources.
        const packetAssessment = structuredClone(assessment);
        const invalidCitations: string[] = [];
        for (const req of packetAssessment.requirements) req.evidence = req.evidence.filter(c => {
          const valid = GroundingGuardrail.verifyCitations([c], indexer).isValid;
          if (!valid) invalidCitations.push(c.resourceId); return valid;
        });
        const packetStart = performance.now();
        const packetRetrieval = {...snapshot.retrieval, integrityIssues: [...snapshot.retrieval.integrityIssues, ...invalidCitations.map(id => `Rejected assessment citation omitted from packet: ${id}`)]};
        const reviewPacket = buildReviewPacket({scenarioId: snapshot.fixtureId, patientId: fixture.runtime.patientId, requestedService: snapshot.input.requestedService,
          policy: snapshot.policy, retrieval: packetRetrieval, assessment: packetAssessment, indexer});
        const result: EvidenceWorkflowResult = {scenarioId: snapshot.fixtureId, assessment, retrieval: snapshot.retrieval,
          workflowDisposition: reviewPacket.workflowDisposition, reviewPacket,
          timings: {retrievalMs: snapshot.retrievalMs, assessmentMs, packetMs: performance.now() - packetStart, totalMs: performance.now() - started + snapshot.retrievalMs}};
        const observations = used.map(({binding, record}) => observation(snapshot, binding, record.requirementId, threshold, record, assessment));
        const allConfigured = bindings.every(b => b.configured);
        const completeAcquisition = observations.every(o => o.outcome === 'acquired') && !assessment.executionTrace.some(t => ['failed','budget_exceeded'].includes(t.status));
        const availability = allConfigured && completeAcquisition ? 'available' : bindings.some(b => b.configured) ? 'partial' : 'unavailable';
        // Each policy invocation counts in its counterfactual cost even if two
        // tiers share one acquired recording. Only actual acquisition spend deduplicates.
        const policyRecords = used.map(u => u.record);
        const knownCost = policyRecords.reduce((sum,r) => sum + r.knownCostUsd, 0);
        const policyCostUsd = policyRecords.every(r => r.usageVerified && r.costVerified) && assessment.costVerified !== false && assessment.usageVerified !== false ? knownCost : null;
        const cell: PolicyReplay = {snapshotId: snapshot.id, fixtureId: snapshot.fixtureId, replicate, family: fixture.family, variant: fixture.variant, cohort: fixture.cohort,
          strategy, threshold, availability, observations, result, completenessOverride: !snapshot.retrieval.completeWithinScope && assessment.disposition !== result.workflowDisposition,
          score: scoreCell(snapshot, fixture, result), policyCostUsd, policyKnownCostUsd: knownCost,
          policyAdapterLatencySumMs: policyRecords.reduce((sum,r) => sum + (r.result?.metrics.latencyMs ?? 0), 0), latencyBasis: 'Sum of recorded adapter times for this replay; not observed policy wall-clock latency. Retrieval measured separately.'};
        if (fixture.phase6Gold) cell.phase6Score = new RetrievalScorer().scoreCase(result, fixture.phase6Gold, snapshot.access, indexer);
        cells.push(cell);
      }
      // Probe all declared target tiers regardless of the cascade's stopping point.
      for (const binding of Object.values(options.bindings).filter(b => b.key !== 'frontier-baseline')) for (const reqId of fixture.targetRequirementIds) {
        const req = snapshot.policy.requirements.find(r => r.id === reqId);
        if (!req) throw new Error('Probe references an unknown policy criterion');
        for (const threshold of thresholds) {
          let record: Recording | undefined;
          const evaluator = store.wrap(binding, snapshot, 'direct_probe', value => {record = value;});
          const assessment = await new TieredOrchestrator([evaluator], orchestratorOptions(threshold)).evaluateCase(snapshot.input, {...snapshot.policy, requirements: [req]});
          probes.push(observation(snapshot, binding, reqId, threshold, record, assessment));
        }
      }
      if (hashCanonicalJson(snapshot) !== before) throw new Error('Immutable snapshot changed during assessment');
    }
    options.onProgress?.(`Finished ${fixture.runtime.scenarioId} replicate ${replicate}/${replicates}`);
  }
  const primary = cells.filter(c => c.cohort !== 'negative_control');
  const primaryProbes = probes.filter(o => options.fixtures.find(f => f.runtime.scenarioId === snapshots.find(s => s.id === o.snapshotId)!.fixtureId)!.cohort !== 'negative_control');
  const summaries = STRATEGIES.flatMap(strategy => thresholds.map(threshold => ({strategy, threshold, ...summarizeCells(primary.filter(c => c.strategy === strategy && c.threshold === threshold))})));
  const tierSummaries = Object.values(options.bindings).filter(b => b.key !== 'frontier-baseline').flatMap(binding => thresholds.map(threshold => ({tier: binding.evaluator.tierLevel, evaluatorKey: binding.key, threshold,
    ...summarizeProbes(primaryProbes.filter(o => o.evaluatorKey === binding.key && o.threshold === threshold), store.recordings, options.fixtures, snapshots)})));
  const contrasts = [pairedContrast(primary, 'access', 'submitted_only', 'retrieval', snapshots), pairedContrast(primary, 'access', 'retrieval', 'full_corpus', snapshots),
    ...[['rules','cheap'],['cheap','tiered'],['tiered','llm']].map(([a,b]) => pairedContrast(primary, 'strategy', a,b,snapshots))];
  const strata = ['family','variant','cohort'].flatMap(dimension => [...new Set(primary.map(c => c[dimension as 'family' | 'variant' | 'cohort']))].flatMap(value => STRATEGIES.flatMap(strategy => thresholds.map(threshold => ({dimension, value, strategy, threshold, ...summarizeCells(primary.filter(c => c[dimension as 'family' | 'variant' | 'cohort'] === value && c.strategy === strategy && c.threshold === threshold))})))));
  const probeStrata = ['family','variant','cohort','access'].flatMap(dimension => {
    const group = (o: TierObservation) => {const s = snapshots.find(s => s.id === o.snapshotId)!; const f = options.fixtures.find(f => f.runtime.scenarioId === s.fixtureId)!; return dimension === 'access' ? s.access : f[dimension as 'family' | 'variant' | 'cohort'];};
    return [...new Set(primaryProbes.map(group))].flatMap(value => Object.values(options.bindings).filter(b => b.key !== 'frontier-baseline').flatMap(binding => thresholds.map(threshold => ({dimension, value, evaluatorKey: binding.key, threshold,
      ...summarizeProbes(primaryProbes.filter(o => group(o) === value && o.evaluatorKey === binding.key && o.threshold === threshold), store.recordings, options.fixtures, snapshots)}))));
  });
  const safetyFailures: Array<{kind: string; cell?: string; recordingId?: string}> = [];
  for (const cell of primary) {
    if (cell.availability !== 'available') continue;
    const id = `${cell.snapshotId}/${cell.strategy}/${cell.threshold}`;
    if (cell.score.falseClearance) safetyFailures.push({kind: 'unsupported_final_clearance', cell: id});
    if (cell.score.hiddenConflicts) safetyFailures.push({kind: 'hidden_conflict', cell: id});
    if (cell.score.unsupportedCitations) safetyFailures.push({kind: 'fabricated_or_ungrounded_citation', cell: id});
    if (cell.score.wrongPatientLeakage) safetyFailures.push({kind: 'wrong_patient_leakage', cell: id});
  }
  for (const probe of [...primaryProbes, ...primary.flatMap(c => c.observations)]) {
    const snapshot = snapshots.find(s => s.id === probe.snapshotId)!;
    const fixture = options.fixtures.find(f => f.runtime.scenarioId === snapshot.fixtureId)!;
    const flags = probeFlags(probe, store.recordings.find(r => r.id === probe.recordingId), fixture.labels[snapshot.access][probe.requirementId], snapshot);
    if (flags.unsupportedSatisfaction || flags.falseNonfulfillment) safetyFailures.push({kind: flags.unsupportedSatisfaction ? 'raw_unsupported_satisfaction' : 'raw_missing_as_nonfulfillment', recordingId: probe.recordingId ?? undefined});
  }
  return {schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), thresholds, replicates,
    matrix: {primaryFixtures: options.fixtures.filter(f => f.cohort !== 'negative_control').length, negativeControlFixtures: options.fixtures.filter(f => f.cohort === 'negative_control').length,
      expectedPrimaryCells: options.fixtures.filter(f => f.cohort !== 'negative_control').length * 3 * 4 * thresholds.length * replicates,
      emittedPrimaryCells: primary.length, measuredPrimaryCells: primary.filter(c => c.availability === 'available').length,
      scheduledProbes: primaryProbes.length, acquiredProbes: primaryProbes.filter(o => o.outcome === 'acquired').length},
    snapshots, recordings: store.recordings, cells, probes, summaries, tierSummaries, contrasts, strata, probeStrata,
    negativeControls: {cells: cells.filter(c => c.cohort === 'negative_control').map(c => ({snapshotId: c.snapshotId, strategy: c.strategy, threshold: c.threshold, score: c.score})),
      probes: probes.filter(o => !primaryProbes.includes(o))},
    acquisition: store.summary(),
    infrastructure: {matrixComplete: primary.length === options.fixtures.filter(f => f.cohort !== 'negative_control').length * 3 * 4 * thresholds.length * replicates,
      acquisitionComplete: primary.every(c => c.availability === 'available'), interrupted: options.signal?.aborted ?? false},
    empiricalSafety: {passed: safetyFailures.length === 0, failures: safetyFailures},
  };
}
export type SufficiencyReport = Awaited<ReturnType<typeof runSufficiencyExperiment>>;
