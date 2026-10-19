import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvaluationStrategy, providerOptionsFromEnv, providerSummary, ADAPTER_REVISION, StructuredLlmEvaluator, type StrategyName } from '@openpa/evaluators';
import { runExperiment, compareExperiments, type ExperimentReport } from './experiments.js';
import { loadDataset } from './dataset.js';
import { ChatGptAuth, resolveChatGptProviders } from '@openpa/evaluators/chatgpt-auth';
import { REASONING_EFFORTS, type ReasoningEffort } from '@openpa/evaluators';

const root=fileURLToPath(new URL('../../../',import.meta.url));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function main(){
  const args=process.argv.slice(2);
  const value=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
  const live=args.includes('--live');
  // Offline execution never loads saved credentials or constructs a configured provider.
  const offlineOptions=providerOptionsFromEnv({});
  const {options,status}=live
    ? await resolveChatGptProviders(new ChatGptAuth(),process.env,!args.includes('--env-provider'))
    : {options:offlineOptions,status:providerSummary(offlineOptions)};
  if(value('--frontier-model')||value('--reasoning-effort')) {
    if(!options.frontierOptions||!('provider' in options.frontierOptions)) throw new Error('Model/effort overrides require the ChatGPT plan provider');
    const effort=value('--reasoning-effort');
    if(effort&&!REASONING_EFFORTS.includes(effort as ReasoningEffort)) throw new Error('Invalid reasoning effort');
    options.frontierOptions={...options.frontierOptions,model:value('--frontier-model')??options.frontierOptions.model,reasoningEffort:(effort??options.frontierOptions.reasoningEffort) as ReasoningEffort | undefined};
  }
  const providers=providerSummary(options,status.frontier.configured && status.frontier.provider==='chatgpt-plan');
  const dataset=loadDataset(root);
  const thresholds=(value('--thresholds')??'0.7,0.9,0.99').split(',').map(Number);
  const selected=(value('--arms')??'rules,cheap,tiered,llm').split(',');
  if(!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!['rules','cheap','tiered','llm'].includes(id))) throw new Error('Choose unique --arms from rules,cheap,tiered,llm');
  const arms=([
    ['rules','Rules only',true],['cheap','Rules → Jev',providers.jev.configured],
    ['tiered','Rules → Jev → small → frontier',providers.jev.configured&&providers.small.configured&&providers.frontier.configured],
    ['llm','Frontier generative baseline',providers.frontier.configured],
  ] as const).filter(([id])=>selected.includes(id)).map(([id,label,configured])=>{
    const evaluators=createEvaluationStrategy(id as StrategyName,options);
    if(id==='tiered' && !evaluators.some(e=>e.tierLevel===4)) evaluators.push(new StructuredLlmEvaluator({tierLevel:4}));
    return {id,label,configured,evaluators};
  });
  if(live && arms.some(a=>!a.configured)) throw new Error('Configure the providers required by the selected arms, or use --arms rules,llm for a frontier-only comparison.');
  const protocol={revision:ADAPTER_REVISION,counterfactualRevision:'evidence-removal-v1',thresholds,arms:selected,billingProvider:providers.frontier.provider,caseBudget:options.budgetCapUsd,tokenBudget:options.orchestratorOptions?.maxTokensPerRun,timeoutMs:options.orchestratorOptions?.timeoutMs,maxCalls:Number(value('--max-calls')??'200'),maxAcquisitionTokens:Number(value('--max-tokens')??'1000000'),cohorts:dataset.manifest.version};
  const result=await runExperiment(dataset.cases,dataset.policies,arms,{thresholds,budgetCapUsd:options.budgetCapUsd,maxTokensPerRun:options.orchestratorOptions?.maxTokensPerRun,timeoutMs:protocol.timeoutMs,maxAcquisitionCostUsd:Number(value('--max-spend')??'2'),maxProviderCalls:protocol.maxCalls,maxAcquisitionTokens:protocol.maxAcquisitionTokens});
  const sourceFiles=['core','evaluators','eval-suite'].flatMap(pkg=>readdirSync(join(root,`packages/${pkg}/src`),{recursive:true}).filter(f=>typeof f==='string'&&f.endsWith('.ts')).map(f=>`packages/${pkg}/src/${f}`)).sort();
  const configuration=Object.fromEntries(['jevOptions','llmOptions','frontierOptions'].map(key=>{
    const setting=options[key as 'jevOptions'|'llmOptions'|'frontierOptions'];
    return [key,setting?('provider' in setting ? {provider:setting.provider,model:setting.model,reasoningEffort:setting.reasoningEffort,maxInputTokens:setting.maxInputTokens,maxOutputTokens:setting.maxOutputTokens} : {model:setting.model,inputPricePerMillion:setting.inputPricePerMillion,outputPricePerMillion:setting.outputPricePerMillion,maxInputTokens:setting.maxInputTokens,maxOutputTokens:setting.maxOutputTokens}):null];
  }));
  const report={...result,datasetHash:hash(dataset),protocolHash:hash(protocol),protocol,providers,configuration,runMode:live?'live':'offline',revision:execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),adapterHash:hash(sourceFiles.map(path=>[path,readFileSync(join(root,path),'utf8')]))};
  const output=value('--output')??join(root,live?'results/experiment-report.json':'results/offline-experiment.json');
  mkdirSync(dirname(output),{recursive:true});
  const artifact=args.includes('--summary')?{...report,recordings:[],runs:report.runs.map(({cases,...run})=>({...run,cases:[]}))}:report;
  writeFileSync(output,JSON.stringify(artifact,null,2)+'\n');
  console.table(report.runs.map(r=>({strategy:r.label,threshold:r.threshold,configured:r.configured,safeCoverage:r.summary.safeResolutionCoverage,risk:r.summary.selectiveRisk,abstentions:r.summary.abstentionRate,cost:r.summary.totalCostUsd})));
  console.table(report.runs.flatMap(r=>r.uncertaintyByTier.map(t=>({strategy:r.label,tier:t.tierLevel,threshold:r.threshold,configured:t.configured,applicable:t.summary?.applicableRuns??null,uncertaintyPreserved:t.summary?.uncertaintyPreserved??null,ci95:t.summary?.uncertaintyPreserved95Ci??null,confidentNotMet:t.summary?.confidentNotMet??null,confidentSatisfied:t.summary?.confidentSatisfied??null}))));
  console.log(`Saved ${output}. Actual acquisition: ${report.acquisition.providerCalls} calls, $${report.acquisition.costUsd??'unknown'}.`);
  const baseline=value('--baseline');
  if(baseline){
    const gate=compareExperiments(JSON.parse(readFileSync(baseline,'utf8')) as ExperimentReport & {datasetHash:string;protocolHash:string},report);
    console.log(JSON.stringify(gate,null,2));if(!gate.passed) process.exitCode=1;
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Experiment failed');process.exitCode=1;});
