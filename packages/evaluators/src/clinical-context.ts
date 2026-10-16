import type { EvaluatorContext } from './types.js';
import { isFutureDate, isWithinLookback, type PolicyRequirement } from '@openpa/core';

export const ADAPTER_REVISION = 'evidence-v2.0';

/** Shared, patient-scoped context. No labels, case titles, or expected results reach providers. */
export function clinicalContext(context: EvaluatorContext, requirement?: PolicyRequirement) {
  return context.indexer.getAllResources()
    .filter(r => r.subjectId === context.indexer.bundlePatientId && r.temporalIssues.length === 0)
    .filter(r => ['Condition', 'Procedure', 'DiagnosticReport', 'Observation', 'MedicationStatement', 'MedicationRequest', 'DocumentReference'].includes(r.resourceType))
    .filter(r => !['entered-in-error','cancelled','not-done','stopped'].includes(r.status ?? ''))
    .filter(r => !r.date || !context.caseData.requestedAt || !isFutureDate(r.date, context.caseData.requestedAt))
    .filter(r => requirement?.timeWindowDays == null || !!(r.date && context.caseData.requestedAt && isWithinLookback(r.date, context.caseData.requestedAt, requirement.timeWindowDays)))
    .map(r => ({
      resourceType: r.resourceType, resourceId: `${r.resourceType}/${r.id}`,
      date: r.date, period: r.period && {start: r.period.start, end: r.period.end},
      status: r.status, textSnippet: r.textSnippet, codings: r.codings,
      clinicalStatus: r.raw.clinicalStatus, verificationStatus: r.raw.verificationStatus,
      numericValue: r.numericValue, numericUnit: r.numericUnit, laterality: r.laterality,
    }));
}

export function inputByteCount(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Strips markdown code fences and surrounding conversational prose from LLM JSON responses.
 */
export function cleanJsonOutput(raw: string): string {
  if (typeof raw !== 'string') return '';
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  } else if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let startIdx = -1;
  let endIdx = -1;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIdx = firstBrace;
    endIdx = text.lastIndexOf('}');
  } else if (firstBracket !== -1) {
    startIdx = firstBracket;
    endIdx = text.lastIndexOf(']');
  }

  if (startIdx !== -1 && endIdx > startIdx) {
    text = text.slice(startIdx, endIdx + 1);
  }

  return text;
}
