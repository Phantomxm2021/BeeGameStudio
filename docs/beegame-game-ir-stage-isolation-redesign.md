# Bee Game Studio Stage Isolation and Game IR Redesign

状态：历史领域设计；已有实现但符合性审计未通过，须先整改，再接入当前独立模块。

2026-09-07 修订：当前接入以 [Game IR 回收、适配与接入计划](game-ir-module-implementation-plan-2026-09-07.md) 为准。六域及编译基础已有实现，最新 stateless semantic slices 与 obligation preflight 位于 `codex/game-ir-packet-once-evaluation`；不重新执行本文从 Core 到六域的历史开发阶段。本文保留领域语义参考；旧 Stage 编号、私有 READY adapter 和 DeliveryRun 控制方式不代表当前公开模块合同，不据此恢复或改动已验收 Foundation 私有实现。最新编译协议与源码来源见新计划 §1.1。

日期：2026-08-30

## 1. 目的

本设计修复 Game IR 接入期间发生的阶段越界，并定义 Bee Game Studio 真正需要的 Game IR。

目标同时包含两部分：

1. 恢复已经稳定的 Stage 3 Foundation Reviewer 与 Stage 4 Foundation Revision，使它们不依赖 Game IR 的 schema、parser、state 或 publication。
2. 将当前偏向 Document Binding Manifest 的实现重构为独立 Stage 5 Game IR，使其能够表达玩法、数值、场景、表现、资源实现、实现目标与验收追踪。

本设计不通过兼容层、fallback 或新旧双跑完成切换。当前错误耦合必须删除，正确基础设施按明确边界回收。

## 2. 已确认的根因

Game IR 原本应当位于 Foundation READY 之后，但接入方案错误地规定 Stage 3 与 Game IR 共享 typed owner parser，并将 Reviewer 内部 Fact Store 视为与 Game IR 冲突的第二事实轨道。

该判断混淆了两类概念：

- 业务 authority：可决定和修订产品事实的唯一来源；
- 阶段派生证据：特定阶段为了完成职责而生成的只读、revision-bound 中间表示。

Foundation 文档是唯一可编辑业务 authority。Reviewer Fact Store 是 Stage 3 内部审计证据；Game IR 是 Stage 5 下游执行投影。它们不竞争 authority，因此并非双轨。

错误判断造成以下越界：

- 删除稳定的 Foundation Fact、Contract、Rule 和 Check 实现；
- 以 typed owner records 替换 Stage 3 deterministic review；
- 删除 revision impact 中的 fact/contract/check dependency；
- 在 Stage 4 revision terminal 后执行 Game IR typed admission；
- 允许 Stage 5 的 schema/compiler 问题反向伪装为 Foundation 业务 Issue；
- 在运行中的真实 workflow 上热切换 schema 和恢复逻辑。

## 3. 双轨的唯一判定标准

双轨只在同一阶段、同一职责、同一 authority 边界内判定。

以下属于双轨，必须删除：

- 同一 Stage 同时存在 legacy 与 current 状态机；
- 同一输入可能进入两个 reader、compiler、reviewer、writer 或 recovery；
- 同一 canonical 产物存在两个 writer 或两个 READY authority；
- 新路径失败后 fallback 到旧路径；
- 旧 schema reader、迁移 reader 与当前 strict reader 同时可达；
- 同一 task 存在两套 dispatch、retry 或 resume 逻辑；
- 新旧字段双写，或下游可任选 Docs/IR 两种业务读取路径。

以下不属于双轨：

- Stage 3 使用内部 Fact Store，Stage 5 使用 Game IR；
- 不同阶段分别持有自己的 revision-bound receipt；
- 同一 canonical document 被不同下游阶段以只读方式消费；
- 不同 compiler pass 负责预先声明且互不重叠的字段集合，并汇入同一 Game IR candidate。

## 4. 阶段边界

```text
Stage 1  Idea / Confirmed Brief
Stage 2  Eight Foundation Documents / Document Admission
Stage 3  Foundation Reviewer
Stage 4  Foundation Revision
Stage 5  Game IR Compile / Admission / Publication
Stage 6  Acceptance Checklist
Stage 7  Resource / Content Gate
Stage 8  Comprehensive Reviewer
Stage 9  Comprehensive Revision
Stage 10 Implementation / Acceptance
```

### 4.1 Stage 2

Stage 2 负责生成并提交八份非空 raw Markdown 文档，只处理 provider、唯一写入路径、权限、持久化 receipt/digest 与 upstream projection 稳定性；不承担正文结构、格式、内容或质量 admission。

文档合同要求的标题、章节、表格、ID、字段、引用语法、重复与质量全部由 Stage 3 Reviewer 审计，并由 Stage 4 Revision 修复；Stage 2 不因这些正文特征拒绝或重试。现有 typed blocks 必须逐项审计：人类文档本身需要的 canonical owner table 可以保留；只为浅层 IR 服务的重复表必须删除或由 Stage 5 semantic compilation 替代。

### 4.2 Stage 3

Stage 3 只消费 canonical Foundation documents、Confirmed Brief 与自身固定审计合同。它可以使用 Fact Store、deterministic contracts、semantic packets 和 Issue Registry，但不得 import、读取或判断 Game IR。

在启用或禁用 Stage 5 的情况下，相同输入必须产生相同 Stage 3 tasks、Issue Registry 和 READY 判断。

### 4.3 Stage 4

Stage 4 只消费 Stage 3 发布的唯一 Issue Registry，通过唯一 Patch、Targeted Recheck 和 publication 闭环修订 Foundation documents。

Stage 4 的合法性不由 Game IR parser 判定。Game IR 的 compiler/schema/publication 错误不得成为 revision terminal admission 条件。

### 4.4 Stage 5

Stage 5 只消费 Foundation READY receipt 及其精确绑定的八文档。它产生一个 strict、revision-bound、不可编辑的 Game IR publication。

Stage 5 不能修改 Foundation documents、Issue Registry 或 foundationAuditState。业务缺陷只能通过外层 workflow 接口返回标准化 defect report；Stage 5 本身不得调用 Stage 3/4 内部实现。

Game IR 是下游执行 authority，但不是新的产品决策 authority。任何无法从 READY Foundation evidence 唯一支持的语义映射都必须判为 unresolved，而不是由 compiler 在多个合理解释中任意选择。

## 5. 唯一阶段接口

### 5.1 FoundationReadyReceipt

Stage 4 的唯一输出边界必须绑定：

- Foundation revision；
- 八份 canonical document path/digest；
- Section Index path/digest；
- Reviewer READY digest；
- 空 Issue Registry digest；
- publication authority digest。

### 5.2 GameIrCompileRequest

Stage 5 的唯一输入包含：

- 完整 FoundationReadyReceipt；
- 同 revision canonical document bytes；
- Game IR schema version；
- compile task ID；
- publication ID。

Stage 5 不接受旧 IR、Checklist、Manifest、实现代码、worker prose 或失败 candidate 作为业务输入。

### 5.3 FoundationDefectReport

当且仅当 Stage 5 能证明 READY 文档仍存在真实业务缺失、冲突或无法决定的 owner fact 时，输出 FoundationDefectReport：

- reasonCode；
- expected；
- actual；
- source document/section/digest；
- 唯一 owner target document/section；
- supporting source bindings；
- compile task 与 Foundation revision identity。

FoundationDefectReport 不携带 Patch，不直接写 Issue Registry。外层 workflow controller 负责验证身份并调用 Stage 3/4 已有的标准 Issue admission 接口。

### 5.4 GameIrReadyReceipt

Stage 5 的唯一 READY 输出绑定：

- Foundation revision/authority digest；
- Game IR schema version；
- manifest digest；
- module digests；
- source-map digests；
- dependency-graph digest；
- COMMITTED publication receipt。

## 6. 错误分类

| 类别 | 示例 | 处理 |
|---|---|---|
| Foundation business defect | 文档缺少实现玩法所必需的状态转换条件 | 输出 FoundationDefectReport，由外层重新进入原 Stage 3/4 闭环 |
| Game IR candidate invalid | worker 输出未知字段、重复 ID、悬空引用 | 丢弃 candidate，在同一 Stage 5 task 内自动重建 |
| Compiler defect | schema 与 compiler 不一致、producer 写入非授权字段 | Stage 5 integrity failure；修复代码，不修订文档 |
| Publication/recovery failure | PREPARED 后进程中断 | 使用唯一 journal roll-forward/reconcile |
| Stale authority | Foundation revision 或任一 document digest 改变 | 丢弃 candidate，等待匹配的新 READY receipt |
| External prerequisite | 模型、凭据或 credits 确实不可用 | needs_action，并显示真实原因 |
| Proven no progress | 相同输入、诊断、candidate/journal/terminal 均无变化 | needs_action；不得用固定 attempt、Token 或时间推断 |

普通 provider、receipt、callback 或 candidate admission 失败留在 Stage 5 自动恢复，不进入 Foundation Issue Registry。

## 7. Game IR 产品定义

当前 typed-record manifest 只作为 Identity/Source Binding 基础层，不再被视为完整 Game IR。

### 7.1 Core

每个节点至少具有：

- canonical node ID；
- kind；
- module；
- owner 或 derived 分类；
- typed references；
- source bindings；
- dependency edges；
- Foundation revision；
- compile provenance。

每个 owner-bearing 叶字段、identity、reference 和 relationship edge 必须具有且只有一个 Source Binding。每个 derived 字段必须声明 derivation rule 和完整输入引用。

### 7.2 Gameplay

必须能表达：

- entity；
- component/capability；
- action；
- rule；
- condition；
- effect；
- event；
- state；
- transition；
- objective；
- win/loss outcome。

规则不能只保存名称。条件、效果、触发事件和目标必须形成可引用结构。

### 7.3 Balance

必须能表达：

- variable/parameter；
- typed unit；
- formula expression AST；
- formula dependency；
- min/max/bounds；
- economy source/sink；
- progression curve；
- reward/cost binding。

公式必须可校验和重算，不能只保留公式名称或输入 ID。

### 7.4 World / Scene

必须能表达：

- scene；
- scene node hierarchy；
- spatial transform/zone；
- runtime entity instance；
- route；
- spawn point；
- encounter；
- checkpoint；
- camera region；
- objective placement。

Scene graph 必须拒绝悬空 parent、循环 parent、重复 instance 和无法闭合的 route。

### 7.5 Presentation

必须能表达：

- UI screen/state/action；
- feedback binding；
- camera behavior；
- animation clip/state；
- VFX cue；
- audio event/cue；
- music state；
- presentation transition。

Animation、VFX、Audio 和 UI 表现必须绑定 gameplay event/state/action，而不是只保存独立文件名。

### 7.6 Resource Realization

资源使用三层模型：

```text
Logical Requirement
    -> Realization Variant
        -> Delivery Artifact(s)
```

覆盖 model、mesh、material、texture、rig、animation、audio、music、VFX、shader、UI asset、font、scene/prefab 和 content/config artifact。

一个 logical resource 可以对应多个 variant；一个 variant 可以对应多个 delivery file。每个 artifact 独立声明 path、format、codec、技术约束、预算和 runtime role。

### 7.7 Implementation / Verification

必须能表达：

- implementation target；
- system/module ownership；
- dependency；
- required IR nodes；
- acceptance scenario；
- invariant；
- required test/evidence。

## 8. 编译模型

Game IR 使用两个互不重叠的 producer pass，并由一个 admission/publication authority 汇总。

### 8.1 Mechanical Producer

只负责 schema 明确声明可机械读取的字段，例如 ID、数字、枚举、路径、明确表格行和引用。

### 8.2 Semantic Producer

只负责 schema 明确声明需要语义编译的字段，例如 condition/effect、rule relation、scene instance relation 和 gameplay-to-presentation binding。

Semantic Producer 必须：

- 只读取 request 指定的完整 READY Sections；
- 输出 strict candidate；
- 为每个字段提供 Source Binding；
- 不发明默认值；
- 不确定时输出 unresolved diagnostic；
- 不写文档、IR publication 或 workflow state。

### 8.3 唯一 producer 规则

Game IR schema 为每个字段声明唯一 producerMode：mechanical、semantic 或 derived。不同 pass 不能生成同一字段，不能互相 fallback，也不能在失败时读取旧 IR 填补。

### 8.4 Semantic Projection Validator

Semantic Producer 只有 candidate 写权限。独立的只读 Semantic Projection Validator 按 module 检查 candidate 是否忠实、完整且没有超出 source evidence；它只能返回 PASS 或结构化 compiler diagnostic，不能修改 candidate、文档或业务 Issue。

同一 input 支持两个不同且无法机械区分的合法映射时，Validator 必须返回 ambiguity diagnostic，并由 Stage 5 输出 FoundationDefectReport。不得用模型偏好、默认值或首次成功输出选择业务含义。

Compiler 是唯一 candidate writer，Validator 是只读 admission，因此二者不是双写或双轨。

### 8.5 Admission

服务端统一校验：

- exact schema；
- ID/reference closure；
- Source Binding 完整性；
- semantic projection fidelity；
- derived input closure；
- formula graph；
- state graph；
- scene hierarchy；
- resource realization；
- cross-module invariants；
- canonical ordering；
- revision/digest binding。

## 9. 现有实现回收规则

### 9.1 默认保留候选

- canonical encoding/digest；
- Source Binding 基础类型；
- dependency graph；
- staging/journal/atomic publication；
- COMMITTED marker；
- stale authority rejection；
- canonical ID/reference 工具；
- resource one-to-many delivery projection；
- resource authority binding；
- recovery cut-point tests。

保留仍需通过边界与模型审计，不能按文件整体搬运。

### 9.2 需要适配

- 当前九模块 schema；
- typed record compiler；
- Checklist ID binding；
- resource projection；
- Manifest authority binding。

### 9.3 默认删除

- typed owner Stage 3 replacement；
- Foundation Fact/Contract/Rule 删除相关改动；
- Stage 4 Game IR parser admission；
- Game IR 对 foundationAuditState/Issue Registry 的直接写入；
- legacy reader、fallback、双写、热迁移；
- 为单一测试案例增加的关键词、路径、格式或项目特例。

### 9.4 Reprove 规则

Game IR 开发期间加入的 Reviewer/Revision 修复默认不移植。只有在稳定 Stage 3/4 基线上使用独立测试复现后，才能作为单独缺陷修复，并单独审计、提交。

## 10. 实施阶段

### Phase 0：现场隔离

- 保留当前 dirty worktree；
- 从 `e759744a` 创建独立 branch/worktree；
- 生成 KEEP/ADAPT/REWRITE/DISCARD/REPROVE 回收矩阵。

### Phase 1：权威文档修订

- 修订 Foundation 审计权威中的 Stage 3/4/5 边界；
- 替换现有 Game IR 方案的错误共享-parser/删除-Fact-Store前提；
- 完成文档自审和用户确认。

### Phase 2：Reviewer/Revision 恢复

- 恢复稳定 Foundation Fact/Contract/Rule/Check；
- 恢复 impact analysis、Patch validation、targeted recheck；
- 加入 Game IR enabled/disabled parity test；
- 加入 import boundary test。

### Phase 3：Stage 5 独立 Core

- 定义四个阶段接口；
- 落地 Core schema、state、admission、publication 和 recovery；
- 不实现 consumer migration。

### Phase 4：Gameplay + Balance

- 落地行为、状态、规则、事件、公式和数值依赖；
- 验证 source coverage 和 graph closure。

### Phase 5：World + Presentation

- 落地 scene graph、instances、routes、encounters、UI、Audio、Animation 和 VFX binding。

### Phase 6：Resource Realization

- 落地 logical requirement、variant、delivery artifacts 与 runtime binding；
- 支持一资源多文件；
- 验证技术约束和 budget。

### Phase 7：Implementation + Verification

- 落地 implementation target、dependency、acceptance scenario、invariant 和 evidence trace。

### Phase 8：Consumer 单轨迁移

按 Resource Delivery、Game Content Package、Target Implementation、Acceptance 顺序逐个迁移。Resource Delivery 必须先发布真实资源与 Manifest，Game Content 才能引用真实资源生成 Scene/UI 等配置。每个 consumer 在同一提交中切换唯一 reader 并删除旧 reader，不保留固定多 Agent 分工、Atomic Planner、实现后独立 Auditor、fallback 或双写。

Checklist 继续以 READY Foundation raw Markdown projection 为内容 authority；Game IR 只提供稳定 ID traceability，不重写 Checklist 业务内容。

### Phase 9：真实验收

- 自动测试全部通过后再启动 Chrome；
- 不恢复经过热 schema 修改的旧 run；
- 使用至少两个不同类型的新项目从 Idea 开始验收；
- 首个真实错误出现时保留完整日志并停止热修改。

## 11. 测试策略

### 11.1 Reviewer 非回归

相同文档在 Game IR enabled/disabled 下必须产生完全相同的 Stage 3 tasks、Issue Registry、Stage 4 Patch packets、Targeted Recheck 和 Foundation READY receipt。

### 11.2 架构边界

- Foundation Reviewer/Revision 模块不得 import Game IR；
- Game IR 只接受 FoundationReadyReceipt；
- Stage 5 不得修改 canonical documents；
- Stage 5 integrity failure 不得进入 Issue Registry；
- FoundationDefectReport 只能经外层 adapter 入场。

### 11.3 跨项目 fixtures

至少覆盖：

- 小型规则驱动项目；
- 场景/资源密集项目；
- 数值复杂项目；
- 零或极少外部资源项目；
- 一资源多交付文件项目。

### 11.4 属性与变异测试

覆盖 ID/reference closure、formula cycles、state dead ends、scene parent cycles、missing source binding、stale revision、path/format mismatch、multi-artifact resources、publication interruption、recovery replay、duplicate dispatch 和 concurrent resume。

### 11.5 真实 Chrome 验收

至少两个不同项目从零运行。记录实际 Token、duration、task count、retry reason、artifact bytes 和 recovery count；它们只用于比较，不构成业务上限。

## 12. Cutover

- 新 Stage 5 使用唯一新 schema version；
- 不实现 legacy reader、migration reader、fallback 或双写；
- 旧 run 保留为历史证据，但不在新代码下恢复；
- 只有新 run 从 Foundation READY 进入新 Stage 5；
- consumer 切换与旧 reader 删除必须发生在同一提交。

## 13. 完成标准

只有同时满足以下条件才算完成：

- Stage 3/4 恢复稳定行为；
- Foundation Reviewer/Revision 对 Game IR 零依赖；
- 每个阶段只有一条状态机、reader、writer 和 recovery；
- 无 legacy、fallback、兼容 reader 或双写；
- Game IR 覆盖 Gameplay、Balance、World、Presentation、Resource Realization、Implementation 和 Verification；
- 每个 owner-bearing IR 字段具有唯一 Source Binding；
- 一个 logical resource 支持多个 realization 和 delivery artifacts；
- Reviewer 非回归矩阵通过；
- Game IR 属性、恢复和跨项目测试通过；
- 至少两个不同项目通过从零 Chrome 验收；
- 权威文档、实现和测试一致；
- 错误架构代码已物理删除，而不是保留为不可达残留。

## 14. 执行纪律

- 每个 Phase 独立审计和提交；
- 一个 Phase 未通过，不进入下一 Phase；
- 实现任务可由 Luna high 执行，主 Agent 使用 Sol 审计边界、正确性、双轨和纠偏；
- 不在真实 workflow 运行期间热修改 schema；
- 不按案例关键词修复；
- 不设置固定业务 attempt、Token、时间、实体数、关系数或文件数上限；
- 不因为已有投入而保留错误耦合。
