# Evidence retrieval and review handoff

Synthetic authored regression benchmark. Three arms share the same fixed rules assessor.

| Arm | Expected workflow outcomes | End-to-end packet checks | Critical omissions | Unsupported claims |
| --- | ---: | ---: | ---: | ---: |
| submitted_only | 12/12 | 12/12 | 0 | 0 |
| retrieval | 12/12 | 12/12 | 0 | 0 |
| full_corpus | 12/12 | 12/12 | 0 | 0 |

| Fixture | Arm | Workflow | Packet gate |
| --- | --- | --- | --- |
| scn-701 · lumbar_mri · complete | submitted_only | meets_policy | PASS |
| scn-701 · lumbar_mri · complete | retrieval | meets_policy | PASS |
| scn-701 · lumbar_mri · complete | full_corpus | meets_policy | PASS |
| scn-702 · lumbar_mri · scattered | submitted_only | needs_information | PASS |
| scn-702 · lumbar_mri · scattered | retrieval | meets_policy | PASS |
| scn-702 · lumbar_mri · scattered | full_corpus | meets_policy | PASS |
| scn-703 · lumbar_mri · missing | submitted_only | needs_information | PASS |
| scn-703 · lumbar_mri · missing | retrieval | requires_clinical_review | PASS |
| scn-703 · lumbar_mri · missing | full_corpus | requires_clinical_review | PASS |
| scn-704 · lumbar_mri · contradictory | submitted_only | meets_policy | PASS |
| scn-704 · lumbar_mri · contradictory | retrieval | requires_clinical_review | PASS |
| scn-704 · lumbar_mri · contradictory | full_corpus | requires_clinical_review | PASS |
| scn-705 · lumbar_mri · unavailable | submitted_only | needs_information | PASS |
| scn-705 · lumbar_mri · unavailable | retrieval | requires_clinical_review | PASS |
| scn-705 · lumbar_mri · unavailable | full_corpus | requires_clinical_review | PASS |
| scn-706 · lumbar_mri · budget_exhausted | submitted_only | needs_information | PASS |
| scn-706 · lumbar_mri · budget_exhausted | retrieval | requires_clinical_review | PASS |
| scn-706 · lumbar_mri · budget_exhausted | full_corpus | meets_policy | PASS |
| scn-707 · knee_mri · complete | submitted_only | meets_policy | PASS |
| scn-707 · knee_mri · complete | retrieval | meets_policy | PASS |
| scn-707 · knee_mri · complete | full_corpus | meets_policy | PASS |
| scn-708 · knee_mri · scattered | submitted_only | needs_information | PASS |
| scn-708 · knee_mri · scattered | retrieval | meets_policy | PASS |
| scn-708 · knee_mri · scattered | full_corpus | meets_policy | PASS |
| scn-709 · knee_mri · missing | submitted_only | needs_information | PASS |
| scn-709 · knee_mri · missing | retrieval | needs_information | PASS |
| scn-709 · knee_mri · missing | full_corpus | needs_information | PASS |
| scn-710 · knee_mri · contradictory | submitted_only | meets_policy | PASS |
| scn-710 · knee_mri · contradictory | retrieval | requires_clinical_review | PASS |
| scn-710 · knee_mri · contradictory | full_corpus | requires_clinical_review | PASS |
| scn-711 · knee_mri · unavailable | submitted_only | needs_information | PASS |
| scn-711 · knee_mri · unavailable | retrieval | requires_clinical_review | PASS |
| scn-711 · knee_mri · unavailable | full_corpus | requires_clinical_review | PASS |
| scn-712 · knee_mri · budget_exhausted | submitted_only | needs_information | PASS |
| scn-712 · knee_mri · budget_exhausted | retrieval | requires_clinical_review | PASS |
| scn-712 · knee_mri · budget_exhausted | full_corpus | meets_policy | PASS |

- Twelve authored paired regression fixtures across two families; labels are author-only. No clinical validation or reviewer-time measurement.
- Local simulated sources only. The full-corpus arm uses harness assembly, bypassing retrieval limits but retaining availability and identity checks.
- The fixed lumbar policy has no lookback/episode rule. Historical matching therapy is retained and can inflate reported elapsed duration; elapsed span does not establish continuous therapy.
- Partial lumbar therapy without completion/adherence documentation remains uncertain and routes to clinical review under the fixed orchestrator.

Source revision: 8d969b4b63b51bff5597fbda64c2f08f270a25c1; dirty: true.
Implementation fingerprint: 901f75d6a3ea8689bf056bb726a5f03fd85262081e807835da8558cdce257e61.
