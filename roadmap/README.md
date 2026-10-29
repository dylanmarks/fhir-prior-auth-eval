# Research roadmap

The current implementation and measured scope are documented in the [README](../README.md) and [research protocol](../docs/RESEARCH_PROTOCOL.md). The numbered phase files are historical design notes, not claims of completed work or validated clinical performance.

## Completed infrastructure

- Synthetic FHIR indexing, integrity checks, deterministic evidence rules, citations and counterfactual mutations.
- Typed Jev Decisions adapter and structured generative adapters with explicit offline abstention.
- Confidence cascade, retry accounting, budget admission and clinical-review escalation.
- Paired experiment arms, threshold replay, development/challenge cohorts, uncertainty intervals and model regression gates.
- Evidence workbench, comparison view, local credential-holding evaluator, and stdio MCP.

## Next empirical milestones

1. Acquire a live Jev/small/frontier baseline using pinned versions and explicit prices.
2. Choose a routing threshold on development data, freeze it, and assess challenge risk/coverage.
3. Independently review labels and expand cases across clinical scenarios and policy alternatives.
4. Repeat model acquisitions to quantify variability and evaluate calibration.
5. Compare new model releases on the frozen protocol and inspect regressions by case/cohort.
6. Evaluate external representative data and interoperability conformance separately before claiming healthcare workflow reliability.

Real PHI integration, clinical validation, and Da Vinci PAS transactions are outside the current implementation.

## Evidence sufficiency experiment

[Phase 7](phase-7-evidence-sufficiency-and-routing.md) now materializes fixed evidence snapshots across the existing model ladder, with raw tier probes, recording/replay, separate spend accounting, and a saved-report comparison view. The offline matrix emits all 720 primary cells; 180 rules cells are measured and model cells remain unacquired. The report retains twelve narrative conflict-packet flags. [Verification](../docs/PHASE_7_VERIFICATION.md) records passing automated checks and the interactive browser blocker. Live model measurement still requires a separately authorized cap.

## Proposed next phase

[Phase 6: evidence retrieval and review handoff](phase-6-retrieval-and-handoff.md) now has an offline runner, three-arm report, and workbench. Its 36 authored fixture/arm checks pass. See [verification and limitations](../docs/PHASE_6_VERIFICATION.md), including the browser fault-injection checks and the fixed lumbar policy's historical-therapy limitation. The [follow-up video brief](../docs/PHASE_6_VIDEO_BRIEF.md) defines the demonstration. [Phase 7](phase-7-evidence-sufficiency-and-routing.md) remains queued behind its dependency audit and Phase 6 acceptance requirements.
