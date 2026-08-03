# BeeGame Document Reviewer 单轨收敛方案

## 1. 目标

Document Reviewer 在实现前发现跨文档、资源与内容描述之间的真实矛盾，并通过有限、可追溯的修订收敛。Reviewer 只审计，不修改；Workflow 只路由结构化 finding，不解释游戏语义。

本方案只有一套 review state、finding、owner、revision 和终态。禁止全文循环重审、自然语言状态推断、兼容 reader、feedback、shadow finding 或第二修复队列。

## 2. 审计时序

```text
八份 Foundation 文档（`beegame-foundation-document-authority-plan.md` 定义）
  -> Foundation Initial Review
  -> 按 owner 批量修订
  -> Foundation Closure Review
  -> Gameplay Checklist
  -> Resource Production（Manifest + 资源文件 + JSON/YAML 内容描述）
  -> Comprehensive Initial Review
  -> 按 owner 批量修订
  -> Comprehensive Closure Review
  -> Atomic Task Planning
  -> Implementation
```

Foundation Review 不得要求尚未创建的 Checklist、Manifest、资源或运行证据。Comprehensive Review 可以审计当前 Manifest 与 `assets/content/**/*.json|yaml` 的语义适配，但不能要求尚未实现的代码、构建或运行证据。

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

### 3.2 Comprehensive additions

- `checklist_traceability`
- `resource_semantic_fitness`
- `content_structure_fitness`
- `resource_content_consistency`
- `implementation_readiness`

Comprehensive 的固定集合不是替换 Foundation，而是严格并集：

```text
COMPREHENSIVE_CHECKS = FOUNDATION_CHECKS + COMPREHENSIVE_ADDITIONS
```

因此 Foundation 固定为 12 项，Comprehensive 固定为 17 项。不得重命名、替换、拆分或按案例新增顶层 check；新发现的审计规则必须归入已有 check 的职责。

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

`gameplay_strategy_viability`、`economy_progression_integrity`、`numeric_balance_feasibility`、`pacing_difficulty_coherence` 与 `level_scene_design_integrity` 不是对文档中是否出现相关章节的关键词检查。每项 check 必须提交以下固定 criterion，且每个 criterion 必须有独立状态、精确 artifact evidence、推导过程和结论。父 check 的 evidence 支撑总体结论，criterion evidence 支撑各自推导；两者都独立验证 artifact 与 anchor，不要求重复同一证据项。服务端将两层 evidence 的 artifact digest 合并为该 check 的唯一失效依据。Finding 只由父 check 的 `findingIds` 统一关联，criterion 不重复提交 `findingIds`：

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

每个 revision 只创建一个 durable Review Cycle。Cycle 以固定 check 顺序作为唯一游标，任何时刻只能有一个 active check；前一项未被接受时不得派发后一项，同一 Cycle 禁止并行 Reviewer。Foundation 严格按 3.1 的 12 项顺序执行，Comprehensive 在其后继续 3.2 的 5 项。每个 check 的输入与职责必须有界，只接收该 check、固定 criterion、frozen revision 和完成判断所需的权威投影；执行时间不设固定总时限，因为项目复杂度、网络状态和模型响应时间不是业务失败条件。`cross_document_consistency` 等确需全局判断的 check 可以读取完整 frozen artifact set，但不得因此合并其他 check 的结论。

Reviewer 只接收服务端生成的当前 revision 投影：

- 确认简报与语言合同；
- 当前固定 System Delivery Contract；
- 当前阶段允许审计的完整文档；
- 当前唯一 active check 及其固定 criterion；
- 五项结构化设计 check 的固定 criterion 与结构化推导结果；
- prior findings、当前 repair batch 和 server diff；
- Comprehensive 阶段的 canonical v7 Manifest；
- 从内容文件安全解析出的 `schema`、`id`、`kind`、`fulfills`、`resources` 与文件路径；
- 从同一批 frozen artifacts 确定性派生的稳定 `referenceId` 索引：服务端维护 `referenceId -> canonical path + exact anchor` 映射；Reviewer 的 evidence 与 subject 只提交 `referenceId`，不得手抄路径或标题；
- 当前 Catalog provenance 和确定性资源门禁结果。

投影是 request view，不落盘、不成为第二份合同。它不得截断语义 ID，不保存候选搜索历史，不包含 Agent 自报验证结论，也不包含构建日志或运行验收事实。

Reviewer 的可审计推理只写入当前 check submission 的 conclusion、criterion derivation/conclusion 与 finding 字段。运行时必须关闭 extended thinking，禁止生成与 submission 竞争输出预算的第二份长推理。每个 dispatch 必须且只能提交当前 check；不能提交其他 check、整轮 verdict 或整轮报告，也不能依靠 `max_tokens` 续写或提高输出上限完成另一项检查。Reviewer 不存在 wall-clock deadline 或 terminal grace deadline；只要 worker 进程、模型流、工具调用或终态提交仍然存活，Workflow 不得按经过时长停止它。连接断开、进程退出等基础设施失活只能中断当前 check 并保留 durable cursor，不能把项目复杂度记录为失败。

稳定引用索引只用于让 Reviewer 选择 frozen artifacts 已存在的身份，不产生新事实。`evidence` 是形成判断时读取的事实范围，不代表文件必须修改；finding `subjects` 是 `requiredAction` 确认必须实际改变并由 Closure 核对 diff 的完整修订范围。已经正确引用唯一事实 owner、仅用于证明冲突或约束修法的消费者文档只能列入 evidence，不得列入 subjects。服务端在接受当前 check 时将 `referenceId` 唯一解析为 canonical path/anchor 后写入同一个 Review Cycle；不存在自由文本锚点兼容、模糊匹配或自动修正。Foundation 文档可以作为 resource check 的 evidence，但不能成为 resource finding 的修复 subject。

Durable review state 只保存 revision、artifact digest、按固定顺序已接受的 check ledger、统一 finding ledger、repair owner、changed paths、check evidence digest 与最终 evidence。当前 check 的结构化 submission 必须在原生提交工具返回 `accepted` 之前，通过 Workflow 唯一的 revision-bound check contract 完成 check、criterion、referenceId、finding、subject 与 closure 校验；提交工具与持久化边界必须调用同一个规范化和校验实现，不得各自维护规则。被拒绝的调用不算完成，Reviewer 必须在同一 dispatch 纠正当前 check；已经持久化的前序 check 不回滚、不重算。进程中断后从第一个未完成 check 恢复，仍使用同一 Cycle 和 frozen revision。Closure 的 server diff 由修复前后的 digest 计算，只传路径及前后 digest；不得保存完整文档副本、完整 Reviewer request 或第二份可恢复正文。

禁止以 `transportCorrection`、整轮重审或任何 feedback lane 修复 submission contract 错误。一个 check 对应一个语义 dispatch；模型进程或网络在 accepted submission 前中断，只能恢复当前 check，不能携带未接受正文或创建替代协议。多个串行 check dispatch 都提交到同一个 Cycle ledger，不是多套 Reviewer、第二事实源或双轨。

### 4.2 唯一汇总规则

Reviewer 不提交整轮 verdict。最后一个 required check 被接受后，服务端从同一 ledger 确定性派生唯一结论：全部 check 为 `pass` 且 finding ledger 为空时为 `READY`；存在任一 `block` 且每个 blocking check 都有合法 finding 时为 `NEEDS_REVISION`。服务端随后一次性冻结完整 finding batch 并进入唯一修订流程。任何 finding 都不得在其他 required check 尚未完成时触发修订。

### 4.1 System Delivery Contract

System Delivery Contract 由服务端当前常量结构化生成，是只读 request view，不写入项目、不由 Agent 修改，也不允许项目文档重新定义。至少包含：

- 唯一 Manifest：`assets/asset-manifest.json`；
- Manifest 版本：canonical v7；
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
- closure condition。

每个 subject 都必须被同一 finding 的 `requiredAction` 明确要求改变；反之，`requiredAction` 要求改变的每条 canonical 路径都必须出现在 subjects。跨文档检查可以引用多份 evidence，但不得把无需改变的佐证文档扩大成修订 subject。若冲突由唯一事实 owner 的错误引起，而消费者已经正确委托该 owner，则只把事实 owner 列为 subject；Repair Lead 无权在 accepted finding 之后缩减或扩大该集合。

`owner` 与 `severity` 不是 Reviewer 可填写的第二份事实：服务端按固定 `checkId` 矩阵唯一派生 `foundation`、`checklist` 或 `resource`，并将所有 finding 定义为 blocking。Foundation subject 只能引用八份基础文档；Checklist subject 只能引用验收清单；Resource subject 只能引用 Manifest requirement/resource ID 或内容文件 ID。Reviewer 若引用不存在的 ID，terminal 无效，不能把格式错误伪装成业务 finding。

提交工具必须按当前 scope 与 mode 生成唯一 Schema：Foundation 只暴露文档 `path/anchor`；Comprehensive 才暴露资源语义 ID；Initial 不暴露 `regressionPaths`；Closure 才允许它引用 server 提供的 changed paths。工具输入不得暴露可由 check 矩阵派生的 `owner`、固定为 blocking 的 `severity`，或 criterion 层重复的 `findingIds`。禁止用一份宽松 Schema 同时承载四种协议后再靠提示词约束。

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
- 不接受 `cmp-*`、assembly status、member binding 或第二资源身份。

### 6.4 引擎中立

Reviewer 审计可观察需求、资源引用与内容结构，不得要求 Prefab、TSX、WOFF2、特定 Scene 格式或某个平台专用加载方式。目标格式适配由项目目标与实现负责。

引擎中立不等于允许项目自建另一套 Manifest、内容根或 Schema。System Delivery Contract 是 BeeGame 项目交付边界；引擎适配发生在该边界之后。

## 7. 收敛算法

首次 Foundation Drafting 不属于 Reviewer 收敛循环。它必须由唯一 durable cursor 按八份 canonical 文档的固定顺序逐份完成；Initial Author 不生成 finding、不执行 remediation、不做 Closure，也不得继承前一文档的模型对话。八份全部完成并形成完整 revision 后，以下 Reviewer 算法才开始。

1. Initial Review 对当前 scope 执行一次完整审计。
2. 原生 terminal 工具在返回 accepted 前，用唯一 revision-bound submission contract 验证 check coverage、criteria、anchors、subjects 与 closure；最终持久化只复用同一校验器并确认 frozen revision 未变化。
3. findings 按 `foundation -> checklist -> resource` 分组；每次只派发当前最上游 owner 的完整 batch。
4. Foundation Repair Lead 在一个只读 planning dispatch 中把完整 batch 归并为无环的根问题组，为每组锁定权威约束、唯一最小修订决策、受影响路径和依赖顺序；服务端验证后把 plan 写入同一 active review cycle。
5. 服务端从该 plan 派生唯一串行 document repair cursor；每个 Foundation Owner task 只修改一份 canonical 文档并形成 durable checkpoint。完整 batch、finding ledger 和 Closure 仍各自唯一，不得把 owner task 建成第二修订队列或并行 lane。
6. Closure Review 只复核 prior findings、server diff、固定受影响 checks 和直接 regression。
7. 已关闭 finding 不得在同一 revision 以新 ID 重新提出，除非 diff 产生了可证明的新冲突。
8. 上游变更确定性失效受影响的下游 approval；不重新开放无关全文审计。
9. 自动修订达到上限后进入 `needs_action`，保留真实 findings 和累计时间。

Reviewer 的 `requiredAction` 与 `closureCondition` 必须定义结果约束，但不得把互斥修法错误地伪装成多个 finding。具体修法由 Repair Lead 在原 active cycle 中锁定；Closure 只判断文档结果是否关闭原 finding，不把 repair plan 提升为项目审计权威。

每个 check dispatch 的职责、输入和 token 边界独立受控，但不设置固定墙钟或 terminal grace 截止线；已接受 check 已经是同一 Cycle 的 canonical ledger，不是部分结果缓存。基础设施失活时只中断当前 check；仍有模型流、工具活动或终态提交时必须继续等待。不得增设整轮提交工具、prose parser、自动续写或第二事实源。

修复必须提升相应文档 PATCH 版本；资源或内容修复提升 Manifest revision。版本变化用于证据失效，不等同于自动通过。

## 8. 状态与界面

Workflow Card 的阶段、task 与 icon 必须来自 durable review 状态：

- Initial Review：`正在审计完整文档基线`；
- Initial Drafting：显示当前唯一 canonical 文档及八文档 durable 完成进度；当前文档成功后自动推进，不把 Author thinking 或自我检查显示成 Reviewer task；
- Repair：`正在修订审计发现`，逐项显示 finding closure；
- Closure Review：`正在复核本轮修订`；
- READY：任务完成 icon；
- failed / needs_action：错误 icon 与真实错误 popover，计时停止；
- retry / continue 恢复同一 durable dispatch，不重置累计运行时长。

审计 task 必须按固定顺序展示真实游标：已进入 ledger 的 check 为 completed，唯一 active check 为 running，后续 check 为 pending；停止或失败只影响 active check。禁止把全部未完成 check 同时显示为 running。

不得沿用“撰写文档”task 表示 Reviewer，也不得从聊天文案推断状态。

## 9. 删除清单

- Composition Review 和 Composition Assembly 前置条件；
- Manifest `compositions` 投影；
- `cmp-*` subject、finding 和 task；
- open-ended re-review loop；
- keyword/regex owner routing；
- reviewer prose parser；
- finding feedback/shadow store；
- legacy terminal、fallback reader、双写状态与兼容测试。
- 八文档初稿单 dispatch、`existingDocumentPaths` 续写、初稿 finding/repair/Closure、跨文档对话摘要和 Author 自我反馈循环。

## 10. 验收

必须用全新项目完成以下链路：Foundation Drafting、Initial Review、批量修订、Closure、Checklist、Resource Production、Comprehensive Review、Implementation、Audit、Runtime Acceptance 和 Delivery。

验收同时确认：

1. Review task/icon 随真实子状态变化；
2. JSON/YAML 与 Manifest 只存在一个 owner；
3. placeholder 不会因库内无匹配而停止项目；
4. invalid check submission 不会变成业务 finding，也不会抹除已接受 check；
5. 修订次数有界，重启和继续不重置；
6. 没有 Composition phase、`cmp-*`、双轨、feedback、fallback 或兼容 reader；
7. 系统 Chrome 能打开交付项目并按 Checklist 完成真实玩家路径。
8. 至少使用结构不同的全新项目证明 Reviewer 能阻止无意义选择、支配策略、经济死锁/套利、数值无解、难度断层、空间不支持和场景状态缺口，而不是只发现格式或跨文档冲突。
9. 任一时刻只有一个 active check；重启后从第一个未完成 check 恢复；最后一项之前不产生 verdict、不进入修订。
10. Reviewer submission 不含自由文本 path/anchor，也不存在任何巨型终态提交通道。
