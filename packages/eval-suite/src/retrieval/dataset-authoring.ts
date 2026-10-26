import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScenarioFixture, GoldSidecar, ScenarioManifestEntry } from './types.js';

export interface AuthoringOutput {
  fixtures: ScenarioFixture[];
  goldSidecars: GoldSidecar[];
  manifest: ScenarioManifestEntry[];
}

export function generateAllFixtures(): AuthoringOutput {
  // Common Lumbar resources
  const patLmb = {
    resourceType: 'Patient',
    id: 'pat-lmb-01',
    gender: 'female',
    birthDate: '1980-04-12',
  };

  const condLmbRadic = {
    resourceType: 'Condition',
    id: 'cond-lmb-radic-01',
    subject: { reference: 'Patient/pat-lmb-01' },
    code: {
      coding: [
        {
          system: 'http://hl7.org/fhir/sid/icd-10-cm',
          code: 'M54.41',
          display: 'Lumbago with sciatica, right side',
        },
      ],
    },
    onsetDateTime: '2026-05-10',
    text: {
      status: 'generated',
      div: '<div>Patient diagnosed with right-sided lumbago with sciatica.</div>',
    },
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
        },
      ],
    },
  };

  const procLmbPtStart = {
    resourceType: 'Procedure',
    id: 'proc-lmb-pt-start',
    subject: { reference: 'Patient/pat-lmb-01' },
    status: 'completed',
    code: {
      coding: [
        {
          system: 'http://www.ama-assn.org/go/cpt',
          code: '97110',
          display: 'Therapeutic exercises',
        },
      ],
    },
    performedPeriod: { start: '2026-05-15', end: '2026-05-15' },
    note: [{ text: 'Initial physical therapy evaluation and lumbar stabilization exercise.' }],
  };

  const procLmbPtEnd = {
    resourceType: 'Procedure',
    id: 'proc-lmb-pt-end',
    subject: { reference: 'Patient/pat-lmb-01' },
    status: 'completed',
    code: {
      coding: [
        {
          system: 'http://www.ama-assn.org/go/cpt',
          code: '97110',
          display: 'Therapeutic exercises',
        },
      ],
    },
    performedPeriod: { start: '2026-07-15', end: '2026-07-15' },
    note: [
      {
        text: 'Week 8 PT session: Documented continuous weekly physical therapy throughout the course with prescribed home exercises. Patient continues to have persistent radicular pain.',
      },
    ],
  };

  const obsLmbBp = {
    resourceType: 'Observation',
    id: 'obs-lmb-bp-01',
    subject: { reference: 'Patient/pat-lmb-01' },
    status: 'final',
    code: {
      coding: [
        { system: 'http://loinc.org', code: '85354-9', display: 'Blood pressure panel' },
      ],
    },
    effectiveDateTime: '2026-06-01',
    text: { status: 'generated', div: '<div>Routine blood pressure 120/80 mmHg.</div>' },
  };

  const procLmbOlderPt = {
    resourceType: 'Procedure',
    id: 'proc-lmb-older-pt',
    subject: { reference: 'Patient/pat-lmb-01' },
    status: 'completed',
    code: {
      coding: [
        { system: 'http://www.ama-assn.org/go/cpt', code: '97110', display: 'Therapeutic exercises' },
      ],
    },
    performedPeriod: { start: '2023-01-10', end: '2023-01-10' },
    note: [{ text: 'Historical physical therapy session 3 years prior.' }],
  };

  const procLmbWrongPt = {
    resourceType: 'Procedure',
    id: 'proc-lmb-wrong-pt',
    subject: { reference: 'Patient/pat-wrong-999' },
    status: 'completed',
    code: {
      coding: [
        { system: 'http://www.ama-assn.org/go/cpt', code: '97110', display: 'Therapeutic exercises' },
      ],
    },
    performedPeriod: { start: '2026-06-15', end: '2026-06-15' },
    note: [{ text: 'Therapeutic exercises for unrelated patient.' }],
  };

  const docLmbContradict = {
    resourceType: 'DocumentReference',
    id: 'doc-lmb-contradict-01',
    subject: { reference: 'Patient/pat-lmb-01' },
    status: 'current',
    docStatus: 'final',
    type: {
      coding: [
        { system: 'http://loinc.org', code: '11506-3', display: 'Subsequent evaluation note' },
      ],
    },
    date: '2026-07-01',
    text: {
      status: 'generated',
      div: '<div>Physician encounter note: Patient denies radiculopathy and denies radicular symptoms; back pain is localized without radiating pain. Previous sciatica resolved.</div>',
    },
  };

  const lmbSources = (therapyAvailable = true) => [
    {
      id: 'src-lmb-primary',
      name: 'Metro Health Primary Care',
      supportedResourceTypes: ['Condition', 'Procedure', 'Observation'],
      availability: 'available' as const,
    },
    {
      id: 'src-lmb-therapy',
      name: 'Apex Physical Therapy & Rehab',
      supportedResourceTypes: ['Procedure', 'Observation', 'DocumentReference'],
      availability: (therapyAvailable ? 'available' : 'unavailable') as 'available' | 'unavailable',
    },
  ];

  const lmbRequestedService = {
    codeSystem: 'http://www.ama-assn.org/go/cpt',
    code: '72148',
    description: 'MRI lumbar spine without contrast',
    diagnosisCodes: ['M54.41'],
    bodySite: 'Lumbar spine',
  };

  // Common Knee resources
  const patKne = {
    resourceType: 'Patient',
    id: 'pat-kne-01',
    gender: 'male',
    birthDate: '1988-11-05',
  };

  const condKneTear = {
    resourceType: 'Condition',
    id: 'cond-kne-tear-01',
    subject: { reference: 'Patient/pat-kne-01' },
    bodySite: 'Right knee joint',
    code: {
      coding: [
        {
          system: 'http://hl7.org/fhir/sid/icd-10-cm',
          code: 'M23.21',
          display: 'Derangement of meniscus due to old tear or injury, right medial meniscus',
        },
      ],
    },
    onsetDateTime: '2026-06-01',
    text: {
      status: 'generated',
      div: '<div>Patient diagnosed with right knee medial meniscal derangement.</div>',
    },
    clinicalStatus: {
      coding: [
        {
          system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
          code: 'active',
        },
      ],
    },
  };

  const diagKneXray = {
    resourceType: 'DiagnosticReport',
    id: 'diag-kne-xray-01',
    subject: { reference: 'Patient/pat-kne-01' },
    status: 'final',
    bodySite: 'Right knee joint',
    code: {
      coding: [
        {
          system: 'http://www.ama-assn.org/go/cpt',
          code: '73562',
          display: 'Radiologic examination, knee; 3 views',
        },
      ],
    },
    effectiveDateTime: '2026-06-20',
    conclusion: '3-view right knee radiographs demonstrate preserved joint spaces without fracture or radiopaque loose bodies.',
    text: {
      status: 'generated',
      div: '<div>Normal 3-view knee radiograph. No acute fracture.</div>',
    },
  };

  const obsKneTemp = {
    resourceType: 'Observation',
    id: 'obs-kne-temp-01',
    subject: { reference: 'Patient/pat-kne-01' },
    status: 'final',
    code: {
      coding: [
        { system: 'http://loinc.org', code: '8310-5', display: 'Body temperature' },
      ],
    },
    effectiveDateTime: '2026-06-15',
    valueQuantity: { value: 98.6, unit: 'degF' },
    text: { status: 'generated', div: '<div>Body temperature 98.6 F.</div>' },
  };

  const diagKneOlderXray = {
    resourceType: 'DiagnosticReport',
    id: 'diag-kne-older-xray',
    subject: { reference: 'Patient/pat-kne-01' },
    status: 'final',
    bodySite: 'Right knee joint',
    code: {
      coding: [
        { system: 'http://www.ama-assn.org/go/cpt', code: '73562', display: 'Radiologic examination, knee; 3 views' },
      ],
    },
    effectiveDateTime: '2024-01-10',
    conclusion: 'Historical right knee radiograph from 2024.',
    text: { status: 'generated', div: '<div>Historical 3-view knee radiograph.</div>' },
  };

  const diagKneWrongPt = {
    resourceType: 'DiagnosticReport',
    id: 'diag-kne-wrong-pt',
    subject: { reference: 'Patient/pat-wrong-888' },
    status: 'final',
    code: {
      coding: [
        { system: 'http://www.ama-assn.org/go/cpt', code: '73562', display: 'Radiologic examination, knee; 3 views' },
      ],
    },
    effectiveDateTime: '2026-06-22',
    conclusion: 'X-ray for different patient.',
    text: { status: 'generated', div: '<div>Knee radiograph for wrong patient.</div>' },
  };

  const docKneContradict = {
    resourceType: 'DocumentReference',
    id: 'doc-kne-contradict-01',
    subject: { reference: 'Patient/pat-kne-01' },
    status: 'current',
    docStatus: 'final',
    type: {
      coding: [
        { system: 'http://loinc.org', code: '11506-3', display: 'Progress note' },
      ],
    },
    date: '2026-06-25',
    text: {
      status: 'generated',
      div: '<div>Orthopedic exam note: Patient denies knee instability and denies mechanical locking; examination demonstrates normal stability and joint derangement is absent.</div>',
    },
  };

  const kneSources = (imagingAvailable = true) => [
    {
      id: 'src-kne-primary',
      name: 'Metro Orthopedic Associates',
      supportedResourceTypes: ['Condition', 'DiagnosticReport', 'Observation'],
      availability: 'available' as const,
    },
    {
      id: 'src-kne-imaging',
      name: 'Valley Advanced Imaging Center',
      supportedResourceTypes: ['DiagnosticReport', 'Observation', 'DocumentReference'],
      availability: (imagingAvailable ? 'available' : 'unavailable') as 'available' | 'unavailable',
    },
  ];

  const kneRequestedService = {
    codeSystem: 'http://www.ama-assn.org/go/cpt',
    code: '73721',
    description: 'MRI knee joint without contrast',
    diagnosisCodes: ['M23.21'],
    laterality: 'right' as const,
    bodySite: 'Right knee joint',
  };

  const fixtures: ScenarioFixture[] = [
    // 1. scn-701: Lumbar Complete
    {
      scenarioId: 'scn-701',
      patientId: 'pat-lmb-01',
      policyId: 'policy-lumbar-mri-v1',
      requestedAt: '2026-07-20',
      requestedService: lmbRequestedService,
      sources: lmbSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: patLmb },
          { resource: condLmbRadic },
          { resource: procLmbPtStart },
          { resource: procLmbPtEnd },
          { resource: obsLmbBp },
        ],
      },
      sourceCorpus: {
        'src-lmb-therapy': [procLmbOlderPt, procLmbWrongPt],
      },
    },

    // 2. scn-702: Lumbar Scattered
    {
      scenarioId: 'scn-702',
      patientId: 'pat-lmb-01',
      policyId: 'policy-lumbar-mri-v1',
      requestedAt: '2026-07-20',
      requestedService: lmbRequestedService,
      sources: lmbSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patLmb }, { resource: condLmbRadic }, { resource: obsLmbBp }],
      },
      sourceCorpus: {
        'src-lmb-therapy': [procLmbPtStart, procLmbPtEnd, procLmbOlderPt, procLmbWrongPt],
      },
    },

    // 3. scn-703: Lumbar Missing
    {
      scenarioId: 'scn-703',
      patientId: 'pat-lmb-01',
      policyId: 'policy-lumbar-mri-v1',
      requestedAt: '2026-07-20',
      requestedService: lmbRequestedService,
      sources: lmbSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patLmb }, { resource: condLmbRadic }],
      },
      sourceCorpus: {
        'src-lmb-therapy': [procLmbPtStart, procLmbOlderPt, procLmbWrongPt],
      },
    },

    // 4. scn-704: Lumbar Contradictory
    {
      scenarioId: 'scn-704',
      patientId: 'pat-lmb-01',
      policyId: 'policy-lumbar-mri-v1',
      requestedAt: '2026-07-20',
      requestedService: lmbRequestedService,
      sources: lmbSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: patLmb },
          { resource: condLmbRadic },
          { resource: procLmbPtStart },
          { resource: procLmbPtEnd },
        ],
      },
      sourceCorpus: {
        'src-lmb-therapy': [docLmbContradict, procLmbOlderPt, procLmbWrongPt],
      },
    },

    // 5. scn-705: Lumbar Unavailable
    {
      scenarioId: 'scn-705',
      patientId: 'pat-lmb-01',
      policyId: 'policy-lumbar-mri-v1',
      requestedAt: '2026-07-20',
      requestedService: lmbRequestedService,
      sources: lmbSources(false),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patLmb }, { resource: condLmbRadic }, { resource: obsLmbBp }],
      },
      sourceCorpus: {
        'src-lmb-therapy': [procLmbPtStart, procLmbPtEnd, procLmbOlderPt, procLmbWrongPt],
      },
    },

    // 6. scn-706: Lumbar Budget Exhausted
    {
      scenarioId: 'scn-706',
      patientId: 'pat-lmb-01',
      policyId: 'policy-lumbar-mri-v1',
      requestedAt: '2026-07-20',
      requestedService: lmbRequestedService,
      sources: lmbSources(true),
      limits: { maxReads: 1 },
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patLmb }, { resource: condLmbRadic }, { resource: obsLmbBp }],
      },
      sourceCorpus: {
        'src-lmb-therapy': [procLmbOlderPt, procLmbPtStart, procLmbPtEnd, procLmbWrongPt],
      },
    },

    // 7. scn-707: Knee Complete
    {
      scenarioId: 'scn-707',
      patientId: 'pat-kne-01',
      policyId: 'policy-knee-mri-v1',
      requestedAt: '2026-07-04',
      requestedService: kneRequestedService,
      sources: kneSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [
          { resource: patKne },
          { resource: condKneTear },
          { resource: diagKneXray },
          { resource: obsKneTemp },
        ],
      },
      sourceCorpus: {
        'src-kne-imaging': [diagKneOlderXray, diagKneWrongPt],
      },
    },

    // 8. scn-708: Knee Scattered
    {
      scenarioId: 'scn-708',
      patientId: 'pat-kne-01',
      policyId: 'policy-knee-mri-v1',
      requestedAt: '2026-07-04',
      requestedService: kneRequestedService,
      sources: kneSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patKne }, { resource: condKneTear }, { resource: obsKneTemp }],
      },
      sourceCorpus: {
        'src-kne-imaging': [diagKneXray, diagKneOlderXray, diagKneWrongPt],
      },
    },

    // 9. scn-709: Knee Missing
    {
      scenarioId: 'scn-709',
      patientId: 'pat-kne-01',
      policyId: 'policy-knee-mri-v1',
      requestedAt: '2026-07-04',
      requestedService: kneRequestedService,
      sources: kneSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patKne }, { resource: condKneTear }],
      },
      sourceCorpus: {
        'src-kne-imaging': [diagKneOlderXray, diagKneWrongPt],
      },
    },

    // 10. scn-710: Knee Contradictory
    {
      scenarioId: 'scn-710',
      patientId: 'pat-kne-01',
      policyId: 'policy-knee-mri-v1',
      requestedAt: '2026-07-04',
      requestedService: kneRequestedService,
      sources: kneSources(true),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patKne }, { resource: condKneTear }, { resource: diagKneXray }],
      },
      sourceCorpus: {
        'src-kne-imaging': [docKneContradict, diagKneOlderXray, diagKneWrongPt],
      },
    },

    // 11. scn-711: Knee Unavailable
    {
      scenarioId: 'scn-711',
      patientId: 'pat-kne-01',
      policyId: 'policy-knee-mri-v1',
      requestedAt: '2026-07-04',
      requestedService: kneRequestedService,
      sources: kneSources(false),
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patKne }, { resource: condKneTear }, { resource: obsKneTemp }],
      },
      sourceCorpus: {
        'src-kne-imaging': [diagKneXray, diagKneOlderXray, diagKneWrongPt],
      },
    },

    // 12. scn-712: Knee Budget Exhausted
    {
      scenarioId: 'scn-712',
      patientId: 'pat-kne-01',
      policyId: 'policy-knee-mri-v1',
      requestedAt: '2026-07-04',
      requestedService: kneRequestedService,
      sources: kneSources(true),
      limits: { maxReads: 1 },
      initialBundle: {
        resourceType: 'Bundle',
        type: 'collection',
        entry: [{ resource: patKne }, { resource: condKneTear }, { resource: obsKneTemp }],
      },
      sourceCorpus: {
        'src-kne-imaging': [diagKneOlderXray, diagKneXray, diagKneWrongPt],
      },
    },
  ];

  // Build Gold Sidecars
  const goldSidecars: GoldSidecar[] = [
    // scn-701: Lumbar Complete
    {
      scenarioId: 'scn-701',
      family: 'lumbar_mri',
      variant: 'complete',
      derivationSource: 'case-lumbar-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'meets_policy',
        retrieval: 'meets_policy',
        fullCorpus: 'meets_policy',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-radiculopathy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-lmb-radic-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
          requiredPacketFacts: [{ field: 'onsetDateTime', expectedValue: '2026-05-10' }],
        },
        'req-conservative-therapy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Procedure/proc-lmb-pt-start', 'Procedure/proc-lmb-pt-end'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
      },
    },

    // scn-702: Lumbar Scattered
    {
      scenarioId: 'scn-702',
      family: 'lumbar_mri',
      variant: 'scattered',
      derivationSource: 'case-lumbar-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'meets_policy',
        fullCorpus: 'meets_policy',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-radiculopathy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-lmb-radic-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-conservative-therapy': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Procedure/proc-lmb-pt-start', 'Procedure/proc-lmb-pt-end'],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'none',
        },
      },
    },

    // scn-703: Lumbar Missing
    {
      scenarioId: 'scn-703',
      family: 'lumbar_mri',
      variant: 'missing',
      derivationSource: 'case-lumbar-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'needs_information',
        fullCorpus: 'needs_information',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-radiculopathy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-lmb-radic-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-conservative-therapy': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: [],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'not_found_in_searched_sources',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'request_documentation',
        },
      },
    },

    // scn-704: Lumbar Contradictory
    {
      scenarioId: 'scn-704',
      family: 'lumbar_mri',
      variant: 'contradictory',
      derivationSource: 'case-lumbar-003-conflicting',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'meets_policy',
        retrieval: 'requires_clinical_review',
        fullCorpus: 'requires_clinical_review',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-radiculopathy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: ['Condition/cond-lmb-radic-01'],
          mandatoryConflictResourceIds: ['DocumentReference/doc-lmb-contradict-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'conflicting_evidence',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'reconcile_conflict',
        },
        'req-conservative-therapy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: ['Procedure/proc-lmb-pt-start', 'Procedure/proc-lmb-pt-end'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
      },
    },

    // scn-705: Lumbar Unavailable
    {
      scenarioId: 'scn-705',
      family: 'lumbar_mri',
      variant: 'unavailable',
      derivationSource: 'case-lumbar-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'requires_clinical_review',
        fullCorpus: 'requires_clinical_review',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: false,
        fullCorpus: false,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'source_unavailable',
        fullCorpus: 'source_unavailable',
      },
      inaccessibleSources: ['src-lmb-therapy'],
      criteria: {
        'req-radiculopathy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-lmb-radic-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-conservative-therapy': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: [],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'source_unavailable',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'restore_source_access',
        },
      },
    },

    // scn-706: Lumbar Budget Exhausted
    {
      scenarioId: 'scn-706',
      family: 'lumbar_mri',
      variant: 'budget_exhausted',
      derivationSource: 'case-lumbar-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'requires_clinical_review',
        fullCorpus: 'meets_policy',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: false,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'budget_exhausted',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-radiculopathy': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-lmb-radic-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-conservative-therapy': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Procedure/proc-lmb-pt-start', 'Procedure/proc-lmb-pt-end'],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'search_incomplete',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'continue_search',
        },
      },
    },

    // scn-707: Knee Complete
    {
      scenarioId: 'scn-707',
      family: 'knee_mri',
      variant: 'complete',
      derivationSource: 'case-knee-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'meets_policy',
        retrieval: 'meets_policy',
        fullCorpus: 'meets_policy',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-knee-condition': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-kne-tear-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-plain-radiograph': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['DiagnosticReport/diag-kne-xray-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
      },
    },

    // scn-708: Knee Scattered
    {
      scenarioId: 'scn-708',
      family: 'knee_mri',
      variant: 'scattered',
      derivationSource: 'case-knee-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'meets_policy',
        fullCorpus: 'meets_policy',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-knee-condition': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-kne-tear-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-plain-radiograph': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['DiagnosticReport/diag-kne-xray-01'],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'none',
        },
      },
    },

    // scn-709: Knee Missing
    {
      scenarioId: 'scn-709',
      family: 'knee_mri',
      variant: 'missing',
      derivationSource: 'case-knee-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'needs_information',
        fullCorpus: 'needs_information',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-knee-condition': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-kne-tear-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-plain-radiograph': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: [],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'not_found_in_searched_sources',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'request_documentation',
        },
      },
    },

    // scn-710: Knee Contradictory
    {
      scenarioId: 'scn-710',
      family: 'knee_mri',
      variant: 'contradictory',
      derivationSource: 'case-knee-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'meets_policy',
        retrieval: 'requires_clinical_review',
        fullCorpus: 'requires_clinical_review',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: true,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'completed',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-knee-condition': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: ['Condition/cond-kne-tear-01'],
          mandatoryConflictResourceIds: ['DocumentReference/doc-kne-contradict-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'conflicting_evidence',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'reconcile_conflict',
        },
        'req-plain-radiograph': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: ['DiagnosticReport/diag-kne-xray-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
      },
    },

    // scn-711: Knee Unavailable
    {
      scenarioId: 'scn-711',
      family: 'knee_mri',
      variant: 'unavailable',
      derivationSource: 'case-knee-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'requires_clinical_review',
        fullCorpus: 'requires_clinical_review',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: false,
        fullCorpus: false,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'source_unavailable',
        fullCorpus: 'source_unavailable',
      },
      inaccessibleSources: ['src-kne-imaging'],
      criteria: {
        'req-knee-condition': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-kne-tear-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-plain-radiograph': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'insufficient_evidence',
          relevantResourceIds: [],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'source_unavailable',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'restore_source_access',
        },
      },
    },

    // scn-712: Knee Budget Exhausted
    {
      scenarioId: 'scn-712',
      family: 'knee_mri',
      variant: 'budget_exhausted',
      derivationSource: 'case-knee-001-meets',
      syntheticProvenance: 'openpa-phase6-v1:authored',
      goldReviewStatus: 'author_only',
      expectedDispositions: {
        submittedOnly: 'needs_information',
        retrieval: 'requires_clinical_review',
        fullCorpus: 'meets_policy',
      },
      expectedSearchCompleteness: {
        submittedOnly: true,
        retrieval: false,
        fullCorpus: true,
      },
      expectedStoppingReason: {
        submittedOnly: 'completed',
        retrieval: 'budget_exhausted',
        fullCorpus: 'completed',
      },
      criteria: {
        'req-knee-condition': {
          expectedStatusSubmitted: 'satisfied',
          expectedStatusRetrieval: 'satisfied',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['Condition/cond-kne-tear-01'],
          expectedGapKindSubmitted: 'none',
          expectedGapKindRetrieval: 'none',
          expectedNextActionTypeSubmitted: 'none',
          expectedNextActionTypeRetrieval: 'none',
        },
        'req-plain-radiograph': {
          expectedStatusSubmitted: 'insufficient_evidence',
          expectedStatusRetrieval: 'insufficient_evidence',
          expectedStatusFullCorpus: 'satisfied',
          relevantResourceIds: ['DiagnosticReport/diag-kne-xray-01'],
          expectedGapKindSubmitted: 'not_found_in_searched_sources',
          expectedGapKindRetrieval: 'search_incomplete',
          expectedNextActionTypeSubmitted: 'request_documentation',
          expectedNextActionTypeRetrieval: 'continue_search',
        },
      },
    },
  ];

  // Manifest for presentation / UI (separate from runtime input!)
  const manifest: ScenarioManifestEntry[] = [
    {
      scenarioId: 'scn-701',
      family: 'lumbar_mri',
      familyLabel: 'Lumbar Spine MRI (72148)',
      variant: 'complete',
      variantLabel: 'Complete submission',
      title: 'Lumbar Radiculopathy — Complete Initial Bundle',
      description: 'Initial bundle includes radiculopathy diagnosis and complete 8-week physical therapy course.',
      expectedBehavior: 'Rules meet policy; packet cites initial submission records.',
    },
    {
      scenarioId: 'scn-702',
      family: 'lumbar_mri',
      familyLabel: 'Lumbar Spine MRI (72148)',
      variant: 'scattered',
      variantLabel: 'Scattered evidence',
      title: 'Lumbar Radiculopathy — Scattered Records',
      description: 'Radiculopathy diagnosis in submission; physical therapy course stored at outside physical therapy clinic.',
      expectedBehavior: 'Submitted-only is deficient; retrieval recovers therapy evidence and matches complete outcome.',
    },
    {
      scenarioId: 'scn-703',
      family: 'lumbar_mri',
      familyLabel: 'Lumbar Spine MRI (72148)',
      variant: 'missing',
      variantLabel: 'Truly missing',
      title: 'Lumbar Radiculopathy — Missing Therapy Course',
      description: 'Patient received no 6-week conservative therapy completion; absent from all sources.',
      expectedBehavior: 'Search completes; packet identifies documented gap and requests therapy records.',
    },
    {
      scenarioId: 'scn-704',
      family: 'lumbar_mri',
      familyLabel: 'Lumbar Spine MRI (72148)',
      variant: 'contradictory',
      variantLabel: 'Contradictory evidence',
      title: 'Lumbar Radiculopathy — Conflicting Re-evaluation',
      description: 'Initial diagnosis present, but outside specialist encounter note documents absence of radicular symptoms.',
      expectedBehavior: 'Retrieval includes both records; clinical escalation preserves conflict and questions reviewer.',
    },
    {
      scenarioId: 'scn-705',
      family: 'lumbar_mri',
      familyLabel: 'Lumbar Spine MRI (72148)',
      variant: 'unavailable',
      variantLabel: 'Source unavailable',
      title: 'Lumbar Radiculopathy — Unavailable Outside Source',
      description: 'Scattered therapy records exist at Apex Physical Therapy, but the clinic source is unavailable.',
      expectedBehavior: 'Search incomplete; clinical escalation; system never claims documentation is absent.',
    },
    {
      scenarioId: 'scn-706',
      family: 'lumbar_mri',
      familyLabel: 'Lumbar Spine MRI (72148)',
      variant: 'budget_exhausted',
      variantLabel: 'Search budget exhausted',
      title: 'Lumbar Radiculopathy — Budget Limit Reached',
      description: 'Scattered therapy records exist, but query budget ceiling prevents completing all reads.',
      expectedBehavior: 'Search incomplete with explicit stopping reason; clinical review without definitive clearance.',
    },
    {
      scenarioId: 'scn-707',
      family: 'knee_mri',
      familyLabel: 'Knee MRI (73721)',
      variant: 'complete',
      variantLabel: 'Complete submission',
      title: 'Knee Meniscal Derangement — Complete Initial Bundle',
      description: 'Initial bundle includes meniscal tear diagnosis and recent 3-view knee radiograph.',
      expectedBehavior: 'Rules meet policy; packet cites initial submission records.',
    },
    {
      scenarioId: 'scn-708',
      family: 'knee_mri',
      familyLabel: 'Knee MRI (73721)',
      variant: 'scattered',
      variantLabel: 'Scattered evidence',
      title: 'Knee Meniscal Derangement — Scattered Radiograph',
      description: 'Meniscal tear diagnosis in submission; recent radiograph stored at outside imaging center.',
      expectedBehavior: 'Submitted-only is deficient; retrieval recovers X-ray and matches complete outcome.',
    },
    {
      scenarioId: 'scn-709',
      family: 'knee_mri',
      familyLabel: 'Knee MRI (73721)',
      variant: 'missing',
      variantLabel: 'Truly missing',
      title: 'Knee Meniscal Derangement — Missing Radiograph',
      description: 'No plain radiograph completed within 90 days across submission or outside imaging source.',
      expectedBehavior: 'Search completes; packet identifies documented gap and requests radiograph.',
    },
    {
      scenarioId: 'scn-710',
      family: 'knee_mri',
      familyLabel: 'Knee MRI (73721)',
      variant: 'contradictory',
      variantLabel: 'Contradictory evidence',
      title: 'Knee Meniscal Derangement — Conflicting Orthopedic Note',
      description: 'Initial diagnosis present, but outside note documents patient denies knee instability or locking.',
      expectedBehavior: 'Retrieval includes both records; clinical escalation preserves conflict for review.',
    },
    {
      scenarioId: 'scn-711',
      family: 'knee_mri',
      familyLabel: 'Knee MRI (73721)',
      variant: 'unavailable',
      variantLabel: 'Source unavailable',
      title: 'Knee Meniscal Derangement — Unavailable Imaging Center',
      description: 'Scattered radiograph exists at Valley Advanced Imaging, but the imaging source is offline.',
      expectedBehavior: 'Search incomplete; clinical escalation; system never claims radiograph is absent.',
    },
    {
      scenarioId: 'scn-712',
      family: 'knee_mri',
      familyLabel: 'Knee MRI (73721)',
      variant: 'budget_exhausted',
      variantLabel: 'Search budget exhausted',
      title: 'Knee Meniscal Derangement — Budget Limit Reached',
      description: 'Scattered radiograph exists, but query read limit halts search before completion.',
      expectedBehavior: 'Search incomplete with explicit stopping reason; clinical review without definitive clearance.',
    },
  ];

  return { fixtures, goldSidecars, manifest };
}

export function writeDatasetsToDisk(rootDir: string): void {
  const { fixtures, goldSidecars, manifest } = generateAllFixtures();

  const casesDir = join(rootDir, 'datasets/retrieval/cases');
  const goldDir = join(rootDir, 'datasets/retrieval/gold');

  mkdirSync(casesDir, { recursive: true });
  mkdirSync(goldDir, { recursive: true });

  for (const fixture of fixtures) {
    const casePath = join(casesDir, `${fixture.scenarioId}.json`);
    writeFileSync(casePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  }

  for (const gold of goldSidecars) {
    const goldPath = join(goldDir, `${gold.scenarioId}.gold.json`);
    writeFileSync(goldPath, JSON.stringify(gold, null, 2) + '\n', 'utf8');
  }

  const manifestPath = join(rootDir, 'datasets/retrieval/manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
}
