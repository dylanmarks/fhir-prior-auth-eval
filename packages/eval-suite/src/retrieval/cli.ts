import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCanonicalJson } from '@openpa/core';
import { loadRetrievalCohort } from './loader.js';
import { runRetrievalExperiment } from './runner.js';

if (process.argv.length > 2) throw new Error('This deterministic offline runner accepts no live/provider flags.');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const cohort = loadRetrievalCohort(root);
const experiment = await runRetrievalExperiment(cohort);
const files = [
  'packages/core/src/domain/retrieval.ts', 'packages/core/src/domain/handoff.ts', 'packages/core/src/domain/hash.ts',
  'packages/evaluators/src/retrieval/source.ts', 'packages/evaluators/src/retrieval/retriever.ts',
  'packages/evaluators/src/workflow/workflow-runner.ts', 'packages/evaluators/src/handoff/build-review-packet.ts',
  'packages/evaluators/src/deterministic/rules-evaluator.ts', 'packages/evaluators/src/tiered/tiered-orchestrator.ts',
  'packages/eval-suite/src/retrieval/scorer.ts', 'packages/eval-suite/src/retrieval/types.ts', 'packages/eval-suite/src/retrieval/runner.ts',
  'packages/eval-suite/src/retrieval/loader.ts', 'packages/eval-suite/src/retrieval/cli.ts',
];
const fingerprints = {
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  workingTreeDirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim().length > 0,
  implementation: hashCanonicalJson(Object.fromEntries(files.map(path => [path, readFileSync(join(root, path), 'utf8')]))),
  publicInputs: hashCanonicalJson(cohort.cases), gold: hashCanonicalJson(cohort.goldSidecars),
  policies: hashCanonicalJson(cohort.policies), dependencies: hashCanonicalJson(readFileSync(join(root, 'package-lock.json'), 'utf8')),
  protocol: hashCanonicalJson(readFileSync(join(root, 'roadmap/phase-6-retrieval-and-handoff.md'), 'utf8')),
  assessment: 'fixed-rules-only', packetSchema: '1.0.0',
};
const report = {
  schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), synthetic: true,
  limitations: [
    'Twelve authored paired regression fixtures across two families; labels are author-only. No clinical validation or reviewer-time measurement.',
    'Local simulated sources only. The full-corpus arm uses harness assembly, bypassing retrieval limits but retaining availability and identity checks.',
    'The fixed lumbar policy has no lookback/episode rule. Historical matching therapy is retained and can inflate reported elapsed duration; elapsed span does not establish continuous therapy.',
    'Partial lumbar therapy without completion/adherence documentation remains uncertain and routes to clinical review under the fixed orchestrator.',
  ],
  fingerprints,
  contentFingerprint: hashCanonicalJson({fingerprints, scores: experiment.runs.map(r => ({...r.score, effort: undefined})), packets: experiment.runs.map(r => r.result.reviewPacket.contentFingerprint)}),
  ...experiment,
};
const out = join(root, 'results/retrieval');
mkdirSync(out, {recursive: true});
writeFileSync(join(out, 'offline-report.json'), JSON.stringify(report, null, 2) + '\n');
const workbenchReport = {...report, runs: report.runs.map(({arm, score, evidenceFingerprint}) => ({arm, score, evidenceFingerprint}))};
writeFileSync(join(out, 'workbench-report.json'), JSON.stringify(workbenchReport, null, 2) + '\n');
const lines = ['# Evidence retrieval and review handoff', '', 'Synthetic authored regression benchmark. Three arms share the same fixed rules assessor.', '',
  '| Arm | Expected workflow outcomes | End-to-end packet checks | Critical omissions | Unsupported claims |',
  '| --- | ---: | ---: | ---: | ---: |',
  ...report.aggregates.map(a => `| ${a.arm} | ${Math.round(a.dispositionAccuracy * a.caseCount)}/${a.caseCount} | ${Math.round(a.endToEndCorrectnessRate * a.caseCount)}/${a.caseCount} | ${a.totalCriticalOmissions} | ${a.totalUnsupportedDefinitiveClaims} |`), '',
  '| Fixture | Arm | Workflow | Packet gate |', '| --- | --- | --- | --- |',
  ...report.runs.map(r => `| ${r.score.scenarioId} · ${r.score.family} · ${r.score.variant} | ${r.arm} | ${r.result.workflowDisposition} | ${r.score.endToEndPassed ? 'PASS' : 'FAIL'} |`), '',
  ...report.limitations.map(l => `- ${l}`), '', `Source revision: ${fingerprints.sourceRevision}; dirty: ${fingerprints.workingTreeDirty}.`, `Implementation fingerprint: ${fingerprints.implementation}.`,
];
writeFileSync(join(out, 'offline-report.md'), lines.join('\n') + '\n');
console.log(lines.slice(0, 10).join('\n'));
console.log(`Report: ${out}/offline-report.json`);
if (!experiment.passed) process.exitCode = 1;
