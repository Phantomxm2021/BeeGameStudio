# Bee Game Studio Stage Isolation and Game IR Redesign

状态：设计已确认；Phase 3 Core 已完成；Phase 4（Gameplay + Balance）implementation 与 automated verification 已完成，independent Task 7 review clean，已 accepted；Phase 5–9 尚未开始。完整 candidate publication 与 Chrome acceptance 仍不可用

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

Stage 2 负责生成八份完整 raw Markdown 文档并完成文档自身的结构 admission。

Stage 2 可以校验文档合同已经明确要求的表格、ID、字段和引用语法，但不得为了当前 Game IR 实现强迫文档增加机器专用、重复或对读者无价值的结构。现有 typed blocks 必须逐项审计：人类文档本身需要的 canonical owner table 可以保留；只为浅层 IR 服务的重复表必须删除或由 Stage 5 semantic compilation 替代。

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

Foundation READY 的唯一交接边界必须绑定：

- Foundation revision；
- 八份 canonical document path/digest；
- Section Index path/digest；
- 空 Issue Registry digest；
- 唯一 READY authority variant：初审直接 READY 使用 `review` 与 review digest；修订后 READY 使用 `revision_publication` 与 committed publication authority digest/base revision；
- 对完整 receipt canonical bytes 计算的 Foundation ready receipt digest。

两种 authority variant 是同一 READY 接口的互斥来源类型，不是两条运行轨道。一个 receipt 只能携带其中一种，不能同时携带、fallback 或相互转换。

### 5.2 GameIrCompileRequest

Stage 5 的唯一输入包含：

- 完整 FoundationReadyReceipt；
- 同 revision canonical document bytes；
- Game IR schema version；
- compile task ID；
- publication ID。

Phase 4 的 domain source envelope 同时携带 READY-bound canonical full
`authoritySectionIndex` 与 fixed-manifest selected `sectionIndex`。Foundation
Section Index digest authenticates the complete section set and content; the
shared `canonicalizeGameIrSourceSections` helper is the sole Game IR source-order
authority. Each selected section is accompanied by exact UTF-8 bytes whose digest
matches the authority entry. Gameplay uses GDD sections; Balance uses GDD and
Balance sections, while both retain the same complete authority index.

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

Validator 不接受可重新贴 task/revision 身份的 detached module。服务端 packet 必须绑定完整 admitted candidate、compile request、Foundation READY receipt、完整 Section Index 及所选 module 使用的精确 Markdown section bytes；section bytes 必须机械匹配 Section Index digest。固定 validator manifest 定义 V1 canonical modules、每个 module 的必检项和 service-owned `sourceDocumentPaths`。必读 source scope 是 manifest 指定文档的全部 Section Index entries 与 candidate 额外 owner bindings 的并集，不能由 candidate 单独反推；caller 必须提供该并集的精确 Markdown bytes，不能多也不能少。PASS 必须返回完整、唯一、有序的 coverage receipt。仅有 packet digest 回显的布尔 PASS 不构成 admission evidence。

V1 canonical modules 为 core、gameplay、balance、world-scene、presentation、resource-realization 与 implementation-verification。模块不得缺失或为空。诊断 evidence pointer 优先精确到 owner Source Binding 的 document、section 与 sourcePointer；当诊断的正是 missing/ambiguous projection、尚不存在 binding 时，允许使用带 section digest 的 immutable `section:<document>#<section>@<digest>` pointer。裸 document/section identity 不可入场。

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

### 8.6 Publication / Recovery

Publication 的唯一输入是外部可重建的 `GameIrPublicationAuthority`：compile request、完整 candidate、receipt-bound Section Index，以及七个 canonical module 各自的真实 semantic packet 与 admitted PASS result。Publisher 必须重新执行 candidate 与 semantic admission；不能接受 digest-only PASS、detached module、字段 alias 或 caller 自报的 task/revision。

服务端从该 authority 纯函数重建 module、source map、dependency graph、manifest、semantic evidence 与 COMMITTED marker 的全部 canonical bytes。Journal 只记录预期 authority/digest，不构成新的 authority；recovery 与 committed validation 必须重新接收外部 authority 并逐字节比较重建结果，不能让 journal、staging 或 final artifacts 循环自证。Publication ID 不得复用，PREPARED journal 在 READY 后作为 immutable audit evidence 保留，不执行存在 check/unlink 竞态的事后删除。

最终 revision 目录使用完整目录原子切换：先写 PREPARED journal，在私有 staging 中补齐并验证全部文件，最后写 staging/COMMITTED.json，再把整个非空 staging 目录原子 rename 到此前不存在的 final revision 路径。不得逐文件写入或覆盖可见 final 目录。并发赢家只有在 exact external authority 校验一致时才可作为幂等成功；否则 fail closed。

所有 workspace 下的既有路径组件必须拒绝已存 symlink 与非目录，revision/publication segment 必须在任何写入前通过安全校验。Journal 与 staging artifact 使用临时文件写入、同步和原子 rename，partial temp 只能被同一 external authority 的 recovery 丢弃重建。恢复可以补齐缺失的 expected staging bytes，但必须拒绝 unexpected 或 conflicting bytes；final READY 只由完整、外部 authority 一致的 COMMITTED publication 表示。

该边界协调所有遵守同一协议的 Bee Game 进程，并在每次 validation 检测 workspace divergence；不宣称 Node/Bun path API 能阻止同权限恶意进程在两个 syscall 之间替换父目录。运行时没有可移植的 directory-fd/openat 能力，而同权限进程本来也能直接改写应用代码和 committed output。若未来威胁模型要求抵御此类本机攻击，应由宿主 sandbox 或单独审计的 native filesystem broker 提供，不在 Game IR 业务代码中伪造保证。

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

### Phase 3：Stage 5 独立 Core（已完成；production routing 仍不可达）

- 已定义四个阶段接口；
- 已落地 strict contracts、Foundation READY adapter、Core model、semantic admission、publication、recovery 和 parity；
- 不实现 consumer migration，production routing 仍不可达。

### Phase 4：Gameplay + Balance（implementation/automated verification complete；independent Task 7 review clean；已 accepted）

Implementation and automated verification are complete, and the independent
Task 7 review is clean; Phase 4 is accepted. Production routing remains
unreachable.

- Gameplay 与 Balance 领域 schema、semantic admission、精确 source envelope
  和 immutable module projections 已落地；两者使用同一 READY-bound authority
  并分别保持 fixed source closure。
- Gameplay 可读取 typed Balance variable/formula target；Balance reward/cost
  binding 可指向 typed Gameplay action/event。双向引用、wrong kind、stale
  task/revision、deterministic bytes/digests 与 not-yet-implemented module
  rejection 均由 gate tests 覆盖。
- Balance 当前 variable/table contract 的 mechanical output 为空；variable
  records、formula AST、economy/progression/reward/cost semantics 由 semantic
  producer 拥有，Balance source claims 使用精确 `/bytes/<start>/<end>` ranges
  并在 admission 时按 UTF-8 bytes 复核。空 mechanical output 是当前 policy，
  不是 fallback。
- AST/static detector 对新增 production files 禁止 partial candidate、
  publication、controller/store/DeliveryRun/Foundation Issue、provider
  dispatch 和五个 placeholder module；protected 21-file parity 与 full
  server unreachable scan 保持通过。
- Complete seven-module candidate、publication routing、Chrome acceptance
  remain unavailable；Phase 5–9 remain unstarted。

### Phase 5：World + Presentation（未开始）

- 落地 scene graph、instances、routes、encounters、UI、Audio、Animation 和 VFX binding。

### Phase 6：Resource Realization（未开始）

- 落地 logical requirement、variant、delivery artifacts 与 runtime binding；
- 支持一资源多文件；
- 验证技术约束和 budget。

### Phase 7：Implementation + Verification（未开始）

- 落地 implementation target、dependency、acceptance scenario、invariant 和 evidence trace。

### Phase 8：Consumer 单轨迁移（未开始）

按 Resource Planner、Resource Curator、Content、Implementation、Comprehensive Reviewer、Acceptance 顺序逐个迁移。每个 consumer 在同一提交中切换唯一 reader 并删除旧 reader，不保留 fallback 或双写。

Checklist 继续以 READY Foundation raw Markdown projection 为内容 authority；Game IR 只提供稳定 ID traceability，不重写 Checklist 业务内容。

### Phase 9：真实验收（未开始）

- 自动测试全部通过后再启动 Chrome；
- 不恢复经过热 schema 修改的旧 run；
- 使用至少两个不同类型的新项目从 Idea 开始验收；
- 首个真实错误出现时保留完整日志并停止热修改。

## 11. 测试策略

### 11.1 Reviewer 非回归

相同文档在 Game IR enabled/disabled 下必须产生完全相同的 Stage 3 tasks、Issue Registry、Stage 4 Patch packets、Targeted Recheck 和 Foundation READY receipt。

Core Phase 已实现 strict contracts、Foundation READY adapter、Core model、semantic admission、publication、recovery 和 parity；Phase 4 的 Gameplay 与 Balance isolated projections、domain producer/assembler gates 已实现并通过 automated verification。World/Scene、Presentation、Resource Realization、Implementation/Verification 的领域 producer 仍未实现。因此此处 enabled 仅表示在 READY 后调用只读 receipt/compile-request boundary；production routing 仍不可达，不得为了 parity 伪造七个同构 placeholder candidate。测试必须使用现有完整八文档 fixture 和真实 Foundation fact/semantic/revision planning API，在边界调用前后重新序列化同一 documents/state 并重跑规划。完整 seven-module candidate parity 与 publication 要等 Phase 5–7 的其余领域模块落地后再开始；Phase 8–9 分别负责 consumer migration 与真实验收。

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
