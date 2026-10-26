# Phase 6 verification

Verified October 26, 2026 against checkpoint `8d969b4` plus the implementation changes captured by the generated report's implementation fingerprint. The report records the parent revision and dirty-tree state explicitly; its content hashes identify the actual inputs and implementation.

## Delivered

Bounded, patient-scoped local source search/read; strict pagination and response validation; deadline and cancellation propagation; failed-attempt accounting; duplicate provenance and collision quarantine; completeness gating; deterministic review packets; three-arm CLI with independent accessible-corpus assembly; JSON/Markdown reports; bundled summary snapshot; retrieval workbench, source inspection, and workflow JSON export.

Run `npm run experiment:retrieval`. Reports are written to `results/retrieval/offline-report.json`, `offline-report.md`, and `workbench-report.json`. The browser uses the compact workbench report when present and `datasets/retrieval/offline-report.json` otherwise. No provider configuration or paid calls are involved.

## Automated outcomes

- Typecheck and build passed. Vite reports a bundle-size advisory.
- Full suite: 145 tests across 12 files passed, including 34 retrieval tests.
- Three-arm authored regression gate: 12/12 expected workflow and packet outcomes in each arm, 36/36 total; zero critical omissions and unsupported definitive claims on these fixtures.
- Original structured benchmark: 10/10 dispositions, 15/15 applicable mutation flips, no regression. The `tsx` wrapper could not open its IPC socket in the sandbox, so the identical CLI was invoked with `node --import tsx packages/eval-suite/src/cli.ts` and passed.
- Existing offline experiment versus `datasets/offline-experiment.json`: passed; zero provider calls and zero spend. Existing baseline files were preserved.
- Fault controls cover wrong-patient filtering, lying adapters, failed reads, hung calls, cancellation, source limits, malformed/repeated cursors, unsupported types, hash mismatch, duplicate/collision handling, invalid initial identity, gold isolation, omitted rows/dates/conflicts, irrelevant authentic citations, wrong actions, numeric nonfulfillment, export schemas, reproducible fingerprints, and instruction-like source text.

## Browser inspection

The Chrome DevTools connector could not open its shared profile because it was already in use. Inspection continued through the in-app browser at the local Vite server.

Verified complete, scattered, missing, contradictory, unavailable, and budget-exhausted retrieval variants in both clinical families. The lumbar scattered submission first needed information; successful retrieval restored the meeting-policy assessment. Missing lumbar evidence retained uncertainty. Unavailable and exhausted searches routed to clinical review. Conflicts retained both accounts, and later criteria showed not evaluated.

Verified exact source citation inspection with clinical date, raw resource and provenance; reset cleared prior results; JSON export displayed success and the exported workflow passed schema round-trip checks in the automated suite. The bundled report fallback rendered all three 12/12 summaries. Generated-report rendering uses the same shape.

Normal local fixtures completed before browser automation could activate Cancel. A temporary source adapter with a visible TEST ONLY banner delayed source operations for browser checks. Cancel then produced an incomplete cancelled result and clinical review. Switching variants during a pending run, then running the complete submitted-only case, retained the new successful result without an old-run overwrite. The delayed adapter and banner were removed after verification; published reports use the normal adapter. Automated pending-adapter cancellation and signal tests also passed.

## Label corrections and unchanged assessment limits

These are author-only corrections to the initial Phase 6 sidecars, not independent clinical review. No original 22-case fixture, policy, clinical threshold, or deterministic assessment rule was changed.

- A criterion skipped after a conflict has an insufficient-evidence placeholder in the assessment, but no execution trace. Packet/scorer expectations now explicitly require not evaluated and clinical interpretation, rather than a documentation request.
- Full-corpus budget cases have different gap/action labels from the bounded arm because harness assembly bypasses the read ceiling. Missing evidence and inaccessible sources remain missing/inaccessible.
- Lumbar partial therapy endpoints lack completion/adherence documentation. The fixed rules cannot accept their interpretation confidently, so the inherited orchestrator routes that case to clinical review while the packet requests the missing documentation.
- The fixed lumbar policy has no episode or recency restriction. Historical same-code therapy is an allowed citation candidate, separately from the required start/end evidence set. It can inflate the assessor's reported elapsed duration to 1,282 days. The packet copies the assessor faithfully; the UI and report flag this limitation. This is not proof of continuous therapy and needs a separately specified episode-aware assessment change before broader use.
- Critical fact scoring checks the rendered clinical date as well as the excerpt. Retrieval recall, packet conflict retention, citation provenance, and evaluation state are separate checks. Inapplicable citation/recall denominators are null, with raw counts retained.

Complete/scattered variants in each family share a recorded clinical-facts fingerprint. The twelve fixtures remain paired development/regression cases. Passing this authored gate establishes neither representative clinical reliability nor reduced reviewer effort.

## Next work

Record the sequence in `PHASE_6_VIDEO_BRIEF.md`. Phase 7 begins with the dependency audit in `roadmap/phase-7-evidence-sufficiency-and-routing.md`: freeze these evidence snapshots and compare the existing model ladder, keeping raw judgments separate from guarded workflow results. Any live acquisition still requires an explicit spend cap; none was run here.
