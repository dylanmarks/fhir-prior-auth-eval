import { FhirBundleIndexer, type RetrievalResult } from '@openpa/core';

export function RetrievalTracePanel({retrieval}: {retrieval: RetrievalResult}) {
  const indexer = new FhirBundleIndexer(retrieval.materializedBundle);
  return <section className="rounded-xl border border-slate-700 bg-slate-900 p-5 space-y-4">
    <h3 className="font-semibold text-lg">Source search trace</h3>
    <p className="text-sm text-slate-300">{retrieval.scopeDescription}</p>
    <p className={retrieval.completeWithinScope ? 'text-emerald-300' : 'text-amber-200'}>{retrieval.completeWithinScope ? 'Complete within this scope' : 'Incomplete'} · {retrieval.stoppingReason.replaceAll('_', ' ')}</p>
    <p className="text-sm text-slate-400">{retrieval.counts.queries} searches · {retrieval.counts.pages} pages · {retrieval.counts.reads} read attempts · {retrieval.counts.uniqueEligibleRecords} new records · {retrieval.counts.duplicateRecords} duplicates · {retrieval.counts.rejectedRecords} rejected</p>
    {retrieval.incompleteSources.length > 0 && <p className="text-sm text-amber-200">Unfinished scope: {retrieval.incompleteSources.join(', ')}</p>}
    {!retrieval.trace.length && <p className="text-sm text-slate-400">No search/read operations in this arm.</p>}
    <ol className="space-y-2 max-h-96 overflow-y-auto">{retrieval.trace.map(event => <li key={event.sequence} className="border border-slate-700 rounded p-3 text-sm">
      <p>{event.sequence}. {event.operation} · {event.sourceId} · {event.resourceType}</p>
      <p className="text-slate-400">{event.outcome.replaceAll('_', ' ')} · {event.elapsedMs.toFixed(1)} ms since start{event.returnedCount !== undefined ? ` · ${event.returnedCount} records` : ''}</p>
      {event.cursor && <p className="text-xs">Cursor: {event.cursor}</p>}
      {event.errorCode && <p className="text-amber-200">{event.errorCode}</p>}
      {event.references?.map(ref => <details className="text-xs text-slate-400 break-all" key={`${ref.sourceId}/${ref.resourceId}`}><summary className="cursor-pointer">{ref.resourceId}</summary><p>SHA-256 {ref.contentHash}</p><pre className="whitespace-pre-wrap max-h-72 overflow-auto">{JSON.stringify({reference: ref, resource: indexer.getResourceById(ref.resourceId)?.raw ?? 'Not materialized; see integrity issues or incomplete search.'}, null, 2)}</pre></details>)}
    </li>)}</ol>
  </section>;
}
