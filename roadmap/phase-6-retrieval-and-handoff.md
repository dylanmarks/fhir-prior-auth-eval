# Phase 6: Evidence retrieval and review handoff

Status: offline baseline implemented. See [verification outcomes and limitations](../docs/PHASE_6_VERIFICATION.md) and [generated report](../results/retrieval/offline-report.md). The specification below remains the design reference; its measured scope and limitations are recorded separately.

## Outcome and research question

Extend OpenPA Eval to test whether a bounded search across synthetic record sources produces a complete, faithful review packet. The intended public artifact is a recorded follow-up demonstration, supported by a reproducible offline benchmark and inspectable failures.

Research question: when relevant records are scattered, absent, contradictory, or inaccessible, can the system retrieve the available evidence, preserve uncertainty, and explain what the next reviewer needs to do?

Hypothesis: retrieval will recover evidence omitted from the initial submission; a structured handoff will make the result easier to inspect. The benchmark can measure retrieval and packet fidelity. Reduced reviewer effort remains an untested hypothesis until a human study measures it.

## Scope decisions

- Implement an offline, deterministic retrieval baseline and template-based packet first. No paid provider calls are required.
- Use two existing synthetic scenarios: lumbar MRI and knee MRI. Keep the existing policies, evaluation strategies, and clinical thresholds fixed.
- Retrieve from named, in-process synthetic sources representing the submitting practice and an outside therapy practice. These are simulated source boundaries, not EHR integrations.
- Keep retrieval, clinical assessment, and handoff generation separately observable and separately scored.
- Add a dedicated workbench view and report. Preserve the existing 22-case benchmark and its baseline files.
- Use a separate workflow result containing the existing assessment. Do not redefine `meets_policy` as authorization or create an autonomous denial.
- No embeddings, vector database, OCR, PDF ingestion, policy extraction, policy selection, real patient uploads, PAS submission, appeals, or clinician workflow integration in this phase.
- Defer an LLM-directed retrieval agent until the deterministic tool contract and benchmark work. Do not describe the baseline as an autonomous agent.
- Defer new MCP tools and live retrieval endpoints. The first release runs through shared browser-safe code and the CLI.

## Existing integration points

| File/module | Current responsibility | Planned use |
| --- | --- | --- |
| `packages/core/src/fhir/indexer.ts` | Indexes one assembled bundle; checks identity and canonical IDs | Index the materialized retrieved bundle without weakening integrity checks |
| `packages/core/src/domain/evidence.ts` | Existing resource citations | Preserve citations; attach source provenance in the workflow envelope |
| `packages/core/src/domain/assessment.ts` | Assessment, criterion results, missing-information strings | Preserve schema; packet consumes structured requirement results rather than parsing strings |
| `packages/evaluators/src/strategies.ts` | Shared strategy factory | Run the same rules strategy in every primary experiment arm |
| `packages/evaluators/src/tiered/tiered-orchestrator.ts` | Integrity, budgets, grounding, clinical escalation | Reuse behind a retrieval-completeness gate |
| `packages/evaluators/src/guardrails/grounding-guard.ts` | Citation authenticity | Recheck packet citations; authenticity does not prove entailment |
| `packages/eval-suite/src/dataset.ts` | Existing dataset loader | Leave existing cohort loading intact; add a separate retrieval loader |
| `packages/eval-suite/src/experiments.ts` | Existing selective-inference experiments | Reuse statistical helpers where appropriate; keep a separate report schema |
| `apps/web/src/App.tsx` and `data.ts` | Workbench state and bundled fixtures | Add a separate retrieval/handoff view with bundled public inputs |

Important current behavior: the orchestrator can stop evaluating remaining criteria after a conflict. The packet must show those criteria as not evaluated; it must not reinterpret their placeholder `insufficient_evidence` as a completed search or clinical finding. Existing `missingInformation` also includes `not_satisfied`; do not turn every entry into a request for more documentation.

## User-visible flow

1. Select a synthetic clinical family and record-access variant.
2. Show the requested service, configured synthetic policy/version, initial submission, and available simulated sources.
3. Run **Submitted records only**. Inspect which criteria are unresolved.
4. Run **Search available sources**. Show actual source searches, pages, reads, failures, and stopping reason.
5. Inspect the retrieved records and provenance, then the assessment and review packet.
6. Open a citation to the exact source record, clinical date, and raw FHIR resource.
7. Switch to a missing, conflicting, or unavailable variant and repeat.
8. Open the benchmark report for counts across all fixtures and experimental arms.

The packet must also be available when evidence meets the synthetic criteria. Label its purpose `assessment_summary`, `documentation_follow_up`, or `clinical_review`; do not manufacture an escalation to showcase a handoff.

## Dataset: twelve fixtures, with paired clinical facts

Create `datasets/retrieval/` with two families, each with these six variants. Use opaque runtime IDs; descriptive labels below belong to presentation/scoring metadata.

| Variant | Record arrangement | Expected workflow behavior |
| --- | --- | --- |
| Complete submission | Initial bundle contains all requisite records | Rules meet policy; packet cites the supplied records |
| Scattered evidence | Same clinical facts; one or more needed records are in the outside source | Submitted-only is deficient; retrieval recovers all required evidence and matches complete assessment |
| Truly missing | Remove one necessary record from initial submission and every configured source | Completed bounded search finds no substitute; packet says what was searched and what remains undocumented |
| Contradictory evidence | Initial records support a criterion; outside source adds a material conflicting note | Retrieval includes both sides; clinical review and a conflict-focused question |
| Source unavailable | Use scattered arrangement; the source containing required evidence fails | Retrieval incomplete; clinical review; never claim evidence is absent |
| Search budget exhausted | Use scattered arrangement; configure a read/page limit that prevents completion | Retrieval incomplete with explicit stopping reason; no absence claim or definitive workflow clearance |

Use `case-lumbar-001-meets` and `case-knee-001-meets` as starting points. Inspect the knee policy and fixture before generating variants; preserve its own prerequisites rather than copying lumbar assumptions. Lumbar therapy requires both dated endpoints plus the existing explicit adherence/persistent-symptom documentation. Move intact records; do not split facts into new narrative forms that require changing clinical rules.

For lumbar conflict, a separately stored patient note can explicitly negate a configured radiculopathy concept. Verify the exact existing rule recognizes it. For knee, author a separately stored conflict recognized by its configured narrative concepts. Mark these as deliberately narrow synthetic contradiction tests.

Corpus rules:

- Two named sources per family, with exactly one matching patient identity. Identity matching across real organizations is out of scope.
- Initial submission has exactly one Patient. Sources store clinical resources without duplicating that Patient in each result.
- Use the outside practice label appropriate to the family: therapy practice for lumbar, imaging practice for knee. Source names must not reveal whether a criterion is satisfied.
- Baseline corpus fits within default limits; target no more than 20 unique clinical resources per fixture.
- Add plausible irrelevant records, an older record, and a same-code wrong-patient distractor. Wrong-patient content must never be returned to the evaluator or packet.
- A source may advertise an unavailable status, but never advertise what clinical evidence it would have contained.
- Complete and scattered variants share a semantic clinical-facts fingerprint. Missing/conflict variants intentionally change the clinical facts and have different fingerprints.
- Runtime inputs contain no expected results, gold evidence IDs, variant explanations, fixture tags, or descriptive filenames that reveal answers.
- Presentation labels are supplied separately to the UI and never passed to a future model adapter.
- All twelve fixtures are a development/regression set. Do not describe paired variants as independent patients or as held-out validation.

Gold sidecar, loaded only by the scorer:

- Family, variant, derivation source, and synthetic label provenance.
- Expected submitted-only and retrieval workflow dispositions; expected requirement outcomes where actually evaluated.
- Relevant available resource references by criterion, including mandatory conflict records.
- Alternative acceptable evidence sets where more than one combination establishes a criterion.
- Required packet facts identified by resource field/pointer, critical omissions, gap classification, and expected next-action type.
- Expected search completeness, inaccessible sources, and expected stopping reason.
- Gold review status: author only, independently reviewed, or adjudicated. Default to author only.

## Runtime contracts

Implement Zod schemas and exported TypeScript types in `packages/core/src/domain/retrieval.ts` and `handoff.ts`. The following is the required shape, not code to paste without validation.

`RetrievalInput`

- Opaque `scenarioId`, `patientId`, initial FHIR bundle, requested service, requestedAt, policyId.
- Source descriptors: opaque ID, display name, supported resource types, operational availability.
- Execution limits, cancellation signal supplied out of band, and optional deterministic injected-failure configuration for fixture adapters only.
- Do not reuse a full labeled `PriorAuthCase` as the public retrieval input. Adapt to the current orchestrator only inside the workflow runner; never pass `expectedAssessment` to retrieval.

One permitted integration change is to export an unlabeled assessment input type (`Omit<PriorAuthCase, 'expectedAssessment'>`) and have `evaluateCase` accept it. Existing full cases remain structurally compatible. Construct new runtime inputs with neutral titles and no descriptive tags/source metadata. Do not fabricate an `expectedAssessment` just to satisfy the old method signature. Retain the existing explicit removal of gold fields before evaluator dispatch for legacy callers.

`SourceRecordRef`

- `sourceId`, canonical `ResourceType/id`, and content hash.
- Preserve source identity independently of canonical resource ID; different sources can use the same local IDs.

`RetrievalTraceEvent`

- Sequence, source, operation (`search`, `read`), requested type, cursor, returned references/count, outcome, elapsed milliseconds, and error/stopping code.
- Trace metadata must not contain rejected wrong-patient resource bodies.

`RetrievalResult`

- Retrieved records with source references, canonical-to-source provenance map, search trace.
- `completeWithinScope`, searched sources/types, incomplete sources/types, and stopping reason (`completed`, `source_unavailable`, `budget_exhausted`, `cancelled`, `integrity_failure`).
- Counts for queries, pages, reads, unique eligible records, duplicates, rejected records, and conflicts.
- Search scope statement: configured synthetic sources and advertised supported types only. Completion never means the entire patient chart has been searched.
- Scope kind: `initial_submission` or `configured_sources`. Submitted-only evaluates completion within the initial bundle and makes no claim about unsearched sources.

`ReviewPacket`

- Case/request summary, synthetic policy ID/version, packet purpose, workflow disposition, and retrieval scope/completeness.
- A row for every policy criterion: original assessment status/confidence, evaluation state (`evaluated` or `not_evaluated`), source citations, dated excerpts, assessment notes, and next action.
- Gap kind: `not_found_in_searched_sources`, `source_unavailable`, `search_incomplete`, `conflicting_evidence`, `documented_not_met`, `interpretation_required`, `not_evaluated`, or `none`.
- Gap kinds are workflow annotations, not new clinical requirement statuses.
- Distinguish observed clinical date/period from retrieval time. Never substitute retrieval time for examination time.
- Specific next action: `request_documentation`, `restore_source_access`, `continue_search`, `reconcile_conflict`, `clinical_interpretation`, or `none`, with a criterion-specific question and proposed responsible role.
- Responsible roles are suggested routing labels, not asserted assignments to real people. No messages or tasks are sent.
- Packet-level unresolved items, integrity issues, generated-at timestamp, schema version, and content fingerprint.

`EvidenceWorkflowResult`

- Existing `AssessmentResult`, separate workflow disposition, retrieval result, packet, and stage-level timings.
- For incomplete retrieval, preserve the assessment of available records but set workflow disposition to `requires_clinical_review`. Explain the retrieval failure independently of the clinical assessment.
- No new authorization/denial state.

Validate duplicate criterion rows, unknown criterion/source references, invalid hashes, and missing required fields. Use JSON export as the stable artifact; use ordinary rendered HTML for the workbench packet. PDF export is out of scope.

## Retrieval baseline and source interface

Add browser-safe modules under `packages/evaluators/src/retrieval/`:

```ts
interface EvidenceSource {
  descriptor: SourceDescriptor;
  search(input: {
    patientId: string;
    resourceType: string;
    cursor?: string;
    pageSize: number;
    signal?: AbortSignal;
  }): Promise<SearchPage>;
  read(input: {
    patientId: string;
    reference: SourceRecordRef;
    signal?: AbortSignal;
  }): Promise<SourceRecord>;
}
```

`search` returns patient-scoped record metadata and opaque pagination cursors, not full clinical narratives. `read` returns the content and verifies identity again. In-process fixtures deliberately mimic this boundary; this is not a FHIR REST conformance claim.

Baseline algorithm:

1. Validate initial bundle and patient identity. Reject malformed/ambiguous identity before retrieval.
2. Visit sources, advertised supported types, and search results in stable order. Exhaust pagination and read all eligible results within limits.
3. Use a broad sweep rather than top-k relevance retrieval in v1. Include patient narrative resources so code-only selection cannot suppress contradictions.
4. Support the fixture types explicitly: Condition, Procedure, Observation, DiagnosticReport, and DocumentReference. Store DocumentReference narrative in `text.div`, which the existing indexer understands; do not pretend to decode attachments.
5. Do not filter away old dates, negated notes, or apparently non-supporting records at retrieval time. Clinical eligibility belongs to assessment. Wrong-patient records are rejected before exposing content.
6. Merge source records with initial submission; run the existing rules orchestrator on the resulting bundle.
7. Apply retrieval-completeness gating and produce the packet.

Default limits: 4 source descriptors, 16 search-page calls, page size 5, 24 read attempts, and a 10-second wall-clock ceiling. Attempts, including failed reads, consume budget. Test fixtures normally use two sources and complete below those limits. Budget-exhausted fixtures supply an explicit smaller limit; never branch behavior on the variant label.

Complete means all pages and all advertised candidate records in the configured scope were processed successfully. An exhausted query with unread records is incomplete. Empty successful results are distinct from failure. Invalid cursors, repeated cursors, malformed pages, and unsupported advertised types produce incomplete/integrity results, not silent success. Cancellation propagates to adapters and stops dispatch.

Provenance and duplicate handling:

- Stable JSON serialization and SHA-256 identify content; use a browser-compatible implementation without adding Node imports to browser paths.
- Byte-equivalent canonical JSON resources sharing `ResourceType/id` across sources merge into one resource with multiple provenance references.
- Different contents sharing that canonical ID cause an integrity failure. Preserve both source references for inspection, block clearance, and do not let the first/last record win. Collision resolution or ID rewriting is out of scope.
- Different IDs with similar narrative remain separate records. Semantic deduplication and version supersession are out of scope.
- The assembled bundle contains one initial Patient plus unique accepted clinical resources. Existing indexer and grounding checks remain active.

## Handoff generator

Add `packages/evaluators/src/handoff/build-review-packet.ts`. Use templates and structured fields, not a generative summary.

- Iterate policy requirements in policy order, not only returned successful rows.
- Derive evaluated/not-evaluated from assessment execution traces and outcomes. A row skipped after a prior safety stop must not acquire a confident gap classification.
- Copy assessment status and notes faithfully. Do not parse free-text notes to invent clinical facts or evidence relationships.
- Attach authenticated citation excerpts and provenance from retrieved or submitted records. Reverify references against the materialized bundle before exporting a packet.
- Do not label every citation on a conflicted criterion as supporting evidence. Show the cited set under a conflict heading unless a relationship is explicitly established by structured evaluator output.
- Explicitly separate `not_satisfied` from `insufficient_evidence`. No recommendation to obtain more documentation solely because an existing numeric measurement fails a threshold.
- Where the existing rules cannot distinguish outdated evidence from another eligibility failure, use an honest generic eligibility explanation. Do not add untested clinical classification logic just for polished copy.
- For incomplete search, use “not established from retrieved records; search incomplete.” Only a complete bounded search permits “not found in the configured sources.” Neither wording means the patient did not receive care.
- Every non-none next action must refer to a criterion, observed search failure, or explicit assessment escalation. No invented documents, clinician names, facts, or resolution of conflicts.
- Exports contain evidence and provenance but no gold sidecar, expected outcomes, or scorer explanations.

## Experiment arms and fair comparisons

Run three primary arms with the same rules assessor and template packet generator:

| Arm | Evidence access | Purpose |
| --- | --- | --- |
| Submitted-only | Initial submission | Measures the evidence-access baseline |
| Retrieval baseline | Initial submission plus bounded source reads | Measures evidence recovery and resulting assessment/packet changes |
| Full available corpus reference | All accessible patient-scoped records, assembled by the harness | Separates retrieval misses from assessment/packaging errors |

The full-corpus reference is not gold and can be wrong. It does not restore intentionally missing records or bypass unavailable sources. Score each arm against explicit gold labels. For the budget fixture it may bypass the retrieval read limit to show the evidence was accessible; report that access difference explicitly. All arms retain the same identity/integrity checks, including rejection of wrong-patient records.

Submitted-only packet wording must say “not found in submitted records”; its completion flag describes only that scope. The full-corpus reference still reports known inaccessible sources and applies the incomplete-search workflow gate. No arm can turn inaccessible evidence into a successful absence finding.

The original complete case is the paired clinical reference for the scattered variant; it is not a deployable oracle. An optional UI comparison between a bare flag and the structured packet illustrates content differences only. It does not establish reviewer productivity.

## Metrics and denominators

Create `packages/eval-suite/src/retrieval/` with loader, runner, scorer, CLI, and JSON/Markdown reporters. Proposed command: `npm run experiment:retrieval`.

Report raw numerators/denominators, null for inapplicable metrics, and separate source failures from successful empty searches.

| Metric | Definition |
| --- | --- |
| Relevant-evidence recall | Unique labeled relevant accessible references retrieved or present initially / labeled relevant accessible references; report incremental source-only recall separately |
| Conflict-evidence recall | Retrieved labeled conflict references / accessible labeled conflict references |
| Evidence-set completeness | Criteria with at least one fully recovered acceptable evidence set and all mandatory conflict evidence / applicable criteria |
| Citation authenticity | Packet citations passing existing grounding and provenance checks / all packet citations |
| Criterion mapping accuracy | Correctly mapped labeled packet evidence associations / emitted associations; authentic citations can still be mapped incorrectly |
| Critical omission count | Required gold packet facts or conflict items missing from the packet; include their IDs and criterion |
| Gap/action accuracy | Correct gap kind and next-action type / applicable labeled criterion rows |
| Unsupported definitive claims | Count of packet assertions stronger than the assessment, asserted absence after incomplete retrieval, or clinical facts without source support |
| End-to-end correctness | Cases matching expected workflow disposition, required criterion behavior, critical evidence coverage, packet facts, and gap/action labels / all cases |
| Effort proxies | Search/page/read attempts, unique records retrieved, packet citations/rows, retrieval and packet latency; no conversion into clinician time saved |

Use field/pointer labels for critical facts in template output rather than an LLM judge. Authoring a fact label requires an explicit source field and expected rendered value. These checks establish fixture fidelity, not general clinical entailment.

For unavailable sources, inaccessible gold records do not belong in accessible-recall denominators. Separately show required-but-inaccessible evidence counts and completeness failures; otherwise perfect recall of accessible records could look like complete evidence recovery.

Avoid population confidence intervals for these twelve closely related fixtures. Report results by family/variant and describe them as authored regression cases. Do not count repeated executions of deterministic fixtures as new clinical samples.

Report fingerprint: source revision, fixture public-input hash, gold-label hash, protocol version/hash, retrieval implementation/config hash, assessor strategy/config, packet schema/template version, per-arm access policy, source failure settings, and wall-clock measurements. Exclude generated timestamps from reproducibility content hashes. Store reports under `results/retrieval/`; do not overwrite current experiment reports or offline baselines.

## Acceptance tests and gates

Write behavioral tests, including deliberately faulty retrievers and packet builders so a perfect baseline does not mask a scorer that cannot detect errors.

Required passing behaviors:

1. Complete/scattered pairs recover equivalent required evidence and the same clinical outcome under successful retrieval.
2. Submitted-only scattered cases remain deficient; retrieval demonstrably adds the missing supporting records.
3. Truly missing cases do not create records or assert documented failure from absence.
4. Contradictory cases retrieve both sides, escalate, and preserve the unresolved conflict in the packet.
5. Unavailable, budget-exhausted, cancelled, and malformed-pagination runs cannot report completed search or definitive workflow clearance.
6. Wrong-patient distractors are absent from evaluated bundles, packet contents, and raw trace content.
7. Identical duplicates merge with all provenance; conflicting canonical IDs fail visibly.
8. Injected irrelevant authentic citation fails mapping scoring even when grounding passes.
9. Dropped conflict evidence, missing critical facts, wrong next actions, and omitted criterion rows are detected by the scorer.
10. A separately crafted numeric below-threshold result renders `documented_not_met`, not “missing documentation”; a skipped criterion renders `not_evaluated`.
11. Changing only gold labels cannot change runtime retrieval, assessment, or packet content. Verify browser fixtures do not import label sidecars.
12. A note containing instructions to ignore policy is rendered as inert source text and cannot change the deterministic retrieval plan. No HTML execution from excerpts.
13. Export round-trip validates schemas and provenance; reruns produce matching content fingerprints excluding measured time fields.
14. Existing structured benchmark, narrative behavior, mutation tests, provider behavior, and baseline experiment remain unchanged.

The new fixture gate requires zero wrong-patient leakage, fabricated citations, hidden labeled conflicts, unsupported definitive claims, or false workflow clearances after incomplete search. Also require all twelve expected fixture outcomes and packet checks. Call this an authored regression gate, never clinical validation.

## Workbench implementation

Create focused components instead of expanding the existing large `App.tsx` with all business logic:

- `RetrievalWorkbench.tsx`: family/variant/arm selection, run/cancel/reset, stale-result protection.
- `RetrievalTracePanel.tsx`: readable operation sequence, scope, counters, failure/stopping reason.
- `ReviewPacketPanel.tsx`: service/policy summary, all criteria, source evidence, gaps, next actions, export.
- Separate retrieval fixture module containing public inputs only, and a report adapter for generated-report or checked-in offline snapshot fallback.

Use the same workflow runner in CLI and browser. No network or credential requirement for the recording. Source calls are executed in process; show real local trace entries, not animated fictional tool calls. No artificial latency is needed. Run IDs prevent an older asynchronous result replacing a newer variant. Cancelled results visibly preserve incomplete status.

All citation links open raw record plus source/provenance. Show fixture descriptions separately from runtime input. Render clinical text as text, not injected HTML. Preserve existing keyboard behavior and provide accessible status announcements. JSON export filenames contain opaque case ID and report version; include a visible synthetic-data label.

## Ordered implementation handoff

Implement sequentially; a single implementation agent can own this phase. Do not spawn additional agents unless separately authorized.

1. **Contracts and fixtures:** add Zod types, public corpus and gold sidecars, dedicated loader, fixture consistency checks. Deliver a short fixture table showing expected submitted/retrieval differences. Do not change existing fixture counts or gold labels.
2. **Retrieval runner:** source adapter, paging/limits/cancellation, identity filtering, provenance/deduplication, materialization, workflow completeness gate. Verify retrieval independently before packet work.
3. **Packet and scorer:** deterministic templates, criterion/evidence mapping, next actions, gold fact assertions, negative controls. Produce a CLI report before UI integration.
4. **Workbench:** add the separate view, trace, packet inspection, export, report fallback, and shared execution path.
5. **Recording preparation:** publish an actual generated offline report snapshot, update README/protocol with measured results and limits, and complete the video checklist in `docs/PHASE_6_VIDEO_BRIEF.md`.

Owned areas: new core domain files/exports; new retrieval/handoff modules/exports in evaluators; dedicated eval-suite retrieval modules/tests; `datasets/retrieval/`; new web components/data module; minimal `App.tsx` wiring; root package script; phase documentation and new report snapshot. Modify existing evaluators only for a necessary, explicitly tested integration issue. Keep changes to existing provider/server/MCP code out of scope.

Verification commands, one command per invocation:

```text
npm run typecheck
npm test
npm run benchmark
npm run experiment -- --baseline datasets/offline-experiment.json
npm run experiment:retrieval
npm run build
git diff --check
```

After those checks, inspect the workbench manually in the browser: complete, scattered, missing, conflict, unavailable, budget exhausted, cancellation, citation details, JSON export, and report fallback. Record exact pass/fail results. Do not run paid providers or refresh unrelated baselines. Do not commit, push, publish, or send external messages without a separate request.

## Ready-to-paste implementation prompt

> Implement Phase 6 using `roadmap/phase-6-retrieval-and-handoff.md` as the specification and `docs/PHASE_6_VIDEO_BRIEF.md` as the intended demo. Start by reading repository instructions and the integration points named in the brief. Build the offline deterministic retrieval baseline, twelve synthetic fixtures with isolated labels, faithful review packets, independent scoring with negative controls, and the dedicated workbench view. Work through the ordered milestones; do not broaden into live integrations, autonomous retrieval, new models, or clinical-policy changes. Preserve current benchmarks and report schemas. You are not alone in the codebase: preserve others' edits and accommodate concurrent changes. Run the specified checks and browser walkthrough; report actual outcomes and unresolved limitations. No paid calls, external publishing, commits, or additional agents are authorized by this prompt. Finish with the generated report path, files changed, verification results, and the exact recording path through the UI.
