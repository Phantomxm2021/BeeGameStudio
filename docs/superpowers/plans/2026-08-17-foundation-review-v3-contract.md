# Foundation Review v3 Three-Lane Assembly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fourth model-backed synthesis Reviewer with deterministic local assembly of three complete, actionable Reviewer lane packets.

**Architecture:** Three disjoint Reviewer lanes remain the only model-backed review work. Each lane returns the complete repair contract for every conflict it owns; Bee Game Studio validates and persists those packets, then reads the three committed packets in fixed order, removes only byte-equivalent complete conflicts, assigns mechanical IDs, derives the verdict, and atomically commits `review.json`. Lane acceptance is persisted before local assembly, so restart recovery can repeat assembly without redispatching a model.

**Tech Stack:** TypeScript, Zod 4, Node.js filesystem and SHA-256 APIs, Bun test, BGS delivery workflow, React Dashboard, Chrome acceptance.

## Global Constraints

- Keep exactly three model-backed Reviewer roles: `core-design`, `technical-assets`, and `presentation`.
- Delete the `synthesis` role, dispatch, prompt, worker schema branch, persisted-state role, recovery assumption, API projection, Dashboard task, and synthesis-specific tests.
- Each lane conflict contains exactly `ownerPath`, `title`, `problem`, `evidence`, `requiredOutcome`, `changes`, and `acceptance`.
- Bee Game Studio may validate, order, remove exact duplicates, assign IDs, derive the verdict, and atomically persist bytes; it may not rewrite prose, judge semantic equivalence, invent conflicts, or modify source documents.
- Exact duplicate removal fingerprints the complete parsed conflict excluding the assigned ID; overlapping but non-identical conflicts remain separate.
- Do not modify the native core, provider protocol, model selection, retry policy, watchdog, document authoring, or remediation execution.
- Do not add migration, compatibility parsing, fallback execution, or a second review path. Persisted workflow schema changes require a schema-version increment.
- Follow red-green-refactor: observe each specified failing test before changing the corresponding production behavior.
- Chrome acceptance uses an unchanged accepted eight-document project, stops after Reviewer completion, and proves all eight source hashes remain unchanged.

---

## File Structure

- `foundation-review.ts` owns the shared complete conflict-content schema and final persisted report schema.
- `foundation-review-lane-packet.ts` owns the version-2 lane packet schema, lane prompt contract, evidence/ownership validation, and committed packet reading.
- `foundation-review-assembly.ts` is new and owns only deterministic three-packet assembly plus idempotent final-report commit/replay.
- `foundation-review-state.ts` owns the three-role persisted topology; final report authority stays at the state root rather than becoming a fourth report.
- `foundation-review-stage.ts` owns lane dispatch and lane terminal acceptance only.
- `controller.ts` owns the two durable workflow transitions: persist accepted lane, then run/replay local assembly.
- `worker-contracts.ts`, `worker-prompts.ts`, and `delivery-worker-session-port.ts` expose only lane Reviewer boundaries.
- `document-display-tasks.ts` and `app.ts` project exactly three Dashboard review tasks.

---

### Task 1: Make every lane conflict a complete repair contract

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.ts`

**Interfaces:**
- Produces: `foundationReviewConflictContentSchema` and `FoundationReviewConflictContent`.
- Produces: `foundationReviewLanePacketSchema` with literal `version: 2`, `mode: 'initial'`, and `conflicts: FoundationReviewConflictContent[]`.
- Produces: `readFoundationReviewLanePacketArtifact(input)` for digest-bound reads used by Task 2.
- Preserves: final `foundationReviewSchema`, `acceptFoundationReview()`, and canonical `review.json` version 3.

- [ ] **Step 1: Write failing shared-contract and lane-boundary tests**

In `foundation-review.test.ts`, add a fixture without an ID and prove the final conflict is that same shape plus a mechanical ID:

```ts
const conflictContent = () => ({
  ownerPath: 'docs/GDD.md' as const,
  title: 'Wave authority is contradictory',
  problem: 'The same wave has two incompatible spawn counts.',
  evidence: [
    {
      path: 'docs/GDD.md' as const,
      location: 'Wave table / W3',
      observed: 'The row says 12 units while the rule says 16.',
    },
  ],
  requiredOutcome: 'W3 has one authoritative spawn count.',
  changes: [
    { path: 'docs/GDD.md' as const, action: 'Choose and use one W3 count.' },
  ],
  acceptance: ['Every W3 count in GDD is identical.'],
})

expect(foundationReviewConflictContentSchema.parse(conflictContent())).toEqual(
  conflictContent(),
)
expect(
  foundationReviewSchema.parse({
    version: 3,
    scope: 'foundation',
    revision: 'a'.repeat(64),
    verdict: 'NEEDS_REVISION',
    conflicts: [{ id: 'B1', ...conflictContent() }],
  }).conflicts[0]?.ownerPath,
).toBe('docs/GDD.md')
```

In `foundation-review-lane-packet.test.ts`, replace the candidate fixture with:

```ts
const packet = {
  version: 2,
  scope: 'foundation',
  revision,
  lane: 'core-design',
  mode: 'initial',
  conflicts: [conflictContent()],
}
```

Add assertions that parsing rejects:

```ts
expect(() => foundationReviewLanePacketSchema.parse({ ...packet, version: 1 })).toThrow()
expect(() => foundationReviewLanePacketSchema.parse({ ...packet, candidates: [] })).toThrow()
expect(() =>
  foundationReviewLanePacketSchema.parse({
    ...packet,
    conflicts: [{ ...conflictContent(), ownerPath: 'docs/TECHNICAL_DESIGN.md' }],
  }),
).toThrow()
expect(() =>
  foundationReviewLanePacketSchema.parse({
    ...packet,
    conflicts: [
      {
        ...conflictContent(),
        changes: [
          { path: 'docs/LEVEL_SCENE_DESIGN.md', action: 'Align the level.' },
          { path: 'docs/GDD.md', action: 'Align the rule.' },
        ],
      },
    ],
  }),
).toThrow()
```

Extend acceptance tests to reject an `ownerPath` outside the emitting lane and to accept cross-document evidence only when it exists in that lane's accepted projection.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts
```

Expected: FAIL because the shared content schema is not exported, packet version is 1, and packets still use incomplete `candidates`.

- [ ] **Step 3: Extract the shared content schema and enforce canonical change order**

In `foundation-review.ts`, export the content schema and derive the final conflict schema from it:

```ts
const conflictContentFields = {
  ownerPath: foundationPathSchema,
  title: z.string().trim().min(1).max(160),
  problem: z.string().trim().min(1).max(2_000),
  evidence: z.array(evidenceSchema).min(1).max(32),
  requiredOutcome: z.string().trim().min(1).max(1_200),
  changes: z.array(changeSchema).min(1).max(8),
  acceptance: z.array(z.string().trim().min(1).max(600)).min(1).max(24),
} as const

function validateConflictContent(
  value: { ownerPath: FoundationDocumentPath; changes: Array<{ path: FoundationDocumentPath }> },
  context: z.RefinementCtx,
): void {
    const paths = value.changes.map(change => change.path)
    if (value.ownerPath !== paths[0])
      context.addIssue({ code: 'custom', path: ['ownerPath'], message: 'ownerPath must equal the first change path' })
    if (new Set(paths).size !== paths.length)
      context.addIssue({ code: 'custom', path: ['changes'], message: 'change paths must be unique' })
    const canonical = CANONICAL_FOUNDATION_DOCUMENTS.filter(path => paths.includes(path))
    if (JSON.stringify(paths) !== JSON.stringify(canonical))
      context.addIssue({ code: 'custom', path: ['changes'], message: 'change paths must use canonical Foundation document order' })
}

export const foundationReviewConflictContentSchema = z
  .object(conflictContentFields)
  .strict()
  .superRefine(validateConflictContent)

export type FoundationReviewConflictContent = z.infer<
  typeof foundationReviewConflictContentSchema
>

const conflictSchema = z
  .object({ id: conflictIdSchema, ...conflictContentFields })
  .strict()
  .superRefine(validateConflictContent)
```

Keep `foundationReviewOutputContractInstruction()` temporarily and add
`ownerPath` to its conflict example so the tree remains type-safe until Task 3
deletes the synthesis prompt and this now-unused instruction together.

- [ ] **Step 4: Replace the candidate packet with the complete v2 packet**

In `foundation-review-lane-packet.ts`:

```ts
const basePacketSchema = z.object({
  version: z.literal(2),
  scope: z.literal('foundation'),
  revision: digestSchema,
  lane: laneSchema,
  conflicts: z.array(foundationReviewConflictContentSchema).max(8),
})
```

Update normalization and evidence validation to iterate `packet.conflicts`. Add lane ownership validation:

```ts
for (const conflict of input.packet.conflicts) {
  if (!ownedPaths.has(conflict.ownerPath))
    throw new Error('foundation review conflict owner path is outside lane authority')
  for (const evidence of conflict.evidence) {
    if (!ownedPaths.has(evidence.path) && !projectedByPath.has(evidence.path))
      throw new Error('foundation review evidence path is outside lane authority')
  }
}
```

Delete `normalizeEvidencePath()` and `normalizePacketEvidencePaths()` and parse
the submitted JSON value directly. Absolute or non-canonical paths must be
rejected; Bee Game Studio must not rewrite a Reviewer result into validity.

Change the lane instruction to show the complete conflict fields, require canonical `changes` ordering, state that the lane owns `ownerPath`, and forbid verdicts, IDs, replacement prose, document changes, and additional Agents.

Export a committed-reader that confines the path, parses bytes, and verifies the optional expected digest:

```ts
export async function readFoundationReviewLanePacketArtifact(input: {
  workspacePath: string
  revision: string
  laneId: FoundationDocumentLaneId
  expectedDigest?: string
}): Promise<{ packet: FoundationReviewLanePacket; path: string; digest: string }>;
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 6: Commit the complete lane contract**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts
git commit -m "feat: make reviewer lanes emit complete conflicts"
```

---

### Task 2: Assemble the three committed packets deterministically

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`

**Interfaces:**
- Consumes: `readFoundationReviewLanePacketArtifact()` and `FoundationReviewConflictContent` from Task 1.
- Produces: `assembleFoundationReview(input): Promise<Awaited<ReturnType<typeof acceptFoundationReview>>>`.
- Guarantees: no model call, fixed lane/item order, exact-content deduplication, stable IDs/digest, idempotent replay, no partial committed report on validation failure.

- [ ] **Step 1: Write failing deterministic-assembly tests**

Create fixtures for three committed lane packets and their digest map. Add tests proving:

```ts
const completed = await assembleFoundationReview({
  workspacePath,
  revision,
  currentRevision: revision,
  attempt: 1,
  packetDigests: {
    'core-design': coreDigest,
    'technical-assets': technicalDigest,
    presentation: presentationDigest,
  },
})
expect(completed.review.verdict).toBe('NEEDS_REVISION')
expect(readReview().conflicts.map(conflict => conflict.id)).toEqual(['B1', 'B2', 'B3'])
expect(readReview().conflicts.map(conflict => conflict.ownerPath)).toEqual([
  'docs/GDD.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
])
```

Add separate cases for:

- all three packets empty produce `READY` and `conflicts: []`;
- the exact same complete conflict repeated inside one packet retains its first occurrence once;
- two conflicts with the same title but different evidence or action both remain;
- missing report digest, missing packet, changed packet digest, wrong revision, wrong lane, and invalid owner path reject before `review.json` exists;
- calling the function twice returns the same final path/digest rather than failing or rewriting;
- an incomplete packet-digest map is rejected and commits no report.

- [ ] **Step 2: Run the new test and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts
```

Expected: FAIL with module-not-found for `foundation-review-assembly`.

- [ ] **Step 3: Implement the local assembler**

Create `foundation-review-assembly.ts` with this public signature:

```ts
export async function assembleFoundationReview(input: {
  workspacePath: string
  revision: string
  currentRevision: string
  attempt: number
  packetDigests: Record<FoundationDocumentLaneId, string>
}): Promise<Awaited<ReturnType<typeof acceptFoundationReview>>>
```

Implementation sequence:

```ts
if (input.revision !== input.currentRevision)
  throw new Error('canonical artifacts changed during foundation review')

const packets = await Promise.all(
  FOUNDATION_DOCUMENT_LANES.map(lane =>
    readFoundationReviewLanePacketArtifact({
      workspacePath: input.workspacePath,
      revision: input.revision,
      laneId: lane.id,
      expectedDigest: input.packetDigests[lane.id],
    }),
  ),
)
```

Flatten in `FOUNDATION_DOCUMENT_LANES` order. For each parsed conflict, compute:

```ts
const fingerprint = createHash('sha256')
  .update(JSON.stringify(conflict))
  .digest('hex')
```

Retain only the first unseen fingerprint. Assign `B${index + 1}`, derive `READY` only for zero conflicts, parse the complete object with `foundationReviewSchema`, and serialize exactly:

```ts
const bytes = Buffer.from(`${JSON.stringify(review, null, 2)}\n`, 'utf8')
```

Use the staging dispatch ID ``foundation-initial-${input.attempt}-assembly``,
fsync the staged bytes, and call `acceptFoundationReview()`. If the committed
report already exists on replay, read it with `readFoundationReviewArtifact()`,
require its bytes/digest to equal the freshly assembled result, and reuse it. A
mismatch fails closed.

- [ ] **Step 4: Run the assembly tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 5: Commit the deterministic assembler**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts
git commit -m "feat: assemble foundation review locally"
```

---

### Task 3: Delete synthesis from backend topology and wire crash-safe assembly

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.foundation-review.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

**Interfaces:**
- Consumes: `assembleFoundationReview()` from Task 2.
- Produces: three-role `FoundationReviewState`, lane-only dispatches/terminals/prompts, `finalizeFoundationReviewIfReady(input): Promise<FoundationReviewState>`, and a controller transition that persists lane acceptance before attempting local assembly.

- [ ] **Step 1: Write failing three-role topology and dispatch tests**

Change state expectations to:

```ts
expect(createFoundationReviewState({ revision }).reports.map(report => report.role)).toEqual([
  'core-design',
  'technical-assets',
  'presentation',
])
```

Replace synthesis dispatch/terminal tests with assertions that:

```ts
expect((await buildFoundationReviewDispatches({ state, workspacePath, confirmedBriefDigest })).map(x => x.role)).toEqual([
  'core-design',
  'technical-assets',
  'presentation',
])
expect(await buildFoundationReviewDispatches({
  state: stateWithThreeCompletedLanes,
  workspacePath,
  confirmedBriefDigest,
})).toEqual([])
```

Add parsing tests that `foundationReviewWorkerTerminalSchema` rejects role `synthesis`, and delivery-session tests that every Reviewer request receives `foundationReviewLanePacketSchema` rather than `foundationReviewSchema`.

In `controller.foundation-review.test.ts`, accept two valid lane packets,
tamper one committed sibling packet, then accept the third valid lane. Assert
the controller persists all three completed lane digests and records a local
assembly failure without changing any lane to failed. Restore the exact sibling
bytes, retry the run, and assert assembly completes without creating another
Reviewer dispatch.

- [ ] **Step 2: Run the backend topology tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts
```

Expected: FAIL because the fourth role, dispatch branch, prompt branch, final schema selection, and terminal remain executable.

- [ ] **Step 3: Reduce persisted review state to three reports**

Change `FoundationReviewRole` to:

```ts
export type FoundationReviewRole = FoundationDocumentLaneId
```

Create and validate reports in `FOUNDATION_DOCUMENT_LANES` order. Every report
path must equal the template
``.beegame/reviews/foundation/${revision}/parts/${lane}.json``. Completed review
authority remains only in `finalReportPath`, `finalReportDigest`, and `verdict`;
do not create a synthetic fourth report.

- [ ] **Step 4: Remove synthesis dispatch, prompt, terminal, and schema selection**

In `foundation-review-stage.ts`, delete the synthesis imports and branches. `pendingRoles()` returns only pending lane reports. `acceptFoundationReviewWorkerTerminal()` accepts and commits one lane packet, updates only that report, and always returns `status: 'running'`; final completion belongs to the local assembler.

Add a lane-state wrapper that returns unchanged state until all three reports
are completed and then maps the accepted local artifact into root final
authority:

```ts
export async function finalizeFoundationReviewIfReady(input: {
  state: FoundationReviewState
  workspacePath: string
  currentRevision: string
}): Promise<FoundationReviewState> {
  const state = assertFoundationReviewState(input.state)
  if (!state.reports.every(report => report.status === 'completed' && report.digest))
    return state
  const accepted = await assembleFoundationReview({
    workspacePath: input.workspacePath,
    revision: state.revision,
    currentRevision: input.currentRevision,
    attempt: state.attempt,
    packetDigests: Object.fromEntries(
      state.reports.map(report => [report.role, report.digest!]),
    ) as Record<FoundationDocumentLaneId, string>,
  })
  return assertFoundationReviewState({
    ...state,
    status: 'completed',
    finalReportPath: accepted.path,
    finalReportDigest: accepted.digest,
    verdict: accepted.review.verdict,
  })
}
```

In `worker-contracts.ts`, use:

```ts
role: z.enum(['core-design', 'technical-assets', 'presentation'])
```

and always derive the report path as `parts/${value.role}.json`.

In `worker-prompts.ts`, delete the synthesis condition and `foundationReviewOutputContractInstruction` import. Every supported Reviewer receives only `foundationReviewLanePacketContractInstruction()`.

In `delivery-worker-session-port.ts`, remove `'synthesis'` from contract types and guards and always select `foundationReviewLanePacketSchema` for a Foundation Reviewer.

- [ ] **Step 5: Persist lane acceptance before local assembly**

In the controller terminal path, perform two writes:

```ts
const laneAccepted = await acceptFoundationReviewWorkerTerminal(...)
next = await persist(
  { ...next, foundationReviewState: laneAccepted },
  'foundation.review.lane.accepted',
)
try {
  const finalized = await finalizeFoundationReviewIfReady({
    workspacePath: input.workspacePath,
    state: next.foundationReviewState!,
    currentRevision: await computeDocumentRevision(
      input.workspacePath,
      next.confirmedBriefDigest,
    ),
  })
  if (finalized !== next.foundationReviewState)
    next = await persist(
      { ...next, foundationReviewState: finalized },
      'foundation.review.completed',
    )
} catch (error) {
  const failureReason = error instanceof Error ? error.message : String(error)
  next = await persist(
    {
      ...next,
      status: 'needs_action',
      blockedReason: `Foundation review assembly failed: ${failureReason}`,
      foundationReviewState: {
        ...next.foundationReviewState!,
        status: 'failed',
        failureReason,
      },
    },
    'foundation.review.assembly.failed',
  )
}
```

Do not rethrow an assembly error after lane acceptance. The Reviewer dispatch
has already succeeded; marking it failed would corrupt durable truth. Existing
retry logic changes the root review status back to running while preserving all
three completed reports, so resume retries only deterministic local assembly.

On resume, call `finalizeFoundationReviewIfReady()` after revision/state initialization and before `buildFoundationReviewDispatches()`. If it completes, persist the completed state and route `READY` or `NEEDS_REVISION`; otherwise dispatch only pending lanes. This makes a crash after the third packet recover locally without a fourth worker or lane redispatch.

- [ ] **Step 6: Run the topology tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 7: Commit backend synthesis removal**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
git commit -m "refactor: remove foundation review synthesis worker"
```

---

### Task 4: Close persistence, retry, recovery, and API contracts

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`

**Interfaces:**
- Consumes: the Task 3 three-report persisted topology.
- Produces: schema version 27, failed-lane-only retry, fail-closed recovery, and API projection with no synthesis role.

- [ ] **Step 1: Write failing persistence and recovery tests**

Add assertions that:

```ts
expect(deliveryRunSchema.parse(currentRun).foundationReviewState?.reports).toHaveLength(3)
expect(() => deliveryRunSchema.parse(runContainingSynthesisReport)).toThrow()
```

Keep the retry regression that completed sibling lane reports retain their digest while only failed/running lanes reset to pending. Update recovery fixtures to three roles and assert a damaged review snapshot cannot reconstruct a fourth task or bypass the final report gate. Update session-route projection expectations to exactly the three lane task IDs.

- [ ] **Step 2: Run persistence and recovery tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

Expected: FAIL because the persisted schema and projections still allow `synthesis`, and the schema fingerprint still describes version 26.

- [ ] **Step 3: Change the persisted topology and increment its version**

Remove `synthesis` from `foundationReviewStateSchema`, set:

```ts
export const DELIVERY_RUN_SCHEMA_VERSION = 27 as const
```

Run the schema fingerprint helper with the same canonicalization and SHA-256 algorithm used by `schema-evolution.test.ts`, then add the printed 64-hex value as key `27` in `PERSISTED_SCHEMA_FINGERPRINTS`. Do not alter or delete fingerprints 13 through 26; obsolete snapshots must remain explicitly rejected by the existing version gate.

- [ ] **Step 4: Remove synthesis from recovery and API projections**

Update recovery fixtures and reconstruction to use `createFoundationReviewState()`, which now yields three reports. In `app.ts`, accept and project only the three lane role strings. Preserve per-role `failureReason` and the digest-checked final report Markdown behavior already implemented.

- [ ] **Step 5: Run persistence and recovery tests and verify GREEN**

Run the Step 2 command. Expected: all tests PASS.

- [ ] **Step 6: Commit persistence closure**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts packages/agent-workflow-server/src/app.ts
git commit -m "fix: persist three-lane foundation review state"
```

---

### Task 5: Render exactly three Reviewer tasks in the Dashboard

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- Consumes: the three-role API projection from Task 4.
- Produces: exactly three ordinary Reviewer task rows with existing pending/running/completed/failed/stopped visuals and per-task failure text.

- [ ] **Step 1: Write failing three-task UI projection tests**

Change the backend task fixture to three reports and assert:

```ts
expect(tasks.map(task => task.id)).toEqual([
  'review:foundation:core-design',
  'review:foundation:technical-assets',
  'review:foundation:presentation',
])
expect(tasks.map(task => task.title)).toEqual([
  '核心设计',
  '技术与资产',
  '表现体验',
])
```

In `WorkflowCard.test.tsx`, remove the `review:synthesis` fixture and assert the card renders exactly those three task labels, completion checkmarks for completed lanes, and the original role-specific failure text for a failed lane. Assert `阻塞问题汇总` is absent.

- [ ] **Step 2: Run backend and frontend UI tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts
bun run --cwd apps/frontend test:run -- src/components/Demiurge/WorkflowCard.test.tsx
```

Expected: FAIL because the task projection and frontend fixture still contain the synthesis task.

- [ ] **Step 3: Remove the fourth task from the display contract**

Remove `synthesis` from `DocumentDisplayTaskInput.foundationReview.reports` and from `reviewTaskTitle`. Keep `projectFoundationReviewTasks()` as a direct map of backend report state; do not create a local assembly task, status, progress bar, or explanatory report panel.

- [ ] **Step 4: Run backend and frontend UI tests and verify GREEN**

Run the Step 2 commands. Expected: both suites PASS.

- [ ] **Step 5: Commit the Dashboard cleanup**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
git commit -m "fix: show three foundation reviewer tasks"
```

---

### Task 6: Delete obsolete synthesis evidence and run automated acceptance

**Files:**
- Modify only the test files named below when removing synthesis-only fixtures or assertions.
- Modify: `docs/superpowers/specs/2026-08-17-foundation-review-v3-contract-design.md` only if implementation names changed while preserving the approved behavior.

**Interfaces:**
- Consumes: Tasks 1 through 5.
- Produces: static proof of one review path, full focused regression evidence, type safety, and a clean diff.

- [ ] **Step 1: Delete synthesis-only fixtures and assert the executable tree is clean**

Run:

```bash
rg -n "synthesis|foundation-initial-[^ ]*-synthesis|阻塞问题汇总" packages/agent-workflow-server/src apps/frontend/src --glob '*.ts' --glob '*.tsx' --glob '!*.test.ts' --glob '!*.test.tsx'
```

Expected: no Foundation Review production matches. Delete obsolete synthesis fixtures and positive assertions in:

```text
packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts
packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
packages/agent-workflow-server/src/__tests__/session-routes.test.ts
packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts
packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts
packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts
packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts
apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
```

Keep only explicit negative assertions that prove `synthesis` is rejected or absent.

- [ ] **Step 2: Run the complete focused backend suite**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.foundation-review.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
```

Expected: zero failures.

- [ ] **Step 3: Run frontend, type, and diff checks**

Run:

```bash
bun run --cwd apps/frontend test:run -- src/components/Demiurge/WorkflowCard.test.tsx
bun run typecheck
git diff --check
```

Expected: zero failures and no whitespace errors.

- [ ] **Step 4: Commit automated acceptance closure**

```bash
git add packages/agent-workflow-server/src apps/frontend/src docs/superpowers/specs/2026-08-17-foundation-review-v3-contract-design.md
git commit -m "test: verify three-lane review assembly"
```

---

### Task 7: Run Reviewer-only Chrome acceptance

**Files:**
- Create: `docs/superpowers/reviews/2026-08-18-foundation-review-three-lane-chrome-acceptance.md`
- Do not modify: the eight canonical Foundation source documents.

**Interfaces:**
- Consumes: the production Web/React workflow from Tasks 1 through 6.
- Produces: browser-level evidence that three Reviewer lanes complete, local assembly commits one report, no synthesis task exists, and remediation does not start.

- [ ] **Step 1: Record the eight source hashes before the run**

From the accepted test project, run:

```bash
shasum -a 256 docs/GDD.md docs/LEVEL_SCENE_DESIGN.md docs/BALANCE.md docs/TECHNICAL_DESIGN.md docs/ASSET_PLAN.md docs/ART_DIRECTION.md docs/UI_UX.md docs/AUDIO_DESIGN.md
```

Save the eight path/digest pairs in the acceptance report's `Before` table
before starting Reviewer work.

- [ ] **Step 2: Start the fixed-port stack and open the Web/React Dashboard in Chrome**

Use the repository's fixed-port Web/React acceptance command and the `chrome:control-chrome` skill. Open the existing accepted eight-document project. Do not use a direct API-only path and do not create a new example project.

- [ ] **Step 3: Run only Foundation Review**

Start or resume the Foundation Review stage. Observe exactly three tasks:
`核心设计`, `技术与资产`, and `表现体验`. Wait until all three have terminal
status and deterministic local assembly commits the report. Any validation
failure fails this acceptance run and must be diagnosed before another run.
Stop immediately after the report is displayed; do not execute remediation,
checklist drafting, resource work, or implementation.

- [ ] **Step 4: Verify persisted authority and source immutability**

Verify:

```text
.beegame/reviews/foundation/${revision}/parts/core-design.json
.beegame/reviews/foundation/${revision}/parts/technical-assets.json
.beegame/reviews/foundation/${revision}/parts/presentation.json
.beegame/reviews/foundation/${revision}/review.json
```

Parse all four artifacts through their production readers, verify persisted digests, verify final IDs/order/verdict, and rerun the Step 1 hash command. Every source hash must match. Search the run events and UI for `synthesis`; there must be no synthesis dispatch, task, prompt, or terminal.

- [ ] **Step 5: Persist acceptance evidence and commit it**

Write
`docs/superpowers/reviews/2026-08-18-foundation-review-three-lane-chrome-acceptance.md`
with these exact sections:

```markdown
# Foundation Review Three-Lane Chrome Acceptance

## Scope and stop boundary
## Fixed ports and project identity
## Before source hashes
## Three Reviewer task timeline
## Persisted packet and final report digests
## After source hashes
## Negative evidence
## Result
```

Record the observed project ID, revision, three lane start/end timestamps,
packet paths/digests, final report path/digest/verdict, before/after source
hashes, synthesis dispatch count, and remediation dispatch count. `Result` may
say `PASSED` only when synthesis and remediation dispatch counts are zero and
all eight before/after hashes match.

Run `git diff --check`, then commit only acceptance evidence and any test expectation that records the observed fixed result:

```bash
git add docs/superpowers/reviews/2026-08-18-foundation-review-three-lane-chrome-acceptance.md
git commit -m "test: accept three-lane foundation review"
```

---

## Completion Gate

The implementation is complete only when all of the following are true:

- production code contains no Foundation Review `synthesis` role or branch;
- three complete lane packets are the only model outputs;
- local assembly preserves lane/item order, removes only exact complete duplicates, and assigns stable `B1...` IDs;
- lane state is durably persisted before assembly, and resume completes locally without redispatching a model;
- stale or malformed packets commit no final report;
- retry preserves completed siblings and resets only unfinished lanes;
- Dashboard and API expose exactly three Reviewer tasks with per-role failures;
- focused backend, frontend, typecheck, and diff checks pass;
- Chrome acceptance proves one final report, unchanged eight-document hashes, no synthesis dispatch, and no remediation execution.
