# Stable Workflow Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the eight-document, Stage 3 Reviewer, Stage 4 Revision, and Checklist workflow to the exact admitted pre-Game-IR implementation and prove it through local and real Chrome acceptance with Game IR unreachable.

**Architecture:** This is Milestone 1 only. A Git-derived manifest freezes the admitted baseline, all 55 post-baseline runtime/test changes outside the old Game IR directory are mechanically restored, the 86-file old in-package Game IR tree is deleted, and a permanent checker rejects protected drift or reintroduction. Standalone Game IR salvage reads immutable source commit `4335363b2...` under a separate implementation plan created only after this milestone is accepted.

**Tech Stack:** TypeScript, Bun, Bun test, Node standard library, Git plumbing, Bee Game Studio fixed-port Web/React stack, Chrome.

**Spec:** `docs/superpowers/specs/2026-09-03-game-ir-isolation-recovery-design.md`

## Global Constraints

- Stable candidate commit is `d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6`; its code tree equals branch `codex/checklist-implementation` tip `70df2e2c79bd214862af3959a257c5f5f42bd666` because the only intervening commit is documentation.
- First Game IR boundary-test commit is `109e7195d314bb716922ef2dd2de65567e428d64`, whose sole parent is the candidate baseline; first Game IR production-source commit is `f4a7d16f7bde3bb8a978f1a10350ad2cef84aa8f`.
- Historical evidence proves Stage 2 and Reviewer behavior but not the complete Revision-to-zero-and-Checklist sequence; the new Chrome run is the admission proof rather than a repetition of an unproven historical claim.
- Restore all runtime and test files changed after the baseline outside `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/`; do not preserve selected later hunks.
- Remove all 15 post-baseline tracked `.superpowers/sdd/` scratch files.
- Existing Game IR source is preserved only in immutable source commit `4335363b2...` and deleted from the recovery branch; protected source contains no `GAME_IR`, `GameIr`, `gameIr`, or `game-ir` token.
- Do not edit Stage 2, Stage 3, Stage 4, Checklist, controller, transport, schema, recovery, model runtime, session, or UI code after restoration.
- No compatibility reader, fallback, alias, feature flag, dual parser, dual state, or dual execution route.
- No fixed Token, byte, duration, attempt, issue, section, entity, or artifact business limit.
- Model-authored Foundation documents remain raw Markdown.
- No model call or Chrome run starts until all local gates pass.
- Each implementation task has an exact allowlist; a path violation discards the whole task commit.

---

### Task 1: Admit the baseline and freeze the protected boundary

**Files:**
- Create: `scripts/game-ir-isolation-boundary.ts`
- Create: `scripts/game-ir-isolation-boundary.test.ts`
- Create: `docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json`

**Interfaces:**
- Consumes: Git trees at `d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6`, `109e7195d314bb716922ef2dd2de65567e428d64`, and the current checkout.
- Produces: `verifyGameIrIsolationBoundary(root, manifest): BoundaryReport`; CLI exit `0` only when every protected blob and isolation rule matches.

- [ ] **Step 1: Write the failing checker tests**

Use a temporary Git repository with a baseline commit, a quarantined `game-ir/` path, and protected TypeScript paths. The tests must prove that the checker:

```ts
expect(verifyGameIrIsolationBoundary(cleanRoot, manifest).violations).toEqual([])
expect(codes(modifiedProtectedRoot)).toContain('protected_blob_mismatch')
expect(codes(addedProtectedRoot)).toContain('unexpected_protected_path')
expect(codes(deletedProtectedRoot)).toContain('missing_protected_path')
expect(codes(importingProtectedRoot)).toContain('game_ir_reference_in_protected_source')
expect(codes(trackedScratchRoot)).toContain('tracked_sdd_scratch')
expect(codes(nonAncestorRoot)).toContain('invalid_baseline_ancestry')
```

The fixture must also prove that changes inside the exact quarantined Game IR prefix and Game IR-only documents under `docs/` do not create protected blob violations.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
bun test scripts/game-ir-isolation-boundary.test.ts
```

Expected: FAIL because `game-ir-isolation-boundary.ts` does not exist.

- [ ] **Step 3: Implement the minimum checker**

Use only `node:child_process`, `node:fs`, and `node:path`. Invoke Git with argument arrays, never shell interpolation. The manifest schema is exactly:

```ts
type ProtectedBaselineManifest = Readonly<{
  schemaVersion: 'game-ir-protected-baseline.v1'
  baselineCommit: 'd821e286ebf7eb3ad1b4725ae60dac7a9fef95b6'
  stableBranchCommit: '70df2e2c79bd214862af3959a257c5f5f42bd666'
  firstGameIrBoundaryCommit: '109e7195d314bb716922ef2dd2de65567e428d64'
  firstGameIrProductionCommit: 'f4a7d16f7bde3bb8a978f1a10350ad2cef84aa8f'
  sourceCommit: '4335363b2cd33d1f0b7bd807bff95d9389c67ce1'
  quarantinedPrefix: 'packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/'
  protectedPaths: readonly Readonly<{ path: string; blobId: string }>[]
  changedOutsideQuarantine: readonly string[]
  trackedScratchPaths: readonly string[]
  historicalEvidence: readonly Readonly<{ path: string; commit: string; claim: string }>[]
  historicalEvidenceGap: 'no baseline-bound Revision-to-zero-and-Checklist Chrome receipt found'
}>
```

`protectedPaths` is the complete baseline tree beneath `packages/agent-workflow-server/src/beegame/`, excluding the quarantined prefix, plus the complete baseline tree beneath `packages/agent-workflow-server/src/__tests__/`. Sort paths by raw UTF-8 byte order. `changedOutsideQuarantine` must contain the exact 55 runtime/test paths changed in `d821e286..4335363b2`. `trackedScratchPaths` must contain the exact 15 `.superpowers/sdd/` paths added in that range.

The checker must verify ancestry, verify that `109e7195...` has exactly one parent equal to `d821e286...`, verify that `f4a7d16f...` descends from `109e7195...` and adds Game IR production source, compare current blobs with every protected blob, reject additional paths under protected roots, reject any protected-source match for `/GAME_IR|GameIr|gameIr|game-ir/`, and reject every tracked `.superpowers/sdd/` file. It must never rewrite its manifest.

- [ ] **Step 4: Generate and inspect the immutable manifest**

Generate the manifest once from `git ls-tree`, `git diff --name-only`, `git rev-list --parents -n 1`, and the available historical evidence. The evidence list must explicitly record that no baseline-bound Revision-to-zero-and-Checklist Chrome receipt was found. The command may write only the exact evidence path above. Then run:

```bash
bun scripts/game-ir-isolation-boundary.ts
```

Expected before restoration: non-zero, reporting the 55 protected changes and 15 tracked scratch paths. This is the required characterization failure.

- [ ] **Step 5: Run unit verification**

```bash
bun test scripts/game-ir-isolation-boundary.test.ts
git diff --check
```

Expected: tests PASS; diff check PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/game-ir-isolation-boundary.ts scripts/game-ir-isolation-boundary.test.ts docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json
git commit -m "test: freeze stable workflow boundary"
```

---

### Task 2: Restore the stable workflow exactly and remove the active Game IR route

**Files:**
- Restore: every path in manifest field `changedOutsideQuarantine`
- Delete: every path in manifest field `trackedScratchPaths`
- Do not modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/**`

**Interfaces:**
- Consumes: the immutable manifest from Task 1 and baseline Git blobs.
- Produces: protected runtime and tests byte-identical to the admitted baseline, with Game IR source present only as unreachable salvage material.

- [ ] **Step 1: Record the pre-restore evidence**

Run the boundary checker and save its stdout plus exit code in the task report. Confirm it reports exactly 55 changed runtime/test paths and 15 tracked scratch paths. If either count differs, stop this task and return `NEEDS_CONTEXT`; do not infer a new allowlist.

- [ ] **Step 2: Restore only the manifest paths**

For each `changedOutsideQuarantine` entry, inspect whether it exists in the baseline. Restore existing baseline paths from `d821e286...`; remove paths absent from the baseline. Remove the 15 exact tracked scratch paths. Do not use a directory-wide reset and do not touch the quarantined Game IR directory or `docs/`.

- [ ] **Step 3: Prove the boundary is GREEN**

```bash
bun scripts/game-ir-isolation-boundary.ts
git diff --check
```

Expected: checker PASS with zero violations; diff check PASS.

- [ ] **Step 4: Prove the restoration diff is exact**

The staged task diff must contain only the manifest's 55 restored runtime/test paths and 15 deleted scratch paths. For every restored runtime/test path, its working-tree blob ID must equal the manifest blob ID. No file under the quarantined Game IR prefix or `docs/` may appear in this task diff.

- [ ] **Step 5: Commit**

```bash
git add --all -- packages/agent-workflow-server/src .superpowers/sdd
git commit -m "refactor: restore stable protected workflow"
```

---

### Task 3: Remove the old in-package Game IR tree and make absence permanent

**Files:**
- Modify: `scripts/game-ir-isolation-boundary.ts`
- Modify: `scripts/game-ir-isolation-boundary.test.ts`
- Delete: all 86 tracked paths under `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/`
- Do not modify: protected runtime/tests, `docs/`, or the immutable manifest.

**Interfaces:**
- Consumes: immutable source commit `4335363b2...` as salvage authority and the Task 1 checker.
- Produces: a recovery checkout with no old Game IR source tree and a boundary violation `game_ir_source_present` if any tracked or untracked non-ignored path reappears under the forbidden prefix.

- [ ] **Step 1: Preserve the failing isolation evidence**

Record the independent-install `bun run typecheck` failure. Every diagnostic must originate under the old Game IR prefix and must be caused by references to restored shared contracts such as `DeliveryRun`, `gameIrState`, `secure-file`, `durableWrite`, or Game IR worker schemas. If any diagnostic originates outside that prefix, stop and return `NEEDS_CONTEXT`.

- [ ] **Step 2: Write the failing absence tests**

Extend the boundary test to prove that a tracked or untracked non-ignored `.ts`, test, or arbitrary file beneath the exact old Game IR prefix produces `game_ir_source_present`. Keep ignored SDD files outside that prefix unaffected.

- [ ] **Step 3: Run RED**

```bash
bun test ./scripts/game-ir-isolation-boundary.test.ts
```

Expected: the new reintroduction cases fail because the checker still permits the old prefix.

- [ ] **Step 4: Implement the minimum absence gate and delete the old tree**

Add only the new violation and a scan of current tracked plus untracked non-ignored paths under the fixed prefix. Delete the exact 86 paths returned by:

```text
git diff --name-only d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6..4335363b2cd33d1f0b7bd807bff95d9389c67ce1 -- packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/
```

The command must return 86 before deletion. Do not copy or rewrite those files; Git history is the salvage source.

- [ ] **Step 5: Run GREEN and static gates**

```bash
bun test ./scripts/game-ir-isolation-boundary.test.ts
bun scripts/game-ir-isolation-boundary.ts
bun run typecheck
git diff --check
```

Expected: all exit `0`; no source path outside the deleted prefix changes.

- [ ] **Step 6: Commit**

```bash
git add scripts/game-ir-isolation-boundary.ts scripts/game-ir-isolation-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
git commit -m "refactor: remove coupled game ir source tree"
```

---

### Task 3A: Admit the two reproduced baseline test corrections

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts`
- Modify: `scripts/game-ir-isolation-boundary.ts`
- Modify: `scripts/game-ir-isolation-boundary.test.ts`
- Modify: `docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json`

**Interfaces:**
- Consumes: committed Task 4 failure evidence and the byte-identical provisional runtime baseline.
- Produces: two exact test-only corrections plus a mechanically immutable correction allowlist; production behavior remains byte-identical.

- [ ] **Step 1: Preserve the RED evidence**

Re-run the two failing test files and require the same seven failures: six from the stale pre-single-track Checklist fixture and one from the stale hard-coded display phase count.

- [ ] **Step 2: Correct only the stale test data**

Replace the recovery fixture's obsolete Checklist line with the canonical section-reference form already proven by commit `983253161`. Replace the two literal `phaseCount: 10` expectations with `DELIVERY_PROGRESS_STAGES.length`. Do not modify production code.

- [ ] **Step 3: Freeze the corrections mechanically**

Upgrade the boundary manifest/checker contract to record exactly these two paths, their baseline blob IDs, corrected blob IDs, and fixed reasons. Reject an omitted, additional, reordered, or altered correction and reject any other protected change. Add RED/GREEN checker tests for tampering and unauthorized test changes.

- [ ] **Step 4: Verify and commit**

Run the two corrected tests, the boundary tests, boundary CLI, typecheck, and `git diff --check`. Expected: all pass and no production diff from `d821e286`.

```bash
git add packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.test.ts scripts/game-ir-isolation-boundary.ts scripts/game-ir-isolation-boundary.test.ts docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json
git commit -m "test: correct restored workflow baseline fixtures"
```

---

### Task 4: Run the complete local protected-workflow gate

**Files:**
- Create: `docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md`
- Do not modify: production code or existing tests.

**Interfaces:**
- Consumes: restored baseline code, existing baseline tests, Task 1 checker.
- Produces: exact commands, timestamps, exit codes, test counts, assertion counts, and failure text for the local gate.

- [ ] **Step 1: Use a worktree-local dependency installation without changing Git**

Verify this worktree owns its ignored `node_modules` directory. A symlink to another worktree is forbidden because workspace-package links resolve duplicate physical TypeScript identities. If the directory is missing, run `bun install --frozen-lockfile`; verify `git status --short` remains clean.

Build the ignored native CLI prerequisite before running tests:

```bash
bun run build:bun
```

Verify `dist/cli-bun.js` exists and remains ignored. The protected native-process tests execute this file; a clean checkout does not contain it because `dist/` is not tracked.

- [ ] **Step 2: Run static gates**

```bash
bun scripts/game-ir-isolation-boundary.ts
bun run typecheck
git diff --check
```

Expected: all exit `0`.

- [ ] **Step 3: Run Stage 2 authoring tests**

Run the baseline test files for complete document authoring, session-port document completion, document boundary/display/contracts, authoring batches, Markdown streaming, authority projection, readiness, receipts, metrics, native CLI transport, and session runtime errors. Resolve the file set from the committed manifest's protected paths; do not include quarantined Game IR tests.

Expected: zero failures. A failure is diagnosed against the baseline before any code change; this task is evidence-only.

- [ ] **Step 4: Run Stage 3 Reviewer tests**

Run every protected baseline test whose path matches `foundation-audit-*`, `foundation-fact-*`, `foundation-semantic-*`, `foundation-issue-registry.test.ts`, `foundation-section-index.test.ts`, or `foundation-project-deterministic-rules.test.ts`.

Expected: zero failures.

- [ ] **Step 5: Run Stage 4 Revision tests**

Run every protected baseline test whose path matches `foundation-impact-analysis.test.ts`, `foundation-patch-validation.test.ts`, `foundation-revision-*.test.ts`, or `native-foundation-revision-result-tool.test.ts`.

Expected: zero failures.

- [ ] **Step 6: Run Checklist and shared-runtime tests**

Run `acceptance-checklist.test.ts`, `checklist-authority-projection.test.ts`, `checklist-candidate.test.ts`, `recovery-projector.test.ts`, `schema-evolution.test.ts`, `transition.test.ts`, `workflow-display-message.test.ts`, `workflow-stage-card-history.test.ts`, `runtime-observability.test.ts`, and the protected `src/__tests__` delivery/session/native suites, including `idea-to-complete-documents.test.ts`.

Expected: zero failures.

- [ ] **Step 7: Run the broad baseline server regression**

```bash
bun test packages/agent-workflow-server/src/__tests__
```

Then run all baseline `*.test.ts` files beneath `packages/agent-workflow-server/src/beegame/` except the quarantined Game IR prefix. Expected: zero failures.

- [ ] **Step 8: Write and commit evidence**

The evidence document records every command verbatim, start/end time, exit code, test count, assertion count, and any skip. It must explicitly state that no model or Chrome call occurred and that production code remained unchanged.

```bash
git add docs/superpowers/evidence/2026-09-03-stable-workflow-local-verification.md
git commit -m "test: verify restored stable workflow locally"
```

---

### Task 5: Execute one real Chrome workflow from zero through Checklist

**Files:**
- Create: `docs/superpowers/reviews/2026-09-03-stable-workflow-chrome-acceptance.md`
- Do not modify: production code, tests, prompts, contracts, fixtures, or the accepted project by filesystem commands.

**Interfaces:**
- Consumes: the locally green recovery branch and configured real model/service credentials.
- Produces: one new Chrome-created project and an immutable acceptance report covering Idea through Checklist.

- [ ] **Step 1: Start the fixed-port stack from this worktree**

Use `bun run beegame:dev` and wait for the declared frontend, runtime, billing, skills, and resources endpoints to become healthy. Record the exact branch, HEAD, ports, and process start time. Do not reuse a server launched from another worktree.

- [ ] **Step 2: Create a genuinely new project through Chrome**

Use an ordinary game idea not copied from a fixture and do not insert case keywords into product code or prompts. Record project ID, workflow run ID, idea text, selected model, and start time.

- [ ] **Step 3: Accept the eight Foundation documents**

Continue only through the UI. Verify all eight canonical raw-Markdown documents are committed, canonical paths are unique, versions/digests exist, and no Game IR task, artifact, state, log, or UI card appears.

- [ ] **Step 4: Accept Stage 3 and Stage 4 behavior**

Verify Reviewer is Stage 3 and Revision is Stage 4. If Reviewer finds issues, allow the automatic Reviewer-to-Revision loop to continue without human intervention until the Issue Registry has zero open issues. Confirm every revised document changes its revision/version metadata and unrelated documents remain unchanged.

- [ ] **Step 5: Accept Checklist**

Verify Checklist is created once through its sole authority path, references the final accepted Foundation revision, and does not trigger Game IR. Stop before any later resource or implementation phase.

- [ ] **Step 6: Apply the failure rule**

On any workflow error, capture the exact visible message, task, state, server log interval, model terminal, artifacts, usage, and elapsed time, then stop the acceptance. Do not patch code during this task and do not restart merely to see whether the error disappears.

- [ ] **Step 7: Write and commit the acceptance report**

Record the eight document paths, byte sizes and SHA-256 digests; Reviewer issues by round; Revision publications and version changes; final zero-open-issue evidence; Checklist path/digest; task durations; input/cache/output Tokens; credits; retries; errors; and proof of zero Game IR activity.

```bash
git add docs/superpowers/reviews/2026-09-03-stable-workflow-chrome-acceptance.md
git commit -m "docs: accept restored stable workflow"
```

---

### Task 6: Seal the Milestone 1 restoration receipt

**Files:**
- Create: `docs/superpowers/evidence/2026-09-03-stable-workflow-restoration-receipt.json`

**Interfaces:**
- Consumes: committed boundary manifest, local verification report, Chrome acceptance report, accepted project/run artifacts.
- Produces: `stable-workflow-restoration-receipt.v1`, the sole admission evidence for the later standalone Game IR plan.

- [ ] **Step 1: Write the receipt from deterministic evidence**

The service-authored JSON contains exactly:

```ts
type StableWorkflowRestorationReceipt = Readonly<{
  schemaVersion: 'stable-workflow-restoration-receipt.v1'
  baselineCommit: string
  protectedRestorationCommit: string
  protectedManifestDigest: string
  localVerificationReportDigest: string
  chromeAcceptanceReportDigest: string
  projectId: string
  runId: string
  foundationRevision: string
  documentDigests: Readonly<Record<string, string>>
  checklistDigest: string
  finalWorkflowState: string
  openIssueCount: 0
  gameIrActivityCount: 0
  usage: Readonly<{ inputTokens: number; cacheReadTokens: number; outputTokens: number; credits: number | null }>
  elapsedMs: number
  receiptDigest: string
}>
```

`protectedRestorationCommit` is the Task 3 commit, which includes the Task 2
baseline restoration and removal of the old Game IR tree while avoiding a self-referential
commit identity. Canonicalize object keys, hash UTF-8 bytes with
`receiptDigest` omitted, then insert the digest. Do not ask a model to emit
this JSON.

- [ ] **Step 2: Run final gates**

```bash
bun scripts/game-ir-isolation-boundary.ts
bun run typecheck
bun test scripts/game-ir-isolation-boundary.test.ts
git diff --check
```

Re-run the exact Stage 2–4, Checklist, shared-runtime, and broad server commands recorded in Task 4. Expected: zero failures and zero protected diff.

- [ ] **Step 3: Main-agent final audit and commit**

The main agent verifies manifest/receipt canonical bytes, Git blob parity, no protected Game IR token, no tracked scratch, Chrome evidence completeness, and a clean worktree after commit.

```bash
git add docs/superpowers/evidence/2026-09-03-stable-workflow-restoration-receipt.json
git commit -m "docs: seal stable workflow restoration"
```

Milestone 1 is complete only after this commit. The next action is to write and audit a separate standalone Game IR salvage implementation plan; no consumer cutover or protected workflow integration is implied.
