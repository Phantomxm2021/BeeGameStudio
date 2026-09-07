# Game IR 既有实现回收、独立模块适配与接入计划

日期：2026-09-07（依据规划符合性审计再次修订）。状态：既有 IR 是待整改、补证及重新验收的复用候选，不是“完整实现、只差接入”。当前 Foundation 独立模块工作树尚未接入。本文整改、迁入和接入任务均未执行。

依据：用户确认 Game IR 位于 Foundation 通过并完成发布之后、Checklist 之前；沿用独立阶段模块和平台能力解耦方向。本次只修改规划，不授权启动服务、真实模型、计费、既有项目恢复、代码实施、提交或部署。

相关文档：

- [独立阶段主计划](independent-stage-programs-plan-2026-09-05.md)
- [平台能力解耦提案](stage-platform-decoupling-architecture-2026-09-07.md)
- [早期 Game IR 领域设计](beegame-game-ir-stage-isolation-redesign.md)
- [最新 Foundation 真实闭环](foundation-multisource-evidence-2026-09-07.md)

本文同时纠正“从零重新实现”与“已有实现只差接入”两种错误前提。复用六域结构、编译和发布基础，但必须先关闭已复现的规划偏差，再适配当前架构；不通过缩减规划能力、放宽校验或直接勾选旧测试来完成整改。旧阶段编号、私有 Foundation READY 适配和 DeliveryRun v46/v49 等历史接线不能直接移入当前独立模块架构。

## 1. 插入位置与当前基线

目标顺序：Foundation Author → Reviewer/Revision 闭环 → 通过文档发布与接纳 → Game IR → Checklist → 资源准备 → 任务规划 → 实现/审计 → 验收 → 交付。

当前三个 Foundation 模块已接入公开生命周期，真实闭环已到达 `acceptedReview.kind=passed`、零问题与八份规范文档摘要一致的停点。`foundation-review-link.ts` 先调用 `publishFoundationAcceptedArtifacts`，再记录 `acceptedReview`；此处是 Game IR 新公开交接的前置边界。当前 `game-ir-isolation-recovery` 工作树没有 IR 源码或路由，但兄弟工作树已有领域实现及旧编排接线；缺少的是适配当前架构并验收后的公开模块，而不是整套 IR。

- 不接 Author 初稿、Revision 未通过候选或“文件已存在”信号。
- 不把 Game IR 塞进 Author、Reviewer 或 Revision；不要求它们导入 IR schema/compiler。
- 现有人工交接停点暂不改变；只有 IR 模块验收与编排接线获准后，才调整后续进入条件。是否保留人工确认在 IR-0 明确，不默认自动推进。
- P5.0 新增 Game IR，P5.1 Checklist 依赖它；其余编号不改。

### 1.1 已核实的代码与文档来源

初次盘点之后已完成只读规划符合性审计与离线重跑，结果见 §1.3。以下 commit 为审计基线；实施前 IR-0 固定文件清单和摘要，不能直接追随移动分支。

| 来源 | 已观察事实 | 本次定位 |
| --- | --- | --- |
| `codex/game-ir-stage-isolation` @ `b47641f33` | `delivery-workflow/game-ir/` 已有 Core、六域 schema/producer/assembler、admission、publication、checkpoint、committed reader；外层已有 IR route | 历史实现及领域设计来源；不是新的零实现起点 |
| `codex/game-ir-packet-once-evaluation` @ `4335363b2` | 在前者之上已有 stateless slices、JSONL、记录级 journal、source authority、obligation preflight 与相应集成测试 | 优先回收候选。分支名字虽含 packet-once，最新设计已明确废弃 session reuse |
| 当前 `codex/game-ir-isolation-recovery` @ `71507fb5e` + 当前未提交工作 | 当前已验收 Foundation 独立模块与公开编排；不含上述 IR 目录 | 唯一接入目标；保留当前未提交成果，不用旧分支覆盖 |

来源工作树均位于当前工作树的同级目录。权威参考按职责使用：

- [IR 总体领域设计](../../game-ir-packet-once-evaluation/docs/beegame-game-ir-stage-isolation-redesign.md)：六域语义、来源、唯一 producer 和 authority 边界。
- [Phase 8 生产切换计划](../../game-ir-packet-once-evaluation/docs/superpowers/plans/2026-09-01-game-ir-production-cutover.md)：先证明 IR 内容，再切消费者；其旧 DeliveryRun 内部 API 不直接照搬。
- [最新 Stateless Semantic Slice 设计](../../game-ir-packet-once-evaluation/docs/superpowers/specs/2026-09-02-game-ir-semantic-slice-stream-design.md) 与 [对应实施计划](../../game-ir-packet-once-evaluation/docs/superpowers/plans/2026-09-02-game-ir-stateless-semantic-slices.md)：覆盖早期 packet-once、完整域输出与 session affinity 方案。
- 旧 Core、Gameplay/Balance、World/Presentation、Resource、Implementation/Verification 分阶段设计与测试：作为迁入后的保真回归依据，不重新排为新功能开发。

历史 stateless ledger 记录 Task 9 自动验收完成、Task 10 真实验收发现问题并继续修复，不能据此宣称三类真实项目全部通过。本次 HEAD 离线重跑已完成，但发现目录外接线测试失败与目录内测试未覆盖的执行偏差，最终真实通过证据仍不完整。旧生产切换计划将 consumer Task 9–15 置于内容质量门禁之后，不等于消费者已完成接入。

### 1.2 回收与改造矩阵

下表源码以来源工作树的 `packages/agent-workflow-server/src/beegame/delivery-workflow/` 为根；KEEP 表示优先保留算法/语义，仍须迁入测试，不代表整文件无修改。

| 能力/文件 | 判断 | 本轮实施内容 |
| --- | --- | --- |
| `game-ir/model.ts`、六域 `*-schema.ts`、`*-producer.ts`、`*-assembler.ts`、`phase5/6/7-admission.ts` | KEEP + 边界适配 | 保留六域 DTO、AST、引用/来源/闭合规则；移除对外层类型/常量的反向依赖，不重写领域 |
| `game-ir/staged-compiler.ts`、`projection-contract.ts`、`projection-slices.ts`、`projection-slice-authority.ts`、`projection-record-stream.ts` | KEEP + ADAPT | 迁入最新无状态分片链；source packet 改读新公开输入，不读活动工作区或 Reviewer 私有索引 |
| `game-ir/semantic-obligation-inventory.ts`、`semantic-obligation-validation.ts` | KEEP + 重验 | 保留独立 preflight 与来源/owner-slice 绑定；重点验证漏项、空 slice、伪 PASS 和恢复 |
| `game-ir/projection-slice-journal.ts`、`stage-checkpoint.ts`、`publication.ts` | KEEP 机制 / ADAPT 所有权 | 保留记录前缀、摘要链、原子发布和 cut-point 防护；从旧 run-store lease/DeliveryRun 中移入 IR 私有状态及受限存储能力 |
| `game-ir/committed-reader.ts`、`contracts.ts` | ADAPT | 保留唯一已提交读取与投影；输入从完整 DeliveryRun 改为公开身份/句柄/绑定，拆开输入协议版本与领域 schema 版本 |
| `game-ir/foundation-ready-adapter.ts` | REPLACE 接口，不回收私有路径 | 旧代码直接读取 `FoundationAuditState`、Fact Store/SectionIndex 和旧 revision authority；改用当前公开 passed 结果与精确发布字节，禁止伪造旧 state 以满足旧 parser |
| 外层 `controller.ts`、`dispatch.ts`、`recovery.ts`、`worker-contracts.ts`、`worker-prompts.ts` 中 IR 分支 | EXTRACT / REWIRE | 算法和 IR 专有 prompt 收入模块；旧控制器接线只作行为参考，不整体 cherry-pick、不复活已退役 Foundation 执行体 |
| session/native runner/observability 的通用能力改动 | AUDIT / ADAPT | 与当前平台能力逐项比对，仅补证明缺失的 transport/usage/privacy 能力，不复制计费、账户或第二运行时 |
| 旧 Foundation 修复、packet-once/full-packet fallback、旧 reader | 不迁入 | Foundation 修复须在当前基线独立复现另案处理；最新协议已删除的投影旧轨不得恢复 |

Core 是公共模型基础；当前 canonical publication 为六域：`balance`、`gameplay`、`implementation-verification`、`presentation`、`resource-realization`、`world-scene`。不按上一版章节划分新建七套/九套独立产物。

### 1.3 规划符合性审计基线与待关闭事项

审计对象为源 `4335363b2`，不是当前 Foundation 目标工作树。IR 目录 635 pass / 0 fail（46 文件）；外层接线、合同与运行测试合计 268 pass / 2 fail（10 文件）；根 typecheck 通过。既有测试合计 903 pass / 2 fail，不重复计算子 agent 运行的子集。另用临时离线 controller 用例复现以下 F1、F3，F2 用来源片段函数复现。测试绿不代表规划符合性绿；下表均为待关闭，不因完成审计而勾选。

| ID | 观察到的偏差/缺口 | 主要证据位置（源 `delivery-workflow/` 下） | 关闭任务 |
| --- | --- | --- | --- |
| F1 | 规划要求 Gameplay 引用 Balance variable/formula；实际 Gameplay packet 没有 Balance targets，slice 完成时报 unknown target。controller 复现停在 slice.0、零已完成 slice | `game-ir/gameplay-producer.ts`、`projection-slice-journal.ts`、`gameplay-schema.ts` | IR-R1 |
| F2 | 同一章节中重复正文行被过滤；“标题 + 两次相同规则”只剩标题。投影与独立 obligation validator 使用同一缺损 catalog | `game-ir/projection-slices.ts`、`projection-slice-authority.ts`、`semantic-obligation-validation.ts` | IR-R2 |
| F3 | 相同 inventory 请求、记录和 missing-obligation FAIL 反复出现，仍清空 progressIdentity 并重新派发。三轮复现产生七次派发，仍为 running | `controller.ts` obligation-validation FAIL 分支、`game-ir/projection-slice-journal.ts` | IR-R3 |
| F4 | 两条 session-port 测试没有提供新增 obligationInventory，实际 TypeError；类型检查未检出这些强制类型转换的旧 fixture | 上一级 `delivery-worker-session-port.complete-documents.test.ts`；`worker-prompts.ts` | IR-R4 |
| F5 | 多变体/多文件机制已验证，但规划要求的 all-resource-kinds 完整样例与独立 audio/UI/content 多文件 profile 证据不足 | `game-ir/resource-realization-profiles.integration.test.ts`；Resource spec §11 | IR-R5 |
| F6 | FoundationDefectReport 只有合同/parser/test，未找到完整生产报告与公开回流链；needs_action 不能替代报告 | `game-ir/contracts.ts`、`controller.ts` | IR-3 产出报告；IR-6 公开回流 |
| F7 | committed reader 仅接受 Checklist drafting；其他消费者仍读 authorityPaths/raw docs；Checklist 完成直接进资源，但 schema 要求已接纳 bridge，生产 bridge 尚未接线 | `game-ir/committed-reader.ts`、`document-stage.ts`、`schema.ts`、`resource-stage.ts` | IR-3 公开读取；IR-7 bridge；IR-8 消费者 |
| F8 | 有真实运行失败与修复记录，未找到三类项目完整最终通过报告；旧 spec/plan 状态与源码进度不一致 | 最新 stateless spec/plan、历史验收记录 | IR-R6 统一证据；IR-5/IR-9 真实验收 |

Core、World/Presentation、Implementation/Verification 及发布设施的已核对结构约束有较完整实现和离线证据；不因此宣称语义质量、跨领域实际执行与最终消费已完成。

## 2. 所有权与依赖

| 所有者 | 责任 | 禁止事项 |
| --- | --- | --- |
| Foundation 文档 | 唯一可编辑的产品设计依据 | 因 IR 编译器实现缺陷被自动改写 |
| Reviewer | 签发公开文档审查结果 | 读取 IR 私有状态或由 IR 决定原审查通过 |
| 应用交接层 | 校验通过结果、发布状态和精确输入版本，调用下一模块 | 拼造审查通过、操作 IR 内部任务 |
| Game IR | 编译、校验、状态、重试、恢复和不可变 IR 发布 | 自行新增玩法决策、改文档、写 Reviewer 问题库 |
| Checklist | 根据通过文档定义验收内容，关联 IR 稳定 ID | 把 IR 编译出的新决策当作产品需求 |
| 资源/实现等下游 | 消费获准的 IR 版本与本阶段输入 | 启用另一套 Markdown→IR 编译路径作 fallback |

编排只持有调用身份、公开句柄、输入摘要、接纳结果及停止意图。阶段之间不直接调用，不读取彼此私有 checkpoint、Fact Store、journal 或 worker 日志。Reviewer 的审计事实与 IR 的执行投影职责不同，不能以“去双轨”为由删除 Fact Store。

拟采用 `stage-modules/game-ir/public.ts` 作为唯一生产入口；私有 application/domain/ports/state 可按实际需要组织，不强制共享基类或共同业务状态机。

## 3. 公开契约草案

以下为待 IR-0 冻结的当前公开适配契约，不代表 API 已存在。旧分支已有 `FoundationReadyReceipt / GameIrCompileRequest / FoundationDefectReport / GameIrReadyReceipt`，优先逐字段映射、保留有效语义；不得用新的名字掩盖重复协议。输入输出必须为复制的数据或获授权的不可变引用，不传递完整 DeliveryRun、私有 store 或可执行回调。

### 3.1 FoundationAcceptedInput

- 协议版本、可信主体/项目归属、稳定 requestId。
- 当前公开 Reviewer passed 结果及已接受绑定：resultId/resultDigest、文档集合摘要、审查策略依据。
- 应用层成功发布的身份及文档版本绑定；八份精确文档内容或带摘要的不可变读取引用。
- IR schema/compiler/验证策略版本及明确的能力范围。

不能照搬旧文档中的 Stage 4 READY receipt。Review passed 由 Reviewer 签发；应用只证明指定字节已经发布，不补签业务通过。IR 自己建立 source index，或消费正式公开索引；不得借用 Reviewer 私有 SectionIndex 文件。IR-0 要确定输入摘要算法、必填字段、大小边界及反例。

### 3.2 生命周期与结果

`start / getResult / stop / resume`；句柄不透明、归属绑定、重复 start 幂等，getResult 严格只读。

运行状态与业务结论分离。业务结果至少区分：

- `ir_ready`：完整输入绑定、IR 各模块摘要、source map、依赖图、校验依据和不可变 publication 引用。
- `foundation_defect`：被源文档证据证明的真实缺失、冲突或语义歧义，不等于 Reviewer Issue。
- 无法安全完成的运行：明确需要处理及原因，不伪造 ready、关闭成功或零用量。

Core 试运行和部分领域完成只产生候选/测试证据，不发布完整 `ir_ready`。稳定 ID、排序、重命名及跨版本 lineage 规则必须冻结；不承诺模型输出的原始字节每次完全相同。

### 3.3 FoundationDefectReport

绑定 Foundation result/revision、编译调用与报告 ID，携带 reasonCode、expected/actual、全部必要 source bindings 及证据文本摘要；不包含可执行 Patch，不直接写 Issue Registry。

当前尚无为此冻结的公开缺陷回流接口。IR-6 先设计独立回流请求：编排校验身份/版本/重复请求，将报告作为待核验线索交给 Reviewer 公共入口；Reviewer 独立确认问题，Revision 仍只消费 Reviewer 正式问题。不得由编排把报告直接转换成通过验证的问题。

## 4. IR 内容及资源前后关系

| 领域 | 最低语义要求 |
| --- | --- |
| Core | 类型化节点、稳定 ID、引用、依赖、来源、版本、编译 provenance |
| Gameplay | 实体、动作、状态/转移、条件/效果、事件、目标、胜负规则；不能只是名字列表 |
| Balance | 参数与单位、边界、公式 AST、依赖、曲线、奖励与成本；公式可校验，不执行任意代码 |
| World / Presentation | 场景/实例/空间关系及 UI、音频、动画、VFX 与玩法事件的关联 |
| Resource requirements | 逻辑资源、需求依据、允许的实现变体、格式/预算与运行时角色 |
| Implementation / Verification | 实现目标、依赖、覆盖关系、场景、不变量及所需证据 |

只投影文档实际要求的能力；不为简单 2D 游戏凭空补入 3D 路线、骨骼或复杂关卡。适用/不适用、缺失、无法支持须明确区分；所需能力无法表达时不能以空数组冒充完成。

IR 位于资源生产之前，因此可声明资源需求与计划约束，但不能宣称实际文件已经生成或验证。后续资源模块发布自己的结果，绑定 IR revision、logical requirement ID、实际文件及摘要；支持一需求多变体、一变体多文件。资源结果不回写已发布 IR。若需求变更，走新文档版本与新 IR，而不是在资源阶段补改 IR。

## 5. 编译、校验与失败处理

- mechanical / semantic / derived 字段具有唯一生产者，禁止互相兜底或读取旧 IR 补值。
- 模型只写候选；只读语义验证检查忠实性、覆盖与歧义；服务端 admission 负责 schema、唯一 ID、引用闭合、来源范围、图约束、单位/公式及跨领域一致性。
- 来源文档已明确的多个合法玩法分支应完整表达；只有产品语义无法确定才报告歧义，不能把表示格式差异伪装成文档缺陷。
- 编译器/schema 缺陷、供应商故障、无效候选及发布失败留在 IR 模块，不进入 Foundation 业务问题库。
- 不沿用旧草稿中笼统的自动重建/自动恢复承诺。attempt、重试条件、无进展识别、用量、停止和未知关闭政策在 IR-0 定稿；本计划不新增无限重试或自动接管。

### 5.1 必须复用的最新编译链

精确八文档 → IR 自有 source index/领域 source envelope → obligation inventory + 独立验证 → 无状态 slice 的最小 authority → strict JSONL record/done → 记录 admission/journal → 领域 assembly/独立验证 → 完整六域 publication → 唯一 committed reader。

- 不恢复 packet-once、会话亲和、digest-only continuation 或新会话重发完整域 packet。每次 projection 请求自包含；已有完整 operation packet 只在模块内部供校验/组装使用。
- 以既有十个 operation 与来源绑定为基线；F1 若要求调整 dependency/operation 协议，须按 IR-R1 决策门禁统一修改，不能保留新旧两条执行轨。preflight receipt 绑定既有 journal，不建立第二份业务 authority。投影与只读验证职责分离，验证操作可保留其小型 StructuredOutput 契约。
- 复用有效记录前缀与最小 owner record/slice 纠错；无进展按相同权威、前缀、诊断和输出证据判断，不按固定 token、耗时或重试次数判业务失败。显式用户停止仍须执行。
- 旧 source selector 与当前八文档的章节合同必须逐项核对。缺章节/缺表达能力显式报错，不通过关键词特例、扩大任意读取范围或默默空 slice 兜底。
- 旧真实缺陷中的 reference policy、诊断归属、稳定 journal identity 与 preflight 绑定进入迁入回归清单；既有实现是否完整关闭问题由测试证明，不根据旧 ledger 的最后一行推断。

## 6. 平台能力与版本安全

新模块以受限能力契约接入可信身份/执行授权、模型执行、私有存储、不可变产物及可靠用量投递；优先适配现有本地实现，不复制账户/计费实现，不引入万能 Hook。

存储契约须明确条件提交、所有权、终态与 outbox 一致性、未知提交结果及只读语义。状态 schema 和业务完成判断仍归 IR。接口未冻结时可用测试适配器验证，不宣称平台解耦已完成。

- Foundation 版本变化：旧结果保留为历史，禁止旧候选激活及旧结果覆盖新当前版本。
- 编排按依赖摘要使下游当前接纳失效；IR 不删除或修改其他模块状态。
- 重放相同成功调用只返回相同 publication，不重复编译；下游 start 确认丢失仍复用调用身份。
- 停止意图先持久化；晚到结果不得自动开启下游。
- 无法证明旧执行关闭则保持需要处理，不伪造关闭或默认重派发。
- 当前通用产物读取权限不能替代私有命名空间隔离；接线前核对公开产物读取白名单及路径身份。

## 7. 实施任务与门禁

每项须附证据并经主审后勾选。主 agent 负责契约、审计与纠偏；边界明确后可由 Luna high 子 agent 实施独占文件任务。没有验收不得用模块目录存在替代完成判断。

以下 IR 编号保留便于主计划引用，但任务内容已替换，不能继续执行上一版逐域从零开发任务。

### 7.1 执行顺序与工作区边界

执行顺序：IR-0 → IR-R0 → IR-R1/R2/R3 → IR-R4/R5 → IR-R6（整改准入）→ IR-1/2/3（迁入适配）→ IR-4（目标离线准入）→ IR-5/6 → IR-7 → IR-8 → IR-9。

- 实施时从已固定的源 commit 建立隔离整改工作区；本次规划不创建工作区，也不修改两个来源工作树。IR-R 阶段只处理可回收 IR、必需的窄运行接缝及测试，不在旧架构中补做整套消费者接入。
- 当前 Foundation 目标工作树保留全部已验收与未提交成果。IR-R6 通过前不迁入生产代码；通过后只选取审计清单内的最终实现，不能把旧 Foundation controller/runtime 整体移入。
- IR-1—3 可以迁入“尚未生产接线的当前模块”，不允许保留两套可选 compiler。旧架构中的缺陷回流、reader/bridge/消费者接入缺口在新公开边界一次完成，避免先补旧架构再重写。
- 默认保持六域语义与既有十 operation；若 F1 证明需要调整内部 identity/dependency 协议或 operation 顺序，IR-R1 必须先提交决策说明，列出来源、唯一 writer、循环依赖处理与协议版本影响，经主审后同步合同/测试。不允许为守住旧操作编号而删掉双向引用能力，也不允许静默改协议。

### 7.2 第一批：规划符合性整改（新增硬门禁）

| 任务 | 具体工作与最小范围 | 必须交付的验收证据 | 前置 |
| --- | --- | --- | --- |
| IR-R0 固化可复现回归 | 把 F1 controller 引用阻断、F2 重复正文遗漏、F3 preflight 循环复现纳入正式测试；保存 635/0 与外层 268/2 基线、精确命令及规划条款映射 | 修复前各用例因预期缺陷失败；不能手工跳过 dispatcher/journal/validator；形成 F1—F8 跟踪清单 | IR-0 |
| IR-R1 修复跨域引用执行 | 审核 Gameplay/Balance identity 与 dependency 生产顺序；在不要求另一侧完整 module 先完成的条件下，传递来源绑定、可重验且由唯一生产者持有的 typed target identity，最终 pair 原子闭合；涉及 producer、staged compiler、slice authority/journal、相关合同 | 用实际 controller 代码 + 假模型离线从 preflight 跑到 pair assembly：Gameplay→Balance variable/formula、Balance→Gameplay action/event 和双向场景均通过；identity 与最终节点精确一致，unknown/wrong-kind/stale 仍拒绝；恢复不丢引用。identity 不能伪装成占位 module/完整通过结果；不注入现成 receipt 绕过生成路径，不启动真实平台服务 | IR-R0；先审协议决策 |
| IR-R2 修复来源完整性 | catalog 使用可定位的 occurrence/字节区间保留来源，统一 projection 与 inventory/validator 的 source rendering；必要时修订 fragment 协议版本 | 重复正文、相同行位于不同上下文、短行是另一行子串、UTF-8、重复表头等用例不静默丢内容；每个必要来源 occurrence 可追溯；validator 能发现被故意漏掉的义务。删除“重复正文应消失”的旧预期，不降低来源校验 | IR-R0 |
| IR-R3 修复 preflight 无进展 | 为 inventory→validation→重建循环持久化同一 authority 下的有效进展/诊断身份；保留必要的 missing-obligation 修正信息进入下一次请求；与现有 journal/生命周期合并，不加第二 journal | 相同 authority、inventory、缺失诊断循环被识别；跨进程恢复后仍识别；真正修正的清单或新的有效证据可继续；stale 输入拒绝；用户停止生效。禁止次数/token/时间 cap、随机 dispatch ID 冒充进展或清空诊断重跑 | IR-R0 |
| IR-R4 收敛生产合同与测试 | 修复两条缺 inventory 的 session-port fixture，并核对 controller→contract→prompt→native terminal→journal 全链输入；补篡改、缺失、过期 inventory 拒绝 | 原两个失败用例通过且实际经过 fresh session/提交/关闭；新增强类型 fixture 不用 `as never` 掩盖必填字段；旧 Shape 不得由 fallback 补值；测试清单使用真实存在的文件路径 | IR-R1/R2/R3 合流 |
| IR-R5 补齐资源与内容证据 | 在隔离整改工作区补独立 visual 3D、audio/UI/content 两类完整多文件 profile，按规划覆盖资源 kinds；复核六域语义覆盖与源文档期望 | 不仅增加 format 枚举或复制 player-model；不同 profile 离线从 source 到完整 closure，来源字段、variants/artifacts、覆盖和不适用均有断言；目标公开 publication/reader 验收后置 IR-4；模拟 PASS 只证明协议，不能记为真实语义验收 | IR-R2；与 R4 可分文件推进 |
| IR-R6 整改合流准入 | 整体重跑 IR、外层合同/运行、Foundation 非回归与静态/类型检查；复核每个条款→生产路径→正反测试→证据；更新选取文件/摘要与迁入清单 | F1—F5 关闭，无已知红测；F6—F8 明确保留为后续接入/真实门禁，不能标全部完成；主 agent 独立审计通过。测试数量可变化，不以达到旧数量代替符合性 | IR-R1—R5 |

- [x] IR-R0 正式化偏差回归与证据清单。2026-09-07 三个正式测试文件、四条正确行为断言均因已确认缺陷 RED；F1—F3 修复仍未完成，见执行证据。
- [ ] IR-R1 Gameplay/Balance 双向引用执行闭环。
- [ ] IR-R2 无遗漏来源片段及独立核验覆盖。
- [ ] IR-R3 preflight 循环无进展与恢复。
- [ ] IR-R4 合同、fixture 和真实运行接缝回归。
- [ ] IR-R5 资源完整样例与内容证据补齐。
- [ ] IR-R6 整改合流主审准入。

主 agent 负责 IR-0、R1 协议决策、R6 审计和纠偏；Luna high 可执行边界明确的子任务。R1/R2/R3 涉及共享 slice/journal/contracts，必须先明确文件归属；未拆清时串行。R4 在三者合流后执行；R5 只在独占 fixture/测试文件时并行。原规划授权不包含提交/执行；2026-09-07 用户随后明确要求“git 全部提交，然后开始推进计划”，现已获准按此门禁实施和提交。真实模型调用、启动服务及真实计费验收仍需单独批准，不能由实施授权推导。

首批执行证据见[IR 整改执行记录](ir-remediation-execution-evidence-2026-09-07.md)；既有 Foundation 改动已提交为 `484e77806`，整改工作区固定源 `4335363b2`。只按独立验收结果更新以下勾选，不以开始执行替代任务完成。

### 7.3 第二批起：迁入、公开接入及消费者切换

| 任务 | 实施范围与交付物 | 验收/完成条件 | 前置 |
| --- | --- | --- | --- |
| IR-0 回收基线与契约冻结 | 固定来源 commit/文件摘要/依赖闭包；形成逐文件 KEEP/ADAPT/REPLACE/EXCLUDE 清单；在隔离测试环境重跑旧 IR 基线；冻结新旧输入字段映射、公开生命周期、能力端口、停止/重试及人工停点策略 | 六域/十 operation/分片/preflight 覆盖清单可追溯；所有旧失败单列，源码存在、历史通过、当前通过三者分开；不要求重做领域设计 | 本计划确认 |
| IR-1 六域与编译内核迁入 | 将整改后的 Core、六域 schema/producer/assembler/admission、stateless/preflight 及其有效测试迁入 `stage-modules/game-ir/private/`；把外层常量依赖切到明确合同 | F1—F5 回归随代码迁入；原有领域语义和输出规范保真；不得重新引入 aggregate compiler；独立依赖检查通过 | IR-0、IR-R6 |
| IR-2 当前 Foundation 输入适配 | 新 `FoundationAcceptedInput` 校验；捕获八文档字节；构建 IR 自有 index；替换旧 `foundation-ready-adapter` 和活动文件读取，核对固定 section selectors | passed 但未发布、内容变化、错误项目/主体、伪摘要、旧版本全部拒绝；初审直接通过及修订后通过均可输入；不读 Reviewer 私有文件 | IR-0、IR-1 |
| IR-3 运行与持久化模块化 | 抽取旧 controller/dispatch/prompt 中 IR 编译控制；封装 `public.ts` 生命周期及已发布读取；适配模型、usage、journal/checkpoint/publication 与私有存储；补模块自有 foundation_defect 结果生成/发布 | 假平台可完整跑到六域 committed result；F3 重复失败与恢复通过；公开 reader 依照身份/版本授权而非只允许 Checklist drafting，仍不接受任意路径；真实文档缺陷报告绑定 source/input/result，编译器故障不伪装缺陷；getResult 严格只读 | IR-1、IR-2；受限能力定义 |
| IR-4 独立 IR 内容质量与边界验收 | 在目标架构重跑 F1—F5、六域测试、公开入口端到端假执行、旧真实缺陷回归；将 R5 两类 profile 跑通公开 publication/reader；新文档合同 fixtures；审计来源覆盖与独立验证 | 源整改通过不能替代目标验收；不以 JSON/schema 或模拟 PASS 代替真实内容证明；公开结果、完整 publication 重验、Foundation 开关对照及依赖边界通过；真实语义门禁留在 IR-5 | IR-3 |
| IR-5 应用最小接线与 IR 真实验收 | 新公开 `game-ir-link`（名称 IR-0 冻结）接在 published/accepted 后；编排只存调用/结果引用，UI 只读公开状态；停在 IR 完成，不启动 Checklist；真实运行须另获授权 | 先离线走公开接线，再以新项目覆盖数值/公式、场景/资源、交互/状态三类；联合核对六域内容、来源、journal、发布、reader、用量与 UI；未通过不得切消费者 | IR-4；真实范围/费用停止条件批准 |
| IR-6 缺陷回流与失效交接 | 适配旧 defect DTO；新增当前公开回流协议，经 Reviewer 独立核验；实现 Foundation 变更使 IR 当前接纳失效及旧候选拒绝 | compiler/provider/发布错误不成为业务 Issue；回流去重、跨版本拒绝、原文保护；有效修订产生新 IR identity，不恢复热改旧 run | IR-4；与 IR-5 离线部分可独立推进 |
| IR-7 Checklist 公开桥接 | 按 P5.1 独立模块契约接入；内容仍依据八文档，IR 提供稳定 scenario/node ID；唯一 bridge 绑定文档/IR/Checklist 版本；替换完成后直接进入资源的旧交接 | 用实际公开入口、持久化和恢复走通 Checklist 发布→bridge 接纳→资源准入；不得只测 transition 枚举；无 bridge/版本不符不能进入资源，reader 不受旧 drafting-only 条件阻挡；重跑 IR-6 失效回归 | IR-5、IR-6、P5.1 契约 |
| IR-8 逐消费者切换 | 配合 P5.2—P5.7，按 Resource Planner → Curator → Content → Atomic Planner → Implementation → Auditor → Acceptance 顺序迁移，资源产物绑定 requirement/variant/artifact；P5.8 全链失效 | 每个消费者在同一变更单元切唯一 reader 并删本消费者旧 reader/prompt；新资源证据不回写 IR；上一消费者验收后再切下一项，禁止靠下游修补 IR 质量 | IR-7；对应 P5 模块就绪 |
| IR-9 全链与退役收尾 | 离线全链、静态依赖闭包、版本/故障矩阵；另获授权后的新项目完整真实验收；删除无生产消费者的旧实现与仅服务旧轨的测试 | 没有 fallback/双写/私有读取；完整 Idea→交付证据，当前 Foundation 回归通过；文档、代码入口与实际状态一致 | IR-8 |

- [x] IR-0 回收基线与契约冻结。2026-09-07 固定清单/公开边界主审通过，隔离基线 903 pass / 2 个已知 fail，见执行证据；不等于整改准入通过。
- [ ] IR-1 六域与编译内核迁入。
- [ ] IR-2 当前 Foundation 输入适配。
- [ ] IR-3 运行与持久化模块化。
- [ ] IR-4 独立内容质量与边界验收。
- [ ] IR-5 应用最小接线与 IR 真实验收。
- [ ] IR-6 缺陷回流与版本失效。
- [ ] IR-7 Checklist 公开桥接。
- [ ] IR-8 逐消费者单轨切换。
- [ ] IR-9 全链验收与退役收尾。

IR-0 完成后只能并行互不重叠的迁入/测试任务，不并行重写共享 controller、journal、contract。平台端口定义是 IR-3 前置，但不要求先迁移完所有既有模块。生产存储只有 IR 模块自己的单一状态权威；不得保留旧 DeliveryRun IR 控制器与新生命周期同时驱动。IR-5 的“停在 IR”属于分阶段接入，不是给消费者提供旧 reader 的开关。

阶段产出区分：IR-4 = 独立模块离线可验；IR-5 = 当前应用已接 IR 且独立真实内容验收；IR-7 = Checklist 正式可接；IR-9 = 全链完成。不能用任一局部完成代替全部完成。

## 8. 必须交付的验收证据

每项关闭记录必须包含：规划条款/发现 ID、变更文件与版本、修改前反例、修改后正反测试、精确运行命令、实际结果、仍未验证的范围和主审结论。临时复现文件与历史统计不能成为唯一证据；正式回归随最终实现保留。凡 F1—F5 任一未关闭、外层测试仍红、源文件来源不清或存在新旧可达双轨，IR-R6 不通过；凡未完成三类真实内容验收，IR-5 不通过，不开启 Checklist 切换。

- 独立打包/运行；直接、传递、类型及动态依赖均不越过阶段边界。
- 相同 Foundation 输入下，新增 IR 不改变原 Reviewer/Revision 的审查和修订决策。
- 完整输入绑定、tamper/stale/跨主体拒绝；修改活动目录不能污染已捕获输入。
- 字段来源、语义忠实性、无默认产品决策、图闭合和资源需求覆盖。
- 正常完成、停止、显式续行、提交窗口故障、重复请求、迟到输出、未知关闭及用量重放。
- partial publication 不可见；UI/编排不通过读取私有文件判断 ready。
- IR ready 与 Foundation 版本配对；Checklist/资源/实现不得混用不同版本。
- 缺陷回流不得直接签发 Issue，重复/过期报告不重复修订。
- 消费者迁移完成后删除旧 reader、旧实现及仅服务旧实现的测试；保留当前行为与退役拒绝测试，不保留新旧长期双跑。

## 9. 计划边界与估算

本计划是既有 IR 的整改、回收、边界适配和接入工程，不按“新建完整 Game IR”估算，也不按“只差接线”估算。六域 schema、编译、admission、publication 和 stateless 机制为待验收复用候选；剩余工作必须包含 IR-R0—R6 的修复和证据补齐。IR-0 给出初步逐项估算，IR-R1 协议决策后更新 F1 的影响范围，IR-R6 后校准迁入成本；不在双向依赖方案未冻结时承诺固定总工期。

此前“三模块平台解耦 18–30 人日”不能直接视为 IR 接入预算；共用平台能力只能计一次。P5.1 Checklist 桥接与 IR-7、P5 消费者迁移与 IR-8、P5.8 失效与 IR-6/8 均为同一工作包的不同视图，不重复计时。

不加入数据库、跨机调度、孤儿进程自动接管、通用引擎重设计或新增游戏能力。本次仅修订计划，未搬代码、合并分支、修改运行中项目、跑模型、提交或部署；既有 IR 实现存在不等于当前公开 API、生产接入和消费者迁移已通过。
