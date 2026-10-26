# Follow-up video: Finding the evidence and making escalation useful

Status: recording plan for Phase 6. Record results only after the implementation and verification are complete. Implementation specification: `roadmap/phase-6-retrieval-and-handoff.md`.

## Audience and central point

Audience: healthcare product leaders, interoperability engineers, and people assessing the practical value of AI-assisted prior authorization work.

Central point: evidence assessment depends on what records the system actually found. A useful escalation tells the next person what was found, which criterion it relates to, what remains uncertain, and what action is needed.

This follow-up should demonstrate a new question added to the original project: can retrieval and evidence packaging be evaluated separately from the final assessment?

## Story sequence

### 1. Reconnect to the original experiment

Suggested opening in your own voice:

“The first version asked how much model reasoning prior authorization evidence assessment needs. After sharing it, someone asked a useful follow-up: when the system sends a case to review, how good is the handoff? That led me to another question: did it actually find the relevant records first?”

Show the original model-comparison view briefly. Explain that the earlier evaluation started with an assembled FHIR bundle. Do not imply the earlier project already searched external systems.

If showing the comment thread, frame it as feedback that influenced the experiment. Do not imply a partnership, endorsement, or independently validated result.

### 2. Establish the control case

Show the complete lumbar MRI fixture, synthetic policy, criterion rows, and exact source evidence. Explain what the existing rules can establish and what the synthetic policy requires.

Keep this concrete: diagnosis evidence, therapy dates, and explicit documentation in the fixture. Avoid presenting the fixture policy as a real payer's medical-necessity rule.

### 3. Change where the records are stored

Switch to the scattered variant with the same clinical facts. Run submitted-only first. Show why the initial submission is insufficient.

Run retrieval. Open a source-search/read trace entry, then the recovered record and its provenance. Show the resulting criterion mapping and comparison with the complete case.

Suggested point: “The patient facts did not change. The system's access to the documentation did.”

State that these source boundaries are simulated local adapters. This recording demonstrates the retrieval contract and evaluation method.

### 4. Make the missing-versus-unavailable distinction visible

Show the truly missing variant and the bounded search scope. Open the packet's criterion-specific documentation request.

Then show the unavailable-source variant. Point out that the system cannot conclude the record is absent because the search did not complete. Open the suggested action to restore access or continue the search.

Suggested point: “A failed search is a different problem from missing documentation. The next action should reflect that.”

### 5. Show why a review packet needs both sides

Run the contradictory variant. Open both source records. Show clinical escalation, any criteria skipped after the safety stop, the unresolved conflict, and the question for the reviewer.

Explain why a real citation alone is insufficient: it can be authentic yet incomplete or mapped to the wrong requirement. The packet must retain material conflicting evidence.

### 6. Show how you tested the improvement

Open the generated report. Compare submitted-only, retrieval, and full available corpus reference arms. Report actual counts for evidence recovery, conflict retrieval, mapping accuracy, critical omissions, gap/action accuracy, and end-to-end fixture correctness.

Use at least one negative-control test to demonstrate that the scorer catches a dropped conflict or an irrelevant authentic citation. Label intentionally broken output as a test, never as a normal run.

Explain that the assessor stays fixed across arms so the experiment can isolate the effect of evidence access. Describe the twelve fixtures as authored paired regression cases across two scenario families.

### 7. Explain what this establishes and what comes next

Close with what the implementation actually demonstrated, including any failures. Separate three levels of evidence:

- Implemented: bounded retrieval, provenance, structured packet, and regression checks.
- Measured: exact outcomes on the authored synthetic fixtures, using the saved report.
- Still untested: real EHR retrieval, representative clinical performance, and reduction in reviewer time.

A natural next study would compare reviewers using a bare flag, a packet from supplied evidence, and a packet after retrieval. Measure decision correctness, chart searches, corrections, and time to a correct review outcome. Address learning effects through counterbalanced case assignment. This study is future work, not a benefit claimed in this video.

## Recording assets and readiness

- Working offline app with deterministic fixture selection and no credential setup.
- Saved retrieval report and snapshot with source revision/configuration fingerprints.
- One preselected lumbar sequence: complete → scattered → missing → unavailable → conflict.
- Knee family visible in the report to show the harness runs beyond one clinical fixture.
- Inspectable source records, clinical dates, policy/version, source traces, packet JSON export, and one negative-control test result.
- Browser checks completed for all six variants, citations, reset/cancel, and export.
- Exact results inserted into speaking notes after the benchmark. No placeholder percentages or invented time savings.

Potential title: **Prior Authorization: Testing Evidence Retrieval and the Clinician Handoff**.

Suggested closing thought: “The next thing I want to measure is whether this packet helps a reviewer reach the right conclusion with less additional searching. This phase gives me a way to test the evidence going into that handoff first.”
