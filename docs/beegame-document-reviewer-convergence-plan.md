# BeeGame Document Reviewer 单轨收敛方案

## 1. 目标

Document Reviewer 在实现前发现跨文档、资源与内容描述之间的真实矛盾，并通过有限、可追溯的修订收敛。Reviewer 只审计，不修改；Workflow 只路由结构化 finding，不解释游戏语义。

本方案只有一套 review state、finding、owner、revision 和终态。禁止全文循环重审、自然语言状态推断、替代读取合同、平行 finding 状态或第二修复队列。

## 2. 审计时序

```text
八份 Foundation 文档（`beegame-foundation-document-authority-plan.md` 定义）
  -> Foundation Initial Review
  -> 按 repair graph 依赖串行修订 owner 文档
  -> Foundation Closure Review
  -> Gameplay Checklist
  -> Checklist Initial Review / Repair / Closure（批准后封存）
  -> Resource Production（Manifest modules + 资源文件 + JSON/YAML 内容描述）
  -> Comprehensive Initial Review
  -> 按 owner 批量修订
  -> Comprehensive Closure Review
  -> Atomic Task Planning
  -> Implementation
```

Foundation Review 不得要求尚未创建的 Checklist、Manifest、资源或运行证据。Checklist Review 只审计已生成 Checklist 对已批准 Foundation 的追踪、可观察性与内部结构，不能要求尚未创建的资源或实现。Comprehensive Review 可以审计当前模块化 Manifest 与 `assets/content/**/*.json|yaml` 的语义适配，但不能要求尚未实现的代码、构建或运行证据，也不能重新审计或修改已经封存的 Checklist。

## 3. 固定审计集合

### 3.1 Foundation checks

- `brief_alignment`
- `cross_document_consistency`
- `gameplay_completeness`
- `gameplay_strategy_viability`
- `economy_progression_integrity`
- `numeric_balance_feasibility`
- `pacing_difficulty_coherence`
- `level_scene_design_integrity`
- `technical_feasibility`
- `art_direction_coherence`
- `ui_audio_consistency`
- `acceptance_observability`

### 3.2 Checklist 独立检查

- `checklist_traceability`

该 check 在 Resource Preparation 前形成独立 Cycle。其 finding owner 固定为 `checklist`，只允许在该 Cycle 内修复 Checklist；Closure 通过后保存 Checklist approval revision 并永久退出本 run 的 mutation matrix。

### 3.3 Comprehensive additions

- `resource_semantic_fitness`
- `content_structure_fitness`
- `resource_content_consistency`
- `implementation_readiness`

Comprehensive 的固定集合不是替换 Foundation，而是严格并集：

```text
COMPREHENSIVE_CHECKS = FOUNDATION_CHECKS + COMPREHENSIVE_ADDITIONS
```

因此 Foundation 批准集合固定为 12 项，Checklist approval 固定为 1 项，Comprehensive 最终批准集合固定为 16 项。Comprehensive 的 16 项 ledger 可以由“当前仍新鲜的 12 项 Foundation approval 前缀 + 本轮新执行的 4 项 resource additions”构成；冻结 Checklist 的 approval 是进入 Resource Preparation 的前置证据，不复制进 Comprehensive ledger。不得重命名、替换、拆分或按案例新增顶层 check；新发现的审计规则必须归入已有 check 的职责。

### 3.3 Check 职责边界

| Check | 负责 | 不负责 |
| --- | --- | --- |
| `brief_alignment` | 确认简报、范围与语言合同一致 | 自行扩大产品范围 |
| `cross_document_consistency` | 跨文档事实、ID 与权威归属一致 | 选择一个冲突文档作为默认权威 |
| `gameplay_completeness` | 完整玩家循环、状态、机制与结果 | 实现代码与运行证明 |
| `gameplay_strategy_viability` | 玩家有意义的选择、支配策略风险、反制与失败恢复 | 以个人偏好要求更多玩法或内容 |
| `economy_progression_integrity` | 来源与消耗、可负担性与成长、套利与资源死锁 | 假设文档未声明的留存或商业化目标 |
| `numeric_balance_feasibility` | 结果边界、相对价值和公式一致性可由已声明数值成立 | 声称文档审计已经证明最终手感或精确平衡 |
| `pacing_difficulty_coherence` | 压力曲线、能力曲线、难度尖峰与恢复窗口相互匹配 | 要求尚未实现的运行采样或自动试玩结果 |
| `level_scene_design_integrity` | 空间支持、关卡序列和场景状态形成可执行闭环 | 要求引擎专用 Scene、Prefab 或最终 YAML |
| `technical_feasibility` | 目标约束、确定性规则和单一资源加载路径可实现 | 指定框架内部实现或引擎专用对象 |
| `art_direction_coherence` | 视觉职责、风格和可读性要求一致 | 选择具体 Catalog 资源 |
| `ui_audio_consistency` | UI、交互与音频职责跨文档一致 | 要求尚未存在的运行录屏 |
| `acceptance_observability` | 每项批准行为都有可观察结果 | Foundation 阶段要求 Checklist 已存在 |
| `checklist_traceability` | Checklist 逐项追踪批准行为与证据 | 发明新玩法要求 |
| `resource_semantic_fitness` | 现有资源语义足以承担批准职责 | 替 Resource Agent 选 Pack |
| `content_structure_fitness` | JSON/YAML 权属、结构和稳定 ID 正确 | 要求每个 requirement 一个文件 |
| `resource_content_consistency` | Manifest、资源与内容引用一致且只有一条加载路径 | 接受运行时或源码替代分支 |
| `implementation_readiness` | 当前合同足以生成唯一、可执行的实现计划 | 要求尚未实现的构建或运行结果 |

每个 required check 必须返回 conclusion、artifact anchors 和必要的 finding。不得根据项目名、游戏类型、关键词或正则动态增删 check。

### 3.4 游戏设计推导证据

`gameplay_strategy_viability`、`economy_progression_integrity`、`numeric_balance_feasibility`、`pacing_difficulty_coherence` 与 `level_scene_design_integrity` 不是对文档中是否出现相关章节的关键词检查。每项 check 必须提交以下固定 criterion，且每个 criterion 必须有独立状态、精确 artifact evidence、推导过程和结论。父 check 的 evidence 支撑总体结论，criterion evidence 支撑各自推导；两者都独立验证 artifact 与 anchor，不要求重复同一证据项。服务端将两层 evidence 的 artifact digest 合并为该 check 的唯一失效依据，并从本次 findings 确定性派生父 check 的 finding 关联；criterion 不重复提交 finding 身份：

| Check | 固定 criterion |
| --- | --- |
| `gameplay_strategy_viability` | `meaningful_choices`、`dominant_strategy_risk`、`counterplay_and_recovery` |
| `economy_progression_integrity` | `sources_and_sinks`、`affordability_and_growth`、`exploit_and_deadlock` |
| `numeric_balance_feasibility` | `outcome_bounds`、`relative_value`、`formula_consistency` |
| `pacing_difficulty_coherence` | `pressure_curve`、`capability_curve`、`spike_and_recovery` |
| `level_scene_design_integrity` | `spatial_gameplay_support`、`level_progression_coherence`、`scene_state_completeness` |

推导只能使用 Confirmed Brief 与当前项目文档明确声明的规则、数值、公式和约束，不得补造数值、默认概率、玩家水平或平台行为。数值 criterion 的推导至少给出所使用的输入、单位或无量纲说明、计算/比较方法和结果边界；定性 criterion 必须列出被比较的玩家选择、反制关系或状态路径。若缺少的信息会导致核心循环的可行性、策略空间、经济闭环或难度曲线无法判断，该缺失本身就是指向其事实 owner 的 blocking finding。

文档审计的目标是排除可证明的无解、必胜、支配策略、资源死锁、无限套利、公式冲突和不连续难度边界，并确认存在可实现的设计区间。它不宣称已经证明最终手感或精确平衡；实现后的运行验收使用同一批批准规则与 Checklist 验证实际行为，不建立第二套 balance finding、第二份数值权威或自动调参回路。

服务端必须结构化约束 criterion 集合、状态与 evidence；任一 criterion 阻塞时父 check 必须阻塞并引用至少一个同 check finding。不得仅靠 Prompt 要求一段自由文本，也不得用关键词、正则或游戏类型推断应审计哪些 criterion。

涉及系统交付边界的 check 必须在 evidence 中引用 `systemDeliveryContract` 的精确 JSON Pointer：Foundation 与 Comprehensive 的 `cross_document_consistency`、`technical_feasibility`，以及 Comprehensive 的 `content_structure_fitness`、`resource_content_consistency`。该引用只证明 Reviewer 实际核对了固定权威；finding 的 subject 仍必须指向需要修订的项目 artifact，不能把只读合同列为修复对象。

## 4. 单一输入合同

Reviewer 同时服从三层不可互相替代的权威：

1. **Confirmed Brief**：产品目标、范围、目标设置与语言权威；
2. **System Delivery Contract**：系统唯一交付格式、根目录、Schema、内容权属和资源加载规则；
3. **Project Artifacts**：当前游戏的玩法、视觉、交互、音频、资源职责与验收事实。

项目文档即使彼此一致，只要违反 Confirmed Brief 或 System Delivery Contract，仍然必须产生 blocking finding。Reviewer 不得用“跨文档一致”替代“整体符合权威”。

每个 revision 只创建一个 durable Review Cycle。Cycle 以固定 check 顺序作为唯一游标，任何时刻只能有一个 active packet；前一个 packet 未被接受时不得派发后一个，同一 Cycle 禁止并行 Reviewer。Foundation 的 12 项结论按五个固定事务 packet 执行：权威与完整性 3 项、策略与经济 2 项、数值与节奏 2 项、场景/技术/表现 4 项、可验收性 1 项。策略与经济共享玩家选择、资源流与成长约束；数值与节奏共享公式边界、压力/能力曲线与尖峰恢复推导。不得把这四项重新合成一个包含十二项 criterion assessment 的大事务。packet 只合并一次模型审计与共享 artifact 投影，不合并 check 身份、criteria、finding owner 或 evidence digest。进入 Comprehensive 时，服务端必须逐项核对已批准 Foundation check 的 evidence digest；十二项全部保持新鲜时，将它们作为同一 Comprehensive Cycle 的有序已完成前缀，新增 5 项各自使用单项 packet。任一 Foundation check 失鲜时不得部分拼接或跳过中间 check，而是从 Foundation 顺序重新审计。每个 active packet 只接收其 checks、固定 criteria、frozen revision、此前已接受 finding 的唯一归属索引和完成判断所需权威投影；执行时间不设固定总时限。

Reviewer 只接收服务端生成的当前 revision 投影。同一 `cycleId + frozen revision + source artifact digests` 必须只创建一个串行 Reviewer execution session：会话首轮一次性接收不变的 Reviewer 指令、Confirmed Brief、System Delivery Contract、完整 frozen artifact dictionary 与 reference index，之后每个 active packet 只追加 `currentCheckIds`、固定 criteria、逐 check 允许路径、相关 prior findings 和 Closure diff。会话只是同一 durable Cycle 的可丢弃执行缓存，不保存另一份 check、finding、cursor 或 verdict；每个 packet 仍独立事务提交，前一个未接受时禁止发送后一个。进程退出或会话损坏时，服务端从 canonical artifacts、durable cursor 和当前 frozen revision 重建一个会话，不兼容或重放未接受的模型正文。

Reviewer 原生提交工具在整个 execution session 中必须使用固定 wire Schema；当前 packet 的精确 check 数量、顺序、criteria、reference 权限和 Closure 边界继续由服务端唯一 submission contract 校验。不得为每个 packet 重新生成不同工具 Schema，也不得为了固定 Schema 放宽语义校验。静态工具说明和固定 Schema 位于模型输入稳定前缀，run ID、workspace、packet cursor 与其他动态字段位于尾部。服务端进程内 projection cache、同一 execution session 的上下文复用和模型提供商输入缓存是三件事，验收必须分别测量，不得以对象复用或同一字符串宣称 Token 已复用：

- 确认简报与语言合同；
- 当前固定 System Delivery Contract；
- 当前阶段允许审计的完整文档；
- 当前唯一 active packet、其有序 checks 及固定 criteria；
- 五项结构化设计 check 的固定 criterion 与结构化推导结果；
- prior findings、当前 repair batch 和 server diff；
- Comprehensive 阶段的 canonical modular v8 Manifest；
- 从内容文件安全解析出的 `schema`、`id`、`kind`、`fulfills`、`resources` 与文件路径；
- 从同一批 frozen artifacts 确定性派生的稳定 `referenceId` 索引：wire view 用一次性 artifact dictionary 保存路径，各 reference 只携带 artifact ID 与 exact anchor；服务端仍维护 `referenceId -> canonical path + exact anchor` 唯一映射。Reviewer 的 evidence 与 subject 只提交 `referenceId`，不得手抄路径或标题；
- 当前 Catalog provenance 和确定性资源门禁结果。

投影是 request view，不落盘、不成为第二份合同。服务端对同一 `cycleId + frozen revision + source artifact digests` 只构建一次 artifact dictionary、reference index 与结构化内容投影，并可在进程内有界复用；digest 不一致、Cycle 结束或进程重启时必须丢弃并从 canonical artifacts 重建。该缓存不进入 workflow snapshot、不携带审计结论，也不能绕过持久化边界对当前 artifacts 与 frozen revision 的复核。每个 check 的 artifact dependency 由唯一固定职责矩阵在文档级静态声明；packet 可以传输这些依赖的并集，但服务端必须逐 check 拒绝引用其自身依赖范围外的 evidence 或 subject，并把逐 check 允许路径投影给 Reviewer。check freshness 哈希该 check 的完整依赖投影，而不是只哈希模型主动引用的 evidence；因此相关但漏引的文档变化同样会使 approval 失鲜。不得用关键词、正则、LLM 摘要或案例内容动态猜测依赖。投影不得截断语义 ID，不保存候选搜索历史，不包含 Agent 自报验证结论，也不包含构建日志或运行验收事实。

Reviewer 的可审计语义只写入当前 packet 的 criterion `status/evidence/derivation/conclusion` 与 finding 字段。check `status`、check evidence 并集、finding IDs 和 Cycle verdict 均由服务端从这些字段确定性派生；模型不得重复提交 check 级 conclusion 或 evidence。thinking 保持模型与运行时的正常能力，不得关闭、截断或作为第二份审计事实持久化。每个 dispatch 必须且只能提交当前完整 packet；不能提交 packet 外 check、整轮 verdict 或整轮报告。Reviewer 不存在 wall-clock deadline、terminal grace deadline 或 Token 上限；连接断开或进程退出只能中断当前 packet 并保留 durable cursor。

稳定引用索引只用于让 Reviewer 选择 frozen artifacts 已存在的身份，不产生新事实。check `evidence` 是整项检查的总体事实范围，criterion `evidence` 是对应推导的事实范围；每个 finding 还必须独立提交形成该 finding 所需的精确 `evidence`。finding `subjects` 是当前内容违反权威且必须实际改变、并由 Closure 核对 diff 的完整修订范围；`requiredOutcome` 只定义修订后必须成立的唯一权威结果，不提供互斥修法或编辑步骤。已经正确表达最高权威、仅用于证明冲突或约束修法的文档只能列入 finding evidence，不得列入 subjects。服务端在接受当前 packet 前，将其中每项 `referenceId` 唯一解析为 canonical path/anchor；全部通过后才把 packet 的独立 checks 写入同一个 Review Cycle。Repair Lead 只读取当前 finding 的 subjects、finding evidence、blocking impact、required outcome 及其明确引用的 System Delivery Contract 片段，不得以 check evidence 扩大到整份文档。Foundation 文档可以作为 resource check 的 evidence，但不能成为 resource finding 的修复 subject。

同一根缺陷只能由固定顺序中最先负责它的 check 建立一个 finding；同一 packet 内由最早负责项持有，后续 packet check 只获得其 artifact dependency 范围内此前已接受 finding。服务端投影原 check 位于当前 packet，或 finding evidence/subjects 与 packet artifact 相交的记录，不能由模型自选。用于跨 packet 去重的 prior-finding 投影只携带稳定 ID、原 check、evidence/subjects reference、owner 与 required outcome；只有 Closure 当前负责复核的 finding 才投影完整 observation 与 blocking impact。该紧凑投影由唯一 durable ledger 即时派生，不删除字段、不落盘、不形成第二 ledger。若当前判断依赖同一缺陷，只引用该既有 finding 作为阻塞上下文，不得以新 ID 重复提交。唯一归属由固定 check 职责和相关 prior finding 完整语义约束，服务端严格拒绝 packet 内和 ledger 中的 finding ID 重用；不得使用关键词、正则或自然语言相似度猜测重复关系。

Durable review state 只保存 revision、artifact digest、按固定顺序已接受的 check ledger、统一 finding ledger、repair owner、changed paths、check evidence digest 与最终 evidence。当前 packet 的结构化 submission 必须在原生提交工具返回 `accepted` 前，通过 Workflow 唯一的 revision-bound packet contract 完成全部 check、criterion、referenceId、finding、subject 与 closure 校验；提交工具与持久化边界调用同一个规范化和校验实现。packet 内任一项被拒绝时不得持久化任何 check 或 finding；Reviewer 在同一 dispatch 纠正完整 packet。已经持久化的前序 packet 不回滚、不重算。进程中断后从第一个未完成 packet 恢复，仍使用同一 Cycle 和 frozen revision。

submission contract 错误只能在当前 packet 内修正。一个 packet 对应一个语义 dispatch；模型进程或网络在 accepted submission 前中断，只能恢复当前 packet，不能携带未接受正文或创建替代协议。多个串行 packet 都提交到同一个 Cycle ledger，不是多套 Reviewer、第二事实源或双轨。

### 4.2 唯一汇总规则

Reviewer 不提交整轮 verdict。最后一个 required check 被接受后，服务端从同一 ledger 确定性派生唯一结论：全部 check 为 `pass` 且 finding ledger 为空时为 `READY`；存在任一 `block` 且每个 blocking check 都有合法 finding 时为 `NEEDS_REVISION`。服务端随后一次性冻结完整 finding batch 并进入唯一修订流程。任何 finding 都不得在其他 required check 尚未完成时触发修订。

### 4.1 System Delivery Contract

System Delivery Contract 由服务端当前常量结构化生成，是只读 request view，不写入项目、不由 Agent 修改，也不允许项目文档重新定义。至少包含：

- 唯一 Manifest：`assets/asset-manifest.json`；
- Manifest 版本：canonical modular v8；
- runtime asset root：`assets/runtime`；
- content root：`assets/content`；
- generated adapter root：`assets/generated`；
- 内容 Schema：`beegame-content-v1`；
- 每个内容文件必须包含 `schema`、`id`、`kind`、`fulfills`、`resources`、`data`；
- `fulfills` 只能引用当前 Manifest 中的 requirement ID；内容到批准职责的追踪通过这些稳定 requirement 完成，不得写文档名、标题、段落或另造职责 ID；
- `resources` 只能引用当前 Manifest 中的 resource ID；物理路径只由 Manifest 拥有；
- JSON kinds：`resource-registry`、`entity-definitions`、`ui-configuration`、`audio-configuration`、`event-definitions`、`wave-definitions`、`numeric-configuration`；
- YAML kinds：`world-definition`、`scene-definitions`、`hierarchy-definition`、`placement-definitions`；
- JSON/YAML 同一事实不得双写；
- 资源文件、placeholder 和最终媒体只通过 canonical Manifest 与内容引用加载；
- 禁止第二 Manifest、第二内容根、第二 Schema、运行时/源码媒体替代和第二加载器分支。

这些是引擎中立的 BeeGame 交付边界，不规定 React、Unity、Godot 或其他引擎内部对象。目标实现可以在消费边界之后选择最简单的引擎原生加载方式，但不能改变项目交付合同。

## 5. Finding 合同

每个 finding 至少包含：

- 稳定 `findingId`；
- `checkId`；
- 当前合法 artifact subject；
- 精确位置或稳定语义 ID；
- 可观察冲突；
- 为什么阻塞当前门禁；
- 修订后必须成立的唯一 `requiredOutcome`。

每个 subject 的当前内容都必须违反同一 finding 的权威约束并为达成 `requiredOutcome` 而改变；反之，达成结果必须改变的每条 canonical 路径都必须出现在 subjects。跨文档检查可以引用多份 evidence，但不得把无需改变的正确权威或佐证文档扩大成修订 subject。若冲突由唯一事实 owner 的错误引起，而消费者已经正确委托该 owner，则只把事实 owner 列为 subject；Repair Lead 无权在 accepted finding 之后缩减或扩大该集合。

`owner` 与 `severity` 不是 Reviewer 可填写的第二份事实：服务端按固定 `checkId` 矩阵唯一派生 `foundation`、`checklist` 或 `resource`，并将所有 finding 定义为 blocking。Foundation subject 只能引用八份基础文档；Checklist subject 只能引用验收清单；Resource subject 只能引用 Manifest requirement/resource ID 或内容文件 ID。Reviewer 若引用不存在的 ID，terminal 无效，不能把格式错误伪装成业务 finding。

提交工具必须按当前 scope、mode 和 active packet 生成唯一 Schema：Foundation 只暴露文档 `path/anchor`；Comprehensive 才暴露资源语义 ID；Initial 不暴露 `regressionPaths`；Closure 才允许它引用 server 提供的 changed paths。原生工具顶层只暴露一个定长有序 `checks` 数组，每项的模型可见 JSON Schema 必须直接声明 `conclusion`、`evidence`、`assessments` 与 `findings`，assessment 必须直接声明 `criterion/status/evidence/derivation/conclusion`；禁止用 `unknown` item 加隐藏 refinement 代替模型可见合同。服务端从同一 criteria 常量确定性投影当前 packet 的 `criteriaByCheck`，模型按数组位置使用对应精确 criterion ID。工具输入不得暴露可由 packet 位置派生的 check `id/status/findingIds`、finding `checkId/owner/severity`。Reviewer 仍提交稳定 `findingId`；服务端从 durable cursor、数组位置、assessment 与 findings 确定性派生 check 身份、状态和 finding 关联。数组缺项、多项、乱序或任一项非法都拒绝整个 packet。

持久化的 Reviewer terminal 只有在其 request `currentCheckIds` 与当前 Cycle 游标派生的唯一 active packet 完全一致时才允许重放。packet 定义改变、旧进程迟到或恢复快照携带过期边界时，服务端必须丢弃该未接受 terminal 并从 durable Cycle 重新派发当前 packet；不得兼容解析旧 packet、拆取其中部分结果或建立迁移队列。

## 6. 审计原则

### 6.1 Requirement 与资源

Requirement 来自批准文档，不是 Catalog query 或 slot。Reviewer 判断现有资源与内容描述是否足以承担需求，但不替 Resource Agent 选 Pack，也不从文件名推断含义。

### 6.2 Placeholder

找不到合适库内资源时，独立、可替换、位于正常资源目录的 placeholder 是合法资源。它与正式资源使用同一 resource ID 和同一 JSON/YAML 引用方式。Reviewer 可以因 placeholder 不满足已批准的质量、结构或可加载要求提出 finding，但不能仅因其为 provisional 而阻塞。

### 6.3 内容描述

- JSON 拥有稳定映射、实体定义、UI/音频映射、事件、波次、数值和其他机器数据；
- YAML 只拥有世界、场景、层级和实例摆放；
- 同一事实不得双写；
- 一个内容文件可以覆盖多个 requirement；
- 不要求每个 requirement 生成一个文件；
- 不接受中间组装身份、assembly status、member binding 或第二资源身份。

### 6.4 引擎中立

Reviewer 审计可观察需求、资源引用与内容结构，不得要求 Prefab、TSX、WOFF2、特定 Scene 格式或某个平台专用加载方式。目标格式适配由项目目标与实现负责。

引擎中立不等于允许项目自建另一套 Manifest、内容根或 Schema。System Delivery Contract 是 BeeGame 项目交付边界；引擎适配发生在该边界之后。

## 7. 收敛算法

首次 Foundation Drafting 不属于 Reviewer 收敛循环。它必须由唯一 durable cursor 按八份 canonical 文档的固定顺序逐份完成；Initial Author 不生成 finding、不执行 remediation、不做 Closure，也不得继承前一文档的模型对话。八份全部完成并形成完整 revision 后，以下 Reviewer 算法才开始。

1. Initial Review 对当前 scope 执行一次完整审计。
2. 原生 terminal 工具在返回 accepted 前，用唯一 revision-bound submission contract 验证 check coverage、criteria、anchors、subjects 与 closure；最终持久化只复用同一校验器并确认 frozen revision 未变化。
3. findings 按 `foundation -> checklist -> resource` 分组；每次只派发当前最上游 owner 的完整 batch。
4. 服务端从 accepted finding ledger、canonical subjects、最高事实 owner 与固定文档依赖矩阵确定性建立 repair graph，并按连通分量形成 coherent repair groups。共享 subject/owner 或存在明确 owner 依赖的 findings 归入同组；无关 findings 不得合并。分组不使用关键词、正则、自然语言相似度或 Agent 判断。Repair Lead 在一次只读 dispatch 中接收完整、有序的 repair graph，并按服务端顺序为每个 group 提交恰好一份最小修订决策；服务端拥有 group identity、finding IDs、affected paths 与 `dependsOn`，模型只提交与 group 数量严格相等的 ordered decisions。后续 group 必须保持前序依赖 outcome，不得重开依赖 group。任一 decision 非法则整份 plan 零落盘，不允许逐 group 派发、部分 plan 或第二规划队列。
5. 完整 repair plan 被原子接受后，服务端按 graph 拓扑序派生串行 document repair cursor；每个 Foundation Owner task 只通过一次 `CommitCanonicalDocument` 提交一份 canonical 文档并形成 durable receipt/checkpoint。完整 batch、finding ledger、repair plan 和 Closure 均只有一个，不得把 owner task 建成第二队列或并行 lane。
6. Closure Review 的 required checks 由服务端从当前 target 的固定候选矩阵、accepted finding 所属 check、server diff 的 changed paths 与 check artifact dependency 确定性求交派生；候选 check 的固定 finding owner 必须等于当前 remediation target，禁止派发一个能够发现问题却被 owner 合同禁止提交 finding 的检查。至少包含每个待关闭 finding 的原 check，并只加入读取了已修改 artifact 的同 owner 候选 check。不得固定重跑整个 Foundation/Comprehensive 矩阵，不得由 Agent 自选影响范围，也不得依赖关键词、正则或自然语言相似度。Closure 复核 prior findings、服务端选中的受影响 checks 及其精确 artifact dependency；在这些 checks 内发现 Initial Review 遗漏但当前仍真实存在的缺陷时，必须提交新的稳定 finding ID，即使其 subject 位于未修改 artifact。只有能够证明由 server diff 直接引入的缺陷才声明 `regressionPaths`，且路径必须来自 changed paths。
7. Closure packet 对单一 finding ledger 执行替换语义：`cycle.findings` 保留该 Cycle 已接受的完整 finding 身份历史，不删除已关闭条目；当前 open 集合只由最新 `cycle.checks[].findingIds` 确定性派生，不增加 status 字段、墓碑列表或第二 ledger。某个 prior finding 未再次提交表示其原 check 的最新结论不再引用该 ID，因此已关闭；再次提交同一 ID 表示同一问题仍未关闭，并且必须保持原 `checkId`、owner 与 `requiredOutcome` 完全不变，只更新当前证据、subjects、observation 和 blocking impact；不同问题必须使用在完整 ledger 中从未出现的新 ID。原生 terminal 与最终持久化必须调用同一校验函数，不得先接受再以“ID already accepted”拒绝。已经关闭的 ID 不得在后续 packet 中代表另一个问题。完整 identity ledger 只供服务端校验；Reviewer request 只投影与当前 packet artifact dependency 相交的 open findings。
8. 上游变更确定性失效受影响的下游 approval。Foundation 修订发生在资源前时重新生成并审计 Checklist；Checklist 只允许在资源前自己的 Cycle 内修订。进入 Resource Production 后 Foundation 与 Checklist 均冻结，Comprehensive 只能产生 resource finding。库存 checkpoint 只因 Manifest plan、resource record 或本地资源文件变化而失效；Checklist 的无关摘要变化不得触发库存重跑。不得用跨 owner Closure check 强行复用基于旧上游 artifact 的结果，也不重新开放无关全文审计。
9. 自动修订不设置次数上限；每轮只处理当前 accepted finding，并持续闭环到 Closure 通过、出现明确基础设施错误或用户停止。

wire view 可以把 artifact 正文渲染为清晰分隔块、把 Confirmed Brief 保持为结构化值并省略模型无需回传的重复字段，但不得发明压缩语义或第二解析协议。性能验收必须按 packet 记录 check IDs、dispatch duration、input tokens、cache-read tokens、completion tokens、artifact count、artifact bytes、reference count、prior finding count 与 rejected submission count；这些度量只进入既有 Workflow event/usage 观测，不进入审计事实或 finding ledger。本方案不授权并行 active packet 或多 Reviewer。

Reviewer finding 只保留 `observation`、`blockingImpact` 与 `requiredOutcome` 三项语义：分别说明当前冲突、为何阻塞、修订后唯一必须成立的结果。不得在 `requiredOutcome` 中列出多个互斥方案、修改步骤或让 Repair Lead 选择是否遵守 Confirmed Brief/System Delivery Contract。具体修法由 Repair Lead 在原 active cycle 中锁定；Closure 只依据同一 `requiredOutcome` 判断结果是否关闭原 finding，不把 repair plan 提升为项目审计权威。

每个 Agent dispatch 的职责与输入独立受控，但 Reviewer、Repair Lead、Document Author 与 Resource Agent 均不设置固定业务墙钟、durable-progress idle、terminal grace、累计 token 或自动修订次数截止线；已接受 check 与 repair decision 已经是同一 Cycle 的 canonical ledger，不是部分结果缓存。只有连接断开、worker 进程退出、用户停止或明确终态等可观察事件可以结束当前 dispatch；经过时长、累计 token、修订轮次、网络慢、模型持续输出或尚未产生文件 mutation 都不是业务失败。不得增设整轮提交工具、prose parser、自动续写或第二事实源。

Foundation 与 Checklist canonical 文档不允许模型手写 metadata 或使用通用文件 mutation。`CommitCanonicalDocument` 接收正文，服务端在同一原子提交边界生成稳定 `document_id`、PATCH 版本与严格单调的 UTC `updated_at`，并以 dispatch-bound write-ahead receipt 保证崩溃恢复和幂等 cursor 推进。正文已写入但 cursor 未推进时必须从 receipt 对账，禁止重新派发同一语义修订。修复必须提升相应文档 PATCH 版本；资源或内容修复提升 Manifest revision。版本变化用于证据失效，不等同于自动通过。

Reviewer 的权威方向不可逆：低权威文档可以细化已批准行为，但不能凭自身声明创造产品级系统并反向要求高权威或其他消费者补齐。发现这类 scope accretion 时，subject 指向越权的低权威声明，`requiredOutcome` 要求删除或收窄；仅当 Confirmed Brief/GDD 或合法事实 owner 已明确授权且消费者遗漏时，finding 才能要求消费者扩建。该判断属于 `brief_alignment` 与 `cross_document_consistency` 的固定职责，并在后续 checks 通过 prior finding ledger 复用，不得重复建立扩建 finding。

## 8. 状态与界面

Workflow Card 的阶段、task 与 icon 必须来自 durable review 状态：

- Initial Review：`正在审计完整文档基线`；
- Initial Drafting：显示当前唯一 canonical 文档及八文档 durable 完成进度；当前文档成功后自动推进，不把 Author thinking 或自我检查显示成 Reviewer task；
- Repair：`正在修订审计发现`，逐项显示 finding closure；
- Closure Review：`正在复核本轮修订`；
- READY：任务完成 icon；
- failed / needs_action：错误 icon 与真实错误 popover，计时停止；
- retry / continue 恢复同一 durable dispatch，不重置累计运行时长。

Card 标题旁的主进度显示服务端确定性派生的 delivery progress stage，而不是持久化 worker 类型或 task 完成数。可见阶段固定为 11 项：`Brief -> Foundation Drafting -> Foundation Initial Review -> Foundation Document Convergence -> Resource Preparation -> Comprehensive Convergence -> Atomic Task Planning -> Implementation -> Implementation Audit -> Acceptance -> Delivery`。Foundation repair、Foundation Closure、Checklist drafting 及其独立 Initial Review/Repair/Closure 属于第 4 阶段；资源生产属于第 5 阶段；资源之后的 Comprehensive Initial Review 及其 resource remediation/Closure 属于第 6 阶段。它们可以复用既有 durable `DOCUMENT_DRAFTING`、`DOCUMENT_REVIEW`、`RESOURCE_PREPARATION` 执行路由，但界面不得因 worker 路由复用而阶段倒退。该投影只由 durable phase、document step、Cycle `originScope` 与 active target 派生，不落盘、不成为第二状态。task 完成数仅在 task 列表区域显示为 `任务 completed / total`。前端不得复制阶段顺序或用当前 task 数伪装阶段进度。

第 4、6 阶段必须同时投影唯一的收敛子阶段，不允许只显示底层 Worker 路由。子阶段固定为 `INITIAL_REVIEW -> REPAIR_PLANNING -> REPAIRING -> CLOSURE_REVIEW -> CHECKLIST_DRAFTING` 的适用子集；`repairPasses[activeTarget]` 是唯一轮次来源。Card 必须显示类似“第 2 轮 · Closure Review”的业务位置。每个子阶段的 task 分母只描述当前子阶段，切换子阶段时必须同时改变标题与任务语义，不能把不同分母伪装成同一条累计进度。`DOCUMENT_DRAFTING`、`DOCUMENT_REVIEW` 以及 Worker 类型只能出现在执行详情中，不能决定业务标题。

Cycle 的 `acceptedSemanticResult` 只表示当前 required check packet 集合已完整接受，不代表审计通过。它是内部收敛判定，禁止直接输出为前端 `reviewAccepted` 或由前端据此猜测 Repair。服务端必须从同一 durable Cycle 确定性派生 `substage`、`reviewMode`、`reviewTarget` 与 `convergencePass`；该 view 不落盘，不构成第二状态。

审计 task 必须按固定顺序展示真实游标：已进入 ledger 的 check 为 completed，active packet 内 checks 为 running，后续 checks 为 pending；停止或失败只影响当前 packet。UI 仍显示 12 个独立 check，不新增 packet 事实状态。

不得沿用“撰写文档”task 表示 Reviewer，也不得从聊天文案推断状态。

## 9. 删除清单

- 中间组装审计与装配前置条件；
- Manifest 中间组装投影；
- 中间组装 subject、finding 和 task；
- open-ended re-review loop；
- keyword/regex owner routing；
- reviewer prose parser；
- 平行 finding store；
- 替代 terminal、替代 reader 或双写状态。
- 八文档初稿单 dispatch、`existingDocumentPaths` 续写、初稿 finding/repair/Closure、跨文档对话摘要和 Author 自我反馈循环。

## 10. 验收

必须用全新项目完成以下链路：Foundation Drafting、Initial Review、批量修订、Closure、Checklist、Resource Production、Comprehensive Review、Implementation、Audit、Runtime Acceptance 和 Delivery。

验收同时确认：

1. Review task/icon 随真实子状态变化；
2. JSON/YAML 与 Manifest 只存在一个 owner；
3. placeholder 不会因库内无匹配而停止项目；
4. invalid check submission 不会变成业务 finding，也不会抹除已接受 check；
5. 修订次数不构成停止条件；重启和继续保留同一 Cycle、finding ledger、累计时间与修订计数；
6. 没有中间组装 phase、身份、双轨或替代 reader；
7. 系统 Chrome 能打开交付项目并按 Checklist 完成真实玩家路径。
8. 至少使用结构不同的全新项目证明 Reviewer 能阻止无意义选择、支配策略、经济死锁/套利、数值无解、难度断层、空间不支持和场景状态缺口，而不是只发现格式或跨文档冲突。
9. 任一时刻只有一个 active packet；重启后从第一个未完成 packet 恢复；12 项全部进入同一 ledger 前不产生 verdict、不进入修订。
10. Reviewer submission 不含自由文本 path/anchor，也不存在任何巨型终态提交通道。
11. 第 4、6 阶段显示唯一 `substage + convergencePass`；Repair planning、文档修订与 Closure 的 task 分母互不混用，前端不读取 `acceptedSemanticResult`。
