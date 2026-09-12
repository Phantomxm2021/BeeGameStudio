# Author 输出协议冲突修复：新项目 Chrome 验收

## 前置结果

此前根因修复已通过 Author 140 项回归及类型检查。另完成项目配额错误的十语言提示，以及仅开发测试且显式启用的批量清理 API。经用户确认永久删除旧 100 个项目（UI 12 + API 88，API 失败 0）；重新打开历史项目确认为 0。清理开关随后关闭，正常运行时 PID 88447（62174），前端与计费服务未重启。

## 新项目身份

- 项目目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/fixed-budget-tower-defense--561662e1fd6a`
- projectId：`project_1788933115958_cuvmur`
- runId：`a1e928e5-0cf9-4753-bd78-f74632697429`
- Author handle：`966b8509-5a9f-482e-8664-c3f4631b547f`
- 创建时间：2026-09-09 05:51:57 UTC（13:51:57 UTC+8）
- Chrome：使用相同原始塔防需求，选择“预算防线模式”；Web / React / 2D / 策略 / 极简 / 键鼠，资源库按需使用。补充说明明确战斗中建塔、严格第三波全灭且基地存活、唯一几何／数值、无外部素材，以及仅 Foundation 不进入 Checklist / IR / 实现 / 发布。
- 本轮是新项目新生成，不复用旧项目产物。运行中不手工修正文档或修改生成／审查逻辑。

## 运行结果

**未通过。** 05:54:52 UTC（13:54:52 UTC+8）自动进入 `needs_action / DOCUMENT_DRAFTING`，Chrome 显示 Foundation 编写失败，耗时约 2 分 55 秒。尚无文档提交，Reviewer、Revision、最终审查均未开始；未点击重试。

GDD dispatch：`91ae7dca-8c25-4f0e-8dfb-007788ed32f0`，使用 `foundation-author-body.v2`。待提交内容 19,572 字节；实际 Author 用量 14,491 tokens（6,164 输入 + 5,455 输出 + 2,872 缓存读取），不是金额，不含前置方案生成。

## 只读诊断

1. 原始内容不是合法 JSON。解析在字符位置 4831 失败：`Expected ':' after property name`。states_flow 的 body 后出现了错误片段 `,"progression","### 局内推进","}`，随后才是正常 progression 对象。
2. 仅在内存副本中将上述唯一错误片段替换为对象闭合符后，JSON 可以解析，但服务端装配仍拒绝 `incomplete Author block set`。对比 canonical ID 集合，全部必要章节和材料都在，另多出不允许的 `scope` 章节。
3. 原始 executiveSummary 还以 `# 权威索引` 开头，不符合内容块禁止文档级／H2 标题的边界。
4. 用该次持久化 request 构造当前提示词，确认 `raw Markdown`、`Return Markdown`、`mechanicalMarkdownProtocol` 均不再存在。旧协议冲突确已移除，但这不能保证真实模型完全遵循 JSON 语法、封闭 ID 和内容边界。

没有修改待提交字节、正式产物或运行中的源码，没有将诊断副本提交为产物，也没有自动进行付费重试。本轮暴露的是 Author 结构化输出可靠性仍不足；不得把项目清理成功或离线回归通过当成 Foundation 验收通过。
