import {
  type MedicalPolicy,
  type RequestedService,
  type AssessmentResult,
  type RetrievalResult,
  type ReviewPacket,
  type CriterionReviewRow,
  type ReviewPacketCitation,
  type NextAction,
  type GapKind,
  type Disposition,
  type ReviewPacketPurpose,
  type FhirBundleIndexer,
  canonicalJsonStringify,
  sha256Hex,
  ReviewPacketSchema,
} from '@openpa/core';

export interface BuildReviewPacketInput {
  scenarioId: string;
  patientId: string;
  policy: MedicalPolicy;
  requestedService: RequestedService;
  retrieval: RetrievalResult;
  assessment: AssessmentResult;
  indexer: FhirBundleIndexer;
  generatedAt?: string;
}

export function buildReviewPacket(input: BuildReviewPacketInput): ReviewPacket {
  const { scenarioId, patientId, policy, requestedService, retrieval, assessment, indexer } = input;
  const generatedAt = input.generatedAt ?? new Date().toISOString();

  // 1. Determine workflow disposition based on retrieval completeness & clinical assessment
  let workflowDisposition: Disposition = assessment.disposition;

  // Retrieval completeness gate: Incomplete retrieval cannot clear workflow definitively
  if (!retrieval.completeWithinScope || retrieval.stoppingReason !== 'completed') {
    workflowDisposition = 'requires_clinical_review';
  }

  // 2. Determine review packet purpose
  let purpose: ReviewPacketPurpose;
  if (workflowDisposition === 'requires_clinical_review') {
    purpose = 'clinical_review';
  } else if (workflowDisposition === 'needs_information') {
    purpose = 'documentation_follow_up';
  } else {
    purpose = 'assessment_summary';
  }

  // 3. Build criterion review rows in strict policy requirement order
  const criteria: CriterionReviewRow[] = [];
  const unresolvedItems: string[] = [];

  for (const req of policy.requirements) {
    const reqEval = assessment.requirements.find(r => r.requirementId === req.id);

    // If requirement was skipped after a prior clinical escalation / safety stop
    const wasEvaluated = assessment.executionTrace.some(step => step.requirementId === req.id);
    if (!reqEval || !wasEvaluated) {
      const nextAction: NextAction = {
        type: 'clinical_interpretation',
        description: `Evaluation of ${req.id} was deferred following safety stop; review complete clinical context.`,
        proposedRole: 'clinical_reviewer',
        targetRequirementId: req.id,
      };
      unresolvedItems.push(`${req.id}: Evaluation deferred due to clinical escalation`);
      criteria.push({
        requirementId: req.id,
        description: req.description,
        evaluationState: 'not_evaluated',
        status: reqEval?.status,
        confidence: reqEval?.confidence,
        gapKind: 'not_evaluated',
        nextAction,
        citations: [],
      });
      continue;
    }

    // Process citations
    const supportingCitations: ReviewPacketCitation[] = [];
    const conflictCitations: ReviewPacketCitation[] = [];

    for (const ev of reqEval.evidence) {
      const canonicalId = ev.resourceId.includes('/')
        ? ev.resourceId
        : `${ev.resourceType}/${ev.resourceId}`;
      const indexedRes = indexer.getResourceById(canonicalId);
      const provenanceRefs = retrieval.provenance[canonicalId];
      if (!indexedRes || !provenanceRefs?.length) throw new Error(`Unverified packet citation: ${canonicalId}`);
      const sourceId = provenanceRefs[0]?.sourceId ?? 'initial_submission';

      // Distinguish date from indexed resource or citation
      const clinicalDate = ev.date ?? indexedRes?.date ?? indexedRes?.period?.start;
      const textSnippet = ev.textSnippet ?? indexedRes?.textSnippet;

      // A contradiction is a requirement-level finding. Preserve all cited sides
      // as evidence to reconcile rather than guessing polarity from excerpt words.
      const isContradiction = Boolean(reqEval.contradictionDetected);

      const packetCitation: ReviewPacketCitation = {
        resourceType: ev.resourceType,
        resourceId: canonicalId,
        sourceId,
        date: clinicalDate,
        excerpt: textSnippet,
        provenance: provenanceRefs,
        contentHash: provenanceRefs[0]?.contentHash,
      };

      if (isContradiction) {
        conflictCitations.push(packetCitation);
      } else {
        supportingCitations.push(packetCitation);
      }
    }

    // Determine gap kind and next action
    let gapKind: GapKind;
    let nextAction: NextAction;

    if (reqEval.contradictionDetected) {
      gapKind = 'conflicting_evidence';
      nextAction = {
        type: 'reconcile_conflict',
        description: `Reconcile conflicting clinical documentation recorded for ${req.id} (${req.description}).`,
        proposedRole: 'clinical_reviewer',
        targetRequirementId: req.id,
      };
      unresolvedItems.push(`${req.id}: Contradictory clinical documentation detected`);
    } else if (reqEval.status === 'not_satisfied') {
      gapKind = 'documented_not_met';
      nextAction = {type: 'clinical_interpretation', description: `Review documented nonfulfillment of ${req.description}. Are there relevant exceptions?`, proposedRole: 'clinical_reviewer', targetRequirementId: req.id};
      unresolvedItems.push(`${req.id}: Documented clinical criteria not met`);
    } else if (retrieval.stoppingReason === 'source_unavailable') {
      if (reqEval.status === 'satisfied') {
        gapKind = 'none';
        nextAction = {
          type: 'none',
          description: 'Requirement satisfied by available records.',
          proposedRole: 'none',
          targetRequirementId: req.id,
        };
      } else {
        gapKind = 'source_unavailable';
        nextAction = {
          type: 'restore_source_access',
          description: `Required records for ${req.id} could not be retrieved because external source(s) were unavailable. Restore access or obtain outside documentation.`,
          proposedRole: 'integration_administrator',
          targetRequirementId: req.id,
        };
        unresolvedItems.push(`${req.id}: Source unavailable during retrieval`);
      }
    } else if (!retrieval.completeWithinScope) {
      if (reqEval.status === 'satisfied') {
        gapKind = 'none';
        nextAction = {
          type: 'none',
          description: 'Requirement satisfied by available records.',
          proposedRole: 'none',
          targetRequirementId: req.id,
        };
      } else {
        gapKind = 'search_incomplete';
        nextAction = {
          type: 'continue_search',
          description: `Search stopped (${retrieval.stoppingReason}) before completing review of available records for ${req.description}. Can the remaining search be completed?`,
          proposedRole: 'clinical_reviewer',
          targetRequirementId: req.id,
        };
        unresolvedItems.push(`${req.id}: Search budget exhausted before completion`);
      }
    } else if (reqEval.status === 'insufficient_evidence') {
      if (retrieval.scopeKind === 'initial_submission') {
        gapKind = 'not_found_in_searched_sources';
        nextAction = {
          type: 'request_documentation',
          description: `Please provide documentation for ${req.id} (${req.description}) not present in initial submission.`,
          proposedRole: 'ordering_provider',
          targetRequirementId: req.id,
        };
        unresolvedItems.push(`${req.id}: Evidence not found in submitted records`);
      } else if (retrieval.completeWithinScope) {
        gapKind = 'not_found_in_searched_sources';
        nextAction = {
          type: 'request_documentation',
          description: `Please provide documentation for ${req.id} (${req.description}) not found in configured sources.`,
          proposedRole: 'ordering_provider',
          targetRequirementId: req.id,
        };
        unresolvedItems.push(`${req.id}: Evidence not found in configured sources`);
      } else {
        gapKind = 'search_incomplete';
        nextAction = {
          type: 'continue_search',
          description: `Search across configured sources was incomplete for ${req.id}.`,
          proposedRole: 'clinical_reviewer',
          targetRequirementId: req.id,
        };
        unresolvedItems.push(`${req.id}: Search incomplete`);
      }
    } else if (reqEval.status === 'satisfied') {
      gapKind = 'none';
      nextAction = {
        type: 'none',
        description: 'Requirement satisfied.',
        proposedRole: 'none',
        targetRequirementId: req.id,
      };
    } else {
      // not_applicable
      gapKind = 'none';
      nextAction = {
        type: 'none',
        description: 'Requirement not applicable.',
        proposedRole: 'none',
        targetRequirementId: req.id,
      };
    }

    criteria.push({
      requirementId: req.id,
      description: req.description,
      evaluationState: 'evaluated',
      status: reqEval.status,
      confidence: reqEval.confidence,
      citations: supportingCitations,
      conflictCitations: conflictCitations.length > 0 ? conflictCitations : undefined,
      evaluatorNotes: reqEval.evaluatorNotes,
      gapKind,
      nextAction,
    });
  }

  // Combine integrity issues
  const integrityIssues = [...retrieval.integrityIssues, ...indexer.integrityIssues];

  // 4. Compute stable content fingerprint (excluding generatedAt and runtime timings)
  const fingerprintPayload = {
    schemaVersion: '1.0.0',
    scenarioId,
    patientId,
    policyId: policy.id,
    policyVersion: policy.version,
    requestedService,
    purpose,
    workflowDisposition,
    retrievalScope: {
      kind: retrieval.scopeKind,
      completeWithinScope: retrieval.completeWithinScope,
      stoppingReason: retrieval.stoppingReason,
      description: retrieval.scopeDescription,
    },
    criteria,
    unresolvedItems,
    integrityIssues,
  };

  const contentFingerprint = sha256Hex(canonicalJsonStringify(fingerprintPayload));

  return ReviewPacketSchema.parse({
    schemaVersion: '1.0.0',
    generatedAt,
    contentFingerprint,
    scenarioId,
    patientId,
    policyId: policy.id,
    policyVersion: policy.version,
    requestedService,
    purpose,
    workflowDisposition,
    retrievalScope: {
      kind: retrieval.scopeKind,
      completeWithinScope: retrieval.completeWithinScope,
      stoppingReason: retrieval.stoppingReason,
      description: retrieval.scopeDescription,
    },
    criteria,
    unresolvedItems,
    integrityIssues,
  });
}
