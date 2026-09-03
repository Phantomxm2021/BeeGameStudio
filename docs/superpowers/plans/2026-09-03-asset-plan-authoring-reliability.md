# Asset Plan Authoring Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Every behavior change starts with a failing test.

**Goal:** Produce a complete, truthful, non-redundant Asset Plan and recover a non-tail Markdown heading defect inside the same author task without contaminating the canonical document.

**Architecture:** Strengthen the existing document contract and prompt with a literal raw-Markdown skeleton and delivery-unit rules. Classify the current candidate as complete, appendable prefix, or structurally invalid. Keep append continuation for true suffix truncation; for a structural defect, collect one complete replacement in the same session and dispatch. Normalize the one terminal result to the accepted complete body so the existing pending sink overwrites transient stream bytes before its single canonical commit.

**Tech Stack:** TypeScript, Bun, Bun test, existing native stream protocol, existing Foundation Markdown sink.

**Spec:** `docs/superpowers/specs/2026-09-03-asset-plan-authoring-reliability-design.md`

## Frozen boundaries

- Allowed production files are limited to `complete-game-document.ts`, `native-cli-process-runner.ts`, `foundation-markdown-stream.ts`, `worker-prompts.ts`, and `game-document-contracts.ts` only when tests prove the corresponding change is required.
- Reviewer, Revision, Checklist, Game IR, controller, recovery, durable schemas, UI, session routing, and the other seven document contracts are forbidden.
- Foundation output stays raw Markdown. No JSON/YAML document output, compatibility reader, feature flag, fresh author dispatch, parallel candidate, or relaxed validator.
- No fixed token, word, duration, row, resource, or business-attempt limit. One structural replacement is a native transport recovery boundary, not a quality budget.
- During Tasks 1–4, the Game IR isolation boundary checker may fail only with `protected_blob_mismatch` for the exact plan-allowed files changed so far; every other violation stops execution. Task 5 admits the final reviewed blobs through a fixed manifest list and must restore a fully green checker.

---

### Task 1: Make the author contract unambiguous and Asset planning truthful

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify only if needed: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`
- Modify only if needed: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`

**Interface:** Existing initial and parallel-draft document-author prompts gain a contract-derived literal skeleton. Only the Asset contract gains resource-production quality rules.

- [ ] **Step 1: Write RED prompt tests**

For `docs/ASSET_PLAN.md`, assert that both initial and parallel-draft prompts contain one literal ordered skeleton with all canonical H2 headings followed by `## Production Materials` and the five canonical H3 headings. Assert that the prompt explicitly forbids those H3 headings before Production Materials.

Assert that the Asset prompt requires:

- one inventory ID per independently acquireable/authorable/licensable/replaceable/acceptable delivery unit;
- one inventory ID may map to multiple delivery files or encoding variants;
- per-unit mapping from upstream Art/Audio/UI requirements instead of category collapse;
- repeated metadata stays inside its one owner material without a second profile schema;
- planned fields separated from evidence-backed observed fields;
- no `verified`, `available`, current maturity, or delivery receipt claim without evidence;
- exact derivable mappings, otherwise an explicit `unresolvedRef`.

Also assert that a GDD prompt does not receive Asset-specific prose.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
```

Expected: new assertions fail because the literal skeleton and Asset rules are absent.

- [ ] **Step 3: Implement the smallest prompt change**

Derive a `literalMarkdownSkeleton` string from the already formatted `mechanicalMarkdownProtocol`; do not create another heading catalog. Add it to the existing author contract and reference it from the existing closure instruction.

Put Asset-only quality language in the existing Asset authority/merge rule or Asset contract summary. Explicitly constrain Asset H2 sections to policy, context, rationale, and owner-material references; per-inventory rows, mappings, quantities, evidence, current status, and milestones remain only in the five owner materials. Do not introduce a new worker, schema, validator, or prompt route. Change `game-document-contracts.ts` only if an existing contract string cannot carry the rules cleanly.

- [ ] **Step 4: Run GREEN and scope checks**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
git diff --check
```

Run `bun scripts/game-ir-isolation-boundary.ts` separately and record that every reported path is an exact Task 1 allowlist path; any other violation fails the task.

- [ ] **Step 5: Main-agent review and commit**

Reject the task if it changes non-Asset contract semantics or adds a second prompt path. Commit only after review:

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
git commit -m "fix: clarify asset plan author contract"
```

---

### Task 2: Classify appendable prefixes separately from structural defects

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`

**Interface:**

```ts
export type GameDocumentMarkdownStructure =
  | { kind: 'complete' }
  | { kind: 'suffix_incomplete' }
  | { kind: 'structurally_invalid'; reason: string }

export function classifyGameDocumentMarkdownStructure(
  path: FoundationDocumentPath,
  value: string,
): GameDocumentMarkdownStructure
```

`isCompleteGameDocumentMarkdownStructure` remains a compatibility-free boolean wrapper over `kind === 'complete'`; there is still one validator and one heading catalog.

- [ ] **Step 1: Add the captured RED shape**

Build a compact Asset fixture from the real failure shape: all canonical Asset H2 sections are present, the five canonical material H3 headings occur within earlier sections, and `## Production Materials` is absent. Expect `structurally_invalid`, not `suffix_incomplete`.

Add focused cases for:

- valid prefix ending before Production Materials -> `suffix_incomplete`;
- unclosed fence at the tail with otherwise valid prefix -> `suffix_incomplete`;
- duplicate canonical H2 -> `structurally_invalid`;
- reordered canonical H2 -> `structurally_invalid`;
- unexpected H2 -> `structurally_invalid`;
- missing, displaced, or repeated authored H1 in a non-empty candidate -> `structurally_invalid`, while an empty candidate remains `suffix_incomplete`;
- canonical material H3 before Production Materials -> `structurally_invalid`;
- a legal ordinary section H3 remains allowed, while a canonical material H3 before Production Materials plus a complete later material set remains `structurally_invalid`;
- duplicate/reordered canonical material H3 -> `structurally_invalid`;
- exact complete document -> `complete`.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
```

- [ ] **Step 3: Implement by reusing the existing heading scan**

For every non-empty candidate, require exactly one authored H1 on the first non-blank line; missing, displaced, or repeated H1 is non-tail structural invalidity. Compare authored canonical H2 headings against the expected sequence. A suffix is appendable only when every observed H2 is the exact prefix and no extra/duplicate heading exists. Treat only contract-listed canonical material-title H3 headings anywhere before Production Materials as invalid. After Production Materials, observed canonical material H3 headings must be an exact prefix with no duplicate or reordering. Arbitrary H3/H4 subsection headings remain allowed. An open trailing fence does not by itself make an otherwise valid prefix structurally invalid.

Do not parse prose, table cells, Mermaid labels, or fenced headings.

- [ ] **Step 4: Run GREEN and commit after main-agent review**

```bash
bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/complete-game-document.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
git commit -m "fix: classify foundation markdown recovery"
```

Run the boundary checker separately and require that every mismatch is an exact Task 1–2 allowlist path.

---

### Task 3: Make the sink commit the accepted terminal body

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-markdown-stream.ts`

**Interface:** The existing sink captures the non-empty Markdown `result` from the one successful terminal message. At commit it uses that terminal body as the authored body; streamed blocks remain fallback only for providers whose terminal result omits text.

- [ ] **Step 1: Write RED tests**

Prove that when stream deltas contain `invalid-old + valid-replacement` but the one terminal result contains only `valid-replacement`, `commit()` writes and commits only `valid-replacement`. Prove that a complete terminal body with no streamed text block also commits successfully. Preserve tests proving that an empty terminal result still commits the merged streamed body and that byte/integrity failures remain fail-closed.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts
```

- [ ] **Step 3: Implement the minimum terminal-body precedence**

Add one optional transient `terminalBody` field. On the single successful result, capture `result` only when it is non-empty and reject a terminal body larger than the existing infrastructure `maxBytes`. In `commit()`, require closed/non-empty streamed blocks only when `terminalBody` is absent; choose `terminalBody ?? mergeTextBlocks(textBlocks)`, overwrite the same pending path through the existing `writeFile`, sync, and call the existing canonical commit function. The fallback exists for direct sink callers/providers that omit terminal text; the normal runner path in Task 4 always supplies the normalized full candidate. Do not add a reset event, second path, second sink, or second commit.

- [ ] **Step 4: Run GREEN and commit after main-agent review**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/foundation-markdown-stream.ts packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts
git commit -m "fix: commit accepted markdown candidate"
```

Run the boundary checker separately and require that every mismatch is an exact Task 1–3 allowlist path.

---

### Task 4: Replace a non-tail candidate inside the same native dispatch

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/fixtures/native-runtime-fixture.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`

**Interface:** The runner uses Task 2's classifier. `suffix_incomplete` uses the existing append prompt. `structurally_invalid` uses one complete-replacement prompt. The final forwarded result's `result` is the accepted complete candidate from the runner buffer.

- [ ] **Step 1: Write RED native-runtime scenarios**

Add fixture scenarios for:

- the captured Asset shape followed by a valid complete replacement;
- a structural replacement that is empty;
- a structural replacement that is identical or still invalid;
- normal suffix continuation;
- normal first-response completion.

The successful replacement test must prove:

- the fixture receives exactly two user messages;
- session ID and dispatch runtime are unchanged;
- the second prompt requests a complete replacement, not continuation, and includes the classifier's concrete reason plus the full literal skeleton;
- exactly one successful result reaches the caller;
- its `result` equals the complete replacement and each canonical material heading appears exactly once.

The failure tests must prove no third user message/replacement cycle occurs and the error identifies `Markdown structural replacement` rather than `continuation made no progress`. Add a terminal-only replacement scenario whose second response has no stream delta but a non-empty complete `result`, and a streamed non-empty candidate with an empty provider terminal result that the runner normalizes to the full candidate before forwarding. Only a replacement with neither replacement stream bytes nor replacement result bytes is empty.

- [ ] **Step 2: Run RED**

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

- [ ] **Step 3: Implement one transient recovery mode**

Replace the continuation booleans with the minimum explicit mode needed to distinguish `none`, `append`, `restart`, and `replace`. Define one replacement-prompt builder that receives the classifier `reason` and the contract-derived literal skeleton. During `replace`, collect new Markdown into the existing recovery buffer without appending it to the candidate; if no replacement stream text arrived, use the non-empty terminal `result` as that buffer. At its result:

- fail if empty or byte-identical to the rejected candidate;
- classify the replacement and fail if it is not complete;
- otherwise swap the in-memory candidate;
- forward a shallow copy of the successful result whose `result` is the full accepted candidate.

For complete initial and appended candidates, also normalize the forwarded terminal `result` to the complete candidate even when the provider's terminal text is empty or contains only the append delta, so Task 3 has one uniform commit source. The existing sink `maxBytes` remains an infrastructure bound over all streamed bytes in the dispatch, and Task 3 separately bounds a terminal-only body; it is not a business-quality limit.

Do not recursively recover a failed replacement. Do not start another process, session, task, or dispatch.

- [ ] **Step 4: Focused GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
```

- [ ] **Step 5: Main-agent architecture review and commit**

Inspect all callers of the classifier and all writes to the sink. Reject compatibility flags, recovery counters, fresh dispatches, duplicated candidate state, or changes outside Stage 2.

```bash
git add packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/fixtures/native-runtime-fixture.ts
git commit -m "fix: replace invalid markdown candidate in place"
```

---

### Task 5: Admit the exact Stage 2 corrections and prove local integrity

**Files:**
- Modify: `scripts/game-ir-isolation-boundary.test.ts`
- Modify: `scripts/game-ir-isolation-boundary.ts`
- Modify: `docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json`
- Create: `docs/superpowers/evidence/2026-09-03-asset-plan-authoring-reliability.md`

No production changes are allowed in this task.

- [ ] **Step 1: Write RED boundary tests**

Add a separate ordered `admittedStage2Corrections` manifest field. Each entry has exactly `path`, `baselineBlobId`, `correctedBlobId`, `reason`, `designCommit`, and `evidencePath`. Tests must reject an omitted, additional, reordered, altered, unavailable, baseline-mismatched, or current-blob-mismatched entry. The fixed list contains only final reviewed Task 1–4 production and test-support paths; it must not reuse or rename `admittedTestCorrections`.

- [ ] **Step 2: Run RED**

```bash
bun test scripts/game-ir-isolation-boundary.test.ts
```

Expected: failure because the checker does not yet recognize the Stage 2 correction list.

- [ ] **Step 3: Implement the fixed allowlist**

Update the checker schema and literal expected list. Baseline blobs must resolve from `d821e286ebf7eb3ad1b4725ae60dac7a9fef95b6`; corrected blobs must be the committed Task 1–4 blobs; `designCommit` is `a773dc2f3`; `evidencePath` is `docs/superpowers/evidence/2026-09-03-asset-plan-authoring-reliability.md`. Keep exact-path comparison and all existing Game IR reference/absence checks. Do not admit a directory, glob, current HEAD, or values generated at verification time.

- [ ] **Step 4: Run boundary GREEN**

```bash
bun test scripts/game-ir-isolation-boundary.test.ts
bun scripts/game-ir-isolation-boundary.ts
git diff --check
```

- [ ] **Step 5: Commit the boundary admission**

```bash
git add scripts/game-ir-isolation-boundary.ts scripts/game-ir-isolation-boundary.test.ts docs/superpowers/evidence/2026-09-03-game-ir-protected-baseline.json docs/superpowers/evidence/2026-09-03-asset-plan-authoring-reliability.md
git commit -m "test: admit asset plan stage corrections"
```

### Task 5A: Prove local correctness

**Files:** Update only the Task 5 evidence report with actual results.

- [ ] **Step 1: Run focused tests**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-markdown-stream.test.ts \
  packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

- [ ] **Step 2: Run broader gates**

```bash
bun run typecheck
bun test packages/agent-workflow-server/src/beegame
bun test packages/agent-workflow-server/src/__tests__
bun scripts/game-ir-isolation-boundary.ts
git diff --check
```

- [ ] **Step 3: Audit the final diff mechanically**

Require zero modified paths containing Reviewer, Revision, Checklist, Game IR, controller, recovery, durable schema, UI, or session-manager code. Search for forbidden additions: compatibility readers, alternate author/recovery lanes, JSON/YAML document output, and fixed business limits. The sink's local `terminalBody ?? mergedStream` input fallback is allowed and is not an alternate author lane.

- [ ] **Step 4: Commit verification evidence**

Record commands, pass/fail counts, duration, and changed paths. Do not claim Chrome acceptance from mocks.

---

### Task 6: Real Chrome acceptance in the prescribed order

**Files:** Runtime artifacts only; do not edit production code during observation.

- [ ] **Step 1: Start an isolated workspace and fresh stack**

Use a new temporary user/workspace root so prior schema or pending artifacts cannot contaminate the run. Preserve server logs and provider transcript locations.

- [ ] **Step 2: Exercise the Asset path**

If the product exposes a safe same-task recovery for the existing failed Asset document, resume that exact task once. Otherwise create a fresh project and run Idea through eight documents; do not add a recovery endpoint.

- [ ] **Step 3: Audit the generated Asset Plan before Reviewer**

Require:

- exact canonical H2 order;
- all five material H3 headings exactly once and only under Production Materials;
- no duplicate owner-material bodies;
- per-independent-delivery-unit inventory granularity;
- one-to-many delivery files represented under one unit where appropriate;
- complete upstream requirement mappings;
- repeated metadata remains in its single owner material without duplicated section-level copies;
- no unsupported verified/current claims;
- explicit `unresolvedRef` for genuinely unresolved scope.

Capture elapsed time, input/cache/completion tokens, and document size. Compare them with the failed Asset dispatch as observations, not pass/fail caps.

- [ ] **Step 4: Run a second fresh Idea-to-eight-documents acceptance**

Use a different natural project concept so the solution proves generality rather than keyword fitting. Stop and report if any Foundation document fails; do not patch during the run.

- [ ] **Step 5: Exercise frozen downstream stages**

Only after eight documents pass, continue into restored Reviewer, Revision-to-zero, and Checklist. If a downstream failure appears, list the exact error and stop; do not alter those frozen stages under this plan.

- [ ] **Step 6: Final evidence and completion gate**

Record project IDs, timestamps, stage results, token/duration metrics, output paths, server error excerpts, and Git HEAD. If the natural Chrome run does not trigger structural replacement, report that it proves normal end-to-end completion only; same-session replacement remains proven by the native-process integration fixture rather than being misreported as real-provider evidence. Run the verification-before-completion checklist before claiming success. Game IR remains out of scope and unreachable throughout this acceptance.
