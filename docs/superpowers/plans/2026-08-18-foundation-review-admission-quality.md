# Foundation Review Admission Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent non-blocking, precedence-resolved, and solution-biased Reviewer candidates from entering the canonical Foundation `review.json` while preserving the existing Markdown receipts, local deterministic v3 assembly, and four-task Dashboard.

**Architecture:** Keep the three concurrent lane Reviewers, receipt-only synthesis, and mechanical local assembler unchanged. Tighten only the model-facing admission contract, derive the terminal retained-conflict count from the already accepted canonical artifact, and remove the revision-local staging directory only after the final report commits. Bee Game Studio continues to validate structure, identity, authority, digests, and persistence; it does not decide semantic correctness.

**Tech Stack:** TypeScript, Bun test runner, Zod, Markdown AST parsing, React workflow card projection.

**Spec:** `docs/superpowers/specs/2026-08-17-human-team-foundation-review-design.md`

## Global Constraints

- Keep `FOUNDATION_REVIEW_VERSION = 3` and the existing canonical JSON fields.
- Keep exactly three concurrent lane Reviewers followed by one synthesis Reviewer.
- Keep the existing lane Markdown and selection Markdown grammars.
- Keep the parser's hard maximum of eight lane candidates; frame it as a safety bound, never a target.
- Zero candidates is a valid lane result and an all-empty selection produces `READY`.
- Synthesis reads only the three accepted lane receipts and never rereads canonical documents.
- Bee Game Studio never decides whether a semantic conflict exists, rewrites a candidate, or introduces local semantic filtering.
- The Workflow Card remains the sole four-task UI; no conflict panel, raw JSON view, or second task system is added.
- No native runtime core, model endpoint, retry policy, or legacy compatibility path changes.

---

### Task 1: Tighten Lane and Synthesis Admission Instructions

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts`

**Interfaces:**
- Consumes: existing `buildWorkerPrompt(request)` and `foundationReviewLaneMarkdownInstruction(expected)` behavior.
- Produces: the same Markdown grammar with stricter semantic instructions; no type or schema change.

- [ ] **Step 1: Write failing lane-prompt tests**

Add assertions proving the lane prompt:

```ts
expect(prompt).toContain('Zero candidates is valid')
expect(prompt).toContain('hard safety maximum, not a target')
expect(prompt).toContain('Different representation sizes are not inherently contradictory')
expect(prompt).toContain('explicitly takes the stricter value')
expect(prompt).toContain('must identify the implementation or acceptance result it blocks')
expect(prompt).toContain('Required outcome must be a neutral invariant')
expect(prompt).not.toContain(
  'Review production usability, completeness, clarity, ownership, redundancy',
)
```

- [ ] **Step 2: Write failing synthesis-prompt tests**

Assert that the synthesis prompt contains the six admission checks from the spec and explicitly rejects resolved precedence, total mappings, solution-biased outcomes, and mechanically undecidable acceptance. Also assert that it still forbids full-document reads, merging, and rewriting.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts
```

Expected: FAIL because the current instructions still expose a quota-like sentence and the broad usability/completeness/clarity instruction.

- [ ] **Step 4: Implement the minimal instruction changes**

In `foundationReviewLaneMarkdownInstruction`, replace the final quota sentence with a contract equivalent to:

```ts
'Zero candidates is valid when no blocking defect is proven. Eight candidates is a hard safety maximum, not a target; never fill the allowance.'
```

In the Reviewer branch of `workerInstruction`:

- remove the broad trailing usability/completeness/clarity/redundancy instruction;
- add the five blocking categories and the representation-size, deterministic-mapping, explicit-precedence, missing-detail, and neutral-outcome rules to lane workers;
- require `Problem` to name the blocked implementation or acceptance result;
- add the six synthesis admission checks;
- keep the exact existing receipt grammar and capability boundary.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the Step 3 command. Expected: PASS.

- [ ] **Step 6: Run Reviewer prompt/session regressions**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
```

Expected: PASS; Reviewer still uses streamed Markdown, no `StructuredOutput`, and the prompt still exposes only the accepted authority.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts
git commit -m "fix: tighten foundation review admission"
```

---

### Task 2: Display the Accepted Retained-Conflict Count

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

**Interfaces:**
- Produces: `foundationReviewNeedsRevisionMessage(input: { workspacePath: string; state: FoundationReviewState }): Promise<string>`.
- Consumes: `readFoundationReviewArtifact({ workspacePath, path, expectedDigest })` so the displayed count is derived only from accepted bytes.

- [ ] **Step 1: Write a failing helper test**

Create an accepted `NEEDS_REVISION` artifact with two conflicts and assert:

```ts
expect(
  await foundationReviewNeedsRevisionMessage({ workspacePath: root, state }),
).toBe('Foundation review found 2 blocking issues requiring revision')
```

Tamper the file and assert the helper rejects the digest mismatch rather than displaying an untrusted count.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts
```

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement accepted-artifact count derivation**

Implement the helper by requiring a completed `NEEDS_REVISION` state, reading `finalReportPath` with `finalReportDigest`, and returning the count from `accepted.review.conflicts.length`. Do not add count fields to durable workflow state and do not parse unvalidated UI data.

- [ ] **Step 4: Use the helper at all three terminal routing sites**

Replace the raw `Foundation review requires revision; see ...` string in:

- immediate Reviewer terminal acceptance;
- resumed completed Reviewer routing;
- startup/retry artifact recovery routing.

The standard four tasks remain unchanged. The message contains only the accepted count; it does not include raw JSON, receipts, revision, digest, or evidence.

- [ ] **Step 5: Run focused controller and recovery tests**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: PASS, including tamper failure and exact terminal message assertions.

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "fix: show accepted foundation issue count"
```

---

### Task 3: Remove Revision-Local Staging Only After Final Commit

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`

**Interfaces:**
- Produces: a project-confined helper that removes `.beegame/reviews/foundation/<revision>/.staging` after the canonical final report is durably committed.
- Preserves: every committed projection, lane receipt, `selection.md`, and `review.json` byte.

- [ ] **Step 1: Write failing cleanup tests**

Assert that:

- partial lane acceptance retains staging required by incomplete work;
- failed selection/final commit retains recoverable staging;
- successful final assembly removes the revision-local `.staging` directory;
- recovery of an already committed final report leaves no staging directory;
- committed artifacts remain byte-identical after cleanup.

- [ ] **Step 2: Run the focused test and verify RED**

Run the Task 2 Step 2 command. Expected: FAIL because empty staging directories remain after final acceptance.

- [ ] **Step 3: Implement final-only cleanup**

After `commitAssembledFoundationReview` returns and before the completed state is returned, recursively remove only the validated revision-local `.staging` directory. Sync the containing revision directory after removal. Never call cleanup for pending, running, or failed review states.

- [ ] **Step 4: Run stage, retry, and recovery tests**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
```

Expected: PASS; crash recovery and missing-only redispatch remain unchanged.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts
git commit -m "fix: clean completed foundation review staging"
```

---

### Task 4: Full Verification and One Chrome Acceptance

**Files:**
- Create: `docs/superpowers/acceptance/2026-08-18-foundation-review-admission-quality.md`
- Modify only if evidence reveals the approved architecture itself is wrong; stop and reassess before any additional production patch.

**Interfaces:**
- Consumes: the tested Reviewer implementation from Tasks 1-3.
- Produces: one evidence document containing source hashes, task topology, artifact digests, content audit, elapsed time, and usage.

- [ ] **Step 1: Run the complete automated Reviewer gate**

Run the focused Reviewer, controller, recovery, session-port, route, and Workflow Card suites, followed by:

```bash
bun run typecheck
git diff --check
```

Expected: all pass; no tracked worktree residue.

- [ ] **Step 2: Start the fixed-port stack and create one fresh review copy through Chrome**

Use the accepted fixed ports. Start only the Foundation Reviewer and stop at its terminal result. Do not retry, continue to checklist, or run remediation.

- [ ] **Step 3: Audit execution evidence**

Record and verify:

- exactly three lane tasks start concurrently and synthesis starts only after all three commit;
- all four turns use streamed Markdown and no `StructuredOutput`;
- all eight source SHA-256 values remain unchanged;
- the canonical `review.json` is byte-identical to deterministic reassembly;
- the Dashboard shows four standard tasks and the accepted retained count;
- no revision-local `.staging` directory remains after final commit;
- duration, input, cache-input, output, and credit are recorded.

- [ ] **Step 4: Audit semantic quality without project-specific runtime rules**

For every retained conflict, verify that the evidence proves the problem, the problem names a blocked result, no stated precedence/mapping/stricter bound resolves it, the required outcome is neutral, and acceptance is mechanical. Record any rejected candidates that demonstrate synthesis filtering. Do not require a particular conflict count or a non-empty Reject set.

- [ ] **Step 5: Stop on first architecture-level failure**

If the same class of false positive remains, stop the run and document the evidence. Reassess the admission architecture before modifying production code; do not patch the observed example or add local semantic heuristics.

- [ ] **Step 6: Commit acceptance evidence**

```bash
git add docs/superpowers/acceptance/2026-08-18-foundation-review-admission-quality.md
git commit -m "docs: accept foundation review admission quality"
```
