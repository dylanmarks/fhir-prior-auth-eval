# App review — October 6, 2026

Historical review of the pre-improvement app. The October 7 implementation addresses these findings; see [current implementation notes](../IMPLEMENTATION.md), [research protocol](../RESEARCH_PROTOCOL.md), and the repository README for current behavior.

## Assessment

The app is a working synthetic prior-authorization evaluation workbench with a deterministic benchmark, traceable citations, counterfactual mutations, and a tested stdio MCP interface. It is suitable for a clearly scoped demonstration. The next milestone should be stronger evidence semantics and reproducible held-out evaluation, followed by live provider integration.

The 100% score measures ten hand-authored fixtures and nine applicable mutation vectors. It does not establish clinical accuracy, model calibration, performance on unseen records, or the research hypothesis that inexpensive tiers resolve most real requests. All ten bundled cases resolve at Tier 1, so neither the offline tiered results nor the rules benchmark measures Jev or generative model quality.

## Verification performed

- `npm test`: 42/42 tests passed across five suites, including the MCP stdio test.
- `npm run typecheck`: passed across five workspaces.
- `npm run build`: passed across five workspaces.
- Benchmark entry point: 10/10 disposition matches, 100% requirement accuracy, zero unsupported citations, 9/9 applicable mutations, $0 inference, mean latency 2 ms; CI evaluation gate passed.
- `npm run benchmark` encountered a sandbox IPC permission error. Running the same entry point with `node --import tsx packages/eval-suite/src/cli.ts` succeeded. This was an environment restriction, not a benchmark failure.
- Browser: all ten cases evaluated under both `rules` and offline `tiered`, with expected dispositions. Lumbar therapy-shortening and clinical-negation mutations behaved as expected. Citation inspector opened both snippet and raw JSON views. Benchmark tab loaded the refreshed report. No browser warning/error messages were observed during those checks.
- Reviewed core schemas/indexing/date handling/sanitization, rules/cascade/grounding/LLM adapters, benchmark/scoring/mutations, web controls and benchmark display, MCP handlers, CI and documentation.
- Additional executable probes reproduced six false `meets_policy` results and two LLM accounting/control failures. Run `node docs/review-2026-10-06/reproduce.mjs` after building. Provider calls are replaced with local responses; no credentials or paid API calls are used.

No application implementation was changed. Generated benchmark reports were refreshed. Review and walkthrough files were added. No deployment or real clinical data integration was assessed.

## Findings, in priority order

### 1. P1 — PT progress is asserted from the presence of a re-evaluation code

`packages/evaluators/src/deterministic/rules-evaluator.ts:407–425`

The `97164` branch checks for a handful of plateau phrases, then declares measurable progress whenever they are absent. Removing both the narrative and notes from the positive PT case still yields `meets_policy`, with a claim that progress was documented. A re-evaluation procedure establishes that an evaluation happened, not that functional goals improved.

Require positive, attributable progress evidence or defer. Test empty notes, unrelated notes, no change, worsening, mixed progress, and quantified improvement. Similarly, the therapy-duration branch calculates the gap between two sessions; that alone does not establish continuous adherence or failed therapy, despite its result text.

### 2. P1 — Contradiction detection is confined to selected matching resources

`packages/evaluators/src/deterministic/rules-evaluator.ts:237–255,353–400`

Two confirmed probes return `meets_policy`:

- A valid lumbar diagnosis accompanied by a separate patient-linked DocumentReference stating the physician refutes radiculopathy.
- An Epworth observation with structured score 14 but narrative and notes stating “Patient denies daytime fatigue.”

The diagnosis check only scans the matching Condition's snippet. The numeric check only detects opposing parsed numeric scores. It does not detect the fatigue-negation scenario claimed in the pasted verification summary. The actual regression test uses structured score 1 versus narrative score 14, a different scenario.

Evaluate relevant linked narratives before accepting a requirement, and preserve unresolved contradictions through all tiers. Add both probes to the regression suite. Also test unrelated negation: a generic word such as “denies” should not refute an unrelated diagnosis automatically.

### 3. P1 — Duplicate canonical resource IDs are recorded but do not invalidate evaluation

`packages/core/src/fhir/indexer.ts:71–78` and `getResourceById`; cascade initialization

The indexer retains both duplicate resources in type lists but retains the first one for canonical lookup. A duplicate Epworth observation with the same ID and a conflicting low score still produces `meets_policy`; the citation resolves to the first high-score record. The guard checks pointer authenticity, but an ambiguous pointer cannot establish trustworthy provenance.

Reject or escalate duplicate canonical IDs before evaluation, and make canonical lookup fail on duplicates. Test duplicate ordering and conflicting values.

### 4. P2 — Invalid clinical dates can be replaced by administrative dates

`packages/core/src/fhir/indexer.ts:126–167`

A knee imaging record with impossible effective date `2026-02-30` and valid `issued` equal to the request date still satisfies the imaging lookback requirement. Invalid periods are also discarded rather than preserved as explicit validation failures. Publication time can consequently substitute for unknown or invalid clinical event time.

Track temporal validation errors and use resource-specific clinical dates for policy windows. Do not silently substitute report issue time for an invalid examination date. Cover reversed periods, invalid endpoints, late-issued reports for old examinations, and future period endpoints.

### 5. P2 — Numeric threshold units are not enforced

`packages/evaluators/src/deterministic/rules-evaluator.ts:353–389`

The policy schema exposes `numericThreshold.unit` and the indexer extracts `numericUnit`, but the evaluator compares values alone. A policy requiring `{score}` accepts an observation quantity of `14 mg`.

Validate compatible units, prefer normalized UCUM codes where applicable, and only convert explicitly supported units. Define how unitless integer scores are handled.

### 6. P2 — Retry attempts can exceed budget admission; input limits are estimates

`packages/evaluators/src/llm/structured-llm-evaluator.ts:33–40,99–120`

The advertised maximum cost/tokens cover one attempt; default retry behavior allows three. A local provider stub demonstrates three calls spending $0.000045 against a $0.000025 cap after admission succeeded. The result escalates, but only after the excess calls. `maxInputTokens` also does not truncate or reject the actual assembled input.

Reserve the full retry allowance or admit each attempt separately using the remaining run budget. Enforce input limits before dispatch. Verify usage using the provider's returned cost when available. Distinguish a spend estimate from a guaranteed billing cap.

### 7. P2 — Abort during retry backoff discards accumulated usage

`packages/evaluators/src/llm/structured-llm-evaluator.ts:208–221`

The abort listener rejects the backoff promise with a fresh error outside the accounting catch. After one billable malformed response, aborting during backoff throws an error with no metrics. The orchestrator cannot reconcile that spend. The local replay confirms `metrics: null`.

Attach accumulated metrics on every exit path and clean up abort listeners when backoff completes. Add a regression asserting prior-attempt usage remains visible after cancellation.

### 8. P2 — MCP evidence inspection equates cited evidence with accepted evidence

`packages/mcp-server/src/index.ts:328–343`

Inspection labels a candidate accepted when its pointer appears in the evaluator's citations. However, insufficient-duration, wrong-side, below-threshold, and conflicting evidence can be cited to explain a failure. These records therefore appear accepted even though the requirement is unsatisfied. Rejection text is also generic rather than the actual per-resource reason.

Separate supporting, conflicting, and rejected evidence from mere citation membership. Emit per-resource validation reasons from the evaluator instead of inferring acceptance in MCP.

### 9. P2 — Provider and benchmark labels overstate implemented capabilities

`packages/evaluators/src/jev/jev-evaluator.ts:15–28`; `apps/web/src/App.tsx:171,279–310,405,772`; README

- Jev is explicitly an uncalibrated offline keyword probe; its constructor ignores API options.
- Web and MCP strategy callers pass no live LLM settings. There is no environment loader for `OPENAI_API_KEY` or `OPENROUTER_API_KEY`; setting either alone does nothing.
- The UI calls this “Tiered Production” and labels its own bundled benchmark “Independent.”
- “10 / 10 cases matched” and zero unsupported citations are hardcoded; they can disagree with a later imported report.
- The architecture diagram includes frontier reasoning and independent verification not implemented as separate stages in the shared factory.
- The badge says Da Vinci PAS, but the returned assessment is a custom JSON object; an actual PAS transaction and conformance validation were not found.
- The plateau fixture title still says it lacks re-evaluation, although the record now contains one.

Show provider state explicitly, rename the offline probe in user-facing labels, derive all report text from report data, distinguish stored reports from current workbench runs, and describe protocol support accurately.

## Recommended next work

1. Turn confirmed safety failures into regression tests and repair evidence acceptance, contradiction handling, duplicate IDs, dates, and units.
2. Correct demo labels and benchmark text before recording a public walkthrough.
3. Introduce an evaluator server for the web app, with server-only credentials, explicit provider/model configuration, cancellation, and verified usage. Repair retry budgeting before enabling paid calls.
4. Implement a real Jev adapter separately from the offline probe; keep numeric/date/code computations deterministic. Test malformed answers, low confidence, missing usage, HTTP errors, timeouts, and contradictory evidence.
5. Add unseen synthetic cases designed to require narrative interpretation, with independently reviewed labels. Evaluate rules, rules+Jev, and rules+Jev+generative model on the same cases. Report safe-resolution coverage, accuracy, abstentions, spend, and latency by tier.
6. Add browser regression coverage for case/mutation/strategy resets, inspector behavior, offline provider status, and report rendering. Make CI installs reproducible with `npm ci` and add explicit typechecking and browser checks.

## Credentials

No credentials are required for the current app, tests, or walkthrough. The present Jev class makes no network calls. The generic structured adapter can accept explicit API settings programmatically, but app/CLI/MCP callers do not supply them.

For actual Jev through OpenRouter, OpenRouter documents a regular OpenRouter API key, no separate TypeSafe account, model `typesafe/jev-1.13`, and `POST https://openrouter.ai/api/alpha/decisions`. That typed Decisions API is distinct from the current adapter's Chat Completions API and needs a dedicated implementation. Keep the key in the evaluator server environment, never in a `VITE_*` browser variable.

Source checked October 6, 2026: [OpenRouter Jev tutorial](https://openrouter.ai/blog/tutorials/how-to-use-jev/).
