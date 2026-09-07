# 三阶段隔离 P0：基线与所有权准备

日期：2026-09-05
状态：执行中，尚未通过 P0 准入审查。
主计划：[独立阶段模块与现有编排解耦计划](independent-stage-programs-plan-2026-09-05.md)

## 本轮授权范围

先完成八文档、Reviewer、Revision 三模块，按 P0 → P1 → P2 → P3 → P4 三模块交接顺序执行。
后续 Checklist 等阶段不在本轮实施范围。主 agent 编排/审计/纠偏，子 agent Luna high 做明确划界子任务。
当前子任务仅只读清点。不得启动真实模型、重跑作者、恢复暂停项目。
保留现有编排入口；阶段专属执行职责独占，不通过注入旧全局 worker port 或 store 回调绕过隔离。2026-09-06 更正：认证、计费按各自基础模块统一所有，通过公开契约复用，不属于每阶段应复制的闭包。

## 代码基线与在途修改

可信已提交基线：71507fb5e9e444a39334ebc9c410e0cb53146ae9。
实际工作目录：bee-game-studio/.worktrees/game-ir-isolation-recovery。
读取 git HEAD 作为原行为来源；当前未提交共享层半接线不得作为行为等价基线。

开始本轮已有的生产/测试修改（相对 packages/agent-workflow-server/src/beegame/delivery-workflow）：

| 状态 | 文件 |
| --- | --- |
| 修改 | dispatch.ts |
| 修改 | foundation-review-boundary.ts |
| 修改 | foundation-review-lifecycle-oracle.ts |
| 修改 | recovery-projector.ts |
| 修改 | stages/foundation-review/public.ts |
| 修改 | stages/foundation-review/recovery.ts |
| 新增未跟踪 | foundation-review-coordination-oracle.ts |
| 新增未跟踪 | foundation-review-mutation-isolation.test.ts |
| 新增未跟踪 | foundation-review-recovery-checkpoint-isolation.test.ts |
| 新增未跟踪 | stages/foundation-review/dispatch-terminal.ts |
| 新增未跟踪 | stages/foundation-review/foundation-review-dispatch-terminal-isolation.test.ts |
| 新增未跟踪 | stages/foundation-review/mutation.ts |

已有文档修改：旧方案废弃标记；新主计划未跟踪。都保留。
本记录不等于备份提交，不声称工作区干净。不删除、不回滚已有内容。新模块优先在新目录实施；现有编排接线前必须单独审查重叠 diff，并记录半接线代码的保留/替代处置。

## 作者冻结的行为与源码证据

冻结的是业务及可观察行为，不是禁止移动代码。不得将冻结用作留下共享执行依赖的理由。

| 源文件 | SHA-256 |
| --- | --- |
| delivery-workflow/foundation-authoring-stage.ts | fb9bf7a6d7f950c60ab71b58fb39716bf02a2d07da3e993276fe203ebc2bcb32 |
| delivery-workflow/foundation-authoring-batch.ts | 861d282676f288428af9e622303d3b5330ace3ebb70d7cdcff38dc919016b8da |
| delivery-workflow/foundation-authoring-contract.ts | 095f9e8a6571be1b5f3fe780cf441fcc3ac6d12f8b1cb5c5d8082a01b3607282 |
| delivery-workflow/foundation-authoring-prompt.ts | 0e99f3c0b41e7e75730acd460684a93cf2dbf167c2097b49316c556c8b45c17f |
| delivery-workflow/foundation-authoring-state.ts | 5e075cfe0d7b0aa4bd1aec7b4c1b0e7cb4588b06f9c594a6006c272b65c9a2ee |
| authored-document-receipt.ts | f45d08f815b41f5f18409199227718d618226aa64158656adae4918bd7b523f3 |

以上路径相对 packages/agent-workflow-server/src/beegame。完整依赖清单待清点闭合，不能凭这六个文件宣布覆盖全部作者执行。

必须保持：

- 初始 GDD 后按现有依赖启动其他七份文档；批次并发上限 4。
- 输入选择、提示、文档契约、模型配置和原始正文生成方式。
- 作者只提交自己的文档；不能宣称 Reviewer 问题已关闭。
- 现有回执、正文提交、元数据及完成检查的语义。
- 用户停止、失败、失联会话、并行任务、重复终态和恢复的原规则。
- 不增加作者内容审计、不让作者替代 Reviewer 修订初稿。

## 已确认的作者职责来源

| 来源 | 当前职责 | 新归属/约束 |
| --- | --- | --- |
| foundation-authoring-stage.ts | 初始及并行请求、文档终态校验、完成判定 | 作者私有 domain/lifecycle，不返回下游 phase |
| foundation-authoring-batch.ts | 依赖调度、4 槽、checkpoint 更新 | 作者私有 scheduler/state |
| foundation-authoring-contract/prompt/input | 内容选择与提示 | 作者独占实现，Reviewer 不 import |
| authored-document-receipt、foundation-markdown-stream、authority-projection | 作者正文与回执、流式提交和权威输入 | 作者私有产物/执行闭包 |
| dispatch.ts | 认领、传输、失败、停止、作者终态入站 | 作者私有 dispatcher/terminal，不委托原共享 dispatcher |
| controller.ts | 文档 worker 处理、继续调度、错误与交接 | 内部处理移入作者，仅最终结果交给编排 |
| transition.ts、run-store.ts、recovery*.ts | 作者状态提交、停止继续、检查点/日志恢复 | 作者私有状态与恢复；编排不得操作单文档状态 |
| delivery-worker-session-port.ts | 作者模型输入、会话执行、结果转换 | 作者私有 runtime adapter |
| session-manager.ts:2268,2320 | 进度/Token 直接回写全局 run-store | 必须断开；作者 runtime 仅写作者私有状态 |
| app.ts 的作者状态展示及恢复 | 读取内部状态并可能触发 reconcile | 只消费作者公开摘要，不猜测完成/恢复 |

## 待闭合事项

- [ ] 运行依赖闭包：包括 native 会话、工具、流式产物、认证/模型配置与计量，不能只拆最外层 worker port。
- [ ] 三模块公开输入、运行句柄、最终结果及兼容规则；不能输出整体 DeliveryRun。
- [ ] Reviewer/Revision 问题与候选交接，保留同轮重试、局部通过和版本绑定。
- [ ] 首份八文档产物导出样本及完成证据，使用冻结副本，不接触真实运行。
- [ ] 整链停止、启动幂等、结果确认与崩溃续接；模块自己的恢复独立。
- [ ] 三模块代码归属方案及主审，P0 通过后才开始迁移实现。

## P0 主审收敛（本轮）

所有权清点由主审和两个 Luna high 只读子任务完成。经 2026-09-06 纠正，作者专属运行闭包为：私有 native 进程协议、模型执行配置、流式正文、文档工具范围、回执、单飞 turn、停止与晚到消息、私有事件/检查点、进度与用量采集。认证续期与计价扣费不迁入作者，只经对应基础模块 public 契约使用。禁止共享旧 SessionManager 的阶段执行逻辑，也不复制其中 Revision/资源/实现分支。
Reviewer/Revision 的问题/候选协议经主审纠正：上游不指定修订 batches，不暴露 review-ready 内部状态，不传完整私有 FactStore。

公开停点证据：现有 foundation-audit-boundary.ts 的 readFoundationAuthoringPause/pauseFoundationAuthoringHandoff 已能在作者完成后、Reviewer 前持久化停止；controller 有调用。新模块接线时以公开作者 completed 结果替代内部检查点读取，旧审计自动续跑分支不作为 fallback。
本轮不操作该停点或真实项目。P1/P4 离线验证需覆盖停止已到达、重复恢复、旧新路由不能并行。

冻结样本策略：
- 业务来源固定为 HEAD71507fb5e 中 foundation-authoring-batch/state/scheduler 与 handoff-equivalence 等已提交测试；
- 在临时工作区使用固定 worker 输出，覆盖八份正文/回执与导出摘要；
- 真正八文档模型输出副本只在独立真实验收获授权后固化；当前不将生产项目当测试工作区。

模块布局、公开操作、状态/错误映射、交接身份、同轮修复和历史处置见 stage-isolation-p0-contracts-2026-09-05.md。
主审结论：基线、三模块所有权、接口边界与正反例已完成 P0 设计准入。协议示例见 stage-isolation-contract-examples-2026-09-05.json（仅离线协议数据，不是生产文档回执）。原始暂停项目未读取/修改，工作区半成品保持原样。开始 P1 作者模块内实现，原编排接线必须等待作者私有组件及契约测试通过。
