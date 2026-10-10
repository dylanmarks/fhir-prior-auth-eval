# Improvements implemented October 7, 2026

Verification: 73 tests passed across eight suites; all workspaces typechecked; workspace build passed; structured benchmark and offline comparison gate passed. Browser checks covered cohort/threshold changes, loading saved experiments, narrative abstention, provider status, citation inspection, and local server responses. The web build also passed with its generated report removed, using the checked-in fallback.

The application now tests selective inference directly rather than presenting a structured-only benchmark as evidence of model quality.

## Evidence fixes

Duplicate canonical IDs fail integrity validation and grounding lookup. Candidate records require the bundle patient's subject. Invalid clinical dates/reversed periods remain visible validation failures; report publication cannot silently stand in for examination time. Numeric thresholds validate units. Relevant concept-scoped negation in separate patient notes preserves clinical escalation. PT code presence does not establish progress: rules recognize the explicit supported TUG comparison and otherwise defer. Therapy session endpoints require documented adherence and persistent symptoms when configured. Fixture Conditions explicitly identify active status instead of relying on missing status.

## Providers and budgets

Jev now has a typed OpenRouter Decisions adapter. Outcomes and per-record relationships are validated, probabilities must be consistent, and code supplies provenance pointers. Missing/malformed usage is unknown spend. Ambiguous evidence cannot count as a confident resolution. Jev is unavailable offline and performs no lexical simulation.

The generative adapter receives numeric/status/period data as well as snippets and codes, rejects oversized input conservatively, reserves all retry attempts, stops on non-retryable 4xx errors, and carries accumulated usage through retry-backoff cancellation. External abort propagates from browser/server to the evaluator. Self-reported model confidence is a routing signal.

Admission estimates are not hard provider billing guarantees. Byte-based input bounds are deliberately conservative; they may defer inputs a tokenizer could fit. Jev has no equivalent hard output-token request cap in the documented Decisions interface; post-call overages escalate. Timeouts can leave provider billing unknown. These limitations are displayed in documentation rather than hidden behind a $0 result.

## Research and UI

Twelve narrative fixtures have explicit development/challenge membership. Paired experiments replay judgments across thresholds, track actual acquisition separately from policy cost, and report selective risk, safe coverage, abstentions, false clearances, tier usage, latency, and Wilson intervals. Regression gates compare fingerprints and cohort metrics. CI runs the offline comparison and preserves reports.

The local evaluator accepts only bundled synthetic case IDs, keeps credentials server-side, restricts browser origins, and allows one evaluation at a time. The browser starts on the research comparison, supports offline/live execution and provider status, includes all 22 cases, and uses truthful stored-report and assessment labels. MCP exposes the narrative catalogue and live evaluation only through an explicit flag. Evidence inspection no longer treats failure citations as accepted evidence.

## Remaining research limits

No paid provider calls were made during implementation. Provider contract behavior is tested with local responses; an actual OpenRouter run is still required. Policies are simplified synthetic fixtures, not payer policy transcriptions. Citation authenticity is not semantic correctness. The challenge set is small and hand-authored, not independently clinically adjudicated. The app does not implement a PAS transaction or real EHR workflow.

The earlier October 6 review is retained as an audit record of the original failures; it describes the pre-improvement state. Use the current README and research protocol for current capabilities.
