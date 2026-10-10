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
