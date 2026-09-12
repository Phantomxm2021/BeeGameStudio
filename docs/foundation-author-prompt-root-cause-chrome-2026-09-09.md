# Author 提示词冲突根因修复与新项目 Chrome 验收

## 根因

上一轮 `fixed-point-three-wave-defense--92826cf10841` 的 UI 输出在 `executiveSummary` 开头重复了服务端拥有的 `## Executive Summary`，严格装配器因此拒收。

进一步检查真实派发使用的提示词构造路径发现：`foundation-author-body.v2` 虽要求一个 JSON 对象，却无条件拼接旧版 `FOUNDATION_AUTHORING_INSTRUCTION`（要求完整 raw Markdown、保留全部标题、Return Markdown / without JSON output），并继续投影 `mechanicalMarkdownProtocol`（含摘要的 H2 标题）。一句覆盖声明没有消除同一提示词中的相反要求。这是可验证的协议指令冲突；无法证明模型内部因果，但不能把失败仅归咎于模型偶发不服从。

## 修复边界

- 抽出与格式无关的内容要求：文档所有权、必要参数、单一事实来源、验收证据及 N/A 等要求不变。
- v2 只使用结构化 JSON 输出协议，保留 section/material ID、用途、序列化及交付契约；不再要求生成完整 Markdown 标题或投影旧版标题协议。
- 旧 Markdown 模式继续使用原有标题协议。
- 不宽松化装配、不删改模型输出、不修改上一轮项目；仍拒绝重复摘要标题、未知／缺失／重复块。
- 本次未改变生命周期统一错误展示；它是诊断可见性不足，而非此次输出冲突的修复点。

## 离线验证

- Author private 全套：140 pass，0 fail，3,727 assertions。
- 新增覆盖全部八文档 × initial/parallel-draft 的协议隔离测试；验证用途、输出策略、ID、序列化与共享契约保持完整且不被修改。
- 增加上一轮 UI 摘要标题拒收形态的回归，确保没有静默归一化绕过校验。
- agent-workflow-server TypeScript `tsc --noEmit` 通过。

## 新项目真实验收

修复后正常重启本地运行时（PID 86725，62174；前端及计费服务未重启）。旧项目 26 个本地 workflow 均无运行任务；两个保留 activeDispatch 的旧项目状态为 stopped，dispatch 为 interrupted。

Chrome 已用相同原始需求生成新方案，选择“固定路线三波防守模式”、Web / React / 2D / 策略 / 极简 / 键鼠、资源库按需使用。补充说明限定 Foundation Author、Reviewer、Revision 与最终全量审查，不进入 Checklist、IR、实现或发布。

点击“开始构建”后，页面显示 **Project quota exceeded**，项目创建被拦截，未启动新项目 Foundation。后端 `assertProjectQuotaAllowsUpsert` 在项目总数达到配置上限时拒绝新的项目 ID；代码默认上限 100，本地 workflow 文件夹数量不能当作账号项目总数。没有抓取到本次响应中的实际 limit/projectCount，不推测精确占用。

没有删除旧项目、没有修改配额、没有改用旧项目重试。当前结论：根因修复与离线验证完成；新项目真实验收受项目配额阻塞，尚未完成。需用户释放项目名额或明确授权调整本地验收配额后继续。
