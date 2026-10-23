# Foundation 新版契约：Chrome 真实验收

## 范围与前置条件

- 用户授权开始新项目真实验收；只完成 Foundation 八文档生成、Reviewer、Revision 私有候选及最终全量审查，不进入 Checklist、Game IR、实现或发布。
- 2026-09-09 12:54（UTC+8）预检 25 个旧项目，未发现运行中的交付任务。确认后将 62174 端口的旧运行时 75386 正常终止，使用已通过离线测试的新源码启动运行时 85639；前端 62173 和计费服务保留。
- 本轮通过 Chrome 页面新建项目，使用与上一轮相同的塔防原始需求，选择“固定点三波防守模式”、Web／React／2D／策略／极简／键鼠，资源库“按需使用”。补充说明明确仅验收 Foundation、三波全灭胜利条件、战斗中建塔、统一几何／数值及无外部素材。
- 这是相同案例的新生成，不是复用旧文档或字节完全相同的 confirmed brief。验收期间不手工修正文档，也不修改生成／审查源码来改变正在运行的结果。

## 本轮身份

- 项目：`fixed-point-three-wave-defense--92826cf10841`
- projectId：`project_1788929766670_bdztv3`
- runId：`38af40d8-34b7-4abb-a65f-cdfc02339072`
- Author handle：`43e14634-62bf-40c1-bb1d-54d4c6392d56`
- 创建：2026-09-09 04:56:08 UTC（12:56:08 UTC+8）
- 项目目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/fixed-point-three-wave-defense--92826cf10841`

## 运行记录

- GDD：以 `foundation-author-body.v2` 派发，04:58:38 UTC 成功提交，无结构重试；14,714 tokens。
- Level：05:02:00 UTC 成功提交，无结构重试；21,428 tokens。之后 Balance 与 UI 并行派发。
- Balance：成功提交；21,446 tokens。
- UI：真实模型输出完成，但服务端结构装配拒收；22,948 tokens。Technical、Art、Audio、Asset 尚未派发。
- 05:05:23 UTC（13:05:23 UTC+8），流程自动进入 `needs_action`／`DOCUMENT_DRAFTING`。Chrome 显示“基础文档编写／需要处理／编写失败”，提供“重试”按钮。本轮未点击重试，未手动停止模型，未修改源码或项目文档。
- Author 四次调用合计 **80,536 tokens**（含缓存读取 token），不是金额；不含前置方案生成的用量。三份文档已在 Author 工作区提交，但完整八文档结果尚未发布，Chrome 仍显示 0/8，不能解释为八份产物已验收。

## 阻塞原因与只读复现

UI 派发 ID：`17d734cd-7884-4f1f-b523-06c082eb94dd`。

其待提交内容是合法 JSON，version 为 `foundation-author-body.v2`，10 个 section ID 与 5 个 material ID 均齐全。唯一被结构装配器拒绝的内容是 executiveSummary 字段开头：

```text
## Executive Summary

```

新版契约要求该字段只含正文，标题由服务端装配，因此 `foundation-authoring-assembly.ts` 抛出 `Author block cannot supply service-owned headings or frontmatter`。`lifecycle.ts` 将该异常统一转换为泛化的生成／提交失败，页面没有获得具体字段和原因。

只读复现使用本次真实待提交字节调用当前装配函数，得到同一异常。随后仅在内存副本中去掉这一个精确的重复标题，装配成功（24,561 字节）；没有写回待提交内容、没有修改正式文档、没有把诊断副本冒充验收产物。说明这是摘要字段边界与恢复能力问题，不是整份 JSON 损坏、缺失章节或材料 ID 错误。

建议下一步修复 Author 的字段级结构错误反馈，并明确是否允许对这种精确重复的服务标题作确定性处理；仍须拒绝未知标题和越界块。修复后需用本次真实输出增加回归，并由用户确认后继续真实验收。本轮不绕过校验直接接受文档。

## 初稿内容观察（不是最终审查结果）

- GDD 已保留全部固定标题、两张流程图、ASCII 动作／状态 ID。第三波漏怪但基地生命仍大于零时的终局闭合需要 Reviewer 判断。
- Level 波次表含 `E_RUNER_RENAME` 零数量占位行，再用正文声明作废；这可能污染实体事实，应由审查与修订消除含糊来源。
- Level 各波合计为 8 + 14 + 20 = 42 个敌人，生产预算却写 46；波次推进还分别使用“最后生成的敌人离场”和“所有敌人离场”两种表述。
- 上述只是已读初稿的明确检查点。本轮尚未运行 Reviewer，不能声称系统已发现或修复这些内容问题。

## 当前结论

**真实验收未通过，停在 Author 阶段。**

已验证三份结构化输出能够提交，也真实暴露了第四份输出的摘要标题拒收与泛化反馈问题。Reviewer v2、Revision、新版 Audio 依赖／能力证据、最终全量审查均未在本轮走到，不得用此前离线测试代替这些尚未完成的真实验收。
