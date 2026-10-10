import { useState } from 'react';
import snapshot from '../../../datasets/offline-experiment.json';

type Report = Omit<typeof snapshot, 'configuration'> & {configuration?: {frontierOptions?: {model?: string; reasoningEffort?: string; provider?: string} | null}};
const percent=(v:number|null)=>v==null?'—':`${(v*100).toFixed(1)}%`;
const cost=(v:number|null)=>v==null?'Unknown':`$${v.toFixed(5)}`;

export function ResearchPanel(){
  const [report,setReport]=useState<Report>(snapshot);
  const [threshold,setThreshold]=useState(.9);
  const [cohort,setCohort]=useState<'all'|'structured'|'development'|'challenge'>('all');
  const [message,setMessage]=useState('');
  const runs=report.runs.filter(r=>r.threshold===threshold);
  const metrics=(r:typeof runs[number])=>cohort==='all'?r.summary:r.cohorts[cohort];
  const load=async()=>{
    try{const response=await fetch('/api/experiment');if(!response.ok)throw new Error();const next=await response.json();if(next.schemaVersion!==1||!Array.isArray(next.runs))throw new Error();setReport(next);setThreshold(next.protocol.thresholds[0]);setMessage('Loaded latest saved experiment.');}
    catch{setMessage('Start the evaluator server and run an experiment to load a new report. The bundled offline report remains available.');}
  };
  return <main className="max-w-7xl w-full mx-auto p-6 space-y-6">
    <section className="rounded-xl border border-indigo-800 bg-indigo-950/30 p-6 space-y-3">
      <p className="text-xs uppercase tracking-wider text-indigo-300">Research question</p>
      <h2 className="text-2xl font-semibold">How much evidence checking can a cheap model safely resolve?</h2>
      <p className="text-slate-300 max-w-4xl">Compare rules, Jev, and a generative cascade on the same records. Raise the routing threshold to trade coverage for more review. Measure confidently wrong resolutions as well as cost savings.</p>
      <p className="text-sm text-amber-200">{report.runMode==='offline'?'Offline baseline: no live model judgments or costs have been measured. Configure providers to test the hypothesis.':'Live provider experiment. These synthetic results do not establish clinical reliability.'}</p>
      {report.configuration?.frontierOptions?.model && <p className="text-sm text-indigo-200">Recorded frontier: {report.configuration.frontierOptions.model} · {report.configuration.frontierOptions.reasoningEffort ?? 'default'} reasoning · {report.configuration.frontierOptions.provider ?? 'API provider'}</p>}
    </section>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-5">
      <div className="flex flex-wrap items-end gap-5">
        <label className="text-sm flex flex-col gap-2">Routing threshold<select value={threshold} onChange={e=>setThreshold(Number(e.target.value))} className="bg-slate-800 border border-slate-600 rounded p-2">{report.protocol.thresholds.map(t=><option key={t} value={t}>{percent(t)}</option>)}</select></label>
        <label className="text-sm flex flex-col gap-2">Evaluation cohort<select value={cohort} onChange={e=>setCohort(e.target.value as typeof cohort)} className="bg-slate-800 border border-slate-600 rounded p-2"><option value="all">All 22 synthetic cases</option><option value="structured">Structured baseline — 10 cases</option><option value="development">Narrative development — 4 cases</option><option value="challenge">Narrative challenge — 8 cases</option></select></label>
        <button onClick={load} className="rounded border border-slate-500 px-4 py-2 text-sm">Load latest experiment</button>
        <span className="text-xs text-slate-400">Saved {new Date(report.timestamp).toLocaleString()}</span>
      </div>
      <p role="status" className="text-sm text-slate-300">{message}</p>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="text-left text-slate-400 pb-3">Paired strategies at the same threshold. Costs are replayed policy costs; actual acquisition spend is shown below.</caption><thead className="text-slate-300"><tr>{['Strategy','Provider state','Safe coverage','Risk among resolutions','Abstentions','False clearances','Cost / safe resolution'].map(h=><th className="p-3 border-b border-slate-600" key={h} scope="col">{h}</th>)}</tr></thead><tbody>{runs.map(r=>{const m=metrics(r);return <tr key={r.armId}><th scope="row" className="p-3 font-medium">{r.label}</th><td className="p-3">{r.configured?'Available':'Unconfigured'}</td><td className="p-3 text-emerald-300">{percent(m.safeResolutionCoverage)}</td><td className="p-3">{percent(m.selectiveRisk)}</td><td className="p-3">{percent(m.abstentionRate)}</td><td className="p-3">{m.falseClearances}</td><td className="p-3">{m.costPerSafeResolution==null?'—':cost(m.costPerSafeResolution)}</td></tr>;})}</tbody></table></div>
      <p className="text-sm text-slate-400">Actual acquisition: {report.acquisition.providerCalls} provider calls; {cost(report.acquisition.costUsd)} dollar cost. ChatGPT plan usage is tracked in tokens; it is excluded from dollar-cost claims. Judgments are reused across threshold policies; a replay is not a new model call.</p>
    </section>
    <div className="grid lg:grid-cols-2 gap-6">
      <section className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-3"><h3 className="font-semibold">Resolution by tier</h3>{runs.map(r=>{const m=metrics(r);return <div key={r.armId} className="border-b border-slate-700 pb-3"><p className="text-sm mb-2">{r.label}</p><div className="flex flex-wrap gap-3">{Object.entries(m.tierStats).map(([tier,s])=><span key={tier} className="text-xs bg-slate-800 rounded p-2">Tier {tier}: {s.acceptedRequirements} accepted / {s.calls} steps · {'costVerified' in s && s.costVerified === false ? 'Plan / credits · dollar cost unknown' : cost(s.costUsd)}</span>)}</div></div>;})}</section>
      <section className="bg-slate-900 border border-slate-700 rounded-xl p-5 space-y-3"><h3 className="font-semibold">What would make this viable?</h3><ul className="text-sm text-slate-300 list-disc pl-5 space-y-2"><li>More safe resolutions than rules alone, with low risk on unseen narrative cases.</li><li>Lower cost per safe resolution than the frontier baseline.</li><li>Stable results across model upgrades, case cohorts, and confidence thresholds.</li><li>Enough reviewed cases to narrow uncertainty. Zero errors in a tiny sample is weak evidence.</li></ul><p className="text-sm text-amber-200">Provider confidence and LLM self-reported confidence are routing signals. Clinical calibration must be measured separately.</p></section>
    </div>
    <details className="border border-slate-700 rounded-xl p-5"><summary className="cursor-pointer font-semibold">Reproducibility and interpretation</summary><div className="space-y-3 mt-4 text-sm text-slate-300"><p>{report.methodology}</p><p>Development cases support prompt and threshold selection. Freeze that choice before evaluating the challenge cohort. Labels are hand-authored and have not received independent clinical review.</p><p className="break-all font-mono text-xs">Dataset SHA-256: {report.datasetHash}<br/>Protocol SHA-256: {report.protocolHash}<br/>Adapter SHA-256: {report.adapterHash}</p>{runs.map(r=>{const m=metrics(r);return <p key={r.armId}>{r.label}: risk 95% interval {m.selectiveRisk95Ci?`${percent(m.selectiveRisk95Ci[0])}–${percent(m.selectiveRisk95Ci[1])}`:'undefined (no resolutions)'}; adapter latency p50 / p95 {m.p50AdapterLatencyMs??'—'} / {m.p95AdapterLatencyMs??'—'} ms.</p>;})}</div></details>
  </main>;
}
