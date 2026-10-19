# @openpa/mcp-server

Model Context Protocol (MCP) server for prior authorization evaluation. It exposes synthetic FHIR R4 clinical records, medical coverage policies, and tiered evaluation strategies as structured tools for LLM agent workflows.

---

## Configuration

Add the server to your MCP client config (`claude_desktop_config.json`, Cursor, Zed, etc.):

```json
{
  "mcpServers": {
    "openpa-eval": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/fhir-prior-auth-eval/packages/mcp-server/dist/index.js"
      ],
      "env": {
        "OPENROUTER_API_KEY": "sk-or-v1-..."
      }
    }
  }
}
```

> **Note:** Replace `/ABSOLUTE/PATH/TO/...` with your local repository path. Run `npm run build` once prior to starting the MCP server.

---

## Available Tools

### 1. `list_cases`
Discover synthetic benchmark cases with clinical categories and ground-truth tags.

* **Parameters:**
  * `category` *(string, optional)*: Filter by scenario (`lumbar_mri`, `knee_mri`, `pt_extension`, `sleep_study`, `dme`, `other`).
* **Example Usage:**
  ```json
  { "category": "pt_extension" }
  ```

---

### 2. `get_case_detail`
Retrieve the full FHIR R4 patient bundle, requested service details (CPT/HCPCS), and corresponding coverage policy.

* **Parameters:**
  * `caseId` *(string, required)*: Unique case identifier (e.g., `case-pt-001-meets`, `case-lumbar-001-meets`).
* **Example Usage:**
  ```json
  { "caseId": "case-pt-001-meets" }
  ```

---

### 3. `evaluate_case`
Evaluate a case across deterministic rules, typed model decisions, or frontier models.

* **Parameters:**
  * `caseId` *(string, required)*: The case ID to evaluate.
  * `strategy` *(string, optional)*: Evaluation strategy (`rules`, `cheap`, `tiered`, `llm`, `simulation`). Defaults to `rules`.
  * `live` *(boolean, optional)*: Explicitly enable configured live external providers. Defaults to `false` (offline mode, no network/API calls).
  * `budgetCapUsd` *(number, optional)*: Execution safety budget in USD.
* **Example Usage:**
  ```json
  {
    "caseId": "case-pt-001-meets",
    "strategy": "tiered",
    "live": true
  }
  ```
* **Returns:**
  * `disposition`: `meets_policy` | `needs_information` | `requires_clinical_review`
  * `requirements`: Requirement-by-requirement status and evidence citations.
  * `executionTrace`: Step-by-step latency, tier level, confidence, model certainty, and costs.

---

### 4. `inspect_evidence`
Extract and inspect normalized clinical evidence from the FHIR bundle supporting a specific policy requirement, distinguishing candidate vs. accepted evidence and lookback validation.

* **Parameters:**
  * `caseId` *(string, required)*: The case ID.
  * `requirementId` *(string, required)*: Policy requirement ID (e.g., `req-pt-progress`, `req-radiculopathy`).
* **Example Usage:**
  ```json
  {
    "caseId": "case-pt-001-meets",
    "requirementId": "req-pt-progress"
  }
  ```

---

### 5. `run_counterfactual_test`
Apply an adversarial perturbation vector to test if the decision correctly flips away from approval.

* **Parameters:**
  * `caseId` *(string, required)*: Baseline case ID.
  * `mutationType` *(string, required)*: Perturbation vector:
    * `clinical_negation`: Injects contradictory clinical narrative or symptom resolution notes.
    * `shorten_therapy_duration`: Compresses therapy duration below policy minimum.
    * `diagnosis_non_indicated`: Substitutes primary diagnosis with non-covered condition.
    * `temporal_expiry`: Shifts prerequisite reports/evaluations beyond lookback window.
    * `laterality_mismatch`: Changes body site/laterality to create anatomical mismatch.
* **Example Usage:**
  ```json
  {
    "caseId": "case-pt-001-meets",
    "mutationType": "clinical_negation"
  }
  ```

---

### 6. `run_benchmark`
Run batch evaluation across all benchmark cases and return aggregate safety, coverage, and cost KPI rollups.

* **Parameters:** None.
* **Example Usage:**
  ```json
  {}
  ```

---

## Example Assistant Prompt

Connect an MCP-compatible assistant (e.g. Claude Desktop or Cursor) to this server and try:

> *"List all PT extension cases. Evaluate case-pt-001-meets using the tiered strategy and show me the execution trace. Then apply a clinical negation mutation to see if Tier 2 detects the conflict and routes it to physician review."*
