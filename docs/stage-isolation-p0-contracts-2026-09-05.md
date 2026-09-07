# P0 三模块公开契约与实施边界

日期：2026-09-05
关联：[主计划](independent-stage-programs-plan-2026-09-05.md)、[基线清点](stage-isolation-p0-baseline-2026-09-05.md)
状态：主审后的实施接口约束；实现尚未完成。

## 1. 目录与依赖

新模块放置于 packages/agent-workflow-server/src/beegame/stage-modules/：
foundation-authoring、foundation-reviewer、foundation-revision 各拥有 public.ts 与 private/。
没有 stage-modules/shared，没有公共父类/dispatcher/store。现有 delivery-workflow 只在接线时消费 public 入口。
新阶段的 production imports 可进入本模块、语言/第三方依赖及明确批准的基础模块 public 入口。认证、计费各有单一所有者，禁止阶段导入它们的 private 实现，也禁止导入旧 beegame workflow/session 执行实现。
允许从基线复制必要实现并收窄为本模块私有代码；测试对照基线，不保留新旧运行时任选路径。

内置 native 模型执行进程作为既有外部执行端使用，不修改它的业务和模型；作者拥有自己的命令构造、流式协议、模型会话状态、文档工具范围、正文/回执提交及用量采集。登录身份、凭证续期、统一权限、价格和扣费归认证/计费模块，不迁入作者。
宿主传入实际执行配置，并通过基础模块的正式 public 入口或类型受限客户端接入认证、计费；不注入 session-manager、worker port、全局 RunStore、任意业务回调或事件驱动器。后续阶段不 import 作者 runtime，但可以消费同一认证、计费模块的公开契约。
不得用“允许外部执行端”将旧工作流 HTTP 接口或内部 session-manager 代理为外部服务。

## 2. 公共运行接口

各阶段独立拥有阶段业务执行代码。基础能力通过其所有者的公开契约复用，不复制实现。
阶段 public 工厂接收配置数据及必要的正式基础模块依赖，返回 start/resume/stop/getResult 方法；不存在公开的 admitWorkerTerminal、persistTask、scheduleNext 等内部控制接口。2026-09-06 作者工厂已要求 owner-bound runtime-configuration 与 billing public 客户端，运行配置模块委托 auth public 客户端；离线接线通过，现有 app 编排尚未切换。

配置数据：
- 模块工作根及项目输出根；
- 模型进程命令、provider/model/env 由运行配置模块按既有规则解析；作者工厂不接受绕过该客户端的原始 model/env；
- 安全身份、不透明认证引用、语言；refresh token 保留在认证模块，不作为阶段私有持久化输入；
- 认证/计费客户端只允许调用其公开认证、授权、用量提交/查询能力，不能包含阶段调度、persistTask 或原始 worker 回调；
- 不接受测试 runner 或 clock 作为生产公开参数；测试注入仅在本模块 private 测试入口进行。

start：
- protocolVersion、requestId、ownerId、projectId；
- 输入数据及 inputDigest（按本模块 canonical 编码验证）；
- 返回 handle：不可解析为内部任务的运行身份。
- 同 requestId 和相同输入返回同 handle；同 requestId 不同输入拒绝，不启动第二次。
- 返回 handle 不代表业务成功，模块自己后台推进整个阶段。

resume：
- handle、requestId；显式恢复 stopped/needs_action 的规则在模块内执行。
- 不暴露要恢复哪个文档或 worker。模块可按原规则恢复本阶段可继续任务。
- 重复请求幂等。completed 返回同最终结果；失败的输入身份不可被 resume 替换。

stop：
- handle、requestId、reason。
- 模块先写私有停止意图，拒绝新内部派发，再停止本模块在途执行并提交检查点。
- worker 晚到结果不能重新开启阶段。公开确认只含停止结果，不返回内部 checkpoint。

getResult：
- handle。
- running：必要的粗粒度状态，最终业务结果尚不存在。
- stopped：已确认停止，允许按原规则继续。
- needs_action：可读原因与是否支持显式继续；不外泄内部任务。
- failed：技术/不可继续错误的公开诊断；不能被编排改写为成功。
- completed：不可变 resultId、inputDigest 与本模块最终结果。
这里的 completed 是一次模块调用结束，不等于业务 passed；Reviewer issues_found 也是完整审计结果。

2026-09-07 Revision 状态适用条件确认：用户同意保留现有行为，不为补标签新增不可恢复状态。上述 `failed` 仅在模块确有不可恢复终态时适用，不要求凭空制造可达分支；Revision 当前配置、执行、发布及计费故障按既有规则返回 `needs_action`，在安全条件满足后允许显式续行。未知关闭权威返回 `needs_action(resumable: false)`，无效调用或无法可信读取/校验的持久证据返回净化异常；均不得被编排改写为成功。Revision 当前 public 类型与上述实际可达状态保持一致，不添加从不返回的 `failed` 成员作为虚假行为证据。未来如引入不可恢复终态，须同时定义诊断、resume 规则及契约测试，不能据此扩大为本轮恢复机制。

所有 public 值在输入接收和输出返回时深复制/白名单验证；内存句柄与持久化句柄恢复都不能借用外部 store。

上述复制要求针对业务数据；正式基础模块客户端按明确接口校验，不作为业务结果返回或序列化到阶段 checkpoint。用量提交包含稳定事件 ID、业务归属、模型/用量事实和必要版本；同 ID 同事实重放必须幂等，同 ID 异事实必须拒绝。阶段保存自己的提交确认以便重放，计费模块保存去重账本并拥有最终计价、扣费判断。认证或计费失败不得伪装成功或静默绕过，保持既有处理语义并补契约测试。
私有路径按模块、owner/project、运行身份隔离；不通过未验证路径片段拼接。
日志不得包含 env 凭证、私有模型请求原文或其他模块状态。

## 3. 八文档契约

输入：确认简报正文、简报摘要、项目身份；可选的已授权 change request 维持现有规则。不得传入全局 foundationDraftState。
初始 GDD 与其他七文档的依赖、并发、输入选择和提示在模块内部按基线运行。

输出 foundation_documents：
- protocolVersion、resultId、producer=foundation-authoring；
- 项目身份、confirmedBriefDigest；
- 八个规范文档的相对路径、digest、byteLength；
- documentRevision、workspaceRevision 及不可变产物引用；
- 完成依据：模块已验证并提交的文档回执集合的摘要，不导出可操作的内部 dispatch 或 checkpoint。

成功发布前必须确认八份文档实际完成且回执/正文绑定一致。原最终 readiness 检查完整保留，不能添加 Reviewer 的内容审计。
只读导出者为作者模块 private publication；公开输出来自模块，不由 controller 检查 completedPaths 拼装。

冻结验收样本由已有已提交作者测试样本和临时目录生成的固定 worker 输出构成。正式真实样本目录及摘要另行记录后才可用于真实闭环，不以源码基线代替文档基线，不读取或恢复暂停项目。

## 4. Reviewer 与 Revision 数据交接

文档输入引用必须自洽：内容版本/摘要/可读文件，以及必要简报权威。引用解析不访问作者状态。
Reviewer 仅发布完整的 passed、issues_found、needs_action 或 failed 结果，不发布 index_staged/review-ready 这类内部推进状态。

Reviewer issues_found 输出：
- 审计对象完整文档绑定、reviewResultId、规则/契约版本；
- 问题 ID、原始证据和位置、实际/预期、允许修改范围；
- Revision 理解问题所需的最小事实证据切片及摘要；不传整个 FactStore/审计任务集合。
- 不生成 Revision batches、内部任务 ID 或执行策略。Revision 自行依据问题规划。

Revision 输入：
- 上述文档和 Reviewer 结果（摘要必须匹配）；
- 后续继续修复可携带上一候选和该候选的复核结果，不接收 Reviewer 私有 state。
Revision 自己规划文档/章节批次，自己生成候选身份。

Revision candidate_ready 输出：
- revisionResultId、baseDocumentsDigest、sourceReviewResultId/摘要；
- candidateId、候选文档全集/摘要、相对产物引用；
- 修改文档/章节和操作、逐项修复声明/未解决事项；
- 原基础与上一候选绑定；不可伪造审计通过或 resulting issue registry。

Reviewer recheck 输入：
- 指定 candidateId/摘要、基础文档和源问题结果；
- 变更事实/差异及上次复核公共结果（如有）。
Reviewer 自行重建必要 section index/facts 并复核；不能信任 Revision 的 repaired 声明作为 PASS。
Reviewer 输出新的问题权威及通过/剩余问题结论，绑定同一候选。

旧业务映射：
- 同轮文档失败→复核问题作为同一基础候选的继续修复输入；
- 已通过部分→保留候选字节/摘要并通过公开证据声明，Revision 自行决定自己的冻结状态；
- 新问题→Reviewer 新问题权威，不由 Revision publication 创建；
- 最终通过→编排交接通过版本；canonical 路径兼容复制只是产物映射。
具体问题 ID、轮次与终态计量等价由 P2/P3 固定 fixture 差分证明，不能用全局旧事务顺序作为唯一标准。

## 5. 现有编排与作者第一阶段接线

P1 接线后作者阶段只调用 public API，不能将 private persist/onTerminal/replay 回调交回 controller。
旧 controller 中作者专属终态/调度/继续分支不再运行；不把旧分支留作 fallback。
P1 作者完成后保留公开结果，编排处于交接停点。只有三模块分别验收、P4 接通后才可调用新 Reviewer；不会同时启动旧 Reviewer。

编排链路记录只含：requestId、stage、handle、inputDigest、resultId、目标阶段调用身份和停止意图。
终态先模块持久化、再被编排确认；编排崩溃后查询旧 handle，不能新造调用身份重复启动。
启动确认丢失使用同 requestId 重试；同 ID 输入不一致拒绝。
整链停止先记录停止意图，随后调用模块 stop；结果可以保存，但未显式继续不得启动下游。

## 6. 历史与半成品处置

现有暂停项目和旧快照不自动迁移、不恢复。历史数据继续只读可见。
新模块只使用自己命名空间的新运行。后续旧项目迁移需通过显式导出/导入协议，不把旧 DeliveryRun 直接作为新模块输入。
共享半接线修改保持原样到对应接线审查；在替代相关行前核对完整差分。未跟踪文件不静默删除。
新模块离线验证不需要启动现有全局服务，也不把未完成的共享层测试结果当成新模块失败或通过证据。

## 7. 主审纠偏记录

- 子审建议中的 Review 输出 review-ready 过度暴露内部阶段，改为最终结果。
- 子审建议中的上游传 batches/candidateId 会把修订规划权放到外部，改由 Revision 生成。
- 作者 runtime 不能直接 import native-cli-process-runner 或 session-manager；所需进程协议须作者自有实现。
- 作者 legacy serial 拒绝、失联会话和停止尝试语义按基线保留，不借迁移删除。
- P0 架构约束可进入实现；未完成的接口样例/测试和实际隔离必须逐项验收，不勾选整个 P0 或 P1。
