import { RetrievalInputSchema } from '@openpa/core';
import fallback from '../../../datasets/retrieval/offline-report.json';
import manifest from '../../../datasets/retrieval/manifest.json';

const modules = import.meta.glob('../../../datasets/retrieval/cases/*.json', {eager: true, import: 'default'});
export const RETRIEVAL_FIXTURES = Object.values(modules).map(raw => {
  const fixture = raw as Record<string, unknown>;
  return {input: RetrievalInputSchema.parse(fixture), corpus: fixture.sourceCorpus as Record<string, Record<string, unknown>[]>};
});
// Presentation metadata stays separate from runtime inputs. No gold sidecars are imported.
export const RETRIEVAL_LABELS = manifest;
const reports = import.meta.glob('../../../results/retrieval/workbench-report.json', {eager: true, import: 'default'});
export const RETRIEVAL_REPORT = (Object.values(reports)[0] ?? fallback) as typeof fallback;
export const RETRIEVAL_REPORT_SOURCE = Object.keys(reports).length ? 'Generated local report' : 'Bundled offline snapshot';
