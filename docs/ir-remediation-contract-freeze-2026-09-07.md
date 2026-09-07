# IR-0：整改基线与公开边界冻结

日期：2026-09-07。状态：IR-0 主审通过。固定源清单 107 项、19 个补充边界和 11 项 Foundation 保护差异已通过独立校验，隔离基线重跑为 903 pass / 2 个已知 fail，根 typecheck 通过；详见[执行证据](ir-remediation-execution-evidence-2026-09-07.md)。本文件冻结整改/迁入约束，不声称对应公开 API 已实现，也不关闭 F1—F8。

## 1. 执行基线

- Foundation 目标：`484e77806cbd044bf3a3c5a9e665428286a2894f`，分支 `codex/game-ir-isolation-recovery`。本轮全部既有改动已提交，禁止用旧 IR 分支覆盖它。
- IR 来源：`4335363b2cd33d1f0b7bd807bff95d9389c67ce1`；参考前序 `b47641f33`。整改只在从固定来源建立的隔离工作区执行，两个来源工作树不改动。
- 主计划：[整改与接入计划](game-ir-module-implementation-plan-2026-09-07.md)。F1—F8 和 IR-R0—R6 均保留独立状态；R6 前不迁入生产模块。
- 已有测试基线：IR 635/0，外层 268/2，根类型检查通过。两个接线失败与三个符合性反例不因目录测试通过而豁免。
- 六域、唯一字段生产者、Foundation 文档业务权威不变。F1 的循环身份/操作协议决策留给 IR-R1 主审；不得把此冻结误当作已经选择修复实现。

## 2. 当前输入与未来公开输入的逐字段映射

输入由宿主授权的应用交接层构造，IR 仅接受自包含数据；业务 JSON 中的 ownerId、projectId 或摘要不是身份认证。模块工厂绑定的可信上下文必须与每次调用匹配。

| 项目 | 目标合同 | 当前证据/迁入要求 |
| --- | --- | --- |
| 身份 | 宿主绑定 ownerId/projectId；请求携带相同归属用于摘要校验 | 不由 billing 推导，不接受 worker 自报身份 |
| 通过结果 | 完整公开 ReviewerReviewResult，kind=passed、issues=[]；绑定 resultId/resultDigest/inputDigest/policyDigest | 来自当前 Reviewer 公共端口的已接受调用，不伪造旧 FoundationAuditState |
| 文档 | 直接捕获 review.documents 的八份精确 content/path/digest/byteLength，唯一 canonical 顺序 | 每文档 SHA-256 UTF-8 字节；documentSetDigest 沿用当前应用算法，不改变原 Reviewer 的摘要算法 |
| 发布 | 应用受限产物能力证明 publicationId=review.resultId 已完成发布，并绑定 documentSetDigest 与不可变 snapshot 摘要 | 当前 publishFoundationAcceptedArtifacts 只返回 revision；需要在 IR-2/IR-5 增加明确的证明投影/校验能力，不能传一个自报 published=true，也不能把只读 snapshot 存在当项目发布成功 |
| 来源版本 | foundationRevision=documentSetDigest；同时保存 review resultId/resultDigest，区分同文档的不同审核策略/结果 | 不照搬旧 revision publication authority 或旧私有 Issue Registry/Fact Store 字段 |
| Brief | confirmedBriefDigest 由已接受应用交接绑定，不能从候选 recheck subject 中猜测 | 它与 review subject lineage 一致；不向 IR 借入 Reviewer 私有 request |
| source index | IR 自己从已捕获文档派生、版本化并校验的 index | 不借用 Reviewer 私有 SectionIndex。R2 的 occurrence/byte-range 修订必须进入该派生器合同 |
| 编译版本 | schemaVersion、compilerContractDigest、sourceSelectorDigest、validatorPolicyDigest | 旧 game-ir.v1 领域合同与新公开生命周期协议分开版本化；R1/R2 改变语义或持久化时明确升级，旧输入/旧 journal 拒绝，不自动迁移 |

只接受 plain JSON/明确字节；拒绝未知键、非有限数字、稀疏数组、重复/越界路径、跨主体句柄和未知协议。摘要检测篡改，不能替代可信端口的 producer 认证。不得新增第二份可编辑文档或读取活动项目文件为 IR 补值。

摘要和大小边界冻结如下：对象键按 JavaScript `.sort()` 顺序排列，数组保留顺序，标量用 `JSON.stringify` 编码，再取 UTF-8 SHA-256 小写十六进制；进入编码器前完成上述严格 JSON 校验。Reviewer `resultId` 对去掉 `resultId` 的完整结果求摘要，`resultDigest` 对包含 `resultId` 的完整结果求摘要。文档正文不 trim、不归一化换行或 Unicode；`documentSetDigest` 特例固定为 canonical 顺序的 `[path,digest]` 二元组数组经 `JSON.stringify` 后求摘要。新 IR `inputDigest` 覆盖版本、可信归属的复制字段、完整通过结果、发布绑定、confirmedBriefDigest 和四项编译版本字段，不包含请求/执行时间、requestId 或运行期状态；具体序列化字段表在 IR-2 实现前须以 golden fixture 主审核准，不能直接复用旧 compile request 的不同摘要。

恰好八份 canonical Foundation 文档，文档计数不是可调 token 限制。当前应用产物存储的单个序列化 snapshot 传输上限为 32 MiB；受限能力须公开并在调用前校验该字节上限，超限返回明确技术错误，不截断文本、不减少 source occurrence、不作为 Foundation 缺陷。IR 不额外设业务长度、尝试次数或 token 截断上限。现有 `readProjectArtifactPublicationToken` 仅返回 token 且拒绝 pending transaction，本身不提供完整主体/结果/快照证明；IR-2/5 必须补齐这些绑定，不能把该 token 直接冒充完成的公开发布凭证。

## 3. 生命周期合同

唯一生产入口冻结为 `stage-modules/game-ir/public.ts`，暴露 `start/getResult/stop/resume` 与授权已发布读取；应用薄交接层冻结为 `delivery-workflow/game-ir-link.ts`。这些是 IR-1/3/5 的待实现位置，不声称文件已存在。工厂注入受限能力，调用 payload 不携带 callback、私有 store、DeliveryRun 或 shell。

- start：稳定 requestId + 完整 inputDigest。同身份同请求同摘要幂等；同请求不同摘要冲突拒绝。先持久化输入/身份，再产生执行。
- handle：包含协议与 producer 标识的不透明 ID，必须映射模块自有归属。句柄不是任意路径，不能跨项目使用。
- getResult：严格只读，不 flush、恢复、重试或补写 marker；返回运行状态与可靠用量状态，失败不伪装 completed。
- stop：停止意图先持久化，禁止新派发，要求现有执行的关闭证据。未知关闭返回 needs_action，不重派、不推断关闭成功。
- resume：显式、幂等的控制请求，只允许同一有效输入身份。验证 journal/CAS/执行关闭后续行；陈旧协议、源摘要或 compiler digest 不允许恢复；真正输入变更建立新编译身份。
- 业务完成：仅有完整六域原子 publication 且唯一 committed reader 重验后才返回 ir_ready。部分 Core/单域、候选、自报 PASS 不能变成完成结果。
- 已发布读取：授权身份 + 被接纳的 publication/result 绑定，重验数据、来源和完整性；合法下游不受旧 Checklist drafting phase 限制，也不接受调用者指定替代根路径。
- 人工停点：保留当前 Foundation 人工停点；未来获准 IR 接线后，真实试点必须停在 IR 完成，Checklist 只能在 IR-7 准入后由应用明确启动。

## 4. 缺陷分类与回流合同

`foundation_defect` 只用于能以精确源证据证明的产品缺失/矛盾/歧义。报告绑定 owner/project、inputDigest、reviewResultId/digest、foundationRevision、编译身份、reasonCode、expected/actual 和全部必要 source occurrence；reportId 为规范内容摘要。同一报告幂等，不含 Patch 或自行签发的问题。

模块在 IR-3 负责报告生成与不可变结果发布；应用在 IR-6 校验版本、授权和去重，再交给 Reviewer 公共入口独立确认；Revision 只消费 Reviewer 的正式问题。该回流 API 当前尚不存在，禁止调用旧内部 Issue admission 冒充完成。

compiler/schema/source renderer 缺陷、供应商故障、无效候选、publication 故障与未知用量留在 IR 技术诊断。obligation inventory 的遗漏是编译清单错误，不直接证明 Foundation 文档有缺陷；AMBIGUOUS 也须先区分表达缺陷与真实产品歧义。

## 5. 重试、执行与用量政策

- 复用 stateless 最小 authority + strict JSONL；每次 projection 是独立请求，不复用会话记忆或 full-packet fallback。验证角色只读，不能自改候选。
- 有效记录持久化一次；record/slice 纠错不得重写无关已接纳记录。跨域最终一致性失败只失效被证明受影响的 owner 及依赖闭包。
- 无进展比较稳定 authority、编译合同、已接纳前缀/清单、失败候选的安全摘要及诊断；随机 dispatch/session ID、时间戳不算进展。R3 必须让 preflight 循环也适用，恢复后不可遗忘。不得以固定三轮或 token/时间上限代替证据判断。
- 每次新受控执行重新取得明确执行许可；拒绝/额度不足/暂不可用阻止新派发，不伪造零用量。供应商或未知提交结果不能由 adapter 隐藏重试。
- 运行模型沿用现有产品配置与角色能力，记录配置版本；本次 Luna high 指执行子 agent，不等于修改产品模型。实际模型选择在平台授权/配置适配器解析，不擅自降级投影或独立验证。
- 实际用量采用至少一次投递与稳定 eventId 去重。执行终态与待投递用量同一可恢复提交；未知用量明确显示。IR 不定价或记账，当前平台“用量未结算不能继续交接”政策不能因换字段名被绕过。
- 本轮仅离线执行；真实服务、真实模型与计费验收须另行确定范围、费用和停止条件，不恢复经过热 schema 修改的旧 run。

## 6. 受限平台能力冻结

| 能力 | 最低合同/安全条件 | 不接受的实现 |
| --- | --- | --- |
| 可信上下文与许可 | 宿主绑定主体/项目/调用域；受控操作前得到允许/拒绝/暂不可用，许可范围与执行请求匹配 | caller 自报身份、由 billing 身份代替宿主授权 |
| 模型执行 | 稳定 executionId、输入与输出合同、可验证终态/关闭、真实用量与安全元数据；未知结果显式返回 | 隐式业务重试、通用 shell、供应商输出直接发布 IR |
| 私有状态 | 命名空间隔离、版本读取、CAS/线性化点、过期 writer 拒绝；状态与用量 outbox 同一恢复边界 | 无条件 get/set、第二控制器、读状态时修复 |
| 不可变产物 | 摘要绑定、prepare/commit 后整组可见、幂等重验、严格受限读取，路径与 symlink/FIFO 防护 | partial publication 可见、任意工作目录读取、只有文件存在即成功 |
| 用量交付 | 真实事件、稳定身份、可重放交付/确认状态，外部计费拥有财务权威 | 完成后静默丢用量、失败填零、IR 自有余额算法 |

优先实现本地文件与现有运行时适配；不引入数据库、分布式调度或孤儿执行自动接管。能力 API 的具体 TypeScript 类型在 IR-3 落地时须遵守此语义，不能只命名一个 port 却保留对整个旧 DeliveryRun 的依赖。

## 7. 验收与关闭条件

IR-0 关闭前须具备：固定 commit、逐文件摘要/依赖清单、KEEP/ADAPT/REPLACE/EXCLUDE、公开输入映射、版本/停止/重试/用量策略、F1—F8 与正式回归映射。F1 的新内部协议尚待 IR-R1 决策不等于可以直接实施；其他任务不能抢写其共享合同。

本批工作量先按可验收工作包计：IR-0 两份清单/契约证据；R0 三个正式 RED 回归；R1 一项跨域协议决策与端到端整改；R2 一项完整来源修复；R3 一项持久无进展闭环；R4 一项外层合同收敛；R5 两类完整 profile；R6 合流验收。人日总数待 R1 确认依赖协议影响后复估，不将当前源码体量当作剩余成本。
