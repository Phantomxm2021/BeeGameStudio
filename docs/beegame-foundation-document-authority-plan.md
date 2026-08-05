# BeeGame 八文档基础设计权威与落地方案

## 1. 目标与权威范围

BeeGame 在进入 Gameplay Checklist、资源准备和实现之前，必须形成一套完整、可审计、引擎中立的游戏设计基线。本方案是 Foundation 文档集合、事实归属、生成顺序和审计覆盖的唯一权威；`beegame-document-reviewer-convergence-plan.md` 继续负责 Reviewer 的单轨状态与 finding 收敛，但不得与本方案定义的文档集合和 check matrix 冲突。

本方案只新增两个缺失的事实 owner：

- `docs/BALANCE_DESIGN.md`：数值、公式、经济、成长和压力/能力曲线；
- `docs/LEVEL_SCENE_DESIGN.md`：关卡序列、空间拓扑、场景状态和摆放约束。

其余既有文档保留并强化。禁止再为同一事实增加 `CONTENT_DESIGN`、`RESOURCE_SPEC`、`TEST_PLAN`、`PRODUCTION_PLAN` 或其他平行文档。运行时只接受本方案的文档集合与状态合同，也不得按项目名或关键词决定文档集合。

## 2. 唯一 Foundation 文档集合

Foundation 固定为以下八份文档：

1. `docs/GDD.md`
2. `docs/BALANCE_DESIGN.md`
3. `docs/LEVEL_SCENE_DESIGN.md`
4. `docs/TECHNICAL_DESIGN.md`
5. `docs/ART_DIRECTION.md`
6. `docs/UI_UX_SPEC.md`
7. `docs/AUDIO_DESIGN.md`
8. `docs/ASSET_PLAN.md`

八份文档必须在同一个 Foundation Drafting pass 中按固定依赖顺序串行完成；一个 pass 是同一 durable workflow 阶段和同一 Foundation revision，不是一个模型上下文、一个 transport turn 或一个八文档 dispatch。每份文档是一个独立 durable task，只允许一个 active Document Author dispatch、一个 canonical 路径和一次 `CommitCanonicalDocument`。完成后服务端自动推进下一份，八份全部完成前不得启动 Initial Reviewer。每份文档均以 YAML front matter 声明稳定 `document_id`、`MAJOR.MINOR.PATCH` 版本和 ISO 8601 UTC `updated_at`；三项元数据由 Workflow 服务在唯一提交边界生成，模型只提交 Markdown 正文。任一文档缺失、为空、越权拥有事实或缺少核心设计输入，Foundation 不得通过。

`docs/acceptance/gameplay-checklist.md` 不是 Foundation 文档。它只能在八份文档通过 Foundation Initial Review、必要修复和 Closure Review 后生成；生成后必须在进入资源阶段前完成独立 Checklist Initial Review、必要修复与 Closure，并由服务端封存其批准 revision。`assets/asset-manifest.json`、`assets/manifest/**`、资源文件及 JSON/YAML 可执行内容只能在 Checklist 批准封存后创建。

Checklist 一旦封存，Resource Production、Comprehensive Review、Implementation 与下游 Agent 只能读取，不能修改、提升版本或把它列为 finding subject。若下游发现冻结 Checklist 与批准 Foundation 不一致，这是资源前 Checklist Gate 的系统不变量失败，当前 run 必须停止在明确错误上；不得由资源阶段自动重开文档。只有显式重新开始上游规划 revision 才能产生新的 Checklist，旧资源证据随后按新 revision 重新建立。

## 3. 唯一事实归属

| 权威 | 唯一负责 | 不得负责 |
| --- | --- | --- |
| Confirmed Brief | 产品目标、交付范围、目标设置、语言与资源库策略 | 详细游戏设计或运行数据 |
| `GDD.md` | 玩家动作、核心循环、规则、游戏状态、胜负、失败与恢复、系统关系和内容范围 | 详细数值表、空间布局、运行架构 |
| `BALANCE_DESIGN.md` | 单位、公式、经济来源/消耗、成本、成长、相对价值、压力/能力曲线和边界计算 | 重定义玩法规则、场景摆放或复制最终 JSON |
| `LEVEL_SCENE_DESIGN.md` | 关卡序列、世界/场景关系、空间拓扑、尺度、路线、区域、出生/目标点、场景状态、摄像机设计约束和摆放规则 | 引擎对象、最终 YAML、视觉风格或单位数值真相 |
| `TECHNICAL_DESIGN.md` | 数据消费、运行架构、状态/存档、加载顺序、错误边界、性能预算和唯一资源加载路径 | 重定义设计数值、视觉风格或引擎专用交付合同 |
| `ART_DIRECTION.md` | 视觉语言、色彩、造型、材质、光照、特效、空间可读性和视觉性能边界 | 具体场景摆放、Catalog 资源身份或运行逻辑 |
| `UI_UX_SPEC.md` | 信息架构、HUD、输入、交互流程、所有界面状态、反馈和可访问性 | 游戏规则、数值真相或音频文件身份 |
| `AUDIO_DESIGN.md` | 游戏事件到 cue 的映射、音乐状态、优先级、并发、空间性、音量层级和音频验收条件 | 游戏事件定义本身或资源文件选择 |
| `ASSET_PLAN.md` | 从玩法、关卡、视觉、UI 和音频推导出的语义资源职责、格式能力、来源策略、稳定 ID 与可替换要求 | Catalog 搜索历史、具体候选、自建 Manifest 或一用途一 slot |
| Gameplay Checklist | 从已批准设计导出的可观察玩家路径与验收事实 | 新增设计要求 |
| JSON 内容 | 资源映射、实体、UI、音频、事件、波次和数值的可执行事实 | 世界、场景、层级和实例摆放 |
| YAML 内容 | 世界、场景、层级和实例摆放的可执行事实 | 事件、波次、数值或第二份资源映射 |

文档可以引用其他 owner 的稳定 ID 和结论，但不得复制可独立变化的事实。后续 JSON/YAML 是批准设计的可执行投影，不是第二套设计权威；实现代码只消费它们，不在源码中硬编码另一套设计数据。

## 4. 每份文档的最低完整性

### 4.1 `GDD.md`

必须明确玩家动作集合、局内/局外循环、状态转换、机制输入输出、胜负条件、暂停/重试/恢复、策略与反制关系、内容规模和首个交付边界。详细公式、成本和参数表必须引用 Balance 文档，不得继续埋在 GDD 中形成双写。

### 4.2 `BALANCE_DESIGN.md`

必须明确数值单位与口径、核心公式、经济来源/消耗、成本与成长、单位相对价值、关卡/波次压力和玩家能力曲线、最低可行解、支配策略/套利/死锁边界以及关键计算样例。缺少数值时必须明确是设计缺口，禁止 Agent 补造默认概率、玩家水平或平台行为。

### 4.3 `LEVEL_SCENE_DESIGN.md`

必须明确关卡目标与体验曲线、稳定关卡/场景 ID、世界与场景关系、空间拓扑和尺度、路线/出生点/目标点、建造/阻挡/交互区域、摄像机与可见信息、实体和环境布置规则、波次/事件引用、场景状态转换、资源职责引用以及空间可玩性和可读性验收条件。

该文档定义设计意图，不写 Unity Prefab、Godot Scene、React Three Fiber 对象或最终 YAML。后续 YAML 必须从它投影世界、场景、层级和实例摆放。

### 4.4 `TECHNICAL_DESIGN.md`

必须明确 JSON/YAML 唯一事实范围、加载和初始化顺序、运行模块边界、状态管理/存档、资源与内容引用、缺失资源和 placeholder 行为、错误恢复、构建/预览/发布确定性、性能和加载预算。引擎适配只能发生在 System Delivery Contract 消费边界之后。

### 4.5 `ART_DIRECTION.md`

必须明确摄像机尺度下的轮廓可读性、玩家/敌人/路径/目标/可交互区域区分、环境层级和地标、材质/色彩/光照/特效优先级、模块化替换和性能降级规则。不得承担具体摆放或 Catalog 选择。

### 4.6 `UI_UX_SPEC.md`

必须覆盖导航、HUD 事实映射、加载/空/失败/暂停/重试/完成状态、输入映射、选中/放置/取消/升级等交互、视觉/音频/操作反馈、可访问性和各状态验收条件。

### 4.7 `AUDIO_DESIGN.md`

必须覆盖事件到 cue 的稳定映射、音乐状态与切换、并发/优先级/冷却、空间与非空间音频、音量层级、placeholder 可替换要求和可验证触发条件。

### 4.8 `ASSET_PLAN.md`

必须从其余七份设计文档推导资源职责，声明稳定语义 ID、用途、格式能力、依赖/变体要求、Resource Library/程序资源/placeholder 来源策略、正常资源目录和替换合同。程序资源和 placeholder 都必须是正常资源目录中的独立可替换文件，并与最终媒体走同一 Manifest 和内容引用路径。

## 5. Workflow 顺序

```text
Confirmed Brief
  -> GDD
  -> Level/Scene Design
  -> Balance Design
  -> Technical Design
  -> Art Direction
  -> UI/UX Spec
  -> Audio Design
  -> Asset Plan
  -> Foundation Initial Review（12 checks）
  -> Foundation Owner 批量修复
  -> Foundation Closure Review
  -> Gameplay Checklist Drafting
  -> Checklist Initial Review / Repair / Closure（封存）
  -> Resource Production（Manifest modules + 资源文件 + JSON/YAML）
  -> Comprehensive Initial Review（16 checks；Checklist 只读且不重复审计）
  -> 按 owner 批量修复
  -> Comprehensive Closure Review
  -> Atomic Task Planning
  -> Implementation
  -> Implementation Audit
  -> Runtime Acceptance
  -> Delivery
```

禁止因为缺少资源阻塞 Foundation；Foundation 只要求 Asset Plan 定义合法来源策略。Resource Production 找不到合适库内资源时创建独立、可执行、可替换 placeholder，并继续完成项目。

## 6. Reviewer 唯一矩阵

Foundation 固定执行以下 12 项，其中空间设计检查为本次补齐项：

- `level_scene_design_integrity`

Foundation 固定为 12 项；Checklist 在资源前由 `checklist_traceability` 独立审计并封存；Comprehensive 为 Foundation 与 4 项资源/实现就绪检查的严格并集，固定为 16 项。`BALANCE_DESIGN.md` 不新增顶层 check，由现有四项游戏设计检查共同审计，避免第二套 Balance Reviewer。

Reviewer 只允许一个 frozen-revision Review Cycle。12 项 Foundation check 保持固定顺序和独立结论，但按五个事务型 packet 派发：`brief_alignment + cross_document_consistency + gameplay_completeness`；`gameplay_strategy_viability + economy_progression_integrity`；`numeric_balance_feasibility + pacing_difficulty_coherence`；`level_scene_design_integrity + technical_feasibility + art_direction_coherence + ui_audio_consistency`；`acceptance_observability`。策略/经济包共享玩家选择、资源流和成长约束，数值/节奏包共享公式边界、压力/能力曲线与尖峰恢复推导；不得把十二项 assessment 合成一个原子提交。每个 packet 的原生工具必须向模型直接暴露完整 check、assessment、finding 与 reference JSON Schema，并在返回 `accepted` 前使用与持久化相同的唯一 submission contract 校验全部 check、固定 criteria、稳定 `referenceId`、逐 check artifact dependency、finding subject owner 与 Closure 边界；不得以空 item Schema 配合 Prompt 补偿字段合同。任一项非法则整个 packet 零落盘。packet 传输依赖并集只用于减少重复输入，不能扩大任一 check 的 evidence/subject 权限；每项 approval digest 覆盖该 check 的完整依赖而非仅覆盖主动引用。已接受 packet 不回滚。未接受 terminal 的 packet 边界与当前 durable cursor 不一致时必须丢弃并重新派发当前 packet，不得兼容解析或部分接收。不得创建并行 Reviewer、替代提交合同或整轮重审分支。

`level_scene_design_integrity` 必须提交三个固定 criterion：

| Criterion | 必须证明 |
| --- | --- |
| `spatial_gameplay_support` | 空间、路线、区域、摄像机和可见信息支持 GDD 的玩家动作、策略和反制 |
| `level_progression_coherence` | 关卡/场景序列与 Balance 的压力/能力曲线、内容规模和恢复窗口一致 |
| `scene_state_completeness` | 进入、运行、暂停、成功、失败、重试和切换等必要场景状态具有唯一设计路径 |

现有四项游戏设计 check 的事实读取必须调整为：

- `gameplay_strategy_viability`：以 GDD 为规则权威，并核对 Level/Scene 的空间支持；
- `economy_progression_integrity`：以 Balance 为经济数值权威；
- `numeric_balance_feasibility`：以 Balance 为公式、单位和结果边界权威；
- `pacing_difficulty_coherence`：联合 Balance 的曲线与 Level/Scene 的关卡序列进行推导。

`cross_document_consistency` 必须阻止八份文档间的重复事实 owner；`technical_feasibility` 必须核对 Technical 与 System Delivery Contract；`art_direction_coherence` 必须核对 Art 与 Level/Scene 的空间可读性；`ui_audio_consistency` 必须核对 GDD/Level/Scene 状态与 UI/Audio 映射；`acceptance_observability` 必须确保每项批准行为、数值结果和场景状态均可观察。

`level_scene_design_integrity` finding 的 owner 固定由服务端派生为 `foundation`，subject 只能指向八份 Foundation 文档。不得把 criterion、owner、severity 或文档归属交给模型自由决定。

## 7. Author 与下游合同

首次 Foundation Author 固定按 `GDD -> LEVEL_SCENE_DESIGN -> BALANCE_DESIGN -> TECHNICAL_DESIGN -> ART_DIRECTION -> UI_UX_SPEC -> AUDIO_DESIGN -> ASSET_PLAN` 串行执行。每个 dispatch 只获得当前文档的唯一允许路径，以及该文档确实依赖且已经完成的上游 canonical 文档；不得获得八份可写路径、不得携带上一份文档的模型对话或压缩摘要，也不得在初稿阶段提出 finding、执行 Closure、模拟 Reviewer 或自行建立修订循环。成功终态只完成当前 durable task，服务端随后创建下一任务；八份完成后才计算完整 Foundation revision。

上游依赖由事实 owner 固定投影，不等同于“此前所有文档”：Level/Scene 读取 GDD；Balance 读取 GDD 与 Level/Scene；Technical 读取 GDD、Level/Scene 与 Balance；Art 读取 GDD 与 Level/Scene；UI/UX 读取 GDD 与 Level/Scene；Audio 读取 GDD、Level/Scene 与 UI/UX；Asset Plan 读取 GDD、Level/Scene、Technical、Art、UI/UX 与 Audio。服务端在启动 Initial Author 前一次性读取这些 canonical 上游文档并作为同一 prompt 的只读 authority block 提供；Author 不得用工具重新装载上游或浏览其他路径。若当前目标不存在，Initial Author 直接执行一次 `CommitCanonicalDocument`；若目标已存在（包括显式重新开始、Change Request 或 finding remediation），Workflow 服务把当前正文作为受控基线投影给 Author，Author 不再通过通用文件工具读取或写入 canonical 文档。Initial restart 的旧目标只用于建立覆盖前提，不得被提升为当前 run 的产品 authority；Change Request 与 remediation 的当前正文则是本次受控修订基线。该投影不产生摘要、临时项目文件、第二事实源或第二写入通道。

Initial Author 与 remediation Author 的唯一 mutation 都是当前目标的一次 `CommitCanonicalDocument`。工具只接受不含 YAML front matter 的完整 Markdown 正文；服务端根据 dispatch 合同唯一确定 `document_id`，为新文档生成 `1.0.0`，为受控修订将现有 PATCH 恰好提升一次，并使用服务端 UTC 时钟生成严格晚于旧值的 `updated_at`。服务端必须在 mutation 前验证目标、基线 digest、正文和最终 metadata，再以临时文件加原子替换写入 canonical 路径。Document Author 不存在通用文件 mutation 或另一个完成终态；成功的 canonical commit 本身就是唯一终态。

每个 commit 在 `.beegame/workflow/document-commits/` 写入以 `dispatchId` 唯一标识的 write-ahead receipt。receipt 只记录 operation identity、目标路径、基线 digest、最终 digest、服务端 metadata 与 `prepared/committed` 状态，是 Workflow 的操作日志，不是产品事实或第二文档权威。顺序固定为：原子写入 prepared receipt、原子替换 canonical 文档、原子标记 committed。恢复时若 receipt 为 committed，或 prepared receipt 的最终 digest 已与 canonical 文件一致，服务端必须幂等接受同一次 commit 并推进原 repair cursor；若 canonical 文件仍等于基线则允许同一 dispatch 继续提交；任何第三种文件状态立即作为并发修改错误拒绝，禁止重新让 LLM 应用同一修订。

首次 Author 只写决策级权威事实：原始设计输入、规则、基础数值、公式、必要配置和直接决定设计是否成立的少量边界。不得把所有可重算面积、比例、距离、构筑模拟、表格派生值或自我审计过程写入 Foundation。后续 JSON/YAML 承载批准设计的完整可执行投影；Foundation 不复制纯执行数据，也不把模拟报告提升为设计权威。

初稿采用紧凑的 decision contract，而不是说明书：只记录当前 owner 的稳定 ID、选择、约束、公式、必要边界和给下游的接口引用。不得复述 confirmed brief、上游正文、fact-owner 总表、通用系统合同、理由散文、示例、测试用例、伪代码、实现步骤或调参过程；这些内容若不是当前 owner 的独立权威事实，就不得写入当前文档。完整性由 Initial Reviewer 跨八份文档判断，不以单份文档篇幅替代审计。

修复时只允许写 accepted finding 指向且 repair plan 分配给当前 task 的一份 Foundation 文档，并要求该文档 PATCH 版本提升。首次撰写、repair planning 和 finding owner 修复是互斥任务，不共享 prompt 或允许路径。

Foundation 修复 dispatch 只消费已接受 finding、其 required outcome、被分配的 subject 文档，以及 finding 明确引用且确有必要核对的事实 owner；每份读取至多一次。Author 不得在修复中重新审计未受影响文档、扩大 finding 或自行执行跨文档 Closure，required outcome 与回归的最终判定唯一属于随后一次 Closure Reviewer。

Finding 是审计结论，不是可直接执行的修改方案。Foundation 修复保持一个 finding batch、一个 active review cycle 和一个最终 Closure，不得把该约束误写成一个模型上下文或一个多文档 dispatch。修复采用与人类团队一致的唯一串行交接：Repair Lead 先在同一 active cycle 内锁定修订决策，随后服务端按事实 owner 与依赖顺序逐份派发 Document Author durable task。

1. 服务端先从 accepted finding ledger 确定性构造 repair graph：共享 canonical subject、共享最高事实 owner，或一个 finding 的 subject 是另一 finding evidence 所依赖的 owner 时建立关联；按 Foundation 固定 owner 依赖顺序求连通分量和分量间 DAG。不得使用关键词、正则、项目名或 LLM 摘要分组；
2. 每个连通分量形成一个 coherent repair group。Repair Lead 的一个只读 dispatch 消费该组完整 findings、精确 subjects/evidence、blocking impact、required outcome 与必要 System Delivery Contract 片段，并只提交一份组内一致的最小修订决策；同一 finding 恰好属于一个 group。不得一个 finding 建一个机械 group，也不得把无关 findings 合成全量巨型计划；
3. 服务端从 graph 确定性派生 group ID、finding IDs、`affectedPaths` 和 `dependsOn`，模型不得提交这些可派生身份字段。接受的 decision 写入原 active review cycle 的唯一 repair plan ledger；服务端必须保证 ledger 是 graph 拓扑序的稳定前缀，最终恰好覆盖完整 batch。规划依赖 group 时，服务端必须把每个直接依赖 group 已锁定的 `groupId`、finding IDs、affected paths 与 decision 作为只读约束投影给当前 Repair Lead；只提供 `dependsOn` ID 而不提供 decision 属于不完整交接，当前 group 不得重新打开或替换上游 decision。该 ledger 只是 finding 的执行字段，不是项目文档、第二事实源、第二队列或第二 terminal；
4. 服务端按 repair graph 的拓扑序派生唯一 document repair cursor。每个 dispatch 只修一份文档，只获得当前 canonical 正文、与该文档相关的 finding 和已锁定决策，并只允许一次 `CommitCanonicalDocument`；
5. 每份成功提交立即以 commit receipt 形成 durable checkpoint、由服务端提升 PATCH 并释放模型上下文。重启只核对 receipt 并继续 cursor 中未完成的文档，不重新规划、不重写已完成文档；
6. 全部目标文档完成后，服务端相对 frozen baseline 核对 changed paths、版本和 finding 覆盖，再启动唯一 Closure Reviewer；Closure Reviewer 仍按原 finding ID、required outcome 和 server diff 独立判定。同一 prior finding 仍未关闭时必须保持原 ID、check、owner 与 required outcome；已关闭时不再提交。受影响 check 中发现 Initial Review 遗漏的另一缺陷时使用在完整 Cycle ledger 中从未出现的新 ID，不得借用旧 ID，也不得因 subject 未变化而隐藏真实缺陷。Closure packet 通过唯一校验函数原子替换该 packet 对应的 open 引用；完整 finding 身份历史保留在同一 `cycle.findings`，open 集合只由最新 check ledger 的 `findingIds` 派生，不能在工具接受后再由持久化边界以旧 ID 已存在为由拒绝。

Repair plan 只保存在原 active review cycle 内，并在该 cycle 关闭时一并退出活动状态；canonical 文档始终是唯一产品权威。不得保留临时修订状态、多文档修订 dispatch 或重试时重新规划。Initial Author 只锁定 confirmed brief 所需的最小原始设计输入、公式和直接边界；不得在 Reviewer 之前展开完整波次/构筑模拟、逐项候选方案比较、穷举调参或证明全局可行性。完整策略、经济、数值、节奏与空间可行性判断属于 Initial Reviewer；Reviewer 接受 finding 后，Repair Lead 只决定关闭这些 finding 的最小一致修改，不得借修订新增无关系统、扩大玩法范围或重新审计未受影响内容。

Document Author 的运行时能力声明必须与真实工具完全一致。Author 只获得 `CommitCanonicalDocument`，不得获得通用文件读写、命令执行或第二写入工具。当前目标正文和必要上游 authority 由服务端只读投影。Repair Lead 只获得结构化 plan terminal，不得获得任何项目写入工具。

Foundation 的范围权威必须在 Author、Reviewer 和 Repair Lead 三处一致执行：下游 owner 只能细化 Confirmed Brief、GDD 或其合法上游已经批准的产品行为，不能自行创造新的玩家可见系统、设置面板、状态机、经济机制、资源职责或另一个 owner 必须实现的义务。Reviewer 发现下游越权声明时，finding subject 必须指向该越权声明并要求删除或收窄；只有最高权威明确要求该行为而消费者缺失时，才允许扩建消费者。Repair Lead 不得把“文档彼此一致”解释为新增系统的授权。

同一修复 batch 若在文档 owner task 之间被中断，已完成路径保存在 active cycle 的唯一 repair cursor 中并保持为当前 canonical artifact。恢复时服务端必须同时验证 checkpoint 路径相对 frozen baseline 已发生合法变化；不得仅凭模型声明推进 cursor。已经完成的路径不得再次派发或再次提升版本。Closure diff 始终相对原 frozen baseline 计算。

首次 Document Author、Repair Lead、repair owner task、Document Reviewer 与 Resource Agent 都不使用固定业务墙钟、durable-progress idle、terminal grace、累计 token 或自动修订次数截止线；项目复杂度、网络状态、模型响应时间、累计 token、修订轮次和文件 mutation 间隔都不是失败条件。只有连接断开、worker 进程退出、用户停止或明确终态可以结束 dispatch。每个 dispatch 仍只负责当前有界 task，但不得以 token 预算、经过时间或修订次数强制结束它，也不得依靠上下文压缩或第二续写通道完成另一项任务。Repair Lead 只提交当前 coherent group 的结构化决定，不写 canonical 文件；每个 repair owner task 只完成当前路径的一次写入。一个 batch 被拆成 durable planning/owner task 不等于拆分 finding 或 repair-plan ledger，也不允许第二终态、增量编辑或并行修订队列。Document Reviewer 保留模型与运行时的正常 thinking 能力；唯一可审计结论仍提交在 criterion derivation 与 finding 中。

Workflow worker 的自动 transport 恢复以“是否已收到任何 SDK/model 消息”为唯一副作边界。首次启动若在该边界之前失败，服务端必须释放失败 runtime，并且只能以同一 request 重建 worker 一次；此判定不得依赖错误文案、证书库差异或供应商专用错误码。收到任何 SDK/model 消息后禁止自动重放，必须由 durable workflow recovery 处理。该规则不得禁用 TLS 验证或改走第二网络路径。

Checklist Author 必须从八份已批准文档派生**最小充分的场景级验收集合**。Checklist 至少覆盖：核心玩家路径、关键数值边界、关卡/场景状态、UI/Audio 反馈、资源可见结果和失败/恢复路径。同一 setup、action 与 observable outcome 下的波次、敌人、输入、资源、cue 或表格行变体必须在一个参数化验收项中核对，不得按每个变体或文档句子机械拆项；一项可以引用多个批准事实，但每个稳定 ID 仍只描述一个可独立判定的场景结果。Author 必须在首次写入前完成分组和计数；常规首个交付目标为 24–40 项，只有批准设计确实包含更多互相独立的可观察场景时才允许超过 40 项，绝对不得超过 64 项。超出上限属于确定性 Checklist 合同错误，必须在进入资源阶段前原地修订，不得把膨胀清单交给 Planner 或 Implementation；禁止先写超限草稿再依赖同一 dispatch 二次改写。

Resource Production 的输入按唯一任务边界投影，不能把八份全文重复交给每个 Agent。Resource Planner 只获得已批准的 `ASSET_PLAN.md`、`ART_DIRECTION.md`、`TECHNICAL_DESIGN.md` 和确认简报；Foundation Review 必须保证 Asset Plan 已经覆盖其他 owner 批准的全部资源职责。Resource Curator 只获得资源职责、表现约束和目标格式能力；Resource Content Author 才获得八份已批准 Foundation 文档中与 JSON/YAML owner 对应的事实，其中 `LEVEL_SCENE_DESIGN.md` 提供 YAML 空间事实，`GDD.md`、`BALANCE_DESIGN.md`、`UI_UX_SPEC.md`、`AUDIO_DESIGN.md` 与 `TECHNICAL_DESIGN.md` 分别提供其 JSON/加载投影所需事实。任何 Agent 都不得复制数值进 Manifest、让 JSON/YAML 越权重定义设计或读取未批准/平行文档。首次内容写入前必须完成完整 JSON/YAML 集合规划，并将互相独立的文件写入合并到一个并行工具批次；只有具体写入失败才补写，不得逐文件重新携带完整上下文循环规划。

Resource Production 首次建立 `project_target.asset_format_capabilities` 时必须从已批准的 `ASSET_PLAN.md` 与目标运行环境推导。后续资源修复只有在替换同一稳定 resource ID、且新文件格式由已批准 Asset Plan 明确允许时，才能在同一 Manifest 中**追加**该直接文件扩展名；不得移除既有格式，也不得修改 platform、runtime、资源库策略或三个 canonical root。该追加与替换资源必须作为同一次 Manifest 修订提交，不创建第二 target、第二 Manifest 或兼容读取分支。除此之外的 `project_target` 变化均为阻塞错误。

Resource remediation 可以清除已证明语义错误或已被替代的项目库存记录，但只限 resource ID **不是**任何已批准 requirement ID、且当前 JSON/YAML 已不再引用该 resource ID 的记录；其未被其他记录共享的本地文件必须在同一次 Manifest 修订中删除。与 requirement ID 同名的稳定职责资源不得删除，只能按替换合同原位修复。初次 Resource Production、普通重试和实现阶段均不得借此裁剪库存。

Atomic Planner 和 Implementation 必须接收八份文档、Checklist、Manifest 与 JSON/YAML 的完整批准集合。任何硬编码设计事实、第二加载路径或引擎专用交付要求都应在 Comprehensive Review 阶段阻塞。

## 8. 落地任务

1. 将 `CANONICAL_FOUNDATION_DOCUMENTS` 和 `CANONICAL_PROJECT_DOCUMENTS` 改为八文档集合；Checklist 保持最后生成。
2. 新增唯一 durable Foundation draft cursor，按固定顺序每次只派发一份文档；删除八路径初稿 dispatch、`existingDocumentPaths` 续写投影及对模型压缩摘要的依赖。
3. 更新 Foundation Author prompt/contract，分离互斥的首次撰写、Repair Lead planning 与单文档 finding 修复；初稿与 owner task 都只写当前文档，彻底删除全量 Workbench 指令与工具。
4. 新增 `level_scene_design_integrity`、三个固定 criterion、固定 owner 和结构化 Schema；Foundation/Comprehensive 数量改为 12/17。
5. 更新 Reviewer prompt、Closure 受影响 check 计算和 evidence digest，纳入 Balance 与 Level/Scene。
6. 更新 Checklist Author、三个 Resource Production task、Atomic Planner 与 Implementation 输入，使每个消费者只获得其 owner 所需的八文档批准事实投影。
7. 更新 Workflow Card 文档名称、Reviewer task、数量、状态和 icon。
8. 更新架构与 Reviewer 文档中所有六文档/11/16陈述，删除旧矩阵和旧假设，不保留兼容分支。
9. 更新单元、集成和前端测试；禁止硬编码具体游戏名、日志文本或测试项目内容到生产逻辑。
10. 使用系统 Chrome 依次测试全新项目；一次只运行一个项目。每个项目至少验证八文档生成、12 项 Initial Review、修复、Closure 和 Checklist 门禁。

## 9. 偏离与残留审计

实现完成后必须确认：

- 代码和文档中不存在已废弃的缩减文档集合或缩减检查矩阵；
- 运行时只接受当前八文档合同；
- 不存在 GDD 与 Balance 双写数值、GDD/Level 与 YAML 双写场景实例、Asset Plan 与 Manifest 双写资源身份的提示；
- 不存在按游戏类型、项目名、关键词或正则增删文档/check 的逻辑；
- 不存在 `LEVEL_DESIGN.md`、`SCENE_DESIGN.md` 等平行文件名；
- 不存在第二 Balance Reviewer、第二 finding ledger、平行修订状态或开放式全文返工；
- 不存在一次派发八份初稿、`existingDocumentPaths` 兼容续写、初稿 repair group、初稿自审或跨文档模型对话继承；
- Checklist 与 Manifest 均无法在八文档 Foundation Closure 前创建；
- placeholder 是正常资源文件，不是源码分支或运行时 substitute；
- Reviewer task、icon、进度和累计时间来自 durable Workflow 状态。

## 10. 验收标准

1. Readiness 对七份或任一缺失文档确定性失败，对八份非空合法文档通过。
2. 首次 Foundation Author 每个 dispatch 只允许写当前 cursor 指向的一份文档，完成后自动推进；Repair Author 只允许写 accepted finding subjects，Checklist Author 只允许写 Checklist。
3. Foundation Reviewer 必须在同一 Cycle 通过五个串行事务 packet 接受 12 checks 和 15 structured criteria；Comprehensive 继承新鲜 Foundation 前缀后，对新增 checks 使用单项 packet。每次只提交当前完整 packet，12 项 check 仍分别持久化，最终 verdict 由服务端汇总。
4. Balance 缺少关键口径、公式或可行边界时产生 foundation finding；不得由 Agent 补造。
5. Level/Scene 缺少空间支持、关卡曲线或场景状态闭环时产生 foundation finding。
6. 修复后对应文档 PATCH 版本提升，Closure 只关闭已验证 finding 和直接 regression。
7. 任一未知 `referenceId` 必须在 `SubmitDocumentReviewPacket` 返回 accepted 前拒绝整个 packet；同一 packet dispatch 修正后可重新提交，已完成 packet 不得丢失或重算。
7. Checklist 在 Foundation Closure 前不存在；Manifest 与 JSON/YAML 在 Checklist 完成前不存在。
8. 服务端、前端、类型检查和 diff 检查通过。
9. 系统 Chrome 的单项目实测完整经过 Drafting、Initial Review、Repair、Closure 并进入 Checklist；第二项目只有在第一个完成后才能启动。
10. 日志不存在八文档或多文档 repair 单 dispatch、跨文档上下文压缩、临时修订状态、重试重新规划或 Author 自行提出并修复审计问题。
