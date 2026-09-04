**目标：在保证审计质量的前提下，将 Token
消耗、耗时和重复上下文降到可预测、可扩展的水平。**

# 1. 核心结论

- 不要把 LLM 当成主要审计引擎；LLM 只处理规则无法判断的语义问题。

- 把 8 份文档转成结构化 Fact Store，用 Schema / Rule / Contract
  解决大部分一致性问题。

- 修订采用 Issue 驱动的 Batch Patch，同一文档一次修完，修后只验证 Patch
  和受影响 Contract。

- 最终成本主要随“本次改动规模”增长，而不是随“项目总文档规模”增长。

# 2. 最终推荐架构

> 8 Docs  
> ↓  
> Generate Fact Store + Section Index  
> ↓  
> Schema Check ← 代码，无 Token  
> ↓  
> Rule Check ← 代码，无 Token  
> ↓  
> Contract Check ← 代码，无 Token  
> ↓  
> Semantic Audit ← 小模型，仅处理语义问题  
> ↓  
> Deep Audit ← 强模型，仅 High / Blocker  
> ↓  
> Issue Registry  
> ↓  
> Batch Patch Revision ← 按文档聚合并行  
> ↓  
> Update Facts  
> ↓  
> Impact Analysis  
> ↓  
> Patch Validation ← 优先代码  
> ↓  
> 必要时 Targeted LLM Recheck  
> ↓  
> PASS

# 3. 文档提交后派生机器可读信息

八份 canonical Markdown 文档全部 durable committed 后，由服务端统一派生：

> 8 canonical `document.md`
> `.beegame/audit/foundation/<revision>/derived/fact-store.json`
> `.beegame/audit/foundation/<revision>/derived/section-index.json`
> `.beegame/audit/foundation/<revision>/derived/COMMITTED.json`

## 3.0 人类文档 authority 与 owner materials

每份 canonical 文档的 `Executive Summary` 只是简洁的 authority index：它只能索引本文件拥有的最终决定与稳定 Section/Material 引用，不得包含表格、图、场景、验收条件、第二份事实或独立的可变总数。每个 `Production Material` 都是其列明事实类型的唯一 canonical owner representation，并按 contract 声明 `authorityRule`；材料之间不得复制可变事实、维护独立总计或互相覆盖。每个可变事实只能有一个 canonical owner。

这套 material authority mapping 是封闭且精确的，不支持别名、fallback 或并行旧 material：GDD 的 `core-loop-diagram`、`game-state-flow` 均为 owner；Level 的 `world-structure-diagram`、`route-choice-diagram`、`pacing-beat-table` 为 owner，删除 `scene-transition-diagram`；Balance 仅保留 `variable-parameter-table` 作为 owner；Technical 的 `architecture-diagram`、`data-flow-diagram`、`runtime-lifecycle-diagram`、`save-recovery-table` 均为 owner；Art 的 `visual-language-board` 与 `animation-vfx-state-table` 均为 owner；UI 的 `information-architecture-diagram`、`player-flow-diagram`、`screen-state-table`、`wireframe-board`、`focus-accessibility-matrix` 均为 owner；Audio 的 `event-cue-matrix`、`music-state-diagram`、`bus-ducking-diagram`、`loudness-delivery-table` 均为 owner，删除 `sound-reference-register`；Asset 的 `asset-inventory-table`、`responsibility-matrix`、`dependency-integration-diagram`、`license-register`、`milestone-maturity-table` 全部为 owner，分别拥有以 inventory ID 为键的资源库存、责任、依赖/集成、许可证据和里程碑事实。每个 Asset material 都拥有自己 distinct 的 row/mapping/evidence fact type，并按 inventory ID 互相引用。

Balance 的 owner 分界不可推断：`variable-parameter-table` 是全部数值型 `var.*` 与 `param.*` ID、单位、值和范围的唯一 owner；`Units, Variables and Conventions` 与 `Entity and Ability Parameters` Section 只拥有语义、身份和关系，不得复制数值定义。Fact Store 的 `balance.variable_ids` owner identity 同步绑定 `material.variable-parameter-table`。

需要跨文档复用的业务 semantic ID 使用 lower-case ASCII dotted namespace（例如 `param.gen.fuel_consumption`）；owner-local keys（例如 `N01`、`BEAT-01`、`VB-01`、`SR-01`）保留 owner 选定的 canonical pattern，并由消费者 byte-for-byte 引用。两类 ID 都禁止 alias、placeholder 或并行旧拼写。canonical material identity 只来自服务端 material catalog，并使用 `material.<materialId>`（例如 `material.variable-parameter-table`），不得使用 raw material ID 或显示标题建立第二套 authority。Stage 2 只确认 provider 成功返回非空 raw Markdown、dispatch 绑定的唯一 canonical 写入路径、持久化 receipt/digest、禁止工具与 committed upstream projection 在撰写期间未漂移；标题、章节、材料、表格、围栏、引用、重复和语义均不得作为 Stage 2 admission 或重试条件。流式 Markdown 只是临时传输；成功 terminal envelope 中的完整非空 `result` 是最终文档的唯一 authority，并覆盖该 turn 的 partial stream。仅当 terminal 未携带正文时，才允许使用具有完整 text-block closure 的流式正文；不得因兼容 provider 缺失 `content_block_stop`/`message_stop` 而拒绝其完整成功 terminal，也不得把不完整 partial 当成最终文档。`beegame-*` 注释是服务所有的不可见协议元数据，不是 LLM 文档内容：当且仅当完整 canonical heading 序列逐项精确、唯一且顺序正确时，服务与 frontmatter 一起一次性注入全部 block marker；缺失、歧义、乱序或已存在任意协议注释时原文照常提交，不猜测、不修复、不拒绝，由 Stage 3 发布格式 Issue。Stage 3 对完整八文档统一审计结构、内容、质量、跨文档 semantic ID owner、未定义引用和 alias 冲突；Balance 的公式 ID 仍只在 `formulas` Section 定义，其他 Section 只引用该 ID。

单一 fact owner 同样适用于同一文档内部：可变波次、金额、比例、时长、数量、尺寸和阈值只能在一个 owner Section 中定义。其他 Section 需要该事实时引用稳定 owner Section/决策标识，不得再次保存同一 literal；正文不得在表格之外重新叙述表内同一组事实。Stage 3 只能在 normalized Fact、owner Section 与对应 block 能明确证明重复时发布 Issue，禁止用词频或裸数字频率推断业务重复。

authoring contract 只把实际存在且已提交的 upstream path 当作可用 authority；path 存在时必须直接使用，不能保留“upstream unavailable”分支。唯一的 `upstreamSections` 表只选择目标 discipline 为履行自身 owner 责任而必须消费的上游 owner Section，不投影上游的 production acceptance、tuning validation、discipline-local risk 或其他下游不消费的审计/生产内容。每个 upstream path 在模型侧统一为一个 `path + content` source：服务已注入且合同声明的全部 Section marker 可精确解析时只携带相关 Section；任一必需 marker 不可解析时携带该 path 的完整 raw Markdown 一次。后者只是同一只读 projection 的 document evidence scope，不修正、不认可、不拒绝格式，也不得按标题别名、大小写或关键词增加兼容 parser。只有 contract 明确没有可用 path 时，才能在既有 dependency/risk Section 中记录未决上游决定；不得因此创建第二条文档轨道。

Canonical Foundation 文档路径只使用服务端 `CANONICAL_FOUNDATION_DOCUMENTS`：`docs/GDD.md`、`docs/LEVEL_SCENE_DESIGN.md`、`docs/BALANCE_DESIGN.md`、`docs/TECHNICAL_DESIGN.md`、`docs/ART_DIRECTION.md`、`docs/UI_UX_SPEC.md`、`docs/AUDIO_DESIGN.md`、`docs/ASSET_PLAN.md`。Markdown 跨文档引用只能使用上述精确路径；机械门同时检查正文和代码围栏中的 `docs/*.md`，非 canonical Foundation 路径一律 fail closed。普通 `assets/` 或其他非 `docs/*.md` 路径不属于这项检查。

八份文档的 content-reduction / ownership rules 固定为：

1. **GDD** 拥有行为、状态和玩法规则；数值细节委托 Balance，交互与布局细节委托 UI，GDD 不建立第二份参数或布局表。
2. **Level** 只拥有空间事实（坐标、拓扑、路径、格位、触发器、场景空间与节奏位置）；经济、运行时、视觉、交互和资源事实委托各自 owner。
3. **Balance** 的 `variable-parameter-table` 唯一拥有全部数值型 `var.*` 与 `param.*` ID、单位、值和范围；`Units, Variables and Conventions` 与 `Entity and Ability Parameters` Section 只拥有语义、身份和关系，Fact Store 的 `balance.variable_ids` owner identity 绑定 `material.variable-parameter-table`。Formula owner 只拥有符号化 `f.*`、求值顺序、钳制/取整规则与边界 case ID；边界案例引用参数、变量和来源 case ID，不复制参数表输入值或保存独立派生总计。其他 Section 只引用这些 owner 及其变量、公式、场景和验收 ID，不得复制 owner 数值、结果、总计或完整公式。
4. **Technical** 只拥有 runtime/data boundaries、持久化与恢复的技术事实；不得重新拥有玩法、内容或资源生产事实。
5. **Art** 拥有一张 compact `visual-language-board` 与 `animation-vfx-state-table` 的视觉/动画验收事实，不拥有资源 ID、数量、source/license、责任或 schedule。Art 在 Asset 尚不存在时先暴露语义视觉需求与约束，Asset Plan 后续只能单向将这些需求映射到自己的 resource IDs。Art 只有一个 Visual Language Board，并以 compact Markdown table 作为唯一格式；删除 Art inline SVG 轨，禁止并行 board。UI `wireframe-board` 继续以 inline SVG 拥有响应式几何证据。
6. **UI** 拥有 interaction、input、navigation、screen/state 和 responsive layout mappings；其他文档只引用 UI 的稳定 action、screen、region 与 accessibility ID。
7. **Audio** 拥有 event-to-cue、music state、bus/ducking、loudness/delivery mappings 与验收，不拥有资源生产事实。Audio 在 Asset 尚不存在时先暴露语义 event/cue 需求与约束，Asset Plan 后续只能单向将这些需求映射到自己的 resource IDs；资源 ID、数量、source/license、责任和 schedule 委托 Asset。
8. **Asset Plan** 拥有资源生产事实的各自 owner domain；五个 Asset owner materials 以 inventory ID 为共同 key，分别拥有 inventory identity/semantic requirement mapping、responsibility、dependency/integration、source/licensing evidence、milestone/maturity facts。Audio/Art 先拥有语义需求 ID 与约束，Asset 后续只能将这些需求单向映射到自己的 inventory IDs；上游文档不得预声明或依赖未来 inventory IDs。

Quality 与 performance 按 correctness、可实现性和 measured comparison 评估，而不是固定 business caps；上述规则不构成 token、字数、时间、heading、table、row、diagram、example 或业务规模的固定上限/目标。八份文档的 contract 各自携带一条 merge/reference rule；每个 material 必须遵循其 `authorityRule` 与 single canonical owner representation rule；initial 和 parallel-draft author 均以该服务端规则为准。每个真正不适用的决定只能在拥有该责任的 contract block 中记录一次理由与影响，其他 block 省略；验收表和验收场景只允许出现在 purpose 明确拥有 acceptance、validation、verification 或 testing 的 Section/Material，其他 block 只记录决定；Production Material 的每一行必须拥有不同的记录或映射，不得充当正文复述或等价场景变体。以上是 ownership/density 规则，不是固定行数或体积限制。

## 3.1 Fact Store

Fact Store 不是普通摘要，而是可比较、可校验的标准化事实集合。

Fact extraction uses the current versioned closed catalog (`foundation-facts.v3`) as authority: packets carry exact owner Section/Material text and sort document/block/key identities canonically. A fact worker's packet is its sole business input. It returns only business fields (`key`, `status`, typed `value` or `reason`); provenance is service-owned and bound from the immutable packet's catalog owner block when the durable terminal is constructed. It may receive only language, immutable task/revision/packet identities, the strict output schema, explicit read/write denial, and the packet itself; it must not receive the Confirmed Brief, workspace context, canonical document inventory, or generic project instructions. Brief-derived constraints are projected by local code into catalog keys or immutable digests before dispatch. Catalog 不得内置 boss、tower、wave 等 genre-specific 必需事实；具体实体由通用 entity/inventory coverage 表达。`game.loss_conditions: []` 是“明确无失败状态”的合法权威值，不得被当成缺失。

Local mechanical extraction runs first. Final publication merges mechanically extracted facts with admitted worker facts and their closed evidence. Present mechanical keys and every admitted worker result (including absent or uncertain outcomes) must account for the catalog exactly once; the published Fact Store contains present facts only, while absent/uncertain results remain durable audit evidence and drive deterministic or semantic issues instead of blocking derived publication. Resolved mechanical facts must not be discarded merely because no worker returned them.

> {  
> "players.max": 4,  
> "mechanics": \["move", "attack", "dash"\],  
> "resources": \["露珠", "月光值"\],
> "loss_conditions": [],
> "platform": "quest",  
> "target_fps": 72  
> }

## 3.2 Section Index

聚合记录八份文档的稳定 Section ID、边界与 digest。发现问题时按 revision-bound SectionRef 读取目标区域，避免重新扫描全文；行号只能作为显示信息，不能充当身份或 authority。

> {  
> "document": "GDD",
> "section_id": "rules_systems",
> "start_line": 120,
> "end_line": 185,
> "digest": "sha256:..."
> }

# 4. 审计分层

| **层级**           | **执行方式** | **主要检查**                             | **Token / 时间** |
|--------------------|--------------|------------------------------------------|------------------|
| L0 Schema Check    | 代码         | 字段缺失、类型错误、必填项、枚举值       | 0 Token / 极快   |
| L1 Rule + Contract | 代码         | Fact 一致性、数量、能力覆盖、依赖约束    | 0 Token / 极快   |
| L2 Semantic Audit  | 小模型       | 模糊描述、逻辑合理性、可实现性、体验风险 | 低 / 可控        |
| L3 Deep Audit      | 强模型       | 复杂冲突、BLOCKER、跨章节深层推理        | 高 / 极少触发    |

# 5. 单文档审计优化

不再默认“8 份文档 = 8 次全文 LLM
审计”。先做确定性检查，只有规则无法判断的内容才进入 LLM。

| **检查类型**   | **优先方式** | **示例**                             |
|----------------|--------------|--------------------------------------|
| 字段完整性     | Schema       | GDD 缺失 win_condition               |
| 数值一致性     | Rule         | max_players 前后不一致               |
| 引用对象存在性 | Rule         | Level 引用 Entity_A，但 Asset 中不存在 |
| 描述是否模糊   | LLM          | “适量敌人”“合适速度”                 |
| 玩法是否合理   | LLM          | 机制是否导致无解或无意义             |
| 技术可实现性   | LLM / Rule   | 平台能力边界、交互复杂度             |

# 6. 跨文档审计：从“文档对文档”升级为“Fact 对 Fact”

避免反复读取两份完整文档，改为定义具体 Contract：

规范：跨文档事实比较必须共享同一语义身份命名空间；映射/别名不能代替修改被提取的权威值。

> GDD.player_actions ↔ Technical.supported_actions
> GDD.resources ↔ UI.displayed_resources  
> Level.required_assets ← AssetPlan.covered_level_requirements
> Art.style_constraints ↔ AssetPlan.asset_constraint_refs（语义覆盖）
> Technical.performance ↔ Level.production_acceptance（语义可行性）

关卡资产需求与物理资产库存是两层不同事实，不能把自然语言需求和物理 ID 做字面比较。`level.required_assets` 保留 LEVEL
`content_matrix` 的上游需求条目/标签；`asset.inventory_ids` 保留 ASSET_PLAN
`material.asset-inventory-table` 中的物理资产 ID（例如 `GC-BOARD`）。AssetPlan 映射表把每个关卡需求条目承载到一个或多个物理资产，并由
`asset.covered_level_requirements` 提取“已由资产承载的关卡需求条目/标签”。唯一的确定性覆盖契约是
`asset.covered_level_requirements -> level.required_assets` 的 `contains-all`，其缺项仍由 ASSET_PLAN#material.asset-inventory-table 修复；
`asset.inventory_ids` 只能用于物理库存/交付事实，禁止直接与 `level.required_assets` 比较。

`game.resources` 与 `ui.displayed_resources` 也共享同一组 canonical 短标签：包含 HUD 跟踪的货币与生命池，去掉括号内英文别名和说明后再比较；文档中的具体标签仅是项目自身的 authored values，不构成全局固定枚举。

`technical.target_fps`、`level.complexity_budget` 与 `asset.art_constraint_refs` 是保留在 normalized Fact Store 中的 deferred semantic facts：缺失或 `uncertain` 时不先生成 schema BLOCKER，也不把多维 `LEVEL#production_acceptance` 预算强行压成单一整数；若事实已存在，仍执行闭 catalog 的类型/取值校验。语义 packet 必须同时携带其 owner block：性能检查携带 `LEVEL#production_acceptance`，资产检查携带 `ART#visual_pillars` 与 `ASSET#material.dependency-integration-diagram`，由模型判断预算可行性和引用/约束覆盖。`asset.art_constraint_refs` 是 ART 约束的引用身份层，禁止与 `art.style_constraints` 的约束值做 deterministic 字面 `contains-all` 比较。`audio.event_ids` 的唯一 owner 是 `AUDIO#material.event-cue-matrix`；`asset.inventory_ids`、`asset.covered_level_requirements` 与实际交付格式的唯一 owner 是 `ASSET#material.asset-inventory-table`。

能通过 Fact 直接判定的冲突不调用 LLM；只有语义层面的冲突才进入 Semantic
Audit。

## 6.1 定向语义检查清单

Semantic Audit 不做全文自由扫描，也不按“8 份文档各读一次”运行。首版只运行下列 10 个无法由 Schema / Rule / Contract 直接判定的高风险游戏核心检查；数量来自十个互不重复的风险域，不使用无来源的固定边数。

| Check ID | 精确 Section 输入 | 相关 Facts | 判断目标 | 等级 / 模型 |
|---|---|---|---|---|
| `SEM.gameplay_level_viability` | `GDD#core_loop` + `LEVEL#pacing_beats` | `game.mechanics`, `level.required_entities` | 核心循环、遭遇、节奏与反制是否可玩且不互相否定 | HIGH / balanced |
| `SEM.progression_balance_coherence` | `GDD#progression` + `LEVEL#content_matrix` + `BALANCE#executive_summary,units_variables,entity_parameters,formulas,economy,progression_curves,challenge_model,rewards_value,bounds_exploits,tuning_validation` + `BALANCE#material.variable-parameter-table` | `game.resources`, `balance.variable_ids` | 逐波数量→公式→经济→摘要/owner table可重算且进度、资源流与成长曲线一致 | HIGH / balanced |
| `SEM.state_runtime_recovery` | `GDD#states_flow,material.game-state-flow` + `TECHNICAL#runtime_state,save_load` + `UI#screen_inventory,feedback_errors` | `game.states` | 只审计暂停、失焦、挂起、恢复、运行时快照与持久化降级；胜负/重开不在本 Check 重复审计 | HIGH / balanced |
| `SEM.platform_performance_feasibility` | `TECHNICAL#performance,risks,executive_summary` + `LEVEL#production_acceptance` | `game.platform`, `technical.target_fps`, `level.complexity_budget` | 目标平台、关卡复杂度与性能预算现实，且拒绝把已有上游 authority 描述为 unavailable | HIGH / balanced |
| `SEM.interaction_ui_coherence` | `GDD#player_actions` + `UI#input,experience_architecture,prototype_acceptance` | `game.mechanics`, `ui.supported_actions` | 只审计普通玩家动作、滚动、导航、输入映射与交互验收；不重复审计生命周期与胜负/重开 | HIGH / balanced |
| `SEM.camera_visual_readability` | `LEVEL#camera_readability,world_structure,objectives_routes` + `ART#composition_readability,camera_presentation,color_lighting,material.visual-language-board` + `UI#experience_architecture,hud,prototype_acceptance,material.wireframe-board` | `art.style_constraints` | 坐标、路径与格位可计算，viewport、安全区、断点、区域和 overlay 几何在 Level、UI 与 Art 布局之间一致且可读 | MEDIUM / fast |
| `SEM.content_asset_feasibility` | `ART#animation,vfx,asset_specifications` + `ASSET#executive_summary,inventory,dependencies,formats_budgets,validation,material.asset-inventory-table,material.milestone-maturity-table` | `level.required_assets`, `asset.inventory_ids`, `asset.art_constraint_refs`, `asset.formats` | 资产类型与实例、帧数/图元/物理文件和预算总计可重算且与上游一致，拒绝 stale unavailable 假设 | HIGH / balanced |
| `SEM.audio_state_feedback` | `GDD#states_flow` + `AUDIO#event_taxonomy,music,production,executive_summary,material.event-cue-matrix,material.music-state-diagram,material.bus-ducking-diagram` | `game.states`, `audio.event_ids` | PAUSED、失焦、静音及其他关键状态在音频正文、摘要、事件/音乐/总线派生视图中行为一致，拒绝 stale unavailable 上游假设 | MEDIUM / fast |
| `SEM.multimodal_accessibility` | `GDD#accessibility_localization` + `UI#accessibility,material.focus-accessibility-matrix` + `ART#color_lighting,material.visual-language-board` + `AUDIO#ui_feedback` | 无额外 Fact；只使用列出的 Section | 只审计视觉、输入模态、焦点与非视觉替代；不得新增或改写玩法生命周期动作 | HIGH / balanced |
| `SEM.completion_recovery_coherence` | `GDD#states_flow,challenge_recovery,material.game-state-flow` + `LEVEL#objectives_routes,spawn_checkpoint` + `UI#player_journeys,screen_inventory` | `game.states`, `game.win_conditions`, `game.loss_conditions` | 只审计胜负、目标、失败、关卡检查点、重试与重开；暂停/失焦/挂起/恢复由 `state_runtime_recovery` 独占 | HIGH / balanced |

Semantic packet discipline is part of this authority: when normalized Facts already project the relevant owner-section information, the packet does not repeat that section merely as duplicate evidence; deferred semantic facts are the explicit exception and always carry their owner Section. Service-marked `Executive Summary` and `Production Materials` entries (`executive_summary` and `material.<materialId>`) are auditable, revisable blocks and may be included only when explicitly listed by a check. The `Production Materials` container heading and the audit appendix are structural metadata, not part of any preceding section. A marked contract block ends at the next Markdown heading of the same or higher level; packets are formed from the exact complete block or explicitly listed check scope. A legal block is never truncated to satisfy an arbitrary business-size limit. The only fixed output boundary is the existing 2 MiB UTF-8 structured-output infrastructure safeguard in §13.

每个 Check 独立按表中精确完整 Section/明确 check scope 形成 packet，只携带相关 normalized Facts 与 deterministic issue 引用；不携带其他文档或截断合法 Section。同一业务语义只能由表中一个 Check 拥有：`state_runtime_recovery` 独占暂停/失焦/挂起/恢复，`interaction_ui_coherence` 独占普通动作/输入/导航，`completion_recovery_coherence` 独占胜负/检查点/重试/重开，`multimodal_accessibility` 只判断模态与可访问性且不得定义生命周期动作。每个 worker 使用全新、不可累积的上下文，返回 `PASS | ISSUES | UNDECIDABLE`，不生成说明文档。跨文档 Issue 的 `sourceSectionKey` 必须指向使 `expected` 成立的 canonical owner evidence，`remediation.sectionKeys` 必须指向需要修正的下游冲突，不得反向修改 owner 以追随下游文本。`UNDECIDABLE` 或 BLOCKER 才允许以同一 packet 发起一次 strong confirmation；禁止通过重读全文或扩大上下文解决。业务 packet 不设固定 KiB 上限；结构化输出仅受 §13 现有 2 MiB UTF-8 基础设施边界约束。

# 7. Issue Registry

```json
{
  "id": "AUD-023",
  "severity": "HIGH",
  "type": "contract",
  "source": {
    "documentPath": "docs/LEVEL_SCENE_DESIGN.md",
    "sectionId": "content_matrix",
    "heading": "Content Matrix and Replay Structure",
    "startLine": 42,
    "endLine": 68,
    "digest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "target": {
    "documentPath": "docs/ASSET_PLAN.md",
    "sectionId": "material.asset-inventory-table",
    "heading": "Asset Inventory Table",
    "startLine": 30,
    "endLine": 57,
    "digest": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
  },
  "expected": "The Asset Inventory Table covers every required Level asset requirement.",
  "actual": "One required Level asset requirement has no inventory mapping.",
  "remediation": {
    "kind": "patch",
    "documentPath": "docs/ASSET_PLAN.md",
    "sectionIds": ["material.asset-inventory-table"]
  }
}
```

严重程度：BLOCKER / HIGH / MEDIUM / LOW。Issue Registry 中每个问题必须且只能携带 `patch` remediation，并使用严格互斥的 `scope: section | document`。`section` 指定同一 canonical 文档中的一个或多个完整 Section；`document` 只用于文档结构无法建立可信 SectionIndex 时的整篇格式修复，绑定 canonical path 与精确 document digest，不伪造 SectionRef。所有 severity 均自动进入 stage 4 修订，不得豁免。Reviewer 必须依据 Source of Truth 顺序、明确硬约束与最小改动原则，直接确定能使 `expected` 成立的最佳单文档 Patch；不得暂停等待外部裁决、不得生成分支路径，也不得保留第二种 remediation 或旧 shape 兼容字段。

`section` patch 只在其 `expected` 能由指定 Section 独立实现、且不需要下游重新解释或覆盖上游 Source of Truth 时允许入场。多个目标 Section 必须属于同一文档；跨文档冲突必须拆成各自拥有单文档修复 authority 的独立 Issue。格式错误若明确指向一个 canonical block，且 immutable marker index 仍能证明其边界，Reviewer 必须发布该 block 的 `section` patch；只有 marker、标题或顺序损坏导致可信 SectionIndex 无法建立时，才对该文档发布一个合并后的 `document` patch Issue。不得将 parser 异常转成 `needs_action`。同一文档同一轮不得混合 `section` 与 `document` scope。Reviewer 必须在既定硬约束内收敛到最小改动，不能把业务问题升级为人工等待。

已知 gap-budget 冲突必须按现有玩法的最小权威解释修复：`FIXED_SETTLEMENT_DEW` 表示“一次间隙至少可执行一个有意义动作、但固定结算本身不足以同时补塔与升级”的取舍边界只约束该间隙新发放的固定结算 `S_w`；此前保存的余额与击杀掉落仍是玩家可即时消费或保留的技术奖励，不得被文案假定为强制波内花完。若 GDD 使用“间隙全部可用露珠”等含糊或扩大表述，必须在 GDD progression owner 中澄清；Balance 已明确按 `S_w` 实现时不得生成无进展 Patch。不得为满足该边界发明余额上限、过期、强制消费或双钱包等未获授权的新玩法。

审计问题与运行完整性失败必须分离：业务矛盾、遗漏和新发现的问题进入并发布唯一的 Issue Registry，驱动下一修订轮；缺失或非法 terminal、越权 Section、非法 Patch、receipt 不完整等可由 fresh revision attempt 纠正的提交失败不进入 Registry，也不得进入人工 `needs_action`，必须 fail closed、丢弃该失败 attempt 的 staged bytes 并自动重派同一文档。只有不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 无进展才进入 `needs_action`。短暂的 provider/receipt/callback 失败仍自动重试，不得伪装成业务决策。发现新 Issue 不是拒绝发布本轮 Registry 的理由。

Worker 未产生完整可见 raw Markdown、在 terminal 之前结束、提交非法正文、修改越权 Section 或未能形成合法 receipt，只表示该 revision task 的本次 attempt 失败；不得伪造 evidence、不得把失败当作业务 PASS/ISSUE，也不得把整个 Foundation run 变成人工 `needs_action`。Revision worker 不输出 terminal JSON：section scope 只返回按 packet `sectionIds` 顺序排列的完整 canonical heading + body，document scope 在一次绑定只读后返回完整 staged Markdown；changed Section、原子写入、metadata、snapshot、terminal identity 与 receipt 全部由服务从 raw Markdown 和本地 authority 派生。每次重派前服务必须从本轮 canonical base 重新建立干净 staged document，并把上一失败 attempt 的精确结构化诊断加入新 dispatch prompt。Revision task 不设固定 attempt 次数上限，必须自动重派直到形成合法 Patch 并通过定向复核；该自动重试不改变 round、base authority、immutable Issue packet 或已冻结的其他文档。除上述 `needs_action` 条件外，短暂的 provider/receipt/callback 失败仍自动重试，不得伪装成业务决策。

最终 Registry 发布前必须按 canonical conflict identity 合并 deterministic 与 semantic 重复问题：同一 owner fact/contract、同一 source/target block 与同一 remediation block 只能保留一条 Issue，severity 取最高值，证据引用合并；`reasonCode`、checkId、措辞或审计层都不是 conflict identity，不能据此生成两条修订任务。对于 closed-catalog required fact，fact ID 是业务条件 identity。不同业务条件即使落在同一 Section 也不得误合并。

# 8. Source of Truth

跨文档冲突必须预先规定解释权：

> GDD  
> ↓  
> Technical  
> ↓  
> Level / Balance / UI / Art  
> ↓  
> Asset Plan

例外：Technical 可对不可实现需求产生 BLOCKER，并要求修改
GDD，但不能静默改变玩法。

# 9. 修订：Batch Patch，而不是全文重写

先按 remediation 的 Doc + scope 聚合全部 `patch` Issue，同一文档形成一个互斥的 section-scope 或 document-scope batch。Reviewer 发现 Issue 后必须进入 stage 4；不同文档的冲突已拆为不同的单文档 batch，不得在此阶段等待人工介入。

> 17 Issues  
> ↓ group by Doc  
> GDD 3 issues → 1 revision call  
> Technical 4 issues → 1 revision call  
> AssetPlan 6 issues → 1 revision call  
> UI 4 issues → 1 revision call

不同文档的修订并行执行，墙钟时间接近最慢的单个修订任务，而不是所有任务耗时相加。

每个 immutable revision packet 必须携带完整 Issue、互斥 scope、全部可写目标以及判断冲突所需的只读证据与 Source of Truth 顺序；同一 round 上一失败 attempt 的结构化诊断由服务作为 retry-only dispatch prompt overlay 注入，不得改写 packet 或其 digest。section scope 携带完整可写 Section，packet 中的 `sections[].text` 是模型所需的完整当前写权限威，模型不得再读取整份 staged 文档，未授权 Section 由服务保持 byte-identical；document scope 只用于无法证明 block 边界的格式损坏，携带绑定 digest 的完整目标文档，只允许通过一次 dispatch-bound read 读取并替换该 staged 文档，并在提交前验证非空、canonical complete-document 结构及 digest。对 Fact / Schema 的 section Issue，packet 还必须携带对应 closed-catalog `factConstraints`。Worker 必须让 `expected` 成立并消除 `actual`；不得用别名、兼容说明、风险登记或同义改写替代修复。两种 scope 复用同一 planner、task collection、worker、staged candidate、terminal、receipt 与 publication，禁止第二修订器或 fallback；只有 section scope 使用 PatchValidation、impacted Fact 与 targeted semantic recheck。document scope 不伪造 SectionIndex 或 targeted recheck，发布后必须返回 fresh Stage 3 完整复审。

## 9.1 Patch 格式

> {  
> "doc": "AssetPlan",  
> "section": "Asset Inventory Table",
> "operation": "replace",  
> "issue_ids": \["AUD-023", "AUD-031"\],  
> "content": "..."  
> }

section scope 支持 INSERT / REPLACE / DELETE，禁止默认整篇重写；document scope 仅允许因格式 Issue 执行一次绑定完整 staged 文档的 REPLACE。

修订提交时，文档 frontmatter 的 `version` 与 `updated_at` 是服务所有的元数据：服务以本轮修订前的 canonical 文档为唯一 authority，为本轮计算唯一候选 PATCH 版本并推进候选 `updated_at`，然后从最终 staged bytes 派生验证 digest。候选元数据在 COMMITTED 前不是 canonical authority；失败 attempt 不得改变 canonical 元数据。同一 task/round 的重试或 Submit 重放必须复用同一候选版本与时间，不得再次递增。Worker 不得改变这两个字段；缺失、格式非法、非预期版本或时间未推进都必须 fail closed。

合法 Submit 还必须把最终 staged bytes 保存为由 `revision + round + taskId + stagedDocumentDigest` 内容寻址的 immutable Markdown snapshot。一个失败 attempt 的内容不得占用 task 级单例路径、覆盖另一 attempt，或阻止同一 task 后续合法结果提交；receipt 以 `stagedDocumentDigest` 唯一选择其完成证据。共享 staged path 只是可重建工作副本，不是完成证据；恢复、impacted Fact、PatchValidation 与 publication 在使用完成任务前必须由该 snapshot 校验并恢复工作副本。规划 fresh task 不得在 durable task/bundle commit 之前 reset 或覆盖任何 staged 文件；新 task 只有在 durable claim 成功后才能重建自己的工作副本。新 taskId 不得继承旧 task 的 dispatch、attemptHistory、receipt、terminal、usage、failureReason 或 supersededBy。同轮 Targeted Recheck 只有部分 Issue 失败时，fresh retry packet 必须只携带这些失败 Issue 及其 remediation Section；已经 PASS 的 Issue、Section 和事实影响不得再次进入 retry task。

# 10. 修订后验证：section 验证 Patch，document 回到 Stage 3

> 修订前：  
> Level.required_assets = ["player", "arena"]
> AssetPlan.covered_level_requirements = ["player"]
>   
> Patch 后重新提取：  
> AssetPlan.covered_level_requirements
>   
> 验证：  
> AssetPlan.covered_level_requirements contains-all Level.required_assets
> → PASS

section scope 只有 Patch 引入新的语义风险或代码规则无法判定时，才触发 Targeted LLM Recheck。document scope 因进入 Stage 4 时没有可信 SectionIndex，不运行 section PatchValidation、impacted Fact 或 Targeted LLM Recheck；Stage 4 只验证修订提交的完整结构、权限和 digest，发布后清除旧格式审计状态，并从 fresh Stage 3 对完整八文档重新审计。

Targeted Recheck 只允许返回 `PASS | FAIL`，不得返回 Stage 3 审计使用的 `ISSUES | UNDECIDABLE`、发现新 Issue 或改写原 Issue。其 `FAIL` 必须返回结构化诊断：Patch 后观察到的 `actual`、精确 Section evidence 与稳定 reason code；未满足的原 `expected` 由服务从 admitted Issue 注入，worker 不得回传或改写。诊断只属于 attempt evidence，不得改写 Issue、confirmed brief、canonical 文档或 Source of Truth，也不得替代下一次 Patch。

任何 PatchValidation 为 `FAIL | UNDECIDABLE`、Targeted Recheck 为 `FAIL`，或 revision worker 未通过唯一合法的 `APPLIED` terminal 完成一次服务绑定的 Apply 时，本轮 staged authority 都不得写入 canonical、不得产生 COMMITTED、不得推进正式文档版本或 document revision。`changedSectionIds` 只能由服务端对 staged bytes 计算，worker 不得声明。controller 在同一 round、同一 base authority 内只自动重派失败文档；已经 PASS 的 staged bytes 必须冻结，后续 attempt 不得无条件重写。每个 PASS validation 必须绑定其全部 source/target dependency digests；任一依赖因其他文档的新 attempt 变化时，该 validation 立即失效并必须针对最终 staged bundle 重跑。重验 PASS 时继续复用冻结 bytes，重验 FAIL 时才解冻该文档并纳入下一次失败文档集合。可恢复的 revision/validation failure、短暂的 provider/receipt/callback 失败不得进入 `needs_action`，仍须自动重试且不得伪装成业务决策；只有不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 无进展时才进入 `needs_action`。

只有本轮全部文档和 Issue 均验证 PASS，服务才可用 PREPARED / JOURNAL 执行可恢复的 roll-forward，并在完整 COMMITTED 后一次性向 controller 与 Dashboard 暴露新的 canonical authority。多文件 publication 是 journaled logical atomicity；中途状态不得被投影为已提交 authority。

# 11. Impact Analysis

每个 Fact / Section 建立依赖图，修改后只重审真正受影响的 Contract。

> GDD.Combat  
> ├─ Technical.CombatSystem  
> ├─ Balance.CombatValues  
> ├─ UI.CombatHUD  
> └─ Level.EncounterDesign

# 12. 模型分级策略

| **任务**                 | **推荐执行者**         |
|--------------------------|------------------------|
| Schema / Rule / Contract | 本地代码               |
| LOW / MEDIUM 语义问题    | 便宜/快速模型          |
| HIGH                     | 中档推理模型           |
| BLOCKER / 无法判断       | 强模型                 |
| Patch Validation         | 优先代码，必要时小模型 |

# 13. Token 与耗时控制规则

| **控制项** | **建议**                                 |
|------------|------------------------------------------|
| LLM 输入   | 只传 Issue + 可写目标 Section + 必要只读 source/target Section、Facts 与已 admitted 诊断 |
| LLM 输出   | 强制 JSON / Patch，不允许长篇解释        |
| Issue 处理 | Registry 中的所有 severity 均须处理       |
| 修订调用   | 同文档合并，一文档尽量一次               |
| 并行度     | 有界并行；默认同时运行上限 4，任务声明可取更低值；并发上限不得解释为必需任务总数上限 |
| 复审       | 优先 Patch Validation，不做全文 Re-Audit |
| 全文读取   | section-scope 禁止；仅 document-scope 格式修复允许一次 dispatch-bound 全文读取 |

必需任务数必须按当前 case 的文档规模、Issue Registry、风险覆盖与确认依赖动态生成，不得预设统一总数上限。由封闭事实目录或本规范明确风险域推导出的固定数量，只表示必须完整覆盖的集合基数，不是复杂度预算，也不得阻止为实际发现追加合法的 deep / confirmation / revision 任务。

计量必须从实际任务 terminal 推导，并逐 attempt 记录真实 token、duration 和 failure reason。不得以任意固定 token、字数、文档体积或墙钟时间判断业务内容是否合格，也不得以全局 cap 或共享 deadline 提前终止尚未打开的任务。基础设施级传输故障只能终止当前 dispatch，并由不可变 attempt history 保留证据后创建 fresh dispatch；恢复不得重置、覆盖或伪造既有 attempt 证据。

provider 流式 usage 是累计快照，只用于进行中显示；不得逐快照累加或扣费。每个 turn 终态必须计算 `turnDeltaUsage = terminal provider cumulative - turn starting cumulative`，持久化和实时扣费的顶层 `usage` 必须就是该 delta，而不是仅把 delta 放入 metadata 后仍提交累计值。workflow 计费幂等键绑定 `runId + dispatchId + terminalDigest`，同一终态重放只允许一条 usage record 与一次 debit。

每任务的输出边界由任务身份、作用域与 provider/native 输出约束定义：Stage 3 fact、semantic、strong-confirmation 与 Stage 4 targeted recheck 使用严格小型结构化 Schema；Stage 2 author 与 Stage 4 document-revision 的文档正文使用 raw Markdown，禁止把大型 Markdown 编码进 JSON 或工具参数。重试次数仅可作为 Stage 3 fact、semantic、strong-confirmation 或 provider/native 单次 dispatch 的有界边界，不得把 attempt 次数作为 Stage 4 document-revision、impacted-facts 或 semantic-recheck 的输出或停止边界。不得再用一个固定 token 估算值二次拒绝已经满足业务契约的合法结果。进入服务的 payload 只受现有 2 MiB UTF-8 基础设施边界约束，防止异常数据造成资源耗尽；该上限不是审计质量、Issue 数量或业务复杂度预算，超限必须明确归类为基础设施失败。

文档 authoring、Fact、semantic 与 revision 的合法业务输入同样不得按统一字符数、token 数或 KiB 数截断或拒绝；作用域必须由 Section、Fact、Issue、Contract 与 Impact 决定。基础设施 payload 防护可保留，但必须与业务复杂度预算分离，并以明确的基础设施错误呈现。

# 14. 停止条件

Reviewer 发现业务 Issue 后，controller 必须立即将其纳入唯一 Issue Registry 并派发 stage 4 Patch；所有 severity 一律处理。Stage 4 完成后执行定向复核；若 Registry 仍非空，必须引用新 authority 继续下一轮 stage 4，直到 Registry 清零。不得因业务歧义、范围争议或跨文档冲突暂停流程；这些情况必须由 Reviewer 依据 Source of Truth、明确硬约束与最小改动原则拆分并完成单文档 Patch。只有 Registry 为空才允许 PASS/进入后续流程。不得设置固定最大轮次或按预设轮次分配 severity 预算。

仅在不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 确实无进展时进入 `needs_action`；revision task 的失败 attempt、定向复核 FAIL 以及短暂的 provider/receipt/callback 失败必须留在自动闭环内，仍自动重试且不得伪装成业务决策，不能以 attempt 耗尽要求人工介入。Issue Registry 是唯一完成与进展 authority，同一 Registry digest 在一轮修订和定向验证后仍然不变即表示无进展，即使 worker 改动了文档 bytes、生成了新 document revision，也不得用这些内容漂移掩盖无进展并继续下一轮。不得以任何 severity 豁免未清零的 Registry，也不得创建另一条候选/兼容修订轨道。

# 15. 最终生产 Pipeline

> Idea  
> ↓  
> 3 Briefs  
> ↓  
> Generate 8 Docs  
> ↓  
> Generate Fact Store + Section Index  
> ↓  
> Schema Check \[Code\]  
> ↓  
> Rule / Contract Check \[Code\]  
> ↓  
> Semantic Audit \[Cheap Model\]  
> ↓  
> Deep Audit if needed \[Strong Model\]  
> ↓  
> Issue Registry  
> ↓  
> Batch Patch Revision \[Parallel\]  
> ↓  
> Update Facts  
> ↓  
> Impact Analysis  
> ↓  
> Patch Validation \[Code First\]  
> ↓  
> Targeted Recheck if needed  
> ↓  
> PASS  
> ↓  
> DSL / Checklist  
> ↓  
> Asset Preparation  
> ↓  
> Implementation Tasks  
> ↓  
> Build / Test / Delivery

# 16. 用户后续修改时的复用

> User Change  
> ↓  
> 识别受影响 Domain / Facts  
> ↓  
> Patch Source-of-Truth Doc  
> ↓  
> Update Facts  
> ↓  
> Impact Analysis  
> ↓  
> Patch 相关文档  
> ↓  
> Contract Validation  
> ↓  
> 必要时 Targeted Semantic Audit  
> ↓  
> PASS  
> ↓  
> 更新 DSL / Implementation Delta  
> ↓  
> 修改代码

普通用户在 DELIVERY 阶段的问答/后续 change 入口不是 Foundation Issue remediation 或产品决策分支，不得影响 reviewer→stage4 自动闭环。

# 17. 预期收益

| **维度**   | **优化结果**                                     |
|------------|--------------------------------------------------|
| Token      | 大量一致性检查从 LLM 转为 0 Token 的代码检查     |
| 耗时       | 规则检查极快；LLM 任务缩小并可并行               |
| 可预测性   | 成本由 Fact / Issue 数量决定，不再由全文长度决定 |
| 修订稳定性 | Patch 限定修改范围，减少无关内容漂移             |
| 可扩展性   | 项目越大越能体现增量审计优势                     |
| 后续修改   | 复用同一 Impact + Patch + Validation 体系        |

目标状态：70%–90% 的一致性检查不消耗 LLM Token；只有 10%–30%
的语义问题进入模型。该比例是架构目标，不是固定保证值。

# 18. 最终原则

- Fact Store 控制上下文。

- Rule Engine 消灭确定性问题的 Token 消耗。

- Contract 控制跨文档检查范围。

- Issue 控制修订内容。

- Batch Patch 控制调用次数。

- Impact 控制复审范围。

- Patch Validation 代替全文 Re-Audit。

- LLM 负责语义判断，而不是承担所有审计。

- 单一 durable task collection 负责 dispatch、恢复与审计记录；不得为暂停恢复、Reviewer 或 revision candidate 创建第二套状态机。
- 原生 revision worker 每个 dispatch 使用唯一空 sandbox cwd；真实 project workspace 只能通过 service 注入的受信环境变量供 dispatch-bound revision tools 使用。模型不得接收、复制或提交 staged path。
- 原生 revision worker 的输出面按互斥 scope 收窄：section scope 不暴露任何工具，只使用 packet `sections[].text` 并返回所有授权 Section 的完整 raw Markdown；document scope 只额外暴露零参数 `ReadAssignedFoundationRevision`，读取服务绑定的 staged artifact 后返回包含 frontmatter、标题、正文与全部协议 marker 的完整 raw Markdown。服务按 canonical section identity 合并 section scope 输出，保持未授权 bytes 不变，并统一执行原子写入、metadata、digest、snapshot 与 receipt。不得暴露模型侧 Apply/Submit、通用 Read/Edit、Bash、Grep、Glob 或其他文件访问/旁路工具，也不得保留旧工具协议 fallback。
- document scope 的 `ReadAssignedFoundationRevision` 必须原样返回完整 staged Markdown；`beegame-*` marker 虽由服务拥有，但在整文替换中是必须 byte-for-byte 保全的 opaque authority，不能先删除再要求最终文档包含。完整 `documentContract` 只承担结构保全权威，不是第二份审计清单；Revision 只能修复 packet 中已 admitted 的 Issues，不得自行发现或顺带修复未进入 Registry 的缺陷。若 admitted 的结构 Issue 必须补齐被截断的尾部，允许的 collateral change 仅限令该 Issue 的 expected 成立所必需的最小完整结构。

- 唯一持久化证据载体是 `foundationAuditState`，用于把已发布的 Issue authority 从 Reviewer 交给 Revision；它不是共享执行阶段。Stage 3 必须使用 durable phase `DOCUMENT_REVIEW` + step `FOUNDATION_REVIEW`，只运行初始 Fact、deterministic 与 semantic Reviewer 状态；Stage 4 必须使用 durable phase `FOUNDATION_REVISION` + step `FOUNDATION_REVISION`，只运行 `planning | revising | rebuilding_facts | validating | semantic_recheck | publishing | round_closing`。两组状态在 schema 中互斥，任何 Reviewer 状态落入 Stage 4、任何 Revision 状态落入 Stage 3、或 dispatch phase 与 run phase 不一致都必须 fail closed。禁止保留把 Revision 投影为 `DOCUMENT_REVIEW` 的旧分支、`foundationRevisionState`、别名、双读/双写、旧 schema reader、迁移器或 fallback。

- Review copy 初始化直接进入唯一可运行的 `DOCUMENT_REVIEW` / `FOUNDATION_REVIEW` 状态；Reviewer 若发布非空 Registry，controller 只负责一次显式阶段切换，随后由 `FOUNDATION_REVISION` runner 接管。Stage 4 发布整文修订后显式返回 fresh Stage 3；section 定向验证清零后才进入 Checklist。不得先持久化虚假 `needs_action`/`implementation unavailable` 再由另一入口覆盖。

- Stage 2 Foundation document-author 只有一个 author dispatch 轨道。provider 成功返回的非空 raw Markdown 必须原样进入唯一 canonical commit（只允许注入服务所有的 frontmatter 与 `beegame-*` block identity 元数据），不得因标题、章节、表格、围栏、材料、引用、重复或语义形状触发 continuation、replacement、fresh dispatch 或 `needs_action`。block identity 注入只接受完整、精确、唯一且顺序正确的 canonical heading 序列；条件不成立时不得使用别名或 heuristic，也不得拒绝提交。缺失可见输出、provider 调用失败、越权工具/路径、写入失败、receipt/digest 不一致或 committed upstream projection 漂移仍属于 Stage 2 基础设施失败。完整文档 validator 不得从 Stage 2 到达：Stage 3 Reviewer 用它产生每份文档唯一的格式 Issue，并选择可证明的最窄 authority——可信 block 边界存在时为 section scope，否则为 document scope；Stage 4 只验证该 admitted Issue 的修订提交，不得产生第二份 Issue 或审计轨。修复发布后回到 Stage 3，Registry 为空前不得进入后续流程。不得创建第二状态机、兼容轨或并行候选文档。

- Dashboard 只投影普通任务状态、轮次、Issue 数量/严重程度摘要、按任务聚合的 compact task telemetry（usage/duration）与 safe projected failure reason；每个 blocked/failed 状态必须同时提供明确摘要、稳定 diagnostic ID 和经过凭据/主机路径脱敏及长度限制的技术原因，未知错误不得退化成只有通用文案。active worker 从 turn start 到 terminal 都必须显示为 working；thinking block 结束只表示进入正文/工具输出，不得提前显示 idle。它不是审计或修订 authority，也不展示 raw Registry JSON、`problem`/`actual`/`evidence`、worker prose/thinking 或 worker feedback。Foundation review 与 revision 期间的 worker message 只保留在运行日志与 durable evidence 中，不进入阶段卡片。
- 阶段显示必须直接投影 durable phase：`DOCUMENT_REVIEW` 固定为 stage 3，`FOUNDATION_REVISION` 固定为 stage 4；禁止再根据 `foundationAuditState.status` 猜测或合成虚拟 stage 4。冻结的审计卡必须保留 stage 3，进入修订时生成 stage 4 live card，返回 Reviewer 时生成新的 stage 3 authority，checklist drafting 不得回退到旧审计卡。
- 所有业务 Issue（包括首次审计发现的 Issue）在 Registry 发布后均直接进入 stage 4；不存在因业务歧义、范围争议、跨文档冲突或 revision attempt 失败停留在 stage 3/4 的 `needs_action` 分支。stage 4 只有在不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 无进展时才可显示 `needs_action`；短暂的 provider/receipt/callback 失败仍自动重试，不得伪装成业务决策。

- 所有终态任务都保留 usage、duration 与 failure reason，确保成本和失败可按任务追溯。

## 19. Checklist 单轨提交

Foundation revision READY 后，Checklist 是唯一的下游派生产物，而不是第二份玩法、数值、资源或审计 authority。每一个 Foundation Section 和 Production Material 必须在唯一 document contract 中显式声明 `checklistMode`：`scenario`、`gate_reference` 或 `exclude`；不得从 discipline、responsibility、标题、关键词或任何 heuristic 自动推导。`scenario` 仅用于能形成独立、玩家可观察 pass/fail 的 source block，projection 才携带该 block 的原文。`gate_reference` 仅输出稳定的 path/block/title 引用，Checklist 只能写固定 owner-gate 行，不得复制数值、预算、资源、SVG、布局、来源、授权、排期或其他 owner detail。`exclude` 不进入 projection。Asset Plan 的资源、责任、来源、授权、排期与库存事实默认 `exclude`，不构成 gameplay acceptance。

服务只从当前 committed Foundation revision 的这些显式 mode 生成 immutable raw-Markdown authority projection；projection 不注入八份全文、不把失败 Checklist 当作 authority，也不建立第二个 Fact Store、semantic summary 或 coverage truth。每个 checkbox 必须带一个 source tag：`- [ ] ID [docs/path.md#section_or_material] description`。唯一 Checklist parser 机械验证 stable ID、非空描述、source 存在且未 `exclude`；`gate_reference` 必须使用固定的 owner-gate 描述，因而不能重新叙述 owner 内容。它不按关键词、数值或任务数量作语义评分。

Checklist author 只有一个逻辑 task，并且只写其 dispatch-bound candidate Markdown。它的 native tool allowlist 仅为 Write/Edit candidate；不得使用 Bash、Read、Grep、Glob 或其他写入能力绕过 frozen projection。candidate 先由服务使用唯一 Checklist parser 验证上述机械约束；author prompt 以 projection 限定内容范围并要求合并等价场景。通过后服务原子提交 `docs/acceptance/gameplay-checklist.md`；失败 candidate 只保留 durable diagnostics，永不成为 canonical 文件或后续 author prompt baseline。恢复仍针对同一个逻辑 task 和冻结 projection，创建干净 candidate；不得保留 direct-canonical write、旧 candidate overlay、并行 author 或兼容 reader。

Checklist author 输出始终是 raw Markdown，不以 JSON 替代。Checklist 规模由实际不可互相替代的可观察场景决定；不得以任务数、token、字数、耗时或 attempt 设置业务合格上限。Checklist 结构通过后唯一进入 Resource Preparation。Checklist 是独立展示阶段，不得显示为 Foundation 审计或修订 stage，也不得创建 Checklist Reviewer/Closure 的第二 authority。

**推荐生产架构：Fact Store + Rule Engine + Contract Validator + LLM
Semantic Auditor + Incremental Patch**
