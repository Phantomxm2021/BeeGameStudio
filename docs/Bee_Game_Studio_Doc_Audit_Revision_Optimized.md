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

# 3. 文档生成时同步产出机器可读信息

每份 Markdown 文档生成时，同时产出：

> document.md  
> document.fact.json  
> document.index.json

## 3.1 Fact Store

Fact Store 不是普通摘要，而是可比较、可校验的标准化事实集合。

> {  
> "players.max": 4,  
> "boss.count": 3,  
> "mechanics": \["move", "attack", "dash"\],  
> "resources": \["hp", "energy"\],  
> "platform": "quest",  
> "target_fps": 72  
> }

## 3.2 Section Index

记录关键主题所在章节，发现问题时直接读取目标区域，避免重新扫描全文。

> {  
> "combat": "L120-L185",  
> "boss": "L220-L270",  
> "progression": "L300-L350"  
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

> GDD.core_actions ↔ Technical.supported_actions  
> GDD.boss.count ↔ AssetPlan.boss.count  
> GDD.resources ↔ UI.displayed_resources  
> Level.required_assets ↔ AssetPlan.assets  
> Art.style_constraints ↔ AssetPlan.asset_style  
> Technical.performance ↔ Level.complexity_budget

能通过 Fact 直接判定的冲突不调用 LLM；只有语义层面的冲突才进入 Semantic
Audit。

# 7. Issue Registry

> {  
> "id": "AUD-023",  
> "severity": "high",  
> "type": "cross_doc_conflict",  
> "source_doc": "GDD",  
> "target_doc": "AssetPlan",  
> "source_fact": "boss.count",  
> "expected": 3,  
> "actual": 2,  
> "fix_doc": "AssetPlan",  
> "fix_section": "Boss Assets"  
> }

严重程度：BLOCKER / HIGH / MEDIUM / LOW。默认自动处理
BLOCKER、HIGH、MEDIUM；LOW 可记录为 Known Issues。

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

先按 Doc + Section 聚合 Issue，再一次修复同一文档的问题。

> 17 Issues  
> ↓ group by Doc  
> GDD 3 issues → 1 revision call  
> Technical 4 issues → 1 revision call  
> AssetPlan 6 issues → 1 revision call  
> UI 4 issues → 1 revision call

不同文档的修订并行执行，墙钟时间接近最慢的单个修订任务，而不是所有任务耗时相加。

## 9.1 Patch 格式

> {  
> "doc": "AssetPlan",  
> "section": "Boss Assets",  
> "operation": "replace",  
> "issue_ids": \["AUD-023", "AUD-031"\],  
> "content": "..."  
> }

支持 INSERT / REPLACE / DELETE。禁止默认整篇重写。

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
| LLM 输入   | 只传 Issue + 目标 Section + 必要 Facts   |
| LLM 输出   | 强制 JSON / Patch，不允许长篇解释        |
| Issue 处理 | 优先 BLOCKER/HIGH/MEDIUM                 |
| 修订调用   | 同文档合并，一文档尽量一次               |
| 并行度     | 单文档语义审计、不同文档修订可并行       |
| 复审       | 优先 Patch Validation，不做全文 Re-Audit |
| 最大循环   | 2–3 轮                                   |
| 全文读取   | 仅 L3 Deep Audit 允许                    |

# 14. 停止条件

> Round 1: 修 BLOCKER + HIGH + MEDIUM  
> Round 2: 修新增 BLOCKER + HIGH  
> Round 3: 仅修 BLOCKER  
>   
> 无 BLOCKER → PASS  
> 剩余 MEDIUM / LOW → Known Issues

# 15. 最终生产 Pipeline

> Idea  
> ↓  
> 3 Briefs  
> ↓  
> 用户选择 + 配置  
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

**推荐生产架构：Fact Store + Rule Engine + Contract Validator + LLM
Semantic Auditor + Incremental Patch**
