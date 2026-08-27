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

## 3.0 人类文档 authority 与材料视图

每份 canonical 文档的 `Executive Summary` 只是 authority index：它只能索引本文件拥有的最终决定与稳定 Section/Material 引用，不能创建第二份事实或独立的可变总数。`Production Materials` 不再默认是统一的 derived views；每个 material 都按 contract 声明自己的 `authorityMode`（`owner` 或 `reference_only`）与 `authorityRule`。`owner` material 是其列明事实类型的唯一 canonical representation；`reference_only` material 只能引用 owner Section、owner material 或稳定事实 ID，不得复制可变事实、维护独立总计或以视图内容覆盖 owner。每个可变事实只能有一个 canonical owner。

这套 material authority mapping 是封闭且精确的，不支持别名、fallback 或并行旧 material：GDD 的 `core-loop-diagram`、`game-state-flow` 为 `reference_only`；Level 的 `world-structure-diagram`、`route-choice-diagram`、`pacing-beat-table` 为 `owner`，`scene-transition-diagram` 为 `reference_only`；Balance 仅保留 `variable-parameter-table` 作为 owner；Technical 的 `save-recovery-table` 为 `owner`，`architecture-diagram`、`data-flow-diagram`、`runtime-lifecycle-diagram` 为 `reference_only`；Art 的 `visual-language-board` 与 `animation-vfx-state-table` 均为 `owner`；UI 的 `information-architecture-diagram`、`player-flow-diagram`、`screen-state-table`、`wireframe-board`、`focus-accessibility-matrix` 均为 `owner`；Audio 的 `event-cue-matrix`、`music-state-diagram`、`bus-ducking-diagram`、`loudness-delivery-table` 为 `owner`，`sound-reference-register` 为 `reference_only`；Asset 的 `asset-inventory-table`、`responsibility-matrix`、`dependency-integration-diagram`、`license-register`、`milestone-maturity-table` **全部为 `owner`**，分别拥有以 inventory ID 为键的资源库存、责任、依赖/集成、许可证据和里程碑事实。Asset adjacent materials 不是全部 reference-only；每个 Asset material 都拥有自己 distinct 的 row/mapping/evidence fact type，并按 inventory ID 互相引用。

Balance 的 owner 分界不可推断：`variable-parameter-table` 是全部数值型 `var.*` 与 `param.*` ID、单位、值和范围的唯一 owner；`Units, Variables and Conventions` 与 `Entity and Ability Parameters` Section 只拥有语义、身份和关系，不得复制数值定义。Fact Store 的 `balance.variable_ids` owner identity 同步绑定 `material.variable-parameter-table`。

跨材料稳定 ID 只有一种语法：lower-case ASCII dotted namespace（例如 `param.gen.fuel_consumption`）。中文只能作为 label，禁止 CJK ID、`<placeholder>`、alias、fallback 或兼容 ID；Production Materials 引用的每个 ID 必须先在其声明的 owner source 中精确定义。Balance 的公式 ID 只在 `formulas` Section 定义，其他 Section 只引用该 ID；Balance 不再生成或校验任何 reference-only material 投影。canonical material 引用只使用 `material.<materialId>`（例如 `material.variable-parameter-table`），不得使用 raw material ID 或显示标题作为并行 authority。

单一 fact owner 同样适用于同一文档内部：可变波次、金额、比例、时长、数量、尺寸和阈值只能在一个 owner Section 中定义。其他 Section 需要该事实时引用稳定 owner Section/决策标识，不得再次保存同一 literal；正文不得在表格之外重新叙述表内同一组事实。Stage 3 只能在 normalized Fact、owner Section 与派生 block 能明确证明重复时发布 Issue，禁止用词频或裸数字频率推断业务重复。

authoring contract 只把实际存在且已提交的 upstream path 当作可用 authority；path 存在时必须直接使用，不能保留“upstream unavailable”分支。只有 contract 明确没有可用 path 时，才能在既有 dependency/risk Section 中记录未决上游决定；不得因此创建第二条文档轨道。

Canonical Foundation 文档路径只使用服务端 `CANONICAL_FOUNDATION_DOCUMENTS`：`docs/GDD.md`、`docs/LEVEL_SCENE_DESIGN.md`、`docs/BALANCE_DESIGN.md`、`docs/TECHNICAL_DESIGN.md`、`docs/ART_DIRECTION.md`、`docs/UI_UX_SPEC.md`、`docs/AUDIO_DESIGN.md`、`docs/ASSET_PLAN.md`。Markdown 跨文档引用只能使用上述精确路径；机械门同时检查正文和代码围栏中的 `docs/*.md`，非 canonical Foundation 路径一律 fail closed。普通 `assets/` 或其他非 `docs/*.md` 路径不属于这项检查。

八份文档的 content-reduction / ownership rules 固定为：

1. **GDD** 拥有行为、状态和玩法规则；数值细节委托 Balance，交互与布局细节委托 UI，GDD 不建立第二份参数或布局表。
2. **Level** 只拥有空间事实（坐标、拓扑、路径、格位、触发器、场景空间与节奏位置）；经济、运行时、视觉、交互和资源事实委托各自 owner。
3. **Balance** 的 `variable-parameter-table` 唯一拥有全部数值型 `var.*` 与 `param.*` ID、单位、值和范围；`Units, Variables and Conventions` 与 `Entity and Ability Parameters` Section 只拥有语义、身份和关系，Fact Store 的 `balance.variable_ids` owner identity 绑定 `material.variable-parameter-table`；Formula owners 拥有 `f.*`。其他 Section 只引用这些 owner 及其变量、公式、场景和验收 ID，不得复制 owner 数值、结果、总计或完整公式。Balance 不保留 reference-only Production Material 或其专用 gate。
4. **Technical** 只拥有 runtime/data boundaries、持久化与恢复的技术事实；不得重新拥有玩法、内容或资源生产事实。
5. **Art** 拥有一张 compact `visual-language-board` 与 `animation-vfx-state-table` 的视觉/动画验收事实，不拥有资源 ID、数量、source/license、责任或 schedule。Art 只有一个 Visual Language Board，并以 compact Markdown table 作为唯一格式；删除 Art inline SVG 轨，禁止并行 board。UI `wireframe-board` 继续以 inline SVG 拥有响应式几何证据。
6. **UI** 拥有 interaction、input、navigation、screen/state 和 responsive layout mappings；其他文档只引用 UI 的稳定 action、screen、region 与 accessibility ID。
7. **Audio** 拥有 event-to-cue、music state、bus/ducking、loudness/delivery mappings 与验收，不拥有资源生产事实；资源 ID、数量、source/license、责任和 schedule 委托 Asset。
8. **Asset Plan** 单独拥有全部 resource-production facts；五个 Asset owner materials 各自以 inventory ID 键控 distinct inventory/row/mapping/evidence fact types，其他文档和 Audio/Art materials 只能引用这些 ID。

Quality 与 performance 按 correctness、可实现性和 measured comparison 评估，而不是固定 business caps；上述规则不构成 token、字数、时间、heading、table、row、diagram、example 或业务规模的固定上限/目标。八份文档的 contract 各自携带一条 merge/reference rule；每个 material 必须遵循其声明的 `owner`/`reference_only` mode 与 single canonical representation rule；initial 和 parallel-draft author 均以该服务端规则为准。

## 3.1 Fact Store

Fact Store 不是普通摘要，而是可比较、可校验的标准化事实集合。

Fact extraction uses the current versioned closed catalog (`foundation-facts.v2`) as authority: packets carry exact owner Section text and sort document/section/key identities canonically. A fact worker's packet is its sole business input. It returns only business fields (`key`, `status`, typed `value` or `reason`); provenance is service-owned and bound from the immutable packet's catalog owner Section when the durable terminal is constructed. It may receive only language, immutable task/revision/packet identities, the strict output schema, explicit read/write denial, and the packet itself; it must not receive the Confirmed Brief, workspace context, canonical document inventory, or generic project instructions. Brief-derived constraints are projected by local code into catalog keys or immutable digests before dispatch.

Local mechanical extraction runs first. Final publication merges mechanically extracted facts with admitted worker facts and their closed evidence. Present mechanical keys and every admitted worker result (including absent or uncertain outcomes) must account for the catalog exactly once; the published Fact Store contains present facts only, while absent/uncertain results remain durable audit evidence and drive deterministic or semantic issues instead of blocking derived publication. Resolved mechanical facts must not be discarded merely because no worker returned them.

> {  
> "players.max": 4,  
> "boss.count": 3,  
> "mechanics": \["move", "attack", "dash"\],  
> "resources": \["露珠", "月光值"\],
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
| 引用对象存在性 | Rule         | Level 引用 Boss_A，但 Asset 中不存在 |
| 描述是否模糊   | LLM          | “适量敌人”“合适速度”                 |
| 玩法是否合理   | LLM          | 机制是否导致无解或无意义             |
| 技术可实现性   | LLM / Rule   | 平台能力边界、交互复杂度             |

# 6. 跨文档审计：从“文档对文档”升级为“Fact 对 Fact”

避免反复读取两份完整文档，改为定义具体 Contract：

规范：跨文档事实比较必须共享同一语义身份命名空间；映射/别名不能代替修改被提取的权威值。

> GDD.player_actions ↔ Technical.supported_actions
> GDD.boss.count ↔ AssetPlan.boss.count  
> GDD.resources ↔ UI.displayed_resources  
> Level.required_assets ← AssetPlan.covered_level_requirements
> Art.style_constraints ↔ AssetPlan.asset_constraint_refs（语义覆盖）
> Technical.performance ↔ Level.production_acceptance（语义可行性）

关卡资产需求与物理资产库存是两层不同事实，不能把自然语言需求和物理 ID 做字面比较。`level.required_assets` 保留 LEVEL
`content_matrix` 的上游需求条目/标签；`asset.inventory_ids` 保留 ASSET_PLAN
`inventory` 中的物理资产 ID（例如 `GC-BOARD`）。AssetPlan 映射表把每个关卡需求条目承载到一个或多个物理资产，并由
`asset.covered_level_requirements` 提取“已由资产承载的关卡需求条目/标签”。唯一的确定性覆盖契约是
`asset.covered_level_requirements -> level.required_assets` 的 `contains-all`，其缺项仍由 ASSET_PLAN#inventory 修复；
`asset.inventory_ids` 只能用于物理库存/交付事实，禁止直接与 `level.required_assets` 比较。

`game.resources` 与 `ui.displayed_resources` 也共享同一组 canonical 短标签：包含 HUD 跟踪的货币与生命池，去掉括号内英文别名和说明后再比较；文档中的具体标签仅是项目自身的 authored values，不构成全局固定枚举。

`technical.target_fps`、`level.complexity_budget` 与 `asset.art_constraint_refs` 是保留在 normalized Fact Store 中的 deferred semantic facts：缺失或 `uncertain` 时不先生成 schema BLOCKER，也不把多维 `LEVEL#production_acceptance` 预算强行压成单一整数；若事实已存在，仍执行闭 catalog 的类型/取值校验。语义 packet 必须同时携带其 owner Section：性能检查携带 `LEVEL#production_acceptance`，资产检查携带 `ART#visual_pillars` 与 `ASSET#dependencies`，由模型判断预算可行性和引用/约束覆盖。`asset.art_constraint_refs` 是 ART 约束的引用身份层，禁止与 `art.style_constraints` 的约束值做 deterministic 字面 `contains-all` 比较。

能通过 Fact 直接判定的冲突不调用 LLM；只有语义层面的冲突才进入 Semantic
Audit。

## 6.1 定向语义检查清单

Semantic Audit 不做全文自由扫描，也不按“8 份文档各读一次”运行。首版只运行下列 10 个无法由 Schema / Rule / Contract 直接判定的高风险游戏核心检查；数量来自十个互不重复的风险域，不使用无来源的固定边数。

| Check ID | 精确 Section 输入 | 相关 Facts | 判断目标 | 等级 / 模型 |
|---|---|---|---|---|
| `SEM.gameplay_level_viability` | `GDD#core_loop` + `LEVEL#pacing_beats` | `game.mechanics`, `level.required_entities` | 核心循环、遭遇、节奏与反制是否可玩且不互相否定 | HIGH / balanced |
| `SEM.progression_balance_coherence` | `GDD#progression` + `LEVEL#content_matrix` + `BALANCE#executive_summary,units_variables,entity_parameters,formulas,economy,progression_curves,challenge_model,rewards_value,bounds_exploits,tuning_validation` + `BALANCE#material.variable-parameter-table` | `game.resources`, `balance.variable_ids` | 逐波数量→公式→经济→摘要/owner table可重算且进度、资源流与成长曲线一致 | HIGH / balanced |
| `SEM.state_runtime_recovery` | `GDD#states_flow,material.game-state-flow` + `TECHNICAL#runtime_state,save_load` + `UI#screen_inventory,feedback_errors` | `game.states` | 状态、失败恢复、持久化与重开确认在运行时、界面和派生状态流中一致 | HIGH / balanced |
| `SEM.platform_performance_feasibility` | `TECHNICAL#performance,risks,executive_summary` + `LEVEL#production_acceptance` | `game.platform`, `technical.target_fps`, `level.complexity_budget` | 目标平台、关卡复杂度与性能预算现实，且拒绝把已有上游 authority 描述为 unavailable | HIGH / balanced |
| `SEM.interaction_ui_coherence` | `GDD#player_actions` + `UI#input,feedback_errors,experience_architecture,player_journeys,prototype_acceptance` | `game.mechanics`, `ui.supported_actions` | 玩家动作、滚动与交互路径、输入、反馈和错误恢复在架构、流程与验收中连贯 | HIGH / balanced |
| `SEM.camera_visual_readability` | `LEVEL#camera_readability,world_structure,objectives_routes` + `ART#composition_readability,camera_presentation,color_lighting,material.visual-language-board` + `UI#experience_architecture,hud,prototype_acceptance,material.wireframe-board` | `art.style_constraints` | 坐标、路径与格位可计算，viewport、安全区、断点、区域和 overlay 几何在 Level、UI 与 Art 布局之间一致且可读 | MEDIUM / fast |
| `SEM.content_asset_feasibility` | `ART#animation,vfx,asset_specifications` + `ASSET#executive_summary,inventory,dependencies,formats_budgets,validation,material.asset-inventory-table,material.milestone-maturity-table` | `level.required_assets`, `asset.inventory_ids`, `asset.art_constraint_refs`, `asset.formats` | 资产类型与实例、帧数/图元/物理文件和预算总计可重算且与上游一致，拒绝 stale unavailable 假设 | HIGH / balanced |
| `SEM.audio_state_feedback` | `GDD#states_flow` + `AUDIO#event_taxonomy,music,production,executive_summary,material.event-cue-matrix,material.music-state-diagram,material.bus-ducking-diagram` | `game.states`, `audio.event_ids` | PAUSED、失焦、静音及其他关键状态在音频正文、摘要、事件/音乐/总线派生视图中行为一致，拒绝 stale unavailable 上游假设 | MEDIUM / fast |
| `SEM.multimodal_accessibility` | `GDD#accessibility_localization` + `UI#accessibility,material.focus-accessibility-matrix` + `ART#color_lighting,material.visual-language-board` + `AUDIO#ui_feedback` | 无额外 Fact；只使用列出的 Section | 视觉、输入、焦点与非视觉替代在正文及派生可访问性视图中共同满足可访问性 | HIGH / balanced |
| `SEM.completion_recovery_coherence` | `GDD#states_flow,challenge_recovery,material.game-state-flow` + `LEVEL#objectives_routes,spawn_checkpoint` + `UI#player_journeys,screen_inventory,feedback_errors` | `game.states`, `game.win_conditions`, `game.loss_conditions` | 胜负、目标、失败、检查点、重试与重开确认在状态流、玩家旅程、界面状态和反馈中形成闭环 | HIGH / balanced |

Semantic packet discipline is part of this authority: when normalized Facts already project the relevant owner-section information, the packet does not repeat that section merely as duplicate evidence; deferred semantic facts are the explicit exception and always carry their owner Section. Service-marked `Executive Summary` and `Production Materials` entries (`executive_summary` and `material.<materialId>`) are auditable, revisable blocks and may be included only when explicitly listed by a check. The `Production Materials` container heading and the audit appendix are structural metadata, not part of any preceding section. A marked contract block ends at the next Markdown heading of the same or higher level; packets are formed from the exact complete block or explicitly listed check scope. A legal block is never truncated to satisfy an arbitrary business-size limit. The only fixed output boundary is the existing 2 MiB UTF-8 structured-output infrastructure safeguard in §13.

每个 Check 独立按表中精确完整 Section/明确 check scope 形成 packet，只携带相关 normalized Facts 与 deterministic issue 引用；不携带其他文档或截断合法 Section。每个 worker 使用全新、不可累积的上下文，返回 `PASS | ISSUES | UNDECIDABLE`，不生成说明文档。`UNDECIDABLE` 或 BLOCKER 才允许以同一 packet 发起一次 strong confirmation；禁止通过重读全文或扩大上下文解决。业务 packet 不设固定 KiB 上限；结构化输出仅受 §13 现有 2 MiB UTF-8 基础设施边界约束。

# 7. Issue Registry

```json
{
  "id": "AUD-023",
  "severity": "HIGH",
  "type": "contract",
  "source": {
    "documentPath": "docs/GDD.md",
    "sectionId": "rules_systems",
    "heading": "Gameplay Rules and Systems",
    "startLine": 42,
    "endLine": 68,
    "digest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  },
  "target": {
    "documentPath": "docs/ASSET_PLAN.md",
    "sectionId": "inventory",
    "heading": "Asset and Content Inventory",
    "startLine": 30,
    "endLine": 57,
    "digest": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
  },
  "expected": "The Asset Plan inventory declares the same boss count as the GDD.",
  "actual": "The GDD declares 3 bosses, while the Asset Plan inventory declares 2.",
  "remediation": {
    "kind": "patch",
    "documentPath": "docs/ASSET_PLAN.md",
    "sectionIds": ["inventory"]
  }
}
```

严重程度：BLOCKER / HIGH / MEDIUM / LOW。Issue Registry 中每个业务问题必须且只能携带 `patch` remediation，指定同一 canonical 文档中的一个或多个完整 Section；所有 severity 均自动进入 stage 4 修订，不得豁免。Reviewer 必须依据 Source of Truth 顺序、明确硬约束与最小改动原则，直接确定能使 `expected` 成立的最佳单文档 Patch；不得暂停等待外部裁决、不得生成分支路径，也不得保留第二种 remediation 或 `fixDocument` / `fixSectionId` 兼容字段。

`patch` 只在其 `expected` 能由指定 Section 独立实现、且不需要下游重新解释或覆盖上游 Source of Truth 时允许入场。多个目标 Section 必须属于同一文档；跨文档冲突必须拆成各自拥有单文档修复 authority 的独立 Issue，分别派发对应文档的 Patch，禁止用一个跨文档修订掩盖 authority 边界。服务必须在 revision dispatch 前完成结构与 authority admission；Reviewer 必须在既定硬约束内收敛到最小改动，不能把业务问题升级为人工等待。

已知 gap-budget 冲突必须按现有玩法的最小权威解释修复：`FIXED_SETTLEMENT_DEW` 表示“一次间隙至少可执行一个有意义动作、但固定结算本身不足以同时补塔与升级”的取舍边界只约束该间隙新发放的固定结算 `S_w`；此前保存的余额与击杀掉落仍是玩家可即时消费或保留的技术奖励，不得被文案假定为强制波内花完。若 GDD 使用“间隙全部可用露珠”等含糊或扩大表述，必须在 GDD progression owner 中澄清；Balance 已明确按 `S_w` 实现时不得生成无进展 Patch。不得为满足该边界发明余额上限、过期、强制消费或双钱包等未获授权的新玩法。

审计问题与运行完整性失败必须分离：业务矛盾、遗漏和新发现的问题进入并发布唯一的 Issue Registry，驱动下一修订轮；缺失或非法 terminal、越权 Section、非法 Patch、receipt 不完整等可由 fresh revision attempt 纠正的提交失败不进入 Registry，也不得进入人工 `needs_action`，必须 fail closed、丢弃该失败 attempt 的 staged bytes 并自动重派同一文档。只有不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 无进展才进入 `needs_action`。短暂的 provider/receipt/callback 失败仍自动重试，不得伪装成业务决策。发现新 Issue 不是拒绝发布本轮 Registry 的理由。

Worker 未调用必需的 durable terminal、在 durable terminal 之前结束、提交非法终态、修改越权 Section 或生成非法 receipt，只表示该 revision task 的本次 attempt 失败；不得伪造 evidence、不得把失败当作业务 PASS/ISSUE，也不得把整个 Foundation run 变成人工 `needs_action`。Revision worker 的唯一合法终态是 `APPLIED(changedSectionIds)`；每次重派前服务必须从本轮 canonical base 重新建立干净 staged document，并把上一失败 attempt 的结构化诊断加入新 dispatch prompt。Revision task 不设固定 attempt 次数上限，必须自动重派直到形成合法 Patch 并通过定向复核；该自动重试不改变 round、base authority、immutable Issue packet 或已冻结的其他文档。除上述 `needs_action` 条件外，短暂的 provider/receipt/callback 失败仍自动重试，不得伪装成业务决策。

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

先按 remediation 的 Doc + Section 聚合全部 `patch` Issue，再一次修复同一文档的问题。Reviewer 发现业务 Issue 后必须进入 stage 4；不同文档的冲突已拆为不同的单文档 batch，不得在此阶段等待人工介入。

> 17 Issues  
> ↓ group by Doc  
> GDD 3 issues → 1 revision call  
> Technical 4 issues → 1 revision call  
> AssetPlan 6 issues → 1 revision call  
> UI 4 issues → 1 revision call

不同文档的修订并行执行，墙钟时间接近最慢的单个修订任务，而不是所有任务耗时相加。

每个 immutable revision packet 必须携带完整 Issue、全部可写目标 Section、为判断冲突所必需的只读 source/target Section 与 Source of Truth 顺序；同一 round 上一失败 attempt 的结构化诊断由服务作为 retry-only dispatch prompt overlay 注入，不得改写 packet 或其 digest。对 Fact / Schema Issue，packet 还必须携带可写 Section 对应的 closed-catalog `factConstraints`，至少绑定 fact key、owner、value type/spec、presence、`extractionInstruction` 与 `sourceOfTruthDirection`；若约束要求显式映射表或其他语义结构，独立事实声明、格式调整或同义改写不算修复。只读证据不扩大写权限。Worker 必须让 `expected` 成立并消除 `actual`；不得用新增别名、兼容说明、风险登记、措辞限定或“读作同一概念”替代修复。未列入 `sectionIds` 的 risk、appendix、consistency 或其他相关 Section 必须保持 byte-identical。Revision worker 只能声明唯一合法终态 `APPLIED(changedSectionIds)`；任何其他输出均是本次 attempt failure evidence，controller 必须自动重派，不能把业务歧义、scope 争议或可恢复提交错误直接转为 `needs_action`。

## 9.1 Patch 格式

> {  
> "doc": "AssetPlan",  
> "section": "Boss Assets",  
> "operation": "replace",  
> "issue_ids": \["AUD-023", "AUD-031"\],  
> "content": "..."  
> }

支持 INSERT / REPLACE / DELETE。禁止默认整篇重写。

修订提交时，文档 frontmatter 的 `version` 与 `updated_at` 是服务所有的元数据：服务以本轮修订前的 canonical 文档为唯一 authority，为本轮计算唯一候选 PATCH 版本并推进候选 `updated_at`，然后从最终 staged bytes 派生验证 digest。候选元数据在 COMMITTED 前不是 canonical authority；失败 attempt 不得改变 canonical 元数据。同一 task/round 的重试或 Submit 重放必须复用同一候选版本与时间，不得再次递增。Worker 不得改变这两个字段；缺失、格式非法、非预期版本或时间未推进都必须 fail closed。

# 10. 修订后验证：验证 Patch，不重新审整份文档

> 修订前：  
> GDD.boss.count = 3  
> AssetPlan.boss.count = 2  
>   
> Patch 后重新提取：  
> AssetPlan.boss.count  
>   
> 验证：  
> AssetPlan.boss.count == GDD.boss.count  
> → PASS

只有 Patch 引入新的语义风险或代码规则无法判定时，才触发 Targeted LLM
Recheck。

Targeted Recheck 只允许返回 `PASS | FAIL`，不得返回 Stage 3 审计使用的 `ISSUES | UNDECIDABLE`、发现新 Issue 或改写原 Issue。其 `FAIL` 必须返回结构化诊断：Patch 后观察到的 `actual`、精确 Section evidence 与稳定 reason code；未满足的原 `expected` 由服务从 admitted Issue 注入，worker 不得回传或改写。诊断只属于 attempt evidence，不得改写 Issue、confirmed brief、canonical 文档或 Source of Truth，也不得替代下一次 Patch。

任何 PatchValidation 为 `FAIL | UNDECIDABLE`、Targeted Recheck 为 `FAIL`，或 revision worker 未返回唯一合法的 `APPLIED(changedSectionIds)` 时，本轮 staged authority 都不得写入 canonical、不得产生 COMMITTED、不得推进正式文档版本或 document revision。controller 在同一 round、同一 base authority 内只自动重派失败文档；已经 PASS 的 staged bytes 必须冻结，后续 attempt 不得无条件重写。每个 PASS validation 必须绑定其全部 source/target dependency digests；任一依赖因其他文档的新 attempt 变化时，该 validation 立即失效并必须针对最终 staged bundle 重跑。重验 PASS 时继续复用冻结 bytes，重验 FAIL 时才解冻该文档并纳入下一次失败文档集合。可恢复的 revision/validation failure、短暂的 provider/receipt/callback 失败不得进入 `needs_action`，仍须自动重试且不得伪装成业务决策；只有不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 无进展时才进入 `needs_action`。

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
| 全文读取   | 禁止；L3 也只能追加明确选中的索引 Section |

必需任务数必须按当前 case 的文档规模、Issue Registry、风险覆盖与确认依赖动态生成，不得预设统一总数上限。由封闭事实目录或本规范明确风险域推导出的固定数量，只表示必须完整覆盖的集合基数，不是复杂度预算，也不得阻止为实际发现追加合法的 deep / confirmation / revision 任务。

预算必须由“必需任务数 × 每任务输入/输出/重试边界”推导，并逐任务记录实际 token、duration 和 failure reason。不得用无法容纳全部必需 packet 的任意全局 token cap，或共享墙钟 deadline，提前终止尚未打开的任务。超时与重试在单任务边界执行；恢复不得重置、绕过或伪造这些边界。

每任务的输出边界由严格结构化 Schema、任务身份/作用域与 provider/native 输出约束定义；重试次数仅可作为 Stage 3 fact、semantic、strong-confirmation 或 provider/native 单次 dispatch 的有界边界，不得把 attempt 次数作为 Stage 4 document-revision、impacted-facts 或 semantic-recheck 的输出或停止边界。不得再用一个固定 token 估算值二次拒绝已经满足业务契约的合法结果。Foundation packet worker 的最终结构化输出仅在进入服务的基础设施边界执行 2 MiB UTF-8 JSON 上限，防止异常 payload 造成资源耗尽；该上限不是审计质量、Issue 数量或业务复杂度预算，超限必须明确归类为基础设施失败。

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
- 原生 revision worker 每个 dispatch 使用唯一空 sandbox cwd；真实 project workspace 只能通过 service 注入的受信环境变量供 revision tool 使用。Read/Edit 必须在 tool input validation 层精确拒绝 canonical、其他 staged path、workspace 外路径和 symlink，即使全局 permission rule 会自动 allow；普通非 revision worker 的工具行为不变。
- 原生 revision worker 的工具面只能包含 `Read`、`Edit` 和 `SubmitFoundationRevisionResult`；不得暴露 Bash、Grep、Glob 或任何其他文件访问/旁路工具。该白名单与 Read/Edit 的输入层拒绝共同构成唯一 revision 文件访问边界。

- 唯一持久化字段是 `foundationAuditState`：audit 与 revision 通过该状态内互斥的 substage/status 和同一 `tasks[]` 表达。禁止保留 `foundationRevisionState`、别名、双读/双写、旧 schema reader、迁移器或 fallback；携带旧顶层字段的 durable run 必须由 strict schema fail closed，而不是被静默接纳。

- Review copy 初始化直接进入唯一可运行的 `FOUNDATION_REVIEW` 状态并由同一 controller 启动；不得先持久化虚假 `needs_action`/`implementation unavailable` 再由另一入口覆盖。

- Stage 2 Foundation document-author 只有一个 author dispatch 轨道。native provider 在同一 turn 内缺失可见 Markdown 或结构未闭合时，transport 可在同一 session、同一 dispatch 内续写或从头返回；一旦该 author dispatch 已形成 terminal，任何机械/结构/authority 校验失败、非法 terminal、receipt/callback 失败或会话中断都必须保留诊断、使该文档和 run fail closed 到 `needs_action`，不得把文档重置为 `pending`、不得自动创建 fresh author dispatch，也不得把旧失败理由作为新 author prompt overlay。Strict complete-document validation 不得放宽；失败的 staged/pending bytes 不得提交 canonical。人工或外部恢复只能显式恢复同一个 canonical task，不得创建第二状态机、兼容轨或并行候选文档。

- Dashboard 只投影普通任务状态、轮次、Issue 数量/严重程度摘要、按任务聚合的 compact task telemetry（usage/duration）与 safe projected failure reason；它不是审计或修订 authority，也不展示 raw Registry JSON、`problem`/`actual`/`evidence`、worker prose/thinking 或 worker feedback。Foundation review 期间的 worker message 只保留在运行日志与 durable evidence 中，不进入阶段卡片。
- 阶段显示必须将 Foundation 审计与修订分开：审计固定为显示 stage 3，修订固定为显示 stage 4。stage 4 是仅用于显示的虚拟 identity，底层仍只有 `DOCUMENT_REVIEW` 与唯一持久化 `foundationAuditState`；冻结的审计卡必须保留 stage 3，进入修订时生成 stage 4 live card，checklist drafting 不得回退到 stage 3。
- 所有业务 Issue（包括首次审计发现的 Issue）在 Registry 发布后均直接进入 stage 4；不存在因业务歧义、范围争议、跨文档冲突或 revision attempt 失败停留在 stage 3/4 的 `needs_action` 分支。stage 4 只有在不可恢复的 authority/integrity 冲突、当前进程无法自行恢复的外部执行前置条件缺失（例如必需模型配置、凭据或 credits 不可用）、strong confirmation 仍为 `UNDECIDABLE` 或 authority 无进展时才可显示 `needs_action`；短暂的 provider/receipt/callback 失败仍自动重试，不得伪装成业务决策。

- 所有终态任务都保留 usage、duration 与 failure reason，确保成本和失败可按任务追溯。

**推荐生产架构：Fact Store + Rule Engine + Contract Validator + LLM
Semantic Auditor + Incremental Patch**
