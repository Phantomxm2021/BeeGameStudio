# Foundation Markdown restoration

## Scope

Restore the existing per-document Markdown authoring protocol. Do not split documents into section-level model calls or add an Author quality gate.

- New initial and parallel-draft dispatches no longer request a JSON body.
- Prompt construction always requests raw Markdown, including when rebuilding a request carrying legacy v2 metadata.
- The stream saves the original output and commits Markdown without JSON assembly or section/title validation.
- Removed the unused JSON body assembler and its tests. Historical request metadata remains readable; existing project outputs are not rewritten.
- Transport completeness, size limits, target identity, concurrent-write checks, receipts, and upstream provenance protections remain.
- Reviewer owns document quality findings; Revision handles review feedback. Their production code is unchanged by this restoration.

## Local verification

- Author suite: 146 tests passed, zero failures.
- Long Markdown regression includes Chinese/ASCII quotes, backslashes, unmatched braces, Mermaid, SVG, missing sections and duplicate headings; raw pending bytes remain exact.
- Offline lifecycle publishes eight imperfect documents with exactly eight author calls and no quality-triggered retries.
- Public Reviewer → Revision → Reviewer handoff test passed in the broader offline suite.
- Workflow server TypeScript check and git diff whitespace check passed.
- Combined Author/Reviewer/Revision suite: 754 passed, 5 failed because the sandbox denied Darwin process-identity queries (759 tests total). Rerunning that unchanged test file outside the sandbox passed all 6 tests, including the 5 affected tests. No remaining observed test failure.

No paid model generation, project restart/resume, or existing project document repair was performed. This is local protocol and lifecycle verification, not a claim of real-model content acceptance.

## Local service activation

On user continuation, restarted the idle runtime service on port 62174 using the existing launcher. Health returned ok. The latest project remains needs_action in DOCUMENT_DRAFTING; no project generation or paid retry was started.
