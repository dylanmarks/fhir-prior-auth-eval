import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashCanonicalJson } from '@openpa/core';
import { providerOptionsFromEnv, providerSummary } from '@openpa/evaluators';
import { ChatGptAuth, resolveChatGptProviders } from '@openpa/evaluators/chatgpt-auth';
import { loadSufficiencyDataset } from './dataset.js';
import { createBindings } from './providers.js';
import { runSufficiencyExperiment } from './runner.js';
import { makeSufficiencyView } from './view.js';

export function parseArguments(args: string[], root: string) {
  const values: Record<string, string> = {};
  let live = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--live') {if (live) throw new Error('Duplicate --live'); live = true; continue;}
    if (!['--max-spend','--replicates','--output','--max-calls','--max-tokens'].includes(args[i]) || values[args[i]] !== undefined || !args[i+1] || args[i+1].startsWith('--')) throw new Error('Unknown, duplicate, or incomplete argument');
    values[args[i]] = args[++i];
  }
  if (live && values['--max-spend'] === undefined) throw new Error('Live execution requires explicit --max-spend before provider setup or dispatch');
  const maxSpend = Number(values['--max-spend'] ?? 0), replicates = Number(values['--replicates'] ?? 1), maxCalls = Number(values['--max-calls'] ?? 500), maxTokens = Number(values['--max-tokens'] ?? 2000000);
  if (!Number.isFinite(maxSpend) || maxSpend < 0 || [replicates,maxCalls,maxTokens].some(n => !Number.isInteger(n) || n <= 0)) throw new Error('Invalid acquisition limits');
  const directory = resolve(root, 'results/evidence-sufficiency');
  const output = resolve(root, values['--output'] ?? `results/evidence-sufficiency/${live ? 'live' : 'offline'}-report.json`);
  if (!output.startsWith(directory + '/') || !output.endsWith('.json')) throw new Error('Output must be a JSON file under results/evidence-sufficiency/');
  return {live, maxSpend, replicates, maxCalls, maxTokens, output};
}

export async function main(args = process.argv.slice(2)) {
  const root = fileURLToPath(new URL('../../../../', import.meta.url));
  const flags = parseArguments(args, root);
  const dataset = loadSufficiencyDataset(root);
  const optionsAndStatus = flags.live ? await resolveChatGptProviders(new ChatGptAuth(), process.env, true) : (() => {const options = providerOptionsFromEnv({}); return {options, status: providerSummary(options)};})();
  const {options, status} = optionsAndStatus;
  const {bindings, strategyBindings, configuration} = createBindings(options, {jev: status.jev.configured, small: status.small.configured, frontier: status.frontier.configured});
  if (flags.live && ![status.jev.configured,status.small.configured,status.frontier.configured].some(Boolean)) throw new Error('No configured live providers; use offline mode or configure existing providers explicitly');
  const sourceFiles = ['core','evaluators','eval-suite'].flatMap(pkg => readdirSync(join(root, `packages/${pkg}/src`), {recursive: true}).filter((file): file is string => typeof file === 'string' && file.endsWith('.ts')).map(file => `packages/${pkg}/src/${file}`)).sort();
  const implementationHash = hashCanonicalJson(sourceFiles.map(file => [file, readFileSync(join(root,file), 'utf8')]));
  const protocol = {version: 'evidence-sufficiency-v1', thresholds: [.7,.9,.99], rulesThreshold: .9, access: ['submitted_only','retrieval','full_corpus'], strategies: ['rules','cheap','tiered','llm'],
    replicates: flags.replicates, caseBudget: options.budgetCapUsd ?? .1, caseTokens: options.orchestratorOptions?.maxTokensPerRun ?? 100000, timeoutMs: options.orchestratorOptions?.timeoutMs ?? 30000,
    maxSpend: flags.maxSpend, maxCalls: flags.maxCalls, maxTokens: flags.maxTokens, providerScopeFields: [], cohortPlan: 'PT progress development; lumbar therapy challenge; inherited fixtures regression; numeric control separate'};
  const fingerprints = {sourceRevision: execFileSync('git', ['rev-parse','HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    workingTreeDirty: !!execFileSync('git', ['status','--porcelain'], {cwd: root, encoding: 'utf8'}).trim(), implementation: implementationHash,
    dependencies: hashCanonicalJson(readFileSync(join(root,'package-lock.json'),'utf8')), manifest: hashCanonicalJson(dataset.manifest),
    publicInputs: hashCanonicalJson(dataset.fixtures.map(f => ({runtime:f.runtime,policy:f.policy}))), gold: hashCanonicalJson(dataset.fixtures.map(f => ({labels:f.labels,targets:f.targetRequirementIds}))),
    protocol: hashCanonicalJson(protocol), protocolDocument: hashCanonicalJson(readFileSync(join(root,'docs/PHASE_7_PROTOCOL.md'),'utf8')), providers: hashCanonicalJson(configuration), phase6: {revision: dataset.manifest.phase6Revision, inputs: dataset.manifest.phase6InputsHash, gold: dataset.manifest.phase6GoldHash}};
  const controller = new AbortController(); const interrupt = () => {controller.abort();};
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  let result;
  try {result = await runSufficiencyExperiment({fixtures: dataset.fixtures, bindings, strategyBindings, thresholds: protocol.thresholds, replicates: flags.replicates,
    maxSpend: flags.maxSpend, maxCalls: flags.maxCalls, maxTokens: flags.maxTokens, timeoutMs: protocol.timeoutMs, caseBudget: protocol.caseBudget, caseTokens: protocol.caseTokens,
    implementationHash, signal: controller.signal});}
  finally {process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);}
  const report = {...result, runMode: flags.live ? 'live' : 'offline', synthetic: true, protocol, fingerprints, configuration,
    limitations: ['Twenty authored correlated fixtures and one separate numeric control; all labels author-only. No population confidence intervals.',
      'Offline reports measure rules/retrieval infrastructure. Unconfigured or failed model cells are unmeasured, not successful abstention.',
      'Provider-visible scope fields remain unchanged (none); models see the existing clinical projection. Model-directed retrieval and policy-version selection are excluded.',
      'Existing lumbar rules can aggregate historical therapy and cannot interpret several narratives. Those errors and abstentions are retained.',
      'No clinical validation, external data, or reviewer-effort study has been conducted.'],
    contentFingerprint: hashCanonicalJson({fingerprints, matrix: result.matrix, scores: result.cells.map(c => ({snapshotId:c.snapshotId,strategy:c.strategy,threshold:c.threshold,score:c.score})), observations: result.recordings.map(r => ({key:r.key,outcome:r.outcome,result:r.result ? {...r.result,metrics:undefined} : undefined}))})};
  mkdirSync(dirname(flags.output), {recursive: true});
  writeFileSync(flags.output, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(flags.output.replace(/\.json$/, '.view.json'), JSON.stringify(makeSufficiencyView(report), null, 2) + '\n');
  const markdown = ['# Evidence sufficiency across the model ladder', '', `Mode: ${report.runMode}. ${report.matrix.emittedPrimaryCells}/${report.matrix.expectedPrimaryCells} primary cells emitted; ${report.matrix.measuredPrimaryCells} fully measured.`, '',
    '| Strategy | Threshold | Measured / scheduled | Safe resolutions | Unsafe / resolved |', '| --- | ---: | ---: | ---: | ---: |',
    ...report.summaries.map(s => `| ${s.strategy} | ${s.threshold} | ${s.measured}/${s.scheduled} | ${s.safeResolutionCoverage.numerator}/${s.safeResolutionCoverage.denominator} | ${s.selectiveRisk.numerator}/${s.selectiveRisk.denominator} |`), '',
    `Unique provider adapter acquisitions: ${report.acquisition.adapterAcquisitions}. Known spend: $${report.acquisition.knownCostUsd}; verified spend: ${report.acquisition.costUsd === null ? 'unknown' : '$'+report.acquisition.costUsd}.`,
    `Empirical safety flags: ${report.empiricalSafety.failures.length}. Poor measured performance is retained; infrastructure completion does not mean empirical safety.`, '',
    ...report.limitations.map(l => `- ${l}`), '', `Source revision: ${fingerprints.sourceRevision}; dirty: ${fingerprints.workingTreeDirty}.`, `Implementation: ${implementationHash}.`];
  writeFileSync(flags.output.replace(/\.json$/, '.md'), markdown.join('\n') + '\n');
  console.log(markdown.join('\n'));
  console.log(`Saved ${flags.output}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(Live execution|Output must|Invalid acquisition|Unknown, duplicate|Duplicate --live|No configured live providers|Expected twenty|Dataset manifest|Phase 6 dependency)/.test(message)
    ? message : 'Sufficiency experiment failed. Check dataset fingerprints, arguments, provider configuration, and local diagnostics.');
  process.exitCode = 1;
});
