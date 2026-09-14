# Foundation delegate handoff reliability — 2026-09-12

## Incident and evidence boundary

The paper-plane acceptance run paused after eight minutes without changed document contents. It had delivered two of eight private drafts; Reviewer and Revision had not started. One TaskOutput failure was recorded only as `unknown`, so its original error cannot be reconstructed or asserted as proven.

Two independently reproducible runtime defects were addressed: terminal task eviction removed the only TaskOutput lookup source, and `--no-session-persistence` left advertised background output links pointing at nonexistent transcripts. The new native regression also exposed background Write requests being auto-denied before reaching the existing host permission broker.

## Changes

- Background and automatically backgrounded local agents retain bounded terminal result receipts independently of full conversation persistence. Session-scoped atomic writes use private file permissions; no-persistence output files are standalone readable records. Completed/failed notifications await receipt publication. Failed persistence keeps the in-memory result ineligible for eviction.
- TaskOutput falls back to the session's receipt after eviction, including eviction during a blocking wait. Recovery is explicitly labeled `retrieval_source=receipt`. Unknown IDs receive `TASK_RESULT_NOT_FOUND`; malformed and linked receipts fail closed.
- File-writing Agent calls support `expected_output_files`. Autonomous Author requires an assigned scope within its eight canonical paths. Before a successful handoff, the runtime checks regular, unlinked, nonempty files and returns byte lengths and SHA-256 hashes. This is structural handoff verification, not semantic review or a new host-authored document schedule.
- Author is instructed to inspect the handoff and scoped document contracts, preserve valid drafts, and resolve only concrete omissions. A result lookup failure is not a reason to repeat the whole delegation group. The existing stop-loss limits and absence of automatic host retries remain unchanged.
- The isolated native stdio permission broker advertises background-request support through the permission callback and its wrapper. Background delegates can ask that broker instead of being automatically denied for lacking a UI. Ordinary SDK sessions retain their prior default, and explicit denials, read-only files, workspace boundaries, shell sandboxing and credential scrubbing remain enforced.
- Native diagnostics retain specific bounded error codes, template-based redacted summaries and error fingerprints, including failed tasks returned by a successful TaskOutput call. Raw prompts, generated documents and arbitrary error bodies are not added to metadata logs. Background failure detail stays in the private result receipt.

## Verification

- 377 passing tests across the Author, Reviewer, Revision and shared native runtime suites, including independent public-chain convergence through one and two repair rounds.
- 25 passing LocalAgentTask lifecycle tests, including delayed receipt persistence and preservation after a disk-write failure.
- 16 passing receipt, file-handoff and diagnostic tests, including traversal/link rejection, corrupt receipts, JSON-escaping size bounds, unchanged existing drafts, empty/missing files and sensitive-content exclusion.
- Two additional real bundled CLI tests against a local scripted provider: an agent that only says it is done fails file handoff; a completed background result remains retrievable after the real 30-second task-GC grace period. The latter also proves permitted document writes and denied read-only/outside writes.
- Total: 420 distinct passing tests. TypeScript and `git diff --check` pass. The final native build additionally reran the two existing parallel/complete-bundle CLI fixtures successfully.

These are offline/runtime and lifecycle acceptance results, not evidence of real-model document quality. No paid model attempt was started by this change. The local five-service development stack was rebuilt and restarted; the original paper-plane project remains `needs_action` with its drafts preserved, pending explicit paid resume.
