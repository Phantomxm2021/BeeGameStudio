# Game IR Phase 8 Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 经主代理审计修订，准入执行；每个任务仍须由主代理在提交前独立审计。

**Goal:** 将已验收的六域 Game IR publication 接入 Bee Game Studio 生产 workflow，建立 v46 单一 durable compilation/checkpoint/reader 链，并按顺序把七个 consumer 原子切换到 IR authority。

**Architecture:** `Foundation READY` 是唯一上游交接；同一 DeliveryRun 进入唯一 `GAME_IR_COMPILATION`，由一个 checkpoint writer/loader 负责 durable manifest chain 和 Phase 4→7 replay，再由 committed reader 从 run-state authority 重验六域 publication。Checklist 继续由 READY raw Markdown 负责内容，唯一 durable `ChecklistToScenarioBridge` 负责 typed traceability；资源以 `requirementId -> variantId -> artifactId -> resourceId/files` 精确 join，执行 consumer 只消费 reader、bridge 和 actual-file facts。

**Tech Stack:** TypeScript, Zod v4, Bun test, Node `fs/promises` atomic rename/fsync primitives, existing DeliveryRun run-store/controller/dispatcher/recovery, existing Game IR domain assemblers and publication validators.

**Spec:** `docs/superpowers/specs/2026-09-01-game-ir-production-cutover-design.md`; 上级边界：`docs/beegame-game-ir-stage-isolation-redesign.md`

## Global Constraints

- DeliveryRun schema 固定为 v46；旧版本、未知字段/枚举、旧 checkpoint 一律 fail closed 为 obsolete/attention，不实现 migration/compat reader。
- 只有一个 `GAME_IR_COMPILATION` durable phase；完成后只能回到现有 `DOCUMENT_REVIEW + CHECKLIST_DRAFTING`，再经过 `DOCUMENT_REVIEW + CHECKLIST_BRIDGE` 才能进入 `RESOURCE_PREPARATION`；不得创建顶层 `CHECKLIST` phase。
- `gameIrState` 只保存 compilation identity、checkpoint/publication receipt refs 和 digest，不复制 candidate、module、graph、Checklist、resource 或 document body。
- 只允许一个 `GameIrStageCheckpointWriter`、一个 `GameIrStageCheckpointLoader`、一个 committed reader；复用既有 run-store/controller/dispatcher/recovery，不创建第二 store/controller/journal/publication authority。
- `Foundation Reviewer`、`Foundation Revision`、Issue Registry、foundation audit state、READY/parity contract 是 protected surface；本计划不得修改其生产实现或引入 Game IR import。
- 不创建、恢复、重命名或伪装 `Comprehensive Reviewer`/`Comprehensive Revision`；现有 `implementation-auditor` 仍是 Implementation/Verification consumer。
- 不保留 raw-doc reader、`authorityPaths`、caller-built projection、旧 reader、fallback、migration、compatibility facade、dual-write、旧 generic admission 或旧 checklist crosswalk。
- Checklist raw Markdown 是内容 authority；Game IR 不生成、修改或反投影 Checklist。bridge 只产 traceability/coverage evidence。
- 一个 logical resource 可有多个 realization variant；一个 variant 可有多个 delivery artifact；任何 resource join 必须以 `requirementId` 为根并逐 artifact 验证。
- Phase 8 新增 route 和七个迁移 consumer 不设置 token、时间、attempt、task、node、edge、scenario、invariant、evidence、artifact 或文件数量的任意业务上限；schema 固有 cardinality 仍由 strict parser 强制。protected Foundation surface 的既存策略只记录为独立审计发现，不在本计划修改。
- consumer 切换必须与旧 reader/prompts/authorityPaths 的删除处于同一提交；每个 consumer 先写 RED test，再实现 GREEN、static boundary 和 recovery test。
- Foundation parity test 可以在测试 harness 内使用 enabled/disabled switch，但该 switch 不得进入生产 DeliveryRun、controller、prompt 或 fallback path。
- 本 Phase 不跑 Chrome；只有全矩阵、静态门禁、自动化回归和至少两个新 READY 项目通过后，才允许后续 Phase 9 fresh Chrome。

## 文件地图与职责

已有 Phase 7 authority 直接复用，不重写其 domain schema/assembler/publication：

- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts`, `phase5-admission.ts`, `phase6-admission.ts`, `phase7-admission.ts`, `publication.ts`：strict six-domain model、closure、publication/recovery 的既有 authority。
- `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.ts`：唯一 Foundation READY adapter；consumer 不直接导入 Foundation Reviewer/Revision。
- `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`, `recovery.ts`, `recovery-projector.ts`, `dispatch.ts`, `controller.ts`：唯一 durable snapshot/journal、dispatcher、controller、recovery，按本计划扩展而不复制。
- `packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-authority-projection.ts`、`packages/agent-workflow-server/src/beegame/checklist-authority-projection.ts`、`checklist-candidate.ts`：Checklist raw Markdown projection/candidate/publish authority，保持其内容边界。

本计划新增/适配的职责边界：

- 新增 `game-ir/stage-checkpoint.ts`：v46 checkpoint envelope、唯一 writer/loader、immutable manifest chain、Phase 4→7 replay。
- 新增 `game-ir/committed-reader.ts`：唯一 `readCommittedGameIr({ workspacePath, deliveryRun })`，只读取 run-state 指向的 committed root 并重验。
- 新增 `checklist-bridge.ts`：`ChecklistToScenarioBridge` packet、typed claims、validator、durable receipt。
- 新增 `execution-read-scope.ts`：统一 execution read scope/deny contract，供 session/native/batch read 入口使用。
- 适配 `types.ts`、`schema.ts`、`transition.ts`、`controller.ts`、`resource-stage.ts`、`atomic-task-planner.ts`、`implementation-stage.ts`、`validation-stage.ts`、`worker-contracts.ts`、`worker-prompts.ts`、`delivery-worker-session-port.ts` 及其对应测试。

每个任务下的 `Modify` 是实现者可触碰的最小范围；Foundation 相关路径仅用于 import-boundary/parity 读取检查，不得写入。

---

### Task 1: v46 DeliveryRun 与唯一阶段路由

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`（`DeliveryPhase`, `DocumentWorkflowStep`, `DELIVERY_RUN_SCHEMA_VERSION`, `DeliveryRun`）
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`（strict v46 parser and refinements）
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`（legal phase transitions/invariants）
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`、`recovery.ts`（obsolete v45 handling only）
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`, `transition.test.ts`, `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

**Interfaces:**
- Produces `GameIrCompilationIdentity`, `GameIrCheckpointRef`, `GameIrState` (`compiling | ready`), `ChecklistBridgeIdentity`, `ChecklistBridgeState` (`bridging | ready`) and `DeliveryRun` v46 fields.
- `parseDeliveryRun(value: unknown): DeliveryRun` rejects non-v46, unknown top-level/nested fields, invalid phase/step combinations, missing READY identity, missing checkpoint/publication, bypassed bridge, duplicate state/pointer/authority.
- `transitionDeliveryRun` accepts explicit events such as `{ type: 'game_ir_compilation_started' }`, `{ type: 'game_ir_checkpoint_committed', checkpoint }`, `{ type: 'game_ir_ready', state }`, `{ type: 'checklist_bridge_started', identity }`, `{ type: 'checklist_bridge_ready', receiptPath, receiptDigest }`; it never infers a phase from file existence.

- [ ] **Step 1: Write RED parser/transition tests.** Add fixtures for a valid v46 compiling/ready run and assert failures for v45, unknown `gameIrState` field/status, direct `RESOURCE_PREPARATION`, missing Foundation READY identity, missing checkpoint/publication, bridge bypass, duplicate pointers and nullable legacy union.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

Expected: FAIL because the current code reports schema v45, has no Game IR/bridge state, and permits direct resource entry.

- [ ] **Step 3: Implement the smallest strict v46 contract.** Add exact Zod discriminated unions and transition guards; keep authority payloads out of snapshots. Update run-store inspection so v45 is obsolete/attention and never passed to a compatibility parser. Resource inventory shape remains untouched until Task 6.

- [ ] **Step 4: Run GREEN tests and typecheck.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts && bun --cwd packages/agent-workflow-server run typecheck`

Expected: PASS; v45 remains historical evidence and no old run is resumed.

- [ ] **Step 5: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts && git commit -m "feat: add strict v46 Game IR run state"`

Commit must contain only v46 schema/state/transition/recovery work.

### Task 2: v46 checkpoint writer/loader and Phase 4→7 replay

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`, `recovery.ts`, `recovery-projector.ts`, `run-store.ts`

**Interfaces:**
- `GameIrStageCheckpointWriter.write(input: { workspacePath: string; deliveryRun: DeliveryRun; step: GameIrCheckpointStep; authority: GameIrAdmittedAuthority }): Promise<GameIrCheckpointRef>`.
- `GameIrStageCheckpointLoader.load(input: { workspacePath: string; deliveryRun: DeliveryRun }): Promise<GameIrReplayAuthority>`.
- `GameIrCheckpointStep` is the closed set of phase4 gameplay/balance, phase5 world-scene/presentation, phase6 resource-realization, and phase7 implementation-verification source/mechanical/semantic/validation records listed in the spec; no generic catch-all kind.
- Writer verifies service-admitted identity, writes run-scoped temp records, canonical digests and manifest, atomically renames to deterministic final step path, then allows snapshot `latestCheckpoint` update. Loader accepts only the run-state pointer and replays phase order through existing domain assemblers/validators.

- [ ] **Step 1: Write RED durability tests.** Cover exact v46 envelope, missing/duplicate/out-of-scope records, mismatched run/task/revision/READY digest, previous-manifest mismatch, temp/orphan invisibility, final-path conflicting bytes, filesystem-commit-before-snapshot recovery, deterministic repeat write, and replay order 4→5→6→7.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts`

Expected: FAIL because the writer/loader and v46 checkpoint envelope do not exist.

- [ ] **Step 3: Implement one writer and one loader.** Reuse existing run-store atomic write and recovery lock; persist immutable record files once and link prior manifests by path/digest. Reject canonical-doc/journal/previous-publication supplementation. Expose only the typed replay authority needed by publication reader; do not expose snapshot payload copies.

- [ ] **Step 4: Integrate recovery before snapshot advancement.** In controller/recovery, recover an already committed deterministic step under the same compilation identity, then advance `latestCheckpoint`; leave temporary/orphan files invisible. Do not add another journal or recovery projector.

- [ ] **Step 5: Run GREEN tests plus package typecheck.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts && bun --cwd packages/agent-workflow-server run typecheck`

Expected: PASS with identical root checkpoint digest on repeated resume and no second authority.

- [ ] **Step 6: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts && git commit -m "feat: persist Game IR stage checkpoints"`

### Task 3: committed Game IR reader and compilation route

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/committed-reader.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/committed-reader.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`, `dispatch.ts`, `transition.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `workflow-display-message.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-display-message.test.ts`, `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

**Interfaces:**
- `readCommittedGameIr({ workspacePath, deliveryRun }): Promise<Readonly<GameIrPublishedReader>>` is the sole external Game IR authority.
- Reader internally obtains the Foundation READY receipt from the existing `foundation-ready-adapter`, loads the run-state checkpoint/publication, validates COMMITTED marker, six-and-only-six modules, complete candidate parser, source-map, graph, evidence, checkpoint/revision/READY digests, and returns typed execution/resource/acceptance projections.
- The compilation dispatcher accepts only a service-bound `FoundationReadyReceipt` and `GameIrCompileRequest`; worker output is admitted by existing domain-specific contracts before Task 2 writer.
- Retry uses a canonical progress identity over input/diagnostic/candidate/checkpoint-journal/terminal digests. A changed identity continues the same legal loop; `needs_action` is allowed only for a real external prerequisite or proven unchanged state with no legal transition, never because a fixed attempt/time/token threshold was reached.
- Every Game IR/bridge `needs_action` persists phase/step, task/worker, reason code, expected/actual, diagnostic ref and recovery action. API/UI projection displays the safe structured reason and diagnostic ID rather than the generic blocked sentence.

- [ ] **Step 1: Write RED reader/route tests.** Assert caller cannot pass alternate state/receipt/candidate; six modules are complete and canonical; core placeholder, duplicate/remapped module, detached evidence, graph/source-map mismatch, journal/temp/old-doc/previous-publication fallback and every digest mismatch fail closed. Assert READY→`GAME_IR_COMPILATION`→`DOCUMENT_REVIEW/CHECKLIST_DRAFTING` only after reader revalidation. Add progress-identity cases proving changed evidence continues without a cap, unchanged/no-transition state reports attention, and display/API expose its structured reason/diagnostic ID.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/committed-reader.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-display-message.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

Expected: FAIL because no committed reader or production compilation route exists.

- [ ] **Step 3: Implement the reader and stage entry.** Use only `deliveryRun.gameIrState`, Task 2 loader, existing publication committed-root validator and Foundation READY adapter. Add controller/dispatcher handoff that creates one compilation identity and routes successful completion back to existing Checklist drafting step; failure stays in the same identity. Persist progress identity and a structured diagnostic, and project the safe concrete reason through existing workflow display/API fields without exposing raw provider prose.

- [ ] **Step 4: Add boundary assertions.** Ensure Game IR code has no imports from Foundation Reviewer/Revision internals, does not write canonical docs/Issue Registry/foundationAuditState, and does not introduce a generic admission or second reader.

- [ ] **Step 5: Run GREEN tests and typecheck.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/committed-reader.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-display-message.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts && bun --cwd packages/agent-workflow-server run typecheck`

Expected: PASS; invalid publication is diagnostic-only and never reaches a consumer.

- [ ] **Step 6: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/committed-reader.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/committed-reader.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-display-message.ts packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-display-message.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts && git commit -m "feat: route production through committed Game IR"`

### Task 4: Checklist semantic bridge and durable admission

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-bridge.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-bridge.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`, `schema.ts`, `controller.ts`, `transition.ts`, `document-stage.ts`, `recovery.ts`

**Interfaces:**
- `ChecklistBridgeSemanticClaim` is exactly `{ checklistId, sourcePointer, sourceDigest, target: { kind: 'scenario', scenarioId } | { kind: 'gate', invariantId, evidenceOwnerUnitId, evidenceRequirementId } }`.
- `prepareChecklistBridgePacket({ checklistProjection, committedGameIr }): ChecklistBridgePacket` and `admitChecklistBridge({ packet, claims }): ChecklistBridgeReceipt` require exact canonical item set, source bindings, target existence/kind and evidence-owner closure.
- `ChecklistToScenarioBridge.commit({ workspacePath, deliveryRun, receipt }): Promise<{ receiptPath: string; receiptDigest: string }>` writes immutable packet/claims/validator receipt before snapshot `checklistBridgeState=ready`.

- [ ] **Step 1: Write RED bridge tests.** Cover every item exactly once, gate versus scenario discrimination, source digest mismatch, missing/ambiguous/duplicate mapping, unknown item, duplicate canonical item, wrong scenario kind, gate owner/evidence outside closure, filesystem-before-snapshot recovery, and bridge identity invalidation.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-bridge.test.ts`

Expected: FAIL because no typed bridge/durable state exists.

- [ ] **Step 3: Implement service-owned preparation and validator.** Feed it only canonical Checklist raw Markdown projection plus committed reader scenarios/invariants/evidence; never infer by keyword, similarity, array order, first match or broadcast tag. Keep Checklist content writer/projection untouched.

- [ ] **Step 4: Wire controller transition.** After checklist publication enter `DOCUMENT_REVIEW + CHECKLIST_BRIDGE`; only admitted bridge receipt permits `RESOURCE_PREPARATION`. Persist bridge identity/ref/digest only; obsolete bridge on Checklist publication or Game IR ready digest change.

- [ ] **Step 5: Run GREEN tests and protected Foundation checks.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-bridge.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-author-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-integration.test.ts && bun --cwd packages/agent-workflow-server run typecheck`

Expected: PASS; Foundation tests remain unchanged and Checklist remains raw Markdown authority.

- [ ] **Step 6: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-bridge.ts packages/agent-workflow-server/src/beegame/delivery-workflow/checklist-bridge.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts && git commit -m "feat: durably bridge Checklist to Game IR"`

### Task 5: Digest closure and mechanical invalidation

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/digest-invalidation.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/digest-invalidation.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`, `transition.ts`, `recovery.ts`, `types.ts`, `schema.ts`, `resource-stage.ts`, `validation-stage.ts`

**Interfaces:**
- `DeliveryAuthorityClosure` records direct upstream digests: Game IR ready, Checklist publication/bridge, resource projection/inventory/binding, content, atomic plan, unit, and implementation revision.
- `invalidateFromChangedDigest(run, changed: AuthorityChange): DeliveryRun` is a pure transition helper used by the existing controller/recovery lane; it clears only the first affected downstream state and all dependent receipts, preserving unaffected committed IR/actual evidence.
- Every downstream receipt/contract parser verifies its direct upstream closure; file existence, run status and journal prose are insufficient.

- [ ] **Step 1: Write RED mutation matrix.** Mutate Foundation READY, IR publication, Checklist publication/bridge, inventory, content, atomic plan and implementation revision independently; assert the first affected consumer and all later consumers reset, while earlier authority remains committed. Include stale worker/old compile request/old section index and concurrent resume cases.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/digest-invalidation.test.ts`

Expected: FAIL because current restart helpers only compare document/resource revisions and do not verify IR/bridge closure.

- [ ] **Step 3: Implement closure fields and invalidation.** Extend only the existing receipt/state contracts; call the existing `restartDocumentStage`, `restartResourcePreparation`, `restartAtomicTaskPlanning`/transition paths from one controller. Do not add an invalidation controller or journal.

- [ ] **Step 4: Run GREEN recovery/integration tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/digest-invalidation.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && bun --cwd packages/agent-workflow-server run typecheck`

Expected: PASS; same compilation identity retries safely, changed authority creates a new downstream epoch, and no old receipt remains ready.

- [ ] **Step 5: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/digest-invalidation.ts packages/agent-workflow-server/src/beegame/delivery-workflow/digest-invalidation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.ts && git commit -m "feat: enforce downstream Game IR digest closure"`

### Task 6: Resource projection and requirement-rooted multi-artifact joins

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-projection.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts`, `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`, `schema.ts`, `worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts`, `native-resource-inventory-commit-tool.ts`, `resource-delivery-readiness.ts`, `asset-contracts.ts`

**Interfaces:**
- `ResourceDeliveryBinding = { requirementId, variantId, artifactBindings: readonly { artifactId, resourceId, filePaths }[] }`.
- `joinResourceProjectionToManifest({ projection, inventoryReceipt, manifest }): ResourceArtifactJoin` requires every IR artifact exactly once, exact variant/artifact/resource/file paths and declared digest/format checks.
- Inventory/curator terminal schema rejects the old `requirementId -> resourceIds` shape; no adapter or flattening is allowed.

- [ ] **Step 1: Write RED projection/join tests.** Cover multiple variants, multiple artifacts per variant, one resource with multiple files, missing/extra/duplicate artifact binding, wrong variant/artifact/resource, path/format/digest mismatch, requirement-root mismatch and old receipt shape rejection.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-projection.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/beegame/resource-delivery-readiness.test.ts`

Expected: FAIL because inventory receipts currently contain only `resourceIds` and resource stage derives authority from raw docs.

- [ ] **Step 3: Implement projection adapter and strict receipt.** Consume only Game IR resource projection for logical requirements and Manifest/inventory for actual facts. Preserve one-to-many cardinality and bind every artifact; keep actual files outside IR.

- [ ] **Step 4: Run GREEN resource tests and typecheck.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-projection.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts packages/agent-workflow-server/src/beegame/resource-delivery-readiness.test.ts && bun --cwd packages/agent-workflow-server run typecheck`

Expected: PASS with deterministic binding digest and no requirement flattening.

- [ ] **Step 5: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-projection.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/resource-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.ts packages/agent-workflow-server/src/beegame/resource-delivery-readiness.ts packages/agent-workflow-server/src/beegame/asset-contracts.ts && git commit -m "feat: preserve resource multi-artifact joins"`

### Task 7: Remove Atomic Task Planner fixed business caps

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts`, `atomic-task-planner.test.ts`

**Interfaces:**
- Remove only the hard-coded 8-artifact and 9-verification business caps; retain nonempty/schema/path/ownership and strict element validation. The production reader remains unchanged until the single atomic cutover in Task 12.

- [ ] **Step 1: Write RED tests.** Assert valid plans with more than 8 artifacts and more than 9 verification entries pass, while empty arrays, duplicate artifacts, invalid paths and malformed verification still fail.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.test.ts`

Expected: FAIL only because current planner rejects 9+ artifacts or 10+ verification entries.

- [ ] **Step 3: Delete only the two cap branches.** Do not add a configurable replacement, touch reader routing, or introduce the future IR planner path early.

- [ ] **Step 4: Run GREEN tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.test.ts`

Expected: planner tests PASS; structural validation remains active without an arbitrary count threshold.

- [ ] **Step 5: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.test.ts && git commit -m "refactor: remove atomic plan count caps"`

### Task 8: Mechanical execution project read isolation

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`, `schema.ts`, `dispatch.ts`, `worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts` and its complete-documents test

**Interfaces:**
- `ExecutionProjectReadScope = { mode: 'execution'; allowedRoots: readonly string[]; deniedRoots: readonly string[]; contractPacketRefs: readonly string[] }`.
- `assertExecutionReadAllowed(scope, path): void` is called before file open, directory enumeration, native tool access and batch-read helpers; canonical Foundation docs and aliases are mechanically denied for implementation worker/auditor/acceptance.
- Resource Planner/Curator/Game IR packet worker receive empty project scope; Content receives only explicit `repairPaths`/`readPaths` and actual Manifest files; Atomic Planner receives IR/bridge/actual joins, not docs; Acceptance reads Checklist only through its authority projection.

- [ ] **Step 1: Write RED scope tests.** Try direct read, directory listing, native tool and batch read of each canonical document/alias for each worker; assert deny diagnostic. Assert allowed code/resource/evidence and contract packet references pass, path traversal/symlink escape fails, and prompt-only “do not read” is not considered enforcement.

- [ ] **Step 2: Run RED tests.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

Expected: FAIL because existing session wiring permits `authorityPaths` and implementation prompt says design documents are available.

- [ ] **Step 3: Implement one scope gate at all read fronts.** Thread the scope through `WorkerDispatchRequest` and session startup/native/batch reads; reject denied roots before I/O and log structured diagnostics. Keep worker transport generic; it must not select domains by worker type/keyword.

- [ ] **Step 4: Update prompt contract only as guidance.** Remove canonical-doc availability from execution prompts and inject only service-validated packet refs; prompts must not be the security boundary.

- [ ] **Step 5: Run GREEN/static checks.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts && bun --cwd packages/agent-workflow-server run typecheck && rg -n "canonical design documents as available context|authorityPaths" packages/agent-workflow-server/src/beegame/delivery-workflow/{worker-prompts.ts,resource-stage.ts,atomic-task-planner.ts,implementation-stage.ts,validation-stage.ts}`

Expected: scope tests PASS; `authorityPaths` has no execution consumer use (remaining Foundation authoring uses must be proven outside this task's protected surface).

- [ ] **Step 6: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.ts packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts && git commit -m "feat: enforce execution project read isolation"`

## Consumer atomic cutovers

Each task below has one commit boundary containing: the consumer's RED single-reader test, the reader switch, deletion of its old document reader/prompt/scope, GREEN test, and a recovery/tamper assertion. No task may leave both routes callable.

### Task 9: Resource Planner single-reader cutover

**Files:** `resource-stage.ts`, `resource-stage.test.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `controller.ts`.

**Interface:** `startResourcePreparation({ run, workspacePath, dispatcher })` calls `readCommittedGameIr` and dispatches a service-owned resource projection packet with the existing empty project scope and `gameIrReadyReceiptDigest`; it has no `authorityPaths` and Manifest actual facts are not requirement authority.

- [ ] **Step 1: RED.** Assert planner dispatch contains the exact IR resource projection/bridge digest and no ASSET_PLAN/ART_DIRECTION/TECHNICAL_DESIGN paths; tampered publication or stale digest blocks dispatch.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts` (expected FAIL on old authority paths).
- [ ] **Step 3: GREEN.** Replace raw-doc contract with committed reader packet, retain Manifest only for actual-file facts, and keep resource gate transitions unchanged except for closure fields.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts && git commit -m "feat: cut Resource Planner over to Game IR"`.

### Task 10: Resource Curator single-reader cutover

**Files:** `resource-stage.ts`, `resource-stage.test.ts`, `native-resource-inventory-commit-tool.ts`, `resource-inventory-commit.ts`, `resource-delivery-readiness.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `controller.ts`.

**Interface:** Curator consumes the same committed resource projection plus service-supplied current Manifest/Inventory actual facts under an empty project scope, emits `ResourceDeliveryBinding[]` rooted by `requirementId`, and carries `gameIrReadyReceiptDigest`, projection digest and bridge digest.

- [ ] **Step 1: RED.** Assert curator cannot read raw docs, cannot rewrite requirement/variant/artifact constraints, preserves multiple artifact bindings, and rejects stale reader/Manifest joins.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.test.ts` (expected FAIL on old receipt shape).
- [ ] **Step 3: GREEN.** Remove old curator `authorityPaths`/fallback projection, validate exact multi-artifact join via Task 6, and persist inventory closure before transition.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/native-resource-inventory-commit-tool.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts packages/agent-workflow-server/src/beegame/resource-delivery-readiness.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts && git commit -m "feat: cut Resource Curator over to Game IR"`.

### Task 11: Content single-reader cutover

**Files:** `resource-stage.ts`, `resource-stage.test.ts`, `delivery-worker-session-port.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `content-contracts.ts`, `controller.ts`.

**Interface:** Content receives IR content/resource artifact specifications, current Manifest actual files, exact `repairPaths` and an inventory/delivery-binding closure; it may mutate only admitted repair paths and never receives canonical design-doc scope or Checklist bridge as content authority.

- [ ] **Step 1: RED.** Assert content dispatch has no canonical doc `authorityPaths`, only explicit read/repair paths and actual Manifest files; missing inventory/IR artifact or repair-path escape fails closed.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts` (expected FAIL on current `resourceContentAuthorityPaths`).
- [ ] **Step 3: GREEN.** Delete `resourceContentAuthorityPaths` use, bind receipt to inventory epoch/delivery-binding/IR projection digests, and keep atomic content commit preserving all non-repair paths.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/content-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts && git commit -m "feat: cut resource Content over to Game IR"`.

### Task 12: Atomic Task Planner single-reader cutover

**Files:** `atomic-task-planner.ts`, `atomic-task-planner.test.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `controller.ts`.

**Interface:** `applyAtomicTaskPlan` consumes `{ executionProjection, bridgeReceipt, resourceContentJoin, terminal }`; it does not accept `planningDocuments`, `authorityPaths`, raw docs or caller-built units. Every task carries IR `unitId`; `allowedPaths` equals or narrows `ownedPaths`; dependency edges cannot be deleted/reversed.

- [ ] **Step 1: RED.** Assert controller sends no document packet, task planning fails on missing bridge/reader closure, and an expanded artifact/verification set remains valid without caps.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.test.ts` (expected FAIL on old `facts`/document path).
- [ ] **Step 3: GREEN.** Use Task 7 projection API and delete all remaining old call sites/fixtures/prompt text in the same commit.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.ts packages/agent-workflow-server/src/beegame/delivery-workflow/atomic-task-planner.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts && git commit -m "feat: route Atomic Task Planner through Game IR"`.

### Task 13: Implementation Worker single-reader cutover

**Files:** `implementation-stage.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `controller.ts`, `delivery-worker-session-port.ts`.

- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/implementation-stage.test.ts`

**Interface:** `startNextImplementationTask` consumes the committed Atomic Task Plan plus IR unit/evidence contract and actual resource/content joins; the worker receives execution scope and may write only task-owned paths. It cannot reread canonical docs, choose a new owner, widen scope or treat evidence requirement as passed fact.

- [ ] **Step 1: RED.** Assert dispatch contract contains task `unitId`, plan/IR/resource/content digests and denied canonical docs; tampering with `allowedPaths`, unit ownership or actual join blocks dispatch.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/implementation-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts` (expected FAIL on raw manifest/content authority behavior).
- [ ] **Step 3: GREEN.** Replace caller-derived resource/content authority with validated joins, preserve task lifecycle/attempt semantics, and invoke Task 8 read scope for all session reads.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/implementation-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts packages/agent-workflow-server/src/__tests__/implementation-completion.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/implementation-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/implementation-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts && git commit -m "feat: isolate Implementation Worker on Game IR contracts"`.

### Task 14: Implementation Auditor single-reader cutover

**Files:** `validation-stage.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `controller.ts`, `delivery-worker-session-port.ts`.

- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts`

**Interface:** `startImplementationAudit`/`reconcileImplementationAudit` consume IR acceptance/invariant/evidence requirements, actual implementation outputs, durable task evidence, current resource/content joins and full digest closure. They do not read raw docs, issue Foundation defects or mutate Foundation state.

- [ ] **Step 1: RED.** Assert auditor dispatch/terminal coverage is derived from the committed reader and task plan, canonical doc reads are denied, stale IR/bridge/plan/implementation revision fails closed, and `implementation-auditor` is not named or routed as Comprehensive Reviewer.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts` (expected FAIL on current checklist/resource ID-only contract).
- [ ] **Step 3: GREEN.** Replace ID-only expected arrays with service-owned IR evidence contract and digest closure; preserve existing remediation/task replan semantics through the same controller.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts packages/agent-workflow-server/src/__tests__/implementation-completion.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/execution-read-scope.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts && git commit -m "feat: cut Implementation Auditor over to Game IR"`.

### Task 15: Acceptance single-reader cutover

**Files:** `validation-stage.ts`, `validation-stage.test.ts`, `acceptance-checklist.ts`, `checklist-authority-projection.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `controller.ts`, `delivery-worker-session-port.ts`.

**Interface:** `startAcceptance`/`reconcileAcceptance` consume Checklist raw Markdown only through its authority projection, the single bridge receipt, committed IR traceability, actual resource/content/implementation evidence and digest closure. Acceptance may not rewrite Checklist or use old parser/document projection/journal self-attestation to fill facts.

- [ ] **Step 1: RED.** Assert acceptance cannot start without current IR/bridge/task/resource/content/auditor closure; gate claims stay gates; canonical design docs are denied while Checklist projection is allowed; stale/tampered publication blocks.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/acceptance-checklist.test.ts packages/agent-workflow-server/src/beegame/checklist-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts` (expected FAIL on ID-only acceptance contract).
- [ ] **Step 3: GREEN.** Wire acceptance to reader/bridge/evidence contract and retain existing terminal/remediation transition behavior; leave Checklist content authority and parser protected.
- [ ] **Step 4: Verify:** `bun test packages/agent-workflow-server/src/beegame/acceptance-checklist.test.ts packages/agent-workflow-server/src/beegame/checklist-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts && bun --cwd packages/agent-workflow-server run typecheck` (PASS).
- [ ] **Step 5: Commit:** `git add packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/validation-stage.test.ts packages/agent-workflow-server/src/beegame/acceptance-checklist.ts packages/agent-workflow-server/src/beegame/checklist-authority-projection.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts && git commit -m "feat: cut Acceptance over to Game IR traceability"`.

## Global acceptance and handoff

### Task 16: Static no-dual-track gates and full matrix

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-static-boundary.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-acceptance-matrix.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`, `delivery-workflow-resource-integration.test.ts`, `idea-to-complete-documents.test.ts`, `workflow-stage-snapshot-projection.test.ts` only to add Phase 8 fixtures/assertions; do not modify Foundation production files or unrelated docs.

**Interfaces:**
- Static gate proves one controller/dispatcher→checkpoint writer/loader→committed reader path, seven consumers call only committed reader, no `readAtomicTaskPlanningDocuments`, no generic business admission/old publication candidate/fallback/compat/migration/dualWrite, no raw-doc execution `authorityPaths`, no `Comprehensive Reviewer/Revision`, and no Foundation Reviewer/Revision→Game IR import.
- Matrix fixture factory produces fresh v46 runs for: small rules, scene/resource-heavy, numerical/formula-heavy, zero/few external resources, and one requirement with multiple variants/artifacts. Each fixture starts at new Foundation READY and validates checkpoint/restart/concurrency/digest, bridge exact/missing/ambiguous/duplicate failures, resource joins, planner ownership/dependency, execution isolation and no second publication.
- Foundation enabled/disabled parity remains test-harness-only and compares Stage 3 tasks, Issue Registry, Stage 4 patch packets, targeted recheck and READY receipt bytes exactly.

- [ ] **Step 1: Write RED static/matrix tests.** Use AST/import inspection plus runtime reader identity/tamper/restart/concurrent-resume tests; reject string-only proof. Do not launch Chrome.
- [ ] **Step 2: Run RED:** `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-static-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-acceptance-matrix.test.ts` (expected FAIL until all consumers/routing are cut over).
- [ ] **Step 3: Implement only test harness and missing gates.** Keep arbitrary execution counts unbounded; record token/duration/task/retry/artifact/recovery values only as diagnostics, never threshold them. Ensure v45/old checkpoints remain obsolete and no temporary publication remains visible.
- [ ] **Step 4: Run the complete automatic gate.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-static-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-acceptance-matrix.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir packages/agent-workflow-server/src/beegame/delivery-workflow/{schema-evolution,transition,resource-stage,atomic-task-planner,validation-stage,execution-read-scope,checklist-bridge,digest-invalidation}.test.ts packages/agent-workflow-server/src/__tests__/{delivery-workflow-recovery,delivery-workflow-resource-integration,idea-to-complete-documents,workflow-stage-snapshot-projection}.test.ts && bun --cwd packages/agent-workflow-server run typecheck && bun run check && git diff --check`

Expected: all automatic tests pass; no Chrome process is started; no unexplained needs-action/stale worker/obsolete checkpoint/temp publication remains in fixtures.

- [ ] **Step 5: Review protected boundaries.** Run `rg -n "game-ir|GameIr" packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-*.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-*/*.ts 2>/dev/null` and inspect imports manually; run `rg -n "Comprehensive Reviewer|Comprehensive Revision|ComprehensiveReviewer|ComprehensiveRevision|dualWrite|legacy reader|migration reader|compatibility facade|fallback" packages/agent-workflow-server/src packages/agent-workflow-server/src/beegame/delivery-workflow`.

Expected: no Foundation production import of Game IR and no Comprehensive/fallback/legacy/dual-track implementation; unrelated generic app fallbacks outside this Phase 8 surface are not silently changed.

- [ ] **Step 6: Commit boundary.**

Run: `git add packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-static-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/phase8-acceptance-matrix.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-resource-integration.test.ts packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts packages/agent-workflow-server/src/__tests__/workflow-stage-snapshot-projection.test.ts && git commit -m "test: close Phase 8 production cutover matrix"`

## Self-review checklist before declaring Phase 8 ready for Phase 9

- [ ] Re-read both cited specs and map every requirement to Tasks 1–16: v46 state/checkpoint/reader; exact stage route; durable Checklist bridge; digest invalidation; resource multi-artifact join; planner cap removal; execution read isolation; seven consumer atomic switches; failure/retry/recovery/obsolete; static no-dual-track; full cross-project matrix.
- [ ] Confirm no task edits Foundation Reviewer/Revision, Foundation Issue Registry/parity implementation, Checklist content authority, or any other unrelated document.
- [ ] Confirm no task creates Comprehensive Reviewer/Revision or leaves a compatibility/fallback/old-reader wrapper.
- [ ] Confirm every consumer switch deletes its old reader in the same commit as the new reader and contains RED→GREEN→static/recovery verification.
- [ ] Confirm all examples use concrete paths, function names and commands; no `TBD`, `TODO`, “implement later”, “appropriate error handling”, or unspecified test step remains.
- [ ] Confirm no Chrome command appears in an implementation/verification step; Phase 9 remains a separate fresh-run acceptance after this plan's automatic gates.
