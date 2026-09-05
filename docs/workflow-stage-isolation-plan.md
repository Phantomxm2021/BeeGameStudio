# 工作流阶段业务隔离实施计划

## 目标与当前事实

每个阶段独立拥有业务规则、内部调度、状态变更、提交及恢复策略。全局编排器只处理阶段交接与通用运行生命周期；基础传输、锁、存储连接、日志、计量允许共享，不复制多套基础设施。

当前已有未提交的生成质量调整，作为本次拆分的行为起点保留；原 Stage 3/4 行为基线为 `dffad4194`。本计划不再同时改变生成质量策略，避免无法区分优化与重构引发的问题。

当前仍共享 controller、dispatch、transition、recovery、worker 会话入口、状态存储及交接契约。仅提示与投影抽文件不构成完整阶段隔离。

## 冻结项

- 八文档 raw Markdown 交付方式、路径、章节标识、版本规则。
- Reviewer / Revision 的规则、Issue、复核、发布与循环语义。
- Checklist、资源、Game IR、实现及验收阶段的业务行为。
- 模型、并发数、重试策略、计量规则，不借拆分重新设计。
- 旧项目保持 stopped；不删除产物，不重写旧任务的输入证据。

## 阶段边界

| 所有者 | 责任 |
| --- | --- |
| Stage 2 | author 依赖与提示、内部调度、生成终态、文档回执、暂停/继续/恢复规则 |
| Stage 3 | 只消费已交付文档，产生审计结果；不读取生成私有状态 |
| Stage 4 | 消费授权问题与文档，修订并交回复核；不调用生成实现 |
| 全局编排 | 选择下一阶段，路由阶段事件，执行用户停止与整体生命周期 |
| 公共基础设施 | 传输、持久化、锁、日志、计量；不得决定业务重试或阶段合格条件 |

阶段之间只通过明确的交付物与结果交接。交接契约属于公共协议，不能作为 Stage 2 私有配置任意修改。文档内容变化可以改变审计结果；这里不承诺不同文档获得相同结果，也不宣称同进程具有物理故障隔离。

## 顺序与完成标准

### A. 拆出 Stage 2 业务执行与调度（首先实施）

1. 从混合 document-stage 中迁出生成 start/complete；Checklist 使用单独入口。
2. 公共文件最多保留明确的路由，不复制或保留旧业务实现。
3. controller 中 author 的终态重放、活跃会话检测、缺失会话处理、补位调度迁至 Stage 2 调度模块。注入通用 replay、isOpen、persist 能力，不依赖 controller 反向调用。
4. 保持交接行为及持久化结构不变。阶段间转换尚在公共适配器的，明确记录，不称完整隔离。
5. 增加私有模块阶段守卫、调度恢复单测及非 Stage 2 回归。

### B. 收拢状态、提交与恢复（A 验证后实施）

1. 清点 dispatch / transition / recovery / recovery-projector / worker 会话入口中的 author 分支。
2. 将 author 专有判定、状态更新和恢复证据校验迁至 Stage 2；公共层只执行其返回的动作。
3. Stage 2 输入类型仅暴露本阶段状态、身份及公共能力；输出只包含本阶段状态与交付结果，不允许直接改写 foundationAuditState 等其他阶段字段。
4. 磁盘中的 run envelope 可暂时保持现有 schema，由边界适配器读写，不能让私有模块直接依赖完整 DeliveryRun。若确需更改磁盘协议，另列迁移方案，不悄悄加兼容执行路径。
5. 清空旧位置的 author 业务分支，并测试停止、继续、重放、服务重启、并行兄弟任务异常。

### C. 交接与真实验收

1. 单测证明 Stage 2 对非生成输入拒绝执行，不能写其他阶段状态。
2. 同一冻结文档包验证 Reviewer/Revision 行为不变；生成模块变化不改变审计契约摘要。
3. 新项目 Chrome 跑 Idea 到八文档；验证有可靠的阶段结束停止方式后才启动，不能靠观察页面碰运气拦截 Reviewer。
4. 审查八份产物质量、Token、耗时及重试；不新增任意硬上限。
5. A、B、C 全部通过，才可称 Stage 2 业务隔离完成。随后才规划 Stage 3、Stage 4 的内部拆分。

## 防止过度设计

不建立插件框架、通用策略引擎、动态阶段注册中心、新消息总线或每阶段独立服务。先使用显式函数接口与少量模块。不得复制 controller/transport，也不得保留新旧两套业务选择开关。

## 审计与回归

允许 controller 的 Stage 2 业务区变为委托调用；不能为迁移而删除冻结检查。冻结检查改为验证所有非 Stage 2 区域，以及审计/修订专属函数保持基线；并辅以既有集成测试，而不是只测函数名。

验收记录分别标明：职责迁移、状态隔离、离线回归、Chrome 实测。没有完成的明确列为未完成，不用“已经隔离”概括局部结果。

## 当前进度

- 计划及代码依赖清点完成。
- A：已完成首轮迁移与回归。
- B：状态与恢复职责迁移及离线回归完成；磁盘协议保持不变。
- C：尚未完成 Chrome 真实验收，不宣称整体隔离验收通过。

### A 实施记录（2026-09-05）

- 新增 `foundation-authoring-stage.ts`，唯一拥有八文档 start/complete 实现；原 `document-stage.ts` 保留 Checklist 实现及入口路由，不留第二份 author 业务。
- 新增 `foundation-authoring-scheduler.ts`，承接 author 终态重放、会话可用性检查、缺失会话失败处理及补位。controller 原业务块删除，替换为委托调用。
- `document-publication-protocol.ts` 承接共同的文档版本/元数据协议及现有 readiness 适配，未复制数据库或传输。
- 隔离测试只允许 controller 中这一处 author 调度块及 import 变化，将委托替换回基线后要求整个文件逐字一致。审计与修订冻结检查没有删除。
- 新增5项阶段守卫与调度测试；扩大回归801项通过、0失败；类型检查及 diff 检查通过。

当时残留（已由下述 B 迁移处理）：新 author 执行模块仍接收完整 DeliveryRun；阶段交接仍返回既有 run 更新；dispatch/transition/recovery 中仍有 author 状态分支。旧项目保持 stopped，未启动 Chrome 或模型生成验收。

### B 实施记录（2026-09-05）

- `foundation-authoring-context.ts` 显式投影生成可见字段；嵌套状态复制，回写字段逐项限定，不接受审计、资源或实现状态写入。`foundation-authoring-boundary.ts` 负责全局 run 与私有上下文适配。
- author 执行及内部调度不再接收完整 DeliveryRun；`foundation-authoring-state.ts` 唯一拥有 author dispatch 状态、停止、重试、回执提交判定与交接检查点计算。
- `foundation-authoring-recovery.ts` 唯一拥有 author 活跃单元证据、回执恢复及历史提交证明校验；旧公共位置改为调用，不保留第二套业务实现。
- dispatch、transition、recovery、recovery-projector、accepted-unit-journal、run-store 仍承担公共生命周期、日志与存储适配，不复制传输或修改计量规则。
- controller 冻结检查仅允许生成调度、author dispatch 查找、交接检查点三处委托及对应 import；还原这些适配后，其他代码必须与基线逐字相同。Reviewer/Revision 专属规则及非 author worker 提示保持冻结检查。
- 新增状态投影、越阶段写入保护、停止/重试与并行兄弟任务保持、恢复证据拒绝测试；新增核心业务模块依赖检查。
- 最终扩大回归：84 个测试文件，811 pass / 0 fail，4199 次断言；`bun run typecheck` 与 `git diff --check` 通过。测试使用本地模拟及临时工作区，不代表 Chrome 实际模型验收。
- 未新增 UI、模型输出格式、限制或兼容执行开关；未重启服务、旧项目或模型验收。

剩余边界：全局阶段选择、运行生命周期、磁盘 envelope 和基础设施仍共享；Stage 3 与 Stage 4 内部拆分尚未实施。B 是业务状态与恢复职责迁移，不是进程隔离或所有阶段零共享。C 仍须验证可靠的八文档结束停止方式，再运行新项目 Chrome 验收。

### C 前置核查（2026-09-05）

- 当前没有预设的“第八份文档提交后暂停并等待人工调度”阶段停点。author terminal 进入八文档就绪状态后，controller 会直接调用 `deriveFoundationAudit`；恢复路径也会在无审计状态且检查点齐全时自动派生审计。此行为不等同于可靠的阶段交接暂停。
- 新增 `foundation-authoring-handoff-equivalence.test.ts`，用 `git show dffad4194` 动态加载可信基线，覆盖 `completedPaths` 的 0/部分/全部、缺失与重排，以及 `documents` 检查点的空/部分/全部/重排/混合状态组合；当前 `canStartFoundationAudit` 与基线输出一致（3 tests, 44 assertions, 0 failures）。这只证明 readiness predicate 与 author handoff 适配等价，不证明冻结文档包的 Reviewer/Revision 业务行为等价。
- 同一测试证明 `authorHandoffCheckpoints` 只暴露 `path` 与 `status`，且返回检查点对象不与 author 私有状态共享引用。该结果是离线交接证据，不代表 Chrome 或真实模型验收通过。
- 因尚无可靠的阶段结束停止方式，本轮未启动 Chrome、服务或模型；旧项目 `mushroom-tower-forest-defense--9829cee82e46` 保持 stopped。

### C 停点实施记录（2026-09-05）

- 经单独批准，为新验收项目提供一次性全局交接停点：创建新 run 时仅当 `BEEGAME_FOUNDATION_AUTHORING_PAUSE_PROJECT_ID` 精确匹配 project ID 才在 `run.created` journal 写入 `foundationAuthoringPause: requested`；既有 run 不追补，DeliveryRun/schema 保持 48 且不增加字段。
- 八份 Foundation 文档均 committed 且尚无 `foundationAuditState` 时，Stage 2 交接边界把意图提升为 `reached`，复用 `stopped`，保持在 `DOCUMENT_DRAFTING / FOUNDATION_DRAFTING`；Reviewer/Revision 业务未改。
- 后续状态仅由 `foundation.authoring.pause_changed` WAL 事件记录 reached/null（null 表示显式消费），恢复投影只读该 journal；显式 retry/resume 仅消费一次 reached，requested 中途停止继续保留。快照不携带暂停标记，不建立兼容回退分支。
- 离线覆盖启动前持久化、controller 三处 derive guard、stale resume/ensureProgress、retry 消费、run-store journal、recovery projector 及冻结隔离检查；未启动服务或模型，旧项目保持 stopped。Chrome 真实验收仍未完成。
