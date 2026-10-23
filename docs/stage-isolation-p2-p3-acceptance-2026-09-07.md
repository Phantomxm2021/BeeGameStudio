# P2 / P3 主审验收记录（2026-09-07）

历史状态（本文件首次联合审计时点）：验收未整体通过；当时不勾选 P2/P3，不开始 P4 生产接线。未提交。

最新状态：按用户确认顺序，Reviewer 与 Revision 已分别通过独立离线验收，见 [P2 验收记录](stage-isolation-p2-acceptance-2026-09-07.md)及 [P3 验收记录](stage-isolation-p3-acceptance-2026-09-07.md)。格式范围例外已接受，Revision needs_action/failed 适用条件已由用户确认并写入 P0 契约。P4 仍未启动。本文件以下仅保留此前联合审计快照，不覆盖上述最终裁决。

## 范围

按用户确认顺序：P2/P3 业务等价及公开生命周期验收 → P4 三阶段公开交接 → 联合离线验证。只处理既定计划缺项，不新增恢复、后继租约、孤儿进程清理或监督机制；不操作既有项目、真实模型、服务、数据库或计费。

## 已核实证据

- Reviewer 本轮模块测试：331 passed，0 failed，55 文件，3689 assertions，222.54 秒。
- Revision 上轮撤回计划外恢复草稿后的固定版本：206 passed，0 failed，48 文件，1449 assertions。该结果不是本轮新增联测后的回归结果。
- 正常停止/显式续行、同轮失败文档重试并保留其他字节、候选身份与前驱绑定、下一轮问题交接已有离线测试。Revision 只发布候选，不签发 Reviewer 审计通过。
- stale owner 或无 terminal receipt 的 active attempt 保持 `needs_action(resumable: false)`；不能把停止意图、父进程不存在或测试通过数解释为进程树已经关闭。既定公开契约允许报告需要处理，因此不能将新增跨崩溃接管工程作为额外验收门槛。
- 未提交、清单尚未勾选本身不是实现缺陷；正式验收须由具体代码及测试证据支持，而不是循环引用清单状态。

## P2-FORMAT-001：仍需业务边界裁决

冻结版本 `71507fb5e` 的 `delivery-workflow/foundation-revision-batches.ts`：同一文档禁止 document/section scope 混合，不同文档可分别形成不同 scope 的 batch。旧 `controller.ts` 的发布分支仅在所有文档任务都是 document scope 时使用整文发布，否则进入 section 发布与事实复核路径。这使跨文档混合候选缺少清晰一致的发布语义。

当前 Reviewer `private/candidate-contract.ts` 仅为纯 document-scope 格式问题选择 `full_format`；其他候选进入 `private/targeted-preparation.ts`，后者要求 section-only operation，并拒绝任何 `DOCUMENT_FORMAT_INVALID` 来源。纯整文格式候选会重新完整审核；局部/混合格式候选拒绝接纳。

主审结论：现有失败关闭避免了错误的 PASS，但存在可观察的新旧行为差异，不能宣称局部/混合格式已经业务等价。不能在隔离迁移中自行发明复核策略。需要明确是否接受该路由继续拒绝并作为验收范围例外，或另行确定格式复核业务规则；未经决定不扩大验收范围，也不执行 P4。

## P0 / P3 公开状态契约差异

P0 公开状态约定列出 `failed`，Revision `private/lifecycle-contract.ts` 尚未声明该分支。当前配置、计费、执行或发布故障在安全条件满足后允许显式续行；未知关闭状态则为不可直接续行的 `needs_action`。

主审未将这些状态擅自重分类为不可恢复 `failed`。该静态契约差异需要明确状态适用条件及契约测试；单纯补一个从不返回的 union 成员不足以证明行为闭合，也不能据此要求新增恢复机制。

## 后续

已新增 `foundation-revision/private/tests/lifecycle-infrastructure.test.ts`，组合真实认证、运行配置、计费与 Revision public factory；底层凭证、配置 repository、计费 authority 和 native fixture 仅用固定本地替身。鉴权失败时以只读快照确认无 active attempt、attempt 为 0、无 receipt；显式 resume 后候选完成并结算，核对 owner/config 传递。清理必须 public stop 成功，且确认 active attempt 为 0、lease free；主审移除了吞掉 stop 错误的测试代码。

主审复跑最终测试：1 passed、0 failed、21 assertions、1129 毫秒。仅增加测试，没有修改生产状态或恢复语义。P2 的格式范围未裁决前，P4 仍未启动。
