import type { PriorAuthCase, RequirementStatus } from '@openpa/core';

export type MutationType =
  | 'shorten_therapy_duration'
  | 'diagnosis_non_indicated'
  | 'temporal_expiry'
  | 'clinical_negation'
  | 'laterality_mismatch';

export interface MutationApplicationResult {
  isApplicable: boolean;
  isNoOp: boolean;
  mutatedCase: PriorAuthCase;
  mutationType: MutationType;
  expectedDisposition: 'needs_information' | 'requires_clinical_review';
  expectedFlippedRequirementId: string;
  expectedRequirementStatus: RequirementStatus;
  explanation: string;
}

export class CounterfactualMutator {
  public static applyMutation(
    originalCase: PriorAuthCase,
    mutationType: MutationType
  ): MutationApplicationResult {
    // Deep clone to ensure original input case is never mutated
    const cloned = JSON.parse(JSON.stringify(originalCase)) as PriorAuthCase;
    cloned.id = `${originalCase.id}__mutated_${mutationType}`;
    cloned.title = `[MUTATED: ${mutationType}] ${originalCase.title}`;

    const originalBundleJson = JSON.stringify(originalCase.patientBundle);
    const entries = Array.isArray(cloned.patientBundle.entry)
      ? (cloned.patientBundle.entry as Array<{ resource: Record<string, unknown> }>)
      : [];

    let isApplicable = false;
    let expectedFlippedRequirementId = '';
    let expectedDisposition: 'needs_information' | 'requires_clinical_review' = 'needs_information';
    let expectedRequirementStatus: RequirementStatus = 'insufficient_evidence';
    let explanation = '';

    switch (mutationType) {
      case 'shorten_therapy_duration': {
        // Applicable only to lumbar_mri conservative physical therapy
        if (cloned.scenarioCategory === 'lumbar_mri') {
          const therapyEntries = entries.filter(e => {
            if (e.resource?.resourceType !== 'Procedure') return false;
            const codeObj = e.resource.code as { coding?: Array<{ code?: string }> } | undefined;
            return codeObj?.coding?.some(c => ['97110', '97140', '97161'].includes(c.code ?? ''));
          });

          if (therapyEntries.length >= 2) {
            isApplicable = true;
            expectedFlippedRequirementId = 'req-conservative-therapy';
            expectedDisposition = 'needs_information';
            expectedRequirementStatus = 'insufficient_evidence';
            explanation = 'Compress physical therapy sessions to 7 days, falling short of structured minimum duration.';

            const pStart = therapyEntries[0].resource;
            const pEnd = therapyEntries[therapyEntries.length - 1].resource;

            const baseDate = originalCase.requestedAt ? new Date(originalCase.requestedAt) : new Date('2026-07-20');
            baseDate.setDate(baseDate.getDate() - 14);
            const startDateStr = baseDate.toISOString().split('T')[0];

            baseDate.setDate(baseDate.getDate() + 7);
            const endDateStr = baseDate.toISOString().split('T')[0];

            if (pStart.performedPeriod && typeof pStart.performedPeriod === 'object') {
              const period = pStart.performedPeriod as { start?: string; end?: string };
              period.start = startDateStr;
              period.end = startDateStr;
            }
            if (pEnd.performedPeriod && typeof pEnd.performedPeriod === 'object') {
              const period = pEnd.performedPeriod as { start?: string; end?: string };
              period.start = endDateStr;
              period.end = endDateStr;
            }
            if (Array.isArray(pEnd.note) && pEnd.note[0]) {
              (pEnd.note[0] as { text?: string }).text = 'PT Session 2: Patient completed 1 week of therapy.';
            }
          }
        }
        break;
      }

      case 'diagnosis_non_indicated': {
        expectedDisposition = 'needs_information';
        expectedRequirementStatus = 'insufficient_evidence';

        if (cloned.scenarioCategory === 'lumbar_mri') {
          for (const entry of entries) {
            if (entry.resource?.resourceType === 'Condition') {
              const c = entry.resource;
              const codeObj = c.code as { coding?: Array<{ code?: string; display?: string }> } | undefined;
              if (Array.isArray(codeObj?.coding)) {
                for (const item of codeObj.coding) {
                  if (item.code?.startsWith('M54.4')) {
                    item.code = 'M54.5';
                    item.display = 'Low back pain, unspecified';
                    isApplicable = true;
                    expectedFlippedRequirementId = 'req-radiculopathy';
                    explanation = 'Mutated radiculopathy M54.41 to non-indicated non-specific back pain M54.5.';
                  }
                }
              }
            }
          }
        } else if (cloned.scenarioCategory === 'knee_mri') {
          for (const entry of entries) {
            if (entry.resource?.resourceType === 'Condition') {
              const c = entry.resource;
              const codeObj = c.code as { coding?: Array<{ code?: string; display?: string }> } | undefined;
              if (Array.isArray(codeObj?.coding)) {
                for (const item of codeObj.coding) {
                  if (item.code?.startsWith('M23') || item.code?.startsWith('S83')) {
                    item.code = 'M25.561';
                    item.display = 'Pain in right knee, unspecified derangement';
                    isApplicable = true;
                    expectedFlippedRequirementId = 'req-knee-condition';
                    explanation = 'Mutated meniscal derangement M23.2 to non-indicated joint pain M25.561.';
                  }
                }
              }
            }
          }
        } else if (cloned.scenarioCategory === 'sleep_study') {
          for (const entry of entries) {
            if (entry.resource?.resourceType === 'Condition') {
              const c = entry.resource;
              const codeObj = c.code as { coding?: Array<{ code?: string; display?: string }> } | undefined;
              if (Array.isArray(codeObj?.coding)) {
                for (const item of codeObj.coding) {
                  if (item.code?.startsWith('G47')) {
                    item.code = 'R06.89';
                    item.display = 'Other abnormalities of breathing';
                    isApplicable = true;
                    expectedFlippedRequirementId = 'req-suspected-osa';
                    explanation = 'Mutated sleep apnea G47.33 to non-indicated breathing abnormality.';
                  }
                }
              }
            }
          }
        }
        break;
      }

      case 'temporal_expiry': {
        expectedDisposition = 'needs_information';
        expectedRequirementStatus = 'insufficient_evidence';

        if (cloned.scenarioCategory === 'knee_mri') {
          for (const entry of entries) {
            const r = entry.resource;
            if (r.resourceType === 'DiagnosticReport') {
              isApplicable = true;
              expectedFlippedRequirementId = 'req-plain-radiograph';
              explanation = 'Shifted plain knee radiograph 2 years into the past, exceeding 90-day lookback.';
              const expiredDate = '2024-01-15';
              if (typeof r.effectiveDateTime === 'string') r.effectiveDateTime = expiredDate;
              if (typeof r.issued === 'string') r.issued = expiredDate;
            }
          }
        } else if (cloned.scenarioCategory === 'pt_extension') {
          for (const entry of entries) {
            const r = entry.resource;
            if (r.resourceType === 'Procedure') {
              const codeObj = r.code as { coding?: Array<{ code?: string }> } | undefined;
              if (codeObj?.coding?.some(c => c.code === '97164')) {
                isApplicable = true;
                expectedFlippedRequirementId = 'req-pt-progress';
                explanation = 'Shifted PT re-evaluation 6 months into the past, exceeding 60-day lookback.';
                const expiredDate = '2026-01-01';
                if (typeof r.performedDateTime === 'string') r.performedDateTime = expiredDate;
              }
            }
          }
        }
        break;
      }

      case 'clinical_negation': {
        expectedDisposition = 'requires_clinical_review';
        expectedRequirementStatus = 'insufficient_evidence';

        if (cloned.scenarioCategory === 'lumbar_mri') {
          for (const entry of entries) {
            const r = entry.resource;
            if (r.resourceType === 'Condition') {
              const codeObj = r.code as { coding?: Array<{ code?: string }> } | undefined;
              if (codeObj?.coding?.some(c => c.code?.startsWith('M54.4'))) {
                isApplicable = true;
                expectedFlippedRequirementId = 'req-radiculopathy';
                explanation = 'Injected explicit clinical negation ("patient denies radiculopathy, resolved") into clinical notes.';
                r.note = [{ text: 'Patient denies radiculopathy or persistent radicular pain. Symptoms resolved.' }];
                r.text = {
                  status: 'generated',
                  div: '<div>Patient denies radiculopathy or persistent radicular pain. Symptoms resolved.</div>',
                };
              }
            }
          }
        } else if (cloned.scenarioCategory === 'knee_mri') {
          for (const entry of entries) {
            const r = entry.resource;
            if (r.resourceType === 'Condition') {
              const codeObj = r.code as { coding?: Array<{ code?: string }> } | undefined;
              if (codeObj?.coding?.some(c => c.code?.startsWith('M23'))) {
                isApplicable = true;
                expectedFlippedRequirementId = 'req-knee-condition';
                explanation = 'Injected explicit clinical negation ("patient denies joint derangement or mechanical locking") into clinical notes.';
                r.note = [{ text: 'Patient denies joint derangement, mechanical locking, or knee instability. Symptoms resolved.' }];
                r.text = {
                  status: 'generated',
                  div: '<div>Patient denies joint derangement, mechanical locking, or knee instability. Symptoms resolved.</div>',
                };
              }
            }
          }
        }
        break;
      }

      case 'laterality_mismatch': {
        expectedDisposition = 'needs_information';
        expectedRequirementStatus = 'insufficient_evidence';

        if (cloned.scenarioCategory === 'knee_mri' && cloned.requestedService.laterality === 'right') {
          for (const entry of entries) {
            const r = entry.resource;
            if (r.resourceType === 'DiagnosticReport') {
              isApplicable = true;
              expectedFlippedRequirementId = 'req-plain-radiograph';
              explanation = 'Changed knee radiograph from right knee to left knee, creating laterality mismatch.';

              r.bodySite = 'Left knee joint';
              const codeObj = r.code as { coding?: Array<{ code?: string; display?: string }> } | undefined;
              if (Array.isArray(codeObj?.coding)) {
                for (const c of codeObj.coding) {
                  if (c.code === '73562' || c.code === '73560') {
                    c.display = 'Radiologic examination, knee; left';
                  }
                }
              }
              if (r.text && typeof r.text === 'object') {
                const t = r.text as { div?: string };
                if (typeof t.div === 'string') {
                  t.div = '<div>Left knee radiograph: Normal left knee views without fracture.</div>';
                }
              }
            }
          }
        }
        break;
      }
    }

    const isNoOp = JSON.stringify(cloned.patientBundle) === originalBundleJson;

    return {
      isApplicable: isApplicable && !isNoOp,
      isNoOp,
      mutatedCase: cloned,
      mutationType,
      expectedDisposition,
      expectedFlippedRequirementId,
      expectedRequirementStatus,
      explanation,
    };
  }
}
