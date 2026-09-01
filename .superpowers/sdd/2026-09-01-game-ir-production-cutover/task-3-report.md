# Task 3 report — committed Game IR reader and compilation route

Status: complete; production recovery blockers and final public-reader evidence debt are closed.

## Changes

- Added `game-ir/committed-reader.ts`, the sole workspace/run-bound committed Game IR reader. It obtains Foundation READY through the adapter, recovers the durable checkpoint through the Task 2 loader, validates the committed publication tree, exact six-module coverage, canonical candidate, source maps, dependency graph, semantic evidence, marker, and all receipt/checkpoint/authority digests, then returns typed execution/resource/acceptance projections.
- Added strict reader/route coverage for alternate-authority rejection, forged compiler terminals, the canonical six-module/fallback matrix, admission→checkpoint→publication→reader order, retry progress identity, and latest-durable-state recovery.
- Added the service-bound compiler dispatch contract and domain-specific compiler terminal schema/prompt.
- Service now authenticates the READY Section Index and every canonical Foundation document as regular files, verifies their recorded digests, and builds immutable per-domain source packets. Both compiler dispatches retain `allowedPaths: []` and `projectReadScope: 'empty'`, while the contract carries the service-owned packets.
- Compiler DTOs are strict semantic/validation model unions; mechanical receipts are deterministic empty service authority. Dispatch admission binds run, dispatch, task, revision, compile request, and READY receipt before persistence.
- Routed Foundation READY into one deterministic `GAME_IR_COMPILATION` identity. Worker terminals now carry domain-result DTOs only; the service admits them through the Phase 4–7 domain assemblers, calls the Task 2 checkpoint writer for each stage, commits publication, reloads/revalidates through the sole reader, and only then crosses to `DOCUMENT_REVIEW/CHECKLIST_DRAFTING`. Recovery admits a persisted compiler terminal before deriving another dispatch. A changed semantic failure retries the same identity; the same unchanged failure becomes `needs_action`. There is no attempt/time/token/cardinality cap.
- Public execution/resource/acceptance projections include schema-parsed discriminated `{ kind, value }` payloads alongside typed identity, producer mode, relationship, and source-binding fields.
- Resume uses Task 2 loader/recover to adopt only a valid committed prefix, skips already committed phases, retries publication from a committed Phase 7 checkpoint, and never restarts Phase 4. Durable progress identity excludes dispatch/transport randomness and differentiates changed business state from unchanged/no-transition attention.
- Every compiler attention state persists phase, step, taskId, workerType, reasonCode, expected, actual, diagnosticRef, and recoveryAction; the UI/API projection exposes only the safe reason and diagnostic ID. Persisted workflow schema is v49.
- Added transition identity checks and safe Game IR compilation/publication display reason codes. Foundation reviewer/revision/issue-registry modules were not modified.

## TDD

- RED: the exact recovery matrix proved that a persisted compiler terminal was overwritten by a fresh compiler dispatch because the `GAME_IR_COMPILATION` branch ran before the generic terminal replay path. Once replay became reachable, the test exposed non-JSON `undefined` values in failure/checkpoint progress digests.
- GREEN: compiler terminal admission now precedes compilation dispatch derivation; missing candidate/checkpoint state has an explicit canonical `null` representation; material numbers remain part of failure identity while only transport counters are normalized. The matrix proves one retry for changed progress and deterministic `needs_action` for the same repeated failure.

## Verification

- `bun test .../committed-reader.test.ts .../stage-boundary.test.ts .../workflow-display-message.test.ts .../session-routes.test.ts`: 72 passed, 0 failed, 380 assertions.
- `bun test .../delivery-workflow-recovery.test.ts`: 107 passed, 0 failed; the compiler is now part of the exact persisted-worker recovery matrix.
- `bun test .../stage-checkpoint.test.ts .../publication.test.ts`: 45 passed, 0 failed.
- `bun test .../schema-evolution.test.ts .../transition.test.ts .../worker-prompts.test.ts`: 44 passed, 0 failed.
- `bun test .../foundation-parity.test.ts`: 6 passed, 0 failed; all 21 protected Reviewer/Revision files remain byte-stable.
- `bun run typecheck` from `packages/agent-workflow-server`: passed.
- Changed-file `biome lint`: passed; `git diff --check`: passed.

## Self-review / concerns

- The compiler worker is intentionally admitted only through the strict domain-specific terminal contract; it cannot supply alternate reader state, candidate, mechanical receipt, checkpoint, READY receipt, or fallback publication.
- Invalid committed publication is persisted as a safe reason code plus diagnostic ID and never returned to a downstream consumer.
- No Task 3, Task 4, Foundation Reviewer, or Foundation Revision files were changed beyond the documented shared workflow schema/test evidence.

Commits through the last reviewed implementation: `5a266f934`, `97af34c77`, `b55b13ce1`; the post-audit stabilization changes are included with this report.

## Final evidence and secure-file ruling

- The public reader now rejects digest-resealed duplicate/remapped/placeholder modules, detached semantic evidence, detached source maps and dependency graph, every READY/run/checkpoint digest mismatch, and absent canonical publication even when staging/old/previous directories exist. These cases call the sole public reader against real Phase 4→7 checkpoint/publication files.
- The secure-file implementation validates canonical containment and target identity before open, uses `O_NOFOLLOW`, compares the opened descriptor with both pre-open and post-open target identities, and verifies parent directory identity across open. A deterministic ABA interleaving would require a production scheduling hook. That hook is deliberately not added because it would expand production API only for testing without closing an unverified code path. Cost if wrong: a future secure-file refactor could weaken one identity check without a deterministic race test; the existing symlink/component and identity checks must therefore remain part of the public-reader regression suite.
- No production file changed while closing this evidence debt. Task 3A may begin; Task 9–15 remain blocked.
