# Evidence sufficiency protocol, version 1

## Dependency audit

Base: Phase 6 revision `383ab99`. The recorded Phase 6 verification covers its 145 tests, 36 authored fixture/arm checks, build/typecheck, unchanged original benchmark and experiment, and browser checks. Its independent accessible-corpus assembler bypasses search/read limits while retaining patient identity, source availability, provenance, and collision rules. Incomplete retrieval routes the workflow to review. The packet uses trace presence to distinguish skipped criteria and retains the labeled narrow contradictions.

The Phase 7 manifest freezes the public input and gold hashes of all twelve Phase 6 fixtures. Loading rejects changed dependencies. No Phase 6 source, schema, gold, policy, or report was changed for this experiment.

Known dependency limitation: historical therapy can inflate the fixed lumbar assessor's elapsed duration. This experiment retains that behavior. A packet that omits a conflict not recognized by the assessor is a measured failure, not a reason to weaken the scorer or add a new routing policy.

## Frozen design

Twenty primary authored fixtures: twelve inherited regression fixtures; four PT-progress narrative variants assigned to development; four lumbar-therapy narrative variants assigned to challenge. The narrative families each contain complete, scattered, missing and contradictory arrangements. One below-threshold numeric control uses the existing sleep-study policy and is reported separately. All labels are author-only, including the challenge labels. This is not independent clinical validation.

The PT family reuses the existing narrative progress policy. The lumbar family reuses the existing lumbar policy with its intact diagnosis and therapy endpoints. Its new note explicitly documents attendance, home exercise adherence, and continuing symptoms using wording outside the narrow deterministic phrase match. A separately dated same-episode note explicitly contradicts the completion account. This tests narrative interpretation without changing clinical thresholds. Clinical adequacy labels describe the records available in each access arm; skipped rules placeholders do not become clinical gold.

Each fixture is materialized once per replicate into submitted-only, bounded retrieval, and full accessible-corpus reference snapshots. Entries are sorted by canonical ID to prevent source placement changing provider input order. The same immutable bundle, service, request date, and policy are supplied to every strategy. The current scrubber/projection still applies inside the unchanged orchestrator; models receive no retrieval scope metadata, presentation labels, cohort, targets, or gold. Retrieval and provenance remain in the experiment envelope.

Strategies: `rules`, `cheap`, `tiered`, and `llm`, using the existing adapters. Frontier uses the same configured model/options in the cascade and frontier baseline; the baseline's tier number follows the existing factory. No simulation strategy appears in results. Model thresholds are 0.70, 0.90, and 0.99; rules retain 0.90. The sweep is exploratory. No operating point is selected from challenge outcomes.

One replicate gives 20 × 3 × 4 × 3 = 720 primary cells, plus 36 separate control cells. Cells, paired variants, repeated access conditions, threshold replays, and provider replicates are correlated observations, not independent patients. No population confidence intervals or combined weighted score are reported.

## Acquisition and replay

Every declared target is directly probed at rules, Jev, small and frontier regardless of the cascade stopping point. Full policies are retained in snapshot fingerprints. Direct probes use the same evaluator and requirement/context contract through an isolated orchestrator so current grounding and routing checks remain observable.

Record normalized raw responses before orchestration guards, requested/resolved model IDs, usage verification, provider-input hash, origin, and cache identity. A policy/probe observation references the recording and its guard outcome. Input refusal, unavailable configuration, provider failure, shared-budget exhaustion and cancellation are explicit outcomes, never invented judgments. Unconfigured adapters are not invoked and receive no abstention credit.

Cache keys include full evidence, requirement, complete policy/version, service, request date, adapter/configuration identity, source-code fingerprint, requested model, and replicate. Threshold and access labels do not enter the key. Identical acquisitions within a replicate can be reused across strategies, probes, and equivalent access arms. New replicates acquire fresh judgments. Raw recordings and references persist in the report. Replay within a run makes no additional provider acquisition; it is not another sample.

One run-wide admission cap covers all provider adapter invocations, including direct probes and all replicates. Existing adapter reservations include their retry bounds. Calls execute sequentially. Per-case admission still applies. Unknown usage stops later provider acquisition and makes verified spend unknown. Adapter deadlines propagate cancellation and preserve explicit partial results. SIGINT/SIGTERM marks remaining cells cancelled while the runner writes its matrix/report. Upstream billing can exceed a reservation or continue after request cancellation; an observed overrun stops acquisition and remains visible.

Actual unique acquisition spend, direct-probe acquisition spend, counterfactual policy-attributed spend, and local retrieval effort are separate. A cached recording is counted once in actual spend and referenced by every applicable replay. Adapter acquisition counts are not counts of internal HTTP retry attempts. Resolved provider model IDs remain in recordings; requested IDs and explicit prices remain in nonsecret configuration. No model is silently substituted.

Reported policy adapter latency is the sum of recorded times for steps the replay would use. It is not observed policy wall-clock latency. Source retrieval is measured once per snapshot. The viewer deduplicates semantic workflow results across replays; the full report retains measured timings.

## Scoring and gates

Clinical labels classify sufficient support, documented nonfulfillment, insufficient evidence, and unresolved conflict. Supported satisfaction/nonfulfillment requires an acceptable cited evidence set, authentic citations, and correct mapping. A real but irrelevant citation does not establish support. A resolved case is safe only when every required criterion is correct and grounded, its disposition matches snapshot-specific labels, usage is verified, and the final workflow respects completeness. Clinical review is abstention, not safe resolution. Raw assessment and final workflow metrics are separate.

Raw unsupported satisfaction at the threshold, confident missing-as-nonfulfillment, unnecessary abstention, uncertainty preservation, and guard interception are scored on direct probes with explicit scheduled/acquired/failed/unacquired counts. Failures get no uncertainty credit. Acquired-only unsupported-satisfaction rates are reported alongside scheduled rates. Null denotes no applicable denominator. Unacquired model summaries are not evidence of model safety even if the scheduled unsafe numerator is zero.

Packet gap/action scoring requires both labels to match. Criteria skipped after a conflict must show not evaluated and clinical interpretation. The inherited Phase 6 scorer also runs on its fixture cells and remains in the full report. Critical dates, mapping, conflict retention, source failure and search completeness remain inspectable. New narrative gold additionally checks acceptable evidence and mandatory conflicts. A rejected fabricated citation remains in the raw assessment but is omitted from the packet with an explicit integrity note; this packet-only adaptation uses the shared builder without altering assessment or guard behavior.

Predeclared paired contrasts: submitted versus bounded retrieval; bounded versus accessible corpus; rules versus cheap; cheap versus full cascade; full cascade versus frontier baseline. Improvements, regressions, added unsafe resolutions and added policy spend are counted only on matched fully measured cells. Unavailable or partial model cells are excluded from measured-strategy denominators and explicitly counted separately. Reports include family, variant, cohort, access, threshold, tier and fixture detail. Numeric controls stay outside all primary denominators.

Infrastructure acceptance covers correct matrix construction, immutable inputs, label isolation, cache boundaries, shared budgets, distinct failure outcomes, faithful raw/guard separation and regression preservation. An empirical safety gate separately flags unsupported raw satisfaction, missing-as-nonfulfillment, unsupported clearance, hidden conflict, ungrounded citation or wrong-patient leakage. Poor real behavior is a valid result, not an infrastructure failure. Measured packet safety flags exclude unacquired model cells; raw acquired observations are still checked in partial strategies.

## Execution

Offline: `npm run experiment:sufficiency`.

Live, only after separate budget authorization and explicit existing provider configuration:

```text
npm run experiment:sufficiency -- --live --max-spend <authorized-usd-cap> --replicates 1 --output results/evidence-sufficiency/live-report.json
```

Additional acquisition bounds: `--max-calls` and `--max-tokens`. `--max-spend` is mandatory for live execution and is validated before credential/provider setup. Offline execution never loads saved credentials or configured adapters, even if environment variables exist. Output must remain under `results/evidence-sufficiency/`. No paid run was authorized or executed during implementation.

The CLI writes a full JSON report, Markdown summary, and `.view.json` for the saved-report interface. The checked-in view fallback lives under `datasets/evidence-sufficiency/`. The browser can load a user-selected local view report; no live provider controls or credentials are present. Workflow exports contain the selected synthetic workflow, without gold overlays or provider settings. Full reports and the viewer contain scorer-derived comparisons, so they are not blinded benchmark inputs.

Policy-version applicability, new retrieval strategies, real data integrations, and reviewer productivity studies remain separate work.
