# P4 公开阶段接线：离线验收记录

后续真实验收：首次运行受阻并保留归档；用户继续授权后，第二次独立冻结副本完成真实初审、修订、同轮/新轮复审，最终 passed / settled 并停在 Checklist 前，P4.5 已通过。详见 [真实验收记录](stage-isolation-p4-real-acceptance-2026-09-07.md)。下文“未授权/未启动”描述此前离线轮次，不覆盖后续真实验收。

日期：2026-09-07。分支 `codex/game-ir-isolation-recovery`，基线 HEAD `71507fb5e9e444a39334ebc9c410e0cb53146ae9`。本轮由主代理执行，全部修改未提交。工作目录为本文件所在 worktree，不是对话默认的 `claude-code-main`。

## 结论及范围

公开链路已接入现有 controller/app：八文档公开完成结果 → Reviewer → Revision → Reviewer。离线模拟进程与假计费已验证修复后通过，并在 Checklist 前保持 `needs_action` 停点；重复继续不会启动 Checklist。P4.1、P4.2、P4.3、P4.4、P4.6 的本轮离线范围通过。P4.5 真实副本/模型验收尚未授权、未执行，因此总 P4 不勾选完成。

未启动真实服务、真实模型、真实计费或既有项目；未部署、提交、合并。未新增或修改 stale-owner 接管机制，未知关闭继续保留 needs_action。既有局部/混合格式限制和跨崩溃关闭限制仍沿用 P2/P3 结论。

## 接线与校验

- `foundation-public-handoff.ts` 只读取作者明确导出的产物；校验相对路径、父目录/文件符号链接、文件类型、字节长度、SHA-256、UTF-8，以及公开身份。Reviewer/Revision 请求通过各自 public digest 入口接纳，不读取阶段 checkpoint。
- `foundation-review-link.ts` 保存公开请求、句柄、结果和整链控制意图。请求先落盘，再调用 start；启动确认丢失后的显式继续复用原请求。未结清计费不能启动后继。初审问题、新轮修复、同轮保留前驱、候选复核均通过公开数据映射。
- 修复 `schema.ts` 的公开 Revision 与旧 foundationAuditState 冲突；仅具备合法公开 Revision 交接时替代旧状态要求。公开/旧状态互斥仍成立，跨 owner/project/request 结果被拒绝。持久 schema 版本升至 50 并记录指纹。
- 作者的完成观察回调进入现有 controller；app 装配两个惰性 host，复用公开认证/运行配置/计费基础能力。没有第二个启动器。
- 停止、继续、应用关闭及展示跟随当前公开阶段；前端投影只显示粗粒度阶段任务，不输出请求、文档全文、Issue Registry 或 worker 内容。Reviewer 已通过停点不提供继续到 Checklist 的入口。

## 旧执行入口退役

- controller 删除旧 Reviewer 事实/确定性/语义调度和终态接纳，以及旧 Revision 规划、修复、定向复核、发布与轮次关闭执行体。
- dispatcher 删除旧阶段认领、终态、重试和停止业务分支；旧 worker 派发和 terminal replay 明确拒绝。旧 session adapter 的直接 Foundation worker start 同样拒绝。
- transition 删除旧 Foundation retry 状态修改；公开链路只能经 public 控制。recovery 的停止操作不再修改旧 Foundation 内部任务。
- 历史 run 仍可只读加载；controller resume、ensureProgress、store reconcile 与旧 transition 无法重新启动历史 Foundation Review。保留后续 Checklist、资源、规划、实现所需的数据和依赖，没有全库清理。
- 历史只读/证明工具不作为新阶段执行入口。旧执行语义的历史专项测试不构成本轮 P4 新执行链验收；本轮没有宣称整个后端全部旧用例已迁移或全仓测试一次性全绿。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| P4 接线、公开生命周期、作者回归、host、app 路由和后续资源/规划/实现聚焦组合 | 62 pass / 0 fail，14 文件，319 assertions，31.54 秒 |
| 随后增强的启动确认丢失与停止未确认专项 | 2 pass / 0 fail；其中 1 项新增，另一项增强既有断言 |
| 三独立模块联合首次运行 | 686 pass / 6 fail，692 项，130 文件，9035 assertions，358.62 秒；该次运行不计为全绿 |
| 既有进程身份诊断专项（获准解除 /bin/ps 沙箱限制） | 6 pass / 0 fail，19 assertions；覆盖上述 5 个权限失败，未修改生产实现 |
| 作者 native runtime 专项 | 首次单跑 15 pass；定位为测试未等待异步 pending 写入后，仅补测试中 abort/drain 屏障，后续包含该组的 27 项组合通过 |
| 类型检查与 diff 空白检查 | 通过；最终执行结果以本轮日志为准 |

聚焦组合日志：`/private/tmp/p4-acceptance-01a07828.log`。首次三模块日志：`/private/tmp/p4-stage-regression-01a07828.log`。作者测试复跑及停止最后回归分别见 `p4-final-focused-01a07828.log`、`p4-stop-final-01a07828.log`。临时日志不是生产状态或阶段恢复依据。

核心新测试位于 `foundation-review-link.test.ts`、`foundation-public-retirement.test.ts` 和 `foundation-authoring-public-routes.test.ts`。覆盖：公开 Revision schema、产物路径/字节/身份、计费待结清、needs_action 不推进、观察失败后显式继续、同一请求恢复、并发重复调用、停止前后交接、停止确认失败、迟到/错误身份结果、同轮/新轮公共映射、controller 实际离线闭环、作者完成回调、UI、app 停止/续接/关闭以及旧入口拒绝。

离线闭环使用 `native-reviewer.ts` 与 `owned-attempt-fixture.ts` 的固定本地输出，以及 `offlineReviewerBilling`；没有调用 provider。初始 GDD 被设置为格式不完整，Revision 生成完整候选，Reviewer full_format 重审后通过。审计通过只来自 Reviewer，Revision 的 candidate_ready 不替代审核结论。

## 后续停点

P4.5 需要单独授权真实副本、模型与计费范围；当前没有启动或排程这项工作。P5 的 Checklist 接线未包含在本轮中。
