# Foundation 八文档质量与冗余审计（2026-08-27）

## 审计对象与边界

本审计以已暂停的 `moonlight-mushroom-defense--342847bf77b8` 八份 canonical Foundation 文档为失败样本，只读分析生成结果、审计产物和运行日志。该项目不得恢复、发布或被手工改成“通过案例”；修复必须落到通用生成、审计与修订契约，再由全新项目从零验收。

八份正文合计约 530,849 UTF-8 bytes。Executive Summary 约 17,324 bytes，Production Materials 约 118,467 bytes，两者合计约占 25.6%。Materials 在 ART、UI、AUDIO、ASSET 中分别约占 38.3%、33.7%、27.3%、21.2%。四份文档内共出现约 291 行内嵌 SVG 元素。不存在值得依赖的长行逐字重复；主要冗余是同一事实的改写、重算和图形化复制。

## 结论

文档的主要问题不是缺少篇幅，而是把“权威决定、计算过程、验收证据和展示视图”混成多个可变事实源：

1. 同一数字被 Summary、正文、Materials 和下游文档分别维护，导致旧值残留。
2. 许多表格声称已经验证，但缺少可机器复算的输入、公式、单位、取整和结果绑定。
3. 下游文档在上游已存在时仍保留 `unavailable` 假设，暴露生成拓扑并形成第二条事实轨道。
4. UI/Level/Art 对布局只给视觉描述，缺少 viewport、safe-area、breakpoint、区域最小尺寸、压缩顺序、坐标系和互斥规则，无法据此实现或验收。
5. Materials 中的大型 SVG 经常重复正文数值和结构；它们显著增加输出量，却没有稳定 owner 引用，既拖慢生成，也扩大修订面。
6. Reviewer 能发现局部冲突，但过去不能寻址 Summary/Materials，因此修订正文后派生视图继续保留旧值，造成多轮循环和“只换说法”。

这不是需要增加第二套 reviewer 的问题。正确方向是保留一条确定性审计 + 十个定向语义风险域 + Issue Registry + Issue-bound revision 的闭环，并修正其输入权威和可写块。

## 代表性证据

### 数值与可复算性

- BALANCE 同时维护总收入 `2678` 与逐波结果 `2843`，且用错误解释掩盖差额；敌人类型汇总与逐波表也出现 `168/188`、`55/61` 等冲突。
- LEVEL 的类型汇总与逐波数量不一致，准备段时长把并非下界的 `15s` 当作全部 20 波下界。
- ASSET 的 `147`、`98`、内容数据 `8/13`、atlas `68/62`、FX `34/28` 等总数无法由唯一 owner 表重算。
- ART 的明度边界、帧数、粒子预算与其他表或下游文档不一致。

这些问题不能靠“语言更清晰”修复。所有总计必须来自唯一 owner 的明细；若保留总计，必须能由同一块内的确定性输入和规则重算。Summary/Materials 只能引用 owner 或展示派生结果，不得另存可变总数。

### UI、场景与视觉布局

- UI、Level、Art 对暂停 overlay、滚动、文字缩放、状态图标数量和焦点路径存在不同规则。
- UI 缺少完整的最小 viewport、safe area、breakpoint、区域最小尺寸、区域压缩优先级和命中区证据。
- LEVEL 的路径节点、格中心、母株、终点触发和离屏生成点没有统一坐标语义；路径宽度、mask、格位与路径互斥缺少可计算定义。
- Art/UI 的大型 inline SVG 重复呈现正文尺寸和布局，但未证明其为唯一验收证据。

布局类文档必须先定义坐标空间和约束，再提供视图。只保留能承载独有验收信息的 wireframe/board；装饰性或重复正文数据的 SVG 应删除。

### 状态、交互与音频

- `restart_campaign` 在 GDD 正文要求 PAUSED/VICTORY/DEFEAT 均确认，但派生 state-flow 和 UI 输入表遗漏部分状态。
- AUDIO 对手动暂停、失焦自动暂停、静音、低通与 master fade-to-silence 的关系不一致。
- AUDIO/ASSET/Technical 在上游文档已存在时仍出现“未提供/unavailable”描述。

状态行为必须由 GDD owner 定义，Technical/UI/Audio 只实现或映射该状态；派生状态图必须与 owner 同属于可审计、可修订块。

## 根因

1. 作者契约过去要求“完整、丰富”，却没有强制唯一事实 owner 和派生视图边界。
2. Summary 和 Materials 过去不在 canonical block index 中，Reviewer 看不到或 Reviser 改不到。
3. 语义检查只覆盖少数正文 Section，遗漏布局几何、派生视图、资产总计和 stale upstream 假设。
4. 模型输入包含服务校验元数据，并要求模型输出服务拥有的常量，增加 token 和结构化输出失败概率。
5. 旧文档输出量过大。生成速度下降首先来自完整 Markdown 与 SVG 的 completion 体积，其次才是 prompt 文字；仅做 prompt 去重不能恢复速度。

## 通用修正方案

### 1. 单一事实所有权

- GDD：玩家动作、核心循环、规则、状态与结果。
- BALANCE：单位、基础值、公式、取整、边界和调优证据。
- LEVEL：拓扑、坐标、路径、格位、节奏和场景验收。
- Technical：运行时、数据、性能和平台边界。
- Art/UI/Audio：各自表现与交互映射，不重定义上游规则。
- Asset Plan：资源责任、来源、许可、依赖和里程碑，不重算内容设计事实。

每个可变事实只允许一个 canonical owner。下游使用稳定引用；不得用别名、兼容说明或“理解为相同”保留冲突值。

### 2. Summary 与 Materials 降级为派生块

- Executive Summary 是 authority index，只列决定与稳定 Section/Material 引用。
- 每个 Production Material 使用 `material.<materialId>` 稳定 ID，显式引用 owner。
- 派生块可被 reviewer 审计，也可在 Issue 精确授权时被 revision 修改。
- Materials 容器标题和 audit appendix 不是前一 Section 的一部分，也不是隐式写权限。
- 派生块不得维护独立可变总数；大型 SVG 仅在承载不可替代的布局/视觉验收证据时保留。

### 3. 保持单轨审修闭环

只保留：确定性 Fact/Schema/Rule/Contract → 十个定向 Semantic checks → 单一 Issue Registry → Stage 4 Issue-bound revision → 重新派生并审计，直到 Issue Registry 为空。不得增加全文扫描、每文档 reviewer、兼容 reviewer 或人工选择步骤。

十域需要覆盖：可重算 Balance 链、状态/重开、UI 交互、布局/坐标、资产类型与实例、音频状态、可访问性、平台性能、玩法可行性和完成/恢复。新增的是既有 check 的精确 block scope，不是新轨道。

### 4. 最小模型投影

durable packet 继续保留 digest、行号、字节数和完整性绑定；model-facing projection 只发送：block identity、完整 block text、相关 normalized Facts、确定性 Issue 引用和必要 patch authority。服务拥有的 `scopeAssessment` 不由模型填写，由 admission 后注入 durable terminal evidence。

### 5. 速度优化必须从输出结构下手

不设置业务 token、时间、轮次或 Issue 数上限。通过删除重复事实、压缩派生视图、移除装饰性 SVG 和缩小模型投影来减少实际工作量。复杂案例仍可使用所需上下文；不得用固定上限制造截断、双轨或人工介入。

## 验收门槛

全新项目从零验收必须同时满足：

1. 八份文档均完成，YAML `version` 随实际修订更新。
2. UI 显示 Review 为 Stage 3、Revision 为 Stage 4。
3. Reviewer→Revision 自动循环，Issue Registry 最终为空；过程中没有业务 token/time/round/Issue cap。
4. Summary/Materials 中不存在与 owner 不一致的可变事实或独立总计。
5. Balance、Asset 等总数能由列出的输入、单位、公式和取整规则复算。
6. UI/Level/Art 布局具备可实施的坐标、viewport、safe-area、breakpoint、区域/命中区约束。
7. 不存在已提交上游被描述为 unavailable 的旧分支。
8. 日志中没有因模型填写服务常量、旧 schema、兼容 fallback 或 stale worker 恢复形成的重复派发。
9. 完整自动测试、typecheck、diff-check 通过，再进行 Chrome 可见验收。
