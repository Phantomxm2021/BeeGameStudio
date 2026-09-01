# Game IR Phase 8：生产单轨切换设计

**状态：** 已经主代理独立审计并修订，准入 implementation plan；尚未准入生产代码。

**上级权威：** `docs/beegame-game-ir-stage-isolation-redesign.md`。

**前置边界：** Phase 7 的六域 complete candidate、authority-bound
publication/recovery 已验收。Phase 8 只把这个已经存在的发布边界接入生产
consumer；它不重新定义 Game IR domain schema，不重写 Foundation Reviewer 或
Foundation Revision，也不恢复任何被删除的旧 admission 路径。

## 1. 目标与非目标

Phase 8 的唯一目标是把生产流程从“各 consumer 自己读取 canonical 文档或
caller-built projection”切换为一条可恢复、可验证的 Game IR 读取链：

```text
Foundation READY
    -> GAME_IR_COMPILATION durable phase
    -> committed six-module Game IR
    -> Checklist (仍由 raw Markdown authority 产生)
    -> Resource Planner
    -> Resource Curator
    -> Content
    -> Atomic Task Planner
    -> Implementation Worker
    -> Implementation Auditor
    -> Acceptance
```

此处的箭头是生产状态和消费依赖，不表示 Foundation Reviewer/Revision 被
Game IR 调用，也不表示 Checklist 文本被反向编译为 IR。Foundation 的业务
authority 在 READY 时冻结；Game IR 是 READY 之后的下游执行投影。

本阶段不做以下事情：

- 不新增或恢复 Comprehensive Reviewer、Comprehensive Revision；
- 不把现有 `implementation-auditor` 改名或伪装成 Comprehensive Reviewer；
- 不修改 Foundation Reviewer、Foundation Revision、Issue Registry 或其
  parity contract；
- 不将 Checklist Markdown 改成 JSON、YAML 或 Game IR；
- 不引入第二个 store、controller、journal、recovery projector 或
  publication authority；
- 不保留旧文档读取、fallback、migration reader、compatibility alias、
  legacy reader 或 dual-write；
- 不设置 token、时间、attempt、task、node、edge、scenario、invariant、
  evidence、artifact 或文件数量的业务上限。

这里的“无上限”仅指不添加任意的业务执行 cap；并不取消 schema 固有的
cardinality（例如固定六个 canonical module、某类节点必须一个 target、
或至少一个 evidence）。固有 cardinality 仍由 strict schema 和 closure
admission 强制。

## 2. 唯一 durable phase 与严格 DeliveryRun schema

### 2.1 阶段位置

Phase 8 在 DeliveryRun 中引入唯一的 `GAME_IR_COMPILATION` durable phase。
当前 `DeliveryPhase` 没有独立的 `CHECKLIST` phase；因此不得虚构一个新的
phase 名称。它只能在同一 run 已经取得 Foundation READY receipt 后进入，
并且只能在 Game IR publication 被原子提交且由 committed reader 独立重验后，
回到现有的 `DOCUMENT_REVIEW` phase 的 `CHECKLIST_DRAFTING` document step，
再由既有 transition 进入 `RESOURCE_PREPARATION`：

```text
Foundation Reviewer/Revision -> FOUNDATION READY
                              -> GAME_IR_COMPILATION
                              -> DOCUMENT_REVIEW + CHECKLIST_DRAFTING
                              -> DOCUMENT_REVIEW + CHECKLIST_BRIDGE
                              -> RESOURCE_PREPARATION
```

`GAME_IR_COMPILATION` 不是 Foundation 的 reviewer stage，也不是 Checklist
stage 的子步骤。Foundation 不能读取、写入或修订它；Checklist 不能替它
生成 Game IR。阶段转移只由 DeliveryRun 的现有
`transition/controller/dispatcher/recovery` 链完成；完成 Game IR 后必须写入
现有 `DOCUMENT_REVIEW + CHECKLIST_DRAFTING`，不能以不存在的 `CHECKLIST`
phase 取代它。

Checklist canonical publish 完成后不能直接进入 `RESOURCE_PREPARATION`。v46 在
既有 `DOCUMENT_REVIEW` phase 下增加唯一的 `CHECKLIST_BRIDGE` document step；
只有该 step 的 durable bridge admission 被提交并重验后，才能进入
`RESOURCE_PREPARATION`。这是 Checklist→IR 的下游 traceability admission，
不是新的顶层 phase，也不是 Checklist 内容生成或修订轨道。

### 2.2 v46 strict contract

新的 DeliveryRun schema 固定为 **v46**。v46 parser 必须严格拒绝：

- 任何旧 schema version；
- 未知顶层字段、未知 `gameIrState` 字段或未知 phase/status 枚举；
- 没有 Foundation READY identity 的 Game IR phase；
- 从任意其他 phase 直接跳到 `GAME_IR_COMPILATION` 或从其绕过直接进入
  Checklist；
- 没有 committed checkpoint/publication 却进入
  `DOCUMENT_REVIEW + CHECKLIST_DRAFTING` 的 state；
- 没有 canonical Checklist publication 和 admitted bridge receipt 却从
  `DOCUMENT_REVIEW + CHECKLIST_BRIDGE` 进入 `RESOURCE_PREPARATION` 的 state；
- 同一 run 中两个 Game IR state、两个 checkpoint pointer 或两个 publication
  authority。

v46 不解析、不迁移、不修补旧 run。旧 run 只作为历史证据保存，不在新代码
下恢复；需要继续执行时建立一个新的 v46 run，从新的 Foundation READY 开始。
版本不匹配、未知字段和旧 checkpoint 都是 fail-closed 的 obsolete/attention
诊断，不是触发兼容 reader 的理由。

### 2.3 `gameIrState` 的最小形状

`gameIrState` 是严格 discriminated union。它是 DeliveryRun snapshot 中唯一
的 Game IR state；authority payload 仍在 checkpoint/publication 目录，不在
snapshot 中复制：

```ts
type GameIrCompilationIdentity = Readonly<{
  runId: string
  taskId: string
  publicationId: string
  confirmedBriefDigest: string
  foundationRevision: string
  foundationReadyReceiptDigest: string
}>

type GameIrCheckpointRef = Readonly<{
  checkpointPath: string
  checkpointDigest: string
}>

type GameIrState =
  | Readonly<{
      status: 'compiling'
      identity: GameIrCompilationIdentity
      latestCheckpoint?: GameIrCheckpointRef
      diagnosticRef?: string
    }>
  | Readonly<{
      status: 'ready'
      identity: GameIrCompilationIdentity
      checkpoint: GameIrCheckpointRef
      readyReceipt: GameIrReadyReceipt
      readyReceiptDigest: string
    }>
```

规则如下：

1. `compiling` 只允许有 compilation identity 和可选的、已明确命名的
   `latestCheckpoint`。每个 ref 都指向 immutable、run-scoped、schema-v46
   checkpoint manifest；没有 nullable path/digest 组合。
2. `ready` 的 identity、checkpoint ref、`readyReceipt` 和
   `readyReceiptDigest` 都非 nullable；service 必须重算 receipt digest 并
   证明 `readyReceipt.foundationReceiptDigest` 等于 identity 中的
   `foundationReadyReceiptDigest`，同时证明 `readyReceiptDigest` 等于完整
   `GameIrReadyReceipt` canonical bytes 的 digest。二者不是同一个 digest。
   ready 只能在 checkpoint loader 和 committed reader 都通过后产生。
3. worker/admission 失败时仍处于同一个 `compiling` identity；可选的
   `diagnosticRef` 只指向结构化诊断，不构成另一套 authority。DeliveryRun
   自身的 status 决定是否自动继续或需要 attention。只有 Foundation identity
   变化时才创建新的 compilation identity。
4. `runId`、`taskId`、`publicationId`、`confirmedBriefDigest`、
   `foundationRevision` 和 `foundationReadyReceiptDigest` 在该 compilation
   epoch 中由 service 绑定，不接受 worker 重绑定或 caller 改写。union 内
   重复的 digest 只是一致性校验值，不是第二个 authority。
5. state 不保存 source、mechanical、semantic、validation、module、graph、
   manifest、prompt、document body、Checklist、resource 文件或 complete
   candidate。所有大对象只存在 checkpoint/publication 目录，避免 snapshot
   双写 authority。
6. `status` 是生命周期 discriminant，不是第二套 admission；它不携带
   retry counter、token budget、deadline 或“已通过”的业务推断。旧 schema、
   unknown status 和任何 nullable 旧 union 在 parser 层直接拒绝。

## 3. 一个 checkpoint writer/loader 与 durable 记录

### 3.1 唯一 writer/loader

Game IR 在生产流程中只有一个 `GameIrStageCheckpointWriter` 和一个
`GameIrStageCheckpointLoader`。它们复用现有 run-store、dispatcher、
controller 和 recovery；不创建第二个数据库、state store、event journal
或 controller。

writer 是 durable storage primitive，不是 generic business admission。它
只接受已由对应 domain service admission 返回的 authority record，并按
固定 envelope 写入；它不能接受 worker 自己拼出的 candidate、模块、receipt
或 authority map。

loader 是唯一恢复入口。任何 consumer、publication reader 或 recovery
projector 不得直接读取某个 domain 文件绕过 loader。

### 3.2 checkpoint 内容

一个 v46 checkpoint 的 manifest 固定包含同一个 compilation identity、
Foundation READY binding、完整 source Section Index，以及截至该 step 已完成
domain 的 service-admitted authority record references。它不在每一步复制所有
前序 authority；immutable record files 只写一次，后续 manifest 通过 path/digest
引用前序 manifest 链：

```text
phase4/gameplay/source
phase4/gameplay/mechanical
phase4/gameplay/semantic
phase4/balance/source
phase4/balance/mechanical
phase4/balance/semantic
phase5/world-scene/source
phase5/world-scene/mechanical
phase5/world-scene/semantic
phase5/world-scene/validation
phase5/presentation/source
phase5/presentation/mechanical
phase5/presentation/semantic
phase5/presentation/validation
phase6/resource-realization/source
phase6/resource-realization/mechanical
phase6/resource-realization/semantic
phase6/resource-realization/validation
phase7/implementation-verification/source
phase7/implementation-verification/mechanical
phase7/implementation-verification/semantic
phase7/implementation-verification/validation
```

上表是“该 phase protocol 实际声明的 authority kind”的完整集合。每个
step manifest 还包含 `previousManifestPath`/`previousManifestDigest`（首个
manifest 没有 previous），因此恢复可以沿一条 immutable manifest chain 重建
完整集合，而不会创建第二个 event journal。Phase 4
当前没有独立 validation receipt 时，checkpoint 不能伪造空 validation；
phase discriminant 必须明确其 absence。未来新增 authority kind 必须先改
schema 和本设计，不得由 generic writer 静默吞掉。

每个 immutable record 都绑定：

- `taskId`、Foundation revision、READY receipt digest、compile request digest；
- 完整且 receipt-bound 的 source Section Index；
- domain/module/phase identity；
- authority bytes digest、canonical length 和 writer schema version；
- 前序 closure digest（如适用）。

这些字段用于恢复时重验，不意味着在 `gameIrState` 中复制其 payload。

### 3.3 原子写入

writer 对每次阶段 checkpoint 使用同一 run-store 的确定性 step-path 协议。
filesystem commit 与 DeliveryRun snapshot 更新是两个有序持久化动作，不能
声称为一个跨系统原子事务：

1. 验证待写 authority 已由对应 domain service admitted，并验证它的 identity
   与当前 `gameIrState` 一致；
2. 根据 compilation identity 和 phase step 计算唯一 record/manifest path，
   在 run-scoped temporary path 写入本 step 新增的 immutable record files；
3. 对新增 records 和新 manifest 计算 canonical digest；完成持久化后，把
   temporary step 目录原子 rename 到确定性 final step path。final step path
   若已存在，只能在 identity/digest 完全相同并重验成功时复用，否则 fail
   closed；
4. 新 manifest 只引用本 step records 和 previous manifest chain。它提交成功
   后，才更新 run-store snapshot 的 `latestCheckpoint` ref/status；
5. 若在 filesystem commit 后、snapshot 更新前崩溃，恢复会按同一 identity
   和确定性 step path 重验已提交 step，然后推进 snapshot；若 step 不在
   manifest chain 中，它对 loader 不可见。temporary/orphan files 永远不能
   成为 authority；
6. publication 的 COMMITTED marker 也必须在其自己的原子协议完成后才可被
   reader 观察。

这条 immutable record/manifest chain 是 checkpoint storage，不是第二 event
journal；它不追加 worker 叙事，也不让 journal 自证 authority。writer 不会
先写 snapshot 再补 authority。所有写入都可重复计算 digest；重复 resume 必须
得到同一 authority 和同一 digest。

### 3.4 loader 与 Phase 4→7 replay

loader 只接受 run-state 指向的 checkpoint path，并按以下顺序处理：

1. 解析严格 v46 checkpoint envelope，拒绝未知字段、重复 record、路径
   越界、缺失 record 和不匹配的 run/task/revision/READY identity；
2. 重算每个 authority digest、manifest digest 和 root checkpoint digest；
3. 校验 phase order、Section Index、source binding 与每个前序 closure；
4. 先 replay Phase 4 Gameplay/Balance closure，再 replay Phase 5
   World/Presentation closure，再 replay Phase 6 Resource Realization
   closure，最后 replay Phase 7 Implementation/Verification closure；
5. 每一层调用该 domain 自己的 assembler/validator。下层输出只作为上层
   的 typed authority，不得被 loader 合并为 generic admission；
6. 只有完整六模块 candidate、source map、graph 和 publication evidence
   都从同一 replay 得到并通过重验，loader 才能返回 ready authority。

loader 不读取 canonical docs 来补 checkpoint，不读取 journal 来补某条
authority，不读取上一个 publication 来填缺失模块，也不接受 caller 提供的
partial closure。任意缺失或 digest mismatch 都 fail closed。

## 4. domain producer/validator 与 transport 边界

Worker transport 可以继续使用通用的 worker type、session port、structured
response transport 和 retry envelope；这只是通信设施，不是业务 admission。

每个 domain 必须继续拥有独立的：

- source envelope 和 source binding；
- mechanical receipt schema/admission；
- semantic packet/schema/admission；
- semantic validation schema/admission（仅在该 phase protocol 声明时）；
- producer、validator、assembler 和诊断 reason codes。

通用 transport 只能传递已经绑定 identity 的 domain-specific packet。它不
得根据 `workerType`、关键词、module label 或任意字符串选择 domain，不得把
不同 domain 的 packet 归一化为一个 `GenericSemanticAdmission`，也不得在
失败时从旧 packet、raw docs 或旧 IR 填补。

worker 的结果如果缺少 source pointer、owner binding、phase identity、
compile request 或 READY digest，由对应 domain admission 拒绝；transport
返回结构化诊断，不能将诊断当成 publication evidence。

若 domain admission 证明问题属于 Foundation business defect，而不是 worker
candidate、compiler 或 publication failure，Game IR stage 只发布上级权威定义的
`FoundationDefectReport`。既有外层 workflow 可以通过既有标准 Issue admission
接口建立新的 Foundation revision epoch；Phase 8 不修改 Foundation Reviewer/
Revision 内部实现，也不把 Game IR 诊断直接写入 Issue Registry。新 READY receipt
产生后，旧 compilation、bridge 及其全部下游 closure 都 obsolete；不得在旧
identity 上热修文档或继续 consumer。

## 5. committed publication 与唯一 reader

### 5.1 唯一外部 authority

publication 后，生产代码只能通过一个 committed reader 取得 Game IR：

```ts
readCommittedGameIr({
  workspacePath,
  deliveryRun,
}): Promise<Readonly<GameIrPublishedReader>>
```

reader 只能从 `deliveryRun.gameIrState` 取得 state，caller 不能另传一份可能与
snapshot 不一致的 state。`gameIrState` 中的
`identity.foundationReadyReceiptDigest` 是外部 authority。
reader 必须从 `deliveryRun` 的既有 Foundation READY adapter 内部读取当前
receipt，并用 state 中的 revision/digest、run identity、publication marker
逐一比对；caller 不能传入或替换一份 Foundation receipt 来绕过 run-state
authority；
不得用 publication 自己的 metadata 冒充 READY authority。

reader 只读 publication 的 committed root，读取并重验：

- publication manifest；
- 六个且仅六个 canonical module；
- source-map；
- dependency graph；
- module、candidate、source-map、graph、evidence 和 closure digests；
- checkpoint digest、Foundation revision 和 READY receipt digest。

reader 必须通过完整 candidate parser 重建 complete candidate，而不是只
检查目录里有六个文件。`core` placeholder、缺失 module、重复 module、重标记
module、detached evidence、source-map/graph 不一致、任何 digest mismatch
都拒绝。

### 5.2 禁止的读取路径

committed reader 不能：

- 从 journal、event log、DeliveryRun snapshot payload 推导缺失模块；
- 从 canonical Markdown、old `authorityPaths` 或 worker prompt fallback；
- 从上一次 publication、临时目录、未提交目录或 memory cache fallback；
- 接受 caller-built candidate、module map、compile request、section index；
- 暴露一个同时支持 old reader 与 new reader 的 compatibility facade。

任何读取失败都返回结构化 fail-closed diagnosis；consumer 不得继续执行，
也不得自行读取文档绕过诊断。

## 6. Checklist 边界与唯一 semantic bridge

Checklist 仍是 Foundation READY 后的 raw Markdown 内容 authority。其 canonical
Markdown projection、candidate validation 和 atomic publish 继续由 Checklist
stage 自己负责；Game IR 不生成、重写或反投影 Checklist 文本。

Phase 8 只增加一个 `ChecklistToScenarioBridge`，职责是把已经发布的
Checklist semantic item 与 IR 的 `implementation-verification` scenarios、
invariants 和 evidence owners 建立可验证的 typed join。bridge 的 service-owned
preparation packet 必须同时包含 strict Checklist items/source tags，以及
committed implementation-verification scenarios/invariants/evidence；它不能只
传递一个未经约束的 checklist ID 列表：

```ts
type ChecklistBridgeSemanticClaim = Readonly<{
  checklistId: string
  sourcePointer: string
  sourceDigest: string
  target:
    | Readonly<{
        kind: 'scenario'
        scenarioId: string
      }>
    | Readonly<{
        kind: 'gate'
        invariantId: string
        evidenceOwnerUnitId: string
        evidenceRequirementId: string
      }>
}>
```

bridge 的唯一输入是 canonical Checklist raw Markdown projection、其严格
Checklist item/source-tag packet、以及 committed Game IR reader 提供的
scenarios/invariants/evidence。service 先创建 packet；semantic worker 只能
返回上面 discriminated `target` 的 typed claims；独立 bridge validator 再
根据 source binding、目标存在性、scenario/gate 类型和 evidence owner closure
进行 admission。它不得使用相似度、关键词、数组顺序、首个匹配、广播一个 block
tag 或“最接近的 unit”猜测关系。

规则：

- 每个 Checklist item（包括 gate item）必须被 bridge 处理且恰好一次；每个
  item 必须有一个明确、可重算的 source binding；
- `scenario` target 必须解析到一个且仅一个
  `implementation-verification.acceptance-scenario`；
- `gate` target 必须同时解析到一个 invariant、该 invariant 的 evidence owner
  unit，以及一个属于该 owner/support closure 的 evidence requirement；gate
  不能被漏掉、降级为普通文本或伪装成 scenario；
- missing、ambiguous、重复或 digest 不一致的 mapping 都 fail closed；
- bridge validator 必须验证 service-owned packet 的 item 集合与 canonical
  Checklist 恰好相等，不能静默丢弃未知、空或重复 item；
- bridge 只产生 traceability/coverage evidence，不改变 Checklist 文本、IR
  节点、unit ownedPaths、depends-on 或 evidence requirement；
- bridge 不允许 Checklist 成为 Game IR source，也不允许 Game IR 成为
  Checklist 内容 writer。

Checklist consumer 可以继续读取自己的 raw Markdown authority；其他
consumer 不能借此取得文档 authority。bridge 是唯一的 Checklist→IR 语义
连接，不能出现第二个 parser、crosswalk 或隐式映射。

### 6.1 durable bridge admission

Checklist canonical publish 成功后，既有 controller 必须把 run 推进到
`DOCUMENT_REVIEW + CHECKLIST_BRIDGE`，而不是直接推进资源阶段。DeliveryRun
只保存一个严格 `checklistBridgeState`：

```ts
type ChecklistBridgeIdentity = Readonly<{
  runId: string
  taskId: string
  checklistPublicationDigest: string
  gameIrReadyReceiptDigest: string
}>

type ChecklistBridgeState =
  | Readonly<{
      status: 'bridging'
      identity: ChecklistBridgeIdentity
      diagnosticRef?: string
    }>
  | Readonly<{
      status: 'ready'
      identity: ChecklistBridgeIdentity
      receiptPath: string
      receiptDigest: string
    }>
```

bridge service 按确定性的 run-scoped path 写入 immutable preparation packet、
worker claim、validator receipt；只有 validator receipt 完整覆盖 canonical
Checklist items 且与 committed Game IR identity 一致时，才把 state 更新为
`ready`。filesystem commit 先于 snapshot 更新；若两者之间崩溃，恢复按同一
identity/path 重验已有记录再推进 snapshot，不重新猜测或生成另一份 mapping。

`checklistBridgeState` 不保存 Checklist body、IR projection 或 claims payload；
它只保存 identity 和 admitted receipt ref。Checklist publication digest 或
`gameIrReadyReceiptDigest` 任一变化，旧 bridge 都立即 obsolete，且所有依赖旧
bridge 的下游 receipt 一并失效。bridge 失败保留同一个 identity 和精确诊断；
不得回退到旧 parser、关键词 crosswalk、上一个 run 的 bridge 或直接进入资源
阶段。

## 7. Resource realization 到实际交付的投影

Resource Planner 和 Resource Curator 只读 Game IR 的完整 resource projection：

```text
logical requirement
  -> one or more realization variants
  -> one or more delivery artifact specifications per variant
  -> technical constraints / format / runtime role / consumer
```

projection 必须完整保留：

- `requirementId`、resource kind、runtime role 和 required-by edges；
- acquisition profile、source/license/quality constraints；
- 每个 variant 的用途、coverage、变体级约束；
- 每个 delivery artifact 的路径、编码、格式、尺寸、平台、技术约束和
  与 variant 的归属；
- 一个 logical requirement 对多个变体、一个变体对多个 delivery artifact
  的 schema cardinality；这里没有 arbitrary business execution cap，但
  六模块集合、每个 schema 要求的最少/恰好一个关系等固有 cardinality 仍由
  schema 强制。

Game IR 是 logical requirement/specification 的唯一 authority。Inventory 和
Manifest 只拥有 actual resource facts：`resourceId`、actual file path、已选
或已生成的文件、provenance、license、verification 和当前 inventory epoch。

两者只能通过精确的根 join 和逐 artifact binding：

```text
GameIR logical-resource.requirementId
  == ResourceInventoryReceipt.binding.requirementId
  -> ResourceDeliveryBinding.variantId/artifactBindings[].artifactId
  -> Manifest actual resourceId/files
```

其 contract 为：

```ts
type ResourceDeliveryBinding = Readonly<{
  requirementId: string
  variantId: string
  artifactBindings: readonly Readonly<{
    artifactId: string
    resourceId: string
    filePaths: readonly string[]
  }>[]
}>
```

每个 IR delivery-artifact specification 必须恰好有一个对应的
`artifactBindings`，并逐一验证 Manifest 中的 `resourceId`、每个 actual file
path、文件 digest/format（若 Manifest contract 声明）和所属 variant。一个
`resourceId` 可以承载多个交付文件；一个 requirement 可以拥有多个 variant
和多个 artifact；不能把它们压平为一行或只验证 requirement 级别。Inventory
receipt 必须升级到该 shape，旧的只有 `requirementId -> resourceId` 的 shape
在 v46 parser 中直接拒绝，不提供兼容适配。

任何 consumer 都不得把 `implements` node ID、label、path、关键词或
artifact filename cast 成 resource ID；missing requirementId、重复 join、
missing/extra artifact binding、variant/artifact 不匹配或 actual file 与
Manifest 不一致都必须阻断。

Curator 可以为同一个 requirement 提交多个实际交付文件，但只能满足已存在
的 IR artifact specifications；它不能增删 requirement、改变 variant、
重写技术约束或把 placeholder 当作新的 authority。

## 8. Atomic Task Planner contract

Atomic Task Planner 的输入是三个已经建立的只读连接：

1. committed Game IR 的 execution projection（units、owned paths、typed
   dependencies、targets、scenarios、invariants 和 evidence requirements）；
2. 唯一 Checklist-to-scenario bridge；
3. 通过 `requirementId` 得到的 actual resource/content joins。

`readAtomicTaskPlanningDocuments`、按 `authorityPaths` 读取 GDD/Balance/
Technical/UI/Audio/Level 文档、以及 planner 自己拼 unit 的旧路径必须物理
删除。Planner 不再把八份文档重新当 task authority。

IR 中 service-admitted implementation unit 的 `ownedPaths`、`depends-on`、
target 和 required prior edges 是不可重写的。Planner 从一个 unit 派生一个
或多个 `AtomicTask`，但 AtomicTask 不是 attempt：

```ts
type AtomicTaskPlanProjection = Readonly<{
  id: string
  unitId: string
  checklistIds: readonly string[]
  allowedPaths: readonly string[]
  dependsOn: readonly string[]
  expectedArtifacts: readonly string[]
  verification: readonly TaskVerification[]
  resourceIds: readonly string[]
  contentIds: readonly string[]
}>
```

这是对现有 AtomicTask 业务字段的投影视图；既有 `title`、`status`、`attempt`、
revision 和 evidence 字段继续由现有 execution state 拥有。每个 AtomicTask
必须携带一个 IR `unitId`，其 `allowedPaths` 只能等于或收窄该 unit 的
`ownedPaths`。同一 unit 的多个 task 可以在明确依赖顺序下共享 unit scope，
但不能把该 scope 转授给其他 unit。所有实现某 dependent unit 的 task 都必须
等待其 IR dependency units 的完成；Planner 可以增加 unit 内部施工顺序，不能
删除、反转或跨越 IR dependency edge。Planner 不能创建新的 unit、path owner、
Checklist scenario 或 resource requirement，也不能通过拆 task 改写 unit 的
所有权。

`attempt` 仅是某个 AtomicTask 的运行/恢复记录，用于记录一次执行和重试，
不携带新的业务语义，也不受固定数量上限控制。一个 task 可以因失败、重启或
并发协调产生多个 attempts，但每个 attempt 都必须继续受同一 task 的
`unitId`、owned paths 和 dependency closure 约束。

`expectedArtifacts` 和 `verification` 由 Planner 根据 IR evidence kind、unit
ownedPaths 与当前可观察的代码/资源事实提出；它们不是 Planner 新 author 的
业务要求。service 必须逐项验证路径属于 unit、artifact 类型与 evidence kind
一致、verification 引用已存在的 scenario/invariant/evidence requirement，
并拒绝越界、缺失、重复或凭关键词推导的条目。任务图的 canonical
ownership/dependency 只来自 IR；planner 的输出是 delivery execution plan，
而不是重新编译业务语义。

## 9. Consumer 单轨切换顺序与原子删除

以下是唯一允许的迁移顺序。每个 consumer 的切换必须在同一个提交中完成：
新增唯一 Game IR reader、删除旧 docs authorityPaths/prompts/readers，并
加入该 consumer 的 single-reader/static/recovery test。不能先保留旧 reader
等待“以后再删”。

### 9.1 Resource Planner

读取 Game IR resource projection 产生 logical requirement plan。删除从
`ASSET_PLAN`、`ART_DIRECTION`、`TECHNICAL_DESIGN` 重新推导 requirement 的
authority path；Manifest actual facts 不是 planner 的 requirement authority。

### 9.2 Resource Curator

读取同一 resource projection，加上当前 Manifest/Inventory actual-file
authority，提交 requirementId 精确绑定的多 artifact realization。删除从
raw docs 补约束、重写 requirement 或通过旧 curator projection fallback 的
路径。

### 9.3 Content

读取 IR 的 content/resource artifact specifications 和 Manifest actual files。
Content 只能在其 admitted `repairPaths` 生成实际内容文件；canonical design
docs 不再作为 task authority 注入 prompt 或 `workflowReadOnlyPaths`，也不依赖
Checklist bridge。Checklist traceability 由 Atomic Task Planner/Acceptance
边界处理，避免把 Content 与 Checklist 形成不必要耦合。

### 9.4 Atomic Task Planner

按第 8 节读取 execution projection、bridge 和 actual joins。删除旧
`readAtomicTaskPlanningDocuments` 及其所有调用、fixture 和 prompt 文案。

### 9.5 Implementation Worker

读取 Atomic Task Plan 与 IR unit/evidence contract，写入已经由 unit ownership
允许的 project paths。它不能重读八份文档、重新选择 owner、扩大 path scope
或把 evidence requirement 当成已经通过的事实。

### 9.6 Implementation Auditor

读取 IR acceptance/invariant/evidence requirements、actual implementation
outputs 和 durable execution evidence，验证其是否满足 source-bound
contract。它不是 Comprehensive Reviewer，不产生 Foundation Issue，不修改
Foundation 文档，也不回退到 raw docs。

### 9.7 Acceptance

读取 Checklist raw Markdown authority、唯一 bridge、IR traceability、实际
resource/content/implementation evidence，并执行 acceptance gate。它不能
用 IR 改写 Checklist，也不能用旧 checklist/parser、旧 document projection
或 journal self-attestation 补事实。

每一步都保留 Manifest actual-file authority；“切换到 IR”不意味着把实际
资源文件事实搬进 IR。

## 10. 机械 project read isolation

单轨不是 prompt 约定，而是 service 的机械 read-scope contract。扩展现有
`projectReadScope`（或等价的唯一 execution-scoped 模式），让每次 worker
session 在文件打开、目录枚举、native tool 和批量读取前都经过同一个 scope
校验：

```ts
type ExecutionProjectReadScope = Readonly<{
  mode: 'execution'
  allowedRoots: readonly string[]
  deniedRoots: readonly string[]
  contractPacketRefs: readonly string[]
}>
```

必须机械拒绝 `CANONICAL_PROJECT_DOCUMENTS`（八份设计文档及其 aliases）对
Implementation Worker、Implementation Auditor 和 Acceptance 的读取。它们
仍可以读取 service 明确授予的代码、actual resource、Content 输出和验证
证据；IR projection、Checklist bridge 和 Checklist content 以已校验的
contract packet/reference 注入，不通过 filesystem raw-doc 旁路取得。

scope 的固定规则：

- Resource Planner、Resource Curator 和 Game IR packet worker 的 project
  read scope 为空；它们只能消费 service-admitted packet、IR reader 和
  Manifest actual facts；
- Content 只能读取显式 contract `repairPaths`/`readPaths` 和 Manifest actual
  files，不能从 canonical docs 补上下文；
- Atomic Task Planner 使用 IR execution projection、bridge 和 actual joins，
  不获得八份设计文档 scope；
- Implementation Worker/Auditor/Acceptance 可以读被授予的代码/资源/结果，
  但对 canonical docs 是机械 deny；Acceptance 对 Checklist raw Markdown 的
  读取必须经过 Checklist 自己的 authority projection，不是通用 execution
  scope 的例外；
- prompt 中的 “do not read” 只用于指导，不是安全边界；任何 prompt、worker
  type 或关键词绕过 scope 都必须失败并记录诊断。

## 11. 不引入 Comprehensive Reviewer/Revision

权威阶段映射中的 Comprehensive Reviewer/Revision 不因 Game IR cutover 被
隐式新增、恢复或重命名。当前 `implementation-auditor` 仍是
Implementation/Verification consumer，它的输入是 IR evidence contract 和
实际实现证据；它不是 Stage 8 Comprehensive Reviewer，也不承接 Stage 9
Revision loop。

上级权威中的 Stage 8/9 是产品目标阶段，不代表当前仓库已有可迁移实现。
它们必须在未来独立设计、独立 schema version 和独立验收中落地；届时只能
消费本阶段发布的 committed IR/bridge/evidence contract，不能要求 Phase 8
预埋 facade、空状态、兼容 reader 或占位 route。

Foundation Reviewer/Revision 的 stage、state、prompt、issue registry、
recheck 和 READY receipt contract 在本阶段视为 protected surface。任何
需要修改它们的发现都必须作为独立缺陷和独立阶段审计，不能顺手塞入
Phase 8 consumer cutover。

## 12. Failure、retry、recovery 与 obsolete 规则

### 12.1 下游 authority binding 与失效传播

Phase 8 不允许只在入口验证 Game IR、随后让下游收据脱离其 authority。所有
下游 durable contract/receipt 必须保存并重验其直接上游 digest：

- Checklist bridge 绑定 `gameIrReadyReceiptDigest` 和
  `checklistPublicationDigest`；
- Resource plan/inventory 绑定 `gameIrReadyReceiptDigest`、resource projection
  digest、bridge receipt digest 以及
  admitted `ResourceDeliveryBinding` digest；
- Content receipt 绑定当前 inventory epoch、delivery-binding digest 和它实际
  消费的 IR content/resource projection digest；
- Atomic Task Plan 绑定 execution projection digest、bridge receipt digest、
  resource/content join digest，并让每个 task 绑定其 `unitId`；
- Implementation task contract/evidence 绑定 Atomic Task Plan digest、IR unit
  digest 和实际 resource/content inputs；
- Implementation Auditor 与 Acceptance receipt 绑定当前 IR ready、Checklist
  bridge、Atomic Task Plan、resource/content evidence 和 implementation revision
  的 digest closure。

任何 Foundation READY、Game IR publication、Checklist publication/bridge、
resource inventory、Content、Atomic Task Plan 或 implementation revision 变化，
controller 必须从第一个受影响的下游 state 开始机械失效并重新建立 closure；
不得把旧 receipt 继续标记为 ready，不得用 run status、文件存在或 journal
叙事代替 digest binding。失效传播使用现有唯一 DeliveryRun transition/recovery，
不另建 invalidation controller 或第二 journal。

### 12.2 失败与重试

- worker 输出不符合 domain packet/admission：只写诊断，不写 authority；可
  重新 dispatch 同一 compilation identity，不能由 worker 自己改 identity；
- checkpoint write 中断：当前 run-state 保持旧 checkpoint；清理不可见的
  temporary directory 后按同一 authority 重试；
- publication commit 中断：只依据 committed marker 和 manifest digest
  recovery，不能将半目录暴露给 consumer；
- consumer 失败：保留已提交 IR 和 actual evidence，重试同一 execution
  contract；不能回写 IR 或重新读取 docs 改写语义；
- Checklist bridge missing/ambiguous、resource join mismatch 或 evidence
  mismatch：fail closed，阻断后续阶段并保留精确诊断。

重试次数、等待时长、输出大小和 evidence 数量按 case 需要自然变化，不是
业务 admission limit。系统只能因资源/协议实际不可用而报告 attention，不能
用人为计数器把复杂 case 判定为失败。

自动重试以 progress identity 判断，而不是以固定轮数判断。progress identity
至少绑定当前 input digest、diagnostic reason/details digest、candidate digest
（若存在）、checkpoint/journal digest 和 terminal outcome。只要其中任一项发生
实质变化，就继续同一阶段的合法闭环；只有同一 identity 下这些事实全部不变且
系统能证明没有新的合法 transition 时，才可报告 `needs_attention`。provider/
credential/credit 等外部前置不可用可以直接报告其真实诊断，但不得伪装成
candidate failure。

任何 `needs_attention` 都必须把 phase/document step、task/worker identity、
reason code、具体 expected/actual、相关 authority/diagnostic ref 和可执行恢复
动作写入 durable diagnosis，并由 API/UI 原样结构化展示。UI 不得只显示
`Workflow is blocked and needs attention.` 这一句泛化文案；展示层也不得猜测
或改写根因。

### 12.3 恢复与幂等

每次 resume 都通过同一个 run-store/recovery/dispatcher，先 load 并重验
run-state 指向的 checkpoint，再从 Phase 4→7 replay。不得从“上次 worker
回复”、临时变量或旧状态字段继续。

同一 compilation identity 的重复 resume 必须产生同一 checkpoint/publication
digest；并发 resume 只能有一个原子 commit，另一个必须观察到已提交结果并
重新验证，不能产生第二份 publication 或双写 authority。

### 12.4 obsolete schema 与 stale identity

以下状态不可迁移、不可 fallback：

- 非 v46 DeliveryRun 或旧 checkpoint；
- Foundation revision/READY receipt 改变；
- publication/checkpoint 的 task、run、revision、digest 不一致；
- worker 以旧 task、旧 compile request、旧 source Section Index 返回结果；
- 发现旧 docs reader、旧 generic admission 或旧 projection 被调用。

这些情况都进入明确的 obsolete/needs-attention 结果，并要求新 epoch 从
Foundation READY 开始；不能“尽量恢复”而制造混合 authority。

## 13. 静态 no-dual-track gates

在任何真实 workflow 或 Chrome 测试前，必须通过静态和运行时边界门禁：

1. 生产 call graph 只允许以下明确入口：既有 DeliveryRun
   controller/dispatcher/orchestrator 调用 Game IR stage loader/writer；
   publication `prepare`/`commit`/`recover` 各自按既定 authority 合法 replay
   六域 assembler；committed reader 只调用 checkpoint loader、publication
   committed-root validator，以及 Core 已存在的 complete-candidate、source-map
   和 graph strict parsers；七个 consumer 只调用 committed reader。测试可以直接调用这些
   public contracts 做独立验证。除此之外不得出现隐藏 orchestrator、第二
   stage loader、第二 publication reader 或 caller-built closure；assembler
   的合法多入口不构成双轨；
2. Planner、Curator、Content、Atomic Task Planner、Implementation Worker、
   Implementation Auditor、Acceptance 均无 canonical design-doc
   `authorityPaths`、raw-doc reader、旧 prompt 注入或旧 projection import；
3. `readAtomicTaskPlanningDocuments`、generic business admission、旧
   publication candidate/admissions、fallback、compat、migration、legacy
   reader、`dualWrite` 等旧路径在生产代码和迁移目标测试中均不存在；
4. Checklist 只保留 raw Markdown projection，且只有一个 bridge；Checklist
   不 import Game IR publication，Game IR 不写 Checklist；
5. GameIrState 精确匹配第 2.3 节，不含大 authority payload、duplicate
   candidate、module map、journal state 或执行限制字段；
6. production 只存在 `GAME_IR_COMPILATION` 这一条 Foundation READY→现有
   `DOCUMENT_REVIEW + CHECKLIST_DRAFTING`→`DOCUMENT_REVIEW + CHECKLIST_BRIDGE`
   →`RESOURCE_PREPARATION` 路径，禁止
   虚构 `CHECKLIST` phase、旁路、隐藏 phase、旧 phase alias 或第二 controller；
7. resource joins 以 `requirementId` 为根，并继续逐一验证
   `variantId`/`artifactId`/`resourceId`/`filePaths`；一个 requirement 的多
   variant/multi-artifact 不被 flatten、截断或重写；
8. Implementation Auditor 的依赖图证明它不 import Foundation Reviewer/
   Revision，且没有 Comprehensive Reviewer/Revision 实现被重新引入；
9. AST/static scan 不以字符串命中作为唯一证明，同时配合运行时 reader
   identity、tamper、restart、concurrent-resume 和 fail-closed 测试；
10. Phase 8 新增的 Game IR production route、schema、prompt、test fixture 和
    七个迁移 consumer 中都没有 token/time/count 业务执行上限。schema 固有
    cardinality（例如六个固定 canonical module、某类节点要求一个 target 或
    至少一个 evidence）不是任意执行 cap，可以继续由 strict parser 强制。
    对 protected Foundation surface 的既存命中只形成独立审计记录，不能借
    Phase 8 顺手修改 Reviewer/Revision。

## 14. 跨项目测试矩阵

Phase 8 的自动验收必须使用新的 Foundation READY run，而不是被热修改过的
旧 run；至少覆盖以下真实差异：

- 小型规则驱动项目；
- 场景和资源密集项目；
- 数值/公式复杂项目；
- 零或极少外部资源项目；
- 一个 logical requirement 对应多个 realization 和多个 delivery
  artifacts 的项目。

每个 fixture 都从 READY 进入 `GAME_IR_COMPILATION`，验证：

- checkpoint 原子写入、重启恢复、并发 resume 和 digest 重算；
- 六域 complete candidate、publication reader、source-map/graph closure；
- Checklist bridge 的精确、missing、ambiguous、duplicate failure；
- Resource Planner/Curator 的 requirementId join 和多 artifact preservation；
- Atomic Task Planner 不改变 ownedPaths/depends-on；
- Content、Implementation、Auditor、Acceptance 只走唯一 reader；
- 一个仅存在于测试 harness 的 `enabled/disabled` isolation switch 对
  Foundation Reviewer/Revision 产生相同的 tasks、Issue Registry、patch
  packets、targeted recheck 和 READY receipt；该 switch 不能编译进生产
  DeliveryRun、controller、prompt 或 fallback path；
- 失败后恢复不会生成第二 publication、第二 authority 或旧 docs 旁路。

Token、duration、task count、retry reason、artifact bytes 和 recovery count
只做跨项目实际比较和诊断记录，不能成为通过/失败的固定阈值。

## 15. Phase 9 Chrome 前置条件

只有同时满足以下条件才允许进入 Phase 9 Chrome 验收：

- v46 schema、stage transition、checkpoint writer/loader、publication reader
  的单元/集成/恢复测试全绿；
- 七个 consumer 的 single-reader、no-dual-track、resource join、Checklist
  bridge 和 protected Foundation gates 全绿；
- 上述跨项目矩阵通过，且至少两个不同类型的新项目已从 READY 自动跑通；
- worktree 中代码、测试、schema、文档一致并已形成独立提交；
- 没有 `Workflow is blocked and needs attention` 未解释诊断，没有 stale
  worker、obsolete checkpoint 或遗留 temporary publication；
- Chrome 只打开新 run，从 Idea 重新开始，不恢复 schema 热修改期间产生的
  历史 run；
- Chrome 真实验收中首次出现错误时保留完整 UI、server、worker、run-store
  和 publication 日志并停止热修改；先形成根因和独立修订，再重新开 fresh
  run。

Phase 9 的 Chrome 运行不属于 Phase 8 设计的“测试通过”证明；它是生产路由和
多项目环境的最后验收。

## 16. 完成标准

Phase 8 只有在以下事实同时成立时才算完成：

- v46 strict DeliveryRun 只有一条 READY→`GAME_IR_COMPILATION`→现有
  `DOCUMENT_REVIEW + CHECKLIST_DRAFTING`→`DOCUMENT_REVIEW + CHECKLIST_BRIDGE`
  →`RESOURCE_PREPARATION` 状态路径；
- `gameIrState` 只保存外部索引，checkpoint authority 不在 snapshot 双写；
- 一个 writer/loader 完成原子写入、Phase 4→7 replay、恢复和幂等；
- committed reader 只接受 run-state READY authority，能重建并验证六域
  complete candidate、manifest、source-map 和 graph；
- Checklist 仍是 raw Markdown authority，只有一个 durable、fail-closed semantic
  bridge，且资源阶段不能绕过其 admitted receipt；
- resource projection 完整表达 requirement→variants→multi-artifacts→constraints，
  actual Manifest facts 按 requirementId 根 join 后逐 artifact 验证；
- Atomic Task Planner 不再读取八份文档、不重写 unit ownership/dependencies；
- Planner、Curator、Content、Atomic Task Planner、Implementation Worker、
  Implementation Auditor、Acceptance 已按顺序完成原子单轨切换，旧 reader/
  prompts/authorityPaths 已在同一提交删除；
- 没有 Comprehensive Reviewer/Revision 新旧轨道，Foundation Reviewer/
  Revision 零改动、零依赖；
- 下游 receipt 全部绑定当前 IR/bridge/resource/content/task/implementation digest
  closure，authority 变化会机械失效受影响的下游状态；
- failure/retry/recovery/obsolete、static boundary 和跨项目测试全绿；
- 没有任意固定 token、时间或数量业务执行限制（schema 固有 cardinality
  仍然有效）；
- Phase 9 Chrome 前置条件全部满足。

## 17. 执行纪律

- 本文只定义 Phase 8 的生产切换设计；implementation plan 必须另行产生并
  逐 consumer 独立审计；
- 每个 consumer 一个切换提交，先加唯一 reader 的 RED test，再在同一提交
  删除旧路径并通过 GREEN/static/recovery gates；
- 任意发现的旧逻辑、双轨、兼容或冗余路径必须物理删除，不通过 unreachable
  wrapper 或特殊关键词打补丁维持；
- 任何超出本阶段边界的 Foundation、Checklist 内容 authority 或
  Comprehensive Reviewer/Revision 修改必须停止并另立阶段；
- 不在真实 workflow 运行期间热修改 schema、reader 或 recovery；
- 只有所有 Phase 8 gate 通过后，才进入 Phase 9 Chrome fresh workflow。
