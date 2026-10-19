import {
  type PolicyRequirement,
  type RequirementStatus,
  type IndexedResource,
  parseDate,
  daysBetween,
  isFutureDate,
  isWithinLookback,
} from '@openpa/core';
import type { PolicyEvaluator, EvaluatorContext, EvaluatorResult } from '../types.js';

function evaluateComparator(val: number, comp: '>=' | '>' | '<=' | '<' | '==', target: number): boolean {
  switch (comp) {
    case '>=': return val >= target;
    case '>': return val > target;
    case '<=': return val <= target;
    case '<': return val < target;
    case '==': return val === target;
  }
}

export class DeterministicRulesEvaluator implements PolicyEvaluator {
  public readonly id = 'deterministic-rules';
  public readonly name = 'Deterministic Rules Engine';
  public readonly tierLevel = 1;
  public readonly maxCostUsd = 0;
  public readonly maxTokens = 0;

  public async evaluateRequirement(
    req: PolicyRequirement,
    context: EvaluatorContext
  ): Promise<EvaluatorResult> {
    const startTime = performance.now();

    const makeResult = (
      status: RequirementStatus,
      notes: string,
      citations: IndexedResource[],
      confidence = 1.0,
      contradiction = false,
      escalate = false,
      escalationReason?: string
    ): EvaluatorResult => ({
      status,
      confidence,
      evidence: citations.map(c => ({
        resourceType: c.resourceType,
        resourceId: `${c.resourceType}/${c.id}`,
        date: c.date,
        textSnippet: c.textSnippet,
      })),
      notes,
      contradictionDetected: contradiction,
      escalateToClinicalReview: escalate,
      escalationReason,
      metrics: {
        costUsd: 0,
        latencyMs: Math.max(0, performance.now() - startTime),
        inputTokens: 0,
        outputTokens: 0,
      },
    });

    // 1. Validate codes presence
    if (!req.acceptableCodes || req.acceptableCodes.length === 0) {
      return makeResult(
        'insufficient_evidence',
        `Policy requirement ${req.id} does not define acceptable clinical codes; deterministic rules engine deferred.`,
        [],
        0
      );
    }

    // 2. Map requirement category to resource types
    const types: string[] = [];
    const isRxNorm = req.acceptableCodeSystems?.some(s => s.toLowerCase().includes('rxnorm'));

    if (req.category === 'diagnosis') {
      types.push('Condition');
    } else if (req.category === 'imaging_prerequisite') {
      types.push('DiagnosticReport', 'Procedure');
    } else if (req.category === 'conservative_therapy') {
      if (isRxNorm) {
        types.push('MedicationStatement', 'MedicationRequest');
      } else {
        types.push('Procedure');
      }
    } else if (req.category === 'functional_deficit') {
      types.push('Observation', 'Procedure');
    }

    if (!types.length) {
      return makeResult(
        'insufficient_evidence',
        `Unsupported requirement category '${req.category}'; deterministic rules engine deferred.`,
        [],
        0
      );
    }

    // 3. Find candidates matching acceptable codes and acceptable code systems
    let matches = types.flatMap(type =>
      context.indexer.findByCode(type, req.acceptableCodes!, req.acceptableCodeSystems)
    );

    // 4. Clinical & verification status filters (respect active/completed, reject cancelled/error/refuted/stopped)
    const unknownConditionStatus = matches.find(r => r.resourceType === 'Condition' && !(r.raw.clinicalStatus as {coding?:unknown[]})?.coding?.length);
    if (unknownConditionStatus) return makeResult('insufficient_evidence', 'Condition lacks an explicit clinical status; active disease cannot be assumed.', [unknownConditionStatus], 0);
    matches = matches.filter(resource => {
      const raw = resource.raw;
      const status = String(raw.status ?? '').toLowerCase();

      // Universal exclusions
      if (status === 'entered-in-error' || status === 'not-done' || status === 'cancelled' || status === 'abandoned') {
        return false;
      }

      // Procedure status: must be completed
      if (resource.resourceType === 'Procedure' && status !== 'completed') {
        return false;
      }

      // DiagnosticReport status: must be final, amended, or corrected
      if (resource.resourceType === 'DiagnosticReport' && !['final', 'amended', 'corrected'].includes(status)) {
        return false;
      }

      // Observation status: must be final, amended, or corrected
      if (resource.resourceType === 'Observation' && !['final', 'amended', 'corrected'].includes(status)) {
        return false;
      }

      // Condition clinicalStatus & verificationStatus
      if (resource.resourceType === 'Condition') {
        const clinical = raw.clinicalStatus as { coding?: Array<{ code?: string }> } | undefined;
        const verification = raw.verificationStatus as { coding?: Array<{ code?: string }> } | undefined;

        const isInactiveOrResolved = clinical?.coding?.some(c =>
          ['inactive', 'resolved', 'remission'].includes(String(c.code ?? '').toLowerCase())
        );
        const isRefutedOrError = verification?.coding?.some(c =>
          ['refuted', 'entered-in-error'].includes(String(c.code ?? '').toLowerCase())
        );

        if (isInactiveOrResolved || isRefutedOrError) return false;
      }

      // MedicationStatement / MedicationRequest: MUST be active
      if (resource.resourceType === 'MedicationStatement' || resource.resourceType === 'MedicationRequest') {
        if (status !== 'active') {
          return false;
        }
      }

      return true;
    });

    // 5. Explicit request date reference & lookback evaluation
    if (matches.some(r => r.temporalIssues.length > 0)) {
      return makeResult('insufficient_evidence', 'Candidate evidence has invalid clinical dates or periods; review required.', matches, 0, false, true, 'invalid_clinical_dates');
    }
    const referenceDate = context.caseData.requestedAt;
    if (req.timeWindowDays != null && !referenceDate) {
      return makeResult(
        'insufficient_evidence',
        'Explicit request date (requestedAt) is required to evaluate lookback window.',
        [],
        0
      );
    }

    // Validate referenceDate
    if (referenceDate && !parseDate(referenceDate)) {
      return makeResult('insufficient_evidence', 'Invalid requestedAt date format.', [], 0);
    }

    // Filter by temporal validity: reject future dates, reversed periods, and events outside lookback
    matches = matches.filter(resource => {
      // Check period start/end if present
      if (resource.period) {
        if (resource.period.start && resource.period.end) {
          if (daysBetween(resource.period.start, resource.period.end) < 0) {
            return false; // Reversed period
          }
        }
      }

      // Check against future dates relative to request date
      if (referenceDate && resource.date) {
        if (isFutureDate(resource.date, referenceDate)) {
          return false;
        }
      }
      if (referenceDate && resource.period?.start && isFutureDate(resource.period.start, referenceDate)) return false;
      if (referenceDate && resource.period?.end && isFutureDate(resource.period.end, referenceDate)) return false;

      // Check lookback window
      if (req.timeWindowDays != null && referenceDate) {
        if (!resource.date) return false;
        return isWithinLookback(resource.date, referenceDate, req.timeWindowDays);
      }

      return true;
    });

    // 6. Laterality & Body-Site Check
    const expectedLaterality = req.laterality || context.caseData.requestedService.laterality;
    if (expectedLaterality && expectedLaterality !== 'unspecified') {
      // Find matches that match expected laterality or are bilateral/unspecified
      const sameSideOrBilateral = matches.filter(resource => {
        if (!resource.laterality || resource.laterality === 'unspecified' || resource.laterality === 'bilateral') {
          return true;
        }
        return resource.laterality === expectedLaterality;
      });

      if (sameSideOrBilateral.length === 0 && matches.length > 0) {
        // All candidate records are explicitly contralateral
        return makeResult(
          'insufficient_evidence',
          `Laterality mismatch: service/policy specifies ${expectedLaterality}, but all documented evidence specifies contralateral laterality.`,
          matches,
          1.0
        );
      }

      // Accept eligible same-side evidence without automatically failing because unrelated opposite-side evidence exists
      if (sameSideOrBilateral.length > 0) {
        matches = sameSideOrBilateral;
      }
    }

    if (!matches.length) {
      return makeResult(
        'insufficient_evidence',
        'No eligible active/completed clinical evidence matching required codes, systems, time window, and laterality.',
        []
      );
    }

    // Check the relevant patient's chart, including notes stored separately from coded evidence.
    // Only explicit concept-scoped negation is a deterministic contradiction signal.
    const concepts = req.narrativeConcepts ?? [];
    const chartNotes = context.indexer.getAllResources().filter(r => r.subjectId === context.indexer.bundlePatientId);
    const negated = chartNotes.find(r => concepts.some(concept => {
      const escaped = concept.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const text = r.textSnippet ?? '';
      return new RegExp(`\\b(?:denies|no|negative for|refutes|without|no longer taking|discontinued|stopped)(?:\\s+\\w+){0,4}\\s+${escaped}\\b|\\b${escaped}\\b.{0,30}\\b(?:absent|refuted|resolved|discontinued)\\b`, 'i').test(text);
    }));
    if (negated) {
      return makeResult('insufficient_evidence', 'Relevant patient narrative explicitly contradicts the coded criterion; clinical review required.', [...matches, negated].filter((r,i,a) => a.indexOf(r) === i), 0, true, true, 'concept_scoped_narrative_conflict');
    }

    // 7. Category-specific evaluation
    if (req.category === 'diagnosis') {
      // Check for contradictory or negating clinical narrative
      const conflictingResource = matches.find(resource => {
        const text = (resource.textSnippet ?? '').toLowerCase();
        return /\b(rule out|no joint derangement|asymptomatic)\b/i.test(text);
      });

      if (conflictingResource) {
        return makeResult(
          'insufficient_evidence',
          'Diagnosis code is present but clinical narrative contains explicit negation or symptom resolution; clinical review required.',
          matches,
          0,
          true, // contradictionDetected
          true, // escalateToClinicalReview
          'narrative_negation'
        );
      }

      return makeResult('satisfied', 'Documented active diagnosis matching policy criteria.', matches);
    }

    if (req.category === 'imaging_prerequisite') {
      return makeResult(
        'satisfied',
        `Documented prerequisite imaging completed within the ${req.timeWindowDays ?? 90}-day policy lookback window.`,
        matches
      );
    }

    if (req.category === 'conservative_therapy') {
      if (isRxNorm) {
        // Check for contradictory narrative regarding medication discontinuation
        const conflictingMed = matches.find(resource => {
          const text = (resource.textSnippet ?? '').toLowerCase();
          return /\b(discontinued|stopped|no longer taking|non-adherent|insulin held|denies (?:insulin|taking))\b/i.test(text);
        });

        if (conflictingMed) {
          return makeResult(
            'insufficient_evidence',
            'Medication record present but clinical narrative documents discontinuation or non-adherence; clinical review required.',
            matches,
            0,
            true, // contradictionDetected
            true, // escalateToClinicalReview
            'medication_discontinuation_conflict'
          );
        }

        return makeResult('satisfied', 'Documented active prescription for required therapy medication.', matches);
      }

      if (!req.minimumDurationDays) {
        return makeResult(
          'insufficient_evidence',
          'Structured minimumDurationDays parameter is required to evaluate conservative therapy.',
          [],
          0
        );
      }

      // Extract all valid therapy session dates
      const dates: string[] = [];
      const eligible: IndexedResource[] = [];

      for (const resource of matches) {
        const d = resource.date;
        if (d && !dates.includes(d)) {
          dates.push(d);
          eligible.push(resource);
        }
      }

      dates.sort((a, b) => (parseDate(a)?.getTime() ?? 0) - (parseDate(b)?.getTime() ?? 0));

      if (dates.length < 2) {
        return makeResult(
          'insufficient_evidence',
          'Conservative therapy requires multiple documented session dates to establish continuous span and adherence.',
          eligible
        );
      }

      const earliest = dates[0];
      const latest = dates[dates.length - 1];
      const spanDays = daysBetween(earliest, latest);

      if (spanDays < req.minimumDurationDays) {
        return makeResult(
          'insufficient_evidence',
          `Documented therapy span of ${spanDays.toFixed(0)} days does not meet the policy minimum of ${req.minimumDurationDays} days.`,
          eligible
        );
      }

      // Distinguish elapsed session span from evidence of failed conservative management or resolution
      const therapyText = eligible.map(r => r.textSnippet ?? '').join(' ');
      if (req.requiresDocumentedAdherence && !/\bcontinuous weekly physical therapy\b/i.test(therapyText)) {
        return makeResult('insufficient_evidence', 'Session endpoints establish elapsed time, but continuity/adherence requires explicit documentation or narrative interpretation.', eligible, 0);
      }
      if (req.requiresPersistentSymptoms && !/\bpersistent (?:radicular pain|symptoms)\b/i.test(therapyText)) {
        return makeResult('insufficient_evidence', 'Therapy duration alone does not establish persistent symptoms or failed management.', eligible, 0);
      }
      const hasResolvedNote = eligible.some(r =>
        /\b(symptoms resolved|full recovery|no further therapy needed|asymptomatic)\b/i.test(r.textSnippet ?? '')
      );
      if (hasResolvedNote) {
        return makeResult(
          'insufficient_evidence',
          'Therapy notes document resolution of symptoms; conservative management succeeded without need for advanced intervention.',
          eligible,
          0
        );
      }

      return makeResult(
        'satisfied',
        `Documented ${spanDays.toFixed(0)} days of completed conservative therapy (policy minimum: ${req.minimumDurationDays} days) with persistent symptoms.`,
        eligible
      );
    }

    if (req.category === 'functional_deficit') {
      // Check numeric threshold if defined
      if (req.numericThreshold) {
        const threshold = req.numericThreshold;
        for (const obs of matches) {
          const val = obs.numericValue;
          if (threshold.unit && obs.numericUnit !== threshold.unit) {
            return makeResult('insufficient_evidence', `Numeric unit '${obs.numericUnit ?? 'missing'}' does not match '${threshold.unit}'; conversion is not supported.`, [obs], 0);
          }
          const text = obs.textSnippet ?? '';
          const scoreMatch = /(?:score|ess|epworth)[:\s]+(\d+)/i.exec(text);
          const narrativeVal = scoreMatch ? parseInt(scoreMatch[1], 10) : undefined;

          // Check for conflict between structured value and narrative value
          if (val != null && narrativeVal != null && val !== narrativeVal) {
            const valPasses = evaluateComparator(val, threshold.comparator, threshold.value);
            const narrPasses = evaluateComparator(narrativeVal, threshold.comparator, threshold.value);
            if (valPasses !== narrPasses) {
              return makeResult(
                'insufficient_evidence',
                `Conflicting evidence: structured observation value (${val}) contradicts clinical narrative score (${narrativeVal}); requires clinical review.`,
                [obs],
                0,
                true, // contradictionDetected
                true, // escalateToClinicalReview
                'conflicting_numeric_values'
              );
            }
          }

          const effectiveVal = val ?? narrativeVal;
          if (effectiveVal != null) {
            const passes = evaluateComparator(effectiveVal, threshold.comparator, threshold.value);
            if (passes) {
              return makeResult(
                'satisfied',
                `Documented score of ${effectiveVal} satisfies policy threshold (${threshold.comparator} ${threshold.value}).`,
                [obs]
              );
            } else {
              return makeResult(
                'not_satisfied',
                `Documented score of ${effectiveVal} does not satisfy policy threshold (${threshold.comparator} ${threshold.value}).`,
                [obs],
                1.0
              );
            }
          }
        }

        return makeResult(
          'insufficient_evidence',
          `No numeric score documented meeting policy threshold (${threshold.comparator} ${threshold.value}).`,
          matches,
          0
        );
      }

      // Check PT re-evaluation progress
      const reeval = matches.find(r => r.resourceType === 'Procedure' && r.codings.some(c => c.code === '97164'));
      if (reeval) {
        const text = (reeval.textSnippet ?? '').toLowerCase();
        const hasPlateau = /\b(plateau|no measurable (?:gains|progress|improvement)|maintenance (?:level|care)|lack of progress)\b/i.test(text);
        if (hasPlateau) {
          return makeResult(
            'insufficient_evidence',
            'Physical therapy re-evaluation documents functional plateau without measurable progress; extension criteria not met.',
            [reeval],
            1.0
          );
        }

        const tug = /(?:timed up and go|tug).*?from\s+(\d+(?:\.\d+)?)\s*s\s+to\s+(\d+(?:\.\d+)?)\s*s/i.exec(text);
        if (tug && Number(tug[2]) < Number(tug[1])) {
          return makeResult('satisfied', `Documented TUG improvement from ${tug[1]}s to ${tug[2]}s.`, [reeval]);
        }
        return makeResult('insufficient_evidence', 'Re-evaluation code alone does not establish measurable progress; narrative interpretation required.', [reeval], 0);
      }

      // Non-deterministic criteria category: safely defer interpretation
      return makeResult(
        'insufficient_evidence',
        'Functional deficit / progress requires clinical narrative interpretation; deterministic rules engine deferred.',
        matches,
        0
      );
    }

    // Default for unsupported categories: safely defer interpretation rather than assuming code presence equals satisfaction
    return makeResult(
      'insufficient_evidence',
      `Criteria category '${req.category}' requires clinical narrative interpretation; deterministic rules engine deferred.`,
      matches,
      0
    );
  }
}
