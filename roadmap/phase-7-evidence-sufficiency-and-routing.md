# Phase 7: Evidence sufficiency across the model ladder

Status: offline experiment infrastructure implemented after the Phase 6 dependency audit. See [protocol](../docs/PHASE_7_PROTOCOL.md), [verification and pending browser checks](../docs/PHASE_7_VERIFICATION.md), and [offline report](../results/evidence-sufficiency/offline-report.md). No provider model results have been acquired. The design below remains the scope reference; browser acceptance and live measurement remain outstanding.

## Outcome and research question

Run the existing rules → Jev → small model → frontier ladder against controlled evidence-access conditions supplied by Phase 6. Measure whether each tier recognizes when evidence is insufficient, whether the final workflow preserves that uncertainty, and what additional inference costs.

Research question: with the same policy and evidence snapshot, which tiers make supported assessments, which identify gaps correctly, and which produce confident unsupported conclusions?

The motivating feedback describes missing documents, changing policies, and records that never reach the chart. Phase 7 addresses missing and inaccessible evidence plus assessment routing. It simulates those conditions with synthetic records; it does not ingest faxes or establish performance on real practice data. Policy changes have a separately scoped follow-on below.

Hypotheses to test, not assume:

- Evidence recovery changes supported outcomes more than additional model reasoning on some incomplete submissions.
- Later tiers may improve interpretation without recovering facts absent from their inputs.
- Aggregate clinical-review rates can hide unsafe raw tier judgments that downstream guards block.
- A useful system identifies the appropriate next action as well as declining to answer.

## Dependency and ownership boundary

Phase 6 owns bounded retrieval, source adapters, provenance, workflow completeness checks, template review packets, its twelve paired fixtures, its CLI/report, and its workbench view. Let the active Phase 6 implementation finish before editing those areas.

Phase 7 can be queued now. Implementation starts by reading the final Phase 6 code and generated report, then recording its source revision and fixture/protocol fingerprints. The currently observed interfaces are provisional integration hints, not frozen requirements.

Readiness requirements:

1. Phase 6's specified automated checks and browser walkthrough have recorded outcomes.
2. Its twelve fixtures, public inputs, gold sidecars, retrieval snapshots, workflow dispositions, and scorer are usable through shared modules.
3. The full-access reference demonstrably assembles the intended accessible corpus; it is not merely a second retriever run assumed to be complete.
4. Incomplete-search cases retain an explicit workflow stop regardless of an assessor's apparent confidence.
5. The packet faithfully distinguishes evaluated and skipped criteria and preserves material conflicts.

If a dependency is missing, record the concrete blocker and any proposed minimal change. Do not silently repair or rewrite Phase 6 as part of this phase. Continue independent Phase 7 contracts, scorer tests, and documentation where possible.

Owned additions: a dedicated `packages/eval-suite/src/evidence-sufficiency/` experiment, tests, `datasets/evidence-sufficiency/`, a separate report namespace, protocol documentation, and focused comparison UI components. Reuse Phase 6 retrieval and packet code. Minimal shared hooks may expose frozen snapshots and raw tier results; preserve existing callers, defaults, and report schemas.

## Scope and exclusions

Include fixed evidence snapshots, all four existing assessment strategies, direct tier probes, action classification, threshold replay, cost accounting, deterministic offline verification, and an explicit opt-in live runner.

Keep the retriever deterministic and identical for every assessor. A model does not choose searches, access extra records, or modify the evidence snapshot during this experiment. This measures assessment under imperfect evidence, not an agent's search skill.

Exclude new providers, model-directed retrieval, OCR/PDF/fax processing, embeddings, real PHI, EHR connections, payer-policy extraction, PAS transactions, automated outreach, reviewer productivity claims, and changes to clinical thresholds. Keep Phase 6 packet generation deterministic. Do not introduce an LLM judge as the primary scorer.

Do not add a new routing policy and claim a benefit from it in the primary comparison. The current routing behavior is the object being measured. Results can motivate a later intervention study comparing retrieve-first or early-stop policies under matched access and budget conditions.

## Experimental design

### Evidence access × assessment strategy

Materialize each Phase 6 evidence-access arm once per fixture and acquisition replicate. Persist its records, provenance, completeness, stopping reason, and content hash before assessment. Feed the identical immutable snapshot to every strategy.

| Evidence condition | Input | Interpretation |
| --- | --- | --- |
| Submitted only | Initial submission | Evidence available at intake; no claim that outside sources were searched |
| Bounded retrieval | Phase 6 search result | Evidence actually recovered within the configured limits |
| Full accessible corpus reference | Harness assembly of accessible patient-scoped records | Reference for detecting retrieval omissions; cannot restore missing or inaccessible records |

| Assessment strategy | Existing strategy name | Purpose |
| --- | --- | --- |
| Rules only | `rules` | Deterministic control |
| Rules + Jev | `cheap` | Typed decision increment |
| Full cascade | `tiered` | Existing escalation policy |
| Frontier baseline | `llm` | Frontier assessment under the same evidence access and guards |

Reconcile strategy names with the final factory before implementation. Exclude `simulation` from measured results.

Twelve Phase 6 fixtures × three access conditions × four strategies gives 144 case/condition/strategy cells per threshold. These are correlated experimental cells, not 144 independent patients. Add the narrative fixtures below for 240 total cells if all twenty fixtures qualify. Store explicit applicability and skipped-cell reasons rather than forcing every metric onto every row.

Retain the current model threshold sweep of 0.70, 0.90, and 0.99 with rules thresholds unchanged. A sweep is exploratory. Freeze a chosen operating point on development data before inspecting challenge results. Report the full sweep without choosing a winning challenge threshold after seeing its labels.

### Direct tier probes

The cascade may stop at rules or an earlier model, concealing later-tier behavior. Independently probe each existing tier on scorer-selected target criteria using exactly the same snapshot and the same evaluator/prompt contract as the cascade. Target selection and expected answers remain scorer-only metadata.

Capture normalized judgments and confidence before citation checks, completeness gates, and workflow repair. Capture accepted/blocked results separately. Reuse identical acquisitions where the complete input and adapter configuration match. Distinguish direct-probe acquisition spend from calls the routing policy would actually make.

Do not expose gold target IDs or diagnostic labels through prompts. A criterion ID required by the normal evaluation API is allowed; its expected outcome or reason for selection is not. Honor existing deterministic code/date eligibility checks rather than asking models to replace them.

## Dataset additions and labels

Reuse the twelve Phase 6 fixtures without relabeling them to favor a strategy. Reference their frozen input and gold hashes in the Phase 7 manifest. If model assessment needs additional criterion labels, store reviewed overlays in the new dataset namespace.

Add eight narrative fixtures: two distinct clinical families, each with four paired variants. Select narrative criteria supported by the existing policy/evaluator contracts, such as progress or persistent functional limitation; do not rewrite an existing policy solely to force model use. Use existing narrative cases where suitable after checking their scenario and policy semantics. If those contracts cannot represent an appropriate second family, document that limitation before expanding scope.

| Narrative variant | Construction | Expected target behavior |
| --- | --- | --- |
| Complete | Explicit narrative evidence establishes the criterion | Supported satisfaction with relevant citations |
| Scattered | Move the intact required note to an accessible outside source | Submitted-only insufficient; retrieval restores the complete evidence set |
| Truly missing | Remove the decisive note from every configured source | Insufficient evidence; specific documentation follow-up |
| Material conflict | Add a dated, explicit conflicting account that remains unresolved | Preserve both records and route for clinical review |

The Phase 6 families supply unavailable-source and budget-exhaustion conditions. The narrative additions ensure model tiers have meaningful interpretation work. Do not claim broad language robustness from these eight authored fixtures.

Assign one new narrative family to development and the other to a frozen challenge cohort, including all paired variants of each family in the same split. Phase 6 cases remain development/regression fixtures. Their paired variants cannot become independent held-out cases. Record author-only versus independently reviewed labels honestly. Authoring challenge cases does not constitute independent validation.

Gold metadata must separately label:

- Expected criterion state for each evidence-access snapshot, not just the complete patient facts.
- Adequacy of available evidence: sufficient support, documented nonfulfillment, insufficient, or unresolved conflict. This is scorer metadata, not a replacement assessment enum.
- Acceptable evidence sets, mandatory conflicting records, and criteria not actually evaluated after a stop.
- Expected assessment and final workflow behavior, including search-completeness overrides.
- Gap kind and next action using Phase 6's existing vocabulary.
- Whether a direct probe is applicable and why; required target criteria.

Preserve the distinction between known fixture facts and what a particular snapshot establishes. A removed record must not leave a complete-case answer as the expected assessable result. A value documented below a threshold remains documented nonfulfillment, not missing documentation. Add an explicit below-threshold negative control if the inherited cases lack one; keep it outside the twenty-case primary denominator and report it separately.

Keep source failure, model failure, budget failure, ambiguous interpretation, and missing documentation distinguishable in scoring. Do not award abstention credit for provider errors or a judgment never acquired.

## Runtime and acquisition contracts

Add versioned experiment types locally first; export shared types only when another package needs them.

`EvidenceSnapshot`: opaque fixture ID; access condition; unlabeled assessment input; explicit policy/version/hash; materialized bundle; provenance; retrieval scope, completion and failure state; retrieval counters/timing; content fingerprint. Full-scope metadata can be carried in the experiment envelope without altering clinical prompts. All tiers receive the same current provider-visible context; record which scope fields are actually visible. A later scope-aware prompt is a separate protocol intervention.

`TierObservation`: snapshot hash; requirement ID; evaluator/tier and resolved model ID; acquisition replicate; raw normalized judgment/confidence/citations; guard verdict and reason; provider outcome; verified usage/spend; actual-call flag or cache reference. Store skipped and failed observations explicitly, without fabricated judgments.

`PolicyReplay`: strategy; threshold; tier calls/acceptances; criterion evaluation states; assessment; final workflow disposition; completeness override; review packet; cost and timing components. Reuse the existing workflow gate and packet builder rather than reconstructing their semantics in a reporter.

`SufficiencyReport`: versioned configuration/fingerprints; expected versus acquired matrix; raw observation references; per-cell scores; paired contrasts; aggregate raw counts; failure categories; cost provenance; gate failures; cohort/family/variant summaries.

Acquisition/cache rules:

- Key by full provider-visible input, requirement, policy content/version, adapter/prompt configuration, resolved or requested model identity as appropriate, and replicate. Include evidence and relevant temporal context. Never reuse a judgment across changed inputs because a case ID happens to match.
- Record requested and resolved model IDs; preserve current pins and explicit prices. Do not choose or substitute new models implicitly.
- Within a replicate, replay thresholds and share identical judgments across arms/probes. A new independent replicate makes fresh provider acquisitions; replay is not a new sample.
- Keep policy-attributed assessment cost, actual acquisition spend, direct-probe spend, and retrieval effort separate. Retrieval is local operation counts/time; do not invent a dollar price for it. Do not add shared cached acquisition spend repeatedly across policies.
- Enforce a single live-run acquisition cap across strategies, probes, retries, and replicates. On exhaustion, retain partial results and label unacquired cells. Missing usage remains unverified and cannot support a cost-efficiency claim.
- Sequential threshold replay is not observed wall-clock latency. Report measured adapter/retrieval timing and any estimated policy sum with explicit labels. A live browser evaluator must keep credentials on the server; the default UI reads saved reports only.

## Metrics and planned comparisons

Publish numerators/denominators and null for no applicable observations. For every model summary, show scheduled, acquired, failed, and unacquired counts.

| Metric | Definition and denominator |
| --- | --- |
| Raw unsupported satisfaction | Target judgments at/above threshold claiming satisfaction without gold-supported evidence / applicable scheduled gap/conflict probes; report acquired-only rate alongside it and show failures separately |
| Confident false nonfulfillment | Target judgments at/above threshold claiming `not_satisfied` where the snapshot only establishes a gap / applicable scheduled missing-evidence probes |
| Uncertainty preserved | Correct insufficient-evidence or explicit deferral/below-threshold target judgments / applicable scheduled gap/conflict probes; provider/budget failures receive no success credit |
| Unnecessary abstention | Abstaining or deferring judgments / gold-sufficient, conflict-free acquired target probes; show acquisition failures separately |
| Supported resolution coverage and selective risk | Reuse the existing complete-case correctness definition, with snapshot-specific labels; expose raw assessment and final workflow metrics separately |
| Gap/action accuracy | Correct gap kind AND next-action type / applicable labeled criterion rows; skipped rows retain `not_evaluated` |
| Guard interception | Unsafe raw judgments blocked / unsafe raw judgments acquired; zero unsafe raw judgments yields null |
| Incremental tier yield | Additional safe case resolutions compared with the preceding strategy on matched cells, paired with added unsafe resolutions and policy spend |
| Evidence recovery effect | Change between submitted-only and bounded-retrieval outcomes under the same strategy and fixture |
| Retrieval gap | Difference between bounded retrieval and full accessible corpus outcomes under the same strategy; reference is not clinical gold |
| Cost per safe resolution | Verified policy-attributed assessment spend / safely resolved cells; null if denominator is zero or spend is unverified |

Report confident false nonfulfillment separately from unsupported satisfaction. A broad abstention measure must not obscure a model consistently making the wrong kind of definite claim. Preserve Phase 6 retrieval recall, conflict recall, citation authenticity, mapping, critical omissions, and packet correctness alongside these new metrics.

Predeclare contrasts: evidence recovery within each strategy; additional tier yield within each access condition; cascade versus frontier under matched access. Show counts of paired improvements and regressions, not just aggregate averages.

Primary reporting is per fixture, family, variant, cohort, tier, and access condition. No population confidence intervals from these small related fixtures. Independent acquisition repetitions describe provider variability conditional on the same fixtures, not additional patients. No new overall weighted score or declaration of a universal best model.

## Offline and live execution

Proposed script: `npm run experiment:sufficiency`.

Default offline behavior uses real deterministic retrieval/rules and marks unconfigured model arms unavailable. Never turn mock model responses into benchmark model scores. Test doubles and recorded synthetic responses belong only in isolated runner/scorer tests and clearly labeled UI test fixtures.

Proposed explicit live invocation:

```text
npm run experiment:sufficiency -- --live --max-spend <explicit-usd-cap> --replicates 1 --output results/evidence-sufficiency/live-report.json
```

Implement and document the flags before treating the command as available. Missing `--max-spend` must reject live execution before calls. Queuing implementation does not authorize a paid run. Do not copy a cap from an unrelated experiment. A live run can remain a separately authorized empirical step after the infrastructure is delivered.

Use one acquisition replicate for initial plumbing; repeated live acquisitions are a separately budgeted empirical milestone. Reports that lack acquired model results are infrastructure artifacts and cannot answer the research question.

Fingerprint source revision, dependency baseline, public inputs, gold overlays, policy content, retrieval implementation/configuration, provider-visible context, prompts/adapters, model/price settings, packet/scorer versions, threshold plan, cohort split, access policy, and replicate IDs. Exclude volatile timestamps from content hashes. Save reports only under `results/evidence-sufficiency/`; preserve all existing baselines and reports.

## Acceptance tests and gates

Required behavioral tests include faulty evaluators/scorers and interrupted runs:

1. Every strategy and direct tier receives byte-equivalent canonical evidence and matching policy for a cell. Mutation of a shared snapshot fails visibly or is prevented.
2. Changed evidence, policy version/content, temporal context, prompt, or replicate invalidates acquisition reuse. Identical inputs can share acquisitions within a replicate.
3. An earlier rules acceptance does not suppress applicable direct model probes. Probe cost is not attributed to cascade routing.
4. Threshold replays reuse recordings without new acquisitions. Two independent replicates do not reuse provider responses.
5. A confident unsupported `satisfied` judgment is scored as unsafe even if grounding or completeness guards block the final outcome. An authentic irrelevant citation does not rescue it.
6. Confident `not_satisfied` on missing documentation is detected separately; a documented failing numeric value is not mislabeled as an evidence gap.
7. Complete/scattered pairs recover the expected evidence and outcome when retrieval succeeds. Permanently missing evidence is never materialized by a model.
8. Conflict records survive retrieval, assessment, and the packet. Skipped criteria receive no credit as completed assessments.
9. Source-unavailable, incomplete-search, cancelled, and exhausted retrieval states cannot yield final workflow clearance. An internal satisfied assessment and an overridden workflow outcome remain separately visible.
10. Provider errors, exhausted inference budgets, unconfigured tiers, missing usage, and skipped observations are distinct from correct abstention and have explicit denominators.
11. Gold-only changes cannot alter retrieval, prompts, model acquisition, or packet content. Frozen challenge labels never reach runtime inputs.
12. The scorer catches intentionally wrong actions, dropped conflicts, unsupported claims, and optimistic denominator filtering.
13. One acquisition cap covers all paid calls and retries. Reports reconcile acquisition spend with cache references without double counting; partial runs never appear complete.
14. Existing experiments and Phase 6 results reproduce without changing their schemas, labels, default behavior, or baselines.

Separate two kinds of gates:

- Infrastructure acceptance requires the tests above, faithful reports, and preservation of existing behavior. A model performing poorly is a valid experiment result, not a reason to alter labels or hide cells.
- Empirical safety gates flag any confident unsupported satisfaction, confident missing-as-nonfulfillment, unsupported final clearance, hidden conflict, fabricated citation, or wrong-patient leakage. Report failures even when the final guard contains them. Do not present passing synthetic fixture gates as clinical validation.

## Comparison UI and deliverables

Extend the final Phase 6 view with focused components for a saved sufficiency report. Do this only after the CLI/scorer works. Do not add live provider controls or redesign the workbench.

Required inspection path: select fixture → compare submitted/retrieved/reference evidence → compare strategy outcomes → inspect direct tier judgment → see guard result and final workflow → inspect packet and next action.

Show unavailable/unacquired model cells explicitly. Display confidence threshold, policy/version, search completeness, evidence hash, raw-versus-final outcome, and cost basis where needed to interpret the result. Provide JSON export without gold labels or provider credentials. Source excerpts remain inert text.

Deliverables:

- Dedicated experiment protocol and twenty-fixture manifest, plus separately reported negative controls.
- Frozen snapshot adapter, recording/cache and replay runner, raw tier probes, scorer with negative controls, CLI, and JSON/Markdown report.
- Deterministic offline report with honest model-unavailable cells and a saved-report comparison view.
- Verification log, dependency revision/fingerprints, dataset limitations, and any unresolved integration issues.
- Optional live report only after explicit budget authorization; no claims of model performance before acquisition.

## Ordered implementation handoff

1. **Dependency audit and protocol:** inspect completed Phase 6, reconcile final interfaces, freeze matrix/metrics/cohorts, document blockers, and confirm the full-access reference.
2. **Dataset and contracts:** create manifests/overlays, eight narrative variants, snapshot types, label isolation checks, and expected-behavior table.
3. **Runner and recording:** immutable snapshots, strategy adapters, direct probes, complete cache keys, threshold replay, shared acquisition accounting, offline/unavailable handling, partial-run output.
4. **Scorer and CLI:** independent negative controls, paired contrasts, failure categories, report fingerprinting, offline report. Inspect this report before UI work.
5. **Comparison UI and verification:** focused saved-report components, raw/final inspection, exports, regression checks, and manual browser verification.
6. **Empirical execution:** after a separate budget authorization, acquire live results using configured pinned models, review failures, then decide whether repeated acquisitions or a routing intervention is justified.

Verification commands, each run individually after its script exists:

```text
npm run typecheck
npm test
npm run benchmark
npm run experiment -- --baseline datasets/offline-experiment.json
npm run experiment:retrieval
npm run experiment:sufficiency
npm run build
git diff --check
```

Inspect generated baseline changes caused by verification; do not retain unrelated generated edits. Verify the browser on complete, scattered, missing, conflict, unavailable, and budget-exhausted inputs; inspect a raw unsafe test response blocked by a guard, an unconfigured model cell, citations, report fallback, and export. Use a visibly labeled test report for fault-injection UI checks. Record actual pass/fail outcomes.

## Follow-on: policy-version applicability (separate phase)

Do not include this experiment in Phase 7 implementation. Queue separately after the evidence-access comparison is stable. It changes a second axis that would otherwise confound the primary study.

Proposed unit: the same clinical evidence and request timeline under two explicitly authored synthetic policy versions. Add policy ID/version, effective interval, retrieval/publication timestamp, and a documented synthetic rule defining the applicability anchor. Never assume whether request date, service date, or another date governs a real payer's policy.

Minimum cases: one applicable version, a stale supplied version with the correct version available, the applicable version inaccessible, conflicting applicability metadata, and a policy change during the episode with an explicit synthetic transition rule. Score policy selection separately from assessment under the selected policy, including the case where both versions happen to give the same outcome.

Required behavior: select the version only when applicability is established; preserve uncertainty and request policy clarification otherwise; invalidate cached judgments on policy-content changes; cite the selected version and applicability basis in the packet. No scraping, real payer legal interpretations, automatic policy extraction, or mid-run silent policy replacement. Define a versioned migration for packet actions if the final Phase 6 vocabulary lacks policy clarification.

## Ready-to-paste queue prompt

> Implement Phase 7 from `roadmap/phase-7-evidence-sufficiency-and-routing.md` after Phase 6 completes. Begin with its dependency audit; the Phase 6 brief and any unfinished code are not evidence that its acceptance criteria passed. Preserve the completed Phase 6 implementation and its baselines. Build the evidence-access × existing-strategy experiment, eight paired narrative additions, direct raw tier probes, snapshot-specific scoring, recording/replay with correct cache boundaries, unified acquisition caps, separate cost accounting, CLI/report, and focused saved-report comparison UI. Use the final Phase 6 retrieval, provenance, workflow gates, and packet builder. You are not alone in the codebase: preserve others' edits and accommodate concurrent changes. Work through the ordered milestones, run the specified checks and browser inspection, and record actual outcomes. Offline runs must show unavailable models honestly. No paid calls, new models, real data, autonomous search, policy-version implementation, commits, external publishing, messages to other chats, or additional agents are authorized by this prompt. Finish with report paths, files changed, dependency fingerprints, verification results, limitations, and the exact separately budgeted next step needed for live measurement.
