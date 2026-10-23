# P4.5 真实验收：目录发布与实际读面已修正

日期：2026-09-07。工作分支 `codex/game-ir-isolation-recovery`；本轮修改未提交、未部署。

## 结论

**目录发布缺口现已补齐，并按真实文件重新验收。** 此前第三轮只切换快照、改变预览／ZIP 读源而未更新 docs，收口结论已撤回；此次按用户要求由应用层发布已通过的原始字节，预览和 ZIP 均回读项目文件。磁盘八文档、批准结果、Chrome 预览及新下载 ZIP 已核验一致，详见末尾目录发布纠正记录。Reviewer 的审核及计费证据未改动，没有重新启动模型阶段；P5 不启动。

此前曾撤回 P4 完成结论：第二轮真实执行闭环成立，但候选版本仍为 1.0.0、前端读面仍是初稿。本轮通过新的候选与复审修复，首次和第二次历史字节均未修改或补签；以下按执行顺序保留证据。

用户追加授权从头运行、通过 Chrome 操作，并明确本轮 Credit 不设上限；范围仍止于 Checklist 前，不推进 P5。原计划“不重跑八文档”在本次被该追加授权覆盖；已经生成的八文档应保留，后续不因本轮中断自动再生成。

## 本次输入与证据位置

- 新项目：`coin-catch-60s--770a76fe983d`，需求为小型单机接金币游戏，Web / React / 2D / 极简；无联网、排行榜、支付或外部素材需求。
- 项目目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/coin-catch-60s--770a76fe983d`。
- 编排记录：项目下 `.beegame/workflow/run.json` 和 `.beegame/workflow/events.jsonl`。
- runId：`183d0eaa-a6eb-4c1d-9ac1-a733fc934e84`。
- 作者公开 resultId：`b7a8cd53fc3a7101daf429bdb858f88108a6f07de93c9e2dfccdb64fd3b055b1`。
- 冻结初稿：项目下 `.beegame/workflow/foundation-authoring/artifacts/<resultId>/docs/`。八份合计 257586 bytes；逐份实际字节长度及 SHA-256 与作者公开结果一致，8/8 校验通过。
- Reviewer handle：`bf492998-6621-44cb-af33-c6cb099039e2`。公开请求与当前 outcome 保存在编排交接记录，初始输入包含完整冻结文档。
- Reviewer journal 目录标识：`622c32de752469ca3939cbca3d167623a015c439fd7702e8d8cac1b75378b6d7`；只读诊断，没有手工修改、删锁或接管。
- 本次 native 会话日志位于该账号 `.runtime/app/projects/` 内包含新项目名的目录。日志是诊断证据，不替代 Reviewer 正式接纳、关闭回执或计费权威。

## 时间线与真实结果

以下为北京时间：

1. 05:28:01 新运行启动。
2. 05:47:33 作者公开完成；八份文档均有 committed 回执，耗时约 19 分 32 秒。同一编排随后自动提交 Reviewer 请求。
3. 05:56:22 前八个事实任务已接纳；随后认领四个语义任务。
4. 约 05:58，native 会话日志已出现语义 StructuredOutput 成功回执和结束回复，但阶段未接纳对应终态。
5. 本地出现大量不变/零增量用量事件积压。诊断时后端 CPU 约 82.7%，每条语义用量事件持久化间隔约十秒，模型 worker 已很少占用 CPU。原实现对每个流式帧无条件调用持久化计量回调；这解释了终态处理延迟，不能据此断言所有性能问题已解决。
6. 旧运行最后正常观测记录为 06:54:53。07:54 后检查发现本地前后端、相关辅助服务及四个已知语义 worker 进程均已退出；具体退出原因未建立，不能宣称正常关闭或归因为已证实的崩溃。
7. 最初页面停止请求未落入运行记录。恢复服务、修正 Projects 根目录后，再经页面公开停止入口记录意图，最终 outcome 为 `needs_action`、`resumable: false`、`billingStatus: pending`，原因是旧执行 owner 丢失、缺少恢复证据。没有再次点击重试，没有启动接管。

计量限制：没有取得本次 Reviewer 的最终结清用量；不能把反复出现的零增量事件解释为模型零消耗。未手工补扣费、伪造结清或给出未经权威确认的总 Token / Credit。原始 native 会话与待结清记录保留用于后续核对。

## 本轮修补及离线验证

1. **完成文档展示丢失**：Reviewer/Revision 当前任务覆盖作者任务后，交付物面板原来显示 0/8。新增独立 `foundationDocuments` 展示摘要，仅来自校验后的作者公开完成结果；前端只保留 canonical path 和 ready 状态，不暴露私有字段，不把已生成误作审核通过。当前阶段仍只展示自身任务。
2. **重复用量事件积压**：Reviewer native 适配器只在观测到计量字段、且完整用量快照改变时等待持久化回调。首次观测到的零仍保留；真实计量变化和终态前的写入屏障仍保留。未改变审核规则、恢复权威、计费客户端或 stale-owner 机制。新增大量 keep-alive、正文增量及重复计量快照的固定进程测试。
3. 启动修正：前端最初漏载已有公开登录配置，已纠正；服务恢复时临时工作区与实际账号项目路径不兼容，改回实际 Projects 根目录，未放宽路径校验。

验证结果：

| 检查 | 结果 |
| --- | --- |
| Reviewer 完整离线模块回归 | 335 pass / 0 fail，57 文件，3735 assertions，228.56 秒 |
| native worker 专项（包含重复流式事件） | 14 pass / 0 fail；包含在上述完整回归内，不相加 |
| app 公开作者/审核路由 | 6 pass / 0 fail |
| 前端文档进度与展示模型 | 19 pass / 0 fail |
| 后端 typecheck、前端 tsconfig.app noEmit | 均通过 |
| git diff --check | 通过 |

Chrome 在服务恢复后显示八份交付物和“需要处理”。上述代码修补尚未经新的完整真实审核验证；旧运行不能因源码已修补就被标记恢复成功。

## 后续边界

保留旧运行及未结清证据，不修改私有状态，不推断遗留进程关闭权威，不自动重试 `resumable: false`。要完成 P4.5，需要确定下一次独立冻结副本验收的公开入口及旧计量处理方式；不能通过伪造作者检查点、删除执行锁或新增第二套生产启动器绕过停点。P5 不在本轮范围。

## 第二次独立验收：公开冻结副本（执行通过，发布验收结论已撤回）

用户随后明确批准移除审核副本入口的旧逻辑，并接受旧运行只保留为归档证据、新运行使用 schema 51；旧 schema 50 不迁移、不恢复执行。旧运行及待结清状态未改写。

既有 `/api/projects/:id/review-copy` 已替换：只读取并校验 completed Author 公开结果和其显式导出；保留原始来源 owner/project/resultId，复制冻结字节到独立目录；新 Reviewer 请求绑定新 projectId 并重算公开 inputDigest。新运行没有 `authorStage`、旧作者检查点或旧 Reviewer 私有执行状态，停止/继续均经过公开端口。启动结果不明时保留新项目证据，不执行破坏性清理。没有新增第二套启动器。

本次新增/受影响离线检查：副本 helper 4 项、路由 4 项、公开交接 11 项、公开作者/展示/退役/schema/controller 22 项，合计 41 pass / 0 fail；后端 typecheck、diff check 通过。路由测试包含 schema 50 公开来源、独立启动、8/8 展示、stop/resume、旧快照拒绝、模糊启动后保留证据。

08:30:36（北京时间）从 Chrome 历史项目菜单“创建审查副本”启动第二次真实验收：

- 项目目录：`/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/Projects/users/30fb0202-1f77-414f-82da-f92936e7bba3/review-copy--c9a2f1d4-07d4-40fa-98a7-27169df3019c`。
- 新 projectId：`c9a2f1d4-07d4-40fa-98a7-27169df3019c`。
- 新 runId：`d0a1e1b0-99ea-4e2d-92b5-2cab74a1447e`。
- Reviewer handle：`54a9101d-44ea-450b-9fad-1ab8b65cd58a`。
- 初始 inputDigest：`1975054663181f3b5951a8e4240734af3cdb48af4e89ec7467996b6321747ac0`。
- 来源 resultId 与首次运行一致；八份冻结导出在启动前再次校验通过，Chrome 显示 8/8、Reviewer 执行中。
- 旧 `run.json` 启动前后 SHA-256 均为 `8bf2c08bacdfe10a9de7f72fed8f4613986e44a7aeb11d8ee05c85d53b0eccd0`。

服务替换只终止了经检查无子进程的旧本地后端 PID 15880，避免旧版关闭钩子改写归档；没有终止 worker 或接管旧执行。新后端加载前次 Reviewer 用量去重修复。可选用户 skills 服务未运行，日志明确提示不可用；本轮未修改权限或绕过阶段规则。

### 最终公开结果与停点

08:44:26.596（北京时间）最终复审正式通过。总耗时 **13 分 50.529 秒**，计入公开交接及计费确认等待。新运行 `foundationReviewStage.sequence = 6`，共 4 次 Reviewer、3 次 Revision 调用；没有再次执行 Author。

- 最终 Reviewer handle：`76755582-6746-4990-90e1-623e30421547`。
- `acceptedReview.resultId`：`23cb832bb839d71e711fb3220fdbcea7ae7fda6d25d2dfebfdf55feaf969856f`，`kind = passed`，`issues = []`，`billingStatus = settled`。
- 最终候选 resultId：`a373c8fdb92e6e0ecacf0c042a148a8faaf9a7765f6df36f7db0d960c172cb70`，candidateId：`cb4cd315-b9ef-4a47-8133-fd9f9f3fedd1`，round：2。
- 候选与审核结果的公开 result binding 校验通过；最终八份文档逐份 byteLength/SHA-256 校验通过，候选与 acceptedReview 的 documents 和 documentSetDigest 完全一致。
- 初审得到 5 个问题；第一次复审 4 项 PASS、1 项 FAIL，进入 `retry_same_round`。同轮候选仅 Balance 文档改变，其余七份完整文档与前一候选逐字节一致。随后该轮完成，剩余两项通过 `next_round` 修订与复审，最终通过。
- 运行状态为 `needs_action`，原因精确为 `Foundation review passed. Checklist handoff awaits acceptance.`，这是 P4 约定的验收停点，不是审核失败。`phase = DOCUMENT_REVIEW`、`documentStep = FOUNDATION_REVIEW`，无 activeDispatch、无旧检查点，未产生 Checklist 阶段事件。
- Chrome 显示 8/8 交付物、Reviewer 已审计、任务 1/1；没有提供继续进入 Checklist 的操作。服务没有剩余直接子进程。旧运行文件 SHA-256 在最终复核时仍保持上述值；旧运行的 pending 计费记录未被伪造结清或删除。

### 耗时与已确认计量

各阶段耗时来自编排 `foundation.public_review.handoff` 事件时间；Token/Credit 来自本次新项目阶段持久化的正式 `billing_ack.receipt`，按 `idempotencyKey` 去重，只计每条回执的用量与一份扣费金额，不把 recorded/debited 两部分重复相加。均为 `weighted-v1` / `runtime_snapshot` 计量口径，包含失败后重试的实际用量，不代表 provider 账单另一次核对。

| sequence | 调用 | 交接耗时 | 唯一计费回执 | total_tokens | Credit |
| --- | --- | --- | ---: | ---: | ---: |
| 0 | 初审，5 issues | 5 分 44.626 秒 | 19 | 337207 | 65.7795 |
| 1 | 第 1 轮候选修订 | 2 分 30.083 秒 | 4 | 65318 | 13.1686 |
| 2 | 首次定向复审，要求同轮补修 | 41.191 秒 | 5 | 57389 | 6.1152 |
| 3 | 同轮补修 | 2 分 51.020 秒 | 1 | 25394 | 7.5218 |
| 4 | 同轮复审，完成该轮 | 49.667 秒 | 4 | 49413 | 2.4449 |
| 5 | 第 2 轮修订 | 47.842 秒 | 2 | 28459 | 4.5823 |
| 6 | 最终定向复审通过 | 26.100 秒 | 2 | 22426 | 2.1837 |
| 合计 | 新副本完整闭环 | 13 分 50.529 秒 | 37 | **585606** | **101.7960** |

合计细分：prompt_tokens 320297、completion_tokens 136964、cache_read_tokens 128345、cache_creation_tokens 0；total_tokens 已包含这些缓存 Token，不再另加。上述费用和时间仅属于第二次新副本，不含首次作者生成、首次失败审计或旧 pending 账目。

证据保存在新项目 `.beegame/workflow/run.json`、`events.jsonl` 以及模块原生公开结果、候选和计费回执中；未修改阶段私有状态或放宽审核规则。首次的未知退出与旧账目仍是历史限制，不据第二次成功追溯标记为成功关闭。

## 第三次模型审核与原快照读面验证（目录验收结论曾撤回）

用户确认写入权边界后实现：Revision 私有执行在摘要与回执封存前提升被修文档 patch 版本，更新时间绑定已持久化的 attempt_started；Reviewer 无写入。应用层通过公开结果核对送审字节，原子切换不可变当前快照。项目／活跃会话预览与 ZIP 读取同一当前制品；项目制品读取不再要求旧会话存在。

新增架构对照见 `project-architecture-audit-2026-09-07.md`。本轮未改全局 workflow schema 51，不补签第二轮结果。

离线证据：Revision 全量 216 pass / 0 fail；发布、公开交接、项目路由、会话读取、schema 与 Author 路由合计 42 pass / 0 fail；前端四文件 105 pass。Reviewer 全量 330 pass / 5 因沙箱进程查询限制失败，相关进程身份文件授权只读查询后 6 pass / 0 fail（包含这五项）。后端类型检查与前端自带 TypeScript 类型检查通过。不是全仓测试结论。

Chrome 已实测第二轮无会话副本重新出现八文档预览及下载入口，GDD 显示原始 `version: 1.0.0`，符合历史字节保留要求。随后通过原始项目“创建审查副本”启动第三轮：

- 项目：`review-copy--baa12833-9751-4d48-82a2-14543d22ab30`。
- projectId：`baa12833-9751-4d48-82a2-14543d22ab30`；runId：`f9812a68-8e77-45ba-9f64-e0992a21a323`。
- 创建时间：`2026-09-07T01:30:43.150Z`（北京时间 09:30:43.150）。
- 初始 Reviewer handle：`f5285c55-38ec-4854-970a-a9011477f992`；来源 Author resultId 仍为 `b7a8cd53fc3a7101daf429bdb858f88108a6f07de93c9e2dfccdb64fd3b055b1`；无 Author 执行。
- 首轮原始 run.json SHA-256 仍为 `8bf2c08bacdfe10a9de7f72fed8f4613986e44a7aeb11d8ee05c85d53b0eccd0`；第二轮 run.json SHA-256 在服务切换前后均为 `627b9b4f53891f044832be667b78fec52c69810ba13a42a6b52316ef3ac3c2f0`。

第三轮首审产生 9 个问题，Revision 已生成候选 `9cb7d03e4618709826ef6626f83247198d0629af696a5434be78e50f996471a4`。GDD、Balance、Technical、UI/UX、Asset 五份文档均为 `1.0.1`，其余三份仍为原始 `1.0.0` 与原时间戳。前四份修订时间绑定 `2026-09-07T01:35:36.245Z`，Asset 的独立 attempt 为 `2026-09-07T01:35:57.910Z`。

`2026-09-07T01:37:20.894Z`，序列 2 的候选复审返回 `needs_action`（可显式恢复），handle 为 `e87537f5-7b1c-46c8-a243-de43f1122455`。该复审已接纳 5 个事实提取结果并结算用量，尚未出现语义任务 claim；具体调度原因正在核查。此时没有 `.beegame/artifacts/current.json`，符合“未通过不发布”的边界；Chrome 显示“需要处理／重试”。没有手改真实状态或追溯补签。

随后确认 targeted controller 的 idle-exit race：最后一个事实任务完成后 worker map 已空，主循环仍可能持有旧 phase 快照并提前返回。修复为空闲退出前重新读取持久状态，保留孤立 running dispatch 的失败关闭；相关 controller/lifecycle 14 项通过，其中新增退出判定回归（不是 OS 调度竞态的强制复现）。没有放宽审核规则。重启已无子进程的本次开发后端后，Chrome 正常“重试”在 `2026-09-07T01:52:22.516Z` 恢复原句柄，没有重跑已接纳事实任务。

首轮 9 个问题全部复核 PASS 后，Reviewer 产生 2 个新契约问题，公开交接进入第二轮 Revision；UI/UX 与 Asset 修订后，在 `2026-09-07T01:54:16.456Z` 最终 `passed`，可靠停在 `Foundation review passed. Checklist handoff awaits acceptance.`，P5 未启动。

### 第三轮最终版本与产品读面

| 文档 | 最终版本 | 更新时间 |
| --- | --- | --- |
| GDD、Balance、Technical | 1.0.1 | 2026-09-07T01:35:36.245Z |
| UI/UX、Asset | 1.0.2 | 2026-09-07T01:53:08.389Z |
| Level/Scene、Art、Audio | 1.0.0 | 各自原始时间戳，字节不变 |

- 最终 Revision resultId：`33846b855024cef3d8cf36394008de2aab72fbfd71ee330e0c3897cb11874c90`。
- 通过 Reviewer resultId／current publicationId：`60c31a40a2114d1026baa511358cb7d9ae163d63ad07ea90872a862cdf5d84d4`。
- 当前 snapshotDigest：`a397935726973a1ae591bbe113c8fc9bad290c89b006cd0406fcb225a89acb9c`；通过 documentSetDigest 与 run.revision.document 均为 `7677896c2b9e497d33e37dd36d638013785ada90cb80969693148f1eed038ffb`。
- 核验全部 8 文档的内容、SHA-256 与通过结果完全一致。5 份修订文件的 canonical 初稿仍保留原字节，另外 3 份未改文档完全一致；不是审核后改文件补签。
- Chrome 显示 8 个预览入口，实测 GDD `1.0.1`、UI/UX `1.0.2` 及上述时间戳。
- Chrome 实际下载 `/Users/nswell/Downloads/review-copy--baa12833-9751-4d48-82a2-14543d22ab30.zip`：12673328 字节、300 entries，SHA-256 `d737dcaee44aa64af2a14044a93339f0b35ae6e21cfcfaa5779f67ce6c394d55`。8 文档逐字节等于当前快照，不包含 `.beegame/artifacts`；不据此宣称旧 package 所有私有路径均已整改。
- 完成后再次核验首轮与第二轮 run.json 摘要均与上述基线相同。

补充固定代码回归：Revision 217 pass / 0 fail（52 文件、1521 assertions）；新增 metadata public lifecycle 测试独立放入跨模块 integration 文件，固定输入独立性测试不放宽。应用 store／project routes／session 25 pass / 0 fail；公开交接／接纳映射／Author routes／store 34 pass / 0 fail（两组含重叠 store，不相加）；后端 typecheck 与 diff check 通过。此前前端 105 项与 Reviewer 沙箱限制的记录保留，不宣称全仓本次一次全绿。

### 第三轮真实计费与耗时

按本副本各模块正式 terminal billing receipt 的 `idempotencyKey` 去重，`recorded` 与 `debited` 同一逻辑事件只计一份金额；duplicate 标记不额外加总。38 个派发结算回执均已获得，包含首审失败后重试的实际用量；不包含首轮、第二轮或 Author 生成。口径为应用 `weighted-v1`／`runtime_snapshot`，不是另行核对 provider 发票。

| 阶段 | 去重结算数 | usage Token | weighted Token | Credit | 账本执行窗口 |
| --- | ---: | ---: | ---: | ---: | --- |
| Reviewer seq0 初审 | 19 | 323112 | 588200 | 58.8200 | 01:30:44.712–01:35:31.992（287.280 秒） |
| Revision seq1 第一轮 | 5 | 79508 | 138504 | 13.8504 | 01:35:36.245–01:36:41.384（65.139 秒） |
| Reviewer seq2 定向复审 | 10 | 112578 | 107452 | 10.7452 | 01:36:53.288–01:53:04.895（971.607 秒，含暂停） |
| Revision seq3 第二轮 | 2 | 31648 | 55500 | 5.5500 | 01:53:08.389–01:53:56.522（48.133 秒） |
| Reviewer seq4 定向复审 | 2 | 26550 | 30902 | 3.0902 | 01:54:01.465–01:54:15.843（14.378 秒） |
| 合计 | **38** | **573396** | **920558** | **92.0558** | 整次创建至通过 **23 分 33.306 秒** |

时间均为 2026-09-07 UTC。账本窗口以各模块执行／结算证据界定，不能相加冒充整次墙钟时间，也不是并行 worker 时长之和。seq2 最后一次暂停前 billing ack 为 01:37:19.780，显式 lifecycle_resume 为 01:52:16.005，两者间隔 **896.225 秒**（约 15 分钟），包含诊断与更新本地服务；不算作模型持续执行时间。上文 01:52:22.516 是编排观察到恢复后保存 `running` 的时间，和模块 resume 时间不是同一事件。

## 目录发布纠正：最终文件证据

用户再次核查确认目录 `docs/UI_UX_SPEC.md` 仍为 1.0.0 后，明确要求修正所有相关错误。本次不是重做模型审查，而是纠正发布语义及实际文件。

- 应用发布器现在预检目标文件与授权基线摘要，保存待完成事务，逐文件原子替换、fsync 并核对实际字节后才确认发布。明确检测到不同于原稿／批准字节的编辑时拒绝覆盖；不同发布不能跳过未完成事务。普通失败可显式重放同一事务，未知残留锁仍拒绝接管。不承诺外部文件系统读者看到八文件整组原子切换。
- 快照只保留历史／恢复用途。项目和 session 的预览、索引、ZIP 均读取磁盘，不再覆盖为快照内容；读取前后比较发布代次并检查 pending，拒绝跨发布读取。未使用的旧快照或 current.json 损坏不会替代或掩盖实际文件。
- 补做发布前核验固定 runId、owner/project、通过 resultId 和全部八文档原稿摘要。仅将这次副本的五份修改文档写成已批准字节，三份未改文档保持不变；已有 Author 不可变导出保留原稿。没有改写前两轮项目或阶段审核结果。
- 实际 `docs/UI_UX_SPEC.md` 现在为 **1.0.2**，`updated_at: 2026-09-07T01:53:08.389Z`，SHA-256 为 `f3058640f1026af19501c2ae0a4fd4a3beb55ce0d6cc464a2dadbedf4efe0ffd`。其余实际版本为 GDD／Balance／Technical 1.0.1、Asset 1.0.2、Level／Art／Audio 1.0.0；全部八文件逐字节等于第三轮批准结果。
- 第三轮 run.json 发布前后 SHA-256 均为 `74938a7b4725a3524e0fc4f77046ea6bd64ed84ec044abc047fd216be45e323c`；前两轮摘要仍为本文原基线。`pending/` 为空，`materialization.json` 摘要为 `4f582941031a4724353b6a6e88253b12a8dd8f61506f879f75eb43854ae20343`。
- 后端加载新读面后重新刷新 Chrome，实际 UI 文档预览显示 1.0.2。重新下载的 `/Users/nswell/Downloads/review-copy--baa12833-9751-4d48-82a2-14543d22ab30 (1).zip` 包含 300 entries、12673328 字节；八文档逐字节等于磁盘文件和批准结果。SHA-256 仍为 `d737dcaee44aa64af2a14044a93339f0b35ae6e21cfcfaa5779f67ce6c394d55`，因为旧 ZIP 虽内容正确却来自错误读源；本次同时验证了实际目录，不能只凭 ZIP 摘要判断发布完成。
- 最终六文件联合回归 **54 pass / 0 fail，325 assertions，26.14 秒**：覆盖 store、项目路由、直接 session 读面、应用接纳映射、公开交接及 Author 路由。含旧快照迁移、原稿冲突、真实读取跨完整发布拒绝、合成部分写入后重放和未知锁拒绝等测试。类型检查与 diff check 通过；不是全仓测试结论。

本次未重新运行 Author／Reviewer／Revision，应用模型费用未增加。仍停在 Checklist 前，未提交、未部署；平台解耦及其他既有范围外缺口不因此宣称完成。
