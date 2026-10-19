# OpenPA Eval

**How much reasoning does prior authorization actually need?**

A TypeScript evaluation workbench and **Model Context Protocol (MCP) server** for exploring that question with synthetic FHIR R4 records. Compare deterministic rules, typed model decisions, and generative models; inspect the evidence behind each result; and measure when the system should defer to a clinician.

> **Status: public research prototype.** Offline fixtures and automated regression checks are included. Live provider behavior and the proposed cost/quality advantage have not been validated. Clinical validation is still ahead. The default demo runs locally without credentials.

**[Watch the walkthrough on YouTube](https://youtu.be/Xz5sfbvqN6c)**: what prior authorization is, how the cascade works, and a first live run on 22 synthetic cases.

## Screenshots

**Model comparison:** compare safe coverage, risk, abstentions, and cost across strategies using the offline baseline.

![Model comparison showing the offline baseline across four evaluation strategies](docs/screenshots/model-comparison.png)

**Interactive workbench:** inspect synthetic FHIR evidence, policy requirements, and the clinical-review outcome after injecting clinical negation.

![Interactive workbench showing a clinical negation counterfactual routed to clinical review](docs/screenshots/interactive-workbench.png)

## Why I built this

Prior authorization brings together two very different kinds of work. Some requirements are mechanical: match a diagnosis code, check the date of an examination, or confirm that therapy lasted long enough. Others require interpreting narrative evidence: did function improve, is a finding historical, or do the records contradict each other?

Using a frontier model for every requirement makes it harder to tell which reasoning was necessary and what the extra inference bought. Using rules alone leaves narrative questions unresolved. I built OpenPA Eval to make that tradeoff visible: **use code where the answer is explicit, spend model reasoning on the remaining ambiguity, and preserve a path to human review.**

The engineering question is broader than healthcare: how do you evaluate a system that can answer, escalate, or abstain? Accuracy alone misses both the cost of unnecessary escalation and the harm of a confident but unsupported answer. This project measures coverage, error among resolved cases, evidence grounding, and cost together.

The central hypothesis is measurable: **a rules → Jev → small LLM → frontier cascade should increase safe resolution coverage over rules alone, at lower cost than a frontier-only baseline, without increasing confidently wrong resolutions.** This repository supplies the experiment infrastructure; it does not yet establish that the hypothesis holds. Jev is the typed decision tier, where models select defined outcomes and evidence relationships rather than generate an unconstrained answer.

## What a reviewer can explore

- **Model comparison:** paired strategies, confidence thresholds, safe coverage, selective risk, abstentions, false clearances, cost per safe resolution, tier usage, and uncertainty intervals.
- **Evidence workbench:** inspect a synthetic FHIR timeline, evaluate a policy criterion, follow citations to raw resources, and review every tier's decision.
- **Counterfactual tests:** shorten therapy, change an indicated diagnosis, age evidence, inject negation, flip laterality, or remove the sole supporting resource (`remove_supporting_evidence`).
- **Regression harness:** preserve labeled cases and model judgments, fingerprint inputs and protocol, and compare a new model snapshot against a baseline.

```mermaid
flowchart LR
  A[Synthetic FHIR + criterion] --> V[Integrity and patient checks]
  V --> R[Rules]
  R -->|unresolved| J[Jev typed decisions]
  J -->|below threshold| S[Small generative model]
  S -->|below threshold| F[Frontier model]
  R --> G[Citation verification]
  J --> G
  S --> G
  F --> G
  G -->|accepted| O[Evidence assessment]
  G -->|conflict or invalid citation| H[Clinical review]
  F -->|unresolved or provider failure| H
```

Contradictions and invalid citations stop the cascade. Low confidence continues to the next tier. Missing documentation produces `needs_information`; unresolved uncertainty produces `requires_clinical_review`. This is an evidence assessment, not payer authorization or autonomous denial.

## Quickstart

Use Node 22 LTS and npm. Run each command individually:

```bash
git clone https://github.com/dylanmarks/fhir-prior-auth-eval.git
```

```bash
cd fhir-prior-auth-eval
```

```bash
npm ci
```

```bash
npm run benchmark
```

```bash
npm run build
```

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run dev
```

Open the URL printed by Vite, normally [localhost:5173](http://localhost:5173). The default experience is offline and requires no credentials. The web build uses the latest generated structured report when present, otherwise the checked-in baseline snapshot. Run the benchmark before building to refresh the displayed report.

For a short tour, open **Model comparison** to inspect risk and coverage, then switch to the evidence workbench. Evaluate a structured case with **Rules**, open a citation to inspect its FHIR resource, and apply a laterality or therapy-duration mutation to see whether the result changes. Narrative cases expose the boundary of the offline rules: model tiers abstain until live providers are configured. The `simulation` strategy is a UI demonstration, not a measured model result.

## Architecture

The browser, CLI, and MCP server share the same evaluation packages. That keeps evidence checks and routing behavior consistent across interfaces.

| Component | Responsibility |
| --- | --- |
| [`packages/core`](packages/core) | Typed case, policy, assessment, and trace schemas; patient-scoped FHIR indexing; clinical dates and resource provenance |
| [`packages/evaluators`](packages/evaluators) | Rules, typed Jev decisions, generative adapters, citation checks, and escalation under confidence, token, time, and cost limits |
| [`packages/eval-suite`](packages/eval-suite) | Benchmarks, counterfactual mutations, paired experiments, uncertainty intervals, and regression gates |
| [`packages/mcp-server`](packages/mcp-server) | Six stdio tools that expose the same cases and evaluators to an MCP client |
| [`apps/web`](apps/web) | React/Vite workbench for model comparison, evidence inspection, and execution traces |
| [`apps/server`](apps/server) | Local live-evaluation and provider connection endpoints; credentials stay outside the browser bundle |

Built with TypeScript, React, Vite, Zod, Vitest, and the MCP SDK. The fixtures use FHIR R4 resource shapes; the assessment and policy schemas are project-specific.

## Dataset and honest baseline

| Cohort | Cases | Purpose |
| --- | ---: | --- |
| Structured | 10 | Codes, dates, therapy documentation, laterality, medication status, numeric thresholds, and contradictions across five scenarios |
| Narrative development | 4 | Prompt and threshold development: progress, missing evidence, plateau, conflict |
| Narrative challenge | 8 | Paraphrases, negation scope, historical evidence, unsupported recommendations, ambiguity, conflicting measurements, prompt injection, distractors |

All cases and policies are hand-authored synthetic research fixtures. The challenge cohort is frozen separately from development, but is not independently validated or a clinically representative test set. The policies simplify coverage logic and are not authoritative payer policies.

The structured baseline matches all ten expected dispositions and **15/15 applicable mutation flips** across six vectors. The evidence-removal probe applies to **5/22 cases** (the complete CGM, knee MRI, lumbar MRI, PT extension, and sleep-study fixtures); the other 17 have deficient or unresolved rules baselines. Rules preserve uncertainty in **5/5 (100%)**, with a **95% Wilson interval of 56.6–100%**, and zero confident “not met” answers at each threshold. Model tiers remain unconfigured offline; these probes are hand-authored synthetic tests. Across the expanded 22 cases, the offline rules baseline safely resolves **9/22 (40.9%)** and abstains on **13/22 (59.1%)**. It does not resolve the narrative cases. No live Jev or generative performance has been measured. That gap is the experiment's purpose.

Zero observed unsafe resolutions among nine resolutions still gives a roughly **30% upper bound** in a 95% Wilson interval. The workbench shows uncertainty instead of treating a small perfect score as proof of reliability.

## Run a paired experiment

Offline:

```bash
npm run experiment
```

The runner compares four arms at thresholds 0.70, 0.90, and 0.99:

1. Rules only.
2. Rules + Jev.
3. Rules + Jev + small model + frontier model.
4. Frontier generative baseline.

For each input and model, it records a judgment once and replays routing policies across thresholds. Reported policy cost/latency reflects the calls that policy would use; **actual acquisition spend** is tracked separately. The report includes raw normalized judgments, case assessments, resolved provider model IDs, and input/protocol/adapter fingerprints. Provider randomness is not removed by caching; repeated independent acquisitions are needed to assess variability.

Definitions:

- **Automation coverage:** fraction of cases not sent to clinical review.
- **Safe resolution coverage:** fraction of all cases resolved with the correct disposition, every requirement correct, grounded satisfied claims, and verified usage.
- **Selective risk:** unsafe resolutions divided by all resolved cases; undefined if none resolve.
- **False clearance:** `meets_policy` when the full safe-resolution criterion fails.
- **Uncertainty preserved:** on applicable evidence-removal probes, the fraction of a tier's targeted judgments that return `insufficient_evidence` or explicitly defer/abstain (including confidence below the threshold). Reported per tier and threshold with 95% Wilson intervals and confident `not_satisfied` counts. Provider failures receive no credit; confident `satisfied` answers fail the evidence safety gate even if a guardrail escalates them.
- **Cost per safe resolution:** total policy spend divided by safe resolutions; undefined when none resolve or billing is unknown.

Citation authenticity is not semantic entailment. A real citation can still be interpreted incorrectly; labeled requirement accuracy and the false-clearance metric detect that distinction. Reliability bins describe routing score versus case-level safe resolution, not clinically calibrated probabilities.

## Configure live models

**Optional ChatGPT frontier provider:** eligible users can connect their ChatGPT plan, choose a model and reasoning effort, and run the frontier baseline without an API key. Start the local evaluator and use **Frontier model provider → ChatGPT · use your plan**. See [connection and model-comparison instructions](docs/CHATGPT_PROVIDER.md). Plan allowance/credits are tracked separately from API dollar spend. Jev and the small-model tiers still use their own provider configuration.

Copy [.env.example](.env.example) to `.env`. Supply your OpenRouter key, explicit model IDs for Jev/small/frontier, and current input/output prices. No secrets belong in `VITE_*` variables. A regular OpenRouter key supports Jev's typed Decisions endpoint; see the [official Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request).

The Jev adapter uses typed outcome and per-record evidence choices. Code creates resource pointers from the supplied records. The generative adapters use Chat Completions with validated JSON. Both receive patient-scoped context without expected labels, case titles, or gold answers. Arithmetic, code matching, and clinical date eligibility remain in code.

Run a paid comparison explicitly:

```bash
npm run experiment -- --live --max-spend 2 --output results/live-baseline.json
```

Then start the local evaluator in a separate terminal:

```bash
npm run serve
```

The server listens on loopback port 8787 and accepts only bundled case IDs, never arbitrary patient uploads. In the workbench, check providers and choose **Local evaluator — live providers**. The model comparison tab can load the latest report from `results/experiment-report.json`; use that output path for an experiment you want displayed there.

Costs are conservative admission estimates, not contractual billing guarantees. Generative retries reserve all attempts; actual usage is accumulated on failure. Timeout or missing usage marks spend unverified, halts acceptance, and prevents reporting a misleading cost per safe resolution. Jev's Decisions API does not expose the same output-token cap as Chat Completions, so usage above the reservation is rejected after the call and may still be billed.

## Track model upgrades

Keep the same dataset and protocol, change the configured model IDs, and run:

```bash
npm run experiment -- --live --max-spend 2 --baseline results/live-baseline.json --output results/live-candidate.json
```

The comparison rejects mismatched dataset/protocol fingerprints and missing arms. It fails on cohort safety, coverage, accuracy, uncertainty-preserved, and >10% cost regressions; false clearances, unsupported citations, and confident satisfaction after evidence removal also trigger an absolute safety gate. CI compares the offline snapshot and runs evidence/provider/threshold regression tests. Offline reports default to `results/offline-experiment.json`, preserving the live report. Live evaluation remains an explicit run to avoid accidental spend.

Choose thresholds on development cases, then freeze them before reviewing challenge results. Increasing abstention can hide accuracy problems, so inspect risk and coverage together. Expand and independently review the case labels before drawing healthcare reliability conclusions.

## Why MCP is part of the project

The visual workbench makes decisions inspectable by a person. **MCP makes the same evaluation capabilities available as structured tools inside an assistant workflow.** An MCP client can discover a case, inspect its records and policy, request an assessment, and run a counterfactual without rebuilding the evaluation logic or relying on a screenshot of the UI.

This is also a useful boundary between conversation and evidence: the assistant requests an operation, while the server runs the shared evaluators and returns structured results with requirement-level evidence and traces. The tool surface operates on the bundled synthetic catalogue. It is not connected to an EHR or a payer.

Build first, then configure a stdio client:

```json
{
  "mcpServers": {
    "openpa": {
      "command": "node",
      "args": ["/absolute/path/fhir-prior-auth-eval/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Replace the absolute path with your checkout path. The example uses the offline default and needs no API key.

| Tool | What it exposes |
| --- | --- |
| `list_cases` | Discover the 22 synthetic cases, with optional scenario filtering |
| `get_case_detail` | Retrieve a case's FHIR bundle, requested service, and matching policy |
| `evaluate_case` | Run a selected strategy and return an evidence assessment and execution trace |
| `inspect_evidence` | Inspect candidate records for a requirement and why the deterministic evaluator accepts or rejects them |
| `run_counterfactual_test` | Perturb the evidence and compare the result with the expected disposition |
| `run_benchmark` | Run the ten-case structured rules baseline |

Example request to an assistant connected to this server:

> List the lumbar MRI cases. Evaluate one with the rules strategy, inspect the evidence for a satisfied requirement, then run a therapy-duration counterfactual and explain what changed using the returned citations.

`evaluate_case` defaults offline. Pass `live: true` explicitly and provide environment configuration to the MCP process for paid tiers; the plain `node` launch above does not load `.env` automatically. Catalogue/detail tools expose fixture labels for inspection, so assistant explanations are demonstrations, not blinded benchmark results. The evaluation adapters exclude gold labels from provider context. Cited failure evidence is distinguished from accepted supporting evidence.

## Scope and next research milestones

The assessment schema is custom JSON over synthetic FHIR R4. It does not implement a Da Vinci PAS transaction, EHR integration, or payer workflow. The demonstration scrubber is not a de-identification system for real PHI.

Next: acquire the live paired baseline, independently review and expand challenge labels, measure model variability across repeated acquisitions, test external datasets, and quantify how risk/coverage changes by clinical scenario. A cheap-first architecture is viable only if those measurements support it.

A [recorded walkthrough](https://youtu.be/Xz5sfbvqN6c) is on YouTube. The [written walkthrough](docs/WALKTHROUGH.md) describes the evidence and comparison flows.

## Contributing

Useful contributions include adversarial synthetic cases, independently reviewed labels, provider contract fixes, and reproducible experiment reports. Open an issue with the case or requirement ID, strategy, expected behavior, and observed trace. Keep patient data and credentials out of issues and pull requests. Run the build, tests, typecheck, benchmark, and offline comparison before submitting changes:

```bash
npm run experiment -- --baseline datasets/offline-experiment.json
```

See [research protocol](docs/RESEARCH_PROTOCOL.md), [walkthrough](docs/WALKTHROUGH.md), and [implementation notes](docs/IMPLEMENTATION.md).

## License

[MIT](LICENSE). You may reuse, modify, and distribute the project, including commercially, while retaining the license and copyright notice. Third-party services and dependencies retain their own terms and licenses.
