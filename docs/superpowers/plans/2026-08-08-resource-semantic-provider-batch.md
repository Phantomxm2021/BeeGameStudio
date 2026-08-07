# Resource Semantic Provider Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Submit all resource-semantic sub-batches through one native asynchronous Provider Batch job while preserving the existing 8-element visual contract, durable receipts, per-sub-batch retry, and rendered-image-only inference.

**Architecture:** The resource semantic route remains one canonical route. A durable semantic job freezes its ordered items, partitions them into the existing 1–8 element visual requests, and submits those requests once to the selected Provider's native Batch API. The durable job stores the provider batch identity before polling; recovery resumes polling and never creates a second semantic submission for an already submitted job. Provider results are matched by `custom_id`, parsed by the same canonical semantic response parser, and committed independently per sub-batch. Unsupported providers fail closed before the semantic job starts; there is no synchronous fallback, compatibility branch, duplicate queue, or second decision ledger.

**Tech Stack:** TypeScript, Bun, Hono, existing isolated model runtime, Anthropic Message Batches as the first native multimodal/tool-capable adapter, Supabase durable processing state, existing Resource Semantic visual contract.

---

## Authority and non-negotiable rules

- The Provider Batch job is an execution transport only. It does not replace the resource semantic contract or create a second semantic interpretation.
- Each provider batch request contains at most 8 elements and uses the existing `individual`/`atlas` visual input contract. One provider batch is not one 161-element prompt.
- Every returned decision still requires `content_preview` evidence and the existing content-hash, element-identity, curator-revision, and exact-output checks.
- Provider result order is never trusted; `custom_id` is the only result identity.
- A provider submission is persisted before polling. Recovery polls the persisted provider batch ID; it never resubmits based on model memory, browser state, or a missing in-memory promise.
- Provider-level errored, cancelled, expired, malformed, or incomplete subrequests become retry items for only that subrequest. They never become metadata-only decisions.
- The resource worker does not impose a wall-clock or token kill limit. Provider expiry is surfaced as a provider result state and scoped retries follow the durable queue.
- Unsupported model providers fail at semantic-job creation with an explicit capability error. No synchronous compatibility path is added.
- Rendered visual payloads remain Admin semantic-curation data and never enter Agent resource selection.

### Task 1: Freeze the provider-batch contract in documentation

**Files:**
- Modify: `docs/beegame-resource-semantic-contract.md`
- Modify: `docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md`
- Create: `docs/superpowers/plans/2026-08-08-resource-semantic-provider-batch.md`

- [ ] **Step 1: Document the difference between a provider batch and a giant prompt.**

  State that one durable semantic job may contain many independent requests, each with no more than 8 visual elements. The batch envelope only changes transport scheduling and cost; it does not merge the request contexts.

- [ ] **Step 2: Document durable submission and recovery.**

  State that the provider batch ID is written before polling, recovery resumes by provider batch ID, and an ambiguous submission is never silently submitted again. Results are matched only by `custom_id`.

- [ ] **Step 3: Document unsupported provider behavior.**

  State that semantic curation requires a native provider batch implementation that preserves multimodal images and the structured decision contract. An unsupported configured provider fails closed before the job is created.

- [ ] **Step 4: Audit the documents.**

  Run:

  ```bash
  rg -n "giant prompt|synchronous fallback|provider batch|custom_id|provider batch id|unsupported provider" \
    docs/beegame-resource-semantic-contract.md \
    docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md \
    docs/superpowers/plans/2026-08-08-resource-semantic-provider-batch.md
  ```

  Confirm the documents describe one semantic route, independent subrequests, durable recovery, and no fallback path.

### Task 2: Define one runtime provider-batch capability

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/model-runtime-host.ts`
- Modify: `packages/agent-workflow-server/src/beegame/model-runtime-worker.ts`
- Create: `packages/agent-workflow-server/src/beegame/model-runtime-batch.ts`
- Test: `packages/agent-workflow-server/src/__tests__/provider-pinning.test.ts`
- Create: `packages/agent-workflow-server/src/__tests__/model-runtime-batch.test.ts`

- [ ] **Step 1: Write failing tests for the runtime contract.**

  Cover these exact invariants:

  ```ts
  test('submits one native provider batch with stable custom ids', async () => {})
  test('returns provider results by custom id rather than response order', async () => {})
  test('rejects an unsupported provider without calling synchronous generate', async () => {})
  test('recovery retrieval uses the persisted provider batch id', async () => {})
  ```

- [ ] **Step 2: Run the tests and verify the new capability is missing.**

  Run `bun test packages/agent-workflow-server/src/__tests__/model-runtime-batch.test.ts` and confirm the failure is the absent batch capability, not a fixture error.

- [ ] **Step 3: Add the provider-neutral types.**

  Add a required runtime capability with these shapes:

  ```ts
  export type BeeGameModelBatchRequest = {
    customId: string
    input: BeeGameModelGenerateInput
  }
  export type BeeGameModelBatchResult = {
    customId: string
    status: 'succeeded' | 'errored' | 'cancelled' | 'expired'
    generation?: BeeGameModelGeneration
    error?: string
  }
  export type BeeGameModelBatchRuntime = {
    submit(requests: readonly BeeGameModelBatchRequest[]): Promise<{ providerBatchId: string }>
    retrieve(providerBatchId: string): Promise<{
      status: 'processing' | 'ended'
      results?: readonly BeeGameModelBatchResult[]
    }>
  }
  ```

  Keep normal `generateWithUsage` for unrelated agent calls; the resource semantic route must use only this batch capability.

- [ ] **Step 4: Implement the isolated worker transport.**

  Add `model.batch.submit` and `model.batch.retrieve` IPC messages. Preserve the existing outbound-target resolution and pinned TLS fetch. Implement the first native adapter for the Anthropic Messages Batch API, including tool definitions, forced tool choice, system prompt, multimodal image blocks, `max_tokens`, and result streaming by `custom_id`. If `modelType !== 'anthropic'`, return a capability error before any provider request.

- [ ] **Step 5: Run the runtime tests.**

  Run `bun test packages/agent-workflow-server/src/__tests__/model-runtime-batch.test.ts packages/agent-workflow-server/src/__tests__/provider-pinning.test.ts` and require zero failures.

### Task 3: Add durable provider-batch state

**Files:**
- Create: `supabase/migrations/20260808000000_resource_provider_batches.sql`
- Modify: `docs/beegame-supabase-schema.sql`
- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Test: `packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts`

- [ ] **Step 1: Write failing state-machine tests.**

  Cover:

  ```ts
  test('submits all semantic sub-batches once and stores providerBatchId', async () => {})
  test('recovery polls providerBatchId without a second submit', async () => {})
  test('commits successful sub-batches and requeues only failed sub-batches', async () => {})
  test('provider batch expiry does not mark successful sub-batches as failed', async () => {})
  ```

- [ ] **Step 2: Run the tests and verify the old one-call state machine fails them.**

  Run the focused resource-processing test file and confirm the expected missing provider-batch state is the failure.

- [ ] **Step 3: Add the minimum durable columns.**

  Add `provider_batch_id text` and `provider_batch_status text` to `beegame_resource_processing_jobs`, with status values `submitting`, `processing`, `ended`, `unknown`, and `null`. Add an index for non-terminal provider batches. Do not add a second job table or a second item ledger.

- [ ] **Step 4: Change the semantic worker to a two-phase submission.**

  For one semantic job, claim the ordered queued items, partition them into the existing maximum-8 subrequests, call the single provider-batch submit callback, persist the returned provider ID and `processing` state, then poll. If recovery sees a persisted provider ID, skip submit and poll it. If submit fails before a provider ID exists, return the existing durable retry state; if the external submission result is ambiguous, persist `unknown` and surface a recoverable provider-batch diagnostic instead of silently creating a duplicate.

- [ ] **Step 5: Apply result partitioning deterministically.**

  Match provider results by `custom_id`, parse each subrequest through the canonical semantic response parser, and update only the corresponding item rows. Sum usage from successful results once. Preserve existing `batch_id`/`batch_receipt_id` for subrequest receipts and clear the job provider state only after all results are durably applied.

- [ ] **Step 6: Run the state-machine tests.**

  Run `bun test packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts` and require zero failures.

### Task 4: Connect Resource Semantic Curation to the provider batch

**Files:**
- Modify: `packages/beegame-resource-server/src/semantic-curation-model.ts`
- Create: `packages/beegame-resource-server/src/semantic-curation-batch.ts`
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`

- [ ] **Step 1: Write failing integration-boundary tests.**

  Cover:

  ```ts
  test('builds one provider batch containing 21 independent visual subrequests', async () => {})
  test('each subrequest keeps its own individual/Atlas visual input', async () => {})
  test('provider results are parsed with the same content-preview evidence gate', async () => {})
  test('unsupported model type fails before durable job creation', async () => {})
  ```

- [ ] **Step 2: Extract one canonical semantic response parser.**

  Move response JSON/tool parsing, exact top-level validation, count/identity/hash/revision checks, and `content_preview` validation into one function shared by synchronous tests and provider-batch result handling. The production semantic route must call only the provider-batch client; it must not create a second parser.

- [ ] **Step 3: Build the provider batch request list.**

  Load canonical bytes and render previews exactly once per element. Partition ordered resources into groups of at most eight, call the existing visual-input builder per group, and create stable `customId` values derived from the durable job and subrequest ordinal. Send one provider-batch submission containing those requests.

- [ ] **Step 4: Implement polling and per-subrequest receipt conversion.**

  Poll the provider batch through the runtime capability. Convert each provider result to either one accepted semantic receipt or retry items for exactly that subrequest. Do not expose provider result ordering or raw tool arguments to the durable worker.

- [ ] **Step 5: Run integration tests.**

  Run:

  ```bash
  bun test \
    packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts \
    packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts \
    packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts
  ```

  Require zero failures and verify the test asserts one provider submission, not 21 synchronous calls.

### Task 5: Preserve UI progress and Agent isolation

**Files:**
- Modify: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx`
- Modify: `apps/frontend/src/services/resourceLibraryApi.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts`
- Test: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.test.tsx`
- Test: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts`

- [ ] **Step 1: Write failing progress tests.**

  Assert that a provider batch in `processing` displays “处理中” with completed/total subrequest progress and usage accumulated from completed results; it must not display “completed” before every result is durably applied.

- [ ] **Step 2: Implement only the existing durable job projection.**

  Expose provider batch processing state through the existing job response. Do not add a second frontend polling endpoint or a provider-specific UI state source.

- [ ] **Step 3: Keep Agent selection metadata-only.**

  Assert that `visualInput`, Base64 images, provider batch IDs, and semantic evidence never enter the compact Agent resource-selection result.

- [ ] **Step 4: Run UI and isolation tests.**

  Run the two focused test files and require zero failures.

### Task 6: Audit, verify, and commit

**Files:**
- Test: all files above
- Audit: all semantic runtime and resource processing files

- [ ] **Step 1: Run all affected tests and type checks.**

  Run:

  ```bash
  bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__ packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts packages/agent-workflow-server/src/__tests__/model-runtime-batch.test.ts
  bun run typecheck
  git diff --check
  ```

- [ ] **Step 2: Scan for forbidden paths.**

  Run:

  ```bash
  rg -n "semantic fallback|synchronous fallback|metadata-only semantic|submit twice|second semantic route|visualInput.*Agent|provider batch.*ignored" \
    packages apps/frontend/src docs/beegame-resource-semantic-contract.md \
    docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md
  ```

  Any runtime match must be removed or changed to an explicit prohibition.

- [ ] **Step 3: Verify restart behavior without live services.**

  Use fake provider responses to simulate process restart after submission and confirm recovery polls the stored provider batch ID, applies each result once, and does not call submit again.

- [ ] **Step 4: Commit the implementation.**

  ```bash
  git add docs packages apps/frontend/src supabase/migrations
  git commit -m "feat: process resource curation with provider batches"
  ```

- [ ] **Step 5: Stop all services and report the exact verification results.**

## Acceptance criteria

- A 161-element semantic job creates one provider Batch job containing about 21 independent subrequests, not one giant prompt.
- Each subrequest preserves the existing rendered image/Atlas contract.
- Provider Batch ID is durable before polling; restart never silently resubmits.
- Results are matched by `custom_id`, never response order.
- Successful and failed subrequests are committed/requeued independently.
- No synchronous semantic fallback, feedback path, compatibility branch, second queue, second ledger, or Agent visual-data path exists.
- Unsupported provider configuration fails clearly before semantic work starts.
- UI reports provider-batch progress and actual usage without inventing completion.
