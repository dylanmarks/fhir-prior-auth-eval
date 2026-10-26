import { useEffect, useRef, useState } from 'react';
import { EvidenceWorkflowResultSchema, FhirBundleIndexer, type EvidenceWorkflowResult, type ReviewPacketCitation } from '@openpa/core';

export function ReviewPacketPanel({result}: {result: EvidenceWorkflowResult}) {
  const [citation, setCitation] = useState<ReviewPacketCitation | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [exported, setExported] = useState('');
  useEffect(() => {if (citation && !dialog.current?.open) dialog.current?.showModal();}, [citation]);
  const packet = result.reviewPacket;
  const exportJson = () => {
    const artifact = EvidenceWorkflowResultSchema.parse(result);
    const url = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], {type: 'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = `${packet.scenarioId}-review-v${packet.schemaVersion}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setExported('Synthetic workflow JSON exported.');
  };
  const resource = citation ? new FhirBundleIndexer(result.retrieval.materializedBundle).getResourceById(citation.resourceId) : undefined;
  const citeButton = (cite: ReviewPacketCitation) => <button key={`${cite.sourceId}/${cite.resourceId}`} onClick={() => setCitation(cite)} className="block w-full text-left rounded border border-slate-600 p-3 hover:border-indigo-400">
    <span className="text-indigo-300 text-sm break-all">{cite.resourceId}</span>
    <span className="block text-xs text-slate-400">{cite.sourceId} · Clinical date: {cite.date ?? 'Not documented'}</span>
    <span className="block text-sm text-slate-300 mt-2">{cite.excerpt ?? 'Open raw source record'}</span>
  </button>;
  return <section className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold text-xl">Review packet</h3><button onClick={exportJson} className="border border-slate-500 rounded px-3 py-2 text-sm">Export workflow JSON</button></div>
    <p role="status" className="text-sm text-slate-400">{exported}</p>
    <p className="text-amber-200 text-xs">SYNTHETIC DATA · Suggested roles only. No tasks or messages are sent.</p>
    <div className="grid sm:grid-cols-2 gap-3 text-sm">
      <p>Workflow: <strong>{packet.workflowDisposition.replaceAll('_', ' ')}</strong></p>
      <p>Purpose: {packet.purpose.replaceAll('_', ' ')}</p>
      <p>Assessment of available records: {result.assessment.disposition.replaceAll('_', ' ')}</p>
      <p>Policy: {packet.policyId} · v{packet.policyVersion}</p>
    </div>
    {packet.integrityIssues.map(issue => <p className="text-amber-200" key={issue}>{issue}</p>)}
    {packet.criteria.map(row => <article className="border-t border-slate-700 pt-5 space-y-3" key={row.requirementId}>
      <h4 className="font-medium">{row.description}</h4>
      <p className="text-sm text-slate-300">{row.evaluationState === 'not_evaluated' ? 'Not evaluated after safety stop' : `${row.status?.replaceAll('_', ' ')} · confidence ${((row.confidence ?? 0) * 100).toFixed(0)}%`}</p>
      {row.evaluationState === 'evaluated' && <p className="text-sm text-slate-400">{row.evaluatorNotes}</p>}
      <p className="text-sm text-amber-200">Gap: {row.gapKind.replaceAll('_', ' ')}</p>
      <div className="space-y-2">{row.citations.map(citeButton)}</div>
      {!!row.conflictCitations?.length && <div className="space-y-2"><p className="text-sm text-amber-200">Evidence to reconcile — retain both accounts</p>{row.conflictCitations.map(citeButton)}</div>}
      <div className="bg-slate-800 rounded p-3 text-sm"><p>{row.nextAction.description}</p>{row.nextAction.type !== 'none' && <p className="text-slate-400 mt-2">Suggested action: {row.nextAction.type.replaceAll('_', ' ')} · {row.nextAction.proposedRole.replaceAll('_', ' ')}</p>}</div>
    </article>)}
    <details><summary className="cursor-pointer text-sm">Packet provenance and unresolved items</summary><div className="text-xs text-slate-400 mt-3 space-y-2"><p>Generated: {packet.generatedAt}</p><p className="break-all">Content SHA-256: {packet.contentFingerprint}</p>{packet.unresolvedItems.map(item => <p key={item}>{item}</p>)}</div></details>
    {citation && <dialog ref={dialog} onClose={() => setCitation(null)} className="bg-slate-900 text-slate-100 border border-slate-600 rounded-xl p-6 max-w-3xl w-[90vw] backdrop:bg-black/70">
      <div className="flex justify-between gap-4"><h3 className="font-semibold break-all">Source record: {citation.resourceId}</h3><button onClick={() => dialog.current?.close()} className="border border-slate-500 rounded px-3 py-1">Close</button></div>
      <p className="text-sm text-slate-400 my-3">Clinical date: {citation.date ?? 'Not documented'} · {citation.sourceId}</p>
      <p className="text-sm mb-4">{citation.excerpt}</p>
      <pre className="overflow-auto max-h-[60vh] whitespace-pre-wrap break-all text-xs bg-slate-950 p-4 rounded">{JSON.stringify({provenance: citation.provenance, resource: resource?.raw}, null, 2)}</pre>
    </dialog>}
  </section>;
}
