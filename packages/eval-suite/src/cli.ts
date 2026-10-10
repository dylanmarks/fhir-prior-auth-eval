import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MedicalPolicySchema, PriorAuthCaseSchema } from '@openpa/core';
import { createEvaluationOrchestrator } from '@openpa/evaluators';
import { BenchmarkHarness } from './runner/harness.js';
import { CounterfactualSensitivityTester } from './mutations/sensitivity.js';
import { MarkdownReporter } from './reporters/markdown-reporter.js';
import { CiEvalGate } from './ci-gate.js';

async function main() {
  console.log('\n======================================================');
  console.log('   FHIR Prior Auth Eval — Benchmark & Mutation Suite  ');
  console.log('======================================================\n');

  // Resolve directory relative to file location
  const currentFile = fileURLToPath(import.meta.url);
  const rootDir = join(currentFile, '../../../..');
  const policiesDir = join(rootDir, 'datasets/policies');
  const casesDir = join(rootDir, 'datasets/cases');
  const resultsDir = join(rootDir, 'results');

  // Load policies
  const policyFiles = readdirSync(policiesDir).filter(f => f.endsWith('.json'));
  const policies = policyFiles.map(f => {
    const content = JSON.parse(readFileSync(join(policiesDir, f), 'utf-8'));
    return MedicalPolicySchema.parse(content);
  });
  console.log(`Loaded ${policies.length} medical coverage policies.`);

  // Load cases
  const caseFiles = readdirSync(casesDir).filter(f => f.endsWith('.json'));
  const cases = caseFiles.map(f => {
    const content = JSON.parse(readFileSync(join(casesDir, f), 'utf-8'));
    return PriorAuthCaseSchema.parse(content);
  });
  console.log(`Loaded ${cases.length} synthetic prior authorization benchmark cases.\n`);

  console.log('Executing evaluation cascade across cases...\n');
  const orchestrator = createEvaluationOrchestrator('rules');
  const harness = new BenchmarkHarness({ orchestrator });
  const results = await harness.runBenchmark(cases, policies);

  console.log('------------------------------------------------------');
  console.log('                    RESULTS SUMMARY                   ');
  console.log('------------------------------------------------------');
  console.table(
    results.caseScores.map(c => ({
      Case: c.caseId,
      Expected: c.expectedDisposition,
      Predicted: c.predictedDisposition,
      Match: c.dispositionMatch ? 'PASS' : 'FAIL',
      ReqAccuracy: `${(c.requirementAccuracy * 100).toFixed(0)}%`,
      Grounding: `${(c.groundingPrecision * 100).toFixed(0)}%`,
      Unsupported: c.unsupportedCitations,
      Cost: `$${c.costUsd.toFixed(4)}`,
      Latency: `${c.latencyMs}ms`,
    }))
  );

  console.log('\nRunning counterfactual mutation sensitivity suite...');
  const sensitivityTester = new CounterfactualSensitivityTester(orchestrator);
  const sensitivity = await sensitivityTester.runSensitivitySuite(cases, policies);

  console.log('\nCOUNTERFACTUAL MUTATION METRICS:');
  console.log(`- Applicable Mutations Evaluated:  ${sensitivity.totalMutationsEvaluated}`);
  console.log(`- Correctly Flipped:               ${sensitivity.totalCorrectlyFlipped}`);
  console.log(`- Skipped (Baseline Deficient):     ${sensitivity.totalSkippedBaselineDeficient}`);
  console.log(`- Skipped (Inapplicable/No-Op):     ${sensitivity.totalSkippedInapplicable}`);
  console.log(`- Counterfactual Sensitivity:       ${(sensitivity.counterfactualSensitivity * 100).toFixed(1)}%\n`);

  console.log('AGGREGATE BENCHMARK METRICS:');
  console.log(`- Disposition Accuracy:            ${(results.dispositionAccuracy * 100).toFixed(1)}%`);
  console.log(`- Mean Requirement Accuracy:       ${(results.meanRequirementAccuracy * 100).toFixed(1)}%`);
  console.log(`- Balanced Requirement Accuracy:   ${(results.meanRequirementBalancedAccuracy * 100).toFixed(1)}%`);
  console.log(`- Macro Requirement F1:            ${(results.meanRequirementMacroF1 * 100).toFixed(1)}%`);
  console.log(`- Mean Grounding Precision:        ${(results.meanGroundingPrecision * 100).toFixed(1)}%`);
  console.log(`- Total Unsupported Citations:     ${results.totalUnsupportedCitations}`);
  console.log(`- Missing Evidence Recall:         ${(results.missingEvidenceRecall * 100).toFixed(1)}%`);
  console.log(`- Total Inference Cost:            $${results.totalCostUsd.toFixed(4)} USD`);
  console.log(
    `- Cost per Safe Resolution:        ${
      results.costPerSafeResolution != null ? `$${results.costPerSafeResolution.toFixed(4)} USD` : 'N/A'
    }`
  );
  console.log(`- Mean Latency per Case:           ${results.meanLatencyMs} ms\n`);

  // Save Markdown & JSON reports
  mkdirSync(resultsDir, { recursive: true });
  const reportMd = MarkdownReporter.generateReport(results, sensitivity, {
    datasetVersion: 'openpa-benchmark-v1.0',
    runMode: 'offline_deterministic',
    strategyName: 'Deterministic Rules Engine (Tier 1)',
  });
  const mdPath = join(resultsDir, 'benchmark-report.md');
  writeFileSync(mdPath, reportMd, 'utf-8');
  console.log(`Saved Markdown report to: ${mdPath}`);

  const jsonReport = {
    timestamp: new Date().toISOString(),
    datasetVersion: 'openpa-benchmark-v1.0',
    runMode: 'offline_deterministic',
    strategy: 'rules-engine-v1',
    aggregate: results,
    sensitivity,
  };
  const jsonPath = join(resultsDir, 'benchmark-report.json');
  writeFileSync(jsonPath, JSON.stringify(jsonReport, null, 2), 'utf-8');
  console.log(`Saved JSON report to:     ${jsonPath}`);

  // CI Evaluation Gate Check
  const gateResult = CiEvalGate.verifyGate(results, sensitivity);
  if (!gateResult.passed) {
    console.error('\n❌ CI EVALUATION GATE FAILED:');
    gateResult.failures.forEach(f => console.error(`  - ${f}`));
    process.exit(1);
  } else {
    console.log('\n✅ CI Evaluation Gate Passed with zero regressions.\n');
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
