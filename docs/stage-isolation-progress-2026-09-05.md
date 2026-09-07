# 三模块剥离：实施进度与边界纠正

日期：2026-09-05
主计划：[independent-stage-programs-plan-2026-09-05.md](independent-stage-programs-plan-2026-09-05.md)

## 当前结论

**最新纠正已落地：实际目录发布及读面重新验收通过。** 用户指出 docs 未更新后，已撤回快照代替文件的实现。现在应用层写入批准字节，预览／ZIP 读取磁盘；实际 UI/UX 1.0.2，八文件与批准结果、刷新后预览及新 ZIP 一致。54 项发布／读面／交接回归、类型检查通过；既有三轮 run.json 摘要不变，不重跑审核、不推进 P5。详见 P4 真实验收记录末尾。下段仅保留先前错误收口和纠正的历史，不作为当前读面设计。

2026-09-07 第三轮最新：版本发布返修已通过真实验收，P4.5 重新关闭。Revision 自有候选版本推进到 1.0.1／1.0.2，Reviewer 只读通过后由应用层映射至通用不可变当前快照；Chrome 预览及实际 ZIP 八文档完全一致，初稿与两轮旧运行摘要不变。期间修复 targeted controller 提前退出竞态，通过公开重试恢复原句柄，不重跑已接纳事实任务、不放宽审计。最终 passed / settled，仍停在 Checklist 前。Revision 全量 217 项、targeted controller/lifecycle 14 项通过；产物与公开交接测试、类型检查证据详见 P4 真实验收记录。本轮不等于平台整体解耦完成，未推进 P5、未提交、未部署。

版本发布复核历史：第二轮 P4 完成结论曾撤回，因为候选版本号未提升、产品仍读取初稿；第三轮以新候选和新复审补齐，不改历史已审核字节。下段是第二轮执行闭环的历史快照，其费用不代表第三轮。

2026-09-07 P4 最新：**P4.5 真实冻结副本闭环通过，总 P4 本轮范围完成。** 用户授权旧运行归档并移除旧审核副本逻辑后，schema 51 新副本经 Chrome 启动，复用完整冻结八文档；完成初审、修订、同轮补修、新轮修订与复审，最终 passed / settled，可靠停在 Checklist 前。耗时 13 分 50.529 秒；37 条去重正式计费回执合计 585606 Token、101.796 Credit。旧运行文件哈希不变，未知关闭及旧 pending 账目不追溯改写。入口替换受影响离线 41 项、后端 typecheck、diff check 通过；此前 Reviewer 335、app 6、前端 19 与前后端类型检查记录保留。详见 [P4 真实验收记录](stage-isolation-p4-real-acceptance-2026-09-07.md) 和 [P4 离线验收记录](stage-isolation-p4-acceptance-2026-09-07.md)。未提交、未部署，不改接管机制、不推进 P5。

2026-09-07 最新：Revision（P3）已随后通过独立模块离线验收，详见 [Revision 验收记录](stage-isolation-p3-acceptance-2026-09-07.md)。主审完整回归 208 项通过（排除跨阶段 handoff）；固定输入五入口及依赖专项 17 项复跑通过，属于上述回归子集；后端类型检查通过。Reviewer 与 Revision 生产代码不互相依赖，基础能力保留正常 public 依赖。五入口使用自有固定 JSON，其他 oracle/fixture 测试来源仍明确区分。用户确认 needs_action/failed 适用条件；不新增恢复机制、不接 P4、不启动真实服务、未提交。下面 Reviewer 段落是此前完成时点的记录。

2026-09-07：Reviewer（P2）已通过独立模块离线验收，详见 [Reviewer 验收记录](stage-isolation-p2-acceptance-2026-09-07.md)。本轮模块回归 334 项、公开基础能力联测 2 项均通过，后端类型检查通过；补齐 public 脱离仓库完整执行、全仓生产消费者及基础能力 public 组合证据。按用户确认，先完成 Reviewer，再单独收口 Revision；P4 未启动。本轮没有修改阶段生产代码，没有运行真实服务或既有项目，没有 Git 提交。

### 2026-09-06 历史结论

以下保留当日快照，其中 Reviewer 的“实施中／未验收”状态已被上面的 2026-09-07 验收记录取代。

**2026-09-06 P1-R 完成：旧八文档执行与恢复兼容已退役。** 用户明确确认删除共享旧暂停／自动重置分支后，controller、run-store、recovery-projector、foundation-audit-boundary 中对应执行体已切除。旧自动重置入口仅保留抛错边界，不再清空文档、任务或审核证据；旧暂停标记不再触发恢复或自动消费。历史证据读取及拒绝旧运行的保护保留。新 Author 已接入编排，无旧作者回落；未部署或运行既有项目、真实模型、服务，未提交 Git。P2 目前正在实施，最新进展见文末记录。

**P1 八文档 Author 已通过完整离线隔离验收，并完成本轮冗余清理。** 详见 [P1 最终验收矩阵与清理记录](stage-isolation-p1-acceptance-2026-09-06.md)。Reviewer（P2）已进入实现但未完整验收；Revision（P3）尚未完成独立拆分。
本轮没有新增 Git 提交；没有运行真实模型、既有服务或暂停项目。用户允许必要时使用 Chrome，但本轮没有需要额外验证的交互变化，因此未调用浏览器。

最终退役联合验证：后端 **983/983（105 文件、9703 assertions）**，前端 Vitest **28/28**。全仓及后端 TypeScript、git diff whitespace 检查通过；Reviewer 完整基线差分和历史证据不变测试通过。下方 851、9683 等数量属于历史快照。

## 已获得的离线证据

- [x] 作者输入白名单、简报/输入摘要绑定、配置数据复制的单元测试。
- [x] 私有持久化排他创建、原子替换、损坏拒绝、链接路径拒绝、失活 PID lease 竞争测试。
- [x] 私有 native 流协议的空结果重试、输出 drain/退出竞态、异步回调停止屏障、stdin 失败、权限拒绝测试。
- [x] 作者 domain 交付合同投影 parity、GDD prompt parity、旧 retry 拒绝、恢复身份/receipt 负例测试。
- [x] 私有 lifecycle 的八文档完成、并发上限四、重复启动、停止后继续、单文档失败后保留已接受文档测试。
- [x] 生产 public 入口直接使用本地离线协议模拟可执行文件，完成八份文档；没有注入旧 worker/session/controller 回调。
- [x] 冻结产物字节/receipt 绑定、重复发布、外部修改检测、既有产物 symlink 拒绝测试。
- [x] checkpoint schema 接入 lifecycle；getResult 只读、篡改拒绝、并行越过完成前缀提交的验证通过。
- [x] 离线崩溃窗口/跨实例恢复与旧 native 会话策略的联合差分验证；不扩展为真实故障注入验收。
- [x] 八份 prompt/依赖、停止重试、回执发布、失败/停止计量及传递依赖验收；基础权威延后项不冒充已修复。
- [x] 2026-09-06 用户确认认证、计费是统一的独立基础模块；不再作为待决例外。
- [x] 移除未接线的作者私有 auth 实现及其专属测试，保留临时备份。
- [x] 认证、计费、运行配置 public 客户端封装及作者 public/lifecycle 接线；controller/app 亦已接线，只有离线验证、没有部署。
- [x] 成功、失败、停止用量快照与私有持久 outbox；计费不可用保留 pending，重放沿用原事件键，getResult 不触发计费。
- [x] 作者生产 import 边界静态验收：只允许作者私有文件、Node/zod 和基础模块正式 public 入口。
- [x] 完成回执与原运行/派发的不可变 accepted journal 绑定；跨运行/请求/回执篡改拒绝，生命周期与 checkpoint 联合测试通过。
- [x] 原 controller 作者入口退役、只调用 public 的应用接线；旧快照失败关闭，不自动迁移。

测试位于 `packages/agent-workflow-server/src/beegame/stage-modules/foundation-authoring/`。测试使用临时工作区和固定文档样本，不访问真实用户凭证或模型。

2026-09-05 历史离线复测：63 passed / 0 failed，9 个测试文件。该数字含后来撤掉的 11 项重复 auth 测试，不能作为纠正后的当前测试数量。

2026-09-06 纠正后复测：53 passed / 0 failed，9 个测试文件（撤掉 11 项重复认证测试，新增 1 项边界防回归测试）；生产 public 离线八文档测试仍通过，`git diff --check` 通过。未执行真实认证或扣费。

## 主审纠偏记录

本轮发现并要求修正的真实问题包括：排他创建暴露半写文件、stale lease 双恢复竞态、native 退出早于 stdout drain、空结果 retry 污染 Markdown sink、readiness 新增门槛、只读交付合同缩水/版本错误、恢复 proof 遗漏、projection fsync 遗漏，以及停止 intent 与 canonical commit 未共享屏障。

不能以单组 happy-path 测试通过声明模块完成。仍需补足 checkpoint 与接线/认证的联合证据。

## 已确认的认证、计费边界（2026-09-06）

现有系统由宿主 HttpOnly 登录会话统一拥有 refresh token，多个阶段通过同一凭证权威续期。新模块如各自复制同一 refresh token 并独立刷新，轮换后的 token 会使宿主和其他副本过时；本模块内的锁与 `rotationAt` 不能解决跨宿主、跨模块的权威冲突。

此前把“不共享阶段底层执行内核”错误扩大成“基础能力也要每阶段复制”，这个判断已撤回。用户已确认：

- 认证模块统一拥有登录、凭证与续期，阶段消费其公开能力，不复制 refresh token 权威。
- 计费模块统一拥有价格、额度/扣费、账本及去重；阶段仅采集与可靠提交自己的实际用量事实。
- 这是正常公开模块依赖，不是临时隔离例外。不允许借基础能力 API 操作阶段内部任务、审计事实库或 checkpoint。

已移除 `foundation-authoring/private/runtime/auth.ts` 和 `auth.test.ts`，它们未被 public/lifecycle 使用；备份在 `/private/tmp/beegame-auth-correction.0ymohS/`（临时备份，不是 Git 历史）。现有登录和计费实现未改动，没有启动真实认证、扣费或模型调用。

上段是边界纠正的历史状态；后续接线进度如下，不宣称 P1/P2/P3 完成。

## 2026-09-06 继续实施：统一基础模块接线

- `auth/public.ts` 委托已有 HttpOnly credential 权威，不复制 refresh token 或刷新缓存。
- `runtime-configuration/public.ts` 绑定 owner/模型选择，调用既有配置仓库；只有原有认证错误判定触发一次强制刷新，保留 provider 合并优先级。凭证和 env 不写入阶段 checkpoint。
- `billing/public.ts` 只提交用量事实，固定既有 weighted-v1/runtime_snapshot，按 record → debit 顺序调用原计费客户端；无新价格算法/余额/账本。请求快照与错误脱敏已补齐。
- 作者公开配置不再接受原始 model/env；运行配置和计费 public 客户端是必需依赖，没有省略即跳过认证/计费的生产路径。测试使用假基础客户端和离线可执行文件。
- 作者在提交文档前保存终态用量；失败、停止亦保存已观察到的用量。私有 outbox 跨实例重放同一事件键；计费失败不改变文档业务结果，只读状态可返回 `billingStatus: pending`。本地未持久化且模型尚未交付的 usage 不可能由此恢复，不能宣称覆盖模型服务端一切计量丢失。
- 旧 native 行为进一步核清：parallel-draft 的 preserveSession 不意味着新文档或 retry 复用会话；旧新 dispatch 都创建新 session。新模块保留同一 job 内的原生多轮行为，job 终态/停止后由自身释放。

中间联合复测：85 passed / 0 failed，13 个测试文件；随后新增 import 边界测试单独 2 passed / 0 failed。后续 accepted-journal 和冻结差分测试仍在进行，最终数量以完成后的复测为准。

本轮最终联合复测：**101 passed / 0 failed，15 个测试文件，2472 assertions**（认证、计费、运行配置及作者完整测试目录）。覆盖新增 accepted journal、崩溃窗口重建后先恢复原回执再重试、全部八份实际 stage 请求的 canonical JSON 等价、提示词逐字符串等价；基线来源核验随后扩展到 24 个相关文件，专项 7/7 再次通过。发现并补回 `systemDeliveryContract.content.jsonKinds/yamlKinds`，没有调整作者生成策略。这里的来源锁定仍依赖旧文件保留，不等同于旧代码可删除后的替换验收。

计量接线主审还确认：原 SQL 按 session 累计快照求增量，各 document job 使用各自 session 标识，runId 只作分组 metadata；没有把八份独立用量混成一个累计 session。空输出内部重试被 Markdown sink 过滤，但独立 onUsage 持久化 hook 仍先接收其用量。释放执行 lease 前等待全部 job 用量回调结束。

全包 TypeScript 检查尚未通过：已存在的旧 Reviewer 隔离测试类型错误仍在；本轮发现的 runtime snapshot、parity readonly 与 checkpoint fixture Buffer 类型错误已修正。不能把新模块无错误等同于全包通过。

### 尚待用户授权的计费权威行为变更

2026-09-06 用户指示：先记录问题，按原计划继续推进。该项现登记为 [BILLING-001](stage-isolation-known-issues-2026-09-06.md)，不再作为其他阶段隔离工作的等待点，不重复请求本项授权。

审计确认既有 SQL record/debit RPC 对 `(user_id, idempotency_key)` 仅判重，未拒绝同键不同 payload。新增冲突校验会改变计费 RPC 的失败行为，工具安全审查要求具体授权，已经向用户说明。**未改 authority SQL、未执行数据库迁移、未发生真实扣费**。作者 outbox 自身封存事实并保持稳定事件键；这不冒充修复计费权威的全局缺口。

## 2026-09-06 编排公共衔接离线进展

- 新增 `foundation-authoring-link.ts`，只通过 Author public start/resume/stop/getResult 操作模块，尚未接入 controller/app。持久化仅包含公开调用身份、handle、结果和控制意图，不回填旧作者 checkpoint/dispatch。
- 保留 `control.requestId === authorStage.requestId` 校验；调用侧从绑定的 invocation、动作和单调序列生成命令标识。未放宽验证器。
- 停止意图先持久化；公共 stop 与后续 resume 在编排租约内串行。重复停止重用命令标识；完成结果和停止竞态不会启动 Reviewer。
- 登记 schema 49 及新结构 fingerprint，保留 schema 48 的历史登记。沿用既有 obsolete snapshot 拒绝规则，不做自动迁移；未来切换该版本时，旧暂停运行不能直接继续，需要明确兼容方案。此次未读取或重写真实项目快照。
- 冻结 parity oracle 已转为提交 `71507fb5e9e444a39334ebc9c410e0cb53146ae9` 的静态样本，测试不再运行旧 Author 生产实现；24 个基线文件按 Git 历史核验。
- 最新联合复测：**114 passed / 0 failed，18 文件，2531 assertions**。包括基础模块、Author 全目录、编排衔接、公开结构和 schema evolution。
- 全包 `tsc --noEmit` 仍未通过：报错限于两个既有 Reviewer 隔离测试文件；此次 Author 衔接没有类型报错。不能声称全包构建通过。
- 应用切换还有 [AUTHCONFIG-001](stage-isolation-known-issues-2026-09-06.md) 的本地身份兼容授权问题。保留强制鉴权，未修改安全规则、未切换生产入口、未启动真实模型或服务、未提交 Git。P1 仍未验收。

## 2026-09-06 按统一鉴权继续推进

用户决定：非必要问题登记后继续主线。AUTHCONFIG-001 已延后，不再以本地免 token 兼容要求反复暂停；生产候选统一使用 required authentication。

- 新增 `foundation-authoring-host.ts`：宿主惰性组装正式认证、运行配置、计费及 Author public 入口。仅返回四个公开方法；凭证每次从宿主权威取得，其他配置绑定快照，不接收旧 worker/session 回调。组装失败允许后续显式重试，已成功创建的模块不重建。
- 新增 `foundation-authoring-public-integration.test.ts`：通过宿主 helper 和真实 Author public 实现，连接编排 link，用离线可执行样本完成八份文档，核验产物字节摘要、八份用量的 record/debit 配对、完成后不进入 Reviewer、重建编排后不重复执行和提交用量。
- 联合测试实际捕获并修正恢复状态投影缺陷：Author 已接受恢复命令但 checkpoint 尚未应用时，旧终态曾泄漏到公开结果。现由 Author 内部对待应用的持久命令报告 running；编排不读取内部序列，也不再自行假设 optimistic running。确定性锁屏障回归及缺凭证→恢复凭证→原句柄完成测试均通过。
- 衔接层补充停止确认丢失、启动确认丢失、foreign handle、后台观察失败测试。后台观察失败报告编排 needs_action，保留 Author 最后已知状态，不伪造模块失败/停止。
- 崩溃重建测试的固定模型样本增加明确等待屏障，避免 release 先于样本进入等待导致偶发超时；没有增加业务超时或改变重试策略。
- 最新联合测试：**127 passed / 0 failed，20 文件，2711 assertions**；`git diff --check` 通过。全包类型检查仍有此前两个 Reviewer 隔离测试的类型错误，未作为本轮 Author 通过的证据。
- [CUTOVER-001](stage-isolation-known-issues-2026-09-06.md)：宽范围生产 controller 切换被安全审查拒绝，补丁未生效。之后仅继续未接线宿主、模块修正和离线集成验证，未绕过限制修改 app/controller。P1.7 及 P1 总验收仍未完成。

下一次完整接线必须联合处理：controller 新启动/恢复/轮询、两个停止路由、重复 start 恢复入口、app cleanup、配置及凭证绑定、旧 Author worker 迟到结果拒绝。验证必须包括 app 路由离线测试及原 Reviewer/Checklist 回归；不能仅将 controller 的 start 改成新模块就宣称完成。现有项目与服务保持不动，旧快照不做自动迁移。

## 2026-09-06 用户批准后的 controller/app 实际切换

用户明确回复“按照你的推荐”后实施完整接线；此前未生效的切换不再作为当前阻塞。

- app 惰性组装正式认证、运行配置、计费和 Author public；controller 新启动/继续/轮询只经 public link，未注入旧 Author worker/session 作为执行实现。缺 public 模块直接拒绝，不回落旧实现。
- 两个停止路由、重复启动查询、继续/重试、cleanup 接线完成。taskId 局部重试拒绝；丢失 handle 的停止保留 pending 意图，不伪造 stopped；某个 controller 清理失败仍继续清理其他 controller 和 sessions。
- 非空旧 Author 快照在恢复/重复启动入口先拒绝，不执行旧 reconcile 写入；迟到的旧终态、旧 dispatcher/replay/recovery 不得进入带 public Author link 的运行。旧历史状态未自动迁移，真实项目未读取或改写。
- 只从公开结果投影完成态：结果 inputDigest 必须绑定当前调用，严格匹配八个 canonical 文档；无有效结果不凭工作区文件声称完成。运行中仅显示一个 aggregate task，不读作者私有进度。完成后显示 8/8 和 `public_author_handoff`，无重试按钮、无 Reviewer 任务合成。
- 最终补测发现四项源码 oracle 仍期待旧 Author 入口。新增 `public-author-cutover-oracle.ts` 只逆转本次审过的精确 Author 接线片段，保留旧 Reviewer 历史全文比较；Reviewer failure-policy 差分恢复迁入协调模块的原适配片段后执行原阈值矩阵。没有删掉失败断言或更新 Reviewer 算法基线。
- 最终后端命令覆盖 delivery-workflow 全目录、stage-modules 全目录、auth/public、billing、runtime-configuration、host，以及 app public routes、旧暂停入口、项目停止、阶段投影、恢复测试：**847 passed / 0 failed，90 文件，8495 assertions**。真实 Author public + 认证宿主 + 生产 controller 使用离线可执行样本的八文档联测包含其中。
- 前端 documentProgress + Demiurge/RightSidebar：**28 passed / 0 failed，2 文件**。全仓 `bun run typecheck`（tsc）通过；两个旧 Reviewer 测试的纯类型错误已修正。`git diff --check` 通过。
- 验证没有启动真实模型、既有服务或浏览器，没有数据库迁移/真实扣费，也未新增 Git 提交。

本轮关闭 P1.7/P1.8 应用接线项；P1 总验收仍不勾选。剩余工作是冻结基线下完整会话/崩溃恢复语义、全分支差分和传递依赖最终审计；BILLING-001、AUTHCONFIG-001 继续按用户指示登记延后，不借此扩展授权。

## 2026-09-06 独立运行与传递依赖验收

用户要求继续推进，并询问八文档是否已隔离。当前答案：执行模块和应用调用边界已经隔离，P1 总验收仍未完成。

- 新增 `detached-runtime.test.ts`：实际打包生产 public 入口与离线 native 样本，构建加载路径只允许 Author 模块自身和 zod；不允许旧 delivery-workflow、controller、dispatcher、Reviewer、Revision 或外部测试生成器进入运行包。
- 将两个 bundle 放入临时目录，在新进程和最小环境中仅调用 public API，完成八份文档；重建模块后重复 start/resume/getResult 保持原句柄与结果，配置请求和用量事件仍各为 8，未重复执行。
- 逐份验证冻结 Markdown 正文（仅规范化作者生成的 front matter）、公开产物摘要和不可变 artifact 字节。样本来自离线测试生成器，不是模型输出或真实语义质量验收。
- `native-author.ts` 不再运行时导入旧目录的文档生成器；固定输出迁入 `frozen-documents.ts`，JSON 字节 SHA-256 为 `7cae09cdb668d1e68f97d9a00eaacf8ba40ce20d16ea2ff84a1ab33a1ef7558d`。
- 扩展 infrastructure boundary：扫描 packages/apps 的生产 TS/TSX，用 TypeScript 模块解析检查 import、re-export、动态字面量 import/require 和 import type；外部消费者只能引用 Author public，不得引用任何私有实现。只读检查通过。
- 本轮 Author 全目录：**82 passed / 0 failed，13 文件，2444 assertions**；全仓 `tsc --noEmit`、`git diff --check` 通过。此前 847 后端/28 前端联合回归仍是上一轮证据，本轮没有冒称重跑该全集。

关闭 P1.11 依赖与调用边界项。下一步继续 P1.5/P1.10 的恢复差分：尤其需区分 receipt 恢复、失活进程恢复、保留 native session 和显式重试，不把独立完成态重放当作全部恢复语义通过。当前 lifecycle 保存 native session ID，而其调用 execute 的路径尚未传入 resumeSessionId；须对照冻结旧路径判断哪些场景需要恢复原会话，不能在未对照前宣称行为等价。没有因此更改恢复策略。

## 2026-09-06 停止与恢复差分验收

- 已核对冻结提交 `71507fb5e9e444a39334ebc9c410e0cb53146ae9` 的 `delivery-worker-session-port.ts`：若 contract 提供 `resumeWorkerSessionId`，明确报错 `document author session resume is not supported`。因此当前 Author 未把持久 native session ID 传给 execute，并不是已确认的回归；没有添加旧作者不存在的会话续接行为。
- 新增 `recovery-policy-parity.test.ts`：只提取冻结版本 stop/retry 两个纯函数执行差分，不运行旧 controller/runtime。覆盖 running/completed/failed/interrupted dispatch、全部文档与无效 taskId、初始无 documents 状态；状态、尝试次数、派发证据、兄弟任务及输入不变性均与基线一致。
- lifecycle 新增初始 GDD 与两份并行文档的进程丢失重建：先停止全部离线 fake 进程，再还原事前 checkpoint/control；只读查询不执行，恢复观察进入 needs_action，重放同一命令不隐式重试，新的显式重试生成新 dispatch，保留已接受文档、未传历史 session ID。
- 新增并行停止与迟到成功流：停止意图持久化后才释放故意迟到的成功输出；两份未完成文档不得落盘，已接受字节保持不变，旧 stop 命令不能打断后续恢复。
- 新增多实例观察活跃调用：第二实例 start/resume 保持同句柄、没有重复 native 工作；完成总派发仍为 8。
- 新增 artifact 已发布、result checkpoint 丢失窗口：在离线执行释放后还原缺 result 的 checkpoint，重建模块恢复完全相同的结果和 artifact 引用，派发总数仍为 8。与此前 committed receipt 已落盘但 checkpoint 丢失的恢复用例分开验证。
- lifecycle 的固定文档输出亦改用 frozen-documents，不再运行时导入旧目录文档生成器。生产 Author 恢复策略本轮没有修改。

本轮关闭 P1.5 离线恢复子项；P1 总验收仍未勾选。下一步汇总 P1.1—P1.12 的最终验收矩阵，区分已有证据、刻意延后基础模块问题及未覆盖情形；未验收前不启动 Reviewer。

最终 Author 全目录 **89 passed / 0 failed，14 文件，2590 assertions**；全仓 `tsc --noEmit` 和 `git diff --check` 通过。本轮只补离线测试与验收记录，未运行真实模型、既有项目/服务、数据库或浏览器，未新增 Git 提交。

## 2026-09-06 P1 最终验收与清理完成

用户授权：继续推进，必要时可以用 Chrome；隔离后清理冗余与旧版方案。

- P1.1—P1.12 的离线验收矩阵已完成并通过，主计划 P1 标记完成。详见 [最终验收与清理记录](stage-isolation-p1-acceptance-2026-09-06.md)。这替代前文各历史阶段的“尚未验收”状态，不代表 P2/P3 或真实模型质量通过。
- 关闭测试侧旧依赖：domain 的合同/提示比较改用冻结摘要/样本，publication 与 native fixtures 使用冻结文档；新增检查禁止 Author 全测试树导入旧工作流或旧生成器。
- 首次批量清理被审查拦截后没有执行；先移除共享 document-stage 的旧 Foundation 入口、迁移对应测试，TypeScript 解析确认 11 个删除目标无外部 import/re-export，再备份并删除。
- 删除旧 Author stage/scheduler/boundary/context、4 个未使用的私有包装文件、2 个已迁移的旧测试和废弃共享内核设计稿，共 11 文件。恢复副本位于 /tmp/beegame-author-cleanup.hHmaFw；受版本控制的旧文件还可从 Git 历史恢复。
- 共享 document-stage 仅保留显式 checklist 启动/完成，旧 Foundation 或缺失 documentSet 的完成请求均拒绝。保留历史快照校验、通用文档协议和 Reviewer/Revision 仍使用的共享函数，完整保留/删除理由在验收记录中列明。
- 清理后的最终后端联合复测：**851 passed / 0 failed，92 文件，8677 assertions**；最后收紧 checklist 入口后额外定向 **9 passed / 0 failed，40 assertions**。前端 **28 passed / 0 failed**，全仓 TypeScript 与 git diff whitespace 检查通过。
- 未调用 Chrome：本轮没有需要额外浏览器验收的交互变化；未使用真实模型、既有服务/项目或数据库，未新增 Git 提交。

下一步进入 P2 Reviewer 完整隔离设计/实施；不自动恢复现有暂停项目，不从新 Author 完成态自动启动 Reviewer。

## 2026-09-06 P2 首批实施：规则与输入准备层

用户授权继续推进后，新建 `stage-modules/foundation-reviewer/private`。这是 P2 的首批实现，不是完整 Reviewer 验收；历史“P2 未开始”状态由本条更新，P2.1—P2.6 均仍未完成。

- 私有化迁入 19 份生产规则文件：格式、文档合同/拓扑、章节索引、事实目录/抽取/存储、确定性审计与生产清单、项目规则、语义审计、问题注册/归并、事实与语义任务策略。只调整模块引用，不改变规则算法；冻结迁入正文摘要并逐文件校验。
- 生产清单原有的 Revision 影响分析类型依赖改为 Reviewer 自有只读选择数据，不导入 Revision 的补丁、计划、状态或执行器。初审的实际生产确定性规则入口已在私有测试中运行，拒绝调用方注入 schema/rules；尚不把它当作完整审核结果。
- `prepare-review.ts` 严格接收八份 canonical 文档，拒绝重复、遗漏、路径别名、非文本和额外字段；按固定顺序绑定原始字节摘要，复制并递归冻结快照及准备结果。格式不合格仅产生格式问题，不创建事实任务；合格则创建索引、机械事实和待执行事实包，明确保持 `facts_pending`，不伪造 passed。
- 迁入规则测试使用模块自己的 fixture。旧事实运行测试中的基础设施配置选择用例未迁入规则目录，原测试保留；Reviewer 的配置 public 客户端与生命周期测试仍待实现。
- AST 依赖扫描覆盖当前私有源文件与测试/fixture，检查 import、re-export、动态 import 和 require 的直接依赖；允许自身相对路径、Node、zod/v4，以及测试用 Bun/TypeScript。此证据不是最终 public 入口打包与传递依赖验收。
- 本轮 Reviewer 私有测试：**92 passed / 0 failed，14 文件，991 assertions**。后端 TypeScript 检查通过；本轮没有重跑此前 P1-R 的全部后端/前端联合回归，不沿用旧数字作为本轮测试结果。

下一步：迁入 Reviewer 自有模型提示与 native 执行，完成状态持久化、停止/恢复、用量 outbox 和结果发布，再以同一 public 生命周期覆盖初审与候选复核。当前没有公开 start/resume/stop/getResult，没有接回主流程；Author 完成停点不变。旧 Reviewer 尚在服务其他旧路径，未删除；也没有让新模块回退调用旧 Reviewer。未启动真实模型、既有项目/服务、浏览器或数据库，未新增 Git 提交。

## 2026-09-06 P2 第二批：独立 packet 执行与结果验收

用户继续授权推进。本轮完成 Reviewer 私有单任务执行链，不代表阶段生命周期完成。

- `worker-prompt.ts` 与 `worker-schemas.ts` 只提取旧生产代码中的事实/语义 packet 投影、指令、终态 schema；没有引入 Author、Revision 执行器或旧 WorkerDispatchRequest。保留现有定向复核协议声明，但候选复核的版本绑定与阶段接线尚未实现。新增冻结提取正文摘要，连同自有 `native-usage.ts` 的累计计量纯函数逐文件验证迁移基线。
- `worker-task.ts` 为事实抽取和语义 source/confirmation 建立私有任务。输入复制、packet 校验、schema 冻结；模型不能回传 run/task/packet 身份或伪造事实 evidence，来源由自有事实目录和原始 owner section 绑定。完整性、重复/越界 key、值类型及语义修复范围继续由迁入规则验收。failed/blocked 不生成已接受证据。
- `native-worker.ts` 自己启动一轮 fresh native 进程，使用 packet 提示、原 structured-output flags 和空 tools 清单，拒绝 Read 等权限请求；不依赖 Author 运行器、session-manager、dispatcher 或其他阶段。环境只接受明确配置白名单。支持直接 structured_output 和严格匹配的 StructuredOutput 成功 tool receipt；错误、未匹配和空终态均拒绝。
- 单任务取消等待进程清理，必要时结束不响应 SIGTERM 的离线子进程；取消后排队到达的成功结果不得验收。失败/异常退出返回已观察用量，stderr 不保留或向外回传。私有 onUsage 钩子先完成才能验收终态；当前尚无 Reviewer 持久 outbox，因此不声称已实现计费交付或崩溃恢复。
- 计量测试覆盖 streaming 部分计数取最大、累计 result 不重复相加、计数重置保留前一 epoch、后续在途用量、cache 用量，以及空 modelUsage 不覆盖有效 direct usage。这是用量事实核算，不是扣费或定价实现。
- 新增实际离线 native fixture 与 detached bundle：把私有集成入口和 fake native 可执行文件打包到临时目录，以最小环境在仓库外执行事实、语义初审及强确认；打包加载闭包仅 Reviewer 自身与 zod，临时工作目录没有生成 canonical 文档。此验收入口不是 public API，也没有宣称完成十项审计调度或候选复核闭环。
- 最终 Reviewer 私有测试 **115 passed / 0 failed，18 文件，1211 assertions**；后端 TypeScript 与 `git diff --check` 通过。只运行离线子进程；没有真实模型/网络调用，没有恢复既有项目、启动服务、浏览器或数据库，没有 Git 提交。

P2.1—P2.6 继续保持未勾选。下一步是阶段级状态机与不可变执行回执、显式停止/恢复、事实/语义调度及重试、配置 public 客户端的模型档位接入、持久计费用量 outbox，再完成结果发布与初审/候选复核的 public 契约。Author 完成停点保持不变，不自动接通新旧 Reviewer。

## 2026-09-06 P2 第三批：事实阶段状态与持久化回执

用户要求按计划推进。本轮只推进 Reviewer 的事实阶段持久化层，不把它当作整个 Reviewer 的 start/resume/stop/getResult。

- 新增 `fact-state.ts`、`fact-journal.ts`、`retry-policy.ts`。状态由固定输入及不可覆盖的 hash-chain 事件重建，不依赖旧全局 store/dispatcher 或 Author 私有文件。全部事实完成时只进入 `facts_staged`，不产生整轮审核 passed。
- 输入绑定 owner/project/request 身份、八文档原始摘要及事实目录/生产清单/并发和尝试策略摘要。同一身份更换输入拒绝覆盖；不同 owner 的相同 requestId 使用不同目录。路径固定在 `.beegame/workflow/foundation-reviewer/state/<identity-digest>/`，检查真实父目录和 no-follow 文件读取，不触碰 canonical 文档或其他阶段目录。
- 回执发布使用临时文件 fsync、无覆盖 hard-link 和目录 fsync；事件包含连续序号、前序摘要、命令身份与 payload 摘要。重放检查全部绑定，并再次用自有 worker-task 校验模型结果。未发布的临时记录不算已接受结果；缺失、损坏或冲突证据拒绝继续。接收成功后 task 的 receiptPath/receiptDigest 指向本模块实际事件记录，不使用迁入纯策略默认生成的旧 audit 目录路径。
- 保留事实最多四并行、两次失败上限和配置错误立即 needs_action 的既有规则。主动停止退还当前尝试次数，但保留 dispatch、已观察用量和时间证据；恢复只重启主动停止任务或完全未派发的配置失败，不重置已耗尽或失活进程的尝试。旧 stop 命令重放不会再次打断后续继续。
- 用量按 dispatch 独立保存最新累计快照，重复终态不重复加总；停止后关闭进程期间补到的用量仍可记录，未知 dispatch 和计数回退拒绝。此处只是计量事实日志，尚未形成 billing public 的最终 outbox/扣费回执。
- `read()` 不启动任务、不凭 running 状态推断进程已死。`recover_lost` 是给后续生命周期控制器使用的显式内部命令，调用前必须证明进程失活；执行租约及实际 stop→终止进程→resume 的控制器尚未完成。并发 append 的 CAS 只保证日志不被覆盖，不能把幂等 claim 重放当作再次启动 worker 的许可。
- 新增 16 个事实日志测试，覆盖重开与同命令重放、全部事实停点、并发/重试上限、主动停止、迟到结果、补充用量、进程丢失、配置恢复、不同 owner、损坏/不完整事件和 symlink 拒绝。实际离线 native 输出经过计量、验收、落盘，再重建出完全相同状态。
- detached bundle 扩展到事实日志：仓库外最小环境加载闭包仍只有 Reviewer 自身及 zod，运行 packet 子进程并恢复事实回执；只新增 Reviewer 私有 `.beegame` 状态，没有 canonical 文档输出。

本轮最终 **131 passed / 0 failed，19 文件，1338 assertions**；后端 TypeScript、`git diff --check` 与新文件定向空白检查通过。没有真实模型、网络、既有项目恢复、服务、浏览器、数据库或 Git 提交。

P2 仍未验收。下一步是执行租约与控制器、语义阶段的持久化调度/强确认、配置模型档位、最终用量 outbox、结果发布及初审/候选复核公开契约。主流程继续停在 Author 完成后。

## 2026-09-06 P2 第四批：事实控制器与执行租约

用户继续授权推进。新增私有 `fact-controller.ts`、`model-selection.ts`，事实日志增加独占执行租约；没有创建整个 Reviewer 的 public 工厂或接回 app。

- 控制器持有执行租约后才 claim 和启动 native 任务。单进程重复 run 复用正在执行的工作，其他实例/进程遇到已有活跃租约返回 busy，不重复派发。租约带 runId、PID、随机 token，发布不覆盖，释放前核对所有权；替换后的 token 不会被旧 owner 删除。
- 不按时间超时抢占租约。旧 owner PID 已不存在时报告 stale 并保留原文件，因为 orphan native 子进程可能仍活着；这条路径仍需要后续显式恢复处理，不能宣称 P2 崩溃恢复已经全部完成。
- 事实控制器连接 runtime-configuration **public 类型/客户端能力**，校验 owner 后按派发取得配置。Reviewer 自有模型选择保留四 provider 的 HAIKU/SONNET/OPUS 别名规则，事实任务必须有 fast 模型；没有调用或复刻认证仓库。语义档位选择函数已迁入，但语义控制器尚未接入。
- 控制器沿用最多四并行、两次失败上限，自动推进全部事实至 `facts_staged`。native 结构化输出先经任务验收，再把原始模型 payload 和用量落入日志；恢复/已完成 run 只读重放，不解析配置、不再启动 native。用量写入、结果接收和进程清理完成后才释放执行租约。
- stop 先提交日志，再中止本实例 native 工作；另一个进程的 owner 通过观察持久状态执行停止。对其他进程调用 stop 返回的是已持久化意图，owner 的 run 结束才证明进程清理完成。明确 resume 只有取得新租约后才能修改暂停状态，不在旧 owner 清理期间重启工作。旧 stop 命令重放无二次停止作用。
- 配置请求尚未返回也可观察持久停止；停止后返回的旧配置不会启动 native。已耗尽尝试不可借 resume 重置。取得新租约但发现无 owner 的旧 running claim 时只进入显式恢复，不猜测或重跑旧 native 结果。
- 依赖检查只为 `fact-controller.ts` 放行 runtime-configuration/public 的 type-only import，其他私有跨模块引用仍禁止。跨进程测试把控制器及 fake native 打包至仓库外：另一个 OS 进程无法拿到租约，可以写入 stop 意图，owner 清理全部 native 后释放租约。打包加载闭包仍只有 Reviewer 自身与 zod。
- 全集运行时曾出现第二次打包的文件读取错误，独立运行与双测试运行未复现；将跨进程测试的打包审计放进独立进程，保留相同依赖检查与行为断言后，全集通过。没有为此修改生产执行逻辑。

本轮 Reviewer **143 passed / 0 failed，21 文件，1475 assertions**，后端 TypeScript 与 `git diff --check` 通过。所有执行都是新建临时目录中的离线 fixture，没有真实模型、网络、既有项目恢复、服务、浏览器、数据库或 Git 提交。

P2.1—P2.6 继续保持未勾选。剩余工作包括语义阶段持久化调度/强确认、stale lease 的显式恢复证据、最终计费用量 outbox、结果发布和初审/候选复核的 public 生命周期。Author 完成停点保持不变。

## 2026-09-06 P2 第五批：语义任务与强确认的持久化状态

用户确认继续按计划实施。本轮增加 `semantic-input.ts`、`semantic-state.ts`、`review-state.ts`，扩展既有 Reviewer 私有日志；没有接回 app，也没有声称完整 Reviewer 已独立验收。

- 只有全部事实 packet 已接受，才允许 `begin_semantic`。从原始八文档与日志重放的事实终态重新校验 receipts、覆盖完整事实目录并合并机械/worker facts，然后调用迁入的生产确定性审计；调用方不能提交自己的事实库、规则、检查列表或语义 packet。
- 十项语义检查和 fast/balanced 档位由冻结 manifest 生成，绑定原始 section bytes、完整事实库和确定性问题前缀。前缀使用 Reviewer 自有版本化摘要，属于内部输入绑定，不冒充旧全局 artifact 文件或最终公开报告。十九份冻结规则文件保持不变。
- 事实与语义使用同一个 append-only 日志、输入头和执行租约，没有另建跨阶段交接文件或可变 checkpoint。语义事件每次重放重新派生输入并验收模型输出；source 接受和必要的 strong confirmation 创建是同一条不可变事件，重放不会重复添加强确认。
- 延续原规则：UNDECIDABLE 或 manifest BLOCKER 触发同 packet、fresh context 的强确认；强确认不继承 source 结论。当前冻结清单没有 BLOCKER 项，因此测试通过 UNDECIDABLE 验证强确认；十项 PASS 不额外增加确认任务。强确认仍 UNDECIDABLE 进入 needs_action，不能通过 stop/resume 重置。
- 语义 source 与 confirmation 共用四个运行槽；source 最多两次失败、confirmation 最多一次失败。停止保留已接受 source、退还在途尝试并拒绝迟到终态；已发生及迟到用量按 dispatch 保留，source/deep 分别累计，不重复计量。第一次派发前缺配置允许显式恢复，失联或尝试耗尽不自动重试。
- 全部语义及必要确认完成只到内部 `semantic_staged`，不等于 passed：确定性问题仍保留，最终问题合并与结果发布尚未实现。事实控制器仍只推进事实阶段；语义事件已可持久化，但自动 native 调度、逐派发模型档位选择及跨进程 stop/cleanup 的语义控制器尚未接入。
- 私有日志策略摘要升级到 `reviewer-journal.v2`，绑定语义 manifest、并发和重试政策。旧 v1 离线日志遇到策略差异会拒绝打开，不自动覆盖或静默迁移。本模块尚未用于真实运行，本轮仅创建并删除临时测试目录。
- 新增 12 项测试，包括同日志源结果/强确认创建及重放、停止重试、配置与用量负例、篡改拒绝和共享租约。离线 native 子进程完成九项 source 与一项 strong confirmation；另一项 source 用固定 UNDECIDABLE 触发确认。模型输出经过真实私有 native 协议、用量日志和结果接纳，重开后状态一致，工作区没有 canonical 文档输出。既有仓库外 bundle/依赖禁区测试继续通过，不据此宣称真实模型质量验收。

最终 Reviewer **155 passed / 0 failed，23 文件，1661 assertions**；后端 TypeScript 与 `git diff --check` 通过。没有真实模型、网络、既有项目恢复、服务、浏览器、数据库或 Git 提交。

P2.1—P2.6 继续未勾选。下一步优先接入语义自动执行控制器与模型档位，再完成 stale lease 显式恢复、最终问题合并/产物发布、计费 outbox 和初审/候选复核 public 生命周期。Author 完成停点保持不变。

## 2026-09-06 P2 第六批：语义自动执行与模型档位

用户继续授权按计划实施。本轮新增 Reviewer 私有 `semantic-controller.ts`；仅消费 `facts_staged`，不代替事实控制器或主编排启动上游，不接回 app，也不发布最终审核结果。

- 语义执行取得同一 Reviewer 日志的执行租约后，才初始化语义任务、claim 和启动 fresh native 子进程。事实/语义实例及其他进程不能同时持有执行权；重复 run 复用当前执行，busy/stale 不派发。完成后的 run 只回放状态，不再读取配置。
- 每项派发通过 runtime-configuration public 能力读取配置，按冻结任务的 fast/balanced/strong 档位重映射 provider 模型别名。实际离线 native fixture 核对传入的模型别名；十项 source 与必要的 strong confirmation 自动执行，不继承 source 会话或结论。
- 强模型缺配置时，已完成 source 回执保留，未派发 confirmation 的尝试数仍为零；明确 resume 后只执行未完成部分。原语义任务两次失败、强确认一次失败上限不变。用量落盘、终态接纳和子进程清理均在释放租约之前完成。
- stop 持久化后中止本实例工作，另一个进程的 owner 观察停止并清理。远端 stop 返回仍只确认持久意图，owner 的 run 完成才证明其子进程清理完成。pending 配置可以被停止，迟到配置不能派发。停止后的 strong attempt 退还但已发生 deep 用量保留，恢复不重跑已完成 source。
- 新增原子 `semantic_stop` 事件，解决事实已完成、语义尚未首次 run 的停止窗口：初始化并暂停语义任务在同一事件内完成，之后普通 run 不能绕过暂停。事实尚未 staged 时该阶段专用 stop 明确拒绝，不代替事实阶段执行停止。整个 Reviewer 的公开 stop 路由仍待完整生命周期接入。
- 获得新租约却发现旧 running claim 时，不猜测进程结果或自动重试，只记录 needs_action。即使已有配置失败使阶段处于 needs_action，也能记录剩余无 owner 的 running siblings 为失联。stale lease 仍保留且不抢占，显式恢复证据协议尚未完成。
- 日志策略升级为 `reviewer-journal.v3`，旧策略日志拒绝静默复用。十九份冻结业务规则及协议正文不变；依赖检查只为新控制器放行 runtime-configuration/public 的 type-only import，不引入其他业务阶段私有代码。
- 扩展仓库外打包测试：使用 Reviewer 自身和 zod 的闭包，在独立 OS 进程先完成离线事实，再运行语义 worker。父进程不能获得 lease，但可以提交停止；子进程退出、租约清理及没有接受迟到语义输出均验证。没有连接真实模型或既有项目。

新增九项语义控制器测试及一项仓库外语义控制器测试。首轮完整回归的一项 fixture 在等待强确认启动时超过 25 秒；降低测试读取完整日志的轮询频率并扩大等待窗口后，保留原停止、计量与恢复断言，完整重跑通过，没有修改生产重试政策。最终 Reviewer **165 passed / 0 failed，24 文件，1781 assertions**；后端 TypeScript 与 `git diff --check` 通过。没有真实模型、网络、既有项目恢复、服务、浏览器、数据库或 Git 提交。

P2.1—P2.6 继续未勾选。下一步是最终问题合并与产物发布，再接计费 outbox、初审/候选复核 public 生命周期及 stale lease 显式恢复证据；不能把内部 `semantic_staged` 当作公开 passed。Author 完成停点保持不变。

## 2026-09-06 P2 第七批：初审生命周期、发布与计费

用户要求不再按每个子任务暂停，按计划连续推进。本批仅改变 Reviewer 私有实现及离线测试，未接回 app，P2 验收项保持未勾选，均未提交。

- 最终结论从原始八文档和重放回执派生，重新校验 source/必要强确认；格式问题无需模型，确定性问题不能被十项语义 PASS 覆盖。全部级别的问题都需要修复，仅空问题集合签发 passed。
- 公开结果数据绑定 owner/project/request、初始来源或候选身份、八文档完整内容/摘要、问题及证据。结果只写 Reviewer 自己的不可变 results 目录，COMMITTED 标记最后发布；缺标记不是完成，有标记而内容缺失/篡改是损坏。getResult 不重建产物、不写状态，不覆盖 canonical 文档。
- 增加逐派发计费 outbox，清理后封存实际观测用量，经 billing/public 提交，不实现定价。超时重放保持同一幂等键，业务完成与计费 pending 分开呈现；停止、失败和历史尝试用量保留。未知用量不猜成零，仅明确尚未启动的 claim 可以记录零。
- 私有初审 start/resume/stop/getResult 已贯通事实→语义→发布→计费。注册和请求身份不可变；单一执行租约覆盖全链。粗粒度停止覆盖事实完成、语义尚未初始化的窗口，恢复不重新跑已接受结果。公开统一工厂仍待候选复核一起完成。
- 日志策略升级到 reviewer-journal.v5，绑定生命周期输入及事件；旧离线版本拒绝静默复用。十九份既有冻结规则/协议未改；仅自身控制器、生命周期和 outbox 允许认证配置/计费 public 的 type-only 依赖。

初审扩展后完整 Reviewer 回归 **187 passed / 0 failed，28 文件，2127 assertions**（156.45 秒）；新增初审五项测试覆盖离线 native 全链、格式直接发布、身份冲突、跨阶段停止和显式恢复补发布。后端 TypeScript 通过。无真实模型、网络、项目恢复、服务、浏览器、数据库或 Git 提交。

随后持续推进的候选准备（尚非候选完整生命周期验收）：

- 影响分析、定向事实重建、确定性/语义复核规则迁为 Reviewer 独占；仅重定位依赖，抽取 PatchOperation 数据类型及原摘要算法，不引入 Revision 的执行/IO。原有 37 项定向规则测试通过；增加三个冻结摘要，既有十九文件基线保持不变。
- 审计问题输出补齐允许修复范围触及的契约另一侧事实。范围由冻结事实目录/契约声明决定，不扩大可改章节，不无条件导出完整私有事实库；两项证据范围测试通过。
- 增加复制结果的独立边界校验，验证编排已接纳的 owner/project/resultId/resultDigest、原文、策略、问题、章节和事实证据。摘要是版本绑定而非签名/语义正确性证明，不从候选自报身份建立信任。四项契约测试及后端 TypeScript 通过。
- 核实旧控制器：整篇格式修复发布后重新初审；章节修复仅重建受影响事实并定向复核，不改为十项全量重审。后续候选执行将保留此区别，以及同轮失败文档重试/已通过字节保留。

候选接线、stale lease 显式恢复证据和完整 public 验收继续实施；Author 完成停点不变。

候选准备阶段联合回归：**231 passed / 0 failed，32 文件，2403 assertions**（157.29 秒）。随后补充的一项公开切片/完整事实库对照测试也通过：只重建 game.mechanics，保留 technical.supported_actions 依赖，定向检查得到相同的新技术设计契约问题，语义 packet 仍只含指定问题及最小相关事实；不读取生产者私有状态、不扩大到全量审计。该新增测试单独通过，尚未计入 231 的全量统计。后端 TypeScript 和 git diff --check 再次通过。

### 2026-09-06 P2 候选交接、定向执行准备与协议待决项

继续按计划实施，未完成或勾选 P2，未接回 app，未启动真实模型，未提交。

- 新增候选公开数据的严格解析和独立绑定：验证已接纳的源审查/候选身份、八文档精确内容与摘要、差异及修复声明。首次入口限初审源结果和第 1 轮；同轮重试与后续轮次仍待公共复核连续性实现，不能借首次入口绕过。
- Reviewer 消费侧按原章节边界和字节规则重新核验变更，不负责 Revision 规划或正文写入。拒绝越权文档/章节、标题/标记变更、无进展和覆盖不足；仅 version/updated_at 的既有比较例外保留。整文操作保留完整 Markdown 校验。
- 修复源结果独立读取的一处实现缺口：格式问题可以已经定位到可信章节，即使另一文档完全无法建立索引，也单独重建前者的证据索引；不改变原格式问题的类别或范围。
- 定向事实准备从验证后的操作和公开最小事实切片重建；确定性检查与强语义 packet 保持原规则。修复声明不能替代缺失事实结果，也不能签发 PASS。初审 fact worker 的包内接纳逻辑提取为 Reviewer 私有函数，未引入阶段共享内核。
- 定向原生输出 schema 与旧版逐值对照相同；PASS 离线真实子进程执行通过。FAIL 严格校验 issue/expected/证据/摘要，服务自行注入允许范围。初审重试上限不能直接用于定向复核：核实旧 revision 派发和终态路径后，定向事实/语义的非法终态继续 retryable，并非初审的 2 次上限；新定向生命周期尚未实现该规则。
- 对照旧实现的测试移到模块目录外，模块内部的源码和 fixture 继续保持封闭依赖。曾出现的隔离测试失败已定位并修复，未通过放宽依赖规则绕过。后端 TypeScript、git diff --check 通过。

**P2-RECHECK-001：待用户决定，不静默修改冻结提示。** 旧 `worker-prompts.ts` 的 `semanticRef/modelSection` 去掉章节 digest；`foundationSemanticRecheckStructuredOutputJsonSchema` 却要求 FAIL evidence 携带 digest，`admitFoundationSemanticRecheckResult` 必须匹配 packet 的 SHA-256。模型只有正文且禁止工具，缺少可直接引用的摘要。独立测试复现了这项输入/输出不一致。已询问是否仅在定向复核模型输入中补回服务绑定的章节摘要；建议不改变审计规则、修复范围、问题身份或 PASS/FAIL 校验。当前尚未补回，原提示及既有冻结摘要不变。此决定影响定向 FAIL 原生闭环验收；不能以服务端手工构造的 FAIL 测试冒充模型已拿到所需证据。

本批固定代码后的完整联合回归：**253 passed / 0 failed，38 文件，2692 assertions，165.02 秒**。包含模块内隔离测试及模块外旧规则对照；后端 TypeScript、git diff --check 通过。中途一次回归加载旧模块后又读入新增轮次测试，出现混合版本失败；未将该次结果计为通过，固定代码后重新完整执行得到上述结果。待决项不因此视为解决，P2 仍未验收。

### 2026-09-06 P2 定向公共连续性与持久化收尾

用户随后明确批准 P2-RECHECK-001 的最小提示修正，并允许 Astra 主审编排、Luna high 执行。以下工作仍属于 Reviewer 私有实施，未接回 app；不是 P2 完整生命周期验收。

- 已补回定向语义提示的服务绑定章节 digest，模型可以引用 FAIL 所需摘要；没有放宽 FAIL 证据校验或扩大修复范围。原提示缺口不再是待决项。
- 复核公共结果包含候选完整摘要、轮次、逐问题和逐文档结论、失败重试问题集合。首次下一轮入口消费上一轮完成结果；同轮重试消费原始源结果、上个候选及上次复核的显式公共绑定，保留非失败文档字节并对当前完整候选重新检查，不把旧 PASS 直接当当前结论。
- 主审纠正一项审计误报：candidate resultId 是结果正文摘要，candidateResultDigest 是包含 resultId 的完整结果摘要，不能直接比较。真正的保留权威校验放在消费端：用原始完整问题表核对所有 verdict 的问题种类和 remediation 文档，包括已 PASS 而从剩余问题表省略的项。
- 定向状态机独立于初审任务集合，保持四共享槽、确定性失败延后语义、无业务重试次数上限、停止退还在途尝试、迟到终态拒绝及实际用量保留。配置失败仅可恢复从未派发的任务，不能以 resume 绕过已有不可恢复证据。
- 日志底层仅在 Reviewer 私有目录内抽取，初审 header/runId/路径/错误身份不变。定向 journal 重新验证 first/retry 的公共输入，使用 Reviewer 自己的 owner/project/request 身份，持久化源、候选、前驱数据和派生投影；只读重开不写文件。定向策略版本 v2 绑定复核政策、用量事件与未启用的遗留清理策略。
- 清理权威未实现时，journal 的统一 replay/reduce 边界一律拒绝 recover_lost；read/append/租约获取不能消费自签“清理完成”文件。未新增抢占 stale lease 或猜测 orphan 状态的逻辑。
- 定向发布从完成的 owner state 和接受回执重新派生结论，经与初审相同的不可变 result/COMMITTED 存储发布；不写 canonical 文档。统一注册存储让初审与候选模式共享不可变请求身份及 owner-bound handle，跨模式同请求不能悄悄覆盖。统一 public 工厂尚未开放。
- 新增纯定向计费 reducer，复用计费契约和事件 ID，不调用计费服务。历史尝试逐 dispatch 封存，未知用量不猜零；封存后新尝试仍可独立计量，已封存尝试包括幂等 accept 分支均不可改用量；owner/run 明确绑定。定向 outbox 与执行接线未完成。
- 新增候选 native 控制器被安全审查要求更明确授权，半成品已移除；不通过其他 agent 或拆补丁绕过。后续需要用户批准“控制器代码及离线 fixture 测试”范围，真实模型/旧项目/服务/数据库继续不在授权内。记录见 P2-EXECUTION-001。
- 原局部及混合格式修复路由缺少可执行定向权威，维持失败关闭并记录 P2-FORMAT-001；纯整文格式修复后重新初审的完整入口也仍待接线。

专项验证：发布 7/7、候选输入/统一注册 2/2、初审生命周期 5/5、定向 journal 6/6，均通过。固定版本完整联合回归最终 **284 passed / 0 failed，47 文件，3127 assertions，170.38 秒**；包含 Reviewer 模块内测试及模块外原规则对照。最终后端 TypeScript、git diff --check 通过。所有 P2 验收项继续未勾选，P2-EXECUTION-001 等待明确授权。无真实模型、网络、既有项目恢复、服务、浏览器、数据库或 Git 提交。

### 2026-09-06 P2 统一公开生命周期、整篇格式重审与有限恢复

用户后续明确授权候选 native 控制器、定向 outbox 的代码实现与离线假客户端验证。前述 P2-EXECUTION-001 授权阻断已解除；以下更新不追溯改写历史记录，也不表示 P2 全部验收。

- 候选控制器拥有定向事实、确定性与强语义执行、四共享槽、持久化认领／用量／终态、停止与重试。定向 outbox 逐 dispatch 封存和提交，失败／停止后在 worker 清理结束时尝试结算，未知用量保持 pending，不猜零、不写 canonical 文档。
- 统一公开工厂只暴露 start/getResult/resume/stop；公开参数不接受原始 command/env、运行器、私有事实或任务能力。三个模式共享不可变 owner/request/handle 注册；getResult 只读，从已绑定输入和自有日志重建期望结果并验证发布标记。
- 重复 start 不再为完成／停止／故障调用自动补发结果；缺失发布标记只能通过显式 resume 补齐。初审和定向 stop 都不能将无所有者的 running claim 变成可重试任务。
- 纯整篇格式修复由验证后的 document REPLACE 操作和原格式问题决定，重新使用完整格式、事实与语义审核。公开 full_format 证据绑定候选摘要和政策，新发现的问题从第 1 轮修复；局部／混合格式路线仍按 P2-FORMAT-001 失败关闭，没有修改冻结业务规则。
- 新增公开入口的 detached bundle 子进程验证；与已有 packet／native worker 独立打包验证互补，不加载作者、Revision 或编排实现。长进程全量测试曾出现一次 Bun 编译依赖文件读取错误，单独／配对重跑通过；公开 bundle 的编译现也使用独立子进程，随后重新完整回归，而非把该次失败算成通过。
- 从未认领 worker 的过期租约允许显式恢复：日志重放证明没有任何当前／历史 dispatch，旧所有者不存在，才发布绑定原租约及日志 head 的不可变后继标记。原租约保留；并发续接只能认领一个后继执行者。getResult 和重复 start 不会恢复。任何已派发遗留进程仍拒绝自动接管，详见 P2-RECOVERY-001。
- 进程身份 helper 只读诊断，不提供 cleanup authority。沙箱禁止 macOS ps/sysctl 导致 5 项诊断测试失败；获准仅在沙箱外检查测试进程和短命 fixture 子进程后，这组 6 项／19 assertions 全通过。没有向真实工作进程发送终止信号。
- **仍需用户决定：** 初审执行／发布抛异常后继续调用用量 outbox 的独立补丁被安全审查拒绝，未应用，已询问代码实现与假计费客户端离线测试授权。原初审异常路径继续保留用量和 lifecycle failure，等待显式续接；不通过其他路径绕过拒绝。详见 P2-INITIAL-BILLING-001。

固定版本最终分组回归：模块内沙箱测试 **311 passed / 0 failed，52 文件、3529 assertions、193.36 秒**；单独授权的只读进程身份诊断 **6 passed / 0 failed、19 assertions**；模块外旧候选规则对照 **2 passed / 0 failed、11 assertions**。合计 **319 passed / 0 failed，54 文件、3559 assertions**。后端 TypeScript 和 git diff --check 通过。此前失败运行保留为排障记录，不混入通过统计。

P2 验收项保持未勾选。未接 app、未部署、未启动真实模型／服务、未恢复旧项目、未提交真实用量或扣费、未修改计费 SQL、未提交 Git。

### 2026-09-06 P2 初审异常计费获准实施与直接子进程关闭观察

用户明确回复“允许”，并再次指定主 agent 审计编排、Luna high 执行。此前初审异常计费补丁未绕过拒绝，取得本次授权后才应用；没有可核验的 fast 模式开关，不宣称启用。

- 初审控制器清理后，即使执行／发布异常也尝试提交已记录用量；租约丢失不提交，未知／在途用量仍 pending，计费失败不覆盖原执行／发布失败。新增 3 项／25 assertions 验证发布失败、提交前不可用、假计费端已记录但响应丢失后的同键同 payload 幂等重放；P2-INITIAL-BILLING-001 关闭。
- native-worker 新增只在 child close 与输出解析队列排空后调用的 onClosed 等待屏障。捕获直接子进程 PID、退出 code/signal、请求的终止级别、usageObserved 和已 admission 结果／失败；不留 command/env/prompt/stderr。写观察失败则不返回可接纳结果；预启动取消无关闭观察，启动失败不虚构已测量的零用量。原 SIGTERM／SIGKILL 行为未扩大，观察不代表进程树清理。
- 新的 Reviewer 私有 native-completions 存储绑定 run/header/lease/dispatch/task/revision/packet，固定摘要路径、不可变写入、只读无副作用；所有三个 controller 在原 lease 下先完成观察记录，再提交 terminal。增加 leaseDigest 但不改变普通租约文件字节；只读 journal 禁止记录观察。该存储不签发审计、计费、cleanup 或 takeover 权威。
- 主审纠正 lease metadata 严格解析误拒绝函数字段、controller 闭包的 TS 收窄，以及 JSON 重复引用／稀疏数组校验。新增原生等待屏障和存储篡改／绑定／边界回归。过期租约仍只支持此前“从未 claim”的显式恢复；已派发恢复的完整验证／消费路径继续待做，P2-RECOVERY-001 和 P2 验收项不勾选。

固定版本分组回归：模块内沙箱 **325 passed / 0 failed，54 文件、3670 assertions、221.15 秒**；只读进程身份诊断 **6 passed / 0 failed、19 assertions**；模块外原候选规则对照 **2 passed / 0 failed、11 assertions**。合计 **333 passed / 0 failed，56 文件、3700 assertions**。后端 TypeScript、git diff --check 通过。全部为临时目录 fixture／假客户端，未启动真实模型、服务、既有项目或真实计费。

### 2026-09-06 P3 私有修复规则与初审交接基础

按照持续推进指示，先迁不依赖 Reviewer 遗留进程恢复的纯修复基础；不将 P2 缺口隐藏为完成，也不提前接回 app。

- 新增 foundation-revision/private 自有文档快照和 JSON 摘要。八份 canonical 文档保持原字节、UTF-8 长度及既有公开集合摘要编码，深复制／冻结返回值，拒绝重复路径、额外字段、accessor、隐藏／symbol 字段。JSON 编码拒绝非有限值、稀疏数组及循环，允许无循环的重复引用。
- 初审 source parser 只接收已由编排接纳的独立 owner/project/resultId/resultDigest 绑定和复制的 Reviewer 公共 issues_found；验证结果／输入／文档／问题摘要、section 与事实切片字节及修复范围。摘要不是签名，不以 payload 自带身份代替接纳权威。只处理 initial subject；passed、候选复核和私有 state 均拒绝。没有重跑 Reviewer 内容审计、FactStore/catalog、政策选择或签发 PASS。
- 新 planner 自行按已接纳问题规划批次，只接收章节权威数据数组、不接外部 registry callback；保留同文档合并、canonical 顺序、source/target 不扩大范围和整文格式修复窄授权。重复 section authority 是新数据边界拒绝，不冒充旧规则变动。
- 原 section index、game-document-contracts、topology 按冻结源码完整复制在 Revision 私有域，未引入其他阶段 runtime。原局部 worker Markdown parser、apply sections 与 section diff 提取保持规则；操作仍以真实 section text 摘要派生 INSERT／DELETE／REPLACE，并检查问题覆盖。此时只实现 section operation helper，整文完整性／操作发布仍待后续迁移。
- 主审纠正两项子任务偏差：批次两份新文件误放 Reviewer，核对创建时间及记录确认未覆盖原文件后移至 Revision；最小 section parser 的重写版本撤换为冻结完整副本，补齐缺失的旧局部解析／替换，并将 operation oracle 改为旧 Revision 而非只与 Reviewer 比较。先前小范围通过不作为纠偏后证据。
- 新增真实打包依赖审计，覆盖 snapshot、JSON、planning、Markdown 和 initial-source 五入口，只允许 Revision 私有实现、zod 与 node:crypto；不加载 Reviewer、Author、旧编排或文件写入执行。测试-only oracle 可以读取原实现，不属于生产闭包。

纠偏后固定版本：Revision **27 passed / 0 failed，8 文件、139 assertions**，包含八文档逐字 apply parity、冻结源码比较、三种 section operation 与旧临时文件式实现逐值对照、输入篡改和依赖闭包。Reviewer 沙箱完整重跑 **325 passed / 0 failed，54 文件、3670 assertions、219.27 秒**。最终后端 TypeScript、git diff --check 通过。此前 typecheck 的测试类型／ReadonlyMap 收窄错误已修正并重跑，失败运行不计入通过。

尚未实现 Revision candidate publication、retry predecessor 接纳、native 执行、计量、状态／停止恢复及 public 工厂，不据此勾选 P3；P2-RECOVERY-001 继续开放。下一步推进候选与前驱公开数据绑定，暂不做 canonical 覆盖、真实模型／计费、服务、既有项目恢复或 Git 提交。

### 2026-09-06 P3 初始候选、整文完整性与不可变发布基础

继续按原计划推进，以下只完成独立私有组件，不接 app、不签发审计通过。

- 初始候选构建调用本模块 source parser 和冻结 planner，由 Revision 生成 candidateId、固定初始轮次并计算真实修改操作；不接受外部 candidateId／changes／repairClaims／round。已声明修复与 unresolved 逐项覆盖源问题，未授权文档原字节保留。全部未解决／无变化拒绝。输出深冻结，部分保留和完整格式修复均通过 Reviewer 公共数据消费者的测试-only oracle。
- 旧 complete-game-document 505 行结构校验仅调整两处本地 import 后迁入私有域，旧全文 wrapper 保持源码；八文档正反行为与全文 REPLACE 操作逐项对照旧回执式实现。整文操作绑定原 digest、DOCUMENT_FORMAT_INVALID 和窄文档授权，不重跑事实抽取或内容审核。
- 新 candidate_ready schema 独立校验 JSON、身份／结果／八文档摘要、修复声明与操作覆盖、重复／混合 scope，拒绝额外审计注册等字段。它是结构及字节 gate，不单独授予源问题、实际修复或前驱权威；private 发布 sink 只能由后续自有持久执行证据生产者调用。
- 候选发布只写 `.beegame/workflow/foundation-revision/results/<resultId>/` 中自包含 result 与 COMMITTED 标记；临时文件 sync、不可覆盖链接提交、目录 sync 后可见。缺 marker 不可见；已提交缺正文／冲突／篡改拒绝。重复和并发提交同值幂等，caller mutation 在首次 await 前截断，canonical 文档不写。静态 symlink／非目录拒绝；不声称可抵御恶意并发进程替换所有祖先目录的 OS 级 TOCTOU。
- 主审采纳独立事实边界发现：新增 23-key 冻结数据投影（owner、valueType/valueSpec 以及旧 Revision 提示所需 presence/extractionInstruction/sourceOfTruthDirection）和 3 条 contract endpoint 对，仅作数据，不迁审计策略／执行。initial-source 现检查允许的非递归事实闭包、所有者和值约束；测试证明合法跨文档另一端仍接纳，不相关 key、错 owner 与无效值拒绝。
- 依赖打包验证覆盖十个纯入口（只允许本模块、zod、crypto）及发布入口（另允许 fs/path），不加载其他阶段、旧 runtime、进程或网络代码。全量运行曾出现一次 Bun 默认 loader 读取 zod 失败；测试改为在路径审计后显式提供所读内容，再完整重跑，未忽略错误或将失败算通过。

固定版本验证：Revision **51 passed / 0 failed，13 文件、379 assertions、3.19 秒**；后端 TypeScript、git diff --check 通过。Reviewer 生产代码未修改，本轮未重新累计此前 325／333 项回归。未启动真实模型、服务、旧项目或真实计费，未提交 Git。

P3 仍不勾选：candidateId 的持久化生命周期、同轮 predecessor／保留接纳、后继轮次、native/计量、停止与恢复、public 工厂待实施。P2-RECOVERY-001 继续开放，P4 不提前接线。

### 2026-09-06 P3 同轮前驱、局部保留与后继轮次的私有数据闭环

- 新增独立 recheck 解析及一致性校验，按公开版本验证 full_format／targeted、问题与文档 verdict 覆盖、失败重试集合、DEFERRED 与 NOT_CHECKED、诊断章节摘要。复用的 source 字节／事实 gate 仍仅位于 Revision 私有目录，不重跑 Reviewer 内容审核。
- 新修复基础只接受 initial issues_found、full_format 的新问题或 targeted round_complete 的新问题；passed 和 retry_same_round 不作为新一轮基础。初始／全文重审后轮次为 1，完整定向复核后加 1，安全整数溢出拒绝。
- 同轮 retry 解析独立接纳的原 source、上一 candidate 和其 recheck，重算上一候选实际操作，并逐项绑定 owner/project、原基础、完整结果摘要、candidateId、轮次、上上一候选 ID、问题种类和文档归属。只取失败文档的 retryIssueIds；PASS／DEFERRED 文档字节及既有修复声明保留，不把 DEFERRED 解释为通过。
- 后继候选复用本模块字节差分／构建规则，生成新 ID，并把明确的前驱五字段绑定写入结果。同轮基于原文档集合计算操作；新轮基于 Reviewer 新问题结果的文档集合。Revision 输出仍仅为 APPLIED 声明／未解决事项，最终 PASS 只来自 Reviewer。
- 主审撤回子审误加的“remaining issues 必须等于旧 non-PASS verdict”限制：本轮全 PASS 后仍可产生下一轮新问题。增加新问题正例和精确诊断反例后保持旧语义。另一次子审的类型检查报告不对应当前隔离 worktree，未作为验收证据；主 agent 在明确工作目录修正本轮测试收窄错误并重新完成全包检查。

固定版本主审验证：Revision **69 passed / 0 failed，19 文件、489 assertions、5.99 秒**；后端 TypeScript 和 git diff --check 通过。含真实公共 fixture 的 initial→candidate→recheck→retry／next-round 数据闭环、PASS／DEFERRED 保留、两次同轮重试、迟到旧复核拒绝、全文重审后第 1 轮，以及 16 个纯入口与发布入口的实际打包隔离。Reviewer 只在测试 oracle 中使用；生产文件没有修改 Reviewer、旧 controller 或 canonical 文档。

仍未迁 native 执行、任务／候选身份持久化、计量、停止／恢复及 public 工厂；上述闭环是私有纯数据与发布组件验收，不代表现有 app 已接线或 P3 全生命周期完成。P2-RECOVERY-001、P3 与 P4 门槛不变。未启动真实模型、服务、旧项目或真实计费，未提交 Git。

### 2026-09-06 P3 请求身份、候选快照与执行输入准备

- 新增严格的 initial／next_round／retry_same_round 私有请求准备。owner/project 与独立 source binding 校验；不接受调用方的 round、batch、candidateId、保留列表等执行权威。根据原问题集合与公开复核分别计算修复声明集合、实际派发集合及未解决事项。失败文档从原 source bytes 开始，PASS／DEFERRED 文档保留前驱候选原字节。
- 请求记录仅写入 Revision 自有 requests 命名空间，owner/project/requestId 经完整 tuple 摘要生成路径。同步捕获输入后，临时文件同步、hardlink 独占提交、逐层目录同步；并发同输入与磁盘重放返回同一 handle／candidateId，同键不同输入与磁盘损坏拒绝。32 MiB 上限与真实目录／NOFOLLOW／常规文件检查不代替宿主认证。
- 私有 candidate commit 使用已持久化 candidateId，并在发布之前保存不可变 candidate.json。重放同结果不重新分配身份，同请求不同候选正文拒绝覆盖；同轮复核的前驱、保留字节与未解决范围仍须验证。此函数尚未连接执行终态／停止状态，不能视作已实现整个生命周期。
- 新增纯 worker packet 重建：精确 dispatch issues、写章节与只读 source/target 证据、事实引用过滤、静态事实约束和完整文档结构保留契约。旧 revision/taskId/derived-state 字段不伪装成新身份；新私有 packet 绑定 requestDigest、源结果、轮次及基础文档摘要。
- 主审确认并修复了“source/target 证据切片不一定包含 remediation section”的漏项。现在从已绑定原文中重建所需文档的私有章节索引；真实 semantic GDD source → UI remediation fixture 覆盖该情况。另确认旧 controller 的 packet issues 保持源 registry 顺序，不因 batch ID 排序而改写。
- worker 模型投影与两种原提示文本保留；全文仅在内部 packet 保存，不进入模型投影。纯提示端不承担 native staged-path／工具次数 gate，这些仍须后续执行端实现。严格 JSON 检查后保留嵌套对象插入顺序，避免 canonical 排序改变冻结提示字节。

主审固定版本验证：Revision **80 passed / 0 failed，22 文件、697 assertions、6.85 秒**。覆盖 8 文档完整结构契约、跨文档 section packet、带／不带重试原因的完整提示字节对照、持久同轮候选交给 Reviewer oracle、并发／重放／异输入冲突及损坏／symlink 拒绝。实际打包隔离包含 19 个纯入口与两个私有文件存储入口；Reviewer／旧工作流仅用于测试 oracle。

仍未接 native 模型、工具／回执、执行日志、计量、停止／恢复、public 工厂或 app；上述候选持久化不能代替执行回执权威。未访问旧项目或真实计费，未启动服务，未提交 Git。P2 恢复问题、P3 全生命周期验收与 P4 接线门槛保持不变。

### 2026-09-06 P3 原生正文协议准备

- 独立的纯内存 Markdown parser 保留旧增量／尾行合并、terminal 文本优先、CRLF／trim 和字节上限。重复终态、终态后正文、关闭块后正文增量拒绝；异常捕获保持失败，完成结果重复读取稳定。document 范围仅容许原只读工具名称，解析不代替工具授权或回执提交。
- 独立 visible-Markdown gate 保留原 native 首次空成功结果的截留与一次重启提示。已出现可见文本的空终态、第二次空终态仍拒绝；错误结果交给后续失败与计量处理。gate 不自行启动重试进程。
- 主审修复文本块关闭后误拒合法工具参数增量的条件顺序；补充 malformed JSON、晚到事件及 UTF-8 上限测试。保留旧 sink 对未闭合文本块重试的拒绝，以及明确 success subtype 要求，不用重置 parser 宽松接纳异常协议。
- 旧文件式 sink 在临时目录运行 oracle，三种固定流的规范化正文与新 parser 逐字节相同；不把正文协议测试当成完整文档或审计通过。依赖打包检查纳入这两个纯入口（合计 21 个纯入口）。

主审验证：Revision **93 passed / 0 failed，25 文件、761 assertions、6.79 秒**。native 进程接线、私有工具桥接与文件权威、执行终态／计量日志、停止恢复与 public 工厂仍未完成；P3/P4 不勾选。未运行真实模型或服务，未提交 Git。

### 2026-09-06 P3 临时读取权威与 native 执行授权停点

- 新增自有临时 native assignment：从严格绑定请求重建可派发文档及冻结提示；禁止外部指定工作根、文件路径或非派发文档。进程 cwd 为空目录，整文读取副本位于另一自有临时目录，文件权限 0600，字节不归一化；章节任务不配置全文读取桥。临时路径不是恢复检查点或执行回执。
- 通过旧内置 native 的只读 helper 对照验证空参数、单次读取与实际分配原字节。这里只测试工具实现函数，不启动模型进程；新 Revision production 没有导入旧 helper。三项测试、19 assertions 通过。
- 新增 `native-process.ts` 的实现尝试被安全审查拒绝：它会运行配置指定的本地命令/cwd/env，并向自有子进程发送停止信号；该精确副作用须用户明确授权。未落盘该 executor／测试／fixture，未改用间接实现，不启动真实模型。主流程在此等待授权；其余已完成纯组件继续核验，不视为 P3 完成。
- 自有纯用量捕获仅保留有限非负计数，不持久化模型正文、模型名或凭证。按原语义区分累计 modelUsage 与在途 wire 计数，保留 counter-reset epoch；空／零 modelUsage 不覆盖实际 wire 观察。主审修正字段别名漏项、零快照遮盖与单／多模型求和溢出；reducer 拒绝伪造总数和空 cumulative result。测试用原始消息的每个前缀与旧规则 oracle 对照，不将新捕获结果反向包装成唯一对照输入。该组件尚未接计费客户端或 durable outbox。

停点前主审最终验证：Revision **106 passed / 0 failed，27 文件、809 assertions、7.15 秒**；package TypeScript 检查通过。依赖隔离覆盖 22 个纯入口及三个私有文件组件；进程执行仍未实现，不能以这些测试宣称 native／停止恢复／扣费闭环完成。全部变更未提交。

### 2026-09-06 P3 已授权本地 native 执行与用量收尾

- 用户随后明确同意按建议推进，本地 executor 与固定假进程测试的授权停点解除。新增独立 native environment 和 process；本轮只运行固定 Bun fixture，不调用真实模型、网络服务、既有项目或计费。环境按冻结配置键过滤并覆写自有读取桥，进程不隐式继承完整宿主环境。参数固定、shell 关闭，工具仅允许 document 的 ReadAssignedFoundationRevision；stdio 权限请求全部拒绝。
- executor 接入私有 Markdown parser、一次同会话空结果补发、2 MiB 正文限制及单独的 32 MiB 传输上限。合法正文终态只是临时执行结果，不是 complete-document 回执、候选接纳或审计通过。终态后的业务消息不再改变正文；原始消息的独立副本仍交给用量观察者。
- 主审纠正输入 JSON 克隆误伤 callback/signal、预取消仍可能启动进程、丢失迟到用量及正文/传输限额混用等问题。失败和取消保留安全错误代码，不外泄 stderr；TERM 后按宽限仅 KILL 自有直接子进程，等待 stdout/stderr 与 child close。记录 scope=direct-child，不宣称后代全部退出或已有跨崩溃恢复权威。
- 本地集成验证 assignment 原字节读取、隔离环境、独立消息副本、终态后用量以及观察者失败后的缓冲用量收尾。权限 fixture 必须核对 request ID、deny、toolUseID 和拒绝分类才返回成功。尝试强化真实 EPIPE 的 fixture 未稳定触发写错误并超时，已撤回；最终只验证提前关闭 stdin 后缺终态的安全失败，不声称获得真实 EPIPE 覆盖。

主审最终固定版本：Revision **123 passed / 0 failed，30 文件、921 assertions、8.79 秒**。实际依赖打包覆盖 22 个纯入口、四个私有文件组件及独立进程入口。后端 TypeScript 与 git diff --check 通过；失败运行不计入通过。未改 Reviewer 或旧 controller，未提交 Git。

P3 仍未验收：执行回执持久化、阶段状态与停止/恢复、用量 durable outbox、认证/计费公开接入及 public 工厂待实施。后续迁移须保持旧 document-revision 开放修复循环（不套用事实/语义两次上限）、停止退还 attempt，以及 completed 回执先于回调、回调失败不得重跑的原语义。P2-RECOVERY-001 和 P4 接线门槛不变。

### 2026-09-06 P3 单次执行回执与追加式尝试记录

- 新 `worker-output` 从已接纳请求重建 packet、base、issue/section 权威。整文使用冻结完整性 gate，章节使用原 parse/apply 与逐字节操作派生；不接受 worker 自报 operations/digest。主审撤掉子任务额外添加的 trim 无进展判定，改用旧 apply 的接纳结果和正文逐字对照，避免迁移时悄悄收紧空白规则。最终仍由原字节差分 gate 检查进展及精确问题覆盖，不新加内容审计或 DEFERRED 策略。
- 新私有 attempt journal 位于已持久化 request 的自有目录，每个文档独立追加。事件绑定 request/handle/packet/document、顺序号及前一事件摘要；临时文件 sync、hardlink 独占序号、目录 sync。并发 start 只有一个调用获得可派发身份；同值终态并发幂等，异值冲突。读取重新推导完整正文、操作及用量，拒绝断链、缺口、篡改、非普通文件和静态 symlink；不声称能防御恶意并发祖先替换或完整历史尾部被有权写盘者删除。
- 新私有 owned-attempt 将持久 start → 自有临时 assignment → native 关闭与迟到用量收尾 → 正文接纳 → 持久 settlement → 完成回调接成单次执行。回调失败不降级已完成记录；重开后对原终态做同步重放，不再启动 worker。原生配置、凭证、stderr 不进 journal。无效正文和 native 失败保持 retryable，第三次及之后仍能修复；重试提示携带本模块安全失败码。
- 预取消和运行中取消都在已知直接子进程关闭/未启动后保存 stopped 结果并退还 attempt，下一次分配新 UUID。测试假进程仅在自有临时目录写 readiness 标记，以确定运行中取消场景；捕获到的用量随终态持久保存。遗留 running 记录一律阻止重新派发，不凭时间、空 PID 或新 controller 自动接管；未知关闭状态也不授权清理临时读取目录或重试。

- 独立复审补出的耗时与失败/停止汇总读取缺口已修复：start/settlement 由 owner 记录 startedAt、finishedAt、durationMs；重读验证时间差，失败/停止的 lastReceipt 直接带回持久用量与耗时。同值并发提交以真正获胜事件的时间为准，不因两个调用取时不同破坏幂等；增加时间篡改与重开汇总测试。

主审固定版本验证：Revision **141 passed / 0 failed，33 文件、1028 assertions、10.65 秒**；后端 TypeScript 与 git diff --check 通过。实际打包隔离新增纯 worker-output、文件 journal、组合 executor 入口，仍不引入 Reviewer/旧 runner 生产依赖。测试中的旧规则和 Reviewer 仅是 oracle，全部 native 执行仍为固定本地 Bun fixture。没有真实模型、服务、计费、既有项目恢复或 Git 提交。

边界仍开放：这是私有单次尝试，不是整个阶段生命周期。尚未持久化运行中 stop 意图、在途用量逐事件日志/outbox、跨崩溃进程关闭权威、所有文档回执驱动候选提交、认证/计费 public 客户端及 start/getResult/resume/stop 工厂。终态保存的用量不等于可恢复计费；普通 journal API 也不自行证明进程关闭，只有 owning executor 可供给观察。P3/P4 保持未勾选，P2-RECOVERY-001 不关闭。

### 2026-09-06 P3 回执驱动候选发布与在途用量日志

- 新私有 completed-candidate 入口仅接已接纳请求，不接受外部候选正文、回执列表、跳过集合或 candidateId。它要求每个确定性派发批次都有完成回执，重读、重算并同步终态；按自有 staging 拼接正文，重新核对操作与来源权威，保留已接纳前驱的 PASS/DEFERRED 字节及 unresolved 范围。先提交不可变 candidate-receipts 清单，再提交候选快照和公开结果，未完成、运行中、停止或失败不能冒充“跳过后发布”。
- 清单绑定 request/handle/candidate、每份完成回执摘要、packet/文档摘要、结果摘要及前驱；不把私有清单扩进公开 candidate 契约。并发及重放保持同一候选，发布 IO 失败后从同一清单/快照续行，不重跑 worker，也不覆盖 canonical 八文档。另以真实同轮 DEFERRED fixture 验证仅失败文档有新派发，保留文档不被改写，最终候选仍可由 Reviewer 公共数据消费者接纳。固定本地 native fixture 已贯通到此发布入口。
- attempt journal 增加按 attemptId/连续 observationIndex 绑定的用量观察事件，只保存规范化计数。原累计 modelUsage epoch、counter reset、wire 最大值和零值规则保持；观察同值并发/重放幂等、异值/跳号/迟到新事件拒绝，重开 running 可读取已保存观察但仍不能接管执行。主审补充合计溢出提交前拒绝，避免单条计数合法而累计溢出污染日志。
- owned-attempt 在 native 消息回调中等待用量落盘，包括终态后迟到消息。settlement 用量数组必须与持久观察逐值一致，不能靠调用方终态数组补出未保存用量。实际本地故障注入在假进程 ready 后阻断观察文件，验证 observer 失败仍收尾子进程，但保持 active/需显式恢复，不保存猜测零总量、不发布候选、不自动重跑。日志不保存原始消息、模型正文、配置或凭证；业务正文仍只保存在独立完成回执/候选中。

主审固定版本验证：Revision **155 passed / 0 failed，35 文件、1123 assertions、13.15 秒**；后端 TypeScript 与 git diff --check 通过。主审修正两个测试类型收窄问题后完成全包检查；失败检查不计入通过。依赖打包加入 completed-candidate 文件组件入口，没有 Reviewer/旧 runtime 生产依赖。未启动真实模型、服务、真实计量提交/扣费、既有项目恢复或 Git 提交。

尚未完成：请求级 stop/begin/terminal/publication 的统一持久顺序、跨崩溃关闭权威、计费 outbox/确认及 public 工厂。尤其不能把“native 返回后读一次 AbortSignal”或每文档独立 stop flag 当成请求级原子屏障；当前单次取消没有解决 native 成功返回后与 settlement 并发的 stop 顺序。下一步需在同一请求级提交顺序中处理这些事件，崩溃的 active 尝试仍失败关闭，P2-RECOVERY-001 与 P3/P4 门槛保持开放。

### 2026-09-06 P3 请求级停止与发布仲裁

- 将私有执行记录收敛为同一请求的 `execution-events` 追加日志，跨文档 begin、用量观察、终态、stop/resume 和候选发布授权共享序列与 CAS 提交顺序。竞争失败后重新加载并重新判定，不靠进程内锁或独立文档 stop flag。旧私有 `attempts` 布局明确拒绝并保留数据，不静默迁移。
- stop 先提交时阻止新 begin/发布授权，晚到成功或失败终态转为 stopped，保留已排空的用量与关闭观察、退还尝试计数；已提交 completed 回执不可被晚到 stop 改写。resume 需不存在 active 尝试；控制请求 ID 全局幂等、冲突拒绝，重放旧 stop 不会撤销后续 resume。
- owning executor 先持久化外部取消意图再取消自有进程，并轮询共享请求日志接收独立实例的 stop。停止响应仅确认意图，不能等同进程关闭；恢复需等待关闭/终态。日志 IO 失败仍阻止猜测结算与重派发，修正用量失败被轮询失败掩盖的诊断优先级。
- 候选从全部 completed 回执重建并在同一日志中封存发布授权，再进行原有不可变清单/快照/COMMITTED 发布。授权后的 stop 只留审计记录，不降级已封存结果；发布 IO 故障可沿同一授权和回执重放，不重跑 worker。
- 主审新增独立 store 停止真实固定离线子进程、旧布局保留拒绝、发布中 IO 失败与晚到 stop 重放断言；子 agent 补充跨文档 CAS、控制 ID、stop/settle 顺序、发布仲裁测试。首次全量发现一个用量故障诊断优先级问题和一个新增断言类型问题，修复后重跑。

固定版本验证：Revision **167 passed / 0 failed，36 文件、1190 assertions、14.88 秒**；后端 TypeScript 与 git diff --check 通过。仅运行自有临时目录中的固定离线假进程，未调用真实模型、服务、计费提交、旧项目恢复或 Git 提交。

尚未完成：跨崩溃进程关闭权威、计费 durable outbox/确认、认证/计费 public 接入与阶段 start/getResult/resume/stop 工厂。当前 begin 是派发授权，不声称与 OS spawn 原子；无法证明已崩溃 active 的关闭时仍拒绝接管/恢复。请求级私有仲裁通过不等于整个 P3 验收；P2-RECOVERY-001 与 P3/P4 验收门槛仍开放。

### 2026-09-06 P3 用量确认与独立 public 生命周期

- 用量 outbox 直接从不可变 terminal receipts 派生，不接受外部用量覆盖或运行中观察作为可提交终态。成功、失败、停止均保留真实用量；零量通过现有 billing public 的 skipped 语义确认，不另建账本或计价规则。
- 逐 attempt 的稳定 eventId 绑定 owner-assigned handle、attempt 和规范化用量。外部 record/debit 成功但响应／本地 ack 丢失时复用同键；严格验证公共 receipt 的 owner、eventId/idempotencyKey、usage 和版本，允许并发重放仅 duplicate 标志不同，后端收据 ID/金额证据不允许替换。ack 仍进入请求级 CAS 日志。
- 新增持久 opaque handle 索引与只读重开。public 工厂只提供 start/getResult/resume/stop；输入含独立 digest 和证据绑定，运行配置由 owner-bound runtime-configuration public 能力取得，认证/计费实现没有复制进 Revision，也没有原 controller/worker callback 注入。
- 自有执行租约提供跨实例互斥；自有调度保留四个文档 worker 上限并在共享 journal 再次限额。document repair 继续开放重试；三次正文失败后第四次成功的离线 public 测试证明没有套用事实／审核的两次上限。完成回执先于计费与候选发布；重启、重复 start 和计费确认恢复不重跑已完成 worker。
- stop 返回的只可能是已记录意图／等待关闭或确认 stopped，不把意图当作清理证据。闲置 continuation 在日志记录控制命令，无需伪造失败；重复旧命令不改变新 active 尝试，跨 stop/resume 的 ID 冲突拒绝。结果已经可见但旧 owner 尚在计费收尾时，接受的 continuation 会等待／排队，不丢失恢复请求。
- 主审补强三类竞态：同 token 并发 release 只执行一次，旧 release 不能删除后继；获取 owner 后、返回能力前的 sync/临时文件清理失败仅回滚精确自身 claim；配置／执行／计费 catch 中的内部失败写入先确认自身所有权，未获得或已释放所有权的异常不得污染后继日志。计费异常不覆盖首个执行／发布错误。
- 验证已覆盖公开初始修复、跨实例停止/恢复、授权失败续接、计费确认丢失、五文档四并发、同轮 PASS 字节保留、独立打包运行以及不明 active/stale owner 失败关闭。公开 getResult 的文件快照前后相同；生产 public bundle 不含 Reviewer/旧 runtime 或基础设施实现，只有本模块和允许的语言依赖。

本轮固定版本验证：Revision **203 passed / 0 failed，46 文件、1407 assertions、59.24 秒**；后端 TypeScript 与 git diff --check 通过。新增真实 public Reviewer → Revision → Reviewer 离线交接：初始整文格式问题、Revision 自有假进程修复、Reviewer 完整格式复核分别由对应模块生产，三次重复 start 均返回原句柄且结果不变。该用例验证 full_format 路由、来源／候选绑定及新一轮事实/语义执行，不宣称真实模型质量或局部／混合格式路由已解决。

本轮仍未运行真实模型、计费服务／数据库、既有项目恢复或 Git 提交。P3-RECOVERY-001 已单列：stale owner 不自动接管，direct-child 观察不扩大为进程树清理；P2-RECOVERY-001、P2-FORMAT-001 也未因此关闭，P3/P4 保持未验收。

### 2026-09-07 P3 公开下一轮与联合回归收口

- 新增 public next_round 离线执行：使用 Reviewer targeted publication 生成上一轮复核的新问题，核对新问题 ID 不属于旧问题集合，再由 Revision 独立公开入口执行第 2 轮。来源 ID/digest、基础文档摘要与新 candidateId 均绑定；只修 Technical，其余七份文档逐字保留。重复 start 返回同一句柄，固定 native fixture 只执行一次，canonical 八文档哨兵不被覆盖。
- 补充 TypeScript 解析／模块解析审计：Revision 全部生产源码含被打包器擦除的类型导入只能使用自身代码或批准的 billing/runtime-configuration public；全 packages/apps 的静态 import、export、import type、import-equals、require/import 字面量不得进入 Revision 私有实现。实际 public bundle 的传递运行依赖审计仍保留；未把不存在的应用接线算作消费者验收。
- 首次完整后端联合运行是 **1843 passed / 7 failed，1850 项、277 文件、15589 assertions、389.85 秒**，不计为通过。五项失败来自受限环境禁止只读 ps 查询；经授权在受限环境外复跑进程身份诊断组 **6 passed / 0 failed、19 assertions**。仅查询测试自身／自有短命子进程，safeForCleanup 仍为 false，不改恢复策略。
- 另两项长套件打包失败单跑不复现。Revision detached 编译改为独立且有超时的自有 Bun 子进程，仍实际执行／重开包含全部依赖的输出；Reviewer detached-packet 的依赖审计 loader 直接提供已检查文件字节，保留全部边界和执行断言。只有测试设施改动，没有修改 Reviewer 生产行为；具体联合稳定性以固定版本复跑为准。

主审固定版本 Revision 全量加 Reviewer detached-packet 专项：**207 passed / 0 failed，49 文件、1462 assertions、63.17 秒**；后端 TypeScript 通过。该数字含 Revision 206 项和 Reviewer 专项 1 项，不表述为 Revision 单模块 207 项。

同一固定代码版本完整后端复跑：**1853 passed / 0 failed，279 文件、15669 assertions、391.78 秒**，git diff --check 通过。此次经授权运行只读进程诊断所需的非受限环境；没有跳过失败项或降低断言。两个打包测试和全部进程身份测试均在联合套件通过。结果不代表真实模型／服务验收，也不关闭跨崩溃执行清理及局部／混合格式路由缺口，P2/P3/P4 验收门槛不变。

### 2026-09-07 P3 未派发租约恢复授权停点

只读审计形成了未派发恢复方案：完整历史必须从未出现 attempt_started，已接受的控制 ID 固定绑定一个失联所有者，先持久控制再创建不可变后继标记，保留旧文件并验证真实 generation 路径。旧命令重放不能授权下一代失联所有者；已派发及未知关闭仍失败关闭，不新增孤儿进程 kill 或 supervisor。

实现过程中后继租约补丁被安全审查要求用户直接授权。主审已撤回本轮未完成的恢复 schema/helper、store/public 接线和恢复测试草稿，恢复此前 stale owner 不可接管的状态；保留已经通过的 next_round、依赖隔离及联合测试设施改进。恢复控制层曾单独测试通过不代表完整恢复已实现，该临时结果不计入当前通过数量。没有运行新恢复流程或操作既有项目。具体风险与待确认范围见 P3-RECOVERY-001。

撤回后主审复检：Revision **206 passed / 0 failed，48 文件、1449 assertions、63.77 秒**；后端 TypeScript 与 git diff --check 通过。未完成恢复的新增符号及测试均已移除；当前仍拒绝接管 stale owner，等待用户对上述精确范围直接授权。

后续范围校准：用户要求“按照计划，不属于计划内的不新增”。上述后继租约提案保持未实施，不再作为新增工作或额外验收门槛。后续只按既定 P0—P6 项目推进迁移、业务等价验证、公开交接和已规划接线；保留既有安全拒绝与历史记录，不擅自引入进程监督、新恢复协议或改变原业务策略。原计划尚未通过的验收项仍需证据，不因范围收敛自动勾选。
