# Phase 2: FHIR Indexer & Deterministic Rule Engine

## Objectives
Build the high-performance FHIR R4 clinical data indexer and deterministic rule evaluator to establish the zero-cost Tier 1 baseline.

## Deliverables

### 1. FHIR Clinical Data Indexer
- Bundle normalization and fast resource lookup:
  - `Condition` indexer (active vs. resolved, ICD-10 and SNOMED code sets).
  - `Procedure` indexer (performed periods, CPT/HCPCS codes, body site).
  - `Encounter` indexer (visit types, temporal spans, clinical notes).
  - `Observation` indexer (vitals, lab results, clinical scores, LOINC mappings).
  - `MedicationRequest` / `MedicationStatement` indexer (active therapies, dosages, trial durations).
  - `DiagnosticReport` / `DocumentReference` indexer (imaging findings, narrative text extraction).

### 2. Temporal Window & Duration Calculation Engine
- Calculate elapsed durations between clinical dates (e.g., verifying whether physical therapy was documented across at least 6 distinct calendar weeks).
- Determine whether clinical findings fall within the policy's valid lookback window (e.g., within 90 days of requested service date).

### 3. Deterministic Policy Evaluator (Tier 1)
- Rule-based evaluation of structured criteria:
  - Exact code matching (ICD-10, CPT, LOINC).
  - Minimum therapy duration calculations.
  - Prerequisite procedure checks (e.g., plain X-ray prior to advanced imaging).
- Returns bounded status (`satisfied`, `not_satisfied`, or `insufficient_evidence` when clinical data is incomplete, or defers to next tier when narrative interpretation is required).
- Generates exact `EvidenceCitation` pointers linking to specific FHIR resource IDs.

### 4. Zero-Cost Offline Test Harness
- Vitest suite running against deterministic cases.
- Validates that simple cases resolve with 100% precision, $0.00 USD inference cost, and sub-10ms latency.

## Verification Gate
- Deterministic test cases pass in Vitest without network access or model credentials.
- Evidence citations point to valid resources in the synthetic bundles.
