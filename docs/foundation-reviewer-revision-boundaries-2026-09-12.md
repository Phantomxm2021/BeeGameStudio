# Reviewer quality and Revision scope

## Changes

- Reviewer now materializes `requirements.md`, matching Author and Revision. Eight source documents remain byte-for-byte copies.
- A small deterministic Markdown-link check writes read-only `review-context/file-checks.json`. It records the input inventory and source-relative file targets. It does not probe the network, infer links from prose/code, check anchors, assign severity, or decide acceptance. Absence from the supplied document set is not proof that an external project resource is missing.
- Reviewer quality instructions cover requirement violations, cross-document contradictions, and numerical/timing/state-rule incompatibilities. Calculations or counterexamples belong in the existing `actual`/`expected` fields. No new report schema, reading order, coverage ledger, tool restriction, or model retry loop was added.
- Re-review retains complete current documents, exact diffs, prior findings and Revision explanations. It must independently reassess old issues and investigate omissions/regressions, including unchanged documents. Revision claims cannot establish a pass.
- Revision is assigned only the handed-off findings and directly necessary related-file corrections. It verifies those changes; it must not start a fresh comprehensive audit or expand to unrelated repairs. Disputed/unresolved findings and incidental concerns go in its summary. Finding IDs are retained in `review.json` for traceability.
- The workflow remains the owner of subsequent Reviewer dispatch and acceptance. Revision produces a candidate, not an approved document set. Related-file edits remain possible; semantic scope is expressed in the task contract, not a misleading per-file write prohibition.
- Regression testing exposed a Reviewer observation race: reading state before checking the execution lease could project an old unpublished snapshot as needs-action after publication had finished. Ownership is now observed before reading terminal facts; no execution or retry is triggered by this read.

## Validation boundaries

Offline tests cover canonical paths, immutable evidence, Markdown parsing/path resolution, unprovided resources, prompt/task boundaries, generated numerical evidence with unchanged dependent documents, and existing review/revision/workflow lifecycle behavior. The generated-parameter test validates arithmetic and evidence transport, not an LLM's ability to discover the contradiction.

Final verification: 379 tests passed across the Reviewer, Revision and delivery-workflow suites (77 files, zero failures). Server TypeScript checking and git diff whitespace checking passed. Concurrent independent readers are included in the settlement/publication race regression.

No project-specific fixed regression fixture is introduced. No paid model call, workflow resume, or service restart is part of this change. Existing persisted attempts and accepted artifacts are not rewritten. Live detection quality, scope compliance and latency still require an explicitly launched model acceptance run.
