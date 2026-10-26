import { useEffect, useRef, useState } from 'react';
import { type EvidenceWorkflowResult, FhirBundleIndexer } from '@openpa/core';
import { executeEvidenceWorkflow, InMemoryEvidenceSource, TieredOrchestrator, DeterministicRulesEvaluator, type ExperimentArmId } from '@openpa/evaluators';
import { BUNDLED_POLICIES } from './data';
import { RETRIEVAL_FIXTURES, RETRIEVAL_LABELS, RETRIEVAL_REPORT, RETRIEVAL_REPORT_SOURCE } from './retrieval-data';
import { RetrievalTracePanel } from './RetrievalTracePanel';
import { ReviewPacketPanel } from './ReviewPacketPanel';

const arms: Record<ExperimentArmId, string> = {submitted_only: 'Submitted records only', retrieval: 'Search available sources', full_corpus: 'Full accessible corpus reference'};
export function RetrievalWorkbench() {
  const [family, setFamily] = useState('lumbar_mri');
  const [id, setId] = useState('scn-701');
  const [arm, setArm] = useState<ExperimentArmId>('submitted_only');
  const [result, setResult] = useState<EvidenceWorkflowResult | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('Select a variant, then run an evidence-access arm.');
  const [error, setError] = useState('');
  const runId = useRef(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => {abort.current?.abort(); runId.current++;}, []);
  const reset = () => {abort.current?.abort(); runId.current++; setResult(null); setRunning(false); setError(''); setMessage('Ready to run.');};
  const fixture = RETRIEVAL_FIXTURES.find(f => f.input.scenarioId === id)!;
  const label = RETRIEVAL_LABELS.find(l => l.scenarioId === id)!;
  const policy = BUNDLED_POLICIES.find(p => p.id === fixture.input.policyId)!;
  const run = async () => {
    reset(); const token = ++runId.current; const controller = new AbortController(); abort.current = controller;
    setRunning(true); setMessage('Running local synthetic workflow…');
    try {
      const next = await executeEvidenceWorkflow({input: fixture.input, policy, arm, signal: controller.signal,
        sources: fixture.input.sources.map(s => new InMemoryEvidenceSource(s, fixture.corpus[s.id] ?? [])),
        orchestrator: new TieredOrchestrator([new DeterministicRulesEvaluator()]), referenceCorpus: fixture.corpus});
      if (token !== runId.current) return;
      setResult(next); setMessage(`Workflow finished: ${next.workflowDisposition.replaceAll('_', ' ')}; search ${next.retrieval.stoppingReason.replaceAll('_', ' ')}.`);
    } catch (e) {if (token === runId.current) setError(e instanceof Error ? e.message : 'Workflow failed');}
    finally {if (token === runId.current) setRunning(false);}
  };
  return <main className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6">
    <section className="rounded-xl border border-indigo-800 bg-indigo-950/30 p-6 space-y-3"><p className="text-xs uppercase tracking-wider text-indigo-300">Evidence access experiment · offline</p><h2 className="text-2xl font-semibold">Find the evidence. Make the handoff useful.</h2><p className="text-slate-300">Compare the same fixed rules assessor on submitted records, bounded retrieval, and an accessible-corpus reference. Inspect what was found and what the next reviewer needs.</p><p className="text-sm text-amber-200">Twelve authored synthetic fixtures across two families. Sources run locally; no EHR connection or live model calls. Meets policy describes the synthetic criteria, not payer authorization.</p></section>
    <section className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
      <div className="flex flex-wrap gap-4 items-end">
        <label className="text-sm flex flex-col gap-2">Clinical family<select className="bg-slate-800 rounded border border-slate-600 p-2" value={family} onChange={e => {reset(); setFamily(e.target.value); setId(e.target.value === 'lumbar_mri' ? 'scn-701' : 'scn-707');}}><option value="lumbar_mri">Lumbar MRI</option><option value="knee_mri">Knee MRI</option></select></label>
        <label className="text-sm flex flex-col gap-2">Record arrangement<select className="bg-slate-800 rounded border border-slate-600 p-2" value={id} onChange={e => {reset(); setId(e.target.value);}}>{RETRIEVAL_LABELS.filter(l => l.family === family).map(l => <option key={l.scenarioId} value={l.scenarioId}>{l.variantLabel}</option>)}</select></label>
        <label className="text-sm flex flex-col gap-2">Evidence access<select className="bg-slate-800 rounded border border-slate-600 p-2" value={arm} onChange={e => {reset(); setArm(e.target.value as ExperimentArmId);}}>{Object.entries(arms).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
        <button disabled={running} onClick={run} className="bg-indigo-600 disabled:opacity-50 rounded px-4 py-2">Run workflow</button>
        <button disabled={!running} onClick={() => abort.current?.abort()} className="border border-slate-500 disabled:opacity-40 rounded px-3 py-2">Cancel</button>
        <button onClick={reset} className="border border-slate-500 rounded px-3 py-2">Reset</button>
      </div>
      <p className="text-sm text-slate-300">{label.description}</p>
      {family === 'lumbar_mri' && <p className="text-xs text-amber-200">Fixed policy limitation: no episode or recency restriction is configured for therapy. The assessor can include historical sessions in elapsed duration; this does not establish continuous treatment.</p>}
      <p role="status" aria-live="polite" className="text-sm text-indigo-200">{message}</p>{error && <p role="alert" className="text-red-300">{error}</p>}
      <div className="grid md:grid-cols-2 gap-5 text-sm"><div><h3 className="font-medium mb-2">Request and initial submission</h3><p>{fixture.input.requestedService.description} · {fixture.input.requestedService.code}</p><p className="text-slate-400">Request date: {fixture.input.requestedAt} · {policy.title} v{policy.version}</p><p className="mt-2 text-slate-400">{new FhirBundleIndexer(fixture.input.initialBundle).getAllResources().map(r => `${r.resourceType}/${r.id}`).join(', ')}</p></div><div><h3 className="font-medium mb-2">Configured simulated sources</h3>{fixture.input.sources.map(s => <p key={s.id}>{s.name} · {s.availability}<span className="block text-slate-400 text-xs mb-2">{s.supportedResourceTypes.join(', ')}</span></p>)}</div></div>
    </section>
    {result && <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-6 items-start"><RetrievalTracePanel retrieval={result.retrieval}/><ReviewPacketPanel key={`${id}-${arm}-${result.reviewPacket.generatedAt}`} result={result}/></div>}
    <details className="rounded-xl border border-slate-700 bg-slate-900 p-5"><summary className="cursor-pointer font-semibold">Saved benchmark report · {RETRIEVAL_REPORT_SOURCE}</summary><div className="space-y-4 mt-4 text-sm">
      <p>All 12 fixtures × 3 access arms. Author-only labels; paired variants are not independent patients. Saved {new Date(RETRIEVAL_REPORT.generatedAt).toLocaleString()}.</p>
      <div className="overflow-x-auto"><table className="w-full text-left"><caption className="text-left text-slate-400 mb-3">Expected workflow and packet correctness on the authored regression set.</caption><thead><tr>{['Arm', 'Workflow outcomes', 'End-to-end packets', 'Critical omissions', 'Unsupported claims'].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{RETRIEVAL_REPORT.aggregates.map(a => <tr className="border-t border-slate-700" key={a.arm}><th className="p-2">{arms[a.arm as ExperimentArmId]}</th><td className="p-2">{Math.round(a.dispositionAccuracy*a.caseCount)}/{a.caseCount}</td><td className="p-2">{Math.round(a.endToEndCorrectnessRate*a.caseCount)}/{a.caseCount}</td><td className="p-2">{a.totalCriticalOmissions}</td><td className="p-2">{a.totalUnsupportedDefinitiveClaims}</td></tr>)}</tbody></table></div>
      {RETRIEVAL_REPORT.limitations.map(l => <p className="text-slate-400" key={l}>{l}</p>)}
      <details><summary className="cursor-pointer">Per-fixture metrics and provenance</summary><pre className="text-xs overflow-auto max-h-96 mt-3">{JSON.stringify({fingerprints: RETRIEVAL_REPORT.fingerprints, scores: RETRIEVAL_REPORT.runs.map(r => r.score)}, null, 2)}</pre></details>
    </div></details>
  </main>;
}
