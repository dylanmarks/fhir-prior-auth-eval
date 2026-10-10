# Phase 5: MCP Server & Interactive Workbench UI

## Objectives
Expose the evaluation environment through Model Context Protocol (MCP), build the lightweight React/Vite interactive workbench, and produce demo and documentation artifacts.

## Deliverables

### 1. Model Context Protocol (MCP) Server
- Expose the evaluation workbench over stdio and SSE transport using the `@modelcontextprotocol/sdk`.
- Tools:
  - `list_cases(category?)`: Returns available synthetic test cases with scenario tags.
  - `get_case_detail(caseId)`: Returns full FHIR bundle, requested service, and policy.
  - `evaluate_case(caseId, strategy, budgetMaxUsd?)`: Evaluates case across specified strategy (rules, jev, llm, tiered) with budget limit.
  - `inspect_evidence(caseId, requirementId)`: Extracts normalized clinical evidence for a given requirement.
  - `run_counterfactual_test(caseId, mutationType)`: Applies an adversarial mutation and tests sensitivity.
  - `run_benchmark(datasetId, models)`: Runs batch benchmark and returns summary metrics.

### 2. Interactive Workbench UI (React + Vite)
- Lightweight frontend built with React 19, Vite, Tailwind CSS, Lucide Icons, and Recharts.
- Key views:
  - **Case Explorer:** Patient demographic header, chronological FHIR timeline (Encounters, Conditions, Procedures, Labs, Meds).
  - **Policy Checklist:** Side-by-side policy requirements with live evidence tags.
  - **Real-Time Streaming Trace:** Live Server-Sent Events (SSE) feed visualizing the cascade as it moves from Tier 1 (Rules) to Tier 2 (Jev) to Tier 3/4 (LLMs) with latency and token metrics.
  - **Evidence Provenance Drawer:** Inspect the exact FHIR resource snippet supporting each decision.
  - **Benchmark Visualizer:** Interactive scatter plot comparing model accuracy vs. inference cost per case.

### 3. Open Source Documentation & Demo Assets
- **5-Minute Architecture README:** High-signal diagrams showing the tiered inference cascade, benchmark results table, and quickstart commands.
- **60-Second Demo Recording:** Walkthrough demonstrating an evaluation run, a counterfactual mutation flip, and the cost difference between frontier inference vs. tiered architecture.

## Verification Gate
- Claude Desktop / Cursor connects to local MCP server and successfully executes `evaluate_case` on a synthetic bundle.
- Workbench UI loads without errors, renders synthetic patient timeline, and streams evaluation results.
