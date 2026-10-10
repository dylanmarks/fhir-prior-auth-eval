# Reviewer walkthrough

Run `npm run benchmark`, `npm run build`, and `npm run dev` individually. No credentials are required for the bundled offline demonstration.

## Recording sequence

1. **Open Model comparison.** Say: “The question is how much healthcare evidence checking we can resolve with a cheap typed model before paying for larger reasoning. This harness measures safe coverage, risk, and cost together.”
2. **Compare cohorts.** Select structured, then challenge. Explain that rules resolve the structured checks, while narrative cases defer. Unconfigured model rows are offline behavior, not model performance.
3. **Explain the threshold.** Move between 70%, 90%, and 99%. Say: “These policies replay recorded judgments. With live providers, a higher threshold routes more uncertain requirements to later tiers. Confidence needs validation against labeled outcomes.”
4. **Show the evidence workbench.** Evaluate the complete lumbar case with rules. Open a citation, switch to raw JSON, and point out the source ID/date and documented therapy continuity.
5. **Change the evidence.** Shorten therapy and show needs-information. Inject negation and show clinical-review escalation. Explain why a contradiction stops the cascade even if a later model could return a confident answer.
6. **Show the narrative gap.** Select Dev progress, choose tiered, and keep offline execution. The trace shows rules deferring and unavailable models abstaining. Say: “The live comparison must demonstrate what Jev adds here; the harness does not manufacture that result.”
7. **Close with regressions.** Explain that the same dataset/protocol can compare new model versions and fail on unsafe answers, reduced safe coverage, or higher cost. Show the saved report fingerprints and uncertainty interval.

## For a live recording

Configure `.env` from `.env.example`, including current prices and pinned Jev/small/frontier model IDs. Run `npm run experiment -- --live --max-spend 2` to create the comparison report. Start `npm run serve` separately. In the browser, load the latest experiment, check providers, and choose local evaluator execution. Paid calls are made only after these explicit actions.

Rehearse before recording. Keep the browser around 1440×900 or 1920×1080, use sufficient zoom, turn on Do Not Disturb, and use macOS Shift-Command-5 to record the browser area and microphone. Pause after each result so the text is readable. Watch the export once and check audio, citation legibility, and outcome transitions.

Keep the closing claim proportional to the evidence: this is a working synthetic research harness. Live model viability remains an empirical result, and clinical reliability requires broader independently reviewed data.
