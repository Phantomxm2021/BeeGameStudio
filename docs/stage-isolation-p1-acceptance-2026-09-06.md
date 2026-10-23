# P1 八文档 Author：最终离线验收与清理记录

日期：2026-09-06

后续状态：P1-R 追加退役已完成。用户明确批准后，剩余共享旧暂停／自动重置执行体已切除；最终后端 983 项、前端 28 项及类型检查通过。以下初轮验收与末尾最终 P1-R 记录分开保留。

主计划：[独立阶段计划](independent-stage-programs-plan-2026-09-05.md)

结论：**P1 隔离验收通过（离线范围）**。八文档生成策略没有借迁移修改；Reviewer 尚未接入新的自动交接。

## 判定边界

- 新 Author 的业务、调度、native 协议、文档接纳、持久化、锁、恢复、用量 outbox 和发布在自身 public/private 目录内。
- app/controller 只调用 start/resume/stop/getResult，保存公开调用身份、控制意图、opaque handle 和最终结果，不控制单文档任务。
- 认证、运行配置、计费是用户确认的基础公共模块；不是 Author 复制的实现。缺鉴权失败关闭；计费不可用保留 pending，不伪造已扣费。
- 完成态是绑定当前输入的八文档公开结果，UI 显示 8/8 并停在 public_author_handoff；不启动旧/新 Reviewer。
- 本记录不表示真实模型输出质量、部署、浏览器操作或真实扣费已验收。当前权限不用于重跑既有项目。

## P1 验收矩阵

以下路径均相对 packages/agent-workflow-server/src。测试名称或目录用于定位证据，不以单个测试替代整项目边界审查。

| 项目 | 所有权与主要证据 | 结论 |
| --- | --- | --- |
| P1.1 入口、依赖、完成 | Author private/lifecycle、domain/stage、batch、contract；八份请求/提示逐项冻结差分，私有 domain 八文档完成测试 | 通过 |
| P1.2 派发、并发、native 生命周期 | 私有 lifecycle/runtime；活跃实例排他、UUID 回调屏障、原生输出 drain、空输出重试、权限拒绝、配置失败 | 通过 |
| P1.3 终态、回执、提交、计量 | 私有 Markdown sink、acceptance-journal、publication、usage-journal；字节绑定、篡改拒绝、失败/停止用量、同事件重放 | 通过 |
| P1.4 私有状态与恢复 | public 严格 DTO、private checkpoint/persistence；拒绝整体 DeliveryRun/回调/额外字段、symlink、损坏数据，失活 lease 竞争 | 通过 |
| P1.5 停止、重试、恢复 | recovery-policy-parity 与 lifecycle；初始/并行进程丢失、显式重试、晚到成功流、多实例、receipt 与发布窗口恢复 | 通过 |
| P1.6 四方法与最终结果 | public.test、contract.test、publication.test；只暴露四方法，结果为 8 个 canonical 文档及不可变 artifact 引用 | 通过 |
| P1.7 编排接线、旧入口退役 | controller-public-author、public-integration、public-routes；无旧 worker 回落，两个停止路由、重复启动、cleanup、旧快照失败关闭 | 通过 |
| P1.8 只读显示 | public-author-display、display-progress、stage-card-history、frontend documentProgress/RightSidebar；输入摘要绑定、aggregate 运行态、8/8 完成停点 | 通过 |
| P1.9 独立测试环境 | detached-runtime 在临时目录仅运行 Author bundle 与冻结 native fixture；Author 全测试树禁止导入旧工作流或生成器 | 通过 |
| P1.10 冻结行为差分 | 71507fb5 冻结样本：8 份请求/提示/依赖、完整 delivery projection 摘要、stop/retry 纯状态差分、正文与回执、重复发布及恢复窗口 | 通过 |
| P1.11 依赖与替换 | production import 边界、真实 bundle 传递依赖、packages/apps 生产消费者 TypeScript 解析检查；app public port 替换测试 | 通过 |
| P1.12 基础模块接入 | auth/public、runtime-configuration/public、billing/public、host、usage-journal 与真实 public 离线集成；续期仍在权威、partial record/debit 重放 | 通过；权威既有缺口另列 |

### 必须保留的兼容结论

1. 冻结旧文档 transport 明确拒绝 resumeWorkerSessionId。新 Author 不传入历史 session ID 不是新增回归；显式重试使用新的 dispatch，已接受文档不重跑。
2. 非空历史 Author 快照不自动迁移或接续到新模块。历史 Reviewer/Revision/Checklist 路径的兼容检查仍保留。
3. 非空但格式不完整的 Markdown 仍可被 Author 接纳，格式/内容审查属于下游 Reviewer；没有把这项验收转变为作者自审。
4. [BILLING-001 与 AUTHCONFIG-001](stage-isolation-known-issues-2026-09-06.md) 按用户决定延后。阶段 outbox 幂等不等于修复数据库同键异 payload；无 token 本地模式不新增免鉴权旁路。

## 清理动作

用户授权隔离后清理。首次批量删除因引用尚未解除被审查拦截，未执行；随后先移除 document-stage 的 Foundation 入口、迁移测试、扫描引用并通过相关回归。TypeScript 解析确认以下删除集合不存在集合外 import/re-export 后再删除。

删除 11 个文件：

- 旧 delivery-workflow/foundation-authoring-stage.ts、scheduler.ts、boundary.ts、context.ts。
- 旧 foundation-authoring-scheduler.test.ts、__tests__/idea-to-complete-documents.test.ts。
- 新 Author private/domain 内未使用的 index.ts、foundation-authoring-boundary.ts、foundation-authoring-context.ts、foundation-authoring-scheduler.ts。
- 已明确废弃的 docs/workflow-stage-module-design-2026-09-05.md（共享执行内核方案）。

其他清理：

- 共享 document-stage 只保留 Checklist 启动/完成，显式拒绝 Foundation 完成请求，不再导出 startDocumentStage。
- 旧 context 包装层的三项测试随包装层退役；新 public/contract 测试验证完整输入白名单、身份和防变异边界。
- 两项原“idea 到八文档”测试迁至 Author 私有 domain，以冻结样本验证八文档提交与格式问题留给 Reviewer 的既有行为。
- 保留的作者合同投影测试改为固定摘要/提示样本；Author 测试和 native fixture 不运行时导入旧文档生成器。

恢复副本：/tmp/beegame-author-cleanup.hHmaFw，保留被删除文件的原相对目录。原有受版本控制文件也可从 Git 历史恢复。没有清理用户项目、文档产物、数据库或既有运行数据。

### 明确保留，不作为冗余删除

- accepted-unit-journal 和 schema 的通用／下游功能保留；原共享 foundation-authoring-state/batch/recovery 已在追加退役中删除，作者接纳逻辑仅留在私有模块。
- authored-document-receipt 仅保留历史读取、Checklist／Revision 元数据及其写入辅助函数；全局作者 commit/reconcile、输入投影／契约和流写入接口已删除。通用及修订 worker transport/prompt 不属于旧作者冗余。
- Reviewer 的已提取适配代码与冻结源码 oracle：用于后续 P2 隔离和保护既有行为，不等同于废弃设计稿。
- 冻结基线和验收证据：它们不进入 Author 生产运行包，删除会损失后续等价验证依据。

## 最终验证

清理后最终后端联合回归 **851 passed / 0 failed，92 文件，8677 assertions**；前端 **28 passed / 0 failed**。最后将共享完成入口收紧为必须显式声明 checklist 后，另行复测 document-author-boundary 与 controller-public-author：**9 passed / 0 failed，40 assertions**。全仓 `tsc --noEmit` 和 `git diff --check` 通过。

下一阶段为 P2 Reviewer 的完整模块隔离；本轮不自动启动任何暂停项目的 Reviewer。

## P1-R 追加退役完成（2026-09-06）

- 已删除共享旧作者 state/batch/recovery、prompt/delivery-contract、input/authority-projection/contract、Markdown stream 及其旧测试；有价值的输入、流与回执用例迁到 Author 私有域，采用本域冻结夹具，不从全局旧实现取能力。
- session-manager/native runner 不再接收旧作者流 contract；共享 worker port 在凭据、会话、文件操作前拒绝旧作者请求，只接受显式 Checklist 文档请求。Revision 的流接口保持。
- accepted-unit-journal 不再产生逐文档作者接纳记录；恢复不再补写／重放旧作者回执；历史文档只读证明与 Reviewer handoff 元数据分离。路由继续／重试测试走公共 Author；旧运行恢复测试断言拒绝且快照／事件不变。
- 全局作者回执写入／reconcile 删除前，对 1573 个 TS 文件检查 import/re-export；确认无外部调用。Revision 的同名 syncFile 是另一模块的局部函数，不是被删接口。保留的 15 个读取／元数据／持久化辅助函数与 HEAD 逐字一致，并新增哈希保护测试。Reviewer 四个共享生命周期文件仍使用完整基线差分检查，仅按逐段精确 Author 变更恢复，不豁免整块 Reviewer 源码。
- 新增八路径 × 初始／并行 × 恢复操作矩阵，以及未消费旧暂停控制的拒绝矩阵；零 worker 联系、run.json／events／文档／回执保持。新增旧模块缺席与静态 import/re-export 守卫。
- 最终联合回归：983 passed / 0 failed，105 文件、9703 assertions；前端 Vitest 28/28。全仓及后端 tsc --noEmit、git diff --check 通过。定向 Reviewer／恢复回归 114/114；旧模块缺席／拒绝边界守卫 6/6、512 assertions。
- **最后切除**：controller 的旧暂停 handoff 与自动重置体、run-store 自动生成 pause_changed 消费事件、recovery-projector 的旧暂停／作者阶段重建、foundation-audit-boundary 的旧 pause reader/helper。restartDocumentStage 仅剩明确抛错，不再执行任何重置；Reviewer 推导检查点使用 DOCUMENT_REVIEW / FOUNDATION_REVIEW，不复活旧 Author 阶段。
- 授权与审查：此前两次拒绝时未应用；本轮用户在明确剩余范围后回复“OK 那就切除吧”，精确补丁获准并执行。完整共享源码差分按逐段精确删除恢复，不豁免 Reviewer 逻辑。旧暂停自动消费的测试已迁成历史记录不被自动消费且旧运行仍被拒绝的测试。P1-R 完成；本轮没有推进 P2。
- 追加退役删除文件可从 /tmp/beegame-author-retirement.6fq5ne 的 beegame、server-tests 副本恢复；受版本控制内容也可从 Git 恢复。未清理用户项目产物、数据库或运行数据，未执行 Git 提交。
