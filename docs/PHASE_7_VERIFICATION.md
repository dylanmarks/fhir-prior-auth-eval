# Phase 7 verification

Implementation base: Phase 6 commit `383ab99`. This implementation is captured by the source/dependency/protocol/input/gold fingerprints in `results/evidence-sufficiency/offline-report.json`. That report records the parent revision and dirty-tree state rather than claiming an uncommitted tree is the parent commit.

## Delivered

- Dedicated evidence-sufficiency dataset, manifest, author-only overlays, and immutable snapshots: twenty primary fixtures and a separate numeric control.
- Existing four strategies across three evidence-access arms and three model thresholds, with rules fixed at 0.90.
- Raw tier recordings, isolated direct probes, cache keys with replicate boundaries, shared acquisition admission, explicit unavailable/failed/cancelled outcomes, and separate acquisition/policy/direct-probe accounting.
- Snapshot-specific clinical, raw-safety, packet-action, conflict, risk/coverage, and paired-contrast scoring; inherited Phase 6 scores retained on its cells.
- Opt-in live CLI with mandatory explicit spend cap checked before provider setup. Offline CLI, full report, Markdown summary, compact view report, and checked-in fallback.
- Saved-report comparison view for evidence access, strategies, raw versus guarded judgments, selected packet, source records, provenance, and workflow export.

## Actual offline measurements

The matrix contains 720/720 primary cells (20 fixtures × 3 access arms × 4 strategies × 3 thresholds), plus 36 control cells. Only the 180 rules cells are fully measured. No provider model judgments were acquired; actual provider acquisition count and spend are zero.

At each threshold, rules safely resolve 24/60 evidence snapshots and abstain on the remaining 36. There are zero unsafe final resolutions among those 24 resolutions. Rules thresholds do not vary, so these are repeated policy views rather than independent results.

The empirical packet-safety gate **does not pass**: twelve flags cover four narrative conflict snapshots replayed at three thresholds. Specifically, the PT-progress and lumbar-therapy conflict variants retain their contradictory notes in bounded and full-corpus evidence, but the rules do not recognize those conflicts and the resulting packet omits the mandatory conflict evidence. The assessment routes to review, so this is a handoff-fidelity failure rather than an unsupported final clearance. No labels or prompts were changed to hide it. Unacquired model packets are excluded from measured packet-safety denominators; any acquired raw observations in partial strategies are still checked.

The broader uncertainty measure alone would miss this limitation: rules preserve uncertainty on 34/34 applicable direct gap/conflict probes at each threshold, while some packets still fail conflict retention. This is why raw judgment, final disposition, and packet fidelity are separate measures.

Model summaries show 96 scheduled direct probes per tier per threshold, zero acquired, and 96 unavailable. Their acquired-only performance rates are null. Scheduled zero unsafe counts are not model-safety measurements. The new challenge family is authored, not independently validated.

## Automated checks

- Full test suite: 168/168 tests across 13 files passed, including 23 new sufficiency tests.
- Typecheck and build passed. The existing main application bundle still triggers Vite's size advisory. The sufficiency component is loaded separately; its large saved report is emitted as a JSON asset and fetched only when the tab is opened.
- Original structured benchmark: 10/10 outcomes and 15/15 applicable mutation flips passed. Used `node --import tsx packages/eval-suite/src/cli.ts` to avoid the sandbox's restriction on the `tsx` wrapper's IPC socket.
- Existing offline experiment comparison passed with zero provider calls.
- Phase 6 retrieval experiment reproduced 36/36 authored checks. Its tracked reports and all original baselines were restored after verification, preserving the completed Phase 6 artifacts.
- `npm run experiment:sufficiency` emitted the full offline matrix and honest model-unavailable results.
- `npm run experiment:sufficiency -- --live` rejected before provider setup because `--max-spend` was missing. No paid acquisition was run.
- Fault tests cover immutable evidence across strategy/probe paths; evidence/policy/date/configuration/adapter/replicate cache invalidation; threshold reuse; direct probes after early rules acceptance; shared caps; unknown usage and deadlines; interrupted matrices; raw unsupported satisfaction contained by guards; irrelevant authentic citations; missing-as-nonfulfillment versus numeric failure; completeness overrides; skipped criteria; gold isolation; unavailable denominators; safe configuration export; invalid view references; and policy costs that count repeated invocations separately from unique acquisition spend.

## Interface checks and remaining blocker

Interactive browser inspection was attempted, but the browser tool reported: “Local browser use is disabled in Work settings.” No setting was changed or bypassed. Consequently, live browser checks for fixture/access switching, raw/final inspection, citation dialog, selected workflow download, generated-report fallback, and responsive layout remain unverified for this new tab.

As an automated substitute for part of that inspection, the component was server-rendered against the saved offline report and a temporary, visibly labeled TEST ONLY fault report. Render checks passed for visible unacquired-model state, evidence-access comparison, export control, test-only banner, raw unsupported satisfaction beside a blocked guard result, and escaped instruction-like source text. View schema validation and raw/packet separation also pass in the test suite. These checks do not establish interactive browser behavior. The temporary fault report was kept outside benchmark outputs.

## Next empirical step

After browser use is enabled, complete the pending interface walkthrough. Then, with explicit existing provider model pins, prices, and a separately authorized dollar cap, run one live acquisition replicate using the command in `PHASE_7_PROTOCOL.md`. Inspect raw judgments, hidden conflicts, and paired improvements/regressions before proposing a routing or packet intervention. Do not infer a model ranking from the offline report. Policy-version work remains separate.
