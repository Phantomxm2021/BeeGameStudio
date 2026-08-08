# Reviewer Packet Terminal Root Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent incomplete Provider streams from becoming successful Reviewer turns, restore packet-scoped audit inputs, and prove exact recovery resumes only the first unaccepted packet.

**Architecture:** Keep one frozen Review Cycle, one ordered check cursor, one finding ledger, and one `SubmitDocumentReviewPacket` terminal. Derive each packet view deterministically from the Cycle's canonical frozen projection, and enforce a non-empty Provider completion reason before any model response can be treated as complete. Provider transport recovery remains the existing canonical retry/fallback path; the Reviewer receives no feedback loop, second terminal, compatibility parser, token limit, or wall-clock limit.

**Tech Stack:** TypeScript, Bun test, BeeGame delivery workflow, Anthropic-compatible streaming, OpenAI-compatible and Gemini stream adapters.

---

## Invariants

- Preserve Reviewer thinking; do not force or disable it.
- Do not add `tool_choice`, automatic Reviewer continuation, retry counters, alternate ledgers, summaries, keyword/regex routing, or platform-specific behavior.
- An accepted durable `SubmitDocumentReviewPacket` always wins over a later empty transport envelope and is never replayed.
- A rejected submission persists no check or finding and stays on the same packet.
- A Provider response without its native completion reason is incomplete, even when it contains thinking or text.
- Completed packet IDs remain a stable durable prefix across failure, restart, and retry.
- Do not modify any generated/example project.
- The upstream `claude-code-best/claude-code` `main` branch was audited before implementation. Its native Claude stream still accepts a completed content block without `stop_reason`, so there is no upstream root-fix commit to adopt.

### Task 1: Lock packet-scoped projection with failing tests

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

- [x] **Step 1: Assert exact packet artifact paths**

  For the first Foundation packet and the strategy/economy packet, derive the expected path union from `artifactPathsByCheck`. Assert that `reviewArtifacts` contains exactly that union minus `reviewAuthority`, with no unrelated Foundation document.

- [x] **Step 2: Assert exact packet reference projection**

  Resolve `referenceIndex.artifacts` and assert every projected artifact belongs to the packet dependency union and every reference points to one of those artifact IDs. Assert repeated construction of the same packet remains deterministic.

- [x] **Step 3: Verify RED**

  Run:

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts
  ```

  Expected: the exact-path assertions fail because the current dispatch sends the full frozen Cycle projection.

### Task 2: Restore one deterministic packet projection

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`

- [x] **Step 1: Build the packet view from the canonical projection**

  Add a bounded in-memory packet projection keyed by ordered `currentCheckIds`. Its artifacts are the stable union returned by `artifactsForDocumentReviewCheck`; its wire reference index contains only those artifact IDs and references. Manifest requirement/resource/content IDs are present only when their canonical paths are in the packet.

- [x] **Step 2: Use the same packet view for prompt and submission contract**

  Populate `reviewArtifacts` and `referenceIndex` from the packet projection while retaining `artifactPathsByCheck` as the per-check permission boundary. Do not persist the packet view or create a second ledger.

- [x] **Step 3: Verify GREEN**

  Run the Task 1 command. Expected: all document-order tests pass.

### Task 3: Lock Provider completion semantics with failing tests

**Files:**
- Create: `src/services/api/__tests__/providerTerminal.test.ts`
- Modify: `packages/@ant/model-provider/src/shared/__tests__/openaiStreamAdapter.test.ts`
- Modify: `packages/@ant/model-provider/src/providers/gemini/__tests__/streamAdapter.test.ts`
- Modify: `src/services/api/openai/__tests__/responsesAdapter.test.ts`

- [x] **Step 1: Add the canonical completion assertion test**

  Test that `undefined`, `null`, and blank completion reasons are rejected, while `end_turn`, `tool_use`, and `max_tokens` are accepted.

- [x] **Step 2: Add truncated OpenAI-compatible stream tests**

  Feed reasoning/text chunks without a final `finish_reason`. Assert the adapter rejects instead of closing blocks and returning partial success.

- [x] **Step 3: Add truncated Gemini stream test**

  Feed content without a candidate `finishReason`. Assert the adapter rejects instead of synthesizing `end_turn`.

- [x] **Step 4: Verify RED**

  Run:

  ```bash
  /Users/nswell/.bun/bin/bun test src/services/api/__tests__/providerTerminal.test.ts packages/@ant/model-provider/src/shared/__tests__/openaiStreamAdapter.test.ts packages/@ant/model-provider/src/providers/gemini/__tests__/streamAdapter.test.ts
  ```

  Expected: missing-completion cases fail under current behavior.

### Task 4: Enforce one Provider terminal invariant

**Files:**
- Create: `packages/@ant/model-provider/src/shared/providerTerminal.ts`
- Modify: `packages/@ant/model-provider/src/index.ts`
- Modify: `src/services/api/claude.ts`
- Modify: `src/services/api/openai/index.ts`
- Modify: `src/services/api/openai/responsesAdapter.ts`
- Modify: `packages/@ant/model-provider/src/shared/openaiStreamAdapter.ts`
- Modify: `packages/@ant/model-provider/src/providers/gemini/streamAdapter.ts`
- Test: files from Task 3

- [x] **Step 1: Define the canonical completion assertion**

  Export one package-owned assertion that accepts only a trimmed non-empty completion reason and otherwise throws `Provider response ended without a completion reason`. Both the package adapters and root API consumers import this one implementation.

- [x] **Step 2: Enforce it at the Anthropic-compatible boundary**

  A streaming response must have `stopReason` even if thinking/text blocks completed. A non-streaming fallback result must also have `stop_reason` before `withRetry` returns it. If a malformed stream already emitted any completed assistant content block, do not invoke non-streaming fallback and risk merging responses from two requests; let the existing failed-dispatch recovery preserve the packet.

- [x] **Step 3: Enforce it for OpenAI-compatible and Gemini adapters**

  OpenAI-compatible streams require a final `finish_reason`; ChatGPT Responses streams require `response.completed` or `response.incomplete`; the OpenAI consumer must not assemble a partial message when `message_stop` is absent. Gemini requires a native `finishReason` and must not map missing completion to `end_turn`.

- [x] **Step 4: Verify GREEN**

  Run the Task 3 command. Expected: all Provider terminal tests pass.

### Task 5: Prove Reviewer terminal and exact recovery boundaries

**Files:**
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

- [x] **Step 1: Add Reviewer empty-terminal coverage**

  Assert that a Reviewer `result`/`turn.empty` with no accepted submission becomes `missing_required_terminal_submission: SubmitDocumentReviewPacket`, does not invoke `onTerminal`, and persists no check/finding.

- [x] **Step 2: Add accepted-tool precedence coverage**

  Assert that an accepted `SubmitDocumentReviewPacket` followed by an empty Provider result produces exactly one terminal and never becomes `needs_action`.

- [x] **Step 3: Add exact retry coverage**

  Start with the first packet accepted and the second packet interrupted. After retry/reconstruction, assert completed check IDs are unchanged and `buildDocumentReviewDispatch` derives exactly the same second packet with a new dispatch identity.

- [x] **Step 4: Run focused workflow regression**

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-manager-resilience.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts
  ```

  Expected: zero failures.

### Task 6: Full verification and pollution audit

**Files:**
- No production changes unless a failing verification proves they are necessary.

- [x] **Step 1: Run the full affected service suite**

  ```bash
  /Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src packages/@ant/model-provider/src
  ```

- [x] **Step 2: Run repository type checking and diff checks**

  ```bash
  /Users/nswell/.bun/bin/bun run typecheck
  git diff --check
  ```

- [x] **Step 3: Audit forbidden residuals**

  Inspect the final diff and search changed Reviewer/Provider code for a second terminal, feedback loop, forced tool choice, retry counter, compatibility parser, prompt keyword routing, token/time limit, or example-project mutation. Remove any such residual before completion.

- [x] **Step 4: Report only verified scope**

  Report test counts, exact packet reduction, changed files, and whether any unrelated dirty files remain. Do not claim a live generated project completed unless a fresh external run proves it.
