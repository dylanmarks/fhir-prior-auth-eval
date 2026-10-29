import { useEffect, useState, type ChangeEvent } from 'react';
import { EvidenceWorkflowResultSchema, FhirBundleIndexer } from '@openpa/core';
import type { Strategy } from '../../../packages/eval-suite/src/evidence-sufficiency/types';
import { validateSufficiencyView, type SufficiencyViewReport } from '../../../packages/eval-suite/src/evidence-sufficiency/view';
import fallbackUrl from '../../../datasets/evidence-sufficiency/offline-report.view.json?url';
import { ReviewPacketPanel } from './ReviewPacketPanel';
import { RetrievalTracePanel } from './RetrievalTracePanel';

const generated = import.meta.glob('../../../results/evidence-sufficiency/offline-report.view.json', {eager:true,query:'?url',import:'default'});
const strategyLabels: Record<Strategy,string> = {rules:'Rules',cheap:'Rules → Jev',tiered:'Full cascade',llm:'Frontier baseline'};
const accessLabels = {submitted_only:'Submitted records',retrieval:'Bounded retrieval',full_corpus:'Accessible corpus reference'};
const ratio = (f: {numerator:number;denominator:number;rate:number|null}) => f.rate === null ? 'Unmeasured' : `${f.numerator}/${f.denominator} (${(f.rate*100).toFixed(1)}%)`;

export function SufficiencyPanel() {
  const [report,setReport] = useState<SufficiencyViewReport|null>(null);
  const [error,setError] = useState('');
  useEffect(()=>{const controller=new AbortController();fetch((Object.values(generated)[0]??fallbackUrl) as string,{signal:controller.signal}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then(value=>setReport(validateSufficiencyView(value))).catch(()=>{if(!controller.signal.aborted)setError('Saved report could not be loaded. Run the offline sufficiency experiment and rebuild the workbench.');});return()=>controller.abort();},[]);
  return report?<SufficiencyReportView initialReport={report}/>:<p role="status" className="p-6">{error||'Loading saved sufficiency report…'}</p>;
}

export function SufficiencyReportView({initialReport}: {initialReport:SufficiencyViewReport}) {
  const [report,setReport] = useState(initialReport);
  const [source,setSource] = useState(Object.keys(generated).length ? 'Generated local report' : 'Bundled offline snapshot');
  const [threshold,setThreshold] = useState(report.thresholds.includes(.9)?.9:report.thresholds[0]);
  const [fixtureId,setFixtureId] = useState(report.cells.some(c=>c.fixtureId==='scn-802')?'scn-802':report.cells[0].fixtureId);
  const [access,setAccess] = useState<'submitted_only'|'retrieval'|'full_corpus'>('retrieval');
  const [strategy,setStrategy] = useState<Strategy>('rules');
  const [tier,setTier] = useState('jev');
  const [replicate,setReplicate] = useState(1);
  const [message,setMessage] = useState('');
  const fixtures = [...new Map(report.cells.map(c => [c.fixtureId,{id:c.fixtureId,family:c.family,variant:c.variant,cohort:c.cohort}])).values()];
  const snapshot = report.snapshots.find(s => s.fixtureId === fixtureId && s.access === access && s.replicate === replicate);
  const cells = report.cells.filter(c => c.snapshotId === snapshot?.id && c.threshold === threshold);
  const selected = cells.find(c => c.strategy === strategy);
  const result = selected ? report.results[selected.resultRef] : undefined;
  const probes = report.probes.filter(p => p.snapshotId === snapshot?.id && p.evaluatorKey === tier && p.threshold === threshold);
  const load = async (event: ChangeEvent<HTMLInputElement>) => {
    try {
      const file = event.target.files?.[0]; if (!file) return;
      const next = validateSufficiencyView(JSON.parse(await file.text()));
      setReport(next);setSource('Selected local saved report');setFixtureId(next.cells[0].fixtureId);setThreshold(next.thresholds[0]);setReplicate(next.snapshots[0].replicate);setMessage('Loaded saved report locally.');
    } catch {setMessage('Could not load this view report. Select a generated .view.json file with valid result references.');}
  };
  const exportSnapshot = () => {
    if (!result) return;
    const validated = EvidenceWorkflowResultSchema.parse(result);
    const url = URL.createObjectURL(new Blob([JSON.stringify(validated,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`${fixtureId}-${access}-${strategy}-workflow.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage('Selected synthetic workflow exported without scoring labels or provider configuration.');
  };
  return <main className="max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6">
    <section className="border border-indigo-800 bg-indigo-950/30 rounded-xl p-6 space-y-3">
      <p className="text-xs uppercase tracking-wider text-indigo-300">Evidence sufficiency · saved experiment</p><h2 className="text-2xl font-semibold">What can each tier establish from the same records?</h2>
      <p className="text-slate-300">Compare evidence access, raw tier judgments, guard decisions, and the final review packet. Models see a fixed snapshot; they do not search for records.</p>
      <p className="text-sm text-amber-200">Synthetic authored regression study · {report.runMode} · {source}. {report.matrix.emittedPrimaryCells}/{report.matrix.expectedPrimaryCells} primary cells emitted; {report.matrix.measuredPrimaryCells} fully measured. Unconfigured models have no measured performance.</p>
      {report.testOnly && <p role="alert" className="bg-amber-950 border border-amber-400 p-3 font-bold text-amber-200">TEST ONLY — injected evaluator responses for interface verification. These are not model benchmark results.</p>}
      <p className="text-sm text-slate-400">{report.acquisition.adapterAcquisitions} unique provider adapter acquisitions · known spend ${report.acquisition.knownCostUsd.toFixed(5)} · verified spend {report.acquisition.costUsd === null ? 'unknown' : `$${report.acquisition.costUsd.toFixed(5)}`} · {report.empiricalSafety.failures.length} empirical safety flags. Threshold replay is not a fresh acquisition.</p>
    </section>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-2 text-sm">Fixture<select value={fixtureId} onChange={e=>setFixtureId(e.target.value)} className="bg-slate-800 rounded border border-slate-600 p-2">{fixtures.map(f=><option value={f.id} key={f.id}>{f.id} · {f.family} · {f.variant} · {f.cohort}</option>)}</select></label>
        <label className="flex flex-col gap-2 text-sm">Model confidence threshold<select value={threshold} onChange={e=>setThreshold(Number(e.target.value))} className="bg-slate-800 rounded border border-slate-600 p-2">{report.thresholds.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
        <label className="flex flex-col gap-2 text-sm">Acquisition replicate<select value={replicate} onChange={e=>setReplicate(Number(e.target.value))} className="bg-slate-800 rounded border border-slate-600 p-2">{[...new Set(report.snapshots.map(s=>s.replicate))].map(r=><option key={r} value={r}>{r}</option>)}</select></label>
        <label className="text-sm">Load saved view report<input type="file" accept=".json" onChange={load} className="block text-xs mt-2 max-w-64"/></label>
      </div><p role="status" className="text-sm text-indigo-200">{message}</p>
      <div className="grid md:grid-cols-3 gap-3">{Object.entries(accessLabels).map(([value,label])=>{const s=report.snapshots.find(s=>s.fixtureId===fixtureId&&s.access===value&&s.replicate===replicate);return <button key={value} onClick={()=>setAccess(value as typeof access)} aria-pressed={value===access} className={`text-left rounded border p-4 space-y-2 ${value===access?'border-indigo-400 bg-indigo-950/40':'border-slate-600'}`}><strong className="block">{label}</strong><span className="block text-sm text-slate-300">{s?.retrieval.completeWithinScope?'Complete within scope':'Incomplete'} · {s?.retrieval.stoppingReason.replaceAll('_',' ')}</span><span className="block text-xs text-slate-400">{s ? new FhirBundleIndexer(s.input.patientBundle).getAllResources().length : 0} records</span><span className="block font-mono text-xs break-all">{s?.evidenceHash.slice(0,20)}…</span></button>;})}</div>
      <div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="text-left text-slate-400 pb-3">Same evidence and policy for every strategy. Rules keep a 0.90 threshold.</caption><thead><tr>{['Strategy','Acquisition state','Assessment','Final workflow','Safe resolution','Policy cost'].map(h=><th className="p-3" key={h}>{h}</th>)}</tr></thead><tbody>{cells.map(c=>{const r=report.results[c.resultRef];return <tr key={c.strategy} className="border-t border-slate-700"><th className="p-3"><button aria-pressed={strategy===c.strategy} className={strategy===c.strategy?'text-indigo-300 underline':''} onClick={()=>setStrategy(c.strategy)}>{strategyLabels[c.strategy]}</button></th><td className="p-3">{c.availability==='available'?'Measured':c.availability==='partial'?'Partial — model unacquired':'Unavailable — unacquired'}</td><td className="p-3">{r.assessment.disposition.replaceAll('_',' ')}</td><td className="p-3">{r.workflowDisposition.replaceAll('_',' ')}</td><td className="p-3">{c.availability!=='available'?'Unmeasured':c.score.workflowSafe?'Yes':'No'}</td><td className="p-3">{c.availability!=='available'?'Unmeasured':c.policyCostUsd===null?'Unknown':`$${c.policyCostUsd.toFixed(5)}`}</td></tr>;})}</tbody></table></div>
      {snapshot&&<p className="text-xs text-slate-400 break-all">Policy {snapshot.policy.id} v{snapshot.policy.version} · SHA-256 {snapshot.policyHash}. Provider-visible scope fields: none.</p>}
      <details><summary className="cursor-pointer text-sm">Snapshot records and provenance</summary><div className="mt-3 space-y-2">{snapshot&&new FhirBundleIndexer(snapshot.input.patientBundle).getAllResources().map(r=><details key={`${r.resourceType}/${r.id}`} className="border border-slate-700 p-3 rounded text-xs"><summary className="cursor-pointer">{r.resourceType}/{r.id} · {r.date??'Clinical date not documented'}</summary><pre className="mt-2 overflow-auto whitespace-pre-wrap max-h-80">{JSON.stringify({resource:r.raw,provenance:snapshot.retrieval.provenance[`${r.resourceType}/${r.id}`]},null,2)}</pre></details>)}</div></details>
    </section>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4"><h3 className="font-semibold text-xl">Direct tier probes</h3><p className="text-sm text-slate-400">Probed independently of cascade stopping. A provider error or unacquired judgment receives no uncertainty-preservation credit.</p>
      <label className="flex flex-col gap-2 text-sm max-w-64">Probe tier<select value={tier} onChange={e=>setTier(e.target.value)} className="bg-slate-800 rounded border border-slate-600 p-2">{['rules','jev','small','frontier'].map(t=><option value={t} key={t}>{t}</option>)}</select></label>
      {probes.map(p=>{const recording=report.recordings.find(r=>r.id===p.recordingId);return <article className="border-t border-slate-700 pt-3 space-y-2 text-sm" key={p.requirementId}><p className="font-medium">{p.requirementId} · {p.outcome.replaceAll('_',' ')}</p>{recording?.result?<><p>Raw judgment: <strong>{recording.result.status.replaceAll('_',' ')}</strong> · confidence {recording.result.confidence.toFixed(2)}</p><p className="text-slate-300">{recording.result.notes}</p><p className="text-xs text-slate-400">Requested {recording.requestedModel} · resolved {recording.resolvedModel??'unreported'} · recording {recording.id} · origin {recording.origin}</p><details><summary className="cursor-pointer">Raw normalized response and citations</summary><pre className="whitespace-pre-wrap text-xs max-h-80 overflow-auto">{JSON.stringify(recording.result,null,2)}</pre></details></>:<p className="text-amber-200">No judgment acquired. {recording?.reason??p.guardReason}</p>}<p>Guard: <strong>{p.guardVerdict}</strong> · {p.guardReason}</p></article>;})}
    </section>
    {result&&snapshot&&<><div className="flex flex-wrap gap-4 items-center"><h3 className="font-semibold text-xl">{strategyLabels[strategy]} · selected workflow</h3><button onClick={exportSnapshot} className="border border-slate-500 rounded px-3 py-2 text-sm">Export selected workflow</button>{selected?.availability!=='available'&&<p className="text-sm text-amber-200">Model acquisition incomplete; this packet is an infrastructure artifact.</p>}</div><div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start"><RetrievalTracePanel retrieval={snapshot.retrieval}/><ReviewPacketPanel key={`${snapshot.id}/${strategy}/${threshold}`} result={result}/></div></>}
    <details className="rounded-xl border border-slate-700 bg-slate-900 p-5"><summary className="cursor-pointer font-semibold">Experiment summaries and limitations</summary><div className="space-y-3 mt-4 text-sm">{report.limitations.map(l=><p className="text-slate-400" key={l}>{l}</p>)}{report.summaries.filter(s=>s.threshold===threshold).map(s=><p key={s.strategy}>{strategyLabels[s.strategy]}: measured {s.measured}/{s.scheduled}; safe resolution {ratio(s.safeResolutionCoverage)}; risk {ratio(s.selectiveRisk)}.</p>)}{report.tierSummaries.filter(s=>s.threshold===threshold).map(s=><p key={s.evaluatorKey}>{s.evaluatorKey}: scheduled {s.scheduled}, acquired {s.acquired}, failed {s.failed}, unacquired {s.unacquired}; uncertainty preserved {s.acquired?ratio(s.uncertaintyPreserved):'Unmeasured (no acquisitions)'}.</p>)}<pre className="overflow-auto max-h-80 text-xs">{JSON.stringify({fingerprints:report.fingerprints,contrasts:report.contrasts,safety:report.empiricalSafety},null,2)}</pre></div></details>
  </main>;
}
