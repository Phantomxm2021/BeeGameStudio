# BeeGame 八文档基础设计权威与落地方案

## 1. 目标与权威范围

BeeGame 在进入 Gameplay Checklist、资源准备和实现之前，必须形成一套完整、可审计、引擎中立的游戏设计基线。本方案是 Foundation 文档集合、事实归属、生成顺序和审计覆盖的唯一权威；`beegame-document-reviewer-convergence-plan.md` 继续负责 Reviewer 的单轨状态与 finding 收敛，但不得与本方案定义的文档集合和 check matrix 冲突。

本方案只新增两个缺失的事实 owner：

- `docs/BALANCE_DESIGN.md`：数值、公式、经济、成长和压力/能力曲线；
- `docs/LEVEL_SCENE_DESIGN.md`：关卡序列、空间拓扑、场景状态和摆放约束。

其余既有文档保留并强化。禁止再为同一事实增加 `CONTENT_DESIGN`、`RESOURCE_SPEC`、`TEST_PLAN`、`PRODUCTION_PLAN` 或其他平行文档。禁止旧版文档集合并存、旧版 reader、自动补写兼容、feedback/shadow 状态和按项目名或关键词决定文档集合。

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

八份文档必须在同一个 Foundation Drafting pass 中共同完成，每份文档均以 YAML front matter 声明稳定 `document_id`、`MAJOR.MINOR.PATCH` 版本和 ISO 8601 UTC `updated_at`。任一文档缺失、为空、越权拥有事实或缺少核心设计输入，Foundation 不得通过。

`docs/acceptance/gameplay-checklist.md` 不是 Foundation 文档。它只能在八份文档通过 Foundation Initial Review、必要修复和 Closure Review 后生成。`assets/asset-manifest.json`、资源文件及 JSON/YAML 可执行内容只能在 Checklist 完成后创建。

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
  -> 八份 Foundation 文档
  -> Foundation Initial Review（12 checks）
  -> Foundation Owner 批量修复
  -> Foundation Closure Review
  -> Gameplay Checklist
  -> Resource Production（Manifest + 资源文件 + JSON/YAML）
  -> Comprehensive Initial Review（17 checks）
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

Foundation 固定为 12 项；Comprehensive 仍为 Foundation 与 5 项下游检查的严格并集，固定为 17 项。`BALANCE_DESIGN.md` 不新增顶层 check，由现有四项游戏设计检查共同审计，避免第二套 Balance Reviewer。

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

Foundation Author 必须在一次 dispatch 中获得八份唯一允许路径和本方案要求；断点恢复只继续同一八文档集合。修复时只允许写 finding 指向的 Foundation 文档，并要求对应文档 PATCH 版本提升。

Checklist Author 必须从八份已批准文档派生验收项。Checklist 至少覆盖：核心玩家路径、关键数值边界、关卡/场景状态、UI/Audio 反馈、资源可见结果和失败/恢复路径。

Resource Agent 必须同时读取 `ART_DIRECTION.md`、`ASSET_PLAN.md` 和 `LEVEL_SCENE_DESIGN.md` 获取资源与空间职责；读取 `BALANCE_DESIGN.md` 只用于资源变体或能力表现需要，不得将数值复制进 Manifest。JSON/YAML 生成必须遵守第 3 节的唯一事实归属。

Atomic Planner 和 Implementation 必须接收八份文档、Checklist、Manifest 与 JSON/YAML 的完整批准集合。任何硬编码设计事实、第二加载路径或引擎专用交付要求都应在 Comprehensive Review 阶段阻塞。

## 8. 落地任务

1. 将 `CANONICAL_FOUNDATION_DOCUMENTS` 和 `CANONICAL_PROJECT_DOCUMENTS` 改为八文档集合；Checklist 保持最后生成。
2. 更新 Readiness Audit、revision digest、允许路径、断点恢复和 finding subject 校验，使八文档缺一不可。
3. 更新 Foundation Author prompt/contract，明确八份文档及第 3、4 节事实边界；删除所有“六份”描述。
4. 新增 `level_scene_design_integrity`、三个固定 criterion、固定 owner 和结构化 Schema；Foundation/Comprehensive 数量改为 12/17。
5. 更新 Reviewer prompt、Closure 受影响 check 计算和 evidence digest，纳入 Balance 与 Level/Scene。
6. 更新 Checklist Author、Resource Agent、Atomic Planner 与 Implementation 输入，消费八文档批准集合。
7. 更新 Workflow Card 文档名称、Reviewer task、数量、状态和 icon。
8. 更新架构与 Reviewer 文档中所有六文档/11/16陈述，删除旧矩阵和旧假设，不保留兼容分支。
9. 更新单元、集成和前端测试；禁止硬编码具体游戏名、日志文本或测试项目内容到生产逻辑。
10. 使用系统 Chrome 依次测试全新项目；一次只运行一个项目。每个项目至少验证八文档生成、12 项 Initial Review、修复、Closure 和 Checklist 门禁。

## 9. 偏离与残留审计

实现完成后必须确认：

- 代码和文档中不存在已废弃的缩减文档集合或缩减检查矩阵；
- 不存在可接受旧六文档项目的 fallback/compat reader；
- 不存在 GDD 与 Balance 双写数值、GDD/Level 与 YAML 双写场景实例、Asset Plan 与 Manifest 双写资源身份的提示；
- 不存在按游戏类型、项目名、关键词或正则增删文档/check 的逻辑；
- 不存在 `LEVEL_DESIGN.md`、`SCENE_DESIGN.md` 等平行文件名；
- 不存在第二 Balance Reviewer、第二 finding ledger、feedback/shadow 状态或开放式全文返工；
- Checklist 与 Manifest 均无法在八文档 Foundation Closure 前创建；
- placeholder 是正常资源文件，不是源码分支或运行时 substitute；
- Reviewer task、icon、进度和累计时间来自 durable Workflow 状态。

## 10. 验收标准

1. Readiness 对七份或任一缺失文档确定性失败，对八份非空合法文档通过。
2. Foundation Author 只允许写八份路径，Checklist Author 只允许写 Checklist。
3. Foundation Reviewer 必须返回 12 checks 和 15 structured criteria；Comprehensive 必须返回 17 checks 和同一 15 criteria。
4. Balance 缺少关键口径、公式或可行边界时产生 foundation finding；不得由 Agent 补造。
5. Level/Scene 缺少空间支持、关卡曲线或场景状态闭环时产生 foundation finding。
6. 修复后对应文档 PATCH 版本提升，Closure 只关闭已验证 finding 和直接 regression。
7. Checklist 在 Foundation Closure 前不存在；Manifest 与 JSON/YAML 在 Checklist 完成前不存在。
8. 服务端、前端、类型检查和 diff 检查通过。
9. 系统 Chrome 的单项目实测完整经过 Drafting、Initial Review、Repair、Closure 并进入 Checklist；第二项目只有在第一个完成后才能启动。
