# Phase 1: Foundations, Schemas & Benchmark Datasets

## Objectives
Establish the TypeScript monorepo workspace, strongly-typed Zod domain models, synthetic FHIR data seeding strategy from `synthetic_hospital`, and client-side sanitization.

## Deliverables

### 1. Monorepo Infrastructure
- `pnpm` workspaces layout:
  - `packages/core`: Domain models, Zod schemas, FHIR indexer, sanitization.
  - `packages/evaluators`: Rule evaluators, model adapters, tiered orchestrator.
  - `packages/eval-suite`: Metrics, counterfactual mutations, benchmark runner.
  - `packages/mcp-server`: Model Context Protocol server.
  - `apps/cli`: Developer CLI (`openpa eval`, `openpa benchmark`).
  - `apps/web`: React/Vite workbench UI.
- Strict TypeScript configuration (`tsconfig.base.json`, Node 22 LTS, ESM).

### 2. Core Domain Schemas (Zod)
- **`PriorAuthCase`**: Case ID, clinical scenario category, synthetic FHIR R4 Bundle, requested service, target policy reference, and ground-truth expectation.
- **`RequestedService`**: CPT/HCPCS code, narrative description, ICD-10 diagnosis codes, ordering clinician metadata.
- **`MedicalPolicy`**: Policy identifier, version, clinical narrative, service code matching, and structured `PolicyRequirement` items.
- **`PolicyRequirement`**: Requirement ID, description, required vs. optional flag, acceptable code sets, temporal time window in days.
- **`EvidenceCitation`**: Standard FHIR resource pointer (`resourceType`, `resourceId`, optional `jsonPath`, extracted text snippet, and recorded timestamp).
- **`StepTrace`**: Step index, tier name, model invoked, decision status, confidence score, token usage, cost, latency, and status.
- **`AssessmentResult`**: Case ID, final disposition (`meets_policy`, `needs_information`, `requires_clinical_review`), requirement-by-requirement evaluation array, missing information checklist, full step trace, and cost/latency rollups.

### 3. Benchmark Dataset Seeding (`synthetic_hospital`)
- Identify candidate longitudinal profiles from the physician-validated `synthetic_hospital` benchmark (Park et al., 2026):
  - Scenario 1: **Lumbar MRI** (CPT 72148) — Lumbar radiculopathy, conservative therapy trials.
  - Scenario 2: **Knee MRI** (CPT 73721) — Suspected meniscal tear, plain radiograph prerequisites.
  - Scenario 3: **Physical Therapy Extension** (CPT 97110) — Functional progress documentation.
  - Scenario 4: **Sleep Study / Polysomnography** (CPT 95810) — Epworth score, STOP-Bang criteria.
  - Scenario 5: **DME / Continuous Glucose Monitor** (HCPCS E2103) — Type 1 / insulin-requiring diabetes.
- Author 10 golden benchmark cases with curated ground-truth expectations.

### 4. Client-Side Sanitization & Redaction
- Pre-processing scrubber to redact simulated names, phone numbers, addresses, and extraneous metadata before payloads are forwarded to evaluators.

## Verification Gate
- All Zod schemas validate against sample synthetic payloads with zero type errors (`pnpm tsc --noEmit`).
- Golden cases load and parse into memory with 100% schema compliance.
