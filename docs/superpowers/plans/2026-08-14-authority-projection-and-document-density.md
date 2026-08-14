# Authority Projection and Document Density Implementation Plan

**Goal:** Reduce document-generation input/output tokens without changing the native agent core or moving authorship into BGS.

**Boundary:** BGS may select, copy, checksum, and route already-authoritative source sections. It must not summarize, rewrite, checkpoint, or author game-document prose. Native Write/Edit and conversation compression remain untouched.

## Task 1: Make selected upstream authority self-contained

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`

1. Add failing tests proving the projection contains the exact bytes and digest of every contracted upstream section, excludes unselected sections and production materials, and gives no instruction to reread whole upstream documents.
2. Run the focused tests and confirm RED.
3. Add immutable `content` and `digest` fields to projected sections. Copy bytes directly from the selected source range; do not summarize or transform them.
4. Update the authority block to treat the projection as the complete selected upstream input, while retaining source paths/digests for integrity checks.
5. Run the focused tests and confirm GREEN.

## Task 2: Enforce production-dense document responsibilities

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`

1. Add failing tests for a universal contract rule: sections contain final owned decisions and stable IDs, not process narrative or upstream restatement; production materials are compact canonical views and do not repeat section prose.
2. Add failing prompt tests requiring one worked example per formula/system boundary unless the contract explicitly requires distinct cases, and only materially distinct acceptance scenarios.
3. Run the focused tests and confirm RED.
4. Add the policy once at the contract factories and once in the authoring prompt. Do not add game-specific exceptions or byte caps.
5. Run the focused tests and confirm GREEN.

## Task 3: Verify and measure through Web React

1. Run focused backend tests, the affected document-system suite, typecheck, and `git diff --check`.
2. Start the fixed-port BGS stack and use Chrome through the Web React UI to create a fresh test project.
3. Let GDD and downstream document generation run far enough to exercise the authority projection; do not edit the test project to force success.
4. Verify logs show downstream agents reading the selected projection rather than rereading full upstream documents, unless an explicit digest/integrity failure is recorded.
5. Compare fresh input tokens, output tokens, elapsed time, document size, and validation results with the previous baseline. Stop and diagnose from logs if the flow stalls or violates the BGS boundary.
