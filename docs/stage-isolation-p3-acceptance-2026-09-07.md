# Revision 独立模块验收（2026-09-07）

状态：P3 Revision 独立模块离线验收通过，按下述公开契约及范围勾选 P3.1—P3.6。未提交；不代表 P4 应用接线、真实服务或跨崩溃进程树清理验收。

## 本轮边界

按用户确认顺序，Reviewer 已单独验收，本轮只收口 Revision。修改固定输入测试、独立执行及依赖验证和验收记录；未改 Reviewer 或 Revision 生产执行逻辑，未接主流程，未运行真实模型、服务、数据库或既有项目。

Revision 唯一生产入口为 `packages/agent-workflow-server/src/beegame/stage-modules/foundation-revision/public.ts`，工厂只提供 `start/getResult/resume/stop`。问题消费、规划、批次、native 执行、修改完整性、请求与尝试状态、候选发布、停止/显式续行及用量 outbox 都由 Revision private 拥有。阶段之间不共享业务执行内核；认证、配置、计费仍通过独立基础模块的公开契约使用。

## 证据矩阵

| 验收项 | 实现与验证证据 |
| --- | --- |
| P3.1 全生命周期职责 | request-preparation/planning、owned-attempt/native-process、attempt-store/request-store、candidate-publication/completed-candidate、lifecycle、usage-outbox 均在本模块；public 完整 bundle 加载审计禁止其他阶段、旧 runtime 和基础能力私有实现。 |
| P3.2 不内嵌内容审计 | Revision 自行校验输入证据与修改完整性，仅发布 candidate_ready、修复声明及未解决项；不执行 Reviewer，不签审计通过。验证复核输入数据不等于运行审计。 |
| P3.3 固定输入独立运行 | lifecycle、lifecycle-infrastructure、lifecycle-followup、lifecycle-next-round、detached-public-process 五个入口仅消费本模块固定 JSON。覆盖完整修复、鉴权失败、停止后显式继续、开放重试、计费 pending/续交、跨实例幂等和下一轮；递归静态检查不允许 Reviewer/旧阶段代码进入该入口套件。独立 OS 子进程从临时目录加载打包 public，另启自有固定 native worker，完成候选及计量，并只读重开。 |
| P3.4 冻结语义 | 保留规划、Markdown/section 操作、worker 输入输出及流行为差分测试；同轮重试保留 PASS 字节与前驱，下一轮绑定新问题及文档版本，候选替换、身份、不可变发布与输入字节不变均有测试。 |
| P3.5 公开边界 | 工厂严格捕获数据并净化错误，不向编排提供 store/worker 操作回调；公开完成结果没有审计 verdict。全 packages/apps 生产消费者检查仅允许 Revision public；尚未有 app 接线，不以消费者数量冒充集成完成。 |
| P3.6 基础能力 | 真实 auth/runtime-configuration/billing public factory 配合固定 credential/config repository/billing authority 和 native 替身；无权限不派发，显式 resume 完成。既有 outbox 验证失败/停止用量、确认丢失后同 eventId 重放、重复确认、错误 owner/usage 拒绝及不重复执行。真实扣费不在本轮范围。 |

## 状态及证据边界

- 用户已确认保留当前 `needs_action` 行为。`failed` 仅在确有不可恢复终态时适用，不为标签覆盖新增不可恢复状态；详见 P0 契约的 2026-09-07 确认。配置、执行、发布及计费故障按既有规则处理；未知关闭权威报告 `needs_action(resumable: false)`，无效调用或不可信持久证据返回净化异常。
- 正常停止/显式续行测试与未知关闭权威拒绝测试分别证明其适用条件，不代表跨崩溃接管或孤儿进程清理已实现。本轮没有新增恢复机制。
- 固定 JSON 是预先复制的公开输入数据，来源保留在 provenance；独立测试运行时不执行 Reviewer 来生成 fixture，也不复制 Reviewer 私有规则或准备状态。实际修订规划与执行仍由 Revision 完成。
- 其余部分回归测试仍调用 Reviewer 构造输入，历史 oracle/parity 测试还使用 Reviewer 或旧实现作差分基准（包括 lifecycle-parallel / lifecycle-recovery-boundary 的测试数据来源）；不计为五入口独立运行套件，不宣称整个 private/tests 目录都没有 Reviewer 导入。`public-review-revision-handoff.test.ts` 是跨阶段集成测试，本轮明确排除，不能据此宣称 P4 通过。
- 新增/迁移的真实假进程测试须 public stop 成功，并确认 activeAttemptIds 为空、执行 lease free 后才删除自建临时目录；无法确认则失败并保留证据。父进程退出或 completed 标签不单独作为关闭证明。

## 最终验证

- 主审完整 Revision 回归（排除 `public-review-revision-handoff.test.ts`）：208 passed，0 failed，49 文件，1473 assertions；39.18 秒。
- 主审固定输入五入口 + infrastructure-boundary/public-dependencies 专项：17 passed，0 failed，7 文件，151 assertions；19.02 秒。属于上述 208 项的子集，不重复相加。
- 主审后端 `bun run typecheck`：退出码 0。
- `git diff --check`：通过。
- 首次专项启动时固定 JSON 尚在写入，出现模块未找到错误；该轮不计验收。文件固定后完整回归及专项均通过，以以上最终结果为准。

主审结论：在上述离线、公开状态与数据边界内，P3.1—P3.6 成立。Reviewer 与 Revision 的独立模块验收已按顺序完成；下一工作项是 P4 现有编排的 public 交接及离线修复闭环，本轮未启动。
