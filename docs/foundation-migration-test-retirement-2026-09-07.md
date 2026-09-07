# Foundation 迁移测试及旧副本退役

日期：2026-09-07。用户明确批准在独立模块方案下退役纯新旧等价测试和它们专用的旧实现副本。此阶段已完成；没有修改真实项目文档或运行产物，没有改变当前模块业务规则。

## 删除与保留

- Reviewer：删除只比较迁移源码字节的三项测试及 domain/protocol 两份哈希基线；原模块依赖封闭检查保留为 `dependency-boundary.test.ts`。规则、事实、语义、定向复核、进程、计费和生命周期行为测试保留。
- Author：删除旧 commit/golden 对比测试和压缩旧源码 fixture；保留为独立的 authoring-behavior/recovery-policy 测试及小型输入 fixture。覆盖依赖释放、最多四并发、单文档写权限、提示词边界、停止与选择性重试。
- Revision：删除 `frozen-legacy-oracles` 专用旧实现目录、纯旧字节完整性与旧流对比测试。Markdown、整文校验、修订规划、章节操作和 worker 输入输出改为直接行为断言，不复制旧实现到其他位置。
- delivery-workflow：删除旧 audit authority/checks/contracts/manifest/rules、format review、fact definitions/extraction/store、final issue merge、impact、issue registry、deterministic rules、section index 副本及对应旧测试；删除切换差分 oracle、纯迁移 handoff/isolation 测试，以及仅供旧测试使用的 audit-boundary/document-handoff。
- 保留仍有用途的退役拒绝及进程清理保护。公共交接测试使用当前策略构造合法输入后再验证篡改拒绝，不通过放宽错误断言或生产兼容逻辑解决测试失败。
- 各独立模块自己拥有的当前 domain 实现和跨模块契约测试不是旧实现，继续保留。

## 验证

- Author private：138 pass、0 fail、3315 assertions。
- Reviewer：336 pass、0 fail、3780 assertions；比前一轮减少的三项正是源码字节冻结测试。
- Revision + 原根部候选测试：215 pass、0 fail、1525 assertions；行为测试重命名后复跑 16 pass。
- 主 agent 最终退役/公共交接/候选契约检查：7 pass、0 fail、68 assertions，含真实应用打包入口的依赖检查。
- 补充退役 Author、Revision、公共交接及 fact owner 检查：12 pass、0 fail、571 assertions（与上项有重叠，不相加）。
- agent-workflow-server 类型检查、`git diff --check` 通过。
- packages/apps 源码中旧 frozen-legacy-oracles、Author parity fixture、已删 audit-boundary/document-handoff、Reviewer 哈希基线引用扫描为零。

## 恢复边界

旧源码有 Git 历史及 `/private/tmp` 中的清理备份；这些不是所有本轮删除文件的完整工作树快照。少数原本未跟踪的纯迁移测试在备份之前已退役，不能承诺从 Git 或备份完整恢复。没有删除真实项目数据。

## 后续

按用户指定顺序继续：为 Revision 增加有界、去敏失败诊断，再通过 Chrome 的正常重试入口采集真实失败证据。本文不代表真实模型验收已通过。
