# Reviewer 多来源证据契约

日期：2026-09-07。

## 修复范围

上一轮真实定向复核中，expected 引用了 GDD 动作与规则，但问题只保留动作来源，导致复核缺少规则证据。本次让 semantic issue 显式携带有界 `supportingSectionKeys`，由 Reviewer 编译成完整 `supportingSections` 引用。

- semantic draft 必须提供数组，允许为空，最多 16 项；拒绝重复、外部 key 和 source 重叠，规范化顺序后绑定 issue identity。
- supporting refs 与对应只读文本切片经过公开 Reviewer → Revision → targeted Reviewer 交接，并校验 digest、行范围、heading 与 section identity。
- 支持证据不会自动成为可写范围；只有明确 remediation 才授权修改。候选中被另一条合法 remediation 改动的 supporting section 会重绑定到当前候选引用。
- 同轮重试允许已经 PASS 的问题退出剩余问题集合；对仍存在的问题继续校验 source、target 与 supporting identity，不要求问题总数不变。
- semantic policy 升至 `foundation-semantic.v4`；不回填旧不可变结果，不引入兼容转换，也不通过解析 expected 自由文本推断授权。

## 已完成的离线验证

- Reviewer 完整测试：344 pass，0 fail，3855 assertions，59 files。日志：`/private/tmp/reviewer-multisource-final.log`。
- Revision 完整测试：224 pass，0 fail，1583 assertions，51 files。
- 新增多来源专项测试覆盖缺失/越界引用、重复/source 重叠、顺序稳定性、公开切片缺失及篡改、定向完整引用篡改、合法证据重绑定、support-only 越权修改拒绝及 issue 合并 identity。
- `git diff --check` 通过。
- 公开多来源执行集成：1 pass，0 fail，22 assertions；测试 worker 实际检查三份所需 section evidence 与修订后的目标文本，不是常量 PASS。
- 最终根目录 `bun run typecheck` 通过，日志：`/private/tmp/multisource-typecheck-final.log`。
- 公开接线、host 与集成合并重跑：34 pass，0 fail，244 assertions，6 files（包含上述多来源集成，不重复计数）。日志：`/private/tmp/multisource-public-integration-final.log`。

## 验收状态

通过 Chrome 正常 UI 从原始项目创建新副本 `review-copy--ef7b3cc1-3494-49f0-91af-ee81989c6937`，run `00c8ebe6-96ce-4f5c-8550-f0a4fae9336f`。前置格式修订已完成，已进入 sequence 2 Reviewer；不能据离线测试宣称真实业务验收通过。

09:09 UTC：sequence 2 Reviewer 完成，结果 `eea86ed95c36fb6572861ccc7b32c7979fe08f0539edc33eb8156abdae64b90e` 共 19 条问题，其中 12 条语义问题全部带 supporting refs 和对应公开文本切片。sequence 3 Revision 正常接收。关键问题 `AUD-C1919BD1FE5AAD36EB3A5F9A` 的 source 为 `GDD#player_actions`，supporting 为 `GDD#rules_systems` 与 `GDD#vision`；三块都实际出现在 Revision 输入的公开 evidence slices 中。尚待候选与定向复核完成。

随后 sequence 3 Revision 生成候选 `ff577f6a1a8393c1eaff4927de9ef49be9942cd6b92b6d14215d14eecb59fbd0`（20 处变更），sequence 4 targeted Reviewer 生成 `d0229d2f46ad0abf41778904f0b94e305ea49dbac4f9fe825d931c01af8f462e`：19 条来源问题全部 PASS，`decision=round_complete`，关键多来源问题也 PASS，无 `evidence_insufficient`。这验证本次证据契约修复已经贯穿真实 Reviewer → Revision → targeted Reviewer。

该结果还包含 1 条新 contract issue `AUD-F70CEAC45EA485E8A7DC4DFB`：`asset.covered_level_requirements` 与 `level.required_assets` 不相等；不是原问题复核 FAIL。正常流程已进入 sequence 5 `next_round` Revision，仅处理这 1 条问题。全流程交接确认仍待完成。

## 最终结果

- sequence 5 Revision 完成资产映射修订，候选 `fdaed3bfb3a36626bb78998be29ed700e5609887302abd5f15d94cd626e4f53b`。
- sequence 6 Reviewer 结果 `ec34eb70f4a69dd85ee9a1aeb90f59a1f57c35e7d3547c97a7aa2b0f162d5e6f`：`kind=passed`，`issues=[]`；round 2 唯一 contract issue PASS，`decision=round_complete`。
- `acceptedReview` 已记录上述 passed 结果，最终 billingStatus 为 `settled`。流程停在 `DOCUMENT_REVIEW / needs_action`，具体原因为 `Foundation review passed. Checklist handoff awaits acceptance.`；这是正常交接确认边界，不是新的审查失败。
- Chrome 显示“已审计”和通用“需要处理 / Workflow is blocked and needs attention.”。页面没有把具体交接等待原因展示出来，这属于现有呈现问题，本轮未扩大范围修改 UI。
- 副本规范 Level 文档已由正常流程更新为 20579 字节，SHA-256 `de5a94b707fddb22bb1cf37e911da8a33366122132047bbae0e610656721273d`，与 accepted Review 中的文档 digest 一致；不再是导入的 252 字节 Author 残片。
- 对八份规范文档逐一做只读 SHA-256 核验，8/8 均与 accepted Review digest 一致。
- 停在用户指定的交接确认边界，没有确认后续 Checklist、运行游戏生成或点击发布。基础文档三模块链路验收通过，不等于游戏实现、游戏可玩性或发布验收完成。

未提交、未部署、未发布游戏，未手工编辑真实项目文档或结果。
