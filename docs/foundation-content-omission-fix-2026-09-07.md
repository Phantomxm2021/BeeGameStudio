# Foundation 内容漏检修复与验证

日期：2026-09-07。状态：代码修复与离线回归通过；真实模型验收仍被前置 Revision 失败阻塞，不能宣称漏检已通过真实验收。

## 修复范围

- Reviewer 语义策略升级至 `foundation-semantic.v3`。玩法可行性检查覆盖 Level 全部 14 个标准块（摘要、正文、材料），并读取 GDD 的产品范围及玩法约束。
- 所有 10 个语义检查的 objective 进入不可变 packet，并投影到初审和独立确认的模型提示中。
- 明确要求逐块报告残留冲突，其他章节正确不能抵消错误章节。确认提示补齐同一修订约束。
- 不增加旧项目或旧策略兼容分支；不改变定向复核的范围和生命周期。

## 已完成验证

用户本轮明确批准相关单元测试与代码基线更新；没有手工编辑真实项目文档或产物。

- 针对性测试：25 pass、0 fail、2227 assertions。包括全 Level 覆盖、全部语义 objective 的初审/确认投影、残留冲突转换为可修订 Issue，以及代码基线校验。
- Reviewer 完整测试：339 pass、0 fail、3813 assertions，58 个文件。
- 三模块接线与集成：17 pass、0 fail、119 assertions，3 个文件。集成使用测试本机进程及模拟计费，不是真实模型证明。
- agent-workflow-server TypeScript 类型检查通过；`git diff --check` 通过。

## 真实验收阻塞

Chrome 副本 `review-copy--61585ea1-c99b-45be-8b06-c54a12b1388b`，run `38b447ab-2a20-4a06-978c-4d4d9bf7cf6f`，仍停在 `FOUNDATION_REVISION / needs_action`，已记录 stop。本轮只查看现状和只读诊断，没有再次触发付费重试。

副本从不可变 Author 输出开始，Level 仅有 252 字节协议残片，缺少文档标题。Reviewer 正确检出 `DOCUMENT_FORMAT_INVALID`，因此尚未运行本次扩展的语义检查。

该请求之前有三次 `output_invalid`、一次 `native_failed`，随后第五次被停止。Revision 的 `owned-attempt.ts` 丢弃具体输出校验异常，失败 receipt 不保留原始 Markdown，因而无法从现有记录重放校验或确定三次失败的具体原因。不能据此断言是模型内容、格式校验还是某个特定生产分支造成，也不能把停止时的进程信号单独认定为失败根因。

下一步应为 Revision 增加有界、去敏的校验失败诊断（错误类别/安全原因），配套单测后，通过正常 UI 重试收集证据。不得跳过校验、预置正确结果、修改真实文档或自动改变 Author/Revision 的职责边界。

## 旧实现核查

核查范围为 Foundation Reviewer/Revision 的生产入口及 delivery-workflow 接线，不是全仓库无遗留证明。

- controller/app 当前接入独立模块的 public factories；旧审查状态和旧 worker 路由会被拒绝，没有发现生产入口仍能调用旧审查执行链。
- `retired-foundation-review.ts` 的拒绝和旧 running dispatch 识别仍有安全用途，保留。
- delivery-workflow 中仍有旧 domain 副本，例如 foundation-audit-authority、foundation-audit-rules、foundation-fact-store、foundation-section-index。它们仍被迁移等价性测试或 frozen legacy oracle 引用，不属于完全无引用文件。本轮没有删除这些测试依赖；后续若退役迁移测试，应一并移除旧副本，不能仅改名或复制来声称清理完成。

未提交、未部署、未发布游戏。原真实失败案例及原验收报告保留。
