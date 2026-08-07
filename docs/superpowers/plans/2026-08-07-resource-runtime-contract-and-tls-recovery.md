# Resource Runtime Contract and TLS Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permanently eliminate the three recurring resource-processing failure classes: external TLS transport failures, non-JSON semantic-model responses, and semantic evidence values outside the canonical contract.

**Architecture:** Keep one Resource Processing job state machine, one outbound resource-service/storage path, and one canonical semantic response contract. TLS failures remain certificate-verified and are classified as recoverable transport failures; model responses are constrained to the canonical JSON schema at generation time and strictly validated again at the Resource Server boundary. No fallback parser, legacy evidence vocabulary, alternate download path, compatibility mapping, or second metadata writer is introduced.

**Tech Stack:** TypeScript, Bun, Hono, Zod v4, Supabase REST, Cloudflare R2/S3, existing BeeGame model runtime, Bun tests.

## Global Constraints

- Do not disable TLS certificate verification or use `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- Do not add a second resource queue, second download path, second semantic metadata writer, fallback JSON parser, or legacy evidence vocabulary.
- `content_profile`, `technical_facts`, and `content_preview` remain the only evidence-source values.
- `asset_kind`/file format describe the resource; `evidence.source` describes the evidence origin.
- Do not infer resource semantics from filenames, extensions, paths, keywords, regular expressions, Pack IDs, or project names.
- Do not add an artificial model wall-clock limit or token limit that kills a valid task.
- Do not mark a resource-processing item completed without an accepted durable receipt.
- Do not modify example projects; use generic fixtures and the reported Pack only as read-only evidence.

---

### Task 1: Establish one classified external transport boundary

**Files:**

- Create: `packages/beegame-resource-core/src/external-transport.ts`
- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `packages/beegame-resource-server/src/r2-resource-storage.ts`
- Do not modify: `packages/beegame-storage-core/src/r2-storage-driver.ts`; classify the existing driver calls at the Resource Storage boundary.
- Test: `packages/beegame-resource-server/src/__tests__/resource-external-transport.test.ts`
- Test: existing resource-processing, repository, R2-storage, and R2-driver tests

**Interfaces:**

- `ResourceExternalTransportError` carries `service`, `operation`, `retryable`, and the original error without exposing credentials.
- One resource-core request wrapper classifies external transport failures before HTTP response parsing.
- Supabase REST and R2 SDK failures are classified at their existing Resource Server boundaries; the driver remains the only R2 transport.
- Each local service creates its TLS-aware external fetch from the shared mTLS utility at startup and injects it into its Supabase, Resource Runtime, billing, and authenticated user-context requests; call sites do not select another transport.

- [x] **Step 1: Write failing tests for the two external TLS boundaries**

  Simulate certificate-verification failures for a Supabase metadata request and an R2 object operation. Assert that both produce the same typed transport classification, preserve certificate verification, and never become a Pack/content validation error. Add a non-TLS HTTP 4xx test to prove application errors are not classified as transport failures.

- [x] **Step 2: Run the focused tests**

  Run:

  ```bash
  bun test packages/beegame-resource-server/src/__tests__/resource-external-transport.test.ts packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts packages/beegame-storage-core/src/__tests__/r2-storage-driver.test.ts
  ```

  Expected: the new transport classification assertions fail because the current fetch and SDK errors are untyped.

- [x] **Step 3: Implement the single classified boundary**

  Wrap the existing Supabase REST request helper and the existing R2 SDK send path. Preserve the configured HTTPS URL and native certificate verification. Never catch a certificate error and continue through another endpoint. Include only safe host/operation diagnostics in the error; do not log tokens, signed URLs, or response bodies containing credentials.

- [x] **Step 4: Verify the boundary**

  Re-run the focused tests. Then run the resource-server and storage-core type checks. Expected: TLS errors are classified consistently, HTTP errors retain their status/detail, and no insecure TLS option appears in the diff.

### Task 2: Make startup recovery durable and transport-aware

**Files:**

- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/beegame-resource-core/src/types.ts` only if the existing job contract needs a typed recoverable state
- Test: `packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts`

**Interfaces:**

- `resumePending()` uses the same classified Supabase request boundary as normal job operations.
- A recoverable external transport failure leaves the durable job at its existing queued/running checkpoint; it must not be reported as completed or as a semantic/content failure.
- A successfully recovered job enters the existing `activeJobs` set exactly once and continues from queued/running items.

- [x] **Step 1: Write failing recovery tests**

  Cover: startup recovery with one transient TLS failure followed by success; permanent TLS failure; a job containing already-completed items; and two recovery attempts for the same job. Assert that completed items are not reprocessed, pending items remain recoverable, and no duplicate worker is scheduled.

- [x] **Step 2: Run the focused recovery tests**

  ```bash
  bun test packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts
  ```

- [x] **Step 3: Implement recovery without false terminal states**

  Apply transport retry/backoff only to the recovery metadata request and keep the durable job unchanged when the external service is unavailable. Once the request succeeds, normalize only interrupted `running` inspection items according to the existing state rules and schedule the same job runner. Do not recreate a job, reset completed items, or add a second recovery queue. A non-transport persistence or schema error must remain a real failure and must not be hidden as a TLS retry.

- [x] **Step 4: Verify restart semantics**

  Re-run the focused tests and the full resource-processing suite. Confirm that UI-visible progress derives from the durable job state and that a restart resumes from the exact unfinished item/batch.

### Task 3: Define one canonical structured semantic-model response

**Files:**

- Modify: `packages/beegame-resource-core/src/semantic-curation.ts`
- Modify: `packages/beegame-resource-core/src/types.ts`
- Modify: `packages/beegame-resource-core/src/index.ts`
- Modify: `packages/beegame-resource-server/src/semantic-curation-model.ts`
- Modify: `packages/agent-workflow-server/src/beegame/model-runtime-host.ts`
- Modify: `packages/agent-workflow-server/src/beegame/model-runtime-worker.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts`
- Test: `packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`
- Test: relevant model-runtime-host/worker tests

**Interfaces:**

- Core exports one canonical semantic-model output schema with exactly `{ decisions }`.
- The model runtime receives one structured-output tool contract for this request and serializes the provider tool input through the existing `content` transport without a second response protocol.
- The Resource Server parses the same core contract; it does not strip Markdown, search for the first JSON object, repair brackets, or silently coerce values.

- [x] **Step 1: Write failing response-contract tests**

  Add cases for: valid canonical JSON; prose before JSON; Markdown code fences; truncated JSON; an outer JSON envelope whose `content` is not a string; a valid JSON object with an unsupported evidence source; and a valid object with the wrong decision count. Assert distinct errors for transport-envelope failure, invalid JSON content, and semantic contract failure.

- [x] **Step 2: Run the focused tests**

  ```bash
  bun test packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts
  ```

- [x] **Step 3: Implement the one structured generation contract**

  Generate the JSON Schema/structured-output definition from the canonical core contract or expose the canonical schema directly to the model runtime. The runtime must fail clearly when the selected provider cannot honor the structured contract; it must not fall back to free-text generation. Keep the existing prompt as semantic guidance, not as the only format guarantee. Remove any model-runtime wall-clock/token kill that can terminate a valid curation request.

- [x] **Step 4: Preserve strict semantic validation**

  Keep `evidence.source` restricted to `content_profile`, `technical_facts`, and `content_preview`. Record the offending element ID, evidence index, field path, and safe invalid value in the internal diagnostic, while keeping secrets and full model content out of logs. Do not add `fbx`, `filename`, `model`, or `file` as evidence sources.

- [x] **Step 5: Verify valid and invalid responses**

  Re-run the focused tests and model-runtime tests. Expected: valid structured output reaches semantic validation; every non-JSON or unsupported response is rejected before any durable mutation.

### Task 4: Keep semantic batches atomic and retryable

**Files:**

- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Modify: `packages/beegame-resource-server/src/semantic-curation-model.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `packages/beegame-resource-core/src/repository.ts` and its existing implementations only where the current semantic receipt contract requires it
- Test: semantic processing, repository, and receipt tests

**Interfaces:**

- A batch is accepted only after every decision passes the canonical response contract and one durable receipt is persisted.
- A malformed model response cannot partially write tags, suggestions, or technical facts.
- A retry reuses the same frozen item identities, content hashes, curator revision, and batch checkpoint; it does not reprocess accepted items.

- [x] **Step 1: Write failing atomicity/retry tests**

  Cover one invalid decision among several valid decisions, retry after invalid JSON, retry after unsupported evidence source, repeated accepted receipt, stale content hash, and restart after the model response but before receipt persistence.

- [x] **Step 2: Run the focused tests**

  ```bash
  bun test packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts packages/beegame-resource-server/src/__tests__/supabase-resource-repository.test.ts packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts
  ```

- [x] **Step 3: Implement one durable commit boundary**

  Keep the existing all-or-nothing batch receipt rule. On response-contract failure, persist only the safe failure diagnostic and leave the batch retryable; do not commit any decision from that response. On an accepted receipt, make the repository commit idempotent by batch/item identity and content hash, then mark the items completed.

- [x] **Step 4: Verify no duplicate writes**

  Confirm that accepted decisions survive restart, rejected responses do not change confirmed tags, and a retry cannot create a second metadata writer or duplicate receipt.

### Task 5: Audit configuration, diagnostics, and generic end-to-end behavior

**Files:**

- Modify only configuration/docs needed to record the canonical runtime contract and TLS requirements.
- Test: generic resource fixtures and existing end-to-end resource processing tests.
- Do not modify: any example project or user Pack contents.

- [ ] **Step 1: Validate runtime configuration from the same Bun process**

  Verify the configured Supabase host and R2 endpoint resolve and present a valid certificate chain from the actual resource-server runtime. Verify that no proxy or custom CA setting is silently changing the endpoint. Do not use browser success as evidence for the Bun runtime.

- [x] **Step 2: Run generic failure fixtures**

  Use engine-neutral fixtures for a model with a dependent texture, an image, an audio resource, an invalid model response, an unsupported evidence source, a transient TLS failure, and a permanent TLS failure. Do not encode any real Pack ID, filename, project name, or log text in production logic.

- [x] **Step 3: Run the full verification set**

  ```bash
  bun test packages/beegame-resource-core
  bun test packages/beegame-resource-server
  bun test packages/beegame-storage-core
  bun test packages/agent-workflow-server/src/__tests__/resource-selection-client.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts
  bunx tsc --noEmit -p packages/beegame-resource-server/tsconfig.json
  bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json
  git diff --check
  ```

- [x] **Step 4: Perform the single-path audit**

  Confirm there is exactly one resource processing queue, one Resource Library resolution path, one R2 download path, one semantic response schema, one evidence vocabulary, and one durable metadata commit. Remove any stale fallback parser, old import action, filename classifier, insecure TLS switch, or second receipt path discovered during the audit.

- [ ] **Step 5: Verify the reported Pack without editing it**

  Re-run only the relevant resource operation against the reported Pack after the system-level tests pass. Verify that the existing durable checkpoint resumes, accepted resources are not re-downloaded, and no prior stage is repeated.

## Self-review against the requirements

- Unknown certificate verification error: Tasks 1, 2, and 5 classify, recover, and verify the actual external TLS boundaries without disabling validation.
- Non-JSON model content: Task 3 enforces structured generation and keeps strict parsing.
- Unsupported evidence source: Task 3 keeps one canonical enum and reports the exact invalid field.
- Batch poisoning and duplicate writes: Task 4 preserves atomic receipts and exact retry checkpoints.
- Token/time waste: Task 3 removes artificial model termination; Tasks 2 and 4 avoid repeating accepted work.
- No dual track, compatibility, feedback, or legacy logic: Global Constraints and Task 5 explicitly audit and remove them.
- Platform/engine neutrality: all contracts remain resource/content/runtime-neutral.
