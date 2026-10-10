# Test and record the workbench

This historical guide describes the October 6 app. Use the [updated research walkthrough](../WALKTHROUGH.md) for the current comparison screen and live-provider configuration.

## Prepare

Use only the bundled synthetic data. No API account or credentials are needed. Record this as a demonstration of deterministic evidence checks, provenance inspection, and safe escalation. Label the ten-case benchmark as a small synthetic baseline.

Before a public recording, correct the offline/provider labels and the benchmark claims identified in REVIEW.md. If recording the current state internally, explain those limitations aloud.

From the repository root, run these commands individually:

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run benchmark
```

Then start the browser app:

```bash
npm run dev
```

Open http://localhost:5173. If port 5173 is occupied, use the URL the server prints. For a static build demonstration, run the benchmark before the final build so the built app contains the latest report, then run `npm run preview` and use its printed URL.

Expected baseline: 42 tests pass; ten dispositions match; nine applicable mutations flip correctly; zero unsupported citations; $0 inference cost. Latency varies by machine. These checks do not cover the additional failures documented in REVIEW.md.

Replay those failures without paid calls:

```bash
node docs/review-2026-10-06/reproduce.mjs
```

The replay prints observed failures; it is a diagnostic script, not a passing safety gate. After repairs, convert these scenarios into assertions that fail on the old behavior.

## Browser rehearsal

| Action | Expected result |
| --- | --- |
| Select the positive lumbar case, rules strategy, no mutation; evaluate | Meets policy, two rule trace steps, $0 |
| Click a requirement citation | Inspector shows the cited resource; Raw JSON shows matching ID/code/date |
| Shorten conservative therapy on the positive lumbar case; evaluate | Needs information; therapy duration fails |
| Reset mutation, then inject clinical negation; evaluate | Requires clinical review; no later-tier override |
| Select deficient knee case | Needs information for missing prerequisite radiograph |
| Select right-knee request with left-knee radiograph | Needs information for laterality mismatch |
| Select conflicting lumbar case | Requires clinical review |
| Change case, strategy, or mutation after evaluation | Old assessment and trace clear |
| Open Measured Benchmarks | Stored report, timestamp, rules strategy, ten cases and nine applicable flips |

The ten baseline cases currently resolve at the rules tier under both strategies. Selecting tiered does not demonstrate a live Jev call. To demonstrate honest offline fallback, use a purpose-built unresolved narrative fixture after adding it to the case list; it should reach the offline probe/unconfigured LLM and escalate. Do not use simulation as evidence of live model performance.

## Recording setup

Use a desktop browser window around 1440×900 or 1920×1080. Increase zoom if the evidence text is too small to read in the exported video. Turn on Do Not Disturb, close unrelated tabs, and position the cursor before recording. On macOS, Shift-Command-5 opens screen recording; choose the browser area and microphone in Options.

Capture the screens as separate short clips if narration or navigation needs another take. Leave a pause after each result so viewers can read the disposition. Do not show terminal credentials or account settings.

## Walkthrough sequence and narration

### 1. Introduce the question

Show the workbench with the positive lumbar case selected.

“This workbench asks how much prior-authorization evidence checking can be done with deterministic rules before we need model judgment. Everything shown here is synthetic.”

### 2. Explain the three panels

Point to the clinical timeline, policy requirements, and outcome/trace panel.

“On the left is the FHIR record. In the center are the policy requirements. On the right we can inspect the assessment and see how each requirement was evaluated.”

### 3. Evaluate a complete case

Choose rules, no mutation, and evaluate. Open the diagnosis citation, switch to Raw JSON, and close the inspector.

“This case has a matching diagnosis and therapy dates spanning the policy minimum. Each result points back to a specific record. This is a benchmark assessment, not a payer authorization.”

### 4. Remove sufficient evidence

Choose Shorten Conservative Therapy Duration and evaluate.

“When we shorten the documented therapy span, the requirement no longer passes. The result asks for more information.”

### 5. Introduce a contradiction

Reset the mutation, choose Inject Clinical Negation / Refutation, and evaluate.

“When a record contains the tested contradiction, the assessment escalates to clinical review. The cascade preserves that escalation.”

### 6. Show another safety boundary

Choose the right-knee request with left-knee-only imaging and evaluate.

“A prerequisite must apply to the requested side. This opposite-side record does not satisfy it.”

### 7. Explain the benchmark and next milestone

Open Measured Benchmarks and point to the timestamp and rules strategy.

“The current baseline matches all ten hand-authored cases and all nine applicable mutation tests at zero model cost. Those numbers describe this small synthetic dataset. The next work is stronger adversarial coverage and a held-out comparison using live Jev and generative tiers.”

If discussing providers, add: “The Jev-labelled component currently shown in this app is an offline narrative probe. Live Jev integration is planned and is not measured in this report.”

## Final playback check

Watch the exported recording once. Confirm citations and dispositions are legible, the case and mutation changes are visible, audio is clear, and the narration does not claim live Jev, independently validated clinical accuracy, an actual PAS transaction, or payer approval.
