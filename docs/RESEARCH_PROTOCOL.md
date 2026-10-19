# Selective inference protocol

## Question and acceptance criterion

Does a rules → Jev → small → frontier cascade resolve more evidence checks safely than rules alone, at lower cost than frontier-only inference, without increasing unsafe resolutions?

Assess risk, coverage, and cost jointly. A system that sends everything to review has no observed unsafe resolution but no automation value. A cheap system that clears incorrect cases is not an improvement.

## Experimental units and arms

The unit of evaluation is a complete case. Requirement-level outputs must all match labels for a case to count as safely resolved. Every arm uses the same policies, patient-scoped context, gold labels, and citation checks. The four arms are rules, rules+Jev, cascade, and generative baseline. The generative baseline retains integrity checks and grounding validation.

The 22 cases comprise ten structured fixtures, four narrative development fixtures, and eight narrative challenge fixtures. Development supports prompt/threshold selection. Challenge tests paraphrase, negation scope, historical evidence, recommendations without measurements, ambiguity, contradictions, prompt injection, and distractors. These are hand-authored examples, not a representative clinical sample or independently reviewed ground truth.

## Acquisition and replay

The runner caches each model's normalized requirement judgment for a given input. Policies at different thresholds replay the same judgments. A higher threshold can acquire a later-tier judgment that a lower threshold never requests. Acquisition spend is the union of calls actually made; per-policy spend sums only calls used by that routing policy.

The cache is local to one experiment. It does not persist across experiments. Reports preserve normalized recordings for audit, but a new CLI run makes fresh calls. Consequently, use repeated independent runs to estimate model variability. Adapter latency records model/rule evaluation plus retry backoff, excluding orchestration and browser overhead. It is not end-to-end application latency.

Provider failures, missing usage, conflicting evidence, and invalid citations produce review. They are not successful model answers. Budget exhaustion must be distinguished from model abstention when interpreting low coverage; inspect traces and acquisition errors before comparing models.

## Confidence interpretation

Jev choice confidence summarizes its distribution and is not the winning option's probability. Generative confidence is self-reported. Neither is assumed calibrated for clinical use. The adapter uses the minimum confidence among the outcome and selected evidence relationships. Ambiguous/conflicting evidence abstains or escalates.

The default threshold sweep uses 0.70, 0.90, and 0.99 for model tiers while rules retain their fixed acceptance threshold. This is an exploratory comparison, not an optimized clinical operating point. Select an operating point on development data before looking at challenge outcomes. Do not report the best challenge threshold as held-out performance.

## Metrics and uncertainty

Report safe-resolution coverage, automation coverage, abstention rate, selective risk, false clearances, requirement accuracy, citation grounding, cost per safe resolution, tier calls and acceptances, and p50/p95 adapter latency. The report includes per-cohort summaries and 95% Wilson intervals for risk and safe coverage.

The `remove_supporting_evidence` counterfactual is a hand-authored synthetic probe, not independently validated clinical evidence. Fix applicability with the rules baseline: it and the fixture must meet policy, then select the first satisfied requirement with exactly one supporting citation and delete that resource. Requirements with several citations are skipped as targets; policy, patient, request, and other records remain unchanged. Five of the 22 fixtures qualify. The targeted rules status must become `insufficient_evidence` and disposition `needs_information`. A documented numeric value below a required threshold remains `not_satisfied`; absence alone does not establish failure.

**Uncertainty preserved** is the number of applicable targeted tier judgments returning `insufficient_evidence`, explicitly deferring/abstaining, or falling below the routing threshold, divided by all applicable probes evaluated for that tier. Provider errors, timeouts, and budget failures remain in the denominator without success credit. Zero applicable runs yields null. Test each configured tier directly on the same fixed probes so earlier-tier acceptance cannot conceal later-tier behavior. Use raw judgments before guardrail repair, report the rate and 95% Wilson interval per tier and threshold (0.70, 0.90, 0.99), and count `not_satisfied` answers with confidence at or above threshold as **confident not met**. Count confident `satisfied` answers separately and fail the absolute evidence safety gate, even when an authentic but irrelevant citation or guardrail escalation prevents a case clearance. Model tiers are unconfigured offline and receive null summaries, never simulated scores. Probe acquisition shares the experiment's cache and spending limits, while case coverage metrics continue to use the original 22 cases. Applicability and normalized probe observations are saved separately from provider context; prompts contain neither expected labels nor mutation names.

Safe-resolution labels assess a complete case; reliability bins relate accepted requirement routing scores to case-level safe resolution. They are deliberately conservative and are not a standard requirement-level calibration estimate. The intervals assume independent cases, although hand-authored fixtures can share structure. Treat them as illustrative uncertainty, not population-level clinical confidence intervals.

## Reproducibility and upgrade gates

Save model IDs, returned resolved model versions, source revision, adapter hash, dataset hash, protocol hash, normalized recordings, traces, and usage. No expected labels or case titles reach providers.

Comparisons require matching dataset/protocol hashes and matching arms/thresholds. They fail on increased unsafe resolutions/false clearances/unsupported citations, reduced safe coverage or disposition accuracy in any cohort, unverified usage, and policy cost increases greater than 10%. False clearances and unsupported citations additionally fail an absolute evidence safety gate. Latency is reported but not gated because small-run timing is noisy.

Comparisons also fail when uncertainty-preserved decreases for any tier/threshold, probe availability or denominator changes, or a probe produces confident satisfaction. The counterfactual protocol revision is fingerprinted; regenerate the offline snapshot when intentionally changing this protocol. The five related probes are too small and correlated to establish population reliability.

A model upgrade can change providers, prices, or behavior even with the same public alias. Prefer pinned model IDs. Inspect fingerprints and recordings rather than attributing every difference to model intelligence. Explicitly record prompt or adapter changes as a separate experiment factor.

## Before making a healthcare reliability claim

Expand case diversity and independently adjudicate labels. Include temporal sequencing, medication changes, multi-condition interactions, alternative policy branches, uncertain diagnoses, and subgroup analyses. Measure performance and review burden on a representative dataset. Test repeated acquisitions and calibration. Keep clinical date/code arithmetic outside models. Validate relevant interoperability transactions separately from evidence-assessment accuracy.
