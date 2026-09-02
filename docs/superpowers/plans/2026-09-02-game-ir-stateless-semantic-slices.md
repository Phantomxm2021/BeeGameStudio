# Game IR Stateless Semantic Slices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the failed live-session packet-once projection transport with one stateless, minimal-authority semantic-slice compiler for all six Game IR modules.

**Architecture:** The durable controller continues to hold the complete service-owned operation packet, but each provider request receives only a deterministic Markdown projection of the current slice's source sections, contract and admitted dependencies. The provider returns strict JSONL records; the service persists an admitted record prefix in the existing operation-local journal, retries only the remaining current-slice work, assembles the existing canonical module, and publishes through the unchanged ten-operation authority chain.

**Tech Stack:** TypeScript, Bun test, Zod v4, AJV, existing Bee Game native CLI/session runtime.

**Spec:** `docs/superpowers/specs/2026-09-02-game-ir-semantic-slice-stream-design.md`

## Global Constraints

- Modify Stage 5 Game IR projection compilation and its narrowly required generic transport metadata only.
- Do not change Foundation Reviewer, Foundation Revision, Checklist, Comprehensive Reviewer/Revision, UI, raw Foundation Markdown contracts or Task 9–15 consumers.
- Keep canonical Game IR JSON, the six module schemas, ten operation manifests, publication receipt and committed reader unchanged.
- Keep the complete operation packet inside the service for identity, journal and assembly; never render that complete packet into a projection-worker prompt.
- Every projection dispatch starts an independent provider session. Do not use provider resume, session affinity, prompt cache or conversation state.
- Do not add compatibility readers, fallback parsers, dual read/write routes, feature flags or fresh-session full-packet fallback.
- Do not introduce token, byte, time, attempt, node, record or slice caps as business admission criteria.
- Keep validation operations on their existing small StructuredOutput path.
- Use TDD for every behavior change. Commit only the files named by the current task.

---

### Task 1: Preserve the real-test observability baseline

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/runtime-observability.ts`
- Test: `packages/agent-workflow-server/src/beegame/runtime-observability.test.ts`

**Interfaces:**
- Consumes: the actual native prompt passed to `NativeCliProcessRuntime.send()`.
- Produces: safe `turn_started.promptByteCount` and `turn_started.resumed` metadata; no prompt body.

- [ ] **Step 1: Inspect the existing uncommitted diagnostic diff**

```bash
git diff -- packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/runtime-observability.ts packages/agent-workflow-server/src/beegame/runtime-observability.test.ts
```

Expected: only `promptByteCount` and `resumed` are added; no prompt, completion or semantic payload is logged.

- [ ] **Step 2: Run the focused diagnostic tests**

```bash
bun test packages/agent-workflow-server/src/beegame/runtime-observability.test.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the isolated evidence change**

```bash
git add packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/runtime-observability.ts packages/agent-workflow-server/src/beegame/runtime-observability.test.ts
git commit -m "feat: observe native prompt size and resume state"
```

### Task 2: Add the deterministic minimal authority projection

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-authority.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-authority.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Consumes: `GameIrProjectionOperationPacket`, `GameIrProjectionSlice`, `GameIrProjectionSliceContext`, compile identity and optional retry diagnostic.
- Produces: `buildGameIrProjectionSliceAuthority(input): GameIrProjectionSliceAuthority` and `renderGameIrProjectionSliceAuthority(authority): string`.
- Produces: one canonical `GAME_IR_SLICE_SOURCE_SECTIONS` map keyed by every current slice ID.

- [ ] **Step 1: Write RED source-scope tests**

```ts
for (const moduleId of GAME_IR_DOMAIN_IDS) {
  for (const slice of deriveProjectionSlicePlan(moduleId).slices) {
    const selectors = sourceSectionsForGameIrProjectionSlice(slice.sliceId)
    expect(selectors.length).toBeGreaterThan(0)
    expect(new Set(selectors.map(item => `${item.documentPath}#${item.sectionId}`)).size).toBe(selectors.length)
  }
}
```

Also reject missing documents, unknown section IDs, duplicate selectors and selectors outside `GAME_IR_MODULE_SOURCE_DOCUMENTS`.

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-authority.test.ts
```

Expected: FAIL because the authority projection API does not exist.

- [ ] **Step 2: Declare the exact Stage 5 source projection map**

Implement this canonical map in `projection-slice-authority.ts`; values are document/section selectors, not copied business facts:

```ts
export const GAME_IR_SLICE_SOURCE_SECTIONS = Object.freeze({
  'gameplay.slice.0': refs('docs/GDD.md', ['core_loop', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'challenge_recovery', 'material.game-state-flow']),
  'gameplay.slice.1': refs('docs/GDD.md', ['vision', 'experience_pillars', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'material.core-loop-diagram', 'material.game-state-flow']),
  'balance.slice.0': [...refs('docs/GDD.md', ['rules_systems', 'progression']), ...refs('docs/BALANCE_DESIGN.md', ['units_variables', 'entity_parameters', 'progression_curves', 'material.variable-parameter-table'])],
  'balance.slice.1': [...refs('docs/GDD.md', ['rules_systems']), ...refs('docs/BALANCE_DESIGN.md', ['units_variables', 'entity_parameters', 'formulas', 'material.variable-parameter-table'])],
  'balance.slice.2': [...refs('docs/GDD.md', ['rules_systems', 'progression']), ...refs('docs/BALANCE_DESIGN.md', ['formulas', 'economy', 'rewards_value'])],
  'balance.slice.3': [...refs('docs/GDD.md', ['player_actions', 'rules_systems']), ...refs('docs/BALANCE_DESIGN.md', ['economy', 'rewards_value'])],
  'world-scene.slice.0': refs('docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'camera_readability', 'scene_states', 'material.world-structure-diagram']),
  'world-scene.slice.1': [...refs('docs/GDD.md', ['states_flow', 'progression']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['level_sequence', 'objectives_routes', 'spawn_checkpoint', 'camera_readability', 'scene_states', 'content_matrix', 'material.route-choice-diagram'])],
  'world-scene.slice.2': [...refs('docs/GDD.md', ['rules_systems', 'challenge_recovery']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['level_sequence', 'pacing_beats', 'encounters', 'spawn_checkpoint', 'content_matrix', 'material.pacing-beat-table'])],
  'presentation.slice.0': [...refs('docs/GDD.md', ['rules_systems', 'states_flow']), ...refs('docs/ART_DIRECTION.md', ['visual_pillars', 'composition_readability', 'animation', 'vfx', 'camera_presentation', 'material.animation-vfx-state-table']), ...refs('docs/UI_UX_SPEC.md', ['experience_architecture', 'screen_inventory', 'hud', 'material.information-architecture-diagram', 'material.screen-state-table']), ...refs('docs/AUDIO_DESIGN.md', ['event_taxonomy', 'music', 'ambience', 'material.event-cue-matrix', 'material.music-state-diagram'])],
  'presentation.slice.1': [...refs('docs/GDD.md', ['player_actions', 'states_flow']), ...refs('docs/ART_DIRECTION.md', ['animation', 'vfx']), ...refs('docs/UI_UX_SPEC.md', ['player_journeys', 'input', 'feedback_errors', 'onboarding', 'accessibility', 'material.player-flow-diagram', 'material.screen-state-table']), ...refs('docs/AUDIO_DESIGN.md', ['event_taxonomy', 'sfx', 'ui_feedback'])],
  'resource-realization.slice.0': [...refs('docs/ASSET_PLAN.md', ['inventory', 'formats_budgets', 'material.asset-inventory-table']), ...refs('docs/TECHNICAL_DESIGN.md', ['architecture', 'data_content', 'build_release'])],
  'resource-realization.slice.1': refs('docs/ASSET_PLAN.md', ['ownership', 'dependencies', 'source_license', 'pipeline', 'material.responsibility-matrix', 'material.license-register']),
  'resource-realization.slice.2': [...refs('docs/ASSET_PLAN.md', ['formats_budgets', 'validation', 'placeholder_replacement']), ...refs('docs/TECHNICAL_DESIGN.md', ['performance', 'build_release']), ...refs('docs/ART_DIRECTION.md', ['asset_specifications']), ...refs('docs/UI_UX_SPEC.md', ['prototype_acceptance']), ...refs('docs/AUDIO_DESIGN.md', ['implementation', 'production', 'material.loudness-delivery-table']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['production_acceptance'])],
  'implementation-verification.slice.0': refs('docs/TECHNICAL_DESIGN.md', ['architecture', 'build_release']),
  'implementation-verification.slice.1': [...refs('docs/GDD.md', ['core_loop', 'rules_systems']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['world_structure', 'objectives_routes', 'production_acceptance']), ...refs('docs/TECHNICAL_DESIGN.md', ['architecture', 'runtime_state', 'data_content', 'input_interaction', 'build_release'])],
  'implementation-verification.slice.2': [...refs('docs/LEVEL_SCENE_DESIGN.md', ['production_acceptance']), ...refs('docs/TECHNICAL_DESIGN.md', ['diagnostics', 'testing', 'build_release'])],
  'implementation-verification.slice.3': [...refs('docs/GDD.md', ['rules_systems', 'states_flow', 'challenge_recovery', 'scope_risks']), ...refs('docs/BALANCE_DESIGN.md', ['bounds_exploits', 'tuning_validation', 'risks_dependencies']), ...refs('docs/LEVEL_SCENE_DESIGN.md', ['production_acceptance']), ...refs('docs/TECHNICAL_DESIGN.md', ['performance', 'testing', 'risks'])],
} as const)
```

`refs()` validates every selector against `getGameDocumentContract()` at module initialization and returns frozen, canonically sorted values.

- [ ] **Step 3: Write RED prompt-projection tests**

```ts
const rendered = renderGameIrProjectionSliceAuthority(authority)
expect(rendered).toContain('SELECTED_AUTHORITY')
expect(rendered).not.toContain('FORBIDDEN_FULL_PACKET_MARKER')
expect(rendered).not.toContain('authoritySectionIndex')
expect(rendered).not.toContain('sectionBytes')
expect(rendered).not.toContain('packetDigest')
expect(rendered).toContain('## Output contract')
```

Also assert byte-identical rendering for equivalent canonical input and rejection when selected section bytes or digests are stale.

- [ ] **Step 4: Implement the typed authority builder and Markdown renderer**

```ts
export type GameIrProjectionSliceAuthority = Readonly<{
  schemaVersion: 'game-ir-projection-slice-authority.v1'
  identity: Readonly<{
    taskId: string
    foundationRevision: string
    foundationReadyReceiptDigest: string
    compileRequestDigest: string
  }>
  moduleId: GameIrProjectionModuleId
  slice: GameIrProjectionSlice
  sourceFragments: readonly Readonly<{ fragmentId: string; documentPath: FoundationDocumentPath; sectionId: string; text: string }>[]
  availablePriorNodes: GameIrProjectionSliceContext['availablePriorNodes']
  requiredCurrentNodes: GameIrProjectionSliceContext['requiredCurrentNodes']
  admittedCurrentNodes: readonly Readonly<{ id: string; kind: string }>[]
  retryDiagnostic?: GameIrProjectionRetryDiagnostic
}>

export type GameIrProjectionRetryDiagnostic =
  | Readonly<{ scope: 'slice'; sliceId: string; reason: string }>
  | Readonly<{
      scope: 'record'
      sliceId: string
      recordId: string
      fragmentId: string
      reason: string
    }>
```

Render stable Markdown headings and compact tables. Serialize nested value schemas and node values with `canonicalGameIrJson()` only inside table cells; do not serialize the enclosing authority as JSON.

For a `scope: 'record'` retry, render only the rejected record's source
fragment, its direct dependencies and the admitted prefix. A `scope: 'slice'`
retry is used only when malformed transport prevents identification of a record.

- [ ] **Step 5: Cut projection prompts to the renderer**

In `formatPacketContract()`, route only Game IR projection requests through the new builder and renderer. Leave validation and Foundation packet workers unchanged. Delete `modelGameIrSource()` and the projection branch of `projectGameIrPacketForModel()` when no remaining caller needs them.

- [ ] **Step 6: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-authority.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-authority.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-authority.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
git commit -m "feat: project minimal authority for game ir slices"
```

### Task 3: Persist valid record prefixes in the single slice journal

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-record-stream.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-record-stream.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.test.ts`

**Interfaces:**
- Produces: `parseGameIrProjectionRecordStream()` returning a strict valid prefix plus either `done: true` or one exact diagnostic.
- Produces: `GameIrProjectionSliceJournal.appendRecords(records): Promise<{acceptedCount: number; diagnostic?: GameIrProjectionRetryDiagnostic}>`, `completeCurrentSlice()` and `currentSliceRecordPrefix`.
- Preserves: `entries` as completed slice entries so the existing full-domain assembler contract remains unchanged.

- [ ] **Step 1: Write RED parser-prefix tests**

```ts
expect(parse(`${node('formula.a', 'e0.0')}\n{"record":"bad"}`)).toEqual({
  records: [
    expect.objectContaining({
      fragmentId: 'e0.0',
      node: expect.objectContaining({ id: 'formula.a' }),
    }),
  ],
  done: false,
  diagnostic: expect.stringMatching(/unknown record type/),
})
```

Require parsing to stop at the first invalid physical line. Run the record-stream test and confirm RED.

- [ ] **Step 2: Replace aggregate parser output with exact records**

```ts
export type GameIrProjectionNodeRecord = Readonly<{
  fragmentId: string
  node: GameIrProjectionSliceNode
}>

export type GameIrProjectionRecordStreamResult = Readonly<{
  records: readonly GameIrProjectionNodeRecord[]
  done: boolean
  diagnostic?: string
}>
```

Define `GameIrProjectionRetryDiagnostic` in `projection-slices.ts` so the
journal, authority renderer, dispatch contract and controller share one type
without importing model-facing code into the journal.

Do not repair the invalid line, reorder records or infer `done`. Keep wrong-slice and duplicate/descending-ID checks strict.

- [ ] **Step 3: Write RED journal-prefix tests**

Require the journal to persist an admitted current-slice prefix, reload it, expose its IDs in `currentSliceRecordPrefix`, reject duplicate/descending/conflicting records, and promote it into one completed `entries` item only after `completeCurrentSlice()` passes full slice admission.

- [ ] **Step 4: Upgrade the journal without a compatibility reader**

Change `GAME_IR_PROJECTION_SLICE_JOURNAL_SCHEMA_VERSION` to `game-ir-projection-slice-journal.v2` and add:

```ts
type GameIrProjectionPendingSlice = Readonly<{
  sliceId: string
  predecessorDigest: string
  records: readonly Readonly<{
    fragmentId: string
    node: GameIrProjectionSliceNode
    recordDigest: string
  }>[]
  pendingDigest: string
}>
```

Persist `pendingSlice` in the same journal snapshot. `appendRecords()` validates
and durably writes each record before examining the next one. Candidate errors
return `{acceptedCount, diagnostic}` after preserving the valid prefix. A known
node and fragment produces a `scope: 'record'` diagnostic; malformed framing
produces `scope: 'slice'`. Journal,
identity or authority corruption still throws and fails closed. An exact replay
of an already persisted prefix is idempotent, while the same ID with different
bytes is a conflict. `completeCurrentSlice()` derives evidence groups, runs the
existing relationship/cardinality/current-target/local-closure checks, appends
one completed entry and clears `pendingSlice`. A v1 journal fails closed as
obsolete; do not migrate it.

- [ ] **Step 5: Include the prefix in the next request context**

Extend `GameIrProjectionSliceContext` with exact sorted `admittedCurrentNodes: readonly {id: string; kind: string}[]`. The next prompt instructs the model to emit only IDs strictly after the final admitted ID, or `done` when the slice is complete.

- [ ] **Step 6: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-record-stream.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/staged-compiler.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-record-stream.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-record-stream.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.test.ts
git commit -m "feat: persist admitted game ir record prefixes"
```

### Task 4: Admit record-prefix terminals through the durable controller

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts` only if the persisted schema fingerprint changes.
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts` only if its fingerprint fails.

**Interfaces:**
- Projection terminals always carry `records`, including an empty array on failure.
- The controller appends records first, completes the slice only when `done` is true, and persists an exact retry diagnostic otherwise.

- [ ] **Step 1: Write RED terminal-schema tests**

Replace projection `semantic` terminals with this unique contract:

```ts
{
  workerType: 'game-ir-compiler',
  operation: 'projection',
  status: 'completed' | 'failed',
  sliceId: string,
  records: GameIrProjectionNodeRecord[],
  done: boolean,
  ...(status === 'failed' ? { reason: string } : {}),
  ...gameIrServiceIdentityFields,
}
```

Assert `completed` requires `done: true`; `failed` requires `done: false`; every variant requires `records`; legacy `semantic` is rejected.

- [ ] **Step 2: Convert the session-port result deterministically**

`createDeterministicGameIrCompilerTerminal()` parses `record_stream` once and returns its `records`, `done` and diagnostic. `createGameIrCompilerFailureTerminal()` returns `records: []` and `done: false`. Do not put record bodies in Bee Game events, transcripts or runtime logs.

- [ ] **Step 3: Write RED controller tests**

Cover completed stream admission, a later invalid record preserving its valid prefix, idempotent terminal replay, owner-slice invalidation after full-module admission failure, and existing proven-no-progress behavior for identical prefix/diagnostic/authority.

- [ ] **Step 4: Implement controller admission in this order**

```ts
const admission = await projectionJournal.appendRecords(result.records)
if (admission.diagnostic || !result.done) {
  await persistCompilerDiagnostic(admission.diagnostic ?? {
    scope: 'slice',
    sliceId: result.sliceId,
    reason: result.reason,
  })
  return
}
await projectionJournal.completeCurrentSlice()
```

Use record digests for idempotent replay. Delete `matchesAdmittedTerminal()` after callers move to the prefix-aware journal API.

- [ ] **Step 5: Apply the strict persisted-schema change**

Run `schema-evolution.test.ts`. If the persisted `activeDispatch.terminalResult` fingerprint changes, increment `DELIVERY_RUN_SCHEMA_VERSION` from 49 to 50 and register only the new fingerprint. Do not add a v49 terminal compatibility parser.

- [ ] **Step 6: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/staged-compiler.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts
git commit -m "feat: admit incremental game ir projection records"
```

### Task 5: Delete packet-once and force fresh projection sessions

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts` only if Game IR is the last rebind caller.
- Modify: `packages/agent-workflow-server/src/beegame/session-manager-resilience.test.ts` only with the preceding deletion.

**Interfaces:**
- Every `game-ir-compiler` projection dispatch calls `sessions.start()` exactly once.
- Projection `close()` disposes that session after its terminal is durable.
- Parallel Foundation draft preservation remains unchanged.

- [ ] **Step 1: Replace the false packet-once test with RED stateless tests**

```ts
expect(startedSessionIds).toHaveLength(2)
expect(new Set(startedSessionIds).size).toBe(2)
expect(rebindCalls).toHaveLength(0)
expect(prompts.every(prompt => !prompt.includes('FORBIDDEN_FULL_PACKET_MARKER'))).toBe(true)
```

- [ ] **Step 2: Delete session-affinity production code**

Delete `LiveGameIrProjectionSession`, `liveGameIrProjectionSessions`, `gameIrProjectionPacketDigest()`, `gameIrProjectionSessionKey()`, projection rebind branches, `packetSent`, projection `eventOffsets` reuse and projection-specific cleanup loops.

- [ ] **Step 3: Delete dispatcher preservation for later Game IR slices**

Delete `projectionHasLaterSlice()` and both projection callers that pass `preserveSession: true`. Keep `preserveSession` only for the existing parallel Foundation author and independently proven non-Game-IR callers.

- [ ] **Step 4: Remove dead generic rebind support only when unreachable**

```bash
rg -n "rebindWorkflowWorker|WorkflowWorkerRebindError|native_resume_unavailable" packages/agent-workflow-server/src
```

If Game IR is the only production caller, remove the API, implementation and tests. If another stage calls it, leave the generic capability untouched and record that caller.

- [ ] **Step 5: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts packages/agent-workflow-server/src/beegame/session-manager-resilience.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts packages/agent-workflow-server/src/beegame/session-manager.ts packages/agent-workflow-server/src/beegame/session-manager-resilience.test.ts
git commit -m "refactor: remove game ir projection session reuse"
```

### Task 6: Keep transport generic and expose only safe progress metadata

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/runtime-observability.ts`
- Modify: `packages/agent-workflow-server/src/beegame/runtime-observability.test.ts`

**Interfaces:**
- Native record-stream transport enforces delta framing and the exact terminal line, but domain JSON admission remains in Stage 5.
- Observability exposes counts, timing and digests without record bodies.

- [ ] **Step 1: Write RED transport-boundary tests**

Assert that a completed stream containing one syntactically invalid non-terminal line reaches the service result unchanged for Stage 5 diagnosis. Cumulative frames, DSML/tool frames, blank physical lines and an incorrect terminal record still fail as `provider_stream_protocol_error`.

- [ ] **Step 2: Remove domain JSON parsing from the native runner**

Restrict `assertRecordStreamLines()` to transport framing. It must not validate node JSON or schema. Keep `recordStreamTerminal()` strict for the final `done` record so a provider response cannot complete without the expected slice identity.

- [ ] **Step 3: Add safe request-progress observations**

Record first-event/last-event timestamps, total stdout bytes, event count and terminal outcome in `native-runtime.jsonl`. Store only SHA-256 digests and byte counts for record-stream chunks; never store chunk text.

- [ ] **Step 4: Verify and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/runtime-observability.test.ts
git diff --check
git add packages/agent-workflow-server/src/beegame/native-cli-process-runner.ts packages/agent-workflow-server/src/beegame/native-cli-process-runner.test.ts packages/agent-workflow-server/src/beegame/runtime-observability.ts packages/agent-workflow-server/src/beegame/runtime-observability.test.ts
git commit -m "refactor: keep game ir admission out of native transport"
```

### Task 7: Recovery and single-track static closure

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts`

**Interfaces:**
- Recovery verifies the v2 journal and dispatches the exact unfinished current slice in a fresh session.
- Static closure proves the old provider-facing projection tracks are absent.

- [ ] **Step 1: Write RED crash-point tests**

Cover restart after a pending-record append, after `done` before completed-entry promotion, after entry promotion, and after canonical manifest commit before journal cleanup. Assert the fresh request contains the admitted prefix but not the full operation packet.

- [ ] **Step 2: Implement exact recovery**

Load the v2 journal, derive `nextSlice`, `nextSliceContext` and `currentSliceRecordPrefix`, and call the normal dispatcher. Do not store or recover a provider session ID. Reject v1, stale source, changed slice plan and digest mismatch.

- [ ] **Step 3: Add static single-track assertions**

The production-source scan must reject these symbols and strings outside negative test assertions:

```ts
[
  'liveGameIrProjectionSessions',
  'GameIrProjectionSessionKey',
  'packetSent',
  'sends one projection packet once',
]
```

Also assert projection prompts cannot contain `authoritySectionIndex`, raw `sectionBytes`, or a complete projection operation packet schema version.

- [ ] **Step 4: Re-run protected Reviewer/Revision parity**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: Stage 3/4 tasks, Issue Registry, patches and READY receipts remain identical with Game IR enabled or disabled.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts
git commit -m "test: enforce stateless game ir projection recovery"
```

### Task 8: Balance-first mock fault matrix

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stateless-projection.integration.test.ts`
- Modify only production files required by a reproduced shared-compiler defect.

**Interfaces:**
- Verifies the shared compiler under the highest-risk Balance formula/unit behavior before real-provider use.

- [ ] **Step 1: Add deterministic mock scenarios**

Implement these eight cases in the integration test:

1. unsorted unit dimensions followed by a corrected record;
2. formula AST/reference mismatch followed by a corrected formula only;
3. malformed record after two valid nodes;
4. provider process exit with no complete response;
5. replay of an already admitted record prefix;
6. crash and recovery with a pending formula record;
7. stale Foundation revision during retry;
8. successful four-slice Balance assembly.

Each case asserts distinct provider sessions, selected authority only, unchanged admitted record digests and one final Balance operation manifest.

- [ ] **Step 2: Run the fault matrix**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stateless-projection.integration.test.ts
```

Expected: PASS without changing Reviewer/Revision or adding case-specific prompt keywords.

- [ ] **Step 3: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stateless-projection.integration.test.ts
git commit -m "test: cover stateless balance projection faults"
```

If a shared production defect was reproduced, commit its implementation and
focused regression separately before this matrix-only commit.

### Task 9: All-module automated admission

**Files:**
- Modify only Game IR-owned production or test files for a concrete reproduced failure.

**Interfaces:**
- Verifies all six projections, four validations, publication, committed reader, recovery and protected boundaries.

- [ ] **Step 1: Run all Game IR tests**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
```

- [ ] **Step 2: Run shared dispatch/runtime regressions**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts packages/agent-workflow-server/src/beegame/session-manager-resilience.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

- [ ] **Step 3: Run static and type verification**

```bash
bun run typecheck
git diff --check
rg -n "liveGameIrProjectionSessions|packetSent|sends one projection packet once" packages/agent-workflow-server/src --glob '!*.test.ts'
```

Expected: typecheck and diff check pass; the final search finds no production path or positive packet-once test.

- [ ] **Step 4: Commit only concrete corrections**

Use one focused commit per reproduced shared defect. Do not change an accepted canonical schema merely to make one fixture pass.

### Task 10: Three-profile Chrome acceptance

**Files:**
- Create: `docs/superpowers/reviews/2026-09-02-game-ir-stateless-semantic-slices-chrome-acceptance.md`
- No production edits unless a Game IR-owned defect is first captured with UI, run-state, journal and native-runtime evidence.

**Interfaces:**
- Produces real-provider evidence for formula-heavy, scene/resource-heavy and interaction/state-heavy projects.

**Profiles:**
- Formula-heavy: `/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/polar-station-evacuation-window--c328627b9afb`.
- Interaction/state-heavy: `/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/moonlight-mushroom-defense--5462c252b870`.
- Scene/resource-heavy from zero: `/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/orbital-greenhouse-siege--47c60a185ef3`, using its existing confirmed brief beginning `制作一款可在浏览器游玩的轨道温室物流防守游戏`.

- [ ] **Step 1: Start the app from this worktree and open Chrome**

Use the repository's existing development command, verify the displayed build identifies this worktree, and open the Bee Game Studio workflow page in Chrome.

- [ ] **Step 2: Run the formula-heavy project from Foundation READY**

Complete all six Game IR projections and four validations. Pause before Checklist. Inspect prompt byte counts, provider session IDs, journal state, ten manifests, publication and committed reader.

- [ ] **Step 3: Repeat for scene/resource-heavy and interaction/state-heavy projects**

Use independent fresh workflows. Run the orbital greenhouse profile from its
confirmed brief through Foundation READY before Stage 5; do not change Stage
3/4 code if that upstream run fails. Do not reuse the first project's journals
or provider sessions.

- [ ] **Step 4: Record acceptance evidence**

For every provider request record module, slice, prompt bytes, output bytes, duration, retries and session ID. Record totals as observations, not limits. Confirm:

- no prompt carries the full operation/domain packet;
- every projection request has a fresh provider session;
- record failures preserve admitted prefixes;
- no old projection route is reachable;
- all six modules are semantically useful and source-bound;
- Reviewer/Revision behavior remains unchanged;
- Checklist has not started.

- [ ] **Step 5: Run final verification and commit the report**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch-recovery.test.ts
bun run typecheck
git diff --check
git add docs/superpowers/reviews/2026-09-02-game-ir-stateless-semantic-slices-chrome-acceptance.md
git commit -m "docs: record stateless game ir chrome acceptance"
```

Stop after the report is committed. Do not begin Checklist or Task 9–15 consumer migration in this plan.
