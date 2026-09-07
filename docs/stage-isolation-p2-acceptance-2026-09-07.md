# Reviewer 独立模块验收（2026-09-07）

状态：P2 Reviewer 独立模块离线验收通过，按下述公开契约及已确认范围勾选 P2.1—P2.6。未提交；不代表应用接线、真实服务或跨崩溃进程树清理验收。

## 本轮边界

按用户最新确认，先完成 Reviewer，再处理 Revision，最后接主流程。本轮只修改 Reviewer 验收测试及相关记录，不修改 Revision，不接 P4，不启动真实模型、服务、数据库或既有项目。

Reviewer 拥有初审、候选定向复核、纯整文格式候选完整重审，以及各自的输入校验、规则、事实/语义 worker、模型策略、私有日志与状态、终态接纳、停止/显式续行、用量 outbox 和不可变结果发布。唯一生产入口是 `packages/agent-workflow-server/src/beegame/stage-modules/foundation-reviewer/public.ts`，只公开 `start/getResult/resume/stop`。

不共享阶段业务执行内核：不导入 Author、Revision 或旧编排执行代码，不读取其他阶段的私有状态，也不调用其他阶段。输入仅为复制的文档/公开结果及版本绑定；基础认证、配置和计费通过其公开客户端使用，不复制这些基础模块的实现。

## 证据矩阵

| 验收项 | 实现与验证证据 |
| --- | --- |
| P2.1 完整执行职责 | `review-lifecycle.ts` 统一入口；`initial-lifecycle.ts`、`targeted-lifecycle.ts` 拥有全生命周期；fact/semantic/targeted controller、journal、native worker、usage outbox、publication 全部在 Reviewer private。原有生命周期与停止测试保留。 |
| P2.2 初审和复核归属 | public-lifecycle、full-format-lifecycle、targeted-lifecycle、候选绑定及同轮保留测试。只消费候选数据，不调用修复模块。 |
| P2.3 独立运行 | 原有脱离仓库的 packet/controller/public 格式测试；新增 `private/tests/detached-public-execution.test.ts` 经 public 入口在临时目录运行真实固定假进程，完成事实抽取、语义审计、发布和离线计量。实际 bundle 加载审计仅允许 Reviewer 与 zod；执行目录不包含其他阶段或仓库模块。 |
| P2.4 规则及隔离 | 19 个冻结规则文件及协议/提示摘要、输出绑定、目录隔离、deep-copy、候选保留/替换和发布测试；新增 `private/tests/infrastructure-boundary.test.ts` 检查完整生产源码、类型导入、动态 literal/import-equals、路径解析及真实文件路径。格式范围例外见下节。 |
| P2.5 公开边界 | public 工厂拒绝私有能力注入；公开值不暴露 worker、journal 或 admission 回调。全 packages/apps 生产消费者仅允许 Reviewer public，禁止 private 导入；不以尚无 app 接线伪造生产消费者数量。 |
| P2.6 基础能力 | 既有逐派发稳定 eventId、未知用量 pending、失败/停止用量与重放测试；另补真实认证、运行配置、计费 public factory 与 Reviewer 的离线组合验证，底层使用固定替身。真实服务验收不属于本次离线门槛。 |

## 明确保留的行为

- 用户已确认局部/混合格式候选继续拒绝，作为本次验收范围例外；不误签 PASS，不新增复核策略，不宣称该路由与旧版本完全等价。纯整文格式修复后仍执行完整重审。
- 正常停止、显式续行由模块自己完成。已派发但缺少可信关闭证据的遗留执行继续报告 `needs_action`，不自动接管、杀孤儿进程或伪造终态。公开契约本就允许报告需要处理；不把额外恢复工程增列为当前验收门槛，也不宣称进程树跨崩溃清理已实现。
- Reviewer 公开类型包含 `failed`；现有可续行的执行/发布/计费异常继续按真实可恢复性返回 `needs_action`，无效调用或无法可信读取的证据返回净化错误。不为制造标签覆盖而增加不可恢复状态。
- `completed` 仅表示审计结果发布，既可能 `passed` 也可能 `issues_found`；用量是否确认由独立 `billingStatus` 表达，不混淆审计结论与计费。
- 原应用执行分支尚未在 P4 切换/退役。独立模块验收不等于应用已接入，也不授权启动旧项目或新旧双跑。

## 本轮验证

- 新增 detached public 完整执行测试：1 passed，0 failed，20 assertions；38.36 秒。
- 新增直接/类型依赖与全仓生产消费者测试：2 passed，0 failed，4 assertions；3.00 秒。
- Reviewer 完整模块回归：334 passed，0 failed，57 文件，3731 assertions；268.69 秒（包含上述新增模块内测试，不重复相加）。
- 主审复跑 `src/__tests__/foundation-reviewer-public-infrastructure.test.ts`：2 passed，0 failed，39 assertions；38.35 秒。通过真实 public 工厂、固定假进程及假计费权威验证，未触及真实服务。
- 主审后端 `bun run typecheck`：退出码 0。
- 本轮合计 Reviewer 相关测试 336 passed，0 failed；没有用其他阶段的测试数量代替 Reviewer 证据。

主审裁决：P2.1—P2.6 在上述边界内成立。新增证据补齐了 public 完整执行、全仓生产消费者和公开基础能力组合三项验证缺口；不需要改审计策略或新增恢复机制。下一工作项为单独收口 Revision，P4 仍未启动。

清理约束：新测试必须确认所有 fact/semantic task 非 running 且执行租约 free 后，才删除自建临时目录。公开完成或父进程退出本身不是关闭证明；未确认则保留证据并使测试失败。
