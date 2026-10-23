# Revision 有界失败诊断与 Chrome 重试

日期：2026-09-07。

## 实现边界

- Revision private execution journal 的 retryable settlement 可记录 `{ stage, reasonCode }`。两者均为封闭枚举，序列化上限 256 字节。
- 仅识别原生错误白名单和校验错误固定类别；未知值回落 unknown。不保存原始 message、stack、cause、stderr、Markdown、路径或环境值。
- 防护非 Error 抛出值、getter、Proxy 和原型属性；诊断阶段必须与 failureCode 一致。
- stopped/completed 不携带诊断；stop 竞态胜出时 effective settlement 移除诊断，原始已提交失败事件仍可重放审计。
- 不改变重试、停止、原生进程闭合判定、公开输入或计费策略。测试验证 usage 和计费幂等键不变，receipt digest 正常绑定新增诊断。

## 离线验证

- Revision 完整测试：217 pass，0 fail，1550 assertions。
- 三模块接线与集成：17 pass，0 fail，119 assertions。
- 后补 stop/replay/计费幂等测试所在文件：9 pass，0 fail，76 assertions。
- TypeScript 类型检查通过。
- 摘要交接修复后的 Reviewer 全套：337 项中 332 项在沙箱内通过，5 项因 macOS 进程身份读取权限失败；该进程身份文件以获准权限独立重跑 6 项全部通过（包含原先已通过的 1 项）。不能将第一次运行记为全绿。
- 摘要交接修复后的公开 Author → Reviewer → Revision 集成及 authoring 接线：4 pass，0 fail，220 assertions；相关 16 项定向回归及最终类型检查通过。

## 真实重试与交接修复

只通过 Chrome 正常 UI 重试副本 `review-copy--61585ea1-c99b-45be-8b06-c54a12b1388b`；run `38b447ab-2a20-4a06-978c-4d4d9bf7cf6f`。未手工编辑真实项目文档或产物。

1. 前置 Revision 成功修复原有格式残片，使新 Reviewer 能运行语义检查。
2. 新 Reviewer 实际检出 Level 的 14 条语义问题；该轮公开结果共 31 条问题。原先遗漏的整篇 Level 残留冲突不再被其他正确章节抵消。
3. 后续 Revision 完成候选修订，Level 改为单屏二维接取玩法。但生成候选不等于复核通过，也不等于已发布规范文档。
4. 跨模块交接发现遗漏：impact 校验仅接受正文和材料，未接受此次新纳入审查的 `executive_summary`。统一使用现有 `canonicalFoundationBlockIds()`，仍拒绝 audit appendix、未知区块、外部文档及重复 identity；不扩大定向复核生命周期。
5. 修复后以真实 source/candidate 做只读纯函数交接回放通过：31 条来源问题、8 份候选文档、21 处变更。该数量包括候选集合中的未改动文档，不等于 Revision 修改了 8 份文档。

此前不可恢复的失败正文仍不能靠新增诊断追溯还原。本次两次 Revision 成功完成，不能声称已从真实失败中验证所有诊断类别；这些类别由离线测试验证。

## 最终观察（08:20 UTC）

- Chrome 在后端重启后正常重试，复用已完成 Revision 候选，进入 sequence 4 的 targeted Reviewer。
- Reviewer result `9bea0aca4ff7a89913c719668a60c7d40a1b3c5f46c451d7dd6b54631fefc3b0` 已生成：31 条原问题中 30 条 PASS，剩余 1 条 FAIL，decision 为 `retry_same_round`，不是通过验收。
- 剩余问题 `AUD-5A5CA5710EF8134ABA2569E1` 的 expected 同时要求 GDD 动作和规则资源，但复核包只有 `GDD#player_actions` 与 Level 的 `material.route-choice-diagram`。模型确认原有路线/体力等错误已消失，却因缺少 `GDD#rules_systems` 而返回 `evidence_insufficient`。不能把这一结果当作候选仍有同样内容错误。
- 为避免针对缺失审查证据继续改写文档，通过 Chrome Stop task 停止后续自动执行。UI 明确显示用户停止、需要处理；持久化状态为 `DOCUMENT_REVIEW / needs_action`，sequence 4，无后续 Revision 启动。
- 刚停止时结算曾为 pending；最终只读核验 billingStatus 已 settled，stop control 的 sequence/appliedSequence 均为 4。未修改计费记录或控制状态。
- 规范 Level 文件仍为 252 字节，SHA-256 `72f6faed0d9a95c4b24427161d801b5011da343a8af24c7a5138afff68ebc67c`。修订候选未验收发布，真实原件未手工编辑。

## 新阻塞根因与建议（只读审计）

源问题仅携带 `issue.source = GDD#player_actions`、`game.mechanics` fact 和同一 section；expected 却同时声称 `GDD#rules_systems` 的三项资源。初始语义包有完整 GDD，但 issue draft 只有单个 `sourceSectionKey`，公开问题没有保留第二来源。因此 targeted 构建按 source、可选 target、remediation 收集区块时，只得到两块，并非丢失了已经提供的 supporting ref。

建议让 semantic issue 显式携带并验证多来源 supporting section 引用，随后定向复核只纳入这些必要区块；或将它拆成两个 source-local 问题，共同约束同一个修订位置。不应全局扩大到整个语义检查、解析自由文本来推断授权引用、删除资源约束或放宽 FAIL 判定。

下一步需要实现并验证这项 Reviewer 问题证据契约修复，再从正常 UI 验证；本轮仅诊断，未擅自实施。未提交、未部署、未发布游戏。
