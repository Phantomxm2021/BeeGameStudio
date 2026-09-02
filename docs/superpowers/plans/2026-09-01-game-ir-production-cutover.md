# Game IR Phase 8 Production Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** 2026-09-01 范围重排已批准并执行中。Task 9–15 硬阻塞；先删除当前通用六域 compiler 轨道，恢复权威设计规定的阶段化 domain-specific packet 协议，再执行独立 Game IR 内容质量 Gate、自动验收和 Chrome 真实实例验收。

**Goal:** 先证明最终八文档能够稳定产出正确、具体、完整且可追溯的六域 committed Game IR；在独立自动验收与 Chrome 真实实例验收通过后，再把七个 consumer 原子切换到唯一 IR authority。

**Architecture:** `Foundation READY` 是唯一上游交接；同一 DeliveryRun 进入唯一 `GAME_IR_COMPILATION`，由一个 checkpoint writer/loader 负责 durable manifest chain 和 Phase 4→7 replay，再由 committed reader 从 run-state authority 重验六域 publication。Game IR 在系统中的唯一位置是 Foundation Reviewer/Revision 完成之后、Checklist authoring 之前。它表达 design intent 与 delivery requirements；后续实际资源只通过绑定到 IR digest 的 realization receipt/projection 记录，不回写第二份 IR。Checklist 继续由 READY raw Markdown 负责内容，唯一 durable `ChecklistToScenarioBridge` 负责 typed traceability；资源以 `requirementId -> variantId -> artifactId -> resourceId/files` 精确 join，执行 consumer 只消费 reader、bridge 和 actual-file facts。

**Tech Stack:** TypeScript, Zod v4, Bun test, Node `fs/promises` atomic rename/fsync primitives, existing DeliveryRun run-store/controller/dispatcher/recovery, existing Game IR domain assemblers and publication validators.

**Spec:** `docs/superpowers/specs/2026-09-01-game-ir-production-cutover-design.md`; 上级边界：`docs/beegame-game-ir-stage-isolation-redesign.md`

## Global Constraints

- DeliveryRun persisted schema 必须随结构变化原子递增；当前实现为 v49。旧版本、未知字段/枚举、旧 checkpoint 一律 fail closed 为 obsolete/attention，不实现 migration/compat reader。
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
- Task 9–15 之前必须运行一次范围受限的 Chrome 真实实例验收：从真实 Idea/Brief 经八文档、Foundation Reviewer/Revision 和 Foundation READY 到 committed Game IR，随后暂停，不以 Checklist 或 downstream 成功掩盖 IR 问题。Task 16 之后仍需独立 Phase 9 全流程 Chrome 验收。
- Chrome 验收不能只看 UI completed；必须联合核对服务日志、durable run、checkpoint、publication、committed reader、六个 module、source maps、dependency graph、semantic evidence、token、耗时和恢复记录。token、耗时和重试值只记录，不设任意阈值。
- 当前阶段不修 UI 展示顺序；已知 `CHECKLIST_AUTHORING` 与 `GAME_IR_COMPILATION` 的 display order 冲突登记为后续独立问题，不得混入 IR 内容质量工作。

## Authoritative execution boundary and order

本节覆盖下方历史任务编号的执行顺序；任务内部接口与原子提交边界仍保留。不得因为某个下游测试需要数据而提前执行 consumer cutover。

### 当前工作范围

只包含：

- `Foundation READY -> GAME_IR_COMPILATION -> checkpoint -> publication -> committed reader` 唯一链路。
- 六域实际内容质量、source binding、dependency graph、semantic evidence、resource realization design projection、implementation/verification projection。
- compiler 失败、恢复、无进展诊断与 committed reader fail-closed 证据。
- 独立自动内容质量 Gate 和 Chrome 真实实例验收。

明确排除：

- UI 阶段排序或新增 UI 功能。
- 修改 Foundation Reviewer、Foundation Revision、Issue Registry、八文档内容 authority 或 Checklist 内容 authority。
- Task 9–15 consumer 切换，以及为通过 IR 验收而修改任何 downstream consumer。
- 旧 reader、fallback、compatibility、migration、dual write 或第二份 resource-completed Game IR。

### 唯一执行顺序

1. 完成并审计 Task 3 的 reader/recovery/security 证据。
2. 执行 Task 3B：删除通用六域 compiler 轨道，切换为同一 `GAME_IR_COMPILATION` identity 内的阶段化 domain-specific projection/validation packet 协议。
3. 执行 Task 3A：独立 Game IR 内容质量 Gate。
4. 运行 Game IR 自动验收；问题只能回到 compiler protocol/prompt、strict DTO/domain admission、assembler、checkpoint/publication/reader 范围修正。
5. 使用 Chrome 从真实项目零状态运行到 committed Game IR，核对 UI、日志与产物；进入 Checklist 时立即暂停。发现问题继续在 Game IR 范围内循环，直至没有未解释问题。
6. 执行 Task 4–8，但不得调用或修改 Task 9–15 consumer route。
7. Task 4–8 后重新运行同一自动 Gate 与 Chrome committed-IR 回归。
8. 只有两次准入均通过，才按 Task 9→15 顺序逐个原子切换，并在同一提交删除该 consumer 旧轨。
9. Task 16 关闭全局静态双轨门禁与跨项目矩阵。
10. Phase 9 从零执行完整 Chrome workflow 验收。

### Task 9–15 硬准入条件

以下任一项不满足，Task 9–15 保持 blocked：

- 六个 canonical module 完整、非占位、非空泛摘要，且只有唯一 authority representation。
- 八文档中属于 IR 的权威事实都有唯一落点或明确 reference-only 关系；不存在无来源发明、冲突或遗漏。
- 每个业务字段具有有效 source binding；所有 reference、edge、dependency 和 semantic evidence 可解析且与 committed closure 一致。
- Resource Realization 明确 logical resource、acquisition profile、delivery target、variant 和一个 variant 的一个或多个 delivery artifact。
- Implementation Verification 明确 implementation unit、acceptance scenario、invariant 和 evidence requirement，达到下游可执行粒度。
- committed reader、checkpoint、publication、recovery、tamper 和 unchanged-progress 证据通过。
- Chrome 真实实例的 UI、日志、durable state 和实际产物一致；没有未解释的 blocked、重派、停滞、placeholder、冗余或内容失真。`IR_CONTENT_ADMITTED` 只允许作为审计报告结论，不得写入 DeliveryRun、schema、transition、controller 或任何生产 authority。
- 不使用固定 token、时间、轮数、节点、场景、资源或文件数量作为合格阈值；按未覆盖语义维度选择实例并持续验证。

### 2026-09-01 main audit ruling

- **Stage placement — accepted:** runtime canonical order is Foundation Reviewer → Foundation Revision → Game IR → Checklist；UI display order mismatch is recorded but excluded from this scope。
- **Authority — accepted:** Task 3A consumes immutable source packets and the sole committed reader result；it creates no second writer、reader、publication、reviewer、revision or persisted admission state。
- **Quality proof — accepted after correction:** objective structure/coverage is mechanical；semantic fidelity、空泛、冗余和 unsupported invention use source-packet-to-node artifact audit plus Chrome evidence，not keyword/length/count heuristics。
- **Consumer isolation — accepted:** Task 9–15 are hard-blocked twice：initial Task 3A admission and post-Task-8 regression admission。No downstream change may be used to make an IR case pass。
- **Chrome — accepted:** scoped Chrome is an evidence gate rather than a substitute for automated tests；final Phase 9 full workflow remains separate。
- **No-cap/no-dual-track — accepted:** metrics are observational only；each later consumer switch still deletes its old route atomically。
- **Compiler protocol correction — required:** the authority spec requires the service to build domain-specific semantic and validation packets before transport. The current generic `sourcePackets + remainingDomainIds + domainResults` batch makes the model infer six domain contracts and self-report projection plus PASS in one terminal. Task 3B must delete that route atomically; enriching the same generic prompt is not an accepted fix.
- **Current implementation state — explicit:** Task 3 reader/recovery/security evidence is complete at `2c95905dd`; Task 3B is the next production task. Task 9–15 remain blocked。

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

### Task 3B: staged domain-packet compiler protocol cutover

**Why this precedes content admission:** The accepted design requires the service to construct domain-specific semantic packets and independent semantic-validation packets. The current production route sends all raw domain source envelopes through one generic compiler contract and accepts candidate plus validator PASS from the same terminal. Strict server admission can reject malformed output, but the model does not receive the contract it is expected to satisfy and is allowed to self-validate. This is a protocol defect, not a content-quality tuning problem.

**Boundary:** Keep one top-level `GAME_IR_COMPILATION`, one compilation identity, one checkpoint chain, one publication and one committed reader. Do not modify Foundation Reviewer/Revision, Checklist, any Task 9–15 consumer, or create domain-specific top-level phases. Generic worker transport may remain shared infrastructure, but its Game IR payload must be a strict discriminated domain operation and may not normalize domain authority into a generic admission.

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.ts` and its tests only if durable pre-validation authority cannot be reconstructed from the existing checkpoint chain without copying authority into `DeliveryRun`.
- Create or modify the smallest Game IR-owned protocol scheduler file under `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/`; do not add scheduling logic to every domain producer.
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`, `dispatch.ts`, `worker-contracts.ts`, `worker-prompts.ts`, `delivery-worker-session-port.ts` and focused tests.
- Modify `types.ts`/`schema.ts` only if the persisted `DeliveryRun` shape changes; if it changes, bump the schema atomically and reject the previous version without migration.
- Report: `.superpowers/sdd/2026-09-01-game-ir-production-cutover/task-3b-staged-packet-report.md`.

**Protocol contract:**
- A projection operation receives exactly one service-built, identity-bound domain semantic packet. Its result can contain only that domain's semantic candidate or structured diagnostic; it cannot return validation, checkpoint, READY or publication authority.
- Gameplay 与 Balance 是一个原子 Phase 4 pair，不是先后 admission：Gameplay projection 先产生尚未 admitted 的 candidate 及其 outbound Balance target requirements；Balance packet 再由 domain owner 绑定 exact Gameplay node targets 和这些 required Balance target IDs/kinds。两份 candidate 都完成后，服务端才调用现有 pair assembler 同时重验并签发 Phase 4 closure。任何一侧都不得提前标记为 admitted authority；服务端也不得臆造尚未生成的 Balance node catalog。
- Phase 5–7 的 dependent packet 只携带该 domain owner 既有 schema/assembler 实际允许的 exact prior-node IDs/kinds 和 prior closure digest：World/Scene 使用 Phase 4 中被其 manifest 允许的目标；Presentation 使用 admitted Phase 4 与 World/Scene 中被其 manifest 允许的目标；Resource Realization 使用 admitted Phase 5 closure；Implementation/Verification 使用 admitted Phase 6 closure。不得把“所有先前节点”包装成 controller-owned generic transport catalog，也不得扩大既有 domain dependency。
- Phase 5–7 中 protocol 已声明 validation authority 的 domain，在 semantic candidate 通过 domain admission 后，必须由 distinct validation operation 接收 exact service-built validation packet；其结果只能是完整 PASS coverage 或结构化 diagnostic，不能修改/替换 candidate。Phase 4 当前权威协议明确没有 validation receipt：Gameplay/Balance 由 pair assembler 原子 admission，禁止为追求表面统一而伪造空 validator、PASS 或 receipt。
- Protocol order is fixed: Gameplay candidate → Balance candidate → atomic Phase 4 pair admission → World/Scene candidate → independent World/Scene validation/admission → Presentation candidate → independent Presentation validation/admission → Resource Realization candidate → independent validation/admission → Implementation/Verification candidate → independent validation/admission。A later operation is built only after its exact prerequisite candidate or closure is durably committed. This order is dependency, not a retry/time/token cap.
- Durable recovery replays the last committed protocol substep and derives exactly the next legal operation. It must never regenerate an already committed candidate, skip independent validation, restart Phase 4 after a later checkpoint, or read an old packet/result/publication as fallback.
- **Durability ruling:** implement the sole checkpoint writer/loader as the accepted design's immutable step-manifest chain, not a second journal. Each source/mechanical/semantic/declared-validation authority record is appended exactly once at its deterministic protocol step; a phase-closure manifest verifies the accumulated records and stores only closure identity/digest rather than duplicating the authority bytes. `latestCheckpoint` points to the current head after every committed step. Projection/validation terminals are transient transport evidence; `activeDispatch` is overwritten and `DeliveryRun.tasks` contains atomic implementation tasks, so neither can reconstruct compiler substeps after crash. Candidate/validation authority therefore lives only in this checkpoint chain and is never copied into `gameIrState` or a second store. Rejected alternative: terminal reconstruction would require a second durable terminal ledger or replay already-completed model work. Recovery cost if this ruling is wrong: replace the checkpoint step protocol before Task 3A; do not add a fallback reader.
- **Version ruling:** the persisted `DeliveryRun` baseline remains v49 because this task does not change `GameIrState`; historical v46 Task 1/2 wording describes the original landed increment and must not be used to roll production state backward. The checkpoint/record protocol must advance from its current `game-ir-stage-checkpoint.v46` / `game-ir-stage-record.v46` values because the manifest chain gains ordered substeps. The loader rejects all old checkpoint protocol values with no migration or compatibility path.
- Delete `sourcePackets`, `remainingDomainIds`, generic multi-domain `domainResults`, and any worker instruction that asks one terminal to project and validate multiple domains. Do not keep an adapter or compatibility parser.

- [x] **Step 1: Audit and rule on durable substep persistence.** Main audit selected an extension of the sole checkpoint chain for the reasons and recovery cost recorded above. It also corrected the Phase 4 dependency from a false Gameplay→Balance admission sequence to atomic pair admission.
- [ ] **Step 2: Write RED protocol and static-boundary tests.** Prove the model receives an exact domain packet rather than raw six-domain source envelopes; projection output cannot contain validation; validation cannot contain candidate; operations cannot be reordered, duplicated, skipped or cross-bound; the old generic fields and prompt instructions are absent from every production path.
- [ ] **Step 3: Write RED crash/recovery tests.** Cover restart after projection admission before validation, after validation before phase closure, after each committed phase, and before publication. Prove the same compilation identity resumes the exact next operation with no fixed attempt/time/token cap.
- [ ] **Step 4: Implement the smallest staged scheduler and durable protocol.** Reuse the six existing domain packet builders, admissions, validators and assemblers. Do not duplicate any domain schema or introduce a generic semantic admission.
- [ ] **Step 5: Atomically delete the generic compiler route.** Remove the old contract fields, result shape, prompt wording, controller batch admission and recovery branches in the same commit that makes the staged route green. Unknown old fields must fail closed.
- [ ] **Step 6: Run focused GREEN evidence.** Run compiler contract/prompt/session, staged scheduler, controller recovery, checkpoint/publication/reader, boundary and Foundation parity suites plus typecheck, Biome and diff-check.
- [ ] **Step 7: Main-agent audit.** Verify exact spec compliance, no second stage/authority, no Reviewer/Revision or Task 9–15 changes, no compatibility path, no arbitrary caps, and no same-worker self-validation. Correct findings before admitting Task 3B.

**Bounded implementation order (no temporary production dual route):**
1. **Task 3B.1 — owner packet seam audit（complete, no production diff）:** the audit proved that adding unused prior-target APIs before the scheduler would create speculative/dead authority seams, while shared optional fields would recreate a generic wrapper. Therefore packet completeness is part of the atomic cutover, not a standalone production commit. Baseline owner producer suites remain green.
2. **Task 3B.2 — atomic protocol and packet cutover:** RED tests first, then add the required domain-owned counterpart/prior packet seams together with their sole scheduler caller, restore the sole checkpoint protocol to an immutable step-manifest chain, add strict discriminated projection/validation contracts, prompt/session/controller/recovery wiring, and delete the generic batch fields/branches in the same production commit.
3. **Task 3B.3 — evidence and correction:** run focused recovery/tamper/boundary/Foundation parity evidence; main-agent audit the complete diff and assign only concrete corrections. Task 3A remains blocked until this audit is clean.

**Checkpoint operation chain:** exactly ten model-operation manifests are permitted: `gameplay/projection`, `balance/projection`, `world-scene/projection`, `world-scene/validation`, `presentation/projection`, `presentation/validation`, `resource-realization/projection`, `resource-realization/validation`, `implementation-verification/projection`, `implementation-verification/validation`. A projection manifest appends that domain's source/mechanical/semantic records once; a validation manifest appends only the declared validation record. `balance/projection` must first replay and atomically admit the Phase 4 pair; the final validation operation in Phases 5–7 must first replay and admit that complete phase. Those four manifests carry the corresponding phase-closure digest, so no empty closure step or duplicate phase record set is written. A filesystem-committed next manifest may advance a stale snapshot during recovery only after full identity/digest/predecessor revalidation.

**Projection payload correction (2026-09-02):** a projection operation may no longer ask the model to serialize the complete domain semantic as one StructuredOutput value. It must implement the service-owned semantic slice stream defined by `docs/superpowers/specs/2026-09-02-game-ir-semantic-slice-stream-design.md`: contract-derived node-kind dependency slices are admitted into one temporary operation-local digest journal, then the existing full-domain gate writes the same single projection manifest. Slice dispatches are internal work, not additional model-operation manifests or authority. Token/byte/time/count-driven chunking, complete-domain fallback, compatibility readers and a second publication/checkpoint track are forbidden.

### Task 3A: standalone Game IR content-quality and Chrome admission gate

**Boundary:** 本任务只验证 committed Game IR 本身，不接入 Checklist Bridge、Resource、Planner、Implementation、Audit 或 Acceptance。它不得创建第二 reader、第二 publication、第二 reviewer/revision loop 或新的 durable authority。

**Files:**
- Create only if mechanical checks are not already expressible through existing domain validators: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/content-quality-gate.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/content-quality-gate.test.ts`
- Test/harness: reuse `committed-reader.test.ts`, existing domain semantic-fidelity tests and real workflow/log/artifact inspection; do not modify downstream consumers.
- Report: `.superpowers/sdd/2026-09-01-game-ir-production-cutover/task-3a-ir-quality-report.md`

**Quality contract:**
- Input is only the canonical Foundation READY receipt/source packets plus the result of `readCommittedGameIr`; the gate does not reread alternate documents or infer authority by keyword/similarity.
- Coverage is authority-driven, not count-driven: every admitted source claim and owned material has exactly one module/node destination or an explicit permitted reference-only relation.
- Reject placeholder/core modules, empty/generic summary nodes, unresolved references/edges, missing source bindings, detached evidence, duplicated authority, unsupported invention and contradictions with source packets.
- Resource projection must preserve logical requirement→profile→target→variant→artifact semantics, including multiple artifacts for one variant where required. It describes desired delivery, not actual inventory files.
- Implementation/Verification projection must provide concrete units, scenarios, invariants and evidence requirements with resolvable ownership and traceability.
- Density/redundancy is split deliberately: repeated authority payloads and duplicate ownership are mechanically rejected；“空泛、冗余、是否忠实表达来源”由主代理将 committed node 逐项对照 immutable source packet 审计，并记录到 coverage ledger。禁止用关键词、字符串相似度、字数、token 或节点数量启发式替代语义判断。

- [ ] **Step 1: Freeze downstream.** 以 Task 3B accepted commit 为本阶段变更基线；主代理通过 changed-path diff 和 protected manifest 只读核对，证明 Task 9–15 production routes 与 Foundation protected files 未被修改。不要把 Git baseline 或测试开关写入生产代码。

- [x] **Step 2: Complete Task 3 public-reader evidence.** Completed at `2c95905dd`: public entry rejects digest-resealed duplicate/remap/core-placeholder, detached evidence, source-map/graph, READY/run/checkpoint digest and staging/old/previous fallback mutations. The secure-file ABA ruling is recorded in `task-3-report.md`; no production-only test seam was added.

- [ ] **Step 3: Write RED objective content-quality cases.** Use committed reader fixtures to demonstrate rejection of missing owned source coverage, duplicated owner payload, invalid/unbound source claims, unresolved cross-module relations, incomplete resource artifact realization, and non-executable implementation/verification projections. “空泛内容”和“unsupported invention”不得通过关键词/长度启发式实现，留给 Step 5/6 的 source-packet 对照审计。

- [ ] **Step 4: Implement the smallest mechanical gate.** Reuse existing strict DTO/domain parsers, semantic-fidelity checks, closure and reader projections. Add no generic second validator framework and no model-based reviewer stage. If a requirement is already enforced by an existing validator, reference and test it instead of duplicating code.

- [ ] **Step 5: Run standalone automatic acceptance and semantic artifact audit.** Run the complete Game IR domain, checkpoint, publication, reader, recovery, boundary and Foundation parity suites plus typecheck/lint/diff-check。随后将 committed nodes/source claims 与 immutable source packets 建立逐项 coverage ledger，人工/主代理判断空泛、冗余、遗漏、冲突和 unsupported invention。记录实际 token、duration、retry 和 artifact metrics，不设阈值。

- [ ] **Step 6: Chrome real-instance admission.** From a fresh real project, run Idea/Brief→eight documents→Foundation Reviewer/Revision→Foundation READY→committed Game IR. At Checklist entry immediately pause. Inspect all six modules, source maps, dependency graph, semantic evidence, checkpoint/publication/READY receipts, service logs and durable run. Continue correcting only Game IR-owned code until no unexplained defect remains.

- [ ] **Step 7: Repeat by uncovered semantic dimension.** Select additional real projects based on uncovered complexity—numerical/formula-heavy, scene/UI-state-heavy, and resource-variant/multi-artifact-heavy are examples, not a fixed project count. Stop only when the source/material coverage ledger has no uncovered dimension.

- [ ] **Step 8: Main audit and admission decision.** The main agent verifies the evidence, protected boundaries, no-dual-track gate and report. Only an explicit `IR_CONTENT_ADMITTED` result unlocks Task 4–8. Task 9–15 remain blocked until the post-Task-8 rerun also produces `IR_CONTENT_ADMITTED`.

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

**HARD BLOCK:** Task 9 may not start until Task 3A has produced `IR_CONTENT_ADMITTED`, Task 4–8 are complete, and the post-Task-8 automatic plus Chrome committed-IR regression has produced a second `IR_CONTENT_ADMITTED`. Test fixture convenience, downstream compile failures, or schedule pressure cannot waive this gate.

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
- [ ] Confirm Chrome only appears in Task 3A 的 committed-IR scoped admission 和 Task 3A post-Task-8 regression；Task 16 不启动 Chrome，Phase 9 仍是独立 fresh full-workflow acceptance。
